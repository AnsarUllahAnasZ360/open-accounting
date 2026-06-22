import path from "node:path";

import { expect, test } from "@playwright/test";

import { expectNoHorizontalScroll, installDevOverlayGuard } from "./helpers";

// Epic 7 — final responsive QA sweep.
// Capture-only matrix: 11 surfaces × 5 gate widths (390/768/1306/1440/1758),
// plus two AI-docked-open scenarios at 1306 + 1440 to prove dense tables
// (reports, transactions) keep no page overflow while the assistant is open.
//
// Does NOT edit product code; reuses the running :3100 dev server.
// Uses localhost (not 127.0.0.1) explicitly — Convex WebSocket auth handshakes
// reliably only on the localhost hostname in a cold headless context.

const EVIDENCE_DIR = path.join(process.cwd(), "docs/finishing/evidence/epic7");
const DATE = "2026-06-13";

function shot(name: string) {
  return path.join(EVIDENCE_DIR, `${DATE}-${name}.png`);
}

const SHOT_OPTS = { animations: "disabled" as const, caret: "hide" as const };

const WIDTHS = [390, 768, 1306, 1440, 1758] as const;

// Each surface: route + the data-testid that proves the screen body mounted.
const SURFACES = [
  { name: "dashboard", route: "/dashboard", screen: "dashboard-screen" },
  { name: "inbox", route: "/inbox", screen: "inbox-list" },
  { name: "transactions", route: "/transactions", screen: "transactions-screen" },
  { name: "income", route: "/income", screen: "income-screen" },
  { name: "expenses", route: "/expenses", screen: "expenses-screen" },
  { name: "bills", route: "/expenses/bills", screen: "expenses-bills-screen" },
  { name: "contacts", route: "/contacts", screen: "m6-contacts-screen" },
  { name: "payroll", route: "/payroll", screen: "m6-payroll-screen" },
  { name: "reports", route: "/reports", screen: "reports-screen" },
  { name: "settings", route: "/settings", screen: "settings-screen" },
  { name: "ask-ai", route: "/ask-ai", screen: "m10-ai-chat-page" },
] as const;

// Navigate to the app on localhost and wait for the shell sidebar to mount
// (proves the Convex workspace finished loading), retrying past transient 500s.
async function gotoAppReady(
  page: Parameters<typeof installDevOverlayGuard>[0],
  route: string,
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.goto(`http://localhost:3100${route}`);
    const hasError = await page
      .locator("body")
      .filter({ hasText: /500|Internal Server Error/ })
      .count();
    if (hasError === 0) break;
    if (attempt < 4) await page.waitForTimeout(5000);
  }
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 90000 });
}

test.setTimeout(120000);

test.beforeEach(async ({ page }) => {
  await installDevOverlayGuard(page);
});

// ─── Matrix: every surface × every gate width ──────────────────────────────────

for (const surface of SURFACES) {
  for (const width of WIDTHS) {
    const height = width === 390 ? 844 : 900;
    test(`${surface.name} @ ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await gotoAppReady(page, surface.route);
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(page.getByTestId(surface.screen)).toBeVisible({
        timeout: 30000,
      });
      await page.waitForTimeout(400);
      await expectNoHorizontalScroll(page, width);
      await page.screenshot({
        path: shot(`epic7-${surface.name}-${width}`),
        fullPage: false,
        ...SHOT_OPTS,
      });
    });
  }
}

// ─── AI docked-open scenarios (gate G3 + G5) ───────────────────────────────────
// Open the docked Ask AI panel from the topbar trigger, then confirm the
// densest tables (Reports, Transactions) keep zero page-level horizontal
// overflow with the assistant reserved as a side column.

const AI_OPEN_CASES = [
  { width: 1306, route: "/reports", screen: "reports-screen", label: "reports" },
  {
    width: 1440,
    route: "/transactions",
    screen: "transactions-screen",
    label: "transactions",
  },
] as const;

for (const ai of AI_OPEN_CASES) {
  test(`ai-open ${ai.label} @ ${ai.width}`, async ({ page }) => {
    await page.setViewportSize({ width: ai.width, height: 900 });
    await gotoAppReady(page, ai.route);
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByTestId(ai.screen)).toBeVisible({ timeout: 30000 });

    // Open the docked assistant via the topbar Sparkles trigger.
    await page.getByTestId("ask-ai-button").click();
    await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(500);

    // The dense table underneath must still not push the page wider.
    await expectNoHorizontalScroll(page, ai.width);
    await page.screenshot({
      path: shot(`epic7-ai-open-${ai.label}-${ai.width}`),
      fullPage: false,
      ...SHOT_OPTS,
    });
  });
}
