/**
 * E7-7 — pure split-balance validation seam for the transaction detail drawer.
 * Kept free of React / UI imports so the repo's edge-runtime vitest can exercise
 * the "two parts must sum to the original" rule directly (mirroring
 * provenance-chip-label.ts). Money is integer minor units throughout — never
 * floats for the stored comparison; the only float touch is parsing the user's
 * decimal text input, immediately rounded to minor units.
 */

export type SplitBalance = {
  /** Parsed minor-unit value of the first part (NaN when the field is empty/invalid). */
  firstMinor: number;
  /** Parsed minor-unit value of the second part (NaN when the field is empty/invalid). */
  secondMinor: number;
  /** Sum of both parts, or NaN when either is invalid. */
  sumMinor: number;
  /** Original transaction amount in absolute minor units (the target the parts must hit). */
  originalMinor: number;
  /** True only when both parts parse and sum EXACTLY to the original. */
  balanced: boolean;
  /**
   * Signed minor-unit gap to the target: positive = still to allocate,
   * negative = over-allocated. Falls back to the full original when a field is
   * unparseable so the hint reads sensibly before the user types.
   */
  remainderMinor: number;
};

/**
 * Parse a decimal-money text field to integer minor units. Returns NaN for an
 * empty/whitespace field (Number("") is 0, which we explicitly reject so an empty
 * split part never reads as a valid $0.00) or any non-numeric input.
 */
export function parseMoneyToMinor(value: string): number {
  if (value.trim() === "") return NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : NaN;
}

/**
 * Compute whether a two-way split balances against the original absolute amount.
 * The drawer disables Post split and shows a hint until `balanced` is true so an
 * unbalanced repost is never attempted (the ledger would reject it anyway).
 */
export function evaluateSplitBalance(
  firstAmount: string,
  secondAmount: string,
  originalAmountMinor: number,
): SplitBalance {
  const originalMinor = Math.abs(originalAmountMinor);
  const firstMinor = parseMoneyToMinor(firstAmount);
  const secondMinor = parseMoneyToMinor(secondAmount);
  const sumMinor =
    Number.isNaN(firstMinor) || Number.isNaN(secondMinor) ? NaN : firstMinor + secondMinor;
  const balanced = sumMinor === originalMinor;
  const remainderMinor = Number.isNaN(sumMinor) ? originalMinor : originalMinor - sumMinor;
  return { firstMinor, secondMinor, sumMinor, originalMinor, balanced, remainderMinor };
}
