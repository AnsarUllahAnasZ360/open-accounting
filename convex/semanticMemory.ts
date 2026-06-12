import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import {
  bedrockRuntimeEnv,
  invokeBedrockPayload,
  type BedrockPayload,
} from "./bedrockCategorizer";
import { requireWorkspaceRole } from "./authz";

export const SEMANTIC_MEMORY_DIMENSIONS = 1024;
const SEMANTIC_MEMORY_MIN_SCORE = 0.72;

type Direction = "inflow" | "outflow";

type EmbeddingMode =
  | { mode: "bedrock"; memoryEmbeddingId: Id<"aiMemoryEmbeddings"> }
  | { mode: "degraded" | "fallback"; reason: string };

type CorrectionEmbeddingContext = {
  entityId: Id<"entities">;
  correctionMemoryId: Id<"aiCorrectionMemories">;
  merchantKey: string;
  merchantDisplayName: string;
  direction: Direction;
  categoryAccountId: Id<"ledgerAccounts">;
  occurrenceCount: number;
  status: "active" | "rule_suggested";
  sourceText: string;
  embeddingsModel: string | null;
};

type RouteEmbeddingContext = {
  entityId: Id<"entities">;
  direction: Direction;
  sourceText: string;
  embeddingsModel: string | null;
};

type HydratedSemanticMemory = {
  id: Id<"aiMemoryEmbeddings">;
  categoryAccountId: Id<"ledgerAccounts">;
  merchantDisplayName: string;
  direction: Direction;
  occurrenceCount: number;
  status: "active" | "rule_suggested";
};

export type SemanticMemoryProposal = {
  categoryAccountId: Id<"ledgerAccounts">;
  confidence: number;
  reasoning: string;
};

function present(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

function directionFor(amountMinor: number): Direction {
  return amountMinor >= 0 ? "inflow" : "outflow";
}

function normalizeMerchantKey(merchant: string) {
  return merchant.trim().toLowerCase().replace(/\s+/g, " ");
}

function amountBand(amountMinor: number) {
  const amount = Math.abs(amountMinor);
  if (amount < 2_500) return "small";
  if (amount < 25_000) return "medium";
  return "large";
}

export function buildMemoryEmbeddingText(args: {
  merchant: string;
  rawDescription: string;
  amountMinor: number;
  currency: string;
}) {
  return [
    `merchant: ${args.merchant.trim()}`,
    `description: ${args.rawDescription.trim()}`,
    `direction: ${directionFor(args.amountMinor)}`,
    `amount_band: ${amountBand(args.amountMinor)}`,
    `currency: ${args.currency.trim().toUpperCase()}`,
  ].join("\n");
}

function aiEnvEmbeddingsModel() {
  return present(process.env.AI_EMBEDDINGS_MODEL) ? process.env.AI_EMBEDDINGS_MODEL!.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function bedrockEmbeddingPayload(modelId: string, text: string): BedrockPayload {
  if (modelId.includes("amazon.titan-embed-text")) {
    return {
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        inputText: text.slice(0, 8_000),
        dimensions: SEMANTIC_MEMORY_DIMENSIONS,
        normalize: true,
      }),
    };
  }
  throw new Error("Configured AI_EMBEDDINGS_MODEL must be an Amazon Titan text embeddings model.");
}

export function extractEmbeddingVector(payload: unknown) {
  const body = asRecord(payload);
  const embedding = body?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error("Bedrock embedding response did not include an embedding vector.");
  }
  const vector = embedding.map((value) => Number(value));
  if (vector.length !== SEMANTIC_MEMORY_DIMENSIONS || vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`Bedrock embedding vector must contain ${SEMANTIC_MEMORY_DIMENSIONS} finite numbers.`);
  }
  return vector;
}

export async function embedSemanticText(args: { modelId: string; text: string }) {
  const env = bedrockRuntimeEnv(args.modelId);
  if (!env.ready || !env.modelId) {
    throw new Error("Bedrock embeddings env is absent or incomplete.");
  }
  const response = await invokeBedrockPayload({
    env,
    payload: bedrockEmbeddingPayload(env.modelId, args.text),
  });
  return {
    modelId: env.modelId,
    vector: extractEmbeddingVector(response),
  };
}

export const correctionEmbeddingContext = internalQuery({
  args: {
    transactionId: v.id("transactions"),
    categoryAccountId: v.id("ledgerAccounts"),
  },
  handler: async (ctx, args): Promise<CorrectionEmbeddingContext | null> => {
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction) {
      throw new ConvexError("Transaction not found.");
    }
    const entity = await ctx.db.get(transaction.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks entity not found.");
    }
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const categoryAccount = await ctx.db.get(args.categoryAccountId);
    if (!categoryAccount || categoryAccount.entityId !== entity._id || categoryAccount.archived) {
      throw new ConvexError("Choose an active category on this entity.");
    }
    const merchantKey = normalizeMerchantKey(transaction.merchant);
    const direction = directionFor(transaction.amountMinor);
    const memories = await ctx.db
      .query("aiCorrectionMemories")
      .withIndex("by_entity_and_merchant_key_and_direction", (q) =>
        q.eq("entityId", entity._id).eq("merchantKey", merchantKey).eq("direction", direction),
      )
      .take(10);
    const memory = memories.find((candidate) => candidate.categoryAccountId === args.categoryAccountId) ?? null;
    if (!memory) {
      return null;
    }
    const config = await ctx.db
      .query("aiConfigs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", entity.workspaceId))
      .unique();
    return {
      entityId: entity._id,
      correctionMemoryId: memory._id,
      merchantKey: memory.merchantKey,
      merchantDisplayName: memory.merchantDisplayName,
      direction: memory.direction,
      categoryAccountId: memory.categoryAccountId,
      occurrenceCount: memory.occurrenceCount,
      status: memory.status,
      sourceText: buildMemoryEmbeddingText({
        merchant: transaction.merchant,
        rawDescription: transaction.rawDescription,
        amountMinor: transaction.amountMinor,
        currency: transaction.currency,
      }),
      embeddingsModel: config?.embedModel ?? aiEnvEmbeddingsModel(),
    };
  },
});

export const routeEmbeddingContext = internalQuery({
  args: {
    entityId: v.id("entities"),
    merchant: v.string(),
    rawDescription: v.string(),
    amountMinor: v.number(),
    currency: v.string(),
  },
  handler: async (ctx, args): Promise<RouteEmbeddingContext> => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks entity not found.");
    }
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const config = await ctx.db
      .query("aiConfigs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", entity.workspaceId))
      .unique();
    return {
      entityId: entity._id,
      direction: directionFor(args.amountMinor),
      sourceText: buildMemoryEmbeddingText(args),
      embeddingsModel: config?.embedModel ?? aiEnvEmbeddingsModel(),
    };
  },
});

export const hydrateSemanticMemoryMatches = internalQuery({
  args: {
    entityId: v.id("entities"),
    memoryEmbeddingIds: v.array(v.id("aiMemoryEmbeddings")),
  },
  handler: async (ctx, args): Promise<HydratedSemanticMemory[]> => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks entity not found.");
    }
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const hydrated: HydratedSemanticMemory[] = [];
    for (const id of args.memoryEmbeddingIds.slice(0, 10)) {
      const memory = await ctx.db.get(id);
      if (!memory || memory.entityId !== entity._id) continue;
      const account = await ctx.db.get(memory.categoryAccountId);
      if (!account || account.entityId !== entity._id || account.archived) continue;
      hydrated.push({
        id: memory._id,
        categoryAccountId: memory.categoryAccountId,
        merchantDisplayName: memory.merchantDisplayName,
        direction: memory.direction,
        occurrenceCount: memory.occurrenceCount,
        status: memory.status,
      });
    }
    return hydrated;
  },
});

export const upsertCorrectionMemoryEmbedding = internalMutation({
  args: {
    entityId: v.id("entities"),
    correctionMemoryId: v.id("aiCorrectionMemories"),
    merchantKey: v.string(),
    merchantDisplayName: v.string(),
    direction: v.union(v.literal("inflow"), v.literal("outflow")),
    categoryAccountId: v.id("ledgerAccounts"),
    sourceText: v.string(),
    embedding: v.array(v.float64()),
    embeddingModel: v.string(),
    occurrenceCount: v.number(),
    status: v.union(v.literal("active"), v.literal("rule_suggested")),
  },
  handler: async (ctx, args) => {
    if (args.embedding.length !== SEMANTIC_MEMORY_DIMENSIONS || args.embedding.some((value) => !Number.isFinite(value))) {
      throw new ConvexError(`Semantic memory embeddings must be ${SEMANTIC_MEMORY_DIMENSIONS} finite numbers.`);
    }
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks entity not found.");
    }
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const account = await ctx.db.get(args.categoryAccountId);
    if (!account || account.entityId !== entity._id || account.archived) {
      throw new ConvexError("Choose an active category on this entity.");
    }
    const existing = await ctx.db
      .query("aiMemoryEmbeddings")
      .withIndex("by_memory", (q) => q.eq("correctionMemoryId", args.correctionMemoryId))
      .first();
    const now = Date.now();
    const row = {
      entityId: entity._id,
      correctionMemoryId: args.correctionMemoryId,
      merchantKey: args.merchantKey,
      merchantDisplayName: args.merchantDisplayName,
      direction: args.direction,
      categoryAccountId: args.categoryAccountId,
      sourceText: args.sourceText,
      embedding: args.embedding,
      embeddingModel: args.embeddingModel,
      occurrenceCount: args.occurrenceCount,
      status: args.status,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, row);
      return { memoryEmbeddingId: existing._id, status: "updated" as const };
    }
    const memoryEmbeddingId = await ctx.db.insert("aiMemoryEmbeddings", {
      ...row,
      createdAt: now,
    });
    return { memoryEmbeddingId, status: "created" as const };
  },
});

async function embedCorrectionMemory(
  ctx: ActionCtx,
  args: { transactionId: Id<"transactions">; categoryAccountId: Id<"ledgerAccounts"> },
): Promise<EmbeddingMode> {
  const context: CorrectionEmbeddingContext | null = await ctx.runQuery(
    internal.semanticMemory.correctionEmbeddingContext,
    args,
  );
  if (!context) {
    return { mode: "fallback", reason: "No correction memory row was available to embed." };
  }
  if (!context.embeddingsModel) {
    return { mode: "degraded", reason: "AI_EMBEDDINGS_MODEL is not configured; table-backed memory remains active." };
  }
  try {
    const embedded = await embedSemanticText({ modelId: context.embeddingsModel, text: context.sourceText });
    const result: { memoryEmbeddingId: Id<"aiMemoryEmbeddings"> } = await ctx.runMutation(
      internal.semanticMemory.upsertCorrectionMemoryEmbedding,
      {
        entityId: context.entityId,
        correctionMemoryId: context.correctionMemoryId,
        merchantKey: context.merchantKey,
        merchantDisplayName: context.merchantDisplayName,
        direction: context.direction,
        categoryAccountId: context.categoryAccountId,
        sourceText: context.sourceText,
        embedding: embedded.vector,
        embeddingModel: embedded.modelId,
        occurrenceCount: context.occurrenceCount,
        status: context.status,
      },
    );
    return { mode: "bedrock", memoryEmbeddingId: result.memoryEmbeddingId };
  } catch (error) {
    return {
      mode: "fallback",
      reason: error instanceof Error ? error.message : "Bedrock semantic memory embedding failed.",
    };
  }
}

export async function findSemanticMemoryProposal(
  ctx: ActionCtx,
  args: {
    entityId: Id<"entities">;
    merchant: string;
    rawDescription: string;
    amountMinor: number;
    currency: string;
  },
): Promise<SemanticMemoryProposal | null> {
  const context: RouteEmbeddingContext = await ctx.runQuery(internal.semanticMemory.routeEmbeddingContext, args);
  if (!context.embeddingsModel) {
    return null;
  }
  const embedded = await embedSemanticText({ modelId: context.embeddingsModel, text: context.sourceText });
  const matches = await ctx.vectorSearch("aiMemoryEmbeddings", "by_embedding", {
    vector: embedded.vector,
    limit: 5,
    filter: (q) => q.eq("entityId", args.entityId),
  });
  const hydrated: HydratedSemanticMemory[] = await ctx.runQuery(
    internal.semanticMemory.hydrateSemanticMemoryMatches,
    {
      entityId: args.entityId,
      memoryEmbeddingIds: matches.map((match) => match._id),
    },
  );
  const byId = new Map(hydrated.map((memory) => [memory.id, memory]));
  for (const match of matches) {
    if (match._score < SEMANTIC_MEMORY_MIN_SCORE) continue;
    const memory = byId.get(match._id);
    if (!memory || memory.direction !== context.direction) continue;
    return {
      categoryAccountId: memory.categoryAccountId,
      confidence: Math.min(0.94, Math.max(0.76, match._score)),
      reasoning: `Pipeline stage 4 matched semantic correction memory for ${memory.merchantDisplayName} (${memory.occurrenceCount} confirmations, score ${match._score.toFixed(2)}).`,
    };
  }
  return null;
}

export const proposeCategorizationMemory = internalAction({
  args: {
    entityId: v.id("entities"),
    merchant: v.string(),
    rawDescription: v.string(),
    amountMinor: v.number(),
    currency: v.string(),
  },
  handler: async (ctx, args): Promise<SemanticMemoryProposal | null> => {
    return await findSemanticMemoryProposal(ctx, args);
  },
});

export const confirmTransactionWithMemoryEmbedding = action({
  args: {
    transactionId: v.id("transactions"),
    categoryAccountId: v.optional(v.id("ledgerAccounts")),
  },
  handler: async (ctx, args) => {
    const result: { entryId: Id<"journalEntries">; status: "confirmed" } = await ctx.runMutation(
      internal.pipeline.confirmTransactionInternal,
      {
        transactionId: args.transactionId,
        ...(args.categoryAccountId ? { categoryAccountId: args.categoryAccountId } : {}),
      },
    );
    if (!args.categoryAccountId) {
      return {
        ...result,
        memoryEmbedding: { mode: "fallback" as const, reason: "No category was supplied for semantic memory embedding." },
      };
    }
    return {
      ...result,
      memoryEmbedding: await embedCorrectionMemory(ctx, {
        transactionId: args.transactionId,
        categoryAccountId: args.categoryAccountId,
      }),
    };
  },
});

export const recategorizeTransactionWithMemoryEmbedding = action({
  args: {
    transactionId: v.id("transactions"),
    categoryAccountId: v.id("ledgerAccounts"),
  },
  handler: async (ctx, args) => {
    const result: { entryId: Id<"journalEntries">; status: "recategorized" } = await ctx.runMutation(
      internal.pipeline.recategorizeTransactionInternal,
      args,
    );
    return {
      ...result,
      memoryEmbedding: await embedCorrectionMemory(ctx, args),
    };
  },
});
