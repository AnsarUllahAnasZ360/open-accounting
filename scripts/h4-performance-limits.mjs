#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const outputPath = resolve("docs/finishing/evidence/2026-06-12-H4-performance-limits.json");

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

const snapshot = parseJson(
  convexRun("performance:limitsSnapshot", { entityId: seedStatus.entityId }),
  "performance:limitsSnapshot",
);

const artifact = {
  generatedBy: "scripts/h4-performance-limits.mjs",
  generatedAt: new Date().toISOString(),
  seed: seedStatus.seed,
  entityId: seedStatus.entityId,
  noSecrets: true,
  seedCounts: {
    transactions: seedStatus.transactionCount,
    posted: seedStatus.postedCount,
    inbox: seedStatus.inboxCount,
    eval: seedStatus.evalCount,
    trialBalanceDifferenceMinor: seedStatus.trialBalanceDifferenceMinor,
  },
  snapshot,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
console.log(`Dashboard rows: ${snapshot.dashboard.rowCounts.totalRows}/${snapshot.dashboard.limit}`);
console.log(`Report rows: ${snapshot.reportPack.rowCounts.totalRows}/${snapshot.reportPack.limit}`);
