import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalScroll,
  installDevOverlayGuard,
} from "./helpers";

// Epic 3 evidence: Transactions, Inbox, and Dashboard surfaces at gate widths.
// Capture-only spec. Does NOT edit product code; reuses the running :3100 server.
// Uses localhost (not 127.0.0.1) to match the preview server hostname, which
// matters for Convex WebSocket auth routing.

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "docs/finishing/evidence/epic3",
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

// ─── Dashboard ────────────────────────────────────────────────────────────────

for (const width of WIDTHS) {
  const height = width === 390 ? 844 : 900;
  test(`dashboard @ ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await gotoAppReady(page, "/dashboard");
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByTestId("dashboard-screen")).toBeVisible({
      timeout: 30000,
    });
    await page.waitForTimeout(300);
    await expectNoHorizontalScroll(page, width);
    await page.screenshot({
      path: shot(`epic3-dashboard-${width}`),
      fullPage: false,
      ...SHOT_OPTS,
    });
  });
}

// ─── Transactions ─────────────────────────────────────────────────────────────

for (const width of WIDTHS) {
  const height = width === 390 ? 844 : 900;
  test(`transactions @ ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await gotoAppReady(page, "/transactions");
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByTestId("transactions-screen")).toBeVisible({
      timeout: 30000,
    });
    await page.waitForTimeout(300);
    await expectNoHorizontalScroll(page, width);
    await page.screenshot({
      path: shot(`epic3-transactions-${width}`),
      fullPage: false,
      ...SHOT_OPTS,
    });
  });
}

// ─── Transactions detail drawer @ 1440 ────────────────────────────────────────

test("transactions-detail @ 1440", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAppReady(page, "/transactions");
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByTestId("transactions-screen")).toBeVisible({
    timeout: 30000,
  });

  const rows = page.getByTestId("transaction-row");
  await page.waitForTimeout(1000);
  const rowCount = await rows.count();
  if (rowCount > 0) {
    const firstRow = rows.first();
    const cellCount = await firstRow.locator("td").count();
    if (cellCount > 2) {
      await firstRow.locator("td").nth(2).click();
    } else {
      await firstRow.click();
    }
    await expect(page.getByTestId("transaction-drawer")).toBeVisible({
      timeout: 15000,
    });
    await page.waitForTimeout(400);
    await expectNoHorizontalScroll(page, 1440);
    await page.screenshot({
      path: shot("epic3-transactions-detail-1440"),
      fullPage: false,
      ...SHOT_OPTS,
    });
  } else {
    await page.screenshot({
      path: shot("epic3-transactions-detail-1440"),
      fullPage: false,
      ...SHOT_OPTS,
    });
  }
});

// ─── Inbox ────────────────────────────────────────────────────────────────────

for (const width of WIDTHS) {
  const height = width === 390 ? 844 : 900;
  test(`inbox @ ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await gotoAppReady(page, "/inbox");
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByTestId("inbox-list")).toBeVisible({
      timeout: 30000,
    });
    await page.waitForTimeout(300);
    await expectNoHorizontalScroll(page, width);
    await page.screenshot({
      path: shot(`epic3-inbox-${width}`),
      fullPage: false,
      ...SHOT_OPTS,
    });
  });
}

// ─── Inbox mobile item selected @ 390 ────────────────────────────────────────

test("inbox-item-selected @ 390", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoAppReady(page, "/inbox");
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: 30000 });

  const items = page.getByTestId("inbox-item");
  const itemCount = await items.count();
  if (itemCount > 0) {
    await items.first().click();
    await page.waitForTimeout(600);
    await expectNoHorizontalScroll(page, 390);
    await page.screenshot({
      path: shot("epic3-inbox-item-selected-390"),
      fullPage: false,
      ...SHOT_OPTS,
    });
  } else {
    await page.screenshot({
      path: shot("epic3-inbox-item-selected-390"),
      fullPage: false,
      ...SHOT_OPTS,
    });
  }
});
