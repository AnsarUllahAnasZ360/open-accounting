/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
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
 * E11-T10 — the data-lifecycle invariants, proven together as one loop:
 * reset → re-onboard → demo isolation → export. The piecewise guarantees are
 * covered by activeEntity.test.ts (no-bleed), workspaceReset.test.ts (scoped
 * delete), demoGuard.test.ts (read isolation + write guard), and
 * exportAccount.test.ts (secret-free). This file asserts the cross-cutting
 * invariants the epic DoD names so a single regression can't quietly break the
 * promise that "your books are a file you own" and that demo data can never leak.
 */
describe("data-lifecycle invariants (E11-T10)", () => {
  it("a real empty workspace reads 0 transactions with no entityId, and the demo is never returned to a real viewer", async () => {
    const t = convexTest(schema, modules);

    // A fully-seeded public demo workspace exists alongside the real one. If any
    // resolver bled demo data, the real reads below would be non-zero.
    const demo = await t.mutation(internal.publicDemo.ensurePublicDemoWorkspace, {});
    await t.action(internal.publicDemo.seedPublicDemo, {});
    const demoTxnCount = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("transactions")
          .withIndex("by_entity", (q) => q.eq("entityId", demo.entityId))
          .collect()
      ).length,
    );
    // The demo is genuinely populated, so the zero reads below are no-bleed, not
    // an empty database.
    expect(demoTxnCount).toBeGreaterThan(0);

    // A real owner with one real business and no transactions.
    const ownerId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "loop-owner@example.com", name: "Loop Owner" }),
    );
    const owner = authed(t, ownerId, "loop-owner@example.com");
    const created = await owner.mutation(api.onboarding.bootstrapWorkspace, {
      businesses: [{ name: "Loop Books Co", businessType: "services" }],
    });
    const realEntityId = created.entityIds[0] as Id<"entities">;
    const realWorkspaceId = created.workspaceId as Id<"workspaces">;

    // No entityId → resolves the real entity, reads EMPTY (no demo bleed).
    const dashboard = await owner.query(api.coreViews.dashboard, {});
    expect(dashboard?.entity.id).toBe(realEntityId);
    expect(dashboard?.readStats.transactions).toBe(0);

    // The signed-in real viewer NEVER resolves the demo workspace.
    const viewer = await owner.query(api.session.viewer, {});
    expect(viewer.isDemo).toBe(false);
    expect(viewer.status).not.toBe("demo");
    expect(viewer.workspace?.id).toBe(realWorkspaceId);
    expect(viewer.workspace?.id).not.toBe(demo.workspaceId);

    // The unauthenticated demo viewer NEVER resolves the real workspace.
    const anon = await t.query(api.session.viewer, {});
    expect(anon.status).toBe("demo");
    expect(anon.workspace?.id).toBe(demo.workspaceId);
    expect(anon.workspace?.id).not.toBe(realWorkspaceId);
  });

  it("the full loop holds: reset wipes only the caller's workspace, flips it to onboarding, and export stays secret-free", async () => {
    const t = convexTest(schema, modules);

    // Two real workspaces — A resets, B must be untouched.
    const ownerAId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "loop-a@example.com", name: "Owner A" }),
    );
    const ownerA = authed(t, ownerAId, "loop-a@example.com");
    const createdA = await ownerA.mutation(api.onboarding.bootstrapWorkspace, {
      businesses: [{ name: "Loop A Co", businessType: "services" }],
    });
    const entityAId = createdA.entityIds[0] as Id<"entities">;
    const workspaceAId = createdA.workspaceId as Id<"workspaces">;

    const ownerBId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "loop-b@example.com", name: "Owner B" }),
    );
    const ownerB = authed(t, ownerBId, "loop-b@example.com");
    const createdB = await ownerB.mutation(api.onboarding.bootstrapWorkspace, {
      businesses: [{ name: "Loop B Co", businessType: "services" }],
    });
    const entityBId = createdB.entityIds[0] as Id<"entities">;
    const workspaceBId = createdB.workspaceId as Id<"workspaces">;

    // Seed A with business data including a contact carrying secret-shaped PII and
    // a Plaid item with a live token — both must be wiped by reset, and (where a
    // book remains) never leak into an export.
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("contacts", {
        entityId: entityAId,
        name: "Loop Customer",
        roles: ["customer"],
        aliases: [],
        bankDetails: "Routing 021000021 · Acct ••SECRET9999",
        createdAt: now,
        updatedAt: now,
      } as never);
      await ctx.db.insert("transactions", {
        entityId: entityAId,
        date: "2026-04-01",
        amountMinor: 250000,
        currency: "USD",
        merchant: "Loop Customer",
        rawDescription: "payment",
        status: "posted",
        review: "confirmed",
        source: "bank",
        externalId: "loop-a-txn-1",
        evalSet: false,
        createdAt: now,
        updatedAt: now,
      } as never);
      await ctx.db.insert("plaidItems", {
        entityId: entityAId,
        plaidItemId: "loop-item-a",
        accessToken: "access-sandbox-LOOPSECRET-TOKEN",
        accessTokenCiphertext: "LOOP-CIPHERTEXT-CAFE",
        environment: "sandbox",
        status: "active",
        createdAt: now,
        updatedAt: now,
      } as never);
    });

    // EXPORT (B): a secret-free, complete snapshot of a workspace the owner keeps.
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("credentials", {
        workspaceId: workspaceBId,
        kind: "ai",
        provider: "openai",
        encryptedPayload: "LOOP-ENCRYPTED-KEY-PAYLOAD",
        fingerprint: "loop-fp-secret",
        keyPreview: "••••9000",
        status: "active",
        createdAt: now,
        updatedAt: now,
      } as never);
    });
    const exportB = await ownerB.query(api.exportAccount.fullAccount, { entityId: entityBId });
    expect(exportB.entity.name).toBe("Loop B Co");
    const serializedB = JSON.stringify(exportB).toLowerCase();
    for (const secret of [
      "loop-encrypted-key-payload",
      "loop-fp-secret",
      "encryptedpayload",
      "ciphertext",
      "access_token",
      "accesstoken",
    ]) {
      expect(serializedB).not.toContain(secret);
    }

    // RESET (A): re-typing the exact workspace name wipes ONLY A. The preview
    // surfaces the canonical confirmation string the action requires.
    const previewA = await ownerA.query(api.workspaceReset.preview, {});
    const resetResult = await ownerA.action(api.workspaceReset.resetWorkspace, {
      confirmation: previewA.requiredConfirmation,
    });
    expect(resetResult.status).toBe("completed");
    expect(resetResult.deleted).toBeGreaterThan(0);

    // A is empty AND flipped to onboarding (entities + transactions gone); the
    // user + membership survive so the owner stays signed in.
    const afterA = await t.run(async (ctx) => {
      const entities = await ctx.db
        .query("entities")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceAId))
        .collect();
      const txns = await ctx.db
        .query("transactions")
        .withIndex("by_entity", (q) => q.eq("entityId", entityAId))
        .collect();
      const plaid = await ctx.db
        .query("plaidItems")
        .withIndex("by_entity", (q) => q.eq("entityId", entityAId))
        .collect();
      const userStillExists = (await ctx.db.get(ownerAId)) !== null;
      const membershipStillExists =
        (
          await ctx.db
            .query("workspaceMembers")
            .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceAId))
            .collect()
        ).length > 0;
      const auditRow = (
        await ctx.db
          .query("auditEvents")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceAId))
          .collect()
      ).some((event) => event.action === "workspace.reset.factory");
      return {
        entities: entities.filter((e) => !e.archived).length,
        txns: txns.length,
        plaid: plaid.length,
        userStillExists,
        membershipStillExists,
        auditRow,
      };
    });
    expect(afterA.entities).toBe(0);
    expect(afterA.txns).toBe(0);
    expect(afterA.plaid).toBe(0);
    expect(afterA.userStillExists).toBe(true);
    expect(afterA.membershipStillExists).toBe(true);
    expect(afterA.auditRow).toBe(true);

    // Owner A's viewer flips to needs_onboarding (empty book → re-run first-run).
    const viewerA = await ownerA.query(api.session.viewer, {});
    expect(viewerA.status).toBe("needs_onboarding");
    expect(viewerA.user?.id).toBe(ownerAId);

    // B is COMPLETELY untouched: its business + transactions remain.
    const afterB = await t.run(async (ctx) => {
      const entities = await ctx.db
        .query("entities")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceBId))
        .collect();
      return entities.filter((e) => !e.archived).length;
    });
    expect(afterB).toBe(1);
    const viewerB = await ownerB.query(api.session.viewer, {});
    expect(viewerB.status).toBe("ready");
    expect(viewerB.workspace?.id).toBe(workspaceBId);
  });
});
