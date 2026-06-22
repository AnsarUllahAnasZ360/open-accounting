/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// E9-T1 — Dashboard cash + cash-flow correctness. The dashboard cash tile and
// the cash-flow chart must both be LEDGER-derived and TRANSFER-AWARE:
//   1. dashboard.cashPositionMinor (books cash) equals the Balance Sheet ledger
//      cash for the same entity (report cashFlow.closingCashMinor over full
//      history) — same source, no silent contradiction.
//   2. a posted self-transfer between two own cash accounts contributes 0 to
//      cashFlowByMonth.netMinor and to the cumulative cashSparkline.

async function setupWorkspace(t: TestConvex<typeof schema>) {
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
    return { userId, workspaceId, now };
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|cashflow",
    issuer: "test",
    email: "owner@example.com",
  });
}

describe("dashboard cash + cash-flow correctness (E9-T1)", () => {
  it("dashboard books-cash equals the Balance Sheet ledger cash and transfers net to zero", async () => {
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    const session = authed(t, base.userId);

    const entityId = await t.run(async (ctx) => {
      const now = base.now;
      const eid = await ctx.db.insert("entities", {
        workspaceId: base.workspaceId, name: "Cashflow Co", slug: "cashflow-co",
        businessType: "services", currency: "USD", isDemo: false, archived: false,
        createdAt: now, updatedAt: now,
      });
      const checking = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Checking", type: "asset", subtype: "checking", number: "1010", currency: "USD", isSystem: true, archived: false, createdAt: now, updatedAt: now });
      const savings = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Savings", type: "asset", subtype: "savings", number: "1020", currency: "USD", isSystem: true, archived: false, createdAt: now, updatedAt: now });
      const income = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Services Revenue", type: "income", subtype: "services", number: "4100", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
      const expense = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Software", type: "expense", subtype: "software", number: "6000", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
      // Both cash accounts are bank-linked so the dashboard counts both as cash.
      await ctx.db.insert("bankAccounts", { entityId: eid, ledgerAccountId: checking, name: "Checking", mask: "1111", kind: "checking", balanceMinor: 0, includeInSync: true, createdAt: now, updatedAt: now });
      await ctx.db.insert("bankAccounts", { entityId: eid, ledgerAccountId: savings, name: "Savings", mask: "2222", kind: "savings", balanceMinor: 0, includeInSync: true, createdAt: now, updatedAt: now });

      async function post(date: string, debit: Id<"ledgerAccounts">, credit: Id<"ledgerAccounts">, amountMinor: number) {
        const entryId = await ctx.db.insert("journalEntries", { entityId: eid, date, memo: "seed", source: "manual", postedByUserId: base.userId, locked: true, createdAt: now });
        await ctx.db.insert("journalLines", { entityId: eid, entryId, accountId: debit, debitMinor: amountMinor, creditMinor: 0, currency: "USD", createdAt: now });
        await ctx.db.insert("journalLines", { entityId: eid, entryId, accountId: credit, debitMinor: 0, creditMinor: amountMinor, currency: "USD", createdAt: now });
      }
      // Cash inflow (income), a cash outflow (expense), and a checking→savings
      // self-transfer. Books cash = 500 - 120 = 380 across the two accounts.
      await post("2026-06-03", checking, income, 500_00);
      await post("2026-06-08", expense, checking, 120_00);
      await post("2026-06-12", savings, checking, 200_00); // pure transfer
      return eid;
    });

    const dashboard = await session.query(api.coreViews.dashboard, { entityId, period: "2026-06" });
    expect(dashboard).not.toBeNull();
    if (!dashboard) return;

    // Full-history report so cashFlow.closingCashMinor IS the ledger cash position.
    const report = await session.query(api.reportViews.reportPack, {
      entityId,
      startDate: "2000-01-01",
      endDate: "2026-12-31",
      basis: "accrual",
      compare: "none",
      columnMode: "total",
    });

    // (1) Same ledger source — dashboard books cash == report ledger cash.
    expect(dashboard.cashPositionMinor).toBe(380_00);
    expect(dashboard.cashPositionMinor).toBe(report.cashFlow.closingCashMinor);
    expect(dashboard.cashReconciliation.booksCashMinor).toBe(380_00);

    // (2) Transfer-aware: only income (+500) and expense (-120) move the chart;
    // the $200 self-transfer nets to zero.
    const june = dashboard.cashFlowByMonth.find((row) => row.month === "2026-06");
    expect(june).toMatchObject({ inflowMinor: 500_00, outflowMinor: 120_00, netMinor: 380_00 });
    expect(dashboard.cashSparkline.at(-1)).toBe(380_00);
  });

  it("excludes entries flagged by the canonical transferPairId from the cash-flow series (Q45)", async () => {
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    const session = authed(t, base.userId);

    const entityId = await t.run(async (ctx) => {
      const now = base.now;
      const eid = await ctx.db.insert("entities", {
        workspaceId: base.workspaceId, name: "Flag Co", slug: "flag-co",
        businessType: "services", currency: "USD", isDemo: false, archived: false,
        createdAt: now, updatedAt: now,
      });
      const checking = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Checking", type: "asset", subtype: "checking", number: "1010", currency: "USD", isSystem: true, archived: false, createdAt: now, updatedAt: now });
      const savings = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Savings", type: "asset", subtype: "savings", number: "1020", currency: "USD", isSystem: true, archived: false, createdAt: now, updatedAt: now });
      const income = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Services Revenue", type: "income", subtype: "services", number: "4100", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
      const bankChecking = await ctx.db.insert("bankAccounts", { entityId: eid, ledgerAccountId: checking, name: "Checking", mask: "1111", kind: "checking", balanceMinor: 0, includeInSync: true, createdAt: now, updatedAt: now });
      await ctx.db.insert("bankAccounts", { entityId: eid, ledgerAccountId: savings, name: "Savings", mask: "2222", kind: "savings", balanceMinor: 0, includeInSync: true, createdAt: now, updatedAt: now });

      async function postWithLines(date: string, lines: Array<{ accountId: Id<"ledgerAccounts">; debitMinor: number; creditMinor: number }>) {
        const entryId = await ctx.db.insert("journalEntries", { entityId: eid, date, memo: "seed", source: "manual", postedByUserId: base.userId, locked: true, createdAt: now });
        for (const line of lines) {
          await ctx.db.insert("journalLines", { entityId: eid, entryId, accountId: line.accountId, debitMinor: line.debitMinor, creditMinor: line.creditMinor, currency: "USD", createdAt: now });
        }
        return entryId;
      }

      // Real income: +300 into checking.
      await postWithLines("2026-06-04", [
        { accountId: checking, debitMinor: 300_00, creditMinor: 0 },
        { accountId: income, debitMinor: 0, creditMinor: 300_00 },
      ]);
      // A transfer posted as a cash↔NON-cash structural shape (so the structural
      // backstop would NOT catch it) but flagged with transferPairId on its
      // transaction. The canonical flag must still drop it from the chart.
      const transferEntryId = await postWithLines("2026-06-09", [
        { accountId: checking, debitMinor: 0, creditMinor: 150_00 },
        { accountId: income, debitMinor: 150_00, creditMinor: 0 },
      ]);
      await ctx.db.insert("transactions", {
        entityId: eid, bankAccountId: bankChecking, date: "2026-06-09", amountMinor: -150_00,
        currency: "USD", merchant: "Transfer to savings", rawDescription: "transfer", status: "posted",
        review: "auto", source: "bank", entryId: transferEntryId, transferPairId: "pair-xyz",
        externalId: "txn-transfer-xyz", evalSet: false, createdAt: now, updatedAt: now,
      });
      return eid;
    });

    const dashboard = await session.query(api.coreViews.dashboard, { entityId, period: "2026-06" });
    expect(dashboard).not.toBeNull();
    if (!dashboard) return;

    // Only the +300 income moves the chart; the flagged transfer is excluded
    // even though it carries a non-cash counter-line.
    const june = dashboard.cashFlowByMonth.find((row) => row.month === "2026-06");
    expect(june).toMatchObject({ inflowMinor: 300_00, outflowMinor: 0, netMinor: 300_00 });
  });
});
