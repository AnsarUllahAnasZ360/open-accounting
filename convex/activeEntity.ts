import { ConvexError } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";
import { isDemoWorkspace } from "./demoWorkspace";
import { resolveDefaultEntity } from "./entityScope";

// ---------------------------------------------------------------------------
// Shared active-entity resolver (Epic E11-T1).
//
// The SINGLE place every section view resolves "which business am I reading?".
// Previously coreViews / incomeViews / expensesViews / moduleViews / reportViews
// each copy-pasted a `getActiveEntity` that, when no `entityId` was passed, fell
// back to the magic slug `'acme-studio-llc'` — so any caller that forgot the id
// silently read DEMO numbers into a real owner's books (the confirmed root-cause
// leak, accounting-engine-blueprint.md:346).
//
// The fix, in ONE module:
//   - No `entityId`  -> `resolveDefaultEntity` (oldest non-demo business in the
//     caller's workspace), NEVER a slug. A real workspace with no demo entity
//     therefore reads its own (possibly empty) books — no demo bleed.
//   - Explicit `entityId` -> verified to belong to the caller's workspace AND
//     to match the workspace's demo-ness: a real workspace may not read a demo
//     entity and the public demo workspace may not read a real one. Demo identity
//     comes from `isDemoWorkspace` (the E11-T2 registry), never the slug.
// ---------------------------------------------------------------------------

/**
 * Resolve the active entity for a section view, returning the caller's
 * `membership` alongside it (some views need the workspaceId for portfolio /
 * scope work).
 *
 * - With NO `entityId`: returns `entity: null` only when the workspace has no
 *   resolvable business (e.g. a freshly-reset workspace) — never a demo bleed.
 * - With an EXPLICIT `entityId`: THROWS on a cross-workspace / cross-demo id (an
 *   authz violation must not be masked as "no entity"); otherwise returns it.
 */
export async function resolveActiveEntity(
  ctx: QueryCtx,
  entityId?: Id<"entities">,
): Promise<{ membership: Doc<"workspaceMembers">; entity: Doc<"entities"> | null }> {
  const { membership } = await requireAnyWorkspaceRole(ctx, "member");

  if (!entityId) {
    // No id: deterministic, non-demo default — never the slug fallback.
    const entity = await resolveDefaultEntity(ctx, membership);
    return { membership, entity };
  }

  // Explicit id: must be in THIS workspace. This single check is the demo
  // isolation boundary — the public demo workspace's entities all live under the
  // demo workspaceId, so a real caller (whose membership.workspaceId is a real
  // workspace) can never resolve a public-demo entity, and a /demo read can never
  // resolve a real entity. (A legacy `seed`-kind demo entity that still lives
  // inside a real workspace is intentionally readable by that workspace.) A
  // foreign id is an authz violation and must THROW, not silently read empty.
  const entity = await ctx.db.get(entityId);
  if (!entity) {
    throw new ConvexError("You do not have access to this OpenBooks workspace.");
  }
  // Re-check membership against the entity's OWN workspace — for a foreign entity
  // this throws the established cross-workspace authz error (mirrors the legacy
  // reportViews behaviour relied on by the authz-coverage contract).
  await requireWorkspaceRole(ctx, entity.workspaceId, "member");
  if (entity.workspaceId !== membership.workspaceId) {
    throw new ConvexError("You do not have access to this OpenBooks workspace.");
  }

  // Belt-and-suspenders: if the CALLER's workspace is the public demo, only a
  // demo-flagged entity may be returned (the demo workspace must never surface a
  // real-looking entity). Keyed on the workspace registry (E11-T2), not the slug.
  const callerIsPublicDemo = await isDemoWorkspace(ctx, membership.workspaceId);
  if (callerIsPublicDemo && entity.isDemo !== true) {
    throw new ConvexError("You do not have access to this OpenBooks workspace.");
  }

  return { membership, entity };
}

/**
 * Convenience wrapper for views that only need the entity (coreViews /
 * incomeViews / expensesViews). Identical resolution to `resolveActiveEntity`.
 */
export async function getActiveEntity(
  ctx: QueryCtx,
  entityId?: Id<"entities">,
): Promise<Doc<"entities"> | null> {
  const { entity } = await resolveActiveEntity(ctx, entityId);
  return entity;
}
