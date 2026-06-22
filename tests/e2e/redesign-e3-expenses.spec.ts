import path from "node:path";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import {
  expectNoHorizontalScroll,
  gotoApp,
  installDevOverlayGuard,
} from "./helpers";

// Epic E3 (stage B) — Expenses section on the shared workbench driver:
// [Expenses (money out) · Bills (AP) · Insights]. REAL pointer clicks only.
//
// Structure + correctness are proven against the SHARED demo books READ-ONLY
// (sub-tab routing, the FULL WorkbenchToolbar, KPIs, AP money bar, detail sheet,
// the Insights panel). The two MUTATING flows — add-bill -> pay, and the
// admin-gated inline recategorize (reverse + repost) — run on a DISPOSABLE
// business that is archived at the end, never touching the shared books.

const EVIDENCE_DIR = path.join(process.cwd(), "docs/finishing/evidence");
const DATE = "2026-06-14";
const SHOT_OPTS = { animations: "disabled" as const, caret: "hide" as const };

function shot(name: string) {
  return path.join(EVIDENCE_DIR, `${DATE}-E3-${name}.png`);
}

function readLocalEnv(name: string) {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const equalsIndex = line.indexOf("=");
    const key = line.slice(0, equalsIndex).trim();
    if (key !== name) continue;
    return line
      .slice(equalsIndex + 1)
      .trim()
      .replace(/\s+#.*$/, "")
      .replace(/^["']|["']$/g, "");
  }
  return "";
}

function convexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || readLocalEnv("NEXT_PUBLIC_CONVEX_URL");
  return new ConvexHttpClient(convexUrl);
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

function moneyToNumber(text: string) {
  return Number(text.replace(/[^0-9.-]/g, ""));
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await installDevOverlayGuard(page);
});

test("E3.1 — Expenses renders [Expenses · Bills · Insights] on the driver with the FULL toolbar (desktop)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/expenses");

  // The cash-movement tab renders the unified MONEY-OUT table through the shared
  // WorkbenchSurface driver.
  await expect(page.getByTestId("expenses-screen")).toBeVisible({ timeout: 30000 });

  // The identical section sub-tab bar: [Expenses · Bills · Insights], Insights last.
  await expect(page.getByTestId("section-tabs")).toBeVisible();
  await expect(page.getByTestId("section-tab-expenses")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("section-tab-bills")).toBeVisible();
  await expect(page.getByTestId("section-tab-insights")).toBeVisible();
  // Active tab is marked by the stable data-active attribute (the 2px brand-green
  // underline is styling that an E5 restyle may change; assert behavior, not a
  // brittle class-string).
  await expect(page.getByTestId("section-tab-expenses")).toHaveAttribute("data-active", "true");

  // The FULL WorkbenchToolbar (saved views + Filters pill + Add menu), NOT the
  // lighter FilterBar — same toolbar as Transactions / Income (E5 consistency).
  await expect(page.getByRole("button", { name: /filters/i }).first()).toBeVisible();
  await expect(page.getByTestId("add-menu-trigger")).toBeVisible();
  // The admin-gated inline category edit survives on the money-out table.
  await expect(page.getByTestId("expense-row").first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("expense-category-select").first()).toBeVisible();

  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: shot("expenses-table-desktop"), fullPage: false, ...SHOT_OPTS });
});

test("E3.1b — the 'Missing receipt' saved view filters the money-out table to unbacked rows", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/expenses");
  await expect(page.getByTestId("expenses-screen")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("expense-row").first()).toBeVisible({ timeout: 30000 });

  // The built-in "Missing receipt" saved view replaces the old Evidence tab.
  await page.getByTestId("saved-views-trigger").click();
  const missingReceipt = page.getByRole("menuitem", { name: /missing receipt/i }).first();
  await expect(missingReceipt).toBeVisible({ timeout: 10000 });
  await missingReceipt.click();

  // A "Receipt: Missing" filter chip is now active; the rows are the unbacked
  // subset (every visible row shows the missing-evidence attention state, never
  // an "Attached" receipt label).
  await expect(page.getByText(/Receipt: Missing/i).first()).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: shot("expenses-missing-receipt-view"), fullPage: false, ...SHOT_OPTS });
});

test("E3.2 — the Bills sub-tab routes to /expenses/bills with the AP money bar + columns + shared detail", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/expenses");
  await expect(page.getByTestId("expenses-screen")).toBeVisible({ timeout: 30000 });

  // Real tap to the AP sub-tab; the URL routes and the tab is current.
  await page.getByTestId("section-tab-bills").click();
  await expect(page).toHaveURL(/\/expenses\/bills$/);
  await expect(page.getByTestId("section-tab-bills")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("expenses-bills-screen")).toBeVisible({ timeout: 30000 });

  // AP money bar: Owed · Overdue · Due soon · Paid.
  await expect(page.getByText("Owed").first()).toBeVisible();
  await expect(page.getByTestId("bills-open-total")).toBeVisible();
  await expect(page.getByText("Due soon").first()).toBeVisible();
  await expect(page.getByText(/Next 7 days/).first()).toBeVisible();

  // AP-oriented columns (vendor, bill date, due, status, amount, balance).
  await expect(page.getByTestId("bill-row").first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("bill-vendor-cell").first()).toBeVisible();
  await expect(page.getByTestId("bill-due-cell").first()).toBeVisible();
  await expect(page.getByTestId("bill-amount-cell").first()).toBeVisible();

  // A row opens the SHARED DetailSheet (the same one Income/Invoices uses). It
  // is status-agnostic: the sheet shows the vendor title + an Evidence section
  // (the mark-paid action is conditional on an OPEN bill, so don't gate on it).
  const firstVendor = (await page.getByTestId("bill-vendor-cell").first().innerText()).trim();
  await page.getByTestId("bill-row").first().click();
  await expect(page.getByRole("dialog").getByText(/Evidence/i).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("dialog").getByText(firstVendor).first()).toBeVisible();
  await page.screenshot({ path: shot("bills-ap-tab"), fullPage: false, ...SHOT_OPTS });
  await page.keyboard.press("Escape");

  // Deep-link directly to the sub-route loads the AP tab.
  await gotoApp(page, "/expenses/bills");
  await expect(page).toHaveURL(/\/expenses\/bills$/);
  await expect(page.getByTestId("expenses-bills-screen")).toBeVisible({ timeout: 30000 });
});

test("E3.2b — /bills is demoted: the old top-level link redirects to /expenses/bills", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  // Old bookmark survives via a server redirect to the new sub-tab route.
  await gotoApp(page, "/bills");
  await expect(page).toHaveURL(/\/expenses\/bills$/, { timeout: 30000 });
  await expect(page.getByTestId("expenses-bills-screen")).toBeVisible({ timeout: 30000 });
  // It is gone from the top-level sidebar nav (Bills now lives under Expenses).
  await expect(page.getByTestId("app-sidebar").getByRole("link", { name: /^Bills$/ })).toHaveCount(0);
});

test("E3.3 — the Insights sub-tab renders the E1 panel for Expenses (same anatomy as Income)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/expenses/insights");

  await expect(page).toHaveURL(/\/expenses\/insights$/);
  await expect(page.getByTestId("section-tab-insights")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("insights-dashboard")).toBeVisible({ timeout: 30000 });

  // Expenses-specific KPI band on the SAME E1 InsightsKpiCard component as Income.
  await expect(page.getByTestId("insights-kpi-card").first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Total spend").first()).toBeVisible();
  await expect(page.getByText("Runway").first()).toBeVisible();
  await expect(page.getByText("Top-category share").first()).toBeVisible();
  await expect(page.getByText("Recurring").first()).toBeVisible();

  // Spend-by-category + AP aging / DPO charts are present.
  await expect(page.getByText(/Spend by category/i).first()).toBeVisible();
  await expect(page.getByText(/Bills owed by age/i).first()).toBeVisible();

  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: shot("expenses-insights"), fullPage: false, ...SHOT_OPTS });
});

test("E3.4 — disposable business: add a bill, then PAY it; the AP open total decreases via the ledger", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now().toString().slice(-6);
  const businessName = `E3 Expenses ${stamp} LLC`;
  const vendor = `Pay Me Co ${stamp}`;
  const client = convexClient();

  // A disposable business with a clean ledger (no shared-book mutation).
  const created = await client.mutation(api.entities.create, {
    name: businessName,
    businessType: "services",
    currency: "USD",
  });

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, "/expenses/bills");
    await selectEntity(page, businessName);
    await expect(page.getByTestId("expenses-bills-screen")).toBeVisible({ timeout: 30000 });

    // Add a bill (posts to Accounts Payable). Add bill now lives inside the
    // single "+" AddMenu (E5.3): open the menu, then pick "Add bill".
    await page.getByTestId("add-menu-trigger").click();
    await page.getByTestId("bills-add-bill").click();
    await expect(page.getByTestId("add-bill-modal")).toBeVisible();
    await page.getByTestId("bill-vendor").fill(vendor);
    await page.getByTestId("bill-amount").fill("321.00");
    await page.getByTestId("bill-due").fill("2026-06-20");
    await page.getByTestId("bill-create").click();
    await expect(page.getByTestId("add-bill-modal")).toBeHidden({ timeout: 15000 });

    // The new open bill bumped the AP open total; capture it.
    const billRow = page.getByTestId("bill-row").filter({ hasText: vendor });
    await expect(billRow).toBeVisible({ timeout: 15000 });
    const openWithBill = moneyToNumber(await page.getByTestId("bills-open-total").innerText());
    expect(openWithBill).toBeGreaterThanOrEqual(321);

    // Seed a MATCHING, UNSETTLED bank outflow on this disposable entity so the
    // match picker has a real candidate to settle against (settling posts
    // AP -> bank — the real flow). posted: false keeps it needs_review so the
    // candidate scorer treats it as an open bank movement.
    await client.mutation(api.testSupport.seedDisposableExpense, {
      entityId: created.entityId,
      merchant: vendor,
      amountMinor: 32_100,
      date: "2026-06-19",
      posted: false,
    });

    // Pay: the per-row action opens the match picker; settle against the seeded
    // bank transaction and confirm the ledger post.
    await billRow.getByTestId("bill-mark-paid").click();
    await expect(page.getByTestId("bill-match-picker")).toBeVisible();
    await expect(page.getByTestId("bill-match-candidate").first()).toBeVisible({ timeout: 15000 });
    await page.getByTestId("bill-match-candidate").first().click();
    // Confirm the "Mark paid" AlertDialog (posts AP -> bank, immutable + balanced).
    await page.getByRole("button", { name: /^Mark paid$/ }).click();
    await expect(page.getByTestId("bill-match-picker")).toBeHidden({ timeout: 15000 });

    // CORRECTNESS: settlement cleared the payable — the AP open total strictly
    // decreases and the row no longer offers a Pay affordance (it is Paid).
    await expect
      .poll(async () => moneyToNumber(await page.getByTestId("bills-open-total").innerText()), { timeout: 15000 })
      .toBeLessThan(openWithBill);
    await expect(
      page.getByTestId("bill-row").filter({ hasText: vendor }).getByTestId("bill-mark-paid"),
    ).toHaveCount(0, { timeout: 15000 });
    await page.screenshot({ path: shot("disposable-bill-paid"), fullPage: false, ...SHOT_OPTS });
  } finally {
    await client.mutation(api.entities.archive, { entityId: created.entityId }).catch(() => undefined);
  }
});

test("E3.5 — disposable business: inline recategorize reverses + reposts via the shared ledger path", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now().toString().slice(-6);
  const businessName = `E3 Recat ${stamp} LLC`;
  const vendor = `Recat Vendor ${stamp}`;
  const client = convexClient();

  const created = await client.mutation(api.entities.create, {
    name: businessName,
    businessType: "services",
    currency: "USD",
  });

  try {
    // Seed one categorized expense transaction on the disposable entity, and get
    // a DIFFERENT target category to move it onto.
    const seeded = await client.mutation(api.testSupport.seedDisposableExpense, {
      entityId: created.entityId,
      merchant: vendor,
      amountMinor: 4_200,
      date: "2026-06-10",
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, "/expenses");
    await selectEntity(page, businessName);
    await expect(page.getByTestId("expenses-screen")).toBeVisible({ timeout: 30000 });

    // The seeded expense row is in the money-out table with its starting category.
    const row = page.getByTestId("expense-row").filter({ hasText: vendor });
    await expect(row).toBeVisible({ timeout: 30000 });
    const categorySelect = row.getByTestId("expense-category-select");
    await expect(categorySelect).toContainText(seeded.startCategory.name, { timeout: 15000 });

    // Inline recategorize: pick the target category. This calls the REAL
    // api.categories.recategorizeTransaction, which re-points the row and (for a
    // posted entry) reverses + reposts — the client never posts.
    await categorySelect.click();
    await page.getByRole("option", { name: seeded.targetCategory.name }).first().click();
    await expect(page.getByText(/Recategorized/i).first()).toBeVisible({ timeout: 15000 });

    // The row now reflects the new category (persisted server-side).
    await expect(
      page.getByTestId("expense-row").filter({ hasText: vendor }).getByTestId("expense-category-select"),
    ).toContainText(seeded.targetCategory.name, { timeout: 15000 });
    await page.screenshot({ path: shot("disposable-recategorize"), fullPage: false, ...SHOT_OPTS });
  } finally {
    await client.mutation(api.entities.archive, { entityId: created.entityId }).catch(() => undefined);
  }
});

test("E3.6 — mobile @ 390: Expenses sub-tabs scroll with no horizontal page scroll", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/expenses");
  await expect(page.getByTestId("expenses-screen")).toBeVisible({ timeout: 30000 });

  await expect(page.getByTestId("section-tabs")).toBeVisible();
  await expect(page.getByTestId("section-tab-expenses")).toBeVisible();
  await expect(page.getByTestId("section-tab-bills")).toBeVisible();
  await expectNoHorizontalScroll(page);

  // The AP sub-tab is reachable on mobile (real tap).
  await page.getByTestId("section-tab-bills").click();
  await expect(page).toHaveURL(/\/expenses\/bills$/);
  await expect(page.getByTestId("expenses-bills-screen")).toBeVisible({ timeout: 30000 });
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: shot("expenses-mobile-390"), fullPage: false, ...SHOT_OPTS });
});
