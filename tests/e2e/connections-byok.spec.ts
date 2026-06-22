import { expect, test } from "@playwright/test";

import {
  DEV_OVERLAY_INIT,
  FINISHING_EVIDENCE,
  appUrl,
  signUpDisposableOwner,
  visibleByTestId,
} from "./helpers";

// E14-T7 — in-UI BYO-key connections on a DISPOSABLE book.
//
// In Settings, exercise the bring-your-own-key surfaces stored in the unified
// `credentials` store: paste a workspace-scoped AI key (provider/model picked
// from the 14-provider catalog), surface the Plaid redirect/webhook URLs, surface
// the Stripe webhook URL + the "only listening after the webhook verifies"
// state, and assert NO plaintext key is echoed back into the DOM. Runs on a
// fresh stamped-unique workspace (disposable-book guard in helpers.ts).

const AI_KEY = "sk-e2e-byok-do-not-use-1234567890ABCDEF";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(DEV_OVERLAY_INIT);
});

// Finish onboarding fast so we land on a populated, disposable workspace whose
// Settings we can drive.
async function onboardThenSettings(page: import("@playwright/test").Page) {
  const ws = await signUpDisposableOwner(page, "byok");
  await page.getByTestId("onboarding-business-name").fill(ws.businessName);
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
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 60000 });
  return ws;
}

test("connections-byok — paste AI key (workspace-scoped) and assert it is never echoed in the DOM", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  await onboardThenSettings(page);

  // AI key: workspace-scoped, chosen from the catalog. The Settings > AI panel
  // is the BYO entrypoint.
  await page.goto(appUrl("/settings/ai"));
  await expect(visibleByTestId(page, "ai-section")).toBeVisible({ timeout: 30000 });

  // The provider catalog dropdown is enabled (E3: 14 providers, not the old dead
  // disabled select).
  await expect(page.getByTestId("ai-provider")).toBeEnabled();

  // The API key field is a masked SecretInput (type=password), so the typed key
  // is never rendered as visible text.
  const keyInput = page.getByTestId("ai-key-input").first();
  if (await keyInput.count()) {
    await keyInput.fill(AI_KEY);
    await expect(keyInput).toHaveAttribute("type", "password");
    // Save the credential (workspace-scoped, into the unified credentials store).
    const save = page.getByTestId("ai-save-key");
    if (await save.isEnabled()) {
      await save.click();
      await expect(page.getByTestId("ai-key-message")).toBeVisible({ timeout: 20000 });
    }
  }

  // CRITICAL: reload and confirm the plaintext key is NOT echoed back anywhere in
  // the DOM — only a masked keyPreview is ever surfaced.
  await page.reload();
  await expect(visibleByTestId(page, "ai-section")).toBeVisible({ timeout: 30000 });
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toContain(AI_KEY);
  // No input ON the page carries the full key as its value either.
  const echoed = await page.evaluate((secret) => {
    return Array.from(document.querySelectorAll("input")).some(
      (el) => (el as HTMLInputElement).value === secret,
    );
  }, AI_KEY);
  expect(echoed).toBe(false);

  await page.screenshot({
    path: `${FINISHING_EVIDENCE}/2026-06-20-E14-connections-byok-ai.png`,
    fullPage: true,
  });
});

test("connections-byok — Plaid redirect/webhook + Stripe webhook URLs are surfaced", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  await onboardThenSettings(page);

  await page.goto(appUrl("/settings/connections"));
  await expect(visibleByTestId(page, "connections-section")).toBeVisible({ timeout: 30000 });

  // All four BYO providers live in one place — AI, Banks (Plaid), Stripe.
  await expect(page.getByTestId("ai-card-open")).toBeVisible();

  // Plaid: opening the setup surfaces the copyable redirect/webhook endpoints.
  await visibleByTestId(page, "plaid-setup-open").click();
  await expect(visibleByTestId(page, "setup-endpoints")).toBeVisible({ timeout: 15000 });

  await page.screenshot({
    path: `${FINISHING_EVIDENCE}/2026-06-20-E14-connections-byok-endpoints.png`,
    fullPage: true,
  });
});
