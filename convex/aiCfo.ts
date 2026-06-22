"use node";

import { generateText } from "ai";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";
import type { CfoSignal, CfoSignals } from "./aiCfoAggregate";
import { buildModelForProvider } from "./aiProvider";
import { resolveActiveAiModel } from "./aiResolve";
import {
  cardNumbersAreSupported,
  numericTokensFromSignals,
} from "./aiCfoVerify";

/**
 * AI CFO advisory engine (Epic E9-T4).
 *
 * Wraps the grounded aggregate (aiCfoAggregate.ts / E9-T3) in an action that
 * turns the typed CfoSignals into plain-English advisory CARDS. The numbers are
 * NEVER sourced by the model: the deterministic fallback (built directly from the
 * signals) is BOTH the safety net AND the ground truth, and every model-narrated
 * card is cross-checked so any card mentioning a figure absent from the signals
 * is dropped.
 *
 * Provider rule (decisions Q11/Q18/Q44): narration runs through the
 * provider-agnostic AI SDK runtime — `resolveActiveAiModel` (the unified E3
 * `credentials` resolver, `kind:"ai"`) + `buildModelForProvider`. It is a
 * CONSUMER of E3's resolver; it never reads bedrockRuntimeEnv and never
 * hard-requires Bedrock. When no key is configured it returns the deterministic
 * cards and NEVER throws.
 *
 * Money rule (decisions Q48): USD integer minor units summed directly — display
 * formatting only happens here, never for stored values.
 */

export type AdvisorySeverity = "info" | "watch" | "warn";

export type AdvisoryCard = {
  /** Stable key tying back to the CfoSignal (drill-down routing in E9-T5/T7). */
  signalKey: string;
  title: string;
  body: string;
  severity: AdvisorySeverity;
};

export type AdvisoriesResult = {
  summary: string;
  cards: AdvisoryCard[];
  generatedAt: number;
  /** Where the narration came from, for the UI's "computed advice" note. */
  source: "ai" | "deterministic";
  disclaimer: string;
  taxDisclaimer: string;
  // Echo the headline grounded numbers so the surface and digest can render
  // without a second round-trip and bind to identical figures.
  asOf: string;
  cashPositionMinor: number;
  monthlyBurnMinor: number;
  runwayMonths: number | null;
};

const DISCLAIMER = "AI-generated estimate, review before relying.";

// Owner-friendly money formatting from integer minor units. Display only — never
// used for stored values.
function formatMoney(amountMinor: number, currency: string): string {
  const major = Math.round(amountMinor / 100);
  const sign = major < 0 ? "-" : "";
  const body = Math.abs(major).toLocaleString("en-US");
  return `${sign}${currency} ${body}`;
}

// ---------------------------------------------------------------------------
// Deterministic card builder — the ground truth. Built PURELY from CfoSignals so
// every number is, by construction, present in the aggregate.
// ---------------------------------------------------------------------------

function deterministicBody(signal: CfoSignal, currency: string): string {
  switch (signal.family) {
    case "runway": {
      if (signal.metricMinor === null) return "You are cash-flow positive — no burn to project a runway from.";
      const cash = formatMoney(signal.metricMinor, currency);
      const burn = signal.comparatorMinor !== null ? formatMoney(signal.comparatorMinor, currency) : null;
      return burn
        ? `You hold ${cash} in cash and are burning about ${burn} a month.`
        : `You hold ${cash} in cash.`;
    }
    case "income_trend": {
      const now = signal.metricMinor !== null ? formatMoney(signal.metricMinor, currency) : "this period's revenue";
      const avg = signal.comparatorMinor !== null ? formatMoney(signal.comparatorMinor, currency) : "your 3-month average";
      return `Revenue is ${now} versus a 3-month average of ${avg}.`;
    }
    case "expense_creep": {
      const now = signal.metricMinor !== null ? formatMoney(signal.metricMinor, currency) : "this month";
      const avg = signal.comparatorMinor !== null ? formatMoney(signal.comparatorMinor, currency) : "its trailing average";
      return `Spending here is ${now} this month versus ${avg} on average — worth a look.`;
    }
    case "concentration": {
      const top = signal.metricMinor !== null ? formatMoney(signal.metricMinor, currency) : "your top customer";
      const total = signal.comparatorMinor !== null ? formatMoney(signal.comparatorMinor, currency) : "period revenue";
      return `Your largest customer accounts for ${top} of ${total} this period — keep that concentration in view.`;
    }
    case "forecast": {
      const projected = signal.metricMinor !== null ? formatMoney(signal.metricMinor, currency) : "your cash";
      return `At the current run-rate plus scheduled items, projected cash in 90 days is about ${projected}.`;
    }
    case "tax": {
      const reserve = signal.metricMinor !== null ? formatMoney(signal.metricMinor, currency) : "a reserve";
      return `Consider parking about ${reserve} for taxes. Estimate only — not tax advice.`;
    }
    case "anomaly":
      // The anomaly signal already carries an owner-facing title; restate it.
      return signal.title;
    default:
      return signal.title;
  }
}

function buildDeterministicCards(signals: CfoSignals): AdvisoryCard[] {
  return signals.signals.map((signal) => ({
    signalKey: signal.key,
    title: signal.title,
    body: deterministicBody(signal, signals.entity.currency),
    severity: signal.severity,
  }));
}

function deterministicSummary(signals: CfoSignals): string {
  const currency = signals.entity.currency;
  const parts: string[] = [];
  if (signals.runwayMonths !== null) {
    parts.push(`about ${signals.runwayMonths.toFixed(1)} months of runway`);
  } else {
    parts.push("a cash-flow-positive month");
  }
  parts.push(`${formatMoney(signals.cashPositionMinor, currency)} in cash`);
  const warnings = signals.signals.filter((signal) => signal.severity === "warn").length;
  if (warnings > 0) parts.push(`${warnings} thing${warnings === 1 ? "" : "s"} to watch`);
  return `You have ${parts.join(", ")}.`;
}

function deterministicResult(signals: CfoSignals): AdvisoriesResult {
  return {
    summary: deterministicSummary(signals),
    cards: buildDeterministicCards(signals),
    generatedAt: Date.now(),
    source: "deterministic",
    disclaimer: DISCLAIMER,
    taxDisclaimer: signals.taxDisclaimer,
    asOf: signals.asOf,
    cashPositionMinor: signals.cashPositionMinor,
    monthlyBurnMinor: signals.monthlyBurnMinor,
    runwayMonths: signals.runwayMonths,
  };
}

// ---------------------------------------------------------------------------
// Strict-JSON prompt + defensive parsing (mirrors aiInsights.ts).
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function truncate(value: string, max: number): string {
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}...` : cleaned;
}

function isSeverity(value: unknown): value is AdvisorySeverity {
  return value === "info" || value === "watch" || value === "warn";
}

// Pull the first balanced {...} object out of arbitrary model text.
function parseFirstJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return asRecord(JSON.parse(text.slice(start, index + 1)));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function buildAdvisoryPrompt(signals: CfoSignals): string {
  // Feed the model the signals JSON and the deterministic cards as the EXACT
  // set of facts it may narrate. It picks tone/wording; it never adds numbers.
  const allowedKeys = signals.signals.map((signal) => signal.key);
  return [
    "You are the AI CFO for OpenBooks, a plain-English bookkeeping app for a small-business owner.",
    "You turn pre-computed financial signals into short, plain-English advisory cards.",
    "Style: real-time burn/runway advisory (like Digits or Puzzle) — concise, concrete, owner-facing.",
    "",
    "STRICT RULE: every number you write MUST already appear in the signals below. NEVER invent, round differently, or compute a new figure. If you are unsure of a number, omit it.",
    "Money values in the signals are integer minor units (cents); divide by 100 when you mention an amount.",
    `Currency: ${signals.entity.currency}.`,
    "Tone per card: 'warn' (needs attention, but never alarmist for ordinary spend), 'watch' (keep an eye on it), 'info' (good or neutral).",
    "",
    "Return ONLY strict JSON, no markdown, in exactly this shape:",
    '{"summary":"one sentence overview","cards":[{"signalKey":"<one of the provided keys>","title":"short label","body":"one or two sentences","severity":"info|watch|warn"}]}',
    `Use ONLY these signalKeys: ${JSON.stringify(allowedKeys)}. One card per signal, same order.`,
    "Keep each title under 9 words and each body under 32 words.",
    "",
    "Signals (JSON):",
    truncate(JSON.stringify(signals.signals), 4000),
  ].join("\n");
}

function parseAdvisoriesJson(
  text: string,
  allowedKeys: Set<string>,
): { summary: string; cards: AdvisoryCard[] } | null {
  const raw = parseFirstJsonObject(text);
  if (!raw) return null;
  const summary =
    typeof raw.summary === "string" && raw.summary.trim().length > 0 ? truncate(raw.summary, 240) : null;
  if (!summary) return null;

  const rawCards = Array.isArray(raw.cards) ? raw.cards : [];
  const cards: AdvisoryCard[] = [];
  for (const candidate of rawCards) {
    const record = asRecord(candidate);
    if (!record) continue;
    const signalKey = typeof record.signalKey === "string" ? record.signalKey : "";
    // The model may only narrate keys we provided — never a fabricated one.
    if (!allowedKeys.has(signalKey)) continue;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const body = typeof record.body === "string" ? record.body.trim() : "";
    if (!title && !body) continue;
    cards.push({
      signalKey,
      title: truncate(title || body, 80),
      body: truncate(body || title, 280),
      severity: isSeverity(record.severity) ? record.severity : "info",
    });
  }
  if (cards.length === 0) return null;
  return { summary, cards };
}

// ---------------------------------------------------------------------------
// The action
// ---------------------------------------------------------------------------

type RunQuery = Pick<ActionCtx, "runQuery">;

async function loadSignals(
  ctx: RunQuery,
  entityId?: Id<"entities">,
): Promise<CfoSignals | null> {
  return (await ctx.runQuery(internal.aiCfoAggregate.cfoSignalsForEntityAuthed, {
    ...(entityId ? { entityId } : {}),
  })) as CfoSignals | null;
}

export const generateAdvisories = action({
  args: {
    entityId: v.optional(v.id("entities")),
    today: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AdvisoriesResult> => {
    const signals = await loadSignals(ctx, args.entityId);
    if (!signals) {
      // No data or no access. Return an empty, honest result (never throw).
      return {
        summary: "No financial data is available for this business yet.",
        cards: [],
        generatedAt: Date.now(),
        source: "deterministic",
        disclaimer: DISCLAIMER,
        taxDisclaimer:
          "Estimate only — not tax advice. Confirm any reserve with a tax professional.",
        asOf: args.today ?? new Date(Date.now()).toISOString().slice(0, 10),
        cashPositionMinor: 0,
        monthlyBurnMinor: 0,
        runwayMonths: null,
      };
    }

    const deterministic = deterministicResult(signals);

    // Resolve the workspace's active AI provider via the unified credential
    // resolver (E3). No path is hardwired to Bedrock. When unresolved, return
    // the deterministic cards — never block on AI, never fabricate.
    const workspaceId = await ctx.runQuery(internal.aiCfoAggregate.cfoWorkspaceId, {
      ...(args.entityId ? { entityId: args.entityId } : {}),
    });
    if (!workspaceId) return deterministic;

    const resolved = await resolveActiveAiModel(ctx, { workspaceId, purpose: "chat" });
    if (!resolved.ready) return deterministic;

    try {
      const model = buildModelForProvider({
        providerId: resolved.provider,
        modelId: resolved.modelId,
        credential: resolved.credential,
      });
      const result = await generateText({
        model,
        prompt: buildAdvisoryPrompt(signals),
        maxOutputTokens: 900,
        temperature: 0,
        maxRetries: 0,
      });
      const allowedKeys = new Set(signals.signals.map((signal) => signal.key));
      const parsed = parseAdvisoriesJson(result.text, allowedKeys);
      if (!parsed) return deterministic;

      // Cross-check every card's numbers against the signals. Any card citing a
      // figure not present in the aggregate is dropped (no model-invented
      // numbers). For each surviving signalKey we keep the model's card; for any
      // signal the model dropped or that failed verification we keep the
      // deterministic card, so the surface is never missing a grounded signal.
      const allowed = numericTokensFromSignals(signals);
      const verifiedByKey = new Map<string, AdvisoryCard>();
      for (const card of parsed.cards) {
        if (cardNumbersAreSupported(card, allowed)) verifiedByKey.set(card.signalKey, card);
      }
      if (verifiedByKey.size === 0) return deterministic;

      const summarySupported = cardNumbersAreSupported(
        { title: parsed.summary, body: "" },
        allowed,
      );
      const cards = deterministic.cards.map((card) => verifiedByKey.get(card.signalKey) ?? card);

      return {
        summary: summarySupported ? parsed.summary : deterministic.summary,
        cards,
        generatedAt: Date.now(),
        source: "ai",
        disclaimer: DISCLAIMER,
        taxDisclaimer: signals.taxDisclaimer,
        asOf: signals.asOf,
        cashPositionMinor: signals.cashPositionMinor,
        monthlyBurnMinor: signals.monthlyBurnMinor,
        runwayMonths: signals.runwayMonths,
      };
    } catch {
      // Any model/parse/network failure -> deterministic, never throw.
      return deterministic;
    }
  },
});
