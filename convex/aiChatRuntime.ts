"use node";

import { generateText, jsonSchema, stepCountIs, tool } from "ai";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { buildModelForProvider } from "./aiProvider";
import { resolveActiveAiModel } from "./aiResolve";

type ProviderStatus = {
  mode: "active" | "degraded";
  activeProvider: string | null;
  model: string | null;
  region: string | null;
  degradedReason: string | null;
};
type AIChatRuntimeResult = {
  ok: boolean;
  mode: "active" | "degraded";
  runtime: "ai_sdk_tools" | "degraded" | "validation";
  text: string;
  toolsUsed: string[];
  model?: string;
  finishReason?: string;
};
const providerStatusRef = makeFunctionReference<
  "query",
  { workspaceId: Id<"workspaces"> },
  ProviderStatus
>("ai:providerStatus");
const queryTransactionsRef = makeFunctionReference<
  "query",
  { entityId?: Id<"entities">; search?: string; limit?: number },
  unknown
>("aiChatTools:queryTransactions");
const getReportRef = makeFunctionReference<
  "query",
  {
    entityId?: Id<"entities">;
    report:
      | "monthly-review"
      | "profit-and-loss"
      | "balance-sheet"
      | "cash-flow"
      | "ar-aging"
      | "ap-aging"
      | "expenses"
      | "income-by-customer"
      | "payroll-summary"
      | "general-ledger"
      | "trial-balance"
      | "journal";
    startDate?: string;
    endDate?: string;
    basis?: "accrual" | "cash";
  },
  unknown
>("aiChatTools:getReport");
const getBalancesRef = makeFunctionReference<
  "query",
  { entityId?: Id<"entities"> },
  unknown
>("aiChatTools:getBalances");
const searchContactsRef = makeFunctionReference<
  "query",
  { entityId?: Id<"entities">; query?: string; limit?: number },
  unknown
>("aiChatTools:searchContacts");
const getPayrollRunsRef = makeFunctionReference<
  "query",
  { entityId?: Id<"entities">; limit?: number },
  unknown
>("aiChatTools:getPayrollRuns");
const getRunwayAndBurnRef = makeFunctionReference<
  "query",
  { entityId?: Id<"entities">; today?: string },
  unknown
>("aiChatTools:getRunwayAndBurn");
const getAdvisoriesRef = makeFunctionReference<
  "query",
  { entityId?: Id<"entities">; today?: string },
  unknown
>("aiChatTools:getAdvisories");

// Server-clock as-of date for advisor tool windows (E9-T7 / E9-T2). Convex
// queries can't read Date.now(), so resolve it here and pass it down.
function advisorAsOf(): string {
  return new Date(Date.now()).toISOString().slice(0, 10);
}

const SYSTEM_PROMPT = [
  "You are OpenBooks AI, a plain-English bookkeeping copilot for a small business owner.",
  "The ledger is the source of truth. Use the available read tools before answering questions about transactions, reports, balances, contacts, or payroll.",
  "For 'how am I doing' or 'what's my runway' questions, call getRunwayAndBurn. For 'what should I worry about' or 'what should I do', call getAdvisories. Cite only the numbers those tools return; never guess or recompute them.",
  "Never say that you posted, changed, deleted, paid, invoiced, or journaled anything. For write-like requests, explain that OpenBooks will show a confirmation card before any change.",
  "Use concise accounting language. Format integer minor-unit money values as dollars, e.g. 12345 means $123.45.",
  "Do not expose internal IDs unless the owner explicitly asks for technical trace details.",
].join("\n");

function envValue(name: string) {
  return process.env[name]?.trim() || null;
}

function redactEnvValues(message: string, extraSecret?: string | null) {
  const secretNames = [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_BEARER_TOKEN_BEDROCK",
  ];
  const withEnv = secretNames.reduce((current, name) => {
    const value = envValue(name);
    return value && value.length >= 4 ? current.split(value).join("[redacted]") : current;
  }, message);
  // Also redact the resolved BYO credential secret (E3-T3).
  return extraSecret && extraSecret.length >= 4
    ? withEnv.split(extraSecret).join("[redacted]")
    : withEnv;
}

function safeErrorMessage(error: unknown, extraSecret?: string | null) {
  const raw = error instanceof Error ? error.message : "OpenBooks AI chat failed.";
  return redactEnvValues(raw, extraSecret).replace(/\s+/g, " ").slice(0, 300);
}

function withEntity(entityId: Id<"entities"> | undefined) {
  return entityId ? { entityId } : {};
}

const numberLimitSchema = {
  type: "number",
  minimum: 1,
  maximum: 50,
} as const;

export const answer = action({
  args: {
    workspaceId: v.id("workspaces"),
    entityId: v.optional(v.id("entities")),
    question: v.string(),
  },
  handler: async (ctx, args): Promise<AIChatRuntimeResult> => {
    const question = args.question.trim().slice(0, 1_200);
    const status: ProviderStatus = await ctx.runQuery(providerStatusRef, {
      workspaceId: args.workspaceId,
    });

    if (!question) {
      return {
        ok: false,
        mode: status.mode,
        runtime: "validation" as const,
        text: "Ask a question about your books first.",
        toolsUsed: [],
      };
    }

    // Resolve the workspace's active provider (BYO or env) for chat. No path is
    // hardwired to AWS Bedrock anymore (E3-T3).
    const resolved = await resolveActiveAiModel(ctx, {
      workspaceId: args.workspaceId,
      purpose: "chat",
    });
    if (status.mode !== "active" || !resolved.ready) {
      return {
        ok: false,
        mode: "degraded" as const,
        runtime: "degraded" as const,
        text:
          status.degradedReason ??
          "AI provider is not configured. OpenBooks can still answer from deterministic report context in degraded mode.",
        toolsUsed: [],
      };
    }

    const toolsUsed = new Set<string>();
    const model = buildModelForProvider({
      providerId: resolved.provider,
      modelId: resolved.modelId,
      credential: resolved.credential,
    });

    try {
      const result: { text: string; finishReason: string } = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: question,
        maxOutputTokens: 700,
        temperature: 0,
        maxRetries: 0,
        timeout: 25_000,
        stopWhen: stepCountIs(4),
        tools: {
          queryTransactions: tool({
            description: "Find recent transactions by merchant, description, date, amount, status, source, category, contact, and bank account.",
            inputSchema: jsonSchema<{ search?: string; limit?: number }>({
              type: "object",
              properties: {
                search: { type: "string" },
                limit: numberLimitSchema,
              },
              additionalProperties: false,
            }),
            execute: async ({ search, limit }): Promise<unknown> => {
              toolsUsed.add("queryTransactions");
              return await ctx.runQuery(queryTransactionsRef, {
                ...withEntity(args.entityId),
                search,
                limit,
              });
            },
          }),
          getReport: tool({
            description: "Read a ledger-backed OpenBooks report for profit and loss, balance sheet, cash flow, aging, expenses, income, payroll, general ledger, trial balance, journal, or monthly review.",
            inputSchema: jsonSchema<{
              report:
                | "monthly-review"
                | "profit-and-loss"
                | "balance-sheet"
                | "cash-flow"
                | "ar-aging"
                | "ap-aging"
                | "expenses"
                | "income-by-customer"
                | "payroll-summary"
                | "general-ledger"
                | "trial-balance"
                | "journal";
              startDate?: string;
              endDate?: string;
              basis?: "accrual" | "cash";
            }>({
              type: "object",
              properties: {
                report: {
                  type: "string",
                  enum: [
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
                  ],
                },
                startDate: { type: "string" },
                endDate: { type: "string" },
                basis: { type: "string", enum: ["accrual", "cash"] },
              },
              required: ["report"],
              additionalProperties: false,
            }),
            execute: async ({ report, startDate, endDate, basis }): Promise<unknown> => {
              toolsUsed.add("getReport");
              return await ctx.runQuery(getReportRef, {
                ...withEntity(args.entityId),
                report,
                startDate,
                endDate,
                basis,
              });
            },
          }),
          getBalances: tool({
            description: "Read current bank-account balances and linked ledger accounts.",
            inputSchema: jsonSchema<Record<string, never>>({
              type: "object",
              properties: {},
              additionalProperties: false,
            }),
            execute: async (): Promise<unknown> => {
              toolsUsed.add("getBalances");
              return await ctx.runQuery(getBalancesRef, withEntity(args.entityId));
            },
          }),
          searchContacts: tool({
            description: "Search customers and vendors, including open invoice and bill balances plus last transaction context.",
            inputSchema: jsonSchema<{ query?: string; limit?: number }>({
              type: "object",
              properties: {
                query: { type: "string" },
                limit: numberLimitSchema,
              },
              additionalProperties: false,
            }),
            execute: async ({ query, limit }): Promise<unknown> => {
              toolsUsed.add("searchContacts");
              return await ctx.runQuery(searchContactsRef, {
                ...withEntity(args.entityId),
                query,
                limit,
              });
            },
          }),
          getPayrollRuns: tool({
            description: "Read active employees and recent payroll runs.",
            inputSchema: jsonSchema<{ limit?: number }>({
              type: "object",
              properties: {
                limit: numberLimitSchema,
              },
              additionalProperties: false,
            }),
            execute: async ({ limit }): Promise<unknown> => {
              toolsUsed.add("getPayrollRuns");
              return await ctx.runQuery(getPayrollRunsRef, {
                ...withEntity(args.entityId),
                limit,
              });
            },
          }),
          getRunwayAndBurn: tool({
            description:
              "Read grounded runway and burn: current cash, average monthly net burn, and months of runway. Use for 'how am I doing' / 'what's my runway'. Numbers come from the ledger — never estimate them yourself.",
            inputSchema: jsonSchema<Record<string, never>>({
              type: "object",
              properties: {},
              additionalProperties: false,
            }),
            execute: async (): Promise<unknown> => {
              toolsUsed.add("getRunwayAndBurn");
              return await ctx.runQuery(getRunwayAndBurnRef, {
                ...withEntity(args.entityId),
                today: advisorAsOf(),
              });
            },
          }),
          getAdvisories: tool({
            description:
              "Read the AI CFO advisory signals: runway/burn, income trend, expense creep, customer concentration, cash-flow forecast, tax set-aside, and anomalies/duplicates. Use for 'what should I worry about' / 'what should I do'. Each signal carries the exact ledger numbers it was computed from — cite those, never guess.",
            inputSchema: jsonSchema<Record<string, never>>({
              type: "object",
              properties: {},
              additionalProperties: false,
            }),
            execute: async (): Promise<unknown> => {
              toolsUsed.add("getAdvisories");
              return await ctx.runQuery(getAdvisoriesRef, {
                ...withEntity(args.entityId),
                today: advisorAsOf(),
              });
            },
          }),
        },
      });

      return {
        ok: true,
        mode: status.mode,
        runtime: "ai_sdk_tools" as const,
        model: resolved.modelId,
        finishReason: result.finishReason,
        text: result.text.trim() || "I could not produce an answer from the available bookkeeping context.",
        toolsUsed: Array.from(toolsUsed).sort(),
      };
    } catch (error) {
      return {
        ok: false,
        mode: status.mode,
        runtime: "ai_sdk_tools" as const,
        model: resolved.modelId,
        text: `OpenBooks AI could not complete the tool-backed answer: ${safeErrorMessage(error, resolved.credential.apiKey ?? resolved.credential.secretAccessKey)}`,
        toolsUsed: Array.from(toolsUsed).sort(),
      };
    }
  },
});
