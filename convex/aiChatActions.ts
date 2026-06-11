import { ConvexError, v } from "convex/values";

import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";
import { assertNonNegativeMinorUnit } from "./money";

type ContactRole = "customer" | "vendor";

function assertIsoDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new ConvexError("Use an ISO date in YYYY-MM-DD format.");
  }
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function includesText(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function assertAccountShape(
  account: Doc<"ledgerAccounts">,
  args: {
    type?: Doc<"ledgerAccounts">["type"];
    subtype?: string;
  },
) {
  if (args.type && account.type !== args.type) {
    throw new ConvexError(`Account ${account.number} must be ${args.type} type.`);
  }
  if (args.subtype && account.subtype !== args.subtype) {
    throw new ConvexError(`Account ${account.number} must use ${args.subtype} subtype.`);
  }
}

async function requireEntityAdmin(ctx: MutationCtx, entityId: Id<"entities">) {
  const entity = await ctx.db.get(entityId);
  if (!entity) {
    throw new ConvexError("OpenBooks entity not found.");
  }
  const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
  return { entity, userId };
}

async function findAccountByNumber(
  ctx: MutationCtx,
  entityId: Id<"entities">,
  number: string,
) {
  return await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity_and_number", (q) => q.eq("entityId", entityId).eq("number", number))
    .unique();
}

async function chooseAccount(
  ctx: MutationCtx,
  args: {
    entityId: Id<"entities">;
    accountId?: Id<"ledgerAccounts">;
    accountNumber?: string;
    type?: Doc<"ledgerAccounts">["type"];
    subtype?: string;
    fallbackNumber: string;
  },
) {
  if (args.accountId) {
    const account = await ctx.db.get(args.accountId);
    if (!account || account.entityId !== args.entityId || account.archived) {
      throw new ConvexError("Choose an active account on this entity.");
    }
    assertAccountShape(account, args);
    return account;
  }

  if (args.accountNumber) {
    const account = await findAccountByNumber(ctx, args.entityId, args.accountNumber);
    if (!account || account.archived) {
      throw new ConvexError(`Account ${args.accountNumber} is not available on this entity.`);
    }
    assertAccountShape(account, args);
    return account;
  }

  const accounts = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
    .collect();
  const bySubtype = accounts.find(
    (account) =>
      !account.archived &&
      (!args.type || account.type === args.type) &&
      (!args.subtype || account.subtype === args.subtype),
  );
  if (bySubtype) return bySubtype;

  const fallback = accounts.find((account) => !account.archived && account.number === args.fallbackNumber);
  if (!fallback) {
    throw new ConvexError(`Account ${args.fallbackNumber} is not available on this entity.`);
  }
  return fallback;
}

async function ensureContact(
  ctx: MutationCtx,
  args: {
    entityId: Id<"entities">;
    name: string;
    role: ContactRole;
  },
) {
  const name = normalizeName(args.name);
  if (name.length < 2) {
    throw new ConvexError("Contact name is required.");
  }

  const contacts = await ctx.db
    .query("contacts")
    .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
    .collect();
  const existing = contacts.find(
    (contact) =>
      contact.name.toLowerCase() === name.toLowerCase() ||
      contact.aliases.some((alias) => alias.toLowerCase() === name.toLowerCase()),
  );
  if (!existing) {
    const now = Date.now();
    const contactId = await ctx.db.insert("contacts", {
      entityId: args.entityId,
      name,
      roles: [args.role],
      aliases: [],
      createdAt: now,
      updatedAt: now,
    });
    return contactId;
  }

  if (!existing.roles.includes(args.role)) {
    await ctx.db.patch(existing._id, {
      roles: [...existing.roles, args.role],
      updatedAt: Date.now(),
    });
  }
  return existing._id;
}

export const categorizeTransactions = mutation({
  args: {
    entityId: v.id("entities"),
    merchantContains: v.string(),
    categoryAccountId: v.optional(v.id("ledgerAccounts")),
    categoryAccountNumber: v.optional(v.string()),
    categorySubtype: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { entity } = await requireEntityAdmin(ctx, args.entityId);
    const merchant = normalizeName(args.merchantContains);
    if (merchant.length < 2) {
      throw new ConvexError("Merchant text is required.");
    }
    const limit = Math.min(10, Math.max(1, Math.floor(args.limit ?? 5)));
    const account = await chooseAccount(ctx, {
      entityId: entity._id,
      accountId: args.categoryAccountId,
      accountNumber: args.categoryAccountNumber,
      type: "expense",
      subtype: args.categorySubtype,
      fallbackNumber: "6900",
    });
    if (account.type !== "expense") {
      throw new ConvexError("AI categorization from chat currently supports expense categories only.");
    }

    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .collect();
    const candidates = transactions
      .filter((transaction) => transaction.review !== "excluded")
      .filter((transaction) => Boolean(transaction.bankAccountId))
      .filter(
        (transaction) =>
          includesText(transaction.merchant, merchant) ||
          includesText(transaction.rawDescription, merchant),
      )
      .slice(0, limit);

    let updatedCount = 0;
    for (const transaction of candidates) {
      await ctx.runMutation(api.pipeline.recategorizeTransaction, {
        transactionId: transaction._id,
        categoryAccountId: account._id,
      });
      updatedCount += 1;
    }

    return {
      action: "categorizeTransactions" as const,
      merchantContains: merchant,
      updatedCount,
      categoryName: account.name,
    };
  },
});

export const draftInvoice = mutation({
  args: {
    entityId: v.id("entities"),
    customerName: v.string(),
    amountMinor: v.number(),
    issueDate: v.string(),
    dueDate: v.string(),
    memo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { entity, userId } = await requireEntityAdmin(ctx, args.entityId);
    assertNonNegativeMinorUnit(args.amountMinor, "Invoice amount");
    if (args.amountMinor === 0) {
      throw new ConvexError("Invoice amount must be greater than zero.");
    }
    assertIsoDate(args.issueDate);
    assertIsoDate(args.dueDate);
    const now = Date.now();
    const contactId = await ensureContact(ctx, {
      entityId: entity._id,
      name: args.customerName,
      role: "customer",
    });
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .collect();
    const number = `AI-DRAFT-${String(invoices.length + 1).padStart(4, "0")}`;
    const invoiceId = await ctx.db.insert("invoices", {
      entityId: entity._id,
      contactId,
      number,
      status: "draft",
      currency: entity.currency,
      issueDate: args.issueDate,
      dueDate: args.dueDate,
      totalMinor: args.amountMinor,
      amountPaidMinor: 0,
      entryIds: [],
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "ai.invoice.drafted",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `${number} drafted for ${normalizeName(args.customerName)} (${args.amountMinor} ${entity.currency})`,
      createdAt: now,
    });

    return {
      action: "draftInvoice" as const,
      invoiceId,
      number,
      status: "draft" as const,
    };
  },
});

export const addBill = mutation({
  args: {
    entityId: v.id("entities"),
    vendorName: v.string(),
    amountMinor: v.number(),
    issueDate: v.string(),
    dueDate: v.string(),
    expenseAccountId: v.optional(v.id("ledgerAccounts")),
    expenseAccountNumber: v.optional(v.string()),
    expenseSubtype: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { entity } = await requireEntityAdmin(ctx, args.entityId);
    assertNonNegativeMinorUnit(args.amountMinor, "Bill amount");
    if (args.amountMinor === 0) {
      throw new ConvexError("Bill amount must be greater than zero.");
    }
    assertIsoDate(args.issueDate);
    assertIsoDate(args.dueDate);

    const vendorName = normalizeName(args.vendorName);
    const contactId = await ensureContact(ctx, {
      entityId: entity._id,
      name: vendorName,
      role: "vendor",
    });
    const expenseAccount = await chooseAccount(ctx, {
      entityId: entity._id,
      accountId: args.expenseAccountId,
      accountNumber: args.expenseAccountNumber,
      type: "expense",
      subtype: args.expenseSubtype,
      fallbackNumber: "6999",
    });
    if (expenseAccount.type !== "expense") {
      throw new ConvexError("Bills must debit an expense account.");
    }
    const payableAccount = await chooseAccount(ctx, {
      entityId: entity._id,
      accountNumber: "2100",
      type: "liability",
      subtype: "payable",
      fallbackNumber: "2100",
    });
    const now = Date.now();
    const sourceId = `ai-bill-${now}`;
    const posted: { entryId: Id<"journalEntries"> } = await ctx.runMutation(api.ledger.postEntry, {
      entityId: entity._id,
      date: args.issueDate,
      memo: `${vendorName} bill`,
      source: "bill",
      sourceId,
      lines: [
        {
          accountId: expenseAccount._id,
          debitMinor: args.amountMinor,
          creditMinor: 0,
          currency: entity.currency,
        },
        {
          accountId: payableAccount._id,
          debitMinor: 0,
          creditMinor: args.amountMinor,
          currency: entity.currency,
        },
      ],
    });
    const billId = await ctx.db.insert("bills", {
      entityId: entity._id,
      contactId,
      status: "open",
      issueDate: args.issueDate,
      dueDate: args.dueDate,
      totalMinor: args.amountMinor,
      currency: entity.currency,
      entryIds: [posted.entryId],
      createdAt: now,
      updatedAt: now,
    });

    return {
      action: "addBill" as const,
      billId,
      entryId: posted.entryId,
      status: "open" as const,
      expenseAccountName: expenseAccount.name,
    };
  },
});

export const createJournalEntry = mutation({
  args: {
    entityId: v.id("entities"),
    date: v.string(),
    memo: v.string(),
    amountMinor: v.number(),
    debitAccountId: v.optional(v.id("ledgerAccounts")),
    debitAccountNumber: v.optional(v.string()),
    creditAccountId: v.optional(v.id("ledgerAccounts")),
    creditAccountNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { entity } = await requireEntityAdmin(ctx, args.entityId);
    assertNonNegativeMinorUnit(args.amountMinor, "Journal amount");
    if (args.amountMinor === 0) {
      throw new ConvexError("Journal amount must be greater than zero.");
    }
    assertIsoDate(args.date);
    const debitAccount = await chooseAccount(ctx, {
      entityId: entity._id,
      accountId: args.debitAccountId,
      accountNumber: args.debitAccountNumber,
      fallbackNumber: "1010",
    });
    const creditAccount = await chooseAccount(ctx, {
      entityId: entity._id,
      accountId: args.creditAccountId,
      accountNumber: args.creditAccountNumber,
      fallbackNumber: "3000",
    });
    const memo = normalizeName(args.memo) || "AI-confirmed journal entry";
    const posted: { entryId: Id<"journalEntries">; debitTotal: number; creditTotal: number } =
      await ctx.runMutation(api.ledger.postEntry, {
        entityId: entity._id,
        date: args.date,
        memo,
        source: "ai",
        sourceId: `ai-journal-${Date.now()}`,
        lines: [
          {
            accountId: debitAccount._id,
            debitMinor: args.amountMinor,
            creditMinor: 0,
            currency: entity.currency,
          },
          {
            accountId: creditAccount._id,
            debitMinor: 0,
            creditMinor: args.amountMinor,
            currency: entity.currency,
          },
        ],
      });

    return {
      action: "createJournalEntry" as const,
      entryId: posted.entryId,
      debitTotal: posted.debitTotal,
      creditTotal: posted.creditTotal,
      debitAccountName: debitAccount.name,
      creditAccountName: creditAccount.name,
    };
  },
});
