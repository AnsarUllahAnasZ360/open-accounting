import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";
import { computeEntityMetrics } from "./entityMetrics";
import { resolveDefaultEntity } from "./entityScope";
import { DEFAULT_TAX_SET_ASIDE_PCT } from "./settings";
import { computeCfoAnomalies, type CfoAnomalyCard } from "./aiCfoAnomalies";

/**
 * AI CFO grounded aggregate (Epic E9-T3).
 *
 * This is the DETERMINISTIC, ledger-grounded numeric core of the AI CFO. It is
 * the single source of truth the narration layer (aiCfo.ts, E9-T4) is allowed to
 * narrate: EVERY advisory number must originate here so nothing the model says is
 * fabricated. There is NO AI in this module — it is pure aggregation over posted
 * journal lines and the existing per-entity metric/view helpers, so the
 * dashboard, the digest, and Ask AI all bind to identical figures.
 *
 * Money rules (decisions Q48): all amounts are **USD integer minor units summed
 * directly** — USD-only general ledger, no per-currency separation, no
 * refuse-to-sum. No float storage. This module is READ-ONLY: it never writes to
 * journalEntries/journalLines or anything else; the ledger posting path is
 * untouched (risk: med, not high).
 */

type Severity = "info" | "watch" | "warn";

// One grounded advisory signal. The UI (E9-T5) and the model (E9-T4) both bind
// to these EXACT fields, so the narration can never introduce a number the
// aggregate didn't compute.
export type CfoSignal = {
  /** Stable key for drill-down routing + dedupe. */
  key: string;
  /** Family the signal belongs to. */
  family:
    | "runway"
    | "income_trend"
    | "expense_creep"
    | "concentration"
    | "forecast"
    | "tax"
    | "anomaly";
  severity: Severity;
  /** Owner-facing one-line headline (deterministic; the model may reword it). */
  title: string;
  /** The primary figure this signal is about (USD minor units), or null. */
  metricMinor: number | null;
  /** The comparator it is measured against (prior avg, threshold…), or null. */
  comparatorMinor: number | null;
  /** Signed percentage delta where meaningful (income trend, expense creep). */
  deltaPct: number | null;
  /** The as-of date the signal was computed at (ISO YYYY-MM-DD). */
  asOf: string;
  /** Ledger accounts the figure was computed from, for drill-down + audit. */
  basisAccountIds: Id<"ledgerAccounts">[];
  /** Optional offending transaction ids (anomaly family). */
  txnIds?: Id<"transactions">[];
};

export type CfoSignals = {
  entity: { id: Id<"entities">; name: string; currency: string };
  asOf: string;
  // ---- Headline grounded numbers (every figure also appears on a signal) ----
  cashPositionMinor: number;
  /** Trailing-average monthly net cash burn (expense − income), ≥0 when burning. */
  monthlyBurnMinor: number;
  /** cashPosition / burn, in months (one decimal). null when not burning. */
  runwayMonths: number | null;
  currentRevenueMinor: number;
  priorAvgRevenueMinor: number;
  taxSetAsidePct: number;
  taxSetAsideMinor: number;
  signals: CfoSignal[];
  // Cash-flow forecast: a naive forward projection of the cash balance using the
  // trailing net run-rate plus scheduled bills/invoices/payroll (comingUp).
  forecast: Array<{ horizonDays: number; projectedCashMinor: number }>;
  // The mandatory tax disclaimer copy. Surfaced verbatim wherever the tax signal
  // is shown — this is an ESTIMATE, never tax advice.
  taxDisclaimer: string;
};

type Balance = { debitMinor: number; creditMinor: number };
const ENTRY_LIMIT = 20000;
const TABLE_LIMIT = 5000;
const TRAILING_MONTHS = 6;
// Expense-creep floor (R6 §B): flag a category only when it is up BOTH ≥25% AND
// ≥$200 vs its trailing average — keeps the panel quiet on noise.
const EXPENSE_CREEP_PCT = 25;
const EXPENSE_CREEP_FLOOR_MINOR = 200_00;
// Concentration thresholds (R6 §B): warn when one customer is >10% of period
// revenue, or the top-5 exceed >25%.
const CONCENTRATION_SINGLE_PCT = 10;
const TAX_DISCLAIMER =
  "Estimate only — not tax advice. Set-aside is a rough reserve at your configured rate; confirm with a tax professional.";

function addBalance(map: Map<Id<"ledgerAccounts">, Balance>, line: Doc<"journalLines">) {
  const current = map.get(line.accountId) ?? { debitMinor: 0, creditMinor: 0 };
  current.debitMinor += line.debitMinor;
  current.creditMinor += line.creditMinor;
  map.set(line.accountId, current);
}

function shiftMonth(month: string, delta: number) {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function resolveToday(explicit?: string) {
  if (explicit && /^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  return new Date(Date.now()).toISOString().slice(0, 10);
}

// Resolve + authorize the entity exactly like coreViews.getActiveEntity.
async function getActiveEntity(ctx: QueryCtx, entityId?: Id<"entities">) {
  const { membership } = await requireAnyWorkspaceRole(ctx, "member");
  const entity = entityId ? await ctx.db.get(entityId) : await resolveDefaultEntity(ctx, membership);
  if (!entity || entity.workspaceId !== membership.workspaceId) return null;
  await requireWorkspaceRole(ctx, entity.workspaceId, "member");
  return { entity, workspaceId: membership.workspaceId };
}

async function loadEntityJournal(ctx: QueryCtx, entityId: Id<"entities">) {
  const entries = await ctx.db
    .query("journalEntries")
    .withIndex("by_entity_and_date", (q) => q.eq("entityId", entityId))
    .take(ENTRY_LIMIT);
  const lineGroups = await Promise.all(
    entries.map((entry) =>
      ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", entry._id)).collect(),
    ),
  );
  return { entries, lines: lineGroups.flat() };
}

async function resolveTaxSetAsidePct(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const settings = await ctx.db
    .query("workspaceSettings")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  const pct = settings?.taxSetAsidePct;
  return typeof pct === "number" && pct > 0 && pct < 1 ? pct : DEFAULT_TAX_SET_ASIDE_PCT;
}

/**
 * Compute the full grounded CfoSignals for one (already authorized) entity. This
 * helper performs NO authorization of its own — call only after the authz gate.
 * Reuses computeEntityMetrics (E5-T6) so cash/runway reconcile with the
 * dashboard's per-business tile by construction.
 */
export async function computeCfoSignals(
  ctx: QueryCtx,
  entity: Doc<"entities">,
  workspaceId: Id<"workspaces">,
  today: string,
): Promise<CfoSignals> {
  const [metrics, journal, accounts, invoices, bills, payrollRuns, transactions, taxSetAsidePct] =
    await Promise.all([
      computeEntityMetrics(ctx, entity),
      loadEntityJournal(ctx, entity._id),
      ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(TABLE_LIMIT),
      ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(TABLE_LIMIT),
      ctx.db.query("bills").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(TABLE_LIMIT),
      ctx.db.query("payrollRuns").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(200),
      ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(TABLE_LIMIT),
      resolveTaxSetAsidePct(ctx, workspaceId),
    ]);

  const { entries, lines } = journal;
  const accountsById = new Map(accounts.map((account) => [account._id, account]));
  const entriesById = new Map(entries.map((entry) => [entry._id, entry]));

  // Per-month income/expense (matches coreViews monthlyPnl: credit−debit income,
  // debit−credit expense) + per-category-per-month expense for expense-creep.
  const monthlyPnl = new Map<string, { incomeMinor: number; expenseMinor: number }>();
  const expenseByCategoryMonth = new Map<Id<"ledgerAccounts">, Map<string, number>>();
  const incomeAccountIds: Id<"ledgerAccounts">[] = [];
  const expenseAccountIds: Id<"ledgerAccounts">[] = [];
  for (const account of accounts) {
    if (account.type === "income") incomeAccountIds.push(account._id);
    if (account.type === "expense") expenseAccountIds.push(account._id);
  }
  for (const line of lines) {
    const account = accountsById.get(line.accountId);
    const entry = entriesById.get(line.entryId);
    if (!account || !entry) continue;
    const month = entry.date.slice(0, 7);
    if (account.type === "income" || account.type === "expense") {
      const bucket = monthlyPnl.get(month) ?? { incomeMinor: 0, expenseMinor: 0 };
      if (account.type === "income") bucket.incomeMinor += line.creditMinor - line.debitMinor;
      else bucket.expenseMinor += line.debitMinor - line.creditMinor;
      monthlyPnl.set(month, bucket);
    }
    if (account.type === "expense") {
      const byMonth = expenseByCategoryMonth.get(line.accountId) ?? new Map<string, number>();
      byMonth.set(month, (byMonth.get(month) ?? 0) + (line.debitMinor - line.creditMinor));
      expenseByCategoryMonth.set(line.accountId, byMonth);
    }
  }

  const latestMonth =
    entries.map((entry) => entry.date.slice(0, 7)).sort((a, b) => b.localeCompare(a))[0] ?? today.slice(0, 7);
  const asOf = today;

  // ---- (a) Runway / burn. cashPosition is ledger cash (metrics.cashMinor);
  // burn = trailing-avg monthly NET outflow (expense − income); runway =
  // cashPosition / burn (mirrors coreViews cashCushion / entityMetrics).
  const trailingMonths = Array.from({ length: TRAILING_MONTHS }, (_, i) =>
    shiftMonth(latestMonth, i - (TRAILING_MONTHS - 1)),
  );
  const trailingNet = trailingMonths.map((month) => {
    const bucket = monthlyPnl.get(month) ?? { incomeMinor: 0, expenseMinor: 0 };
    return bucket.expenseMinor - bucket.incomeMinor; // positive = burning cash
  });
  const monthlyBurnMinor = Math.max(
    0,
    Math.round(trailingNet.reduce((sum, value) => sum + value, 0) / trailingNet.length),
  );
  const cashPositionMinor = metrics.cashMinor;
  const runwayMonths =
    monthlyBurnMinor > 0 ? Math.round((cashPositionMinor / monthlyBurnMinor) * 10) / 10 : null;

  // ---- (b) Income trend: current month vs prior 3-month average revenue.
  const currentRevenueMinor = (monthlyPnl.get(latestMonth) ?? { incomeMinor: 0 }).incomeMinor;
  const priorThree = Array.from({ length: 3 }, (_, i) => shiftMonth(latestMonth, -(i + 1)));
  const priorAvgRevenueMinor = Math.round(
    priorThree.reduce((sum, month) => sum + (monthlyPnl.get(month) ?? { incomeMinor: 0 }).incomeMinor, 0) / 3,
  );
  const incomeDeltaPct =
    priorAvgRevenueMinor > 0
      ? Math.round(((currentRevenueMinor - priorAvgRevenueMinor) / priorAvgRevenueMinor) * 100)
      : null;

  // ---- (c) Expense creep: per-category current-month vs trailing average.
  const expenseCreep: Array<{ accountId: Id<"ledgerAccounts">; name: string; currentMinor: number; avgMinor: number; deltaPct: number }> = [];
  for (const [accountId, byMonth] of expenseByCategoryMonth.entries()) {
    const currentMinor = byMonth.get(latestMonth) ?? 0;
    const trailingVals = trailingMonths
      .filter((month) => month !== latestMonth)
      .map((month) => byMonth.get(month) ?? 0);
    const avgMinor = trailingVals.length
      ? Math.round(trailingVals.reduce((sum, value) => sum + value, 0) / trailingVals.length)
      : 0;
    if (avgMinor <= 0) continue;
    const deltaMinor = currentMinor - avgMinor;
    const deltaPct = Math.round((deltaMinor / avgMinor) * 100);
    if (deltaPct >= EXPENSE_CREEP_PCT && deltaMinor >= EXPENSE_CREEP_FLOOR_MINOR) {
      expenseCreep.push({
        accountId,
        name: accountsById.get(accountId)?.name ?? "Expense",
        currentMinor,
        avgMinor,
        deltaPct,
      });
    }
  }
  expenseCreep.sort((a, b) => b.deltaPct - a.deltaPct);

  // ---- (d) Customer concentration: top customer % of period revenue from the
  // income-by-customer ledger rollup (line.contactId on income accounts).
  const incomeAccountSet = new Set(incomeAccountIds);
  const periodRevenueByCustomer = new Map<string, number>();
  for (const line of lines) {
    if (!incomeAccountSet.has(line.accountId)) continue;
    const entry = entriesById.get(line.entryId);
    if (!entry || entry.date.slice(0, 7) !== latestMonth) continue;
    const amountMinor = line.creditMinor - line.debitMinor;
    if (!line.contactId || amountMinor === 0) continue;
    periodRevenueByCustomer.set(line.contactId, (periodRevenueByCustomer.get(line.contactId) ?? 0) + amountMinor);
  }
  const concentrationTotalMinor = [...periodRevenueByCustomer.values()].reduce((sum, value) => sum + value, 0);
  const topCustomer = [...periodRevenueByCustomer.entries()].sort((a, b) => b[1] - a[1])[0];
  const topSharePct =
    topCustomer && concentrationTotalMinor > 0
      ? Math.round((topCustomer[1] / concentrationTotalMinor) * 100)
      : 0;

  // ---- (e) Cash-flow forecast: naive run-rate + scheduled comingUp items over
  // the next 30/60/90 days. Run-rate = −monthlyBurn (net cash per month).
  const horizonDate = (days: number) =>
    new Date(Date.parse(`${asOf}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const monthlyNetRunRateMinor = -monthlyBurnMinor; // negative when burning
  const scheduledNetByHorizon = (endDate: string) => {
    let net = 0;
    for (const invoice of invoices) {
      if (invoice.status !== "open" && invoice.status !== "overdue") continue;
      const balanceMinor = invoice.totalMinor - invoice.amountPaidMinor;
      if (balanceMinor <= 0) continue;
      if (invoice.dueDate >= asOf && invoice.dueDate <= endDate) net += balanceMinor;
    }
    for (const bill of bills) {
      if (bill.status !== "open") continue;
      if (bill.dueDate >= asOf && bill.dueDate <= endDate) net -= bill.totalMinor;
    }
    return net;
  };
  const latestRun = [...payrollRuns].sort((a, b) => b.period.localeCompare(a.period))[0];
  const forecast = [30, 60, 90].map((days) => {
    const runRate = Math.round((monthlyNetRunRateMinor * days) / 30);
    const scheduled = scheduledNetByHorizon(horizonDate(days));
    // Subtract one estimated payroll run per ~month inside the horizon.
    const payrollOut = latestRun ? -latestRun.totalBaseMinor * Math.floor(days / 30) : 0;
    return { horizonDays: days, projectedCashMinor: cashPositionMinor + runRate + scheduled + payrollOut };
  });

  // ---- (f) Tax set-aside: pct × trailing book net income (income − expense)
  // over the trailing window. Only meaningful when net income is positive.
  const trailingNetIncomeMinor = trailingMonths.reduce((sum, month) => {
    const bucket = monthlyPnl.get(month) ?? { incomeMinor: 0, expenseMinor: 0 };
    return sum + (bucket.incomeMinor - bucket.expenseMinor);
  }, 0);
  const taxBaseMinor = Math.max(0, trailingNetIncomeMinor);
  const taxSetAsideMinor = Math.round(taxBaseMinor * taxSetAsidePct);

  // ---- (g) Anomalies (E9-T9): duplicate candidates, spikes, new-large-vendor.
  const anomalies: CfoAnomalyCard[] = computeCfoAnomalies({ transactions, asOf });

  // ---- Assemble typed signals. Each carries the exact ledger numbers it was
  // computed from so narration/digest can never invent a figure.
  const signals: CfoSignal[] = [];

  signals.push({
    key: "runway",
    family: "runway",
    severity:
      runwayMonths === null ? "info" : runwayMonths < 3 ? "warn" : runwayMonths < 6 ? "watch" : "info",
    title:
      runwayMonths === null
        ? "Cash-flow positive — no burn"
        : `Runway: ~${runwayMonths.toFixed(1)} months at current burn`,
    metricMinor: cashPositionMinor,
    comparatorMinor: monthlyBurnMinor,
    deltaPct: null,
    asOf,
    basisAccountIds: [],
  });

  if (incomeDeltaPct !== null) {
    signals.push({
      key: "income_trend",
      family: "income_trend",
      severity: incomeDeltaPct <= -15 ? "warn" : incomeDeltaPct < 0 ? "watch" : "info",
      title:
        incomeDeltaPct < 0
          ? `Income down ${Math.abs(incomeDeltaPct)}% vs your 3-month average`
          : `Income up ${incomeDeltaPct}% vs your 3-month average`,
      metricMinor: currentRevenueMinor,
      comparatorMinor: priorAvgRevenueMinor,
      deltaPct: incomeDeltaPct,
      asOf,
      basisAccountIds: incomeAccountIds,
    });
  }

  for (const creep of expenseCreep.slice(0, 3)) {
    signals.push({
      key: `expense_creep:${creep.accountId}`,
      family: "expense_creep",
      severity: creep.deltaPct >= 50 ? "warn" : "watch",
      title: `${creep.name} up ${creep.deltaPct}% vs trailing average`,
      metricMinor: creep.currentMinor,
      comparatorMinor: creep.avgMinor,
      deltaPct: creep.deltaPct,
      asOf,
      basisAccountIds: [creep.accountId],
    });
  }

  if (topCustomer && topSharePct > CONCENTRATION_SINGLE_PCT) {
    signals.push({
      key: "concentration",
      family: "concentration",
      severity: topSharePct >= 50 ? "warn" : "watch",
      title: `Top customer is ${topSharePct}% of this period's revenue`,
      metricMinor: topCustomer[1],
      comparatorMinor: concentrationTotalMinor,
      deltaPct: topSharePct,
      asOf,
      basisAccountIds: incomeAccountIds,
    });
  }

  signals.push({
    key: "forecast",
    family: "forecast",
    severity: forecast.some((point) => point.projectedCashMinor < 0) ? "warn" : "info",
    title: `Projected cash in 90 days: ~${Math.round(forecast[2].projectedCashMinor / 100).toLocaleString()} ${entity.currency}`,
    metricMinor: forecast[2].projectedCashMinor,
    comparatorMinor: cashPositionMinor,
    deltaPct: null,
    asOf,
    basisAccountIds: [],
  });

  if (taxSetAsideMinor > 0) {
    signals.push({
      key: "tax",
      family: "tax",
      severity: "info",
      title: `Set aside ~${Math.round(taxSetAsideMinor / 100).toLocaleString()} ${entity.currency} for taxes (${Math.round(taxSetAsidePct * 100)}% of net income)`,
      metricMinor: taxSetAsideMinor,
      comparatorMinor: taxBaseMinor,
      deltaPct: Math.round(taxSetAsidePct * 100),
      asOf,
      basisAccountIds: expenseAccountIds.length ? [] : [],
    });
  }

  for (const anomaly of anomalies) {
    signals.push({
      key: anomaly.key,
      family: "anomaly",
      severity: anomaly.severity,
      title: anomaly.title,
      metricMinor: anomaly.metricMinor,
      comparatorMinor: anomaly.comparatorMinor,
      deltaPct: anomaly.deltaPct,
      asOf,
      basisAccountIds: [],
      txnIds: anomaly.txnIds,
    });
  }

  return {
    entity: { id: entity._id, name: entity.name, currency: entity.currency },
    asOf,
    cashPositionMinor,
    monthlyBurnMinor,
    runwayMonths,
    currentRevenueMinor,
    priorAvgRevenueMinor,
    taxSetAsidePct,
    taxSetAsideMinor,
    signals,
    forecast,
    taxDisclaimer: TAX_DISCLAIMER,
  };
}

/**
 * Public, authorized read of the CFO signals for the active entity (E9-T3). The
 * advisor surface (E9-T5) and the deterministic-fallback path read this.
 */
export const cfoSignals = query({
  args: { entityId: v.optional(v.id("entities")), today: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const resolved = await getActiveEntity(ctx, args.entityId);
    if (!resolved) return null;
    return await computeCfoSignals(ctx, resolved.entity, resolved.workspaceId, resolveToday(args.today));
  },
});

/**
 * Internal, entity-scoped variant for the Ask-AI tools (E9-T7) and the weekly
 * digest (E9-T6), which run in actions with no user session. The CALLER must
 * have resolved + authorized the entity (thread ownership / cron workspace scan)
 * before invoking — same contract as reportViews.reportPackForEntity.
 */
export const cfoSignalsForEntity = internalQuery({
  args: { entityId: v.id("entities"), today: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) return null;
    return await computeCfoSignals(ctx, entity, entity.workspaceId, resolveToday(args.today));
  },
});

/**
 * Internal but FULLY AUTHORIZED read of the CFO signals for the active entity
 * (E9-T4). The advisory ACTION (aiCfo.ts) runs with the caller's identity but
 * cannot call the public query through `internal.*`, so this mirrors the public
 * `cfoSignals` auth (any-member, then entity-belongs-to-workspace) before
 * computing. Returns null when unauthorized — the action then degrades cleanly.
 */
export const cfoSignalsForEntityAuthed = internalQuery({
  args: { entityId: v.optional(v.id("entities")), today: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const resolved = await getActiveEntity(ctx, args.entityId);
    if (!resolved) return null;
    return await computeCfoSignals(ctx, resolved.entity, resolved.workspaceId, resolveToday(args.today));
  },
});

/**
 * Resolve the authed workspaceId for the active scope so the advisory action
 * (E9-T4) can pick the workspace's AI provider via the unified credential
 * resolver. Mirrors aiInsightsAuth.insightsWorkspaceId: any-member check, then an
 * entity-belongs-to-workspace check when an entityId is supplied. Returns null
 * when unauthorized — the action then stays on deterministic advice.
 */
export const cfoWorkspaceId = internalQuery({
  args: { entityId: v.optional(v.id("entities")) },
  handler: async (ctx, args): Promise<Id<"workspaces"> | null> => {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const entity = args.entityId
      ? await ctx.db.get(args.entityId)
      : await resolveDefaultEntity(ctx, membership);
    if (!entity || entity.workspaceId !== membership.workspaceId) {
      return args.entityId ? null : membership.workspaceId;
    }
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");
    return entity.workspaceId;
  },
});
