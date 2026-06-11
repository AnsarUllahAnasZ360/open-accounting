import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { resolveAIProviderRegistry } from "./aiProviderRegistry";
import { requireWorkspaceRole } from "./authz";

export const AI_AUTONOMY_THRESHOLDS = {
  suggest: null,
  balanced: 0.9,
  autopilot: 0.75,
} as const;

export type AIAutonomy = keyof typeof AI_AUTONOMY_THRESHOLDS;

const DEFAULT_AI_AUTONOMY: AIAutonomy = "balanced";
const aiProviderValidator = v.union(
  v.literal("bedrock"),
  v.literal("anthropic"),
  v.literal("openai"),
  v.literal("google"),
  v.literal("ollama"),
);
const aiAutonomyValidator = v.union(
  v.literal("suggest"),
  v.literal("balanced"),
  v.literal("autopilot"),
);
type ProviderConnectionTestResult = {
  ok: boolean;
  mode: "active" | "degraded";
  provider: "bedrock" | null;
  runtime: "ai_sdk" | "degraded";
  message: string;
  model?: string;
  finishReason?: string;
  latencyMs?: number;
};
const aiSdkTestProviderConnectionRef = makeFunctionReference<
  "action",
  { workspaceId: Id<"workspaces"> },
  ProviderConnectionTestResult
>("aiSdkRuntime:testProviderConnection");

export function resolveAutonomyThreshold(autonomy: AIAutonomy) {
  return AI_AUTONOMY_THRESHOLDS[autonomy];
}

export function shouldAutoPostAI(args: {
  autonomy: AIAutonomy;
  confidence: number;
  needsHuman?: boolean;
}) {
  if (args.needsHuman) return false;
  const threshold = resolveAutonomyThreshold(args.autonomy);
  return threshold !== null && args.confidence >= threshold;
}

export function bedrockEnvironmentStatus() {
  const registry = resolveAIProviderRegistry();

  return {
    mode: registry.mode,
    activeProvider: registry.activeProvider === "bedrock" ? "bedrock" as const : null,
    model: registry.activeProvider === "bedrock" ? registry.model : null,
    embeddingsModel: registry.activeProvider === "bedrock" ? registry.embeddingsModel : null,
    region: registry.activeProvider === "bedrock" ? registry.region : null,
    degradedReason: registry.degradedReason,
    providers: registry.providers,
  };
}

function configAutonomy(config: Doc<"aiConfigs"> | null): AIAutonomy {
  return config?.autonomy ?? DEFAULT_AI_AUTONOMY;
}

async function requireEntityAccess(ctx: MutationCtx, entityId: Id<"entities">) {
  const entity = await ctx.db.get(entityId);
  if (!entity) {
    throw new ConvexError("OpenBooks entity not found.");
  }
  const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
  return { entity, userId };
}

async function pickRuleCategory(
  ctx: MutationCtx,
  entityId: Id<"entities">,
  categoryAccountId: Id<"ledgerAccounts"> | undefined,
  merchant: string,
) {
  if (categoryAccountId) {
    const account = await ctx.db.get(categoryAccountId);
    if (!account || account.entityId !== entityId || account.archived || account.type !== "expense") {
      throw new ConvexError("Choose an active expense category for the AI rule.");
    }
    return account;
  }

  const accounts = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .collect();
  const merchantKey = merchant.toLowerCase();
  const preferredSubtype =
    merchantKey.includes("uber") || merchantKey.includes("lyft") || merchantKey.includes("air")
      ? "travel"
      : merchantKey.includes("cafe") || merchantKey.includes("lunch")
        ? "meals"
        : "software";
  const account =
    accounts.find((candidate) => candidate.type === "expense" && candidate.subtype === preferredSubtype && !candidate.archived) ??
    accounts.find((candidate) => candidate.type === "expense" && !candidate.archived);
  if (!account) {
    throw new ConvexError("No active expense account is available for this AI rule.");
  }
  return account;
}

async function buildCategorizationEvalSummary(ctx: MutationCtx, entityId: Id<"entities">) {
  const rows = await ctx.db
    .query("transactions")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .take(1000);
  const evalRows = rows.filter((row) => row.evalSet && row.evalExpectedAccountId);
  const correctCount = evalRows.filter(
    (row) => row.categoryAccountId && row.categoryAccountId === row.evalExpectedAccountId,
  ).length;
  const evaluatedCount = evalRows.length;
  const accuracy = evaluatedCount === 0 ? 0 : correctCount / evaluatedCount;
  const targetAccuracy = 0.8;
  const status =
    evaluatedCount === 0 ? "no_eval_rows" as const : accuracy >= targetAccuracy ? "meets_target" as const : "below_target" as const;
  const providerMode = bedrockEnvironmentStatus().mode;
  const finding =
    status === "no_eval_rows"
      ? "No seeded eval rows were available; run after demo seed to score the >=100 labeled subset."
      : status === "meets_target"
        ? `Categorization accuracy ${(accuracy * 100).toFixed(1)}% meets the 80.0% target.`
        : `Categorization accuracy ${(accuracy * 100).toFixed(1)}% is below the 80.0% target; this is a product finding, not a backend blocker.`;

  return {
    evaluatedCount,
    correctCount,
    accuracy,
    targetAccuracy,
    status,
    providerMode,
    finding,
  };
}

export const providerStatus = query({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceRole(ctx, args.workspaceId, "member");
    const config = await ctx.db
      .query("aiConfigs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    const env = bedrockEnvironmentStatus();
    const autonomy = configAutonomy(config);

    return {
      mode: env.mode,
      activeProvider: env.activeProvider,
      model: config?.categorizeModel ?? env.model,
      embeddingsModel: config?.embedModel ?? env.embeddingsModel,
      region: env.region,
      autonomy,
      thresholds: AI_AUTONOMY_THRESHOLDS,
      configuredProvider: config?.provider ?? "bedrock",
      degradedReason:
        env.mode === "degraded"
          ? env.degradedReason
          : null,
      providers: env.providers.map((provider) => ({
        id: provider.id,
        label: provider.label,
        runtime: provider.runtime,
        v1Enabled: provider.v1Enabled,
        capabilities: provider.capabilities,
        configured: provider.configured,
        active: provider.active,
        ready: provider.ready,
        missingEnv: provider.missingEnv,
        model: provider.model,
        embeddingsModel: provider.embeddingsModel,
        aiSdk: provider.aiSdk,
        reason: provider.reason,
      })),
    };
  },
});

export const categorizationContext = query({
  args: {
    entityId: v.id("entities"),
    bankAccountId: v.id("bankAccounts"),
    amountMinor: v.number(),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks entity not found.");
    }
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");

    const bankAccount = await ctx.db.get(args.bankAccountId);
    if (!bankAccount || bankAccount.entityId !== entity._id) {
      throw new ConvexError("Transaction account does not belong to this entity.");
    }

    const config = await ctx.db
      .query("aiConfigs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", entity.workspaceId))
      .unique();
    const env = bedrockEnvironmentStatus();
    const accountType = args.amountMinor >= 0 ? "income" : "expense";
    const accounts = await ctx.db
      .query("ledgerAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(200);

    return {
      entity: {
        id: entity._id,
        name: entity.name,
        currency: entity.currency,
      },
      bankAccount: {
        id: bankAccount._id,
        name: bankAccount.name,
      },
      provider: {
        mode: env.mode,
        activeProvider: env.activeProvider,
        model: config?.categorizeModel ?? env.model,
        region: env.region,
        autonomy: configAutonomy(config),
      },
      candidateAccounts: accounts
        .filter((account) => account.type === accountType && !account.archived)
        .map((account) => ({
          id: account._id,
          number: account.number,
          name: account.name,
          type: account.type,
          subtype: account.subtype,
        })),
    };
  },
});

export const categorizationBatchCandidates = internalQuery({
  args: {
    entityId: v.id("entities"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks entity not found.");
    }
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const limit = Math.min(25, Math.max(1, Math.floor(args.limit ?? 10)));
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(500);
    return transactions
      .filter((transaction) => transaction.review === "needs_review")
      .filter((transaction) => !transaction.entryId)
      .filter((transaction) => Boolean(transaction.bankAccountId))
      .filter((transaction) =>
        !transaction.decidedBy ||
        transaction.decidedBy === "needs_review" ||
        transaction.decidedBy === "plaid_prior",
      )
      .slice(0, limit)
      .map((transaction) => ({
        transactionId: transaction._id,
        entityId: transaction.entityId,
        bankAccountId: transaction.bankAccountId!,
        date: transaction.date,
        amountMinor: transaction.amountMinor,
        currency: transaction.currency,
        merchant: transaction.merchant,
        rawDescription: transaction.rawDescription,
        status: transaction.status,
        source: transaction.source,
        externalId: transaction.externalId,
      }));
  },
});

export const recordCategorizationBatchRun = internalMutation({
  args: {
    entityId: v.id("entities"),
    attemptedCount: v.number(),
    postedCount: v.number(),
    needsReviewCount: v.number(),
    skippedCount: v.number(),
    degradedCount: v.number(),
    fallbackCount: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireEntityAccess(ctx, args.entityId);
    const status =
      args.degradedCount > 0 && args.degradedCount === args.attemptedCount
        ? "degraded" as const
        : args.fallbackCount > 0 || args.degradedCount > 0
          ? "partial" as const
          : "completed" as const;
    const summary = `${args.attemptedCount} checked. ${args.postedCount} posted, ${args.needsReviewCount} updated for review, ${args.skippedCount} skipped.`;
    const batchRunId = await ctx.db.insert("aiBatchRuns", {
      entityId: args.entityId,
      requestedByUserId: userId,
      status,
      attemptedCount: args.attemptedCount,
      postedCount: args.postedCount,
      needsReviewCount: args.needsReviewCount,
      skippedCount: args.skippedCount,
      degradedCount: args.degradedCount,
      fallbackCount: args.fallbackCount,
      summary,
      createdAt: Date.now(),
    });
    return { batchRunId, status, summary };
  },
});

export const latestCategorizationBatchRuns = query({
  args: {
    entityId: v.id("entities"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks entity not found.");
    }
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const limit = Math.min(10, Math.max(1, Math.floor(args.limit ?? 3)));
    const runs = await ctx.db
      .query("aiBatchRuns")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .order("desc")
      .take(limit);
    return runs.map((run) => ({
      id: run._id,
      status: run.status,
      attemptedCount: run.attemptedCount,
      postedCount: run.postedCount,
      needsReviewCount: run.needsReviewCount,
      skippedCount: run.skippedCount,
      degradedCount: run.degradedCount,
      fallbackCount: run.fallbackCount,
      summary: run.summary,
      createdAt: run.createdAt,
    }));
  },
});

export const setConfig = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    provider: v.optional(aiProviderValidator),
    autonomy: aiAutonomyValidator,
  },
  handler: async (ctx, args) => {
    await requireWorkspaceRole(ctx, args.workspaceId, "admin");
    const now = Date.now();
    const env = bedrockEnvironmentStatus();
    const existing = await ctx.db
      .query("aiConfigs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    const patch = {
      provider: args.provider ?? existing?.provider ?? "bedrock" as const,
      chatModel: existing?.chatModel ?? env.model ?? undefined,
      categorizeModel: existing?.categorizeModel ?? env.model ?? undefined,
      embedModel: existing?.embedModel ?? env.embeddingsModel ?? undefined,
      autonomy: args.autonomy,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { configId: existing._id, status: "updated" as const };
    }

    const configId = await ctx.db.insert("aiConfigs", {
      workspaceId: args.workspaceId,
      ...patch,
      createdAt: now,
    });
    return { configId, status: "created" as const };
  },
});

export const testProviderConnection = action({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    return await ctx.runAction(aiSdkTestProviderConnectionRef, args);
  },
});

export const createConfirmedRule = mutation({
  args: {
    entityId: v.id("entities"),
    merchantContains: v.string(),
    categoryAccountId: v.optional(v.id("ledgerAccounts")),
    autoPost: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { entity, userId } = await requireEntityAccess(ctx, args.entityId);
    const merchant = args.merchantContains.trim();
    if (merchant.length < 2) {
      throw new ConvexError("Enter a merchant name for the AI rule.");
    }
    const account = await pickRuleCategory(ctx, entity._id, args.categoryAccountId, merchant);
    const now = Date.now();
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .collect();
    const existing = rules.find(
      (rule) =>
        rule.createdBy === "ai" &&
        rule.merchantContains?.toLowerCase() === merchant.toLowerCase() &&
        rule.categoryAccountId === account._id,
    );

    if (existing) {
      await ctx.db.patch(existing._id, {
        active: true,
        autoPost: Boolean(args.autoPost),
        updatedAt: now,
      });
      await ctx.db.insert("auditEvents", {
        workspaceId: entity.workspaceId,
        actorUserId: userId,
        action: "ai.rule.updated",
        entityType: "rule",
        entityId: existing._id,
        summary: `AI-confirmed rule updated for ${merchant} -> ${account.name}`,
        createdAt: now,
      });
      return { ruleId: existing._id, status: "updated" as const, categoryName: account.name };
    }

    const ruleId = await ctx.db.insert("rules", {
      entityId: entity._id,
      order: Math.max(0, ...rules.map((rule) => rule.order)) + 1,
      name: `AI confirmed: ${merchant}`,
      merchantContains: merchant,
      direction: "outflow",
      categoryAccountId: account._id,
      autoPost: Boolean(args.autoPost),
      hitCount: 0,
      active: true,
      createdBy: "ai",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "ai.rule.confirmed",
      entityType: "rule",
      entityId: ruleId,
      summary: `AI-confirmed rule created for ${merchant} -> ${account.name}`,
      createdAt: now,
    });
    return { ruleId, status: "created" as const, categoryName: account.name };
  },
});

export const recordCategorizationEvalRun = mutation({
  args: {
    entityId: v.id("entities"),
  },
  handler: async (ctx, args) => {
    await requireEntityAccess(ctx, args.entityId);
    const summary = await buildCategorizationEvalSummary(ctx, args.entityId);
    const evalRunId = await ctx.db.insert("aiEvalRuns", {
      entityId: args.entityId,
      ...summary,
      createdAt: Date.now(),
    });
    return { evalRunId, ...summary };
  },
});
