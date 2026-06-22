/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// E9-T3 — the CFO aggregate is the deterministic, ledger-grounded numeric core.
// Every advisory number must originate here and reconcile to the underlying
// ledger/view: runway = cashPosition / trailing burn; concentration % matches
// the income-by-customer rollup; tax set-aside = pct × trailing net income.

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
    subject: `${userId}|test-session`, tokenIdentifier: "test|cfo", issuer: "test", email: "owner@example.com",
  });
}

describe("CFO grounded aggregate (E9-T3)", () => {
  it("computes runway/burn/concentration/tax that reconcile to the ledger", async () => {
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    const session = authed(t, base.userId);

    const seeded = await t.run(async (ctx) => {
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
      const custB = await ctx.db.insert("contacts", { entityId: eid, name: "Beta", roles: ["customer"], aliases: [], createdAt: now, updatedAt: now });

      async function postLines(date: string, lines: Array<{ accountId: Id<"ledgerAccounts">; debitMinor: number; creditMinor: number; contactId?: string }>) {
        const entryId = await ctx.db.insert("journalEntries", { entityId: eid, date, memo: "seed", source: "manual", postedByUserId: base.userId, locked: true, createdAt: now });
        for (const line of lines) {
          await ctx.db.insert("journalLines", { entityId: eid, entryId, accountId: line.accountId, debitMinor: line.debitMinor, creditMinor: line.creditMinor, currency: "USD", contactId: line.contactId, createdAt: now });
        }
      }
      // Six trailing months ending at 2026-06. Each month: income 1000, expense 600
      // → monthly net +400, so burn is NEGATIVE (cash-positive), runway = null.
      // We need a burn, so flip: income 600, expense 1000 → burn +400/mo.
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
      // Current month (2026-06): two customers' revenue for concentration.
      await postLines("2026-06-10", [
        { accountId: checking, debitMinor: 800_00, creditMinor: 0 },
        { accountId: income, debitMinor: 0, creditMinor: 800_00, contactId: custA },
      ]);
      await postLines("2026-06-12", [
        { accountId: checking, debitMinor: 200_00, creditMinor: 0 },
        { accountId: income, debitMinor: 0, creditMinor: 200_00, contactId: custB },
      ]);
      await postLines("2026-06-22", [
        { accountId: expense, debitMinor: 1000_00, creditMinor: 0 },
        { accountId: checking, debitMinor: 0, creditMinor: 1000_00 },
      ]);
      return { eid, income, custA };
    });

    const signals = await session.query(api.aiCfoAggregate.cfoSignals, { entityId: seeded.eid, today: "2026-06-25" });
    expect(signals).not.toBeNull();
    if (!signals) return;

    // Runway = cashPosition / monthlyBurn (within rounding). Cash position:
    // 5×(600−1000) + (800+200−1000) = −2000 + 0 = −2000.00. Burn over the
    // trailing 6 months (Jan–Jun): Jan-May net = +400/mo, Jun net =
    // expense1000 − income1000 = 0 → avg = (5×400 + 0)/6 = 333.33.
    expect(signals.cashPositionMinor).toBe(-2000_00);
    expect(signals.monthlyBurnMinor).toBe(Math.round((5 * 400_00 + 0) / 6));
    if (signals.runwayMonths !== null) {
      const expectedRunway = Math.round((signals.cashPositionMinor / signals.monthlyBurnMinor) * 10) / 10;
      expect(signals.runwayMonths).toBe(expectedRunway);
    }

    // Concentration: top customer (Acme 800) of period total (1000) = 80%.
    const concentration = signals.signals.find((s) => s.family === "concentration");
    expect(concentration).toBeDefined();
    expect(concentration?.metricMinor).toBe(800_00);
    expect(concentration?.comparatorMinor).toBe(1000_00);
    expect(concentration?.deltaPct).toBe(80);

    // Tax set-aside = pct(0.30 default) × trailing net income. Trailing net
    // income (Jan–Jun) = 5×(600−1000) + (1000−1000) = −2000 → base clamped to 0
    // → set-aside 0 → no tax signal (positive only).
    expect(signals.taxSetAsidePct).toBe(0.3);
    expect(signals.taxSetAsideMinor).toBe(0);

    // Every numeric claim in a signal traces to an aggregate field (no fabricated
    // numbers): each signal's metricMinor is finite USD minor units (or null).
    for (const signal of signals.signals) {
      if (signal.metricMinor !== null) expect(Number.isInteger(signal.metricMinor)).toBe(true);
    }

    // Mandatory tax disclaimer present.
    expect(signals.taxDisclaimer.toLowerCase()).toContain("not tax advice");
  });

  it("produces a positive tax set-aside at the configured rate when net income is positive", async () => {
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    const session = authed(t, base.userId);

    const eid = await t.run(async (ctx) => {
      const now = base.now;
      const entityId = await ctx.db.insert("entities", {
        workspaceId: base.workspaceId, name: "Profit Co", slug: "profit-co",
        businessType: "services", currency: "USD", isDemo: false, archived: false,
        createdAt: now, updatedAt: now,
      });
      const checking = await ctx.db.insert("ledgerAccounts", { entityId, name: "Checking", type: "asset", subtype: "checking", number: "1010", currency: "USD", isSystem: true, archived: false, createdAt: now, updatedAt: now });
      const income = await ctx.db.insert("ledgerAccounts", { entityId, name: "Revenue", type: "income", subtype: "services", number: "4100", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
      await ctx.db.insert("bankAccounts", { entityId, ledgerAccountId: checking, name: "Checking", mask: "1111", kind: "checking", balanceMinor: 0, includeInSync: true, createdAt: now, updatedAt: now });
      // Profitable month: income 10000, no expense.
      const entryId = await ctx.db.insert("journalEntries", { entityId, date: "2026-06-10", memo: "seed", source: "manual", postedByUserId: base.userId, locked: true, createdAt: now });
      await ctx.db.insert("journalLines", { entityId, entryId, accountId: checking, debitMinor: 10000_00, creditMinor: 0, currency: "USD", createdAt: now });
      await ctx.db.insert("journalLines", { entityId, entryId, accountId: income, debitMinor: 0, creditMinor: 10000_00, currency: "USD", createdAt: now });
      // Set a custom set-aside rate of 25%.
      await ctx.db.insert("workspaceSettings", { workspaceId: base.workspaceId, appName: "OpenBooks", defaultCurrency: "USD", fiscalYearStartMonth: 1, taxSetAsidePct: 0.25, updatedAt: now });
      return entityId;
    });

    const signals = await session.query(api.aiCfoAggregate.cfoSignals, { entityId: eid, today: "2026-06-25" });
    expect(signals).not.toBeNull();
    if (!signals) return;
    expect(signals.taxSetAsidePct).toBe(0.25);
    // Trailing net income = 10000; set-aside = 0.25 × 10000 = 2500.
    expect(signals.taxSetAsideMinor).toBe(2500_00);
    const tax = signals.signals.find((s) => s.family === "tax");
    expect(tax).toBeDefined();
    expect(tax?.metricMinor).toBe(2500_00);
  });
});
