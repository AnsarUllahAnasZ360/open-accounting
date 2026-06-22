import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { computeCfoSignals, type CfoSignal } from "./aiCfoAggregate";

/**
 * Weekly digest data layer (Epic E9-T6) — the V8 (non-Node) queries and the
 * idempotency mutation backing the Node send action in weeklyDigest.ts.
 *
 * Combined PORTFOLIO digest (decisions Q47): a multi-entity workspace gets ONE
 * email rolling up ALL active entities, summed in USD. Intercompany is eliminated
 * BY CONSTRUCTION: the rolled-up P&L numbers come only from income/expense
 * journal lines, and intercompany legs post to balance-sheet reciprocals
 * (1300/2300), never to income/expense — so they never enter these totals.
 *
 * All numbers reuse the SAME grounded aggregate (E9-T3) the dashboard and Ask AI
 * bind to, so the email can never disagree with the app. Money is USD integer
 * minor units summed directly; formatting is display-only.
 */

const ENTRY_LIMIT = 20000;
const TABLE_LIMIT = 5000;

export type DigestDelta = { currentMinor: number; priorMinor: number; deltaPct: number | null };

export type DigestComposition = {
  workspaceId: Id<"workspaces">;
  workspaceName: string;
  recipient: string | null;
  digestEnabled: boolean;
  entityCount: number;
  asOf: string;
  currency: "USD";
  revenue: DigestDelta;
  expense: DigestDelta;
  profit: DigestDelta;
  cashPositionMinor: number;
  runwayMonths: number | null;
  // Top 3 advisory cards (deterministic, grounded) for the email body.
  topCards: Array<{ title: string; severity: CfoSignal["severity"]; body: string }>;
};

function pctDelta(currentMinor: number, priorMinor: number): number | null {
  if (priorMinor === 0) return null;
  return Math.round(((currentMinor - priorMinor) / Math.abs(priorMinor)) * 100);
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

// Per-entity current/prior month income & expense, summed in USD. Mirrors the
// monthlyPnl math in aiCfoAggregate (income = credit−debit; expense = debit−credit).
async function entityMonthlyPnl(
  ctx: QueryCtx,
  entity: Doc<"entities">,
  currentMonth: string,
  priorMonth: string,
) {
  const [entries, accounts] = await Promise.all([
    ctx.db.query("journalEntries").withIndex("by_entity_and_date", (q) => q.eq("entityId", entity._id)).take(ENTRY_LIMIT),
    ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(TABLE_LIMIT),
  ]);
  const accountType = new Map(accounts.map((account) => [account._id, account.type]));
  const entryMonth = new Map(entries.map((entry) => [entry._id, entry.date.slice(0, 7)]));
  const lineGroups = await Promise.all(
    entries.map((entry) =>
      ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", entry._id)).collect(),
    ),
  );
  let currentIncome = 0;
  let currentExpense = 0;
  let priorIncome = 0;
  let priorExpense = 0;
  for (const line of lineGroups.flat()) {
    const type = accountType.get(line.accountId);
    const month = entryMonth.get(line.entryId);
    if (!type || !month) continue;
    if (type === "income") {
      const value = line.creditMinor - line.debitMinor;
      if (month === currentMonth) currentIncome += value;
      else if (month === priorMonth) priorIncome += value;
    } else if (type === "expense") {
      const value = line.debitMinor - line.creditMinor;
      if (month === currentMonth) currentExpense += value;
      else if (month === priorMonth) priorExpense += value;
    }
  }
  return { currentIncome, currentExpense, priorIncome, priorExpense };
}

/**
 * Compose the combined portfolio digest for a workspace. Internal-only and
 * auth-free by design — it is invoked by the cron send action (no user session),
 * scoped strictly by the supplied workspaceId. Returns null when the workspace
 * has no active entity (nothing to report).
 */
export const composeDigest = internalQuery({
  args: { workspaceId: v.id("workspaces"), today: v.optional(v.string()) },
  handler: async (ctx, args): Promise<DigestComposition | null> => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) return null;
    const settings = await ctx.db
      .query("workspaceSettings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    const entities = (
      await ctx.db.query("entities").withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId)).take(200)
    ).filter((entity) => entity.archived !== true);
    if (entities.length === 0) return null;

    const today = resolveToday(args.today);
    const currentMonth = today.slice(0, 7);
    const priorMonth = shiftMonth(currentMonth, -1);

    // Roll up P&L deltas + cash + the strongest advisory cards across entities.
    let currentIncome = 0;
    let currentExpense = 0;
    let priorIncome = 0;
    let priorExpense = 0;
    let cashPositionMinor = 0;
    const allCards: Array<{ title: string; severity: CfoSignal["severity"]; body: string }> = [];
    let runwaySumMonths = 0;
    let runwayCount = 0;

    for (const entity of entities) {
      const pnl = await entityMonthlyPnl(ctx, entity, currentMonth, priorMonth);
      currentIncome += pnl.currentIncome;
      currentExpense += pnl.currentExpense;
      priorIncome += pnl.priorIncome;
      priorExpense += pnl.priorExpense;

      const signals = await computeCfoSignals(ctx, entity, args.workspaceId, today);
      cashPositionMinor += signals.cashPositionMinor;
      if (signals.runwayMonths !== null) {
        runwaySumMonths += signals.runwayMonths;
        runwayCount += 1;
      }
      for (const signal of signals.signals) {
        // The deterministic title already reads in plain English; carry it.
        allCards.push({ title: signal.title, severity: signal.severity, body: signal.title });
      }
    }

    const severityRank: Record<CfoSignal["severity"], number> = { warn: 0, watch: 1, info: 2 };
    const topCards = allCards
      .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
      .slice(0, 3);

    const revenue: DigestDelta = {
      currentMinor: currentIncome,
      priorMinor: priorIncome,
      deltaPct: pctDelta(currentIncome, priorIncome),
    };
    const expense: DigestDelta = {
      currentMinor: currentExpense,
      priorMinor: priorExpense,
      deltaPct: pctDelta(currentExpense, priorExpense),
    };
    const currentProfit = currentIncome - currentExpense;
    const priorProfit = priorIncome - priorExpense;
    const profit: DigestDelta = {
      currentMinor: currentProfit,
      priorMinor: priorProfit,
      deltaPct: pctDelta(currentProfit, priorProfit),
    };

    const owner = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .filter((q) => q.eq(q.field("role"), "owner"))
      .first();
    const ownerUser = owner ? await ctx.db.get(owner.userId) : null;

    return {
      workspaceId: args.workspaceId,
      workspaceName: workspace.name,
      recipient: settings?.notificationEmail ?? ownerUser?.email ?? null,
      digestEnabled: settings?.notifications?.digest ?? true,
      entityCount: entities.length,
      asOf: today,
      currency: "USD",
      revenue,
      expense,
      profit,
      cashPositionMinor,
      runwayMonths: runwayCount > 0 ? Math.round((runwaySumMonths / runwayCount) * 10) / 10 : null,
      topCards,
    };
  },
});

/**
 * List the workspaces eligible for a digest this run: digest toggle ON, and
 * (for monthly subscribers) only on a first-Monday week. The cron passes
 * `isFirstMondayWeek` so monthly subscribers are skipped on other weeks.
 */
export const digestEnabledWorkspaces = internalQuery({
  args: { isFirstMondayWeek: v.boolean() },
  handler: async (ctx, args) => {
    const settingsRows = await ctx.db.query("workspaceSettings").take(2000);
    const result: Array<{ workspaceId: Id<"workspaces">; cadence: "weekly" | "monthly" }> = [];
    for (const row of settingsRows) {
      const digestOn = row.notifications?.digest ?? true;
      if (!digestOn) continue;
      const cadence = row.digestCadence ?? "weekly";
      if (cadence === "monthly" && !args.isFirstMondayWeek) continue;
      result.push({ workspaceId: row.workspaceId, cadence });
    }
    return result;
  },
});

/**
 * Idempotency gate: claim (workspace, weekKey). Returns { claimed: true } only on
 * the FIRST call for a week; a second call in the same week returns
 * { claimed: false } so the send action skips. The send action later patches the
 * row with the real outcome via `recordDigestOutcome`.
 */
export const claimDigestWeek = internalMutation({
  args: { workspaceId: v.id("workspaces"), weekKey: v.string() },
  handler: async (ctx, args): Promise<{ claimed: boolean; rowId: Id<"digestLog"> }> => {
    const existing = await ctx.db
      .query("digestLog")
      .withIndex("by_workspace_and_week", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("weekKey", args.weekKey),
      )
      .first();
    if (existing) return { claimed: false, rowId: existing._id };
    const rowId = await ctx.db.insert("digestLog", {
      workspaceId: args.workspaceId,
      weekKey: args.weekKey,
      sentAt: Date.now(),
      status: "skipped",
      detail: "claimed; send pending",
    });
    return { claimed: true, rowId };
  },
});

export const recordDigestOutcome = internalMutation({
  args: {
    rowId: v.id("digestLog"),
    status: v.union(v.literal("sent"), v.literal("skipped")),
    recipient: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.rowId, {
      status: args.status,
      sentAt: Date.now(),
      recipient: args.recipient,
      detail: args.detail,
    });
  },
});
