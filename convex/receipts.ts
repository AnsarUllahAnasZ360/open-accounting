import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server";
import {
  bedrockRuntimeEnv,
  extractBedrockResponseText,
  invokeBedrockPayload,
  parseBedrockCategorizationText,
  type BedrockPayload,
} from "./bedrockCategorizer";
import { requireWorkspaceRole } from "./authz";
import { assertNonNegativeMinorUnit } from "./money";

const documentKindValidator = v.union(v.literal("receipt"), v.literal("bill"));

type ExtractedReceipt = {
  vendor: string | null;
  date: string | null;
  totalMinor: number | null;
  confidence: number;
  source: "filename_fixture" | "manual" | "bedrock_degraded" | "bedrock_vision";
  notes: string;
};

type ReceiptExtractionContext = {
  entity: {
    id: Id<"entities">;
    name: string;
    currency: string;
  };
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

async function requireEntityForAdmin(ctx: MutationCtx, entityId: Id<"entities">) {
  const entity = await ctx.db.get(entityId);
  if (!entity) {
    throw new Error("OpenBooks entity not found.");
  }
  await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
  return entity;
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
    return {
      entity: {
        id: entity._id,
        name: entity.name,
        currency: entity.currency,
      },
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

async function findReceiptMatch(
  ctx: MutationCtx,
  args: {
    entityId: Id<"entities">;
    vendor: string;
    date: string;
    totalMinor: number;
  },
) {
  if (!args.vendor || !args.date || args.totalMinor <= 0) return null;
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
    .filter((candidate) => candidate.score >= 4)
    .sort((a, b) => b.score - a.score || b.transaction.date.localeCompare(a.transaction.date))[0]?.transaction ?? null;
}

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
    const match = await findReceiptMatch(ctx, {
      entityId: entity._id,
      vendor,
      date,
      totalMinor,
    });
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

    if (!match) {
      await ctx.db.insert("inboxItems", {
        entityId: entity._id,
        kind: "receipt",
        payloadSummary: `${args.kind === "bill" ? "Bill PDF" : "Receipt"} from ${vendor} needs a manual transaction match.`,
        status: "open",
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
  },
  handler: async (ctx, args): Promise<ApplyBedrockExtractionResult> => {
    const document = await ctx.db.get(args.documentId);
    if (!document) {
      throw new Error("Receipt document not found.");
    }
    const entity = await requireEntityForAdmin(ctx, document.entityId);
    assertNonNegativeMinorUnit(args.totalMinor, "Receipt total");
    const currency = args.currency.trim().toUpperCase() || entity.currency;
    const match = await findReceiptMatch(ctx, {
      entityId: entity._id,
      vendor: args.vendor,
      date: args.date,
      totalMinor: args.totalMinor,
    });
    await ctx.db.patch(args.documentId, {
      vendor: args.vendor,
      date: args.date,
      totalMinor: args.totalMinor,
      currency,
      extractionSource: "bedrock_vision",
      extractionConfidence: args.confidence,
      extractionNotes: args.notes,
      matchedTransactionId: match?._id,
      status: match ? "matched" : "pending",
      updatedAt: Date.now(),
    });
    return {
      documentId: args.documentId,
      status: match ? "matched" as const : "pending" as const,
      matchedTransactionId: match?._id ?? null,
      vendor: args.vendor,
      date: args.date,
      totalMinor: args.totalMinor,
      confidence: args.confidence,
      notes: match ? `Bedrock extraction auto-matched to ${match.merchant} on ${match.date}.` : args.notes,
    };
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

export const extractWithBedrock = action({
  args: {
    documentId: v.id("documents"),
  },
  handler: async (ctx, args): Promise<
    | ({ mode: "bedrock" } & ApplyBedrockExtractionResult)
    | { mode: "degraded" | "fallback"; status: "skipped"; reason: string }
  > => {
    const context: ReceiptExtractionContext = await ctx.runQuery(internal.receipts.receiptExtractionContext, args);
    const env = bedrockRuntimeEnv(null);
    if (!env.ready || !env.modelId) {
      return { mode: "degraded", status: "skipped", reason: "Bedrock env is absent or incomplete; manual metadata remains available." };
    }
    if (!context.document.storageId) {
      return { mode: "fallback", status: "skipped", reason: "Document has no stored file to extract." };
    }

    const blob = await ctx.storage.get(context.document.storageId);
    if (!blob) {
      return { mode: "fallback", status: "skipped", reason: "Stored file could not be read from Convex storage." };
    }
    const mimeType = blob.type || context.document.mimeType || "application/octet-stream";
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

      const result: ApplyBedrockExtractionResult = await ctx.runMutation(internal.receipts.applyBedrockExtraction, {
        documentId: context.document.id,
        vendor: extracted.vendor,
        date: extracted.date,
        totalMinor: extracted.totalMinor,
        currency: context.entity.currency,
        confidence: extracted.confidence,
        notes: extracted.notes,
      });
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
    return { status: "matched" as const, transactionId: transaction._id };
  },
});
