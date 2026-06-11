import { convexAuth } from "@convex-dev/auth/server";
import { Email } from "@convex-dev/auth/providers/Email";
import { Password } from "@convex-dev/auth/providers/Password";
import type { GenericId } from "convex/values";

import { normalizeEmail, ownerEmail } from "./authz";
import type { MutationCtx } from "./_generated/server";

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function plunkBaseUrl() {
  return (process.env.PLUNK_API_BASE_URL ?? "https://api.plunk.zikrainfotech.com").replace(
    /\/$/,
    "",
  );
}

async function sendPlunkMagicLink({
  identifier,
  url,
}: {
  identifier: string;
  url: string;
}) {
  const response = await fetch(`${plunkBaseUrl()}/v1/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("PLUNK_SECRET_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: identifier,
      from: requiredEnv("PLUNK_FROM_EMAIL"),
      fromName: process.env.PLUNK_FROM_NAME ?? "OpenBooks",
      subject: "Sign in to OpenBooks",
      body: `
        <p>Use this secure link to sign in to OpenBooks:</p>
        <p><a href="${url}">Sign in to OpenBooks</a></p>
        <p>If the button does not work, copy and paste this URL into your browser:</p>
        <p>${url}</p>
      `,
    }),
  });

  if (!response.ok) {
    throw new Error(`Plunk email send failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { success?: boolean; error?: { message?: string } };
  if (payload.success === false) {
    throw new Error(payload.error?.message ?? "Plunk email send failed");
  }
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = normalizeEmail(String(params.email ?? ""));
        if (!email) {
          throw new Error("Email is required.");
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
    Email({
      id: "plunk",
      name: "Plunk",
      authorize: undefined,
      from: process.env.PLUNK_FROM_EMAIL ?? "OpenBooks",
      sendVerificationRequest: async ({ identifier, url }) => {
        await sendPlunkMagicLink({ identifier, url });
      },
    }),
  ],
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      const appCtx = ctx as unknown as MutationCtx;
      const email = normalizeEmail(String(args.profile.email ?? ""));
      if (!email) {
        throw new Error("Email is required.");
      }

      const configuredOwner = ownerEmail();
      const invite = await appCtx.db
        .query("invites")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      const isOwner = configuredOwner !== null && email === configuredOwner;

      if (!args.existingUserId && !isOwner && invite?.status !== "pending") {
        throw new Error("OpenBooks is invite-only. Request access from the landing page.");
      }

      const now = Date.now();
      let userId = args.existingUserId as GenericId<"users"> | null;

      if (userId) {
        await appCtx.db.patch(userId, {
          email,
          name:
            typeof args.profile.name === "string" && args.profile.name.trim()
              ? args.profile.name.trim()
            : undefined,
        });
      } else {
        userId = await appCtx.db.insert("users", {
          email,
          name:
            typeof args.profile.name === "string" && args.profile.name.trim()
              ? args.profile.name.trim()
              : undefined,
        });
      }

      const workspaceId = await ensureWorkspaceForUser(appCtx, {
        userId,
        email,
        role: isOwner ? "owner" : (invite?.role ?? "member"),
        inviteWorkspaceId: invite?.workspaceId,
      });

      if (invite && invite.status === "pending") {
        await appCtx.db.patch(invite._id, {
          status: "accepted",
          workspaceId,
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

      if (!memberships.some((membership) => membership.status === "active")) {
        throw new Error("OpenBooks is invite-only. Request access from the landing page.");
      }
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
