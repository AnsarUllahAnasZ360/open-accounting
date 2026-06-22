/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function authed(t: TestConvex<typeof schema>, userId: Id<"users">, email: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: `test|${email}`,
    issuer: "test",
    email,
  });
}

/**
 * E11-T1 — the shared active-entity resolver must never bleed demo data into a
 * real workspace. The legacy bug: when no entityId was passed, every view fell
 * back to the magic slug 'acme-studio-llc' and a real owner saw demo numbers.
 */
describe("activeEntity no-demo-bleed resolver (E11-T1)", () => {
  it("a real workspace with one real entity and zero transactions reads EMPTY when entityId is omitted", async () => {
    const t = convexTest(schema, modules);

    // A SEPARATE, fully-seeded public demo workspace (the bleed source).
    const { demoEntityId } = await t.run(async (ctx) => {
      const now = Date.now();
      const demoWorkspaceId = await ctx.db.insert("workspaces", {
        name: "OpenBooks Demo",
        slug: "public-demo",
        isDemo: true,
        demoKind: "public",
        createdAt: now,
        updatedAt: now,
      });
      const entityId = await ctx.db.insert("entities", {
        workspaceId: demoWorkspaceId,
        name: "Acme Studio LLC",
        // The historical magic slug — proving the fallback is dead.
        slug: "acme-studio-llc",
        businessType: "services",
        currency: "USD",
        isDemo: true,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      // Give the demo entity a transaction so any leak would be visible.
      await ctx.db.insert("transactions", {
        entityId,
        date: "2026-06-01",
        amountMinor: 500_00,
        currency: "USD",
        merchant: "Demo Customer",
        rawDescription: "demo deposit",
        status: "posted",
        review: "confirmed",
        source: "bank",
        externalId: "demo-bleed-1",
        evalSet: false,
        createdAt: now,
        updatedAt: now,
      } as never);
      return { demoEntityId: entityId };
    });

    // A real owner with exactly one real business and NO transactions.
    const ownerId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "real-owner@example.com", name: "Real Owner" }),
    );
    const owner = authed(t, ownerId, "real-owner@example.com");
    const created = await owner.mutation(api.onboarding.bootstrapWorkspace, {
      businesses: [{ name: "Real Books Co", businessType: "services" }],
    });
    const realEntityId = created.entityIds[0] as Id<"entities">;

    // No entityId: must resolve to the real business, never the demo slug.
    const dashboard = await owner.query(api.coreViews.dashboard, {});
    expect(dashboard).not.toBeNull();
    expect(dashboard?.entity.id).toBe(realEntityId);
    expect(dashboard?.entity.name).toBe("Real Books Co");
    // Empty book -> zero transactions, zero demo bleed.
    expect(dashboard?.readStats.transactions).toBe(0);
    expect(dashboard?.cashPositionMinor).toBe(0);

    // The demo entity exists and HAS data — proving the empty read above is the
    // no-bleed guarantee, not an empty database.
    const demoData = await t.run(async (ctx) => {
      const txns = await ctx.db
        .query("transactions")
        .withIndex("by_entity", (q) => q.eq("entityId", demoEntityId))
        .collect();
      return txns.length;
    });
    expect(demoData).toBe(1);
  });

  it("rejects reading a demo entity from a real workspace (cross-demo isolation, E11-T2 wired)", async () => {
    const t = convexTest(schema, modules);

    // Real owner + workspace.
    const ownerId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "cross-owner@example.com", name: "Cross Owner" }),
    );
    const owner = authed(t, ownerId, "cross-owner@example.com");
    await owner.mutation(api.onboarding.bootstrapWorkspace, {
      businesses: [{ name: "Cross Books Co", businessType: "services" }],
    });

    // A foreign demo entity in a DIFFERENT (demo) workspace.
    const foreignDemoEntityId = await t.run(async (ctx) => {
      const now = Date.now();
      const demoWorkspaceId = await ctx.db.insert("workspaces", {
        name: "Demo",
        slug: "public-demo",
        isDemo: true,
        demoKind: "public",
        createdAt: now,
        updatedAt: now,
      });
      return ctx.db.insert("entities", {
        workspaceId: demoWorkspaceId,
        name: "Demo Co",
        slug: "acme-studio-llc",
        businessType: "services",
        currency: "USD",
        isDemo: true,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
    });

    // Passing a foreign demo entityId is an authz violation: it must THROW, never
    // silently read demo rows into the real workspace.
    await expect(
      owner.query(api.coreViews.dashboard, { entityId: foreignDemoEntityId }),
    ).rejects.toThrow();
  });

  it("demoWorkspace registry: backfill marks the legacy demo and getPublicDemoWorkspace returns exactly one", async () => {
    const t = convexTest(schema, modules);

    // Fresh deployment: no public demo yet.
    const before = await t.run(async (ctx) => {
      const flagged = await ctx.db
        .query("workspaces")
        .withIndex("by_is_demo", (q) => q.eq("isDemo", true))
        .collect();
      return flagged.filter((w) => w.demoKind === "public").length;
    });
    expect(before).toBe(0);

    // A legacy workspace whose only demo signal is the magic entity slug.
    const legacyWorkspaceId = await t.run(async (ctx) => {
      const now = Date.now();
      const workspaceId = await ctx.db.insert("workspaces", {
        name: "Legacy Demo",
        slug: "legacy-demo",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("entities", {
        workspaceId,
        name: "Acme Studio LLC",
        slug: "acme-studio-llc",
        businessType: "services",
        currency: "USD",
        isDemo: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      return workspaceId;
    });

    // Backfill is idempotent: run it twice; still exactly one public demo.
    await t.mutation(internal.demoWorkspace.backfillDemoFlags, {});
    const second = await t.mutation(internal.demoWorkspace.backfillDemoFlags, {});
    expect(second.backfilled).toBe(false);

    const after = await t.run(async (ctx) => {
      const flagged = await ctx.db
        .query("workspaces")
        .withIndex("by_is_demo", (q) => q.eq("isDemo", true))
        .collect();
      const publicOnes = flagged.filter((w) => w.demoKind === "public");
      const ws = await ctx.db.get(legacyWorkspaceId);
      return { count: publicOnes.length, id: publicOnes[0]?._id, marked: ws?.isDemo === true && ws?.demoKind === "public" };
    });
    expect(after.count).toBe(1);
    expect(after.id).toBe(legacyWorkspaceId);
    expect(after.marked).toBe(true);
  });
});
