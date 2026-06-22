/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("public demo workspace (E11-T4 / E11-T8)", () => {
  it("ensure + seed yields a populated, system-owned, balanced demo; re-running is idempotent + deterministic", async () => {
    const t = convexTest(schema, modules);

    // Provision twice — idempotent: exactly one workspace + one entity, no dupes.
    const first = await t.mutation(internal.publicDemo.ensurePublicDemoWorkspace, {});
    const second = await t.mutation(internal.publicDemo.ensurePublicDemoWorkspace, {});
    expect(second.workspaceId).toBe(first.workspaceId);
    expect(second.entityId).toBe(first.entityId);

    const provisionCheck = await t.run(async (ctx) => {
      const demoWorkspaces = (await ctx.db.query("workspaces").collect()).filter(
        (w) => w.isDemo === true && w.demoKind === "public",
      );
      const entities = await ctx.db
        .query("entities")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", first.workspaceId))
        .collect();
      // The only member of the demo workspace is the synthetic system user — NO
      // real user's membership points at it (E11-T4 DoD).
      const members = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", first.workspaceId))
        .collect();
      const memberUsers = await Promise.all(members.map((m) => ctx.db.get(m.userId)));
      return {
        demoWorkspaceCount: demoWorkspaces.length,
        entityCount: entities.length,
        memberCount: members.length,
        memberEmails: memberUsers.map((u) => u?.email ?? null),
      };
    });
    expect(provisionCheck.demoWorkspaceCount).toBe(1);
    expect(provisionCheck.entityCount).toBe(1);
    expect(provisionCheck.memberCount).toBe(1);
    expect(provisionCheck.memberEmails).toEqual(["system+public-demo@openbooks.local"]);

    // Seed the demo entity with the full shared dataset.
    const seed = await t.action(internal.publicDemo.seedPublicDemo, {});
    expect(seed.transactionCount).toBeGreaterThan(0);
    expect(seed.postedCount).toBeGreaterThan(0);
    // The whole point: a balanced trial balance (reuse the seed verification).
    expect(seed.trialBalanceDifferenceMinor).toBe(0);

    const afterSeed = await t.run(async (ctx) => {
      const txns = await ctx.db
        .query("transactions")
        .withIndex("by_entity", (q) => q.eq("entityId", first.entityId))
        .collect();
      const entries = await ctx.db
        .query("journalEntries")
        .withIndex("by_entity", (q) => q.eq("entityId", first.entityId))
        .collect();
      const verification = await ctx.runQuery(internal.reports.seedVerificationInternal, {
        entityId: first.entityId,
      });
      // No row created by the seed may carry a credential/token (E11-T4 DoD).
      const connectionCreds = await ctx.db.query("connectionCredentials").collect();
      const creds = await ctx.db.query("credentials").collect();
      return {
        txnCount: txns.length,
        entryCount: entries.length,
        trialBalanceDifferenceMinor: verification.trialBalanceDifferenceMinor,
        postedTransactionCount: verification.postedTransactionCount,
        connectionCredCount: connectionCreds.length,
        credCount: creds.length,
      };
    });
    expect(afterSeed.txnCount).toBeGreaterThan(0);
    expect(afterSeed.entryCount).toBeGreaterThan(0);
    expect(afterSeed.trialBalanceDifferenceMinor).toBe(0);
    expect(afterSeed.postedTransactionCount).toBeGreaterThan(0);
    // SECURITY: the seed never wrote any credential/token.
    expect(afterSeed.connectionCredCount).toBe(0);
    expect(afterSeed.credCount).toBe(0);

    // E11-T8: reset+re-seed (force, since OPENBOOKS_PUBLIC_DEMO_ENABLED is unset
    // in tests) is deterministic — same txn count + balanced trial balance — and
    // never duplicates the workspace/entity.
    const reset1 = await t.action(internal.publicDemo.resetAndSeedPublicDemo, { force: true });
    const reset2 = await t.action(internal.publicDemo.resetAndSeedPublicDemo, { force: true });
    expect(reset1.reset).toBe(true);
    expect(reset2.reset).toBe(true);
    if (reset1.reset && reset2.reset) {
      expect(reset2.transactionCount).toBe(reset1.transactionCount);
      expect(reset1.trialBalanceDifferenceMinor).toBe(0);
      expect(reset2.trialBalanceDifferenceMinor).toBe(0);
    }

    const afterReset = await t.run(async (ctx) => {
      const demoWorkspaces = (await ctx.db.query("workspaces").collect()).filter(
        (w) => w.isDemo === true && w.demoKind === "public",
      );
      const entities = await ctx.db
        .query("entities")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", first.workspaceId))
        .collect();
      const resetAudits = (
        await ctx.db
          .query("auditEvents")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", first.workspaceId))
          .collect()
      ).filter((a) => a.action === "demo.public.reseeded");
      return {
        demoWorkspaceCount: demoWorkspaces.length,
        entityCount: entities.length,
        resetAuditCount: resetAudits.length,
      };
    });
    // Still exactly one workspace + one entity after two resets.
    expect(afterReset.demoWorkspaceCount).toBe(1);
    expect(afterReset.entityCount).toBe(1);
    // An observability row was recorded for each reset (E11-T8 DoD).
    expect(afterReset.resetAuditCount).toBe(2);
  });

  it("resetAndSeedPublicDemo is a NO-OP when OPENBOOKS_PUBLIC_DEMO_ENABLED is unset and not forced", async () => {
    const t = convexTest(schema, modules);
    const result = await t.action(internal.publicDemo.resetAndSeedPublicDemo, {});
    expect(result.reset).toBe(false);
    if (!result.reset) {
      expect(result.reason).toBe("public_demo_disabled");
    }
  });
});
