import { expect, test, type Page } from "@playwright/test";

import {
  expectClickable,
  expectNoHorizontalScroll,
  FINISHING_EVIDENCE,
  gotoApp,
  installDevOverlayGuard,
  visibleByTestId,
} from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await installDevOverlayGuard(page);
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem("ob:active-entity-id");
      window.localStorage.removeItem("ob:sidebar-collapsed");
    } catch {
      // Local storage can be unavailable in unusual browser contexts.
    }
  });
});

async function openMobileRoute(page: Page, path: string, readyTestId: string) {
  await gotoApp(page, path);
  await expect(visibleByTestId(page, readyTestId)).toBeVisible({ timeout: 30000 });
  await expectNoHorizontalScroll(page);
}

test("H2 — Contacts profile and Settings data export have finishing evidence", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  await gotoApp(page, "/contacts");
  await expect(visibleByTestId(page, "m6-contacts-screen")).toBeVisible({ timeout: 30000 });

  const rows = page.getByTestId("contact-row");
  await expect(rows.first()).toBeVisible({ timeout: 30000 });
  const rowCount = await rows.count();
  const targetRow = rows.nth(rowCount > 1 ? 1 : 0);
  const targetName = (await targetRow.locator("td").first().locator("div").first().innerText()).trim();
  await expectClickable(targetRow);
  await targetRow.click();

  const profile = visibleByTestId(page, "contact-profile");
  await expect(profile).toContainText(targetName, { timeout: 15000 });
  await expect(profile).toContainText("Default category as rule");
  await expect(profile).toContainText("Merge duplicates");
  await expectNoHorizontalScroll(page, 1440);
  await page.screenshot({
    path: `${FINISHING_EVIDENCE}/2026-06-12-H2-contacts-profile.png`,
    fullPage: true,
  });

  await gotoApp(page, "/settings/data");
  await expect(visibleByTestId(page, "data-section")).toBeVisible({ timeout: 30000 });
  const jsonExport = visibleByTestId(page, "data-export-json");
  await expect(jsonExport).toBeEnabled({ timeout: 30000 });
  await expectClickable(jsonExport);

  const downloadPromise = page.waitForEvent("download");
  await jsonExport.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/reports-export-2026-01-01-to-2026-12-31\.json$/);
  await download.delete();

  await expectNoHorizontalScroll(page, 1440);
  await page.screenshot({
    path: `${FINISHING_EVIDENCE}/2026-06-12-H2-data-export.png`,
    fullPage: true,
  });
});

test("H2 — mobile Dashboard, Inbox, Transactions, and Ask AI stay usable at 390px", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });

  await openMobileRoute(page, "/dashboard", "dashboard-screen");
  await page.screenshot({
    path: `${FINISHING_EVIDENCE}/2026-06-12-H2-mobile-dashboard.png`,
  });

  await gotoApp(page, "/inbox");
  const inboxList = visibleByTestId(page, "inbox-list");
  await expect(
    inboxList.or(page.getByText("Inbox zero", { exact: true })).first(),
  ).toBeVisible({ timeout: 30000 });
  await expectNoHorizontalScroll(page);
  await page.screenshot({
    path: `${FINISHING_EVIDENCE}/2026-06-12-H2-mobile-inbox.png`,
  });

  await openMobileRoute(page, "/transactions", "transactions-screen");
  await page.screenshot({
    path: `${FINISHING_EVIDENCE}/2026-06-12-H2-mobile-transactions.png`,
  });

  const askButton = page.locator("nav").getByRole("button", { name: "Ask AI" });
  await expectClickable(askButton);
  await askButton.click();
  const panel = visibleByTestId(page, "ai-panel-mobile");
  await expect(panel).toBeVisible({ timeout: 15000 });
  await expect(panel.getByText("Ask AI").first()).toBeVisible();
  await expect(panel.getByPlaceholder("Ask about your books")).toBeEnabled({ timeout: 30000 });
  await expectNoHorizontalScroll(page);
  await page.screenshot({
    path: `${FINISHING_EVIDENCE}/2026-06-12-H2-mobile-ask-ai.png`,
  });
});
