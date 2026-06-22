export type ReportExportId =
  | "monthly-review"
  | "profit-and-loss"
  | "balance-sheet"
  | "cash-flow"
  | "ar-aging"
  | "ap-aging"
  | "expenses"
  | "income-by-customer"
  | "payroll-summary"
  | "general-ledger"
  | "trial-balance"
  | "journal";

type CsvCell = string | number | boolean | null | undefined;

export type CsvFile = {
  path: string;
  mimeType: "text/csv" | "application/json";
  content: string;
};

type ReportColumn = {
  key: string;
  label: string;
  amountMinor: number;
};

type DrillLine = {
  id: string;
  date: string;
  memo: string;
  source: string;
  accountName: string;
  accountNumber: string;
  debitMinor: number;
  creditMinor: number;
  amountMinor: number;
  currency: string;
};

type StatementRow = {
  id: string;
  label: string;
  accountNumber?: string;
  accountType?: string;
  accountSubtype?: string;
  totalMinor: number;
  columns?: ReportColumn[];
  drillDown?: DrillLine[];
  // E6-T6: prior-period total + signed delta, present only when compare != none.
  // Additive/optional so default (compare=none) packs and older serializations
  // stay compatible.
  priorTotalMinor?: number;
  deltaMinor?: number;
};

type AgingRow = {
  id: string;
  name: string;
  currentMinor: number;
  days30Minor: number;
  days60Minor: number;
  days90Minor: number;
  totalMinor: number;
  // E6-T4: the open invoices/bills behind this row's totals, so an aging cell is
  // drillable. Additive/optional — older serialized packs predate it.
  drillDown?: DrillLine[];
};

export type ReportPack = {
  entity: {
    id: string;
    name: string;
    currency: string;
  };
  // Present only in CONSOLIDATED (scope='all') packs (E5-T7/T8): the entity ids
  // rolled up, and the intercompany amount eliminated from the group totals.
  consolidatedFrom?: string[];
  eliminatedMinor?: number;
  eliminatedIncomeMinor?: number;
  eliminatedExpenseMinor?: number;
  reportCards?: Array<{ id: ReportExportId; group: string; name: string; description: string }>;
  controls: {
    startDate: string;
    endDate: string;
    basis: string;
    compare?: string;
    columnMode: string;
    comparison?: { startDate: string; endDate: string } | null;
  };
  monthlyReview: {
    month: string;
    moneyInMinor: number;
    moneyOutMinor: number;
    netResultMinor: number;
    owedToYouMinor: number;
    youOweMinor: number;
    payrollMinor: number;
    topCustomers: Array<{ name: string; totalMinor: number }>;
    topExpenseCategories: StatementRow[];
  };
  profitAndLoss: {
    incomeMinor: number;
    expenseMinor: number;
    netIncomeMinor: number;
    rows: StatementRow[];
    sections?: Array<{ key: string; label: string; totalMinor: number; rows: StatementRow[] }>;
  };
  balanceSheet: {
    asOfDate: string;
    assetMinor: number;
    liabilityMinor: number;
    equityMinor: number;
    currentEarningsMinor: number;
    differenceMinor: number;
    balanced: boolean;
    rows: StatementRow[];
    sections?: Array<{ key: string; label: string; totalMinor: number; rows: StatementRow[] }>;
  };
  cashFlow: {
    openingCashMinor: number;
    closingCashMinor: number;
    netCashChangeMinor: number;
    groups: Array<{ key: string; label: string; totalMinor: number; rows: DrillLine[] }>;
  };
  arAging: {
    totalMinor: number;
    buckets: {
      currentMinor: number;
      days30Minor: number;
      days60Minor: number;
      days90Minor: number;
    };
    rows: AgingRow[];
  };
  apAging: {
    totalMinor: number;
    buckets: {
      currentMinor: number;
      days30Minor: number;
      days60Minor: number;
      days90Minor: number;
    };
    rows: AgingRow[];
  };
  expenses: {
    byCategory: StatementRow[];
    // E6-T4: drillDown additive so a vendor amount opens its journal lines.
    byVendor: Array<{ id: string; name: string; totalMinor: number; drillDown?: DrillLine[] }>;
  };
  incomeByCustomer: {
    // E6-T4: drillDown additive so a customer amount opens its journal lines.
    rows: Array<{ id: string; name: string; totalMinor: number; drillDown?: DrillLine[] }>;
    totalMinor: number;
  };
  payrollSummary: {
    totalMinor: number;
    baseCurrency: string;
    headcount: number;
    hasFx: boolean;
    byCurrency: Array<{ currency: string; localMinor: number; baseMinor: number }>;
    // E6-T4: drillDown additive so a payroll period total opens its run lines.
    rows: Array<{ id: string; period: string; status: string; totalBaseMinor: number; drillDown?: DrillLine[] }>;
  };
  generalLedger: {
    rows: DrillLine[];
  };
  trialBalance: {
    rows: Array<{
      id: string;
      accountNumber: string;
      label: string;
      accountType: string;
      debitMinor: number;
      creditMinor: number;
    }>;
    totalDebitMinor: number;
    totalCreditMinor: number;
    differenceMinor: number;
  };
  journal: {
    entries: Array<{
      id: string;
      date: string;
      memo: string;
      source: string;
      lines: Array<{
        id: string;
        accountName: string;
        accountNumber: string;
        debitMinor: number;
        creditMinor: number;
        currency: string;
      }>;
    }>;
  };
  limits?: {
    reportLimit: number;
    truncated: boolean;
  };
  // E1-T8: count + absolute $ (integer minor units) of transactions that are
  // unreviewed and therefore EXCLUDED from these figures. Optional so the type
  // stays compatible with any older serialized pack.
  unreviewed?: {
    unreviewedCount: number;
    unreviewedAbsMinor: number;
  };
  // E6-T5: count + absolute $ (integer minor units) of OPEN invoices/bills that a
  // CASH-basis view drops. The basis badge surfaces this when basis='cash' so the
  // owner knows exactly what the cash view excludes. Optional/additive.
  cashBasisExcluded?: {
    count: number;
    amountMinor: number;
  };
};

const reportNames: Record<ReportExportId, string> = {
  "monthly-review": "Monthly Review",
  "profit-and-loss": "Profit and Loss",
  "balance-sheet": "Balance Sheet",
  "cash-flow": "Cash Flow",
  "ar-aging": "AR Aging",
  "ap-aging": "AP Aging",
  expenses: "Expenses",
  "income-by-customer": "Income by Customer",
  "payroll-summary": "Payroll Summary",
  "general-ledger": "General Ledger",
  "trial-balance": "Trial Balance",
  journal: "Journal Entries",
};

const allReportIds: ReportExportId[] = [
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

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function csvEscape(value: CsvCell) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

function csv(rows: CsvCell[][]) {
  return `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

function minorDecimal(amountMinor: number) {
  const sign = amountMinor < 0 ? "-" : "";
  const absolute = Math.abs(amountMinor);
  const dollars = Math.floor(absolute / 100);
  const cents = String(absolute % 100).padStart(2, "0");
  return `${sign}${dollars}.${cents}`;
}

function moneyCells(amountMinor: number) {
  return [amountMinor, minorDecimal(amountMinor)];
}

function statementCsv(title: string, rows: StatementRow[], pack: ReportPack) {
  const columnLabels = rows[0]?.columns?.map((column) => column.label) ?? [];
  // E6-T6: emit prior + delta columns when a comparison is active and the rows
  // carry the additive priorTotalMinor/deltaMinor (so the CSV reconciles to the
  // on-screen Prior/Change columns). Absent for default compare=none packs.
  const hasPrior = rows.some((row) => row.priorTotalMinor !== undefined);
  return csv([
    [title],
    ["entity", pack.entity.name],
    ["currency", pack.entity.currency],
    ["range", pack.controls.startDate, pack.controls.endDate],
    ["basis", pack.controls.basis],
    ...(hasPrior && pack.controls.comparison
      ? [["compare", pack.controls.comparison.startDate, pack.controls.comparison.endDate]]
      : []),
    [],
    [
      "account_number",
      "account_name",
      "account_type",
      "account_subtype",
      "total_minor",
      "total",
      ...columnLabels.flatMap((label) => [`${label}_minor`, label]),
      ...(hasPrior ? ["prior_total_minor", "prior_total", "delta_minor", "delta"] : []),
    ],
    ...rows.map((row) => [
      row.accountNumber ?? "",
      row.label,
      row.accountType ?? "",
      row.accountSubtype ?? "",
      ...moneyCells(row.totalMinor),
      ...(row.columns ?? []).flatMap((column) => moneyCells(column.amountMinor)),
      ...(hasPrior ? [...moneyCells(row.priorTotalMinor ?? 0), ...moneyCells(row.deltaMinor ?? 0)] : []),
    ]),
  ]);
}

function agingCsv(title: string, report: { totalMinor: number; rows: AgingRow[] }, pack: ReportPack) {
  return csv([
    [title],
    ["entity", pack.entity.name],
    ["currency", pack.entity.currency],
    ["as_of", pack.controls.endDate],
    ["total_minor", report.totalMinor],
    ["total", minorDecimal(report.totalMinor)],
    [],
    ["name", "current_minor", "current", "1_30_minor", "1_30", "31_60_minor", "31_60", "61_plus_minor", "61_plus", "total_minor", "total"],
    ...report.rows.map((row) => [
      row.name,
      ...moneyCells(row.currentMinor),
      ...moneyCells(row.days30Minor),
      ...moneyCells(row.days60Minor),
      ...moneyCells(row.days90Minor),
      ...moneyCells(row.totalMinor),
    ]),
  ]);
}

function drillCsv(title: string, rows: DrillLine[], pack: ReportPack) {
  return csv([
    [title],
    ["entity", pack.entity.name],
    ["currency", pack.entity.currency],
    ["range", pack.controls.startDate, pack.controls.endDate],
    [],
    ["date", "memo", "source", "account_number", "account_name", "debit_minor", "debit", "credit_minor", "credit", "amount_minor", "amount", "currency"],
    ...rows.map((row) => [
      row.date,
      row.memo,
      row.source,
      row.accountNumber,
      row.accountName,
      ...moneyCells(row.debitMinor),
      ...moneyCells(row.creditMinor),
      ...moneyCells(row.amountMinor),
      row.currency,
    ]),
  ]);
}

export function reportCsv(reportId: ReportExportId, pack: ReportPack) {
  switch (reportId) {
    case "monthly-review":
      return csv([
        ["Monthly Review"],
        ["entity", pack.entity.name],
        ["month", pack.monthlyReview.month],
        ["currency", pack.entity.currency],
        [],
        ["metric", "amount_minor", "amount"],
        ["money_in", ...moneyCells(pack.monthlyReview.moneyInMinor)],
        ["money_out", ...moneyCells(pack.monthlyReview.moneyOutMinor)],
        ["net_result", ...moneyCells(pack.monthlyReview.netResultMinor)],
        ["owed_to_you", ...moneyCells(pack.monthlyReview.owedToYouMinor)],
        ["you_owe", ...moneyCells(pack.monthlyReview.youOweMinor)],
        ["payroll", ...moneyCells(pack.monthlyReview.payrollMinor)],
        [],
        ["top_customers"],
        ["name", "amount_minor", "amount"],
        ...pack.monthlyReview.topCustomers.map((row) => [row.name, ...moneyCells(row.totalMinor)]),
        [],
        ["top_expense_categories"],
        ["name", "amount_minor", "amount"],
        ...pack.monthlyReview.topExpenseCategories.map((row) => [row.label, ...moneyCells(row.totalMinor)]),
      ]);
    case "profit-and-loss":
      return statementCsv("Profit and Loss", pack.profitAndLoss.rows, pack);
    case "balance-sheet": {
      // E6-T3 parity: serialize the SAME `sections` the screen renders
      // (assets/liabilities/equity, each with its account rows), plus the
      // 'liabilities + equity + earnings' total the screen shows at the bottom.
      const sections = pack.balanceSheet.sections ?? [
        { key: "assets", label: "Assets", totalMinor: pack.balanceSheet.assetMinor, rows: pack.balanceSheet.rows.filter((row) => row.accountType === "asset") },
        { key: "liabilities", label: "Liabilities", totalMinor: pack.balanceSheet.liabilityMinor, rows: pack.balanceSheet.rows.filter((row) => row.accountType === "liability") },
        { key: "equity", label: "Equity", totalMinor: pack.balanceSheet.equityMinor, rows: pack.balanceSheet.rows.filter((row) => row.accountType === "equity") },
      ];
      const liabPlusEquityPlusEarnings =
        pack.balanceSheet.liabilityMinor + pack.balanceSheet.equityMinor + pack.balanceSheet.currentEarningsMinor;
      return csv([
        ["Balance Sheet"],
        ["entity", pack.entity.name],
        ["currency", pack.entity.currency],
        ["as_of", pack.balanceSheet.asOfDate],
        ["basis", pack.controls.basis],
        ["balanced", pack.balanceSheet.balanced],
        ["difference_minor", pack.balanceSheet.differenceMinor],
        ["difference", minorDecimal(pack.balanceSheet.differenceMinor)],
        [],
        ["section", "account_number", "account_name", "amount_minor", "amount"],
        ...sections.flatMap((section) => [
          [section.label, "", "SECTION TOTAL", ...moneyCells(section.totalMinor)],
          ...section.rows.map((row) => [section.label, row.accountNumber ?? "", row.label, ...moneyCells(row.totalMinor)]),
        ]),
        [],
        ["current_earnings", "", "", ...moneyCells(pack.balanceSheet.currentEarningsMinor)],
        ["liabilities_equity_earnings", "", "", ...moneyCells(liabPlusEquityPlusEarnings)],
      ]);
    }
    case "cash-flow":
      // E6-T3 parity: emit the PER-ROW line items the screen renders, not just the
      // group totals. Each group prints its total, then every contributing line
      // (date · memo · signed amount). Opening/net/closing stay as header summary.
      return csv([
        ["Cash Flow"],
        ["entity", pack.entity.name],
        ["currency", pack.entity.currency],
        ["range", pack.controls.startDate, pack.controls.endDate],
        ["basis", pack.controls.basis],
        ["opening_cash_minor", pack.cashFlow.openingCashMinor],
        ["opening_cash", minorDecimal(pack.cashFlow.openingCashMinor)],
        ["net_cash_change_minor", pack.cashFlow.netCashChangeMinor],
        ["net_cash_change", minorDecimal(pack.cashFlow.netCashChangeMinor)],
        ["closing_cash_minor", pack.cashFlow.closingCashMinor],
        ["closing_cash", minorDecimal(pack.cashFlow.closingCashMinor)],
        [],
        ["group", "date", "memo", "amount_minor", "amount"],
        ...pack.cashFlow.groups.flatMap((group) => [
          [group.label, "", "TOTAL", ...moneyCells(group.totalMinor)],
          ...group.rows.map((row) => [group.label, row.date, row.memo, ...moneyCells(row.amountMinor)]),
        ]),
      ]);
    case "ar-aging":
      return agingCsv("AR Aging", pack.arAging, pack);
    case "ap-aging":
      return agingCsv("AP Aging", pack.apAging, pack);
    case "expenses":
      return csv([
        ["Expenses"],
        ["entity", pack.entity.name],
        ["currency", pack.entity.currency],
        ["range", pack.controls.startDate, pack.controls.endDate],
        ["basis", pack.controls.basis],
        [],
        ["by_category"],
        ["category", "amount_minor", "amount"],
        ...pack.expenses.byCategory.map((row) => [row.label, ...moneyCells(row.totalMinor)]),
        [],
        ["by_vendor"],
        ["vendor", "amount_minor", "amount"],
        ...pack.expenses.byVendor.map((row) => [row.name, ...moneyCells(row.totalMinor)]),
      ]);
    case "income-by-customer": {
      // E6-T3 parity: include the % share column the screen computes
      // (Math.round(row / total * 100)) so the CSV reconciles to what's shown.
      const incomeTotal = pack.incomeByCustomer.totalMinor || 1;
      return csv([
        ["Income by Customer"],
        ["entity", pack.entity.name],
        ["currency", pack.entity.currency],
        ["range", pack.controls.startDate, pack.controls.endDate],
        ["basis", pack.controls.basis],
        ["total_minor", pack.incomeByCustomer.totalMinor],
        ["total", minorDecimal(pack.incomeByCustomer.totalMinor)],
        [],
        ["customer", "amount_minor", "amount", "share_pct"],
        ...pack.incomeByCustomer.rows.map((row) => [
          row.name,
          ...moneyCells(row.totalMinor),
          Math.round((row.totalMinor / incomeTotal) * 100),
        ]),
      ]);
    }
    case "payroll-summary":
      return csv([
        ["Payroll Summary"],
        ["entity", pack.entity.name],
        ["range", pack.controls.startDate, pack.controls.endDate],
        ["base_currency", pack.payrollSummary.baseCurrency],
        ["headcount", pack.payrollSummary.headcount],
        ["total_minor", pack.payrollSummary.totalMinor],
        ["total", minorDecimal(pack.payrollSummary.totalMinor)],
        [],
        ["by_currency"],
        ["currency", "local_minor", "local", "base_minor", "base"],
        ...pack.payrollSummary.byCurrency.map((row) => [
          row.currency,
          ...moneyCells(row.localMinor),
          ...moneyCells(row.baseMinor),
        ]),
        [],
        ["period", "status", "total_minor", "total"],
        ...pack.payrollSummary.rows.map((row) => [row.period, row.status, ...moneyCells(row.totalBaseMinor)]),
      ]);
    case "general-ledger":
      return drillCsv("General Ledger", pack.generalLedger.rows, pack);
    case "trial-balance":
      return csv([
        ["Trial Balance"],
        ["entity", pack.entity.name],
        ["range", pack.controls.startDate, pack.controls.endDate],
        ["difference_minor", pack.trialBalance.differenceMinor],
        ["difference", minorDecimal(pack.trialBalance.differenceMinor)],
        [],
        ["account_number", "account_name", "account_type", "debit_minor", "debit", "credit_minor", "credit"],
        ...pack.trialBalance.rows.map((row) => [
          row.accountNumber,
          row.label,
          row.accountType,
          ...moneyCells(row.debitMinor),
          ...moneyCells(row.creditMinor),
        ]),
        ["total", "", "", ...moneyCells(pack.trialBalance.totalDebitMinor), ...moneyCells(pack.trialBalance.totalCreditMinor)],
      ]);
    case "journal":
      return csv([
        ["Journal Entries"],
        ["entity", pack.entity.name],
        ["range", pack.controls.startDate, pack.controls.endDate],
        [],
        ["entry_id", "date", "memo", "source", "line_id", "account_number", "account_name", "debit_minor", "debit", "credit_minor", "credit", "currency"],
        ...pack.journal.entries.flatMap((entry) =>
          entry.lines.map((line) => [
            entry.id,
            entry.date,
            entry.memo,
            entry.source,
            line.id,
            line.accountNumber,
            line.accountName,
            ...moneyCells(line.debitMinor),
            ...moneyCells(line.creditMinor),
            line.currency,
          ]),
        ),
      ]);
  }
}

export function reportCsvFile(reportId: ReportExportId, pack: ReportPack): CsvFile {
  const base = `${slug(pack.entity.name)}-${slug(reportNames[reportId])}-${pack.controls.startDate}-to-${pack.controls.endDate}`;
  return {
    path: `${base}.csv`,
    mimeType: "text/csv",
    content: reportCsv(reportId, pack),
  };
}

export function reportsCsvBundle(pack: ReportPack): CsvFile[] {
  return allReportIds.map((reportId) => reportCsvFile(reportId, pack));
}

export function settingsDataExportFiles(pack: ReportPack): CsvFile[] {
  return [
    ...reportsCsvBundle(pack),
    {
      path: `${slug(pack.entity.name)}-reports-export-${pack.controls.startDate}-to-${pack.controls.endDate}.json`,
      mimeType: "application/json",
      content: `${JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          entity: pack.entity,
          controls: pack.controls,
          reports: pack,
        },
        null,
        2,
      )}\n`,
    },
  ];
}

export function downloadReportFile(file: CsvFile) {
  const blob = new Blob([file.content], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.path;
  anchor.click();
  URL.revokeObjectURL(url);
}
