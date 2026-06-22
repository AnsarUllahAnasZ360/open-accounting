/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// E1-T8 — Reports and Dashboard both surface "N transactions ($X) are unreviewed
// and excluded from these figures" from the SAME shared helper, so the numbers
// are identical and equal the count/abs-sum of needs_review transactions.

async function setup(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar's workspace", slug: "ansar-workspace", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", {
      workspaceId, userId, role: "owner", status: "active", createdAt: now, updatedAt: now,
    });
    const entityId = await ctx.db.insert("entities", {
      workspaceId, name: "Gap LLC", slug: "gap-llc", businessType: "services",
      currency: "USD", isDemo: false, archived: false, createdAt: now, updatedAt: now,
    });
    // 3 needs_review (counted), 1 auto + 1 confirmed + 1 excluded (NOT counted).
    async function txn(amountMinor: number, review: "auto" | "confirmed" | "needs_review" | "excluded", externalId: string) {
      await ctx.db.insert("transactions", {
        entityId, date: "2026-01-10", amountMinor, currency: "USD", merchant: "M",
        rawDescription: "x", status: "posted", review, source: "bank",
        externalId, evalSet: false, createdAt: now, updatedAt: now,
      });
    }
    await txn(-12_500, "needs_review", "t1");
    await txn(40_000, "needs_review", "t2");
    await txn(-2_500, "needs_review", "t3");
    await txn(-9_999, "auto", "t4");
    await txn(5_000, "confirmed", "t5");
    await txn(-1_000, "excluded", "t6");
    return { userId, entityId };
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">) {
  return t.withIdentity({ subject: `${userId}|test-session`, tokenIdentifier: "test|gap", issuer: "test", email: "owner@example.com" });
}

describe("unreviewed-gap signal (E1-T8)", () => {
  it("reportPack and dashboard return identical unreviewed numbers equal to needs_review", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    const pack = await session.query(api.reportViews.reportPack, {
      entityId: ids.entityId,
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      basis: "accrual",
      compare: "none",
      columnMode: "total",
    });
    const dash = await session.query(api.coreViews.dashboard, { entityId: ids.entityId });

    // 3 needs_review rows; abs sum = 12500 + 40000 + 2500 = 55000.
    expect(pack.unreviewed.unreviewedCount).toBe(3);
    expect(pack.unreviewed.unreviewedAbsMinor).toBe(55_000);

    // Same source → identical numbers on the dashboard.
    expect(dash).not.toBeNull();
    expect(dash!.unreviewed.unreviewedCount).toBe(pack.unreviewed.unreviewedCount);
    expect(dash!.unreviewed.unreviewedAbsMinor).toBe(pack.unreviewed.unreviewedAbsMinor);
  });
});
