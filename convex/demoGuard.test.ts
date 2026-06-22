/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function authed(t: TestConvex<typeof schema>, userId: Id<"users">, email: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: `test|${email}`,
    issuer: "test",
    email,
  });
}

/**
 * Provision + seed the public demo workspace and return the system actor + demo
 * entity. The seed runs as the system actor (no session), exactly like the cron.
 */
async function setupSeededDemo(t: TestConvex<typeof schema>) {
  const ids = await t.mutation(internal.publicDemo.ensurePublicDemoWorkspace, {});
  await t.action(internal.publicDemo.seedPublicDemo, {});
  return ids;
}

describe("public demo read isolation (E11-T5)", () => {
  it("the no-login demo read context resolves ONLY to the public demo workspace; a signed-in user is unaffected", async () => {
    const t = convexTest(schema, modules);
    const demo = await setupSeededDemo(t);

    // A real, separate workspace that must never be returned by the demo read.
    const ownerId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "real@example.com", name: "Real Owner" }),
    );
    const owner = authed(t, ownerId, "real@example.com");
    const realWs = await owner.mutation(api.onboarding.bootstrapWorkspace, {
      businesses: [{ name: "Real Co", businessType: "services" }],
    });

    // Unauthenticated viewer (no identity, no anonymous auth) → demo context.
    const anonViewer = await t.query(api.session.viewer, {});
    expect(anonViewer.status).toBe("demo");
    expect(anonViewer.isDemo).toBe(true);
    expect(anonViewer.readOnly).toBe(true);
    expect(anonViewer.workspace?.id).toBe(demo.workspaceId);
    // It can NEVER be the real workspace.
    expect(anonViewer.workspace?.id).not.toBe(realWs.workspaceId);
    expect(anonViewer.user).toBe(null);

    // The unauthenticated demo data read is scoped to the demo workspace.
    const demoView = await t.query(api.demo.demoView, {});
    expect(demoView.available).toBe(true);
    const demoContext = await t.query(api.demo.demoContext, {});
    expect(demoContext.available).toBe(true);
    if (demoContext.available) {
      expect(demoContext.workspace.id).toBe(demo.workspaceId);
      expect(demoContext.readOnly).toBe(true);
    }

    // A SIGNED-IN real user still resolves their OWN workspace, never the demo.
    const realViewer = await owner.query(api.session.viewer, {});
    expect(realViewer.workspace?.id).toBe(realWs.workspaceId);
    expect(realViewer.isDemo).toBe(false);
    expect(realViewer.status).not.toBe("demo");
  });

  it("requireWorkspaceRead allows the demo workspace without auth but a real workspace needs membership", async () => {
    const t = convexTest(schema, modules);
    const demo = await t.mutation(internal.publicDemo.ensurePublicDemoWorkspace, {});

    const ownerId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "rwr@example.com", name: "RWR" }),
    );
    const owner = authed(t, ownerId, "rwr@example.com");
    const realWs = await owner.mutation(api.onboarding.bootstrapWorkspace, {
      businesses: [{ name: "RWR Co", businessType: "services" }],
    });

    await t.run(async (ctx) => {
      const { requireWorkspaceRead } = await import("./demoWorkspace");
      // No auth in this t.run context → demo workspace read is allowed…
      const ws = await requireWorkspaceRead(ctx, demo.workspaceId);
      expect(ws._id).toBe(demo.workspaceId);
      // …but a real workspace read with no membership throws.
      await expect(
        requireWorkspaceRead(ctx, realWs.workspaceId as Id<"workspaces">),
      ).rejects.toThrow();
    });
  });
});

describe("public demo write guard (E11-T6)", () => {
  it("blocks every representative write mutation/action that targets the public demo, but internal re-seed still works", async () => {
    const t = convexTest(schema, modules);
    const demo = await setupSeededDemo(t);
    const entityId = demo.entityId;

    // Resolve a demo bank account + a real posting account for the attempts.
    const refs = await t.run(async (ctx) => {
      const bank = await ctx.db
        .query("bankAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .first();
      const accounts = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .collect();
      const cash = accounts.find((a) => a.number === "1010");
      const sales = accounts.find((a) => a.number === "4000");
      const run = await ctx.db
        .query("payrollRuns")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .first();
      return {
        bankAccountId: bank?._id ?? null,
        cashId: cash?._id ?? null,
        salesId: sales?._id ?? null,
        runId: run?._id ?? null,
      };
    });

    // A signed-in user with NO membership in the demo would normally fail authz
    // first, so to PROVE the demo guard itself fires, give a user owner-equivalent
    // access to the demo workspace, then assert each write still throws because the
    // TARGET is the demo (the guard keys on the workspace, not the caller).
    const intruderId = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("users", { email: "intruder@example.com", name: "Intruder" });
      await ctx.db.insert("workspaceMembers", {
        workspaceId: demo.workspaceId,
        userId: id,
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      return id;
    });
    const intruder = authed(t, intruderId, "intruder@example.com");

    // 1) Ledger post.
    if (refs.cashId && refs.salesId) {
      await expect(
        intruder.mutation(api.ledger.postEntry, {
          entityId,
          date: "2026-06-15",
          memo: "demo write attempt",
          source: "manual",
          lines: [
            { accountId: refs.cashId, debitMinor: 1000, creditMinor: 0, currency: "USD" },
            { accountId: refs.salesId, debitMinor: 0, creditMinor: 1000, currency: "USD" },
          ],
        }),
      ).rejects.toThrow(/read-only demo/i);
    }

    // 2) Pipeline route (a new transaction).
    if (refs.bankAccountId) {
      await expect(
        intruder.mutation(api.pipeline.routeTransaction, {
          entityId,
          bankAccountId: refs.bankAccountId,
          date: "2026-06-15",
          amountMinor: -1234,
          currency: "USD",
          merchant: "Demo Write Attempt",
          rawDescription: "should be blocked",
          status: "posted",
          source: "bank",
          externalId: "demo-write-attempt-1",
        }),
      ).rejects.toThrow(/read-only demo/i);
    }

    // 3) Period lock.
    await expect(
      intruder.mutation(api.ledger.setPeriodLock, { entityId, lockedThroughDate: "2026-05-31" }),
    ).rejects.toThrow(/read-only demo/i);

    // 4) Rule save.
    await expect(
      intruder.mutation(api.rules.save, {
        entityId,
        name: "Demo rule",
        merchantContains: "Demo",
        direction: "outflow",
        categoryAccountId: refs.salesId!,
        autoPost: false,
      }),
    ).rejects.toThrow(/read-only demo/i);

    // 5) Contact create.
    await expect(
      intruder.mutation(api.contacts.createContact, {
        entityId,
        name: "Demo Contact",
        roles: ["customer"],
      }),
    ).rejects.toThrow(/read-only demo/i);

    // 6) Payroll draft (startRun).
    await expect(
      intruder.mutation(api.payroll.startRun, { entityId, period: "2026-07" }),
    ).rejects.toThrow(/read-only demo/i);

    // The INTERNAL re-seed (system actor / cron path) still succeeds — proving
    // the guard exempts internal callers.
    const reseed = await t.action(internal.publicDemo.resetAndSeedPublicDemo, { force: true });
    expect(reseed.reset).toBe(true);
  });
});
