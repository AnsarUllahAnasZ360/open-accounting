import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["tests/**/*.test.ts", "convex/**/*.test.ts", "apps/web/src/**/*.test.ts"],
    passWithNoTests: true,
    // Many convex-test integration tests seed a full workspace and routinely run
    // 10–20s; 20s left several within a whisker of flaking on CI. The two
    // >5,000-line ledger tests override this further inline.
    testTimeout: 60_000,
  },
});
