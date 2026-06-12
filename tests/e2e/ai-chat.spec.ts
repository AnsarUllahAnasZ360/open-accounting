import { expect, type Locator, type Page, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { api } from "../../convex/_generated/api";

// Epic B4-B5 — Ask AI durable threads + docked layout.
// These tests use real pointer clicks only. They intentionally avoid posting
// bookkeeping changes to the shared demo books; proposal UI coverage uses
// dismiss/not-now rather than confirm in e2e, while confirm behavior remains
// covered by Convex unit tests.

const EVIDENCE = "docs/finishing/evidence";

test.describe.configure({ mode: "serial" });

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
});

async function gotoApp(page: Page, path = "/dashboard") {
  await page.goto(path);
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 30000 });
}

function readLocalEnv(name: string) {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const equalsIndex = line.indexOf("=");
    const key = line.slice(0, equalsIndex).trim();
    if (key !== name) continue;
    return line.slice(equalsIndex + 1).trim().replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "");
  }
  return "";
}

function convexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || readLocalEnv("NEXT_PUBLIC_CONVEX_URL");
  return new ConvexHttpClient(convexUrl);
}

async function createProposalFixture() {
  const client = convexClient();
  const stamp = Date.now().toString().slice(-6);
  const entity = await client.mutation(api.entities.create, {
    name: `E2E AI ${stamp} LLC`,
    businessType: "services",
    currency: "USD",
  });
  const fixture = await client.mutation(api.aiThreads.createProposalFixture, { entityId: entity.entityId });
  return { ...fixture, entityId: entity.entityId };
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement || document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
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

async function openDesktopPanel(page: Page) {
  await page.getByTestId("ask-ai-button").click();
  const panel = page.getByTestId("ai-panel");
  await expect(panel).toBeVisible({ timeout: 15000 });
  return panel;
}

async function waitForBooksContext(panel: Locator) {
  await expect(panel.getByPlaceholder("Ask about your books")).toBeEnabled({ timeout: 30000 });
}

async function waitForBedrockActive(panel: Locator) {
  await panel.getByText("Bedrock active").waitFor({ timeout: 15000 }).catch(() => null);
  return await panel.getByText("Bedrock active").isVisible().catch(() => false);
}

async function startNewConversation(panel: Locator) {
  await waitForBooksContext(panel);
  await panel.getByRole("button", { name: "New Ask AI conversation" }).click();
  await expect(panel.getByTestId("ai-empty-state")).toBeVisible({ timeout: 15000 });
}

test("B4 — docked Ask AI sends to Convex Agent, renders markdown, and persists thread after reload", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/reports");

  const panel = await openDesktopPanel(page);
  await startNewConversation(panel);

  const active = await waitForBedrockActive(panel);
  test.skip(!active, "Bedrock is not configured; degraded mode cannot prove streamed markdown.");

  const prompt =
    "Answer with a short markdown table with columns Metric and Value. Include a row named **Net profit**. Use the reports context if useful.";
  await panel.getByPlaceholder("Ask about your books").fill(prompt);
  await panel.getByRole("button", { name: "Send question" }).click();

  await expect(panel.getByTestId("ai-user-message").last()).toContainText("markdown table", { timeout: 15000 });
  await expect(panel.getByTestId("ai-markdown-table").first()).toBeVisible({ timeout: 120000 });
  await expect(panel.getByTestId("ai-markdown-response").last()).toContainText(/Net profit/i, {
    timeout: 120000,
  });
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-B4-markdown-thread.png`, fullPage: true });

  await page.reload();
  const reloadedPanel = await openDesktopPanel(page);
  await expect(reloadedPanel.getByTestId("ai-user-message").last()).toContainText("markdown table", {
    timeout: 30000,
  });
  await expect(reloadedPanel.getByTestId("ai-markdown-response").last()).toContainText(/Net profit/i, {
    timeout: 30000,
  });
  await startNewConversation(reloadedPanel);
  await expect(reloadedPanel.getByTestId("ai-user-message")).toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-B4-thread-persist-new.png`, fullPage: true });
});

test("B4 — proposal tools render durable confirmation cards without mutating books", async ({ page }) => {
  test.setTimeout(240_000);
  const fixture = await createProposalFixture();
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, "/reports");

    const panel = await openDesktopPanel(page);
    const card = panel.getByTestId("ai-confirmation-card").first();
    await expect(card).toBeVisible({ timeout: 120000 });
    expect(fixture.threadId).toBeTruthy();
    await expect(card).toContainText("Nothing has been posted or written yet.");
    await card.getByRole("button", { name: "Create rule" }).click();
    await expect(card.getByTestId("ai-proposal-result")).toContainText(/Rule (created|updated)/, { timeout: 30000 });
    await page.screenshot({ path: `${EVIDENCE}/2026-06-12-B4-confirmation-card.png`, fullPage: true });
  } finally {
    await convexClient().mutation(api.entities.archive, { entityId: fixture.entityId });
  }
});

test("B5 — desktop panel is docked and main content remains clickable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/dashboard");
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 30000 });
  const panel = await openDesktopPanel(page);
  await waitForBooksContext(panel);

  await expectNoHorizontalScroll(page);
  expect(await boxesOverlap(panel, page.getByTestId("app-sidebar"))).toBe(false);
  expect(await boxesOverlap(panel, page.getByTestId("app-main-column"))).toBe(false);

  await page.getByTestId("dashboard-screen").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/transactions/);
  await expect(page.getByTestId("transactions-screen")).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-B5-docked-desktop.png`, fullPage: true });
});

test("B5 — mobile Ask AI opens as bottom sheet, closes, and keeps width stable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/dashboard");
  await expectNoHorizontalScroll(page);

  await page.locator("nav").getByRole("button", { name: "Ask AI" }).click();
  const panel = page.getByTestId("ai-panel-mobile");
  await expect(panel).toBeVisible({ timeout: 15000 });
  await expect(panel.getByText("Ask AI").first()).toBeVisible();
  await waitForBooksContext(panel);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-B5-mobile-sheet.png`, fullPage: true });

  await panel.getByRole("button", { name: "Close Ask AI" }).click();
  await expect
    .poll(async () => {
      const box = await panel.boundingBox();
      return box ? box.y > 760 : false;
    }, { timeout: 5000 })
    .toBe(true);
});
