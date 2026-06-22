import { v } from "convex/values";

import { resolveActiveEntity } from "./activeEntity";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { requireAnyWorkspaceRole } from "./authz";

// The server-clock "today" (ISO YYYY-MM-DD). Callers may pass an explicit
// `today` so tests are deterministic; otherwise we read the request-time clock,
// which Convex pins once per query (E10-T6 — no frozen calendar literal). Mirrors
// the resolveToday helper used by coreViews.
function resolveToday(explicit?: string) {
  if (explicit && /^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  return new Date(Date.now()).toISOString().slice(0, 10);
}

type MinorBucket = {
  currentMinor: number;
  days30Minor: number;
  days60Minor: number;
  days90Minor: number;
  totalMinor: number;
};

function dateDiffDays(left: string, right: string) {
  const leftTime = Date.parse(`${left}T00:00:00Z`);
  const rightTime = Date.parse(`${right}T00:00:00Z`);
  return Math.floor((leftTime - rightTime) / 86_400_000);
}

function addAging(bucket: MinorBucket, dueDate: string, amountMinor: number, today: string) {
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
    // Optional server-clock anchor (ISO YYYY-MM-DD). Lets a test pin "today" so
    // aging / "this year" / run-rate windows are deterministic; production reads
    // the request-time clock (E10-T6).
    today: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const today = resolveToday(args.today);
    const currentYear = today.slice(0, 4);
    const { membership, entity } = await resolveActiveEntity(ctx, args.entityId);

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
        payroll: {
          employees: [],
          runs: [],
          currencyTotals: [],
          unmatchedCount: 0,
          statementRows: [],
          statementCsv: "",
          statementsByCurrency: [],
          // E10-T6: keep the empty branch's shape consistent with the populated
          // branch (and the ModuleOverview contract) — a zeroed insight rather
          // than an omitted field, so `data.payroll.insight` is never undefined.
          insight: {
            runRateBaseMinor: 0,
            runRateBasedOnApprovedRun: false,
            latestApprovedPeriod: null,
            headcount: 0,
            baseCurrency: "USD",
            hasFxExposure: false,
            fxExposureSharePct: 0,
            fxExposureBaseMinor: 0,
            nonBaseCurrencies: [],
          },
        },
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
      payrollRunLines,
      documents,
      inboxItems,
      auditEvents,
      journalEntries,
      journalLines,
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
      ctx.db.query("payrollRunLines").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
      ctx.db.query("documents").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(100),
      ctx.db.query("inboxItems").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(1000),
      ctx.db.query("auditEvents").withIndex("by_workspace", (q) => q.eq("workspaceId", entity.workspaceId)).order("desc").take(200),
      ctx.db.query("journalEntries").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).order("desc").take(1000),
      ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(4000),
    ]);

    const liveSandboxEntity = entities.find((row) => row.slug === "live-sandbox") ?? null;
    const contactsById = new Map(contacts.map((contact) => [contact._id, contact]));
    const accountsById = new Map(accounts.map((account) => [account._id, account]));
    // Accounts Payable (2100) / Accounts Receivable (1100) ledger account ids.
    // Bill settlement (bills.markPaid) re-tags the consumed bank transaction with
    // categoryAccountId = AP and the vendor's contactId. We use these ids two
    // ways below, both READ-ONLY: (1) to resolve the settlement transaction a
    // paid bill links to (so the detail "View bank transaction" deep-link points
    // at a real txn id), and (2) to drop those settlement transactions from a
    // contact's money-in/out totals so a settled bill is counted exactly once
    // (the bill carries the amount; the bank leg must not be double-counted).
    const apAccountId = accounts.find((account) => account.number === "2100")?._id ?? null;
    const arAccountId = accounts.find((account) => account.number === "1100")?._id ?? null;
    const isSettlementCategory = (categoryAccountId?: Id<"ledgerAccounts">) =>
      categoryAccountId != null && (categoryAccountId === apAccountId || categoryAccountId === arAccountId);
    const documentsById = new Map(documents.map((document) => [document._id, document]));
    const transactionsById = new Map(transactions.map((transaction) => [transaction._id, transaction]));
    const journalEntriesById = new Map(journalEntries.map((entry) => [entry._id as string, entry]));
    // Lines grouped by entry, so a bill's AP-post entry can surface the expense
    // category it debited (the read-only "ledger impact" for the bill detail).
    const linesByEntry = new Map<string, Doc<"journalLines">[]>();
    for (const line of journalLines) {
      const rows = linesByEntry.get(line.entryId as string) ?? [];
      rows.push(line);
      linesByEntry.set(line.entryId as string, rows);
    }
    /** The expense-account name a bill's first AP-post entry debited, if any. */
    function billCategoryName(entryIds: Doc<"bills">["entryIds"]): string | null {
      for (const entryId of entryIds) {
        const lines = linesByEntry.get(entryId as string) ?? [];
        for (const line of lines) {
          if (line.debitMinor > 0) {
            const account = accountsById.get(line.accountId);
            if (account && account.type === "expense") return account.name;
          }
        }
      }
      return null;
    }
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
        const openInvoices = contactInvoices.filter(
          (invoice) => invoice.status === "open" || invoice.status === "overdue",
        );
        const openReceivableMinor = openInvoices.reduce(
          (sum, invoice) => sum + invoice.totalMinor - invoice.amountPaidMinor,
          0,
        );
        const openPayableMinor = contactBills
          .filter((bill) => bill.status === "open")
          .reduce((sum, bill) => sum + bill.totalMinor, 0);
        // AR is "past due" when an open invoice is overdue or its due date has
        // passed. This is the ONLY thing that earns the red overdue marker on a
        // contact row — AP due dates are not netted into this.
        const overdueReceivableMinor = openInvoices
          .filter((invoice) => invoice.status === "overdue" || dateDiffDays(today, invoice.dueDate) > 0)
          .reduce((sum, invoice) => sum + invoice.totalMinor - invoice.amountPaidMinor, 0);
        const totalThisYearMinor =
          contactInvoices
            .filter((invoice) => invoice.issueDate.startsWith(currentYear))
            .reduce((sum, invoice) => sum + invoice.amountPaidMinor, 0) +
          contactBills
            .filter((bill) => bill.issueDate.startsWith(currentYear))
            .reduce((sum, bill) => sum + bill.totalMinor, 0) +
          contactTransactions
            // Exclude bill/invoice settlement transactions: they are the bank leg
            // of an invoice/bill already counted above, so adding them again would
            // double-count the same dollar of vendor spend / customer revenue.
            .filter((transaction) => transaction.date.startsWith(currentYear) && !isSettlementCategory(transaction.categoryAccountId))
            .reduce((sum, transaction) => sum + Math.abs(transaction.amountMinor), 0);
        const lastActivity = [
          ...contactInvoices.map((invoice) => invoice.updatedAt),
          ...contactBills.map((bill) => bill.updatedAt),
          ...contactTransactions.map((transaction) => transaction.updatedAt),
          contact.updatedAt,
        ].sort((a, b) => b - a)[0];
        const defaultCategory = contact.defaultCategoryId ? accountsById.get(contact.defaultCategoryId) : null;
        // Money in vs money out for the year, kept SEPARATE so the directory
        // never collapses receivables and payables into one misleading cell.
        const moneyInYtdMinor =
          contactInvoices
            .filter((invoice) => invoice.issueDate.startsWith(currentYear))
            .reduce((sum, invoice) => sum + invoice.amountPaidMinor, 0) +
          contactTransactions
            // Skip AR/AP settlement legs: a deposit that settled an invoice (or any
            // settlement re-tagged to AR/AP) is already represented by the invoice's
            // amountPaidMinor, so counting the bank txn too would overstate revenue.
            .filter(
              (transaction) =>
                transaction.date.startsWith(currentYear) &&
                transaction.amountMinor > 0 &&
                !isSettlementCategory(transaction.categoryAccountId),
            )
            .reduce((sum, transaction) => sum + transaction.amountMinor, 0);
        const moneyOutYtdMinor =
          contactBills
            .filter((bill) => bill.issueDate.startsWith(currentYear))
            .reduce((sum, bill) => sum + bill.totalMinor, 0) +
          contactTransactions
            // Skip the bank leg of a paid bill (re-tagged to AP at markPaid). The
            // bill's totalMinor above is the single source of truth for that spend.
            .filter(
              (transaction) =>
                transaction.date.startsWith(currentYear) &&
                transaction.amountMinor < 0 &&
                !isSettlementCategory(transaction.categoryAccountId),
            )
            .reduce((sum, transaction) => sum + Math.abs(transaction.amountMinor), 0);
        return {
          id: contact._id,
          name: contact.name,
          roles: contact.roles,
          email: contact.email ?? null,
          aliases: contact.aliases,
          notes: contact.notes ?? null,
          archived: contact.archived === true,
          openReceivableMinor,
          openPayableMinor,
          overdueReceivableMinor,
          moneyInYtdMinor,
          moneyOutYtdMinor,
          totalThisYearMinor,
          lastActivity,
          lastActivityDate: lastActivity ? new Date(lastActivity).toISOString().slice(0, 10) : null,
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
      // Archived contacts stay in the payload (carrying the `archived` flag) so
      // the client's "Archived" filter can re-include them; the default
      // directory hides them client-side. Archive is a SOFT flag, never a hard
      // delete — every contactId reference on ledger history is preserved.
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
          addAging(invoiceAging, invoice.dueDate, balanceMinor, today);
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

    // Resolve the bank transaction that SETTLED each paid bill, read-only.
    // bills.markPaid re-tags the consumed outgoing transaction with review
    // "confirmed", categoryAccountId = AP, and the vendor's contactId. We match
    // on (contactId + AP category + amount) and claim each candidate at most once
    // so two same-vendor, same-amount paid bills resolve to distinct txns. This
    // gives the detail sheet a real txn id to deep-link to (/transactions?focus=);
    // a bill id was never a valid focus target there.
    const settlementTxnByBillId = new Map<string, Id<"transactions">>();
    if (apAccountId) {
      const claimed = new Set<string>();
      const settlementCandidates = transactions.filter(
        (transaction) =>
          transaction.review === "confirmed" &&
          transaction.amountMinor < 0 &&
          transaction.categoryAccountId === apAccountId &&
          transaction.contactId != null,
      );
      for (const bill of bills) {
        if (bill.status !== "paid") continue;
        const match = settlementCandidates
          .filter(
            (transaction) =>
              !claimed.has(transaction._id) &&
              transaction.contactId === bill.contactId &&
              Math.abs(transaction.amountMinor) === bill.totalMinor,
          )
          // Prefer the txn dated closest to the bill's due date for a stable pick.
          .sort(
            (a, b) =>
              Math.abs(dateDiffDays(a.date, bill.dueDate)) - Math.abs(dateDiffDays(b.date, bill.dueDate)),
          )[0];
        if (match) {
          claimed.add(match._id);
          settlementTxnByBillId.set(bill._id, match._id);
        }
      }
    }

    const billRows = bills
      .map((bill) => {
        const document = bill.documentId ? documentsById.get(bill.documentId) : null;
        const daysUntilDue = dateDiffDays(bill.dueDate, today);
        const isOpen = bill.status === "open";
        const isOverdue = isOpen && daysUntilDue < 0;
        const isDueSoon = isOpen && daysUntilDue >= 0 && daysUntilDue <= 7;
        // Source is derived, not stored: a bill linked to a PDF/receipt document
        // was extracted; otherwise it was entered by hand. No recurring flag
        // exists on the schema yet, so "recurring" is intentionally not faked.
        const source = document ? "pdf" : "manual";
        // The bank-side payment lives in Transactions; a paid bill carries a
        // settlement entry (entryIds length grows past the AP-post entry). We
        // only reference that match state here — we never own or duplicate it.
        const paymentMatch = bill.status === "paid"
          ? "matched"
          : bill.entryIds.length > 1
            ? "scheduled"
            : "expected";
        const attention = isOverdue
          ? ("overdue" as const)
          : isOpen && !document
            ? ("missing-evidence" as const)
            : null;
        return {
          id: bill._id,
          vendorName: contactsById.get(bill.contactId)?.name ?? "Vendor",
          contactId: bill.contactId,
          status: bill.status,
          issueDate: bill.issueDate,
          dueDate: bill.dueDate,
          createdAt: bill.createdAt,
          totalMinor: bill.totalMinor,
          currency: bill.currency,
          daysUntilDue,
          isOverdue,
          isDueSoon,
          source,
          paymentMatch,
          // The bank transaction that settled this bill, if we could resolve it
          // (paid bills only). Lets the detail sheet deep-link to a REAL txn id
          // in the register; null means "no resolvable settlement txn" and the
          // client hides the deep-link rather than pointing at a dead anchor.
          matchedTransactionId: settlementTxnByBillId.get(bill._id) ?? null,
          attention,
          hasEvidence: Boolean(document),
          // Per-field AI confidence comes off the linked extraction document.
          extractionConfidence: document?.extractionConfidence ?? null,
          extractionNotes: document?.extractionNotes ?? null,
          extractionSource: document?.extractionSource ?? null,
          category: billCategoryName(bill.entryIds),
          ledgerEntryIds: bill.entryIds,
          // Read-only ledger impact (AP journal lines) — "AI proposes, ledger
          // posts": the detail shows these but never writes them.
          ledgerLines: bill.entryIds.flatMap((entryId) =>
            (linesByEntry.get(entryId as string) ?? []).map((line) => ({
              account: accountsById.get(line.accountId)?.name ?? "Account",
              accountNumber: accountsById.get(line.accountId)?.number ?? "",
              debitMinor: line.debitMinor,
              creditMinor: line.creditMinor,
              currency: line.currency,
            })),
          ),
          document: document
            ? {
                id: document._id,
                vendor: document.vendor,
                status: document.status,
                totalMinor: document.totalMinor,
                fileName: document.fileName ?? null,
                date: document.date,
              }
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

    // Per-run snapshot, computed from the run's OWN persisted lines (not the
    // current active roster). This makes headcount + the by-currency breakdown
    // reflect who was on the run when it was drafted, even if the roster changed
    // afterwards. Falls back to the roster-derived totals for legacy seeded runs
    // that predate the line table (materialized = lines exist for the run).
    const linesByRun = new Map<string, Doc<"payrollRunLines">[]>();
    for (const line of payrollRunLines) {
      const rows = linesByRun.get(line.runId as string) ?? [];
      rows.push(line);
      linesByRun.set(line.runId as string, rows);
    }
    function runSnapshot(runId: Id<"payrollRuns">) {
      const lines = linesByRun.get(runId as string) ?? [];
      if (lines.length === 0) {
        return { headcount: employees.filter((e) => e.active).length, currencyTotals, materialized: false };
      }
      const map = new Map<string, { currency: string; localMinor: number; baseMinor: number }>();
      for (const line of lines) {
        const row = map.get(line.currency) ?? { currency: line.currency, localMinor: 0, baseMinor: 0 };
        row.localMinor += line.finalLocalMinor;
        row.baseMinor += line.baseEquivalentMinor;
        map.set(line.currency, row);
      }
      return {
        headcount: lines.length,
        currencyTotals: [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
        materialized: true,
      };
    }

    const statementRows = employeeRows.map((employee) => ({
      employeeName: employee.name,
      country: employee.country,
      currency: employee.currency,
      localMinor: employee.finalAmountMinor,
      baseMinor: employee.baseAmountMinor,
      fxDisplay: employee.fxDisplay,
    }));

    const STATEMENT_CSV_HEADER = "employee,country,currency,local_minor,base_currency,base_minor,fx_display";
    const statementRowToCsvLine = (row: (typeof statementRows)[number]) =>
      [
        row.employeeName,
        row.country,
        row.currency,
        String(row.localMinor),
        entity.currency,
        String(row.baseMinor),
        row.fxDisplay,
      ].join(",");

    const statementCsv = [STATEMENT_CSV_HEADER, ...statementRows.map(statementRowToCsvLine)].join("\n");

    // E10-T5: per-currency statement blocks. Each LLC's payroll statement is a
    // separate per-entity, USD-booked document (decisions.md Q55); here we split
    // that document by currency so each block + its CSV export shows local AND
    // base (USD) totals. Sorted base-currency-first, then alphabetically, so the
    // owner sees the home currency on top.
    const statementsByCurrency = [...new Set(statementRows.map((row) => row.currency))]
      .sort((a, b) => (a === entity.currency ? -1 : b === entity.currency ? 1 : a.localeCompare(b)))
      .map((currency) => {
        const rows = statementRows.filter((row) => row.currency === currency);
        const localMinor = rows.reduce((sum, row) => sum + row.localMinor, 0);
        const baseMinor = rows.reduce((sum, row) => sum + row.baseMinor, 0);
        const csv = [STATEMENT_CSV_HEADER, ...rows.map(statementRowToCsvLine)].join("\n");
        return {
          currency,
          isBaseCurrency: currency === entity.currency,
          rows,
          localMinor,
          baseMinor,
          fxDisplay: rows[0]?.fxDisplay ?? "",
          csv,
          csvFilename: `openbooks-payroll-statement-${currency.toLowerCase()}.csv`,
        };
      });

    // E10-T6: the single Payroll page insight. Run-rate = the latest APPROVED (or
    // paid) run's base total — derived from posted run totals, NOT roster face
    // values — so the number reflects what actually hit the ledger. Headcount =
    // active employees. FX-exposure = the share of base-currency payroll cost
    // carried by non-base-currency staff (the dollars exposed to a moving rate).
    const approvedRunsNewestFirst = payrollRuns
      .filter((run) => run.status === "approved" || run.status === "paid")
      .sort((a, b) => b.period.localeCompare(a.period));
    const latestApprovedRun = approvedRunsNewestFirst[0] ?? null;
    const activeHeadcount = employees.filter((e) => e.active).length;
    // Run-rate prefers the latest approved/paid run's posted base total; when no
    // run has been approved yet it falls back to the roster's monthly base cost so
    // a brand-new entity still shows a meaningful figure.
    const rosterBaseMinor = currencyTotals.reduce((sum, row) => sum + row.baseMinor, 0);
    const runRateBaseMinor = latestApprovedRun ? latestApprovedRun.totalBaseMinor : rosterBaseMinor;
    // FX exposure: base-currency dollars carried by non-base employees / total.
    const nonBaseBaseMinor = currencyTotals
      .filter((row) => row.currency !== entity.currency)
      .reduce((sum, row) => sum + row.baseMinor, 0);
    const fxExposureSharePct = rosterBaseMinor > 0 ? Math.round((nonBaseBaseMinor / rosterBaseMinor) * 100) : 0;
    const payrollInsight = {
      runRateBaseMinor,
      runRateBasedOnApprovedRun: latestApprovedRun !== null,
      latestApprovedPeriod: latestApprovedRun?.period ?? null,
      headcount: activeHeadcount,
      baseCurrency: entity.currency,
      hasFxExposure: nonBaseBaseMinor > 0,
      fxExposureSharePct,
      fxExposureBaseMinor: nonBaseBaseMinor,
      nonBaseCurrencies: currencyTotals
        .filter((row) => row.currency !== entity.currency && row.baseMinor > 0)
        .map((row) => row.currency),
    };

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
        // Directory KPIs derived from the SAME invoice/bill set the Income and
        // Bills lenses use, so the numbers reconcile. Archived contacts are
        // excluded. A/R and A/P stay separate — never netted into one figure.
        kpis: {
          openReceivableMinor: contactRows
            .filter((row) => !row.archived)
            .reduce((sum, row) => sum + row.openReceivableMinor, 0),
          openPayableMinor: contactRows
            .filter((row) => !row.archived)
            .reduce((sum, row) => sum + row.openPayableMinor, 0),
          contactsCount: contactRows.filter((row) => !row.archived).length,
          overdueReceivableCount: contactRows.filter(
            (row) => !row.archived && row.overdueReceivableMinor > 0,
          ).length,
        },
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
        kpis: (() => {
          const openBills = billRows.filter((bill) => bill.status === "open");
          const paidBills = bills.filter((bill) => bill.status === "paid");
          // Avg days to pay: issue date -> settlement date (updatedAt) across
          // paid bills. A read-only estimate; no ledger write.
          const daysToPaySamples = paidBills
            .map((bill) => dateDiffDays(new Date(bill.updatedAt).toISOString().slice(0, 10), bill.issueDate))
            .filter((days) => days >= 0);
          const avgDaysToPay = daysToPaySamples.length
            ? Math.round(daysToPaySamples.reduce((sum, days) => sum + days, 0) / daysToPaySamples.length)
            : 0;
          // "Paid this period" = bills settled in the last 30 days (by updatedAt).
          const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
          const paidThisPeriodMinor = paidBills
            .filter((bill) => bill.updatedAt >= thirtyDaysAgo)
            .reduce((sum, bill) => sum + bill.totalMinor, 0);
          const missingEvidence = openBills.filter((bill) => !bill.hasEvidence);
          return {
            openMinor: openBills.reduce((sum, bill) => sum + bill.totalMinor, 0),
            // Kept for back-compat with the prior 3-tile strip; same value the
            // due-soon tile uses (open bills due within 7 days).
            dueThisWeekMinor: billGroups
              .find((group) => group.key === "this_week")!
              .rows.reduce((sum, bill) => sum + bill.totalMinor, 0),
            dueSoonMinor: openBills
              .filter((bill) => bill.isDueSoon)
              .reduce((sum, bill) => sum + bill.totalMinor, 0),
            overdueMinor: billGroups
              .find((group) => group.key === "overdue")!
              .rows.reduce((sum, bill) => sum + bill.totalMinor, 0),
            paidThisPeriodMinor,
            missingEvidenceMinor: missingEvidence.reduce((sum, bill) => sum + bill.totalMinor, 0),
            missingEvidenceCount: missingEvidence.length,
            avgDaysToPay,
          };
        })(),
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
          .map((run) => {
            const snapshot = runSnapshot(run._id);
            const runLines = linesByRun.get(run._id as string) ?? [];
            return {
              id: run._id,
              period: run.period,
              status: run.status,
              // Absent source reads as a manual run (legacy + seeded runs).
              source: run.source ?? "manual",
              totalBaseMinor: run.totalBaseMinor,
              headcount: snapshot.headcount,
              currencyTotals: snapshot.currencyTotals,
              // Approved-but-unsettled lines awaiting a bank match. 0 for drafts.
              unmatchedCount:
                run.status === "approved" ? runLines.filter((line) => !line.paid).length : 0,
              actionState: run.status === "draft" ? "ready_to_approve" : run.status === "approved" ? "ready_to_mark_paid" : "paid",
            };
          }),
        currencyTotals,
        // Sum of approved-but-unsettled lines across all runs (the "Unmatched" KPI).
        unmatchedCount: payrollRuns
          .filter((run) => run.status === "approved")
          .reduce(
            (sum, run) => sum + (linesByRun.get(run._id as string) ?? []).filter((line) => !line.paid).length,
            0,
          ),
        statementRows,
        statementCsv,
        statementsByCurrency,
        insight: payrollInsight,
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
    const { entity } = await resolveActiveEntity(ctx, args.entityId);
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
    const { entity: active } = await resolveActiveEntity(ctx);
    return {
      liveSandboxEntityId: liveSandbox?._id ?? null,
      liveSandboxReady: Boolean(liveSandbox),
      activeEntityId: active?._id ?? null,
    };
  },
});
