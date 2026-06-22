import { describe, expect, it } from "vitest";

import { buildPageInsight, type ReportsInsightModel } from "../page-insights";

// E6-T10: the Reports surface shows exactly ONE small, report-relevant insight,
// derived from the already-loaded report pack (no new query). These cover the
// builder's priority + threshold gating so the banner never shows a filler line.

function model(overrides: Partial<NonNullable<ReportsInsightModel>> = {}): ReportsInsightModel {
  return {
    entity: { currency: "USD" },
    monthlyReview: { month: "2026-05", netResultMinor: 0 },
    arAging: { buckets: { days60Minor: 0, days90Minor: 0 }, totalMinor: 0 },
    ...overrides,
  };
}

describe("reports page insight (E6-T10)", () => {
  it("prioritizes aged receivables (61+ days) as the warning signal", () => {
    const insight = buildPageInsight(
      "reports",
      model({
        monthlyReview: { month: "2026-05", netResultMinor: 500000 },
        arAging: { buckets: { days60Minor: 40000, days90Minor: 80000 }, totalMinor: 200000 },
      }),
    );
    expect(insight).not.toBeNull();
    expect(insight!.tone).toBe("warning");
    expect(insight!.icon).toBe("clock");
    expect(insight!.text).toMatch(/more than 60 days late/);
  });

  it("falls back to the month's net result when there is no aged AR", () => {
    const profit = buildPageInsight("reports", model({ monthlyReview: { month: "2026-05", netResultMinor: 320000 } }));
    expect(profit!.tone).toBe("income");
    expect(profit!.text).toMatch(/Net profit/);

    const loss = buildPageInsight("reports", model({ monthlyReview: { month: "2026-05", netResultMinor: -120000 } }));
    expect(loss!.tone).toBe("neutral");
    expect(loss!.text).toMatch(/Net loss/);
  });

  it("hides the banner (null) when nothing crosses the threshold", () => {
    expect(buildPageInsight("reports", model())).toBeNull();
    expect(buildPageInsight("reports", null)).toBeNull();
  });
});
