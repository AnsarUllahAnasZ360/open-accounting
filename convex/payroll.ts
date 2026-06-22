import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireAnyWorkspacePermission, requireWorkspacePermission } from "./authz";
import { assertNotDemoWrite } from "./demoWorkspace";
import { resolveDefaultEntity } from "./entityScope";
import { postLedgerEntryCore } from "./ledger";
import { assertSignedMinorUnit } from "./money";
import {
  baseEquivalentMinor,
  computeRunLine,
  currencyTotals,
  defaultFxRateMicros,
  FX_MICRO_SCALE,
  formatFxRateMicros,
  parseFxRateToMicros,
  periodLabel,
  periodPostingDate,
  runBaseTotalMinor,
} from "./payrollMath";

// Accounts the payroll flow posts to, addressed by chart number so the
// mutation does not depend on a particular seed ordering.
const PAYROLL_EXPENSE_NUMBER = "5000";
const PAYROLL_PAYABLE_NUMBER = "2200";
const FX_LOSS_NUMBER = "6999"; // Other Expense
const FX_GAIN_NUMBER = "4200"; // Other Income

async function accountByNumber(ctx: QueryCtx | MutationCtx, entityId: Id<"entities">, number: string) {
  const account = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity_and_number", (q) => q.eq("entityId", entityId).eq("number", number))
    .unique();
  if (!account) {
    throw new Error(`Chart of accounts is missing account ${number}. Seed the chart first.`);
  }
  return account;
}

function postingDateForRun(run: Doc<"payrollRuns">) {
  return run.postingDate ?? periodPostingDate(run.period);
}

// ---------------------------------------------------------------------------
// Read model: run detail (lines + footer totals + statement)
// ---------------------------------------------------------------------------

type RunLineView = {
  id: string;
  employeeId: Id<"employees"> | null;
  employeeName: string;
  country: string;
  currency: string;
  baseSalaryMinor: number;
  adjustmentMinor: number;
  fxRateMicros: number;
  fxDisplay: string;
  finalLocalMinor: number;
  baseEquivalentMinor: number;
  paid: boolean;
  settledBaseMinor: number | null;
  settledFxRateMicros: number | null;
  settledFxDisplay: string | null;
  // Realized FX gain/loss for this line in base minor units: accrual base −
  // settled base. >0 = gain (paid less than accrued), <0 = loss, null until paid.
  fxRealizedMinor: number | null;
  hasMatchedTxn: boolean;
};

function lineToView(line: Doc<"payrollRunLines">, baseCurrency: string): RunLineView {
  const settledFxRateMicros = line.settledFxRateMicros ?? null;
  const settledBaseMinor = line.settledBaseMinor ?? null;
  return {
    id: line._id,
    employeeId: line.employeeId ?? null,
    employeeName: line.employeeName,
    country: line.country,
    currency: line.currency,
    baseSalaryMinor: line.baseSalaryMinor,
    adjustmentMinor: line.adjustmentMinor,
    fxRateMicros: line.fxRateMicros,
    fxDisplay: formatFxRateMicros(line.fxRateMicros, baseCurrency, line.currency),
    finalLocalMinor: line.finalLocalMinor,
    baseEquivalentMinor: line.baseEquivalentMinor,
    paid: line.paid,
    settledBaseMinor,
    settledFxRateMicros,
    settledFxDisplay:
      settledFxRateMicros === null
        ? null
        : formatFxRateMicros(settledFxRateMicros, baseCurrency, line.currency),
    fxRealizedMinor: settledBaseMinor === null ? null : line.baseEquivalentMinor - settledBaseMinor,
    hasMatchedTxn: Boolean(line.settlementTxnId),
  };
}

/**
 * Project a run with no persisted lines (a legacy seeded run) into read-only
 * lines computed from the entity's current active employees. Used only for
 * display; editing/approval require materialized lines (see `startRun` /
 * `backfillRunLines`).
 */
function projectLinesFromEmployees(
  employees: Doc<"employees">[],
  baseCurrency: string,
  settled: boolean,
): RunLineView[] {
  return employees
    .filter((employee) => employee.active)
    .map((employee) => {
      const fxRateMicros = defaultFxRateMicros(employee.currency, baseCurrency);
      const computed = computeRunLine({
        baseSalaryMinor: employee.monthlySalaryMinor,
        adjustmentMinor: 0,
        fxRateMicros,
      });
      return {
        id: `projected:${employee._id}`,
        employeeId: employee._id,
        employeeName: employee.name,
        country: employee.country,
        currency: employee.currency,
        baseSalaryMinor: employee.monthlySalaryMinor,
        adjustmentMinor: 0,
        fxRateMicros,
        fxDisplay: formatFxRateMicros(fxRateMicros, baseCurrency, employee.currency),
        finalLocalMinor: computed.finalLocalMinor,
        baseEquivalentMinor: computed.baseEquivalentMinor,
        paid: settled,
        settledBaseMinor: settled ? computed.baseEquivalentMinor : null,
        settledFxRateMicros: settled ? fxRateMicros : null,
        settledFxDisplay: settled ? formatFxRateMicros(fxRateMicros, baseCurrency, employee.currency) : null,
        fxRealizedMinor: settled ? 0 : null,
        hasMatchedTxn: false,
      };
    })
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

export const runDetail = query({
  args: { runId: v.id("payrollRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const entity = await ctx.db.get(run.entityId);
    if (!entity) return null;
    await requireWorkspacePermission(ctx, entity.workspaceId, "payroll.view");

    const [persistedLines, employees, lock] = await Promise.all([
      ctx.db.query("payrollRunLines").withIndex("by_run", (q) => q.eq("runId", run._id)).take(500),
      ctx.db.query("employees").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(200),
      ctx.db.query("periodLocks").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).unique(),
    ]);

    const materialized = persistedLines.length > 0;
    const lineViews = materialized
      ? persistedLines.map((line) => lineToView(line, entity.currency)).sort((a, b) => a.employeeName.localeCompare(b.employeeName))
      : projectLinesFromEmployees(employees, entity.currency, run.status === "paid");

    const totals = currencyTotals(lineViews);
    const baseTotalMinor = runBaseTotalMinor(lineViews);
    const postingDate = postingDateForRun(run);
    const periodLocked = Boolean(lock && postingDate <= lock.lockedThroughDate);

    // Statement groups: by country/currency for the printable statement.
    const statementGroups = [...lineViews.reduce((map, line) => {
      const key = `${line.country} · ${line.currency}`;
      const group = map.get(key) ?? { key, country: line.country, currency: line.currency, lines: [] as RunLineView[], localMinor: 0, baseMinor: 0 };
      group.lines.push(line);
      group.localMinor += line.finalLocalMinor;
      group.baseMinor += line.baseEquivalentMinor;
      map.set(key, group);
      return map;
    }, new Map<string, { key: string; country: string; currency: string; lines: RunLineView[]; localMinor: number; baseMinor: number }>()).values()]
      .sort((a, b) => a.key.localeCompare(b.key));

    const paidCount = lineViews.filter((line) => line.paid).length;

    return {
      entity: { id: entity._id, name: entity.name, currency: entity.currency },
      run: {
        id: run._id,
        period: run.period,
        periodLabel: periodLabel(run.period),
        postingDate,
        status: run.status,
        source: run.source ?? "manual",
        totalBaseMinor: materialized ? baseTotalMinor : run.totalBaseMinor,
        approvedAt: run.approvedAt ?? null,
        paidAt: run.paidAt ?? null,
      },
      editable: materialized && run.status === "draft" && !periodLocked,
      periodLocked,
      lines: lineViews,
      currencyTotals: totals,
      baseTotalMinor: materialized ? baseTotalMinor : run.totalBaseMinor,
      paidCount,
      lineCount: lineViews.length,
      statementGroups,
      materialized,
    };
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

async function loadRunForWrite(ctx: MutationCtx, runId: Id<"payrollRuns">) {
  const run = await ctx.db.get(runId);
  if (!run) throw new Error("Payroll run not found.");
  const entity = await ctx.db.get(run.entityId);
  if (!entity) throw new Error("OpenBooks entity not found.");
  const { userId } = await requireWorkspacePermission(ctx, entity.workspaceId, "payroll.manage");
  await assertNotDemoWrite(ctx, entity.workspaceId); // E11-T6: demo is read-only.
  return { run, entity, userId };
}

/**
 * Accrual FX rate for a line at draft/approval: prefer the latest fetched +
 * persisted day-of-pay rate; fall back to the seed-consistency default only when
 * nothing has been fetched (so demo runs read back unchanged). USD-in-USD is 1.
 */
async function resolveAccrualFxRateMicros(
  ctx: QueryCtx | MutationCtx,
  baseCurrency: string,
  localCurrency: string,
): Promise<number> {
  if (localCurrency === baseCurrency) return FX_MICRO_SCALE;
  const fetched = await latestPersistedFxRateMicros(ctx, baseCurrency, localCurrency);
  if (fetched && fetched > 0) return fetched;
  return defaultFxRateMicros(localCurrency, baseCurrency);
}

async function materializeLines(ctx: MutationCtx, run: Doc<"payrollRuns">, entity: Doc<"entities">) {
  const existing = await ctx.db.query("payrollRunLines").withIndex("by_run", (q) => q.eq("runId", run._id)).take(1);
  if (existing.length > 0) return;
  const employees = await ctx.db
    .query("employees")
    .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
    .take(200);
  const now = Date.now();
  const settled = run.status === "paid";
  for (const employee of employees.filter((row) => row.active)) {
    const fxRateMicros = await resolveAccrualFxRateMicros(ctx, entity.currency, employee.currency);
    const computed = computeRunLine({
      baseSalaryMinor: employee.monthlySalaryMinor,
      adjustmentMinor: 0,
      fxRateMicros,
    });
    await ctx.db.insert("payrollRunLines", {
      entityId: entity._id,
      runId: run._id,
      employeeId: employee._id,
      employeeName: employee.name,
      country: employee.country,
      currency: employee.currency,
      baseSalaryMinor: employee.monthlySalaryMinor,
      adjustmentMinor: 0,
      fxRateMicros,
      finalLocalMinor: computed.finalLocalMinor,
      baseEquivalentMinor: computed.baseEquivalentMinor,
      paid: settled,
      settledBaseMinor: settled ? computed.baseEquivalentMinor : undefined,
      createdAt: now,
      updatedAt: now,
    });
  }
}

/**
 * Materialize per-line records for a run that predates the line table (the
 * seeded historical runs). Idempotent. Returns the run id so the UI can open
 * the detail with editable lines.
 */
export const backfillRunLines = mutation({
  args: { runId: v.id("payrollRuns") },
  handler: async (ctx, args) => {
    const { run, entity } = await loadRunForWrite(ctx, args.runId);
    await materializeLines(ctx, run, entity);
    return { runId: run._id };
  },
});

/**
 * Shared draft path. Creates a draft run + a line per active employee at the
 * prefilled FX rate, with NO ledger posting (approval stays manual). Carries the
 * existing duplicate-period guard so re-drafting the same period is idempotent
 * (returns the existing run id instead of creating a second one). Reused by both
 * the manual `startRun` and the scheduled auto-draft, so the two paths can never
 * diverge. `actorUserId` is null for the system-driven auto-draft.
 */
async function draftRunForEntity(
  ctx: MutationCtx,
  args: {
    entity: Doc<"entities">;
    period: string;
    source: "manual" | "auto-draft";
    actorUserId: Id<"users"> | null;
  },
): Promise<{ runId: Id<"payrollRuns">; created: boolean }> {
  const { entity, period, source, actorUserId } = args;
  periodPostingDate(period); // validates YYYY-MM

  // Duplicate-period guard: one run per period. Idempotent for the cron.
  const existing = await ctx.db
    .query("payrollRuns")
    .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
    .take(120);
  const duplicate = existing.find((run) => run.period === period);
  if (duplicate) {
    if (source === "manual") {
      throw new ConvexError(`A payroll run already exists for ${periodLabel(period)}.`);
    }
    return { runId: duplicate._id, created: false };
  }

  const employees = (await ctx.db
    .query("employees")
    .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
    .take(200)).filter((row) => row.active);
  if (employees.length === 0) {
    if (source === "manual") {
      throw new ConvexError("Add at least one active employee before running payroll.");
    }
    // Auto-draft never fabricates an empty run.
    throw new ConvexError("No active employees to draft a run for.");
  }

  const now = Date.now();
  const runId = await ctx.db.insert("payrollRuns", {
    entityId: entity._id,
    period,
    status: "draft",
    source,
    totalBaseMinor: 0,
    entryIds: [],
    postingDate: periodPostingDate(period),
    createdAt: now,
    updatedAt: now,
  });

  let baseTotalMinor = 0;
  for (const employee of employees) {
    const fxRateMicros = await resolveAccrualFxRateMicros(ctx, entity.currency, employee.currency);
    const computed = computeRunLine({
      baseSalaryMinor: employee.monthlySalaryMinor,
      adjustmentMinor: 0,
      fxRateMicros,
    });
    baseTotalMinor += computed.baseEquivalentMinor;
    await ctx.db.insert("payrollRunLines", {
      entityId: entity._id,
      runId,
      employeeId: employee._id,
      employeeName: employee.name,
      country: employee.country,
      currency: employee.currency,
      baseSalaryMinor: employee.monthlySalaryMinor,
      adjustmentMinor: 0,
      fxRateMicros,
      finalLocalMinor: computed.finalLocalMinor,
      baseEquivalentMinor: computed.baseEquivalentMinor,
      paid: false,
      createdAt: now,
      updatedAt: now,
    });
  }
  await ctx.db.patch(runId, { totalBaseMinor: baseTotalMinor, updatedAt: now });

  await ctx.db.insert("auditEvents", {
    workspaceId: entity.workspaceId,
    actorUserId: actorUserId ?? undefined,
    action: source === "auto-draft" ? "payroll.run.autodrafted" : "payroll.run.started",
    entityType: "payrollRun",
    entityId: runId,
    summary:
      source === "auto-draft"
        ? `Auto-drafted ${periodLabel(period)} payroll run (${employees.length} people) — awaiting review`
        : `Started ${periodLabel(period)} payroll run (${employees.length} people)`,
    createdAt: now,
  });

  return { runId, created: true };
}

/**
 * Start (draft) a payroll run for a period. Creates the run + a line per active
 * employee at the prefilled FX rate. No ledger posting yet — drafts only.
 */
export const startRun = mutation({
  args: {
    entityId: v.id("entities"),
    period: v.string(),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new Error("OpenBooks entity not found.");
    const { userId } = await requireWorkspacePermission(ctx, entity.workspaceId, "payroll.manage");
    await assertNotDemoWrite(ctx, entity.workspaceId); // E11-T6: demo is read-only.
    const { runId } = await draftRunForEntity(ctx, {
      entity,
      period: args.period,
      source: "manual",
      actorUserId: userId,
    });
    return { runId };
  },
});

/** Edit one draft line (adjustment and/or FX rate). Recomputes derived totals. */
export const updateRunLine = mutation({
  args: {
    lineId: v.id("payrollRunLines"),
    adjustmentMinor: v.optional(v.number()),
    fxRate: v.optional(v.union(v.string(), v.number())),
  },
  handler: async (ctx, args) => {
    const line = await ctx.db.get(args.lineId);
    if (!line) throw new Error("Payroll line not found.");
    const { run, entity, userId } = await loadRunForWrite(ctx, line.runId);
    if (run.status !== "draft") {
      throw new ConvexError("Only draft payroll runs can be edited. Reopen the period to correct a posted run.");
    }

    const adjustmentMinor = args.adjustmentMinor ?? line.adjustmentMinor;
    assertSignedMinorUnit(adjustmentMinor, "Adjustment");
    const fxRateMicros = args.fxRate === undefined ? line.fxRateMicros : parseFxRateToMicros(args.fxRate);
    const computed = computeRunLine({
      baseSalaryMinor: line.baseSalaryMinor,
      adjustmentMinor,
      fxRateMicros,
    });
    const now = Date.now();
    await ctx.db.patch(line._id, {
      adjustmentMinor,
      fxRateMicros,
      finalLocalMinor: computed.finalLocalMinor,
      baseEquivalentMinor: computed.baseEquivalentMinor,
      updatedAt: now,
    });

    // Recompute the run base total from all lines.
    const lines = await ctx.db.query("payrollRunLines").withIndex("by_run", (q) => q.eq("runId", run._id)).take(500);
    const baseTotalMinor = runBaseTotalMinor(lines.map((row) => (row._id === line._id ? computed : row)));
    await ctx.db.patch(run._id, { totalBaseMinor: baseTotalMinor, updatedAt: now });

    return { lineId: line._id, finalLocalMinor: computed.finalLocalMinor, baseEquivalentMinor: computed.baseEquivalentMinor, baseTotalMinor };
  },
});

/**
 * Approve a draft run: posts ONE balanced entry through the ledger —
 * debit Payroll & Contractors (expense) / credit Payroll Payable (liability),
 * in base currency, dated the period's last day. Respects the period lock.
 */
export const approveRun = mutation({
  args: { runId: v.id("payrollRuns") },
  handler: async (ctx, args) => {
    const { run, entity, userId } = await loadRunForWrite(ctx, args.runId);
    if (run.status !== "draft") {
      throw new ConvexError("Only draft runs can be approved.");
    }
    await materializeLines(ctx, run, entity);
    const lines = await ctx.db.query("payrollRunLines").withIndex("by_run", (q) => q.eq("runId", run._id)).take(500);
    if (lines.length === 0) {
      throw new ConvexError("This run has no lines to approve.");
    }
    const baseTotalMinor = runBaseTotalMinor(lines);
    if (baseTotalMinor <= 0) {
      throw new ConvexError("Payroll run total must be positive to approve.");
    }

    const expenseAccount = await accountByNumber(ctx, entity._id, PAYROLL_EXPENSE_NUMBER);
    const payableAccount = await accountByNumber(ctx, entity._id, PAYROLL_PAYABLE_NUMBER);
    const postingDate = postingDateForRun(run);

    const posted = await postLedgerEntryCore(ctx, {
      entity,
      userId,
      date: postingDate,
      memo: `${periodLabel(run.period)} payroll run approved`,
      source: "payroll",
      sourceId: `payroll-${run.period}`,
      auditAction: "payroll.run.approved",
      lines: [
        { accountId: expenseAccount._id, debitMinor: baseTotalMinor, creditMinor: 0, currency: entity.currency },
        { accountId: payableAccount._id, debitMinor: 0, creditMinor: baseTotalMinor, currency: entity.currency },
      ],
    });

    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "approved",
      totalBaseMinor: baseTotalMinor,
      entryIds: [...run.entryIds, posted.entryId],
      approvalEntryId: posted.entryId,
      expenseAccountId: expenseAccount._id,
      payableAccountId: payableAccount._id,
      approvedAt: now,
      updatedAt: now,
    });

    return { runId: run._id, entryId: posted.entryId, baseTotalMinor };
  },
});

/**
 * Resolve the bank account to credit on settlement — DETERMINISTIC per entity
 * (E10-T7), so a multi-LLC workspace never mis-routes payroll to the wrong
 * business's account. Precedence (highest first):
 *   1. the entity's operating CHECKING account, preferring one included in sync
 *      (`includeInSync`), tie-broken by oldest `createdAt` then `_id`;
 *   2. any other CHECKING account, same tiebreak;
 *   3. any bank account at all (savings/credit), same tiebreak.
 * Throws a clear, actionable error when the entity has ZERO connected bank
 * accounts. (No per-entity "payroll bank" mapping field exists yet; when one is
 * added it slots in as precedence step 0.)
 */
async function resolveSettlementBankAccount(ctx: MutationCtx, entityId: Id<"entities">) {
  const bankAccounts = await ctx.db
    .query("bankAccounts")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .take(50);
  if (bankAccounts.length === 0) {
    throw new ConvexError(
      "No bank account is connected to this business. Connect a bank account before paying payroll.",
    );
  }
  // Stable ordering: included-in-sync first, then oldest, then id — fully
  // deterministic regardless of query/insert order.
  const ordered = bankAccounts.slice().sort((a, b) => {
    if (a.includeInSync !== b.includeInSync) return a.includeInSync ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a._id.localeCompare(b._id);
  });
  const checking = ordered.filter((account) => account.kind === "checking");
  return checking[0] ?? ordered[0]!;
}

// Auto-match tolerances (QBO "For Review" parity, decisions.md Q52).
// A salary bank debit auto-links to a paid line only when the USD amount is
// EXACT (within a 1-minor-unit rounding tolerance), that amount is UNIQUE among
// still-unmatched candidates, and the txn date is within ±5 CALENDAR days of the
// run posting date — the standard ACH/wire settlement window.
const PAYROLL_MATCH_AMOUNT_TOLERANCE_MINOR = 1;
const PAYROLL_MATCH_DATE_WINDOW_DAYS = 5;
const PAYROLL_KEYWORD_RE = /payroll|gusto|wise|salary|wages|adp|deel|remote/i;

/** Whole-day difference between two "YYYY-MM-DD" ISO dates (absolute). */
function isoDaysApart(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((da - db) / 86_400_000));
}

/**
 * Find the unique bank salary debit that funds a settlement (RC10 double-count
 * fix). A candidate must:
 *   - belong to the settlement `bankAccountId`,
 *   - be an OUTFLOW (`amountMinor < 0`),
 *   - equal the line's USD (base) settlement amount EXACTLY (±1 minor unit; the
 *     bank debit is a USD-equivalent amount, not a foreign-currency journal line),
 *   - fall within ±5 CALENDAR days of the run posting date (decisions.md Q52),
 *   - and not already be consumed (`usedTxnIds`) or linked to another paid line
 *     via `settlementTxnId`.
 * A payroll KEYWORD (payroll/gusto/wise/salary/…) is a TIEBREAKER that breaks a
 * multi-candidate tie — it is NOT required, so a plain Wise/ACH debit that does
 * not say "payroll" still matches on exact amount + window. If, after the
 * keyword tiebreaker, more than one candidate remains, the amount is NOT unique
 * and we return null (route to manual) rather than guess.
 */
function findMatchingBankTxn(
  transactions: Doc<"transactions">[],
  bankAccountId: Id<"bankAccounts">,
  baseAmountMinor: number,
  postingDate: string,
): Doc<"transactions"> | null {
  const candidates = transactions.filter(
    (txn) =>
      txn.bankAccountId === bankAccountId &&
      txn.amountMinor < 0 &&
      Math.abs(Math.abs(txn.amountMinor) - baseAmountMinor) <= PAYROLL_MATCH_AMOUNT_TOLERANCE_MINOR &&
      isoDaysApart(txn.date, postingDate) <= PAYROLL_MATCH_DATE_WINDOW_DAYS,
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  // More than one exact-amount, in-window candidate: prefer keyword hints. If
  // the keyword narrows to exactly one, that wins (the tiebreaker). Otherwise
  // the amount is ambiguous — do NOT auto-match, leave for manual review.
  const keyworded = candidates.filter((txn) =>
    PAYROLL_KEYWORD_RE.test(`${txn.merchant} ${txn.rawDescription}`),
  );
  if (keyworded.length === 1) return keyworded[0]!;
  return null;
}

/**
 * Resolve the day-of-pay FX rate (local-per-base micro-units) for a line:
 *   1. an explicit `overrideFxRateMicros` (manual override) wins,
 *   2. else the latest fetched+persisted rate for (base, local) on/at the
 *      posting date,
 *   3. else the line's accrual rate (`fxRateMicros`) — preserving prior behavior
 *      when no override or fetch is available.
 * USD-in-USD always returns the line's rate (FX_MICRO_SCALE), so a base-currency
 * line never books an FX line.
 */
async function resolveSettlementFxRateMicros(
  ctx: MutationCtx,
  args: {
    entity: Doc<"entities">;
    line: Doc<"payrollRunLines">;
    overrideFxRateMicros?: number;
  },
): Promise<number> {
  const { entity, line } = args;
  if (line.currency === entity.currency) return line.fxRateMicros;
  if (args.overrideFxRateMicros && args.overrideFxRateMicros > 0) {
    return args.overrideFxRateMicros;
  }
  const fetched = await latestPersistedFxRateMicros(ctx, entity.currency, line.currency);
  if (fetched && fetched > 0) return fetched;
  return line.fxRateMicros;
}

/** Settlement base (USD) amount for a line at its resolved day-of-pay rate. */
async function resolveSettlementBaseMinor(
  ctx: MutationCtx,
  args: {
    entity: Doc<"entities">;
    line: Doc<"payrollRunLines">;
    overrideFxRateMicros?: number;
  },
): Promise<number> {
  const rate = await resolveSettlementFxRateMicros(ctx, args);
  return baseEquivalentMinor(args.line.finalLocalMinor, rate);
}

/** Most-recent persisted day-of-pay rate for a currency pair (micro-units). */
async function latestPersistedFxRateMicros(
  ctx: QueryCtx | MutationCtx,
  baseCurrency: string,
  localCurrency: string,
): Promise<number | null> {
  if (localCurrency === baseCurrency) return FX_MICRO_SCALE;
  const rows = await ctx.db
    .query("fxRates")
    .withIndex("by_pair_and_date", (q) =>
      q.eq("baseCurrency", baseCurrency).eq("localCurrency", localCurrency),
    )
    .order("desc")
    .take(1);
  return rows[0]?.rateMicros ?? null;
}

async function settleLine(
  ctx: MutationCtx,
  args: {
    run: Doc<"payrollRuns">;
    entity: Doc<"entities">;
    userId: Id<"users">;
    line: Doc<"payrollRunLines">;
    bankLedgerAccountId: Id<"ledgerAccounts">;
    payableAccountId: Id<"ledgerAccounts">;
    matchedTxnId?: Id<"transactions">;
    overrideFxRateMicros?: number;
  },
) {
  const { run, entity, userId, line } = args;
  const postingDate = postingDateForRun(run);
  // Settlement uses the DAY-OF-PAY fx rate (override → fetched → accrual). The
  // payable was credited at approval-time base equivalent; any difference is an
  // FX gain/loss line so the entry still balances and the payable clears fully.
  const settlementFxRateMicros = await resolveSettlementFxRateMicros(ctx, {
    entity,
    line,
    overrideFxRateMicros: args.overrideFxRateMicros,
  });
  const approvalBaseMinor = line.baseEquivalentMinor;
  const settlementBaseMinor = baseEquivalentMinor(line.finalLocalMinor, settlementFxRateMicros);
  const fxDiffMinor = approvalBaseMinor - settlementBaseMinor; // >0 => we paid less => gain

  const settlementLines = [
    { accountId: args.payableAccountId, debitMinor: approvalBaseMinor, creditMinor: 0, currency: entity.currency },
    { accountId: args.bankLedgerAccountId, debitMinor: 0, creditMinor: settlementBaseMinor, currency: entity.currency },
  ];
  if (fxDiffMinor !== 0) {
    const fxAccount = await accountByNumber(
      ctx,
      entity._id,
      fxDiffMinor > 0 ? FX_GAIN_NUMBER : FX_LOSS_NUMBER,
    );
    if (fxDiffMinor > 0) {
      // Paid less than accrued: credit Other Income for the gain.
      settlementLines.push({ accountId: fxAccount._id, debitMinor: 0, creditMinor: fxDiffMinor, currency: entity.currency });
    } else {
      // Paid more than accrued: debit Other Expense for the loss.
      settlementLines.push({ accountId: fxAccount._id, debitMinor: Math.abs(fxDiffMinor), creditMinor: 0, currency: entity.currency });
    }
  }

  // Balance assertion before posting: the single ledger writer also enforces
  // this, but failing fast here keeps the FX math honest at the call site.
  const settleDebit = settlementLines.reduce((sum, l) => sum + l.debitMinor, 0);
  const settleCredit = settlementLines.reduce((sum, l) => sum + l.creditMinor, 0);
  if (settleDebit !== settleCredit) {
    throw new Error(
      `Payroll settlement entry does not balance (debit ${settleDebit} ≠ credit ${settleCredit}).`,
    );
  }

  const posted = await postLedgerEntryCore(ctx, {
    entity,
    userId,
    date: postingDate,
    memo: `${periodLabel(run.period)} payroll settled — ${line.employeeName}`,
    source: "payroll",
    sourceId: `payroll-settle-${line._id}`,
    auditAction: "payroll.line.settled",
    lines: settlementLines,
  });

  const now = Date.now();
  await ctx.db.patch(line._id, {
    paid: true,
    settlementEntryId: posted.entryId,
    settlementTxnId: args.matchedTxnId,
    settledBaseMinor: settlementBaseMinor,
    settledFxRateMicros: settlementFxRateMicros,
    updatedAt: now,
  });
  // If we matched a real bank transaction, mark it consumed so it is not
  // double-counted as an uncategorized expense (RC10). The debit is categorized
  // to the Payroll Payable account it settles and tagged with a provenance memo
  // so Transactions shows it as "matched to payroll", not a duplicate expense.
  // There is exactly ONE cash-out: the settlement entry credits the bank once;
  // the consumed txn never posts its own journal entry.
  if (args.matchedTxnId) {
    const txn = await ctx.db.get(args.matchedTxnId);
    if (txn && txn.entityId === entity._id) {
      const provenance = `Matched to ${periodLabel(run.period)} payroll — ${line.employeeName}`;
      await ctx.db.patch(args.matchedTxnId, {
        review: "confirmed",
        decidedBy: "match",
        categoryAccountId: args.payableAccountId,
        rawDescription: txn.rawDescription.includes(provenance)
          ? txn.rawDescription
          : `${txn.rawDescription} · ${provenance}`,
        updatedAt: now,
      });
    }
  }
  await ctx.db.patch(run._id, { entryIds: [...run.entryIds, posted.entryId], updatedAt: now });
  return { entryId: posted.entryId, fxDiffMinor };
}

/** Mark a single approved line paid: settles payable -> bank (+ FX diff). */
export const markLinePaid = mutation({
  args: {
    lineId: v.id("payrollRunLines"),
    matchedTxnId: v.optional(v.id("transactions")),
    // Optional day-of-pay FX override (local-per-base micro-units). Takes
    // precedence over the fetched/persisted day-of-pay rate. When omitted, the
    // settlement uses the fetched rate, falling back to the line's accrual rate.
    settlementFxRateMicros: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const line = await ctx.db.get(args.lineId);
    if (!line) throw new Error("Payroll line not found.");
    const { run, entity, userId } = await loadRunForWrite(ctx, line.runId);
    if (run.status !== "approved") {
      throw new ConvexError("Approve the run before marking lines paid.");
    }
    if (line.paid) {
      throw new ConvexError("This line is already paid.");
    }
    const payableAccountId = run.payableAccountId ?? (await accountByNumber(ctx, entity._id, PAYROLL_PAYABLE_NUMBER))._id;
    const bank = await resolveSettlementBankAccount(ctx, entity._id);

    // Resolve the settlement base for this line first (override → fetched →
    // accrual) so the matcher compares against the USD amount that will hit the
    // bank, then auto-consume the matching salary debit (RC10) — the per-line UI
    // path now does this, not only markRunPaid. An explicit matchedTxnId from the
    // caller still wins.
    let matchedTxnId = args.matchedTxnId;
    if (!matchedTxnId) {
      const settlementBaseMinor = await resolveSettlementBaseMinor(ctx, {
        entity,
        line,
        overrideFxRateMicros: args.settlementFxRateMicros,
      });
      const used = await consumedSettlementTxnIds(ctx, entity._id);
      const transactions = await ctx.db
        .query("transactions")
        .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
        .take(2000);
      const candidate = findMatchingBankTxn(
        transactions.filter((txn) => !used.has(txn._id)),
        bank._id,
        settlementBaseMinor,
        postingDateForRun(run),
      );
      matchedTxnId = candidate?._id;
    }

    // refresh run after loadRunForWrite already returned the latest
    const result = await settleLine(ctx, {
      run,
      entity,
      userId,
      line,
      bankLedgerAccountId: bank.ledgerAccountId,
      payableAccountId,
      matchedTxnId,
      overrideFxRateMicros: args.settlementFxRateMicros,
    });

    // If every line is now paid, flip the run to paid.
    await maybeMarkRunPaid(ctx, run._id);
    return { lineId: line._id, entryId: result.entryId, fxDiffMinor: result.fxDiffMinor };
  },
});

/**
 * Set of transaction ids already consumed by a paid payroll line in this entity,
 * so the matcher can never link one bank debit to two lines (double-match guard).
 * Reads every line's `settlementTxnId` across the entity's runs.
 */
async function consumedSettlementTxnIds(
  ctx: MutationCtx,
  entityId: Id<"entities">,
): Promise<Set<Id<"transactions">>> {
  const lines = await ctx.db
    .query("payrollRunLines")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .take(5000);
  const used = new Set<Id<"transactions">>();
  for (const line of lines) {
    if (line.settlementTxnId) used.add(line.settlementTxnId);
  }
  return used;
}

async function maybeMarkRunPaid(ctx: MutationCtx, runId: Id<"payrollRuns">) {
  const lines = await ctx.db.query("payrollRunLines").withIndex("by_run", (q) => q.eq("runId", runId)).take(500);
  if (lines.length > 0 && lines.every((line) => line.paid)) {
    const run = await ctx.db.get(runId);
    if (run && run.status !== "paid") {
      await ctx.db.patch(runId, { status: "paid", paidAt: Date.now(), updatedAt: Date.now() });
    }
  }
}

/** Mark every unpaid line in an approved run paid, settling each one. */
export const markRunPaid = mutation({
  args: {
    runId: v.id("payrollRuns"),
    // Optional per-currency day-of-pay FX override (currency -> local-per-base
    // micro-units). Takes precedence over the fetched/persisted rate for lines in
    // that currency. Currencies not listed fall back to fetched, then accrual.
    settlementFxRateMicrosByCurrency: v.optional(v.record(v.string(), v.number())),
  },
  handler: async (ctx, args) => {
    const { run, entity, userId } = await loadRunForWrite(ctx, args.runId);
    if (run.status !== "approved") {
      throw new ConvexError("Approve the run before marking it paid.");
    }
    const payableAccountId = run.payableAccountId ?? (await accountByNumber(ctx, entity._id, PAYROLL_PAYABLE_NUMBER))._id;
    const bank = await resolveSettlementBankAccount(ctx, entity._id);
    const lines = (await ctx.db.query("payrollRunLines").withIndex("by_run", (q) => q.eq("runId", run._id)).take(500)).filter(
      (line) => !line.paid,
    );
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(2000);
    // Seed the double-match guard with txns already consumed by previously-paid
    // lines (across all runs), then exclude any matched within this loop.
    const usedTxnIds = await consumedSettlementTxnIds(ctx, entity._id);
    const overrideMap = args.settlementFxRateMicrosByCurrency ?? {};

    let settledCount = 0;
    let fxDiffTotalMinor = 0;
    for (const line of lines) {
      const overrideFxRateMicros = overrideMap[line.currency];
      const settlementBaseMinor = await resolveSettlementBaseMinor(ctx, {
        entity,
        line,
        overrideFxRateMicros,
      });
      const candidate = findMatchingBankTxn(
        transactions.filter((txn) => !usedTxnIds.has(txn._id)),
        bank._id,
        settlementBaseMinor,
        postingDateForRun(run),
      );
      if (candidate) usedTxnIds.add(candidate._id);
      const result = await settleLine(ctx, {
        run,
        entity,
        userId,
        line,
        bankLedgerAccountId: bank.ledgerAccountId,
        payableAccountId,
        matchedTxnId: candidate?._id,
        overrideFxRateMicros,
      });
      settledCount += 1;
      fxDiffTotalMinor += result.fxDiffMinor;
    }

    await maybeMarkRunPaid(ctx, run._id);
    return { runId: run._id, settledCount, fxDiffTotalMinor };
  },
});

// ---------------------------------------------------------------------------
// Statement (per-month, across runs) — for the Statement tab
// ---------------------------------------------------------------------------

export const statement = query({
  args: { entityId: v.optional(v.id("entities")) },
  handler: async (ctx, args) => {
    const { membership } = await requireAnyWorkspacePermission(ctx, "payroll.view");
    if (args.entityId) {
      // Entity-explicit (E10-T7): resolve by id and REJECT cross-workspace access
      // outright rather than silently returning null. No demo-slug fallback.
      const entity = await ctx.db.get(args.entityId);
      if (!entity || entity.workspaceId !== membership.workspaceId) {
        throw new ConvexError("OpenBooks: payroll statement is not in your workspace.");
      }
      await requireWorkspacePermission(ctx, entity.workspaceId, "payroll.view");
      return await buildStatement(ctx, entity);
    }
    // No explicit entity: fall back to the workspace's DETERMINISTIC default
    // business (entityScope.resolveDefaultEntity) — never a hardcoded slug.
    const entity = await resolveDefaultEntity(ctx, membership);
    if (!entity || entity.workspaceId !== membership.workspaceId) return null;
    await requireWorkspacePermission(ctx, entity.workspaceId, "payroll.view");
    return await buildStatement(ctx, entity);
  },
});

async function buildStatement(ctx: QueryCtx, entity: Doc<"entities">) {
  const runs = (await ctx.db.query("payrollRuns").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(60)).sort(
    (a, b) => b.period.localeCompare(a.period),
  );

  return {
    entity: { id: entity._id, name: entity.name, currency: entity.currency },
    runs: runs.map((run) => ({
      id: run._id,
      period: run.period,
      periodLabel: periodLabel(run.period),
      status: run.status,
      totalBaseMinor: run.totalBaseMinor,
    })),
  };
}

// ---------------------------------------------------------------------------
// Pay schedule (auto-draft cadence) — read + enable, no ledger impact
// ---------------------------------------------------------------------------

/** The current "YYYY-MM" period from the wall clock (UTC). */
function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Read an entity's pay schedule. Returns a disabled default when none exists so
 * the UI can render the honest "Auto-run: off" affordance without a null check.
 */
export const paySchedule = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) return null;
    await requireWorkspacePermission(ctx, entity.workspaceId, "payroll.view");
    const row = await ctx.db
      .query("paySchedules")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .unique();
    return {
      entityId: entity._id,
      cadence: row?.cadence ?? ("monthly" as const),
      enabled: row?.enabled ?? false,
    };
  },
});

/**
 * Turn auto-draft on/off for an entity (admin only). Non-ledger config: it only
 * controls whether the scheduled function drafts the period's run; approval — the
 * single ledger post — always stays a manual, human action.
 */
export const setPaySchedule = mutation({
  args: {
    entityId: v.id("entities"),
    enabled: v.boolean(),
    cadence: v.optional(v.union(v.literal("monthly"), v.literal("semimonthly"))),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new Error("OpenBooks entity not found.");
    const { userId } = await requireWorkspacePermission(ctx, entity.workspaceId, "payroll.manage");
    await assertNotDemoWrite(ctx, entity.workspaceId); // E11-T6: demo is read-only.
    const existing = await ctx.db
      .query("paySchedules")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .unique();
    const now = Date.now();
    const cadence = args.cadence ?? existing?.cadence ?? "monthly";
    if (existing) {
      await ctx.db.patch(existing._id, { enabled: args.enabled, cadence, updatedAt: now });
    } else {
      await ctx.db.insert("paySchedules", {
        entityId: entity._id,
        cadence,
        enabled: args.enabled,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "payroll.schedule.updated",
      entityType: "entity",
      entityId: entity._id,
      summary: `Auto-draft payroll ${args.enabled ? "enabled" : "disabled"} (${cadence})`,
      createdAt: now,
    });
    return { enabled: args.enabled, cadence };
  },
});

/**
 * SCHEDULED auto-draft (internal, cron-driven). For every entity with an ENABLED
 * paySchedule, draft the current period's run from the active roster, marking it
 * `source: "auto-draft"`. It does NOT post to the ledger — approval stays a
 * manual human step — and it is a NO-OP on any entity without an enabled
 * schedule, so demo/seed data is never touched. Idempotent: the duplicate-period
 * guard means re-running the cron lands on the existing run instead of creating
 * a second one.
 */
export const autoDraftScheduledRuns = internalMutation({
  args: {},
  handler: async (ctx) => {
    const period = currentPeriod();
    const schedules = await ctx.db
      .query("paySchedules")
      .filter((q) => q.eq(q.field("enabled"), true))
      .take(500);

    let draftedCount = 0;
    let skippedCount = 0;
    for (const schedule of schedules) {
      const entity = await ctx.db.get(schedule.entityId);
      if (!entity) continue;
      // Auto-draft never invents employees: an entity with no active roster is
      // skipped rather than erroring out the whole batch.
      const activeEmployees = (await ctx.db
        .query("employees")
        .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
        .take(200)).filter((row) => row.active);
      if (activeEmployees.length === 0) {
        skippedCount += 1;
        continue;
      }
      const { created } = await draftRunForEntity(ctx, {
        entity,
        period,
        source: "auto-draft",
        actorUserId: null,
      });
      if (created) draftedCount += 1;
      else skippedCount += 1;
    }
    return { period, scheduleCount: schedules.length, draftedCount, skippedCount };
  },
});

// ---------------------------------------------------------------------------
// Day-of-pay FX rates (E10-T3) — fetched once, persisted as integer micro-units
// so the settle/read path NEVER depends on a live network fetch.
// ---------------------------------------------------------------------------

const FX_DEFAULT_API = "https://api.frankfurter.app"; // free, key-less, ECB rates

/**
 * Read the latest persisted day-of-pay rate (micro-units) per non-base currency
 * across an entity's active roster, plus the accrual default for comparison.
 * Drives the pay-time FX panel; never fetches. Returns null when the entity is
 * unknown / out of workspace.
 */
export const fxRatesForEntity = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) return null;
    await requireWorkspacePermission(ctx, entity.workspaceId, "payroll.view");
    const employees = await ctx.db
      .query("employees")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(200);
    const currencies = [
      ...new Set(
        employees
          .filter((row) => row.active && row.currency !== entity.currency)
          .map((row) => row.currency),
      ),
    ].sort();
    const rows = await Promise.all(
      currencies.map(async (currency) => {
        const fetched = await latestPersistedFxRateMicros(ctx, entity.currency, currency);
        return {
          currency,
          accrualRateMicros: defaultFxRateMicros(currency, entity.currency),
          fetchedRateMicros: fetched,
          fxDisplay: fetched ? formatFxRateMicros(fetched, entity.currency, currency) : null,
        };
      }),
    );
    return { baseCurrency: entity.currency, rates: rows };
  },
});

/** Persist a fetched FX rate (internal; called from the fetch action). */
export const persistFxRate = internalMutation({
  args: {
    baseCurrency: v.string(),
    localCurrency: v.string(),
    date: v.string(),
    rateMicros: v.number(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.rateMicros) || args.rateMicros <= 0) {
      throw new Error("FX rate must be a positive integer micro-unit value.");
    }
    const existing = await ctx.db
      .query("fxRates")
      .withIndex("by_pair_and_date", (q) =>
        q
          .eq("baseCurrency", args.baseCurrency)
          .eq("localCurrency", args.localCurrency)
          .eq("date", args.date),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { rateMicros: args.rateMicros, source: args.source });
      return { id: existing._id, updated: true };
    }
    const id = await ctx.db.insert("fxRates", {
      baseCurrency: args.baseCurrency,
      localCurrency: args.localCurrency,
      date: args.date,
      rateMicros: args.rateMicros,
      source: args.source,
      createdAt: Date.now(),
    });
    return { id, updated: false };
  },
});

/**
 * Fetch the day-of-pay FX rate (no provider preference; decisions.md Q51) for one
 * or more local currencies against a base currency and persist each as integer
 * micro-units. External network call lives here (Convex action). The settle/read
 * path reads the persisted row — it never fetches. A manual override at pay time
 * still takes precedence over whatever this stores.
 */
export const fetchDayOfPayRates = action({
  args: {
    baseCurrency: v.string(),
    localCurrencies: v.array(v.string()),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ baseCurrency: string; date: string; persisted: Array<{ currency: string; rateMicros: number }> }> => {
    const base = args.baseCurrency.toUpperCase();
    const targets = [...new Set(args.localCurrencies.map((c) => c.toUpperCase()))].filter(
      (c) => c !== base,
    );
    // Default to the most recent business day (Frankfurter publishes weekday ECB
    // fixings; "latest" returns the newest available).
    const dateParam = args.date ?? "latest";
    const persisted: Array<{ currency: string; rateMicros: number }> = [];
    if (targets.length === 0) {
      return { baseCurrency: base, date: dateParam, persisted };
    }

    const url = `${FX_DEFAULT_API}/${dateParam}?from=${base}&to=${targets.join(",")}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`FX rate fetch failed (${response.status}).`);
    }
    const payload = (await response.json()) as {
      date?: string;
      rates?: Record<string, number>;
    };
    const effectiveDate = payload.date ?? new Date().toISOString().slice(0, 10);
    const rates = payload.rates ?? {};
    for (const currency of targets) {
      const rate = rates[currency];
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) continue;
      // Frankfurter returns local-per-base directly (from=base, to=local), which
      // is exactly our micro-unit convention.
      const rateMicros = Math.round(rate * FX_MICRO_SCALE);
      await ctx.runMutation(internal.payroll.persistFxRate, {
        baseCurrency: base,
        localCurrency: currency,
        date: effectiveDate,
        rateMicros,
        source: "frankfurter",
      });
      persisted.push({ currency, rateMicros });
    }
    return { baseCurrency: base, date: effectiveDate, persisted };
  },
});
