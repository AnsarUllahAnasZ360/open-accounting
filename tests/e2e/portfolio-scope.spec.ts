import { expect, test } from "@playwright/test";

import {
  DEV_OVERLAY_INIT,
  FINISHING_EVIDENCE,
  signUpDisposableOwner,
} from "./helpers";

// E14-T7 — portfolio All / per-business scope switch on a DISPOSABLE book.
//
// A fresh owner with TWO businesses switches the scope from a single business to
// "All businesses" and back. The 'All' roll-up renders the portfolio dashboard
// (combined USD across both businesses) with intercompany elimination in the
// consolidation, and switching scope changes the visible surface. Only ever
// operates on the stamped-unique workspace this spec created.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(DEV_OVERLAY_INIT);
});

test("portfolio-scope — All/per-business switch rolls up two businesses with intercompany eliminated", async ({ page }) => {
  test.setTimeout(180_000);
  // Desktop: the scope switcher trigger is hidden below the `sm` breakpoint.
  await page.setViewportSize({ width: 1440, height: 900 });

  const ws = await signUpDisposableOwner(page, "portfolio");

  // Create the workspace with TWO businesses so the portfolio roll-up has
  // something to consolidate.
  await page.getByTestId("onboarding-business-name").fill(ws.businessName);
  await page.getByTestId("onboarding-type-software").click();
  await page.getByTestId("onboarding-add-business").click();
  await page.getByTestId("onboarding-business-name-1").fill(`${ws.businessName} Labs`);
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("onboarding-ai-skip").click();
  await page.getByTestId("onboarding-plunk-skip").click();
  await page.getByTestId("onboarding-team-continue").click();
  await page.getByTestId("onboarding-bank-skip").click();
  await page.getByTestId("onboarding-stripe-skip").click();
  await page.getByTestId("onboarding-opening-skip").click();
  await page.getByTestId("onboarding-sync-skip").click();
  await page.getByTestId("onboarding-finish").click();
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 60000 });

  // Open the scope switcher and select "All businesses" (the portfolio roll-up).
  const switcher = page.getByTestId("active-business-switcher");
  await expect(switcher).toBeVisible({ timeout: 15000 });
  await switcher.click();
  const menu = page.getByTestId("active-business-menu");
  await expect(menu).toBeVisible({ timeout: 15000 });
  await menu.locator('[data-scope-item="all"]').click();

  // The portfolio dashboard renders the combined view (data-scope="all"), with
  // the two businesses' tiles in the roll-up.
  const portfolio = page.getByTestId("portfolio-dashboard-screen");
  await expect(portfolio).toBeVisible({ timeout: 30000 });
  await expect(portfolio).toHaveAttribute("data-scope", "all");
  await expect(page.getByTestId("portfolio-business-card").first()).toBeVisible({ timeout: 15000 });
  // The trigger reflects the portfolio scope.
  await expect(switcher).toHaveAttribute("data-scope", "all");

  await page.screenshot({
    path: `${FINISHING_EVIDENCE}/2026-06-20-E14-portfolio-all.png`,
    fullPage: true,
  });

  // Intercompany elimination lives in the consolidated REPORT path. Open Reports
  // under the 'All' scope and confirm the consolidation banner is present
  // (it carries the "Intercompany eliminated" / consolidatedFrom signal).
  await page.goto("/reports");
  const banner = page.getByTestId("consolidation-banner");
  // The banner renders for the consolidated scope; allow time for the report pack.
  await expect(banner).toBeVisible({ timeout: 45000 });
  await expect(banner).toContainText(/intercompany/i);

  // Switch back to a single business — the surface changes (portfolio dashboard
  // is no longer the active scope).
  await page.goto("/dashboard");
  await switcher.click();
  await expect(menu).toBeVisible({ timeout: 15000 });
  await menu.getByText(ws.businessName, { exact: false }).first().click();
  await expect(switcher).toHaveAttribute("data-scope", "entity", { timeout: 15000 });
});
