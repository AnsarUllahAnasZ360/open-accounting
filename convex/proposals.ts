import { ConvexError, v } from "convex/values";

import { api, components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { authorizeThreadAccess } from "./authz";
import { assertNonNegativeMinorUnit } from "./money";
import { saveMessage } from "@convex-dev/agent";

/**
 * Propose → confirm proposals (Epic B3), the AI trust contract.
 *
 * - Propose tools (agentTools.ts) are SIDE-EFFECT-FREE: they validate the
 *   request with the same server logic used for execution and persist a
 *   `proposals` row. They never post to the ledger or write business data.
 * - `confirmProposal` re-checks authz (the signed-in user, via the thread's
 *   ownership row), re-validates, then executes through the EXISTING paths
 *   (pipeline routing / ledger.postEntry / the proven aiChatActions logic),
 *   marks the proposal confirmed, writes an audit event attributed to AI +
 *   the confirming user, and appends a result message to the thread.
 * - `dismissProposal` records dismissal. A confirmed-twice proposal is
 *   idempotently rejected. Stale proposals auto-expire when a newer
 *   generation starts (see aiThreads.expireOpenProposals).
 */

export const PROPOSAL_KIND = v.union(
  v.literal("categorize"),
  v.literal("rule"),
  v.literal("invoiceDraft"),
  v.literal("bill"),
  v.literal("journalEntry"),
);

type ProposalKind = "categorize" | "rule" | "invoiceDraft" | "bill" | "journalEntry";

// ---------------------------------------------------------------------------
// Shared validation helpers (pure-ish; only read the DB, never write)
// ---------------------------------------------------------------------------

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

function formatMinor(amountMinor: number, currency: string) {
  return `${(amountMinor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

async function findAccountByNumber(ctx: MutationCtx, entityId: Id<"entities">, number: string) {
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
): Promise<Doc<"ledgerAccounts">> {
  if (args.accountId) {
    const account = await ctx.db.get(args.accountId);
    if (!account || account.entityId !== args.entityId || account.archived) {
      throw new ConvexError("Choose an active account on this entity.");
    }
    if (args.type && account.type !== args.type) {
      throw new ConvexError(`Account ${account.number} must be ${args.type} type.`);
    }
    return account;
  }
  if (args.accountNumber) {
    const account = await findAccountByNumber(ctx, args.entityId, args.accountNumber);
    if (!account || account.archived) {
      throw new ConvexError(`Account ${args.accountNumber} is not available on this entity.`);
    }
    if (args.type && account.type !== args.type) {
      throw new ConvexError(`Account ${account.number} must be ${args.type} type.`);
    }
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

async function entityForThread(ctx: MutationCtx, threadId: string) {
  const record = await ctx.db
    .query("chatThreads")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .unique();
  if (!record) {
    throw new ConvexError("OpenBooks chat thread not found.");
  }
  const entity = await ctx.db.get(record.entityId);
  if (!entity) {
    throw new ConvexError("OpenBooks entity for this thread no longer exists.");
  }
  return { record, entity };
}

// ---------------------------------------------------------------------------
// Validators that build the concrete, executable payload at propose time.
// Storing resolved IDs makes confirm deterministic (no re-derivation drift).
// ---------------------------------------------------------------------------

type ValidatedProposal = { payload: Record<string, unknown>; summary: string };

async function validateCategorize(
  ctx: MutationCtx,
  entity: Doc<"entities">,
  input: {
    merchantContains: string;
    categoryAccountId?: Id<"ledgerAccounts">;
    categoryAccountNumber?: string;
    limit?: number;
  },
): Promise<ValidatedProposal> {
  const merchant = normalizeName(input.merchantContains);
  if (merchant.length < 2) {
    throw new ConvexError("Merchant text is required to categorize.");
  }
  const limit = Math.min(10, Math.max(1, Math.floor(input.limit ?? 5)));
  const account = await chooseAccount(ctx, {
    entityId: entity._id,
    accountId: input.categoryAccountId,
    accountNumber: input.categoryAccountNumber,
    type: "expense",
    fallbackNumber: "6900",
  });
  if (account.type !== "expense") {
    throw new ConvexError("AI categorization currently supports expense categories only.");
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
        includesText(transaction.merchant, merchant) || includesText(transaction.rawDescription, merchant),
    )
    .slice(0, limit);
  if (candidates.length === 0) {
    throw new ConvexError(`No transactions matching "${merchant}" are available to categorize.`);
  }
  return {
    payload: {
      merchantContains: merchant,
      categoryAccountId: account._id,
      categoryName: account.name,
      categoryNumber: account.number,
      transactionIds: candidates.map((transaction) => transaction._id),
    },
    summary: `Categorize ${candidates.length} "${merchant}" transaction${candidates.length === 1 ? "" : "s"} as ${account.name}.`,
  };
}

async function validateRule(
  ctx: MutationCtx,
  entity: Doc<"entities">,
  input: { merchantContains: string; categoryAccountId?: Id<"ledgerAccounts">; categoryAccountNumber?: string; autoPost?: boolean },
): Promise<ValidatedProposal> {
  const merchant = normalizeName(input.merchantContains);
  if (merchant.length < 2) {
    throw new ConvexError("Enter a merchant name for the rule.");
  }
  const account = await chooseAccount(ctx, {
    entityId: entity._id,
    accountId: input.categoryAccountId,
    accountNumber: input.categoryAccountNumber,
    type: "expense",
    fallbackNumber: "6900",
  });
  if (account.type !== "expense") {
    throw new ConvexError("Rules currently categorize into expense accounts only.");
  }
  return {
    payload: {
      merchantContains: merchant,
      categoryAccountId: account._id,
      categoryName: account.name,
      autoPost: Boolean(input.autoPost),
    },
    summary: `Create a rule: when a merchant contains "${merchant}", categorize as ${account.name}${input.autoPost ? " and auto-post" : ""}.`,
  };
}

async function validateInvoiceDraft(
  ctx: MutationCtx,
  entity: Doc<"entities">,
  input: { customerName: string; amountMinor: number; issueDate: string; dueDate: string; memo?: string },
): Promise<ValidatedProposal> {
  const customerName = normalizeName(input.customerName);
  if (customerName.length < 2) {
    throw new ConvexError("Customer name is required for an invoice.");
  }
  assertNonNegativeMinorUnit(input.amountMinor, "Invoice amount");
  if (input.amountMinor === 0) {
    throw new ConvexError("Invoice amount must be greater than zero.");
  }
  assertIsoDate(input.issueDate);
  assertIsoDate(input.dueDate);
  return {
    payload: {
      customerName,
      amountMinor: input.amountMinor,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      memo: input.memo?.trim() || undefined,
    },
    summary: `Draft invoice for ${customerName}: ${formatMinor(input.amountMinor, entity.currency)}, due ${input.dueDate}.`,
  };
}

async function validateBill(
  ctx: MutationCtx,
  entity: Doc<"entities">,
  input: {
    vendorName: string;
    amountMinor: number;
    issueDate: string;
    dueDate: string;
    expenseAccountId?: Id<"ledgerAccounts">;
    expenseAccountNumber?: string;
  },
): Promise<ValidatedProposal> {
  const vendorName = normalizeName(input.vendorName);
  if (vendorName.length < 2) {
    throw new ConvexError("Vendor name is required for a bill.");
  }
  assertNonNegativeMinorUnit(input.amountMinor, "Bill amount");
  if (input.amountMinor === 0) {
    throw new ConvexError("Bill amount must be greater than zero.");
  }
  assertIsoDate(input.issueDate);
  assertIsoDate(input.dueDate);
  const expenseAccount = await chooseAccount(ctx, {
    entityId: entity._id,
    accountId: input.expenseAccountId,
    accountNumber: input.expenseAccountNumber,
    type: "expense",
    fallbackNumber: "6999",
  });
  if (expenseAccount.type !== "expense") {
    throw new ConvexError("Bills must debit an expense account.");
  }
  // Confirm AP account exists so confirm won't fail.
  await chooseAccount(ctx, {
    entityId: entity._id,
    accountNumber: "2100",
    type: "liability",
    subtype: "payable",
    fallbackNumber: "2100",
  });
  return {
    payload: {
      vendorName,
      amountMinor: input.amountMinor,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      expenseAccountId: expenseAccount._id,
      expenseAccountName: expenseAccount.name,
    },
    summary: `Add bill from ${vendorName}: ${formatMinor(input.amountMinor, entity.currency)}, due ${input.dueDate} → ${expenseAccount.name}.`,
  };
}

async function validateJournalEntry(
  ctx: MutationCtx,
  entity: Doc<"entities">,
  input: {
    date: string;
    memo: string;
    amountMinor: number;
    debitAccountId?: Id<"ledgerAccounts">;
    debitAccountNumber?: string;
    creditAccountId?: Id<"ledgerAccounts">;
    creditAccountNumber?: string;
  },
): Promise<ValidatedProposal> {
  assertNonNegativeMinorUnit(input.amountMinor, "Journal amount");
  if (input.amountMinor === 0) {
    throw new ConvexError("Journal amount must be greater than zero.");
  }
  assertIsoDate(input.date);
  const debitAccount = await chooseAccount(ctx, {
    entityId: entity._id,
    accountId: input.debitAccountId,
    accountNumber: input.debitAccountNumber,
    fallbackNumber: "1010",
  });
  const creditAccount = await chooseAccount(ctx, {
    entityId: entity._id,
    accountId: input.creditAccountId,
    accountNumber: input.creditAccountNumber,
    fallbackNumber: "3000",
  });
  if (debitAccount._id === creditAccount._id) {
    throw new ConvexError("Debit and credit accounts must be different.");
  }
  const memo = normalizeName(input.memo) || "AI-confirmed journal entry";
  return {
    payload: {
      date: input.date,
      memo,
      amountMinor: input.amountMinor,
      debitAccountId: debitAccount._id,
      debitAccountName: debitAccount.name,
      creditAccountId: creditAccount._id,
      creditAccountName: creditAccount.name,
    },
    summary: `Journal entry ${input.date}: debit ${debitAccount.name} / credit ${creditAccount.name} ${formatMinor(input.amountMinor, entity.currency)} — ${memo}.`,
  };
}

async function validateForKind(
  ctx: MutationCtx,
  entity: Doc<"entities">,
  kind: ProposalKind,
  input: Record<string, unknown>,
): Promise<ValidatedProposal> {
  switch (kind) {
    case "categorize":
      return validateCategorize(ctx, entity, input as Parameters<typeof validateCategorize>[2]);
    case "rule":
      return validateRule(ctx, entity, input as Parameters<typeof validateRule>[2]);
    case "invoiceDraft":
      return validateInvoiceDraft(ctx, entity, input as Parameters<typeof validateInvoiceDraft>[2]);
    case "bill":
      return validateBill(ctx, entity, input as Parameters<typeof validateBill>[2]);
    case "journalEntry":
      return validateJournalEntry(ctx, entity, input as Parameters<typeof validateJournalEntry>[2]);
    default:
      throw new ConvexError("Unknown proposal kind.");
  }
}

// ---------------------------------------------------------------------------
// recordProposal: called by the side-effect-free propose tools (no user
// session — runs in the scheduled streaming action). Authorization is the
// thread ownership row.
// ---------------------------------------------------------------------------

export const recordProposal = internalMutation({
  args: {
    threadId: v.string(),
    messageId: v.optional(v.string()),
    kind: PROPOSAL_KIND,
    input: v.any(),
  },
  handler: async (ctx, args) => {
    const { record, entity } = await entityForThread(ctx, args.threadId);
    const { payload, summary } = await validateForKind(ctx, entity, args.kind, args.input ?? {});
    const now = Date.now();
    const proposalId = await ctx.db.insert("proposals", {
      workspaceId: record.workspaceId,
      entityId: entity._id,
      threadId: args.threadId,
      messageId: args.messageId,
      kind: args.kind,
      payload,
      summary,
      status: "proposed",
      createdBy: record.userId,
      createdAt: now,
      updatedAt: now,
    });
    return { proposalId, summary, kind: args.kind };
  },
});

// ---------------------------------------------------------------------------
// Execution paths for confirm. All ledger writes go through ledger.postEntry.
// ---------------------------------------------------------------------------

async function ensureContact(
  ctx: MutationCtx,
  args: { entityId: Id<"entities">; name: string; role: "customer" | "vendor" },
) {
  const name = normalizeName(args.name);
  const contacts = await ctx.db
    .query("contacts")
    .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
    .collect();
  const existing = contacts.find(
    (contact) =>
      contact.name.toLowerCase() === name.toLowerCase() ||
      contact.aliases.some((alias) => alias.toLowerCase() === name.toLowerCase()),
  );
  if (existing) {
    if (!existing.roles.includes(args.role)) {
      await ctx.db.patch(existing._id, { roles: [...existing.roles, args.role], updatedAt: Date.now() });
    }
    return existing._id;
  }
  const now = Date.now();
  return await ctx.db.insert("contacts", {
    entityId: args.entityId,
    name,
    roles: [args.role],
    aliases: [],
    createdAt: now,
    updatedAt: now,
  });
}

async function executeConfirmed(
  ctx: MutationCtx,
  args: { proposal: Doc<"proposals">; entity: Doc<"entities">; userId: Id<"users"> },
): Promise<string> {
  const { proposal, entity, userId } = args;
  const payload = proposal.payload as Record<string, unknown>;
  const now = Date.now();

  switch (proposal.kind) {
    case "categorize": {
      const transactionIds = payload.transactionIds as Id<"transactions">[];
      const categoryAccountId = payload.categoryAccountId as Id<"ledgerAccounts">;
      let updated = 0;
      for (const transactionId of transactionIds) {
        const transaction = await ctx.db.get(transactionId);
        if (!transaction || transaction.entityId !== entity._id) continue;
        await ctx.runMutation(internal.pipeline.recategorizeTransactionInternal, {
          transactionId,
          categoryAccountId,
        });
        updated += 1;
      }
      await ctx.db.insert("auditEvents", {
        workspaceId: entity.workspaceId,
        actorUserId: userId,
        action: "ai.categorize.confirmed",
        entityType: "transaction",
        entityId: transactionIds[0],
        summary: `AI proposal confirmed: categorized ${updated} transaction${updated === 1 ? "" : "s"} as ${String(payload.categoryName)} (confirmed by user)`,
        createdAt: now,
      });
      return `Categorized ${updated} transaction${updated === 1 ? "" : "s"} as ${String(payload.categoryName)}.`;
    }
    case "rule": {
      const result: { ruleId: Id<"rules">; status: "created" | "updated"; categoryName: string } =
        await ctx.runMutation(api.ai.createConfirmedRule, {
          entityId: entity._id,
          merchantContains: String(payload.merchantContains),
          categoryAccountId: payload.categoryAccountId as Id<"ledgerAccounts">,
          autoPost: Boolean(payload.autoPost),
        });
      await ctx.db.insert("auditEvents", {
        workspaceId: entity.workspaceId,
        actorUserId: userId,
        action: "ai.rule.proposal.confirmed",
        entityType: "rule",
        entityId: result.ruleId,
        summary: `AI proposal confirmed: rule ${result.status} for "${String(payload.merchantContains)}" → ${result.categoryName} (confirmed by user)`,
        createdAt: now,
      });
      return `Rule ${result.status}: "${String(payload.merchantContains)}" → ${result.categoryName}.`;
    }
    case "invoiceDraft": {
      const contactId = await ensureContact(ctx, {
        entityId: entity._id,
        name: String(payload.customerName),
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
        issueDate: String(payload.issueDate),
        dueDate: String(payload.dueDate),
        totalMinor: Number(payload.amountMinor),
        amountPaidMinor: 0,
        entryIds: [],
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("auditEvents", {
        workspaceId: entity.workspaceId,
        actorUserId: userId,
        action: "ai.invoice.proposal.confirmed",
        entityType: "invoice",
        entityId: invoiceId,
        summary: `AI proposal confirmed: ${number} drafted for ${String(payload.customerName)} (${formatMinor(Number(payload.amountMinor), entity.currency)}) (confirmed by user)`,
        createdAt: now,
      });
      return `Saved draft invoice ${number} for ${String(payload.customerName)} (${formatMinor(Number(payload.amountMinor), entity.currency)}). No ledger entry is posted until it's finalized.`;
    }
    case "bill": {
      const contactId = await ensureContact(ctx, {
        entityId: entity._id,
        name: String(payload.vendorName),
        role: "vendor",
      });
      const expenseAccountId = payload.expenseAccountId as Id<"ledgerAccounts">;
      const payableAccount = await chooseAccount(ctx, {
        entityId: entity._id,
        accountNumber: "2100",
        type: "liability",
        subtype: "payable",
        fallbackNumber: "2100",
      });
      const posted: { entryId: Id<"journalEntries"> } = await ctx.runMutation(api.ledger.postEntry, {
        entityId: entity._id,
        date: String(payload.issueDate),
        memo: `${String(payload.vendorName)} bill`,
        source: "bill",
        sourceId: `ai-bill-${now}`,
        lines: [
          { accountId: expenseAccountId, debitMinor: Number(payload.amountMinor), creditMinor: 0, currency: entity.currency },
          { accountId: payableAccount._id, debitMinor: 0, creditMinor: Number(payload.amountMinor), currency: entity.currency },
        ],
      });
      const billId = await ctx.db.insert("bills", {
        entityId: entity._id,
        contactId,
        status: "open",
        issueDate: String(payload.issueDate),
        dueDate: String(payload.dueDate),
        totalMinor: Number(payload.amountMinor),
        currency: entity.currency,
        entryIds: [posted.entryId],
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("auditEvents", {
        workspaceId: entity.workspaceId,
        actorUserId: userId,
        action: "ai.bill.proposal.confirmed",
        entityType: "bill",
        entityId: billId,
        summary: `AI proposal confirmed: bill from ${String(payload.vendorName)} (${formatMinor(Number(payload.amountMinor), entity.currency)}) posted to ${String(payload.expenseAccountName)} (confirmed by user)`,
        createdAt: now,
      });
      return `Added bill from ${String(payload.vendorName)} for ${formatMinor(Number(payload.amountMinor), entity.currency)} (posted to accounts payable, expensed to ${String(payload.expenseAccountName)}).`;
    }
    case "journalEntry": {
      const posted: { entryId: Id<"journalEntries">; debitTotal: number; creditTotal: number } =
        await ctx.runMutation(api.ledger.postEntry, {
          entityId: entity._id,
          date: String(payload.date),
          memo: String(payload.memo),
          source: "ai",
          sourceId: `ai-journal-${now}`,
          lines: [
            { accountId: payload.debitAccountId as Id<"ledgerAccounts">, debitMinor: Number(payload.amountMinor), creditMinor: 0, currency: entity.currency },
            { accountId: payload.creditAccountId as Id<"ledgerAccounts">, debitMinor: 0, creditMinor: Number(payload.amountMinor), currency: entity.currency },
          ],
        });
      await ctx.db.insert("auditEvents", {
        workspaceId: entity.workspaceId,
        actorUserId: userId,
        action: "ai.journal.proposal.confirmed",
        entityType: "journalEntry",
        entityId: posted.entryId,
        summary: `AI proposal confirmed: journal entry ${formatMinor(Number(payload.amountMinor), entity.currency)} debit ${String(payload.debitAccountName)} / credit ${String(payload.creditAccountName)} (confirmed by user)`,
        createdAt: now,
      });
      return `Posted journal entry: debit ${String(payload.debitAccountName)} / credit ${String(payload.creditAccountName)} ${formatMinor(Number(payload.amountMinor), entity.currency)} (debits ${posted.debitTotal} = credits ${posted.creditTotal}).`;
    }
    default:
      throw new ConvexError("Unknown proposal kind.");
  }
}

// ---------------------------------------------------------------------------
// Public mutations: confirm / dismiss, both authorized via the thread owner.
// ---------------------------------------------------------------------------

export const confirmProposal = mutation({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) {
      throw new ConvexError("Proposal not found.");
    }
    // Authorize via the thread's ownership row (re-checks workspace membership).
    const { userId } = await authorizeThreadAccess(ctx, proposal.threadId);

    if (proposal.status === "confirmed") {
      // Idempotent rejection of a double-confirm.
      throw new ConvexError("This proposal was already confirmed.");
    }
    if (proposal.status !== "proposed") {
      throw new ConvexError(`This proposal can no longer be confirmed (status: ${proposal.status}).`);
    }

    const entity = await ctx.db.get(proposal.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks entity for this proposal no longer exists.");
    }

    const resultSummary = await executeConfirmed(ctx, { proposal, entity, userId });

    const now = Date.now();
    await ctx.db.patch(proposal._id, {
      status: "confirmed",
      decidedBy: userId,
      decidedAt: now,
      resultSummary,
      updatedAt: now,
    });

    // Append a result message to the thread so the conversation reflects the
    // outcome. The standalone saveMessage does not embed (safe in a mutation).
    await saveMessage(ctx, components.agent, {
      threadId: proposal.threadId,
      message: { role: "assistant", content: `Done: ${resultSummary}` },
    });

    return { proposalId: proposal._id, status: "confirmed" as const, resultSummary };
  },
});

export const dismissProposal = mutation({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) {
      throw new ConvexError("Proposal not found.");
    }
    const { userId } = await authorizeThreadAccess(ctx, proposal.threadId);
    if (proposal.status === "confirmed") {
      throw new ConvexError("A confirmed proposal cannot be dismissed.");
    }
    if (proposal.status !== "proposed") {
      // Already dismissed/expired — no-op idempotently.
      return { proposalId: proposal._id, status: proposal.status };
    }
    const now = Date.now();
    await ctx.db.patch(proposal._id, {
      status: "dismissed",
      decidedBy: userId,
      decidedAt: now,
      updatedAt: now,
    });
    return { proposalId: proposal._id, status: "dismissed" as const };
  },
});

export const listProposals = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    await authorizeThreadAccess(ctx, args.threadId);
    const proposals = await ctx.db
      .query("proposals")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    return proposals
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((proposal) => ({
        id: proposal._id,
        kind: proposal.kind,
        summary: proposal.summary,
        status: proposal.status,
        messageId: proposal.messageId ?? null,
        payload: proposal.payload,
        resultSummary: proposal.resultSummary ?? null,
        createdAt: proposal.createdAt,
        decidedAt: proposal.decidedAt ?? null,
      }));
  },
});
