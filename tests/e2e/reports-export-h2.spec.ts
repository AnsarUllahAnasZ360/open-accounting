import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import {
  expectClickable,
  FINISHING_EVIDENCE,
  gotoApp,
  installDevOverlayGuard,
  visibleByTestId,
} from "./helpers";

type CsvRow = string[];

function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function formatMoney(amountMinor: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}

test.beforeEach(async ({ page }) => {
  await installDevOverlayGuard(page);
});

test("H2 — Profit & Loss CSV export matches the visible report totals", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/reports");

  await expect(visibleByTestId(page, "reports-home")).toBeVisible({ timeout: 30000 });
  await expectClickable(visibleByTestId(page, "report-card-profit-and-loss"));
  await visibleByTestId(page, "report-card-profit-and-loss").click();
  await expect(visibleByTestId(page, "viewer-toolbar")).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("heading", { name: "Profit & Loss" })).toBeVisible();

  const exportButton = visibleByTestId(page, "export-csv");
  await expect(exportButton).toBeEnabled({ timeout: 30000 });
  const downloadPromise = page.waitForEvent("download");
  await expectClickable(exportButton);
  await exportButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/profit-and-loss.*\.csv$/);
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  const csvText = readFileSync(downloadedPath!, "utf8");
  await download.delete();

  const rows = parseCsv(csvText);
  expect(rows[0]?.[0]).toBe("Profit and Loss");
  expect(rows.find((row) => row[0] === "entity")?.[1]).toBe("Acme Studio LLC");
  expect(rows.find((row) => row[0] === "currency")?.[1]).toBe("USD");
  expect(rows.find((row) => row[0] === "basis")?.[1]).toBe("accrual");

  const headerIndex = rows.findIndex((row) => row[0] === "account_number");
  expect(headerIndex).toBeGreaterThan(0);
  const dataRows = rows.slice(headerIndex + 1).filter((row) => row.length >= 6 && row[1]);
  const incomeRows = dataRows.filter((row) => row[2] === "income");
  const expenseRows = dataRows.filter((row) => row[2] === "expense");
  expect(incomeRows.length).toBeGreaterThan(0);
  expect(expenseRows.length).toBeGreaterThan(0);

  const sampleIncome = incomeRows.find((row) => Number(row[4]) !== 0) ?? incomeRows[0];
  const sampleExpense = expenseRows.find((row) => Number(row[4]) !== 0) ?? expenseRows[0];
  await expect(page.getByText(sampleIncome[1], { exact: true })).toBeVisible();
  await expect(page.getByText(sampleExpense[1], { exact: true })).toBeVisible();

  const incomeMinor = incomeRows.reduce((sum, row) => sum + Number(row[4] || 0), 0);
  const expenseMinor = expenseRows.reduce((sum, row) => sum + Number(row[4] || 0), 0);
  const netMinor = incomeMinor - expenseMinor;
  const netText = `${netMinor > 0 ? "+" : ""}${formatMoney(netMinor)}`;
  const netBand = page.locator("div").filter({ has: page.getByText("Net profit", { exact: true }) }).filter({ hasText: netText }).first();
  await expect(netBand).toBeVisible();

  await page.screenshot({
    path: `${FINISHING_EVIDENCE}/2026-06-12-H2-report-export-equality.png`,
    fullPage: true,
  });
});
