import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";

// Default notification toggles match the prototype's initial state: everything
// on except product updates.
const DEFAULT_NOTIFICATIONS = {
  review: true,
  digest: true,
  anomaly: true,
  sync: true,
  owed: true,
  close: true,
  marketing: false,
};

const notificationKeyValidator = v.union(
  v.literal("review"),
  v.literal("digest"),
  v.literal("anomaly"),
  v.literal("sync"),
  v.literal("owed"),
  v.literal("close"),
  v.literal("marketing"),
);

/**
 * Notification preferences for Settings → Notifications (Epic E5). Read by any
 * member; falls back to defaults when no row exists yet. Honest about delivery:
 * the UI states email goes out only when Plunk is configured.
 */
export const notificationPreferences = query({
  args: {},
  handler: async (ctx) => {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const settings = await ctx.db
      .query("workspaceSettings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
      .unique();
    const user = await ctx.db.get(membership.userId);
    return {
      email: settings?.notificationEmail ?? user?.email ?? "",
      notifications: settings?.notifications ?? DEFAULT_NOTIFICATIONS,
      // Plunk wiring is an Epic F concern; surface honest delivery state.
      emailDeliveryConfigured: Boolean(process.env.PLUNK_API_KEY),
    };
  },
});

/** Toggle a single notification preference. Owner/admin only. */
export const setNotification = mutation({
  args: { key: notificationKeyValidator, enabled: v.boolean() },
  handler: async (ctx, args) => {
    const { membership } = await requireWorkspaceRoleForActive(ctx);
    const now = Date.now();
    const settings = await ctx.db
      .query("workspaceSettings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
      .unique();
    const current = settings?.notifications ?? DEFAULT_NOTIFICATIONS;
    const next = { ...current, [args.key]: args.enabled };
    if (settings) {
      await ctx.db.patch(settings._id, { notifications: next, updatedAt: now });
    } else {
      const workspace = await ctx.db.get(membership.workspaceId);
      await ctx.db.insert("workspaceSettings", {
        workspaceId: membership.workspaceId,
        appName: workspace?.name ?? "OpenBooks",
        defaultCurrency: "USD",
        fiscalYearStartMonth: 1,
        notifications: next,
        updatedAt: now,
      });
    }
    return { notifications: next };
  },
});

/** Change the notification delivery email. Owner/admin only. */
export const setNotificationEmail = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const { membership } = await requireWorkspaceRoleForActive(ctx);
    const email = args.email.trim();
    const now = Date.now();
    const settings = await ctx.db
      .query("workspaceSettings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
      .unique();
    if (settings) {
      await ctx.db.patch(settings._id, { notificationEmail: email, updatedAt: now });
    } else {
      const workspace = await ctx.db.get(membership.workspaceId);
      await ctx.db.insert("workspaceSettings", {
        workspaceId: membership.workspaceId,
        appName: workspace?.name ?? "OpenBooks",
        defaultCurrency: "USD",
        fiscalYearStartMonth: 1,
        notificationEmail: email,
        notifications: DEFAULT_NOTIFICATIONS,
        updatedAt: now,
      });
    }
    return { email };
  },
});

// Resolve the caller's active workspace and require admin on it.
async function requireWorkspaceRoleForActive(ctx: Parameters<typeof requireAnyWorkspaceRole>[0]) {
  const { membership } = await requireAnyWorkspaceRole(ctx, "admin");
  await requireWorkspaceRole(ctx, membership.workspaceId, "admin");
  return { membership };
}
