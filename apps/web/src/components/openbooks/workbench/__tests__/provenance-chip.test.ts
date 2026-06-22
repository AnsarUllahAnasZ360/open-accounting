import { describe, expect, it } from "vitest";

import {
  provenanceChipLabel,
  type Provenance,
  type ProvenanceKind,
} from "../provenance-chip-label";

// The repo's vitest runs on the edge runtime (no jsdom), so this is a render
// smoke at the label-resolution seam the chip uses: every provenance kind
// resolves to a distinct, non-empty label (E7-2 DoD: each kind renders its
// label). The component itself only wraps this string in a Badge/Tooltip.
function prov(partial: Partial<Provenance> & { kind: ProvenanceKind }): Provenance {
  return { label: "", confidence: null, count: null, ...partial };
}

describe("ProvenanceChip / provenanceChipLabel", () => {
  it("renders a distinct one-word fallback for every non-AI kind", () => {
    const fallbacks: Record<Exclude<ProvenanceKind, "ai">, string> = {
      rule: "Rule",
      memory: "Memory",
      match: "Matched",
      transfer: "Transfer",
      imported: "Imported",
      needs_review: "Needs review",
      manual: "Manual",
    };
    for (const [kind, label] of Object.entries(fallbacks)) {
      expect(provenanceChipLabel(prov({ kind: kind as ProvenanceKind }))).toBe(label);
    }
  });

  it("prefers the sentence-style server label over the fallback", () => {
    expect(
      provenanceChipLabel(prov({ kind: "memory", label: "Same as your last 6 AWS charges" })),
    ).toBe("Same as your last 6 AWS charges");
    expect(provenanceChipLabel(prov({ kind: "rule", label: "Matched your rule" }))).toBe(
      "Matched your rule",
    );
    expect(
      provenanceChipLabel(prov({ kind: "match", label: "Matched a Stripe payout" })),
    ).toBe("Matched a Stripe payout");
  });

  it("renders an AI percentage from confidence when no label is present", () => {
    expect(provenanceChipLabel(prov({ kind: "ai", confidence: 0.92 }))).toBe("AI 92%");
    expect(provenanceChipLabel(prov({ kind: "ai", confidence: null }))).toBe("AI");
    // A server-provided AI label still wins.
    expect(provenanceChipLabel(prov({ kind: "ai", label: "AI 82%", confidence: 0.82 }))).toBe(
      "AI 82%",
    );
  });

  it("never renders an empty chip label for any kind", () => {
    const kinds: ProvenanceKind[] = [
      "rule",
      "memory",
      "match",
      "transfer",
      "imported",
      "ai",
      "needs_review",
      "manual",
    ];
    for (const kind of kinds) {
      expect(provenanceChipLabel(prov({ kind })).length).toBeGreaterThan(0);
    }
  });
});
