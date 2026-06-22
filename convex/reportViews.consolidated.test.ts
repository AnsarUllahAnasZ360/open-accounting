/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";

import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type ConsolidatedPack = {
  entity: { name: string };
  consolidatedFrom?: Id<"entities">[];
  eliminatedMinor?: number;
  eliminatedIncomeMinor?: number;
  profitAndLoss: { incomeMinor: number; expenseMinor: number; netIncomeMinor: number };
  limits: { truncated: boolean };
};

const reportPackRef = makeFunctionReference<
  "query",
  {
    entityId?: Id<"entities">;
    scope?: "all" | { entityId: Id<"entities"> };
    startDate: string;
    endDate: string;
    basis: "accrual" | "cash";
    compare: "none" | "priorPeriod" | "priorYear";
    columnMode: "total" | "monthly" | "quarterly";
  },
  ConsolidatedPack
>("reportViews:reportPack");

async function setup(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar workspace",
      slug: "ansar-workspace",
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

    async function buildEntity(name: string, slug: string, createdAt: number) {
      const entityId = await ctx.db.insert("entities", {
        workspaceId,
        name,
        slug,
        businessType: "services",
        currency: "USD",
        isDemo: false,
        archived: false,
        createdAt,
        updatedAt: createdAt,
      });
      async function account(
        number: string,
        accountName: string,
        type: "asset" | "income" | "expense",
        subtype: string,
      ) {
        return ctx.db.insert("ledgerAccounts", {
          entityId,
          number,
          name: accountName,
          type,
          subtype,
          currency: "USD",
          isSystem: true,
          archived: false,
          createdAt,
          updatedAt: createdAt,
        });
      }
      const cashId = await account("1010", "Operating Checking", "asset", "bank");
      const incomeId = await account("4000", "Services Revenue", "income", "services");
      const expenseId = await account("5000", "Software", "expense", "software");
      return { entityId, cashId, incomeId, expenseId };
    }
    const zikra = await buildEntity("Zikra", "zikra", now);
    const z360 = await buildEntity("Z360", "z360", now + 1000);
    return { userId, workspaceId, zikra, z360, now };
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|consolidated",
    issuer: "test",
    email: "owner@example.com",
  });
}

const baseArgs = {
  startDate: "2026-06-01",
  endDate: "2026-06-30",
  basis: "accrual" as const,
  compare: "none" as const,
  columnMode: "total" as const,
};

describe("consolidated reportPack (E5-T7)", () => {
  it("sums per-entity P&L and eliminates a confirmed intercompany pair", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    // Zikra: $3,000 income.
    await session.mutation((await import("./_generated/api")).api.ledger.postEntry, {
      entityId: ids.zikra.entityId,
      date: "2026-06-05",
      memo: "Zikra sale",
      source: "manual",
      lines: [
        { accountId: ids.zikra.cashId, debitMinor: 300000, creditMinor: 0, currency: "USD" },
        { accountId: ids.zikra.incomeId, debitMinor: 0, creditMinor: 300000, currency: "USD" },
      ],
    });
    // Z360: $5,000 income.
    await session.mutation((await import("./_generated/api")).api.ledger.postEntry, {
      entityId: ids.z360.entityId,
      date: "2026-06-06",
      memo: "Z360 sale",
      source: "manual",
      lines: [
        { accountId: ids.z360.cashId, debitMinor: 500000, creditMinor: 0, currency: "USD" },
        { accountId: ids.z360.incomeId, debitMinor: 0, creditMinor: 500000, currency: "USD" },
      ],
    });

    // An INTERCOMPANY income entry on Z360 ($1,000) that should be eliminated in
    // consolidation: Z360 books it as income, with a matching transaction carrying
    // the confirmed pair id.
    const icEntry = await session.mutation((await import("./_generated/api")).api.ledger.postEntry, {
      entityId: ids.z360.entityId,
      date: "2026-06-10",
      memo: "From Zikra (intercompany)",
      source: "manual",
      lines: [
        { accountId: ids.z360.cashId, debitMinor: 100000, creditMinor: 0, currency: "USD" },
        { accountId: ids.z360.incomeId, debitMinor: 0, creditMinor: 100000, currency: "USD" },
      ],
    });

    // Wire the transaction + confirmed intercompany link keyed on the pair id.
    await t.run(async (ctx) => {
      const pairId = "ic:test-pair";
      const fromTxnId = await ctx.db.insert("transactions", {
        entityId: ids.zikra.entityId,
        date: "2026-06-10",
        amountMinor: -100000,
        currency: "USD",
        merchant: "Transfer to Z360",
        rawDescription: "Transfer to Z360",
        status: "posted",
        review: "confirmed",
        source: "manual",
        externalId: "zikra-ic-out",
        intercompanyPairId: pairId,
        evalSet: false,
        createdAt: ids.now,
        updatedAt: ids.now,
      });
      const toTxnId = await ctx.db.insert("transactions", {
        entityId: ids.z360.entityId,
        entryId: icEntry.entryId,
        date: "2026-06-10",
        amountMinor: 100000,
        currency: "USD",
        merchant: "From Zikra",
        rawDescription: "From Zikra",
        status: "posted",
        review: "confirmed",
        source: "manual",
        externalId: "z360-ic-in",
        intercompanyPairId: pairId,
        evalSet: false,
        createdAt: ids.now,
        updatedAt: ids.now,
      });
      await ctx.db.insert("intercompanyLinks", {
        workspaceId: ids.workspaceId,
        fromEntityId: ids.zikra.entityId,
        toEntityId: ids.z360.entityId,
        fromTxnId,
        toTxnId,
        amountMinor: 100000,
        currency: "USD",
        status: "confirmed",
        tier: "high",
        intercompanyPairId: pairId,
        createdAt: ids.now,
        updatedAt: ids.now,
      });
    });

    // Single-entity Z360 still sees its full $6,000 income (legal separation).
    const z360Single = await session.query(reportPackRef, { ...baseArgs, entityId: ids.z360.entityId });
    expect(z360Single.profitAndLoss.incomeMinor).toBe(600000);

    // Consolidated: pre-elimination = 3000 + 6000 = 9000; the $1,000 intercompany
    // income is eliminated → 8000.
    const consolidated = await session.query(reportPackRef, { ...baseArgs, scope: "all" });
    expect(consolidated.eliminatedIncomeMinor).toBe(100000);
    expect(consolidated.eliminatedMinor).toBe(100000);
    expect(consolidated.profitAndLoss.incomeMinor).toBe(800000);
    // Pre-elimination total is recoverable as post + eliminated.
    expect(consolidated.profitAndLoss.incomeMinor + consolidated.eliminatedIncomeMinor!).toBe(900000);
    expect(consolidated.consolidatedFrom).toHaveLength(2);
  });

  it("leaves single-entity report output unchanged (no scope arg)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    await session.mutation((await import("./_generated/api")).api.ledger.postEntry, {
      entityId: ids.zikra.entityId,
      date: "2026-06-05",
      memo: "Zikra sale",
      source: "manual",
      lines: [
        { accountId: ids.zikra.cashId, debitMinor: 300000, creditMinor: 0, currency: "USD" },
        { accountId: ids.zikra.incomeId, debitMinor: 0, creditMinor: 300000, currency: "USD" },
      ],
    });

    const single = await session.query(reportPackRef, { ...baseArgs, entityId: ids.zikra.entityId });
    expect(single.profitAndLoss.incomeMinor).toBe(300000);
    // Single-entity packs never carry consolidation fields.
    expect(single.consolidatedFrom).toBeUndefined();
    expect(single.eliminatedMinor).toBeUndefined();
  });
});
