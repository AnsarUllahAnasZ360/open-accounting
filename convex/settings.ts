import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import {
  requireAnyWorkspacePermission,
  requireAnyWorkspaceRole,
  requireWorkspacePermission,
} from "./authz";

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

// Default tax set-aside reserve rate (Epic E9-T3 / decisions Q46): 30% of
// trailing book net income. Single flat workspace rate, editable below.
export const DEFAULT_TAX_SET_ASIDE_PCT = 0.3;

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
    // E3-T7: a saved BYO Plunk credential counts as configured, alongside env.
    const plunkRows = await ctx.db
      .query("credentials")
      .withIndex("by_workspace_and_kind", (q) => q.eq("workspaceId", membership.workspaceId).eq("kind", "plunk"))
      .take(1);
    const notifications = settings?.notifications ?? DEFAULT_NOTIFICATIONS;
    // E12-T5: derive an off/weekly/monthly cadence from the digest toggle + the
    // stored digestCadence field. "off" maps to the digest toggle being off so
    // the existing toggle stays the master switch; weekly/monthly come from the
    // additive digestCadence field (defaults weekly when digest is on).
    const digestCadence: "off" | "weekly" | "monthly" = notifications.digest
      ? settings?.digestCadence ?? "weekly"
      : "off";
    return {
      email: settings?.notificationEmail ?? user?.email ?? "",
      notifications,
      digestCadence,
      emailDeliveryConfigured:
        plunkRows.length > 0 || Boolean(process.env.PLUNK_SECRET_KEY || process.env.PLUNK_API_KEY),
      // Tax set-aside reserve rate the AI CFO uses (E9-T3); flat workspace rate.
      taxSetAsidePct: settings?.taxSetAsidePct ?? DEFAULT_TAX_SET_ASIDE_PCT,
    };
  },
});

/**
 * Set the workspace tax set-aside reserve rate (Epic E9-T3 / decisions Q46). A
 * flat fraction in (0, 1) — the AI CFO's tax signal multiplies it by trailing
 * book net income to produce a "money to park" ESTIMATE (never a posted entry,
 * always shown with a "not tax advice" disclaimer). Owner/admin only.
 */
export const setTaxSetAsidePct = mutation({
  args: { pct: v.number() },
  handler: async (ctx, args) => {
    const { membership } = await requireWorkspaceRoleForActive(ctx);
    if (!Number.isFinite(args.pct) || args.pct < 0 || args.pct >= 1) {
      throw new Error("Tax set-aside rate must be a fraction between 0 and 1 (e.g. 0.30 for 30%).");
    }
    const pct = Math.round(args.pct * 10000) / 10000;
    const now = Date.now();
    const settings = await ctx.db
      .query("workspaceSettings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
      .unique();
    if (settings) {
      await ctx.db.patch(settings._id, { taxSetAsidePct: pct, updatedAt: now });
    } else {
      const workspace = await ctx.db.get(membership.workspaceId);
      await ctx.db.insert("workspaceSettings", {
        workspaceId: membership.workspaceId,
        appName: workspace?.name ?? "OpenBooks",
        defaultCurrency: "USD",
        fiscalYearStartMonth: 1,
        notifications: DEFAULT_NOTIFICATIONS,
        taxSetAsidePct: pct,
        updatedAt: now,
      });
    }
    return { taxSetAsidePct: pct };
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

// Conservative, server-side email-format guard (E12-T5). Mirrors the client
// check so an invalid delivery email is rejected before it ever persists.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Set the weekly-digest cadence (Epic E12-T5 / decisions Q47). "off" turns the
 * digest notification OFF (master switch); "weekly"/"monthly" turn it on and set
 * the additive `digestCadence` field. The actual send job (cron → sendPlunkEmail,
 * Monday 13:00 UTC) is owned by E9-T6 and reads digestCadence — this only owns
 * the preference. Owner/admin only.
 */
export const setNotificationCadence = mutation({
  args: { cadence: v.union(v.literal("off"), v.literal("weekly"), v.literal("monthly")) },
  handler: async (ctx, args) => {
    const { membership } = await requireWorkspaceRoleForActive(ctx);
    const now = Date.now();
    const settings = await ctx.db
      .query("workspaceSettings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
      .unique();
    const current = settings?.notifications ?? DEFAULT_NOTIFICATIONS;
    const digestOn = args.cadence !== "off";
    const notifications = { ...current, digest: digestOn };
    // Only "weekly"/"monthly" map onto the cadence field; "off" leaves it as-is
    // (digest is the master switch) so re-enabling restores the last cadence.
    const digestCadence = args.cadence === "off" ? settings?.digestCadence ?? "weekly" : args.cadence;
    if (settings) {
      await ctx.db.patch(settings._id, { notifications, digestCadence, updatedAt: now });
    } else {
      const workspace = await ctx.db.get(membership.workspaceId);
      await ctx.db.insert("workspaceSettings", {
        workspaceId: membership.workspaceId,
        appName: workspace?.name ?? "OpenBooks",
        defaultCurrency: "USD",
        fiscalYearStartMonth: 1,
        notifications,
        digestCadence,
        updatedAt: now,
      });
    }
    return { cadence: args.cadence };
  },
});

/** Change the notification delivery email. Owner/admin only. */
export const setNotificationEmail = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const { membership } = await requireWorkspaceRoleForActive(ctx);
    const email = args.email.trim();
    // Allow clearing (empty falls back to the account email); otherwise validate.
    if (email.length > 0 && !EMAIL_RE.test(email)) {
      throw new Error("Enter a valid email address for digest delivery.");
    }
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

// Resolve the caller's active workspace and require settings management on it.
async function requireWorkspaceRoleForActive(ctx: Parameters<typeof requireAnyWorkspaceRole>[0]) {
  const { membership } = await requireAnyWorkspacePermission(ctx, "settings.manage");
  await requireWorkspacePermission(ctx, membership.workspaceId, "settings.manage");
  return { membership };
}
