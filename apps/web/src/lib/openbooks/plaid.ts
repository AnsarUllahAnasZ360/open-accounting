export type PlaidEnvState = {
  environment: "sandbox" | "development" | "production" | "missing" | "unsupported";
  hasClientId: boolean;
  hasSecret: boolean;
  ready: boolean;
  problems: string[];
};

export type PlaidSelectableAccount = {
  plaidAccountId: string;
  plaidItemId?: string;
  name: string;
  mask: string;
  subtype: string;
  balanceMinor: number;
  currency: string;
  include: boolean;
  // E3-T5: the business this account is assigned to when one Plaid login spans
  // multiple LLCs. Omitted for single-business links (back-compat).
  entityId?: string;
};

export type PlaidConnectionState = {
  entity: {
    id: string;
    name: string;
    currency: string;
  };
  env: PlaidEnvState;
  accounts: Array<{
    id: string;
    name: string;
    mask: string;
    kind: "checking" | "savings" | "credit";
    balanceMinor: number;
    includeInSync: boolean;
    plaidAccountId?: string | null;
    plaidItemId?: string | null;
    lastSyncCursor?: string | null;
    lastSyncedAt?: number | null;
  }>;
  items: Array<{
    plaidItemId: string;
    institutionName?: string | null;
    status: "active" | "relink_required" | "disconnected";
    lastSyncCursor?: string | null;
    lastSyncedAt?: number | null;
    lastSyncTrigger?: "cron" | "webhook" | "manual" | null;
    lastWebhookCode?: string | null;
  }>;
  recentTransactions: Array<{
    id: string;
    date: string;
    merchant: string;
    amountMinor: number;
    currency: string;
    review: "auto" | "confirmed" | "needs_review" | "excluded";
    status: "pending" | "posted";
    plaidPriorCaptured: boolean;
  }>;
  connectionIssues: Array<{
    id: string;
    payloadSummary: string;
  }>;
};

export type PlaidAccountUpsertResult = {
  createdCount: number;
  updatedCount?: number;
  accounts: Array<{
    bankAccountId: string;
    ledgerAccountId: string;
    plaidAccountId: string;
  }>;
};

export type PlaidFixtureTransaction = {
  transaction_id: string;
  account_id: string;
  date: string;
  amount: number;
  name: string;
  merchant_name?: string | null;
  pending: boolean;
  iso_currency_code?: string | null;
  personal_finance_category?: {
    primary: string;
    detailed: string;
    confidence_level?: string | null;
    version?: string | null;
  } | null;
};

export const openBooksPlaidFixtureTransactions: PlaidFixtureTransaction[] = [
  {
    transaction_id: "fixture-plaid-notion-2026-06-10",
    account_id: "fixture-checking",
    date: "2026-06-10",
    amount: 49.99,
    name: "Notion subscription",
    merchant_name: "Notion",
    pending: false,
    iso_currency_code: "USD",
    personal_finance_category: {
      primary: "GENERAL_SERVICES",
      detailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      confidence_level: "HIGH",
    },
  },
  {
    transaction_id: "fixture-plaid-client-ach-2026-06-11",
    account_id: "fixture-checking",
    date: "2026-06-11",
    amount: -1250,
    name: "Client ACH payment",
    merchant_name: "Client ACH",
    pending: false,
    iso_currency_code: "USD",
    personal_finance_category: {
      primary: "INCOME",
      detailed: "INCOME_OTHER_INCOME",
      confidence_level: "MEDIUM",
    },
  },
  {
    transaction_id: "fixture-plaid-bank-fee-2026-06-12",
    account_id: "fixture-checking",
    date: "2026-06-12",
    amount: 18.75,
    name: "Bank service fee",
    merchant_name: "Plaid Sandbox Bank",
    pending: false,
    iso_currency_code: "USD",
    personal_finance_category: {
      primary: "BANK_FEES",
      detailed: "BANK_FEES_OTHER_BANK_FEES",
      confidence_level: "HIGH",
    },
  },
];

export function plaidEnvLabel(env: PlaidEnvState | undefined) {
  if (!env) return "Checking Plaid keys";
  if (env.ready) return `Plaid ${env.environment} keys are configured`;
  if (env.environment === "unsupported") return "Plaid mode is unsupported";
  return "Plaid keys are missing or blocked";
}

export function plaidModeTone(env: PlaidEnvState | undefined): "ready" | "blocked" | "fixture" {
  if (!env) return "fixture";
  if (env.ready) return "ready";
  if (env.environment === "unsupported") return "blocked";
  return "fixture";
}
