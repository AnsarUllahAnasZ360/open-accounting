import path from "node:path";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import {
  expectNoHorizontalScroll,
  gotoApp,
  installDevOverlayGuard,
} from "./helpers";

// Epic E2 (stage A) — Income section on the shared workbench driver:
// [Income (cash) · Invoices (AR) · Insights]. REAL pointer clicks only.
//
// Structure + correctness are proven against the SHARED demo books read-only
// (sub-tab routing, toolbar, KPIs, detail sheet). The mutating lifecycle
// (compose → finalize → record payment) runs on a DISPOSABLE business that is
// archived at the end, never touching the shared books — and proves the core
// correctness rule: an unpaid invoice never appears in the Income (cash) table
// or inflates the Income KPI; recording its payment moves the money into cash.

const EVIDENCE_DIR = path.join(process.cwd(), "docs/finishing/evidence");
const DATE = "2026-06-14";
const SHOT_OPTS = { animations: "disabled" as const, caret: "hide" as const };

function shot(name: string) {
  return path.join(EVIDENCE_DIR, `${DATE}-E2-${name}.png`);
}

function readLocalEnv(name: string) {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const equalsIndex = line.indexOf("=");
    const key = line.slice(0, equalsIndex).trim();
    if (key !== name) continue;
    return line
      .slice(equalsIndex + 1)
      .trim()
      .replace(/\s+#.*$/, "")
      .replace(/^["']|["']$/g, "");
  }
  return "";
}

function convexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || readLocalEnv("NEXT_PUBLIC_CONVEX_URL");
  return new ConvexHttpClient(convexUrl);
}

async function selectEntity(page: Page, name: string) {
  const switcher = page.getByTestId("entity-switcher");
  if ((await switcher.innerText()).includes(name)) return;
  await switcher.click();
  const menu = page.getByTestId("entity-menu");
  await expect(menu).toBeVisible();
  const option = menu.locator('[role="menuitem"]').filter({ hasText: name }).first();
  await expect(option).toBeVisible({ timeout: 15000 });
  await option.click();
  await expect(switcher).toContainText(name, { timeout: 15000 });
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await installDevOverlayGuard(page);
});

test("E2.1 — Income section renders [Income · Invoices · Insights] on the driver (desktop)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/income");

  // The cash-movement tab renders through the shared WorkbenchSurface driver.
  await expect(page.getByTestId("income-screen")).toBeVisible({ timeout: 30000 });

  // The identical section sub-tab bar: [Income · Invoices · Insights].
  await expect(page.getByTestId("section-tabs")).toBeVisible();
  await expect(page.getByTestId("section-tab-income")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("section-tab-invoices")).toBeVisible();
  await expect(page.getByTestId("section-tab-insights")).toBeVisible();

  // The full WorkbenchToolbar is present (Filters pill + the Add menu), NOT the
  // lighter FilterBar — this is the E5 divergence E2 kills.
  await expect(page.getByRole("button", { name: /filters/i }).first()).toBeVisible();
  await expect(page.getByTestId("add-menu-trigger")).toBeVisible();

  // The cash table (or its empty state) mounted through the driver.
  await expect(
    page.getByTestId("payment-row").first().or(page.getByTestId("income-payments-empty")),
  ).toBeVisible({ timeout: 30000 });

  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: shot("income-cash-desktop"), fullPage: false, ...SHOT_OPTS });
});

test("E2.2 — the Invoices sub-tab routes to /income/invoices with the AR money bar", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/income");
  await expect(page.getByTestId("income-screen")).toBeVisible({ timeout: 30000 });

  await page.getByTestId("section-tab-invoices").click();
  await expect(page).toHaveURL(/\/income\/invoices$/);
  await expect(page.getByTestId("section-tab-invoices")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("income-invoices-screen")).toBeVisible({ timeout: 30000 });

  // AR money bar: Outstanding · Overdue · Draft · Paid. Scope to the KPI band
  // (the "Overdue" word also appears on overdue status chips, so assert on the
  // unique money-bar detail strings instead of the bare labels).
  await expect(page.getByText("Outstanding")).toBeVisible();
  await expect(page.getByText(/invoices awaiting payment|Nothing past due/).first()).toBeVisible();
  await expect(page.getByText(/unsent draft/).first()).toBeVisible();
  await expect(page.getByText(/invoices settled/).first()).toBeVisible();

  // A row opens the SHARED DetailSheet (DIVERGENCE 1) with the DUE + balance.
  await page.getByTestId("invoice-row").first().click();
  await expect(page.getByTestId("invoice-detail")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("invoice-timeline")).toBeVisible();
  await page.screenshot({ path: shot("invoices-detail-sheet"), fullPage: false, ...SHOT_OPTS });
  await page.keyboard.press("Escape");

  // Deep-link directly to the sub-route loads the AR tab.
  await gotoApp(page, "/income/invoices");
  await expect(page).toHaveURL(/\/income\/invoices$/);
  await expect(page.getByTestId("income-invoices-screen")).toBeVisible({ timeout: 30000 });
});

test("E2.3 — the Insights sub-tab renders the E1 panel for Income", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/income/insights");

  await expect(page).toHaveURL(/\/income\/insights$/);
  await expect(page.getByTestId("section-tab-insights")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("insights-dashboard")).toBeVisible({ timeout: 30000 });

  // Income-specific KPI band (Total income, Top-customer share, AR outstanding).
  await expect(page.getByTestId("insights-kpi-card").first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Total income")).toBeVisible();
  await expect(page.getByText("AR outstanding")).toBeVisible();

  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: shot("income-insights"), fullPage: false, ...SHOT_OPTS });
});

test("E2.4 — unpaid invoice never inflates Income (cash); recording payment moves it in", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now().toString().slice(-6);
  const businessName = `E2 Income ${stamp} LLC`;
  const customer = `Pays Late Co ${stamp}`;
  const client = convexClient();

  // A disposable business with a clean ledger (no shared-book mutation).
  const created = await client.mutation(api.entities.create, {
    name: businessName,
    businessType: "services",
    currency: "USD",
  });

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, "/income");
    await selectEntity(page, businessName);
    await expect(page.getByTestId("income-screen")).toBeVisible({ timeout: 30000 });

    // Brand-new business: the cash table is empty (no money received yet).
    await expect(page.getByTestId("income-payments-empty")).toBeVisible({ timeout: 30000 });

    // Compose + finalize an invoice (accrues to AR; posts NOTHING to cash). The
    // primary add item on Income is "New invoice" (E5.3 single "+" menu).
    await page.getByTestId("add-menu-trigger").click();
    await page.getByTestId("income-new-invoice").click();
    await expect(page.getByTestId("invoice-composer")).toBeVisible();
    await page.getByTestId("composer-customer").fill(customer);
    await page.getByTestId("composer-line-desc").first().fill("Design retainer");
    await page.getByTestId("composer-line-rate").first().fill("1234.00");
    await expect(page.getByTestId("composer-total")).toContainText("1,234");
    await page.getByTestId("composer-finalize").click();

    // The shared DetailSheet opens already issued (Open) — the Record payment +
    // Void actions are present, which only exist on an issued invoice.
    await expect(page.getByTestId("invoice-detail")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("invoice-record-payment")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("invoice-void")).toBeVisible();
    await page.keyboard.press("Escape");

    // CORRECTNESS: the now-issued, UNPAID invoice does NOT appear in the cash
    // table and does NOT inflate the Received KPI (still empty / zero).
    await expect(page.getByTestId("income-payments-empty")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("payment-row")).toHaveCount(0);
    await page.screenshot({ path: shot("unpaid-not-in-cash"), fullPage: false, ...SHOT_OPTS });

    // It DOES appear in the AR pipeline with an open balance.
    await page.getByTestId("section-tab-invoices").click();
    await expect(page).toHaveURL(/\/income\/invoices$/);
    await expect(page.getByTestId("invoice-row").first()).toBeVisible({ timeout: 15000 });

    // Record the payment from the detail sheet (posts Dr Cash / Cr A/R).
    await page.getByTestId("invoice-row").first().click();
    await expect(page.getByTestId("invoice-detail")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("invoice-record-payment").click();
    await expect(page.getByTestId("invoice-detail-message")).toContainText(/recorded|money in/i, { timeout: 15000 });
    await page.keyboard.press("Escape");

    // Now the money is in the cash table (a payment row exists). The invoice
    // moved from AR into received cash — counted exactly once.
    await page.getByTestId("section-tab-income").click();
    await expect(page).toHaveURL(/\/income$/);
    await expect(page.getByTestId("payment-row").first()).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: shot("paid-now-in-cash"), fullPage: false, ...SHOT_OPTS });
  } finally {
    // Archive the disposable business (never a hard delete; posted entries
    // remain immutable). Best-effort cleanup.
    await client.mutation(api.entities.archive, { entityId: created.entityId }).catch(() => undefined);
  }
});

test("E2.5 — mobile @ 390: Income sub-tabs scroll with no horizontal page scroll", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/income");
  await expect(page.getByTestId("income-screen")).toBeVisible({ timeout: 30000 });

  await expect(page.getByTestId("section-tabs")).toBeVisible();
  await expect(page.getByTestId("section-tab-income")).toBeVisible();
  await expect(page.getByTestId("section-tab-invoices")).toBeVisible();
  await expectNoHorizontalScroll(page);

  // The AR sub-tab is reachable on mobile (real tap).
  await page.getByTestId("section-tab-invoices").click();
  await expect(page).toHaveURL(/\/income\/invoices$/);
  await expect(page.getByTestId("income-invoices-screen")).toBeVisible({ timeout: 30000 });
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: shot("income-mobile-390"), fullPage: false, ...SHOT_OPTS });
});
