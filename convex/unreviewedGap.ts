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
 * SCOPE (decisions Q5): the helper takes an ENTITY LIST so the portfolio epic
 * (E5) can pass every active entity for `scope='all'` without a rewrite. Callers
 * MUST resolve + authorize the entity ids before calling — this helper does no
 * authz of its own.
 */
export async function computeUnreviewedGap(
  ctx: QueryCtx,
  entityIds: Id<"entities">[],
): Promise<{ unreviewedCount: number; unreviewedAbsMinor: number }> {
  let unreviewedCount = 0;
  let unreviewedAbsMinor = 0;
  for (const entityId of entityIds) {
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_entity", (q) => q.eq("entityId", entityId))
      .collect();
    for (const transaction of transactions) {
      if (transaction.review !== "needs_review") continue;
      unreviewedCount += 1;
      unreviewedAbsMinor += Math.abs(transaction.amountMinor);
    }
  }
  return { unreviewedCount, unreviewedAbsMinor };
}
