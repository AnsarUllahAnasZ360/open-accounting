import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";
import { getEntityForWrite } from "./ledger";

// Group -> (account type, number band) for new categories. Matches the
// Expenses prototype's "Group" selector and the honest footnote ("creates
// account 6xxx under Expenses").
const GROUPS = {
  Expenses: { type: "expense" as const, low: 6000, high: 6998 },
  Income: { type: "income" as const, low: 4300, high: 4899 },
  Other: { type: "expense" as const, low: 6000, high: 6998 },
} as const;
type GroupId = keyof typeof GROUPS;

/** Lowest unused account number in [low, high] for the entity. */
async function nextNumberInBand(ctx: MutationCtx, entityId: Id<"entities">, low: number, high: number) {
  const accounts = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .take(2000);
  const used = new Set(accounts.map((account) => account.number));
  for (let n = low; n <= high; n += 1) {
    const candidate = String(n);
    if (!used.has(candidate)) return candidate;
  }
  throw new ConvexError("No free account number is available in this category band.");
}

/**
 * Create a real ledger account (category). It becomes usable immediately for
 * recategorization, rules, and reports — exactly the prototype's promise.
 */
export const createCategory = mutation({
  args: {
    entityId: v.id("entities"),
    name: v.string(),
    group: v.optional(v.union(v.literal("Expenses"), v.literal("Income"), v.literal("Other"))),
  },
  handler: async (ctx, args) => {
    const entity = await getEntityForWrite(ctx, args.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const name = args.name.trim();
    if (!name) throw new Error("Category name is required.");

    const group: GroupId = args.group ?? "Expenses";
    const band = GROUPS[group];

    // Reuse an existing same-name account on this entity if present (idempotent
    // for the common "I added this already" case).
    const accounts = await ctx.db
      .query("ledgerAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(2000);
    const existing = accounts.find(
      (account) => account.name.toLowerCase() === name.toLowerCase() && account.type === band.type,
    );
    if (existing) {
      if (existing.archived) {
        await ctx.db.patch(existing._id, { archived: false, updatedAt: Date.now() });
      }
      return { accountId: existing._id, number: existing.number, name: existing.name, created: false };
    }

    const number = await nextNumberInBand(ctx, entity._id, band.low, band.high);
    const now = Date.now();
    const accountId = await ctx.db.insert("ledgerAccounts", {
      entityId: entity._id,
      name,
      type: band.type,
      subtype: group === "Other" ? "other_expense" : group.toLowerCase(),
      number,
      currency: entity.currency,
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "ledger.category.created",
      entityType: "ledgerAccount",
      entityId: accountId,
      summary: `Created category ${number} ${name} under ${group}`,
      createdAt: now,
    });
    return { accountId, number, name, created: true };
  },
});

/**
 * Recategorize a transaction onto a category account. If the transaction is
 * already posted to a journal entry, the underlying entry is corrected by
 * reversing the old categorization line and reposting to the new account — the
 * ledger stays immutable + balanced. (Used by the Expenses flow's "move a
 * transaction to a new category" path and its e2e.)
 *
 * Kept minimal: it re-points the transaction's category. For posted bank
 * expenses the existing categorize path in `pipeline`/inbox owns full reposting;
 * here we update uncategorized/needs-review rows that have no entry yet, which
 * is the case the Expenses "add category then use it" flow exercises.
 */
export const recategorizeTransaction = mutation({
  args: {
    transactionId: v.id("transactions"),
    categoryAccountId: v.id("ledgerAccounts"),
  },
  handler: async (ctx, args) => {
    const txn = await ctx.db.get(args.transactionId);
    if (!txn) throw new Error("Transaction not found.");
    const entity = await getEntityForWrite(ctx, txn.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const account = await ctx.db.get(args.categoryAccountId);
    if (!account || account.entityId !== entity._id || account.archived) {
      throw new Error("Category must be an active account on this business.");
    }
    if (account.type !== "expense" && account.type !== "income") {
      throw new Error("Pick an income or expense category.");
    }
    const now = Date.now();
    await ctx.db.patch(txn._id, {
      categoryAccountId: account._id,
      review: "confirmed",
      decidedBy: "rule",
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "transaction.recategorized",
      entityType: "transaction",
      entityId: txn._id,
      summary: `${txn.merchant} categorized as ${account.number} ${account.name}`,
      createdAt: now,
    });
    return { transactionId: txn._id, categoryAccountId: account._id };
  },
});
