import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalScroll,
  installDevOverlayGuard,
} from "./helpers";

// Epic 5 evidence: Bills AP workbench + Contacts directory at gate widths.
// Capture-only spec. Does NOT edit product code; reuses the running :3100 server.
// Uses localhost (not 127.0.0.1) to match the preview server hostname, which
// matters for Convex WebSocket auth routing.

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "docs/finishing/evidence/epic5",
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
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.goto(`http://localhost:3100${route}`);
    const hasError = await page
      .locator("body")
      .filter({ hasText: /500|Internal Server Error/ })
      .count();
    if (hasError === 0) break;
    if (attempt < 5) await page.waitForTimeout(5000);
  }

  // Wait for the sidebar to appear (Convex workspace loaded)
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 90000 });
}

test.setTimeout(120000);

test.beforeEach(async ({ page }) => {
  await installDevOverlayGuard(page);
});

// ─── Bills: all five gate widths ─────────────────────────────────────────────

for (const width of WIDTHS) {
  const height = width === 390 ? 844 : 900;
  test(`bills @ ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await gotoAppReady(page, "/expenses/bills");
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByTestId("expenses-bills-screen")).toBeVisible({
      timeout: 30000,
    });
    await page.waitForTimeout(300);
    await expectNoHorizontalScroll(page, width);
    await page.screenshot({
      path: shot(`epic5-bills-${width}`),
      fullPage: false,
      ...SHOT_OPTS,
    });
  });
}

// ─── Bills detail at 1440: row click opens DetailSheet ────────────────────────

test("bills-detail @ 1440", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAppReady(page, "/expenses/bills");
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByTestId("expenses-bills-screen")).toBeVisible({
    timeout: 30000,
  });

  // Click an OPEN bill (a row exposing the inline Pay action) so the detail
  // sheet shows the Mark paid & match footer. Paid bills open the same sheet
  // without that action, so target an open one explicitly.
  await page.waitForTimeout(1000);
  const openRow = page.getByTestId("bill-row").filter({ has: page.getByTestId("bill-mark-paid") }).first();
  if ((await openRow.count()) > 0) {
    await openRow.click();
    await expect(page.getByTestId("bill-detail-mark-paid")).toBeVisible({
      timeout: 15000,
    });
    await page.waitForTimeout(400);
    await expectNoHorizontalScroll(page, 1440);
    await page.screenshot({
      path: shot("epic5-bills-detail-1440"),
      fullPage: false,
      ...SHOT_OPTS,
    });
  } else {
    // No open bills — screenshot the current state.
    await page.screenshot({
      path: shot("epic5-bills-detail-1440"),
      fullPage: false,
      ...SHOT_OPTS,
    });
  }
});

// ─── Bills detail at 390: row click opens bottom drawer ──────────────────────

test("bills-detail @ 390", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoAppReady(page, "/expenses/bills");
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByTestId("expenses-bills-screen")).toBeVisible({
    timeout: 30000,
  });

  // At mobile widths, the desktop table is hidden and the mobile card list
  // renders. Both share the same data-testid — filter to the visible OPEN card
  // (one exposing the inline Pay action) so the detail sheet shows mark-paid.
  await page.waitForTimeout(1000);
  const openRow = page
    .getByTestId("bill-row")
    .filter({ visible: true })
    .filter({ has: page.getByTestId("bill-mark-paid") })
    .first();
  if ((await openRow.count()) > 0) {
    await openRow.click();
    await expect(page.getByTestId("bill-detail-mark-paid")).toBeVisible({
      timeout: 15000,
    });
    await page.waitForTimeout(400);
    await expectNoHorizontalScroll(page, 390);
    await page.screenshot({
      path: shot("epic5-bills-detail-390"),
      fullPage: false,
      ...SHOT_OPTS,
    });
  } else {
    // No open bills — screenshot the current state.
    await page.screenshot({
      path: shot("epic5-bills-detail-390"),
      fullPage: false,
      ...SHOT_OPTS,
    });
  }
});

// ─── Contacts: all five gate widths ──────────────────────────────────────────

for (const width of WIDTHS) {
  const height = width === 390 ? 844 : 900;
  test(`contacts @ ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await gotoAppReady(page, "/contacts");
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByTestId("m6-contacts-screen")).toBeVisible({
      timeout: 30000,
    });
    await page.waitForTimeout(300);
    await expectNoHorizontalScroll(page, width);
    await page.screenshot({
      path: shot(`epic5-contacts-${width}`),
      fullPage: false,
      ...SHOT_OPTS,
    });
  });
}

// ─── Contacts detail at 1440: row click opens DetailSheet ─────────────────────

test("contacts-detail @ 1440", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAppReady(page, "/contacts");
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByTestId("m6-contacts-screen")).toBeVisible({
    timeout: 30000,
  });

  const rows = page.getByTestId("contact-row");
  await page.waitForTimeout(1000);
  const rowCount = await rows.count();
  if (rowCount > 0) {
    await rows.first().click();
    await expect(page.getByTestId("contact-profile")).toBeVisible({
      timeout: 15000,
    });
    await page.waitForTimeout(400);
    await expectNoHorizontalScroll(page, 1440);
    await page.screenshot({
      path: shot("epic5-contacts-detail-1440"),
      fullPage: false,
      ...SHOT_OPTS,
    });

    // Click Rules tab if it exists
    const rulesTab = page.getByRole("tab", { name: "Rules" });
    const rulesTabCount = await rulesTab.count();
    if (rulesTabCount > 0) {
      const rulesTabVisible = await rulesTab.isVisible();
      if (rulesTabVisible) {
        await rulesTab.click();
        await page.waitForTimeout(400);
        await expectNoHorizontalScroll(page, 1440);
        await page.screenshot({
          path: shot("epic5-contacts-rules-tab-1440"),
          fullPage: false,
          ...SHOT_OPTS,
        });
      }
    }
  } else {
    await page.screenshot({
      path: shot("epic5-contacts-detail-1440"),
      fullPage: false,
      ...SHOT_OPTS,
    });
  }
});

// ─── Contacts detail at 390: row click opens bottom drawer ────────────────────

test("contacts-detail @ 390", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoAppReady(page, "/contacts");
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByTestId("m6-contacts-screen")).toBeVisible({
    timeout: 30000,
  });

  // At mobile widths, the desktop table is hidden and the mobile card list
  // renders. Both share the same data-testid — use visible:true filter to
  // target the rendered mobile card, not the hidden <tr>.
  const rows = page.getByTestId("contact-row").filter({ visible: true });
  await page.waitForTimeout(1000);
  const rowCount = await rows.count();
  if (rowCount > 0) {
    await rows.first().click();
    await expect(page.getByTestId("contact-profile")).toBeVisible({
      timeout: 15000,
    });
    await page.waitForTimeout(400);
    await expectNoHorizontalScroll(page, 390);
    await page.screenshot({
      path: shot("epic5-contacts-detail-390"),
      fullPage: false,
      ...SHOT_OPTS,
    });
  } else {
    await page.screenshot({
      path: shot("epic5-contacts-detail-390"),
      fullPage: false,
      ...SHOT_OPTS,
    });
  }
});

// ─── Contacts Archived filter at 1440 ─────────────────────────────────────────
// E5 unified the Contacts toolbar onto the shared driver: the old standalone
// "Archived" toggle button is gone — Archived is now an option inside the shared
// Filters panel's "Activity" facet. This drives that new affordance end-to-end.

test("contacts-archived @ 1440", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAppReady(page, "/contacts");
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByTestId("m6-contacts-screen")).toBeVisible({
    timeout: 30000,
  });
  await page.waitForTimeout(300);

  // Open the shared Filters panel (Activity facet is selected by default), then
  // toggle the Archived option inside it.
  await page.getByRole("button", { name: /^Filters/ }).click();
  const archivedBtn = page.getByRole("button", { name: /^Archived$/i });
  await expect(archivedBtn).toBeVisible({ timeout: 10000 });
  await archivedBtn.click();
  await page.waitForTimeout(300);
  // Close the panel so the screenshot shows the filtered directory, not the popover.
  await page.getByRole("button", { name: /^Done$/ }).click();
  await page.waitForTimeout(300);
  // The active "Archived" filter chip confirms the facet applied.
  await expect(page.getByText(/Archived/).first()).toBeVisible();

  await expectNoHorizontalScroll(page, 1440);
  await page.screenshot({
    path: shot("epic5-contacts-archived-1440"),
    fullPage: false,
    ...SHOT_OPTS,
  });
});
