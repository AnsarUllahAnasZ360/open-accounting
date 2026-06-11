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

test.describe.configure({ mode: "serial" });

test("owner can run the M5 dashboard, inbox, transactions, split, and CSV loop", async ({ page }) => {
  test.setTimeout(360_000);

  await signInOwner(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await expect(page.getByTestId("demo-seed-message")).toContainText("Demo seed complete.", {
    timeout: 180_000,
  });

  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Cash position")).toBeVisible();
  await expect(page.getByText("Income by customer")).toBeVisible();
  await expect(page.getByText("Cash flow by month")).toBeVisible();
  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m5-dashboard-e2e.png",
    fullPage: true,
  });

  await page.goto("/inbox");
  const transactionBackedCard = page.locator('[data-testid="inbox-item"][data-has-transaction="true"]').first();
  await expect(transactionBackedCard).toBeVisible({ timeout: 15000 });
  await transactionBackedCard.click();
  await expect(page.getByRole("button", { name: "Always do this" })).toBeEnabled();
  await page.getByRole("button", { name: "Always do this" }).click();
  await expect(page.getByTestId("inbox-message")).toContainText("Rule saved", { timeout: 15000 });
  await page.getByTestId("inbox-confirm").click();
  await expect(page.getByTestId("inbox-message")).toContainText("confirmed", { timeout: 15000 });
  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m5-inbox-e2e.png",
    fullPage: true,
  });

  await page.goto("/transactions");
  await expect(page.getByTestId("transactions-screen")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Reconciliation")).toBeVisible();
  await expect(page.getByTestId("transaction-row").first()).toBeVisible({ timeout: 15000 });
  await page.getByTestId("transaction-row").first().click();
  await expect(page.getByTestId("transaction-drawer")).toContainText("Balanced lines");
  await expect(page.getByTestId("accounting-line").first()).toBeVisible();

  await page.getByTestId("quick-recategorize").dispatchEvent("click");
  await expect(page.getByTestId("transaction-message")).toContainText("recategorized", {
    timeout: 15000,
  });
  await expect(page.getByTestId("transaction-drawer")).toContainText("ledger.entry.reversed", {
    timeout: 15000,
  });

  await page.getByTestId("split-post").dispatchEvent("click");
  await expect(page.getByTestId("transaction-message")).toContainText("split", { timeout: 15000 });

  const merchant = `M5 manual ${Date.now()}`;
  await page.getByTestId("manual-merchant").fill(merchant);
  await page.getByTestId("manual-amount").fill("-42.00");
  await page.getByTestId("manual-add").dispatchEvent("click");
  await expect(page.getByTestId("transaction-message")).toContainText("Manual transaction imported", {
    timeout: 15000,
  });

  const csvMerchant = `M5 CSV ${Date.now()}`;
  await page.getByTestId("csv-text").fill(`date,description,amount\n2026-06-30,${csvMerchant},-25.00`);
  await page.getByTestId("csv-import").dispatchEvent("click");
  await expect(page.getByTestId("transaction-message")).toContainText("CSV row", { timeout: 15000 });
  await expect(page.getByTestId("transaction-row").filter({ hasText: csvMerchant }).first()).toBeVisible({
    timeout: 15000,
  });
  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m5-transactions-e2e.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 1100 });
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 30000 });
  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m5-core-mobile-e2e.png",
    fullPage: true,
  });
});
