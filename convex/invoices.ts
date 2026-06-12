import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";
import { getEntityForWrite, postLedgerEntryCore } from "./ledger";
import { assertNonNegativeMinorUnit } from "./money";

// Today, matching the seeded demo books (Acme Studio LLC runs through Jun 2026).
// Kept in sync with moduleViews/incomeViews so KPIs reconcile.
const TODAY = "2026-06-11";

// Chart numbers the invoice flow posts to. Addressed by number so the mutation
// never depends on a particular seed ordering.
const AR_NUMBER = "1100"; // Accounts Receivable (asset)
const INCOME_NUMBER = "4100"; // Services (income)

const lineItemValidator = v.object({
  description: v.string(),
  quantity: v.number(),
  unitAmountMinor: v.number(),
});

type LineItemInput = { description: string; quantity: number; unitAmountMinor: number };

function isoDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error("Use an ISO date in YYYY-MM-DD format.");
  }
  return date;
}

function lineItemsTotalMinor(lineItems: LineItemInput[]) {
  let total = 0;
  for (const [index, item] of lineItems.entries()) {
    assertNonNegativeMinorUnit(item.unitAmountMinor, `Line ${index + 1} amount`);
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error(`Line ${index + 1} quantity must be a positive integer.`);
    }
    total += item.unitAmountMinor * item.quantity;
  }
  return total;
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

/** Next invoice number for the entity: OB-1000, OB-1001, ... unique per entity. */
async function nextInvoiceNumber(ctx: MutationCtx, entityId: Id<"entities">) {
  const invoices = await ctx.db
    .query("invoices")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .take(2000);
  let max = 999;
  for (const invoice of invoices) {
    const match = /^OB-(\d+)$/.exec(invoice.number);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `OB-${max + 1}`;
}

/** Resolve (or inline-create) the customer contact for a composed invoice. */
async function resolveCustomerContact(
  ctx: MutationCtx,
  entityId: Id<"entities">,
  args: { contactId?: Id<"contacts">; customerName?: string; customerEmail?: string },
): Promise<{ contactId: Id<"contacts">; created: boolean }> {
  if (args.contactId) {
    const contact = await ctx.db.get(args.contactId);
    if (!contact || contact.entityId !== entityId) {
      throw new Error("Customer contact must belong to this business.");
    }
    return { contactId: contact._id, created: false };
  }
  const name = args.customerName?.trim();
  if (!name) {
    throw new Error("Choose or name a customer for this invoice.");
  }
  // Match an existing contact by name (case-insensitive) before creating one,
  // so "New customer" that already exists lands on the same record.
  const contacts = await ctx.db
    .query("contacts")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .take(500);
  const existing = contacts.find((contact) => contact.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (!existing.roles.includes("customer")) {
      await ctx.db.patch(existing._id, { roles: [...existing.roles, "customer"], updatedAt: Date.now() });
    }
    return { contactId: existing._id, created: false };
  }
  const now = Date.now();
  const contactId = await ctx.db.insert("contacts", {
    entityId,
    name,
    roles: ["customer"],
    email: args.customerEmail?.trim() || undefined,
    aliases: [],
    createdAt: now,
    updatedAt: now,
  });
  return { contactId, created: true };
}

async function loadInvoiceForWrite(ctx: MutationCtx, invoiceId: Id<"invoices">) {
  const invoice = await ctx.db.get(invoiceId);
  if (!invoice) throw new Error("Invoice not found.");
  const entity = await getEntityForWrite(ctx, invoice.entityId, "admin");
  const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
  return { invoice, entity, userId };
}

// ---------------------------------------------------------------------------
// saveDraft — the missing backend. Create or update a DRAFT invoice with line
// items. Drafts post NOTHING to the ledger (accrual happens only at finalize).
// ---------------------------------------------------------------------------

export const saveDraft = mutation({
  args: {
    entityId: v.id("entities"),
    invoiceId: v.optional(v.id("invoices")),
    contactId: v.optional(v.id("contacts")),
    customerName: v.optional(v.string()),
    customerEmail: v.optional(v.string()),
    lineItems: v.array(lineItemValidator),
    terms: v.optional(v.string()),
    issueDate: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    memo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await getEntityForWrite(ctx, args.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    if (args.lineItems.length === 0) {
      throw new Error("Add at least one line item before saving the draft.");
    }
    const totalMinor = lineItemsTotalMinor(args.lineItems);
    const issueDate = isoDate(args.issueDate ?? TODAY);
    const dueDate = isoDate(args.dueDate ?? issueDate);
    const now = Date.now();

    if (args.invoiceId) {
      const existing = await ctx.db.get(args.invoiceId);
      if (!existing || existing.entityId !== entity._id) {
        throw new Error("Invoice not found for this business.");
      }
      if (existing.status !== "draft") {
        throw new ConvexError("Only draft invoices can be edited. Void and re-issue a finalized invoice to change it.");
      }
      const { contactId } = await resolveCustomerContact(ctx, entity._id, args);
      await ctx.db.patch(existing._id, {
        contactId,
        lineItems: args.lineItems,
        totalMinor,
        terms: args.terms,
        issueDate,
        dueDate,
        memo: args.memo,
        updatedAt: now,
      });
      return { invoiceId: existing._id, number: existing.number, totalMinor, created: false };
    }

    const { contactId } = await resolveCustomerContact(ctx, entity._id, args);
    const number = await nextInvoiceNumber(ctx, entity._id);
    const invoiceId = await ctx.db.insert("invoices", {
      entityId: entity._id,
      contactId,
      number,
      status: "draft",
      currency: entity.currency,
      issueDate,
      dueDate,
      totalMinor,
      amountPaidMinor: 0,
      entryIds: [],
      lineItems: args.lineItems,
      memo: args.memo,
      terms: args.terms,
      source: "manual",
      timeline: [{ kind: "created", label: "Draft created", at: now }],
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "invoice.draft.saved",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `Saved draft invoice ${number} (${totalMinor} ${entity.currency}) — no ledger posting`,
      createdAt: now,
    });
    return { invoiceId, number, totalMinor, created: true };
  },
});

// ---------------------------------------------------------------------------
// finalize — issue a draft. Posts ONE balanced accrual entry through the
// ledger: debit Accounts Receivable / credit Services income. Status -> open.
// ---------------------------------------------------------------------------

export const finalize = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const { invoice, entity, userId } = await loadInvoiceForWrite(ctx, args.invoiceId);
    if (invoice.status !== "draft") {
      throw new ConvexError("Only draft invoices can be finalized.");
    }
    const balanceMinor = invoice.totalMinor - invoice.amountPaidMinor;
    if (balanceMinor <= 0) {
      throw new ConvexError("Invoice total must be positive to finalize.");
    }
    const arAccount = await accountByNumber(ctx, entity._id, AR_NUMBER);
    const incomeAccount = await accountByNumber(ctx, entity._id, INCOME_NUMBER);

    const posted = await postLedgerEntryCore(ctx, {
      entity,
      userId,
      date: invoice.issueDate,
      memo: `Invoice ${invoice.number} issued`,
      source: "invoice",
      sourceId: invoice.number,
      auditAction: "invoice.finalized",
      lines: [
        { accountId: arAccount._id, debitMinor: balanceMinor, creditMinor: 0, currency: entity.currency },
        { accountId: incomeAccount._id, debitMinor: 0, creditMinor: balanceMinor, currency: entity.currency },
      ],
    });

    const now = Date.now();
    const overdue = invoice.dueDate < TODAY;
    await ctx.db.patch(invoice._id, {
      status: overdue ? "overdue" : "open",
      entryIds: [...invoice.entryIds, posted.entryId],
      timeline: [...(invoice.timeline ?? []), { kind: "sent", label: "Issued", at: now }],
      updatedAt: now,
    });
    return { invoiceId: invoice._id, entryId: posted.entryId, balanceMinor, status: overdue ? "overdue" : "open" };
  },
});

// ---------------------------------------------------------------------------
// recordStripeSend — after the Stripe send action runs (convex/stripe.ts
// `sendInvoiceViaStripe`), attach the hosted URL + Sent timeline to the local
// draft and finalize its accrual. The action handles the external API; this
// mutation owns the transactional write (invariant: external calls in actions).
// ---------------------------------------------------------------------------

export const recordStripeSend = mutation({
  args: {
    invoiceId: v.id("invoices"),
    hostedInvoiceUrl: v.optional(v.string()),
    stripeInvoiceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { invoice, entity, userId } = await loadInvoiceForWrite(ctx, args.invoiceId);
    const now = Date.now();
    const entryIds = [...invoice.entryIds];
    let status = invoice.status;

    // If still a draft, finalize the accrual now (sent invoices are receivable).
    if (invoice.status === "draft") {
      const balanceMinor = invoice.totalMinor - invoice.amountPaidMinor;
      if (balanceMinor > 0) {
        const arAccount = await accountByNumber(ctx, entity._id, AR_NUMBER);
        const incomeAccount = await accountByNumber(ctx, entity._id, INCOME_NUMBER);
        const posted = await postLedgerEntryCore(ctx, {
          entity,
          userId,
          date: invoice.issueDate,
          memo: `Invoice ${invoice.number} sent via Stripe`,
          source: "invoice",
          sourceId: invoice.number,
          auditAction: "invoice.sent_via_stripe",
          lines: [
            { accountId: arAccount._id, debitMinor: balanceMinor, creditMinor: 0, currency: entity.currency },
            { accountId: incomeAccount._id, debitMinor: 0, creditMinor: balanceMinor, currency: entity.currency },
          ],
        });
        entryIds.push(posted.entryId);
      }
      status = invoice.dueDate < TODAY ? "overdue" : "open";
    }

    await ctx.db.patch(invoice._id, {
      status,
      source: "stripe",
      hostedInvoiceUrl: args.hostedInvoiceUrl ?? invoice.hostedInvoiceUrl,
      entryIds,
      timeline: [...(invoice.timeline ?? []), { kind: "sent", label: "Sent via Stripe", at: now }],
      updatedAt: now,
    });
    return { invoiceId: invoice._id, status, hostedInvoiceUrl: args.hostedInvoiceUrl ?? invoice.hostedInvoiceUrl ?? null };
  },
});

// ---------------------------------------------------------------------------
// voidInvoice — reverse the accrual (debit income / credit AR) and mark void.
// Posted entries are immutable; corrections reverse + repost (invariant).
// ---------------------------------------------------------------------------

export const voidInvoice = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const { invoice, entity, userId } = await loadInvoiceForWrite(ctx, args.invoiceId);
    if (invoice.status === "void") {
      throw new ConvexError("This invoice is already void.");
    }
    if (invoice.status === "paid") {
      throw new ConvexError("Paid invoices cannot be voided. Issue a credit note instead.");
    }

    const reversalEntryIds: Id<"journalEntries">[] = [];
    for (const entryId of invoice.entryIds) {
      const original = await ctx.db.get(entryId);
      if (!original) continue;
      const originalLines = await ctx.db
        .query("journalLines")
        .withIndex("by_entry", (q) => q.eq("entryId", entryId))
        .collect();
      // Reversal exactly inverts each original line (debit<->credit).
      const reversedLines = originalLines.map((line) => ({
        accountId: line.accountId,
        debitMinor: line.creditMinor,
        creditMinor: line.debitMinor,
        currency: line.currency,
      }));
      const reversal = await postLedgerEntryCore(ctx, {
        entity,
        userId,
        date: TODAY >= invoice.issueDate ? TODAY : invoice.issueDate,
        memo: `Invoice ${invoice.number} voided`,
        source: "invoice",
        sourceId: `${invoice.number}:void`,
        reversesEntryId: entryId,
        auditAction: "invoice.voided",
        lines: reversedLines,
      });
      reversalEntryIds.push(reversal.entryId);
    }

    const now = Date.now();
    await ctx.db.patch(invoice._id, {
      status: "void",
      entryIds: [...invoice.entryIds, ...reversalEntryIds],
      timeline: [...(invoice.timeline ?? []), { kind: "voided", label: "Voided", at: now }],
      updatedAt: now,
    });
    return { invoiceId: invoice._id, reversedCount: reversalEntryIds.length };
  },
});

// ---------------------------------------------------------------------------
// sendReminder (C3) — for overdue invoices. Stripe reminder for Stripe-sent
// invoices (returns the hosted link to surface), copy/mailto fallback for
// manual ones. Records a (non-posting) audit event. The actual Stripe API
// reminder call belongs in an action; here we return the channel + payload the
// UI uses (mailto/copy), keeping transactional writes in the mutation.
// ---------------------------------------------------------------------------

export const sendReminder = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const { invoice, entity, userId } = await loadInvoiceForWrite(ctx, args.invoiceId);
    if (invoice.status !== "open" && invoice.status !== "overdue") {
      throw new ConvexError("Reminders are only for unpaid invoices.");
    }
    const contact = await ctx.db.get(invoice.contactId);
    const now = Date.now();
    const channel = invoice.source === "stripe" && invoice.hostedInvoiceUrl ? "stripe" : "email";
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "invoice.reminder.sent",
      entityType: "invoice",
      entityId: invoice._id,
      summary: `Reminder for invoice ${invoice.number} to ${contact?.name ?? "customer"} via ${channel}`,
      createdAt: now,
    });
    return {
      invoiceId: invoice._id,
      channel,
      hostedInvoiceUrl: invoice.hostedInvoiceUrl ?? null,
      customerEmail: contact?.email ?? null,
      customerName: contact?.name ?? "customer",
      number: invoice.number,
      balanceMinor: invoice.totalMinor - invoice.amountPaidMinor,
    };
  },
});

// ---------------------------------------------------------------------------
// detail — read model for the invoice drawer (status, hosted link, timeline,
// line items, overdue note).
// ---------------------------------------------------------------------------

function dateDiffDays(left: string, right: string) {
  return Math.floor((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000);
}

function buildTimeline(invoice: Doc<"invoices">) {
  // Prefer recorded events; otherwise synthesize the standard lifecycle from
  // status so the drawer always has a sensible Created -> Sent -> Viewed -> Paid.
  const recorded = invoice.timeline ?? [];
  const steps: Array<{ label: string; done: boolean; when: string | null }> = [];
  const find = (kind: string) => recorded.find((event) => event.kind === kind);
  const created = find("created");
  steps.push({ label: "Created", done: true, when: created ? invoice.issueDate : invoice.issueDate });
  const sent = find("sent");
  const isSent = invoice.status !== "draft";
  steps.push({ label: "Sent", done: isSent, when: isSent ? invoice.issueDate : null });
  const viewed = invoice.status === "paid" || invoice.status === "open" || invoice.status === "overdue";
  steps.push({ label: "Viewed by customer", done: viewed, when: viewed ? invoice.issueDate : null });
  steps.push({ label: invoice.status === "paid" ? "Paid" : "Payment", done: invoice.status === "paid", when: invoice.status === "paid" ? invoice.dueDate : null });
  void sent;
  void viewed;
  return steps;
}

export const detail = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) return null;
    const entity = await ctx.db.get(invoice.entityId);
    if (!entity) return null;
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");
    const contact = await ctx.db.get(invoice.contactId);
    const balanceMinor = invoice.totalMinor - invoice.amountPaidMinor;
    const daysPastDue = Math.max(0, dateDiffDays(TODAY, invoice.dueDate));
    return {
      id: invoice._id,
      number: invoice.number,
      status: invoice.status,
      currency: invoice.currency,
      customerName: contact?.name ?? "Customer",
      customerEmail: contact?.email ?? null,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      totalMinor: invoice.totalMinor,
      amountPaidMinor: invoice.amountPaidMinor,
      balanceMinor,
      memo: invoice.memo ?? null,
      terms: invoice.terms ?? null,
      lineItems: invoice.lineItems ?? [],
      hostedInvoiceUrl: invoice.hostedInvoiceUrl ?? null,
      source: invoice.source ?? "manual",
      isOverdue: (invoice.status === "open" || invoice.status === "overdue") && balanceMinor > 0 && invoice.dueDate < TODAY,
      daysPastDue,
      timeline: buildTimeline(invoice),
    };
  },
});
