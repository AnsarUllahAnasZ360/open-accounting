/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Two-entity workspace with real journal entries so the portfolio roll-up sums
 * actual ledger figures (E5-T6). Each entity gets a cash account, an income
 * account, and an expense account plus a balanced posting.
 */
async function setupTwoEntities(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar workspace",
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

    async function buildEntity(name: string, slug: string, createdAt: number) {
      const entityId = await ctx.db.insert("entities", {
        workspaceId,
        name,
        slug,
        businessType: "services",
        currency: "USD",
        isDemo: false,
        archived: false,
        createdAt,
        updatedAt: createdAt,
      });
      async function account(
        number: string,
        accountName: string,
        type: "asset" | "income" | "expense",
        subtype: string,
      ) {
        return ctx.db.insert("ledgerAccounts", {
          entityId,
          number,
          name: accountName,
          type,
          subtype,
          currency: "USD",
          isSystem: true,
          archived: false,
          createdAt,
          updatedAt: createdAt,
        });
      }
      const cashId = await account("1010", "Operating Checking", "asset", "bank");
      const incomeId = await account("4000", "Services Revenue", "income", "services");
      const expenseId = await account("5000", "Software", "expense", "software");
      await ctx.db.insert("bankAccounts", {
        entityId,
        ledgerAccountId: cashId,
        name: "Checking",
        mask: "0000",
        kind: "checking",
        balanceMinor: 0,
        includeInSync: true,
        createdAt,
        updatedAt: createdAt,
      });
      return { entityId, cashId, incomeId, expenseId };
    }

    // Zikra created first (so it's the deterministic default / first by-business row).
    const zikra = await buildEntity("Zikra", "zikra", now);
    const z360 = await buildEntity("Z360", "z360", now + 1000);

    return { userId, workspaceId, zikra, z360 };
  });
}

/** Post the seeded journal entries through the real ledger mutation. */
async function seedLedger(
  t: TestConvex<typeof schema>,
  ids: Awaited<ReturnType<typeof setupTwoEntities>>,
) {
  const session = authed(t, ids.userId);
  const { zikra, z360 } = ids;
  // Zikra: +$3,000 cash sale, −$1,000 software expense → cash 2000, rev 3000, exp 1000.
  await session.mutation(api.ledger.postEntry, {
    entityId: zikra.entityId,
    date: "2026-06-05",
    memo: "Zikra cash sale",
    source: "manual",
    lines: [
      { accountId: zikra.cashId, debitMinor: 300000, creditMinor: 0, currency: "USD" },
      { accountId: zikra.incomeId, debitMinor: 0, creditMinor: 300000, currency: "USD" },
    ],
  });
  await session.mutation(api.ledger.postEntry, {
    entityId: zikra.entityId,
    date: "2026-06-08",
    memo: "Zikra software",
    source: "manual",
    lines: [
      { accountId: zikra.expenseId, debitMinor: 100000, creditMinor: 0, currency: "USD" },
      { accountId: zikra.cashId, debitMinor: 0, creditMinor: 100000, currency: "USD" },
    ],
  });
  // Z360: +$5,000 cash sale, −$2,000 software expense → cash 3000, rev 5000, exp 2000.
  await session.mutation(api.ledger.postEntry, {
    entityId: z360.entityId,
    date: "2026-06-06",
    memo: "Z360 cash sale",
    source: "manual",
    lines: [
      { accountId: z360.cashId, debitMinor: 500000, creditMinor: 0, currency: "USD" },
      { accountId: z360.incomeId, debitMinor: 0, creditMinor: 500000, currency: "USD" },
    ],
  });
  await session.mutation(api.ledger.postEntry, {
    entityId: z360.entityId,
    date: "2026-06-09",
    memo: "Z360 software",
    source: "manual",
    lines: [
      { accountId: z360.expenseId, debitMinor: 200000, creditMinor: 0, currency: "USD" },
      { accountId: z360.cashId, debitMinor: 0, creditMinor: 200000, currency: "USD" },
    ],
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|portfolio",
    issuer: "test",
    email: "owner@example.com",
  });
}

describe("portfolioDashboard (E5-T6)", () => {
  it("combined totals equal the sum of by-business figures (plain USD summation)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTwoEntities(t);
    await seedLedger(t, ids);
    const session = authed(t, ids.userId);

    const portfolio = await session.query(api.portfolioViews.portfolioDashboard, { scope: "all" });
    expect(portfolio).not.toBeNull();
    expect(portfolio!.businessCount).toBe(2);
    expect(portfolio!.currency).toBe("USD");

    const byBusiness = portfolio!.byBusiness;
    expect(byBusiness).toHaveLength(2);

    const sumCash = byBusiness.reduce((sum, row) => sum + row.cashMinor, 0);
    const sumRevenue = byBusiness.reduce((sum, row) => sum + row.revenueMinor, 0);
    const sumExpense = byBusiness.reduce((sum, row) => sum + row.expenseMinor, 0);

    expect(portfolio!.combined.cashMinor).toBe(sumCash);
    expect(portfolio!.combined.revenueMinor).toBe(sumRevenue);
    expect(portfolio!.combined.expenseMinor).toBe(sumExpense);

    // Hard numbers: cash 2000 + 3000 = 5000; rev 3000 + 5000 = 8000; exp 1000 + 2000 = 3000.
    expect(portfolio!.combined.cashMinor).toBe(500000);
    expect(portfolio!.combined.revenueMinor).toBe(800000);
    expect(portfolio!.combined.expenseMinor).toBe(300000);
    expect(portfolio!.combined.netIncomeMinor).toBe(500000);
  });

  it("coreViews.dashboard for a single entity returns the SAME numbers as its by-business row", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTwoEntities(t);
    await seedLedger(t, ids);
    const session = authed(t, ids.userId);

    const portfolio = await session.query(api.portfolioViews.portfolioDashboard, { scope: "all" });
    const zikraRow = portfolio!.byBusiness.find((row) => String(row.entityId) === String(ids.zikra.entityId));
    expect(zikraRow).toBeTruthy();

    const single = await session.query(api.coreViews.dashboard, { entityId: ids.zikra.entityId });
    expect(single).not.toBeNull();
    // The shared helper guarantees these can't drift.
    expect(single!.metrics.cashMinor).toBe(zikraRow!.cashMinor);
    expect(single!.metrics.revenueMinor).toBe(zikraRow!.revenueMinor);
    expect(single!.metrics.expenseMinor).toBe(zikraRow!.expenseMinor);
    expect(single!.metrics.arMinor).toBe(zikraRow!.arMinor);
    expect(single!.metrics.apMinor).toBe(zikraRow!.apMinor);
  });

  it("scopes to the caller's workspace entities only (no cross-workspace leakage)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTwoEntities(t);

    const other = await t.run(async (ctx) => {
      const now = Date.now();
      const otherUserId = await ctx.db.insert("users", { email: "other@example.com", name: "Other" });
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
      return { otherUserId };
    });

    void ids;
    const otherSession = authed(t, other.otherUserId);
    const view = await otherSession.query(api.portfolioViews.portfolioDashboard, { scope: "all" });
    // The other workspace has no entities → null, never workspace A's data.
    expect(view).toBeNull();
  });
});
