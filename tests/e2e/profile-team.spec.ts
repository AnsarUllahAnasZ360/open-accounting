import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 30000 });
}

function visibleByTestId(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true }).first();
}

async function openStaffInvite(browser: Browser, baseURL: string | undefined, inviteUrl: string) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const strip = () =>
      document
        .querySelectorAll("nextjs-portal, [data-nextjs-dev-overlay]")
        .forEach((node) => node.remove());
    strip();
    new MutationObserver(strip).observe(document.documentElement, { childList: true, subtree: true });
  });
  const invitePath = new URL(inviteUrl).pathname;
  await page.goto(invitePath);
  return { context, page };
}

test("F2 — profile edit updates the sidebar without reload", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInOwner(page);

  await page.getByTestId("profile-trigger").click();
  await page.getByTestId("profile-view").click();
  await expect(page.getByTestId("profile-screen")).toBeVisible({ timeout: 30000 });

  const input = page.getByTestId("profile-display-name");
  const originalName = await input.inputValue();
  const editedName = `Ansar F2 ${Date.now().toString().slice(-5)}`;

  await input.fill(editedName);
  await page.getByTestId("profile-save").click();
  await expect(page.getByTestId("profile-saved")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("profile-trigger")).toContainText(editedName, { timeout: 15000 });
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-F2-profile-sidebar-update.png`, fullPage: true });

  await input.fill(originalName);
  await page.getByTestId("profile-save").click();
  await expect(page.getByTestId("profile-saved")).toBeVisible({ timeout: 15000 });
});

test("F3 — owner invite link creates Staff account with no Settings entry points", async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInOwner(page);

  const email = `staff-f3-${Date.now()}@example.com`;
  const password = `OpenBooks-${Date.now()}!`;

  await page.goto("/settings/team");
  await expect(visibleByTestId(page, "team-section")).toBeVisible({ timeout: 30000 });
  await visibleByTestId(page, "team-invite").click();
  await expect(visibleByTestId(page, "team-invite-modal")).toBeVisible();
  await visibleByTestId(page, "team-invite-email").fill(email);
  await visibleByTestId(page, "team-invite-submit").click();
  await expect(visibleByTestId(page, "team-invite-result")).toContainText("Invite created", { timeout: 15000 });
  const inviteUrl = await visibleByTestId(page, "team-invite-link").inputValue();
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-F3-invite-link.png`, fullPage: true });

  const { context, page: staffPage } = await openStaffInvite(browser, baseURL, inviteUrl);
  try {
    await expect(staffPage.getByRole("heading", { name: /Join / })).toBeVisible({ timeout: 30000 });
    await expect(staffPage.getByLabel("Work email")).toHaveValue(email);
    await staffPage.getByLabel("Password").fill(password);
    await staffPage.getByLabel("Name").fill("F3 Staff User");
    await staffPage.getByRole("button", { name: /Create invited account/ }).click();
    await expect(staffPage.getByTestId("app-sidebar")).toBeVisible({ timeout: 30000 });
    await expect(staffPage.getByTestId("profile-trigger")).toContainText("Staff", { timeout: 30000 });
    await expect(staffPage.getByRole("link", { name: "Settings" })).toHaveCount(0);
    await expect(staffPage.getByTestId("entity-add-business")).toHaveCount(0);

    await staffPage.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(staffPage.getByTestId("command-palette-list")).toBeVisible();
    await expect(staffPage.getByTestId("command-palette-list").getByText("Settings")).toHaveCount(0);
    await staffPage.keyboard.press("Escape");

    await staffPage.goto("/settings");
    await expect(staffPage.getByTestId("settings-access-denied")).toBeVisible({ timeout: 30000 });
    await staffPage.screenshot({ path: `${EVIDENCE}/2026-06-12-F3-staff-no-settings.png`, fullPage: true });
  } finally {
    await context.close();
  }
});
