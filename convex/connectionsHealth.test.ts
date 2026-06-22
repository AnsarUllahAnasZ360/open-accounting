/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ENC_KEY = "unit-test-secret-encryption-key";

type HealthRow = {
  kind: "ai" | "plaid" | "stripe" | "plunk";
  scope: "workspace" | "business";
  entityId: Id<"entities"> | null;
  entityName: string | null;
  label: string;
  status: "active" | "needs_attention" | "relink_required" | "not_configured";
  detail: string;
  lastValidatedAt: number | null;
  action: "validate" | "relink" | "configure" | null;
};

const health = makeFunctionReference<"query", Record<string, never>, { connections: HealthRow[] }>(
  "connections:health",
);

const saveCredential = makeFunctionReference<
  "mutation",
  {
    workspaceId: Id<"workspaces">;
    kind: "ai" | "plaid" | "stripe" | "plunk";
    entityId?: Id<"entities">;
    provider?: string;
    payload: Record<string, string>;
    status?: "active" | "invalid" | "disconnected" | "pending_verification";
  },
  { credentialId: Id<"credentials">; keyPreview: string }
>("credentials:saveCredential");

async function setup(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
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

function byKind(rows: HealthRow[], kind: HealthRow["kind"]) {
  return rows.filter((row) => row.kind === kind);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("connections.health (E3-T8)", () => {
  it("reports not_configured for every provider on a fresh workspace", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    vi.stubEnv("PLUNK_SECRET_KEY", "");
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    const { connections } = await session.query(health, {});
    const ai = byKind(connections, "ai")[0];
    const plunk = byKind(connections, "plunk")[0];
    const plaid = byKind(connections, "plaid")[0];

    expect(ai.status).toBe("not_configured");
    expect(ai.action).toBe("configure");
    expect(plunk.status).toBe("not_configured");
    expect(plaid.status).toBe("not_configured");
    // No Stripe row exists until a connection is saved.
    expect(byKind(connections, "stripe")).toHaveLength(0);
  });

  it("turns AI + Plunk active when a valid unified credential is saved", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    await session.mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "ai",
      provider: "openai",
      payload: { apiKey: "sk-openai-test-key-abcd" },
      status: "active",
    });
    await session.mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "plunk",
      payload: { apiKey: "sk-plunk-test-key-wxyz", fromEmail: "hi@z360.biz" },
      status: "active",
    });

    const { connections } = await session.query(health, {});
    const ai = byKind(connections, "ai")[0];
    const plunk = byKind(connections, "plunk")[0];
    expect(ai.status).toBe("active");
    expect(ai.label).toContain("openai");
    expect(plunk.status).toBe("active");
    // Server-derived health must never leak the key.
    expect(JSON.stringify(connections)).not.toContain("sk-openai-test-key-abcd");
    expect(JSON.stringify(connections)).not.toContain("sk-plunk-test-key-wxyz");
  });

  it("flags an invalid AI credential as needs_attention", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    await session.mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "ai",
      provider: "anthropic",
      payload: { apiKey: "sk-ant-bad-key-1234" },
      status: "invalid",
    });

    const { connections } = await session.query(health, {});
    const ai = byKind(connections, "ai")[0];
    expect(ai.status).toBe("needs_attention");
  });

  it("derives Stripe status from webhook state and stamps relink for Plaid items", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    // Seed a Stripe connection + credential with a pending webhook, and a Plaid
    // app + an item that needs relinking.
    await t.run(async (ctx) => {
      const now = Date.now();
      const connectionId = await ctx.db.insert("financialConnections", {
        workspaceId: ids.workspaceId,
        entityId: ids.entityId,
        provider: "stripe",
        mode: "test",
        displayName: "Stripe — Z360",
        externalId: "credential:stripe:test:acct_123",
        status: "active",
        webhookStatus: "pending_verification",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("connectionCredentials", {
        workspaceId: ids.workspaceId,
        entityId: ids.entityId,
        connectionId,
        provider: "stripe",
        mode: "test",
        label: "Stripe — Z360",
        encryptedPayload: "ciphertext",
        fingerprint: "fp",
        keyPreview: "rk_t...3456",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      // Plaid app credential (workspace-level) + a relink-required item.
      const plaidConnectionId = await ctx.db.insert("financialConnections", {
        workspaceId: ids.workspaceId,
        entityId: ids.entityId,
        provider: "plaid",
        mode: "sandbox",
        displayName: "Plaid app",
        externalId: "credential:plaid:app",
        status: "active",
        webhookStatus: "not_configured",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("connectionCredentials", {
        workspaceId: ids.workspaceId,
        entityId: ids.entityId,
        connectionId: plaidConnectionId,
        provider: "plaid",
        mode: "sandbox",
        label: "Plaid app",
        encryptedPayload: "ciphertext",
        fingerprint: "fp2",
        keyPreview: "clie...t-id",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("plaidItems", {
        entityId: ids.entityId,
        plaidItemId: "item-relink",
        institutionName: "Chase",
        environment: "sandbox",
        status: "relink_required",
        createdAt: now,
        updatedAt: now,
      });
    });

    const { connections } = await session.query(health, {});
    const stripe = byKind(connections, "stripe")[0];
    const plaid = byKind(connections, "plaid")[0];

    expect(stripe.status).toBe("needs_attention");
    expect(stripe.action).toBe("validate");
    expect(stripe.scope).toBe("business");
    expect(stripe.entityName).toBe("Z360 BIZ LLC");

    expect(plaid.status).toBe("relink_required");
    expect(plaid.action).toBe("relink");
  });

  it("reports Stripe active when the webhook is listening", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    await t.run(async (ctx) => {
      const now = Date.now();
      const connectionId = await ctx.db.insert("financialConnections", {
        workspaceId: ids.workspaceId,
        entityId: ids.entityId,
        provider: "stripe",
        mode: "test",
        displayName: "Stripe — Z360",
        externalId: "credential:stripe:test:acct_ok",
        status: "active",
        webhookStatus: "listening",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("connectionCredentials", {
        workspaceId: ids.workspaceId,
        entityId: ids.entityId,
        connectionId,
        provider: "stripe",
        mode: "test",
        label: "Stripe — Z360",
        encryptedPayload: "ciphertext",
        fingerprint: "fp",
        keyPreview: "rk_t...3456",
        status: "active",
        lastValidatedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    });

    const { connections } = await session.query(health, {});
    const stripe = byKind(connections, "stripe")[0];
    expect(stripe.status).toBe("active");
    expect(stripe.lastValidatedAt).toBeTypeOf("number");
  });
});
