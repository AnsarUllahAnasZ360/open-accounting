import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";

/**
 * Internal, entity-scoped read queries backing the Ask AI agent's read tools.
 *
 * Authorization model: the Ask AI streaming action is a *scheduled* action with
 * no user session, so it cannot call the public (auth-gated) read queries. The
 * thread's ownership row (`chatThreads`) is the authorization boundary — it was
 * verified for the signed-in user when the message was sent. These queries take
 * an explicit `entityId` resolved from that row (via `internal.aiThreads.threadContext`)
 * and read only that entity's data. They are `internalQuery`, never exposed to
 * the client, and never accept workspace/entity from model/client args directly.
 */

const REPORT_NAME = v.union(
  v.literal("monthly-review"),
  v.literal("profit-and-loss"),
  v.literal("balance-sheet"),
  v.literal("cash-flow"),
  v.literal("ar-aging"),
  v.literal("ap-aging"),
  v.literal("expenses"),
  v.literal("income-by-customer"),
  v.literal("payroll-summary"),
  v.literal("general-ledger"),
  v.literal("trial-balance"),
  v.literal("journal"),
);
const REPORT_BASIS = v.union(v.literal("accrual"), v.literal("cash"));

const DEFAULT_START_DATE = "2026-01-01";
const DEFAULT_END_DATE = "2026-12-31";
const MAX_TOOL_ROWS = 50;

/**
 * Minimal structural shape of the report pack we consume here. Declared
 * locally so the cross-module `ctx.runQuery` annotation doesn't pull the full
 * (recursive) generated type and trip TypeScript's circularity guard.
 */
type ReportPackForTool = {
  entity: { id: Id<"entities"> | string; name: string; currency: string };
  controls: Record<string, unknown>;
  monthlyReview: unknown;
  profitAndLoss: unknown;
  balanceSheet: unknown;
  cashFlow: unknown;
  arAging: unknown;
  apAging: unknown;
  expenses: unknown;
  incomeByCustomer: unknown;
  payrollSummary: unknown;
  generalLedger: { rows: unknown[] };
  trialBalance: unknown;
  journal: { entries: unknown[] };
};

function limitRows(value: number | undefined) {
  return Math.min(MAX_TOOL_ROWS, Math.max(1, Math.floor(value ?? 10)));
}

async function getEntityById(ctx: QueryCtx, entityId: Id<"entities">) {
  const entity = await ctx.db.get(entityId);
  if (!entity) {
    throw new Error("OpenBooks entity for this thread no longer exists.");
  }
  return entity;
}

function entitySummary(entity: Doc<"entities">) {
  return {
    id: entity._id,
    name: entity.name,
    currency: entity.currency,
    isDemo: entity.isDemo,
  };
}

export const queryTransactionsForEntity = internalQuery({
  args: {
    entityId: v.id("entities"),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const entity = await getEntityById(ctx, args.entityId);
    const limit = limitRows(args.limit);
    const search = args.search?.trim().toLowerCase();
    const [transactions, accounts, contacts, bankAccounts] = await Promise.all([
      ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(500),
      ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(300),
      ctx.db.query("contacts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(300),
      ctx.db.query("bankAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(100),
    ]);
    const accountsById = new Map(accounts.map((account) => [account._id, account]));
    const contactsById = new Map(contacts.map((contact) => [contact._id, contact]));
    const bankAccountsById = new Map(bankAccounts.map((bankAccount) => [bankAccount._id, bankAccount]));

    const filtered = transactions.filter((transaction) => {
      if (!search) return true;
      return `${transaction.merchant} ${transaction.rawDescription}`.toLowerCase().includes(search);
    });

    return {
      tool: "queryTransactions" as const,
      entity: entitySummary(entity),
      rows: filtered
        .sort((left, right) => right.date.localeCompare(left.date) || right.createdAt - left.createdAt)
        .slice(0, limit)
        .map((transaction) => {
          const account = transaction.categoryAccountId ? accountsById.get(transaction.categoryAccountId) : null;
          const contact = transaction.contactId ? contactsById.get(transaction.contactId) : null;
          const bankAccount = transaction.bankAccountId ? bankAccountsById.get(transaction.bankAccountId) : null;
          return {
            id: transaction._id,
            date: transaction.date,
            merchant: transaction.merchant,
            rawDescription: transaction.rawDescription,
            amountMinor: transaction.amountMinor,
            currency: transaction.currency,
            status: transaction.status,
            review: transaction.review,
            source: transaction.source,
            decidedBy: transaction.decidedBy ?? null,
            confidence: transaction.confidence ?? null,
            category: account
              ? { id: account._id, number: account.number, name: account.name, type: account.type }
              : null,
            contact: contact ? { id: contact._id, name: contact.name } : null,
            bankAccount: bankAccount ? { id: bankAccount._id, name: bankAccount.name, kind: bankAccount.kind } : null,
          };
        }),
      truncated: filtered.length > limit,
    };
  },
});

export const getReportForEntity = internalQuery({
  args: {
    entityId: v.id("entities"),
    report: REPORT_NAME,
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    basis: v.optional(REPORT_BASIS),
  },
  handler: async (ctx, args) => {
    // Annotate the cross-module result to break TypeScript's circular inference
    // through the `internal` API graph (per Convex guidelines).
    const pack: ReportPackForTool = await ctx.runQuery(internal.reportViews.reportPackForEntity, {
      entityId: args.entityId,
      startDate: args.startDate ?? DEFAULT_START_DATE,
      endDate: args.endDate ?? DEFAULT_END_DATE,
      basis: args.basis ?? "accrual",
      compare: "none",
      columnMode: "monthly",
    });
    const reports: Record<string, unknown> = {
      "monthly-review": pack.monthlyReview,
      "profit-and-loss": pack.profitAndLoss,
      "balance-sheet": pack.balanceSheet,
      "cash-flow": pack.cashFlow,
      "ar-aging": pack.arAging,
      "ap-aging": pack.apAging,
      expenses: pack.expenses,
      "income-by-customer": pack.incomeByCustomer,
      "payroll-summary": pack.payrollSummary,
      "general-ledger": {
        rows: pack.generalLedger.rows.slice(0, MAX_TOOL_ROWS),
        truncated: pack.generalLedger.rows.length > MAX_TOOL_ROWS,
      },
      "trial-balance": pack.trialBalance,
      journal: {
        entries: pack.journal.entries.slice(0, MAX_TOOL_ROWS),
        truncated: pack.journal.entries.length > MAX_TOOL_ROWS,
      },
    };

    return {
      tool: "getReport" as const,
      report: args.report,
      entity: pack.entity,
      controls: pack.controls,
      data: reports[args.report],
    };
  },
});

export const getBalancesForEntity = internalQuery({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entity = await getEntityById(ctx, args.entityId);
    const [bankAccounts, accounts] = await Promise.all([
      ctx.db.query("bankAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(100),
      ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(300),
    ]);
    const accountsById = new Map(accounts.map((account) => [account._id, account]));
    const rows = bankAccounts.map((bankAccount) => {
      const account = accountsById.get(bankAccount.ledgerAccountId);
      return {
        id: bankAccount._id,
        name: bankAccount.name,
        kind: bankAccount.kind,
        balanceMinor: bankAccount.balanceMinor,
        includeInSync: bankAccount.includeInSync,
        ledgerAccount: account
          ? { id: account._id, number: account.number, name: account.name, type: account.type }
          : null,
      };
    });

    return {
      tool: "getBalances" as const,
      entity: entitySummary(entity),
      totalMinor: rows.reduce((sum, row) => sum + row.balanceMinor, 0),
      rows,
    };
  },
});

export const searchContactsForEntity = internalQuery({
  args: {
    entityId: v.id("entities"),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const entity = await getEntityById(ctx, args.entityId);
    const limit = limitRows(args.limit);
    const queryText = args.query?.trim().toLowerCase();
    const [contacts, invoices, bills, transactions] = await Promise.all([
      ctx.db.query("contacts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(300),
      ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(300),
      ctx.db.query("bills").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(300),
      ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(1000),
    ]);

    return {
      tool: "searchContacts" as const,
      entity: entitySummary(entity),
      rows: contacts
        .filter((contact) => {
          if (!queryText) return true;
          return `${contact.name} ${contact.email ?? ""} ${contact.aliases.join(" ")}`
            .toLowerCase()
            .includes(queryText);
        })
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, limit)
        .map((contact) => {
          const openInvoices = invoices.filter(
            (invoice) => invoice.contactId === contact._id && ["open", "overdue"].includes(invoice.status),
          );
          const openBills = bills.filter((bill) => bill.contactId === contact._id && bill.status === "open");
          const lastTransaction = transactions
            .filter((transaction) => transaction.contactId === contact._id)
            .sort((left, right) => right.date.localeCompare(left.date))[0];
          return {
            id: contact._id,
            name: contact.name,
            roles: contact.roles,
            email: contact.email ?? null,
            aliases: contact.aliases,
            openInvoiceMinor: openInvoices.reduce(
              (sum, invoice) => sum + Math.max(0, invoice.totalMinor - invoice.amountPaidMinor),
              0,
            ),
            openBillMinor: openBills.reduce((sum, bill) => sum + bill.totalMinor, 0),
            lastTransaction: lastTransaction
              ? {
                  id: lastTransaction._id,
                  date: lastTransaction.date,
                  merchant: lastTransaction.merchant,
                  amountMinor: lastTransaction.amountMinor,
                  currency: lastTransaction.currency,
                }
              : null,
          };
        }),
    };
  },
});

export const getPayrollRunsForEntity = internalQuery({
  args: {
    entityId: v.id("entities"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const entity = await getEntityById(ctx, args.entityId);
    const limit = limitRows(args.limit);
    const [runs, employees] = await Promise.all([
      ctx.db.query("payrollRuns").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(120),
      ctx.db.query("employees").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(100),
    ]);

    return {
      tool: "getPayrollRuns" as const,
      entity: entitySummary(entity),
      activeEmployeeCount: employees.filter((employee) => employee.active).length,
      employees: employees
        .filter((employee) => employee.active)
        .slice(0, MAX_TOOL_ROWS)
        .map((employee) => ({
          id: employee._id,
          name: employee.name,
          country: employee.country,
          currency: employee.currency,
          monthlySalaryMinor: employee.monthlySalaryMinor,
        })),
      rows: runs
        .sort((left, right) => right.period.localeCompare(left.period))
        .slice(0, limit)
        .map((run) => ({
          id: run._id,
          period: run.period,
          status: run.status,
          totalBaseMinor: run.totalBaseMinor,
          entryIds: run.entryIds,
          updatedAt: run.updatedAt,
        })),
      truncated: runs.length > limit,
    };
  },
});
