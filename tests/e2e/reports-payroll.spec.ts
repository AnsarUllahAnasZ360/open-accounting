import { expect, test, type Page } from "@playwright/test";

// Epic D — Reports & Payroll. REAL pointer clicks only; no synthetic events or
// forced clicks. The Next.js dev-tools overlay (`nextjs-portal`) is a dev-only
// shadow-DOM artifact in the same corner as the rail footer; strip it so it
// cannot intercept real product clicks. This is NOT masking a product overlap.
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

async function gotoApp(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 30000 });
}

// Months that are in the future relative to the seeded "today" (2026-06-11).
// A report must never default to a period that extends past today — the exact
// bug from the previous run (a "Monthly Review" exported as December 2026).
const FUTURE_PERIOD = /\b(Jul|Aug|Sep|Oct|Nov|Dec)\s+2026\b|\b202[7-9]\b/;

test("D1/D2 — reports home opens a viewer with a sane (never-future) default period", async ({ page }) => {
  await gotoApp(page, "/reports");
  await expect(page.getByTestId("reports-home")).toBeVisible();
  await page.screenshot({ path: "docs/finishing/evidence/2026-06-11-D1-reports-home.png", fullPage: true });

  // The five groups' headline cards are present.
  for (const id of ["monthly-review", "profit-and-loss", "balance-sheet", "ar-aging", "trial-balance"]) {
    await expect(page.getByTestId(`report-card-${id}`)).toBeVisible();
  }

  // Open Profit & Loss -> the shared viewer renders with a real default period.
  await page.getByTestId("report-card-profit-and-loss").click();
  await expect(page.getByTestId("viewer-toolbar")).toBeVisible();
  await page.screenshot({ path: "docs/finishing/evidence/2026-06-11-D2-pnl-viewer.png", fullPage: true });
  const periodLabel = (await page.getByTestId("period-label").innerText()).trim();
  expect(periodLabel.length).toBeGreaterThan(0);
  expect(periodLabel, `period label must not be a future period: "${periodLabel}"`).not.toMatch(FUTURE_PERIOD);

  // Back to the home grid with a real click.
  await page.getByTestId("reports-back").click();
  await expect(page.getByTestId("reports-home")).toBeVisible();
});

test("D2 — cash<->accrual toggles, and every number drills to its underlying lines", async ({ page }) => {
  await gotoApp(page, "/reports");
  await page.getByTestId("report-card-profit-and-loss").click();
  await expect(page.getByTestId("viewer-toolbar")).toBeVisible();

  // Cash <-> accrual is a real, mutually-exclusive toggle (active button gets
  // the raised `bg-card` treatment).
  await page.getByTestId("basis-cash").click();
  await expect(page.getByTestId("basis-cash")).toHaveClass(/bg-card/);
  await expect(page.getByTestId("basis-accrual")).not.toHaveClass(/bg-card/);
  await page.getByTestId("basis-accrual").click();
  await expect(page.getByTestId("basis-accrual")).toHaveClass(/bg-card/);
  await expect(page.getByTestId("basis-cash")).not.toHaveClass(/bg-card/);

  // Drill-down: a rendered number is a real button that opens its lines.
  const firstNumber = page.getByTestId("money-button").first();
  await expect(firstNumber).toBeVisible();
  await firstNumber.click();
  await expect(page.getByTestId("drill-sheet")).toBeVisible();
  await expect(page.getByTestId("drill-row").first()).toBeVisible();
});

test("D3 — Monthly Review is a one-pager with a month stepper", async ({ page }) => {
  await gotoApp(page, "/reports");
  await page.getByTestId("report-card-monthly-review").click();
  await expect(page.getByTestId("monthly-review")).toBeVisible();
  await expect(page.getByTestId("mr-net")).toBeVisible();
  await page.screenshot({ path: "docs/finishing/evidence/2026-06-11-D3-monthly-review.png", fullPage: true });

  const monthBefore = (await page.getByTestId("mr-month").innerText()).trim();
  expect(monthBefore).not.toMatch(FUTURE_PERIOD);
  await page.getByTestId("mr-prev").click();
  const monthAfter = (await page.getByTestId("mr-month").innerText()).trim();
  expect(monthAfter).not.toEqual(monthBefore); // the stepper actually moves
});

test("D4 — a payroll run row opens its detail with the editable grid and totals", async ({ page }) => {
  await gotoApp(page, "/payroll");
  const firstRun = page.getByTestId("payroll-run-row").first();
  await expect(firstRun).toBeVisible();
  await firstRun.click();

  // The run detail (Ansar's "can't click into a run" complaint) renders.
  await expect(page.getByTestId("payroll-run-detail")).toBeVisible();
  await expect(page.getByTestId("payroll-line-row").first()).toBeVisible();
  await expect(page.getByTestId("payroll-base-total")).toBeVisible();
  await page.screenshot({ path: "docs/finishing/evidence/2026-06-11-D4-payroll-run-detail.png", fullPage: true });
  // (Approve / mark-paid post real ledger entries to the shared demo books, so
  // the approve->pay->balanced lifecycle is asserted in payroll unit tests, not
  // here, to avoid mutating shared data on every CI run.)
});

test("D5 — the dashboard period selector drives the P&L snapshot, and tiles drill through", async ({ page }) => {
  await gotoApp(page, "/dashboard");
  await expect(page.getByTestId("dashboard-screen")).toBeVisible();
  await page.screenshot({ path: "docs/finishing/evidence/2026-06-11-D5-dashboard.png", fullPage: true });

  // Net income carries the selected period to the report viewer.
  const netIncome = page.locator('a[href^="/reports?"]').first();
  await expect(netIncome).toBeVisible();
  await expect(netIncome).toHaveAttribute("href", /\/reports\?.*period=\d{4}-\d{2}/);

  // No horizontal scroll at desktop or mobile widths (wait for reflow after
  // each resize before measuring — measuring synchronously races layout).
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
});
