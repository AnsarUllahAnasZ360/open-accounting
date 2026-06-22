import { describe, expect, it } from "vitest";

import {
  REPORT_PRESETS,
  clampRange,
  defaultRangeForReport,
  rangeForPreset,
  rangeForPeriodParam,
  type ReportPresetId,
} from "../report-periods";

// E6-T6: lock the never-future guarantee. The previous build shipped a Monthly
// Review labelled December 2026 because a default range spanned the whole year;
// these assertions make a future endDate impossible across every preset, every
// report default, and the dashboard period param — for many "today" inputs,
// including the year-boundary edge cases (Jan 1 and Dec 31).

const TODAYS = [
  "2026-06-20", // mid-year, mid-month
  "2026-01-01", // year start (first day)
  "2026-12-31", // year end (last day)
  "2026-02-15", // short month
  "2024-02-29", // leap day
  "2026-03-01", // quarter boundary
  "2025-11-07",
];

const PRESET_IDS: ReportPresetId[] = REPORT_PRESETS.map((preset) => preset.id);

const REPORT_IDS = [
  "monthly-review",
  "profit-and-loss",
  "balance-sheet",
  "cash-flow",
  "ar-aging",
  "ap-aging",
  "expenses",
  "income-by-customer",
  "payroll-summary",
  "general-ledger",
  "trial-balance",
  "journal",
];

describe("report-periods never-future guarantee", () => {
  it("no preset produces a future endDate across many today inputs", () => {
    for (const today of TODAYS) {
      for (const preset of PRESET_IDS) {
        const range = rangeForPreset(preset, today);
        expect(range.endDate <= today, `${preset} @ ${today} endDate ${range.endDate}`).toBe(true);
        expect(range.startDate <= range.endDate, `${preset} @ ${today} start<=end`).toBe(true);
      }
    }
  });

  it("no report default produces a future endDate across many today inputs", () => {
    for (const today of TODAYS) {
      for (const reportId of REPORT_IDS) {
        const { range, preset } = defaultRangeForReport(reportId, today);
        expect(PRESET_IDS).toContain(preset);
        expect(range.endDate <= today, `${reportId} @ ${today} endDate ${range.endDate}`).toBe(true);
        expect(range.startDate <= range.endDate, `${reportId} @ ${today} start<=end`).toBe(true);
      }
    }
  });

  it("clampRange forces endDate <= today and start <= end", () => {
    expect(clampRange({ startDate: "2026-06-01", endDate: "2099-12-31" }, "2026-06-20")).toEqual({
      startDate: "2026-06-01",
      endDate: "2026-06-20",
    });
    // A start after the clamped end collapses to the end (never inverted).
    expect(clampRange({ startDate: "2030-01-01", endDate: "2099-12-31" }, "2026-06-20")).toEqual({
      startDate: "2026-06-20",
      endDate: "2026-06-20",
    });
  });

  it("dashboard period param never resolves to a future month-end", () => {
    // A future month requested via period= is clamped so neither bound is in the
    // future: the end snaps to today, and the (later) start collapses onto it.
    expect(rangeForPeriodParam("2099-01", "2026-06-20")).toEqual({
      startDate: "2026-06-20",
      endDate: "2026-06-20",
    });
    // A real past month resolves to its true calendar bounds.
    expect(rangeForPeriodParam("2026-05", "2026-06-20")).toEqual({
      startDate: "2026-05-01",
      endDate: "2026-05-31",
    });
    // The current month clamps the end to today, not the last calendar day.
    expect(rangeForPeriodParam("2026-06", "2026-06-20")).toEqual({
      startDate: "2026-06-01",
      endDate: "2026-06-20",
    });
    expect(rangeForPeriodParam("not-a-date", "2026-06-20")).toBeNull();
  });
});
