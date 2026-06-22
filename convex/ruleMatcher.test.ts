import { describe, expect, it } from "vitest";

import {
  groupHasCondition,
  normalizeRuleConditionGroups,
  ruleHasAnyCondition,
  ruleMatchesTxn,
  type LegacyFlatConditions,
  type MatchableTxn,
} from "./ruleMatcher";

// A transaction factory so each case states only what it cares about.
function txn(over: Partial<MatchableTxn>): MatchableTxn {
  return { merchant: "", rawDescription: "", amountMinor: -1000, ...over };
}

describe("E12-T4 rule matcher — condition groups (OR) with conditions (AND)", () => {
  it("a single group ANDs its conditions", () => {
    const rule: LegacyFlatConditions = {
      conditionGroups: [{ merchantContains: "aws", direction: "outflow" }],
    };
    // Matches: merchant has 'aws' AND it's an outflow.
    expect(ruleMatchesTxn(rule, txn({ merchant: "AWS Cloud", amountMinor: -5000 }))).toBe(true);
    // Fails the merchant condition.
    expect(ruleMatchesTxn(rule, txn({ merchant: "Google", amountMinor: -5000 }))).toBe(false);
    // Fails the direction condition (inflow).
    expect(ruleMatchesTxn(rule, txn({ merchant: "AWS", amountMinor: 5000 }))).toBe(false);
  });

  it("groups are OR'd — a txn matching group B but NOT group A still matches", () => {
    const rule: LegacyFlatConditions = {
      conditionGroups: [
        { merchantContains: "aws" }, // group A
        { merchantContains: "stripe" }, // group B
      ],
    };
    const onlyB = txn({ merchant: "STRIPE PAYOUT" });
    // Does NOT match group A...
    expect(groupHasConditionMatch(rule, onlyB, 0)).toBe(false);
    // ...but matches group B, so the rule matches.
    expect(groupHasConditionMatch(rule, onlyB, 1)).toBe(true);
    expect(ruleMatchesTxn(rule, onlyB)).toBe(true);
  });

  it("amount bounds are inclusive and compared on the absolute value", () => {
    const rule: LegacyFlatConditions = {
      conditionGroups: [{ amountMinMinor: 1000, amountMaxMinor: 5000 }],
    };
    expect(ruleMatchesTxn(rule, txn({ amountMinor: -1000 }))).toBe(true); // == min
    expect(ruleMatchesTxn(rule, txn({ amountMinor: -5000 }))).toBe(true); // == max
    expect(ruleMatchesTxn(rule, txn({ amountMinor: -999 }))).toBe(false); // below min
    expect(ruleMatchesTxn(rule, txn({ amountMinor: -5001 }))).toBe(false); // above max
    expect(ruleMatchesTxn(rule, txn({ amountMinor: 3000 }))).toBe(true); // abs within range
  });

  it("legacy FLAT rules evaluate identically to their single-group equivalent (back-compat)", () => {
    const flat: LegacyFlatConditions = {
      merchantContains: "uber",
      direction: "outflow",
      amountMinMinor: 500,
    };
    const grouped: LegacyFlatConditions = {
      conditionGroups: [{ merchantContains: "uber", direction: "outflow", amountMinMinor: 500 }],
    };
    const cases = [
      txn({ merchant: "Uber Eats", amountMinor: -2000 }), // matches both
      txn({ merchant: "Uber", amountMinor: -100 }), // below amount min — fails both
      txn({ merchant: "Lyft", amountMinor: -2000 }), // wrong merchant — fails both
      txn({ merchant: "Uber", amountMinor: 2000 }), // inflow — fails both
    ];
    for (const c of cases) {
      expect(ruleMatchesTxn(flat, c)).toBe(ruleMatchesTxn(grouped, c));
    }
  });

  it("read shim folds legacy flat fields into a single normalized group", () => {
    const flat: LegacyFlatConditions = { merchantContains: "netflix", direction: "outflow" };
    const groups = normalizeRuleConditionGroups(flat);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({
      merchantContains: "netflix",
      descriptionContains: undefined,
      amountMinMinor: undefined,
      amountMaxMinor: undefined,
      direction: "outflow",
    });
  });

  it("conditionGroups wins over the flat fields when both are present", () => {
    const rule: LegacyFlatConditions = {
      merchantContains: "ignored-flat",
      conditionGroups: [{ merchantContains: "real" }],
    };
    expect(ruleMatchesTxn(rule, txn({ merchant: "REAL deal" }))).toBe(true);
    expect(ruleMatchesTxn(rule, txn({ merchant: "ignored-flat" }))).toBe(false);
  });

  it("an empty group matches everything; ruleHasAnyCondition guards against it", () => {
    const empty: LegacyFlatConditions = { conditionGroups: [{}] };
    expect(ruleMatchesTxn(empty, txn({ merchant: "anything" }))).toBe(true);
    expect(groupHasCondition({})).toBe(false);
    expect(ruleHasAnyCondition(empty)).toBe(false);
    expect(ruleHasAnyCondition({ conditionGroups: [{ merchantContains: "x" }] })).toBe(true);
  });
});

// Helper: does group at `index` match this txn on its own?
function groupHasConditionMatch(rule: LegacyFlatConditions, t: MatchableTxn, index: number) {
  const groups = normalizeRuleConditionGroups(rule);
  const single: LegacyFlatConditions = { conditionGroups: [groups[index]!] };
  return ruleMatchesTxn(single, t);
}
