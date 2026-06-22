/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  buildCategorizationPrompt,
  extractBedrockResponseText,
  normalizeBedrockCategorizationProposal,
  parseBedrockCategorizationText,
} from "./bedrockCategorizer";
import { AI_PROVIDER_REGISTRY, resolveAIProviderRegistry } from "./aiProviderRegistry";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const providerStatus = makeFunctionReference<
  "query",
  { workspaceId: string },
  {
    mode: "active" | "degraded";
    activeProvider: "bedrock" | null;
    model: string | null;
    autonomy: "suggest" | "balanced" | "autopilot";
    thresholds: { suggest: null; balanced: number; autopilot: number };
  }
>("ai:providerStatus");

const testProviderConnection = makeFunctionReference<
  "action",
  { workspaceId: string },
  {
    ok: boolean;
    mode: "active" | "degraded";
    provider: "bedrock" | null;
    runtime: "ai_sdk" | "degraded";
    message: string;
  }
>("ai:testProviderConnection");

const categorizeAndRouteTransaction = makeFunctionReference<
  "action",
  {
    entityId: string;
    bankAccountId: string;
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
    proposal: {
      categoryAccountId: string;
      accountNumber: string;
      categoryName: string;
      confidence: number;
      needsHuman: boolean;
    } | null;
    route: {
      status: "posted" | "needs_review" | "duplicate";
      transactionId: string;
      entryId: string | null;
      stage: string;
    };
  }
>("bedrockCategorizer:categorizeAndRouteTransaction");

const categorizationBatchCandidates = makeFunctionReference<
  "query",
  { entityId: string; limit?: number },
  Array<{
    transactionId: string;
    entityId: string;
    bankAccountId: string;
    merchant: string;
    rawDescription: string;
    externalId: string;
  }>
>("ai:categorizationBatchCandidates");

const applyProposalToExistingTransactionInternal = makeFunctionReference<
  "mutation",
  {
    transactionId: string;
    actorUserId?: string;
    aiProposal?: {
      categoryAccountId: string;
      confidence: number;
      reasoning: string;
      needsHuman: boolean;
      question?: string;
    };
  },
  {
    status: "posted" | "needs_review" | "skipped";
    transactionId: string;
    entryId: string | null;
    stage: string;
    reason?: string;
  }
>("pipeline:applyProposalToExistingTransactionInternal");

const categorizePendingTransactions = makeFunctionReference<
  "action",
  { entityId: string; limit?: number },
  {
    batchRunId: string | null;
    batchStatus: "completed" | "partial" | "degraded" | null;
    attemptedCount: number;
    postedCount: number;
    needsReviewCount: number;
    skippedCount: number;
    degradedCount: number;
    fallbackCount: number;
    results: Array<{
      transactionId: string;
      mode: "bedrock" | "degraded" | "fallback";
      proposalSource: "llm" | null;
      fallbackReason: string | null;
      route: {
        status: "posted" | "needs_review" | "skipped";
        transactionId: string;
        entryId: string | null;
        stage: string;
        reason?: string;
      };
    }>;
  }
>("bedrockCategorizer:categorizePendingTransactions");

const categorizePendingTransactionsForImportInternal = makeFunctionReference<
  "action",
  { entityId: string; actorUserId: string; limit?: number },
  {
    batchRunId: string | null;
    batchStatus: "completed" | "partial" | "degraded" | null;
    attemptedCount: number;
    postedCount: number;
    needsReviewCount: number;
    skippedCount: number;
    degradedCount: number;
    fallbackCount: number;
    results: Array<{
      transactionId: string;
      mode: "bedrock" | "degraded" | "fallback";
      proposalSource: "llm" | null;
      fallbackReason: string | null;
      route: {
        status: "posted" | "needs_review" | "skipped";
        transactionId: string;
        entryId: string | null;
        stage: string;
        reason?: string;
      };
    }>;
  }
>("bedrockCategorizer:categorizePendingTransactionsForImportInternal");

const latestCategorizationBatchRuns = makeFunctionReference<
  "query",
  { entityId: string; limit?: number },
  Array<{
    id: string;
    status: "completed" | "partial" | "degraded";
    attemptedCount: number;
    postedCount: number;
    needsReviewCount: number;
    skippedCount: number;
    degradedCount: number;
    fallbackCount: number;
    summary: string;
    createdAt: number;
  }>
>("ai:latestCategorizationBatchRuns");
const prepareHoldoutCategorizationEval = makeFunctionReference<
  "mutation",
  { sourceEntityId: string; limit?: number },
  {
    sourceEntityId: string;
    evalEntityId: string;
    bankAccountId: string;
    currency: string;
    runKey: string;
    cases: Array<{
      sourceTransactionId: string;
      date: string;
      amountMinor: number;
      currency: string;
      merchant: string;
      rawDescription: string;
      source: "bank" | "stripe" | "manual";
      expectedAccountId: string;
      expectedAccountNumber: string;
      expectedAccountName: string;
    }>;
    skippedNonCategoryCount: number;
  }
>("ai:prepareHoldoutCategorizationEval");

async function setupAIBackend(t: ReturnType<typeof convexTest>) {
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
    const entityId = await ctx.db.insert("entities", {
      workspaceId,
      name: "Acme Studio LLC",
      slug: "acme-studio-llc",
      businessType: "services",
      currency: "USD",
      isDemo: true,
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
    const mealsAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Meals",
      type: "expense",
      subtype: "meals",
      number: "5800",
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
    return {
      userId,
      workspaceId,
      entityId,
      bankAccountId,
      operatingAccountId,
      softwareAccountId,
      mealsAccountId,
    };
  });
}

async function insertImportedNeedsReviewTransaction(
  t: ReturnType<typeof convexTest>,
  ids: {
    entityId: Id<"entities">;
    bankAccountId: Id<"bankAccounts">;
  },
  overrides: Partial<{
    merchant: string;
    rawDescription: string;
    amountMinor: number;
    externalId: string;
    review: "auto" | "confirmed" | "needs_review" | "excluded";
    decidedBy: "needs_review" | "plaid_prior" | "ai" | "rule";
  }> = {},
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const transactionId = await ctx.db.insert("transactions", {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-14",
      amountMinor: overrides.amountMinor ?? -9900,
      currency: "USD",
      merchant: overrides.merchant ?? "Figma",
      rawDescription: overrides.rawDescription ?? "Figma monthly subscription",
      status: "posted",
      review: overrides.review ?? "needs_review",
      source: "bank",
      externalId: overrides.externalId ?? `batch-${now}`,
      decidedBy: overrides.decidedBy ?? "needs_review",
      evalSet: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("inboxItems", {
      entityId: ids.entityId,
      transactionId,
      kind: "categorize",
      payloadSummary: "Figma needs review for USD 99",
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    return transactionId;
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("M10 AI backend", () => {
  it("declares an AI SDK-compatible provider registry for v1 Bedrock and future providers", () => {
    expect(Object.keys(AI_PROVIDER_REGISTRY)).toEqual(["bedrock", "anthropic", "openai", "google", "ollama"]);
    expect(AI_PROVIDER_REGISTRY.bedrock).toMatchObject({
      v1Enabled: true,
      aiSdk: {
        packageName: "@ai-sdk/amazon-bedrock",
        importName: "bedrock",
        languageModel: "bedrock(AI_MODEL)",
      },
    });
    expect(AI_PROVIDER_REGISTRY.anthropic.aiSdk.packageName).toBe("@ai-sdk/anthropic");
    expect(AI_PROVIDER_REGISTRY.openai.aiSdk.packageName).toBe("@ai-sdk/openai");
    expect(AI_PROVIDER_REGISTRY.google.aiSdk.packageName).toBe("@ai-sdk/google");
    expect(AI_PROVIDER_REGISTRY.ollama.aiSdk.packageName).toBe("ollama-ai-provider-v2");
  });

  it("resolves Bedrock as the only active v1 provider when env is complete", () => {
    vi.stubEnv("AI_PROVIDER", "bedrock");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "test-access-key");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test-secret-key");
    vi.stubEnv("AWS_REGION", "test-region-1");
    vi.stubEnv("AI_MODEL", "anthropic.claude-3-5-sonnet-test");

    const status = resolveAIProviderRegistry();

    expect(status).toMatchObject({
      mode: "active",
      activeProvider: "bedrock",
      configuredProvider: "bedrock",
      model: "anthropic.claude-3-5-sonnet-test",
      region: "test-region-1",
    });
    expect(status.providers.find((provider) => provider.id === "bedrock")).toMatchObject({
      configured: true,
      active: true,
      ready: true,
      missingEnv: [],
    });
    expect(status.providers.filter((provider) => provider.active)).toHaveLength(1);
  });

  it("keeps non-Bedrock providers registered but degraded for v1", () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("AI_MODEL", "openai/gpt-5");

    const status = resolveAIProviderRegistry();

    expect(status.mode).toBe("degraded");
    expect(status.activeProvider).toBeNull();
    expect(status.configuredProvider).toBe("openai");
    expect(status.degradedReason).toContain("registered for AI SDK compatibility");
    expect(status.providers.find((provider) => provider.id === "openai")).toMatchObject({
      configured: true,
      ready: true,
      active: false,
    });
  });

  it("builds a bounded Bedrock categorization prompt from ledger accounts", () => {
    const prompt = buildCategorizationPrompt({
      entityName: "Acme Studio LLC",
      amountMinor: -9900,
      currency: "USD",
      merchant: "Figma",
      rawDescription: "Figma monthly subscription",
      date: "2026-05-14",
      accounts: [
        {
          id: "software-account" as Id<"ledgerAccounts">,
          number: "5200",
          name: "Software & SaaS",
          type: "expense",
          subtype: "software",
        },
      ],
    });

    expect(prompt).toContain("Figma monthly subscription");
    expect(prompt).toContain("5200 | Software & SaaS | expense/software");
    expect(prompt).toContain("generic, ambiguous, an adjustment");
    expect(prompt).toContain("needsHuman=true");
    expect(prompt).toContain("Return only JSON");
    expect(prompt).not.toContain("AWS_SECRET_ACCESS_KEY");
  });

  it("parses Bedrock JSON and resolves the proposal against allowed accounts", () => {
    const raw = parseBedrockCategorizationText(`
      Here is the answer:
      \`\`\`json
      {"accountNumber":"5200","categoryName":"Software & SaaS","confidence":86,"needsHuman":false,"reasoning":"Figma is recurring design software.","question":null}
      \`\`\`
    `);
    const normalized = normalizeBedrockCategorizationProposal(raw, [
      {
        id: "software-account" as Id<"ledgerAccounts">,
        number: "5200",
        name: "Software & SaaS",
        type: "expense",
        subtype: "software",
      },
      {
        id: "meals-account" as Id<"ledgerAccounts">,
        number: "5800",
        name: "Meals",
        type: "expense",
        subtype: "meals",
      },
    ]);

    expect(normalized).toMatchObject({
      account: { number: "5200", name: "Software & SaaS" },
      aiProposal: {
        categoryAccountId: "software-account",
        confidence: 0.86,
        needsHuman: false,
        reasoning: "Figma is recurring design software.",
      },
    });
  });

  it("extracts Moonshot Kimi Bedrock chat-completion text", () => {
    const text = extractBedrockResponseText("moonshotai.kimi-k2.5", {
      choices: [
        {
          message: {
            content: "{\"accountNumber\":\"5200\",\"confidence\":0.91}",
          },
        },
      ],
    });
    expect(text).toContain("\"accountNumber\":\"5200\"");
  });

  it("reports degraded provider status when Bedrock env is absent", async () => {
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "");
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AI_MODEL", "");
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
    const session = authed(t, ids.userId);

    const status = await session.query(providerStatus, { workspaceId: ids.workspaceId });

    expect(status).toMatchObject({
      mode: "degraded",
      activeProvider: null,
      model: null,
      autonomy: "balanced",
      thresholds: { suggest: null, balanced: 0.9, autopilot: 0.75 },
    });
  });

  it("reports Bedrock as active provider when required env names are present", async () => {
    vi.stubEnv("AI_PROVIDER", "bedrock");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "test-access-key");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test-secret-key");
    vi.stubEnv("AWS_REGION", "test-region-1");
    vi.stubEnv("AI_MODEL", "anthropic.claude-3-5-sonnet-test");
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
    const session = authed(t, ids.userId);

    const status = await session.query(providerStatus, { workspaceId: ids.workspaceId });

    expect(status).toMatchObject({
      mode: "active",
      activeProvider: "bedrock",
      model: "anthropic.claude-3-5-sonnet-test",
    });
  });

  it("keeps the AI SDK connection test degraded when provider env is absent", async () => {
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "");
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AI_MODEL", "");
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
    const session = authed(t, ids.userId);

    const result = await session.action(testProviderConnection, { workspaceId: ids.workspaceId });

    expect(result).toMatchObject({
      ok: false,
      mode: "degraded",
      provider: null,
      runtime: "degraded",
    });
    expect(result.message).not.toContain("test-secret-key");
  });

  it("selects bounded existing transactions for AI batch categorization", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
    const transactionId = await insertImportedNeedsReviewTransaction(t, ids, {
      externalId: "batch-candidate-1",
    });
    await insertImportedNeedsReviewTransaction(t, ids, {
      externalId: "batch-confirmed-skip",
      review: "confirmed",
      decidedBy: "rule",
    });
    const session = authed(t, ids.userId);

    const candidates = await session.query(categorizationBatchCandidates, {
      entityId: ids.entityId,
      limit: 5,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      transactionId,
      merchant: "Figma",
      externalId: "batch-candidate-1",
    });
  });

  it("applies an AI proposal to an existing imported row without duplicating transactions", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
    const transactionId = await insertImportedNeedsReviewTransaction(t, ids, {
      externalId: "batch-apply-existing",
    });
    const session = authed(t, ids.userId);

    const result = await session.mutation(applyProposalToExistingTransactionInternal, {
      transactionId,
      aiProposal: {
        categoryAccountId: ids.softwareAccountId,
        confidence: 0.95,
        reasoning: "Figma is recurring design software.",
        needsHuman: false,
      },
    });

    expect(result).toMatchObject({ status: "posted", transactionId, stage: "ai" });
    await t.run(async (ctx) => {
      const transaction = await ctx.db.get(transactionId);
      expect(transaction).toMatchObject({
        review: "auto",
        categoryAccountId: ids.softwareAccountId,
        decidedBy: "ai",
      });
      expect(transaction?.entryId).toBeTruthy();
      const transactions = await ctx.db
        .query("transactions")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      expect(transactions).toHaveLength(1);
      const openInbox = await ctx.db
        .query("inboxItems")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      expect(openInbox.every((item) => item.status !== "open")).toBe(true);
      const lines = await ctx.db
        .query("journalLines")
        .withIndex("by_entry", (q) => q.eq("entryId", transaction!.entryId!))
        .collect();
      expect(lines).toHaveLength(2);
    });
  });

  it("applies an import AI proposal under the system actor audit trail", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
    const transactionId = await insertImportedNeedsReviewTransaction(t, ids, {
      externalId: "batch-apply-system-existing",
    });
    const systemActorUserId = await t.run(async (ctx) => {
      const now = Date.now();
      const actorUserId = await ctx.db.insert("users", {
        email: `system+sync-${ids.workspaceId}@openbooks.local`,
        name: "OpenBooks Sync",
      });
      await ctx.db.insert("systemActors", {
        workspaceId: ids.workspaceId,
        userId: actorUserId,
        kind: "sync",
        label: "system:sync",
        createdAt: now,
        updatedAt: now,
      });
      return actorUserId;
    });

    const result = await t.mutation(applyProposalToExistingTransactionInternal, {
      transactionId,
      actorUserId: systemActorUserId,
      aiProposal: {
        categoryAccountId: ids.softwareAccountId,
        confidence: 0.95,
        reasoning: "Figma is recurring design software.",
        needsHuman: false,
      },
    });

    expect(result).toMatchObject({ status: "posted", transactionId, stage: "ai" });
    await t.run(async (ctx) => {
      const transaction = await ctx.db.get(transactionId);
      expect(transaction).toMatchObject({
        review: "auto",
        categoryAccountId: ids.softwareAccountId,
        decidedBy: "ai",
      });
      const entry = transaction?.entryId ? await ctx.db.get(transaction.entryId) : null;
      expect(entry?.postedByUserId).toBe(systemActorUserId);
    });
  });

  it("degrades AI batch categorization without posting when Bedrock env is absent", async () => {
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "");
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AI_MODEL", "");
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
    const transactionId = await insertImportedNeedsReviewTransaction(t, ids, {
      externalId: "batch-degraded-1",
    });
    const session = authed(t, ids.userId);

    const result = await session.action(categorizePendingTransactions, {
      entityId: ids.entityId,
      limit: 5,
    });

    expect(result).toMatchObject({
      batchStatus: "degraded",
      attemptedCount: 1,
      postedCount: 0,
      needsReviewCount: 0,
      skippedCount: 1,
      degradedCount: 1,
      fallbackCount: 0,
    });
    expect(result.results[0]).toMatchObject({
      transactionId,
      mode: "degraded",
      proposalSource: null,
      route: { status: "skipped", transactionId, entryId: null },
    });
    expect(result.batchRunId).toBeTruthy();
    const runs = await session.query(latestCategorizationBatchRuns, {
      entityId: ids.entityId,
      limit: 5,
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: result.batchRunId,
      status: "degraded",
      attemptedCount: 1,
      postedCount: 0,
      needsReviewCount: 0,
      skippedCount: 1,
      degradedCount: 1,
      fallbackCount: 0,
    });
    expect(runs[0].summary).toContain("1 checked");
    await t.run(async (ctx) => {
      const transaction = await ctx.db.get(transactionId);
      expect(transaction).toMatchObject({
        review: "needs_review",
      });
      expect(transaction?.entryId).toBeUndefined();
    });
  });

  it("runs import-triggered categorization under the system actor without admin identity", async () => {
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "");
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AI_MODEL", "");
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
    const transactionId = await insertImportedNeedsReviewTransaction(t, ids, {
      externalId: "batch-system-import-1",
    });
    const systemActorUserId = await t.run(async (ctx) => {
      const now = Date.now();
      const actorUserId = await ctx.db.insert("users", {
        email: `system+sync-${ids.workspaceId}@openbooks.local`,
        name: "OpenBooks Sync",
      });
      await ctx.db.insert("systemActors", {
        workspaceId: ids.workspaceId,
        userId: actorUserId,
        kind: "sync",
        label: "system:sync",
        createdAt: now,
        updatedAt: now,
      });
      return actorUserId;
    });

    const result = await t.action(categorizePendingTransactionsForImportInternal, {
      entityId: ids.entityId,
      actorUserId: systemActorUserId,
      limit: 5,
    });

    expect(result).toMatchObject({
      batchStatus: "degraded",
      attemptedCount: 1,
      postedCount: 0,
      skippedCount: 1,
      degradedCount: 1,
    });
    expect(result.results[0]).toMatchObject({
      transactionId,
      mode: "degraded",
      route: { status: "skipped", transactionId, entryId: null },
    });
    await t.run(async (ctx) => {
      const transaction = await ctx.db.get(transactionId);
      expect(transaction).toMatchObject({ review: "needs_review" });
      expect(transaction?.entryId).toBeUndefined();
      const run = await ctx.db
        .query("aiBatchRuns")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .unique();
      expect(run).toMatchObject({
        requestedByUserId: systemActorUserId,
        status: "degraded",
        attemptedCount: 1,
      });
    });
  });

  it("keeps suggest-mode AI proposals in the Inbox without journal lines", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("aiConfigs", {
        workspaceId: ids.workspaceId,
        provider: "bedrock",
        chatModel: "claude-test",
        categorizeModel: "claude-test",
        autonomy: "suggest",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const session = authed(t, ids.userId);

    const result = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-04",
      amountMinor: -4999,
      currency: "USD",
      merchant: "Notion",
      rawDescription: "Notion workspace",
      status: "posted",
      source: "bank",
      externalId: "txn-ai-suggest-1",
      aiProposal: {
        categoryAccountId: ids.softwareAccountId,
        confidence: 0.99,
        reasoning: "LLM matched a recurring software vendor.",
        needsHuman: false,
      },
    });

    expect(result).toMatchObject({ status: "needs_review", entryId: null, stage: "needs_review" });
    const verification = await session.query(api.reports.seedVerification, { entityId: ids.entityId });
    expect(verification.openInboxCount).toBe(1);
    expect(verification.postedTransactionCount).toBe(0);
    expect(verification.trialBalanceDifferenceMinor).toBe(0);
    await t.run(async (ctx) => {
      const transaction = await ctx.db.get(result.transactionId);
      expect(transaction?.decidedBy).toBe("ai");
    });
  });

  it("auto-posts autopilot AI proposals only through balanced journal entries", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("aiConfigs", {
        workspaceId: ids.workspaceId,
        provider: "bedrock",
        chatModel: "claude-test",
        categorizeModel: "claude-test",
        autonomy: "autopilot",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const session = authed(t, ids.userId);

    const result = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-04",
      amountMinor: -4999,
      currency: "USD",
      merchant: "Notion",
      rawDescription: "Notion workspace",
      status: "posted",
      source: "bank",
      externalId: "txn-ai-autopilot-1",
      aiProposal: {
        categoryAccountId: ids.softwareAccountId,
        confidence: 0.8,
        reasoning: "LLM matched a recurring software vendor.",
        needsHuman: false,
      },
    });

    // E2-T7: the posted branch now reports the TRUTHFUL stage ("ai") instead of
    // the old hardcoded "rule".
    expect(result).toMatchObject({ status: "posted", stage: "ai" });
    const verification = await session.query(api.reports.seedVerification, { entityId: ids.entityId });
    expect(verification.postedTransactionCount).toBe(1);
    expect(verification.trialBalanceDifferenceMinor).toBe(0);
    await t.run(async (ctx) => {
      const transaction = await ctx.db.get(result.transactionId);
      expect(transaction?.decidedBy).toBe("ai");
      const lines = await ctx.db
        .query("journalLines")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      expect(lines).toHaveLength(2);
      expect(lines.reduce((sum, line) => sum + line.debitMinor, 0)).toBe(4999);
      expect(lines.reduce((sum, line) => sum + line.creditMinor, 0)).toBe(4999);
    });
  });

  it("turns repeated human corrections into memory and an inactive AI-drafted rule", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
    const session = authed(t, ids.userId);

    for (let index = 0; index < 3; index += 1) {
      const routed = await session.mutation(api.pipeline.routeTransaction, {
        entityId: ids.entityId,
        bankAccountId: ids.bankAccountId,
        date: `2026-05-0${index + 1}`,
        amountMinor: -2400,
        currency: "USD",
        merchant: "Cafe Izmir",
        rawDescription: "Cafe Izmir team meal",
        status: "posted",
        source: "bank",
        externalId: `txn-correction-${index}`,
        forceReview: true,
      });
      await session.mutation(api.pipeline.confirmTransaction, {
        transactionId: routed.transactionId,
        categoryAccountId: ids.mealsAccountId,
      });
    }

    const memoryRouted = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-08",
      amountMinor: -2400,
      currency: "USD",
      merchant: "Cafe Izmir",
      rawDescription: "Cafe Izmir team meal",
      status: "posted",
      source: "bank",
      externalId: "txn-memory-1",
    });

    // E2-T7: a correction-memory auto-post now reports stage "memory" (was the
    // hardcoded "rule"), matching the persisted decidedBy.
    expect(memoryRouted).toMatchObject({ status: "posted", stage: "memory" });
    await t.run(async (ctx) => {
      const transaction = await ctx.db.get(memoryRouted.transactionId);
      expect(transaction?.decidedBy).toBe("memory");
      const memories = await ctx.db
        .query("aiCorrectionMemories")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      expect(memories).toHaveLength(1);
      expect(memories[0]).toMatchObject({
        merchantKey: "cafe izmir",
        occurrenceCount: 3,
        categoryAccountId: ids.mealsAccountId,
        status: "rule_suggested",
      });
      const rules = await ctx.db
        .query("rules")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      const suggestedRule = rules.find((rule) => rule.createdBy === "ai");
      expect(suggestedRule).toMatchObject({
        name: "AI draft: Cafe Izmir",
        active: false,
        autoPost: false,
        categoryAccountId: ids.mealsAccountId,
      });
    });
  });

  it("sends items with no deterministic signal or AI proposal to the Inbox", async () => {
    // Semantic memory was removed: an item that previously matched the semantic
    // memory stage now has no proposal source (no rule, no correction memory, no
    // Plaid prior, no AI proposal) and must land in needs-review review instead.
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
    const session = authed(t, ids.userId);

    const result = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-14",
      amountMinor: -9900,
      currency: "USD",
      merchant: "Figma",
      rawDescription: "Figma monthly subscription",
      status: "posted",
      source: "bank",
      externalId: "txn-no-signal-1",
    });

    expect(result).toMatchObject({ status: "needs_review", stage: "needs_review", entryId: null });
    await t.run(async (ctx) => {
      const transaction = await ctx.db.get(result.transactionId);
      expect(transaction?.decidedBy).toBe("needs_review");
      expect(transaction?.entryId).toBeUndefined();
      const inbox = await ctx.db
        .query("inboxItems")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      expect(inbox.some((item) => item.transactionId === result.transactionId && item.status === "open")).toBe(true);
    });
  });

  it("routes an AI proposal through the LLM stage when no deterministic signal applies", async () => {
    // The path that semantic memory used to occupy now falls straight through to
    // the LLM proposal; a confident AI proposal posts via the "ai" stage.
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
    const session = authed(t, ids.userId);

    const result = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-14",
      amountMinor: -9900,
      currency: "USD",
      merchant: "Figma",
      rawDescription: "Figma monthly subscription",
      status: "posted",
      source: "bank",
      externalId: "txn-ai-stage-1",
      aiProposal: {
        categoryAccountId: ids.softwareAccountId,
        confidence: 0.95,
        reasoning: "Figma is recurring design software.",
        needsHuman: false,
      },
    });

    expect(result).toMatchObject({ status: "posted" });
    await t.run(async (ctx) => {
      const transaction = await ctx.db.get(result.transactionId);
      expect(transaction?.decidedBy).toBe("ai");
      expect(transaction?.reasoning).toContain("Pipeline stage 6 LLM proposal");
    });
  });

  it("prepares label-safe holdout eval rows without route-visible answer keys", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
    const session = authed(t, ids.userId);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("transactions", {
        entityId: ids.entityId,
        bankAccountId: ids.bankAccountId,
        date: "2026-05-14",
        amountMinor: -9900,
        currency: "USD",
        merchant: "Figma",
        rawDescription: "Figma monthly subscription",
        status: "posted",
        review: "auto",
        source: "bank",
        externalId: "eval-expense-1",
        categoryAccountId: ids.softwareAccountId,
        decidedBy: "rule",
        evalExpectedAccountId: ids.softwareAccountId,
        evalSet: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("transactions", {
        entityId: ids.entityId,
        bankAccountId: ids.bankAccountId,
        date: "2026-05-15",
        amountMinor: -2500,
        currency: "USD",
        merchant: "Owner Transfer",
        rawDescription: "Owner transfer",
        status: "posted",
        review: "auto",
        source: "bank",
        externalId: "eval-asset-skip-1",
        categoryAccountId: ids.operatingAccountId,
        decidedBy: "transfer",
        evalExpectedAccountId: ids.operatingAccountId,
        evalSet: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    const prepared = await session.mutation(prepareHoldoutCategorizationEval, {
      sourceEntityId: ids.entityId,
      limit: 5,
    });

    expect(prepared.cases).toHaveLength(1);
    expect(prepared.skippedNonCategoryCount).toBe(1);
    expect(prepared.cases[0]).toMatchObject({
      merchant: "Figma",
      expectedAccountNumber: "5200",
      expectedAccountName: "Software & SaaS",
    });
    expect(Object.keys(prepared.cases[0])).not.toContain("categoryAccountId");
  });

  it("makes auto-post MORE conservative once an overconfident calibration is fitted (E6.1)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
    const session = authed(t, ids.userId);
    await t.run(async (ctx) => {
      await ctx.db.insert("aiConfigs", {
        workspaceId: ids.workspaceId,
        provider: "bedrock",
        chatModel: "claude-test",
        categorizeModel: "claude-test",
        autonomy: "autopilot",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Without calibration, an autopilot 0.80 proposal posts (0.80 >= 0.75).
    const baselinePosted = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-04",
      amountMinor: -4999,
      currency: "USD",
      merchant: "Notion",
      rawDescription: "Notion workspace",
      status: "posted",
      source: "bank",
      externalId: "cal-baseline-post",
      aiProposal: {
        categoryAccountId: ids.softwareAccountId,
        confidence: 0.8,
        reasoning: "Recurring software vendor.",
        needsHuman: false,
      },
    });
    // E2-T7: AI auto-post reports the truthful "ai" stage (was "rule").
    expect(baselinePosted).toMatchObject({ status: "posted", stage: "ai" });

    // Fit an overconfident calibration: confidence ~0.8 only correct ~50% of
    // the time, so the calibrated probability of a raw 0.8 drops below 0.75.
    const samples = Array.from({ length: 120 }, (_, i) => ({
      rawConfidence: 0.7 + ((i * 17) % 30) / 100, // 0.70..0.99
      correct: i % 2 === 0,
    }));
    const fit = await session.mutation(api.ai.fitWorkspaceCalibration, {
      workspaceId: ids.workspaceId,
      samples,
      method: "temperature",
    });
    expect(fit.params.a).toBeLessThan(1);
    expect(fit.eceAfter).toBeLessThanOrEqual(fit.eceBefore);

    // Same 0.80 proposal now routes to review instead of auto-posting.
    const calibratedReview = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-05",
      amountMinor: -4999,
      currency: "USD",
      merchant: "Notion",
      rawDescription: "Notion workspace",
      status: "posted",
      source: "bank",
      externalId: "cal-after-fit-review",
      aiProposal: {
        categoryAccountId: ids.softwareAccountId,
        confidence: 0.8,
        reasoning: "Recurring software vendor.",
        needsHuman: false,
      },
    });
    expect(calibratedReview).toMatchObject({ status: "needs_review", entryId: null });
  });

  it("never auto-posts a blocklisted equity category even at confidence 1.0 (E6.2)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
    const session = authed(t, ids.userId);
    const ownerDrawAccountId = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("aiConfigs", {
        workspaceId: ids.workspaceId,
        provider: "bedrock",
        chatModel: "claude-test",
        categorizeModel: "claude-test",
        autonomy: "autopilot",
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.insert("ledgerAccounts", {
        entityId: ids.entityId,
        name: "Owner's Draw",
        type: "equity",
        subtype: "draw",
        number: "3100",
        currency: "USD",
        isSystem: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-06",
      amountMinor: -2500,
      currency: "USD",
      merchant: "Owner Withdrawal",
      rawDescription: "Owner draw",
      status: "posted",
      source: "bank",
      externalId: "blocklist-equity-1",
      aiProposal: {
        categoryAccountId: ownerDrawAccountId,
        confidence: 1.0,
        reasoning: "Looks like an owner draw.",
        needsHuman: false,
      },
    });

    expect(result).toMatchObject({ status: "needs_review", entryId: null, stage: "needs_review" });
    await t.run(async (ctx) => {
      const transaction = await ctx.db.get(result.transactionId);
      expect(transaction?.entryId).toBeUndefined();
    });
  });

  it("never auto-posts above the hard dollar ceiling even at confidence 1.0 (E6.2)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
    const session = authed(t, ids.userId);
    await t.run(async (ctx) => {
      await ctx.db.insert("aiConfigs", {
        workspaceId: ids.workspaceId,
        provider: "bedrock",
        chatModel: "claude-test",
        categorizeModel: "claude-test",
        autonomy: "autopilot",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-07",
      amountMinor: -2_000_000, // $20,000.00, above the $5,000 ceiling
      currency: "USD",
      merchant: "Big Vendor",
      rawDescription: "Large software invoice",
      status: "posted",
      source: "bank",
      externalId: "ceiling-block-1",
      aiProposal: {
        categoryAccountId: ids.softwareAccountId,
        confidence: 1.0,
        reasoning: "Large but clear software charge.",
        needsHuman: false,
      },
    });

    expect(result).toMatchObject({ status: "needs_review", entryId: null, stage: "needs_review" });
    await t.run(async (ctx) => {
      const transaction = await ctx.db.get(result.transactionId);
      expect(transaction?.entryId).toBeUndefined();
    });
  });

  it("routes through deterministic stages when Bedrock env is absent", async () => {
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "");
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AI_MODEL", "");
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
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
      externalId: "txn-bedrock-degraded-1",
    });

    expect(result).toMatchObject({
      mode: "degraded",
      proposal: null,
      route: { status: "needs_review", entryId: null, stage: "needs_review" },
    });
    const verification = await session.query(api.reports.seedVerification, { entityId: ids.entityId });
    expect(verification.openInboxCount).toBe(1);
    expect(verification.trialBalanceDifferenceMinor).toBe(0);
  });
});
