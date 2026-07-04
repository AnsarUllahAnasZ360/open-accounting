import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";
import { getEntityForWrite } from "./ledger";
import { reinforceStreamRule } from "./streamRules";
import { normalizeStreamSplit } from "./streams";

// Ensure a stream label exists in the per-entity registry (case-insensitive
// match on the trimmed label). Returns the canonical stored label. Used when a
// transaction/rule references a stream so Manage Streams always has a row.
async function ensureStreamLabel(
  ctx: MutationCtx,
  entityId: Id<"entities">,
  rawLabel: string,
  now: number,
): Promise<string> {
  const label = rawLabel.trim();
  if (!label) throw new ConvexError("Stream name is required.");
  const existing = await ctx.db
    .query("revenueStreams")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .take(500);
  const match = existing.find(
    (row) => row.label.trim().toLowerCase() === label.toLowerCase() && !row.archived,
  );
  if (match) return match.label;
  await ctx.db.insert("revenueStreams", { entityId, label, createdAt: now, updatedAt: now });
  return label;
}

/**
 * The revenue streams available for a business — the registry labels plus any
 * labels already used on transactions/invoices/bills (deduped, sorted). Drives
 * the stream dropdown + autocomplete. Read-only; member+.
 */
export const listStreams = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx: QueryCtx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new ConvexError("OpenBooks business not found.");
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");

    const registry = await ctx.db
      .query("revenueStreams")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(500);

    const labels = new Set<string>();
    for (const row of registry) {
      if (!row.archived && row.label.trim()) labels.add(row.label.trim());
    }
    return {
      currency: entity.currency,
      streams: [...labels].sort((a, b) => a.localeCompare(b)),
    };
  },
});

/**
 * Set (or clear) the revenue-stream split on a transaction (streams redesign).
 * Validates that the amounts sum to the transaction total, registers any new
 * stream labels, and marks the tag owner-`confirmed` (a human decision, so the
 * rule engine treats it as ground truth). Pass an empty array to clear.
 * Owner/admin (confirming a tag is a manage action).
 */
export const setTransactionStreams = mutation({
  args: {
    transactionId: v.id("transactions"),
    streams: v.array(v.object({ streamLabel: v.string(), amountMinor: v.number() })),
  },
  handler: async (ctx: MutationCtx, args) => {
    const txn = await ctx.db.get(args.transactionId);
    if (!txn) throw new ConvexError("Transaction not found.");
    const entity = await getEntityForWrite(ctx, txn.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const now = Date.now();

    const normalized = normalizeStreamSplit(args.streams, txn.amountMinor);

    if (normalized) {
      // Register any new labels so Manage Streams and the dropdown stay in sync.
      const canonical = [];
      for (const line of normalized) {
        const label = await ensureStreamLabel(ctx, entity._id, line.streamLabel, now);
        canonical.push({ streamLabel: label, amountMinor: line.amountMinor });
      }
      await ctx.db.patch(txn._id, {
        streams: canonical,
        streamReview: "confirmed",
        updatedAt: now,
      });
      // Learn from this confirmation: create/reinforce the merchant→split rule.
      await reinforceStreamRule(ctx, entity._id, txn, canonical, now);
    } else {
      await ctx.db.patch(txn._id, {
        streams: undefined,
        streamReview: undefined,
        streamRuleId: undefined,
        updatedAt: now,
      });
    }

    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "transaction.streamTagged",
      entityType: "transaction",
      entityId: txn._id,
      summary: normalized
        ? `Tagged ${txn.merchant} to ${normalized.length} stream${normalized.length === 1 ? "" : "s"}`
        : `Cleared stream tags on ${txn.merchant}`,
      createdAt: now,
    });
    return { transactionId: txn._id, streams: normalized ?? [] };
  },
});

/**
 * Create a revenue stream in the registry (Manage Streams / inline "add" from
 * the split editor). Idempotent on the trimmed, case-insensitive label.
 * Owner/admin.
 */
export const createStream = mutation({
  args: { entityId: v.id("entities"), label: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    const entity = await getEntityForWrite(ctx, args.entityId, "admin");
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const now = Date.now();
    const label = await ensureStreamLabel(ctx, entity._id, args.label, now);
    return { entityId: entity._id, label };
  },
});

// Replace a stream label inside a split array; merges if the target already
// appears (summing amounts). Returns the new array (or null if unchanged).
function relabelSplit<T extends { streamLabel: string }>(
  split: T[] | undefined,
  from: string,
  to: string,
): T[] | null {
  if (!split || split.length === 0) return null;
  if (!split.some((line) => line.streamLabel === from)) return null;
  const merged = new Map<string, T>();
  for (const line of split) {
    const label = line.streamLabel === from ? to : line.streamLabel;
    const existing = merged.get(label);
    if (existing) {
      // Sum the numeric field (amountMinor for records, bps for rules).
      const key = "amountMinor" in line ? "amountMinor" : "bps";
      const target = existing as unknown as Record<string, number>;
      const source = line as unknown as Record<string, number>;
      target[key] = (target[key] ?? 0) + (source[key] ?? 0);
    } else {
      merged.set(label, { ...line, streamLabel: label });
    }
  }
  return [...merged.values()];
}

/**
 * Rename a revenue stream everywhere (Manage Streams): the registry row, and
 * every tagged transaction / invoice / bill split, plus learned rules. Owner/
 * admin. Pure label change — the split amounts (and totals) are preserved.
 */
export const renameStreamEverywhere = mutation({
  args: { entityId: v.id("entities"), from: v.string(), to: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    const from = args.from.trim();
    const to = args.to.trim();
    if (!from) throw new ConvexError("Pick a stream to rename.");
    if (!to) throw new ConvexError("Enter a new stream name.");
    const entity = await getEntityForWrite(ctx, args.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const now = Date.now();

    // Registry: rename the row (or create the target if missing).
    const registry = await ctx.db
      .query("revenueStreams")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(500);
    const fromRow = registry.find((row) => row.label.trim() === from);
    if (fromRow) await ctx.db.patch(fromRow._id, { label: to, updatedAt: now });
    else await ensureStreamLabel(ctx, entity._id, to, now);

    let touched = 0;
    const cascade = async (
      table: "transactions" | "invoices" | "bills",
    ) => {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
        .take(4000);
      for (const row of rows) {
        const next = relabelSplit(row.streams, from, to);
        if (next) {
          await ctx.db.patch(row._id, { streams: next, updatedAt: now });
          touched += 1;
        }
      }
    };
    await cascade("transactions");
    await cascade("invoices");
    await cascade("bills");

    const rules = await ctx.db
      .query("streamRules")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(1000);
    for (const rule of rules) {
      const next = relabelSplit(rule.split, from, to);
      if (next) await ctx.db.patch(rule._id, { split: next, updatedAt: now });
    }

    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "stream.renamed",
      entityType: "entity",
      entityId: entity._id,
      summary: `Renamed stream "${from}" to "${to}" (${touched} records)`,
      createdAt: now,
    });
    return { from, to, touched };
  },
});

/**
 * Delete a revenue stream (Manage Streams). Two modes for what to do with
 * records tagged to it:
 *  - reassignTo set → move that stream's allocation to another stream (merge).
 *  - reassignTo empty → clear the ENTIRE split on affected records (untag them),
 *    since dropping just one leg would break the sum-to-total invariant.
 * Also removes matching learned rules and the registry row. Owner/admin.
 */
export const deleteStream = mutation({
  args: { entityId: v.id("entities"), label: v.string(), reassignTo: v.optional(v.string()) },
  handler: async (ctx: MutationCtx, args) => {
    const label = args.label.trim();
    if (!label) throw new ConvexError("Pick a stream to delete.");
    const reassignTo = args.reassignTo?.trim() || null;
    if (reassignTo === label) throw new ConvexError("Reassign target must differ from the deleted stream.");
    const entity = await getEntityForWrite(ctx, args.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const now = Date.now();

    if (reassignTo) await ensureStreamLabel(ctx, entity._id, reassignTo, now);

    let affected = 0;
    const cascade = async (table: "transactions" | "invoices" | "bills") => {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
        .take(4000);
      for (const row of rows) {
        if (!row.streams || !row.streams.some((line) => line.streamLabel === label)) continue;
        if (reassignTo) {
          const next = relabelSplit(row.streams, label, reassignTo);
          if (next) await ctx.db.patch(row._id, { streams: next, updatedAt: now });
        } else {
          // Clear the whole split (and any review flag) to keep the invariant.
          const patch: Record<string, unknown> = { streams: undefined, updatedAt: now };
          if (table === "transactions") {
            patch.streamReview = undefined;
            patch.streamRuleId = undefined;
          }
          await ctx.db.patch(row._id, patch);
        }
        affected += 1;
      }
    };
    await cascade("transactions");
    await cascade("invoices");
    await cascade("bills");

    // Remove rules that reference the deleted stream (reassign or drop the leg).
    const rules = await ctx.db
      .query("streamRules")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(1000);
    for (const rule of rules) {
      if (!rule.split.some((line) => line.streamLabel === label)) continue;
      if (reassignTo) {
        const next = relabelSplit(rule.split, label, reassignTo);
        if (next) await ctx.db.patch(rule._id, { split: next, updatedAt: now });
      } else {
        await ctx.db.delete(rule._id);
      }
    }

    // Remove the registry row.
    const registry = await ctx.db
      .query("revenueStreams")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(500);
    for (const row of registry) {
      if (row.label.trim() === label) await ctx.db.delete(row._id);
    }

    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "stream.deleted",
      entityType: "entity",
      entityId: entity._id,
      summary: reassignTo
        ? `Deleted stream "${label}", reassigned ${affected} records to "${reassignTo}"`
        : `Deleted stream "${label}", untagged ${affected} records`,
      createdAt: now,
    });
    return { label, affected, reassignedTo: reassignTo };
  },
});

/** Streams with usage counts (Manage Streams list). Member+. */
export const listStreamsDetailed = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx: QueryCtx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new ConvexError("OpenBooks business not found.");
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");

    const [registry, transactions, invoices, bills, rules] = await Promise.all([
      ctx.db.query("revenueStreams").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(500),
      ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(4000),
      ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(4000),
      ctx.db.query("bills").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(4000),
      ctx.db.query("streamRules").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(1000),
    ]);

    const counts = new Map<string, number>();
    const bump = (label: string) => counts.set(label, (counts.get(label) ?? 0) + 1);
    for (const t of transactions) for (const line of t.streams ?? []) bump(line.streamLabel);
    for (const i of invoices) for (const line of i.streams ?? []) bump(line.streamLabel);
    for (const b of bills) for (const line of b.streams ?? []) bump(line.streamLabel);

    const labels = new Set<string>();
    for (const row of registry) if (!row.archived && row.label.trim()) labels.add(row.label.trim());
    for (const label of counts.keys()) labels.add(label);

    const ruleCounts = new Map<string, number>();
    for (const rule of rules) {
      for (const line of rule.split) ruleCounts.set(line.streamLabel, (ruleCounts.get(line.streamLabel) ?? 0) + 1);
    }

    return {
      currency: entity.currency,
      streams: [...labels]
        .sort((a, b) => a.localeCompare(b))
        .map((label) => ({
          label,
          taggedCount: counts.get(label) ?? 0,
          ruleCount: ruleCounts.get(label) ?? 0,
        })),
    };
  },
});

/** All learned rules for the Manage Streams "rules" view. Member+. */
export const listStreamRules = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx: QueryCtx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new ConvexError("OpenBooks business not found.");
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");
    const rules = await ctx.db
      .query("streamRules")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(1000);
    return {
      currency: entity.currency,
      rules: rules
        .sort((a, b) => b.confidence - a.confidence)
        .map((rule) => ({
          id: rule._id,
          merchantContains: rule.merchantContains,
          direction: rule.direction ?? null,
          amountMinMinor: rule.amountMinMinor ?? null,
          amountMaxMinor: rule.amountMaxMinor ?? null,
          split: rule.split,
          confidence: rule.confidence,
          timesConfirmed: rule.timesConfirmed,
          timesCorrected: rule.timesCorrected,
          active: rule.active,
          autoTags: rule.confidence >= 0.9,
        })),
    };
  },
});
