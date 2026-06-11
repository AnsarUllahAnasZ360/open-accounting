import { v } from "convex/values";

import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";

const sourceValidator = v.union(v.literal("bank"), v.literal("stripe"), v.literal("manual"));

function directionFor(amountMinor: number) {
  return amountMinor >= 0 ? "inflow" : "outflow";
}

function includesText(haystack: string, needle: string | undefined) {
  return !needle || haystack.toLowerCase().includes(needle.toLowerCase());
}

function absoluteMinor(amountMinor: number) {
  return Math.abs(amountMinor);
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
  },
) {
  const amount = absoluteMinor(args.amountMinor);
  const debitAccountId = args.amountMinor >= 0 ? args.bankAccount.ledgerAccountId : args.categoryAccountId;
  const creditAccountId = args.amountMinor >= 0 ? args.categoryAccountId : args.bankAccount.ledgerAccountId;
  const result: { entryId: Id<"journalEntries"> } = await ctx.runMutation(api.ledger.postEntry, {
    entityId: args.entity._id,
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
  return result.entryId;
}

export const routeTransaction = mutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    const entity = await requireEntity(ctx, args.entityId);
    const bankAccount = await ctx.db.get(args.bankAccountId);
    if (!bankAccount || bankAccount.entityId !== args.entityId) {
      throw new Error("Transaction account does not belong to this entity.");
    }

    const duplicate = await ctx.db
      .query("transactions")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.externalId))
      .first();
    if (duplicate && duplicate.entityId === args.entityId) {
      return {
        status: "duplicate" as const,
        transactionId: duplicate._id,
        entryId: duplicate.entryId ?? null,
        stage: duplicate.decidedBy ?? "needs_review",
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
      const entryResult: { entryId: Id<"journalEntries"> } = await ctx.runMutation(api.ledger.postEntry, {
        entityId: args.entityId,
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
        entryId: entryResult.entryId,
        transferPairId: `${args.externalId}:transfer`,
        decidedBy: "transfer",
        confidence: 0.99,
        reasoning: "Pipeline stage 1 detected a transfer between ledger accounts.",
        updatedAt: now,
      });
      return { status: "posted" as const, transactionId, entryId: entryResult.entryId, stage: "transfer" as const };
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
  },
});

export const confirmTransaction = mutation({
  args: {
    transactionId: v.id("transactions"),
    categoryAccountId: v.optional(v.id("ledgerAccounts")),
  },
  handler: async (ctx, args) => {
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
    await resolveInboxItems(ctx, transaction.entityId, transaction._id, now);
    return { entryId, status: "confirmed" as const };
  },
});

export const recategorizeTransaction = mutation({
  args: {
    transactionId: v.id("transactions"),
    categoryAccountId: v.id("ledgerAccounts"),
  },
  handler: async (ctx, args) => {
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
    await resolveInboxItems(ctx, transaction.entityId, transaction._id, now);
    return { entryId, status: "recategorized" as const };
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
