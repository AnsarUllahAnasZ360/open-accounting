import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireUserId, roleHasPermission, type WorkspacePermission } from "./authz";

// ---------------------------------------------------------------------------
// In-app notifications. One row per recipient, each with its own read state and
// an in-app link. Server helpers (notifyRoleHolders / notifyUser) are called by
// other mutations to fan a notification out to the right people — e.g. a
// submitted payroll run notifies every approver, and approving/sending-back
// notifies the preparer who submitted it.
// ---------------------------------------------------------------------------

type NotifyFields = {
  kind: string;
  title: string;
  body?: string;
  link?: string;
  actorUserId?: Id<"users">;
  entityId?: Id<"entities">;
};

function buildRow(workspaceId: Id<"workspaces">, userId: Id<"users">, fields: NotifyFields, now: number) {
  return {
    workspaceId,
    userId,
    kind: fields.kind,
    title: fields.title,
    ...(fields.body ? { body: fields.body } : {}),
    ...(fields.link ? { link: fields.link } : {}),
    ...(fields.actorUserId ? { actorUserId: fields.actorUserId } : {}),
    ...(fields.entityId ? { entityId: fields.entityId } : {}),
    createdAt: now,
  };
}

/**
 * Notify every ACTIVE member of a workspace whose role holds `permission`
 * (e.g. `payroll.approve` → owners + accountants), skipping the actor so people
 * are never pinged about their own action.
 */
export async function notifyRoleHolders(
  ctx: MutationCtx,
  args: { workspaceId: Id<"workspaces">; permission: WorkspacePermission } & NotifyFields,
): Promise<void> {
  const members = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
    .take(500);
  const now = Date.now();
  for (const member of members) {
    if (member.status !== "active") continue;
    if (!roleHasPermission(member.role, args.permission)) continue;
    if (args.actorUserId && member.userId === args.actorUserId) continue;
    await ctx.db.insert("notifications", buildRow(args.workspaceId, member.userId, args, now));
  }
}

/** Notify one specific user (no-op if they're the actor). */
export async function notifyUser(
  ctx: MutationCtx,
  args: { workspaceId: Id<"workspaces">; userId: Id<"users"> } & NotifyFields,
): Promise<void> {
  if (args.actorUserId && args.userId === args.actorUserId) return;
  await ctx.db.insert("notifications", buildRow(args.workspaceId, args.userId, args, Date.now()));
}

// ---------------------------------------------------------------------------
// Reads + read-state mutations (for the header bell)
// ---------------------------------------------------------------------------

/** Recent notifications for the signed-in user (+ unread count) for the bell. */
export const list = query({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    const scoped = args.workspaceId ? rows.filter((r) => r.workspaceId === args.workspaceId) : rows;
    return {
      unreadCount: scoped.filter((r) => r.readAt === undefined).length,
      notifications: scoped.slice(0, 30).map((r) => ({
        id: r._id,
        kind: r.kind,
        title: r.title,
        body: r.body ?? null,
        link: r.link ?? null,
        read: r.readAt !== undefined,
        createdAt: r.createdAt,
      })),
    };
  },
});

/** Mark one notification read (must belong to the caller). */
export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(args.notificationId);
    if (!row) return { ok: false };
    if (row.userId !== userId) throw new ConvexError("Not your notification.");
    if (row.readAt === undefined) await ctx.db.patch(row._id, { readAt: Date.now() });
    return { ok: true };
  },
});

/** Mark all of the caller's unread notifications read. */
export const markAllRead = mutation({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(200);
    const now = Date.now();
    let marked = 0;
    for (const row of rows) {
      if (row.readAt !== undefined) continue;
      if (args.workspaceId && row.workspaceId !== args.workspaceId) continue;
      await ctx.db.patch(row._id, { readAt: now });
      marked += 1;
    }
    return { marked };
  },
});
