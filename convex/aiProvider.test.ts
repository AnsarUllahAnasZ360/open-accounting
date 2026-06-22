/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

import {
  AI_PROVIDER_CATALOG,
  AI_PROVIDER_IDS,
  getProviderEntry,
  type AiProviderId,
} from "./aiCatalog";
import {
  buildModelForProvider,
  credentialIsComplete,
  resolveModelId,
  type ResolvedCredential,
} from "./aiProvider";

function fakeCredential(providerId: AiProviderId): ResolvedCredential {
  const entry = getProviderEntry(providerId);
  if (entry.credentialKind === "awsKeys") {
    return { accessKeyId: "AKIA_FAKE", secretAccessKey: "fake-secret", region: "us-east-1" };
  }
  if (entry.credentialKind === "none") {
    return { baseUrl: entry.defaultBaseUrl ?? "http://localhost:11434/v1" };
  }
  return {
    apiKey: "sk-fake-unit-test-key",
    baseUrl: entry.defaultBaseUrl ?? (entry.requiresBaseUrl ? "https://compat.example.test/v1" : undefined),
  };
}

describe("AI provider catalog + model factory", () => {
  it("catalog covers Bedrock plus at least ten other providers", () => {
    expect(AI_PROVIDER_IDS).toContain("bedrock");
    expect(AI_PROVIDER_IDS.filter((id) => id !== "bedrock").length).toBeGreaterThanOrEqual(10);
  });

  for (const id of AI_PROVIDER_IDS) {
    it(`constructs a model for "${id}" without network access`, () => {
      const entry = getProviderEntry(id);
      const modelId = entry.defaultModel || "unit-test-model";
      const model = buildModelForProvider({
        providerId: id,
        modelId,
        credential: fakeCredential(id),
      });
      expect(model).toBeTruthy();
      expect(typeof model).toBe("object");
    });
  }

  it("each curated provider's default model is in its own model list", () => {
    for (const id of AI_PROVIDER_IDS) {
      const entry = AI_PROVIDER_CATALOG[id];
      if (entry.models.length === 0) continue;
      expect(entry.models.some((model) => model.id === entry.defaultModel)).toBe(true);
    }
  });

  it("openai-compatible providers without a base URL fail loudly", () => {
    expect(() =>
      buildModelForProvider({
        providerId: "openai_compatible",
        modelId: "whatever",
        credential: { apiKey: "sk-test" },
      }),
    ).toThrow(/base url/i);
  });

  it("credentialIsComplete enforces each provider's required fields", () => {
    expect(credentialIsComplete("openai", { apiKey: "sk-test" })).toBe(true);
    expect(credentialIsComplete("openai", {})).toBe(false);
    expect(credentialIsComplete("bedrock", { accessKeyId: "a", secretAccessKey: "b", region: "us-east-1" })).toBe(true);
    expect(credentialIsComplete("bedrock", { accessKeyId: "a", secretAccessKey: "b" })).toBe(false);
    expect(credentialIsComplete("ollama", {})).toBe(true); // has a default base URL
    expect(credentialIsComplete("openai_compatible", { apiKey: "sk-test" })).toBe(false); // needs base URL
    expect(credentialIsComplete("openai_compatible", { apiKey: "sk-test", baseUrl: "https://x/v1" })).toBe(true);
  });

  it("resolveModelId prefers the saved override, else the curated default", () => {
    expect(resolveModelId("openai", "gpt-5-mini")).toBe("gpt-5-mini");
    expect(resolveModelId("openai", null)).toBe(getProviderEntry("openai").defaultModel);
    expect(resolveModelId("anthropic", "  ")).toBe(getProviderEntry("anthropic").defaultModel);
  });
});
