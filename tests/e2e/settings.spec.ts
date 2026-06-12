import { expect, test, type Page } from "@playwright/test";

// Epic E — Settings. REAL pointer clicks only (no dispatchEvent / force:true).
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
  const count = await cards.count();
  for (let index = 0; index < count; index += 1) {
    const card = cards.nth(index);
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
