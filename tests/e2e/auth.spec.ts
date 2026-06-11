import { expect, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readLocalEnv(names: string[]) {
  const env: Record<string, string> = {};
  const text = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const name = trimmed.slice(0, index).trim();
    if (!names.includes(name)) continue;
    env[name] = trimmed
      .slice(index + 1)
      .trim()
      .replace(/\s+#.*$/, "")
      .replace(/^['"]|['"]$/g, "");
  }
  return env;
}

async function signInOwner(page: Page) {
  const env = readLocalEnv(["OWNER_EMAIL", "OWNER_PASSWORD"]);
  test.skip(!env.OWNER_EMAIL || !env.OWNER_PASSWORD, "OWNER_EMAIL/OWNER_PASSWORD missing locally");

  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(env.OWNER_EMAIL);
  await page.getByLabel("Password").fill(env.OWNER_PASSWORD);
  await page.getByLabel("Name").fill("Ansar Ullah");
  await page.getByRole("button", { name: /Sign in/ }).click();
}

test("owner can sign in and land on the dashboard", async ({ page }) => {
  await signInOwner(page);

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByRole("button", { name: /^Ask AI$/ })).toBeVisible();
});

test("random email cannot self-register", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(`blocked-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("blocked-password-123");
  await page.getByRole("button", { name: /Sign in/ }).click();

  await expect(page.getByText("OpenBooks is invite-only")).toBeVisible({
    timeout: 15000,
  });
});

test("owner can review request-access leads in settings", async ({ page }) => {
  const email = `lead-${Date.now()}@example.com`;

  await page.goto("/#request-access");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Name").fill("M2 Lead");
  await page.getByLabel("Company").fill("Access Review LLC");
  await page.getByRole("textbox", { name: "What should OpenBooks help with?" }).fill("Invite-only intake evidence.");
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByText("Request saved.")).toBeVisible({ timeout: 15000 });

  await signInOwner(page);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 15000,
  });
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Request-access leads" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible({ timeout: 15000 });
});
