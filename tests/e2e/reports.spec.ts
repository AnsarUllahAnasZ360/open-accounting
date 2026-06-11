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

test("owner can render ledger-backed reports and export from reports/settings", async ({ page }) => {
  test.setTimeout(180_000);

  await signInOwner(page);

  await page.goto("/reports");
  await expect(page.getByTestId("reports-screen")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Profit & Loss Income, expenses, and net profit." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled({ timeout: 15000 });
  const monthlyReviewDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  await (await monthlyReviewDownload).saveAs("docs/initiation/evidence/2026-06-11-m7-monthly-review.csv");

  await page.getByRole("button", { name: "Profit & Loss Income, expenses, and net profit." }).click();
  await expect(page.getByRole("heading", { name: "Profit & Loss" })).toBeVisible();
  await expect(page.getByText("Net profit:")).toBeVisible();

  await page.getByRole("button", { name: "Balance Sheet Assets, liabilities, and equity." }).click();
  await expect(page.getByRole("heading", { name: "Balance Sheet" })).toBeVisible();
  await expect(page.getByText("Balanced", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Trial Balance Debit and credit check." }).click();
  await expect(page.getByRole("heading", { name: "Trial Balance" })).toBeVisible();
  await expect(page.getByText("Difference 0")).toBeVisible();

  await page.getByRole("button", { name: "General Ledger Account activity line by line." }).click();
  await expect(page.getByRole("heading", { name: "General Ledger" })).toBeVisible();
  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m7-reports-e2e.png",
    fullPage: true,
  });

  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Export CSV bundle" })).toBeEnabled({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Export JSON" })).toBeEnabled();
  const bundleDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV bundle" }).click();
  await (await bundleDownload).saveAs("docs/initiation/evidence/2026-06-11-m7-settings-export-sample.csv");
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  await (await jsonDownload).saveAs("docs/initiation/evidence/2026-06-11-m7-settings-export.json");
  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m7-settings-export-e2e.png",
    fullPage: true,
  });
});
