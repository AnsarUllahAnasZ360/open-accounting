import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  requireAnyWorkspaceRole,
  requireWorkspacePermission,
} from "./authz";
import { scopeValidator, type Scope } from "./entityScope";

/**
 * Intercompany transfer detection (Epic E5-T5).
 *
 * Detects money moving between two entities in the SAME workspace (Zikra↔Z360)
 * and classifies it as an intercompany transfer — NEVER income/expense — so
 * consolidation (E5-T7) can eliminate it. E5 is the single owner of this
 * detector; other epics consume the `intercompanyPairId` flag.
 *
 * Scope is workspace-INTERNAL only: an intercompany move is a leg whose matched
 * counter-leg is an inflow on a `transactions` row owned by a *different* entity
 * in the same workspace. Movement to an account that is NOT an OpenBooks entity
 * is a normal transaction (decisions Q27).
 *
 * This module is METADATA ONLY. It NEVER writes to journalEntries/journalLines
 * and NEVER produces a P&L line — the reciprocal accounts 1310/2310 are
 * balance-sheet only.
 */

// QBO-parity tolerances (decisions.md): exact amount within ±$1 (100 minor
// units), ±5 calendar days, opposite sign, 1:1 first.
export const INTERCOMPANY_AMOUNT_TOLERANCE_MINOR = 100;
export const INTERCOMPANY_DATE_WINDOW_DAYS = 5;
// Bound the per-entity scan so the detector stays within Convex read limits.
const INTERCOMPANY_SCAN_LIMIT = 5000;

function isArchived(entity: Doc<"entities">) {
  return entity.archived === true;
}

function calendarDaysBetween(a: string, b: string) {
  const left = Date.parse(`${a}T00:00:00Z`);
  const right = Date.parse(`${b}T00:00:00Z`);
  return Math.abs(Math.round((left - right) / 86_400_000));
}

export type IntercompanyCandidate = {
  fromEntityId: Id<"entities">;
  toEntityId: Id<"entities">;
  fromTxnId: Id<"transactions">;
  toTxnId: Id<"transactions">;
  amountMinor: number;
  tier: "high" | "medium";
};

/**
 * Pure matcher over a workspace's transactions. Pairs an OUTFLOW on one entity
 * with an INFLOW on a DIFFERENT same-workspace entity when: amounts match within
 * ±$1, dates are within ±5 calendar days, signs are opposite, and the pairing is
 * 1:1. The primary signal is an owned counter-leg in a different entity.
 *
 * Confidence tiers:
 *   - high   → exact net amount (delta 0) AND ≤1 day apart → auto-classify.
 *   - medium → within tolerance → route to Inbox for confirmation.
 *   - one-leg-seen (no counter-leg in tolerance) → yields nothing; re-evaluate later.
 *
 * Returns at most one candidate per leg (1:1). If a leg has two same-net
 * counter-candidates, it is left ambiguous (no candidate) so the owner is never
 * shown a wrong auto-pair.
 */
export function matchIntercompanyTransfers(
  transactions: Array<Doc<"transactions">>,
): IntercompanyCandidate[] {
  const outflows = transactions.filter((t) => t.amountMinor < 0);
  const inflows = transactions.filter((t) => t.amountMinor > 0);

  const candidates: IntercompanyCandidate[] = [];
  const usedInflows = new Set<Id<"transactions">>();
  const usedOutflows = new Set<Id<"transactions">>();

  // Deterministic ordering: oldest first, then by id, so the same input always
  // yields the same pairings.
  const orderedOutflows = outflows
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a._id.localeCompare(b._id));

  for (const out of orderedOutflows) {
    if (usedOutflows.has(out._id)) continue;
    const target = Math.abs(out.amountMinor);

    const matches = inflows.filter((inflow) => {
      if (usedInflows.has(inflow._id)) return false;
      // Counter-leg MUST be a different entity in the same workspace.
      if (inflow.entityId === out.entityId) return false;
      if (Math.abs(inflow.amountMinor - target) > INTERCOMPANY_AMOUNT_TOLERANCE_MINOR) return false;
      if (calendarDaysBetween(out.date, inflow.date) > INTERCOMPANY_DATE_WINDOW_DAYS) return false;
      return true;
    });

    // Two same-net candidates → ambiguous → route to manual (skip).
    if (matches.length !== 1) continue;
    const inflow = matches[0]!;

    const exactNet = inflow.amountMinor === target;
    const daysApart = calendarDaysBetween(out.date, inflow.date);
    const tier: "high" | "medium" = exactNet && daysApart <= 1 ? "high" : "medium";

    candidates.push({
      fromEntityId: out.entityId,
      toEntityId: inflow.entityId,
      fromTxnId: out._id,
      toTxnId: inflow._id,
      amountMinor: target,
      tier,
    });
    usedOutflows.add(out._id);
    usedInflows.add(inflow._id);
  }

  return candidates;
}

async function loadWorkspaceTransactions(
  ctx: QueryCtx | MutationCtx,
  entities: Array<Doc<"entities">>,
): Promise<Array<Doc<"transactions">>> {
  const perEntity = await Promise.all(
    entities.map((entity) =>
      ctx.db
        .query("transactions")
        .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
        .take(INTERCOMPANY_SCAN_LIMIT),
    ),
  );
  return perEntity.flat();
}

async function activeWorkspaceEntities(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
): Promise<Array<Doc<"entities">>> {
  const entities = await ctx.db
    .query("entities")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(200);
  return entities.filter((entity) => !isArchived(entity));
}

/**
 * Detect intercompany transfers for a workspace and persist NEW suggestions.
 * Idempotent: a pair whose legs already have an `intercompanyLinks` row (in any
 * status) is skipped, so re-running never duplicates or overwrites a confirmed/
 * rejected decision. Internal — invoked after a sync; never edits ledger rows.
 */
export const detectForWorkspace = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const entities = await activeWorkspaceEntities(ctx, args.workspaceId);
    if (entities.length < 2) return { created: 0 };

    const transactions = await loadWorkspaceTransactions(ctx, entities);
    const candidates = matchIntercompanyTransfers(transactions);

    const now = Date.now();
    let created = 0;
    for (const candidate of candidates) {
      // Skip if either leg already participates in a link.
      const [existingFrom, existingTo] = await Promise.all([
        ctx.db
          .query("intercompanyLinks")
          .withIndex("by_from_txn", (q) => q.eq("fromTxnId", candidate.fromTxnId))
          .first(),
        ctx.db
          .query("intercompanyLinks")
          .withIndex("by_to_txn", (q) => q.eq("toTxnId", candidate.toTxnId))
          .first(),
      ]);
      if (existingFrom || existingTo) continue;

      await ctx.db.insert("intercompanyLinks", {
        workspaceId: args.workspaceId,
        fromEntityId: candidate.fromEntityId,
        toEntityId: candidate.toEntityId,
        fromTxnId: candidate.fromTxnId,
        toTxnId: candidate.toTxnId,
        amountMinor: candidate.amountMinor,
        currency: "USD",
        status: "suggested",
        tier: candidate.tier,
        createdAt: now,
        updatedAt: now,
      });
      created += 1;
    }
    return { created };
  },
});

async function entityName(ctx: QueryCtx | MutationCtx, entityId: Id<"entities">) {
  const entity = await ctx.db.get(entityId);
  return entity?.name ?? "Unknown business";
}

/**
 * List intercompany suggestions for the caller's workspace (Epic E5-T5).
 * Scoped strictly to the caller's `membership.workspaceId` — never a client list.
 * `scope = 'all'` returns every suggested pair; `{ entityId }` returns only pairs
 * touching that entity.
 */
export const listIntercompanySuggestions = query({
  args: { scope: v.optional(scopeValidator) },
  handler: async (ctx, args) => {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const scope: Scope = args.scope ?? "all";

    const rows = await ctx.db
      .query("intercompanyLinks")
      .withIndex("by_status", (q) =>
        q.eq("workspaceId", membership.workspaceId).eq("status", "suggested"),
      )
      .take(200);

    const filtered =
      scope === "all"
        ? rows
        : rows.filter(
            (row) => row.fromEntityId === scope.entityId || row.toEntityId === scope.entityId,
          );

    return Promise.all(
      filtered.map(async (row) => ({
        id: row._id,
        fromEntityId: row.fromEntityId,
        toEntityId: row.toEntityId,
        fromEntityName: await entityName(ctx, row.fromEntityId),
        toEntityName: await entityName(ctx, row.toEntityId),
        amountMinor: row.amountMinor,
        currency: row.currency,
        tier: row.tier,
        fromTxnId: row.fromTxnId,
        toTxnId: row.toTxnId,
      })),
    );
  },
});

async function loadLinkForWrite(ctx: MutationCtx, linkId: Id<"intercompanyLinks">) {
  const link = await ctx.db.get(linkId);
  if (!link) {
    throw new ConvexError("OpenBooks intercompany suggestion not found.");
  }
  const { userId } = await requireWorkspacePermission(ctx, link.workspaceId, "business.manage");
  return { link, userId };
}

/**
 * Confirm an intercompany pair (Epic E5-T5). Sets status='confirmed', stamps a
 * shared `intercompanyPairId` on the link AND both transactions so consolidation
 * (E5-T7) can eliminate it at read time, and writes an audit event. Re-checks
 * business.manage. NEVER edits posted journal lines.
 */
export const confirmIntercompany = mutation({
  args: { linkId: v.id("intercompanyLinks") },
  handler: async (ctx, args) => {
    const { link, userId } = await loadLinkForWrite(ctx, args.linkId);
    if (link.status === "confirmed") {
      return { linkId: link._id, intercompanyPairId: link.intercompanyPairId };
    }

    const now = Date.now();
    const pairId = `ic:${link._id}`;
    await ctx.db.patch(link._id, {
      status: "confirmed",
      intercompanyPairId: pairId,
      updatedAt: now,
    });
    // Stamp both legs (metadata only — never the journal lines).
    await ctx.db.patch(link.fromTxnId, { intercompanyPairId: pairId, updatedAt: now });
    await ctx.db.patch(link.toTxnId, { intercompanyPairId: pairId, updatedAt: now });

    await ctx.db.insert("auditEvents", {
      workspaceId: link.workspaceId,
      actorUserId: userId,
      action: "intercompany.confirmed",
      entityType: "intercompanyLink",
      entityId: link._id,
      summary: `Confirmed intercompany transfer of USD ${(link.amountMinor / 100).toFixed(2)} between businesses`,
      createdAt: now,
    });

    return { linkId: link._id, intercompanyPairId: pairId };
  },
});

/**
 * Reject an intercompany pair (Epic E5-T5). Sets status='rejected', clears the
 * `intercompanyPairId` from the link and both transactions, and writes an audit
 * event. Re-checks business.manage. NEVER edits posted journal lines.
 */
export const rejectIntercompany = mutation({
  args: { linkId: v.id("intercompanyLinks") },
  handler: async (ctx, args) => {
    const { link, userId } = await loadLinkForWrite(ctx, args.linkId);
    if (link.status === "rejected") {
      return { linkId: link._id };
    }

    const now = Date.now();
    await ctx.db.patch(link._id, {
      status: "rejected",
      intercompanyPairId: undefined,
      updatedAt: now,
    });
    await ctx.db.patch(link.fromTxnId, { intercompanyPairId: undefined, updatedAt: now });
    await ctx.db.patch(link.toTxnId, { intercompanyPairId: undefined, updatedAt: now });

    await ctx.db.insert("auditEvents", {
      workspaceId: link.workspaceId,
      actorUserId: userId,
      action: "intercompany.rejected",
      entityType: "intercompanyLink",
      entityId: link._id,
      summary: `Rejected intercompany suggestion of USD ${(link.amountMinor / 100).toFixed(2)}`,
      createdAt: now,
    });

    return { linkId: link._id };
  },
});
