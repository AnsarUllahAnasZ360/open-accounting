/**
 * Report period math. The cardinal rule: a default report period must NEVER
 * extend past "today" — the demo books run through June 2026 and the previous
 * build shipped a Monthly Review labelled December 2026 because the default
 * range spanned the whole calendar year. Every preset here is clamped to the
 * current date, and the default range for each report is chosen to be sensible
 * (current month / month-to-date / trailing 12).
 *
 * All functions are pure and take an explicit `today` (ISO YYYY-MM-DD) so they
 * are deterministic and unit testable. The app passes the real current date.
 */

export type ReportPresetId =
  | "thisMonth"
  | "lastMonth"
  | "thisQuarter"
  | "ytd"
  | "last12"
  | "custom";

export type DateRange = { startDate: string; endDate: string };

export const REPORT_PRESETS: Array<{ id: ReportPresetId; label: string }> = [
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "thisQuarter", label: "This quarter" },
  { id: "ytd", label: "Year to date" },
  { id: "last12", label: "Last 12 months" },
  { id: "custom", label: "Custom" },
];

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function iso(year: number, month1: number, day: number) {
  return `${year}-${pad2(month1)}-${pad2(day)}`;
}

function lastDayOfMonth(year: number, month1: number) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function parse(today: string) {
  const [y, m, d] = today.split("-").map(Number);
  if (!y || !m || !d) throw new Error("today must be ISO YYYY-MM-DD");
  return { year: y, month: m, day: d };
}

/** First day of the month containing `today`. */
export function startOfMonth(today: string): string {
  const { year, month } = parse(today);
  return iso(year, month, 1);
}

/** The current calendar month with the END clamped to today (month-to-date). */
export function thisMonthRange(today: string): DateRange {
  const { year, month } = parse(today);
  return { startDate: iso(year, month, 1), endDate: today };
}

/** The full previous calendar month (always entirely in the past). */
export function lastMonthRange(today: string): DateRange {
  const { year, month } = parse(today);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return {
    startDate: iso(prevYear, prevMonth, 1),
    endDate: iso(prevYear, prevMonth, lastDayOfMonth(prevYear, prevMonth)),
  };
}

/** Current quarter, end clamped to today. */
export function thisQuarterRange(today: string): DateRange {
  const { year, month } = parse(today);
  const quarterStartMonth = month - ((month - 1) % 3);
  return { startDate: iso(year, quarterStartMonth, 1), endDate: today };
}

/** Calendar year to date (Jan 1 → today). */
export function ytdRange(today: string): DateRange {
  const { year } = parse(today);
  return { startDate: iso(year, 1, 1), endDate: today };
}

/**
 * Trailing 12 months ending today: from the 1st of the month 11 months back
 * through today. Never future.
 */
export function last12Range(today: string): DateRange {
  const { year, month } = parse(today);
  // 11 months before the current month.
  const totalMonths = (year * 12 + (month - 1)) - 11;
  const startYear = Math.floor(totalMonths / 12);
  const startMonth = (totalMonths % 12) + 1;
  return { startDate: iso(startYear, startMonth, 1), endDate: today };
}

/** Resolve a preset id to a concrete range, clamped so endDate <= today. */
export function rangeForPreset(preset: ReportPresetId, today: string, existing?: DateRange): DateRange {
  let range: DateRange;
  switch (preset) {
    case "thisMonth":
      range = thisMonthRange(today);
      break;
    case "lastMonth":
      range = lastMonthRange(today);
      break;
    case "thisQuarter":
      range = thisQuarterRange(today);
      break;
    case "ytd":
      range = ytdRange(today);
      break;
    case "last12":
      range = last12Range(today);
      break;
    case "custom":
      range = existing ?? thisMonthRange(today);
      break;
  }
  return clampRange(range, today);
}

/** Clamp a range so its end never exceeds today and start never exceeds end. */
export function clampRange(range: DateRange, today: string): DateRange {
  const endDate = range.endDate > today ? today : range.endDate;
  const startDate = range.startDate > endDate ? endDate : range.startDate;
  return { startDate, endDate };
}

/**
 * The default preset + range for a given report id. Statements / GL / journal
 * default to "this month" (month-to-date); concentration/insight reports that
 * read better over a year default to YTD; aging + balance sheet are as-of today
 * (a wide trailing window so all open items show). None ever returns a future
 * end date because every branch derives from `today`.
 */
export function defaultPresetForReport(reportId: string): ReportPresetId {
  switch (reportId) {
    case "monthly-review":
      return "lastMonth"; // most recent FULL month tells the cleanest story
    case "income-by-customer":
    case "payroll-summary":
      return "ytd";
    case "balance-sheet":
    case "trial-balance":
    case "ar-aging":
    case "ap-aging":
      return "ytd"; // as-of today; start far enough back to include all opens
    case "general-ledger":
    case "journal":
    case "profit-and-loss":
    case "cash-flow":
    case "expenses":
    default:
      return "thisMonth";
  }
}

export function defaultRangeForReport(reportId: string, today: string): { preset: ReportPresetId; range: DateRange } {
  const preset = defaultPresetForReport(reportId);
  return { preset, range: rangeForPreset(preset, today) };
}

/** Human label for a range, e.g. "Jun 1 – Jun 11, 2026" or "May 2026". */
export function formatRangeLabel(range: DateRange): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const [sy, sm, sd] = range.startDate.split("-").map(Number);
  const [ey, em, ed] = range.endDate.split("-").map(Number);
  if (sy === ey && sm === em) {
    // Whole single month?
    if (sd === 1 && ed === lastDayOfMonth(ey, em)) return `${months[em - 1]} ${ey}`;
    return `${months[sm - 1]} ${sd} – ${ed}, ${ey}`;
  }
  if (sy === ey) return `${months[sm - 1]} ${sd} – ${months[em - 1]} ${ed}, ${ey}`;
  return `${months[sm - 1]} ${sd}, ${sy} – ${months[em - 1]} ${ed}, ${ey}`;
}

/**
 * Resolve a dashboard `period=YYYY-MM` param to a concrete calendar-month range,
 * clamped so the end never exceeds today. Dashboard drill-throughs carry the
 * selected month as `period=`; Reports maps it to start/end so the viewer opens
 * on that exact month instead of the report's own default.
 */
export function rangeForPeriodParam(period: string, today: string): DateRange | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || month < 1 || month > 12) return null;
  return clampRange(
    { startDate: iso(year, month, 1), endDate: iso(year, month, lastDayOfMonth(year, month)) },
    today,
  );
}

/**
 * The most recent FULL calendar month relative to `today` — the period a
 * "Close the books" action targets. Returns the month range plus its last day
 * (the lockedThroughDate) and a human label.
 */
export function lastFullMonth(today: string): { range: DateRange; lockThroughDate: string; label: string } {
  const range = lastMonthRange(today);
  return {
    range,
    lockThroughDate: range.endDate,
    label: formatRangeLabel(range),
  };
}

/** Label for the as-of date (balance sheet / aging / trial balance). */
export function formatAsOfLabel(date: string): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const [y, m, d] = date.split("-").map(Number);
  return `${months[m - 1]} ${d}, ${y}`;
}
