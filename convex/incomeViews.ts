import { v } from "convex/values";

import { getActiveEntity } from "./activeEntity";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";
import { assertScopeAuthorized, scopeValidator, type Scope } from "./entityScope";
import { buildAgingRows } from "./reportViews";

// Demo "today" / period bounds. These are only the FALLBACK when the client does
// not pass an explicit range; the screen drives the real period through `range`.
const TODAY = "2026-06-11";
const MONTH_START = "2026-06-01"; // first of the current (demo) month

function dateDiffDays(left: string, right: string) {
  return Math.floor((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000);
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

// Income ledger lines credit revenue (credit − debit), the SAME convention the
// report pack uses for income accounts (reportViews.reportAmountForLine). Reusing
// it is what keeps Streams / by-customer revenue reconciled with the P&L revenue
// section instead of recomputing a divergent total.
function revenueForLine(line: Doc<"journalLines">) {
  return line.creditMinor - line.debitMinor;
}

function isLikelyInternalTransfer(transaction: Doc<"transactions">) {
  if (transaction.transferPairId || transaction.intercompanyPairId) return true;
  const text = `${transaction.merchant} ${transaction.rawDescription}`.toLowerCase();
  return (
    text.includes("moving funds") ||
    text.includes("business checking - transfer") ||
    text.includes("moving fun; z360biz") ||
    text.includes("z360biz llc (mercury) - moving funds")
  );
}

const EMPTY = {
  entity: null,
  kpis: {
    receivedThisMonthMinor: 0,
    paymentCount: 0,
    reconciledPayoutCount: 0,
    stillOpenMinor: 0,
    openInvoiceCount: 0,
    overdueMinor: 0,
    overdueInvoiceCount: 0,
    oldestOverdueDays: 0,
    averageDaysToPay: 0,
    recurringMrrMinor: 0,
    recurringMrrMonthLabel: "",
    recurringCount: 0,
    mrrSparkline: [] as number[],
  },
  payments: [] as PaymentRow[],
  invoices: [] as InvoiceListRow[],
  invoiceCounts: { all: 0, draft: 0, open: 0, paid: 0, overdue: 0, void: 0 },
  receivables: { rows: [] as AgingMatrixRow[], totalMinor: 0, buckets: { currentMinor: 0, days30Minor: 0, days60Minor: 0, days90Minor: 0 } },
  customers: [] as CustomerRow[],
  streams: { rows: [] as StreamRow[], totalMinor: 0 },
};

type PaymentRow = {
  id: string;
  /** Set ONLY for real bank/stripe transactions — the underlying universal
   * register record to deep-link into (/transactions?focus=). Payouts are not a
   * single transaction, so this is undefined for them. */
  transactionId?: string;
  date: string;
  fromName: string;
  initials: string;
  memo: string;
  status: string;
  amountMinor: number;
  currency: string;
  kind: "payment" | "payout";
};
type InvoiceListRow = {
  id: string;
  number: string;
  customerName: string;
  customerId: string;
  issueDate: string;
  dueDate: string;
  status: string;
  totalMinor: number;
  balanceMinor: number;
  daysPastDue: number;
};
type AgingMatrixRow = {
  id: string;
  name: string;
  currentMinor: number;
  days30Minor: number;
  days60Minor: number;
  days90Minor: number;
  totalMinor: number;
};
type CustomerRow = {
  id: string;
  name: string;
  receivedMinor: number;
  openMinor: number;
  lastPaid: string | null;
  invoiceCount: number;
};
type StreamRow = {
  id: string;
  name: string;
  accountNumber: string;
  totalMinor: number;
};

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

async function resolveIncomeEntities(
  ctx: QueryCtx,
  args: { entityId?: Id<"entities">; scope?: Scope },
): Promise<{ entities: Doc<"entities">[]; isPortfolioScope: boolean }> {
  const isPortfolioScope = args.scope === "all" && !args.entityId;
  if (isPortfolioScope) {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const entities = await assertScopeAuthorized(ctx, membership, "all");
    for (const entity of entities) await requireWorkspaceRole(ctx, entity.workspaceId, "member");
    return { entities, isPortfolioScope };
  }
  if (args.scope && args.scope !== "all") {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const entities = await assertScopeAuthorized(ctx, membership, args.scope);
    for (const entity of entities) await requireWorkspaceRole(ctx, entity.workspaceId, "member");
    return { entities, isPortfolioScope: false };
  }
  const entity = await getActiveEntity(ctx, args.entityId);
  return { entities: entity ? [entity] : [], isPortfolioScope: false };
}

export const overview = query({
  args: {
    entityId: v.optional(v.id("entities")),
    scope: v.optional(scopeValidator),
    // Explicit reporting period. Drives the period-scoped KPIs (Received,
    // MRR sparkline window) and the Payments-tab date filter. When omitted we
    // fall back to the demo current month so existing callers stay stable.
    range: v.optional(v.object({ start: v.string(), end: v.string() })),
  },
  handler: async (ctx, args) => {
    const { entities, isPortfolioScope } = await resolveIncomeEntities(ctx, args);
    if (entities.length === 0) return EMPTY;
    const orderedEntities = entities
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id));
    const entity = orderedEntities[0]!;
    const entityIds = orderedEntities.map((scopedEntity) => scopedEntity._id);

    const rangeStart = args.range?.start ?? MONTH_START;
    const rangeEnd = args.range?.end ?? TODAY;
    // Aging / overdue are always measured as-of the latest of (range end, today)
    // so a backward-looking period never hides money that is overdue right now.
    const asOf = rangeEnd > TODAY ? rangeEnd : TODAY;

    const [invoiceGroups, contactGroups, transactionGroups, payoutGroups, accountGroups, lineGroups, entryGroups] =
      await Promise.all([
        Promise.all(entityIds.map((entityId) =>
          ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(2000),
        )),
        Promise.all(entityIds.map((entityId) =>
          ctx.db.query("contacts").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(2000),
        )),
        Promise.all(entityIds.map((entityId) =>
          ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(5000),
        )),
        Promise.all(entityIds.map((entityId) =>
          ctx.db.query("stripePayouts").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(500),
        )),
        Promise.all(entityIds.map((entityId) =>
          ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(2000),
        )),
        Promise.all(entityIds.map((entityId) =>
          ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(20000),
        )),
        Promise.all(entityIds.map((entityId) =>
          ctx.db.query("journalEntries").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(20000),
        )),
      ]);
    const invoices = invoiceGroups.flat();
    const contacts = contactGroups.flat();
    const transactions = transactionGroups.flat();
    const payouts = payoutGroups.flat();
    const accounts = accountGroups.flat();
    const journalLines = lineGroups.flat();
    const journalEntries = entryGroups.flat();

    const contactsById = new Map(contacts.map((contact) => [contact._id, contact]));
    const accountsById = new Map(accounts.map((account) => [account._id, account]));
    const entriesById = new Map(journalEntries.map((entry) => [entry._id, entry]));

    // The Accounts Receivable account id — a deposit that recordPayment matched
    // to an invoice is categorized HERE (Dr Bank, Cr A/R), so it is an invoice
    // settlement, not fresh income. Such a deposit is surfaced exactly once via
    // `invoicePaymentRows` below; excluding it from `incomeTxns` keeps the same
    // money from being double-counted in the cash table or the Received KPI.
    const arAccountId = accounts.find((account) => account.number === "1100")?._id ?? null;

    // ---- Payments tab: income-direction bank/stripe transactions, plus
    // reconciled payouts (which arrive as one deposit).
    const incomeTxns = transactions
      .filter(
        (txn) =>
          txn.amountMinor > 0 &&
          txn.review !== "excluded" &&
          !isLikelyInternalTransfer(txn) &&
          !(arAccountId != null && txn.categoryAccountId === arAccountId),
      )
      .map<PaymentRow>((txn) => ({
        id: txn._id,
        transactionId: txn._id,
        date: txn.date,
        fromName: txn.merchant,
        initials: initialsFor(txn.merchant),
        memo: txn.rawDescription,
        status: "paid",
        amountMinor: txn.amountMinor,
        currency: txn.currency,
        kind: "payment",
      }));
    const payoutRows = payouts
      .filter((payout) => payout.status === "reconciled")
      .map<PaymentRow>((payout) => ({
        id: payout._id,
        date: payout.arrivalDate,
        fromName: "Stripe payout",
        initials: "S",
        memo: `gross ${(payout.grossMinor / 100).toLocaleString()} − fees ${(payout.feesMinor / 100).toLocaleString()}`,
        status: "reconciled",
        amountMinor: payout.amountMinor,
        currency: isPortfolioScope ? "USD" : entity.currency,
        kind: "payout",
      }));
    // ---- Recorded invoice payments (E2.2). recordPayment posts Dr Bank/Cash,
    // Cr A/R through the ledger but does NOT create a `transactions` row, so the
    // money would otherwise be invisible to the cash table. Surface each such
    // entry as a cash-received row: the amount is the entry's debit to a cash /
    // bank asset account (the A/R credit clears the receivable, never income).
    const cashAssetAccountIds = new Set(
      accounts
        .filter((account) => account.type === "asset" && account.number !== "1100")
        .map((account) => account._id),
    );
    const linesByEntry = new Map<Id<"journalEntries">, Doc<"journalLines">[]>();
    for (const line of journalLines) {
      const list = linesByEntry.get(line.entryId) ?? [];
      list.push(line);
      linesByEntry.set(line.entryId, list);
    }
    const contactNameByInvoiceNumber = new Map<string, string>();
    for (const invoice of invoices) {
      contactNameByInvoiceNumber.set(invoice.number, contactsById.get(invoice.contactId)?.name ?? "Customer");
    }
    const invoicePaymentRows: PaymentRow[] = [];
    for (const entry of journalEntries) {
      if (entry.source !== "invoice" || !entry.sourceId?.endsWith(":payment")) continue;
      const lines = linesByEntry.get(entry._id) ?? [];
      const cashInMinor = lines
        .filter((line) => cashAssetAccountIds.has(line.accountId))
        .reduce((sum, line) => sum + (line.debitMinor - line.creditMinor), 0);
      if (cashInMinor <= 0) continue;
      const invoiceNumber = entry.sourceId.replace(/:payment$/, "");
      const fromName = contactNameByInvoiceNumber.get(invoiceNumber) ?? "Customer";
      invoicePaymentRows.push({
        id: entry._id,
        date: entry.date,
        fromName,
        initials: initialsFor(fromName),
        memo: `Invoice ${invoiceNumber} payment`,
        status: "paid",
        amountMinor: cashInMinor,
        currency: isPortfolioScope ? "USD" : entity.currency,
        kind: "payment",
      });
    }

    const allPayments = [...incomeTxns, ...payoutRows, ...invoicePaymentRows].sort((a, b) => b.date.localeCompare(a.date));

    // Payments shown + KPIs are scoped to the selected period.
    const periodPayments = allPayments.filter((row) => row.date >= rangeStart && row.date <= rangeEnd);
    const receivedThisMonthMinor = periodPayments.reduce((sum, row) => sum + row.amountMinor, 0);
    const reconciledPayoutCount = periodPayments.filter((row) => row.kind === "payout").length;

    // ---- Invoices tab + counts.
    const invoiceRows = invoices
      .map<InvoiceListRow>((invoice) => {
        const balanceMinor = invoice.totalMinor - invoice.amountPaidMinor;
        return {
          id: invoice._id,
          number: invoice.number,
          customerName: contactsById.get(invoice.contactId)?.name ?? "Customer",
          customerId: invoice.contactId,
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate,
          status: invoice.status,
          totalMinor: invoice.totalMinor,
          balanceMinor,
          daysPastDue: Math.max(0, dateDiffDays(asOf, invoice.dueDate)),
        };
      })
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate));
    const invoiceCounts = {
      all: invoiceRows.length,
      draft: invoiceRows.filter((row) => row.status === "draft").length,
      open: invoiceRows.filter((row) => row.status === "open").length,
      paid: invoiceRows.filter((row) => row.status === "paid").length,
      overdue: invoiceRows.filter((row) => row.status === "overdue").length,
      void: invoiceRows.filter((row) => row.status === "void").length,
    };

    // ---- Receivables matrix: reuse the report pack aging math (no duplication).
    const aging = buildAgingRows({
      contactsById,
      endDate: asOf,
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

    // ---- KPIs. "Still open" / "Overdue" derive from the SAME invoice set the
    // report pack uses, so they reconcile with AR aging in reportViews.
    const openInvoices = invoiceRows.filter((row) => (row.status === "open" || row.status === "overdue") && row.balanceMinor > 0);
    const stillOpenMinor = openInvoices.reduce((sum, row) => sum + row.balanceMinor, 0);
    const overdueInvoices = openInvoices.filter((row) => row.dueDate < asOf);
    const overdueMinor = overdueInvoices.reduce((sum, row) => sum + row.balanceMinor, 0);
    const oldestOverdueDays = overdueInvoices.reduce((max, row) => Math.max(max, row.daysPastDue), 0);

    // Avg days to pay: average net terms (issue -> due) across PAID invoices.
    // The seed records no per-invoice payment date, so net terms is the honest
    // available signal; labelled as such in the UI.
    const paidInvoices = invoices.filter((invoice) => invoice.status === "paid");
    const averageDaysToPay = paidInvoices.length
      ? Math.round(paidInvoices.reduce((sum, invoice) => sum + Math.max(0, dateDiffDays(invoice.dueDate, invoice.issueDate)), 0) / paidInvoices.length)
      : 0;

    // ---- Revenue by stream (income ledger account). Same credit−debit math as
    // the report pack P&L revenue section, scoped to the selected period, so the
    // Streams tab total reconciles with Reports P&L revenue.
    const incomeAccountIds = new Set(
      accounts.filter((account) => account.type === "income").map((account) => account._id),
    );
    const streamTotals = new Map<Id<"ledgerAccounts">, number>();
    const customerRevenue = new Map<string, number>();
    const customerLastPaid = new Map<string, string>();
    for (const line of journalLines) {
      if (!incomeAccountIds.has(line.accountId)) continue;
      const entry = entriesById.get(line.entryId);
      if (!entry || entry.date < rangeStart || entry.date > rangeEnd) continue;
      const amountMinor = revenueForLine(line);
      streamTotals.set(line.accountId, (streamTotals.get(line.accountId) ?? 0) + amountMinor);
      if (line.contactId) {
        customerRevenue.set(line.contactId, (customerRevenue.get(line.contactId) ?? 0) + amountMinor);
        const prev = customerLastPaid.get(line.contactId);
        if (!prev || entry.date > prev) customerLastPaid.set(line.contactId, entry.date);
      }
    }
    const streamRows: StreamRow[] = [...streamTotals.entries()]
      .map(([accountId, totalMinor]) => {
        const account = accountsById.get(accountId);
        return {
          id: accountId as string,
          name: account?.name ?? "Other income",
          accountNumber: account?.number ?? "",
          totalMinor,
        };
      })
      .filter((row) => row.totalMinor !== 0)
      .sort((a, b) => b.totalMinor - a.totalMinor);
    const streamsTotalMinor = streamRows.reduce((sum, row) => sum + row.totalMinor, 0);

    // ---- Customers: per-customer received (period revenue) + open balance +
    // last-paid. Open balance reuses the open/overdue invoice balances above so
    // it reconciles with receivables.
    const openByCustomer = new Map<string, number>();
    const invoiceCountByCustomer = new Map<string, number>();
    for (const row of invoiceRows) {
      invoiceCountByCustomer.set(row.customerId, (invoiceCountByCustomer.get(row.customerId) ?? 0) + 1);
      if ((row.status === "open" || row.status === "overdue") && row.balanceMinor > 0) {
        openByCustomer.set(row.customerId, (openByCustomer.get(row.customerId) ?? 0) + row.balanceMinor);
      }
    }
    const customerIds = new Set<string>([
      ...customerRevenue.keys(),
      ...openByCustomer.keys(),
    ]);
    const customerRows: CustomerRow[] = [...customerIds]
      .map((id) => {
        const contact = contactsById.get(id as Id<"contacts">);
        return {
          id,
          name: contact?.name ?? "Customer",
          receivedMinor: customerRevenue.get(id) ?? 0,
          openMinor: openByCustomer.get(id) ?? 0,
          lastPaid: customerLastPaid.get(id) ?? null,
          invoiceCount: invoiceCountByCustomer.get(id) ?? 0,
        };
      })
      .filter((row) => row.receivedMinor !== 0 || row.openMinor !== 0)
      .sort((a, b) => b.receivedMinor - a.receivedMinor || b.openMinor - a.openMinor);

    // ---- Recurring revenue / MRR. Honest definition: invoices on a recurring
    // (monthly-ish) cadence are not modelled in the seed, so we approximate MRR
    // as the most recent full month of income-account revenue and trend the last
    // 6 months as the sparkline. Labelled as a trailing-month run-rate in the UI.
    const monthlyRevenue = new Map<string, number>();
    for (const line of journalLines) {
      if (!incomeAccountIds.has(line.accountId)) continue;
      const entry = entriesById.get(line.entryId);
      if (!entry) continue;
      const key = monthKey(entry.date);
      monthlyRevenue.set(key, (monthlyRevenue.get(key) ?? 0) + revenueForLine(line));
    }
    const sortedMonths = [...monthlyRevenue.keys()].sort();
    const last6 = sortedMonths.slice(-6);
    const mrrSparkline = last6.map((key) => Math.round((monthlyRevenue.get(key) ?? 0) / 100));
    // Run-rate basis: the most recent COMPLETE calendar month. The demo "today"
    // sits mid-month, so the current month bucket is partial and would understate
    // the run-rate — drop it and use the latest month strictly before it. Falls
    // back to the latest available month only if no earlier month exists.
    const currentMonthKey = monthKey(asOf);
    const completeMonths = sortedMonths.filter((key) => key < currentMonthKey);
    const mrrBasisMonth = completeMonths.length
      ? completeMonths[completeMonths.length - 1]
      : (sortedMonths[sortedMonths.length - 1] ?? null);
    const recurringMrrMinor = mrrBasisMonth ? (monthlyRevenue.get(mrrBasisMonth) ?? 0) : 0;
    // A human-readable label for the basis month (e.g. "May 2026") so the UI can
    // state the trailing-month basis explicitly instead of implying it's the
    // partial current month.
    const recurringMrrMonthLabel = mrrBasisMonth
      ? new Date(`${mrrBasisMonth}-01T00:00:00Z`).toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        })
      : "";
    // Count of distinct customers billed in the latest month — a proxy for the
    // size of the recurring base.
    const recurringCount = customerRows.filter((row) => row.receivedMinor > 0).length;

    return {
      entity: {
        id: entity._id,
        name: isPortfolioScope ? "All businesses" : entity.name,
        currency: isPortfolioScope ? "USD" : entity.currency,
        isDemo: isPortfolioScope ? false : entity.isDemo,
      },
      kpis: {
        receivedThisMonthMinor,
        paymentCount: periodPayments.length,
        reconciledPayoutCount,
        stillOpenMinor,
        openInvoiceCount: openInvoices.length,
        overdueMinor,
        overdueInvoiceCount: overdueInvoices.length,
        oldestOverdueDays,
        averageDaysToPay,
        recurringMrrMinor,
        recurringMrrMonthLabel,
        recurringCount,
        mrrSparkline,
      },
      payments: periodPayments.slice(0, 60),
      invoices: invoiceRows,
      invoiceCounts,
      receivables: {
        rows: aging.rows.map((row) => ({
          id: row.id,
          name: row.name,
          currentMinor: row.currentMinor,
          days30Minor: row.days30Minor,
          days60Minor: row.days60Minor,
          days90Minor: row.days90Minor,
          totalMinor: row.totalMinor,
        })),
        totalMinor: aging.totalMinor,
        buckets: aging.buckets,
      },
      customers: customerRows,
      streams: { rows: streamRows, totalMinor: streamsTotalMinor },
    };
  },
});
