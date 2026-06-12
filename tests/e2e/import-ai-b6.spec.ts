import { expect, test, type Page } from "@playwright/test";

const EVIDENCE = "docs/finishing/evidence";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const strip = () =>
      document
        .querySelectorAll("nextjs-portal, [data-nextjs-dev-overlay]")
        .forEach((node) => node.remove());
    strip();
    new MutationObserver(strip).observe(document.documentElement, { childList: true, subtree: true });
    try {
      window.localStorage.removeItem("ob:active-entity-id");
      window.localStorage.removeItem("ob:sidebar-collapsed");
    } catch {
      // ignore storage access errors
    }
  });
});

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

async function gotoApp(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 30000 });
}

async function createBusiness(page: Page, businessName: string) {
  const slug = slugify(businessName);
  await gotoApp(page, "/settings/businesses");
  await visibleByTestId(page, "businesses-add").click();
  await expect(visibleByTestId(page, "add-business-modal")).toBeVisible();
  await visibleByTestId(page, "add-business-name").fill(businessName);
  await visibleByTestId(page, "add-business-currency").fill("USD");
  await visibleByTestId(page, "add-business-submit").click();
  await expect(page.getByTestId("add-business-modal")).toBeHidden({ timeout: 15000 });
  await expect(visibleByTestId(page, `business-card-${slug}`)).toBeVisible({ timeout: 15000 });
}

async function selectEntity(page: Page, name: string) {
  const switcher = page.getByTestId("entity-switcher");
  if ((await switcher.innerText()).includes(name)) return;
  await switcher.click();
  const menu = page.getByTestId("entity-menu");
  await expect(menu).toBeVisible();
  const option = menu.locator('[role="menuitem"]').filter({ hasText: name }).first();
  await expect(option).toBeVisible({ timeout: 15000 });
  await option.click();
  await expect(switcher).toContainText(name, { timeout: 15000 });
}

async function archiveBusiness(page: Page, businessName: string) {
  const slug = slugify(businessName);
  await gotoApp(page, "/settings/businesses");
  const card = visibleByTestId(page, `business-card-${slug}`);
  if ((await card.count()) === 0 || (await card.getByText("Archived").count()) > 0) return;
  await visibleByTestId(page, `business-archive-${slug}`).click();
  await expect(card).toContainText("Archived", { timeout: 15000 });
}

test("B6 — CSV import triggers AI batch history without mutating shared demo books", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const stamp = Date.now().toString().slice(-6);
  const businessName = `B6 CSV ${stamp} LLC`;
  const firstMerchant = `B6 Review Software ${stamp}`;
  const secondMerchant = `B6 Review Supplies ${stamp}`;

  await createBusiness(page, businessName);
  await gotoApp(page, "/transactions");
  await selectEntity(page, businessName);
  await expect(visibleByTestId(page, "transactions-screen")).toBeVisible({ timeout: 30000 });

  await visibleByTestId(page, "csv-text").fill(
    `date,description,amount\n2026-06-30,${firstMerchant},-25.00\n2026-06-30,${secondMerchant},-18.00`,
  );
  await visibleByTestId(page, "csv-import").click();
  await expect(visibleByTestId(page, "transaction-message")).toContainText(/AI batch/i, { timeout: 60000 });
  await expect(page.getByTestId("transaction-row").filter({ hasText: secondMerchant }).first()).toBeVisible({
    timeout: 15000,
  });

  await page.getByTestId("app-sidebar").getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByTestId("settings-nav-ai").click();
  await expect(visibleByTestId(page, "ai-section")).toBeVisible({ timeout: 30000 });
  const batchHistory = visibleByTestId(page, "ai-batch-history");
  await expect(batchHistory).toContainText(/checked/i, { timeout: 30000 });
  await expect(batchHistory).toContainText(/degraded|completed|partial/i);
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-B6-csv-ai-batch-history.png`, fullPage: true });

  await archiveBusiness(page, businessName);
});
