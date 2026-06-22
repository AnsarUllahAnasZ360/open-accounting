import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";

// ---------------------------------------------------------------------------
// Owner/team comments on a single transaction (collaboration thread). These are
// NON-LEDGER notes: no journal entry is posted and posted ledger history is
// never touched. Both functions re-derive the caller server-side and re-check
// workspace authorization against the transaction's OWN entity → workspace, so
// no client-supplied workspace/entity is ever trusted.
//
// Member is the minimum role to read or write a comment (a teammate who can see
// the books can leave a note); the same `requireWorkspaceRole` helper the rest
// of the backend uses returns `{ userId, membership }` (see authz.ts:60-82),
// and we take `userId` from it exactly like contacts.ts does (contacts.ts:29).
// ---------------------------------------------------------------------------

/**
 * Resolve the caller's display name the same way the profile module does
 * (profile.ts:29-46): prefer the editable `userProfiles.displayName`, then fall
 * back to the auth user's `name`, then `email`, then a stable default. Used to
 * stamp `authorName` on the comment so the thread reads even if the user is
 * later removed from the workspace.
 */
async function resolveAuthorName(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  user: Doc<"users"> | null,
) {
  const profile = await ctx.db
    .query("userProfiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  return (
    profile?.displayName?.trim() ||
    user?.name?.trim() ||
    user?.email?.trim() ||
    "OpenBooks User"
  );
}

/**
 * Add a comment to a transaction. Entity/workspace authorization is re-checked
 * server-side from the transaction's own entity (never a client argument).
 * Member role can comment. Empty/whitespace text is rejected.
 */
export const addTransactionComment = mutation({
  args: {
    transactionId: v.id("transactions"),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction) throw new ConvexError("Transaction not found.");

    const entity = await ctx.db.get(transaction.entityId);
    if (!entity) throw new ConvexError("Transaction entity not found.");

    // Re-check workspace authorization on the server. `requireWorkspaceRole`
    // returns `{ userId, membership }` (authz.ts:81); we take `userId` from it
    // just like contacts.ts:29.
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "member");

    const text = args.text.trim();
    if (!text) throw new ConvexError("Comment can't be empty.");

    const user = await ctx.db.get(userId);
    const authorName = await resolveAuthorName(ctx, userId, user);

    const now = Date.now();
    const commentId = await ctx.db.insert("transactionComments", {
      entityId: entity._id,
      transactionId: transaction._id,
      userId,
      authorName,
      text,
      createdAt: now,
      updatedAt: now,
    });
    return commentId;
  },
});

/**
 * List the newest comments on a transaction (most recent first, bounded).
 * Authorization is re-checked server-side from the transaction's own entity →
 * workspace; member role can read.
 */
export const listTransactionComments = query({
  args: {
    transactionId: v.id("transactions"),
  },
  handler: async (ctx, args) => {
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction) throw new ConvexError("Transaction not found.");

    const entity = await ctx.db.get(transaction.entityId);
    if (!entity) throw new ConvexError("Transaction entity not found.");

    // Re-check workspace authorization on the server before returning notes.
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");

    const comments = await ctx.db
      .query("transactionComments")
      .withIndex("by_transaction", (q) => q.eq("transactionId", transaction._id))
      .order("desc")
      .take(200);

    return comments.map((comment) => ({
      id: comment._id,
      text: comment.text,
      authorName: comment.authorName ?? null,
      userId: comment.userId,
      createdAt: comment.createdAt,
    }));
  },
});
