import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { getEntityForWrite } from "./ledger";
import { requireWorkspaceRole } from "./authz";
import {
  groupHasCondition,
  normalizeRuleConditionGroups,
  ruleHasAnyCondition,
  ruleMatchesTxn,
  type RuleConditionGroup,
} from "./ruleMatcher";

// Matching semantics live in `ruleMatcher.ts` (shared with the live pipeline's
// `findMatchingRule`) so the "test against last 90 days" preview, the
// "test all active rules" runner, and the live first-match ordering all agree.
// A rule matches if ANY condition group matches (OR), AND-ing within each group;
// legacy flat rules are folded into a single implicit group by the read shim.

function describeGroup(group: RuleConditionGroup) {
  const conditions: string[] = [];
  if (group.descriptionContains) conditions.push(`description contains "${group.descriptionContains}"`);
  if (group.merchantContains) conditions.push(`merchant contains "${group.merchantContains}"`);
  if (group.amountMinMinor !== undefined) conditions.push(`amount ≥ ${(group.amountMinMinor / 100).toFixed(0)}`);
  if (group.amountMaxMinor !== undefined) conditions.push(`amount ≤ ${(group.amountMaxMinor / 100).toFixed(0)}`);
  if (group.direction && group.direction !== "any") conditions.push(group.direction === "inflow" ? "money in" : "money out");
  return conditions.length ? conditions.join(" and ") : "any transaction";
}

/** Plain-English summary of a rule (handles single OR multiple condition groups). */
function plainSummary(rule: { autoPost: boolean; categoryName: string }, groups: RuleConditionGroup[]) {
  const when =
    groups.length > 1
      ? groups.map((group) => `(${describeGroup(group)})`).join(" OR ")
      : describeGroup(groups[0] ?? {});
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
        // Read-time shim: legacy flat rules surface as a single normalized group
        // so the editor always renders the grouped UI.
        const groups = normalizeRuleConditionGroups(rule);
        return {
          id: rule._id,
          order: rule.order,
          name: rule.name,
          merchantContains: rule.merchantContains ?? "",
          descriptionContains: rule.descriptionContains ?? "",
          amountMinMinor: rule.amountMinMinor ?? null,
          amountMaxMinor: rule.amountMaxMinor ?? null,
          direction: rule.direction,
          conditionGroups: groups.map((group) => ({
            merchantContains: group.merchantContains ?? "",
            descriptionContains: group.descriptionContains ?? "",
            amountMinMinor: group.amountMinMinor ?? null,
            amountMaxMinor: group.amountMaxMinor ?? null,
            direction: group.direction ?? "any",
          })),
          categoryAccountId: rule.categoryAccountId,
          categoryName: account?.name ?? "Unknown category",
          autoPost: rule.autoPost,
          active: rule.active,
          hitCount: rule.hitCount,
          aiMade: rule.createdBy === "ai",
          summary: plainSummary(
            { autoPost: rule.autoPost, categoryName: account?.name ?? "selected category" },
            groups,
          ),
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

const conditionGroupValidator = v.object({
  merchantContains: v.optional(v.string()),
  descriptionContains: v.optional(v.string()),
  amountMinMinor: v.optional(v.number()),
  amountMaxMinor: v.optional(v.number()),
  direction: v.optional(v.union(v.literal("inflow"), v.literal("outflow"), v.literal("any"))),
});

const ruleConditionArgs = {
  name: v.string(),
  merchantContains: v.optional(v.string()),
  descriptionContains: v.optional(v.string()),
  amountMinMinor: v.optional(v.number()),
  amountMaxMinor: v.optional(v.number()),
  direction: v.union(v.literal("inflow"), v.literal("outflow"), v.literal("any")),
  // E12-T4: ordered condition GROUPS (OR'd). When provided this is authoritative;
  // omit it to save a legacy single-condition rule (the flat fields above).
  conditionGroups: v.optional(v.array(conditionGroupValidator)),
  categoryAccountId: v.id("ledgerAccounts"),
  autoPost: v.optional(v.boolean()),
};

// Sanitize incoming groups: trim strings, drop empty groups, and require at
// least one real condition overall. Returns the cleaned groups (or undefined for
// the legacy single-condition shape).
function sanitizeGroups(
  groups: RuleConditionGroup[] | undefined,
): RuleConditionGroup[] | undefined {
  if (!groups) return undefined;
  const cleaned = groups
    .map((group) => ({
      merchantContains: group.merchantContains?.trim() || undefined,
      descriptionContains: group.descriptionContains?.trim() || undefined,
      amountMinMinor: group.amountMinMinor,
      amountMaxMinor: group.amountMaxMinor,
      direction: group.direction ?? "any",
    }))
    .filter((group) => groupHasCondition(group));
  return cleaned.length > 0 ? cleaned : undefined;
}

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
    const groups = sanitizeGroups(args.conditionGroups);
    const hasFlatCondition =
      Boolean(args.merchantContains?.trim()) ||
      Boolean(args.descriptionContains?.trim()) ||
      args.amountMinMinor !== undefined ||
      args.amountMaxMinor !== undefined;
    if (!groups && !hasFlatCondition) {
      throw new ConvexError("A rule needs at least one condition.");
    }
    const now = Date.now();

    // Keep the flat fields populated from the FIRST group (back-compat: readers
    // that ignore groups still get a usable single condition); `conditionGroups`
    // is authoritative when present. Saving a single group via the flat fields
    // sets conditionGroups undefined so legacy-shaped rules stay legacy-shaped.
    const primary = groups?.[0];
    const base = {
      name,
      merchantContains: (primary?.merchantContains ?? args.merchantContains?.trim()) || undefined,
      descriptionContains: (primary?.descriptionContains ?? args.descriptionContains?.trim()) || undefined,
      amountMinMinor: primary?.amountMinMinor ?? args.amountMinMinor,
      amountMaxMinor: primary?.amountMaxMinor ?? args.amountMaxMinor,
      direction: primary?.direction ?? args.direction,
      // Store explicit groups only when there is more than one (or it differs
      // from a plain flat rule); a single group collapses to the flat shape.
      conditionGroups: groups && groups.length > 1 ? groups : undefined,
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
    // E12-T4: preview a multi-group rule (OR-of-groups). When provided this is
    // authoritative; otherwise the flat fields above form a single group.
    conditionGroups: v.optional(v.array(conditionGroupValidator)),
    days: v.optional(v.number()),
    asOf: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new ConvexError("OpenBooks business not found.");
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");

    const { startIso, asOf } = windowFor(args.days, args.asOf);

    const txns = await ctx.db
      .query("transactions")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(5000);

    const groups = sanitizeGroups(args.conditionGroups) ?? [
      {
        direction: args.direction,
        merchantContains: args.merchantContains?.trim() || undefined,
        descriptionContains: args.descriptionContains?.trim() || undefined,
        amountMinMinor: args.amountMinMinor,
        amountMaxMinor: args.amountMaxMinor,
      },
    ];
    const pseudoRule = { conditionGroups: groups };

    const inWindow = txns.filter((txn) => txn.date >= startIso && txn.date <= asOf);
    const matched = inWindow.filter((txn) =>
      ruleMatchesTxn(pseudoRule, { merchant: txn.merchant, rawDescription: txn.rawDescription, amountMinor: txn.amountMinor }),
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

/** Shared 90-day (default) window resolution for the rule previews. */
function windowFor(days: number | undefined, asOfArg: string | undefined) {
  const window = Math.min(366, Math.max(1, Math.floor(days ?? 90)));
  const asOf = asOfArg && /^\d{4}-\d{2}-\d{2}$/.test(asOfArg) ? asOfArg : new Date().toISOString().slice(0, 10);
  const end = new Date(`${asOf}T00:00:00.000Z`);
  const start = new Date(end.getTime() - window * 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString().slice(0, 10), asOf, days: window };
}

/**
 * "Test all active rules" (Epic E12-T4): evaluate every ACTIVE rule against the
 * last 90 days and report each rule's match count, honoring first-match-wins —
 * a transaction is attributed to the FIRST (lowest-order) rule that matches it,
 * so counts sum to the number of transactions the automation would have touched
 * (no double counting). Pure read; caps the scan. Surfaces the summary panel.
 */
export const previewAll = query({
  args: {
    entityId: v.id("entities"),
    days: v.optional(v.number()),
    asOf: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new ConvexError("OpenBooks business not found.");
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");

    const { startIso, asOf, days } = windowFor(args.days, args.asOf);

    const [rules, txns] = await Promise.all([
      ctx.db.query("rules").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(500),
      ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(5000),
    ]);

    const activeRules = rules.filter((rule) => rule.active).sort((a, b) => a.order - b.order);
    const inWindow = txns.filter((txn) => txn.date >= startIso && txn.date <= asOf);

    const counts = new Map<string, number>();
    for (const rule of activeRules) counts.set(rule._id as string, 0);
    let matchedAny = 0;
    for (const txn of inWindow) {
      const matcherTxn = { merchant: txn.merchant, rawDescription: txn.rawDescription, amountMinor: txn.amountMinor };
      // First-match-wins: attribute the txn to the first matching rule only.
      const hit = activeRules.find((rule) => ruleMatchesTxn(rule, matcherTxn));
      if (hit) {
        counts.set(hit._id as string, (counts.get(hit._id as string) ?? 0) + 1);
        matchedAny += 1;
      }
    }

    return {
      windowStart: startIso,
      windowEnd: asOf,
      days,
      scannedCount: inWindow.length,
      matchedCount: matchedAny,
      unmatchedCount: inWindow.length - matchedAny,
      rules: activeRules.map((rule) => ({
        id: rule._id,
        name: rule.name,
        order: rule.order,
        matchCount: counts.get(rule._id as string) ?? 0,
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
