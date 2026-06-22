/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { decryptSecret } from "./secretBox";

const modules = import.meta.glob("./**/*.ts");

const ENC_KEY = "unit-test-secret-encryption-key";

const savePlunkCredential = makeFunctionReference<
  "action",
  { workspaceId: Id<"workspaces">; secretKey: string; fromEmail?: string; fromName?: string },
  { configured: true; verified: boolean; keyPreview: string | null; message: string }
>("plunk:savePlunkCredential");

const deletePlunkCredential = makeFunctionReference<
  "mutation",
  { workspaceId: Id<"workspaces"> },
  { deleted: boolean }
>("plunk:deletePlunkCredential");

const plunkStatus = makeFunctionReference<
  "query",
  { workspaceId: Id<"workspaces"> },
  {
    configured: boolean;
    lastFour: string | null;
    fromEmail: string | null;
    fromName: string | null;
    verified: boolean;
    lastValidatedAt: number | null;
  }
>("plunk:plunkStatus");

const resolvePlunkConfig = makeFunctionReference<
  "action",
  { workspaceId?: Id<"workspaces"> },
  { source: "byo" | "env"; secretKey: string; fromEmail?: string; fromName?: string } | null
>("plunk:resolvePlunkConfig");

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
    return { userId, workspaceId };
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

function stubFetch(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status })),
  );
}

beforeEach(() => {
  vi.stubEnv("OPENBOOKS_SECRET_ENCRYPTION_KEY", ENC_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("E3-T7 Plunk BYO credential", () => {
  const PLUNK_KEY = ["sk", "live", "plunk", "abcd1234"].join("_");

  it("encrypts the key at rest and never returns it; plunkStatus shows last4 + verified", async () => {
    stubFetch(200);
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    const result = await session.action(savePlunkCredential, {
      workspaceId: ids.workspaceId,
      secretKey: PLUNK_KEY,
      fromEmail: "hello@zikra.biz",
      fromName: "Zikra",
    });

    expect(result.verified).toBe(true);
    expect(result.keyPreview).toBe("••••1234");
    expect(JSON.stringify(result)).not.toContain(PLUNK_KEY);

    const status = await session.query(plunkStatus, { workspaceId: ids.workspaceId });
    expect(status).toMatchObject({
      configured: true,
      lastFour: "1234",
      fromEmail: "hello@zikra.biz",
      fromName: "Zikra",
      verified: true,
    });
    expect(JSON.stringify(status)).not.toContain(PLUNK_KEY);

    // Ciphertext at rest, decryptable back to the original key — never plaintext.
    await t.run(async (ctx) => {
      const row = (
        await ctx.db
          .query("credentials")
          .withIndex("by_workspace_and_kind", (q) => q.eq("workspaceId", ids.workspaceId).eq("kind", "plunk"))
          .take(5)
      )[0];
      expect(row).toBeTruthy();
      expect(row?.encryptedPayload).toEqual(expect.any(String));
      expect(row?.encryptedPayload).not.toContain(PLUNK_KEY);
      const decrypted = JSON.parse(await decryptSecret(row!.encryptedPayload, "Plunk")) as { apiKey?: string };
      expect(decrypted.apiKey).toBe(PLUNK_KEY);
    });
  });

  it("flags an invalid key (Plunk 401) instead of silently accepting it", async () => {
    stubFetch(401);
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    const result = await session.action(savePlunkCredential, {
      workspaceId: ids.workspaceId,
      secretKey: PLUNK_KEY,
    });
    expect(result.verified).toBe(false);

    const status = await session.query(plunkStatus, { workspaceId: ids.workspaceId });
    expect(status.configured).toBe(true);
    expect(status.verified).toBe(false);
  });

  it("resolves the saved BYO key and falls back to env when no row exists", async () => {
    stubFetch(200);
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    // Env fallback when there is no saved row.
    vi.stubEnv("PLUNK_SECRET_KEY", "sk_env_fallback_key");
    const envResolved = await t.action(resolvePlunkConfig, { workspaceId: ids.workspaceId });
    expect(envResolved?.source).toBe("env");
    expect(envResolved?.secretKey).toBe("sk_env_fallback_key");

    // After saving a BYO key, the saved key wins over env.
    await session.action(savePlunkCredential, {
      workspaceId: ids.workspaceId,
      secretKey: PLUNK_KEY,
      fromEmail: "byo@zikra.biz",
    });
    const byoResolved = await t.action(resolvePlunkConfig, { workspaceId: ids.workspaceId });
    expect(byoResolved?.source).toBe("byo");
    expect(byoResolved?.secretKey).toBe(PLUNK_KEY);
    expect(byoResolved?.fromEmail).toBe("byo@zikra.biz");
  });

  it("returns null when neither a saved row nor env key exists", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const resolved = await t.action(resolvePlunkConfig, { workspaceId: ids.workspaceId });
    expect(resolved).toBeNull();
  });

  it("deletes the credential and plunkStatus stops reporting BYO", async () => {
    stubFetch(200);
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    await session.action(savePlunkCredential, { workspaceId: ids.workspaceId, secretKey: PLUNK_KEY });
    const removed = await session.mutation(deletePlunkCredential, { workspaceId: ids.workspaceId });
    expect(removed.deleted).toBe(true);

    const status = await session.query(plunkStatus, { workspaceId: ids.workspaceId });
    expect(status.configured).toBe(false);
    expect(status.lastFour).toBeNull();
  });
});
