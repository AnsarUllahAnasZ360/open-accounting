/**
 * Unified AI model factory.
 *
 * One place that turns a (provider, model, credential) triple into a live AI
 * SDK language model. Every provider in the catalog routes through one of five
 * AI SDK packages. This replaces the three scattered Bedrock-only paths
 * (agent.ts, aiSdkRuntime.ts, bedrockCategorizer.ts) — they are rewired to this
 * factory in a later epic.
 *
 * `buildModelForProvider` is pure and side-effect-free: it constructs the model
 * object but never touches the network (the provider SDKs only call out when a
 * generation actually runs), so it is safe to unit test for every provider.
 */

import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGateway } from "@ai-sdk/gateway";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import type { Doc } from "./_generated/dataModel";
import { getProviderEntry, type AiProviderId } from "./aiCatalog";
import { decryptSecret } from "./secretBox";

/**
 * Plaintext AI credential payload, as stored (encrypted) inside a unified
 * `credentials` row's `encryptedPayload` blob for `kind:"ai"`. Only the secret
 * material is encrypted; `baseUrl`/`region` are also kept (in plaintext columns)
 * for display, but the canonical copy lives in the blob.
 */
export type AiCredentialPayload = {
  apiKey?: string | null;
  accessKeyId?: string | null;
  secretAccessKey?: string | null;
  sessionToken?: string | null;
  baseUrl?: string | null;
  region?: string | null;
};

/** Plaintext credential material, after decryption / env resolution. */
export type ResolvedCredential = {
  apiKey?: string | null;
  accessKeyId?: string | null;
  secretAccessKey?: string | null;
  sessionToken?: string | null;
  baseUrl?: string | null;
  region?: string | null;
};

const clean = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Construct an AI SDK language model for the given provider + model + credential.
 * Pure: does not read the database, env, or network.
 */
export function buildModelForProvider(input: {
  providerId: AiProviderId;
  modelId: string;
  credential: ResolvedCredential;
}) {
  const { providerId, modelId, credential } = input;
  const entry = getProviderEntry(providerId);
  const apiKey = clean(credential.apiKey);
  const baseURL = clean(credential.baseUrl) ?? entry.defaultBaseUrl;

  switch (entry.runtime) {
    case "openai":
      return createOpenAI({ apiKey, baseURL })(modelId);
    case "anthropic":
      return createAnthropic({ apiKey, baseURL })(modelId);
    case "gateway":
      return createGateway({ apiKey })(modelId);
    case "bedrock":
      return createAmazonBedrock({
        region: clean(credential.region),
        accessKeyId: clean(credential.accessKeyId),
        secretAccessKey: clean(credential.secretAccessKey),
        sessionToken: clean(credential.sessionToken),
        apiKey,
      })(modelId);
    case "openai_compatible": {
      if (!baseURL) {
        throw new Error(`${entry.label} requires a base URL before it can be used.`);
      }
      return createOpenAICompatible({ name: providerId, apiKey, baseURL })(modelId);
    }
    default: {
      const exhaustive: never = entry.runtime;
      throw new Error(`Unsupported provider runtime: ${String(exhaustive)}`);
    }
  }
}

/**
 * Decrypt a unified `credentials` row (`kind:"ai"`) into usable plaintext
 * material. The whole secret payload is stored as one encrypted JSON blob in
 * `encryptedPayload`; the row's plaintext `baseUrl`/`region`/`model` columns are
 * mirrors for display and act as a fallback if the blob omits them.
 */
export async function decryptCredentialRow(row: Doc<"credentials">): Promise<ResolvedCredential> {
  const subject = "AI provider credentials";
  let payload: AiCredentialPayload = {};
  if (row.encryptedPayload) {
    const json = await decryptSecret(row.encryptedPayload, subject);
    payload = JSON.parse(json) as AiCredentialPayload;
  }
  return {
    apiKey: payload.apiKey ?? null,
    accessKeyId: payload.accessKeyId ?? null,
    secretAccessKey: payload.secretAccessKey ?? null,
    sessionToken: payload.sessionToken ?? null,
    baseUrl: payload.baseUrl ?? row.baseUrl ?? null,
    region: payload.region ?? row.region ?? null,
  };
}

/**
 * Fall back to environment variables when no per-workspace credential is saved.
 * Keeps existing Bedrock-env deployments and headless/CI runs working without
 * the database. Each provider reads its conventional env var name.
 */
export function resolveCredentialFromEnv(providerId: AiProviderId): ResolvedCredential {
  const env = (name: string) => process.env[name]?.trim() || null;
  switch (providerId) {
    case "bedrock":
      return {
        accessKeyId: env("AWS_ACCESS_KEY_ID"),
        secretAccessKey: env("AWS_SECRET_ACCESS_KEY"),
        sessionToken: env("AWS_SESSION_TOKEN"),
        apiKey: env("AWS_BEARER_TOKEN_BEDROCK"),
        region: env("AWS_REGION") ?? env("AI_REGION"),
      };
    case "gateway":
      return { apiKey: env("AI_GATEWAY_API_KEY") };
    case "openai":
      return { apiKey: env("OPENAI_API_KEY"), baseUrl: env("OPENAI_BASE_URL") };
    case "anthropic":
      return { apiKey: env("ANTHROPIC_API_KEY") };
    case "google":
      return { apiKey: env("GOOGLE_GENERATIVE_AI_API_KEY") };
    case "azure":
      return { apiKey: env("AZURE_API_KEY"), baseUrl: env("AZURE_BASE_URL") };
    case "groq":
      return { apiKey: env("GROQ_API_KEY") };
    case "deepseek":
      return { apiKey: env("DEEPSEEK_API_KEY") };
    case "mistral":
      return { apiKey: env("MISTRAL_API_KEY") };
    case "moonshot":
      return { apiKey: env("MOONSHOT_API_KEY") };
    case "xai":
      return { apiKey: env("XAI_API_KEY") };
    case "fireworks":
      return { apiKey: env("FIREWORKS_API_KEY") };
    case "ollama":
      return { baseUrl: env("OLLAMA_BASE_URL") };
    case "openai_compatible":
      return { apiKey: env("AI_API_KEY"), baseUrl: env("AI_BASE_URL") };
    default: {
      const exhaustive: never = providerId;
      return { apiKey: env(String(exhaustive)) };
    }
  }
}

/** Whether a credential has enough material for this provider to run. */
export function credentialIsComplete(providerId: AiProviderId, credential: ResolvedCredential): boolean {
  const entry = getProviderEntry(providerId);
  const hasBase = Boolean(clean(credential.baseUrl) ?? entry.defaultBaseUrl);
  if (entry.credentialKind === "awsKeys") {
    const hasKeys = Boolean(clean(credential.accessKeyId) && clean(credential.secretAccessKey));
    const hasBearer = Boolean(clean(credential.apiKey));
    return (hasKeys || hasBearer) && Boolean(clean(credential.region));
  }
  if (entry.credentialKind === "none") {
    return hasBase;
  }
  const hasKey = Boolean(clean(credential.apiKey));
  return entry.requiresBaseUrl ? hasKey && hasBase : hasKey;
}

/** The model id to use: the owner's saved override, else the curated default. */
export function resolveModelId(providerId: AiProviderId, configuredModel?: string | null): string {
  return clean(configuredModel) ?? getProviderEntry(providerId).defaultModel;
}
