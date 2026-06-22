/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// E9-T8 — revenue by stream. Several income accounts roll up into one
// owner-facing stream via `streamTag`; untagged accounts fall back to their own
// name; and the sum of stream totals MUST equal the period P&L revenue.

async function setupWorkspace(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar's workspace", slug: "ansar-workspace", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", {
      workspaceId, userId, role: "owner", status: "active", createdAt: now, updatedAt: now,
    });
    return { userId, workspaceId, now };
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">) {
  return t.withIdentity({
    subject: `${userId}|test-session`, tokenIdentifier: "test|stream", issuer: "test", email: "owner@example.com",
  });
}

describe("revenue by stream (E9-T8)", () => {
  it("rolls up tagged income accounts and reconciles to period P&L revenue", async () => {
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    const session = authed(t, base.userId);

    const seeded = await t.run(async (ctx) => {
      const now = base.now;
      const eid = await ctx.db.insert("entities", {
        workspaceId: base.workspaceId, name: "Stream Co", slug: "stream-co",
        businessType: "services", currency: "USD", isDemo: false, archived: false,
        createdAt: now, updatedAt: now,
      });
      const checking = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Checking", type: "asset", subtype: "checking", number: "1010", currency: "USD", isSystem: true, archived: false, createdAt: now, updatedAt: now });
      // Two income accounts that should roll into "Z360 product", plus one
      // untagged income account ("AI consulting") that falls back to its name.
      const platform = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Platform fee", type: "income", subtype: "services", number: "4100", currency: "USD", isSystem: false, archived: false, streamTag: "Z360 product", createdAt: now, updatedAt: now });
      const usage = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Usage", type: "income", subtype: "services", number: "4110", currency: "USD", isSystem: false, archived: false, streamTag: "Z360 product", createdAt: now, updatedAt: now });
      const consulting = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "AI consulting", type: "income", subtype: "services", number: "4200", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
      await ctx.db.insert("bankAccounts", { entityId: eid, ledgerAccountId: checking, name: "Checking", mask: "1111", kind: "checking", balanceMinor: 0, includeInSync: true, createdAt: now, updatedAt: now });

      async function post(date: string, incomeAccount: Id<"ledgerAccounts">, amountMinor: number) {
        const entryId = await ctx.db.insert("journalEntries", { entityId: eid, date, memo: "seed", source: "manual", postedByUserId: base.userId, locked: true, createdAt: now });
        await ctx.db.insert("journalLines", { entityId: eid, entryId, accountId: checking, debitMinor: amountMinor, creditMinor: 0, currency: "USD", createdAt: now });
        await ctx.db.insert("journalLines", { entityId: eid, entryId, accountId: incomeAccount, debitMinor: 0, creditMinor: amountMinor, currency: "USD", createdAt: now });
      }
      // June revenue across the three accounts.
      await post("2026-06-04", platform, 1200_00);
      await post("2026-06-09", usage, 800_00);
      await post("2026-06-14", consulting, 500_00);
      return eid;
    });

    const dashboard = await session.query(api.coreViews.dashboard, { entityId: seeded, period: "2026-06" });
    expect(dashboard).not.toBeNull();
    if (!dashboard) return;

    // Two streams: "Z360 product" (1200+800=2000) and "AI consulting" (500).
    const streams = dashboard.revenueByStream;
    const z360 = streams.find((row) => row.stream === "Z360 product");
    const consulting = streams.find((row) => row.stream === "AI consulting");
    expect(z360?.totalMinor).toBe(2000_00);
    expect(z360?.accountIds).toHaveLength(2);
    expect(consulting?.totalMinor).toBe(500_00);

    // Reconciliation invariant: Σ stream totals == period P&L revenue.
    const streamSum = streams.reduce((sum, row) => sum + row.totalMinor, 0);
    expect(streamSum).toBe(dashboard.profitAndLoss.incomeMinor);
    expect(streamSum).toBe(2500_00);

    // Trend present for the selected month.
    const z360June = z360?.trend.find((point) => point.month === "2026-06");
    expect(z360June?.amountMinor).toBe(2000_00);
  });

  it("setStreamTag tags an income account and the rollup reflects it", async () => {
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    const session = authed(t, base.userId);

    const seeded = await t.run(async (ctx) => {
      const now = base.now;
      const eid = await ctx.db.insert("entities", {
        workspaceId: base.workspaceId, name: "Tag Co", slug: "tag-co",
        businessType: "services", currency: "USD", isDemo: false, archived: false,
        createdAt: now, updatedAt: now,
      });
      const checking = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Checking", type: "asset", subtype: "checking", number: "1010", currency: "USD", isSystem: true, archived: false, createdAt: now, updatedAt: now });
      const incomeA = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Marketing retainer", type: "income", subtype: "services", number: "4100", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
      const incomeB = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Marketing ad-hoc", type: "income", subtype: "services", number: "4110", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
      await ctx.db.insert("bankAccounts", { entityId: eid, ledgerAccountId: checking, name: "Checking", mask: "1111", kind: "checking", balanceMinor: 0, includeInSync: true, createdAt: now, updatedAt: now });
      async function post(date: string, incomeAccount: Id<"ledgerAccounts">, amountMinor: number) {
        const entryId = await ctx.db.insert("journalEntries", { entityId: eid, date, memo: "seed", source: "manual", postedByUserId: base.userId, locked: true, createdAt: now });
        await ctx.db.insert("journalLines", { entityId: eid, entryId, accountId: checking, debitMinor: amountMinor, creditMinor: 0, currency: "USD", createdAt: now });
        await ctx.db.insert("journalLines", { entityId: eid, entryId, accountId: incomeAccount, debitMinor: 0, creditMinor: amountMinor, currency: "USD", createdAt: now });
      }
      await post("2026-06-04", incomeA, 600_00);
      await post("2026-06-09", incomeB, 400_00);
      return { eid, incomeA, incomeB };
    });

    // Before tagging: two separate streams (each account's own name).
    let dashboard = await session.query(api.coreViews.dashboard, { entityId: seeded.eid, period: "2026-06" });
    expect(dashboard?.revenueByStream).toHaveLength(2);

    // Tag both accounts into one "Marketing services" stream.
    await session.mutation(api.categories.setStreamTag, { accountId: seeded.incomeA, streamTag: "Marketing services" });
    await session.mutation(api.categories.setStreamTag, { accountId: seeded.incomeB, streamTag: "Marketing services" });

    dashboard = await session.query(api.coreViews.dashboard, { entityId: seeded.eid, period: "2026-06" });
    expect(dashboard?.revenueByStream).toHaveLength(1);
    expect(dashboard?.revenueByStream[0].stream).toBe("Marketing services");
    expect(dashboard?.revenueByStream[0].totalMinor).toBe(1000_00);
  });
});
