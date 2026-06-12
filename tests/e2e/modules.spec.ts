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

async function ensureDemoData(page: Page) {
  await page.goto("/contacts");
  await expect(page.getByTestId("contact-row").first()).toBeVisible({ timeout: 30000 });
}

test.describe.configure({ mode: "serial" });

test("owner can browse M6 contacts, AR, AP, payroll, and settings modules", async ({ page }) => {
  test.setTimeout(360_000);

  await signInOwner(page);
  await ensureDemoData(page);

  await page.goto("/settings");
  await expect(page.getByTestId("m6-settings-screen")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Businesses", { exact: true })).toBeVisible();
  await expect(page.getByText("Rules manager", { exact: true })).toBeVisible();
  await expect(page.getByText("Audit log", { exact: true })).toBeVisible();
  await expect(page.getByTestId("audit-row").first()).toBeVisible();
  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m6-settings-e2e.png",
    fullPage: true,
  });

  await page.goto("/contacts");
  await expect(page.getByTestId("m6-contacts-screen")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("contact-row").first()).toBeVisible();
  await expect(page.getByTestId("contact-profile")).toContainText("Default category as rule");
  await expect(page.getByTestId("contact-profile")).toContainText("Merge duplicates");
  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m6-contacts-e2e.png",
    fullPage: true,
  });

  // /invoices redirects to /income (Epic A3); Epic C replaced the old invoices
  // screen with the Income screen (Payments / Invoices / Receivables tabs).
  await page.goto("/income");
  await expect(page.getByTestId("income-screen")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("income-tab-invoices").click();
  await expect(page.getByTestId("invoice-row").first()).toBeVisible();
  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m6-invoices-e2e.png",
    fullPage: true,
  });

  await page.goto("/bills");
  await expect(page.getByTestId("m6-bills-screen")).toBeVisible({ timeout: 15000 });
  // Epic C5: bills carry a Mark paid settlement flow. Selecting a bill shows its
  // summary; opening the match picker lists suggested bank transactions.
  await expect(page.getByText("Selected bill")).toBeVisible();
  await expect(page.getByTestId("bill-row").first()).toBeVisible();
  await page.getByTestId("bill-row").first().getByRole("button").first().click();
  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m6-bills-e2e.png",
    fullPage: true,
  });

  await page.goto("/payroll");
  await expect(page.getByTestId("m6-payroll-screen")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("USD payroll")).toBeVisible();
  await expect(page.getByText("PKR payroll")).toBeVisible();
  await expect(page.getByText("INR payroll")).toBeVisible();
  await page.getByRole("button", { name: "statement" }).click();
  await expect(page.getByText("Printable statement")).toBeVisible();
  await expect(page.getByRole("button", { name: "CSV" })).toBeEnabled();
  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m6-payroll-e2e.png",
    fullPage: true,
  });
});
