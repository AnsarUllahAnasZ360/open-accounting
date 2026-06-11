/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupPipeline(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      email: "owner@example.com",
      name: "Owner",
    });
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
    const operatingAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Operating Checking",
      type: "asset",
      subtype: "bank",
      number: "1010",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const savingsAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Savings",
      type: "asset",
      subtype: "bank",
      number: "1020",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const arAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Accounts Receivable",
      type: "asset",
      subtype: "receivable",
      number: "1100",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const softwareAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Software & SaaS",
      type: "expense",
      subtype: "software",
      number: "5200",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const servicesAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Services",
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
      ledgerAccountId: operatingAccountId,
      name: "Mercury Checking",
      mask: "1001",
      kind: "checking",
      balanceMinor: 0,
      includeInSync: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("rules", {
      entityId,
      order: 1,
      name: "Software subscriptions",
      descriptionContains: "subscription",
      direction: "outflow",
      categoryAccountId: softwareAccountId,
      autoPost: true,
      hitCount: 0,
      active: true,
      createdBy: "seed",
      createdAt: now,
      updatedAt: now,
    });

    return {
      userId,
      entityId,
      bankAccountId,
      operatingAccountId,
      savingsAccountId,
      arAccountId,
      softwareAccountId,
      servicesAccountId,
    };
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

describe("transaction pipeline", () => {
  it("auto-posts matching rules through postEntry", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPipeline(t);
    const session = authed(t, ids.userId);

    const result = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-04",
      amountMinor: -4999,
      currency: "USD",
      merchant: "Notion",
      rawDescription: "Notion subscription",
      status: "posted",
      source: "bank",
      externalId: "txn-rule-1",
    });

    expect(result.status).toBe("posted");
    expect(result.stage).toBe("rule");
    expect(result.entryId).toBeTruthy();

    const verification = await session.query(api.reports.seedVerification, { entityId: ids.entityId });
    expect(verification.trialBalanceDifferenceMinor).toBe(0);
    expect(verification.transactionCount).toBe(1);
    expect(verification.postedTransactionCount).toBe(1);
  });

  it("deduplicates imported transactions by external id", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPipeline(t);
    const session = authed(t, ids.userId);

    const args = {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-04",
      amountMinor: -2500,
      currency: "USD",
      merchant: "Linear",
      rawDescription: "Linear subscription",
      status: "posted" as const,
      source: "bank" as const,
      externalId: "txn-dupe-1",
    };
    const first = await session.mutation(api.pipeline.routeTransaction, args);
    const second = await session.mutation(api.pipeline.routeTransaction, args);

    expect(first.status).toBe("posted");
    expect(second.status).toBe("duplicate");
    expect(second.transactionId).toBe(first.transactionId);

    const verification = await session.query(api.reports.seedVerification, { entityId: ids.entityId });
    expect(verification.transactionCount).toBe(1);
    expect(verification.postedTransactionCount).toBe(1);
  });

  it("routes forced uncertainty to the Inbox without posting", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPipeline(t);
    const session = authed(t, ids.userId);

    const result = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-05",
      amountMinor: -8800,
      currency: "USD",
      merchant: "Client Lunch",
      rawDescription: "Needs receipt review",
      status: "posted",
      source: "bank",
      externalId: "txn-review-1",
      categoryAccountId: ids.softwareAccountId,
      forceReview: true,
    });

    expect(result.status).toBe("needs_review");
    expect(result.entryId).toBeNull();

    const verification = await session.query(api.reports.seedVerification, { entityId: ids.entityId });
    expect(verification.openInboxCount).toBe(1);
    expect(verification.postedTransactionCount).toBe(0);
    expect(verification.trialBalanceDifferenceMinor).toBe(0);
  });

  it("posts transfers between ledger accounts without touching income or expense", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPipeline(t);
    const session = authed(t, ids.userId);

    const result = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-06",
      amountMinor: -50000,
      currency: "USD",
      merchant: "Operating Transfer",
      rawDescription: "Transfer to savings",
      status: "posted",
      source: "bank",
      externalId: "txn-transfer-1",
      transferAccountId: ids.savingsAccountId,
    });

    expect(result.status).toBe("posted");
    expect(result.stage).toBe("transfer");

    const verification = await session.query(api.reports.seedVerification, { entityId: ids.entityId });
    expect(verification.trialBalanceDifferenceMinor).toBe(0);
    expect(verification.may2026.incomeMinor).toBe(0);
    expect(verification.may2026.expenseMinor).toBe(0);
  });
});
