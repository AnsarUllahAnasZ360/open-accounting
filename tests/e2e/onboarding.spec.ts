import { expect, test } from "@playwright/test";

const EVIDENCE = "docs/finishing/evidence";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const strip = () =>
      document
        .querySelectorAll("nextjs-portal, [data-nextjs-dev-overlay]")
        .forEach((node) => node.remove());
    strip();
    new MutationObserver(strip).observe(document.documentElement, { childList: true, subtree: true });
  });
});

// Walk the integration + bulk-setup steps that come AFTER the team step, skipping
// every one that needs live keys (AI, Plunk, Bank, Stripe, Opening balances,
// Set up books) and finishing the review step. Shared by the specs below.
async function skipThroughToFinish(page: import("@playwright/test").Page) {
  // AI step — skippable.
  await page.getByTestId("onboarding-ai-skip").click();
  // Plunk (email) step — skippable.
  await page.getByTestId("onboarding-plunk-skip").click();
  // Team step — continue/skip.
  await page.getByTestId("onboarding-team-continue").click();
  // Bank (Plaid) step — skippable + shows the real copyable redirect/webhook
  // URLs and a guide link (E4-T4 DoD).
  await expect(page.getByTestId("onboarding-url-panel")).toBeVisible();
  await expect(page.getByTestId("onboarding-guide-link").first()).toBeVisible();
  await page.getByTestId("onboarding-bank-skip").click();
  // Stripe step — skippable.
  await page.getByTestId("onboarding-stripe-skip").click();
  // Opening balances step — skippable.
  await page.getByTestId("onboarding-opening-skip").click();
  // AI bulk-setup (sync) step — skippable.
  await page.getByTestId("onboarding-sync-skip").click();
  // Review & finish step — finishes onboarding (no proposals since sync was
  // skipped) and routes to the populated dashboard.
  await page.getByTestId("onboarding-finish").click();
}

test("F1 — brand-new owner creates a workspace with TWO businesses (E4-T2/T4)", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const stamp = Date.now();
  const email = `owner-f1-${stamp}@example.com`;
  const businessOne = `F1 Studio ${String(stamp).slice(-5)}`;
  const businessTwo = `F1 Labs ${String(stamp).slice(-5)}`;

  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(`OpenBooks-${stamp}!`);
  await page.getByLabel("Name").fill("F1 Owner");
  await page.getByRole("button", { name: /Sign in/ }).click();

  await expect(page.getByTestId("onboarding-screen")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("onboarding-business-step")).toBeVisible();

  // First business.
  await page.getByTestId("onboarding-business-name").fill(businessOne);
  await page.getByTestId("onboarding-type-software").click();

  // Add a second business (E4-T2 multi-business).
  await page.getByTestId("onboarding-add-business").click();
  await page.getByTestId("onboarding-business-name-1").fill(businessTwo);

  // Create the workspace + businesses NOW (E4-T4: the integration steps do real
  // work against the live workspace).
  await page.getByTestId("onboarding-next").click();

  await skipThroughToFinish(page);

  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 60000 });

  // Both businesses appear in the active-business switcher (E4-T2 DoD).
  await page.getByTestId("active-business-switcher").click();
  const menu = page.getByTestId("active-business-menu");
  await expect(menu).toBeVisible({ timeout: 15000 });
  await expect(menu.getByText(businessOne)).toBeVisible();
  await expect(menu.getByText(businessTwo)).toBeVisible();

  await page.screenshot({ path: `${EVIDENCE}/2026-06-20-F1-onboarding-two-businesses.png`, fullPage: true });
});
