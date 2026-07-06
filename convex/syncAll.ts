import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalQuery } from "./_generated/server";
import { requireAnyWorkspacePermission } from "./authz";

// ---------------------------------------------------------------------------
// "Sync everything" — one action that pulls the latest transactions from every
// connected bank (Plaid) AND Stripe account across ALL of the caller's
// businesses, concurrently. Reuses the existing per-connection sync actions
// (plaid.syncItemNow / stripe.syncNow) so posting/dedupe logic stays in one
// place. connections.manage-gated (Owner + Accountant).
// ---------------------------------------------------------------------------

type SyncTargets = {
  plaid: Array<{ entityId: Id<"entities">; plaidItemId: string }>;
  stripeEntityIds: Array<Id<"entities">>;
};

/** Authorize the caller + gather every active Plaid item and Stripe connection in their workspace. */
export const gatherWorkspaceSyncTargets = internalQuery({
  args: {},
  handler: async (ctx): Promise<SyncTargets> => {
    const { membership } = await requireAnyWorkspacePermission(ctx, "connections.manage");
    const workspaceId = membership.workspaceId;

    const entities = await ctx.db
      .query("entities")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(100);

    const plaid: SyncTargets["plaid"] = [];
    for (const entity of entities) {
      const items = await ctx.db
        .query("plaidItems")
        .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
        .take(50);
      for (const item of items) {
        if (item.status === "active") plaid.push({ entityId: entity._id, plaidItemId: item.plaidItemId });
      }
    }

    const connections = await ctx.db
      .query("financialConnections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(200);
    const stripeEntityIds = [
      ...new Set(
        connections
          .filter((c) => c.provider === "stripe" && c.status === "active")
          .map((c) => c.entityId as string),
      ),
    ] as Array<Id<"entities">>;

    return { plaid, stripeEntityIds };
  },
});

/**
 * Sync latest transactions from Bank (Plaid) + Stripe for every business at
 * once. Fires all per-connection syncs concurrently and reports a summary; a
 * single failing connection never blocks the others.
 */
export const syncAllNow = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ plaidItems: number; stripeConnections: number; synced: number; failed: number }> => {
    const targets: SyncTargets = await ctx.runQuery(internal.syncAll.gatherWorkspaceSyncTargets, {});

    const jobs: Array<Promise<unknown>> = [
      ...targets.plaid.map((t) =>
        ctx.runAction(api.plaid.syncItemNow, { entityId: t.entityId, plaidItemId: t.plaidItemId }),
      ),
      ...targets.stripeEntityIds.map((entityId) => ctx.runAction(api.stripe.syncNow, { entityId })),
    ];

    const results = await Promise.allSettled(jobs);
    const failed = results.filter((r) => r.status === "rejected").length;
    return {
      plaidItems: targets.plaid.length,
      stripeConnections: targets.stripeEntityIds.length,
      synced: results.length - failed,
      failed,
    };
  },
});
