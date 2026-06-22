/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sumUsdMinor } from "./portfolioMoney";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("sumUsdMinor (E5-T4)", () => {
  it("sums integer minor units exactly", () => {
    expect(sumUsdMinor([])).toBe(0);
    expect(sumUsdMinor([100_00, 250_00, 1_00])).toBe(351_00);
    expect(sumUsdMinor([-500, 500])).toBe(0);
  });

  it("rejects non-integer inputs so no float corrupts a total", () => {
    expect(() => sumUsdMinor([100, 0.5])).toThrow(/integer minor units/);
  });
});

async function setup(t: TestConvex<typeof schema>) {
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
    await ctx.db.insert("workspaceSettings", {
      workspaceId,
      appName: "OpenBooks",
      defaultCurrency: "USD",
      fiscalYearStartMonth: 1,
      updatedAt: now,
    });
    return { userId, workspaceId };
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|portfolio-money",
    issuer: "test",
    email: "owner@example.com",
  });
}

describe("createEntity USD lock (E5-T4)", () => {
  it("rejects a non-USD currency", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);
    await expect(
      session.mutation(api.entities.create, {
        name: "Euro Books",
        businessType: "services",
        currency: "EUR",
      }),
    ).rejects.toThrow(/USD/);
  });

  it("creates a USD entity", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);
    const result = await session.mutation(api.entities.create, {
      name: "Zikra",
      businessType: "services",
      currency: "USD",
    });
    expect(result.entityId).toBeDefined();
    const entity = await t.run((ctx) => ctx.db.get(result.entityId as Id<"entities">));
    expect(entity?.currency).toBe("USD");
  });
});
