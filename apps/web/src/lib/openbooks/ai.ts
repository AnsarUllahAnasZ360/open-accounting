import type { ReportPack } from "@/lib/openbooks/reports-export";

export type AiAutonomyMode = "suggest" | "balanced" | "autopilot";

export type AiStatus = {
  configured: boolean;
  mode: "active" | "degraded";
  label: string;
  detail: string;
  provider: string;
  chatModel: string;
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
      action: "createRule";
      merchantContains: string;
      facts: Array<{ label: string; value: string }>;
    }
  | {
      kind: "proposal";
      title: string;
      body: string;
      actionLabel: string;
      action: "categorizeTransactions";
      merchantContains: string;
      categoryAccountNumber: string;
      categoryLabel: string;
      limit: number;
      facts: Array<{ label: string; value: string }>;
    }
  | {
      kind: "proposal";
      title: string;
      body: string;
      actionLabel: string;
      action: "draftInvoice";
      customerName: string;
      amountMinor: number;
      issueDate: string;
      dueDate: string;
      memo?: string;
      facts: Array<{ label: string; value: string }>;
    }
  | {
      kind: "proposal";
      title: string;
      body: string;
      actionLabel: string;
      action: "addBill";
      vendorName: string;
      amountMinor: number;
      issueDate: string;
      dueDate: string;
      expenseAccountNumber: string;
      expenseLabel: string;
      facts: Array<{ label: string; value: string }>;
    }
  | {
      kind: "proposal";
      title: string;
      body: string;
      actionLabel: string;
      action: "createJournalEntry";
      amountMinor: number;
      date: string;
      memo: string;
      debitAccountNumber: string;
      debitAccountLabel: string;
      creditAccountNumber: string;
      creditAccountLabel: string;
      facts: Array<{ label: string; value: string }>;
    };

export const OPENBOOKS_AI_EVENT = "openbooks:ask-ai";

// A structured pending-prompt payload. The nonce is a separate field (not a
// "::"-joined string) so prompts containing "::" — a time range, a ratio — are
// never truncated. The widget re-submits whenever the nonce changes.
export type PendingAiPrompt = {
  prompt: string;
  nonce: number;
};

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
  activeProvider: string | null;
  model: string | null;
  configuredProvider: string;
  degradedReason: string | null;
};

export function frontendAiStatus(status?: BackendAiStatus): AiStatus {
  if (status?.mode === "active") {
    return {
      configured: true,
      mode: "active",
      // Provider-agnostic: the conversational surface never names a vendor.
      // The Settings card keeps the technical provider/model fields below.
      label: "AI is on",
      detail: "AI can read your books and draft proposals. Nothing posts to the ledger until you confirm it.",
      provider: status.activeProvider ?? status.configuredProvider,
      chatModel: status.model ?? "Configured in Convex",
    };
  }

  return {
    configured: false,
    mode: "degraded",
    label: "AI is off",
    detail: status?.degradedReason ?? "AI is off, but rules, bank priors, reports, and manual review still work.",
    provider: "None connected",
    chatModel: "Unavailable",
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

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function fallbackActionDate(pack: ReportPack | undefined) {
  return pack?.controls.endDate ?? "2026-06-10";
}

function extractIsoDates(question: string) {
  return question.match(/\b20\d{2}-\d{2}-\d{2}\b/g) ?? [];
}

function extractAmountMinor(question: string, fallback: number) {
  const match = question.match(/\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)/);
  if (!match) return fallback;
  return Math.round(Number(match[1].replaceAll(",", "")) * 100);
}

function extractEntityName(question: string, fallback: string) {
  const match = question.match(/(?:for|to|vendor|customer)\s+([a-z0-9&.\-'\s]+?)(?:\s+for\s+\$|\s+\$|\s+due\b|\s+on\b|\s+dated\b|$)/i);
  const name = match?.[1]?.trim().replace(/\s+/g, " ");
  return name && name.length > 1 ? name : fallback;
}

function categoryFromQuestion(question: string) {
  const normalized = question.toLowerCase();
  if (/aws|vercel|supabase|cloud|infrastructure/.test(normalized)) {
    return { number: "5300", label: "Cloud/Infrastructure" };
  }
  if (/stripe|processing|fee/.test(normalized)) {
    return { number: "5600", label: "Payment Processing Fees" };
  }
  if (/lyft|uber|travel|flight|hotel|airbnb/.test(normalized)) {
    return { number: "5900", label: "Travel" };
  }
  if (/adobe|figma|notion|openai|software|saas|subscription/.test(normalized)) {
    return { number: "5200", label: "Software & SaaS" };
  }
  if (/ads|marketing|google ads|meta|linkedin/.test(normalized)) {
    return { number: "5400", label: "Marketing & Ads" };
  }
  return { number: "6900", label: "Uncategorized Expense" };
}

function extractMerchantForCategorization(question: string) {
  const match = question.match(/(?:categorize|recategorize|file|handle)\s+([a-z0-9&.\-'\s]+?)(?:\s+(?:transactions|transaction|charges|rides|receipts))?(?:\s+(?:as|to|under|into)\b|$)/i);
  const raw = match?.[1]?.trim() || extractMerchantForRule(question);
  return raw.split(/\s+/).slice(0, 4).join(" ") || "Lyft";
}

export function answerOpenBooksQuestion(question: string, pack: ReportPack | undefined): AiAnswer {
  const normalized = question.toLowerCase();
  const currency = pack?.entity.currency ?? "USD";
  const actionDate = fallbackActionDate(pack);
  const dates = extractIsoDates(question);

  if (normalized.includes("invoice")) {
    const amountMinor = extractAmountMinor(question, 120000);
    const issueDate = dates[0] ?? actionDate;
    const dueDate = dates[1] ?? addDays(issueDate, 30);
    const customerName = extractEntityName(question, "Northstar Dental");
    return {
      kind: "proposal",
      title: "Draft invoice proposal",
      body:
        `Draft an invoice for ${customerName}. Draft invoices create the customer record and invoice shell, but do not post ledger revenue until the invoice is issued or paid.`,
      actionLabel: "Draft invoice",
      action: "draftInvoice",
      customerName,
      amountMinor,
      issueDate,
      dueDate,
      memo: "Drafted from Ask AI",
      facts: [
        { label: "Customer", value: customerName },
        { label: "Amount", value: formatAiMoney(amountMinor, currency) },
        { label: "Due date", value: dueDate },
      ],
    };
  }

  if (normalized.includes("bill")) {
    const amountMinor = extractAmountMinor(question, 2400);
    const issueDate = dates[0] ?? actionDate;
    const dueDate = dates[1] ?? addDays(issueDate, 20);
    const vendorName = extractEntityName(question, "Adobe");
    const category = categoryFromQuestion(question);
    return {
      kind: "proposal",
      title: "Bill posting proposal",
      body:
        `Add an open bill for ${vendorName}. On confirmation, OpenBooks will debit ${category.label} and credit Accounts Payable through the ledger engine.`,
      actionLabel: "Add bill",
      action: "addBill",
      vendorName,
      amountMinor,
      issueDate,
      dueDate,
      expenseAccountNumber: category.number,
      expenseLabel: category.label,
      facts: [
        { label: "Vendor", value: vendorName },
        { label: "Amount", value: formatAiMoney(amountMinor, currency) },
        { label: "Expense", value: category.label },
      ],
    };
  }

  if (normalized.includes("journal")) {
    const amountMinor = extractAmountMinor(question, 10000);
    const date = dates[0] ?? actionDate;
    const memo = normalized.includes("owner")
      ? "Owner contribution confirmed from chat"
      : "AI-confirmed journal entry";
    return {
      kind: "proposal",
      title: "Journal entry proposal",
      body:
        "Post a balanced two-line journal entry. On confirmation, the ledger engine will create equal debits and credits through postEntry.",
      actionLabel: "Post journal entry",
      action: "createJournalEntry",
      amountMinor,
      date,
      memo,
      debitAccountNumber: "1010",
      debitAccountLabel: "Operating Checking",
      creditAccountNumber: "3000",
      creditAccountLabel: "Owner's Equity",
      facts: [
        { label: "Debit", value: "Operating Checking" },
        { label: "Credit", value: "Owner's Equity" },
        { label: "Amount", value: formatAiMoney(amountMinor, currency) },
      ],
    };
  }

  if (normalized.includes("categorize") || normalized.includes("recategorize") || normalized.includes("file ") || normalized.includes("handle ")) {
    const merchantContains = extractMerchantForCategorization(question);
    const category = categoryFromQuestion(question);
    return {
      kind: "proposal",
      title: "Categorization proposal",
      body:
        `Categorize matching "${merchantContains}" transactions as ${category.label}. OpenBooks will route each match through the existing transaction pipeline, which reverses and reposts ledger entries when needed.`,
      actionLabel: "Categorize transactions",
      action: "categorizeTransactions",
      merchantContains,
      categoryAccountNumber: category.number,
      categoryLabel: category.label,
      limit: 5,
      facts: [
        { label: "Merchant text", value: merchantContains },
        { label: "Category", value: category.label },
        { label: "Limit", value: "Up to 5 transactions" },
      ],
    };
  }

  if (normalized.includes("create") || normalized.includes("rule")) {
    const merchantContains = extractMerchantForRule(question);
    return {
      kind: "proposal",
      title: "Proposed action",
      body:
        `Create a rule for merchant text "${merchantContains}". This writes a rule only after confirmation; it never posts a journal entry from chat.`,
      actionLabel: "Confirm rule",
      action: "createRule",
      merchantContains,
      facts: [
        { label: "Merchant text", value: merchantContains },
        { label: "Auto-post", value: "Off" },
      ],
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
