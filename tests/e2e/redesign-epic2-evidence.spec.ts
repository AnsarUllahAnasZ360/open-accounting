import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalScroll,
  gotoApp,
  installDevOverlayGuard,
} from "./helpers";

// Epic 2 evidence: shell declutter + Ask AI rebuild (collapsed/docked/page/mobile).
// Capture-only spec. Does NOT edit product code; reuses the running :3100 server.

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "docs/finishing/evidence/epic2",
);
const DATE = "2026-06-13";

function shot(name: string) {
  return path.join(EVIDENCE_DIR, `${DATE}-${name}.png`);
}

const SHOT_OPTS = { animations: "disabled" as const, caret: "hide" as const };

test.beforeEach(async ({ page }) => {
  await installDevOverlayGuard(page);
});

test("1. shell decluttered @ 1440", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/dashboard");
  await page.waitForLoadState("networkidle").catch(() => {});

  // Header affordances: icon-only Ask AI present.
  await expect(page.getByTestId("ask-ai-button")).toBeVisible();
  // Settings is NOT in the primary nav (it lives in the sidebar footer cluster).
  const primaryNav = page.locator('[data-testid="app-sidebar"] nav').first();
  await expect(primaryNav.getByRole("link", { name: /^settings$/i })).toHaveCount(0);

  await page.screenshot({ path: shot("shell-decluttered-1440"), fullPage: false, ...SHOT_OPTS });
});

test("2a. docked Ask AI reserves side space on /transactions @ 1440", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/transactions");
  await page.waitForLoadState("networkidle").catch(() => {});

  await page.getByTestId("ask-ai-button").click();
  await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(400);

  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: shot("askai-docked-transactions-1440"), fullPage: false, ...SHOT_OPTS });
});

test("2b. docked Ask AI reserves side space on /reports @ 1306", async ({ page }) => {
  await page.setViewportSize({ width: 1306, height: 880 });
  await gotoApp(page, "/reports");
  await page.waitForLoadState("networkidle").catch(() => {});

  await page.getByTestId("ask-ai-button").click();
  await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(400);

  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: shot("askai-docked-reports-1306"), fullPage: false, ...SHOT_OPTS });
});

test("3. Ask AI full page @ 1440", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/ask-ai");
  await page.waitForLoadState("networkidle").catch(() => {});

  await expect(page.getByTestId("m10-ai-chat-page")).toBeVisible({ timeout: 15000 });
  // The full page owns the chat workspace: composer-first layout + searchable
  // thread dropdown.
  await expect(page.getByTestId("ai-thread-switcher")).toBeVisible();
  await page.getByTestId("ai-thread-switcher").click();
  await expect(page.getByTestId("ai-thread-search")).toBeVisible();
  await page.keyboard.press("Escape");
  await expectNoHorizontalScroll(page);

  await page.screenshot({ path: shot("askai-page-1440"), fullPage: false, ...SHOT_OPTS });
});

test("4. Ask AI mobile sheet @ 390", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/dashboard");
  await page.waitForLoadState("networkidle").catch(() => {});

  // Open via the mobile bottom-nav Ask AI button.
  await page.locator("nav").getByRole("button", { name: /ask ai/i }).click();
  await expect(page.getByTestId("ai-panel-mobile")).toBeVisible({ timeout: 15000 });
  // Reachable thread switcher + composer inside the sheet.
  await expect(
    page.getByTestId("ai-panel-mobile").getByTestId("ai-thread-switcher"),
  ).toBeVisible();
  await page.waitForTimeout(400);

  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: shot("askai-mobile-390"), fullPage: false, ...SHOT_OPTS });
});

test("5a. sidebar footer cluster @ 1440", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/dashboard");
  await page.waitForLoadState("networkidle").catch(() => {});

  // Footer cluster: Settings + Sync + Profile.
  const sidebar = page.getByTestId("app-sidebar");
  await expect(sidebar.getByTestId("sync-now")).toBeVisible();
  await expect(sidebar.getByTestId("profile-trigger").first()).toBeVisible();

  await sidebar.screenshot({ path: shot("sidebar-footer-1440"), ...SHOT_OPTS });
});

test("5b. collapsed rail Sparkles AI trigger @ 1440", async ({ page }) => {
  // Pre-seed collapsed state so the rail renders the iconified Sparkles trigger.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("ob:sidebar-collapsed", "1");
    } catch {
      /* noop */
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/dashboard");
  await page.waitForLoadState("networkidle").catch(() => {});

  const sidebar = page.getByTestId("app-sidebar");
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await expect(sidebar.getByTestId("ask-ai-rail-trigger")).toBeVisible();

  await sidebar.screenshot({ path: shot("collapsed-rail-sparkles-1440"), ...SHOT_OPTS });
});
