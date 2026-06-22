/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const moduleOverview = makeFunctionReference<"query", { entityId?: string; today?: string }, ModuleOverview>(
  "moduleViews:overview",
);

type ModuleOverview = {
  entity: { name: string; currency: string } | null;
  contacts: { rows: Array<{ name: string; roles: string[]; openReceivableMinor: number; openPayableMinor: number }> };
  invoices: { kpis: { openMinor: number; overdueMinor: number }; aging: { totalMinor: number } };
  bills: { kpis: { openMinor: number }; groups: Array<{ key: string; rows: unknown[] }> };
  payroll: {
    employees: Array<{ active: boolean }>;
    currencyTotals: Array<{ currency: string; localMinor: number; baseMinor: number }>;
    runs: Array<{ period: string; status: string; totalBaseMinor: number }>;
    statementsByCurrency: Array<{ currency: string; isBaseCurrency: boolean; localMinor: number; baseMinor: number; csv: string; csvFilename: string }>;
    insight: {
      runRateBaseMinor: number;
      runRateBasedOnApprovedRun: boolean;
      headcount: number;
      baseCurrency: string;
      hasFxExposure: boolean;
      fxExposureSharePct: number;
      nonBaseCurrencies: string[];
    };
  };
  settings: {
    businesses: { rows: Array<{ name: string; canArchive: boolean }> };
    rules: { rows: Array<{ summary: string; hitCount: number; active: boolean }>; pendingSuggestion: { status: string } };
    audit: { rows: Array<{ actor: string; action: string; beforeAfter: string }> };
  };
};

async function setupWorkspace(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      email: "owner@example.com",
      name: "Owner",
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar's workspace",
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
    return { userId, workspaceId };
  });
}

function authed(t: ReturnType<typeof convexTest>, userId: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|owner",
    issuer: "test",
    email: "owner@example.com",
  });
}

describe("M6 module view model", () => {
  it("rejects module data without sign-in", async () => {
    const t = convexTest(schema, modules);

    await expect(t.query(moduleOverview, {})).rejects.toThrow("OpenBooks requires sign-in");
  });

  it("projects seeded module data for contacts, AR, AP, payroll, rules, businesses, and audit", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);

    const seed = await session.action(api.seedDemo.resetAndSeed, {});
    await session.mutation(api.ai.createConfirmedRule, {
      entityId: seed.entityId,
      merchantContains: "Uber",
    });
    const overview = await session.query(moduleOverview, {});

    expect(overview.entity?.name).toBe("Acme Studio LLC");
    expect(overview.contacts.rows.length).toBeGreaterThanOrEqual(18);
    expect(overview.contacts.rows.some((contact) => contact.roles.includes("customer"))).toBe(true);
    expect(overview.contacts.rows.some((contact) => contact.openPayableMinor > 0)).toBe(true);
    expect(overview.invoices.kpis.openMinor).toBeGreaterThan(0);
    expect(overview.invoices.kpis.overdueMinor).toBeGreaterThan(0);
    expect(overview.invoices.aging.totalMinor).toBe(overview.invoices.kpis.openMinor);
    expect(overview.bills.kpis.openMinor).toBeGreaterThan(0);
    expect(overview.bills.groups.some((group) => group.rows.length > 0)).toBe(true);
    expect(overview.payroll.employees).toHaveLength(6);
    expect(overview.payroll.currencyTotals.map((row) => row.currency).sort()).toEqual(["INR", "PKR", "USD"]);
    expect(overview.settings.businesses.rows[0]).toMatchObject({
      name: "Acme Studio LLC",
      canArchive: false,
    });
    expect(overview.settings.rules.rows.length).toBeGreaterThanOrEqual(6);
    expect(overview.settings.rules.rows[0].summary).toContain("If");
    expect(overview.settings.rules.pendingSuggestion.status).toBe("waiting_for_ai_stage");
    expect(overview.settings.audit.rows.length).toBeGreaterThan(0);
    expect(overview.settings.audit.rows[0].beforeAfter).toContain("After:");
    expect(overview.settings.audit.rows.map((row) => row.actor)).toEqual(
      expect.arrayContaining(["ai", "rule", "user"]),
    );
    expect(overview.settings.audit.rows.some((row) => row.action === "ai.rule.confirmed")).toBe(true);
  });
});

describe("E10-T6: payroll insight (run-rate / headcount / FX exposure)", () => {
  it("run-rate equals the latest approved/paid run base total; FX note flips on with non-base staff", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);
    await session.action(api.seedDemo.resetAndSeed, {});

    // Pin "today" so the read path is deterministic (no frozen literal).
    const overview = await session.query(moduleOverview, { today: "2026-06-11" });
    const insight = overview.payroll.insight;

    // Run-rate is derived from a posted (approved/paid) run, not roster face value.
    expect(insight.runRateBasedOnApprovedRun).toBe(true);
    const approvedRuns = overview.payroll.runs
      .filter((run) => run.status === "approved" || run.status === "paid")
      .sort((a, b) => b.period.localeCompare(a.period));
    expect(approvedRuns.length).toBeGreaterThan(0);
    expect(insight.runRateBaseMinor).toBe(approvedRuns[0].totalBaseMinor);
    expect(insight.runRateBaseMinor).toBeGreaterThan(0);

    // Headcount = active employees.
    expect(insight.headcount).toBe(overview.payroll.employees.filter((e) => e.active).length);

    // FX-exposure flips ON because the demo roster carries PKR + INR staff.
    expect(insight.hasFxExposure).toBe(true);
    expect(insight.fxExposureSharePct).toBeGreaterThan(0);
    expect(insight.nonBaseCurrencies.sort()).toEqual(["INR", "PKR"]);
    expect(insight.baseCurrency).toBe("USD");
  });

  it("per-currency statements split the roster and reconcile local + base totals", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);
    await session.action(api.seedDemo.resetAndSeed, {});

    const overview = await session.query(moduleOverview, { today: "2026-06-11" });
    const blocks = overview.payroll.statementsByCurrency;

    // One block per currency on the roster, base currency first.
    expect(blocks.map((b) => b.currency)).toEqual(["USD", "INR", "PKR"].filter((c) =>
      overview.payroll.currencyTotals.some((t) => t.currency === c),
    ).sort((a, b) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b))));
    expect(blocks[0].isBaseCurrency).toBe(true);

    // Each block's totals reconcile to the roster currencyTotals; the CSV carries
    // its own filename per currency.
    for (const block of blocks) {
      const roster = overview.payroll.currencyTotals.find((t) => t.currency === block.currency)!;
      expect(block.localMinor).toBe(roster.localMinor);
      expect(block.baseMinor).toBe(roster.baseMinor);
      expect(block.csvFilename).toBe(`openbooks-payroll-statement-${block.currency.toLowerCase()}.csv`);
      expect(block.csv.split("\n")[0]).toContain("employee,country,currency");
    }
  });
});
