import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, type ActionCtx, type MutationCtx } from "./_generated/server";
import {
  bedrockRuntimeEnv,
  extractBedrockResponseText,
  invokeBedrockPayload,
  parseBedrockCategorizationText,
  type BedrockPayload,
} from "./bedrockCategorizer";
import { requireWorkspaceRole } from "./authz";
import { ensureDefaultBankAccountForEntity } from "./defaultBankAccount";
import { assertNonNegativeMinorUnit } from "./money";
import { embedSemanticText, SEMANTIC_MEMORY_DIMENSIONS } from "./semanticMemory";

const documentKindValidator = v.union(v.literal("receipt"), v.literal("bill"));
const extractionSourceValidator = v.union(
  v.literal("filename_fixture"),
  v.literal("manual"),
  v.literal("bedrock_degraded"),
  v.literal("bedrock_vision"),
  v.literal("pdf_text"),
);

type ExtractedReceipt = {
  vendor: string | null;
  date: string | null;
  totalMinor: number | null;
  confidence: number;
  source: "filename_fixture" | "manual" | "bedrock_degraded" | "bedrock_vision" | "pdf_text";
  notes: string;
};

type ReceiptExtractionContext = {
  entity: {
    id: Id<"entities">;
    name: string;
    currency: string;
  };
  embeddingsModel: string | null;
  document: {
    id: Id<"documents">;
    storageId: Id<"_storage"> | null;
    kind: "receipt" | "bill" | "statement";
    fileName: string | null;
    mimeType: string | null;
  };
};

type ApplyBedrockExtractionResult = {
  documentId: Id<"documents">;
  status: "matched" | "pending";
  matchedTransactionId: Id<"transactions"> | null;
  vendor: string;
  date: string;
  totalMinor: number;
  confidence: number;
  notes: string;
};

type ReceiptMatchCandidate = {
  transactionId: Id<"transactions">;
  merchant: string;
  rawDescription: string;
  date: string;
  amountMinor: number;
};

type ReceiptEmbeddingMatch = {
  transactionId: Id<"transactions">;
  score: number;
};

type ReceiptTransactionEmbeddingRow = {
  transactionId: Id<"transactions">;
  sourceText: string;
  embedding: number[];
  embeddingModel: string;
};

type ReceiptEmbeddingMatchResult = {
  match: ReceiptEmbeddingMatch | null;
  sourceText: string;
  embedding: number[];
  embeddingModel: string;
};

const receiptTransactionEmbeddingRowsRef = makeFunctionReference<
  "query",
  {
    entityId: Id<"entities">;
    transactionIds: Id<"transactions">[];
    embeddingModel: string;
  },
  ReceiptTransactionEmbeddingRow[]
>("receipts:receiptTransactionEmbeddingRows");

const upsertReceiptTransactionEmbeddingRef = makeFunctionReference<
  "mutation",
  {
    entityId: Id<"entities">;
    transactionId: Id<"transactions">;
    sourceText: string;
    embedding: number[];
    embeddingModel: string;
  },
  { receiptTransactionEmbeddingId: Id<"receiptTransactionEmbeddings">; status: "created" | "updated" }
>("receipts:upsertReceiptTransactionEmbedding");

function titleCase(value: string) {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

export function extractReceiptMetadataFromFileName(fileName: string): ExtractedReceipt {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const normalized = baseName.toLowerCase().replace(/_/g, "-");
  const dateMatch = normalized.match(/(20\d{2}-\d{2}-\d{2})/);
  const lastAmount = normalized.match(/-(\d{1,5}(?:\.\d{2})?)$/)?.[1] ?? null;
  const totalMinor = lastAmount
    ? Math.round(Number(lastAmount) * 100)
    : null;
  const vendorSlug = normalized
    .replace(/^receipt-/, "")
    .replace(/^bill-/, "")
    .replace(/20\d{2}-\d{2}-\d{2}/, "")
    .replace(/\d{1,5}(?:\.\d{2})?$/, "")
    .replace(/-+/g, " ")
    .trim();

  const vendor = vendorSlug ? titleCase(vendorSlug) : null;
  const confidence = vendor && dateMatch?.[1] && totalMinor !== null ? 0.82 : 0.35;

  return {
    vendor,
    date: dateMatch?.[1] ?? null,
    totalMinor,
    confidence,
    source: confidence >= 0.8 ? "filename_fixture" : "bedrock_degraded",
    notes:
      confidence >= 0.8
        ? "Parsed deterministic fixture metadata from the uploaded file name."
        : "Bedrock vision extraction is not wired in this slice; review and match manually.",
  };
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

function normalizeConfidence(value: number | null) {
  if (value === null) return 0.5;
  const scaled = value > 1 && value <= 100 ? value / 100 : value;
  return Math.min(1, Math.max(0, scaled));
}

function isoDate(value: string | null) {
  if (!value) return null;
  const match = value.match(/20\d{2}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

function totalToMinor(value: number | null) {
  if (value === null || value < 0) return null;
  return Math.round(value * 100);
}

export function normalizeBedrockReceiptExtraction(
  raw: Record<string, unknown> | null,
  fallbackCurrency: string,
): ExtractedReceipt {
  if (!raw) {
    return {
      vendor: null,
      date: null,
      totalMinor: null,
      confidence: 0.35,
      source: "bedrock_degraded",
      notes: "Bedrock returned no parseable receipt JSON; review and match manually.",
    };
  }

  const vendor = stringField(raw, "vendor") ?? stringField(raw, "merchant");
  const date = isoDate(stringField(raw, "date") ?? stringField(raw, "transactionDate"));
  const totalMinor = totalToMinor(numberField(raw, "total") ?? numberField(raw, "totalAmount"));
  const currency = stringField(raw, "currency") ?? fallbackCurrency;
  const confidence = normalizeConfidence(numberField(raw, "confidence"));
  const notes = stringField(raw, "notes") ?? `Bedrock vision extracted ${currency.toUpperCase()} receipt metadata.`;

  return {
    vendor,
    date,
    totalMinor,
    confidence: vendor && date && totalMinor !== null ? Math.max(confidence, 0.72) : Math.min(confidence, 0.55),
    source: vendor && date && totalMinor !== null ? "bedrock_vision" : "bedrock_degraded",
    notes,
  };
}

function unescapePdfString(value: string) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

export function extractPdfTextFromBytes(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  const matches = Array.from(binary.matchAll(/\(([^()]*)\)/g)).map((match) => unescapePdfString(match[1] ?? ""));
  return matches.join("\n").replace(/\s+\n/g, "\n").trim();
}

export function normalizePdfReceiptTextExtraction(
  text: string,
  fallbackCurrency: string,
  fileName: string | null,
): ExtractedReceipt {
  const filenameFallback = fileName ? extractReceiptMetadataFromFileName(fileName) : null;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const joined = lines.join("\n");
  const vendor =
    lines
      .find((line) => /^vendor\s*:/i.test(line))
      ?.replace(/^vendor\s*:\s*/i, "")
      .trim() ||
    lines[0] ||
    filenameFallback?.vendor ||
    null;
  const date = isoDate(joined) ?? filenameFallback?.date ?? null;
  const totalMatch =
    joined.match(/(?:total|amount)\s*[:$]?\s*\$?\s*(\d{1,6}(?:\.\d{2})?)/i) ??
    joined.match(/\$\s*(\d{1,6}(?:\.\d{2})?)/);
  const totalMinor = totalMatch?.[1]
    ? Math.round(Number(totalMatch[1]) * 100)
    : filenameFallback?.totalMinor ?? null;
  const confidence = vendor && date && totalMinor !== null ? 0.78 : 0.45;
  return {
    vendor,
    date,
    totalMinor,
    confidence,
    source: confidence >= 0.7 ? "pdf_text" : "bedrock_degraded",
    notes:
      confidence >= 0.7
        ? `Extracted ${fallbackCurrency.toUpperCase()} receipt metadata from PDF text.`
        : "PDF text extraction could not find all receipt fields; review and match manually.",
  };
}

async function requireEntityForAdmin(ctx: MutationCtx, entityId: Id<"entities">) {
  const entity = await ctx.db.get(entityId);
  if (!entity) {
    throw new Error("OpenBooks entity not found.");
  }
  await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
  return entity;
}

async function pickReceiptExpenseCategory(
  ctx: MutationCtx,
  args: {
    entityId: Id<"entities">;
    categoryAccountId?: Id<"ledgerAccounts">;
  },
) {
  if (args.categoryAccountId) {
    const account = await ctx.db.get(args.categoryAccountId);
    if (!account || account.entityId !== args.entityId || account.type !== "expense" || account.archived) {
      throw new Error("Choose an active expense category for this receipt.");
    }
    return account;
  }

  const accounts = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
    .take(200);
  const account = accounts.find((candidate) => candidate.type === "expense" && candidate.subtype === "office" && !candidate.archived) ??
    accounts.find((candidate) => candidate.type === "expense" && !candidate.archived);
  if (!account) {
    throw new Error("Create an expense category before posting this receipt.");
  }
  return account;
}

export const receiptExtractionContext = internalQuery({
  args: {
    documentId: v.id("documents"),
  },
  handler: async (ctx, args): Promise<ReceiptExtractionContext> => {
    const document = await ctx.db.get(args.documentId);
    if (!document) {
      throw new Error("Receipt document not found.");
    }
    const entity = await ctx.db.get(document.entityId);
    if (!entity) {
      throw new Error("OpenBooks entity not found.");
    }
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const config = await ctx.db
      .query("aiConfigs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", entity.workspaceId))
      .unique();
    return {
      entity: {
        id: entity._id,
        name: entity.name,
        currency: entity.currency,
      },
      embeddingsModel: config?.embedModel ?? (present(process.env.AI_EMBEDDINGS_MODEL) ? process.env.AI_EMBEDDINGS_MODEL!.trim() : null),
      document: {
        id: document._id,
        storageId: document.storageId ?? null,
        kind: document.kind,
        fileName: document.fileName ?? null,
        mimeType: document.mimeType ?? null,
      },
    };
  },
});

function daysBetween(left: string, right: string) {
  const leftTime = Date.parse(`${left}T00:00:00Z`);
  const rightTime = Date.parse(`${right}T00:00:00Z`);
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((leftTime - rightTime) / 86_400_000));
}

function merchantMatches(transaction: Doc<"transactions">, vendor: string) {
  const merchant = transaction.merchant.toLowerCase();
  const vendorKey = vendor.toLowerCase();
  return merchant.includes(vendorKey) || vendorKey.includes(merchant);
}

function present(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

export function buildReceiptEmbeddingText(args: {
  vendor: string;
  date: string;
  totalMinor: number;
  currency: string;
}) {
  return [
    `receipt_vendor: ${args.vendor.trim()}`,
    `date: ${args.date}`,
    `direction: outflow`,
    `amount_minor: ${args.totalMinor}`,
    `currency: ${args.currency.trim().toUpperCase()}`,
  ].join("\n");
}

function buildTransactionReceiptMatchText(candidate: ReceiptMatchCandidate, currency: string) {
  return [
    `transaction_merchant: ${candidate.merchant.trim()}`,
    `description: ${candidate.rawDescription.trim()}`,
    `date: ${candidate.date}`,
    `direction: outflow`,
    `amount_minor: ${Math.abs(candidate.amountMinor)}`,
    `currency: ${currency.trim().toUpperCase()}`,
  ].join("\n");
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function chooseBestReceiptEmbeddingMatch(
  scores: Array<{ transactionId: Id<"transactions">; score: number }>,
) {
  const best = scores
    .filter((candidate) => candidate.score >= 0.78)
    .sort((a, b) => b.score - a.score)[0] ?? null;
  return best;
}

export function assertReceiptEmbeddingVector(embedding: number[]) {
  if (
    embedding.length !== SEMANTIC_MEMORY_DIMENSIONS ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new Error(`Receipt embeddings must be ${SEMANTIC_MEMORY_DIMENSIONS} finite numbers.`);
  }
}

async function findReceiptMatchCandidates(
  ctx: MutationCtx,
  args: {
    entityId: Id<"entities">;
    vendor: string;
    date: string;
    totalMinor: number;
  },
) {
  if (!args.vendor || !args.date || args.totalMinor <= 0) return [];
  const [transactions, documents] = await Promise.all([
    ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", args.entityId)).take(1000),
    ctx.db.query("documents").withIndex("by_entity", (q) => q.eq("entityId", args.entityId)).take(1000),
  ]);
  const alreadyMatched = new Set(
    documents
      .map((document) => document.matchedTransactionId)
      .filter((id): id is Id<"transactions"> => Boolean(id)),
  );

  return transactions
    .filter((transaction) => transaction.amountMinor < 0)
    .filter((transaction) => !alreadyMatched.has(transaction._id))
    .map((transaction) => {
      const amountScore = Math.abs(Math.abs(transaction.amountMinor) - args.totalMinor) <= 100 ? 1 : 0;
      const dateScore = daysBetween(transaction.date, args.date) <= 3 ? 1 : 0;
      const merchantScore = merchantMatches(transaction, args.vendor) ? 1 : 0;
      return { transaction, score: amountScore * 3 + dateScore + merchantScore };
    })
    .filter((candidate) => candidate.score >= 3)
    .sort((a, b) => b.score - a.score || b.transaction.date.localeCompare(a.transaction.date));
}

function receiptInboxSummary(args: {
  kind: "receipt" | "bill";
  vendor: string;
  date: string;
  totalMinor: number;
  currency: string;
  candidate: Doc<"transactions"> | null;
}) {
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: args.currency,
  }).format(args.totalMinor / 100);
  const noun = args.kind === "bill" ? "Bill" : "Receipt";
  if (!args.candidate) {
    return `${noun} from ${args.vendor} for ${amount} on ${args.date} needs a transaction match.`;
  }
  return `${noun} from ${args.vendor} for ${amount} on ${args.date} likely matches ${args.candidate.merchant} on ${args.candidate.date}.`;
}

async function syncReceiptInboxItem(
  ctx: MutationCtx,
  args: {
    entityId: Id<"entities">;
    documentId: Id<"documents">;
    kind: "receipt" | "bill";
    vendor: string;
    date: string;
    totalMinor: number;
    currency: string;
    candidateTransactionId?: Id<"transactions">;
    matchedTransactionId?: Id<"transactions">;
  },
) {
  const now = Date.now();
  const existing = (await ctx.db
    .query("inboxItems")
    .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
    .take(1000))
    .find((item) => item.kind === "receipt" && item.documentId === args.documentId && item.status === "open");
  const candidate = args.candidateTransactionId ? await ctx.db.get(args.candidateTransactionId) : null;
  if (args.matchedTransactionId) {
    if (existing) {
      await ctx.db.patch(existing._id, {
        transactionId: args.matchedTransactionId,
        status: "resolved",
        updatedAt: now,
      });
    }
    return;
  }
  const patch = {
    ...(candidate ? { transactionId: candidate._id } : {}),
    documentId: args.documentId,
    payloadSummary: receiptInboxSummary({
      kind: args.kind,
      vendor: args.vendor,
      date: args.date,
      totalMinor: args.totalMinor,
      currency: args.currency,
      candidate,
    }),
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return;
  }
  await ctx.db.insert("inboxItems", {
    entityId: args.entityId,
    kind: "receipt",
    status: "open",
    createdAt: now,
    ...patch,
  });
}

async function resolveReceiptInboxItems(
  ctx: MutationCtx,
  args: {
    entityId: Id<"entities">;
    documentId: Id<"documents">;
    transactionId?: Id<"transactions">;
  },
) {
  const now = Date.now();
  const items = await ctx.db
    .query("inboxItems")
    .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
    .take(1000);
  await Promise.all(
    items
      .filter((item) => item.kind === "receipt" && item.documentId === args.documentId && item.status === "open")
      .map((item) =>
        ctx.db.patch(item._id, {
          ...(args.transactionId ? { transactionId: args.transactionId } : {}),
          status: "resolved",
          updatedAt: now,
        }),
      ),
  );
}

export const receiptEmbeddingCandidates = internalQuery({
  args: {
    entityId: v.id("entities"),
    date: v.string(),
    totalMinor: v.number(),
  },
  handler: async (ctx, args): Promise<ReceiptMatchCandidate[]> => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new Error("OpenBooks entity not found.");
    }
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    if (!args.date || args.totalMinor <= 0) return [];
    const [transactions, documents] = await Promise.all([
      ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(1000),
      ctx.db.query("documents").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(1000),
    ]);
    const alreadyMatched = new Set(
      documents
        .map((document) => document.matchedTransactionId)
        .filter((id): id is Id<"transactions"> => Boolean(id)),
    );
    return transactions
      .filter((transaction) => transaction.amountMinor < 0)
      .filter((transaction) => !alreadyMatched.has(transaction._id))
      .filter((transaction) => Math.abs(Math.abs(transaction.amountMinor) - args.totalMinor) <= 100)
      .filter((transaction) => daysBetween(transaction.date, args.date) <= 3)
      .slice(0, 8)
      .map((transaction) => ({
        transactionId: transaction._id,
        merchant: transaction.merchant,
        rawDescription: transaction.rawDescription,
        date: transaction.date,
        amountMinor: transaction.amountMinor,
      }));
  },
});

export const generateUploadUrl = mutation({
  args: {
    entityId: v.id("entities"),
  },
  handler: async (ctx, args) => {
    await requireEntityForAdmin(ctx, args.entityId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const recordUpload = mutation({
  args: {
    entityId: v.id("entities"),
    kind: documentKindValidator,
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    vendor: v.optional(v.string()),
    date: v.optional(v.string()),
    totalMinor: v.optional(v.number()),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await requireEntityForAdmin(ctx, args.entityId);
    const extracted = extractReceiptMetadataFromFileName(args.fileName);
    const vendor = args.vendor?.trim() || extracted.vendor || "Uploaded receipt";
    const date = args.date?.trim() || extracted.date || new Date().toISOString().slice(0, 10);
    const totalMinor = args.totalMinor ?? extracted.totalMinor ?? 0;
    assertNonNegativeMinorUnit(totalMinor, "Receipt total");
    const currency = args.currency?.trim().toUpperCase() || entity.currency;
    const source = args.vendor || args.date || args.totalMinor !== undefined ? "manual" as const : extracted.source;
    const confidence = source === "manual" ? 0.95 : extracted.confidence;
    const matchCandidates = await findReceiptMatchCandidates(ctx, {
      entityId: entity._id,
      vendor,
      date,
      totalMinor,
    });
    const match = matchCandidates.find((candidate) => candidate.score >= 4)?.transaction ?? null;
    const candidate = matchCandidates[0]?.transaction ?? null;
    const now = Date.now();
    const documentId = await ctx.db.insert("documents", {
      entityId: entity._id,
      kind: args.kind,
      storageId: args.storageId,
      fileName: args.fileName,
      mimeType: args.mimeType,
      vendor,
      date,
      totalMinor,
      currency,
      extractionSource: source,
      extractionConfidence: confidence,
      extractionNotes: source === "manual" ? "Reviewed manually during upload." : extracted.notes,
      matchedTransactionId: match?._id,
      status: match ? "matched" : "pending",
      createdAt: now,
      updatedAt: now,
    });

    await syncReceiptInboxItem(ctx, {
      entityId: entity._id,
      documentId,
      kind: args.kind,
      vendor,
      date,
      totalMinor,
      currency,
      ...(candidate ? { candidateTransactionId: candidate._id } : {}),
      ...(match ? { matchedTransactionId: match._id } : {}),
    });

    if (match) {
      await ctx.db.insert("inboxItems", {
        entityId: entity._id,
        documentId,
        transactionId: match._id,
        kind: "receipt",
        payloadSummary: `${args.kind === "bill" ? "Bill" : "Receipt"} from ${vendor} auto-matched to ${match.merchant}.`,
        status: "resolved",
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      documentId,
      status: match ? "matched" as const : "pending" as const,
      matchedTransactionId: match?._id ?? null,
      vendor,
      date,
      totalMinor,
      confidence,
      notes: match
        ? `Auto-matched to ${match.merchant} on ${match.date}.`
        : "Queued for manual matching.",
    };
  },
});

export const applyBedrockExtraction = internalMutation({
  args: {
    documentId: v.id("documents"),
    vendor: v.string(),
    date: v.string(),
    totalMinor: v.number(),
    currency: v.string(),
    confidence: v.number(),
    notes: v.string(),
    extractionSource: v.optional(extractionSourceValidator),
    embeddingMatchedTransactionId: v.optional(v.id("transactions")),
    embeddingMatchScore: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ApplyBedrockExtractionResult> => {
    const document = await ctx.db.get(args.documentId);
    if (!document) {
      throw new Error("Receipt document not found.");
    }
    const entity = await requireEntityForAdmin(ctx, document.entityId);
    assertNonNegativeMinorUnit(args.totalMinor, "Receipt total");
    const currency = args.currency.trim().toUpperCase() || entity.currency;
    const matchCandidates = await findReceiptMatchCandidates(ctx, {
      entityId: entity._id,
      vendor: args.vendor,
      date: args.date,
      totalMinor: args.totalMinor,
    });
    const match = matchCandidates.find((candidate) => candidate.score >= 4)?.transaction ?? null;
    const candidate = matchCandidates[0]?.transaction ?? null;
    const embeddingMatch = args.embeddingMatchedTransactionId
      ? await ctx.db.get(args.embeddingMatchedTransactionId)
      : null;
    if (embeddingMatch && embeddingMatch.entityId !== entity._id) {
      throw new Error("Receipt embedding match must use a transaction from the same entity.");
    }
    const existingMatch = document.matchedTransactionId
      ? await ctx.db.get(document.matchedTransactionId)
      : null;
    if (existingMatch && existingMatch.entityId !== entity._id) {
      throw new Error("Existing receipt match must use a transaction from the same entity.");
    }
    const finalMatch = match ?? embeddingMatch ?? existingMatch;
    const extractionLabel = args.extractionSource === "pdf_text" ? "PDF text extraction" : "Bedrock extraction";
    const notes = match
      ? `${extractionLabel} auto-matched to ${match.merchant} on ${match.date}.`
      : embeddingMatch
        ? `${extractionLabel} embedding-matched to ${embeddingMatch.merchant} on ${embeddingMatch.date} with score ${(args.embeddingMatchScore ?? 0).toFixed(2)}.`
        : existingMatch
          ? `${extractionLabel} kept the existing match to ${existingMatch.merchant} on ${existingMatch.date}.`
        : args.notes;
    await ctx.db.patch(args.documentId, {
      vendor: args.vendor,
      date: args.date,
      totalMinor: args.totalMinor,
      currency,
      extractionSource: args.extractionSource ?? "bedrock_vision",
      extractionConfidence: args.confidence,
      extractionNotes: notes,
      matchedTransactionId: finalMatch?._id,
      status: finalMatch ? "matched" : "pending",
      updatedAt: Date.now(),
    });
    await syncReceiptInboxItem(ctx, {
      entityId: entity._id,
      documentId: document._id,
      kind: document.kind === "bill" ? "bill" : "receipt",
      vendor: args.vendor,
      date: args.date,
      totalMinor: args.totalMinor,
      currency,
      ...(candidate ? { candidateTransactionId: candidate._id } : {}),
      ...(finalMatch ? { matchedTransactionId: finalMatch._id } : {}),
    });
    return {
      documentId: args.documentId,
      status: finalMatch ? "matched" as const : "pending" as const,
      matchedTransactionId: finalMatch?._id ?? null,
      vendor: args.vendor,
      date: args.date,
      totalMinor: args.totalMinor,
      confidence: args.confidence,
      notes,
    };
  },
});

export const upsertReceiptEmbedding = internalMutation({
  args: {
    entityId: v.id("entities"),
    documentId: v.id("documents"),
    vendor: v.string(),
    date: v.string(),
    totalMinor: v.number(),
    currency: v.string(),
    sourceText: v.string(),
    embedding: v.array(v.float64()),
    embeddingModel: v.string(),
    matchedTransactionId: v.optional(v.id("transactions")),
    matchScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertReceiptEmbeddingVector(args.embedding);
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new Error("OpenBooks entity not found.");
    }
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const document = await ctx.db.get(args.documentId);
    if (!document || document.entityId !== entity._id) {
      throw new Error("Receipt embedding must belong to a document on this entity.");
    }
    const matchedTransaction = args.matchedTransactionId
      ? await ctx.db.get(args.matchedTransactionId)
      : null;
    if (matchedTransaction && matchedTransaction.entityId !== entity._id) {
      throw new Error("Receipt embedding match must use a transaction from the same entity.");
    }
    assertNonNegativeMinorUnit(args.totalMinor, "Receipt total");
    const now = Date.now();
    const existing = await ctx.db
      .query("receiptEmbeddings")
      .withIndex("by_document", (q) => q.eq("documentId", document._id))
      .first();
    const row = {
      entityId: entity._id,
      documentId: document._id,
      vendor: args.vendor,
      date: args.date,
      totalMinor: args.totalMinor,
      currency: args.currency.trim().toUpperCase() || entity.currency,
      sourceText: args.sourceText,
      embedding: args.embedding,
      embeddingModel: args.embeddingModel,
      ...(matchedTransaction ? { matchedTransactionId: matchedTransaction._id } : {}),
      ...(args.matchScore !== undefined ? { matchScore: args.matchScore } : {}),
      status: "active" as const,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.replace(existing._id, {
        ...row,
        createdAt: existing.createdAt,
      });
      return { receiptEmbeddingId: existing._id, status: "updated" as const };
    }
    const receiptEmbeddingId = await ctx.db.insert("receiptEmbeddings", {
      ...row,
      createdAt: now,
    });
    return { receiptEmbeddingId, status: "created" as const };
  },
});

export const receiptTransactionEmbeddingRows = internalQuery({
  args: {
    entityId: v.id("entities"),
    transactionIds: v.array(v.id("transactions")),
    embeddingModel: v.string(),
  },
  handler: async (ctx, args): Promise<ReceiptTransactionEmbeddingRow[]> => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new Error("OpenBooks entity not found.");
    }
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const wanted = new Set(args.transactionIds);
    return (await ctx.db
      .query("receiptTransactionEmbeddings")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(1000))
      .filter((row) => wanted.has(row.transactionId) && row.embeddingModel === args.embeddingModel && row.status === "ready")
      .map((row) => ({
        transactionId: row.transactionId,
        sourceText: row.sourceText,
        embedding: row.embedding,
        embeddingModel: row.embeddingModel,
      }));
  },
});

export const upsertReceiptTransactionEmbedding = internalMutation({
  args: {
    entityId: v.id("entities"),
    transactionId: v.id("transactions"),
    sourceText: v.string(),
    embedding: v.array(v.float64()),
    embeddingModel: v.string(),
  },
  handler: async (ctx, args) => {
    assertReceiptEmbeddingVector(args.embedding);
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new Error("OpenBooks entity not found.");
    }
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction || transaction.entityId !== entity._id) {
      throw new Error("Receipt transaction embedding must belong to this entity.");
    }
    const now = Date.now();
    const existing = (await ctx.db
      .query("receiptTransactionEmbeddings")
      .withIndex("by_transaction", (q) => q.eq("transactionId", transaction._id))
      .collect())
      .find((row) => row.embeddingModel === args.embeddingModel);
    const row = {
      entityId: entity._id,
      transactionId: transaction._id,
      sourceText: args.sourceText,
      embedding: args.embedding,
      embeddingModel: args.embeddingModel,
      status: "ready" as const,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.replace(existing._id, {
        ...row,
        createdAt: existing.createdAt,
      });
      return { receiptTransactionEmbeddingId: existing._id, status: "updated" as const };
    }
    const receiptTransactionEmbeddingId = await ctx.db.insert("receiptTransactionEmbeddings", {
      ...row,
      createdAt: now,
    });
    return { receiptTransactionEmbeddingId, status: "created" as const };
  },
});

function receiptVisionPrompt(kind: string) {
  return [
    `Extract ${kind === "bill" ? "bill" : "receipt"} fields for OpenBooks.`,
    "Return only JSON. No markdown. No explanation outside JSON.",
    "Use this exact shape:",
    "{\"vendor\":\"Amazon Business\",\"date\":\"2026-04-12\",\"total\":128.45,\"currency\":\"USD\",\"confidence\":0.86,\"notes\":\"Short extraction note\"}",
    "If a field is unreadable, use null for that field and lower confidence.",
  ].join("\n");
}

function receiptVisionPayload(modelId: string, mimeType: string, base64: string, prompt: string): BedrockPayload {
  if (!modelId.includes("anthropic.claude")) {
    throw new Error("Configured AI_MODEL does not support the receipt vision payload.");
  }
  return {
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 500,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType,
                data: base64,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

async function findReceiptEmbeddingMatch(
  ctx: ActionCtx,
  args: {
    entityId: Id<"entities">;
    vendor: string;
    date: string;
    totalMinor: number;
    currency: string;
    embeddingsModel: string | null;
  },
): Promise<ReceiptEmbeddingMatchResult | null> {
  if (!args.embeddingsModel) return null;
  const sourceText = buildReceiptEmbeddingText(args);
  const receiptEmbedding = await embedSemanticText({
    modelId: args.embeddingsModel,
    text: sourceText,
  });
  const candidates: ReceiptMatchCandidate[] = await ctx.runQuery(internal.receipts.receiptEmbeddingCandidates, {
    entityId: args.entityId,
    date: args.date,
    totalMinor: args.totalMinor,
  });
  const cachedRows = await ctx.runQuery(receiptTransactionEmbeddingRowsRef, {
    entityId: args.entityId,
    transactionIds: candidates.map((candidate) => candidate.transactionId),
    embeddingModel: receiptEmbedding.modelId,
  });
  const cachedByTransactionId = new Map(cachedRows.map((row) => [row.transactionId, row]));
  const scored = await Promise.all(
    candidates.map(async (candidate) => {
      const sourceText = buildTransactionReceiptMatchText(candidate, args.currency);
      const cached = cachedByTransactionId.get(candidate.transactionId);
      let vector = cached?.sourceText === sourceText ? cached.embedding : null;
      if (!vector) {
        const candidateEmbedding = await embedSemanticText({
          modelId: args.embeddingsModel!,
          text: sourceText,
        });
        vector = candidateEmbedding.vector;
        try {
          await ctx.runMutation(upsertReceiptTransactionEmbeddingRef, {
            entityId: args.entityId,
            transactionId: candidate.transactionId,
            sourceText,
            embedding: vector,
            embeddingModel: candidateEmbedding.modelId,
          });
        } catch {
          // Matching can still use the live vector if persistence is unavailable.
        }
      }
      return {
        transactionId: candidate.transactionId,
        score: cosineSimilarity(receiptEmbedding.vector, vector),
      };
    }),
  );
  return {
    match: chooseBestReceiptEmbeddingMatch(scored),
    sourceText,
    embedding: receiptEmbedding.vector,
    embeddingModel: receiptEmbedding.modelId,
  };
}

export const extractWithBedrock = action({
  args: {
    documentId: v.id("documents"),
  },
  handler: async (ctx, args): Promise<
    | ({ mode: "bedrock" | "pdf_text" } & ApplyBedrockExtractionResult)
    | { mode: "degraded" | "fallback"; status: "skipped"; reason: string }
  > => {
    const context: ReceiptExtractionContext = await ctx.runQuery(internal.receipts.receiptExtractionContext, args);
    if (!context.document.storageId) {
      return { mode: "fallback", status: "skipped", reason: "Document has no stored file to extract." };
    }

    const blob = await ctx.storage.get(context.document.storageId);
    if (!blob) {
      return { mode: "fallback", status: "skipped", reason: "Stored file could not be read from Convex storage." };
    }
    const mimeType = blob.type || context.document.mimeType || "application/octet-stream";
    if (mimeType === "application/pdf") {
      const extracted = normalizePdfReceiptTextExtraction(
        extractPdfTextFromBytes(await blob.arrayBuffer()),
        context.entity.currency,
        context.document.fileName,
      );
      if (
        extracted.source !== "pdf_text" ||
        !extracted.vendor ||
        !extracted.date ||
        extracted.totalMinor === null
      ) {
        return { mode: "fallback", status: "skipped", reason: extracted.notes };
      }
      const result: ApplyBedrockExtractionResult = await ctx.runMutation(internal.receipts.applyBedrockExtraction, {
        documentId: context.document.id,
        vendor: extracted.vendor,
        date: extracted.date,
        totalMinor: extracted.totalMinor,
        currency: context.entity.currency,
        confidence: extracted.confidence,
        notes: extracted.notes,
        extractionSource: "pdf_text",
      });
      return { mode: "pdf_text", ...result };
    }

    const env = bedrockRuntimeEnv(null);
    if (!env.ready || !env.modelId) {
      return { mode: "degraded", status: "skipped", reason: "Bedrock env is absent or incomplete; manual metadata remains available." };
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
      return { mode: "fallback", status: "skipped", reason: "Bedrock receipt extraction currently supports PNG, JPEG, and WebP uploads." };
    }

    try {
      const payload = receiptVisionPayload(
        env.modelId,
        mimeType,
        arrayBufferToBase64(await blob.arrayBuffer()),
        receiptVisionPrompt(context.document.kind),
      );
      const response = await invokeBedrockPayload({ env, payload });
      const extracted = normalizeBedrockReceiptExtraction(
        parseBedrockCategorizationText(extractBedrockResponseText(env.modelId, response)),
        context.entity.currency,
      );
      if (
        extracted.source !== "bedrock_vision" ||
        !extracted.vendor ||
        !extracted.date ||
        extracted.totalMinor === null
      ) {
        return { mode: "fallback", status: "skipped", reason: extracted.notes };
      }

      let embeddingResult: ReceiptEmbeddingMatchResult | null = null;
      try {
        embeddingResult = await findReceiptEmbeddingMatch(ctx, {
          entityId: context.entity.id,
          vendor: extracted.vendor,
          date: extracted.date,
          totalMinor: extracted.totalMinor,
          currency: context.entity.currency,
          embeddingsModel: context.embeddingsModel,
        });
      } catch {
        embeddingResult = null;
      }

      const result: ApplyBedrockExtractionResult = await ctx.runMutation(internal.receipts.applyBedrockExtraction, {
        documentId: context.document.id,
        vendor: extracted.vendor,
        date: extracted.date,
        totalMinor: extracted.totalMinor,
        currency: context.entity.currency,
        confidence: extracted.confidence,
        notes: extracted.notes,
        ...(embeddingResult?.match
          ? {
              embeddingMatchedTransactionId: embeddingResult.match.transactionId,
              embeddingMatchScore: embeddingResult.match.score,
            }
          : {}),
      });
      if (embeddingResult) {
        try {
          const _: { receiptEmbeddingId: Id<"receiptEmbeddings">; status: "created" | "updated" } = await ctx.runMutation(
            internal.receipts.upsertReceiptEmbedding,
            {
              entityId: context.entity.id,
              documentId: context.document.id,
              vendor: extracted.vendor,
              date: extracted.date,
              totalMinor: extracted.totalMinor,
              currency: context.entity.currency,
              sourceText: embeddingResult.sourceText,
              embedding: embeddingResult.embedding,
              embeddingModel: embeddingResult.embeddingModel,
              ...(result.matchedTransactionId ? { matchedTransactionId: result.matchedTransactionId } : {}),
              ...(embeddingResult.match?.transactionId === result.matchedTransactionId
                ? { matchScore: embeddingResult.match.score }
                : {}),
            },
          );
        } catch {
          // Receipt extraction remains useful even if vector persistence falls back.
        }
      }
      return { mode: "bedrock", ...result };
    } catch (error) {
      return {
        mode: "fallback",
        status: "skipped",
        reason: error instanceof Error ? error.message : "Bedrock receipt extraction failed.",
      };
    }
  },
});

export const manualMatch = mutation({
  args: {
    documentId: v.id("documents"),
    transactionId: v.optional(v.id("transactions")),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document) {
      throw new Error("Receipt document not found.");
    }
    await requireEntityForAdmin(ctx, document.entityId);
    if (!args.transactionId) {
      await ctx.db.replace(args.documentId, {
        entityId: document.entityId,
        kind: document.kind,
        ...(document.storageId ? { storageId: document.storageId } : {}),
        ...(document.fileName ? { fileName: document.fileName } : {}),
        ...(document.mimeType ? { mimeType: document.mimeType } : {}),
        vendor: document.vendor,
        date: document.date,
        totalMinor: document.totalMinor,
        currency: document.currency,
        ...(document.extractionSource ? { extractionSource: document.extractionSource } : {}),
        ...(document.extractionConfidence !== undefined ? { extractionConfidence: document.extractionConfidence } : {}),
        ...(document.extractionNotes ? { extractionNotes: document.extractionNotes } : {}),
        status: "unmatched",
        createdAt: document.createdAt,
        updatedAt: Date.now(),
      });
      await resolveReceiptInboxItems(ctx, {
        entityId: document.entityId,
        documentId: document._id,
      });
      return { status: "unmatched" as const };
    }
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction || transaction.entityId !== document.entityId) {
      throw new Error("Receipt match must use a transaction from the same entity.");
    }
    await ctx.db.patch(args.documentId, {
      matchedTransactionId: transaction._id,
      status: "matched",
      updatedAt: Date.now(),
    });
    await resolveReceiptInboxItems(ctx, {
      entityId: document.entityId,
      documentId: document._id,
      transactionId: transaction._id,
    });
    return { status: "matched" as const, transactionId: transaction._id };
  },
});

export const createExpenseFromReceipt = mutation({
  args: {
    documentId: v.id("documents"),
    categoryAccountId: v.optional(v.id("ledgerAccounts")),
  },
  handler: async (ctx, args): Promise<{
    status: "created" | "duplicate";
    transactionId: Id<"transactions">;
    entryId: Id<"journalEntries"> | null;
    documentId: Id<"documents">;
  }> => {
    const document = await ctx.db.get(args.documentId);
    if (!document) {
      throw new Error("Receipt document not found.");
    }
    if (document.kind !== "receipt") {
      throw new Error("Create expense is available for receipt uploads; bill creation stays in the Bills flow.");
    }
    const entity = await ctx.db.get(document.entityId);
    if (!entity) {
      throw new Error("OpenBooks entity not found.");
    }
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    assertNonNegativeMinorUnit(document.totalMinor, "Receipt total");
    if (document.totalMinor <= 0) {
      throw new Error("Receipt total must be greater than zero before creating an expense.");
    }
    if (document.matchedTransactionId) {
      const matched = await ctx.db.get(document.matchedTransactionId);
      if (matched && matched.entityId === entity._id) {
        return {
          status: "duplicate",
          transactionId: matched._id,
          entryId: matched.entryId ?? null,
          documentId: document._id,
        };
      }
    }

    const bankAccountId = await ensureDefaultBankAccountForEntity(ctx, entity);
    const categoryAccount = await pickReceiptExpenseCategory(ctx, {
      entityId: entity._id,
      ...(args.categoryAccountId ? { categoryAccountId: args.categoryAccountId } : {}),
    });
    const result: {
      status: "posted" | "needs_review" | "duplicate";
      transactionId: Id<"transactions">;
      entryId: Id<"journalEntries"> | null;
      stage: string;
    } = await ctx.runMutation(internal.pipeline.routeTransactionInternal, {
      entityId: entity._id,
      bankAccountId,
      date: document.date,
      amountMinor: -document.totalMinor,
      currency: document.currency,
      merchant: document.vendor,
      rawDescription: `Receipt expense${document.fileName ? ` from ${document.fileName}` : ""}`,
      status: "posted",
      source: "manual",
      externalId: `receipt-expense:${document._id}`,
      categoryAccountId: categoryAccount._id,
      actorUserId: userId,
    });

    await ctx.db.patch(document._id, {
      matchedTransactionId: result.transactionId,
      status: "matched",
      updatedAt: Date.now(),
    });
    await resolveReceiptInboxItems(ctx, {
      entityId: entity._id,
      documentId: document._id,
      transactionId: result.transactionId,
    });

    return {
      status: result.status === "duplicate" ? "duplicate" : "created",
      transactionId: result.transactionId,
      entryId: result.entryId,
      documentId: document._id,
    };
  },
});
