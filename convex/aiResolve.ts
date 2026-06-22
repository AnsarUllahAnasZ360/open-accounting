/**
 * Provider-agnostic AI model resolution (E3-T2).
 *
 * The single linchpin that turns the Bedrock-only wiring off. Given a workspace
 * and a purpose (chat or categorize), it reads the chosen provider/model from
 * `aiConfigs`, loads the saved unified credential (`kind:"ai"`) and decrypts it
 * server-side, or falls back to the conventional env vars when no row exists.
 *
 * It does NOT touch the network and does NOT build the model — it returns the
 * resolved (provider, modelId, credential, ready) triple. Callers in the three
 * runtimes (categorizer, Ask-AI chat, test-connection) pass the result to
 * `aiProvider.buildModelForProvider`. We keep the per-call factory deliberately
 * (no `createProviderRegistry`) so each request can use a different decrypted key.
 */

import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalAction, internalQuery } from "./_generated/server";
import {
  AI_PROVIDER_IDS,
  isAiProviderId,
  normalizeAiProviderId,
  type AiProviderId,
} from "./aiCatalog";
import {
  credentialIsComplete,
  decryptCredentialRow,
  resolveCredentialFromEnv,
  resolveModelId,
  type ResolvedCredential,
} from "./aiProvider";

export type AiPurpose = "chat" | "categorize";

export type ResolvedActiveAiModel = {
  provider: AiProviderId;
  modelId: string;
  credential: ResolvedCredential;
  /** True when the resolved credential has enough material to actually run. */
  ready: boolean;
  /** Where the credential came from, for diagnostics (never includes secrets). */
  source: "credential" | "env";
};

/**
 * The default provider when nothing is configured: env's AI_PROVIDER if valid,
 * else the first catalog provider that has a usable env credential, else bedrock.
 */
function hasAnyEnvSignal(credential: ResolvedCredential): boolean {
  // True only when the ENV supplied at least one field. This prevents a provider
  // with a hardcoded default base URL (e.g. Ollama at localhost) from being
  // auto-selected when nothing is actually configured.
  return Boolean(
    credential.apiKey ||
      credential.accessKeyId ||
      credential.secretAccessKey ||
      credential.sessionToken ||
      credential.baseUrl ||
      credential.region,
  );
}

function envDefaultProvider(): AiProviderId {
  const fromEnv = normalizeAiProviderId(process.env.AI_PROVIDER);
  if (fromEnv) return fromEnv;
  for (const id of AI_PROVIDER_IDS) {
    const credential = resolveCredentialFromEnv(id);
    if (hasAnyEnvSignal(credential) && credentialIsComplete(id, credential)) return id;
  }
  return "bedrock";
}

/**
 * Resolve the active provider + model + decrypted credential for a workspace.
 * Pure of network calls; only reads the DB (via an internal query) and env.
 */
export async function resolveActiveAiModel(
  ctx: ActionCtx,
  args: { workspaceId: Id<"workspaces">; purpose: AiPurpose },
): Promise<ResolvedActiveAiModel> {
  const config = await ctx.runQuery(internal.aiResolve.getWorkspaceAiConfig, {
    workspaceId: args.workspaceId,
  });

  const configuredProvider =
    config?.provider && isAiProviderId(config.provider)
      ? (config.provider as AiProviderId)
      : null;

  // Determine the provider: explicit config first, else the first saved AI
  // credential's provider, else the env default.
  let provider: AiProviderId | null = configuredProvider;
  if (!provider) {
    const anyCredential = await ctx.runQuery(internal.credentials.getActiveCredential, {
      workspaceId: args.workspaceId,
      kind: "ai",
    });
    if (anyCredential?.provider && isAiProviderId(anyCredential.provider)) {
      provider = anyCredential.provider as AiProviderId;
    }
  }
  if (!provider) provider = envDefaultProvider();

  const configuredModel =
    args.purpose === "chat" ? config?.chatModel ?? null : config?.categorizeModel ?? null;
  const modelId = resolveModelId(provider, configuredModel);

  // Load the saved credential for the chosen provider, decrypt it, else env.
  const row = await ctx.runQuery(internal.credentials.getActiveCredential, {
    workspaceId: args.workspaceId,
    kind: "ai",
    provider,
  });

  let credential: ResolvedCredential;
  let source: "credential" | "env";
  if (row) {
    credential = await decryptCredentialRow(row);
    source = "credential";
    // If a stored model override exists and the config didn't supply one, prefer it.
    if (!configuredModel && row.model) {
      return {
        provider,
        modelId: resolveModelId(provider, row.model),
        credential,
        ready: credentialIsComplete(provider, credential),
        source,
      };
    }
  } else {
    credential = resolveCredentialFromEnv(provider);
    source = "env";
  }

  return {
    provider,
    modelId,
    credential,
    ready: credentialIsComplete(provider, credential),
    source,
  };
}

/**
 * Internal action that resolves the active AI model and returns a REDACTED
 * summary (provider, modelId, ready, source, hasApiKey/hasAwsKeys booleans) —
 * never any secret. Used for diagnostics/connection-health and as a stable
 * test seam for the resolver.
 */
export const resolveActiveAiModelSummary = internalAction({
  args: { workspaceId: v.id("workspaces"), purpose: v.union(v.literal("chat"), v.literal("categorize")) },
  handler: async (ctx, args) => {
    const resolved = await resolveActiveAiModel(ctx, args);
    return {
      provider: resolved.provider,
      modelId: resolved.modelId,
      ready: resolved.ready,
      source: resolved.source,
      hasApiKey: Boolean(resolved.credential.apiKey),
      hasAwsKeys: Boolean(resolved.credential.accessKeyId && resolved.credential.secretAccessKey),
    };
  },
});

// Internal query so the resolver above can read aiConfigs without exposing it.
export const getWorkspaceAiConfig = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("aiConfigs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
  },
});
