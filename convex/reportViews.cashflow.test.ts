/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// E1-T5 — reports load whole-entry (date-ordered, capped by entry), so a large
// book never drops one leg of a balanced posting: trial balance still balances.
// E1-T6 — cash-flow statement is transfer/split aware: a self-transfer nets to
// zero, a multi-category split is allocated once, and operating/investing/
// financing classification is driven by the FULL set of counter-lines.

async function setup(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar's workspace", slug: "ansar-workspace", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", {
      workspaceId, userId, role: "owner", status: "active", createdAt: now, updatedAt: now,
    });
    const entityId = await ctx.db.insert("entities", {
      workspaceId, name: "Cashflow LLC", slug: "cashflow-llc", businessType: "services",
      currency: "USD", isDemo: false, archived: false, createdAt: now, updatedAt: now,
    });
    async function account(number: string, name: string, type: "asset" | "liability" | "equity" | "income" | "expense", subtype: string) {
      return await ctx.db.insert("ledgerAccounts", {
        entityId, number, name, type, subtype, currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now,
      });
    }
    const checking = await account("1010", "Operating Checking", "asset", "checking");
    const savings = await account("1020", "Savings", "asset", "savings");
    const equipment = await account("1500", "Equipment", "asset", "fixed");
    const loan = await account("2200", "Bank Loan", "liability", "loan");
    const services = await account("4000", "Services Revenue", "income", "services");
    const software = await account("5200", "Software & SaaS", "expense", "software");
    await ctx.db.insert("bankAccounts", { entityId, ledgerAccountId: checking, name: "Checking", mask: "1111", kind: "checking", balanceMinor: 0, includeInSync: true, createdAt: now, updatedAt: now });
    await ctx.db.insert("bankAccounts", { entityId, ledgerAccountId: savings, name: "Savings", mask: "2222", kind: "savings", balanceMinor: 0, includeInSync: true, createdAt: now, updatedAt: now });
    return { userId, entityId, checking, savings, equipment, loan, services, software, now };
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">) {
  return t.withIdentity({ subject: `${userId}|test-session`, tokenIdentifier: "test|cashflow", issuer: "test", email: "owner@example.com" });
}

const baseArgs = {
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  basis: "accrual" as const,
  compare: "none" as const,
  columnMode: "total" as const,
};

describe("cash-flow statement transfer/split correctness (E1-T6)", () => {
  it("nets a self-transfer to zero and allocates a split exactly once", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    // Cash inflow (income) — operating.
    await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId, date: "2026-01-05", memo: "Cash sale", source: "manual",
      lines: [
        { accountId: ids.checking, debitMinor: 100_00, creditMinor: 0, currency: "USD" },
        { accountId: ids.services, debitMinor: 0, creditMinor: 100_00, currency: "USD" },
      ],
    });
    // Checking -> savings self-transfer — must net to ZERO across all groups.
    await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId, date: "2026-01-08", memo: "Move to savings", source: "manual",
      lines: [
        { accountId: ids.savings, debitMinor: 40_00, creditMinor: 0, currency: "USD" },
        { accountId: ids.checking, debitMinor: 0, creditMinor: 40_00, currency: "USD" },
      ],
    });
    // 3-way split outflow: one cash leg pays software (expense) + equipment
    // (asset) + loan principal (liability). The single cash movement (-50.00)
    // must be allocated across operating/investing/financing exactly once.
    await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId, date: "2026-01-12", memo: "Split payment", source: "manual",
      lines: [
        { accountId: ids.software, debitMinor: 20_00, creditMinor: 0, currency: "USD" },
        { accountId: ids.equipment, debitMinor: 20_00, creditMinor: 0, currency: "USD" },
        { accountId: ids.loan, debitMinor: 10_00, creditMinor: 0, currency: "USD" },
        { accountId: ids.checking, debitMinor: 0, creditMinor: 50_00, currency: "USD" },
      ],
    });

    const pack = await session.query(api.reportViews.reportPack, { entityId: ids.entityId, ...baseArgs });

    const groups = Object.fromEntries(pack.cashFlow.groups.map((g) => [g.key, g.totalMinor]));
    // Operating = +100 income − 20 software = +80. Investing = −20 equipment.
    // Financing = −10 loan. The self-transfer contributes nothing.
    expect(groups.operating).toBe(80_00);
    expect(groups.investing).toBe(-20_00);
    expect(groups.financing).toBe(-10_00);

    // Group totals sum to net cash change, which equals closing − opening.
    expect(pack.cashFlow.netCashChangeMinor).toBe(50_00);
    expect(pack.cashFlow.netCashChangeMinor).toBe(
      pack.cashFlow.closingCashMinor - pack.cashFlow.openingCashMinor,
    );

    // No phantom transfer rows: the savings account should not appear at all in
    // the cash-flow rows (the transfer was netted out entirely).
    const allRows = pack.cashFlow.groups.flatMap((g) => g.rows);
    expect(allRows.some((row) => row.accountNumber === "1020")).toBe(false);
  });
});

describe("large-book report integrity (E1-T5)", () => {
  it("keeps the trial balance and balance sheet balanced on a book with >5,000 lines", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    // 3,000 balanced entries (6,000 lines) — over the old flat REPORT_LIMIT of
    // 5,000 that would have dropped one leg and broken the trial balance.
    await t.run(async (ctx) => {
      for (let i = 0; i < 3000; i++) {
        const entryId = await ctx.db.insert("journalEntries", {
          entityId: ids.entityId,
          date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
          memo: `bulk ${i}`,
          source: "manual",
          postedByUserId: ids.userId,
          locked: true,
          createdAt: ids.now + i,
        });
        await ctx.db.insert("journalLines", { entityId: ids.entityId, entryId, accountId: ids.checking, debitMinor: 1_00, creditMinor: 0, currency: "USD", createdAt: ids.now + i });
        await ctx.db.insert("journalLines", { entityId: ids.entityId, entryId, accountId: ids.services, debitMinor: 0, creditMinor: 1_00, currency: "USD", createdAt: ids.now + i });
      }
    });

    const pack = await session.query(api.reportViews.reportPack, { entityId: ids.entityId, ...baseArgs });

    // Both sides of every entry were loaded → still balanced, never truncated.
    expect(pack.trialBalance.differenceMinor).toBe(0);
    expect(pack.balanceSheet.balanced).toBe(true);
    expect(pack.balanceSheet.differenceMinor).toBe(0);
    expect(pack.limits.truncated).toBe(false);
    expect(pack.profitAndLoss.incomeMinor).toBe(3000_00);
    // All 6,000 lines were loaded whole-entry (no flat 5,000 cap).
    expect(pack.limits.rowCounts.journalLines).toBe(6000);
  });
});
