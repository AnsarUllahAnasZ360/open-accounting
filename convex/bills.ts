import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";
import { getEntityForWrite, postLedgerEntryCore } from "./ledger";
import { assertNonNegativeMinorUnit } from "./money";

const TODAY = "2026-06-11";

const AP_NUMBER = "2100"; // Accounts Payable (liability)
const DEFAULT_EXPENSE_NUMBER = "6999"; // Other Expense — fallback when no category chosen

// Settlement match tolerances. Amount within 1% or $2 (whichever is larger),
// dated within a window around the bill due date.
const AMOUNT_TOLERANCE_MINOR = 200;
const AMOUNT_TOLERANCE_RATIO = 0.01;
const DATE_WINDOW_DAYS = 21;

function dateDiffDays(left: string, right: string) {
  return Math.floor((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000);
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

/** Cheap vendor-name similarity: shared significant tokens / union (Jaccard). */
function vendorSimilarity(vendorName: string, txnText: string) {
  const a = new Set(tokenize(vendorName));
  const b = new Set(tokenize(txnText));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / new Set([...a, ...b]).size;
}

type Candidate = {
  id: Id<"transactions">;
  date: string;
  merchant: string;
  amountMinor: number;
  currency: string;
  score: number;
  amountMatch: boolean;
  daysFromDue: number;
};

/**
 * Score unsettled outgoing bank transactions as settlement candidates for a
 * bill: amount within tolerance, dated within the window, vendor-name overlap.
 * Reused by both the read query and the mark-paid mutation so the picker and
 * the posting agree on the suggestion ranking.
 */
function scoreCandidates(
  transactions: Doc<"transactions">[],
  bill: Doc<"bills">,
  vendorName: string,
): Candidate[] {
  const billAmount = bill.totalMinor;
  const tolerance = Math.max(AMOUNT_TOLERANCE_MINOR, Math.round(billAmount * AMOUNT_TOLERANCE_RATIO));
  const candidates: Candidate[] = [];
  for (const txn of transactions) {
    // Only unsettled OUTGOING bank movements (negative amount, not excluded,
    // not already confirmed/consumed by another match).
    if (txn.amountMinor >= 0 || txn.review === "excluded" || txn.review === "confirmed") continue;
    const absAmount = Math.abs(txn.amountMinor);
    const amountMatch = Math.abs(absAmount - billAmount) <= tolerance;
    const daysFromDue = Math.abs(dateDiffDays(txn.date, bill.dueDate));
    if (daysFromDue > DATE_WINDOW_DAYS && !amountMatch) continue;
    const similarity = vendorSimilarity(vendorName, `${txn.merchant} ${txn.rawDescription}`);
    // Composite score: exact-ish amount dominates, then recency, then name.
    const amountScore = amountMatch ? 1 - Math.abs(absAmount - billAmount) / Math.max(1, billAmount) : 0;
    const dateScore = Math.max(0, 1 - daysFromDue / DATE_WINDOW_DAYS);
    const score = amountScore * 0.6 + dateScore * 0.25 + similarity * 0.15;
    if (score <= 0) continue;
    candidates.push({
      id: txn._id,
      date: txn.date,
      merchant: txn.merchant,
      amountMinor: txn.amountMinor,
      currency: txn.currency,
      score,
      amountMatch,
      daysFromDue,
    });
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 6);
}

async function accountByNumber(ctx: QueryCtx | MutationCtx, entityId: Id<"entities">, number: string) {
  const account = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity_and_number", (q) => q.eq("entityId", entityId).eq("number", number))
    .unique();
  if (!account) {
    throw new Error(`Chart of accounts is missing account ${number}. Seed the chart first.`);
  }
  return account;
}

async function resolveBankLedgerAccount(ctx: QueryCtx | MutationCtx, entityId: Id<"entities">, txn?: Doc<"transactions"> | null) {
  // Prefer the bank account the matched transaction belongs to; else operating
  // checking; else the first bank account.
  const bankAccounts = await ctx.db
    .query("bankAccounts")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .take(50);
  if (txn?.bankAccountId) {
    const matched = bankAccounts.find((account) => account._id === txn.bankAccountId);
    if (matched) return matched;
  }
  const checking = bankAccounts.find((account) => account.kind === "checking") ?? bankAccounts[0];
  if (!checking) {
    throw new ConvexError("Connect a bank account before settling bills.");
  }
  return checking;
}

async function loadBillForWrite(ctx: MutationCtx, billId: Id<"bills">) {
  const bill = await ctx.db.get(billId);
  if (!bill) throw new Error("Bill not found.");
  const entity = await getEntityForWrite(ctx, bill.entityId, "admin");
  const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
  return { bill, entity, userId };
}

// ---------------------------------------------------------------------------
// matchCandidates — read model for the mark-paid picker. Suggested bank
// transactions ranked, with the best match flagged.
// ---------------------------------------------------------------------------

export const matchCandidates = query({
  args: { billId: v.id("bills") },
  handler: async (ctx, args) => {
    const bill = await ctx.db.get(args.billId);
    if (!bill) return null;
    const entity = await ctx.db.get(bill.entityId);
    if (!entity) return null;
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");
    const contact = await ctx.db.get(bill.contactId);
    const vendorName = contact?.name ?? "Vendor";
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(2000);
    const candidates = scoreCandidates(transactions, bill, vendorName);
    return {
      billId: bill._id,
      vendorName,
      status: bill.status,
      totalMinor: bill.totalMinor,
      currency: bill.currency,
      dueDate: bill.dueDate,
      candidates: candidates.map((candidate, index) => ({
        id: candidate.id,
        date: candidate.date,
        merchant: candidate.merchant,
        amountMinor: candidate.amountMinor,
        currency: candidate.currency,
        amountMatch: candidate.amountMatch,
        daysFromDue: candidate.daysFromDue,
        suggested: index === 0,
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// markPaid — the missing settlement. Posts AP -> bank through the ledger, marks
// the bill paid, and consumes the matched bank transaction so it is never
// double-counted. Double-settle is rejected. Partial payments are out of scope.
// ---------------------------------------------------------------------------

export const markPaid = mutation({
  args: {
    billId: v.id("bills"),
    // Either settle now against a chosen bank transaction, or schedule an
    // expected match (settles on arrival via the pipeline). When omitted and
    // not scheduling, the best-scoring candidate is used if one exists.
    transactionId: v.optional(v.id("transactions")),
    scheduleExpected: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { bill, entity, userId } = await loadBillForWrite(ctx, args.billId);
    if (bill.status === "paid") {
      throw new ConvexError("This bill is already paid.");
    }
    if (bill.status === "void") {
      throw new ConvexError("Void bills cannot be settled.");
    }
    assertNonNegativeMinorUnit(bill.totalMinor, "Bill total");
    if (bill.totalMinor <= 0) {
      throw new ConvexError("Bill total must be positive to settle.");
    }

    const apAccount = await accountByNumber(ctx, entity._id, AP_NUMBER);
    const now = Date.now();
    const contact = await ctx.db.get(bill.contactId);
    const vendorName = contact?.name ?? "Vendor";

    // Schedule-an-expected-match path: no bank movement yet. The bill stays
    // open but flagged; the pipeline settles it when the matching txn arrives.
    if (args.scheduleExpected && !args.transactionId) {
      await ctx.db.insert("inboxItems", {
        entityId: entity._id,
        kind: "question",
        payloadSummary: `Expecting a bank payment to settle ${vendorName} bill (${bill.totalMinor} ${bill.currency}, due ${bill.dueDate}).`,
        status: "open",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("auditEvents", {
        workspaceId: entity.workspaceId,
        actorUserId: userId,
        action: "bill.payment.scheduled",
        entityType: "bill",
        entityId: bill._id,
        summary: `Scheduled expected payment for ${vendorName} bill (${bill.totalMinor} ${bill.currency})`,
        createdAt: now,
      });
      return { billId: bill._id, settled: false, scheduled: true as const, entryId: null };
    }

    // Resolve the bank transaction to consume (explicit, or best candidate).
    let matchedTxn: Doc<"transactions"> | null = null;
    if (args.transactionId) {
      matchedTxn = await ctx.db.get(args.transactionId);
      if (!matchedTxn || matchedTxn.entityId !== entity._id) {
        throw new Error("Matched bank transaction must belong to this business.");
      }
      if (matchedTxn.review === "confirmed") {
        throw new ConvexError("That bank transaction is already reconciled to something else.");
      }
      if (matchedTxn.amountMinor >= 0) {
        throw new ConvexError("Pick an outgoing (money-out) bank transaction to settle a bill.");
      }
    } else {
      const transactions = await ctx.db
        .query("transactions")
        .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
        .take(2000);
      const best = scoreCandidates(transactions, bill, vendorName)[0];
      if (best) {
        matchedTxn = (await ctx.db.get(best.id)) ?? null;
      }
    }

    const bankAccount = await resolveBankLedgerAccount(ctx, entity._id, matchedTxn);

    // Settlement entry: debit AP (clears the payable), credit bank (cash out).
    const posted = await postLedgerEntryCore(ctx, {
      entity,
      userId,
      date: matchedTxn?.date ?? (TODAY >= bill.issueDate ? TODAY : bill.issueDate),
      memo: `${vendorName} bill paid`,
      source: "bill",
      sourceId: `bill-settle-${bill._id}`,
      auditAction: "bill.paid",
      lines: [
        { accountId: apAccount._id, debitMinor: bill.totalMinor, creditMinor: 0, currency: entity.currency },
        { accountId: bankAccount.ledgerAccountId, debitMinor: 0, creditMinor: bill.totalMinor, currency: entity.currency },
      ],
    });

    // Consume the matched bank transaction so it is not also counted as an
    // uncategorized expense (mirrors payroll settlement).
    if (matchedTxn && matchedTxn.review !== "confirmed") {
      await ctx.db.patch(matchedTxn._id, {
        review: "confirmed",
        categoryAccountId: apAccount._id,
        contactId: bill.contactId,
        updatedAt: now,
      });
    }

    await ctx.db.patch(bill._id, {
      status: "paid",
      entryIds: [...bill.entryIds, posted.entryId],
      updatedAt: now,
    });

    return {
      billId: bill._id,
      settled: true as const,
      scheduled: false as const,
      entryId: posted.entryId,
      consumedTransactionId: matchedTxn?._id ?? null,
    };
  },
});

// ---------------------------------------------------------------------------
// createBill — add a bill (manual or from a PDF/receipt extraction). Posts AP
// on creation: debit expense category / credit Accounts Payable.
// ---------------------------------------------------------------------------

export const createBill = mutation({
  args: {
    entityId: v.id("entities"),
    vendorName: v.string(),
    totalMinor: v.number(),
    issueDate: v.optional(v.string()),
    dueDate: v.string(),
    categoryAccountId: v.optional(v.id("ledgerAccounts")),
    documentId: v.optional(v.id("documents")),
    memo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await getEntityForWrite(ctx, args.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    assertNonNegativeMinorUnit(args.totalMinor, "Bill total");
    if (args.totalMinor <= 0) {
      throw new Error("Bill amount must be positive.");
    }
    const vendorName = args.vendorName.trim();
    if (!vendorName) throw new Error("Who do you owe? Enter a vendor.");
    const issueDate = args.issueDate ?? TODAY;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.dueDate)) throw new Error("Use an ISO due date (YYYY-MM-DD).");

    // Resolve / create the vendor contact.
    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(500);
    let contact = contacts.find((row) => row.name.toLowerCase() === vendorName.toLowerCase()) ?? null;
    const now = Date.now();
    if (contact) {
      if (!contact.roles.includes("vendor")) {
        await ctx.db.patch(contact._id, { roles: [...contact.roles, "vendor"], updatedAt: now });
      }
    } else {
      const contactId = await ctx.db.insert("contacts", {
        entityId: entity._id,
        name: vendorName,
        roles: ["vendor"],
        aliases: [],
        createdAt: now,
        updatedAt: now,
      });
      contact = (await ctx.db.get(contactId))!;
    }

    const expenseAccount = args.categoryAccountId
      ? await ctx.db.get(args.categoryAccountId)
      : await accountByNumber(ctx, entity._id, DEFAULT_EXPENSE_NUMBER);
    if (!expenseAccount || expenseAccount.entityId !== entity._id || expenseAccount.type !== "expense") {
      throw new Error("Bill category must be an expense account on this business.");
    }
    const apAccount = await accountByNumber(ctx, entity._id, AP_NUMBER);

    const posted = await postLedgerEntryCore(ctx, {
      entity,
      userId,
      date: issueDate,
      memo: `${vendorName} bill`,
      source: "bill",
      sourceId: `bill-${now}`,
      auditAction: "bill.created",
      lines: [
        { accountId: expenseAccount._id, debitMinor: args.totalMinor, creditMinor: 0, currency: entity.currency },
        { accountId: apAccount._id, debitMinor: 0, creditMinor: args.totalMinor, currency: entity.currency },
      ],
    });

    const billId = await ctx.db.insert("bills", {
      entityId: entity._id,
      contactId: contact._id,
      documentId: args.documentId,
      status: "open",
      issueDate,
      dueDate: args.dueDate,
      totalMinor: args.totalMinor,
      currency: entity.currency,
      entryIds: [posted.entryId],
      createdAt: now,
      updatedAt: now,
    });
    return { billId, entryId: posted.entryId };
  },
});
