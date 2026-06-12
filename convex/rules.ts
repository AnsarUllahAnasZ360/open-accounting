import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { getEntityForWrite } from "./ledger";
import { requireWorkspaceRole } from "./authz";

// Matching semantics mirror the pipeline's `findMatchingRule` exactly so the
// "test against last 90 days" preview and the live first-match ordering agree.
function directionFor(amountMinor: number) {
  return amountMinor >= 0 ? "inflow" : "outflow";
}

function includesText(haystack: string, needle: string | undefined) {
  return !needle || haystack.toLowerCase().includes(needle.toLowerCase());
}

function ruleMatches(rule: Doc<"rules">, txn: { merchant: string; rawDescription: string; amountMinor: number }) {
  const direction = directionFor(txn.amountMinor);
  const absMinor = Math.abs(txn.amountMinor);
  return (
    (rule.direction === "any" || rule.direction === direction) &&
    includesText(txn.merchant, rule.merchantContains) &&
    includesText(txn.rawDescription, rule.descriptionContains) &&
    (rule.amountMinMinor === undefined || absMinor >= rule.amountMinMinor) &&
    (rule.amountMaxMinor === undefined || absMinor <= rule.amountMaxMinor)
  );
}

function plainSummary(rule: {
  merchantContains?: string;
  descriptionContains?: string;
  amountMinMinor?: number;
  amountMaxMinor?: number;
  direction: "inflow" | "outflow" | "any";
  autoPost: boolean;
  categoryName: string;
}) {
  const conditions: string[] = [];
  if (rule.descriptionContains) conditions.push(`description contains "${rule.descriptionContains}"`);
  if (rule.merchantContains) conditions.push(`merchant contains "${rule.merchantContains}"`);
  if (rule.amountMinMinor !== undefined) conditions.push(`amount ≥ ${(rule.amountMinMinor / 100).toFixed(0)}`);
  if (rule.amountMaxMinor !== undefined) conditions.push(`amount ≤ ${(rule.amountMaxMinor / 100).toFixed(0)}`);
  if (rule.direction !== "any") conditions.push(rule.direction === "inflow" ? "money in" : "money out");
  const when = conditions.length ? conditions.join(" and ") : "any transaction";
  return `If ${when} → ${rule.categoryName}${rule.autoPost ? ", auto-post" : ", send to Inbox"}`;
}

async function categoryNameMap(ctx: QueryCtx, entityId: Id<"entities">) {
  const accounts = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .take(2000);
  return new Map(accounts.map((account) => [account._id, account]));
}

/**
 * Ordered rule list for Settings → Rules, plus any AI-drafted pending
 * suggestions (correction memories promoted to a rule_suggested state).
 */
export const list = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new ConvexError("OpenBooks business not found.");
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");

    const [rules, accounts, memories] = await Promise.all([
      ctx.db.query("rules").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(500),
      categoryNameMap(ctx, entity._id),
      ctx.db.query("aiCorrectionMemories").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(200),
    ]);

    const rows = rules
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((rule) => {
        const account = accounts.get(rule.categoryAccountId);
        return {
          id: rule._id,
          order: rule.order,
          name: rule.name,
          merchantContains: rule.merchantContains ?? "",
          descriptionContains: rule.descriptionContains ?? "",
          amountMinMinor: rule.amountMinMinor ?? null,
          amountMaxMinor: rule.amountMaxMinor ?? null,
          direction: rule.direction,
          categoryAccountId: rule.categoryAccountId,
          categoryName: account?.name ?? "Unknown category",
          autoPost: rule.autoPost,
          active: rule.active,
          hitCount: rule.hitCount,
          aiMade: rule.createdBy === "ai",
          summary: plainSummary({
            merchantContains: rule.merchantContains,
            descriptionContains: rule.descriptionContains,
            amountMinMinor: rule.amountMinMinor,
            amountMaxMinor: rule.amountMaxMinor,
            direction: rule.direction,
            autoPost: rule.autoPost,
            categoryName: account?.name ?? "selected category",
          }),
        };
      });

    const pending = memories
      .filter((memory) => memory.status === "rule_suggested" && !memory.suggestedRuleId)
      .slice(0, 3)
      .map((memory) => {
        const account = accounts.get(memory.categoryAccountId);
        return {
          memoryId: memory._id,
          merchantContains: memory.merchantDisplayName,
          categoryAccountId: memory.categoryAccountId,
          categoryName: account?.name ?? "selected category",
          occurrenceCount: memory.occurrenceCount,
          summary: `If description contains "${memory.merchantDisplayName.toUpperCase()}" → ${account?.name ?? "selected category"} — you've corrected this ${memory.occurrenceCount} times.`,
        };
      });

    return { rows, pending };
  },
});

const ruleConditionArgs = {
  name: v.string(),
  merchantContains: v.optional(v.string()),
  descriptionContains: v.optional(v.string()),
  amountMinMinor: v.optional(v.number()),
  amountMaxMinor: v.optional(v.number()),
  direction: v.union(v.literal("inflow"), v.literal("outflow"), v.literal("any")),
  categoryAccountId: v.id("ledgerAccounts"),
  autoPost: v.optional(v.boolean()),
};

async function assertExpenseOrIncomeCategory(
  ctx: MutationCtx,
  entityId: Id<"entities">,
  categoryAccountId: Id<"ledgerAccounts">,
) {
  const account = await ctx.db.get(categoryAccountId);
  if (!account || account.entityId !== entityId || account.archived) {
    throw new ConvexError("Choose an active category on this business.");
  }
  return account;
}

/** Create a rule (appended at the end of the order) or update an existing one. */
export const save = mutation({
  args: { entityId: v.id("entities"), ruleId: v.optional(v.id("rules")), ...ruleConditionArgs },
  handler: async (ctx, args) => {
    const entity = await getEntityForWrite(ctx, args.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const account = await assertExpenseOrIncomeCategory(ctx, entity._id, args.categoryAccountId);
    const name = args.name.trim();
    if (!name) throw new ConvexError("Give the rule a name.");
    if (!args.merchantContains?.trim() && !args.descriptionContains?.trim() && args.amountMinMinor === undefined && args.amountMaxMinor === undefined) {
      throw new ConvexError("A rule needs at least one condition.");
    }
    const now = Date.now();

    const base = {
      name,
      merchantContains: args.merchantContains?.trim() || undefined,
      descriptionContains: args.descriptionContains?.trim() || undefined,
      amountMinMinor: args.amountMinMinor,
      amountMaxMinor: args.amountMaxMinor,
      direction: args.direction,
      categoryAccountId: args.categoryAccountId,
      autoPost: args.autoPost ?? false,
      updatedAt: now,
    };

    if (args.ruleId) {
      const rule = await ctx.db.get(args.ruleId);
      if (!rule || rule.entityId !== entity._id) throw new ConvexError("Rule not found on this business.");
      await ctx.db.patch(rule._id, base);
      await ctx.db.insert("auditEvents", {
        workspaceId: entity.workspaceId,
        actorUserId: userId,
        action: "rule.updated",
        entityType: "rule",
        entityId: rule._id,
        summary: `Updated rule ${name} → ${account.name}`,
        createdAt: now,
      });
      return { ruleId: rule._id, created: false };
    }

    const rules = await ctx.db.query("rules").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(500);
    const nextOrder = Math.max(0, ...rules.map((rule) => rule.order)) + 1;
    const ruleId = await ctx.db.insert("rules", {
      entityId: entity._id,
      order: nextOrder,
      ...base,
      hitCount: 0,
      active: true,
      createdBy: "user",
      createdAt: now,
    });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "rule.created",
      entityType: "rule",
      entityId: ruleId,
      summary: `Created rule ${name} → ${account.name}`,
      createdAt: now,
    });
    return { ruleId, created: true };
  },
});

/**
 * Reorder rules. Accepts the full ordered list of rule ids (top-to-bottom) and
 * renumbers them 1..n so first-match-wins reflects the new priority.
 */
export const reorder = mutation({
  args: { entityId: v.id("entities"), orderedIds: v.array(v.id("rules")) },
  handler: async (ctx, args) => {
    const entity = await getEntityForWrite(ctx, args.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const rules = await ctx.db.query("rules").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(500);
    const owned = new Set(rules.map((rule) => rule._id as string));
    for (const id of args.orderedIds) {
      if (!owned.has(id as string)) throw new ConvexError("Reorder list references a rule from another business.");
    }
    if (args.orderedIds.length !== rules.length) {
      throw new ConvexError("Reorder must include every rule exactly once.");
    }
    const now = Date.now();
    let order = 1;
    for (const id of args.orderedIds) {
      await ctx.db.patch(id, { order, updatedAt: now });
      order += 1;
    }
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "rule.reordered",
      entityType: "entity",
      entityId: entity._id,
      summary: `Reprioritized ${args.orderedIds.length} rules`,
      createdAt: now,
    });
    return { count: args.orderedIds.length };
  },
});

/** Toggle a rule on/off. */
export const setActive = mutation({
  args: { ruleId: v.id("rules"), active: v.boolean() },
  handler: async (ctx, args) => {
    const rule = await ctx.db.get(args.ruleId);
    if (!rule) throw new ConvexError("Rule not found.");
    const entity = await getEntityForWrite(ctx, rule.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    await ctx.db.patch(rule._id, { active: args.active, updatedAt: Date.now() });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: args.active ? "rule.enabled" : "rule.disabled",
      entityType: "rule",
      entityId: rule._id,
      summary: `${args.active ? "Enabled" : "Disabled"} rule ${rule.name}`,
      createdAt: Date.now(),
    });
    return { ruleId: rule._id, active: args.active };
  },
});

/** Delete a rule. */
export const remove = mutation({
  args: { ruleId: v.id("rules") },
  handler: async (ctx, args) => {
    const rule = await ctx.db.get(args.ruleId);
    if (!rule) throw new ConvexError("Rule not found.");
    const entity = await getEntityForWrite(ctx, rule.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    await ctx.db.delete(rule._id);
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "rule.deleted",
      entityType: "rule",
      entityId: rule._id,
      summary: `Deleted rule ${rule.name}`,
      createdAt: Date.now(),
    });
    return { ruleId: rule._id };
  },
});

/**
 * "Test against your last 90 days": return the transactions a candidate rule's
 * conditions would match, so the owner sees the blast radius before saving. No
 * writes — pure preview. Caps the scan and the returned sample.
 */
export const preview = query({
  args: {
    entityId: v.id("entities"),
    merchantContains: v.optional(v.string()),
    descriptionContains: v.optional(v.string()),
    amountMinMinor: v.optional(v.number()),
    amountMaxMinor: v.optional(v.number()),
    direction: v.union(v.literal("inflow"), v.literal("outflow"), v.literal("any")),
    days: v.optional(v.number()),
    asOf: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new ConvexError("OpenBooks business not found.");
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");

    const days = Math.min(366, Math.max(1, Math.floor(args.days ?? 90)));
    const asOf = args.asOf && /^\d{4}-\d{2}-\d{2}$/.test(args.asOf) ? args.asOf : new Date().toISOString().slice(0, 10);
    const end = new Date(`${asOf}T00:00:00.000Z`);
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const startIso = start.toISOString().slice(0, 10);

    const txns = await ctx.db
      .query("transactions")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(5000);

    const pseudoRule = {
      direction: args.direction,
      merchantContains: args.merchantContains?.trim() || undefined,
      descriptionContains: args.descriptionContains?.trim() || undefined,
      amountMinMinor: args.amountMinMinor,
      amountMaxMinor: args.amountMaxMinor,
    } as Doc<"rules">;

    const inWindow = txns.filter((txn) => txn.date >= startIso && txn.date <= asOf);
    const matched = inWindow.filter((txn) =>
      ruleMatches(pseudoRule, { merchant: txn.merchant, rawDescription: txn.rawDescription, amountMinor: txn.amountMinor }),
    );

    return {
      windowStart: startIso,
      windowEnd: asOf,
      scannedCount: inWindow.length,
      matchCount: matched.length,
      sample: matched
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .slice(0, 25)
        .map((txn) => ({
          id: txn._id,
          date: txn.date,
          merchant: txn.merchant,
          amountMinor: txn.amountMinor,
          currency: txn.currency,
        })),
    };
  },
});

/**
 * Approve an AI-drafted rule suggestion (from a correction memory). Creates a
 * real, active rule and links the memory so it is not re-suggested.
 */
export const approveSuggested = mutation({
  args: { memoryId: v.id("aiCorrectionMemories"), autoPost: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const memory = await ctx.db.get(args.memoryId);
    if (!memory) throw new ConvexError("Suggestion not found.");
    const entity = await getEntityForWrite(ctx, memory.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const account = await assertExpenseOrIncomeCategory(ctx, entity._id, memory.categoryAccountId);
    const now = Date.now();

    const rules = await ctx.db.query("rules").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(500);
    const nextOrder = Math.max(0, ...rules.map((rule) => rule.order)) + 1;
    const ruleId = await ctx.db.insert("rules", {
      entityId: entity._id,
      order: nextOrder,
      name: `${memory.merchantDisplayName} → ${account.name}`,
      descriptionContains: memory.merchantDisplayName,
      direction: memory.direction,
      categoryAccountId: memory.categoryAccountId,
      autoPost: args.autoPost ?? true,
      hitCount: 0,
      active: true,
      createdBy: "ai",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(memory._id, { status: "rule_suggested", suggestedRuleId: ruleId, updatedAt: now });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "rule.approved_ai_suggestion",
      entityType: "rule",
      entityId: ruleId,
      summary: `Approved AI-drafted rule ${memory.merchantDisplayName} → ${account.name}`,
      createdAt: now,
    });
    return { ruleId };
  },
});

/** Dismiss an AI rule suggestion without creating a rule. */
export const dismissSuggested = mutation({
  args: { memoryId: v.id("aiCorrectionMemories") },
  handler: async (ctx, args) => {
    const memory = await ctx.db.get(args.memoryId);
    if (!memory) throw new ConvexError("Suggestion not found.");
    const entity = await getEntityForWrite(ctx, memory.entityId, "admin");
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    // Mark as active (not suggested) so it stops surfacing as a pending draft.
    await ctx.db.patch(memory._id, { status: "active", updatedAt: Date.now() });
    return { memoryId: memory._id };
  },
});
