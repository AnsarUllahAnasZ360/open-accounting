import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";
import { getEntityForWrite, postLedgerEntryCore } from "./ledger";

/**
 * Test-only support: seed ONE expense transaction onto a DISPOSABLE business so
 * an e2e can exercise an Expenses flow without ever touching the shared demo
 * books. Entity-scoped and admin-gated (re-checks workspace authorization on the
 * server, like every mutation). Disposable businesses are archived by the test
 * afterward; nothing here mutates a shared book.
 *
 * Two shapes, switched by `posted`:
 *  - posted: true (default) — posts a real, balanced journal entry through the
 *    SHARED ledger core (Dr category / Cr bank) and links the transaction to it,
 *    marked `confirmed`. This is the settled-expense shape the inline
 *    recategorize (reverse + repost) flow corrects, and it makes the category
 *    appear in the period's P&L-backed inline-category options.
 *  - posted: false — inserts an unsettled `needs_review` OUTFLOW with no journal
 *    entry. This is the bank-side movement the Bills (AP) match picker scores as
 *    a settlement candidate (the scorer ignores already-confirmed rows), so an
 *    add-bill -> pay e2e can settle a real bill against it.
 *
 * Returns the row id plus a starting + a DIFFERENT target expense account so a
 * recategorize test can move the row from one category to another and assert it.
 */
export const seedDisposableExpense = mutation({
  args: {
    entityId: v.id("entities"),
    merchant: v.optional(v.string()),
    amountMinor: v.optional(v.number()),
    date: v.optional(v.string()),
    /** Whether to post a balanced journal entry. Defaults to true. */
    posted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const entity = await getEntityForWrite(ctx, args.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");

    const bankAccount = await ctx.db
      .query("bankAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .first();
    if (!bankAccount) {
      throw new Error("Disposable entity is missing a bank account to post against.");
    }

    // Two distinct expense accounts from the freshly-seeded chart: a starting
    // category for the row and a target to recategorize it onto.
    const expenseAccounts = (
      await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
        .take(500)
    ).filter((account) => account.type === "expense" && !account.archived && !account.isSystem);

    if (expenseAccounts.length < 2) {
      throw new Error("Disposable entity is missing expense accounts to seed against.");
    }
    const startAccount = expenseAccounts[0];
    const targetAccount = expenseAccounts[1];

    const now = Date.now();
    const date = args.date ?? new Date(now).toISOString().slice(0, 10);
    const amountMinor = -Math.abs(args.amountMinor ?? 4_200);
    const merchant = (args.merchant ?? "Disposable Vendor").trim();
    const posted = args.posted ?? true;

    let entryId: Id<"journalEntries"> | undefined;
    if (posted) {
      // Balanced spend entry (Dr category / Cr bank) through the shared core.
      const absAmount = Math.abs(amountMinor);
      const result = await postLedgerEntryCore(ctx, {
        entity,
        userId,
        date,
        memo: `${merchant} - test expense`,
        source: "manual",
        sourceId: `e3-test-expense-${now}`,
        lines: [
          { accountId: startAccount._id, debitMinor: absAmount, creditMinor: 0 },
          { accountId: bankAccount.ledgerAccountId, debitMinor: 0, creditMinor: absAmount },
        ],
      });
      entryId = result.entryId;

      // Also post a tiny spend to the TARGET category so it appears in the
      // period's P&L-backed inline-category options (the inline edit only offers
      // categories that already have spend this period). A recategorize test
      // moves the main row onto this target and asserts the change.
      await postLedgerEntryCore(ctx, {
        entity,
        userId,
        date,
        memo: `${merchant} - target category seed`,
        source: "manual",
        sourceId: `e3-test-target-${now}`,
        lines: [
          { accountId: targetAccount._id, debitMinor: 100, creditMinor: 0 },
          { accountId: bankAccount.ledgerAccountId, debitMinor: 0, creditMinor: 100 },
        ],
      });
    }

    const transactionId: Id<"transactions"> = await ctx.db.insert("transactions", {
      entityId: entity._id,
      bankAccountId: bankAccount._id,
      date,
      amountMinor,
      currency: entity.currency,
      merchant,
      rawDescription: `${merchant} test expense`,
      status: "posted",
      // A posted spend is confirmed; an unsettled bank movement stays
      // needs_review so the bill-match scorer treats it as a candidate.
      review: posted ? "confirmed" : "needs_review",
      source: "manual",
      ...(posted ? { categoryAccountId: startAccount._id } : {}),
      ...(entryId ? { entryId } : {}),
      externalId: `e3-test-expense-${now}`,
      evalSet: false,
      createdAt: now,
      updatedAt: now,
    });

    return {
      transactionId,
      startCategory: { id: startAccount._id, name: startAccount.name, number: startAccount.number },
      targetCategory: { id: targetAccount._id, name: targetAccount.name, number: targetAccount.number },
    };
  },
});
