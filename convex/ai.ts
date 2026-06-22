import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { AI_PROVIDER_IDS, isAiProviderId, type AiProviderId } from "./aiCatalog";
import { credentialIsComplete, resolveCredentialFromEnv, resolveModelId } from "./aiProvider";
import { resolveAIProviderRegistry } from "./aiProviderRegistry";
import { requireWorkspaceRole } from "./authz";
import {
  applyCalibration,
  autoPostPrecisionSummary,
  type BusinessImpactCategory,
  type CalibrationParams,
  type CalibrationSample,
  decideAutoPost,
  fitCalibration,
  hasSufficientMixedOutcomes,
  IDENTITY_CALIBRATION,
  reliabilityReport,
} from "./calibration";
import { ensureDefaultBankAccountForEntity } from "./defaultBankAccount";
import {
  CATEGORIZATION_GOLD,
  CATEGORIZATION_TARGET_ACCURACY,
  scoreCategorizationAccuracy,
} from "./fixtures/categorizationGold";
import { chartTemplatesForType, seedChartForEntity } from "./ledger";

export const AI_AUTONOMY_THRESHOLDS = {
  suggest: null,
  balanced: 0.9,
  autopilot: 0.75,
} as const;

export type AIAutonomy = keyof typeof AI_AUTONOMY_THRESHOLDS;

const DEFAULT_AI_AUTONOMY: AIAutonomy = "balanced";
// Widened from the legacy 5 providers to all 14 catalog providers (E3-T2; Q12).
// The aiCatalog AI_PROVIDER_IDS list is the canonical source of truth. This is
// additive/non-breaking: every previously-stored provider id is still in the set.
const aiProviderValidator = v.union(
  ...(AI_PROVIDER_IDS.map((id) => v.literal(id)) as [
    ReturnType<typeof v.literal<AiProviderId>>,
    ...ReturnType<typeof v.literal<AiProviderId>>[],
  ]),
);
const aiAutonomyValidator = v.union(
  v.literal("suggest"),
  v.literal("balanced"),
  v.literal("autopilot"),
);
type ProviderConnectionTestResult = {
  ok: boolean;
  mode: "active" | "degraded";
  provider: AiProviderId | null;
  runtime: "ai_sdk" | "degraded";
  message: string;
  model?: string;
  finishReason?: string;
  latencyMs?: number;
};
const aiSdkTestProviderConnectionRef = makeFunctionReference<
  "action",
  { workspaceId: Id<"workspaces"> },
  ProviderConnectionTestResult
>("aiSdkRuntime:testProviderConnection");
const categorizeAndRouteTransactionRef = makeFunctionReference<
  "action",
  {
    entityId: Id<"entities">;
    bankAccountId: Id<"bankAccounts">;
    date: string;
    amountMinor: number;
    currency: string;
    merchant: string;
    rawDescription: string;
    status: "pending" | "posted";
    source: "bank" | "stripe" | "manual";
    externalId: string;
  },
  {
    mode: "bedrock" | "degraded" | "fallback";
    provider: "bedrock" | null;
    model: string | null;
    proposal: {
      categoryAccountId: Id<"ledgerAccounts">;
      accountNumber: string;
      categoryName: string;
      confidence: number;
      needsHuman: boolean;
    } | null;
    fallbackReason: string | null;
    route: {
      status: "posted" | "needs_review" | "duplicate";
      transactionId: Id<"transactions">;
      entryId: Id<"journalEntries"> | null;
      stage: string;
    };
  }
>("bedrockCategorizer:categorizeAndRouteTransaction");

type HoldoutEvalCase = {
  sourceTransactionId: Id<"transactions">;
  date: string;
  amountMinor: number;
  currency: string;
  merchant: string;
  rawDescription: string;
  source: "bank" | "stripe" | "manual";
  expectedAccountId: Id<"ledgerAccounts">;
  expectedAccountNumber: string;
  expectedAccountName: string;
};

type GoldEvalCase = {
  goldId: string;
  date: string;
  amountMinor: number;
  currency: string;
  merchant: string;
  rawDescription: string;
  expectedAccountId: Id<"ledgerAccounts">;
  expectedAccountNumber: string;
  expectedAccountName: string;
};

type HoldoutEvalResult = {
  merchant: string;
  amountMinor: number;
  expectedAccountNumber: string;
  expectedAccountName: string;
  predictedAccountNumber: string | null;
  predictedAccountName: string | null;
  correct: boolean;
  routeStatus: "posted" | "needs_review" | "duplicate";
  stage: string;
  decidedBy: Doc<"transactions">["decidedBy"] | null;
  confidence: number | null;
  mode: "bedrock" | "degraded" | "fallback";
  proposalSource: "llm" | "semantic_memory" | null;
  fallbackReason: string | null;
};

const HOLDOUT_EVAL_SINGLE_ACTION_LIMIT = 60;

const prepareHoldoutCategorizationEvalRef = makeFunctionReference<
  "mutation",
  { sourceEntityId: Id<"entities">; limit?: number },
  {
    sourceEntityId: Id<"entities">;
    evalEntityId: Id<"entities">;
    bankAccountId: Id<"bankAccounts">;
    currency: string;
    runKey: string;
    cases: HoldoutEvalCase[];
    skippedNonCategoryCount: number;
  }
>("ai:prepareHoldoutCategorizationEval");
const holdoutTransactionResultRef = makeFunctionReference<
  "query",
  { transactionId: Id<"transactions"> },
  {
    categoryAccountId: Id<"ledgerAccounts"> | null;
    categoryAccountNumber: string | null;
    categoryAccountName: string | null;
    decidedBy: Doc<"transactions">["decidedBy"] | null;
    confidence: number | null;
  }
>("ai:holdoutTransactionResult");
const recordHoldoutCategorizationEvalRunRef = makeFunctionReference<
  "mutation",
  {
    sourceEntityId: Id<"entities">;
    evalEntityId: Id<"entities">;
    evaluatedCount: number;
    correctCount: number;
    accuracy: number;
    targetAccuracy: number;
    status: "meets_target" | "below_target" | "no_eval_rows";
    finding: string;
  },
  { evalRunId: Id<"aiEvalRuns">; providerMode: "active" | "degraded" }
>("ai:recordHoldoutCategorizationEvalRun");
// E2-T10: holdout eval action ref (callable from the fit-and-persist action) and
// the internal mutations that enumerate in-scope entities and persist a fitted
// per-entity / workspace-fallback calibration without a per-call human admin.
const runHoldoutCategorizationEvalRef = makeFunctionReference<
  "action",
  { sourceEntityId: Id<"entities">; limit?: number },
  { cases: Array<{ confidence: number | null; correct: boolean }>; providerMode: "active" | "degraded" }
>("ai:runHoldoutCategorizationEval");
const listWorkspaceEntitiesForCalibrationRef = makeFunctionReference<
  "mutation",
  { sourceEntityId: Id<"entities"> },
  { workspaceId: Id<"workspaces">; entityIds: Array<Id<"entities">> }
>("ai:listWorkspaceEntitiesForCalibration");
const persistEntityCalibrationInternalRef = makeFunctionReference<
  "mutation",
  {
    workspaceId: Id<"workspaces">;
    entityId?: Id<"entities">;
    samples: Array<{ rawConfidence: number; correct: boolean }>;
    fittedFrom: string;
  },
  { calibrationId: Id<"aiCalibrations">; scope: "entity" | "workspace"; sampleCount: number; positiveCount: number }
>("ai:persistEntityCalibrationInternal");
const prepareGoldCategorizationEvalRef = makeFunctionReference<
  "mutation",
  { sourceEntityId: Id<"entities"> },
  {
    sourceEntityId: Id<"entities">;
    evalEntityId: Id<"entities">;
    bankAccountId: Id<"bankAccounts">;
    currency: string;
    runKey: string;
    cases: GoldEvalCase[];
  }
>("ai:prepareGoldCategorizationEval");

export function resolveAutonomyThreshold(autonomy: AIAutonomy) {
  return AI_AUTONOMY_THRESHOLDS[autonomy];
}

/**
 * The single shared auto-post gate. It compares the CALIBRATED probability to
 * the UNCHANGED AI_AUTONOMY_THRESHOLDS constant (suggest never posts; balanced
 * 0.90; autopilot 0.75) and additionally enforces the E6.2 business-impact
 * gate (amount ceiling/ramp + category blocklist).
 *
 * `confidence` is the RAW model/stage confidence. When `calibration` is omitted
 * (or identity) and no amount/category is supplied, the calibrated probability
 * equals the raw confidence and the business-impact gate is a no-op, so the
 * decision is byte-for-byte the legacy `confidence >= threshold` behavior.
 * Calibration can only ever make auto-post MORE conservative.
 */
export function shouldAutoPostAI(args: {
  autonomy: AIAutonomy;
  confidence: number;
  needsHuman?: boolean;
  amountMinor?: number;
  category?: BusinessImpactCategory | null;
  calibration?: CalibrationParams | null;
}) {
  return autoPostDecisionAI(args).autoPost;
}

/**
 * Full decision (raw + calibrated + required confidence + reason) for callers
 * that need to record WHY an item was or was not auto-posted, e.g. the eval
 * harness measuring precision on calibrated auto-post decisions.
 */
export function autoPostDecisionAI(args: {
  autonomy: AIAutonomy;
  confidence: number;
  needsHuman?: boolean;
  amountMinor?: number;
  category?: BusinessImpactCategory | null;
  calibration?: CalibrationParams | null;
}) {
  return decideAutoPost({
    baseThreshold: resolveAutonomyThreshold(args.autonomy),
    rawConfidence: args.confidence,
    ...(args.needsHuman !== undefined ? { needsHuman: args.needsHuman } : {}),
    ...(args.amountMinor !== undefined ? { amountMinor: args.amountMinor } : {}),
    category: args.category ?? null,
    calibration: args.calibration ?? IDENTITY_CALIBRATION,
  });
}

export function bedrockEnvironmentStatus() {
  const registry = resolveAIProviderRegistry();

  return {
    mode: registry.mode,
    activeProvider: registry.activeProvider === "bedrock" ? "bedrock" as const : null,
    model: registry.activeProvider === "bedrock" ? registry.model : null,
    region: registry.activeProvider === "bedrock" ? registry.region : null,
    degradedReason: registry.degradedReason,
    providers: registry.providers,
  };
}

function configAutonomy(config: Doc<"aiConfigs"> | null): AIAutonomy {
  return config?.autonomy ?? DEFAULT_AI_AUTONOMY;
}

async function requireEntityAccess(ctx: MutationCtx, entityId: Id<"entities">) {
  const entity = await ctx.db.get(entityId);
  if (!entity) {
    throw new ConvexError("OpenBooks entity not found.");
  }
  const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
  return { entity, userId };
}

async function requireSystemSyncActor(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
  actorUserId: Id<"users">,
) {
  const actor = await ctx.db
    .query("systemActors")
    .withIndex("by_workspace_and_kind", (q) => q.eq("workspaceId", workspaceId).eq("kind", "sync"))
    .unique();
  if (!actor || actor.userId !== actorUserId) {
    throw new ConvexError("Import categorization requires the OpenBooks sync system actor.");
  }
  return actor.userId;
}

async function authorizeCategorizationRead(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  actorUserId?: Id<"users">,
) {
  if (actorUserId) {
    await requireSystemSyncActor(ctx, workspaceId, actorUserId);
    return;
  }
  await requireWorkspaceRole(ctx, workspaceId, "admin");
}

type LedgerAccountRow = Doc<"ledgerAccounts">;

/**
 * Direction-aware candidate selection (E2-T6).
 *
 * The legacy builder offered ONLY income accounts for inflows and ONLY expense
 * for outflows, which forced refunds, loan proceeds, owner contributions, and
 * transfers into revenue (RC10 over-statement). We instead offer a
 * direction-appropriate set so the model/recall can pick the correct
 * non-income / non-expense account when the cash movement is not ordinary
 * revenue or spend.
 *
 * Safety: broadening the candidate set is safe because the business-impact gate
 * (calibration.isBlockedCategory) still prevents equity / owner-draw / tax
 * candidates from AUTO-posting — they can be PROPOSED to the Inbox but never
 * auto-booked. The primary (ordinary) type for the direction is ranked first so
 * the prompt still leads with the most likely answers, and the set is capped to
 * keep the prompt small and deterministic.
 */

// Account TYPES allowed per direction, in ranking precedence order. The first
// type is the ordinary case (income for inflows, expense for outflows); the
// remaining types cover refunds/contributions/proceeds/transfers.
const INFLOW_CANDIDATE_TYPES = ["income", "asset", "liability", "expense", "equity"] as const;
const OUTFLOW_CANDIDATE_TYPES = ["expense", "asset", "liability", "income", "equity"] as const;

// Subtypes that only make sense as clearing / transfer destinations. We always
// allow these asset/liability rows so an internal move or payout deposit can be
// routed to a clearing/transfer account instead of inventing revenue or spend.
const TRANSFER_CLEARING_SUBTYPES = new Set<string>([
  "clearing",
  "in_transit",
  "bank",
  "cash",
]);

function directionCandidateRank(direction: "inflow" | "outflow") {
  const order = direction === "inflow" ? INFLOW_CANDIDATE_TYPES : OUTFLOW_CANDIDATE_TYPES;
  const rank = new Map<string, number>();
  order.forEach((type, index) => rank.set(type, index));
  return rank;
}

/**
 * Whether an account is an eligible candidate for a cash movement direction.
 *
 * - Inflows: income (ordinary), plus refund/contra targets (expense), equity
 *   contributions, liability proceeds (loans/credit-card draws), and
 *   transfer/clearing asset accounts.
 * - Outflows: expense (ordinary), plus contra-income (refunds out), owner draws
 *   (equity, flagged-but-allowed-as-candidate), liability paydowns, and
 *   transfer/clearing accounts.
 *
 * Pure asset rows that are NOT transfer/clearing (e.g. fixed assets, prepaid,
 * receivable) are excluded to keep the prompt focused — those are rarely the
 * categorization answer and the blocklist gate cannot protect them.
 */
function isDirectionCandidate(account: LedgerAccountRow, direction: "inflow" | "outflow") {
  if (account.archived) return false;
  const type = account.type;
  if (type === "income" || type === "expense") return true;
  if (type === "equity") return true; // contributions (inflow) / draws (outflow); gated from auto-post
  if (type === "liability") return true; // proceeds (inflow) / paydown (outflow)
  if (type === "asset") return TRANSFER_CLEARING_SUBTYPES.has(account.subtype);
  return false;
}

function selectDirectionCandidates(
  accounts: LedgerAccountRow[],
  amountMinor: number,
  cap = 40,
) {
  const direction = amountMinor >= 0 ? "inflow" : "outflow";
  const rank = directionCandidateRank(direction);
  return accounts
    .filter((account) => isDirectionCandidate(account, direction))
    .map((account) => ({
      id: account._id,
      number: account.number,
      name: account.name,
      type: account.type,
      subtype: account.subtype,
      _rank: rank.get(account.type) ?? rank.size,
    }))
    // Rank ordinary type first, then by account number for determinism.
    .sort((a, b) => (a._rank - b._rank) || a.number.localeCompare(b.number))
    .slice(0, cap)
    .map(({ _rank, ...candidate }) => candidate);
}

/**
 * Compact business-context block fed into the categorization prompt (E2-T9).
 *
 * Source of truth for revenue streams is the shared, explicit per-entity
 * `incomeStreams` settings field (defined ONCE on the entities table, written by
 * onboarding's AI-proposes/owner-approves flow in E4 and read by E9-T8's
 * digest). The categorizer only READS it. When the approved field is empty
 * (cold-start before approval), we derive a top-vendor / top-customer hint from
 * recent contacts so the prompt is never blank.
 */
type BusinessContext = {
  entityName: string;
  entityType: string | null;
  revenueStreams: string[];
  recentVendors: string[];
  recentCustomers: string[];
};

function buildBusinessContext(
  entity: Doc<"entities">,
  contacts: Doc<"contacts">[],
): BusinessContext {
  const approvedStreams = Array.isArray(entity.incomeStreams)
    ? entity.incomeStreams
        .map((stream) => stream.label.trim())
        .filter((label) => label.length > 0)
        .slice(0, 8)
    : [];

  // Cold-start fallback: derive a small recent-vendor / recent-customer hint
  // from the contact directory so the model has *some* business signal even
  // before onboarding has approved an income-stream taxonomy.
  const active = contacts.filter((contact) => !contact.archived);
  const recentVendors = active
    .filter((contact) => contact.roles.includes("vendor"))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8)
    .map((contact) => contact.name);
  const recentCustomers = active
    .filter((contact) => contact.roles.includes("customer"))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8)
    .map((contact) => contact.name);

  return {
    entityName: entity.name,
    entityType: entity.entityType ?? entity.businessType ?? null,
    revenueStreams: approvedStreams,
    recentVendors,
    recentCustomers,
  };
}

/**
 * Resolve a known contact for a merchant string (E2-T9). Matches on the contact
 * name or any registered alias, case-insensitively, so that a categorized
 * transaction can carry contactId even when the caller did not supply one — the
 * downstream journal-line-write epic then has the customer/vendor on hand.
 */
function resolveContactIdForMerchant(
  contacts: Doc<"contacts">[],
  merchant: string,
): Id<"contacts"> | null {
  const key = merchant.trim().toLowerCase();
  if (!key) return null;
  const active = contacts.filter((contact) => !contact.archived);
  const exact = active.find((contact) => contact.name.trim().toLowerCase() === key);
  if (exact) return exact._id;
  const aliasMatch = active.find((contact) =>
    contact.aliases.some((alias) => alias.trim().toLowerCase() === key),
  );
  if (aliasMatch) return aliasMatch._id;
  const contained = active.find((contact) => {
    const name = contact.name.trim().toLowerCase();
    return name.length >= 4 && (key.includes(name) || name.includes(key));
  });
  return contained?._id ?? null;
}

async function buildCategorizationContext(
  ctx: QueryCtx,
  args: {
    entityId: Id<"entities">;
    bankAccountId: Id<"bankAccounts">;
    amountMinor: number;
    merchant?: string;
  },
) {
  const entity = await ctx.db.get(args.entityId);
  if (!entity) {
    throw new ConvexError("OpenBooks entity not found.");
  }

  const bankAccount = await ctx.db.get(args.bankAccountId);
  if (!bankAccount || bankAccount.entityId !== entity._id) {
    throw new ConvexError("Transaction account does not belong to this entity.");
  }

  const config = await ctx.db
    .query("aiConfigs")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", entity.workspaceId))
    .unique();
  const env = bedrockEnvironmentStatus();
  const accounts = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
    .take(200);
  const contacts = await ctx.db
    .query("contacts")
    .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
    .take(200);
  const businessContext = buildBusinessContext(entity, contacts);
  // Resolve a contact for the merchant so the categorizer can carry contactId
  // even when the caller did not supply one (E2-T9).
  const resolvedContactId = args.merchant
    ? resolveContactIdForMerchant(contacts, args.merchant)
    : null;

  return {
    entity: {
      id: entity._id,
      workspaceId: entity.workspaceId,
      name: entity.name,
      currency: entity.currency,
    },
    bankAccount: {
      id: bankAccount._id,
      name: bankAccount.name,
    },
    provider: {
      mode: env.mode,
      activeProvider: env.activeProvider,
      model: config?.categorizeModel ?? env.model,
      region: env.region,
      autonomy: configAutonomy(config),
    },
    // Direction-aware candidate set (E2-T6): inflows can resolve to non-income
    // (refund/contra, equity contribution, liability proceeds, transfer/clearing)
    // and outflows to non-expense accounts where appropriate, instead of being
    // hard-locked to income/expense by sign.
    candidateAccounts: selectDirectionCandidates(accounts, args.amountMinor),
    // Business context (E2-T9): entity name/type, approved revenue streams, and a
    // recent-vendor/customer hint, threaded into the prompt for cold-start lift.
    businessContext,
    // Merchant-resolved contact (E2-T9): null when no contact matches; the
    // categorizer prefers an explicitly-supplied contactId over this fallback.
    resolvedContactId,
  };
}

async function pickRuleCategory(
  ctx: MutationCtx,
  entityId: Id<"entities">,
  categoryAccountId: Id<"ledgerAccounts"> | undefined,
  merchant: string,
) {
  if (categoryAccountId) {
    const account = await ctx.db.get(categoryAccountId);
    if (!account || account.entityId !== entityId || account.archived || account.type !== "expense") {
      throw new ConvexError("Choose an active expense category for the AI rule.");
    }
    return account;
  }

  const accounts = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .collect();
  const merchantKey = merchant.toLowerCase();
  const preferredSubtype =
    merchantKey.includes("uber") || merchantKey.includes("lyft") || merchantKey.includes("air")
      ? "travel"
      : merchantKey.includes("cafe") || merchantKey.includes("lunch")
        ? "meals"
        : "software";
  const account =
    accounts.find((candidate) => candidate.type === "expense" && candidate.subtype === preferredSubtype && !candidate.archived) ??
    accounts.find((candidate) => candidate.type === "expense" && !candidate.archived);
  if (!account) {
    throw new ConvexError("No active expense account is available for this AI rule.");
  }
  return account;
}

async function buildCategorizationEvalSummary(ctx: MutationCtx, entityId: Id<"entities">) {
  const rows = await ctx.db
    .query("transactions")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .take(1000);
  const evalRows = rows.filter((row) => row.evalSet && row.evalExpectedAccountId);
  const correctCount = evalRows.filter(
    (row) => row.categoryAccountId && row.categoryAccountId === row.evalExpectedAccountId,
  ).length;
  const evaluatedCount = evalRows.length;
  const accuracy = evaluatedCount === 0 ? 0 : correctCount / evaluatedCount;
  const targetAccuracy = 0.8;
  const status =
    evaluatedCount === 0 ? "no_eval_rows" as const : accuracy >= targetAccuracy ? "meets_target" as const : "below_target" as const;
  const providerMode = bedrockEnvironmentStatus().mode;
  const finding =
    status === "no_eval_rows"
      ? "No seeded eval rows were available; run after demo seed to score the >=100 labeled subset."
      : status === "meets_target"
        ? `Categorization accuracy ${(accuracy * 100).toFixed(1)}% meets the 80.0% target.`
        : `Categorization accuracy ${(accuracy * 100).toFixed(1)}% is below the 80.0% target; this is a product finding, not a backend blocker.`;

  return {
    evaluatedCount,
    correctCount,
    accuracy,
    targetAccuracy,
    status,
    providerMode,
    finding,
  };
}

function directionAccountType(amountMinor: number) {
  return amountMinor >= 0 ? "income" as const : "expense" as const;
}

async function uniqueEvalSlug(ctx: MutationCtx, workspaceId: Id<"workspaces">, root: string) {
  let candidate = root.slice(0, 48);
  let n = 2;
  // Eval entities are rare; bounded by the workspace entity cap.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await ctx.db
      .query("entities")
      .withIndex("by_workspace_and_slug", (q) => q.eq("workspaceId", workspaceId).eq("slug", candidate))
      .unique();
    if (!existing) return candidate;
    candidate = `${root.slice(0, 42)}-${n}`;
    n += 1;
  }
}

function holdoutBand(confidence: number | null) {
  if (confidence === null) return "unknown";
  if (confidence >= 0.9) return ">=0.90";
  if (confidence >= 0.75) return "0.75-0.89";
  return "<0.75";
}

function summarizeHoldout(results: HoldoutEvalResult[]) {
  const correctCount = results.filter((result) => result.correct).length;
  const evaluatedCount = results.length;
  const accuracy = evaluatedCount === 0 ? 0 : correctCount / evaluatedCount;
  const targetAccuracy = 0.8;
  const status =
    evaluatedCount === 0 ? "no_eval_rows" as const : accuracy >= targetAccuracy ? "meets_target" as const : "below_target" as const;
  const byStage: Record<string, { total: number; correct: number }> = {};
  const byConfidenceBand: Record<string, { total: number; correct: number }> = {};
  for (const result of results) {
    const stage = result.decidedBy ?? result.stage;
    byStage[stage] ??= { total: 0, correct: 0 };
    byStage[stage].total += 1;
    if (result.correct) byStage[stage].correct += 1;
    const band = holdoutBand(result.confidence);
    byConfidenceBand[band] ??= { total: 0, correct: 0 };
    byConfidenceBand[band].total += 1;
    if (result.correct) byConfidenceBand[band].correct += 1;
  }
  const finding =
    status === "no_eval_rows"
      ? "No label-safe holdout rows were available after excluding non-categorization labels."
      : status === "meets_target"
        ? `Label-safe holdout categorization accuracy ${(accuracy * 100).toFixed(1)}% meets the 80.0% target.`
        : `Label-safe holdout categorization accuracy ${(accuracy * 100).toFixed(1)}% is below the 80.0% target; this is a product quality finding, not a backend blocker.`;

  return {
    evaluatedCount,
    correctCount,
    accuracy,
    targetAccuracy,
    status,
    byStage,
    byConfidenceBand,
    finding,
  };
}

export const prepareHoldoutCategorizationEval = internalMutation({
  args: {
    sourceEntityId: v.id("entities"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { entity: sourceEntity, userId } = await requireEntityAccess(ctx, args.sourceEntityId);
    const now = Date.now();
    const limit = Math.min(HOLDOUT_EVAL_SINGLE_ACTION_LIMIT, Math.max(1, Math.floor(args.limit ?? HOLDOUT_EVAL_SINGLE_ACTION_LIMIT)));
    const sourceAccounts = await ctx.db
      .query("ledgerAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", sourceEntity._id))
      .take(250);
    const sourceAccountsById = new Map(sourceAccounts.map((account) => [account._id, account]));

    const slug = await uniqueEvalSlug(ctx, sourceEntity.workspaceId, `h3-holdout-${now.toString(36)}`);
    const evalEntityId = await ctx.db.insert("entities", {
      workspaceId: sourceEntity.workspaceId,
      name: `H3 Holdout Eval ${new Date(now).toISOString()}`,
      slug,
      businessType: sourceEntity.businessType,
      currency: sourceEntity.currency,
      isDemo: false,
      archived: false,
      fiscalYearStartMonth: sourceEntity.fiscalYearStartMonth ?? 1,
      accountingBasis: sourceEntity.accountingBasis ?? "accrual",
      legalName: "H3 Holdout Eval",
      createdAt: now,
      updatedAt: now,
    });
    const evalEntity = (await ctx.db.get(evalEntityId))!;
    await seedChartForEntity(ctx, evalEntity, chartTemplatesForType(evalEntity.businessType));
    const bankAccountId = await ensureDefaultBankAccountForEntity(ctx, evalEntity);
    const evalAccounts = await ctx.db
      .query("ledgerAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", evalEntityId))
      .take(250);
    const evalAccountsByNumber = new Map(evalAccounts.map((account) => [account.number, account]));

    const sourceRows = await ctx.db
      .query("transactions")
      .withIndex("by_entity", (q) => q.eq("entityId", sourceEntity._id))
      .take(1000);
    const cases: HoldoutEvalCase[] = [];
    let skippedNonCategoryCount = 0;
    for (const row of sourceRows) {
      if (!row.evalSet || !row.evalExpectedAccountId || !row.bankAccountId) continue;
      const sourceExpected = sourceAccountsById.get(row.evalExpectedAccountId);
      const expectedType = directionAccountType(row.amountMinor);
      if (!sourceExpected || sourceExpected.type !== expectedType) {
        skippedNonCategoryCount += 1;
        continue;
      }
      const evalExpected = evalAccountsByNumber.get(sourceExpected.number);
      if (!evalExpected || evalExpected.type !== expectedType) {
        skippedNonCategoryCount += 1;
        continue;
      }
      cases.push({
        sourceTransactionId: row._id,
        date: row.date,
        amountMinor: row.amountMinor,
        currency: row.currency,
        merchant: row.merchant,
        rawDescription: row.rawDescription,
        source: row.source,
        expectedAccountId: evalExpected._id,
        expectedAccountNumber: evalExpected.number,
        expectedAccountName: evalExpected.name,
      });
      if (cases.length >= limit) break;
    }

    await ctx.db.insert("auditEvents", {
      workspaceId: sourceEntity.workspaceId,
      actorUserId: userId,
      action: "ai.eval.started",
      entityType: "entity",
      entityId: evalEntityId,
      summary: `Started label-safe categorization holdout eval with ${cases.length} rows`,
      createdAt: now,
    });

    return {
      sourceEntityId: sourceEntity._id,
      evalEntityId,
      bankAccountId,
      currency: evalEntity.currency,
      runKey: slug,
      cases,
      skippedNonCategoryCount,
    };
  },
});

export const holdoutTransactionResult = internalQuery({
  args: {
    transactionId: v.id("transactions"),
  },
  handler: async (ctx, args) => {
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction) {
      throw new ConvexError("Holdout transaction not found.");
    }
    const category = transaction.categoryAccountId ? await ctx.db.get(transaction.categoryAccountId) : null;
    return {
      categoryAccountId: transaction.categoryAccountId ?? null,
      categoryAccountNumber: category?.number ?? null,
      categoryAccountName: category?.name ?? null,
      decidedBy: transaction.decidedBy ?? null,
      confidence: transaction.confidence ?? null,
    };
  },
});

export const recordHoldoutCategorizationEvalRun = internalMutation({
  args: {
    sourceEntityId: v.id("entities"),
    evalEntityId: v.id("entities"),
    evaluatedCount: v.number(),
    correctCount: v.number(),
    accuracy: v.number(),
    targetAccuracy: v.number(),
    status: v.union(v.literal("meets_target"), v.literal("below_target"), v.literal("no_eval_rows")),
    finding: v.string(),
  },
  handler: async (ctx, args) => {
    const sourceEntity = await ctx.db.get(args.sourceEntityId);
    if (!sourceEntity) {
      throw new ConvexError("OpenBooks source entity not found.");
    }
    const providerMode = bedrockEnvironmentStatus().mode;
    await ctx.db.patch(args.evalEntityId, {
      archived: true,
      updatedAt: Date.now(),
    });
    const evalRunId = await ctx.db.insert("aiEvalRuns", {
      entityId: args.sourceEntityId,
      evaluatedCount: args.evaluatedCount,
      correctCount: args.correctCount,
      accuracy: args.accuracy,
      targetAccuracy: args.targetAccuracy,
      status: args.status,
      providerMode,
      finding: args.finding,
      createdAt: Date.now(),
    });
    return { evalRunId, providerMode };
  },
});

export const providerStatus = query({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceRole(ctx, args.workspaceId, "member");
    const config = await ctx.db
      .query("aiConfigs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    const env = bedrockEnvironmentStatus();
    const autonomy = configAutonomy(config);

    // BYO credential awareness (E3-T2): a workspace is "active" when EITHER a
    // valid env provider exists (legacy path) OR a saved unified `kind:"ai"`
    // credential exists for the chosen provider — no AWS env required.
    const savedAiCredentials = await ctx.db
      .query("credentials")
      .withIndex("by_workspace_and_kind", (q) => q.eq("workspaceId", args.workspaceId).eq("kind", "ai"))
      .take(200);
    const savedProviderIds = new Set(
      savedAiCredentials
        .map((row) => row.provider)
        .filter((id): id is string => Boolean(id) && isAiProviderId(id)),
    );

    // A provider counts as "configured from env" only when the env actually
    // supplied a credential field — never from a hardcoded default base URL
    // (e.g. Ollama at localhost), so an unconfigured deployment stays degraded.
    const envConfigured = (id: AiProviderId): boolean => {
      const credential = resolveCredentialFromEnv(id);
      const hasSignal = Boolean(
        credential.apiKey ||
          credential.accessKeyId ||
          credential.secretAccessKey ||
          credential.sessionToken ||
          credential.baseUrl ||
          credential.region,
      );
      return hasSignal && credentialIsComplete(id, credential);
    };

    const chosenProvider = config?.provider ?? env.activeProvider ?? "bedrock";
    const chosenIsAiProvider = isAiProviderId(chosenProvider);
    const chosenHasCredential = savedProviderIds.has(chosenProvider);
    const chosenHasEnv = chosenIsAiProvider ? envConfigured(chosenProvider as AiProviderId) : false;
    const byoActive = chosenHasCredential || chosenHasEnv;

    const mode: "active" | "degraded" = env.mode === "active" || byoActive ? "active" : "degraded";
    // Only surface a model when the provider is actually active; degraded stays
    // null so the env-absent contract is unchanged. Order: explicit config
    // model → env model (legacy Bedrock AI_MODEL) → catalog default for the
    // chosen provider.
    const resolvedModel =
      mode === "active"
        ? config?.categorizeModel ??
          env.model ??
          (chosenIsAiProvider ? resolveModelId(chosenProvider as AiProviderId, config?.categorizeModel) : null)
        : env.model;

    // Per-provider configured flag spanning env + saved credentials.
    const catalogConfigured = (id: AiProviderId) => savedProviderIds.has(id) || envConfigured(id);

    return {
      mode,
      activeProvider: mode === "active" ? chosenProvider : env.activeProvider,
      model: resolvedModel,
      region: env.region,
      autonomy,
      thresholds: AI_AUTONOMY_THRESHOLDS,
      configuredProvider: chosenProvider,
      // Which providers have a saved BYO credential (for the settings UI).
      savedProviders: Array.from(savedProviderIds),
      degradedReason: mode === "degraded" ? env.degradedReason : null,
      providers: env.providers.map((provider) => ({
        id: provider.id,
        label: provider.label,
        runtime: provider.runtime,
        v1Enabled: provider.v1Enabled,
        capabilities: provider.capabilities,
        configured: provider.configured || savedProviderIds.has(provider.id),
        active: provider.id === chosenProvider && mode === "active",
        ready: provider.ready,
        missingEnv: provider.missingEnv,
        model: provider.model,
        aiSdk: provider.aiSdk,
        reason: provider.reason,
      })),
      // Catalog-wide configured flags (all 14 providers), for the BYO switcher.
      catalogConfigured: AI_PROVIDER_IDS.map((id) => ({ id, configured: catalogConfigured(id) })),
    };
  },
});

export const categorizationContext = query({
  args: {
    entityId: v.id("entities"),
    bankAccountId: v.id("bankAccounts"),
    amountMinor: v.number(),
    merchant: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks entity not found.");
    }
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    return await buildCategorizationContext(ctx, args);
  },
});

export const categorizationContextForImportInternal = internalQuery({
  args: {
    entityId: v.id("entities"),
    bankAccountId: v.id("bankAccounts"),
    amountMinor: v.number(),
    actorUserId: v.id("users"),
    merchant: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks entity not found.");
    }
    await requireSystemSyncActor(ctx, entity.workspaceId, args.actorUserId);
    return await buildCategorizationContext(ctx, args);
  },
});

// The per-pass batch ceiling for the backlog drainer (E2-T3). This caps how many
// items a SINGLE pass attempts (to protect the BYO API rate limit + Convex action
// limits) — it is NOT an overall cap: the drainer reschedules itself until the
// queue is empty or the maxPasses ceiling is hit, so no item is left unattempted
// solely because of this number.
export const CATEGORIZATION_BATCH_PASS_SIZE = 25;
// How wide we scan the transactions table per pass. Larger than the old 500 so a
// big backlog stays visible across passes; already-attempted rows (posted →
// entryId set, or decidedBy in {ai,embedding}) are filtered out and so do not
// re-consume the window on later passes.
const CATEGORIZATION_CANDIDATE_SCAN = 4000;

/**
 * Whether a transaction is an UN-ATTEMPTED categorization candidate. A row is a
 * candidate while it is needs_review, unposted, has a bank account, and has NOT
 * yet been attempted by a machine stage (ai / embedding). plaid_prior and the
 * raw needs_review state are still candidates — they have a weak/absent decision
 * the LLM or recall can improve. Excluding decidedBy in {ai,embedding} is what
 * lets later drainer passes see only fresh rows (E2-T3).
 */
function isCategorizationCandidate(transaction: Doc<"transactions">) {
  return (
    transaction.review === "needs_review" &&
    !transaction.entryId &&
    Boolean(transaction.bankAccountId) &&
    (!transaction.decidedBy ||
      transaction.decidedBy === "needs_review" ||
      transaction.decidedBy === "plaid_prior")
  );
}

export const categorizationBatchCandidates = internalQuery({
  args: {
    entityId: v.id("entities"),
    limit: v.optional(v.number()),
    actorUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks entity not found.");
    }
    await authorizeCategorizationRead(ctx, entity.workspaceId, args.actorUserId);
    const limit = Math.min(
      CATEGORIZATION_BATCH_PASS_SIZE,
      Math.max(1, Math.floor(args.limit ?? 10)),
    );
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(CATEGORIZATION_CANDIDATE_SCAN);
    return transactions
      .filter(isCategorizationCandidate)
      .slice(0, limit)
      .map((transaction) => ({
        transactionId: transaction._id,
        entityId: transaction.entityId,
        bankAccountId: transaction.bankAccountId!,
        date: transaction.date,
        amountMinor: transaction.amountMinor,
        currency: transaction.currency,
        merchant: transaction.merchant,
        rawDescription: transaction.rawDescription,
        status: transaction.status,
        source: transaction.source,
        externalId: transaction.externalId,
      }));
  },
});

/**
 * Count remaining un-attempted categorization candidates for an entity (E2-T3).
 * The drainer uses this to decide whether to reschedule another pass. Capped by
 * the same scan width — when more than the scan width remain, returns the cap
 * (the drainer keeps going until a pass finds zero or hits maxPasses).
 */
export const countCategorizationBacklog = internalQuery({
  args: {
    entityId: v.id("entities"),
    actorUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<number> => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks entity not found.");
    }
    await authorizeCategorizationRead(ctx, entity.workspaceId, args.actorUserId);
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(CATEGORIZATION_CANDIDATE_SCAN);
    return transactions.filter(isCategorizationCandidate).length;
  },
});

export const recordCategorizationBatchRun = internalMutation({
  args: {
    entityId: v.id("entities"),
    actorUserId: v.optional(v.id("users")),
    attemptedCount: v.number(),
    postedCount: v.number(),
    needsReviewCount: v.number(),
    skippedCount: v.number(),
    degradedCount: v.number(),
    fallbackCount: v.number(),
  },
  handler: async (ctx, args) => {
    const { entity, userId } = args.actorUserId
      ? {
          entity: await ctx.db.get(args.entityId),
          userId: args.actorUserId,
        }
      : await requireEntityAccess(ctx, args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks entity not found.");
    }
    if (args.actorUserId) {
      await requireSystemSyncActor(ctx, entity.workspaceId, args.actorUserId);
    }
    const status =
      args.degradedCount > 0 && args.degradedCount === args.attemptedCount
        ? "degraded" as const
        : args.fallbackCount > 0 || args.degradedCount > 0
          ? "partial" as const
          : "completed" as const;
    const summary = `${args.attemptedCount} checked. ${args.postedCount} posted, ${args.needsReviewCount} updated for review, ${args.skippedCount} skipped.`;
    const batchRunId = await ctx.db.insert("aiBatchRuns", {
      entityId: args.entityId,
      requestedByUserId: userId,
      status,
      attemptedCount: args.attemptedCount,
      postedCount: args.postedCount,
      needsReviewCount: args.needsReviewCount,
      skippedCount: args.skippedCount,
      degradedCount: args.degradedCount,
      fallbackCount: args.fallbackCount,
      summary,
      createdAt: Date.now(),
    });
    return { batchRunId, status, summary };
  },
});

export const latestCategorizationBatchRuns = query({
  args: {
    entityId: v.id("entities"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks entity not found.");
    }
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const limit = Math.min(10, Math.max(1, Math.floor(args.limit ?? 3)));
    const runs = await ctx.db
      .query("aiBatchRuns")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .order("desc")
      .take(limit);
    return runs.map((run) => ({
      id: run._id,
      status: run.status,
      attemptedCount: run.attemptedCount,
      postedCount: run.postedCount,
      needsReviewCount: run.needsReviewCount,
      skippedCount: run.skippedCount,
      degradedCount: run.degradedCount,
      fallbackCount: run.fallbackCount,
      summary: run.summary,
      createdAt: run.createdAt,
    }));
  },
});

export const latestCategorizationEvalRuns = query({
  args: {
    entityId: v.id("entities"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks entity not found.");
    }
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const limit = Math.min(10, Math.max(1, Math.floor(args.limit ?? 3)));
    const runs = await ctx.db
      .query("aiEvalRuns")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .order("desc")
      .take(limit);
    return runs.map((run) => ({
      id: run._id,
      evaluatedCount: run.evaluatedCount,
      correctCount: run.correctCount,
      accuracy: run.accuracy,
      targetAccuracy: run.targetAccuracy,
      status: run.status,
      providerMode: run.providerMode,
      finding: run.finding,
      createdAt: run.createdAt,
    }));
  },
});

export const setConfig = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    provider: v.optional(aiProviderValidator),
    chatModel: v.optional(v.string()),
    categorizeModel: v.optional(v.string()),
    autonomy: aiAutonomyValidator,
  },
  handler: async (ctx, args) => {
    await requireWorkspaceRole(ctx, args.workspaceId, "admin");
    const now = Date.now();
    const env = bedrockEnvironmentStatus();
    const existing = await ctx.db
      .query("aiConfigs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    // Provider comes from the full 14-provider catalog; default to the existing
    // value, else bedrock for back-compat. No hardcoded bedrock-only path.
    const provider = args.provider ?? existing?.provider ?? ("bedrock" as const);
    const cleanModel = (value: string | undefined) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    };
    const patch = {
      provider,
      chatModel: cleanModel(args.chatModel) ?? existing?.chatModel ?? env.model ?? undefined,
      categorizeModel:
        cleanModel(args.categorizeModel) ?? existing?.categorizeModel ?? env.model ?? undefined,
      autonomy: args.autonomy,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { configId: existing._id, status: "updated" as const };
    }

    const configId = await ctx.db.insert("aiConfigs", {
      workspaceId: args.workspaceId,
      ...patch,
      createdAt: now,
    });
    return { configId, status: "created" as const };
  },
});

export const testProviderConnection = action({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    return await ctx.runAction(aiSdkTestProviderConnectionRef, args);
  },
});

export const createConfirmedRule = mutation({
  args: {
    entityId: v.id("entities"),
    merchantContains: v.string(),
    categoryAccountId: v.optional(v.id("ledgerAccounts")),
    autoPost: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { entity, userId } = await requireEntityAccess(ctx, args.entityId);
    const merchant = args.merchantContains.trim();
    if (merchant.length < 2) {
      throw new ConvexError("Enter a merchant name for the AI rule.");
    }
    const account = await pickRuleCategory(ctx, entity._id, args.categoryAccountId, merchant);
    const now = Date.now();
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .collect();
    const existing = rules.find(
      (rule) =>
        rule.createdBy === "ai" &&
        rule.merchantContains?.toLowerCase() === merchant.toLowerCase() &&
        rule.categoryAccountId === account._id,
    );

    if (existing) {
      await ctx.db.patch(existing._id, {
        active: true,
        autoPost: Boolean(args.autoPost),
        updatedAt: now,
      });
      await ctx.db.insert("auditEvents", {
        workspaceId: entity.workspaceId,
        actorUserId: userId,
        action: "ai.rule.updated",
        entityType: "rule",
        entityId: existing._id,
        summary: `AI-confirmed rule updated for ${merchant} -> ${account.name}`,
        createdAt: now,
      });
      return { ruleId: existing._id, status: "updated" as const, categoryName: account.name };
    }

    const ruleId = await ctx.db.insert("rules", {
      entityId: entity._id,
      order: Math.max(0, ...rules.map((rule) => rule.order)) + 1,
      name: `AI confirmed: ${merchant}`,
      merchantContains: merchant,
      direction: "outflow",
      categoryAccountId: account._id,
      autoPost: Boolean(args.autoPost),
      hitCount: 0,
      active: true,
      createdBy: "ai",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "ai.rule.confirmed",
      entityType: "rule",
      entityId: ruleId,
      summary: `AI-confirmed rule created for ${merchant} -> ${account.name}`,
      createdAt: now,
    });
    return { ruleId, status: "created" as const, categoryName: account.name };
  },
});

export const recordCategorizationEvalRun = mutation({
  args: {
    entityId: v.id("entities"),
  },
  handler: async (ctx, args) => {
    await requireEntityAccess(ctx, args.entityId);
    const summary = await buildCategorizationEvalSummary(ctx, args.entityId);
    const evalRunId = await ctx.db.insert("aiEvalRuns", {
      entityId: args.entityId,
      ...summary,
      createdAt: Date.now(),
    });
    return { evalRunId, ...summary };
  },
});

const calibrationSampleValidator = v.object({
  rawConfidence: v.number(),
  correct: v.boolean(),
});
const calibrationMethodValidator = v.union(v.literal("temperature"), v.literal("platt"));

/**
 * Shared upsert for a fitted calibration row, keyed PER-ENTITY when an entityId
 * is supplied and as the WORKSPACE-LEVEL fallback (entityId omitted) otherwise.
 * One row per (entity) and one fallback row per workspace; re-running the fit
 * patches the matching row in place rather than duplicating it. The fitted
 * params are DERIVED from the supplied (confidence, correct) pairs — never
 * hardcoded — and AI_AUTONOMY_THRESHOLDS is untouched; only the probability
 * compared to the gate changes.
 */
async function upsertCalibrationRow(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    entityId?: Id<"entities">;
    samples: CalibrationSample[];
    method: "temperature" | "platt";
    fittedFrom: string;
  },
) {
  const params = fitCalibration(args.samples, args.method);
  const before = reliabilityReport(
    args.samples.map((sample) => ({ probability: sample.rawConfidence, correct: sample.correct })),
  );
  const after = reliabilityReport(
    args.samples.map((sample) => ({
      probability: applyCalibration(sample.rawConfidence, params),
      correct: sample.correct,
    })),
  );
  const now = Date.now();
  const record = {
    method: params.method,
    a: params.a,
    b: params.b,
    sampleCount: params.sampleCount,
    positiveCount: params.positiveCount,
    eceBefore: before.ece,
    eceAfter: after.ece,
    fittedFrom: args.fittedFrom,
    updatedAt: now,
  };

  // Find the existing row to patch: the per-entity row when entityId is set,
  // else the workspace fallback (the row with entityId omitted).
  let existing: Doc<"aiCalibrations"> | null = null;
  if (args.entityId) {
    existing = await ctx.db
      .query("aiCalibrations")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .unique();
  } else {
    const rows = await ctx.db
      .query("aiCalibrations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    existing = rows.find((row) => row.entityId === undefined) ?? null;
  }

  let calibrationId: Id<"aiCalibrations">;
  if (existing) {
    await ctx.db.patch(existing._id, record);
    calibrationId = existing._id;
  } else {
    calibrationId = await ctx.db.insert("aiCalibrations", {
      workspaceId: args.workspaceId,
      ...(args.entityId ? { entityId: args.entityId } : {}),
      ...record,
      createdAt: now,
    });
  }

  return {
    calibrationId,
    params,
    eceBefore: before.ece,
    eceAfter: after.ece,
    reliabilityBefore: before.buckets,
    reliabilityAfter: after.buckets,
  };
}

/**
 * E6.1 / E2-T10: fit a confidence calibration from supplied
 * (rawConfidence, wasCorrect) holdout pairs and persist it. When `entityId` is
 * supplied the row is PER-ENTITY; otherwise it is the WORKSPACE-LEVEL fallback.
 * Parameters are DERIVED from the data — never hardcoded. The shared
 * AI_AUTONOMY_THRESHOLDS constant is not touched; only the probability compared
 * to it changes.
 */
export const fitWorkspaceCalibration = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    entityId: v.optional(v.id("entities")),
    samples: v.array(calibrationSampleValidator),
    method: v.optional(calibrationMethodValidator),
    fittedFrom: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceRole(ctx, args.workspaceId, "admin");
    if (args.entityId) {
      const entity = await ctx.db.get(args.entityId);
      if (!entity || entity.workspaceId !== args.workspaceId) {
        throw new ConvexError("Entity does not belong to this workspace.");
      }
    }
    const samples: CalibrationSample[] = args.samples.map((sample) => ({
      rawConfidence: sample.rawConfidence,
      correct: sample.correct,
    }));
    return await upsertCalibrationRow(ctx, {
      workspaceId: args.workspaceId,
      ...(args.entityId ? { entityId: args.entityId } : {}),
      samples,
      method: args.method ?? "temperature",
      fittedFrom: args.fittedFrom ?? "holdout_confidence_pairs",
    });
  },
});

export const workspaceCalibration = query({
  args: {
    workspaceId: v.id("workspaces"),
    // E2-T10: when supplied, return the entity's own calibration, falling back to
    // the workspace-level row, then identity — the same resolution the gate uses.
    entityId: v.optional(v.id("entities")),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceRole(ctx, args.workspaceId, "member");
    const rows = await ctx.db
      .query("aiCalibrations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const fallback = rows.find((candidate) => candidate.entityId === undefined) ?? null;
    const entityRow = args.entityId
      ? (rows.find((candidate) => candidate.entityId === args.entityId) ?? null)
      : null;
    const row = entityRow ?? fallback;
    if (!row) {
      return {
        configured: false as const,
        scope: "identity" as const,
        method: "identity" as const,
        a: 1,
        b: 0,
        sampleCount: 0,
        positiveCount: 0,
        eceBefore: 0,
        eceAfter: 0,
        fittedFrom: null,
        updatedAt: null,
      };
    }
    return {
      configured: true as const,
      scope: row.entityId ? ("entity" as const) : ("workspace" as const),
      method: row.method,
      a: row.a,
      b: row.b,
      sampleCount: row.sampleCount,
      positiveCount: row.positiveCount,
      eceBefore: row.eceBefore,
      eceAfter: row.eceAfter,
      fittedFrom: row.fittedFrom,
      updatedAt: row.updatedAt,
    };
  },
});

export const runHoldoutCategorizationEval = action({
  args: {
    sourceEntityId: v.id("entities"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const prepared = await ctx.runMutation(prepareHoldoutCategorizationEvalRef, {
      sourceEntityId: args.sourceEntityId,
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    });
    const results: HoldoutEvalResult[] = [];

    for (const [index, item] of prepared.cases.entries()) {
      const routed = await ctx.runAction(categorizeAndRouteTransactionRef, {
        entityId: prepared.evalEntityId,
        bankAccountId: prepared.bankAccountId,
        date: item.date,
        amountMinor: item.amountMinor,
        currency: item.currency,
        merchant: item.merchant,
        rawDescription: item.rawDescription,
        status: "posted",
        source: item.source,
        externalId: `h3:${prepared.runKey}:${index}:${item.sourceTransactionId}`,
      });
      const observed = await ctx.runQuery(holdoutTransactionResultRef, {
        transactionId: routed.route.transactionId,
      });
      results.push({
        merchant: item.merchant,
        amountMinor: item.amountMinor,
        expectedAccountNumber: item.expectedAccountNumber,
        expectedAccountName: item.expectedAccountName,
        predictedAccountNumber: observed.categoryAccountNumber,
        predictedAccountName: observed.categoryAccountName,
        correct: observed.categoryAccountId === item.expectedAccountId,
        routeStatus: routed.route.status,
        stage: routed.route.stage,
        decidedBy: observed.decidedBy,
        confidence: observed.confidence,
        mode: routed.mode,
        proposalSource: routed.proposal
          ? routed.proposal.accountNumber === "memory"
            ? "semantic_memory"
            : "llm"
          : null,
        fallbackReason: routed.fallbackReason,
      });
    }

    const summary = summarizeHoldout(results);
    const recorded = await ctx.runMutation(recordHoldoutCategorizationEvalRunRef, {
      sourceEntityId: prepared.sourceEntityId,
      evalEntityId: prepared.evalEntityId,
      evaluatedCount: summary.evaluatedCount,
      correctCount: summary.correctCount,
      accuracy: summary.accuracy,
      targetAccuracy: summary.targetAccuracy,
      status: summary.status,
      finding: summary.finding,
    });

    const calibration = summarizeHoldoutCalibration(results, AI_AUTONOMY_THRESHOLDS.autopilot);

    return {
      evalRunId: recorded.evalRunId,
      sourceEntityId: prepared.sourceEntityId,
      evalEntityId: prepared.evalEntityId,
      generatedAt: new Date().toISOString(),
      method: "label_safe_holdout_unlabeled_route",
      maxSingleActionRows: HOLDOUT_EVAL_SINGLE_ACTION_LIMIT,
      providerMode: recorded.providerMode,
      skippedNonCategoryCount: prepared.skippedNonCategoryCount,
      ...summary,
      calibration,
      cases: results,
      leakageGuard:
        "The route calls omitted categoryAccountId and evalExpectedAccountId; expected labels were kept only in action memory for scoring after prediction.",
    };
  },
});

// ---------------------------------------------------------------------------
// E2-T10: per-entity calibration fit-and-persist (wake the dormant loop).
// ---------------------------------------------------------------------------
// runHoldoutCategorizationEval already produces (confidence, correct) pairs per
// entity and summarizeHoldoutCalibration separates coverage from precision. What
// was missing is the production WIRING: nothing chained the eval to fit + persist
// a calibration, calibration was workspace-keyed not per-entity, and there was no
// refit cadence. These functions close that loop.

/**
 * List every in-scope entity in the workspace that owns `sourceEntityId`, so the
 * fit action can calibrate EACH entity (not just the primary). Admin-gated.
 */
export const listWorkspaceEntitiesForCalibration = internalMutation({
  args: { sourceEntityId: v.id("entities") },
  handler: async (ctx, args) => {
    const { entity } = await requireEntityAccess(ctx, args.sourceEntityId);
    const entities = await ctx.db
      .query("entities")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", entity.workspaceId))
      .take(100);
    return {
      workspaceId: entity.workspaceId,
      entityIds: entities.map((row) => row._id),
    };
  },
});

/**
 * Internal upsert used by the fit action / refit cron. It does NOT re-check a
 * human admin (the action that drives it already did) — it is internal-only and
 * runs as the system. Per-entity when entityId is set, else the workspace
 * fallback. Returns whether the fitted row is a real per-entity calibration or
 * the (possibly identity) fallback.
 */
export const persistEntityCalibrationInternal = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    entityId: v.optional(v.id("entities")),
    samples: v.array(calibrationSampleValidator),
    fittedFrom: v.string(),
  },
  handler: async (ctx, args) => {
    const samples: CalibrationSample[] = args.samples.map((sample) => ({
      rawConfidence: sample.rawConfidence,
      correct: sample.correct,
    }));
    const result = await upsertCalibrationRow(ctx, {
      workspaceId: args.workspaceId,
      ...(args.entityId ? { entityId: args.entityId } : {}),
      samples,
      method: "temperature",
      fittedFrom: args.fittedFrom,
    });
    return {
      calibrationId: result.calibrationId,
      scope: args.entityId ? ("entity" as const) : ("workspace" as const),
      sampleCount: result.params.sampleCount,
      positiveCount: result.params.positiveCount,
    };
  },
});

/**
 * Production-callable (admin) fit-and-persist. For each in-scope entity it runs a
 * holdout eval, collects the (confidence, correct) pairs, and:
 *   - if the entity has >= MIN_MIXED_OUTCOME_SAMPLES mixed-outcome samples →
 *     persists that entity's OWN per-entity calibration;
 *   - otherwise its samples join a workspace pool used to fit the WORKSPACE
 *     FALLBACK row (so thin entities inherit a real fit instead of identity).
 * Refit cadence = the eval; this is the trigger settings/onboarding/cron call.
 * AI_AUTONOMY_THRESHOLDS is never touched — only the calibration the gate reads.
 */
export const fitEntityCalibrationsFromHoldout = action({
  args: {
    entityId: v.id("entities"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const scope = await ctx.runMutation(listWorkspaceEntitiesForCalibrationRef, {
      sourceEntityId: args.entityId,
    });

    const perEntity: Array<{
      entityId: Id<"entities">;
      scope: "entity" | "workspace_fallback";
      sampleCount: number;
      positiveCount: number;
      providerMode: "active" | "degraded";
    }> = [];
    const fallbackPool: Array<{ rawConfidence: number; correct: boolean }> = [];

    for (const entityId of scope.entityIds) {
      const evaluation = await ctx.runAction(runHoldoutCategorizationEvalRef, {
        sourceEntityId: entityId,
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
      });
      const samples = evaluation.cases
        .filter((c): c is { confidence: number; correct: boolean } => typeof c.confidence === "number")
        .map((c) => ({ rawConfidence: c.confidence, correct: c.correct }));

      if (hasSufficientMixedOutcomes(samples)) {
        const persisted = await ctx.runMutation(persistEntityCalibrationInternalRef, {
          workspaceId: scope.workspaceId,
          entityId,
          samples,
          fittedFrom: "per_entity_holdout",
        });
        perEntity.push({
          entityId,
          scope: "entity",
          sampleCount: persisted.sampleCount,
          positiveCount: persisted.positiveCount,
          providerMode: evaluation.providerMode,
        });
      } else {
        // Thin entity — defer to the workspace-level fallback fit below.
        fallbackPool.push(...samples);
        perEntity.push({
          entityId,
          scope: "workspace_fallback",
          sampleCount: samples.length,
          positiveCount: samples.filter((s) => s.correct).length,
          providerMode: evaluation.providerMode,
        });
      }
    }

    // Fit the workspace fallback from the pooled thin-entity samples so entities
    // below the per-entity threshold inherit a real (or identity) calibration.
    const fallback = await ctx.runMutation(persistEntityCalibrationInternalRef, {
      workspaceId: scope.workspaceId,
      samples: fallbackPool,
      fittedFrom: "workspace_fallback_holdout_pool",
    });

    return {
      workspaceId: scope.workspaceId,
      entityCount: scope.entityIds.length,
      perEntity,
      fallback: {
        calibrationId: fallback.calibrationId,
        sampleCount: fallback.sampleCount,
        positiveCount: fallback.positiveCount,
      },
    };
  },
});

/**
 * Internal: list entities (across all workspaces) that carry seeded eval rows, so
 * the refit cron can recalibrate only entities that actually have a holdout. No
 * human auth — internal/system only.
 */
export const listEvalCapableEntities = internalMutation({
  args: {},
  handler: async (ctx) => {
    const entities = await ctx.db.query("entities").take(500);
    const capable: Array<{ entityId: Id<"entities">; workspaceId: Id<"workspaces"> }> = [];
    for (const entity of entities) {
      const evalRow = await ctx.db
        .query("transactions")
        .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
        .filter((q) => q.eq(q.field("evalSet"), true))
        .first();
      if (evalRow) capable.push({ entityId: entity._id, workspaceId: entity.workspaceId });
    }
    return capable;
  },
});

const fitEntityCalibrationsFromHoldoutRef = makeFunctionReference<
  "action",
  { entityId: Id<"entities">; limit?: number },
  unknown
>("ai:fitEntityCalibrationsFromHoldout");
const listEvalCapableEntitiesRef = makeFunctionReference<
  "mutation",
  Record<string, never>,
  Array<{ entityId: Id<"entities">; workspaceId: Id<"workspaces"> }>
>("ai:listEvalCapableEntities");

/**
 * E2-T10 refit cron entrypoint. Recalibrates every eval-capable entity so the
 * persisted calibration tracks the live confidence distribution over time. SAFE:
 * a no-op on workspaces without seeded eval rows, never touches the ledger, and
 * only ever tightens the auto-post gate (conservative-only clamp). One refit per
 * workspace is enough to also write that workspace's fallback row.
 */
export const refitAllCalibrations = internalAction({
  args: {},
  handler: async (ctx) => {
    const capable = await ctx.runMutation(listEvalCapableEntitiesRef, {});
    const seenWorkspaces = new Set<string>();
    let refitWorkspaces = 0;
    for (const { entityId, workspaceId } of capable) {
      if (seenWorkspaces.has(workspaceId)) continue;
      seenWorkspaces.add(workspaceId);
      try {
        await ctx.runAction(fitEntityCalibrationsFromHoldoutRef, { entityId });
        refitWorkspaces += 1;
      } catch {
        // A single workspace's eval failing (e.g. degraded provider) must not
        // abort the whole cron — skip and continue.
      }
    }
    return { refitWorkspaces };
  },
});

// ---------------------------------------------------------------------------
// E14-T4 Committed gold categorization eval
// ---------------------------------------------------------------------------
// Unlike the demo-seeded holdout, this scores the SAME committed, label-safe
// gold set on every run (convex/fixtures/categorizationGold.ts), against the
// shared 80% target, and persists to aiEvalRuns. The accuracy math is the pure
// scoreCategorizationAccuracy() helper (unit-tested deterministically), and CI
// can score it against a recorded/degraded provider without any live AI key.

/**
 * Build a fresh, isolated eval entity, seed it with the standard chart of
 * accounts, and project each committed gold row onto that entity's matching
 * account by NUMBER. The gold's expected label is mapped here (server-side) and
 * never sent into the route call, so prediction can't leak the answer.
 */
export const prepareGoldCategorizationEval = internalMutation({
  args: { sourceEntityId: v.id("entities") },
  handler: async (ctx, args) => {
    const { entity: sourceEntity, userId } = await requireEntityAccess(ctx, args.sourceEntityId);
    const now = Date.now();

    const slug = await uniqueEvalSlug(ctx, sourceEntity.workspaceId, `gold-${now.toString(36)}`);
    const evalEntityId = await ctx.db.insert("entities", {
      workspaceId: sourceEntity.workspaceId,
      name: `Gold Categorization Eval ${new Date(now).toISOString()}`,
      slug,
      businessType: sourceEntity.businessType,
      currency: "USD",
      isDemo: false,
      archived: false,
      fiscalYearStartMonth: sourceEntity.fiscalYearStartMonth ?? 1,
      accountingBasis: sourceEntity.accountingBasis ?? "accrual",
      legalName: "Gold Categorization Eval",
      createdAt: now,
      updatedAt: now,
    });
    const evalEntity = (await ctx.db.get(evalEntityId))!;
    await seedChartForEntity(ctx, evalEntity, chartTemplatesForType(evalEntity.businessType));
    const bankAccountId = await ensureDefaultBankAccountForEntity(ctx, evalEntity);
    const evalAccounts = await ctx.db
      .query("ledgerAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", evalEntityId))
      .take(250);
    const evalAccountsByNumber = new Map(evalAccounts.map((account) => [account.number, account]));

    const cases: GoldEvalCase[] = [];
    for (const [index, row] of CATEGORIZATION_GOLD.entries()) {
      const expected = evalAccountsByNumber.get(row.expectedAccountNumber);
      if (!expected) continue; // chart lacks this number; skip rather than mislabel.
      cases.push({
        goldId: row.id,
        date: `2026-06-${String((index % 27) + 1).padStart(2, "0")}`,
        amountMinor: row.amountMinor,
        currency: row.currency,
        merchant: row.merchant,
        rawDescription: row.description,
        expectedAccountId: expected._id,
        expectedAccountNumber: expected.number,
        expectedAccountName: expected.name,
      });
    }

    await ctx.db.insert("auditEvents", {
      workspaceId: sourceEntity.workspaceId,
      actorUserId: userId,
      action: "ai.eval.gold.started",
      entityType: "entity",
      entityId: evalEntityId,
      summary: `Started committed gold categorization eval with ${cases.length} rows`,
      createdAt: now,
    });

    return {
      sourceEntityId: sourceEntity._id,
      evalEntityId,
      bankAccountId,
      currency: evalEntity.currency,
      runKey: slug,
      cases,
    };
  },
});

/**
 * Score the committed gold set against the live categorizer and persist the
 * result to aiEvalRuns. Routes each gold row through the same single
 * categorization path the product uses (no label leakage), scores predicted vs
 * expected account number with the pure scoreCategorizationAccuracy() helper,
 * and reports PASS/FAIL vs the 80% target. Works without a live AI key: the
 * categorizer degrades to Inbox when no provider is active, which simply scores
 * as below_target — the run still completes and persists, emitting no secrets.
 */
export const runGoldCategorizationEval = action({
  args: { sourceEntityId: v.id("entities") },
  handler: async (ctx, args) => {
    const prepared = await ctx.runMutation(prepareGoldCategorizationEvalRef, {
      sourceEntityId: args.sourceEntityId,
    });

    const cases: Array<{
      goldId: string;
      merchant: string;
      amountMinor: number;
      expectedAccountNumber: string;
      expectedAccountName: string;
      predictedAccountNumber: string | null;
      predictedAccountName: string | null;
    }> = [];

    for (const [index, item] of prepared.cases.entries()) {
      const routed = await ctx.runAction(categorizeAndRouteTransactionRef, {
        entityId: prepared.evalEntityId,
        bankAccountId: prepared.bankAccountId,
        date: item.date,
        amountMinor: item.amountMinor,
        currency: item.currency,
        merchant: item.merchant,
        rawDescription: item.rawDescription,
        status: "posted",
        source: "bank",
        externalId: `gold:${prepared.runKey}:${index}:${item.goldId}`,
      });
      const observed = await ctx.runQuery(holdoutTransactionResultRef, {
        transactionId: routed.route.transactionId,
      });
      cases.push({
        goldId: item.goldId,
        merchant: item.merchant,
        amountMinor: item.amountMinor,
        expectedAccountNumber: item.expectedAccountNumber,
        expectedAccountName: item.expectedAccountName,
        predictedAccountNumber: observed.categoryAccountNumber,
        predictedAccountName: observed.categoryAccountName,
      });
    }

    const score = scoreCategorizationAccuracy(cases, CATEGORIZATION_TARGET_ACCURACY);
    const finding =
      score.status === "no_eval_rows"
        ? "The committed gold set produced no scorable rows (chart mismatch)."
        : score.status === "meets_target"
          ? `Gold categorization accuracy ${(score.accuracy * 100).toFixed(1)}% meets the ${(score.targetAccuracy * 100).toFixed(1)}% target.`
          : `Gold categorization accuracy ${(score.accuracy * 100).toFixed(1)}% is below the ${(score.targetAccuracy * 100).toFixed(1)}% target; this is a product quality finding, not a backend blocker.`;

    const recorded = await ctx.runMutation(recordHoldoutCategorizationEvalRunRef, {
      sourceEntityId: prepared.sourceEntityId,
      evalEntityId: prepared.evalEntityId,
      evaluatedCount: score.evaluatedCount,
      correctCount: score.correctCount,
      accuracy: score.accuracy,
      targetAccuracy: score.targetAccuracy,
      status: score.status,
      finding,
    });

    return {
      evalRunId: recorded.evalRunId,
      sourceEntityId: prepared.sourceEntityId,
      evalEntityId: prepared.evalEntityId,
      generatedAt: new Date().toISOString(),
      method: "committed_gold_label_safe",
      datasetSize: CATEGORIZATION_GOLD.length,
      providerMode: recorded.providerMode,
      ...score,
      finding,
      cases,
    };
  },
});

/**
 * E6.1 + E6.5: derive a calibration from the eval's own scored
 * (confidence, correct) pairs, report ECE before/after, and compute auto-post
 * PRECISION under both the raw gate and the calibrated gate (with the
 * business-impact gate active). Items without a confidence are excluded.
 */
function summarizeHoldoutCalibration(results: HoldoutEvalResult[], baseThreshold: number) {
  const scored = results.filter(
    (result): result is HoldoutEvalResult & { confidence: number } => typeof result.confidence === "number",
  );
  const samples: CalibrationSample[] = scored.map((result) => ({
    rawConfidence: result.confidence,
    correct: result.correct,
  }));
  const params = fitCalibration(samples, "temperature");
  const before = reliabilityReport(
    samples.map((sample) => ({ probability: sample.rawConfidence, correct: sample.correct })),
  );
  const after = reliabilityReport(
    samples.map((sample) => ({
      probability: applyCalibration(sample.rawConfidence, params),
      correct: sample.correct,
    })),
  );
  const precisionItems = scored.map((result) => ({
    rawConfidence: result.confidence,
    correct: result.correct,
    amountMinor: result.amountMinor,
  }));
  const rawGate = autoPostPrecisionSummary(precisionItems, {
    baseThreshold,
    calibration: IDENTITY_CALIBRATION,
  });
  const calibratedGate = autoPostPrecisionSummary(precisionItems, { baseThreshold, calibration: params });
  return {
    params,
    scoredCount: scored.length,
    eceBefore: before.ece,
    eceAfter: after.ece,
    reliabilityBefore: before.buckets,
    reliabilityAfter: after.buckets,
    rawGate,
    calibratedGate,
    baseThreshold,
  };
}
