import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// E13-T3: dev:full must work for a fresh self-hoster — it triggers setup when
// .env.local is incomplete, accepts any non-localhost cloud Convex URL (the
// self-hoster's OWN deployment), and points at `pnpm setup` instead of throwing
// a bare error. The README/local-boot story must be generic (no shared
// owner-specific deployment).
import { assertCloudConvex, needsSetup } from "../scripts/dev-full.mjs";

const root = resolve(__dirname, "..");

describe("dev:full setup detection (E13-T3)", () => {
  it("needsSetup is true when required env is missing", () => {
    expect(needsSetup({})).toBe(true);
    expect(needsSetup({ JWT_PRIVATE_KEY: "x" })).toBe(true);
    // Missing the encryption key still triggers setup.
    expect(
      needsSetup({
        JWT_PRIVATE_KEY: "x",
        JWKS: "x",
        CONVEX_DEPLOYMENT: "dev:foo",
        NEXT_PUBLIC_CONVEX_URL: "https://foo.convex.cloud",
      }),
    ).toBe(true);
  });

  it("needsSetup is false once a complete env exists", () => {
    expect(
      needsSetup({
        JWT_PRIVATE_KEY: "x",
        JWKS: "x",
        CONVEX_DEPLOYMENT: "dev:foo",
        NEXT_PUBLIC_CONVEX_URL: "https://foo.convex.cloud",
        OPENBOOKS_SECRET_ENCRYPTION_KEY: "k",
      }),
    ).toBe(false);
    // Legacy encryption key name also satisfies it.
    expect(
      needsSetup({
        JWT_PRIVATE_KEY: "x",
        JWKS: "x",
        CONVEX_DEPLOYMENT: "dev:foo",
        NEXT_PUBLIC_CONVEX_URL: "https://foo.convex.cloud",
        OPENBOOKS_TOKEN_ENCRYPTION_KEY: "k",
      }),
    ).toBe(false);
  });
});

describe("assertCloudConvex self-host behavior (E13-T3)", () => {
  it("accepts a self-hoster's own non-localhost cloud Convex URL", () => {
    expect(() => assertCloudConvex("https://my-own-deployment.convex.cloud")).not.toThrow();
  });

  it("points at pnpm setup when the URL is missing (not a bare throw)", () => {
    expect(() => assertCloudConvex("")).toThrow(/pnpm setup/);
  });

  it("still rejects a localhost Convex URL", () => {
    expect(() => assertCloudConvex("http://localhost:3210")).toThrow(/localhost/);
  });
});

describe("README local boot is generic (E13-T3)", () => {
  const readme = readFileSync(resolve(root, "README.md"), "utf8");

  it("contains no shared/owner-specific Convex deployment reference", () => {
    for (const needle of ["ceaseless-mandrill", "perceptive-guanaco", "ansarullahanas"]) {
      expect(readme.toLowerCase()).not.toContain(needle);
    }
  });

  it("walks the generic clone → setup → run path", () => {
    expect(readme).toContain("pnpm install");
    expect(readme).toContain("pnpm setup");
    expect(readme).toContain("pnpm dev:full");
  });
});
