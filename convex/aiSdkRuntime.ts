"use node";

import { generateText } from "ai";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { getProviderEntry } from "./aiCatalog";
import { buildModelForProvider } from "./aiProvider";
import { resolveActiveAiModel } from "./aiResolve";
import { safeErrorMessage } from "./secretRedaction";

const CONNECTION_PROMPT = "Reply exactly: OpenBooks AI SDK connection OK";

/**
 * Redact any secret-shaped value from an error message: every env secret AND
 * the resolved credential's apiKey/access-key material (E3-T3/T10), so a thrown
 * provider error can never echo a key back to the client. Backed by the shared
 * redaction helper so the same rule holds across every integration runtime.
 */
function errorMessage(error: unknown, extra: Array<string | null | undefined>) {
  return safeErrorMessage(error, extra, "AI SDK connection failed.");
}

/**
 * Provider-agnostic test-connection probe (E3-T3). Resolves the workspace's
 * active provider + model + decrypted credential (BYO or env), builds the model
 * through the unified factory, and runs one minimal generation. No path is
 * hardwired to AWS Bedrock anymore. Secrets are never echoed in any message.
 */
export const testProviderConnection = action({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    // Re-check workspace authorization on the server (E14-T5): this action takes
    // a client-supplied workspaceId and resolves + exercises THAT workspace's
    // saved AI credential, so a caller who is not an active member of the
    // workspace must be rejected before any credential read or provider call.
    // (The shared `resolveActiveAiModel` resolver is intentionally unguarded so
    // the internal categorize/CFO/chat runtimes can use it without a user
    // identity; the membership guard belongs on every client-facing entrypoint.)
    await ctx.runQuery(internal.aiThreads.assertWorkspaceMember, {
      workspaceId: args.workspaceId,
    });
    const resolved = await resolveActiveAiModel(ctx, {
      workspaceId: args.workspaceId,
      purpose: "chat",
    });
    const entry = getProviderEntry(resolved.provider);
    const apiKeySecret = resolved.credential.apiKey ?? undefined;
    const awsSecret = resolved.credential.secretAccessKey ?? undefined;

    if (!resolved.ready) {
      // No usable credential resolved. `provider` is null because the resolved
      // id is only a fallback default, not an actually-configured provider.
      return {
        ok: false,
        mode: "degraded" as const,
        provider: null,
        runtime: "degraded" as const,
        message: `${entry.label} is not configured. Add a key (or the provider's env vars) before testing.`,
      };
    }

    try {
      const model = buildModelForProvider({
        providerId: resolved.provider,
        modelId: resolved.modelId,
        credential: resolved.credential,
      });
      const startedAt = Date.now();
      const result = await generateText({
        model,
        prompt: CONNECTION_PROMPT,
        maxOutputTokens: 16,
        temperature: 0,
        maxRetries: 0,
      });

      return {
        ok: true,
        mode: "active" as const,
        provider: resolved.provider,
        runtime: "ai_sdk" as const,
        model: resolved.modelId,
        finishReason: result.finishReason,
        latencyMs: Date.now() - startedAt,
        message: `${entry.label} connection succeeded for ${resolved.modelId}.`,
      };
    } catch (error) {
      return {
        ok: false,
        mode: "degraded" as const,
        provider: resolved.provider,
        runtime: "ai_sdk" as const,
        model: resolved.modelId,
        message: `${entry.label} connection failed: ${errorMessage(error, [apiKeySecret, awsSecret])}`,
      };
    }
  },
});
