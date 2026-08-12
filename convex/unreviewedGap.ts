import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * Shared unreviewed-gap computation (Epic E1-T8 / RC1).
 *
 * Reports and the Dashboard both only show POSTED ledger lines, so the large
 * `needs_review` backlog makes every total silently understate. This single
 * helper computes — for one or more entities — the COUNT and the absolute $ SUM
 * (integer minor units) of transactions that are unreviewed and therefore
 * EXCLUDED from the figures, so both surfaces render the SAME number from the
 * SAME source.
 *
 * "Unreviewed" = `review === 'needs_review'`. (Items that are auto-posted or
 * human-confirmed ARE on the ledger and counted; `excluded` items were
 * deliberately dropped by the owner and are not part of the "you haven't looked
 * at this yet" backlog.)
 *
 * Transactions dated before the entity's opening-balance cutoff are skipped too.
 * They are not on any screen the owner can act on — the Inbox and Transactions
 * views filter them out (see `openingBalanceCutoff.ts`) — so counting them here
 * would promise a backlog with nowhere to go. The one-time archive pass flips
 * pre-cutoff rows to `excluded`, but a connector that back-fills old activity
 * afterwards writes fresh `needs_review` rows behind the cutoff, which is
 * exactly the case this guard covers.
 *
 * SCOPE (decisions Q5): the helper takes an ENTITY LIST so the portfolio epic
 * (E5) can pass every active entity for `scope='all'` without a rewrite. Callers
 * MUST resolve + authorize the entity ids before calling — this helper does no
 * authz of its own.
 */
/**
 * Cap on the per-entity scan. A portfolio roll-up multiplies this by the number
 * of businesses, so it has to leave room for everything else the dashboard
 * reads. Matches the DASHBOARD_LIMIT the other views use.
 */
const UNREVIEWED_SCAN_LIMIT = 5000;

export async function computeUnreviewedGap(
  ctx: QueryCtx,
  entityIds: Id<"entities">[],
): Promise<{ unreviewedCount: number; unreviewedAbsMinor: number }> {
  let unreviewedCount = 0;
  let unreviewedAbsMinor = 0;
  for (const entityId of entityIds) {
    const entity = await ctx.db.get(entityId);
    const cutoff = entity?.openingBalanceDate ?? null;
    // Read only the working set. This used to be an UNCAPPED collect over every
    // transaction the business had ever seen, which on a portfolio roll-up
    // (every entity, summed) was enough on its own to exceed Convex's
    // document-read ceiling and fail the whole dashboard.
    //
    // Pre-cutoff rows are excluded from the gap by definition, so bounding the
    // query at the cutoff removes archived history at the index rather than
    // reading it in order to discard it.
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_entity_and_date", (q) => {
        const scoped = q.eq("entityId", entityId);
        return cutoff ? scoped.gte("date", cutoff) : scoped;
      })
      .take(UNREVIEWED_SCAN_LIMIT);
    for (const transaction of transactions) {
      if (transaction.review !== "needs_review") continue;
      unreviewedCount += 1;
      unreviewedAbsMinor += Math.abs(transaction.amountMinor);
    }
  }
  return { unreviewedCount, unreviewedAbsMinor };
}
