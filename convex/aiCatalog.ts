/**
 * Bring-your-own-key AI provider catalog.
 *
 * One opinionated, curated list that drives BOTH the settings UI (which
 * providers/models to show, which credential fields to ask for, where to get a
 * key) and the model factory in aiProvider.ts (how to construct the model).
 *
 * Design: only five AI SDK packages are needed to reach every provider —
 *   - native:  @ai-sdk/openai, @ai-sdk/anthropic, @ai-sdk/amazon-bedrock
 *   - gateway: @ai-sdk/gateway        (one key → every model)
 *   - compat:  @ai-sdk/openai-compatible (baseURL-driven: Groq, DeepSeek,
 *              Mistral, Moonshot, xAI, Fireworks, Google, Azure, Ollama, custom)
 *
 * Model IDs below are the current curated defaults (snapshot 2026-06-14). They
 * are NOT load-bearing: every provider exposes a free-text "custom model ID"
 * field in the UI, and the settings layer can refresh these from the provider's
 * own /models endpoint. Treat the lists as sensible starting points, not a
 * closed set.
 */

import { query } from "./_generated/server";

export const AI_PROVIDER_IDS = [
  "gateway",
  "openai",
  "anthropic",
  "google",
  "bedrock",
  "azure",
  "groq",
  "deepseek",
  "mistral",
  "moonshot",
  "xai",
  "fireworks",
  "ollama",
  "openai_compatible",
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/** Which AI SDK factory builds this provider's model (see aiProvider.ts). */
export type ProviderRuntime =
  | "openai"
  | "anthropic"
  | "bedrock"
  | "gateway"
  | "openai_compatible";

/** What secret material the provider needs (drives the settings form). */
export type CredentialKind = "apiKey" | "awsKeys" | "none";

export type CatalogModel = { id: string; label: string };

export type ProviderEntry = {
  id: AiProviderId;
  label: string;
  runtime: ProviderRuntime;
  credentialKind: CredentialKind;
  /** Optional pre-filled base URL for openai-compatible providers. */
  defaultBaseUrl?: string;
  /** True when the user MUST supply a base URL (no sensible default). */
  requiresBaseUrl: boolean;
  /** Whether tool-calling (required by Ask AI chat) is reliable here. */
  supportsTools: boolean;
  /** Where the owner generates a key. Shown as a help link in settings. */
  keysUrl: string;
  models: CatalogModel[];
  defaultModel: string;
};

const m = (id: string, label?: string): CatalogModel => ({ id, label: label ?? id });

export const AI_PROVIDER_CATALOG: Record<AiProviderId, ProviderEntry> = {
  gateway: {
    id: "gateway",
    label: "Vercel AI Gateway",
    runtime: "gateway",
    credentialKind: "apiKey",
    requiresBaseUrl: false,
    supportsTools: true,
    keysUrl: "https://vercel.com/docs/ai-gateway",
    models: [
      m("anthropic/claude-sonnet-4.6", "Claude Sonnet 4.6"),
      m("openai/gpt-5", "GPT-5"),
      m("google/gemini-3-pro-preview", "Gemini 3 Pro"),
      m("anthropic/claude-opus-4.8", "Claude Opus 4.8"),
    ],
    defaultModel: "anthropic/claude-sonnet-4.6",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    runtime: "openai",
    credentialKind: "apiKey",
    requiresBaseUrl: false,
    supportsTools: true,
    keysUrl: "https://platform.openai.com/api-keys",
    models: [m("gpt-5", "GPT-5"), m("gpt-5-mini", "GPT-5 mini"), m("gpt-4.1", "GPT-4.1")],
    defaultModel: "gpt-5",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    runtime: "anthropic",
    credentialKind: "apiKey",
    requiresBaseUrl: false,
    supportsTools: true,
    keysUrl: "https://console.anthropic.com/settings/keys",
    models: [
      m("claude-sonnet-4-6", "Claude Sonnet 4.6"),
      m("claude-opus-4-8", "Claude Opus 4.8"),
      m("claude-haiku-4-5", "Claude Haiku 4.5"),
    ],
    defaultModel: "claude-sonnet-4-6",
  },
  google: {
    id: "google",
    label: "Google AI Studio",
    runtime: "openai_compatible",
    credentialKind: "apiKey",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    requiresBaseUrl: false,
    supportsTools: true,
    keysUrl: "https://aistudio.google.com/apikey",
    models: [
      m("gemini-2.5-flash", "Gemini 2.5 Flash"),
      m("gemini-2.5-pro", "Gemini 2.5 Pro"),
      m("gemini-3-pro-preview", "Gemini 3 Pro"),
    ],
    defaultModel: "gemini-2.5-flash",
  },
  bedrock: {
    id: "bedrock",
    label: "Amazon Bedrock",
    runtime: "bedrock",
    credentialKind: "awsKeys",
    requiresBaseUrl: false,
    supportsTools: true,
    keysUrl: "https://console.aws.amazon.com/bedrock",
    models: [
      m("us.anthropic.claude-sonnet-4-20250514-v1:0", "Claude Sonnet 4 (Bedrock)"),
      m("us.amazon.nova-pro-v1:0", "Amazon Nova Pro"),
    ],
    defaultModel: "us.anthropic.claude-sonnet-4-20250514-v1:0",
  },
  azure: {
    id: "azure",
    label: "Azure OpenAI",
    runtime: "openai_compatible",
    credentialKind: "apiKey",
    requiresBaseUrl: true,
    supportsTools: true,
    keysUrl: "https://portal.azure.com",
    models: [m("gpt-5", "GPT-5 (deployment)"), m("gpt-4.1", "GPT-4.1 (deployment)")],
    defaultModel: "gpt-5",
  },
  groq: {
    id: "groq",
    label: "Groq",
    runtime: "openai_compatible",
    credentialKind: "apiKey",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    requiresBaseUrl: false,
    supportsTools: true,
    keysUrl: "https://console.groq.com/keys",
    models: [
      m("llama-3.3-70b-versatile", "Llama 3.3 70B"),
      m("moonshotai/kimi-k2-instruct", "Kimi K2 (Groq)"),
      m("openai/gpt-oss-120b", "GPT-OSS 120B"),
    ],
    defaultModel: "llama-3.3-70b-versatile",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    runtime: "openai_compatible",
    credentialKind: "apiKey",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    requiresBaseUrl: false,
    supportsTools: true,
    keysUrl: "https://platform.deepseek.com/api_keys",
    models: [m("deepseek-chat", "DeepSeek V3.2 (chat)"), m("deepseek-reasoner", "DeepSeek R1 (reasoner)")],
    defaultModel: "deepseek-chat",
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    runtime: "openai_compatible",
    credentialKind: "apiKey",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    requiresBaseUrl: false,
    supportsTools: true,
    keysUrl: "https://console.mistral.ai/api-keys",
    models: [m("mistral-large-latest", "Mistral Large"), m("mistral-small-latest", "Mistral Small")],
    defaultModel: "mistral-large-latest",
  },
  moonshot: {
    id: "moonshot",
    label: "Moonshot (Kimi)",
    runtime: "openai_compatible",
    credentialKind: "apiKey",
    defaultBaseUrl: "https://api.moonshot.ai/v1",
    requiresBaseUrl: false,
    supportsTools: true,
    keysUrl: "https://platform.moonshot.ai/console/api-keys",
    models: [m("kimi-k2-0905-preview", "Kimi K2"), m("moonshot-v1-128k", "Moonshot v1 128k")],
    defaultModel: "kimi-k2-0905-preview",
  },
  xai: {
    id: "xai",
    label: "xAI (Grok)",
    runtime: "openai_compatible",
    credentialKind: "apiKey",
    defaultBaseUrl: "https://api.x.ai/v1",
    requiresBaseUrl: false,
    supportsTools: true,
    keysUrl: "https://console.x.ai",
    models: [m("grok-4", "Grok 4"), m("grok-3", "Grok 3"), m("grok-3-mini", "Grok 3 mini")],
    defaultModel: "grok-4",
  },
  fireworks: {
    id: "fireworks",
    label: "Fireworks",
    runtime: "openai_compatible",
    credentialKind: "apiKey",
    defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
    requiresBaseUrl: false,
    supportsTools: true,
    keysUrl: "https://fireworks.ai/account/api-keys",
    models: [
      m("accounts/fireworks/models/llama-v3p3-70b-instruct", "Llama 3.3 70B"),
      m("accounts/fireworks/models/deepseek-v3", "DeepSeek V3"),
    ],
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
  },
  ollama: {
    id: "ollama",
    label: "Ollama (local)",
    runtime: "openai_compatible",
    credentialKind: "none",
    defaultBaseUrl: "http://localhost:11434/v1",
    requiresBaseUrl: false,
    supportsTools: false,
    keysUrl: "https://ollama.com/download",
    models: [m("llama3.1", "Llama 3.1"), m("qwen2.5", "Qwen 2.5"), m("mistral", "Mistral")],
    defaultModel: "llama3.1",
  },
  openai_compatible: {
    id: "openai_compatible",
    label: "OpenAI-compatible (custom)",
    runtime: "openai_compatible",
    credentialKind: "apiKey",
    requiresBaseUrl: true,
    supportsTools: false,
    keysUrl: "",
    models: [],
    defaultModel: "",
  },
};

export function isAiProviderId(value: string | null | undefined): value is AiProviderId {
  return Boolean(value) && (AI_PROVIDER_IDS as readonly string[]).includes(value as string);
}

export function normalizeAiProviderId(value: string | null | undefined): AiProviderId | null {
  const v = value?.trim().toLowerCase();
  return v && isAiProviderId(v) ? (v as AiProviderId) : null;
}

export function getProviderEntry(id: AiProviderId): ProviderEntry {
  return AI_PROVIDER_CATALOG[id];
}

/** The full catalog as an ordered array, for rendering the settings UI. */
export function listProviderCatalog(): ProviderEntry[] {
  return AI_PROVIDER_IDS.map((id) => AI_PROVIDER_CATALOG[id]);
}

/**
 * Public query (E3-T4): the full BYO provider catalog for the settings UI —
 * id, label, credentialKind, keysUrl, models, requiresBaseUrl, defaultBaseUrl,
 * supportsTools, defaultModel. No secrets; pure static catalog data.
 */
export const list = query({
  args: {},
  handler: async () =>
    listProviderCatalog().map((entry) => ({
      id: entry.id,
      label: entry.label,
      credentialKind: entry.credentialKind,
      keysUrl: entry.keysUrl,
      requiresBaseUrl: entry.requiresBaseUrl,
      defaultBaseUrl: entry.defaultBaseUrl ?? null,
      supportsTools: entry.supportsTools,
      defaultModel: entry.defaultModel,
      models: entry.models,
    })),
});
