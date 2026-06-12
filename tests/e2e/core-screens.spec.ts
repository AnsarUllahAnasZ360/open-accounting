import { expect, type Page, test } from "@playwright/test";

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
  if ((await option.getAttribute("aria-disabled")) === "true" || (await option.getAttribute("data-disabled")) !== null) {
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden({ timeout: 5000 });
    return;
  }
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

async function openTransactionDrawer(page: Page, merchant: string) {
  const row = page.getByTestId("transaction-row").filter({ hasText: merchant }).first();
  await expect(row).toBeVisible({ timeout: 30000 });
  const merchantCell = row.locator("td").nth(2);
  await expectClickable(merchantCell);
  await merchantCell.click();
  const drawer = visibleByTestId(page, "transaction-drawer");
  await expect(drawer).toBeVisible({ timeout: 15000 });
  return drawer;
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await installDevOverlayGuard(page);
  await page.goto("/dashboard");
  await page.evaluate(() => {
    try {
      window.localStorage.removeItem("ob:active-entity-id");
      window.localStorage.removeItem("ob:sidebar-collapsed");
    } catch {
      // ignore storage access errors
    }
  });
});

test("H1 — core register workflow uses real clicks on a disposable business", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const stamp = Date.now().toString().slice(-6);
  const businessName = `H1 Core ${stamp} LLC`;
  const manualMerchant = `H1 manual ${stamp}`;
  const csvMerchant = `H1 CSV ${stamp}`;

  try {
    await createBusiness(page, businessName);
    await gotoApp(page, "/dashboard");
    await selectEntity(page, businessName);
    await expect(visibleByTestId(page, "dashboard-screen")).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expectNoHorizontalScroll(page, 1440);
    await page.screenshot({
      path: `${FINISHING_EVIDENCE}/2026-06-12-H1-core-dashboard-disposable.png`,
      fullPage: true,
    });

    await gotoApp(page, "/transactions");
    await selectEntity(page, businessName);
    await expect(visibleByTestId(page, "transactions-screen")).toBeVisible({ timeout: 30000 });

    await visibleByTestId(page, "manual-merchant").fill(manualMerchant);
    await visibleByTestId(page, "manual-amount").fill("-84.00");
    await expectClickable(visibleByTestId(page, "manual-add"));
    await visibleByTestId(page, "manual-add").click();
    await expect(visibleByTestId(page, "transaction-message")).toContainText("Manual transaction imported", {
      timeout: 30000,
    });

    const manualDrawer = await openTransactionDrawer(page, manualMerchant);
    await expect(manualDrawer).toContainText("Balanced lines", { timeout: 15000 });
    await expect(manualDrawer.getByTestId("accounting-line").first()).toBeVisible();

    await expectClickable(visibleByTestId(page, "quick-recategorize"));
    await visibleByTestId(page, "quick-recategorize").click();
    await expect(visibleByTestId(page, "transaction-message")).toContainText("recategorized", {
      timeout: 30000,
    });
    await expect(manualDrawer).toContainText("ledger.entry.reversed", { timeout: 30000 });

    await expectClickable(visibleByTestId(page, "split-post"));
    await visibleByTestId(page, "split-post").click();
    await expect(visibleByTestId(page, "transaction-message")).toContainText("split", { timeout: 30000 });

    await visibleByTestId(page, "csv-text").fill(`date,description,amount\n2026-06-30,${csvMerchant},-25.00`);
    await expectClickable(visibleByTestId(page, "csv-import"));
    await visibleByTestId(page, "csv-import").click();
    await expect(visibleByTestId(page, "transaction-message")).toContainText("1 CSV row", {
      timeout: 30000,
    });
    await expect(page.getByTestId("transaction-row").filter({ hasText: csvMerchant }).first()).toBeVisible({
      timeout: 30000,
    });
    await page.screenshot({
      path: `${FINISHING_EVIDENCE}/2026-06-12-H1-core-register-real-clicks.png`,
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 1100 });
    await gotoApp(page, "/dashboard");
    await expect(visibleByTestId(page, "dashboard-screen")).toBeVisible({ timeout: 30000 });
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: `${FINISHING_EVIDENCE}/2026-06-12-H1-core-mobile-dashboard.png`,
      fullPage: true,
    });
  } finally {
    await page.setViewportSize({ width: 1440, height: 900 });
    await archiveBusiness(page, businessName).catch(() => undefined);
  }
});
