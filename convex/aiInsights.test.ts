import { describe, expect, it } from "vitest";

import {
  findingNumbersAreSupported,
  numericTokensFromAggregate,
} from "./aiInsightsVerify";

/**
 * E8-T8 — the AI narrative layer may only RESTATE numbers already present in the
 * section aggregate; it never sources figures. These tests exercise the pure
 * cross-check the action runs over every model finding before showing it. When a
 * finding cites a number not in the aggregate it is dropped, and the action falls
 * back to the deterministic numbers (which are derived purely from the aggregate)
 * — so the banner/observations can never display a fabricated value.
 */
describe("aiInsights numeric cross-check (E8-T8)", () => {
  // A known income-shaped aggregate in minor units (cents). 1,250,000 cents =
  // $12,500; 320,000 cents = $3,200.
  const aggregate = {
    data: {
      receivedThisMonthMinor: 1_250_000,
      overdueMinor: 320_000,
      overdueInvoiceCount: 3,
      topCustomers: [{ name: "Globex", receivedMinor: 800_000 }],
    },
  };

  it("allows both minor-unit and major-unit (÷100) magnitudes from the aggregate", () => {
    const allowed = numericTokensFromAggregate(aggregate);
    expect(allowed.has(1_250_000)).toBe(true); // raw minor units
    expect(allowed.has(12_500)).toBe(true); // ÷100 display form
    expect(allowed.has(320_000)).toBe(true);
    expect(allowed.has(3_200)).toBe(true);
    expect(allowed.has(800_000)).toBe(true);
  });

  it("accepts a finding that restates a supplied figure (major-unit form)", () => {
    const allowed = numericTokensFromAggregate(aggregate);
    expect(
      findingNumbersAreSupported(
        { title: "Revenue this month", detail: "You received $12,500 this month." },
        allowed,
      ),
    ).toBe(true);
  });

  it("accepts a finding citing a supplied overdue amount", () => {
    const allowed = numericTokensFromAggregate(aggregate);
    expect(
      findingNumbersAreSupported(
        { title: "Overdue", detail: "$3,200 is overdue across 3 invoices." },
        allowed,
      ),
    ).toBe(true);
  });

  it("rejects a finding that invents a number absent from the aggregate", () => {
    const allowed = numericTokensFromAggregate(aggregate);
    expect(
      findingNumbersAreSupported(
        { title: "Made-up", detail: "You received $47,900 this month." },
        allowed,
      ),
    ).toBe(false);
  });

  it("ignores small counts and 4-digit years (descriptive, not ledger claims)", () => {
    const allowed = numericTokensFromAggregate(aggregate);
    expect(
      findingNumbersAreSupported(
        { title: "3 invoices in 2026", detail: "3 invoices remain open in 2026." },
        allowed,
      ),
    ).toBe(true);
  });

  it("passes a finding that cites no numbers at all", () => {
    const allowed = numericTokensFromAggregate(aggregate);
    expect(
      findingNumbersAreSupported(
        { title: "Healthy", detail: "Revenue is up versus last period." },
        allowed,
      ),
    ).toBe(true);
  });

  it("tolerates ±1 rounding drift on a supplied figure", () => {
    const allowed = numericTokensFromAggregate(aggregate);
    // 12,499 is 12,500 − 1 — within the rounding tolerance.
    expect(
      findingNumbersAreSupported(
        { title: "Revenue", detail: "About $12,499 came in." },
        allowed,
      ),
    ).toBe(true);
  });
});
