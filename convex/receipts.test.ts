import { describe, expect, it } from "vitest";

import {
  buildReceiptEmbeddingText,
  chooseBestReceiptEmbeddingMatch,
  cosineSimilarity,
  normalizeBedrockReceiptExtraction,
  extractReceiptMetadataFromFileName,
} from "./receipts";

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
});
