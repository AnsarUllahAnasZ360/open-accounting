import { v } from "convex/values";

import { getActiveEntity } from "./activeEntity";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";
import { assertScopeAuthorized, scopeValidator, type Scope } from "./entityScope";

const TODAY = "2026-06-11";

// The Payroll & Contractors expense account. Payroll posts Dr 5000 / Cr 2200 on
// approval (convex/payroll.ts:approveRun), so the ledger lines on this account
// ARE the period's payroll cost — and they reconcile to the Reports Payroll
// Summary base total, which sums the SAME approved runs. (E10-T4)
const PAYROLL_EXPENSE_NUMBER = "5000";

// Period presets, computed against the demo "today". `this` = month-to-date
// (Jun 1–11 2026); `last` = the full prior month (May 2026). Mirrors the
// Expenses prototype's two-segment period control.
const PERIODS = {
  this: { start: "2026-06-01", end: TODAY, label: "This month" },
  last: { start: "2026-05-01", end: "2026-05-31", label: "Last month" },
} as const;
type PeriodId = keyof typeof PERIODS;

function dateDiffDays(left: string, right: string) {
  return Math.floor((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000);
}

function shiftMonth(periodStart: string, months: number) {
  const [y, m] = periodStart.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

function monthEnd(periodStart: string) {
  const [y, m] = periodStart.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

function isLikelyInternalTransfer(transaction: Doc<"transactions">) {
  if (transaction.transferPairId || transaction.intercompanyPairId) return true;
  const text = `${transaction.merchant} ${transaction.rawDescription}`.toLowerCase();
  return (
    text.includes("moving funds") ||
    text.includes("business checking - transfer") ||
    text.includes("moving fun; z360biz") ||
    text.includes("z360biz llc (mercury) - moving funds")
  );
}

async function resolveExpenseEntities(
  ctx: QueryCtx,
  args: { entityId?: Id<"entities">; scope?: Scope },
): Promise<{ entities: Doc<"entities">[]; isPortfolioScope: boolean }> {
  const isPortfolioScope = args.scope === "all" && !args.entityId;
  if (isPortfolioScope) {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const entities = await assertScopeAuthorized(ctx, membership, "all");
    for (const entity of entities) await requireWorkspaceRole(ctx, entity.workspaceId, "member");
    return { entities, isPortfolioScope };
  }
  if (args.scope && args.scope !== "all") {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const entities = await assertScopeAuthorized(ctx, membership, args.scope);
    for (const entity of entities) await requireWorkspaceRole(ctx, entity.workspaceId, "member");
    return { entities, isPortfolioScope: false };
  }
  const entity = await getActiveEntity(ctx, args.entityId);
  return { entities: entity ? [entity] : [], isPortfolioScope: false };
}

type CategoryRow = {
  id: string;
  number: string;
  name: string;
  totalMinor: number;
  txnCount: number;
  sharePct: number;
  previousMinor: number;
  deltaPct: number | null;
  isNew: boolean;
  // Provenance: "payroll" marks the Payroll Expense (5000) category so the UI
  // can render it as a payroll line (and never double-count it against a
  // bill/vendor line). Plain expense categories carry no source. (E10-T4)
  source?: "payroll";
  vendors: Array<{ id: string; name: string; note: string; totalMinor: number }>;
};

type RecurringRow = {
  vendor: string;
  category: string;
  cadence: "Monthly" | "Weekly";
  nextDate: string;
  averageMinor: number;
  occurrences: number;
};

/**
 * One expense transaction, as the Expenses "Transactions" tab presents it. This
 * is a LENS row, not a separate record: `id` is the underlying transaction's
 * `_id`, so a row drills into the SAME record via /transactions?focus=<id>. The
 * outflow amount is stored positive in `amountMinor` (cost magnitude); tone is
 * always neutral on the client because ordinary expenses are never alarm-red.
 */
type ExpenseTxnRow = {
  id: string;
  date: string;
  merchant: string;
  categoryAccountId: string | null;
  categoryName: string;
  accountName: string;
  amountMinor: number;
  currency: string;
  review: Doc<"transactions">["review"];
  hasReceipt: boolean;
  uncategorized: boolean;
};

type VendorRow = {
  id: string;
  name: string;
  totalMinor: number;
  txnCount: number;
  topCategory: string;
  recurring: boolean;
};

/**
 * Payroll surfaced as a first-class expense group (E10-T4). Derived from the
 * ledger lines posted to the Payroll Expense account (5000) inside the period —
 * NOT from payroll run face values — so it reconciles to the Reports Payroll
 * Summary base total for the same range. `source: "payroll"` is the provenance
 * tag that keeps this line from ever being double-counted against a bill/vendor
 * line, and `runIds` lets the UI click through to the underlying run(s).
 */
type PayrollGroup = {
  accountId: string | null;
  number: string;
  name: string;
  source: "payroll";
  baseMinor: number;
  runIds: string[];
  runCount: number;
};

type EvidenceRow = {
  id: string;
  date: string;
  merchant: string;
  categoryName: string;
  amountMinor: number;
  currency: string;
};

/**
 * Sum expense-account journal lines per account within [start, end], using the
 * SAME convention as the report pack (expense amount = debit − credit). This is
 * what makes Expenses category totals reconcile to the P&L expense section.
 */
function categoryTotals(
  lines: Doc<"journalLines">[],
  entriesById: Map<Id<"journalEntries">, Doc<"journalEntries">>,
  expenseAccountIds: Set<Id<"ledgerAccounts">>,
  start: string,
  end: string,
) {
  const totals = new Map<Id<"ledgerAccounts">, { totalMinor: number; entryIds: Set<Id<"journalEntries">> }>();
  for (const line of lines) {
    if (!expenseAccountIds.has(line.accountId)) continue;
    const entry = entriesById.get(line.entryId);
    if (!entry || entry.date < start || entry.date > end) continue;
    const current = totals.get(line.accountId) ?? { totalMinor: 0, entryIds: new Set<Id<"journalEntries">>() };
    current.totalMinor += line.debitMinor - line.creditMinor;
    current.entryIds.add(line.entryId);
    totals.set(line.accountId, current);
  }
  return totals;
}

/**
 * Recurring detection over the trailing 6 months of outgoing transactions:
 * group by merchant, require >= 3 occurrences with similar amounts (within
 * ±10% of the median) and a regular cadence (monthly 26–35d or weekly 6–8d),
 * then project the next expected date.
 */
function detectRecurring(
  transactions: Doc<"transactions">[],
  accountsById: Map<Id<"ledgerAccounts">, Doc<"ledgerAccounts">>,
): RecurringRow[] {
  const windowStart = shiftMonth(`${TODAY.slice(0, 7)}-01`, -6);
  const byMerchant = new Map<string, Doc<"transactions">[]>();
  for (const txn of transactions) {
    if (txn.amountMinor >= 0 || txn.date < windowStart || txn.review === "excluded") continue;
    const key = txn.merchant.trim().toLowerCase();
    const rows = byMerchant.get(key) ?? [];
    rows.push(txn);
    byMerchant.set(key, rows);
  }

  const recurring: RecurringRow[] = [];
  for (const rows of byMerchant.values()) {
    if (rows.length < 3) continue;
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const amounts = sorted.map((row) => Math.abs(row.amountMinor)).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    // Amount consistency: most occurrences within ±10% of the median.
    const consistent = sorted.filter((row) => Math.abs(Math.abs(row.amountMinor) - median) <= median * 0.1);
    if (consistent.length < 3) continue;

    // Cadence: average gap between consecutive occurrences.
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      gaps.push(dateDiffDays(sorted[i].date, sorted[i - 1].date));
    }
    const avgGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    let cadence: "Monthly" | "Weekly" | null = null;
    if (avgGap >= 26 && avgGap <= 35) cadence = "Monthly";
    else if (avgGap >= 6 && avgGap <= 8) cadence = "Weekly";
    if (!cadence) continue;

    const last = sorted[sorted.length - 1];
    const nextDate = (() => {
      const base = new Date(`${last.date}T00:00:00Z`);
      base.setUTCDate(base.getUTCDate() + Math.round(avgGap));
      return base.toISOString().slice(0, 10);
    })();
    const account = last.categoryAccountId ? accountsById.get(last.categoryAccountId) : null;
    recurring.push({
      vendor: last.merchant,
      category: account?.name ?? "Uncategorized",
      cadence,
      nextDate,
      averageMinor: Math.round(consistent.reduce((sum, row) => sum + Math.abs(row.amountMinor), 0) / consistent.length),
      occurrences: sorted.length,
    });
  }
  return recurring.sort((a, b) => b.averageMinor - a.averageMinor);
}

const EMPTY = {
  entity: null,
  period: "this" as PeriodId,
  periods: Object.entries(PERIODS).map(([id, value]) => ({ id, label: value.label })),
  kpis: {
    spentMinor: 0,
    spentLabel: "Spent",
    deltaPct: null as number | null,
    recurringMonthlyMinor: 0,
    recurringSharePct: 0,
    biggestMoverName: "",
    biggestMoverDeltaPct: null as number | null,
    uncategorizedCount: 0,
    missingEvidenceCount: 0,
    topVendorName: "",
    topVendorMinor: 0,
  },
  categories: [] as CategoryRow[],
  payroll: null as PayrollGroup | null,
  totalMinor: 0,
  recurring: [] as RecurringRow[],
  recurringTrend: [] as number[],
  transactions: [] as ExpenseTxnRow[],
  vendors: [] as VendorRow[],
  evidenceNeeded: [] as EvidenceRow[],
};

export const overview = query({
  args: {
    entityId: v.optional(v.id("entities")),
    scope: v.optional(scopeValidator),
    period: v.optional(v.union(v.literal("this"), v.literal("last"))),
  },
  handler: async (ctx, args) => {
    const { entities, isPortfolioScope } = await resolveExpenseEntities(ctx, args);
    if (entities.length === 0) return EMPTY;
    const orderedEntities = entities
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id));
    const entity = orderedEntities[0]!;
    const entityIds = orderedEntities.map((scopedEntity) => scopedEntity._id);
    const periodId: PeriodId = args.period ?? "this";
    const period = PERIODS[periodId];
    const prevStart = shiftMonth(period.start, -1);
    const prevEnd = monthEnd(prevStart);

    const [accountGroups, entryGroups, lineGroups, transactionGroups, contactGroups, documentGroups, bankAccountGroups, payrollRunGroups] = await Promise.all([
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(500),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("journalEntries").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(5000),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(5000),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(5000),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("contacts").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(2000),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("documents").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(5000),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("bankAccounts").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(200),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("payrollRuns").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(500),
      )),
    ]);
    const accounts = accountGroups.flat();
    const entries = entryGroups.flat();
    const lines = lineGroups.flat();
    const transactions = transactionGroups.flat();
    const contacts = contactGroups.flat();
    const documents = documentGroups.flat();
    const bankAccounts = bankAccountGroups.flat();
    const payrollRuns = payrollRunGroups.flat();

    const accountsById = new Map(accounts.map((account) => [account._id, account]));
    const entriesById = new Map(entries.map((entry) => [entry._id, entry]));
    const contactsById = new Map(contacts.map((contact) => [contact._id, contact]));
    const expenseAccountIds = new Set(accounts.filter((account) => account.type === "expense").map((account) => account._id));
    // The Payroll Expense (5000) account — payroll surfaces here as a first-class,
    // provenance-tagged expense group (E10-T4).
    const payrollAccount = accounts.find((account) => account.number === PAYROLL_EXPENSE_NUMBER) ?? null;

    const current = categoryTotals(lines, entriesById, expenseAccountIds, period.start, period.end);
    const previous = categoryTotals(lines, entriesById, expenseAccountIds, prevStart, prevEnd);

    const totalMinor = [...current.values()].reduce((sum, row) => sum + row.totalMinor, 0);

    // Vendor breakdown per category, from transactions tagged to the account in
    // the period (best-effort — categories whose spend has no transaction row,
    // e.g. payroll accruals, simply show fewer vendor lines).
    const vendorByAccount = new Map<Id<"ledgerAccounts">, Map<string, { name: string; totalMinor: number }>>();
    for (const txn of transactions) {
      if (!txn.categoryAccountId || !expenseAccountIds.has(txn.categoryAccountId)) continue;
      if (txn.date < period.start || txn.date > period.end) continue;
      const vendors = vendorByAccount.get(txn.categoryAccountId) ?? new Map();
      const name = (txn.contactId ? contactsById.get(txn.contactId)?.name : null) ?? txn.merchant;
      const row = vendors.get(name) ?? { name, totalMinor: 0 };
      row.totalMinor += Math.abs(txn.amountMinor);
      vendors.set(name, row);
      vendorByAccount.set(txn.categoryAccountId, vendors);
    }

    const categories: CategoryRow[] = [...current.entries()]
      .map(([accountId, value]) => {
        const account = accountsById.get(accountId)!;
        const previousMinor = previous.get(accountId)?.totalMinor ?? 0;
        const deltaPct = previousMinor > 0 ? Math.round(((value.totalMinor - previousMinor) / previousMinor) * 100) : null;
        const vendors = [...(vendorByAccount.get(accountId)?.values() ?? [])]
          .sort((a, b) => b.totalMinor - a.totalMinor)
          .slice(0, 6)
          .map((vendor) => ({ id: vendor.name, name: vendor.name, note: "", totalMinor: vendor.totalMinor }));
        return {
          id: accountId,
          number: account.number,
          name: account.name,
          totalMinor: value.totalMinor,
          txnCount: value.entryIds.size,
          sharePct: totalMinor > 0 ? Math.round((value.totalMinor / totalMinor) * 100) : 0,
          previousMinor,
          deltaPct,
          isNew: previousMinor === 0 && value.totalMinor > 0,
          // Provenance: the payroll account's spend comes from approved runs, not
          // vendor bills (E10-T4).
          source: payrollAccount && accountId === payrollAccount._id ? ("payroll" as const) : undefined,
          vendors,
        };
      })
      .filter((row) => row.totalMinor !== 0)
      .sort((a, b) => b.totalMinor - a.totalMinor);

    // E10-T4: payroll as a first-class expense group, sourced from the ledger
    // lines posted to account 5000 in the period (base currency) — the SAME
    // figure the Reports Payroll Summary derives from approved runs, so the two
    // lenses reconcile. Linked to the run(s) whose period falls in the window so
    // a click can open Payroll. Null when the entity has no payroll account.
    const payrollGroup: PayrollGroup | null = (() => {
      if (!payrollAccount) return null;
      const baseMinor = current.get(payrollAccount._id)?.totalMinor ?? 0;
      const periodStartMonth = period.start.slice(0, 7);
      const periodEndMonth = period.end.slice(0, 7);
      const runIds = payrollRuns
        .filter((run) => run.period >= periodStartMonth && run.period <= periodEndMonth)
        .map((run) => run._id as string);
      return {
        accountId: payrollAccount._id as string,
        number: payrollAccount.number,
        name: payrollAccount.name,
        source: "payroll" as const,
        baseMinor,
        runIds,
        runCount: runIds.length,
      };
    })();

    const recurring = detectRecurring(transactions, accountsById);
    const recurringMonthlyMinor = recurring
      .filter((row) => row.cadence === "Monthly")
      .reduce((sum, row) => sum + row.averageMinor, 0);

    // Biggest mover: category with the largest absolute MoM delta percentage
    // (only where a prior-period baseline exists).
    const movers = categories.filter((row) => row.deltaPct !== null);
    const biggestMover = movers.sort((a, b) => Math.abs(b.deltaPct!) - Math.abs(a.deltaPct!))[0] ?? null;

    const previousTotalMinor = [...previous.values()].reduce((sum, row) => sum + row.totalMinor, 0);
    const spentDeltaPct = previousTotalMinor > 0 ? Math.round(((totalMinor - previousTotalMinor) / previousTotalMinor) * 100) : null;

    // Receipts matched to a transaction — the evidence index. A receipt is
    // "attached" when a document of kind "receipt" points at the transaction.
    const receiptTxnIds = new Set<Id<"transactions">>();
    for (const doc of documents) {
      if (doc.kind === "receipt" && doc.matchedTransactionId) {
        receiptTxnIds.add(doc.matchedTransactionId);
      }
    }

    // The Expenses "Transactions" tab: the expense subset of the universal
    // register within the period. An expense row is an outflow (amount < 0)
    // tagged to an expense account, OR an uncategorized outflow that still needs
    // a cost category. These are the SAME transaction docs Transactions edits —
    // never a parallel store — so `id` drills into /transactions?focus=<id>.
    const expenseTxns = transactions.filter((txn) => {
      if (txn.review === "excluded") return false;
      if (isLikelyInternalTransfer(txn)) return false;
      if (txn.date < period.start || txn.date > period.end) return false;
      if (txn.amountMinor >= 0) return false;
      const tagged = txn.categoryAccountId ? expenseAccountIds.has(txn.categoryAccountId) : false;
      const uncategorizedOutflow = !txn.categoryAccountId;
      return tagged || uncategorizedOutflow;
    });

    const bankLedgerByAccount = new Map<Id<"bankAccounts">, string>(
      bankAccounts.map((account) => [account._id, account.name]),
    );
    const expenseRows: ExpenseTxnRow[] = expenseTxns
      .map((txn) => {
        const category = txn.categoryAccountId ? accountsById.get(txn.categoryAccountId) : null;
        const uncategorized = !category;
        return {
          id: txn._id as string,
          date: txn.date,
          merchant: (txn.contactId ? contactsById.get(txn.contactId)?.name : null) ?? txn.merchant,
          categoryAccountId: (category?._id as string) ?? null,
          categoryName: category?.name ?? "Uncategorized",
          accountName: txn.bankAccountId ? (bankLedgerByAccount.get(txn.bankAccountId) ?? "Bank") : "Bank",
          amountMinor: Math.abs(txn.amountMinor),
          currency: txn.currency || (isPortfolioScope ? "USD" : entity.currency),
          review: txn.review,
          hasReceipt: receiptTxnIds.has(txn._id),
          uncategorized,
        };
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.amountMinor - a.amountMinor));

    const uncategorizedCount = expenseRows.filter((row) => row.uncategorized).length;
    const missingEvidenceCount = expenseRows.filter((row) => !row.hasReceipt).length;

    // Vendor ranking for the Vendors tab: aggregate the period's expense rows by
    // merchant, carrying spend, count, dominant category, and a recurring flag.
    const recurringVendorKeys = new Set(recurring.map((row) => row.vendor.trim().toLowerCase()));
    const vendorAgg = new Map<
      string,
      { name: string; totalMinor: number; txnCount: number; categories: Map<string, number> }
    >();
    for (const row of expenseRows) {
      const key = row.merchant.trim().toLowerCase();
      const agg = vendorAgg.get(key) ?? { name: row.merchant, totalMinor: 0, txnCount: 0, categories: new Map() };
      agg.totalMinor += row.amountMinor;
      agg.txnCount += 1;
      agg.categories.set(row.categoryName, (agg.categories.get(row.categoryName) ?? 0) + row.amountMinor);
      vendorAgg.set(key, agg);
    }
    const vendors: VendorRow[] = [...vendorAgg.entries()]
      .map(([key, agg]) => {
        const topCategory = [...agg.categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Uncategorized";
        return {
          id: key,
          name: agg.name,
          totalMinor: agg.totalMinor,
          txnCount: agg.txnCount,
          topCategory,
          recurring: recurringVendorKeys.has(key),
        };
      })
      .sort((a, b) => b.totalMinor - a.totalMinor);

    const topVendor = vendors[0] ?? null;

    // Evidence-needed: expense rows in the period with no matched receipt.
    const evidenceNeeded: EvidenceRow[] = expenseRows
      .filter((row) => !row.hasReceipt)
      .map((row) => ({
        id: row.id,
        date: row.date,
        merchant: row.merchant,
        categoryName: row.categoryName,
        amountMinor: row.amountMinor,
        currency: row.currency,
      }));

    // Recurring trend: total monthly recurring (Monthly-cadence) outflow over the
    // trailing 6 months, so the Recurring tab can show the predictable-spend line.
    const trendStart = shiftMonth(`${period.start.slice(0, 7)}-01`, -5);
    const trendBuckets = new Map<string, number>();
    for (let i = 0; i < 6; i += 1) {
      trendBuckets.set(shiftMonth(trendStart, i).slice(0, 7), 0);
    }
    const recurringMerchantKeys = new Set(
      recurring.filter((row) => row.cadence === "Monthly").map((row) => row.vendor.trim().toLowerCase()),
    );
    for (const txn of transactions) {
      if (txn.amountMinor >= 0 || txn.review === "excluded") continue;
      const month = txn.date.slice(0, 7);
      if (!trendBuckets.has(month)) continue;
      if (!recurringMerchantKeys.has(txn.merchant.trim().toLowerCase())) continue;
      trendBuckets.set(month, (trendBuckets.get(month) ?? 0) + Math.abs(txn.amountMinor));
    }
    const recurringTrend = [...trendBuckets.values()];

    return {
      entity: {
        id: entity._id,
        name: isPortfolioScope ? "All businesses" : entity.name,
        currency: isPortfolioScope ? "USD" : entity.currency,
        isDemo: isPortfolioScope ? false : entity.isDemo,
      },
      period: periodId,
      periods: Object.entries(PERIODS).map(([id, value]) => ({ id, label: value.label })),
      kpis: {
        spentMinor: totalMinor,
        spentLabel: `Spent · ${period.start.slice(0, 7)}`,
        deltaPct: spentDeltaPct,
        recurringMonthlyMinor,
        recurringSharePct: totalMinor > 0 ? Math.min(100, Math.round((recurringMonthlyMinor / totalMinor) * 100)) : 0,
        biggestMoverName: biggestMover?.name ?? "",
        biggestMoverDeltaPct: biggestMover?.deltaPct ?? null,
        uncategorizedCount,
        missingEvidenceCount,
        topVendorName: topVendor?.name ?? "",
        topVendorMinor: topVendor?.totalMinor ?? 0,
      },
      categories,
      payroll: payrollGroup,
      totalMinor,
      recurring,
      recurringTrend,
      transactions: expenseRows,
      vendors,
      evidenceNeeded,
    };
  },
});
