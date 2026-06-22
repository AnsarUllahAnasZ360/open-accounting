import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// E13-T6: the env checklist must never drift from .env.example or from what
// preflight enforces. This runs the same cross-checks as
// `scripts/check-env-docs.mjs` inside the unit gate so `pnpm verify` fails on
// drift, and proves the verifier helpers are real (not no-ops).
import { readEnvExampleNames, readChecklistNames, flatPreflightNames } from "../scripts/check-env-docs.mjs";
import { envRequirements } from "../scripts/preflight.mjs";

const root = resolve(__dirname, "..");
const exampleNames = readEnvExampleNames(readFileSync(resolve(root, ".env.example"), "utf8"));
const checklistCounts = readChecklistNames(
  readFileSync(resolve(root, "docs/self-host/env-checklist.md"), "utf8"),
);

describe("env checklist is in sync with .env.example (E13-T6)", () => {
  it("documents every .env.example variable exactly once", () => {
    const missing = exampleNames.filter((name) => (checklistCounts.get(name) ?? 0) === 0);
    const duplicated = exampleNames.filter((name) => (checklistCounts.get(name) ?? 0) > 1);
    expect(missing, `missing from env-checklist.md: ${missing.join(", ")}`).toEqual([]);
    expect(duplicated, `duplicated in env-checklist.md: ${duplicated.join(", ")}`).toEqual([]);
  });

  it("has no checklist row for a variable absent from .env.example", () => {
    const exampleSet = new Set(exampleNames);
    const extra = [...checklistCounts.keys()].filter((name) => !exampleSet.has(name));
    expect(extra, `extra in env-checklist.md: ${extra.join(", ")}`).toEqual([]);
  });
});

describe("checklist covers preflight's provider-aware requirements (E13-T6)", () => {
  const exampleSet = new Set(exampleNames);
  const required = flatPreflightNames(envRequirements());

  it("every preflight-enforced name is in both .env.example and the checklist", () => {
    const gaps: string[] = [];
    for (const name of required) {
      if (!exampleSet.has(name)) gaps.push(`${name} (missing from .env.example)`);
      if (!checklistCounts.has(name)) gaps.push(`${name} (missing from env-checklist.md)`);
    }
    expect(gaps, gaps.join("; ")).toEqual([]);
  });

  it("bedrock and openai required splits are both documented (no AWS-for-OpenAI drift)", () => {
    const req = envRequirements();
    for (const name of req.providerConditional.bedrock) {
      expect(checklistCounts.has(name), `bedrock env ${name} missing from checklist`).toBe(true);
    }
    for (const name of req.providerConditional.openai) {
      expect(checklistCounts.has(name), `openai env ${name} missing from checklist`).toBe(true);
    }
    // Sanity: bedrock asks for AWS keys, openai does not.
    expect(req.providerConditional.bedrock).toContain("AWS_ACCESS_KEY_ID");
    expect(req.providerConditional.openai).not.toContain("AWS_ACCESS_KEY_ID");
  });
});

describe("self-host docs are generic, not Ansar-specific (E13-T6)", () => {
  const docs = ["docs/self-host/prerequisites.md", "docs/self-host/env-checklist.md"].map((p) =>
    readFileSync(resolve(root, p), "utf8"),
  );

  it("contain none of the owner-specific identifiers", () => {
    const banned = ["perceptive-guanaco", "ansarullahanas", "ansar-ullah-anas-projects", "ceaseless-mandrill"];
    for (const text of docs) {
      for (const needle of banned) {
        expect(text.toLowerCase()).not.toContain(needle);
      }
    }
  });
});
