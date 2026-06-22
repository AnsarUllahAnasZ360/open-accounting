import { expect, type Locator, type Page } from "@playwright/test";

export const FINISHING_EVIDENCE = "docs/finishing/evidence";

// The dev server runs on :3100. Convex's client WebSocket only handshakes
// reliably on the `localhost` hostname in a COLD headless Playwright context —
// a cold `127.0.0.1` context hangs on "Loading your open books workspace…" and
// the app-sidebar never mounts. The repo playwright.config baseURL defaults to
// 127.0.0.1, so every navigation that wants the authenticated shell MUST go
// through this absolute localhost origin instead of a relative path.
//
// Override with PLAYWRIGHT_APP_ORIGIN if the dev server is on another host/port.
export const APP_ORIGIN = process.env.PLAYWRIGHT_APP_ORIGIN ?? "http://localhost:3100";

export function appUrl(path = "/dashboard") {
  if (/^https?:\/\//.test(path)) return path;
  return `${APP_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

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
  // Navigate to the absolute localhost origin (NOT the config's 127.0.0.1
  // baseURL) so the Convex WebSocket handshakes in a cold headless context,
  // retrying past transient dev-server 500s. The dev-auth bypass renders the
  // authenticated shell directly, so success == the sidebar mounting.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto(appUrl(path));
    const hasError = await page
      .locator("body")
      .filter({ hasText: /500|Internal Server Error/ })
      .count();
    if (hasError === 0) break;
    if (attempt < 4) await page.waitForTimeout(5000);
  }
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 90000 });
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

// ---------------------------------------------------------------------------
// Disposable-book convention (E14-T7).
//
// THE GUARD: every go-live e2e spec must operate ONLY on a fresh, throwaway
// workspace it creates itself via the onboarding UI — NEVER on Ansar's real
// Zikra / Z360 production books, and never on the shared dev-bypass workspace
// other specs depend on. The fallback "dedicated isolated entity via the reset
// surface" is allowed ONLY if a shared-deployment constraint forces it, and even
// then it must be gated so it can never touch real data (decided: see
// docs/launch-sprint/decisions.md).
//
// How the guard is enforced in practice:
//   1. `signUpDisposableOwner` mints a brand-new owner via a stamped, unique
//      email + a stamped business name, so the sign-up creates a NEW workspace
//      every run. A new owner can only ever see their own new workspace.
//   2. We assert the run lands on guided onboarding (`onboarding-business-step`)
//      — i.e. an EMPTY first-run workspace, never an existing populated book.
//   3. The created workspace name embeds the unique stamp, so a destructive
//      re-type-to-confirm reset can only match the disposable workspace.
//
// These names are intentionally implausible as real-entity names ("E2E …
// <timestamp>") so a misfire is obvious and never collides with Zikra/Z360.
// ---------------------------------------------------------------------------

export const DEV_OVERLAY_INIT = () => {
  const strip = () =>
    document
      .querySelectorAll("nextjs-portal, [data-nextjs-dev-overlay]")
      .forEach((node) => node.remove());
  strip();
  new MutationObserver(strip).observe(document.documentElement, { childList: true, subtree: true });
};

export interface DisposableWorkspace {
  email: string;
  password: string;
  businessName: string;
  /** The onboarding-derived workspace name = `${businessName} workspace`. */
  workspaceName: string;
}

/**
 * Sign up a brand-new owner and stop on the FIRST onboarding step. The caller
 * then drives the guided flow (or skips). Guarantees a disposable workspace:
 * the email + business name are stamped-unique, so this never reuses a real or
 * shared workspace. See the disposable-book guard above.
 */
export async function signUpDisposableOwner(
  page: Page,
  label: string,
): Promise<DisposableWorkspace> {
  const stamp = Date.now();
  const tag = String(stamp).slice(-6);
  const email = `e2e-${label}-${stamp}@example.com`;
  const password = `OpenBooks-${stamp}!`;
  const businessName = `E2E ${label} ${tag}`;
  const workspaceName = `${businessName} workspace`;

  await page.goto(appUrl("/sign-in"));
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("Name").fill(`E2E ${label} Owner`);
  await page.getByRole("button", { name: /Sign in/ }).click();

  // A brand-new owner ALWAYS lands on guided onboarding with an empty book —
  // proof we are on a disposable workspace, not a populated real one.
  await expect(page.getByTestId("onboarding-business-step")).toBeVisible({ timeout: 30000 });
  return { email, password, businessName, workspaceName };
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
