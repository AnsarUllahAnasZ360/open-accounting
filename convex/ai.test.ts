/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  buildCategorizationPrompt,
  normalizeBedrockCategorizationProposal,
  parseBedrockCategorizationText,
} from "./bedrockCategorizer";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const providerStatus = makeFunctionReference<
  "query",
  { workspaceId: string },
  {
    mode: "active" | "degraded";
    activeProvider: "bedrock" | null;
    model: string | null;
    embeddingsModel: string | null;
    autonomy: "suggest" | "balanced" | "autopilot";
    thresholds: { suggest: null; balanced: number; autopilot: number };
  }
>("ai:providerStatus");

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
      softwareAccountId,
      mealsAccountId,
    };
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

  it("reports degraded provider status when Bedrock env is absent", async () => {
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "");
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AI_MODEL", "");
    vi.stubEnv("AI_EMBEDDINGS_MODEL", "");
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
    const session = authed(t, ids.userId);

    const status = await session.query(providerStatus, { workspaceId: ids.workspaceId });

    expect(status).toMatchObject({
      mode: "degraded",
      activeProvider: null,
      model: null,
      embeddingsModel: null,
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
    vi.stubEnv("AI_EMBEDDINGS_MODEL", "test-embed-model");
    const t = convexTest(schema, modules);
    const ids = await setupAIBackend(t);
    const session = authed(t, ids.userId);

    const status = await session.query(providerStatus, { workspaceId: ids.workspaceId });

    expect(status).toMatchObject({
      mode: "active",
      activeProvider: "bedrock",
      model: "anthropic.claude-3-5-sonnet-test",
      embeddingsModel: "test-embed-model",
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
        embedModel: "titan-test",
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
        embedModel: "titan-test",
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

    expect(result).toMatchObject({ status: "posted", stage: "rule" });
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

    expect(memoryRouted).toMatchObject({ status: "posted", stage: "rule" });
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
