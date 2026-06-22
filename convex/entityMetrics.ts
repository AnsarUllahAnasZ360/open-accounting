import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

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

// Cap journal loading by ENTRY (not by flat row) so a per-entity read can never
// drop one leg of a balanced posting (mirrors coreViews/reportViews, E1-T5).
export const METRIC_ENTRY_LIMIT = 20000;
const METRIC_TABLE_LIMIT = 5000;
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
async function loadEntityJournal(
  ctx: QueryCtx,
  entityId: Id<"entities">,
): Promise<{ entries: Doc<"journalEntries">[]; lines: Doc<"journalLines">[]; truncated: boolean }> {
  const fetched = await ctx.db
    .query("journalEntries")
    .withIndex("by_entity_and_date", (q) => q.eq("entityId", entityId))
    .take(METRIC_ENTRY_LIMIT + 1);
  const truncated = fetched.length > METRIC_ENTRY_LIMIT;
  const entries = truncated ? fetched.slice(0, METRIC_ENTRY_LIMIT) : fetched;
  const lineGroups = await Promise.all(
    entries.map((entry) =>
      ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", entry._id)).collect(),
    ),
  );
  return { entries, lines: lineGroups.flat(), truncated };
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
): Promise<EntityMetrics> {
  const [journal, accounts, bankAccounts, invoices, bills] = await Promise.all([
    loadEntityJournal(ctx, entity._id),
    ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(METRIC_TABLE_LIMIT),
    ctx.db.query("bankAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(200),
    ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(METRIC_TABLE_LIMIT),
    ctx.db.query("bills").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(METRIC_TABLE_LIMIT),
  ]);
  const { entries, lines, truncated } = journal;

  const accountsById = new Map(accounts.map((account) => [account._id, account]));
  const entriesById = new Map(entries.map((entry) => [entry._id, entry]));

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

  // Aggregate balances + a per-month income/expense bucket for the burn estimate.
  const balances = new Map<Id<"ledgerAccounts">, Balance>();
  const monthlyPnl = new Map<string, { incomeMinor: number; expenseMinor: number }>();
  for (const line of lines) {
    addBalance(balances, line);
    const account = accountsById.get(line.accountId);
    const entry = entriesById.get(line.entryId);
    if (!account || !entry) continue;
    if (account.type === "income" || account.type === "expense") {
      const month = entry.date.slice(0, 7);
      const bucket = monthlyPnl.get(month) ?? { incomeMinor: 0, expenseMinor: 0 };
      if (account.type === "income") bucket.incomeMinor += line.creditMinor - line.debitMinor;
      else bucket.expenseMinor += line.debitMinor - line.creditMinor;
      monthlyPnl.set(month, bucket);
    }
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
  const latestMonth =
    entries.map((entry) => entry.date.slice(0, 7)).sort((a, b) => b.localeCompare(a))[0] ?? null;
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
