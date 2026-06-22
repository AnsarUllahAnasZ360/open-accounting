import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { ownerEmail, requireAnyWorkspacePermission } from "./authz";

// ---------------------------------------------------------------------------
// TWO distinct reset paths — do not confuse them (Epic E11-T7):
//
//   1. THIS FILE — `startFullRebuild` / `finalizeZ360Only`: the GLOBAL DEV
//      REBUILD. Deletes ALL rows across ALL workspaces AND users, then bootstraps
//      a single owner workspace (Z360). Gated behind the env flag
//      OPENBOOKS_REAL_TEST_RESET_ENABLED=1 and the fixed phrase below, so it is
//      dev/owner-only and never reachable in a normal deployment. Writes a
//      `workspace.global_reset` audit row.
//
//   2. `workspaceReset.resetWorkspace` (Epic E11-T3): the OWNER-FACING FACTORY
//      RESET. Deletes ONLY the caller's workspace's books/connections/txns,
//      never users / other workspaces, re-typed by the WORKSPACE NAME, and
//      returns the workspace to onboarding. Writes a `workspace.reset.factory`
//      audit row.
//
// If you are adding an owner-visible "delete all my data" affordance, it belongs
// in (2), NOT here. This file stays the dev rebuild tool.
// ---------------------------------------------------------------------------

const CONFIRMATION = "DELETE TEST DATA AND CREATE Z360";
const TARGET_WORKSPACE_NAME = "Z360";
const TARGET_WORKSPACE_SLUG = "z360";
const BATCH_LIMIT = 100;
const MAX_BATCHES = 2500;
const MAX_ARCHIVE_BATCHES = 250;

const RESET_TABLES = [
  "proposals",
  "chatThreads",
  "demoSeedJobs",
  "demoSeedRuns",
  "stripeWebhookEvents",
  "stripePayoutLines",
  "stripePayouts",
  "financialConnections",
  "stripeOAuthStates",
  "stripeAccounts",
  "plaidItems",
  "bankAccounts",
  "documents",
  "inboxItems",
  "transactionComments",
  "transactions",
  "aiBatchRuns",
  "aiEvalRuns",
  "aiCorrectionMemories",
  "aiConfigs",
  "rules",
  "contacts",
  "payrollRunLines",
  "payrollRuns",
  "paySchedules",
  "employees",
  "bills",
  "invoices",
  "journalLines",
  "journalEntries",
  "periodLocks",
  "ledgerAccounts",
  "systemActors",
  "auditEvents",
  "invites",
  "accessLeads",
  "onboardingChecklists",
  "workspaceSettings",
  "workspaceMembers",
  "entities",
  "userProfiles",
  "authRefreshTokens",
  "authVerificationCodes",
  "authVerifiers",
  "authRateLimits",
  "authSessions",
  "authAccounts",
  "users",
  "workspaces",
] as const;

type ResetTableName = (typeof RESET_TABLES)[number];
const ARCHIVE_RESET_TABLES: readonly ResetTableName[] = ["auditEvents", "authRefreshTokens"];
const PRIMARY_RESET_TABLES = RESET_TABLES.filter(
  (table) => !ARCHIVE_RESET_TABLES.includes(table),
);

async function previewTable(ctx: QueryCtx, table: ResetTableName) {
  const rows = await (ctx.db.query(table as never) as any).take(1001);
  return {
    table,
    count: Math.min(rows.length, 1000),
    truncated: rows.length > 1000,
  };
}

async function buildPreview(ctx: QueryCtx) {
  const { userId } = await requireAnyWorkspacePermission(ctx, "workspace.reset");
  const tables = await Promise.all(RESET_TABLES.map((table) => previewTable(ctx, table)));
  const totals = tables.reduce(
    (acc, table) => ({
      count: acc.count + table.count,
      truncated: acc.truncated || table.truncated,
    }),
    { count: 0, truncated: false },
  );
  return {
    actorUserId: userId,
    requiredConfirmation: CONFIRMATION,
    targetWorkspaceName: TARGET_WORKSPACE_NAME,
    targetWorkspaceSlug: TARGET_WORKSPACE_SLUG,
    enabled: process.env.OPENBOOKS_REAL_TEST_RESET_ENABLED === "1",
    bootstrap: {
      ownerEmailConfigured: Boolean(ownerEmail()),
      ownerPasswordConfigured: Boolean(process.env.OWNER_PASSWORD),
    },
    tables,
    totals,
  };
}

export const preview = query({
  args: {},
  handler: async (ctx) => {
    return await buildPreview(ctx);
  },
});

export const startFullRebuild = action({
  args: {
    confirmation: v.string(),
  },
  handler: async (ctx, args): Promise<{
    status: "completed";
    workspaceName: string;
    workspaceSlug: string;
    bootstrap: { status: string; reason?: string };
    batches: number;
    archiveRemaining: boolean;
  }> => {
    const dryRun = await ctx.runQuery(internal.realTestReset.previewInternal, {});
    const actorUserId = dryRun.actorUserId as Id<"users">;
    const jobId: Id<"realTestResetJobs"> = await ctx.runMutation(
      internal.realTestReset.createJob,
      {
        actorUserId,
        workspaceName: TARGET_WORKSPACE_NAME,
        confirmation: args.confirmation,
        enabled: dryRun.enabled,
        dryRunCounts: dryRun.tables,
      },
    );

    if (process.env.OPENBOOKS_REAL_TEST_RESET_ENABLED !== "1") {
      await ctx.runMutation(internal.realTestReset.failJob, {
        jobId,
        status: "blocked",
        error: "OPENBOOKS_REAL_TEST_RESET_ENABLED must be set to 1 in the target Convex deployment.",
      });
      throw new ConvexError("Real-test reset is disabled for this deployment.");
    }
    if (args.confirmation !== CONFIRMATION) {
      await ctx.runMutation(internal.realTestReset.failJob, {
        jobId,
        status: "blocked",
        error: `Confirmation must be exactly: ${CONFIRMATION}`,
      });
      throw new ConvexError(`Type exactly: ${CONFIRMATION}`);
    }
    if (!dryRun.bootstrap.ownerEmailConfigured || !dryRun.bootstrap.ownerPasswordConfigured) {
      await ctx.runMutation(internal.realTestReset.failJob, {
        jobId,
        status: "blocked",
        error: "Owner bootstrap is missing OWNER_EMAIL or OWNER_PASSWORD.",
      });
      throw new ConvexError("Owner bootstrap is missing OWNER_EMAIL or OWNER_PASSWORD.");
    }

    await ctx.runMutation(internal.realTestReset.markJobRunning, { jobId });

    let primaryBatches = 0;
    for (; primaryBatches < MAX_BATCHES; primaryBatches += 1) {
      const result: { deleted: number; remaining: boolean } = await ctx.runMutation(
        internal.realTestReset.deleteBatch,
        { limit: BATCH_LIMIT, phase: "primary" },
      );
      if (!result.remaining) break;
    }

    if (primaryBatches >= MAX_BATCHES) {
      await ctx.runMutation(internal.realTestReset.failJob, {
        jobId,
        status: "failed",
        error: "Primary reset stopped before completion. Increase MAX_BATCHES after reviewing dry-run counts.",
      });
      throw new ConvexError("Primary reset stopped before all app-visible rows were deleted.");
    }

    const bootstrap: { status: string; reason?: string } = await ctx.runAction(internal.authAdmin.bootstrapOwner, {
      workspaceName: TARGET_WORKSPACE_NAME,
      workspaceSlug: TARGET_WORKSPACE_SLUG,
    });

    let archiveBatches = 0;
    let archiveRemaining = false;
    try {
      for (; archiveBatches < MAX_ARCHIVE_BATCHES; archiveBatches += 1) {
        const result: { deleted: number; remaining: boolean } = await ctx.runMutation(
          internal.realTestReset.deleteBatch,
          { limit: BATCH_LIMIT, phase: "archive" },
        );
        archiveRemaining = result.remaining;
        if (!result.remaining) break;
      }
    } catch (error) {
      archiveRemaining = true;
    }

    await ctx.runMutation(internal.realTestReset.completeJob, {
      jobId,
      batchesDeleted: primaryBatches + archiveBatches,
      archiveRemaining,
    });

    // E11-T7: record an `auditEvents` row for the GLOBAL dev rebuild. Written
    // AFTER the archive phase (which wipes auditEvents) so it survives the run,
    // and AFTER bootstrap recreated the owner so the actor + workspace exist.
    // Distinct action `workspace.global_reset` vs the per-workspace owner factory
    // reset's `workspace.reset.factory` (workspaceReset.ts) so the two never blur.
    await ctx.runMutation(internal.realTestReset.recordGlobalResetAudit, {
      actorUserId,
      batches: primaryBatches + archiveBatches,
      tableCount: RESET_TABLES.length,
    });

    return {
      status: "completed" as const,
      workspaceName: TARGET_WORKSPACE_NAME,
      workspaceSlug: TARGET_WORKSPACE_SLUG,
      bootstrap,
      batches: primaryBatches + archiveBatches,
      archiveRemaining,
    };
  },
});

export const finalizeZ360Only = mutation({
  args: {
    confirmation: v.string(),
  },
  handler: async (ctx, args) => {
    if (process.env.OPENBOOKS_REAL_TEST_RESET_ENABLED !== "1") {
      throw new ConvexError("Real-test reset is disabled for this deployment.");
    }
    if (args.confirmation !== CONFIRMATION) {
      throw new ConvexError(`Type exactly: ${CONFIRMATION}`);
    }

    const email = ownerEmail();
    if (!email) {
      throw new ConvexError("OWNER_EMAIL is required to finalize the Z360 workspace.");
    }

    const now = Date.now();
    const users = await ctx.db.query("users").take(100);
    const owner = users.find((user) => user.email === email);
    if (!owner) {
      throw new ConvexError("Owner account does not exist. Run authAdmin:bootstrapOwner first.");
    }

    let z360 = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", TARGET_WORKSPACE_SLUG))
      .unique();
    if (z360) {
      await ctx.db.patch(z360._id, {
        name: TARGET_WORKSPACE_NAME,
        updatedAt: now,
      });
      z360 = (await ctx.db.get(z360._id))!;
    } else {
      const workspaceId = await ctx.db.insert("workspaces", {
        name: TARGET_WORKSPACE_NAME,
        slug: TARGET_WORKSPACE_SLUG,
        createdAt: now,
        updatedAt: now,
      });
      z360 = (await ctx.db.get(workspaceId))!;
    }

    let deleted = 0;
    const memberships = await ctx.db.query("workspaceMembers").take(1000);
    for (const membership of memberships) {
      if (membership.workspaceId !== z360._id) {
        await ctx.db.delete(membership._id);
        deleted += 1;
      }
    }

    const existingOwnerMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_user_and_workspace", (q) =>
        q.eq("userId", owner._id).eq("workspaceId", z360._id),
      )
      .unique();
    if (existingOwnerMembership) {
      await ctx.db.patch(existingOwnerMembership._id, {
        role: "owner",
        status: "active",
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("workspaceMembers", {
        workspaceId: z360._id,
        userId: owner._id,
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    }

    const settings = await ctx.db.query("workspaceSettings").take(1000);
    let hasZ360Settings = false;
    for (const setting of settings) {
      if (setting.workspaceId === z360._id) {
        hasZ360Settings = true;
        await ctx.db.patch(setting._id, {
          appName: "OpenBooks",
          defaultCurrency: "USD",
          fiscalYearStartMonth: 1,
          updatedAt: now,
        });
      } else {
        await ctx.db.delete(setting._id);
        deleted += 1;
      }
    }
    if (!hasZ360Settings) {
      await ctx.db.insert("workspaceSettings", {
        workspaceId: z360._id,
        appName: "OpenBooks",
        defaultCurrency: "USD",
        fiscalYearStartMonth: 1,
        updatedAt: now,
      });
    }

    const workspaces = await ctx.db.query("workspaces").take(1000);
    for (const workspace of workspaces) {
      if (workspace._id !== z360._id) {
        await ctx.db.delete(workspace._id);
        deleted += 1;
      }
    }

    // E11-T7: audit the GLOBAL finalize path too (distinct from the per-workspace
    // owner factory reset).
    await ctx.db.insert("auditEvents", {
      workspaceId: z360._id,
      actorUserId: owner._id,
      action: "workspace.global_reset",
      entityType: "workspace",
      entityId: z360._id,
      summary: `GLOBAL finalize: pruned ${deleted} non-${TARGET_WORKSPACE_NAME} rows and pinned ${TARGET_WORKSPACE_NAME} as the only workspace.`,
      createdAt: now,
    });

    return {
      status: "completed",
      deleted,
      workspaceId: z360._id,
      workspaceName: TARGET_WORKSPACE_NAME,
      workspaceSlug: TARGET_WORKSPACE_SLUG,
    };
  },
});

export const previewInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await buildPreview(ctx);
  },
});

export const createJob = internalMutation({
  args: {
    actorUserId: v.optional(v.id("users")),
    workspaceName: v.string(),
    confirmation: v.string(),
    enabled: v.boolean(),
    dryRunCounts: v.any(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("realTestResetJobs", {
      actorUserId: args.actorUserId,
      workspaceName: args.workspaceName,
      confirmation: args.confirmation,
      status: args.enabled ? "previewed" : "blocked",
      dryRunCounts: args.dryRunCounts,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const markJobRunning = internalMutation({
  args: { jobId: v.id("realTestResetJobs") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, { status: "running", updatedAt: Date.now() });
  },
});

export const completeJob = internalMutation({
  args: {
    jobId: v.id("realTestResetJobs"),
    batchesDeleted: v.number(),
    archiveRemaining: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "completed",
      batchesDeleted: args.batchesDeleted,
      archiveRemaining: args.archiveRemaining,
      updatedAt: Date.now(),
    });
  },
});

// E11-T7: write the GLOBAL-reset audit trail row. Resolves the (recreated) Z360
// workspace so the row is workspace-scoped + queryable by `by_workspace`.
export const recordGlobalResetAudit = internalMutation({
  args: {
    actorUserId: v.optional(v.id("users")),
    batches: v.number(),
    tableCount: v.number(),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", TARGET_WORKSPACE_SLUG))
      .unique();
    await ctx.db.insert("auditEvents", {
      workspaceId: workspace?._id,
      actorUserId: args.actorUserId,
      action: "workspace.global_reset",
      entityType: "workspace",
      entityId: workspace?._id,
      summary: `GLOBAL dev rebuild: deleted ${args.tableCount} tables across ALL workspaces/users in ${args.batches} batches, then recreated ${TARGET_WORKSPACE_NAME}.`,
      createdAt: Date.now(),
    });
  },
});

export const failJob = internalMutation({
  args: {
    jobId: v.id("realTestResetJobs"),
    status: v.union(v.literal("blocked"), v.literal("failed")),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: args.status,
      error: args.error,
      updatedAt: Date.now(),
    });
  },
});

export const deleteBatch = internalMutation({
  args: {
    limit: v.number(),
    phase: v.optional(v.union(v.literal("all"), v.literal("primary"), v.literal("archive"))),
  },
  handler: async (ctx, args) => {
    let deleted = 0;
    let remaining = false;
    const tables =
      args.phase === "primary"
        ? PRIMARY_RESET_TABLES
        : args.phase === "archive"
          ? ARCHIVE_RESET_TABLES
          : RESET_TABLES;

    for (const table of tables) {
      const capacity = Math.max(0, Math.min(args.limit - deleted, BATCH_LIMIT));
      if (capacity === 0) {
        remaining = true;
        break;
      }
      const rows = await (ctx.db.query(table as never) as any).take(capacity + 1);
      if (rows.length > capacity) remaining = true;
      for (const row of rows.slice(0, capacity)) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
      if (deleted >= args.limit) break;
    }

    if (!remaining) {
      for (const table of tables) {
        const rows = await (ctx.db.query(table as never) as any).take(1);
        if (rows.length > 0) {
          remaining = true;
          break;
        }
      }
    }

    return { deleted, remaining };
  },
});
