// Scope + comparison resolution for the Insights system. One scope object (an
// active range + a "compare to" mode) governs the whole panel. These helpers
// resolve a DateRangeValue and a CompareMode into concrete ISO calendar bounds
// for BOTH the active window and its comparison window, plus human labels — so
// the scope bar can always render the resolved dates ("Jun 1–30, 2026 vs
// May 1–31, 2026"), never just a preset name.
//
// Pure date math from explicit ISO components (no `new Date()` on raw strings
// beyond UTC parsing) so it matches the backend's deterministic windowing.

import {
  dateRangeValueToISO,
  type DateRangeValue,
} from "../DateRangeControl";

export type CompareMode = "previous-period" | "previous-year" | "none";

export type ResolvedRange = { from: string; to: string };

export type ResolvedScope = {
  /** Active window ISO bounds. */
  active: ResolvedRange;
  /** Comparison window ISO bounds, or null when compare is off. */
  compare: ResolvedRange | null;
  /** "Jun 1 – 30, 2026" */
  activeLabel: string;
  /** "May 1 – 31, 2026" or null. */
  compareLabel: string | null;
  /** "Previous period" / "Previous year" — the named comparison frame. */
  compareFrameLabel: string | null;
};

const DAY_MS = 86_400_000;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function isoToUtc(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, (month ?? 1) - 1, day ?? 1);
}

function utcToIso(ms: number) {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** "2026-06-30" -> { y:2026, m:6, d:30 } */
function parts(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

/**
 * Human label for an ISO range. Collapses a same-month range to
 * "Jun 1 – 30, 2026" and a cross-month range to "May 15 – Jun 14, 2026".
 */
export function formatResolvedRange(range: ResolvedRange): string {
  const from = parts(range.from);
  const to = parts(range.to);
  const fromMonth = MONTHS[from.month - 1];
  const toMonth = MONTHS[to.month - 1];
  if (from.year === to.year && from.month === to.month) {
    return `${fromMonth} ${from.day} – ${to.day}, ${to.year}`;
  }
  if (from.year === to.year) {
    return `${fromMonth} ${from.day} – ${toMonth} ${to.day}, ${to.year}`;
  }
  return `${fromMonth} ${from.day}, ${from.year} – ${toMonth} ${to.day}, ${to.year}`;
}

/**
 * The comparison window for an active range.
 * - previous-period: the immediately preceding window of equal length (the same
 *   rule the backend uses for prev-period net change).
 * - previous-year: the same calendar window shifted back one year.
 */
function resolveCompare(active: ResolvedRange, mode: CompareMode): ResolvedRange | null {
  if (mode === "none") return null;
  const fromMs = isoToUtc(active.from);
  const toMs = isoToUtc(active.to);
  if (mode === "previous-year") {
    const from = parts(active.from);
    const to = parts(active.to);
    return {
      from: `${from.year - 1}-${String(from.month).padStart(2, "0")}-${String(from.day).padStart(2, "0")}`,
      to: `${to.year - 1}-${String(to.month).padStart(2, "0")}-${String(to.day).padStart(2, "0")}`,
    };
  }
  // previous-period: the window of equal length ending the day before `from`.
  const prevToMs = fromMs - DAY_MS;
  const prevFromMs = prevToMs - (toMs - fromMs);
  return { from: utcToIso(prevFromMs), to: utcToIso(prevToMs) };
}

export const COMPARE_FRAME_LABELS: Record<CompareMode, string | null> = {
  "previous-period": "previous period",
  "previous-year": "previous year",
  none: null,
};

/**
 * Resolve a period value + compare mode into the full scope the panel renders
 * from. `todayISO` anchors relative presets ("this month", "YTD") so the result
 * is deterministic (no implicit `Date.now()` in render).
 */
export function resolveScope(
  range: DateRangeValue,
  compareMode: CompareMode,
  todayISO: string,
): ResolvedScope {
  const active = dateRangeValueToISO(range, todayISO);
  const compare = resolveCompare(active, compareMode);
  return {
    active,
    compare,
    activeLabel: formatResolvedRange(active),
    compareLabel: compare ? formatResolvedRange(compare) : null,
    compareFrameLabel: COMPARE_FRAME_LABELS[compareMode],
  };
}

/**
 * Percentage delta of `current` vs `previous`, guarded against the divide-by-zero
 * / no-history case so the KPI card never renders "+∞%" or "NaN". Returns null
 * when there is no usable comparison base (the caller then suppresses the delta).
 */
export function safeDeltaPct(current: number, previous: number | null | undefined): number | null {
  if (previous == null || previous === 0) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.round(pct);
}
