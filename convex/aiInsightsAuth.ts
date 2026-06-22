import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";
import { resolveDefaultEntity } from "./entityScope";

/**
 * Resolve the authed workspaceId for the active scope so the insights action can
 * pick the user's chosen AI provider via the unified credential resolver (E3 /
 * E8-T8). Mirrors coreViews.getActiveEntity's auth: any-member check, then an
 * entity-belongs-to-workspace check when an entityId is supplied. Returns null
 * when unauthorized — the action then stays on the deterministic fallback.
 *
 * Lives in a NON-"use node" module because aiInsights.ts is a Node action and
 * Convex only allows actions in Node modules (queries must be V8-runtime).
 */
async function resolveWorkspaceIdForInsights(
  ctx: QueryCtx,
  entityId?: Id<"entities">,
): Promise<Id<"workspaces"> | null> {
  const { membership } = await requireAnyWorkspaceRole(ctx, "member");
  const entity = entityId
    ? await ctx.db.get(entityId)
    : await resolveDefaultEntity(ctx, membership);
  if (!entity || entity.workspaceId !== membership.workspaceId) {
    // A fresh workspace with no entity still has a valid workspace for provider
    // resolution; an entity from another workspace is unauthorized.
    return entityId ? null : membership.workspaceId;
  }
  await requireWorkspaceRole(ctx, entity.workspaceId, "member");
  return entity.workspaceId;
}

export const insightsWorkspaceId = internalQuery({
  args: { entityId: v.optional(v.id("entities")) },
  handler: async (ctx, args): Promise<Id<"workspaces"> | null> =>
    resolveWorkspaceIdForInsights(ctx, args.entityId),
});
