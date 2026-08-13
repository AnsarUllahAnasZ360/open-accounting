import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  loadAccountBalances,
  loadMonthlyBalances,
  preCutoffMonthAdjustment,
} from "./ledgerBalances";

/**
 * Shared per-entity metric block (Epic E5-T6).
 *
 * The portfolio roll-up (portfolioViews.portfolioDashboard) and the single-entity
 * dashboard (coreViews.dashboard) MUST compute their per-business primitives the
 * SAME way, or a "combined" total could silently diverge from the sum of its
 * by-business parts. This module owns that one computation so the two paths can't
 * drift.
 *
 * Every figure is USD integer minor units (the ledger is USD-only — decisions
 * Q24/Q25); there is no FX conversion. Cash is LEDGER-derived (the balance of the
 * entity's cash ledger accounts), NEVER the live Plaid balance (E1-T10 / RC7), so
 * the dashboard cash tile reconciles with the Balance Sheet.
 *
 * This module is READ-ONLY: it never writes to journalEntries/journalLines (or
 * anything else). The ledger posting path is untouched.
 */

type Balance = { debitMinor: number; creditMinor: number };

/**
 * THE REAL CEILING IS 4096 DOCUMENTS READ PER FUNCTION EXECUTION.
 *
 * Not 32k. Comments elsewhere in this repo cite 32k and they are wrong — the
 * runtime error is explicit:
 *
 *   "Too many reads in a single function execution (limit: 4096)"
 *
 * That number governs the WHOLE query, not one table: every entry, every line,
 * every account, invoice, bill, transaction and contact the handler touches,
 * summed. It is easy to blow without noticing, because each journal entry drags
 * in roughly two lines behind it, so an entry cap of N costs about 3N reads.
 *
 * Budget below the ceiling rather than at it: the dashboard also reads several
 * other tables around these figures, and a query that only just fits today fails
 * the moment someone adds a widget.
 */
const CONVEX_READ_LIMIT = 4096;
/** Share of the ceiling the journal load may claim, leaving room for the rest. */
const JOURNAL_READ_BUDGET = 2400;
/** An entry plus its legs. Two-leg postings are the norm; three-leg happen. */
const DOCS_PER_ENTRY = 3;

/**
 * Per-entity entry cap for a SINGLE-business read.
 *
 * 800 entries ≈ 2,400 documents. Deliberately not "as many as possible": the
 * caller reads other tables too, and this has to leave room for them.
 */
export const METRIC_ENTRY_LIMIT = Math.floor(JOURNAL_READ_BUDGET / DOCS_PER_ENTRY);
/**
 * Cap for the flat side-tables (accounts, invoices, bills). Was 5,000 — which on
 * its own exceeded the real ceiling for one business, before a single journal
 * entry was read.
 */
const METRIC_TABLE_LIMIT = 400;

/**
 * Floor for one business's slice of a portfolio read. Below this the figures are
 * too partial to be worth computing, so a large portfolio truncates hard and says
 * so rather than quietly reporting a total assembled from a handful of entries.
 */
const MIN_ENTITY_ENTRY_BUDGET = 120;

/**
 * Month buckets are one row per (account, month), so a books-start date N months
 * back costs roughly accounts x N. This multiplier keeps that read bounded while
 * still covering a couple of years of a normal chart of accounts.
 */
const MONTH_BUCKET_FACTOR = 6;

/**
 * How many entries each business may load when `count` businesses share ONE read
 * transaction.
 *
 * This is what "All businesses" got wrong: the per-entity cap was applied per
 * entity, so N businesses read N times the budget and the query died at the
 * ceiling. The budget is a property of the transaction, not of the business, so
 * it has to be divided.
 */
export function entryBudgetFor(entityCount: number): number {
  const count = Math.max(1, entityCount);
  return Math.max(
    MIN_ENTITY_ENTRY_BUDGET,
    Math.min(METRIC_ENTRY_LIMIT, Math.floor(JOURNAL_READ_BUDGET / count / DOCS_PER_ENTRY)),
  );
}

/**
 * Cap for the side-tables when `count` businesses share one transaction. Same
 * reasoning as `entryBudgetFor` — a flat 400 per business is 2,000 reads across
 * five businesses, on top of the journal.
 */
export function tableBudgetFor(entityCount: number): number {
  const count = Math.max(1, entityCount);
  return Math.max(60, Math.min(METRIC_TABLE_LIMIT, Math.floor(METRIC_TABLE_LIMIT / count)));
}

/**
 * KNOWN LIMITATION, and the reason task 1.5 is now REQUIRED rather than optional.
 *
 * A book with more than ~800 journal entries cannot have its all-time totals
 * computed from raw lines inside one Convex query, at any budget. Bounding the
 * read stops the crash and reports `truncated` honestly, but the figures on a
 * large book ARE partial.
 *
 * The real fix is a materialised per-account balance updated at post time, which
 * turns this from thousands of reads into tens. Until that lands, the dashboard
 * degrades instead of failing — and says that it has.
 */
export const READ_LIMIT_FOR_REFERENCE = CONVEX_READ_LIMIT;
// Cash ledger accounts: a `bank`/`cash`/`checking`/`savings` asset, or any asset
// linked to a bankAccounts row.
const CASH_SUBTYPES = new Set(["bank", "cash", "checking", "savings"]);
// Trailing months used to estimate the monthly burn rate behind `runwayDays`.
const RUNWAY_TRAILING_MONTHS = 6;
const DAYS_PER_MONTH = 30;

function addBalance(map: Map<Id<"ledgerAccounts">, Balance>, line: Doc<"journalLines">) {
  const current = map.get(line.accountId) ?? { debitMinor: 0, creditMinor: 0 };
  current.debitMinor += line.debitMinor;
  current.creditMinor += line.creditMinor;
  map.set(line.accountId, current);
}

function normalBalance(account: Doc<"ledgerAccounts">, balance: Balance) {
  if (account.type === "asset" || account.type === "expense") {
    return balance.debitMinor - balance.creditMinor;
  }
  return balance.creditMinor - balance.debitMinor;
}

function shiftMonth(month: string, delta: number) {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Load every journal entry for an entity plus all of its lines, whole-entry via
 * the `by_entry` index, so an entry's debit and credit legs are always loaded
 * together (never split by a flat `.take`). Mirrors the dashboard/report loaders.
 */
export type EntityJournal = {
  entries: Doc<"journalEntries">[];
  lines: Doc<"journalLines">[];
  truncated: boolean;
};

export async function loadEntityJournal(
  ctx: QueryCtx,
  entityId: Id<"entities">,
  /**
   * The entity's books-start date, when it has one. Everything earlier was
   * reversed by the re-base, so an original and its reversal cancel and change
   * no metric — but reading them still costs document budget, and this loader
   * runs once PER BUSINESS on the portfolio roll-up. That multiplication is what
   * takes "All businesses" down while each business alone loads fine.
   */
  startDate: string | null,
  /** This entity's slice of the shared read budget (see `entryBudgetFor`). */
  entryBudget: number,
): Promise<EntityJournal> {
  // MOST RECENT FIRST. The index is keyed on date ascending, so a bounded read
  // in natural order keeps the oldest entries and drops everything recent —
  // which on a book larger than the budget means the dashboard reports figures
  // from years ago and shows nothing from this month.
  //
  // Truncating a balance is wrong in either direction; this at least keeps the
  // period the owner is actually looking at, and `truncated` says it happened.
  const fetched = await ctx.db
    .query("journalEntries")
    .withIndex("by_entity_and_date", (q) => {
      const scoped = q.eq("entityId", entityId);
      return startDate ? scoped.gte("date", startDate) : scoped;
    })
    .order("desc")
    .take(entryBudget + 1);
  const truncated = fetched.length > entryBudget;
  const entries = truncated ? fetched.slice(0, entryBudget) : fetched;
  const lineGroups = await Promise.all(
    entries.map((entry) =>
      ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", entry._id)).collect(),
    ),
  );
  return { entries, lines: lineGroups.flat(), truncated };
}

export type EntityBalanceSnapshot = {
  /** Net position per account across the entity's working set. */
  balances: Map<Id<"ledgerAccounts">, Balance>;
  /** The same figures per calendar month, for trend and burn. */
  monthly: Map<string, Map<Id<"ledgerAccounts">, Balance>>;
  /** Latest month with any activity, or null on an empty book. */
  latestMonth: string | null;
  /** True when figures came from the line-based fallback and a rebuild is due. */
  needsRebuild: boolean;
  truncated: boolean;
};

/**
 * Load an entity's position from the MATERIALISED balances.
 *
 * This replaces reading every journal line on every dashboard load. Cost is one
 * row per account (all-time) or per account-month (re-based book) instead of
 * thousands of lines, so it stays flat as the book grows — double the
 * transactions and this reads exactly the same amount.
 *
 * Two cases:
 *
 *  - NO books-start date → the all-time running balance is the answer directly.
 *  - A books-start date → sum the month buckets from that month forward, and
 *    subtract the part of the cutoff month that falls before the exact day (a
 *    no-op under decision D4, which restricts new cutoffs to month starts).
 *
 * The monthly buckets are loaded either way, because the trailing burn behind
 * `runwayDays` needs them.
 */
async function loadEntityBalances(
  ctx: QueryCtx,
  entity: Doc<"entities">,
  limit: number,
): Promise<EntityBalanceSnapshot> {
  const cutoff = entity.openingBalanceDate ?? null;
  const fromMonth = cutoff ? cutoff.slice(0, 7) : undefined;

  const monthly = await loadMonthlyBalances(ctx, entity._id, {
    fromMonth,
    limit: limit * MONTH_BUCKET_FACTOR,
  });

  let balances: Map<Id<"ledgerAccounts">, Balance>;
  let truncated = monthly.truncated;

  if (cutoff) {
    // Working set = the cutoff month onward, less the pre-cutoff days of that month.
    balances = new Map(monthly.totals);
    const adjustment = await preCutoffMonthAdjustment(ctx, entity._id, cutoff, limit);
    for (const [accountId, delta] of adjustment) {
      const current = balances.get(accountId);
      if (!current) continue;
      balances.set(accountId, {
        debitMinor: current.debitMinor - delta.debitMinor,
        creditMinor: current.creditMinor - delta.creditMinor,
      });
    }
  } else {
    // All-time: one row per account, the cheapest read in the system.
    balances = await loadAccountBalances(ctx, entity._id, limit);
  }

  const latestMonth = [...monthly.byMonth.keys()].sort((a, b) => b.localeCompare(a))[0] ?? null;

  // FALLBACK: a book with ledger history but no materialised rows.
  //
  // Two ways to get here, and both are real:
  //  - A business that posted entries before this table existed, between the
  //    deploy and its rebuild. Reading zero there would be far worse than the
  //    partial totals it replaces — it would look like the books were wiped.
  //  - A path that wrote journalLines directly instead of going through
  //    postLedgerEntryCore (fixtures and seeds do this). The materialisation
  //    only sees the single posting path, by design.
  //
  // So: if the ledger has entries but the balances do not, compute from the lines
  // the way this module used to, and say a rebuild is needed. Bounded, so a large
  // book still degrades rather than failing.
  if (balances.size === 0) {
    const anyEntry = await ctx.db
      .query("journalEntries")
      .withIndex("by_entity_and_date", (q) => q.eq("entityId", entity._id))
      .first();
    if (anyEntry) {
      return await computeSnapshotFromLines(ctx, entity, limit * MONTH_BUCKET_FACTOR);
    }
  }

  return { balances, monthly: monthly.byMonth, latestMonth, truncated, needsRebuild: false };
}

/**
 * The pre-materialisation computation, kept as the transition and fixture path.
 *
 * Reads entries and their lines directly. This is the cost the materialised
 * tables exist to avoid, so it is bounded and flags `truncated` — it is a
 * fallback, never the steady state.
 */
async function computeSnapshotFromLines(
  ctx: QueryCtx,
  entity: Doc<"entities">,
  entryBudget: number,
): Promise<EntityBalanceSnapshot> {
  const journal = await loadEntityJournal(
    ctx,
    entity._id,
    entity.openingBalanceDate ?? null,
    entryBudget,
  );
  const entriesById = new Map(journal.entries.map((entry) => [entry._id, entry]));
  const balances = new Map<Id<"ledgerAccounts">, Balance>();
  const monthly = new Map<string, Map<Id<"ledgerAccounts">, Balance>>();

  for (const line of journal.lines) {
    addBalance(balances, line);
    const entry = entriesById.get(line.entryId);
    if (!entry) continue;
    const month = entry.date.slice(0, 7);
    const bucket = monthly.get(month) ?? new Map<Id<"ledgerAccounts">, Balance>();
    const current = bucket.get(line.accountId) ?? { debitMinor: 0, creditMinor: 0 };
    current.debitMinor += line.debitMinor;
    current.creditMinor += line.creditMinor;
    bucket.set(line.accountId, current);
    monthly.set(month, bucket);
  }

  const latestMonth =
    journal.entries.map((entry) => entry.date.slice(0, 7)).sort((a, b) => b.localeCompare(a))[0] ?? null;
  return { balances, monthly, latestMonth, truncated: journal.truncated, needsRebuild: true };
}

export type EntityMetrics = {
  entityId: Id<"entities">;
  name: string;
  currency: string;
  /** Ledger cash position (cash asset accounts), excluding credit cards. */
  cashMinor: number;
  /** Open A/R: invoice balances still owed (totalMinor − amountPaidMinor). */
  arMinor: number;
  /** Open A/P: bill balances still owed. */
  apMinor: number;
  /** All-time income (credit−debit on income accounts). */
  revenueMinor: number;
  /** All-time expense (debit−credit on expense accounts). */
  expenseMinor: number;
  /**
   * Estimated runway in DAYS: cash ÷ trailing-average monthly net burn × 30.
   * `null` when the business is net cash-positive (no burn) or has no cash.
   */
  runwayDays: number | null;
  /** True if an in-range journal entry was excluded by the entry cap. */
  truncated: boolean;
};

/**
 * Compute the shared per-entity metric block straight from the ledger. The
 * caller MUST have already authorized the read of this entity's workspace
 * (single-entity path: getActiveEntity; portfolio path: assertScopeAuthorized +
 * a per-entity requireWorkspaceRole). This function performs NO authorization of
 * its own — it only reads — so it is safe to call after the authz gate.
 */
export async function computeEntityMetrics(
  ctx: QueryCtx,
  entity: Doc<"entities">,
  options: {
    /**
     * Entries this business may load. Omit on a single-entity read to keep the
     * full per-entity cap; a multi-business read passes each entity its slice of
     * the shared budget so N businesses fit in one read transaction.
     */
    entryBudget?: number;
    /**
     * No longer accepted. The metric block reads MATERIALISED balances now — one
     * row per account instead of the whole journal — so there is nothing
     * expensive left to share, and a caller handing in raw entries would be
     * describing a different (bounded) view of the book than the balances do.
     *
     * `coreViews.dashboard` still loads a journal for its own widgets; that read
     * is period-bounded and separate.
     */
    journal?: never;
    /**
     * Side-tables the caller has ALREADY read for this entity.
     *
     * `coreViews.dashboard` loads all four for its own widgets. Without this it
     * read each of them twice per business — once there, once here — which on a
     * 4,096-document ceiling is not a micro-optimisation, it is the difference
     * between rendering and throwing.
     *
     * Must be the same entity's rows, loaded with the same bounds, or the metric
     * block and the widgets would describe different books.
     */
    accounts?: Doc<"ledgerAccounts">[];
    bankAccounts?: Doc<"bankAccounts">[];
    invoices?: Doc<"invoices">[];
    bills?: Doc<"bills">[];
    /** Slice of the side-table budget (see `tableBudgetFor`). */
    tableBudget?: number;
  } = {},
): Promise<EntityMetrics> {
  const entryBudget = options.entryBudget ?? METRIC_ENTRY_LIMIT;
  const tableBudget = options.tableBudget ?? METRIC_TABLE_LIMIT;
  const [snapshot, accounts, bankAccounts, invoices, bills] = await Promise.all([
    loadEntityBalances(ctx, entity, tableBudget),
    options.accounts ??
      ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(tableBudget),
    options.bankAccounts ??
      ctx.db.query("bankAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(60)
      .then((rows) => rows.filter((account) => !account.archived)),
    options.invoices ??
      ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(tableBudget),
    options.bills ??
      ctx.db.query("bills").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(tableBudget),
  ]);
  const { balances, monthly, latestMonth: latestActivityMonth, truncated } = snapshot;

  const accountsById = new Map(accounts.map((account) => [account._id, account]));

  // Cash ledger accounts (exclude credit-card "bank" accounts: a card is a
  // liability and must not inflate the cash position).
  const creditLedgerAccountIds = new Set(
    bankAccounts.filter((bank) => bank.kind === "credit").map((bank) => bank.ledgerAccountId),
  );
  const cashAccountIds = new Set(
    accounts
      .filter(
        (account) =>
          account.type === "asset" &&
          !creditLedgerAccountIds.has(account._id) &&
          (CASH_SUBTYPES.has(account.subtype) ||
            bankAccounts.some((bank) => bank.ledgerAccountId === account._id && bank.kind !== "credit")),
      )
      .map((account) => account._id),
  );

  // Per-month income/expense for the burn estimate, folded from the materialised
  // month buckets rather than from raw lines.
  const monthlyPnl = new Map<string, { incomeMinor: number; expenseMinor: number }>();
  for (const [month, perAccount] of monthly) {
    const bucket = monthlyPnl.get(month) ?? { incomeMinor: 0, expenseMinor: 0 };
    for (const [accountId, balance] of perAccount) {
      const account = accountsById.get(accountId);
      if (!account) continue;
      if (account.type === "income") bucket.incomeMinor += balance.creditMinor - balance.debitMinor;
      else if (account.type === "expense") bucket.expenseMinor += balance.debitMinor - balance.creditMinor;
    }
    monthlyPnl.set(month, bucket);
  }

  let cashMinor = 0;
  for (const accountId of cashAccountIds) {
    const account = accountsById.get(accountId);
    const balance = balances.get(accountId);
    if (account && balance) cashMinor += normalBalance(account, balance);
  }

  let revenueMinor = 0;
  let expenseMinor = 0;
  for (const [accountId, balance] of balances.entries()) {
    const account = accountsById.get(accountId);
    if (!account) continue;
    if (account.type === "income") revenueMinor += normalBalance(account, balance);
    if (account.type === "expense") expenseMinor += normalBalance(account, balance);
  }

  const arMinor = invoices
    .filter((invoice) => invoice.status === "open" || invoice.status === "overdue")
    .reduce((sum, invoice) => sum + Math.max(0, invoice.totalMinor - invoice.amountPaidMinor), 0);
  const apMinor = bills
    .filter((bill) => bill.status === "open")
    .reduce((sum, bill) => sum + bill.totalMinor, 0);

  // Runway: trailing-average monthly NET burn (expense − income) over the last
  // RUNWAY_TRAILING_MONTHS ending at the latest month with activity. If the
  // business is net cash-positive (burn ≤ 0) or holds no cash, runway is null
  // (effectively infinite / not applicable).
  // Taken from the materialised month buckets, which cover the whole book rather
  // than a bounded slice of it.
  const latestMonth = latestActivityMonth;
  let runwayDays: number | null = null;
  if (latestMonth && cashMinor > 0) {
    const trailingMonths = Array.from({ length: RUNWAY_TRAILING_MONTHS }, (_, i) =>
      shiftMonth(latestMonth, i - (RUNWAY_TRAILING_MONTHS - 1)),
    );
    const trailingBurn = trailingMonths.map((month) => {
      const bucket = monthlyPnl.get(month) ?? { incomeMinor: 0, expenseMinor: 0 };
      return bucket.expenseMinor - bucket.incomeMinor;
    });
    const avgMonthlyBurnMinor = Math.round(
      trailingBurn.reduce((sum, value) => sum + value, 0) / trailingBurn.length,
    );
    if (avgMonthlyBurnMinor > 0) {
      runwayDays = Math.round((cashMinor / avgMonthlyBurnMinor) * DAYS_PER_MONTH);
    }
  }

  return {
    entityId: entity._id,
    name: entity.name,
    currency: entity.currency,
    cashMinor,
    arMinor,
    apMinor,
    revenueMinor,
    expenseMinor,
    runwayDays,
    truncated,
  };
}
