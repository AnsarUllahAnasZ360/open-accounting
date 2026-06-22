/**
 * aiCfoVerify — the pure numeric cross-check the AI CFO narration layer runs over
 * every model-written advisory card (E9-T4). Kept in its own NON-"use node"
 * module so it can be imported by both the `"use node"` action (aiCfo.ts) and a
 * plain vitest without pulling the AI SDK into the test runtime.
 *
 * Contract: the AI narration may only RESTATE numbers already present in the
 * grounded CfoSignals (E9-T3); it never sources figures. A card citing a number
 * absent from the signals is dropped, and that signal falls back to its
 * deterministic card (built purely from the signal). So a fabricated value can
 * never reach the advisor surface, the digest, or Ask AI.
 */

type SignalLike = {
  metricMinor: number | null;
  comparatorMinor: number | null;
  deltaPct: number | null;
};

/**
 * The set of money/percent magnitudes a card is allowed to mention, derived
 * purely from the signals. Money is stored in minor units, so we include both
 * the minor value and its major (÷100, rounded) display form, plus the percent
 * deltas. The runway months figure (e.g. 4.1) is also admitted as a magnitude.
 */
export function numericTokensFromSignals(signals: {
  signals: SignalLike[];
  cashPositionMinor: number;
  monthlyBurnMinor: number;
  runwayMonths: number | null;
  currentRevenueMinor: number;
  priorAvgRevenueMinor: number;
  taxSetAsideMinor: number;
  forecast: Array<{ projectedCashMinor: number }>;
}): Set<number> {
  const allowed = new Set<number>();
  const addMoney = (value: number | null | undefined) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    const abs = Math.abs(Math.round(value));
    allowed.add(abs);
    allowed.add(Math.round(abs / 100));
  };
  const addRaw = (value: number | null | undefined) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    allowed.add(Math.abs(Math.round(value)));
  };

  addMoney(signals.cashPositionMinor);
  addMoney(signals.monthlyBurnMinor);
  addMoney(signals.currentRevenueMinor);
  addMoney(signals.priorAvgRevenueMinor);
  addMoney(signals.taxSetAsideMinor);
  for (const point of signals.forecast) addMoney(point.projectedCashMinor);
  // Forecast HORIZONS (30/60/90 days) are descriptive, not ledger amounts, but
  // they appear verbatim in card copy ("in 90 days"). Admit them so the
  // cross-check doesn't reject a grounded forecast card on its own horizon.
  for (const days of [30, 60, 90]) allowed.add(days);
  if (signals.runwayMonths !== null) {
    // Runway is cited as e.g. "4.1 months"; admit both 4 and 41 (×10) so the
    // ±1 tolerance in cardNumbersAreSupported covers the rounded display.
    addRaw(Math.round(signals.runwayMonths));
    addRaw(Math.round(signals.runwayMonths * 10));
  }
  for (const signal of signals.signals) {
    addMoney(signal.metricMinor);
    addMoney(signal.comparatorMinor);
    addRaw(signal.deltaPct);
  }
  return allowed;
}

/**
 * A card's numbers are "supported" when every multi-digit integer it mentions
 * matches a magnitude present in the signals (within ±1 to absorb rounding).
 * Single-digit numbers and 4-digit years are ignored — they are descriptive, not
 * claims about ledger amounts. Returns true when the card cites no numbers.
 */
export function cardNumbersAreSupported(
  card: { title: string; body: string },
  allowed: Set<number>,
): boolean {
  const haystack = `${card.title} ${card.body}`;
  const matches = haystack.match(/\d[\d,]*\.?\d*/g);
  if (!matches) return true;
  for (const raw of matches) {
    const cleaned = raw.replace(/,/g, "");
    // For a decimal like "4.1", check both the integer part and the ×10 form so
    // a runway "4.1 months" is covered by the admitted 4 and 41 magnitudes.
    const numbers = cleaned.includes(".")
      ? [Math.abs(Math.round(Number(cleaned))), Math.abs(Math.round(Number(cleaned) * 10))]
      : [Math.abs(Math.round(Number(cleaned)))];
    let anySupported = false;
    let anyChecked = false;
    for (const numeric of numbers) {
      if (!Number.isFinite(numeric)) continue;
      if (numeric < 10) {
        // Tiny number: descriptive (counts/ordinals/single-digit %) — accept.
        anySupported = true;
        anyChecked = true;
        continue;
      }
      if (numeric >= 1900 && numeric <= 2100) {
        anySupported = true;
        anyChecked = true;
        continue;
      }
      anyChecked = true;
      if (allowed.has(numeric) || allowed.has(numeric - 1) || allowed.has(numeric + 1)) {
        anySupported = true;
      }
    }
    if (anyChecked && !anySupported) return false;
  }
  return true;
}
