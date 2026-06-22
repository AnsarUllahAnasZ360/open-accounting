/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  findMatchingStripePayout,
  matchPlaidInflowToPayout,
  reconcilePayoutWithDeposit,
  type StripeProjectionForTest,
} from "./stripe";

const modules = import.meta.glob("./**/*.ts");

// A single, fully-controlled lifecycle: one charge -> its fee -> one payout for
// the net -> one Plaid deposit that settles that payout. Small numbers keep the
// arithmetic auditable in the evidence file.
const CHARGE_GROSS_MINOR = 100_000; // $1,000.00 revenue
const CHARGE_FEE_MINOR = 3_200; //     $32.00 Stripe fee
const PAYOUT_NET_MINOR = CHARGE_GROSS_MINOR - CHARGE_FEE_MINOR; // $968.00 deposited
const PAYOUT_ID = "po_proof_001";
const ARRIVAL_DATE = "2026-06-10";
const DEPOSIT_DATE = "2026-06-12"; // within the 5-day arrival window

function buildLifecycleProjection(): StripeProjectionForTest {
  return {
    mode: "fixture",
    reason: "E7.5 single-counting proof lifecycle.",
    customers: [
      { stripeCustomerId: "cus_proof_1", name: "Proof Customer", email: "proof@example.com" },
    ],
    income: [
      {
        stripePaymentIntentId: "pi_proof_1",
        stripeChargeId: "ch_proof_1",
        customerStripeId: "cus_proof_1",
        customerName: "Proof Customer",
        description: "Proof services charge",
        date: "2026-06-05",
        amountMinor: CHARGE_GROSS_MINOR,
        feeMinor: CHARGE_FEE_MINOR,
        currency: "USD",
        feeSource: "fixture",
      },
    ],
    invoices: [],
    payouts: [
      {
        payoutId: PAYOUT_ID,
        arrivalDate: ARRIVAL_DATE,
        amountMinor: PAYOUT_NET_MINOR,
        grossMinor: CHARGE_GROSS_MINOR,
        feesMinor: CHARGE_FEE_MINOR,
        driftMinor: 0,
        currency: "USD",
        lines: [
          {
            sourceId: "ch_proof_1",
            description: "Proof services charge",
            grossMinor: CHARGE_GROSS_MINOR,
            feeMinor: CHARGE_FEE_MINOR,
            netMinor: PAYOUT_NET_MINOR,
            currency: "USD",
          },
        ],
      },
    ],
  };
}

const applyProjectionRef = makeFunctionReference<
  "mutation",
  { entityId: Id<"entities">; projection: StripeProjectionForTest },
  { ledgerEntriesPosted: number }
>("stripe:applyProjection");

async function setupWorkspace(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Proof workspace",
      slug: "proof-workspace",
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

/** Sum of debits − credits on a single ledger account (its trial-balance net). */
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
  const netMinor = lines.reduce((sum, line) => sum + line.debitMinor - line.creditMinor, 0);
  return { accountId: account._id, netMinor };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("E7.5 Stripe single-counting proof", () => {
  it("matcher pairs an inflow to an open payout only on amount + date + descriptor", () => {
    const candidates = [
      {
        _id: "p1" as Id<"stripePayouts">,
        payoutId: PAYOUT_ID,
        amountMinor: PAYOUT_NET_MINOR,
        arrivalDate: ARRIVAL_DATE,
        status: "pending" as const,
        currency: "USD",
      },
    ];
    // Exact amount + Stripe descriptor + in-window date -> matches.
    expect(
      findMatchingStripePayout(
        { amountMinor: PAYOUT_NET_MINOR, date: DEPOSIT_DATE, descriptor: "STRIPE PAYOUT", currency: "USD" },
        candidates,
      ),
    ).not.toBeNull();
    // Same amount but a non-Stripe descriptor still matches on EXACT amount only.
    expect(
      findMatchingStripePayout(
        { amountMinor: PAYOUT_NET_MINOR, date: DEPOSIT_DATE, descriptor: "ACME ACH DEPOSIT", currency: "USD" },
        candidates,
      ),
    ).not.toBeNull();
    // Out of the date window -> no match.
    expect(
      findMatchingStripePayout(
        { amountMinor: PAYOUT_NET_MINOR, date: "2026-07-01", descriptor: "STRIPE PAYOUT", currency: "USD" },
        candidates,
      ),
    ).toBeNull();
    // Wrong currency -> no match.
    expect(
      findMatchingStripePayout(
        { amountMinor: PAYOUT_NET_MINOR, date: DEPOSIT_DATE, descriptor: "STRIPE PAYOUT", currency: "EUR" },
        candidates,
      ),
    ).toBeNull();
    // A reconciled payout is never re-matched.
    expect(
      findMatchingStripePayout(
        { amountMinor: PAYOUT_NET_MINOR, date: DEPOSIT_DATE, descriptor: "STRIPE PAYOUT", currency: "USD" },
        [{ ...candidates[0], status: "reconciled" }],
      ),
    ).toBeNull();
  });

  it("counts revenue once, drains clearing/in-transit to ~0, debits bank once, and is idempotent", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);
    const projection = buildLifecycleProjection();

    // 1) Stripe side: charge -> fee -> payout (creates In-Transit drain).
    await session.mutation(applyProjectionRef, { entityId: ids.entityId, projection });

    // A bank account whose ledger account is Operating Checking (1010) — the
    // deposit lands here when the Plaid arrival is matched.
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

    // State after the Stripe side, BEFORE the deposit arrives.
    const beforeMatch = await t.run(async (ctx) => {
      const sales = await accountNetMinor(ctx, ids.entityId, "4000");
      const clearing = await accountNetMinor(ctx, ids.entityId, "1150");
      const inTransit = await accountNetMinor(ctx, ids.entityId, "1160");
      const bank = await accountNetMinor(ctx, ids.entityId, "1010");
      const payout = await ctx.db
        .query("stripePayouts")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .first();
      return {
        salesNetMinor: sales.netMinor,
        clearingNetMinor: clearing.netMinor,
        inTransitNetMinor: inTransit.netMinor,
        bankNetMinor: bank.netMinor,
        payoutStatus: payout?.status,
      };
    });

    // Revenue is recognized exactly once on the Stripe side: Sales is credited
    // the gross (net = -gross). Clearing already nets to 0 (charge credited it,
    // fee + payout drained it). Bank is still untouched; payout is pending.
    expect(beforeMatch.salesNetMinor).toBe(-CHARGE_GROSS_MINOR);
    expect(beforeMatch.clearingNetMinor).toBe(0);
    expect(beforeMatch.inTransitNetMinor).toBe(PAYOUT_NET_MINOR); // sitting in transit
    expect(beforeMatch.bankNetMinor).toBe(0);
    expect(beforeMatch.payoutStatus).toBe("pending");

    // 2) Plaid side: the matching deposit arrives. Run the production matcher.
    const inflow = {
      date: DEPOSIT_DATE,
      amountMinor: PAYOUT_NET_MINOR,
      currency: "USD",
      merchant: "Stripe",
      rawDescription: "STRIPE PAYOUT ST-PROOF",
      status: "posted" as const,
      externalId: "plaid:proof_deposit_1",
    };

    const firstMatch = await t.run(async (ctx) => {
      const entity = (await ctx.db.get(ids.entityId))!;
      const bankAccount = (await ctx.db.get(bankAccountId))!;
      return await matchPlaidInflowToPayout(ctx, {
        entity,
        bankAccount,
        actorUserId: ids.userId,
        inflow,
        auditAction: "system.sync.stripe.payout.reconciled",
      });
    });
    expect(firstMatch.matched).toBe(true);
    expect(firstMatch.payoutId).toBe(PAYOUT_ID);

    // 3) Idempotency: re-deliver the SAME deposit. The payout is no longer
    // `pending` (it reconciled on the first match), so there is no open payout to
    // pair against — the matcher returns `matched: false` and posts nothing. The
    // already-reconciled deposit transaction is left exactly as it was.
    const secondMatch = await t.run(async (ctx) => {
      const entity = (await ctx.db.get(ids.entityId))!;
      const bankAccount = (await ctx.db.get(bankAccountId))!;
      return await matchPlaidInflowToPayout(ctx, {
        entity,
        bankAccount,
        actorUserId: ids.userId,
        inflow,
        auditAction: "system.sync.stripe.payout.reconciled",
      });
    });
    expect(secondMatch.matched).toBe(false);

    // 4) Direct reconcile re-call on the now-reconciled payout is a no-op too.
    const reReconcile = await t.run(async (ctx) => {
      const entity = (await ctx.db.get(ids.entityId))!;
      const bankAccount = (await ctx.db.get(bankAccountId))!;
      const payout = await ctx.db
        .query("stripePayouts")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .first();
      const txn = await ctx.db
        .query("transactions")
        .withIndex("by_external_id", (q) => q.eq("externalId", inflow.externalId))
        .first();
      return await reconcilePayoutWithDeposit(ctx, {
        entity,
        payout: payout as Doc<"stripePayouts">,
        transaction: txn as Doc<"transactions">,
        bankAccount,
        actorUserId: ids.userId,
      });
    });
    expect(reReconcile.status).toBe("already_reconciled");

    // Final state after the deposit + idempotent re-runs.
    const afterMatch = await t.run(async (ctx) => {
      const sales = await accountNetMinor(ctx, ids.entityId, "4000");
      const fees = await accountNetMinor(ctx, ids.entityId, "5600");
      const clearing = await accountNetMinor(ctx, ids.entityId, "1150");
      const inTransit = await accountNetMinor(ctx, ids.entityId, "1160");
      const bank = await accountNetMinor(ctx, ids.entityId, "1010");

      const payout = (await ctx.db
        .query("stripePayouts")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .first())!;
      const depositTxn = (await ctx.db
        .query("transactions")
        .withIndex("by_external_id", (q) => q.eq("externalId", inflow.externalId))
        .first())!;

      // Every line on the deposit's journal entry, to prove it never credits Sales.
      const depositLines = depositTxn.entryId
        ? await ctx.db
            .query("journalLines")
            .withIndex("by_entry", (q) => q.eq("entryId", depositTxn.entryId!))
            .collect()
        : [];
      const salesAccount = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity_and_number", (q) => q.eq("entityId", ids.entityId).eq("number", "4000"))
        .unique();

      const allLines = await ctx.db
        .query("journalLines")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();

      // Idempotency at the data level: exactly one deposit transaction for the
      // re-delivered Plaid externalId.
      const depositTxns = await ctx.db
        .query("transactions")
        .withIndex("by_external_id", (q) => q.eq("externalId", inflow.externalId))
        .collect();

      // Count how many times Sales was credited across the whole ledger.
      const salesCreditEntries = allLines.filter(
        (line) => line.accountId === salesAccount!._id && line.creditMinor > 0,
      ).length;
      // Count how many times the bank account was debited.
      const bankAccountLedger = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity_and_number", (q) => q.eq("entityId", ids.entityId).eq("number", "1010"))
        .unique();
      const bankDebitEntries = allLines.filter(
        (line) => line.accountId === bankAccountLedger!._id && line.debitMinor > 0,
      ).length;

      return {
        salesNetMinor: sales.netMinor,
        feesNetMinor: fees.netMinor,
        clearingNetMinor: clearing.netMinor,
        inTransitNetMinor: inTransit.netMinor,
        bankNetMinor: bank.netMinor,
        payoutStatus: payout.status,
        payoutBankTxnLinked: Boolean(payout.bankTxnId),
        depositDecidedBy: depositTxn.decidedBy,
        depositReview: depositTxn.review,
        depositCategoryAccountId: depositTxn.categoryAccountId ?? null,
        depositCreditsSales: depositLines.some(
          (line) => line.accountId === salesAccount!._id && line.creditMinor > 0,
        ),
        salesCreditEntries,
        bankDebitEntries,
        depositTxnCount: depositTxns.length,
        totalDebitMinor: allLines.reduce((sum, line) => sum + line.debitMinor, 0),
        totalCreditMinor: allLines.reduce((sum, line) => sum + line.creditMinor, 0),
      };
    });

    // --- The single-counting assertions ---
    // Revenue credited EXACTLY once (one Sales credit entry, for the gross).
    expect(afterMatch.salesCreditEntries).toBe(1);
    expect(afterMatch.salesNetMinor).toBe(-CHARGE_GROSS_MINOR);
    // Clearing AND In-Transit both net to ~0 per payout — the built-in proof.
    expect(afterMatch.clearingNetMinor).toBe(0);
    expect(afterMatch.inTransitNetMinor).toBe(0);
    // Bank cash debited EXACTLY once, for the deposited net.
    expect(afterMatch.bankDebitEntries).toBe(1);
    expect(afterMatch.bankNetMinor).toBe(PAYOUT_NET_MINOR);
    // Fees recognized once.
    expect(afterMatch.feesNetMinor).toBe(CHARGE_FEE_MINOR);
    // The matched deposit is a transfer/match, NOT income.
    expect(afterMatch.depositDecidedBy).toBe("match");
    expect(afterMatch.depositCreditsSales).toBe(false);
    expect(afterMatch.depositCategoryAccountId).toBeNull();
    // Payout is reconciled and linked to its bank transaction.
    expect(afterMatch.payoutStatus).toBe("reconciled");
    expect(afterMatch.payoutBankTxnLinked).toBe(true);
    // The whole ledger still balances.
    expect(afterMatch.totalDebitMinor).toBe(afterMatch.totalCreditMinor);
    // Idempotency at the data level: only one deposit transaction exists.
    expect(afterMatch.depositTxnCount).toBe(1);

    // --- Emit the evidence file (E7.5) ---
    const evidenceGeneratedAt = "2026-06-14T00:00:00.000Z";
    const evidence = {
      epic: "E7.5",
      title: "Stripe single-counting proof (unit level)",
      generatedAt: evidenceGeneratedAt,
      lifecycle: {
        chargeGrossMinor: CHARGE_GROSS_MINOR,
        chargeFeeMinor: CHARGE_FEE_MINOR,
        payoutNetMinor: PAYOUT_NET_MINOR,
        payoutId: PAYOUT_ID,
        model: "Payouts-In-Transit (1160): charge Dr Clearing/Cr Sales + Dr Fees/Cr Clearing; payout Dr In-Transit/Cr Clearing; matched Plaid arrival Dr Bank/Cr In-Transit.",
      },
      beforeDepositMatch: beforeMatch,
      afterDepositMatch: {
        salesNetMinor: afterMatch.salesNetMinor,
        feesNetMinor: afterMatch.feesNetMinor,
        clearingNetMinor: afterMatch.clearingNetMinor,
        inTransitNetMinor: afterMatch.inTransitNetMinor,
        bankNetMinor: afterMatch.bankNetMinor,
        payoutStatus: afterMatch.payoutStatus,
      },
      assertions: {
        revenueCreditedExactlyOnce: afterMatch.salesCreditEntries === 1,
        clearingNetsToZeroPerPayout: afterMatch.clearingNetMinor === 0,
        inTransitNetsToZeroPerPayout: afterMatch.inTransitNetMinor === 0,
        bankDebitedExactlyOnce: afterMatch.bankDebitEntries === 1,
        matchedDepositIsNotIncome:
          afterMatch.depositDecidedBy === "match" && !afterMatch.depositCreditsSales,
        ledgerBalanced: afterMatch.totalDebitMinor === afterMatch.totalCreditMinor,
        idempotentReReconcile: reReconcile.status === "already_reconciled",
      },
      idempotency: {
        firstMatchedPayoutId: firstMatch.payoutId,
        secondMatchFoundOpenPayout: secondMatch.matched,
        reReconcileStatus: reReconcile.status,
        note: "Re-delivering the deposit finds no open payout (already reconciled) and a direct reconcile re-call is an explicit no-op, so neither re-posts.",
      },
      deferred: {
        "E7.3": "PARTIAL. The Payouts-In-Transit single-counting model is implemented and proven here. Refund -> contra-revenue, dispute -> fee + reversal, negative payout, and tax -> liability are DEFERRED: the Stripe projection (convex/stripe.ts) carries no refund/dispute/credit-note objects, so wiring contra-revenue now would be a fragile half-build against data that is never fetched.",
        "E7.4": "DEFERRED (honest). entities.accountingBasis exists and is read for display, but revenue recognition is unchanged: charges recognize at charge time (cash-like) and invoices at finalization (accrual). True cash-vs-accrual deferral needs the charge<->invoice link the projection does not carry; not attempted to avoid a fragile half-build.",
      },
      liveProofStatus:
        "UNIT-LEVEL ONLY. The live end-to-end proof still needs a hosted Plaid sandbox Link session plus a real Stripe payout webhook delivered to the cloud route (external/blocked per docs/finishing/whats-left.md). E7 proves single-counting deterministically at the unit level.",
    };
    const outPath = join(
      dirname(new URL(import.meta.url).pathname),
      "..",
      "docs",
      "finishing",
      "evidence",
      "2026-06-14-E7-single-counting-proof.json",
    );
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf-8");

    expect(Object.values(evidence.assertions).every(Boolean)).toBe(true);
  });

  it("dedupes a re-delivered evt_* so a webhook retry never triggers a second sync", async () => {
    // The second half of idempotency (acceptance E7.4): Stripe re-delivers
    // webhooks aggressively, so the SAME evt_* must be recognized as already
    // processed on redelivery. `recordEvent` is the production guard the HTTP
    // route consults before scheduling any targeted sync — a `duplicate` return
    // means the sync (and therefore any ledger posting) is skipped entirely.
    const t = convexTest(schema, modules);
    const event = {
      stripeEventId: "evt_proof_payout_001",
      type: "payout.paid",
      objectId: PAYOUT_ID,
      livemode: false,
    };

    const first = await t.mutation(internal.stripeWebhook.recordEvent, event);
    // First delivery is accepted (test-mode events are "received" and would be
    // synced); the row is now on file.
    expect(first.status).toBe("received");

    const second = await t.mutation(internal.stripeWebhook.recordEvent, event);
    // Re-delivery of the identical evt_* is rejected as a duplicate — the route
    // returns here and never runs the sync a second time.
    expect(second.status).toBe("duplicate");

    // Exactly one event row exists for this evt_*, proving the dedupe is at the
    // data level (not just a status string).
    const eventRows = await t.run(async (ctx) =>
      ctx.db
        .query("stripeWebhookEvents")
        .withIndex("by_event_id", (q) => q.eq("stripeEventId", event.stripeEventId))
        .collect(),
    );
    expect(eventRows).toHaveLength(1);
  });
});
