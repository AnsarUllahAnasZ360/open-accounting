import { describe, expect, it } from "vitest";

import {
  CATEGORIZATION_GOLD,
  CATEGORIZATION_TARGET_ACCURACY,
  scoreCategorizationAccuracy,
} from "./fixtures/categorizationGold";

describe("E14-T4 committed gold categorization dataset", () => {
  it("ships at least 60 label-safe rows", () => {
    expect(CATEGORIZATION_GOLD.length).toBeGreaterThanOrEqual(60);
  });

  it("has a unique id and a valid expected account number on every row", () => {
    const ids = new Set<string>();
    for (const row of CATEGORIZATION_GOLD) {
      expect(row.id).toMatch(/^g\d+$/);
      expect(ids.has(row.id)).toBe(false);
      ids.add(row.id);
      expect(row.expectedAccountNumber).toMatch(/^\d{4}$/);
      expect(Number.isInteger(row.amountMinor)).toBe(true);
      expect(row.currency).toBe("USD");
      // Income rows are positive, expense rows negative — direction is coherent
      // with the expected account family (4xxx income, 5xxx/6xxx expense).
      if (row.expectedAccountNumber.startsWith("4")) {
        expect(row.amountMinor).toBeGreaterThan(0);
      } else {
        expect(row.amountMinor).toBeLessThan(0);
      }
    }
  });
});

describe("E14-T4 scoreCategorizationAccuracy (deterministic threshold math)", () => {
  it("scores a fixed 9/10 pairing as 90% meets_target", () => {
    const pairs = [
      { predictedAccountNumber: "5200", expectedAccountNumber: "5200" },
      { predictedAccountNumber: "5200", expectedAccountNumber: "5200" },
      { predictedAccountNumber: "5300", expectedAccountNumber: "5300" },
      { predictedAccountNumber: "4000", expectedAccountNumber: "4000" },
      { predictedAccountNumber: "4100", expectedAccountNumber: "4100" },
      { predictedAccountNumber: "5400", expectedAccountNumber: "5400" },
      { predictedAccountNumber: "5800", expectedAccountNumber: "5800" },
      { predictedAccountNumber: "5900", expectedAccountNumber: "5900" },
      { predictedAccountNumber: "6000", expectedAccountNumber: "6000" },
      { predictedAccountNumber: "9999", expectedAccountNumber: "5500" }, // wrong
    ];
    const result = scoreCategorizationAccuracy(pairs);
    expect(result.evaluatedCount).toBe(10);
    expect(result.correctCount).toBe(9);
    expect(result.accuracy).toBeCloseTo(0.9, 10);
    expect(result.targetAccuracy).toBe(CATEGORIZATION_TARGET_ACCURACY);
    expect(result.status).toBe("meets_target");
  });

  it("scores a fixed 7/10 pairing as 70% below_target", () => {
    const pairs = Array.from({ length: 10 }, (_, i) => ({
      predictedAccountNumber: i < 7 ? "5200" : "0000",
      expectedAccountNumber: "5200",
    }));
    const result = scoreCategorizationAccuracy(pairs);
    expect(result.correctCount).toBe(7);
    expect(result.accuracy).toBeCloseTo(0.7, 10);
    expect(result.status).toBe("below_target");
  });

  it("treats exactly the target as a PASS (boundary at 0.80)", () => {
    const pairs = Array.from({ length: 10 }, (_, i) => ({
      predictedAccountNumber: i < 8 ? "5200" : "0000",
      expectedAccountNumber: "5200",
    }));
    const result = scoreCategorizationAccuracy(pairs);
    expect(result.accuracy).toBeCloseTo(0.8, 10);
    expect(result.status).toBe("meets_target");
  });

  it("counts a null prediction (degraded/Inbox) as incorrect", () => {
    const pairs = [
      { predictedAccountNumber: null, expectedAccountNumber: "5200" },
      { predictedAccountNumber: "5200", expectedAccountNumber: "5200" },
    ];
    const result = scoreCategorizationAccuracy(pairs);
    expect(result.correctCount).toBe(1);
    expect(result.accuracy).toBeCloseTo(0.5, 10);
    expect(result.status).toBe("below_target");
  });

  it("returns no_eval_rows for an empty pairing", () => {
    const result = scoreCategorizationAccuracy([]);
    expect(result.evaluatedCount).toBe(0);
    expect(result.correctCount).toBe(0);
    expect(result.accuracy).toBe(0);
    expect(result.status).toBe("no_eval_rows");
  });

  it("honors a custom target threshold", () => {
    const pairs = Array.from({ length: 10 }, (_, i) => ({
      predictedAccountNumber: i < 6 ? "5200" : "0000",
      expectedAccountNumber: "5200",
    }));
    expect(scoreCategorizationAccuracy(pairs, 0.5).status).toBe("meets_target");
    expect(scoreCategorizationAccuracy(pairs, 0.7).status).toBe("below_target");
  });
});
