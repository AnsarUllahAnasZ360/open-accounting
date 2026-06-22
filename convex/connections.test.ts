/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const saveWorkspacePlaidApp = makeFunctionReference<
  "action",
  {
    label?: string;
    clientId: string;
    secret: string;
    environment: "sandbox" | "development" | "production";
    redirectUri?: string;
    webhookUrl?: string;
  },
  {
    connectionId: Id<"financialConnections">;
    credentialId: Id<"connectionCredentials">;
    fingerprint: string;
    keyPreview: string | null;
  }
>("connections:saveWorkspacePlaidApp");

const listConnections = makeFunctionReference<
  "query",
  Record<string, never>,
  {
    connections: Array<{
      id: Id<"financialConnections">;
      provider: "plaid" | "stripe";
      isCredentialConnection: boolean;
      credential: {
        fingerprint: string;
        keyPreview: string | null;
        status: "active" | "invalid" | "disconnected";
      } | null;
    }>;
    plaidApp:
      | { configured: false }
      | {
          configured: true;
          environment: string;
          keyPreview: string | null;
          label: string;
          lastValidatedAt: number | null;
          status: "active" | "invalid" | "disconnected";
        };
  }
>("connections:list");

const webhookConfig = makeFunctionReference<
  "query",
  Record<string, never>,
  {
    stripeWebhookUrl: string;
    plaidWebhookUrl: string;
    plaidRedirectUri: string;
    stripeRedirectUri: string;
    siteUrl: string;
  }
>("connections:webhookConfig");

const setBankAccountSync = makeFunctionReference<
  "mutation",
  { bankAccountId: Id<"bankAccounts">; includeInSync: boolean },
  { bankAccountId: Id<"bankAccounts">; includeInSync: boolean }
>("plaid:setBankAccountSync");

async function setupConnectionsTest(t: TestConvex<typeof schema>) {
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
      name: "Z360 BIZ LLC",
      slug: "z360-biz",
      businessType: "services",
      currency: "USD",
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, workspaceId, entityId };
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
});

describe("Connections credential vault", () => {
  it("saves one workspace Plaid app without returning or storing raw secrets", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", "unit-test-secret-encryption-key");
    const t = convexTest(schema, modules);
    const ids = await setupConnectionsTest(t);
    const session = authed(t, ids.userId);

    const result = await session.action(saveWorkspacePlaidApp, {
      label: "Plaid unit test",
      clientId: "plaid-client-id",
      secret: "plaid-secret-value",
      environment: "sandbox",
      webhookUrl: "https://example.convex.site/plaid/webhook",
    });

    expect(result.fingerprint).toHaveLength(24);
    expect(result.keyPreview).toBe("client...t-id");
    expect(JSON.stringify(result)).not.toContain("plaid-secret-value");

    const list = await session.query(listConnections, {});
    const row = list.connections.find((connection) => connection.id === result.connectionId);
    expect(row).toMatchObject({
      provider: "plaid",
      isCredentialConnection: true,
      credential: {
        fingerprint: result.fingerprint,
        keyPreview: "client...t-id",
        status: "active",
      },
    });
    expect(list.plaidApp).toMatchObject({
      configured: true,
      environment: "sandbox",
      keyPreview: "client...t-id",
      status: "active",
    });
    expect(JSON.stringify(list)).not.toContain("plaid-secret-value");

    await t.run(async (ctx) => {
      const credential = await ctx.db.get(result.credentialId);
      expect(credential?.encryptedPayload).toEqual(expect.any(String));
      expect(credential?.encryptedPayload).not.toContain("plaid-secret-value");
      expect(credential?.fingerprint).toBe(result.fingerprint);
    });
  });

  it("collapses duplicate per-business Plaid credentials to one workspace app", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", "unit-test-secret-encryption-key");
    const t = convexTest(schema, modules);
    const ids = await setupConnectionsTest(t);
    const session = authed(t, ids.userId);

    // Simulate the legacy state: the same Plaid app saved once per business.
    await t.run(async (ctx) => {
      const now = Date.now();
      const secondEntity = await ctx.db.insert("entities", {
        workspaceId: ids.workspaceId,
        name: "Second business",
        slug: "second-business",
        businessType: "services",
        currency: "USD",
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      });
      for (const [index, entityId] of [ids.entityId, secondEntity].entries()) {
        const connectionId = await ctx.db.insert("financialConnections", {
          workspaceId: ids.workspaceId,
          entityId,
          provider: "plaid",
          mode: "sandbox",
          displayName: "Plaid app",
          externalId: `credential:plaid:${entityId}`,
          status: "active",
          webhookStatus: "not_configured",
          createdAt: now + index,
          updatedAt: now + index,
        });
        await ctx.db.insert("connectionCredentials", {
          workspaceId: ids.workspaceId,
          entityId,
          connectionId,
          provider: "plaid",
          mode: "sandbox",
          label: "Plaid app",
          encryptedPayload: "ciphertext",
          fingerprint: "fingerprint",
          keyPreview: "client...t-id",
          status: "active",
          createdAt: now + index,
          updatedAt: now + index,
        });
      }
    });

    const migration = await t.mutation(
      makeFunctionReference<"mutation", Record<string, never>, { workspacesProcessed: number; credentialsDisconnected: number }>(
        "connections:collapseWorkspacePlaidCredentials",
      ),
      {},
    );
    expect(migration.credentialsDisconnected).toBe(1);

    const list = await session.query(listConnections, {});
    const activePlaid = list.connections.filter(
      (connection) => connection.provider === "plaid" && connection.credential?.status === "active",
    );
    expect(activePlaid).toHaveLength(1);
    expect(list.plaidApp.configured).toBe(true);
  });

  it("exposes the real webhook + redirect URLs from CONVEX_SITE_URL", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://example-deployment.convex.site");
    vi.stubEnv("SITE_URL", "https://app.example.com");
    const t = convexTest(schema, modules);
    const ids = await setupConnectionsTest(t);
    const session = authed(t, ids.userId);

    const config = await session.query(webhookConfig, {});
    expect(config.stripeWebhookUrl).toBe("https://example-deployment.convex.site/stripe/webhook");
    expect(config.plaidWebhookUrl).toBe("https://example-deployment.convex.site/plaid/webhook");
    expect(config.plaidRedirectUri).toBe("https://app.example.com/settings/connections/plaid/callback");
  });

  it("toggles a bank account's includeInSync flag without deleting it", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupConnectionsTest(t);
    const session = authed(t, ids.userId);

    const bankAccountId = await t.run(async (ctx) => {
      const now = Date.now();
      const ledgerAccountId = await ctx.db.insert("ledgerAccounts", {
        entityId: ids.entityId,
        name: "Checking",
        type: "asset",
        subtype: "bank",
        number: "1030",
        currency: "USD",
        isSystem: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.insert("bankAccounts", {
        entityId: ids.entityId,
        ledgerAccountId,
        name: "Operating",
        mask: "1234",
        kind: "checking",
        balanceMinor: 100000,
        includeInSync: true,
        plaidAccountId: "acc_1",
        plaidItemId: "item_1",
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await session.mutation(setBankAccountSync, { bankAccountId, includeInSync: false });
    expect(result.includeInSync).toBe(false);

    await t.run(async (ctx) => {
      const account = await ctx.db.get(bankAccountId);
      expect(account).not.toBeNull();
      expect(account?.includeInSync).toBe(false);
    });
  });
});

// E3-T6: a saved webhook secret is NEVER auto-trusted as "listening". It earns
// "pending_verification" on save and only flips to "listening" on a verified
// signed delivery; a failed signed delivery for a known account flags "failing".
const upsertConnectionCredential = makeFunctionReference<
  "mutation",
  {
    workspaceId: Id<"workspaces">;
    entityId: Id<"entities">;
    createdByUserId: Id<"users">;
    provider: "plaid" | "stripe";
    mode: "sandbox" | "development" | "production" | "test" | "live";
    label: string;
    externalId: string;
    encryptedPayload: string;
    fingerprint: string;
    keyPreview?: string;
    webhookConfigured: boolean;
    lastValidatedAt?: number;
    status: "active" | "invalid" | "disconnected";
    stripeAccountId?: string;
  },
  { connectionId: Id<"financialConnections">; credentialId: Id<"connectionCredentials"> }
>("connections:upsertConnectionCredential");

const markStripeWebhookDelivery = makeFunctionReference<
  "mutation",
  { connectionId: Id<"financialConnections">; entityId: Id<"entities">; outcome: "verified" | "failed" },
  { webhookStatus: string }
>("connections:markStripeWebhookDelivery");

const markStripeWebhookSignatureFailure = makeFunctionReference<
  "mutation",
  { connectedAccountId?: string },
  { flagged: boolean }
>("connections:markStripeWebhookSignatureFailure");

describe("E3-T6 Stripe webhook verification", () => {
  async function saveStripeConnection(t: TestConvex<typeof schema>, ids: Awaited<ReturnType<typeof setupConnectionsTest>>) {
    return await t.mutation(upsertConnectionCredential, {
      workspaceId: ids.workspaceId,
      entityId: ids.entityId,
      createdByUserId: ids.userId,
      provider: "stripe",
      mode: "test",
      label: "Stripe test account",
      externalId: "credential:stripe:test:acct_123",
      encryptedPayload: "ciphertext",
      fingerprint: "fingerprint",
      keyPreview: "rk_test_...abcd",
      webhookConfigured: true,
      status: "active",
      stripeAccountId: "acct_123",
    });
  }

  it("sets pending_verification (not listening) when a webhook secret is saved", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupConnectionsTest(t);
    const saved = await saveStripeConnection(t, ids);

    await t.run(async (ctx) => {
      const connection = await ctx.db.get(saved.connectionId);
      expect(connection?.webhookStatus).toBe("pending_verification");
      const stripeAccount = (await ctx.db.query("stripeAccounts").take(10)).find(
        (account) => account.connectedAccountId === "acct_123",
      );
      expect(stripeAccount?.webhookStatus).toBe("pending_verification");
    });
  });

  it("flips to listening and stamps lastValidatedAt on a verified delivery", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupConnectionsTest(t);
    const saved = await saveStripeConnection(t, ids);

    const result = await t.mutation(markStripeWebhookDelivery, {
      connectionId: saved.connectionId,
      entityId: ids.entityId,
      outcome: "verified",
    });
    expect(result.webhookStatus).toBe("listening");

    await t.run(async (ctx) => {
      const connection = await ctx.db.get(saved.connectionId);
      expect(connection?.webhookStatus).toBe("listening");
      // lastValidatedAt is stamped on the stripeAccount (financialConnections
      // tracks only webhookStatus).
      const stripeAccount = (await ctx.db.query("stripeAccounts").take(10)).find(
        (account) => account.connectedAccountId === "acct_123",
      );
      expect(stripeAccount?.webhookStatus).toBe("listening");
      expect(stripeAccount?.lastValidatedAt).toEqual(expect.any(Number));
    });
  });

  it("keeps listening sticky when the key is re-saved (no regression to pending)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupConnectionsTest(t);
    const saved = await saveStripeConnection(t, ids);
    await t.mutation(markStripeWebhookDelivery, {
      connectionId: saved.connectionId,
      entityId: ids.entityId,
      outcome: "verified",
    });

    // Owner rotates the restricted key and re-saves the same webhook.
    await saveStripeConnection(t, ids);
    await t.run(async (ctx) => {
      const connection = await ctx.db.get(saved.connectionId);
      expect(connection?.webhookStatus).toBe("listening");
    });
  });

  it("marks failing when a signed delivery cannot be verified for a known account", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupConnectionsTest(t);
    const saved = await saveStripeConnection(t, ids);

    const flagged = await t.mutation(markStripeWebhookSignatureFailure, {
      connectedAccountId: "acct_123",
    });
    expect(flagged.flagged).toBe(true);

    await t.run(async (ctx) => {
      const connection = await ctx.db.get(saved.connectionId);
      expect(connection?.webhookStatus).toBe("failing");
      const stripeAccount = (await ctx.db.query("stripeAccounts").take(10)).find(
        (account) => account.connectedAccountId === "acct_123",
      );
      expect(stripeAccount?.webhookStatus).toBe("failing");
    });
  });

  it("ignores a signature failure for an unknown account", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupConnectionsTest(t);
    await saveStripeConnection(t, ids);

    const flagged = await t.mutation(markStripeWebhookSignatureFailure, {
      connectedAccountId: "acct_unknown",
    });
    expect(flagged.flagged).toBe(false);
  });
});
