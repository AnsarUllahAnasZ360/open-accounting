#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const outputPath = resolve("docs/finishing/evidence/2026-06-12-H3-categorization-holdout-eval.json");
const defaultLimit = 60;
const limit = Number.parseInt(process.env.H3_EVAL_LIMIT ?? String(defaultLimit), 10);

function parseJson(output, label) {
  const trimmed = output.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Could not parse JSON from ${label} output.`);
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

function convexRun(functionName, args) {
  const commandArgs = ["convex", "run", functionName];
  if (args) commandArgs.push(JSON.stringify(args));
  return execFileSync("npx", commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

const seedStatus = parseJson(convexRun("seedDemo:status"), "seedDemo:status");
if (!seedStatus?.entityId) {
  throw new Error("Demo seed status did not include an entityId.");
}

const result = parseJson(
  convexRun("ai:runHoldoutCategorizationEval", {
    sourceEntityId: seedStatus.entityId,
    limit,
  }),
  "ai:runHoldoutCategorizationEval",
);

const artifact = {
  generatedBy: "scripts/h3-holdout-categorization-eval.mjs",
  seed: seedStatus.seed,
  sourceEntityId: seedStatus.entityId,
  noSecrets: true,
  ...result,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
console.log(`${artifact.correctCount}/${artifact.evaluatedCount} correct (${(artifact.accuracy * 100).toFixed(1)}%).`);
