/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";
import { demoGoldenMay2026, demoGoldenSeedSummary } from "../tests/fixtures/goldenReports";

const modules = import.meta.glob("./**/*.ts");

async function setupWorkspace(t: ReturnType<typeof convexTest>) {
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
    return { userId, workspaceId };
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

describe("demo seed engine", () => {
  it("seeds deterministic ledger-backed books and remains idempotent", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);

    const first = await session.action(api.seedDemo.resetAndSeed, {});
    const second = await session.action(api.seedDemo.resetAndSeed, {});

    expect(first.seed).toBe(demoGoldenSeedSummary.seed);
    expect(first.transactionCount).toBe(demoGoldenSeedSummary.transactionCount);
    expect(first.postedCount).toBe(demoGoldenSeedSummary.postedCount);
    expect(first.inboxCount).toBe(demoGoldenSeedSummary.inboxCount);
    expect(first.evalCount).toBe(demoGoldenSeedSummary.evalCount);
    expect(first.payoutEntryCount).toBe(demoGoldenSeedSummary.payoutEntryCount);
    expect(first.trialBalanceDifferenceMinor).toBe(demoGoldenSeedSummary.trialBalanceDifferenceMinor);
    expect(first.may2026).toEqual(demoGoldenMay2026);

    expect(second.transactionCount).toBe(first.transactionCount);
    expect(second.postedCount).toBe(first.postedCount);
    expect(second.inboxCount).toBe(first.inboxCount);
    expect(second.evalCount).toBe(first.evalCount);
    expect(second.trialBalanceDifferenceMinor).toBe(0);
    expect(second.may2026).toEqual(first.may2026);
  }, 20_000);

  it("joins overlapping reset requests into one seed job", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);

    const [first, second] = await Promise.all([
      session.action(api.seedDemo.resetAndSeed, {}),
      session.action(api.seedDemo.resetAndSeed, {}),
    ]);

    expect(first.transactionCount).toBe(demoGoldenSeedSummary.transactionCount);
    expect(second.transactionCount).toBe(first.transactionCount);
    expect(second.entityId).toBe(first.entityId);
    expect(second.trialBalanceDifferenceMinor).toBe(0);

    const persisted = await t.run(async (ctx) => {
      const runs = await ctx.db.query("demoSeedRuns").collect();
      const jobs = await ctx.db.query("demoSeedJobs").collect();
      return { runs, jobs };
    });
    expect(persisted.runs).toHaveLength(1);
    expect(persisted.jobs).toHaveLength(1);
    expect(persisted.jobs[0]?.status).toBe("succeeded");
  }, 20_000);
});
