/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  matchPlaidInflowToPayout,
  projectionFromStripeLists,
  type StripeProjectionForTest,
} from "./stripe";

// ---------------------------------------------------------------------------
// E14-T2 — Stripe clearing/in-transit ZERO-OUT invariant across MANY payouts,
// plus the no-fixtures-on-a-real-(non-demo)-book guard.
//
// Cross-reference: RC2 (phantom $458k 1160 asset) and RC4 (fixtures injected
// into real books). See docs/finishing/accounting-engine-blueprint.md:221/256.
// The in-transit/clearing double-count model is ALREADY built and wired (the
// E7 commit + E1-T1/E1-T3 calibration). This file is the INVARIANT that guards
// the calibrated matcher (E1-T3 / decision Q1: match on EXACT net amount within
// a −2/+5 BUSINESS-day window, with the "stripe"/"payout" descriptor demoted
// from a hard gate to a scoring BOOSTER only) and the RC4 fixture-gating
// (E1-T1). It is not new construction.
//
// Ledger model per payout:
//   charge:  Dr 1150 Clearing / Cr 4000 Sales (gross); Dr 5600 Fees / Cr 1150
//   payout:  Dr 1160 In-Transit / Cr 1150 Clearing (net)
//   matched: Dr 1010 Bank / Cr 1160 In-Transit (net)
// => after every payout reconciles, 1150 AND 1160 each net to exactly 0.
// ---------------------------------------------------------------------------

const modules = import.meta.glob("./**/*.ts");

const applyProjectionRef = makeFunctionReference<
  "mutation",
  { entityId: Id<"entities">; projection: StripeProjectionForTest },
  { ledgerEntriesPosted: number }
>("stripe:applyProjection");

type PayoutSpec = {
  payoutId: string;
  grossMinor: number;
  feeMinor: number;
  arrivalDate: string;
  depositDate: string; // may differ from arrivalDate, inside the −2/+5 window
  descriptor: string; // bank descriptor (one is deliberately non-Stripe)
  chargeId: string;
  paymentIntentId: string;
  customerId: string;
  customerName: string;
};

// Three payouts with DISTINCT net amounts (so each deposit matches a unique
// payout — no ambiguity guard), spanning the calibrated matcher's behaviors:
//  - p1: same-day deposit, Stripe descriptor (the booster confirms)
//  - p2: deposit lands 3 business days AFTER arrival (in the +5 window), with a
//        NON-Stripe descriptor — proves the descriptor is a booster, not a gate
//  - p3: deposit lands 1 business day BEFORE arrival (in the −2 window)
const SPECS: PayoutSpec[] = [
  {
    payoutId: "po_inv_001",
    grossMinor: 120_000,
    feeMinor: 3_500,
    arrivalDate: "2026-06-10", // Wednesday
    depositDate: "2026-06-10",
    descriptor: "STRIPE PAYOUT ST-AAA",
    chargeId: "ch_inv_001",
    paymentIntentId: "pi_inv_001",
    customerId: "cus_inv_1",
    customerName: "Marketing Client A",
  },
  {
    payoutId: "po_inv_002",
    grossMinor: 87_400,
    feeMinor: 2_835,
    arrivalDate: "2026-06-10", // Wednesday
    depositDate: "2026-06-15", // Monday: +3 business days, NON-stripe descriptor
    descriptor: "ACME BANK ACH CREDIT 998877",
    chargeId: "ch_inv_002",
    paymentIntentId: "pi_inv_002",
    customerId: "cus_inv_2",
    customerName: "Z360 Customer B",
  },
  {
    payoutId: "po_inv_003",
    grossMinor: 54_900,
    feeMinor: 1_922,
    arrivalDate: "2026-06-11", // Thursday
    depositDate: "2026-06-10", // Wednesday: −1 business day
    descriptor: "Stripe transfer ST-CCC",
    chargeId: "ch_inv_003",
    paymentIntentId: "pi_inv_003",
    customerId: "cus_inv_3",
    customerName: "Consulting Client C",
  },
];

function netMinor(spec: PayoutSpec) {
  return spec.grossMinor - spec.feeMinor;
}

function buildMultiPayoutProjection(): StripeProjectionForTest {
  return {
    mode: "fixture",
    reason: "E14-T2 multi-payout clearing/in-transit zero-out invariant.",
    customers: SPECS.map((spec) => ({
      stripeCustomerId: spec.customerId,
      name: spec.customerName,
      email: `${spec.customerId}@example.com`,
    })),
    income: SPECS.map((spec) => ({
      stripePaymentIntentId: spec.paymentIntentId,
      stripeChargeId: spec.chargeId,
      customerStripeId: spec.customerId,
      customerName: spec.customerName,
      description: `Charge for ${spec.customerName}`,
      date: "2026-06-05",
      amountMinor: spec.grossMinor,
      feeMinor: spec.feeMinor,
      currency: "USD",
      feeSource: "fixture",
    })),
    invoices: [],
    payouts: SPECS.map((spec) => ({
      payoutId: spec.payoutId,
      arrivalDate: spec.arrivalDate,
      amountMinor: netMinor(spec),
      grossMinor: spec.grossMinor,
      feesMinor: spec.feeMinor,
      driftMinor: 0,
      currency: "USD",
      lines: [
        {
          sourceId: spec.chargeId,
          description: `Charge for ${spec.customerName}`,
          grossMinor: spec.grossMinor,
          feeMinor: spec.feeMinor,
          netMinor: netMinor(spec),
          currency: "USD",
        },
      ],
    })),
  };
}

async function setupWorkspace(t: TestConvex<typeof schema>, opts?: { isDemo?: boolean }) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Clearing workspace",
      slug: "clearing-workspace",
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
      name: opts?.isDemo ? "Demo Books" : "Real LLC",
      slug: opts?.isDemo ? "demo-books" : "real-llc",
      businessType: "services",
      currency: "USD",
      isDemo: opts?.isDemo ?? false,
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

/** Net (Σdebit − Σcredit) for the account with this number on the entity. */
async function accountNetMinor(
  ctx: Parameters<Parameters<TestConvex<typeof schema>["run"]>[0]>[0],
  entityId: Id<"entities">,
  number: string,
) {
  const account = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity_and_number", (q) => q.eq("entityId", entityId).eq("number", number))
    .unique();
  if (!account) return { accountId: null as Id<"ledgerAccounts"> | null, netMinor: 0 };
  const lines = await ctx.db
    .query("journalLines")
    .withIndex("by_account", (q) => q.eq("accountId", account._id))
    .collect();
  return {
    accountId: account._id,
    netMinor: lines.reduce((sum, line) => sum + line.debitMinor - line.creditMinor, 0),
  };
}

describe("E14-T2 Stripe clearing/in-transit zero-out invariant (multi-payout)", () => {
  it("nets 1150 (Clearing) and 1160 (In-Transit) to exactly 0 after every payout reconciles", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t, { isDemo: true });
    const session = authed(t, ids.userId);

    // 1) Stripe side: 3 charges -> fees -> 3 payouts. Each payout drains
    //    Clearing into In-Transit; In-Transit now holds the three nets.
    await session.mutation(applyProjectionRef, {
      entityId: ids.entityId,
      projection: buildMultiPayoutProjection(),
    });

    // Bank account whose ledger account is Operating Checking (1010).
    const bankAccountId = await t.run(async (ctx) => {
      const checking = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity_and_number", (q) => q.eq("entityId", ids.entityId).eq("number", "1010"))
        .unique();
      const now = Date.now();
      return await ctx.db.insert("bankAccounts", {
        entityId: ids.entityId,
        ledgerAccountId: checking!._id,
        name: "Operating Checking",
        mask: "0000",
        kind: "checking",
        balanceMinor: 0,
        includeInSync: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    // Before any deposit: Clearing is already 0 (charge credited, fee+payout
    // drained), In-Transit holds the sum of the three nets, bank untouched.
    const before = await t.run(async (ctx) => {
      const clearing = await accountNetMinor(ctx, ids.entityId, "1150");
      const inTransit = await accountNetMinor(ctx, ids.entityId, "1160");
      const bank = await accountNetMinor(ctx, ids.entityId, "1010");
      return { clearing: clearing.netMinor, inTransit: inTransit.netMinor, bank: bank.netMinor };
    });
    const totalNet = SPECS.reduce((sum, spec) => sum + netMinor(spec), 0);
    expect(before.clearing).toBe(0);
    expect(before.inTransit).toBe(totalNet);
    expect(before.bank).toBe(0);

    // 2) Plaid side: each payout's matching deposit arrives. Run the production
    //    matcher for each — including the non-Stripe descriptor (p2) and the
    //    off-day-in-window deposits (p2 +3bd, p3 −1bd).
    for (const spec of SPECS) {
      const result = await t.run(async (ctx) => {
        const entity = (await ctx.db.get(ids.entityId))!;
        const bankAccount = (await ctx.db.get(bankAccountId))!;
        return await matchPlaidInflowToPayout(ctx, {
          entity,
          bankAccount,
          actorUserId: ids.userId,
          inflow: {
            date: spec.depositDate,
            amountMinor: netMinor(spec),
            currency: "USD",
            merchant: "Deposit",
            rawDescription: spec.descriptor,
            status: "posted",
            externalId: `plaid:${spec.payoutId}:deposit`,
          },
          auditAction: "system.sync.stripe.payout.reconciled",
        });
      });
      // Every payout — including the NON-Stripe-descriptor one — matches on
      // exact net + in-window date. Descriptor is a booster, not a gate.
      expect(result.matched).toBe(true);
      expect(result.payoutId).toBe(spec.payoutId);
    }

    // 3) After all reconciles: 1150 AND 1160 each net to EXACTLY 0; the bank now
    //    holds the sum of nets; revenue is recognized once per charge.
    const after = await t.run(async (ctx) => {
      const clearing = await accountNetMinor(ctx, ids.entityId, "1150");
      const inTransit = await accountNetMinor(ctx, ids.entityId, "1160");
      const bank = await accountNetMinor(ctx, ids.entityId, "1010");
      const sales = await accountNetMinor(ctx, ids.entityId, "4000");
      const fees = await accountNetMinor(ctx, ids.entityId, "5600");

      const allLines = await ctx.db
        .query("journalLines")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      const salesAccount = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity_and_number", (q) => q.eq("entityId", ids.entityId).eq("number", "4000"))
        .unique();
      const salesCreditEntries = allLines.filter(
        (line) => line.accountId === salesAccount!._id && line.creditMinor > 0,
      ).length;

      // Payout reconciliation status.
      const payouts = await ctx.db
        .query("stripePayouts")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();

      return {
        clearing: clearing.netMinor,
        inTransit: inTransit.netMinor,
        bank: bank.netMinor,
        sales: sales.netMinor,
        fees: fees.netMinor,
        salesCreditEntries,
        reconciledCount: payouts.filter((p) => p.status === "reconciled").length,
        totalDebitMinor: allLines.reduce((sum, line) => sum + line.debitMinor, 0),
        totalCreditMinor: allLines.reduce((sum, line) => sum + line.creditMinor, 0),
      };
    });

    // --- The clearing/in-transit zero-out invariant (RC2/RC4) ---
    expect(after.clearing).toBe(0);
    expect(after.inTransit).toBe(0);
    // Bank now holds the sum of all three nets, debited once each.
    expect(after.bank).toBe(totalNet);
    // --- Income double-count guard: Sales credited EXACTLY once per charge,
    //     for the gross, and never re-credited by the deposit match ---
    expect(after.salesCreditEntries).toBe(SPECS.length);
    expect(after.sales).toBe(-SPECS.reduce((sum, spec) => sum + spec.grossMinor, 0));
    expect(after.fees).toBe(SPECS.reduce((sum, spec) => sum + spec.feeMinor, 0));
    // All payouts reconciled; the whole ledger still balances.
    expect(after.reconciledCount).toBe(SPECS.length);
    expect(after.totalDebitMinor).toBe(after.totalCreditMinor);
  });
});

describe("E14-T2 no synthetic fixtures on a real (non-demo) book (RC4 / E1-T1)", () => {
  it("does NOT substitute fixture payouts when a real book's live payout list is empty", () => {
    // RC4 guard: projectionFromStripeLists only falls back to fixture payouts
    // when includeFixturePayoutFallback is true, which callers derive from
    // entity.isDemo. A REAL (non-demo) sync with zero live payouts must post
    // ZERO synthetic payouts (this is the gate that was added by E1-T1).
    const realEntity = { isDemo: false } as Pick<Doc<"entities">, "isDemo">;
    const realProjection = projectionFromStripeLists({
      reason: "E14-T2 real-book empty payout list",
      customers: [],
      paymentIntents: [],
      invoices: [],
      payouts: [], // live Stripe returned NO payouts
      includeFixturePayoutFallback: realEntity.isDemo, // false for a real book
    });
    expect(realProjection.payouts).toHaveLength(0);
  });

  it("DOES substitute fixture payouts for a demo book (so the demo stays populated)", () => {
    const demoEntity = { isDemo: true } as Pick<Doc<"entities">, "isDemo">;
    const demoProjection = projectionFromStripeLists({
      reason: "E14-T2 demo-book empty payout list",
      customers: [],
      paymentIntents: [],
      invoices: [],
      payouts: [],
      includeFixturePayoutFallback: demoEntity.isDemo, // true for a demo book
    });
    expect(demoProjection.payouts.length).toBeGreaterThan(0);
  });

  it("end-to-end: applying a payout-free projection to a real entity posts no in-transit/clearing entries", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t, { isDemo: false });
    const session = authed(t, ids.userId);

    // A REAL book whose live Stripe sync returned no payouts. The fixture
    // fallback is gated off (isDemo:false), so the projection carries zero
    // payouts and the apply posts zero 1150/1160 entries.
    const emptyPayoutProjection = projectionFromStripeLists({
      reason: "E14-T2 real-book sync, no payouts",
      customers: [],
      paymentIntents: [],
      invoices: [],
      payouts: [],
      includeFixturePayoutFallback: false,
    });
    expect(emptyPayoutProjection.payouts).toHaveLength(0);

    await session.mutation(applyProjectionRef, {
      entityId: ids.entityId,
      projection: emptyPayoutProjection as StripeProjectionForTest,
    });

    const result = await t.run(async (ctx) => {
      const clearing = await accountNetMinor(ctx, ids.entityId, "1150");
      const inTransit = await accountNetMinor(ctx, ids.entityId, "1160");
      const payouts = await ctx.db
        .query("stripePayouts")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      return { clearing: clearing.netMinor, inTransit: inTransit.netMinor, payoutCount: payouts.length };
    });
    // No phantom 1160 asset, no synthetic payouts on the real book (RC2/RC4).
    expect(result.payoutCount).toBe(0);
    expect(result.inTransit).toBe(0);
    expect(result.clearing).toBe(0);
  });
});
