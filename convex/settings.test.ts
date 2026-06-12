/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { shouldAutoPostAI } from "./ai";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup(t: TestConvex<typeof schema>, role: "owner" | "admin" | "member" = "owner") {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: `${role}@example.com`, name: `${role} User` });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar's workspace",
      slug: `workspace-${role}`,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId,
      role,
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
      archived: false,
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
      isSystem: true,
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
    const mealsAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Meals",
      type: "expense",
      subtype: "meals",
      number: "5300",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const bankAccountId = await ctx.db.insert("bankAccounts", {
      entityId,
      ledgerAccountId: operatingAccountId,
      name: "Operating Checking",
      mask: "1001",
      kind: "checking",
      balanceMinor: 100_000,
      includeInSync: true,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, workspaceId, entityId, operatingAccountId, softwareAccountId, mealsAccountId, bankAccountId };
  });
}

function authed(t: TestConvex<typeof schema>, ids: { userId: Id<"users"> }, email = "owner@example.com") {
  return t.withIdentity({
    subject: `${ids.userId}|test-session`,
    tokenIdentifier: "test|settings",
    issuer: "test",
    email,
  });
}

describe("Settings backend verification", () => {
  it("creates a business with a seeded chart of accounts and archives it without deleting books", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids);

    const created = await session.mutation(api.entities.create, {
      name: "Settings Test LLC",
      businessType: "agency",
      currency: "USD",
    });
    expect(created.accountsCreated).toBeGreaterThan(5);

    const accountCount = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", created.entityId))
        .take(500);
      return rows.length;
    });
    expect(accountCount).toBe(created.accountsCreated);

    let list = await session.query(api.entities.list, {});
    const row = list.rows.find((candidate) => candidate.id === created.entityId);
    expect(row).toMatchObject({ name: "Settings Test LLC", archived: false, currency: "USD" });

    await session.mutation(api.entities.archive, { entityId: created.entityId });
    list = await session.query(api.entities.list, {});
    const archived = list.rows.find((candidate) => candidate.id === created.entityId);
    expect(archived).toMatchObject({ archived: true });

    const preservedAccountCount = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", created.entityId))
        .take(500);
      return rows.length;
    });
    expect(preservedAccountCount).toBe(accountCount);
  });

  it("persists AI autonomy through the shared thresholds", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids);

    await session.mutation(api.ai.setConfig, {
      workspaceId: ids.workspaceId,
      provider: "bedrock",
      autonomy: "autopilot",
    });
    const status = await session.query(api.ai.providerStatus, { workspaceId: ids.workspaceId });
    expect(status.autonomy).toBe("autopilot");
    expect(status.thresholds).toMatchObject({ suggest: null, balanced: 0.9, autopilot: 0.75 });
    expect(shouldAutoPostAI({ autonomy: status.autonomy, confidence: 0.76 })).toBe(true);
    expect(shouldAutoPostAI({ autonomy: "balanced", confidence: 0.89 })).toBe(false);
    expect(shouldAutoPostAI({ autonomy: "suggest", confidence: 1 })).toBe(false);
  });

  it("reordering rules changes the pipeline first-match result", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids);

    const softwareRule = await session.mutation(api.rules.save, {
      entityId: ids.entityId,
      name: "OpenAI software",
      merchantContains: "OpenAI",
      direction: "outflow",
      categoryAccountId: ids.softwareAccountId,
      autoPost: true,
    });
    const mealsRule = await session.mutation(api.rules.save, {
      entityId: ids.entityId,
      name: "OpenAI meals",
      merchantContains: "OpenAI",
      direction: "outflow",
      categoryAccountId: ids.mealsAccountId,
      autoPost: true,
    });

    const first = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-06-12",
      amountMinor: -2_000,
      currency: "USD",
      merchant: "OpenAI",
      rawDescription: "OPENAI API",
      status: "posted",
      source: "bank",
      externalId: "settings-rule-before",
    });
    const firstTxn = await t.run(async (ctx) => ctx.db.get(first.transactionId));
    expect(firstTxn?.categoryAccountId).toBe(ids.softwareAccountId);

    await session.mutation(api.rules.reorder, {
      entityId: ids.entityId,
      orderedIds: [mealsRule.ruleId, softwareRule.ruleId],
    });

    const second = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-06-13",
      amountMinor: -2_500,
      currency: "USD",
      merchant: "OpenAI",
      rawDescription: "OPENAI API",
      status: "posted",
      source: "bank",
      externalId: "settings-rule-after",
    });
    const secondTxn = await t.run(async (ctx) => ctx.db.get(second.transactionId));
    expect(secondTxn?.categoryAccountId).toBe(ids.mealsAccountId);
  });

  it("rejects staff from settings mutations", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t, "member");
    const session = authed(t, ids, "member@example.com");

    await expect(
      session.mutation(api.settings.setNotification, { key: "digest", enabled: false }),
    ).rejects.toThrow(/access/i);
    await expect(
      session.mutation(api.entities.create, {
        name: "Staff Created LLC",
        businessType: "services",
        currency: "USD",
      }),
    ).rejects.toThrow(/access/i);
    await expect(
      session.mutation(api.ai.setConfig, {
        workspaceId: ids.workspaceId,
        provider: "bedrock",
        autonomy: "balanced",
      }),
    ).rejects.toThrow(/access/i);
  });
});
