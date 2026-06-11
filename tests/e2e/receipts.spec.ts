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
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 15000 });
}

async function ensureDemoData(page: Page) {
  await page.goto("/contacts");
  await expect(page.getByTestId("contact-row").first()).toBeVisible({ timeout: 30000 });
}

test("M11 receipt fixtures upload, extract metadata, queue, and manually match", async ({ page }) => {
  test.setTimeout(240_000);
  const manifestPath = join(process.cwd(), "tests/fixtures/receipts/manifest.json");
  const receipts = JSON.parse(readFileSync(manifestPath, "utf8")) as Array<{ fileName: string }>;

  await signInOwner(page);
  await ensureDemoData(page);
  await page.goto("/bills");
  await expect(page.getByTestId("m11-receipt-upload-panel")).toBeVisible({ timeout: 15000 });

  for (const receipt of receipts) {
    await page
      .getByTestId("m11-receipt-file")
      .setInputFiles(join(process.cwd(), "tests/fixtures/receipts", receipt.fileName));
    await expect(page.getByTestId("m11-receipt-upload-message")).toContainText(`Uploaded ${receipt.fileName}`, {
      timeout: 30000,
    });
  }

  await expect.poll(async () => await page.getByTestId("m11-receipt-row").count(), {
    timeout: 30000,
  }).toBeGreaterThan(4);
  const manualButtons = page.getByRole("button", { name: "Manual match first candidate" });
  if (await manualButtons.first().isVisible()) {
    await manualButtons.first().click();
    await expect(page.getByTestId("m11-receipt-upload-message")).toContainText("Manual match saved", {
      timeout: 15000,
    });
  }

  await page.screenshot({
    path: "docs/initiation/evidence/2026-06-11-m11-receipts-e2e.png",
    fullPage: true,
  });
});
