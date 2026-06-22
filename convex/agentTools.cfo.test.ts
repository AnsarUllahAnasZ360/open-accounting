/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { OPENBOOKS_AGENT_INSTRUCTIONS } from "./agent";
import { openBooksReadTools } from "./agentTools";

const modules = import.meta.glob("./**/*.ts");

/**
 * E9-T7 — the advisor Ask-AI tools (getRunwayAndBurn + getAdvisories). They must
 * be entity-scoped, return grounded numbers from the CFO aggregate (E9-T3/T4),
 * be exposed by BOTH runtimes, and stay strictly READ-ONLY (no proposal/post).
 */

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
    subject: `${userId}|test-session`, tokenIdentifier: "test|cfo-tools", issuer: "test", email: "owner@example.com",
  });
}

async function seedBurningEntity(
  t: TestConvex<typeof schema>,
  base: { workspaceId: Id<"workspaces">; userId: Id<"users">; now: number },
) {
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

    async function postLines(date: string, lines: Array<{ accountId: Id<"ledgerAccounts">; debitMinor: number; creditMinor: number }>) {
      const entryId = await ctx.db.insert("journalEntries", { entityId: eid, date, memo: "seed", source: "manual", postedByUserId: base.userId, locked: true, createdAt: now });
      for (const line of lines) {
        await ctx.db.insert("journalLines", { entityId: eid, entryId, accountId: line.accountId, debitMinor: line.debitMinor, creditMinor: line.creditMinor, currency: "USD", createdAt: now });
      }
    }
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
    return { eid, checking };
  });
}

describe("Advisor Ask-AI tools (E9-T7)", () => {
  it("registers getRunwayAndBurn + getAdvisories as read tools (both present, read-only set)", () => {
    expect("getRunwayAndBurn" in openBooksReadTools).toBe(true);
    expect("getAdvisories" in openBooksReadTools).toBe(true);
    // Read-only: the advisor tools are NOT among the propose-* (write-intent) tools.
    const proposeKeys = Object.keys(openBooksReadTools).filter((key) => key.startsWith("propose"));
    expect(proposeKeys).not.toContain("getRunwayAndBurn");
    expect(proposeKeys).not.toContain("getAdvisories");
  });

  it("agent instructions tell the model to use the advisor tools and not guess", () => {
    expect(OPENBOOKS_AGENT_INSTRUCTIONS).toMatch(/getRunwayAndBurn/);
    expect(OPENBOOKS_AGENT_INSTRUCTIONS).toMatch(/getAdvisories/);
    expect(OPENBOOKS_AGENT_INSTRUCTIONS.toLowerCase()).toMatch(/never (invent|guess|recompute)/);
  });

  it("internal getCfoSignalsForEntity returns grounded runway/burn for a seeded entity", async () => {
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    const { eid } = await seedBurningEntity(t, base);

    const signals = await t.run(async (ctx) =>
      ctx.runQuery(internal.agentToolQueries.getCfoSignalsForEntity, { entityId: eid, today: "2026-06-30" }),
    );
    expect(signals.tool).toBe("getAdvisories");
    // burn = +400/mo over the trailing window; runway = cash / burn.
    expect(signals.monthlyBurnMinor).toBeGreaterThan(0);
    expect(signals.cashPositionMinor).toBe(-2000_00); // 5×(600−1000) = −2000.00
    expect(signals.runwayMonths).not.toBeNull();
  });

  it("public aiChatTools.getRunwayAndBurn / getAdvisories return grounded numbers and are auth-gated", async () => {
    const t = convexTest(schema, modules);
    const base = await setupWorkspace(t);
    const { eid } = await seedBurningEntity(t, base);
    const session = authed(t, base.userId);

    const runway = await session.query(api.aiChatTools.getRunwayAndBurn, { entityId: eid, today: "2026-06-30" });
    expect(runway.tool).toBe("getRunwayAndBurn");
    expect(runway.monthlyBurnMinor).toBeGreaterThan(0);
    expect(runway.forecast.length).toBe(3);

    const advisories = await session.query(api.aiChatTools.getAdvisories, { entityId: eid, today: "2026-06-30" });
    expect(advisories.tool).toBe("getAdvisories");
    expect(advisories.signals.some((signal: { family: string }) => signal.family === "runway")).toBe(true);

    // Auth-gated: an unauthenticated caller is rejected.
    await expect(
      t.query(api.aiChatTools.getRunwayAndBurn, { entityId: eid, today: "2026-06-30" }),
    ).rejects.toThrow();
  });
});
