/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupLedger(t: ReturnType<typeof convexTest>) {
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
    const entityId = await ctx.db.insert("entities", {
      workspaceId,
      name: "Acme Studio LLC",
      slug: "acme-studio-llc",
      businessType: "services",
      currency: "USD",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
    const cashId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Operating Checking",
      type: "asset",
      subtype: "bank",
      number: "1010",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const equityId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Owner's Equity",
      type: "equity",
      subtype: "equity",
      number: "3000",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const softwareId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Software & SaaS",
      type: "expense",
      subtype: "software",
      number: "5200",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const officeId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Office & Supplies",
      type: "expense",
      subtype: "office",
      number: "6000",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, entityId, cashId, equityId, softwareId, officeId };
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

describe("ledger core", () => {
  it("rejects unbalanced entries", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupLedger(t);
    const session = authed(t, ids.userId);

    await expect(
      session.mutation(api.ledger.postEntry, {
        entityId: ids.entityId,
        date: "2026-01-15",
        memo: "Bad entry",
        source: "manual",
        lines: [
          { accountId: ids.cashId, debitMinor: 10000, creditMinor: 0, currency: "USD" },
          { accountId: ids.equityId, debitMinor: 0, creditMinor: 9000, currency: "USD" },
        ],
      }),
    ).rejects.toThrow("debits must equal credits");
  });

  it("posts balanced entries and keeps the trial balance at zero", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupLedger(t);
    const session = authed(t, ids.userId);

    await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-01-15",
      memo: "Owner contribution",
      source: "manual",
      lines: [
        { accountId: ids.cashId, debitMinor: 10000, creditMinor: 0, currency: "USD" },
        { accountId: ids.equityId, debitMinor: 0, creditMinor: 10000, currency: "USD" },
      ],
    });

    const snapshot = await session.query(api.ledger.accountingSnapshot, {});
    expect(snapshot.trialBalance.differenceMinor).toBe(0);
    expect(snapshot.journalEntries).toHaveLength(1);
  });

  it("supports reversal and repost through postEntry", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupLedger(t);
    const session = authed(t, ids.userId);

    const original = await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-01-15",
      memo: "Original category",
      source: "manual",
      lines: [
        { accountId: ids.softwareId, debitMinor: 10000, creditMinor: 0, currency: "USD" },
        { accountId: ids.cashId, debitMinor: 0, creditMinor: 10000, currency: "USD" },
      ],
    });
    await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-01-16",
      memo: "Reverse original category",
      source: "manual",
      reversesEntryId: original.entryId,
      lines: [
        { accountId: ids.softwareId, debitMinor: 0, creditMinor: 10000, currency: "USD" },
        { accountId: ids.cashId, debitMinor: 10000, creditMinor: 0, currency: "USD" },
      ],
    });
    await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-01-16",
      memo: "Repost split category",
      source: "manual",
      sourceId: original.entryId,
      lines: [
        { accountId: ids.softwareId, debitMinor: 6000, creditMinor: 0, currency: "USD" },
        { accountId: ids.officeId, debitMinor: 4000, creditMinor: 0, currency: "USD" },
        { accountId: ids.cashId, debitMinor: 0, creditMinor: 10000, currency: "USD" },
      ],
    });

    const snapshot = await session.query(api.ledger.accountingSnapshot, {});
    expect(snapshot.trialBalance.differenceMinor).toBe(0);
    expect(snapshot.journalEntries).toHaveLength(3);
    expect(
      snapshot.journalEntries.some(
        (entry: { reversesEntryId: string | null }) => entry.reversesEntryId === original.entryId,
      ),
    ).toBe(true);
  });

  it("blocks posting into a locked period", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupLedger(t);
    const session = authed(t, ids.userId);

    await session.mutation(api.ledger.setPeriodLock, {
      entityId: ids.entityId,
      lockedThroughDate: "2026-01-31",
    });

    await expect(
      session.mutation(api.ledger.postEntry, {
        entityId: ids.entityId,
        date: "2026-01-15",
        memo: "Backdated entry",
        source: "manual",
        lines: [
          { accountId: ids.cashId, debitMinor: 10000, creditMinor: 0, currency: "USD" },
          { accountId: ids.equityId, debitMinor: 0, creditMinor: 10000, currency: "USD" },
        ],
      }),
    ).rejects.toThrow("Period is locked through 2026-01-31");
  });

  it("keeps the trial balance at zero across a deterministic random sequence", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupLedger(t);
    const session = authed(t, ids.userId);
    let seed = 42;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let index = 0; index < 40; index += 1) {
      const amountMinor = 100 + Math.floor(next() * 50000);
      const expenseAccountId = next() > 0.5 ? ids.softwareId : ids.officeId;
      await session.mutation(api.ledger.postEntry, {
        entityId: ids.entityId,
        date: `2026-02-${String((index % 20) + 1).padStart(2, "0")}`,
        memo: `Generated balanced entry ${index + 1}`,
        source: "manual",
        lines: [
          { accountId: expenseAccountId, debitMinor: amountMinor, creditMinor: 0, currency: "USD" },
          { accountId: ids.cashId, debitMinor: 0, creditMinor: amountMinor, currency: "USD" },
        ],
      });
    }

    const snapshot = await session.query(api.ledger.accountingSnapshot, {});
    expect(snapshot.trialBalance.differenceMinor).toBe(0);
  });

  it("creates one live sandbox entity with its own chart of accounts", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupLedger(t);
    const session = authed(t, ids.userId);

    const first = await session.mutation(api.ledger.ensureLiveSandboxEntity, {});
    const second = await session.mutation(api.ledger.ensureLiveSandboxEntity, {});

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.entityId).toBe(first.entityId);

    const verification = await t.run(async (ctx) => {
      const entity = await ctx.db.get(first.entityId);
      const accounts = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", first.entityId))
        .collect();
      const auditEvents = await ctx.db
        .query("auditEvents")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", entity!.workspaceId))
        .collect();
      return { entity, accounts, auditEvents };
    });

    expect(verification.entity?.name).toBe("Live Sandbox");
    expect(verification.entity?.slug).toBe("live-sandbox");
    expect(verification.entity?.isDemo).toBe(false);
    expect(verification.accounts.length).toBeGreaterThanOrEqual(30);
    expect(verification.auditEvents.some((event) => event.action === "entity.live_sandbox.created")).toBe(true);
  });

  it("requires an authorized workspace role to post", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupLedger(t);

    await expect(
      t.mutation(api.ledger.postEntry, {
        entityId: ids.entityId,
        date: "2026-01-15",
        memo: "Unauthorized",
        source: "manual",
        lines: [
          { accountId: ids.cashId, debitMinor: 10000, creditMinor: 0, currency: "USD" },
          { accountId: ids.equityId, debitMinor: 0, creditMinor: 10000, currency: "USD" },
        ],
      }),
    ).rejects.toThrow("OpenBooks requires sign-in");
  });
});
