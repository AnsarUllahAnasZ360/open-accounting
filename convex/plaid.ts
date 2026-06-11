import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";

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

const validateEntityAccessRef = makeFunctionReference<
  "query",
  { entityId: Id<"entities"> },
  { entityId: Id<"entities">; workspaceId: Id<"workspaces">; currency: string }
>("plaid:validateEntityAccess");

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

async function callPlaid(path: string, body: Record<string, unknown>) {
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

async function reverseRemovedPlaidTransaction(
  ctx: MutationCtx,
  args: {
    entityId: Id<"entities">;
    transaction: Doc<"transactions">;
    plaidTransactionId: string;
  },
) {
  if (!args.transaction.entryId) return false;
  const lines = await ctx.db
    .query("journalLines")
    .withIndex("by_entry", (q) => q.eq("entryId", args.transaction.entryId!))
    .collect();
  if (lines.length === 0) return false;

  await ctx.runMutation(api.ledger.postEntry, {
    entityId: args.entityId,
    date: args.transaction.date,
    memo: `${args.transaction.merchant} - Plaid removed transaction reversal`,
    source: "bank",
    sourceId: `plaid-removed:${args.plaidTransactionId}`,
    reversesEntryId: args.transaction.entryId,
    lines: lines.map((line) => ({
      accountId: line.accountId,
      debitMinor: line.creditMinor,
      creditMinor: line.debitMinor,
      currency: line.currency,
    })),
  });
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
      entityId: args.entity._id,
      transaction,
      plaidTransactionId,
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
    const result: PlaidRouteResult = await ctx.runMutation(api.pipeline.routeTransaction, routeArgs);
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
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .order("desc")
      .take(100);
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
        lastSyncCursor: account.lastSyncCursor ?? null,
        lastSyncedAt: account.lastSyncedAt ?? null,
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
    try {
      exchanged = await callPlaid("/item/public_token/exchange", {
        public_token: args.publicToken,
      });
      const accessToken = String(exchanged.access_token);
      accountsPayload = await callPlaid("/accounts/get", {
        access_token: accessToken,
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
      ? accountsPayload.accounts.map((account) => normalizePlaidAccount(account, entity.currency))
      : [];

    return {
      mode: "sandbox" as const,
      accessTokenPersisted: false,
      persistenceBlocker: "Schema-owned integration work must persist Plaid access tokens before real sync can run.",
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
          plaidItemId: "openbooks-sandbox-fixture",
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
        plaidItemId: "openbooks-sandbox-fixture",
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
  },
});

function normalizePlaidAccount(account: unknown, currency: string) {
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
      include: true,
    },
    {
      plaidAccountId: "fixture-credit",
      name: "Plaid Sandbox Credit Card",
      mask: "1111",
      subtype: "credit card",
      balanceMinor: -8790,
      currency,
      include: true,
    },
  ];
}
