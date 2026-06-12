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
    status: "active" | "relink_required";
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
  mode: "sandbox" | "fixture";
  accessTokenPersisted: boolean;
  persistenceBlocker?: string;
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

type SelectAccountsResult = {
  createdCount: number;
  accounts: Array<{ bankAccountId: string; ledgerAccountId: string; plaidAccountId: string }>;
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
      environment: "unsupported",
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
        accessToken: "sandbox-access-token-from-exchange",
        status: "active",
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
