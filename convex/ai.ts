import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { resolveAIProviderRegistry } from "./aiProviderRegistry";
import { requireWorkspaceRole } from "./authz";
import { ensureDefaultBankAccountForEntity } from "./defaultBankAccount";
import { chartTemplatesForType, seedChartForEntity } from "./ledger";

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
const categorizeAndRouteTransactionRef = makeFunctionReference<
  "action",
  {
    entityId: Id<"entities">;
    bankAccountId: Id<"bankAccounts">;
    date: string;
    amountMinor: number;
    currency: string;
    merchant: string;
    rawDescription: string;
    status: "pending" | "posted";
    source: "bank" | "stripe" | "manual";
    externalId: string;
  },
  {
    mode: "bedrock" | "degraded" | "fallback";
    provider: "bedrock" | null;
    model: string | null;
    proposal: {
      categoryAccountId: Id<"ledgerAccounts">;
      accountNumber: string;
      categoryName: string;
      confidence: number;
      needsHuman: boolean;
    } | null;
    fallbackReason: string | null;
    route: {
      status: "posted" | "needs_review" | "duplicate";
      transactionId: Id<"transactions">;
      entryId: Id<"journalEntries"> | null;
      stage: string;
    };
  }
>("bedrockCategorizer:categorizeAndRouteTransaction");

type HoldoutEvalCase = {
  sourceTransactionId: Id<"transactions">;
  date: string;
  amountMinor: number;
  currency: string;
  merchant: string;
  rawDescription: string;
  source: "bank" | "stripe" | "manual";
  expectedAccountId: Id<"ledgerAccounts">;
  expectedAccountNumber: string;
  expectedAccountName: string;
};

type HoldoutEvalResult = {
  merchant: string;
  amountMinor: number;
  expectedAccountNumber: string;
  expectedAccountName: string;
  predictedAccountNumber: string | null;
  predictedAccountName: string | null;
  correct: boolean;
  routeStatus: "posted" | "needs_review" | "duplicate";
  stage: string;
  decidedBy: Doc<"transactions">["decidedBy"] | null;
  confidence: number | null;
  mode: "bedrock" | "degraded" | "fallback";
  proposalSource: "llm" | "semantic_memory" | null;
  fallbackReason: string | null;
};

const HOLDOUT_EVAL_SINGLE_ACTION_LIMIT = 60;

const prepareHoldoutCategorizationEvalRef = makeFunctionReference<
  "mutation",
  { sourceEntityId: Id<"entities">; limit?: number },
  {
    sourceEntityId: Id<"entities">;
    evalEntityId: Id<"entities">;
    bankAccountId: Id<"bankAccounts">;
    currency: string;
    runKey: string;
    cases: HoldoutEvalCase[];
    skippedNonCategoryCount: number;
  }
>("ai:prepareHoldoutCategorizationEval");
const holdoutTransactionResultRef = makeFunctionReference<
  "query",
  { transactionId: Id<"transactions"> },
  {
    categoryAccountId: Id<"ledgerAccounts"> | null;
    categoryAccountNumber: string | null;
    categoryAccountName: string | null;
    decidedBy: Doc<"transactions">["decidedBy"] | null;
    confidence: number | null;
  }
>("ai:holdoutTransactionResult");
const recordHoldoutCategorizationEvalRunRef = makeFunctionReference<
  "mutation",
  {
    sourceEntityId: Id<"entities">;
    evalEntityId: Id<"entities">;
    evaluatedCount: number;
    correctCount: number;
    accuracy: number;
    targetAccuracy: number;
    status: "meets_target" | "below_target" | "no_eval_rows";
    finding: string;
  },
  { evalRunId: Id<"aiEvalRuns">; providerMode: "active" | "degraded" }
>("ai:recordHoldoutCategorizationEvalRun");

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

async function requireSystemSyncActor(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
  actorUserId: Id<"users">,
) {
  const actor = await ctx.db
    .query("systemActors")
    .withIndex("by_workspace_and_kind", (q) => q.eq("workspaceId", workspaceId).eq("kind", "sync"))
    .unique();
  if (!actor || actor.userId !== actorUserId) {
    throw new ConvexError("Import categorization requires the OpenBooks sync system actor.");
  }
  return actor.userId;
}

async function authorizeCategorizationRead(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  actorUserId?: Id<"users">,
) {
  if (actorUserId) {
    await requireSystemSyncActor(ctx, workspaceId, actorUserId);
    return;
  }
  await requireWorkspaceRole(ctx, workspaceId, "admin");
}

async function buildCategorizationContext(
  ctx: QueryCtx,
  args: {
    entityId: Id<"entities">;
    bankAccountId: Id<"bankAccounts">;
    amountMinor: number;
  },
) {
  const entity = await ctx.db.get(args.entityId);
  if (!entity) {
    throw new ConvexError("OpenBooks entity not found.");
  }

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

function directionAccountType(amountMinor: number) {
  return amountMinor >= 0 ? "income" as const : "expense" as const;
}

async function uniqueEvalSlug(ctx: MutationCtx, workspaceId: Id<"workspaces">, root: string) {
  let candidate = root.slice(0, 48);
  let n = 2;
  // Eval entities are rare; bounded by the workspace entity cap.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await ctx.db
      .query("entities")
      .withIndex("by_workspace_and_slug", (q) => q.eq("workspaceId", workspaceId).eq("slug", candidate))
      .unique();
    if (!existing) return candidate;
    candidate = `${root.slice(0, 42)}-${n}`;
    n += 1;
  }
}

function holdoutBand(confidence: number | null) {
  if (confidence === null) return "unknown";
  if (confidence >= 0.9) return ">=0.90";
  if (confidence >= 0.75) return "0.75-0.89";
  return "<0.75";
}

function summarizeHoldout(results: HoldoutEvalResult[]) {
  const correctCount = results.filter((result) => result.correct).length;
  const evaluatedCount = results.length;
  const accuracy = evaluatedCount === 0 ? 0 : correctCount / evaluatedCount;
  const targetAccuracy = 0.8;
  const status =
    evaluatedCount === 0 ? "no_eval_rows" as const : accuracy >= targetAccuracy ? "meets_target" as const : "below_target" as const;
  const byStage: Record<string, { total: number; correct: number }> = {};
  const byConfidenceBand: Record<string, { total: number; correct: number }> = {};
  for (const result of results) {
    const stage = result.decidedBy ?? result.stage;
    byStage[stage] ??= { total: 0, correct: 0 };
    byStage[stage].total += 1;
    if (result.correct) byStage[stage].correct += 1;
    const band = holdoutBand(result.confidence);
    byConfidenceBand[band] ??= { total: 0, correct: 0 };
    byConfidenceBand[band].total += 1;
    if (result.correct) byConfidenceBand[band].correct += 1;
  }
  const finding =
    status === "no_eval_rows"
      ? "No label-safe holdout rows were available after excluding non-categorization labels."
      : status === "meets_target"
        ? `Label-safe holdout categorization accuracy ${(accuracy * 100).toFixed(1)}% meets the 80.0% target.`
        : `Label-safe holdout categorization accuracy ${(accuracy * 100).toFixed(1)}% is below the 80.0% target; this is a product quality finding, not a backend blocker.`;

  return {
    evaluatedCount,
    correctCount,
    accuracy,
    targetAccuracy,
    status,
    byStage,
    byConfidenceBand,
    finding,
  };
}

export const prepareHoldoutCategorizationEval = internalMutation({
  args: {
    sourceEntityId: v.id("entities"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { entity: sourceEntity, userId } = await requireEntityAccess(ctx, args.sourceEntityId);
    const now = Date.now();
    const limit = Math.min(HOLDOUT_EVAL_SINGLE_ACTION_LIMIT, Math.max(1, Math.floor(args.limit ?? HOLDOUT_EVAL_SINGLE_ACTION_LIMIT)));
    const sourceAccounts = await ctx.db
      .query("ledgerAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", sourceEntity._id))
      .take(250);
    const sourceAccountsById = new Map(sourceAccounts.map((account) => [account._id, account]));

    const slug = await uniqueEvalSlug(ctx, sourceEntity.workspaceId, `h3-holdout-${now.toString(36)}`);
    const evalEntityId = await ctx.db.insert("entities", {
      workspaceId: sourceEntity.workspaceId,
      name: `H3 Holdout Eval ${new Date(now).toISOString()}`,
      slug,
      businessType: sourceEntity.businessType,
      currency: sourceEntity.currency,
      isDemo: false,
      archived: false,
      fiscalYearStartMonth: sourceEntity.fiscalYearStartMonth ?? 1,
      accountingBasis: sourceEntity.accountingBasis ?? "accrual",
      legalName: "H3 Holdout Eval",
      createdAt: now,
      updatedAt: now,
    });
    const evalEntity = (await ctx.db.get(evalEntityId))!;
    await seedChartForEntity(ctx, evalEntity, chartTemplatesForType(evalEntity.businessType));
    const bankAccountId = await ensureDefaultBankAccountForEntity(ctx, evalEntity);
    const evalAccounts = await ctx.db
      .query("ledgerAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", evalEntityId))
      .take(250);
    const evalAccountsByNumber = new Map(evalAccounts.map((account) => [account.number, account]));

    const sourceRows = await ctx.db
      .query("transactions")
      .withIndex("by_entity", (q) => q.eq("entityId", sourceEntity._id))
      .take(1000);
    const cases: HoldoutEvalCase[] = [];
    let skippedNonCategoryCount = 0;
    for (const row of sourceRows) {
      if (!row.evalSet || !row.evalExpectedAccountId || !row.bankAccountId) continue;
      const sourceExpected = sourceAccountsById.get(row.evalExpectedAccountId);
      const expectedType = directionAccountType(row.amountMinor);
      if (!sourceExpected || sourceExpected.type !== expectedType) {
        skippedNonCategoryCount += 1;
        continue;
      }
      const evalExpected = evalAccountsByNumber.get(sourceExpected.number);
      if (!evalExpected || evalExpected.type !== expectedType) {
        skippedNonCategoryCount += 1;
        continue;
      }
      cases.push({
        sourceTransactionId: row._id,
        date: row.date,
        amountMinor: row.amountMinor,
        currency: row.currency,
        merchant: row.merchant,
        rawDescription: row.rawDescription,
        source: row.source,
        expectedAccountId: evalExpected._id,
        expectedAccountNumber: evalExpected.number,
        expectedAccountName: evalExpected.name,
      });
      if (cases.length >= limit) break;
    }

    await ctx.db.insert("auditEvents", {
      workspaceId: sourceEntity.workspaceId,
      actorUserId: userId,
      action: "ai.eval.started",
      entityType: "entity",
      entityId: evalEntityId,
      summary: `Started label-safe categorization holdout eval with ${cases.length} rows`,
      createdAt: now,
    });

    return {
      sourceEntityId: sourceEntity._id,
      evalEntityId,
      bankAccountId,
      currency: evalEntity.currency,
      runKey: slug,
      cases,
      skippedNonCategoryCount,
    };
  },
});

export const holdoutTransactionResult = internalQuery({
  args: {
    transactionId: v.id("transactions"),
  },
  handler: async (ctx, args) => {
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction) {
      throw new ConvexError("Holdout transaction not found.");
    }
    const category = transaction.categoryAccountId ? await ctx.db.get(transaction.categoryAccountId) : null;
    return {
      categoryAccountId: transaction.categoryAccountId ?? null,
      categoryAccountNumber: category?.number ?? null,
      categoryAccountName: category?.name ?? null,
      decidedBy: transaction.decidedBy ?? null,
      confidence: transaction.confidence ?? null,
    };
  },
});

export const recordHoldoutCategorizationEvalRun = internalMutation({
  args: {
    sourceEntityId: v.id("entities"),
    evalEntityId: v.id("entities"),
    evaluatedCount: v.number(),
    correctCount: v.number(),
    accuracy: v.number(),
    targetAccuracy: v.number(),
    status: v.union(v.literal("meets_target"), v.literal("below_target"), v.literal("no_eval_rows")),
    finding: v.string(),
  },
  handler: async (ctx, args) => {
    const sourceEntity = await ctx.db.get(args.sourceEntityId);
    if (!sourceEntity) {
      throw new ConvexError("OpenBooks source entity not found.");
    }
    const providerMode = bedrockEnvironmentStatus().mode;
    await ctx.db.patch(args.evalEntityId, {
      archived: true,
      updatedAt: Date.now(),
    });
    const evalRunId = await ctx.db.insert("aiEvalRuns", {
      entityId: args.sourceEntityId,
      evaluatedCount: args.evaluatedCount,
      correctCount: args.correctCount,
      accuracy: args.accuracy,
      targetAccuracy: args.targetAccuracy,
      status: args.status,
      providerMode,
      finding: args.finding,
      createdAt: Date.now(),
    });
    return { evalRunId, providerMode };
  },
});

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
    return await buildCategorizationContext(ctx, args);
  },
});

export const categorizationContextForImportInternal = internalQuery({
  args: {
    entityId: v.id("entities"),
    bankAccountId: v.id("bankAccounts"),
    amountMinor: v.number(),
    actorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks entity not found.");
    }
    await requireSystemSyncActor(ctx, entity.workspaceId, args.actorUserId);
    return await buildCategorizationContext(ctx, args);
  },
});

export const categorizationBatchCandidates = internalQuery({
  args: {
    entityId: v.id("entities"),
    limit: v.optional(v.number()),
    actorUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks entity not found.");
    }
    await authorizeCategorizationRead(ctx, entity.workspaceId, args.actorUserId);
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
    actorUserId: v.optional(v.id("users")),
    attemptedCount: v.number(),
    postedCount: v.number(),
    needsReviewCount: v.number(),
    skippedCount: v.number(),
    degradedCount: v.number(),
    fallbackCount: v.number(),
  },
  handler: async (ctx, args) => {
    const { entity, userId } = args.actorUserId
      ? {
          entity: await ctx.db.get(args.entityId),
          userId: args.actorUserId,
        }
      : await requireEntityAccess(ctx, args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks entity not found.");
    }
    if (args.actorUserId) {
      await requireSystemSyncActor(ctx, entity.workspaceId, args.actorUserId);
    }
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

export const latestCategorizationEvalRuns = query({
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
      .query("aiEvalRuns")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .order("desc")
      .take(limit);
    return runs.map((run) => ({
      id: run._id,
      evaluatedCount: run.evaluatedCount,
      correctCount: run.correctCount,
      accuracy: run.accuracy,
      targetAccuracy: run.targetAccuracy,
      status: run.status,
      providerMode: run.providerMode,
      finding: run.finding,
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

export const runHoldoutCategorizationEval = action({
  args: {
    sourceEntityId: v.id("entities"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const prepared = await ctx.runMutation(prepareHoldoutCategorizationEvalRef, {
      sourceEntityId: args.sourceEntityId,
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    });
    const results: HoldoutEvalResult[] = [];

    for (const [index, item] of prepared.cases.entries()) {
      const routed = await ctx.runAction(categorizeAndRouteTransactionRef, {
        entityId: prepared.evalEntityId,
        bankAccountId: prepared.bankAccountId,
        date: item.date,
        amountMinor: item.amountMinor,
        currency: item.currency,
        merchant: item.merchant,
        rawDescription: item.rawDescription,
        status: "posted",
        source: item.source,
        externalId: `h3:${prepared.runKey}:${index}:${item.sourceTransactionId}`,
      });
      const observed = await ctx.runQuery(holdoutTransactionResultRef, {
        transactionId: routed.route.transactionId,
      });
      results.push({
        merchant: item.merchant,
        amountMinor: item.amountMinor,
        expectedAccountNumber: item.expectedAccountNumber,
        expectedAccountName: item.expectedAccountName,
        predictedAccountNumber: observed.categoryAccountNumber,
        predictedAccountName: observed.categoryAccountName,
        correct: observed.categoryAccountId === item.expectedAccountId,
        routeStatus: routed.route.status,
        stage: routed.route.stage,
        decidedBy: observed.decidedBy,
        confidence: observed.confidence,
        mode: routed.mode,
        proposalSource: routed.proposal
          ? routed.proposal.accountNumber === "memory"
            ? "semantic_memory"
            : "llm"
          : null,
        fallbackReason: routed.fallbackReason,
      });
    }

    const summary = summarizeHoldout(results);
    const recorded = await ctx.runMutation(recordHoldoutCategorizationEvalRunRef, {
      sourceEntityId: prepared.sourceEntityId,
      evalEntityId: prepared.evalEntityId,
      evaluatedCount: summary.evaluatedCount,
      correctCount: summary.correctCount,
      accuracy: summary.accuracy,
      targetAccuracy: summary.targetAccuracy,
      status: summary.status,
      finding: summary.finding,
    });

    return {
      evalRunId: recorded.evalRunId,
      sourceEntityId: prepared.sourceEntityId,
      evalEntityId: prepared.evalEntityId,
      generatedAt: new Date().toISOString(),
      method: "label_safe_holdout_unlabeled_route",
      maxSingleActionRows: HOLDOUT_EVAL_SINGLE_ACTION_LIMIT,
      providerMode: recorded.providerMode,
      skippedNonCategoryCount: prepared.skippedNonCategoryCount,
      ...summary,
      cases: results,
      leakageGuard:
        "The route calls omitted categoryAccountId and evalExpectedAccountId; expected labels were kept only in action memory for scoring after prediction.",
    };
  },
});
