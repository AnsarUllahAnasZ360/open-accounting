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

async function ensureLiveSandbox(page: Page) {
  await page.goto("/settings");
  await expect(page.getByTestId("live-sandbox-create")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("live-sandbox-create").click();
  await expect(page.getByTestId("business-card-live-sandbox")).toContainText("Live Sandbox", {
    timeout: 120000,
  });
}

test("owner can run the M8 Stripe test-mode or fixture sync on Live Sandbox", async ({ page }) => {
  test.setTimeout(360_000);

  await signInOwner(page);
  await ensureLiveSandbox(page);

  const panel = page.getByTestId("stripe-connection-panel");
  await expect(panel).toBeVisible({ timeout: 15000 });
  await expect(panel).toContainText("Stripe test mode");
  await expect(panel).toContainText("Live Sandbox");

  await panel.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByTestId("stripe-action-message")).toContainText(/Stripe|fixture/i, {
    timeout: 30000,
  });

  await panel.getByRole("button", { name: "Seed test data" }).click();
  await expect(page.getByTestId("stripe-action-message")).toContainText("Seed complete.", {
    timeout: 120000,
  });

  await panel.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByTestId("stripe-action-message")).toContainText("Sync complete.", {
    timeout: 120000,
  });
  await expect(panel.getByText("Payout reconciliation", { exact: true })).toBeVisible();
  await expect(panel.getByText(/drift/i).first()).toBeVisible();

  await panel.getByRole("button", { name: "Send via Stripe" }).click();
  await expect(page.getByTestId("stripe-action-message")).toContainText(/invoice|Stripe/i, {
    timeout: 120000,
  });

  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m8-stripe-settings-e2e.png",
    fullPage: true,
  });
});
