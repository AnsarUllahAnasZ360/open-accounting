import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";

const documentKindValidator = v.union(v.literal("receipt"), v.literal("bill"));

type ExtractedReceipt = {
  vendor: string | null;
  date: string | null;
  totalMinor: number | null;
  confidence: number;
  source: "filename_fixture" | "manual" | "bedrock_degraded";
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

async function requireEntityForAdmin(ctx: MutationCtx, entityId: Id<"entities">) {
  const entity = await ctx.db.get(entityId);
  if (!entity) {
    throw new Error("OpenBooks entity not found.");
  }
  await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
  return entity;
}

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
