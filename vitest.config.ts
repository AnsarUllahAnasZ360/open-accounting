import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["tests/**/*.test.ts", "convex/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 20_000,
  },
});
