# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ai-chat.spec.ts >> M10 AI chat answers read questions and keeps actions confirm-first
- Location: tests/e2e/ai-chat.spec.ts:39:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('m10-ai-chat-drawer').getByTestId('ai-proposal-result')
Timeout: 15000ms
Expected pattern: /Rule (created|updated); Uber/
Received string:  "[CONVEX M(ai:createConfirmedRule)] [Request ID: d199df1550fa06e2] Server Error
Uncaught ConvexError: OpenBooks entity not found.
    at requireEntityAccess (../../convex/ai.ts:78:2)
    at async handler (../../convex/ai.ts:257:17)·
  Called by client"

Call log:
  - Expect "toContainText" with timeout 15000ms
  - waiting for getByTestId('m10-ai-chat-drawer').getByTestId('ai-proposal-result')
    3 × locator resolved to <div data-testid="ai-proposal-result" class="mt-3 rounded-lg border p-2 text-xs border-primary/30 text-primary">Creating the rule after your confirmation...</div>
      - unexpected value "Creating the rule after your confirmation..."
    31 × locator resolved to <div data-testid="ai-proposal-result" class="mt-3 rounded-lg border p-2 text-xs border-destructive/30 text-destructive">[CONVEX M(ai:createConfirmedRule)] [Request ID: d…</div>
       - unexpected value "[CONVEX M(ai:createConfirmedRule)] [Request ID: d199df1550fa06e2] Server Error
Uncaught ConvexError: OpenBooks entity not found.
    at requireEntityAccess (../../convex/ai.ts:78:2)
    at async handler (../../convex/ai.ts:257:17)

  Called by client"

```

```yaml
- text: "[CONVEX M(ai:createConfirmedRule)] [Request ID: d199df1550fa06e2] Server Error Uncaught ConvexError: OpenBooks entity not found. at requireEntityAccess (../../convex/ai.ts:78:2) at async handler (../../convex/ai.ts:257:17) Called by client"
```

# Test source

```ts
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
  39  | test("M10 AI chat answers read questions and keeps actions confirm-first", async ({ page }) => {
  40  |   test.setTimeout(180_000);
  41  |
  42  |   await signInOwner(page);
  43  |
  44  |   await page.goto("/settings");
  45  |   await expect(page.getByTestId("demo-data-panel")).toBeVisible({ timeout: 15000 });
  46  |   const demoExport = page.getByTestId("demo-data-panel").getByRole("button", { name: "Export CSV bundle" });
  47  |   await expect(demoExport).toBeVisible();
  48  |   let seedState = "loading";
  49  |   await expect
  50  |     .poll(
  51  |       async () => {
  52  |         seedState = await demoExport.isEnabled()
  53  |           ? "ready"
  54  |           : await page.getByText("Demo books have not been seeded in this workspace yet.").isVisible()
  55  |             ? "missing"
  56  |             : "loading";
  57  |         return seedState;
  58  |       },
  59  |       { timeout: 30000 },
  60  |     )
  61  |     .not.toBe("loading");
  62  |   if (seedState === "missing") {
  63  |     await page.getByRole("button", { name: "Reset demo data" }).click();
  64  |     await expect(demoExport).toBeEnabled({ timeout: 120000 });
  65  |   }
  66  |   const aiSettings = page.getByTestId("m10-ai-settings");
  67  |   await expect(aiSettings).toBeVisible({ timeout: 15000 });
  68  |   await expect(aiSettings.getByText(/AI provider is not configured|Bedrock provider is configured/)).toBeVisible();
  69  |   await expect(aiSettings.getByText(/Degraded mode|Bedrock active/)).toBeVisible();
  70  |   await expect(page.getByRole("radio", { name: /Balanced/ })).toBeChecked();
  71  |   await expect(page.getByRole("radio", { name: /Suggest everything/ })).toBeVisible();
  72  |   await expect(page.getByRole("radio", { name: /Balanced/ })).toBeVisible();
  73  |   await expect(page.getByRole("radio", { name: /Autopilot/ })).toBeVisible();
  74  |   await page.getByRole("button", { name: "Test AI connection" }).click();
  75  |   await expect(
  76  |     aiSettings.getByText(/Bedrock provider is configured|Bedrock env is absent|AI provider is not configured/),
  77  |   ).toBeVisible();
  78  |   await page.screenshot({
  79  |     path: "docs/initiation/evidence/2026-06-11-m10-ai-settings.png",
  80  |     fullPage: true,
  81  |   });
  82  |
  83  |   await page.goto("/reports");
  84  |   await expect(page.getByTestId("reports-screen")).toBeVisible({ timeout: 15000 });
  85  |   await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled({ timeout: 15000 });
  86  |   await page.getByRole("button", { name: "Explain report" }).click();
  87  |   const chatDrawer = page.getByTestId("m10-ai-chat-drawer");
  88  |   await expect(chatDrawer).toBeVisible();
  89  |   await expect(chatDrawer.getByText(/Degraded mode|Bedrock active/)).toBeVisible();
  90  |   await expect(chatDrawer.getByText("Explain this report")).toBeVisible();
  91  |
  92  |   await page.getByRole("button", { name: "Top 5 expenses this quarter?" }).click();
  93  |   await expect(chatDrawer.getByText("Top expense categories").first()).toBeVisible({ timeout: 15000 });
  94  |   await expect(chatDrawer.getByTestId("ai-answer-table").locator("tbody tr").first()).toBeVisible();
  95  |
  96  |   await page.getByPlaceholder("Ask about your books").fill("Create a rule for Uber");
  97  |   await page.getByRole("button", { name: "Send question" }).click();
  98  |   await expect(chatDrawer.getByText("Proposed action").first()).toBeVisible();
  99  |   await expect(chatDrawer.getByRole("button", { name: "Confirm rule" })).toBeVisible();
  100 |   await expect(chatDrawer.getByText("Nothing has been posted or written yet.")).toBeVisible();
  101 |   await chatDrawer.getByRole("button", { name: "Confirm rule" }).click();
> 102 |   await expect(chatDrawer.getByTestId("ai-proposal-result")).toContainText(/Rule (created|updated); Uber/, {
      |                                                              ^ Error: expect(locator).toContainText(expected) failed
  103 |     timeout: 15000,
  104 |   });
  105 |   await page.screenshot({
  106 |     path: "docs/initiation/evidence/2026-06-11-m10-ai-chat.png",
  107 |     fullPage: true,
  108 |   });
  109 |
  110 |   await page.goto("/settings");
  111 |   await expect(page.getByText("AI confirmed: Uber")).toBeVisible({ timeout: 15000 });
  112 | });
  113 |
```