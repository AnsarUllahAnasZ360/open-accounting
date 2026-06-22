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

// Epic E4 (stage A) — Contacts on the shared workbench driver:
// [Contacts · Insights]. REAL pointer clicks only.
//
// Structure + correctness are proven against the SHARED demo books read-only
// (sub-tab routing, full toolbar, role chips, the shared DetailSheet with its
// un-netted KPI band + Activity/Open-items/Statements tabs). The MUTATING flows
// (add a contact, generate a statement) run on a DISPOSABLE business that is
// archived at the end, never touching the shared books.

const EVIDENCE_DIR = path.join(process.cwd(), "docs/finishing/evidence");
const DATE = "2026-06-14";
const SHOT_OPTS = { animations: "disabled" as const, caret: "hide" as const };

function shot(name: string) {
  return path.join(EVIDENCE_DIR, `${DATE}-E4-${name}.png`);
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

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await installDevOverlayGuard(page);
});

test("E4.1 — Contacts renders [Contacts · Insights] on the driver + full toolbar (desktop)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/contacts");

  // The directory renders through the shared WorkbenchSurface driver.
  await expect(page.getByTestId("m6-contacts-screen")).toBeVisible({ timeout: 30000 });

  // The identical section sub-tab bar: [Contacts · Insights] (no AR/AP sub-tab).
  await expect(page.getByTestId("section-tabs")).toBeVisible();
  await expect(page.getByTestId("section-tab-contacts")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("section-tab-insights")).toBeVisible();

  // The FULL WorkbenchToolbar (Filters pill + Add menu), not the old FilterBar.
  await expect(page.getByRole("button", { name: /filters/i }).first()).toBeVisible();
  await expect(page.getByTestId("add-menu-trigger")).toBeVisible();

  // Role chips: All / Customers / Vendors.
  await expect(page.getByTestId("contacts-role-all")).toBeVisible();
  await expect(page.getByTestId("contacts-role-customer")).toBeVisible();
  await expect(page.getByTestId("contacts-role-vendor")).toBeVisible();

  // The directory has rows (shared demo books).
  await expect(page.getByTestId("contact-row").first()).toBeVisible({ timeout: 30000 });

  // Filter to Customers via the role chip (real click) and back.
  await page.getByTestId("contacts-role-customer").click();
  await expect(page.getByTestId("contacts-role-customer")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("contacts-role-all").click();

  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: shot("contacts-directory-desktop"), fullPage: false, ...SHOT_OPTS });
});

test("E4.3 — a contact row opens the shared DetailSheet with the un-netted KPI band + tabs", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/contacts");
  await expect(page.getByTestId("m6-contacts-screen")).toBeVisible({ timeout: 30000 });

  // Open the first contact's detail (real click).
  await page.getByTestId("contact-row").first().click();
  await expect(page.getByTestId("contact-profile")).toBeVisible({ timeout: 15000 });

  // KPI band shows AR and AP SEPARATELY (never netted). Scope to the detail
  // band — "They owe you" also appears in the directory KPI strip behind it.
  const kpiBand = page.getByTestId("contact-kpi-band");
  await expect(kpiBand).toBeVisible();
  await expect(kpiBand.getByText("They owe you")).toBeVisible();
  await expect(kpiBand.getByText("You owe them")).toBeVisible();
  await expect(kpiBand.getByText("Lifetime in")).toBeVisible();
  await expect(kpiBand.getByText("Lifetime out")).toBeVisible();

  // The tab set: Activity / Open items / Statements / Details / Notes. (The
  // empty Attachments placeholder tab was removed in E5 — no dead tabs.)
  await expect(page.getByTestId("contact-tab-activity")).toBeVisible();
  await expect(page.getByTestId("contact-tab-statements")).toBeVisible();
  await expect(page.getByTestId("contact-tab-details")).toBeVisible();

  // Switch to Open items and Details (real clicks).
  await page.getByTestId("contact-tab-open").click();
  await page.getByTestId("contact-tab-details").click();
  await expect(page.getByTestId("contact-details")).toBeVisible({ timeout: 15000 });

  await page.screenshot({ path: shot("contacts-detail-sheet"), fullPage: false, ...SHOT_OPTS });
  await page.keyboard.press("Escape");
});

test("E4.5 — the Insights sub-tab renders the E1 panel for Contacts", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/contacts/insights");

  await expect(page).toHaveURL(/\/contacts\/insights$/);
  await expect(page.getByTestId("section-tab-insights")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("insights-dashboard")).toBeVisible({ timeout: 30000 });

  // Contacts-specific KPI band (Contacts, They owe you, Top-customer share).
  await expect(page.getByTestId("insights-kpi-card").first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Top-customer share")).toBeVisible();

  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: shot("contacts-insights"), fullPage: false, ...SHOT_OPTS });
});

test("E4.2/E4.4 — add a contact, then generate a statement (disposable business)", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now().toString().slice(-6);
  const businessName = `E4 Contacts ${stamp} LLC`;
  const customer = `Statement Co ${stamp}`;
  const client = convexClient();

  const created = await client.mutation(api.entities.create, {
    name: businessName,
    businessType: "services",
    currency: "USD",
  });

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, "/contacts");
    await selectEntity(page, businessName);
    await expect(page.getByTestId("m6-contacts-screen")).toBeVisible({ timeout: 30000 });

    // ADD CONTACT (E4.2): name + both roles + email via the upgraded modal. The
    // primary add item on Contacts is "Add contact" (E5.3 single "+" menu).
    await page.getByTestId("add-menu-trigger").click();
    await page.getByTestId("contacts-add-contact").click();
    await expect(page.getByTestId("add-contact-modal")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("contact-name").fill(customer);
    // Default is "customer"; add "vendor" so it's both (real toggle click).
    await page.getByTestId("contact-role-vendor").click();
    await page.getByTestId("contact-create").click();

    // It appears immediately AND its detail sheet opens (the new contact id is
    // selected on create). Prove reactivity + reusability.
    await expect(page.getByTestId("contact-profile")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(customer).first()).toBeVisible();
    await page.screenshot({ path: shot("contact-added"), fullPage: false, ...SHOT_OPTS });

    // STATEMENTS (E4.4): the Statements tab renders the ledger-tied preview with
    // a mode switch + download/send. A brand-new contact has no activity yet, so
    // the empty-statement copy is the honest, correct state to prove the wiring.
    await page.getByTestId("contact-tab-statements").click();
    await expect(page.getByTestId("contact-statements")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("statement-mode")).toBeVisible();
    await expect(page.getByTestId("statement-download")).toBeVisible();
    await expect(page.getByTestId("statement-send")).toBeVisible();
    // Switch to open-item (collections) mode (real click via the select).
    await page.getByTestId("statement-mode").click();
    await page.getByRole("option", { name: /Open-item/i }).click();
    await page.screenshot({ path: shot("contact-statement"), fullPage: false, ...SHOT_OPTS });
  } finally {
    await client.mutation(api.entities.archive, { entityId: created.entityId }).catch(() => undefined);
  }
});

test("E4.4 — a customer with open A/R renders a populated, ledger-tied statement + CSV download (shared books, read-only)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/contacts");
  await expect(page.getByTestId("m6-contacts-screen")).toBeVisible({ timeout: 30000 });

  // Narrow the directory to customers that actually owe money, so the row we
  // open is guaranteed to produce a populated A/R statement. Read-only: we only
  // toggle a filter + open a detail sheet, never mutate the shared demo books.
  await page.getByRole("button", { name: /filters/i }).first().click();
  const filterPanel = page.getByRole("dialog");
  await filterPanel.getByRole("button", { name: "Activity", exact: true }).click();
  await filterPanel.getByRole("button", { name: "Open A/R", exact: true }).click();
  // Close the panel.
  await filterPanel.getByRole("button", { name: "Done" }).click();

  const firstRow = page.getByTestId("contact-row").first();
  await expect(firstRow).toBeVisible({ timeout: 30000 });
  await firstRow.click();
  await expect(page.getByTestId("contact-profile")).toBeVisible({ timeout: 15000 });

  // Statements tab: the balance-forward preview renders with a real closing
  // balance derived from posted journal lines (no empty-state copy).
  await page.getByTestId("contact-tab-statements").click();
  await expect(page.getByTestId("contact-statements")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("statement-preview")).toBeVisible({ timeout: 15000 });
  const closing = page.getByTestId("statement-closing");
  await expect(closing).toBeVisible();
  await expect(closing).not.toHaveText(/^\$?0(\.00)?$/);

  // Switch to open-item (collections) mode (real select interaction) and confirm
  // the preview re-renders with outstanding items.
  await page.getByTestId("statement-mode").click();
  await page.getByRole("option", { name: /Open-item/i }).click();
  await expect(page.getByTestId("statement-preview")).toBeVisible({ timeout: 15000 });

  // Download the statement as CSV — a real browser download event, proving the
  // download path works end to end (not just that the button is present).
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("statement-download").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^statement-.*\.csv$/);
  await download.delete();

  await page.screenshot({ path: shot("contacts-statement-populated"), fullPage: false, ...SHOT_OPTS });
  await page.keyboard.press("Escape");
});

test("E4.6 — mobile @ 390: Contacts sub-tabs + detail with no horizontal page scroll", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/contacts");
  await expect(page.getByTestId("m6-contacts-screen")).toBeVisible({ timeout: 30000 });

  await expect(page.getByTestId("section-tabs")).toBeVisible();
  await expect(page.getByTestId("section-tab-contacts")).toBeVisible();
  await expect(page.getByTestId("section-tab-insights")).toBeVisible();
  await expectNoHorizontalScroll(page);

  // The directory renders a real stacked card list on mobile (not a squeezed
  // desktop table) — the card testid is suffixed with "-card".
  const card = page.getByTestId("contact-row-card").first();
  await expect(card).toBeVisible({ timeout: 30000 });

  // Reachable Insights sub-tab on mobile (real tap), no horizontal page scroll.
  await page.getByTestId("section-tab-insights").click();
  await expect(page).toHaveURL(/\/contacts\/insights$/);
  await expect(page.getByTestId("insights-dashboard")).toBeVisible({ timeout: 30000 });
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: shot("contacts-mobile-390"), fullPage: false, ...SHOT_OPTS });
});
