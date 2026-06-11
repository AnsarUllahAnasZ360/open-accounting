# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-screens.spec.ts >> owner can run the M5 dashboard, inbox, transactions, split, and CSV loop
- Location: tests/e2e/core-screens.spec.ts:44:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('demo-seed-message')
Timeout: 180000ms
- Expected substring  - 1
+ Received string     + 5

- Demo seed complete.
+ [CONVEX A(seedDemo:resetAndSeed)] [Request ID: af800df19c4f9d9e] Server Error
+ Uncaught ConvexError: Demo reset could not finish cleanly. Try reset again after the current sync settles.
+     at handler (../convex/seedDemo.ts:151:35)
+
+   Called by client

Call log:
  - Expect "toContainText" with timeout 180000ms
  - waiting for getByTestId('demo-seed-message')
    337 × locator resolved to <div data-testid="demo-seed-message" class="mx-4 mt-4 rounded-lg border p-3 text-sm border-destructive/30 bg-destructive/5 text-destructive">[CONVEX A(seedDemo:resetAndSeed)] [Request ID: af…</div>
        - unexpected value "[CONVEX A(seedDemo:resetAndSeed)] [Request ID: af800df19c4f9d9e] Server Error
Uncaught ConvexError: Demo reset could not finish cleanly. Try reset again after the current sync settles.
    at handler (../convex/seedDemo.ts:151:35)

  Called by client"

```

```yaml
- text: "[CONVEX A(seedDemo:resetAndSeed)] [Request ID: af800df19c4f9d9e] Server Error Uncaught ConvexError: Demo reset could not finish cleanly. Try reset again after the current sync settles. at handler (../convex/seedDemo.ts:151:35) Called by client"
```

# Test source

```ts
  1   | import { expect, type Page, test } from "@playwright/test";
  2   | import { readFileSync } from "node:fs";
  3   | import { join } from "node:path";
  4   |
  5   | function readLocalEnv(names: string[]) {
  6   |   const env: Record<string, string> = {};
  7   |   const text = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  8   |   for (const line of text.split(/\r?\n/)) {
  9   |     const trimmed = line.trim();
  10  |     if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  11  |     const index = trimmed.indexOf("=");
  12  |     const name = trimmed.slice(0, index).trim();
  13  |     if (!names.includes(name)) continue;
  14  |     env[name] = trimmed
  15  |       .slice(index + 1)
  16  |       .trim()
  17  |       .replace(/\s+#.*$/, "")
  18  |       .replace(/^['"]|['"]$/g, "");
  19  |   }
  20  |   return env;
  21  | }
  22  |
  23  | async function signInOwner(page: Page) {
  24  |   const env = readLocalEnv(["OWNER_EMAIL", "OWNER_PASSWORD"]);
  25  |   test.skip(!env.OWNER_EMAIL || !env.OWNER_PASSWORD, "OWNER_EMAIL/OWNER_PASSWORD missing locally");
  26  |
  27  |   await page.goto("/sign-in");
  28  |   await page.getByLabel("Work email").fill(env.OWNER_EMAIL);
  29  |   await page.getByLabel("Password").fill(env.OWNER_PASSWORD);
  30  |   await page.getByLabel("Name").fill("Ansar Ullah");
  31  |   await page.getByRole("button", { name: /Sign in/ }).click();
  32  |   await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
  33  |     timeout: 15000,
  34  |   });
  35  | }
  36  |
  37  | test.describe.configure({ mode: "serial" });
  38  |
  39  | function runsAgainstExternalBaseUrl() {
  40  |   const baseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
  41  |   return Boolean(baseUrl && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(baseUrl));
  42  | }
  43  |
  44  | test("owner can run the M5 dashboard, inbox, transactions, split, and CSV loop", async ({ page }) => {
  45  |   test.setTimeout(360_000);
  46  |
  47  |   await signInOwner(page);
  48  |   await page.goto("/settings");
  49  |   if (runsAgainstExternalBaseUrl()) {
  50  |     await expect(page.getByTestId("demo-data-panel").getByRole("button", { name: "Export CSV bundle" })).toBeEnabled({
  51  |       timeout: 30_000,
  52  |     });
  53  |   } else {
  54  |     await page.getByRole("button", { name: "Reset demo data" }).click();
> 55  |     await expect(page.getByTestId("demo-seed-message")).toContainText("Demo seed complete.", {
      |                                                         ^ Error: expect(locator).toContainText(expected) failed
  56  |       timeout: 180_000,
  57  |     });
  58  |   }
  59  |
  60  |   await page.goto("/dashboard");
  61  |   await expect(page.getByTestId("dashboard-screen")).toBeVisible();
  62  |   await expect(page.getByText("Cash position")).toBeVisible();
  63  |   await expect(page.getByText("Income by customer")).toBeVisible();
  64  |   await expect(page.getByText("Cash flow by month")).toBeVisible();
  65  |   await page.screenshot({
  66  |     path: "docs/initiation/evidence/2026-06-11-m5-dashboard-e2e.png",
  67  |     fullPage: true,
  68  |   });
  69  |
  70  |   await page.goto("/inbox");
  71  |   const transactionBackedCard = page.locator('[data-testid="inbox-item"][data-has-transaction="true"]').first();
  72  |   await expect(transactionBackedCard).toBeVisible({ timeout: 15000 });
  73  |   await transactionBackedCard.click();
  74  |   await expect(page.getByRole("button", { name: "Always do this" })).toBeEnabled();
  75  |   await page.getByRole("button", { name: "Always do this" }).click();
  76  |   await expect(page.getByTestId("inbox-message")).toContainText("Rule saved", { timeout: 15000 });
  77  |   await page.getByTestId("inbox-confirm").click();
  78  |   await expect(page.getByTestId("inbox-message")).toContainText("confirmed", { timeout: 15000 });
  79  |   await page.screenshot({
  80  |     path: "docs/initiation/evidence/2026-06-11-m5-inbox-e2e.png",
  81  |     fullPage: true,
  82  |   });
  83  |
  84  |   await page.goto("/transactions");
  85  |   await expect(page.getByTestId("transactions-screen")).toBeVisible({ timeout: 30000 });
  86  |   await expect(page.getByText("Reconciliation")).toBeVisible();
  87  |   await expect(page.getByTestId("transaction-row").first()).toBeVisible({ timeout: 15000 });
  88  |   await page.getByTestId("transaction-row").first().click();
  89  |   await expect(page.getByTestId("transaction-drawer")).toContainText("Balanced lines");
  90  |   await expect(page.getByTestId("accounting-line").first()).toBeVisible();
  91  |
  92  |   await page.getByTestId("quick-recategorize").dispatchEvent("click");
  93  |   await expect(page.getByTestId("transaction-message")).toContainText("recategorized", {
  94  |     timeout: 15000,
  95  |   });
  96  |   await expect(page.getByTestId("transaction-drawer")).toContainText("ledger.entry.reversed", {
  97  |     timeout: 15000,
  98  |   });
  99  |
  100 |   await page.getByTestId("split-post").dispatchEvent("click");
  101 |   await expect(page.getByTestId("transaction-message")).toContainText("split", { timeout: 15000 });
  102 |
  103 |   const merchant = `M5 manual ${Date.now()}`;
  104 |   await page.getByTestId("manual-merchant").fill(merchant);
  105 |   await page.getByTestId("manual-amount").fill("-42.00");
  106 |   await page.getByTestId("manual-add").dispatchEvent("click");
  107 |   await expect(page.getByTestId("transaction-message")).toContainText("Manual transaction imported", {
  108 |     timeout: 15000,
  109 |   });
  110 |
  111 |   const csvMerchant = `M5 CSV ${Date.now()}`;
  112 |   await page.getByTestId("csv-text").fill(`date,description,amount\n2026-06-30,${csvMerchant},-25.00`);
  113 |   await page.getByTestId("csv-import").dispatchEvent("click");
  114 |   await expect(page.getByTestId("transaction-message")).toContainText("CSV row", { timeout: 15000 });
  115 |   await expect(page.getByTestId("transaction-row").filter({ hasText: csvMerchant }).first()).toBeVisible({
  116 |     timeout: 15000,
  117 |   });
  118 |   await page.screenshot({
  119 |     path: "docs/initiation/evidence/2026-06-11-m5-transactions-e2e.png",
  120 |     fullPage: true,
  121 |   });
  122 |
  123 |   await page.setViewportSize({ width: 390, height: 1100 });
  124 |   await page.goto("/dashboard");
  125 |   await expect(page.getByTestId("dashboard-screen")).toBeVisible();
  126 |   await page.screenshot({
  127 |     path: "docs/initiation/evidence/2026-06-11-m5-core-mobile-e2e.png",
  128 |     fullPage: true,
  129 |   });
  130 | });
  131 |
```