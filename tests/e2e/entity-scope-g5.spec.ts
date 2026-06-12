import { expect, test, type Page } from "@playwright/test";

// Epic G5 — selected entity is the read-model boundary. REAL pointer clicks
// only; fixture sync is allowed on the dedicated Live Sandbox entity, never the
// shared demo books.

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

async function ensureLiveSandboxData(page: Page) {
  await gotoApp(page, "/settings/connections");
  await expect(visibleByTestId(page, "connections-section")).toBeVisible({ timeout: 30000 });

  if ((await visibleByTestId(page, "plaid-connection-panel").count()) === 0) {
    await visibleByTestId(page, "live-sandbox-create").click();
    await expect(visibleByTestId(page, "plaid-connection-panel")).toBeVisible({ timeout: 30000 });
  }

  const panel = visibleByTestId(page, "plaid-connection-panel");
  await expect(panel).toBeVisible({ timeout: 30000 });

  if ((await visibleByTestId(page, "plaid-connected-accounts").count()) === 0) {
    await panel.getByRole("button", { name: /Use sandbox bypass/ }).click();
    await expect(visibleByTestId(page, "plaid-account-selection")).toBeVisible({ timeout: 120000 });
    await panel.getByRole("button", { name: /Create selected/ }).click();
    await expect(visibleByTestId(page, "plaid-connected-accounts")).toBeVisible({ timeout: 30000 });
  }

  await panel.getByRole("button", { name: /Sync fixture/ }).click();
  await expect(page.getByTestId("plaid-panel-message")).toContainText(/Synced|duplicates/i, {
    timeout: 120000,
  });
  await expect(visibleByTestId(page, "plaid-recent-transactions")).toContainText(
    /Notion|Client ACH|Plaid Sandbox Bank/i,
    { timeout: 30000 },
  );
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

async function archiveVisibleG5Businesses(page: Page) {
  await gotoApp(page, "/settings/businesses");
  const cards = page.locator('[data-testid^="business-card-"]').filter({ hasText: "G5 Fresh", visible: true });
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

test("G5 — Live Sandbox and fresh businesses drive dashboard, register, and reports", async ({ page }) => {
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  await ensureLiveSandboxData(page);

  await gotoApp(page, "/dashboard");
  await selectEntity(page, "Live Sandbox");
  await expect(page.locator("h1").first().locator("xpath=preceding-sibling::p[1]")).toContainText("Live Sandbox");

  await page.getByTestId("app-sidebar").getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(visibleByTestId(page, "transactions-screen")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("transaction-row").first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("transaction-row").first()).toContainText(/Notion|Client ACH|Plaid Sandbox Bank/i, {
    timeout: 30000,
  });
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-G5-live-sandbox-register.png`, fullPage: true });

  await page.getByTestId("app-sidebar").getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await visibleByTestId(page, "report-card-profit-and-loss").click();
  await expect(visibleByTestId(page, "reports-screen")).toContainText("Profit & Loss", { timeout: 30000 });
  await expect(page.locator("h1").first().locator("xpath=preceding-sibling::p[1]")).toContainText("Live Sandbox");
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-G5-live-sandbox-report.png`, fullPage: true });

  await archiveVisibleG5Businesses(page);
  const stamp = Date.now().toString().slice(-6);
  const businessName = `G5 Fresh ${stamp} LLC`;
  const slug = slugify(businessName);

  await visibleByTestId(page, "businesses-add").click();
  await expect(visibleByTestId(page, "add-business-modal")).toBeVisible();
  await visibleByTestId(page, "add-business-name").fill(businessName);
  await visibleByTestId(page, "add-business-currency").fill("USD");
  await visibleByTestId(page, "add-business-submit").click();
  await expect(page.getByTestId("add-business-modal")).toBeHidden({ timeout: 15000 });
  await expect(visibleByTestId(page, `business-card-${slug}`)).toBeVisible({ timeout: 15000 });

  await gotoApp(page, "/dashboard");
  await selectEntity(page, businessName);
  await expect(visibleByTestId(page, "dashboard-empty-entity")).toContainText(/Connect a bank or import CSV/i, {
    timeout: 30000,
  });
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-G5-fresh-dashboard-empty.png`, fullPage: true });

  await page.getByTestId("app-sidebar").getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(visibleByTestId(page, "transactions-empty")).toContainText(/Connect a bank or import CSV/i, {
    timeout: 30000,
  });

  await page.getByTestId("app-sidebar").getByRole("link", { name: "Reports", exact: true }).click();
  await visibleByTestId(page, "report-card-profit-and-loss").click();
  await expect(page.locator("h1").first().locator("xpath=preceding-sibling::p[1]")).toContainText(businessName);
  await expect(visibleByTestId(page, "reports-screen")).toContainText("Profit & Loss", { timeout: 30000 });
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-G5-fresh-report-empty.png`, fullPage: true });

  await archiveVisibleG5Businesses(page);
});
