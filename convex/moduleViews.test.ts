/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const moduleOverview = makeFunctionReference<"query", Record<string, never>, ModuleOverview>(
  "moduleViews:overview",
);

type ModuleOverview = {
  entity: { name: string; currency: string } | null;
  contacts: { rows: Array<{ name: string; roles: string[]; openReceivableMinor: number; openPayableMinor: number }> };
  invoices: { kpis: { openMinor: number; overdueMinor: number }; aging: { totalMinor: number } };
  bills: { kpis: { openMinor: number }; groups: Array<{ key: string; rows: unknown[] }> };
  payroll: { employees: unknown[]; currencyTotals: Array<{ currency: string; localMinor: number }> };
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
