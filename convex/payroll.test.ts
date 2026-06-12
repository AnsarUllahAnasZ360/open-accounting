import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * A minimal entity with the chart-of-accounts payroll needs (Payroll Expense
 * 5000, Payroll Payable 2200), an operating bank account, and one active USD
 * employee. USD-in-USD means fxRate = 1, so settlement has no FX line — the
 * cleanest path to assert the ledger stays balanced across the run lifecycle.
 */
async function setupPayroll(t: ReturnType<typeof convexTest>) {
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

function authed(t: ReturnType<typeof convexTest>, userId: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|owner",
    issuer: "test",
    email: "owner@example.com",
  });
}

async function entryLines(t: ReturnType<typeof convexTest>, entryId: string) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("journalLines")
      .withIndex("by_entry", (q) => q.eq("entryId", entryId as never))
      .collect(),
  );
}

async function trialBalance(t: ReturnType<typeof convexTest>, entityId: string) {
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
