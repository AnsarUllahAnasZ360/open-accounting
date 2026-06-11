import { expect, test } from "@playwright/test";

test("landing shell renders the OpenBooks bootstrap surface", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "OpenBooks" })).toBeVisible();
  await expect(page.getByText("Ledger-first bookkeeping")).toBeVisible();
});
