/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { decryptSecret, encryptSecret } from "./secretBox";

const modules = import.meta.glob("./**/*.ts");

const ENC_KEY = "unit-test-secret-encryption-key";

const saveCredential = makeFunctionReference<
  "mutation",
  {
    workspaceId: Id<"workspaces">;
    kind: "ai" | "plaid" | "stripe" | "plunk";
    entityId?: Id<"entities">;
    provider?: string;
    payload: Record<string, string>;
    model?: string;
    status?: "active" | "invalid" | "disconnected" | "pending_verification";
  },
  {
    credentialId: Id<"credentials">;
    kind: string;
    provider: string | null;
    keyPreview: string;
    fingerprint: string;
    status: string;
  }
>("credentials:saveCredential");

const deleteCredential = makeFunctionReference<
  "mutation",
  { workspaceId: Id<"workspaces">; kind: "ai" | "plaid" | "stripe" | "plunk"; provider?: string; entityId?: Id<"entities"> },
  { deleted: boolean }
>("credentials:deleteCredential");

const credentialStatus = makeFunctionReference<
  "query",
  { workspaceId: Id<"workspaces">; kind?: "ai" | "plaid" | "stripe" | "plunk" },
  Array<Record<string, unknown>>
>("credentials:credentialStatus");

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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Unified credentials table", () => {
  it("writes one AI row with encryptedPayload + keyPreview and no plaintext key", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    const rawKey = "sk-openai-super-secret-1234";
    const result = await session.mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "ai",
      provider: "openai",
      payload: { apiKey: rawKey },
      model: "gpt-5",
    });

    expect(result.keyPreview).toBe("••••1234");
    expect(result.provider).toBe("openai");
    expect(JSON.stringify(result)).not.toContain(rawKey);

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("credentials")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", ids.workspaceId))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.encryptedPayload).toEqual(expect.any(String));
    expect(row.encryptedPayload).not.toContain(rawKey);
    // Every stored column must NOT equal the raw key.
    for (const value of Object.values(row)) {
      if (typeof value === "string") expect(value).not.toBe(rawKey);
    }
    // keyPreview is last 4.
    expect(row.keyPreview).toBe("••••1234");
    // Round-trips back to plaintext server-side only.
    const decrypted = JSON.parse(await decryptSecret(row.encryptedPayload));
    expect(decrypted.apiKey).toBe(rawKey);
  });

  it("upserts the same scope key instead of duplicating rows", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    await session.mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "ai",
      provider: "openai",
      payload: { apiKey: "sk-first-0001" },
    });
    await session.mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "ai",
      provider: "openai",
      payload: { apiKey: "sk-second-0002" },
    });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("credentials")
        .withIndex("by_workspace_and_kind", (q) => q.eq("workspaceId", ids.workspaceId).eq("kind", "ai"))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].keyPreview).toBe("••••0002");
  });

  it("round-trips all four kinds through the one table", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    await session.mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "ai",
      provider: "anthropic",
      payload: { apiKey: "sk-ant-aaaa" },
    });
    await session.mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "plaid",
      payload: { secretAccessKey: "plaid-secret-bbbb" },
    });
    await session.mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "stripe",
      entityId: ids.entityId,
      payload: { apiKey: "rk_live_cccc" },
    });
    await session.mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "plunk",
      payload: { apiKey: "sk_plunk_dddd", fromEmail: "hi@z360.biz", fromName: "Z360" },
    });

    const statuses = await session.query(credentialStatus, { workspaceId: ids.workspaceId });
    const kinds = statuses.map((s) => s.kind).sort();
    expect(kinds).toEqual(["ai", "plaid", "plunk", "stripe"]);
    const plunk = statuses.find((s) => s.kind === "plunk");
    expect(plunk?.fromEmail).toBe("hi@z360.biz");
    expect(plunk?.fromName).toBe("Z360");
  });

  it("credentialStatus never returns ciphertext or any raw key", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    const rawKey = "sk-leak-check-9999";
    await session.mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "ai",
      provider: "openai",
      payload: { apiKey: rawKey },
    });

    const statuses = await session.query(credentialStatus, { workspaceId: ids.workspaceId });
    const serialized = JSON.stringify(statuses);
    expect(serialized).not.toContain(rawKey);
    expect(serialized).not.toContain("encryptedPayload");
    expect(serialized).not.toContain("Ciphertext");
    expect(statuses[0]).not.toHaveProperty("encryptedPayload");
    expect(statuses[0].keyPreview).toBe("••••9999");
    expect(statuses[0].hasApiKey).toBe(true);
  });

  it("deleteCredential removes the row and stops listing the scope", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    await session.mutation(saveCredential, {
      workspaceId: ids.workspaceId,
      kind: "plunk",
      payload: { apiKey: "sk_plunk_zzzz" },
    });
    let statuses = await session.query(credentialStatus, { workspaceId: ids.workspaceId });
    expect(statuses).toHaveLength(1);

    const del = await session.mutation(deleteCredential, { workspaceId: ids.workspaceId, kind: "plunk" });
    expect(del.deleted).toBe(true);
    statuses = await session.query(credentialStatus, { workspaceId: ids.workspaceId });
    expect(statuses).toHaveLength(0);
  });

  it("throws a clear error naming OPENBOOKS_SECRET_ENCRYPTION_KEY when the vault is unconfigured", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", "");
    vi.stubEnv("OPENBOOKS_TOKEN_ENCRYPTION_KEY", "");
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    await expect(
      session.mutation(saveCredential, {
        workspaceId: ids.workspaceId,
        kind: "ai",
        provider: "openai",
        payload: { apiKey: "sk-should-not-store" },
      }),
    ).rejects.toThrow(/OPENBOOKS_SECRET_ENCRYPTION_KEY/);

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("credentials")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", ids.workspaceId))
        .collect(),
    );
    expect(rows).toHaveLength(0);
  });

  it("KDF derives 32 raw bytes via HKDF (v2 ciphertext), and v2 != v1", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    const plaintext = "hkdf-round-trip-secret";
    const ciphertext = await encryptSecret(plaintext);
    expect(ciphertext).toBeTruthy();
    // v2 format: v2:salt:iv:ciphertext (4 parts) with HKDF + per-row salt.
    const parts = ciphertext!.split(":");
    expect(parts[0]).toBe("v2");
    expect(parts).toHaveLength(4);
    // Two encryptions of the same plaintext differ (random salt + iv).
    const second = await encryptSecret(plaintext);
    expect(second).not.toBe(ciphertext);
    // Both decrypt back to the same plaintext.
    expect(await decryptSecret(ciphertext!)).toBe(plaintext);
    expect(await decryptSecret(second!)).toBe(plaintext);
  });

  it("rejects an unknown AI provider", async () => {
    vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);
    await expect(
      session.mutation(saveCredential, {
        workspaceId: ids.workspaceId,
        kind: "ai",
        provider: "not-a-provider",
        payload: { apiKey: "sk-xxxx" },
      }),
    ).rejects.toThrow();
  });
});
