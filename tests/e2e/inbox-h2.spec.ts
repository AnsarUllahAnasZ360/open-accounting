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

async function itemMerchantAt(page: Page, index: number) {
  const item = page.getByTestId("inbox-item").nth(index);
  return (await item.locator(".font-medium").first().innerText()).trim();
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

test("H2 — Inbox keyboard, correction, rule save, confirm, and batch actions work on disposable books", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const stamp = Date.now().toString().slice(-6);
  const businessName = `H2 Inbox ${stamp} LLC`;
  const merchants = [
    `H2 Unknown Ambiguous Review Alpha ${stamp}`,
    `H2 Unknown Ambiguous Review Beta ${stamp}`,
    `H2 Unknown Ambiguous Review Gamma ${stamp}`,
    `H2 Unknown Ambiguous Review Delta ${stamp}`,
  ];

  try {
    await createBusiness(page, businessName);
    await gotoApp(page, "/transactions");
    await selectEntity(page, businessName);
    await expect(visibleByTestId(page, "transactions-screen")).toBeVisible({ timeout: 30000 });

    await visibleByTestId(page, "csv-text").fill(
      `date,description,amount\n${merchants.map((merchant, index) => `2026-06-30,${merchant},-${25 + index}.00`).join("\n")}`,
    );
    await expectClickable(visibleByTestId(page, "csv-import"));
    await visibleByTestId(page, "csv-import").click();
    const message = visibleByTestId(page, "transaction-message");
    await expect(message).toContainText(/AI batch/i, { timeout: 60000 });
    await expect(message).toContainText(/updated for review/i, { timeout: 60000 });

    await gotoApp(page, "/inbox");
    await selectEntity(page, businessName);
    await expect(visibleByTestId(page, "inbox-list")).toBeVisible({ timeout: 30000 });
    await expect
      .poll(async () => page.getByTestId("inbox-item").count(), { timeout: 60000 })
      .toBeGreaterThanOrEqual(3);

    const firstMerchant = await itemMerchantAt(page, 0);
    const secondMerchant = await itemMerchantAt(page, 1);
    await expectClickable(page.getByTestId("inbox-item").nth(0));
    await page.getByTestId("inbox-item").nth(0).click();
    await expect(visibleByTestId(page, "inbox-detail-title")).toHaveText(firstMerchant);
    await page.keyboard.press("j");
    await expect(visibleByTestId(page, "inbox-detail-title")).toHaveText(secondMerchant);
    await page.keyboard.press("k");
    await expect(visibleByTestId(page, "inbox-detail-title")).toHaveText(firstMerchant);

    await expectClickable(visibleByTestId(page, "inbox-category-select"));
    await visibleByTestId(page, "inbox-category-select").click();
    const travelOption = page.getByRole("option").filter({ hasText: "5900 - Travel" }).first();
    await expectClickable(travelOption);
    await travelOption.click();

    await expectClickable(visibleByTestId(page, "inbox-save-rule"));
    await visibleByTestId(page, "inbox-save-rule").click();
    await expect(visibleByTestId(page, "inbox-message")).toContainText("Rule saved", { timeout: 30000 });
    await page.screenshot({
      path: `${FINISHING_EVIDENCE}/2026-06-12-H2-inbox-correction-rule.png`,
      fullPage: true,
    });

    const beforeConfirmCount = await page.getByTestId("inbox-item").count();
    await expectClickable(visibleByTestId(page, "inbox-confirm"));
    await visibleByTestId(page, "inbox-confirm").click();
    await expect(visibleByTestId(page, "inbox-message")).toContainText("confirmed and posted", { timeout: 30000 });
    await expect
      .poll(async () => page.getByTestId("inbox-item").count(), { timeout: 30000 })
      .toBeLessThan(beforeConfirmCount);

    const remainingItems = page.getByTestId("inbox-item");
    await expect.poll(async () => remainingItems.count(), { timeout: 30000 }).toBeGreaterThanOrEqual(2);
    const beforeBatchCount = await remainingItems.count();
    const batchCount = Math.min(2, beforeBatchCount);
    for (let index = 0; index < batchCount; index += 1) {
      const checkbox = remainingItems.nth(index).getByRole("checkbox");
      await expectClickable(checkbox);
      await checkbox.click();
    }

    const batchButton = visibleByTestId(page, "inbox-confirm-selected");
    await expect(batchButton).toBeEnabled({ timeout: 15000 });
    await expectClickable(batchButton);
    await page.screenshot({
      path: `${FINISHING_EVIDENCE}/2026-06-12-H2-inbox-batch-selected.png`,
      fullPage: true,
    });
    await batchButton.click();
    await expect
      .poll(async () => page.getByTestId("inbox-item").count(), { timeout: 30000 })
      .toBe(beforeBatchCount - batchCount);
    if (beforeBatchCount - batchCount === 0) {
      await expect(page.getByText("Inbox zero", { exact: true })).toBeVisible();
    } else {
      await expect(visibleByTestId(page, "inbox-message")).toContainText(`${batchCount} Inbox cards confirmed`, {
        timeout: 30000,
      });
    }
    await expectNoHorizontalScroll(page, 1440);
    await page.screenshot({
      path: `${FINISHING_EVIDENCE}/2026-06-12-H2-inbox-keyboard-batch.png`,
      fullPage: true,
    });
  } finally {
    await archiveBusiness(page, businessName).catch(() => undefined);
  }
});
