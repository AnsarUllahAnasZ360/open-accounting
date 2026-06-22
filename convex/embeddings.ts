"use node";

/**
 * Semantic-memory embedding runtime (E2-T4 / E2-T5).
 *
 * Brings the dead `aiMemoryEmbeddings` vector table to life. On every human
 * correction (pipeline.recordCorrectionMemory) we embed the merchant text and
 * store a 1024-dim vector so a later merchant VARIANT ("AMZN WEB SERVICES" vs
 * "AWS") can be recalled by k-NN before the LLM is ever called (E2-T5).
 *
 * Pinned embedding policy (decisions.md Q7):
 *   - ONE embedding model, pinned at 1024 dims, DECOUPLED from the user's
 *     chat/categorization provider. Never mix models in the index — a one-way
 *     door, because vectors from different models are not comparable.
 *   - Use a model that natively emits 1024 dims: OpenAI
 *     `text-embedding-3-small`/`-large` with the `dimensions:1024` Matryoshka
 *     parameter, or Bedrock Titan v2 (`amazon.titan-embed-text-v2:0`) @1024.
 *   - NO ad-hoc padding / truncation / projection, and NO second vector index.
 *   - If no embedding-capable credential exists, DEGRADE to lexical /
 *     merchantKey memory (the exact-string path already in pipeline.ts). The
 *     correction never blocks; we simply skip the embedding write.
 *
 * Secrets are never returned or thrown — only the vector or a redacted reason.
 */

import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createOpenAI } from "@ai-sdk/openai";
import { embed } from "ai";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";
import { credentialIsComplete, decryptCredentialRow, resolveCredentialFromEnv } from "./aiProvider";
import type { ResolvedCredential } from "./aiProvider";

/**
 * The single pinned embedding dimensionality. MUST equal the vector index
 * `dimensions` on schema.ts `aiMemoryEmbeddings.by_embedding` (1024). Changing
 * this is a one-way door — every stored vector would have to be recomputed.
 */
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * The pinned model id per embedding provider. We only ever use ONE of these per
 * deployment (whichever has a usable credential), and we record the chosen id on
 * every row so the index can never silently mix models.
 */
const EMBEDDING_MODELS = {
  openai: "text-embedding-3-small",
  bedrock: "amazon.titan-embed-text-v2:0",
} as const;

type EmbeddingProviderId = keyof typeof EMBEDDING_MODELS;

// Embedding-provider preference order. OpenAI first (cheap, exact-1024 via the
// Matryoshka `dimensions` param), Bedrock Titan v2 as the AWS-native fallback.
const EMBEDDING_PROVIDER_ORDER: EmbeddingProviderId[] = ["openai", "bedrock"];

export type ResolvedEmbeddingModel = {
  provider: EmbeddingProviderId;
  modelId: string;
  credential: ResolvedCredential;
  source: "credential" | "env";
};

function redactSecrets(message: string, secrets: Array<string | null | undefined>) {
  return secrets.reduce<string>((current, value) => {
    return value && value.length >= 4 ? current.split(value).join("[redacted]") : current;
  }, message);
}

/**
 * Resolve the pinned embedding model for a workspace, DECOUPLED from the chat
 * provider. Walks the preference order and returns the first provider that has a
 * complete credential (saved unified `credentials` row first, else env). Returns
 * null when nothing embedding-capable is configured — the caller then degrades
 * to lexical memory.
 */
export async function resolveEmbeddingModel(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">,
): Promise<ResolvedEmbeddingModel | null> {
  for (const provider of EMBEDDING_PROVIDER_ORDER) {
    // Prefer a saved unified credential for this provider, else env fallback.
    const row = await ctx.runQuery(internal.credentials.getActiveCredential, {
      workspaceId,
      kind: "ai",
      provider,
    });
    let credential: ResolvedCredential;
    let source: "credential" | "env";
    if (row) {
      credential = await decryptCredentialRow(row);
      source = "credential";
    } else {
      credential = resolveCredentialFromEnv(provider);
      source = "env";
    }
    if (credentialIsComplete(provider, credential)) {
      return { provider, modelId: EMBEDDING_MODELS[provider], credential, source };
    }
  }
  return null;
}

function buildEmbeddingModel(resolved: ResolvedEmbeddingModel) {
  const clean = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  };
  switch (resolved.provider) {
    case "openai":
      return createOpenAI({ apiKey: clean(resolved.credential.apiKey) }).textEmbeddingModel(
        resolved.modelId,
      );
    case "bedrock":
      return createAmazonBedrock({
        region: clean(resolved.credential.region),
        accessKeyId: clean(resolved.credential.accessKeyId),
        secretAccessKey: clean(resolved.credential.secretAccessKey),
        sessionToken: clean(resolved.credential.sessionToken),
        apiKey: clean(resolved.credential.apiKey),
      }).textEmbeddingModel(resolved.modelId);
    default: {
      const exhaustive: never = resolved.provider;
      throw new Error(`Unsupported embedding provider: ${String(exhaustive)}`);
    }
  }
}

/**
 * The `dimensions:1024` provider option, keyed by the chosen provider. Both
 * OpenAI text-embedding-3-* and Bedrock Titan v2 accept a native dimensions
 * parameter, so we never pad/truncate/project.
 */
function embeddingProviderOptions(provider: EmbeddingProviderId): Record<
  string,
  Record<string, number>
> {
  return { [provider]: { dimensions: EMBEDDING_DIMENSIONS } };
}

/**
 * Embed a single text into the pinned 1024-dim vector. Resolves the embedding
 * model for the workspace; returns {ok:false} (never throws) when nothing is
 * configured or the provider call fails so the caller can degrade to lexical
 * memory.
 */
export const embedText = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    text: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; embedding: number[]; embeddingModel: string }
    | { ok: false; reason: string }
  > => {
    const text = args.text.trim();
    if (!text) return { ok: false, reason: "Empty text supplied to the embedder." };

    const resolved = await resolveEmbeddingModel(ctx, args.workspaceId);
    if (!resolved) {
      return {
        ok: false,
        reason: "No embedding-capable credential configured; using lexical merchant memory.",
      };
    }

    const apiKeySecret = resolved.credential.apiKey ?? undefined;
    const awsSecret = resolved.credential.secretAccessKey ?? undefined;
    try {
      const model = buildEmbeddingModel(resolved);
      const result = await embed({
        model,
        value: text,
        maxRetries: 0,
        providerOptions: embeddingProviderOptions(resolved.provider),
      });
      const embedding = result.embedding;
      if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
        return {
          ok: false,
          reason: `Embedding model returned ${Array.isArray(embedding) ? embedding.length : "no"} dims; expected ${EMBEDDING_DIMENSIONS}.`,
        };
      }
      // Tag every row with the pinned model id so the index can never mix models.
      return { ok: true, embedding, embeddingModel: `${resolved.provider}:${resolved.modelId}` };
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Embedding generation failed.";
      return {
        ok: false,
        reason: redactSecrets(raw, [apiKeySecret, awsSecret]).replace(/\s+/g, " ").slice(0, 200),
      };
    }
  },
});

/**
 * Similarity threshold for the embedding recall stage (E2-T5). Conservative on
 * purpose: only a near-identical merchant ("AWS" vs "AMZN WEB SERVICES") clears
 * it. Cosine similarity ranges [-1, 1]; 0.82 is well above the noise floor for
 * 1024-dim sentence embeddings of short merchant strings, so a below-threshold
 * match ABSTAINS to the next stage (plaid_prior / LLM) rather than guessing.
 */
export const EMBEDDING_RECALL_SIMILARITY_THRESHOLD = 0.82;

/**
 * The exact-memory confidence band. An embedding recall is a FUZZIER signal than
 * an exact merchantKey hit, so its derived confidence is clamped just below the
 * exact-memory confidence (0.92) — it can short-circuit the LLM but never claims
 * more certainty than a verbatim memory match.
 */
const EXACT_MEMORY_CONFIDENCE = 0.92;
const RECALL_CONFIDENCE_CEILING = 0.9;

export type EmbeddingRecallProposal = {
  categoryAccountId: Id<"ledgerAccounts">;
  confidence: number;
  reasoning: string;
  merchantDisplayName: string;
  occurrenceCount: number;
  similarity: number;
};

/**
 * Embedding / k-NN recall stage (E2-T5). Embeds the incoming merchant text and
 * runs a vector search over this entity's `aiMemoryEmbeddings`. When the top
 * match clears the conservative similarity threshold, returns a category
 * proposal with provenance "Same as your last N {merchant} charges"; otherwise
 * null (abstain to the next stage). Runs in an ACTION because `vectorSearch` is
 * action-only. NEVER throws on a degraded embedder — returns null so the cascade
 * proceeds to plaid_prior / LLM.
 */
export const recallCategoryFromMemory = internalAction({
  args: {
    entityId: v.id("entities"),
    workspaceId: v.id("workspaces"),
    merchant: v.string(),
    rawDescription: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<EmbeddingRecallProposal | null> => {
    const text = args.merchant.trim() || (args.rawDescription ?? "").trim();
    if (!text) return null;

    const embedded = await ctx.runAction(internal.embeddings.embedText, {
      workspaceId: args.workspaceId,
      text,
    });
    if (!embedded.ok) return null; // degraded → fall through to the next stage.

    const matches = await ctx.vectorSearch("aiMemoryEmbeddings", "by_embedding", {
      vector: embedded.embedding,
      filter: (q) => q.eq("entityId", args.entityId),
      limit: 4,
    });
    const top = matches[0];
    if (!top || top._score < EMBEDDING_RECALL_SIMILARITY_THRESHOLD) return null;

    const row = await ctx.runQuery(internal.embeddingsStore.getMemoryEmbeddingRow, {
      embeddingId: top._id,
    });
    if (!row) return null;

    // Confidence derived from similarity AND repetition, clamped below the
    // exact-memory band so recall can short-circuit the LLM but never overclaim.
    const repetitionBoost = Math.min(0.06, Math.max(0, row.occurrenceCount - 1) * 0.02);
    const confidence = Math.min(
      RECALL_CONFIDENCE_CEILING,
      Math.min(EXACT_MEMORY_CONFIDENCE - 0.01, top._score) + repetitionBoost,
    );
    return {
      categoryAccountId: row.categoryAccountId,
      confidence,
      reasoning: `Same as your last ${row.occurrenceCount} ${row.merchantDisplayName} charge${row.occurrenceCount === 1 ? "" : "s"}.`,
      merchantDisplayName: row.merchantDisplayName,
      occurrenceCount: row.occurrenceCount,
      similarity: top._score,
    };
  },
});

/**
 * Compute the embedding for a correction memory and upsert its
 * `aiMemoryEmbeddings` row (E2-T4). Scheduled by pipeline.recordCorrectionMemory
 * after the lexical memory write. On any degrade/failure it is a NO-OP — the
 * correction already succeeded via the lexical merchantKey path.
 */
export const embedCorrectionMemory = internalAction({
  args: {
    correctionMemoryId: v.id("aiCorrectionMemories"),
  },
  handler: async (ctx, args): Promise<{ status: "written" | "skipped"; reason?: string }> => {
    const memory = await ctx.runQuery(internal.embeddingsStore.getCorrectionMemoryForEmbedding, {
      correctionMemoryId: args.correctionMemoryId,
    });
    if (!memory) return { status: "skipped", reason: "Correction memory no longer exists." };

    const result = await ctx.runAction(internal.embeddings.embedText, {
      workspaceId: memory.workspaceId,
      text: memory.sourceText,
    });
    if (!result.ok) {
      // Degrade to lexical/merchantKey memory — never block the correction.
      return { status: "skipped", reason: result.reason };
    }

    await ctx.runMutation(internal.embeddingsStore.upsertMemoryEmbedding, {
      correctionMemoryId: args.correctionMemoryId,
      embedding: result.embedding,
      embeddingModel: result.embeddingModel,
    });
    return { status: "written" };
  },
});
