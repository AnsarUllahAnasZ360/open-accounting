import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * Multi-entity scope contract (Epic E5).
 *
 * AUTHZ CONTRACT (read before adding a multi-entity reader):
 * - Every view that accepts a portfolio scope MUST derive the authorized entity
 *   set strictly from the CALLER'S `membership.workspaceId` — never from a
 *   client-supplied list of entity ids that could cross a workspace boundary.
 * - For `scope = 'all'`, only entities in the caller's workspace are aggregated,
 *   and each per-entity read is preceded by a workspace-role check.
 * - For `scope = { entityId }`, the entity is verified to belong to the caller's
 *   workspace before any read.
 * `resolveDefaultEntity` and (E5-T10) `assertScopeAuthorized` are the single
 * entry points for resolving the authorized entity set; do not re-derive it.
 */

/**
 * The first-class scope value threaded end-to-end (Epic E5-T2). `'all'` is the
 * portfolio mode (aggregate every active entity in the workspace); the object
 * form targets a single entity. Importable by every view that supports portfolio
 * scope (portfolioViews, consolidated reportPack, intercompany).
 */
export const scopeValidator = v.union(
  v.literal("all"),
  v.object({ entityId: v.id("entities") }),
);

export type Scope = "all" | { entityId: Id<"entities"> };

type MembershipLike = Pick<Doc<"workspaceMembers">, "workspaceId">;

function isArchived(entity: Doc<"entities">) {
  return entity.archived === true;
}

function isLaunchSprintFixture(entity: Doc<"entities">) {
  return /^E1 Insights \d+ LLC$/i.test(entity.name.trim());
}

export function isOwnerVisibleEntity(entity: Doc<"entities">) {
  return !isArchived(entity) && !isLaunchSprintFixture(entity);
}

/**
 * Resolve the workspace's DETERMINISTIC default business (Epic E5-T1).
 *
 * Resolution order — NEVER a name/slug match:
 *   1. `workspace.defaultEntityId`, if it still exists, is in this workspace, and
 *      is not archived.
 *   2. The entity flagged `isDefault` (active, non-archived).
 *   3. The oldest non-archived, non-demo entity (lowest `createdAt`).
 *   4. The oldest non-archived entity of any kind (so a demo-only workspace still
 *      resolves something).
 *   5. The first entity by creation order (last resort, even if archived).
 *
 * Returns `null` only when the workspace has no entities at all. This replaces
 * the fragile hardcoded `'acme-studio-llc'` slug fallback that used to be
 * duplicated across every view resolver.
 */
export async function resolveDefaultEntity(
  ctx: QueryCtx | MutationCtx,
  membership: MembershipLike,
): Promise<Doc<"entities"> | null> {
  const workspace = await ctx.db.get(membership.workspaceId);

  // (1) Explicit, persisted workspace default.
  if (workspace?.defaultEntityId) {
    const explicit = await ctx.db.get(workspace.defaultEntityId);
    if (
      explicit &&
      explicit.workspaceId === membership.workspaceId &&
      !isArchived(explicit)
    ) {
      return explicit;
    }
  }

  // Load the workspace's entities once (entities-per-workspace is small).
  const entities = await ctx.db
    .query("entities")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
    .take(200);
  if (entities.length === 0) return null;

  // Stable oldest-first ordering for the deterministic tiebreak.
  const byOldest = entities
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id));

  // (2) The isDefault flag (active, non-archived).
  const flagged = byOldest.find((entity) => entity.isDefault === true && isOwnerVisibleEntity(entity));
  if (flagged) return flagged;

  // (3) Oldest non-archived, non-demo entity.
  const oldestRealActive = byOldest.find((entity) => isOwnerVisibleEntity(entity) && entity.isDemo !== true);
  if (oldestRealActive) return oldestRealActive;

  // (4) Oldest non-archived entity of any kind.
  const oldestActive = byOldest.find((entity) => isOwnerVisibleEntity(entity));
  if (oldestActive) return oldestActive;

  // (5) Last resort: the very first entity by creation order.
  return byOldest[0]!;
}

/**
 * Resolve the AUTHORIZED entity set for a scope (Epic E5-T10).
 *
 * This is the SINGLE entry point every multi-entity reader (portfolioViews,
 * consolidated reportPack, intercompany) must route through to obtain the
 * entities it may read. It enforces the authz contract documented atop this file:
 *
 *   - The entity set is derived STRICTLY from `membership.workspaceId`, never
 *     from a client-supplied list — so a `scope = 'all'` read can never cross a
 *     workspace boundary.
 *   - For `scope = 'all'`, it returns every ACTIVE (non-archived) entity in the
 *     caller's workspace.
 *   - For `scope = { entityId }`, it verifies that entity belongs to the caller's
 *     workspace and is not archived, and returns it as a single-element set;
 *     a foreign or unknown entityId throws.
 *
 * The caller is still responsible for the per-entity ROLE check before reading
 * each entity's rows (do it with `requireWorkspaceRole(ctx, entity.workspaceId,
 * 'member')`); this helper guarantees the SET is workspace-scoped, and the role
 * check guarantees the CALLER is permitted. `requireAnyWorkspaceRole` must have
 * already produced `membership`.
 */
export async function assertScopeAuthorized(
  ctx: QueryCtx | MutationCtx,
  membership: MembershipLike,
  scope: Scope,
): Promise<Doc<"entities">[]> {
  if (scope === "all") {
    const entities = await ctx.db
      .query("entities")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
      .take(200);
    return entities.filter(isOwnerVisibleEntity);
  }

  const entity = await ctx.db.get(scope.entityId);
  if (!entity || entity.workspaceId !== membership.workspaceId) {
    throw new ConvexError("OpenBooks: entity is not in your workspace.");
  }
  if (!isOwnerVisibleEntity(entity)) return [];
  return [entity];
}
