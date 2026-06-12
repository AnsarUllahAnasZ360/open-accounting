import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";

const today = "2026-06-11";

type MinorBucket = {
  currentMinor: number;
  days30Minor: number;
  days60Minor: number;
  days90Minor: number;
  totalMinor: number;
};

async function getActiveEntity(ctx: QueryCtx, entityId?: Id<"entities">) {
  const { membership } = await requireAnyWorkspaceRole(ctx, "member");
  const entity = entityId
    ? await ctx.db.get(entityId)
    : (await ctx.db
        .query("entities")
        .withIndex("by_workspace_and_slug", (q) =>
          q.eq("workspaceId", membership.workspaceId).eq("slug", "acme-studio-llc"),
        )
        .unique()) ??
      (await ctx.db
        .query("entities")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
        .first());

  if (!entity || entity.workspaceId !== membership.workspaceId) return { membership, entity: null };
  await requireWorkspaceRole(ctx, entity.workspaceId, "member");
  return { membership, entity };
}

function dateDiffDays(left: string, right: string) {
  const leftTime = Date.parse(`${left}T00:00:00Z`);
  const rightTime = Date.parse(`${right}T00:00:00Z`);
  return Math.floor((leftTime - rightTime) / 86_400_000);
}

function addAging(bucket: MinorBucket, dueDate: string, amountMinor: number) {
  const daysPastDue = Math.max(0, dateDiffDays(today, dueDate));
  if (daysPastDue <= 30) bucket.currentMinor += amountMinor;
  else if (daysPastDue <= 60) bucket.days30Minor += amountMinor;
  else if (daysPastDue <= 90) bucket.days60Minor += amountMinor;
  else bucket.days90Minor += amountMinor;
  bucket.totalMinor += amountMinor;
}

function emptyBucket(): MinorBucket {
  return {
    currentMinor: 0,
    days30Minor: 0,
    days60Minor: 0,
    days90Minor: 0,
    totalMinor: 0,
  };
}

function directionLabel(rule: Doc<"rules">) {
  if (rule.direction === "inflow") return "money in";
  if (rule.direction === "outflow") return "money out";
  return "any money movement";
}

function ruleSummary(rule: Doc<"rules">, accountName: string) {
  const conditions = [
    rule.merchantContains ? `merchant contains "${rule.merchantContains}"` : null,
    rule.descriptionContains ? `description contains "${rule.descriptionContains}"` : null,
    directionLabel(rule),
  ].filter(Boolean);
  return `If ${conditions.join(" and ")} -> ${accountName}${rule.autoPost ? ", auto-post" : ", send to Inbox"}`;
}

function auditActorLabel(event: Doc<"auditEvents">, entry?: Doc<"journalEntries">) {
  const action = event.action.toLowerCase();
  const summary = event.summary.toLowerCase();

  if (action.startsWith("system.")) {
    return "system";
  }

  if (
    action.startsWith("ai.") ||
    entry?.source === "ai" ||
    summary.includes("pipeline ai") ||
    summary.includes("pipeline memory") ||
    summary.includes("ai-confirmed") ||
    summary.includes("ai drafted")
  ) {
    return "ai";
  }

  if (action.startsWith("rule.") || entry?.source === "rule" || summary.includes("rule:")) {
    return "rule";
  }

  return event.actorUserId ? "user" : "system";
}

function baseMinorForEmployee(employee: Doc<"employees">, baseCurrency: string) {
  if (employee.currency === baseCurrency) return employee.monthlySalaryMinor;
  const conversionDenominator: Record<string, number> = {
    PKR: 278,
    INR: 83,
  };
  return Math.round(employee.monthlySalaryMinor / (conversionDenominator[employee.currency] ?? 1));
}

function fxDisplay(employee: Doc<"employees">, baseCurrency: string) {
  if (employee.currency === baseCurrency) return `1 ${baseCurrency} = 1 ${employee.currency}`;
  const denominator: Record<string, number> = {
    PKR: 278,
    INR: 83,
  };
  return `1 ${baseCurrency} = ${denominator[employee.currency] ?? 1} ${employee.currency}`;
}

export const overview = query({
  args: {
    entityId: v.optional(v.id("entities")),
  },
  handler: async (ctx, args) => {
    const { membership, entity } = await getActiveEntity(ctx, args.entityId);

    if (!entity) {
      return {
        entity: null,
        contacts: { rows: [], selectedProfile: null },
        invoices: { kpis: { openMinor: 0, overdueMinor: 0, paidLast30Minor: 0, averageDaysToPay: 0 }, rows: [], aging: emptyBucket() },
        bills: {
          kpis: { openMinor: 0, dueThisWeekMinor: 0, overdueMinor: 0 },
          groups: [],
          matchCandidates: [],
          uploadPdf: { status: "available", reason: "Upload a receipt or bill PDF after creating a business.", documents: [] },
        },
        payroll: { employees: [], runs: [], currencyTotals: [], statementRows: [], statementCsv: "" },
        settings: {
          businesses: { rows: [], addEntity: { status: "available" } },
          rules: { rows: [], pendingSuggestion: { status: "waiting_for_ai_stage" } },
          audit: { rows: [] },
        },
      };
    }

    const [
      entities,
      contacts,
      invoices,
      bills,
      transactions,
      accounts,
      rules,
      employees,
      payrollRuns,
      documents,
      inboxItems,
      auditEvents,
      journalEntries,
    ] = await Promise.all([
      ctx.db.query("entities").withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId)).take(50),
      ctx.db.query("contacts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(200),
      ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(200),
      ctx.db.query("bills").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(200),
      ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(1000),
      ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(200),
      ctx.db.query("rules").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(100),
      ctx.db.query("employees").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(100),
      ctx.db.query("payrollRuns").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(60),
      ctx.db.query("documents").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(100),
      ctx.db.query("inboxItems").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(1000),
      ctx.db.query("auditEvents").withIndex("by_workspace", (q) => q.eq("workspaceId", entity.workspaceId)).order("desc").take(200),
      ctx.db.query("journalEntries").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).order("desc").take(1000),
    ]);

    const liveSandboxEntity = entities.find((row) => row.slug === "live-sandbox") ?? null;
    const contactsById = new Map(contacts.map((contact) => [contact._id, contact]));
    const accountsById = new Map(accounts.map((account) => [account._id, account]));
    const documentsById = new Map(documents.map((document) => [document._id, document]));
    const transactionsById = new Map(transactions.map((transaction) => [transaction._id, transaction]));
    const journalEntriesById = new Map(journalEntries.map((entry) => [entry._id as string, entry]));
    const receiptInboxByDocumentId = new Map(
      inboxItems
        .filter((item) => item.kind === "receipt" && item.documentId && item.status === "open")
        .map((item) => [item.documentId!, item]),
    );

    const invoicesByContact = new Map<Id<"contacts">, Doc<"invoices">[]>();
    for (const invoice of invoices) {
      const rows = invoicesByContact.get(invoice.contactId) ?? [];
      rows.push(invoice);
      invoicesByContact.set(invoice.contactId, rows);
    }

    const billsByContact = new Map<Id<"contacts">, Doc<"bills">[]>();
    for (const bill of bills) {
      const rows = billsByContact.get(bill.contactId) ?? [];
      rows.push(bill);
      billsByContact.set(bill.contactId, rows);
    }

    const transactionsByContact = new Map<Id<"contacts">, Doc<"transactions">[]>();
    for (const transaction of transactions) {
      if (!transaction.contactId) continue;
      const rows = transactionsByContact.get(transaction.contactId) ?? [];
      rows.push(transaction);
      transactionsByContact.set(transaction.contactId, rows);
    }

    const contactRows = contacts
      .map((contact) => {
        const contactInvoices = invoicesByContact.get(contact._id) ?? [];
        const contactBills = billsByContact.get(contact._id) ?? [];
        const contactTransactions = transactionsByContact.get(contact._id) ?? [];
        const openReceivableMinor = contactInvoices
          .filter((invoice) => invoice.status === "open" || invoice.status === "overdue")
          .reduce((sum, invoice) => sum + invoice.totalMinor - invoice.amountPaidMinor, 0);
        const openPayableMinor = contactBills
          .filter((bill) => bill.status === "open")
          .reduce((sum, bill) => sum + bill.totalMinor, 0);
        const totalThisYearMinor =
          contactInvoices
            .filter((invoice) => invoice.issueDate.startsWith("2026"))
            .reduce((sum, invoice) => sum + invoice.amountPaidMinor, 0) +
          contactBills
            .filter((bill) => bill.issueDate.startsWith("2026"))
            .reduce((sum, bill) => sum + bill.totalMinor, 0) +
          contactTransactions
            .filter((transaction) => transaction.date.startsWith("2026"))
            .reduce((sum, transaction) => sum + Math.abs(transaction.amountMinor), 0);
        const lastActivity = [
          ...contactInvoices.map((invoice) => invoice.updatedAt),
          ...contactBills.map((bill) => bill.updatedAt),
          ...contactTransactions.map((transaction) => transaction.updatedAt),
          contact.updatedAt,
        ].sort((a, b) => b - a)[0];
        const defaultCategory = contact.defaultCategoryId ? accountsById.get(contact.defaultCategoryId) : null;
        return {
          id: contact._id,
          name: contact.name,
          roles: contact.roles,
          email: contact.email ?? null,
          aliases: contact.aliases,
          openReceivableMinor,
          openPayableMinor,
          totalThisYearMinor,
          lastActivity,
          defaultCategory: defaultCategory
            ? { id: defaultCategory._id, name: defaultCategory.name, number: defaultCategory.number }
            : null,
          defaultCategoryRule: {
            status: defaultCategory ? "active" : "ready_to_configure",
            label: defaultCategory
              ? `Always file ${contact.name} as ${defaultCategory.name}`
              : `Set a default category for ${contact.name}`,
          },
        };
      })
      .sort((a, b) => b.totalThisYearMinor - a.totalThisYearMinor || a.name.localeCompare(b.name));

    const selectedContact = contactRows[0] ?? null;
    const selectedProfile = selectedContact
      ? {
          ...selectedContact,
          history: [
            ...(invoicesByContact.get(selectedContact.id) ?? []).map((invoice) => ({
              id: invoice._id,
              kind: "invoice",
              date: invoice.issueDate,
              label: `Invoice ${invoice.number}`,
              amountMinor: invoice.totalMinor,
              status: invoice.status,
            })),
            ...(billsByContact.get(selectedContact.id) ?? []).map((bill) => ({
              id: bill._id,
              kind: "bill",
              date: bill.issueDate,
              label: `Bill due ${bill.dueDate}`,
              amountMinor: bill.totalMinor,
              status: bill.status,
            })),
            ...(transactionsByContact.get(selectedContact.id) ?? []).map((transaction) => ({
              id: transaction._id,
              kind: "transaction",
              date: transaction.date,
              label: transaction.merchant,
              amountMinor: transaction.amountMinor,
              status: transaction.review,
            })),
          ]
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 12),
          mergeFlow: {
            status: "placeholder",
            reason: "The current schema stores aliases but not duplicate-contact candidate records.",
            suggestion: selectedContact.aliases[0]
              ? `${selectedContact.aliases[0]} may be another name for ${selectedContact.name}`
              : `No duplicate candidates for ${selectedContact.name}`,
          },
        }
      : null;

    const invoiceAging = emptyBucket();
    const invoiceRows = invoices
      .map((invoice) => {
        const balanceMinor = invoice.totalMinor - invoice.amountPaidMinor;
        if ((invoice.status === "open" || invoice.status === "overdue") && balanceMinor > 0) {
          addAging(invoiceAging, invoice.dueDate, balanceMinor);
        }
        return {
          id: invoice._id,
          number: invoice.number,
          customerName: contactsById.get(invoice.contactId)?.name ?? "Customer",
          status: invoice.status,
          currency: invoice.currency,
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate,
          totalMinor: invoice.totalMinor,
          amountPaidMinor: invoice.amountPaidMinor,
          balanceMinor,
          daysPastDue: Math.max(0, dateDiffDays(today, invoice.dueDate)),
        };
      })
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate));

    const billRows = bills
      .map((bill) => {
        const document = bill.documentId ? documentsById.get(bill.documentId) : null;
        return {
          id: bill._id,
          vendorName: contactsById.get(bill.contactId)?.name ?? "Vendor",
          status: bill.status,
          issueDate: bill.issueDate,
          dueDate: bill.dueDate,
          totalMinor: bill.totalMinor,
          currency: bill.currency,
          daysUntilDue: dateDiffDays(bill.dueDate, today),
          document: document
            ? { id: document._id, vendor: document.vendor, status: document.status, totalMinor: document.totalMinor }
            : null,
          postingAffordance: bill.entryIds.length > 0 ? "posted_to_ap" : "needs_ap_post",
        };
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    const billGroups = [
      { key: "overdue", label: "Overdue", rows: billRows.filter((bill) => bill.status === "open" && bill.daysUntilDue < 0) },
      { key: "this_week", label: "This week", rows: billRows.filter((bill) => bill.status === "open" && bill.daysUntilDue >= 0 && bill.daysUntilDue <= 7) },
      { key: "later", label: "Later", rows: billRows.filter((bill) => bill.status === "open" && bill.daysUntilDue > 7) },
      { key: "paid", label: "Paid", rows: billRows.filter((bill) => bill.status === "paid") },
    ];

    const openBankTransactions = transactions
      .filter((transaction) => transaction.amountMinor < 0 && transaction.review !== "excluded")
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 15)
      .map((transaction) => ({
        id: transaction._id,
        date: transaction.date,
        merchant: transaction.merchant,
        amountMinor: transaction.amountMinor,
        currency: transaction.currency,
      }));
    const receiptDocuments = await Promise.all(
      documents
        .filter((document) => document.kind === "receipt" || document.kind === "bill")
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 20)
        .map(async (document) => {
          const matchedTransaction = document.matchedTransactionId
            ? transactionsById.get(document.matchedTransactionId)
            : null;
          const inboxItem = receiptInboxByDocumentId.get(document._id) ?? null;
          const candidateTransaction = inboxItem?.transactionId
            ? transactionsById.get(inboxItem.transactionId)
            : null;
          return {
            id: document._id,
            kind: document.kind,
            vendor: document.vendor,
            date: document.date,
            totalMinor: document.totalMinor,
            currency: document.currency,
            status: document.status,
            fileName: document.fileName ?? null,
            fileUrl: document.storageId ? await ctx.storage.getUrl(document.storageId) : null,
            extractionSource: document.extractionSource ?? "manual",
            extractionConfidence: document.extractionConfidence ?? 0,
            extractionNotes: document.extractionNotes ?? "Seeded document.",
            candidateTransaction: candidateTransaction
              ? {
                  id: candidateTransaction._id,
                  merchant: candidateTransaction.merchant,
                  date: candidateTransaction.date,
                  amountMinor: candidateTransaction.amountMinor,
                  currency: candidateTransaction.currency,
                }
              : null,
            matchedTransaction: matchedTransaction
              ? {
                  id: matchedTransaction._id,
                  merchant: matchedTransaction.merchant,
                  date: matchedTransaction.date,
                  amountMinor: matchedTransaction.amountMinor,
                  currency: matchedTransaction.currency,
                }
              : null,
          };
        }),
    );

    const employeeRows = employees
      .map((employee) => {
        const baseAmountMinor = baseMinorForEmployee(employee, entity.currency);
        return {
          id: employee._id,
          name: employee.name,
          country: employee.country,
          currency: employee.currency,
          monthlySalaryMinor: employee.monthlySalaryMinor,
          baseAmountMinor,
          fxDisplay: fxDisplay(employee, entity.currency),
          active: employee.active,
          adjustmentMinor: 0,
          finalAmountMinor: employee.monthlySalaryMinor,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const currencyTotals = [...employeeRows.reduce((map, employee) => {
      const row = map.get(employee.currency) ?? { currency: employee.currency, localMinor: 0, baseMinor: 0 };
      row.localMinor += employee.monthlySalaryMinor;
      row.baseMinor += employee.baseAmountMinor;
      map.set(employee.currency, row);
      return map;
    }, new Map<string, { currency: string; localMinor: number; baseMinor: number }>()).values()].sort((a, b) =>
      a.currency.localeCompare(b.currency),
    );

    const statementRows = employeeRows.map((employee) => ({
      employeeName: employee.name,
      country: employee.country,
      currency: employee.currency,
      localMinor: employee.finalAmountMinor,
      baseMinor: employee.baseAmountMinor,
      fxDisplay: employee.fxDisplay,
    }));

    const statementCsv = [
      "employee,country,currency,local_minor,base_currency,base_minor,fx_display",
      ...statementRows.map((row) =>
        [
          row.employeeName,
          row.country,
          row.currency,
          String(row.localMinor),
          entity.currency,
          String(row.baseMinor),
          row.fxDisplay,
        ].join(","),
      ),
    ].join("\n");

    return {
      entity: {
        id: entity._id,
        name: entity.name,
        currency: entity.currency,
        businessType: entity.businessType,
        isDemo: entity.isDemo,
      },
      contacts: {
        rows: contactRows,
        selectedProfile,
      },
      invoices: {
        kpis: {
          openMinor: invoiceRows
            .filter((invoice) => invoice.status === "open" || invoice.status === "overdue")
            .reduce((sum, invoice) => sum + invoice.balanceMinor, 0),
          overdueMinor: invoiceRows
            .filter((invoice) => invoice.status === "overdue")
            .reduce((sum, invoice) => sum + invoice.balanceMinor, 0),
          paidLast30Minor: invoiceRows
            .filter((invoice) => invoice.status === "paid" && dateDiffDays(today, invoice.issueDate) <= 30)
            .reduce((sum, invoice) => sum + invoice.amountPaidMinor, 0),
          averageDaysToPay: 22,
        },
        rows: invoiceRows,
        aging: invoiceAging,
        composer: {
          saveDraftStatus: "available",
          sendViaStripeStatus: "blocked_until_m8",
          manualRecordStatus: "available_via_postEntry_integration",
        },
      },
      bills: {
        kpis: {
          openMinor: billRows
            .filter((bill) => bill.status === "open")
            .reduce((sum, bill) => sum + bill.totalMinor, 0),
          dueThisWeekMinor: billGroups
            .find((group) => group.key === "this_week")!
            .rows.reduce((sum, bill) => sum + bill.totalMinor, 0),
          overdueMinor: billGroups
            .find((group) => group.key === "overdue")!
            .rows.reduce((sum, bill) => sum + bill.totalMinor, 0),
        },
        groups: billGroups,
        matchCandidates: openBankTransactions,
        uploadPdf: {
          status: "available",
          reason: "Upload stores the file in Convex, extracts image or PDF text metadata, then auto-matches or queues a receipt inbox card.",
          documents: receiptDocuments,
        },
      },
      payroll: {
        employees: employeeRows,
        runs: payrollRuns
          .sort((a, b) => b.period.localeCompare(a.period))
          .map((run) => ({
            id: run._id,
            period: run.period,
            status: run.status,
            totalBaseMinor: run.totalBaseMinor,
            headcount: employees.filter((employee) => employee.active).length,
            currencyTotals,
            actionState: run.status === "draft" ? "ready_to_approve" : run.status === "approved" ? "ready_to_mark_paid" : "paid",
          })),
        currencyTotals,
        statementRows,
        statementCsv,
      },
      settings: {
        businesses: {
          rows: entities
            .sort((a, b) => Number(b.isDemo) - Number(a.isDemo) || a.name.localeCompare(b.name))
            .map((row) => ({
              id: row._id,
              name: row.name,
              slug: row.slug,
              businessType: row.businessType,
              currency: row.currency,
              isDemo: row.isDemo,
              canArchive: false,
              archiveReason: "The current entity schema does not include an archived flag.",
              isActive: row._id === entity._id,
            })),
          addEntity: {
            status: liveSandboxEntity ? "live_sandbox_ready" : "ready_for_live_sandbox",
            recommendedName: "Live Sandbox",
            recommendedCurrency: "USD",
            liveSandboxEntityId: liveSandboxEntity?._id ?? null,
          },
        },
        rules: {
          rows: rules
            .sort((a, b) => a.order - b.order)
            .map((rule) => {
              const account = accountsById.get(rule.categoryAccountId);
              return {
                id: rule._id,
                order: rule.order,
                name: rule.name,
                summary: ruleSummary(rule, account?.name ?? "selected category"),
                hitCount: rule.hitCount,
                active: rule.active,
                autoPost: rule.autoPost,
                categoryName: account?.name ?? "Unknown account",
                createdBy: rule.createdBy,
                editor: {
                  merchantContains: rule.merchantContains ?? "",
                  descriptionContains: rule.descriptionContains ?? "",
                  direction: rule.direction,
                  categoryAccountId: rule.categoryAccountId,
                },
              };
            }),
          pendingSuggestion: {
            status: "waiting_for_ai_stage",
            title: "AI-suggested rule slot",
            summary: "M10 will place drafted rules here after repeated corrections.",
          },
        },
        audit: {
          rows: auditEvents
            .filter((event) => event.entityId === entity._id || event.workspaceId === entity.workspaceId)
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 80)
            .map((event) => {
              const entry = event.entityType === "journalEntry" && event.entityId
                ? journalEntriesById.get(event.entityId)
                : undefined;
              return {
                id: event._id,
                when: event.createdAt,
                actor: auditActorLabel(event, entry),
                action: event.action,
                entityType: event.entityType,
                summary: event.summary,
                beforeAfter: `Before: previous recorded state. After: ${event.summary}`,
              };
            }),
        },
      },
    };
  },
});

/**
 * The workspace's active (report-subject) entity id, or null. A cheap query the
 * Settings sections use to scope entity-bound reads without pulling the full
 * module overview.
 */
export const activeEntityId = query({
  args: { entityId: v.optional(v.id("entities")) },
  handler: async (ctx, args) => {
    const { entity } = await getActiveEntity(ctx, args.entityId);
    return entity?._id ?? null;
  },
});

/**
 * The entity sandbox connections (Plaid/Stripe) should attach to. Sandbox data
 * must not pollute the demo books, so this prefers the dedicated "Live Sandbox"
 * entity; if it doesn't exist yet the Connections section offers to create it.
 */
export const connectionsTarget = query({
  args: {},
  handler: async (ctx) => {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const liveSandbox = await ctx.db
      .query("entities")
      .withIndex("by_workspace_and_slug", (q) =>
        q.eq("workspaceId", membership.workspaceId).eq("slug", "live-sandbox"),
      )
      .unique();
    const { entity: active } = await getActiveEntity(ctx);
    return {
      liveSandboxEntityId: liveSandbox?._id ?? null,
      liveSandboxReady: Boolean(liveSandbox),
      activeEntityId: active?._id ?? null,
    };
  },
});
