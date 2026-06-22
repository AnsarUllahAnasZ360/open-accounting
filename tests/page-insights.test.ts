import { describe, expect, it } from "vitest";

import {
  buildPageInsight,
  compactMoney,
  pageInsightBuilders,
  type BillsOverviewModel,
  type ContactsOverviewModel,
  type DashboardModel,
  type ExpensesOverviewModel,
  type IncomeOverviewModel,
  type PageId,
  type PayrollOverviewModel,
  type TransactionsInsightsModel,
} from "../apps/web/src/components/openbooks/workbench/page-insights";

/* Sample read-models — shaped like the real server returns, with figures that
 * make each page's MOST-relevant branch fire, so every page yields a distinct
 * line. Money is integer minor units throughout. */

const transactions: TransactionsInsightsModel = {
  insights: {
    uncategorizedCount: 4,
    netChangeMinor: 1_234_56,
    counterparties: [
      { label: "Stripe payout", amountMinor: 800_00 },
      { label: "AWS", amountMinor: -120_00 },
    ],
  },
};

const income: IncomeOverviewModel = {
  entity: { currency: "USD" },
  kpis: {
    receivedThisMonthMinor: 5_000_00,
    overdueMinor: 1_500_00,
    overdueInvoiceCount: 2,
    recurringMrrMinor: 3_000_00,
  },
  customers: [
    { name: "Acme Co", receivedMinor: 4_000_00 },
    { name: "Globex", receivedMinor: 1_000_00 },
  ],
};

const expenses: ExpensesOverviewModel = {
  entity: { currency: "USD" },
  kpis: {
    spentMinor: 8_000_00,
    recurringMonthlyMinor: 2_000_00,
    biggestMoverName: "Software",
    biggestMoverDeltaPct: 42,
    topVendorName: "Figma",
    topVendorMinor: 1_200_00,
  },
};

const contacts: ContactsOverviewModel = {
  entity: { currency: "USD" },
  contacts: {
    rows: [
      { name: "Acme Co", archived: false, moneyInYtdMinor: 40_000_00 },
      { name: "Globex", archived: false, moneyInYtdMinor: 12_000_00 },
      { name: "Old Client", archived: true, moneyInYtdMinor: 99_000_00 },
    ],
    kpis: { openReceivableMinor: 3_000_00, overdueReceivableCount: 0, contactsCount: 6 },
  },
};

const payroll: PayrollOverviewModel = {
  entity: { currency: "USD" },
  payroll: {
    currencyTotals: [{ currency: "USD", totalMinor: 25_000_00 }],
    unmatchedCount: 2,
    runs: [{ headcount: 5, period: "2026-06" }],
  },
};

const bills: BillsOverviewModel = {
  entity: { currency: "USD" },
  bills: { kpis: { openMinor: 4_000_00, overdueMinor: 900_00, dueSoonMinor: 600_00 } },
};

const dashboard: DashboardModel = {
  entity: { currency: "USD" },
  cashPositionMinor: 50_000_00,
  profitAndLoss: { netIncomeMinor: 7_500_00 },
  cashCushion: { months: 8.2 },
};

// E6-T10: the Reports surface's single insight, derived from the report pack.
const reports = {
  entity: { currency: "USD" },
  monthlyReview: { month: "2026-05", netResultMinor: 6_200_00 },
  arAging: { buckets: { days60Minor: 0, days90Minor: 0 }, totalMinor: 0 },
};

const ALL_PAGES: PageId[] = [
  "transactions",
  "income",
  "expenses",
  "contacts",
  "payroll",
  "bills",
  "dashboard",
  "reports",
];

describe("page-insights registry", () => {
  it("has a builder for all 8 pages", () => {
    for (const page of ALL_PAGES) {
      expect(typeof pageInsightBuilders[page]).toBe("function");
    }
    expect(Object.keys(pageInsightBuilders).sort()).toEqual([...ALL_PAGES].sort());
  });

  it("produces a DISTINCT non-empty line for each page given sample data", () => {
    const built = {
      transactions: buildPageInsight("transactions", transactions),
      income: buildPageInsight("income", income),
      expenses: buildPageInsight("expenses", expenses),
      contacts: buildPageInsight("contacts", contacts),
      payroll: buildPageInsight("payroll", payroll),
      bills: buildPageInsight("bills", bills),
      dashboard: buildPageInsight("dashboard", dashboard),
      reports: buildPageInsight("reports", reports),
    };

    const texts = Object.values(built).map((insight) => {
      expect(insight).not.toBeNull();
      expect(insight!.text.length).toBeGreaterThan(0);
      return insight!.text;
    });

    // No two pages show the same line — the core owner ask.
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("hides the banner (returns null) on empty/null read-models", () => {
    for (const page of ALL_PAGES) {
      // null read-model
      expect(buildPageInsight(page, null as never)).toBeNull();
    }

    // Empty-but-present read-models (all zeros) also yield null.
    expect(
      buildPageInsight("transactions", {
        insights: { uncategorizedCount: 0, netChangeMinor: 0, counterparties: [] },
      }),
    ).toBeNull();
    expect(
      buildPageInsight("income", {
        entity: { currency: "USD" },
        kpis: { receivedThisMonthMinor: 0, overdueMinor: 0, overdueInvoiceCount: 0, recurringMrrMinor: 0 },
        customers: [],
      }),
    ).toBeNull();
    expect(
      buildPageInsight("bills", {
        entity: { currency: "USD" },
        bills: { kpis: { openMinor: 0, overdueMinor: 0, dueSoonMinor: 0 } },
      }),
    ).toBeNull();
    expect(
      buildPageInsight("dashboard", {
        entity: { currency: "USD" },
        cashPositionMinor: 0,
        profitAndLoss: { netIncomeMinor: 0 },
        cashCushion: { months: null },
      }),
    ).toBeNull();
  });
});

describe("page-insights priority + tone discipline", () => {
  it("prioritizes uncategorized work on Transactions with a drill chip", () => {
    const insight = buildPageInsight("transactions", transactions);
    expect(insight?.text).toContain("category");
    expect(insight?.chip?.action).toBe("uncategorized");
    expect(insight?.tone).toBe("warning");
  });

  it("flags overdue AR as negative on Income", () => {
    const insight = buildPageInsight("income", income);
    expect(insight?.tone).toBe("negative");
    expect(insight?.chip?.action).toBe("overdue-ar");
  });

  it("keeps ordinary expense movement NEUTRAL, never alarm-red", () => {
    const insight = buildPageInsight("expenses", expenses);
    expect(insight?.tone).toBe("neutral");
    expect(insight?.tone).not.toBe("negative");
  });

  it("flags overdue bills as negative", () => {
    const insight = buildPageInsight("bills", bills);
    expect(insight?.tone).toBe("negative");
  });

  it("excludes archived contacts from the top-earner pick", () => {
    const insight = buildPageInsight("contacts", contacts);
    // "Old Client" is archived with the highest YTD — must not win.
    expect(insight?.text).toContain("Acme Co");
    expect(insight?.text).not.toContain("Old Client");
  });

  it("surfaces unmatched payroll before the run-rate", () => {
    const insight = buildPageInsight("payroll", payroll);
    expect(insight?.text).toContain("match");
    expect(insight?.chip?.action).toBe("unmatched-payroll");
  });

  it("warns when runway is short on the dashboard", () => {
    const tight = buildPageInsight("dashboard", {
      entity: { currency: "USD" },
      cashPositionMinor: 10_000_00,
      profitAndLoss: { netIncomeMinor: -2_000_00 },
      cashCushion: { months: 1.2 },
    });
    expect(tight?.tone).toBe("negative");
    expect(tight?.chip?.action).toBe("runway");
  });
});

describe("compactMoney", () => {
  it("formats minor units as a compact currency string", () => {
    expect(compactMoney(1_234_567, "USD")).toBe("$12.3K");
    expect(compactMoney(0, "USD")).toBe("$0");
  });
});
