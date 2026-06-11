#!/usr/bin/env node
import { InvokeModelCommand, BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const requiredEnv = [
  "OWNER_EMAIL",
  "OWNER_PASSWORD",
  "NEXT_PUBLIC_CONVEX_URL",
  "CONVEX_DEPLOYMENT",
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "PLAID_ENV",
  "STRIPE_SECRET_KEY",
  "AI_PROVIDER",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "AI_MODEL",
  "AI_EMBEDDINGS_MODEL",
];

const optionalEnv = ["STRIPE_WEBHOOK_SECRET", "PLUNK_SECRET_KEY", "PLUNK_FROM_EMAIL"];

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

function addResult(results, name, ok, detail) {
  results.push({
    name,
    status: ok ? "PASS" : "FAIL",
    detail,
  });
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

async function checkPlaid(env) {
  const baseUrl = plaidBaseUrl(env.PLAID_ENV);
  if (!baseUrl) {
    throw new Error("PLAID_ENV must be sandbox for this goal");
  }
  if (env.PLAID_ENV !== "sandbox") {
    throw new Error("Only Plaid sandbox is allowed for this goal");
  }

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
  return "sandbox endpoint reached";
}

async function checkStripe(env) {
  if (!/^((sk|rk)_test_)/.test(env.STRIPE_SECRET_KEY || "")) {
    throw new Error("Only Stripe test-mode keys are allowed for this goal");
  }

  const response = await fetch("https://api.stripe.com/v1/balance", {
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
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
  return "test balance endpoint reached";
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
  if (env.AI_PROVIDER !== "bedrock") {
    throw new Error("AI_PROVIDER must be bedrock for this goal");
  }

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
  return `runtime accepted ${modelRole} tiny invoke`;
}

async function checkConvex(env) {
  try {
    const response = await fetch(env.NEXT_PUBLIC_CONVEX_URL, { method: "GET" });
    if (response.status >= 500) {
      throw new Error(`HTTP ${response.status}`);
    }
    return "deployment URL responded";
  } catch (error) {
    await execFileAsync("npx", ["convex", "function-spec"], { timeout: 30_000 });
    return "deployment metadata reachable";
  }
}

async function checkVercel() {
  await execFileAsync("vercel", ["whoami"], { timeout: 20_000 });
  return "CLI authenticated";
}

function printResults(results) {
  console.log("| Check | Status | Detail |");
  console.log("|---|---:|---|");
  for (const result of results) {
    console.log(`| ${result.name} | ${result.status} | ${result.detail} |`);
  }
}

async function main() {
  const envPath = resolve(process.cwd(), ".env.local");
  const env = { ...process.env, ...parseEnvFile(envPath) };
  const results = [];

  addResult(
    results,
    ".env.local",
    existsSync(envPath),
    existsSync(envPath) ? "present" : "missing; create it from .env.example",
  );

  const missing = requiredEnv.filter((name) => !env[name]);
  addResult(
    results,
    "Required env names",
    missing.length === 0,
    missing.length === 0 ? "all required names present" : `missing: ${missing.join(", ")}`,
  );

  const optionalPresent = optionalEnv.filter((name) => Boolean(env[name]));
  addResult(
    results,
    "Optional env names",
    true,
    optionalPresent.length === 0 ? "none configured" : `configured: ${optionalPresent.join(", ")}`,
  );

  if (missing.length === 0) {
    const checks = [
      ["Plaid sandbox institutions/get", () => checkPlaid(env)],
      ["Stripe test balance", () => checkStripe(env)],
      ["Bedrock tiny invoke", () => checkBedrock(env)],
      ["Convex deployment", () => checkConvex(env)],
      ["Vercel whoami", () => checkVercel()],
    ];

    for (const [name, check] of checks) {
      try {
        const successDetail = await check();
        addResult(results, name, true, successDetail);
      } catch (error) {
        addResult(results, name, false, sanitizeError(error));
      }
    }
  } else {
    for (const name of [
      "Plaid sandbox institutions/get",
      "Stripe test balance",
      "Bedrock tiny invoke",
      "Convex deployment",
      "Vercel whoami",
    ]) {
      addResult(results, name, false, "skipped because required env names are missing");
    }
  }

  printResults(results);
  process.exitCode = results.some((result) => result.status === "FAIL") ? 1 : 0;
}

main().catch((error) => {
  console.error(sanitizeError(error));
  process.exitCode = 1;
});
