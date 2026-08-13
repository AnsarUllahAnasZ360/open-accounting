/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// ---------------------------------------------------------------------------
// V6 — one number, everywhere (remediation plan §5).
//
// THE BUG THIS EXISTS FOR. An owner re-based their books to start in January and
// Streams still reported ~300k of revenue while the P&L reported ~80k. Same
// business, same books, two screens, two answers. The cause was that the cutoff
// was enforced on 7 read paths out of ~38; `streamViews` was not one of them.
//
// The contract asserted here: on a re-based book, EVERY revenue surface reports
// the same figure, and that figure is the working set only.
//
//   streamViews.streamPnl        — Streams
//   reportViews.reportPack       — Profit & Loss
//   coreViews.dashboard.metrics  — Dashboard tiles
//
// Also asserted: the pre-cutoff period is still READABLE via the archived
// window (decision D1 — Xero/QuickBooks keep pre-conversion data reachable
// rather than hidden). Data was re-based, not destroyed.
//
// Dates are fixed and the report range is explicit. `streamPnl` otherwise
// defaults its range to the CURRENT CALENDAR YEAR, which would hide this bug
// whenever the books happen to start in January — the exact coincidence that let
// it ship.
// ---------------------------------------------------------------------------

const CUTOFF = "2026-04-01";
const RANGE = { startDate: "2026-01-01", endDate: "2026-12-31" };

// Pre-cutoff income: inside the report range, but before the books start.
// The invoice leg is the one only the cutoff can exclude — see `openInvoice`.
const PRE_CUTOFF_TXN_MINOR = 250_000 + 150_000; // $4,000.00 of bank receipts
const PRE_CUTOFF_INVOICE_MINOR = 175_000; //       $1,750.00 issued, still unpaid
const PRE_CUTOFF_MINOR = PRE_CUTOFF_TXN_MINOR + PRE_CUTOFF_INVOICE_MINOR;
// Post-cutoff income: the only revenue the books should report.
const POST_CUTOFF_MINOR = 300_000 + 200_000; // $5,000.00

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
      name: "Streams cutoff workspace",
      slug: "streams-cutoff-workspace",
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
      name: "Streams Co",
      slug: "streams-co",
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
      type: "asset" | "income" | "equity",
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
    const arLedgerId = await account("Accounts Receivable", "1100", "asset", "receivable");
    const incomeId = await account("Sales", "4000", "income", "sales");
    // 3900 must exist for the re-base to post an opening balance at all.
    await account("Opening Balance Equity", "3900", "equity", "equity");

    const contactId = await ctx.db.insert("contacts", {
      entityId,
      name: "Wayne Enterprises",
      roles: ["customer"],
      aliases: [],
      createdAt: now,
      updatedAt: now,
    });

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
      arLedgerId,
      incomeId,
      bankAccountId,
      contactId,
    };
  });
}

type Ids = Awaited<ReturnType<typeof setup>>;

/**
 * Book one income receipt the way a confirmed bank deposit lands: a real posted
 * entry (Dr Bank / Cr Sales) through `ledger.postEntry`, plus the `transactions`
 * row carrying `categoryAccountId`.
 *
 * BOTH sides matter. The P&L and the dashboard read the JOURNAL; Streams reads
 * the TRANSACTION's category. A fixture that wrote only one of them could not
 * detect the two disagreeing, which is the entire point of this test.
 */
async function postedIncome(
  t: TestConvex<typeof schema>,
  ids: Ids,
  args: { date: string; amountMinor: number; merchant: string; externalId: string },
) {
  const as = authed(t, ids.userId, ids.email);
  const entry = await as.mutation(api.ledger.postEntry, {
    entityId: ids.entityId,
    date: args.date,
    memo: `${args.merchant} - income`,
    source: "bank",
    lines: [
      { accountId: ids.bankLedgerId, debitMinor: args.amountMinor, creditMinor: 0 },
      { accountId: ids.incomeId, debitMinor: 0, creditMinor: args.amountMinor },
    ],
  });

  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("transactions", {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: args.date,
      amountMinor: args.amountMinor,
      currency: "USD",
      merchant: args.merchant,
      rawDescription: args.merchant,
      status: "posted",
      review: "confirmed",
      source: "bank",
      externalId: args.externalId,
      categoryAccountId: ids.incomeId,
      entryId: entry.entryId,
      evalSet: false,
      createdAt: now,
      updatedAt: now,
    });
  });
}

/**
 * Issue an open invoice the way `invoices.finalize` does: Dr A/R, Cr Sales, plus
 * the `invoices` row.
 *
 * THIS IS THE PATH WITH TEETH. The re-base sweep touches journalEntries,
 * transactions and inboxItems — it does NOT touch invoices, and it does not stamp
 * them `excluded`. So a pre-cutoff INVOICE is excluded from Streams by the cutoff
 * bound and by nothing else.
 *
 * A fixture of transactions alone cannot prove the fix: the sweep marks those
 * `excluded`, and `streamPnl` already skipped excluded rows before any of this
 * work. Verified by mutation testing — reverting the cutoff bound left a
 * transaction-only version of this test green.
 */
async function openInvoice(
  t: TestConvex<typeof schema>,
  ids: Ids,
  args: { issueDate: string; dueDate: string; amountMinor: number; number: string },
) {
  const as = authed(t, ids.userId, ids.email);
  const entry = await as.mutation(api.ledger.postEntry, {
    entityId: ids.entityId,
    date: args.issueDate,
    memo: `Invoice ${args.number}`,
    source: "manual",
    lines: [
      { accountId: ids.arLedgerId, debitMinor: args.amountMinor, creditMinor: 0 },
      { accountId: ids.incomeId, debitMinor: 0, creditMinor: args.amountMinor },
    ],
  });

  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("invoices", {
      entityId: ids.entityId,
      contactId: ids.contactId,
      number: args.number,
      status: "open",
      currency: "USD",
      issueDate: args.issueDate,
      dueDate: args.dueDate,
      totalMinor: args.amountMinor,
      amountPaidMinor: 0,
      entryIds: [entry.entryId],
      createdAt: now,
      updatedAt: now,
    });
  });
}

/** Set the cutoff and run the sweep to completion, as the Settings screen does. */
async function reBaseToCompletion(t: TestConvex<typeof schema>, ids: Ids, startDate: string) {
  const as = authed(t, ids.userId, ids.email);
  const first = await as.mutation(api.onboarding.updateOpeningBalanceDate, {
    entityId: ids.entityId,
    startDate,
  });
  let { phase, cursor, done } = first;
  let passes = 0;
  while (!done && passes < 100) {
    passes += 1;
    const next = await as.mutation(api.onboarding.continueOpeningBalanceCutoff, {
      entityId: ids.entityId,
      phase,
      cursor,
    });
    phase = next.phase;
    cursor = next.cursor;
    done = next.done;
  }
  if (!done) throw new Error("Cutoff sweep did not converge within 100 passes.");
}

/** The three revenue figures an owner can see, read the way each screen reads them. */
async function revenueAcrossSurfaces(t: TestConvex<typeof schema>, ids: Ids) {
  const as = authed(t, ids.userId, ids.email);

  const streams = await as.query(api.streamViews.streamPnl, {
    entityId: ids.entityId,
    ...RANGE,
  });
  const pack = await as.query(api.reportViews.reportPack, {
    entityId: ids.entityId,
    ...RANGE,
    basis: "accrual",
    compare: "none",
    columnMode: "monthly",
  });
  const dash = await as.query(api.coreViews.dashboard, { entityId: ids.entityId });

  return {
    streams: streams.totals.revenueMinor,
    profitAndLoss: pack.profitAndLoss.incomeMinor,
    dashboard: dash!.metrics.revenueMinor,
  };
}

async function seedBothSides(t: TestConvex<typeof schema>, ids: Ids) {
  // Before the books start — inside the report range, so only the CUTOFF can
  // exclude these. A date-range filter would not.
  await postedIncome(t, ids, {
    date: "2026-02-10",
    amountMinor: 250_000,
    merchant: "Acme Corp",
    externalId: "pre-1",
  });
  await postedIncome(t, ids, {
    date: "2026-02-20",
    amountMinor: 150_000,
    merchant: "Globex",
    externalId: "pre-2",
  });
  // The decisive row: an invoice issued before the books start. The sweep never
  // marks invoices `excluded`, so ONLY the cutoff keeps this out of Streams.
  await openInvoice(t, ids, {
    issueDate: "2026-02-25",
    dueDate: "2026-03-25",
    amountMinor: PRE_CUTOFF_INVOICE_MINOR,
    number: "OB-1000",
  });
  // On and after the books start.
  await postedIncome(t, ids, {
    date: "2026-05-10",
    amountMinor: 300_000,
    merchant: "Initech",
    externalId: "post-1",
  });
  await postedIncome(t, ids, {
    date: "2026-06-15",
    amountMinor: 200_000,
    merchant: "Umbrella",
    externalId: "post-2",
  });
}

describe("V6 — revenue agrees across every surface on a re-based book", () => {
  it("reports the same total on Streams, the P&L and the Dashboard before any re-base", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await seedBothSides(t, ids);

    const totals = await revenueAcrossSurfaces(t, ids);

    // Baseline: with no cutoff set, all three see everything. This proves the
    // three figures are genuinely comparable, so a later disagreement is a real
    // defect and not three surfaces measuring different things.
    expect(totals.streams).toBe(PRE_CUTOFF_MINOR + POST_CUTOFF_MINOR);
    expect(totals.profitAndLoss).toBe(PRE_CUTOFF_MINOR + POST_CUTOFF_MINOR);
    expect(totals.dashboard).toBe(PRE_CUTOFF_MINOR + POST_CUTOFF_MINOR);
  });

  it("reports ONLY post-cutoff revenue, identically, on all three surfaces after a re-base", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await seedBothSides(t, ids);
    await reBaseToCompletion(t, ids, CUTOFF);

    const totals = await revenueAcrossSurfaces(t, ids);

    // The V6 contract: one number, everywhere.
    expect(totals.streams).toBe(POST_CUTOFF_MINOR);
    expect(totals.profitAndLoss).toBe(POST_CUTOFF_MINOR);
    expect(totals.dashboard).toBe(POST_CUTOFF_MINOR);

    // And they agree with each other, stated directly — this is the assertion
    // that would have caught 300k-on-Streams vs 80k-on-the-P&L.
    expect(totals.streams).toBe(totals.profitAndLoss);
    expect(totals.streams).toBe(totals.dashboard);
  });

  it("does not let Streams report the pre-cutoff history the owner re-based away", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await seedBothSides(t, ids);
    await reBaseToCompletion(t, ids, CUTOFF);

    const totals = await revenueAcrossSurfaces(t, ids);

    // The specific regression, stated as its own expectation so a failure names
    // the actual bug rather than an anonymous number mismatch.
    //
    // Compared against the P&L rather than against a constant: the reported
    // symptom was Streams reading HIGHER than the P&L on the same books. A
    // "less than the all-time total" assertion is too weak to catch a partial
    // leak — it stayed green under mutation testing while Streams over-reported
    // by the full pre-cutoff invoice.
    expect(totals.streams).toBe(totals.profitAndLoss);
    expect(totals.streams).toBeLessThan(PRE_CUTOFF_MINOR + POST_CUTOFF_MINOR);
  });

  it("keeps the archived period readable rather than deleting it (decision D1)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await seedBothSides(t, ids);
    await reBaseToCompletion(t, ids, CUTOFF);

    const as = authed(t, ids.userId, ids.email);
    const archived = await as.query(api.streamViews.streamPnl, {
      entityId: ids.entityId,
      ...RANGE,
      window: "archived",
    });

    // Re-basing moves history out of the working set; it must not destroy it.
    // This is what the Archived toggle will read.
    expect(archived.totals.revenueMinor).toBe(PRE_CUTOFF_MINOR);
    expect(archived.booksStartDate).toBe(CUTOFF);

    // The two windows partition the books: nothing is counted twice, nothing
    // vanishes.
    const working = await as.query(api.streamViews.streamPnl, {
      entityId: ids.entityId,
      ...RANGE,
    });
    expect(working.totals.revenueMinor + archived.totals.revenueMinor).toBe(
      PRE_CUTOFF_MINOR + POST_CUTOFF_MINOR,
    );
  });
});

describe("archived rows are read-only, enforced on the server", () => {
  it("refuses to re-categorize a pre-cutoff transaction, and still allows a post-cutoff one", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const preCutoffTxn = await postedIncome(t, ids, {
      date: "2026-02-10",
      amountMinor: 250_000,
      merchant: "Acme Corp",
      externalId: "pre-1",
    });
    const postCutoffTxn = await postedIncome(t, ids, {
      date: "2026-05-10",
      amountMinor: 300_000,
      merchant: "Initech",
      externalId: "post-1",
    });
    await reBaseToCompletion(t, ids, CUTOFF);

    const as = authed(t, ids.userId, ids.email);

    // The archived row's journal entry has already been reversed. Re-categorising
    // it would put the activity back on the books with no matching opening
    // balance leg — so the mutation must refuse, not merely be hidden in the UI.
    await expect(
      as.mutation(api.pipeline.recategorizeTransaction, {
        transactionId: preCutoffTxn,
        categoryAccountId: ids.incomeId,
      }),
    ).rejects.toThrow(/books start/i);

    // The guard must be narrow: a working-set row is still fully editable.
    await expect(
      as.mutation(api.pipeline.recategorizeTransaction, {
        transactionId: postCutoffTxn,
        categoryAccountId: ids.incomeId,
      }),
    ).resolves.toBeDefined();
  });

  it("says WHY it refused, naming the books-start date", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const preCutoffTxn = await postedIncome(t, ids, {
      date: "2026-02-10",
      amountMinor: 250_000,
      merchant: "Acme Corp",
      externalId: "pre-1",
    });
    await reBaseToCompletion(t, ids, CUTOFF);

    const as = authed(t, ids.userId, ids.email);
    // An owner who clicks through to an archived row deserves the reason and the
    // way out, not a bare "forbidden".
    await expect(
      as.mutation(api.pipeline.recategorizeTransaction, {
        transactionId: preCutoffTxn,
        categoryAccountId: ids.incomeId,
      }),
    ).rejects.toThrow(new RegExp(CUTOFF));
  });
});
