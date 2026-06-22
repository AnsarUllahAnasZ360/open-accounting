import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  canonicalWorkspaceRole,
  normalizeEmail,
  requireAnyWorkspacePermission,
  requireAnyWorkspaceRole,
  requireWorkspacePermission,
  roleHasPermission,
  workspaceRoleDescription,
  workspaceRoleLabel,
} from "./authz";

function siteUrl() {
  return (process.env.SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function createInviteToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashInviteToken(token: string) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function initials(name: string | null | undefined, email: string) {
  const base = name?.trim() || email;
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts.at(-1)![0]}`.toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

/**
 * Team for Settings → Team (Epic E5): active members (joined to users) plus
 * pending invites. Any member can read; only Owner can mutate team access.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { userId: viewerUserId, membership } = await requireAnyWorkspaceRole(ctx, "member");
    const [members, invites, workspace] = await Promise.all([
      ctx.db.query("workspaceMembers").withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId)).take(100),
      ctx.db.query("invites").withIndex("by_status", (q) => q.eq("status", "pending")).take(100),
      ctx.db.get(membership.workspaceId),
    ]);

    const activeMembers = members.filter((m) => m.status === "active");
    // Last-owner guard input (E12-T6): an owner can only be demoted/removed when
    // another active owner remains. Surfaced to the UI so the role Select and
    // remove action disable themselves for the final owner.
    const ownerCount = activeMembers.filter((m) => canonicalWorkspaceRole(m.role) === "owner").length;

    const memberRows = await Promise.all(
      activeMembers.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        const name = user?.name ?? null;
        const email = user?.email ?? "";
        const canonical = canonicalWorkspaceRole(m.role);
        const isLastOwner = canonical === "owner" && ownerCount <= 1;
        return {
          id: m._id,
          name: name ?? email ?? "Member",
          email,
          role: canonical,
          roleLabel: workspaceRoleLabel(m.role),
          roleDesc: workspaceRoleDescription(m.role),
          initials: initials(name, email),
          pending: false,
          // E12-T6: the sole owner cannot be demoted or removed.
          isLastOwner,
          isSelf: m.userId === viewerUserId,
        };
      }),
    );

    const inviteRows = invites
      .filter((invite) => invite.workspaceId === membership.workspaceId)
      .map((invite) => ({
        id: invite._id,
        name: invite.email,
        email: invite.email,
        role: canonicalWorkspaceRole(invite.role),
        roleLabel: workspaceRoleLabel(invite.role),
        roleDesc: workspaceRoleDescription(invite.role),
        initials: initials(null, invite.email),
        pending: true,
        isLastOwner: false,
        isSelf: false,
      }));

    // E3-T7: email delivery is configured if a saved BYO Plunk credential exists
    // for this workspace OR the env key is set (back-compat).
    const plunkRows = await ctx.db
      .query("credentials")
      .withIndex("by_workspace_and_kind", (q) => q.eq("workspaceId", membership.workspaceId).eq("kind", "plunk"))
      .take(1);
    const emailDeliveryConfigured =
      plunkRows.length > 0 || Boolean(process.env.PLUNK_SECRET_KEY || process.env.PLUNK_API_KEY);

    return {
      members: [...memberRows, ...inviteRows],
      myRole: membership.role,
      canManage: roleHasPermission(membership.role, "team.manage"),
      emailDeliveryConfigured,
      workspaceName: workspace?.name ?? "this workspace",
    };
  },
});

/**
 * Invite a teammate by email. Owner only. Creates a pending invite record
 * for this workspace; it does NOT send email here (that is Epic F3 / Plunk).
 * The UI surfaces the honest pending state.
 */
export const invite = mutation({
  args: {
    email: v.string(),
    role: v.union(v.literal("accountant"), v.literal("hr"), v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireAnyWorkspacePermission(ctx, "team.manage");
    await requireWorkspacePermission(ctx, membership.workspaceId, "team.manage");
    const email = normalizeEmail(args.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ConvexError("Enter a valid email address.");
    }

    const existing = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(20);
    const pending = existing.find((invite) => invite.status === "pending" && invite.workspaceId === membership.workspaceId);
    const now = Date.now();
    const token = createInviteToken();
    const tokenHash = await hashInviteToken(token);
    const invitePath = `/invite/${token}`;
    const inviteUrl = `${siteUrl()}${invitePath}`;
    const role =
      args.role === "admin" ? "accountant"
      : args.role === "member" ? "hr"
      : args.role;
    if (pending) {
      await ctx.db.patch(pending._id, { role, tokenHash, updatedAt: now });
      return { inviteId: pending._id, status: "updated" as const, emailSent: false, invitePath, inviteUrl };
    }

    const inviteId = await ctx.db.insert("invites", {
      email,
      role,
      status: "pending",
      workspaceId: membership.workspaceId,
      tokenHash,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      workspaceId: membership.workspaceId,
      actorUserId: userId,
      action: "team.invited",
      entityType: "invite",
      entityId: inviteId,
      summary: `Invited ${email} as ${workspaceRoleLabel(role)}`,
      createdAt: now,
    });
    return { inviteId, status: "created" as const, emailSent: false, invitePath, inviteUrl };
  },
});

export const lookupInvite = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (!args.token || args.token.length < 32) {
      return { status: "invalid" as const };
    }
    const tokenHash = await hashInviteToken(args.token);
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!invite) {
      return { status: "invalid" as const };
    }
    const workspace = invite.workspaceId ? await ctx.db.get(invite.workspaceId) : null;
    return {
      status: invite.status,
      email: invite.email,
      role: invite.role,
      roleLabel: workspaceRoleLabel(invite.role),
      roleDesc: workspaceRoleDescription(invite.role),
      workspaceName: workspace?.name ?? "OpenBooks workspace",
    };
  },
});

/** Revoke a pending invite. Owner only. */
export const revokeInvite = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireAnyWorkspacePermission(ctx, "team.manage");
    const invite = await ctx.db.get(args.inviteId);
    if (!invite || invite.workspaceId !== membership.workspaceId) {
      throw new ConvexError("Invite not found in this workspace.");
    }
    await requireWorkspacePermission(ctx, membership.workspaceId, "team.manage");
    await ctx.db.patch(invite._id, { status: "revoked", revokedAt: Date.now(), updatedAt: Date.now() });
    await ctx.db.insert("auditEvents", {
      workspaceId: membership.workspaceId,
      actorUserId: userId,
      action: "team.invite_revoked",
      entityType: "invite",
      entityId: invite._id,
      summary: `Revoked invite for ${invite.email}`,
      createdAt: Date.now(),
    });
    return { inviteId: invite._id };
  },
});

// Count the active owners in a workspace. Used by the last-owner guard so a
// workspace can never be left without an owner (E12-T6 / decisions Q67).
async function activeOwnerCount(
  ctx: { db: { query: (table: "workspaceMembers") => any } },
  workspaceId: Id<"workspaces">,
) {
  const members = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace", (q: any) => q.eq("workspaceId", workspaceId))
    .take(200);
  return members.filter(
    (m: Doc<"workspaceMembers">) => m.status === "active" && canonicalWorkspaceRole(m.role) === "owner",
  ).length;
}

/**
 * Change an active member's role. Owner/team.manage gated (E12-T6). The last
 * remaining owner cannot be demoted — the server rejects with a clear error so
 * a workspace is never left ownerless. Writes a 'team.role_changed' audit event.
 */
export const changeRole = mutation({
  args: {
    memberId: v.id("workspaceMembers"),
    newRole: v.union(v.literal("owner"), v.literal("accountant"), v.literal("hr")),
  },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireAnyWorkspacePermission(ctx, "team.manage");
    await requireWorkspacePermission(ctx, membership.workspaceId, "team.manage");
    const member = await ctx.db.get(args.memberId);
    if (!member || member.workspaceId !== membership.workspaceId) {
      throw new ConvexError("Member not found in this workspace.");
    }
    if (member.status !== "active") {
      throw new ConvexError("Only active members can have their role changed.");
    }

    const fromRole = canonicalWorkspaceRole(member.role);
    if (fromRole === args.newRole) {
      return { memberId: member._id, role: args.newRole };
    }

    // Last-owner guard: demoting the final owner is forbidden.
    if (fromRole === "owner" && args.newRole !== "owner") {
      const owners = await activeOwnerCount(ctx, membership.workspaceId);
      if (owners <= 1) {
        throw new ConvexError("This is the last owner — promote another member to owner before changing this role.");
      }
    }

    const now = Date.now();
    await ctx.db.patch(member._id, { role: args.newRole, updatedAt: now });

    const memberUser = await ctx.db.get(member.userId);
    const who = memberUser?.name || memberUser?.email || "a member";
    await ctx.db.insert("auditEvents", {
      workspaceId: membership.workspaceId,
      actorUserId: userId,
      action: "team.role_changed",
      entityType: "workspaceMember",
      entityId: member._id,
      summary: `Changed ${who} from ${workspaceRoleLabel(fromRole)} to ${workspaceRoleLabel(args.newRole)}`,
      createdAt: now,
    });
    return { memberId: member._id, role: args.newRole };
  },
});

/**
 * Remove an active member. Owner/team.manage gated (E12-T6). The last remaining
 * owner cannot be removed. Per decisions Q67 this DETACHES the workspaceMembers
 * row (sets status:'disabled') so the user loses all access, while the user's
 * historical audit/posting attributions stay intact (immutable journal
 * references). Any pending invite for that email in this workspace is also
 * revoked so a removed user cannot re-enter. Writes a 'team.removed' audit event.
 */
export const removeMember = mutation({
  args: { memberId: v.id("workspaceMembers") },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireAnyWorkspacePermission(ctx, "team.manage");
    await requireWorkspacePermission(ctx, membership.workspaceId, "team.manage");
    const member = await ctx.db.get(args.memberId);
    if (!member || member.workspaceId !== membership.workspaceId) {
      throw new ConvexError("Member not found in this workspace.");
    }
    if (member.status !== "active") {
      return { memberId: member._id, removed: false as const };
    }

    if (canonicalWorkspaceRole(member.role) === "owner") {
      const owners = await activeOwnerCount(ctx, membership.workspaceId);
      if (owners <= 1) {
        throw new ConvexError("This is the last owner — promote another member to owner before removing this one.");
      }
    }

    const now = Date.now();
    // Detach access; preserve the row (immutable attribution lives in auditEvents
    // / journal lines keyed by userId, which we never rewrite).
    await ctx.db.patch(member._id, { status: "disabled", updatedAt: now });

    const memberUser = await ctx.db.get(member.userId);
    const email = memberUser?.email ? normalizeEmail(memberUser.email) : null;
    if (email) {
      // Revoke any still-pending invites for this address in this workspace so the
      // removed user cannot rejoin through a stale link.
      const invites = await ctx.db
        .query("invites")
        .withIndex("by_email", (q) => q.eq("email", email))
        .take(50);
      for (const invite of invites) {
        if (invite.status === "pending" && invite.workspaceId === membership.workspaceId) {
          await ctx.db.patch(invite._id, { status: "revoked", revokedAt: now, updatedAt: now });
        }
      }
    }

    const who = memberUser?.name || memberUser?.email || "a member";
    await ctx.db.insert("auditEvents", {
      workspaceId: membership.workspaceId,
      actorUserId: userId,
      action: "team.removed",
      entityType: "workspaceMember",
      entityId: member._id,
      summary: `Removed ${who} from the workspace`,
      createdAt: now,
    });
    return { memberId: member._id, removed: true as const };
  },
});
