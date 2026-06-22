#!/usr/bin/env node
/**
 * scan-secrets (E13-T8) — the no-PII-commit gate.
 *
 * Two tiers, by design:
 *
 *  1. SECRET SHAPES (real key/token values) — scanned across the public-facing
 *     surface (self-host docs, the web app pages, the setup skill). These must
 *     NEVER appear anywhere a self-hoster reads; a planted `sk_live_…` fails the
 *     gate. Patterns target a real value (a long random tail after the prefix),
 *     not the word "secret" or an illustrative `sk_live_…1234`.
 *
 *  2. OWNER IDENTIFIERS (Ansar's Vercel scope / Convex prod / handle / shared
 *     dev deployment) — scanned ONLY on the GENERIC self-host + public web
 *     surface, where a copy/leak hazard exists. The internal handoff archives
 *     (docs/finishing, docs/initiation, docs/launch-sprint) legitimately discuss
 *     the owner's own deployment and are intentionally excluded — this gate
 *     protects the generic path, not the project's private operating notes.
 *
 * Exit non-zero on any hit; zero on a clean tree. Run via `pnpm scan:secrets`
 * or `node scripts/scan-secrets.mjs`. Pass extra paths/globs as args to scan a
 * custom surface (both tiers apply to the passed paths).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The public-facing surface: what a self-hoster or prospect actually reads.
// Both tiers (secret shapes + owner identifiers) apply here.
const PUBLIC_GLOBS = [
  "docs/self-host/*.md",
  "docs/self-host/**/*.md",
  "docs/security/*.md",
  "docs/security/**/*.md",
  "skills/**/*.md",
  "skills/*.md",
  "apps/web/src/app/**/*.tsx",
  "apps/web/src/app/**/*.ts",
  "README.md",
];

// Allowlisted files — placeholders/illustrations live here on purpose.
const ALLOWLISTED = new Set([".env.example"]);

/**
 * Tier 1 — secret/token value SHAPES. Each targets a long random tail so a bare
 * documentation reference (`whsec_…`, `sk_live_…1234`) does not trip it.
 */
const SECRET_DETECTORS = [
  { name: "Stripe live secret key", re: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/ },
  { name: "Stripe test secret key", re: /\b(?:sk|rk)_test_[0-9A-Za-z]{16,}\b/ },
  { name: "Stripe webhook signing secret", re: /\bwhsec_[0-9A-Za-z]{16,}\b/ },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "OpenAI/Anthropic-style API key", re: /\bsk-(?:ant-)?[0-9A-Za-z_-]{24,}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: "JWT-looking token", re: /\beyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\b/ },
  // Plaid client_id/secret: a 30-char alphanumeric value sitting next to a
  // plaid client_id/secret label (context-gated to avoid matching git SHAs).
  {
    name: "Plaid client_id/secret value",
    re: /plaid[^\n]{0,40}(?:client[_-]?id|secret)[^\n]{0,10}[=:]\s*["']?[0-9a-f]{24,}/i,
  },
];

/**
 * Tier 2 — owner-specific identifiers. A leak hazard ONLY on the generic
 * self-host + public web surface.
 */
const OWNER_DETECTORS = [
  { name: "owner Vercel scope", re: /ansar-ullah-anas-projects/ },
  { name: "owner Convex prod", re: /perceptive-guanaco/ },
  { name: "owner personal handle", re: /ansarullahanas/ },
  { name: "owner shared dev deployment", re: /ceaseless-mandrill/ },
];

function listTrackedFiles(globs) {
  try {
    // --cached + --others --exclude-standard: scan tracked files AND new
    // not-yet-committed files (excluding gitignored), so a secret planted in a
    // brand-new page is caught before it is ever committed. De-dup the union.
    const out = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...globs],
      { cwd: root, encoding: "utf8" },
    );
    return [...new Set(out.split("\n").map((line) => line.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

function scanFile(relPath, errors, detectors) {
  const abs = resolve(root, relPath);
  if (!existsSync(abs) || !statSync(abs).isFile()) return;
  // Strip stray NUL bytes (some committed source files carry one) so the scan
  // still inspects the real text rather than bailing on a binary read.
  const text = readFileSync(abs, "utf8").replace(/\0/g, "");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    for (const detector of detectors) {
      if (detector.re.test(lines[i])) {
        errors.push(`${relPath}:${i + 1} — ${detector.name}`);
      }
    }
  }
}

function main() {
  const extra = process.argv.slice(2);
  const globs = extra.length > 0 ? extra : PUBLIC_GLOBS;
  const files = listTrackedFiles(globs).filter((file) => !ALLOWLISTED.has(file));

  // Both tiers apply to the public surface (and to any caller-passed paths).
  const detectors = [...SECRET_DETECTORS, ...OWNER_DETECTORS];

  const errors = [];
  for (const file of files) scanFile(file, errors, detectors);

  if (errors.length > 0) {
    console.error("[scan-secrets] potential secret/PII found in tracked public files:");
    for (const error of errors) console.error(`  - ${error}`);
    console.error(`\n[scan-secrets] ${errors.length} hit(s). Remove the value or use a placeholder.`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `[scan-secrets] OK — scanned ${files.length} tracked public file(s); no secret/PII shapes found.`,
  );
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (invokedDirectly) main();

export { SECRET_DETECTORS, OWNER_DETECTORS, ALLOWLISTED, scanFile, listTrackedFiles, PUBLIC_GLOBS };
