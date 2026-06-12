import { expect, test, type Page } from "@playwright/test";

import {
  expectClickable,
  expectNoHorizontalScroll,
  FINISHING_EVIDENCE,
  gotoApp,
  installDevOverlayGuard,
  visibleByTestId,
} from "./helpers";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
}

async function createBusiness(page: Page, businessName: string) {
  const slug = slugify(businessName);
  await gotoApp(page, "/settings/businesses");
  await expectClickable(visibleByTestId(page, "businesses-add"));
  await visibleByTestId(page, "businesses-add").click();
  await expect(visibleByTestId(page, "add-business-modal")).toBeVisible();
  await visibleByTestId(page, "add-business-name").fill(businessName);
  await visibleByTestId(page, "add-business-currency").fill("USD");
  await expectClickable(visibleByTestId(page, "add-business-submit"));
  await visibleByTestId(page, "add-business-submit").click();
  await expect(page.getByTestId("add-business-modal")).toBeHidden({ timeout: 15000 });
  await expect(visibleByTestId(page, `business-card-${slug}`)).toBeVisible({ timeout: 15000 });
}

async function selectEntity(page: Page, name: string) {
  const switcher = page.getByTestId("entity-switcher");
  if ((await switcher.innerText()).includes(name)) return;
  await expectClickable(switcher);
  await switcher.click();
  const menu = page.getByTestId("entity-menu");
  await expect(menu).toBeVisible();
  const option = menu.locator('[role="menuitem"]').filter({ hasText: name }).first();
  await expectClickable(option);
  await option.click();
  await expect(switcher).toContainText(name, { timeout: 15000 });
}

async function archiveBusiness(page: Page, businessName: string) {
  const slug = slugify(businessName);
  await gotoApp(page, "/settings/businesses");
  const card = visibleByTestId(page, `business-card-${slug}`);
  if ((await card.count()) === 0 || (await card.getByText("Archived").count()) > 0) return;
  const archive = visibleByTestId(page, `business-archive-${slug}`);
  await expectClickable(archive);
  await archive.click();
  await expect(card).toContainText("Archived", { timeout: 15000 });
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await installDevOverlayGuard(page);
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem("ob:active-entity-id");
      window.localStorage.removeItem("ob:sidebar-collapsed");
    } catch {
      // Local storage can be unavailable in unusual browser contexts.
    }
  });
});

test("H2 — a real posting action appears in Settings audit log", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const stamp = Date.now().toString().slice(-6);
  const businessName = `H2 Audit ${stamp} LLC`;
  const merchant = `H2 Audit Merchant ${stamp}`;

  try {
    await createBusiness(page, businessName);

    await gotoApp(page, "/transactions");
    await selectEntity(page, businessName);
    await expect(visibleByTestId(page, "transactions-screen")).toBeVisible({ timeout: 30000 });
    await visibleByTestId(page, "manual-merchant").fill(merchant);
    await visibleByTestId(page, "manual-amount").fill("-42.00");
    await expectClickable(visibleByTestId(page, "manual-add"));
    await visibleByTestId(page, "manual-add").click();
    await expect(visibleByTestId(page, "transaction-message")).toContainText("Manual transaction imported", {
      timeout: 30000,
    });

    await gotoApp(page, "/settings/audit");
    await selectEntity(page, businessName);
    await expect(visibleByTestId(page, "audit-section")).toBeVisible({ timeout: 30000 });
    await visibleByTestId(page, "audit-filter-text").fill(merchant);
    const row = visibleByTestId(page, "audit-row");
    await expect(row).toContainText(merchant, { timeout: 30000 });
    await expect(row).toContainText("seeded category");
    await expect(row).toContainText("4200 USD");
    await expectNoHorizontalScroll(page, 1440);
    await page.screenshot({
      path: `${FINISHING_EVIDENCE}/2026-06-12-H2-audit-posting-trace.png`,
      fullPage: true,
    });
  } finally {
    await archiveBusiness(page, businessName).catch(() => undefined);
  }
});
