/**
 * E7-2 — pure label/type seam for {@link ProvenanceChip}. Kept free of React and
 * `@/` UI imports so the repo's edge-runtime vitest (no jsdom) can render-smoke
 * the chip's display logic directly, mirroring the page-insights.ts pattern.
 */

/** Mirrors the server `provenance.kind` union (convex/lib/provenance.ts). */
export type ProvenanceKind =
  | "rule"
  | "memory"
  | "match"
  | "transfer"
  | "imported"
  | "ai"
  | "needs_review"
  | "manual";

export type Provenance = {
  kind: ProvenanceKind;
  label: string;
  confidence: number | null;
  count: number | null;
};

/** One-word fallback per kind when the server supplies no sentence-style label. */
export const PROVENANCE_FALLBACK_LABEL: Record<Exclude<ProvenanceKind, "ai">, string> = {
  rule: "Rule",
  memory: "Memory",
  match: "Matched",
  transfer: "Transfer",
  imported: "Imported",
  needs_review: "Needs review",
  manual: "Manual",
};

/**
 * The label the chip renders for a given provenance — the sentence-style server
 * label when present, else the one-word fallback per kind. For AI rows with no
 * label, derive an "AI N%" string from confidence.
 */
export function provenanceChipLabel(provenance: Provenance): string {
  if (provenance.kind === "ai") {
    if (provenance.label?.trim()) return provenance.label.trim();
    const pct =
      provenance.confidence != null
        ? Math.round(provenance.confidence <= 1 ? provenance.confidence * 100 : provenance.confidence)
        : null;
    return pct != null ? `AI ${pct}%` : "AI";
  }
  return provenance.label?.trim() || PROVENANCE_FALLBACK_LABEL[provenance.kind];
}
