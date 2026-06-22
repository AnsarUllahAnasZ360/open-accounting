import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireAnyWorkspacePermission, requireAnyWorkspaceRole, requireWorkspacePermission } from "./authz";
import { postLedgerEntryCore } from "./ledger";
import { decryptSecret, encryptSecret, isSecretEncryptionConfigured, secretEncryptionEnvLabel } from "./secretBox";
import { matchPlaidInflowToPayout } from "./stripe";
import { ensureSystemSyncActor } from "./systemActors";

type PlaidEnvironment = "sandbox" | "development" | "production" | "missing" | "unsupported";

type PlaidEnvInput = {
  PLAID_CLIENT_ID?: string;
  PLAID_SECRET?: string;
  PLAID_ENV?: string;
};

type PlaidApiCredential = {
  clientId: string;
  secret: string;
  environment: "sandbox" | "development" | "production";
  redirectUri?: string;
  webhookUrl?: string;
  products?: string[];
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
  version?: string | null;
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

const PLAID_SYNC_PERSIST_BATCH_SIZE = 25;

type PlaidSyncResult = {
  stagedCount: number;
  postedCount: number;
  needsReviewCount: number;
  duplicateCount: number;
  plaidPriorCount: number;
  payoutMatchCount: number;
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
        accessTokenCiphertext: string | null;
        environment: "sandbox" | "development" | "production";
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

type PlaidSelectableAccount = {
  plaidAccountId: string;
  name: string;
  mask: string;
  subtype: string;
  balanceMinor: number;
  currency: string;
  include: boolean;
  plaidItemId?: string;
  entityId?: Id<"entities">;
};

type UpsertPlaidAccountsForItemArgs = {
  entityId: Id<"entities">;
  plaidItemId?: string;
  accounts: PlaidSelectableAccount[];
  // Optional history start; the opening-balance entry is floored to this date's
  // first-of-month (E1-T2 / decision Q2).
  startDate?: string;
};

type UpsertPlaidAccountsForItemResult = {
  createdCount: number;
  updatedCount: number;
  accounts: Array<{
    bankAccountId: Id<"bankAccounts">;
    ledgerAccountId: Id<"ledgerAccounts">;
    plaidAccountId: string;
    entityId: Id<"entities">;
  }>;
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
const upsertPlaidAccountsForItemInternalRef = makeFunctionReference<
  "mutation",
  UpsertPlaidAccountsForItemArgs,
  UpsertPlaidAccountsForItemResult
>("plaid:upsertPlaidAccountsForItemInternal");
// E2-T3: drain the WHOLE needs_review backlog (self-rescheduling) instead of a
// single min(25) pass, so a large Plaid import does not strand items in review.
const drainCategorizationBacklogRef = makeFunctionReference<
  "action",
  { entityId: Id<"entities">; actorUserId?: Id<"users">; pass?: number; maxPasses?: number },
  unknown
>("bedrockCategorizer:drainCategorizationBacklog");
const syncItemByPlaidItemIdRef = makeFunctionReference<
  "action",
  SyncItemByPlaidItemIdArgs,
  SyncItemByPlaidItemIdResult
>("plaid:syncItemByPlaidItemId");

const plaidPersonalFinanceCategoryValidator = v.object({
  primary: v.string(),
  detailed: v.string(),
  confidence_level: v.optional(v.union(v.string(), v.null())),
  version: v.optional(v.union(v.string(), v.null())),
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

const plaidSelectableAccountValidator = v.object({
  plaidAccountId: v.string(),
  name: v.string(),
  mask: v.string(),
  subtype: v.string(),
  balanceMinor: v.number(),
  currency: v.string(),
  include: v.boolean(),
  plaidItemId: v.optional(v.string()),
  // E3-T5: a single Plaid login can span multiple businesses (Zikra + Z360).
  // Each previewed account may carry its own owning entity; when absent the
  // account falls back to the caller's default entityId (back-compat).
  entityId: v.optional(v.id("entities")),
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
    ? requestedEnv === "sandbox" || requestedEnv === "development" || requestedEnv === "production"
      ? requestedEnv
      : "unsupported"
    : "missing";
  const problems = [];
  if (!hasClientId) problems.push("PLAID_CLIENT_ID is missing.");
  if (!hasSecret) problems.push("PLAID_SECRET is missing.");
  if (environment === "missing") problems.push("PLAID_ENV must be sandbox, development, or production.");
  if (environment === "unsupported") problems.push("PLAID_ENV must be sandbox, development, or production.");
  if (
    (environment === "development" || environment === "production") &&
    process.env.OPENBOOKS_REAL_TEST_LIVE_CONNECTORS !== "1"
  ) {
    problems.push("Plaid development/production is blocked until OPENBOOKS_REAL_TEST_LIVE_CONNECTORS=1 is set.");
  }
  if (
    (environment === "development" || environment === "production") &&
    !isSecretEncryptionConfigured()
  ) {
    problems.push(`${secretEncryptionEnvLabel()} is required before storing non-sandbox Plaid access tokens.`);
  }

  return {
    environment,
    hasClientId,
    hasSecret,
    ready: hasClientId && hasSecret && problems.length === 0,
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

// ---------------------------------------------------------------------------
// E2-T8: Plaid personal_finance_category (PFC) -> ledger account weak prior.
// ---------------------------------------------------------------------------
// plaidPriorAccountId was wired through the pipeline (auto-posts at the
// plaid_prior confidence band) but never POPULATED on the live first pass, so
// the first pass was a guaranteed Inbox miss that only the later LLM batch could
// rescue. We derive a best-effort weak prior from Plaid's PFC.primary so the
// first pass can post a confident expense/income immediately when the autonomy
// allows it, and otherwise records the prior on the needs_review row.
//
// The mapping is deterministic and direction-aware: an OUTFLOW maps PFC.primary
// to an EXPENSE account, an INFLOW maps it to an INCOME account. We never map an
// inflow to an expense prior (or vice-versa) — that would invert the books. PFC
// primaries that don't have a clean OpenBooks home (e.g. TRANSFER_IN/OUT,
// LOAN_PAYMENTS, RENT_AND_UTILITIES which spans rent + utilities) are left
// UNMAPPED so the item falls through cleanly to the LLM batch stage rather than
// being forced into a wrong account.
//
// PFC primary reference: https://plaid.com/docs/api/products/transactions/#categoriesget
const PLAID_PFC_EXPENSE_ACCOUNT: Record<string, string> = {
  // Software / SaaS / cloud-leaning spend.
  GENERAL_SERVICES: "5500", // Professional Services
  // Bank/processor fees.
  BANK_FEES: "6200", // Bank Fees
  // Marketing-leaning.
  // (Plaid has no dedicated marketing primary; advertising falls under
  //  GENERAL_SERVICES, already mapped above.)
  // Day-to-day operating spend.
  GENERAL_MERCHANDISE: "6000", // Office & Supplies
  HOME_IMPROVEMENT: "6000", // Office & Supplies
  PERSONAL_CARE: "6000", // Office & Supplies
  // Food.
  FOOD_AND_DRINK: "5800", // Meals
  // Travel.
  TRAVEL: "5900", // Travel
  TRANSPORTATION: "5900", // Travel
  // Utilities (rent/utilities share a PFC primary in Plaid; we bias to
  //  Utilities, which is the more common recurring small-business charge).
  RENT_AND_UTILITIES: "6100", // Utilities
  // Insurance / medical.
  MEDICAL: "5700", // Insurance
  // Entertainment / general.
  ENTERTAINMENT: "6999", // Other Expense
  GOVERNMENT_AND_NON_PROFIT: "6300", // Taxes & Licenses
};

const PLAID_PFC_INCOME_ACCOUNT: Record<string, string> = {
  // Wages / business income deposits map to the generic income line; the LLM
  //  batch refines to Sales/Services later, but a posted income beats an Inbox
  //  miss for the cash figure.
  INCOME: "4200", // Other Income
};

/**
 * Pure mapping from a Plaid PFC primary + direction to an OpenBooks account
 * NUMBER, or null when no clean mapping exists. Direction is the sign of the
 * pipeline amount (>= 0 is an inflow). Exported for unit testing.
 */
export function plaidPriorAccountNumber(
  primary: string | null | undefined,
  amountMinor: number,
): string | null {
  if (!primary) return null;
  const key = primary.toUpperCase();
  if (amountMinor >= 0) {
    return PLAID_PFC_INCOME_ACCOUNT[key] ?? null;
  }
  return PLAID_PFC_EXPENSE_ACCOUNT[key] ?? null;
}

/**
 * Resolve a PFC weak prior to an actual, live ledger account id on the entity.
 * Returns null when the PFC has no mapping or the mapped account number is
 * absent/archived on the entity — leaving plaidPriorAccountId unset so the item
 * falls through to the LLM batch stage instead of posting to a stale account.
 */
async function resolvePlaidPriorAccountId(
  ctx: MutationCtx,
  entityId: Id<"entities">,
  prior: PipelineMappedPlaidTransaction["plaidPrior"],
  amountMinor: number,
): Promise<Id<"ledgerAccounts"> | null> {
  if (!prior) return null;
  const number = plaidPriorAccountNumber(prior.primary, amountMinor);
  if (!number) return null;
  const account = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity_and_number", (q) => q.eq("entityId", entityId).eq("number", number))
    .unique();
  if (!account || account.archived) return null;
  // Defend the direction invariant even if the table is edited: an inflow must
  // never resolve to a non-income prior, an outflow never to a non-expense one.
  if (amountMinor >= 0 && account.type !== "income") return null;
  if (amountMinor < 0 && account.type !== "expense") return null;
  return account._id;
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

function plaidBaseUrl(environment = normalizePlaidEnvState(plaidEnvInput()).environment) {
  if (environment === "production") return "https://production.plaid.com";
  if (environment === "development") return "https://development.plaid.com";
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
  await requireWorkspacePermission(ctx, entity.workspaceId, "connections.manage");
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

/**
 * Floor an ISO date (YYYY-MM-DD) to the first day of its month. Used to date the
 * opening-balance entry at `M-01` so it always predates the oldest imported
 * transaction (decision Q2). Falls back to the connector's first-of-this-month
 * when the supplied date is unparseable.
 */
export function openingBalanceDate(isoDate?: string): string {
  const candidate = typeof isoDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate : null;
  if (candidate) {
    return `${candidate.slice(0, 7)}-01`;
  }
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

/**
 * Resolve the entity's Opening Balance Equity account (3900). It is seeded as an
 * isSystem account in the standard chart (ledger.ts:53), but entities created
 * before it existed may lack it, so create-if-missing.
 */
async function ensureOpeningBalanceEquityAccount(ctx: MutationCtx, entity: Doc<"entities">) {
  const existing = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity_and_number", (q) => q.eq("entityId", entity._id).eq("number", "3900"))
    .unique();
  const now = Date.now();
  if (existing) {
    if (existing.archived) {
      await ctx.db.patch(existing._id, { archived: false, updatedAt: now });
    }
    return existing;
  }
  const accountId = await ctx.db.insert("ledgerAccounts", {
    entityId: entity._id,
    name: "Opening Balance Equity",
    type: "equity",
    subtype: "opening_balance",
    number: "3900",
    currency: entity.currency,
    isSystem: true,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  return (await ctx.db.get(accountId))!;
}

/**
 * Post the opening journal entry for a freshly-connected bank account
 * (E1-T2 / RC3). Connecting a real bank previously stored only `balanceMinor`,
 * so ledger cash and Equity both started at $0. This books a single balanced
 * entry against the unused 3900 Opening Balance Equity account so the GL starts
 * at the bank's real position:
 *
 *   positive balance -> Dr Bank / Cr 3900
 *   negative balance (e.g. a credit card) -> Dr 3900 / Cr Bank
 *
 * Dated the first day of the month of the connector's earliest activity
 * (decision Q2), tagged `opening:<plaidAccountId>` for idempotency so a
 * re-connect / re-sync never double-posts. USD integer minor units only — no
 * fxRate, no currency conversion (decision Q20; the GL is USD-only). A zero
 * balance posts nothing. The opening entry is a posted ledger entry, which is
 * the system-of-record "cleared" state for the line.
 */
async function postOpeningBalanceForBankAccount(
  ctx: MutationCtx,
  args: {
    entity: Doc<"entities">;
    bankAccount: Doc<"bankAccounts">;
    ledgerAccountId: Id<"ledgerAccounts">;
    balanceMinor: number;
    plaidAccountId: string;
    actorUserId: Id<"users">;
    startDate?: string;
  },
): Promise<{ posted: boolean; entryId: Id<"journalEntries"> | null }> {
  if (!args.balanceMinor || args.balanceMinor === 0) {
    return { posted: false, entryId: null };
  }

  const sourceId = `opening:${args.plaidAccountId}`;
  // Idempotency: skip if an opening entry for this bank account already exists.
  const existing = await ctx.db
    .query("journalEntries")
    .withIndex("by_entity", (q) => q.eq("entityId", args.entity._id))
    .filter((q) => q.eq(q.field("sourceId"), sourceId))
    .first();
  if (existing) {
    return { posted: false, entryId: existing._id };
  }

  const equityAccount = await ensureOpeningBalanceEquityAccount(ctx, args.entity);
  const magnitude = Math.abs(args.balanceMinor);
  const isDebitBalance = args.balanceMinor > 0;

  const posted = await postLedgerEntryCore(ctx, {
    entity: args.entity,
    userId: args.actorUserId,
    date: openingBalanceDate(args.startDate),
    memo: `Opening balance for ${args.bankAccount.name}`,
    source: "manual",
    sourceId,
    auditAction: "system.connect.opening_balance.posted",
    lines: isDebitBalance
      ? [
          { accountId: args.ledgerAccountId, debitMinor: magnitude, creditMinor: 0 },
          { accountId: equityAccount._id, debitMinor: 0, creditMinor: magnitude },
        ]
      : [
          { accountId: equityAccount._id, debitMinor: magnitude, creditMinor: 0 },
          { accountId: args.ledgerAccountId, debitMinor: 0, creditMinor: magnitude },
        ],
  });
  return { posted: true, entryId: posted.entryId };
}

function plaidEnvFromCredential(credential: PlaidApiCredential) {
  return normalizePlaidEnvState({
    PLAID_CLIENT_ID: credential.clientId,
    PLAID_SECRET: credential.secret,
    PLAID_ENV: credential.environment,
  });
}

export async function callPlaid(path: string, body: Record<string, unknown>, credential?: PlaidApiCredential) {
  const env = credential ? plaidEnvFromCredential(credential) : normalizePlaidEnvState(plaidEnvInput());
  const credentials = credential
    ? { client_id: credential.clientId, secret: credential.secret }
    : plaidCredentials();
  const response = await fetch(`${plaidBaseUrl(env.environment)}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...credentials,
      ...body,
    }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const errorCode = typeof payload.error_code === "string" ? payload.error_code : "PLAID_REQUEST_FAILED";
    const errorMessage = typeof payload.error_message === "string" ? payload.error_message : "Plaid request failed.";
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
    payoutMatchCount: 0,
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
  total.payoutMatchCount += next.payoutMatchCount;
  total.removedCount += next.removedCount;
  total.removedReversalCount += next.removedReversalCount;
  total.nextCursor = next.nextCursor || total.nextCursor;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
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
  let payoutMatchCount = 0;
  // Resolve a posting actor for any reconcile-only payout match. The matcher
  // posts through the single ledger path, which needs a userId; the system sync
  // actor is the right author (this is an automated reconciliation, not a human
  // edit). Resolved lazily so the fixture path that has no actorUserId still
  // gets one without changing the income-pipeline author.
  let payoutMatchActorUserId: Id<"users"> | null = args.actorUserId ?? null;
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

    // E7.1: BEFORE the income pipeline runs, see if this inflow settles an open
    // Stripe payout. A match posts a reconcile-only transfer (Dr Bank / Cr
    // Payouts In-Transit) and skips categorization entirely, so the deposit is
    // never recognized as income (the Stripe side already booked the revenue).
    if (mapped.amountMinor > 0 && mapped.status === "posted") {
      if (!payoutMatchActorUserId) {
        payoutMatchActorUserId = await ensureSystemSyncActor(ctx, args.entity.workspaceId);
      }
      const matchResult = await matchPlaidInflowToPayout(ctx, {
        entity: args.entity,
        bankAccount: args.bankAccount,
        actorUserId: payoutMatchActorUserId,
        inflow: {
          date: mapped.date,
          amountMinor: mapped.amountMinor,
          currency: mapped.currency,
          merchant: mapped.merchant,
          rawDescription: mapped.rawDescription,
          status: mapped.status,
          externalId: mapped.externalId,
        },
        auditAction: "system.sync.stripe.payout.reconciled",
      });
      if (matchResult.matched) {
        payoutMatchCount += 1;
        postedCount += 1;
        continue;
      }
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
      plaidPriorAccountId?: Id<"ledgerAccounts">;
    };
    if (carryover?.categoryAccountId) {
      routeArgs.categoryAccountId = carryover.categoryAccountId as Id<"ledgerAccounts">;
    }
    // E2-T8: derive a weak prior from Plaid's PFC and set it on the FIRST pass so
    // the pipeline's plaid_prior stage can post (under autopilot) instead of
    // bouncing every live transaction to the Inbox. A carryover category already
    // posts at full confidence, so we only attach the weak prior when there is no
    // carryover to defer to.
    if (!routeArgs.categoryAccountId) {
      const priorAccountId = await resolvePlaidPriorAccountId(
        ctx,
        args.entity._id,
        mapped.plaidPrior,
        mapped.amountMinor,
      );
      if (priorAccountId) {
        routeArgs.plaidPriorAccountId = priorAccountId;
      }
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
    payoutMatchCount,
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
    const visiblePlaidItems = plaidItems.filter((item) => item.status !== "disconnected");
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .order("desc")
      .take(1000);
    const inboxItems = await ctx.db
      .query("inboxItems")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .take(100);
    const savedCredential = await ctx.db
      .query("connectionCredentials")
      .withIndex("by_workspace_and_provider", (q) => q.eq("workspaceId", entity.workspaceId).eq("provider", "plaid"))
      .take(50);
    const activeCredential = savedCredential
      .filter((credential) => credential.status === "active")
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const plaidItemIds = new Set(visiblePlaidItems.map((item) => item.plaidItemId));
    const plaidBankAccounts = bankAccounts.filter(
      (account) =>
        account.plaidItemId &&
        account.plaidItemId !== "openbooks-sandbox-fixture" &&
        plaidItemIds.has(account.plaidItemId),
    );

    return {
      entity: {
        id: entity._id,
        name: entity.name,
        currency: entity.currency,
      },
      env: activeCredential
        ? normalizePlaidEnvState({
            PLAID_CLIENT_ID: "saved",
            PLAID_SECRET: "saved",
            PLAID_ENV: activeCredential.mode,
          })
        : normalizePlaidEnvState(plaidEnvInput()),
      accounts: plaidBankAccounts.map((account) => ({
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
      items: visiblePlaidItems.map((item) => ({
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

async function upsertPlaidFinancialConnection(
  ctx: MutationCtx,
  args: {
    entity: Doc<"entities">;
    plaidItemId: string;
    institutionName?: string;
    environment: "sandbox" | "development" | "production";
  },
) {
  const now = Date.now();
  const displayName = args.institutionName?.trim() || "Connected bank";
  const existing = await ctx.db
    .query("financialConnections")
    .withIndex("by_external", (q) => q.eq("provider", "plaid").eq("externalId", args.plaidItemId))
    .first();
  const patch = {
    workspaceId: args.entity.workspaceId,
    entityId: args.entity._id,
    provider: "plaid" as const,
    mode: args.environment,
    displayName,
    externalId: args.plaidItemId,
    status: "active" as const,
    webhookStatus: "unknown" as const,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }
  return await ctx.db.insert("financialConnections", {
    ...patch,
    createdAt: now,
  });
}

export const persistPlaidItem = internalMutation({
  args: {
    entityId: v.id("entities"),
    plaidItemId: v.string(),
    accessToken: v.optional(v.string()),
    accessTokenCiphertext: v.optional(v.string()),
    institutionName: v.optional(v.string()),
    environment: v.optional(v.union(v.literal("sandbox"), v.literal("development"), v.literal("production"))),
  },
  handler: async (ctx, args) => {
    const entity = await requireEntity(ctx, args.entityId);
    if (!args.accessToken && !args.accessTokenCiphertext) {
      throw new Error("Plaid token persistence requires a token or ciphertext.");
    }
    const environment = args.environment ?? "sandbox";
    const existing = await ctx.db
      .query("plaidItems")
      .withIndex("by_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .first();
    const now = Date.now();
    const row = {
      entityId: args.entityId,
      plaidItemId: args.plaidItemId,
      ...(args.accessToken ? { accessToken: args.accessToken } : {}),
      ...(args.accessTokenCiphertext ? { accessTokenCiphertext: args.accessTokenCiphertext } : {}),
      ...(args.institutionName ? { institutionName: args.institutionName } : {}),
      environment,
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
      await upsertPlaidFinancialConnection(ctx, {
        entity,
        plaidItemId: args.plaidItemId,
        institutionName: args.institutionName,
        environment,
      });
      return { plaidItemRecordId: existing._id, status: "updated" as const };
    }
    const plaidItemRecordId = await ctx.db.insert("plaidItems", {
      ...row,
      createdAt: now,
    });
    await upsertPlaidFinancialConnection(ctx, {
      entity,
      plaidItemId: args.plaidItemId,
      institutionName: args.institutionName,
      environment,
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
        accessToken: item.accessToken ?? "",
        accessTokenCiphertext: item.accessTokenCiphertext ?? null,
        environment: item.environment,
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
      ...(args.institutionName?.trim() ? { institutionName: args.institutionName.trim() } : {}),
      updatedAt: now,
    });

    if (args.institutionName?.trim()) {
      const connection = await ctx.db
        .query("financialConnections")
        .withIndex("by_external", (q) => q.eq("provider", "plaid").eq("externalId", item.plaidItemId))
        .first();
      if (connection) {
        await ctx.db.patch(connection._id, {
          displayName: args.institutionName.trim(),
          updatedAt: now,
        });
      }
    }

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
      // E2-T3: kick off the self-rescheduling drainer (pass 0). It processes a
      // bounded batch per pass and re-enqueues itself until the queue is empty
      // or the maxPasses ceiling is hit — no item is left unattempted because of
      // the old single-pass cap.
      await ctx.scheduler.runAfter(0, drainCategorizationBacklogRef, {
        entityId: entity._id,
        actorUserId,
        pass: 0,
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

    const credential = await ctx.runAction(internal.connections.resolvePlaidCredentialForEntity, {
      entityId: claim.item.entityId,
    }) as PlaidApiCredential | null;
    const env = credential ? plaidEnvFromCredential(credential) : normalizePlaidEnvState(plaidEnvInput());
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
      const accessToken = claim.item.accessTokenCiphertext
        ? await decryptSecret(claim.item.accessTokenCiphertext, "Plaid access tokens")
        : claim.item.accessToken;
      if (!accessToken) {
        throw new Error("PLAID_ACCESS_TOKEN_MISSING");
      }
      let cursor = claim.item.lastSyncCursor ?? undefined;
      let hasMore = true;
      let pages = 0;
      const maxPages = 1000;
      const transactions: PlaidTransactionLike[] = [];
      const removedTransactionIds: string[] = [];

      while (hasMore) {
        if (pages >= maxPages) {
          throw new Error("PLAID_SYNC_PAGE_LIMIT_EXCEEDED");
        }
        const payload = await callPlaid("/transactions/sync", {
          access_token: accessToken,
          ...(cursor ? { cursor } : {}),
          count: 500,
        }, credential ?? undefined);
        const added = Array.isArray(payload.added)
          ? payload.added.map(normalizePlaidSyncTransaction).filter((transaction): transaction is PlaidTransactionLike => Boolean(transaction))
          : [];
        const modified = Array.isArray(payload.modified)
          ? payload.modified.map(normalizePlaidSyncTransaction).filter((transaction): transaction is PlaidTransactionLike => Boolean(transaction))
          : [];
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

      const finalCursor = cursor ?? "";
      const previousCursor = claim.item.lastSyncCursor ?? "";
      const transactionBatches = chunkArray(transactions, PLAID_SYNC_PERSIST_BATCH_SIZE);
      const removedBatches = chunkArray(removedTransactionIds, PLAID_SYNC_PERSIST_BATCH_SIZE);
      const batchCount = Math.max(transactionBatches.length, removedBatches.length, 1);
      const summary = emptyPlaidSyncSummary(finalCursor);
      let unmatchedAccountCount = 0;

      for (let index = 0; index < batchCount; index += 1) {
        const finalBatch = index === batchCount - 1;
        const result = await ctx.runMutation(syncItemTransactionsInternalRef, {
          plaidItemId: args.plaidItemId,
          transactions: transactionBatches[index] ?? [],
          removedTransactionIds: removedBatches[index] ?? [],
          nextCursor: finalBatch ? finalCursor : previousCursor,
          trigger: args.trigger,
          ...(args.webhookCode && finalBatch ? { webhookCode: args.webhookCode } : {}),
        });
        if (result.status !== "synced") {
          return result;
        }
        unmatchedAccountCount += result.unmatchedAccountCount;
        addSyncSummary(summary, result);
      }

      return {
        status: "synced" as const,
        itemId: args.plaidItemId,
        trigger: args.trigger,
        unmatchedAccountCount,
        ...summary,
        nextCursor: finalCursor,
      };
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
    const entity = await ctx.runQuery(validateEntityAccessRef, { entityId: args.entityId });
    const credential = await ctx.runAction(internal.connections.resolvePlaidCredentialForEntity, {
      entityId: args.entityId,
    }) as PlaidApiCredential | null;
    const env = credential ? plaidEnvFromCredential(credential) : normalizePlaidEnvState(plaidEnvInput());
    if (!env.ready) {
      return {
        mode: "fixture" as const,
        linkToken: "fixture-plaid-link-token",
        env,
      };
    }

    let payload: Record<string, unknown>;
    try {
      const convexSite = (process.env.CONVEX_SITE_URL || "").replace(/\/+$/, "");
      const webhookUrl =
        credential?.webhookUrl ?? process.env.PLAID_WEBHOOK_URL ?? (convexSite ? `${convexSite}/plaid/webhook` : undefined);
      const redirectUri = credential?.redirectUri ?? process.env.PLAID_OAUTH_REDIRECT_URI;
      payload = await callPlaid("/link/token/create", {
        client_name: args.clientName ?? "OpenBooks",
        country_codes: ["US"],
        language: "en",
        products: ["transactions"],
        user: {
          client_user_id: `openbooks:${args.entityId}`,
        },
        ...(webhookUrl ? { webhook: webhookUrl } : {}),
        ...(redirectUri ? { redirect_uri: redirectUri } : {}),
        transactions: {
          days_requested: 730,
        },
      }, credential ?? undefined);
    } catch (error) {
      if (credential) {
        throw new Error(error instanceof Error ? error.message : "PLAID_LINK_TOKEN_FAILED");
      }
      return {
        mode: "fixture" as const,
        linkToken: "fixture-plaid-link-token",
        env: plaidSandboxFallbackEnv(env, error),
      };
    }

    return {
      mode: env.environment,
      linkToken: String(payload.link_token),
      env,
    };
  },
});

// Toggle whether a single bank account is included in transaction sync. The
// account stays linked and its posted history is untouched; sync simply skips
// it while disabled.
export const setBankAccountSync = mutation({
  args: { bankAccountId: v.id("bankAccounts"), includeInSync: v.boolean() },
  handler: async (ctx, args): Promise<{ bankAccountId: Id<"bankAccounts">; includeInSync: boolean }> => {
    const account = await ctx.db.get(args.bankAccountId);
    if (!account) throw new Error("Bank account not found.");
    const entity = await ctx.db.get(account.entityId);
    if (!entity) throw new Error("OpenBooks entity not found.");
    await requireWorkspacePermission(ctx, entity.workspaceId, "connections.manage");
    await ctx.db.patch(account._id, { includeInSync: args.includeInSync, updatedAt: Date.now() });
    return { bankAccountId: account._id, includeInSync: args.includeInSync };
  },
});

export const getPlaidItemForDisconnect = internalQuery({
  args: { entityId: v.id("entities"), plaidItemId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ accessToken: string | null; accessTokenCiphertext: string | null } | null> => {
    const item = await ctx.db
      .query("plaidItems")
      .withIndex("by_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .unique();
    if (!item || item.entityId !== args.entityId) return null;
    return { accessToken: item.accessToken ?? null, accessTokenCiphertext: item.accessTokenCiphertext ?? null };
  },
});

// Ledger-safe disconnect: marks the Plaid item disconnected and turns sync off
// for its bank accounts. Posted journal entries and transactions are immutable
// and are never deleted — the books keep their history.
export const markPlaidItemDisconnected = internalMutation({
  args: { entityId: v.id("entities"), plaidItemId: v.string() },
  handler: async (ctx, args): Promise<{ accountsDisabled: number }> => {
    const now = Date.now();
    const item = await ctx.db
      .query("plaidItems")
      .withIndex("by_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .unique();
    if (item && item.entityId === args.entityId) {
      await ctx.db.patch(item._id, { status: "disconnected", syncLockUntil: undefined, updatedAt: now });
    }
    const accounts = await ctx.db
      .query("bankAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .take(200);
    let accountsDisabled = 0;
    for (const account of accounts) {
      if (account.plaidItemId === args.plaidItemId && account.includeInSync) {
        await ctx.db.patch(account._id, { includeInSync: false, updatedAt: now });
        accountsDisabled += 1;
      }
    }
    const connection = await ctx.db
      .query("financialConnections")
      .withIndex("by_external", (q) => q.eq("provider", "plaid").eq("externalId", args.plaidItemId))
      .first();
    if (connection) {
      await ctx.db.patch(connection._id, { status: "disconnected", updatedAt: now });
    }
    return { accountsDisabled };
  },
});

export const disconnectPlaidItem = action({
  args: { entityId: v.id("entities"), plaidItemId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "disconnected"; plaidItemId: string; accountsDisabled: number; revoked: boolean }> => {
    await ctx.runQuery(validateEntityAccessRef, { entityId: args.entityId });
    const item = await ctx.runQuery(internal.plaid.getPlaidItemForDisconnect, {
      entityId: args.entityId,
      plaidItemId: args.plaidItemId,
    });
    let revoked = false;
    if (item && (item.accessTokenCiphertext || item.accessToken)) {
      try {
        const credential = (await ctx.runAction(internal.connections.resolvePlaidCredentialForEntity, {
          entityId: args.entityId,
        })) as PlaidApiCredential | null;
        const accessToken = item.accessTokenCiphertext
          ? await decryptSecret(item.accessTokenCiphertext, "Plaid access tokens")
          : item.accessToken;
        if (accessToken) {
          await callPlaid("/item/remove", { access_token: accessToken }, credential ?? undefined);
          revoked = true;
        }
      } catch {
        // Best-effort token revocation at Plaid. The local disconnect below is
        // the source of truth and always runs.
      }
    }
    const result = await ctx.runMutation(internal.plaid.markPlaidItemDisconnected, {
      entityId: args.entityId,
      plaidItemId: args.plaidItemId,
    });
    return {
      status: "disconnected" as const,
      plaidItemId: args.plaidItemId,
      accountsDisabled: result.accountsDisabled,
      revoked,
    };
  },
});

// Lightweight credential check for the Plaid setup panel. Uses the workspace
// Plaid app (or env credentials) to call /institutions/get — validates the
// Client ID/secret without creating a Link token or linking a bank.
export const testWorkspacePlaidApp = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; environment?: string; message: string }> => {
    const authz: { workspaceId: Id<"workspaces">; anchorEntityId: Id<"entities"> | null } = await ctx.runQuery(
      internal.connections.authorizeWorkspaceForConnections,
      {},
    );
    const credential = authz.anchorEntityId
      ? ((await ctx.runAction(internal.connections.resolvePlaidCredentialForEntity, {
          entityId: authz.anchorEntityId,
        })) as PlaidApiCredential | null)
      : null;
    const env = credential ? plaidEnvFromCredential(credential) : normalizePlaidEnvState(plaidEnvInput());
    if (!env.ready) {
      return {
        ok: false,
        message: credential
          ? env.problems[0] ?? "Plaid app is not ready."
          : "No Plaid app saved yet. Add your Client ID and secret first.",
      };
    }
    try {
      await callPlaid("/institutions/get", { count: 1, offset: 0, country_codes: ["US"] }, credential ?? undefined);
      return { ok: true, environment: env.environment, message: "Plaid credentials are valid." };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Plaid test failed." };
    }
  },
});

export const createSandboxPublicToken = action({
  args: {
    entityId: v.id("entities"),
    institutionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.runQuery(validateEntityAccessRef, { entityId: args.entityId });
    const env = normalizePlaidEnvState(plaidEnvInput());
    if (!env.ready || env.environment !== "sandbox") {
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
    // E3-T5: when true, exchange + persist the Plaid Item but return the
    // previewed accounts WITHOUT creating bank accounts, so the caller can map
    // each account to a business and confirm via assignPlaidAccountsToBusinesses.
    // Defaults to false (auto-persist all accounts to entityId — back-compat).
    previewOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.runQuery(validateEntityAccessRef, { entityId: args.entityId });
    const credential = await ctx.runAction(internal.connections.resolvePlaidCredentialForEntity, {
      entityId: args.entityId,
    }) as PlaidApiCredential | null;
    const env = credential ? plaidEnvFromCredential(credential) : normalizePlaidEnvState(plaidEnvInput());
    if (!env.ready || args.publicToken.startsWith("fixture-")) {
      return {
        mode: "fixture" as const,
        accessTokenPersisted: false,
        accounts: fixturePlaidAccounts(entity.currency),
      };
    }
    if (
      env.environment !== "sandbox" &&
      env.environment !== "development" &&
      env.environment !== "production"
    ) {
      return {
        mode: "fixture" as const,
        accessTokenPersisted: false,
        persistenceBlocker: "Plaid environment is not ready; fixture mode is active.",
        accounts: fixturePlaidAccounts(entity.currency),
      };
    }
    const plaidEnvironment = env.environment;

    let exchanged: Record<string, unknown>;
    let accountsPayload: Record<string, unknown>;
    let plaidItemId: string;
    let institutionName: string | undefined;
    try {
      exchanged = await callPlaid("/item/public_token/exchange", {
        public_token: args.publicToken,
      }, credential ?? undefined);
      const accessToken = String(exchanged.access_token);
      plaidItemId = typeof exchanged.item_id === "string" ? exchanged.item_id : `sandbox-item:${args.entityId}`;
      accountsPayload = await callPlaid("/accounts/get", {
        access_token: accessToken,
      }, credential ?? undefined);
      institutionName = institutionNameFromPlaidPayload(accountsPayload);
      const accessTokenCiphertext = await encryptSecret(accessToken);
      if (!accessTokenCiphertext) {
        throw new Error(`${secretEncryptionEnvLabel()} is required before storing Plaid access tokens.`);
      }
      await ctx.runMutation(internal.plaid.persistPlaidItem, {
        entityId: args.entityId,
        plaidItemId,
        accessTokenCiphertext,
        ...(institutionName ? { institutionName } : {}),
        environment: plaidEnvironment,
      });
    } catch (error) {
      if (credential) {
        throw new Error(error instanceof Error ? error.message : "PLAID_PUBLIC_TOKEN_EXCHANGE_FAILED");
      }
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

    // E3-T5 preview-then-assign: persist the Item but defer bank-account
    // creation to assignPlaidAccountsToBusinesses so the owner can map each
    // account to a business first.
    if (args.previewOnly) {
      return {
        mode: plaidEnvironment,
        accessTokenPersisted: true,
        previewOnly: true as const,
        plaidItemId,
        accounts,
        accountsCreated: 0,
        accountsUpdated: 0,
        institutionName,
      };
    }

    const accountResult = await ctx.runMutation(upsertPlaidAccountsForItemInternalRef, {
      entityId: args.entityId,
      plaidItemId,
      accounts,
    });

    return {
      mode: plaidEnvironment,
      accessTokenPersisted: true,
      plaidItemId,
      accounts,
      accountsCreated: accountResult.createdCount,
      accountsUpdated: accountResult.updatedCount,
      institutionName,
    };
  },
});

export const refreshPlaidItemAccounts = action({
  args: {
    entityId: v.id("entities"),
    plaidItemId: v.string(),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.runQuery(validateEntityAccessRef, { entityId: args.entityId });
    const claim = await ctx.runMutation(claimPlaidItemSyncRef, {
      entityId: args.entityId,
      plaidItemId: args.plaidItemId,
      trigger: "manual",
    });
    if (claim.status !== "claimed" || !claim.item) {
      return {
        status: claim.status,
        reason: claim.reason ?? "Plaid item is not available for account refresh.",
        accountsCreated: 0,
        accountsUpdated: 0,
        accounts: [],
      };
    }

    let shouldRelink = false;
    let institutionName = claim.item.institutionName;
    try {
      const credential = await ctx.runAction(internal.connections.resolvePlaidCredentialForEntity, {
        entityId: claim.item.entityId,
      }) as PlaidApiCredential | null;
      const accessToken = await decryptPlaidAccessToken({
        accessToken: claim.item.accessToken,
        accessTokenCiphertext: claim.item.accessTokenCiphertext,
      });
      const accountsPayload = await callPlaid("/accounts/get", {
        access_token: accessToken,
      }, credential ?? undefined);
      institutionName = institutionNameFromPlaidPayload(accountsPayload) ?? institutionName;
      const accounts = Array.isArray(accountsPayload.accounts)
        ? accountsPayload.accounts.map((account) => normalizePlaidAccount(account, entity.currency, args.plaidItemId))
        : [];
      const result = await ctx.runMutation(upsertPlaidAccountsForItemInternalRef, {
        entityId: args.entityId,
        plaidItemId: args.plaidItemId,
        accounts,
      });
      await ctx.runMutation(releasePlaidItemSyncRef, {
        plaidItemId: args.plaidItemId,
        status: "active",
        institutionName,
      });
      return {
        status: "refreshed" as const,
        accountsCreated: result.createdCount,
        accountsUpdated: result.updatedCount,
        accounts: result.accounts,
        institutionName,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "PLAID_ACCOUNT_REFRESH_FAILED";
      shouldRelink = /ITEM_LOGIN_REQUIRED|INVALID_ACCESS_TOKEN|NO_ACCOUNTS/i.test(message);
      await ctx.runMutation(releasePlaidItemSyncRef, {
        plaidItemId: args.plaidItemId,
        status: shouldRelink ? "relink_required" : "active",
        institutionName,
        itemLoginRequired: shouldRelink,
      });
      throw new Error(message);
    }
  },
});

async function upsertPlaidAccountsForItemCore(
  ctx: MutationCtx,
  args: UpsertPlaidAccountsForItemArgs,
): Promise<UpsertPlaidAccountsForItemResult> {
  // The caller's default entity. Every account routes here unless it carries its
  // own `entityId` assignment (E3-T5: a single Plaid login can span LLCs).
  const defaultEntity = await requireEntity(ctx, args.entityId);
  const now = Date.now();
  const accounts = [];
  let createdCount = 0;
  let updatedCount = 0;

  // Resolve + authorize each assignment target once, validating every entity is
  // in the SAME workspace as the default entity and that the caller can manage
  // its connections. This caches both the entity doc and its existing bank
  // accounts so we keep per-entity dedupe.
  const entityCache = new Map<Id<"entities">, Doc<"entities">>([[defaultEntity._id, defaultEntity]]);
  const existingByEntity = new Map<Id<"entities">, Doc<"bankAccounts">[]>();
  async function resolveTargetEntity(entityId: Id<"entities">): Promise<Doc<"entities">> {
    const cached = entityCache.get(entityId);
    if (cached) return cached;
    const target = await requireEntity(ctx, entityId);
    if (target.workspaceId !== defaultEntity.workspaceId) {
      throw new Error("Plaid accounts can only be assigned to businesses in the same workspace.");
    }
    entityCache.set(entityId, target);
    return target;
  }
  async function existingForEntity(entityId: Id<"entities">): Promise<Doc<"bankAccounts">[]> {
    const cached = existingByEntity.get(entityId);
    if (cached) return cached;
    const rows = await ctx.db
      .query("bankAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", entityId))
      .take(500);
    existingByEntity.set(entityId, rows);
    return rows;
  }

  for (const account of args.accounts.filter((candidate) => candidate.include)) {
    const targetEntity = account.entityId
      ? await resolveTargetEntity(account.entityId)
      : defaultEntity;
    const kind = accountKind(account.subtype);
    const plaidItemId = account.plaidItemId || args.plaidItemId || "openbooks-sandbox-fixture";
    const existingBankAccounts = await existingForEntity(targetEntity._id);
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
        plaidItemId,
        includeInSync: true,
        balanceMinor: account.balanceMinor,
        updatedAt: now,
      });
      accounts.push({
        bankAccountId: existing._id,
        ledgerAccountId: existing.ledgerAccountId,
        plaidAccountId: account.plaidAccountId,
        entityId: targetEntity._id,
      });
      // Re-connect / re-sync of a known account: post the opening balance only
      // if it was never posted before (idempotent by sourceId).
      await postOpeningBalanceForBankAccount(ctx, {
        entity: targetEntity,
        bankAccount: existing,
        ledgerAccountId: existing.ledgerAccountId,
        balanceMinor: account.balanceMinor,
        plaidAccountId: account.plaidAccountId,
        actorUserId: await ensureSystemSyncActor(ctx, targetEntity.workspaceId),
        startDate: args.startDate,
      });
      updatedCount += 1;
      continue;
    }
    const ledgerAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId: targetEntity._id,
      name: account.name,
      type: accountType(kind),
      subtype: accountSubtype(kind),
      number: await nextLedgerAccountNumber(ctx, targetEntity._id, kind),
      currency: account.currency || targetEntity.currency,
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const bankAccountId = await ctx.db.insert("bankAccounts", {
      entityId: targetEntity._id,
      ledgerAccountId,
      name: account.name,
      mask: account.mask,
      kind,
      balanceMinor: account.balanceMinor,
      includeInSync: true,
      plaidAccountId: account.plaidAccountId,
      plaidItemId,
      createdAt: now,
      updatedAt: now,
    });
    // Newly tracked accounts cache so a second account assigned to the same
    // entity in this same call dedupes correctly.
    existingByEntity.get(targetEntity._id)?.push((await ctx.db.get(bankAccountId))!);
    // E1-T2: book the opening balance (Dr Bank / Cr 3900) so the GL starts at
    // the bank's real position instead of $0.
    await postOpeningBalanceForBankAccount(ctx, {
      entity: targetEntity,
      bankAccount: (await ctx.db.get(bankAccountId))!,
      ledgerAccountId,
      balanceMinor: account.balanceMinor,
      plaidAccountId: account.plaidAccountId,
      actorUserId: await ensureSystemSyncActor(ctx, targetEntity.workspaceId),
      startDate: args.startDate,
    });
    accounts.push({
      bankAccountId,
      ledgerAccountId,
      plaidAccountId: account.plaidAccountId,
      entityId: targetEntity._id,
    });
    createdCount += 1;
  }

  return { createdCount, updatedCount, accounts };
}

export const upsertPlaidAccountsForItemInternal = internalMutation({
  args: {
    entityId: v.id("entities"),
    plaidItemId: v.optional(v.string()),
    accounts: v.array(plaidSelectableAccountValidator),
    startDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await upsertPlaidAccountsForItemCore(ctx, args);
  },
});

export const upsertPlaidAccountsForItem = mutation({
  args: {
    entityId: v.id("entities"),
    plaidItemId: v.optional(v.string()),
    accounts: v.array(plaidSelectableAccountValidator),
    startDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await upsertPlaidAccountsForItemCore(ctx, args);
  },
});

/**
 * E3-T5: assign each previewed Plaid account to a business, splitting one Plaid
 * login across multiple LLCs. Every assignment is validated server-side: the
 * default `entityId` and each per-account `entityId` must belong to the same
 * authorized workspace (enforced inside upsertPlaidAccountsForItemCore). Every
 * previewed account must be explicitly assigned (or excluded via `include:false`)
 * — none are silently dropped.
 */
export const assignPlaidAccountsToBusinesses = mutation({
  args: {
    entityId: v.id("entities"),
    plaidItemId: v.optional(v.string()),
    accounts: v.array(plaidSelectableAccountValidator),
    startDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await upsertPlaidAccountsForItemCore(ctx, args);
  },
});

export const selectSandboxFixtureAccounts = mutation({
  args: {
    entityId: v.id("entities"),
    accounts: v.array(plaidSelectableAccountValidator),
    startDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await upsertPlaidAccountsForItemCore(ctx, args);
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

async function decryptPlaidAccessToken(args: {
  accessToken: string;
  accessTokenCiphertext: string | null;
}) {
  const accessToken = args.accessTokenCiphertext
    ? await decryptSecret(args.accessTokenCiphertext, "Plaid access tokens")
    : args.accessToken;
  if (!accessToken) {
    throw new Error("PLAID_ACCESS_TOKEN_MISSING");
  }
  return accessToken;
}

function institutionNameFromPlaidPayload(payload: Record<string, unknown>) {
  const item = payload.item && typeof payload.item === "object" ? payload.item as Record<string, unknown> : {};
  const institutionName = typeof item.institution_name === "string" ? item.institution_name.trim() : "";
  return institutionName || undefined;
}

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

function normalizeOptionalString(value: unknown) {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function normalizePlaidPersonalFinanceCategory(value: unknown): PlaidPersonalFinanceCategory | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  if (typeof record.primary !== "string" || typeof record.detailed !== "string") {
    return undefined;
  }

  const confidenceLevel = normalizeOptionalString(record.confidence_level);
  const version = normalizeOptionalString(record.version);
  return {
    primary: record.primary,
    detailed: record.detailed,
    ...(confidenceLevel !== undefined ? { confidence_level: confidenceLevel } : {}),
    ...(version !== undefined ? { version } : {}),
  };
}

function normalizePlaidSyncTransaction(value: unknown): PlaidTransactionLike | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  if (
    typeof record.transaction_id !== "string" ||
    typeof record.account_id !== "string" ||
    typeof record.date !== "string" ||
    typeof record.amount !== "number" ||
    !Number.isFinite(record.amount) ||
    typeof record.name !== "string"
  ) {
    return null;
  }

  const merchantName = normalizeOptionalString(record.merchant_name);
  const isoCurrencyCode = normalizeOptionalString(record.iso_currency_code);
  const unofficialCurrencyCode = normalizeOptionalString(record.unofficial_currency_code);
  const personalFinanceCategory = normalizePlaidPersonalFinanceCategory(record.personal_finance_category);

  return {
    transaction_id: record.transaction_id,
    account_id: record.account_id,
    date: record.date,
    amount: record.amount,
    name: record.name,
    pending: typeof record.pending === "boolean" ? record.pending : false,
    ...(merchantName !== undefined ? { merchant_name: merchantName } : {}),
    ...(isoCurrencyCode !== undefined ? { iso_currency_code: isoCurrencyCode } : {}),
    ...(unofficialCurrencyCode !== undefined ? { unofficial_currency_code: unofficialCurrencyCode } : {}),
    ...(personalFinanceCategory !== undefined ? { personal_finance_category: personalFinanceCategory } : {}),
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
