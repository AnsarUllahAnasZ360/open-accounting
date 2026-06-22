#!/usr/bin/env node
/**
 * check-env-docs (E13-T6) — guarantees the self-host env checklist never drifts
 * from the env the app/preflight actually use.
 *
 * It cross-checks three sources and exits non-zero on any mismatch:
 *   1. .env.example — the documented set of every variable.
 *   2. docs/self-host/env-checklist.md — the owner-facing table; each row names a
 *      variable in a backtick code span in its first cell.
 *   3. scripts/preflight.mjs envRequirements() — the names preflight enforces
 *      (core + encryption anyOf + provider-conditional + optional).
 *
 * Assertions:
 *   - Every .env.example variable appears EXACTLY ONCE in the checklist table.
 *   - No checklist row names a variable that is absent from .env.example.
 *   - Every preflight-required name (core, encryption, all provider-conditional,
 *     optional) is present in .env.example AND in the checklist (so e.g. an
 *     OpenAI user is never told AWS keys are required while the doc omits them).
 *
 * Run: `node scripts/check-env-docs.mjs` (or `pnpm check:env-docs`).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { envRequirements } from "./preflight.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envExamplePath = resolve(root, ".env.example");
const checklistPath = resolve(root, "docs/self-host/env-checklist.md");

/** Variable assignment lines in .env.example (e.g. `OWNER_EMAIL=`). */
function readEnvExampleNames(text) {
  const names = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z_][A-Z0-9_]*)=/.exec(line);
    if (match) names.push(match[1]);
  }
  return names;
}

/**
 * Variable names from the checklist table. We accept any markdown-table row
 * whose first cell is a single backtick-quoted ENV_NAME, e.g.
 * `| \`OWNER_EMAIL\` | Required | ... |`. Names are collected with their count so
 * we can flag duplicates.
 */
function readChecklistNames(text) {
  const counts = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) continue;
    const firstCell = line.split("|")[1]?.trim() ?? "";
    const match = /^`([A-Z_][A-Z0-9_]*)`$/.exec(firstCell);
    if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return counts;
}

function flatPreflightNames(req) {
  const names = new Set();
  for (const name of req.core) names.add(name);
  for (const name of req.encryption.anyOf) names.add(name);
  for (const list of Object.values(req.providerConditional)) {
    for (const name of list) names.add(name);
  }
  for (const name of req.optional) names.add(name);
  return names;
}

function main() {
  const errors = [];

  if (!existsSync(envExamplePath)) {
    console.error("[check-env-docs] .env.example is missing.");
    process.exitCode = 1;
    return;
  }
  if (!existsSync(checklistPath)) {
    console.error(`[check-env-docs] ${checklistPath} is missing (E13-T6 deliverable).`);
    process.exitCode = 1;
    return;
  }

  const exampleNames = readEnvExampleNames(readFileSync(envExamplePath, "utf8"));
  const exampleSet = new Set(exampleNames);
  const checklistCounts = readChecklistNames(readFileSync(checklistPath, "utf8"));

  // 1. Every .env.example var appears exactly once in the checklist.
  for (const name of exampleNames) {
    const count = checklistCounts.get(name) ?? 0;
    if (count === 0) errors.push(`MISSING from env-checklist.md: ${name}`);
    else if (count > 1) errors.push(`DUPLICATED in env-checklist.md (${count}x): ${name}`);
  }

  // 2. No checklist row names a var that .env.example does not declare.
  for (const name of checklistCounts.keys()) {
    if (!exampleSet.has(name)) errors.push(`EXTRA in env-checklist.md (not in .env.example): ${name}`);
  }

  // 3. Every preflight-enforced name is in both .env.example and the checklist.
  const preflightNames = flatPreflightNames(envRequirements());
  for (const name of preflightNames) {
    if (!exampleSet.has(name)) errors.push(`preflight requires ${name} but it is missing from .env.example`);
    if (!checklistCounts.has(name)) errors.push(`preflight requires ${name} but it is missing from env-checklist.md`);
  }

  if (errors.length > 0) {
    console.error("[check-env-docs] env documentation is OUT OF SYNC:");
    for (const error of errors) console.error(`  - ${error}`);
    console.error(
      `\n[check-env-docs] ${errors.length} problem(s). Update docs/self-host/env-checklist.md or .env.example.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[check-env-docs] OK — ${exampleNames.length} variables documented; checklist in sync with .env.example and preflight.`,
  );
}

main();

export { readEnvExampleNames, readChecklistNames, flatPreflightNames };
