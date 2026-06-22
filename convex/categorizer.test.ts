/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCategorizationPrompt } from "./bedrockCategorizer";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

/**
 * E2-T1/T2/T6/T9 — provider-agnostic categorizer runtime + direction-aware
 * candidates + business-context prompt.
 *
 * The "use node" generation runtime (aiCategorizeRuntime.ts) calls the AI SDK's
 * `generateText`. We mock that one symbol so the active (BYO) path runs WITHOUT a
 * network call and returns canned JSON; the degraded path needs no model at all.
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
    categorizeModel?: string;
    chatModel?: string;
    autonomy: "suggest" | "balanced" | "autopilot";
  },
  { status: string }
>("ai:setConfig");

type CategorizationContext = {
  entity: { id: Id<"entities">; workspaceId: Id<"workspaces">; name: string; currency: string };
  candidateAccounts: Array<{
    id: Id<"ledgerAccounts">;
    number: string;
    name: string;
    type: string;
    subtype: string;
  }>;
  businessContext: {
    entityName: string;
    entityType: string | null;
    revenueStreams: string[];
    recentVendors: string[];
    recentCustomers: string[];
  };
  resolvedContactId: Id<"contacts"> | null;
};

const categorizationContext = makeFunctionReference<
  "query",
  { entityId: Id<"entities">; bankAccountId: Id<"bankAccounts">; amountMinor: number; merchant?: string },
  CategorizationContext
>("ai:categorizationContext");

type CategorizeResult = {
  mode: "bedrock" | "degraded" | "fallback";
  provider: "bedrock" | null;
  model: string | null;
  proposal: {
    categoryAccountId: Id<"ledgerAccounts">;
    accountNumber: string;
    categoryName: string;
    confidence: number;
    needsHuman: boolean;
  } | null;
  fallbackReason: string | null;
  route: {
    status: "posted" | "needs_review" | "duplicate";
    transactionId: Id<"transactions">;
    entryId: Id<"journalEntries"> | null;
    stage: string;
  };
};

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
    contactId?: Id<"contacts">;
  },
  CategorizeResult
>("bedrockCategorizer:categorizeAndRouteTransaction");

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
      entityType: "LLC",
      currency: "USD",
      isDemo: false,
      incomeStreams: [{ label: "Design retainers" }, { label: "Workshop revenue" }],
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
    const clearingAccountId = await account("1150", "Stripe Clearing", "asset", "clearing");
    const equityAccountId = await account("3000", "Owner's Equity", "equity", "equity");
    const salesAccountId = await account("4000", "Sales", "income", "sales");
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

    const vendorContactId = await ctx.db.insert("contacts", {
      entityId,
      name: "Figma",
      roles: ["vendor"],
      aliases: ["FIGMA INC"],
      createdAt: now,
      updatedAt: now,
    });

    return {
      userId,
      workspaceId,
      entityId,
      bankAccountId,
      operatingAccountId,
      clearingAccountId,
      equityAccountId,
      salesAccountId,
      softwareAccountId,
      vendorContactId,
    };
  });
}

async function saveByoAnthropic(t: TestConvex<typeof schema>, userId: Id<"users">, workspaceId: Id<"workspaces">) {
  const session = authed(t, userId);
  await session.mutation(saveCredential, {
    workspaceId,
    kind: "ai",
    provider: "anthropic",
    payload: { apiKey: "sk-ant-byo-unit-0001" },
    model: "claude-sonnet-4-6",
  });
  await session.mutation(setConfig, {
    workspaceId,
    provider: "anthropic",
    categorizeModel: "claude-sonnet-4-6",
    autonomy: "autopilot",
  });
}

beforeEach(() => {
  generateTextMock.mockReset();
  embedMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("E2-T1/T2 — provider-agnostic categorizer runtime", () => {
  it("posts an LLM proposal via a BYO Anthropic key with NO AWS env (decidedBy ai)", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await saveByoAnthropic(t, ids.userId, ids.workspaceId);

    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        accountNumber: "5200",
        categoryName: "Software & SaaS",
        confidence: 0.95,
        needsHuman: false,
        reasoning: "Figma is recurring design software.",
      }),
      finishReason: "stop",
    });

    const result = await authed(t, ids.userId).action(categorizeAndRouteTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-02-01",
      amountMinor: -2400,
      currency: "USD",
      merchant: "Figma",
      rawDescription: "FIGMA MONTHLY",
      status: "posted",
      source: "bank",
      externalId: "byo-anthropic-post-1",
    });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(result.route.status).toBe("posted");
    expect(result.route.entryId).not.toBeNull();
    expect(result.proposal?.categoryAccountId).toBe(ids.softwareAccountId);

    await t.run(async (ctx) => {
      const txn = await ctx.db.get(result.route.transactionId);
      expect(txn?.decidedBy).toBe("ai");
      expect(txn?.categoryAccountId).toBe(ids.softwareAccountId);
      expect(txn?.entryId).toBeTruthy();
    });
  });

  it("routes to needs_review (degraded) when no provider is configured, with no throw", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);

    const result = await authed(t, ids.userId).action(categorizeAndRouteTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-02-01",
      amountMinor: -2400,
      currency: "USD",
      merchant: "Figma",
      rawDescription: "FIGMA MONTHLY",
      status: "posted",
      source: "bank",
      externalId: "degraded-needs-review-1",
    });

    expect(generateTextMock).not.toHaveBeenCalled();
    expect(result.mode).toBe("degraded");
    expect(result.proposal).toBeNull();
    expect(result.route.status).toBe("needs_review");
    expect(result.route.entryId).toBeNull();
  });

  it("E2-T1 seam: resolveCategorizeReadiness is active with BYO, degraded without", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);

    const degraded = await t.action(internal.aiCategorizeRuntime.resolveCategorizeReadiness, {
      workspaceId: ids.workspaceId,
    });
    expect(degraded.ready).toBe(false);
    expect(degraded.reason).toBeTruthy();

    await saveByoAnthropic(t, ids.userId, ids.workspaceId);
    const active = await t.action(internal.aiCategorizeRuntime.resolveCategorizeReadiness, {
      workspaceId: ids.workspaceId,
    });
    expect(active.ready).toBe(true);
    expect(active.provider).toBe("anthropic");
    expect(active.model).toBe("claude-sonnet-4-6");
  });
});

describe("E2-T6 — direction-aware candidate set", () => {
  it("offers non-income candidates for an inflow", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    const context = await session.query(categorizationContext, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      amountMinor: 5000, // inflow
    });

    const types = new Set(context.candidateAccounts.map((account) => account.type));
    expect(types.has("income")).toBe(true);
    // The whole point of E2-T6: an inflow is no longer income-only.
    const nonIncome = context.candidateAccounts.filter((account) => account.type !== "income");
    expect(nonIncome.length).toBeGreaterThan(0);
    // Equity contribution + clearing/transfer asset are offered for inflows.
    expect(context.candidateAccounts.some((account) => account.id === ids.equityAccountId)).toBe(true);
    expect(context.candidateAccounts.some((account) => account.id === ids.clearingAccountId)).toBe(true);
    // Income is ranked first (ordinary case leads the prompt).
    expect(context.candidateAccounts[0]?.type).toBe("income");
  });

  it("offers non-expense candidates for an outflow", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    const context = await session.query(categorizationContext, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      amountMinor: -5000, // outflow
    });
    const nonExpense = context.candidateAccounts.filter((account) => account.type !== "expense");
    expect(nonExpense.length).toBeGreaterThan(0);
    expect(context.candidateAccounts[0]?.type).toBe("expense");
  });

  it("lets a refund-shaped inflow be proposed to a non-income account", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await saveByoAnthropic(t, ids.userId, ids.workspaceId);

    // The model returns a contra/refund target (the software expense account)
    // for a refund inflow — only possible because the candidate set is no longer
    // locked to income for inflows.
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        accountNumber: "5200",
        categoryName: "Software & SaaS",
        confidence: 0.92,
        needsHuman: false,
        reasoning: "Refund of a prior Figma charge — book against the original expense.",
      }),
      finishReason: "stop",
    });

    const result = await authed(t, ids.userId).action(categorizeAndRouteTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-02-02",
      amountMinor: 2400, // inflow (refund)
      currency: "USD",
      merchant: "Figma",
      rawDescription: "FIGMA REFUND",
      status: "posted",
      source: "bank",
      externalId: "refund-inflow-1",
    });

    expect(result.proposal?.categoryAccountId).toBe(ids.softwareAccountId);
    expect(result.proposal?.categoryAccountId).not.toBe(ids.salesAccountId);
  });
});

describe("E2-T5 — embedding / k-NN recall stage before the LLM", () => {
  // A pair of near-identical and orthogonal 1024-vectors for deterministic
  // cosine scores in convex-test's in-memory vectorSearch.
  const nearVector = Array.from({ length: 1024 }, (_, i) => (i % 7) / 7 + 0.1);
  const farVector = Array.from({ length: 1024 }, (_, i) => (i % 2 === 0 ? 1 : -1) * ((i % 5) / 5));

  async function seedMemoryEmbedding(
    t: TestConvex<typeof schema>,
    ids: Awaited<ReturnType<typeof setup>>,
    vector: number[],
  ) {
    await t.run(async (ctx) => {
      const now = Date.now();
      const memoryId = await ctx.db.insert("aiCorrectionMemories", {
        entityId: ids.entityId,
        merchantKey: "amzn web services",
        merchantDisplayName: "AMZN WEB SERVICES",
        direction: "outflow",
        categoryAccountId: ids.softwareAccountId,
        occurrenceCount: 6,
        lastTransactionId: (await ctx.db
          .query("transactions")
          .first())?._id ?? (await ctx.db.insert("transactions", {
            entityId: ids.entityId,
            bankAccountId: ids.bankAccountId,
            date: "2026-01-01",
            amountMinor: -1000,
            currency: "USD",
            merchant: "seed",
            rawDescription: "seed",
            status: "posted",
            review: "confirmed",
            source: "bank",
            externalId: "seed-mem-txn",
            evalSet: false,
            createdAt: now,
            updatedAt: now,
          })),
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("aiMemoryEmbeddings", {
        entityId: ids.entityId,
        correctionMemoryId: memoryId,
        merchantKey: "amzn web services",
        merchantDisplayName: "AMZN WEB SERVICES",
        direction: "outflow",
        categoryAccountId: ids.softwareAccountId,
        sourceText: "AMZN WEB SERVICES (amzn web services)",
        embedding: vector,
        embeddingModel: "openai:text-embedding-3-small",
        occurrenceCount: 6,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  it("recalls a merchant variant ('AWS') to the same category via stage 'embedding'", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    // OpenAI key makes the embedder resolvable; autopilot lets the recall post.
    await authed(t, ids.userId).mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "ai",
      provider: "openai",
      payload: { apiKey: "sk-openai-recall-0001" },
    });
    await authed(t, ids.userId).mutation(setConfig, {
      workspaceId: ids.workspaceId,
      provider: "openai",
      categorizeModel: "gpt-5-mini",
      autonomy: "autopilot",
    });

    await seedMemoryEmbedding(t, ids, nearVector);
    // The query embedding is identical to the stored one → cosine ~1.0 ≥ 0.82.
    embedMock.mockResolvedValue({ embedding: nearVector, usage: { tokens: 1 }, value: "AWS" });

    const result = await authed(t, ids.userId).action(categorizeAndRouteTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-02-10",
      amountMinor: -9900,
      currency: "USD",
      merchant: "AWS",
      rawDescription: "AWS CLOUD",
      status: "posted",
      source: "bank",
      externalId: "recall-variant-1",
    });

    // The LLM was never called — recall short-circuited it.
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(result.route.status).toBe("posted");
    expect(result.route.stage).toBe("embedding");

    await t.run(async (ctx) => {
      const txn = await ctx.db.get(result.route.transactionId);
      expect(txn?.decidedBy).toBe("embedding");
      expect(txn?.categoryAccountId).toBe(ids.softwareAccountId);
      expect(txn?.entryId).toBeTruthy();
    });
  });

  it("falls through to the LLM when no memory is similar enough (below threshold)", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await authed(t, ids.userId).mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "ai",
      provider: "openai",
      payload: { apiKey: "sk-openai-recall-0002" },
    });
    await authed(t, ids.userId).mutation(setConfig, {
      workspaceId: ids.workspaceId,
      provider: "openai",
      categorizeModel: "gpt-5-mini",
      autonomy: "autopilot",
    });

    await seedMemoryEmbedding(t, ids, nearVector);
    // Query vector is orthogonal-ish to the stored one → below threshold.
    embedMock.mockResolvedValue({ embedding: farVector, usage: { tokens: 1 }, value: "Stripe" });
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        accountNumber: "5200",
        categoryName: "Software & SaaS",
        confidence: 0.95,
        needsHuman: false,
        reasoning: "Resolved by the model, not recall.",
      }),
      finishReason: "stop",
    });

    const result = await authed(t, ids.userId).action(categorizeAndRouteTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-02-11",
      amountMinor: -1200,
      currency: "USD",
      merchant: "Some Other Vendor",
      rawDescription: "OTHER VENDOR",
      status: "posted",
      source: "bank",
      externalId: "recall-below-threshold-1",
    });

    // No false recall: the LLM ran and the decision is 'ai', not 'embedding'.
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(result.route.stage).not.toBe("embedding");
    await t.run(async (ctx) => {
      const txn = await ctx.db.get(result.route.transactionId);
      expect(txn?.decidedBy).toBe("ai");
    });
  });
});

describe("E2-T9 — business context in prompt + contactId carry", () => {
  it("buildCategorizationPrompt renders a Business context section", () => {
    const prompt = buildCategorizationPrompt({
      entityName: "Acme Studio LLC",
      amountMinor: 5000,
      currency: "USD",
      merchant: "Stripe payout",
      rawDescription: "STRIPE PAYOUT",
      date: "2026-02-01",
      accounts: [{ id: "x" as Id<"ledgerAccounts">, number: "4000", name: "Sales", type: "income", subtype: "sales" }],
      businessContext: {
        entityName: "Acme Studio LLC",
        entityType: "LLC",
        revenueStreams: ["Design retainers", "Workshop revenue"],
        recentVendors: ["Figma"],
        recentCustomers: ["Globex Corp"],
      },
    });

    expect(prompt).toContain("Business context:");
    expect(prompt).toContain("Acme Studio LLC");
    expect(prompt).toContain("Design retainers");
    // Inflow → recent customers hint is rendered.
    expect(prompt).toContain("Globex Corp");
  });

  it("still produces a valid prompt with no business context", () => {
    const prompt = buildCategorizationPrompt({
      entityName: "Acme Studio LLC",
      amountMinor: -5000,
      currency: "USD",
      merchant: "Figma",
      rawDescription: "FIGMA MONTHLY",
      date: "2026-02-01",
      accounts: [
        { id: "x" as Id<"ledgerAccounts">, number: "5200", name: "Software & SaaS", type: "expense", subtype: "software" },
      ],
    });
    expect(prompt).not.toContain("Business context:");
    expect(prompt).toContain("JSON shape:");
  });

  it("carries contactId onto the categorized transaction", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await saveByoAnthropic(t, ids.userId, ids.workspaceId);

    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        accountNumber: "5200",
        categoryName: "Software & SaaS",
        confidence: 0.95,
        needsHuman: false,
        reasoning: "Figma software.",
      }),
      finishReason: "stop",
    });

    const result = await authed(t, ids.userId).action(categorizeAndRouteTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-02-03",
      amountMinor: -2400,
      currency: "USD",
      merchant: "Figma",
      rawDescription: "FIGMA MONTHLY",
      status: "posted",
      source: "bank",
      externalId: "contact-explicit-1",
      contactId: ids.vendorContactId,
    });

    await t.run(async (ctx) => {
      const txn = await ctx.db.get(result.route.transactionId);
      expect(txn?.contactId).toBe(ids.vendorContactId);
    });
  });

  it("resolves contactId from the merchant when none is supplied", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await saveByoAnthropic(t, ids.userId, ids.workspaceId);

    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        accountNumber: "5200",
        categoryName: "Software & SaaS",
        confidence: 0.95,
        needsHuman: false,
        reasoning: "Figma software.",
      }),
      finishReason: "stop",
    });

    const result = await authed(t, ids.userId).action(categorizeAndRouteTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-02-04",
      amountMinor: -2400,
      currency: "USD",
      merchant: "FIGMA INC", // alias of the Figma contact
      rawDescription: "FIGMA MONTHLY",
      status: "posted",
      source: "bank",
      externalId: "contact-resolved-1",
    });

    await t.run(async (ctx) => {
      const txn = await ctx.db.get(result.route.transactionId);
      expect(txn?.contactId).toBe(ids.vendorContactId);
    });
  });
});
