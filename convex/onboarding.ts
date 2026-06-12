import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireAnyWorkspaceRole, requireUserId } from "./authz";
import { chartTemplatesForType, seedChartForEntity } from "./ledger";

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

export const bootstrapWorkspace = mutation({
  args: {
    businessName: v.string(),
    businessType: businessTypeValidator,
    currency: v.string(),
    skippedAi: v.boolean(),
    skippedBank: v.boolean(),
    skippedStripe: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existingMembership = await activeMembershipForUser(ctx, userId);
    if (existingMembership) {
      await ensureChecklist(ctx, existingMembership.workspaceId);
      return {
        workspaceId: existingMembership.workspaceId,
        entityId: null,
        alreadyOnboarded: true,
        accountsCreated: 0,
      };
    }

    const businessName = args.businessName.trim().replace(/\s+/g, " ");
    if (businessName.length < 2) {
      throw new ConvexError("Give the business a name.");
    }
    if (businessName.length > 90) {
      throw new ConvexError("Business name must be 90 characters or fewer.");
    }

    const currency = args.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ConvexError("Base currency must be a 3-letter code like USD.");
    }

    const now = Date.now();
    const workspaceSlug = await uniqueWorkspaceSlug(ctx, slugify(businessName));
    const workspaceName = `${businessName} workspace`;
    const workspaceId = await ctx.db.insert("workspaces", {
      name: workspaceName,
      slug: workspaceSlug,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("workspaceSettings", {
      workspaceId,
      appName: "OpenBooks",
      defaultCurrency: currency,
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

    const entitySlug = await uniqueEntitySlug(ctx, workspaceId, slugify(businessName));
    const entityId = await ctx.db.insert("entities", {
      workspaceId,
      name: businessName,
      slug: entitySlug,
      businessType: args.businessType,
      currency,
      isDemo: false,
      archived: false,
      fiscalYearStartMonth: 1,
      accountingBasis: "accrual",
      legalName: businessName,
      createdAt: now,
      updatedAt: now,
    });
    const entity = (await ctx.db.get(entityId))!;
    const accountsCreated = await seedChartForEntity(
      ctx,
      entity,
      chartTemplatesForType(args.businessType),
    );
    await ensureChecklist(ctx, workspaceId);

    await ctx.db.insert("auditEvents", {
      workspaceId,
      actorUserId: userId,
      action: "workspace.created",
      entityType: "workspace",
      entityId: workspaceId,
      summary: `Created onboarding workspace for ${businessName}`,
      createdAt: now,
    });
    await ctx.db.insert("auditEvents", {
      workspaceId,
      actorUserId: userId,
      action: "entity.created",
      entityType: "entity",
      entityId,
      summary: `Created first business ${businessName} (${args.businessType}) with ${accountsCreated} chart accounts`,
      createdAt: now,
    });
    await ctx.db.insert("auditEvents", {
      workspaceId,
      actorUserId: userId,
      action: "onboarding.completed",
      entityType: "workspace",
      entityId: workspaceId,
      summary: `Completed first-run onboarding; skipped AI=${args.skippedAi}, bank=${args.skippedBank}, Stripe=${args.skippedStripe}`,
      createdAt: now,
    });

    return {
      workspaceId,
      entityId,
      alreadyOnboarded: false,
      accountsCreated,
    };
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
