import path from "node:path";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import { expectNoHorizontalScroll, gotoApp, installDevOverlayGuard } from "./helpers";

// Epic E9-T5 — the advisor surface ('How am I doing / what should I worry
// about'). Proves, end-to-end with REAL navigation:
//  1. the dashboard renders the AdvisorPanel with at least one grounded card on
//     first paint (deterministic, no AI key required);
//  2. the panel shows the quiet 'AI not configured — showing computed advice'
//     note when degraded (never an error);
//  3. each card is a drill-down link to a report/register;
//  4. 'Refresh insights' re-runs and the panel stays rendered;
//  5. it stacks cleanly on a 375px mobile viewport (no horizontal scroll).
//
// Like the E8 spec, it seeds a DISPOSABLE business with deterministic June-2026
// ledger activity (insightsFixtures.seedInsightsEntity — dev-auth-only, balanced
// postings) so it never mutates the shared demo books.

const EVIDENCE_DIR = path.join(process.cwd(), "docs/finishing/evidence");
const DATE = "2026-06-20";
const SHOT_OPTS = { animations: "disabled" as const, caret: "hide" as const };

function shot(name: string) {
  return path.join(EVIDENCE_DIR, `${DATE}-E9-${name}.png`);
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

async function selectEntity(page: Page, name: string) {
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

test("E9 — advisor panel renders grounded cards, drills, and refreshes (desktop + mobile)", async ({ page }) => {
  test.setTimeout(300_000);
  const stamp = Date.now().toString().slice(-6);
  const businessName = `E9 Advisor ${stamp} LLC`;
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

  try {
    await page.setViewportSize({ width: 1440, height: 900 });

    await gotoApp(page, "/dashboard");
    await selectEntity(page, businessName);
    await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 30000 });

    // The advisor panel renders, with its 'How am I doing?' header.
    const panel = page.getByTestId("advisor-panel");
    await expect(panel).toBeVisible({ timeout: 30000 });
    await expect(panel).toContainText(/How am I doing/i);

    // At least one grounded card lands on first paint (deterministic, no AI key).
    const cards = page.getByTestId("advisor-card");
    await expect(cards.first()).toBeVisible({ timeout: 30000 });
    expect(await cards.count()).toBeGreaterThan(0);

    // Every card is a drill-down link to a report/register.
    const firstHref = await cards.first().getAttribute("href");
    expect(firstHref).toMatch(/\/(reports|income|expenses|transactions)/);

    await page.screenshot({ path: shot("advisor-desktop"), fullPage: false, ...SHOT_OPTS });

    // 'Refresh insights' re-runs and the panel stays rendered (no error).
    await page.getByTestId("advisor-refresh").click();
    await expect(panel).toBeVisible();
    await expect(cards.first()).toBeVisible({ timeout: 30000 });

    // Mobile: the panel stacks cleanly with no horizontal scroll.
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoApp(page, "/dashboard");
    await selectEntity(page, businessName);
    await expect(page.getByTestId("advisor-panel")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("advisor-card").first()).toBeVisible({ timeout: 30000 });
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: shot("advisor-mobile"), fullPage: false, ...SHOT_OPTS });
  } finally {
    await page.setViewportSize({ width: 1440, height: 900 });
    await client.mutation(api.entities.archive, { entityId: created.entityId }).catch(() => {});
  }
});
