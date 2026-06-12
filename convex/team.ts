import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { normalizeEmail, requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";

const ROLE_DESC: Record<string, string> = {
  owner: "Full access to everything",
  admin: "Read everything + journal entries",
  member: "Transactions, payroll & bills — no settings, no keys",
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Accountant",
  member: "Staff",
};

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
 * pending invites. Any member can read; only owner/admin can mutate.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const [members, invites, workspace] = await Promise.all([
      ctx.db.query("workspaceMembers").withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId)).take(100),
      ctx.db.query("invites").withIndex("by_status", (q) => q.eq("status", "pending")).take(100),
      ctx.db.get(membership.workspaceId),
    ]);

    const memberRows = await Promise.all(
      members
        .filter((m) => m.status === "active")
        .map(async (m) => {
          const user = await ctx.db.get(m.userId);
          const name = user?.name ?? null;
          const email = user?.email ?? "";
          return {
            id: m._id,
            name: name ?? email ?? "Member",
            email,
            role: m.role,
            roleLabel: ROLE_LABEL[m.role] ?? m.role,
            roleDesc: ROLE_DESC[m.role] ?? "",
            initials: initials(name, email),
            pending: false,
          };
        }),
    );

    const inviteRows = invites
      .filter((invite) => invite.workspaceId === membership.workspaceId)
      .map((invite) => ({
        id: invite._id,
        name: invite.email,
        email: invite.email,
        role: invite.role,
        roleLabel: ROLE_LABEL[invite.role] ?? invite.role,
        roleDesc: ROLE_DESC[invite.role] ?? "",
        initials: initials(null, invite.email),
        pending: true,
      }));

    return {
      members: [...memberRows, ...inviteRows],
      myRole: membership.role,
      canManage: membership.role === "owner" || membership.role === "admin",
      emailDeliveryConfigured: Boolean(process.env.PLUNK_SECRET_KEY || process.env.PLUNK_API_KEY),
      workspaceName: workspace?.name ?? "this workspace",
    };
  },
});

/**
 * Invite a teammate by email. Owner/admin only. Creates a pending invite record
 * honoring the invite-only gate; it does NOT send email here (that is Epic F3 /
 * Plunk). The UI surfaces the honest pending state.
 */
export const invite = mutation({
  args: {
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireAnyWorkspaceRole(ctx, "admin");
    await requireWorkspaceRole(ctx, membership.workspaceId, "admin");
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
    if (pending) {
      await ctx.db.patch(pending._id, { role: args.role, tokenHash, updatedAt: now });
      return { inviteId: pending._id, status: "updated" as const, emailSent: false, invitePath, inviteUrl };
    }

    const inviteId = await ctx.db.insert("invites", {
      email,
      role: args.role,
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
      summary: `Invited ${email} as ${ROLE_LABEL[args.role] ?? args.role}`,
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
      roleLabel: ROLE_LABEL[invite.role] ?? invite.role,
      roleDesc: ROLE_DESC[invite.role] ?? "",
      workspaceName: workspace?.name ?? "OpenBooks workspace",
    };
  },
});

/** Revoke a pending invite. Owner/admin only. */
export const revokeInvite = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireAnyWorkspaceRole(ctx, "admin");
    const invite = await ctx.db.get(args.inviteId);
    if (!invite || invite.workspaceId !== membership.workspaceId) {
      throw new ConvexError("Invite not found in this workspace.");
    }
    await requireWorkspaceRole(ctx, membership.workspaceId, "admin");
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
