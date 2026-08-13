/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { verifyEntityBalances } from "./ledgerBalances";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// ---------------------------------------------------------------------------
// Materialised ledger balances.
//
// A derived total is only worth having if it provably agrees with the records it
// summarises. `journalLines` stays the system of record; these tests assert the
// running balance never disagrees with it — through posting, through corrections
// (which are reversals, not edits), and after a rebuild.
//
// They also assert the property that made this worth building: read cost is flat
// in the size of the book. Doubling the entries must not change how much the
// dashboard reads.
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
      name: "Balances workspace",
      slug: "balances-workspace",
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
      name: "Balances Co",
      slug: "balances-co",
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
      type: "asset" | "income" | "expense" | "equity",
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

    const bankId = await account("Operating Checking", "1010", "asset", "bank");
    const incomeId = await account("Sales", "4000", "income", "sales");
    const expenseId = await account("Software", "5200", "expense", "software");
    await account("Opening Balance Equity", "3900", "equity", "equity");

    return { email, userId, workspaceId, entityId, bankId, incomeId, expenseId };
  });
}

type Ids = Awaited<ReturnType<typeof setup>>;

async function postIncome(t: TestConvex<typeof schema>, ids: Ids, date: string, amountMinor: number) {
  const as = authed(t, ids.userId, ids.email);
  return await as.mutation(api.ledger.postEntry, {
    entityId: ids.entityId,
    date,
    memo: `Income ${date}`,
    source: "bank",
    lines: [
      { accountId: ids.bankId, debitMinor: amountMinor, creditMinor: 0 },
      { accountId: ids.incomeId, debitMinor: 0, creditMinor: amountMinor },
    ],
  });
}

/** Net (debit − credit) held on the materialised row for one account. */
async function storedNet(t: TestConvex<typeof schema>, ids: Ids, accountId: Id<"ledgerAccounts">) {
  return await t.run(async (ctx) => {
    const row = await ctx.db
      .query("accountBalances")
      .withIndex("by_entity_and_account", (q) =>
        q.eq("entityId", ids.entityId).eq("accountId", accountId),
      )
      .unique();
    return row ? row.debitMinor - row.creditMinor : 0;
  });
}

describe("materialised ledger balances", () => {
  it("agrees with the journal lines it summarises", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await postIncome(t, ids, "2026-02-10", 250_000);
    await postIncome(t, ids, "2026-03-05", 150_000);
    await postIncome(t, ids, "2026-03-20", 100_000);

    expect(await storedNet(t, ids, ids.bankId)).toBe(500_000);
    // Income carries a credit balance, so its debit-minus-credit net is negative.
    expect(await storedNet(t, ids, ids.incomeId)).toBe(-500_000);

    // The load-bearing assertion: stored totals equal a full recount of the lines.
    const verification = await t.run(async (ctx) => verifyEntityBalances(ctx, ids.entityId, 1000));
    expect(verification.truncated).toBe(false);
    expect(verification.mismatches).toEqual([]);
    expect(verification.matches).toBe(true);
  });

  it("buckets by the ENTRY date, not the wall clock", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await postIncome(t, ids, "2026-02-10", 250_000);
    await postIncome(t, ids, "2026-03-05", 150_000);

    const months = await t.run(async (ctx) =>
      ctx.db
        .query("accountMonthBalances")
        .withIndex("by_entity_and_month", (q) => q.eq("entityId", ids.entityId))
        .collect(),
    );
    const bankByMonth = new Map(
      months.filter((row) => row.accountId === ids.bankId).map((row) => [row.month, row.debitMinor]),
    );
    // A back-dated posting must land in the month it belongs to, or the P&L trend
    // and the trailing burn would both drift toward "whenever it was entered".
    expect(bankByMonth.get("2026-02")).toBe(250_000);
    expect(bankByMonth.get("2026-03")).toBe(150_000);
  });

  it("nets back out when an entry is reversed", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const posted = await postIncome(t, ids, "2026-02-10", 250_000);
    expect(await storedNet(t, ids, ids.bankId)).toBe(250_000);

    // Corrections are reversals, never edits. A reversal arrives through the same
    // posting path with mirrored legs, so the balance must return to zero with no
    // special handling anywhere.
    const as = authed(t, ids.userId, ids.email);
    await as.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-02-10",
      memo: "Reversal",
      source: "manual",
      reversesEntryId: posted.entryId,
      lines: [
        { accountId: ids.bankId, debitMinor: 0, creditMinor: 250_000 },
        { accountId: ids.incomeId, debitMinor: 250_000, creditMinor: 0 },
      ],
    });

    expect(await storedNet(t, ids, ids.bankId)).toBe(0);
    const verification = await t.run(async (ctx) => verifyEntityBalances(ctx, ids.entityId, 1000));
    expect(verification.matches).toBe(true);
  });

  it("aggregates repeated legs on one account into a single row", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const as = authed(t, ids.userId, ids.email);
    // A split posting touching the same account twice must cost one row, not two
    // — this is what keeps the bulk paths (imports, the cutoff sweep) inside a
    // mutation's budget.
    await as.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-02-10",
      memo: "Split expense",
      source: "manual",
      lines: [
        { accountId: ids.expenseId, debitMinor: 30_000, creditMinor: 0 },
        { accountId: ids.expenseId, debitMinor: 20_000, creditMinor: 0 },
        { accountId: ids.bankId, debitMinor: 0, creditMinor: 50_000 },
      ],
    });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("accountBalances")
        .withIndex("by_entity_and_account", (q) =>
          q.eq("entityId", ids.entityId).eq("accountId", ids.expenseId),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.debitMinor).toBe(50_000);
  });

  it("rebuilds from the lines and lands on the same numbers", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    await postIncome(t, ids, "2026-02-10", 250_000);
    await postIncome(t, ids, "2026-03-05", 150_000);

    // Corrupt the stored balance the way drift or a bad backfill would.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("accountBalances")
        .withIndex("by_entity_and_account", (q) =>
          q.eq("entityId", ids.entityId).eq("accountId", ids.bankId),
        )
        .unique();
      if (row) await ctx.db.patch(row._id, { debitMinor: 999_999 });
    });
    let broken = await t.run(async (ctx) => verifyEntityBalances(ctx, ids.entityId, 1000));
    expect(broken.matches).toBe(false);

    // Rebuild is resumable; loop until done, as a caller must.
    const as = authed(t, ids.userId, ids.email);
    let cursor: string | null = null;
    let done = false;
    let passes = 0;
    while (!done && passes < 50) {
      passes += 1;
      const result: { cursor: string | null; done: boolean } = await as.mutation(
        api.ledgerBalances.rebuildEntity,
        { entityId: ids.entityId, cursor },
      );
      cursor = result.cursor;
      done = result.done;
    }
    expect(done).toBe(true);

    const repaired = await t.run(async (ctx) => verifyEntityBalances(ctx, ids.entityId, 1000));
    expect(repaired.mismatches).toEqual([]);
    expect(repaired.matches).toBe(true);
    expect(await storedNet(t, ids, ids.bankId)).toBe(400_000);
  });

  it("reads a flat number of rows as the book grows", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    for (let i = 0; i < 40; i += 1) {
      await postIncome(t, ids, `2026-03-${String((i % 28) + 1).padStart(2, "0")}`, 1_000);
    }

    const balanceRows = await t.run(async (ctx) =>
      ctx.db
        .query("accountBalances")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect(),
    );
    // THE WHOLE POINT: 40 entries (80 lines) collapse to one row per touched
    // account. Double the entries and this number does not move — which is why
    // the dashboard no longer truncates.
    expect(balanceRows).toHaveLength(2);

    const verification = await t.run(async (ctx) => verifyEntityBalances(ctx, ids.entityId, 1000));
    expect(verification.matches).toBe(true);
  });
});
