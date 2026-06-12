/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

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

    const defaultDashboard = await session.query(api.coreViews.dashboard, {});
    expect(defaultDashboard?.entity.name).toBe("Acme Studio LLC");
    expect(defaultDashboard?.cashPositionMinor).toBe(125_00);

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
});
