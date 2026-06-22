import { jsonSchema } from "ai";
import { createTool, type ToolCtx } from "@convex-dev/agent";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Agent tools for OpenBooks Ask AI (Epics B2 + B3).
 *
 * Read tools (B2) are side-effect-free reads. Propose tools (B3) are also
 * side-effect-free: they validate + persist a `proposals` row and return its
 * id + a human-readable summary. NOTHING here posts to the ledger or mutates
 * business data — confirmation happens later via proposals.confirmProposal.
 *
 * AUTHORIZATION: these tools run inside the scheduled streaming action, which
 * has NO user session. Every handler resolves the entity from the thread's
 * ownership row (`internal.aiThreads.threadContext`) — the app-owned
 * authorization boundary verified when the message was sent — and never trusts
 * a workspace/entity id from the model. The internal scoped queries/mutations
 * read/write only that resolved entity.
 */

const numberLimitSchema = { type: "number", minimum: 1, maximum: 50 } as const;
const reportEnum = [
  "monthly-review",
  "profit-and-loss",
  "balance-sheet",
  "cash-flow",
  "ar-aging",
  "ap-aging",
  "expenses",
  "income-by-customer",
  "payroll-summary",
  "general-ledger",
  "trial-balance",
  "journal",
] as const;

type ReportName = (typeof reportEnum)[number];

async function resolveEntityId(ctx: ToolCtx): Promise<Id<"entities">> {
  if (!ctx.threadId) {
    throw new Error("OpenBooks AI tools require an active thread.");
  }
  const context = await ctx.runQuery(internal.aiThreads.threadContext, {
    threadId: ctx.threadId,
  });
  return context.entityId;
}

// Default report window derived from the SERVER CLOCK (E9-T2 / RC6), not a
// frozen calendar-2026 literal. Convex *queries* can't read the clock, so the
// window is computed here in the action/tool layer (where `Date.now()` is
// available) and passed down to the scoped query. "This year so far" — Jan 1 of
// the current year through today — is the sensible default when the model asks
// for a report without naming a period; the model can always override with
// explicit startDate/endDate.
export function defaultReportWindow(now: number = Date.now()): { startDate: string; endDate: string } {
  const today = new Date(now).toISOString().slice(0, 10);
  const year = today.slice(0, 4);
  return { startDate: `${year}-01-01`, endDate: today };
}

// ---------------------------------------------------------------------------
// Read tools (B2)
// ---------------------------------------------------------------------------

const getReport = createTool({
  description:
    "Read a ledger-backed OpenBooks report: profit and loss, balance sheet, cash flow, AR/AP aging, expenses, income by customer, payroll summary, general ledger, trial balance, journal, or monthly review. Always use this for numbers. For period comparisons, call this separately for each compared period instead of one combined range.",
  inputSchema: jsonSchema<{
    report: ReportName;
    startDate?: string;
    endDate?: string;
    basis?: "accrual" | "cash";
  }>({
    type: "object",
    properties: {
      report: { type: "string", enum: reportEnum as unknown as string[] },
      startDate: { type: "string", description: "ISO date YYYY-MM-DD" },
      endDate: { type: "string", description: "ISO date YYYY-MM-DD" },
      basis: { type: "string", enum: ["accrual", "cash"] },
    },
    required: ["report"],
    additionalProperties: false,
  }),
  execute: async (ctx: ToolCtx, input): Promise<unknown> => {
    const entityId = await resolveEntityId(ctx);
    // Resolve the default window from the server clock HERE (action layer), so
    // "this period" tracks the real calendar instead of a frozen 2026 window
    // (E9-T2 / RC6). The model can still override with explicit dates.
    const fallback = defaultReportWindow();
    return await ctx.runQuery(internal.agentToolQueries.getReportForEntity, {
      entityId,
      report: input.report,
      startDate: input.startDate ?? fallback.startDate,
      endDate: input.endDate ?? fallback.endDate,
      basis: input.basis,
    });
  },
});

const getBalances = createTool({
  description: "Read current bank-account balances and their linked ledger accounts.",
  inputSchema: jsonSchema<Record<string, never>>({
    type: "object",
    properties: {},
    additionalProperties: false,
  }),
  execute: async (ctx: ToolCtx): Promise<unknown> => {
    const entityId = await resolveEntityId(ctx);
    return await ctx.runQuery(internal.agentToolQueries.getBalancesForEntity, { entityId });
  },
});

const queryTransactions = createTool({
  description:
    "Find recent transactions by merchant or description text, with amount, status, source, category, contact, and bank account.",
  inputSchema: jsonSchema<{ search?: string; limit?: number }>({
    type: "object",
    properties: {
      search: { type: "string" },
      limit: numberLimitSchema,
    },
    additionalProperties: false,
  }),
  execute: async (ctx: ToolCtx, input): Promise<unknown> => {
    const entityId = await resolveEntityId(ctx);
    return await ctx.runQuery(internal.agentToolQueries.queryTransactionsForEntity, {
      entityId,
      search: input.search,
      limit: input.limit,
    });
  },
});

const searchContacts = createTool({
  description:
    "Search customers and vendors, including open invoice and bill balances plus their last transaction.",
  inputSchema: jsonSchema<{ query?: string; limit?: number }>({
    type: "object",
    properties: {
      query: { type: "string" },
      limit: numberLimitSchema,
    },
    additionalProperties: false,
  }),
  execute: async (ctx: ToolCtx, input): Promise<unknown> => {
    const entityId = await resolveEntityId(ctx);
    return await ctx.runQuery(internal.agentToolQueries.searchContactsForEntity, {
      entityId,
      query: input.query,
      limit: input.limit,
    });
  },
});

const getPayrollRuns = createTool({
  description: "Read active employees and recent payroll runs.",
  inputSchema: jsonSchema<{ limit?: number }>({
    type: "object",
    properties: { limit: numberLimitSchema },
    additionalProperties: false,
  }),
  execute: async (ctx: ToolCtx, input): Promise<unknown> => {
    const entityId = await resolveEntityId(ctx);
    return await ctx.runQuery(internal.agentToolQueries.getPayrollRunsForEntity, {
      entityId,
      limit: input.limit,
    });
  },
});

// Server-clock as-of date for advisor windows (E9-T7 / E9-T2). Computed HERE in
// the tool (action) layer because Convex queries can't read Date.now().
function advisorAsOf(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

const getRunwayAndBurn = createTool({
  description:
    "Read the business's grounded runway and burn: current cash position, average monthly net burn, and months of runway (cash ÷ burn). Use this for 'how am I doing', 'what's my runway', or any cash-survival question. Numbers come straight from the ledger — never estimate them yourself.",
  inputSchema: jsonSchema<Record<string, never>>({
    type: "object",
    properties: {},
    additionalProperties: false,
  }),
  execute: async (ctx: ToolCtx): Promise<unknown> => {
    const entityId = await resolveEntityId(ctx);
    const signals = await ctx.runQuery(internal.agentToolQueries.getCfoSignalsForEntity, {
      entityId,
      today: advisorAsOf(),
    });
    // Return only the runway-relevant grounded fields for a focused answer.
    return {
      tool: "getRunwayAndBurn" as const,
      entity: signals.entity,
      asOf: signals.asOf,
      cashPositionMinor: signals.cashPositionMinor,
      monthlyBurnMinor: signals.monthlyBurnMinor,
      runwayMonths: signals.runwayMonths,
      forecast: signals.forecast,
    };
  },
});

const getAdvisories = createTool({
  description:
    "Read the AI CFO advisory signals for the business: runway/burn, income trend, expense creep, customer concentration, cash-flow forecast, tax set-aside, and anomalies/duplicates. Use this for 'what should I worry about' or 'what should I do' questions. Every signal carries the exact ledger numbers it was computed from — cite those, never guess.",
  inputSchema: jsonSchema<Record<string, never>>({
    type: "object",
    properties: {},
    additionalProperties: false,
  }),
  execute: async (ctx: ToolCtx): Promise<unknown> => {
    const entityId = await resolveEntityId(ctx);
    return await ctx.runQuery(internal.agentToolQueries.getCfoSignalsForEntity, {
      entityId,
      today: advisorAsOf(),
    });
  },
});

// ---------------------------------------------------------------------------
// Propose tools (B3) — side-effect-free: validate + persist a proposal only.
// ---------------------------------------------------------------------------

type ProposeResult = {
  proposalId: Id<"proposals">;
  kind: string;
  summary: string;
  status: "proposed";
  note: string;
};

async function record(
  ctx: ToolCtx,
  kind: "categorize" | "rule" | "invoiceDraft" | "bill" | "journalEntry",
  input: Record<string, unknown>,
): Promise<ProposeResult> {
  if (!ctx.threadId) {
    throw new Error("OpenBooks AI tools require an active thread.");
  }
  const result = await ctx.runMutation(internal.proposals.recordProposal, {
    threadId: ctx.threadId,
    messageId: ctx.messageId,
    kind,
    input,
  });
  return {
    proposalId: result.proposalId,
    kind: result.kind,
    summary: result.summary,
    status: "proposed",
    note: "Recorded a proposal. Nothing has changed yet — the owner must confirm it.",
  };
}

const proposeCategorize = createTool({
  description:
    "Propose categorizing matching transactions into an expense category. This does NOT change anything; it records a proposal the owner confirms.",
  inputSchema: jsonSchema<{
    merchantContains: string;
    categoryAccountNumber?: string;
    limit?: number;
  }>({
    type: "object",
    properties: {
      merchantContains: { type: "string", description: "Merchant text to match, e.g. 'Figma'" },
      categoryAccountNumber: { type: "string", description: "Expense account number, e.g. '5200'" },
      limit: { type: "number", minimum: 1, maximum: 10 },
    },
    required: ["merchantContains"],
    additionalProperties: false,
  }),
  execute: async (ctx: ToolCtx, input): Promise<ProposeResult> => record(ctx, "categorize", input),
});

const proposeRule = createTool({
  description:
    "Propose creating a categorization rule (merchant text → expense category). Records a proposal the owner confirms; creates nothing on its own.",
  inputSchema: jsonSchema<{
    merchantContains: string;
    categoryAccountNumber?: string;
    autoPost?: boolean;
  }>({
    type: "object",
    properties: {
      merchantContains: { type: "string" },
      categoryAccountNumber: { type: "string" },
      autoPost: { type: "boolean" },
    },
    required: ["merchantContains"],
    additionalProperties: false,
  }),
  execute: async (ctx: ToolCtx, input): Promise<ProposeResult> => record(ctx, "rule", input),
});

const proposeInvoiceDraft = createTool({
  description:
    "Propose drafting an invoice for a customer. Records a proposal the owner confirms; saving the draft posts no ledger entry.",
  inputSchema: jsonSchema<{
    customerName: string;
    amountMinor: number;
    issueDate: string;
    dueDate: string;
    memo?: string;
  }>({
    type: "object",
    properties: {
      customerName: { type: "string" },
      amountMinor: { type: "number", description: "Integer minor units (cents)" },
      issueDate: { type: "string", description: "ISO date YYYY-MM-DD" },
      dueDate: { type: "string", description: "ISO date YYYY-MM-DD" },
      memo: { type: "string" },
    },
    required: ["customerName", "amountMinor", "issueDate", "dueDate"],
    additionalProperties: false,
  }),
  execute: async (ctx: ToolCtx, input): Promise<ProposeResult> => record(ctx, "invoiceDraft", input),
});

const proposeBill = createTool({
  description:
    "Propose adding a bill (money owed to a vendor). Records a proposal the owner confirms; on confirm it posts to accounts payable.",
  inputSchema: jsonSchema<{
    vendorName: string;
    amountMinor: number;
    issueDate: string;
    dueDate: string;
    expenseAccountNumber?: string;
  }>({
    type: "object",
    properties: {
      vendorName: { type: "string" },
      amountMinor: { type: "number", description: "Integer minor units (cents)" },
      issueDate: { type: "string", description: "ISO date YYYY-MM-DD" },
      dueDate: { type: "string", description: "ISO date YYYY-MM-DD" },
      expenseAccountNumber: { type: "string", description: "Expense account number, e.g. '5200'" },
    },
    required: ["vendorName", "amountMinor", "issueDate", "dueDate"],
    additionalProperties: false,
  }),
  execute: async (ctx: ToolCtx, input): Promise<ProposeResult> => record(ctx, "bill", input),
});

const proposeJournalEntry = createTool({
  description:
    "Propose a manual double-entry journal entry. Records a proposal the owner confirms; on confirm it posts through the ledger (debits must equal credits).",
  inputSchema: jsonSchema<{
    date: string;
    memo: string;
    amountMinor: number;
    debitAccountNumber?: string;
    creditAccountNumber?: string;
  }>({
    type: "object",
    properties: {
      date: { type: "string", description: "ISO date YYYY-MM-DD" },
      memo: { type: "string" },
      amountMinor: { type: "number", description: "Integer minor units (cents)" },
      debitAccountNumber: { type: "string" },
      creditAccountNumber: { type: "string" },
    },
    required: ["date", "memo", "amountMinor"],
    additionalProperties: false,
  }),
  execute: async (ctx: ToolCtx, input): Promise<ProposeResult> => record(ctx, "journalEntry", input),
});

export const openBooksReadTools = {
  getReport,
  getBalances,
  queryTransactions,
  searchContacts,
  getPayrollRuns,
  getRunwayAndBurn,
  getAdvisories,
  proposeCategorize,
  proposeRule,
  proposeInvoiceDraft,
  proposeBill,
  proposeJournalEntry,
};
