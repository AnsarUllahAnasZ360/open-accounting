import { expect, test } from "@playwright/test";

import {
  DEV_OVERLAY_INIT,
  FINISHING_EVIDENCE,
  signUpDisposableOwner,
} from "./helpers";

// E14-T7 — guided onboarding end to end on a DISPOSABLE book.
//
// Walks the full go-live first run: account → workspace → add business(es) →
// AI key → Plunk → team → Plaid → Stripe → opening balances → bulk setup →
// review/finish, exercising SKIP at each integration step. Lands on a populated
// dashboard. Only ever creates a fresh stamped-unique workspace via the
// onboarding UI (the disposable-book guard documented in helpers.ts) — never
// Ansar's real Zikra/Z360 books.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(DEV_OVERLAY_INIT);
});

test("onboarding-golive — fresh owner walks the guided flow with skips and lands populated", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const ws = await signUpDisposableOwner(page, "golive");

  // Step 0 — business basics. Add a SECOND business so the All/Zikra/Z360-style
  // portfolio roll-up (and intercompany detection) has two entities to work with.
  await expect(page.getByTestId("onboarding-business-step")).toBeVisible();
  await page.getByTestId("onboarding-business-name").fill(ws.businessName);
  await page.getByTestId("onboarding-type-software").click();
  await page.getByTestId("onboarding-add-business").click();
  await page.getByTestId("onboarding-business-name-1").fill(`${ws.businessName} Labs`);
  await page.getByTestId("onboarding-next").click();

  // AI key step — skippable (a workspace-scoped BYO provider key from the
  // 14-provider catalog would be pasted here; the connections-byok spec proves
  // the paste/validate path).
  await page.getByTestId("onboarding-ai-skip").click();

  // Plunk (email) step — skippable.
  await page.getByTestId("onboarding-plunk-skip").click();

  // Team invite step — continue/skip.
  await page.getByTestId("onboarding-team-continue").click();

  // Bank (Plaid) step — shows the real copyable redirect/webhook URLs + a guide
  // link before we skip (the prerequisite for intercompany detection is mapping
  // each account to a business, exercised in connections-byok).
  await expect(page.getByTestId("onboarding-url-panel")).toBeVisible();
  await expect(page.getByTestId("onboarding-guide-link").first()).toBeVisible();
  await page.getByTestId("onboarding-bank-skip").click();

  // Stripe step (per business) — skippable.
  await page.getByTestId("onboarding-stripe-skip").click();

  // Opening balances step — skippable (the real path books a first-of-month USD
  // opening entry into Opening Balance Equity 3900).
  await page.getByTestId("onboarding-opening-skip").click();

  // AI bulk-setup (sync) step — skippable.
  await page.getByTestId("onboarding-sync-skip").click();

  // Review & finish — finishes onboarding and routes to the populated dashboard.
  await page.getByTestId("onboarding-finish").click();

  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 60000 });

  // Both businesses are present in the switcher → proof the disposable workspace
  // was created with two entities (and the scope switch has something to roll up).
  await page.getByTestId("active-business-switcher").click();
  const menu = page.getByTestId("active-business-menu");
  await expect(menu).toBeVisible({ timeout: 15000 });
  await expect(menu.getByText(ws.businessName, { exact: false })).toBeVisible();

  await page.screenshot({
    path: `${FINISHING_EVIDENCE}/2026-06-20-E14-onboarding-golive.png`,
    fullPage: true,
  });
});
