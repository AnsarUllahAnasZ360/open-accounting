/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// E14-T5 — automated authz rejection tests. A representative function per
// category must reject (a) anonymous callers and (b) cross-workspace callers
// (a member of workspace A targeting an entity/connection in workspace B). This
// is the executable counterpart to the authz coverage matrix in
// docs/finishing/security-audit.md and the scripts/authz-coverage.mjs gate.

async function seedWorkspace(
  t: TestConvex<typeof schema>,
  opts: { name: string; slug: string; ownerEmail: string },
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: opts.ownerEmail, name: `${opts.name} Owner` });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: opts.name,
      slug: opts.slug,
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
      name: `${opts.name} Entity`,
      slug: `${opts.slug}-entity`,
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
      name: "Operating Checking",
      type: "asset",
      subtype: "checking",
      currency: "USD",
      isSystem: true,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const incomeId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      number: "4000",
      name: "Services Revenue",
      type: "income",
      subtype: "services",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const connectionId = await ctx.db.insert("financialConnections", {
      workspaceId,
      entityId,
      provider: "plaid",
      mode: "sandbox",
      displayName: `${opts.name} bank`,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { userId, workspaceId, entityId, cashId, incomeId, connectionId };
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">, tag: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: `test|${tag}`,
    issuer: "test",
    email: "owner@example.com",
  });
}

describe("authz coverage — representative functions reject anonymous and cross-workspace callers (E14-T5)", () => {
  it("view query (reportViews.reportPack) rejects anonymous and cross-workspace", async () => {
    const t = convexTest(schema, modules);
    const a = await seedWorkspace(t, { name: "Workspace A", slug: "ws-a", ownerEmail: "a@example.com" });
    const b = await seedWorkspace(t, { name: "Workspace B", slug: "ws-b", ownerEmail: "b@example.com" });
    const args = {
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      basis: "accrual" as const,
      compare: "none" as const,
      columnMode: "total" as const,
    };

    // (a) anonymous
    await expect(t.query(api.reportViews.reportPack, { entityId: a.entityId, ...args })).rejects.toThrow(
      "OpenBooks requires sign-in",
    );

    // (b) member of A targeting B's entity
    const sessionA = authed(t, a.userId, "ws-a");
    await expect(sessionA.query(api.reportViews.reportPack, { entityId: b.entityId, ...args })).rejects.toThrow(
      "do not have access to this OpenBooks workspace",
    );
  });

  it("ledger mutation (ledger.postEntry) rejects anonymous and cross-workspace", async () => {
    const t = convexTest(schema, modules);
    const a = await seedWorkspace(t, { name: "Workspace A", slug: "ws-a", ownerEmail: "a@example.com" });
    const b = await seedWorkspace(t, { name: "Workspace B", slug: "ws-b", ownerEmail: "b@example.com" });

    const entry = {
      date: "2026-01-05",
      memo: "Cash sale",
      source: "manual" as const,
      lines: [
        { accountId: a.cashId, debitMinor: 100_00, creditMinor: 0, currency: "USD" },
        { accountId: a.incomeId, debitMinor: 0, creditMinor: 100_00, currency: "USD" },
      ],
    };

    // (a) anonymous
    await expect(t.mutation(api.ledger.postEntry, { entityId: a.entityId, ...entry })).rejects.toThrow(
      "OpenBooks requires sign-in",
    );

    // (b) member of A posting into B's entity
    const sessionA = authed(t, a.userId, "ws-a");
    await expect(sessionA.mutation(api.ledger.postEntry, { entityId: b.entityId, ...entry })).rejects.toThrow(
      "do not have access",
    );

    // Control: A posting into A's OWN entity succeeds.
    const ok = await sessionA.mutation(api.ledger.postEntry, { entityId: a.entityId, ...entry });
    expect(ok.entryId).toBeDefined();
  });

  it("connections mutation (connections.disconnect) rejects anonymous and cross-workspace", async () => {
    const t = convexTest(schema, modules);
    const a = await seedWorkspace(t, { name: "Workspace A", slug: "ws-a", ownerEmail: "a@example.com" });
    const b = await seedWorkspace(t, { name: "Workspace B", slug: "ws-b", ownerEmail: "b@example.com" });

    // (a) anonymous
    await expect(t.mutation(api.connections.disconnect, { connectionId: a.connectionId })).rejects.toThrow(
      "OpenBooks requires sign-in",
    );

    // (b) member of A disconnecting B's connection
    const sessionA = authed(t, a.userId, "ws-a");
    await expect(sessionA.mutation(api.connections.disconnect, { connectionId: b.connectionId })).rejects.toThrow(
      "do not have access or permission",
    );
  });

  it("settings mutation (settings.setNotification) rejects anonymous callers", async () => {
    const t = convexTest(schema, modules);
    await seedWorkspace(t, { name: "Workspace A", slug: "ws-a", ownerEmail: "a@example.com" });

    await expect(t.mutation(api.settings.setNotification, { key: "digest", enabled: true })).rejects.toThrow(
      "OpenBooks requires sign-in",
    );
  });

  it("action (aiInsights.generateInsights) rejects anonymous callers via its delegated guarded query", async () => {
    const t = convexTest(schema, modules);
    await seedWorkspace(t, { name: "Workspace A", slug: "ws-a", ownerEmail: "a@example.com" });

    // The action gathers its aggregate through a guarded view query first, so an
    // anonymous caller is rejected before any model call.
    await expect(t.action(api.aiInsights.generateInsights, { section: "transactions" })).rejects.toThrow(
      "OpenBooks requires sign-in",
    );
  });
});
