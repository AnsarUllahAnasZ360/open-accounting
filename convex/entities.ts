import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";
import { chartTemplatesForType, seedChartForEntity } from "./ledger";

// Business types the "Add a business" modal offers (Epic E2). Each seeds a typed
// chart of accounts through the shared `seedChartForEntity` path.
const businessTypeValidator = v.union(
  v.literal("services"),
  v.literal("software"),
  v.literal("ecommerce"),
  v.literal("agency"),
);

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function uniqueEntitySlug(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  base: string,
) {
  const root = base || "business";
  let candidate = root;
  let n = 2;
  // Entities per workspace are few; this loop terminates quickly.
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

function isArchived(entity: Doc<"entities">) {
  return entity.archived === true;
}

/**
 * Per-entity counts for the Businesses cards (bank accounts · Stripe accounts ·
 * transactions). Uses `take()` caps so the query stays bounded; the demo entity
 * has ~922 rows which is well under the cap.
 */
async function entityCounts(ctx: QueryCtx, entityId: Id<"entities">) {
  const [bankAccounts, stripeAccounts, transactions] = await Promise.all([
    ctx.db.query("bankAccounts").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(200),
    ctx.db.query("stripeAccounts").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(50),
    ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(5000),
  ]);
  return {
    bankAccountCount: bankAccounts.length,
    stripeAccountCount: stripeAccounts.length,
    transactionCount: transactions.length,
  };
}

/**
 * List the workspace's businesses (entities) with the metadata the Businesses
 * section renders. Archived entities are included but flagged so the UI can hide
 * them from the switcher while keeping the card visible under Settings.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const entities = await ctx.db
      .query("entities")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
      .take(50);

    const rows = await Promise.all(
      entities
        .slice()
        .sort((a, b) => Number(b.isDemo) - Number(a.isDemo) || a.name.localeCompare(b.name))
        .map(async (entity) => {
          const counts = await entityCounts(ctx, entity._id);
          return {
            id: entity._id,
            name: entity.name,
            slug: entity.slug,
            businessType: entity.businessType,
            currency: entity.currency,
            isDemo: entity.isDemo,
            archived: isArchived(entity),
            fiscalYearStartMonth: entity.fiscalYearStartMonth ?? 1,
            accountingBasis: entity.accountingBasis ?? "accrual",
            legalName: entity.legalName ?? entity.name,
            entityType: entity.entityType ?? "LLC",
            taxId: entity.taxId ?? "",
            homeState: entity.homeState ?? "",
            ...counts,
          };
        }),
    );

    // Active (non-archived) count gates archiving the last living book.
    const activeCount = rows.filter((row) => !row.archived).length;
    return { rows, activeCount };
  },
});

/**
 * Create a new business (entity) and seed a typed chart of accounts through the
 * shared ledger seeder. Owner/admin only; re-checks workspace authz server-side
 * and writes an audit event. Money/currency stays a plain ISO code; the CoA is
 * the same double-entry structure every entity uses.
 */
export const create = mutation({
  args: {
    name: v.string(),
    businessType: businessTypeValidator,
    currency: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireAnyWorkspaceRole(ctx, "admin");
    const name = args.name.trim();
    if (name.length < 2) {
      throw new ConvexError("Give the business a name.");
    }
    const currency = args.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ConvexError("Base currency must be a 3-letter code like USD.");
    }

    const now = Date.now();
    const slug = await uniqueEntitySlug(ctx, membership.workspaceId, slugify(name));
    const entityId = await ctx.db.insert("entities", {
      workspaceId: membership.workspaceId,
      name,
      slug,
      businessType: args.businessType,
      currency,
      isDemo: false,
      archived: false,
      fiscalYearStartMonth: 1,
      accountingBasis: "accrual",
      legalName: name,
      createdAt: now,
      updatedAt: now,
    });
    const entity = (await ctx.db.get(entityId))!;
    const accountsCreated = await seedChartForEntity(ctx, entity, chartTemplatesForType(args.businessType));

    await ctx.db.insert("auditEvents", {
      workspaceId: membership.workspaceId,
      actorUserId: userId,
      action: "entity.created",
      entityType: "entity",
      entityId: entityId,
      summary: `Created business ${name} (${args.businessType}) with ${accountsCreated} chart accounts`,
      createdAt: now,
    });

    return { entityId, slug, name, accountsCreated };
  },
});

/**
 * Archive a business: it disappears from the switcher but its books are
 * preserved (no rows deleted). The last non-archived entity cannot be archived
 * so the workspace always has a living book.
 */
export const archive = mutation({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks business not found.");
    }
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    if (isArchived(entity)) {
      return { entityId: entity._id, archived: true };
    }

    const siblings = await ctx.db
      .query("entities")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", entity.workspaceId))
      .take(50);
    const remainingActive = siblings.filter((row) => row._id !== entity._id && row.archived !== true).length;
    if (remainingActive === 0) {
      throw new ConvexError("You can't archive your only active business.");
    }

    const now = Date.now();
    await ctx.db.patch(entity._id, { archived: true, updatedAt: now });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "entity.archived",
      entityType: "entity",
      entityId: entity._id,
      summary: `Archived business ${entity.name} (books preserved)`,
      createdAt: now,
    });
    return { entityId: entity._id, archived: true };
  },
});

/** Restore an archived business back into the switcher. */
export const unarchive = mutation({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks business not found.");
    }
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const now = Date.now();
    await ctx.db.patch(entity._id, { archived: false, updatedAt: now });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "entity.unarchived",
      entityType: "entity",
      entityId: entity._id,
      summary: `Restored business ${entity.name}`,
      createdAt: now,
    });
    return { entityId: entity._id, archived: false };
  },
});

/**
 * Tax & Fiscal Year settings for one entity (Epic E2). All fields optional so a
 * single form can patch any subset. Owner/admin only.
 */
export const updateTaxSettings = mutation({
  args: {
    entityId: v.id("entities"),
    fiscalYearStartMonth: v.optional(v.number()),
    accountingBasis: v.optional(v.union(v.literal("accrual"), v.literal("cash"))),
    legalName: v.optional(v.string()),
    entityType: v.optional(v.string()),
    taxId: v.optional(v.string()),
    homeState: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks business not found.");
    }
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");

    const patch: Partial<Doc<"entities">> = { updatedAt: Date.now() };
    if (args.fiscalYearStartMonth !== undefined) {
      if (args.fiscalYearStartMonth < 1 || args.fiscalYearStartMonth > 12) {
        throw new ConvexError("Fiscal year start month must be 1-12.");
      }
      patch.fiscalYearStartMonth = args.fiscalYearStartMonth;
    }
    if (args.accountingBasis !== undefined) patch.accountingBasis = args.accountingBasis;
    if (args.legalName !== undefined) patch.legalName = args.legalName.trim();
    if (args.entityType !== undefined) patch.entityType = args.entityType.trim();
    if (args.taxId !== undefined) patch.taxId = args.taxId.trim();
    if (args.homeState !== undefined) patch.homeState = args.homeState.trim();

    await ctx.db.patch(entity._id, patch);
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "entity.tax_settings.updated",
      entityType: "entity",
      entityId: entity._id,
      summary: `Updated tax & fiscal-year settings for ${entity.name}`,
      createdAt: Date.now(),
    });
    return { entityId: entity._id };
  },
});
