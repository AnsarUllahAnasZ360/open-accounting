import { mkdirSync } from "node:fs";

import { test } from "@playwright/test";

import { FINISHING_EVIDENCE, installDevOverlayGuard } from "./helpers";

// Epic 1 — capture the workbench-primitive harness (/dev/workbench) at the three
// gate widths the report names for the primitive harness (390/768/1440), plus
// 1306 for the dense desktop band. Standalone page, no auth required.

const WIDTHS = [390, 768, 1306, 1440] as const;
const OUT_DIR = `${FINISHING_EVIDENCE}/epic1`;
const STAMP = "2026-06-13";

test("epic1 harness — capture workbench primitives at gate widths", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT_DIR, { recursive: true });
  await installDevOverlayGuard(page);

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/dev/workbench", { waitUntil: "networkidle" });
    // Let any popovers/charts settle.
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: `${OUT_DIR}/${STAMP}-workbench-${width}.png`,
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      timeout: 30000,
    });
  }
});
