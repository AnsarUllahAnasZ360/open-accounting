import { useMemo } from "react";

/**
 * The single source of truth for the "today" anchor that every insights /
 * aging / overdue / "this month" / "previous period" window resolves against.
 *
 * Contract (decided: launch-sprint decisions.md Q40):
 *  - Front-end DISPLAY uses the browser clock via {@link useTodayIso} /
 *    {@link todayIso}.
 *  - The server `asOf` is threaded into `coreViews` queries (E8-T2) so query
 *    bodies stay deterministic — do NOT call `new Date()` inside a Convex query.
 *  - This module OWNS the canonical helper. E7-10 and E9-T2 import it; do not
 *    introduce a second date helper.
 *
 * A single optional override (NEXT_PUBLIC_OPENBOOKS_TODAY) lets the
 * fixture-based e2e pin a known date when it needs a deterministic window;
 * the default is always the real clock.
 */

function readOverride(): string | undefined {
  // NEXT_PUBLIC_ vars are inlined at build time; guard for non-browser/test envs.
  const value =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_OPENBOOKS_TODAY : undefined;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return undefined;
}

/**
 * The current date as an ISO `YYYY-MM-DD` string from the real clock (or the
 * NEXT_PUBLIC_OPENBOOKS_TODAY override). Plain function form — mirrors
 * ReportsScreen.tsx's `todayIso()` for non-component callers.
 */
export function todayIso(): string {
  return readOverride() ?? new Date().toISOString().slice(0, 10);
}

/**
 * Memoized per render so the returned string identity is stable across a single
 * render pass — keeping `resolveScope` inputs from churning React identity and
 * triggering re-render loops. The memo deps are empty: within one render the
 * clock value is fixed, and a re-render naturally re-reads the clock.
 */
export function useTodayIso(): string {
  return useMemo(() => todayIso(), []);
}

/**
 * Shift an ISO date by a number of days, returning a new `YYYY-MM-DD` string.
 * Used to derive relative anchors (e.g. the dormant cutoff = anchor − 90 days)
 * from the canonical `today` without re-implementing date math per call site.
 */
export function isoDaysAgo(anchorIso: string, days: number): string {
  const ms = Date.parse(`${anchorIso}T00:00:00Z`);
  return new Date(ms - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
