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

test("F1 — brand-new owner creates workspace, first business, and setup checklist", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const stamp = Date.now();
  const email = `owner-f1-${stamp}@example.com`;
  const businessName = `F1 Studio ${String(stamp).slice(-5)}`;

  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(`OpenBooks-${stamp}!`);
  await page.getByLabel("Name").fill("F1 Owner");
  await page.getByRole("button", { name: /Sign in/ }).click();

  await expect(page.getByTestId("onboarding-screen")).toBeVisible({ timeout: 30000 });
  await page.getByTestId("onboarding-business-name").fill(businessName);
  await page.getByTestId("onboarding-type-software").click();
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("onboarding-ai-skip").click();
  await page.getByTestId("onboarding-bank-skip").click();
  await page.getByTestId("onboarding-stripe-skip").click();
  await page.getByTestId("onboarding-finish").click();

  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 60000 });
  await expect(page.getByText(businessName).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("onboarding-checklist-card")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("onboarding-checklist-bankConnected")).toBeVisible();
  await expect(page.getByTestId("onboarding-checklist-aiConnected")).toBeVisible();
  await expect(page.getByTestId("onboarding-checklist-stripeConnected")).toBeVisible();
  await expect(page.getByTestId("onboarding-checklist-firstInboxZero")).toBeVisible();
  await expect(page.getByTestId("onboarding-checklist-firstReportViewed")).toBeVisible();

  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-F1-onboarding-dashboard-checklist.png`, fullPage: true });
});
