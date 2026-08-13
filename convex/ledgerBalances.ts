import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";

/**
 * Materialised ledger balances (remediation plan task 1.5).
 *
 * THE PROBLEM THIS SOLVES. Every headline figure — cash position, revenue,
 * expense, runway — was computed by reading each journal line on the entity and
 * summing. Convex allows 4,096 document reads per query, and an entry drags ~2
 * lines behind it, so a book of a couple of thousand entries exhausted the
 * budget. The dashboard failed outright, then (after bounding the reads) showed
 * silently partial totals. Neither is acceptable, and no read budget fixes it:
 * the cost grows with the age of the business.
 *
 * THE SHAPE OF THE FIX. Keep a running sum per account, updated when an entry
 * posts. Reads become one row per account — roughly fifty — and stay constant as
 * the book grows. Doubling the transaction count changes nothing.
 *
 * WHY THIS IS SAFE HERE. `journalLines` remains the system of record; these rows
 * are derived and can be rebuilt from it at any time (`rebuildEntity`). And the
 * repo already guarantees a single writer to the ledger — `postLedgerEntryCore`
 * — so there is exactly one place to maintain them. A second writer would make
 * this design unsound, which is why the ledger's one-writer rule is load-bearing
 * and must stay that way.
 *
 * CORRECTIONS NEED NO SPECIAL CASE. Posted entries are immutable and corrections
 * are reversals, so a reversal is just another posting whose legs are mirrored.
 * It nets the balance back out through the same path. Nothing subtracts, nothing
 * mutates history.
 */

export type BalanceDelta = {
  accountId: Id<"ledgerAccounts">;
  debitMinor: number;
  creditMinor: number;
};

/**
 * Per-transaction memo of the balance rows already touched.
 *
 * WHY. Bulk paths post many entries inside ONE mutation — the demo seed, CSV
 * imports, the opening-balance sweep. Without this, posting 5,000 entries
 * re-reads the same handful of account rows 5,000 times, and the cost of a
 * posting becomes a function of how many postings preceded it in the same
 * transaction. That regressed the large-book tests from seconds to minutes.
 *
 * WHY IT IS SAFE. A Convex mutation is a transaction, and this module is the
 * only writer to these tables, so within one execution nothing else can change a
 * row we have already read. The cache holds the row id plus the running values we
 * ourselves have written, and is discarded when the mutation ends — a WeakMap
 * keyed on `ctx` means it cannot outlive it or leak between executions.
 */
type CachedBalance = { id: Id<"accountBalances">; debitMinor: number; creditMinor: number };
type CachedMonthBalance = { id: Id<"accountMonthBalances">; debitMinor: number; creditMinor: number };
type BalanceCache = {
  totals: Map<string, CachedBalance | null>;
  months: Map<string, CachedMonthBalance | null>;
};

const balanceCaches = new WeakMap<MutationCtx, BalanceCache>();

function cacheFor(ctx: MutationCtx): BalanceCache {
  let cache = balanceCaches.get(ctx);
  if (!cache) {
    cache = { totals: new Map(), months: new Map() };
    balanceCaches.set(ctx, cache);
  }
  return cache;
}

/** Calendar month bucket of an ISO date. */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/**
 * Apply one entry's legs to the running balances.
 *
 * Called from `postLedgerEntryCore` AFTER the lines are inserted, inside the same
 * mutation — so the balance and the lines it summarises commit together, or
 * neither does. Convex mutations are transactional, which is what makes a derived
 * total safe to keep at all.
 *
 * Legs are aggregated per account first, so a multi-leg entry touching the same
 * account twice costs one read and one write rather than two of each. That
 * matters on the bulk paths (the cutoff sweep, imports), which post in batches
 * and share one mutation's budget.
 */
export async function applyEntryToBalances(
  ctx: MutationCtx,
  args: {
    entityId: Id<"entities">;
    /** The ENTRY date — the month bucket follows the entry, never the clock. */
    date: string;
    lines: BalanceDelta[];
  },
): Promise<void> {
  const byAccount = new Map<Id<"ledgerAccounts">, { debitMinor: number; creditMinor: number }>();
  for (const line of args.lines) {
    const current = byAccount.get(line.accountId) ?? { debitMinor: 0, creditMinor: 0 };
    current.debitMinor += line.debitMinor;
    current.creditMinor += line.creditMinor;
    byAccount.set(line.accountId, current);
  }

  const now = Date.now();
  const month = monthOf(args.date);
  const cache = cacheFor(ctx);

  for (const [accountId, delta] of byAccount) {
    if (delta.debitMinor === 0 && delta.creditMinor === 0) continue;

    // ---- all-time ----
    const totalKey = `${args.entityId}|${accountId}`;
    let total = cache.totals.get(totalKey);
    if (total === undefined) {
      const existing = await ctx.db
        .query("accountBalances")
        .withIndex("by_entity_and_account", (q) =>
          q.eq("entityId", args.entityId).eq("accountId", accountId),
        )
        .unique();
      total = existing
        ? { id: existing._id, debitMinor: existing.debitMinor, creditMinor: existing.creditMinor }
        : null;
    }
    if (total) {
      const next = {
        debitMinor: total.debitMinor + delta.debitMinor,
        creditMinor: total.creditMinor + delta.creditMinor,
      };
      await ctx.db.patch(total.id, { ...next, updatedAt: now });
      cache.totals.set(totalKey, { id: total.id, ...next });
    } else {
      const id = await ctx.db.insert("accountBalances", {
        entityId: args.entityId,
        accountId,
        debitMinor: delta.debitMinor,
        creditMinor: delta.creditMinor,
        updatedAt: now,
      });
      cache.totals.set(totalKey, { id, debitMinor: delta.debitMinor, creditMinor: delta.creditMinor });
    }

    // ---- month bucket ----
    const monthKey = `${args.entityId}|${accountId}|${month}`;
    let bucket = cache.months.get(monthKey);
    if (bucket === undefined) {
      const existingMonth = await ctx.db
        .query("accountMonthBalances")
        .withIndex("by_entity_account_month", (q) =>
          q.eq("entityId", args.entityId).eq("accountId", accountId).eq("month", month),
        )
        .unique();
      bucket = existingMonth
        ? {
            id: existingMonth._id,
            debitMinor: existingMonth.debitMinor,
            creditMinor: existingMonth.creditMinor,
          }
        : null;
    }
    if (bucket) {
      const next = {
        debitMinor: bucket.debitMinor + delta.debitMinor,
        creditMinor: bucket.creditMinor + delta.creditMinor,
      };
      await ctx.db.patch(bucket.id, { ...next, updatedAt: now });
      cache.months.set(monthKey, { id: bucket.id, ...next });
    } else {
      const id = await ctx.db.insert("accountMonthBalances", {
        entityId: args.entityId,
        accountId,
        month,
        debitMinor: delta.debitMinor,
        creditMinor: delta.creditMinor,
        updatedAt: now,
      });
      cache.months.set(monthKey, { id, debitMinor: delta.debitMinor, creditMinor: delta.creditMinor });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

export type AccountBalance = { debitMinor: number; creditMinor: number };

/**
 * All-time balance per account, one row each.
 *
 * This is the whole point: constant-cost regardless of how many entries the book
 * carries.
 */
export async function loadAccountBalances(
  ctx: QueryCtx,
  entityId: Id<"entities">,
  limit: number,
): Promise<Map<Id<"ledgerAccounts">, AccountBalance>> {
  const rows = await ctx.db
    .query("accountBalances")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .take(limit);
  return new Map(rows.map((row) => [row.accountId, { debitMinor: row.debitMinor, creditMinor: row.creditMinor }]));
}

/**
 * Per-account balance for the months in `[fromMonth, toMonth]`, plus the same
 * figures bucketed by month.
 *
 * Used for the P&L trend, the trailing burn, and for a re-based book where the
 * working set starts at a books-start date rather than at the beginning of time.
 */
export async function loadMonthlyBalances(
  ctx: QueryCtx,
  entityId: Id<"entities">,
  args: { fromMonth?: string; toMonth?: string; limit: number },
): Promise<{
  totals: Map<Id<"ledgerAccounts">, AccountBalance>;
  byMonth: Map<string, Map<Id<"ledgerAccounts">, AccountBalance>>;
  truncated: boolean;
}> {
  const fetched = await ctx.db
    .query("accountMonthBalances")
    .withIndex("by_entity_and_month", (q) => {
      let scoped = q.eq("entityId", entityId);
      if (args.fromMonth) scoped = scoped.gte("month", args.fromMonth) as typeof scoped;
      if (args.toMonth) scoped = scoped.lte("month", args.toMonth) as typeof scoped;
      return scoped;
    })
    .take(args.limit + 1);
  const truncated = fetched.length > args.limit;
  const rows = truncated ? fetched.slice(0, args.limit) : fetched;

  const totals = new Map<Id<"ledgerAccounts">, AccountBalance>();
  const byMonth = new Map<string, Map<Id<"ledgerAccounts">, AccountBalance>>();
  for (const row of rows) {
    const total = totals.get(row.accountId) ?? { debitMinor: 0, creditMinor: 0 };
    total.debitMinor += row.debitMinor;
    total.creditMinor += row.creditMinor;
    totals.set(row.accountId, total);

    const bucket = byMonth.get(row.month) ?? new Map<Id<"ledgerAccounts">, AccountBalance>();
    const inMonth = bucket.get(row.accountId) ?? { debitMinor: 0, creditMinor: 0 };
    inMonth.debitMinor += row.debitMinor;
    inMonth.creditMinor += row.creditMinor;
    bucket.set(row.accountId, inMonth);
    byMonth.set(row.month, bucket);
  }
  return { totals, byMonth, truncated };
}

/**
 * The correction a mid-month books-start date needs.
 *
 * Month buckets cannot express "from the 15th". When the cutoff is not the first
 * of a month, the cutoff month's bucket includes days that belong to the archived
 * period, so those legs are read directly and subtracted. Bounded by a PART of
 * one month, not by the book.
 *
 * Decision D4 restricts new books-start dates to month starts, which makes this a
 * no-op going forward — but books re-based before that rule exist, and reporting
 * them off by a few days would be exactly the kind of quiet inaccuracy this whole
 * effort is about.
 */
export async function preCutoffMonthAdjustment(
  ctx: QueryCtx,
  entityId: Id<"entities">,
  cutoff: string,
  limit: number,
): Promise<Map<Id<"ledgerAccounts">, AccountBalance>> {
  const adjustment = new Map<Id<"ledgerAccounts">, AccountBalance>();
  if (cutoff.endsWith("-01")) return adjustment;

  const monthStart = `${monthOf(cutoff)}-01`;
  const entries = await ctx.db
    .query("journalEntries")
    .withIndex("by_entity_and_date", (q) =>
      q.eq("entityId", entityId).gte("date", monthStart).lt("date", cutoff),
    )
    .take(limit);
  const lineGroups = await Promise.all(
    entries.map((entry) =>
      ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", entry._id)).collect(),
    ),
  );
  for (const line of lineGroups.flat()) {
    const current = adjustment.get(line.accountId) ?? { debitMinor: 0, creditMinor: 0 };
    current.debitMinor += line.debitMinor;
    current.creditMinor += line.creditMinor;
    adjustment.set(line.accountId, current);
  }
  return adjustment;
}

/* -------------------------------------------------------------------------- */
/* Rebuild                                                                     */
/* -------------------------------------------------------------------------- */

/** How much of the journal one rebuild pass folds in before handing back. */
const REBUILD_BATCH_SIZE = 100;

export type RebuildResult = {
  entriesProcessed: number;
  cursor: string | null;
  done: boolean;
  /** True on the pass that cleared the old rows, so a caller can report honestly. */
  reset: boolean;
};

/**
 * Rebuild an entity's materialised balances from `journalLines`.
 *
 * Needed for two things: backfilling books that existed before this table, and
 * repairing them if they ever drift. Resumable, because a long book cannot be
 * folded inside one mutation's read budget — pass the returned `cursor` back
 * until `done`.
 *
 * The first pass (cursor === null) DELETES the entity's existing balance rows, so
 * a rebuild replaces rather than doubles. That makes a restart safe; it also means
 * an interrupted rebuild leaves balances low until it finishes, which the caller
 * should not treat as a reconciliation failure.
 */
export async function rebuildEntityBalances(
  ctx: MutationCtx,
  entityId: Id<"entities">,
  cursor: string | null,
): Promise<RebuildResult> {
  const reset = cursor === null;
  if (reset) {
    const staleTotals = await ctx.db
      .query("accountBalances")
      .withIndex("by_entity", (q) => q.eq("entityId", entityId))
      .take(2000);
    for (const row of staleTotals) await ctx.db.delete(row._id);
    // `accountMonthBalances` is indexed by (entityId, month); the entity prefix
    // is enough to sweep it.
    const staleMonths = await ctx.db
      .query("accountMonthBalances")
      .withIndex("by_entity_and_month", (q) => q.eq("entityId", entityId))
      .take(2000);
    for (const row of staleMonths) await ctx.db.delete(row._id);
  }

  const page = await ctx.db
    .query("journalEntries")
    .withIndex("by_entity_and_date", (q) => q.eq("entityId", entityId))
    .paginate({ cursor, numItems: REBUILD_BATCH_SIZE });

  for (const entry of page.page) {
    const lines = await ctx.db
      .query("journalLines")
      .withIndex("by_entry", (q) => q.eq("entryId", entry._id))
      .collect();
    if (lines.length === 0) continue;
    await applyEntryToBalances(ctx, {
      entityId,
      date: entry.date,
      lines: lines.map((line) => ({
        accountId: line.accountId,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
      })),
    });
  }

  return {
    entriesProcessed: page.page.length,
    cursor: page.continueCursor,
    done: page.isDone,
    reset,
  };
}

/**
 * Owner-facing rebuild. Requires `accountant` on the business's OWN workspace.
 *
 * Loop on the returned `cursor` until `done` — one call folds a bounded slice.
 */
export const rebuildEntity = mutation({
  args: {
    entityId: v.id("entities"),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new Error("Business not found.");
    await requireWorkspaceRole(ctx, entity.workspaceId, "accountant");
    return await rebuildEntityBalances(ctx, args.entityId, args.cursor ?? null);
  },
});

/** Same, for scheduled/backfill callers that have already authorized. */
export const rebuildEntityInternal = internalMutation({
  args: {
    entityId: v.id("entities"),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    return await rebuildEntityBalances(ctx, args.entityId, args.cursor ?? null);
  },
});

/**
 * Does the materialised balance agree with the lines it summarises?
 *
 * A derived total that silently drifts is worse than no derived total, so this
 * exists to prove agreement rather than assume it. Read-only; bounded, so it
 * reports `truncated` rather than throwing on a large book.
 */
export async function verifyEntityBalances(
  ctx: QueryCtx,
  entityId: Id<"entities">,
  entryLimit: number,
): Promise<{
  matches: boolean;
  truncated: boolean;
  mismatches: Array<{ accountId: Id<"ledgerAccounts">; storedNet: number; actualNet: number }>;
}> {
  const fetched = await ctx.db
    .query("journalEntries")
    .withIndex("by_entity_and_date", (q) => q.eq("entityId", entityId))
    .take(entryLimit + 1);
  const truncated = fetched.length > entryLimit;
  const entries = truncated ? fetched.slice(0, entryLimit) : fetched;

  const actual = new Map<Id<"ledgerAccounts">, AccountBalance>();
  const lineGroups = await Promise.all(
    entries.map((entry) =>
      ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", entry._id)).collect(),
    ),
  );
  for (const line of lineGroups.flat()) {
    const current = actual.get(line.accountId) ?? { debitMinor: 0, creditMinor: 0 };
    current.debitMinor += line.debitMinor;
    current.creditMinor += line.creditMinor;
    actual.set(line.accountId, current);
  }

  const stored = await loadAccountBalances(ctx, entityId, 2000);
  const accountIds = new Set<Id<"ledgerAccounts">>([...stored.keys(), ...actual.keys()]);
  const mismatches: Array<{ accountId: Id<"ledgerAccounts">; storedNet: number; actualNet: number }> = [];
  for (const accountId of accountIds) {
    const storedRow = stored.get(accountId) ?? { debitMinor: 0, creditMinor: 0 };
    const actualRow = actual.get(accountId) ?? { debitMinor: 0, creditMinor: 0 };
    const storedNet = storedRow.debitMinor - storedRow.creditMinor;
    const actualNet = actualRow.debitMinor - actualRow.creditMinor;
    if (storedNet !== actualNet) mismatches.push({ accountId, storedNet, actualNet });
  }

  // On a truncated scan the comparison is not meaningful — say so rather than
  // reporting a mismatch that is really just an unread tail.
  return { matches: !truncated && mismatches.length === 0, truncated, mismatches };
}

export type { Doc as LedgerBalanceDoc };
