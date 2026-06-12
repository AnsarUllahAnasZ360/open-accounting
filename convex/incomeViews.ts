import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";
import { buildAgingRows } from "./reportViews";

const TODAY = "2026-06-11";
const MONTH_START = "2026-06-01"; // first of the current (demo) month

async function getActiveEntity(ctx: QueryCtx, entityId?: Id<"entities">) {
  const { membership } = await requireAnyWorkspaceRole(ctx, "member");
  const entity = entityId
    ? await ctx.db.get(entityId)
    : (await ctx.db
        .query("entities")
        .withIndex("by_workspace_and_slug", (q) =>
          q.eq("workspaceId", membership.workspaceId).eq("slug", "acme-studio-llc"),
        )
        .unique()) ??
      (await ctx.db
        .query("entities")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
        .first());
  if (!entity || entity.workspaceId !== membership.workspaceId) return null;
  await requireWorkspaceRole(ctx, entity.workspaceId, "member");
  return entity;
}

function dateDiffDays(left: string, right: string) {
  return Math.floor((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000);
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
  },
  payments: [] as PaymentRow[],
  invoices: [] as InvoiceListRow[],
  invoiceCounts: { all: 0, draft: 0, open: 0, paid: 0, overdue: 0, void: 0 },
  receivables: { rows: [] as AgingMatrixRow[], totalMinor: 0, buckets: { currentMinor: 0, days30Minor: 0, days60Minor: 0, days90Minor: 0 } },
};

type PaymentRow = {
  id: string;
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

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export const overview = query({
  args: { entityId: v.optional(v.id("entities")) },
  handler: async (ctx, args) => {
    const entity = await getActiveEntity(ctx, args.entityId);
    if (!entity) return EMPTY;

    const [invoices, contacts, transactions, payouts] = await Promise.all([
      ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
      ctx.db.query("contacts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
      ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(5000),
      ctx.db.query("stripePayouts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(500),
    ]);

    const contactsById = new Map(contacts.map((contact) => [contact._id, contact]));

    // ---- Payments tab: income-direction bank/stripe transactions this period,
    // plus reconciled payouts (which arrive as one deposit).
    const incomeTxns = transactions
      .filter((txn) => txn.amountMinor > 0 && txn.review !== "excluded")
      .map<PaymentRow>((txn) => ({
        id: txn._id,
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
        currency: entity.currency,
        kind: "payout",
      }));
    const payments = [...incomeTxns, ...payoutRows].sort((a, b) => b.date.localeCompare(a.date));

    // Received THIS MONTH = income transactions + reconciled payouts dated in
    // the current month.
    const monthPayments = payments.filter((row) => row.date >= MONTH_START && row.date <= TODAY);
    const receivedThisMonthMinor = monthPayments.reduce((sum, row) => sum + row.amountMinor, 0);
    const reconciledPayoutCount = monthPayments.filter((row) => row.kind === "payout").length;

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
          daysPastDue: Math.max(0, dateDiffDays(TODAY, invoice.dueDate)),
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
      endDate: TODAY,
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
    const overdueInvoices = openInvoices.filter((row) => row.dueDate < TODAY);
    const overdueMinor = overdueInvoices.reduce((sum, row) => sum + row.balanceMinor, 0);
    const oldestOverdueDays = overdueInvoices.reduce((max, row) => Math.max(max, row.daysPastDue), 0);

    // Avg days to pay: average net terms (issue -> due) across PAID invoices.
    // The seed records no per-invoice payment date, so net terms is the honest
    // available signal; labelled as such in the UI.
    const paidInvoices = invoices.filter((invoice) => invoice.status === "paid");
    const averageDaysToPay = paidInvoices.length
      ? Math.round(paidInvoices.reduce((sum, invoice) => sum + Math.max(0, dateDiffDays(invoice.dueDate, invoice.issueDate)), 0) / paidInvoices.length)
      : 0;

    return {
      entity: { id: entity._id, name: entity.name, currency: entity.currency, isDemo: entity.isDemo },
      kpis: {
        receivedThisMonthMinor,
        paymentCount: monthPayments.length,
        reconciledPayoutCount,
        stillOpenMinor,
        openInvoiceCount: openInvoices.length,
        overdueMinor,
        overdueInvoiceCount: overdueInvoices.length,
        oldestOverdueDays,
        averageDaysToPay,
      },
      payments: payments.slice(0, 40),
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
    };
  },
});
