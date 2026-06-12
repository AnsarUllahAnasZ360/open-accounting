import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export async function ensureSystemSyncActor(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
) {
  const existing = await ctx.db
    .query("systemActors")
    .withIndex("by_workspace_and_kind", (q) => q.eq("workspaceId", workspaceId).eq("kind", "sync"))
    .unique();
  if (existing) {
    const user = await ctx.db.get(existing.userId);
    if (user) return existing.userId;
  }

  const now = Date.now();
  const userId = await ctx.db.insert("users", {
    email: `system+sync-${workspaceId}@openbooks.local`,
    name: "OpenBooks Sync",
  });

  if (existing) {
    await ctx.db.patch(existing._id, {
      userId,
      label: "system:sync",
      updatedAt: now,
    });
    return userId;
  }

  await ctx.db.insert("systemActors", {
    workspaceId,
    userId,
    kind: "sync",
    label: "system:sync",
    createdAt: now,
    updatedAt: now,
  });
  return userId;
}
