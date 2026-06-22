import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalScroll,
  installDevOverlayGuard,
} from "./helpers";

// Epic 4 evidence: Income and Expenses surfaces at gate widths + tab variants.
// Capture-only spec. Does NOT edit product code; reuses the running :3100 server.
// Uses localhost (not 127.0.0.1) to match the preview server hostname, which
// matters for Convex WebSocket auth routing.

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "docs/finishing/evidence/epic4",
);
const DATE = "2026-06-13";

function shot(name: string) {
  return path.join(EVIDENCE_DIR, `${DATE}-${name}.png`);
}

const SHOT_OPTS = { animations: "disabled" as const, caret: "hide" as const };

const WIDTHS = [390, 768, 1306, 1440, 1758] as const;

// Helper: navigate to app and wait for it to fully load.
// Uses localhost:3100 explicitly, waits for the workspace loading spinner to
// disappear and the sidebar to mount. Falls back to just waiting for sidebar
// with extended timeout.
async function gotoAppReady(
  page: Parameters<typeof installDevOverlayGuard>[0],
  route: string,
) {
  // Navigate using localhost hostname (matches preview server and Convex auth)
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.goto(`http://localhost:3100${route}`);
    const hasError = await page
      .locator("body")
      .filter({ hasText: /500|Internal Server Error/ })
      .count();
    if (hasError === 0) break;
    if (attempt < 4) await page.waitForTimeout(5000);
  }

  // Wait for the sidebar to appear (Convex workspace loaded)
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 90000 });
}

test.setTimeout(120000);

test.beforeEach(async ({ page }) => {
  await installDevOverlayGuard(page);
});

// ─── Income: default (Payments) tab at all five gate widths ───────────────────

for (const width of WIDTHS) {
  const height = width === 390 ? 844 : 900;
  test(`income @ ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await gotoAppReady(page, "/income");
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByTestId("income-screen")).toBeVisible({
      timeout: 30000,
    });
    await page.waitForTimeout(300);
    await expectNoHorizontalScroll(page, width);
    await page.screenshot({
      path: shot(`epic4-income-${width}`),
      fullPage: false,
      ...SHOT_OPTS,
    });
  });
}

// ─── Income: non-default sub-tabs at 1440 and 390 ─────────────────────────────
// Income is now [Income · Invoices · Insights] on the shared driver (Epic E2),
// reached via the section-tab bar — not the old Radix content tabs (Customers /
// Streams / Receivables were folded into Insights). Each sub-tab is its own
// deep-linkable route.

const INCOME_SUBTABS = [
  { tab: "section-tab-invoices", ready: "income-invoices-screen", name: "invoices" },
  { tab: "section-tab-insights", ready: "insights-dashboard", name: "insights" },
] as const;

for (const { tab, ready, name } of INCOME_SUBTABS) {
  for (const width of [1440, 390] as const) {
    const height = width === 390 ? 844 : 900;
    test(`income-subtab-${name} @ ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await gotoAppReady(page, "/income");
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(page.getByTestId("income-screen")).toBeVisible({
        timeout: 30000,
      });
      await page.waitForTimeout(300);

      // Click the section sub-tab (real Playwright click) and wait for the
      // sub-tab's surface to mount.
      await page.getByTestId(tab).click();
      await expect(page.getByTestId(ready)).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(400);

      await expectNoHorizontalScroll(page, width);
      await page.screenshot({
        path: shot(`epic4-income-${name}-${width}`),
        fullPage: false,
        ...SHOT_OPTS,
      });
    });
  }
}

// ─── Expenses: default (Transactions) tab at all five gate widths ─────────────

for (const width of WIDTHS) {
  const height = width === 390 ? 844 : 900;
  test(`expenses @ ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await gotoAppReady(page, "/expenses");
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByTestId("expenses-screen")).toBeVisible({
      timeout: 30000,
    });
    await page.waitForTimeout(300);
    await expectNoHorizontalScroll(page, width);
    await page.screenshot({
      path: shot(`epic4-expenses-${width}`),
      fullPage: false,
      ...SHOT_OPTS,
    });
  });
}

// ─── Expenses: non-default sub-tabs at 1440 and 390 ───────────────────────────
// Expenses is now [Expenses · Bills · Insights] on the shared driver (Epic E3),
// reached via the section-tab bar — not the old Radix content tabs (Categories /
// Vendors / Recurring / Evidence were folded into Insights + the missing-receipt
// saved view). Each sub-tab is its own deep-linkable route.

const EXPENSES_SUBTABS = [
  { tab: "section-tab-bills", route: "/expenses/bills", ready: "expenses-bills-screen", name: "bills" },
  { tab: "section-tab-insights", route: "/expenses/insights", ready: "insights-dashboard", name: "insights" },
] as const;

for (const { tab, ready, name } of EXPENSES_SUBTABS) {
  for (const width of [1440, 390] as const) {
    const height = width === 390 ? 844 : 900;
    test(`expenses-subtab-${name} @ ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await gotoAppReady(page, "/expenses");
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(page.getByTestId("expenses-screen")).toBeVisible({
        timeout: 30000,
      });
      await page.waitForTimeout(300);

      // Click the section sub-tab (real Playwright click) and wait for the
      // sub-tab's surface to mount.
      await page.getByTestId(tab).click();
      await expect(page.getByTestId(ready)).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(400);

      await expectNoHorizontalScroll(page, width);
      await page.screenshot({
        path: shot(`epic4-expenses-${name}-${width}`),
        fullPage: false,
        ...SHOT_OPTS,
      });
    });
  }
}
