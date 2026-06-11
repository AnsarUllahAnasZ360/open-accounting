import { expect, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readLocalEnv(names: string[]) {
  const env: Record<string, string> = {};
  const text = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const name = trimmed.slice(0, index).trim();
    if (!names.includes(name)) continue;
    env[name] = trimmed
      .slice(index + 1)
      .trim()
      .replace(/\s+#.*$/, "")
      .replace(/^['"]|['"]$/g, "");
  }
  return env;
}

async function signInOwner(page: Page) {
  const env = readLocalEnv(["OWNER_EMAIL", "OWNER_PASSWORD"]);
  test.skip(!env.OWNER_EMAIL || !env.OWNER_PASSWORD, "OWNER_EMAIL/OWNER_PASSWORD missing locally");

  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(env.OWNER_EMAIL);
  await page.getByLabel("Password").fill(env.OWNER_PASSWORD);
  await page.getByLabel("Name").fill("Ansar Ullah");
  await page.getByRole("button", { name: /Sign in/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 15000,
  });
}

test.describe.configure({ mode: "serial" });

test("M10 AI chat answers read questions and keeps actions confirm-first", async ({ page }) => {
  test.setTimeout(300_000);

  await signInOwner(page);

  await page.goto("/settings");
  await expect(page.getByTestId("demo-data-panel")).toBeVisible({ timeout: 15000 });
  const demoExport = page.getByTestId("demo-data-panel").getByRole("button", { name: "Export CSV bundle" });
  await expect(demoExport).toBeVisible();
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await expect(page.getByTestId("demo-seed-message")).toContainText("Demo seed complete.", {
    timeout: 180_000,
  });
  await expect(demoExport).toBeEnabled({ timeout: 30_000 });
  const aiSettings = page.getByTestId("m10-ai-settings");
  await expect(aiSettings).toBeVisible({ timeout: 15000 });
  await expect(aiSettings.getByText(/AI provider is not configured|Bedrock provider is configured/)).toBeVisible();
  await expect(aiSettings.getByText(/Degraded mode|Bedrock active/)).toBeVisible();
  await expect(page.getByRole("radio", { name: /Balanced/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Suggest everything/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Balanced/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Autopilot/ })).toBeVisible();
  await page.getByRole("button", { name: "Test AI connection" }).click();
  await expect(
    aiSettings.getByText(/Bedrock provider is configured|Bedrock env is absent|AI provider is not configured/),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m10-ai-settings.png",
    fullPage: true,
  });

  await page.goto("/reports");
  await expect(page.getByTestId("reports-screen")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled({ timeout: 15000 });
  await page.getByRole("button", { name: "Explain report" }).click();
  const chatDrawer = page.getByTestId("m10-ai-chat-drawer");
  await expect(chatDrawer).toBeVisible();
  await expect(chatDrawer.getByText(/Degraded mode|Bedrock active/)).toBeVisible();
  await expect(chatDrawer.getByText("Explain this report")).toBeVisible();

  await page.getByRole("button", { name: "Top 5 expenses this quarter?" }).click();
  await expect(chatDrawer.getByText("Top expense categories").first()).toBeVisible({ timeout: 15000 });
  await expect(chatDrawer.getByTestId("ai-answer-table").locator("tbody tr").first()).toBeVisible();

  await page.getByPlaceholder("Ask about your books").fill("Create a rule for Uber");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(chatDrawer.getByText("Proposed action").first()).toBeVisible();
  await expect(chatDrawer.getByRole("button", { name: "Confirm rule" })).toBeVisible();
  await expect(chatDrawer.getByText("Nothing has been posted or written yet.")).toBeVisible();
  await chatDrawer.getByRole("button", { name: "Confirm rule" }).click();
  await expect(chatDrawer.getByTestId("ai-proposal-result")).toContainText(/Rule (created|updated); Uber/, {
    timeout: 15000,
  });
  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m10-ai-chat.png",
    fullPage: true,
  });

  await page.goto("/settings");
  await expect(page.getByText("AI confirmed: Uber")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("audit-actor-ai").first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("audit-actor-rule").first()).toBeVisible();
  await expect(page.getByTestId("audit-actor-user").first()).toBeVisible();
  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m13-audit-attribution.png",
    fullPage: true,
  });
});

test("M10 mobile chat drawer answers a ledger-backed question", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });

  await signInOwner(page);
  await page.goto("/reports");
  await expect(page.getByTestId("reports-screen")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled({ timeout: 15000 });
  await page.getByRole("button", { name: "Explain report" }).click();
  const chatDrawer = page.getByTestId("m10-ai-chat-drawer");
  await expect(chatDrawer).toBeVisible();
  await expect(chatDrawer.getByText(/Degraded mode|Bedrock active/)).toBeVisible();
  await expect(chatDrawer.getByText("Explain this report")).toBeVisible({ timeout: 15000 });

  await chatDrawer.getByPlaceholder("Ask about your books").fill("Who owes me money right now?");
  await chatDrawer.getByRole("button", { name: "Send question" }).click();
  await expect(chatDrawer.getByText("Customers who owe you money").first()).toBeVisible({ timeout: 15000 });
  await expect(chatDrawer.getByTestId("ai-answer-table").locator("tbody tr").first()).toBeVisible();

  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m10-ai-chat-mobile.png",
    fullPage: true,
  });
});
