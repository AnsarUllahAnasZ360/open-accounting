import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type QueryCtx, query } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";
import { getEntityForWrite } from "./ledger";

// ---------------------------------------------------------------------------
// Contacts directory mutations (Epic 5). These are NON-LEDGER: they manage the
// directory record only. No journal entry is posted, nothing is deleted, and
// archive is a SOFT flag — every contactId reference on journal lines, bills,
// and invoices is preserved so posted ledger history stays immutable.
// Every mutation re-checks workspace/entity authorization on the server.
// ---------------------------------------------------------------------------

const ROLE = v.union(v.literal("customer"), v.literal("vendor"));

/** Add a contact to the directory (customer and/or vendor). Entity-scoped. */
export const createContact = mutation({
  args: {
    entityId: v.id("entities"),
    name: v.string(),
    roles: v.array(ROLE),
    email: v.optional(v.string()),
    defaultCategoryId: v.optional(v.id("ledgerAccounts")),
    aliases: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await getEntityForWrite(ctx, args.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");

    const name = args.name.trim();
    if (!name) throw new ConvexError("Give the contact a name.");
    // A default category must be an account in THIS entity's chart (server-side
    // re-check so a forged id can't bind a category from another business).
    if (args.defaultCategoryId) {
      const account = await ctx.db.get(args.defaultCategoryId);
      if (!account || account.entityId !== entity._id) {
        throw new ConvexError("That category does not belong to this business.");
      }
    }
    // Dedupe by name within the entity so manual adds don't shadow the contacts
    // the pipeline already created automatically.
    const existing = await ctx.db
      .query("contacts")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(1000);
    const duplicate = existing.find((row) => row.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      throw new ConvexError(`A contact named ${name} already exists.`);
    }

    const roles = args.roles.length > 0 ? args.roles : (["customer"] as const);
    const now = Date.now();
    const contactId = await ctx.db.insert("contacts", {
      entityId: entity._id,
      name,
      roles: [...new Set(roles)],
      email: args.email?.trim() || undefined,
      defaultCategoryId: args.defaultCategoryId,
      aliases: (args.aliases ?? []).map((alias) => alias.trim()).filter(Boolean),
      notes: args.notes?.trim() || undefined,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "contact.created",
      entityType: "contact",
      entityId: contactId,
      summary: `Added contact ${name}`,
      createdAt: now,
    });
    return { contactId };
  },
});

/** Edit directory fields (notes, email, roles, aliases). Non-ledger. */
export const updateContact = mutation({
  args: {
    contactId: v.id("contacts"),
    name: v.optional(v.string()),
    roles: v.optional(v.array(ROLE)),
    email: v.optional(v.string()),
    // null clears the default category; an id sets it (re-checked entity-scoped).
    defaultCategoryId: v.optional(v.union(v.id("ledgerAccounts"), v.null())),
    aliases: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) throw new ConvexError("Contact not found.");
    const entity = await getEntityForWrite(ctx, contact.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) throw new ConvexError("Contact name can't be empty.");
      patch.name = name;
    }
    if (args.roles !== undefined) patch.roles = [...new Set(args.roles)];
    if (args.email !== undefined) patch.email = args.email.trim() || undefined;
    if (args.defaultCategoryId !== undefined) {
      if (args.defaultCategoryId === null) {
        patch.defaultCategoryId = undefined;
      } else {
        const account = await ctx.db.get(args.defaultCategoryId);
        if (!account || account.entityId !== entity._id) {
          throw new ConvexError("That category does not belong to this business.");
        }
        patch.defaultCategoryId = args.defaultCategoryId;
      }
    }
    if (args.aliases !== undefined) {
      patch.aliases = args.aliases.map((alias) => alias.trim()).filter(Boolean);
    }
    if (args.notes !== undefined) patch.notes = args.notes.trim() || undefined;

    await ctx.db.patch(contact._id, patch);
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "contact.updated",
      entityType: "contact",
      entityId: contact._id,
      summary: `Updated contact ${patch.name ?? contact.name}`,
      createdAt: Date.now(),
    });
    return { contactId: contact._id };
  },
});

/**
 * SOFT-archive a contact: it drops out of the default directory but its books
 * are untouched. NO rows are deleted and every contactId reference on journal
 * lines / bills / invoices is preserved — posted ledger history is immutable.
 * Restorable via unarchiveContact.
 */
export const archiveContact = mutation({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) throw new ConvexError("Contact not found.");
    const entity = await getEntityForWrite(ctx, contact.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    if (contact.archived === true) {
      return { contactId: contact._id, archived: true as const };
    }
    const now = Date.now();
    await ctx.db.patch(contact._id, { archived: true, updatedAt: now });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "contact.archived",
      entityType: "contact",
      entityId: contact._id,
      summary: `Archived contact ${contact.name} (history preserved)`,
      createdAt: now,
    });
    return { contactId: contact._id, archived: true as const };
  },
});

/** Restore a soft-archived contact back into the directory. */
export const unarchiveContact = mutation({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) throw new ConvexError("Contact not found.");
    const entity = await getEntityForWrite(ctx, contact.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const now = Date.now();
    await ctx.db.patch(contact._id, { archived: false, updatedAt: now });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "contact.unarchived",
      entityType: "contact",
      entityId: contact._id,
      summary: `Restored contact ${contact.name}`,
      createdAt: now,
    });
    return { contactId: contact._id, archived: false as const };
  },
});

/**
 * Set or clear the bank/payout details on a contact (ADMIN-ONLY, E4.3). Stored
 * as opaque free-text (e.g. "Routing 021000021 · Acct ••4321") — never a live
 * banking token. Gated at "admin" so members/HR can neither read nor write it.
 */
export const setBankDetails = mutation({
  args: { contactId: v.id("contacts"), bankDetails: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) throw new ConvexError("Contact not found.");
    const entity = await getEntityForWrite(ctx, contact.entityId, "admin");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const value = args.bankDetails === null ? undefined : args.bankDetails.trim() || undefined;
    await ctx.db.patch(contact._id, { bankDetails: value, updatedAt: Date.now() });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "contact.bank_details.updated",
      entityType: "contact",
      entityId: contact._id,
      // Never log the value itself — only that it changed.
      summary: value ? `Updated bank details for ${contact.name}` : `Cleared bank details for ${contact.name}`,
      createdAt: Date.now(),
    });
    return { contactId: contact._id };
  },
});

// ---------------------------------------------------------------------------
// Per-contact read model (Epic E4.3 / E4.4). Both queries are entity-scoped,
// bounded with take(), and re-check workspace access on the server. They are
// LEDGER-TIED: every activity / open-item / statement line maps to a document
// that carries posted journal entryIds (invoices, bills, invoice payments), so
// the figures reconcile to the double-entry ledger rather than ad-hoc totals.
// AR (customer) and AP (vendor) are reported SEPARATELY and never netted.
// ---------------------------------------------------------------------------

const DEMO_TODAY = "2026-06-11";

function diffDays(left: string, right: string) {
  const leftTime = Date.parse(`${left}T00:00:00Z`);
  const rightTime = Date.parse(`${right}T00:00:00Z`);
  return Math.floor((leftTime - rightTime) / 86_400_000);
}

type AgingBucket = { currentMinor: number; d1to30Minor: number; d31to60Minor: number; d61to90Minor: number; d90PlusMinor: number; totalMinor: number };
function emptyAging(): AgingBucket {
  return { currentMinor: 0, d1to30Minor: 0, d31to60Minor: 0, d61to90Minor: 0, d90PlusMinor: 0, totalMinor: 0 };
}
function addToAging(bucket: AgingBucket, dueDate: string, amountMinor: number, asOf: string) {
  const overdueDays = diffDays(asOf, dueDate);
  if (overdueDays <= 0) bucket.currentMinor += amountMinor;
  else if (overdueDays <= 30) bucket.d1to30Minor += amountMinor;
  else if (overdueDays <= 60) bucket.d31to60Minor += amountMinor;
  else if (overdueDays <= 90) bucket.d61to90Minor += amountMinor;
  else bucket.d90PlusMinor += amountMinor;
  bucket.totalMinor += amountMinor;
}

/**
 * Load a contact plus its activity, open items, and KPIs — scoped to the
 * authenticated workspace. Replaces the directory's first-contact-only history
 * with a real per-contact endpoint. `canSeeBankDetails` mirrors the admin RBAC
 * gate so the client never even receives the value for non-admins.
 */
export const contactProfile = query({
  args: { contactId: v.id("contacts"), asOf: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) return null;
    const entity = await ctx.db.get(contact.entityId);
    if (!entity) return null;
    // Re-check membership; capture the role so bank details only ship to admins.
    const { membership } = await requireWorkspaceRole(ctx, entity.workspaceId, "member");
    const canSeeBankDetails = membership.role === "owner" || membership.role === "admin" || membership.role === "accountant";
    const asOf = args.asOf ?? DEMO_TODAY;

    const [invoices, bills, transactions, accounts] = await Promise.all([
      ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
      ctx.db.query("bills").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
      ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(4000),
      ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(500),
    ]);

    const accountsById = new Map(accounts.map((a) => [a._id, a]));
    const apAccountId = accounts.find((a) => a.number === "2100")?._id ?? null;
    const arAccountId = accounts.find((a) => a.number === "1100")?._id ?? null;
    const isSettlement = (categoryAccountId?: Id<"ledgerAccounts">) =>
      categoryAccountId != null && (categoryAccountId === apAccountId || categoryAccountId === arAccountId);

    const contactInvoices = invoices.filter((i) => i.contactId === contact._id);
    const contactBills = bills.filter((b) => b.contactId === contact._id);
    const contactTxns = transactions.filter((t) => t.contactId === contact._id);

    return {
      ...buildContactReadModel(contact, contactInvoices, contactBills, contactTxns, accountsById, isSettlement, asOf, entity.currency),
      bankDetails: canSeeBankDetails ? contact.bankDetails ?? null : null,
      canSeeBankDetails,
    };
  },
});

/** Statement modes: opening + period activity + closing, OR open-item aging. */
const STATEMENT_MODE = v.union(v.literal("balance-forward"), v.literal("open-item"));

/**
 * A customer/vendor statement (E4.4) DERIVED FROM the POSTED journalLines that
 * settle on the A/R (1100) or A/P (2100) control account — so every figure ties
 * to the double-entry ledger rather than to ad-hoc document totals. The contact
 * link lives on the invoice/bill (journal lines carry no contactId in this
 * schema), so we collect the contact's posted entry ids, read their journal
 * lines, and reduce the control-account legs:
 *   A/R: a DEBIT raises the receivable (invoice issued); a CREDIT lowers it
 *        (payment received).
 *   A/P: a CREDIT raises the payable (bill received); a DEBIT lowers it
 *        (payment sent).
 * Balance-Forward: opening balance (control-account net before `from`) + period
 * activity + running closing balance. Open-Item: open invoices/bills whose
 * ledger-derived balance is still outstanding, with aging. A/R and A/P are
 * reported as SEPARATE statements, never netted. Reads are entity-scoped,
 * auth-checked, and bounded with take().
 */
export const contactStatement = query({
  args: {
    contactId: v.id("contacts"),
    mode: STATEMENT_MODE,
    from: v.string(),
    to: v.string(),
    side: v.optional(v.union(v.literal("receivable"), v.literal("payable"))),
  },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) return null;
    const entity = await ctx.db.get(contact.entityId);
    if (!entity) return null;
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");

    const [invoices, bills, accounts] = await Promise.all([
      ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
      ctx.db.query("bills").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
      ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(500),
    ]);
    const contactInvoices = invoices.filter((i) => i.contactId === contact._id && i.status !== "draft");
    const contactBills = bills.filter((b) => b.contactId === contact._id && b.status !== "void");

    const arAccountId = accounts.find((a) => a.number === "1100")?._id ?? null;
    const apAccountId = accounts.find((a) => a.number === "2100")?._id ?? null;

    // Which side the statement covers. Default to whichever the contact actually
    // has (AR for a customer, AP for a vendor); a dual-role contact defaults AR.
    const side: "receivable" | "payable" =
      args.side ?? (contact.roles.includes("customer") ? "receivable" : "payable");

    const currency = entity.currency;
    const company = entity.name;

    if (side === "receivable") {
      const docs = contactInvoices.map((i) => ({
        id: i._id as string,
        ref: `Invoice ${i.number}`,
        issueDate: i.issueDate,
        dueDate: i.dueDate,
        status: i.status,
        entryIds: i.entryIds,
      }));
      const ledger = await loadControlAccountLedger(ctx, entity._id, arAccountId, docs);
      return buildLedgerStatement("receivable", contact, company, currency, ledger, args.mode, args.from, args.to);
    }
    const docs = contactBills.map((b) => ({
      id: b._id as string,
      ref: `Bill due ${b.dueDate}`,
      issueDate: b.issueDate,
      dueDate: b.dueDate,
      status: b.status,
      entryIds: b.entryIds,
    }));
    const ledger = await loadControlAccountLedger(ctx, entity._id, apAccountId, docs);
    return buildLedgerStatement("payable", contact, company, currency, ledger, args.mode, args.from, args.to);
  },
});

// ---- pure builders (shared, ledger-tied) ---------------------------------

function buildContactReadModel(
  contact: Doc<"contacts">,
  contactInvoices: Doc<"invoices">[],
  contactBills: Doc<"bills">[],
  contactTxns: Doc<"transactions">[],
  accountsById: Map<Id<"ledgerAccounts">, Doc<"ledgerAccounts">>,
  isSettlement: (id?: Id<"ledgerAccounts">) => boolean,
  asOf: string,
  currency: string,
) {
  const openInvoices = contactInvoices.filter((i) => i.status === "open" || i.status === "overdue");
  const openReceivableMinor = openInvoices.reduce((s, i) => s + (i.totalMinor - i.amountPaidMinor), 0);
  const overdueReceivableMinor = openInvoices
    .filter((i) => i.status === "overdue" || diffDays(asOf, i.dueDate) > 0)
    .reduce((s, i) => s + (i.totalMinor - i.amountPaidMinor), 0);
  const openBills = contactBills.filter((b) => b.status === "open");
  const openPayableMinor = openBills.reduce((s, b) => s + b.totalMinor, 0);
  const overduePayableMinor = openBills
    .filter((b) => diffDays(asOf, b.dueDate) > 0)
    .reduce((s, b) => s + b.totalMinor, 0);

  // Lifetime in (customer payments) and out (vendor spend), settlement legs
  // excluded so a paid invoice/bill is counted exactly once (no double-count).
  const lifetimeInMinor =
    contactInvoices.reduce((s, i) => s + i.amountPaidMinor, 0) +
    contactTxns.filter((t) => t.amountMinor > 0 && !isSettlement(t.categoryAccountId)).reduce((s, t) => s + t.amountMinor, 0);
  const lifetimeOutMinor =
    contactBills.reduce((s, b) => s + b.totalMinor, 0) +
    contactTxns.filter((t) => t.amountMinor < 0 && !isSettlement(t.categoryAccountId)).reduce((s, t) => s + Math.abs(t.amountMinor), 0);

  // Aging on open AR and open AP, reported separately.
  const arAging = emptyAging();
  for (const i of openInvoices) addToAging(arAging, i.dueDate, i.totalMinor - i.amountPaidMinor, asOf);
  const apAging = emptyAging();
  for (const b of openBills) addToAging(apAging, b.dueDate, b.totalMinor, asOf);

  // Activity timeline with a RUNNING BALANCE. We track AR and AP as separate
  // running balances (never netted). An invoice issued raises AR; a payment
  // received lowers it. A bill raises AP; a settlement lowers it.
  type Activity = {
    id: string;
    kind: "invoice" | "invoice-payment" | "bill" | "bill-payment";
    date: string;
    label: string;
    side: "receivable" | "payable";
    chargeMinor: number; // increases what's owed on that side
    paymentMinor: number; // decreases it
    status: string;
    entryIds: string[];
  };
  const activity: Activity[] = [];
  for (const i of contactInvoices) {
    if (i.status === "draft") continue;
    activity.push({
      id: i._id, kind: "invoice", date: i.issueDate, label: `Invoice ${i.number}`,
      side: "receivable", chargeMinor: i.totalMinor, paymentMinor: 0, status: i.status,
      entryIds: i.entryIds.map((e) => e as string),
    });
    if (i.amountPaidMinor > 0) {
      const paidStep = (i.timeline ?? []).find((t) => t.kind === "paid");
      activity.push({
        id: `${i._id}:pay`, kind: "invoice-payment",
        date: paidStep ? new Date(paidStep.at).toISOString().slice(0, 10) : i.dueDate,
        label: `Payment · invoice ${i.number}`, side: "receivable",
        chargeMinor: 0, paymentMinor: i.amountPaidMinor, status: "paid",
        entryIds: i.entryIds.map((e) => e as string),
      });
    }
  }
  for (const b of contactBills) {
    activity.push({
      id: b._id, kind: "bill", date: b.issueDate, label: `Bill due ${b.dueDate}`,
      side: "payable", chargeMinor: b.totalMinor, paymentMinor: 0, status: b.status,
      entryIds: b.entryIds.map((e) => e as string),
    });
    if (b.status === "paid") {
      activity.push({
        id: `${b._id}:pay`, kind: "bill-payment", date: b.dueDate,
        label: `Payment · bill`, side: "payable", chargeMinor: 0, paymentMinor: b.totalMinor,
        status: "paid", entryIds: b.entryIds.map((e) => e as string),
      });
    }
  }
  activity.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
  let arRunning = 0;
  let apRunning = 0;
  const timeline = activity.map((row) => {
    if (row.side === "receivable") arRunning += row.chargeMinor - row.paymentMinor;
    else apRunning += row.chargeMinor - row.paymentMinor;
    return { ...row, runningReceivableMinor: arRunning, runningPayableMinor: apRunning };
  });
  // Most-recent first for display.
  timeline.reverse();

  const defaultCategory = contact.defaultCategoryId ? accountsById.get(contact.defaultCategoryId) : null;
  const lastActivityDate = activity.length ? activity[activity.length - 1].date : null;

  // Open items (AR + AP) with per-item aging — for the Open items tab.
  const openItems = [
    ...openInvoices.map((i) => ({
      id: i._id, side: "receivable" as const, ref: `Invoice ${i.number}`,
      issueDate: i.issueDate, dueDate: i.dueDate, balanceMinor: i.totalMinor - i.amountPaidMinor,
      overdueDays: Math.max(0, diffDays(asOf, i.dueDate)), status: i.status,
    })),
    ...openBills.map((b) => ({
      id: b._id, side: "payable" as const, ref: `Bill due ${b.dueDate}`,
      issueDate: b.issueDate, dueDate: b.dueDate, balanceMinor: b.totalMinor,
      overdueDays: Math.max(0, diffDays(asOf, b.dueDate)), status: b.status,
    })),
  ].sort((a, b) => b.overdueDays - a.overdueDays || a.dueDate.localeCompare(b.dueDate));

  return {
    id: contact._id,
    name: contact.name,
    roles: contact.roles,
    email: contact.email ?? null,
    aliases: contact.aliases,
    notes: contact.notes ?? null,
    archived: contact.archived === true,
    currency,
    asOf,
    kpis: {
      openReceivableMinor,
      openPayableMinor,
      overdueReceivableMinor,
      overduePayableMinor,
      lifetimeInMinor,
      lifetimeOutMinor,
    },
    arAging,
    apAging,
    timeline,
    openItems,
    lastActivityDate,
    defaultCategory: defaultCategory ? { id: defaultCategory._id, name: defaultCategory.name, number: defaultCategory.number } : null,
  };
}

type StatementLine = {
  date: string;
  ref: string;
  description: string;
  chargeMinor: number;
  paymentMinor: number;
  balanceMinor: number;
  entryIds: string[];
};

// A document (invoice or bill) reduced to its ledger-relevant identity. The
// contact link lives here, not on the journal line, so this is how a statement
// maps posted lines back to a customer/vendor.
type StatementDoc = {
  id: string;
  ref: string;
  issueDate: string;
  dueDate: string;
  status: string;
  entryIds: Id<"journalEntries">[];
};

// One posted control-account movement: the net effect of a single journal entry
// on the A/R or A/P account, attributed to its source document. `signedMinor` is
// in control-account terms (debit positive), so it is +charge / −payment for A/R
// and −charge / +payment for A/P (the caller orients it per side).
type LedgerMovement = {
  entryId: string;
  docId: string;
  ref: string;
  issueDate: string;
  dueDate: string;
  status: string;
  date: string; // the posted journal entry's date — the ledger truth
  debitMinor: number;
  creditMinor: number;
};

/**
 * Read the POSTED journal lines that hit the given control account (A/R 1100 or
 * A/P 2100) for this contact's documents, and fold each entry down to its net
 * control-account movement. Entity-scoped, bounded with take(). This is the read
 * that makes the statement ledger-derived: amounts come from journalLines, not
 * from invoice/bill document totals.
 */
async function loadControlAccountLedger(
  ctx: QueryCtx,
  entityId: Id<"entities">,
  controlAccountId: Id<"ledgerAccounts"> | null,
  docs: StatementDoc[],
): Promise<LedgerMovement[]> {
  if (!controlAccountId) return [];
  // entryId → the document that owns it (for the contact attribution + labels).
  const docByEntry = new Map<string, StatementDoc>();
  for (const doc of docs) {
    for (const entryId of doc.entryIds) docByEntry.set(entryId as string, doc);
  }
  if (docByEntry.size === 0) return [];

  // Read each entry's posted lines and keep only the control-account legs.
  // by_entry is bounded per entry; the total is bounded by the contact's doc
  // count (already capped by the take(2000) on invoices/bills upstream).
  const movements: LedgerMovement[] = [];
  for (const doc of docs) {
    for (const entryId of doc.entryIds) {
      const entry = await ctx.db.get(entryId);
      if (!entry || entry.entityId !== entityId) continue; // posted-entry + entity guard
      const lines = await ctx.db
        .query("journalLines")
        .withIndex("by_entry", (q) => q.eq("entryId", entryId))
        .take(200);
      let debitMinor = 0;
      let creditMinor = 0;
      for (const line of lines) {
        if (line.accountId !== controlAccountId) continue;
        debitMinor += line.debitMinor;
        creditMinor += line.creditMinor;
      }
      if (debitMinor === 0 && creditMinor === 0) continue; // entry didn't touch the control account
      movements.push({
        entryId: entryId as string,
        docId: doc.id,
        ref: doc.ref,
        issueDate: doc.issueDate,
        dueDate: doc.dueDate,
        status: doc.status,
        date: entry.date,
        debitMinor,
        creditMinor,
      });
    }
  }
  return movements;
}

/**
 * Build a statement from posted control-account movements. `side` orients the
 * sign convention: A/R balance = Σ(debits − credits); A/P balance =
 * Σ(credits − debits). Either way a "charge" raises the balance and a "payment"
 * lowers it, so opening + charges − payments == closing — the invariant the
 * reconciliation test asserts against journalLines.
 */
function buildLedgerStatement(
  side: "receivable" | "payable",
  contact: Doc<"contacts">,
  company: string,
  currency: string,
  movements: LedgerMovement[],
  mode: "balance-forward" | "open-item",
  from: string,
  to: string,
) {
  const contactRef = { id: contact._id, name: contact.name, email: contact.email ?? null };
  // Orient each movement to balance-raising "charge" vs balance-lowering
  // "payment", straight from the posted debit/credit on the control account.
  const oriented = movements.map((m) => {
    const chargeMinor = side === "receivable" ? m.debitMinor : m.creditMinor;
    const paymentMinor = side === "receivable" ? m.creditMinor : m.debitMinor;
    const description =
      chargeMinor > 0
        ? side === "receivable"
          ? "Invoice issued"
          : "Bill received"
        : side === "receivable"
          ? "Payment received"
          : "Payment sent";
    return { ...m, chargeMinor, paymentMinor, description };
  });
  oriented.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));

  if (mode === "open-item") {
    const asOf = to;
    // Net each document's control-account legs → its ledger-derived balance, then
    // keep the ones the books still consider OPEN. We gate on the document status
    // (open/overdue) as well as a positive ledger net: a settled item is dropped
    // even when its settlement credit was not posted as a separate entry, so the
    // collections total always ties to the directory's open A/R + A/P.
    const isOpenStatus = (status: string) =>
      side === "receivable" ? status === "open" || status === "overdue" : status === "open";
    const byDoc = new Map<string, { ref: string; dueDate: string; status: string; balanceMinor: number; entryIds: Set<string> }>();
    for (const m of oriented) {
      const existing = byDoc.get(m.docId) ?? { ref: m.ref, dueDate: m.dueDate, status: m.status, balanceMinor: 0, entryIds: new Set<string>() };
      existing.balanceMinor += m.chargeMinor - m.paymentMinor;
      existing.entryIds.add(m.entryId);
      byDoc.set(m.docId, existing);
    }
    const lines: StatementLine[] = [...byDoc.values()]
      .filter((d) => isOpenStatus(d.status) && d.balanceMinor > 0) // still outstanding per the ledger
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((d) => ({
        date: d.dueDate,
        ref: d.ref,
        description: diffDays(asOf, d.dueDate) > 0 ? `${diffDays(asOf, d.dueDate)} days overdue` : "Not yet due",
        chargeMinor: d.balanceMinor,
        paymentMinor: 0,
        balanceMinor: d.balanceMinor,
        entryIds: [...d.entryIds],
      }));
    const aging = emptyAging();
    for (const d of byDoc.values()) {
      if (isOpenStatus(d.status) && d.balanceMinor > 0) addToAging(aging, d.dueDate, d.balanceMinor, asOf);
    }
    return {
      side, mode, company, currency, from, to,
      contact: contactRef,
      openingBalanceMinor: 0,
      closingBalanceMinor: aging.totalMinor,
      lines,
      aging,
      totalChargesMinor: aging.totalMinor,
      totalPaymentsMinor: 0,
    };
  }

  // Balance-Forward: opening = control-account net of all movements before
  // `from`; then one line per posted entry in the window, carrying a running
  // balance that preserves the double-entry invariant.
  const opening = oriented
    .filter((m) => m.date < from)
    .reduce((s, m) => s + m.chargeMinor - m.paymentMinor, 0);
  let running = opening;
  const periodMovements = oriented.filter((m) => m.date >= from && m.date <= to);
  const lines: StatementLine[] = periodMovements.map((m) => {
    running += m.chargeMinor - m.paymentMinor;
    return {
      date: m.date,
      ref: m.ref,
      description: m.description,
      chargeMinor: m.chargeMinor,
      paymentMinor: m.paymentMinor,
      balanceMinor: running,
      entryIds: [m.entryId],
    };
  });
  return {
    side, mode, company, currency, from, to,
    contact: contactRef,
    openingBalanceMinor: opening,
    closingBalanceMinor: running,
    lines,
    aging: null,
    totalChargesMinor: periodMovements.reduce((s, m) => s + m.chargeMinor, 0),
    totalPaymentsMinor: periodMovements.reduce((s, m) => s + m.paymentMinor, 0),
  };
}
