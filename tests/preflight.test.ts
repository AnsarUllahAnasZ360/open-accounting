import { describe, expect, it } from "vitest";

// E13-T4: preflight is a plain Node .mjs script; we import its exported pure
// classifiers to prove the provider-aware split and the live-connector policy
// (live keys PASS, absent keys SKIP, no sandbox/test-only ban) without touching
// the network.
import {
  classifyPlaidEnv,
  classifyStripeKey,
  coreRequiredEnv,
  encryptionEnvNames,
  envRequirements,
  normalizeProvider,
  providerCatalog,
  providerRequiredEnv,
} from "../scripts/preflight.mjs";
// aiCatalog.ts is the canonical provider list; the preflight mirror must track it.
import { AI_PROVIDER_IDS } from "../convex/aiCatalog";

describe("preflight provider-conditional required env (E13-T4)", () => {
  it("keeps the provider-agnostic core small and Bedrock-free", () => {
    expect(coreRequiredEnv).toEqual([
      "OWNER_EMAIL",
      "OWNER_PASSWORD",
      "NEXT_PUBLIC_CONVEX_URL",
      "CONVEX_DEPLOYMENT",
      "AI_PROVIDER",
    ]);
    // No AI provider keys in the core — those are resolved per AI_PROVIDER.
    expect(coreRequiredEnv).not.toContain("AWS_ACCESS_KEY_ID");
    expect(coreRequiredEnv).not.toContain("OPENAI_API_KEY");
  });

  it("an OpenAI self-hoster is NOT asked for AWS/Bedrock keys", () => {
    const required = [...coreRequiredEnv, ...providerRequiredEnv({ AI_PROVIDER: "openai" })];
    expect(required).toContain("OPENAI_API_KEY");
    expect(required).not.toContain("AWS_ACCESS_KEY_ID");
    expect(required).not.toContain("AWS_SECRET_ACCESS_KEY");
    expect(required).not.toContain("AI_MODEL");
  });

  it("a Bedrock self-hoster is asked for the AWS set", () => {
    const required = [...coreRequiredEnv, ...providerRequiredEnv({ AI_PROVIDER: "bedrock" })];
    expect(required).toEqual(
      expect.arrayContaining(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "AI_MODEL"]),
    );
  });

  it("covers the canonical 14-provider catalog and mirrors aiCatalog provider ids", () => {
    // aiCatalog.ts (convex/) is the source of truth; this preflight mirror must
    // cover EXACTLY the same provider ids so a self-hoster on any catalog
    // provider passes the env-name check (decisions.md Q71).
    expect(Object.keys(providerCatalog).sort()).toEqual([...AI_PROVIDER_IDS].sort());
    expect(Object.keys(providerCatalog)).toHaveLength(14);
  });

  it("reachability-pings only the common set; name-checks the long tail", () => {
    // Common set we 1-token-ping for liveness.
    expect(providerCatalog.bedrock.reachable).toBe(true);
    expect(providerCatalog.openai.reachable).toBe(true);
    expect(providerCatalog.anthropic.reachable).toBe(true);
    expect(providerCatalog.google.reachable).toBe(true);
    // Long tail is env-name-checked only (no bespoke probe).
    expect(providerCatalog.groq.reachable).toBe(false);
    expect(providerCatalog.ollama.reachable).toBe(false);
    expect(providerCatalog.openai_compatible.reachable).toBe(false);
  });

  it("a long-tail provider (groq) is asked for its key, not for AWS/Bedrock env", () => {
    const required = [...coreRequiredEnv, ...providerRequiredEnv({ AI_PROVIDER: "groq" })];
    expect(required).toContain("GROQ_API_KEY");
    expect(required).not.toContain("AWS_ACCESS_KEY_ID");
    expect(required).not.toContain("AI_MODEL");
  });

  it("ollama (credentialKind none) requires a base URL, not an API key", () => {
    expect(providerRequiredEnv({ AI_PROVIDER: "ollama" })).toEqual(["OLLAMA_BASE_URL"]);
  });

  it("an unrecognized provider resolves to no extra required env (name-check, no crash)", () => {
    expect(normalizeProvider("totally-made-up")).toBeNull();
    expect(providerRequiredEnv({ AI_PROVIDER: "totally-made-up" })).toEqual([]);
  });

  it("exposes encryption-at-rest as a retained hard requirement", () => {
    expect(encryptionEnvNames).toContain("OPENBOOKS_SECRET_ENCRYPTION_KEY");
  });

  it("exports a requirements surface E13-T6 can diff against", () => {
    const req = envRequirements();
    expect(req.core).toEqual(coreRequiredEnv);
    expect(req.encryption.anyOf).toEqual(encryptionEnvNames);
    expect(Object.keys(req.providerConditional)).toContain("openai");
  });
});

describe("preflight live-connector policy (E13-T4)", () => {
  it("treats an absent Stripe key as SKIP, not FAIL", () => {
    expect(classifyStripeKey(undefined).status).toBe("SKIP");
    expect(classifyStripeKey("").status).toBe("SKIP");
  });

  it("PASSES a live Stripe key (no test-only ban)", () => {
    const live = classifyStripeKey("sk_live_abc123");
    expect(live.status).toBe("PASS");
    expect(live.live).toBe(true);
    const restrictedLive = classifyStripeKey("rk_live_abc123");
    expect(restrictedLive.status).toBe("PASS");
    expect(restrictedLive.live).toBe(true);
  });

  it("still PASSES a test Stripe key and marks it non-live", () => {
    const test = classifyStripeKey("sk_test_abc123");
    expect(test.status).toBe("PASS");
    expect(test.live).toBe(false);
  });

  it("FAILS only a malformed Stripe key", () => {
    expect(classifyStripeKey("pk_live_abc").status).toBe("FAIL");
    expect(classifyStripeKey("garbage").status).toBe("FAIL");
  });

  it("treats absent Plaid env as SKIP", () => {
    expect(classifyPlaidEnv({}).status).toBe("SKIP");
    expect(classifyPlaidEnv({ PLAID_CLIENT_ID: "id" }).status).toBe("SKIP");
  });

  it("PASSES live Plaid (development/production), not just sandbox", () => {
    const base = { PLAID_CLIENT_ID: "id", PLAID_SECRET: "s" };
    const prod = classifyPlaidEnv({ ...base, PLAID_ENV: "production" });
    expect(prod.status).toBe("PASS");
    expect(prod.live).toBe(true);
    const dev = classifyPlaidEnv({ ...base, PLAID_ENV: "development" });
    expect(dev.status).toBe("PASS");
    expect(dev.live).toBe(true);
    const sandbox = classifyPlaidEnv({ ...base, PLAID_ENV: "sandbox" });
    expect(sandbox.status).toBe("PASS");
    expect(sandbox.live).toBe(false);
  });

  it("FAILS an unknown PLAID_ENV", () => {
    expect(classifyPlaidEnv({ PLAID_CLIENT_ID: "id", PLAID_SECRET: "s", PLAID_ENV: "staging" }).status).toBe(
      "FAIL",
    );
  });
});
