/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function insertUser(t: TestConvex<typeof schema>, email: string) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", { email, name: "First Owner" });
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">, email: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: `test|${email}`,
    issuer: "test",
    email,
  });
}

describe("first-run onboarding", () => {
  it("lets an authenticated user without a workspace bootstrap one business and checklist", async () => {
    const t = convexTest(schema, modules);
    const userId = await insertUser(t, "new-owner@example.com");
    const session = authed(t, userId, "new-owner@example.com");

    const before = await session.query(api.session.viewer, {});
    expect(before.status).toBe("needs_onboarding");
    expect(before.workspace).toBeNull();

    const created = await session.mutation(api.onboarding.bootstrapWorkspace, {
      businessName: "New Owner Studio",
      businessType: "software",
      currency: "USD",
      skippedAi: true,
      skippedBank: true,
      skippedStripe: true,
    });
    expect(created.alreadyOnboarded).toBe(false);
    expect(created.accountsCreated).toBeGreaterThan(30);

    const after = await session.query(api.session.viewer, {});
    expect(after.status).toBe("ready");
    expect(after.workspace?.name).toBe("New Owner Studio workspace");
    expect(after.role).toBe("owner");

    const businesses = await session.query(api.entities.list, {});
    expect(businesses.rows).toHaveLength(1);
    expect(businesses.rows[0]).toMatchObject({
      name: "New Owner Studio",
      businessType: "software",
      currency: "USD",
      isDemo: false,
    });

    const checklist = await session.query(api.onboarding.checklist, {});
    expect(checklist.persisted).toBe(true);
    expect(checklist.items.map((item) => item.key)).toEqual([
      "bankConnected",
      "aiConnected",
      "stripeConnected",
      "firstInboxZero",
      "firstReportViewed",
    ]);

    const second = await session.mutation(api.onboarding.bootstrapWorkspace, {
      businessName: "Duplicate Studio",
      businessType: "agency",
      currency: "USD",
      skippedAi: true,
      skippedBank: true,
      skippedStripe: true,
    });
    expect(second.alreadyOnboarded).toBe(true);

    const counts = await t.run(async (ctx) => {
      const workspaces = await ctx.db.query("workspaces").collect();
      const entities = await ctx.db.query("entities").collect();
      const checklists = await ctx.db.query("onboardingChecklists").collect();
      return {
        workspaces: workspaces.length,
        entities: entities.length,
        checklists: checklists.length,
      };
    });
    expect(counts).toEqual({ workspaces: 1, entities: 1, checklists: 1 });
  });

  it("does not create a second workspace for an already-onboarded owner", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
      const workspaceId = await ctx.db.insert("workspaces", {
        name: "Ansar's workspace",
        slug: "ansar-workspace",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("workspaceMembers", {
        userId,
        workspaceId,
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      return { userId, workspaceId };
    });
    const session = authed(t, ids.userId, "owner@example.com");

    const result = await session.mutation(api.onboarding.bootstrapWorkspace, {
      businessName: "Should Not Create LLC",
      businessType: "services",
      currency: "USD",
      skippedAi: true,
      skippedBank: true,
      skippedStripe: true,
    });

    expect(result).toMatchObject({
      workspaceId: ids.workspaceId,
      entityId: null,
      alreadyOnboarded: true,
      accountsCreated: 0,
    });

    const counts = await t.run(async (ctx) => {
      const workspaces = await ctx.db.query("workspaces").collect();
      const entities = await ctx.db.query("entities").collect();
      const checklists = await ctx.db.query("onboardingChecklists").collect();
      return {
        workspaces: workspaces.length,
        entities: entities.length,
        checklists: checklists.length,
      };
    });
    expect(counts).toEqual({ workspaces: 1, entities: 0, checklists: 1 });
  });
});
