/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import type { StripeProjectionForTest } from "./stripe";

const modules = import.meta.glob("./**/*.ts");

const applyProjectionRef = makeFunctionReference<
  "mutation",
  { entityId: Id<"entities">; projection: StripeProjectionForTest },
  { ledgerEntriesPosted: number; preCutoffSkipped: number }
>("stripe:applyProjection");

// ---------------------------------------------------------------------------
// Opening-balance cutoff ("start my books on <date>").
//
// The contract under test, in the owner's words: activity dated before the day
// my books start must not affect my numbers, and must not sit in my Inbox
// asking to be categorized.
//
// That has to hold on BOTH sides of the cutoff being set:
//   - BEFORE  — a connector back-fills old history later. The pipeline must
//               refuse to post or queue it (`routeTransactionCore`).
//   - AFTER   — activity that already posted must be REVERSED, not merely
//               hidden. Cash Position and the Balance Sheet read journal lines,
//               so hiding a transaction while leaving its entry on the ledger
//               produces books that silently disagree with every screen.
//
// The ledger's own rules still win: posted entries are immutable (corrections
// reverse), and a locked period must not move. Both are asserted here.
// ---------------------------------------------------------------------------

function authed(t: TestConvex<typeof schema>, userId: Id<"users">, email: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: `test|${email}`,
    issuer: "test",
    email,
  });
}

async function setup(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const email = "owner@example.com";
    const userId = await ctx.db.insert("users", { email, name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Cutoff workspace",
      slug: "cutoff-workspace",
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
      name: "Totza Pvt Ltd",
      slug: "totza-pvt-ltd",
      businessType: "services",
      currency: "USD",
      isDemo: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });

    async function account(
      name: string,
      number: string,
      type: "asset" | "expense" | "equity",
      subtype: string,
    ) {
      return await ctx.db.insert("ledgerAccounts", {
        entityId,
        name,
        type,
        subtype,
        number,
        currency: "USD",
        isSystem: true,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
    }

    const bankLedgerId = await account("Operating Checking", "1010", "asset", "bank");
    const softwareId = await account("Software & SaaS", "5200", "expense", "software");
    // 3900 must exist for an opening balance to post at all.
    const openingEquityId = await account("Opening Balance Equity", "3900", "equity", "equity");

    const bankAccountId = await ctx.db.insert("bankAccounts", {
      entityId,
      ledgerAccountId: bankLedgerId,
      name: "Operating Checking",
      mask: "0000",
      kind: "checking",
      balanceMinor: 0,
      includeInSync: true,
      createdAt: now,
      updatedAt: now,
    });

    return {
      email,
      userId,
      workspaceId,
      entityId,
      bankLedgerId,
      softwareId,
      openingEquityId,
      bankAccountId,
    };
  });
}

/**
 * Set the cutoff and run the sweep to completion, the way the Settings screen
 * does. One call only advances one phase, so a test that stops there would be
 * asserting against a half-re-based book.
 */
async function reBaseToCompletion(
  t: TestConvex<typeof schema>,
  ids: Awaited<ReturnType<typeof setup>>,
  args: { startDate: string; balanceMinor?: number },
) {
  const as = authed(t, ids.userId, ids.email);
  const first = await as.mutation(api.onboarding.updateOpeningBalanceDate, {
    entityId: ids.entityId,
    startDate: args.startDate,
    ...(args.balanceMinor !== undefined ? { balanceMinor: args.balanceMinor } : {}),
  });

  const totals = {
    cutoff: first.cutoff,
    posted: first.posted,
    replacedOpeningEntries: first.replacedOpeningEntries,
    reversedEntries: first.reversedEntries,
    archivedTransactions: first.archivedTransactions,
    dismissedItems: first.dismissedItems,
    lockedEntries: first.lockedEntries,
    passes: 0,
  };

  let { phase, cursor, done } = first;
  while (!done && totals.passes < 100) {
    totals.passes += 1;
    const next = await as.mutation(api.onboarding.continueOpeningBalanceCutoff, {
      entityId: ids.entityId,
      phase,
      cursor,
    });
    totals.reversedEntries += next.reversedEntries;
    totals.archivedTransactions += next.archivedTransactions;
    totals.dismissedItems += next.dismissedItems;
    totals.lockedEntries += next.lockedEntries;
    phase = next.phase;
    cursor = next.cursor;
    done = next.done;
  }
  if (!done) throw new Error("Cutoff sweep did not converge within 100 passes.");
  return totals;
}

/** Net movement on one ledger account across every posted line (debit − credit). */
async function accountNetMinor(t: TestConvex<typeof schema>, accountId: Id<"ledgerAccounts">) {
  return await t.run(async (ctx) => {
    const lines = await ctx.db
      .query("journalLines")
      .filter((q) => q.eq(q.field("accountId"), accountId))
      .collect();
    return lines.reduce((sum, line) => sum + line.debitMinor - line.creditMinor, 0);
  });
}

/**
 * Post a real expense entry and attach it to a transaction row, the way the
 * pipeline does when it confirms one. Goes through `ledger.postEntry` rather
 * than inserting journal rows directly, so the fixture obeys the same
 * invariants production does.
 */
async function postedTransaction(
  t: TestConvex<typeof schema>,
  ids: Awaited<ReturnType<typeof setup>>,
  args: { date: string; amountMinor: number; merchant: string; externalId: string },
) {
  const as = authed(t, ids.userId, ids.email);
  const entry = await as.mutation(api.ledger.postEntry, {
    entityId: ids.entityId,
    date: args.date,
    memo: `${args.merchant} - expense`,
    source: "bank",
    lines: [
      { accountId: ids.softwareId, debitMinor: args.amountMinor, creditMinor: 0 },
      { accountId: ids.bankLedgerId, debitMinor: 0, creditMinor: args.amountMinor },
    ],
  });

  return await t.run(async (ctx) => {
    const now = Date.now();
    const transactionId = await ctx.db.insert("transactions", {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: args.date,
      amountMinor: -args.amountMinor,
      currency: "USD",
      merchant: args.merchant,
      rawDescription: args.merchant,
      status: "posted",
      review: "confirmed",
      source: "bank",
      externalId: args.externalId,
      entryId: entry.entryId,
      evalSet: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("inboxItems", {
      entityId: ids.entityId,
      kind: "categorize",
      status: "open",
      payloadSummary: args.merchant,
      transactionId,
      createdAt: now,
      updatedAt: now,
    });
    return { transactionId, entryId: entry.entryId };
  });
}

/** Net (Σdebit − Σcredit) for the account carrying this number on the entity. */
async function numberedAccountNetMinor(
  t: TestConvex<typeof schema>,
  entityId: Id<"entities">,
  number: string,
) {
  return await t.run(async (ctx) => {
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
  });
}

/**
 * One Stripe payment and the payout that settles it. Stripe posts this as
 * SEVERAL balanced entries — gross (Dr 1150 / Cr 4000), fee (Dr 5600 / Cr 1150),
 * payout drain (Dr 1160 / Cr 1150) — and only the gross entry is stored on the
 * transaction row.
 */
function stripeProjection(date: string): StripeProjectionForTest {
  const grossMinor = 120_000;
  const feeMinor = 3_500;
  return {
    mode: "fixture",
    reason: "Opening-balance cutoff coverage.",
    customers: [{ stripeCustomerId: "cus_cut_1", name: "Customer A", email: "a@example.com" }],
    income: [
      {
        stripePaymentIntentId: `pi_cut_${date}`,
        stripeChargeId: `ch_cut_${date}`,
        customerStripeId: "cus_cut_1",
        customerName: "Customer A",
        description: "Charge for Customer A",
        date,
        amountMinor: grossMinor,
        feeMinor,
        currency: "USD",
        feeSource: "fixture",
      },
    ],
    invoices: [],
    payouts: [
      {
        payoutId: `po_cut_${date}`,
        arrivalDate: date,
        amountMinor: grossMinor - feeMinor,
        grossMinor,
        feesMinor: feeMinor,
        driftMinor: 0,
        currency: "USD",
        lines: [
          {
            sourceId: `ch_cut_${date}`,
            description: "Charge for Customer A",
            grossMinor,
            feeMinor,
            netMinor: grossMinor - feeMinor,
            currency: "USD",
          },
        ],
      },
    ],
  };
}

describe("opening-balance cutoff — large books", () => {
  it("re-bases a book too large for one pass, across resumable calls", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const as = authed(t, ids.userId, ids.email);

    // 260 pre-cutoff entries — more than one pass reverses (CUTOFF_BATCH_SIZE is
    // 200), so this only completes if the sweep is genuinely resumable.
    const COUNT = 260;
    const AMOUNT = 1_000;
    for (let i = 0; i < COUNT; i += 1) {
      await postedTransaction(t, ids, {
        date: "2025-11-18",
        amountMinor: AMOUNT,
        merchant: `Vendor ${i}`,
        externalId: `ext-bulk-${i}`,
      });
    }
    expect(await accountNetMinor(t, ids.bankLedgerId)).toBe(-AMOUNT * COUNT);

    let outcome = await as.mutation(api.onboarding.updateOpeningBalanceDate, {
      entityId: ids.entityId,
      startDate: "2026-04-01",
    });
    // The first pass must report honestly that it did not finish, rather than
    // silently leaving the books half re-based.
    expect(outcome.done).toBe(false);

    let reversed = outcome.reversedEntries;
    let archived = outcome.archivedTransactions;
    let phase = outcome.phase;
    let cursor = outcome.cursor;
    let done = outcome.done;
    let passes = 0;

    // A bounded loop is the point: without a working cursor this never
    // terminates, because each pass re-reads the same first page.
    while (!done && passes < 40) {
      passes += 1;
      const next = await as.mutation(api.onboarding.continueOpeningBalanceCutoff, {
        entityId: ids.entityId,
        phase,
        cursor,
      });
      reversed += next.reversedEntries;
      archived += next.archivedTransactions;
      phase = next.phase;
      cursor = next.cursor;
      done = next.done;
    }

    expect(done).toBe(true);
    expect(reversed).toBe(COUNT);
    // Counts report what CHANGED, so each row is counted exactly once — the
    // inflated "180800 archived" bug was a count of rows merely re-read.
    expect(archived).toBe(COUNT);
    // Every pre-cutoff entry reversed: the period nets to zero.
    expect(await accountNetMinor(t, ids.bankLedgerId)).toBe(0);
    expect(await accountNetMinor(t, ids.softwareId)).toBe(0);

    // Converged: replaying from the start finds nothing left and changes nothing.
    const extra = await as.mutation(api.onboarding.continueOpeningBalanceCutoff, {
      entityId: ids.entityId,
      phase: "entries",
      cursor: null,
    });
    expect(extra.reversedEntries).toBe(0);
    expect(extra.archivedTransactions).toBe(0);
    expect(await accountNetMinor(t, ids.bankLedgerId)).toBe(0);
  });
});

describe("opening-balance cutoff — Stripe", () => {
  it("reverses a pre-cutoff Stripe payment as a whole set, leaving clearing at zero", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const as = authed(t, ids.userId, ids.email);

    // Sync BEFORE any cutoff exists — the books already carry this activity,
    // which is the state a business is in when it asks to re-base.
    await as.mutation(applyProjectionRef, {
      entityId: ids.entityId,
      projection: stripeProjection("2025-11-18"),
    });
    expect(await numberedAccountNetMinor(t, ids.entityId, "4000")).toBe(-120_000);
    expect(await numberedAccountNetMinor(t, ids.entityId, "5600")).toBe(3_500);

    await as.mutation(api.onboarding.updateOpeningBalanceDate, {
      entityId: ids.entityId,
      startDate: "2026-04-01",
    });

    // Every leg reverses together. Reversing only the transaction-linked gross
    // entry would strand the fee and leave 1150 holding a phantom balance.
    for (const number of ["1150", "1160", "4000", "5600"]) {
      expect(await numberedAccountNetMinor(t, ids.entityId, number)).toBe(0);
    }
  });

  it("never posts Stripe activity that arrives dated before the cutoff", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const as = authed(t, ids.userId, ids.email);
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.entityId, { openingBalanceDate: "2026-04-01" });
    });

    const result = await as.mutation(applyProjectionRef, {
      entityId: ids.entityId,
      projection: stripeProjection("2025-11-18"),
    });

    // Charge + payout both dropped; nothing reached the ledger to clean up later.
    expect(result.preCutoffSkipped).toBe(2);
    expect(result.ledgerEntriesPosted).toBe(0);
    for (const number of ["1150", "1160", "4000", "5600"]) {
      expect(await numberedAccountNetMinor(t, ids.entityId, number)).toBe(0);
    }

    // Post-cutoff activity still flows through untouched.
    const kept = await as.mutation(applyProjectionRef, {
      entityId: ids.entityId,
      projection: stripeProjection("2026-05-09"),
    });
    expect(kept.preCutoffSkipped).toBe(0);
    expect(await numberedAccountNetMinor(t, ids.entityId, "4000")).toBe(-120_000);
  });
});

describe("opening-balance cutoff", () => {
  it("reverses already-posted pre-cutoff activity so the period nets to zero", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);

    // Two expenses before the cutoff, one after. Only the later one should
    // survive on the ledger.
    await postedTransaction(t, ids, {
      date: "2025-11-18",
      amountMinor: 50_000,
      merchant: "United Airlines",
      externalId: "ext-old-1",
    });
    await postedTransaction(t, ids, {
      date: "2026-03-02",
      amountMinor: 25_000,
      merchant: "Old Vendor",
      externalId: "ext-old-2",
    });
    await postedTransaction(t, ids, {
      date: "2026-05-09",
      amountMinor: 10_000,
      merchant: "Kept Vendor",
      externalId: "ext-new-1",
    });

    // Bank is credited for all three: −85,000.
    expect(await accountNetMinor(t, ids.bankLedgerId)).toBe(-85_000);

    const outcome = await reBaseToCompletion(t, ids, {
      startDate: "2026-04-01",
      balanceMinor: 15_000,
    });

    expect(outcome.cutoff).toBe("2026-04-01");
    expect(outcome.archivedTransactions).toBe(2);
    expect(outcome.reversedEntries).toBe(2);
    expect(outcome.dismissedItems).toBe(2);
    expect(outcome.lockedEntries).toBe(0);
    expect(outcome.posted).toBe(true);

    // The two pre-cutoff expenses net to zero; what remains is the kept
    // expense (−10,000) plus the opening balance debit (+15,000).
    expect(await accountNetMinor(t, ids.bankLedgerId)).toBe(5_000);
    // The expense account nets to just the kept vendor.
    expect(await accountNetMinor(t, ids.softwareId)).toBe(10_000);

    await t.run(async (ctx) => {
      const transactions = await ctx.db
        .query("transactions")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      const excluded = transactions.filter((row) => row.review === "excluded");
      expect(excluded.map((row) => row.date).sort()).toEqual(["2025-11-18", "2026-03-02"]);

      // Originals are untouched and their reversals are linked, never edited.
      const reversals = (
        await ctx.db
          .query("journalEntries")
          .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
          .collect()
      ).filter((entry) => entry.reversesEntryId);
      expect(reversals).toHaveLength(2);

      const openItems = (
        await ctx.db
          .query("inboxItems")
          .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
          .collect()
      ).filter((item) => item.status === "open");
      expect(openItems).toHaveLength(1);
    });
  });

  it("does not stack reversals when the cutoff is applied twice", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await postedTransaction(t, ids, {
      date: "2025-12-01",
      amountMinor: 40_000,
      merchant: "Old Vendor",
      externalId: "ext-old-1",
    });

    const as = authed(t, ids.userId, ids.email);
    const first = await as.mutation(api.onboarding.updateOpeningBalanceDate, {
      entityId: ids.entityId,
      startDate: "2026-04-01",
    });
    expect(first.reversedEntries).toBe(1);
    expect(await accountNetMinor(t, ids.bankLedgerId)).toBe(0);

    // Re-applying must be a no-op on the ledger. A second reversal would swing
    // the balance the other way — the classic double-correction bug.
    const second = await as.mutation(api.onboarding.updateOpeningBalanceDate, {
      entityId: ids.entityId,
      startDate: "2026-04-01",
    });
    expect(second.reversedEntries).toBe(0);
    expect(await accountNetMinor(t, ids.bankLedgerId)).toBe(0);
    expect(await accountNetMinor(t, ids.softwareId)).toBe(0);
  });

  it("leaves a locked period untouched and reports it", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await postedTransaction(t, ids, {
      date: "2025-12-01",
      amountMinor: 40_000,
      merchant: "Closed Month Vendor",
      externalId: "ext-locked-1",
    });

    const as = authed(t, ids.userId, ids.email);
    await as.mutation(api.ledger.setPeriodLock, {
      entityId: ids.entityId,
      lockedThroughDate: "2025-12-31",
    });

    const outcome = await reBaseToCompletion(t, ids, { startDate: "2026-04-01" });

    // A closed month must not move, and the caller must be told so rather than
    // being left to assume the re-base was total.
    expect(outcome.lockedEntries).toBe(1);
    expect(outcome.reversedEntries).toBe(0);
    expect(await accountNetMinor(t, ids.bankLedgerId)).toBe(-40_000);
    // The transaction still leaves the working set even though its entry stands.
    expect(outcome.archivedTransactions).toBe(1);
  });

  it("replaces the bank-linked opening balance instead of stacking a second one", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const as = authed(t, ids.userId, ids.email);

    // Linking a bank posts its own opening balance from the bank's CURRENT
    // balance, tagged `opening:<plaidAccountId>`. Reproduce that here.
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.bankAccountId, { plaidAccountId: "plaid-acct-1" });
    });
    await as.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-08-01",
      memo: "Opening balance for Operating Checking",
      source: "manual",
      sourceId: "opening:plaid-acct-1",
      lines: [
        { accountId: ids.bankLedgerId, debitMinor: 32_000, creditMinor: 0 },
        { accountId: ids.openingEquityId, debitMinor: 0, creditMinor: 32_000 },
      ],
    });
    expect(await accountNetMinor(t, ids.bankLedgerId)).toBe(32_000);

    // Now set a real opening balance: the bank's closing position the day
    // before the books start.
    const outcome = await as.mutation(api.onboarding.updateOpeningBalanceDate, {
      entityId: ids.entityId,
      startDate: "2026-04-01",
      balanceMinor: 15_000,
    });

    expect(outcome.replacedOpeningEntries).toBe(1);
    expect(outcome.posted).toBe(true);
    // 32,000 stale entry reversed, 15,000 correct entry posted. Not 47,000.
    expect(await accountNetMinor(t, ids.bankLedgerId)).toBe(15_000);
    expect(await accountNetMinor(t, ids.openingEquityId)).toBe(-15_000);
  });

  it("lets a corrected opening balance replace one it already posted", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const as = authed(t, ids.userId, ids.email);

    await as.mutation(api.onboarding.updateOpeningBalanceDate, {
      entityId: ids.entityId,
      startDate: "2026-04-01",
      balanceMinor: 15_000,
    });
    expect(await accountNetMinor(t, ids.bankLedgerId)).toBe(15_000);

    // Owner realises they used the wrong figure. Re-applying must land the new
    // amount, not silently no-op on the idempotency tag and not stack on it.
    const corrected = await as.mutation(api.onboarding.updateOpeningBalanceDate, {
      entityId: ids.entityId,
      startDate: "2026-04-01",
      balanceMinor: 21_500,
    });

    expect(corrected.replacedOpeningEntries).toBe(1);
    expect(corrected.posted).toBe(true);
    expect(await accountNetMinor(t, ids.bankLedgerId)).toBe(21_500);
  });

  it("refuses to post or queue activity that arrives dated before the cutoff", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.entityId, { openingBalanceDate: "2026-04-01" });
    });

    const as = authed(t, ids.userId, ids.email);
    const late = await as.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2025-08-14",
      amountMinor: -12_345,
      currency: "USD",
      merchant: "Back-filled Vendor",
      rawDescription: "BACKFILL VENDOR",
      status: "posted",
      source: "bank",
      externalId: "ext-backfill-1",
    });

    expect(late.status).toBe("excluded");
    expect(late.entryId).toBeNull();

    await t.run(async (ctx) => {
      // Stored (so re-syncs dedupe against it) but never part of the books.
      const stored = await ctx.db.get(late.transactionId);
      expect(stored?.review).toBe("excluded");
      expect(stored?.entryId).toBeUndefined();

      const lines = await ctx.db
        .query("journalLines")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      expect(lines).toHaveLength(0);

      const items = await ctx.db
        .query("inboxItems")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      expect(items).toHaveLength(0);
    });

    // A transaction ON the cutoff date is kept — the boundary is inclusive.
    const onCutoff = await as.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-04-01",
      amountMinor: -5_000,
      currency: "USD",
      merchant: "Boundary Vendor",
      rawDescription: "BOUNDARY VENDOR",
      status: "posted",
      source: "bank",
      externalId: "ext-boundary-1",
    });
    expect(onCutoff.status).not.toBe("excluded");
  });
});
