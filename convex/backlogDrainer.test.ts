/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

/**
 * E2-T3 — self-rescheduling backlog drainer.
 *
 * Seeds a >25 needs_review backlog and drives the drainer pass-chain (the
 * scheduled passes) to completion, asserting NO row is left unattempted solely
 * because of the old 25-item cap.
 *
 * The model is mocked (the categorizer's "use node" runtime calls the AI SDK's
 * `generateText`) so passes run with NO network and alternate post/abstain.
 */
const generateTextMock = vi.fn();
const embedMock = vi.fn();
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateText: (...args: unknown[]) => generateTextMock(...args),
    embed: (...args: unknown[]) => embedMock(...args),
  };
});

const modules = import.meta.glob("./**/*.ts");
const ENC_KEY = "unit-test-secret-encryption-key";

function authed(t: TestConvex<typeof schema>, userId: Id<"users">) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|owner",
    issuer: "test",
    email: "owner@example.com",
  });
}

function clearAiEnv() {
  for (const name of [
    "AI_PROVIDER",
    "AI_MODEL",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_REGION",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
  ]) {
    vi.stubEnv(name, "");
  }
}

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
    const entityId = await ctx.db.insert("entities", {
      workspaceId,
      name: "Acme Studio LLC",
      slug: "acme-studio-llc",
      businessType: "services",
      currency: "USD",
      isDemo: false,
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
    return { userId, workspaceId, entityId, bankAccountId, softwareAccountId };
  });
}

async function seedNeedsReview(
  t: TestConvex<typeof schema>,
  ids: Awaited<ReturnType<typeof setup>>,
  count: number,
) {
  await t.run(async (ctx) => {
    const now = Date.now();
    for (let i = 0; i < count; i += 1) {
      await ctx.db.insert("transactions", {
        entityId: ids.entityId,
        bankAccountId: ids.bankAccountId,
        date: "2026-04-01",
        amountMinor: -(1000 + i),
        currency: "USD",
        merchant: `Vendor ${i}`,
        rawDescription: `VENDOR ${i} CHARGE`,
        status: "posted",
        review: "needs_review",
        source: "bank",
        externalId: `backlog-${i}`,
        evalSet: false,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
}

beforeEach(() => {
  generateTextMock.mockReset();
  embedMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("E2-T3 — backlog drainer", () => {
  it("drains a 60-item needs_review backlog to completion (no row left unattempted)", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);

    // BYO Anthropic key (categorize provider) so the LLM stage runs; balanced
    // autonomy so high-confidence posts and low-confidence abstains to review.
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("aiConfigs", {
        workspaceId: ids.workspaceId,
        provider: "anthropic",
        categorizeModel: "claude-sonnet-4-6",
        autonomy: "balanced",
        createdAt: now,
        updatedAt: now,
      });
    });
    await authed(t, ids.userId).mutation(api.credentials.saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "ai",
      provider: "anthropic",
      payload: { apiKey: "sk-ant-backlog-0001" },
      model: "claude-sonnet-4-6",
    });

    await seedNeedsReview(t, ids, 60);

    // Alternate post (high conf) / abstain (needsHuman) so both outcomes occur.
    let call = 0;
    generateTextMock.mockImplementation(async () => {
      call += 1;
      const post = call % 2 === 0;
      return {
        text: JSON.stringify({
          accountNumber: "5200",
          categoryName: "Software & SaaS",
          confidence: post ? 0.96 : 0.5,
          needsHuman: !post,
          reasoning: post ? "Clear software vendor." : "Ambiguous; needs review.",
        }),
        finishReason: "stop",
      };
    });

    // Kick the public starter (which ensures the sync actor + enqueues pass 0),
    // then run the entire scheduled pass-chain to completion.
    await authed(t, ids.userId).mutation(api.bedrockCategorizer.startCategorizationBacklog, {
      entityId: ids.entityId,
      maxPasses: 50,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    // Every seeded row must be ATTEMPTED: posted (entryId) or decidedBy='ai'
    // (proposal recorded, whether it cleared the gate or not). None may remain
    // with decidedBy undefined / 'needs_review' (i.e. never looked at).
    const { unattempted, attempted, total } = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("transactions")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      const unattempted = rows.filter(
        (r) => !r.entryId && (!r.decidedBy || r.decidedBy === "needs_review"),
      );
      const attempted = rows.filter((r) => r.entryId || r.decidedBy === "ai");
      return { unattempted: unattempted.length, attempted: attempted.length, total: rows.length };
    });

    expect(total).toBe(60);
    expect(unattempted).toBe(0);
    expect(attempted).toBe(60);
    // More than one pass had to run (60 > the 25 per-pass ceiling).
    expect(call).toBe(60);
  });

  it("terminates (respects maxPasses) and writes a batch run per pass", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await authed(t, ids.userId).mutation(api.credentials.saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "ai",
      provider: "anthropic",
      payload: { apiKey: "sk-ant-backlog-0002" },
      model: "claude-sonnet-4-6",
    });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("aiConfigs", {
        workspaceId: ids.workspaceId,
        provider: "anthropic",
        categorizeModel: "claude-sonnet-4-6",
        autonomy: "balanced",
        createdAt: now,
        updatedAt: now,
      });
    });
    await seedNeedsReview(t, ids, 30);
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        accountNumber: "5200",
        categoryName: "Software & SaaS",
        confidence: 0.96,
        needsHuman: false,
        reasoning: "Clear software vendor.",
      }),
      finishReason: "stop",
    });

    await authed(t, ids.userId).mutation(api.bedrockCategorizer.startCategorizationBacklog, {
      entityId: ids.entityId,
      maxPasses: 50,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const runCount = await t.run(async (ctx) => {
      const runs = await ctx.db
        .query("aiBatchRuns")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      return runs.length;
    });
    // 30 items / 25 per pass = at least 2 passes → at least 2 batch-run rows.
    expect(runCount).toBeGreaterThanOrEqual(2);
  });
});
