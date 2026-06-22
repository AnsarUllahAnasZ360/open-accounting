/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// ---------------------------------------------------------------------------
// E14-T3 — Reversal-is-exact-inverse, immutability, and the post-truncation
// report-balance invariant for the USD-only general ledger.
//
// Posted journal entries are IMMUTABLE; a correction REVERSES (exact line-by-
// line inverse) and REPOSTS. These tests prove (1) a reversal is the exact
// debit↔credit swap of its original and returns every affected account to its
// pre-original balance, (2) the original entry + its lines are byte-for-byte
// unchanged after reverse + repost, and (3) the report trial balance stays
// zero past the 5000-row truncation cliff.
//
// RC5 / E1-T5 note: the real truncation FIX (whole-entry, date-ordered loading
// so a report never drops one leg of a balanced posting) is owned by E1-T5 and
// has LANDED on this branch — `loadJournalThroughDate` (convex/reportViews.ts)
// now loads journal lines by ENTRY via the `by_entry` index, capped by entry,
// not by a flat `.take(5000)` over rows. This test is the regression gate that
// the E1-T5 fix must keep satisfying: it is GREEN now (was the red-until-fixed
// guard the ticket described). E6 only surfaces the truncation banner.
// ---------------------------------------------------------------------------

const modules = import.meta.glob("./**/*.ts");

async function setupLedger(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      email: "owner@example.com",
      name: "Owner",
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Reversal workspace",
      slug: "reversal-workspace",
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
      name: "Reversal LLC",
      slug: "reversal-llc",
      businessType: "services",
      currency: "USD",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
    const cashId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Operating Checking",
      type: "asset",
      subtype: "bank",
      number: "1010",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const softwareId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Software & SaaS",
      type: "expense",
      subtype: "software",
      number: "5200",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const officeId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Office & Supplies",
      type: "expense",
      subtype: "office",
      number: "6000",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, workspaceId, entityId, cashId, softwareId, officeId };
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

/** Net (Σdebit − Σcredit) for one account, computed from journalLines. */
async function accountNet(
  t: TestConvex<typeof schema>,
  accountId: Id<"ledgerAccounts">,
) {
  const lines = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("journalLines")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect()
    ).map((line) => ({ debitMinor: line.debitMinor, creditMinor: line.creditMinor })),
  );
  return lines.reduce((sum, line) => sum + line.debitMinor - line.creditMinor, 0);
}

describe("E14-T3 reversal + immutability invariants", () => {
  it("a reversal is the exact line-by-line inverse and returns affected accounts to pre-original balances", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupLedger(t);
    const session = authed(t, ids.userId);

    // Pre-original balances (zero — fresh book).
    const softwareBefore = await accountNet(t, ids.softwareId);
    const cashBefore = await accountNet(t, ids.cashId);
    expect(softwareBefore).toBe(0);
    expect(cashBefore).toBe(0);

    // Post an original: Dr Software 100.00 / Cr Cash 100.00.
    const original = await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-01-15",
      memo: "Original categorization",
      source: "manual",
      lines: [
        { accountId: ids.softwareId, debitMinor: 10_000, creditMinor: 0, currency: "USD" },
        { accountId: ids.cashId, debitMinor: 0, creditMinor: 10_000, currency: "USD" },
      ],
    });

    expect(await accountNet(t, ids.softwareId)).toBe(10_000);
    expect(await accountNet(t, ids.cashId)).toBe(-10_000);

    // Reverse it via reversesEntryId — the lines MUST be the exact debit↔credit
    // swap (assertReversalLines at convex/ledger.ts enforces this; an inexact
    // reversal would be rejected).
    const reversal = await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-01-16",
      memo: "Reverse original categorization",
      source: "manual",
      reversesEntryId: original.entryId,
      lines: [
        { accountId: ids.softwareId, debitMinor: 0, creditMinor: 10_000, currency: "USD" },
        { accountId: ids.cashId, debitMinor: 10_000, creditMinor: 0, currency: "USD" },
      ],
    });

    // Affected accounts are back to their EXACT pre-original balances.
    expect(await accountNet(t, ids.softwareId)).toBe(softwareBefore);
    expect(await accountNet(t, ids.cashId)).toBe(cashBefore);

    // Prove the reversal lines are the exact set-wise inverse of the original.
    const { originalLines, reversalLines } = await t.run(async (ctx) => {
      const ol = await ctx.db
        .query("journalLines")
        .withIndex("by_entry", (q) => q.eq("entryId", original.entryId))
        .collect();
      const rl = await ctx.db
        .query("journalLines")
        .withIndex("by_entry", (q) => q.eq("entryId", reversal.entryId))
        .collect();
      return {
        originalLines: ol.map((l) => ({
          accountId: l.accountId,
          debitMinor: l.debitMinor,
          creditMinor: l.creditMinor,
        })),
        reversalLines: rl.map((l) => ({
          accountId: l.accountId,
          debitMinor: l.debitMinor,
          creditMinor: l.creditMinor,
        })),
      };
    });

    // Every original line has a matching reversal line with debit/credit swapped.
    const reversalKey = (l: { accountId: Id<"ledgerAccounts">; debitMinor: number; creditMinor: number }) =>
      `${l.accountId}:${l.debitMinor}:${l.creditMinor}`;
    const reversalKeys = new Set(reversalLines.map(reversalKey));
    expect(reversalLines.length).toBe(originalLines.length);
    for (const line of originalLines) {
      // The inverse line swaps debit and credit.
      const inverseKey = `${line.accountId}:${line.creditMinor}:${line.debitMinor}`;
      expect(reversalKeys.has(inverseKey)).toBe(true);
    }
  });

  it("the original entry and its lines are byte-for-byte unchanged after reverse + repost (immutability)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupLedger(t);
    const session = authed(t, ids.userId);

    const original = await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-02-01",
      memo: "Original to be corrected",
      source: "manual",
      lines: [
        { accountId: ids.softwareId, debitMinor: 25_000, creditMinor: 0, currency: "USD" },
        { accountId: ids.cashId, debitMinor: 0, creditMinor: 25_000, currency: "USD" },
      ],
    });

    // Snapshot the original entry + lines immediately after posting.
    const before = await t.run(async (ctx) => {
      const entry = await ctx.db.get(original.entryId);
      const lines = await ctx.db
        .query("journalLines")
        .withIndex("by_entry", (q) => q.eq("entryId", original.entryId))
        .collect();
      return { entry, lines };
    });

    // Reverse it, then repost a corrected split (Software 6000 + Office 4000 was
    // wrong; here we repost the full 25000 to Office to model a recategorization).
    await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-02-02",
      memo: "Reverse original to be corrected",
      source: "manual",
      reversesEntryId: original.entryId,
      lines: [
        { accountId: ids.softwareId, debitMinor: 0, creditMinor: 25_000, currency: "USD" },
        { accountId: ids.cashId, debitMinor: 25_000, creditMinor: 0, currency: "USD" },
      ],
    });
    await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-02-02",
      memo: "Repost corrected category",
      source: "manual",
      sourceId: original.entryId,
      lines: [
        { accountId: ids.officeId, debitMinor: 25_000, creditMinor: 0, currency: "USD" },
        { accountId: ids.cashId, debitMinor: 0, creditMinor: 25_000, currency: "USD" },
      ],
    });

    // Re-read the original entry + lines: they must be IDENTICAL — never edited,
    // never deleted.
    const after = await t.run(async (ctx) => {
      const entry = await ctx.db.get(original.entryId);
      const lines = await ctx.db
        .query("journalLines")
        .withIndex("by_entry", (q) => q.eq("entryId", original.entryId))
        .collect();
      return { entry, lines };
    });

    expect(after.entry).not.toBeNull();
    expect(after.entry).toEqual(before.entry);
    expect(after.lines.length).toBe(before.lines.length);
    // Field-for-field comparison of every original line.
    const sortById = <T extends { _id: Id<"journalLines"> }>(rows: T[]) =>
      [...rows].sort((a, b) => a._id.localeCompare(b._id));
    expect(sortById(after.lines)).toEqual(sortById(before.lines));
  });

  it("rejects a reversal whose lines are not the exact inverse of the original", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupLedger(t);
    const session = authed(t, ids.userId);

    const original = await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-03-01",
      memo: "Original",
      source: "manual",
      lines: [
        { accountId: ids.softwareId, debitMinor: 10_000, creditMinor: 0, currency: "USD" },
        { accountId: ids.cashId, debitMinor: 0, creditMinor: 10_000, currency: "USD" },
      ],
    });

    // A "reversal" with the wrong amount is rejected (must exactly invert).
    await expect(
      session.mutation(api.ledger.postEntry, {
        entityId: ids.entityId,
        date: "2026-03-02",
        memo: "Bad reversal",
        source: "manual",
        reversesEntryId: original.entryId,
        lines: [
          { accountId: ids.softwareId, debitMinor: 0, creditMinor: 9_000, currency: "USD" },
          { accountId: ids.cashId, debitMinor: 9_000, creditMinor: 0, currency: "USD" },
        ],
      }),
    ).rejects.toThrow("exactly invert");
  });
});

describe("E14-T3 post-truncation report-balance invariant (RC5 / E1-T5 gate)", () => {
  it("keeps the reported trial balance at zero with more than 5000 journal lines", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupLedger(t);
    const session = authed(t, ids.userId);

    // Build a large book: > 5000 balanced journal LINES on one entity. Each
    // entry has 2 lines (Dr expense / Cr cash), so 2600 entries = 5200 lines,
    // comfortably past the legacy 5000-row flat-load cliff. These are inserted
    // as TEST FIXTURE state directly in t.run (not production code) but stay
    // strictly balanced per entry so the invariant under test is meaningful.
    const ENTRY_COUNT = 2600; // 2600 * 2 = 5200 lines > REPORT_LIMIT (5000)
    const totalLines = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = ids.userId;
      for (let i = 0; i < ENTRY_COUNT; i += 1) {
        const amountMinor = 100 + (i % 500);
        // Date-spread across early 2026 so the by_entity_and_date loader walks
        // many distinct dates (the truncation cliff was date-order-sensitive).
        const day = (i % 28) + 1;
        const month = ((Math.floor(i / 28)) % 6) + 1; // months 1..6
        const date = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const entryId = await ctx.db.insert("journalEntries", {
          entityId: ids.entityId,
          date,
          memo: `Bulk balanced entry ${i + 1}`,
          source: "manual",
          postedByUserId: userId,
          locked: true,
          createdAt: now,
        });
        await ctx.db.insert("journalLines", {
          entityId: ids.entityId,
          entryId,
          accountId: ids.softwareId,
          debitMinor: amountMinor,
          creditMinor: 0,
          currency: "USD",
          createdAt: now,
        });
        await ctx.db.insert("journalLines", {
          entityId: ids.entityId,
          entryId,
          accountId: ids.cashId,
          debitMinor: 0,
          creditMinor: amountMinor,
          currency: "USD",
          createdAt: now,
        });
      }
      const lines = await ctx.db
        .query("journalLines")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      return lines.length;
    });

    // Guard: we genuinely crossed the 5000-row cliff.
    expect(totalLines).toBeGreaterThan(5000);

    // The report builder must still report a BALANCED trial balance — never drop
    // one leg of a balanced posting at the truncation boundary (RC5 / E1-T5).
    const pack = await session.query(api.reportViews.reportPack, {
      entityId: ids.entityId,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      basis: "accrual",
      compare: "none",
      columnMode: "total",
    });
    expect(pack.trialBalance.differenceMinor).toBe(0);
    expect(pack.trialBalance.totalDebitMinor).toBe(pack.trialBalance.totalCreditMinor);
    expect(pack.trialBalance.totalDebitMinor).toBeGreaterThan(0);
  });
});
