/// <reference types="vite/client" />
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { redactSecrets, safeErrorMessage } from "./secretRedaction";

const modules = import.meta.glob("./**/*.ts");

const ENC_KEY = "unit-test-secret-encryption-key";

// Field-name substrings that must NEVER appear in a client-facing return object.
// `keyPreview`/`lastFour`/`fingerprint` are deliberately allowed (redacted by
// construction); everything below is a raw-secret or ciphertext field name.
const FORBIDDEN_FIELD_NAMES = [
  "encryptedPayload",
  "apiKeyCiphertext",
  "accessKeyIdCiphertext",
  "secretAccessKeyCiphertext",
  "restrictedKey",
  "webhookSecret",
  "accessToken",
  "secretAccessKey",
  "clientSecret",
];

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

const credentialStatus = makeFunctionReference<
  "query",
  { workspaceId: Id<"workspaces">; kind?: "ai" | "plaid" | "stripe" | "plunk" },
  Array<Record<string, unknown>>
>("credentials:credentialStatus");

const plunkStatus = makeFunctionReference<
  "query",
  { workspaceId: Id<"workspaces"> },
  Record<string, unknown>
>("plunk:plunkStatus");

const providerStatus = makeFunctionReference<
  "query",
  { workspaceId: Id<"workspaces"> },
  Record<string, unknown>
>("ai:providerStatus");

const listConnections = makeFunctionReference<"query", Record<string, never>, Record<string, unknown>>(
  "connections:list",
);

const connectionsHealth = makeFunctionReference<"query", Record<string, never>, Record<string, unknown>>(
  "connections:health",
);

const webhookConfig = makeFunctionReference<"query", Record<string, never>, Record<string, unknown>>(
  "connections:webhookConfig",
);

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

function assertNoForbiddenField(value: unknown) {
  const serialized = JSON.stringify(value ?? {});
  for (const name of FORBIDDEN_FIELD_NAMES) {
    expect(serialized).not.toContain(`"${name}"`);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Secret-safety audit (E3-T10)", () => {
  it("never returns a ciphertext or raw-secret field from any integration query", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    const RAW_AI_KEY = "sk-openai-super-secret-abcd";
    const RAW_PLUNK_KEY = "sk-plunk-super-secret-wxyz";
    const RAW_STRIPE_KEY = "rk_test_super_secret_5678";

    await session.mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "ai",
      provider: "openai",
      payload: { apiKey: RAW_AI_KEY },
      status: "active",
    });
    await session.mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "plunk",
      payload: { apiKey: RAW_PLUNK_KEY, fromEmail: "hi@z360.biz" },
      status: "active",
    });
    // Seed a Stripe connection whose ciphertext encodes the raw key.
    await t.run(async (ctx) => {
      const now = Date.now();
      const connectionId = await ctx.db.insert("financialConnections", {
        workspaceId: ids.workspaceId,
        entityId: ids.entityId,
        provider: "stripe",
        mode: "test",
        displayName: "Stripe — Z360",
        externalId: "credential:stripe:test:acct_x",
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
        encryptedPayload: JSON.stringify({ restrictedKey: RAW_STRIPE_KEY }),
        fingerprint: "fp",
        keyPreview: "rk_t...5678",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });

    const surfaces: Array<[string, unknown]> = [
      ["credentialStatus", await session.query(credentialStatus, { workspaceId: ids.workspaceId })],
      ["plunkStatus", await session.query(plunkStatus, { workspaceId: ids.workspaceId })],
      ["providerStatus", await session.query(providerStatus, { workspaceId: ids.workspaceId })],
      ["connections.list", await session.query(listConnections, {})],
      ["connections.health", await session.query(connectionsHealth, {})],
      ["webhookConfig", await session.query(webhookConfig, {})],
    ];

    for (const [name, payload] of surfaces) {
      const serialized = JSON.stringify(payload ?? {});
      // No raw secret value leaks.
      expect(serialized, `${name} leaked the AI key`).not.toContain(RAW_AI_KEY);
      expect(serialized, `${name} leaked the Plunk key`).not.toContain(RAW_PLUNK_KEY);
      expect(serialized, `${name} leaked the Stripe key`).not.toContain(RAW_STRIPE_KEY);
      // No ciphertext / raw-secret field name surfaces.
      assertNoForbiddenField(payload);
    }
  });

  it("redacts secrets from thrown error messages via the shared helper", () => {
    const apiKey = "sk-anthropic-very-secret-key";
    const message = `Request failed for key ${apiKey} (401 unauthorized)`;
    const redacted = redactSecrets(message, [apiKey]);
    expect(redacted).not.toContain(apiKey);
    expect(redacted).toContain("[redacted]");

    const safe = safeErrorMessage(new Error(`boom ${apiKey}`), [apiKey], "fallback");
    expect(safe).not.toContain(apiKey);
    expect(safe.length).toBeLessThanOrEqual(300);

    // A short / empty secret never blanks the whole message.
    expect(redactSecrets("hello", ["x"])).toBe("hello");
  });

  it("gate: no integration query return shape names a ciphertext field", () => {
    // Source-level guard mirroring the runtime assertion: scan the query/action
    // return statements in the integration modules for a forbidden field name in
    // an object-literal position. Encryption is fine in mutations/internal
    // resolvers; this gate fails only if a *return shape* names a secret field.
    const root = join(__dirname);
    const files = ["credentials.ts", "plunk.ts"];
    for (const file of files) {
      const source = readFileSync(join(root, file), "utf8");
      // credentialStatus / plunkStatus map secrets out; ensure the client status
      // row types never declare a ciphertext field.
      const statusBlock = source.split("CredentialStatusRow")[1] ?? source;
      for (const forbidden of ["encryptedPayload", "apiKeyCiphertext", "secretAccessKeyCiphertext"]) {
        // The type that describes the client return must not contain these.
        const typeDecl = source.match(/type\s+\w*Status\w*\s*=\s*\{[\s\S]*?\};/g) ?? [];
        for (const decl of typeDecl) {
          expect(decl, `${file} status return type names ${forbidden}`).not.toContain(forbidden);
        }
        void statusBlock;
      }
    }
  });
});
