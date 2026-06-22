import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";
import { resolveDefaultEntity } from "./entityScope";
import { getEntityForWrite, postLedgerEntryCore } from "./ledger";

/**
 * Bank reconciliation surface (Epic E1-T12).
 *
 * The owner anchors on a STATEMENT ENDING BALANCE + ending date, marks ledger
 * transactions cleared, watches the running difference, drafts an adjusting
 * entry for any fee/interest discrepancy, and "completes" the reconciliation —
 * which is REFUSED unless the cleared book balance equals the statement balance
 * (differenceMinor === 0, QBO's non-negotiable $0.00 gate).
 *
 * Accounting invariants honored:
 *   - Cleared state lives on the TRANSACTION (`reconciliationId` + `clearedAt`),
 *     never as an array on the reconciliation row (decision Q6).
 *   - Adjusting entries post through the single ledger path (postLedgerEntryCore)
 *     and are reversible like any posted entry — never a raw balance edit.
 *   - The cleared book balance is derived from the LEDGER (normal balance of the
 *     bank's ledger account over cleared entries), so it can never drift from the
 *     books.
 *   - Every mutation/query re-checks workspace/entity authorization.
 */

const ADJUSTING_DEFAULT_FEE_NUMBER = "6200"; // Bank Fees
const ADJUSTING_INTEREST_NUMBER = "4900"; // Other / Interest Income (fallback below)

async function getEntityForReconRead(ctx: QueryCtx, entityId: Id<"entities">) {
  const entity = await ctx.db.get(entityId);
  if (!entity) throw new Error("OpenBooks entity not found.");
  await requireWorkspaceRole(ctx, entity.workspaceId, "member");
  return entity;
}

function normalBalanceForAsset(debitMinor: number, creditMinor: number) {
  // Bank/cash accounts are assets: debit increases, credit decreases.
  return debitMinor - creditMinor;
}

/**
 * Cleared book balance for a bank account: the ledger normal balance of its
 * ledger account, restricted to journal LINES whose entry is "cleared". An entry
 * counts as cleared when it is linked to a transaction whose `clearedAt` is set
 * (in this or any completed reconciliation). This ties the worksheet directly to
 * the posted ledger so the two can never diverge.
 */
async function computeClearedBalanceMinor(
  ctx: QueryCtx,
  bankAccount: Doc<"bankAccounts">,
): Promise<number> {
  // Transactions on this bank account that are cleared.
  const txns = await ctx.db
    .query("transactions")
    .withIndex("by_entity", (q) => q.eq("entityId", bankAccount.entityId))
    .collect();
  const clearedEntryIds = new Set<Id<"journalEntries">>();
  for (const txn of txns) {
    if (txn.bankAccountId !== bankAccount._id) continue;
    if (txn.clearedAt == null) continue;
    if (txn.entryId) clearedEntryIds.add(txn.entryId);
  }
  if (clearedEntryIds.size === 0) return 0;

  let total = 0;
  for (const entryId of clearedEntryIds) {
    const lines = await ctx.db
      .query("journalLines")
      .withIndex("by_entry", (q) => q.eq("entryId", entryId))
      .collect();
    for (const line of lines) {
      if (line.accountId !== bankAccount.ledgerAccountId) continue;
      total += normalBalanceForAsset(line.debitMinor, line.creditMinor);
    }
  }
  return total;
}

export const startReconciliation = mutation({
  args: {
    bankAccountId: v.id("bankAccounts"),
    statementEndDate: v.string(),
    statementEndBalanceMinor: v.number(),
  },
  handler: async (ctx, args) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.statementEndDate)) {
      throw new Error("statementEndDate must be ISO YYYY-MM-DD.");
    }
    if (!Number.isInteger(args.statementEndBalanceMinor)) {
      throw new Error("statementEndBalanceMinor must be an integer minor-unit amount.");
    }
    const bankAccount = await ctx.db.get(args.bankAccountId);
    if (!bankAccount) throw new Error("Bank account not found.");
    const entity = await getEntityForWrite(ctx, bankAccount.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");

    // One open reconciliation per bank account at a time.
    const existingOpen = await ctx.db
      .query("bankReconciliations")
      .withIndex("by_bank_account", (q) => q.eq("bankAccountId", args.bankAccountId))
      .collect();
    const open = existingOpen.find((row) => row.status === "open");
    if (open) {
      throw new ConvexError("A reconciliation is already open for this account.");
    }

    const now = Date.now();
    const reconciliationId = await ctx.db.insert("bankReconciliations", {
      entityId: entity._id,
      bankAccountId: args.bankAccountId,
      statementEndDate: args.statementEndDate,
      statementEndBalanceMinor: args.statementEndBalanceMinor,
      status: "open",
      startedByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "reconciliation.started",
      entityType: "entity",
      entityId: entity._id,
      summary: `Reconciliation started for ${bankAccount.name} (statement ${args.statementEndDate})`,
      createdAt: now,
    });
    return { reconciliationId };
  },
});

export const toggleTransactionCleared = mutation({
  args: {
    reconciliationId: v.id("bankReconciliations"),
    transactionId: v.id("transactions"),
    cleared: v.boolean(),
  },
  handler: async (ctx, args) => {
    const recon = await ctx.db.get(args.reconciliationId);
    if (!recon) throw new Error("Reconciliation not found.");
    const entity = await getEntityForWrite(ctx, recon.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    if (recon.status !== "open") {
      throw new ConvexError("Cannot change cleared state on a completed reconciliation.");
    }

    const txn = await ctx.db.get(args.transactionId);
    if (!txn || txn.entityId !== recon.entityId) {
      throw new Error("Transaction not found on this entity.");
    }
    if (txn.bankAccountId !== recon.bankAccountId) {
      throw new Error("Transaction does not belong to this reconciliation's bank account.");
    }

    const now = Date.now();
    if (args.cleared) {
      await ctx.db.patch(txn._id, { reconciliationId: recon._id, clearedAt: now, updatedAt: now });
    } else {
      await ctx.db.patch(txn._id, { reconciliationId: undefined, clearedAt: undefined, updatedAt: now });
    }
    await ctx.db.patch(recon._id, { updatedAt: now });
    void userId;
    return { transactionId: txn._id, cleared: args.cleared };
  },
});

export const addAdjustingEntry = mutation({
  args: {
    reconciliationId: v.id("bankReconciliations"),
    kind: v.union(v.literal("fee"), v.literal("interest")),
    amountMinor: v.number(),
    date: v.optional(v.string()),
    memo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0) {
      throw new Error("Adjusting amount must be a positive integer minor-unit amount.");
    }
    const recon = await ctx.db.get(args.reconciliationId);
    if (!recon) throw new Error("Reconciliation not found.");
    const entity = await getEntityForWrite(ctx, recon.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    if (recon.status !== "open") {
      throw new ConvexError("Cannot add an adjusting entry to a completed reconciliation.");
    }
    const bankAccount = await ctx.db.get(recon.bankAccountId);
    if (!bankAccount) throw new Error("Bank account not found.");

    const date = args.date ?? recon.statementEndDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error("Adjusting entry date must be ISO YYYY-MM-DD.");
    }

    // Resolve the counter account: a fee is an expense (Bank Fees 6200), interest
    // is income (Interest Income). Create-if-missing for the interest account so
    // legacy charts without it still reconcile.
    const bankLedgerAccountId = bankAccount.ledgerAccountId;
    let counterAccountId: Id<"ledgerAccounts">;
    let lines;
    const now = Date.now();
    if (args.kind === "fee") {
      const fee = await findAccount(ctx, entity._id, ADJUSTING_DEFAULT_FEE_NUMBER);
      if (!fee) throw new Error("Bank Fees account (6200) is missing from the chart.");
      counterAccountId = fee._id;
      // Dr Bank Fees (expense up) / Cr Bank (cash down).
      lines = [
        { accountId: counterAccountId, debitMinor: args.amountMinor, creditMinor: 0 },
        { accountId: bankLedgerAccountId, debitMinor: 0, creditMinor: args.amountMinor },
      ];
    } else {
      const interest = await ensureInterestAccount(ctx, entity, userId, now);
      counterAccountId = interest._id;
      // Dr Bank (cash up) / Cr Interest Income.
      lines = [
        { accountId: bankLedgerAccountId, debitMinor: args.amountMinor, creditMinor: 0 },
        { accountId: counterAccountId, debitMinor: 0, creditMinor: args.amountMinor },
      ];
    }

    const memo = args.memo?.trim() || (args.kind === "fee" ? "Bank fee (reconciliation adjustment)" : "Interest earned (reconciliation adjustment)");
    const { entryId } = await postLedgerEntryCore(ctx, {
      entity,
      userId,
      date,
      memo,
      source: "manual",
      sourceId: `reconcile:${recon._id}:${args.kind}:${now}`,
      lines,
      auditAction: "reconciliation.adjusting_entry.posted",
    });

    // Record the adjustment as a cleared transaction on this bank account so it
    // immediately moves the cleared book balance toward the statement balance.
    const signedAmount = args.kind === "interest" ? args.amountMinor : -args.amountMinor;
    await ctx.db.insert("transactions", {
      entityId: entity._id,
      bankAccountId: recon.bankAccountId,
      date,
      amountMinor: signedAmount,
      currency: entity.currency,
      merchant: args.kind === "fee" ? "Bank fee" : "Interest earned",
      rawDescription: memo,
      status: "posted",
      review: "confirmed",
      source: "manual",
      categoryAccountId: counterAccountId,
      entryId,
      externalId: `reconcile:${recon._id}:${args.kind}:${now}`,
      reconciliationId: recon._id,
      clearedAt: now,
      evalSet: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(recon._id, { updatedAt: now });

    return { entryId };
  },
});

export const completeReconciliation = mutation({
  args: { reconciliationId: v.id("bankReconciliations") },
  handler: async (ctx, args) => {
    const recon = await ctx.db.get(args.reconciliationId);
    if (!recon) throw new Error("Reconciliation not found.");
    const entity = await getEntityForWrite(ctx, recon.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    if (recon.status !== "open") {
      throw new ConvexError("Reconciliation is already completed.");
    }
    const bankAccount = await ctx.db.get(recon.bankAccountId);
    if (!bankAccount) throw new Error("Bank account not found.");

    const clearedBalanceMinor = await computeClearedBalanceMinor(ctx, bankAccount);
    const differenceMinor = recon.statementEndBalanceMinor - clearedBalanceMinor;
    if (differenceMinor !== 0) {
      // QBO's non-negotiable gate: never complete with a non-zero difference.
      throw new ConvexError(
        `Cannot complete: cleared balance differs from the statement by ${differenceMinor} minor units.`,
      );
    }

    const now = Date.now();
    await ctx.db.patch(recon._id, {
      status: "completed",
      completedAt: now,
      completedByUserId: userId,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "reconciliation.completed",
      entityType: "entity",
      entityId: entity._id,
      summary: `Reconciliation completed for ${bankAccount.name} at ${recon.statementEndBalanceMinor} (statement ${recon.statementEndDate})`,
      createdAt: now,
    });
    return { reconciliationId: recon._id, clearedBalanceMinor, differenceMinor: 0 };
  },
});

export const reconciliationWorksheet = query({
  args: { reconciliationId: v.id("bankReconciliations") },
  handler: async (ctx, args) => {
    const recon = await ctx.db.get(args.reconciliationId);
    if (!recon) return null;
    const entity = await getEntityForReconRead(ctx, recon.entityId);
    const bankAccount = await ctx.db.get(recon.bankAccountId);
    if (!bankAccount) return null;

    const clearedBalanceMinor = await computeClearedBalanceMinor(ctx, bankAccount);
    const differenceMinor = recon.statementEndBalanceMinor - clearedBalanceMinor;

    // Lines on this bank account up to (and including) the statement end date,
    // split into cleared / uncleared. Posted transactions only carry a ledger
    // movement, so we list those.
    const txns = await ctx.db
      .query("transactions")
      .withIndex("by_entity", (q) => q.eq("entityId", recon.entityId))
      .collect();
    const onAccount = txns
      .filter((txn) => txn.bankAccountId === recon.bankAccountId && txn.date <= recon.statementEndDate)
      .sort((a, b) => a.date.localeCompare(b.date));
    const toRow = (txn: Doc<"transactions">) => ({
      transactionId: txn._id,
      date: txn.date,
      merchant: txn.merchant,
      amountMinor: txn.amountMinor,
      cleared: txn.clearedAt != null && txn.reconciliationId === recon._id,
      clearedElsewhere: txn.clearedAt != null && txn.reconciliationId !== recon._id,
    });

    return {
      reconciliation: {
        id: recon._id,
        bankAccountId: recon.bankAccountId,
        bankAccountName: bankAccount.name,
        statementEndDate: recon.statementEndDate,
        statementEndBalanceMinor: recon.statementEndBalanceMinor,
        status: recon.status,
      },
      currency: entity.currency,
      statementEndBalanceMinor: recon.statementEndBalanceMinor,
      clearedBalanceMinor,
      differenceMinor,
      canComplete: recon.status === "open" && differenceMinor === 0,
      clearedLines: onAccount.filter((txn) => txn.clearedAt != null && txn.reconciliationId === recon._id).map(toRow),
      unclearedLines: onAccount.filter((txn) => !(txn.clearedAt != null && txn.reconciliationId === recon._id)).map(toRow),
    };
  },
});

/**
 * Bank accounts for the active (or given) entity with each one's open
 * reconciliation, if any — the data source for the reconciliation surface.
 */
export const reconciliationAccounts = query({
  args: { entityId: v.optional(v.id("entities")) },
  handler: async (ctx, args) => {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const entity = args.entityId
      ? await ctx.db.get(args.entityId)
      : await resolveDefaultEntity(ctx, membership);
    if (!entity || entity.workspaceId !== membership.workspaceId) return null;
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");

    const bankAccounts = await ctx.db
      .query("bankAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(200);
    const recons = await ctx.db
      .query("bankReconciliations")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .collect();

    return {
      entity: { id: entity._id, name: entity.name, currency: entity.currency },
      accounts: bankAccounts.map((account) => {
        const open = recons.find((row) => row.bankAccountId === account._id && row.status === "open");
        const completed = recons
          .filter((row) => row.bankAccountId === account._id && row.status === "completed")
          .sort((a, b) => b.statementEndDate.localeCompare(a.statementEndDate))[0];
        return {
          id: account._id,
          name: account.name,
          mask: account.mask,
          kind: account.kind,
          liveBalanceMinor: account.plaidAccountId ? account.balanceMinor : null,
          openReconciliationId: open?._id ?? null,
          lastCompletedDate: completed?.statementEndDate ?? null,
        };
      }),
    };
  },
});

export const listReconciliations = query({
  args: { bankAccountId: v.id("bankAccounts") },
  handler: async (ctx, args) => {
    const bankAccount = await ctx.db.get(args.bankAccountId);
    if (!bankAccount) return null;
    await getEntityForReconRead(ctx, bankAccount.entityId);
    const rows = await ctx.db
      .query("bankReconciliations")
      .withIndex("by_bank_account", (q) => q.eq("bankAccountId", args.bankAccountId))
      .collect();
    return rows
      .sort((a, b) => b.statementEndDate.localeCompare(a.statementEndDate) || b.createdAt - a.createdAt)
      .map((row) => ({
        id: row._id,
        statementEndDate: row.statementEndDate,
        statementEndBalanceMinor: row.statementEndBalanceMinor,
        status: row.status,
        completedAt: row.completedAt ?? null,
      }));
  },
});

// --- helpers -------------------------------------------------------------

async function findAccount(ctx: QueryCtx | MutationCtx, entityId: Id<"entities">, number: string) {
  return await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity_and_number", (q) => q.eq("entityId", entityId).eq("number", number))
    .unique();
}

async function ensureInterestAccount(
  ctx: MutationCtx,
  entity: Doc<"entities">,
  userId: Id<"users">,
  now: number,
) {
  const existing = await findAccount(ctx, entity._id, ADJUSTING_INTEREST_NUMBER);
  if (existing) return existing;
  const id = await ctx.db.insert("ledgerAccounts", {
    entityId: entity._id,
    name: "Interest Income",
    type: "income",
    subtype: "interest",
    number: ADJUSTING_INTEREST_NUMBER,
    currency: entity.currency,
    isSystem: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  void userId;
  const created = await ctx.db.get(id);
  if (!created) throw new Error("Failed to create Interest Income account.");
  return created;
}
