import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  requireUserId,
  rolePermissionList,
  workspaceRoleDescription,
  workspaceRoleLabel,
} from "./authz";

const AVATAR_COLORS = ["#17540f", "#2ca01c", "#454545", "#525252", "#b54708"] as const;
const DEFAULT_TIMEZONE = "America/Chicago";

function normalizeDisplayName(value: string) {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2) {
    throw new ConvexError("Enter at least 2 characters for your display name.");
  }
  if (name.length > 80) {
    throw new ConvexError("Display name must be 80 characters or fewer.");
  }
  return name;
}

function initialsFrom(name: string, email: string | null | undefined) {
  const base = name.trim() || email?.trim() || "OpenBooks User";
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts.at(-1)![0]}`.toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

function fallbackName(user: Doc<"users"> | null) {
  return user?.name?.trim() || user?.email?.trim() || "OpenBooks User";
}

async function profileForUser(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  return await ctx.db
    .query("userProfiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

export async function profileSnapshot(
  ctx: QueryCtx | MutationCtx,
  user: Doc<"users"> | null,
  userId: Id<"users">,
) {
  const profile = await profileForUser(ctx, userId);
  const displayName = profile?.displayName ?? fallbackName(user);
  return {
    displayName,
    initials: profile?.initials ?? initialsFrom(displayName, user?.email),
    avatarColor: profile?.avatarColor ?? AVATAR_COLORS[0],
    timezone: profile?.timezone ?? DEFAULT_TIMEZONE,
    createdAt: profile?.createdAt ?? user?._creationTime ?? null,
    updatedAt: profile?.updatedAt ?? user?._creationTime ?? null,
  };
}

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const workspaceRows = await Promise.all(
      memberships
        .filter((membership) => membership.status === "active")
        .map(async (membership) => {
          const workspace = await ctx.db.get(membership.workspaceId);
          return {
            id: membership._id,
            workspaceId: membership.workspaceId,
            workspaceName: workspace?.name ?? "OpenBooks workspace",
            role: membership.role,
            roleLabel: workspaceRoleLabel(membership.role),
            roleDescription: workspaceRoleDescription(membership.role),
            permissions: rolePermissionList(membership.role),
            joinedAt: membership.createdAt,
          };
        }),
    );

    return {
      user: {
        id: userId,
        email: user?.email ?? null,
        name: user?.name ?? null,
      },
      profile: await profileSnapshot(ctx, user, userId),
      memberships: workspaceRows,
      auth: {
        passwordResetEnabled: Boolean(process.env.PLUNK_SECRET_KEY && process.env.PLUNK_FROM_EMAIL),
      },
    };
  },
});

export const update = mutation({
  args: {
    displayName: v.string(),
    timezone: v.string(),
    avatarColor: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    const displayName = normalizeDisplayName(args.displayName);
    const avatarColor = AVATAR_COLORS.includes(args.avatarColor as (typeof AVATAR_COLORS)[number])
      ? args.avatarColor
      : AVATAR_COLORS[0];
    const timezone = args.timezone.trim() || DEFAULT_TIMEZONE;
    const now = Date.now();
    const initials = initialsFrom(displayName, user?.email);

    const existing = await profileForUser(ctx, userId);
    if (existing) {
      await ctx.db.patch(existing._id, {
        displayName,
        initials,
        avatarColor,
        timezone,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("userProfiles", {
        userId,
        displayName,
        initials,
        avatarColor,
        timezone,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (user) {
      await ctx.db.patch(userId, { name: displayName });
    }

    return {
      displayName,
      initials,
      avatarColor,
      timezone,
      updatedAt: now,
    };
  },
});
