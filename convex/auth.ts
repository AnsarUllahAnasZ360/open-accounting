import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexError, type GenericId } from "convex/values";

import { normalizeEmail, ownerEmail } from "./authz";
import type { MutationCtx } from "./_generated/server";

function profileInitials(name: string, email: string) {
  const base = name.trim() || email;
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts.at(-1)![0]}`.toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

async function ensureUserProfile(
  ctx: MutationCtx,
  args: {
    userId: GenericId<"users">;
    email: string;
    name?: string;
  },
) {
  const now = Date.now();
  const displayName = args.name?.trim() || args.email;
  const existing = await ctx.db
    .query("userProfiles")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .unique();
  const profile = {
    displayName,
    initials: profileInitials(displayName, args.email),
    avatarColor: "#17540f",
    timezone: "America/Chicago",
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, profile);
  } else {
    await ctx.db.insert("userProfiles", {
      userId: args.userId,
      ...profile,
      createdAt: now,
    });
  }
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = normalizeEmail(String(params.email ?? ""));
        if (!email) {
          throw new ConvexError("Email is required.");
        }

        const profile: { email: string; name?: string } = {
          email,
        };
        if (typeof params.name === "string" && params.name.trim()) {
          profile.name = params.name.trim();
        }
        return profile;
      },
    }),
  ],
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      const appCtx = ctx as unknown as MutationCtx;
      const email = normalizeEmail(String(args.profile.email ?? ""));
      if (!email) {
        throw new ConvexError("Email is required.");
      }

      const configuredOwner = ownerEmail();
      const invites = await appCtx.db
        .query("invites")
        .withIndex("by_email", (q) => q.eq("email", email))
        .collect();
      const invite = invites.find((candidate) => candidate.status === "pending") ?? null;
      const isOwner = configuredOwner !== null && email === configuredOwner;

      const now = Date.now();
      let userId = args.existingUserId as GenericId<"users"> | null;
      const providedName =
        typeof args.profile.name === "string" && args.profile.name.trim()
          ? args.profile.name.trim()
          : undefined;

      if (userId) {
        await appCtx.db.patch(userId, {
          email,
          ...(providedName ? { name: providedName } : {}),
        });
      } else {
        userId = await appCtx.db.insert("users", {
          email,
          ...(providedName ? { name: providedName } : {}),
        });
      }

      if (!args.existingUserId || providedName) {
        await ensureUserProfile(appCtx, { userId, email, name: providedName });
      }

      const workspaceId =
        isOwner || invite?.workspaceId ?
          await ensureWorkspaceForUser(appCtx, {
            userId,
            email,
            role: isOwner ? "owner" : (invite?.role ?? "member"),
            inviteWorkspaceId: invite?.workspaceId,
          })
        : null;

      if (invite && invite.status === "pending" && workspaceId) {
        await appCtx.db.patch(invite._id, {
          status: "accepted",
          workspaceId,
          acceptedByUserId: userId,
          acceptedAt: now,
          updatedAt: now,
        });
      }

      return userId;
    },
    async beforeSessionCreation(ctx, { userId }) {
      const appCtx = ctx as unknown as MutationCtx;
      const user = await appCtx.db.get(userId);
      const email = user?.email ? normalizeEmail(user.email) : null;

      if (email && ownerEmail() === email) {
        await ensureWorkspaceForUser(appCtx, {
          userId,
          email,
          role: "owner",
        });
      }

      const memberships = await appCtx.db
        .query("workspaceMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();

      // A brand-new owner may sign in before they have created a workspace.
      // Product onboarding will create the first workspace and membership.
    },
  },
});

export async function ensureWorkspaceForUser(
  ctx: MutationCtx,
  args: {
    userId: GenericId<"users">;
    email: string;
    role: "owner" | "admin" | "member";
    inviteWorkspaceId?: GenericId<"workspaces">;
  },
) {
  const now = Date.now();
  let workspaceId = args.inviteWorkspaceId;

  if (!workspaceId) {
    const existingWorkspace = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", "ansar-workspace"))
      .unique();

    if (existingWorkspace) {
      workspaceId = existingWorkspace._id;
      await ctx.db.patch(workspaceId, {
        name: "Ansar's workspace",
        updatedAt: now,
      });
    } else {
      workspaceId = await ctx.db.insert("workspaces", {
        name: "Ansar's workspace",
        slug: "ansar-workspace",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("workspaceSettings", {
        workspaceId,
        appName: "OpenBooks",
        defaultCurrency: "USD",
        fiscalYearStartMonth: 1,
        updatedAt: now,
      });
      await ctx.db.insert("auditEvents", {
        workspaceId,
        actorUserId: args.userId,
        action: "workspace.created",
        entityType: "workspace",
        entityId: workspaceId,
        summary: `Created owner workspace for ${args.email}`,
        createdAt: now,
      });
    }
  }

  const existingMembership = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_user_and_workspace", (q) =>
      q.eq("userId", args.userId).eq("workspaceId", workspaceId),
    )
    .unique();

  if (existingMembership) {
    await ctx.db.patch(existingMembership._id, {
      role: args.role,
      status: "active",
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId: args.userId,
      role: args.role,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }

  return workspaceId;
}
