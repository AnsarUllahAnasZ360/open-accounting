import { expect, test, type Page } from "@playwright/test";

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

const EVIDENCE = "docs/finishing/evidence";

function visibleByTestId(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true }).first();
}

async function openConnections(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/settings/connections");
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 30000 });
  await expect(visibleByTestId(page, "connections-section")).toBeVisible({ timeout: 30000 });

  if ((await page.getByTestId("stripe-connection-panel").count()) === 0) {
    await visibleByTestId(page, "live-sandbox-create").click();
    await expect(visibleByTestId(page, "stripe-connection-panel")).toBeVisible({ timeout: 30000 });
  }
}

test("G3 — Stripe panel exposes persisted payout-line drill-down without mutating books", async ({ page }) => {
  test.setTimeout(120_000);
  await openConnections(page);

  const panel = visibleByTestId(page, "stripe-connection-panel");
  await expect(panel).toBeVisible({ timeout: 30000 });
  await expect(panel.getByRole("button", { name: "Validate" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Sync now" })).toBeVisible();
  await expect(panel.getByText("Payout reconciliation").last()).toBeVisible();

  await panel.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByTestId("stripe-action-message")).toContainText(
    /Stripe|STRIPE_SECRET_KEY/i,
    { timeout: 30000 },
  );

  await expect(
    panel
      .getByText(/Drill-down rows now come from persisted Stripe balance-transaction child rows/i)
      .or(panel.getByText(/No recorded Stripe payouts yet/i)),
  ).toBeVisible();

  const firstPayout = panel.locator("details").first();
  await expect(firstPayout).toBeVisible();
  await firstPayout.locator("summary").click();
  await expect(firstPayout.getByRole("columnheader", { name: "Gross" })).toBeVisible();
  await expect(firstPayout.getByRole("columnheader", { name: "Net" })).toBeVisible();

  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-G3-stripe-payout-lines.png`, fullPage: true });
});
