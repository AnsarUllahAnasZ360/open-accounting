import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { FINISHING_EVIDENCE, gotoApp, installDevOverlayGuard } from "./helpers";

// Epic 0 — Audit baseline. One test per surface; each captures a "before"
// screenshot at every gate width and records horizontal-overflow into a shared
// manifest. Screenshots use animations:"disabled" so the live Convex app can
// stabilise a frame. The baseline is allowed to be broken — overflow is recorded,
// never asserted.

const WIDTHS = [390, 768, 1306, 1440, 1758] as const;

const SURFACES: Array<{ key: string; route: string; ready?: string }> = [
  { key: "dashboard", route: "/dashboard", ready: "dashboard-screen" },
  { key: "inbox", route: "/inbox", ready: "inbox-list" },
  { key: "transactions", route: "/transactions", ready: "transactions-screen" },
  { key: "income", route: "/income", ready: "income-screen" },
  { key: "expenses", route: "/expenses", ready: "expenses-screen" },
  { key: "bills", route: "/expenses/bills", ready: "expenses-bills-screen" },
  { key: "contacts", route: "/contacts", ready: "m6-contacts-screen" },
  { key: "payroll", route: "/payroll", ready: "m6-payroll-screen" },
  { key: "reports", route: "/reports", ready: "reports-screen" },
  { key: "settings", route: "/settings", ready: "settings-screen" },
  { key: "ask-ai", route: "/ask-ai" },
];

const OUT_DIR = `${FINISHING_EVIDENCE}/baseline`;
const MANIFEST = `${OUT_DIR}/2026-06-13-baseline-manifest.json`;
const STAMP = "2026-06-13";

type Row = { surface: string; width: number; overflowPx: number; captured: boolean; note?: string };

function appendRows(newRows: Row[]) {
  mkdirSync(OUT_DIR, { recursive: true });
  let rows: Row[] = [];
  if (existsSync(MANIFEST)) {
    try {
      rows = JSON.parse(readFileSync(MANIFEST, "utf8")).rows ?? [];
    } catch {
      rows = [];
    }
  }
  rows = rows.filter((r) => !newRows.some((n) => n.surface === r.surface && n.width === r.width));
  rows.push(...newRows);
  const overflowing = rows.filter((r) => r.overflowPx > 1);
  writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        stampedAt: STAMP,
        note: "Pre-redesign baseline. overflowPx>1 means horizontal overflow at that width.",
        widths: WIDTHS,
        captured: rows.filter((r) => r.captured).length,
        overflowingCount: overflowing.length,
        overflowing,
        rows: rows.sort((a, b) => a.surface.localeCompare(b.surface) || a.width - b.width),
      },
      null,
      2,
    ),
  );
}

async function measureOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.scrollingElement || document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
}

for (const surface of SURFACES) {
  test(`baseline — ${surface.key}`, async ({ page }) => {
    test.setTimeout(150_000);
    await installDevOverlayGuard(page);
    const rows: Row[] = [];

    for (const width of WIDTHS) {
      const row: Row = { surface: surface.key, width, overflowPx: -1, captured: false };
      try {
        await page.setViewportSize({ width, height: 900 });
        await gotoApp(page, surface.route);
        if (surface.ready) {
          await page
            .getByTestId(surface.ready)
            .first()
            .waitFor({ state: "visible", timeout: 12000 })
            .catch(() => {});
        }
        await page.waitForTimeout(900);
        row.overflowPx = await measureOverflow(page);
        await page.screenshot({
          path: `${OUT_DIR}/${STAMP}-before-${surface.key}-${width}.png`,
          fullPage: true,
          animations: "disabled",
          caret: "hide",
          timeout: 30000,
        });
        row.captured = true;
      } catch (error) {
        row.note = String(error).split("\n")[0].slice(0, 200);
        // eslint-disable-next-line no-console
        console.log(`[baseline] ${surface.key}@${width} FAILED: ${row.note}`);
      }
      rows.push(row);
    }

    appendRows(rows);
    // Soft expectation: at least one width captured, so a totally broken route is visible in CI.
    expect(rows.some((r) => r.captured)).toBeTruthy();
  });
}
