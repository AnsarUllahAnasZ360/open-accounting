/**
 * Portfolio money helper (Epic E5-T4).
 *
 * The general ledger is USD-only (decisions Q24/Q25), so the portfolio roll-up
 * is plain USD summation. There is NO FX engine, NO base-currency conversion,
 * and NO per-currency normalization here — `convertToBase`, `fxRate`, and
 * `resolveBaseCurrency` deliberately do not exist. USD is assumed everywhere.
 *
 * This is the ONLY money helper the portfolio read model (E5-T6) imports.
 */

/**
 * Sum integer minor-unit amounts. Operates purely on integers — no floats are
 * introduced, so stored financial amounts stay exact. Non-integer inputs throw
 * so a float never silently corrupts a total.
 */
export function sumUsdMinor(amounts: number[]): number {
  let total = 0;
  for (const amount of amounts) {
    if (!Number.isInteger(amount)) {
      throw new Error(`sumUsdMinor expects integer minor units, got ${amount}`);
    }
    total += amount;
  }
  return total;
}
