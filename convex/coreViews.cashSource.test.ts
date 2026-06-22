/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// E1-T10 — Dashboard cash and Balance-Sheet cash must read the SAME source (the
// ledger). The live Plaid balance is shown only as a separate, clearly-labelled
// "bank says X / books say Y — N to review" comparison, never as the primary
// cash figure. We seed a connected account whose live balance DIFFERS from the
// posted ledger to prove the dashboard never silently shows the live number.

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
    tokenIdentifier: "test|cash-source",
    issuer: "test",
    email: "owner@example.com",
  });
}

describe("dashboard cash unifies with Balance Sheet cash (E1-T10)", () => {
  it("headline cash equals Balance-Sheet ledger cash; live bank balance is a separate comparison", async () => {
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    const session = authed(t, base.userId);

    const entityId = await t.run(async (ctx) => {
      const now = base.now;
      const eid = await ctx.db.insert("entities", {
        workspaceId: base.workspaceId,
        name: "Source Co",
        slug: "source-co",
        businessType: "services",
        currency: "USD",
        isDemo: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      const cash = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Checking", type: "asset", subtype: "bank", number: "1010", currency: "USD", isSystem: true, archived: false, createdAt: now, updatedAt: now });
      const income = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Services Revenue", type: "income", subtype: "services", number: "4100", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
      const expense = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Software", type: "expense", subtype: "software", number: "6000", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
      // Connected account: live (Plaid) balance is 9999.99, but only 600 net is
      // actually POSTED to the ledger — the gap is the unreviewed backlog.
      const bankAccountId = await ctx.db.insert("bankAccounts", {
        entityId: eid, ledgerAccountId: cash, name: "Mercury Checking", mask: "4242",
        kind: "checking", balanceMinor: 9_999_99, includeInSync: true,
        plaidAccountId: "plaid-acct-1", plaidItemId: "plaid-item-1",
        createdAt: now, updatedAt: now,
      });

      async function post(date: string, debit: Id<"ledgerAccounts">, credit: Id<"ledgerAccounts">, amountMinor: number) {
        const entryId = await ctx.db.insert("journalEntries", { entityId: eid, date, memo: "seed", source: "manual", postedByUserId: base.userId, locked: true, createdAt: now });
        await ctx.db.insert("journalLines", { entityId: eid, entryId, accountId: debit, debitMinor: amountMinor, creditMinor: 0, currency: "USD", createdAt: now });
        await ctx.db.insert("journalLines", { entityId: eid, entryId, accountId: credit, debitMinor: 0, creditMinor: amountMinor, currency: "USD", createdAt: now });
      }
      // Posted: +1000 income, -400 expense -> ledger cash = 600.
      await post("2026-06-04", cash, income, 1000_00);
      await post("2026-06-09", expense, cash, 400_00);

      // Two unreviewed transactions explain the bank-vs-books gap (E1-T8 count).
      for (const ext of ["unrev-1", "unrev-2"]) {
        await ctx.db.insert("transactions", {
          entityId: eid, bankAccountId, date: "2026-06-15", amountMinor: 4_699_99,
          currency: "USD", merchant: "Pending deposit", rawDescription: "Pending deposit",
          status: "pending", review: "needs_review", source: "bank",
          externalId: `source-co:${ext}`, evalSet: false, createdAt: now, updatedAt: now,
        });
      }
      return eid;
    });

    const dashboard = await session.query(api.coreViews.dashboard, { entityId, period: "2026-06", today: "2026-06-20" });
    const report = await session.query(api.reportViews.reportPack, {
      entityId,
      startDate: "2000-01-01",
      endDate: "2026-12-31",
      basis: "accrual",
      compare: "none",
      columnMode: "total",
    });
    expect(dashboard).not.toBeNull();
    if (!dashboard) return;

    // Balance-Sheet cash = sum of the cash-account asset rows on the balance sheet.
    const assetSection = report.balanceSheet.sections.find((section) => section.key === "assets");
    const cashSubtypes = new Set(["bank", "cash", "checking", "savings"]);
    const balanceSheetCashMinor = (assetSection?.rows ?? [])
      .filter((row) => cashSubtypes.has(row.accountSubtype))
      .reduce((sum, row) => sum + row.totalMinor, 0);

    // (1) Dashboard headline cash === Balance-Sheet ledger cash (same source).
    expect(dashboard.cashPositionMinor).toBe(600_00);
    expect(dashboard.cashPositionMinor).toBe(balanceSheetCashMinor);
    expect(dashboard.cashPositionMinor).toBe(report.cashFlow.closingCashMinor);

    // (2) The live bank balance is NOT the primary figure — it is exposed
    // separately per account (bankSaysMinor / liveBalanceMinor) and as the
    // entity-level comparison block.
    expect(dashboard.bankBalances[0]).toMatchObject({
      name: "Mercury Checking",
      amountMinor: 600_00,
      bankSaysMinor: 9_999_99,
      liveBalanceMinor: 9_999_99,
    });

    // (3) The comparison block reuses E1-T8's unreviewed count and the canonical
    // {ledgerCashMinor, bankCashMinor, differenceMinor, unreviewedCount} names.
    expect(dashboard.cashReconciliation).toMatchObject({
      ledgerCashMinor: 600_00,
      bankCashMinor: 9_999_99,
      differenceMinor: 9_999_99 - 600_00,
      unreviewedCount: 2,
    });
    expect(dashboard.cashReconciliation.unreviewedCount).toBe(dashboard.unreviewed.unreviewedCount);
  });
});
