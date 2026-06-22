/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ENC_KEY = "unit-test-secret-encryption-key";

const saveCredential = makeFunctionReference<
  "mutation",
  { workspaceId: Id<"workspaces">; kind: "ai"; provider?: string; payload: Record<string, string>; model?: string },
  { credentialId: Id<"credentials"> }
>("credentials:saveCredential");

const setConfig = makeFunctionReference<
  "mutation",
  { workspaceId: Id<"workspaces">; provider?: string; categorizeModel?: string; autonomy: "balanced" },
  { status: string }
>("ai:setConfig");

const categorizeAndRouteTransaction = makeFunctionReference<
  "action",
  {
    entityId: Id<"entities">;
    bankAccountId: Id<"bankAccounts">;
    date: string;
    amountMinor: number;
    currency: string;
    merchant: string;
    rawDescription: string;
    status: "pending" | "posted";
    source: "bank" | "stripe" | "manual";
    externalId: string;
  },
  {
    mode: "bedrock" | "degraded" | "fallback";
    provider: string | null;
    model: string | null;
    proposal: unknown;
    fallbackReason: string | null;
    route: { status: string; entryId: string | null; stage: string };
  }
>("bedrockCategorizer:categorizeAndRouteTransaction");

const testProviderConnection = makeFunctionReference<
  "action",
  { workspaceId: Id<"workspaces"> },
  { ok: boolean; mode: string; provider: string | null; runtime: string; message: string }
>("ai:testProviderConnection");

async function setupBackend(t: TestConvex<typeof schema>) {
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
      name: "Z360 BIZ LLC",
      slug: "z360-biz",
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
    await ctx.db.insert("ledgerAccounts", {
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
    return { userId, workspaceId, entityId, bankAccountId };
  });
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AI runtime routing (E3-T3)", () => {
  it("degraded path with no key routes to Inbox with a clear reason and never throws", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setupBackend(t);
    const session = authed(t, ids.userId);

    const result = await session.action(categorizeAndRouteTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-14",
      amountMinor: -9900,
      currency: "USD",
      merchant: "Figma",
      rawDescription: "Figma monthly subscription",
      status: "posted",
      source: "bank",
      externalId: "txn-degraded-1",
    });

    expect(result.mode).toBe("degraded");
    expect(result.proposal).toBeNull();
    expect(result.route).toMatchObject({ status: "needs_review", entryId: null });
    expect(result.fallbackReason).toBeTruthy();
  });

  it("with a BYO non-bedrock provider selected, the categorizer is NOT Bedrock-gated", async () => {
    // No AWS env at all. Save an OpenAI key and select it. The actual model call
    // can't reach the network in unit tests, so it falls back gracefully — but
    // crucially it ATTEMPTED the chosen provider (mode 'fallback'), proving the
    // categorizer is no longer hard-gated on AWS Bedrock env (which would have
    // returned 'degraded' citing Bedrock).
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setupBackend(t);
    const session = authed(t, ids.userId);

    const secret = "sk-anthropic-byo-secret-7777";
    await session.mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "ai",
      provider: "anthropic",
      payload: { apiKey: secret },
      model: "claude-sonnet-4-6",
    });
    await session.mutation(setConfig, {
      workspaceId: ids.workspaceId,
      provider: "anthropic",
      categorizeModel: "claude-sonnet-4-6",
      autonomy: "balanced",
    });

    const result = await session.action(categorizeAndRouteTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-14",
      amountMinor: -9900,
      currency: "USD",
      merchant: "Figma",
      rawDescription: "Figma monthly subscription",
      status: "posted",
      source: "bank",
      externalId: "txn-byo-1",
    });

    // It tried the BYO provider then fell back — not the bedrock-degraded path.
    expect(result.mode).toBe("fallback");
    // The transaction is still safely parked for review; nothing crashed.
    expect(result.route.status).toBe("needs_review");
    // The reason never echoes the secret.
    expect(result.fallbackReason ?? "").not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("testProviderConnection is degraded (not bedrock) with no config and never leaks a key", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setupBackend(t);
    const session = authed(t, ids.userId);

    const result = await session.action(testProviderConnection, { workspaceId: ids.workspaceId });
    expect(result.ok).toBe(false);
    expect(result.mode).toBe("degraded");
    expect(result.message).toBeTruthy();
  });

  it("testProviderConnection probes the BYO provider and redacts the key on failure", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setupBackend(t);
    const session = authed(t, ids.userId);

    const secret = "sk-openai-probe-secret-5555";
    await session.mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "ai",
      provider: "openai",
      payload: { apiKey: secret },
      model: "gpt-5",
    });
    await session.mutation(setConfig, {
      workspaceId: ids.workspaceId,
      provider: "openai",
      categorizeModel: "gpt-5",
      autonomy: "balanced",
    });

    const result = await session.action(testProviderConnection, { workspaceId: ids.workspaceId });
    // It attempted the openai provider (not a bedrock-only path); the live call
    // fails offline, but the message must never contain the raw key.
    expect(result.provider).toBe("openai");
    expect(result.message).not.toContain(secret);
  });
});
