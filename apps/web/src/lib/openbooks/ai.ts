import type { ReportPack } from "@/lib/openbooks/reports-export";

export type AiAutonomyMode = "suggest" | "balanced" | "autopilot";

export type AiStatus = {
  configured: boolean;
  mode: "active" | "degraded";
  label: string;
  detail: string;
  provider: string;
  chatModel: string;
  embeddingsModel: string;
};

export type AiAnswer =
  | {
      kind: "narrative";
      title: string;
      body: string;
      rows?: Array<{ label: string; value: string }>;
    }
  | {
      kind: "table";
      title: string;
      body: string;
      columns: [string, string];
      rows: Array<{ label: string; value: string }>;
    }
  | {
      kind: "proposal";
      title: string;
      body: string;
      actionLabel: string;
      merchantContains: string;
    };

export const OPENBOOKS_AI_EVENT = "openbooks:ask-ai";

export const aiAutonomyOptions: Array<{
  value: AiAutonomyMode;
  label: string;
  thresholdLabel: string;
  description: string;
}> = [
  {
    value: "suggest",
    label: "Suggest everything",
    thresholdLabel: "Never auto-post",
    description: "AI can explain and draft, but every bookkeeping change waits for owner approval.",
  },
  {
    value: "balanced",
    label: "Balanced",
    thresholdLabel: "Auto-post at 90%",
    description: "High-confidence classifications can post; uncertain items still go to the Inbox.",
  },
  {
    value: "autopilot",
    label: "Autopilot",
    thresholdLabel: "Auto-post at 75%",
    description: "More work is automated, with lower-confidence decisions summarized for review.",
  },
];

export const aiSuggestedPrompts = [
  "How did we do last month vs. before?",
  "Top 5 expenses this quarter?",
  "Who owes me money right now?",
  "How much did Stripe take in fees this year?",
  "What's my monthly payroll cost in USD?",
];

type BackendAiStatus = {
  mode: "active" | "degraded";
  activeProvider: "bedrock" | null;
  model: string | null;
  embeddingsModel: string | null;
  configuredProvider: "bedrock" | "anthropic" | "openai" | "google" | "ollama";
  degradedReason: string | null;
};

export function frontendAiStatus(status?: BackendAiStatus): AiStatus {
  if (status?.mode === "active") {
    return {
      configured: true,
      mode: "active",
      label: "Bedrock provider is configured",
      detail: "OpenBooks can use Bedrock-backed categorization when pipeline actions request model proposals.",
      provider: status.activeProvider ?? status.configuredProvider,
      chatModel: status.model ?? "Configured in Convex",
      embeddingsModel: status.embeddingsModel ?? "Configured in Convex",
    };
  }

  return {
    configured: false,
    mode: "degraded",
    label: "AI provider is not configured",
    detail: status?.degradedReason ?? "OpenBooks is running in degraded mode: rules, Plaid priors, reports, and manual review still work.",
    provider: "None connected",
    chatModel: "Unavailable",
    embeddingsModel: "Unavailable",
  };
}

export function formatAiMoney(amountMinor: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}

export function createAiRequestEvent(prompt: string, context?: string, reportPack?: ReportPack) {
  return new CustomEvent(OPENBOOKS_AI_EVENT, {
    detail: { prompt, context, reportPack },
  });
}

function extractMerchantForRule(question: string) {
  const match = question.match(/(?:for|merchant)\s+([a-z0-9&.\-'\s]+)$/i);
  const raw = match?.[1]?.trim() || question.replace(/create|rule|categorize|transactions|for/gi, " ").trim();
  return raw.split(/\s+/).slice(0, 4).join(" ") || "Uber";
}

export function answerOpenBooksQuestion(question: string, pack: ReportPack | undefined): AiAnswer {
  const normalized = question.toLowerCase();
  const currency = pack?.entity.currency ?? "USD";

  if (normalized.includes("create") || normalized.includes("rule") || normalized.includes("categorize")) {
    const merchantContains = extractMerchantForRule(question);
    return {
      kind: "proposal",
      title: "Proposed action",
      body:
        `Create a rule for merchant text "${merchantContains}". This writes a rule only after confirmation; it never posts a journal entry from chat.`,
      actionLabel: "Confirm rule",
      merchantContains,
    };
  }

  if (!pack) {
    return {
      kind: "narrative",
      title: "Reports are still loading",
      body: "I can answer this once the report pack is available. No AI provider is configured, so live model reasoning is disabled.",
    };
  }

  if (normalized.includes("expense") || normalized.includes("top 5")) {
    const sourceRows = pack.expenses.byCategory.length > 0
      ? pack.expenses.byCategory
      : pack.monthlyReview.topExpenseCategories;
    const rows = sourceRows
      .filter((row) => row.totalMinor !== 0)
      .sort((a, b) => Math.abs(b.totalMinor) - Math.abs(a.totalMinor))
      .slice(0, 5)
      .map((row) => ({ label: row.label, value: formatAiMoney(Math.abs(row.totalMinor), currency) }));
    if (rows.length === 0) {
      rows.push({ label: "No expenses in this range", value: formatAiMoney(0, currency) });
    }

    return {
      kind: "table",
      title: "Top expense categories",
      body: "This is a read-only answer from the report pack. It does not call an AI provider or change the books.",
      columns: ["Category", "Amount"],
      rows,
    };
  }

  if (normalized.includes("owe") || normalized.includes("owes")) {
    const rows = pack.arAging.rows
      .filter((row) => row.totalMinor > 0)
      .sort((a, b) => b.totalMinor - a.totalMinor)
      .slice(0, 5)
      .map((row) => ({ label: row.name, value: formatAiMoney(row.totalMinor, currency) }));

    return {
      kind: "table",
      title: "Customers who owe you money",
      body: "This comes from the AR Aging report, which is built from posted journal lines and invoice balances.",
      columns: ["Customer", "Open balance"],
      rows,
    };
  }

  if (normalized.includes("payroll")) {
    return {
      kind: "narrative",
      title: "Payroll cost",
      body: `Payroll totals ${formatAiMoney(pack.payrollSummary.totalMinor, currency)} for the selected report range.`,
      rows: pack.payrollSummary.rows.slice(0, 4).map((row) => ({
        label: row.period,
        value: formatAiMoney(row.totalBaseMinor, currency),
      })),
    };
  }

  if (normalized.includes("stripe") && normalized.includes("fee")) {
    const feeRow = pack.expenses.byCategory.find((row) => row.label.toLowerCase().includes("processing"));
    return {
      kind: "narrative",
      title: "Stripe fees",
      body: feeRow
        ? `Payment processing fees total ${formatAiMoney(Math.abs(feeRow.totalMinor), currency)} in this report range.`
        : "I did not find a payment processing fee row in this report range.",
    };
  }

  return {
    kind: "narrative",
    title: "Report explanation",
    body: `For ${pack.entity.name}, income is ${formatAiMoney(pack.profitAndLoss.incomeMinor, currency)}, expenses are ${formatAiMoney(Math.abs(pack.profitAndLoss.expenseMinor), currency)}, and net income is ${formatAiMoney(pack.profitAndLoss.netIncomeMinor, currency)} for ${pack.controls.startDate} to ${pack.controls.endDate}.`,
    rows: [
      { label: "Money in", value: formatAiMoney(pack.monthlyReview.moneyInMinor, currency) },
      { label: "Money out", value: formatAiMoney(Math.abs(pack.monthlyReview.moneyOutMinor), currency) },
      { label: "Net result", value: formatAiMoney(pack.monthlyReview.netResultMinor, currency) },
    ],
  };
}
