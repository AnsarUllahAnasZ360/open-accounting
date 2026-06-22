import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireAnyWorkspaceRole } from "./authz";

// ---------------------------------------------------------------------------
// Full-account export — "your books are a file you own" (Epic E11-T9).
//
// Assembles a COMPLETE, SECRET-FREE snapshot of one entity's books: entities,
// chart of accounts, journal entries + lines, transactions, contacts, invoices,
// bills, employees, payroll runs + lines, rules, and SAFE connection metadata.
// Every credential/token field is stripped server-side (no encryptedPayload, no
// Plaid access token, no API keys, no admin-only bank details) so the file the
// owner walks away with can never leak a secret. Re-import is deferred (Q59).
//
// Covers FULL history (no hardcoded date range). Bounded per-table with a cap so
// a very large book stays under Convex limits; `truncated` flags any table that
// hit the cap.
// ---------------------------------------------------------------------------

const EXPORT_CAP = 20000;

async function takeByEntity<T extends string>(
  ctx: QueryCtx,
  table: T,
  entityId: Id<"entities">,
): Promise<{ rows: any[]; truncated: boolean }> {
  const fetched = await (ctx.db.query(table as never) as any)
    .withIndex("by_entity", (q: any) => q.eq("entityId", entityId))
    .take(EXPORT_CAP + 1);
  const truncated = fetched.length > EXPORT_CAP;
  return { rows: truncated ? fetched.slice(0, EXPORT_CAP) : fetched, truncated };
}

/** Strip a journal entry to its public, secret-free shape. */
function exportEntry(entry: Doc<"journalEntries">) {
  return {
    id: entry._id,
    date: entry.date,
    memo: entry.memo,
    source: entry.source,
    sourceId: entry.sourceId,
    createdAt: entry.createdAt,
  };
}

function exportLine(line: Doc<"journalLines">) {
  return {
    id: line._id,
    entryId: line.entryId,
    accountId: line.accountId,
    debitMinor: line.debitMinor,
    creditMinor: line.creditMinor,
    currency: line.currency ?? null,
    contactId: line.contactId ?? null,
  };
}

/**
 * Full-account snapshot for the active workspace's resolved entity. Owner /
 * accountant only (both have books access). Read-only; pair with `logExport` to
 * record the `workspace.exported` audit row after the download is built.
 */
export const fullAccount = query({
  args: { entityId: v.optional(v.id("entities")) },
  handler: async (ctx, args) => {
    const { membership } = await requireAnyWorkspaceRole(ctx, "accountant");

    // Resolve the target entity strictly within the caller's workspace.
    let entity: Doc<"entities"> | null = null;
    if (args.entityId) {
      const candidate = await ctx.db.get(args.entityId);
      if (candidate && candidate.workspaceId === membership.workspaceId) entity = candidate;
    } else {
      entity = await ctx.db
        .query("entities")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
        .first();
    }
    if (!entity) {
      throw new ConvexError("No business found to export in this workspace.");
    }
    const entityId = entity._id;

    const workspace = await ctx.db.get(membership.workspaceId);

    const [
      accounts,
      entries,
      lines,
      transactions,
      contacts,
      invoices,
      bills,
      employees,
      payrollRuns,
      payrollRunLines,
      rules,
      bankAccounts,
      stripeAccounts,
      financialConnections,
    ] = await Promise.all([
      takeByEntity(ctx, "ledgerAccounts", entityId),
      takeByEntity(ctx, "journalEntries", entityId),
      takeByEntity(ctx, "journalLines", entityId),
      takeByEntity(ctx, "transactions", entityId),
      takeByEntity(ctx, "contacts", entityId),
      takeByEntity(ctx, "invoices", entityId),
      takeByEntity(ctx, "bills", entityId),
      takeByEntity(ctx, "employees", entityId),
      takeByEntity(ctx, "payrollRuns", entityId),
      takeByEntity(ctx, "payrollRunLines", entityId),
      takeByEntity(ctx, "rules", entityId),
      takeByEntity(ctx, "bankAccounts", entityId),
      takeByEntity(ctx, "stripeAccounts", entityId),
      takeByEntity(ctx, "financialConnections", entityId),
    ]);

    const anyTruncated =
      accounts.truncated ||
      entries.truncated ||
      lines.truncated ||
      transactions.truncated ||
      contacts.truncated ||
      invoices.truncated ||
      bills.truncated ||
      employees.truncated ||
      payrollRuns.truncated ||
      payrollRunLines.truncated ||
      rules.truncated;

    return {
      meta: {
        format: "openbooks.account.v1",
        workspace: workspace ? { name: workspace.name } : null,
        entity: { id: entity._id, name: entity.name, currency: entity.currency },
        exportedFields: "full-history; secrets and tokens stripped",
        truncated: anyTruncated,
        rowCounts: {
          accounts: accounts.rows.length,
          journalEntries: entries.rows.length,
          journalLines: lines.rows.length,
          transactions: transactions.rows.length,
          contacts: contacts.rows.length,
          invoices: invoices.rows.length,
          bills: bills.rows.length,
          employees: employees.rows.length,
          payrollRuns: payrollRuns.rows.length,
          payrollRunLines: payrollRunLines.rows.length,
          rules: rules.rows.length,
        },
      },
      entity: {
        id: entity._id,
        name: entity.name,
        slug: entity.slug,
        businessType: entity.businessType,
        currency: entity.currency,
        archived: entity.archived ?? false,
      },
      accounts: accounts.rows.map((a: Doc<"ledgerAccounts">) => ({
        id: a._id,
        name: a.name,
        type: a.type,
        subtype: a.subtype,
        number: a.number,
        currency: a.currency,
        isSystem: a.isSystem,
        archived: a.archived,
        streamTag: a.streamTag ?? null,
      })),
      journalEntries: entries.rows.map(exportEntry),
      journalLines: lines.rows.map(exportLine),
      transactions: transactions.rows.map((t: Doc<"transactions">) => ({
        id: t._id,
        date: t.date,
        amountMinor: t.amountMinor,
        currency: t.currency,
        merchant: t.merchant,
        rawDescription: t.rawDescription,
        status: t.status,
        review: t.review,
        source: t.source,
        categoryAccountId: t.categoryAccountId ?? null,
        contactId: t.contactId ?? null,
        entryId: t.entryId ?? null,
      })),
      contacts: contacts.rows.map((c: Doc<"contacts">) => ({
        id: c._id,
        name: c.name,
        roles: c.roles,
        email: c.email ?? null,
        aliases: c.aliases,
        notes: c.notes ?? null,
        archived: c.archived ?? false,
        // NOTE: c.bankDetails is intentionally OMITTED — admin-only payout detail.
      })),
      invoices: invoices.rows.map((i: Doc<"invoices">) => ({
        id: i._id,
        contactId: i.contactId,
        number: i.number,
        status: i.status,
        currency: i.currency,
        issueDate: i.issueDate,
        dueDate: i.dueDate,
        totalMinor: i.totalMinor,
        amountPaidMinor: i.amountPaidMinor,
        lineItems: i.lineItems ?? null,
        memo: i.memo ?? null,
        entryIds: i.entryIds,
      })),
      bills: bills.rows.map((b: Doc<"bills">) => ({
        id: b._id,
        contactId: b.contactId,
        status: b.status,
        issueDate: b.issueDate,
        dueDate: b.dueDate,
        totalMinor: b.totalMinor,
        currency: b.currency,
        entryIds: b.entryIds,
      })),
      employees: employees.rows.map((e: Doc<"employees">) => ({
        id: e._id,
        name: e.name,
        title: e.title ?? null,
        country: e.country,
        currency: e.currency,
        monthlySalaryMinor: e.monthlySalaryMinor,
        active: e.active,
        // NOTE: e.payTo (bank details) is intentionally OMITTED.
      })),
      payrollRuns: payrollRuns.rows.map((r: Doc<"payrollRuns">) => ({
        id: r._id,
        period: r.period,
        status: r.status,
        source: r.source ?? "manual",
        totalBaseMinor: r.totalBaseMinor,
        postingDate: r.postingDate ?? null,
        entryIds: r.entryIds,
      })),
      payrollRunLines: payrollRunLines.rows.map((l: Doc<"payrollRunLines">) => ({
        id: l._id,
        runId: l.runId,
        employeeName: l.employeeName,
        country: l.country,
        currency: l.currency,
        baseSalaryMinor: l.baseSalaryMinor,
        adjustmentMinor: l.adjustmentMinor,
        fxRateMicros: l.fxRateMicros,
        finalLocalMinor: l.finalLocalMinor,
        baseEquivalentMinor: l.baseEquivalentMinor,
        paid: l.paid,
      })),
      rules: rules.rows.map((r: Doc<"rules">) => ({
        id: r._id,
        order: r.order,
        name: r.name,
        merchantContains: r.merchantContains ?? null,
        descriptionContains: r.descriptionContains ?? null,
        amountMinMinor: r.amountMinMinor ?? null,
        amountMaxMinor: r.amountMaxMinor ?? null,
        direction: r.direction,
        categoryAccountId: r.categoryAccountId,
        autoPost: r.autoPost,
      })),
      // SAFE connection metadata only — every credential/token field stripped.
      connections: {
        bankAccounts: bankAccounts.rows.map((b: Doc<"bankAccounts">) => ({
          id: b._id,
          name: b.name,
          mask: b.mask,
          kind: b.kind,
          balanceMinor: b.balanceMinor,
          includeInSync: b.includeInSync,
          // plaidAccountId/plaidItemId/lastSyncCursor are sync handles, not secrets,
          // but omitted to keep the export purely owner-readable business data.
        })),
        stripeAccounts: stripeAccounts.rows.map((s: Doc<"stripeAccounts">) => ({
          id: s._id,
          label: s.label,
          mode: s.mode ?? null,
          status: s.status ?? null,
          webhookStatus: s.webhookStatus ?? null,
        })),
        financialConnections: financialConnections.rows.map((f: Doc<"financialConnections">) => ({
          id: f._id,
          provider: f.provider,
          mode: f.mode,
          displayName: f.displayName,
          status: f.status,
          webhookStatus: f.webhookStatus ?? null,
        })),
      },
    };
  },
});

/**
 * Record the export for traceability (Epic E11-T9). Called by the client after a
 * full-account download is assembled. Owner/accountant only; writes a
 * `workspace.exported` audit row scoped to the caller's workspace.
 */
export const logExport = mutation({
  args: { entityId: v.optional(v.id("entities")) },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireAnyWorkspaceRole(ctx, "accountant");
    let entityName = "workspace";
    if (args.entityId) {
      const entity = await ctx.db.get(args.entityId);
      if (entity && entity.workspaceId === membership.workspaceId) entityName = entity.name;
    }
    await ctx.db.insert("auditEvents", {
      workspaceId: membership.workspaceId,
      actorUserId: userId,
      action: "workspace.exported",
      entityType: "workspace",
      entityId: membership.workspaceId,
      summary: `Owner exported the full account snapshot for ${entityName}.`,
      createdAt: Date.now(),
    });
    return { logged: true as const };
  },
});
