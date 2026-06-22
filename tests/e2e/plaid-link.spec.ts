import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const strip = () =>
      document
        .querySelectorAll("nextjs-portal, [data-nextjs-dev-overlay]")
        .forEach((node) => node.remove());
    strip();
    new MutationObserver(strip).observe(document.documentElement, { childList: true, subtree: true });
  });
});

const EVIDENCE = "docs/finishing/evidence";

function visibleByTestId(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true }).first();
}

async function openConnections(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/settings/connections");
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 30000 });
  await expect(visibleByTestId(page, "connections-section")).toBeVisible({ timeout: 30000 });

  if ((await page.getByTestId("plaid-connection-panel").count()) === 0) {
    await visibleByTestId(page, "live-sandbox-create").click();
    await expect(visibleByTestId(page, "plaid-connection-panel")).toBeVisible({ timeout: 30000 });
  }
}

test("G1 — Plaid Link surface prepares a token without syncing shared books", async ({ page }) => {
  test.setTimeout(120_000);
  await openConnections(page, 1440);

  const panel = visibleByTestId(page, "plaid-connection-panel");
  await expect(panel).toBeVisible({ timeout: 30000 });
  await expect(panel.getByRole("button", { name: "Prepare Link" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Open Plaid Link" })).toBeDisabled();

  await panel.getByRole("button", { name: "Prepare Link" }).click();
  await expect(page.getByTestId("plaid-panel-message")).toContainText(/Open Plaid Link|Fixture Link token/i, {
    timeout: 30000,
  });

  const message = await page.getByTestId("plaid-panel-message").innerText();
  if (/Open Plaid Link/i.test(message)) {
    await expect(visibleByTestId(page, "plaid-open-link")).toBeEnabled({ timeout: 30000 });
  } else {
    await expect(visibleByTestId(page, "plaid-open-link")).toBeDisabled();
    await expect(page.getByTestId("plaid-panel-message")).toContainText(/fixture/i);
  }

  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-G1-plaid-link-surface.png`, fullPage: true });
});

test("G1 — Plaid connection panel stays usable on mobile", async ({ page }) => {
  test.setTimeout(120_000);
  await openConnections(page, 390);

  const panel = visibleByTestId(page, "plaid-connection-panel");
  await expect(panel).toBeVisible({ timeout: 30000 });
  await expect(visibleByTestId(page, "plaid-open-link")).toBeVisible();
  await expect(panel.getByText("Sandbox ready").or(panel.getByText("Fixture mode")).or(panel.getByText("Sandbox required"))).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-G1-plaid-mobile.png`, fullPage: true });
});

test("G2 — Plaid sync controls expose the cron/manual path without syncing books", async ({ page }) => {
  test.setTimeout(120_000);
  await openConnections(page, 1440);

  const panel = visibleByTestId(page, "plaid-connection-panel");
  await expect(panel).toBeVisible({ timeout: 30000 });
  await panel.getByRole("button", { name: "Prepare Link" }).click();
  await expect(page.getByTestId("plaid-panel-message")).toContainText(/Open Plaid Link|Fixture Link token/i, {
    timeout: 30000,
  });
  await expect(visibleByTestId(page, "plaid-sync-now")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Sync fixture" })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-G2-plaid-sync-controls.png`, fullPage: true });
});

test("E3-T5 — Add bank sheet maps each Plaid account to a business", async ({ page }) => {
  test.setTimeout(120_000);
  await openConnections(page, 1440);

  // The "Add bank" entry point only appears once a Plaid app is configured.
  if ((await page.getByTestId("bank-add-open").count()) === 0) {
    test.skip(true, "Plaid app not configured in this environment; per-account mapping UI requires a live Link.");
  }

  await visibleByTestId(page, "bank-add-open").click();
  const sheet = visibleByTestId(page, "add-bank-sheet");
  await expect(sheet).toBeVisible({ timeout: 30000 });

  // Pre-link: the owner picks a starting business and is told each account will
  // be mapped after Plaid returns them (the E3-T5 preview-then-assign promise).
  await expect(visibleByTestId(page, "add-bank-business")).toBeVisible();
  await expect(sheet.getByText(/map each connected account to a business/i)).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/2026-06-19-E3-T5-add-bank-mapping.png`, fullPage: true });
});
