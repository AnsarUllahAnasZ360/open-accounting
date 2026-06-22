/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Multi-entity authorization hardening (E5-T10).
 *
 * Proves that scope='all' reads re-check the caller's role on EVERY entity they
 * aggregate and never leak across workspaces, that a foreign entityId throws, and
 * that hr/member role gating matches the single-entity path.
 */
async function setupWorkspace(
  t: TestConvex<typeof schema>,
  opts: { wsName: string; wsSlug: string; ownerEmail: string; role?: "owner" | "hr" | "member" },
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: opts.ownerEmail, name: opts.ownerEmail });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: opts.wsName,
      slug: opts.wsSlug,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId,
      role: opts.role ?? "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const entityId = await ctx.db.insert("entities", {
      workspaceId,
      name: `${opts.wsName} Co`,
      slug: `${opts.wsSlug}-co`,
      businessType: "services",
      currency: "USD",
      isDemo: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const cashId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      number: "1010",
      name: "Cash",
      type: "asset",
      subtype: "bank",
      currency: "USD",
      isSystem: true,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const incomeId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      number: "4000",
      name: "Revenue",
      type: "income",
      subtype: "services",
      currency: "USD",
      isSystem: true,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const entryId = await ctx.db.insert("journalEntries", {
      entityId,
      date: "2026-06-05",
      memo: "Sale",
      source: "manual",
      postedByUserId: userId,
      locked: false,
      createdAt: now,
    });
    await ctx.db.insert("journalLines", {
      entityId,
      entryId,
      accountId: cashId,
      debitMinor: 100000,
      creditMinor: 0,
      currency: "USD",
      createdAt: now,
    });
    await ctx.db.insert("journalLines", {
      entityId,
      entryId,
      accountId: incomeId,
      debitMinor: 0,
      creditMinor: 100000,
      currency: "USD",
      createdAt: now,
    });
    return { userId, workspaceId, entityId };
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">, email: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: `test|${email}`,
    issuer: "test",
    email,
  });
}

const reportArgs = {
  startDate: "2026-06-01",
  endDate: "2026-06-30",
  basis: "accrual" as const,
  compare: "none" as const,
  columnMode: "total" as const,
};

describe("portfolio authz (E5-T10)", () => {
  it("a workspace-B user sees zero workspace-A rows via portfolioDashboard scope=all", async () => {
    const t = convexTest(schema, modules);
    const a = await setupWorkspace(t, { wsName: "Alpha", wsSlug: "alpha", ownerEmail: "a@example.com" });
    await setupWorkspace(t, { wsName: "Beta", wsSlug: "beta", ownerEmail: "b@example.com" });

    // The B owner. B has its own entity, but must never see A's.
    const bUser = await t.run(async (ctx) => {
      const member = await ctx.db
        .query("workspaceMembers")
        .collect()
        .then((rows) => rows.find((row) => row.role === "owner" && String(row.userId) !== String(a.userId)));
      return member!.userId;
    });

    const bSession = authed(t, bUser, "b@example.com");
    const view = await bSession.query(api.portfolioViews.portfolioDashboard, { scope: "all" });
    // B sees only B's single entity, never A's.
    expect(view).not.toBeNull();
    expect(view!.byBusiness.every((row) => String(row.entityId) !== String(a.entityId))).toBe(true);
    expect(view!.businessCount).toBe(1);
  });

  it("a foreign entityId throws (consolidated reportPack)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupWorkspace(t, { wsName: "Alpha", wsSlug: "alpha", ownerEmail: "a@example.com" });
    const b = await setupWorkspace(t, { wsName: "Beta", wsSlug: "beta", ownerEmail: "b@example.com" });

    const bSession = authed(t, b.userId, "b@example.com");
    // B asks for A's entity directly → rejected by the single-entity authz gate.
    await expect(
      bSession.query(api.reportViews.reportPack, { ...reportArgs, entityId: a.entityId }),
    ).rejects.toThrow();
  });

  it("scope=all reportPack for workspace B never includes workspace A entities", async () => {
    const t = convexTest(schema, modules);
    const a = await setupWorkspace(t, { wsName: "Alpha", wsSlug: "alpha", ownerEmail: "a@example.com" });
    const b = await setupWorkspace(t, { wsName: "Beta", wsSlug: "beta", ownerEmail: "b@example.com" });

    const bSession = authed(t, b.userId, "b@example.com");
    const pack = (await bSession.query(api.reportViews.reportPack, { ...reportArgs, scope: "all" })) as {
      consolidatedFrom?: Id<"entities">[];
    };
    expect(pack.consolidatedFrom).toBeTruthy();
    expect(pack.consolidatedFrom!.map(String)).toContain(String(b.entityId));
    expect(pack.consolidatedFrom!.map(String)).not.toContain(String(a.entityId));
  });

  it("an hr/member role is gated on portfolio books reads exactly like single-entity", async () => {
    const t = convexTest(schema, modules);
    // Build a workspace whose ONLY membership for this user is hr.
    const setup = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", { email: "hr@example.com", name: "HR" });
      const workspaceId = await ctx.db.insert("workspaces", {
        name: "HR workspace",
        slug: "hr-workspace",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("workspaceMembers", {
        workspaceId,
        userId,
        role: "hr",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const entityId = await ctx.db.insert("entities", {
        workspaceId,
        name: "HR Co",
        slug: "hr-co",
        businessType: "services",
        currency: "USD",
        isDemo: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      return { userId, workspaceId, entityId };
    });

    const session = authed(t, setup.userId, "hr@example.com");
    // hr satisfies "member" minimum role (roleRank hr >= member), so portfolio
    // books reads behave identically to single-entity — both resolve, neither
    // leaks. The contract: the SAME role gate (requireWorkspaceRole 'member')
    // guards both paths. Assert the hr user can read its own workspace's portfolio
    // and the single-entity dashboard with parity (no extra restriction, no leak).
    const portfolio = await session.query(api.portfolioViews.portfolioDashboard, { scope: "all" });
    const single = await session.query(api.coreViews.dashboard, { entityId: setup.entityId });
    expect(portfolio).not.toBeNull();
    expect(single).not.toBeNull();
    expect(portfolio!.byBusiness).toHaveLength(1);
    expect(String(portfolio!.byBusiness[0]!.entityId)).toBe(String(setup.entityId));
  });
});
