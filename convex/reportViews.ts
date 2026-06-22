import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import { getActiveEntity } from "./activeEntity";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";
import { assertScopeAuthorized, scopeValidator, type Scope } from "./entityScope";
import { sumUsdMinor } from "./portfolioMoney";
import { computeUnreviewedGap } from "./unreviewedGap";

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
  // E1-T9: the contact attributed to THIS journal line (preferred over the
  // transaction's contactId in the customer/vendor rollup). Optional — older
  // postings predate the line-level write.
  contactId?: string;
  entryId: string;
};

const CASH_SUBTYPES = new Set(["bank", "cash", "checking", "savings"]);
const OPERATING_TYPES = new Set<AccountType>(["income", "expense"]);
const REPORT_LIMIT = 5000;
// Cap journal loading by ENTRY (not by flat row), so we never truncate a report
// mid-entry and leave one side of a balanced posting out. A report can address
// at most this many distinct journal entries before `limits.truncated` flips —
// their lines are then loaded together, whole-entry, by the `by_entry` index.
const REPORT_ENTRY_LIMIT = 20000;

/**
 * Load every journal entry dated on/before `endDate` (date-ordered) plus all of
 * their lines, loaded whole-entry via the `by_entry` index so an entry's debit
 * and credit legs are ALWAYS loaded together — never split by a flat `.take`
 * cap (E1-T5 / RC5). Returns `truncated: true` only when an in-range entry was
 * actually excluded by the entry cap, not merely when the row count is large.
 */
async function loadJournalThroughDate(
  ctx: QueryCtx,
  entityId: Id<"entities">,
  endDate: string,
): Promise<{ entries: Doc<"journalEntries">[]; lines: Doc<"journalLines">[]; truncated: boolean }> {
  // One extra entry past the cap lets us detect "an in-range entry was excluded"
  // without a second query: if we got back more than the cap, the report is
  // genuinely truncated (and we drop the overflow entry so we never load a
  // partial picture).
  const fetched = await ctx.db
    .query("journalEntries")
    .withIndex("by_entity_and_date", (q) => q.eq("entityId", entityId).lte("date", endDate))
    .take(REPORT_ENTRY_LIMIT + 1);
  const truncated = fetched.length > REPORT_ENTRY_LIMIT;
  const entries = truncated ? fetched.slice(0, REPORT_ENTRY_LIMIT) : fetched;

  // Load each retained entry's lines whole-entry. The `by_entry` index keeps a
  // single entry's lines contiguous so debit/credit legs always arrive
  // together; lines-per-entry is inherently bounded (a posting has a small fixed
  // number of legs), so `.collect()` here is safe at scale.
  const lineGroups = await Promise.all(
    entries.map((entry) =>
      ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", entry._id)).collect(),
    ),
  );
  const lines = lineGroups.flat();
  return { entries, lines, truncated };
}

// Thin wrapper over the shared E11-T1 resolver so reportViews shares ONE
// active-entity contract with every other section view (no demo-slug fallback,
// cross-workspace + cross-demo rejection). Kept named `getEntity` so the many
// in-file call sites are unchanged.
async function getEntity(ctx: QueryCtx, entityId?: Id<"entities">) {
  return getActiveEntity(ctx, entityId);
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
    payrollSummary: { totalMinor: 0, baseCurrency: "USD", headcount: 0, hasFx: false, byCurrency: [], rows: [] },
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
    // E1-T8: unreviewed-and-excluded backlog (count + abs $); empty pack has none.
    unreviewed: { unreviewedCount: 0, unreviewedAbsMinor: 0 },
    // E6-T5: no open AR/AP in an empty pack.
    cashBasisExcluded: { count: 0, amountMinor: 0 },
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
    contactId: line.contactId,
    entryId: String(entry._id),
  };
}

// E6-T4: a DrillLine for an OPEN invoice/bill that hasn't posted to the ledger
// yet (so its accrued face value stays drillable). It is shaped like a real
// journal line (same fields the DrillSheet renders) but carries no entry/account
// — `entryId` is the synthetic document id so the row key stays unique.
function makeDocumentDrillLine(args: {
  docId: string;
  date: string;
  memo: string;
  accountName: string;
  amountMinor: number;
  currency: string;
}): ReportLine {
  return {
    id: `doc:${args.docId}`,
    date: args.date,
    memo: args.memo,
    source: "manual",
    accountName: args.accountName,
    accountNumber: "",
    debitMinor: args.amountMinor >= 0 ? args.amountMinor : 0,
    creditMinor: args.amountMinor < 0 ? Math.abs(args.amountMinor) : 0,
    amountMinor: args.amountMinor,
    currency: args.currency,
    entryId: `doc:${args.docId}`,
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

// E6-T4: turn an aging report's per-contact `items` (open invoices/bills) into a
// `drillDown: ReportLine[]` on each row, so a clicked aging total opens the exact
// documents behind it. The bucket figures and totals are untouched (additive).
function withAgingDrill(
  report: ReturnType<typeof buildAgingRows>,
  docLabel: "Invoice" | "Bill",
) {
  return {
    ...report,
    rows: report.rows.map((row) => ({
      ...row,
      drillDown: row.items
        .slice()
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .map((item) =>
          makeDocumentDrillLine({
            docId: item.id,
            date: item.dueDate,
            memo: `${docLabel} ${item.reference}`,
            accountName: row.name,
            amountMinor: item.amountMinor,
            currency: "USD",
          }),
        ),
    })),
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
    // Portfolio scope (Epic E5-T7). When `scope='all'`, the pack is CONSOLIDATED
    // across every active entity in the caller's workspace and confirmed
    // intercompany pairs are eliminated at read time. `entityId` (single-entity)
    // is unchanged — its output is byte-for-byte identical to before.
    scope: v.optional(scopeValidator),
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

    // Consolidated portfolio path (E5-T7). Authz: the entity set is derived
    // strictly from the caller's membership.workspaceId via assertScopeAuthorized
    // (never a client list), and each per-entity report is built only after a
    // workspace-role check — see entityScope.ts authz contract.
    if (args.scope === "all") {
      const { membership } = await requireAnyWorkspaceRole(ctx, "member");
      const entities = await assertScopeAuthorized(ctx, membership, "all");
      return await buildConsolidatedReportPack(ctx, entities, args);
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
  // Consolidation hook (E5-T7). When provided (scope='all'), the journal entries
  // belonging to CONFIRMED intercompany transactions whose BOTH legs are in scope
  // are excluded from this entity's statements so an internal Zikra→Z360 move is
  // not counted as group revenue/expense. The eliminated income+expense amount is
  // accumulated into `eliminationTracker` so the consolidated pack can render an
  // explicit 'Intercompany eliminated' line. Single-entity calls pass nothing, so
  // their output is byte-for-byte unchanged (legal separation preserved).
  options?: {
    intercompanyExcludedEntryIds: Set<Id<"journalEntries">>;
    eliminationTracker: { incomeMinor: number; expenseMinor: number };
  },
) {
  {
    // Journal entries + lines load whole-entry (date-ordered, capped by entry),
    // so a report never drops one leg of a balanced posting (E1-T5 / RC5). The
    // remaining tables stay on their existing per-entity caps.
    const [journal, accounts, transactions, invoices, bills, payrollRuns, payrollRunLines, contacts, bankAccounts] =
      await Promise.all([
        loadJournalThroughDate(ctx, entity._id, args.endDate),
        ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(REPORT_LIMIT),
        ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(REPORT_LIMIT),
        ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(REPORT_LIMIT),
        ctx.db.query("bills").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(REPORT_LIMIT),
        ctx.db.query("payrollRuns").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(REPORT_LIMIT),
        ctx.db.query("payrollRunLines").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(REPORT_LIMIT),
        ctx.db.query("contacts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(REPORT_LIMIT),
        ctx.db.query("bankAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(REPORT_LIMIT),
      ]);
    const { entries, lines } = journal;

    const columns = buildColumns(args.startDate, args.endDate, args.columnMode);
    const accountsById = new Map(accounts.map((account) => [account._id, account]));
    const entriesById = new Map(entries.map((entry) => [entry._id, entry]));
    const contactsById = new Map(contacts.map((contact) => [contact._id, contact]));
    const transactionsByEntryId = new Map(
      transactions.flatMap((transaction) => (transaction.entryId ? [[transaction.entryId, transaction] as const] : [])),
    );
    const unsettledEntryIds = new Set<Id<"journalEntries">>();
    // E6-T5: honest count + absolute $ of the open AR/AP that CASH basis drops.
    // The "excluded" amount is each open document's remaining balance (face value
    // minus what's been paid), so the badge can state exactly what the cash view
    // is hiding. Computed for every basis (it describes what cash WOULD exclude),
    // but the UI only surfaces it when basis=cash.
    let cashBasisExcludedCount = 0;
    let cashBasisExcludedAbsMinor = 0;
    for (const invoice of invoices) {
      if (invoice.status === "open" || invoice.status === "overdue") {
        for (const entryId of invoice.entryIds) unsettledEntryIds.add(entryId);
        cashBasisExcludedCount += 1;
        cashBasisExcludedAbsMinor += Math.abs(invoice.totalMinor - invoice.amountPaidMinor);
      }
    }
    for (const bill of bills) {
      if (bill.status === "open") {
        for (const entryId of bill.entryIds) unsettledEntryIds.add(entryId);
        cashBasisExcludedCount += 1;
        // Bills have no partial-payment field — an open bill is fully unpaid.
        cashBasisExcludedAbsMinor += Math.abs(bill.totalMinor);
      }
    }
    const excludedEntryIds = args.basis === "cash" ? unsettledEntryIds : new Set<Id<"journalEntries">>();

    // Consolidation: track and exclude confirmed intercompany entries so the
    // group P&L never counts an internal transfer as revenue/expense (E5-T7).
    // We accumulate the income+expense the elimination removed BEFORE folding the
    // exclusion into `excludedEntryIds`, so the consolidated pack can show it as
    // an explicit 'Intercompany eliminated: −$X' line.
    if (options) {
      for (const line of lines) {
        if (!options.intercompanyExcludedEntryIds.has(line.entryId)) continue;
        const entry = entriesById.get(line.entryId);
        const account = accountsById.get(line.accountId);
        if (!entry || !account || !entryInRange(entry, args.startDate, args.endDate)) continue;
        if (excludedEntryIds.has(line.entryId)) continue; // already out (cash-basis)
        if (account.type === "income") {
          options.eliminationTracker.incomeMinor += reportAmountForLine(account, line);
        } else if (account.type === "expense") {
          options.eliminationTracker.expenseMinor += reportAmountForLine(account, line);
        }
      }
      for (const entryId of options.intercompanyExcludedEntryIds) excludedEntryIds.add(entryId);
    }

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
    // E6-T6: when compare != none, run a SECOND statement pass over the
    // comparison window (already loaded — every comparison entry is dated <=
    // endDate) and attach an additive `priorTotalMinor` per account row so the UI
    // can render a prior column + signed delta. Default (compare=none) packs are
    // byte-for-byte unchanged: no prior pass runs and no field is added.
    const comparisonForRows = compareRange(args.startDate, args.endDate, args.compare);
    const priorTotalByAccount = new Map<string, number>();
    if (comparisonForRows) {
      const priorRows = buildStatementRows({
        accounts,
        lines,
        entriesById,
        startDate: comparisonForRows.startDate,
        endDate: comparisonForRows.endDate,
        columns: [{ key: "Total", label: "Total" }],
        columnMode: "total",
        includeTypes: new Set<AccountType>(["income", "expense"]),
        excludedEntryIds,
      });
      for (const row of priorRows) priorTotalByAccount.set(row.id, row.totalMinor);
    }
    // Stamp prior totals (and delta) onto the current statement rows. A row with
    // no prior activity reads priorTotalMinor: 0 so the delta is the full current.
    // The fields are always present in the row SHAPE (optional) so the row type
    // stays uniform; they're only POPULATED when a comparison window exists.
    const withPrior: Array<
      (typeof statementRows)[number] & { priorTotalMinor?: number; deltaMinor?: number }
    > = comparisonForRows
      ? statementRows.map((row) => {
          const priorTotalMinor = priorTotalByAccount.get(row.id) ?? 0;
          return { ...row, priorTotalMinor, deltaMinor: row.totalMinor - priorTotalMinor };
        })
      : statementRows.map((row) => ({ ...row }));

    const incomeRows = withPrior.filter((row) => row.accountType === "income");
    const expenseRows = withPrior.filter((row) => row.accountType === "expense");
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

    // Cash-flow classification is per-ENTRY, not per-line (E1-T6 / RC). For each
    // entry that touches cash we look at the FULL set of non-cash counter-lines
    // (not a single arbitrary related line), net the entry's cash movement once,
    // and:
    //   - DROP cash↔cash self-transfers entirely (checking→savings, payout
    //     deposit between the entity's own accounts) — zero net cash to the
    //     business, so showing each leg would inflate operating/financing;
    //   - allocate a split entry's single cash movement across groups by the
    //     counter-line amounts, summing exactly to the cash leg;
    //   - classify by precedence: any income/expense counter → operating; else
    //     any non-cash asset → investing; else (liability/equity) → financing.
    const linesByEntryForCash = new Map<Id<"journalEntries">, Doc<"journalLines">[]>();
    for (const line of lines) {
      const bucket = linesByEntryForCash.get(line.entryId);
      if (bucket) bucket.push(line);
      else linesByEntryForCash.set(line.entryId, [line]);
    }
    function classifyCounter(type: AccountType): "operating" | "investing" | "financing" {
      if (OPERATING_TYPES.has(type)) return "operating";
      if (type === "asset") return "investing";
      return "financing";
    }
    for (const [entryId, entryLines] of linesByEntryForCash.entries()) {
      if (excludedEntryIds.has(entryId)) continue;
      const entry = entriesById.get(entryId);
      if (!entry || !entryInRange(entry, args.startDate, args.endDate)) continue;
      const cashLines = entryLines.filter((line) => cashAccountIds.has(line.accountId));
      if (cashLines.length === 0) continue;
      const counterLines = entryLines.filter((line) => !cashAccountIds.has(line.accountId));

      // Self-transfer between two of the entity's own cash accounts: no real
      // cash counter-line, so the whole entry nets to zero — skip it.
      if (counterLines.length === 0) continue;

      const cashMovementMinor = cashLines.reduce((sum, line) => sum + (line.debitMinor - line.creditMinor), 0);
      if (cashMovementMinor === 0) continue;

      // Representative cash line (for the drill-down row label) and its account.
      const primaryCashLine = cashLines[0];
      const cashAccount = accountsById.get(primaryCashLine.accountId);
      if (!cashAccount) continue;

      // Allocate the single cash movement across the counter-lines by their
      // absolute weight, so a split contributes its cash leg exactly once. The
      // last allocation absorbs any rounding remainder so the group totals sum
      // back to cashMovementMinor exactly.
      const counterWeights = counterLines.map((line) => {
        const account = accountsById.get(line.accountId);
        const weight = Math.abs(line.debitMinor - line.creditMinor);
        return { account, weight };
      });
      const totalWeight = counterWeights.reduce((sum, c) => sum + c.weight, 0);
      let allocated = 0;
      counterWeights.forEach((counter, index) => {
        if (!counter.account) return;
        const isLast = index === counterWeights.length - 1;
        const share = isLast
          ? cashMovementMinor - allocated
          : totalWeight > 0
            ? Math.round((cashMovementMinor * counter.weight) / totalWeight)
            : Math.round(cashMovementMinor / counterWeights.length);
        allocated += share;
        if (share === 0) return;
        const groupKey = classifyCounter(counter.account.type);
        const group = cashFlowGroups.get(groupKey)!;
        group.totalMinor += share;
        group.rows.push({
          ...makeReportLine(entry, primaryCashLine, cashAccount),
          amountMinor: share,
        });
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

    // income-by-customer / expense-by-vendor — single source of truth (E1-T7 / RC).
    //
    // The rollup is derived FIRST from posted income/expense journal lines (the
    // ledger is the only truth), attributing each line to a contact preferring the
    // LINE's own contactId (E1-T9) and falling back to the matched transaction's
    // contactId, then the merchant name. This sum equals the P&L income/expense
    // total for the period BY CONSTRUCTION (both come from the same statementRows).
    //
    // We then add a document's FACE VALUE only when NONE of that document's
    // entryIds already contributed to the rollup — i.e. an open invoice/bill whose
    // accrual recognition is NOT yet on the ledger for this period. The de-dup is
    // keyed on the document's entryIds (decisions / DoD), not a coarse
    // "contact already present" check, so an invoice that is BOTH posted-to-ledger
    // AND open is counted exactly once and a customer's second open invoice is not
    // dropped.
    // E6-T4: each rollup row carries its supporting `drillDown` lines so a
    // clicked Income-by-Customer / Expenses-by-Vendor amount opens the exact
    // journal (or open-document face-value) lines whose sum equals the figure.
    const expenseVendorTotals = new Map<
      string,
      { id: string; name: string; totalMinor: number; drillDown: ReportLine[] }
    >();
    const incomeCustomerTotals = new Map<
      string,
      { id: string; name: string; totalMinor: number; drillDown: ReportLine[] }
    >();
    // Every journal entryId that already contributed an income/expense amount to a
    // rollup row — used to de-dup a document's face-value add.
    const rolledUpEntryIds = new Set<string>();
    for (const row of statementRows) {
      for (const drill of row.drillDown) {
        rolledUpEntryIds.add(drill.entryId);
        const transaction = transactionsByEntryId.get(drill.entryId as Id<"journalEntries">);
        // Prefer the line's own contact (E1-T9), then the matched transaction's.
        const contactId = drill.contactId ?? (transaction?.contactId ? String(transaction.contactId) : undefined);
        const contact = contactId ? contactsById.get(contactId as Id<"contacts">) : null;
        const target = row.accountType === "expense" ? expenseVendorTotals : row.accountType === "income" ? incomeCustomerTotals : null;
        if (!target) continue;
        const key = contact?._id ?? transaction?.merchant ?? "Unassigned";
        const current = target.get(key) ?? {
          id: key,
          name: contact?.name ?? transaction?.merchant ?? "Unassigned",
          totalMinor: 0,
          drillDown: [],
        };
        current.totalMinor += drill.amountMinor;
        // E6-T4: the contributing journal line, so the customer/vendor amount
        // drills to the exact ledger lines that sum to it.
        current.drillDown.push(drill);
        target.set(key, current);
      }
    }
    for (const invoice of invoices) {
      if (invoice.issueDate < args.startDate || invoice.issueDate > args.endDate) continue;
      // Skip the face-value add if ANY of this invoice's entries already posted
      // income into the rollup this period (no double-count).
      if (invoice.entryIds.some((entryId) => rolledUpEntryIds.has(String(entryId)))) continue;
      const contact = contactsById.get(invoice.contactId);
      const key = String(invoice.contactId);
      const current = incomeCustomerTotals.get(key) ?? {
        id: key,
        name: contact?.name ?? "Unassigned",
        totalMinor: 0,
        drillDown: [],
      };
      current.totalMinor += invoice.totalMinor;
      // E6-T4: a synthetic drill line for the open invoice's accrued face value,
      // so the amount remains drillable even before it posts to the ledger.
      current.drillDown.push(
        makeDocumentDrillLine({
          docId: String(invoice._id),
          date: invoice.issueDate,
          memo: `Invoice ${invoice.number}`,
          accountName: contact?.name ?? "Open invoice",
          amountMinor: invoice.totalMinor,
          currency: invoice.currency,
        }),
      );
      incomeCustomerTotals.set(key, current);
    }
    for (const bill of bills) {
      if (bill.issueDate < args.startDate || bill.issueDate > args.endDate) continue;
      if (bill.entryIds.some((entryId) => rolledUpEntryIds.has(String(entryId)))) continue;
      const contact = contactsById.get(bill.contactId);
      const key = String(bill.contactId);
      const current = expenseVendorTotals.get(key) ?? {
        id: key,
        name: contact?.name ?? "Unassigned",
        totalMinor: 0,
        drillDown: [],
      };
      current.totalMinor += bill.totalMinor;
      current.drillDown.push(
        makeDocumentDrillLine({
          docId: String(bill._id),
          date: bill.issueDate,
          memo: `Bill ${bill.issueDate}`,
          accountName: contact?.name ?? "Open bill",
          amountMinor: bill.totalMinor,
          currency: bill.currency,
        }),
      );
      expenseVendorTotals.set(key, current);
    }

    const inRangePayrollRuns = payrollRuns
      .filter((run) => run.period >= monthKey(args.startDate) && run.period <= monthKey(args.endDate))
      .sort((a, b) => a.period.localeCompare(b.period));
    const inRangeRunIds = new Set(inRangePayrollRuns.map((run) => run._id));
    const inRangeLines = payrollRunLines.filter((line) => inRangeRunIds.has(line.runId));

    // Per-currency rollup (local currency totals) + headcount (distinct people
    // across the in-range runs) + whether any line needed FX conversion. This
    // restores the prototype's multi-currency Payroll Summary: a USD-base shop
    // with PKR contractors should see both currency totals and an FX note rather
    // than a single flattened base figure.
    const payrollCurrencyTotals = new Map<string, { currency: string; localMinor: number; baseMinor: number }>();
    const payrollPeople = new Set<string>();
    let payrollHasFx = false;
    for (const line of inRangeLines) {
      const bucket = payrollCurrencyTotals.get(line.currency) ?? {
        currency: line.currency,
        localMinor: 0,
        baseMinor: 0,
      };
      bucket.localMinor += line.finalLocalMinor;
      bucket.baseMinor += line.baseEquivalentMinor;
      payrollCurrencyTotals.set(line.currency, bucket);
      payrollPeople.add(line.employeeId ? String(line.employeeId) : `name:${line.employeeName}`);
      if (line.currency !== entity.currency) payrollHasFx = true;
    }

    // E6-T4: each payroll period total drills to that run's per-person lines.
    const linesByRun = new Map<Id<"payrollRuns">, typeof inRangeLines>();
    for (const line of inRangeLines) {
      const bucket = linesByRun.get(line.runId);
      if (bucket) bucket.push(line);
      else linesByRun.set(line.runId, [line]);
    }
    const payrollRows = inRangePayrollRuns.map((run) => ({
      id: run._id,
      period: run.period,
      status: run.status,
      totalBaseMinor: run.totalBaseMinor,
      drillDown: (linesByRun.get(run._id) ?? []).map((line) =>
        makeDocumentDrillLine({
          docId: String(line._id),
          date: `${run.period}-01`,
          memo: line.employeeName,
          accountName: `Payroll · ${run.period}`,
          amountMinor: line.baseEquivalentMinor,
          currency: entity.currency,
        }),
      ),
    }));
    const payrollTotalMinor = payrollRows.reduce((sum, row) => sum + row.totalBaseMinor, 0);
    const payrollByCurrency = [...payrollCurrencyTotals.values()].sort((a, b) =>
      a.currency === entity.currency ? -1 : b.currency === entity.currency ? 1 : a.currency.localeCompare(b.currency),
    );

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

    // E1-T8: the unreviewed-and-excluded backlog for this entity, from the SAME
    // shared helper the dashboard uses, so both surfaces show identical numbers.
    const unreviewedGap = await computeUnreviewedGap(ctx, [entity._id]);

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
        // E6-T6: `withPrior` carries the additive priorTotalMinor/deltaMinor when
        // compare != none (identical to statementRows otherwise).
        rows: withPrior,
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
      // E6-T4: attach a DrillLine[] to each aging row (built from the per-contact
      // open documents already gathered in `items`) so a clicked aging total opens
      // the invoices/bills behind it. Additive — `rows`/`buckets`/`totalMinor` are
      // unchanged.
      arAging: withAgingDrill(arAging, "Invoice"),
      apAging: withAgingDrill(apAging, "Bill"),
      expenses: {
        byCategory: expenseRows,
        byVendor: [...expenseVendorTotals.values()]
          .map((row) => ({ ...row, drillDown: row.drillDown.sort((a, b) => a.date.localeCompare(b.date)) }))
          .sort((a, b) => b.totalMinor - a.totalMinor),
      },
      incomeByCustomer: {
        rows: [...incomeCustomerTotals.values()]
          .map((row) => ({ ...row, drillDown: row.drillDown.sort((a, b) => a.date.localeCompare(b.date)) }))
          .sort((a, b) => b.totalMinor - a.totalMinor),
        totalMinor: [...incomeCustomerTotals.values()].reduce((sum, row) => sum + row.totalMinor, 0),
      },
      payrollSummary: {
        totalMinor: payrollTotalMinor,
        baseCurrency: entity.currency,
        headcount: payrollPeople.size,
        hasFx: payrollHasFx,
        byCurrency: payrollByCurrency,
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
        // True only when an in-range journal entry was actually excluded by the
        // entry cap (never on flat row count), so the report can never silently
        // contain an entry with only one of its lines present (E1-T5).
        truncated:
          journal.truncated ||
          accounts.length >= REPORT_LIMIT ||
          transactions.length >= REPORT_LIMIT,
      },
      // E1-T8: "N transactions ($X) are unreviewed and excluded from these
      // figures" — the same shape the dashboard renders, from the shared helper.
      unreviewed: unreviewedGap,
      // E6-T5: open AR/AP that a CASH-basis view drops. Always reported (it
      // describes what cash excludes); the UI shows it only when basis=cash.
      cashBasisExcluded: {
        count: cashBasisExcludedCount,
        amountMinor: cashBasisExcludedAbsMinor,
      },
    };
  }
}

type EntityReportPack = Awaited<ReturnType<typeof buildReportPackForEntity>>;
type StatementSection = EntityReportPack["profitAndLoss"]["sections"][number];
type StatementRowOut = StatementSection["rows"][number];

/**
 * Merge per-entity statement rows by account NUMBER+type+name into one
 * consolidated set: same-coded accounts across entities sum their totals and
 * per-column figures and concatenate drill-downs (USD-only — plain summation,
 * decisions Q32). Distinct codes stay distinct. Sorted by account number.
 */
function mergeStatementRows(rowGroups: StatementRowOut[][]): StatementRowOut[] {
  const byKey = new Map<string, StatementRowOut>();
  for (const rows of rowGroups) {
    for (const row of rows) {
      const key = `${row.accountType}:${row.accountNumber}:${row.label}`;
      const existing = byKey.get(key);
      if (!existing) {
        // Clone so we never mutate a per-entity pack's array.
        byKey.set(key, {
          ...row,
          columns: row.columns.map((column) => ({ ...column })),
          drillDown: [...row.drillDown],
        });
        continue;
      }
      existing.totalMinor += row.totalMinor;
      const columnByKey = new Map(existing.columns.map((column) => [column.key, column]));
      for (const column of row.columns) {
        const target = columnByKey.get(column.key);
        if (target) target.amountMinor += column.amountMinor;
        else existing.columns.push({ ...column });
      }
      existing.drillDown.push(...row.drillDown);
    }
  }
  return [...byKey.values()].sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
}

/**
 * Consolidated report pack across every active entity in the workspace (E5-T7).
 *
 * Builds each entity's existing single-entity report (reusing the same code
 * path), eliminating CONFIRMED intercompany pairs whose BOTH legs are in scope at
 * READ time (no stored elimination journals — posted lines are immutable), then
 * merges the per-entity statements by account code in USD (plain summation). The
 * eliminated income+expense is emitted as an explicit line and reduces the
 * consolidated total. Single-entity (legal) reports are UNCHANGED — Due-from/
 * Due-to (1310/2310) stay on each entity's books; elimination applies only to
 * consolidated output.
 */
async function buildConsolidatedReportPack(
  ctx: QueryCtx,
  entities: Doc<"entities">[],
  args: ReportPackArgs,
) {
  const base = emptyReportPack(args);
  if (entities.length === 0) {
    return {
      ...base,
      consolidatedFrom: [],
      eliminatedMinor: 0,
      eliminatedIncomeMinor: 0,
      eliminatedExpenseMinor: 0,
    };
  }

  const ordered = entities
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id));
  const inScopeEntityIds = new Set(ordered.map((entity) => String(entity._id)));

  // Confirmed intercompany pairs in this workspace whose BOTH legs are in scope.
  // Each leg's journal entry (transaction.entryId) is excluded from its entity's
  // statements. Keyed per entity so each pack excludes only its own entries.
  const workspaceId = ordered[0]!.workspaceId;
  const confirmedLinks = await ctx.db
    .query("intercompanyLinks")
    .withIndex("by_status", (q) => q.eq("workspaceId", workspaceId).eq("status", "confirmed"))
    .take(2000);
  const excludedByEntity = new Map<string, Set<Id<"journalEntries">>>();
  for (const entity of ordered) excludedByEntity.set(String(entity._id), new Set());
  for (const link of confirmedLinks) {
    if (!inScopeEntityIds.has(String(link.fromEntityId))) continue;
    if (!inScopeEntityIds.has(String(link.toEntityId))) continue;
    const [fromTxn, toTxn] = await Promise.all([ctx.db.get(link.fromTxnId), ctx.db.get(link.toTxnId)]);
    if (fromTxn?.entryId) excludedByEntity.get(String(link.fromEntityId))?.add(fromTxn.entryId);
    if (toTxn?.entryId) excludedByEntity.get(String(link.toEntityId))?.add(toTxn.entryId);
  }

  const eliminationTracker = { incomeMinor: 0, expenseMinor: 0 };
  const packs: EntityReportPack[] = [];
  for (const entity of ordered) {
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");
    packs.push(
      await buildReportPackForEntity(ctx, entity, args, {
        intercompanyExcludedEntryIds: excludedByEntity.get(String(entity._id)) ?? new Set(),
        eliminationTracker,
      }),
    );
  }

  // ---- Merge P&L sections (income + expense) by account code.
  const incomeRows = mergeStatementRows(
    packs.map((pack) => pack.profitAndLoss.sections.find((section) => section.key === "income")?.rows ?? []),
  );
  const expenseRows = mergeStatementRows(
    packs.map((pack) => pack.profitAndLoss.sections.find((section) => section.key === "expense")?.rows ?? []),
  );
  const incomeMinor = sumUsdMinor(incomeRows.map((row) => row.totalMinor));
  const expenseMinor = sumUsdMinor(expenseRows.map((row) => row.totalMinor));
  const netIncomeMinor = incomeMinor - expenseMinor;

  // ---- Merge Balance Sheet sections.
  const assetRows = mergeStatementRows(
    packs.map((pack) => pack.balanceSheet.sections.find((section) => section.key === "assets")?.rows ?? []),
  );
  const liabilityRows = mergeStatementRows(
    packs.map((pack) => pack.balanceSheet.sections.find((section) => section.key === "liabilities")?.rows ?? []),
  );
  const equityRows = mergeStatementRows(
    packs.map((pack) => pack.balanceSheet.sections.find((section) => section.key === "equity")?.rows ?? []),
  );
  const assetMinor = sumUsdMinor(packs.map((pack) => pack.balanceSheet.assetMinor));
  const liabilityMinor = sumUsdMinor(packs.map((pack) => pack.balanceSheet.liabilityMinor));
  const equityMinor = sumUsdMinor(packs.map((pack) => pack.balanceSheet.equityMinor));
  const currentEarningsMinor = sumUsdMinor(packs.map((pack) => pack.balanceSheet.currentEarningsMinor));
  const balanceSheetDifferenceMinor = assetMinor - (liabilityMinor + equityMinor + currentEarningsMinor);

  const eliminatedMinor = eliminationTracker.incomeMinor + eliminationTracker.expenseMinor;

  // Cash-flow + aging + payroll + trial balance: sum the scalar aggregates.
  const openingCashMinor = sumUsdMinor(packs.map((pack) => pack.cashFlow.openingCashMinor));
  const netCashChangeMinor = sumUsdMinor(packs.map((pack) => pack.cashFlow.netCashChangeMinor));
  const arTotalMinor = sumUsdMinor(packs.map((pack) => pack.arAging.totalMinor));
  const apTotalMinor = sumUsdMinor(packs.map((pack) => pack.apAging.totalMinor));
  const payrollTotalMinor = sumUsdMinor(packs.map((pack) => pack.payrollSummary.totalMinor));

  return {
    ...base,
    entity: {
      id: "",
      name: `All businesses (${ordered.length})`,
      currency: "USD",
    },
    reportCards: reportCards(),
    consolidatedFrom: ordered.map((entity) => entity._id),
    eliminatedMinor,
    eliminatedIncomeMinor: eliminationTracker.incomeMinor,
    eliminatedExpenseMinor: eliminationTracker.expenseMinor,
    monthlyReview: {
      ...base.monthlyReview,
      moneyInMinor: incomeMinor,
      moneyOutMinor: expenseMinor,
      netResultMinor: netIncomeMinor,
      owedToYouMinor: arTotalMinor,
      youOweMinor: apTotalMinor,
      payrollMinor: payrollTotalMinor,
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
      asOfDate: args.endDate,
      assetMinor,
      liabilityMinor,
      equityMinor,
      currentEarningsMinor,
      differenceMinor: balanceSheetDifferenceMinor,
      balanced: balanceSheetDifferenceMinor === 0,
      rows: [...assetRows, ...liabilityRows, ...equityRows],
      sections: [
        { key: "assets", label: "Assets", totalMinor: assetMinor, rows: assetRows },
        { key: "liabilities", label: "Liabilities", totalMinor: liabilityMinor, rows: liabilityRows },
        { key: "equity", label: "Equity", totalMinor: equityMinor, rows: equityRows },
      ],
    },
    cashFlow: {
      openingCashMinor,
      closingCashMinor: openingCashMinor + netCashChangeMinor,
      netCashChangeMinor,
      groups: base.cashFlow.groups,
    },
    arAging: { ...base.arAging, totalMinor: arTotalMinor },
    apAging: { ...base.apAging, totalMinor: apTotalMinor },
    payrollSummary: {
      ...base.payrollSummary,
      totalMinor: payrollTotalMinor,
      headcount: packs.reduce((sum, pack) => sum + pack.payrollSummary.headcount, 0),
    },
    incomeByCustomer: {
      rows: [],
      totalMinor: incomeMinor,
    },
    // E1-T8 + E5-T7: portfolio unreviewed gap = sum across every in-scope entity,
    // from the same per-entity helper, so the consolidated banner is accurate.
    unreviewed: {
      unreviewedCount: packs.reduce((sum, pack) => sum + pack.unreviewed.unreviewedCount, 0),
      unreviewedAbsMinor: sumUsdMinor(packs.map((pack) => pack.unreviewed.unreviewedAbsMinor)),
    },
    // E6-T5: open AR/AP that cash-basis drops, summed across in-scope entities.
    cashBasisExcluded: {
      count: packs.reduce((sum, pack) => sum + pack.cashBasisExcluded.count, 0),
      amountMinor: sumUsdMinor(packs.map((pack) => pack.cashBasisExcluded.amountMinor)),
    },
    limits: {
      reportLimit: REPORT_LIMIT,
      // Consolidated truncation = any per-entity report truncated (E5-T7: no
      // silent truncation — the flag surfaces if any entity hit the entry cap).
      truncated: packs.some((pack) => pack.limits.truncated),
      rowCounts: {
        ...base.limits.rowCounts,
        ledgerAccounts: packs.reduce((sum, pack) => sum + pack.limits.rowCounts.ledgerAccounts, 0),
        journalEntries: packs.reduce((sum, pack) => sum + pack.limits.rowCounts.journalEntries, 0),
        journalLines: packs.reduce((sum, pack) => sum + pack.limits.rowCounts.journalLines, 0),
        transactions: packs.reduce((sum, pack) => sum + pack.limits.rowCounts.transactions, 0),
        invoices: packs.reduce((sum, pack) => sum + pack.limits.rowCounts.invoices, 0),
        bills: packs.reduce((sum, pack) => sum + pack.limits.rowCounts.bills, 0),
        payrollRuns: packs.reduce((sum, pack) => sum + pack.limits.rowCounts.payrollRuns, 0),
        contacts: packs.reduce((sum, pack) => sum + pack.limits.rowCounts.contacts, 0),
        bankAccounts: packs.reduce((sum, pack) => sum + pack.limits.rowCounts.bankAccounts, 0),
        totalRows: packs.reduce((sum, pack) => sum + pack.limits.rowCounts.totalRows, 0),
      },
    },
  };
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

/**
 * Read-only period-lock state for the active entity, used by the Reports-home
 * "Close the books" banner. Resolves + authorizes the entity exactly like the
 * report pack (workspace member role), so it never exposes another workspace's
 * lock. The Close/reopen ACTION itself reuses the existing `ledger.setPeriodLock`
 * admin mutation; this query is purely a read.
 */
export const reportPeriodLock = query({
  args: {
    entityId: v.optional(v.id("entities")),
  },
  handler: async (ctx, args) => {
    const entity = await getEntity(ctx, args.entityId);
    if (!entity) {
      return { entityId: null as Id<"entities"> | null, lockedThroughDate: null as string | null };
    }
    const lock = await ctx.db
      .query("periodLocks")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .unique();
    return {
      entityId: entity._id,
      lockedThroughDate: lock?.lockedThroughDate ?? null,
    };
  },
});
