import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const port = Number(process.env.PORT ?? 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const rootEnvPath = resolve(process.cwd(), ".env.local");

function readPublicEnv(name: string) {
  if (process.env[name]) {
    return process.env[name];
  }
  if (!existsSync(rootEnvPath)) {
    return undefined;
  }

  for (const rawLine of readFileSync(rootEnvPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const equalsIndex = line.indexOf("=");
    const key = line.slice(0, equalsIndex).trim();
    if (key !== name) {
      continue;
    }
    return line.slice(equalsIndex + 1).trim().replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "");
  }

  return undefined;
}

function playwrightConvexUrl() {
  const publicUrl = readPublicEnv("NEXT_PUBLIC_CONVEX_URL");
  if (publicUrl && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(publicUrl)) {
    return publicUrl;
  }
  const deployment = readPublicEnv("CONVEX_DEPLOYMENT")?.split(":").pop();
  if (deployment && /^[a-z0-9-]+$/.test(deployment)) {
    return `https://${deployment}.convex.cloud`;
  }
  return readPublicEnv("CONVEX_URL") ?? publicUrl ?? "";
}

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "docs/initiation/evidence/playwright-results",
  reporter: [["list"], ["html", { outputFolder: "docs/initiation/evidence/playwright-report", open: "never" }]],
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `pnpm --filter @openbooks/web dev --hostname 127.0.0.1 --port ${port}`,
        env: {
          ...process.env,
          NEXT_PUBLIC_CONVEX_URL: playwrightConvexUrl(),
        },
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
