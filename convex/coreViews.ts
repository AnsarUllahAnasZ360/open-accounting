import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";

type Balance = {
  debitMinor: number;
  creditMinor: number;
};

const months = [
  "2025-07",
  "2025-08",
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
];

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
  if (!entity || entity.workspaceId !== membership.workspaceId) return null;
  await requireWorkspaceRole(ctx, entity.workspaceId, "member");
  return entity;
}

function addBalance(map: Map<Id<"ledgerAccounts">, Balance>, line: Doc<"journalLines">) {
  const current = map.get(line.accountId) ?? { debitMinor: 0, creditMinor: 0 };
  current.debitMinor += line.debitMinor;
  current.creditMinor += line.creditMinor;
  map.set(line.accountId, current);
}

function normalBalance(account: Doc<"ledgerAccounts">, balance: Balance) {
  if (account.type === "asset" || account.type === "expense") {
    return balance.debitMinor - balance.creditMinor;
  }
  return balance.creditMinor - balance.debitMinor;
}

function signedTransactionAmount(transaction: Doc<"transactions">) {
  return transaction.amountMinor;
}

function monthLabel(month: string) {
  return month.slice(5);
}

const DASHBOARD_LIMIT = 5000;

export const dashboard = query({
  args: {
    entityId: v.optional(v.id("entities")),
    // Period selector. "YYYY-MM" scopes the P&L snapshot, expense breakdown,
    // income-by-customer, and payroll widgets so the selector drives EVERY
    // period-sensitive widget instead of being decorative.
    period: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await getActiveEntity(ctx, args.entityId);
    if (!entity) return null;

    const [accounts, bankAccounts, entries, lines, transactions, inboxItems, invoices, bills, payrollRuns, contacts] =
      await Promise.all([
        ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(DASHBOARD_LIMIT),
        ctx.db.query("bankAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(200),
        ctx.db.query("journalEntries").withIndex("by_entity_and_date", (q) => q.eq("entityId", entity._id)).take(DASHBOARD_LIMIT),
        ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(DASHBOARD_LIMIT),
        ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(DASHBOARD_LIMIT),
        ctx.db.query("inboxItems").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
        ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
        ctx.db.query("bills").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
        ctx.db.query("payrollRuns").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(200),
        ctx.db.query("contacts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
      ]);

    const accountsById = new Map(accounts.map((account) => [account._id, account]));
    const entriesById = new Map(entries.map((entry) => [entry._id, entry]));
    const contactsById = new Map(contacts.map((contact) => [contact._id, contact]));
    const balances = new Map<Id<"ledgerAccounts">, Balance>();
    const monthlyBalances = new Map<Id<"ledgerAccounts">, Balance>();
    const latestMonth =
      entries.map((entry) => entry.date.slice(0, 7)).sort((a, b) => b.localeCompare(a))[0] ?? "2026-06";
    // The selected period drives every period-scoped widget; default to the
    // latest month with activity. Never trust it to point past the data.
    const selectedMonth = args.period && /^\d{4}-\d{2}$/.test(args.period) ? args.period : latestMonth;

    for (const line of lines) {
      addBalance(balances, line);
      const entry = entriesById.get(line.entryId);
      if (entry?.date.startsWith(selectedMonth)) {
        addBalance(monthlyBalances, line);
      }
    }

    let incomeMinor = 0;
    let expenseMinor = 0;
    const expensesByCategory: Array<{ name: string; amountMinor: number; categoryAccountId: Id<"ledgerAccounts"> }> = [];
    for (const [accountId, balance] of monthlyBalances.entries()) {
      const account = accountsById.get(accountId);
      if (!account) continue;
      const amountMinor = normalBalance(account, balance);
      if (account.type === "income") incomeMinor += amountMinor;
      if (account.type === "expense") {
        expenseMinor += amountMinor;
        if (amountMinor > 0) expensesByCategory.push({ name: account.name, amountMinor, categoryAccountId: accountId });
      }
    }

    const bankBalances = bankAccounts
      .map((bankAccount) => {
        const account = accountsById.get(bankAccount.ledgerAccountId);
        const balance = balances.get(bankAccount.ledgerAccountId) ?? { debitMinor: 0, creditMinor: 0 };
        const amountMinor = account ? normalBalance(account, balance) : 0;
        return {
          id: bankAccount._id,
          name: bankAccount.name,
          kind: bankAccount.kind,
          mask: bankAccount.mask,
          ledgerAccountId: bankAccount.ledgerAccountId,
          amountMinor,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const openInboxItems = inboxItems.filter((item) => item.status === "open");
    const inboxByKind = openInboxItems.reduce<Record<string, number>>((acc, item) => {
      acc[item.kind] = (acc[item.kind] ?? 0) + 1;
      return acc;
    }, {});

    const openInvoices = invoices.filter((invoice) => invoice.status === "open" || invoice.status === "overdue");
    const openBills = bills.filter((bill) => bill.status === "open");
    const reviewedTransactions = transactions.filter((transaction) => transaction.review !== "needs_review").length;
    const cashFlowByMonth = months.map((month) => {
      const monthTransactions = transactions.filter((transaction) => transaction.date.startsWith(month));
      const inflowMinor = monthTransactions
        .filter((transaction) => transaction.amountMinor > 0)
        .reduce((sum, transaction) => sum + transaction.amountMinor, 0);
      const outflowMinor = monthTransactions
        .filter((transaction) => transaction.amountMinor < 0)
        .reduce((sum, transaction) => sum + Math.abs(transaction.amountMinor), 0);
      return {
        month,
        label: monthLabel(month),
        inflowMinor,
        outflowMinor,
        netMinor: inflowMinor - outflowMinor,
      };
    });
    // Income by customer scoped to the selected month (invoices issued that
    // month), so the widget tracks the period selector.
    const incomeByCustomer = new Map<Id<"contacts">, number>();
    for (const invoice of invoices) {
      if (!invoice.issueDate.startsWith(selectedMonth)) continue;
      incomeByCustomer.set(invoice.contactId, (incomeByCustomer.get(invoice.contactId) ?? 0) + invoice.totalMinor);
    }
    // If nothing was issued in the period, fall back to all-time paid so the
    // widget is never empty on a quiet month.
    if (incomeByCustomer.size === 0) {
      for (const invoice of invoices) {
        incomeByCustomer.set(invoice.contactId, (incomeByCustomer.get(invoice.contactId) ?? 0) + invoice.amountPaidMinor);
      }
    }

    const selectedPayrollRun =
      payrollRuns.find((run) => run.period === selectedMonth) ??
      payrollRuns.sort((a, b) => b.period.localeCompare(a.period))[0] ??
      null;

    // Last calendar day of the selected month, clamped so a current-month
    // selection carries a month-to-date end rather than a future date.
    const [sy, sm] = selectedMonth.split("-").map(Number);
    const lastDay = new Date(Date.UTC(sy, sm, 0)).getUTCDate();
    const periodStart = `${selectedMonth}-01`;
    const periodEnd = `${selectedMonth}-${String(lastDay).padStart(2, "0")}`;

    return {
      entity: {
        id: entity._id,
        name: entity.name,
        currency: entity.currency,
      },
      latestMonth,
      selectedMonth,
      periodStart,
      periodEnd,
      cashPositionMinor: bankBalances
        .filter((account) => account.kind !== "credit")
        .reduce((sum, account) => sum + account.amountMinor, 0),
      creditCardBalanceMinor: bankBalances
        .filter((account) => account.kind === "credit")
        .reduce((sum, account) => sum + account.amountMinor, 0),
      bankBalances,
      profitAndLoss: {
        incomeMinor,
        expenseMinor,
        netIncomeMinor: incomeMinor - expenseMinor,
      },
      inbox: {
        openCount: openInboxItems.length,
        byKind: Object.entries(inboxByKind)
          .map(([kind, count]) => ({ kind, count }))
          .sort((a, b) => b.count - a.count),
        automationRate: transactions.length ? Math.round((reviewedTransactions / transactions.length) * 100) : 0,
      },
      receivables: {
        openMinor: openInvoices.reduce((sum, invoice) => sum + (invoice.totalMinor - invoice.amountPaidMinor), 0),
        overdueCount: invoices.filter((invoice) => invoice.status === "overdue").length,
      },
      payables: {
        openMinor: openBills.reduce((sum, bill) => sum + bill.totalMinor, 0),
        dueSoonCount: openBills.filter((bill) => bill.dueDate <= "2026-06-30").length,
      },
      expensesByCategory: expensesByCategory.sort((a, b) => b.amountMinor - a.amountMinor).slice(0, 5),
      incomeByCustomer: [...incomeByCustomer.entries()]
        .map(([contactId, amountMinor]) => ({
          contactId,
          name: contactsById.get(contactId)?.name ?? "Customer",
          amountMinor,
        }))
        .sort((a, b) => b.amountMinor - a.amountMinor)
        .slice(0, 5),
      cashFlowByMonth,
      cashSparkline: cashFlowByMonth.reduce<number[]>((points, row) => {
        const previous = points.at(-1) ?? 0;
        return [...points, previous + row.netMinor];
      }, []),
      payroll: selectedPayrollRun,
      recentActivity: entries
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
        .slice(0, 8)
        .map((entry) => ({
          id: entry._id,
          date: entry.date,
          memo: entry.memo,
          source: entry.source,
        })),
      readStats: {
        ledgerAccounts: accounts.length,
        bankAccounts: bankAccounts.length,
        journalEntries: entries.length,
        journalLines: lines.length,
        transactions: transactions.length,
        inboxItems: inboxItems.length,
        invoices: invoices.length,
        bills: bills.length,
        payrollRuns: payrollRuns.length,
        contacts: contacts.length,
        totalRows:
          accounts.length +
          bankAccounts.length +
          entries.length +
          lines.length +
          transactions.length +
          inboxItems.length +
          invoices.length +
          bills.length +
          payrollRuns.length +
          contacts.length,
        limit: DASHBOARD_LIMIT,
        truncated:
          accounts.length >= DASHBOARD_LIMIT ||
          entries.length >= DASHBOARD_LIMIT ||
          lines.length >= DASHBOARD_LIMIT ||
          transactions.length >= DASHBOARD_LIMIT,
      },
    };
  },
});

export const inbox = query({
  args: { entityId: v.optional(v.id("entities")) },
  handler: async (ctx, args) => {
    const entity = await getActiveEntity(ctx, args.entityId);
    if (!entity) return null;

    const [items, transactions, accounts, bankAccounts, documents] = await Promise.all([
      ctx.db.query("inboxItems").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
      ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(DASHBOARD_LIMIT),
      ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(500),
      ctx.db.query("bankAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(200),
      ctx.db.query("documents").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(1000),
    ]);
    const transactionsById = new Map(transactions.map((transaction) => [transaction._id, transaction]));
    const accountsById = new Map(accounts.map((account) => [account._id, account]));
    const bankAccountsById = new Map(bankAccounts.map((account) => [account._id, account]));
    const documentsById = new Map(documents.map((document) => [document._id, document]));
    const openItems = items
      .filter((item) => item.status === "open")
      .sort((a, b) => b.createdAt - a.createdAt);

    return {
      entity: { id: entity._id, currency: entity.currency },
      items: openItems.map((item) => {
        const transaction = item.transactionId ? transactionsById.get(item.transactionId) : null;
        const document = item.documentId ? documentsById.get(item.documentId) : null;
        const category = transaction?.categoryAccountId ? accountsById.get(transaction.categoryAccountId) : null;
        const bankAccount = transaction?.bankAccountId ? bankAccountsById.get(transaction.bankAccountId) : null;
        return {
          id: item._id,
          kind: item.kind,
          summary: item.payloadSummary,
          transactionId: transaction?._id ?? null,
          documentId: document?._id ?? null,
          merchant: document?.vendor ?? transaction?.merchant ?? item.kind,
          date: document?.date ?? transaction?.date ?? null,
          amountMinor: document ? -document.totalMinor : transaction ? signedTransactionAmount(transaction) : 0,
          confidence: document?.extractionConfidence ?? transaction?.confidence ?? null,
          reasoning: transaction?.reasoning ?? null,
          categoryName: category?.name ?? "Needs category",
          categoryAccountId: category?._id ?? null,
          bankAccountName: bankAccount?.name ?? "OpenBooks",
          receiptDocument: document
            ? {
                id: document._id,
                kind: document.kind,
                vendor: document.vendor,
                date: document.date,
                totalMinor: document.totalMinor,
                currency: document.currency,
                fileName: document.fileName ?? null,
                status: document.status,
                extractionSource: document.extractionSource ?? null,
                extractionConfidence: document.extractionConfidence ?? null,
                extractionNotes: document.extractionNotes ?? null,
                matchedTransactionId: document.matchedTransactionId ?? null,
                candidate: transaction
                  ? {
                      id: transaction._id,
                      merchant: transaction.merchant,
                      date: transaction.date,
                      amountMinor: transaction.amountMinor,
                      bankAccountName: bankAccount?.name ?? "OpenBooks",
                      categoryName: category?.name ?? "Needs category",
                    }
                  : null,
              }
            : null,
        };
      }),
      categoryOptions: accounts
        .filter((account) => !account.archived && (account.type === "expense" || account.type === "income" || account.type === "asset" || account.type === "liability"))
        .sort((a, b) => a.number.localeCompare(b.number))
        .map((account) => ({
          id: account._id,
          number: account.number,
          name: account.name,
          type: account.type,
        })),
    };
  },
});

export const transactions = query({
  args: {
    entityId: v.optional(v.id("entities")),
    review: v.optional(v.union(v.literal("all"), v.literal("auto"), v.literal("confirmed"), v.literal("needs_review"), v.literal("excluded"))),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await getActiveEntity(ctx, args.entityId);
    if (!entity) return null;

    const [transactions, accounts, bankAccounts, inboxItems, allLines, documents, entries, auditEvents] = await Promise.all([
      ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(DASHBOARD_LIMIT),
      ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(500),
      ctx.db.query("bankAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(200),
      ctx.db.query("inboxItems").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
      ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(DASHBOARD_LIMIT),
      ctx.db.query("documents").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(1000),
      ctx.db.query("journalEntries").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).order("desc").take(1000),
      ctx.db.query("auditEvents").withIndex("by_workspace", (q) => q.eq("workspaceId", entity.workspaceId)).order("desc").take(1000),
    ]);
    const accountsById = new Map(accounts.map((account) => [account._id, account]));
    const bankAccountsById = new Map(bankAccounts.map((account) => [account._id, account]));
    const documentsByTransactionId = new Map(
      documents
        .filter((document) => document.matchedTransactionId)
        .map((document) => [document.matchedTransactionId!, document]),
    );
    const auditEventsByEntityId = new Map<string, Doc<"auditEvents">[]>();
    for (const event of auditEvents) {
      if (!event.entityId) continue;
      const events = auditEventsByEntityId.get(event.entityId) ?? [];
      events.push(event);
      auditEventsByEntityId.set(event.entityId, events);
    }
    const balances = new Map<Id<"ledgerAccounts">, Balance>();
    for (const line of allLines) {
      addBalance(balances, line);
    }
    const inboxByTransactionId = new Map(
      inboxItems
        .filter((item) => item.transactionId && item.status === "open")
        .map((item) => [item.transactionId!, item]),
    );
    const normalizedSearch = args.search?.trim().toLowerCase() ?? "";
    const rows = transactions
      .filter((transaction) => (args.review && args.review !== "all" ? transaction.review === args.review : true))
      .filter((transaction) =>
        normalizedSearch
          ? `${transaction.merchant} ${transaction.rawDescription}`.toLowerCase().includes(normalizedSearch)
          : true,
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
      .slice(0, 120);

    const entryLines = new Map<Id<"journalEntries">, Doc<"journalLines">[]>();
    for (const row of rows) {
      if (!row.entryId) continue;
      const lines = await ctx.db
        .query("journalLines")
        .withIndex("by_entry", (q) => q.eq("entryId", row.entryId!))
        .take(100);
      entryLines.set(row.entryId, lines);
    }

    return {
      entity: { id: entity._id, currency: entity.currency },
      rows: rows.map((transaction) => {
        const category = transaction.categoryAccountId ? accountsById.get(transaction.categoryAccountId) : null;
        const bankAccount = transaction.bankAccountId ? bankAccountsById.get(transaction.bankAccountId) : null;
        const entryIds = new Set<Id<"journalEntries">>();
        if (transaction.entryId) entryIds.add(transaction.entryId);
        for (const entry of entries) {
          if (
            entry.sourceId === transaction.externalId ||
            entry.sourceId === transaction._id ||
            (transaction.entryId && entry.reversesEntryId === transaction.entryId)
          ) {
            entryIds.add(entry._id);
          }
        }
        const activity = [...entryIds]
          .flatMap((entryId) => auditEventsByEntityId.get(entryId) ?? [])
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((event) => ({
            id: event._id,
            action: event.action,
            summary: event.summary,
            createdAt: event.createdAt,
          }));
        const receipt = documentsByTransactionId.get(transaction._id) ?? null;
        return {
          id: transaction._id,
          date: transaction.date,
          merchant: transaction.merchant,
          rawDescription: transaction.rawDescription,
          amountMinor: signedTransactionAmount(transaction),
          source: transaction.source,
          review: transaction.review,
          decidedBy: transaction.decidedBy ?? null,
          confidence: transaction.confidence ?? null,
          categoryAccountId: category?._id ?? null,
          categoryName: category?.name ?? "Uncategorized",
          bankAccountId: bankAccount?._id ?? null,
          bankAccountName: bankAccount?.name ?? "Manual",
          hasInboxItem: inboxByTransactionId.has(transaction._id),
          entryId: transaction.entryId ?? null,
          receipt: receipt
            ? {
                id: receipt._id,
                vendor: receipt.vendor,
                date: receipt.date,
                totalMinor: receipt.totalMinor,
                status: receipt.status,
              }
            : null,
          activity,
          lines: transaction.entryId
            ? (entryLines.get(transaction.entryId) ?? []).map((line) => {
                const account = accountsById.get(line.accountId);
                return {
                  id: line._id,
                  accountNumber: account?.number ?? "----",
                  accountName: account?.name ?? "Unknown account",
                  debitMinor: line.debitMinor,
                  creditMinor: line.creditMinor,
                  currency: line.currency,
                };
              })
            : [],
        };
      }),
      bankAccounts: bankAccounts.map((account) => {
        const ledgerAccount = accountsById.get(account.ledgerAccountId);
        const ledgerBalanceMinor = ledgerAccount
          ? normalBalance(ledgerAccount, balances.get(account.ledgerAccountId) ?? { debitMinor: 0, creditMinor: 0 })
          : 0;
        return {
          id: account._id,
          name: account.name,
          ledgerAccountId: account.ledgerAccountId,
          ledgerBalanceMinor,
          bankBalanceMinor: account.balanceMinor,
          differenceMinor: ledgerBalanceMinor - account.balanceMinor,
        };
      }),
      categoryOptions: accounts
        .filter((account) => !account.archived && (account.type === "expense" || account.type === "income" || account.type === "asset" || account.type === "liability"))
        .sort((a, b) => a.number.localeCompare(b.number))
        .map((account) => ({
          id: account._id,
          number: account.number,
          name: account.name,
          type: account.type,
        })),
    };
  },
});
