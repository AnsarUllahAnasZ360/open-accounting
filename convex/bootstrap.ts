import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const health = query({
  handler: () => ({
    status: "ready",
    service: "ottex-ai-accounting",
  }),
});

export const ensureWorkspace = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        updatedAt: now,
      });
      return existing._id;
    }

    const workspaceId = await ctx.db.insert("workspaces", {
      name: args.name,
      slug: args.slug,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("workspaceSettings", {
      workspaceId,
      appName: "Ottex AI Accounting",
      defaultCurrency: "USD",
      fiscalYearStartMonth: 1,
      updatedAt: now,
    });

    await ctx.db.insert("auditEvents", {
      workspaceId,
      action: "workspace.created",
      entityType: "workspace",
      entityId: workspaceId,
      summary: `Created workspace ${args.name}`,
      createdAt: now,
    });

    return workspaceId;
  },
});

