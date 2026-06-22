// Pure rule-matching semantics (Epic E12-T4). Extracted so the live pipeline,
// the Settings "test against 90 days" preview, and the unit test all agree.
//
// Semantics: a rule holds an ORDERED ARRAY of condition GROUPS. The rule matches
// a transaction if ANY group matches (groups are OR'd); within a group EVERY
// condition must hold (conditions are AND'd). This widens — never replaces — the
// legacy flat rule shape: `normalizeRuleConditionGroups` folds the old
// merchant/description/amount/direction fields into a single implicit group, so
// a legacy flat rule and its equivalent single-group rule evaluate identically.
//
// First-match-wins ACROSS rules is owned by the caller's ordering, not here.

export type RuleDirection = "inflow" | "outflow" | "any";

/** One AND-group of conditions. An empty group matches every transaction. */
export type RuleConditionGroup = {
  merchantContains?: string;
  descriptionContains?: string;
  amountMinMinor?: number;
  amountMaxMinor?: number;
  direction?: RuleDirection;
};

/** The legacy flat condition fields stored directly on a rule doc. */
export type LegacyFlatConditions = {
  merchantContains?: string;
  descriptionContains?: string;
  amountMinMinor?: number;
  amountMaxMinor?: number;
  direction?: RuleDirection;
  conditionGroups?: RuleConditionGroup[];
};

/** The transaction fields a rule matches against. */
export type MatchableTxn = {
  merchant: string;
  rawDescription: string;
  amountMinor: number;
};

export function directionFor(amountMinor: number): "inflow" | "outflow" {
  return amountMinor >= 0 ? "inflow" : "outflow";
}

function includesText(haystack: string, needle: string | undefined): boolean {
  return !needle || haystack.toLowerCase().includes(needle.toLowerCase());
}

/** Does a single condition group hold for this transaction? (AND of conditions.) */
export function groupMatches(group: RuleConditionGroup, txn: MatchableTxn): boolean {
  const direction = directionFor(txn.amountMinor);
  const absMinor = Math.abs(txn.amountMinor);
  const wantDirection = group.direction ?? "any";
  return (
    (wantDirection === "any" || wantDirection === direction) &&
    includesText(txn.merchant, group.merchantContains) &&
    includesText(txn.rawDescription, group.descriptionContains) &&
    (group.amountMinMinor === undefined || absMinor >= group.amountMinMinor) &&
    (group.amountMaxMinor === undefined || absMinor <= group.amountMaxMinor)
  );
}

/** True only if the group has at least one active condition (not empty). */
export function groupHasCondition(group: RuleConditionGroup): boolean {
  return (
    Boolean(group.merchantContains?.trim()) ||
    Boolean(group.descriptionContains?.trim()) ||
    group.amountMinMinor !== undefined ||
    group.amountMaxMinor !== undefined ||
    (group.direction !== undefined && group.direction !== "any")
  );
}

/**
 * Read-time shim: return the rule's authoritative condition groups. When
 * `conditionGroups` is present and non-empty it wins; otherwise the legacy flat
 * fields are folded into a single implicit group. This keeps every stored rule
 * — old or new — readable and evaluable through one code path. A one-time
 * backfill is optional (decided: decisions.md Q64); this shim is sufficient.
 */
export function normalizeRuleConditionGroups(rule: LegacyFlatConditions): RuleConditionGroup[] {
  if (rule.conditionGroups && rule.conditionGroups.length > 0) {
    return rule.conditionGroups;
  }
  return [
    {
      merchantContains: rule.merchantContains,
      descriptionContains: rule.descriptionContains,
      amountMinMinor: rule.amountMinMinor,
      amountMaxMinor: rule.amountMaxMinor,
      direction: rule.direction ?? "any",
    },
  ];
}

/**
 * Does the rule match the transaction? OR across groups, AND within each group.
 * Accepts either a flat legacy rule or a grouped rule via the shim.
 */
export function ruleMatchesTxn(rule: LegacyFlatConditions, txn: MatchableTxn): boolean {
  const groups = normalizeRuleConditionGroups(rule);
  return groups.some((group) => groupMatches(group, txn));
}

/** A rule is well-formed if at least one of its groups has a real condition. */
export function ruleHasAnyCondition(rule: LegacyFlatConditions): boolean {
  return normalizeRuleConditionGroups(rule).some(groupHasCondition);
}
