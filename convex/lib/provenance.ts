/**
 * E7-1 — the single, server-computed provenance vocabulary for a posted/queued
 * transaction decision. Every consumer (register chip, mobile card, detail
 * drawer, Inbox) renders the SAME label from this one place so the owner always
 * reads WHY a transaction landed where it did in identical words.
 *
 * This module is intentionally pure (no Convex imports) so it is unit-testable
 * and reusable from the eval/tests. The transactions query maps the raw
 * `decidedBy` enum (convex/schema.ts transactions.decidedBy) + `source` +
 * `review` into a {@link Provenance} descriptor; the UI never re-derives meaning
 * from the raw enum string ("Decided by ai").
 *
 * Copy is sentence-style and count-aware where a count is cheaply available
 * (decided: launch-sprint decisions.md Q36):
 *  - memory  → "Same as your last 6 AWS charges" (count = streak length)
 *  - rule    → "Matched your rule"
 *  - match   → "Matched a Stripe payout" (Stripe) / "Matched a transfer"
 * When no count is available the chip falls back to a one-word kind label.
 */

/** The decision-stage enum stored on a transaction (schema.ts transactions.decidedBy). */
export type DecidedBy =
  | "transfer"
  | "match"
  | "rule"
  | "memory"
  | "embedding"
  | "plaid_prior"
  | "ai"
  | "needs_review";

/** The transaction's ingestion source (schema.ts transactions.source). */
export type ProvenanceSource = "bank" | "stripe" | "manual";

/** The single normalized provenance kind every UI surface keys off. */
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
  /** Plain-English, sentence-style label written from the owner's side. */
  label: string;
  /** Model confidence (0–1) for AI decisions; null otherwise. */
  confidence: number | null;
  /** Memory-streak length / prior-decision count when cheap; null otherwise. */
  count: number | null;
};

/**
 * Map the raw decision stage to the normalized provenance kind. `plaid_prior`
 * collapses to `imported` (a bank-category import), `transfer`/`match` stay
 * distinct so the label can read "Matched a transfer" vs "Matched a Stripe
 * payout", and a missing `decidedBy` on a manual-source row reads as `manual`.
 */
function provenanceKind(
  decidedBy: DecidedBy | null | undefined,
  source: ProvenanceSource | null | undefined,
): ProvenanceKind {
  switch (decidedBy) {
    case "rule":
      return "rule";
    case "memory":
    case "embedding":
      // Semantic recall is "memory" from the owner's point of view — both mean
      // "we've seen this before". The label distinguishes streak vs lookalike.
      return "memory";
    case "match":
      return "match";
    case "transfer":
      return "transfer";
    case "plaid_prior":
      return "imported";
    case "ai":
      return "ai";
    case "needs_review":
      return "needs_review";
    default:
      // No decision stage recorded. A manual-source row is a manual entry; an
      // unattributed bank/stripe row is still awaiting a decision.
      return source === "manual" ? "manual" : "needs_review";
  }
}

/**
 * The canonical human label for a provenance decision. Count-aware and
 * sentence-style where a count is supplied (decided: decisions.md Q36), with a
 * one-word fallback when no count is available.
 *
 * @param decidedBy  the raw decision stage (schema enum)
 * @param source     the ingestion source (drives the manual fallback)
 * @param review     the review status (kept for parity with callers; manual fallback)
 * @param opts       optional count (memory streak / match family) + merchant +
 *                   confidence to build the richer sentence/percentage forms
 */
export function describeProvenance(
  decidedBy: DecidedBy | null | undefined,
  source?: ProvenanceSource | null,
  review?: string | null,
  opts?: { count?: number | null; merchant?: string | null; confidence?: number | null },
): string {
  const kind = provenanceKind(decidedBy, source);
  const count = opts?.count ?? null;
  const merchant = opts?.merchant?.trim() || null;
  const pct =
    opts?.confidence != null
      ? Math.round(opts.confidence <= 1 ? opts.confidence * 100 : opts.confidence)
      : null;

  switch (kind) {
    case "rule":
      return "Matched your rule";
    case "memory":
      if (count && count > 1) {
        return merchant
          ? `Same as your last ${count} ${merchant} charges`
          : `Same as your last ${count} charges`;
      }
      return decidedBy === "embedding"
        ? merchant
          ? `Looks like past ${merchant} charges`
          : "Looks like past charges"
        : merchant
          ? `Same as the last time you saw ${merchant}`
          : "Same as before";
    case "match":
      return source === "stripe" ? "Matched a Stripe payout" : "Matched an existing record";
    case "transfer":
      return "Matched a transfer";
    case "imported":
      return "From your bank's category";
    case "ai":
      return pct != null ? `AI ${pct}%` : "AI suggestion";
    case "needs_review":
      return "Needs review";
    case "manual":
      return "Manual entry";
  }
}

/**
 * Build the full {@link Provenance} descriptor the transactions query attaches
 * to every row. Additive — callers that only need the raw `decidedBy` are
 * unaffected.
 */
export function buildProvenance(args: {
  decidedBy: DecidedBy | null | undefined;
  source?: ProvenanceSource | null;
  review?: string | null;
  confidence?: number | null;
  count?: number | null;
  merchant?: string | null;
}): Provenance {
  const kind = provenanceKind(args.decidedBy, args.source);
  return {
    kind,
    label: describeProvenance(args.decidedBy, args.source, args.review, {
      count: args.count,
      merchant: args.merchant,
      confidence: args.confidence,
    }),
    confidence: kind === "ai" ? (args.confidence ?? null) : null,
    count: args.count ?? null,
  };
}
