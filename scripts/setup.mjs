#!/usr/bin/env node
/**
 * pnpm setup — one-shot, idempotent bootstrap for a fresh OpenBooks clone.
 *
 * Collapses the most error-prone manual steps into one command the
 * openbooks-self-host skill and a human can both run:
 *   1. Write .env.local from .env.example when missing (never clobber values).
 *   2. Mint a Convex Auth JWT keypair (RS256 PKCS8) + matching JWKS when absent.
 *   3. Mint OPENBOOKS_SECRET_ENCRYPTION_KEY (32 raw bytes, base64) when absent —
 *      the key convex/secretBox.ts needs before any Plaid/Stripe/AI/Plunk
 *      credential can be stored encrypted-at-rest.
 *   4. Push server-only secrets into the Convex deployment env via
 *      `npx convex env set NAME` (value via stdin — never echoed). `--prod`
 *      targets the production deployment but PAUSES for explicit confirmation
 *      first (decisions.md Q69 — never fully auto-provision).
 *   5. Print a names-only PASS/SET/SKIP table and recommend `pnpm preflight`.
 *
 * Guarantees: idempotent (re-running is a no-op for set values), never
 * overwrites a non-empty secret, never prints a secret VALUE to stdout/stderr.
 */
import { generateKeyPair, exportJWK, exportPKCS8 } from "jose";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env.local");
const examplePath = resolve(root, ".env.example");
const prod = process.argv.includes("--prod");
const noConvex = process.argv.includes("--no-convex");
const yes = process.argv.includes("--yes");

// Server-only secret names pushed into the Convex deployment env. NEXT_PUBLIC_*
// belongs in Vercel (the browser bundle), not here, so it is intentionally
// excluded. Plaid/Stripe/AI/Plunk values are pushed only when present in
// .env.local (live OR test keys both permitted — decisions.md Q16).
const convexServerSecrets = [
  "JWT_PRIVATE_KEY",
  "JWKS",
  "SITE_URL",
  "OPENBOOKS_SECRET_ENCRYPTION_KEY",
  // Local dev owner bypass needs all three on the Convex deployment: the flag,
  // and the owner email/password that bootstrapOwner + the bypass resolver read.
  "OPENBOOKS_DEV_AUTH_BYPASS",
  "OWNER_EMAIL",
  "OWNER_PASSWORD",
  "AI_PROVIDER",
  "AI_MODEL",
  "AI_EMBEDDINGS_MODEL",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OLLAMA_BASE_URL",
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "PLAID_ENV",
  "PLAID_OAUTH_REDIRECT_URI",
  "PLAID_WEBHOOK_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "PLUNK_SECRET_KEY",
  "PLUNK_FROM_EMAIL",
];

/**
 * Minimal .env parser/serializer that preserves comments and ordering so we can
 * round-trip .env.local without losing the documentation in .env.example.
 */
function parseEnvLines(text) {
  const lines = text.split(/\r?\n/);
  const entries = new Map();
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      // Double-quoted: undo envValueQuoted's escaping so the round-trip is exact
      // (JWKS JSON contains `"` and is written double-quoted by setup).
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    entries.set(key, value.replace(/\\n/g, "\n"));
  }
  return { lines, entries };
}

function readEnv(path) {
  if (!existsSync(path)) return { lines: [], entries: new Map() };
  return parseEnvLines(readFileSync(path, "utf8"));
}

function envValueQuoted(value) {
  // Quote when the value contains spaces/# or newlines (newlines escaped to \n
  // so the file stays single-line per var, matching .env.example conventions).
  const escaped = value.replace(/\n/g, "\\n");
  if (/[\s#"]/.test(escaped) || escaped === "") {
    return `"${escaped.replace(/"/g, '\\"')}"`;
  }
  return escaped;
}

/**
 * Set KEY=value in the .env.local text, replacing an existing (possibly empty)
 * assignment line in place, or appending if the key is absent. Returns the new
 * text. Only called for keys we are minting; never overwrites a non-empty value
 * (the caller checks that).
 */
function upsertEnvLine(text, key, value) {
  const assignment = `${key}=${envValueQuoted(value)}`;
  const lines = text.split(/\r?\n/);
  let replaced = false;
  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) return line;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) return line;
    if (trimmed.slice(0, equalsIndex).trim() === key) {
      replaced = true;
      return assignment;
    }
    return line;
  });
  if (!replaced) {
    if (next.length && next[next.length - 1].trim() !== "") next.push("");
    next.push(assignment);
    next.push("");
  }
  return next.join("\n");
}

async function generateConvexAuthKeys() {
  // Convex Auth expects an RS256 keypair: JWT_PRIVATE_KEY is the PKCS8 PEM with
  // newlines flattened to spaces (single env line), JWKS is the public key as a
  // JWK set with use: "sig".
  const keys = await generateKeyPair("RS256", { extractable: true });
  const privateKeyPem = await exportPKCS8(keys.privateKey);
  const jwt = privateKeyPem.trimEnd().replace(/\n/g, " ");
  const publicJwk = await exportJWK(keys.publicKey);
  const jwks = JSON.stringify({ keys: [{ use: "sig", ...publicJwk }] });
  return { jwt, jwks };
}

function generateEncryptionKey() {
  // 32 raw bytes, base64. secretBox.ts SHA-256s the string, so any 32-byte
  // secret is valid; we mint a correctly-sized one. (The HKDF/unified-store
  // reshape is E3's; T2 only mints a correctly-sized key.)
  return randomBytes(32).toString("base64");
}

function confirm(question) {
  if (yes) return Promise.resolve(true);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolveAnswer) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolveAnswer(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

/** Push one secret to the Convex deployment env via stdin (value never echoed). */
function convexEnvSet(name, value) {
  const args = ["convex", "env", "set"];
  if (prod) args.push("--prod");
  args.push(name);
  const result = spawnSync("npx", args, {
    cwd: root,
    input: value,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    // Windows resolves `npx` only as `npx.cmd`; spawn through a shell so the
    // secret push works cross-platform (value still arrives via stdin, unechoed).
    shell: true,
  });
  return result.status === 0;
}

function printTable(rows) {
  console.log("\n| Variable | Result |");
  console.log("|---|---|");
  for (const row of rows) {
    console.log(`| ${row.name} | ${row.result} |`);
  }
}

async function main() {
  const rows = [];

  // Step 1 — ensure .env.local exists (copy from .env.example, never clobber).
  if (!existsSync(envPath)) {
    if (!existsSync(examplePath)) {
      console.error("[setup] .env.example is missing; cannot bootstrap .env.local.");
      process.exitCode = 1;
      return;
    }
    copyFileSync(examplePath, envPath);
    rows.push({ name: ".env.local", result: "SET (copied from .env.example)" });
  } else {
    rows.push({ name: ".env.local", result: "SKIP (already present)" });
  }

  let text = readFileSync(envPath, "utf8");
  const existing = parseEnvLines(text).entries;

  // Step 2 — mint Convex Auth keys when absent.
  if (!existing.get("JWT_PRIVATE_KEY") || !existing.get("JWKS")) {
    const { jwt, jwks } = await generateConvexAuthKeys();
    if (!existing.get("JWT_PRIVATE_KEY")) {
      text = upsertEnvLine(text, "JWT_PRIVATE_KEY", jwt);
      rows.push({ name: "JWT_PRIVATE_KEY", result: "SET (minted RS256 PKCS8)" });
    } else {
      rows.push({ name: "JWT_PRIVATE_KEY", result: "SKIP (already set)" });
    }
    if (!existing.get("JWKS")) {
      text = upsertEnvLine(text, "JWKS", jwks);
      rows.push({ name: "JWKS", result: "SET (matching public JWKS)" });
    } else {
      rows.push({ name: "JWKS", result: "SKIP (already set)" });
    }
  } else {
    rows.push({ name: "JWT_PRIVATE_KEY", result: "SKIP (already set)" });
    rows.push({ name: "JWKS", result: "SKIP (already set)" });
  }

  // Step 3 — mint OPENBOOKS_SECRET_ENCRYPTION_KEY when absent (legacy name also
  // satisfies secretBox.ts, so respect it).
  if (existing.get("OPENBOOKS_SECRET_ENCRYPTION_KEY") || existing.get("OPENBOOKS_TOKEN_ENCRYPTION_KEY")) {
    rows.push({ name: "OPENBOOKS_SECRET_ENCRYPTION_KEY", result: "SKIP (already set)" });
  } else {
    text = upsertEnvLine(text, "OPENBOOKS_SECRET_ENCRYPTION_KEY", generateEncryptionKey());
    rows.push({ name: "OPENBOOKS_SECRET_ENCRYPTION_KEY", result: "SET (32 random bytes, base64)" });
  }

  writeFileSync(envPath, text);

  // Step 4 — push server-only secrets into the Convex deployment env.
  const finalEnv = parseEnvLines(readFileSync(envPath, "utf8")).entries;
  if (noConvex) {
    rows.push({ name: "convex env set", result: "SKIP (--no-convex)" });
  } else {
    if (prod) {
      const proceed = await confirm(
        "[setup] --prod will write secrets to your PRODUCTION Convex deployment. Continue?",
      );
      if (!proceed) {
        rows.push({ name: "convex env set", result: "SKIP (prod write declined)" });
        printTable(rows);
        console.log("\n[setup] Aborted before any prod write. Re-run without --prod for dev.");
        return;
      }
    }
    const target = prod ? "prod" : "dev";
    let pushed = 0;
    let failed = 0;
    for (const name of convexServerSecrets) {
      const value = finalEnv.get(name);
      if (!value) continue;
      const ok = convexEnvSet(name, value);
      if (ok) {
        pushed += 1;
      } else {
        failed += 1;
      }
    }
    if (failed > 0) {
      rows.push({
        name: `convex env set (${target})`,
        result: `${pushed} set, ${failed} failed (run \`npx convex dev --once\` first to link a deployment)`,
      });
    } else if (pushed === 0) {
      rows.push({ name: `convex env set (${target})`, result: "SKIP (no server secrets present yet)" });
    } else {
      rows.push({ name: `convex env set (${target})`, result: `SET ${pushed} server secret name(s)` });
    }
  }

  printTable(rows);

  // Step 5 — next steps.
  console.log("\n[setup] Done. No secret values were printed above (names only).");
  console.log("[setup] Next:");
  console.log("  1. Fill in OWNER_EMAIL / OWNER_PASSWORD and your AI/Plaid/Stripe keys in .env.local.");
  console.log("  2. Re-run `pnpm setup` to push any newly added server secrets to Convex.");
  console.log("  3. Run `npx convex dev --once` to push functions and link a deployment.");
  console.log("  4. Run `pnpm preflight` to verify, then `pnpm dev:full` to boot locally.");
}

// Only run the bootstrap when invoked directly (`node scripts/setup.mjs`), not
// when imported by a test that exercises the pure helpers below.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[setup] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export {
  parseEnvLines,
  envValueQuoted,
  upsertEnvLine,
  generateConvexAuthKeys,
  generateEncryptionKey,
  convexServerSecrets,
};
