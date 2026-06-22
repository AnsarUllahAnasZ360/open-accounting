import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// E13-T8: the no-PII-commit gate. We run the same detectors `pnpm scan:secrets`
// uses inside the unit gate so a real key shape or owner identifier in a public
// file fails `pnpm verify`. We also prove the detectors are REAL (a planted
// secret string is caught) and that the generic deploy doc carries no
// owner-specific values.
import {
  SECRET_DETECTORS,
  OWNER_DETECTORS,
  scanFile,
  listTrackedFiles,
  PUBLIC_GLOBS,
} from "../scripts/scan-secrets.mjs";

const root = resolve(__dirname, "..");
const allDetectors = [...SECRET_DETECTORS, ...OWNER_DETECTORS];

describe("scan-secrets gate is clean on the public surface (E13-T8)", () => {
  it("finds no secret/PII shape in tracked self-host docs + web pages", () => {
    const files = listTrackedFiles(PUBLIC_GLOBS).filter((f: string) => f !== ".env.example");
    const errors: string[] = [];
    for (const file of files) scanFile(file, errors, allDetectors);
    expect(errors, errors.join("\n")).toEqual([]);
    // Sanity: it is actually scanning something (not a no-op glob).
    expect(files.length).toBeGreaterThan(0);
  });
});

describe("scan-secrets detectors actually catch real shapes (E13-T8)", () => {
  function matches(line: string): string[] {
    return allDetectors.filter((d) => d.re.test(line)).map((d) => d.name);
  }

  function fixture(parts: string[]): string {
    return parts.join("_");
  }

  it("catches a planted Stripe live key", () => {
    const planted = `STRIPE_SECRET_KEY=${fixture(["sk", "live", "abc123def456ghi789jkl012"])}`;
    expect(matches(planted)).toContain("Stripe live secret key");
  });

  it("catches a Stripe webhook signing secret and an AWS access key id", () => {
    const webhookSecret = fixture(["whsec", "0123456789abcdef0123456789abcdef"]);
    expect(matches(webhookSecret)).toContain("Stripe webhook signing secret");
    expect(matches("AKIAIOSFODNN7EXAMPLE")).toContain("AWS access key id");
  });

  it("catches owner-specific identifiers", () => {
    expect(matches("scope: ansar-ullah-anas-projects")).toContain("owner Vercel scope");
    expect(matches("perceptive-guanaco-487.convex.cloud")).toContain("owner Convex prod");
    expect(matches("ceaseless-mandrill-524")).toContain("owner shared dev deployment");
  });

  it("does NOT trip on documentation illustrations (ellipsis previews)", () => {
    // The security page shows shapes like `sk_live_…1234` and `whsec_…` as
    // examples — these must not be flagged.
    expect(matches("a short key preview (sk_live_…1234) and a status")).toEqual([]);
    expect(matches("capture its whsec_… signing secret")).toEqual([]);
  });
});

describe("generic self-host docs contain no owner-specific values (E13-T8)", () => {
  const docs = [
    "docs/self-host/deploy.md",
    "docs/self-host/prerequisites.md",
    "docs/self-host/env-checklist.md",
  ];

  it("none of the generic deploy docs name the owner's deployment/scope/handle", () => {
    for (const rel of docs) {
      const text = readFileSync(resolve(root, rel), "utf8");
      for (const detector of OWNER_DETECTORS) {
        expect(detector.re.test(text), `${rel} contains ${detector.name}`).toBe(false);
      }
    }
  });
});
