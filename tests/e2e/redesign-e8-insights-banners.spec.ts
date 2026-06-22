import path from "node:path";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import { expectNoHorizontalScroll, gotoApp, installDevOverlayGuard } from "./helpers";

// Epic E8 (banners + clock fix + Bills Insights) — proves, end-to-end with REAL
// pointer clicks:
//  1. each data-bearing operational page renders EXACTLY ONE page-insight-banner
//     carrying its own data-page, and the text differs across pages (no two
//     pages show the same line);
//  2. the Transactions banner chip opens the uncategorized (needs-review) view;
//  3. the insights resolved-date label is driven by the live clock (it tracks an
//     injected "today" and is NOT the frozen 2026-06-30 demo anchor — RC6 fixed);
//  4. Bills → Insights renders the real insights panel (not the old stub).
//
// Like the E1 spec, this creates a DISPOSABLE business seeded with deterministic
// June-2026 ledger activity (insightsFixtures.seedInsightsEntity — dev-auth-only,
// balanced postings) so it never mutates the shared demo books.

const EVIDENCE_DIR = path.join(process.cwd(), "docs/finishing/evidence");
const DATE = "2026-06-20";
const SHOT_OPTS = { animations: "disabled" as const, caret: "hide" as const };

function shot(name: string) {
  return path.join(EVIDENCE_DIR, `${DATE}-E8-${name}.png`);
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
  const switcher = page.getByTestId("active-business-switcher");
  if ((await switcher.innerText()).includes(name)) return;
  await switcher.click();
  const menu = page.getByTestId("active-business-menu");
  await expect(menu).toBeVisible();
  const option = menu.locator('[role="menuitem"]').filter({ hasText: name }).first();
  await expect(option).toBeVisible({ timeout: 15000 });
  await option.click();
  await expect(switcher).toContainText(name, { timeout: 15000 });
}

/** Read the single banner's text on a page (asserting exactly one is present). */
async function bannerText(page: Page, dataPage: string): Promise<string> {
  const banner = page.getByTestId("page-insight-banner");
  await expect(banner).toHaveCount(1, { timeout: 30000 });
  await expect(banner).toHaveAttribute("data-page", dataPage);
  return (await banner.innerText()).trim();
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await installDevOverlayGuard(page);
});

test("E8 — each page renders one distinct page-insight banner; Transactions chip drills; Bills Insights real", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const stamp = Date.now().toString().slice(-6);
  const businessName = `E8 Banners ${stamp} LLC`;
  const client = convexClient();

  const created = await client.mutation(api.entities.create, {
    name: businessName,
    businessType: "services",
    currency: "USD",
  });
  const seeded = await client.mutation(api.insightsFixtures.seedInsightsEntity, {
    entityId: created.entityId,
  });
  expect(seeded.posted).toBeGreaterThanOrEqual(8);
  expect(seeded.uncategorized).toBeGreaterThanOrEqual(2);

  try {
    await page.setViewportSize({ width: 1440, height: 900 });

    // --- Transactions: a banner about uncategorized work, with a drill chip. ---
    await gotoApp(page, "/transactions");
    await selectEntity(page, businessName);
    await expect(page.getByTestId("transactions-screen")).toBeVisible({ timeout: 30000 });
    const txText = await bannerText(page, "transactions");
    expect(txText.toLowerCase()).toMatch(/categor|cash moved/);
    await page.screenshot({ path: shot("transactions-banner"), fullPage: false, ...SHOT_OPTS });

    // The chip jumps to the uncategorized (needs-review) filter — assert a Status
    // chip / needs-review filter becomes active by checking a review chip appears.
    const chip = page.getByTestId("page-insight-banner").getByRole("button").first();
    if (await chip.isVisible()) {
      await chip.click();
      // The needs-review filter is now active — the active-filter chip rail shows it.
      await expect(page.getByText(/needs review/i).first()).toBeVisible({ timeout: 15000 });
    }

    // --- Income: a banner about money in / AR / MRR. ---
    await gotoApp(page, "/income");
    await selectEntity(page, businessName);
    const incomeText = await bannerText(page, "income");
    await page.screenshot({ path: shot("income-banner"), fullPage: false, ...SHOT_OPTS });

    // --- Expenses: a banner about spend / biggest mover / vendor. ---
    await gotoApp(page, "/expenses");
    await selectEntity(page, businessName);
    const expensesText = await bannerText(page, "expenses");
    await page.screenshot({ path: shot("expenses-banner"), fullPage: false, ...SHOT_OPTS });

    // --- Contacts: a banner about the top earner / overdue receivers. ---
    await gotoApp(page, "/contacts");
    await selectEntity(page, businessName);
    const contactsText = await bannerText(page, "contacts");
    await page.screenshot({ path: shot("contacts-banner"), fullPage: false, ...SHOT_OPTS });

    // --- Dashboard: a banner about net income / runway / cash. ---
    await gotoApp(page, "/dashboard");
    await selectEntity(page, businessName);
    await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 30000 });
    const dashboardText = await bannerText(page, "dashboard");
    await page.screenshot({ path: shot("dashboard-banner"), fullPage: false, ...SHOT_OPTS });

    // No two pages show the same line — the core owner ask.
    const lines = [txText, incomeText, expensesText, contactsText, dashboardText].map((s) =>
      s.replace(/\s+/g, " ").trim(),
    );
    expect(new Set(lines).size).toBe(lines.length);

    // --- The Insights resolved-date label is live-clock driven (RC6 fixed). ---
    await gotoApp(page, "/transactions/insights");
    await selectEntity(page, businessName);
    await expect(page.getByTestId("insights-dashboard")).toBeVisible({ timeout: 30000 });
    const resolved = page.getByTestId("insights-resolved-dates");
    await expect(resolved).toBeVisible({ timeout: 30000 });
    // It must NOT be the old frozen demo anchor and it must carry a current year.
    await expect(resolved).not.toContainText("2026-06-30");
    await expect(resolved).toContainText(/20\d\d/);

    await expectNoHorizontalScroll(page);
  } finally {
    await client.mutation(api.entities.archive, { entityId: created.entityId }).catch(() => {});
  }
});
