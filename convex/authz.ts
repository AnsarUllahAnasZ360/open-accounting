import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export type WorkspaceRole = "owner" | "admin" | "member";

const roleRank: Record<WorkspaceRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function ownerEmail() {
  const value = process.env.OWNER_EMAIL;
  return value ? normalizeEmail(value) : null;
}

export async function requireUserId(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("OpenBooks requires sign-in.");
  }
  return userId as Id<"users">;
}

export async function requireWorkspaceRole(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
  minimumRole: WorkspaceRole = "member",
) {
  const userId = await requireUserId(ctx);
  const membership = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_user_and_workspace", (q) =>
      q.eq("userId", userId).eq("workspaceId", workspaceId),
    )
    .unique();

  if (
    !membership ||
    membership.status !== "active" ||
    roleRank[membership.role] < roleRank[minimumRole]
  ) {
    throw new Error("You do not have access to this OpenBooks workspace.");
  }

  return { userId, membership };
}

export async function requireAnyWorkspaceRole(
  ctx: QueryCtx | MutationCtx,
  minimumRole: WorkspaceRole = "member",
) {
  const userId = await requireUserId(ctx);
  const memberships = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const membership = memberships.find(
    (candidate) =>
      candidate.status === "active" &&
      roleRank[candidate.role] >= roleRank[minimumRole],
  );

  if (!membership) {
    throw new Error("You do not have access to an OpenBooks workspace.");
  }

  return { userId, membership };
}
