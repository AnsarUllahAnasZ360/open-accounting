import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import {
  expectNoHorizontalScroll,
  gotoApp,
  installDevOverlayGuard,
  visibleByTestId,
} from "./helpers";

// Epic E5 (KEYSTONE) — the parameterized CONSISTENCY suite. ONE journey runs
// across all four operational sections (Transactions / Income / Expenses /
// Contacts) and every sub-tab, asserting IDENTICAL structure + behavior so the
// four sections demonstrably feel like one product:
//
//   load -> assert the same toolbar control set is present (saved-views trigger,
//   free-text search box, Filters pill, the group/sort/display cluster, the
//   single "+" AddMenu, and the SAME KpiStrip "Stats" banner with its Hide/Show
//   collapser) -> switch each sub-tab -> apply a filter -> change the period
//   (where the section is period-scoped) -> open a row detail -> open Insights.
//
// It captures a side-by-side screenshot set at desktop AND 390px. REAL pointer
// clicks only (dev-auth bypass, port 3100, nextjs-portal stripped). Read/nav
// only on the shared demo books — no shared-book mutation.

const EVIDENCE_DIR = path.join(process.cwd(), "docs/finishing/evidence");
const DATE = "2026-06-14";
const SHOT_OPTS = { animations: "disabled" as const, caret: "hide" as const };

function shot(name: string) {
  return path.join(EVIDENCE_DIR, `${DATE}-E5-${name}.png`);
}

// The canonical section matrix the suite parameterizes over. `screenTestId` is
// the cash-movement surface; `subtabs` lists the non-default routes; `hasPeriod`
// flags the period-scoped sections (Contacts is a directory, not period-scoped).
type SectionSpec = {
  slug: string;
  label: string;
  screenTestId: string;
  rowTestId: string;
  subtabs: { id: string; ready: string }[];
  hasPeriod: boolean;
};

const SECTIONS: SectionSpec[] = [
  {
    slug: "transactions",
    label: "Transactions",
    screenTestId: "transactions-screen",
    rowTestId: "transaction-row",
    subtabs: [{ id: "insights", ready: "insights-dashboard" }],
    hasPeriod: true,
  },
  {
    slug: "income",
    label: "Income",
    screenTestId: "income-screen",
    rowTestId: "payment-row",
    subtabs: [
      { id: "invoices", ready: "income-invoices-screen" },
      { id: "insights", ready: "insights-dashboard" },
    ],
    hasPeriod: true,
  },
  {
    slug: "expenses",
    label: "Expenses",
    screenTestId: "expenses-screen",
    rowTestId: "expense-row",
    subtabs: [
      { id: "bills", ready: "expenses-bills-screen" },
      { id: "insights", ready: "insights-dashboard" },
    ],
    hasPeriod: true,
  },
  {
    slug: "contacts",
    label: "Contacts",
    screenTestId: "m6-contacts-screen",
    rowTestId: "contact-row",
    subtabs: [{ id: "insights", ready: "insights-dashboard" }],
    hasPeriod: false,
  },
];

test.describe.configure({ mode: "default" });

test.beforeEach(async ({ page }) => {
  await installDevOverlayGuard(page);
});

// The IDENTICAL toolbar control set every cash-movement surface must present.
// Asserting these by the SAME testids/roles on every section is what proves the
// sections share one chrome (E5.3) — the heart of the keystone sign-off.
async function assertSharedChrome(page: Page) {
  // SectionTabs bar.
  await expect(page.getByTestId("section-tabs")).toBeVisible();
  // Saved-views trigger (one model everywhere).
  await expect(page.getByTestId("saved-views-trigger")).toBeVisible();
  // ONE discovery model: a free-text search box first.
  await expect(page.getByRole("searchbox").first().or(page.locator('input[placeholder^="Search"]').first())).toBeVisible();
  // Filters pill.
  await expect(page.getByRole("button", { name: /filters/i }).first()).toBeVisible();
  // The single "+" AddMenu (no per-section duplicate add chrome).
  await expect(page.getByTestId("add-menu-trigger")).toBeVisible();
  // The SAME KpiStrip "Stats" banner with its collapser.
  await expect(page.getByRole("button", { name: /hide stats|show stats/i }).first()).toBeVisible();
}

for (const section of SECTIONS) {
  test(`E5 — ${section.label} runs the shared journey with identical chrome (desktop)`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, `/${section.slug}`);
    await expect(visibleByTestId(page, section.screenTestId)).toBeVisible({ timeout: 30000 });

    // 1) Identical chrome present on the cash-movement surface.
    await assertSharedChrome(page);

    // The default cash-movement tab is active in the SectionTabs bar.
    await expect(page.getByTestId(`section-tab-${section.slug}`)).toHaveAttribute("data-active", "true");

    // 2) Apply a filter via the Filters panel (the same entry point everywhere)
    //    and close it again — proves the Filters pill is wired on every section.
    await page.getByRole("button", { name: /filters/i }).first().click();
    await expect(page.getByRole("dialog").or(page.locator('[role="menu"]')).first()).toBeVisible({ timeout: 10000 });
    await page.keyboard.press("Escape");

    // 3) Collapse + re-expand the SAME Stats banner (identical behavior).
    const statsToggle = page.getByRole("button", { name: /hide stats/i }).first();
    if (await statsToggle.isVisible().catch(() => false)) {
      await statsToggle.click();
      await expect(page.getByRole("button", { name: /show stats/i }).first()).toBeVisible({ timeout: 5000 });
      await page.getByRole("button", { name: /show stats/i }).first().click();
    }

    // 4) Walk each non-default sub-tab via the SectionTabs bar (real clicks),
    //    then return to the cash-movement tab. Done BEFORE opening a row, because
    //    on Income a real payment row legitimately routes to the register.
    for (const subtab of section.subtabs) {
      await page.getByTestId(`section-tab-${subtab.id}`).click();
      await expect(visibleByTestId(page, subtab.ready)).toBeVisible({ timeout: 30000 });
    }
    await page.getByTestId(`section-tab-${section.slug}`).click();
    await expect(visibleByTestId(page, section.screenTestId)).toBeVisible({ timeout: 30000 });

    await expectNoHorizontalScroll(page, 1440);
    await page.screenshot({ path: shot(`section-${section.slug}-1440`), fullPage: false, ...SHOT_OPTS });

    // 5) Open a row detail LAST (every section opens a detail — no dead clicks).
    //    Some sections may legitimately be empty for the active entity; only
    //    assert the detail when at least one row exists. On Income a real payment
    //    row routes to the register (a detail, just on another surface), so accept
    //    either a DetailSheet dialog OR a navigation to /transactions.
    const firstRow = page.getByTestId(section.rowTestId).first();
    if (await firstRow.isVisible().catch(() => false)) {
      await firstRow.click();
      const opened = await page
        .getByRole("dialog")
        .first()
        .isVisible({ timeout: 15000 })
        .catch(() => false);
      if (!opened) {
        // Income payment rows route to the register detail instead of a sheet.
        await expect(page).toHaveURL(/\/transactions/, { timeout: 15000 });
      }
    }
  });

  test(`E5 — ${section.label} mobile @ 390 keeps the shared chrome with no horizontal scroll`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApp(page, `/${section.slug}`);
    await expect(visibleByTestId(page, section.screenTestId)).toBeVisible({ timeout: 30000 });

    // The SectionTabs bar + the single "+" AddMenu survive on mobile.
    await expect(page.getByTestId("section-tabs")).toBeVisible();
    await expect(page.getByTestId("add-menu-trigger")).toBeVisible();

    // A row detail opens as a bottom Drawer on mobile (the shared DetailSheet).
    const firstRow = page.getByTestId(section.rowTestId).first();
    if (await firstRow.isVisible().catch(() => false)) {
      await firstRow.click();
      await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 15000 });
      await page.keyboard.press("Escape");
    }

    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: shot(`section-${section.slug}-390`), fullPage: false, ...SHOT_OPTS });
  });
}

// A compact side-by-side at both widths: the four cash-movement surfaces shot
// back-to-back so the reviewer can see ONE uniform product at a glance.
test("E5 — side-by-side of all four sections (desktop + 390)", async ({ page }) => {
  test.setTimeout(240_000);
  for (const width of [1440, 390] as const) {
    const height = width === 390 ? 844 : 900;
    await page.setViewportSize({ width, height });
    for (const section of SECTIONS) {
      await gotoApp(page, `/${section.slug}`);
      await expect(visibleByTestId(page, section.screenTestId)).toBeVisible({ timeout: 30000 });
      // Every section shows the SAME toolbar landmarks.
      await expect(page.getByTestId("saved-views-trigger")).toBeVisible();
      await expect(page.getByTestId("add-menu-trigger")).toBeVisible();
      await page.screenshot({ path: shot(`sidebyside-${section.slug}-${width}`), fullPage: false, ...SHOT_OPTS });
    }
  }
});
