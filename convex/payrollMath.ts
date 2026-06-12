/**
 * Pure payroll FX/currency math. No Convex imports so it is trivially unit
 * testable. Money is always integer minor units; FX rates are integer
 * micro-units of local currency per 1 unit of base currency (e.g. 278 PKR per
 * USD is stored as 278_000_000). Floats never persist.
 */

export const FX_MICRO_SCALE = 1_000_000;

/**
 * Default FX rate (local-per-base, in micro-units) for a currency pair. These
 * mirror the demo seed's conversion factors so seeded historical runs read
 * back consistently. A real connector would supply live rates; here the rate
 * is prefilled and editable per line.
 */
const DEFAULT_LOCAL_PER_BASE: Record<string, number> = {
  PKR: 278,
  INR: 83,
};

export function defaultFxRateMicros(localCurrency: string, baseCurrency: string): number {
  if (localCurrency === baseCurrency) return FX_MICRO_SCALE;
  const rate = DEFAULT_LOCAL_PER_BASE[localCurrency];
  return rate ? rate * FX_MICRO_SCALE : FX_MICRO_SCALE;
}

/** final local = base salary + signed adjustment, both in local minor units. */
export function finalLocalMinor(baseSalaryMinor: number, adjustmentMinor: number): number {
  return baseSalaryMinor + adjustmentMinor;
}

/**
 * Convert a local minor-unit amount to base-currency minor units using an
 * integer micro-unit rate. baseMinor = round(localMinor / (rateMicros / 1e6)).
 * Returns 0 for a non-positive rate (guarded by callers/validators).
 */
export function baseEquivalentMinor(localMinor: number, fxRateMicros: number): number {
  if (fxRateMicros <= 0) return 0;
  return Math.round((localMinor * FX_MICRO_SCALE) / fxRateMicros);
}

/** Parse a human FX string ("278", "278.5", "1") into integer micro-units. */
export function parseFxRateToMicros(input: string | number): number {
  const value = typeof input === "number" ? input : Number(String(input).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("FX rate must be a positive number.");
  }
  return Math.round(value * FX_MICRO_SCALE);
}

/** Render an integer micro-unit rate back to a display string. */
export function formatFxRateMicros(fxRateMicros: number, baseCurrency: string, localCurrency: string): string {
  if (localCurrency === baseCurrency) return "—";
  const rate = fxRateMicros / FX_MICRO_SCALE;
  // Trim to at most 4 decimals, drop trailing zeros.
  return `${Number(rate.toFixed(4))}`;
}

export type RunLineComputed = {
  finalLocalMinor: number;
  baseEquivalentMinor: number;
};

export function computeRunLine(args: {
  baseSalaryMinor: number;
  adjustmentMinor: number;
  fxRateMicros: number;
}): RunLineComputed {
  const final = finalLocalMinor(args.baseSalaryMinor, args.adjustmentMinor);
  return {
    finalLocalMinor: final,
    baseEquivalentMinor: baseEquivalentMinor(final, args.fxRateMicros),
  };
}

/** Sum base-equivalent minor units across lines (the run's base total). */
export function runBaseTotalMinor(lines: Array<{ baseEquivalentMinor: number }>): number {
  return lines.reduce((sum, line) => sum + line.baseEquivalentMinor, 0);
}

/** Per-currency local totals for the footer (currency -> local minor units). */
export function currencyTotals(
  lines: Array<{ currency: string; finalLocalMinor: number; baseEquivalentMinor: number }>,
): Array<{ currency: string; localMinor: number; baseMinor: number }> {
  const map = new Map<string, { currency: string; localMinor: number; baseMinor: number }>();
  for (const line of lines) {
    const row = map.get(line.currency) ?? { currency: line.currency, localMinor: 0, baseMinor: 0 };
    row.localMinor += line.finalLocalMinor;
    row.baseMinor += line.baseEquivalentMinor;
    map.set(line.currency, row);
  }
  return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * Last calendar day of a "YYYY-MM" period, as an ISO date. Payroll posts on
 * this date (matches the demo's month-end posting and keeps a June run inside
 * June for period-lock checks).
 */
export function periodPostingDate(period: string): string {
  const [yearText, monthText] = period.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Payroll period must be YYYY-MM.");
  }
  // Day 0 of the next month is the last day of this month.
  const last = new Date(Date.UTC(year, month, 0));
  return last.toISOString().slice(0, 10);
}

/** Human label for a "YYYY-MM" period, e.g. "June 2026". */
export function periodLabel(period: string): string {
  const [yearText, monthText] = period.split("-");
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const index = Number(monthText) - 1;
  const name = monthNames[index] ?? monthText;
  return `${name} ${yearText}`;
}
