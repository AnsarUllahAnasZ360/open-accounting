/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";

import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  cardNumbersAreSupported,
  numericTokensFromSignals,
} from "./aiCfoVerify";

const modules = import.meta.glob("./**/*.ts");

/**
 * E9-T4 — the AI CFO advisory engine. Two guarantees this suite proves:
 *  1) With NO AI key configured the action returns the DETERMINISTIC cards and
 *     never throws (RC9: never Bedrock-only, always degrades cleanly).
 *  2) Every numeric claim in a returned card traces to a CfoSignals field — the
 *     model can never inject a fabricated number (pure cross-check).
 */

const generateAdvisories = makeFunctionReference<
  "action",
  { entityId?: Id<"entities">; today?: string },
  {
    summary: string;
    cards: Array<{ signalKey: string; title: string; body: string; severity: string }>;
    source: "ai" | "deterministic";
    disclaimer: string;
    taxDisclaimer: string;
    cashPositionMinor: number;
    monthlyBurnMinor: number;
    runwayMonths: number | null;
  }
>("aiCfo:generateAdvisories");

const cfoSignalsForEntityAuthed = makeFunctionReference<
  "query",
  { entityId?: Id<"entities">; today?: string },
  // Minimal shape used by the test's numeric verifier.
  {
    signals: Array<{ key: string; metricMinor: number | null; comparatorMinor: number | null; deltaPct: number | null }>;
    cashPositionMinor: number;
    monthlyBurnMinor: number;
    runwayMonths: number | null;
    currentRevenueMinor: number;
    priorAvgRevenueMinor: number;
    taxSetAsideMinor: number;
    forecast: Array<{ projectedCashMinor: number }>;
  } | null
>("aiCfoAggregate:cfoSignalsForEntityAuthed");

const AI_ENV = [
  "AI_PROVIDER",
  "AI_MODEL",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
] as const;
const previousEnv = new Map<string, string | undefined>();

function clearAiEnv() {
  for (const name of AI_ENV) {
    previousEnv.set(name, process.env[name]);
    delete process.env[name];
  }
}

function restoreAiEnv() {
  for (const name of AI_ENV) {
    const value = previousEnv.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  previousEnv.clear();
}

async function setupWorkspace(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar's workspace", slug: "ansar-workspace", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", {
      workspaceId, userId, role: "owner", status: "active", createdAt: now, updatedAt: now,
    });
    return { userId, workspaceId, now };
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">) {
  return t.withIdentity({
    subject: `${userId}|test-session`, tokenIdentifier: "test|cfo-narrate", issuer: "test", email: "owner@example.com",
  });
}

// Seed a burning entity (income < expense) so runway/concentration/tax signals
// are all populated — the same fixture shape used by aiCfoAggregate.test.ts.
async function seedBurningEntity(t: TestConvex<typeof schema>, base: { workspaceId: Id<"workspaces">; userId: Id<"users">; now: number }) {
  return await t.run(async (ctx) => {
    const now = base.now;
    const eid = await ctx.db.insert("entities", {
      workspaceId: base.workspaceId, name: "CFO Co", slug: "cfo-co",
      businessType: "services", currency: "USD", isDemo: false, archived: false,
      createdAt: now, updatedAt: now,
    });
    const checking = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Checking", type: "asset", subtype: "checking", number: "1010", currency: "USD", isSystem: true, archived: false, createdAt: now, updatedAt: now });
    const income = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Services Revenue", type: "income", subtype: "services", number: "4100", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
    const expense = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Software", type: "expense", subtype: "software", number: "6000", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
    await ctx.db.insert("bankAccounts", { entityId: eid, ledgerAccountId: checking, name: "Checking", mask: "1111", kind: "checking", balanceMinor: 0, includeInSync: true, createdAt: now, updatedAt: now });
    const custA = await ctx.db.insert("contacts", { entityId: eid, name: "Acme", roles: ["customer"], aliases: [], createdAt: now, updatedAt: now });

    async function postLines(date: string, lines: Array<{ accountId: Id<"ledgerAccounts">; debitMinor: number; creditMinor: number; contactId?: string }>) {
      const entryId = await ctx.db.insert("journalEntries", { entityId: eid, date, memo: "seed", source: "manual", postedByUserId: base.userId, locked: true, createdAt: now });
      for (const line of lines) {
        await ctx.db.insert("journalLines", { entityId: eid, entryId, accountId: line.accountId, debitMinor: line.debitMinor, creditMinor: line.creditMinor, currency: "USD", contactId: line.contactId, createdAt: now });
      }
    }
    // Trailing months: income 600, expense 1000 -> burn +400/mo.
    for (const month of ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]) {
      await postLines(`${month}-15`, [
        { accountId: checking, debitMinor: 600_00, creditMinor: 0 },
        { accountId: income, debitMinor: 0, creditMinor: 600_00 },
      ]);
      await postLines(`${month}-20`, [
        { accountId: expense, debitMinor: 1000_00, creditMinor: 0 },
        { accountId: checking, debitMinor: 0, creditMinor: 1000_00 },
      ]);
    }
    // Current month with a single concentrated customer.
    await postLines("2026-06-10", [
      { accountId: checking, debitMinor: 500_00, creditMinor: 0 },
      { accountId: income, debitMinor: 0, creditMinor: 500_00, contactId: custA },
    ]);
    return { eid };
  });
}

describe("AI CFO advisory engine (E9-T4)", () => {
  afterEach(() => {
    restoreAiEnv();
  });

  it("returns deterministic cards with a disclaimer when no AI key is configured (never throws)", async () => {
    clearAiEnv();
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    await seedBurningEntity(t, base);
    const session = authed(t, base.userId);

    const result = await session.action(generateAdvisories, { today: "2026-06-30" });

    expect(result.source).toBe("deterministic");
    expect(result.disclaimer).toBe("AI-generated estimate, review before relying.");
    expect(result.taxDisclaimer).toMatch(/not tax advice/i);
    expect(result.cards.length).toBeGreaterThan(0);
    // Every card must reference a known signal key (runway is always present).
    expect(result.cards.some((card) => card.signalKey === "runway")).toBe(true);
  });

  it("every number in every returned card traces to a CfoSignals field (no fabrication)", async () => {
    clearAiEnv();
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    await seedBurningEntity(t, base);
    const session = authed(t, base.userId);

    const signals = await session.query(cfoSignalsForEntityAuthed, { today: "2026-06-30" });
    expect(signals).not.toBeNull();
    const result = await session.action(generateAdvisories, { today: "2026-06-30" });

    const allowed = numericTokensFromSignals(signals!);
    for (const card of result.cards) {
      expect(
        cardNumbersAreSupported({ title: card.title, body: card.body }, allowed),
        `card "${card.title}" / "${card.body}" cites a number absent from CfoSignals`,
      ).toBe(true);
    }
    // The summary line is likewise grounded.
    expect(cardNumbersAreSupported({ title: result.summary, body: "" }, allowed)).toBe(true);
  });

  it("returns an honest empty result when the entity is unauthorized / absent", async () => {
    clearAiEnv();
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    const session = authed(t, base.userId);

    // No entity seeded -> resolver returns null -> empty, non-throwing result.
    const result = await session.action(generateAdvisories, { today: "2026-06-30" });
    expect(result.cards).toEqual([]);
    expect(result.source).toBe("deterministic");
    expect(result.cashPositionMinor).toBe(0);
  });
});

describe("AI CFO numeric cross-check (E9-T4)", () => {
  const signals = {
    signals: [
      { key: "runway", metricMinor: 1_200_000, comparatorMinor: 40_000, deltaPct: null },
      { key: "income_trend", metricMinor: 50_000, comparatorMinor: 70_000, deltaPct: -28 },
    ],
    cashPositionMinor: 1_200_000,
    monthlyBurnMinor: 40_000,
    runwayMonths: 30,
    currentRevenueMinor: 50_000,
    priorAvgRevenueMinor: 70_000,
    taxSetAsideMinor: 0,
    forecast: [{ projectedCashMinor: 0 }, { projectedCashMinor: 0 }, { projectedCashMinor: 80_000 }],
  };

  it("admits both minor-unit and major-unit (÷100) magnitudes from the signals", () => {
    const allowed = numericTokensFromSignals(signals);
    expect(allowed.has(1_200_000)).toBe(true); // raw minor
    expect(allowed.has(12_000)).toBe(true); // ÷100 display
    expect(allowed.has(28)).toBe(true); // deltaPct
  });

  it("accepts a card that restates a supplied figure", () => {
    const allowed = numericTokensFromSignals(signals);
    expect(
      cardNumbersAreSupported({ title: "Cash", body: "You hold USD 12,000 in cash." }, allowed),
    ).toBe(true);
  });

  it("rejects a card that invents a number absent from the signals", () => {
    const allowed = numericTokensFromSignals(signals);
    expect(
      cardNumbersAreSupported({ title: "Made up", body: "You hold USD 99,999 in cash." }, allowed),
    ).toBe(false);
  });

  it("ignores small counts and 4-digit years", () => {
    const allowed = numericTokensFromSignals(signals);
    expect(
      cardNumbersAreSupported({ title: "Down 5% in 2026", body: "Income down across 2 streams." }, allowed),
    ).toBe(true);
  });
});
