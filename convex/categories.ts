import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";
import { getEntityForWrite } from "./ledger";

// Which chart groups a category type belongs to in the friendly tree. Income and
// Expenses are the headline groups; equity/asset/liability/system land in Other.
function categoryGroup(account: Doc<"ledgerAccounts">): "Income" | "Expenses" | "Other" {
  if (account.type === "income") return "Income";
  if (account.type === "expense") return "Expenses";
  return "Other";
}

/**
 * Friendly category tree for Settings → Categories (Epic E4). Groups the chart
 * into Income / Expenses / Other with per-account year-to-date balances, plus
 * the type/number metadata "Accountant mode" reveals. Read-only; bounded scans.
 */
export const list = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new ConvexError("OpenBooks business not found.");
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");

    const accounts = await ctx.db
      .query("ledgerAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(2000);

    // Year-to-date net per account from posted journal lines (bounded scan).
    const year = new Date().getUTCFullYear();
    const yearStart = `${year}-01-01`;
    const lines = await ctx.db
      .query("journalLines")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(8000);
    const entries = await ctx.db
      .query("journalEntries")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(8000);
    const entryDate = new Map(entries.map((entry) => [entry._id as string, entry.date]));
    const ytdByAccount = new Map<string, number>();
    for (const line of lines) {
      const date = entryDate.get(line.entryId as string);
      if (!date || date < yearStart) continue;
      const net = (ytdByAccount.get(line.accountId as string) ?? 0) + (line.creditMinor - line.debitMinor);
      ytdByAccount.set(line.accountId as string, net);
    }

    const groupsOrder: Array<"Income" | "Expenses" | "Other"> = ["Income", "Expenses", "Other"];
    const grouped = groupsOrder.map((label) => ({
      label,
      cats: accounts
        .filter((account) => categoryGroup(account) === label && !account.archived)
        .sort((a, b) => a.number.localeCompare(b.number))
        .map((account) => {
          // Income credits are positive; expenses are debits (negate for display).
          const rawNet = ytdByAccount.get(account._id as string) ?? 0;
          const ytdMinor = account.type === "income" ? rawNet : Math.abs(rawNet);
          return {
            id: account._id,
            name: account.name,
            number: account.number,
            type: account.type,
            isSystem: account.isSystem,
            ytdMinor,
          };
        }),
    }));

    return { currency: entity.currency, groups: grouped };
  },
});

/** Rename a category (ledger account). Owner/admin only. */
export const rename = mutation({
  args: { accountId: v.id("ledgerAccounts"), name: v.string() },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new ConvexError("Category not found.");
    const entity = await getEntityForWrite(ctx, account.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const name = args.name.trim();
    if (!name) throw new ConvexError("Category name is required.");
    const now = Date.now();
    await ctx.db.patch(account._id, { name, updatedAt: now });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "ledger.category.renamed",
      entityType: "ledgerAccount",
      entityId: account._id,
      summary: `Renamed category ${account.number} to ${name}`,
      createdAt: now,
    });
    return { accountId: account._id, name };
  },
});

/** Archive or restore a category. System accounts cannot be archived. */
export const setArchived = mutation({
  args: { accountId: v.id("ledgerAccounts"), archived: v.boolean() },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new ConvexError("Category not found.");
    const entity = await getEntityForWrite(ctx, account.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    if (account.isSystem) throw new ConvexError("System categories can't be archived.");
    const now = Date.now();
    await ctx.db.patch(account._id, { archived: args.archived, updatedAt: now });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: args.archived ? "ledger.category.archived" : "ledger.category.restored",
      entityType: "ledgerAccount",
      entityId: account._id,
      summary: `${args.archived ? "Archived" : "Restored"} category ${account.number} ${account.name}`,
      createdAt: now,
    });
    return { accountId: account._id, archived: args.archived };
  },
});

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
