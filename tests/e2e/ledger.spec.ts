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

test("manual journal entry appears in GL and locked periods reject backdating", async ({ page }) => {
  const memo = `M3 manual JE ${Date.now()}`;
  const entryDate = "2026-06-30";

  await signInOwner(page);
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Initialize chart" })).toBeVisible({
    timeout: 15000,
  });

  await page.getByRole("button", { name: "Initialize chart" }).click();
  await expect(page.getByText(/Chart ready/)).toBeVisible({ timeout: 15000 });

  const manualEntryForm = page.locator("form").filter({ hasText: "Manual journal entry" });
  await manualEntryForm.getByLabel("Date").fill(entryDate);
  await manualEntryForm.getByLabel("Amount").fill("123.45");
  await manualEntryForm.getByLabel("Memo").fill(memo);
  await manualEntryForm.getByRole("button", { name: "Post entry" }).click();
  await expect(page.getByText("Manual journal entry posted.")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(memo)).toBeVisible();
  await expect(page.getByText("$123.45").first()).toBeVisible();

  const trialBalance = page.getByRole("heading", { name: "Trial Balance" }).locator("..");
  await expect(trialBalance).toContainText("Difference:");
  await expect(trialBalance).toContainText("$0.00");

  const periodLockForm = page.locator("form").filter({ hasText: "Period lock" });
  await periodLockForm.getByLabel("Locked through").fill("2026-03-31");
  await periodLockForm.getByRole("button", { name: "Update lock" }).click();
  await expect(page.getByText("Period locked through 2026-03-31.")).toBeVisible({
    timeout: 15000,
  });

  await manualEntryForm.getByLabel("Date").fill("2026-03-15");
  await manualEntryForm.getByLabel("Amount").fill("1.00");
  await manualEntryForm.getByLabel("Memo").fill(`Backdated ${memo}`);
  await manualEntryForm.getByRole("button", { name: "Post entry" }).click();
  await expect(page.getByRole("main").getByText("Period is locked through 2026-03-31.")).toBeVisible({
    timeout: 15000,
  });
});
