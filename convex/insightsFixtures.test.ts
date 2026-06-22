/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * E8-T6 — fixture fence. `seedInsightsEntity` is the ONLY writer of the
 * disposable Insights fixture entity, and it must be reachable solely in
 * dev-auth mode (OPENBOOKS_DEV_AUTH_BYPASS === "1"). These tests prove:
 *   1. With the dev bypass OFF, the mutation throws before touching the DB, so
 *      no fixture data can ever leak into a production-mode read.
 *   2. With the dev bypass ON, it seeds only the caller's chosen entity in the
 *      caller's own workspace (balanced ledger entries + uncategorized rows),
 *      and never any other entity.
 */

/** Minimal workspace + owner + entity + the standard cash account (1010). */
async function setup(t: TestConvex<typeof schema>) {
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
    const entityId = await ctx.db.insert("entities", {
      workspaceId,
      name: "Insights Fixture LLC",
      slug: "insights-fixture-llc",
      businessType: "services",
      currency: "USD",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
    // The fixture needs the standard chart of accounts: cash (1010), income
    // (4000/4100), and expense accounts referenced by ROWS.
    const account = (
      number: string,
      name: string,
      type: "asset" | "liability" | "income" | "expense",
    ) =>
      ctx.db.insert("ledgerAccounts", {
        entityId,
        number,
        name,
        type,
        subtype: type,
        currency: "USD",
        isSystem: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
    await account("1010", "Operating Checking", "asset");
    await account("4000", "Sales", "income");
    await account("4100", "Retainers", "income");
    await account("5100", "Rent", "expense");
    await account("5200", "Software", "expense");
    await account("5300", "Hosting", "expense");
    await account("5500", "Consulting", "expense");
    await account("6100", "Utilities", "expense");

    return { userId, workspaceId, entityId };
  });
}

function authed(t: TestConvex<typeof schema>, userId: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|owner",
    issuer: "test",
    email: "owner@example.com",
  });
}

describe("insightsFixtures.seedInsightsEntity dev-only fence", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when OPENBOOKS_DEV_AUTH_BYPASS is unset (no fixture leaks into prod reads)", async () => {
    vi.stubEnv("OPENBOOKS_DEV_AUTH_BYPASS", "");
    const t = convexTest(schema, modules);
    const { userId, entityId } = await setup(t);
    const session = authed(t, userId);

    await expect(session.mutation(api.insightsFixtures.seedInsightsEntity, { entityId })).rejects.toThrow(
      /dev-auth mode/i,
    );

    // And nothing was written — no fixture transactions exist on the entity.
    const txnCount = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("transactions")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .collect();
      return rows.length;
    });
    expect(txnCount).toBe(0);
  });

  it("throws when OPENBOOKS_DEV_AUTH_BYPASS is some other value", async () => {
    vi.stubEnv("OPENBOOKS_DEV_AUTH_BYPASS", "0");
    const t = convexTest(schema, modules);
    const { userId, entityId } = await setup(t);
    const session = authed(t, userId);

    await expect(session.mutation(api.insightsFixtures.seedInsightsEntity, { entityId })).rejects.toThrow(
      /dev-auth mode/i,
    );
  });

  it("seeds only the chosen disposable entity when the dev bypass is on", async () => {
    vi.stubEnv("OPENBOOKS_DEV_AUTH_BYPASS", "1");
    const t = convexTest(schema, modules);
    const { userId, entityId } = await setup(t);
    const session = authed(t, userId);

    const result = await session.mutation(api.insightsFixtures.seedInsightsEntity, { entityId });
    expect(result.entityId).toBe(entityId);
    expect(result.posted).toBeGreaterThan(0);
    expect(result.uncategorized).toBeGreaterThan(0);
    expect(result.total).toBe(result.posted + result.uncategorized);

    // Every seeded transaction belongs to the chosen entity — no cross-entity leak.
    const seeded = await t.run(async (ctx) =>
      ctx.db
        .query("transactions")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .collect(),
    );
    expect(seeded.length).toBe(result.total);
    expect(seeded.every((row) => row.entityId === entityId)).toBe(true);

    // Posted rows carry a balanced ledger entry; uncategorized rows do not.
    const posted = seeded.filter((row) => row.entryId);
    expect(posted.length).toBe(result.posted);
    for (const row of posted) {
      const lines = await t.run(async (ctx) =>
        ctx.db
          .query("journalLines")
          .withIndex("by_entry", (q) => q.eq("entryId", row.entryId!))
          .collect(),
      );
      const debit = lines.reduce((sum, line) => sum + line.debitMinor, 0);
      const credit = lines.reduce((sum, line) => sum + line.creditMinor, 0);
      expect(debit).toBe(credit);
    }
  });
});
