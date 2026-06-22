import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export type WorkspaceRole = "owner" | "accountant" | "hr" | "admin" | "member";
export type CanonicalWorkspaceRole = "owner" | "accountant" | "hr";

export type WorkspacePermission =
  | "workspace.admin"
  | "workspace.reset"
  | "team.manage"
  | "settings.manage"
  | "business.manage"
  | "connections.manage"
  | "books.view"
  | "books.manage"
  | "ledger.post"
  | "reports.view"
  | "payroll.view"
  | "payroll.manage";

const roleRank: Record<WorkspaceRole, number> = {
  hr: 0,
  member: 0,
  accountant: 2,
  admin: 2,
  owner: 3,
};

const roleLabels: Record<CanonicalWorkspaceRole, string> = {
  owner: "Owner",
  accountant: "Accountant",
  hr: "HR",
};

const roleDescriptions: Record<CanonicalWorkspaceRole, string> = {
  owner: "Full control of workspace, team, businesses, connections, payroll, reports, and reset tools.",
  accountant: "Bookkeeping, reconciliation, chart/rules, reports, imports, and ledger corrections without owner-only administration.",
  hr: "Payroll and employee-pay workflows only; no general books, connectors, team, or workspace settings.",
};

const rolePermissions: Record<CanonicalWorkspaceRole, ReadonlySet<WorkspacePermission>> = {
  owner: new Set([
    "workspace.admin",
    "workspace.reset",
    "team.manage",
    "settings.manage",
    "business.manage",
    "connections.manage",
    "books.view",
    "books.manage",
    "ledger.post",
    "reports.view",
    "payroll.view",
    "payroll.manage",
  ]),
  accountant: new Set([
    "settings.manage",
    "business.manage",
    "connections.manage",
    "books.view",
    "books.manage",
    "ledger.post",
    "reports.view",
  ]),
  hr: new Set(["payroll.view", "payroll.manage"]),
};

export function canonicalWorkspaceRole(role: WorkspaceRole): CanonicalWorkspaceRole {
  if (role === "admin") return "accountant";
  if (role === "member") return "hr";
  return role;
}

export function workspaceRoleLabel(role: WorkspaceRole | null | undefined) {
  if (!role) return "Member";
  return roleLabels[canonicalWorkspaceRole(role)] ?? role;
}

export function workspaceRoleDescription(role: WorkspaceRole | null | undefined) {
  if (!role) return "";
  return roleDescriptions[canonicalWorkspaceRole(role)] ?? "";
}

export function roleHasPermission(role: WorkspaceRole, permission: WorkspacePermission) {
  return rolePermissions[canonicalWorkspaceRole(role)].has(permission);
}

export function rolePermissionList(role: WorkspaceRole) {
  return Array.from(rolePermissions[canonicalWorkspaceRole(role)]);
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function ownerEmail() {
  const value = process.env.OWNER_EMAIL;
  return value ? normalizeEmail(value) : null;
}

export function isDevAuthBypassEnabled() {
  if (process.env.OPENBOOKS_DEV_AUTH_BYPASS !== "1") return false;
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) return false;

  try {
    const { hostname } = new URL(siteUrl);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

async function devAuthBypassUserId(ctx: QueryCtx | MutationCtx) {
  if (!isDevAuthBypassEnabled()) return null;
  const email = normalizeEmail(process.env.OPENBOOKS_DEV_OWNER_EMAIL ?? process.env.OWNER_EMAIL ?? "");
  if (!email) {
    throw new Error("OpenBooks dev auth bypass needs OPENBOOKS_DEV_OWNER_EMAIL or OWNER_EMAIL.");
  }

  const users = await ctx.db.query("users").collect();
  const user = users.find((candidate) => candidate.email && normalizeEmail(candidate.email) === email);
  if (!user) {
    throw new Error("OpenBooks dev auth bypass needs a bootstrapped owner account. Run `npx convex run authAdmin:bootstrapOwner`.");
  }
  return user._id;
}

export async function requireUserId(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    const devUserId = await devAuthBypassUserId(ctx);
    if (devUserId) return devUserId;
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

export async function requireWorkspacePermission(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
  permission: WorkspacePermission,
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
    !roleHasPermission(membership.role, permission)
  ) {
    throw new Error("You do not have access or permission to do that in this OpenBooks workspace.");
  }

  return { userId, membership };
}

/**
 * Authorize access to an OpenBooks AI chat thread.
 *
 * Thread ownership is app-owned via the `chatThreads` table (the agent
 * component does not enforce workspace authz). This re-derives the caller's
 * identity from `ctx` and re-checks workspace membership for the thread's
 * workspace, then returns the ownership row plus its workspace/entity so
 * callers never trust client-supplied workspace/entity args.
 */
export async function authorizeThreadAccess(
  ctx: QueryCtx | MutationCtx,
  threadId: string,
  minimumRole: WorkspaceRole = "member",
) {
  const userId = await requireUserId(ctx);
  const record = await ctx.db
    .query("chatThreads")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .unique();
  if (!record) {
    throw new Error("OpenBooks chat thread not found.");
  }
  const { membership } = await requireWorkspaceRole(ctx, record.workspaceId, minimumRole);
  return { userId, membership, record };
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

export async function requireAnyWorkspacePermission(
  ctx: QueryCtx | MutationCtx,
  permission: WorkspacePermission,
) {
  const userId = await requireUserId(ctx);
  const memberships = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const membership = memberships.find(
    (candidate) =>
      candidate.status === "active" && roleHasPermission(candidate.role, permission),
  );

  if (!membership) {
    throw new Error("You do not have access or permission to do that in any OpenBooks workspace.");
  }

  return { userId, membership };
}
