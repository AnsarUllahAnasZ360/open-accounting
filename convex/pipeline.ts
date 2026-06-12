import { v } from "convex/values";

import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { type AIAutonomy, shouldAutoPostAI } from "./ai";
import { requireWorkspaceRole } from "./authz";
import { postLedgerEntryCore, type LedgerLineInput } from "./ledger";
import { assertSignedMinorUnit } from "./money";

const sourceValidator = v.union(v.literal("bank"), v.literal("stripe"), v.literal("manual"));
const aiProposalValidator = v.object({
  categoryAccountId: v.id("ledgerAccounts"),
  confidence: v.number(),
  reasoning: v.string(),
  needsHuman: v.boolean(),
  question: v.optional(v.string()),
});
const semanticMemoryProposalValidator = v.object({
  categoryAccountId: v.id("ledgerAccounts"),
  confidence: v.number(),
  reasoning: v.string(),
});

const routeTransactionArgs = {
  entityId: v.id("entities"),
  bankAccountId: v.id("bankAccounts"),
  date: v.string(),
  amountMinor: v.number(),
  currency: v.string(),
  merchant: v.string(),
  rawDescription: v.string(),
  status: v.union(v.literal("pending"), v.literal("posted")),
  source: sourceValidator,
  externalId: v.string(),
  contactId: v.optional(v.id("contacts")),
  categoryAccountId: v.optional(v.id("ledgerAccounts")),
  matchAccountId: v.optional(v.id("ledgerAccounts")),
  transferAccountId: v.optional(v.id("ledgerAccounts")),
  forceReview: v.optional(v.boolean()),
  evalExpectedAccountId: v.optional(v.id("ledgerAccounts")),
  evalSet: v.optional(v.boolean()),
  plaidPriorAccountId: v.optional(v.id("ledgerAccounts")),
  semanticMemoryProposal: v.optional(semanticMemoryProposalValidator),
  aiProposal: v.optional(aiProposalValidator),
};

type RouteTransactionArgs = {
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
  contactId?: Id<"contacts">;
  categoryAccountId?: Id<"ledgerAccounts">;
  matchAccountId?: Id<"ledgerAccounts">;
  transferAccountId?: Id<"ledgerAccounts">;
  forceReview?: boolean;
  evalExpectedAccountId?: Id<"ledgerAccounts">;
  evalSet?: boolean;
  plaidPriorAccountId?: Id<"ledgerAccounts">;
  semanticMemoryProposal?: {
    categoryAccountId: Id<"ledgerAccounts">;
    confidence: number;
    reasoning: string;
  };
  aiProposal?: {
    categoryAccountId: Id<"ledgerAccounts">;
    confidence: number;
    reasoning: string;
    needsHuman: boolean;
    question?: string;
  };
};

function directionFor(amountMinor: number) {
  return amountMinor >= 0 ? "inflow" : "outflow";
}

function includesText(haystack: string, needle: string | undefined) {
  return !needle || haystack.toLowerCase().includes(needle.toLowerCase());
}

function absoluteMinor(amountMinor: number) {
  return Math.abs(amountMinor);
}

function normalizeMerchantKey(merchant: string) {
  return merchant.trim().toLowerCase().replace(/\s+/g, " ");
}

function legacyReturnStage(
  decidedBy: Doc<"transactions">["decidedBy"] | undefined,
): "transfer" | "match" | "rule" | "needs_review" {
  return decidedBy === "transfer" || decidedBy === "match" || decidedBy === "rule"
    ? decidedBy
    : decidedBy === "needs_review"
      ? "needs_review"
      : "rule";
}

async function requireEntity(ctx: MutationCtx, entityId: Id<"entities">) {
  const entity = await ctx.db.get(entityId);
  if (!entity) {
    throw new Error("OpenBooks entity not found.");
  }
  await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
  return entity;
}

async function requireTransactionForAdmin(ctx: MutationCtx, transactionId: Id<"transactions">) {
  const transaction = await ctx.db.get(transactionId);
  if (!transaction) {
    throw new Error("Transaction not found.");
  }
  const entity = await requireEntity(ctx, transaction.entityId);
  return { entity, transaction };
}

async function resolveInboxItems(
  ctx: MutationCtx,
  entityId: Id<"entities">,
  transactionId: Id<"transactions">,
  now: number,
) {
  const items = await ctx.db
    .query("inboxItems")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .collect();
  for (const item of items) {
    if (item.transactionId === transactionId && item.status === "open") {
      await ctx.db.patch(item._id, {
        status: "resolved",
        updatedAt: now,
      });
    }
  }
}

async function reverseExistingEntry(
  ctx: MutationCtx,
  args: {
    entityId: Id<"entities">;
    entryId: Id<"journalEntries">;
    date: string;
    memo: string;
    sourceId: string;
  },
) {
  const lines = await ctx.db
    .query("journalLines")
    .withIndex("by_entry", (q) => q.eq("entryId", args.entryId))
    .collect();
  if (lines.length === 0) {
    throw new Error("Posted transaction has no ledger lines to reverse.");
  }
  const result: { entryId: Id<"journalEntries"> } = await ctx.runMutation(api.ledger.postEntry, {
    entityId: args.entityId,
    date: args.date,
    memo: args.memo,
    source: "manual",
    sourceId: args.sourceId,
    reversesEntryId: args.entryId,
    lines: lines.map((line) => ({
      accountId: line.accountId,
      debitMinor: line.creditMinor,
      creditMinor: line.debitMinor,
      currency: line.currency,
    })),
  });
  return result.entryId;
}

async function findMatchingRule(
  ctx: MutationCtx,
  args: {
    entityId: Id<"entities">;
    merchant: string;
    rawDescription: string;
    amountMinor: number;
  },
) {
  const rules = await ctx.db
    .query("rules")
    .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
    .collect();
  const direction = directionFor(args.amountMinor);
  return rules
    .filter((rule) => rule.active)
    .sort((a, b) => a.order - b.order)
    .find(
      (rule) =>
        (rule.direction === "any" || rule.direction === direction) &&
        includesText(args.merchant, rule.merchantContains) &&
        includesText(args.rawDescription, rule.descriptionContains),
    );
}

async function getEntityAutonomy(ctx: MutationCtx, entity: Doc<"entities">): Promise<AIAutonomy> {
  const config = await ctx.db
    .query("aiConfigs")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", entity.workspaceId))
    .unique();
  return config?.autonomy ?? "balanced";
}

async function assertCategoryAccount(
  ctx: MutationCtx,
  entityId: Id<"entities">,
  categoryAccountId: Id<"ledgerAccounts">,
) {
  const account = await ctx.db.get(categoryAccountId);
  if (!account || account.entityId !== entityId || account.archived) {
    throw new Error("Pipeline proposal category must be an active account on this entity.");
  }
  return account;
}

async function findCorrectionMemory(
  ctx: MutationCtx,
  args: {
    entityId: Id<"entities">;
    merchant: string;
    amountMinor: number;
  },
) {
  const memories = await ctx.db
    .query("aiCorrectionMemories")
    .withIndex("by_entity_and_merchant_key_and_direction", (q) =>
      q
        .eq("entityId", args.entityId)
        .eq("merchantKey", normalizeMerchantKey(args.merchant))
        .eq("direction", directionFor(args.amountMinor)),
    )
    .take(10);
  return memories
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount || b.updatedAt - a.updatedAt)
    .find((memory) => memory.status === "active" || memory.status === "rule_suggested") ?? null;
}

async function postPipelineLedgerEntry(
  ctx: MutationCtx,
  args: {
    entity: Doc<"entities">;
    actorUserId?: Id<"users">;
    date: string;
    memo: string;
    source: "bank" | "stripe" | "manual";
    sourceId: string;
    lines: LedgerLineInput[];
  },
) {
  if (args.actorUserId) {
    const result = await postLedgerEntryCore(ctx, {
      entity: args.entity,
      userId: args.actorUserId,
      date: args.date,
      memo: args.memo,
      source: args.source,
      sourceId: args.sourceId,
      lines: args.lines,
      auditAction: "system.sync.ledger_entry.posted",
    });
    return result.entryId;
  }

  const result: { entryId: Id<"journalEntries"> } = await ctx.runMutation(api.ledger.postEntry, {
    entityId: args.entity._id,
    date: args.date,
    memo: args.memo,
    source: args.source,
    sourceId: args.sourceId,
    lines: args.lines,
  });
  return result.entryId;
}

async function postTransactionEntry(
  ctx: MutationCtx,
  args: {
    entity: Doc<"entities">;
    bankAccount: Doc<"bankAccounts">;
    date: string;
    amountMinor: number;
    merchant: string;
    source: "bank" | "stripe" | "manual";
    sourceId: string;
    categoryAccountId: Id<"ledgerAccounts">;
    memoSuffix: string;
    actorUserId?: Id<"users">;
  },
) {
  const amount = absoluteMinor(args.amountMinor);
  const debitAccountId = args.amountMinor >= 0 ? args.bankAccount.ledgerAccountId : args.categoryAccountId;
  const creditAccountId = args.amountMinor >= 0 ? args.categoryAccountId : args.bankAccount.ledgerAccountId;
  return await postPipelineLedgerEntry(ctx, {
    entity: args.entity,
    actorUserId: args.actorUserId,
    date: args.date,
    memo: `${args.merchant} - ${args.memoSuffix}`,
    source: args.source === "manual" ? "manual" : args.source,
    sourceId: args.sourceId,
    lines: [
      {
        accountId: debitAccountId,
        debitMinor: amount,
        creditMinor: 0,
        currency: args.entity.currency,
      },
      {
        accountId: creditAccountId,
        debitMinor: 0,
        creditMinor: amount,
        currency: args.entity.currency,
      },
    ],
  });
}

async function routeProposedCategory(
  ctx: MutationCtx,
  args: {
    entity: Doc<"entities">;
    bankAccount: Doc<"bankAccounts">;
    transactionId: Id<"transactions">;
    date: string;
    amountMinor: number;
    merchant: string;
    source: "bank" | "stripe" | "manual";
    sourceId: string;
    categoryAccountId: Id<"ledgerAccounts">;
    confidence: number;
    reasoning: string;
    stage: "memory" | "plaid_prior" | "ai";
    needsHuman?: boolean;
    question?: string;
    now: number;
    actorUserId?: Id<"users">;
  },
) {
  await assertCategoryAccount(ctx, args.entity._id, args.categoryAccountId);
  const autonomy = await getEntityAutonomy(ctx, args.entity);

  if (
    shouldAutoPostAI({
      autonomy,
      confidence: args.confidence,
      needsHuman: args.needsHuman,
    })
  ) {
    const entryId = await postTransactionEntry(ctx, {
      entity: args.entity,
      bankAccount: args.bankAccount,
      date: args.date,
      amountMinor: args.amountMinor,
      merchant: args.merchant,
      source: args.source,
      sourceId: args.sourceId,
      categoryAccountId: args.categoryAccountId,
      memoSuffix: `pipeline ${args.stage}`,
      actorUserId: args.actorUserId,
    });
    await ctx.db.patch(args.transactionId, {
      review: "auto",
      categoryAccountId: args.categoryAccountId,
      entryId,
      decidedBy: args.stage,
      confidence: args.confidence,
      reasoning: args.reasoning,
      updatedAt: args.now,
    });
    return { status: "posted" as const, transactionId: args.transactionId, entryId, stage: "rule" as const };
  }

  await ctx.db.patch(args.transactionId, {
    categoryAccountId: args.categoryAccountId,
    decidedBy: args.stage,
    confidence: args.confidence,
    reasoning: args.question ? `${args.reasoning} Question: ${args.question}` : args.reasoning,
    updatedAt: args.now,
  });
  await ctx.db.insert("inboxItems", {
    entityId: args.entity._id,
    transactionId: args.transactionId,
    kind: args.question ? "question" : "categorize",
    payloadSummary: `${args.merchant} needs review for ${args.entity.currency} ${absoluteMinor(args.amountMinor) / 100}`,
    status: "open",
    createdAt: args.now,
    updatedAt: args.now,
  });
  return { status: "needs_review" as const, transactionId: args.transactionId, entryId: null, stage: "needs_review" as const };
}

async function upsertOpenCategorizationInbox(
  ctx: MutationCtx,
  args: {
    entityId: Id<"entities">;
    transactionId: Id<"transactions">;
    merchant: string;
    currency: string;
    amountMinor: number;
    question?: string;
    now: number;
  },
) {
  const items = await ctx.db
    .query("inboxItems")
    .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
    .collect();
  const existing = items.find(
    (item) =>
      item.transactionId === args.transactionId &&
      item.status === "open" &&
      (item.kind === "categorize" || item.kind === "question"),
  );
  const kind = args.question ? "question" as const : "categorize" as const;
  const payloadSummary = `${args.merchant} needs review for ${args.currency} ${absoluteMinor(args.amountMinor) / 100}`;
  if (existing) {
    await ctx.db.patch(existing._id, {
      kind,
      payloadSummary,
      updatedAt: args.now,
    });
    return existing._id;
  }
  return await ctx.db.insert("inboxItems", {
    entityId: args.entityId,
    transactionId: args.transactionId,
    kind,
    payloadSummary,
    status: "open",
    createdAt: args.now,
    updatedAt: args.now,
  });
}

async function routeExistingProposedCategory(
  ctx: MutationCtx,
  args: {
    entity: Doc<"entities">;
    bankAccount: Doc<"bankAccounts">;
    transaction: Doc<"transactions">;
    categoryAccountId: Id<"ledgerAccounts">;
    confidence: number;
    reasoning: string;
    stage: "memory" | "ai";
    needsHuman?: boolean;
    question?: string;
    now: number;
    actorUserId?: Id<"users">;
  },
) {
  await assertCategoryAccount(ctx, args.entity._id, args.categoryAccountId);
  const autonomy = await getEntityAutonomy(ctx, args.entity);

  if (
    shouldAutoPostAI({
      autonomy,
      confidence: args.confidence,
      needsHuman: args.needsHuman,
    })
  ) {
    const entryId = await postTransactionEntry(ctx, {
      entity: args.entity,
      bankAccount: args.bankAccount,
      date: args.transaction.date,
      amountMinor: args.transaction.amountMinor,
      merchant: args.transaction.merchant,
      source: args.transaction.source,
      sourceId: args.transaction.externalId,
      categoryAccountId: args.categoryAccountId,
      memoSuffix: `pipeline ${args.stage}`,
      actorUserId: args.actorUserId,
    });
    await ctx.db.patch(args.transaction._id, {
      review: "auto",
      categoryAccountId: args.categoryAccountId,
      entryId,
      decidedBy: args.stage,
      confidence: args.confidence,
      reasoning: args.reasoning,
      updatedAt: args.now,
    });
    await resolveInboxItems(ctx, args.entity._id, args.transaction._id, args.now);
    return { status: "posted" as const, transactionId: args.transaction._id, entryId, stage: args.stage };
  }

  await ctx.db.patch(args.transaction._id, {
    categoryAccountId: args.categoryAccountId,
    decidedBy: args.stage,
    confidence: args.confidence,
    reasoning: args.question ? `${args.reasoning} Question: ${args.question}` : args.reasoning,
    updatedAt: args.now,
  });
  await upsertOpenCategorizationInbox(ctx, {
    entityId: args.entity._id,
    transactionId: args.transaction._id,
    merchant: args.transaction.merchant,
    currency: args.transaction.currency,
    amountMinor: args.transaction.amountMinor,
    ...(args.question ? { question: args.question } : {}),
    now: args.now,
  });
  return { status: "needs_review" as const, transactionId: args.transaction._id, entryId: null, stage: "needs_review" as const };
}

async function recordCorrectionMemory(
  ctx: MutationCtx,
  args: {
    entity: Doc<"entities">;
    transaction: Doc<"transactions">;
    categoryAccountId: Id<"ledgerAccounts">;
    now: number;
  },
) {
  await assertCategoryAccount(ctx, args.entity._id, args.categoryAccountId);
  const merchantKey = normalizeMerchantKey(args.transaction.merchant);
  const direction = directionFor(args.transaction.amountMinor);
  const memories = await ctx.db
    .query("aiCorrectionMemories")
    .withIndex("by_entity_and_merchant_key_and_direction", (q) =>
      q.eq("entityId", args.entity._id).eq("merchantKey", merchantKey).eq("direction", direction),
    )
    .take(10);
  const existing = memories.find((memory) => memory.categoryAccountId === args.categoryAccountId);
  const nextCount = (existing?.occurrenceCount ?? 0) + 1;

  let suggestedRuleId = existing?.suggestedRuleId;
  let status: "active" | "rule_suggested" = existing?.status ?? "active";
  if (nextCount >= 3 && !suggestedRuleId) {
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entity._id))
      .collect();
    suggestedRuleId = await ctx.db.insert("rules", {
      entityId: args.entity._id,
      order: Math.max(0, ...rules.map((rule) => rule.order)) + 1,
      name: `AI draft: ${args.transaction.merchant}`,
      merchantContains: args.transaction.merchant,
      descriptionContains: undefined,
      direction,
      categoryAccountId: args.categoryAccountId,
      autoPost: false,
      hitCount: 0,
      active: false,
      createdBy: "ai",
      createdAt: args.now,
      updatedAt: args.now,
    });
    await ctx.db.insert("auditEvents", {
      workspaceId: args.entity.workspaceId,
      action: "ai.rule.drafted",
      entityType: "rule",
      entityId: suggestedRuleId,
      summary: `AI drafted a rule for ${args.transaction.merchant} after repeated corrections`,
      createdAt: args.now,
    });
    status = "rule_suggested";
  }

  if (existing) {
    await ctx.db.patch(existing._id, {
      occurrenceCount: nextCount,
      merchantDisplayName: args.transaction.merchant,
      lastTransactionId: args.transaction._id,
      status,
      suggestedRuleId,
      updatedAt: args.now,
    });
    return existing._id;
  }

  return await ctx.db.insert("aiCorrectionMemories", {
    entityId: args.entity._id,
    merchantKey,
    merchantDisplayName: args.transaction.merchant,
    direction,
    categoryAccountId: args.categoryAccountId,
    occurrenceCount: nextCount,
    lastTransactionId: args.transaction._id,
    status,
    suggestedRuleId,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

async function routeTransactionCore(
  ctx: MutationCtx,
  args: RouteTransactionArgs,
  options: {
    entity: Doc<"entities">;
    bankAccount: Doc<"bankAccounts">;
    actorUserId?: Id<"users">;
  },
){
  assertSignedMinorUnit(args.amountMinor, "Transaction amount");
  const { entity, bankAccount, actorUserId } = options;

    const duplicate = await ctx.db
      .query("transactions")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.externalId))
      .first();
    if (duplicate && duplicate.entityId === args.entityId) {
      return {
        status: "duplicate" as const,
        transactionId: duplicate._id,
        entryId: duplicate.entryId ?? null,
        stage: legacyReturnStage(duplicate.decidedBy),
      };
    }

    const now = Date.now();
    const transactionId = await ctx.db.insert("transactions", {
      entityId: args.entityId,
      bankAccountId: args.bankAccountId,
      date: args.date,
      amountMinor: args.amountMinor,
      currency: args.currency,
      merchant: args.merchant,
      rawDescription: args.rawDescription,
      status: args.status,
      review: "needs_review",
      source: args.source,
      contactId: args.contactId,
      externalId: args.externalId,
      evalExpectedAccountId: args.evalExpectedAccountId,
      evalSet: Boolean(args.evalSet),
      createdAt: now,
      updatedAt: now,
    });

    if (args.transferAccountId && !args.forceReview) {
      const amount = absoluteMinor(args.amountMinor);
      const entryId = await postPipelineLedgerEntry(ctx, {
        entity,
        actorUserId,
        date: args.date,
        memo: `${args.merchant} - transfer`,
        source: "bank",
        sourceId: args.externalId,
        lines: args.amountMinor >= 0
          ? [
              { accountId: bankAccount.ledgerAccountId, debitMinor: amount, creditMinor: 0, currency: entity.currency },
              { accountId: args.transferAccountId, debitMinor: 0, creditMinor: amount, currency: entity.currency },
            ]
          : [
              { accountId: args.transferAccountId, debitMinor: amount, creditMinor: 0, currency: entity.currency },
              { accountId: bankAccount.ledgerAccountId, debitMinor: 0, creditMinor: amount, currency: entity.currency },
            ],
      });
      await ctx.db.patch(transactionId, {
        review: "auto",
        entryId,
        transferPairId: `${args.externalId}:transfer`,
        decidedBy: "transfer",
        confidence: 0.99,
        reasoning: "Pipeline stage 1 detected a transfer between ledger accounts.",
        updatedAt: now,
      });
      return { status: "posted" as const, transactionId, entryId, stage: "transfer" as const };
    }

    if (args.matchAccountId && !args.forceReview) {
      const entryId = await postTransactionEntry(ctx, {
        entity,
        bankAccount,
        date: args.date,
        amountMinor: args.amountMinor,
        merchant: args.merchant,
        source: args.source,
        sourceId: args.externalId,
        categoryAccountId: args.matchAccountId,
        memoSuffix: "matched record",
        actorUserId,
      });
      await ctx.db.patch(transactionId, {
        review: "auto",
        categoryAccountId: args.matchAccountId,
        entryId,
        decidedBy: "match",
        confidence: 0.97,
        reasoning: "Pipeline stage 2 matched this item to an open record.",
        updatedAt: now,
      });
      return { status: "posted" as const, transactionId, entryId, stage: "match" as const };
    }

    const matchingRule = await findMatchingRule(ctx, args);
    const categoryAccountId = args.categoryAccountId ?? matchingRule?.categoryAccountId;

    if (matchingRule) {
      await ctx.db.patch(matchingRule._id, {
        hitCount: matchingRule.hitCount + 1,
        updatedAt: now,
      });
    }

    if (categoryAccountId && (matchingRule?.autoPost || args.categoryAccountId) && !args.forceReview) {
      const entryId = await postTransactionEntry(ctx, {
        entity,
        bankAccount,
        date: args.date,
        amountMinor: args.amountMinor,
        merchant: args.merchant,
        source: args.source,
        sourceId: args.externalId,
        categoryAccountId,
        memoSuffix: matchingRule ? `rule: ${matchingRule.name}` : "seeded category",
        actorUserId,
      });
      await ctx.db.patch(transactionId, {
        review: "auto",
        categoryAccountId,
        entryId,
        decidedBy: "rule",
        confidence: matchingRule ? 0.93 : 0.91,
        reasoning: matchingRule
          ? `Pipeline stage 3 matched rule "${matchingRule.name}".`
          : "Pipeline stage 3 posted a deterministic seeded category.",
        updatedAt: now,
      });
      return { status: "posted" as const, transactionId, entryId, stage: "rule" as const };
    }

    const correctionMemory = await findCorrectionMemory(ctx, {
      entityId: args.entityId,
      merchant: args.merchant,
      amountMinor: args.amountMinor,
    });
    if (correctionMemory && !args.forceReview) {
      return await routeProposedCategory(ctx, {
        entity,
        bankAccount,
        transactionId,
        date: args.date,
        amountMinor: args.amountMinor,
        merchant: args.merchant,
        source: args.source,
        sourceId: args.externalId,
        categoryAccountId: correctionMemory.categoryAccountId,
        confidence: 0.92,
        reasoning: `Pipeline stage 4 matched correction memory for ${correctionMemory.merchantDisplayName}.`,
        stage: "memory",
        now,
        actorUserId,
      });
    }

    if (args.semanticMemoryProposal && !args.forceReview) {
      return await routeProposedCategory(ctx, {
        entity,
        bankAccount,
        transactionId,
        date: args.date,
        amountMinor: args.amountMinor,
        merchant: args.merchant,
        source: args.source,
        sourceId: args.externalId,
        categoryAccountId: args.semanticMemoryProposal.categoryAccountId,
        confidence: args.semanticMemoryProposal.confidence,
        reasoning: args.semanticMemoryProposal.reasoning,
        stage: "memory",
        now,
        actorUserId,
      });
    }

    if (args.plaidPriorAccountId && !args.forceReview) {
      return await routeProposedCategory(ctx, {
        entity,
        bankAccount,
        transactionId,
        date: args.date,
        amountMinor: args.amountMinor,
        merchant: args.merchant,
        source: args.source,
        sourceId: args.externalId,
        categoryAccountId: args.plaidPriorAccountId,
        confidence: 0.7,
        reasoning: "Pipeline stage 5 used Plaid personal finance category as a weak prior.",
        stage: "plaid_prior",
        now,
        actorUserId,
      });
    }

    if (args.aiProposal && !args.forceReview) {
      return await routeProposedCategory(ctx, {
        entity,
        bankAccount,
        transactionId,
        date: args.date,
        amountMinor: args.amountMinor,
        merchant: args.merchant,
        source: args.source,
        sourceId: args.externalId,
        categoryAccountId: args.aiProposal.categoryAccountId,
        confidence: args.aiProposal.confidence,
        reasoning: `Pipeline stage 6 LLM proposal: ${args.aiProposal.reasoning}`,
        stage: "ai",
        needsHuman: args.aiProposal.needsHuman,
        question: args.aiProposal.question,
        now,
        actorUserId,
      });
    }

    await ctx.db.patch(transactionId, {
      categoryAccountId,
      decidedBy: "needs_review",
      confidence: categoryAccountId ? 0.62 : 0.35,
      reasoning: categoryAccountId
        ? "A category was suggested but autonomy threshold was not met."
        : "No transfer, record match, or approved rule reached posting confidence.",
      updatedAt: now,
    });
    await ctx.db.insert("inboxItems", {
      entityId: args.entityId,
      transactionId,
      kind: "categorize",
      payloadSummary: `${args.merchant} needs review for ${args.currency} ${absoluteMinor(args.amountMinor) / 100}`,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    return { status: "needs_review" as const, transactionId, entryId: null, stage: "needs_review" as const };
}

export const routeTransaction = mutation({
  args: routeTransactionArgs,
  handler: async (ctx, args) => {
    const entity = await requireEntity(ctx, args.entityId);
    const bankAccount = await ctx.db.get(args.bankAccountId);
    if (!bankAccount || bankAccount.entityId !== args.entityId) {
      throw new Error("Transaction account does not belong to this entity.");
    }
    return await routeTransactionCore(ctx, args, { entity, bankAccount });
  },
});

export const routeTransactionInternal = internalMutation({
  args: {
    ...routeTransactionArgs,
    actorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new Error("OpenBooks entity not found.");
    }
    const bankAccount = await ctx.db.get(args.bankAccountId);
    if (!bankAccount || bankAccount.entityId !== args.entityId) {
      throw new Error("Transaction account does not belong to this entity.");
    }
    return await routeTransactionCore(ctx, args, {
      entity,
      bankAccount,
      actorUserId: args.actorUserId,
    });
  },
});

async function confirmTransactionCore(
  ctx: MutationCtx,
  args: {
    transactionId: Id<"transactions">;
    categoryAccountId?: Id<"ledgerAccounts">;
  },
) {
  const { entity, transaction } = await requireTransactionForAdmin(ctx, args.transactionId);
  if (transaction.entryId) {
    await ctx.db.patch(transaction._id, {
      review: "confirmed",
      updatedAt: Date.now(),
    });
    return { entryId: transaction.entryId, status: "confirmed" as const };
  }
  const bankAccount = transaction.bankAccountId ? await ctx.db.get(transaction.bankAccountId) : null;
  if (!bankAccount || bankAccount.entityId !== transaction.entityId) {
    throw new Error("Transaction needs a bank account before it can be posted.");
  }
  const categoryAccountId = args.categoryAccountId ?? transaction.categoryAccountId;
  if (!categoryAccountId) {
    throw new Error("Choose a category before confirming this transaction.");
  }
  const entryId = await postTransactionEntry(ctx, {
    entity,
    bankAccount,
    date: transaction.date,
    amountMinor: transaction.amountMinor,
    merchant: transaction.merchant,
    source: transaction.source,
    sourceId: transaction.externalId,
    categoryAccountId,
    memoSuffix: "human confirmed",
  });
  const now = Date.now();
  await ctx.db.patch(transaction._id, {
    review: "confirmed",
    categoryAccountId,
    entryId,
    decidedBy: "rule",
    confidence: 1,
    reasoning: "Confirmed by human from the Inbox.",
    updatedAt: now,
  });
  await recordCorrectionMemory(ctx, {
    entity,
    transaction,
    categoryAccountId,
    now,
  });
  await resolveInboxItems(ctx, transaction.entityId, transaction._id, now);
  return { entryId, status: "confirmed" as const };
}

export const confirmTransaction = mutation({
  args: {
    transactionId: v.id("transactions"),
    categoryAccountId: v.optional(v.id("ledgerAccounts")),
  },
  handler: async (ctx, args) => {
    return await confirmTransactionCore(ctx, args);
  },
});

export const confirmTransactionInternal = internalMutation({
  args: {
    transactionId: v.id("transactions"),
    categoryAccountId: v.optional(v.id("ledgerAccounts")),
  },
  handler: async (ctx, args) => {
    return await confirmTransactionCore(ctx, args);
  },
});

export const applyProposalToExistingTransactionInternal = internalMutation({
  args: {
    transactionId: v.id("transactions"),
    semanticMemoryProposal: v.optional(semanticMemoryProposalValidator),
    aiProposal: v.optional(aiProposalValidator),
  },
  handler: async (ctx, args) => {
    const { entity, transaction } = await requireTransactionForAdmin(ctx, args.transactionId);
    if (transaction.entryId) {
      return {
        status: "skipped" as const,
        transactionId: transaction._id,
        entryId: transaction.entryId,
        stage: transaction.decidedBy ?? "posted",
        reason: "Transaction already has a posted journal entry.",
      };
    }
    if (transaction.review !== "needs_review") {
      return {
        status: "skipped" as const,
        transactionId: transaction._id,
        entryId: null,
        stage: transaction.decidedBy ?? "reviewed",
        reason: "Transaction is not in needs-review state.",
      };
    }
    const bankAccount = transaction.bankAccountId ? await ctx.db.get(transaction.bankAccountId) : null;
    if (!bankAccount || bankAccount.entityId !== transaction.entityId) {
      return {
        status: "skipped" as const,
        transactionId: transaction._id,
        entryId: null,
        stage: "missing_bank_account",
        reason: "Transaction needs a bank account before AI categorization can post or suggest.",
      };
    }
    const now = Date.now();
    if (args.semanticMemoryProposal) {
      return await routeExistingProposedCategory(ctx, {
        entity,
        bankAccount,
        transaction,
        categoryAccountId: args.semanticMemoryProposal.categoryAccountId,
        confidence: args.semanticMemoryProposal.confidence,
        reasoning: args.semanticMemoryProposal.reasoning,
        stage: "memory",
        now,
      });
    }
    if (args.aiProposal) {
      return await routeExistingProposedCategory(ctx, {
        entity,
        bankAccount,
        transaction,
        categoryAccountId: args.aiProposal.categoryAccountId,
        confidence: args.aiProposal.confidence,
        reasoning: `Pipeline stage 6 LLM proposal: ${args.aiProposal.reasoning}`,
        stage: "ai",
        needsHuman: args.aiProposal.needsHuman,
        ...(args.aiProposal.question ? { question: args.aiProposal.question } : {}),
        now,
      });
    }
    return {
      status: "skipped" as const,
      transactionId: transaction._id,
      entryId: null,
      stage: transaction.decidedBy ?? "needs_review",
      reason: "No AI or semantic-memory proposal was supplied.",
    };
  },
});

async function recategorizeTransactionCore(
  ctx: MutationCtx,
  args: {
    transactionId: Id<"transactions">;
    categoryAccountId: Id<"ledgerAccounts">;
  },
) {
  const { entity, transaction } = await requireTransactionForAdmin(ctx, args.transactionId);
  const categoryAccount = await ctx.db.get(args.categoryAccountId);
  if (!categoryAccount || categoryAccount.entityId !== transaction.entityId || categoryAccount.archived) {
    throw new Error("Choose an active category on this entity.");
  }
  const bankAccount = transaction.bankAccountId ? await ctx.db.get(transaction.bankAccountId) : null;
  if (!bankAccount || bankAccount.entityId !== transaction.entityId) {
    throw new Error("Transaction needs a bank account before it can be recategorized.");
  }
  if (transaction.entryId) {
    await reverseExistingEntry(ctx, {
      entityId: transaction.entityId,
      entryId: transaction.entryId,
      date: transaction.date,
      memo: `${transaction.merchant} - reverse old category`,
      sourceId: transaction._id,
    });
  }
  const entryId = await postTransactionEntry(ctx, {
    entity,
    bankAccount,
    date: transaction.date,
    amountMinor: transaction.amountMinor,
    merchant: transaction.merchant,
    source: transaction.source,
    sourceId: transaction.externalId,
    categoryAccountId: args.categoryAccountId,
    memoSuffix: "recategorized",
  });
  const now = Date.now();
  await ctx.db.patch(transaction._id, {
    review: "confirmed",
    categoryAccountId: args.categoryAccountId,
    entryId,
    decidedBy: "rule",
    confidence: 1,
    reasoning: "Recategorized by human with reversal and repost.",
    updatedAt: now,
  });
  await recordCorrectionMemory(ctx, {
    entity,
    transaction,
    categoryAccountId: args.categoryAccountId,
    now,
  });
  await resolveInboxItems(ctx, transaction.entityId, transaction._id, now);
  return { entryId, status: "recategorized" as const };
}

export const recategorizeTransaction = mutation({
  args: {
    transactionId: v.id("transactions"),
    categoryAccountId: v.id("ledgerAccounts"),
  },
  handler: async (ctx, args) => {
    return await recategorizeTransactionCore(ctx, args);
  },
});

export const recategorizeTransactionInternal = internalMutation({
  args: {
    transactionId: v.id("transactions"),
    categoryAccountId: v.id("ledgerAccounts"),
  },
  handler: async (ctx, args) => {
    return await recategorizeTransactionCore(ctx, args);
  },
});

export const splitTransaction = mutation({
  args: {
    transactionId: v.id("transactions"),
    splits: v.array(
      v.object({
        categoryAccountId: v.id("ledgerAccounts"),
        amountMinor: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { entity, transaction } = await requireTransactionForAdmin(ctx, args.transactionId);
    if (args.splits.length < 2) {
      throw new Error("A split needs at least two category lines.");
    }
    const bankAccount = transaction.bankAccountId ? await ctx.db.get(transaction.bankAccountId) : null;
    if (!bankAccount || bankAccount.entityId !== transaction.entityId) {
      throw new Error("Transaction needs a bank account before it can be split.");
    }

    let splitTotal = 0;
    const splitAccounts = [];
    for (const split of args.splits) {
      if (!Number.isInteger(split.amountMinor) || split.amountMinor <= 0) {
        throw new Error("Split amounts must be positive integer minor units.");
      }
      const account = await ctx.db.get(split.categoryAccountId);
      if (!account || account.entityId !== transaction.entityId || account.archived) {
        throw new Error("Every split line needs an active category on this entity.");
      }
      splitTotal += split.amountMinor;
      splitAccounts.push({ accountId: account._id, amountMinor: split.amountMinor });
    }
    if (splitTotal !== absoluteMinor(transaction.amountMinor)) {
      throw new Error("Split amounts must equal the transaction amount.");
    }

    if (transaction.entryId) {
      await reverseExistingEntry(ctx, {
        entityId: transaction.entityId,
        entryId: transaction.entryId,
        date: transaction.date,
        memo: `${transaction.merchant} - reverse before split`,
        sourceId: transaction._id,
      });
    }

    const lines =
      transaction.amountMinor >= 0
        ? [
            {
              accountId: bankAccount.ledgerAccountId,
              debitMinor: splitTotal,
              creditMinor: 0,
              currency: entity.currency,
            },
            ...splitAccounts.map((split) => ({
              accountId: split.accountId,
              debitMinor: 0,
              creditMinor: split.amountMinor,
              currency: entity.currency,
            })),
          ]
        : [
            ...splitAccounts.map((split) => ({
              accountId: split.accountId,
              debitMinor: split.amountMinor,
              creditMinor: 0,
              currency: entity.currency,
            })),
            {
              accountId: bankAccount.ledgerAccountId,
              debitMinor: 0,
              creditMinor: splitTotal,
              currency: entity.currency,
            },
          ];

    const entryResult: { entryId: Id<"journalEntries"> } = await ctx.runMutation(api.ledger.postEntry, {
      entityId: transaction.entityId,
      date: transaction.date,
      memo: `${transaction.merchant} - split`,
      source: transaction.source,
      sourceId: transaction.externalId,
      lines,
    });
    const now = Date.now();
    await ctx.db.patch(transaction._id, {
      review: "confirmed",
      categoryAccountId: splitAccounts[0].accountId,
      entryId: entryResult.entryId,
      decidedBy: "rule",
      confidence: 1,
      reasoning: `Split by human into ${splitAccounts.length} ledger categories.`,
      updatedAt: now,
    });
    await resolveInboxItems(ctx, transaction.entityId, transaction._id, now);
    return { entryId: entryResult.entryId, status: "split" as const };
  },
});

export const createRuleFromTransaction = mutation({
  args: {
    transactionId: v.id("transactions"),
    categoryAccountId: v.id("ledgerAccounts"),
  },
  handler: async (ctx, args) => {
    const { transaction } = await requireTransactionForAdmin(ctx, args.transactionId);
    const account = await ctx.db.get(args.categoryAccountId);
    if (!account || account.entityId !== transaction.entityId || account.archived) {
      throw new Error("Choose an active category before saving a rule.");
    }
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_entity", (q) => q.eq("entityId", transaction.entityId))
      .collect();
    const now = Date.now();
    const ruleId = await ctx.db.insert("rules", {
      entityId: transaction.entityId,
      order: Math.max(0, ...rules.map((rule) => rule.order)) + 1,
      name: `Always categorize ${transaction.merchant}`,
      merchantContains: transaction.merchant,
      descriptionContains: undefined,
      direction: directionFor(transaction.amountMinor),
      categoryAccountId: args.categoryAccountId,
      autoPost: true,
      hitCount: 0,
      active: true,
      createdBy: "user",
      createdAt: now,
      updatedAt: now,
    });
    return { ruleId, status: "created" as const };
  },
});

export const excludeTransaction = mutation({
  args: {
    transactionId: v.id("transactions"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { transaction } = await requireTransactionForAdmin(ctx, args.transactionId);
    if (transaction.entryId) {
      await reverseExistingEntry(ctx, {
        entityId: transaction.entityId,
        entryId: transaction.entryId,
        date: transaction.date,
        memo: `${transaction.merchant} - excluded`,
        sourceId: transaction._id,
      });
    }
    const now = Date.now();
    await ctx.db.patch(transaction._id, {
      review: "excluded",
      reasoning: args.reason.trim() || "Excluded by human.",
      updatedAt: now,
    });
    await resolveInboxItems(ctx, transaction.entityId, transaction._id, now);
    return { status: "excluded" as const };
  },
});
