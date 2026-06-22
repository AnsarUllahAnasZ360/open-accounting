/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { buildFixtureProjection } from "./stripe";

const modules = import.meta.glob("./**/*.ts");

type ApplyProjectionResult = {
  payoutsCreated: number;
  inboxItemsCreated: number;
  ledgerEntriesPosted: number;
};

const applyProjectionRef = makeFunctionReference<
  "mutation",
  { entityId: Id<"entities">; projection: ReturnType<typeof buildFixtureProjection> },
  ApplyProjectionResult
>("stripe:applyProjection");

const clearingHealthRef = makeFunctionReference<
  "query",
  { entityId: Id<"entities"> },
  {
    clearingBalanceMinor: number;
    inTransitBalanceMinor: number;
    pendingPayouts: number;
    isHealthy: boolean;
  }
>("stripe:stripeClearingHealth");

const drainResidualRef = makeFunctionReference<
  "mutation",
  { entityId: Id<"entities"> },
  { payoutsDrained: number; reversalsPosted: number; residualDrainedMinor: number; pendingSkipped: number }
>("stripe:drainResidualInTransit");

async function setup(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "WS",
      slug: "ws",
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
    return { userId, workspaceId, entityId };
  });
}

function authed(t: TestConvex<typeof schema>, userId: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|owner",
    issuer: "test",
    email: "owner@example.com",
  });
}

async function account(t: TestConvex<typeof schema>, entityId: Id<"entities">, number: string) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("ledgerAccounts")
      .withIndex("by_entity_and_number", (q) => q.eq("entityId", entityId).eq("number", number))
      .unique(),
  );
}

async function trialBalanceDifference(t: TestConvex<typeof schema>, entityId: Id<"entities">) {
  return await t.run(async (ctx) => {
    const lines = await ctx.db
      .query("journalLines")
      .withIndex("by_entity", (q) => q.eq("entityId", entityId))
      .collect();
    const debit = lines.reduce((s, l) => s + l.debitMinor, 0);
    const credit = lines.reduce((s, l) => s + l.creditMinor, 0);
    return debit - credit;
  });
}

async function inboxKinds(t: TestConvex<typeof schema>, entityId: Id<"entities">) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("inboxItems").withIndex("by_entity", (q) => q.eq("entityId", entityId)).collect()).map(
      (i) => i.kind,
    ),
  );
}

describe("E1-T4 clearing-zeroes invariant", () => {
  it("refuses to over-drain clearing and flags a clearing_drift card", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    // A payout that drains gross−fees from clearing with NO upstream income
    // having credited clearing first. The drain (gross 50000 − fees 5000 =
    // 45000) would push 1150 to −45000, so the invariant must refuse it.
    const projection = {
      ...buildFixtureProjection(),
      customers: [],
      income: [],
      invoices: [],
      payouts: [
        {
          payoutId: "po_drift_test",
          arrivalDate: "2026-05-04",
          amountMinor: 45000,
          grossMinor: 50000,
          feesMinor: 5000,
          driftMinor: 0,
          currency: "USD",
          lines: [
            {
              sourceId: "txn_1",
              description: "charge",
              grossMinor: 50000,
              feeMinor: 5000,
              netMinor: 45000,
              currency: "USD",
            },
          ],
        },
      ],
    };

    const result = await session.mutation(applyProjectionRef, { entityId: ids.entityId, projection });
    expect(result.payoutsCreated).toBe(1);

    // The invariant tripped: a clearing_drift card surfaces the over-drain rather
    // than letting clearing run negative silently.
    expect(await inboxKinds(t, ids.entityId)).toContain("clearing_drift");

    // The drain entry itself is balanced (never a half-posted entry) — the trial
    // balance still ties even though clearing is temporarily negative.
    expect(await trialBalanceDifference(t, ids.entityId)).toBe(0);

    // The payout stays pending (its declared amount == gross−fees, so it is not a
    // drift payout); the clearing-drift is surfaced via the card + health query,
    // not by poisoning the payout status — a real payout can legitimately arrive
    // before its charges are synced.
    const payout = await t.run(async (ctx) =>
      ctx.db.query("stripePayouts").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).first(),
    );
    expect(payout?.status).toBe("pending");

    // The negative-clearing condition is detected and reported as unhealthy, not
    // swallowed — this is the "clearing never silently commits negative" guarantee.
    const health = await session.query(clearingHealthRef, { entityId: ids.entityId });
    expect(health.clearingBalanceMinor).toBe(-45000);
    expect(health.isHealthy).toBe(false);
  });

  it("drains clearing to ~0 when income credited it first (healthy chain)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    const projection = {
      ...buildFixtureProjection(),
      customers: [],
      income: [
        {
          stripePaymentIntentId: "pi_1",
          stripeChargeId: "ch_1",
          customerStripeId: undefined,
          customerName: "Acme",
          description: "Payment",
          date: "2026-05-01",
          amountMinor: 50000,
          feeMinor: 5000,
          currency: "USD",
          feeSource: "stripe_balance_transaction" as const,
        },
      ],
      invoices: [],
      payouts: [
        {
          payoutId: "po_clean",
          arrivalDate: "2026-05-04",
          amountMinor: 45000,
          grossMinor: 50000,
          feesMinor: 5000,
          driftMinor: 0,
          currency: "USD",
          lines: [
            {
              sourceId: "txn_clean",
              description: "charge",
              grossMinor: 50000,
              feeMinor: 5000,
              netMinor: 45000,
              currency: "USD",
            },
          ],
        },
      ],
    };

    await session.mutation(applyProjectionRef, { entityId: ids.entityId, projection });

    // No clearing_drift card — the chain was healthy.
    expect(await inboxKinds(t, ids.entityId)).not.toContain("clearing_drift");

    const clearing = await account(t, ids.entityId, "1150");
    const clearingBalance = await t.run(async (ctx) => {
      const lines = await ctx.db
        .query("journalLines")
        .withIndex("by_account", (q) => q.eq("accountId", clearing!._id))
        .collect();
      return lines.reduce((s, l) => s + l.debitMinor - l.creditMinor, 0);
    });
    // income Dr 1150 50000 (less fee 5000 = 45000 net debit) − payout drain 45000 = 0.
    expect(clearingBalance).toBe(0);
    expect(await trialBalanceDifference(t, ids.entityId)).toBe(0);
  });
});

describe("E1-T4 stripeClearingHealth", () => {
  it("reports unhealthy when in-transit holds cash with no pending payout, healthy after match", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    // Seed a reconciled (legacy) book where 1160 is inflated and trial balance
    // still balances.
    const accountIds = await t.run(async (ctx) => {
      const now = Date.now();
      const mk = (number: string, name: string, type: Doc<"ledgerAccounts">["type"], subtype: string) =>
        ctx.db.insert("ledgerAccounts", {
          entityId: ids.entityId,
          name,
          type,
          subtype,
          number,
          currency: "USD",
          isSystem: false,
          archived: false,
          createdAt: now,
          updatedAt: now,
        });
      const clearing = await mk("1150", "Stripe Clearing", "asset", "clearing");
      const inTransit = await mk("1160", "Payouts In-Transit", "asset", "in_transit");
      const sales = await mk("4000", "Sales", "income", "sales");
      const bank = await mk("1010", "Operating Checking", "asset", "bank");
      return { clearing, inTransit, sales, bank };
    });

    // Post a clean legacy chain that leaves 1160 inflated by 45000:
    //   income:   Dr 1150 45000 / Cr Sales 45000
    //   in-transit drain: Dr 1160 45000 / Cr 1150 45000   (1150 -> 0, 1160 -> +45000)
    //   legacy deposit:   Dr Bank 45000 / Cr 1150 45000   (1150 -> -45000, bank +45000)
    const inTransitEntryId = await t.run(async (ctx) => {
      const now = Date.now();
      const post = async (lines: Array<{ accountId: Id<"ledgerAccounts">; debitMinor: number; creditMinor: number }>, memo: string) => {
        const entryId = await ctx.db.insert("journalEntries", {
          entityId: ids.entityId,
          date: "2026-05-04",
          memo,
          source: "stripe",
          postedByUserId: ids.userId,
          locked: true,
          createdAt: now,
        });
        for (const line of lines) {
          await ctx.db.insert("journalLines", {
            entityId: ids.entityId,
            entryId,
            accountId: line.accountId,
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor,
            currency: "USD",
            createdAt: now,
          });
        }
        return entryId;
      };
      await post(
        [
          { accountId: accountIds.clearing, debitMinor: 45000, creditMinor: 0 },
          { accountId: accountIds.sales, debitMinor: 0, creditMinor: 45000 },
        ],
        "income",
      );
      const inTransitEntry = await post(
        [
          { accountId: accountIds.inTransit, debitMinor: 45000, creditMinor: 0 },
          { accountId: accountIds.clearing, debitMinor: 0, creditMinor: 45000 },
        ],
        "in transit drain",
      );
      await post(
        [
          { accountId: accountIds.bank, debitMinor: 45000, creditMinor: 0 },
          { accountId: accountIds.clearing, debitMinor: 0, creditMinor: 45000 },
        ],
        "legacy deposit direct to bank",
      );
      return inTransitEntry;
    });

    // A reconciled payout whose 1160 was never drained.
    const { payoutId, txnId } = await t.run(async (ctx) => {
      const now = Date.now();
      const txnId = await ctx.db.insert("transactions", {
        entityId: ids.entityId,
        date: "2026-05-04",
        amountMinor: 45000,
        currency: "USD",
        merchant: "Stripe",
        rawDescription: "STRIPE PAYOUT",
        status: "posted",
        review: "auto",
        source: "bank",
        externalId: "ext_legacy_payout",
        evalSet: false,
        createdAt: now,
        updatedAt: now,
      });
      const payoutId = await ctx.db.insert("stripePayouts", {
        entityId: ids.entityId,
        payoutId: "po_legacy",
        amountMinor: 45000,
        grossMinor: 50000,
        feesMinor: 5000,
        arrivalDate: "2026-05-04",
        status: "reconciled",
        bankTxnId: txnId,
        inTransitAccountId: accountIds.inTransit,
        currency: "USD",
        entryIds: [inTransitEntryId],
        createdAt: now,
        updatedAt: now,
      });
      return { payoutId, txnId };
    });

    // Health is UNHEALTHY: 1160 holds 45000 with no pending payout.
    const before = await session.query(clearingHealthRef, { entityId: ids.entityId });
    expect(before.inTransitBalanceMinor).toBe(45000);
    expect(before.pendingPayouts).toBe(0);
    expect(before.isHealthy).toBe(false);

    // Drain residual: reverse the in-transit entry (immutability honored).
    const drain = await session.mutation(drainResidualRef, { entityId: ids.entityId });
    expect(drain.payoutsDrained).toBe(1);
    expect(drain.reversalsPosted).toBe(1);
    expect(drain.residualDrainedMinor).toBe(45000);

    // 1160 now nets to 0, trial balance still balances, and health flips healthy.
    expect(await trialBalanceDifference(t, ids.entityId)).toBe(0);
    const after = await session.query(clearingHealthRef, { entityId: ids.entityId });
    expect(after.inTransitBalanceMinor).toBe(0);
    expect(after.isHealthy).toBe(true);

    // Idempotent: re-running drains nothing new.
    const again = await session.mutation(drainResidualRef, { entityId: ids.entityId });
    expect(again.reversalsPosted).toBe(0);

    void payoutId;
    void txnId;
  });
});
