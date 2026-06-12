import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";

const reportBasisValidator = v.union(v.literal("accrual"), v.literal("cash"));
const compareValidator = v.union(v.literal("none"), v.literal("priorPeriod"), v.literal("priorYear"));
const columnModeValidator = v.union(v.literal("total"), v.literal("monthly"), v.literal("quarterly"));

type ReportBasis = "accrual" | "cash";
type CompareMode = "none" | "priorPeriod" | "priorYear";
type ColumnMode = "total" | "monthly" | "quarterly";
type AccountType = Doc<"ledgerAccounts">["type"];
type Balance = { debitMinor: number; creditMinor: number };

type ReportLine = {
  id: string;
  date: string;
  memo: string;
  source: Doc<"journalEntries">["source"];
  accountName: string;
  accountNumber: string;
  debitMinor: number;
  creditMinor: number;
  amountMinor: number;
  currency: string;
};

const CASH_SUBTYPES = new Set(["bank", "cash", "checking", "savings"]);
const OPERATING_TYPES = new Set<AccountType>(["income", "expense"]);
const REPORT_LIMIT = 5000;

async function getEntity(ctx: QueryCtx, entityId?: Id<"entities">) {
  if (entityId) {
    const entity = await ctx.db.get(entityId);
    if (!entity) return null;
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");
    return entity;
  }

  const { membership } = await requireAnyWorkspaceRole(ctx, "member");
  const demoEntity = await ctx.db
    .query("entities")
    .withIndex("by_workspace_and_slug", (q) =>
      q.eq("workspaceId", membership.workspaceId).eq("slug", "acme-studio-llc"),
    )
    .unique();
  if (demoEntity) return demoEntity;

  const firstEntity = await ctx.db
    .query("entities")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
    .first();
  if (!firstEntity) return null;
  return firstEntity;
}

function reportCards() {
  return [
    { id: "monthly-review", group: "Overview", name: "Monthly Review", description: "A one-page owner summary for the month." },
    { id: "profit-and-loss", group: "Statements", name: "Profit & Loss", description: "How much you made and spent." },
    { id: "balance-sheet", group: "Statements", name: "Balance Sheet", description: "What the business owns and owes." },
    { id: "cash-flow", group: "Statements", name: "Cash Flow", description: "How cash moved through the business." },
    { id: "ar-aging", group: "Money owed", name: "AR Aging", description: "Who owes you money." },
    { id: "ap-aging", group: "Money owed", name: "AP Aging", description: "Who you need to pay." },
    { id: "expenses", group: "Insights", name: "Expenses", description: "Spend by category and vendor." },
    { id: "income-by-customer", group: "Insights", name: "Income by Customer", description: "Customer concentration." },
    { id: "payroll-summary", group: "Insights", name: "Payroll Summary", description: "Payroll by month." },
    { id: "general-ledger", group: "Accountant", name: "General Ledger", description: "Line-by-line account activity." },
    { id: "trial-balance", group: "Accountant", name: "Trial Balance", description: "Debit and credit check." },
    { id: "journal", group: "Accountant", name: "Journal Entries", description: "Entry-centric register." },
  ];
}

function emptyReportPack(args: {
  startDate: string;
  endDate: string;
  basis: ReportBasis;
  compare: CompareMode;
  columnMode: ColumnMode;
}) {
  const comparison = compareRange(args.startDate, args.endDate, args.compare);
  const emptyAging = {
    totalMinor: 0,
    buckets: { currentMinor: 0, days30Minor: 0, days60Minor: 0, days90Minor: 0 },
    rows: [],
  };
  return {
    entity: {
      id: "",
      name: "No business yet",
      currency: "USD",
    },
    controls: {
      startDate: args.startDate,
      endDate: args.endDate,
      basis: args.basis,
      compare: args.compare,
      columnMode: args.columnMode,
      comparison,
    },
    reportCards: reportCards(),
    monthlyReview: {
      month: monthKey(args.endDate),
      moneyInMinor: 0,
      moneyOutMinor: 0,
      netResultMinor: 0,
      owedToYouMinor: 0,
      youOweMinor: 0,
      payrollMinor: 0,
      topCustomers: [],
      topExpenseCategories: [],
    },
    profitAndLoss: {
      incomeMinor: 0,
      expenseMinor: 0,
      netIncomeMinor: 0,
      rows: [],
      sections: [
        { key: "income", label: "Income", totalMinor: 0, rows: [] },
        { key: "expense", label: "Expenses", totalMinor: 0, rows: [] },
      ],
    },
    balanceSheet: {
      asOfDate: args.endDate,
      assetMinor: 0,
      liabilityMinor: 0,
      equityMinor: 0,
      currentEarningsMinor: 0,
      differenceMinor: 0,
      balanced: true,
      rows: [],
      sections: [
        { key: "assets", label: "Assets", totalMinor: 0, rows: [] },
        { key: "liabilities", label: "Liabilities", totalMinor: 0, rows: [] },
        { key: "equity", label: "Equity", totalMinor: 0, rows: [] },
      ],
    },
    cashFlow: {
      openingCashMinor: 0,
      closingCashMinor: 0,
      netCashChangeMinor: 0,
      groups: [
        { key: "operating", label: "Operating", totalMinor: 0, rows: [] },
        { key: "investing", label: "Investing", totalMinor: 0, rows: [] },
        { key: "financing", label: "Financing", totalMinor: 0, rows: [] },
      ],
    },
    arAging: emptyAging,
    apAging: emptyAging,
    expenses: { byCategory: [], byVendor: [] },
    incomeByCustomer: { rows: [], totalMinor: 0 },
    payrollSummary: { totalMinor: 0, rows: [] },
    generalLedger: { rows: [] },
    trialBalance: { rows: [], totalDebitMinor: 0, totalCreditMinor: 0, differenceMinor: 0 },
    journal: { entries: [] },
    limits: {
      reportLimit: REPORT_LIMIT,
      truncated: false,
      rowCounts: {
        ledgerAccounts: 0,
        journalEntries: 0,
        journalLines: 0,
        transactions: 0,
        invoices: 0,
        bills: 0,
        payrollRuns: 0,
        contacts: 0,
        bankAccounts: 0,
        totalRows: 0,
      },
    },
  };
}

function addBalance(map: Map<Id<"ledgerAccounts">, Balance>, line: Doc<"journalLines">) {
  const current = map.get(line.accountId) ?? { debitMinor: 0, creditMinor: 0 };
  current.debitMinor += line.debitMinor;
  current.creditMinor += line.creditMinor;
  map.set(line.accountId, current);
}

function normalBalance(account: Doc<"ledgerAccounts">, balance: Balance) {
  if (account.type === "asset" || account.type === "expense") {
    return balance.debitMinor - balance.creditMinor;
  }
  return balance.creditMinor - balance.debitMinor;
}

function debitCreditBalance(balance: Balance) {
  const netMinor = balance.debitMinor - balance.creditMinor;
  return {
    debitMinor: netMinor >= 0 ? netMinor : 0,
    creditMinor: netMinor < 0 ? Math.abs(netMinor) : 0,
  };
}

function entryInRange(entry: Doc<"journalEntries"> | undefined, startDate: string, endDate: string) {
  return entry ? entry.date >= startDate && entry.date <= endDate : false;
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

function quarterKey(date: string) {
  const month = Number(date.slice(5, 7));
  return `${date.slice(0, 4)} Q${Math.ceil(month / 3)}`;
}

function columnKey(date: string, mode: ColumnMode) {
  if (mode === "monthly") return monthKey(date);
  if (mode === "quarterly") return quarterKey(date);
  return "Total";
}

function buildColumns(startDate: string, endDate: string, mode: ColumnMode) {
  if (mode === "total") return [{ key: "Total", label: "Total" }];

  const columns: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();
  let cursor = new Date(`${startDate.slice(0, 7)}-01T00:00:00.000Z`);
  const end = new Date(`${endDate.slice(0, 7)}-01T00:00:00.000Z`);
  while (cursor <= end) {
    const isoMonth = cursor.toISOString().slice(0, 7);
    const key = mode === "monthly" ? isoMonth : quarterKey(`${isoMonth}-01`);
    if (!seen.has(key)) {
      columns.push({ key, label: key });
      seen.add(key);
    }
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return columns;
}

function emptyColumnMap(columns: Array<{ key: string }>) {
  return Object.fromEntries(columns.map((column) => [column.key, 0])) as Record<string, number>;
}

function accountSort(a: Doc<"ledgerAccounts">, b: Doc<"ledgerAccounts">) {
  return a.number.localeCompare(b.number);
}

function reportAmountForLine(account: Doc<"ledgerAccounts">, line: Doc<"journalLines">) {
  if (account.type === "asset" || account.type === "expense") {
    return line.debitMinor - line.creditMinor;
  }
  return line.creditMinor - line.debitMinor;
}

function makeReportLine(
  entry: Doc<"journalEntries">,
  line: Doc<"journalLines">,
  account: Doc<"ledgerAccounts">,
): ReportLine {
  return {
    id: `${entry._id}:${line._id}`,
    date: entry.date,
    memo: entry.memo,
    source: entry.source,
    accountName: account.name,
    accountNumber: account.number,
    debitMinor: line.debitMinor,
    creditMinor: line.creditMinor,
    amountMinor: reportAmountForLine(account, line),
    currency: line.currency,
  };
}

function buildStatementRows({
  accounts,
  lines,
  entriesById,
  startDate,
  endDate,
  columns,
  columnMode,
  includeTypes,
  excludedEntryIds,
}: {
  accounts: Doc<"ledgerAccounts">[];
  lines: Doc<"journalLines">[];
  entriesById: Map<Id<"journalEntries">, Doc<"journalEntries">>;
  startDate: string;
  endDate: string;
  columns: Array<{ key: string; label: string }>;
  columnMode: ColumnMode;
  includeTypes: Set<AccountType>;
  excludedEntryIds: Set<Id<"journalEntries">>;
}) {
  const accountsById = new Map(accounts.map((account) => [account._id, account]));
  const rowsByAccount = new Map<
    Id<"ledgerAccounts">,
    {
      account: Doc<"ledgerAccounts">;
      totalMinor: number;
      columns: Record<string, number>;
      drillDown: ReportLine[];
    }
  >();

  for (const line of lines) {
    if (excludedEntryIds.has(line.entryId)) continue;
    const entry = entriesById.get(line.entryId);
    const account = accountsById.get(line.accountId);
    if (!entry || !account || !includeTypes.has(account.type) || !entryInRange(entry, startDate, endDate)) {
      continue;
    }
    const amountMinor = reportAmountForLine(account, line);
    const row = rowsByAccount.get(account._id) ?? {
      account,
      totalMinor: 0,
      columns: emptyColumnMap(columns),
      drillDown: [],
    };
    row.totalMinor += amountMinor;
    row.columns[columnKey(entry.date, columnMode)] += amountMinor;
    row.drillDown.push(makeReportLine(entry, line, account));
    rowsByAccount.set(account._id, row);
  }

  return [...rowsByAccount.values()]
    .sort((a, b) => accountSort(a.account, b.account))
    .map((row) => ({
      id: row.account._id,
      label: row.account.name,
      accountNumber: row.account.number,
      accountType: row.account.type,
      accountSubtype: row.account.subtype,
      totalMinor: row.totalMinor,
      columns: columns.map((column) => ({
        key: column.key,
        label: column.label,
        amountMinor: row.columns[column.key] ?? 0,
      })),
      drillDown: row.drillDown.sort((a, b) => a.date.localeCompare(b.date)),
    }));
}

/**
 * AR/AP aging matrix by contact. Buckets: current (not past due), 1–30, 31–60,
 * 61–90, 90+. EXPORTED so the Income/Expenses read models (incomeViews) reuse
 * this exact bucket math instead of duplicating it (Epic C). `endDate` is the
 * as-of date the days-past-due is measured against.
 */
export function buildAgingRows({
  contactsById,
  rows,
  endDate,
}: {
  contactsById: Map<Id<"contacts">, Doc<"contacts">>;
  rows: Array<{
    id: string;
    contactId: Id<"contacts">;
    reference: string;
    dueDate: string;
    totalMinor: number;
    amountPaidMinor?: number;
  }>;
  endDate: string;
}) {
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  const byContact = new Map<
    Id<"contacts">,
    {
      id: Id<"contacts">;
      name: string;
      currentMinor: number;
      days30Minor: number;
      days60Minor: number;
      days90Minor: number;
      totalMinor: number;
      items: Array<{ id: string; reference: string; dueDate: string; amountMinor: number; daysPastDue: number }>;
    }
  >();

  for (const item of rows) {
    const amountMinor = item.totalMinor - (item.amountPaidMinor ?? 0);
    if (amountMinor <= 0) continue;
    const daysPastDue = Math.max(
      0,
      Math.floor((end - new Date(`${item.dueDate}T00:00:00.000Z`).getTime()) / 86_400_000),
    );
    const contact = contactsById.get(item.contactId);
    const row = byContact.get(item.contactId) ?? {
      id: item.contactId,
      name: contact?.name ?? "Unassigned",
      currentMinor: 0,
      days30Minor: 0,
      days60Minor: 0,
      days90Minor: 0,
      totalMinor: 0,
      items: [],
    };
    if (daysPastDue === 0) row.currentMinor += amountMinor;
    else if (daysPastDue <= 30) row.days30Minor += amountMinor;
    else if (daysPastDue <= 60) row.days60Minor += amountMinor;
    else row.days90Minor += amountMinor;
    row.totalMinor += amountMinor;
    row.items.push({ id: item.id, reference: item.reference, dueDate: item.dueDate, amountMinor, daysPastDue });
    byContact.set(item.contactId, row);
  }

  const agingRows = [...byContact.values()].sort((a, b) => b.totalMinor - a.totalMinor);
  const totalMinor = agingRows.reduce((sum, row) => sum + row.totalMinor, 0);
  return {
    rows: agingRows,
    totalMinor,
    buckets: {
      currentMinor: agingRows.reduce((sum, row) => sum + row.currentMinor, 0),
      days30Minor: agingRows.reduce((sum, row) => sum + row.days30Minor, 0),
      days60Minor: agingRows.reduce((sum, row) => sum + row.days60Minor, 0),
      days90Minor: agingRows.reduce((sum, row) => sum + row.days90Minor, 0),
    },
  };
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function compareRange(startDate: string, endDate: string, compare: CompareMode) {
  if (compare === "none") return null;
  if (compare === "priorYear") {
    return {
      startDate: `${Number(startDate.slice(0, 4)) - 1}${startDate.slice(4)}`,
      endDate: `${Number(endDate.slice(0, 4)) - 1}${endDate.slice(4)}`,
    };
  }
  const days = daysBetween(startDate, endDate) + 1;
  const priorEnd = shiftDate(startDate, -1);
  return {
    startDate: shiftDate(priorEnd, -(days - 1)),
    endDate: priorEnd,
  };
}

export const reportPack = query({
  args: {
    entityId: v.optional(v.id("entities")),
    startDate: v.string(),
    endDate: v.string(),
    basis: reportBasisValidator,
    compare: compareValidator,
    columnMode: columnModeValidator,
  },
  handler: async (ctx, args) => {
    if (args.startDate > args.endDate) {
      throw new Error("Report start date must be before the end date.");
    }

    const entity = await getEntity(ctx, args.entityId);
    if (!entity) {
      return emptyReportPack(args);
    }
    return await buildReportPackForEntity(ctx, entity, args);
  },
});

type ReportPackArgs = {
  startDate: string;
  endDate: string;
  basis: ReportBasis;
  compare: CompareMode;
  columnMode: ColumnMode;
};

/**
 * Compute the full report pack for an already-resolved entity. The public
 * `reportPack` query resolves + authorizes the entity via the user session;
 * `reportPackForEntity` (internal) is used by the Ask AI agent's read tools
 * where authorization is re-derived from the thread's ownership row (no user
 * session in the scheduled streaming action).
 */
async function buildReportPackForEntity(
  ctx: QueryCtx,
  entity: Doc<"entities">,
  args: ReportPackArgs,
) {
  {
    const [accounts, entries, lines, transactions, invoices, bills, payrollRuns, contacts, bankAccounts] =
      await Promise.all([
        ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(REPORT_LIMIT),
        ctx.db.query("journalEntries").withIndex("by_entity_and_date", (q) => q.eq("entityId", entity._id)).take(REPORT_LIMIT),
        ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(REPORT_LIMIT),
        ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(REPORT_LIMIT),
        ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(REPORT_LIMIT),
        ctx.db.query("bills").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(REPORT_LIMIT),
        ctx.db.query("payrollRuns").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(REPORT_LIMIT),
        ctx.db.query("contacts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(REPORT_LIMIT),
        ctx.db.query("bankAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(REPORT_LIMIT),
      ]);

    const columns = buildColumns(args.startDate, args.endDate, args.columnMode);
    const accountsById = new Map(accounts.map((account) => [account._id, account]));
    const entriesById = new Map(entries.map((entry) => [entry._id, entry]));
    const contactsById = new Map(contacts.map((contact) => [contact._id, contact]));
    const transactionsByEntryId = new Map(
      transactions.flatMap((transaction) => (transaction.entryId ? [[transaction.entryId, transaction] as const] : [])),
    );
    const unsettledEntryIds = new Set<Id<"journalEntries">>();
    for (const invoice of invoices) {
      if (invoice.status === "open" || invoice.status === "overdue") {
        for (const entryId of invoice.entryIds) unsettledEntryIds.add(entryId);
      }
    }
    for (const bill of bills) {
      if (bill.status === "open") {
        for (const entryId of bill.entryIds) unsettledEntryIds.add(entryId);
      }
    }
    const excludedEntryIds = args.basis === "cash" ? unsettledEntryIds : new Set<Id<"journalEntries">>();

    const statementRows = buildStatementRows({
      accounts,
      lines,
      entriesById,
      startDate: args.startDate,
      endDate: args.endDate,
      columns,
      columnMode: args.columnMode,
      includeTypes: new Set<AccountType>(["income", "expense"]),
      excludedEntryIds,
    });
    const incomeRows = statementRows.filter((row) => row.accountType === "income");
    const expenseRows = statementRows.filter((row) => row.accountType === "expense");
    const incomeMinor = incomeRows.reduce((sum, row) => sum + row.totalMinor, 0);
    const expenseMinor = expenseRows.reduce((sum, row) => sum + row.totalMinor, 0);
    const netIncomeMinor = incomeMinor - expenseMinor;

    const balanceThroughEnd = new Map<Id<"ledgerAccounts">, Balance>();
    const balanceBeforeStart = new Map<Id<"ledgerAccounts">, Balance>();
    const trialBalances = new Map<Id<"ledgerAccounts">, Balance>();
    for (const line of lines) {
      const entry = entriesById.get(line.entryId);
      if (!entry || excludedEntryIds.has(line.entryId)) continue;
      if (entry.date <= args.endDate) addBalance(balanceThroughEnd, line);
      if (entry.date < args.startDate) addBalance(balanceBeforeStart, line);
      if (entry.date >= args.startDate && entry.date <= args.endDate) addBalance(trialBalances, line);
    }

    let assetMinor = 0;
    let liabilityMinor = 0;
    let equityMinor = 0;
    let currentEarningsMinor = 0;
    for (const [accountId, balance] of balanceThroughEnd.entries()) {
      const account = accountsById.get(accountId);
      if (!account) continue;
      const amountMinor = normalBalance(account, balance);
      if (account.type === "asset") assetMinor += amountMinor;
      if (account.type === "liability") liabilityMinor += amountMinor;
      if (account.type === "equity") equityMinor += amountMinor;
      if (account.type === "income") currentEarningsMinor += amountMinor;
      if (account.type === "expense") currentEarningsMinor -= amountMinor;
    }
    const balanceSheetDifferenceMinor = assetMinor - (liabilityMinor + equityMinor + currentEarningsMinor);

    const balanceSheetRows = buildStatementRows({
      accounts,
      lines,
      entriesById,
      startDate: "0000-01-01",
      endDate: args.endDate,
      columns: [{ key: "Total", label: "Total" }],
      columnMode: "total",
      includeTypes: new Set<AccountType>(["asset", "liability", "equity"]),
      excludedEntryIds,
    });

    const trialRows = accounts
      .map((account) => {
        const balance = trialBalances.get(account._id) ?? { debitMinor: 0, creditMinor: 0 };
        const debitCredit = debitCreditBalance(balance);
        return {
          id: account._id,
          accountNumber: account.number,
          label: account.name,
          accountType: account.type,
          debitMinor: debitCredit.debitMinor,
          creditMinor: debitCredit.creditMinor,
        };
      })
      .filter((row) => row.debitMinor !== 0 || row.creditMinor !== 0)
      .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
    const totalDebitMinor = trialRows.reduce((sum, row) => sum + row.debitMinor, 0);
    const totalCreditMinor = trialRows.reduce((sum, row) => sum + row.creditMinor, 0);

    const cashAccountIds = new Set(
      accounts
        .filter((account) => account.type === "asset" && (CASH_SUBTYPES.has(account.subtype) || bankAccounts.some((bank) => bank.ledgerAccountId === account._id)))
        .map((account) => account._id),
    );
    function cashBalance(map: Map<Id<"ledgerAccounts">, Balance>) {
      let total = 0;
      for (const accountId of cashAccountIds) {
        const account = accountsById.get(accountId);
        const balance = map.get(accountId);
        if (account && balance) total += normalBalance(account, balance);
      }
      return total;
    }

    const cashFlowGroups = new Map<
      "operating" | "investing" | "financing",
      { key: "operating" | "investing" | "financing"; label: string; totalMinor: number; rows: ReportLine[] }
    >([
      ["operating", { key: "operating", label: "Operating", totalMinor: 0, rows: [] }],
      ["investing", { key: "investing", label: "Investing", totalMinor: 0, rows: [] }],
      ["financing", { key: "financing", label: "Financing", totalMinor: 0, rows: [] }],
    ]);
    for (const line of lines) {
      if (!cashAccountIds.has(line.accountId) || excludedEntryIds.has(line.entryId)) continue;
      const entry = entriesById.get(line.entryId);
      const account = accountsById.get(line.accountId);
      if (!entry || !account || !entryInRange(entry, args.startDate, args.endDate)) continue;
      const related = lines
        .filter((candidate) => candidate.entryId === line.entryId && candidate.accountId !== line.accountId)
        .map((candidate) => accountsById.get(candidate.accountId))
        .find((candidate): candidate is Doc<"ledgerAccounts"> => Boolean(candidate));
      const groupKey =
        related && OPERATING_TYPES.has(related.type)
          ? "operating"
          : related?.type === "asset"
            ? "investing"
            : "financing";
      const cashMovementMinor = line.debitMinor - line.creditMinor;
      const group = cashFlowGroups.get(groupKey)!;
      group.totalMinor += cashMovementMinor;
      group.rows.push({
        ...makeReportLine(entry, line, account),
        amountMinor: cashMovementMinor,
      });
    }
    const openingCashMinor = cashBalance(balanceBeforeStart);
    const netCashChangeMinor = [...cashFlowGroups.values()].reduce((sum, group) => sum + group.totalMinor, 0);
    const closingCashMinor = openingCashMinor + netCashChangeMinor;

    const arAging = buildAgingRows({
      contactsById,
      endDate: args.endDate,
      rows: invoices
        .filter((invoice) => invoice.status === "open" || invoice.status === "overdue")
        .map((invoice) => ({
          id: invoice._id,
          contactId: invoice.contactId,
          reference: invoice.number,
          dueDate: invoice.dueDate,
          totalMinor: invoice.totalMinor,
          amountPaidMinor: invoice.amountPaidMinor,
        })),
    });
    const apAging = buildAgingRows({
      contactsById,
      endDate: args.endDate,
      rows: bills
        .filter((bill) => bill.status === "open")
        .map((bill) => ({
          id: bill._id,
          contactId: bill.contactId,
          reference: `Bill ${bill.issueDate}`,
          dueDate: bill.dueDate,
          totalMinor: bill.totalMinor,
        })),
    });

    const expenseVendorTotals = new Map<string, { id: string; name: string; totalMinor: number }>();
    const incomeCustomerTotals = new Map<string, { id: string; name: string; totalMinor: number }>();
    for (const row of statementRows) {
      for (const drill of row.drillDown) {
        const entryId = drill.id.split(":")[0] as Id<"journalEntries">;
        const transaction = transactionsByEntryId.get(entryId);
        const contact = transaction?.contactId ? contactsById.get(transaction.contactId) : null;
        if (row.accountType === "expense") {
          if (!transaction && drill.source === "bill") continue;
          const key = contact?._id ?? transaction?.merchant ?? "Unassigned";
          const current = expenseVendorTotals.get(key) ?? {
            id: key,
            name: contact?.name ?? transaction?.merchant ?? "Unassigned",
            totalMinor: 0,
          };
          current.totalMinor += drill.amountMinor;
          expenseVendorTotals.set(key, current);
        }
        if (row.accountType === "income") {
          if (!transaction && drill.source === "invoice") continue;
          const key = contact?._id ?? transaction?.merchant ?? "Unassigned";
          const current = incomeCustomerTotals.get(key) ?? {
            id: key,
            name: contact?.name ?? transaction?.merchant ?? "Unassigned",
            totalMinor: 0,
          };
          current.totalMinor += drill.amountMinor;
          incomeCustomerTotals.set(key, current);
        }
      }
    }
    for (const invoice of invoices) {
      if (invoice.issueDate < args.startDate || invoice.issueDate > args.endDate) continue;
      const contact = contactsById.get(invoice.contactId);
      const current = incomeCustomerTotals.get(invoice.contactId) ?? {
        id: invoice.contactId,
        name: contact?.name ?? "Unassigned",
        totalMinor: 0,
      };
      if (!incomeCustomerTotals.has(invoice.contactId)) {
        current.totalMinor += invoice.totalMinor;
      }
      incomeCustomerTotals.set(invoice.contactId, current);
    }
    for (const bill of bills) {
      if (bill.issueDate < args.startDate || bill.issueDate > args.endDate) continue;
      const contact = contactsById.get(bill.contactId);
      const current = expenseVendorTotals.get(bill.contactId) ?? {
        id: bill.contactId,
        name: contact?.name ?? "Unassigned",
        totalMinor: 0,
      };
      if (!expenseVendorTotals.has(bill.contactId)) {
        current.totalMinor += bill.totalMinor;
      }
      expenseVendorTotals.set(bill.contactId, current);
    }

    const payrollRows = payrollRuns
      .filter((run) => run.period >= monthKey(args.startDate) && run.period <= monthKey(args.endDate))
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((run) => ({
        id: run._id,
        period: run.period,
        status: run.status,
        totalBaseMinor: run.totalBaseMinor,
      }));
    const payrollTotalMinor = payrollRows.reduce((sum, row) => sum + row.totalBaseMinor, 0);

    const journalEntries = entries
      .filter((entry) => entryInRange(entry, args.startDate, args.endDate) && !excludedEntryIds.has(entry._id))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((entry) => ({
        id: entry._id,
        date: entry.date,
        memo: entry.memo,
        source: entry.source,
        lines: lines
          .filter((line) => line.entryId === entry._id)
          .map((line) => {
            const account = accountsById.get(line.accountId);
            return {
              id: line._id,
              accountId: line.accountId,
              accountName: account?.name ?? "Unknown account",
              accountNumber: account?.number ?? "",
              debitMinor: line.debitMinor,
              creditMinor: line.creditMinor,
              currency: line.currency,
            };
          }),
      }));

    const comparison = compareRange(args.startDate, args.endDate, args.compare);

    return {
      entity: {
        id: entity._id,
        name: entity.name,
        currency: entity.currency,
      },
      controls: {
        startDate: args.startDate,
        endDate: args.endDate,
        basis: args.basis satisfies ReportBasis,
        compare: args.compare,
        columnMode: args.columnMode,
        comparison,
      },
      reportCards: reportCards(),
      monthlyReview: {
        month: monthKey(args.endDate),
        moneyInMinor: incomeMinor,
        moneyOutMinor: expenseMinor,
        netResultMinor: netIncomeMinor,
        owedToYouMinor: arAging.totalMinor,
        youOweMinor: apAging.totalMinor,
        payrollMinor: payrollTotalMinor,
        topCustomers: [...incomeCustomerTotals.values()].sort((a, b) => b.totalMinor - a.totalMinor).slice(0, 5),
        topExpenseCategories: expenseRows.slice(0, 5),
      },
      profitAndLoss: {
        incomeMinor,
        expenseMinor,
        netIncomeMinor,
        rows: statementRows,
        sections: [
          { key: "income", label: "Income", totalMinor: incomeMinor, rows: incomeRows },
          { key: "expense", label: "Expenses", totalMinor: expenseMinor, rows: expenseRows },
        ],
      },
      balanceSheet: {
        asOfDate: args.endDate,
        assetMinor,
        liabilityMinor,
        equityMinor,
        currentEarningsMinor,
        differenceMinor: balanceSheetDifferenceMinor,
        balanced: balanceSheetDifferenceMinor === 0,
        rows: balanceSheetRows,
        sections: [
          { key: "assets", label: "Assets", totalMinor: assetMinor, rows: balanceSheetRows.filter((row) => row.accountType === "asset") },
          {
            key: "liabilities",
            label: "Liabilities",
            totalMinor: liabilityMinor,
            rows: balanceSheetRows.filter((row) => row.accountType === "liability"),
          },
          { key: "equity", label: "Equity", totalMinor: equityMinor, rows: balanceSheetRows.filter((row) => row.accountType === "equity") },
        ],
      },
      cashFlow: {
        openingCashMinor,
        closingCashMinor,
        netCashChangeMinor,
        groups: [...cashFlowGroups.values()],
      },
      arAging,
      apAging,
      expenses: {
        byCategory: expenseRows,
        byVendor: [...expenseVendorTotals.values()].sort((a, b) => b.totalMinor - a.totalMinor),
      },
      incomeByCustomer: {
        rows: [...incomeCustomerTotals.values()].sort((a, b) => b.totalMinor - a.totalMinor),
        totalMinor: [...incomeCustomerTotals.values()].reduce((sum, row) => sum + row.totalMinor, 0),
      },
      payrollSummary: {
        totalMinor: payrollTotalMinor,
        rows: payrollRows,
      },
      generalLedger: {
        rows: statementRows.flatMap((row) => row.drillDown),
      },
      trialBalance: {
        rows: trialRows,
        totalDebitMinor,
        totalCreditMinor,
        differenceMinor: totalDebitMinor - totalCreditMinor,
      },
      journal: {
        entries: journalEntries,
      },
      limits: {
        reportLimit: REPORT_LIMIT,
        rowCounts: {
          ledgerAccounts: accounts.length,
          journalEntries: entries.length,
          journalLines: lines.length,
          transactions: transactions.length,
          invoices: invoices.length,
          bills: bills.length,
          payrollRuns: payrollRuns.length,
          contacts: contacts.length,
          bankAccounts: bankAccounts.length,
          totalRows:
            accounts.length +
            entries.length +
            lines.length +
            transactions.length +
            invoices.length +
            bills.length +
            payrollRuns.length +
            contacts.length +
            bankAccounts.length,
        },
        truncated:
          accounts.length >= REPORT_LIMIT ||
          entries.length >= REPORT_LIMIT ||
          lines.length >= REPORT_LIMIT ||
          transactions.length >= REPORT_LIMIT,
      },
    };
  }
}

/**
 * Internal report pack keyed by an explicit entityId, with no user-session
 * check. Only the Ask AI agent's read tools call this, passing the entityId
 * resolved from the thread's ownership row (the authorization boundary).
 */
export const reportPackForEntity = internalQuery({
  args: {
    entityId: v.id("entities"),
    startDate: v.string(),
    endDate: v.string(),
    basis: reportBasisValidator,
    compare: compareValidator,
    columnMode: columnModeValidator,
  },
  handler: async (ctx, args) => {
    if (args.startDate > args.endDate) {
      throw new Error("Report start date must be before the end date.");
    }
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      return emptyReportPack(args);
    }
    return await buildReportPackForEntity(ctx, entity, args);
  },
});
