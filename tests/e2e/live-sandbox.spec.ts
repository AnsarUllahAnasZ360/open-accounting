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
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 15000,
  });
}

test("owner can create the Live Sandbox entity from Settings Businesses", async ({ page }) => {
  test.setTimeout(240_000);

  await signInOwner(page);
  await page.goto("/settings");

  if ((await page.getByTestId("live-sandbox-create").count()) === 0) {
    await page.getByRole("button", { name: "Reset demo data" }).click();
    await expect(page.getByTestId("demo-seed-message")).toContainText("Demo seed complete.", {
      timeout: 180_000,
    });
  }

  await expect(page.getByTestId("live-sandbox-create")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("live-sandbox-create").click();
  await expect(page.getByTestId("live-sandbox-message")).toContainText("Live Sandbox", {
    timeout: 120000,
  });
  await expect(page.getByTestId("business-card-live-sandbox")).toContainText("Live Sandbox", {
    timeout: 120000,
  });
  await expect(page.getByTestId("business-card-live-sandbox")).toContainText("Live");
  await expect(page.getByTestId("stripe-connection-panel")).toBeVisible({ timeout: 15000 });

  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m8-live-sandbox-settings-e2e.png",
    fullPage: true,
  });
});
