/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ENC_KEY = "unit-test-secret-encryption-key";

const saveCredential = makeFunctionReference<
  "mutation",
  {
    workspaceId: Id<"workspaces">;
    kind: "ai" | "plaid" | "stripe" | "plunk";
    provider?: string;
    payload: Record<string, string>;
    model?: string;
  },
  { credentialId: Id<"credentials"> }
>("credentials:saveCredential");

const setConfig = makeFunctionReference<
  "mutation",
  {
    workspaceId: Id<"workspaces">;
    provider?: string;
    chatModel?: string;
    categorizeModel?: string;
    autonomy: "suggest" | "balanced" | "autopilot";
  },
  { status: string }
>("ai:setConfig");

const providerStatus = makeFunctionReference<
  "query",
  { workspaceId: Id<"workspaces"> },
  {
    mode: "active" | "degraded";
    activeProvider: string | null;
    configuredProvider: string;
    model: string | null;
    savedProviders: string[];
    catalogConfigured: Array<{ id: string; configured: boolean }>;
  }
>("ai:providerStatus");

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
    return { userId, workspaceId };
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
    "GROQ_API_KEY",
  ]) {
    vi.stubEnv(name, "");
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Provider-agnostic AI resolver (E3-T2)", () => {
  it("resolves provider+model+ready for 3 saved BYO providers", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    for (const [provider, model] of [
      ["openai", "gpt-5"],
      ["anthropic", "claude-sonnet-4-6"],
      ["groq", "llama-3.3-70b-versatile"],
    ] as const) {
      await session.mutation(saveCredential, {
        workspaceId: ids.workspaceId,
        kind: "ai",
        provider,
        payload: { apiKey: `key-${provider}-0001` },
        model,
      });
      await session.mutation(setConfig, {
        workspaceId: ids.workspaceId,
        provider,
        categorizeModel: model,
        chatModel: model,
        autonomy: "balanced",
      });

      const summary = await t.action(internal.aiResolve.resolveActiveAiModelSummary, {
        workspaceId: ids.workspaceId,
        purpose: "categorize",
      });
      expect(summary.provider).toBe(provider);
      expect(summary.modelId).toBe(model);
      expect(summary.ready).toBe(true);
      expect(summary.source).toBe("credential");
      expect(summary.hasApiKey).toBe(true);
    }
  });

  it("falls back to env when no credential row exists", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "env-openai-key-1234");
    const t = convexTest(schema, modules);
    const ids = await setup(t);

    const summary = await t.action(internal.aiResolve.resolveActiveAiModelSummary, {
      workspaceId: ids.workspaceId,
      purpose: "chat",
    });
    expect(summary.provider).toBe("openai");
    expect(summary.source).toBe("env");
    expect(summary.ready).toBe(true);
  });

  it("is not ready when neither a credential nor env exists", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);

    const summary = await t.action(internal.aiResolve.resolveActiveAiModelSummary, {
      workspaceId: ids.workspaceId,
      purpose: "categorize",
    });
    expect(summary.ready).toBe(false);
  });

  it("setConfig accepts all 14 catalog providers (widened validator)", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    const fourteen = [
      "gateway",
      "openai",
      "anthropic",
      "google",
      "bedrock",
      "azure",
      "groq",
      "deepseek",
      "mistral",
      "moonshot",
      "xai",
      "fireworks",
      "ollama",
      "openai_compatible",
    ] as const;
    for (const provider of fourteen) {
      const res = await session.mutation(setConfig, {
        workspaceId: ids.workspaceId,
        provider,
        autonomy: "balanced",
      });
      expect(res.status).toMatch(/created|updated/);
    }
  });

  it("providerStatus reports active for a BYO openai credential with NO AWS env", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    await session.mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "ai",
      provider: "openai",
      payload: { apiKey: "sk-openai-byo-9999" },
      model: "gpt-5",
    });
    await session.mutation(setConfig, {
      workspaceId: ids.workspaceId,
      provider: "openai",
      categorizeModel: "gpt-5",
      autonomy: "balanced",
    });

    const status = await session.query(providerStatus, { workspaceId: ids.workspaceId });
    expect(status.mode).toBe("active");
    expect(status.configuredProvider).toBe("openai");
    expect(status.activeProvider).toBe("openai");
    expect(status.savedProviders).toContain("openai");
    const openaiFlag = status.catalogConfigured.find((c) => c.id === "openai");
    expect(openaiFlag?.configured).toBe(true);
    // No secret leaked in the status payload.
    expect(JSON.stringify(status)).not.toContain("sk-openai-byo-9999");
  });

  it("E4-T3: round-trips a saved key through setConfig + resolver, never returning plaintext from any AI query", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    const rawKey = "sk-e4t3-activation-blocker-7777";
    await session.mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "ai",
      provider: "openai",
      payload: { apiKey: rawKey },
      model: "gpt-5",
    });
    await session.mutation(setConfig, {
      workspaceId: ids.workspaceId,
      provider: "openai",
      categorizeModel: "gpt-5",
      chatModel: "gpt-5",
      autonomy: "balanced",
    });

    // The resolver (server-side) finds the decrypted credential and is ready.
    const summary = await t.action(internal.aiResolve.resolveActiveAiModelSummary, {
      workspaceId: ids.workspaceId,
      purpose: "categorize",
    });
    expect(summary.provider).toBe("openai");
    expect(summary.ready).toBe(true);
    expect(summary.source).toBe("credential");
    // Even the redacted summary must not carry the raw key.
    expect(JSON.stringify(summary)).not.toContain(rawKey);

    // No client-facing query may return the plaintext key.
    const status = await session.query(providerStatus, { workspaceId: ids.workspaceId });
    expect(JSON.stringify(status)).not.toContain(rawKey);

    const credentialStatus = makeFunctionReference<
      "query",
      { workspaceId: Id<"workspaces">; kind?: "ai" | "plaid" | "stripe" | "plunk" },
      Array<Record<string, unknown>>
    >("credentials:credentialStatus");
    const creds = await session.query(credentialStatus, { workspaceId: ids.workspaceId, kind: "ai" });
    const serialized = JSON.stringify(creds);
    expect(serialized).not.toContain(rawKey);
    expect(serialized).not.toContain("encryptedPayload");
    // The owner sees the last 4 only.
    expect(serialized).toContain("••••7777");
  });

  it("persists a custom categorizeModel/chatModel", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    await session.mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "ai",
      provider: "openai",
      payload: { apiKey: "sk-custom-model-1111" },
    });
    await session.mutation(setConfig, {
      workspaceId: ids.workspaceId,
      provider: "openai",
      categorizeModel: "gpt-5-custom-deployment",
      chatModel: "gpt-5-custom-deployment",
      autonomy: "balanced",
    });

    const summary = await t.action(internal.aiResolve.resolveActiveAiModelSummary, {
      workspaceId: ids.workspaceId,
      purpose: "categorize",
    });
    expect(summary.modelId).toBe("gpt-5-custom-deployment");
  });
});
