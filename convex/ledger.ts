import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";

const accountTypeValidator = v.union(
  v.literal("asset"),
  v.literal("liability"),
  v.literal("equity"),
  v.literal("income"),
  v.literal("expense"),
);

const entrySourceValidator = v.union(
  v.literal("bank"),
  v.literal("stripe"),
  v.literal("manual"),
  v.literal("payroll"),
  v.literal("invoice"),
  v.literal("bill"),
  v.literal("ai"),
  v.literal("rule"),
);

const chartTemplates: Array<{
  number: string;
  name: string;
  type: Doc<"ledgerAccounts">["type"];
  subtype: string;
  isSystem?: boolean;
}> = [
  { number: "1000", name: "Cash on Hand", type: "asset", subtype: "cash" },
  { number: "1010", name: "Operating Checking", type: "asset", subtype: "bank" },
  { number: "1020", name: "Savings", type: "asset", subtype: "bank" },
  { number: "1100", name: "Accounts Receivable", type: "asset", subtype: "receivable" },
  { number: "1150", name: "Stripe Clearing", type: "asset", subtype: "clearing" },
  { number: "1200", name: "Prepaid Expenses", type: "asset", subtype: "prepaid" },
  { number: "1500", name: "Equipment", type: "asset", subtype: "fixed_asset" },
  { number: "2000", name: "Credit Card", type: "liability", subtype: "credit_card" },
  { number: "2100", name: "Accounts Payable", type: "liability", subtype: "payable" },
  { number: "2200", name: "Payroll Payable", type: "liability", subtype: "payroll" },
  { number: "2300", name: "Sales Tax Payable", type: "liability", subtype: "tax" },
  { number: "2500", name: "Loans Payable", type: "liability", subtype: "loan" },
  { number: "3000", name: "Owner's Equity", type: "equity", subtype: "equity" },
  { number: "3100", name: "Owner's Draw", type: "equity", subtype: "draw" },
  { number: "3200", name: "Retained Earnings", type: "equity", subtype: "retained_earnings" },
  { number: "3900", name: "Opening Balance Equity", type: "equity", subtype: "opening_balance", isSystem: true },
  { number: "4000", name: "Sales", type: "income", subtype: "sales" },
  { number: "4100", name: "Services", type: "income", subtype: "services" },
  { number: "4200", name: "Other Income", type: "income", subtype: "other_income" },
  { number: "4900", name: "Uncategorized Income", type: "income", subtype: "uncategorized", isSystem: true },
  { number: "5000", name: "Payroll & Contractors", type: "expense", subtype: "payroll" },
  { number: "5100", name: "Rent", type: "expense", subtype: "rent" },
  { number: "5200", name: "Software & SaaS", type: "expense", subtype: "software" },
  { number: "5300", name: "Cloud/Infrastructure", type: "expense", subtype: "cloud" },
  { number: "5400", name: "Marketing & Ads", type: "expense", subtype: "marketing" },
  { number: "5500", name: "Professional Services", type: "expense", subtype: "professional_services" },
  { number: "5600", name: "Payment Processing Fees", type: "expense", subtype: "fees" },
  { number: "5700", name: "Insurance", type: "expense", subtype: "insurance" },
  { number: "5800", name: "Meals", type: "expense", subtype: "meals" },
  { number: "5900", name: "Travel", type: "expense", subtype: "travel" },
  { number: "6000", name: "Office & Supplies", type: "expense", subtype: "office" },
  { number: "6100", name: "Utilities", type: "expense", subtype: "utilities" },
  { number: "6200", name: "Bank Fees", type: "expense", subtype: "bank_fees" },
  { number: "6300", name: "Taxes & Licenses", type: "expense", subtype: "taxes" },
  { number: "6900", name: "Uncategorized Expense", type: "expense", subtype: "uncategorized", isSystem: true },
  { number: "6999", name: "Other Expense", type: "expense", subtype: "other_expense" },
];

function assertIsoDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error("Use an ISO date in YYYY-MM-DD format.");
  }
}

function assertMinorUnit(value: number, field: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer minor-unit amount.`);
  }
}

async function getEntityForWrite(
  ctx: QueryCtx | MutationCtx,
  entityId: Id<"entities">,
  role: "member" | "admin" | "owner" = "admin",
) {
  const entity = await ctx.db.get(entityId);
  if (!entity) {
    throw new Error("OpenBooks entity not found.");
  }
  await requireWorkspaceRole(ctx, entity.workspaceId, role);
  return entity;
}

async function seedChartForEntity(ctx: MutationCtx, entity: Doc<"entities">) {
  const now = Date.now();
  let created = 0;

  for (const template of chartTemplates) {
    const existing = await ctx.db
      .query("ledgerAccounts")
      .withIndex("by_entity_and_number", (q) =>
        q.eq("entityId", entity._id).eq("number", template.number),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: template.name,
        type: template.type,
        subtype: template.subtype,
        currency: entity.currency,
        isSystem: Boolean(template.isSystem),
        updatedAt: now,
      });
      continue;
    }

    await ctx.db.insert("ledgerAccounts", {
      entityId: entity._id,
      name: template.name,
      type: template.type,
      subtype: template.subtype,
      number: template.number,
      currency: entity.currency,
      isSystem: Boolean(template.isSystem),
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    created += 1;
  }

  return created;
}

async function assertReversalLines(
  ctx: MutationCtx,
  args: {
    entityId: Id<"entities">;
    reversesEntryId: Id<"journalEntries">;
    lines: Array<{ accountId: Id<"ledgerAccounts">; debitMinor: number; creditMinor: number }>;
  },
) {
  const original = await ctx.db.get(args.reversesEntryId);
  if (!original || original.entityId !== args.entityId) {
    throw new Error("Reversed entry must belong to the same entity.");
  }

  const originalLines = await ctx.db
    .query("journalLines")
    .withIndex("by_entry", (q) => q.eq("entryId", args.reversesEntryId))
    .collect();
  const expected = new Map<string, number>();
  for (const line of originalLines) {
    const key = `${line.accountId}:${line.creditMinor}:${line.debitMinor}`;
    expected.set(key, (expected.get(key) ?? 0) + 1);
  }

  for (const line of args.lines) {
    const key = `${line.accountId}:${line.debitMinor}:${line.creditMinor}`;
    const count = expected.get(key) ?? 0;
    if (count === 0) {
      throw new Error("Reversal lines must exactly invert the original entry.");
    }
    expected.set(key, count - 1);
  }

  if ([...expected.values()].some((count) => count !== 0)) {
    throw new Error("Reversal lines must exactly invert the original entry.");
  }
}

export const ensureDefaultEntity = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId, membership } = await requireAnyWorkspaceRole(ctx, "admin");
    const now = Date.now();
    const slug = "acme-studio-llc";
    let entity = await ctx.db
      .query("entities")
      .withIndex("by_workspace_and_slug", (q) =>
        q.eq("workspaceId", membership.workspaceId).eq("slug", slug),
      )
      .unique();

    if (entity) {
      await ctx.db.patch(entity._id, {
        name: "Acme Studio LLC",
        businessType: "services",
        currency: "USD",
        updatedAt: now,
      });
      entity = (await ctx.db.get(entity._id))!;
    } else {
      const entityId = await ctx.db.insert("entities", {
        workspaceId: membership.workspaceId,
        name: "Acme Studio LLC",
        slug,
        businessType: "services",
        currency: "USD",
        isDemo: true,
        createdAt: now,
        updatedAt: now,
      });
      entity = (await ctx.db.get(entityId))!;
    }

    const accountsCreated = await seedChartForEntity(ctx, entity);
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "ledger.chart.seeded",
      entityType: "entity",
      entityId: entity._id,
      summary: `Seeded chart of accounts for ${entity.name}`,
      createdAt: now,
    });

    return { entityId: entity._id, accountsCreated };
  },
});

export const postEntry = mutation({
  args: {
    entityId: v.id("entities"),
    date: v.string(),
    memo: v.string(),
    source: entrySourceValidator,
    sourceId: v.optional(v.string()),
    reversesEntryId: v.optional(v.id("journalEntries")),
    lines: v.array(
      v.object({
        accountId: v.id("ledgerAccounts"),
        debitMinor: v.number(),
        creditMinor: v.number(),
        currency: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    assertIsoDate(args.date);
    if (args.lines.length < 2) {
      throw new Error("A journal entry needs at least two lines.");
    }

    const entity = await getEntityForWrite(ctx, args.entityId, "admin");
    const lock = await ctx.db
      .query("periodLocks")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .unique();
    if (lock && args.date <= lock.lockedThroughDate) {
      throw new Error(`Period is locked through ${lock.lockedThroughDate}.`);
    }

    let debitTotal = 0;
    let creditTotal = 0;
    for (const line of args.lines) {
      assertMinorUnit(line.debitMinor, "Debit");
      assertMinorUnit(line.creditMinor, "Credit");
      if ((line.debitMinor === 0 && line.creditMinor === 0) || (line.debitMinor > 0 && line.creditMinor > 0)) {
        throw new Error("Each journal line must contain exactly one debit or one credit.");
      }
      const account = await ctx.db.get(line.accountId);
      if (!account || account.entityId !== args.entityId || account.archived) {
        throw new Error("Every journal line must use an active account on the same entity.");
      }
      debitTotal += line.debitMinor;
      creditTotal += line.creditMinor;
    }
    if (debitTotal !== creditTotal) {
      throw new Error("Journal entry is not balanced: debits must equal credits.");
    }

    if (args.reversesEntryId) {
      await assertReversalLines(ctx, {
        entityId: args.entityId,
        reversesEntryId: args.reversesEntryId,
        lines: args.lines,
      });
    }

    const now = Date.now();
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const entryId = await ctx.db.insert("journalEntries", {
      entityId: args.entityId,
      date: args.date,
      memo: args.memo.trim() || "Manual journal entry",
      source: args.source,
      sourceId: args.sourceId?.trim() || undefined,
      reversesEntryId: args.reversesEntryId,
      postedByUserId: userId,
      locked: true,
      createdAt: now,
    });

    for (const line of args.lines) {
      await ctx.db.insert("journalLines", {
        entityId: args.entityId,
        entryId,
        accountId: line.accountId,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        currency: line.currency ?? entity.currency,
        createdAt: now,
      });
    }

    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: args.reversesEntryId ? "ledger.entry.reversed" : "ledger.entry.posted",
      entityType: "journalEntry",
      entityId: entryId,
      summary: `${args.memo.trim() || "Manual journal entry"} (${debitTotal} ${entity.currency})`,
      createdAt: now,
    });

    return { entryId, debitTotal, creditTotal };
  },
});

export const setPeriodLock = mutation({
  args: {
    entityId: v.id("entities"),
    lockedThroughDate: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const entity = await getEntityForWrite(ctx, args.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const existing = await ctx.db
      .query("periodLocks")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .unique();
    const now = Date.now();

    if (args.lockedThroughDate === null) {
      if (existing) {
        await ctx.db.delete(existing._id);
      }
    } else {
      assertIsoDate(args.lockedThroughDate);
      if (existing) {
        await ctx.db.patch(existing._id, {
          lockedThroughDate: args.lockedThroughDate,
          updatedAt: now,
          updatedByUserId: userId,
        });
      } else {
        await ctx.db.insert("periodLocks", {
          entityId: args.entityId,
          lockedThroughDate: args.lockedThroughDate,
          updatedAt: now,
          updatedByUserId: userId,
        });
      }
    }

    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "ledger.period_lock.updated",
      entityType: "entity",
      entityId: entity._id,
      summary: args.lockedThroughDate
        ? `Period locked through ${args.lockedThroughDate}`
        : "Period lock cleared",
      createdAt: now,
    });

    return { lockedThroughDate: args.lockedThroughDate };
  },
});

export const updateAccount = mutation({
  args: {
    accountId: v.id("ledgerAccounts"),
    name: v.string(),
    archived: v.boolean(),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) {
      throw new Error("Ledger account not found.");
    }
    const entity = await getEntityForWrite(ctx, account.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const name = args.name.trim();
    if (!name) {
      throw new Error("Account name is required.");
    }
    if (account.isSystem && args.archived) {
      throw new Error("System accounts cannot be archived.");
    }

    await ctx.db.patch(account._id, {
      name,
      archived: args.archived,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "ledger.account.updated",
      entityType: "ledgerAccount",
      entityId: account._id,
      summary: `${account.number} ${name}${args.archived ? " archived" : ""}`,
      createdAt: Date.now(),
    });

    return { accountId: account._id };
  },
});

export const accountingSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const entity = await ctx.db
      .query("entities")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
      .first();

    if (!entity) {
      return {
        entity: null,
        accounts: [],
        trialBalance: { rows: [], totalDebitMinor: 0, totalCreditMinor: 0, differenceMinor: 0 },
        journalEntries: [],
        lock: null,
      };
    }

    const [accounts, entries, allLines, lock] = await Promise.all([
      ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).collect(),
      ctx.db
        .query("journalEntries")
        .withIndex("by_entity_and_date", (q) => q.eq("entityId", entity._id))
        .order("desc")
        .take(25),
      ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).collect(),
      ctx.db.query("periodLocks").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).unique(),
    ]);

    const accountsById = new Map(accounts.map((account) => [account._id, account]));
    const balances = new Map<Id<"ledgerAccounts">, { debitMinor: number; creditMinor: number }>();
    for (const line of allLines) {
      const current = balances.get(line.accountId) ?? { debitMinor: 0, creditMinor: 0 };
      current.debitMinor += line.debitMinor;
      current.creditMinor += line.creditMinor;
      balances.set(line.accountId, current);
    }

    const trialRows = accounts
      .filter((account) => !account.archived)
      .sort((a, b) => a.number.localeCompare(b.number))
      .map((account) => {
        const balance = balances.get(account._id) ?? { debitMinor: 0, creditMinor: 0 };
        const netMinor = balance.debitMinor - balance.creditMinor;
        return {
          accountId: account._id,
          number: account.number,
          name: account.name,
          type: account.type,
          debitMinor: netMinor >= 0 ? netMinor : 0,
          creditMinor: netMinor < 0 ? Math.abs(netMinor) : 0,
        };
      });
    const totalDebitMinor = trialRows.reduce((sum, row) => sum + row.debitMinor, 0);
    const totalCreditMinor = trialRows.reduce((sum, row) => sum + row.creditMinor, 0);

    const entryLines = new Map<Id<"journalEntries">, typeof allLines>();
    for (const line of allLines) {
      const lines = entryLines.get(line.entryId) ?? [];
      lines.push(line);
      entryLines.set(line.entryId, lines);
    }

    return {
      entity: {
        id: entity._id,
        name: entity.name,
        currency: entity.currency,
        isDemo: entity.isDemo,
      },
      accounts: accounts
        .sort((a, b) => a.number.localeCompare(b.number))
        .map((account) => ({
          id: account._id,
          number: account.number,
          name: account.name,
          type: account.type,
          subtype: account.subtype,
          currency: account.currency,
          isSystem: account.isSystem,
          archived: account.archived,
        })),
      trialBalance: {
        rows: trialRows,
        totalDebitMinor,
        totalCreditMinor,
        differenceMinor: totalDebitMinor - totalCreditMinor,
      },
      journalEntries: entries.map((entry) => ({
        id: entry._id,
        date: entry.date,
        memo: entry.memo,
        source: entry.source,
        reversesEntryId: entry.reversesEntryId ?? null,
        lines: (entryLines.get(entry._id) ?? []).map((line) => {
          const account = accountsById.get(line.accountId);
          return {
            id: line._id,
            accountNumber: account?.number ?? "----",
            accountName: account?.name ?? "Unknown account",
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor,
            currency: line.currency,
          };
        }),
      })),
      lock: lock
        ? {
            lockedThroughDate: lock.lockedThroughDate,
          }
        : null,
    };
  },
});
