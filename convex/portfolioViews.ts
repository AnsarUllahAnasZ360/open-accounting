import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";
import { computeEntityMetrics, type EntityMetrics } from "./entityMetrics";
import { assertScopeAuthorized, scopeValidator, type Scope } from "./entityScope";
import { sumUsdMinor } from "./portfolioMoney";

/**
 * Portfolio roll-up read model (Epic E5-T6).
 *
 * Sums every active entity's per-business ledger metrics into one portfolio view
 * in USD, plus the by-business breakdown the dashboard tiles need. It reuses the
 * SHARED per-entity computation (entityMetrics.computeEntityMetrics) so the
 * single-entity dashboard and the portfolio roll-up can never drift.
 *
 * USD-only (decisions Q24/Q25): every figure is integer minor units summed
 * directly via portfolioMoney.sumUsdMinor — no FX conversion, no base-currency
 * engine, no `unconverted` flag.
 *
 * AUTHZ (E5-T10): the authorized entity set comes ONLY from
 * assertScopeAuthorized(membership, scope) — derived from the caller's
 * membership.workspaceId, never a client list — and EACH per-entity read is
 * preceded by a workspace-role check. See the authz contract atop entityScope.ts.
 */

export type ByBusinessRow = EntityMetrics & { drilldownHref: string };

/**
 * Aggregate runway for the combined portfolio: combined cash ÷ combined monthly
 * net burn × 30. We reconstruct each entity's monthly burn from its expense and
 * revenue all-time figures is NOT possible (we'd need the trailing series), so we
 * derive the combined runway from the per-business runwayDays weighted back into
 * an implied burn. Simpler and exact: re-derive combined burn from the same
 * trailing assumption each entity used — combined cash / Σ(per-entity implied
 * monthly burn). `null` when the portfolio is net cash-positive overall.
 */
function combinedRunwayDays(rows: EntityMetrics[]): number | null {
  const combinedCash = sumUsdMinor(rows.map((row) => row.cashMinor));
  if (combinedCash <= 0) return null;
  // Each entity's runwayDays implies a monthly burn of cash / (runwayDays / 30).
  // Entities with null runway (net positive) contribute zero burn.
  let combinedMonthlyBurnMinor = 0;
  for (const row of rows) {
    if (row.runwayDays == null || row.runwayDays <= 0) continue;
    combinedMonthlyBurnMinor += Math.round((row.cashMinor / row.runwayDays) * 30);
  }
  if (combinedMonthlyBurnMinor <= 0) return null;
  return Math.round((combinedCash / combinedMonthlyBurnMinor) * 30);
}

export const portfolioDashboard = query({
  args: { scope: v.optional(scopeValidator) },
  handler: async (ctx, args) => {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const scope: Scope = args.scope ?? "all";

    // The authorized entity set is workspace-scoped (never a client list).
    const entities = await assertScopeAuthorized(ctx, membership, scope);
    if (entities.length === 0) return null;

    // Stable, deterministic ordering for the by-business tiles.
    const ordered = entities
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id));

    // EACH per-entity read is preceded by a workspace-role check (parity with the
    // single-entity dashboard's getActiveEntity gate).
    const metricsList: EntityMetrics[] = [];
    for (const entity of ordered) {
      await requireWorkspaceRole(ctx, entity.workspaceId, "member");
      metricsList.push(await computeEntityMetrics(ctx, entity));
    }

    const byBusiness: ByBusinessRow[] = metricsList.map((metrics) => ({
      ...metrics,
      drilldownHref: `/dashboard?entity=${metrics.entityId}`,
    }));

    const combined = {
      cashMinor: sumUsdMinor(metricsList.map((m) => m.cashMinor)),
      arMinor: sumUsdMinor(metricsList.map((m) => m.arMinor)),
      apMinor: sumUsdMinor(metricsList.map((m) => m.apMinor)),
      revenueMinor: sumUsdMinor(metricsList.map((m) => m.revenueMinor)),
      expenseMinor: sumUsdMinor(metricsList.map((m) => m.expenseMinor)),
      netIncomeMinor:
        sumUsdMinor(metricsList.map((m) => m.revenueMinor)) -
        sumUsdMinor(metricsList.map((m) => m.expenseMinor)),
      runwayDays: combinedRunwayDays(metricsList),
    };

    // Intercompany suggestions for the portfolio (workspace-scoped). Surfaced so
    // the Portfolio dashboard can show "Looks like a transfer between your
    // businesses — confirm?" (E5-T5/T8). Pure metadata read.
    const intercompanyLinks = await ctx.db
      .query("intercompanyLinks")
      .withIndex("by_status", (q) =>
        q.eq("workspaceId", membership.workspaceId).eq("status", "suggested"),
      )
      .take(200);
    const entityNameById = new Map(ordered.map((entity) => [String(entity._id), entity.name]));
    const intercompanySuggestions = intercompanyLinks
      .filter(
        // Only surface pairs whose BOTH legs are in the authorized set.
        (link) =>
          entityNameById.has(String(link.fromEntityId)) &&
          entityNameById.has(String(link.toEntityId)),
      )
      .map((link) => ({
        id: link._id,
        fromEntityId: link.fromEntityId,
        toEntityId: link.toEntityId,
        fromEntityName: entityNameById.get(String(link.fromEntityId)) ?? "Unknown business",
        toEntityName: entityNameById.get(String(link.toEntityId)) ?? "Unknown business",
        amountMinor: link.amountMinor,
        currency: link.currency,
        tier: link.tier,
      }));

    return {
      scope: scope === "all" ? ("all" as const) : ({ entityId: scope.entityId } as const),
      currency: "USD" as const,
      businessCount: byBusiness.length,
      combined,
      byBusiness,
      intercompanySuggestions,
      truncated: metricsList.some((m) => m.truncated),
    };
  },
});

// Re-export the metrics type for the FE so the portfolio screen shares one shape.
export type { EntityMetrics } from "./entityMetrics";
export type PortfolioEntityId = Id<"entities">;
export type PortfolioDoc = Doc<"entities">;
