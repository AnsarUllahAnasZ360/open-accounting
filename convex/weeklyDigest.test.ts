/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { composeDigestText, isoWeekKey, isFirstMondayWeek } from "./weeklyDigest";
import type { DigestComposition } from "./weeklyDigestData";

const modules = import.meta.glob("./**/*.ts");

/**
 * E9-T6 — the weekly digest. Proves: (a) a multi-entity workspace composes ONE
 * combined portfolio total with intercompany ELIMINATED; (b) the send is a clean
 * NO-OP without a Plunk key; (c) the send is idempotent per (workspace, week).
 */

const sendWeeklyDigest = makeFunctionReference<
  "action",
  { workspaceId: Id<"workspaces">; today?: string },
  { status: "sent" | "skipped"; reason?: string; recipient?: string | null }
>("weeklyDigest:sendWeeklyDigest");

const PLUNK_ENV = ["PLUNK_SECRET_KEY", "PLUNK_API_KEY", "PLUNK_FROM_EMAIL", "PLUNK_FROM_NAME"] as const;
const previousEnv = new Map<string, string | undefined>();
function clearPlunkEnv() {
  for (const name of PLUNK_ENV) {
    previousEnv.set(name, process.env[name]);
    delete process.env[name];
  }
}
function restorePlunkEnv() {
  for (const name of PLUNK_ENV) {
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
      name: "Portfolio Co", slug: "portfolio-co", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", {
      workspaceId, userId, role: "owner", status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("workspaceSettings", {
      workspaceId, appName: "OpenBooks", defaultCurrency: "USD", fiscalYearStartMonth: 1,
      notificationEmail: "owner@example.com",
      notifications: { review: true, digest: true, anomaly: true, sync: true, owed: true, close: true, marketing: false },
      updatedAt: now,
    });
    return { userId, workspaceId, now };
  });
}

// Seed an entity with current/prior month income & expense. `intercompanyMinor`,
// when set, posts a balance-sheet-only leg (1300/2300) that must NOT enter P&L.
async function seedEntity(
  t: TestConvex<typeof schema>,
  base: { workspaceId: Id<"workspaces">; userId: Id<"users">; now: number },
  opts: { slug: string; name: string; currentIncome: number; currentExpense: number; priorIncome: number; intercompanyMinor?: number },
) {
  return await t.run(async (ctx) => {
    const now = base.now;
    const eid = await ctx.db.insert("entities", {
      workspaceId: base.workspaceId, name: opts.name, slug: opts.slug,
      businessType: "services", currency: "USD", isDemo: false, archived: false,
      createdAt: now, updatedAt: now,
    });
    const checking = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Checking", type: "asset", subtype: "checking", number: "1010", currency: "USD", isSystem: true, archived: false, createdAt: now, updatedAt: now });
    const income = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Revenue", type: "income", subtype: "services", number: "4100", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
    const expense = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Software", type: "expense", subtype: "software", number: "6000", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
    const icReceivable = await ctx.db.insert("ledgerAccounts", { entityId: eid, name: "Due from affiliates", type: "asset", subtype: "intercompany", number: "1300", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
    await ctx.db.insert("bankAccounts", { entityId: eid, ledgerAccountId: checking, name: "Checking", mask: "1111", kind: "checking", balanceMinor: 0, includeInSync: true, createdAt: now, updatedAt: now });

    async function post(date: string, lines: Array<{ accountId: Id<"ledgerAccounts">; debitMinor: number; creditMinor: number }>) {
      const entryId = await ctx.db.insert("journalEntries", { entityId: eid, date, memo: "seed", source: "manual", postedByUserId: base.userId, locked: true, createdAt: now });
      for (const line of lines) {
        await ctx.db.insert("journalLines", { entityId: eid, entryId, accountId: line.accountId, debitMinor: line.debitMinor, creditMinor: line.creditMinor, currency: "USD", createdAt: now });
      }
    }
    // Current month (2026-06).
    await post("2026-06-10", [
      { accountId: checking, debitMinor: opts.currentIncome, creditMinor: 0 },
      { accountId: income, debitMinor: 0, creditMinor: opts.currentIncome },
    ]);
    await post("2026-06-12", [
      { accountId: expense, debitMinor: opts.currentExpense, creditMinor: 0 },
      { accountId: checking, debitMinor: 0, creditMinor: opts.currentExpense },
    ]);
    // Prior month (2026-05) income for the delta.
    await post("2026-05-10", [
      { accountId: checking, debitMinor: opts.priorIncome, creditMinor: 0 },
      { accountId: income, debitMinor: 0, creditMinor: opts.priorIncome },
    ]);
    // Intercompany leg: balance-sheet only (Dr 1300 / Cr Checking) — must never
    // touch revenue/expense, so the portfolio P&L "eliminates" it by construction.
    if (opts.intercompanyMinor) {
      await post("2026-06-15", [
        { accountId: icReceivable, debitMinor: opts.intercompanyMinor, creditMinor: 0 },
        { accountId: checking, debitMinor: 0, creditMinor: opts.intercompanyMinor },
      ]);
    }
    return { eid };
  });
}

describe("Weekly digest (E9-T6)", () => {
  afterEach(() => {
    restorePlunkEnv();
  });

  it("composes one combined portfolio total with intercompany eliminated", async () => {
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    // Entity A: income 1000 (prior 800), expense 600, + a 5000 intercompany leg.
    await seedEntity(t, base, { slug: "a", name: "Studio A", currentIncome: 1000_00, currentExpense: 600_00, priorIncome: 800_00, intercompanyMinor: 5000_00 });
    // Entity B: income 500 (prior 500), expense 200.
    await seedEntity(t, base, { slug: "b", name: "Studio B", currentIncome: 500_00, currentExpense: 200_00, priorIncome: 500_00 });

    const composition = (await t.run(async (ctx) =>
      ctx.runQuery(internal.weeklyDigestData.composeDigest, { workspaceId: base.workspaceId, today: "2026-06-30" }),
    )) as DigestComposition;

    expect(composition.entityCount).toBe(2);
    // Combined revenue = 1000 + 500 = 1500; the 5000 intercompany leg is NOT here.
    expect(composition.revenue.currentMinor).toBe(1500_00);
    expect(composition.expense.currentMinor).toBe(800_00); // 600 + 200
    expect(composition.profit.currentMinor).toBe(700_00); // 1500 − 800
    // Prior revenue = 800 + 500 = 1300 -> delta = round((1500-1300)/1300*100) = 15%.
    expect(composition.revenue.priorMinor).toBe(1300_00);
    expect(composition.revenue.deltaPct).toBe(15);

    // The composed email is grounded + plain-English.
    const email = composeDigestText(composition);
    expect(email.subject).toMatch(/OpenBooks weekly/);
    expect(email.text).toMatch(/Revenue:/);
    expect(email.text).toMatch(/review before relying/i);
  });

  it("is a clean no-op (skipped, no throw) when no Plunk key is configured", async () => {
    clearPlunkEnv();
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    await seedEntity(t, base, { slug: "a", name: "Studio A", currentIncome: 1000_00, currentExpense: 600_00, priorIncome: 800_00 });

    const result = await t.action(sendWeeklyDigest, { workspaceId: base.workspaceId, today: "2026-06-30" });
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("no-plunk-key");
  });

  it("is idempotent per (workspace, ISO week): the second run sends nothing", async () => {
    clearPlunkEnv();
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    await seedEntity(t, base, { slug: "a", name: "Studio A", currentIncome: 1000_00, currentExpense: 600_00, priorIncome: 800_00 });

    const first = await t.action(sendWeeklyDigest, { workspaceId: base.workspaceId, today: "2026-06-30" });
    expect(first.status).toBe("skipped"); // skipped because no key, but it CLAIMED the week
    expect(first.reason).toBe("no-plunk-key");

    const second = await t.action(sendWeeklyDigest, { workspaceId: base.workspaceId, today: "2026-06-30" });
    expect(second.status).toBe("skipped");
    expect(second.reason).toBe("already-sent-this-week");

    // Exactly one digestLog row for the week.
    const rows = await t.run(async (ctx) =>
      ctx.db.query("digestLog").withIndex("by_workspace", (q) => q.eq("workspaceId", base.workspaceId)).collect(),
    );
    expect(rows.length).toBe(1);
  });

  it("respects the digest toggle: a disabled workspace is skipped", async () => {
    clearPlunkEnv();
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    await seedEntity(t, base, { slug: "a", name: "Studio A", currentIncome: 1000_00, currentExpense: 600_00, priorIncome: 800_00 });
    await t.run(async (ctx) => {
      const settings = await ctx.db
        .query("workspaceSettings")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", base.workspaceId))
        .unique();
      if (settings) {
        await ctx.db.patch(settings._id, {
          notifications: { review: true, digest: false, anomaly: true, sync: true, owed: true, close: true, marketing: false },
        });
      }
    });

    const result = await t.action(sendWeeklyDigest, { workspaceId: base.workspaceId, today: "2026-06-30" });
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("digest-disabled");
  });
});

describe("Weekly digest ISO-week helpers (E9-T6)", () => {
  it("computes the ISO week key", () => {
    expect(isoWeekKey(new Date("2026-06-30T00:00:00.000Z"))).toMatch(/^2026-W\d{2}$/);
    // Two dates in the same ISO week share a key.
    expect(isoWeekKey(new Date("2026-06-22T00:00:00.000Z"))).toBe(isoWeekKey(new Date("2026-06-28T00:00:00.000Z")));
  });

  it("identifies a first-Monday week (date <= 7)", () => {
    expect(isFirstMondayWeek(new Date("2026-06-03T00:00:00.000Z"))).toBe(true);
    expect(isFirstMondayWeek(new Date("2026-06-22T00:00:00.000Z"))).toBe(false);
  });
});
