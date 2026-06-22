import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";

/**
 * E12-T7 — real, paginated, server-filtered audit log.
 *
 * The old AuditSection read `moduleViews.overview.settings.audit.rows`, which was
 * `.take(200)` and then filtered in the browser — so anything older than the most
 * recent 200 events was silently invisible and the filters lied. This query
 * replaces that: it walks `auditEvents` by the `by_workspace` index in descending
 * (newest-first) order with Convex cursor pagination (`paginationOpts`), applies
 * actor-kind / date-range / free-text filters on the SERVER, and returns a
 * `continueCursor` the UI's `usePaginatedQuery` follows for "Load more" — without
 * ever holding the whole dataset in memory. No 200-row cap and no retention cap
 * for v1 (decisions Q66); pagination is the only bound.
 */

export type AuditActorKind = "ai" | "rule" | "user" | "system";

/**
 * Derive the actor "kind" the UI pills + the actor filter use. Mirrors
 * moduleViews.auditActorLabel so the two surfaces stay consistent, but is
 * self-contained here (no journalEntry join — the kind only needs the event).
 */
export function auditActorKind(event: Doc<"auditEvents">): AuditActorKind {
  const action = event.action.toLowerCase();
  const summary = event.summary.toLowerCase();
  if (action.startsWith("system.")) return "system";
  if (
    action.startsWith("ai.") ||
    summary.includes("pipeline ai") ||
    summary.includes("pipeline memory") ||
    summary.includes("ai-confirmed") ||
    summary.includes("ai drafted")
  ) {
    return "ai";
  }
  if (action.startsWith("rule.") || summary.includes("rule:")) return "rule";
  return event.actorUserId ? "user" : "system";
}

function matchesFilters(
  event: Doc<"auditEvents">,
  opts: { actorKind?: AuditActorKind; sinceMs?: number; untilMs?: number; text?: string },
): boolean {
  if (opts.sinceMs !== undefined && event.createdAt < opts.sinceMs) return false;
  if (opts.untilMs !== undefined && event.createdAt > opts.untilMs) return false;
  if (opts.actorKind && auditActorKind(event) !== opts.actorKind) return false;
  if (opts.text) {
    const haystack = `${event.action} ${event.summary} ${auditActorKind(event)}`.toLowerCase();
    if (!haystack.includes(opts.text)) return false;
  }
  return true;
}

async function resolveWorkspaceId(
  ctx: QueryCtx,
  entityId?: Id<"entities">,
): Promise<Id<"workspaces"> | null> {
  if (entityId) {
    const entity = await ctx.db.get(entityId);
    if (!entity) return null;
    // Re-check the caller actually belongs to the workspace that owns this entity.
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");
    return entity.workspaceId;
  }
  const { membership } = await requireAnyWorkspaceRole(ctx, "member");
  return membership.workspaceId;
}

export const list = query({
  args: {
    entityId: v.optional(v.id("entities")),
    actorKind: v.optional(
      v.union(v.literal("ai"), v.literal("rule"), v.literal("user"), v.literal("system")),
    ),
    sinceMs: v.optional(v.number()),
    untilMs: v.optional(v.number()),
    text: v.optional(v.string()),
    // Convex-native cursor pagination. The UI uses `usePaginatedQuery`, which
    // accumulates pages and resets the cursor automatically when any filter arg
    // changes — so "Load more" reaches arbitrarily old events with no in-memory
    // cap on the dataset.
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const workspaceId = await resolveWorkspaceId(ctx, args.entityId);
    if (!workspaceId) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const text = args.text?.trim().toLowerCase() || undefined;
    const opts = { actorKind: args.actorKind, sinceMs: args.sinceMs, untilMs: args.untilMs, text };

    // Walk the workspace's events newest-first by the `by_workspace` index (which
    // implicitly orders by _creationTime). Pagination happens on the SERVER via
    // `.paginate`; date/actor/text filters are then applied to the page, also on
    // the server — the client never holds or filters the whole dataset.
    const result = await ctx.db
      .query("auditEvents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .paginate(args.paginationOpts);

    const page = result.page
      .filter((event) => matchesFilters(event, opts))
      .map((event) => ({
        id: event._id,
        when: event.createdAt,
        actor: auditActorKind(event),
        action: event.action,
        entityType: event.entityType,
        summary: event.summary,
      }));

    return { ...result, page };
  },
});
