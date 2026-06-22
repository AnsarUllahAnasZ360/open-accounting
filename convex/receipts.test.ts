/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import {
  extractReceiptMetadataFromFileName,
  extractPdfTextFromBytes,
  normalizeBedrockReceiptExtraction,
  normalizePdfReceiptTextExtraction,
  renderPdfTextPageToPngBase64,
} from "./receipts";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const createExpenseFromReceipt = makeFunctionReference<
  "mutation",
  { documentId: string; categoryAccountId?: string },
  {
    status: "created" | "duplicate";
    transactionId: string;
    entryId: string | null;
    documentId: string;
  }
>("receipts:createExpenseFromReceipt");

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

  it("renders extracted PDF first-page text into a PNG raster for vision models", () => {
    const raster = renderPdfTextPageToPngBase64([
      "Vendor: Office Depot",
      "Date: 2026-04-14",
      "Total: $87.19",
    ].join("\n"));

    expect(raster).toBeTruthy();
    expect(raster!.width).toBeGreaterThan(300);
    expect(raster!.height).toBeGreaterThan(100);
    expect(raster!.lineCount).toBe(4);
    expect(raster!.base64.startsWith("iVBORw0KGgo")).toBe(true);
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

  it("creates a balanced manual expense from an unmatched receipt", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupReceiptEmbeddingBackend(t);
    const session = authed(t, ids.userId);
    const { bankAccountId, categoryAccountId } = await t.run(async (ctx) => {
      const now = Date.now();
      const operatingAccountId = await ctx.db.insert("ledgerAccounts", {
        entityId: ids.entityId,
        name: "Operating Checking",
        type: "asset",
        subtype: "bank",
        number: "1010",
        currency: "USD",
        isSystem: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      const categoryAccountId = await ctx.db.insert("ledgerAccounts", {
        entityId: ids.entityId,
        name: "Office Supplies",
        type: "expense",
        subtype: "office",
        number: "5300",
        currency: "USD",
        isSystem: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      const bankAccountId = await ctx.db.insert("bankAccounts", {
        entityId: ids.entityId,
        ledgerAccountId: operatingAccountId,
        name: "Operating Checking",
        mask: "1001",
        kind: "checking",
        balanceMinor: 0,
        includeInSync: false,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("inboxItems", {
        entityId: ids.entityId,
        documentId: ids.documentId,
        kind: "receipt",
        payloadSummary: "Receipt needs an expense.",
        status: "open",
        createdAt: now,
        updatedAt: now,
      });
      return { bankAccountId, categoryAccountId };
    });

    const result = await session.mutation(createExpenseFromReceipt, {
      documentId: ids.documentId,
      categoryAccountId,
    });

    expect(result).toMatchObject({
      status: "created",
      documentId: ids.documentId,
      entryId: expect.any(String),
    });
    await t.run(async (ctx) => {
      const document = await ctx.db.get(ids.documentId);
      expect(document).toMatchObject({
        status: "matched",
        matchedTransactionId: result.transactionId,
      });
      const transaction = await ctx.db.get(result.transactionId as never);
      expect(transaction).toMatchObject({
        entityId: ids.entityId,
        bankAccountId,
        amountMinor: -12845,
        categoryAccountId,
        entryId: result.entryId,
        source: "manual",
        decidedBy: "rule",
      });
      const lines = await ctx.db
        .query("journalLines")
        .withIndex("by_entry", (q) => q.eq("entryId", result.entryId as never))
        .collect();
      const debitTotal = lines.reduce((sum, line) => sum + line.debitMinor, 0);
      const creditTotal = lines.reduce((sum, line) => sum + line.creditMinor, 0);
      expect(debitTotal).toBe(creditTotal);
      expect(debitTotal).toBe(12845);
      const openReceiptInbox = (await ctx.db
        .query("inboxItems")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect())
        .filter((item) => item.kind === "receipt" && item.documentId === ids.documentId && item.status === "open");
      expect(openReceiptInbox).toHaveLength(0);
    });
  });
});
