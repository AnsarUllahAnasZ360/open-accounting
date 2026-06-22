import { expect, type Locator, type Page, test } from "@playwright/test";

import { appUrl, gotoApp } from "./helpers";

// Epic A — App shell & navigation fidelity.
// These specs use REAL pointer clicks only; no synthetic events or forced clicks.
// The app runs in dev-auth-bypass mode locally (NEXT_PUBLIC_OPENBOOKS_DEV_AUTH_BYPASS=1),
// so navigating to an app route renders the authenticated shell directly.

const EVIDENCE = "docs/finishing/evidence";

// Final navigation order the prototype specifies (Epic A3). Post-redesign,
// Settings was MOVED OUT of the primary nav into the sidebar footer cluster
// (beside Sync + Profile), so the PRIMARY nav now lists 9 destinations; Settings
// is asserted separately as reachable from the footer.
// Epic E3 demoted Bills from the primary nav: it is now the "Bills" sub-tab
// under Expenses (/expenses/bills), so the primary nav lists 8 destinations.
const NAV_ORDER = [
  "Dashboard",
  "Inbox",
  "Transactions",
  "Income",
  "Expenses",
  "Contacts",
  "Payroll",
  "Reports",
];

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement || document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  // Allow 1px for sub-pixel rounding.
  expect(overflow).toBeLessThanOrEqual(1);
}

async function boxesOverlap(a: Locator, b: Locator) {
  const ba = await a.boundingBox();
  const bb = await b.boundingBox();
  if (!ba || !bb) return false;
  return !(
    ba.x + ba.width <= bb.x ||
    bb.x + bb.width <= ba.x ||
    ba.y + ba.height <= bb.y ||
    bb.y + bb.height <= ba.y
  );
}

// Each test resets sidebar/collapse state in beforeEach and navigates fresh, so
// they are independent. Default (non-serial) mode means a single known product
// defect — the A4 ⌘K deep-link, flagged for the source-fix agent — does not mask
// the remaining shell assertions (serial mode aborts every later test on the
// first failure).
test.describe.configure({ mode: "default" });

// The Next.js dev-tools overlay renders a shadow-DOM `nextjs-portal` in the
// bottom-left corner — the same corner as the collapsed-rail footer avatar — and
// captures pointer events there. It is dev-only chrome that does NOT exist in a
// production build, so removing it in the test environment is not masking a
// product overlap (real product clicks stay real). We still click product
// elements normally. A MutationObserver
// keeps it removed because Next re-mounts it on every client navigation.
test.beforeEach(async ({ page }) => {
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

  // Serial mode shares one browser context, so sidebar-collapse state would leak
  // between tests. Reset it to a known expanded baseline before each test (the A1
  // reload-persistence assertion sets + reloads within its own body, so this does
  // not interfere with it).
  await page.goto(appUrl("/dashboard"));
  await page.evaluate(() => {
    try {
      window.localStorage.removeItem("ob:sidebar-collapsed");
    } catch {
      // ignore
    }
  });
});

test("A1 — sidebar collapses to a 56px rail, persists across reload, and expands", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page);

  const sidebar = page.getByTestId("app-sidebar");
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  const expandedWidth = (await sidebar.boundingBox())!.width;
  expect(expandedWidth).toBeGreaterThan(200);

  // Real click on the collapse control.
  await page.getByTestId("sidebar-collapse").click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(56);

  // Tooltip shows on hover over a rail icon (scoped to the sidebar — the same
  // label can appear in page content).
  const railReports = sidebar.getByRole("link", { name: "Reports", exact: true });
  await railReports.hover();
  await expect(page.getByRole("tooltip").filter({ hasText: "Reports" })).toBeVisible({ timeout: 5000 });

  await page.screenshot({ path: `${EVIDENCE}/2026-06-11-A1-rail-collapsed.png`, fullPage: false });

  // Navigate to Reports straight from the rail.
  await railReports.click();
  await expect(page).toHaveURL(/\/reports$/);
  // Still collapsed after navigating.
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");

  // Reload — collapse state survives (localStorage).
  await page.reload();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(56);

  // Expand again.
  await page.getByTestId("sidebar-expand").click();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");

  await page.screenshot({ path: `${EVIDENCE}/2026-06-11-A1-sidebar-expanded.png`, fullPage: false });
});

test("A2 — sidebar footer menu opens in both states; Log out lands on sign-in", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page);

  // Expanded: profile row opens the menu with View profile / Settings / Log out.
  await page.getByTestId("profile-trigger").click();
  const menu = page.getByTestId("profile-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("profile-view")).toBeVisible();
  await expect(menu.getByTestId("profile-settings")).toBeVisible();
  await expect(menu.getByTestId("profile-logout")).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/2026-06-11-A2-footer-menu.png`, fullPage: false });

  // Settings item navigates (clicked directly from the open menu).
  await menu.getByTestId("profile-settings").click();
  await expect(page).toHaveURL(/\/settings$/);

  // Collapsed: avatar-only trigger still opens the menu.
  await gotoApp(page);
  await page.getByTestId("sidebar-collapse").click();
  await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-state", "collapsed");
  await page.getByTestId("profile-trigger").click();
  await expect(page.getByTestId("profile-menu")).toBeVisible();

  // Log out → sign-in page (no top-bar logout exists anymore).
  await page.getByTestId("profile-logout").click();
  await expect(page).toHaveURL(/\/sign-in$/, { timeout: 15000 });
  await expect(page.getByRole("heading", { name: /books stay private/i })).toBeVisible();
});

test("A2b — there is no logout control in the top bar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page);
  const header = page.locator("header");
  await expect(header.getByRole("button", { name: /sign out/i })).toHaveCount(0);
  await expect(header.getByRole("button", { name: /log out/i })).toHaveCount(0);
});

test("A3 — primary nav shows the 8 destinations in order, Settings is in the footer, and /invoices + /bills redirect", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page);

  const sidebar = page.getByTestId("app-sidebar");
  const navLabels = await sidebar.locator("nav a").allInnerTexts();
  // Each nav link's first line is its label; badges add extra lines.
  const labels = navLabels.map((text) => text.split("\n")[0].trim()).filter(Boolean);
  // Redesign: Settings is no longer a primary-nav destination — the primary nav
  // lists 8 items (Bills demoted under Expenses in E3) and Settings lives in the
  // footer cluster (asserted below).
  expect(labels).toEqual(NAV_ORDER);

  // Settings is OUTSIDE the primary <nav> — it lives in the sidebar footer's
  // profile menu (account/admin controls grouped together). Open the profile
  // menu and confirm the Settings item routes.
  await page.getByTestId("profile-trigger").click();
  const settingsItem = page.getByTestId("profile-menu").getByTestId("profile-settings");
  await expect(settingsItem).toBeVisible();
  await settingsItem.click();
  await expect(page).toHaveURL(/\/settings$/);
  await gotoApp(page);

  // Income/Expenses routes exist and are distinct (Expenses is NOT Bills).
  await sidebar.getByRole("link", { name: "Income", exact: true }).click();
  await expect(page).toHaveURL(/\/income$/);
  await sidebar.getByRole("link", { name: "Expenses", exact: true }).click();
  await expect(page).toHaveURL(/\/expenses$/);
  await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible();

  // Old URL redirects.
  await page.goto(appUrl("/invoices"));
  await expect(page).toHaveURL(/\/income$/);
  // Bills was demoted under Expenses (E3); the old top-level link still resolves.
  await page.goto(appUrl("/bills"));
  await expect(page).toHaveURL(/\/expenses\/bills$/);

  await page.screenshot({ path: `${EVIDENCE}/2026-06-11-A3-nav-income.png`, fullPage: false });
});

test("A3b — Inbox nav item renders a count badge from inbox data", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page);
  // Either a numeric badge (count > 0) or the green zero-dot must render.
  const badge = page.getByTestId("inbox-badge").or(page.getByTestId("inbox-badge-zero"));
  await expect(badge.first()).toBeVisible({ timeout: 15000 });
});

test("A4 — ⌘K opens the palette; typing a merchant and pressing Enter opens its transaction", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page);

  // Open via keyboard shortcut.
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByTestId("command-palette-input");
  await expect(input).toBeVisible();

  // Discover a real seeded merchant from the register (merchant is the bold name
  // in the third column), then search for it in the palette.
  await page.goto(appUrl("/transactions"));
  const firstRow = page.getByTestId("transaction-row").first();
  await expect(firstRow).toBeVisible({ timeout: 30000 });
  const firstMerchant = (await firstRow.locator(".font-medium").first().innerText()).trim();
  const firstTxnId = await firstRow.getAttribute("data-transaction-id");
  expect(firstMerchant.length).toBeGreaterThan(2);

  await page.keyboard.press("ControlOrMeta+k");
  await expect(input).toBeVisible();
  // Type a distinctive prefix of the merchant name.
  await input.fill(firstMerchant.slice(0, Math.min(8, firstMerchant.length)));
  const txnOption = page
    .getByTestId("command-palette-list")
    .locator('[data-slot="command-item"]', { hasText: firstMerchant })
    .first();
  await expect(txnOption).toBeVisible({ timeout: 10000 });
  await txnOption.click();

  // Lands on the register focused on that transaction (drawer open + URL param).
  await expect(page).toHaveURL(new RegExp(`/transactions\\?focus=${firstTxnId}`));
  // KNOWN PRODUCT DEFECT (flagged for the source-fix agent): when the register
  // is ALREADY mounted, a client-side ⌘K deep-link changes the `?focus=` param
  // but TransactionsScreen only seeds `selectedId` from `focusId` in a
  // `useState(focusId)` initializer (CoreScreens.tsx ~L1203) with no effect to
  // sync a subsequent param change — so the drawer never opens on this path. A
  // direct fresh-mount to /transactions?focus= DOES open it (verified). This
  // assertion is intentionally NOT weakened: it documents the real ⌘K UX promise
  // and will pass once the screen syncs focusId → selectedId after mount.
  await expect(page.getByTestId("transaction-drawer")).toBeVisible({ timeout: 15000 });

  await page.screenshot({ path: `${EVIDENCE}/2026-06-11-A4-command-palette.png`, fullPage: false });
});

test("A4b — ⌘J opens the Ask AI panel", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page);

  const panel = page.getByTestId("ai-panel");
  // The panel is mounted only when opened; on desktop it reserves a side column
  // instead of covering the active page.
  await page.keyboard.press("ControlOrMeta+j");
  await expect(panel).toBeVisible({ timeout: 5000 });
  // The Ask AI panel was rebuilt on AI Elements: the docked surface exposes its
  // identity through the accessible "Ask AI chat for …" region label and a
  // "Chat" header, not a visible "Ask AI" string. Assert the real, current DOM.
  await expect(panel.getByLabel(/Ask AI chat for/i)).toBeVisible();
  await expect(panel.getByText("Chat", { exact: true }).first()).toBeVisible();
});

test("A5 — entity switcher lists the workspace's businesses and offers Add a business", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page);

  await page.getByTestId("entity-switcher").click();
  const menu = page.getByTestId("entity-menu");
  await expect(menu).toBeVisible();
  // At least one business is listed and the add-business action routes to settings.
  await expect(menu.getByText("Businesses")).toBeVisible();
  await expect(menu.getByTestId("entity-add-business")).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/2026-06-11-A5-entity-switcher.png`, fullPage: false });

  // The redesign moved the active-entity name OUT of a page-header eyebrow (that
  // <p> no longer exists) and into the sidebar entity switcher itself, where it
  // renders `{activeEntityName}` flowing from the viewer/report context. The
  // data-driven proof is now: the switcher's label is non-empty and equals the
  // entity marked active (disabled) in its own menu — never a hardcoded literal.
  const activeOption = menu.locator('[role="menuitem"][data-disabled], [role="menuitem"][aria-disabled="true"]').first();
  const activeName = (await activeOption.innerText()).trim().split("\n")[0]!.trim();
  expect(activeName.length).toBeGreaterThan(0);
  const switcherName = (await page.getByTestId("entity-switcher").innerText()).trim();
  expect(switcherName).toContain(activeName);

  await menu.getByTestId("entity-add-business").click();
  await expect(page).toHaveURL(/\/settings$/);
});

test("A — layout: no horizontal scroll at 1440 and 390, and the AI panel does not cover nav targets", async ({ page }) => {
  test.setTimeout(120_000);

  // Desktop.
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page);
  await expectNoHorizontalScroll(page);

  // Open AI panel and assert it does not overlap the top-bar Ask AI button or
  // the sidebar (interactive targets stay clickable).
  await page.getByTestId("ask-ai-button").click();
  const panel = page.getByTestId("ai-panel");
  await expect(panel).toBeVisible();
  expect(await boxesOverlap(panel, page.getByTestId("app-sidebar"))).toBe(false);
  expect(await boxesOverlap(panel, page.getByTestId("entity-switcher"))).toBe(false);
  await expectNoHorizontalScroll(page);

  // Mobile.
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${EVIDENCE}/2026-06-11-A1-mobile-shell.png`, fullPage: false });
});
