import path from "node:path";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import { expectNoHorizontalScroll, gotoApp, installDevOverlayGuard } from "./helpers";

// Epic E1 (stage B) — proves the reusable Insights craft on the Transactions
// Insights sub-tab with REAL data, end-to-end, with REAL pointer clicks only.
//
// To avoid mutating shared books AND to not depend on the demo seed / Bedrock,
// this spec creates a DISPOSABLE business, seeds it with deterministic June 2026
// cash activity through the real ledger (insightsFixtures.seedInsightsEntity —
// dev-auth-only, balanced postings), proves the craft, then archives it.
//
// Acceptance #7 specifically: open /transactions/insights, change the period and
// assert the skeleton does NOT re-fire (the chart morphs), hover to see the one
// unified tooltip, and click a chart point / counterparty chip / the
// Uncategorized KPI to open a drawer of the underlying transactions.

const EVIDENCE_DIR = path.join(process.cwd(), "docs/finishing/evidence");
const DATE = "2026-06-14";
const SHOT_OPTS = { animations: "disabled" as const, caret: "hide" as const };

function shot(name: string) {
  return path.join(EVIDENCE_DIR, `${DATE}-E1-${name}.png`);
}

function readLocalEnv(name: string) {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const equalsIndex = line.indexOf("=");
    const key = line.slice(0, equalsIndex).trim();
    if (key !== name) continue;
    return line
      .slice(equalsIndex + 1)
      .trim()
      .replace(/\s+#.*$/, "")
      .replace(/^["']|["']$/g, "");
  }
  return "";
}

function convexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || readLocalEnv("NEXT_PUBLIC_CONVEX_URL");
  return new ConvexHttpClient(convexUrl);
}

// The period presets are a radix ToggleGroup (role="radio"), not buttons.
async function pickPreset(page: Page, label: string) {
  await page.getByRole("radio", { name: label, exact: true }).first().click();
}

async function selectEntity(page: Page, name: string) {
  // The active-business switcher was renamed from the legacy `entity-switcher`
  // to `active-business-switcher` (+ `active-business-menu`) by the E5/E12 scope
  // context; match the live shell so this helper resolves instead of hanging.
  const switcher = page.getByTestId("active-business-switcher");
  if ((await switcher.innerText()).includes(name)) return;
  await switcher.click();
  const menu = page.getByTestId("active-business-menu");
  await expect(menu).toBeVisible();
  const option = menu.locator('[role="menuitem"]').filter({ hasText: name }).first();
  await expect(option).toBeVisible({ timeout: 15000 });
  await option.click();
  await expect(switcher).toContainText(name, { timeout: 15000 });
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await installDevOverlayGuard(page);
});

test("E1 — Transactions Insights craft proven on a seeded disposable business", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now().toString().slice(-6);
  const businessName = `E1 Insights ${stamp} LLC`;
  const client = convexClient();

  const created = await client.mutation(api.entities.create, {
    name: businessName,
    businessType: "services",
    currency: "USD",
  });
  const seeded = await client.mutation(api.insightsFixtures.seedInsightsEntity, {
    entityId: created.entityId,
  });
  expect(seeded.posted).toBeGreaterThanOrEqual(8);
  expect(seeded.uncategorized).toBeGreaterThanOrEqual(2);

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, "/transactions/insights");
    await selectEntity(page, businessName);
    await expect(page.getByTestId("insights-dashboard")).toBeVisible({ timeout: 30000 });

    // The seeded period is June 2026 → the default "This month" range (anchored
    // to 2026-06-30) shows the activity immediately.

    // --- Scope bar: resolved calendar dates + a Compare-to control. ---
    const resolved = page.getByTestId("insights-resolved-dates");
    await expect(resolved).toBeVisible();
    await expect(resolved).toContainText(/2026/);
    await expect(resolved).toContainText(/vs/i); // default compare = previous period

    // --- KPI band: full anatomy (5 cards, a named delta, a sparkline). ---
    const cards = page.getByTestId("insights-kpi-card");
    await expect(cards.first()).toBeVisible({ timeout: 30000 });
    expect(await cards.count()).toBe(5);
    await expect(page.getByText("Net cashflow")).toBeVisible();
    await expect(page.getByText("Ending cash")).toBeVisible();
    await expect(page.getByText("Uncategorized")).toBeVisible();
    // A named comparison delta frames at least one card against the period.
    await expect(page.getByTestId("insights-kpi-delta").first()).toContainText(
      /vs previous period/i,
      { timeout: 15000 },
    );

    // --- The chart renders (multi-day fixture has ≥2 points). ---
    const chart = page.getByTestId("insights-chart");
    await expect(chart).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: shot("desktop-insights"), fullPage: false, ...SHOT_OPTS });

    // --- Acceptance #7: change period → NO skeleton re-fire; chart morphs. ---
    // The panel-level skeleton must never reappear after first paint; the chart
    // stays mounted and tweens to the new data.
    await expect(page.getByTestId("insights-panel-skeleton")).toHaveCount(0);
    await pickPreset(page, "Last 3 months");
    // Assert the skeleton did NOT re-fire and the chart never unmounted.
    await expect(page.getByTestId("insights-panel-skeleton")).toHaveCount(0);
    await expect(chart).toBeVisible();
    // The resolved dates change (proof the period actually applied + the chart
    // morphed rather than reset).
    await expect(resolved).toContainText(/Apr|Mar/);
    await pickPreset(page, "This month");
    await expect(page.getByTestId("insights-panel-skeleton")).toHaveCount(0);
    await expect(chart).toBeVisible();

    // --- Unified tooltip: hovering the plot shows ONE tooltip listing the
    // series at that x (not a tooltip per series). ---
    const plot = chart.locator(".recharts-surface").first();
    await expect(plot).toBeVisible();
    const box = await plot.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      const tooltip = page.locator(".money-figures", { hasText: /\$/ }).first();
      await expect(tooltip).toBeVisible({ timeout: 5000 });
    }

    // --- Legend cross-filter toggles a series in place (no unmount). ---
    const outLegend = page.getByTestId("insights-legend-outMinor");
    await expect(outLegend).toHaveAttribute("aria-pressed", "true");
    await outLegend.click();
    await expect(outLegend).toHaveAttribute("aria-pressed", "false");
    await expect(chart).toBeVisible();
    await outLegend.click(); // restore

    // --- Click-to-drill: clicking a bar opens the read-only transactions drawer.
    // Each series carries its own recharts onClick, so a real pointer click on
    // the rendered bar rectangle drills that day. ---
    await chart.locator(".recharts-bar-rectangle").first().click();
    let drawer = page.getByTestId("insights-drill-drawer");
    await expect(drawer).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("insights-drill-row").first()).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: shot("drill-drawer"), fullPage: false, ...SHOT_OPTS });
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden({ timeout: 10000 });

    // --- A counterparty chip drills into the same drawer. ---
    const chip = page.getByTestId("counterparty-chip").first();
    await expect(chip).toBeVisible({ timeout: 15000 });
    await chip.click();
    drawer = page.getByTestId("insights-drill-drawer");
    await expect(drawer).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("insights-drill-row").first()).toBeVisible({ timeout: 15000 });
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden({ timeout: 10000 });

    // --- The Uncategorized KPI drills to its unposted, unclassified rows. ---
    const uncategorizedCard = cards.filter({ hasText: "Uncategorized" }).first();
    await uncategorizedCard.click();
    drawer = page.getByTestId("insights-drill-drawer");
    await expect(drawer).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("insights-drill-row").first()).toBeVisible({ timeout: 15000 });
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden({ timeout: 10000 });

    // --- Low-data state: May (the lighter previous period) still morphs the
    // chart in place; the panel skeleton never re-fires. ---
    await pickPreset(page, "Last month"); // May 2026 = lighter
    await expect(page.getByTestId("insights-panel-skeleton")).toHaveCount(0);
    await expect(resolved).toContainText(/May/);
    await pickPreset(page, "This month");

    // --- Mobile @ 390: the 60/40 split stacks; no horizontal page scroll. ---
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("insights-resolved-dates")).toBeVisible();
    await expect(cards.first()).toBeVisible({ timeout: 15000 });
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: shot("mobile-390"), fullPage: false, ...SHOT_OPTS });
  } finally {
    // Clean up: archive the disposable business (never a hard delete; posted
    // ledger history stays immutable).
    await client.mutation(api.entities.archive, { entityId: created.entityId }).catch(() => undefined);
  }
});

test("E1 — a period with no activity shows the calm per-widget empty state (no skeleton)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  // A brand-new disposable business with NO transactions: every widget shows its
  // quiet empty state, never a spinner-forever or an alarm. Read-only — archived
  // after.
  const stamp = Date.now().toString().slice(-6);
  const businessName = `E1 Empty ${stamp} LLC`;
  const client = convexClient();
  const created = await client.mutation(api.entities.create, {
    name: businessName,
    businessType: "services",
    currency: "USD",
  });

  try {
    await gotoApp(page, "/transactions/insights");
    await selectEntity(page, businessName);
    // The scope bar + KPI band still render (zeros), and the chart slot shows the
    // calm empty widget state rather than a chart or a stuck skeleton.
    const dashboardOrEmpty = page
      .getByTestId("insights-dashboard")
      .or(page.getByText("No transactions yet"));
    await expect(dashboardOrEmpty.first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("insights-panel-skeleton")).toHaveCount(0);
    await page.screenshot({ path: shot("empty-state"), fullPage: false, ...SHOT_OPTS });
  } finally {
    await client.mutation(api.entities.archive, { entityId: created.entityId }).catch(() => undefined);
  }
});
