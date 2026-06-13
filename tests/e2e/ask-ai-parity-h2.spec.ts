import { expect, test, type Locator, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { api } from "../../convex/_generated/api";
import {
  expectClickable,
  FINISHING_EVIDENCE,
  gotoApp,
  installDevOverlayGuard,
  visibleByTestId,
} from "./helpers";

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

function formatMoney(amountMinor: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}

async function acmeReportPack(startDate: string, endDate: string) {
  const client = convexClient();
  const businesses = await client.query(api.entities.list, {});
  const acme = businesses.rows.find((row) => row.slug === "acme-studio-llc");
  expect(acme).toBeTruthy();
  return await client.query(api.reportViews.reportPack, {
    entityId: acme!.id,
    startDate,
    endDate,
    basis: "accrual",
    compare: "none",
    columnMode: "monthly",
  });
}

async function openAskAI(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/reports");
  const button = visibleByTestId(page, "ask-ai-button");
  await expectClickable(button);
  await button.click();
  const panel = visibleByTestId(page, "ai-panel");
  await expect(panel).toBeVisible({ timeout: 15000 });
  await expect(panel.getByPlaceholder("Ask about your books")).toBeEnabled({ timeout: 30000 });
  return panel;
}

async function startNewConversation(panel: Locator) {
  const conversation = panel.locator('select[aria-label="Conversation"]');
  await conversation.selectOption("new");
  await expect(conversation).toHaveValue("new", { timeout: 15000 });
  await expect(panel.getByTestId("ai-empty-state")).toBeVisible({ timeout: 30000 });
}

async function ensureBedrockActive(panel: Locator) {
  const active = await panel.getByText("Bedrock active").isVisible({ timeout: 15000 }).catch(() => false);
  test.skip(!active, "Bedrock is not configured; H2 Ask AI parity needs live model answers.");
}

async function askAndAssertLedgerAnswer(
  panel: Locator,
  prompt: string,
  expected: { tool: RegExp; contains: Array<string | RegExp> },
) {
  const beforeResponses = await panel.getByTestId("ai-markdown-response").count();
  const beforeTools = await panel.getByTestId("ai-tool-card").count();

  await panel.getByPlaceholder("Ask about your books").fill(prompt);
  await panel.getByRole("button", { name: "Send question" }).click();
  await expect(panel.getByTestId("ai-user-message").last()).toContainText(prompt.slice(0, 80), {
    timeout: 15000,
  });

  await expect
    .poll(async () => panel.getByTestId("ai-tool-card").count(), { timeout: 120000 })
    .toBeGreaterThan(beforeTools);
  await expect
    .poll(
      async () => {
        const tools = panel.getByTestId("ai-tool-card");
        const count = await tools.count();
        for (let index = beforeTools; index < count; index += 1) {
          const text = await tools.nth(index).innerText();
          if (expected.tool.test(text)) return true;
        }
        return false;
      },
      { timeout: 30000 },
    )
    .toBe(true);

  await expect
    .poll(async () => panel.getByTestId("ai-markdown-response").count(), { timeout: 120000 })
    .toBeGreaterThan(beforeResponses);
  const response = panel.getByTestId("ai-markdown-response").last();
  for (const text of expected.contains) {
    await expect(response).toContainText(text, { timeout: 120000 });
  }
}

test.beforeEach(async ({ page }) => {
  await installDevOverlayGuard(page);
});

test("H2 — Ask AI flagship answers use report tools and match ledger values", async ({ page }) => {
  test.setTimeout(720_000);

  const year = await acmeReportPack("2026-01-01", "2026-12-31");
  const quarter = await acmeReportPack("2026-04-01", "2026-06-30");
  const january = await acmeReportPack("2026-01-01", "2026-01-31");
  const december = await acmeReportPack("2025-12-01", "2025-12-31");
  const topQuarterExpense = quarter.expenses.byCategory
    .slice()
    .sort((left, right) => right.totalMinor - left.totalMinor)[0];
  const topReceivable = year.arAging.rows[0];
  const stripeFees = year.profitAndLoss.rows.find((row) => row.accountNumber === "5600");
  const firstPayrollRun = year.payrollSummary.rows[0];
  expect(topQuarterExpense).toBeTruthy();
  expect(topReceivable).toBeTruthy();
  expect(stripeFees).toBeTruthy();
  expect(firstPayrollRun).toBeTruthy();

  const panel = await openAskAI(page);
  await ensureBedrockActive(panel);
  await startNewConversation(panel);

  await askAndAssertLedgerAnswer(panel, "Use separate fresh OpenBooks getReport tool calls for 2025-12-01 through 2025-12-31 and 2026-01-01 through 2026-01-31. Compare January 2026 against December 2025 and include money in, money out, and net result.", {
    tool: /Get report/i,
    contains: [
      formatMoney(january.monthlyReview.moneyInMinor),
      formatMoney(january.monthlyReview.moneyOutMinor),
      formatMoney(january.monthlyReview.netResultMinor),
      formatMoney(december.monthlyReview.moneyInMinor),
      formatMoney(december.monthlyReview.moneyOutMinor),
      formatMoney(december.monthlyReview.netResultMinor),
    ],
  });

  await startNewConversation(panel);
  await askAndAssertLedgerAnswer(panel, "Use a fresh OpenBooks report tool call. Top 5 expenses this quarter? Use 2026-04-01 through 2026-06-30 and include exact category amounts.", {
    tool: /Get report/i,
    contains: [
      topQuarterExpense.label,
      formatMoney(topQuarterExpense.totalMinor),
    ],
  });

  await startNewConversation(panel);
  await askAndAssertLedgerAnswer(panel, "Use a fresh OpenBooks report tool call. Who owes me money right now? Use AR aging as of 2026-12-31 and include the top customer plus the total owed.", {
    tool: /Get report|Search contacts/i,
    contains: [
      topReceivable!.name,
      formatMoney(topReceivable!.totalMinor),
      formatMoney(year.arAging.totalMinor),
    ],
  });

  await startNewConversation(panel);
  await askAndAssertLedgerAnswer(panel, "Use a fresh OpenBooks report or transaction tool call. How much did Stripe take in fees this year? Use 2026 report data and include the exact payment-processing-fee amount.", {
    tool: /Get report|Query transactions/i,
    contains: [
      /Payment Processing Fees|Stripe Fees/i,
      formatMoney(stripeFees!.totalMinor),
    ],
  });

  await startNewConversation(panel);
  await askAndAssertLedgerAnswer(panel, "Use a fresh OpenBooks payroll or report tool call. What's my monthly payroll cost in USD? Use 2026 payroll summary and include the monthly amount.", {
    tool: /Get report|Get payroll runs/i,
    contains: [
      formatMoney(firstPayrollRun!.totalBaseMinor),
    ],
  });

  await page.screenshot({
    path: `${FINISHING_EVIDENCE}/2026-06-12-H2-ask-ai-five-question-parity.png`,
    fullPage: true,
  });
});
