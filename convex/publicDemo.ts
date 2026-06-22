import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { internalAction, internalMutation } from "./_generated/server";
import { seedChartForEntity } from "./ledger";
import { runDemoSeedLoop } from "./seedDemo";
import {
  PUBLIC_DEMO_WORKSPACE_SLUG,
  getPublicDemoWorkspace,
} from "./demoWorkspace";

// ---------------------------------------------------------------------------
// Public demo workspace — provision, seed, reset (Epic E11-T4 / T8).
//
// Today's `seedDemo.resetAndSeed` seeds the rich demo dataset INTO THE CALLER'S
// OWN workspace under the legacy slug `acme-studio-llc`. That is fine for an
// owner who wants demo data in their own books, but it is NOT an isolated public
// demo. This module stands up a DEDICATED, standalone PUBLIC demo workspace
// (`isDemo === true && demoKind === 'public'`, slug `public-demo`) that:
//   - is system-owned (a synthetic, sign-in-less user holds the only membership),
//     so NO real user's `workspaceMembers` row ever points at it (E11-T4 DoD);
//   - is populated by the SAME shared seed routine (`runDemoSeedLoop`) the
//     in-workspace demo uses, so there is one seed implementation; and
//   - can be wiped + re-seeded deterministically by the daily cron (E11-T8) so
//     prospect edits — even one that slipped past the read-only guard — never
//     persist.
//
// SECURITY: the seed writes ONLY synthetic data. It never creates a
// `connectionCredentials` / `credentials` row, never stores a Plaid/Stripe/AI
// token, and the `stripeAccounts`/`bankAccounts` it makes are metadata-only
// (labels + masks). The synthetic system user has no `authAccounts` /
// `authSessions`, so it cannot sign in.
// ---------------------------------------------------------------------------

const DEMO_WORKSPACE_NAME = "OpenBooks Demo";
const DEMO_ENTITY_NAME = "Maple & Vine Studio";
const DEMO_ENTITY_SLUG = "maple-vine-studio";
const DEMO_BUSINESS_TYPE = "services";
const SYSTEM_USER_EMAIL = "system+public-demo@openbooks.local";
const SYSTEM_USER_NAME = "OpenBooks Demo (system)";

const WIPE_BATCH_LIMIT = 200;
const WIPE_MAX_BATCHES = 2000;

// Every entity-scoped table the seed populates. The reset deletes these for the
// demo entity, then re-provisions the entity + chart and re-runs the seed. Order
// walks children before parents so a partial batch never dangles a foreign id.
const DEMO_ENTITY_TABLES = [
  "journalLines",
  "journalEntries",
  "periodLocks",
  "stripePayoutLines",
  "stripePayouts",
  "stripeAccounts",
  "bankAccounts",
  "documents",
  "inboxItems",
  "transactionComments",
  "transactions",
  "aiCorrectionMemories",
  "rules",
  "contacts",
  "payrollRunLines",
  "payrollRuns",
  "employees",
  "bills",
  "invoices",
  "demoSeedRuns",
  "ledgerAccounts",
] as const;

type DemoEntityTable = (typeof DEMO_ENTITY_TABLES)[number];

/**
 * Find-or-create the synthetic system user that owns the public demo workspace.
 * It has no auth accounts/sessions, so it can never sign in — it exists only so
 * the ledger posting path (which records `postedByUserId`) and the membership
 * row have a non-real owner. Idempotent.
 */
async function ensureSystemUser(ctx: MutationCtx): Promise<Id<"users">> {
  const users = await ctx.db.query("users").collect();
  const existing = users.find((u) => u.email === SYSTEM_USER_EMAIL);
  if (existing) return existing._id;
  return ctx.db.insert("users", {
    email: SYSTEM_USER_EMAIL,
    name: SYSTEM_USER_NAME,
  } as never);
}

/**
 * Idempotently provision the single public demo workspace + its system owner +
 * a demo entity with a chart of accounts. Safe to call repeatedly: it never
 * duplicates the workspace/entity. Returns the ids the seed needs.
 */
export const ensurePublicDemoWorkspace = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // 1) The workspace (resolved via the E11-T2 registry, not the slug).
    let workspace = await getPublicDemoWorkspace(ctx);
    if (!workspace) {
      // A legacy row may carry the slug without the demoKind flag — adopt it.
      const bySlug = await ctx.db
        .query("workspaces")
        .withIndex("by_slug", (q) => q.eq("slug", PUBLIC_DEMO_WORKSPACE_SLUG))
        .unique();
      if (bySlug) {
        await ctx.db.patch(bySlug._id, { isDemo: true, demoKind: "public", updatedAt: now });
        workspace = (await ctx.db.get(bySlug._id))!;
      } else {
        const workspaceId = await ctx.db.insert("workspaces", {
          name: DEMO_WORKSPACE_NAME,
          slug: PUBLIC_DEMO_WORKSPACE_SLUG,
          isDemo: true,
          demoKind: "public",
          createdAt: now,
          updatedAt: now,
        });
        workspace = (await ctx.db.get(workspaceId))!;
      }
    }
    const workspaceId = workspace._id;

    // 2) System owner + membership (the only member; never a real user).
    const systemUserId = await ensureSystemUser(ctx);
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_user_and_workspace", (q) =>
        q.eq("userId", systemUserId).eq("workspaceId", workspaceId),
      )
      .unique();
    if (!membership) {
      await ctx.db.insert("workspaceMembers", {
        workspaceId,
        userId: systemUserId,
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    }

    // 3) Workspace settings (so reports/labels render).
    const settings = await ctx.db
      .query("workspaceSettings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .unique();
    if (!settings) {
      await ctx.db.insert("workspaceSettings", {
        workspaceId,
        appName: "OpenBooks",
        defaultCurrency: "USD",
        fiscalYearStartMonth: 1,
        updatedAt: now,
      });
    }

    // 4) Onboarding checklist marked complete — the demo never re-onboards.
    const checklist = await ctx.db
      .query("onboardingChecklists")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .unique();
    if (!checklist) {
      await ctx.db.insert("onboardingChecklists", {
        workspaceId,
        bankConnected: true,
        aiConnected: true,
        stripeConnected: true,
        firstInboxZero: true,
        firstReportViewed: true,
        phase: "done",
        currentStep: "done",
        completedSteps: [],
        skippedSteps: [],
        createdAt: now,
        updatedAt: now,
      });
    }

    // 5) The demo entity + chart of accounts (so the seed can post).
    let entity = await ctx.db
      .query("entities")
      .withIndex("by_workspace_and_slug", (q) =>
        q.eq("workspaceId", workspaceId).eq("slug", DEMO_ENTITY_SLUG),
      )
      .unique();
    if (!entity) {
      const entityId = await ctx.db.insert("entities", {
        workspaceId,
        name: DEMO_ENTITY_NAME,
        slug: DEMO_ENTITY_SLUG,
        businessType: DEMO_BUSINESS_TYPE,
        currency: "USD",
        isDemo: true,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });
      entity = (await ctx.db.get(entityId))!;
    }
    await seedChartForEntity(ctx, entity);
    if (!workspace.defaultEntityId) {
      await ctx.db.patch(workspaceId, { defaultEntityId: entity._id, updatedAt: now });
    }

    return {
      workspaceId,
      entityId: entity._id,
      systemUserId,
    };
  },
});

/** Internal-only resolver the seed/reset actions use to find the demo ids. */
export const publicDemoIds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const workspace = await getPublicDemoWorkspace(ctx);
    if (!workspace) return null;
    const systemUserId = await ensureSystemUser(ctx);
    const entity = await ctx.db
      .query("entities")
      .withIndex("by_workspace_and_slug", (q) =>
        q.eq("workspaceId", workspace._id).eq("slug", DEMO_ENTITY_SLUG),
      )
      .unique();
    return {
      workspaceId: workspace._id,
      entityId: entity?._id ?? null,
      systemUserId,
    };
  },
});

/**
 * Delete one bounded batch of the demo entity's scoped rows, then (when nothing
 * remains) delete the entity itself. Batched to stay under Convex limits so the
 * cron can never time out or partially wipe. Returns `{ deleted, remaining }`.
 */
export const wipePublicDemoBatch = internalMutation({
  args: { entityId: v.id("entities"), limit: v.number() },
  handler: async (ctx, args) => {
    let deleted = 0;
    let remaining = false;
    for (const table of DEMO_ENTITY_TABLES) {
      const budget = args.limit - deleted;
      if (budget <= 0) return { deleted, remaining: true };
      const rows = await (ctx.db.query(table as DemoEntityTable) as never as {
        withIndex: (name: string, fn: (q: { eq: (f: string, v: unknown) => unknown }) => unknown) => {
          take: (n: number) => Promise<Array<{ _id: Id<DemoEntityTable> }>>;
        };
      })
        .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
        .take(budget + 1);
      if (rows.length > budget) remaining = true;
      for (const row of rows.slice(0, budget)) {
        await ctx.db.delete(row._id as never);
        deleted += 1;
      }
    }
    if (!remaining && deleted < args.limit) {
      // All scoped rows gone — remove the entity so ensure recreates it clean.
      await ctx.db.delete(args.entityId);
      deleted += 1;
    }
    return { deleted, remaining };
  },
});

/**
 * Record a lightweight observability row each time the public demo is reset
 * (Epic E11-T8 DoD). Reuses the `demoSeedRuns` table keyed on the demo entity.
 */
export const recordPublicDemoReset = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    entityId: v.id("entities"),
    systemUserId: v.id("users"),
    transactionCount: v.number(),
    postedCount: v.number(),
    inboxCount: v.number(),
    evalCount: v.number(),
    trialBalanceDifferenceMinor: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("auditEvents", {
      workspaceId: args.workspaceId,
      actorUserId: args.systemUserId,
      action: "demo.public.reseeded",
      entityType: "workspace",
      entityId: args.workspaceId,
      summary: `Public demo reset + re-seeded (${args.transactionCount} txns, trial-balance diff ${args.trialBalanceDifferenceMinor}).`,
      createdAt: now,
    });
  },
});

/**
 * Provision (if needed) and seed the public demo workspace. Idempotent: a re-run
 * provisions nothing new and re-seeds deterministically. Returns the seed
 * verification snapshot so callers/tests can assert a balanced trial balance.
 */
export const seedPublicDemo = internalAction({
  args: {},
  handler: async (ctx) => {
    const ids = await ctx.runMutation(internal.publicDemo.ensurePublicDemoWorkspace, {});
    const noop = async () => {};
    const result = await runDemoSeedLoop(ctx, {
      entityId: ids.entityId,
      actorUserId: ids.systemUserId,
      heartbeat: noop,
    });
    return result;
  },
});

/**
 * The SINGLE function the cron (E11-T8) and an admin button call: wipe the
 * public demo workspace's data then re-seed it. Self-healing and deterministic —
 * two consecutive runs yield the same transaction count + balanced trial
 * balance and never duplicate the workspace/entity. A NO-OP when no public demo
 * has been provisioned (fresh deployment / self-hoster who never opted in).
 */
export const resetAndSeedPublicDemo = internalAction({
  args: {
    // The cron passes no arg; an admin button may pass `force: true` to run even
    // when the env flag is unset (e.g. to provision the demo on first setup).
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ reset: true; transactionCount: number; trialBalanceDifferenceMinor: number } | { reset: false; reason: string }> => {
    // E11-T8 / decisions Q60: OFF by default for self-hosters; ON for the hosted
    // instance via OPENBOOKS_PUBLIC_DEMO_ENABLED=1. A clean NO-OP otherwise — the
    // cron logs nothing destructive and never provisions a demo a self-hoster
    // didn't ask for.
    if (!args.force && process.env.OPENBOOKS_PUBLIC_DEMO_ENABLED !== "1") {
      return { reset: false as const, reason: "public_demo_disabled" };
    }

    const ids = await ctx.runMutation(internal.publicDemo.publicDemoIds, {});
    if (!ids) {
      return { reset: false as const, reason: "no_public_demo_workspace" };
    }

    // 1) Wipe the existing demo entity's data (bounded, batched).
    if (ids.entityId) {
      for (let batch = 0; batch < WIPE_MAX_BATCHES; batch += 1) {
        const result: { deleted: number; remaining: boolean } = await ctx.runMutation(
          internal.publicDemo.wipePublicDemoBatch,
          { entityId: ids.entityId, limit: WIPE_BATCH_LIMIT },
        );
        if (!result.remaining) break;
      }
    }

    // 2) Re-provision (recreates the entity + chart) and re-seed.
    const provisioned = await ctx.runMutation(internal.publicDemo.ensurePublicDemoWorkspace, {});
    const seed = await runDemoSeedLoop(ctx, {
      entityId: provisioned.entityId,
      actorUserId: provisioned.systemUserId,
      heartbeat: async () => {},
    });

    // 3) Observability row.
    await ctx.runMutation(internal.publicDemo.recordPublicDemoReset, {
      workspaceId: provisioned.workspaceId,
      entityId: provisioned.entityId,
      systemUserId: provisioned.systemUserId,
      transactionCount: seed.transactionCount,
      postedCount: seed.postedCount,
      inboxCount: seed.inboxCount,
      evalCount: seed.evalCount,
      trialBalanceDifferenceMinor: seed.trialBalanceDifferenceMinor,
    });

    return {
      reset: true as const,
      transactionCount: seed.transactionCount,
      trialBalanceDifferenceMinor: seed.trialBalanceDifferenceMinor,
    };
  },
});

// Re-export so callers/tests can reference the helper type alongside the module.
export type PublicDemoWorkspace = Doc<"workspaces">;
