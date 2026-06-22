import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";
import { resolveDefaultEntity } from "./entityScope";

const DASHBOARD_LIMIT = 5000;
const REPORT_LIMIT = 5000;

async function getEntity(ctx: QueryCtx, entityId?: Id<"entities">) {
  const { membership } = await requireAnyWorkspaceRole(ctx, "member");
  const entity = entityId
    ? await ctx.db.get(entityId)
    : await resolveDefaultEntity(ctx, membership);
  if (!entity || entity.workspaceId !== membership.workspaceId) return null;
  await requireWorkspaceRole(ctx, entity.workspaceId, "member");
  return entity;
}

function totalRows(rows: Record<string, number>) {
  return Object.values(rows).reduce((sum, count) => sum + count, 0);
}

function section(args: {
  limit: number;
  rowCounts: Record<string, number>;
  truncatedKeys: string[];
}) {
  const rows = { ...args.rowCounts, totalRows: totalRows(args.rowCounts) };
  return {
    limit: args.limit,
    rowCounts: rows,
    truncated: args.truncatedKeys.some((key) => (args.rowCounts[key] ?? 0) >= args.limit),
  };
}

export const limitsSnapshot = query({
  args: {
    entityId: v.optional(v.id("entities")),
  },
  handler: async (ctx, args) => {
    const entity = await getEntity(ctx, args.entityId);
    if (!entity) return null;

    const [
      ledgerAccounts,
      bankAccounts,
      journalEntries,
      journalLines,
      transactions,
      inboxItems,
      invoices,
      bills,
      payrollRuns,
      contacts,
      documents,
      auditEvents,
    ] = await Promise.all([
      ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(DASHBOARD_LIMIT),
      ctx.db.query("bankAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(200),
      ctx.db.query("journalEntries").withIndex("by_entity_and_date", (q) => q.eq("entityId", entity._id)).take(DASHBOARD_LIMIT),
      ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(DASHBOARD_LIMIT),
      ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(DASHBOARD_LIMIT),
      ctx.db.query("inboxItems").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
      ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
      ctx.db.query("bills").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
      ctx.db.query("payrollRuns").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(200),
      ctx.db.query("contacts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
      ctx.db.query("documents").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(1000),
      ctx.db.query("auditEvents").withIndex("by_workspace", (q) => q.eq("workspaceId", entity.workspaceId)).order("desc").take(1000),
    ]);

    const dashboard = section({
      limit: DASHBOARD_LIMIT,
      rowCounts: {
        ledgerAccounts: ledgerAccounts.length,
        bankAccounts: bankAccounts.length,
        journalEntries: journalEntries.length,
        journalLines: journalLines.length,
        transactions: transactions.length,
        inboxItems: inboxItems.length,
        invoices: invoices.length,
        bills: bills.length,
        payrollRuns: payrollRuns.length,
        contacts: contacts.length,
      },
      truncatedKeys: ["ledgerAccounts", "journalEntries", "journalLines", "transactions"],
    });

    const reportPack = section({
      limit: REPORT_LIMIT,
      rowCounts: {
        ledgerAccounts: ledgerAccounts.length,
        journalEntries: journalEntries.length,
        journalLines: journalLines.length,
        transactions: transactions.length,
        invoices: invoices.length,
        bills: bills.length,
        payrollRuns: payrollRuns.length,
        contacts: contacts.length,
        bankAccounts: bankAccounts.length,
      },
      truncatedKeys: ["ledgerAccounts", "journalEntries", "journalLines", "transactions"],
    });

    const transactionsRegister = {
      rowsReturned: Math.min(transactions.length, 120),
      boundedPageSize: 120,
      rowCounts: {
        transactions: transactions.length,
        ledgerAccounts: ledgerAccounts.length,
        bankAccounts: bankAccounts.length,
        inboxItems: inboxItems.length,
        journalLines: journalLines.length,
        documents: documents.length,
        journalEntriesForActivity: Math.min(journalEntries.length, 1000),
        auditEventsForActivity: auditEvents.length,
      },
    };

    return {
      entity: {
        id: entity._id,
        name: entity.name,
        currency: entity.currency,
      },
      dashboard,
      reportPack,
      transactionsRegister,
      inbox: {
        openRowsReturned: inboxItems.filter((item) => item.status === "open").length,
        categoryOptionsReturned: ledgerAccounts.filter((account) => !account.archived).length,
        documentsRead: documents.length,
      },
      checks: {
        dashboardUnderLimit: !dashboard.truncated && dashboard.rowCounts.totalRows < DASHBOARD_LIMIT,
        reportUnderLimit: !reportPack.truncated && reportPack.rowCounts.totalRows < REPORT_LIMIT,
        transactionsPageBounded: transactionsRegister.rowsReturned <= transactionsRegister.boundedPageSize,
      },
    };
  },
});
