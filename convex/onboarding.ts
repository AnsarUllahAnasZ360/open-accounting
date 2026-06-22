import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireAnyWorkspaceRole, requireUserId } from "./authz";
import { ensureDefaultBankAccountForEntity } from "./defaultBankAccount";
import { chartTemplatesForType, postLedgerEntryCore, seedChartForEntity } from "./ledger";
import { assertSignedMinorUnit } from "./money";
import { openingBalanceDate } from "./plaid";
import { ensureSystemSyncActor } from "./systemActors";

const businessTypeValidator = v.union(
  v.literal("services"),
  v.literal("software"),
  v.literal("ecommerce"),
  v.literal("agency"),
);

const checklistStepValidator = v.union(
  v.literal("bankConnected"),
  v.literal("aiConnected"),
  v.literal("stripeConnected"),
  v.literal("firstInboxZero"),
  v.literal("firstReportViewed"),
);

/**
 * The canonical guided-onboarding step order (Epic E4-T1). Defined ONCE here and
 * imported on the web side so the wizard and the resumable progress record never
 * drift. Phases: `business..stripe` are the setup phase, `sync`+`review` are the
 * ai-bulk-setup phase (Epic E4-T7/T8). Adding a step here automatically flows to
 * `getProgress.nextStep` and the wizard.
 */
export const ONBOARDING_STEP_ORDER = [
  "business",
  "ai",
  "plunk",
  "team",
  "plaid",
  "stripe",
  "openingBalances",
  "sync",
  "review",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEP_ORDER)[number];

const onboardingStepValidator = v.union(
  v.literal("business"),
  v.literal("ai"),
  v.literal("plunk"),
  v.literal("team"),
  v.literal("plaid"),
  v.literal("stripe"),
  v.literal("openingBalances"),
  v.literal("sync"),
  v.literal("review"),
);

const onboardingPhaseValidator = v.union(
  v.literal("setup"),
  v.literal("ai-bulk-setup"),
  v.literal("done"),
);

/** Append a step id to an array without duplicating it (markStep idempotency). */
function withStep(list: string[] | undefined, step: string): string[] {
  const set = new Set(list ?? []);
  set.add(step);
  // Preserve canonical order for a stable, comparable record.
  return ONBOARDING_STEP_ORDER.filter((id) => set.has(id));
}

/** Remove a step id from an array (when it moves complete<->skipped). */
function withoutStep(list: string[] | undefined, step: string): string[] {
  return (list ?? []).filter((id) => id !== step);
}

/**
 * The first step that is neither completed nor skipped, in canonical order. Once
 * every step has a state, the derived next step is null (the wizard is finished).
 */
function deriveNextStep(
  completed: string[] | undefined,
  skipped: string[] | undefined,
): OnboardingStep | null {
  const settled = new Set([...(completed ?? []), ...(skipped ?? [])]);
  return ONBOARDING_STEP_ORDER.find((step) => !settled.has(step)) ?? null;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function uniqueWorkspaceSlug(ctx: MutationCtx, base: string) {
  const root = base || "openbooks-workspace";
  let candidate = root;
  let n = 2;
  // Workspace count is tiny in this app; bounded by slug collision frequency.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", candidate))
      .unique();
    if (!existing) return candidate;
    candidate = `${root}-${n}`;
    n += 1;
  }
}

async function uniqueEntitySlug(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  base: string,
) {
  const root = base || "business";
  let candidate = root;
  let n = 2;
  // Entities per workspace are intentionally small.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await ctx.db
      .query("entities")
      .withIndex("by_workspace_and_slug", (q) =>
        q.eq("workspaceId", workspaceId).eq("slug", candidate),
      )
      .unique();
    if (!existing) return candidate;
    candidate = `${root}-${n}`;
    n += 1;
  }
}

async function activeMembershipForUser(ctx: MutationCtx, userId: Id<"users">) {
  const memberships = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return memberships.find((membership) => membership.status === "active") ?? null;
}

async function ensureChecklist(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const existing = await ctx.db
    .query("onboardingChecklists")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  if (existing) return existing._id;

  const now = Date.now();
  return await ctx.db.insert("onboardingChecklists", {
    workspaceId,
    bankConnected: false,
    aiConnected: false,
    stripeConnected: false,
    firstInboxZero: false,
    firstReportViewed: false,
    createdAt: now,
    updatedAt: now,
  });
}

async function activeBusinessCount(ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">) {
  const entities = await ctx.db
    .query("entities")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(100);
  return entities.filter((entity) => !entity.archived).length;
}

/**
 * Create ONE business (entity) inside a workspace: seed its typed chart of
 * accounts (incl. 3900 Opening Balance Equity), a default bank account, ensure
 * the checklist, lock workspace settings to USD, and write an audit event.
 * Used per-business by the multi-business bootstrap (Epic E4-T2) and by the
 * during-onboarding append mutation. Idempotency for the workspace itself is the
 * caller's responsibility.
 */
async function createBusinessForWorkspace(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    userId: Id<"users">;
    businessName: string;
    businessType: "services" | "software" | "ecommerce" | "agency";
  },
) {
  const now = Date.now();
  const entitySlug = await uniqueEntitySlug(ctx, args.workspaceId, slugify(args.businessName));
  const entityId = await ctx.db.insert("entities", {
    workspaceId: args.workspaceId,
    name: args.businessName,
    slug: entitySlug,
    businessType: args.businessType,
    // USD lock (Epic E5-T4): the general ledger is USD-only.
    currency: "USD",
    isDemo: false,
    archived: false,
    fiscalYearStartMonth: 1,
    accountingBasis: "accrual",
    legalName: args.businessName,
    createdAt: now,
    updatedAt: now,
  });
  const entity = (await ctx.db.get(entityId))!;
  const accountsCreated = await seedChartForEntity(
    ctx,
    entity,
    chartTemplatesForType(args.businessType),
  );
  await ensureDefaultBankAccountForEntity(ctx, entity);
  await ensureChecklist(ctx, args.workspaceId);

  const settings = await ctx.db
    .query("workspaceSettings")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
    .unique();
  if (settings) {
    await ctx.db.patch(settings._id, {
      // USD lock (Epic E5-T4): the ledger is USD-only.
      defaultCurrency: "USD",
      updatedAt: now,
    });
  }

  await ctx.db.insert("auditEvents", {
    workspaceId: args.workspaceId,
    actorUserId: args.userId,
    action: "entity.created",
    entityType: "entity",
    entityId,
    summary: `Created business ${args.businessName} (${args.businessType}) with ${accountsCreated} chart accounts`,
    createdAt: now,
  });

  return { entityId, accountsCreated };
}

export const checklist = query({
  args: {},
  handler: async (ctx) => {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const row = await ctx.db
      .query("onboardingChecklists")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
      .unique();

    const values = {
      bankConnected: row?.bankConnected ?? false,
      aiConnected: row?.aiConnected ?? false,
      stripeConnected: row?.stripeConnected ?? false,
      firstInboxZero: row?.firstInboxZero ?? false,
      firstReportViewed: row?.firstReportViewed ?? false,
    };

    return {
      persisted: Boolean(row),
      updatedAt: row?.updatedAt ?? null,
      items: [
        {
          key: "bankConnected",
          label: "Connect bank data",
          detail: "Plaid sandbox or CSV import",
          href: "/settings/connections",
          complete: values.bankConnected,
        },
        {
          key: "aiConnected",
          label: "Connect AI",
          detail: "Bring your own model keys",
          href: "/settings/ai",
          complete: values.aiConnected,
        },
        {
          key: "stripeConnected",
          label: "Connect Stripe",
          detail: "Sync test-mode payments and payouts",
          href: "/settings/connections",
          complete: values.stripeConnected,
        },
        {
          key: "firstInboxZero",
          label: "Reach Inbox zero",
          detail: "Review every uncertain item",
          href: "/inbox",
          complete: values.firstInboxZero,
        },
        {
          key: "firstReportViewed",
          label: "Open first report",
          detail: "Review ledger-backed statements",
          href: "/reports",
          complete: values.firstReportViewed,
        },
      ],
    };
  },
});

const onboardingBusinessInput = v.object({
  name: v.string(),
  businessType: businessTypeValidator,
  currency: v.optional(v.string()),
});

/**
 * Normalize + validate the businesses the wizard wants to create. Accepts either
 * the new `businesses[]` array (Epic E4-T2 multi-business) OR the legacy single
 * `businessName`/`businessType`/`currency` triple for back-compat. Every entity
 * is USD-only (Epic E5-T4) regardless of the submitted currency.
 */
function resolveOnboardingBusinesses(args: {
  businesses?: Array<{ name: string; businessType: "services" | "software" | "ecommerce" | "agency"; currency?: string }>;
  businessName?: string;
  businessType?: "services" | "software" | "ecommerce" | "agency";
  currency?: string;
}): Array<{ name: string; businessType: "services" | "software" | "ecommerce" | "agency" }> {
  const raw =
    args.businesses && args.businesses.length > 0
      ? args.businesses
      : args.businessName !== undefined
        ? [{ name: args.businessName, businessType: args.businessType ?? "services", currency: args.currency }]
        : [];
  if (raw.length === 0) {
    throw new ConvexError("Add at least one business.");
  }
  return raw.map((business) => {
    const name = business.name.trim().replace(/\s+/g, " ");
    if (name.length < 2) {
      throw new ConvexError("Give each business a name.");
    }
    if (name.length > 90) {
      throw new ConvexError("Business name must be 90 characters or fewer.");
    }
    // Currency is accepted for UI back-compat but the ledger is USD-only.
    if (business.currency) {
      const currency = business.currency.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) {
        throw new ConvexError("Base currency must be a 3-letter code like USD.");
      }
    }
    return { name, businessType: business.businessType };
  });
}

export const bootstrapWorkspace = mutation({
  args: {
    // New multi-business path (Epic E4-T2).
    businesses: v.optional(v.array(onboardingBusinessInput)),
    // Legacy single-business path (kept for back-compat with the prior wizard).
    businessName: v.optional(v.string()),
    businessType: v.optional(businessTypeValidator),
    currency: v.optional(v.string()),
    skippedAi: v.optional(v.boolean()),
    skippedBank: v.optional(v.boolean()),
    skippedStripe: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const businesses = resolveOnboardingBusinesses(args);
    const skippedAi = args.skippedAi ?? false;
    const skippedBank = args.skippedBank ?? false;
    const skippedStripe = args.skippedStripe ?? false;

    const existingMembership = await activeMembershipForUser(ctx, userId);
    if (existingMembership) {
      await ensureChecklist(ctx, existingMembership.workspaceId);
      // Existing-workspace idempotency: never duplicate entities on re-run.
      if ((await activeBusinessCount(ctx, existingMembership.workspaceId)) > 0) {
        return {
          workspaceId: existingMembership.workspaceId,
          entityId: null,
          entityIds: [] as Id<"entities">[],
          alreadyOnboarded: true,
          accountsCreated: 0,
        };
      }
      const created = await createBusinessesAndComplete(ctx, {
        workspaceId: existingMembership.workspaceId,
        userId,
        businesses,
        skippedAi,
        skippedBank,
        skippedStripe,
      });
      return {
        workspaceId: existingMembership.workspaceId,
        entityId: created.entityIds[0] ?? null,
        entityIds: created.entityIds,
        alreadyOnboarded: false,
        accountsCreated: created.accountsCreated,
      };
    }

    const now = Date.now();
    const workspaceSlug = await uniqueWorkspaceSlug(ctx, slugify(businesses[0].name));
    const workspaceName = `${businesses[0].name} workspace`;
    const workspaceId = await ctx.db.insert("workspaces", {
      name: workspaceName,
      slug: workspaceSlug,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("workspaceSettings", {
      workspaceId,
      appName: "OpenBooks",
      // USD lock (Epic E5-T4): the ledger is USD-only.
      defaultCurrency: "USD",
      fiscalYearStartMonth: 1,
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

    await ctx.db.insert("auditEvents", {
      workspaceId,
      actorUserId: userId,
      action: "workspace.created",
      entityType: "workspace",
      entityId: workspaceId,
      summary: `Created onboarding workspace for ${businesses[0].name}`,
      createdAt: now,
    });
    const created = await createBusinessesAndComplete(ctx, {
      workspaceId,
      userId,
      businesses,
      skippedAi,
      skippedBank,
      skippedStripe,
    });

    return {
      workspaceId,
      entityId: created.entityIds[0] ?? null,
      entityIds: created.entityIds,
      alreadyOnboarded: false,
      accountsCreated: created.accountsCreated,
    };
  },
});

/**
 * Create N businesses under a workspace (each gets its own chart incl. 3900 and a
 * default bank account), then write the single workspace-level
 * `onboarding.completed` audit event. Returns the created entity ids + the total
 * chart accounts seeded (sum across all businesses).
 */
async function createBusinessesAndComplete(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    userId: Id<"users">;
    businesses: Array<{ name: string; businessType: "services" | "software" | "ecommerce" | "agency" }>;
    skippedAi: boolean;
    skippedBank: boolean;
    skippedStripe: boolean;
  },
) {
  const entityIds: Id<"entities">[] = [];
  let accountsCreated = 0;
  for (const business of args.businesses) {
    const created = await createBusinessForWorkspace(ctx, {
      workspaceId: args.workspaceId,
      userId: args.userId,
      businessName: business.name,
      businessType: business.businessType,
    });
    entityIds.push(created.entityId);
    accountsCreated += created.accountsCreated;
  }

  await ctx.db.insert("auditEvents", {
    workspaceId: args.workspaceId,
    actorUserId: args.userId,
    action: "onboarding.completed",
    entityType: "workspace",
    entityId: args.workspaceId,
    summary: `Completed first-run onboarding for ${args.businesses.length} business${args.businesses.length === 1 ? "" : "es"}; skipped AI=${args.skippedAi}, bank=${args.skippedBank}, Stripe=${args.skippedStripe}`,
    createdAt: Date.now(),
  });

  // Stamp the guided-first-run phase so a freshly bootstrapped workspace is
  // unambiguously "in setup" (Epic E4-T4). This closes the window where an
  // undefined phase + existing businesses would otherwise read as legacy-complete
  // in getProgress. Only set it when not already advanced.
  const checklist = await ctx.db
    .query("onboardingChecklists")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
    .unique();
  if (checklist && checklist.phase === undefined) {
    await ctx.db.patch(checklist._id, { phase: "setup", updatedAt: Date.now() });
  }

  return { entityIds, accountsCreated };
}

/**
 * Append one business to an in-progress workspace before finishing onboarding
 * (Epic E4-T2). Owner/admin only via `business.manage`-equivalent role check;
 * idempotency is by slug-uniqueness within the workspace.
 */
export const addBusinessDuringOnboarding = mutation({
  args: onboardingBusinessInput,
  handler: async (ctx, args) => {
    const { membership, userId } = await requireAnyWorkspaceRole(ctx, "admin");
    const [normalized] = resolveOnboardingBusinesses({ businesses: [args] });
    const created = await createBusinessForWorkspace(ctx, {
      workspaceId: membership.workspaceId,
      userId,
      businessName: normalized.name,
      businessType: normalized.businessType,
    });
    return { entityId: created.entityId, accountsCreated: created.accountsCreated };
  },
});

export const markChecklistStep = mutation({
  args: {
    step: checklistStepValidator,
    complete: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const checklistId = await ensureChecklist(ctx, membership.workspaceId);
    const now = Date.now();
    if (args.step === "bankConnected") {
      await ctx.db.patch(checklistId, { bankConnected: args.complete, updatedAt: now });
    } else if (args.step === "aiConnected") {
      await ctx.db.patch(checklistId, { aiConnected: args.complete, updatedAt: now });
    } else if (args.step === "stripeConnected") {
      await ctx.db.patch(checklistId, { stripeConnected: args.complete, updatedAt: now });
    } else if (args.step === "firstInboxZero") {
      await ctx.db.patch(checklistId, { firstInboxZero: args.complete, updatedAt: now });
    } else {
      await ctx.db.patch(checklistId, { firstReportViewed: args.complete, updatedAt: now });
    }
    return { step: args.step, complete: args.complete };
  },
});

// ----------------------------------------------------------------------------
// Guided onboarding state machine (Epic E4-T1)
// ----------------------------------------------------------------------------

/**
 * The completion boolean each wizard step flips when it completes. Steps that
 * don't have a dedicated boolean (business, sync, review) advance the step arrays
 * + phase only. `sync` -> historyReviewed and `review` -> proposalsReviewed are
 * the ai-bulk-setup markers (Epic E4-T7/T8).
 */
const STEP_COMPLETION_FIELD: Partial<
  Record<
    OnboardingStep,
    | "aiConnected"
    | "plunkConnected"
    | "teamInvited"
    | "bankConnected"
    | "stripeConnected"
    | "openingBalancesSet"
    | "historyReviewed"
    | "proposalsReviewed"
  >
> = {
  ai: "aiConnected",
  plunk: "plunkConnected",
  team: "teamInvited",
  plaid: "bankConnected",
  stripe: "stripeConnected",
  openingBalances: "openingBalancesSet",
  sync: "historyReviewed",
  review: "proposalsReviewed",
};

/**
 * The persisted, resumable progress record + derived next step (Epic E4-T1).
 * Read by the wizard to resume a half-finished first-run and by the post-finish
 * checklist. Returns a complete record even before any row exists (a fresh setup
 * phase starting at `business`).
 */
export const getProgress = query({
  args: {},
  handler: async (ctx) => {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const row = await ctx.db
      .query("onboardingChecklists")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
      .unique();

    const completedSteps = row?.completedSteps ?? [];
    const skippedSteps = row?.skippedSteps ?? [];
    const currentStep =
      row?.currentStep ?? deriveNextStep(completedSteps, skippedSteps) ?? "business";

    // Effective phase. A checklist row that predates the E4 state machine never
    // set `phase`; if such a workspace already has businesses it finished the OLD
    // onboarding, so treat it as 'done' and never trap the owner back in the
    // wizard. The NEW wizard always writes `phase: "setup"` the moment it creates
    // the workspace (bootstrapWorkspace), so a genuine in-progress first-run never
    // hits this fallback.
    const businessCount = await activeBusinessCount(ctx, membership.workspaceId);
    const looksLegacyComplete = row != null && row.phase === undefined && businessCount > 0;
    const phase = (row?.phase ?? (looksLegacyComplete ? "done" : "setup")) as
      | "setup"
      | "ai-bulk-setup"
      | "done";

    return {
      persisted: Boolean(row),
      phase,
      stepOrder: [...ONBOARDING_STEP_ORDER],
      currentStep,
      completedSteps,
      skippedSteps,
      nextStep: deriveNextStep(completedSteps, skippedSteps),
      flags: {
        bankConnected: row?.bankConnected ?? false,
        aiConnected: row?.aiConnected ?? false,
        stripeConnected: row?.stripeConnected ?? false,
        plunkConnected: row?.plunkConnected ?? false,
        teamInvited: row?.teamInvited ?? false,
        openingBalancesSet: row?.openingBalancesSet ?? false,
        historyReviewed: row?.historyReviewed ?? false,
        proposalsReviewed: row?.proposalsReviewed ?? false,
        firstInboxZero: row?.firstInboxZero ?? false,
        firstReportViewed: row?.firstReportViewed ?? false,
      },
      updatedAt: row?.updatedAt ?? null,
    };
  },
});

/**
 * Mark a wizard step complete or skipped (Epic E4-T1). Idempotent: re-marking the
 * same state is a no-op-equivalent (arrays never duplicate); flipping
 * complete<->skipped moves the step between the two arrays. Advances
 * `currentStep` to the next unsettled step and flips the step's completion
 * boolean when completing (clears it when skipping).
 */
export const markStep = mutation({
  args: {
    step: onboardingStepValidator,
    state: v.union(v.literal("complete"), v.literal("skipped")),
  },
  handler: async (ctx, args) => {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const checklistId = await ensureChecklist(ctx, membership.workspaceId);
    const row = (await ctx.db.get(checklistId))!;
    const now = Date.now();

    const completedSteps =
      args.state === "complete"
        ? withStep(row.completedSteps, args.step)
        : withoutStep(row.completedSteps, args.step);
    const skippedSteps =
      args.state === "skipped"
        ? withStep(row.skippedSteps, args.step)
        : withoutStep(row.skippedSteps, args.step);

    const nextStep = deriveNextStep(completedSteps, skippedSteps);

    const patch: Record<string, unknown> = {
      completedSteps,
      skippedSteps,
      currentStep: nextStep ?? args.step,
      updatedAt: now,
    };

    const field = STEP_COMPLETION_FIELD[args.step];
    if (field) {
      patch[field] = args.state === "complete";
    }

    await ctx.db.patch(checklistId, patch);
    return {
      step: args.step,
      state: args.state,
      completedSteps,
      skippedSteps,
      nextStep,
    };
  },
});

/** Advance the onboarding phase (setup -> ai-bulk-setup -> done). Epic E4-T1. */
export const setPhase = mutation({
  args: { phase: onboardingPhaseValidator },
  handler: async (ctx, args) => {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const checklistId = await ensureChecklist(ctx, membership.workspaceId);
    await ctx.db.patch(checklistId, { phase: args.phase, updatedAt: Date.now() });
    return { phase: args.phase };
  },
});

/**
 * Finish guided onboarding (Epic E4-T9). This closes the "done-for-you books"
 * loop: it (1) advances the phase to 'done' so the wizard exits and the owner
 * lands on the real app, and (2) enqueues the AI categorize/post pass over the
 * synced history for EVERY active business so confident items post to the ledger
 * and the rest land in the Inbox — making the dashboard render real,
 * ledger-backed numbers instead of an empty shell.
 *
 * The bulk pass reuses the SINGLE self-rescheduling backlog drainer (Epic E2-T3,
 * `bedrockCategorizer.drainCategorizationBacklog`) — it does NOT add a second
 * posting path; the drainer routes every candidate through the existing pipeline
 * cascade and `postLedgerEntryCore`. The drainer reschedules itself in the
 * scheduler context, so it must authorize through the workspace's system SYNC
 * actor (the same trusted automation actor the import path uses). With no AI key
 * configured the drainer still runs and degrades gracefully (rules/memory post;
 * the rest abstain to the Inbox), so finishing never blocks on a key.
 *
 * Returns the counts that drive the post-finish summary surface.
 */
export const finishOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const { membership, userId } = await requireAnyWorkspaceRole(ctx, "member");
    const workspaceId = membership.workspaceId;
    const now = Date.now();

    // Advance phase to 'done' so AppShell exits the wizard onto the populated app.
    const checklistId = await ensureChecklist(ctx, workspaceId);
    await ctx.db.patch(checklistId, { phase: "done", updatedAt: now });

    // Enqueue the categorize/post bulk pass per active business. We resolve the
    // system sync actor once and thread it through every drain so each pass is
    // authorized in the scheduler context (no interactive identity there).
    const entities = await ctx.db
      .query("entities")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(100);
    const active = entities.filter((entity) => !entity.archived);

    let enqueued = 0;
    if (active.length > 0) {
      const actorUserId = await ensureSystemSyncActor(ctx, workspaceId);
      for (const entity of active) {
        await ctx.scheduler.runAfter(0, internal.bedrockCategorizer.drainCategorizationBacklog, {
          entityId: entity._id,
          actorUserId,
          pass: 0,
        });
        enqueued += 1;
      }
    }

    await ctx.db.insert("auditEvents", {
      workspaceId,
      actorUserId: userId,
      action: "onboarding.finished",
      entityType: "workspace",
      entityId: workspaceId,
      summary: `Finished guided onboarding; enqueued the AI categorize/post pass for ${enqueued} business${enqueued === 1 ? "" : "es"}.`,
      createdAt: now,
    });

    return { phase: "done" as const, businessesProcessing: enqueued };
  },
});

// ----------------------------------------------------------------------------
// Opening balances step (Epic E4-T5)
// ----------------------------------------------------------------------------

/**
 * Resolve the entity's Opening Balance Equity account (3900). It is seeded as an
 * isSystem account by the standard chart (`ledger.ts` / `seedChartForEntity`), so
 * every business created through onboarding already has it; this just looks it up
 * (no create-on-miss here — the bank-connect path in `plaid.ts` owns repair).
 */
async function openingBalanceEquityAccount(ctx: MutationCtx, entityId: Id<"entities">) {
  const account = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity_and_number", (q) => q.eq("entityId", entityId).eq("number", "3900"))
    .unique();
  if (!account || account.archived) {
    throw new ConvexError("Opening Balance Equity account (3900) is missing on this business.");
  }
  return account;
}

/**
 * Find the entity's default cash account to offset against 3900 when the owner
 * enters an opening balance without first connecting a specific bank. We prefer
 * the entity's bank account (its `ledgerAccountId`) and fall back to the 1010
 * Cash account from the chart. Returns the ledger account to debit.
 */
async function defaultCashAccountForEntity(ctx: MutationCtx, entityId: Id<"entities">) {
  const bank = await ctx.db
    .query("bankAccounts")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .first();
  if (bank) {
    const ledgerAccount = await ctx.db.get(bank.ledgerAccountId);
    if (ledgerAccount && !ledgerAccount.archived) return ledgerAccount;
  }
  const cash = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity_and_number", (q) => q.eq("entityId", entityId).eq("number", "1010"))
    .unique();
  if (!cash || cash.archived) {
    throw new ConvexError("No cash account is available on this business for an opening balance.");
  }
  return cash;
}

/**
 * Post ONE balanced opening-balance entry for a single asset account, offset to
 * 3900 Opening Balance Equity. Reuses the single posting path
 * (`postLedgerEntryCore`) — never a second writer. USD integer minor units only
 * (decision Q20; the GL is USD-only). A positive balance debits the asset /
 * credits 3900; a negative balance (e.g. a credit card or AP-as-asset edge)
 * reverses the legs. Dated the first day of the chosen start month so the entry
 * predates the oldest imported transaction (decision Q2). Idempotent by a
 * stable `sourceId` per (assetAccount, kind), so re-running the step (resume)
 * never double-posts.
 */
async function postOpeningBalanceEntry(
  ctx: MutationCtx,
  args: {
    entity: Doc<"entities">;
    userId: Id<"users">;
    assetAccountId: Id<"ledgerAccounts">;
    assetAccountName: string;
    balanceMinor: number;
    startDate?: string;
    sourceTag: string;
  },
): Promise<{ posted: boolean; entryId: Id<"journalEntries"> | null }> {
  // USD integer minor units only — no floats, no currency conversion.
  assertSignedMinorUnit(args.balanceMinor, "Opening balance");
  if (args.balanceMinor === 0) {
    return { posted: false, entryId: null };
  }

  const sourceId = `opening:onboarding:${args.sourceTag}`;
  // Idempotency: a prior opening entry with this source tag means this step has
  // already run for this account — never double-post on resume.
  const existing = await ctx.db
    .query("journalEntries")
    .withIndex("by_entity", (q) => q.eq("entityId", args.entity._id))
    .filter((q) => q.eq(q.field("sourceId"), sourceId))
    .first();
  if (existing) {
    return { posted: false, entryId: existing._id };
  }

  const equityAccount = await openingBalanceEquityAccount(ctx, args.entity._id);
  const magnitude = Math.abs(args.balanceMinor);
  const isDebitBalance = args.balanceMinor > 0;

  const posted = await postLedgerEntryCore(ctx, {
    entity: args.entity,
    userId: args.userId,
    date: openingBalanceDate(args.startDate),
    memo: `Opening balance for ${args.assetAccountName}`,
    source: "manual",
    sourceId,
    auditAction: "onboarding.opening_balance.posted",
    lines: isDebitBalance
      ? [
          { accountId: args.assetAccountId, debitMinor: magnitude, creditMinor: 0 },
          { accountId: equityAccount._id, debitMinor: 0, creditMinor: magnitude },
        ]
      : [
          { accountId: equityAccount._id, debitMinor: magnitude, creditMinor: 0 },
          { accountId: args.assetAccountId, debitMinor: 0, creditMinor: magnitude },
        ],
  });
  return { posted: true, entryId: posted.entryId };
}

const openingBalanceLineValidator = v.object({
  entityId: v.id("entities"),
  // Optional: the specific bank account to offset. When omitted we use the
  // entity's default cash account (its first bank or 1010).
  bankAccountId: v.optional(v.id("bankAccounts")),
  // USD integer minor units only (decision Q20). Signed: negative books a credit
  // card / overdraft opening balance.
  balanceMinor: v.number(),
  // Optional ISO date for the chosen "start my books on" month; floored to M-01.
  startDate: v.optional(v.string()),
});

/**
 * Set opening balances during onboarding (Epic E4-T5). For each entered line
 * this books a single balanced journal entry (asset debit / 3900 credit) through
 * the ONE posting path so the balance sheet starts non-zero and ties. USD-only,
 * integer minor units, first-of-month dated, idempotent. On success it marks
 * `openingBalancesSet` so the resumable checklist reflects the completed step.
 */
export const setOpeningBalances = mutation({
  args: { lines: v.array(openingBalanceLineValidator) },
  handler: async (ctx, args) => {
    const { membership, userId } = await requireAnyWorkspaceRole(ctx, "member");

    const results: Array<{
      entityId: Id<"entities">;
      posted: boolean;
      entryId: Id<"journalEntries"> | null;
    }> = [];

    for (const line of args.lines) {
      const entity = await ctx.db.get(line.entityId);
      if (!entity || entity.workspaceId !== membership.workspaceId) {
        throw new ConvexError("That business is not in your workspace.");
      }

      let assetAccountId: Id<"ledgerAccounts">;
      let assetAccountName: string;
      let sourceTag: string;
      if (line.bankAccountId) {
        const bank = await ctx.db.get(line.bankAccountId);
        if (!bank || bank.entityId !== entity._id) {
          throw new ConvexError("That bank account is not on this business.");
        }
        const ledgerAccount = await ctx.db.get(bank.ledgerAccountId);
        if (!ledgerAccount || ledgerAccount.archived) {
          throw new ConvexError("That bank account has no active ledger account.");
        }
        assetAccountId = ledgerAccount._id;
        assetAccountName = bank.name;
        sourceTag = `bank:${bank._id}`;
      } else {
        const cash = await defaultCashAccountForEntity(ctx, entity._id);
        assetAccountId = cash._id;
        assetAccountName = cash.name;
        sourceTag = `entity:${entity._id}`;
      }

      const posted = await postOpeningBalanceEntry(ctx, {
        entity,
        userId,
        assetAccountId,
        assetAccountName,
        balanceMinor: line.balanceMinor,
        startDate: line.startDate,
        sourceTag,
      });
      results.push({ entityId: entity._id, posted: posted.posted, entryId: posted.entryId });
    }

    // Mark the step complete on the resumable checklist (Epic E4-T1).
    const checklistId = await ensureChecklist(ctx, membership.workspaceId);
    const row = (await ctx.db.get(checklistId))!;
    const now = Date.now();
    await ctx.db.patch(checklistId, {
      openingBalancesSet: true,
      completedSteps: withStep(row.completedSteps, "openingBalances"),
      skippedSteps: withoutStep(row.skippedSteps, "openingBalances"),
      updatedAt: now,
    });

    return { lines: results };
  },
});
