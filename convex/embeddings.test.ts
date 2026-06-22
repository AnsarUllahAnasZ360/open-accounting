/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

/**
 * E2-T4 — embedding generator + write semantic memory on every correction.
 *
 * The embedder (embeddings.ts) calls the AI SDK's `embed`. We mock that one
 * symbol so the active path returns a fixed 1024-dim vector with NO network, and
 * the degraded path is exercised by saving no credential at all.
 */
const embedMock = vi.fn();
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, embed: (...args: unknown[]) => embedMock(...args) };
});

const modules = import.meta.glob("./**/*.ts");
const ENC_KEY = "unit-test-secret-encryption-key";

function fixedVector(seed: number): number[] {
  // A deterministic, normalized-enough 1024-vector.
  return Array.from({ length: 1024 }, (_, i) => ((i * 31 + seed) % 97) / 97);
}

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
    const account = async (
      number: string,
      name: string,
      type: "asset" | "liability" | "equity" | "income" | "expense",
      subtype: string,
    ) =>
      await ctx.db.insert("ledgerAccounts", {
        entityId,
        name,
        type,
        subtype,
        number,
        currency: "USD",
        isSystem: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
    const operatingAccountId = await account("1010", "Operating Checking", "asset", "bank");
    const softwareAccountId = await account("5200", "Software & SaaS", "expense", "software");
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

async function saveOpenAiKey(t: TestConvex<typeof schema>, userId: Id<"users">, workspaceId: Id<"workspaces">) {
  await authed(t, userId).mutation(api.credentials.saveCredential, {
    workspaceId,
    kind: "ai",
    provider: "openai",
    payload: { apiKey: "sk-openai-byo-embed-0001" },
  });
}

/** Route a needs_review txn then confirm it to drive recordCorrectionMemory. */
async function correctMerchant(
  t: TestConvex<typeof schema>,
  ids: Awaited<ReturnType<typeof setup>>,
  merchant: string,
  externalId: string,
) {
  const session = authed(t, ids.userId);
  const routed = await session.mutation(api.pipeline.routeTransaction, {
    entityId: ids.entityId,
    bankAccountId: ids.bankAccountId,
    date: "2026-03-01",
    amountMinor: -3300,
    currency: "USD",
    merchant,
    rawDescription: `${merchant} CHARGE`,
    status: "posted",
    source: "bank",
    externalId,
    forceReview: true,
  });
  await session.mutation(api.pipeline.confirmTransaction, {
    transactionId: routed.transactionId,
    categoryAccountId: ids.softwareAccountId,
  });
}

beforeEach(() => {
  embedMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("E2-T4 — embedding on correction", () => {
  it("writes a length-1024 aiMemoryEmbeddings row with matching ids on confirm", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await saveOpenAiKey(t, ids.userId, ids.workspaceId);

    embedMock.mockResolvedValue({ embedding: fixedVector(1), usage: { tokens: 1 }, value: "x" });

    await correctMerchant(t, ids, "AMZN WEB SERVICES", "embed-corr-1");
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("aiMemoryEmbeddings")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row.embedding.length).toBe(1024);
      expect(row.categoryAccountId).toBe(ids.softwareAccountId);
      expect(row.direction).toBe("outflow");
      expect(row.embeddingModel).toContain("openai:");
      // The embedding row is linked to its correction memory.
      const memory = await ctx.db.get(row.correctionMemoryId);
      expect(memory?.merchantKey).toBe("amzn web services");
    });
    expect(embedMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a constant embeddingModel across rows (no model mixing)", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await saveOpenAiKey(t, ids.userId, ids.workspaceId);

    embedMock.mockResolvedValue({ embedding: fixedVector(2), usage: { tokens: 1 }, value: "x" });

    await correctMerchant(t, ids, "Figma", "embed-model-a");
    await correctMerchant(t, ids, "Linear", "embed-model-b");
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("aiMemoryEmbeddings")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      expect(rows.length).toBe(2);
      const models = new Set(rows.map((r) => r.embeddingModel));
      expect(models.size).toBe(1);
    });
  });

  it("updates (not duplicates) and bumps occurrenceCount on a second correction", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await saveOpenAiKey(t, ids.userId, ids.workspaceId);

    embedMock.mockResolvedValue({ embedding: fixedVector(3), usage: { tokens: 1 }, value: "x" });

    await correctMerchant(t, ids, "AWS", "embed-dupe-1");
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await correctMerchant(t, ids, "AWS", "embed-dupe-2");
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("aiMemoryEmbeddings")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      expect(rows.length).toBe(1);
      expect(rows[0].occurrenceCount).toBeGreaterThanOrEqual(2);
    });
  });

  it("degrades to lexical memory (no row, no throw) when no embedding key is configured", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    // No credential saved.

    await correctMerchant(t, ids, "Mystery Vendor", "embed-degraded-1");
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await t.run(async (ctx) => {
      const embeddings = await ctx.db
        .query("aiMemoryEmbeddings")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      expect(embeddings.length).toBe(0);
      // Lexical correction memory still exists — the correction was not blocked.
      const memories = await ctx.db
        .query("aiCorrectionMemories")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      expect(memories.length).toBe(1);
    });
    expect(embedMock).not.toHaveBeenCalled();
  });
});
