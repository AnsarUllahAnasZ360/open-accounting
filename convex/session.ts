import { query } from "./_generated/server";
import { requireAnyWorkspaceRole } from "./authz";
import { profileSnapshot } from "./profile";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const { userId, membership } = await requireAnyWorkspaceRole(ctx);
    const [user, workspace] = await Promise.all([
      ctx.db.get(userId),
      ctx.db.get(membership.workspaceId),
    ]);

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
      workspace: workspace
        ? {
            id: workspace._id,
            name: workspace.name,
            slug: workspace.slug,
          }
        : null,
      role: membership.role,
    };
  },
});
