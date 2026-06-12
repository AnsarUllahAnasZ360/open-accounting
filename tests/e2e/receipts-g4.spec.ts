import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

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

const EVIDENCE = "docs/finishing/evidence";
const FIXTURES = "tests/fixtures/receipts";

async function uploadFixture(page: Page, fileName: string) {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator('label[for="m11-receipt-file"]').filter({ hasText: "Choose file" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(join(process.cwd(), FIXTURES, fileName));
  await expect(page.getByTestId("m11-receipt-upload-message")).toContainText(`Uploaded ${fileName}`, {
    timeout: 30000,
  });
}

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function pdfSource(args: { vendor: string; date: string; amount: string }) {
  return [
    "%PDF-1.4",
    "1 0 obj",
    "<< /Type /Catalog /Pages 2 0 R >>",
    "endobj",
    "2 0 obj",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "endobj",
    "3 0 obj",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "endobj",
    "4 0 obj",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "endobj",
    "5 0 obj",
    "<< /Length 155 >>",
    "stream",
    "BT",
    "/F1 18 Tf",
    "72 720 Td",
    `(Vendor: ${escapePdfText(args.vendor)}) Tj`,
    "0 -28 Td",
    `(Date: ${args.date}) Tj`,
    "0 -28 Td",
    `(Total: $${args.amount}) Tj`,
    "0 -28 Td",
    "(Currency: USD) Tj",
    "ET",
    "endstream",
    "endobj",
    "%%EOF",
  ].join("\n");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
}

async function findUnreceiptedOutflow(page: Page) {
  await page.goto("/transactions");
  await expect(visibleByTestId(page, "transactions-screen")).toBeVisible({ timeout: 30000 });
  const rows = page.getByTestId("transaction-row");
  const count = Math.min(await rows.count(), 20);
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const cells = row.locator("td");
    const amountText = (await cells.nth(6).innerText()).trim();
    if (!amountText.includes("-")) continue;
    await cells.nth(2).click();
    const drawer = visibleByTestId(page, "transaction-drawer");
    await expect(drawer).toBeVisible({ timeout: 15000 });
    if ((await drawer.getByText("No matched receipt.").count()) === 0) continue;
    const date = (await cells.nth(1).innerText()).trim();
    const merchant = (await cells.nth(2).innerText()).split(/\n/)[0]?.trim() ?? "";
    const amount = Math.abs(Number(amountText.replace(/[^0-9.-]/g, ""))).toFixed(2);
    if (merchant && date && Number(amount) > 0) {
      return { merchant, date, amount };
    }
  }
  return null;
}

function visibleByTestId(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true }).first();
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

test("G4 — receipt PDF and image uploads create reviewable evidence and a matched receipt chip", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const candidate = await findUnreceiptedOutflow(page);
  expect(candidate, "needs an unreceipted outflow transaction fixture").not.toBeNull();

  const pdfName = `receipt-${slugify(candidate!.merchant)}-${candidate!.date}-${candidate!.amount}.pdf`;
  const pdfPath = testInfo.outputPath(pdfName);
  writeFileSync(
    pdfPath,
    pdfSource({
      vendor: candidate!.merchant,
      date: candidate!.date,
      amount: candidate!.amount,
    }),
    "utf8",
  );

  await page.goto("/bills");
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 30000 });
  await expect(visibleByTestId(page, "m11-receipt-upload-panel")).toBeVisible({ timeout: 30000 });

  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator('label[for="m11-receipt-file"]').filter({ hasText: "Choose file" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(pdfPath);
  await expect(page.getByTestId("m11-receipt-upload-message")).toContainText(`Uploaded ${pdfName}`, {
    timeout: 30000,
  });
  await expect(page.getByTestId("m11-receipt-upload-message")).toContainText(/PDF text extracted/i);
  const pdfRow = page.getByTestId("m11-receipt-row").filter({ hasText: pdfName }).first();
  await expect(pdfRow).toBeVisible({ timeout: 30000 });
  if ((await pdfRow.getByText("Matched to").count()) === 0) {
    const suggestedMatch = pdfRow.getByRole("button", { name: "Confirm suggested match" });
    await expect(suggestedMatch).toBeEnabled();
    await suggestedMatch.click();
    await expect(page.getByTestId("m11-receipt-upload-message")).toContainText("Manual match saved to", {
      timeout: 15000,
    });
  }
  await expect(pdfRow).toContainText("Matched to", { timeout: 30000 });

  await page.getByLabel("Vendor override").fill("E2E Image Receipt");
  await page.getByLabel("Date override").fill("2026-06-12");
  await page.getByLabel("Amount override").fill("12.34");
  await uploadFixture(page, "receipt-unknown-parking-2026-06-10-42.00.png");
  const imageRow = page.getByTestId("m11-receipt-row").filter({ hasText: "E2E Image Receipt" }).first();
  await expect(imageRow).toBeVisible({ timeout: 30000 });
  await expect(imageRow).toContainText("12.34");

  await page.goto("/transactions");
  await expect(visibleByTestId(page, "transactions-screen")).toBeVisible({ timeout: 30000 });
  await page.getByPlaceholder("Search merchant or memo").fill(candidate!.merchant);
  await expect
    .poll(async () => {
      const rows = page.getByTestId("transaction-row").filter({ hasText: candidate!.merchant });
      const count = await rows.count();
      for (let index = 0; index < count; index += 1) {
        await rows.nth(index).locator("td").nth(2).click();
        const drawer = visibleByTestId(page, "transaction-drawer");
        const text = await drawer.innerText();
        if (text.includes(`${candidate!.date} · matched`) && !text.includes("No matched receipt.")) {
          return true;
        }
      }
      return false;
    }, { timeout: 30000 })
    .toBe(true);

  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-G4-receipts-pdf-image-chip.png`, fullPage: true });
});

test("G4 — unmatched receipt can create a balanced expense on a fresh business", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const stamp = Date.now().toString().slice(-6);
  const businessName = `G4 Expense ${stamp} LLC`;
  const vendor = `G4 Receipt Vendor ${stamp}`;

  await createBusiness(page, businessName);
  await gotoApp(page, "/bills");
  await selectEntity(page, businessName);
  await expect(visibleByTestId(page, "m11-receipt-upload-panel")).toBeVisible({ timeout: 30000 });

  await page.getByLabel("Vendor override").fill(vendor);
  await page.getByLabel("Date override").fill("2026-06-12");
  await page.getByLabel("Amount override").fill("42.00");
  await uploadFixture(page, "receipt-unknown-parking-2026-06-10-42.00.png");
  const row = page.getByTestId("m11-receipt-row").filter({ hasText: vendor }).first();
  await expect(row).toBeVisible({ timeout: 30000 });
  await row.getByTestId("receipt-create-expense").click();
  await expect(page.getByTestId("m11-receipt-upload-message")).toContainText(`Expense created for ${vendor}`, {
    timeout: 30000,
  });
  await expect(row).toContainText("matched", { timeout: 30000 });

  await page.getByTestId("app-sidebar").getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(visibleByTestId(page, "transactions-screen")).toBeVisible({ timeout: 30000 });
  await page.getByPlaceholder("Search merchant or memo").fill(vendor);
  const transactionRow = page.getByTestId("transaction-row").filter({ hasText: vendor }).first();
  await expect(transactionRow).toBeVisible({ timeout: 30000 });
  await transactionRow.locator("td").nth(2).click();
  await expect(visibleByTestId(page, "transaction-drawer")).toContainText("matched", { timeout: 30000 });
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-G4-create-expense-receipt.png`, fullPage: true });

  await archiveBusiness(page, businessName);
});
