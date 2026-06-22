/**
 * Database helpers for the semantic-memory embedding loop (E2-T4 / E2-T5).
 *
 * The embedding generation runs in the `"use node"` action module
 * (embeddings.ts); these queries/mutations are the plain-runtime DB seam it
 * calls to read a correction memory and upsert its `aiMemoryEmbeddings` row. The
 * ONE writer of the vector table lives here so the action stays pure of DB
 * access and the row shape is enforced in one place.
 */

import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";

/** The text we embed for a merchant memory. Stable, deterministic, lowercased. */
export function embeddingSourceText(memory: Doc<"aiCorrectionMemories">): string {
  const display = memory.merchantDisplayName.trim();
  const key = memory.merchantKey.trim();
  // Include both the human display name and the normalized key so a variant
  // ("AMZN WEB SERVICES") embeds near a saved memory ("AWS") via shared tokens.
  return display && display.toLowerCase() !== key ? `${display} (${key})` : display || key;
}

async function loadCorrectionMemoryContext(ctx: QueryCtx, correctionMemoryId: Id<"aiCorrectionMemories">) {
  const memory = await ctx.db.get(correctionMemoryId);
  if (!memory) return null;
  const entity = await ctx.db.get(memory.entityId);
  if (!entity) return null;
  return { memory, entity };
}

/**
 * Read everything the embedder needs for a correction memory: the workspace (so
 * it resolves the embedding credential) and the deterministic source text.
 */
export const getCorrectionMemoryForEmbedding = internalQuery({
  args: { correctionMemoryId: v.id("aiCorrectionMemories") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    workspaceId: Id<"workspaces">;
    entityId: Id<"entities">;
    sourceText: string;
  } | null> => {
    const loaded = await loadCorrectionMemoryContext(ctx, args.correctionMemoryId);
    if (!loaded) return null;
    return {
      workspaceId: loaded.entity.workspaceId,
      entityId: loaded.memory.entityId,
      sourceText: embeddingSourceText(loaded.memory),
    };
  },
});

/**
 * Read a single `aiMemoryEmbeddings` row by id (E2-T5). The recall action runs
 * `vectorSearch` (which returns only ids + scores) then loads the winning row's
 * category/direction/occurrence so it can build the proposal.
 */
export const getMemoryEmbeddingRow = internalQuery({
  args: { embeddingId: v.id("aiMemoryEmbeddings") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    entityId: Id<"entities">;
    categoryAccountId: Id<"ledgerAccounts">;
    direction: "inflow" | "outflow";
    merchantDisplayName: string;
    occurrenceCount: number;
    status: "active" | "rule_suggested";
  } | null> => {
    const row = await ctx.db.get(args.embeddingId);
    if (!row) return null;
    return {
      entityId: row.entityId,
      categoryAccountId: row.categoryAccountId,
      direction: row.direction,
      merchantDisplayName: row.merchantDisplayName,
      occurrenceCount: row.occurrenceCount,
      status: row.status,
    };
  },
});

/**
 * Upsert the `aiMemoryEmbeddings` row for a correction memory (by_memory index).
 * A second correction for the same merchantKey UPDATES the existing row in place
 * (and bumps occurrenceCount / mirrors status) instead of duplicating it. The
 * stored fields mirror the correction memory so recall (E2-T5) can map a hit
 * back to its category/direction without a second read.
 */
export const upsertMemoryEmbedding = internalMutation({
  args: {
    correctionMemoryId: v.id("aiCorrectionMemories"),
    embedding: v.array(v.float64()),
    embeddingModel: v.string(),
  },
  handler: async (ctx, args): Promise<{ embeddingId: Id<"aiMemoryEmbeddings"> } | null> => {
    const memory = await ctx.db.get(args.correctionMemoryId);
    if (!memory) return null;
    const now = Date.now();
    const sourceText = embeddingSourceText(memory);
    const existing = await ctx.db
      .query("aiMemoryEmbeddings")
      .withIndex("by_memory", (q) => q.eq("correctionMemoryId", args.correctionMemoryId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        merchantKey: memory.merchantKey,
        merchantDisplayName: memory.merchantDisplayName,
        direction: memory.direction,
        categoryAccountId: memory.categoryAccountId,
        sourceText,
        embedding: args.embedding,
        embeddingModel: args.embeddingModel,
        occurrenceCount: memory.occurrenceCount,
        status: memory.status,
        updatedAt: now,
      });
      return { embeddingId: existing._id };
    }

    const embeddingId = await ctx.db.insert("aiMemoryEmbeddings", {
      entityId: memory.entityId,
      correctionMemoryId: args.correctionMemoryId,
      merchantKey: memory.merchantKey,
      merchantDisplayName: memory.merchantDisplayName,
      direction: memory.direction,
      categoryAccountId: memory.categoryAccountId,
      sourceText,
      embedding: args.embedding,
      embeddingModel: args.embeddingModel,
      occurrenceCount: memory.occurrenceCount,
      status: memory.status,
      createdAt: now,
      updatedAt: now,
    });
    return { embeddingId };
  },
});
