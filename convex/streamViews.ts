import { ConvexError, v } from "convex/values";

import { query } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";

// Bounded scan for the MVP per-stream P&L. Flagged as `truncated` if hit.
const STREAM_PNL_LIMIT = 16000;

type Bucket = { revenueMinor: number; directCostMinor: number };

/**
 * Per-stream profit-and-loss for one business over a date range (streams
 * redesign). Stream attribution now lives on the RECORDS themselves — a
 * `streams[]` split on transactions, invoices, and bills — NOT on ledger-account
 * tags. Revenue comes from income-side records; cost from expense-side records:
 *
 *  - Transaction: counted only when categorized to an income (→revenue) or
 *    expense (→cost) account, so settlement/transfer legs (AR/AP, bank) are
 *    naturally excluded and an invoice's payment leg is not double-counted.
 *  - Invoice (non-draft/void): revenue.
 *  - Bill (non-void): cost.
 *
 * A record WITH a stream split feeds its tagged streams; a record WITHOUT one
 * feeds `untaggedRevenueMinor` / `unallocatedCostMinor`. Totals reconcile:
 *   netIncome = Σ(stream profit) + untaggedRevenue − unallocatedCost
 * Accrual-ish, document-based. Read-only; member+.
 */
export const streamPnl = query({
  args: {
    entityId: v.id("entities"),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new ConvexError("OpenBooks business not found.");
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");

    const year = new Date().getUTCFullYear();
    const startDate = args.startDate ?? `${year}-01-01`;
    const endDate = args.endDate ?? `${year}-12-31`;
    const inRange = (date: string) => date >= startDate && date <= endDate;

    const [accounts, transactions, invoices, bills] = await Promise.all([
      ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
      ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(STREAM_PNL_LIMIT),
      ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(STREAM_PNL_LIMIT),
      ctx.db.query("bills").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(STREAM_PNL_LIMIT),
    ]);
    const accountType = new Map(accounts.map((a) => [a._id as string, a.type]));

    const streamAgg = new Map<string, Bucket>();
    let untaggedRevenueMinor = 0;
    let unallocatedCostMinor = 0;

    const bucketFor = (label: string) => {
      const existing = streamAgg.get(label);
      if (existing) return existing;
      const fresh: Bucket = { revenueMinor: 0, directCostMinor: 0 };
      streamAgg.set(label, fresh);
      return fresh;
    };

    // --- Transactions (income/expense-categorized only) -------------------
    for (const txn of transactions) {
      if (txn.status !== "posted") continue;
      if (txn.review === "excluded") continue;
      if (!inRange(txn.date)) continue;
      const type = txn.categoryAccountId ? accountType.get(txn.categoryAccountId as string) : undefined;
      const side: "revenue" | "cost" | null =
        type === "income" ? "revenue" : type === "expense" ? "cost" : null;
      if (!side) continue; // settlement / transfer / uncategorized — not P&L

      if (txn.streams && txn.streams.length > 0) {
        for (const line of txn.streams) {
          const bucket = bucketFor(line.streamLabel);
          if (side === "revenue") bucket.revenueMinor += line.amountMinor;
          else bucket.directCostMinor += Math.abs(line.amountMinor);
        }
      } else if (side === "revenue") {
        untaggedRevenueMinor += txn.amountMinor;
      } else {
        unallocatedCostMinor += Math.abs(txn.amountMinor);
      }
    }

    // --- Invoices → revenue (non-draft/void) ------------------------------
    for (const invoice of invoices) {
      if (invoice.status === "draft" || invoice.status === "void") continue;
      if (!inRange(invoice.issueDate)) continue;
      if (invoice.streams && invoice.streams.length > 0) {
        for (const line of invoice.streams) bucketFor(line.streamLabel).revenueMinor += line.amountMinor;
      } else {
        untaggedRevenueMinor += invoice.totalMinor;
      }
    }

    // --- Bills → cost (non-void) ------------------------------------------
    for (const bill of bills) {
      if (bill.status === "void") continue;
      if (!inRange(bill.issueDate)) continue;
      if (bill.streams && bill.streams.length > 0) {
        for (const line of bill.streams) bucketFor(line.streamLabel).directCostMinor += line.amountMinor;
      } else {
        unallocatedCostMinor += bill.totalMinor;
      }
    }

    const streams = [...streamAgg.entries()]
      .map(([stream, bucket]) => {
        const profitMinor = bucket.revenueMinor - bucket.directCostMinor;
        return {
          stream,
          revenueMinor: bucket.revenueMinor,
          directCostMinor: bucket.directCostMinor,
          profitMinor,
          marginPct: bucket.revenueMinor > 0 ? Math.round((profitMinor / bucket.revenueMinor) * 100) : null,
        };
      })
      .sort((a, b) => b.profitMinor - a.profitMinor);

    const taggedRevenue = streams.reduce((acc, s) => acc + s.revenueMinor, 0);
    const taggedCost = streams.reduce((acc, s) => acc + s.directCostMinor, 0);
    const netIncomeMinor = taggedRevenue + untaggedRevenueMinor - (taggedCost + unallocatedCostMinor);

    return {
      entity: { id: entity._id, name: entity.name, currency: entity.currency },
      startDate,
      endDate,
      streams,
      untaggedRevenueMinor,
      unallocatedCostMinor,
      totals: {
        revenueMinor: taggedRevenue + untaggedRevenueMinor,
        directCostMinor: taggedCost,
        unallocatedCostMinor,
        netIncomeMinor,
      },
      truncated:
        transactions.length >= STREAM_PNL_LIMIT ||
        invoices.length >= STREAM_PNL_LIMIT ||
        bills.length >= STREAM_PNL_LIMIT,
    };
  },
});
