/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * E5-T9 — first-class bank/Stripe → business re-association.
 * Covers: happy-path move (same workspace), cross-workspace reject, and the
 * future-syncs-only guard (posted lines stay under the original entity).
 */
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

    async function entity(name: string, slug: string) {
      return ctx.db.insert("entities", {
        workspaceId,
        name,
        slug,
        businessType: "services",
        currency: "USD",
        isDemo: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
    }
    const zikraId = await entity("Zikra", "zikra");
    const z360Id = await entity("Z360", "z360");

    const zikraCashLedgerId = await ctx.db.insert("ledgerAccounts", {
      entityId: zikraId,
      number: "1010",
      name: "Operating Checking",
      type: "asset",
      subtype: "bank",
      currency: "USD",
      isSystem: true,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const bankAccountId = await ctx.db.insert("bankAccounts", {
      entityId: zikraId,
      ledgerAccountId: zikraCashLedgerId,
      name: "Chase Checking",
      mask: "1234",
      kind: "checking",
      balanceMinor: 500000,
      includeInSync: true,
      plaidAccountId: "plaid-acc-1",
      plaidItemId: "plaid-item-1",
      createdAt: now,
      updatedAt: now,
    });

    const stripeClearingLedgerId = await ctx.db.insert("ledgerAccounts", {
      entityId: zikraId,
      number: "1150",
      name: "Stripe Clearing",
      type: "asset",
      subtype: "bank",
      currency: "USD",
      isSystem: true,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const stripeAccountId = await ctx.db.insert("stripeAccounts", {
      entityId: zikraId,
      clearingAccountId: stripeClearingLedgerId,
      label: "Zikra Stripe",
      createdAt: now,
      updatedAt: now,
    });

    return {
      userId,
      workspaceId,
      zikraId,
      z360Id,
      zikraCashLedgerId,
      bankAccountId,
      stripeClearingLedgerId,
      stripeAccountId,
      now,
    };
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|reassign",
    issuer: "test",
    email: "owner@example.com",
  });
}

describe("reassignBankAccountEntity (E5-T9)", () => {
  it("moves a bank account to another business in the same workspace + writes audit", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    const result = await session.mutation(api.connections.reassignBankAccountEntity, {
      bankAccountId: ids.bankAccountId,
      entityId: ids.z360Id,
    });
    expect(String(result.entityId)).toBe(String(ids.z360Id));

    const after = await t.run(async (ctx) => {
      const bank = await ctx.db.get(ids.bankAccountId);
      const newLedger = bank ? await ctx.db.get(bank.ledgerAccountId) : null;
      const audit = await ctx.db
        .query("auditEvents")
        .collect()
        .then((rows) => rows.find((row) => row.action === "connection.bank.reassigned"));
      return {
        entityId: bank?.entityId,
        newLedgerEntity: newLedger?.entityId,
        audit: audit?.summary ?? null,
      };
    });
    expect(String(after.entityId)).toBe(String(ids.z360Id));
    // Ledger account is now in the destination entity (future syncs post there).
    expect(String(after.newLedgerEntity)).toBe(String(ids.z360Id));
    expect(after.audit).toContain("Z360");
  });

  it("rejects a cross-workspace target", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    const foreignEntityId = await t.run(async (ctx) => {
      const now = Date.now();
      const otherWorkspaceId = await ctx.db.insert("workspaces", {
        name: "Other",
        slug: "other",
        createdAt: now,
        updatedAt: now,
      });
      return ctx.db.insert("entities", {
        workspaceId: otherWorkspaceId,
        name: "Other Co",
        slug: "other-co",
        businessType: "services",
        currency: "USD",
        isDemo: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      session.mutation(api.connections.reassignBankAccountEntity, {
        bankAccountId: ids.bankAccountId,
        entityId: foreignEntityId,
      }),
    ).rejects.toThrow();
  });

  it("keeps posted lines under the original entity (future-syncs-only)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    // Post a balanced entry that debits the original (Zikra) cash ledger account.
    await t.run(async (ctx) => {
      const expenseLedgerId = await ctx.db.insert("ledgerAccounts", {
        entityId: ids.zikraId,
        number: "5000",
        name: "Software",
        type: "expense",
        subtype: "software",
        currency: "USD",
        isSystem: true,
        archived: false,
        createdAt: ids.now,
        updatedAt: ids.now,
      });
      const entryId = await ctx.db.insert("journalEntries", {
        entityId: ids.zikraId,
        date: "2026-06-05",
        memo: "Posted before re-map",
        source: "manual",
        postedByUserId: ids.userId,
        locked: false,
        createdAt: ids.now,
      });
      await ctx.db.insert("journalLines", {
        entityId: ids.zikraId,
        entryId,
        accountId: ids.zikraCashLedgerId,
        debitMinor: 100000,
        creditMinor: 0,
        currency: "USD",
        createdAt: ids.now,
      });
      await ctx.db.insert("journalLines", {
        entityId: ids.zikraId,
        entryId,
        accountId: expenseLedgerId,
        debitMinor: 0,
        creditMinor: 100000,
        currency: "USD",
        createdAt: ids.now,
      });
    });

    const result = await session.mutation(api.connections.reassignBankAccountEntity, {
      bankAccountId: ids.bankAccountId,
      entityId: ids.z360Id,
    });
    expect(result.hadPostedLines).toBe(true);
    expect(result.movedHistory).toBe(false);

    const after = await t.run(async (ctx) => {
      // The original ledger account + its posted lines stay under Zikra.
      const originalLedger = await ctx.db.get(ids.zikraCashLedgerId);
      const linesOnOriginal = await ctx.db
        .query("journalLines")
        .withIndex("by_account", (q) => q.eq("accountId", ids.zikraCashLedgerId))
        .collect();
      return {
        originalLedgerEntity: originalLedger?.entityId,
        postedLineCount: linesOnOriginal.length,
        allUnderZikra: linesOnOriginal.every((line) => String(line.entityId) === String(ids.zikraId)),
      };
    });
    // Immutability preserved: posted lines never re-parented.
    expect(String(after.originalLedgerEntity)).toBe(String(ids.zikraId));
    expect(after.postedLineCount).toBe(1);
    expect(after.allUnderZikra).toBe(true);
  });
});

describe("reassignStripeAccountEntity (E5-T9)", () => {
  it("moves a Stripe account to another business in the same workspace", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    const result = await session.mutation(api.connections.reassignStripeAccountEntity, {
      stripeAccountId: ids.stripeAccountId,
      entityId: ids.z360Id,
    });
    expect(String(result.entityId)).toBe(String(ids.z360Id));

    const after = await t.run(async (ctx) => {
      const stripe = await ctx.db.get(ids.stripeAccountId);
      const newClearing = stripe ? await ctx.db.get(stripe.clearingAccountId) : null;
      return { entityId: stripe?.entityId, clearingEntity: newClearing?.entityId };
    });
    expect(String(after.entityId)).toBe(String(ids.z360Id));
    expect(String(after.clearingEntity)).toBe(String(ids.z360Id));
  });
});
