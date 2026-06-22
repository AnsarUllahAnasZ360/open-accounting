import { describe, expect, it } from "vitest";

import {
  reportCsv,
  type ReportExportId,
  type ReportPack,
} from "../reports-export";

// E6-T3: CSV export ⇄ on-screen parity harness.
//
// The accountant-facing CSV must reconcile to exactly what the owner saw on
// screen. This builds ONE deterministic ReportPack, then for EACH of the 12
// reports it (a) generates the CSV via the real `reportCsv` serializer, (b)
// parses it back into rows, and (c) asserts that every on-screen section total,
// row total, and line item the report body renders is present in the CSV.
//
// The "on-screen totals" lists below mirror what each report body in
// ReportsScreen.tsx actually renders, so a divergence (e.g. cash-flow dropping
// per-row line items, or balance-sheet exporting flat rows not sections) fails.

// ---- A tiny CSV parser (handles quoted cells + escaped quotes) -------------

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\r") {
      // skip
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// Flatten parsed rows into a single set of cell strings for membership checks.
function cellSet(text: string): Set<string> {
  const set = new Set<string>();
  for (const row of parseCsv(text)) {
    for (const cell of row) set.add(cell.trim());
  }
  return set;
}

// Minor-unit integers are always emitted by `moneyCells`, so checking the raw
// integer string is the most precise parity assertion (decimals can collide
// across signs / rounding). Every on-screen number maps to a minor-unit cell.
function hasMinor(cells: Set<string>, minor: number) {
  return cells.has(String(minor));
}

// ---- Deterministic fixture -------------------------------------------------

function line(id: string, date: string, memo: string, amountMinor: number, accountNumber: string, accountName: string) {
  return {
    id,
    date,
    memo,
    source: "manual",
    accountName,
    accountNumber,
    debitMinor: amountMinor >= 0 ? amountMinor : 0,
    creditMinor: amountMinor < 0 ? -amountMinor : 0,
    amountMinor,
    currency: "USD",
  };
}

function statementRow(
  id: string,
  label: string,
  accountNumber: string,
  accountType: string,
  totalMinor: number,
  drillDown: ReturnType<typeof line>[] = [],
) {
  return { id, label, accountNumber, accountType, totalMinor, drillDown };
}

function buildPack(): ReportPack {
  const incomeRows = [
    statementRow("inc-1", "Consulting income", "4000", "income", 500000, [
      line("l1", "2026-05-04", "Acme retainer", 300000, "4000", "Consulting income"),
      line("l2", "2026-05-18", "Beta project", 200000, "4000", "Consulting income"),
    ]),
    statementRow("inc-2", "Product sales", "4100", "income", 150000, [
      line("l3", "2026-05-09", "Subscription", 150000, "4100", "Product sales"),
    ]),
  ];
  const expenseRows = [
    statementRow("exp-1", "Software", "6000", "expense", 80000, [
      line("l4", "2026-05-02", "SaaS tools", 80000, "6000", "Software"),
    ]),
    statementRow("exp-2", "Contractors", "6100", "expense", 120000, [
      line("l5", "2026-05-22", "Design work", 120000, "6100", "Contractors"),
    ]),
  ];
  const incomeMinor = 650000;
  const expenseMinor = 200000;
  const netIncomeMinor = incomeMinor - expenseMinor;

  const assetRows = [statementRow("a-1", "Cash", "1000", "asset", 900000)];
  const liabilityRows = [statementRow("li-1", "Accounts payable", "2000", "liability", 120000)];
  const equityRows = [statementRow("eq-1", "Owner equity", "3000", "equity", 330000)];

  const cashFlowGroups = [
    {
      key: "operating",
      label: "Operating",
      totalMinor: 450000,
      rows: [
        line("cf1", "2026-05-04", "Acme retainer received", 300000, "1000", "Cash"),
        line("cf2", "2026-05-22", "Paid design contractor", -120000, "1000", "Cash"),
        line("cf3", "2026-05-09", "Subscription received", 270000, "1000", "Cash"),
      ],
    },
    {
      key: "investing",
      label: "Investing",
      totalMinor: 0,
      rows: [],
    },
  ];

  return {
    entity: { id: "ent-1", name: "Zikra LLC", currency: "USD" },
    controls: {
      startDate: "2026-05-01",
      endDate: "2026-05-31",
      basis: "cash",
      compare: "none",
      columnMode: "total",
      comparison: null,
    },
    monthlyReview: {
      month: "2026-05",
      moneyInMinor: incomeMinor,
      moneyOutMinor: expenseMinor,
      netResultMinor: netIncomeMinor,
      owedToYouMinor: 250000,
      youOweMinor: 120000,
      payrollMinor: 90000,
      topCustomers: [
        { name: "Acme", totalMinor: 300000 },
        { name: "Beta", totalMinor: 200000 },
      ],
      topExpenseCategories: expenseRows,
    },
    profitAndLoss: {
      incomeMinor,
      expenseMinor,
      netIncomeMinor,
      rows: [...incomeRows, ...expenseRows],
      sections: [
        { key: "income", label: "Income", totalMinor: incomeMinor, rows: incomeRows },
        { key: "expense", label: "Expenses", totalMinor: expenseMinor, rows: expenseRows },
      ],
    },
    balanceSheet: {
      asOfDate: "2026-05-31",
      assetMinor: 900000,
      liabilityMinor: 120000,
      equityMinor: 330000,
      currentEarningsMinor: 450000,
      differenceMinor: 0,
      balanced: true,
      rows: [...assetRows, ...liabilityRows, ...equityRows],
      sections: [
        { key: "assets", label: "Assets", totalMinor: 900000, rows: assetRows },
        { key: "liabilities", label: "Liabilities", totalMinor: 120000, rows: liabilityRows },
        { key: "equity", label: "Equity", totalMinor: 330000, rows: equityRows },
      ],
    },
    cashFlow: {
      openingCashMinor: 100000,
      closingCashMinor: 550000,
      netCashChangeMinor: 450000,
      groups: cashFlowGroups,
    },
    arAging: {
      totalMinor: 250000,
      buckets: { currentMinor: 150000, days30Minor: 60000, days60Minor: 25000, days90Minor: 15000 },
      rows: [
        { id: "ar-1", name: "Acme", currentMinor: 150000, days30Minor: 60000, days60Minor: 25000, days90Minor: 15000, totalMinor: 250000 },
      ],
    },
    apAging: {
      totalMinor: 120000,
      buckets: { currentMinor: 80000, days30Minor: 40000, days60Minor: 0, days90Minor: 0 },
      rows: [
        { id: "ap-1", name: "Hosting Inc", currentMinor: 80000, days30Minor: 40000, days60Minor: 0, days90Minor: 0, totalMinor: 120000 },
      ],
    },
    expenses: {
      byCategory: expenseRows,
      byVendor: [
        { id: "v-1", name: "DesignCo", totalMinor: 120000 },
        { id: "v-2", name: "SaaS Vendor", totalMinor: 80000 },
      ],
    },
    incomeByCustomer: {
      rows: [
        { id: "c-1", name: "Acme", totalMinor: 300000 },
        { id: "c-2", name: "Beta", totalMinor: 200000 },
        { id: "c-3", name: "Subscriptions", totalMinor: 150000 },
      ],
      totalMinor: 650000,
    },
    payrollSummary: {
      totalMinor: 90000,
      baseCurrency: "USD",
      headcount: 2,
      hasFx: false,
      byCurrency: [{ currency: "USD", localMinor: 90000, baseMinor: 90000 }],
      rows: [{ id: "pr-1", period: "2026-05", status: "paid", totalBaseMinor: 90000 }],
    },
    generalLedger: {
      rows: [
        line("gl1", "2026-05-04", "Acme retainer", 300000, "4000", "Consulting income"),
        line("gl2", "2026-05-22", "Design work", 120000, "6100", "Contractors"),
      ],
    },
    trialBalance: {
      rows: [
        { id: "tb-1", accountNumber: "1000", label: "Cash", accountType: "asset", debitMinor: 900000, creditMinor: 0 },
        { id: "tb-2", accountNumber: "2000", label: "Accounts payable", accountType: "liability", debitMinor: 0, creditMinor: 120000 },
      ],
      totalDebitMinor: 900000,
      totalCreditMinor: 120000,
      differenceMinor: 780000,
    },
    journal: {
      entries: [
        {
          id: "je-1",
          date: "2026-05-04",
          memo: "Acme retainer",
          source: "manual",
          lines: [
            { id: "jl-1", accountName: "Cash", accountNumber: "1000", debitMinor: 300000, creditMinor: 0, currency: "USD" },
            { id: "jl-2", accountName: "Consulting income", accountNumber: "4000", debitMinor: 0, creditMinor: 300000, currency: "USD" },
          ],
        },
      ],
    },
    limits: { reportLimit: 5000, truncated: false },
    unreviewed: { unreviewedCount: 0, unreviewedAbsMinor: 0 },
    cashBasisExcluded: { count: 2, amountMinor: 370000 },
  };
}

const ALL_REPORT_IDS: ReportExportId[] = [
  "monthly-review",
  "profit-and-loss",
  "balance-sheet",
  "cash-flow",
  "ar-aging",
  "ap-aging",
  "expenses",
  "income-by-customer",
  "payroll-summary",
  "general-ledger",
  "trial-balance",
  "journal",
];

describe("reports-export CSV ⇄ screen parity", () => {
  const pack = buildPack();

  it("emits a non-empty CSV for all 12 reports", () => {
    for (const id of ALL_REPORT_IDS) {
      const text = reportCsv(id, pack);
      expect(text, `${id} CSV`).toBeTruthy();
      expect(text.length, `${id} CSV length`).toBeGreaterThan(0);
    }
  });

  // The on-screen numbers each report body renders, as minor-unit integers.
  // Every one of these MUST appear in the report's CSV for parity to hold.
  const expectedMinors: Record<ReportExportId, number[]> = {
    "monthly-review": [650000, 200000, 450000, 250000, 120000, 90000, 300000, 200000, 80000, 120000],
    "profit-and-loss": [500000, 150000, 80000, 120000], // section row totals
    "balance-sheet": [900000, 120000, 330000, 450000], // section totals + earnings
    "cash-flow": [450000, 300000, -120000, 270000, 100000, 550000], // group total + per-row line items + opening/closing
    "ar-aging": [150000, 60000, 25000, 15000, 250000],
    "ap-aging": [80000, 40000, 120000],
    expenses: [80000, 120000], // byCategory totals (byVendor same values)
    "income-by-customer": [300000, 200000, 150000, 650000],
    "payroll-summary": [90000],
    "general-ledger": [300000, 120000],
    "trial-balance": [900000, 120000],
    journal: [300000],
  };

  for (const id of ALL_REPORT_IDS) {
    it(`every on-screen number appears in the ${id} CSV`, () => {
      const cells = cellSet(reportCsv(id, pack));
      for (const minor of expectedMinors[id]) {
        expect(hasMinor(cells, minor), `${id} CSV should contain minor=${minor}`).toBe(true);
      }
    });
  }

  it("cash-flow CSV contains per-row line items, not just group totals", () => {
    const cells = cellSet(reportCsv("cash-flow", pack));
    // Each operating line memo + its signed minor amount must be present.
    expect(cells.has("Acme retainer received")).toBe(true);
    expect(cells.has("Paid design contractor")).toBe(true);
    expect(cells.has("Subscription received")).toBe(true);
    expect(hasMinor(cells, 300000)).toBe(true);
    expect(hasMinor(cells, -120000)).toBe(true);
  });

  it("balance-sheet CSV serializes sections (assets/liabilities/equity) with rows", () => {
    const cells = cellSet(reportCsv("balance-sheet", pack));
    expect(cells.has("Assets")).toBe(true);
    expect(cells.has("Liabilities")).toBe(true);
    expect(cells.has("Equity")).toBe(true);
    // section account rows
    expect(cells.has("Cash")).toBe(true);
    expect(cells.has("Accounts payable")).toBe(true);
    expect(cells.has("Owner equity")).toBe(true);
    // liabilities + equity + earnings total the screen shows
    expect(hasMinor(cells, 120000 + 330000 + 450000)).toBe(true);
  });

  it("income-by-customer CSV carries the % share column the screen computes", () => {
    const text = reportCsv("income-by-customer", pack);
    const header = parseCsv(text).find((row) => row.includes("share_pct"));
    expect(header, "share_pct column header present").toBeTruthy();
    const cells = cellSet(text);
    // Acme = 300000 / 650000 = 46%
    expect(cells.has("46")).toBe(true);
  });

  it("the active basis appears in every applicable report's CSV header", () => {
    for (const id of ["profit-and-loss", "balance-sheet", "cash-flow", "expenses", "income-by-customer"] as ReportExportId[]) {
      const cells = cellSet(reportCsv(id, pack));
      expect(cells.has("cash"), `${id} CSV basis cell`).toBe(true);
    }
  });

  // E6-T6: when a comparison is active, the statement CSV gains prior_total +
  // delta columns that reconcile to the on-screen Prior/Change columns.
  it("statement CSV emits prior + delta columns when compare is active", () => {
    const comparePack: ReportPack = {
      ...pack,
      controls: {
        ...pack.controls,
        compare: "priorPeriod",
        comparison: { startDate: "2026-04-01", endDate: "2026-04-30" },
      },
      profitAndLoss: {
        ...pack.profitAndLoss,
        rows: pack.profitAndLoss.rows.map((row) => ({
          ...row,
          priorTotalMinor: Math.round(row.totalMinor / 2),
          deltaMinor: row.totalMinor - Math.round(row.totalMinor / 2),
        })),
      },
    };
    const text = reportCsv("profit-and-loss", comparePack);
    const header = parseCsv(text).find((row) => row.includes("prior_total_minor"));
    expect(header, "prior_total_minor column header present").toBeTruthy();
    expect(header).toContain("delta_minor");
    const cells = cellSet(text);
    // First income row: total 500000, prior 250000, delta 250000.
    expect(hasMinor(cells, 250000)).toBe(true);
    // The comparison window appears in the header.
    expect(cells.has("2026-04-01")).toBe(true);
  });
});
