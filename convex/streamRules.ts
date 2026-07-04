import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";
import { getEntityForWrite } from "./ledger";
import { normalizeStreamSplit, splitFromBps, type StreamLine } from "./streams";

// At/above this confidence a matched rule auto-tags without human review; below
// it, the transaction lands in the Needs Review queue with the split pre-filled.
export const STREAM_AUTO_TAG_THRESHOLD = 0.9;

type RuleSplit = Array<{ streamLabel: string; bps: number }>;
type MatchableTxn = { merchant: string; amountMinor: number; rawDescription: string };

function normalizeMerchant(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function txnDirection(amountMinor: number): "inflow" | "outflow" {
  return amountMinor >= 0 ? "inflow" : "outflow";
}

// Confidence rises with confirmations, falls with corrections. Deterministic
// from the counts so it's reproducible: crosses the 0.9 auto-tag line at ~3
// clean confirmations, and a correction knocks it back below.
export function computeStreamRuleConfidence(timesConfirmed: number, timesCorrected: number): number {
  const raw = 0.55 + 0.13 * timesConfirmed - 0.25 * timesCorrected;
  return Math.max(0.05, Math.min(0.98, Number(raw.toFixed(4))));
}

// Convert a confirmed split (minor units) to a scale-free basis-point split.
function bpsFromStreams(streams: StreamLine[]): RuleSplit {
  const total = streams.reduce((sum, line) => sum + Math.abs(line.amountMinor), 0);
  if (total === 0) {
    const even = Math.round(10000 / streams.length);
    return streams.map((line) => ({ streamLabel: line.streamLabel, bps: even }));
  }
  const parts = streams.map((line) => ({
    streamLabel: line.streamLabel,
    bps: Math.round((Math.abs(line.amountMinor) / total) * 10000),
  }));
  const sum = parts.reduce((acc, part) => acc + part.bps, 0);
  if (sum !== 10000 && parts.length > 0) {
    let idx = 0;
    for (let i = 1; i < parts.length; i += 1) if (parts[i].bps > parts[idx].bps) idx = i;
    parts[idx].bps += 10000 - sum;
  }
  return parts;
}

function splitsEqual(a: RuleSplit, b: RuleSplit): boolean {
  if (a.length !== b.length) return false;
  const map = new Map(a.map((part) => [part.streamLabel, part.bps]));
  return b.every((part) => map.get(part.streamLabel) === part.bps);
}

export function ruleMatchesTxn(rule: Doc<"streamRules">, txn: MatchableTxn): boolean {
  if (!rule.active) return false;
  if (rule.direction && rule.direction !== txnDirection(txn.amountMinor)) return false;
  const merchant = normalizeMerchant(txn.merchant);
  if (rule.merchantContains && !merchant.includes(normalizeMerchant(rule.merchantContains))) return false;
  const abs = Math.abs(txn.amountMinor);
  if (rule.amountMinMinor != null && abs < rule.amountMinMinor) return false;
  if (rule.amountMaxMinor != null && abs > rule.amountMaxMinor) return false;
  if (rule.memoKeywords && rule.memoKeywords.length > 0) {
    const hay = `${txn.merchant} ${txn.rawDescription}`.toLowerCase();
    if (!rule.memoKeywords.every((keyword) => hay.includes(keyword.toLowerCase()))) return false;
  }
  return true;
}

/**
 * Learn from a confirmed stream assignment: create or reinforce the (merchant +
 * direction) rule with the confirmed split. Same split → a clean confirmation
 * (confidence up); a different split → a correction (confidence down) with the
 * split updated to the latest truth. Amount range widens to cover ±10% of the
 * confirmed amount. Called from the confirm path.
 */
export async function reinforceStreamRule(
  ctx: MutationCtx,
  entityId: Id<"entities">,
  txn: MatchableTxn,
  confirmedStreams: StreamLine[],
  now: number,
): Promise<void> {
  if (confirmedStreams.length === 0) return;
  const direction = txnDirection(txn.amountMinor);
  const merchantKey = normalizeMerchant(txn.merchant);
  const abs = Math.abs(txn.amountMinor);
  const newSplit = bpsFromStreams(confirmedStreams);

  const rules = await ctx.db
    .query("streamRules")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .take(1000);
  const existing = rules.find(
    (rule) => normalizeMerchant(rule.merchantContains) === merchantKey && rule.direction === direction,
  );

  if (!existing) {
    await ctx.db.insert("streamRules", {
      entityId,
      merchantContains: txn.merchant.trim(),
      amountMinMinor: Math.floor(abs * 0.9),
      amountMaxMinor: Math.ceil(abs * 1.1),
      memoKeywords: [],
      direction,
      split: newSplit,
      confidence: computeStreamRuleConfidence(1, 0),
      timesConfirmed: 1,
      timesCorrected: 0,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    return;
  }

  const sameSplit = splitsEqual(existing.split, newSplit);
  const timesConfirmed = existing.timesConfirmed + 1;
  const timesCorrected = existing.timesCorrected + (sameSplit ? 0 : 1);
  await ctx.db.patch(existing._id, {
    split: newSplit,
    amountMinMinor: Math.min(existing.amountMinMinor ?? abs, Math.floor(abs * 0.9)),
    amountMaxMinor: Math.max(existing.amountMaxMinor ?? abs, Math.ceil(abs * 1.1)),
    timesConfirmed,
    timesCorrected,
    confidence: computeStreamRuleConfidence(timesConfirmed, timesCorrected),
    active: true,
    updatedAt: now,
  });
}

/**
 * Apply the best-matching learned rule to a transaction that has NOT been
 * human-confirmed. ≥ threshold → auto-tag (streamReview "auto"); below →
 * pre-fill the suggestion and queue it (streamReview "needs_review"). Never
 * overrides a "confirmed" tag. Internal — called from the pipeline + batch.
 */
export const applyStreamRulesToTransaction = internalMutation({
  args: { transactionId: v.id("transactions") },
  handler: async (ctx, args) => {
    const txn = await ctx.db.get(args.transactionId);
    if (!txn) return { applied: false as const };
    if (txn.streamReview === "confirmed") return { applied: false as const };

    const rules = await ctx.db
      .query("streamRules")
      .withIndex("by_entity", (q) => q.eq("entityId", txn.entityId))
      .take(1000);
    const best = rules
      .filter((rule) => ruleMatchesTxn(rule, txn))
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (!best) return { applied: false as const };

    const normalized = normalizeStreamSplit(splitFromBps(best.split, txn.amountMinor), txn.amountMinor);
    if (!normalized) return { applied: false as const };

    const auto = best.confidence >= STREAM_AUTO_TAG_THRESHOLD;
    await ctx.db.patch(txn._id, {
      streams: normalized,
      streamReview: auto ? "auto" : "needs_review",
      streamRuleId: best._id,
      updatedAt: Date.now(),
    });
    return { applied: true as const, auto, ruleId: best._id };
  },
});

/**
 * Batch-apply rules across an entity's recent un-confirmed / untagged
 * transactions — the pipeline can't always run per-row, so this backfills
 * suggestions + auto-tags. Member+ (rule-driven, no free-form money edit).
 */
export const applyStreamRulesForEntity = mutation({
  args: { entityId: v.id("entities"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new ConvexError("OpenBooks business not found.");
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");

    const rules = await ctx.db
      .query("streamRules")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(1000);
    if (rules.length === 0) return { autoTagged: 0, queued: 0, scanned: 0 };

    const limit = Math.min(2000, Math.max(1, Math.floor(args.limit ?? 800)));
    const txns = await ctx.db
      .query("transactions")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .order("desc")
      .take(limit);

    let autoTagged = 0;
    let queued = 0;
    const now = Date.now();
    for (const txn of txns) {
      if (txn.streamReview === "confirmed") continue;
      if (txn.streams && txn.streams.length > 0 && txn.streamReview) continue; // already suggested
      const best = rules
        .filter((rule) => ruleMatchesTxn(rule, txn))
        .sort((a, b) => b.confidence - a.confidence)[0];
      if (!best) continue;
      const normalized = normalizeStreamSplit(splitFromBps(best.split, txn.amountMinor), txn.amountMinor);
      if (!normalized) continue;
      const auto = best.confidence >= STREAM_AUTO_TAG_THRESHOLD;
      await ctx.db.patch(txn._id, {
        streams: normalized,
        streamReview: auto ? "auto" : "needs_review",
        streamRuleId: best._id,
        updatedAt: now,
      });
      if (auto) autoTagged += 1;
      else queued += 1;
    }
    return { autoTagged, queued, scanned: txns.length };
  },
});

/** The Needs Review queue: transactions the rules suggested but didn't auto-tag. */
export const streamNeedsReview = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new ConvexError("OpenBooks business not found.");
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");
    const rows = await ctx.db
      .query("transactions")
      .withIndex("by_entity_and_stream_review", (q) =>
        q.eq("entityId", entity._id).eq("streamReview", "needs_review"),
      )
      .take(500);
    return {
      currency: entity.currency,
      rows: rows
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((txn) => ({
          id: txn._id,
          date: txn.date,
          merchant: txn.merchant,
          amountMinor: txn.amountMinor,
          currency: txn.currency,
          suggestedStreams: txn.streams ?? [],
        })),
    };
  },
});

/** Count for the sidebar badge. */
export const streamNeedsReviewCount = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) return 0;
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");
    const rows = await ctx.db
      .query("transactions")
      .withIndex("by_entity_and_stream_review", (q) =>
        q.eq("entityId", entity._id).eq("streamReview", "needs_review"),
      )
      .take(500);
    return rows.length;
  },
});

/** Accept a queued suggestion as-is: confirm it and reinforce the rule. Admin. */
export const confirmStreamSuggestion = mutation({
  args: { transactionId: v.id("transactions") },
  handler: async (ctx, args) => {
    const txn = await ctx.db.get(args.transactionId);
    if (!txn) throw new ConvexError("Transaction not found.");
    const entity = await getEntityForWrite(ctx, txn.entityId, "admin");
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const now = Date.now();
    const streams = txn.streams ?? [];
    if (streams.length === 0) {
      // Nothing suggested — just clear the queue flag.
      await ctx.db.patch(txn._id, { streamReview: undefined, updatedAt: now });
      return { transactionId: txn._id, confirmed: false };
    }
    await ctx.db.patch(txn._id, { streamReview: "confirmed", updatedAt: now });
    await reinforceStreamRule(ctx, entity._id, txn, streams, now);
    return { transactionId: txn._id, confirmed: true };
  },
});

/** Bulk "Confirm all AI suggestions" for the Needs Review queue. Admin. */
export const confirmAllStreamSuggestions = mutation({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entity = await getEntityForWrite(ctx, args.entityId, "admin");
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const now = Date.now();
    const rows = await ctx.db
      .query("transactions")
      .withIndex("by_entity_and_stream_review", (q) =>
        q.eq("entityId", entity._id).eq("streamReview", "needs_review"),
      )
      .take(500);
    let confirmed = 0;
    for (const txn of rows) {
      const streams = txn.streams ?? [];
      if (streams.length === 0) {
        await ctx.db.patch(txn._id, { streamReview: undefined, updatedAt: now });
        continue;
      }
      await ctx.db.patch(txn._id, { streamReview: "confirmed", updatedAt: now });
      await reinforceStreamRule(ctx, entity._id, txn, streams, now);
      confirmed += 1;
    }
    return { confirmed };
  },
});
