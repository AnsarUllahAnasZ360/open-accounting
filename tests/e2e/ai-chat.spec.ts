import { expect, type Locator, type Page, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { api } from "../../convex/_generated/api";
import { gotoApp } from "./helpers";

// Epic B4-B5 — Ask AI durable threads + docked layout.
// These tests use real pointer clicks only. They intentionally avoid posting
// bookkeeping changes to the shared demo books; proposal UI coverage uses
// dismiss/not-now rather than confirm in e2e, while confirm behavior remains
// covered by Convex unit tests.

const EVIDENCE = "docs/finishing/evidence";

// Each test navigates fresh (and the proposal test owns a disposable entity), so
// they are independent. Default (non-serial) mode keeps the live-model-dependent
// B4 markdown parity test from masking the deterministic B5 layout / thread-rail
// / mobile assertions when the model's reply varies.
test.describe.configure({ mode: "default" });

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
  await expect(panel.getByLabel("Ask about your books")).toBeEnabled({ timeout: 30000 });
}

async function waitForBedrockActive(panel: Locator) {
  const aiOff = await panel.getByText("AI off").isVisible({ timeout: 15000 }).catch(() => false);
  return !aiOff;
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
  await panel.getByLabel("Ask about your books").fill(prompt);
  await panel.getByRole("button", { name: "Send question" }).click();

  await expect(panel.getByTestId("ai-user-message").last()).toContainText("markdown table", { timeout: 15000 });
  // The redesigned renderer feeds the streamed answer through the AI Elements
  // MessageResponse (Streamdown), which renders a markdown table as a real
  // <table> element (no `ai-markdown-table` test hook anymore). Assert on the
  // rendered <table> inside the latest response.
  await expect(
    panel.getByTestId("ai-markdown-response").last().locator("table").first(),
  ).toBeVisible({ timeout: 120000 });
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

test("B5 — full-page Ask AI supports new, rename, search, and delete chat", async ({ page }) => {
  test.setTimeout(120_000);

  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/ask-ai");
  await expect(page.getByTestId("m10-ai-chat-page")).toBeVisible({ timeout: 30000 });
  // The fullscreen surface presents thread management as a left rail
  // (ChatGPT-style), not a composer popover.
  const rail = page.getByTestId("ai-thread-rail");
  await expect(rail).toBeVisible({ timeout: 15000 });

  const stamp = Date.now().toString().slice(-6);
  const prompt = `Thread management smoke ${stamp}`;
  const renamed = `Cash review ${stamp}`;

  await page.getByRole("button", { name: "New Ask AI conversation" }).click();
  await page.getByLabel("Ask about your books").fill(prompt);
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByTestId("ai-user-message").last()).toContainText(prompt, { timeout: 15000 });

  // The new thread appears in the rail; rename it via its per-row options menu.
  const row = rail.getByTestId("ai-thread-list-row").filter({ hasText: prompt }).first();
  await expect(row).toBeVisible({ timeout: 30000 });
  await row.getByRole("button", { name: "Conversation options" }).click();
  await expect(page.getByLabel("Conversation name")).toBeVisible({ timeout: 15000 });
  await page.getByLabel("Conversation name").fill(renamed);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(rail.getByTestId("ai-thread-list-row").filter({ hasText: renamed }).first()).toBeVisible({
    timeout: 15000,
  });

  // Search narrows the rail to the renamed thread.
  await page.getByTestId("ai-thread-search").fill(stamp);
  await expect(rail.getByTestId("ai-thread-list-row").filter({ hasText: renamed }).first()).toBeVisible();

  // Delete via the same per-row menu + confirmation dialog.
  await rail
    .getByTestId("ai-thread-list-row")
    .filter({ hasText: renamed })
    .first()
    .getByRole("button", { name: "Conversation options" })
    .click();
  await page.getByRole("button", { name: "Delete chat" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Delete chat" }).click();
  await expect(rail.getByTestId("ai-thread-list-row").filter({ hasText: renamed })).toHaveCount(0, {
    timeout: 15000,
  });
});

test("B5 — mobile Ask AI opens as bottom sheet, closes, and keeps width stable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/dashboard");
  await expectNoHorizontalScroll(page);

  await page.locator("nav").getByRole("button", { name: "Ask AI" }).click();
  const panel = page.getByTestId("ai-panel-mobile");
  await expect(panel).toBeVisible({ timeout: 15000 });
  await expect(panel.getByText("Chat", { exact: true }).first()).toBeVisible();
  await waitForBooksContext(panel);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-B5-mobile-sheet.png`, fullPage: true });

  await panel.getByRole("button", { name: "Close Ask AI" }).click();
  await expect(panel).toBeHidden({ timeout: 5000 });
  await expectNoHorizontalScroll(page);
});
