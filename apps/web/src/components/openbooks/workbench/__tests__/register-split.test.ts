import { describe, expect, it } from "vitest";

import { evaluateSplitBalance, parseMoneyToMinor } from "../register-split";

// E7-7: the drawer's split editor pre-validates that the two parts sum to the
// original absolute amount before Post split is allowed — the ledger rejects an
// unbalanced repost, so the UI catches it first with a clear hint.
describe("evaluateSplitBalance", () => {
  it("balances when the two parts sum exactly to the original (minor units)", () => {
    const result = evaluateSplitBalance("60.00", "24.00", -8400);
    expect(result.originalMinor).toBe(8400);
    expect(result.firstMinor).toBe(6000);
    expect(result.secondMinor).toBe(2400);
    expect(result.sumMinor).toBe(8400);
    expect(result.balanced).toBe(true);
    expect(result.remainderMinor).toBe(0);
  });

  it("uses the ABSOLUTE original amount (expenses are negative)", () => {
    expect(evaluateSplitBalance("50.00", "50.00", -10000).balanced).toBe(true);
    expect(evaluateSplitBalance("50.00", "50.00", 10000).balanced).toBe(true);
  });

  it("reports a positive remainder when under-allocated", () => {
    const result = evaluateSplitBalance("40.00", "20.00", -8400);
    expect(result.balanced).toBe(false);
    // 84.00 target − 60.00 allocated = 24.00 still to allocate.
    expect(result.remainderMinor).toBe(2400);
  });

  it("reports a negative remainder when over-allocated", () => {
    const result = evaluateSplitBalance("60.00", "40.00", -8400);
    expect(result.balanced).toBe(false);
    // 84.00 target − 100.00 allocated = −16.00 over.
    expect(result.remainderMinor).toBe(-1600);
  });

  it("is unbalanced (and falls back to the full original remainder) when a field is empty", () => {
    const result = evaluateSplitBalance("", "84.00", -8400);
    expect(Number.isNaN(result.firstMinor)).toBe(true);
    expect(Number.isNaN(result.sumMinor)).toBe(true);
    expect(result.balanced).toBe(false);
    expect(result.remainderMinor).toBe(8400);
  });

  it("never balances a sub-cent rounding error", () => {
    // 28.00 + 28.00 + 28.00 = 84.00, but a naive third would round to 28.00 each
    // → 84.00; an off-by-a-cent split must stay disabled.
    expect(evaluateSplitBalance("28.00", "55.99", -8400).balanced).toBe(false);
    expect(evaluateSplitBalance("28.00", "56.00", -8400).balanced).toBe(true);
  });
});

describe("parseMoneyToMinor", () => {
  it("rounds decimal text to integer minor units", () => {
    expect(parseMoneyToMinor("12.34")).toBe(1234);
    expect(parseMoneyToMinor("0.1")).toBe(10);
  });

  it("returns NaN for non-numeric input", () => {
    expect(Number.isNaN(parseMoneyToMinor(""))).toBe(true);
    expect(Number.isNaN(parseMoneyToMinor("abc"))).toBe(true);
  });
});
