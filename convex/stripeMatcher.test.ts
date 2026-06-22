/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  businessDaysBetween,
  findMatchingStripePayout,
  type StripeProjectionForTest,
} from "./stripe";

const modules = import.meta.glob("./**/*.ts");

// One charge -> its fee -> one payout for the net. Mirrors the lifecycle proof,
// but the matching deposit carries a NON-Stripe descriptor (E1-T3 DoD).
const CHARGE_GROSS_MINOR = 100_000;
const CHARGE_FEE_MINOR = 3_200;
const PAYOUT_NET_MINOR = CHARGE_GROSS_MINOR - CHARGE_FEE_MINOR; // 96_800
const PAYOUT_ID = "po_match_001";
const ARRIVAL_DATE = "2026-06-10"; // Wednesday
const DEPOSIT_DATE = "2026-06-12"; // Friday, +2 business days

const applyProjectionRef = makeFunctionReference<
  "mutation",
  { entityId: Id<"entities">; projection: StripeProjectionForTest },
  { ledgerEntriesPosted: number }
>("stripe:applyProjection");

const matchDepositToPayoutRef = makeFunctionReference<
  "mutation",
  { transactionId: Id<"transactions">; payoutId: Id<"stripePayouts"> },
  { status: "reconciled" | "already_reconciled"; entryId: Id<"journalEntries"> | null }
>("stripe:matchDepositToPayout");

const listPayoutMatchCandidatesRef = makeFunctionReference<
  "query",
  { transactionId: Id<"transactions"> },
  { transactionId: Id<"transactions">; candidates: Array<{ payoutId: Id<"stripePayouts">; exactNet: boolean; inWindow: boolean }> }
>("stripe:listPayoutMatchCandidates");

function buildLifecycleProjection(): StripeProjectionForTest {
  return {
    mode: "fixture",
    reason: "E1-T3 matcher calibration proof lifecycle.",
    customers: [{ stripeCustomerId: "cus_match_1", name: "Match Customer", email: "match@example.com" }],
    income: [
      {
        stripePaymentIntentId: "pi_match_1",
        stripeChargeId: "ch_match_1",
        customerStripeId: "cus_match_1",
        customerName: "Match Customer",
        description: "Match services charge",
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
            sourceId: "ch_match_1",
            description: "Match services charge",
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

async function setupWorkspace(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Match workspace",
      slug: "match-workspace",
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

async function accountNetMinor(
  ctx: Parameters<Parameters<TestConvex<typeof schema>["run"]>[0]>[0],
  entityId: Id<"entities">,
  number: string,
) {
  const account = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity_and_number", (q) => q.eq("entityId", entityId).eq("number", number))
    .unique();
  if (!account) return 0;
  const lines = await ctx.db
    .query("journalLines")
    .withIndex("by_account", (q) => q.eq("accountId", account._id))
    .collect();
  return lines.reduce((sum, line) => sum + line.debitMinor - line.creditMinor, 0);
}

describe("E1-T3 businessDaysBetween", () => {
  it("counts weekdays only and is signed (Fri->Mon is +1)", () => {
    expect(businessDaysBetween("2026-06-12", "2026-06-15")).toBe(1); // Fri -> Mon
    expect(businessDaysBetween("2026-06-10", "2026-06-12")).toBe(2); // Wed -> Fri
    expect(businessDaysBetween("2026-06-12", "2026-06-10")).toBe(-2); // Fri -> Wed (before)
    expect(businessDaysBetween("2026-06-10", "2026-06-10")).toBe(0);
  });
});

describe("E1-T3 findMatchingStripePayout calibration", () => {
  const candidate = {
    _id: "p1" as Id<"stripePayouts">,
    payoutId: PAYOUT_ID,
    amountMinor: PAYOUT_NET_MINOR,
    arrivalDate: ARRIVAL_DATE,
    status: "pending" as const,
    currency: "USD",
  };

  it("matches a noisy (non-Stripe) descriptor on exact net within the window", () => {
    const match = findMatchingStripePayout(
      { amountMinor: PAYOUT_NET_MINOR, date: DEPOSIT_DATE, descriptor: "ACME ACH DEPOSIT 12345", currency: "USD" },
      [candidate],
    );
    expect(match?.payoutId).toBe(PAYOUT_ID);
  });

  it("matches inside the -2/+5 business-day window and not outside it", () => {
    // +5 business days after a Wed arrival = next Wed (2026-06-17) -> match.
    expect(
      findMatchingStripePayout(
        { amountMinor: PAYOUT_NET_MINOR, date: "2026-06-17", descriptor: "STRIPE PAYOUT", currency: "USD" },
        [candidate],
      ),
    ).not.toBeNull();
    // 2 business days BEFORE arrival (Mon 2026-06-08) -> match.
    expect(
      findMatchingStripePayout(
        { amountMinor: PAYOUT_NET_MINOR, date: "2026-06-08", descriptor: "STRIPE PAYOUT", currency: "USD" },
        [candidate],
      ),
    ).not.toBeNull();
    // 6 business days after (2026-06-18) -> out of window.
    expect(
      findMatchingStripePayout(
        { amountMinor: PAYOUT_NET_MINOR, date: "2026-06-18", descriptor: "STRIPE PAYOUT", currency: "USD" },
        [candidate],
      ),
    ).toBeNull();
    // 3 business days before (2026-06-05) -> out of the -2 window.
    expect(
      findMatchingStripePayout(
        { amountMinor: PAYOUT_NET_MINOR, date: "2026-06-05", descriptor: "STRIPE PAYOUT", currency: "USD" },
        [candidate],
      ),
    ).toBeNull();
  });

  it("does not amount-fuzz: a 1-cent-off deposit no longer matches", () => {
    expect(
      findMatchingStripePayout(
        { amountMinor: PAYOUT_NET_MINOR + 1, date: DEPOSIT_DATE, descriptor: "STRIPE PAYOUT", currency: "USD" },
        [candidate],
      ),
    ).toBeNull();
  });

  it("abstains when two pending payouts share the same exact net in the window", () => {
    const twin = { ...candidate, _id: "p2" as Id<"stripePayouts">, payoutId: "po_match_002" };
    expect(
      findMatchingStripePayout(
        { amountMinor: PAYOUT_NET_MINOR, date: DEPOSIT_DATE, descriptor: "STRIPE PAYOUT", currency: "USD" },
        [candidate, twin],
      ),
    ).toBeNull();
  });
});

describe("E1-T3 manual matchDepositToPayout", () => {
  it("reconciles a non-Stripe-descriptor deposit, drains 1160 to 0, and is idempotent", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);

    // Stripe side: charge -> fee -> payout (1160 now carries the net in-transit).
    await session.mutation(applyProjectionRef, { entityId: ids.entityId, projection: buildLifecycleProjection() });

    // Create the bank inflow with a NON-Stripe descriptor + its bank account.
    const { transactionId, payoutId } = await t.run(async (ctx) => {
      const checking = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity_and_number", (q) => q.eq("entityId", ids.entityId).eq("number", "1010"))
        .unique();
      const now = Date.now();
      const bankAccountId = await ctx.db.insert("bankAccounts", {
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
      const transactionId = await ctx.db.insert("transactions", {
        entityId: ids.entityId,
        bankAccountId,
        date: DEPOSIT_DATE,
        amountMinor: PAYOUT_NET_MINOR,
        currency: "USD",
        merchant: "ACME BANK",
        rawDescription: "ACH CREDIT 998877",
        status: "posted",
        review: "needs_review",
        source: "bank",
        externalId: "plaid:manual_match_1",
        evalSet: false,
        createdAt: now,
        updatedAt: now,
      });
      const payout = await ctx.db
        .query("stripePayouts")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .first();
      return { transactionId, payoutId: payout!._id };
    });

    // Candidate list surfaces the pending payout for this inflow.
    const before = await session.query(listPayoutMatchCandidatesRef, { transactionId });
    expect(before.candidates.some((c) => c.payoutId === payoutId && c.exactNet && c.inWindow)).toBe(true);

    // Manual match posts exactly one Dr Bank / Cr 1160 entry.
    const first = await session.mutation(matchDepositToPayoutRef, { transactionId, payoutId });
    expect(first.status).toBe("reconciled");
    expect(first.entryId).not.toBeNull();

    const after = await t.run(async (ctx) => {
      const inTransit = await accountNetMinor(ctx, ids.entityId, "1160");
      const bank = await accountNetMinor(ctx, ids.entityId, "1010");
      const payout = await ctx.db.get(payoutId);
      const txn = await ctx.db.get(transactionId);
      return { inTransit, bank, payoutStatus: payout?.status, txnStatus: txn?.status, txnEntryId: txn?.entryId };
    });
    // 1160 nets to 0 for this payout; the bank received the deposit once.
    expect(after.inTransit).toBe(0);
    expect(after.bank).toBe(PAYOUT_NET_MINOR);
    expect(after.payoutStatus).toBe("reconciled");
    expect(after.txnStatus).toBe("posted");
    expect(after.txnEntryId).not.toBeNull();

    // Idempotent: re-calling matches nothing new.
    const second = await session.mutation(matchDepositToPayoutRef, { transactionId, payoutId });
    expect(second.status).toBe("already_reconciled");
    expect(second.entryId).toBeNull();

    const afterSecond = await t.run(async (ctx) => accountNetMinor(ctx, ids.entityId, "1160"));
    expect(afterSecond).toBe(0);
  });
});
