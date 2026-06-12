/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import {
  assertReceiptEmbeddingVector,
  buildReceiptEmbeddingText,
  chooseBestReceiptEmbeddingMatch,
  cosineSimilarity,
  extractReceiptMetadataFromFileName,
  extractPdfTextFromBytes,
  normalizeBedrockReceiptExtraction,
  normalizePdfReceiptTextExtraction,
} from "./receipts";
import schema from "./schema";
import { SEMANTIC_MEMORY_DIMENSIONS } from "./semanticMemory";

const modules = import.meta.glob("./**/*.ts");

async function setupReceiptEmbeddingBackend(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      email: "owner@example.com",
      name: "Owner",
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar's workspace",
      slug: "ansar-workspace",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const entityId = await ctx.db.insert("entities", {
      workspaceId,
      name: "Acme Studio LLC",
      slug: "acme-studio-llc",
      businessType: "services",
      currency: "USD",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
    const documentId = await ctx.db.insert("documents", {
      entityId,
      kind: "receipt",
      fileName: "receipt-amazon-business-2026-04-12-128.45.png",
      mimeType: "image/png",
      vendor: "Amazon Business",
      date: "2026-04-12",
      totalMinor: 12845,
      currency: "USD",
      extractionSource: "filename_fixture",
      extractionConfidence: 0.82,
      extractionNotes: "Fixture metadata.",
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    const transactionId = await ctx.db.insert("transactions", {
      entityId,
      date: "2026-04-12",
      amountMinor: -12845,
      currency: "USD",
      merchant: "Amazon Business",
      rawDescription: "Amazon Business receipt",
      status: "pending",
      review: "needs_review",
      source: "bank",
      externalId: "receipt-match-test",
      evalSet: false,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, entityId, documentId, transactionId };
  });
}

function authed(t: TestConvex<typeof schema>, userId: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|owner",
    issuer: "test",
    email: "owner@example.com",
  });
}

describe("M11 receipt extraction helpers", () => {
  it("extracts deterministic fixture metadata from receipt filenames", () => {
    const result = extractReceiptMetadataFromFileName("receipt-amazon-business-2026-04-12-128.45.png");

    expect(result).toMatchObject({
      vendor: "Amazon Business",
      date: "2026-04-12",
      totalMinor: 12845,
      confidence: 0.82,
      source: "filename_fixture",
    });
  });

  it("degrades to manual review when filename metadata is incomplete", () => {
    const result = extractReceiptMetadataFromFileName("scan.png");

    expect(result).toMatchObject({
      vendor: "Scan",
      date: null,
      totalMinor: null,
      confidence: 0.35,
      source: "bedrock_degraded",
    });
  });

  it("normalizes Bedrock receipt extraction into minor units", () => {
    const result = normalizeBedrockReceiptExtraction(
      {
        vendor: "Figma",
        date: "2026-05-14",
        total: 99,
        currency: "USD",
        confidence: 0.84,
        notes: "Clear receipt image.",
      },
      "USD",
    );

    expect(result).toMatchObject({
      vendor: "Figma",
      date: "2026-05-14",
      totalMinor: 9900,
      confidence: 0.84,
      source: "bedrock_vision",
    });
  });

  it("extracts PDF text receipt fields into minor units", () => {
    const pdfLikeBytes = new TextEncoder().encode([
      "(Vendor: Office Depot)",
      "(Date: 2026-04-14)",
      "(Total: $87.19)",
    ].join("\n")).buffer;
    const text = extractPdfTextFromBytes(pdfLikeBytes);
    const result = normalizePdfReceiptTextExtraction(text, "USD", "receipt-office-depot-2026-04-14-87.19.pdf");

    expect(text).toContain("Office Depot");
    expect(result).toMatchObject({
      vendor: "Office Depot",
      date: "2026-04-14",
      totalMinor: 8719,
      confidence: 0.78,
      source: "pdf_text",
    });
  });

  it("keeps incomplete Bedrock extraction in degraded review", () => {
    const result = normalizeBedrockReceiptExtraction({ vendor: "Unknown" }, "USD");

    expect(result).toMatchObject({
      vendor: "Unknown",
      date: null,
      totalMinor: null,
      source: "bedrock_degraded",
    });
    expect(result.confidence).toBeLessThanOrEqual(0.55);
  });

  it("builds receipt embedding text without secrets", () => {
    const text = buildReceiptEmbeddingText({
      vendor: "Amazon Business",
      date: "2026-04-12",
      totalMinor: 12845,
      currency: "usd",
    });

    expect(text).toContain("receipt_vendor: Amazon Business");
    expect(text).toContain("amount_minor: 12845");
    expect(text).toContain("currency: USD");
    expect(text).not.toContain("AWS_SECRET_ACCESS_KEY");
  });

  it("chooses embedding matches only above threshold", () => {
    const left = [1, 0, 0];
    const right = [0.9, 0.1, 0];
    const weak = [0, 1, 0];

    expect(cosineSimilarity(left, right)).toBeGreaterThan(0.9);
    expect(cosineSimilarity(left, weak)).toBe(0);
    expect(chooseBestReceiptEmbeddingMatch([
      { transactionId: "weak" as never, score: 0.71 },
      { transactionId: "best" as never, score: 0.86 },
    ])).toMatchObject({ transactionId: "best", score: 0.86 });
    expect(chooseBestReceiptEmbeddingMatch([{ transactionId: "weak" as never, score: 0.71 }])).toBeNull();
  });

  it("validates persisted receipt vectors before storage", () => {
    const vector = Array.from({ length: SEMANTIC_MEMORY_DIMENSIONS }, (_, index) => index / SEMANTIC_MEMORY_DIMENSIONS);

    expect(() => assertReceiptEmbeddingVector(vector)).not.toThrow();
    expect(() => assertReceiptEmbeddingVector([1, 2, 3])).toThrow(/1024/);
    expect(() => assertReceiptEmbeddingVector([...vector.slice(0, -1), Number.NaN])).toThrow(/finite/);
  });

  it("persists one same-entity receipt embedding per document", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupReceiptEmbeddingBackend(t);
    const session = authed(t, ids.userId);
    const vector = Array.from({ length: SEMANTIC_MEMORY_DIMENSIONS }, (_, index) => index / SEMANTIC_MEMORY_DIMENSIONS);

    const first = await session.mutation(internal.receipts.upsertReceiptEmbedding, {
      entityId: ids.entityId,
      documentId: ids.documentId,
      vendor: "Amazon Business",
      date: "2026-04-12",
      totalMinor: 12845,
      currency: "USD",
      sourceText: "receipt_vendor: Amazon Business",
      embedding: vector,
      embeddingModel: "amazon.titan-embed-text-v2:0",
      matchedTransactionId: ids.transactionId,
      matchScore: 0.91,
    });
    const second = await session.mutation(internal.receipts.upsertReceiptEmbedding, {
      entityId: ids.entityId,
      documentId: ids.documentId,
      vendor: "Amazon Business",
      date: "2026-04-12",
      totalMinor: 12845,
      currency: "USD",
      sourceText: "receipt_vendor: Amazon Business\namount_minor: 12845",
      embedding: vector,
      embeddingModel: "amazon.titan-embed-text-v2:0",
      matchedTransactionId: ids.transactionId,
      matchScore: 0.93,
    });

    expect(first).toMatchObject({ status: "created" });
    expect(second).toMatchObject({ receiptEmbeddingId: first.receiptEmbeddingId, status: "updated" });
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("receiptEmbeddings")
        .withIndex("by_document", (q) => q.eq("documentId", ids.documentId))
        .collect();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        entityId: ids.entityId,
        documentId: ids.documentId,
        matchedTransactionId: ids.transactionId,
        matchScore: 0.93,
        status: "active",
      });
    });
  });

  it("keeps an existing same-document match when a later extraction refines metadata", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupReceiptEmbeddingBackend(t);
    const session = authed(t, ids.userId);
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.documentId, {
        matchedTransactionId: ids.transactionId,
        status: "matched",
      });
    });

    const result = await session.mutation(internal.receipts.applyBedrockExtraction, {
      documentId: ids.documentId,
      vendor: "Amazon Business",
      date: "2026-04-12",
      totalMinor: 12845,
      currency: "USD",
      confidence: 0.78,
      notes: "PDF text extracted receipt metadata.",
      extractionSource: "pdf_text",
    });

    expect(result).toMatchObject({
      status: "matched",
      matchedTransactionId: ids.transactionId,
      notes: expect.stringContaining("kept the existing match"),
    });
    await t.run(async (ctx) => {
      const document = await ctx.db.get(ids.documentId);
      expect(document).toMatchObject({
        matchedTransactionId: ids.transactionId,
        status: "matched",
        extractionSource: "pdf_text",
      });
    });
  });

  it("persists one same-entity candidate transaction embedding", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupReceiptEmbeddingBackend(t);
    const session = authed(t, ids.userId);
    const vector = Array.from({ length: SEMANTIC_MEMORY_DIMENSIONS }, (_, index) => (index + 1) / SEMANTIC_MEMORY_DIMENSIONS);

    const first = await session.mutation(internal.receipts.upsertReceiptTransactionEmbedding, {
      entityId: ids.entityId,
      transactionId: ids.transactionId,
      sourceText: "transaction_merchant: Amazon Business",
      embedding: vector,
      embeddingModel: "amazon.titan-embed-text-v2:0",
    });
    const second = await session.mutation(internal.receipts.upsertReceiptTransactionEmbedding, {
      entityId: ids.entityId,
      transactionId: ids.transactionId,
      sourceText: "transaction_merchant: Amazon Business\namount_minor: 12845",
      embedding: vector,
      embeddingModel: "amazon.titan-embed-text-v2:0",
    });

    expect(first).toMatchObject({ status: "created" });
    expect(second).toMatchObject({ receiptTransactionEmbeddingId: first.receiptTransactionEmbeddingId, status: "updated" });
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("receiptTransactionEmbeddings")
        .withIndex("by_transaction", (q) => q.eq("transactionId", ids.transactionId))
        .collect();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        entityId: ids.entityId,
        transactionId: ids.transactionId,
        status: "ready",
      });
    });
  });

  it("links pending receipt inbox cards to the document and resolves them on manual match", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupReceiptEmbeddingBackend(t);
    const session = authed(t, ids.userId);
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["fixture"], { type: "image/png" }));
    });

    const upload = await session.mutation(api.receipts.recordUpload, {
      entityId: ids.entityId,
      kind: "receipt",
      storageId,
      fileName: "receipt-office-depot-2026-04-20-128.45.png",
      mimeType: "image/png",
      currency: "USD",
    });

    expect(upload).toMatchObject({
      status: "pending",
      matchedTransactionId: null,
      vendor: "Office Depot",
    });
    const openInbox = await t.run(async (ctx) => {
      return await ctx.db
        .query("inboxItems")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
    });
    expect(openInbox).toHaveLength(1);
    expect(openInbox[0]).toMatchObject({
      kind: "receipt",
      status: "open",
      documentId: upload.documentId,
      transactionId: ids.transactionId,
    });

    await session.mutation(api.receipts.manualMatch, {
      documentId: upload.documentId,
      transactionId: ids.transactionId,
    });
    await t.run(async (ctx) => {
      const document = await ctx.db.get(upload.documentId);
      const inboxItem = await ctx.db.get(openInbox[0]._id);
      expect(document).toMatchObject({
        matchedTransactionId: ids.transactionId,
        status: "matched",
      });
      expect(inboxItem).toMatchObject({
        status: "resolved",
        transactionId: ids.transactionId,
      });
    });
  });
});
