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
  if ((await option.getAttribute("aria-disabled")) === "true") {
    await page.keyboard.press("Escape");
    return;
  }
  await option.click();
  await expect(switcher).toContainText(name, { timeout: 15000 });
}

async function setAiAutonomy(page: Page, mode: "balanced" | "autopilot") {
  await gotoApp(page, "/settings/ai");
  await expect(visibleByTestId(page, "ai-section")).toBeVisible({ timeout: 30000 });
  const button = visibleByTestId(page, `ai-autonomy-${mode}`);
  await button.click();
  await expect(button).toHaveAttribute("data-active", "true", { timeout: 15000 });
}

async function archiveBusiness(page: Page, businessName: string) {
  const slug = slugify(businessName);
  await gotoApp(page, "/settings/businesses");
  const card = visibleByTestId(page, `business-card-${slug}`);
  if ((await card.count()) === 0 || (await card.getByText("Archived").count()) > 0) return;
  await visibleByTestId(page, `business-archive-${slug}`).click();
  await expect(card).toContainText("Archived", { timeout: 15000 });
}

test("B6 — CSV import produces live Bedrock high/low split without mutating shared demo books", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const stamp = Date.now().toString().slice(-6);
  const businessName = `B6 Split ${stamp} LLC`;
  const highMerchant = `B6 Adobe Creative Cloud ${stamp}`;
  const lowMerchant = `B6 Unknown Ambiguous Adjustment Needs Human ${stamp}`;
  let touchedAutonomy = false;

  try {
    await createBusiness(page, businessName);
    await setAiAutonomy(page, "autopilot");
    touchedAutonomy = true;

    await gotoApp(page, "/transactions");
    await selectEntity(page, businessName);
    await expect(visibleByTestId(page, "transactions-screen")).toBeVisible({ timeout: 30000 });

    await visibleByTestId(page, "csv-text").fill(
      [
        "date,description,amount",
        `2026-06-30,${highMerchant} monthly software subscription,-82.00`,
        `2026-06-30,${lowMerchant},-19.37`,
      ].join("\n"),
    );
    await visibleByTestId(page, "csv-import").click();
    const message = visibleByTestId(page, "transaction-message");
    await expect(message).toContainText(/AI batch/i, { timeout: 180000 });
    await expect(message).toContainText(/2 checked, 1 posted, 1 updated for review/i);

    await page.getByPlaceholder("Search merchant or memo").fill(highMerchant);
    const postedRow = page.getByTestId("transaction-row").filter({ hasText: highMerchant }).first();
    await expect(postedRow).toBeVisible({ timeout: 30000 });
    await expect(postedRow).toContainText(/bank - ai/i);
    await expect(postedRow).toContainText(/auto/i);
    await expect(postedRow).toContainText(/Software & SaaS/i);
    await postedRow.locator("td").nth(2).click();
    const drawer = visibleByTestId(page, "transaction-drawer");
    await expect(drawer).toContainText("Balanced lines", { timeout: 30000 });
    await expect(drawer).toContainText("Software & SaaS");
    await page.screenshot({ path: `${EVIDENCE}/2026-06-12-B6-import-split-posted.png`, fullPage: true });

    await gotoApp(page, "/inbox");
    await selectEntity(page, businessName);
    await expect(visibleByTestId(page, "inbox-list")).toBeVisible({ timeout: 30000 });
    const reviewItem = page.getByTestId("inbox-item").filter({ hasText: lowMerchant }).first();
    await expect(reviewItem).toBeVisible({ timeout: 30000 });
    await reviewItem.click();
    await expect(visibleByTestId(page, "inbox-detail-title")).toHaveText(lowMerchant, { timeout: 15000 });
    await expect(page.getByText(/Pipeline stage 6 LLM proposal|ambiguous|needs human|missing/i).first()).toBeVisible({
      timeout: 15000,
    });
    await page.screenshot({ path: `${EVIDENCE}/2026-06-12-B6-import-split-inbox.png`, fullPage: true });

    await gotoApp(page, "/settings/ai");
    await expect(visibleByTestId(page, "ai-section")).toBeVisible({ timeout: 30000 });
    const batchHistory = visibleByTestId(page, "ai-batch-history");
    await expect(batchHistory).toContainText(/2 checked. 1 posted, 1 updated for review, 0 skipped/i, {
      timeout: 30000,
    });
    await expect(batchHistory).toContainText(/completed/i);
    await page.screenshot({ path: `${EVIDENCE}/2026-06-12-B6-csv-ai-batch-history.png`, fullPage: true });
  } finally {
    if (touchedAutonomy) {
      await setAiAutonomy(page, "balanced").catch(() => undefined);
    }
    await archiveBusiness(page, businessName).catch(() => undefined);
  }
});
