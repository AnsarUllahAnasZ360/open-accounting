import { ConvexError, v } from "convex/values";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { buildModelForProvider } from "./aiProvider";
import { resolveActiveAiModel } from "./aiResolve";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";
import { generateText } from "ai";

/**
 * Epic E4-T7 / E4-T8 — the AI "done-for-you books" bulk-setup engine.
 *
 * After connections sync, this reviews the owner-chosen history window, clusters
 * merchants/amounts into candidate INCOME STREAMS + recurring EXPENSE CATEGORIES
 * + suggested RULES, optionally enriches the labels with the owner's configured
 * AI provider (graceful degradation to deterministic clustering with no key),
 * and writes them as a reviewable batch of `onboardingProposals`. A small fixed
 * core set of clarifying questions (<= 5) plus any AI/heuristic-detected
 * ambiguities are persisted as `onboardingQuestions`.
 *
 * The human review/approve gate (E4-T8) lives here too: approving a rule routes
 * through the EXISTING `ai.createConfirmedRule` path (so autonomy thresholds are
 * respected — the rule never auto-posts unless the owner asked AND the
 * categorizer's gate allows it); approving an income stream writes the entity's
 * shared `incomeStreams` taxonomy field; approving a category creates the rule
 * that maps the cluster to that category. Rejecting marks the proposal dismissed.
 *
 * AI PROPOSES, the ledger engine posts: nothing here ever writes a journal line.
 */

// The history window default = pull as much as the connector gives (decision
// Q19). When no explicit start is chosen, we bound the deterministic clustering
// to a now-relative trailing window (NOT a frozen 2026 date) so the engine reads
// real recent history. The chosen start is snapped to the first of its month.
const DEFAULT_TRAILING_DAYS = 730;
// A merchant/amount cluster must recur at least this many times to be a
// candidate income stream / expense category (keeps one-off charges out).
const MIN_CLUSTER_SIZE = 2;
// Cap the number of proposals per kind so the review screen stays scannable.
const MAX_PROPOSALS_PER_KIND = 8;

// ---------------------------------------------------------------------------
// Window resolution (now-relative; never a hardcoded date)
// ---------------------------------------------------------------------------

function isIsoDate(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Floor an ISO date to the first day of its month (M-01). */
function firstOfMonth(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

/**
 * Resolve the inclusive lower bound (ISO date) for the history window. When the
 * owner chose a start, snap it to the first of its month. Otherwise compute a
 * now-relative trailing bound from the server clock — `Date.now()` is pinned
 * once per request so it is deterministic within a single action.
 */
function resolveWindowStart(chosenStart?: string): string {
  if (isIsoDate(chosenStart)) {
    return firstOfMonth(chosenStart);
  }
  const bound = new Date(Date.now() - DEFAULT_TRAILING_DAYS * 24 * 60 * 60 * 1000);
  return bound.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Deterministic clustering (the graceful-degradation core)
// ---------------------------------------------------------------------------

type Signal = {
  merchant: string;
  amountMinor: number;
  date: string;
};

type Cluster = {
  key: string;
  display: string;
  count: number;
  totalMinor: number;
  direction: "inflow" | "outflow";
};

function normalizeMerchantKey(merchant: string): string {
  return merchant
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Cluster signals by normalized merchant + direction. Income (inflow) clusters
 * become candidate income streams; expense (outflow) clusters become candidate
 * categories + rules. Pure function — easy to unit-test deterministically.
 */
export function clusterSignals(signals: Signal[]): {
  incomeClusters: Cluster[];
  expenseClusters: Cluster[];
} {
  const byKey = new Map<string, Cluster>();
  for (const signal of signals) {
    const merchantKey = normalizeMerchantKey(signal.merchant);
    if (merchantKey.length < 2) continue;
    const direction: "inflow" | "outflow" = signal.amountMinor >= 0 ? "inflow" : "outflow";
    const key = `${direction}:${merchantKey}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalMinor += Math.abs(signal.amountMinor);
    } else {
      byKey.set(key, {
        key,
        display: titleCase(merchantKey),
        count: 1,
        totalMinor: Math.abs(signal.amountMinor),
        direction,
      });
    }
  }

  const all = [...byKey.values()].filter((cluster) => cluster.count >= MIN_CLUSTER_SIZE);
  const byTotalDesc = (a: Cluster, b: Cluster) => b.totalMinor - a.totalMinor;
  return {
    incomeClusters: all
      .filter((cluster) => cluster.direction === "inflow")
      .sort(byTotalDesc)
      .slice(0, MAX_PROPOSALS_PER_KIND),
    expenseClusters: all
      .filter((cluster) => cluster.direction === "outflow")
      .sort(byTotalDesc)
      .slice(0, MAX_PROPOSALS_PER_KIND),
  };
}

// The fixed core clarifying questions (<= 5; decision Q22). AI-detected
// ambiguities are appended at generation time.
const CORE_QUESTIONS: Array<{ key: string; prompt: string }> = [
  { key: "primary_income", prompt: "What is your primary source of revenue?" },
  { key: "owner_draws", prompt: "Do you take owner draws or pay yourself a salary from this business?" },
  {
    key: "intercompany",
    prompt: "Do you move money between this business and another one you own (e.g. a sister LLC)?",
  },
  { key: "sales_tax", prompt: "Do you collect sales tax on what you sell?" },
  { key: "loans", prompt: "Do you have any business loans or lines of credit?" },
];

// ---------------------------------------------------------------------------
// Authorization helper (admin on the entity's workspace)
// ---------------------------------------------------------------------------

async function requireEntityAdmin(ctx: QueryCtx | MutationCtx, entityId: Id<"entities">) {
  const entity = await ctx.db.get(entityId);
  if (!entity) {
    throw new ConvexError("OpenBooks business not found.");
  }
  const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
  return { entity, userId };
}

// ---------------------------------------------------------------------------
// Internal: gather the signal set over the chosen window
// ---------------------------------------------------------------------------

export const gatherOnboardingSignals = internalQuery({
  args: { entityId: v.id("entities"), windowStart: v.string() },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks business not found.");
    }
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .collect();
    const signals: Signal[] = transactions
      .filter((transaction) => transaction.review !== "excluded")
      .filter((transaction) => transaction.date >= args.windowStart)
      .map((transaction) => ({
        merchant: transaction.merchant || transaction.rawDescription,
        amountMinor: transaction.amountMinor,
        date: transaction.date,
      }));
    return {
      workspaceId: entity.workspaceId,
      entityName: entity.name,
      businessType: entity.businessType,
      signals,
    };
  },
});

// ---------------------------------------------------------------------------
// Internal: persist a generated batch (supersedes any prior open batch)
// ---------------------------------------------------------------------------

type ProposalDraft = {
  kind: "incomeStream" | "category" | "rule";
  payload: Record<string, unknown>;
  summary: string;
};

export const persistOnboardingBatch = internalMutation({
  args: {
    entityId: v.id("entities"),
    runId: v.string(),
    origin: v.union(v.literal("ai"), v.literal("deterministic")),
    drafts: v.array(
      v.object({
        kind: v.union(v.literal("incomeStream"), v.literal("category"), v.literal("rule")),
        payload: v.any(),
        summary: v.string(),
      }),
    ),
    questions: v.array(
      v.object({ key: v.string(), prompt: v.string(), kind: v.union(v.literal("core"), v.literal("detected")) }),
    ),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks business not found.");
    }
    const now = Date.now();

    // Supersede any still-open proposals from a prior run so the review screen
    // only ever shows the latest batch.
    const open = await ctx.db
      .query("onboardingProposals")
      .withIndex("by_entity_and_status", (q) =>
        q.eq("entityId", args.entityId).eq("status", "proposed"),
      )
      .collect();
    for (const stale of open) {
      await ctx.db.patch(stale._id, { status: "superseded", updatedAt: now });
    }

    // The createdBy must be a real user; the generator runs as an action with no
    // session, so we attribute to the workspace owner membership.
    const ownerMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", entity.workspaceId))
      .collect();
    const owner = ownerMembership.find((m) => m.role === "owner" && m.status === "active")
      ?? ownerMembership.find((m) => m.status === "active");
    if (!owner) {
      throw new ConvexError("No active workspace member to attribute onboarding proposals to.");
    }

    const proposalIds: Id<"onboardingProposals">[] = [];
    for (const draft of args.drafts) {
      const id = await ctx.db.insert("onboardingProposals", {
        workspaceId: entity.workspaceId,
        entityId: args.entityId,
        runId: args.runId,
        kind: draft.kind,
        payload: draft.payload,
        summary: draft.summary,
        status: "proposed",
        origin: args.origin,
        createdBy: owner.userId,
        createdAt: now,
        updatedAt: now,
      });
      proposalIds.push(id);
    }

    // Replace the question set for this entity (idempotent re-run).
    const existingQuestions = await ctx.db
      .query("onboardingQuestions")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .collect();
    for (const existing of existingQuestions) {
      // Preserve answered core questions across re-runs; drop only unanswered.
      if (!existing.answer) await ctx.db.delete(existing._id);
    }
    const answeredKeys = new Set(
      existingQuestions.filter((q) => q.answer).map((q) => q.key),
    );
    for (const question of args.questions) {
      if (answeredKeys.has(question.key)) continue;
      await ctx.db.insert("onboardingQuestions", {
        workspaceId: entity.workspaceId,
        entityId: args.entityId,
        runId: args.runId,
        key: question.key,
        prompt: question.prompt,
        kind: question.kind,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Mark the sync/history step reviewed on the resumable checklist (E4-T1).
    const checklist = await ctx.db
      .query("onboardingChecklists")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", entity.workspaceId))
      .unique();
    if (checklist) {
      const completed = new Set(checklist.completedSteps ?? []);
      completed.add("sync");
      await ctx.db.patch(checklist._id, {
        historyReviewed: true,
        completedSteps: [...completed],
        skippedSteps: (checklist.skippedSteps ?? []).filter((step) => step !== "sync"),
        updatedAt: now,
      });
    }

    return { proposalIds, runId: args.runId };
  },
});

// ---------------------------------------------------------------------------
// AI enrichment (optional; degrades gracefully)
// ---------------------------------------------------------------------------

type EnrichmentResult = {
  incomeStreamLabels: Record<string, string>;
  detectedQuestions: Array<{ key: string; prompt: string }>;
};

function parseEnrichment(text: string): EnrichmentResult | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < 0) return null;
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      incomeStreams?: Array<{ merchant?: string; label?: string }>;
      questions?: Array<{ prompt?: string }>;
    };
    const incomeStreamLabels: Record<string, string> = {};
    for (const stream of parsed.incomeStreams ?? []) {
      if (stream?.merchant && stream?.label) {
        incomeStreamLabels[normalizeMerchantKey(stream.merchant)] = String(stream.label).slice(0, 80);
      }
    }
    const detectedQuestions: Array<{ key: string; prompt: string }> = [];
    (parsed.questions ?? []).slice(0, 3).forEach((q, index) => {
      if (q?.prompt) {
        detectedQuestions.push({ key: `detected_${index}`, prompt: String(q.prompt).slice(0, 200) });
      }
    });
    return { incomeStreamLabels, detectedQuestions };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public action: generate the batch
// ---------------------------------------------------------------------------

export const generateOnboardingProposals = action({
  args: {
    entityId: v.id("entities"),
    // Optional "start my books on…" date; snapped to the first of its month.
    // Omitted => pull as much as the connector gives (now-relative bound).
    startDate: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    runId: string;
    origin: "ai" | "deterministic";
    proposalCount: number;
    windowStart: string;
  }> => {
    // Authorize via an internal query (actions cannot read the DB directly).
    const gathered = await ctx.runQuery(internal.onboardingProposals.gatherOnboardingSignals, {
      entityId: args.entityId,
      windowStart: resolveWindowStart(args.startDate),
    });
    const windowStart = resolveWindowStart(args.startDate);

    const { incomeClusters, expenseClusters } = clusterSignals(gathered.signals);

    // Try to enrich income-stream labels + detect ambiguities with the owner's
    // configured provider. Any failure degrades to deterministic clustering.
    let origin: "ai" | "deterministic" = "deterministic";
    let enrichment: EnrichmentResult | null = null;
    try {
      const resolved = await resolveActiveAiModel(ctx, {
        workspaceId: gathered.workspaceId,
        purpose: "categorize",
      });
      if (resolved.ready && (incomeClusters.length > 0 || expenseClusters.length > 0)) {
        const model = buildModelForProvider({
          providerId: resolved.provider,
          modelId: resolved.modelId,
          credential: resolved.credential,
        });
        const prompt = buildEnrichmentPrompt(
          gathered.entityName,
          gathered.businessType,
          incomeClusters,
          expenseClusters,
        );
        const result = await generateText({
          model,
          prompt,
          maxOutputTokens: 600,
          temperature: 0,
          maxRetries: 0,
        });
        enrichment = parseEnrichment(result.text);
        if (enrichment) origin = "ai";
      }
    } catch {
      enrichment = null;
      origin = "deterministic";
    }

    const drafts = buildDrafts(incomeClusters, expenseClusters, enrichment);
    const questions = [
      ...CORE_QUESTIONS.map((q) => ({ ...q, kind: "core" as const })),
      ...(enrichment?.detectedQuestions ?? []).map((q) => ({ ...q, kind: "detected" as const })),
    ];

    const runId = `onb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const persisted = await ctx.runMutation(internal.onboardingProposals.persistOnboardingBatch, {
      entityId: args.entityId,
      runId,
      origin,
      drafts,
      questions,
    });

    return {
      runId: persisted.runId,
      origin,
      proposalCount: persisted.proposalIds.length,
      windowStart,
    };
  },
});

function buildDrafts(
  incomeClusters: Cluster[],
  expenseClusters: Cluster[],
  enrichment: EnrichmentResult | null,
): ProposalDraft[] {
  const drafts: ProposalDraft[] = [];

  for (const cluster of incomeClusters) {
    const merchantKey = cluster.key.replace(/^inflow:/, "");
    const aiLabel = enrichment?.incomeStreamLabels[merchantKey];
    const label = aiLabel ?? `${cluster.display} revenue`;
    drafts.push({
      kind: "incomeStream",
      payload: {
        label,
        merchantContains: cluster.display,
        sampleCount: cluster.count,
        totalMinor: cluster.totalMinor,
      },
      summary: `Income stream "${label}" — ${cluster.count} deposits totaling $${(cluster.totalMinor / 100).toFixed(2)} from ${cluster.display}.`,
    });
  }

  for (const cluster of expenseClusters) {
    drafts.push({
      kind: "category",
      payload: {
        merchantContains: cluster.display,
        suggestedCategory: cluster.display,
        sampleCount: cluster.count,
        totalMinor: cluster.totalMinor,
      },
      summary: `Recurring expense at ${cluster.display} — ${cluster.count} charges totaling $${(cluster.totalMinor / 100).toFixed(2)}.`,
    });
    drafts.push({
      kind: "rule",
      payload: {
        merchantContains: cluster.display,
        autoPost: false,
        sampleCount: cluster.count,
      },
      summary: `Rule: when a merchant contains "${cluster.display}", categorize it the same way each time.`,
    });
  }

  return drafts;
}

function buildEnrichmentPrompt(
  entityName: string,
  businessType: string,
  incomeClusters: Cluster[],
  expenseClusters: Cluster[],
): string {
  const income = incomeClusters
    .map((c) => `- ${c.display} (${c.count} deposits, $${(c.totalMinor / 100).toFixed(0)})`)
    .join("\n");
  const expense = expenseClusters
    .map((c) => `- ${c.display} (${c.count} charges, $${(c.totalMinor / 100).toFixed(0)})`)
    .join("\n");
  return [
    `You are setting up bookkeeping for "${entityName}", a ${businessType} business.`,
    "Given the recurring deposits and charges below, propose a short plain-English revenue-stream label for each deposit source, and up to 3 clarifying questions a bookkeeper would ask the owner.",
    "",
    "Recurring deposits (income):",
    income || "- (none)",
    "",
    "Recurring charges (expenses):",
    expense || "- (none)",
    "",
    'Respond with ONLY JSON: {"incomeStreams":[{"merchant":"<source>","label":"<stream label>"}],"questions":[{"prompt":"<question>"}]}',
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Review/approve queries + mutations (E4-T8)
// ---------------------------------------------------------------------------

export const listOnboardingProposals = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    await requireEntityAdmin(ctx, args.entityId);
    const rows = await ctx.db
      .query("onboardingProposals")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .collect();
    return rows
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((row) => ({
        id: row._id,
        kind: row.kind,
        summary: row.summary,
        status: row.status,
        origin: row.origin,
        payload: row.payload,
        resultSummary: row.resultSummary ?? null,
        createdAt: row.createdAt,
      }));
  },
});

export const listOnboardingQuestions = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    await requireEntityAdmin(ctx, args.entityId);
    const rows = await ctx.db
      .query("onboardingQuestions")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .collect();
    return rows
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((row) => ({
        id: row._id,
        key: row.key,
        prompt: row.prompt,
        kind: row.kind,
        answer: row.answer ?? null,
      }));
  },
});

export const answerOnboardingQuestion = mutation({
  args: { questionId: v.id("onboardingQuestions"), answer: v.string() },
  handler: async (ctx, args) => {
    const question = await ctx.db.get(args.questionId);
    if (!question) {
      throw new ConvexError("Onboarding question not found.");
    }
    await requireEntityAdmin(ctx, question.entityId);
    const now = Date.now();
    await ctx.db.patch(question._id, {
      answer: args.answer.trim().slice(0, 500),
      answeredAt: now,
      updatedAt: now,
    });
    return { questionId: question._id };
  },
});

/**
 * Approve one onboarding proposal (E4-T8). Routes each kind through the existing
 * confirm path:
 *  - rule     -> ai.createConfirmedRule (autonomy thresholds respected; never
 *                silently auto-posts).
 *  - category -> ai.createConfirmedRule mapping the merchant cluster (the owner
 *                may override the category account before approving).
 *  - incomeStream -> appends the approved label to the entity's shared
 *                `incomeStreams` taxonomy field (read by E2/E9).
 * Edit-before-approve is supported via the optional override args.
 */
export const approveOnboardingProposal = mutation({
  args: {
    proposalId: v.id("onboardingProposals"),
    // Edit-before-approve overrides.
    label: v.optional(v.string()),
    categoryAccountId: v.optional(v.id("ledgerAccounts")),
    autoPost: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) {
      throw new ConvexError("Onboarding proposal not found.");
    }
    const { entity, userId } = await requireEntityAdmin(ctx, proposal.entityId);
    if (proposal.status === "confirmed") {
      throw new ConvexError("This proposal was already approved.");
    }
    if (proposal.status !== "proposed") {
      throw new ConvexError(`This proposal can no longer be approved (status: ${proposal.status}).`);
    }

    const payload = proposal.payload as Record<string, unknown>;
    const now = Date.now();
    let resultSummary: string;

    if (proposal.kind === "incomeStream") {
      const label = (args.label ?? String(payload.label ?? "")).trim().slice(0, 80);
      if (label.length < 2) {
        throw new ConvexError("Give the income stream a name.");
      }
      const current = Array.isArray(entity.incomeStreams) ? entity.incomeStreams : [];
      const exists = current.some(
        (stream) => stream.label.toLowerCase() === label.toLowerCase(),
      );
      const next = exists
        ? current
        : [...current, { label, ...(args.categoryAccountId ? { accountId: args.categoryAccountId } : {}) }];
      await ctx.db.patch(entity._id, { incomeStreams: next, updatedAt: now });
      await ctx.db.insert("auditEvents", {
        workspaceId: entity.workspaceId,
        actorUserId: userId,
        action: "onboarding.income_stream.approved",
        entityType: "entity",
        entityId: entity._id,
        summary: `Approved onboarding income stream "${label}"`,
        createdAt: now,
      });
      resultSummary = `Added income stream "${label}".`;
    } else {
      // rule + category both create/confirm a rule through the existing path.
      const merchant = String(payload.merchantContains ?? "").trim();
      if (merchant.length < 2) {
        throw new ConvexError("This proposal has no merchant to build a rule from.");
      }
      const created: { ruleId: Id<"rules">; status: "created" | "updated"; categoryName: string } =
        await ctx.runMutation(api.ai.createConfirmedRule, {
          entityId: entity._id,
          merchantContains: merchant,
          ...(args.categoryAccountId ? { categoryAccountId: args.categoryAccountId } : {}),
          // Autonomy is respected downstream: createConfirmedRule stores the flag
          // and the categorizer's gate still decides whether a hit auto-posts.
          autoPost: Boolean(args.autoPost),
        });
      resultSummary = `Rule ${created.status}: "${merchant}" → ${created.categoryName}.`;
    }

    await ctx.db.patch(proposal._id, {
      status: "confirmed",
      decidedBy: userId,
      decidedAt: now,
      resultSummary,
      updatedAt: now,
    });
    return { proposalId: proposal._id, status: "confirmed" as const, resultSummary };
  },
});

export const rejectOnboardingProposal = mutation({
  args: { proposalId: v.id("onboardingProposals") },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) {
      throw new ConvexError("Onboarding proposal not found.");
    }
    const { userId } = await requireEntityAdmin(ctx, proposal.entityId);
    if (proposal.status === "confirmed") {
      throw new ConvexError("An approved proposal cannot be rejected.");
    }
    if (proposal.status !== "proposed") {
      return { proposalId: proposal._id, status: proposal.status };
    }
    const now = Date.now();
    await ctx.db.patch(proposal._id, {
      status: "dismissed",
      decidedBy: userId,
      decidedAt: now,
      updatedAt: now,
    });
    return { proposalId: proposal._id, status: "dismissed" as const };
  },
});

/**
 * Complete the proposal-review step (E4-T8): mark `proposalsReviewed` on the
 * resumable checklist and advance the onboarding phase to 'done'. Idempotent.
 */
export const completeProposalReview = mutation({
  args: {},
  handler: async (ctx) => {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const checklist = await ctx.db
      .query("onboardingChecklists")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
      .unique();
    const now = Date.now();
    if (checklist) {
      const completed = new Set(checklist.completedSteps ?? []);
      completed.add("review");
      await ctx.db.patch(checklist._id, {
        proposalsReviewed: true,
        phase: "done",
        completedSteps: [...completed],
        skippedSteps: (checklist.skippedSteps ?? []).filter((step) => step !== "review"),
        updatedAt: now,
      });
    }
    return { phase: "done" as const };
  },
});
