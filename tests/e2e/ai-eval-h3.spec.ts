import { expect, test } from "@playwright/test";

import { FINISHING_EVIDENCE, gotoApp, installDevOverlayGuard, visibleByTestId } from "./helpers";

test.beforeEach(async ({ page }) => {
  await installDevOverlayGuard(page);
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem("ob:active-entity-id");
      window.localStorage.removeItem("ob:sidebar-collapsed");
    } catch {
      // Ignore storage access errors in hardened browsers.
    }
  });
});

test("H3 — Settings AI shows the label-safe categorization eval result", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await gotoApp(page, "/dashboard");
  await page.getByTestId("app-sidebar").getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByTestId("settings-nav-ai").click();

  const evalHistory = visibleByTestId(page, "ai-eval-history");
  await expect(evalHistory).toBeVisible({ timeout: 30000 });
  const latestRun = page.getByTestId("ai-eval-row").first();
  await expect(latestRun).toContainText("75%", { timeout: 30000 });
  await expect(latestRun).toContainText("45/60 correct");
  await expect(latestRun).toContainText("below the 80.0% target");

  await page.screenshot({
    path: `${FINISHING_EVIDENCE}/2026-06-12-H3-ai-eval-settings.png`,
    fullPage: true,
  });
});
