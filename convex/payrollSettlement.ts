import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";
import { postLedgerEntryCore, type LedgerLineInput } from "./ledger";

const PAYROLL_MATCH_TOLERANCE_MINOR = Math.round(0.05 * 100 * 100); // 5% tolerance for fees

function formatMoney(amountMinor: number): string {
  return `$${(Math.abs(amountMinor) / 100).toFixed(2)}`;
}

/**
 * Find pending bank outflows that could settle a payroll run.
 * Matches on:
 * - Amount within ±5% of expected payroll total (fuzz for fees)
 * - Date within 0–3 business days of payroll period
 * - Direction: outflow only
 * - Descriptor hint: "payroll", "vendor", or no specific hint
 *
 * Returns at most 1 candidate (ambiguity = manual match).
 */
export async function findMatchingPayrollTransaction(
  ctx: MutationCtx,
  args: {
    entityId: Id<"entities">;
    expectedTotalMinor: number;
    payrollPeriod: string; // "2026-06-30"
  },
): Promise<{
  transactionId: Id<"transactions">;
  amountMinor: number;
  descriptor: string;
  date: string;
  variance: number; // wired - expected
} | null> {
  const payrollPeriodDate = new Date(`${args.payrollPeriod}T00:00:00Z`);
  const startDate = new Date(payrollPeriodDate);
  startDate.setUTCDate(startDate.getUTCDate() - 3);

  const endDate = new Date(payrollPeriodDate);
  endDate.setUTCDate(endDate.getUTCDate() + 3);

  // Fuzz: ±5% for processing fees + bank fees
  const tolerance = Math.round(args.expectedTotalMinor * 0.05);
  const minAmount = args.expectedTotalMinor - tolerance;
  const maxAmount = args.expectedTotalMinor + tolerance;

  const candidates = await ctx.db
    .query("transactions")
    .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
    .collect();

  const matching = candidates.filter((txn) => {
    if (txn.source !== "bank" || txn.status !== "pending") return false;
    if (txn.amountMinor >= 0) return false; // outflow only
    if (txn.payrollRunId) return false; // already matched

    const txnDate = new Date(`${txn.date}T00:00:00Z`);
    if (txnDate < startDate || txnDate > endDate) return false;

    const absAmount = Math.abs(txn.amountMinor);
    if (absAmount < minAmount || absAmount > maxAmount) return false;

    return true;
  });

  if (matching.length !== 1) return null; // 0 or >1 = ambiguous

  const txn = matching[0];
  return {
    transactionId: txn._id,
    amountMinor: Math.abs(txn.amountMinor),
    descriptor: txn.rawDescription,
    date: txn.date,
    variance: Math.abs(txn.amountMinor) - args.expectedTotalMinor,
  };
}

/**
 * When a payroll run reaches "approved" status, auto-run the matcher
 * and surface a proposal to the owner. If variance exists, pre-calculate
 * the splits and variance journal entry.
 */
export const proposePayrollSettlement = internalMutation({
  args: {
    entityId: v.id("entities"),
    payrollRunId: v.id("payrollRuns"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.payrollRunId);
    if (!run || run.entityId !== args.entityId) {
      throw new Error("Payroll run not found.");
    }

    if (run.status !== "approved" || run.reconciliationStatus === "match_confirmed") {
      throw new Error("Payroll run is not in a state to be settled.");
    }

    const expectedTotal = run.expectedTotalMinor ?? run.totalBaseMinor;

    const match = await findMatchingPayrollTransaction(ctx, {
      entityId: args.entityId,
      expectedTotalMinor: expectedTotal,
      payrollPeriod: run.period,
    });

    if (!match) {
      // No match found; leave it unmatched for manual review.
      await ctx.db.patch(args.payrollRunId, {
        reconciliationStatus: "unmatched",
        updatedAt: Date.now(),
      });
      return { status: "no_match" };
    }

    // Match found; calculate splits.
    const variance = match.variance;
    const splits: Array<{
      category: "payroll" | "payroll_fee" | "bank_fee" | "tax_withholding" | "other";
      categoryAccountId: Id<"ledgerAccounts">;
      amountMinor: number;
      description?: string;
    }> = [];

    // Main payroll component
    if (run.expenseAccountId) {
      splits.push({
        category: "payroll",
        categoryAccountId: run.expenseAccountId,
        amountMinor: expectedTotal,
        description: `Payroll for ${run.period}`,
      });
    }

    // Variance component (if wired amount != expected)
    if (Math.abs(variance) > 100) { // only if >= $1.00
      const varianceAccountId = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity_and_number", (q) =>
          q.eq("entityId", args.entityId).eq("number", "6950")
        )
        .unique();

      if (varianceAccountId) {
        splits.push({
          category: variance > 0 ? "payroll_fee" : "other",
          categoryAccountId: varianceAccountId._id,
          amountMinor: variance,
          description: variance > 0
            ? `Processing/bank fees for payroll run ${run.period}`
            : `Refund/reversal on payroll run ${run.period}`,
        });
      }
    }

    // Update transaction with proposed splits
    await ctx.db.patch(match.transactionId, {
      payrollSplits: splits,
      payrollRunId: args.payrollRunId,
      payrollReconciliationStatus: "proposed",
      updatedAt: Date.now(),
    });

    // Mark run as proposal pending
    await ctx.db.patch(args.payrollRunId, {
      reconciliationStatus: "match_proposed",
      updatedAt: Date.now(),
    });

    return {
      status: "proposed",
      matchId: match.transactionId,
      variance,
      splits,
    };
  },
});

/**
 * Owner confirms the payroll settlement proposal. Posts all splits
 * to the ledger and marks the run as settled.
 */
export const confirmPayrollSettlement = mutation({
  args: {
    payrollRunId: v.id("payrollRuns"),
    transactionId: v.id("transactions"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.payrollRunId);
    const txn = await ctx.db.get(args.transactionId);

    if (!run || !txn) throw new Error("Payroll run or transaction not found.");

    const entity = await ctx.db.get(run.entityId);
    if (!entity) throw new Error("Entity not found.");

    // Authorization check: owner or accountant
    const user = await ctx.auth.getUserIdentity();
    if (!user) throw new Error("Not authenticated.");

    await requireWorkspaceRole(ctx, entity.workspaceId, "accountant");

    if (run.reconciliationStatus !== "match_proposed") {
      throw new Error("Payroll run is not in a proposed state.");
    }

    if (txn.payrollReconciliationStatus !== "proposed") {
      throw new Error("Transaction does not have a proposed settlement.");
    }

    if (!txn.payrollSplits || txn.payrollSplits.length === 0) {
      throw new Error("Transaction has no split categories.");
    }

    // Post the settlement entry
    const lines: LedgerLineInput[] = [];

    for (const split of txn.payrollSplits) {
      lines.push({
        accountId: split.categoryAccountId,
        debitMinor: split.category === "payroll" || split.category.includes("fee") ? Math.abs(split.amountMinor) : 0,
        creditMinor: split.category === "payroll" || split.category.includes("fee") ? 0 : Math.abs(split.amountMinor),
        currency: entity.currency,
      });
    }

    // Add the bank account as a credit for the outflow
    if (txn.bankAccountId) {
      const bankAccount = await ctx.db.get(txn.bankAccountId);
      if (bankAccount) {
        const totalAmount = txn.payrollSplits.reduce((sum, s) => sum + s.amountMinor, 0);
        lines.push({
          accountId: bankAccount.ledgerAccountId,
          debitMinor: 0,
          creditMinor: Math.abs(totalAmount),
          currency: entity.currency,
        });
      }
    }

    const settlementEntry = await postLedgerEntryCore(ctx, {
      entity,
      userId: user.subject as unknown as Id<"users">,
      date: txn.date,
      memo: `Payroll settlement for ${run.period}; bank outflow ${formatMoney(Math.abs(txn.amountMinor))}`,
      source: "payroll",
      sourceId: `${run._id}:settlement`,
      lines,
    });

    // Link transaction to run and mark confirmed
    await ctx.db.patch(args.transactionId, {
      status: "posted",
      payrollRunId: args.payrollRunId,
      payrollReconciliationStatus: "confirmed",
      entryId: settlementEntry.entryId,
      decidedBy: "match",
      confidence: 0.95,
      reasoning: `Matched to payroll run ${run.period} and settled to bank; settlement entry ${settlementEntry.entryId} posted.`,
      updatedAt: Date.now(),
    });

    // Mark run as settled
    await ctx.db.patch(args.payrollRunId, {
      reconciliationStatus: "match_confirmed",
      settlementTxnId: args.transactionId,
      settledTotalMinor: Math.abs(txn.amountMinor),
      entryIds: [...run.entryIds, settlementEntry.entryId],
      updatedAt: Date.now(),
    });

    return { status: "confirmed", entryId: settlementEntry.entryId };
  },
});
