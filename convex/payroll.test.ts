import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * A minimal entity with the chart-of-accounts payroll needs (Payroll Expense
 * 5000, Payroll Payable 2200), an operating bank account, and one active USD
 * employee. USD-in-USD means fxRate = 1, so settlement has no FX line — the
 * cleanest path to assert the ledger stays balanced across the run lifecycle.
 */
async function setupPayroll(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar's workspace",
      slug: "ansar-workspace",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const entityId = await ctx.db.insert("entities", {
      workspaceId,
      name: "Acme Studio LLC",
      slug: "acme-studio-llc",
      businessType: "services",
      currency: "USD",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
    const account = (number: string, name: string, type: "asset" | "liability" | "expense") =>
      ctx.db.insert("ledgerAccounts", {
        entityId,
        number,
        name,
        type,
        subtype: type,
        currency: "USD",
        isSystem: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
    const checkingId = await account("1010", "Operating Checking", "asset");
    const expenseId = await account("5000", "Payroll & Contractors", "expense");
    const payableId = await account("2200", "Payroll Payable", "liability");
    await ctx.db.insert("bankAccounts", {
      entityId,
      ledgerAccountId: checkingId,
      name: "Operating Checking",
      mask: "1001",
      kind: "checking",
      balanceMinor: 5_000_000,
      includeInSync: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("employees", {
      entityId,
      name: "Dana Owner",
      country: "US",
      currency: "USD",
      monthlySalaryMinor: 500_000, // $5,000.00
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, entityId, checkingId, expenseId, payableId };
  });
}

/**
 * A multi-currency roster on a USD-base entity: one USD, one PKR, and one INR
 * active employee, plus the FX gain/loss accounts (Other Income 4200, Other
 * Expense 6999) so a settlement FX line can post. Mirrors setupPayroll but
 * proves the full lifecycle stays balanced when local→base conversion is live.
 */
async function setupPayrollMultiCurrency(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar's workspace",
      slug: "ansar-workspace",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const entityId = await ctx.db.insert("entities", {
      workspaceId,
      name: "Acme Studio LLC",
      slug: "acme-studio-llc",
      businessType: "services",
      currency: "USD",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
    const account = (
      number: string,
      name: string,
      type: "asset" | "liability" | "expense" | "income",
    ) =>
      ctx.db.insert("ledgerAccounts", {
        entityId,
        number,
        name,
        type,
        subtype: type,
        currency: "USD",
        isSystem: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
    const checkingId = await account("1010", "Operating Checking", "asset");
    const expenseId = await account("5000", "Payroll & Contractors", "expense");
    const payableId = await account("2200", "Payroll Payable", "liability");
    // FX gain/loss accounts so settlement can book a difference line if any.
    const fxGainId = await account("4200", "Other Income", "income");
    const fxLossId = await account("6999", "Other Expense", "expense");
    await ctx.db.insert("bankAccounts", {
      entityId,
      ledgerAccountId: checkingId,
      name: "Operating Checking",
      mask: "1001",
      kind: "checking",
      balanceMinor: 5_000_000,
      includeInSync: true,
      createdAt: now,
      updatedAt: now,
    });
    // Three currencies, one active employee each. Salaries are local minor units.
    const roster = [
      { name: "Dana Owner", country: "US", currency: "USD", monthlySalaryMinor: 500_000 },
      { name: "Hammas Khan", country: "PK", currency: "PKR", monthlySalaryMinor: 18_000_000 },
      { name: "Mina Patel", country: "IN", currency: "INR", monthlySalaryMinor: 15_000_000 },
    ];
    for (const employee of roster) {
      await ctx.db.insert("employees", {
        entityId,
        active: true,
        createdAt: now,
        updatedAt: now,
        ...employee,
      });
    }
    return { userId, entityId, checkingId, expenseId, payableId, fxGainId, fxLossId };
  });
}

function authed(t: TestConvex<typeof schema>, userId: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|owner",
    issuer: "test",
    email: "owner@example.com",
  });
}

/**
 * Insert a bank account on an entity and return its id + ledger account id, so
 * tests that need a real `bankAccountId` (the payroll matcher keys on it) can
 * attach transactions to a specific account.
 */
async function addBankAccount(
  t: TestConvex<typeof schema>,
  entityId: string,
  opts: { kind?: "checking" | "savings" | "credit"; includeInSync?: boolean; name?: string } = {},
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ledgerAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId: entityId as never,
      number: "1011",
      name: opts.name ?? "Settlement Bank",
      type: "asset",
      subtype: "asset",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const bankAccountId = await ctx.db.insert("bankAccounts", {
      entityId: entityId as never,
      ledgerAccountId,
      name: opts.name ?? "Settlement Bank",
      mask: "2002",
      kind: opts.kind ?? "checking",
      balanceMinor: 10_000_000,
      includeInSync: opts.includeInSync ?? true,
      createdAt: now,
      updatedAt: now,
    });
    return { bankAccountId, ledgerAccountId };
  });
}

/**
 * The entity's seeded "Operating Checking" bank — the deterministic settlement
 * bank `resolveSettlementBankAccount` picks first. Tests that need a salary
 * debit to MATCH must attach it to THIS account.
 */
async function operatingBank(t: TestConvex<typeof schema>, entityId: string) {
  return await t.run(async (ctx) => {
    const bank = (await ctx.db
      .query("bankAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", entityId as never))
      .collect()).find((b) => b.name === "Operating Checking");
    if (!bank) throw new Error("operatingBank: seeded bank not found");
    return { bankAccountId: bank._id, ledgerAccountId: bank.ledgerAccountId };
  });
}

/** Insert a (negative = outflow) bank transaction and return its id. */
async function addBankTxn(
  t: TestConvex<typeof schema>,
  args: {
    entityId: string;
    bankAccountId: string;
    amountMinor: number;
    date: string;
    merchant?: string;
    rawDescription?: string;
  },
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("transactions", {
      entityId: args.entityId as never,
      bankAccountId: args.bankAccountId as never,
      date: args.date,
      amountMinor: args.amountMinor,
      currency: "USD",
      merchant: args.merchant ?? "Outbound transfer",
      rawDescription: args.rawDescription ?? "ACH debit",
      status: "posted",
      review: "needs_review",
      source: "bank",
      evalSet: false,
      externalId: `txn-${Math.random().toString(36).slice(2)}`,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function getTxn(t: TestConvex<typeof schema>, txnId: string): Promise<Doc<"transactions"> | null> {
  return await t.run(async (ctx) => ctx.db.get(txnId as Id<"transactions">));
}

async function getLine(t: TestConvex<typeof schema>, lineId: string): Promise<Doc<"payrollRunLines"> | null> {
  return await t.run(async (ctx) => ctx.db.get(lineId as Id<"payrollRunLines">));
}

/** Persist a day-of-pay FX rate row directly (the action's effect, no network). */
async function seedFxRate(
  t: TestConvex<typeof schema>,
  args: { baseCurrency: string; localCurrency: string; date: string; rateMicros: number },
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("fxRates", {
      baseCurrency: args.baseCurrency,
      localCurrency: args.localCurrency,
      date: args.date,
      rateMicros: args.rateMicros,
      source: "test",
      createdAt: Date.now(),
    });
  });
}

/** Net cash-out: Σ credits − Σ debits on a bank ledger account (positive = out). */
async function bankCashOutMinor(t: TestConvex<typeof schema>, entityId: string, ledgerAccountId: string) {
  return await t.run(async (ctx) => {
    const lines = await ctx.db
      .query("journalLines")
      .withIndex("by_entity", (q) => q.eq("entityId", entityId as never))
      .collect();
    return lines
      .filter((l) => l.accountId === (ledgerAccountId as never))
      .reduce((sum, l) => sum + l.creditMinor - l.debitMinor, 0);
  });
}

/** Lines for one run, ordered by employee name. */
async function runLines(t: TestConvex<typeof schema>, runId: string) {
  return await t.run(async (ctx) =>
    (await ctx.db
      .query("payrollRunLines")
      .withIndex("by_run", (q) => q.eq("runId", runId as never))
      .collect()).sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
  );
}

async function entryLines(t: TestConvex<typeof schema>, entryId: string) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("journalLines")
      .withIndex("by_entry", (q) => q.eq("entryId", entryId as never))
      .collect(),
  );
}

async function trialBalance(t: TestConvex<typeof schema>, entityId: string) {
  return await t.run(async (ctx) => {
    const lines = await ctx.db
      .query("journalLines")
      .withIndex("by_entity", (q) => q.eq("entityId", entityId as never))
      .collect();
    return {
      debit: lines.reduce((sum, l) => sum + l.debitMinor, 0),
      credit: lines.reduce((sum, l) => sum + l.creditMinor, 0),
    };
  });
}

/**
 * Net balance (Σdebits − Σcredits) on a single ledger account across every
 * posted journal line for an entity. Used to assert the Payroll Payable
 * account fully clears to 0 once a run is paid.
 */
async function accountNetMinor(t: TestConvex<typeof schema>, entityId: string, accountId: string) {
  return await t.run(async (ctx) => {
    const lines = await ctx.db
      .query("journalLines")
      .withIndex("by_entity", (q) => q.eq("entityId", entityId as never))
      .collect();
    return lines
      .filter((l) => l.accountId === (accountId as never))
      .reduce((sum, l) => sum + l.debitMinor - l.creditMinor, 0);
  });
}

describe("payroll run lifecycle posts through the ledger", () => {
  it("approveRun posts a balanced debit-expense / credit-payable entry", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayroll(t);
    const session = authed(t, ids.userId);

    const { runId } = await session.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    const approved = await session.mutation(api.payroll.approveRun, { runId });

    expect(approved.baseTotalMinor).toBe(500_000);
    const lines = await entryLines(t, approved.entryId);
    expect(lines).toHaveLength(2);
    const debit = lines.reduce((sum, l) => sum + l.debitMinor, 0);
    const credit = lines.reduce((sum, l) => sum + l.creditMinor, 0);
    expect(debit).toBe(credit); // balanced
    expect(debit).toBe(500_000);
    // Expense is debited, payable is credited.
    expect(lines.find((l) => l.accountId === ids.expenseId)?.debitMinor).toBe(500_000);
    expect(lines.find((l) => l.accountId === ids.payableId)?.creditMinor).toBe(500_000);
  });

  it("markRunPaid settles to the bank and leaves the trial balance at zero", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayroll(t);
    const session = authed(t, ids.userId);

    const { runId } = await session.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    await session.mutation(api.payroll.approveRun, { runId });
    await session.mutation(api.payroll.markRunPaid, { runId });

    // The single most important ledger invariant: every debit has a credit.
    const tb = await trialBalance(t, ids.entityId);
    expect(tb.debit).toBe(tb.credit);
    // Accrual (expense+payable) and settlement (payable+bank) both posted.
    const run = await t.run(async (ctx) => ctx.db.get(runId as never));
    expect((run as { status: string }).status).toBe("paid");
  });

  it("rejects approval when the period is locked", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayroll(t);
    const session = authed(t, ids.userId);

    await session.mutation(api.ledger.setPeriodLock, {
      entityId: ids.entityId,
      lockedThroughDate: "2026-12-31",
    });
    const { runId } = await session.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    await expect(session.mutation(api.payroll.approveRun, { runId })).rejects.toThrow();
  });

  it("cannot approve the same run twice", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayroll(t);
    const session = authed(t, ids.userId);

    const { runId } = await session.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    await session.mutation(api.payroll.approveRun, { runId });
    await expect(session.mutation(api.payroll.approveRun, { runId })).rejects.toThrow();
  });
});

describe("multi-currency (USD/PKR/INR) payroll lifecycle stays balanced", () => {
  it("draft → approve → pay keeps trial balance 0 and clears Payroll Payable to 0", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayrollMultiCurrency(t);
    const session = authed(t, ids.userId);

    // ---- Draft: three lines, three currencies, a positive base total --------
    const { runId } = await session.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    const draftDetail = await session.query(api.payroll.runDetail, { runId });
    expect(draftDetail).not.toBeNull();
    const detail = draftDetail!;
    expect(detail.materialized).toBe(true);
    expect(detail.lineCount).toBe(3);
    // Footer shows all three currencies.
    const draftCurrencies = detail.currencyTotals.map((row) => row.currency).sort();
    expect(draftCurrencies).toEqual(["INR", "PKR", "USD"]);
    // Base total is the sum of every line's base equivalent and is positive.
    const sumOfLineBase = detail.lines.reduce((acc, line) => acc + line.baseEquivalentMinor, 0);
    expect(detail.baseTotalMinor).toBe(sumOfLineBase);
    expect(detail.baseTotalMinor).toBeGreaterThan(0);

    // ---- Approve: exactly ONE balanced entry, debit 5000 == credit 2200 -----
    const approved = await session.mutation(api.payroll.approveRun, { runId });
    expect(approved.baseTotalMinor).toBe(detail.baseTotalMinor);
    const approvalLines = await entryLines(t, approved.entryId);
    expect(approvalLines).toHaveLength(2);
    const approvalDebit = approvalLines.reduce((sum, l) => sum + l.debitMinor, 0);
    const approvalCredit = approvalLines.reduce((sum, l) => sum + l.creditMinor, 0);
    expect(approvalDebit).toBe(approvalCredit);
    expect(approvalDebit).toBe(approved.baseTotalMinor);
    expect(approvalLines.find((l) => l.accountId === ids.expenseId)?.debitMinor).toBe(approved.baseTotalMinor);
    expect(approvalLines.find((l) => l.accountId === ids.payableId)?.creditMinor).toBe(approved.baseTotalMinor);

    // ---- Pay: run flips to paid, every line paid, trial balance still 0 -----
    await session.mutation(api.payroll.markRunPaid, { runId });
    const paidDetail = (await session.query(api.payroll.runDetail, { runId }))!;
    expect(paidDetail.run.status).toBe("paid");
    expect(paidDetail.lines.every((line) => line.paid)).toBe(true);
    expect(paidDetail.paidCount).toBe(3);

    const tb = await trialBalance(t, ids.entityId);
    expect(tb.debit).toBe(tb.credit);

    // The Payroll Payable account is fully cleared: accrual credited it and
    // settlement debited it back, net 0.
    const payableNet = await accountNetMinor(t, ids.entityId, ids.payableId);
    expect(payableNet).toBe(0);
  });

  it("statementGroups per-currency totals reconcile to currencyTotals", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayrollMultiCurrency(t);
    const session = authed(t, ids.userId);

    const { runId } = await session.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    const detail = (await session.query(api.payroll.runDetail, { runId }))!;

    // Roll the per-country/currency statement groups up to per-currency totals
    // and assert they equal the footer currencyTotals exactly (local + base).
    const groupedByCurrency = new Map<string, { localMinor: number; baseMinor: number }>();
    for (const group of detail.statementGroups) {
      const row = groupedByCurrency.get(group.currency) ?? { localMinor: 0, baseMinor: 0 };
      row.localMinor += group.localMinor;
      row.baseMinor += group.baseMinor;
      groupedByCurrency.set(group.currency, row);
    }
    expect([...groupedByCurrency.keys()].sort()).toEqual(["INR", "PKR", "USD"]);
    for (const total of detail.currencyTotals) {
      const grouped = groupedByCurrency.get(total.currency);
      expect(grouped, `statement group for ${total.currency}`).toBeDefined();
      expect(grouped!.localMinor).toBe(total.localMinor);
      expect(grouped!.baseMinor).toBe(total.baseMinor);
    }
    // And the sum of group base totals reconciles to the run base total.
    const groupBaseSum = detail.statementGroups.reduce((acc, group) => acc + group.baseMinor, 0);
    expect(groupBaseSum).toBe(detail.baseTotalMinor);
  });
});

describe("scheduled auto-draft is SAFE and never pollutes the seed", () => {
  async function runCount(t: TestConvex<typeof schema>, entityId: string) {
    return await t.run(async (ctx) =>
      (await ctx.db
        .query("payrollRuns")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId as never))
        .collect()).length,
    );
  }

  it("is a NO-OP for entities with no enabled schedule (the demo guarantee)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayroll(t); // isDemo entity, no paySchedule row

    const result = await t.mutation(internal.payroll.autoDraftScheduledRuns, {});

    expect(result.draftedCount).toBe(0);
    expect(result.scheduleCount).toBe(0);
    // Crucially: no runs were created on the seed entity.
    expect(await runCount(t, ids.entityId)).toBe(0);
  });

  it("drafts an auto-draft run (no ledger post) only when a schedule is enabled, and is idempotent", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayroll(t);
    const session = authed(t, ids.userId);

    await session.mutation(api.payroll.setPaySchedule, { entityId: ids.entityId, enabled: true });

    const first = await t.mutation(internal.payroll.autoDraftScheduledRuns, {});
    expect(first.scheduleCount).toBe(1);
    expect(first.draftedCount).toBe(1);

    const runs = await t.run(async (ctx) =>
      ctx.db.query("payrollRuns").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId as never)).collect(),
    );
    expect(runs).toHaveLength(1);
    expect((runs[0] as { source?: string }).source).toBe("auto-draft");
    expect((runs[0] as { status: string }).status).toBe("draft");

    // Auto-draft must NOT post to the ledger — approval stays manual.
    const tb = await trialBalance(t, ids.entityId);
    expect(tb.debit).toBe(0);
    expect(tb.credit).toBe(0);

    // Re-running the cron lands on the existing run (idempotent) — no second run.
    const second = await t.mutation(internal.payroll.autoDraftScheduledRuns, {});
    expect(second.draftedCount).toBe(0);
    expect(await runCount(t, ids.entityId)).toBe(1);
  });

  it("E10-T5: enabling a schedule on a multi-currency roster drafts a multi-currency run with trial balance still 0", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayrollMultiCurrency(t); // USD + PKR + INR
    const session = authed(t, ids.userId);

    await session.mutation(api.payroll.setPaySchedule, { entityId: ids.entityId, enabled: true });

    const result = await t.mutation(internal.payroll.autoDraftScheduledRuns, {});
    expect(result.scheduleCount).toBe(1);
    expect(result.draftedCount).toBe(1);

    const runs = await t.run(async (ctx) =>
      ctx.db.query("payrollRuns").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId as never)).collect(),
    );
    expect(runs).toHaveLength(1);
    const run = runs[0] as { _id: string; source?: string; status: string };
    expect(run.source).toBe("auto-draft");
    expect(run.status).toBe("draft");

    // The draft materializes one line per active employee across all 3 currencies.
    const lines = await runLines(t, run._id);
    expect(lines).toHaveLength(3);
    expect([...new Set(lines.map((l) => l.currency))].sort()).toEqual(["INR", "PKR", "USD"]);

    // Auto-draft is draft-only: NOTHING posted to the ledger, so trial balance is 0.
    const tb = await trialBalance(t, ids.entityId);
    expect(tb.debit).toBe(0);
    expect(tb.credit).toBe(0);
  });
});

describe("E10-T2: payroll bank matcher (exact / unique / ±5d, RC10 no double-count)", () => {
  it("consumes a KEYWORD-LESS exact-amount in-window debit and yields ONE cash-out", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayroll(t); // one USD employee, $5,000
    const session = authed(t, ids.userId);
    const bank = await operatingBank(t, ids.entityId);

    // A salary debit that does NOT say payroll/gusto/wise, exact $5,000, two
    // days before the 2026-04-30 posting date — must still match.
    const txnId = await addBankTxn(t, {
      entityId: ids.entityId,
      bankAccountId: bank.bankAccountId,
      amountMinor: -500_000,
      date: "2026-04-28",
      merchant: "Mercury Checking",
      rawDescription: "Outbound ACH",
    });

    const { runId } = await session.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    await session.mutation(api.payroll.approveRun, { runId });
    await session.mutation(api.payroll.markRunPaid, { runId });

    // The txn is linked + categorized to the Payroll Payable + out of needs_review.
    const line = (await runLines(t, runId))[0]!;
    expect(line.settlementTxnId).toBe(txnId);
    const txn = (await getTxn(t, txnId))!;
    expect(txn.review).toBe("confirmed");
    expect(txn.review).not.toBe("needs_review");
    expect(txn.categoryAccountId).toBe(ids.payableId);
    // Provenance memo marks it as matched to payroll (not a duplicate expense).
    expect(txn.rawDescription).toContain("Matched to");

    // EXACTLY one cash-out: the settlement entry credits the settlement bank for
    // $5,000; the consumed txn posts no journal entry of its own.
    const cashOut = await bankCashOutMinor(t, ids.entityId, bank.ledgerAccountId);
    expect(cashOut).toBe(500_000);
  });

  it("does NOT auto-match when the exact amount is ambiguous (two same-amount debits)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayroll(t);
    const session = authed(t, ids.userId);
    const bank = await operatingBank(t, ids.entityId);

    // Two unmatched debits of the SAME exact amount, both in window, neither with
    // a keyword → ambiguous → route to manual (no link).
    await addBankTxn(t, { entityId: ids.entityId, bankAccountId: bank.bankAccountId, amountMinor: -500_000, date: "2026-04-29", merchant: "Vendor A", rawDescription: "ACH" });
    await addBankTxn(t, { entityId: ids.entityId, bankAccountId: bank.bankAccountId, amountMinor: -500_000, date: "2026-04-30", merchant: "Vendor B", rawDescription: "ACH" });

    const { runId } = await session.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    await session.mutation(api.payroll.approveRun, { runId });
    await session.mutation(api.payroll.markRunPaid, { runId });

    const line = (await runLines(t, runId))[0]!;
    expect(line.settlementTxnId).toBeUndefined();
    // Cash-out is still exactly one (the settlement entry), the debits stay open.
    expect(await bankCashOutMinor(t, ids.entityId, bank.ledgerAccountId)).toBe(500_000);
  });

  it("ignores out-of-window debits (>±5 calendar days) and wrong-amount debits", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayroll(t);
    const session = authed(t, ids.userId);
    const bank = await operatingBank(t, ids.entityId);

    // Right amount but 6 days early (window is ±5).
    await addBankTxn(t, { entityId: ids.entityId, bankAccountId: bank.bankAccountId, amountMinor: -500_000, date: "2026-04-24", merchant: "Payroll", rawDescription: "salary" });
    // In window but wrong amount.
    await addBankTxn(t, { entityId: ids.entityId, bankAccountId: bank.bankAccountId, amountMinor: -499_900, date: "2026-04-30", merchant: "Payroll", rawDescription: "salary" });

    const { runId } = await session.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    await session.mutation(api.payroll.approveRun, { runId });
    await session.mutation(api.payroll.markRunPaid, { runId });

    const line = (await runLines(t, runId))[0]!;
    expect(line.settlementTxnId).toBeUndefined();
  });

  it("markLinePaid (per-line UI path) now consumes a matching bank txn", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayroll(t);
    const session = authed(t, ids.userId);
    const bank = await operatingBank(t, ids.entityId);

    const txnId = await addBankTxn(t, {
      entityId: ids.entityId,
      bankAccountId: bank.bankAccountId,
      amountMinor: -500_000,
      date: "2026-04-30",
      merchant: "Bank transfer",
      rawDescription: "outgoing wire",
    });

    const { runId } = await session.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    await session.mutation(api.payroll.approveRun, { runId });
    const line = (await runLines(t, runId))[0]!;
    // Per-line path with NO explicit matchedTxnId — the matcher must auto-find it.
    await session.mutation(api.payroll.markLinePaid, { lineId: line._id });

    const settled = (await getLine(t, line._id))!;
    expect(settled.settlementTxnId).toBe(txnId);
    const txn = (await getTxn(t, txnId))!;
    expect(txn.review).toBe("confirmed");
    expect(await bankCashOutMinor(t, ids.entityId, bank.ledgerAccountId)).toBe(500_000);
  });

  it("cannot match the same bank txn to two paid lines (double-match guard)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayrollMultiCurrency(t); // 3 employees
    const session = authed(t, ids.userId);
    const bank = await operatingBank(t, ids.entityId);

    // Only the USD line's exact base amount ($5,000) is represented by ONE debit.
    // Even if two lines somehow resolve to the same base amount, the txn must be
    // consumed at most once. Insert a single $5,000 debit and approve a run whose
    // USD line settles to exactly $5,000.
    const txnId = await addBankTxn(t, {
      entityId: ids.entityId,
      bankAccountId: bank.bankAccountId,
      amountMinor: -500_000,
      date: "2026-04-30",
      merchant: "Outbound",
      rawDescription: "ACH",
    });

    const { runId } = await session.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    await session.mutation(api.payroll.approveRun, { runId });
    await session.mutation(api.payroll.markRunPaid, { runId });

    const lines = await runLines(t, runId);
    const linkedCount = lines.filter((l) => l.settlementTxnId === txnId).length;
    expect(linkedCount).toBeLessThanOrEqual(1);

    // A SECOND run in a different period also cannot re-consume the same txn.
    const { runId: run2 } = await session.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-05" });
    await session.mutation(api.payroll.approveRun, { runId: run2 });
    // The May posting date (2026-05-31) is out of the ±5d window for the April
    // debit anyway, but the guard also protects against any in-window collision.
    await session.mutation(api.payroll.markRunPaid, { runId: run2 });
    const lines2 = await runLines(t, run2);
    expect(lines2.some((l) => l.settlementTxnId === txnId)).toBe(false);
  });
});

describe("E10-T3: payroll FX correctness at settlement", () => {
  it("books an FX GAIN (paid less) and clears the PKR line's payable to 0", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayrollMultiCurrency(t);
    const session = authed(t, ids.userId);

    const { runId } = await session.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    const approved = await session.mutation(api.payroll.approveRun, { runId });

    // PKR line accrued at 278 PKR/USD (seed fallback). Pay-day rate weakens to
    // 300 PKR/USD -> the USD value of the same PKR salary is LOWER -> we pay less
    // -> FX GAIN (credit 4200). Override at pay time.
    const pkrLine = (await runLines(t, runId)).find((l) => l.currency === "PKR")!;
    const accrualBase = pkrLine.baseEquivalentMinor;
    await session.mutation(api.payroll.markRunPaid, {
      runId,
      settlementFxRateMicrosByCurrency: { PKR: 300_000_000 },
    });

    const settled = (await getLine(t, pkrLine._id))!;
    // Settled base differs from accrual and is smaller (weaker local currency).
    expect(settled.settledFxRateMicros).toBe(300_000_000);
    expect(settled.settledBaseMinor).not.toBe(accrualBase);
    expect(settled.settledBaseMinor!).toBeLessThan(accrualBase);

    // An FX GAIN line posted to 4200 (Other Income, credit side).
    const gainLines = await t.run(async (ctx) =>
      (await ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId as never)).collect())
        .filter((l) => l.accountId === (ids.fxGainId as never)),
    );
    const gainCredit = gainLines.reduce((s, l) => s + l.creditMinor, 0);
    expect(gainCredit).toBeGreaterThan(0);
    expect(gainCredit).toBe(accrualBase - settled.settledBaseMinor!);

    // Whole-entity trial balance still 0 and Payroll Payable fully cleared.
    const tb = await trialBalance(t, ids.entityId);
    expect(tb.debit).toBe(tb.credit);
    expect(await accountNetMinor(t, ids.entityId, ids.payableId)).toBe(0);
  });

  it("books an FX LOSS (paid more) to 6999 and still balances", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayrollMultiCurrency(t);
    const session = authed(t, ids.userId);

    const { runId } = await session.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    await session.mutation(api.payroll.approveRun, { runId });

    const inrLine = (await runLines(t, runId)).find((l) => l.currency === "INR")!;
    const accrualBase = inrLine.baseEquivalentMinor;
    // INR accrued at 83/USD; pay-day rate STRENGTHENS to 75/USD -> USD value
    // HIGHER -> we pay more -> FX LOSS (debit 6999).
    await session.mutation(api.payroll.markRunPaid, {
      runId,
      settlementFxRateMicrosByCurrency: { INR: 75_000_000 },
    });

    const settled = (await getLine(t, inrLine._id))!;
    expect(settled.settledBaseMinor!).toBeGreaterThan(accrualBase);

    const lossLines = await t.run(async (ctx) =>
      (await ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId as never)).collect())
        .filter((l) => l.accountId === (ids.fxLossId as never)),
    );
    const lossDebit = lossLines.reduce((s, l) => s + l.debitMinor, 0);
    expect(lossDebit).toBeGreaterThan(0);
    expect(lossDebit).toBe(settled.settledBaseMinor! - accrualBase);

    const tb = await trialBalance(t, ids.entityId);
    expect(tb.debit).toBe(tb.credit);
    expect(await accountNetMinor(t, ids.entityId, ids.payableId)).toBe(0);
  });

  it("uses the FETCHED persisted day-of-pay rate when no override is given", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayrollMultiCurrency(t);
    const session = authed(t, ids.userId);

    // Persist a fetched rate (the action's effect) BEFORE drafting; the accrual
    // path prefers it over the seed fallback, and settlement reads it too.
    await seedFxRate(t, { baseCurrency: "USD", localCurrency: "PKR", date: "2026-04-30", rateMicros: 285_000_000 });

    const { runId } = await session.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    await session.mutation(api.payroll.approveRun, { runId });
    await session.mutation(api.payroll.markRunPaid, { runId }); // NO override

    const pkrLine = (await runLines(t, runId)).find((l) => l.currency === "PKR")!;
    expect(pkrLine.settledFxRateMicros).toBe(285_000_000);
    // Float never persists: stored as an integer micro-unit value.
    expect(Number.isInteger(pkrLine.settledFxRateMicros!)).toBe(true);

    // runDetail surfaces the settled rate + realized FX delta.
    const detail = (await session.query(api.payroll.runDetail, { runId }))!;
    const pkrView = detail.lines.find((l) => l.currency === "PKR")!;
    expect(pkrView.settledFxRateMicros).toBe(285_000_000);
    expect(pkrView.fxRealizedMinor).toBe(pkrView.baseEquivalentMinor - (pkrView.settledBaseMinor ?? 0));

    const tb = await trialBalance(t, ids.entityId);
    expect(tb.debit).toBe(tb.credit);
    expect(await accountNetMinor(t, ids.entityId, ids.payableId)).toBe(0);
  });

  it("falls back to the accrual rate when no override and no fetched rate (USD lines never book FX)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayroll(t); // single USD employee, fx = 1
    const session = authed(t, ids.userId);

    const { runId } = await session.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    await session.mutation(api.payroll.approveRun, { runId });
    await session.mutation(api.payroll.markRunPaid, { runId });

    const line = (await runLines(t, runId))[0]!;
    // USD-in-USD: settled at the accrual rate (1.0) with no FX diff.
    expect(line.settledBaseMinor).toBe(line.baseEquivalentMinor);
    const tb = await trialBalance(t, ids.entityId);
    expect(tb.debit).toBe(tb.credit);
  });

  it("persistFxRate stores integer micro-units and rejects non-positive rates", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.payroll.persistFxRate, {
      baseCurrency: "USD",
      localCurrency: "PKR",
      date: "2026-06-01",
      rateMicros: 279_500_000,
      source: "test",
    });
    const stored = await t.run(async (ctx) =>
      ctx.db
        .query("fxRates")
        .withIndex("by_pair_and_date", (q) => q.eq("baseCurrency", "USD").eq("localCurrency", "PKR").eq("date", "2026-06-01"))
        .unique(),
    );
    expect(stored?.rateMicros).toBe(279_500_000);
    expect(Number.isInteger(stored!.rateMicros)).toBe(true);

    await expect(
      t.mutation(internal.payroll.persistFxRate, {
        baseCurrency: "USD",
        localCurrency: "INR",
        date: "2026-06-01",
        rateMicros: 0,
        source: "test",
      }),
    ).rejects.toThrow();
  });
});

describe("E10-T7: entity-explicit statement + deterministic bank + authz", () => {
  async function setupSecondWorkspace(t: TestConvex<typeof schema>) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const otherUserId = await ctx.db.insert("users", { email: "intruder@example.com", name: "Intruder" });
      const otherWorkspaceId = await ctx.db.insert("workspaces", {
        name: "Other workspace",
        slug: "other-workspace",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("workspaceMembers", {
        workspaceId: otherWorkspaceId,
        userId: otherUserId,
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      return { otherUserId, otherWorkspaceId };
    });
  }

  it("statement(entityId) resolves the named entity and a non-member is rejected", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayroll(t);
    const session = authed(t, ids.userId);
    const { otherUserId } = await setupSecondWorkspace(t);

    const result = await session.query(api.payroll.statement, { entityId: ids.entityId });
    expect(result).not.toBeNull();
    expect(result!.entity.id).toBe(ids.entityId);
    expect(result!.entity.name).toBe("Acme Studio LLC");

    // A user in a DIFFERENT workspace cannot read this entity's statement.
    const intruder = t.withIdentity({
      subject: `${otherUserId}|test-session`,
      tokenIdentifier: "test|intruder",
      issuer: "test",
      email: "intruder@example.com",
    });
    await expect(intruder.query(api.payroll.statement, { entityId: ids.entityId })).rejects.toThrow();
  });

  it("non-member is rejected from runDetail / markRunPaid (server-side authz)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayroll(t);
    const session = authed(t, ids.userId);
    const { otherUserId } = await setupSecondWorkspace(t);

    const { runId } = await session.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    const intruder = t.withIdentity({
      subject: `${otherUserId}|test-session`,
      tokenIdentifier: "test|intruder",
      issuer: "test",
      email: "intruder@example.com",
    });
    await expect(intruder.query(api.payroll.runDetail, { runId })).rejects.toThrow();
    await expect(intruder.mutation(api.payroll.markRunPaid, { runId })).rejects.toThrow();
  });

  it("settlement bank selection is deterministic (prefers included-in-sync checking)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayroll(t);
    const session = authed(t, ids.userId);

    // Add a savings account and a NOT-included checking account; the original
    // setupPayroll checking (includeInSync:true) must win deterministically.
    await addBankAccount(t, ids.entityId, { kind: "savings", includeInSync: true, name: "Savings" });
    await addBankAccount(t, ids.entityId, { kind: "checking", includeInSync: false, name: "Secondary Checking" });

    // Put the exact salary debit on the EXPECTED (original) checking account.
    const original = await t.run(async (ctx) =>
      (await ctx.db.query("bankAccounts").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId as never)).collect())
        .find((b) => b.name === "Operating Checking")!,
    );
    const txnId = await addBankTxn(t, {
      entityId: ids.entityId,
      bankAccountId: original._id,
      amountMinor: -500_000,
      date: "2026-04-30",
      merchant: "Outbound",
      rawDescription: "ACH",
    });

    const { runId } = await session.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    await session.mutation(api.payroll.approveRun, { runId });
    await session.mutation(api.payroll.markRunPaid, { runId });

    // The matcher only fires when the resolved settlement bank == the txn's bank,
    // so a successful link proves the resolver picked the original checking.
    const line = (await runLines(t, runId))[0]!;
    expect(line.settlementTxnId).toBe(txnId);
  });

  it("clear error when the entity has zero connected bank accounts", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPayroll(t);
    const session = authed(t, ids.userId);

    // Remove the only bank account so settlement has nothing to credit.
    await t.run(async (ctx) => {
      const banks = await ctx.db
        .query("bankAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId as never))
        .collect();
      for (const b of banks) await ctx.db.delete(b._id);
    });

    const { runId } = await session.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    await session.mutation(api.payroll.approveRun, { runId });
    await expect(session.mutation(api.payroll.markRunPaid, { runId })).rejects.toThrow(/bank account/i);
  });
});
