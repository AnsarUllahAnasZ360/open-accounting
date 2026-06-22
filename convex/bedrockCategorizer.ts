import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, mutation, type ActionCtx } from "./_generated/server";
import { CATEGORIZATION_BATCH_PASS_SIZE } from "./ai";
import { requireWorkspaceRole } from "./authz";
import { ensureSystemSyncActor } from "./systemActors";

const routeSourceValidator = v.union(v.literal("bank"), v.literal("stripe"), v.literal("manual"));
const transactionStatusValidator = v.union(v.literal("pending"), v.literal("posted"));

type CandidateAccount = {
  id: Id<"ledgerAccounts">;
  number: string;
  name: string;
  type: string;
  subtype: string;
};

// Business context (E2-T9): entity name/type, approved revenue streams, and a
// recent-vendor/customer hint, used to lift cold-start categorization accuracy.
type BusinessContext = {
  entityName: string;
  entityType: string | null;
  revenueStreams: string[];
  recentVendors: string[];
  recentCustomers: string[];
};

type CategorizationContext = {
  entity: {
    id: Id<"entities">;
    workspaceId: Id<"workspaces">;
    name: string;
    currency: string;
  };
  bankAccount: {
    id: Id<"bankAccounts">;
    name: string;
  };
  provider: {
    mode: "active" | "degraded";
    activeProvider: "bedrock" | null;
    model: string | null;
    region: string | null;
    autonomy: "suggest" | "balanced" | "autopilot";
  };
  candidateAccounts: CandidateAccount[];
  // Optional so a stale/seam context without the block still parses; the prompt
  // simply omits the Business context section when it is absent.
  businessContext?: BusinessContext;
  // Merchant-resolved contact (E2-T9). Optional/undefined-tolerant so a stale
  // seam context still parses; null when no contact matched the merchant.
  resolvedContactId?: Id<"contacts"> | null;
};

type RouteTransactionArgs = {
  entityId: Id<"entities">;
  bankAccountId: Id<"bankAccounts">;
  date: string;
  amountMinor: number;
  currency: string;
  merchant: string;
  rawDescription: string;
  status: "pending" | "posted";
  source: "bank" | "stripe" | "manual";
  externalId: string;
  contactId?: Id<"contacts">;
  categoryAccountId?: Id<"ledgerAccounts">;
  matchAccountId?: Id<"ledgerAccounts">;
  transferAccountId?: Id<"ledgerAccounts">;
  forceReview?: boolean;
  evalExpectedAccountId?: Id<"ledgerAccounts">;
  evalSet?: boolean;
  plaidPriorAccountId?: Id<"ledgerAccounts">;
  // E2-T5: a semantic-recall proposal routed at the "embedding" cascade stage.
  embeddingProposal?: {
    categoryAccountId: Id<"ledgerAccounts">;
    confidence: number;
    reasoning: string;
  };
};

type PipelineProposal = {
  categoryAccountId: Id<"ledgerAccounts">;
  confidence: number;
  reasoning: string;
  needsHuman: boolean;
  question?: string;
};

type NormalizedProposal = {
  account: CandidateAccount;
  aiProposal: PipelineProposal;
};

type RouteResult = {
  status: "posted" | "needs_review" | "duplicate";
  transactionId: Id<"transactions">;
  entryId: Id<"journalEntries"> | null;
  stage: string;
};

type ExistingRouteResult = {
  status: "posted" | "needs_review" | "skipped";
  transactionId: Id<"transactions">;
  entryId: Id<"journalEntries"> | null;
  stage: string;
  reason?: string;
};

type BatchCandidate = RouteTransactionArgs & {
  transactionId: Id<"transactions">;
};

type BatchItemResult = {
  transactionId: Id<"transactions">;
  mode: "bedrock" | "degraded" | "fallback";
  provider: "bedrock" | null;
  model: string | null;
  proposalSource: "llm" | null;
  fallbackReason: string | null;
  route: ExistingRouteResult;
};

type CategorizationBatchResult = {
  batchRunId: Id<"aiBatchRuns"> | null;
  batchStatus: "completed" | "partial" | "degraded" | null;
  attemptedCount: number;
  postedCount: number;
  needsReviewCount: number;
  skippedCount: number;
  degradedCount: number;
  fallbackCount: number;
  results: BatchItemResult[];
};

export type BedrockPayload = {
  contentType: string;
  accept: string;
  body: string;
};

type BedrockEnv = {
  ready: boolean;
  region: string | null;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  modelId: string | null;
};

const categorizationContextRef = makeFunctionReference<
  "query",
  { entityId: Id<"entities">; bankAccountId: Id<"bankAccounts">; amountMinor: number; merchant?: string },
  CategorizationContext & { resolvedContactId: Id<"contacts"> | null }
>("ai:categorizationContext");

const categorizationContextForImportInternalRef = makeFunctionReference<
  "query",
  {
    entityId: Id<"entities">;
    bankAccountId: Id<"bankAccounts">;
    amountMinor: number;
    actorUserId: Id<"users">;
    merchant?: string;
  },
  CategorizationContext & { resolvedContactId: Id<"contacts"> | null }
>("ai:categorizationContextForImportInternal");

function present(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

export function bedrockRuntimeEnv(modelFromConfig: string | null): BedrockEnv {
  const modelId = modelFromConfig ?? process.env.AI_MODEL?.trim() ?? null;
  const region = process.env.AWS_REGION?.trim() ?? null;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim() ?? null;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim() ?? null;
  return {
    ready:
      process.env.AI_PROVIDER?.trim().toLowerCase() === "bedrock" &&
      present(accessKeyId ?? undefined) &&
      present(secretAccessKey ?? undefined) &&
      present(region ?? undefined) &&
      present(modelId ?? undefined),
    region,
    accessKeyId,
    secretAccessKey,
    modelId,
  };
}

export function bedrockPayload(modelId: string, prompt: string): BedrockPayload {
  if (modelId.includes("anthropic.claude")) {
    return {
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 500,
        temperature: 0,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      }),
    };
  }

  if (modelId.includes("amazon.nova")) {
    return {
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        messages: [{ role: "user", content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 500, temperature: 0 },
      }),
    };
  }

  if (modelId.includes("moonshotai.kimi")) {
    return {
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500,
        temperature: 0,
      }),
    };
  }

  if (modelId.includes("amazon.titan-text")) {
    return {
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        inputText: prompt,
        textGenerationConfig: { maxTokenCount: 500, temperature: 0 },
      }),
    };
  }

  throw new Error("Configured AI_MODEL is not supported by the Bedrock categorizer.");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanField(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "boolean" ? record[key] : null;
}

function truncate(value: string, max: number) {
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}...` : cleaned;
}

export function extractBedrockResponseText(modelId: string, payload: unknown) {
  const body = asRecord(payload);
  if (!body) return "";

  const claudeContent = body.content;
  if (Array.isArray(claudeContent)) {
    return claudeContent
      .map((part) => {
        const record = asRecord(part);
        return record ? stringField(record, "text") : null;
      })
      .filter(Boolean)
      .join("\n");
  }

  const output = asRecord(body.output);
  const message = asRecord(output?.message);
  const novaContent = message?.content;
  if (Array.isArray(novaContent)) {
    return novaContent
      .map((part) => {
        const record = asRecord(part);
        return record ? stringField(record, "text") : null;
      })
      .filter(Boolean)
      .join("\n");
  }

  const choices = body.choices;
  if (Array.isArray(choices)) {
    const first = asRecord(choices[0]);
    const choiceMessage = first ? asRecord(first.message) : null;
    const messageContent = choiceMessage ? stringField(choiceMessage, "content") : null;
    if (messageContent) return messageContent;
    const choiceText = first ? stringField(first, "text") : null;
    if (choiceText) return choiceText;
  }

  const results = body.results;
  if (Array.isArray(results)) {
    const first = asRecord(results[0]);
    const titanText = first ? stringField(first, "outputText") : null;
    if (titanText) return titanText;
  }

  const directOutput = stringField(body, "outputText");
  if (directOutput) return directOutput;

  return modelId.includes("amazon") ? JSON.stringify(payload) : "";
}

export async function invokeBedrockPayload(args: {
  env: BedrockEnv;
  payload: BedrockPayload;
}) {
  if (!args.env.ready || !args.env.region || !args.env.accessKeyId || !args.env.secretAccessKey || !args.env.modelId) {
    throw new Error("Bedrock environment is incomplete.");
  }

  try {
    const client = new BedrockRuntimeClient({
      region: args.env.region,
      credentials: {
        accessKeyId: args.env.accessKeyId,
        secretAccessKey: args.env.secretAccessKey,
      },
    });
    const response = await client.send(
      new InvokeModelCommand({
        modelId: args.env.modelId,
        contentType: args.payload.contentType,
        accept: args.payload.accept,
        body: new TextEncoder().encode(args.payload.body),
      }),
    );
    if (!response.body) {
      throw new Error("Bedrock response body was empty.");
    }
    return JSON.parse(new TextDecoder().decode(response.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Bedrock invocation error.";
    throw new Error(`Bedrock categorization invoke failed: ${truncate(message, 160)}`);
  }
}

async function invokeBedrockText(args: {
  env: BedrockEnv;
  prompt: string;
}) {
  if (!args.env.modelId) {
    throw new Error("Bedrock environment is incomplete.");
  }
  const payload = bedrockPayload(args.env.modelId, args.prompt);
  return extractBedrockResponseText(args.env.modelId, await invokeBedrockPayload({ env: args.env, payload }));
}

/**
 * Provider-agnostic categorization entrypoint (E3-T3).
 *
 * Resolves the workspace's active AI provider once, then returns a uniform
 * shape: `ready` plus a `run(prompt)` that yields raw model text. For
 * `provider === "bedrock"` it keeps the existing AWS invoke path (low risk,
 * unchanged contract); for every other catalog provider it delegates to the
 * `"use node"` AI SDK runtime. When nothing is configured, `ready` is false and
 * `degradedReason` names the missing provider so the caller routes to Inbox.
 */
type CategorizeRuntime = {
  ready: boolean;
  provider: string | null;
  model: string | null;
  degradedReason: string | null;
  run: (prompt: string) => Promise<string>;
};

async function resolveCategorizeRuntime(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">,
  bedrockModelHint: string | null,
): Promise<CategorizeRuntime> {
  const env = bedrockRuntimeEnv(bedrockModelHint);
  // Prefer the explicit Bedrock env path when it is fully configured: it is the
  // proven, lowest-risk runtime and preserves the exact existing behavior.
  if (env.ready && env.modelId) {
    return {
      ready: true,
      provider: "bedrock",
      model: env.modelId,
      degradedReason: null,
      run: (prompt: string) => invokeBedrockText({ env, prompt }),
    };
  }

  // Otherwise resolve any saved BYO (or env) provider through the AI SDK runtime.
  // Readiness is a no-network check; the live call only happens inside run().
  const readiness = await ctx.runAction(internal.aiCategorizeRuntime.resolveCategorizeReadiness, {
    workspaceId,
  });
  if (!readiness.ready) {
    return {
      ready: false,
      provider: readiness.provider,
      model: readiness.model,
      degradedReason: readiness.reason,
      run: async () => {
        throw new Error(readiness.reason ?? "AI provider is not configured.");
      },
    };
  }
  return {
    ready: true,
    provider: readiness.provider,
    model: readiness.model,
    degradedReason: null,
    run: async (prompt: string) => {
      const result = await ctx.runAction(internal.aiCategorizeRuntime.generateCategorizationText, {
        workspaceId,
        prompt,
      });
      if (!result.ok) throw new Error(result.reason);
      return result.text;
    },
  };
}

function firstJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidates = [fenced, text].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < candidate.length; index += 1) {
      const char = candidate[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }
      if (char === "\"") {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return candidate.slice(start, index + 1);
        }
      }
    }
  }

  return null;
}

export function parseBedrockCategorizationText(text: string) {
  const jsonText = firstJsonObject(text);
  if (!jsonText) return null;
  try {
    return asRecord(JSON.parse(jsonText));
  } catch {
    return null;
  }
}

function normalizeConfidence(value: number | null) {
  if (value === null) return 0.5;
  const scaled = value > 1 && value <= 100 ? value / 100 : value;
  return Math.min(1, Math.max(0, scaled));
}

function matchAccount(raw: Record<string, unknown>, accounts: CandidateAccount[]) {
  const id = stringField(raw, "categoryId") ?? stringField(raw, "categoryAccountId") ?? stringField(raw, "accountId");
  const accountNumber = stringField(raw, "accountNumber") ?? stringField(raw, "categoryNumber");
  const categoryName = stringField(raw, "categoryName") ?? stringField(raw, "name") ?? stringField(raw, "accountName");
  const normalizedName = categoryName?.toLowerCase();

  return (
    accounts.find((account) => account.id === id) ??
    accounts.find((account) => account.number.toLowerCase() === accountNumber?.toLowerCase()) ??
    accounts.find((account) => account.name.toLowerCase() === normalizedName) ??
    accounts.find((account) => normalizedName && account.name.toLowerCase().includes(normalizedName)) ??
    accounts.find((account) => normalizedName && normalizedName.includes(account.name.toLowerCase())) ??
    null
  );
}

export function normalizeBedrockCategorizationProposal(
  raw: Record<string, unknown> | null,
  accounts: CandidateAccount[],
): NormalizedProposal | null {
  if (!raw) return null;
  const account = matchAccount(raw, accounts);
  if (!account) return null;

  const confidence = normalizeConfidence(numberField(raw, "confidence"));
  const question = stringField(raw, "question");
  const reasoning =
    stringField(raw, "reasoning") ??
    `Bedrock matched ${account.number} ${account.name} from the available OpenBooks ledger categories.`;

  return {
    account,
    aiProposal: {
      categoryAccountId: account.id,
      confidence,
      reasoning: truncate(reasoning, 500),
      needsHuman: booleanField(raw, "needsHuman") ?? confidence < 0.75,
      ...(question ? { question: truncate(question, 240) } : {}),
    },
  };
}

function businessContextLines(direction: "inflow" | "outflow", context?: BusinessContext): string[] {
  if (!context) return [];
  const lines: string[] = ["", "Business context:"];
  lines.push(`- Business: ${context.entityName}${context.entityType ? ` (${context.entityType})` : ""}`);
  if (context.revenueStreams.length > 0) {
    lines.push(`- Approved revenue streams: ${context.revenueStreams.join(", ")}`);
  }
  // Cold-start hint: a recent-vendor/customer sample so the model has signal
  // even before the owner has approved a revenue-stream taxonomy.
  const hint = direction === "inflow" ? context.recentCustomers : context.recentVendors;
  if (hint.length > 0) {
    const label = direction === "inflow" ? "Recent customers" : "Recent vendors";
    lines.push(`- ${label}: ${hint.slice(0, 8).join(", ")}`);
  }
  return lines;
}

export function buildCategorizationPrompt(args: {
  entityName: string;
  amountMinor: number;
  currency: string;
  merchant: string;
  rawDescription: string;
  date: string;
  accounts: CandidateAccount[];
  businessContext?: BusinessContext;
}) {
  const direction = args.amountMinor >= 0 ? "inflow" : "outflow";
  const amount = `${args.currency} ${(Math.abs(args.amountMinor) / 100).toFixed(2)} ${direction}`;
  const accounts = args.accounts
    .map((account) => `- ${account.number} | ${account.name} | ${account.type}/${account.subtype}`)
    .join("\n");

  return [
    "You are the categorization stage for OpenBooks, a double-entry bookkeeping app.",
    "Choose exactly one category from the candidate account list. Do not invent categories.",
    "Use needsHuman=false only when the merchant and raw description clearly point to one category.",
    "If the merchant or raw description is generic, ambiguous, an adjustment, or says unknown/review/needs human, set needsHuman=true, use confidence <=0.65, and explain what is missing.",
    "For clear recurring software, cloud, rent, utilities, payroll, meals, travel, bank fee, tax, or professional-service vendors, set needsHuman=false and use confidence that reflects the evidence.",
    // Direction-aware guidance (E2-T6): not every inflow is revenue and not every
    // outflow is expense. Refunds, transfers, contributions, and loan proceeds
    // are valid answers — prefer the correct non-income/non-expense account over
    // inventing sales or a generic expense.
    "Not every inflow is revenue and not every outflow is expense. The candidate list may include refund/contra, equity-contribution, liability (loan/credit-card) proceeds, and transfer/clearing accounts. Use them when they fit.",
    "If an inflow looks like a refund, a customer reversal, a transfer between the owner's own accounts, an internal payout deposit, or a loan/owner contribution, prefer a transfer/clearing, contra, liability, or equity account over inventing new revenue.",
    "If an outflow looks like a refund issued, a transfer, an owner draw, or a loan/credit-card paydown, prefer the matching transfer/clearing, contra-income, equity, or liability account over a generic expense.",
    "Return only JSON. No markdown. No explanation outside JSON.",
    "",
    `Entity: ${args.entityName}`,
    `Date: ${args.date}`,
    `Amount: ${amount}`,
    `Merchant: ${args.merchant}`,
    `Raw description: ${args.rawDescription}`,
    ...businessContextLines(direction, args.businessContext),
    "",
    "Candidate accounts:",
    accounts,
    "",
    "JSON shape:",
    "{\"accountNumber\":\"5200\",\"categoryName\":\"Software & SaaS\",\"confidence\":0.86,\"needsHuman\":false,\"reasoning\":\"Short reason based on merchant and description\",\"question\":null}",
  ].join("\n");
}

async function routeThroughPipeline(
  ctx: ActionCtx,
  args: RouteTransactionArgs,
  aiProposal: PipelineProposal | null,
): Promise<RouteResult> {
  return await ctx.runMutation(api.pipeline.routeTransaction, {
    entityId: args.entityId,
    bankAccountId: args.bankAccountId,
    date: args.date,
    amountMinor: args.amountMinor,
    currency: args.currency,
    merchant: args.merchant,
    rawDescription: args.rawDescription,
    status: args.status,
    source: args.source,
    externalId: args.externalId,
    ...(args.contactId ? { contactId: args.contactId } : {}),
    ...(args.categoryAccountId ? { categoryAccountId: args.categoryAccountId } : {}),
    ...(args.matchAccountId ? { matchAccountId: args.matchAccountId } : {}),
    ...(args.transferAccountId ? { transferAccountId: args.transferAccountId } : {}),
    ...(args.forceReview ? { forceReview: args.forceReview } : {}),
    ...(args.evalExpectedAccountId ? { evalExpectedAccountId: args.evalExpectedAccountId } : {}),
    ...(args.evalSet ? { evalSet: args.evalSet } : {}),
    ...(args.plaidPriorAccountId ? { plaidPriorAccountId: args.plaidPriorAccountId } : {}),
    ...(args.embeddingProposal ? { embeddingProposal: args.embeddingProposal } : {}),
    ...(aiProposal ? { aiProposal } : {}),
  });
}

async function applyProposalToExistingTransaction(
  ctx: ActionCtx,
  args: {
    transactionId: Id<"transactions">;
    actorUserId?: Id<"users">;
    aiProposal?: PipelineProposal | null;
  },
): Promise<ExistingRouteResult> {
  return await ctx.runMutation(internal.pipeline.applyProposalToExistingTransactionInternal, {
    transactionId: args.transactionId,
    ...(args.actorUserId ? { actorUserId: args.actorUserId } : {}),
    ...(args.aiProposal ? { aiProposal: args.aiProposal } : {}),
  });
}

function skippedExistingRoute(
  candidate: BatchCandidate,
  stage: string,
  reason: string,
): ExistingRouteResult {
  return {
    status: "skipped",
    transactionId: candidate.transactionId,
    entryId: null,
    stage,
    reason,
  };
}

async function categorizeExistingCandidate(
  ctx: ActionCtx,
  candidate: BatchCandidate,
  options: { actorUserId?: Id<"users"> } = {},
): Promise<BatchItemResult> {
  const context = options.actorUserId
    ? await ctx.runQuery(categorizationContextForImportInternalRef, {
        entityId: candidate.entityId,
        bankAccountId: candidate.bankAccountId,
        amountMinor: candidate.amountMinor,
        actorUserId: options.actorUserId,
        merchant: candidate.merchant,
      })
    : await ctx.runQuery(categorizationContextRef, {
        entityId: candidate.entityId,
        bankAccountId: candidate.bankAccountId,
        amountMinor: candidate.amountMinor,
        merchant: candidate.merchant,
      });
  // E2-T5: embedding / k-NN recall BEFORE the LLM. A recalled merchant variant
  // resolves the existing imported row deterministically and skips the model.
  const recall = await ctx.runAction(internal.embeddings.recallCategoryFromMemory, {
    entityId: candidate.entityId,
    workspaceId: context.entity.workspaceId,
    merchant: candidate.merchant,
    rawDescription: candidate.rawDescription,
  });
  if (recall) {
    return {
      transactionId: candidate.transactionId,
      mode: "fallback",
      provider: null,
      model: null,
      proposalSource: null,
      fallbackReason: null,
      route: await ctx.runMutation(internal.pipeline.applyProposalToExistingTransactionInternal, {
        transactionId: candidate.transactionId,
        ...(options.actorUserId ? { actorUserId: options.actorUserId } : {}),
        embeddingProposal: {
          categoryAccountId: recall.categoryAccountId,
          confidence: recall.confidence,
          reasoning: recall.reasoning,
        },
      }),
    };
  }

  const runtime = await resolveCategorizeRuntime(ctx, context.entity.workspaceId, context.provider.model);
  const skip = (
    mode: "degraded" | "fallback",
    reason: string,
    stage = "skipped",
  ): BatchItemResult => ({
    transactionId: candidate.transactionId,
    mode,
    provider: mode === "degraded" ? context.provider.activeProvider : "bedrock",
    model: runtime.model ?? context.provider.model,
    proposalSource: null,
    fallbackReason: reason,
    route: skippedExistingRoute(candidate, stage, reason),
  });

  if (!runtime.ready) {
    return skip(
      "degraded",
      runtime.degradedReason ?? "AI provider is absent or incomplete; existing imported row was left in review.",
    );
  }

  if (context.candidateAccounts.length === 0) {
    return skip("fallback", "No active candidate category accounts were available for the transaction direction.");
  }

  try {
    const prompt = buildCategorizationPrompt({
      entityName: context.entity.name,
      amountMinor: candidate.amountMinor,
      currency: candidate.currency,
      merchant: candidate.merchant,
      rawDescription: candidate.rawDescription,
      date: candidate.date,
      accounts: context.candidateAccounts,
      ...(context.businessContext ? { businessContext: context.businessContext } : {}),
    });
    const text = await runtime.run(prompt);
    const normalized = normalizeBedrockCategorizationProposal(
      parseBedrockCategorizationText(text),
      context.candidateAccounts,
    );
    if (!normalized) {
      return skip("fallback", "The model returned no usable category from the allowed account list.");
    }

    return {
      transactionId: candidate.transactionId,
      mode: "bedrock",
      provider: "bedrock",
      model: runtime.model,
      proposalSource: "llm",
      fallbackReason: null,
      route: await applyProposalToExistingTransaction(ctx, {
        transactionId: candidate.transactionId,
        actorUserId: options.actorUserId,
        aiProposal: normalized.aiProposal,
      }),
    };
  } catch (error) {
    const reason = error instanceof Error ? truncate(error.message, 160) : "Batch categorization failed.";
    return skip("fallback", reason);
  }
}

export const categorizeAndRouteTransaction = action({
  args: {
    entityId: v.id("entities"),
    bankAccountId: v.id("bankAccounts"),
    date: v.string(),
    amountMinor: v.number(),
    currency: v.string(),
    merchant: v.string(),
    rawDescription: v.string(),
    status: transactionStatusValidator,
    source: routeSourceValidator,
    externalId: v.string(),
    contactId: v.optional(v.id("contacts")),
    categoryAccountId: v.optional(v.id("ledgerAccounts")),
    matchAccountId: v.optional(v.id("ledgerAccounts")),
    transferAccountId: v.optional(v.id("ledgerAccounts")),
    forceReview: v.optional(v.boolean()),
    evalExpectedAccountId: v.optional(v.id("ledgerAccounts")),
    evalSet: v.optional(v.boolean()),
    plaidPriorAccountId: v.optional(v.id("ledgerAccounts")),
  },
  handler: async (ctx, args): Promise<{
    mode: "bedrock" | "degraded" | "fallback";
    provider: "bedrock" | null;
    model: string | null;
    proposal: {
      categoryAccountId: Id<"ledgerAccounts">;
      accountNumber: string;
      categoryName: string;
      confidence: number;
      needsHuman: boolean;
    } | null;
    fallbackReason: string | null;
    route: RouteResult;
  }> => {
    const context = await ctx.runQuery(categorizationContextRef, {
      entityId: args.entityId,
      bankAccountId: args.bankAccountId,
      amountMinor: args.amountMinor,
      merchant: args.merchant,
    });

    // Carry contactId (E2-T9): prefer an explicitly-supplied contactId, else the
    // merchant-resolved contact so the categorized transaction records it for the
    // downstream journal-line-write epic.
    const baseRouteArgs: RouteTransactionArgs = {
      ...args,
      ...(args.contactId ?? context.resolvedContactId
        ? { contactId: args.contactId ?? context.resolvedContactId ?? undefined }
        : {}),
    };

    // E2-T5: embedding / k-NN recall BEFORE the LLM. If a near-identical past
    // correction is recalled (merchant variant), route that proposal at the
    // "embedding" stage and skip the model entirely. Recall NO-OPs (returns null)
    // when the embedder is degraded, so the cascade proceeds to the LLM.
    const recall = await ctx.runAction(internal.embeddings.recallCategoryFromMemory, {
      entityId: args.entityId,
      workspaceId: context.entity.workspaceId,
      merchant: args.merchant,
      rawDescription: args.rawDescription,
    });
    if (recall) {
      return {
        mode: "fallback" as const,
        provider: null,
        model: null,
        proposal: null,
        fallbackReason: null,
        route: await routeThroughPipeline(
          ctx,
          {
            ...baseRouteArgs,
            embeddingProposal: {
              categoryAccountId: recall.categoryAccountId,
              confidence: recall.confidence,
              reasoning: recall.reasoning,
            },
          },
          null,
        ),
      };
    }

    const routeArgs = baseRouteArgs;
    const runtime = await resolveCategorizeRuntime(ctx, context.entity.workspaceId, context.provider.model);
    const routeWithoutModel = async (mode: "degraded" | "fallback", reason: string | null) => ({
      mode,
      provider: mode === "degraded" ? context.provider.activeProvider : "bedrock" as const,
      model: runtime.model ?? context.provider.model,
      proposal: null,
      fallbackReason: reason,
      route: await routeThroughPipeline(ctx, routeArgs, null),
    });

    if (!runtime.ready) {
      return await routeWithoutModel(
        "degraded",
        runtime.degradedReason ?? "AI provider is absent or incomplete; routed through deterministic stages.",
      );
    }

    if (context.candidateAccounts.length === 0) {
      return await routeWithoutModel("fallback", "No active candidate category accounts were available for the transaction direction.");
    }

    try {
      const prompt = buildCategorizationPrompt({
        entityName: context.entity.name,
        amountMinor: args.amountMinor,
        currency: args.currency,
        merchant: args.merchant,
        rawDescription: args.rawDescription,
        date: args.date,
        accounts: context.candidateAccounts,
        ...(context.businessContext ? { businessContext: context.businessContext } : {}),
      });
      const text = await runtime.run(prompt);
      const normalized = normalizeBedrockCategorizationProposal(
        parseBedrockCategorizationText(text),
        context.candidateAccounts,
      );
      if (!normalized) {
        return await routeWithoutModel("fallback", "The model returned no usable category from the allowed account list.");
      }

      return {
        mode: "bedrock" as const,
        provider: "bedrock" as const,
        model: runtime.model,
        proposal: {
          categoryAccountId: normalized.account.id,
          accountNumber: normalized.account.number,
          categoryName: normalized.account.name,
          confidence: normalized.aiProposal.confidence,
          needsHuman: normalized.aiProposal.needsHuman,
        },
        fallbackReason: null,
        route: await routeThroughPipeline(ctx, routeArgs, normalized.aiProposal),
      };
    } catch (error) {
      return await routeWithoutModel(
        "fallback",
        error instanceof Error ? truncate(error.message, 160) : "Categorization failed.",
      );
    }
  },
});

export const categorizePendingTransactions = action({
  args: {
    entityId: v.id("entities"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CategorizationBatchResult> => {
    return await runCategorizationBatch(ctx, args);
  },
});

export const categorizePendingTransactionsForImportInternal = internalAction({
  args: {
    entityId: v.id("entities"),
    actorUserId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CategorizationBatchResult> => {
    return await runCategorizationBatch(ctx, args);
  },
});

async function runCategorizationBatch(
  ctx: ActionCtx,
  args: {
    entityId: Id<"entities">;
    actorUserId?: Id<"users">;
    limit?: number;
  },
): Promise<CategorizationBatchResult> {
    const candidates: BatchCandidate[] = await ctx.runQuery(internal.ai.categorizationBatchCandidates, {
      entityId: args.entityId,
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      ...(args.actorUserId ? { actorUserId: args.actorUserId } : {}),
    });
    const results: BatchItemResult[] = [];
    for (const candidate of candidates) {
      results.push(await categorizeExistingCandidate(ctx, candidate, {
        ...(args.actorUserId ? { actorUserId: args.actorUserId } : {}),
      }));
    }
    const counts = {
      attemptedCount: results.length,
      postedCount: results.filter((result) => result.route.status === "posted").length,
      needsReviewCount: results.filter((result) => result.route.status === "needs_review").length,
      skippedCount: results.filter((result) => result.route.status === "skipped").length,
      degradedCount: results.filter((result) => result.mode === "degraded").length,
      fallbackCount: results.filter((result) => result.mode === "fallback").length,
    };
    const run: { batchRunId: Id<"aiBatchRuns">; status: "completed" | "partial" | "degraded" } = await ctx.runMutation(
      internal.ai.recordCategorizationBatchRun,
      {
        entityId: args.entityId,
        ...(args.actorUserId ? { actorUserId: args.actorUserId } : {}),
        ...counts,
      },
    );
    return {
      batchRunId: run.batchRunId,
      batchStatus: run.status,
      ...counts,
      results,
    };
}

// ---------------------------------------------------------------------------
// E2-T3 — self-rescheduling backlog drainer.
//
// The old behavior fired a single min(25) batch with no reschedule, so a backlog
// of thousands never cleared. The drainer runs one bounded pass, then — if
// candidates remain AND it made progress AND it is under the maxPasses ceiling —
// reschedules itself for the next pass after a short delay (which protects the
// BYO API rate limit + Convex action limits). It terminates on: an empty queue,
// the maxPasses ceiling, or a no-progress pass (so it never loops forever on
// rows the LLM/recall keeps abstaining on while the provider is degraded).
// ---------------------------------------------------------------------------

const BACKLOG_MAX_PASSES_DEFAULT = 200; // 200 * 25 = 5,000 items per drain run.
const BACKLOG_PASS_DELAY_MS = 1500;

export const drainCategorizationBacklog = internalAction({
  args: {
    entityId: v.id("entities"),
    actorUserId: v.optional(v.id("users")),
    pass: v.optional(v.number()),
    maxPasses: v.optional(v.number()),
    remainingBefore: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ pass: number; attempted: number; remaining: number; rescheduled: boolean }> => {
    const pass = args.pass ?? 0;
    const maxPasses = Math.max(1, Math.floor(args.maxPasses ?? BACKLOG_MAX_PASSES_DEFAULT));

    const batch = await runCategorizationBatch(ctx, {
      entityId: args.entityId,
      ...(args.actorUserId ? { actorUserId: args.actorUserId } : {}),
      limit: CATEGORIZATION_BATCH_PASS_SIZE,
    });

    const remaining: number = await ctx.runQuery(internal.ai.countCategorizationBacklog, {
      entityId: args.entityId,
      ...(args.actorUserId ? { actorUserId: args.actorUserId } : {}),
    });

    // Progress guard: if this pass attempted items but the remaining count did
    // not drop (every item abstained / provider degraded), stop — rescheduling
    // would just spin without ever draining.
    const madeProgress =
      args.remainingBefore === undefined || remaining < args.remainingBefore;
    const shouldReschedule =
      remaining > 0 && batch.attemptedCount > 0 && madeProgress && pass + 1 < maxPasses;

    if (shouldReschedule) {
      await ctx.scheduler.runAfter(BACKLOG_PASS_DELAY_MS, internal.bedrockCategorizer.drainCategorizationBacklog, {
        entityId: args.entityId,
        ...(args.actorUserId ? { actorUserId: args.actorUserId } : {}),
        pass: pass + 1,
        maxPasses,
        remainingBefore: remaining,
      });
    }

    return { pass, attempted: batch.attemptedCount, remaining, rescheduled: shouldReschedule };
  },
});

/**
 * Public entrypoint (admin) that kicks off the self-draining backlog job from the
 * UI. Enqueues pass 0 and returns a handle so the client can poll progress via
 * `ai.latestCategorizationBatchRuns`.
 */
export const startCategorizationBacklog = mutation({
  args: {
    entityId: v.id("entities"),
    maxPasses: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ status: "started" }> => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new Error("OpenBooks entity not found.");
    }
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    // The drainer reschedules itself in the scheduler context (no interactive
    // identity), so it must authorize its internal reads/postings through the
    // workspace's system SYNC actor — the same trusted automation actor the
    // import path uses. Resolve/ensure it here and thread it through every pass.
    const actorUserId = await ensureSystemSyncActor(ctx, entity.workspaceId);
    await ctx.scheduler.runAfter(0, internal.bedrockCategorizer.drainCategorizationBacklog, {
      entityId: args.entityId,
      actorUserId,
      pass: 0,
      ...(args.maxPasses !== undefined ? { maxPasses: args.maxPasses } : {}),
    });
    return { status: "started" };
  },
});
