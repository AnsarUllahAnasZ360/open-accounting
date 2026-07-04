import { ConvexError, v } from "convex/values";

import { mutation } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";

// Rename a workspace. Owner-only. The display name lives on `workspaces.name`
// (see schema) and is what the sidebar switcher and the session `viewer` query
// surface. Trimmed and length-bounded so the UI never renders an empty or
// runaway name. Used by both the onboarding first step and Settings.
export const rename = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (name.length < 2) {
      throw new ConvexError("Workspace name must be at least 2 characters.");
    }
    if (name.length > 60) {
      throw new ConvexError("Workspace name must be 60 characters or fewer.");
    }
    const { userId } = await requireWorkspaceRole(ctx, args.workspaceId, "owner");
    const now = Date.now();
    await ctx.db.patch(args.workspaceId, { name, updatedAt: now });
    await ctx.db.insert("auditEvents", {
      workspaceId: args.workspaceId,
      actorUserId: userId,
      action: "workspace.renamed",
      entityType: "workspace",
      entityId: args.workspaceId,
      summary: `Renamed workspace to ${name}`,
      createdAt: now,
    });
    return { workspaceId: args.workspaceId, name };
  },
});
