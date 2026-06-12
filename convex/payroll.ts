import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";
import { getEntityForWrite, postLedgerEntryCore } from "./ledger";
import { assertSignedMinorUnit } from "./money";
import {
  baseEquivalentMinor,
  computeRunLine,
  currencyTotals,
  defaultFxRateMicros,
  finalLocalMinor,
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
  hasMatchedTxn: boolean;
};

function lineToView(line: Doc<"payrollRunLines">, baseCurrency: string): RunLineView {
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
    settledBaseMinor: line.settledBaseMinor ?? null,
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
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");

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
  const entity = await getEntityForWrite(ctx, run.entityId, "admin");
  const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
  return { run, entity, userId };
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
    const fxRateMicros = defaultFxRateMicros(employee.currency, entity.currency);
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
 * Start (draft) a payroll run for a period. Creates the run + a line per active
 * employee at the prefilled FX rate. No ledger posting yet — drafts only.
 */
export const startRun = mutation({
  args: {
    entityId: v.id("entities"),
    period: v.string(),
  },
  handler: async (ctx, args) => {
    const entity = await getEntityForWrite(ctx, args.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    periodPostingDate(args.period); // validates YYYY-MM

    const existing = await ctx.db
      .query("payrollRuns")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(120);
    if (existing.some((run) => run.period === args.period)) {
      throw new ConvexError(`A payroll run already exists for ${periodLabel(args.period)}.`);
    }

    const employees = (await ctx.db
      .query("employees")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(200)).filter((row) => row.active);
    if (employees.length === 0) {
      throw new ConvexError("Add at least one active employee before running payroll.");
    }

    const now = Date.now();
    const runId = await ctx.db.insert("payrollRuns", {
      entityId: entity._id,
      period: args.period,
      status: "draft",
      totalBaseMinor: 0,
      entryIds: [],
      postingDate: periodPostingDate(args.period),
      createdAt: now,
      updatedAt: now,
    });

    let baseTotalMinor = 0;
    for (const employee of employees) {
      const fxRateMicros = defaultFxRateMicros(employee.currency, entity.currency);
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
      actorUserId: userId,
      action: "payroll.run.started",
      entityType: "payrollRun",
      entityId: runId,
      summary: `Started ${periodLabel(args.period)} payroll run (${employees.length} people)`,
      createdAt: now,
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
 * Find the bank account to credit on settlement: prefer a seeded "operating"
 * bank account, else the first checking bank account, mapped to its ledger
 * account.
 */
async function resolveSettlementBankAccount(ctx: MutationCtx, entityId: Id<"entities">) {
  const bankAccounts = await ctx.db
    .query("bankAccounts")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .take(50);
  const checking = bankAccounts.find((account) => account.kind === "checking") ?? bankAccounts[0];
  if (!checking) {
    throw new ConvexError("No bank account is connected to settle payroll against.");
  }
  return checking;
}

/**
 * Look for an unsettled outgoing bank transaction that plausibly funds this
 * settlement (payroll memo, negative amount, near the posting date). Used to
 * link the paid line to a real bank movement when present (best-effort).
 */
function findMatchingBankTxn(
  transactions: Doc<"transactions">[],
  bankAccountId: Id<"bankAccounts">,
  baseAmountMinor: number,
  postingDate: string,
) {
  const candidates = transactions.filter(
    (txn) =>
      txn.bankAccountId === bankAccountId &&
      txn.amountMinor < 0 &&
      /payroll|gusto|wise/i.test(`${txn.merchant} ${txn.rawDescription}`),
  );
  // Prefer exact amount, then closest by absolute amount.
  candidates.sort(
    (a, b) =>
      Math.abs(Math.abs(a.amountMinor) - baseAmountMinor) - Math.abs(Math.abs(b.amountMinor) - baseAmountMinor),
  );
  return candidates[0] ?? null;
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
  },
) {
  const { run, entity, userId, line } = args;
  const postingDate = postingDateForRun(run);
  // Settlement uses the line's CURRENT fx rate (the rate on the day paid). The
  // payable was credited at approval-time base equivalent; any difference is an
  // FX gain/loss line so the entry still balances and the payable clears fully.
  const approvalBaseMinor = line.baseEquivalentMinor;
  const settlementBaseMinor = baseEquivalentMinor(line.finalLocalMinor, line.fxRateMicros);
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
    updatedAt: now,
  });
  // If we matched a real bank transaction, mark it consumed so it is not
  // double-counted as an uncategorized expense.
  if (args.matchedTxnId) {
    const txn = await ctx.db.get(args.matchedTxnId);
    if (txn && txn.entityId === entity._id && txn.review !== "confirmed") {
      await ctx.db.patch(args.matchedTxnId, {
        review: "confirmed",
        categoryAccountId: args.payableAccountId,
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

    // refresh run after loadRunForWrite already returned the latest
    const result = await settleLine(ctx, {
      run,
      entity,
      userId,
      line,
      bankLedgerAccountId: bank.ledgerAccountId,
      payableAccountId,
      matchedTxnId: args.matchedTxnId,
    });

    // If every line is now paid, flip the run to paid.
    await maybeMarkRunPaid(ctx, run._id);
    return { lineId: line._id, entryId: result.entryId, fxDiffMinor: result.fxDiffMinor };
  },
});

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
  args: { runId: v.id("payrollRuns") },
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
    const usedTxnIds = new Set<Id<"transactions">>();

    let settledCount = 0;
    let fxDiffTotalMinor = 0;
    for (const line of lines) {
      const candidate = findMatchingBankTxn(
        transactions.filter((txn) => !usedTxnIds.has(txn._id)),
        bank._id,
        line.baseEquivalentMinor,
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
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const entity = args.entityId
      ? await ctx.db.get(args.entityId)
      : (await ctx.db
          .query("entities")
          .withIndex("by_workspace_and_slug", (q) => q.eq("workspaceId", membership.workspaceId).eq("slug", "acme-studio-llc"))
          .unique()) ??
        (await ctx.db.query("entities").withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId)).first());
    if (!entity || entity.workspaceId !== membership.workspaceId) return null;
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");

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
  },
});
