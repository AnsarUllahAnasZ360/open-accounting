"use node";

import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { generateText } from "ai";
import { v } from "convex/values";

import { api } from "./_generated/api";
import { action } from "./_generated/server";

type ProviderStatus = {
  mode: "active" | "degraded";
  activeProvider: "bedrock" | null;
  model: string | null;
  region: string | null;
  degradedReason: string | null;
};

const CONNECTION_PROMPT = "Reply exactly: OpenBooks AI SDK connection OK";

function envValue(name: string) {
  return process.env[name]?.trim() || null;
}

function redactEnvValues(message: string) {
  const secretNames = [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_BEARER_TOKEN_BEDROCK",
  ];
  return secretNames.reduce((current, name) => {
    const value = envValue(name);
    return value && value.length >= 4 ? current.split(value).join("[redacted]") : current;
  }, message);
}

function errorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : "AI SDK Bedrock connection failed.";
  return redactEnvValues(raw).replace(/\s+/g, " ").slice(0, 300);
}

export const testProviderConnection = action({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const status: ProviderStatus = await ctx.runQuery(api.ai.providerStatus, args);

    if (status.mode === "degraded") {
      return {
        ok: false,
        mode: status.mode,
        provider: status.activeProvider,
        runtime: "degraded" as const,
        message: status.degradedReason ?? "AI provider is not configured.",
      };
    }

    if (!status.model || !status.region) {
      return {
        ok: false,
        mode: "degraded" as const,
        provider: status.activeProvider,
        runtime: "ai_sdk" as const,
        message: "Bedrock provider is active but model or region is missing.",
      };
    }

    try {
      const bedrock = createAmazonBedrock({
        region: status.region,
        accessKeyId: envValue("AWS_ACCESS_KEY_ID") ?? undefined,
        secretAccessKey: envValue("AWS_SECRET_ACCESS_KEY") ?? undefined,
        sessionToken: envValue("AWS_SESSION_TOKEN") ?? undefined,
        apiKey: envValue("AWS_BEARER_TOKEN_BEDROCK") ?? undefined,
      });
      const startedAt = Date.now();
      const result = await generateText({
        model: bedrock(status.model),
        prompt: CONNECTION_PROMPT,
        maxOutputTokens: 16,
        temperature: 0,
        maxRetries: 0,
        timeout: 15_000,
      });

      return {
        ok: true,
        mode: status.mode,
        provider: status.activeProvider,
        runtime: "ai_sdk" as const,
        model: status.model,
        finishReason: result.finishReason,
        latencyMs: Date.now() - startedAt,
        message: `AI SDK Bedrock connection succeeded for ${status.model} in ${status.region}.`,
      };
    } catch (error) {
      return {
        ok: false,
        mode: status.mode,
        provider: status.activeProvider,
        runtime: "ai_sdk" as const,
        model: status.model,
        message: `AI SDK Bedrock connection failed: ${errorMessage(error)}`,
      };
    }
  },
});
