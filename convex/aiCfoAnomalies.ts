import type { Doc, Id } from "./_generated/dataModel";
import { normalizeMerchantKey } from "./pipeline";

/**
 * AI CFO anomaly + duplicate detection (Epic E9-T9).
 *
 * Grounds the "what should I worry about" warnings the CFO engine needs but which
 * are non-trivial: possible DUPLICATE charges, amount SPIKES vs a baseline, and
 * NEW-LARGE vendors — all derived from the entity's transactions, with
 * low-false-positive design. This module is a PURE function over already-loaded,
 * already-authorized transactions; it never reads the db, never writes, and the
 * ledger posting path is untouched. All amounts are USD integer minor units.
 *
 * False-positive guardrails (decisions Q45):
 *   - IGNORE internal transfers + intercompany legs via the CANONICAL E1/E5 flag
 *     (`transferPairId` / `intercompanyPairId`) — never an interim heuristic.
 *   - IGNORE excluded transactions.
 *   - RESPECT recurring charges: a merchant that bills across ≥3 distinct months
 *     at a steady amount is a subscription, so a same-amount repeat is NOT a
 *     duplicate and its monthly amount is NOT a "spike".
 *   - Require a minimum amount threshold so the panel isn't noisy.
 */

export type AnomalyKind = "duplicate" | "spike" | "new_large_vendor";

export type CfoAnomalyCard = {
  key: string;
  kind: AnomalyKind;
  severity: "info" | "watch" | "warn";
  title: string;
  /** The figure the card is about (USD minor units, absolute). */
  metricMinor: number;
  /** The baseline/comparator (trailing median, prior charge…), or null. */
  comparatorMinor: number | null;
  /** Signed percentage delta where meaningful (spike), else null. */
  deltaPct: number | null;
  /** The offending transaction ids so the advisor + Ask-AI can drill to them. */
  txnIds: Id<"transactions">[];
};

// Tunables — conservative to keep false positives low.
const MIN_ABS_MINOR = 50_00; // ignore anything under $50
const DUPLICATE_WINDOW_DAYS = 3; // same counterparty + amount within ≤3 days
const SPIKE_MULTIPLIER = 3; // a charge > k× the merchant's trailing median
const NEW_VENDOR_MIN_MINOR = 500_00; // first-seen vendor charge ≥ $500
const RECURRING_MIN_MONTHS = 3; // merchant billing in ≥3 distinct months = recurring

function dayIndex(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00.000Z`) / 86_400_000);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

export function computeCfoAnomalies(input: {
  transactions: Doc<"transactions">[];
  asOf: string;
}): CfoAnomalyCard[] {
  // Consider only real spend transactions: posted/expense-side (negative amount),
  // not transfers/intercompany (canonical flag), not excluded.
  const spend = input.transactions.filter(
    (txn) =>
      txn.review !== "excluded" &&
      !txn.transferPairId &&
      !txn.intercompanyPairId &&
      txn.amountMinor < 0 &&
      Math.abs(txn.amountMinor) >= MIN_ABS_MINOR,
  );

  // Group by normalized merchant. Track distinct months to identify recurring
  // (subscription) merchants — those are excluded from duplicate + spike flags.
  const byMerchant = new Map<string, Doc<"transactions">[]>();
  for (const txn of spend) {
    const key = normalizeMerchantKey(txn.merchant);
    const bucket = byMerchant.get(key) ?? [];
    bucket.push(txn);
    byMerchant.set(key, bucket);
  }
  const recurringMerchants = new Set<string>();
  for (const [key, txns] of byMerchant.entries()) {
    const months = new Set(txns.map((txn) => txn.date.slice(0, 7)));
    if (months.size >= RECURRING_MIN_MONTHS) recurringMerchants.add(key);
  }

  const cards: CfoAnomalyCard[] = [];

  // ---- (a) Duplicate candidates: same merchant + same amount within the window.
  for (const [key, txns] of byMerchant.entries()) {
    if (recurringMerchants.has(key)) continue; // a subscription repeat is expected
    const byAmount = new Map<number, Doc<"transactions">[]>();
    for (const txn of txns) {
      const bucket = byAmount.get(txn.amountMinor) ?? [];
      bucket.push(txn);
      byAmount.set(txn.amountMinor, bucket);
    }
    for (const [amountMinor, group] of byAmount.entries()) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
      for (let i = 1; i < sorted.length; i += 1) {
        const gapDays = dayIndex(sorted[i].date) - dayIndex(sorted[i - 1].date);
        if (gapDays <= DUPLICATE_WINDOW_DAYS) {
          cards.push({
            key: `anomaly:duplicate:${sorted[i - 1]._id}:${sorted[i]._id}`,
            kind: "duplicate",
            severity: "warn",
            title: `Possible duplicate: ${sorted[i].merchant} charged ${Math.round(Math.abs(amountMinor) / 100).toLocaleString()} twice within ${gapDays} day${gapDays === 1 ? "" : "s"}`,
            metricMinor: Math.abs(amountMinor),
            comparatorMinor: Math.abs(amountMinor),
            deltaPct: null,
            txnIds: [sorted[i - 1]._id, sorted[i]._id],
          });
        }
      }
    }
  }

  // ---- (b) Amount spikes: a single charge > k× the merchant's trailing median.
  for (const [key, txns] of byMerchant.entries()) {
    if (recurringMerchants.has(key)) continue; // steady subscription, not a spike
    if (txns.length < 3) continue; // need a baseline
    const amounts = txns.map((txn) => Math.abs(txn.amountMinor));
    const baseMedian = median(amounts);
    if (baseMedian <= 0) continue;
    for (const txn of txns) {
      const amount = Math.abs(txn.amountMinor);
      if (amount >= baseMedian * SPIKE_MULTIPLIER && amount - baseMedian >= MIN_ABS_MINOR) {
        cards.push({
          key: `anomaly:spike:${txn._id}`,
          kind: "spike",
          severity: "watch",
          title: `${txn.merchant} charge of ${Math.round(amount / 100).toLocaleString()} is ${Math.round(amount / baseMedian)}× its usual`,
          metricMinor: amount,
          comparatorMinor: baseMedian,
          deltaPct: Math.round(((amount - baseMedian) / baseMedian) * 100),
          txnIds: [txn._id],
        });
      }
    }
  }

  // ---- (c) New-large-vendor: a merchant that first appears with a large charge.
  // "First seen" = a merchant with a single transaction overall (no prior
  // history) whose charge clears the new-vendor threshold.
  for (const [, txns] of byMerchant.entries()) {
    if (txns.length !== 1) continue;
    const txn = txns[0];
    const amount = Math.abs(txn.amountMinor);
    if (amount >= NEW_VENDOR_MIN_MINOR) {
      cards.push({
        key: `anomaly:new_vendor:${txn._id}`,
        kind: "new_large_vendor",
        severity: "watch",
        title: `New vendor ${txn.merchant} with a ${Math.round(amount / 100).toLocaleString()} charge`,
        metricMinor: amount,
        comparatorMinor: null,
        deltaPct: null,
        txnIds: [txn._id],
      });
    }
  }

  // Strongest first; cap so the panel stays quiet.
  const severityRank = { warn: 0, watch: 1, info: 2 } as const;
  cards.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.metricMinor - a.metricMinor);
  return cards.slice(0, 8);
}
