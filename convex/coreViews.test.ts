/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const limitsSnapshotRef = makeFunctionReference<
  "query",
  { entityId?: Id<"entities"> },
  {
    dashboard: { limit: number; truncated: boolean; rowCounts: { totalRows: number } };
    reportPack: { limit: number; truncated: boolean; rowCounts: { totalRows: number } };
    transactionsRegister: { rowsReturned: number; boundedPageSize: number };
    checks: { dashboardUnderLimit: boolean; reportUnderLimit: boolean; transactionsPageBounded: boolean };
  }
>("performance:limitsSnapshot");

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

    async function seedEntity({
      name,
      slug,
      amountMinor,
      merchant,
      inbox,
    }: {
      name: string;
      slug: string;
      amountMinor: number;
      merchant: string;
      inbox: boolean;
    }) {
      const entityId = await ctx.db.insert("entities", {
        workspaceId,
        name,
        slug,
        businessType: "services",
        currency: "USD",
        isDemo: slug === "acme-studio-llc",
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      const cashAccountId = await ctx.db.insert("ledgerAccounts", {
        entityId,
        name: "Operating Checking",
        type: "asset",
        subtype: "bank",
        number: "1010",
        currency: "USD",
        isSystem: true,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      const incomeAccountId = await ctx.db.insert("ledgerAccounts", {
        entityId,
        name: "Services Revenue",
        type: "income",
        subtype: "services",
        number: "4100",
        currency: "USD",
        isSystem: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      const bankAccountId = await ctx.db.insert("bankAccounts", {
        entityId,
        ledgerAccountId: cashAccountId,
        name: `${name} Checking`,
        mask: slug === "live-sandbox" ? "4242" : "1001",
        kind: "checking",
        balanceMinor: amountMinor,
        includeInSync: true,
        createdAt: now,
        updatedAt: now,
      });
      const entryId = await ctx.db.insert("journalEntries", {
        entityId,
        date: "2026-06-12",
        memo: `${merchant} deposit`,
        source: "manual",
        sourceId: `${slug}:entry`,
        postedByUserId: userId,
        locked: true,
        createdAt: now,
      });
      await ctx.db.insert("journalLines", {
        entityId,
        entryId,
        accountId: cashAccountId,
        debitMinor: amountMinor,
        creditMinor: 0,
        currency: "USD",
        createdAt: now,
      });
      await ctx.db.insert("journalLines", {
        entityId,
        entryId,
        accountId: incomeAccountId,
        debitMinor: 0,
        creditMinor: amountMinor,
        currency: "USD",
        createdAt: now,
      });
      const transactionId = await ctx.db.insert("transactions", {
        entityId,
        bankAccountId,
        date: "2026-06-12",
        amountMinor,
        currency: "USD",
        merchant,
        rawDescription: `${merchant} deposit`,
        status: "posted",
        review: inbox ? "needs_review" : "confirmed",
        source: "bank",
        categoryAccountId: incomeAccountId,
        entryId,
        externalId: `${slug}:transaction`,
        evalSet: false,
        createdAt: now,
        updatedAt: now,
      });
      if (inbox) {
        await ctx.db.insert("inboxItems", {
          entityId,
          transactionId,
          kind: "categorize",
          payloadSummary: `${merchant} needs review`,
          status: "open",
          createdAt: now,
          updatedAt: now,
        });
      }
      return entityId;
    }

    const demoEntityId = await seedEntity({
      name: "Acme Studio LLC",
      slug: "acme-studio-llc",
      amountMinor: 125_00,
      merchant: "Acme Retainer",
      inbox: false,
    });
    const liveEntityId = await seedEntity({
      name: "Live Sandbox",
      slug: "live-sandbox",
      amountMinor: 990_00,
      merchant: "Live Sandbox Plaid Deposit",
      inbox: true,
    });
    const freshEntityId = await ctx.db.insert("entities", {
      workspaceId,
      name: "Fresh Books LLC",
      slug: "fresh-books",
      businessType: "services",
      currency: "USD",
      isDemo: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, demoEntityId, liveEntityId, freshEntityId };
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|core-views",
    issuer: "test",
    email: "owner@example.com",
  });
}

describe("core read models scope to the selected entity", () => {
  it("keeps demo, Live Sandbox, and fresh-business reads isolated", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);

    // E5-T1: the deterministic default resolver (resolveDefaultEntity) returns
    // the oldest non-archived, NON-DEMO entity when no explicit default is set —
    // never a name/slug match. Acme is the demo (isDemo:true) so the default
    // dashboard resolves the oldest real business, "Live Sandbox".
    const defaultDashboard = await session.query(api.coreViews.dashboard, {});
    expect(defaultDashboard?.entity.name).toBe("Live Sandbox");
    expect(defaultDashboard?.cashPositionMinor).toBe(990_00);

    // Setting an explicit default flips resolution to that business.
    await session.mutation(api.entities.setDefaultBusiness, { entityId: ids.freshEntityId });
    const reDefaulted = await session.query(api.coreViews.dashboard, {});
    expect(reDefaulted?.entity.name).toBe("Fresh Books LLC");

    const liveDashboard = await session.query(api.coreViews.dashboard, { entityId: ids.liveEntityId });
    expect(liveDashboard?.entity.name).toBe("Live Sandbox");
    expect(liveDashboard?.cashPositionMinor).toBe(990_00);
    expect(liveDashboard?.readStats.transactions).toBe(1);
    expect(liveDashboard?.readStats.totalRows).toBeGreaterThanOrEqual(6);
    expect(liveDashboard?.readStats.truncated).toBe(false);

    const liveRegister = await session.query(api.coreViews.transactions, { entityId: ids.liveEntityId, review: "all" });
    expect(liveRegister?.entity.id).toBe(ids.liveEntityId);
    expect(liveRegister?.rows).toHaveLength(1);
    expect(liveRegister?.rows[0]?.merchant).toBe("Live Sandbox Plaid Deposit");

    const liveInbox = await session.query(api.coreViews.inbox, { entityId: ids.liveEntityId });
    expect(liveInbox?.items).toHaveLength(1);
    expect(liveInbox?.items[0]?.merchant).toBe("Live Sandbox Plaid Deposit");

    const livePack = await session.query(api.reportViews.reportPack, {
      entityId: ids.liveEntityId,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      basis: "accrual",
      compare: "none",
      columnMode: "total",
    });
    expect(livePack.entity.name).toBe("Live Sandbox");
    expect(livePack.profitAndLoss.incomeMinor).toBe(990_00);
    expect(livePack.limits.truncated).toBe(false);

    const freshDashboard = await session.query(api.coreViews.dashboard, { entityId: ids.freshEntityId });
    expect(freshDashboard?.entity.name).toBe("Fresh Books LLC");
    expect(freshDashboard?.cashPositionMinor).toBe(0);
    expect(freshDashboard?.recentActivity).toHaveLength(0);
    expect(freshDashboard?.readStats.totalRows).toBe(0);
  });

  it("exposes bounded performance row-count snapshots", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);

    const snapshot = await session.query(limitsSnapshotRef, { entityId: ids.liveEntityId });

    expect(snapshot).toMatchObject({
      dashboard: { limit: 5000, truncated: false },
      reportPack: { limit: 5000, truncated: false },
      transactionsRegister: { rowsReturned: 1, boundedPageSize: 120 },
      checks: {
        dashboardUnderLimit: true,
        reportUnderLimit: true,
        transactionsPageBounded: true,
      },
    });
    expect(snapshot.dashboard.rowCounts.totalRows).toBeGreaterThanOrEqual(6);
    expect(snapshot.reportPack.rowCounts.totalRows).toBeGreaterThanOrEqual(6);
  });

  it("computes cockpit insights: aging, DSO, cushion, coming-up, concentration, payroll mix", async () => {
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    const session = authed(t, base.userId);

    const entityId = await t.run(async (ctx) => {
      const now = Date.now();
      const workspace = await ctx.db.query("workspaces").first();
      const workspaceId = workspace!._id;
      const eid = await ctx.db.insert("entities", {
        workspaceId, name: "Cockpit Co", slug: "cockpit-co", businessType: "services",
        currency: "USD", isDemo: false, archived: false, createdAt: now, updatedAt: now,
      });
      const cash = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Operating Checking", type: "asset", subtype: "bank", number: "1010", currency: "USD", isSystem: true, archived: false, createdAt: now, updatedAt: now });
      const income = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Services Revenue", type: "income", subtype: "services", number: "4100", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
      const expense = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Software", type: "expense", subtype: "software", number: "6000", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
      await ctx.db.insert("bankAccounts", { entityId: eid, ledgerAccountId: cash, name: "Cockpit Checking", mask: "1212", kind: "checking", balanceMinor: 5000_00, includeInSync: true, createdAt: now, updatedAt: now });

      async function post(date: string, debitAccount: Id<"ledgerAccounts">, creditAccount: Id<"ledgerAccounts">, amountMinor: number) {
        const entryId = await ctx.db.insert("journalEntries", { entityId: eid, date, memo: "seed", source: "manual", postedByUserId: base.userId, locked: true, createdAt: now });
        await ctx.db.insert("journalLines", { entityId: eid, entryId, accountId: debitAccount, debitMinor: amountMinor, creditMinor: 0, currency: "USD", createdAt: now });
        await ctx.db.insert("journalLines", { entityId: eid, entryId, accountId: creditAccount, debitMinor: 0, creditMinor: amountMinor, currency: "USD", createdAt: now });
      }
      // May income 6000 / expense 4000; June income 8000 / expense 5000; cash nets 5000.
      await post("2026-05-10", cash, income, 6000_00);
      await post("2026-05-15", expense, cash, 4000_00);
      await post("2026-06-10", cash, income, 8000_00);
      await post("2026-06-15", expense, cash, 5000_00);

      const custA = await ctx.db.insert("contacts", { entityId: eid, name: "Halpern Co", roles: ["customer"], aliases: [], createdAt: now, updatedAt: now });
      const custB = await ctx.db.insert("contacts", { entityId: eid, name: "Beacon Press", roles: ["customer"], aliases: [], createdAt: now, updatedAt: now });
      const vendX = await ctx.db.insert("contacts", { entityId: eid, name: "WeWork", roles: ["vendor"], aliases: [], createdAt: now, updatedAt: now });
      const vendY = await ctx.db.insert("contacts", { entityId: eid, name: "AWS", roles: ["vendor"], aliases: [], createdAt: now, updatedAt: now });

      // Open June invoices: A past-due (overdue name), B not-yet-due (coming-up inflow).
      await ctx.db.insert("invoices", { entityId: eid, contactId: custA, number: "INV-1", status: "open", currency: "USD", issueDate: "2026-06-01", dueDate: "2026-06-20", totalMinor: 6000_00, amountPaidMinor: 0, entryIds: [], createdAt: now, updatedAt: now });
      await ctx.db.insert("invoices", { entityId: eid, contactId: custB, number: "INV-2", status: "open", currency: "USD", issueDate: "2026-06-05", dueDate: "2026-07-10", totalMinor: 2000_00, amountPaidMinor: 0, entryIds: [], createdAt: now, updatedAt: now });
      // Paid invoice, 30-day net terms -> DSO 30.
      await ctx.db.insert("invoices", { entityId: eid, contactId: custA, number: "INV-0", status: "paid", currency: "USD", issueDate: "2026-05-01", dueDate: "2026-05-31", totalMinor: 3000_00, amountPaidMinor: 3000_00, entryIds: [], createdAt: now, updatedAt: now });

      // Open bills: one due within a week of period end, one later in the 30-day window.
      await ctx.db.insert("bills", { entityId: eid, contactId: vendX, status: "open", issueDate: "2026-06-20", dueDate: "2026-07-02", totalMinor: 1500_00, currency: "USD", entryIds: [], createdAt: now, updatedAt: now });
      await ctx.db.insert("bills", { entityId: eid, contactId: vendY, status: "open", issueDate: "2026-06-20", dueDate: "2026-07-20", totalMinor: 800_00, currency: "USD", entryIds: [], createdAt: now, updatedAt: now });

      // June payroll run with a two-currency mix.
      const runId = await ctx.db.insert("payrollRuns", { entityId: eid, period: "2026-06", status: "paid", totalBaseMinor: 6000_00, entryIds: [], createdAt: now, updatedAt: now });
      await ctx.db.insert("payrollRunLines", { entityId: eid, runId, employeeName: "Ana", country: "US", currency: "USD", baseSalaryMinor: 5000_00, adjustmentMinor: 0, fxRateMicros: 1_000_000, finalLocalMinor: 5000_00, baseEquivalentMinor: 5000_00, paid: true, createdAt: now, updatedAt: now });
      await ctx.db.insert("payrollRunLines", { entityId: eid, runId, employeeName: "Bilal", country: "PK", currency: "PKR", baseSalaryMinor: 1_000_000_00, adjustmentMinor: 0, fxRateMicros: 278_000_000, finalLocalMinor: 1_000_000_00, baseEquivalentMinor: 1000_00, paid: true, createdAt: now, updatedAt: now });
      return eid;
    });

    const d = await session.query(api.coreViews.dashboard, { entityId, period: "2026-06" });
    expect(d).not.toBeNull();
    if (!d) return;

    expect(d.cashPositionMinor).toBe(5000_00);
    expect(d.profitAndLoss).toMatchObject({
      incomeMinor: 8000_00, expenseMinor: 5000_00, netIncomeMinor: 3000_00,
      marginPct: 38, previousNetIncomeMinor: 2000_00,
    });
    expect(d.profitAndLossTrend).toHaveLength(6);
    expect(d.profitAndLossTrend.at(-1)).toMatchObject({ month: "2026-06", incomeMinor: 8000_00, expenseMinor: 5000_00 });

    expect(d.receivables.aging).toEqual({ currentMinor: 8000_00, days30Minor: 0, days60Minor: 0, days90Minor: 0 });
    expect(d.receivables.overdue.map((o) => o.name)).toContain("Halpern Co");
    expect(d.receivables.averageDaysToPay).toBe(30);

    expect(d.payables.dueThisWeekMinor).toBe(1500_00);
    expect(d.payables.upcoming.map((b) => b.vendor)).toEqual(["WeWork", "AWS"]);

    expect(d.cashCushion.avgMonthlyExpenseMinor).toBe(4500_00);
    expect(d.cashCushion.months).toBeCloseTo(1.1, 5);

    expect(d.comingUp.items.map((i) => i.kind)).toEqual(expect.arrayContaining(["invoice", "bill", "payroll"]));
    expect(d.comingUp.netMinor).toBe(2000_00 - 1500_00 - 800_00 - 6000_00);

    expect(d.incomeConcentration.topName).toBe("Halpern Co");
    expect(d.incomeConcentration.topSharePct).toBe(75);

    expect(d.payrollMeta).not.toBeNull();
    expect(d.payrollMeta?.headcount).toBe(2);
    expect(d.payrollMeta?.nextRunDate).toBe("2026-07-31");
    expect(d.payrollMeta?.currencies).toHaveLength(2);
  });

  it("shows ledger-derived cash with a bank-vs-books reconciliation line for a connected account (E9-T1)", async () => {
    // E9-T1: the cash tile reads the LEDGER (books) balance — the same source as
    // the Balance Sheet — not the live Plaid balance. The live balance is kept
    // separately (liveBalanceMinor) and surfaced only as an explicit
    // reconciliation gap, so the dashboard and reports can never silently
    // contradict each other.
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    const session = authed(t, base.userId);

    const entityId = await t.run(async (ctx) => {
      const now = Date.now();
      const workspace = await ctx.db.query("workspaces").first();
      const workspaceId = workspace!._id;
      const eid = await ctx.db.insert("entities", {
        workspaceId,
        name: "Connected Balance LLC",
        slug: "connected-balance",
        businessType: "services",
        currency: "USD",
        isDemo: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      const cash = await ctx.db.insert("ledgerAccounts", {
        entityId: eid,
        name: "Mercury Checking",
        type: "asset",
        subtype: "bank",
        number: "1010",
        currency: "USD",
        isSystem: true,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      const bankAccountId = await ctx.db.insert("bankAccounts", {
        entityId: eid,
        ledgerAccountId: cash,
        name: "Mercury Checking",
        mask: "7137",
        kind: "checking",
        balanceMinor: 12_345_67,
        includeInSync: true,
        plaidAccountId: "plaid-connected-checking",
        plaidItemId: "plaid-item-1",
        createdAt: now,
        updatedAt: now,
      });
      // One unposted transaction explains the bank-vs-books gap.
      await ctx.db.insert("transactions", {
        entityId: eid,
        bankAccountId,
        date: "2026-06-12",
        amountMinor: 12_345_67,
        currency: "USD",
        merchant: "Opening deposit",
        rawDescription: "Opening deposit",
        status: "pending",
        review: "needs_review",
        source: "bank",
        externalId: "connected-balance:txn",
        evalSet: false,
        createdAt: now,
        updatedAt: now,
      });
      return eid;
    });

    const dashboard = await session.query(api.coreViews.dashboard, { entityId });
    // Books cash is ledger-derived: nothing posted yet, so it is 0 — NOT the
    // live Plaid balance.
    expect(dashboard?.cashPositionMinor).toBe(0);
    expect(dashboard?.bankBalances[0]).toMatchObject({
      name: "Mercury Checking",
      amountMinor: 0,
      liveBalanceMinor: 12_345_67,
    });
    // The gap is surfaced explicitly, with the unreviewed backlog that explains it.
    expect(dashboard?.cashReconciliation).toMatchObject({
      booksCashMinor: 0,
      bankCashMinor: 12_345_67,
      differenceMinor: 12_345_67,
      itemsToReviewCount: 1,
    });
  });

  it("nets a self-transfer between two own cash accounts to zero in the cash-flow chart (E9-T1)", async () => {
    // E9-T1 / E1-T6: a checking→savings transfer is zero net cash to the
    // business, so it must NOT move the dashboard cash-flow series or sparkline.
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    const session = authed(t, base.userId);

    const entityId = await t.run(async (ctx) => {
      const now = Date.now();
      const workspace = await ctx.db.query("workspaces").first();
      const workspaceId = workspace!._id;
      const eid = await ctx.db.insert("entities", {
        workspaceId, name: "Transfer Co", slug: "transfer-co", businessType: "services",
        currency: "USD", isDemo: false, archived: false, createdAt: now, updatedAt: now,
      });
      const checking = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Checking", type: "asset", subtype: "checking", number: "1010", currency: "USD", isSystem: true, archived: false, createdAt: now, updatedAt: now });
      const savings = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Savings", type: "asset", subtype: "savings", number: "1020", currency: "USD", isSystem: true, archived: false, createdAt: now, updatedAt: now });
      const income = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Services Revenue", type: "income", subtype: "services", number: "4100", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
      await ctx.db.insert("bankAccounts", { entityId: eid, ledgerAccountId: checking, name: "Checking", mask: "1111", kind: "checking", balanceMinor: 0, includeInSync: true, createdAt: now, updatedAt: now });
      await ctx.db.insert("bankAccounts", { entityId: eid, ledgerAccountId: savings, name: "Savings", mask: "2222", kind: "savings", balanceMinor: 0, includeInSync: true, createdAt: now, updatedAt: now });

      async function post(date: string, debit: Id<"ledgerAccounts">, credit: Id<"ledgerAccounts">, amountMinor: number) {
        const entryId = await ctx.db.insert("journalEntries", { entityId: eid, date, memo: "seed", source: "manual", postedByUserId: base.userId, locked: true, createdAt: now });
        await ctx.db.insert("journalLines", { entityId: eid, entryId, accountId: debit, debitMinor: amountMinor, creditMinor: 0, currency: "USD", createdAt: now });
        await ctx.db.insert("journalLines", { entityId: eid, entryId, accountId: credit, debitMinor: 0, creditMinor: amountMinor, currency: "USD", createdAt: now });
      }
      // A real cash inflow (income) then a pure checking→savings transfer.
      await post("2026-06-05", checking, income, 100_00);
      await post("2026-06-10", savings, checking, 40_00);
      return eid;
    });

    const dashboard = await session.query(api.coreViews.dashboard, { entityId, period: "2026-06" });
    const june = dashboard?.cashFlowByMonth.find((row) => row.month === "2026-06");
    // Only the $100 income inflow counts; the $40 transfer nets to zero.
    expect(june).toMatchObject({ inflowMinor: 100_00, outflowMinor: 0, netMinor: 100_00 });
    // Sparkline ends at the cumulative net (transfer contributes nothing).
    expect(dashboard?.cashSparkline.at(-1)).toBe(100_00);
    // Books cash sums both accounts: checking 60 + savings 40 = 100.
    expect(dashboard?.cashPositionMinor).toBe(100_00);
  });
});
