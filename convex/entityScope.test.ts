/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { resolveDefaultEntity } from "./entityScope";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const base = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar workspace",
      slug: "ansar-workspace",
      createdAt: base,
      updatedAt: base,
    });
    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId,
      role: "owner",
      status: "active",
      createdAt: base,
      updatedAt: base,
    });

    async function entity(opts: {
      name: string;
      slug: string;
      createdAt: number;
      isDemo?: boolean;
      isDefault?: boolean;
      archived?: boolean;
    }) {
      return ctx.db.insert("entities", {
        workspaceId,
        name: opts.name,
        slug: opts.slug,
        businessType: "services",
        currency: "USD",
        isDemo: opts.isDemo ?? false,
        isDefault: opts.isDefault,
        archived: opts.archived ?? false,
        createdAt: opts.createdAt,
        updatedAt: opts.createdAt,
      });
    }

    // Demo created FIRST (oldest), then two real businesses.
    const demoId = await entity({ name: "Acme Studio LLC", slug: "acme-studio-llc", createdAt: base, isDemo: true });
    const zikraId = await entity({ name: "Zikra", slug: "zikra", createdAt: base + 1_000 });
    const z360Id = await entity({ name: "Z360", slug: "z360", createdAt: base + 2_000 });
    return { userId, workspaceId, demoId, zikraId, z360Id };
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|entity-scope",
    issuer: "test",
    email: "owner@example.com",
  });
}

describe("resolveDefaultEntity (E5-T1)", () => {
  it("returns the oldest non-archived non-demo entity when no flag is set", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const resolved = await t.run(async (ctx) => {
      const membership = { workspaceId: ids.workspaceId };
      const entity = await resolveDefaultEntity(ctx, membership);
      return entity?.name;
    });
    // Acme is the demo and is oldest, but the resolver skips demo entities, so it
    // returns the oldest REAL business (Zikra). NEVER a slug/name match.
    expect(resolved).toBe("Zikra");
  });

  it("returns the isDefault entity over the first-created one", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await t.run(async (ctx) => {
      // Flag the newest entity (Z360) as default.
      await ctx.db.patch(ids.z360Id, { isDefault: true });
    });
    const resolved = await t.run(async (ctx) => {
      const entity = await resolveDefaultEntity(ctx, { workspaceId: ids.workspaceId });
      return entity?.name;
    });
    expect(resolved).toBe("Z360");
  });

  it("prefers the persisted workspace.defaultEntityId above all heuristics", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await t.run(async (ctx) => {
      // isDefault on Z360, but defaultEntityId points at Zikra — the persisted
      // workspace default wins.
      await ctx.db.patch(ids.z360Id, { isDefault: true });
      await ctx.db.patch(ids.workspaceId, { defaultEntityId: ids.zikraId });
    });
    const resolved = await t.run(async (ctx) => {
      const entity = await resolveDefaultEntity(ctx, { workspaceId: ids.workspaceId });
      return entity?.name;
    });
    expect(resolved).toBe("Zikra");
  });

  it("falls back to a demo-only workspace's entity", async () => {
    const t = convexTest(schema, modules);
    const demoOnly = await t.run(async (ctx) => {
      const base = Date.now();
      const workspaceId = await ctx.db.insert("workspaces", {
        name: "Demo only",
        slug: "demo-only",
        createdAt: base,
        updatedAt: base,
      });
      await ctx.db.insert("entities", {
        workspaceId,
        name: "Demo Books",
        slug: "demo-books",
        businessType: "services",
        currency: "USD",
        isDemo: true,
        archived: false,
        createdAt: base,
        updatedAt: base,
      });
      return { workspaceId };
    });
    const resolved = await t.run(async (ctx) => {
      const entity = await resolveDefaultEntity(ctx, { workspaceId: demoOnly.workspaceId });
      return entity?.name;
    });
    expect(resolved).toBe("Demo Books");
  });
});

describe("setDefaultBusiness (E5-T1)", () => {
  it("persists workspace.defaultEntityId, exposes it on session.viewer, and writes an audit event", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    await session.mutation(api.entities.setDefaultBusiness, { entityId: ids.z360Id });

    const viewer = await session.query(api.session.viewer, {});
    expect(String(viewer.defaultEntityId)).toBe(String(ids.z360Id));

    const audit = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("auditEvents")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", ids.workspaceId))
        .collect();
      return rows.map((row) => row.action);
    });
    expect(audit).toContain("entity.default.set");

    // The flag moves: re-setting clears the prior isDefault.
    await session.mutation(api.entities.setDefaultBusiness, { entityId: ids.zikraId });
    const flags = await t.run(async (ctx) => {
      const z360 = await ctx.db.get(ids.z360Id);
      const zikra = await ctx.db.get(ids.zikraId);
      return { z360: z360?.isDefault === true, zikra: zikra?.isDefault === true };
    });
    expect(flags).toEqual({ z360: false, zikra: true });
  });
});
