import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";
import { getEntityForWrite, postLedgerEntryCore } from "./ledger";

// Which chart groups a category type belongs to in the friendly tree. Income and
// Expenses are the headline groups; equity/asset/liability/system land in Other.
function categoryGroup(account: Doc<"ledgerAccounts">): "Income" | "Expenses" | "Other" {
  if (account.type === "income") return "Income";
  if (account.type === "expense") return "Expenses";
  return "Other";
}

// Normal side of an account (Epic E12-T3). Standard double-entry convention:
// assets and expenses carry a DEBIT normal balance; liabilities, equity, and
// income carry a CREDIT normal balance. Derived from `type` — no schema field is
// needed and the posting path is untouched. Accountant mode surfaces this.
function normalSideFor(type: Doc<"ledgerAccounts">["type"]): "debit" | "credit" {
  return type === "asset" || type === "expense" ? "debit" : "credit";
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
            normalSide: normalSideFor(account.type),
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

/**
 * Set (or clear) the revenue STREAM tag on an income ledger account (Epic
 * E9-T8). Several income accounts can share one stream label so they roll up
 * into a single owner-facing stream on the dashboard revenue-by-stream widget.
 * Pass an empty/blank tag to clear it (the account then falls back to its own
 * name). Only valid on income accounts; the posting path never reads this.
 * Owner/admin only. This ships the minimal override so the widget works before
 * (or independent of) the onboarding AI-proposes/owner-approves taxonomy flow.
 */
export const setStreamTag = mutation({
  args: { accountId: v.id("ledgerAccounts"), streamTag: v.string() },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new ConvexError("Category not found.");
    if (account.type !== "income") {
      throw new ConvexError("Revenue streams can only be tagged on income accounts.");
    }
    const entity = await getEntityForWrite(ctx, account.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const streamTag = args.streamTag.trim();
    const now = Date.now();
    await ctx.db.patch(account._id, {
      streamTag: streamTag.length ? streamTag : undefined,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "ledger.category.streamTagged",
      entityType: "ledgerAccount",
      entityId: account._id,
      summary: streamTag.length
        ? `Tagged income account ${account.number} to stream "${streamTag}"`
        : `Cleared stream tag on income account ${account.number}`,
      createdAt: now,
    });
    return { accountId: account._id, streamTag: streamTag.length ? streamTag : null };
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
 * Move a non-system category between groups (Epic E12-T3). Reassigns the
 * account's `type`/`subtype` and renumbers it into the destination group's
 * number band (Income → 4xxx, Expenses/Other → 6xxx — matching the bands the
 * "Add category" UI documents). System accounts cannot be moved. Posted journal
 * lines reference the account by id, so existing history follows the account to
 * its new group with no reposting — only the account doc is patched. Owner/admin
 * only; writes an audit event. No ledger posting or money math is touched.
 */
export const moveGroup = mutation({
  args: {
    accountId: v.id("ledgerAccounts"),
    group: v.union(v.literal("Expenses"), v.literal("Income"), v.literal("Other")),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new ConvexError("Category not found.");
    const entity = await getEntityForWrite(ctx, account.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    if (account.isSystem) throw new ConvexError("System categories can't be moved.");

    const group: GroupId = args.group;
    const band = GROUPS[group];

    // No-op when the account is already in the destination group's type band.
    const currentGroup = categoryGroup(account);
    if (currentGroup === group && account.type === band.type) {
      return { accountId: account._id, group, number: account.number, moved: false as const };
    }

    // Renumber only when changing type bands (Income⇄Expenses). Within the same
    // type band (Expenses⇄Other both map to 6xxx) keep the existing number so we
    // don't churn account numbers that already work.
    const now = Date.now();
    let number = account.number;
    if (account.type !== band.type) {
      number = await nextNumberInBand(ctx, entity._id, band.low, band.high);
    }
    await ctx.db.patch(account._id, {
      type: band.type,
      subtype: group === "Other" ? "other_expense" : group.toLowerCase(),
      number,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "ledger.category.moved",
      entityType: "ledgerAccount",
      entityId: account._id,
      summary: `Moved category ${account.name} to ${group} (account ${number})`,
      createdAt: now,
    });
    return { accountId: account._id, group, number, moved: true as const };
  },
});

/**
 * Recategorize a transaction onto a category account. Two cases, both keeping
 * the ledger immutable + balanced:
 *  - Already posted to a journal entry (the common settled-expense case): the
 *    underlying entry is corrected by REVERSING the original entry (each line
 *    inverted, exactly) and REPOSTING a fresh entry with the old category line
 *    swapped for the new account. Posted entries are never mutated in place;
 *    the correction is a reverse + repost pair, and `postLedgerEntryCore` owns
 *    the balance + reversal-invert checks. The transaction repoints at the new
 *    entry so reports (which query journal lines) move the spend cleanly.
 *  - No entry yet (uncategorized / needs-review row): just re-point the
 *    transaction's category — there is no posting to correct.
 * Admin-gated; re-checks workspace authorization on the server.
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

    // No-op move: same category — nothing to repost.
    if (txn.categoryAccountId === account._id) {
      return { transactionId: txn._id, categoryAccountId: account._id, reposted: false as const };
    }

    let newEntryId = txn.entryId ?? null;

    // Posted entry → reverse + repost so the journal lines (and therefore the
    // P&L) move from the old category to the new one. Only re-point the line that
    // was booked to the OLD category account; every other line (the bank side)
    // is preserved exactly.
    if (txn.entryId && txn.categoryAccountId) {
      const oldCategoryId = txn.categoryAccountId;
      const originalLines = await ctx.db
        .query("journalLines")
        .withIndex("by_entry", (q) => q.eq("entryId", txn.entryId!))
        .collect();

      if (originalLines.length >= 2) {
        // Reverse: each line inverted (debit<->credit), exactly.
        const reversedLines = originalLines.map((line) => ({
          accountId: line.accountId,
          debitMinor: line.creditMinor,
          creditMinor: line.debitMinor,
        }));
        await postLedgerEntryCore(ctx, {
          entity,
          userId,
          date: txn.date,
          memo: `${txn.merchant} - recategorize reversal`,
          source: "manual",
          sourceId: `recategorize:${txn._id}:reverse`,
          reversesEntryId: txn.entryId,
          auditAction: "transaction.recategorized",
          lines: reversedLines,
        });

        // Repost: same shape, but the line that hit the old category now hits the
        // new one. (Currency is taken from the new posting's entity default.)
        const repostLines = originalLines.map((line) => ({
          accountId: line.accountId === oldCategoryId ? account._id : line.accountId,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor,
        }));
        const repost = await postLedgerEntryCore(ctx, {
          entity,
          userId,
          date: txn.date,
          memo: `${txn.merchant} - ${account.number} ${account.name}`,
          source: "manual",
          sourceId: `recategorize:${txn._id}:repost`,
          auditAction: "transaction.recategorized",
          lines: repostLines,
        });
        newEntryId = repost.entryId;
      }
    }

    await ctx.db.patch(txn._id, {
      categoryAccountId: account._id,
      ...(newEntryId ? { entryId: newEntryId } : {}),
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
    return { transactionId: txn._id, categoryAccountId: account._id, reposted: Boolean(txn.entryId) };
  },
});
