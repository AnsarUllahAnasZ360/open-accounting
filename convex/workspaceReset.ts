import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { requireAnyWorkspacePermission } from "./authz";
import { assertNotDemoWrite } from "./demoWorkspace";

// ---------------------------------------------------------------------------
// Owner-scoped workspace data reset / re-onboard (Epic E4-T10).
//
// A clean "delete all my data and start over" for the CURRENT workspace only —
// the scoped, reversible-via-re-onboarding counterpart to the destructive
// global realTestReset. It empties this workspace's books, connections, and
// transactions while keeping the workspace, the owner's membership, settings,
// and the user account, then resets the onboarding checklist so the guided
// first-run re-runs. Because the workspace now has zero active businesses,
// `session.viewer` reports `needs_onboarding` again (E4-T10 DoD).
//
// Local connection/credential rows are deleted; provider revoke APIs are NOT
// called (decided: see decisions.md) — this is a books reset, not a connector
// teardown. The single posting path is never touched.
// ---------------------------------------------------------------------------

const BATCH_LIMIT = 200;
const MAX_BATCHES = 5000;
// Per-table cap for the read-only preview counts (mirrors the global reset's
// dry-run behaviour). Counts above this show a `+` in the UI.
const COUNT_CAP = 2000;

// Entity-scoped tables (all carry `entityId` + a `by_entity` index). Order is
// children-before-parents where it matters; everything is hard-deleted, so the
// only constraint is that we walk lines before entries for readability.
const ENTITY_SCOPED_TABLES = [
  "journalLines",
  "journalEntries",
  "periodLocks",
  "bankReconciliations",
  "stripePayoutLines",
  "stripePayouts",
  "stripeAccounts",
  "plaidItems",
  "bankAccounts",
  "transactionComments",
  "documents",
  "receiptEmbeddings",
  "receiptTransactionEmbeddings",
  "inboxItems",
  "transactions",
  "aiBatchRuns",
  "aiEvalRuns",
  "aiMemoryEmbeddings",
  "aiCorrectionMemories",
  "rules",
  "contacts",
  "payrollRunLines",
  "payrollRuns",
  "paySchedules",
  "employees",
  "bills",
  "invoices",
  "demoSeedRuns",
  // onboardingQuestions carries both workspaceId and entityId but is keyed by
  // entity (its only indexes are by_entity / by_entity_and_run).
  "onboardingQuestions",
  "ledgerAccounts",
] as const;

// Workspace-scoped tables to empty (carry `workspaceId` + a `by_workspace`
// index). We KEEP `workspaceSettings` (needed for re-onboarding), the
// `workspaceMembers` row (the owner keeps access), and the `workspaces` row
// itself. `onboardingChecklists` is reset rather than deleted (below).
const WORKSPACE_SCOPED_TABLES = [
  "connectionCredentials",
  "credentials",
  "financialConnections",
  "stripeOAuthStates",
  "stripeWebhookEvents",
  "aiConfigs",
  "aiCalibrations",
  "intercompanyLinks",
  "proposals",
  "onboardingProposals",
  "chatThreads",
  "demoSeedJobs",
  "systemActors",
] as const;

type EntityTable = (typeof ENTITY_SCOPED_TABLES)[number];
type WorkspaceTable = (typeof WORKSPACE_SCOPED_TABLES)[number];

async function deleteByEntity(
  ctx: MutationCtx,
  table: EntityTable,
  entityId: Id<"entities">,
  budget: number,
): Promise<{ deleted: number; remaining: boolean }> {
  if (budget <= 0) return { deleted: 0, remaining: true };
  const rows = await (ctx.db.query(table as never) as any)
    .withIndex("by_entity", (q: any) => q.eq("entityId", entityId))
    .take(budget + 1);
  const remaining = rows.length > budget;
  let deleted = 0;
  for (const row of rows.slice(0, budget)) {
    await ctx.db.delete(row._id);
    deleted += 1;
  }
  return { deleted, remaining };
}

async function deleteByWorkspace(
  ctx: MutationCtx,
  table: WorkspaceTable,
  workspaceId: Id<"workspaces">,
  budget: number,
): Promise<{ deleted: number; remaining: boolean }> {
  if (budget <= 0) return { deleted: 0, remaining: true };
  // Filter on the `workspaceId` field rather than a named index: the
  // workspace-scoped tables expose DIFFERENT workspace index names (by_workspace,
  // by_workspace_and_provider, by_workspace_and_kind) or none at all
  // (stripeWebhookEvents). A bounded filtered scan is index-name-independent and
  // fine for a one-shot reset.
  const rows = await (ctx.db.query(table as never) as any)
    .filter((q: any) => q.eq(q.field("workspaceId"), workspaceId))
    .take(budget + 1);
  const remaining = rows.length > budget;
  let deleted = 0;
  for (const row of rows.slice(0, budget)) {
    await ctx.db.delete(row._id);
    deleted += 1;
  }
  return { deleted, remaining };
}

/**
 * Delete one bounded batch of the workspace's data. Walks every entity-scoped
 * table for each of the workspace's entities, then the workspace-scoped tables,
 * then the entities themselves (only once their dependent rows are gone). On the
 * final batch (nothing remaining) it resets the onboarding checklist + audit
 * trail so re-onboarding starts clean. Returns `{ deleted, remaining }`.
 */
export const resetBatch = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    actorUserId: v.id("users"),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    let deleted = 0;
    let remaining = false;

    const entities = await ctx.db
      .query("entities")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    // 1) Entity-scoped data for every business in the workspace.
    for (const entity of entities) {
      for (const table of ENTITY_SCOPED_TABLES) {
        const budget = args.limit - deleted;
        if (budget <= 0) return { deleted, remaining: true };
        const result = await deleteByEntity(ctx, table, entity._id, budget);
        deleted += result.deleted;
        if (result.remaining) remaining = true;
      }
    }

    // 2) Workspace-scoped data (connections, credentials, proposals, …).
    for (const table of WORKSPACE_SCOPED_TABLES) {
      const budget = args.limit - deleted;
      if (budget <= 0) return { deleted, remaining: true };
      const result = await deleteByWorkspace(ctx, table, args.workspaceId, budget);
      deleted += result.deleted;
      if (result.remaining) remaining = true;
    }

    // 3) The entities themselves — only after their dependent rows are cleared.
    if (!remaining) {
      for (const entity of entities) {
        const budget = args.limit - deleted;
        if (budget <= 0) return { deleted, remaining: true };
        await ctx.db.delete(entity._id);
        deleted += 1;
      }
    }

    if (deleted >= args.limit) {
      return { deleted, remaining: true };
    }

    // Confirm nothing is left across all scoped tables before finalizing.
    if (!remaining) {
      remaining = await anyScopedRowRemains(ctx, args.workspaceId);
    }

    if (!remaining) {
      await finalizeReset(ctx, args.workspaceId, args.actorUserId);
    }

    return { deleted, remaining };
  },
});

async function anyScopedRowRemains(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const entities = await ctx.db
    .query("entities")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(1);
  if (entities.length > 0) return true;
  for (const table of WORKSPACE_SCOPED_TABLES) {
    const rows = await (ctx.db.query(table as never) as any)
      .filter((q: any) => q.eq(q.field("workspaceId"), workspaceId))
      .take(1);
    if (rows.length > 0) return true;
  }
  return false;
}

/**
 * Reset the onboarding checklist to a fresh, unstarted setup phase and clear the
 * workspace's default-business pointer so the wizard re-runs cleanly. Defaults
 * (clears) the checklist booleans/step arrays in place rather than deleting the
 * row, so `getProgress` resumes at `business`. Keeps `workspaceSettings`.
 */
async function finalizeReset(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  actorUserId: Id<"users">,
) {
  const now = Date.now();

  const checklist = await ctx.db
    .query("onboardingChecklists")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  if (checklist) {
    await ctx.db.patch(checklist._id, {
      bankConnected: false,
      aiConnected: false,
      stripeConnected: false,
      firstInboxZero: false,
      firstReportViewed: false,
      currentStep: "business",
      completedSteps: [],
      skippedSteps: [],
      plunkConnected: false,
      teamInvited: false,
      openingBalancesSet: false,
      historyReviewed: false,
      proposalsReviewed: false,
      phase: "setup",
      updatedAt: now,
    });
  }

  // Drop the deleted default-business pointer so resolveDefaultEntity falls back.
  const workspace = await ctx.db.get(workspaceId);
  if (workspace?.defaultEntityId) {
    await ctx.db.patch(workspaceId, { defaultEntityId: undefined, updatedAt: now });
  }

  // The workspace survives, so this audit record survives the reset (E4-T10 /
  // E11-T3 DoD). Action `workspace.reset.factory` is the canonical owner-facing
  // factory reset — distinct from the dev global `workspace.global_reset`.
  await ctx.db.insert("auditEvents", {
    workspaceId,
    actorUserId,
    action: "workspace.reset.factory",
    entityType: "workspace",
    entityId: workspaceId,
    summary: "Owner reset this workspace to factory and restarted onboarding.",
    createdAt: now,
  });
}

/**
 * Per-workspace factory-reset PREVIEW (Epic E11-T3). Owner-only (gated on the
 * `workspace.reset` permission). Returns the typed-confirmation string (the
 * workspace name) plus per-table row counts so the Settings panel can show
 * exactly what will be deleted before the owner confirms. Read-only.
 */
export const preview = query({
  args: {},
  handler: async (ctx) => {
    const { membership } = await requireAnyWorkspacePermission(ctx, "workspace.reset");
    const workspace = await ctx.db.get(membership.workspaceId);
    if (!workspace) {
      throw new ConvexError("Active workspace not found.");
    }

    const entities = await ctx.db
      .query("entities")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .take(200);

    const tables: Array<{ table: string; count: number; truncated: boolean }> = [];
    let total = 0;

    // Entity-scoped row counts (bounded per table to stay cheap).
    for (const table of ENTITY_SCOPED_TABLES) {
      let count = 0;
      let truncated = false;
      for (const entity of entities) {
        const rows = await (ctx.db.query(table as never) as any)
          .withIndex("by_entity", (q: any) => q.eq("entityId", entity._id))
          .take(COUNT_CAP + 1);
        if (rows.length > COUNT_CAP) truncated = true;
        count += Math.min(rows.length, COUNT_CAP);
      }
      if (count > 0) tables.push({ table, count, truncated });
      total += count;
    }

    // Workspace-scoped row counts.
    for (const table of WORKSPACE_SCOPED_TABLES) {
      const rows = await (ctx.db.query(table as never) as any)
        .filter((q: any) => q.eq(q.field("workspaceId"), workspace._id))
        .take(COUNT_CAP + 1);
      const truncated = rows.length > COUNT_CAP;
      const count = Math.min(rows.length, COUNT_CAP);
      if (count > 0) tables.push({ table, count, truncated });
      total += count;
    }

    if (entities.length > 0) {
      tables.push({ table: "entities", count: entities.length, truncated: false });
      total += entities.length;
    }

    return {
      workspaceName: workspace.name,
      requiredConfirmation: workspace.name,
      businessCount: entities.length,
      totals: { count: total, truncated: tables.some((t) => t.truncated) },
      tables: tables.sort((a, b) => b.count - a.count),
    };
  },
});

export const resetContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { userId, membership } = await requireAnyWorkspacePermission(ctx, "workspace.reset");
    const workspace = await ctx.db.get(membership.workspaceId);
    if (!workspace) {
      throw new ConvexError("Active workspace not found.");
    }
    // E11-T6: the public demo workspace can never be factory-reset by a session
    // caller (it is wiped only by the internal cron). Belt-and-suspenders.
    await assertNotDemoWrite(ctx, workspace._id);
    return {
      actorUserId: userId,
      workspaceId: workspace._id,
      workspaceName: workspace.name,
    };
  },
});

// --- Job/audit-trail bookkeeping (Epic E11-T3) ------------------------------

export const startResetJob = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    actorUserId: v.id("users"),
    workspaceName: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return ctx.db.insert("workspaceResetJobs", {
      workspaceId: args.workspaceId,
      actorUserId: args.actorUserId,
      workspaceName: args.workspaceName,
      status: "running",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const finishResetJob = internalMutation({
  args: {
    jobId: v.id("workspaceResetJobs"),
    status: v.union(v.literal("completed"), v.literal("failed")),
    deletedCount: v.optional(v.number()),
    batches: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: args.status,
      deletedCount: args.deletedCount,
      batches: args.batches,
      error: args.error,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Shared runner for the per-workspace factory reset. Validates the typed
 * confirmation, records a `workspaceResetJobs` row, deletes ONLY this
 * workspace's data in bounded batches, then resets onboarding + writes the
 * `workspace.reset.factory` audit row (in `finalizeReset`). Other workspaces and
 * the user account are never touched.
 */
async function runWorkspaceReset(
  ctx: ActionCtx,
  confirmation: string,
): Promise<{ status: "completed"; deleted: number; workspaceName: string }> {
  const context = await ctx.runQuery(internal.workspaceReset.resetContext, {});
  if (confirmation.trim() !== context.workspaceName) {
    throw new ConvexError(`Type the workspace name exactly to confirm: ${context.workspaceName}`);
  }

  const jobId = await ctx.runMutation(internal.workspaceReset.startResetJob, {
    workspaceId: context.workspaceId,
    actorUserId: context.actorUserId,
    workspaceName: context.workspaceName,
  });

  let totalDeleted = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const result: { deleted: number; remaining: boolean } = await ctx.runMutation(
      internal.workspaceReset.resetBatch,
      {
        workspaceId: context.workspaceId,
        actorUserId: context.actorUserId,
        limit: BATCH_LIMIT,
      },
    );
    totalDeleted += result.deleted;
    if (!result.remaining) {
      await ctx.runMutation(internal.workspaceReset.finishResetJob, {
        jobId,
        status: "completed",
        deletedCount: totalDeleted,
        batches: batch + 1,
      });
      return {
        status: "completed" as const,
        deleted: totalDeleted,
        workspaceName: context.workspaceName,
      };
    }
  }

  await ctx.runMutation(internal.workspaceReset.finishResetJob, {
    jobId,
    status: "failed",
    deletedCount: totalDeleted,
    error: "Reset stopped before completing.",
  });
  throw new ConvexError(
    "Reset stopped before completing. Re-run to finish clearing the remaining data.",
  );
}

/**
 * Owner-only "reset this workspace to factory" (Epic E11-T3 — canonical name).
 * Requires re-typing the exact workspace name as confirmation, deletes ONLY this
 * workspace's data, records a job + `workspace.reset.factory` audit row, and
 * returns the viewer to `needs_onboarding`. Distinct from the global dev rebuild
 * in `realTestReset.startFullRebuild`.
 */
export const resetWorkspace = action({
  args: { confirmation: v.string() },
  handler: async (ctx, args) => runWorkspaceReset(ctx, args.confirmation),
});

/**
 * Back-compat alias (Epic E4-T10 wiring). Same scoped reset as `resetWorkspace`;
 * kept so the existing Settings panel + tests continue to work.
 */
export const resetWorkspaceData = action({
  args: { confirmation: v.string() },
  handler: async (ctx, args) => runWorkspaceReset(ctx, args.confirmation),
});
