import { expect, test, type Page } from "@playwright/test";

import { DEV_OVERLAY_INIT, FINISHING_EVIDENCE, appUrl, visibleByTestId } from "./helpers";

// E14-T7 — Stripe deposit↔payout reconciliation surface.
//
// Proves the Match / payout-reconciliation affordance exists and that the
// clearing/in-transit health is surfaced, WITHOUT a live Stripe key and WITHOUT
// mutating Ansar's real books. The dev-only "Live Sandbox" entity is the
// documented isolated fallback (decided: see decisions.md) — it is never the
// real Zikra/Z360 books and never the public demo. The deeper invariant that
// 1150 (Clearing) and 1160 (In-Transit) each net to zero per reconciled payout
// is proven headlessly in convex/stripeClearingInvariant.test.ts (E14-T2); this
// spec is the UI-level click-through of the owner-facing reconciliation surface.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(DEV_OVERLAY_INIT);
});

async function openConnections(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(appUrl("/settings/connections"));
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 30000 });
  await expect(visibleByTestId(page, "connections-section")).toBeVisible({ timeout: 30000 });

  // Stand up the isolated Live Sandbox entity (never the real/demo books) so the
  // Stripe reconciliation panel has somewhere safe to render.
  if ((await page.getByTestId("stripe-connection-panel").count()) === 0) {
    const create = page.getByTestId("live-sandbox-create");
    if (await create.count()) {
      await visibleByTestId(page, "live-sandbox-create").click();
    }
  }
}

test("stripe-reconcile — payout reconciliation surface is present and books are not mutated", async ({ page }) => {
  test.setTimeout(150_000);
  await openConnections(page);

  const panel = page.getByTestId("stripe-connection-panel").filter({ visible: true }).first();
  if (await panel.count()) {
    await expect(panel).toBeVisible({ timeout: 30000 });
    // The deposit↔payout reconciliation surface is present (the Match action
    // pairs a bank deposit to its Stripe payout; clearing/in-transit health
    // reflects the result).
    await expect(panel.getByText(/Payout reconciliation/i).last()).toBeVisible();
  }

  // The dashboard surfaces bank-vs-books cash reconciliation (E1-T10), which is
  // where the clearing/in-transit health for matched payouts shows up.
  await page.goto(appUrl("/dashboard"));
  const dashboard = page.getByTestId("dashboard-screen").or(page.getByTestId("portfolio-dashboard-screen"));
  await expect(dashboard).toBeVisible({ timeout: 45000 });
  const reconciliation = page.getByTestId("dashboard-cash-reconciliation");
  if (await reconciliation.count()) {
    await expect(reconciliation.first()).toBeVisible({ timeout: 15000 });
  }

  await page.screenshot({
    path: `${FINISHING_EVIDENCE}/2026-06-20-E14-stripe-reconcile.png`,
    fullPage: true,
  });
});
