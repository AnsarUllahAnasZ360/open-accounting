/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import { defaultReportWindow } from "./agentTools";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// E1-T11 — the dashboard trailing window must be SERVER-CLOCK-derived, never a
// frozen 2025-07…2026-06 literal, and its cash-flow-by-month series must equal
// the Cash Flow report's monthly cash movement (ledger-derived, transfers
// netted out — the corrected E1-T6 logic). We pin "today" explicitly so the
// assertions are deterministic regardless of the real calendar.

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
    tokenIdentifier: "test|window",
    issuer: "test",
    email: "owner@example.com",
  });
}

describe("dashboard server-clock window + cash-flow parity (E1-T11)", () => {
  it("ends the trailing window at the server month and matches the Cash Flow report", async () => {
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    const session = authed(t, base.userId);

    const entityId = await t.run(async (ctx) => {
      const now = base.now;
      const eid = await ctx.db.insert("entities", {
        workspaceId: base.workspaceId,
        name: "Window Co",
        slug: "window-co",
        businessType: "services",
        currency: "USD",
        isDemo: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      const checking = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Checking", type: "asset", subtype: "checking", number: "1010", currency: "USD", isSystem: true, archived: false, createdAt: now, updatedAt: now });
      const savings = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Savings", type: "asset", subtype: "savings", number: "1020", currency: "USD", isSystem: true, archived: false, createdAt: now, updatedAt: now });
      const income = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Services Revenue", type: "income", subtype: "services", number: "4100", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
      const expense = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Software", type: "expense", subtype: "software", number: "6000", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
      await ctx.db.insert("bankAccounts", { entityId: eid, ledgerAccountId: checking, name: "Checking", mask: "1111", kind: "checking", balanceMinor: 0, includeInSync: true, createdAt: now, updatedAt: now });
      await ctx.db.insert("bankAccounts", { entityId: eid, ledgerAccountId: savings, name: "Savings", mask: "2222", kind: "savings", balanceMinor: 0, includeInSync: true, createdAt: now, updatedAt: now });

      async function post(date: string, debit: Id<"ledgerAccounts">, credit: Id<"ledgerAccounts">, amountMinor: number) {
        const entryId = await ctx.db.insert("journalEntries", { entityId: eid, date, memo: "seed", source: "manual", postedByUserId: base.userId, locked: true, createdAt: now });
        await ctx.db.insert("journalLines", { entityId: eid, entryId, accountId: debit, debitMinor: amountMinor, creditMinor: 0, currency: "USD", createdAt: now });
        await ctx.db.insert("journalLines", { entityId: eid, entryId, accountId: credit, debitMinor: 0, creditMinor: amountMinor, currency: "USD", createdAt: now });
      }
      // April income, May expense, and a May checking→savings self-transfer.
      await post("2026-04-10", checking, income, 700_00);
      await post("2026-05-14", expense, checking, 250_00);
      await post("2026-05-20", savings, checking, 300_00); // pure transfer
      return eid;
    });

    const today = "2026-06-20";
    const dashboard = await session.query(api.coreViews.dashboard, { entityId, today, period: "2026-05" });
    expect(dashboard).not.toBeNull();
    if (!dashboard) return;

    // (1) No frozen literal: the trailing window ENDS at the server month and
    // spans 12 months back inclusive.
    expect(dashboard.trendWindow.endMonth).toBe("2026-06");
    expect(dashboard.trendWindow.startMonth).toBe("2025-07");
    expect(dashboard.trendWindow.months).toHaveLength(12);
    expect(dashboard.cashFlowByMonth.at(-1)?.month).toBe("2026-06");
    expect(dashboard.cashFlowByMonth.at(0)?.month).toBe("2025-07");

    // (2) Parity with the Cash Flow report (ledger-derived, transfers netted).
    // April: +700 inflow. May: -250 outflow (the 300 transfer nets to zero).
    const april = dashboard.cashFlowByMonth.find((row) => row.month === "2026-04");
    const may = dashboard.cashFlowByMonth.find((row) => row.month === "2026-05");
    expect(april).toMatchObject({ inflowMinor: 700_00, outflowMinor: 0, netMinor: 700_00 });
    expect(may).toMatchObject({ inflowMinor: 0, outflowMinor: 250_00, netMinor: -250_00 });

    // The report's per-month cash movement for the SAME months must equal the
    // dashboard's series — proving the dashboard trend is no longer a raw-txn sum.
    for (const month of ["2026-04", "2026-05"]) {
      const start = `${month}-01`;
      const end = `${month}-28`;
      const report = await session.query(api.reportViews.reportPack, {
        entityId,
        startDate: start,
        endDate: end,
        basis: "accrual",
        compare: "none",
        columnMode: "total",
      });
      const reportNet = report.cashFlow.netCashChangeMinor;
      const dash = dashboard.cashFlowByMonth.find((row) => row.month === month);
      expect(dash?.netMinor).toBe(reportNet);
    }
  });

  it("falls back to the current server month with no frozen literal on an empty book", async () => {
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    const session = authed(t, base.userId);

    const entityId = await t.run(async (ctx) => {
      const now = base.now;
      return await ctx.db.insert("entities", {
        workspaceId: base.workspaceId,
        name: "Empty Co",
        slug: "empty-co",
        businessType: "services",
        currency: "USD",
        isDemo: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
    });

    const dashboard = await session.query(api.coreViews.dashboard, { entityId, today: "2027-02-15" });
    expect(dashboard).not.toBeNull();
    if (!dashboard) return;
    // Window anchors to "today" (2027), not the old 2026-06 literal.
    expect(dashboard.trendWindow.endMonth).toBe("2027-02");
    expect(dashboard.trendWindow.startMonth).toBe("2026-03");
    expect(dashboard.latestMonth).toBe("2027-02");
  });

  it("shifts the dashboard trailing window forward when asOf advances (E9-T2)", async () => {
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    const session = authed(t, base.userId);
    const entityId = await t.run(async (ctx) => {
      const now = base.now;
      return await ctx.db.insert("entities", {
        workspaceId: base.workspaceId, name: "Shift Co", slug: "shift-co",
        businessType: "services", currency: "USD", isDemo: false, archived: false,
        createdAt: now, updatedAt: now,
      });
    });
    // E9-T2 verify recipe: asOf='2027-03-15' → trailing window ends at '2027-03'.
    const dashboard = await session.query(api.coreViews.dashboard, { entityId, today: "2027-03-15" });
    expect(dashboard?.trendWindow.endMonth).toBe("2027-03");
    expect(dashboard?.cashFlowByMonth.at(-1)?.month).toBe("2027-03");
  });
});

describe("Ask-AI default report window is server-clock derived (E9-T2)", () => {
  it("'this period' resolves to the current year-to-date, never a frozen 2026 window", () => {
    // March 2027.
    const window2027 = defaultReportWindow(Date.UTC(2027, 2, 15));
    expect(window2027.startDate).toBe("2027-01-01");
    expect(window2027.endDate).toBe("2027-03-15");
    expect(window2027.startDate.startsWith("2026")).toBe(false);

    // A different year proves the helper tracks the clock, not a literal.
    const window2030 = defaultReportWindow(Date.UTC(2030, 10, 2));
    expect(window2030.startDate).toBe("2030-01-01");
    expect(window2030.endDate).toBe("2030-11-02");
  });
});
