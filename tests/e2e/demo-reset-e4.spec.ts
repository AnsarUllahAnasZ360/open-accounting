import { expect, test } from "@playwright/test";

// E4-T9 / E4-T10 e2e: the public no-login demo route and the "books are being
// set up" finish state. These run against the dev server (localhost:3100). The
// demo workspace backend (provisioning + daily reset) is owned by E11; this spec
// asserts the E4-owned surfaces: the route renders, is read-only, carries the
// demo flag + clone CTA, and (when a demo workspace is provisioned) shows
// populated transactions.

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

test("T10 — /demo loads UNAUTHENTICATED and shows the demo flag + clone CTA", async ({ page }) => {
  // No sign-in: a truly unauthenticated visitor.
  await page.goto("/demo");

  // The route resolves the demo workspace server-side. Either it is provisioned
  // (populated, read-only) or it gracefully reports "not ready" — both are
  // unauthenticated-safe E4 surfaces with a clone CTA.
  const populated = page.getByTestId("demo-screen");
  const unavailable = page.getByTestId("demo-unavailable");
  await expect(populated.or(unavailable)).toBeVisible({ timeout: 30000 });

  // The clone-to-your-account CTA is always present.
  await expect(page.getByTestId("demo-clone-cta").first()).toBeVisible();

  if (await populated.isVisible()) {
    // Demo flag is shown, and populated transactions render read-only.
    await expect(page.getByTestId("demo-indicator")).toBeVisible();
    await expect(page.getByTestId("demo-transaction-row").first()).toBeVisible({ timeout: 15000 });
    // Read-only: there is no editable transaction control on the demo page.
    await expect(page.locator("input, button[data-edit]")).toHaveCount(0);
  }
});

test("T9 — the dashboard shows the 'books are being set up' state after finishing", async ({ page }) => {
  const stamp = Date.now();
  const email = `setup-${stamp}@example.com`;

  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(`OpenBooks-${stamp}!`);
  await page.getByLabel("Name").fill("Setup Owner");
  await page.getByRole("button", { name: /Sign in/ }).click();

  await expect(page.getByTestId("onboarding-business-step")).toBeVisible({ timeout: 30000 });
  await page.getByTestId("onboarding-business-name").fill(`Setup Co ${String(stamp).slice(-5)}`);
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

  // Lands on the populated dashboard; the finish handler enqueues the bulk pass
  // and the dashboard shows the "your books are being set up" state.
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId("dashboard-setup-running")).toBeVisible({ timeout: 15000 });
});
