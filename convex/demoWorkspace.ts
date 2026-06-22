import { ConvexError } from "convex/values";

import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";

// ---------------------------------------------------------------------------
// Demo-workspace registry (Epic E11-T2).
//
// The SINGLE source of truth for "is this the public demo?". Before this module
// the only demo signal was the magic entity slug `'acme-studio-llc'`, which both
// leaked into real reads (E11-T1) and forced every isolation check to re-derive
// the demo from a string. We now mark the public demo explicitly on the
// `workspaces` row (`isDemo === true && demoKind === 'public'`) and resolve it
// here. The no-bleed fallback (E11-T1 `activeEntity`), the read-only guard
// (`assertNotDemoWrite`, E11-T6), the no-login `/demo` read path
// (`requireWorkspaceRead`, E11-T5), and the daily reset cron (E11-T8) all key
// off these helpers — never off the slug.
// ---------------------------------------------------------------------------

/** The stable slug of the single shared public demo workspace (E11-T4). */
export const PUBLIC_DEMO_WORKSPACE_SLUG = "public-demo";

/**
 * Is `workspaceId` the public, no-login demo workspace? Used by the read-only
 * write guard, the cron, and the no-bleed active-entity fallback to identify
 * demo data with ONE function (never the slug). Returns false for any real
 * workspace and for a `'seed'`-kind in-workspace demo.
 */
export async function isDemoWorkspace(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
): Promise<boolean> {
  const workspace = await ctx.db.get(workspaceId);
  return isPublicDemoRow(workspace);
}

/** True when a loaded workspace row is the public demo. Avoids a re-fetch. */
export function isPublicDemoRow(workspace: Doc<"workspaces"> | null | undefined): boolean {
  return workspace?.isDemo === true && workspace.demoKind === "public";
}

/**
 * Resolve the SINGLE public demo workspace (Epic E11-T2). Returns the one
 * `isDemo === true && demoKind === 'public'` workspace, or `null` on a fresh
 * deployment / self-hosted instance that never provisioned a public demo. Reads
 * the `by_is_demo` index then narrows to `demoKind === 'public'` so a legacy
 * `isDemo`-only row (no `demoKind`) is never mistaken for the public demo.
 */
export async function getPublicDemoWorkspace(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"workspaces"> | null> {
  const flagged = await ctx.db
    .query("workspaces")
    .withIndex("by_is_demo", (q) => q.eq("isDemo", true))
    .take(50);
  return flagged.find((workspace) => workspace.demoKind === "public") ?? null;
}

/**
 * Idempotent backfill (Epic E11-T2). Finds the workspace currently containing
 * the legacy `'acme-studio-llc'` demo entity and marks both that workspace
 * (`isDemo + demoKind:'public'`) and the entity (`isDemo`) so the new registry
 * recognizes a pre-existing demo without a re-seed. Safe to run repeatedly: it
 * only patches rows whose flags are not already set, and is a no-op once the
 * dedicated public demo (E11-T4) exists.
 */
export const backfillDemoFlags = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Already provisioned? Nothing to backfill.
    const existing = await getPublicDemoWorkspace(ctx);
    if (existing) {
      return { backfilled: false as const, reason: "already_marked", workspaceId: existing._id };
    }

    // Locate the legacy demo entity by its historical slug.
    const demoEntity = await ctx.db
      .query("entities")
      .withIndex("by_slug", (q) => q.eq("slug", "acme-studio-llc"))
      .first();
    if (!demoEntity) {
      return { backfilled: false as const, reason: "no_legacy_demo_entity" };
    }

    if (demoEntity.isDemo !== true) {
      await ctx.db.patch(demoEntity._id, { isDemo: true, updatedAt: now });
    }

    const workspace = await ctx.db.get(demoEntity.workspaceId);
    if (!workspace) {
      return { backfilled: false as const, reason: "demo_entity_orphaned" };
    }
    if (workspace.isDemo !== true || workspace.demoKind !== "public") {
      await ctx.db.patch(workspace._id, {
        isDemo: true,
        demoKind: "public",
        updatedAt: now,
      });
    }

    return {
      backfilled: true as const,
      workspaceId: workspace._id,
      entityId: demoEntity._id,
    };
  },
});

// ---------------------------------------------------------------------------
// Shared read/write demo boundary (Epic E11-T5 / T6).
//
// One source of truth governs BOTH sides of the public demo:
//   - READ  (`requireWorkspaceRead`): a query may read a workspace's data
//     without auth ONLY when that workspace is the public demo; otherwise it
//     falls back to the normal auth + membership re-check. This is what lets the
//     no-login `/demo` route resolve the demo BY SLUG ON THE SERVER (decided:
//     Q56) with no anonymous Convex Auth identity.
//   - WRITE (`assertNotDemoWrite`): NO mutation/action may modify the public
//     demo workspace, even one crafted by a prospect. Because there is no demo
//     CALLER identity, the trigger is the TARGET WORKSPACE being the demo — not
//     who is calling. Internal seed/cron functions never call this guard, so the
//     daily re-seed (E11-T8) still works.
//
// Belt-and-suspenders: UI hiding is not the boundary; the server is.
// ---------------------------------------------------------------------------

/**
 * Authorize a READ of `workspaceId`. Allowed with NO auth when `workspaceId` is
 * the public demo (so the no-login `/demo` route can read it). For any real
 * workspace this requires the normal authenticated membership re-check. Returns
 * the workspace row. THROWS if the workspace does not exist, or (for a non-demo
 * workspace) if the caller lacks membership.
 */
export async function requireWorkspaceRead(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
  minimumRole: Parameters<typeof requireWorkspaceRole>[2] = "member",
): Promise<Doc<"workspaces">> {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace) {
    throw new ConvexError("OpenBooks workspace not found.");
  }
  if (isPublicDemoRow(workspace)) {
    // Public demo: read allowed for anyone, including truly unauthenticated
    // visitors. No session token / anonymous identity is minted.
    return workspace;
  }
  // Real workspace: enforce the normal auth + membership re-check.
  await requireWorkspaceRole(ctx, workspaceId, minimumRole);
  return workspace;
}

/**
 * Block any WRITE that targets the public demo workspace (Epic E11-T6). Throws a
 * friendly, user-facing message so a UI surfaces "this is a read-only demo"
 * rather than a stack trace. A NO-OP for every real workspace, so real signed-in
 * writes are unaffected. Internal seed/cron callers must NOT call this — they run
 * as trusted internal functions with no demo caller identity.
 */
export async function assertNotDemoWrite(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
): Promise<void> {
  if (await isDemoWorkspace(ctx, workspaceId)) {
    throw new ConvexError(
      "This is a read-only demo — sign in to your own workspace to make changes.",
    );
  }
}
