import { expect, test } from "@playwright/test";

const EVIDENCE = "docs/finishing/evidence";

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
  await expect(page.getByText("MIT licensed", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Open source, MIT licensed")).toBeVisible();
  await expect(page.getByText("The software is free and MIT-licensed, forever.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nobody else combines all five." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Honest answers" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Work email" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request access" })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-H2-landing-page.png`, fullPage: true });
});

test("local app route opens owner demo through dev-auth bypass", async ({ page }) => {
  test.skip(
    process.env.NEXT_PUBLIC_OPENBOOKS_DEV_AUTH_BYPASS === "0",
    "This local evidence row proves the dev-auth access path; signed-out auth is covered separately.",
  );

  await page.goto("/dashboard");

  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("OpenBooks Owner")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Ask AI/ })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/2026-06-12-H2-dev-auth-dashboard-access.png`, fullPage: true });
});
