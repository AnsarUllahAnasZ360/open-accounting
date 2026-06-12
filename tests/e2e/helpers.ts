import { expect, type Locator, type Page } from "@playwright/test";

export const FINISHING_EVIDENCE = "docs/finishing/evidence";

export async function installDevOverlayGuard(page: Page) {
  await page.addInitScript(() => {
    const strip = () => {
      document
        .querySelectorAll("nextjs-portal, [data-nextjs-dev-overlay]")
        .forEach((node) => node.remove());
    };
    const start = () => {
      strip();
      new MutationObserver(strip).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    };
    if (document.documentElement) start();
    else document.addEventListener("DOMContentLoaded", start);
  });
}

export async function gotoApp(page: Page, path = "/dashboard") {
  await page.goto(path);
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 30000 });
}

export function visibleByTestId(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true }).first();
}

export async function expectNoHorizontalScroll(page: Page, width?: number) {
  if (width) {
    const height = page.viewportSize()?.height ?? 900;
    await page.setViewportSize({ width, height });
  }
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement || document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

export async function expectClickable(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible({ timeout: 15000 });
  await expect(locator).toBeEnabled({ timeout: 15000 });
  const ownsReachablePoint = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const insetX = Math.min(12, rect.width / 2);
    const insetY = Math.min(12, rect.height / 2);
    const points = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + insetX, rect.top + insetY],
      [rect.right - insetX, rect.top + insetY],
      [rect.left + insetX, rect.bottom - insetY],
      [rect.right - insetX, rect.bottom - insetY],
    ];
    return points.some(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return hit === element || Boolean(hit && element.contains(hit));
    });
  });
  expect(ownsReachablePoint).toBe(true);
}
