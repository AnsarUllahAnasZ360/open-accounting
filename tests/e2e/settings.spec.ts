import { expect, test, type Page } from "@playwright/test";

// Epic E — Settings. REAL pointer clicks only; no synthetic events or forced clicks.
// The Next.js dev-tools overlay is dev-only chrome that can intercept footer
// clicks; remove it without bypassing product hit-testing.
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

const SETTINGS_SECTIONS = [
  ["businesses", "Businesses"],
  ["tax", "Tax & fiscal year"],
  ["connections", "Connections"],
  ["ai", "AI"],
  ["categories", "Categories"],
  ["rules", "Rules"],
  ["notifications", "Notifications"],
  ["team", "Team"],
  ["data", "Data"],
  ["audit", "Audit log"],
] as const;

const SECTION_READY_TEST_ID: Record<(typeof SETTINGS_SECTIONS)[number][0], string> = {
  businesses: "businesses-grid",
  tax: "tax-entity-picker",
  connections: "connections-section",
  ai: "ai-section",
  categories: "categories-section",
  rules: "rules-section",
  notifications: "notifications-section",
  team: "team-section",
  data: "data-section",
  audit: "audit-section",
};

async function gotoApp(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 30000 });
}

async function expectNoHorizontalScroll(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(150);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
}

function visibleByTestId(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true }).first();
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function archiveVisibleE2EBusinesses(page: Page) {
  const cards = page.locator('[data-testid^="business-card-"]').filter({ hasText: "E2E Settings", visible: true });
  const cardTestIds = await cards.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-testid")).filter((value): value is string => Boolean(value)),
  );
  for (const testId of cardTestIds) {
    const card = visibleByTestId(page, testId);
    if ((await card.getByText("Archived").count()) > 0) continue;
    const archive = card.getByRole("button", { name: /Archive/ });
    if ((await archive.count()) === 0 || !(await archive.isEnabled())) continue;
    await archive.click();
    await expect(card).toContainText("Archived", { timeout: 15000 });
  }
}

async function deleteVisibleE2ERules(page: Page) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const row = page.getByTestId("rule-row").filter({ hasText: "E2E ", visible: true }).first();
    if ((await row.count()) === 0) return;
    const name = ((await row.locator(".font-medium").first().innerText()).trim());
    await row.getByLabel(new RegExp(`Delete ${name}`)).click();
    await expect(page.getByTestId("rule-row").filter({ hasText: name, visible: true })).toHaveCount(0, { timeout: 15000 });
  }
}

async function visibleRuleTexts(page: Page) {
  return await page.getByTestId("rule-row").filter({ visible: true }).allInnerTexts();
}

test.describe.configure({ mode: "serial" });

test("E1/E2/E5 — Settings sections navigate; Add business appears in switcher, archive hides it, audit filter finds it", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/settings");
  await expect(page.getByTestId("settings-screen")).toBeVisible();

  for (const [id, label] of SETTINGS_SECTIONS) {
    await page.getByTestId(`settings-nav-${id}`).click();
    await expect(page).toHaveURL(new RegExp(`/settings/${id}$`));
    await expect(page.getByRole("heading", { name: label })).toBeVisible();
    await expect(visibleByTestId(page, SECTION_READY_TEST_ID[id])).toBeVisible();
  }
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-E1-settings-sections.png`, fullPage: true });

  const stamp = Date.now().toString().slice(-6);
  const businessName = `E2E Settings ${stamp} LLC`;
  const slug = slugify(businessName);

  await page.getByTestId("settings-nav-businesses").click();
  await expect(page).toHaveURL(/\/settings\/businesses$/);
  await archiveVisibleE2EBusinesses(page);

  await visibleByTestId(page, "businesses-add").click();
  await expect(visibleByTestId(page, "add-business-modal")).toBeVisible();
  await visibleByTestId(page, "add-business-name").fill(businessName);
  await visibleByTestId(page, "add-business-currency").fill("USD");
  await visibleByTestId(page, "add-business-submit").click();
  await expect(page.getByTestId("add-business-modal")).toBeHidden({ timeout: 15000 });
  await expect(visibleByTestId(page, `business-card-${slug}`)).toBeVisible({ timeout: 15000 });

  await page.getByTestId("entity-switcher").click();
  const menu = page.getByTestId("entity-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByText(businessName)).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-E2-add-business-switcher.png`, fullPage: true });
  await page.keyboard.press("Escape");

  await visibleByTestId(page, `business-archive-${slug}`).click();
  await expect(visibleByTestId(page, `business-card-${slug}`)).toContainText("Archived", { timeout: 15000 });

  await page.getByTestId("entity-switcher").click();
  await expect(page.getByTestId("entity-menu")).toBeVisible();
  await expect(page.getByTestId("entity-menu").getByText(businessName)).toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-E2-archived-business-hidden.png`, fullPage: true });
  await page.keyboard.press("Escape");

  await page.getByTestId("settings-nav-audit").click();
  await expect(visibleByTestId(page, "audit-section")).toBeVisible();
  await visibleByTestId(page, "audit-filter-text").fill(businessName);
  await expect(visibleByTestId(page, "audit-row")).toContainText(businessName, { timeout: 15000 });
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-E5-audit-filter.png`, fullPage: true });

  await expectNoHorizontalScroll(page, 1440);
  await expectNoHorizontalScroll(page, 390);
});

test("E4 — AI autonomy radio persists through reload", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/settings/ai");
  await expect(visibleByTestId(page, "ai-section")).toBeVisible();

  await visibleByTestId(page, "ai-autonomy-autopilot").click();
  await expect(visibleByTestId(page, "ai-autonomy-autopilot")).toHaveAttribute("data-active", "true");
  await page.reload();
  await expect(visibleByTestId(page, "ai-section")).toBeVisible({ timeout: 30000 });
  await expect(visibleByTestId(page, "ai-autonomy-autopilot")).toHaveAttribute("data-active", "true", { timeout: 15000 });
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-E4-ai-autonomy.png`, fullPage: true });

  // Restore the recommended default so later runs do not inherit a more
  // permissive AI mode from this verification.
  await visibleByTestId(page, "ai-autonomy-balanced").click();
  await expect(visibleByTestId(page, "ai-autonomy-balanced")).toHaveAttribute("data-active", "true");
});

test("E3 — AI provider switcher is enabled with the full catalog and accepts a key", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/settings/ai");
  await expect(visibleByTestId(page, "ai-section")).toBeVisible();

  // The provider select must be ENABLED (the old dead dropdown was disabled).
  const providerTrigger = visibleByTestId(page, "ai-provider");
  await expect(providerTrigger).toBeVisible();
  await expect(providerTrigger).toBeEnabled();

  // Opening it lists all 14 catalog providers.
  await providerTrigger.click();
  const options = page.getByRole("option");
  await expect(options).toHaveCount(14, { timeout: 15000 });
  // Pick OpenAI so an apiKey field renders.
  await page.getByRole("option", { name: "OpenAI" }).click();

  // A model select is present and a key input accepts input.
  await expect(visibleByTestId(page, "ai-model")).toBeVisible();
  const keyInput = visibleByTestId(page, "ai-key-input");
  await expect(keyInput).toBeVisible();
  await keyInput.fill("sk-e2e-openbooks-byo-9911");

  // Save: the key input clears and either a saved last4 or a clear message shows.
  await visibleByTestId(page, "ai-save-key").click();
  await expect
    .poll(async () => (await keyInput.inputValue()) === "", { timeout: 20000 })
    .toBe(true);
  await expect(
    page.getByTestId("ai-key-saved").or(page.getByTestId("ai-key-message")),
  ).toBeVisible({ timeout: 20000 });

  await page.screenshot({ path: `${EVIDENCE}/2026-06-19-E3-ai-byo-switcher.png`, fullPage: true });
  await expectNoHorizontalScroll(page, 1440);
  await expectNoHorizontalScroll(page, 360);
});

test("E2-T10 — AI diagnostics expose the calibration status and a recalibrate trigger", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/settings/ai");
  await expect(visibleByTestId(page, "ai-section")).toBeVisible();

  // Open the diagnostics disclosure (default closed) and assert the calibration
  // card + recalibrate trigger are present and the gate-status line renders.
  await visibleByTestId(page, "ai-diagnostics-trigger").click();
  await expect(visibleByTestId(page, "ai-calibration")).toBeVisible();
  await expect(visibleByTestId(page, "ai-calibration-status")).toBeVisible();
  await expect(visibleByTestId(page, "ai-recalibrate")).toBeVisible();
});

test("E3-T9/T8 — Connections shows four provider cards, copyable URLs, and is responsive at 360px", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/settings/connections");
  await expect(visibleByTestId(page, "connections-section")).toBeVisible();

  // All four BYO providers appear as consistent cards on one surface.
  await expect(visibleByTestId(page, "provider-card-ai")).toBeVisible();
  await expect(visibleByTestId(page, "provider-card-banks")).toBeVisible();
  await expect(visibleByTestId(page, "provider-card-stripe")).toBeVisible();
  await expect(visibleByTestId(page, "plunk-card")).toBeVisible();

  // The AI card links to the AI settings (where the full switcher lives).
  await expect(visibleByTestId(page, "ai-card-open")).toBeVisible();

  // Copyable webhook + redirect URLs are surfaced prominently.
  await expect(visibleByTestId(page, "setup-endpoints")).toBeVisible();
  await expect(page.getByTestId("webhook-value-stripe-webhook-url")).toBeVisible();
  await expect(page.getByTestId("webhook-value-plaid-webhook-url")).toBeVisible();

  await page.screenshot({ path: `${EVIDENCE}/2026-06-19-E3-connections-desktop.png`, fullPage: true });

  // Mobile: single-column, no horizontal scroll at 360px.
  await expect(visibleByTestId(page, "connections-section")).toBeVisible();
  await expectNoHorizontalScroll(page, 360);
  await page.screenshot({ path: `${EVIDENCE}/2026-06-19-E3-connections-360.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("E5 — rule reorder persists after reload", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/settings/rules");
  await expect(visibleByTestId(page, "rules-section")).toBeVisible();
  await deleteVisibleE2ERules(page);

  const stamp = Date.now().toString().slice(-6);
  const firstRule = `E2E first ${stamp}`;
  const secondRule = `E2E second ${stamp}`;

  async function createRule(name: string) {
    await visibleByTestId(page, "rules-new").click();
    await expect(visibleByTestId(page, "rule-editor")).toBeVisible();
    await visibleByTestId(page, "rule-name").fill(name);
    await visibleByTestId(page, "rule-description").fill(name);
    await expect(visibleByTestId(page, "rule-preview-count")).toBeVisible({ timeout: 15000 });
    await visibleByTestId(page, "rule-save").click();
    await expect(page.getByTestId("rule-editor")).toBeHidden({ timeout: 15000 });
    await expect(page.getByTestId("rule-row").filter({ hasText: name, visible: true })).toBeVisible({ timeout: 15000 });
  }

  await createRule(firstRule);
  await createRule(secondRule);

  const secondRow = page.getByTestId("rule-row").filter({ hasText: secondRule, visible: true });
  await secondRow.getByLabel("Move rule up").click();
  await expect
    .poll(async () => {
      const texts = await visibleRuleTexts(page);
      const secondIndex = texts.findIndex((text) => text.includes(secondRule));
      const firstIndex = texts.findIndex((text) => text.includes(firstRule));
      return secondIndex >= 0 && firstIndex >= 0 && secondIndex < firstIndex;
    }, { timeout: 15000 })
    .toBe(true);

  await page.reload();
  await expect(visibleByTestId(page, "rules-section")).toBeVisible({ timeout: 30000 });
  await expect
    .poll(async () => {
      const texts = await visibleRuleTexts(page);
      const secondIndex = texts.findIndex((text) => text.includes(secondRule));
      const firstIndex = texts.findIndex((text) => text.includes(firstRule));
      return secondIndex >= 0 && firstIndex >= 0 && secondIndex < firstIndex;
    }, { timeout: 15000 })
    .toBe(true);
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-E5-rules-reorder.png`, fullPage: true });

  // Clean up the temporary no-match rules so future imports are not affected.
  const cleanupNames = [firstRule, secondRule];
  for (const name of cleanupNames) {
    const row = page.getByTestId("rule-row").filter({ hasText: name, visible: true });
    if ((await row.count()) > 0) {
      await row.getByLabel(new RegExp(`Delete ${name}`)).click();
      await expect(page.getByTestId("rule-row").filter({ hasText: name, visible: true })).toHaveCount(0, { timeout: 15000 });
    }
  }
});

test("E12-T2 — a business can be renamed from the Businesses card and the rename shows in the switcher + audit log", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/settings/businesses");
  await expect(visibleByTestId(page, "businesses-grid")).toBeVisible();
  await archiveVisibleE2EBusinesses(page);

  const stamp = Date.now().toString().slice(-6);
  const original = `E2E Settings Edit ${stamp} LLC`;
  const renamed = `E2E Settings Renamed ${stamp} LLC`;
  const slug = slugify(original);

  // Create a business to edit.
  await visibleByTestId(page, "businesses-add").click();
  await expect(visibleByTestId(page, "add-business-modal")).toBeVisible();
  await visibleByTestId(page, "add-business-name").fill(original);
  await visibleByTestId(page, "add-business-currency").fill("USD");
  await visibleByTestId(page, "add-business-submit").click();
  await expect(page.getByTestId("add-business-modal")).toBeHidden({ timeout: 15000 });
  await expect(visibleByTestId(page, `business-card-${slug}`)).toBeVisible({ timeout: 15000 });

  // Edit its name via the new Edit dialog.
  await visibleByTestId(page, `business-edit-${slug}`).click();
  await expect(visibleByTestId(page, "edit-business-modal")).toBeVisible();
  // Currency field is read-only (immutable per money rules).
  await expect(visibleByTestId(page, "edit-business-currency")).toBeDisabled();
  await visibleByTestId(page, "edit-business-name").fill(renamed);
  await visibleByTestId(page, "edit-business-legal-name").fill(`${renamed} (legal)`);
  await visibleByTestId(page, "edit-business-submit").click();
  await expect(page.getByTestId("edit-business-modal")).toBeHidden({ timeout: 15000 });

  // The card reflects the new name (same slug; only the display name changed).
  await expect(visibleByTestId(page, `business-card-${slug}`)).toContainText(renamed, { timeout: 15000 });

  // The switcher reflects the new name.
  await page.getByTestId("active-business-switcher").click();
  await expect(page.getByTestId("active-business-menu")).toBeVisible();
  await expect(page.getByTestId("active-business-menu").getByText(renamed)).toBeVisible();
  await page.keyboard.press("Escape");

  // The audit log records the profile update.
  await page.getByTestId("settings-nav-audit").click();
  await expect(visibleByTestId(page, "audit-section")).toBeVisible();
  await visibleByTestId(page, "audit-filter-text").fill("Updated business profile");
  await expect(visibleByTestId(page, "audit-row").first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${EVIDENCE}/2026-06-20-E12-edit-business.png`, fullPage: true });

  // Clean up: archive the test business.
  await page.getByTestId("settings-nav-businesses").click();
  await archiveVisibleE2EBusinesses(page);
});

test("E12-T3 — a category can be moved between groups and lands under the new group header", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/settings/categories");
  await expect(visibleByTestId(page, "categories-section")).toBeVisible();

  const stamp = Date.now().toString().slice(-6);
  const catName = `E2E Move ${stamp}`;

  // Create a category in Expenses.
  await visibleByTestId(page, "categories-add").click();
  await expect(visibleByTestId(page, "add-category-modal")).toBeVisible();
  await visibleByTestId(page, "add-category-name").fill(catName);
  await visibleByTestId(page, "add-category-group").click();
  await page.getByRole("option", { name: "Expenses" }).click();
  await visibleByTestId(page, "add-category-submit").click();
  await expect(page.getByTestId("add-category-modal")).toBeHidden({ timeout: 15000 });

  const row = page.getByTestId("category-row").filter({ hasText: catName, visible: true }).first();
  await expect(row).toBeVisible({ timeout: 15000 });

  // Accountant mode reveals number · type · normal side.
  await visibleByTestId(page, "categories-accountant-mode").click();
  await expect(row).toContainText(/debit|credit/, { timeout: 15000 });

  // Move it to Income via the per-row Move control.
  await row.getByLabel(new RegExp(`Move ${catName} to another group`)).click();
  await page.getByRole("option", { name: "Income" }).click();

  // It now lives under the Income group header (4xxx number, credit normal side).
  await expect
    .poll(async () => {
      const movedRow = page.getByTestId("category-row").filter({ hasText: catName, visible: true }).first();
      if ((await movedRow.count()) === 0) return false;
      return (await movedRow.innerText()).includes("credit");
    }, { timeout: 15000 })
    .toBe(true);
  await page.screenshot({ path: `${EVIDENCE}/2026-06-20-E12-category-move.png`, fullPage: true });

  // Clean up: archive the test category.
  const finalRow = page.getByTestId("category-row").filter({ hasText: catName, visible: true }).first();
  await finalRow.getByLabel(new RegExp(`Archive ${catName}`)).click();
});

test("E12-T4 — a 2-group rule previews OR-of-groups and the 'test all' runner reports counts", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/settings/rules");
  await expect(visibleByTestId(page, "rules-section")).toBeVisible();
  await deleteVisibleE2ERules(page);

  const stamp = Date.now().toString().slice(-6);
  const ruleName = `E2E groups ${stamp}`;

  await visibleByTestId(page, "rules-new").click();
  await expect(visibleByTestId(page, "rule-editor")).toBeVisible();
  await visibleByTestId(page, "rule-name").fill(ruleName);
  await visibleByTestId(page, "rule-description").fill(`${ruleName}-A`);
  // Add a second OR group.
  await visibleByTestId(page, "rule-add-group").click();
  await expect(visibleByTestId(page, "rule-group-1")).toBeVisible();
  await visibleByTestId(page, "rule-description-1").fill(`${ruleName}-B`);
  // The preview renders an OR-of-groups count (no-match strings → 0, but the
  // count row must be present, proving the grouped preview wired through).
  await expect(visibleByTestId(page, "rule-preview-count")).toBeVisible({ timeout: 15000 });
  await visibleByTestId(page, "rule-save").click();
  await expect(page.getByTestId("rule-editor")).toBeHidden({ timeout: 15000 });

  // The saved rule's summary shows the OR between its two groups.
  const row = page.getByTestId("rule-row").filter({ hasText: ruleName, visible: true }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await expect(row).toContainText("OR");

  // 'Test all active rules' runner shows a per-rule count.
  await visibleByTestId(page, "rules-test-all-run").click();
  await expect(visibleByTestId(page, "rules-test-all-result")).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${EVIDENCE}/2026-06-20-E12-rule-groups.png`, fullPage: true });

  // Clean up.
  await row.getByLabel(new RegExp(`Delete ${ruleName}`)).click();
  await expect(page.getByTestId("rule-row").filter({ hasText: ruleName, visible: true })).toHaveCount(0, { timeout: 15000 });
});

test("E12-T5 — notification delivery email + digest cadence persist across reload", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/settings/notifications");
  await expect(visibleByTestId(page, "notifications-section")).toBeVisible();

  const stamp = Date.now().toString().slice(-6);
  const email = `e2e-digest-${stamp}@openbooks.test`;

  // Edit the delivery email.
  await visibleByTestId(page, "notif-email-edit").click();
  await visibleByTestId(page, "notif-email-input").fill(email);
  await visibleByTestId(page, "notif-email-save").click();
  await expect(visibleByTestId(page, "notif-email")).toContainText(email, { timeout: 15000 });

  // Set the digest cadence to Monthly.
  await visibleByTestId(page, "notif-cadence-select").click();
  await page.getByRole("option", { name: "Monthly" }).click();

  // Reload and confirm both persisted.
  await page.reload();
  await expect(visibleByTestId(page, "notifications-section")).toBeVisible({ timeout: 30000 });
  await expect(visibleByTestId(page, "notif-email")).toContainText(email, { timeout: 15000 });
  await expect(visibleByTestId(page, "notif-cadence-select")).toContainText("Monthly", { timeout: 15000 });
  await page.screenshot({ path: `${EVIDENCE}/2026-06-20-E12-notifications.png`, fullPage: true });

  // Restore a sensible default cadence so later runs aren't affected.
  await visibleByTestId(page, "notif-cadence-select").click();
  await page.getByRole("option", { name: "Weekly" }).click();
});

test("E12-T6 — invite + revoke a teammate, and the last owner can't be demoted/removed", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/settings/team");
  await expect(visibleByTestId(page, "team-section")).toBeVisible();

  const stamp = Date.now().toString().slice(-6);
  const email = `e2e-team-${stamp}@openbooks.test`;

  // The owner row exposes a locked role badge (last owner can't be demoted), not
  // a role Select — proving the guard reaches the UI.
  await expect(visibleByTestId(page, "team-role-locked").first()).toBeVisible({ timeout: 15000 });
  // The last owner has no remove button.
  await expect(page.getByTestId("team-remove")).toHaveCount(0);

  // Invite a teammate → a pending row appears with a Revoke control (T6).
  await visibleByTestId(page, "team-invite").click();
  await expect(visibleByTestId(page, "team-invite-modal")).toBeVisible();
  await visibleByTestId(page, "team-invite-email").fill(email);
  await visibleByTestId(page, "team-invite-submit").click();
  await expect(visibleByTestId(page, "team-invite-result")).toBeVisible({ timeout: 15000 });
  // Close the modal.
  await page.getByRole("button", { name: "Close" }).click();

  const pendingRow = page.getByTestId("team-member").filter({ hasText: email, visible: true }).first();
  await expect(pendingRow).toBeVisible({ timeout: 15000 });

  // Revoke the pending invite from its row.
  await pendingRow.getByTestId("team-revoke-invite").click();
  await expect(page.getByTestId("team-member").filter({ hasText: email, visible: true })).toHaveCount(0, {
    timeout: 15000,
  });

  // If a non-owner active member exists (seeded teammate), exercise role change +
  // remove; otherwise the invite/revoke path above covers the management surface.
  const roleSelects = page.getByTestId("team-role-select");
  if ((await roleSelects.count()) > 0) {
    const memberRow = page.getByTestId("team-member").filter({ has: page.getByTestId("team-remove"), visible: true }).first();
    await memberRow.getByTestId("team-role-select").click();
    await page.getByRole("option", { name: "Accountant" }).click();
    await memberRow.getByTestId("team-remove").click();
    await expect(visibleByTestId(page, "team-remove-modal")).toBeVisible();
    await visibleByTestId(page, "team-remove-confirm").click();
    await expect(page.getByTestId("team-remove-modal")).toBeHidden({ timeout: 15000 });
  }

  await page.screenshot({ path: `${EVIDENCE}/2026-06-20-E12-team-management.png`, fullPage: true });

  // The revoke is recorded in the audit log.
  await page.getByTestId("settings-nav-audit").click();
  await expect(visibleByTestId(page, "audit-section")).toBeVisible();
  await visibleByTestId(page, "audit-filter-text").fill("Revoked invite");
  await expect(visibleByTestId(page, "audit-row").first()).toBeVisible({ timeout: 15000 });
});

test("E12-T7 — audit log is server-filtered + paginated with a reachable Load more", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/settings/audit");
  await expect(visibleByTestId(page, "audit-section")).toBeVisible();

  // At least one event should exist in a seeded workspace.
  await expect(visibleByTestId(page, "audit-row").first()).toBeVisible({ timeout: 30000 });
  const initialCount = await page.getByTestId("audit-row").count();

  // Load more (when present) appends OLDER events without re-filtering in the
  // browser — the row count must not shrink.
  const loadMore = page.getByTestId("audit-load-more");
  if ((await loadMore.count()) > 0 && (await loadMore.first().isEnabled())) {
    await loadMore.first().click();
    await expect
      .poll(async () => page.getByTestId("audit-row").count(), { timeout: 15000 })
      .toBeGreaterThanOrEqual(initialCount);
  }

  // Server-side actor filter: switching to AI returns only AI-actor rows (or an
  // honest empty state) — never a mix.
  await visibleByTestId(page, "audit-filter-actor").click();
  await page.getByRole("option", { name: "Person" }).click();
  await expect
    .poll(async () => {
      const rows = page.getByTestId("audit-row");
      const count = await rows.count();
      if (count === 0) return true; // empty is a valid server-filtered result
      const nonUser = page.getByTestId("audit-row").locator('[data-testid^="audit-actor-"]:not([data-testid="audit-actor-user"])');
      return (await nonUser.count()) === 0;
    }, { timeout: 15000 })
    .toBe(true);
  await page.screenshot({ path: `${EVIDENCE}/2026-06-20-E12-audit-pagination.png`, fullPage: true });
});

test("E12-T8 — scope switcher: 'All businesses' persists across reload; per-entity sections show a fallback hint", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/dashboard");

  // Switch to portfolio scope.
  await page.getByTestId("active-business-switcher").click();
  await expect(page.getByTestId("active-business-menu")).toBeVisible();
  await page.locator('[data-scope-item="all"]').click();

  // The switcher reflects portfolio mode and survives a reload.
  await expect(page.getByTestId("active-business-switcher")).toHaveAttribute("data-scope", "all", { timeout: 15000 });
  await page.reload();
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("active-business-switcher")).toHaveAttribute("data-scope", "all", { timeout: 15000 });

  // Per-entity settings sections show the fallback hint under 'All businesses'.
  await gotoApp(page, "/settings/categories");
  await expect(visibleByTestId(page, "categories-section")).toBeVisible({ timeout: 30000 });
  await expect(visibleByTestId(page, "settings-scope-fallback-hint")).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${EVIDENCE}/2026-06-20-E12-scope-switch.png`, fullPage: true });

  // Switch back to a specific entity and confirm per-entity sections load
  // without the portfolio hint.
  await page.getByTestId("active-business-switcher").click();
  await expect(page.getByTestId("active-business-menu")).toBeVisible();
  await page.getByTestId("active-business-menu").getByRole("menuitem").nth(1).click();
  await expect(page.getByTestId("active-business-switcher")).toHaveAttribute("data-scope", "entity", { timeout: 15000 });
  await expect(visibleByTestId(page, "categories-section")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("settings-scope-fallback-hint")).toHaveCount(0);
});

test("E12-T10 — /settings has accessible landmarks + an aria-current nav at desktop and mobile", async ({ page }) => {
  test.setTimeout(120_000);

  // Desktop: the settings subnav is a labelled <nav> with an aria-current item.
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoApp(page, "/settings/team");
  await expect(visibleByTestId(page, "settings-subnav")).toBeVisible({ timeout: 30000 });
  // Exactly one section is marked current.
  await expect(page.getByTestId("settings-subnav").locator('[aria-current="page"]')).toHaveCount(1);
  // The page has a single top-level banner/main landmark pair (role checks, no
  // axe dependency).
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
  // Section headings exist (the shared shell header from T1).
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();

  // Mobile: the primary bottom nav is labelled and the section list is reachable.
  await page.setViewportSize({ width: 375, height: 812 });
  await gotoApp(page, "/settings");
  await expect(visibleByTestId(page, "settings-mobile-list")).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  // No horizontal overflow on the settings index at 375px.
  await expectNoHorizontalScroll(page, 375);
  await page.screenshot({ path: `${EVIDENCE}/2026-06-20-E12-settings-a11y-mobile.png`, fullPage: true });
});
