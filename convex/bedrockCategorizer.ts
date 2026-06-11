import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";

const routeSourceValidator = v.union(v.literal("bank"), v.literal("stripe"), v.literal("manual"));
const transactionStatusValidator = v.union(v.literal("pending"), v.literal("posted"));

type CandidateAccount = {
  id: Id<"ledgerAccounts">;
  number: string;
  name: string;
  type: string;
  subtype: string;
};

type CategorizationContext = {
  entity: {
    id: Id<"entities">;
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
};

type PipelineProposal = {
  categoryAccountId: Id<"ledgerAccounts">;
  confidence: number;
  reasoning: string;
  needsHuman: boolean;
  question?: string;
};
type SemanticMemoryProposal = {
  categoryAccountId: Id<"ledgerAccounts">;
  confidence: number;
  reasoning: string;
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
  proposalSource: "semantic_memory" | "llm" | null;
  fallbackReason: string | null;
  route: ExistingRouteResult;
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
  { entityId: Id<"entities">; bankAccountId: Id<"bankAccounts">; amountMinor: number },
  CategorizationContext
>("ai:categorizationContext");

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

function utf8(value: string) {
  return new TextEncoder().encode(value);
}

function hex(bytes: ArrayBuffer | Uint8Array) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", utf8(value)));
}

async function hmacSha256(keyBytes: Uint8Array, value: string) {
  const rawKey = new Uint8Array(keyBytes);
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey.buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(value)));
}

async function signingKey(secretAccessKey: string, dateStamp: string, region: string) {
  const kDate = await hmacSha256(utf8(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, "bedrock");
  return await hmacSha256(kService, "aws4_request");
}

function amzDateParts(now = new Date()) {
  const basic = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: basic,
    dateStamp: basic.slice(0, 8),
  };
}

function bedrockPayload(modelId: string, prompt: string): BedrockPayload {
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

  const host = `bedrock-runtime.${args.env.region}.amazonaws.com`;
  const canonicalUri = `/model/${encodeURIComponent(args.env.modelId)}/invoke`;
  const url = `https://${host}${canonicalUri}`;
  const payloadHash = await sha256Hex(args.payload.body);
  const { amzDate, dateStamp } = amzDateParts();
  const signedHeaders = "accept;content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `accept:${args.payload.accept}`,
    `content-type:${args.payload.contentType}`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    "",
  ].join("\n");
  const canonicalRequest = [
    "POST",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${args.env.region}/bedrock/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hex(await hmacSha256(await signingKey(args.env.secretAccessKey, dateStamp, args.env.region), stringToSign));
  const authorization = `AWS4-HMAC-SHA256 Credential=${args.env.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: args.payload.accept,
      authorization,
      "content-type": args.payload.contentType,
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
    body: args.payload.body,
  });

  if (!response.ok) {
    let code = `HTTP ${response.status}`;
    try {
      const errorPayload = asRecord(await response.json());
      code = stringField(errorPayload ?? {}, "__type") ?? stringField(errorPayload ?? {}, "message") ?? code;
    } catch {
      // Keep status-only error detail.
    }
    throw new Error(`Bedrock categorization invoke failed: ${truncate(code, 120)}`);
  }

  return await response.json();
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

export function buildCategorizationPrompt(args: {
  entityName: string;
  amountMinor: number;
  currency: string;
  merchant: string;
  rawDescription: string;
  date: string;
  accounts: CandidateAccount[];
}) {
  const direction = args.amountMinor >= 0 ? "inflow" : "outflow";
  const amount = `${args.currency} ${(Math.abs(args.amountMinor) / 100).toFixed(2)} ${direction}`;
  const accounts = args.accounts
    .map((account) => `- ${account.number} | ${account.name} | ${account.type}/${account.subtype}`)
    .join("\n");

  return [
    "You are the categorization stage for OpenBooks, a double-entry bookkeeping app.",
    "Choose exactly one category from the candidate account list. Do not invent categories.",
    "Return only JSON. No markdown. No explanation outside JSON.",
    "",
    `Entity: ${args.entityName}`,
    `Date: ${args.date}`,
    `Amount: ${amount}`,
    `Merchant: ${args.merchant}`,
    `Raw description: ${args.rawDescription}`,
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
  semanticMemoryProposal?: SemanticMemoryProposal | null,
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
    ...(semanticMemoryProposal ? { semanticMemoryProposal } : {}),
    ...(aiProposal ? { aiProposal } : {}),
  });
}

async function applyProposalToExistingTransaction(
  ctx: ActionCtx,
  args: {
    transactionId: Id<"transactions">;
    semanticMemoryProposal?: SemanticMemoryProposal | null;
    aiProposal?: PipelineProposal | null;
  },
): Promise<ExistingRouteResult> {
  return await ctx.runMutation(internal.pipeline.applyProposalToExistingTransactionInternal, {
    transactionId: args.transactionId,
    ...(args.semanticMemoryProposal ? { semanticMemoryProposal: args.semanticMemoryProposal } : {}),
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
): Promise<BatchItemResult> {
  const context: CategorizationContext = await ctx.runQuery(categorizationContextRef, {
    entityId: candidate.entityId,
    bankAccountId: candidate.bankAccountId,
    amountMinor: candidate.amountMinor,
  });
  const env = bedrockRuntimeEnv(context.provider.model);
  const skip = (
    mode: "degraded" | "fallback",
    reason: string,
    stage = "skipped",
  ): BatchItemResult => ({
    transactionId: candidate.transactionId,
    mode,
    provider: mode === "degraded" ? context.provider.activeProvider : "bedrock",
    model: context.provider.model,
    proposalSource: null,
    fallbackReason: reason,
    route: skippedExistingRoute(candidate, stage, reason),
  });

  if (
    context.provider.mode !== "active" ||
    context.provider.activeProvider !== "bedrock" ||
    !env.ready
  ) {
    return skip("degraded", "Bedrock env is absent or incomplete; existing imported row was left in review.");
  }

  if (context.candidateAccounts.length === 0) {
    return skip("fallback", "No active candidate category accounts were available for the transaction direction.");
  }

  try {
    const semanticMemoryProposal: SemanticMemoryProposal | null = await ctx.runAction(
      internal.semanticMemory.proposeCategorizationMemory,
      {
        entityId: candidate.entityId,
        merchant: candidate.merchant,
        rawDescription: candidate.rawDescription,
        amountMinor: candidate.amountMinor,
        currency: candidate.currency,
      },
    );
    if (semanticMemoryProposal) {
      return {
        transactionId: candidate.transactionId,
        mode: "bedrock",
        provider: "bedrock",
        model: env.modelId,
        proposalSource: "semantic_memory",
        fallbackReason: null,
        route: await applyProposalToExistingTransaction(ctx, {
          transactionId: candidate.transactionId,
          semanticMemoryProposal,
        }),
      };
    }

    const prompt = buildCategorizationPrompt({
      entityName: context.entity.name,
      amountMinor: candidate.amountMinor,
      currency: candidate.currency,
      merchant: candidate.merchant,
      rawDescription: candidate.rawDescription,
      date: candidate.date,
      accounts: context.candidateAccounts,
    });
    const text = await invokeBedrockText({ env, prompt });
    const normalized = normalizeBedrockCategorizationProposal(
      parseBedrockCategorizationText(text),
      context.candidateAccounts,
    );
    if (!normalized) {
      return skip("fallback", "Bedrock returned no usable category from the allowed account list.");
    }

    return {
      transactionId: candidate.transactionId,
      mode: "bedrock",
      provider: "bedrock",
      model: env.modelId,
      proposalSource: "llm",
      fallbackReason: null,
      route: await applyProposalToExistingTransaction(ctx, {
        transactionId: candidate.transactionId,
        aiProposal: normalized.aiProposal,
      }),
    };
  } catch (error) {
    const reason = error instanceof Error ? truncate(error.message, 160) : "Bedrock batch categorization failed.";
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
    const context: CategorizationContext = await ctx.runQuery(categorizationContextRef, {
      entityId: args.entityId,
      bankAccountId: args.bankAccountId,
      amountMinor: args.amountMinor,
    });

    const env = bedrockRuntimeEnv(context.provider.model);
    const routeWithoutModel = async (mode: "degraded" | "fallback", reason: string | null) => ({
      mode,
      provider: mode === "degraded" ? context.provider.activeProvider : "bedrock" as const,
      model: context.provider.model,
      proposal: null,
      fallbackReason: reason,
      route: await routeThroughPipeline(ctx, args, null),
    });

    if (
      context.provider.mode !== "active" ||
      context.provider.activeProvider !== "bedrock" ||
      !env.ready
    ) {
      return await routeWithoutModel("degraded", "Bedrock env is absent or incomplete; routed through deterministic stages.");
    }

    if (context.candidateAccounts.length === 0) {
      return await routeWithoutModel("fallback", "No active candidate category accounts were available for the transaction direction.");
    }

    try {
      const semanticMemoryProposal: SemanticMemoryProposal | null = await ctx.runAction(
        internal.semanticMemory.proposeCategorizationMemory,
        {
          entityId: args.entityId,
          merchant: args.merchant,
          rawDescription: args.rawDescription,
          amountMinor: args.amountMinor,
          currency: args.currency,
        },
      );
      if (semanticMemoryProposal) {
        return {
          mode: "bedrock" as const,
          provider: "bedrock" as const,
          model: env.modelId,
          proposal: {
            categoryAccountId: semanticMemoryProposal.categoryAccountId,
            accountNumber: "memory",
            categoryName: "Semantic memory",
            confidence: semanticMemoryProposal.confidence,
            needsHuman: false,
          },
          fallbackReason: null,
          route: await routeThroughPipeline(ctx, args, null, semanticMemoryProposal),
        };
      }

      const prompt = buildCategorizationPrompt({
        entityName: context.entity.name,
        amountMinor: args.amountMinor,
        currency: args.currency,
        merchant: args.merchant,
        rawDescription: args.rawDescription,
        date: args.date,
        accounts: context.candidateAccounts,
      });
      const text = await invokeBedrockText({ env, prompt });
      const normalized = normalizeBedrockCategorizationProposal(
        parseBedrockCategorizationText(text),
        context.candidateAccounts,
      );
      if (!normalized) {
        return await routeWithoutModel("fallback", "Bedrock returned no usable category from the allowed account list.");
      }

      return {
        mode: "bedrock" as const,
        provider: "bedrock" as const,
        model: env.modelId,
        proposal: {
          categoryAccountId: normalized.account.id,
          accountNumber: normalized.account.number,
          categoryName: normalized.account.name,
          confidence: normalized.aiProposal.confidence,
          needsHuman: normalized.aiProposal.needsHuman,
        },
        fallbackReason: null,
        route: await routeThroughPipeline(ctx, args, normalized.aiProposal),
      };
    } catch (error) {
      return await routeWithoutModel(
        "fallback",
        error instanceof Error ? truncate(error.message, 160) : "Bedrock categorization failed.",
      );
    }
  },
});

export const categorizePendingTransactions = action({
  args: {
    entityId: v.id("entities"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    attemptedCount: number;
    postedCount: number;
    needsReviewCount: number;
    skippedCount: number;
    degradedCount: number;
    fallbackCount: number;
    results: BatchItemResult[];
  }> => {
    const candidates: BatchCandidate[] = await ctx.runQuery(internal.ai.categorizationBatchCandidates, {
      entityId: args.entityId,
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    });
    const results: BatchItemResult[] = [];
    for (const candidate of candidates) {
      results.push(await categorizeExistingCandidate(ctx, candidate));
    }
    return {
      attemptedCount: results.length,
      postedCount: results.filter((result) => result.route.status === "posted").length,
      needsReviewCount: results.filter((result) => result.route.status === "needs_review").length,
      skippedCount: results.filter((result) => result.route.status === "skipped").length,
      degradedCount: results.filter((result) => result.mode === "degraded").length,
      fallbackCount: results.filter((result) => result.mode === "fallback").length,
      results,
    };
  },
});
