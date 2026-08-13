import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";
import { assertScopeAuthorized, scopeValidator, type Scope } from "./entityScope";

/**
 * Opening-balance diagnostics (remediation plan, Phase 0).
 *
 * READ-ONLY. This module writes nothing, posts nothing and corrects nothing. It
 * exists to answer one question with evidence rather than assertion:
 *
 *   Does this business's ledger cash agree with what the bank says it holds?
 *
 * WHY THIS EXISTS. Linking a bank posts an opening entry from the bank's CURRENT
 * balance, and the connector then imports up to two years of transactions into
 * that same cash account. Both hit the ledger, so cash reads as
 *
 *     current balance + every imported movement
 *
 * when the right answer is just the current balance. The books still balance —
 * debits equal credits, every invariant check passes — so nothing in the system
 * complains. The error is only visible by comparing the ledger against the bank,
 * which is exactly what this query does.
 *
 * `varianceMinor` is the headline. On a healthy book it is zero. A non-zero
 * variance that tracks the size of the imported history is the double-count.
 *
 * BOUNDED ON PURPOSE. A diagnostic that dies of the same read-limit failure it
 * was written to investigate is worse than useless, so every scan here is capped
 * and reports `truncated` instead of throwing. A truncated answer is still
 * evidence; an exception is not.
 */

/** Cash ledger accounts, mirroring entityMetrics so the two cannot disagree. */
const CASH_SUBTYPES = new Set(["bank", "cash", "checking", "savings"]);

/**
 * Read caps. Deliberately far below the per-entity limits in entityMetrics: this
 * query runs across EVERY business at once, and its job is to survive on exactly
 * the books that are already too large for the portfolio roll-up.
 */
const DIAG_ENTRY_LIMIT = 4000;
const DIAG_ACCOUNT_LIMIT = 2000;
const DIAG_BANK_LIMIT = 200;
/** Opening-balance entries are a handful per business; this is generous. */
const DIAG_OPENING_LIMIT = 50;

type Balance = { debitMinor: number; creditMinor: number };

function normalBalance(account: Doc<"ledgerAccounts">, balance: Balance) {
  if (account.type === "asset" || account.type === "expense") {
    return balance.debitMinor - balance.creditMinor;
  }
  return balance.creditMinor - balance.debitMinor;
}

/**
 * Every `sourceId` that can carry an opening-balance entry on this business.
 *
 * Mirrors `onboarding.openingEntrySourceIds`. Three producers write one, each
 * with its own tag: the bank link (`opening:<plaidAccountId>` — the one posted
 * from the CURRENT balance, and therefore the suspect), and the onboarding
 * wizard / Settings (`opening:onboarding:...`).
 */
async function openingEntrySourceIds(
  ctx: QueryCtx,
  entityId: Id<"entities">,
  bankAccounts: Doc<"bankAccounts">[],
): Promise<Array<{ sourceId: string; producer: "bank-link" | "manual" }>> {
  const ids: Array<{ sourceId: string; producer: "bank-link" | "manual" }> = [
    { sourceId: `opening:onboarding:entity:${entityId}`, producer: "manual" },
  ];
  for (const bank of bankAccounts) {
    ids.push({ sourceId: `opening:onboarding:bank:${bank._id}`, producer: "manual" });
    // The bank-link opening entry — posted from the live balance, never derived.
    if (bank.plaidAccountId) {
      ids.push({ sourceId: `opening:${bank.plaidAccountId}`, producer: "bank-link" });
    }
  }
  return ids;
}

async function diagnoseEntity(ctx: QueryCtx, entity: Doc<"entities">) {
  const cutoff = entity.openingBalanceDate ?? null;

  const [accounts, bankAccountRows] = await Promise.all([
    ctx.db
      .query("ledgerAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(DIAG_ACCOUNT_LIMIT),
    ctx.db
      .query("bankAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(DIAG_BANK_LIMIT),
  ]);
  const bankAccounts = bankAccountRows.filter((bank) => !bank.archived);
  const accountsById = new Map(accounts.map((account) => [account._id, account]));

  // Cash accounts: a bank/cash asset, excluding credit cards (a card is a
  // liability and must never inflate the cash position).
  const creditLedgerAccountIds = new Set(
    bankAccounts.filter((bank) => bank.kind === "credit").map((bank) => bank.ledgerAccountId),
  );
  const cashAccountIds = new Set(
    accounts
      .filter(
        (account) =>
          account.type === "asset" &&
          !account.archived &&
          !creditLedgerAccountIds.has(account._id) &&
          (CASH_SUBTYPES.has(account.subtype) ||
            bankAccounts.some((bank) => bank.ledgerAccountId === account._id && bank.kind !== "credit")),
      )
      .map((account) => account._id),
  );

  // --- Ledger side --------------------------------------------------------
  //
  // The WHOLE journal, not the post-cutoff slice. The double-count predates any
  // cutoff, and filtering to the working set would hide precisely the history
  // that causes it.
  const fetchedEntries = await ctx.db
    .query("journalEntries")
    .withIndex("by_entity_and_date", (q) => q.eq("entityId", entity._id))
    .take(DIAG_ENTRY_LIMIT + 1);
  const truncated = fetchedEntries.length > DIAG_ENTRY_LIMIT;
  const entries = truncated ? fetchedEntries.slice(0, DIAG_ENTRY_LIMIT) : fetchedEntries;

  const lineGroups = await Promise.all(
    entries.map((entry) =>
      ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", entry._id)).collect(),
    ),
  );
  const lines = lineGroups.flat();

  const balances = new Map<Id<"ledgerAccounts">, Balance>();
  for (const line of lines) {
    const current = balances.get(line.accountId) ?? { debitMinor: 0, creditMinor: 0 };
    current.debitMinor += line.debitMinor;
    current.creditMinor += line.creditMinor;
    balances.set(line.accountId, current);
  }

  let ledgerCashMinor = 0;
  for (const accountId of cashAccountIds) {
    const account = accountsById.get(accountId);
    const balance = balances.get(accountId);
    if (account && balance) ledgerCashMinor += normalBalance(account, balance);
  }

  // 3900 Opening Balance Equity. A non-zero balance on a live book means setup
  // was never finished — it is a suspense account, not a permanent one.
  const equityAccount = accounts.find((account) => account.number === "3900") ?? null;
  const equityBalance = equityAccount ? balances.get(equityAccount._id) : undefined;
  const openingBalanceEquityMinor =
    equityAccount && equityBalance ? normalBalance(equityAccount, equityBalance) : 0;

  // --- Bank side ----------------------------------------------------------
  //
  // `balanceMinor` is what the connector last saw. Credit cards are excluded to
  // match the cash definition above.
  const cashBankAccounts = bankAccounts.filter((bank) => bank.kind !== "credit");
  const liveBankBalanceMinor = cashBankAccounts.reduce((sum, bank) => sum + bank.balanceMinor, 0);
  // A business with no linked bank has nothing to compare against, so its
  // variance is meaningless rather than zero. Report the count so the caller can
  // tell "reconciles" apart from "nothing to reconcile".
  const linkedCashAccounts = cashBankAccounts.length;

  // --- Opening entries ----------------------------------------------------
  const openingEntries: Array<{
    sourceId: string;
    producer: "bank-link" | "manual";
    date: string;
    assetMinor: number;
    reversed: boolean;
  }> = [];
  for (const { sourceId, producer } of await openingEntrySourceIds(ctx, entity._id, bankAccounts)) {
    const candidates = await ctx.db
      .query("journalEntries")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .filter((q) => q.eq(q.field("sourceId"), sourceId))
      .take(DIAG_OPENING_LIMIT);
    for (const candidate of candidates) {
      const reversal = await ctx.db
        .query("journalEntries")
        .withIndex("by_reverses_entry", (q) => q.eq("reversesEntryId", candidate._id))
        .first();
      const entryLines = await ctx.db
        .query("journalLines")
        .withIndex("by_entry", (q) => q.eq("entryId", candidate._id))
        .collect();
      let assetMinor = 0;
      for (const line of entryLines) {
        const account = accountsById.get(line.accountId);
        if (!account || account.type !== "asset") continue;
        assetMinor += line.debitMinor - line.creditMinor;
      }
      openingEntries.push({
        sourceId,
        producer,
        date: candidate.date,
        assetMinor,
        reversed: reversal !== null,
      });
    }
  }

  // --- Cutoff health ------------------------------------------------------
  //
  // A pre-cutoff entry WITHOUT a reversal means the re-base never finished on
  // this business — the sweep is resumable and the caller may have stopped
  // looping. That is worth surfacing separately from the variance.
  let preCutoffEntries = 0;
  let preCutoffUnreversed = 0;
  if (cutoff) {
    for (const entry of entries) {
      if (entry.date >= cutoff) continue;
      // A reversal is itself dated pre-cutoff; don't count it as work outstanding.
      if (entry.reversesEntryId) continue;
      preCutoffEntries += 1;
      const reversal = await ctx.db
        .query("journalEntries")
        .withIndex("by_reverses_entry", (q) => q.eq("reversesEntryId", entry._id))
        .first();
      if (reversal === null) preCutoffUnreversed += 1;
    }
  }

  const varianceMinor = ledgerCashMinor - liveBankBalanceMinor;

  return {
    entityId: entity._id,
    name: entity.name,
    booksStartDate: cutoff,

    /** What the ledger says this business holds in cash. */
    ledgerCashMinor,
    /** What the connector last reported the bank holds. */
    liveBankBalanceMinor,
    /**
     * THE HEADLINE. Zero on a healthy book. Positive means ledger cash exceeds
     * the bank — the signature of the opening-balance double-count.
     */
    varianceMinor,
    /**
     * Non-zero means opening-balance setup was never closed out. 3900 is a
     * suspense account and should not carry a balance on a live book.
     */
    openingBalanceEquityMinor,

    /**
     * Every opening entry on the book. A live (`reversed: false`) entry with
     * `producer: "bank-link"` is one posted from the bank's CURRENT balance and
     * is the specific defect the Phase 4 repair targets.
     */
    openingEntries,
    suspectBankLinkOpenings: openingEntries.filter(
      (entry) => entry.producer === "bank-link" && !entry.reversed,
    ).length,

    /** Re-base progress. `preCutoffUnreversed > 0` means the sweep never finished. */
    preCutoffEntries,
    preCutoffUnreversed,

    /** Diagnostics about the diagnostic itself — never silently mislead. */
    entriesScanned: entries.length,
    /** Zero means there is no bank to reconcile against; `varianceMinor` is then meaningless. */
    linkedCashAccounts,
    truncated,
  };
}

/**
 * Per-business opening-balance health for the caller's workspace.
 *
 * Requires `accountant` on each business's OWN workspace — this exposes cash
 * position and bank balances, so it is not a `member`-level read. Authorization
 * is re-checked per entity, never inferred from the scope argument.
 *
 * Read-only: safe to run on production data at any time.
 */
export const openingBalanceHealth = query({
  args: { scope: v.optional(scopeValidator) },
  handler: async (ctx, args) => {
    const { membership } = await requireAnyWorkspaceRole(ctx, "accountant");
    const scope: Scope = args.scope ?? "all";

    // The authorized entity set is derived from the caller's membership, never
    // from a client-supplied list.
    const entities = await assertScopeAuthorized(ctx, membership, scope);
    const ordered = entities
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id));

    const businesses = [];
    for (const entity of ordered) {
      await requireWorkspaceRole(ctx, entity.workspaceId, "accountant");
      businesses.push(await diagnoseEntity(ctx, entity));
    }

    return {
      businesses,
      totals: {
        ledgerCashMinor: businesses.reduce((sum, row) => sum + row.ledgerCashMinor, 0),
        liveBankBalanceMinor: businesses.reduce((sum, row) => sum + row.liveBankBalanceMinor, 0),
        varianceMinor: businesses.reduce((sum, row) => sum + row.varianceMinor, 0),
        openingBalanceEquityMinor: businesses.reduce(
          (sum, row) => sum + row.openingBalanceEquityMinor,
          0,
        ),
      },
      /**
       * True when any business's scan was capped. The variance is then a LOWER
       * BOUND, not the whole story — say so rather than presenting a partial
       * figure as final.
       */
      truncated: businesses.some((row) => row.truncated),
    };
  },
});
