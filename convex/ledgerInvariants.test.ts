/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// ---------------------------------------------------------------------------
// E14-T1 / E14-T3 — Accounting invariant net for the USD-only general ledger.
//
// The OpenBooks general ledger is USD-ONLY (decided: decisions.md Q76 / Ansar
// #3). There is no multi-currency GL and no FX engine; multi-currency survives
// ONLY inside payroll's convert-to-USD math (covered by E10). So these tests
// prove the single-currency truth and DO NOT guard a per-currency trial
// balance — that defect class (the old "RC8 currency-blind sum") is retired
// with the USD-only decision, not targeted here.
//
// Every assertion runs against the REAL posting path — api.ledger.postEntry ->
// postLedgerEntryCore (convex/ledger.ts) — and against an in-memory convex-test
// instance, so NO shared/real book is ever mutated.
// ---------------------------------------------------------------------------

const modules = import.meta.glob("./**/*.ts");

type LedgerIds = Awaited<ReturnType<typeof setupLedger>>;

async function setupLedger(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      email: "owner@example.com",
      name: "Owner",
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Invariant workspace",
      slug: "invariant-workspace",
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
    // USD entity (currency locked to USD per the USD-only GL decision).
    const entityId = await ctx.db.insert("entities", {
      workspaceId,
      name: "Invariant LLC",
      slug: "invariant-llc",
      businessType: "services",
      currency: "USD",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
    // A minimal USD chart: one asset (cash) plus an equity + two expense
    // accounts so we can post both contribution-style and spend-style entries.
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
    const equityId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Owner's Equity",
      type: "equity",
      subtype: "equity",
      number: "3000",
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
    return { userId, workspaceId, entityId, cashId, equityId, softwareId, officeId };
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

/**
 * Compute the trial balance directly from the journalLines table inside a
 * t.run, independent of the report/snapshot layer. Returns the USD difference
 * (Σdebit − Σcredit across every line on the entity), which MUST be 0 for a
 * balanced book, plus a per-account net map.
 */
async function trialBalanceFromLines(
  t: TestConvex<typeof schema>,
  entityId: Id<"entities">,
) {
  // t.run must return Convex-serializable values, so we return the raw line
  // rows (id/debit/credit) and aggregate in plain JS in the test process.
  const rows = await t.run(async (ctx) => {
    const lines = await ctx.db
      .query("journalLines")
      .withIndex("by_entity", (q) => q.eq("entityId", entityId))
      .collect();
    return lines.map((line) => ({
      accountId: line.accountId,
      debitMinor: line.debitMinor,
      creditMinor: line.creditMinor,
    }));
  });
  let totalDebit = 0;
  let totalCredit = 0;
  const byAccount = new Map<Id<"ledgerAccounts">, number>();
  for (const line of rows) {
    totalDebit += line.debitMinor;
    totalCredit += line.creditMinor;
    byAccount.set(
      line.accountId,
      (byAccount.get(line.accountId) ?? 0) + line.debitMinor - line.creditMinor,
    );
  }
  return {
    totalDebitMinor: totalDebit,
    totalCreditMinor: totalCredit,
    differenceMinor: totalDebit - totalCredit,
    byAccount,
    lineCount: rows.length,
  };
}

// Deterministic LCG PRNG (mirrors the seeded pattern in convex/ledger.test.ts)
// so the "random" entries are reproducible on every CI run.
function makePrng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe("E14-T1 ledger invariants (USD-only general ledger)", () => {
  it("Test 1 — balanced property: every posted entry has debitTotal === creditTotal", async () => {
    const t = convexTest(schema, modules);
    const ids: LedgerIds = await setupLedger(t);
    const session = authed(t, ids.userId);
    const next = makePrng(7);

    for (let index = 0; index < 20; index += 1) {
      const amountMinor = 100 + Math.floor(next() * 25_000);
      const expenseAccountId = next() > 0.5 ? ids.softwareId : ids.officeId;
      const result = await session.mutation(api.ledger.postEntry, {
        entityId: ids.entityId,
        date: `2026-03-${String((index % 28) + 1).padStart(2, "0")}`,
        memo: `Balanced entry ${index + 1}`,
        source: "manual",
        lines: [
          { accountId: expenseAccountId, debitMinor: amountMinor, creditMinor: 0, currency: "USD" },
          { accountId: ids.cashId, debitMinor: 0, creditMinor: amountMinor, currency: "USD" },
        ],
      });
      expect(result.debitTotal).toBe(result.creditTotal);
      expect(result.debitTotal).toBe(amountMinor);
    }
  });

  it("Test 1 — rejects an unbalanced entry (Σdebit ≠ Σcredit)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupLedger(t);
    const session = authed(t, ids.userId);

    await expect(
      session.mutation(api.ledger.postEntry, {
        entityId: ids.entityId,
        date: "2026-03-01",
        memo: "Unbalanced",
        source: "manual",
        lines: [
          { accountId: ids.cashId, debitMinor: 10_000, creditMinor: 0, currency: "USD" },
          { accountId: ids.equityId, debitMinor: 0, creditMinor: 9_000, currency: "USD" },
        ],
      }),
    ).rejects.toThrow("debits must equal credits");
  });

  it("Test 1 — rejects a single-side-zero line (a line with neither or both sides)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupLedger(t);
    const session = authed(t, ids.userId);

    // A line with BOTH debit and credit > 0 is not a clean debit-xor-credit.
    await expect(
      session.mutation(api.ledger.postEntry, {
        entityId: ids.entityId,
        date: "2026-03-02",
        memo: "Both sides",
        source: "manual",
        lines: [
          { accountId: ids.cashId, debitMinor: 5_000, creditMinor: 5_000, currency: "USD" },
          { accountId: ids.equityId, debitMinor: 0, creditMinor: 5_000, currency: "USD" },
        ],
      }),
    ).rejects.toThrow("exactly one debit or one credit");

    // A line with neither side (both zero) is rejected the same way.
    await expect(
      session.mutation(api.ledger.postEntry, {
        entityId: ids.entityId,
        date: "2026-03-03",
        memo: "Empty line",
        source: "manual",
        lines: [
          { accountId: ids.cashId, debitMinor: 0, creditMinor: 0, currency: "USD" },
          { accountId: ids.equityId, debitMinor: 0, creditMinor: 0, currency: "USD" },
        ],
      }),
    ).rejects.toThrow("exactly one debit or one credit");
  });

  it("Test 2 — USD trial balance differenceMinor is exactly 0 (snapshot + direct line query)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupLedger(t);
    const session = authed(t, ids.userId);

    await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-04-01",
      memo: "Owner contribution",
      source: "manual",
      lines: [
        { accountId: ids.cashId, debitMinor: 500_000, creditMinor: 0, currency: "USD" },
        { accountId: ids.equityId, debitMinor: 0, creditMinor: 500_000, currency: "USD" },
      ],
    });
    await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-04-05",
      memo: "Split spend",
      source: "manual",
      lines: [
        { accountId: ids.softwareId, debitMinor: 60_000, creditMinor: 0, currency: "USD" },
        { accountId: ids.officeId, debitMinor: 40_000, creditMinor: 0, currency: "USD" },
        { accountId: ids.cashId, debitMinor: 0, creditMinor: 100_000, currency: "USD" },
      ],
    });

    // (a) via the report/snapshot layer
    const snapshot = await session.query(api.ledger.accountingSnapshot, {});
    expect(snapshot.trialBalance.differenceMinor).toBe(0);

    // (b) cross-checked directly from journalLines, independent of the report layer
    const direct = await trialBalanceFromLines(t, ids.entityId);
    expect(direct.differenceMinor).toBe(0);
    expect(direct.totalDebitMinor).toBe(direct.totalCreditMinor);
    // Sanity: cash net is the contribution less the split spend.
    expect(direct.byAccount.get(ids.cashId)).toBe(500_000 - 100_000);
  });

  it("Test 3 — USD-only guard: a non-USD entity currency is rejected at creation (currency is locked to USD)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupLedger(t);
    const session = authed(t, ids.userId);

    // entities.createEntity is the single business-creation path; it locks the
    // base currency to USD (convex/entities.ts). A non-USD book can never exist,
    // so the ledger never has to admit a non-USD journal line.
    await expect(
      session.mutation(api.entities.create, {
        name: "Euro Books",
        businessType: "services",
        currency: "EUR",
      }),
    ).rejects.toThrow("USD-only");

    // A USD business is accepted.
    const created = await session.mutation(api.entities.create, {
      name: "Dollar Books",
      businessType: "services",
      currency: "usd",
    });
    expect(created.entityId).toBeDefined();
  });

  it("Test 3 — no remaining fxRate dependency: posted journal lines never write fxRate", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupLedger(t);
    const session = authed(t, ids.userId);

    await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-04-10",
      memo: "USD spend",
      source: "manual",
      lines: [
        { accountId: ids.softwareId, debitMinor: 12_345, creditMinor: 0, currency: "USD" },
        { accountId: ids.cashId, debitMinor: 0, creditMinor: 12_345, currency: "USD" },
      ],
    });

    // The dead `journalLines.fxRate` field is never populated by the USD-only
    // ledger path. Every posted line stays USD with fxRate undefined.
    const lines = await t.run(async (ctx) =>
      ctx.db
        .query("journalLines")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect(),
    );
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(line.currency).toBe("USD");
      expect(line.fxRate).toBeUndefined();
    }
  });

  it("Test 4 — deterministic 50-iteration fuzz keeps the USD trial balance at zero throughout", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupLedger(t);
    const session = authed(t, ids.userId);
    const next = makePrng(20260601);

    const expenseAccounts = [ids.softwareId, ids.officeId];

    for (let index = 0; index < 50; index += 1) {
      const roll = next();
      if (roll < 0.4) {
        // Owner contribution: Dr Cash / Cr Equity.
        const amountMinor = 1_000 + Math.floor(next() * 90_000);
        await session.mutation(api.ledger.postEntry, {
          entityId: ids.entityId,
          date: `2026-05-${String((index % 28) + 1).padStart(2, "0")}`,
          memo: `Contribution ${index + 1}`,
          source: "manual",
          lines: [
            { accountId: ids.cashId, debitMinor: amountMinor, creditMinor: 0, currency: "USD" },
            { accountId: ids.equityId, debitMinor: 0, creditMinor: amountMinor, currency: "USD" },
          ],
        });
      } else if (roll < 0.75) {
        // Single-account spend: Dr Expense / Cr Cash.
        const amountMinor = 100 + Math.floor(next() * 40_000);
        const expenseAccountId = expenseAccounts[Math.floor(next() * expenseAccounts.length)];
        await session.mutation(api.ledger.postEntry, {
          entityId: ids.entityId,
          date: `2026-05-${String((index % 28) + 1).padStart(2, "0")}`,
          memo: `Spend ${index + 1}`,
          source: "manual",
          lines: [
            { accountId: expenseAccountId, debitMinor: amountMinor, creditMinor: 0, currency: "USD" },
            { accountId: ids.cashId, debitMinor: 0, creditMinor: amountMinor, currency: "USD" },
          ],
        });
      } else {
        // Split spend across two expense accounts: Dr A + Dr B / Cr Cash.
        const partA = 100 + Math.floor(next() * 20_000);
        const partB = 100 + Math.floor(next() * 20_000);
        await session.mutation(api.ledger.postEntry, {
          entityId: ids.entityId,
          date: `2026-05-${String((index % 28) + 1).padStart(2, "0")}`,
          memo: `Split ${index + 1}`,
          source: "manual",
          lines: [
            { accountId: ids.softwareId, debitMinor: partA, creditMinor: 0, currency: "USD" },
            { accountId: ids.officeId, debitMinor: partB, creditMinor: 0, currency: "USD" },
            { accountId: ids.cashId, debitMinor: 0, creditMinor: partA + partB, currency: "USD" },
          ],
        });
      }

      // After EVERY iteration the USD trial balance must still net to zero.
      const direct = await trialBalanceFromLines(t, ids.entityId);
      expect(direct.differenceMinor).toBe(0);
    }

    // And once more via the report layer at the end.
    const snapshot = await session.query(api.ledger.accountingSnapshot, {});
    expect(snapshot.trialBalance.differenceMinor).toBe(0);
  });
});
