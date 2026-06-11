#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env.local");
const port = Number(process.env.SEED_DEMO_PORT ?? process.env.PORT ?? 3100);
const baseURL = process.env.SEED_DEMO_BASE_URL ?? `http://127.0.0.1:${port}`;

function parseEnvFile(path) {
  const env = {};
  if (!existsSync(path)) return env;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const equalsIndex = line.indexOf("=");
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    env[key] = value.replace(/\\n/g, "\n");
  }
  return env;
}

function convexUrl(env) {
  const publicUrl = env.NEXT_PUBLIC_CONVEX_URL;
  if (publicUrl && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(publicUrl)) {
    return publicUrl;
  }
  const deployment = env.CONVEX_DEPLOYMENT?.split(":").pop();
  if (deployment && /^[a-z0-9-]+$/.test(deployment)) {
    return `https://${deployment}.convex.cloud`;
  }
  return env.CONVEX_URL ?? publicUrl;
}

async function isServerReady() {
  try {
    const response = await fetch(baseURL, { method: "GET" });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    if (await isServerReady()) return;
    if (child?.exitCode !== null) {
      throw new Error("The OpenBooks web server exited before it became ready.");
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`Timed out waiting for ${baseURL}.`);
}

function textNumber(text) {
  return text.replace(/[^\d.-]/g, "");
}

const fileEnv = parseEnvFile(envPath);
const mergedEnv = { ...fileEnv, ...process.env };
const required = ["OWNER_EMAIL", "OWNER_PASSWORD"];
for (const key of required) {
  if (!mergedEnv[key]) {
    throw new Error(`${key} is required in .env.local or the shell environment.`);
  }
}
const nextPublicConvexUrl = convexUrl(mergedEnv);
if (!nextPublicConvexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL or CONVEX_DEPLOYMENT is required to seed demo data.");
}

let server;
let browser;
try {
  if (!(await isServerReady())) {
    server = spawn(
      "pnpm",
      ["--filter", "@openbooks/web", "dev", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: root,
        env: {
          ...process.env,
          ...fileEnv,
          NEXT_PUBLIC_CONVEX_URL: nextPublicConvexUrl,
          PORT: String(port),
        },
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
    await waitForServer(server);
  }

  browser = await chromium.launch({ headless: process.env.SEED_DEMO_HEADED !== "1" });
  const page = await browser.newPage({ baseURL });
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(mergedEnv.OWNER_EMAIL);
  await page.getByLabel("Password").fill(mergedEnv.OWNER_PASSWORD);
  await page.getByLabel("Name").fill("Ansar Ullah");
  await page.getByRole("button", { name: /Sign in/ }).click();
  await page.getByRole("heading", { name: "Dashboard" }).waitFor({ timeout: 20_000 });

  await page.goto("/settings");
  await page.getByRole("button", { name: "Reset demo data" }).click();
  const message = page.getByTestId("demo-seed-message");
  await message.waitFor({ timeout: 180_000 });
  const messageText = (await message.textContent())?.replace(/\s+/g, " ").trim() ?? "";
  if (!messageText.includes("Demo seed complete.")) {
    throw new Error(`Demo seed did not complete: ${messageText || "no status message"}`);
  }

  const [transactions, posted, inbox, evalLabels, trialBalance] = await Promise.all([
    page.getByTestId("demo-seed-transactions").textContent(),
    page.getByTestId("demo-seed-posted").textContent(),
    page.getByTestId("demo-seed-inbox").textContent(),
    page.getByTestId("demo-seed-eval").textContent(),
    page.getByTestId("demo-seed-trial-balance").textContent(),
  ]);

  console.log(
    [
      "Demo seed complete",
      `transactions=${textNumber(transactions ?? "")}`,
      `posted=${textNumber(posted ?? "")}`,
      `inbox=${textNumber(inbox ?? "")}`,
      `evalLabels=${textNumber(evalLabels ?? "")}`,
      `trialBalance=${(trialBalance ?? "").replace(/\s+/g, " ").trim()}`,
    ].join(" | "),
  );
} finally {
  await browser?.close();
  if (server) {
    server.kill("SIGTERM");
  }
}
