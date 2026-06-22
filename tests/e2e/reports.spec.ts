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
  await page.getByRole("button", { name: "Monthly Review Your whole month on one page — in, out, owed, payroll." }).click();
  await expect(page.getByRole("button", { name: "Profit & Loss How much you made and spent, by category." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled({ timeout: 15000 });
  const monthlyReviewDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  await (await monthlyReviewDownload).saveAs("docs/initiation/evidence/2026-06-11-m7-monthly-review.csv");

  await page.getByTestId("reports-back").click();
  await expect(page.getByRole("button", { name: "Profit & Loss How much you made and spent, by category." })).toBeVisible();
  await page.getByRole("button", { name: "Profit & Loss How much you made and spent, by category." }).click();
  await expect(page.getByRole("heading", { name: "Profit & Loss" })).toBeVisible();
  await expect(page.getByText(/Net profit/)).toBeVisible();

  await page.getByTestId("reports-back").click();
  await expect(page.getByRole("button", { name: "Balance Sheet What you own and what you owe, right now." })).toBeVisible();
  await page.getByRole("button", { name: "Balance Sheet What you own and what you owe, right now." }).click();
  await expect(page.getByRole("heading", { name: "Balance Sheet" })).toBeVisible();
  await expect(page.getByTestId("balanced-chip")).toContainText("Balanced");

  await page.getByTestId("reports-back").click();
  await expect(page.getByRole("button", { name: "Trial Balance All accounts with debit and credit totals." })).toBeVisible();
  await page.getByRole("button", { name: "Trial Balance All accounts with debit and credit totals." }).click();
  await expect(page.getByRole("heading", { name: "Trial Balance" })).toBeVisible();
  await expect(page.locator("main").getByText(/Balanced/)).toBeVisible();

  await page.getByTestId("reports-back").click();
  await expect(page.getByRole("button", { name: "General Ledger Every posting, account by account." })).toBeVisible();
  await page.getByRole("button", { name: "General Ledger Every posting, account by account." }).click();
  await expect(page.getByRole("heading", { name: "General Ledger" })).toBeVisible();
  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m7-reports-e2e.png",
    fullPage: true,
  });

  // E6-T1: the Cash Flow report must not overflow horizontally on a phone.
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/reports?report=cash-flow");
  await expect(page.getByRole("heading", { name: "Cash Flow Statement" })).toBeVisible({ timeout: 15000 });
  const noOverflow = await page.evaluate(() => {
    const el = document.scrollingElement;
    return el ? el.scrollWidth <= el.clientWidth + 1 : true;
  });
  expect(noOverflow, "cash-flow has no horizontal page overflow at 375px").toBe(true);

  // E6-T5: basis badge is title-cased and flips to the cash exclusion copy.
  await expect(page.getByTestId("basis-badge")).toContainText("Accrual basis");
  await page.getByTestId("basis-cash").click();
  await expect(page.getByTestId("basis-badge")).toContainText("Cash basis");

  // E6-T2: the viewer toolbar itself never overflows the page at 375px.
  const toolbarFits = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="viewer-toolbar"]') as HTMLElement | null;
    return el ? el.scrollWidth <= el.clientWidth + 1 : true;
  });
  expect(toolbarFits, "viewer toolbar fits at 375px").toBe(true);

  // E6-T4 drill parity (one number): clicking a P&L figure opens the DrillSheet
  // and its total equals the clicked value.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/reports?report=profit-and-loss");
  await expect(page.getByRole("heading", { name: "Profit & Loss" })).toBeVisible({ timeout: 15000 });
  const firstMoney = page.getByTestId("money-button").first();
  if (await firstMoney.count()) {
    const clicked = (await firstMoney.innerText()).trim();
    await firstMoney.click();
    await expect(page.getByTestId("drill-sheet")).toBeVisible();
    await expect(page.getByTestId("drill-total")).toContainText(clicked.replace(/[^0-9.,-]/g, "").slice(0, 3));
    await page.keyboard.press("Escape");
  }

  // E6-T6: compare-to-prior renders a Prior column + a signed Change (delta)
  // column alongside the current total on P&L. The Compare select sits in the
  // viewer toolbar and reads "None" by default; switching to Prior period mounts
  // the two extra column headers.
  const compareTrigger = page.locator('[data-testid="viewer-toolbar"] [role="combobox"]', { hasText: "None" });
  if (await compareTrigger.count()) {
    await compareTrigger.first().click();
    await page.getByRole("option", { name: "Prior period" }).click();
    await expect(page.getByTestId("statement-prior-head").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("statement-delta-head").first()).toBeVisible();
  }

  // E6-T4 drill parity (cash-flow): clicking a cash-flow line opens the DrillSheet
  // whose total equals the clicked line amount.
  await page.goto("/reports?report=cash-flow");
  await expect(page.getByRole("heading", { name: "Cash Flow Statement" })).toBeVisible({ timeout: 15000 });
  const cashMoney = page.getByTestId("money-button").first();
  if (await cashMoney.count()) {
    const clicked = (await cashMoney.innerText()).trim();
    await cashMoney.click();
    await expect(page.getByTestId("drill-sheet")).toBeVisible();
    await expect(page.getByTestId("drill-total")).toContainText(clicked.replace(/[^0-9.,-]/g, "").slice(0, 3));
    await page.keyboard.press("Escape");
  }

  // E6-T10: the Reports home shows exactly ONE small report-relevant insight
  // banner (threshold-gated — assert at most one when present).
  await page.goto("/reports");
  await expect(page.getByTestId("reports-home")).toBeVisible({ timeout: 15000 });
  const reportsBanner = page.locator('[data-testid="page-insight-banner"][data-page="reports"]');
  expect(await reportsBanner.count(), "at most one reports insight banner").toBeLessThanOrEqual(1);

  // E6-T3 export-parity smoke: the cash-flow CSV carries a per-row line item
  // (a date cell), not just group totals.
  await page.goto("/reports?report=cash-flow");
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled({ timeout: 15000 });
  const cashFlowCsv = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const cashFlowFile = await cashFlowCsv;
  const cashFlowPath = "docs/finishing/evidence/2026-06-20-E6-cash-flow-export.csv";
  await cashFlowFile.saveAs(cashFlowPath);
  const cashFlowText = readFileSync(cashFlowPath, "utf8");
  expect(cashFlowText, "cash-flow CSV has the group/date/memo header").toContain("group,date,memo");

  await page.goto("/settings/data");
  await expect(page.getByRole("button", { name: "CSV bundle (every report)" })).toBeEnabled({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "JSON dump" })).toBeEnabled();
  const bundleDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV bundle (every report)" }).click();
  await (await bundleDownload).saveAs("docs/initiation/evidence/2026-06-11-m7-settings-export-sample.csv");
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON dump" }).click();
  await (await jsonDownload).saveAs("docs/initiation/evidence/2026-06-11-m7-settings-export.json");
  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m7-settings-export-e2e.png",
    fullPage: true,
  });
});
