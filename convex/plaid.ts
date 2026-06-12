import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";
import { postLedgerEntryCore } from "./ledger";
import { ensureSystemSyncActor } from "./systemActors";

type PlaidEnvironment = "sandbox" | "missing" | "unsupported";

type PlaidEnvInput = {
  PLAID_CLIENT_ID?: string;
  PLAID_SECRET?: string;
  PLAID_ENV?: string;
};

export type PlaidEnvState = {
  environment: PlaidEnvironment;
  hasClientId: boolean;
  hasSecret: boolean;
  ready: boolean;
  problems: string[];
};

export type PlaidPersonalFinanceCategory = {
  primary: string;
  detailed: string;
  confidence_level?: string | null;
};

export type PlaidTransactionLike = {
  transaction_id: string;
  account_id: string;
  date: string;
  amount: number;
  name: string;
  merchant_name?: string | null;
  pending: boolean;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
  personal_finance_category?: PlaidPersonalFinanceCategory | null;
};

export type PipelineMappedPlaidTransaction = {
  externalId: string;
  plaidAccountId: string;
  date: string;
  amountMinor: number;
  currency: string;
  merchant: string;
  rawDescription: string;
  status: "pending" | "posted";
  plaidPrior: {
    primary: string;
    detailed: string;
    confidenceLevel: string | null;
  } | null;
};

export type PendingCarryoverCandidate = {
  transactionId: string;
  plaidTransactionId: string;
  accountId: string;
  date: string;
  amountMinor: number;
  merchant: string;
  categoryAccountId?: string;
  receiptDocumentId?: string;
};

type PlaidRouteResult = {
  status: "posted" | "needs_review" | "duplicate";
  stage: string;
};

type PlaidSyncTrigger = "cron" | "webhook" | "manual";

type PlaidSyncResult = {
  stagedCount: number;
  postedCount: number;
  needsReviewCount: number;
  duplicateCount: number;
  plaidPriorCount: number;
  removedCount: number;
  removedReversalCount: number;
  nextCursor: string;
};

type PlaidItemSyncResult = PlaidSyncResult & {
  status: "synced" | "skipped" | "missing_item";
  itemId: string;
  unmatchedAccountCount: number;
  trigger: PlaidSyncTrigger;
};

type ListActiveSyncTargetsResult = Array<{
  plaidItemId: string;
  entityId: Id<"entities">;
  lastSyncCursor: string | null;
  lastSyncedAt: number | null;
}>;

type ClaimPlaidItemSyncArgs = {
  plaidItemId: string;
  trigger: PlaidSyncTrigger;
  entityId?: Id<"entities">;
  webhookCode?: string;
};

type ClaimPlaidItemSyncResult =
  | {
      status: "claimed";
      item: {
        plaidItemId: string;
        entityId: Id<"entities">;
        accessToken: string;
        institutionName: string;
        lastSyncCursor: string | null;
      };
    }
  | {
      status: "missing_item" | "skipped" | "locked";
      reason?: string;
      item: null;
    };

type ReleasePlaidItemSyncArgs = {
  plaidItemId: string;
  status: "active" | "relink_required";
  institutionName?: string;
  itemLoginRequired?: boolean;
};

type ReleasePlaidItemSyncResult = {
  status: "released" | "missing_item";
};

type SyncItemTransactionsInternalArgs = {
  plaidItemId: string;
  transactions: PlaidTransactionLike[];
  removedTransactionIds: string[];
  nextCursor: string;
  trigger: PlaidSyncTrigger;
  webhookCode?: string;
};

type SyncItemByPlaidItemIdArgs = {
  plaidItemId: string;
  trigger: PlaidSyncTrigger;
  entityId?: Id<"entities">;
  webhookCode?: string;
};

type SyncItemByPlaidItemIdResult =
  | PlaidItemSyncResult
  | {
      status: "missing_item" | "skipped" | "locked" | "error";
      itemId: string;
      trigger: PlaidSyncTrigger;
      reason?: string;
    };

const validateEntityAccessRef = makeFunctionReference<
  "query",
  { entityId: Id<"entities"> },
  { entityId: Id<"entities">; workspaceId: Id<"workspaces">; currency: string }
>("plaid:validateEntityAccess");
const listActiveSyncTargetsRef = makeFunctionReference<
  "query",
  Record<string, never>,
  ListActiveSyncTargetsResult
>("plaid:listActiveSyncTargets");
const claimPlaidItemSyncRef = makeFunctionReference<
  "mutation",
  ClaimPlaidItemSyncArgs,
  ClaimPlaidItemSyncResult
>("plaid:claimPlaidItemSync");
const releasePlaidItemSyncRef = makeFunctionReference<
  "mutation",
  ReleasePlaidItemSyncArgs,
  ReleasePlaidItemSyncResult
>("plaid:releasePlaidItemSync");
const syncItemTransactionsInternalRef = makeFunctionReference<
  "mutation",
  SyncItemTransactionsInternalArgs,
  PlaidItemSyncResult
>("plaid:syncItemTransactionsInternal");
const categorizePendingTransactionsForImportInternalRef = makeFunctionReference<
  "action",
  { entityId: Id<"entities">; actorUserId: Id<"users">; limit?: number },
  unknown
>("bedrockCategorizer:categorizePendingTransactionsForImportInternal");
const syncItemByPlaidItemIdRef = makeFunctionReference<
  "action",
  SyncItemByPlaidItemIdArgs,
  SyncItemByPlaidItemIdResult
>("plaid:syncItemByPlaidItemId");

const plaidPersonalFinanceCategoryValidator = v.object({
  primary: v.string(),
  detailed: v.string(),
  confidence_level: v.optional(v.union(v.string(), v.null())),
});

const plaidTransactionValidator = v.object({
  transaction_id: v.string(),
  account_id: v.string(),
  date: v.string(),
  amount: v.number(),
  name: v.string(),
  merchant_name: v.optional(v.union(v.string(), v.null())),
  pending: v.boolean(),
  iso_currency_code: v.optional(v.union(v.string(), v.null())),
  unofficial_currency_code: v.optional(v.union(v.string(), v.null())),
  personal_finance_category: v.optional(v.union(plaidPersonalFinanceCategoryValidator, v.null())),
});

const plaidSyncTriggerValidator = v.union(v.literal("cron"), v.literal("webhook"), v.literal("manual"));

export const openBooksSandboxUser = {
  username: "openbooks_user_transactions_dynamic",
  password: "pass_good",
  type: "user_transactions_dynamic",
  description: "OpenBooks Plaid sandbox user with dynamic transactions enabled.",
  transactions: [
    {
      date_transacted: "2026-06-03",
      date_posted: "2026-06-04",
      amount: 49.99,
      description: "Notion subscription",
      currency: "USD",
    },
    {
      date_transacted: "2026-06-04",
      date_posted: "2026-06-05",
      amount: -1250,
      description: "Client ACH payment",
      currency: "USD",
    },
    {
      date_transacted: "2026-06-06",
      date_posted: "2026-06-07",
      amount: 18.75,
      description: "Bank service fee",
      currency: "USD",
    },
  ],
} as const;

function present(value: string | undefined) {
  return Boolean(value && value.trim());
}

export function normalizePlaidEnvState(env: PlaidEnvInput): PlaidEnvState {
  const hasClientId = present(env.PLAID_CLIENT_ID);
  const hasSecret = present(env.PLAID_SECRET);
  const requestedEnv = env.PLAID_ENV?.trim().toLowerCase();
  const environment: PlaidEnvironment = requestedEnv
    ? requestedEnv === "sandbox"
      ? "sandbox"
      : "unsupported"
    : "missing";
  const problems = [];
  if (!hasClientId) problems.push("PLAID_CLIENT_ID is missing.");
  if (!hasSecret) problems.push("PLAID_SECRET is missing.");
  if (environment === "missing") problems.push("PLAID_ENV must be sandbox.");
  if (environment === "unsupported") problems.push("Only Plaid sandbox is allowed for this goal.");

  return {
    environment,
    hasClientId,
    hasSecret,
    ready: hasClientId && hasSecret && environment === "sandbox",
    problems,
  };
}

export function buildPlaidSandboxPublicTokenRequest({
  institutionId = "ins_109508",
  user = openBooksSandboxUser,
}: {
  institutionId?: string;
  user?: typeof openBooksSandboxUser;
}) {
  return {
    institution_id: institutionId,
    initial_products: ["transactions"],
    options: {
      override_username: user.username,
      transactions: {
        days_requested: 730,
      },
    },
  };
}

export function normalizeTransactionsSync(response: {
  added?: Array<{ transaction_id: string }>;
  modified?: Array<{ transaction_id: string }>;
  removed?: Array<{ transaction_id: string }>;
  next_cursor?: string;
  has_more?: boolean;
}) {
  const addedIds = (response.added ?? []).map((transaction) => transaction.transaction_id);
  const modifiedIds = (response.modified ?? []).map((transaction) => transaction.transaction_id);
  const removedIds = (response.removed ?? []).map((transaction) => transaction.transaction_id);
  return {
    addedIds,
    modifiedIds,
    removedIds,
    nextCursor: response.next_cursor ?? "",
    hasMore: Boolean(response.has_more),
    addedCount: addedIds.length,
    modifiedCount: modifiedIds.length,
    removedCount: removedIds.length,
  };
}

function plaidAmountToOpenBooksMinor(amount: number) {
  if (!Number.isFinite(amount)) {
    throw new Error("Plaid amount must be finite.");
  }
  return -Math.round(amount * 100);
}

function normalizeMerchant(transaction: PlaidTransactionLike) {
  return (transaction.merchant_name || transaction.name || "Plaid transaction").trim();
}

function daysBetween(a: string, b: string) {
  const first = Date.parse(`${a}T00:00:00Z`);
  const second = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(first) || Number.isNaN(second)) return Number.POSITIVE_INFINITY;
  return Math.abs(first - second) / 86_400_000;
}

export function findPendingCarryover(
  postedTransaction: PlaidTransactionLike,
  candidates: PendingCarryoverCandidate[],
) {
  const mapped = mapPlaidTransactionToPipeline(postedTransaction);
  const merchant = mapped.merchant.toLowerCase();
  return candidates.find((candidate) => {
    const sameAccount = candidate.accountId === postedTransaction.account_id;
    const sameAmount = candidate.amountMinor === mapped.amountMinor;
    const closeDate = daysBetween(candidate.date, postedTransaction.date) <= 3;
    const candidateMerchant = candidate.merchant.toLowerCase();
    const closeMerchant = merchant.includes(candidateMerchant) || candidateMerchant.includes(merchant);
    return sameAccount && sameAmount && closeDate && closeMerchant;
  }) ?? null;
}

export function mapPlaidTransactionToPipeline(
  transaction: PlaidTransactionLike,
  defaultCurrency = "USD",
): PipelineMappedPlaidTransaction {
  const prior = transaction.personal_finance_category
    ? {
        primary: transaction.personal_finance_category.primary,
        detailed: transaction.personal_finance_category.detailed,
        confidenceLevel: transaction.personal_finance_category.confidence_level ?? null,
      }
    : null;
  const rawDescription = prior
    ? `${transaction.name} | Plaid prior: ${prior.primary}/${prior.detailed} (${prior.confidenceLevel ?? "unknown"})`
    : transaction.name;

  return {
    externalId: `plaid:${transaction.transaction_id}`,
    plaidAccountId: transaction.account_id,
    date: transaction.date,
    amountMinor: plaidAmountToOpenBooksMinor(transaction.amount),
    currency: transaction.iso_currency_code ?? defaultCurrency,
    merchant: normalizeMerchant(transaction),
    rawDescription,
    status: transaction.pending ? "pending" : "posted",
    plaidPrior: prior,
  };
}

export function buildItemLoginRequiredInboxPayload({
  institutionName,
  itemId,
}: {
  institutionName: string;
  itemId: string;
}) {
  return {
    kind: "connection" as const,
    payloadSummary: `${institutionName} needs you to sign in again. Relink item ${itemId} in update mode.`,
  };
}

function plaidBaseUrl() {
  return "https://sandbox.plaid.com";
}

function plaidCredentials() {
  return {
    client_id: process.env.PLAID_CLIENT_ID,
    secret: process.env.PLAID_SECRET,
  };
}

function plaidEnvInput(): PlaidEnvInput {
  return {
    PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID,
    PLAID_SECRET: process.env.PLAID_SECRET,
    PLAID_ENV: process.env.PLAID_ENV,
  };
}

async function requireEntity(ctx: QueryCtx | MutationCtx, entityId: Id<"entities">) {
  const entity = await ctx.db.get(entityId);
  if (!entity) {
    throw new Error("OpenBooks entity not found.");
  }
  await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
  return entity;
}

function accountKind(subtype: string): Doc<"bankAccounts">["kind"] {
  if (subtype === "savings") return "savings";
  if (subtype === "credit card" || subtype === "credit") return "credit";
  return "checking";
}

function accountType(kind: Doc<"bankAccounts">["kind"]): Doc<"ledgerAccounts">["type"] {
  return kind === "credit" ? "liability" : "asset";
}

function accountSubtype(kind: Doc<"bankAccounts">["kind"]) {
  return kind === "credit" ? "credit_card" : "bank";
}

function fixtureCursor(transactions: PlaidTransactionLike[], removedTransactionIds: string[]) {
  const lastTransactionId = transactions[transactions.length - 1]?.transaction_id ?? "none";
  const lastRemovedId = removedTransactionIds[removedTransactionIds.length - 1] ?? "none";
  return `fixture:${transactions.length}:${lastTransactionId}:${removedTransactionIds.length}:${lastRemovedId}`;
}

async function nextLedgerAccountNumber(ctx: MutationCtx, entityId: Id<"entities">, kind: Doc<"bankAccounts">["kind"]) {
  const accounts = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .take(200);
  const used = new Set(accounts.map((account) => account.number));
  const start = kind === "credit" ? 2001 : 1030;
  const end = kind === "credit" ? 2099 : 1099;
  for (let candidate = start; candidate <= end; candidate += 1) {
    const number = String(candidate);
    if (!used.has(number)) return number;
  }
  throw new Error("No chart-of-accounts slot is available for this Plaid account.");
}

export async function callPlaid(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${plaidBaseUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...plaidCredentials(),
      ...body,
    }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const errorCode = typeof payload.error_code === "string" ? payload.error_code : "PLAID_REQUEST_FAILED";
    const errorMessage = typeof payload.error_message === "string" ? payload.error_message : "Plaid sandbox request failed.";
    throw new Error(`${errorCode}: ${errorMessage}`);
  }
  return payload;
}

function plaidSandboxFallbackEnv(env: PlaidEnvState, error: unknown): PlaidEnvState {
  const message = error instanceof Error ? error.message : "PLAID_REQUEST_FAILED";
  const errorCode = message.split(":")[0]?.trim() || "PLAID_REQUEST_FAILED";
  return {
    ...env,
    ready: false,
    problems: [
      ...env.problems,
      `Plaid sandbox call failed with ${errorCode}; using fixture mode for this milestone.`,
    ],
  };
}

function emptyPlaidSyncSummary(nextCursor: string): PlaidSyncResult {
  return {
    stagedCount: 0,
    postedCount: 0,
    needsReviewCount: 0,
    duplicateCount: 0,
    plaidPriorCount: 0,
    removedCount: 0,
    removedReversalCount: 0,
    nextCursor,
  };
}

function emptyItemSyncResult(
  status: PlaidItemSyncResult["status"],
  itemId: string,
  trigger: PlaidSyncTrigger,
  nextCursor: string,
): PlaidItemSyncResult {
  return {
    status,
    itemId,
    trigger,
    unmatchedAccountCount: 0,
    ...emptyPlaidSyncSummary(nextCursor),
  };
}

function addSyncSummary(total: PlaidSyncResult, next: PlaidSyncResult) {
  total.stagedCount += next.stagedCount;
  total.postedCount += next.postedCount;
  total.needsReviewCount += next.needsReviewCount;
  total.duplicateCount += next.duplicateCount;
  total.plaidPriorCount += next.plaidPriorCount;
  total.removedCount += next.removedCount;
  total.removedReversalCount += next.removedReversalCount;
  total.nextCursor = next.nextCursor || total.nextCursor;
}

async function upsertItemLoginRequiredInbox(
  ctx: MutationCtx,
  args: {
    entityId: Id<"entities">;
    institutionName: string;
    itemId: string;
  },
) {
  const payload = buildItemLoginRequiredInboxPayload({
    institutionName: args.institutionName,
    itemId: args.itemId,
  });
  const now = Date.now();
  const existing = await ctx.db
    .query("inboxItems")
    .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
    .take(100);
  const duplicate = existing.find(
    (item) => item.kind === "connection" && item.status === "open" && item.payloadSummary === payload.payloadSummary,
  );
  if (duplicate) {
    return {
      inboxItemId: duplicate._id,
      payloadSummary: duplicate.payloadSummary,
    };
  }
  const inboxItemId = await ctx.db.insert("inboxItems", {
    entityId: args.entityId,
    kind: payload.kind,
    payloadSummary: payload.payloadSummary,
    status: "open",
    createdAt: now,
    updatedAt: now,
  });
  return { inboxItemId, payloadSummary: payload.payloadSummary };
}

async function reverseRemovedPlaidTransaction(
  ctx: MutationCtx,
  args: {
    entity: Doc<"entities">;
    transaction: Doc<"transactions">;
    plaidTransactionId: string;
    actorUserId?: Id<"users">;
  },
) {
  if (!args.transaction.entryId) return false;
  const lines = await ctx.db
    .query("journalLines")
    .withIndex("by_entry", (q) => q.eq("entryId", args.transaction.entryId!))
    .collect();
  if (lines.length === 0) return false;

  const reversal = {
    date: args.transaction.date,
    memo: `${args.transaction.merchant} - Plaid removed transaction reversal`,
    source: "bank" as const,
    sourceId: `plaid-removed:${args.plaidTransactionId}`,
    reversesEntryId: args.transaction.entryId,
    lines: lines.map((line) => ({
      accountId: line.accountId,
      debitMinor: line.creditMinor,
      creditMinor: line.debitMinor,
      currency: line.currency,
    })),
  };

  if (args.actorUserId) {
    await postLedgerEntryCore(ctx, {
      entity: args.entity,
      userId: args.actorUserId,
      ...reversal,
      auditAction: "system.sync.ledger_entry.reversed",
    });
  } else {
    await ctx.runMutation(api.ledger.postEntry, {
      entityId: args.entity._id,
      ...reversal,
    });
  }
  return true;
}

async function syncPlaidTransactions(
  ctx: MutationCtx,
  args: {
    entity: Doc<"entities">;
    bankAccount: Doc<"bankAccounts">;
    transactions: PlaidTransactionLike[];
    removedTransactionIds: string[];
    nextCursor?: string;
    actorUserId?: Id<"users">;
  },
): Promise<PlaidSyncResult> {
  const now = Date.now();
  const existingTransactions = await ctx.db
    .query("transactions")
    .withIndex("by_entity", (q) => q.eq("entityId", args.entity._id))
    .take(1000);
  const pendingCandidates = existingTransactions
    .filter(
      (transaction) =>
        transaction.source === "bank" &&
        transaction.status === "pending" &&
        transaction.bankAccountId === args.bankAccount._id &&
        transaction.externalId.startsWith("plaid:"),
    )
    .map((transaction) => ({
      transactionId: transaction._id,
      plaidTransactionId: transaction.externalId.replace(/^plaid:/, ""),
      accountId: args.bankAccount.plaidAccountId ?? "fixture-checking",
      date: transaction.date,
      amountMinor: transaction.amountMinor,
      merchant: transaction.merchant,
      categoryAccountId: transaction.categoryAccountId,
    }));

  let removedCount = 0;
  let removedReversalCount = 0;
  for (const plaidTransactionId of args.removedTransactionIds) {
    const transaction = await ctx.db
      .query("transactions")
      .withIndex("by_external_id", (q) => q.eq("externalId", `plaid:${plaidTransactionId}`))
      .first();
    if (!transaction || transaction.entityId !== args.entity._id) continue;
    const reversed = await reverseRemovedPlaidTransaction(ctx, {
      entity: args.entity,
      transaction,
      plaidTransactionId,
      actorUserId: args.actorUserId,
    });
    if (reversed) removedReversalCount += 1;
    await ctx.db.patch(transaction._id, {
      review: "excluded",
      updatedAt: now,
    });
    removedCount += 1;
  }

  let postedCount = 0;
  let needsReviewCount = 0;
  let duplicateCount = 0;
  let plaidPriorCount = 0;
  for (const transaction of args.transactions) {
    const mapped = mapPlaidTransactionToPipeline(transaction, args.entity.currency);
    if (mapped.plaidPrior) plaidPriorCount += 1;
    const carryover = transaction.pending ? null : findPendingCarryover(transaction, pendingCandidates);
    if (carryover) {
      await ctx.db.patch(carryover.transactionId as Id<"transactions">, {
        review: "excluded",
        updatedAt: now,
      });
    }
    const routeArgs = {
      entityId: args.entity._id,
      bankAccountId: args.bankAccount._id,
      date: mapped.date,
      amountMinor: mapped.amountMinor,
      currency: mapped.currency,
      merchant: mapped.merchant,
      rawDescription: mapped.rawDescription,
      status: mapped.status,
      source: "bank",
      externalId: mapped.externalId,
    } as {
      entityId: Id<"entities">;
      bankAccountId: Id<"bankAccounts">;
      date: string;
      amountMinor: number;
      currency: string;
      merchant: string;
      rawDescription: string;
      status: "pending" | "posted";
      source: "bank";
      externalId: string;
      categoryAccountId?: Id<"ledgerAccounts">;
    };
    if (carryover?.categoryAccountId) {
      routeArgs.categoryAccountId = carryover.categoryAccountId as Id<"ledgerAccounts">;
    }
    const result: PlaidRouteResult = args.actorUserId
      ? await ctx.runMutation(internal.pipeline.routeTransactionInternal, {
          ...routeArgs,
          actorUserId: args.actorUserId,
        })
      : await ctx.runMutation(api.pipeline.routeTransaction, routeArgs);
    if (result.status === "posted") postedCount += 1;
    if (result.status === "needs_review") needsReviewCount += 1;
    if (result.status === "duplicate") duplicateCount += 1;
  }

  const nextCursor = args.nextCursor ?? fixtureCursor(args.transactions, args.removedTransactionIds);
  await ctx.db.patch(args.bankAccount._id, {
    lastSyncCursor: nextCursor,
    lastSyncedAt: now,
    updatedAt: now,
  });

  return {
    stagedCount: args.transactions.length,
    postedCount,
    needsReviewCount,
    duplicateCount,
    plaidPriorCount,
    removedCount,
    removedReversalCount,
    nextCursor,
  };
}

export const envState = query({
  args: {},
  handler: async (ctx): Promise<PlaidEnvState> => {
    await requireAnyWorkspaceRole(ctx, "member");
    return normalizePlaidEnvState(plaidEnvInput());
  },
});

export const validateEntityAccess = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entity = await requireEntity(ctx, args.entityId);
    return {
      entityId: entity._id,
      workspaceId: entity.workspaceId,
      currency: entity.currency,
    };
  },
});

export const listConnectionState = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entity = await requireEntity(ctx, args.entityId);
    const bankAccounts = await ctx.db
      .query("bankAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .take(100);
    const plaidItems = await ctx.db
      .query("plaidItems")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .take(20);
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .order("desc")
      .take(1000);
    const inboxItems = await ctx.db
      .query("inboxItems")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .take(100);

    return {
      entity: {
        id: entity._id,
        name: entity.name,
        currency: entity.currency,
      },
      env: normalizePlaidEnvState(plaidEnvInput()),
      accounts: bankAccounts.map((account) => ({
        id: account._id,
        name: account.name,
        mask: account.mask,
        kind: account.kind,
        balanceMinor: account.balanceMinor,
        includeInSync: account.includeInSync,
        plaidAccountId: account.plaidAccountId ?? null,
        plaidItemId: account.plaidItemId ?? null,
        lastSyncCursor: account.lastSyncCursor ?? null,
        lastSyncedAt: account.lastSyncedAt ?? null,
      })),
      items: plaidItems.map((item) => ({
        plaidItemId: item.plaidItemId,
        institutionName: item.institutionName ?? null,
        status: item.status,
        lastSyncCursor: item.lastSyncCursor ?? null,
        lastSyncedAt: item.lastSyncedAt ?? null,
        lastSyncTrigger: item.lastSyncTrigger ?? null,
        lastWebhookCode: item.lastWebhookCode ?? null,
      })),
      recentTransactions: transactions
        .filter((transaction) => transaction.source === "bank" && transaction.externalId.startsWith("plaid:"))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 6)
        .map((transaction) => ({
          id: transaction._id,
          date: transaction.date,
          merchant: transaction.merchant,
          amountMinor: transaction.amountMinor,
          currency: transaction.currency,
          review: transaction.review,
          status: transaction.status,
          plaidPriorCaptured: transaction.rawDescription.includes("Plaid prior:"),
        })),
      connectionIssues: inboxItems
        .filter((item) => item.kind === "connection" && item.status === "open")
        .map((item) => ({
          id: item._id,
          payloadSummary: item.payloadSummary,
        })),
    };
  },
});

export const persistPlaidItem = internalMutation({
  args: {
    entityId: v.id("entities"),
    plaidItemId: v.string(),
    accessToken: v.string(),
    institutionName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireEntity(ctx, args.entityId);
    const existing = await ctx.db
      .query("plaidItems")
      .withIndex("by_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .first();
    const now = Date.now();
    const row = {
      entityId: args.entityId,
      plaidItemId: args.plaidItemId,
      accessToken: args.accessToken,
      ...(args.institutionName ? { institutionName: args.institutionName } : {}),
      environment: "sandbox" as const,
      status: "active" as const,
      updatedAt: now,
    };
    if (existing) {
      if (existing.entityId !== args.entityId) {
        throw new Error("Plaid item belongs to a different OpenBooks entity.");
      }
      await ctx.db.replace(existing._id, {
        ...row,
        ...(existing.lastSyncCursor ? { lastSyncCursor: existing.lastSyncCursor } : {}),
        ...(existing.lastSyncedAt ? { lastSyncedAt: existing.lastSyncedAt } : {}),
        ...(existing.lastSyncStartedAt ? { lastSyncStartedAt: existing.lastSyncStartedAt } : {}),
        ...(existing.syncLockUntil ? { syncLockUntil: existing.syncLockUntil } : {}),
        ...(existing.lastSyncTrigger ? { lastSyncTrigger: existing.lastSyncTrigger } : {}),
        ...(existing.lastWebhookCode ? { lastWebhookCode: existing.lastWebhookCode } : {}),
        createdAt: existing.createdAt,
      });
      return { plaidItemRecordId: existing._id, status: "updated" as const };
    }
    const plaidItemRecordId = await ctx.db.insert("plaidItems", {
      ...row,
      createdAt: now,
    });
    return { plaidItemRecordId, status: "created" as const };
  },
});

export const listActiveSyncTargets = internalQuery({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db.query("plaidItems").take(100);
    return items
      .filter((item) => item.status === "active")
      .map((item) => ({
        plaidItemId: item.plaidItemId,
        entityId: item.entityId,
        lastSyncCursor: item.lastSyncCursor ?? null,
        lastSyncedAt: item.lastSyncedAt ?? null,
      }));
  },
});

export const claimPlaidItemSync = internalMutation({
  args: {
    plaidItemId: v.string(),
    trigger: plaidSyncTriggerValidator,
    entityId: v.optional(v.id("entities")),
    webhookCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("plaidItems")
      .withIndex("by_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .unique();
    if (!item) {
      return { status: "missing_item" as const, item: null };
    }
    if (args.entityId && item.entityId !== args.entityId) {
      return { status: "missing_item" as const, item: null };
    }
    if (item.status !== "active") {
      return { status: "skipped" as const, reason: item.status, item: null };
    }
    const now = Date.now();
    if (item.syncLockUntil && item.syncLockUntil > now) {
      return { status: "locked" as const, reason: "sync_in_progress", item: null };
    }

    await ctx.db.patch(item._id, {
      syncLockUntil: now + 5 * 60_000,
      lastSyncStartedAt: now,
      lastSyncTrigger: args.trigger,
      ...(args.webhookCode ? { lastWebhookCode: args.webhookCode } : {}),
      updatedAt: now,
    });

    return {
      status: "claimed" as const,
      item: {
        plaidItemId: item.plaidItemId,
        entityId: item.entityId,
        accessToken: item.accessToken,
        institutionName: item.institutionName ?? "Plaid institution",
        lastSyncCursor: item.lastSyncCursor ?? null,
      },
    };
  },
});

export const releasePlaidItemSync = internalMutation({
  args: {
    plaidItemId: v.string(),
    status: v.union(v.literal("active"), v.literal("relink_required")),
    institutionName: v.optional(v.string()),
    itemLoginRequired: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("plaidItems")
      .withIndex("by_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .unique();
    if (!item) return { status: "missing_item" as const };

    const now = Date.now();
    await ctx.db.patch(item._id, {
      status: args.status,
      syncLockUntil: undefined,
      updatedAt: now,
    });

    if (args.itemLoginRequired) {
      await upsertItemLoginRequiredInbox(ctx, {
        entityId: item.entityId,
        institutionName: args.institutionName ?? item.institutionName ?? "Plaid institution",
        itemId: item.plaidItemId,
      });
    }

    return { status: "released" as const };
  },
});

export const syncItemTransactionsInternal = internalMutation({
  args: {
    plaidItemId: v.string(),
    transactions: v.array(plaidTransactionValidator),
    removedTransactionIds: v.array(v.string()),
    nextCursor: v.string(),
    trigger: plaidSyncTriggerValidator,
    webhookCode: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PlaidItemSyncResult> => {
    const item = await ctx.db
      .query("plaidItems")
      .withIndex("by_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .unique();
    if (!item) {
      return emptyItemSyncResult("missing_item", args.plaidItemId, args.trigger, args.nextCursor);
    }
    if (item.status !== "active") {
      return emptyItemSyncResult("skipped", args.plaidItemId, args.trigger, args.nextCursor);
    }
    const entity = await ctx.db.get(item.entityId);
    if (!entity) {
      return emptyItemSyncResult("missing_item", args.plaidItemId, args.trigger, args.nextCursor);
    }

    const actorUserId = await ensureSystemSyncActor(ctx, entity.workspaceId);
    const accounts = await ctx.db
      .query("bankAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .collect();
    const syncAccounts = accounts.filter(
      (account) =>
        account.includeInSync &&
        account.plaidItemId === item.plaidItemId &&
        Boolean(account.plaidAccountId),
    );
    const accountsByPlaidId = new Map(syncAccounts.map((account) => [account.plaidAccountId!, account]));
    const transactionsByAccount = new Map<string, PlaidTransactionLike[]>();
    let unmatchedAccountCount = 0;

    for (const transaction of args.transactions) {
      if (!accountsByPlaidId.has(transaction.account_id)) {
        unmatchedAccountCount += 1;
        continue;
      }
      const rows = transactionsByAccount.get(transaction.account_id) ?? [];
      rows.push(transaction);
      transactionsByAccount.set(transaction.account_id, rows);
    }

    const summary = emptyPlaidSyncSummary(args.nextCursor);
    if (args.removedTransactionIds.length > 0) {
      const anchorAccount = syncAccounts[0];
      if (anchorAccount) {
        addSyncSummary(
          summary,
          await syncPlaidTransactions(ctx, {
            entity,
            bankAccount: anchorAccount,
            transactions: [],
            removedTransactionIds: args.removedTransactionIds,
            nextCursor: args.nextCursor,
            actorUserId,
          }),
        );
      }
    }

    for (const [plaidAccountId, transactions] of transactionsByAccount) {
      const bankAccount = accountsByPlaidId.get(plaidAccountId);
      if (!bankAccount) continue;
      addSyncSummary(
        summary,
        await syncPlaidTransactions(ctx, {
          entity,
          bankAccount,
          transactions,
          removedTransactionIds: [],
          nextCursor: args.nextCursor,
          actorUserId,
        }),
      );
    }

    const now = Date.now();
    await ctx.db.patch(item._id, {
      lastSyncCursor: args.nextCursor,
      lastSyncedAt: now,
      syncLockUntil: undefined,
      lastSyncTrigger: args.trigger,
      ...(args.webhookCode ? { lastWebhookCode: args.webhookCode } : {}),
      updatedAt: now,
    });

    if (summary.needsReviewCount > 0) {
      await ctx.scheduler.runAfter(0, categorizePendingTransactionsForImportInternalRef, {
        entityId: entity._id,
        actorUserId,
        limit: Math.min(25, summary.needsReviewCount),
      });
    }

    return {
      status: "synced",
      itemId: args.plaidItemId,
      trigger: args.trigger,
      unmatchedAccountCount,
      ...summary,
      nextCursor: args.nextCursor,
    };
  },
});

export const syncItemByPlaidItemId = internalAction({
  args: {
    plaidItemId: v.string(),
    trigger: plaidSyncTriggerValidator,
    entityId: v.optional(v.id("entities")),
    webhookCode: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SyncItemByPlaidItemIdResult> => {
    const claim = await ctx.runMutation(claimPlaidItemSyncRef, args);
    if (claim.status !== "claimed" || !claim.item) {
      return {
        status: claim.status,
        itemId: args.plaidItemId,
        trigger: args.trigger,
        reason: "reason" in claim ? claim.reason : undefined,
      };
    }

    const env = normalizePlaidEnvState(plaidEnvInput());
    if (!env.ready) {
      await ctx.runMutation(releasePlaidItemSyncRef, {
        plaidItemId: args.plaidItemId,
        status: "active",
      });
      return {
        status: "skipped" as const,
        itemId: args.plaidItemId,
        trigger: args.trigger,
        reason: "plaid_env_not_ready",
      };
    }

    try {
      let cursor = claim.item.lastSyncCursor ?? undefined;
      let hasMore = true;
      let pages = 0;
      const transactions: PlaidTransactionLike[] = [];
      const removedTransactionIds: string[] = [];

      while (hasMore && pages < 4) {
        const payload = await callPlaid("/transactions/sync", {
          access_token: claim.item.accessToken,
          ...(cursor ? { cursor } : {}),
          count: 100,
        });
        const added = Array.isArray(payload.added) ? payload.added as PlaidTransactionLike[] : [];
        const modified = Array.isArray(payload.modified) ? payload.modified as PlaidTransactionLike[] : [];
        const removed = Array.isArray(payload.removed)
          ? payload.removed
            .map((transaction) =>
              transaction && typeof transaction === "object" && "transaction_id" in transaction
                ? String((transaction as { transaction_id: unknown }).transaction_id)
                : null,
            )
            .filter((transactionId): transactionId is string => Boolean(transactionId))
          : [];
        transactions.push(...added, ...modified);
        removedTransactionIds.push(...removed);
        cursor = typeof payload.next_cursor === "string" ? payload.next_cursor : cursor;
        hasMore = Boolean(payload.has_more);
        pages += 1;
      }

      return await ctx.runMutation(syncItemTransactionsInternalRef, {
        plaidItemId: args.plaidItemId,
        transactions,
        removedTransactionIds,
        nextCursor: cursor ?? "",
        trigger: args.trigger,
        ...(args.webhookCode ? { webhookCode: args.webhookCode } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PLAID_SYNC_FAILED";
      const itemLoginRequired = message.includes("ITEM_LOGIN_REQUIRED");
      await ctx.runMutation(releasePlaidItemSyncRef, {
        plaidItemId: args.plaidItemId,
        status: itemLoginRequired ? "relink_required" : "active",
        institutionName: claim.item.institutionName,
        itemLoginRequired,
      });
      return {
        status: itemLoginRequired ? "skipped" as const : "error" as const,
        itemId: args.plaidItemId,
        trigger: args.trigger,
        reason: message,
      };
    }
  },
});

export const syncAllActiveItems = internalAction({
  args: {},
  handler: async (ctx): Promise<{ targetCount: number; results: SyncItemByPlaidItemIdResult[] }> => {
    const targets = await ctx.runQuery(listActiveSyncTargetsRef, {});
    const results = [];
    for (const target of targets) {
      results.push(
        await ctx.runAction(syncItemByPlaidItemIdRef, {
          plaidItemId: target.plaidItemId,
          trigger: "cron",
        }),
      );
    }
    return { targetCount: targets.length, results };
  },
});

export const syncItemNow = action({
  args: {
    entityId: v.id("entities"),
    plaidItemId: v.string(),
  },
  handler: async (ctx, args): Promise<SyncItemByPlaidItemIdResult> => {
    await ctx.runQuery(validateEntityAccessRef, { entityId: args.entityId });
    const result: SyncItemByPlaidItemIdResult = await ctx.runAction(syncItemByPlaidItemIdRef, {
      entityId: args.entityId,
      plaidItemId: args.plaidItemId,
      trigger: "manual",
    });
    return result;
  },
});

export const createLinkToken = action({
  args: {
    entityId: v.id("entities"),
    clientName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.runQuery(validateEntityAccessRef, { entityId: args.entityId });
    const env = normalizePlaidEnvState(plaidEnvInput());
    if (!env.ready) {
      return {
        mode: "fixture" as const,
        linkToken: "fixture-plaid-link-token",
        env,
      };
    }

    let payload: Record<string, unknown>;
    try {
      payload = await callPlaid("/link/token/create", {
        client_name: args.clientName ?? "OpenBooks",
        country_codes: ["US"],
        language: "en",
        products: ["transactions"],
        user: {
          client_user_id: `openbooks:${args.entityId}`,
        },
        transactions: {
          days_requested: 730,
        },
      });
    } catch (error) {
      return {
        mode: "fixture" as const,
        linkToken: "fixture-plaid-link-token",
        env: plaidSandboxFallbackEnv(env, error),
      };
    }

    return {
      mode: "sandbox" as const,
      linkToken: String(payload.link_token),
      env,
    };
  },
});

export const createSandboxPublicToken = action({
  args: {
    entityId: v.id("entities"),
    institutionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.runQuery(validateEntityAccessRef, { entityId: args.entityId });
    const env = normalizePlaidEnvState(plaidEnvInput());
    if (!env.ready) {
      return {
        mode: "fixture" as const,
        publicToken: "fixture-sandbox-public-token",
        request: buildPlaidSandboxPublicTokenRequest({ institutionId: args.institutionId }),
      };
    }

    const request = buildPlaidSandboxPublicTokenRequest({ institutionId: args.institutionId });
    let payload: Record<string, unknown>;
    try {
      payload = await callPlaid("/sandbox/public_token/create", request);
    } catch {
      return {
        mode: "fixture" as const,
        publicToken: "fixture-sandbox-public-token",
        request,
      };
    }
    return {
      mode: "sandbox" as const,
      publicToken: String(payload.public_token),
      request,
    };
  },
});

export const exchangePublicTokenAndPreviewAccounts = action({
  args: {
    entityId: v.id("entities"),
    publicToken: v.string(),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.runQuery(validateEntityAccessRef, { entityId: args.entityId });
    const env = normalizePlaidEnvState(plaidEnvInput());
    if (!env.ready || args.publicToken.startsWith("fixture-")) {
      return {
        mode: "fixture" as const,
        accessTokenPersisted: false,
        accounts: fixturePlaidAccounts(entity.currency),
      };
    }

    let exchanged: Record<string, unknown>;
    let accountsPayload: Record<string, unknown>;
    let plaidItemId: string;
    try {
      exchanged = await callPlaid("/item/public_token/exchange", {
        public_token: args.publicToken,
      });
      const accessToken = String(exchanged.access_token);
      plaidItemId = typeof exchanged.item_id === "string" ? exchanged.item_id : `sandbox-item:${args.entityId}`;
      accountsPayload = await callPlaid("/accounts/get", {
        access_token: accessToken,
      });
      await ctx.runMutation(internal.plaid.persistPlaidItem, {
        entityId: args.entityId,
        plaidItemId,
        accessToken,
      });
    } catch {
      return {
        mode: "fixture" as const,
        accessTokenPersisted: false,
        persistenceBlocker: "Plaid sandbox call failed at runtime; fixture mode is active.",
        accounts: fixturePlaidAccounts(entity.currency),
      };
    }
    const accounts = Array.isArray(accountsPayload.accounts)
      ? accountsPayload.accounts.map((account) => normalizePlaidAccount(account, entity.currency, plaidItemId))
      : [];

    return {
      mode: "sandbox" as const,
      accessTokenPersisted: true,
      accounts,
    };
  },
});

export const selectSandboxFixtureAccounts = mutation({
  args: {
    entityId: v.id("entities"),
    accounts: v.array(
      v.object({
        plaidAccountId: v.string(),
        name: v.string(),
        mask: v.string(),
        subtype: v.string(),
        balanceMinor: v.number(),
        currency: v.string(),
        include: v.boolean(),
        plaidItemId: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const entity = await requireEntity(ctx, args.entityId);
    const now = Date.now();
    const created = [];
    let createdCount = 0;
    const existingBankAccounts = await ctx.db
      .query("bankAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .collect();
    for (const account of args.accounts.filter((candidate) => candidate.include)) {
      const kind = accountKind(account.subtype);
      const existing = existingBankAccounts.find(
        (bankAccount) =>
          bankAccount.plaidAccountId === account.plaidAccountId ||
          (!bankAccount.plaidAccountId &&
            bankAccount.name === account.name &&
            bankAccount.mask === account.mask &&
            bankAccount.kind === kind),
      );
      if (existing) {
        await ctx.db.patch(existing._id, {
          plaidAccountId: account.plaidAccountId,
          plaidItemId: account.plaidItemId || "openbooks-sandbox-fixture",
          includeInSync: true,
          balanceMinor: account.balanceMinor,
          updatedAt: now,
        });
        created.push({
          bankAccountId: existing._id,
          ledgerAccountId: existing.ledgerAccountId,
          plaidAccountId: account.plaidAccountId,
        });
        continue;
      }
      const ledgerAccountId = await ctx.db.insert("ledgerAccounts", {
        entityId: args.entityId,
        name: account.name,
        type: accountType(kind),
        subtype: accountSubtype(kind),
        number: await nextLedgerAccountNumber(ctx, args.entityId, kind),
        currency: account.currency || entity.currency,
        isSystem: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      const bankAccountId = await ctx.db.insert("bankAccounts", {
        entityId: args.entityId,
        ledgerAccountId,
        name: account.name,
        mask: account.mask,
        kind,
        balanceMinor: account.balanceMinor,
        includeInSync: true,
        plaidAccountId: account.plaidAccountId,
        plaidItemId: account.plaidItemId || "openbooks-sandbox-fixture",
        createdAt: now,
        updatedAt: now,
      });
      created.push({ bankAccountId, ledgerAccountId, plaidAccountId: account.plaidAccountId });
      createdCount += 1;
    }
    return { createdCount, accounts: created };
  },
});

export const stageFixtureTransactions = mutation({
  args: {
    entityId: v.id("entities"),
    bankAccountId: v.id("bankAccounts"),
    transactions: v.array(plaidTransactionValidator),
  },
  handler: async (ctx, args) => {
    const entity = await requireEntity(ctx, args.entityId);
    const bankAccount = await ctx.db.get(args.bankAccountId);
    if (!bankAccount || bankAccount.entityId !== args.entityId) {
      throw new Error("Plaid bank account does not belong to this entity.");
    }

    return await syncPlaidTransactions(ctx, {
      entity,
      bankAccount,
      transactions: args.transactions,
      removedTransactionIds: [],
    });
  },
});

export const syncFixtureTransactions = mutation({
  args: {
    entityId: v.id("entities"),
    bankAccountId: v.id("bankAccounts"),
    transactions: v.array(plaidTransactionValidator),
    removedTransactionIds: v.optional(v.array(v.string())),
    nextCursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await requireEntity(ctx, args.entityId);
    const bankAccount = await ctx.db.get(args.bankAccountId);
    if (!bankAccount || bankAccount.entityId !== args.entityId) {
      throw new Error("Plaid bank account does not belong to this entity.");
    }

    return await syncPlaidTransactions(ctx, {
      entity,
      bankAccount,
      transactions: args.transactions,
      removedTransactionIds: args.removedTransactionIds ?? [],
      nextCursor: args.nextCursor,
    });
  },
});

export const handleItemLoginRequired = mutation({
  args: {
    entityId: v.id("entities"),
    institutionName: v.string(),
    itemId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireEntity(ctx, args.entityId);
    return await upsertItemLoginRequiredInbox(ctx, {
      entityId: args.entityId,
      institutionName: args.institutionName,
      itemId: args.itemId,
    });
  },
});

function normalizePlaidAccount(account: unknown, currency: string, plaidItemId?: string) {
  const value = account && typeof account === "object" ? account as Record<string, unknown> : {};
  const balances = value.balances && typeof value.balances === "object" ? value.balances as Record<string, unknown> : {};
  const current = typeof balances.current === "number" ? balances.current : 0;
  const subtype = typeof value.subtype === "string" ? value.subtype : "checking";
  return {
    plaidAccountId: typeof value.account_id === "string" ? value.account_id : "unknown",
    name: typeof value.name === "string" ? value.name : "Plaid account",
    mask: typeof value.mask === "string" ? value.mask : "0000",
    subtype,
    balanceMinor: Math.round(current * 100),
    currency: typeof balances.iso_currency_code === "string" ? balances.iso_currency_code : currency,
    ...(plaidItemId ? { plaidItemId } : {}),
    include: true,
  };
}

function fixturePlaidAccounts(currency: string) {
  return [
    {
      plaidAccountId: "fixture-checking",
      name: "Plaid Sandbox Checking",
      mask: "0000",
      subtype: "checking",
      balanceMinor: 425000,
      currency,
      plaidItemId: "openbooks-sandbox-fixture",
      include: true,
    },
    {
      plaidAccountId: "fixture-credit",
      name: "Plaid Sandbox Credit Card",
      mask: "1111",
      subtype: "credit card",
      balanceMinor: -8790,
      currency,
      plaidItemId: "openbooks-sandbox-fixture",
      include: true,
    },
  ];
}
