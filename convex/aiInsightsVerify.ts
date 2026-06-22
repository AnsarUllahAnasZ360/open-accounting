/**
 * aiInsightsVerify — the pure numeric cross-check the insights AI layer runs over
 * every model finding (E8-T8). Kept in its own NON-"use node" module so it can be
 * imported by both the `"use node"` action (aiInsights.ts) and a plain vitest
 * without pulling the AI SDK into the test runtime.
 *
 * Contract: the AI narrative may only RESTATE numbers already present in the
 * section aggregate; it never sources figures. A finding citing a number absent
 * from the aggregate is dropped, and the action falls back to the deterministic
 * findings (derived purely from the aggregate) — so a fabricated value can never
 * reach the banner/observations.
 */

/**
 * The set of money/percent magnitudes a finding is allowed to mention, derived
 * purely from the aggregate. Money is stored in minor units, so we include both
 * the minor value and its major (÷100) display form.
 */
export function numericTokensFromAggregate(aggregate: { data: Record<string, unknown> }): Set<number> {
  const allowed = new Set<number>();
  const visit = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      const abs = Math.abs(Math.round(value));
      allowed.add(abs);
      // Minor-unit amounts are commonly cited in major units (÷100), rounded.
      allowed.add(Math.round(abs / 100));
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  };
  visit(aggregate.data);
  return allowed;
}

/**
 * A finding's numbers are "supported" when every multi-digit integer it mentions
 * matches a magnitude present in the aggregate (within ±1 to absorb rounding).
 * Single-digit numbers and 4-digit years are ignored — they are descriptive, not
 * claims about ledger amounts. Returns true when the finding cites no numbers.
 */
export function findingNumbersAreSupported(
  finding: { title: string; detail: string },
  allowed: Set<number>,
): boolean {
  const haystack = `${finding.title} ${finding.detail}`;
  const matches = haystack.match(/\d[\d,]*\.?\d*/g);
  if (!matches) return true;
  for (const raw of matches) {
    const numeric = Math.abs(Math.round(Number(raw.replace(/,/g, ""))));
    if (!Number.isFinite(numeric)) continue;
    // Ignore tiny numbers (counts/ordinals) and 4-digit years.
    if (numeric < 10) continue;
    if (numeric >= 1900 && numeric <= 2100) continue;
    const supported =
      allowed.has(numeric) || allowed.has(numeric - 1) || allowed.has(numeric + 1);
    if (!supported) return false;
  }
  return true;
}
