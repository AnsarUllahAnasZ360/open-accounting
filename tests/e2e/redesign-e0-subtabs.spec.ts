import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalScroll,
  gotoApp,
  installDevOverlayGuard,
  visibleByTestId,
} from "./helpers";

// Epic E0 (stage B) — Transactions reference migration + section sub-tab nav.
// Proves the config-driven driver + SectionTabs contract on the reference
// surface: the [Transactions · Insights] sub-tab bar, URL routing, deep-links,
// browser Back, filter persistence across a sub-tab switch, and the mobile
// scrollable bar. REAL pointer clicks only (no dispatchEvent / force). Read-only
// navigation flows — the shared demo books are never mutated.

const EVIDENCE_DIR = path.join(process.cwd(), "docs/finishing/evidence");
const DATE = "2026-06-14";
const SHOT_OPTS = { animations: "disabled" as const, caret: "hide" as const };

function shot(name: string) {
  return path.join(EVIDENCE_DIR, `${DATE}-E0-${name}.png`);
}

test.describe.configure({ mode: "default" });

test.beforeEach(async ({ page }) => {
  await installDevOverlayGuard(page);
});

test("E0.1 — Transactions register renders the [Transactions · Insights] sub-tab bar (desktop)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/transactions");

  // The register (config-driven driver output) is present.
  await expect(visibleByTestId(page, "transactions-screen")).toBeVisible({ timeout: 30000 });

  // The section sub-tab bar sits directly under the page header.
  const tabs = page.getByTestId("section-tabs");
  await expect(tabs).toBeVisible();
  const txTab = page.getByTestId("section-tab-transactions");
  const insightsTab = page.getByTestId("section-tab-insights");
  await expect(txTab).toBeVisible();
  await expect(insightsTab).toBeVisible();

  // Default sub-tab is the cash-movement (Transactions) tab.
  await expect(txTab).toHaveAttribute("aria-current", "page");
  await expect(insightsTab).not.toHaveAttribute("aria-current", "page");

  // The driver's toolbar (saved views + filter pills) and one-line insight banner
  // render above the fixed/scroll table region (parity with the prior inline shell).
  await expect(page.getByRole("button", { name: /filters/i }).first()).toBeVisible();

  // The table region renders through the driver: either seeded rows (when the
  // demo entity is active) OR the register empty state (a fresh/empty entity).
  // Both prove the config-driven table shell mounted; the row data depends on
  // which workspace entity is selected and must not gate this structural proof.
  const rows = page.getByTestId("transaction-row");
  const emptyState = page.getByTestId("transactions-empty");
  await expect(rows.first().or(emptyState)).toBeVisible({ timeout: 30000 });

  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: shot("transactions-register-desktop"), fullPage: false, ...SHOT_OPTS });
});

test("E0.2 — clicking the Insights tab routes to /transactions/insights and renders insights", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/transactions");
  await expect(visibleByTestId(page, "transactions-screen")).toBeVisible({ timeout: 30000 });

  // Real click on the Insights sub-tab.
  await page.getByTestId("section-tab-insights").click();
  await expect(page).toHaveURL(/\/transactions\/insights$/);

  // The active tab moved; the register is gone and the insights dashboard renders.
  await expect(page.getByTestId("section-tab-insights")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("insights-dashboard")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("transactions-screen")).toHaveCount(0);

  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: shot("transactions-insights-subtab"), fullPage: false, ...SHOT_OPTS });

  // Browser Back returns to the register.
  await page.goBack();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(visibleByTestId(page, "transactions-screen")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("section-tab-transactions")).toHaveAttribute("aria-current", "page");
});

test("E0.3 — deep-linking /transactions/insights loads the Insights sub-tab directly", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/transactions/insights");

  await expect(page).toHaveURL(/\/transactions\/insights$/);
  await expect(page.getByTestId("insights-dashboard")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("section-tab-insights")).toHaveAttribute("aria-current", "page");

  await page.screenshot({ path: shot("subtab-nav-proof"), fullPage: false, ...SHOT_OPTS });
});

test("E0.4 — a register filter survives switching to Insights and back (URL query state)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  // Seed a register filter via the URL query the screen mirrors (search term).
  // The cash-movement tab reads `q` on mount, and the insight switch keeps the
  // query string across the path-only sub-tab navigation.
  await gotoApp(page, "/transactions?q=stripe");
  await expect(visibleByTestId(page, "transactions-screen")).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveURL(/[?&]q=stripe/);

  // Switch to Insights — the query string is carried across the sub-tab path.
  await page.getByTestId("section-tab-insights").click();
  await expect(page).toHaveURL(/\/transactions\/insights\?.*q=stripe/);

  // Switch back to the register — the filter is still applied.
  await page.getByTestId("section-tab-transactions").click();
  await expect(page).toHaveURL(/\/transactions\?.*q=stripe/);
  await expect(visibleByTestId(page, "transactions-screen")).toBeVisible({ timeout: 30000 });
});

test("E0.6 — the migrated toolbar's Add menu opens the manual-entry dialog (config primaryActions wiring)", async ({
  page,
}) => {
  // Parity proof that the register's primary actions still work through the
  // config-driven driver. The manual-entry form lives in the Add dialog (opened
  // via the toolbar "+" menu); this is a read-only open+cancel — it never submits,
  // so the shared demo books are never mutated.
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/transactions");
  await expect(visibleByTestId(page, "transactions-screen")).toBeVisible({ timeout: 30000 });

  // Open the Add menu (the green "+" primary action) and choose Add transaction.
  await page.getByTestId("add-menu-trigger").click();
  await page.getByTestId("add-menu-add-transaction").click();

  // The manual-entry fields are now reachable (the config primaryActions →
  // setAddOpen → AddTransactionDialog path survived the migration).
  await expect(page.getByTestId("manual-merchant")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("manual-amount")).toBeVisible();
  await expect(page.getByTestId("manual-add")).toBeVisible();

  // Close without submitting — no ledger write, no mutation of shared books.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("manual-merchant")).toBeHidden({ timeout: 10000 });
});

test("E0.7 — Expenses → Insights → Bills (AP) renders the real insights panel (no stub)", async ({
  page,
}) => {
  // E8-T5/T9: the Bills (AP) Insights must render a real E1 panel, not the old
  // "Coming in this pass" stub. Bills lives as a ledger sub-tab under Expenses,
  // so its analytics live on the Expenses Insights tab behind a quiet toggle.
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/expenses/insights");

  await expect(page).toHaveURL(/\/expenses\/insights$/);
  // The default (Spending) view is a real insights panel.
  await expect(page.getByTestId("insights-dashboard")).toBeVisible({ timeout: 30000 });

  // Switch to the Bills (AP) view — still a real panel, never the stub.
  const billsTab = page.getByTestId("expenses-insights-bills-tab");
  await expect(billsTab).toBeVisible();
  await billsTab.click();
  await expect(page.getByTestId("insights-dashboard")).toBeVisible({ timeout: 30000 });
  // The retired SectionInsightsStub copy must not appear.
  await expect(page.getByText(/Coming in this pass/i)).toHaveCount(0);

  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: shot("expenses-bills-insights"), fullPage: false, ...SHOT_OPTS });
});

test("E0.5 — mobile @ 390: sub-tabs render in a scrollable bar with no horizontal page scroll", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/transactions");
  await expect(visibleByTestId(page, "transactions-screen")).toBeVisible({ timeout: 30000 });

  const tabs = page.getByTestId("section-tabs");
  await expect(tabs).toBeVisible();
  await expect(page.getByTestId("section-tab-transactions")).toBeVisible();
  await expect(page.getByTestId("section-tab-insights")).toBeVisible();

  // The bar is an overflow-x-auto strip (scrollable when content exceeds width).
  const overflowX = await tabs.evaluate((el) => getComputedStyle(el).overflowX);
  expect(["auto", "scroll"]).toContain(overflowX);

  // No horizontal PAGE scroll at the mobile gate width.
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: shot("transactions-subtabs-390"), fullPage: false, ...SHOT_OPTS });

  // The Insights sub-tab is reachable on mobile too (real tap).
  await page.getByTestId("section-tab-insights").click();
  await expect(page).toHaveURL(/\/transactions\/insights$/);
  await expect(page.getByTestId("insights-dashboard")).toBeVisible({ timeout: 30000 });
  await expectNoHorizontalScroll(page);
});
