import { expect, type Page, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  openBooksPlaidFixtureTransactions,
  plaidEnvLabel,
  plaidModeTone,
  type PlaidEnvState,
} from "../../apps/web/src/lib/openbooks/plaid";

function writeEvidence(name: string, payload: unknown) {
  const evidenceDir = join(process.cwd(), "docs/finishing/evidence");
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, name), `${JSON.stringify(payload, null, 2)}\n`);
}

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

test("Plaid fixture mode has sandbox-safe transaction coverage", async () => {
  const missingEnv: PlaidEnvState = {
    environment: "missing",
    hasClientId: false,
    hasSecret: false,
    ready: false,
    problems: ["PLAID_CLIENT_ID is missing.", "PLAID_SECRET is missing.", "PLAID_ENV must be sandbox."],
  };

  expect(plaidModeTone(missingEnv)).toBe("fixture");
  expect(plaidEnvLabel(missingEnv)).toBe("Plaid sandbox keys are missing");
  expect(openBooksPlaidFixtureTransactions).toHaveLength(3);
  expect(openBooksPlaidFixtureTransactions.some((transaction) => transaction.amount > 0)).toBe(true);
  expect(openBooksPlaidFixtureTransactions.some((transaction) => transaction.amount < 0)).toBe(true);
  expect(openBooksPlaidFixtureTransactions.every((transaction) => transaction.personal_finance_category)).toBe(true);

  writeEvidence("2026-06-11-m9-plaid-fixture-mode.json", {
    mode: "fixture",
    transactionCount: openBooksPlaidFixtureTransactions.length,
    coversInflow: openBooksPlaidFixtureTransactions.some((transaction) => transaction.amount < 0),
    coversOutflow: openBooksPlaidFixtureTransactions.some((transaction) => transaction.amount > 0),
    capturesPersonalFinanceCategory: openBooksPlaidFixtureTransactions.every(
      (transaction) => transaction.personal_finance_category,
    ),
  });
});

test("owner can connect Plaid sandbox bypass, select accounts, sync, and simulate relink", async ({ page }) => {
  test.setTimeout(300_000);

  await signInOwner(page);
  await ensureLiveSandbox(page);

  const panel = page.getByTestId("plaid-connection-panel");
  await expect(panel).toBeVisible({ timeout: 15000 });
  await expect(panel.getByText("Bank connection")).toBeVisible();
  await expect(panel.getByRole("button", { name: /Prepare Link/ })).toBeVisible();

  await panel.getByRole("button", { name: /Prepare Link/ }).click();
  await expect(page.getByTestId("plaid-panel-message")).toContainText(/Link token|Fixture Link token/i, {
    timeout: 30000,
  });

  await panel.getByRole("button", { name: /Use sandbox bypass/ }).click();
  await expect(page.getByTestId("plaid-account-selection")).toBeVisible({ timeout: 120000 });
  await expect(page.getByTestId("plaid-account-selection").getByText(/ending/i).first()).toBeVisible();

  await panel.getByRole("button", { name: /Create selected/ }).click();
  await expect(page.getByTestId("plaid-panel-message")).toContainText(/Plaid account|refreshed account selection/i, {
    timeout: 30000,
  });
  await expect(page.getByTestId("plaid-connected-accounts")).toBeVisible({ timeout: 30000 });

  await panel.getByRole("button", { name: /Sync fixture/ }).click();
  await expect(page.getByTestId("plaid-panel-message")).toContainText(/Synced|duplicates/i, {
    timeout: 120000,
  });
  await expect(page.getByTestId("plaid-recent-transactions")).toContainText(/Notion|Client ACH|Plaid Sandbox Bank/i, {
    timeout: 30000,
  });
  await expect(page.getByTestId("plaid-recent-transactions")).toContainText("Plaid prior");

  await panel.getByRole("button", { name: /Simulate relink/ }).click();
  await expect(page.getByTestId("plaid-connection-issues")).toContainText(/needs you to sign in again/i, {
    timeout: 30000,
  });

  await page.screenshot({
    path: "docs/finishing/evidence/2026-06-11-m9-plaid-settings-e2e.png",
    fullPage: true,
  });
});
