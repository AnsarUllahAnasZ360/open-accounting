"use node";

/**
 * Provider-agnostic categorization generation runtime (E3-T3).
 *
 * The categorizer (bedrockCategorizer.ts) runs in the default Convex runtime and
 * keeps its existing AWS Bedrock invoke path for `provider === "bedrock"`. For
 * every OTHER catalog provider it delegates here: this `"use node"` action
 * resolves the workspace's active provider + decrypted credential and runs the
 * same minimal categorization prompt through the unified AI SDK factory,
 * returning the raw model text. The categorizer then parses that text with the
 * exact same `normalizeBedrockCategorizationProposal` contract — so the
 * structured-output shape the pipeline consumes is unchanged.
 *
 * Secrets are never returned or thrown: only model text or a redacted reason.
 */

import { generateText } from "ai";
import { v } from "convex/values";

import { internalAction } from "./_generated/server";
import { getProviderEntry } from "./aiCatalog";
import { buildModelForProvider } from "./aiProvider";
import { resolveActiveAiModel } from "./aiResolve";

function redactSecrets(message: string, secrets: Array<string | null | undefined>) {
  return secrets.reduce<string>((current, value) => {
    return value && value.length >= 4 ? current.split(value).join("[redacted]") : current;
  }, message);
}

/**
 * Cheap readiness check (no network). Resolves the active provider + decrypted
 * credential and reports whether a model could run, without making a call.
 * Used by the categorizer to decide bedrock-invoke vs AI-SDK vs route-to-Inbox.
 */
export const resolveCategorizeReadiness = internalAction({
  args: { workspaceId: v.id("workspaces") },
  handler: async (
    ctx,
    args,
  ): Promise<{ ready: boolean; provider: string; model: string | null; reason: string | null }> => {
    const resolved = await resolveActiveAiModel(ctx, {
      workspaceId: args.workspaceId,
      purpose: "categorize",
    });
    return {
      ready: resolved.ready,
      provider: resolved.provider,
      model: resolved.ready ? resolved.modelId : null,
      reason: resolved.ready
        ? null
        : `${getProviderEntry(resolved.provider).label} is not configured; routed through deterministic stages.`,
    };
  },
});

export const generateCategorizationText = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    prompt: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; text: string; provider: string; model: string }
    | { ok: false; reason: string; provider: string | null; model: string | null }
  > => {
    const resolved = await resolveActiveAiModel(ctx, {
      workspaceId: args.workspaceId,
      purpose: "categorize",
    });
    if (!resolved.ready) {
      return {
        ok: false,
        reason: `${getProviderEntry(resolved.provider).label} is not configured; routed through deterministic stages.`,
        provider: resolved.provider,
        model: null,
      };
    }
    const apiKeySecret = resolved.credential.apiKey ?? undefined;
    const awsSecret = resolved.credential.secretAccessKey ?? undefined;
    try {
      const model = buildModelForProvider({
        providerId: resolved.provider,
        modelId: resolved.modelId,
        credential: resolved.credential,
      });
      const result = await generateText({
        model,
        prompt: args.prompt,
        maxOutputTokens: 500,
        temperature: 0,
        maxRetries: 0,
      });
      return { ok: true, text: result.text, provider: resolved.provider, model: resolved.modelId };
    } catch (error) {
      const raw = error instanceof Error ? error.message : "AI categorization failed.";
      return {
        ok: false,
        reason: redactSecrets(raw, [apiKeySecret, awsSecret]).replace(/\s+/g, " ").slice(0, 200),
        provider: resolved.provider,
        model: resolved.modelId,
      };
    }
  },
});
