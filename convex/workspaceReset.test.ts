/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
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

describe("scoped workspace reset (E4-T10)", () => {
  it("empties only the active workspace and returns the viewer to needs_onboarding, leaving other workspaces + the user intact", async () => {
    const t = convexTest(schema, modules);

    // Owner with a fully bootstrapped workspace (chart + default bank per business).
    const ownerId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "reset-owner@example.com", name: "Reset Owner" }),
    );
    const owner = authed(t, ownerId, "reset-owner@example.com");
    const created = await owner.mutation(api.onboarding.bootstrapWorkspace, {
      businesses: [{ name: "Reset Co", businessType: "services" }],
    });
    const workspaceId = created.workspaceId as Id<"workspaces">;
    const entityId = created.entityIds[0] as Id<"entities">;

    // Add some workspace-scoped + entity-scoped data so the reset has rows to walk.
    await owner.mutation(api.onboarding.setOpeningBalances, {
      lines: [{ entityId, balanceMinor: 750000, startDate: "2026-01-15" }],
    });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("credentials", {
        workspaceId,
        kind: "ai",
        provider: "openai",
        encryptedPayload: "enc",
        fingerprint: "fp",
        keyPreview: "••••4242",
        status: "active",
        createdAt: now,
        updatedAt: now,
      } as never);
      await ctx.db.insert("transactions", {
        entityId,
        date: "2026-02-02",
        amountMinor: -1200,
        currency: "USD",
        merchant: "Test Vendor",
        rawDescription: "test",
        status: "posted",
        review: "needs_review",
        source: "bank",
        externalId: "reset-test-1",
        evalSet: false,
        createdAt: now,
        updatedAt: now,
      } as never);
    });

    // A SEPARATE workspace owned by a different user that must NOT be touched.
    const otherUserId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "other-owner@example.com", name: "Other Owner" }),
    );
    const other = authed(t, otherUserId, "other-owner@example.com");
    const otherCreated = await other.mutation(api.onboarding.bootstrapWorkspace, {
      businesses: [{ name: "Untouched Co", businessType: "software" }],
    });
    const otherWorkspaceId = otherCreated.workspaceId as Id<"workspaces">;
    const otherEntityId = otherCreated.entityIds[0] as Id<"entities">;

    // Confirmation must match the workspace name exactly.
    const workspaceName = (await owner.query(api.session.viewer, {})).workspace?.name ?? "";
    await expect(
      owner.action(api.workspaceReset.resetWorkspaceData, { confirmation: "wrong name" }),
    ).rejects.toThrow();

    const result = await owner.action(api.workspaceReset.resetWorkspaceData, {
      confirmation: workspaceName,
    });
    expect(result.status).toBe("completed");

    // The active workspace is emptied: no entities, no ledger, no connections, no txns.
    const after = await t.run(async (ctx) => {
      const entities = await ctx.db
        .query("entities")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
      const accounts = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .collect();
      const entries = await ctx.db
        .query("journalEntries")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .collect();
      const creds = await ctx.db
        .query("credentials")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
      const txns = await ctx.db
        .query("transactions")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .collect();
      const audit = await ctx.db
        .query("auditEvents")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
      const workspaceStill = await ctx.db.get(workspaceId);
      const ownerStill = await ctx.db.get(ownerId);
      // Other workspace untouched.
      const otherEntities = await ctx.db
        .query("entities")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", otherWorkspaceId))
        .collect();
      const otherAccounts = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", otherEntityId))
        .collect();
      return {
        entities: entities.length,
        accounts: accounts.length,
        entries: entries.length,
        creds: creds.length,
        txns: txns.length,
        resetAudits: audit.filter((a) => a.action === "workspace.reset.factory").length,
        workspaceStillExists: workspaceStill !== null,
        ownerStillExists: ownerStill !== null,
        otherEntities: otherEntities.length,
        otherAccounts: otherAccounts.length,
      };
    });

    expect(after.entities).toBe(0);
    expect(after.accounts).toBe(0);
    expect(after.entries).toBe(0);
    expect(after.creds).toBe(0);
    expect(after.txns).toBe(0);
    // The workspace + owner survive so re-onboarding can recreate the books.
    expect(after.workspaceStillExists).toBe(true);
    expect(after.ownerStillExists).toBe(true);
    // An audit record was written (survives because the workspace survives).
    expect(after.resetAudits).toBe(1);
    // The OTHER workspace is fully intact.
    expect(after.otherEntities).toBe(1);
    expect(after.otherAccounts).toBeGreaterThan(30);

    // Viewer is back in onboarding for the reset owner; the other owner is ready.
    const viewerAfter = await owner.query(api.session.viewer, {});
    expect(viewerAfter.status).toBe("needs_onboarding");
    const otherViewer = await other.query(api.session.viewer, {});
    expect(otherViewer.status).toBe("ready");

    // Re-onboarding works: bootstrap recreates a business in the kept workspace.
    const reonboard = await owner.mutation(api.onboarding.bootstrapWorkspace, {
      businesses: [{ name: "Fresh Start Co", businessType: "agency" }],
    });
    expect(reonboard.alreadyOnboarded).toBe(false);
    const reonboarded = await owner.query(api.entities.list, {});
    expect(reonboarded.rows).toHaveLength(1);
    expect(reonboarded.rows[0].name).toBe("Fresh Start Co");
  });
});

describe("per-workspace factory reset (E11-T3)", () => {
  it("preview returns counts, resetWorkspace wipes only this workspace, writes a job + factory audit, and re-runs onboarding", async () => {
    const t = convexTest(schema, modules);

    const ownerId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "factory-owner@example.com", name: "Factory Owner" }),
    );
    const owner = authed(t, ownerId, "factory-owner@example.com");
    const created = await owner.mutation(api.onboarding.bootstrapWorkspace, {
      businesses: [{ name: "Factory Co", businessType: "services" }],
    });
    const workspaceId = created.workspaceId as Id<"workspaces">;
    const entityId = created.entityIds[0] as Id<"entities">;

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("transactions", {
        entityId,
        date: "2026-02-02",
        amountMinor: -2500,
        currency: "USD",
        merchant: "Office Supplies",
        rawDescription: "factory test",
        status: "posted",
        review: "needs_review",
        source: "bank",
        externalId: "factory-test-1",
        evalSet: false,
        createdAt: now,
        updatedAt: now,
      } as never);
    });

    // A second, untouched workspace.
    const otherUserId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "other-factory@example.com", name: "Other" }),
    );
    const other = authed(t, otherUserId, "other-factory@example.com");
    const otherCreated = await other.mutation(api.onboarding.bootstrapWorkspace, {
      businesses: [{ name: "Bystander Co", businessType: "software" }],
    });
    const otherEntityId = otherCreated.entityIds[0] as Id<"entities">;

    // Preview is owner-only and reports the workspace name + non-zero counts.
    const workspaceName = (await owner.query(api.session.viewer, {})).workspace?.name ?? "";
    const preview = await owner.query(api.workspaceReset.preview, {});
    expect(preview.requiredConfirmation).toBe(workspaceName);
    expect(preview.businessCount).toBe(1);
    expect(preview.totals.count).toBeGreaterThan(0);
    expect(preview.tables.some((row) => row.table === "ledgerAccounts")).toBe(true);

    // A non-owner ROLE in THIS workspace (accountant) cannot preview or reset.
    const accountantId = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("users", {
        email: "accountant@example.com",
        name: "Accountant",
      });
      await ctx.db.insert("workspaceMembers", {
        workspaceId,
        userId: id,
        role: "accountant",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      return id;
    });
    const accountant = authed(t, accountantId, "accountant@example.com");
    await expect(accountant.query(api.workspaceReset.preview, {})).rejects.toThrow();
    await expect(
      accountant.action(api.workspaceReset.resetWorkspace, { confirmation: workspaceName }),
    ).rejects.toThrow();

    // Wrong confirmation throws (no deletion).
    await expect(
      owner.action(api.workspaceReset.resetWorkspace, { confirmation: "Wrong Name" }),
    ).rejects.toThrow();

    // Canonical reset completes.
    const result = await owner.action(api.workspaceReset.resetWorkspace, {
      confirmation: workspaceName,
    });
    expect(result.status).toBe("completed");
    expect(result.deleted).toBeGreaterThan(0);

    const after = await t.run(async (ctx) => {
      const entities = await ctx.db
        .query("entities")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
      const txns = await ctx.db
        .query("transactions")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .collect();
      const factoryAudits = (
        await ctx.db
          .query("auditEvents")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .collect()
      ).filter((a) => a.action === "workspace.reset.factory");
      const jobs = await ctx.db
        .query("workspaceResetJobs")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
      const userStill = await ctx.db.get(ownerId);
      const otherEntities = await ctx.db
        .query("entities")
        .withIndex("by_workspace", (q) =>
          q.eq("workspaceId", otherCreated.workspaceId as Id<"workspaces">),
        )
        .collect();
      const otherTxnAccounts = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", otherEntityId))
        .collect();
      return {
        entities: entities.length,
        txns: txns.length,
        factoryAudits: factoryAudits.length,
        jobCompleted: jobs.filter((j) => j.status === "completed").length,
        userStill: userStill !== null,
        otherEntities: otherEntities.length,
        otherAccounts: otherTxnAccounts.length,
      };
    });

    expect(after.entities).toBe(0);
    expect(after.txns).toBe(0);
    expect(after.factoryAudits).toBe(1);
    expect(after.jobCompleted).toBe(1);
    expect(after.userStill).toBe(true);
    // The bystander workspace is intact.
    expect(after.otherEntities).toBe(1);
    expect(after.otherAccounts).toBeGreaterThan(30);

    // Viewer flips to needs_onboarding for the reset owner.
    const viewerAfter = await owner.query(api.session.viewer, {});
    expect(viewerAfter.status).toBe("needs_onboarding");
  });
});
