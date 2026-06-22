#!/usr/bin/env node
import { InvokeModelCommand, BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const guardOnly = process.argv.includes("--guard-only");
const writeRequirements = process.argv.includes("--write-requirements");

// Provider-agnostic core: required for every self-hoster regardless of which AI
// provider they chose. AI_PROVIDER selects the provider-conditional set below.
const coreRequiredEnv = [
  "OWNER_EMAIL",
  "OWNER_PASSWORD",
  "NEXT_PUBLIC_CONVEX_URL",
  "CONVEX_DEPLOYMENT",
  "AI_PROVIDER",
];

// Encryption-at-rest stays a HARD requirement (decisions.md Q16 retains it even
// with live connectors allowed). Either env name satisfies secretBox.ts.
const encryptionEnvNames = ["OPENBOOKS_SECRET_ENCRYPTION_KEY", "OPENBOOKS_TOKEN_ENCRYPTION_KEY"];

/**
 * Provider-conditional required env, mirroring the canonical 14-provider catalog
 * in convex/aiCatalog.ts (AI_PROVIDER_IDS / AI_PROVIDER_CATALOG). Kept as a plain
 * JS mirror because preflight is a Node .mjs script and cannot import the .ts
 * catalog directly; aiCatalog.ts remains the source of truth and a unit test
 * cross-checks that this mirror covers exactly the same provider ids.
 *
 * `reachable` marks the common set we 1-token-ping for liveness (decisions.md
 * Q71 — Bedrock/OpenAI/Anthropic/Google). The long tail (ollama, the
 * openai-compatible gateways, and the Vercel AI Gateway) is name-checked only:
 * its env presence is verified but no network ping is made, so a self-hoster on
 * Groq/DeepSeek/etc. passes the env-name check without preflight needing a
 * bespoke probe per provider.
 *
 * `credentialKind: "none"` providers (ollama) require only a base URL, not a
 * secret — handled by listing OLLAMA_BASE_URL rather than an API key.
 */
const providerCatalog = {
  gateway: {
    label: "Vercel AI Gateway",
    requiredEnv: ["AI_GATEWAY_API_KEY"],
    reachable: false,
  },
  openai: {
    label: "OpenAI",
    requiredEnv: ["OPENAI_API_KEY"],
    reachable: true,
  },
  anthropic: {
    label: "Anthropic",
    requiredEnv: ["ANTHROPIC_API_KEY"],
    reachable: true,
  },
  google: {
    label: "Google AI Studio",
    requiredEnv: ["GOOGLE_GENERATIVE_AI_API_KEY"],
    reachable: true,
  },
  bedrock: {
    label: "Amazon Bedrock",
    requiredEnv: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "AI_MODEL"],
    reachable: true,
  },
  azure: {
    label: "Azure OpenAI",
    requiredEnv: ["AZURE_API_KEY", "AZURE_BASE_URL"],
    reachable: false,
  },
  groq: {
    label: "Groq",
    requiredEnv: ["GROQ_API_KEY"],
    reachable: false,
  },
  deepseek: {
    label: "DeepSeek",
    requiredEnv: ["DEEPSEEK_API_KEY"],
    reachable: false,
  },
  mistral: {
    label: "Mistral",
    requiredEnv: ["MISTRAL_API_KEY"],
    reachable: false,
  },
  moonshot: {
    label: "Moonshot (Kimi)",
    requiredEnv: ["MOONSHOT_API_KEY"],
    reachable: false,
  },
  xai: {
    label: "xAI (Grok)",
    requiredEnv: ["XAI_API_KEY"],
    reachable: false,
  },
  fireworks: {
    label: "Fireworks",
    requiredEnv: ["FIREWORKS_API_KEY"],
    reachable: false,
  },
  ollama: {
    label: "Ollama (local)",
    requiredEnv: ["OLLAMA_BASE_URL"],
    reachable: false,
  },
  openai_compatible: {
    label: "OpenAI-compatible (custom)",
    requiredEnv: ["OPENAI_COMPATIBLE_API_KEY", "OPENAI_COMPATIBLE_BASE_URL"],
    reachable: false,
  },
};

const optionalEnv = [
  "STRIPE_WEBHOOK_SECRET",
  "PLUNK_SECRET_KEY",
  "PLUNK_FROM_EMAIL",
  "AI_EMBEDDINGS_MODEL",
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "PLAID_ENV",
  "STRIPE_SECRET_KEY",
];

function normalizeProvider(value) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  return Object.prototype.hasOwnProperty.call(providerCatalog, normalized) ? normalized : null;
}

/** Provider-conditional required names for the configured AI_PROVIDER. */
function providerRequiredEnv(env) {
  const provider = normalizeProvider(env.AI_PROVIDER);
  if (!provider) return [];
  return providerCatalog[provider].requiredEnv;
}

/**
 * Pre-network classification of a Stripe key. Returns the status preflight will
 * report BEFORE any reachability call: absent → SKIP, live or test → eligible to
 * PASS (no test-only ban), malformed → FAIL. Pulled out so it is unit-testable
 * without hitting the Stripe API.
 */
function classifyStripeKey(key) {
  if (!key) {
    return { status: "SKIP", detail: "STRIPE_SECRET_KEY absent; paste a key in Settings → Connections" };
  }
  if (!/^((sk|rk)_(test|live)_)/.test(key)) {
    return { status: "FAIL", detail: "STRIPE_SECRET_KEY is not a recognized sk_/rk_ key" };
  }
  const live = /^((sk|rk)_live_)/.test(key);
  return { status: "PASS", live };
}

/**
 * Pre-network classification of Plaid env: absent → SKIP, unknown PLAID_ENV →
 * FAIL, otherwise eligible to PASS (live development/production permitted).
 */
function classifyPlaidEnv(env) {
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET || !env.PLAID_ENV) {
    return { status: "SKIP", detail: "PLAID_* absent; paste keys in Settings → Connections" };
  }
  if (!plaidBaseUrl(env.PLAID_ENV)) {
    return { status: "FAIL", detail: `PLAID_ENV must be sandbox/development/production (got ${env.PLAID_ENV})` };
  }
  const live = env.PLAID_ENV === "development" || env.PLAID_ENV === "production";
  return { status: "PASS", live };
}

/** The full env requirements surface, exported for the env-docs checklist (E13-T6). */
function envRequirements() {
  return {
    core: coreRequiredEnv,
    encryption: { anyOf: encryptionEnvNames },
    providerConditional: Object.fromEntries(
      Object.entries(providerCatalog).map(([id, def]) => [id, def.requiredEnv]),
    ),
    optional: optionalEnv,
  };
}

function parseEnvFile(path) {
  const env = {};
  if (!existsSync(path)) {
    return env;
  }

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    env[key] = value.replace(/\\n/g, "\n");
  }

  return env;
}

function sanitizeError(error) {
  if (!error) {
    return "Unknown error";
  }

  const parts = [];
  if (error.name) {
    parts.push(error.name);
  }
  if (error.code) {
    parts.push(error.code);
  }
  if (error.status || error.$metadata?.httpStatusCode) {
    parts.push(`HTTP ${error.status ?? error.$metadata.httpStatusCode}`);
  }
  if (error.message) {
    parts.push(error.message.split("\n")[0].slice(0, 140));
  }
  return parts.join(" - ") || "Failed";
}

function addResult(results, name, status, detail) {
  // status is "PASS" | "FAIL" | "SKIP" | "INFO"; legacy boolean maps to PASS/FAIL.
  const resolved = typeof status === "boolean" ? (status ? "PASS" : "FAIL") : status;
  results.push({ name, status: resolved, detail });
}

function isLocalUrl(value) {
  if (!value) return false;
  try {
    const { hostname } = new URL(value);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function devBypassGuard(env) {
  const serverBypass = env.OPENBOOKS_DEV_AUTH_BYPASS === "1";
  const browserBypass = env.NEXT_PUBLIC_OPENBOOKS_DEV_AUTH_BYPASS === "1";
  if (!serverBypass && !browserBypass) {
    return { ok: true, detail: "disabled" };
  }

  if (env.VERCEL_ENV === "production" || env.NODE_ENV === "production") {
    return { ok: false, detail: "dev auth bypass cannot be enabled in production" };
  }

  if (serverBypass && !isLocalUrl(env.SITE_URL)) {
    return { ok: false, detail: "OPENBOOKS_DEV_AUTH_BYPASS requires SITE_URL to be localhost" };
  }

  if (browserBypass && env.NEXT_PUBLIC_APP_URL && !isLocalUrl(env.NEXT_PUBLIC_APP_URL)) {
    return { ok: false, detail: "NEXT_PUBLIC_OPENBOOKS_DEV_AUTH_BYPASS requires a localhost app URL" };
  }

  return { ok: true, detail: "enabled only for localhost development" };
}

function plaidBaseUrl(env) {
  if (env === "sandbox") {
    return "https://sandbox.plaid.com";
  }
  if (env === "development") {
    return "https://development.plaid.com";
  }
  if (env === "production") {
    return "https://production.plaid.com";
  }
  return null;
}

/**
 * Plaid reachability. Self-hosters paste Plaid keys in-app later, so absent keys
 * are a SKIP, not a FAIL. Live (development/production) keys are PERMITTED
 * (decisions.md Q16) — they pass like sandbox; we only INFO-note the HTTPS
 * redirect requirement. No sandbox-only ban.
 */
async function checkPlaid(env) {
  const classified = classifyPlaidEnv(env);
  if (classified.status !== "PASS") {
    return classified;
  }
  const baseUrl = plaidBaseUrl(env.PLAID_ENV);
  const live = classified.live;
  const response = await fetch(`${baseUrl}/institutions/get`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: env.PLAID_CLIENT_ID,
      secret: env.PLAID_SECRET,
      count: 1,
      offset: 0,
      country_codes: ["US"],
    }),
  });
  if (!response.ok) {
    let code = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      code = body.error_code || body.error_type || code;
    } catch {
      // Keep the status-only detail.
    }
    throw new Error(code);
  }
  return {
    status: "PASS",
    detail: live
      ? `${env.PLAID_ENV} endpoint reached (live; HTTPS redirect required)`
      : "sandbox endpoint reached",
  };
}

/**
 * Stripe reachability. Absent key → SKIP. Live keys (sk_live_/rk_live_) are
 * PERMITTED (decisions.md Q16) and PASS; we only INFO-note HTTPS. No test-only
 * ban.
 */
async function checkStripe(env) {
  const key = env.STRIPE_SECRET_KEY;
  const classified = classifyStripeKey(key);
  if (classified.status !== "PASS") {
    return classified;
  }
  const live = classified.live;
  const response = await fetch("https://api.stripe.com/v1/balance", {
    headers: {
      authorization: `Bearer ${key}`,
    },
  });
  if (!response.ok) {
    let code = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      code = body.error?.code || body.error?.type || code;
    } catch {
      // Keep the status-only detail.
    }
    throw new Error(code);
  }
  return {
    status: "PASS",
    detail: live ? "live balance endpoint reached (HTTPS webhook required)" : "test balance endpoint reached",
  };
}

function bedrockPayload(modelId) {
  if (modelId.includes("anthropic.claude")) {
    return {
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1,
        messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
      }),
    };
  }

  if (modelId.includes("amazon.nova")) {
    return {
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        messages: [{ role: "user", content: [{ text: "ping" }] }],
        inferenceConfig: { maxTokens: 1, temperature: 0 },
      }),
    };
  }

  if (modelId.includes("amazon.titan-text")) {
    return {
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        inputText: "ping",
        textGenerationConfig: { maxTokenCount: 1, temperature: 0 },
      }),
    };
  }

  if (modelId.includes("amazon.titan-embed")) {
    return {
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({ inputText: "ping" }),
    };
  }

  throw new Error("AI_MODEL is not recognized by the preflight tiny-invoke body builder");
}

async function checkBedrock(env) {
  const client = new BedrockRuntimeClient({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });

  let modelId = env.AI_MODEL;
  let modelRole = "AI_MODEL";
  let payload;
  try {
    payload = bedrockPayload(modelId);
  } catch {
    if (!env.AI_EMBEDDINGS_MODEL) {
      // Unrecognized model and no embeddings fallback: don't crash the builder,
      // report a name-check SKIP instead.
      return { status: "SKIP", detail: "AI_MODEL not recognized by tiny-invoke builder; name-check only" };
    }
    modelId = env.AI_EMBEDDINGS_MODEL;
    modelRole = "AI_EMBEDDINGS_MODEL";
    payload = bedrockPayload(modelId);
  }

  await client.send(
    new InvokeModelCommand({
      modelId,
      ...payload,
    }),
  );
  return { status: "PASS", detail: `runtime accepted ${modelRole} tiny invoke` };
}

async function checkOpenAI(env) {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return { status: "PASS", detail: "models endpoint reached" };
}

async function checkAnthropic(env) {
  const response = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return { status: "PASS", detail: "models endpoint reached" };
}

async function checkGoogle(env) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(env.GOOGLE_GENERATIVE_AI_API_KEY)}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return { status: "PASS", detail: "models endpoint reached" };
}

/**
 * AI provider dispatch. Reachability-ping the common set; name-check the long
 * tail (ollama, unrecognized providers) so an unrecognized provider/model never
 * throws an unhandled error.
 */
async function checkAIProvider(env) {
  const provider = normalizeProvider(env.AI_PROVIDER);
  if (!provider) {
    return {
      status: "SKIP",
      detail: `AI_PROVIDER='${env.AI_PROVIDER ?? ""}' not in the 14-provider catalog (${Object.keys(providerCatalog).join("|")}); name-check only`,
    };
  }
  const def = providerCatalog[provider];
  const missing = def.requiredEnv.filter((name) => !env[name]);
  if (missing.length > 0) {
    return { status: "FAIL", detail: `${def.label}: missing ${missing.join(", ")}` };
  }
  if (!def.reachable) {
    return { status: "SKIP", detail: `${def.label}: env present; reachability name-check only` };
  }
  if (provider === "bedrock") return checkBedrock(env);
  if (provider === "openai") return checkOpenAI(env);
  if (provider === "anthropic") return checkAnthropic(env);
  if (provider === "google") return checkGoogle(env);
  return { status: "SKIP", detail: `${def.label}: env present; name-check only` };
}

async function checkConvex(env) {
  try {
    const response = await fetch(env.NEXT_PUBLIC_CONVEX_URL, { method: "GET" });
    if (response.status >= 500) {
      throw new Error(`HTTP ${response.status}`);
    }
    return { status: "PASS", detail: "deployment URL responded" };
  } catch (error) {
    await execFileAsync("npx", ["convex", "function-spec"], { timeout: 30_000 });
    return { status: "PASS", detail: "deployment metadata reachable" };
  }
}

async function checkVercel() {
  await execFileAsync("vercel", ["whoami"], { timeout: 20_000 });
  return { status: "PASS", detail: "CLI authenticated" };
}

function printResults(results) {
  console.log("| Check | Status | Detail |");
  console.log("|---|---:|---|");
  for (const result of results) {
    console.log(`| ${result.name} | ${result.status} | ${result.detail} |`);
  }
}

async function runCheck(results, name, fn) {
  try {
    const outcome = await fn();
    // Checks may return a {status, detail} object or a legacy success string.
    if (outcome && typeof outcome === "object" && "status" in outcome) {
      addResult(results, name, outcome.status, outcome.detail);
    } else {
      addResult(results, name, "PASS", outcome);
    }
  } catch (error) {
    addResult(results, name, "FAIL", sanitizeError(error));
  }
}

async function main() {
  const envPath = resolve(process.cwd(), ".env.local");
  const env = { ...parseEnvFile(envPath), ...process.env };
  const results = [];

  if (writeRequirements) {
    const target = resolve(process.cwd(), "docs/self-host/env-requirements.json");
    writeFileSync(target, `${JSON.stringify(envRequirements(), null, 2)}\n`);
    console.log(`Wrote env requirements to ${target}`);
    return;
  }

  addResult(
    results,
    ".env.local",
    existsSync(envPath) ? "PASS" : "FAIL",
    existsSync(envPath) ? "present" : "missing; create it from .env.example",
  );

  // Required = provider-agnostic core + the provider-conditional set for the
  // configured AI_PROVIDER. A self-hoster on OpenAI is NOT asked for AWS keys.
  const requiredEnv = [...coreRequiredEnv, ...providerRequiredEnv(env)];
  const missing = requiredEnv.filter((name) => !env[name]);
  addResult(
    results,
    "Required env names",
    missing.length === 0 ? "PASS" : "FAIL",
    missing.length === 0 ? `all required names present (provider=${env.AI_PROVIDER ?? "?"})` : `missing: ${missing.join(", ")}`,
  );

  // Encryption-at-rest is a HARD gate (retained guarantee, decisions.md Q16).
  const encryptionPresent = encryptionEnvNames.some((name) => Boolean(env[name]));
  addResult(
    results,
    "Encryption at rest",
    encryptionPresent ? "PASS" : "FAIL",
    encryptionPresent
      ? "OPENBOOKS_SECRET_ENCRYPTION_KEY set"
      : "set OPENBOOKS_SECRET_ENCRYPTION_KEY (run `pnpm setup`) before storing any credential",
  );

  const optionalPresent = optionalEnv.filter((name) => Boolean(env[name]));
  addResult(
    results,
    "Optional env names",
    "INFO",
    optionalPresent.length === 0 ? "none configured" : `configured: ${optionalPresent.join(", ")}`,
  );

  const bypassGuard = devBypassGuard(env);
  addResult(results, "Dev auth bypass guard", bypassGuard.ok ? "PASS" : "FAIL", bypassGuard.detail);

  if (guardOnly) {
    printResults(results);
    process.exitCode = bypassGuard.ok ? 0 : 1;
    return;
  }

  // Reachability checks. Plaid/Stripe degrade to SKIP when absent; live keys
  // PASS. The AI provider dispatch covers the catalog. The core gate (required
  // names + encryption) is what can turn the run red.
  await runCheck(results, "Plaid connectivity", () => checkPlaid(env));
  await runCheck(results, "Stripe connectivity", () => checkStripe(env));
  await runCheck(results, "AI provider reachability", () => checkAIProvider(env));
  await runCheck(results, "Convex deployment", () => checkConvex(env));
  await runCheck(results, "Vercel whoami", () => checkVercel());

  printResults(results);
  process.exitCode = results.some((result) => result.status === "FAIL") ? 1 : 0;
}

// Only run the preflight when invoked directly (`node scripts/preflight.mjs`),
// not when imported for its exported pure helpers (check-env-docs, unit tests).
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeError(error));
    process.exitCode = 1;
  });
}

export {
  envRequirements,
  providerCatalog,
  coreRequiredEnv,
  encryptionEnvNames,
  optionalEnv,
  normalizeProvider,
  providerRequiredEnv,
  classifyStripeKey,
  classifyPlaidEnv,
};
