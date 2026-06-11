import { expect, test } from "@playwright/test";

test("landing shell renders the OpenBooks bootstrap surface", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Your books, always done." })).toBeVisible();
  await expect(page.getByText("Free · open source · self-hosted")).toBeVisible();
  await expect(page.getByText("AI proposes. The ledger engine posts.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Money moves. The ledger posts. You answer a question now and then." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Five minutes, not five hours." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ask your books anything." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Every screen money touches." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The whole business, in your pocket." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nobody else combines all five." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Honest answers" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Work email" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request access" })).toBeVisible();
});

test("app shell routes render first-class empty states", async ({ page }) => {
  const routes = [
    ["/dashboard", "Dashboard"],
    ["/inbox", "Inbox"],
    ["/transactions", "Transactions"],
    ["/invoices", "Invoices"],
    ["/bills", "Bills"],
    ["/contacts", "Contacts"],
    ["/payroll", "Payroll"],
    ["/reports", "Reports"],
    ["/settings", "Settings"],
  ];

  for (const [route, heading] of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Ask AI$/ })).toBeVisible();
  }
});
