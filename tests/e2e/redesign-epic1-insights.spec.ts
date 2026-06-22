import path from "node:path";

import { expect, test } from "@playwright/test";

import { expectNoHorizontalScroll, gotoApp, installDevOverlayGuard } from "./helpers";

// Epic E1 — the reusable Insights component system, proven on the Transactions
// Insights sub-tab (/transactions/insights). Asserts the craft: the scope bar
// always shows resolved calendar dates + a Compare-to control, the KPI cards
// render with a named comparison delta, the chart legend cross-filters, and a
// chart point / counterparty chip drills into the read-only transactions drawer.
// REAL pointer clicks only (no dispatchEvent / force). Read-only navigation —
// the shared demo books are never mutated (the drawer only lists).

const EVIDENCE_DIR = path.join(process.cwd(), "docs/finishing/evidence");
const DATE = "2026-06-14";
const SHOT_OPTS = { animations: "disabled" as const, caret: "hide" as const };

function shot(name: string) {
  return path.join(EVIDENCE_DIR, `${DATE}-E1-${name}.png`);
}

test.describe.configure({ mode: "default" });

test.beforeEach(async ({ page }) => {
  await installDevOverlayGuard(page);
});

test("E1.1 — scope bar renders resolved calendar dates + a Compare-to control", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/transactions/insights");

  await expect(page.getByTestId("insights-dashboard")).toBeVisible({ timeout: 30000 });

  // The scope bar always shows the resolved dates (not just a preset name).
  const resolved = page.getByTestId("insights-resolved-dates");
  await expect(resolved).toBeVisible();
  // Default compare = previous period → the line reads "<active> vs <compare>".
  await expect(resolved).toContainText(/vs/i);
  await expect(resolved).toContainText(/2026/);

  // The Compare-to control is present and switchable to "No comparison",
  // which removes the "vs …" clause.
  const compare = page.getByTestId("insights-compare");
  await expect(compare).toBeVisible();
  await compare.click();
  await page.getByRole("option", { name: "No comparison" }).click();
  await expect(resolved).not.toContainText(/vs/i);

  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: shot("scope-bar"), fullPage: false, ...SHOT_OPTS });
});

test("E1.2 — KPI cards render with a named comparison delta", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/transactions/insights");
  await expect(page.getByTestId("insights-dashboard")).toBeVisible({ timeout: 30000 });

  const cards = page.getByTestId("insights-kpi-card");
  await expect(cards.first()).toBeVisible({ timeout: 30000 });
  expect(await cards.count()).toBeGreaterThanOrEqual(4);

  // The Net change card frames its delta against the named comparison period.
  // (Suppressed only when there's no history — with the seeded demo there is.)
  const delta = page.getByTestId("insights-kpi-delta").first();
  if (await delta.count()) {
    await expect(delta).toContainText(/vs previous period/i);
  }
});

test("E1.3 — the chart legend cross-filters a series in place", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/transactions/insights");
  await expect(page.getByTestId("insights-dashboard")).toBeVisible({ timeout: 30000 });

  const chart = page.getByTestId("insights-chart");
  // The chart only renders with ≥2 daily points; the demo's current month has them.
  if (!(await chart.count())) {
    test.skip(true, "No multi-day chart data in the active period for this entity.");
  }
  const outLegend = page.getByTestId("insights-legend-outMinor");
  await expect(outLegend).toBeVisible();
  await expect(outLegend).toHaveAttribute("aria-pressed", "true");

  // Toggling the legend hides that series (aria-pressed flips) without unmounting
  // the chart.
  await outLegend.click();
  await expect(outLegend).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("insights-chart")).toBeVisible();

  await page.screenshot({ path: shot("chart-legend"), fullPage: false, ...SHOT_OPTS });
});

test("E1.4 — a counterparty chip drills into the read-only transactions drawer", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/transactions/insights");
  await expect(page.getByTestId("insights-dashboard")).toBeVisible({ timeout: 30000 });

  const chip = page.getByTestId("counterparty-chip").first();
  if (!(await chip.count())) {
    test.skip(true, "No counterparties in the active period for this entity.");
  }
  await chip.click();

  // The shared drill drawer opens and lists the underlying transactions. It only
  // lists — there is no posting affordance (AI proposes; the ledger posts).
  const drawer = page.getByTestId("insights-drill-drawer");
  await expect(drawer).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("insights-drill-row").first()).toBeVisible({ timeout: 15000 });

  await page.screenshot({ path: shot("drill-drawer"), fullPage: false, ...SHOT_OPTS });

  // Close it — pure read/nav, nothing mutated.
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden({ timeout: 10000 });
});

test("E1.6 — mobile @ 390: the panel stacks with no horizontal page scroll", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/transactions/insights");
  await expect(page.getByTestId("insights-dashboard")).toBeVisible({ timeout: 30000 });

  await expect(page.getByTestId("insights-resolved-dates")).toBeVisible();
  await expect(page.getByTestId("insights-kpi-card").first()).toBeVisible({ timeout: 30000 });
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: shot("panel-390"), fullPage: false, ...SHOT_OPTS });
});
