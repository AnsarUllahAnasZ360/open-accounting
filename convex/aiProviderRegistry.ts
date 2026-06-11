export const AI_PROVIDER_IDS = ["bedrock", "anthropic", "openai", "google", "ollama"] as const;

export type AIProviderId = typeof AI_PROVIDER_IDS[number];
export type AIProviderMode = "active" | "degraded";
export type AIProviderCapability = "chat" | "structured_output" | "tool_calling" | "embeddings";

type ProviderRuntime = "direct" | "gateway" | "community";

type AIProviderDefinition = {
  id: AIProviderId;
  label: string;
  runtime: ProviderRuntime;
  v1Enabled: boolean;
  capabilities: AIProviderCapability[];
  requiredEnv: string[];
  optionalEnv: string[];
  aiSdk: {
    packageName: string;
    importName: string;
    languageModel: string;
    embeddingModel?: string;
  };
};

export type AIProviderStatusEntry = AIProviderDefinition & {
  configured: boolean;
  active: boolean;
  ready: boolean;
  missingEnv: string[];
  model: string | null;
  embeddingsModel: string | null;
  reason: string | null;
};

export const AI_PROVIDER_REGISTRY: Record<AIProviderId, AIProviderDefinition> = {
  bedrock: {
    id: "bedrock",
    label: "Amazon Bedrock",
    runtime: "direct",
    v1Enabled: true,
    capabilities: ["chat", "structured_output", "tool_calling", "embeddings"],
    requiredEnv: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "AI_MODEL"],
    optionalEnv: ["AI_EMBEDDINGS_MODEL"],
    aiSdk: {
      packageName: "@ai-sdk/amazon-bedrock",
      importName: "bedrock",
      languageModel: "bedrock(AI_MODEL)",
      embeddingModel: "bedrock.embedding(AI_EMBEDDINGS_MODEL)",
    },
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    runtime: "gateway",
    v1Enabled: false,
    capabilities: ["chat", "structured_output", "tool_calling"],
    requiredEnv: ["ANTHROPIC_API_KEY"],
    optionalEnv: ["AI_MODEL"],
    aiSdk: {
      packageName: "@ai-sdk/anthropic",
      importName: "anthropic",
      languageModel: "anthropic(model)",
    },
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    runtime: "gateway",
    v1Enabled: false,
    capabilities: ["chat", "structured_output", "tool_calling", "embeddings"],
    requiredEnv: ["OPENAI_API_KEY"],
    optionalEnv: ["AI_MODEL", "AI_EMBEDDINGS_MODEL"],
    aiSdk: {
      packageName: "@ai-sdk/openai",
      importName: "openai",
      languageModel: "openai(model)",
      embeddingModel: "openai.embedding(AI_EMBEDDINGS_MODEL)",
    },
  },
  google: {
    id: "google",
    label: "Google Generative AI",
    runtime: "gateway",
    v1Enabled: false,
    capabilities: ["chat", "structured_output", "tool_calling", "embeddings"],
    requiredEnv: ["GOOGLE_GENERATIVE_AI_API_KEY"],
    optionalEnv: ["AI_MODEL", "AI_EMBEDDINGS_MODEL"],
    aiSdk: {
      packageName: "@ai-sdk/google",
      importName: "google",
      languageModel: "google(model)",
      embeddingModel: "google.embedding(AI_EMBEDDINGS_MODEL)",
    },
  },
  ollama: {
    id: "ollama",
    label: "Ollama",
    runtime: "community",
    v1Enabled: false,
    capabilities: ["chat", "structured_output", "tool_calling"],
    requiredEnv: ["OLLAMA_BASE_URL", "AI_MODEL"],
    optionalEnv: [],
    aiSdk: {
      packageName: "ollama-ai-provider-v2",
      importName: "ollama",
      languageModel: "ollama(model)",
    },
  },
};

function present(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

export function normalizeAIProviderId(value: string | undefined | null): AIProviderId | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  return (AI_PROVIDER_IDS as readonly string[]).includes(normalized) ? normalized as AIProviderId : null;
}

function envValue(name: string) {
  return process.env[name]?.trim() || null;
}

function modelForProvider(provider: AIProviderId) {
  if (provider === "bedrock") {
    return envValue("AI_MODEL");
  }
  const model = envValue("AI_MODEL");
  if (model) return model;
  if (provider === "anthropic") return "anthropic/claude-sonnet-4.5";
  if (provider === "openai") return "openai/gpt-5";
  if (provider === "google") return "google/gemini-2.5-flash";
  return "llama3.1";
}

export function resolveAIProviderRegistry() {
  const rawProvider = process.env.AI_PROVIDER?.trim().toLowerCase() ?? "";
  const configuredProvider = normalizeAIProviderId(rawProvider) ?? "bedrock";
  const invalidProvider = rawProvider && !normalizeAIProviderId(rawProvider) ? rawProvider : null;
  const providers = AI_PROVIDER_IDS.map((id): AIProviderStatusEntry => {
    const definition = AI_PROVIDER_REGISTRY[id];
    const missingEnv = definition.requiredEnv.filter((name) => !present(process.env[name]));
    const configured = configuredProvider === id;
    const ready = configured && missingEnv.length === 0;
    const active = ready && id === "bedrock" && definition.v1Enabled;
    const model = configured ? modelForProvider(id) : null;
    const embeddingsModel =
      configured && definition.capabilities.includes("embeddings") ? envValue("AI_EMBEDDINGS_MODEL") : null;
    const reason =
      invalidProvider && configured
        ? `AI_PROVIDER=${invalidProvider} is not in the OpenBooks provider registry.`
        : configured && !definition.v1Enabled
          ? `${definition.label} is registered for AI SDK compatibility, but OpenBooks v1 only enables Bedrock.`
          : configured && missingEnv.length > 0
            ? `Missing required env: ${missingEnv.join(", ")}.`
            : null;
    return {
      ...definition,
      configured,
      active,
      ready,
      missingEnv,
      model,
      embeddingsModel,
      reason,
    };
  });
  const activeEntry = providers.find((provider) => provider.active) ?? null;
  const configuredEntry = providers.find((provider) => provider.configured) ?? providers[0];
  const mode: AIProviderMode = activeEntry ? "active" : "degraded";
  return {
    mode,
    configuredProvider,
    activeProvider: activeEntry?.id ?? null,
    model: activeEntry?.model ?? null,
    embeddingsModel: activeEntry?.embeddingsModel ?? null,
    region: activeEntry?.id === "bedrock" ? envValue("AWS_REGION") : null,
    degradedReason:
      mode === "degraded"
        ? configuredEntry.reason ?? "Bedrock env is absent or incomplete; OpenBooks will use rules, memory, Plaid priors, and Inbox review."
        : null,
    providers,
  };
}
