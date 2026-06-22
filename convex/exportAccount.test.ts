/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function authed(t: TestConvex<typeof schema>, userId: Id<"users">, email: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: `test|${email}`,
    issuer: "test",
    email,
  });
}

/**
 * E11-T9 — the full-account export is COMPLETE and SECRET-FREE. The owner can
 * walk away with their entire book; no credential ciphertext, access token, or
 * API key may appear anywhere in the snapshot.
 */
describe("full-account export (E11-T9)", () => {
  it("includes every entity table and strips all secret material", async () => {
    const t = convexTest(schema, modules);

    const ownerId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "export-owner@example.com", name: "Export Owner" }),
    );
    const owner = authed(t, ownerId, "export-owner@example.com");
    const created = await owner.mutation(api.onboarding.bootstrapWorkspace, {
      businesses: [{ name: "Export Co", businessType: "services" }],
    });
    const workspaceId = created.workspaceId as Id<"workspaces">;
    const entityId = created.entityIds[0] as Id<"entities">;

    // Seed business data + connections that DO carry secrets, to prove they are
    // stripped from the export.
    await t.run(async (ctx) => {
      const now = Date.now();
      const cashAccount = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .first();

      const contactId = await ctx.db.insert("contacts", {
        entityId,
        name: "Acme Customer",
        roles: ["customer"],
        aliases: [],
        // Admin-only PII that must NOT leak.
        bankDetails: "Routing 021000021 · Acct ••SECRET4321",
        createdAt: now,
        updatedAt: now,
      } as never);

      await ctx.db.insert("transactions", {
        entityId,
        date: "2026-03-01",
        amountMinor: 120000,
        currency: "USD",
        merchant: "Acme Customer",
        rawDescription: "invoice payment",
        status: "posted",
        review: "confirmed",
        source: "bank",
        externalId: "export-txn-1",
        contactId,
        evalSet: false,
        createdAt: now,
        updatedAt: now,
      } as never);

      await ctx.db.insert("rules", {
        entityId,
        order: 0,
        name: "AWS → Software",
        merchantContains: "aws",
        direction: "outflow",
        categoryAccountId: cashAccount!._id,
        autoPost: true,
        hitCount: 0,
        active: true,
        createdBy: "user",
        createdAt: now,
        updatedAt: now,
      } as never);

      // Plaid item with a live access token + ciphertext — must be stripped.
      await ctx.db.insert("plaidItems", {
        entityId,
        plaidItemId: "item-1",
        accessToken: "access-sandbox-TOPSECRET-TOKEN",
        accessTokenCiphertext: "CIPHERTEXT-PAYLOAD-DEADBEEF",
        environment: "sandbox",
        status: "active",
        createdAt: now,
        updatedAt: now,
      } as never);

      // BYO AI credential with encrypted payload — must be stripped.
      await ctx.db.insert("credentials", {
        workspaceId,
        kind: "ai",
        provider: "openai",
        encryptedPayload: "ENCRYPTED-API-KEY-PAYLOAD",
        fingerprint: "fp-secret",
        keyPreview: "••••4242",
        status: "active",
        createdAt: now,
        updatedAt: now,
      } as never);
    });

    const snapshot = await owner.query(api.exportAccount.fullAccount, { entityId });

    // Every business table is present and non-empty where seeded.
    expect(snapshot.entity.name).toBe("Export Co");
    expect(snapshot.accounts.length).toBeGreaterThan(0);
    expect(snapshot.transactions.length).toBe(1);
    expect(snapshot.contacts.length).toBe(1);
    expect(snapshot.rules.length).toBe(1);
    expect(snapshot.journalEntries).toBeDefined();
    expect(snapshot.journalLines).toBeDefined();
    expect(snapshot.connections).toBeDefined();

    // SECRET-FREE: serialize the whole snapshot and grep for any secret material.
    const serialized = JSON.stringify(snapshot).toLowerCase();
    expect(serialized).not.toContain("topsecret");
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("deadbeef");
    expect(serialized).not.toContain("encrypted-api-key");
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("accesstoken");
    expect(serialized).not.toContain("encryptedpayload");
    expect(serialized).not.toContain("fingerprint");
    // Admin-only bank details are omitted entirely.
    expect(serialized).not.toContain("secret4321");
    expect(serialized).not.toContain("bankdetails");
  });

  it("writes a workspace.exported audit row via logExport", async () => {
    const t = convexTest(schema, modules);
    const ownerId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "audit-owner@example.com", name: "Audit Owner" }),
    );
    const owner = authed(t, ownerId, "audit-owner@example.com");
    const created = await owner.mutation(api.onboarding.bootstrapWorkspace, {
      businesses: [{ name: "Audit Co", businessType: "services" }],
    });
    const workspaceId = created.workspaceId as Id<"workspaces">;
    const entityId = created.entityIds[0] as Id<"entities">;

    await owner.mutation(api.exportAccount.logExport, { entityId });

    const exports = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("auditEvents")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .collect()
      ).filter((a) => a.action === "workspace.exported"),
    );
    expect(exports.length).toBe(1);
  });
});
