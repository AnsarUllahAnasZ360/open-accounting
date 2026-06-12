import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";

const TODAY = "2026-06-11";

// Period presets, computed against the demo "today". `this` = month-to-date
// (Jun 1–11 2026); `last` = the full prior month (May 2026). Mirrors the
// Expenses prototype's two-segment period control.
const PERIODS = {
  this: { start: "2026-06-01", end: TODAY, label: "This month" },
  last: { start: "2026-05-01", end: "2026-05-31", label: "Last month" },
} as const;
type PeriodId = keyof typeof PERIODS;

async function getActiveEntity(ctx: QueryCtx, entityId?: Id<"entities">) {
  const { membership } = await requireAnyWorkspaceRole(ctx, "member");
  const entity = entityId
    ? await ctx.db.get(entityId)
    : (await ctx.db
        .query("entities")
        .withIndex("by_workspace_and_slug", (q) =>
          q.eq("workspaceId", membership.workspaceId).eq("slug", "acme-studio-llc"),
        )
        .unique()) ??
      (await ctx.db
        .query("entities")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
        .first());
  if (!entity || entity.workspaceId !== membership.workspaceId) return null;
  await requireWorkspaceRole(ctx, entity.workspaceId, "member");
  return entity;
}

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
  },
  categories: [] as CategoryRow[],
  totalMinor: 0,
  recurring: [] as RecurringRow[],
};

export const overview = query({
  args: {
    entityId: v.optional(v.id("entities")),
    period: v.optional(v.union(v.literal("this"), v.literal("last"))),
  },
  handler: async (ctx, args) => {
    const entity = await getActiveEntity(ctx, args.entityId);
    if (!entity) return EMPTY;
    const periodId: PeriodId = args.period ?? "this";
    const period = PERIODS[periodId];
    const prevStart = shiftMonth(period.start, -1);
    const prevEnd = monthEnd(prevStart);

    const [accounts, entries, lines, transactions, contacts] = await Promise.all([
      ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(500),
      ctx.db.query("journalEntries").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(5000),
      ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(5000),
      ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(5000),
      ctx.db.query("contacts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
    ]);

    const accountsById = new Map(accounts.map((account) => [account._id, account]));
    const entriesById = new Map(entries.map((entry) => [entry._id, entry]));
    const contactsById = new Map(contacts.map((contact) => [contact._id, contact]));
    const expenseAccountIds = new Set(accounts.filter((account) => account.type === "expense").map((account) => account._id));

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
          vendors,
        };
      })
      .filter((row) => row.totalMinor !== 0)
      .sort((a, b) => b.totalMinor - a.totalMinor);

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

    return {
      entity: { id: entity._id, name: entity.name, currency: entity.currency, isDemo: entity.isDemo },
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
      },
      categories,
      totalMinor,
      recurring,
    };
  },
});
