/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  buildItemLoginRequiredInboxPayload,
  buildPlaidSandboxPublicTokenRequest,
  findPendingCarryover,
  mapPlaidTransactionToPipeline,
  normalizePlaidEnvState,
  normalizeTransactionsSync,
  openBooksSandboxUser,
  plaidPriorAccountNumber,
} from "./plaid";

const modules = import.meta.glob("./**/*.ts");

const plaidEnvState = makeFunctionReference<"query", Record<string, never>, PlaidEnvState>(
  "plaid:envState",
);
const listConnectionState = makeFunctionReference<"query", { entityId: string }, PlaidConnectionState>(
  "plaid:listConnectionState",
);
const stageFixtureTransactions = makeFunctionReference<"mutation", StageFixtureArgs, StageFixtureResult>(
  "plaid:stageFixtureTransactions",
);
const syncFixtureTransactions = makeFunctionReference<"mutation", SyncFixtureArgs, SyncFixtureResult>(
  "plaid:syncFixtureTransactions",
);
const handleItemLoginRequired = makeFunctionReference<"mutation", LoginRequiredArgs, LoginRequiredResult>(
  "plaid:handleItemLoginRequired",
);
const persistPlaidItem = makeFunctionReference<"mutation", PersistPlaidItemArgs, PersistPlaidItemResult>(
  "plaid:persistPlaidItem",
);
const selectSandboxFixtureAccounts = makeFunctionReference<"mutation", SelectAccountsArgs, SelectAccountsResult>(
  "plaid:selectSandboxFixtureAccounts",
);
const upsertPlaidAccountsForItem = makeFunctionReference<"mutation", SelectAccountsArgs, SelectAccountsResult>(
  "plaid:upsertPlaidAccountsForItem",
);
const assignPlaidAccountsToBusinesses = makeFunctionReference<"mutation", SelectAccountsArgs, SelectAccountsResult>(
  "plaid:assignPlaidAccountsToBusinesses",
);
const exchangePublicTokenAndPreviewAccounts = makeFunctionReference<
  "action",
  ExchangePublicTokenArgs,
  ExchangePublicTokenResult
>("plaid:exchangePublicTokenAndPreviewAccounts");
const syncItemByPlaidItemId = makeFunctionReference<"action", SyncItemActionArgs, SyncItemActionResult>(
  "plaid:syncItemByPlaidItemId",
);
const routeTransaction = makeFunctionReference<"mutation", RouteTransactionArgs, unknown>(
  "pipeline:routeTransaction",
);

type PlaidEnvState = {
  environment: "sandbox" | "missing" | "unsupported";
  hasClientId: boolean;
  hasSecret: boolean;
  ready: boolean;
  problems: string[];
};

type PlaidConnectionState = {
  accounts: Array<{
    name: string;
    plaidItemId?: string | null;
  }>;
  items: Array<{
    plaidItemId: string;
    status: "active" | "relink_required" | "disconnected";
  }>;
  recentTransactions: Array<{
    merchant: string;
    plaidPriorCaptured: boolean;
  }>;
};

type StageFixtureArgs = {
  entityId: string;
  bankAccountId: string;
  transactions: Array<{
    transaction_id: string;
    account_id: string;
    date: string;
    amount: number;
    name: string;
    merchant_name?: string | null;
    pending: boolean;
    iso_currency_code?: string | null;
    personal_finance_category?: {
      primary: string;
      detailed: string;
      confidence_level?: string | null;
      version?: string | null;
    } | null;
  }>;
};

type StageFixtureResult = {
  stagedCount: number;
  postedCount: number;
  needsReviewCount: number;
  duplicateCount: number;
  plaidPriorCount: number;
  removedCount: number;
  removedReversalCount: number;
  nextCursor: string;
};

type SyncFixtureArgs = StageFixtureArgs & {
  removedTransactionIds?: string[];
  nextCursor?: string;
};

type SyncFixtureResult = StageFixtureResult;

type LoginRequiredArgs = {
  entityId: string;
  institutionName: string;
  itemId: string;
};

type LoginRequiredResult = {
  inboxItemId: string;
  payloadSummary: string;
};

type PersistPlaidItemArgs = {
  entityId: string;
  plaidItemId: string;
  accessToken: string;
  institutionName?: string;
};

type PersistPlaidItemResult = {
  plaidItemRecordId: string;
  status: "created" | "updated";
};

type ExchangePublicTokenArgs = {
  entityId: Id<"entities">;
  publicToken: string;
};

type ExchangePublicTokenResult = {
  mode: "sandbox" | "development" | "production" | "fixture";
  accessTokenPersisted: boolean;
  persistenceBlocker?: string;
  accountsCreated?: number;
  accountsUpdated?: number;
  institutionName?: string;
  accounts: Array<{
    plaidAccountId: string;
    plaidItemId?: string;
    name: string;
    mask: string;
    subtype: string;
    balanceMinor: number;
    currency: string;
    include: boolean;
  }>;
};

type SelectAccountsArgs = {
  entityId: string;
  plaidItemId?: string;
  startDate?: string;
  accounts: Array<{
    plaidAccountId: string;
    plaidItemId?: string;
    name: string;
    mask: string;
    subtype: string;
    balanceMinor: number;
    currency: string;
    include: boolean;
    entityId?: Id<"entities">;
  }>;
};

type SelectAccountsResult = {
  createdCount: number;
  updatedCount?: number;
  accounts: Array<{ bankAccountId: string; ledgerAccountId: string; plaidAccountId: string; entityId: Id<"entities"> }>;
};

type SyncItemActionArgs = {
  plaidItemId: string;
  trigger: "cron" | "webhook" | "manual";
  entityId?: Id<"entities">;
  webhookCode?: string;
};

type SyncItemActionResult = {
  status: string;
  itemId: string;
  trigger: "cron" | "webhook" | "manual";
  stagedCount?: number;
  postedCount?: number;
  needsReviewCount?: number;
  duplicateCount?: number;
  unmatchedAccountCount?: number;
  reason?: string;
};

type RouteTransactionArgs = {
  entityId: string;
  bankAccountId: string;
  date: string;
  amountMinor: number;
  currency: string;
  merchant: string;
  rawDescription: string;
  status: "pending" | "posted";
  source: "bank" | "stripe" | "manual";
  externalId: string;
  actorUserId?: string;
};

async function setupPlaidTest(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      email: "owner@example.com",
      name: "Owner",
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar workspace",
      slug: "ansar-workspace",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const entityId = await ctx.db.insert("entities", {
      workspaceId,
      name: "Live Sandbox",
      slug: "live-sandbox",
      businessType: "services",
      currency: "USD",
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    });
    const operatingAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Sandbox Checking",
      type: "asset",
      subtype: "bank",
      number: "1010",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const softwareAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Software & SaaS",
      type: "expense",
      subtype: "software",
      number: "5200",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const bankAccountId = await ctx.db.insert("bankAccounts", {
      entityId,
      ledgerAccountId: operatingAccountId,
      name: "Plaid Checking",
      mask: "0000",
      kind: "checking",
      balanceMinor: 0,
      includeInSync: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("rules", {
      entityId,
      order: 1,
      name: "Software subscriptions",
      descriptionContains: "subscription",
      direction: "outflow",
      categoryAccountId: softwareAccountId,
      autoPost: true,
      hitCount: 0,
      active: true,
      createdBy: "seed",
      createdAt: now,
      updatedAt: now,
    });
    return { userId, workspaceId, entityId, bankAccountId };
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|owner",
    issuer: "test",
    email: "owner@example.com",
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Plaid sandbox helpers", () => {
  it("reports sandbox env-key readiness without exposing values", () => {
    expect(
      normalizePlaidEnvState({
        PLAID_CLIENT_ID: "client-id",
        PLAID_SECRET: "sandbox-secret",
        PLAID_ENV: "sandbox",
      }),
    ).toEqual({
      environment: "sandbox",
      hasClientId: true,
      hasSecret: true,
      ready: true,
      problems: [],
    });

    expect(
      normalizePlaidEnvState({
        PLAID_CLIENT_ID: "client-id",
        PLAID_SECRET: "development-secret",
        PLAID_ENV: "development",
      }),
    ).toMatchObject({
      environment: "development",
      hasClientId: true,
      hasSecret: true,
      ready: false,
    });
  });

  it("builds a sandbox public-token request with the OpenBooks custom user", () => {
    const request = buildPlaidSandboxPublicTokenRequest({
      institutionId: "ins_109508",
      user: openBooksSandboxUser,
    });

    expect(request).toMatchObject({
      institution_id: "ins_109508",
      initial_products: ["transactions"],
      options: {
        transactions: {
          days_requested: 730,
        },
        override_username: openBooksSandboxUser.username,
      },
    });
    expect(JSON.stringify(request)).not.toContain("secret");
  });

  it("normalizes sync cursors and removed ids", () => {
    const normalized = normalizeTransactionsSync({
      added: [{ transaction_id: "txn_new" }],
      modified: [{ transaction_id: "txn_modified" }],
      removed: [{ transaction_id: "txn_old" }],
      next_cursor: "cursor-2",
      has_more: true,
    });

    expect(normalized).toEqual({
      addedIds: ["txn_new"],
      modifiedIds: ["txn_modified"],
      removedIds: ["txn_old"],
      nextCursor: "cursor-2",
      hasMore: true,
      addedCount: 1,
      modifiedCount: 1,
      removedCount: 1,
    });
  });

  it("carries prior review metadata from pending to posted Plaid replacements", () => {
    const carryover = findPendingCarryover(
      {
        transaction_id: "posted-1",
        account_id: "acct-1",
        date: "2026-06-11",
        amount: 12.34,
        name: "OPENAI",
        merchant_name: "OpenAI",
        pending: false,
      },
      [
        {
          transactionId: "pending-1",
          plaidTransactionId: "pending-plaid",
          accountId: "acct-1",
          date: "2026-06-10",
          amountMinor: -1234,
          merchant: "OpenAI",
          categoryAccountId: "expense-software",
          receiptDocumentId: "receipt-1",
        },
      ],
    );

    expect(carryover).toMatchObject({
      transactionId: "pending-1",
      categoryAccountId: "expense-software",
      receiptDocumentId: "receipt-1",
    });
  });

  it("maps Plaid amount signs and personal finance categories into pipeline metadata", () => {
    const mapped = mapPlaidTransactionToPipeline({
      transaction_id: "txn-1",
      account_id: "acct-1",
      date: "2026-06-11",
      amount: 21.1,
      name: "Notion subscription",
      merchant_name: "Notion",
      pending: false,
      iso_currency_code: "USD",
      personal_finance_category: {
        primary: "GENERAL_SERVICES",
        detailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
        confidence_level: "HIGH",
        version: "v2",
      },
    });

    expect(mapped).toMatchObject({
      amountMinor: -2110,
      currency: "USD",
      merchant: "Notion",
      status: "posted",
      plaidPrior: {
        primary: "GENERAL_SERVICES",
        detailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
        confidenceLevel: "HIGH",
      },
    });
    expect(mapped.rawDescription).toContain("Plaid prior: GENERAL_SERVICES");
  });

  it("shapes ITEM_LOGIN_REQUIRED as a connection inbox card", () => {
    expect(
      buildItemLoginRequiredInboxPayload({
        institutionName: "Chase",
        itemId: "item-123",
      }),
    ).toEqual({
      kind: "connection",
      payloadSummary: "Chase needs you to sign in again. Relink item item-123 in update mode.",
    });
  });
});

describe("Plaid Convex primitives", () => {
  it("returns env key state without key material", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPlaidTest(t);
    const session = authed(t, ids.userId);
    const state = await session.query(plaidEnvState, {});

    expect(state).toHaveProperty("hasClientId");
    expect(state).toHaveProperty("hasSecret");
    expect(JSON.stringify(state)).not.toContain(process.env.PLAID_SECRET ?? "not-a-real-secret-value");
  });

  it("stages fixture transactions through the existing pipeline", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPlaidTest(t);
    const session = authed(t, ids.userId);

    const result = await session.mutation(stageFixtureTransactions, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      transactions: [
        {
          transaction_id: "plaid-fixture-1",
          account_id: "acct-1",
          date: "2026-06-10",
          amount: 49.99,
          name: "Notion subscription",
          merchant_name: "Notion",
          pending: false,
          iso_currency_code: "USD",
          personal_finance_category: {
            primary: "GENERAL_SERVICES",
            detailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
            confidence_level: "HIGH",
          },
        },
        {
          transaction_id: "plaid-fixture-2",
          account_id: "acct-1",
          date: "2026-06-11",
          amount: -1250,
          name: "Client ACH",
          merchant_name: "Client ACH",
          pending: false,
          iso_currency_code: "USD",
          personal_finance_category: {
            primary: "INCOME",
            detailed: "INCOME_WAGES",
            confidence_level: "MEDIUM",
          },
        },
      ],
    });

    expect(result).toMatchObject({
      stagedCount: 2,
      postedCount: 1,
      needsReviewCount: 1,
      plaidPriorCount: 2,
    });
  });

  it("keeps older Plaid imports visible when newer non-Plaid rows exist", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPlaidTest(t);
    const session = authed(t, ids.userId);

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("transactions", {
        entityId: ids.entityId,
        bankAccountId: ids.bankAccountId,
        date: "2026-06-10",
        amountMinor: -4999,
        currency: "USD",
        merchant: "Notion",
        rawDescription: "Notion subscription | Plaid prior: GENERAL_SERVICES/GENERAL_SERVICES_OTHER_GENERAL_SERVICES (HIGH)",
        status: "posted",
        review: "needs_review",
        source: "bank",
        externalId: "plaid:older-visible-fixture",
        evalSet: false,
        createdAt: now,
        updatedAt: now,
      });
      for (let index = 0; index < 120; index += 1) {
        await ctx.db.insert("transactions", {
          entityId: ids.entityId,
          bankAccountId: ids.bankAccountId,
          date: "2026-06-11",
          amountMinor: -100 - index,
          currency: "USD",
          merchant: `Stripe import ${index}`,
          rawDescription: `Stripe import ${index}`,
          status: "posted",
          review: "auto",
          source: "stripe",
          externalId: `stripe:noise:${index}`,
          evalSet: false,
          createdAt: now + index + 1,
          updatedAt: now + index + 1,
        });
      }
    });

    const state = await session.query(listConnectionState, { entityId: ids.entityId });
    expect(state.recentTransactions.some((transaction) => transaction.merchant === "Notion")).toBe(true);
    expect(state.recentTransactions.some((transaction) => transaction.plaidPriorCaptured)).toBe(true);
  });

  it("persists sandbox Plaid item tokens without exposing token material", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPlaidTest(t);
    const session = authed(t, ids.userId);
    const accessToken = "sandbox-access-token-test";

    const persisted = await session.mutation(persistPlaidItem, {
      entityId: ids.entityId,
      plaidItemId: "item-sandbox-1",
      accessToken,
      institutionName: "Plaid Sandbox Bank",
    });
    const updated = await session.mutation(persistPlaidItem, {
      entityId: ids.entityId,
      plaidItemId: "item-sandbox-1",
      accessToken: "sandbox-access-token-rotated",
      institutionName: "Plaid Sandbox Bank",
    });
    await session.mutation(selectSandboxFixtureAccounts, {
      entityId: ids.entityId,
      accounts: [
        {
          plaidAccountId: "sandbox-checking-1",
          plaidItemId: "item-sandbox-1",
          name: "Plaid Sandbox Checking",
          mask: "0000",
          subtype: "checking",
          balanceMinor: 425000,
          currency: "USD",
          include: true,
        },
      ],
    });

    expect(persisted).toMatchObject({ status: "created" });
    expect(updated).toMatchObject({ plaidItemRecordId: persisted.plaidItemRecordId, status: "updated" });
    expect(JSON.stringify(persisted)).not.toContain(accessToken);
    expect(JSON.stringify(updated)).not.toContain("sandbox-access-token-rotated");
    const state = await session.query(listConnectionState, { entityId: ids.entityId });
    expect(state.accounts.some((account) => account.plaidItemId === "item-sandbox-1")).toBe(true);
    expect(JSON.stringify(state)).not.toContain(accessToken);
    await t.run(async (ctx) => {
      const items = await ctx.db
        .query("plaidItems")
        .withIndex("by_item", (q) => q.eq("plaidItemId", "item-sandbox-1"))
        .collect();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        entityId: ids.entityId,
        accessToken: "sandbox-access-token-rotated",
        environment: "sandbox",
        status: "active",
      });
    });
  });

  it("exchanges a Plaid public token server-side and returns only account previews", async () => {
    vi.stubEnv("PLAID_CLIENT_ID", "client-id-test");
    vi.stubEnv("PLAID_SECRET", "sandbox-secret-test");
    vi.stubEnv("PLAID_ENV", "sandbox");
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", "unit-test-secret-encryption-key");
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(body.client_id).toBe("client-id-test");
      expect(body.secret).toBe("sandbox-secret-test");
      if (path.endsWith("/item/public_token/exchange")) {
        expect(body.public_token).toBe("public-sandbox-test");
        return new Response(JSON.stringify({
          access_token: "sandbox-access-token-from-exchange",
          item_id: "item-sandbox-action",
        }), { status: 200 });
      }
      if (path.endsWith("/accounts/get")) {
        expect(body.access_token).toBe("sandbox-access-token-from-exchange");
        return new Response(JSON.stringify({
          accounts: [
            {
              account_id: "sandbox-action-checking",
              name: "Plaid Action Checking",
              mask: "9999",
              subtype: "checking",
              balances: {
                current: 1234.56,
                iso_currency_code: "USD",
              },
            },
          ],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error_code: "UNEXPECTED_PATH" }), { status: 400 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const t = convexTest(schema, modules);
    const ids = await setupPlaidTest(t);
    const session = authed(t, ids.userId);

    const result = await session.action(exchangePublicTokenAndPreviewAccounts, {
      entityId: ids.entityId,
      publicToken: "public-sandbox-test",
    });

    expect(result).toMatchObject({
      mode: "sandbox",
      accessTokenPersisted: true,
      accountsCreated: 1,
      accountsUpdated: 0,
      accounts: [
        {
          plaidAccountId: "sandbox-action-checking",
          plaidItemId: "item-sandbox-action",
          balanceMinor: 123456,
          include: true,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("sandbox-access-token-from-exchange");
    await t.run(async (ctx) => {
      const item = await ctx.db
        .query("plaidItems")
        .withIndex("by_item", (q) => q.eq("plaidItemId", "item-sandbox-action"))
        .unique();
      expect(item).toMatchObject({
        entityId: ids.entityId,
        status: "active",
      });
      expect(item?.accessToken).toBeUndefined();
      expect(item?.accessTokenCiphertext).toEqual(expect.any(String));
      expect(item?.accessTokenCiphertext).not.toContain("sandbox-access-token-from-exchange");
      const account = await ctx.db
        .query("bankAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .filter((q) => q.eq(q.field("plaidAccountId"), "sandbox-action-checking"))
        .first();
      expect(account).toMatchObject({
        entityId: ids.entityId,
        plaidItemId: "item-sandbox-action",
        includeInSync: true,
        balanceMinor: 123456,
      });
    });
  });

  it("handles Plaid cursor sync removals by excluding and reversing posted entries", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPlaidTest(t);
    const session = authed(t, ids.userId);

    const initial = await session.mutation(syncFixtureTransactions, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      transactions: [
        {
          transaction_id: "plaid-remove-me",
          account_id: "acct-1",
          date: "2026-06-10",
          amount: 49.99,
          name: "Notion subscription",
          merchant_name: "Notion",
          pending: false,
          iso_currency_code: "USD",
          personal_finance_category: {
            primary: "GENERAL_SERVICES",
            detailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
            confidence_level: "HIGH",
          },
        },
      ],
      nextCursor: "cursor-1",
    });

    expect(initial).toMatchObject({
      postedCount: 1,
      nextCursor: "cursor-1",
    });

    const removal = await session.mutation(syncFixtureTransactions, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      transactions: [],
      removedTransactionIds: ["plaid-remove-me"],
      nextCursor: "cursor-2",
    });

    expect(removal).toMatchObject({
      stagedCount: 0,
      removedCount: 1,
      removedReversalCount: 1,
      nextCursor: "cursor-2",
    });
  });

  it("runs scheduled item sync through the pipeline with a system actor audit trail", async () => {
    vi.stubEnv("PLAID_CLIENT_ID", "client-id-test");
    vi.stubEnv("PLAID_SECRET", "sandbox-secret-test");
    vi.stubEnv("PLAID_ENV", "sandbox");
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(path).toContain("/transactions/sync");
      expect(body.access_token).toBe("sandbox-access-token-system");
      return new Response(JSON.stringify({
        added: [
          {
            transaction_id: "plaid-system-sync-1",
            account_id: "acct-system",
            date: "2026-06-12",
            amount: 49.99,
            name: "Notion subscription",
            merchant_name: "Notion",
            pending: false,
            iso_currency_code: "USD",
            personal_finance_category: {
              primary: "GENERAL_SERVICES",
              detailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
              confidence_level: "HIGH",
            },
          },
        ],
        modified: [],
        removed: [],
        next_cursor: "cursor-system-1",
        has_more: false,
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const t = convexTest(schema, modules);
    const ids = await setupPlaidTest(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(ids.bankAccountId, {
        plaidAccountId: "acct-system",
        plaidItemId: "item-system-sync",
      });
      await ctx.db.insert("plaidItems", {
        entityId: ids.entityId,
        plaidItemId: "item-system-sync",
        accessToken: "sandbox-access-token-system",
        institutionName: "Plaid Sandbox Bank",
        environment: "sandbox",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await t.action(syncItemByPlaidItemId, {
      plaidItemId: "item-system-sync",
      trigger: "cron",
    });

    expect(result).toMatchObject({
      status: "synced",
      stagedCount: 1,
      postedCount: 1,
      needsReviewCount: 0,
      unmatchedAccountCount: 0,
    });
    await t.run(async (ctx) => {
      const item = await ctx.db
        .query("plaidItems")
        .withIndex("by_item", (q) => q.eq("plaidItemId", "item-system-sync"))
        .unique();
      expect(item).toMatchObject({
        lastSyncCursor: "cursor-system-1",
        lastSyncTrigger: "cron",
      });

      const systemActor = await ctx.db
        .query("systemActors")
        .withIndex("by_workspace_and_kind", (q) => q.eq("workspaceId", ids.workspaceId).eq("kind", "sync"))
        .unique();
      expect(systemActor?.label).toBe("system:sync");

      const transaction = await ctx.db
        .query("transactions")
        .withIndex("by_external_id", (q) => q.eq("externalId", "plaid:plaid-system-sync-1"))
        .unique();
      expect(transaction).toMatchObject({
        review: "auto",
        decidedBy: "rule",
      });

      const entry = transaction?.entryId ? await ctx.db.get(transaction.entryId) : null;
      expect(entry?.postedByUserId).toBe(systemActor?.userId);

      const audit = await ctx.db
        .query("auditEvents")
        .withIndex("by_actor", (q) => q.eq("actorUserId", systemActor!.userId))
        .first();
      expect(audit?.action).toBe("system.sync.ledger_entry.posted");
    });
  });

  it("schedules AI categorization after Plaid sync creates review rows", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PLAID_CLIENT_ID", "client-id-test");
    vi.stubEnv("PLAID_SECRET", "sandbox-secret-test");
    vi.stubEnv("PLAID_ENV", "sandbox");
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "");
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AI_MODEL", "");
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(path).toContain("/transactions/sync");
      expect(body.access_token).toBe("sandbox-access-token-ai-batch");
      return new Response(JSON.stringify({
        added: [
          {
            transaction_id: "plaid-ai-batch-1",
            account_id: "acct-ai-batch",
            date: "2026-06-12",
            amount: 42.42,
            name: "Mystery Vendor",
            merchant_name: "Mystery Vendor",
            pending: false,
            iso_currency_code: "USD",
            personal_finance_category: null,
          },
        ],
        modified: [],
        removed: [],
        next_cursor: "cursor-ai-batch-1",
        has_more: false,
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const t = convexTest(schema, modules);
    const ids = await setupPlaidTest(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(ids.bankAccountId, {
        plaidAccountId: "acct-ai-batch",
        plaidItemId: "item-ai-batch",
      });
      await ctx.db.insert("plaidItems", {
        entityId: ids.entityId,
        plaidItemId: "item-ai-batch",
        accessToken: "sandbox-access-token-ai-batch",
        institutionName: "Plaid Sandbox Bank",
        environment: "sandbox",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await t.action(syncItemByPlaidItemId, {
      plaidItemId: "item-ai-batch",
      trigger: "cron",
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect(result).toMatchObject({
      status: "synced",
      stagedCount: 1,
      postedCount: 0,
      needsReviewCount: 1,
      unmatchedAccountCount: 0,
    });
    await t.run(async (ctx) => {
      const transaction = await ctx.db
        .query("transactions")
        .withIndex("by_external_id", (q) => q.eq("externalId", "plaid:plaid-ai-batch-1"))
        .unique();
      expect(transaction).toMatchObject({
        review: "needs_review",
        decidedBy: "needs_review",
      });

      const systemActor = await ctx.db
        .query("systemActors")
        .withIndex("by_workspace_and_kind", (q) => q.eq("workspaceId", ids.workspaceId).eq("kind", "sync"))
        .unique();
      // E2-T3: the sync now kicks the self-rescheduling drainer, which writes a
      // batch run PER pass (it stops once a pass makes no progress on a degraded
      // provider). Assert the first run is the system-actor degraded run.
      const runs = await ctx.db
        .query("aiBatchRuns")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .order("asc")
        .collect();
      expect(runs.length).toBeGreaterThanOrEqual(1);
      expect(runs[0]).toMatchObject({
        requestedByUserId: systemActor?.userId,
        status: "degraded",
        attemptedCount: 1,
        skippedCount: 1,
        degradedCount: 1,
      });
    });
  });

  it("rejects attempts to pass a system actor through the public transaction route", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPlaidTest(t);
    const session = authed(t, ids.userId);

    await expect(
      session.mutation(routeTransaction, {
        entityId: ids.entityId,
        bankAccountId: ids.bankAccountId,
        date: "2026-06-12",
        amountMinor: -4999,
        currency: "USD",
        merchant: "Notion",
        rawDescription: "Notion subscription",
        status: "posted",
        source: "bank",
        externalId: "public-spoof-attempt",
        actorUserId: ids.userId,
      }),
    ).rejects.toThrow(/actorUserId|Object contains extra field/i);
  });

  it("creates a relink-needed inbox card for ITEM_LOGIN_REQUIRED", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPlaidTest(t);
    const session = authed(t, ids.userId);

    const result = await session.mutation(handleItemLoginRequired, {
      entityId: ids.entityId,
      institutionName: "Chase",
      itemId: "item-123",
    });

    expect(result.payloadSummary).toContain("Relink item item-123");
  });
});

/** Read the opening-balance journal entry + its lines for a bank account, if any. */
async function readOpeningEntry(t: TestConvex<typeof schema>, entityId: Id<"entities">, plaidAccountId: string) {
  return await t.run(async (ctx) => {
    const entries = await ctx.db
      .query("journalEntries")
      .withIndex("by_entity", (q) => q.eq("entityId", entityId))
      .collect();
    const opening = entries.filter((e) => e.sourceId === `opening:${plaidAccountId}`);
    if (opening.length === 0) return { entry: null, lines: [] as Array<{ accountId: Id<"ledgerAccounts">; debitMinor: number; creditMinor: number }>, count: 0 };
    const lines = await ctx.db
      .query("journalLines")
      .withIndex("by_entry", (q) => q.eq("entryId", opening[0]._id))
      .collect();
    return {
      entry: opening[0],
      lines: lines.map((l) => ({ accountId: l.accountId, debitMinor: l.debitMinor, creditMinor: l.creditMinor })),
      count: opening.length,
    };
  });
}

async function accountByNumber(t: TestConvex<typeof schema>, entityId: Id<"entities">, number: string) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query("ledgerAccounts")
      .withIndex("by_entity_and_number", (q) => q.eq("entityId", entityId).eq("number", number))
      .unique();
  });
}

describe("E1-T2 opening balance on bank connect", () => {
  it("posts exactly one Dr Bank / Cr 3900 opening entry dated M-01 and is idempotent", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPlaidTest(t);
    const session = authed(t, ids.userId);

    const args = {
      entityId: ids.entityId as unknown as string,
      plaidItemId: "plaid-item-open",
      startDate: "2026-03-17",
      accounts: [
        {
          plaidAccountId: "open-checking",
          plaidItemId: "plaid-item-open",
          name: "Opening Checking",
          mask: "9001",
          subtype: "checking",
          balanceMinor: 500000,
          currency: "USD",
          include: true,
        },
      ],
    };

    await session.mutation(upsertPlaidAccountsForItem, args);

    const opening = await readOpeningEntry(t, ids.entityId, "open-checking");
    expect(opening.count).toBe(1);
    expect(opening.entry?.date).toBe("2026-03-01"); // floored to first-of-month
    expect(opening.entry?.source).toBe("manual");

    const equity = await accountByNumber(t, ids.entityId, "3900");
    expect(equity).not.toBeNull();
    const bankLine = opening.lines.find((l) => l.debitMinor === 500000);
    const equityLine = opening.lines.find((l) => l.accountId === equity!._id);
    expect(bankLine?.debitMinor).toBe(500000);
    expect(equityLine?.creditMinor).toBe(500000);

    // Balance: debits == credits.
    const totalDebit = opening.lines.reduce((s, l) => s + l.debitMinor, 0);
    const totalCredit = opening.lines.reduce((s, l) => s + l.creditMinor, 0);
    expect(totalDebit).toBe(totalCredit);

    // Re-connect / re-sync posts no additional opening entry.
    await session.mutation(upsertPlaidAccountsForItem, args);
    const after = await readOpeningEntry(t, ids.entityId, "open-checking");
    expect(after.count).toBe(1);
  });

  it("posts the reversed direction for a negative starting balance and still balances", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPlaidTest(t);
    const session = authed(t, ids.userId);

    await session.mutation(upsertPlaidAccountsForItem, {
      entityId: ids.entityId as unknown as string,
      plaidItemId: "plaid-item-cc",
      startDate: "2026-04-02",
      accounts: [
        {
          plaidAccountId: "open-credit",
          plaidItemId: "plaid-item-cc",
          name: "Opening Credit Card",
          mask: "9002",
          subtype: "credit card",
          balanceMinor: -8790,
          currency: "USD",
          include: true,
        },
      ],
    });

    const opening = await readOpeningEntry(t, ids.entityId, "open-credit");
    expect(opening.count).toBe(1);
    const equity = await accountByNumber(t, ids.entityId, "3900");
    // Negative balance: Dr 3900 / Cr Bank.
    const equityLine = opening.lines.find((l) => l.accountId === equity!._id);
    expect(equityLine?.debitMinor).toBe(8790);
    const totalDebit = opening.lines.reduce((s, l) => s + l.debitMinor, 0);
    const totalCredit = opening.lines.reduce((s, l) => s + l.creditMinor, 0);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(8790);
  });

  it("posts nothing for a zero starting balance", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPlaidTest(t);
    const session = authed(t, ids.userId);

    await session.mutation(upsertPlaidAccountsForItem, {
      entityId: ids.entityId as unknown as string,
      plaidItemId: "plaid-item-zero",
      accounts: [
        {
          plaidAccountId: "open-zero",
          plaidItemId: "plaid-item-zero",
          name: "Opening Zero",
          mask: "9003",
          subtype: "checking",
          balanceMinor: 0,
          currency: "USD",
          include: true,
        },
      ],
    });

    const opening = await readOpeningEntry(t, ids.entityId, "open-zero");
    expect(opening.count).toBe(0);
  });
});

/** Create a second entity in the same workspace + a foreign workspace/entity for authz tests. */
async function setupSecondEntity(t: TestConvex<typeof schema>, workspaceId: Id<"workspaces">) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("entities", {
      workspaceId,
      name: "Z360 LLC",
      slug: "z360-llc",
      businessType: "services",
      currency: "USD",
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function setupForeignWorkspaceEntity(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Other workspace",
      slug: "other-workspace",
      createdAt: now,
      updatedAt: now,
    });
    const entityId = await ctx.db.insert("entities", {
      workspaceId,
      name: "Foreign LLC",
      slug: "foreign-llc",
      businessType: "services",
      currency: "USD",
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    });
    return { workspaceId, entityId };
  });
}

describe("E3-T5 Plaid account -> business split", () => {
  it("routes each previewed account to its assigned business under distinct entities", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPlaidTest(t);
    const session = authed(t, ids.userId);
    const secondEntityId = await setupSecondEntity(t, ids.workspaceId);

    const result = await session.mutation(assignPlaidAccountsToBusinesses, {
      entityId: ids.entityId as unknown as string,
      plaidItemId: "split-item",
      accounts: [
        {
          plaidAccountId: "zikra-checking",
          plaidItemId: "split-item",
          name: "Zikra Checking",
          mask: "1001",
          subtype: "checking",
          balanceMinor: 100000,
          currency: "USD",
          include: true,
          entityId: ids.entityId,
        },
        {
          plaidAccountId: "z360-checking",
          plaidItemId: "split-item",
          name: "Z360 Checking",
          mask: "1002",
          subtype: "checking",
          balanceMinor: 200000,
          currency: "USD",
          include: true,
          entityId: secondEntityId,
        },
      ],
    });

    expect(result.createdCount).toBe(2);
    const byPlaidId = new Map(result.accounts.map((a) => [a.plaidAccountId, a.entityId]));
    expect(byPlaidId.get("zikra-checking")).toBe(ids.entityId);
    expect(byPlaidId.get("z360-checking")).toBe(secondEntityId);

    // Two bankAccounts under two distinct entities, each with its own ledger acct.
    const banks = await t.run(async (ctx) => {
      const a = await ctx.db.query("bankAccounts").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect();
      const b = await ctx.db.query("bankAccounts").withIndex("by_entity", (q) => q.eq("entityId", secondEntityId)).collect();
      return { a: a.filter((x) => x.plaidItemId === "split-item"), b: b.filter((x) => x.plaidItemId === "split-item") };
    });
    expect(banks.a).toHaveLength(1);
    expect(banks.b).toHaveLength(1);
    expect(banks.a[0].ledgerAccountId).not.toBe(banks.b[0].ledgerAccountId);
  });

  it("reproduces single-business behavior when no per-account entity is set (back-compat)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPlaidTest(t);
    const session = authed(t, ids.userId);

    const result = await session.mutation(upsertPlaidAccountsForItem, {
      entityId: ids.entityId as unknown as string,
      plaidItemId: "compat-item",
      accounts: [
        {
          plaidAccountId: "compat-1",
          plaidItemId: "compat-item",
          name: "Compat Checking",
          mask: "2001",
          subtype: "checking",
          balanceMinor: 50000,
          currency: "USD",
          include: true,
        },
        {
          plaidAccountId: "compat-2",
          plaidItemId: "compat-item",
          name: "Compat Savings",
          mask: "2002",
          subtype: "savings",
          balanceMinor: 75000,
          currency: "USD",
          include: true,
        },
      ],
    });

    expect(result.createdCount).toBe(2);
    expect(result.accounts.every((a) => a.entityId === ids.entityId)).toBe(true);
  });

  it("does not silently drop excluded accounts", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPlaidTest(t);
    const session = authed(t, ids.userId);

    const result = await session.mutation(assignPlaidAccountsToBusinesses, {
      entityId: ids.entityId as unknown as string,
      plaidItemId: "exclude-item",
      accounts: [
        {
          plaidAccountId: "keep-1",
          plaidItemId: "exclude-item",
          name: "Keep Checking",
          mask: "3001",
          subtype: "checking",
          balanceMinor: 1000,
          currency: "USD",
          include: true,
          entityId: ids.entityId,
        },
        {
          plaidAccountId: "drop-1",
          plaidItemId: "exclude-item",
          name: "Excluded Savings",
          mask: "3002",
          subtype: "savings",
          balanceMinor: 2000,
          currency: "USD",
          include: false,
          entityId: ids.entityId,
        },
      ],
    });

    expect(result.createdCount).toBe(1);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].plaidAccountId).toBe("keep-1");
  });

  it("rejects assigning an account to an entity in a different workspace", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPlaidTest(t);
    const session = authed(t, ids.userId);
    const foreign = await setupForeignWorkspaceEntity(t);

    await expect(
      session.mutation(assignPlaidAccountsToBusinesses, {
        entityId: ids.entityId as unknown as string,
        plaidItemId: "cross-item",
        accounts: [
          {
            plaidAccountId: "cross-1",
            plaidItemId: "cross-item",
            name: "Cross Checking",
            mask: "4001",
            subtype: "checking",
            balanceMinor: 1000,
            currency: "USD",
            include: true,
            entityId: foreign.entityId,
          },
        ],
      }),
    ).rejects.toThrow(/same workspace|do not have access/i);
  });
});

// ---------------------------------------------------------------------------
// E2-T8: populate the live-Plaid first pass with a PFC-derived weak prior.
// ---------------------------------------------------------------------------
// Seeds the chart rows the PFC mapping targets (5500 expense, 4200 income) so a
// mapped transaction resolves to a live account on the FIRST pass, and exercises
// the autonomy gate: autopilot posts the prior (decidedBy plaid_prior),
// balanced records the prior but routes to the Inbox, and an unmapped PFC leaves
// the prior unset and reaches the LLM batch stage.
async function setupPlaidPriorTest(
  t: TestConvex<typeof schema>,
  autonomy?: "suggest" | "balanced" | "autopilot",
) {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "prior@example.com", name: "Prior" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Prior workspace",
      slug: "prior-workspace",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const entityId = await ctx.db.insert("entities", {
      workspaceId,
      name: "Prior Sandbox",
      slug: "prior-sandbox",
      businessType: "services",
      currency: "USD",
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    });
    const operatingAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Checking",
      type: "asset",
      subtype: "bank",
      number: "1010",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    // The two PFC mapping targets used below.
    await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Professional Services",
      type: "expense",
      subtype: "professional_services",
      number: "5500",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Other Income",
      type: "income",
      subtype: "other_income",
      number: "4200",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const bankAccountId = await ctx.db.insert("bankAccounts", {
      entityId,
      ledgerAccountId: operatingAccountId,
      name: "Plaid Checking",
      mask: "1111",
      kind: "checking",
      balanceMinor: 0,
      includeInSync: true,
      createdAt: now,
      updatedAt: now,
    });
    if (autonomy) {
      await ctx.db.insert("aiConfigs", {
        workspaceId,
        provider: "bedrock",
        autonomy,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { userId, workspaceId, entityId, bankAccountId };
  });
  return ids;
}

describe("E2-T8 Plaid PFC weak prior", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maps a PFC primary to an account number only in the matching direction", () => {
    // Outflow → expense, never income.
    expect(plaidPriorAccountNumber("GENERAL_SERVICES", -4999)).toBe("5500");
    expect(plaidPriorAccountNumber("FOOD_AND_DRINK", -1200)).toBe("5800");
    expect(plaidPriorAccountNumber("INCOME", -4999)).toBeNull();
    // Inflow → income, never expense.
    expect(plaidPriorAccountNumber("INCOME", 250000)).toBe("4200");
    expect(plaidPriorAccountNumber("GENERAL_SERVICES", 250000)).toBeNull();
    // Unknown / ambiguous primaries stay unmapped.
    expect(plaidPriorAccountNumber("TRANSFER_OUT", -4999)).toBeNull();
    expect(plaidPriorAccountNumber(null, -4999)).toBeNull();
    expect(plaidPriorAccountNumber(undefined, 100)).toBeNull();
  });

  it("posts a mapped prior on the first pass under autopilot with decidedBy plaid_prior", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPlaidPriorTest(t, "autopilot");
    const session = authed(t, ids.userId);

    const result = await session.mutation(stageFixtureTransactions, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      transactions: [
        {
          transaction_id: "prior-autopilot-1",
          account_id: "acct-prior",
          date: "2026-06-12",
          amount: 42.5, // small outflow, under the auto-post ramp floor
          name: "Consultant retainer",
          merchant_name: "Acme Consulting",
          pending: false,
          iso_currency_code: "USD",
          personal_finance_category: {
            primary: "GENERAL_SERVICES",
            detailed: "GENERAL_SERVICES_CONSULTING",
            confidence_level: "HIGH",
          },
        },
      ],
    });

    expect(result.postedCount).toBe(1);
    expect(result.needsReviewCount).toBe(0);

    const transaction = await t.run(async (ctx) => {
      return await ctx.db
        .query("transactions")
        .withIndex("by_external_id", (q) => q.eq("externalId", "plaid:prior-autopilot-1"))
        .unique();
    });
    expect(transaction?.decidedBy).toBe("plaid_prior");
    expect(transaction?.entryId).toBeTruthy();
    // Posted to the mapped expense account (5500 Professional Services).
    const account = await t.run(async (ctx) =>
      transaction?.categoryAccountId ? await ctx.db.get(transaction.categoryAccountId) : null,
    );
    expect(account?.number).toBe("5500");
  });

  it("records the prior but routes to the Inbox under balanced", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPlaidPriorTest(t, "balanced");
    const session = authed(t, ids.userId);

    const result = await session.mutation(stageFixtureTransactions, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      transactions: [
        {
          transaction_id: "prior-balanced-1",
          account_id: "acct-prior",
          date: "2026-06-12",
          amount: 42.5,
          name: "Consultant retainer",
          merchant_name: "Acme Consulting",
          pending: false,
          iso_currency_code: "USD",
          personal_finance_category: {
            primary: "GENERAL_SERVICES",
            detailed: "GENERAL_SERVICES_CONSULTING",
            confidence_level: "HIGH",
          },
        },
      ],
    });

    expect(result.postedCount).toBe(0);
    expect(result.needsReviewCount).toBe(1);

    const transaction = await t.run(async (ctx) => {
      return await ctx.db
        .query("transactions")
        .withIndex("by_external_id", (q) => q.eq("externalId", "plaid:prior-balanced-1"))
        .unique();
    });
    // Prior is recorded (decidedBy + category) but nothing posted.
    expect(transaction?.decidedBy).toBe("plaid_prior");
    expect(transaction?.entryId ?? null).toBeNull();
    const account = await t.run(async (ctx) =>
      transaction?.categoryAccountId ? await ctx.db.get(transaction.categoryAccountId) : null,
    );
    expect(account?.number).toBe("5500");
    // An open Inbox item exists for the unposted prior.
    const inboxOpen = await t.run(async (ctx) => {
      const items = await ctx.db
        .query("inboxItems")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      return items.some((item) => item.transactionId === transaction?._id && item.status === "open");
    });
    expect(inboxOpen).toBe(true);
  });

  it("leaves the prior unset for an unmappable PFC and routes to review", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPlaidPriorTest(t, "autopilot");
    const session = authed(t, ids.userId);

    const result = await session.mutation(stageFixtureTransactions, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      transactions: [
        {
          transaction_id: "prior-unmapped-1",
          account_id: "acct-prior",
          date: "2026-06-12",
          amount: 99.0,
          name: "Internal transfer",
          merchant_name: "Transfer",
          pending: false,
          iso_currency_code: "USD",
          personal_finance_category: {
            primary: "TRANSFER_OUT",
            detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
            confidence_level: "HIGH",
          },
        },
      ],
    });

    // No mappable prior and no AI key → degraded route to the Inbox, prior unset.
    expect(result.postedCount).toBe(0);
    expect(result.needsReviewCount).toBe(1);

    const transaction = await t.run(async (ctx) => {
      return await ctx.db
        .query("transactions")
        .withIndex("by_external_id", (q) => q.eq("externalId", "plaid:prior-unmapped-1"))
        .unique();
    });
    expect(transaction?.decidedBy).toBe("needs_review");
    expect(transaction?.entryId ?? null).toBeNull();
  });

  it("does not set a prior when the mapped account is absent on the entity", async () => {
    const t = convexTest(schema, modules);
    // Reuse the minimal setup that lacks 5500/4200 (only 1010 + 5200 + a rule).
    const ids = await setupPlaidTest(t);
    const session = authed(t, ids.userId);

    const result = await session.mutation(stageFixtureTransactions, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      transactions: [
        {
          transaction_id: "prior-absent-1",
          account_id: "acct-1",
          date: "2026-06-12",
          amount: 42.5,
          name: "Consultant retainer", // no "subscription" → the rule won't fire
          merchant_name: "Acme Consulting",
          pending: false,
          iso_currency_code: "USD",
          personal_finance_category: {
            primary: "GENERAL_SERVICES",
            detailed: "GENERAL_SERVICES_CONSULTING",
            confidence_level: "HIGH",
          },
        },
      ],
    });

    // 5500 is absent → prior unset → falls through to the Inbox (no AI key).
    expect(result.needsReviewCount).toBe(1);
    const transaction = await t.run(async (ctx) => {
      return await ctx.db
        .query("transactions")
        .withIndex("by_external_id", (q) => q.eq("externalId", "plaid:prior-absent-1"))
        .unique();
    });
    expect(transaction?.decidedBy).toBe("needs_review");
  });
});
