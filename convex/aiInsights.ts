"use node";

import { generateText } from "ai";
import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";
import {
  findingNumbersAreSupported,
  numericTokensFromAggregate,
} from "./aiInsightsVerify";
import { buildModelForProvider } from "./aiProvider";
import { resolveActiveAiModel } from "./aiResolve";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

type Tone = "positive" | "neutral" | "warning";

type Finding = {
  title: string;
  detail: string;
  tone: Tone;
};

export type InsightsResult = {
  summary: string;
  findings: Finding[];
  generatedAt: number;
  disclaimer: string;
};

const DEFAULT_DISCLAIMER =
  "AI-generated and may be inaccurate. Review before relying on it.";

type Section =
  | "transactions"
  | "income"
  | "expenses"
  | "bills"
  | "contacts"
  | "payroll";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isToneString(value: unknown): value is Tone {
  return value === "positive" || value === "neutral" || value === "warning";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function truncate(value: string, max: number): string {
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}...` : cleaned;
}

// Owner-friendly money formatting from integer minor units. Never used for
// stored values — display only.
function formatMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  const sign = major < 0 ? "-" : "";
  const body = Math.abs(major).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `${sign}${currency} ${body}`;
}

function signedMoney(amountMinor: number, currency: string): string {
  if (amountMinor > 0) return `+${formatMoney(amountMinor, currency)}`;
  return formatMoney(amountMinor, currency);
}

function deltaTone(deltaMinor: number, higherIsGood: boolean): Tone {
  if (deltaMinor === 0) return "neutral";
  const good = higherIsGood ? deltaMinor > 0 : deltaMinor < 0;
  return good ? "positive" : "warning";
}

// Pull the first balanced {...} JSON object out of arbitrary model text and
// parse it defensively. Mirrors the categorizer's resilient extraction.
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

// ---------------------------------------------------------------------------
// Aggregate gathering — compact, section-shaped numbers used for BOTH the
// prompt and the deterministic fallback. `currency` and `headline` give the
// fallback enough to stand on its own without re-querying.
// ---------------------------------------------------------------------------

type SectionAggregate = {
  currency: string;
  // A compact JSON-able object of the section's key numbers, fed to the model.
  data: Record<string, unknown>;
  // Pre-built deterministic findings derived purely from the aggregate, used
  // when AI is unavailable or its output can't be parsed.
  fallbackSummary: string;
  fallbackFindings: Finding[];
};

function notAuthorizedResult(): InsightsResult {
  return {
    summary: "No data is available for this view yet, or you do not have access to it.",
    findings: [],
    generatedAt: Date.now(),
    disclaimer: DEFAULT_DISCLAIMER,
  };
}

// A view is "empty / not authorized" when it returns null (coreViews) or an
// object whose `entity` is null (income/expenses/module return an EMPTY shape).
function isAbsent(view: unknown): boolean {
  if (view === null || view === undefined) return true;
  const record = asRecord(view);
  if (record && "entity" in record && record.entity === null) return true;
  return false;
}

// ---------------------------------------------------------------------------
// The action
// ---------------------------------------------------------------------------

export const generateInsights = action({
  args: {
    entityId: v.optional(v.id("entities")),
    section: v.union(
      v.literal("transactions"),
      v.literal("income"),
      v.literal("expenses"),
      v.literal("bills"),
      v.literal("contacts"),
      v.literal("payroll"),
    ),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    period: v.optional(v.string()),
  },
  // Explicit return annotation: this action calls ctx.runQuery in the same
  // deployment, so annotating avoids TS circularity on the generated api types.
  handler: async (ctx, args): Promise<InsightsResult> => {
    const entityId = args.entityId as Id<"entities"> | undefined;
    const aggregate = await gatherAggregate(ctx, {
      entityId,
      section: args.section,
      from: args.from,
      to: args.to,
      period: args.period,
    });

    // Authorization + emptiness gate: the view queries already enforce entity
    // auth, so a null aggregate means no data or no access.
    if (!aggregate) {
      return notAuthorizedResult();
    }

    const deterministic: InsightsResult = {
      summary: aggregate.fallbackSummary,
      findings: aggregate.fallbackFindings,
      generatedAt: Date.now(),
      disclaimer: `${DEFAULT_DISCLAIMER} (Computed without AI: the AI provider was unavailable.)`,
    };

    // BYO provider-agnostic narration (E8-T8 / E3): resolve the workspace's
    // active AI provider + model + credential from the UNIFIED credential store
    // (any of the 14 providers, never Bedrock-only). When no key is resolvable
    // the banner/observations fall back to the deterministic numbers above —
    // they NEVER block on AI and NEVER show a fabricated value.
    const workspaceId = await ctx.runQuery(internal.aiInsightsAuth.insightsWorkspaceId, {
      ...(entityId ? { entityId } : {}),
    });
    if (!workspaceId) {
      return deterministic;
    }

    const resolved = await resolveActiveAiModel(ctx, {
      workspaceId,
      purpose: "chat",
    });
    if (!resolved.ready) {
      return deterministic;
    }

    try {
      const prompt = buildInsightsPrompt(args.section, aggregate);
      const model = buildModelForProvider({
        providerId: resolved.provider,
        modelId: resolved.modelId,
        credential: resolved.credential,
      });
      const result = await generateText({
        model,
        prompt,
        maxOutputTokens: 700,
        temperature: 0,
        maxRetries: 0,
      });
      const parsed = parseInsightsJson(result.text);
      if (!parsed) {
        return deterministic;
      }
      // The model may only RESTATE figures already in the aggregate — it never
      // sources numbers. Cross-check each finding against the supplied data and
      // drop any that mention a number not present in the aggregate; if nothing
      // survives, fall back to the deterministic findings (which are derived
      // purely from the aggregate). This guarantees the AI layer can never show
      // a value absent from the programmatic numbers.
      const allowed = numericTokensFromAggregate(aggregate);
      const verified = parsed.findings.filter((finding) =>
        findingNumbersAreSupported(finding, allowed),
      );
      const summarySupported = findingNumbersAreSupported(
        { title: parsed.summary, detail: "" },
        allowed,
      );
      if (verified.length === 0) {
        return deterministic;
      }
      return {
        summary: summarySupported ? parsed.summary : aggregate.fallbackSummary,
        findings: verified,
        generatedAt: Date.now(),
        disclaimer: DEFAULT_DISCLAIMER,
      };
    } catch {
      // Any model/parse/network failure -> deterministic, never throw.
      return deterministic;
    }
  },
});


// ---------------------------------------------------------------------------
// Prompt construction + strict-JSON parsing
// ---------------------------------------------------------------------------

const SECTION_FOCUS: Record<Section, string> = {
  transactions:
    "cash movement: net change vs the previous period, money in vs money out, and the biggest counterparties.",
  income:
    "revenue health: money received this period, what is still open or overdue, and which streams or customers drove it.",
  expenses:
    "spending: total spent vs last period, the biggest movers, the top vendor, and anything uncategorized or missing a receipt.",
  bills:
    "payables: what is open, due soon, or overdue, and any bills missing evidence.",
  contacts:
    "relationships: who owes money (receivables), who is owed (payables), and which contacts are overdue.",
  payroll:
    "payroll: total run cost by currency, headcount, and any approved-but-unmatched pay lines.",
};

function buildInsightsPrompt(section: Section, aggregate: SectionAggregate): string {
  return [
    "You write a short, plain-English insights summary for OpenBooks, an AI-assisted bookkeeping app for small-business owners.",
    `This is the "${section}" view. Focus on ${SECTION_FOCUS[section]}`,
    "",
    "Write for a busy owner, not an accountant. Use the style of a concise activity feed, e.g.",
    '"Revenue declined 12% vs last month", "Higher spend to AWS", "1 notable transaction needs review".',
    "Be specific with the numbers provided. Do not invent numbers that are not in the data.",
    "Money values in the data are integer minor units (cents); divide by 100 when you mention an amount.",
    "Choose tone per finding: positive (good news), neutral (informational), warning (needs attention).",
    "",
    "Return ONLY strict JSON, no markdown, in exactly this shape:",
    '{"summary":"one sentence overview","findings":[{"title":"short label","detail":"one sentence","tone":"positive|neutral|warning"}]}',
    "Provide between 3 and 5 findings. Keep each title under 8 words and each detail under 24 words.",
    "",
    `Currency: ${aggregate.currency}`,
    "Section data (JSON):",
    truncate(JSON.stringify(aggregate.data), 4000),
  ].join("\n");
}

function parseInsightsJson(
  text: string,
): { summary: string; findings: Finding[] } | null {
  const raw = parseFirstJsonObject(text);
  if (!raw) return null;

  const summary =
    typeof raw.summary === "string" && raw.summary.trim().length > 0
      ? truncate(raw.summary, 240)
      : null;
  if (!summary) return null;

  const rawFindings = Array.isArray(raw.findings) ? raw.findings : [];
  const findings: Finding[] = [];
  for (const candidate of rawFindings) {
    const record = asRecord(candidate);
    if (!record) continue;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const detail = typeof record.detail === "string" ? record.detail.trim() : "";
    if (!title && !detail) continue;
    findings.push({
      title: truncate(title || detail, 80),
      detail: truncate(detail || title, 240),
      tone: isToneString(record.tone) ? record.tone : "neutral",
    });
    if (findings.length >= 5) break;
  }

  if (findings.length === 0) return null;
  return { summary, findings };
}

// ---------------------------------------------------------------------------
// Per-section aggregate gathering. Each branch calls an EXISTING public view
// query (which enforces entity auth), maps the returned fields into a compact
// model-facing object, and pre-computes a deterministic summary + findings.
// ---------------------------------------------------------------------------

async function gatherAggregate(
  ctx: RunQuery,
  args: {
    entityId?: Id<"entities">;
    section: Section;
    from?: string;
    to?: string;
    period?: string;
  },
): Promise<SectionAggregate | null> {
  switch (args.section) {
    case "transactions":
      return gatherTransactions(ctx, args);
    case "income":
      return gatherIncome(ctx, args);
    case "expenses":
      return gatherExpenses(ctx, args);
    case "bills":
    case "contacts":
    case "payroll":
      return gatherModule(ctx, args.section, args);
    default:
      return null;
  }
}

type RunQuery = Pick<ActionCtx, "runQuery">;

async function gatherTransactions(
  ctx: RunQuery,
  args: { entityId?: Id<"entities">; from?: string; to?: string },
): Promise<SectionAggregate | null> {
  const view = await ctx.runQuery(api.coreViews.transactions, {
    ...(args.entityId ? { entityId: args.entityId } : {}),
    ...(args.from ? { from: args.from } : {}),
    ...(args.to ? { to: args.to } : {}),
  });
  if (isAbsent(view) || !view) return null;

  const currency = view.entity.currency;
  const insights = view.insights;
  const deltaVsPrev = insights.netChangeMinor - insights.prevNetChangeMinor;
  const topCounterparty = insights.counterparties[0] ?? null;

  const data = {
    netChangeMinor: insights.netChangeMinor,
    moneyInMinor: insights.moneyInMinor,
    moneyOutMinor: insights.moneyOutMinor,
    prevNetChangeMinor: insights.prevNetChangeMinor,
    netChangeVsPrevMinor: deltaVsPrev,
    transactionCount: insights.matchedCount,
    topCounterparties: insights.counterparties.slice(0, 5),
  };

  const fallbackFindings: Finding[] = [
    {
      title: "Net change",
      detail: `Net change of ${signedMoney(insights.netChangeMinor, currency)} across ${insights.matchedCount} transactions.`,
      tone: insights.netChangeMinor >= 0 ? "positive" : "warning",
    },
    {
      title: "Money in vs out",
      detail: `${formatMoney(insights.moneyInMinor, currency)} in and ${formatMoney(insights.moneyOutMinor, currency)} out.`,
      tone: "neutral",
    },
  ];
  if (topCounterparty) {
    fallbackFindings.push({
      title: `Top counterparty: ${topCounterparty.label}`,
      detail: `${topCounterparty.label} accounts for ${signedMoney(topCounterparty.amountMinor, currency)} of net movement.`,
      tone: "neutral",
    });
  }

  return {
    currency,
    data,
    fallbackSummary: `Net change of ${signedMoney(insights.netChangeMinor, currency)} this period (${signedMoney(deltaVsPrev, currency)} vs the previous period).`,
    fallbackFindings,
  };
}

async function gatherIncome(
  ctx: RunQuery,
  args: { entityId?: Id<"entities">; from?: string; to?: string },
): Promise<SectionAggregate | null> {
  const range =
    args.from && args.to ? { start: args.from, end: args.to } : undefined;
  const view = await ctx.runQuery(api.incomeViews.overview, {
    ...(args.entityId ? { entityId: args.entityId } : {}),
    ...(range ? { range } : {}),
  });
  if (isAbsent(view) || !view || !view.entity) return null;

  const currency = view.entity.currency;
  const kpis = view.kpis;
  const topStream = view.streams.rows[0] ?? null;
  const topCustomer = view.customers[0] ?? null;

  const data = {
    receivedThisPeriodMinor: kpis.receivedThisMonthMinor,
    paymentCount: kpis.paymentCount,
    stillOpenMinor: kpis.stillOpenMinor,
    openInvoiceCount: kpis.openInvoiceCount,
    overdueMinor: kpis.overdueMinor,
    overdueInvoiceCount: kpis.overdueInvoiceCount,
    recurringMrrMinor: kpis.recurringMrrMinor,
    topStreams: view.streams.rows.slice(0, 5).map((row) => ({ name: row.name, totalMinor: row.totalMinor })),
    topCustomers: view.customers.slice(0, 5).map((row) => ({ name: row.name, receivedMinor: row.receivedMinor, openMinor: row.openMinor })),
  };

  const fallbackFindings: Finding[] = [
    {
      title: "Received this period",
      detail: `${formatMoney(kpis.receivedThisMonthMinor, currency)} received across ${kpis.paymentCount} payments.`,
      tone: kpis.receivedThisMonthMinor > 0 ? "positive" : "neutral",
    },
    {
      title: "Still open",
      detail: `${formatMoney(kpis.stillOpenMinor, currency)} outstanding across ${kpis.openInvoiceCount} open invoices.`,
      tone: kpis.stillOpenMinor > 0 ? "neutral" : "positive",
    },
  ];
  if (kpis.overdueMinor > 0) {
    fallbackFindings.push({
      title: "Overdue invoices",
      detail: `${formatMoney(kpis.overdueMinor, currency)} overdue across ${kpis.overdueInvoiceCount} invoices.`,
      tone: "warning",
    });
  } else if (topStream) {
    fallbackFindings.push({
      title: `Top stream: ${topStream.name}`,
      detail: `${topStream.name} brought in ${formatMoney(topStream.totalMinor, currency)} this period.`,
      tone: "neutral",
    });
  }
  if (topCustomer && fallbackFindings.length < 3) {
    fallbackFindings.push({
      title: `Top customer: ${topCustomer.name}`,
      detail: `${topCustomer.name} paid ${formatMoney(topCustomer.receivedMinor, currency)} this period.`,
      tone: "neutral",
    });
  }

  return {
    currency,
    data,
    fallbackSummary: `Received ${formatMoney(kpis.receivedThisMonthMinor, currency)} this period with ${formatMoney(kpis.stillOpenMinor, currency)} still open.`,
    fallbackFindings,
  };
}

async function gatherExpenses(
  ctx: RunQuery,
  args: { entityId?: Id<"entities">; period?: string },
): Promise<SectionAggregate | null> {
  // expensesViews.overview accepts only "this" | "last"; map an unknown period
  // string to the default ("this") so the contract stays satisfied.
  const period = args.period === "last" ? "last" : "this";
  const view = await ctx.runQuery(api.expensesViews.overview, {
    ...(args.entityId ? { entityId: args.entityId } : {}),
    period,
  });
  if (isAbsent(view) || !view || !view.entity) return null;

  const currency = view.entity.currency;
  const kpis = view.kpis;
  const topCategory = view.categories[0] ?? null;

  const data = {
    spentMinor: kpis.spentMinor,
    deltaPctVsLast: kpis.deltaPct,
    recurringMonthlyMinor: kpis.recurringMonthlyMinor,
    recurringSharePct: kpis.recurringSharePct,
    biggestMoverName: kpis.biggestMoverName,
    biggestMoverDeltaPct: kpis.biggestMoverDeltaPct,
    topVendorName: kpis.topVendorName,
    topVendorMinor: kpis.topVendorMinor,
    uncategorizedCount: kpis.uncategorizedCount,
    missingEvidenceCount: kpis.missingEvidenceCount,
    topCategories: view.categories.slice(0, 5).map((row) => ({ name: row.name, totalMinor: row.totalMinor, deltaPct: row.deltaPct })),
  };

  const deltaText =
    kpis.deltaPct === null
      ? ""
      : ` (${kpis.deltaPct >= 0 ? "+" : ""}${kpis.deltaPct}% vs last period)`;
  const fallbackFindings: Finding[] = [
    {
      title: "Total spent",
      detail: `${formatMoney(kpis.spentMinor, currency)} spent this period${deltaText}.`,
      tone: kpis.deltaPct === null ? "neutral" : kpis.deltaPct > 0 ? "warning" : "positive",
    },
  ];
  if (kpis.biggestMoverName && kpis.biggestMoverDeltaPct !== null) {
    fallbackFindings.push({
      title: `Biggest mover: ${kpis.biggestMoverName}`,
      detail: `${kpis.biggestMoverName} changed ${kpis.biggestMoverDeltaPct >= 0 ? "+" : ""}${kpis.biggestMoverDeltaPct}% vs last period.`,
      tone: kpis.biggestMoverDeltaPct > 0 ? "warning" : "positive",
    });
  } else if (topCategory) {
    fallbackFindings.push({
      title: `Top category: ${topCategory.name}`,
      detail: `${topCategory.name} accounts for ${formatMoney(topCategory.totalMinor, currency)} of spend.`,
      tone: "neutral",
    });
  }
  if (kpis.topVendorName) {
    fallbackFindings.push({
      title: `Top vendor: ${kpis.topVendorName}`,
      detail: `${kpis.topVendorName} is the largest vendor at ${formatMoney(kpis.topVendorMinor, currency)}.`,
      tone: "neutral",
    });
  }
  if (kpis.uncategorizedCount > 0 && fallbackFindings.length < 5) {
    fallbackFindings.push({
      title: "Needs review",
      detail: `${kpis.uncategorizedCount} expenses are uncategorized and ${kpis.missingEvidenceCount} are missing a receipt.`,
      tone: "warning",
    });
  }

  return {
    currency,
    data,
    fallbackSummary: `Spent ${formatMoney(kpis.spentMinor, currency)} this period${deltaText}.`,
    fallbackFindings,
  };
}

async function gatherModule(
  ctx: RunQuery,
  section: "bills" | "contacts" | "payroll",
  args: { entityId?: Id<"entities"> },
): Promise<SectionAggregate | null> {
  const view = await ctx.runQuery(api.moduleViews.overview, {
    ...(args.entityId ? { entityId: args.entityId } : {}),
  });
  if (isAbsent(view) || !view || !view.entity) return null;

  const currency = view.entity.currency;

  if (section === "bills") {
    const bills = view.bills;
    const kpis = bills.kpis;
    const overdueGroup = bills.groups.find((group) => group.key === "overdue");
    const dueSoonGroup = bills.groups.find((group) => group.key === "this_week");
    const data = {
      openMinor: kpis.openMinor,
      dueSoonMinor: kpis.dueSoonMinor,
      overdueMinor: kpis.overdueMinor,
      paidThisPeriodMinor: kpis.paidThisPeriodMinor,
      missingEvidenceMinor: kpis.missingEvidenceMinor,
      missingEvidenceCount: kpis.missingEvidenceCount,
      avgDaysToPay: kpis.avgDaysToPay,
      overdueCount: overdueGroup?.rows.length ?? 0,
      dueSoonCount: dueSoonGroup?.rows.length ?? 0,
    };
    const fallbackFindings: Finding[] = [
      {
        title: "Open bills",
        detail: `${formatMoney(kpis.openMinor, currency)} in open bills to pay.`,
        tone: "neutral",
      },
    ];
    if (kpis.overdueMinor > 0) {
      fallbackFindings.push({
        title: "Overdue bills",
        detail: `${formatMoney(kpis.overdueMinor, currency)} overdue across ${overdueGroup?.rows.length ?? 0} bills.`,
        tone: "warning",
      });
    }
    if (kpis.dueSoonMinor > 0 && fallbackFindings.length < 3) {
      fallbackFindings.push({
        title: "Due soon",
        detail: `${formatMoney(kpis.dueSoonMinor, currency)} due within the week.`,
        tone: "neutral",
      });
    }
    if (kpis.missingEvidenceCount > 0 && fallbackFindings.length < 3) {
      fallbackFindings.push({
        title: "Missing evidence",
        detail: `${kpis.missingEvidenceCount} open bills have no attached document.`,
        tone: "warning",
      });
    }
    return {
      currency,
      data,
      fallbackSummary: `${formatMoney(kpis.openMinor, currency)} in open bills, ${formatMoney(kpis.overdueMinor, currency)} of it overdue.`,
      fallbackFindings,
    };
  }

  if (section === "contacts") {
    const kpis = view.contacts.kpis;
    const topByActivity = view.contacts.rows
      .filter((row) => !row.archived)
      .slice(0, 5)
      .map((row) => ({
        name: row.name,
        openReceivableMinor: row.openReceivableMinor,
        openPayableMinor: row.openPayableMinor,
        overdueReceivableMinor: row.overdueReceivableMinor,
      }));
    const data = {
      contactsCount: kpis.contactsCount,
      openReceivableMinor: kpis.openReceivableMinor,
      openPayableMinor: kpis.openPayableMinor,
      overdueReceivableCount: kpis.overdueReceivableCount,
      topContacts: topByActivity,
    };
    const fallbackFindings: Finding[] = [
      {
        title: "Receivables",
        detail: `${formatMoney(kpis.openReceivableMinor, currency)} owed to you across ${kpis.contactsCount} contacts.`,
        tone: "neutral",
      },
      {
        title: "Payables",
        detail: `${formatMoney(kpis.openPayableMinor, currency)} you owe to vendors.`,
        tone: "neutral",
      },
    ];
    if (kpis.overdueReceivableCount > 0) {
      fallbackFindings.push({
        title: "Overdue receivables",
        detail: `${kpis.overdueReceivableCount} contacts have overdue balances.`,
        tone: "warning",
      });
    }
    return {
      currency,
      data,
      fallbackSummary: `${formatMoney(kpis.openReceivableMinor, currency)} owed to you and ${formatMoney(kpis.openPayableMinor, currency)} owed by you.`,
      fallbackFindings,
    };
  }

  // payroll
  const payroll = view.payroll;
  const data = {
    headcount: payroll.employees.length,
    currencyTotals: payroll.currencyTotals,
    unmatchedCount: payroll.unmatchedCount,
    runCount: payroll.runs.length,
    latestRun: payroll.runs[0]
      ? {
          period: payroll.runs[0].period,
          status: payroll.runs[0].status,
          totalBaseMinor: payroll.runs[0].totalBaseMinor,
          headcount: payroll.runs[0].headcount,
        }
      : null,
  };
  const totalBaseMinor = payroll.currencyTotals.reduce((sum, row) => sum + row.baseMinor, 0);
  const fallbackFindings: Finding[] = [
    {
      title: "Payroll cost",
      detail: `${formatMoney(totalBaseMinor, currency)} per month across ${payroll.employees.length} employees.`,
      tone: "neutral",
    },
  ];
  if (payroll.currencyTotals.length > 1) {
    fallbackFindings.push({
      title: "Multi-currency payroll",
      detail: `Pay runs span ${payroll.currencyTotals.length} currencies.`,
      tone: "neutral",
    });
  }
  if (payroll.unmatchedCount > 0) {
    fallbackFindings.push({
      title: "Unmatched pay lines",
      detail: `${payroll.unmatchedCount} approved pay lines are awaiting a bank match.`,
      tone: "warning",
    });
  } else if (data.latestRun) {
    fallbackFindings.push({
      title: `Latest run: ${data.latestRun.period}`,
      detail: `The ${data.latestRun.period} run is ${data.latestRun.status} for ${data.latestRun.headcount} people.`,
      tone: "neutral",
    });
  }
  return {
    currency,
    data,
    fallbackSummary: `${formatMoney(totalBaseMinor, currency)} monthly payroll across ${payroll.employees.length} employees.`,
    fallbackFindings,
  };
}
