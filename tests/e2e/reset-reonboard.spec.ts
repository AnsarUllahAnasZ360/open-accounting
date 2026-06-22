import { expect, test } from "@playwright/test";

import {
  DEV_OVERLAY_INIT,
  FINISHING_EVIDENCE,
  appUrl,
  signUpDisposableOwner,
  visibleByTestId,
} from "./helpers";

// E14-T7 — delete-all-data → reset → re-onboard on a DISPOSABLE book.
//
// Owner runs the scoped factory reset on their OWN fresh workspace, confirming
// by re-typing the exact workspace name (the destructive-action guard), lands
// back on guided onboarding with an empty book, then re-onboards to a populated
// state. Only ever touches the stamped-unique workspace this spec created — the
// re-type-to-confirm gate makes that structurally true (it can only match the
// disposable workspace's name).

test.beforeEach(async ({ page }) => {
  await page.addInitScript(DEV_OVERLAY_INIT);
});

async function quickOnboard(page: import("@playwright/test").Page, label: string) {
  const ws = await signUpDisposableOwner(page, label);
  await page.getByTestId("onboarding-business-name").fill(ws.businessName);
  await page.getByTestId("onboarding-type-services").click();
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
  return ws;
}

test("reset-reonboard — re-type-to-confirm factory reset returns the disposable book to onboarding", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const ws = await quickOnboard(page, "reset");

  // Open the destructive data control.
  await page.goto(appUrl("/settings/data"));
  await expect(visibleByTestId(page, "data-section")).toBeVisible({ timeout: 30000 });

  // GUARD: the run is disabled until the EXACT workspace name is re-typed.
  await page.getByTestId("workspace-reset-confirmation").fill("not the name");
  await expect(page.getByTestId("workspace-reset-run")).toBeDisabled();

  await page.getByTestId("workspace-reset-confirmation").fill(ws.workspaceName);
  await expect(page.getByTestId("workspace-reset-run")).toBeEnabled();
  await page.getByTestId("workspace-reset-run").click();

  // After the scoped reset the workspace returns to guided onboarding with an
  // empty book.
  await expect(page.getByTestId("onboarding-business-step")).toBeVisible({ timeout: 60000 });

  // Re-onboard to a populated state.
  await page.getByTestId("onboarding-business-name").fill(`${ws.businessName} v2`);
  await page.getByTestId("onboarding-type-services").click();
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

  await page.screenshot({
    path: `${FINISHING_EVIDENCE}/2026-06-20-E14-reset-reonboard.png`,
    fullPage: true,
  });
});
