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

    // Manual add lives behind the single "+" AddMenu (E0 dialog migration; one
    // add entry point per E5.3): open the menu, pick Add transaction, then fill.
    await page.getByTestId("add-menu-trigger").click();
    await page.getByTestId("add-menu-add-transaction").click();
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

    // The split form lives inside a collapsed accordion in the redesigned drawer
    // (CollapsibleContent is unmounted until opened). Expand it via its toggle
    // before posting the split — defaults pre-fill both categories.
    await expectClickable(visibleByTestId(page, "split-toggle"));
    await visibleByTestId(page, "split-toggle").click();
    await expectClickable(visibleByTestId(page, "split-post"));
    await visibleByTestId(page, "split-post").click();
    await expect(visibleByTestId(page, "transaction-message")).toContainText("split", { timeout: 30000 });

    // E7-11 evidence: the drawer frames recategorize / split / exclude as a
    // reverse + repost correction (immutable-history language) above the
    // double-entry record — capture that "Correct this entry" section.
    await expect(manualDrawer.getByTestId("correct-entry-section")).toBeVisible({ timeout: 15000 });
    await expect(manualDrawer.getByTestId("correct-entry-section")).toContainText("reverses the original");
    await page.screenshot({
      path: `${FINISHING_EVIDENCE}/2026-06-20-E7-drawer-correct-entry.png`,
      fullPage: true,
    });

    // The redesigned detail surface is a modal DetailSheet that stays open and
    // covers the toolbar; close it before driving the toolbar AddMenu again.
    await page.keyboard.press("Escape");
    await expect(manualDrawer).toBeHidden({ timeout: 15000 });

    // CSV import is the Import item in the same single "+" AddMenu (E5.3).
    await page.getByTestId("add-menu-trigger").click();
    await page.getByTestId("add-menu-import").click();
    await visibleByTestId(page, "csv-text").fill(`date,description,amount\n2026-06-30,${csvMerchant},-25.00`);
    await expectClickable(visibleByTestId(page, "csv-import"));
    await visibleByTestId(page, "csv-import").click();
    await expect(visibleByTestId(page, "transaction-message")).toContainText("1 CSV row", {
      timeout: 30000,
    });
    await expect(page.getByTestId("transaction-row").filter({ hasText: csvMerchant }).first()).toBeVisible({
      timeout: 30000,
    });

    // E7-2/E7-4: every row carries exactly one provenance chip (Rule / Memory /
    // Matched / Imported / AI N% / Needs review / Manual), not an AI-only badge.
    const manualRow = page.getByTestId("transaction-row").filter({ hasText: manualMerchant }).first();
    await expect(manualRow.getByTestId("provenance-chip").first()).toBeVisible({ timeout: 15000 });

    // E7-3: the merchant cell is compact — no permanent raw-description line. The
    // expand chevron reveals the raw bank description inline (row-detail strip)
    // WITHOUT opening the drawer, and collapses again. The strip renders in a
    // SIBLING row (data-testid="row-expanded"), not inside the merchant row, so
    // scope the detail assertions to the page and disambiguate by merchant text
    // (the strip's Description field carries the merchant for a manual row).
    const expandToggle = manualRow.getByTestId("tx-expand-toggle").first();
    await expectClickable(expandToggle);
    await expandToggle.click();
    const detailStrip = page
      .getByTestId("row-expanded")
      .filter({ has: page.getByTestId("tx-row-detail") })
      .filter({ hasText: manualMerchant })
      .first();
    await expect(detailStrip).toBeVisible({ timeout: 15000 });
    // The detail strip is NOT the full drawer.
    await expect(page.getByTestId("transaction-drawer")).toBeHidden();
    // E7-11 evidence: the row-expand affordance open, revealing the raw bank
    // description / contact / account / source inline without the drawer.
    await page.screenshot({
      path: `${FINISHING_EVIDENCE}/2026-06-20-E7-row-expanded.png`,
      fullPage: true,
    });
    await expandToggle.click();
    await expect(
      page.getByTestId("row-expanded").filter({ hasText: manualMerchant }),
    ).toHaveCount(0, { timeout: 15000 });

    // E7-6: bulk Recategorize prompts for a TARGET category (no silent hardcoded
    // 'other income') and posts a reverse+repost for each selected row, reporting
    // the count. Select the manual row, open the picker, choose a category, confirm.
    const manualCheckbox = manualRow.getByRole("checkbox").first();
    await expectClickable(manualCheckbox);
    await manualCheckbox.click();
    await page.getByRole("button", { name: "Recategorize" }).first().click();
    await expect(visibleByTestId(page, "bulk-recategorize-dialog")).toBeVisible({ timeout: 15000 });
    await visibleByTestId(page, "bulk-recategorize-category").click();
    await page.getByRole("option").first().click();
    await expectClickable(visibleByTestId(page, "bulk-recategorize-confirm"));
    await visibleByTestId(page, "bulk-recategorize-confirm").click();
    await expect(visibleByTestId(page, "transaction-message")).toContainText("recategorized", {
      timeout: 30000,
    });

    await page.screenshot({
      path: `${FINISHING_EVIDENCE}/2026-06-12-H1-core-register-real-clicks.png`,
      fullPage: true,
    });

    // E7-11 evidence: exactly one compact insight banner above the register
    // (E8's reusable InsightBanner, page="transactions"). It is threshold-gated
    // (hidden when the page-insight builder returns null), so for this empty
    // disposable business it may not render — capture it only when present and
    // assert there is never more than one (no second/parallel banner).
    const insightBannerCount = await page.getByTestId("page-insight-banner").count();
    expect(insightBannerCount).toBeLessThanOrEqual(1);
    if (insightBannerCount === 1) {
      await page.screenshot({
        path: `${FINISHING_EVIDENCE}/2026-06-20-E7-insight-banner.png`,
        fullPage: true,
      });
    }

    // E7-5: the register itself must be a clean card list with NO horizontal
    // scroll at 390px WITH rows present (the prior 390px check only covered the
    // dashboard). The mobile card renders merchant + provenance, a right-aligned
    // amount, and the compact category/date meta line; secondary fields are
    // behind the expand strip, never a long label/value stack that overflows.
    await page.setViewportSize({ width: 390, height: 1100 });
    await gotoApp(page, "/transactions");
    await selectEntity(page, businessName);
    await expect(visibleByTestId(page, "transactions-screen")).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByTestId("transaction-row-card").filter({ hasText: manualMerchant }).first(),
    ).toBeVisible({ timeout: 30000 });
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: `${FINISHING_EVIDENCE}/2026-06-12-H1-core-mobile-register.png`,
      fullPage: true,
    });

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
