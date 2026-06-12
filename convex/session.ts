import { query } from "./_generated/server";
import { requireUserId } from "./authz";
import { profileSnapshot } from "./profile";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const [user, memberships] = await Promise.all([
      ctx.db.get(userId),
      ctx.db
        .query("workspaceMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    ]);
    const membership = memberships.find((candidate) => candidate.status === "active") ?? null;
    const activeWorkspace = membership ? await ctx.db.get(membership.workspaceId) : null;

    const profile = user ? await profileSnapshot(ctx, user, userId) : null;

    return {
      user: user
        ? {
            id: user._id,
            email: user.email ?? null,
            name: user.name ?? null,
            profile,
          }
        : null,
      workspace: activeWorkspace
        ? {
            id: activeWorkspace._id,
            name: activeWorkspace.name,
            slug: activeWorkspace.slug,
          }
        : null,
      role: membership?.role ?? null,
      status: membership && activeWorkspace ? ("ready" as const) : ("needs_onboarding" as const),
    };
  },
});
