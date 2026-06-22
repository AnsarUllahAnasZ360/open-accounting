import { describe, expect, it } from "vitest";

import { buildProvenance, describeProvenance, type DecidedBy } from "./provenance";

describe("describeProvenance", () => {
  it("covers all seven decidedBy values with distinct labels", () => {
    expect(describeProvenance("transfer", "bank")).toBe("Matched a transfer");
    // match family distinguishes a Stripe payout from a generic record.
    expect(describeProvenance("match", "stripe")).toBe("Matched a Stripe payout");
    expect(describeProvenance("match", "bank")).toBe("Matched an existing record");
    expect(describeProvenance("rule", "bank")).toBe("Matched your rule");
    expect(describeProvenance("memory", "bank")).toBe("Same as before");
    expect(describeProvenance("embedding", "bank")).toBe("Looks like past charges");
    expect(describeProvenance("plaid_prior", "bank")).toBe("From your bank's category");
    expect(describeProvenance("ai", "bank")).toBe("AI suggestion");
    expect(describeProvenance("needs_review", "bank")).toBe("Needs review");
  });

  it("renders the manual-entry fallback for a manual-source row with no decision", () => {
    expect(describeProvenance(null, "manual")).toBe("Manual entry");
    expect(describeProvenance(undefined, "manual")).toBe("Manual entry");
  });

  it("falls back to needs-review for an unattributed bank/stripe row", () => {
    expect(describeProvenance(null, "bank")).toBe("Needs review");
    expect(describeProvenance(null, "stripe")).toBe("Needs review");
  });

  it("produces the count-aware sentence form for memory streaks", () => {
    expect(
      describeProvenance("memory", "bank", "auto", { count: 6, merchant: "AWS" }),
    ).toBe("Same as your last 6 AWS charges");
    // No merchant → still count-aware, just generic.
    expect(describeProvenance("memory", "bank", "auto", { count: 4 })).toBe(
      "Same as your last 4 charges",
    );
    // count of 1 is not a streak → singular phrasing with merchant.
    expect(
      describeProvenance("memory", "bank", "auto", { count: 1, merchant: "Notion" }),
    ).toBe("Same as the last time you saw Notion");
  });

  it("renders the AI percentage when confidence is present", () => {
    expect(describeProvenance("ai", "bank", "auto", { confidence: 0.92 })).toBe("AI 92%");
    // Already-percentage inputs are passed through unchanged.
    expect(describeProvenance("ai", "bank", "auto", { confidence: 82 })).toBe("AI 82%");
  });

  it("never returns the raw enum string", () => {
    const enumValues: DecidedBy[] = [
      "transfer",
      "match",
      "rule",
      "memory",
      "embedding",
      "plaid_prior",
      "ai",
      "needs_review",
    ];
    for (const value of enumValues) {
      const label = describeProvenance(value, "bank");
      // The label is a written phrase, never the bare lowercase enum token.
      expect(label).not.toBe(value);
      expect(label).not.toMatch(/^(transfer|match|rule|memory|embedding|plaid_prior|ai|needs_review)$/);
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("buildProvenance", () => {
  it("collapses plaid_prior to the imported kind and memory/embedding to memory", () => {
    expect(buildProvenance({ decidedBy: "plaid_prior", source: "bank" }).kind).toBe("imported");
    expect(buildProvenance({ decidedBy: "memory", source: "bank" }).kind).toBe("memory");
    expect(buildProvenance({ decidedBy: "embedding", source: "bank" }).kind).toBe("memory");
    expect(buildProvenance({ decidedBy: "transfer", source: "bank" }).kind).toBe("transfer");
    expect(buildProvenance({ decidedBy: "match", source: "stripe" }).kind).toBe("match");
  });

  it("only carries confidence for AI decisions", () => {
    expect(
      buildProvenance({ decidedBy: "ai", source: "bank", confidence: 0.91 }).confidence,
    ).toBe(0.91);
    // A non-AI decision never leaks a confidence number onto the chip.
    expect(
      buildProvenance({ decidedBy: "rule", source: "bank", confidence: 0.91 }).confidence,
    ).toBeNull();
  });

  it("carries the memory streak count onto the descriptor", () => {
    const prov = buildProvenance({
      decidedBy: "memory",
      source: "bank",
      merchant: "AWS",
      count: 6,
    });
    expect(prov.kind).toBe("memory");
    expect(prov.count).toBe(6);
    expect(prov.label).toBe("Same as your last 6 AWS charges");
  });

  it("falls back to the manual kind+label for an unattributed manual row", () => {
    const prov = buildProvenance({ decidedBy: null, source: "manual" });
    expect(prov.kind).toBe("manual");
    expect(prov.label).toBe("Manual entry");
  });
});
