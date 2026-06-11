import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const STRIPE_API_VERSION = "2026-02-25.clover";
const USD = "USD";

const stripeCustomerValidator = v.object({
  stripeCustomerId: v.string(),
  name: v.string(),
  email: v.optional(v.string()),
});

const stripeIncomeValidator = v.object({
  stripePaymentIntentId: v.string(),
  stripeChargeId: v.optional(v.string()),
  customerStripeId: v.optional(v.string()),
  customerName: v.string(),
  description: v.string(),
  date: v.string(),
  amountMinor: v.number(),
  feeMinor: v.number(),
  currency: v.string(),
  feeSource: v.union(v.literal("stripe_balance_transaction"), v.literal("fixture"), v.literal("unavailable")),
});

const stripeInvoiceValidator = v.object({
  stripeInvoiceId: v.string(),
  number: v.string(),
  customerStripeId: v.optional(v.string()),
  customerName: v.string(),
  customerEmail: v.optional(v.string()),
  status: v.union(v.literal("draft"), v.literal("open"), v.literal("paid"), v.literal("overdue"), v.literal("void")),
  issueDate: v.string(),
  dueDate: v.string(),
  totalMinor: v.number(),
  amountPaidMinor: v.number(),
  currency: v.string(),
  hostedInvoiceUrl: v.optional(v.string()),
});

const payoutLineValidator = v.object({
  sourceId: v.string(),
  description: v.string(),
  grossMinor: v.number(),
  feeMinor: v.number(),
  netMinor: v.number(),
  currency: v.string(),
});

const stripePayoutValidator = v.object({
  payoutId: v.string(),
  arrivalDate: v.string(),
  amountMinor: v.number(),
  grossMinor: v.number(),
  feesMinor: v.number(),
  driftMinor: v.number(),
  currency: v.string(),
  lines: v.array(payoutLineValidator),
});

const stripeProjectionValidator = v.object({
  mode: v.union(v.literal("stripe_test"), v.literal("fixture")),
  reason: v.string(),
  customers: v.array(stripeCustomerValidator),
  income: v.array(stripeIncomeValidator),
  invoices: v.array(stripeInvoiceValidator),
  payouts: v.array(stripePayoutValidator),
});

type StripeCustomerProjection = {
  stripeCustomerId: string;
  name: string;
  email?: string;
};

type StripeIncomeProjection = {
  stripePaymentIntentId: string;
  stripeChargeId?: string;
  customerStripeId?: string;
  customerName: string;
  description: string;
  date: string;
  amountMinor: number;
  feeMinor: number;
  currency: string;
  feeSource: "stripe_balance_transaction" | "fixture" | "unavailable";
};

type StripeInvoiceProjection = {
  stripeInvoiceId: string;
  number: string;
  customerStripeId?: string;
  customerName: string;
  customerEmail?: string;
  status: "draft" | "open" | "paid" | "overdue" | "void";
  issueDate: string;
  dueDate: string;
  totalMinor: number;
  amountPaidMinor: number;
  currency: string;
  hostedInvoiceUrl?: string;
};

type StripePayoutProjection = {
  payoutId: string;
  arrivalDate: string;
  amountMinor: number;
  grossMinor: number;
  feesMinor: number;
  driftMinor: number;
  currency: string;
  lines: Array<{
    sourceId: string;
    description: string;
    grossMinor: number;
    feeMinor: number;
    netMinor: number;
    currency: string;
  }>;
};

type StripeProjection = {
  mode: "stripe_test" | "fixture";
  reason: string;
  customers: StripeCustomerProjection[];
  income: StripeIncomeProjection[];
  invoices: StripeInvoiceProjection[];
  payouts: StripePayoutProjection[];
};

type StripeState = {
  entity: { id: Id<"entities">; name: string; currency: string; isDemo: boolean } | null;
  env: {
    configured: boolean;
    source: "environment";
    mode: "missing" | "test" | "live" | "unknown";
    label: string;
  };
  checklist: Array<{ key: string; label: string; status: "pass" | "fail" | "needs_check"; detail: string }>;
  clearingAccount: { id: Id<"ledgerAccounts">; name: string; number: string; currency: string } | null;
  stripeAccount: { id: Id<"stripeAccounts">; label: string; createdAt: number } | null;
  payouts: Array<{
    id: Id<"stripePayouts">;
    payoutId: string;
    amountMinor: number;
    grossMinor: number;
    feesMinor: number;
    driftMinor: number;
    arrivalDate: string;
    status: "pending" | "reconciled" | "mismatch";
  }>;
  fixturePreview: StripeProjection;
  integrationGaps: string[];
};

type ApplyProjectionResult = {
  mode: "stripe_test" | "fixture";
  reason: string;
  entityId: Id<"entities">;
  clearingAccountId: Id<"ledgerAccounts">;
  contactsCreated: number;
  incomeTransactionsCreated: number;
  invoicesCreated: number;
  payoutsCreated: number;
  inboxItemsCreated: number;
  ledgerEntriesPosted: number;
  skippedDuplicates: number;
  integrationGaps: string[];
};

type StripeApiCustomer = {
  id: string;
  name?: string | null;
  email?: string | null;
};

type StripeApiPaymentIntent = {
  id: string;
  amount_received?: number | null;
  amount?: number | null;
  currency?: string | null;
  customer?: string | StripeApiCustomer | null;
  description?: string | null;
  created?: number | null;
  latest_charge?: string | { id: string; balance_transaction?: string | StripeApiBalanceTransaction | null } | null;
};

type StripeApiInvoice = {
  id: string;
  number?: string | null;
  status?: string | null;
  customer?: string | StripeApiCustomer | null;
  customer_name?: string | null;
  customer_email?: string | null;
  created?: number | null;
  due_date?: number | null;
  total?: number | null;
  amount_paid?: number | null;
  currency?: string | null;
  hosted_invoice_url?: string | null;
};

type StripeApiPayout = {
  id: string;
  amount?: number | null;
  currency?: string | null;
  arrival_date?: number | null;
};

type StripeApiBalanceTransaction = {
  id: string;
  amount?: number | null;
  fee?: number | null;
  net?: number | null;
  currency?: string | null;
  source?: string | { id?: string } | null;
  description?: string | null;
};

type StripeList<T> = {
  data?: T[];
};

const authorizeRef = makeFunctionReference<"query", { entityId?: Id<"entities"> }, StripeState>(
  "stripe:state",
);

const applyProjectionRef = makeFunctionReference<
  "mutation",
  { entityId: Id<"entities">; projection: StripeProjection },
  ApplyProjectionResult
>("stripe:applyProjection");

function isoDateFromUnix(seconds?: number | null) {
  if (!seconds) return new Date().toISOString().slice(0, 10);
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function normalizeCurrency(currency: string | null | undefined) {
  return (currency ?? USD).toUpperCase();
}

function normalizeInvoiceStatus(status: string | null | undefined): StripeInvoiceProjection["status"] {
  if (status === "draft" || status === "open" || status === "paid" || status === "void") {
    return status;
  }
  return "open";
}

function assertMinorUnit(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer minor-unit amount.`);
  }
}

function stripeKeyState(value: string | undefined) {
  const key = value?.trim();
  if (!key) {
    return {
      configured: false,
      mode: "missing" as const,
      label: "Missing STRIPE_SECRET_KEY",
      safeToCallStripe: false,
      reason: "STRIPE_SECRET_KEY is not configured in the Convex environment.",
    };
  }
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) {
    return {
      configured: true,
      mode: "live" as const,
      label: "Live key rejected",
      safeToCallStripe: false,
      reason: "OpenBooks initiation only allows Stripe test-mode keys. Replace this with sk_test_ or rk_test_.",
    };
  }
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) {
    return {
      configured: true,
      mode: "test" as const,
      label: key.startsWith("rk_test_") ? "Restricted test key configured" : "Test secret key configured",
      safeToCallStripe: true,
      reason: "Stripe test-mode key is present in the Convex environment.",
    };
  }
  return {
    configured: true,
    mode: "unknown" as const,
    label: "Unknown key format rejected",
    safeToCallStripe: false,
    reason: "Stripe key must start with sk_test_ or rk_test_ for this goal.",
  };
}

export function classifyStripeKeyForTest(value: string | undefined) {
  const state = stripeKeyState(value);
  return {
    configured: state.configured,
    mode: state.mode,
    safeToCallStripe: state.safeToCallStripe,
    label: state.label,
  };
}

export function buildFixtureProjection(): StripeProjection {
  const customers = Array.from({ length: 10 }, (_, index) => ({
    stripeCustomerId: `cus_fixture_${String(index + 1).padStart(2, "0")}`,
    name: [
      "Northstar Studio",
      "Juniper Health",
      "Atlas Advisory",
      "Brightline Dental",
      "Foundry Labs",
      "Cedar Market",
      "Pioneer Legal",
      "Signal Works",
      "Riverbend Clinic",
      "Summit Design",
    ][index],
    email: `billing+stripe-fixture-${index + 1}@example.com`,
  }));

  const income = Array.from({ length: 25 }, (_, index) => {
    const amountMinor = 18_000 + ((index * 7_300) % 94_000);
    const feeMinor = Math.round(amountMinor * 0.029) + 30;
    const customer = customers[index % customers.length];
    const day = String((index % 24) + 1).padStart(2, "0");
    return {
      stripePaymentIntentId: `pi_fixture_${String(index + 1).padStart(2, "0")}`,
      stripeChargeId: `ch_fixture_${String(index + 1).padStart(2, "0")}`,
      customerStripeId: customer.stripeCustomerId,
      customerName: customer.name,
      description: `OpenBooks services payment ${index + 1}`,
      date: `2026-06-${day}`,
      amountMinor,
      feeMinor,
      currency: USD,
      feeSource: "fixture" as const,
    };
  });

  const invoices: StripeInvoiceProjection[] = [
    {
      stripeInvoiceId: "in_fixture_001",
      number: "STRIPE-FIX-1001",
      customerStripeId: customers[0].stripeCustomerId,
      customerName: customers[0].name,
      customerEmail: customers[0].email,
      status: "open",
      issueDate: "2026-06-02",
      dueDate: "2026-06-17",
      totalMinor: 240_000,
      amountPaidMinor: 0,
      currency: USD,
      hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_fixture/test_openbooks_1001",
    },
    {
      stripeInvoiceId: "in_fixture_002",
      number: "STRIPE-FIX-1002",
      customerStripeId: customers[4].stripeCustomerId,
      customerName: customers[4].name,
      customerEmail: customers[4].email,
      status: "open",
      issueDate: "2026-06-06",
      dueDate: "2026-06-21",
      totalMinor: 168_500,
      amountPaidMinor: 0,
      currency: USD,
      hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_fixture/test_openbooks_1002",
    },
    {
      stripeInvoiceId: "in_fixture_003",
      number: "STRIPE-FIX-1003",
      customerStripeId: customers[8].stripeCustomerId,
      customerName: customers[8].name,
      customerEmail: customers[8].email,
      status: "paid",
      issueDate: "2026-05-25",
      dueDate: "2026-06-09",
      totalMinor: 98_000,
      amountPaidMinor: 98_000,
      currency: USD,
      hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_fixture/test_openbooks_1003",
    },
  ];

  const reconciledLines = income.slice(0, 12).map((item) => ({
    sourceId: item.stripeChargeId ?? item.stripePaymentIntentId,
    description: item.description,
    grossMinor: item.amountMinor,
    feeMinor: item.feeMinor,
    netMinor: item.amountMinor - item.feeMinor,
    currency: item.currency,
  }));
  const grossMinor = reconciledLines.reduce((sum, line) => sum + line.grossMinor, 0);
  const feesMinor = reconciledLines.reduce((sum, line) => sum + line.feeMinor, 0);
  const amountMinor = grossMinor - feesMinor;

  const mismatchLines = income.slice(12, 16).map((item) => ({
    sourceId: item.stripeChargeId ?? item.stripePaymentIntentId,
    description: item.description,
    grossMinor: item.amountMinor,
    feeMinor: item.feeMinor,
    netMinor: item.amountMinor - item.feeMinor,
    currency: item.currency,
  }));
  const mismatchGrossMinor = mismatchLines.reduce((sum, line) => sum + line.grossMinor, 0);
  const mismatchFeesMinor = mismatchLines.reduce((sum, line) => sum + line.feeMinor, 0);
  const mismatchExpectedMinor = mismatchGrossMinor - mismatchFeesMinor;

  return {
    mode: "fixture",
    reason: "Stripe test key is missing, invalid, or no test payout is available. Fixture data proves the posting and reconciliation shape without pretending Stripe and Plaid sandboxes settle together.",
    customers,
    income,
    invoices,
    payouts: [
      {
        payoutId: "po_fixture_reconciled_001",
        arrivalDate: "2026-06-10",
        amountMinor,
        grossMinor,
        feesMinor,
        driftMinor: 0,
        currency: USD,
        lines: reconciledLines,
      },
      {
        payoutId: "po_fixture_mismatch_001",
        arrivalDate: "2026-06-11",
        amountMinor: mismatchExpectedMinor - 1_500,
        grossMinor: mismatchGrossMinor,
        feesMinor: mismatchFeesMinor,
        driftMinor: -1_500,
        currency: USD,
        lines: mismatchLines,
      },
    ],
  };
}

async function pickEntity(ctx: QueryCtx | MutationCtx, entityId?: Id<"entities">) {
  const { membership } = await requireAnyWorkspaceRole(ctx, "member");
  const entity = entityId
    ? await ctx.db.get(entityId)
    : (await ctx.db
        .query("entities")
        .withIndex("by_workspace_and_slug", (q) =>
          q.eq("workspaceId", membership.workspaceId).eq("slug", "live-sandbox"),
        )
        .unique()) ??
      (await ctx.db
        .query("entities")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
        .first());

  if (!entity || entity.workspaceId !== membership.workspaceId) {
    return null;
  }
  await requireWorkspaceRole(ctx, entity.workspaceId, "member");
  return entity;
}

async function findAccountByNumber(ctx: QueryCtx | MutationCtx, entityId: Id<"entities">, number: string) {
  return await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity_and_number", (q) => q.eq("entityId", entityId).eq("number", number))
    .unique();
}

async function ensureAccount(
  ctx: MutationCtx,
  entity: Doc<"entities">,
  template: { number: string; name: string; type: Doc<"ledgerAccounts">["type"]; subtype: string; isSystem?: boolean },
) {
  const existing = await findAccountByNumber(ctx, entity._id, template.number);
  const now = Date.now();
  if (existing) {
    if (existing.archived) {
      await ctx.db.patch(existing._id, { archived: false, updatedAt: now });
    }
    return existing;
  }
  const accountId = await ctx.db.insert("ledgerAccounts", {
    entityId: entity._id,
    name: template.name,
    type: template.type,
    subtype: template.subtype,
    number: template.number,
    currency: entity.currency,
    isSystem: Boolean(template.isSystem),
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  return (await ctx.db.get(accountId))!;
}

async function ensureStripeAccounts(ctx: MutationCtx, entity: Doc<"entities">) {
  const clearingAccount = await ensureAccount(ctx, entity, {
    number: "1150",
    name: "Stripe Clearing",
    type: "asset",
    subtype: "clearing",
  });
  const salesAccount = await ensureAccount(ctx, entity, {
    number: "4000",
    name: "Sales",
    type: "income",
    subtype: "sales",
  });
  const feesAccount = await ensureAccount(ctx, entity, {
    number: "5600",
    name: "Payment Processing Fees",
    type: "expense",
    subtype: "fees",
  });
  const receivableAccount = await ensureAccount(ctx, entity, {
    number: "1100",
    name: "Accounts Receivable",
    type: "asset",
    subtype: "receivable",
  });
  const checkingAccount = await ensureAccount(ctx, entity, {
    number: "1010",
    name: "Operating Checking",
    type: "asset",
    subtype: "bank",
  });

  let stripeAccount = await ctx.db
    .query("stripeAccounts")
    .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
    .first();
  const now = Date.now();
  if (stripeAccount) {
    await ctx.db.patch(stripeAccount._id, {
      clearingAccountId: clearingAccount._id,
      label: "Stripe test mode",
      updatedAt: now,
    });
    stripeAccount = (await ctx.db.get(stripeAccount._id))!;
  } else {
    const stripeAccountId = await ctx.db.insert("stripeAccounts", {
      entityId: entity._id,
      clearingAccountId: clearingAccount._id,
      label: "Stripe test mode",
      createdAt: now,
      updatedAt: now,
    });
    stripeAccount = (await ctx.db.get(stripeAccountId))!;
  }

  return { clearingAccount, salesAccount, feesAccount, receivableAccount, checkingAccount, stripeAccount };
}

async function contactForCustomer(
  ctx: MutationCtx,
  entityId: Id<"entities">,
  customer: StripeCustomerProjection,
  contacts: Doc<"contacts">[],
) {
  const email = customer.email?.trim().toLowerCase();
  const name = customer.name.trim();
  const existing = contacts.find((contact) => {
    const aliases = contact.aliases.map((alias) => alias.toLowerCase());
    return (
      (email && contact.email?.toLowerCase() === email) ||
      contact.name.toLowerCase() === name.toLowerCase() ||
      aliases.includes(customer.stripeCustomerId.toLowerCase())
    );
  });
  if (existing) return { contact: existing, created: false };

  const now = Date.now();
  const contactId = await ctx.db.insert("contacts", {
    entityId,
    name,
    roles: ["customer"],
    email: customer.email,
    aliases: [customer.stripeCustomerId],
    createdAt: now,
    updatedAt: now,
  });
  const contact = (await ctx.db.get(contactId))!;
  contacts.push(contact);
  return { contact, created: true };
}

async function postStripeIncome(
  ctx: MutationCtx,
  args: {
    entity: Doc<"entities">;
    item: StripeIncomeProjection;
    clearingAccountId: Id<"ledgerAccounts">;
    salesAccountId: Id<"ledgerAccounts">;
    feesAccountId: Id<"ledgerAccounts">;
  },
) {
  const gross: { entryId: Id<"journalEntries"> } = await ctx.runMutation(api.ledger.postEntry, {
    entityId: args.entity._id,
    date: args.item.date,
    memo: `${args.item.customerName} Stripe payment gross`,
    source: "stripe",
    sourceId: args.item.stripePaymentIntentId,
    lines: [
      {
        accountId: args.clearingAccountId,
        debitMinor: args.item.amountMinor,
        creditMinor: 0,
        currency: args.item.currency,
      },
      {
        accountId: args.salesAccountId,
        debitMinor: 0,
        creditMinor: args.item.amountMinor,
        currency: args.item.currency,
      },
    ],
  });

  let feeEntryId: Id<"journalEntries"> | null = null;
  if (args.item.feeMinor > 0) {
    const fee: { entryId: Id<"journalEntries"> } = await ctx.runMutation(api.ledger.postEntry, {
      entityId: args.entity._id,
      date: args.item.date,
      memo: `${args.item.customerName} Stripe processing fee`,
      source: "stripe",
      sourceId: `${args.item.stripePaymentIntentId}:fee`,
      lines: [
        {
          accountId: args.feesAccountId,
          debitMinor: args.item.feeMinor,
          creditMinor: 0,
          currency: args.item.currency,
        },
        {
          accountId: args.clearingAccountId,
          debitMinor: 0,
          creditMinor: args.item.feeMinor,
          currency: args.item.currency,
        },
      ],
    });
    feeEntryId = fee.entryId;
  }

  return { grossEntryId: gross.entryId, feeEntryId };
}

export const state = query({
  args: {
    entityId: v.optional(v.id("entities")),
  },
  handler: async (ctx, args): Promise<StripeState> => {
    const entity = await pickEntity(ctx, args.entityId);
    const key = stripeKeyState(process.env.STRIPE_SECRET_KEY);
    const fixturePreview = buildFixtureProjection();

    if (!entity) {
      return {
        entity: null,
        env: { configured: key.configured, source: "environment", mode: key.mode, label: key.label },
        checklist: [
          { key: "auth", label: "Workspace access", status: "pass", detail: "Signed in to an OpenBooks workspace." },
          { key: "entity", label: "Live Sandbox entity", status: "fail", detail: "Create the Live Sandbox entity before syncing Stripe." },
          { key: "key", label: "Stripe test key", status: key.mode === "test" ? "pass" : "fail", detail: key.reason },
        ],
        clearingAccount: null,
        stripeAccount: null,
        payouts: [],
        fixturePreview,
        integrationGaps: ["Settings integration must pass the Live Sandbox entityId into StripeConnectionPanel."],
      };
    }

    const [clearingAccount, stripeAccount, payouts] = await Promise.all([
      findAccountByNumber(ctx, entity._id, "1150"),
      ctx.db.query("stripeAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).first(),
      ctx.db.query("stripePayouts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(20),
    ]);

    const checklist: StripeState["checklist"] = [
      { key: "auth", label: "Workspace access", status: "pass", detail: "Current user can read this entity." },
      {
        key: "entity",
        label: "Entity",
        status: entity.slug === "live-sandbox" ? "pass" : "needs_check",
        detail: entity.slug === "live-sandbox" ? "Live Sandbox is selected." : `Currently selected: ${entity.name}.`,
      },
      { key: "key", label: "Stripe test key", status: key.mode === "test" ? "pass" : "fail", detail: key.reason },
      {
        key: "clearing",
        label: "Stripe clearing account",
        status: clearingAccount ? "pass" : "needs_check",
        detail: clearingAccount
          ? `${clearingAccount.number} ${clearingAccount.name} exists.`
          : "Sync will create or repair Stripe Clearing account 1150.",
      },
      {
        key: "payouts",
        label: "Payout fixtures",
        status: "pass",
        detail: "Fixture payout reconciliation remains available when Stripe test payouts are absent.",
      },
    ];

    return {
      entity: { id: entity._id, name: entity.name, currency: entity.currency, isDemo: entity.isDemo },
      env: { configured: key.configured, source: "environment", mode: key.mode, label: key.label },
      checklist,
      clearingAccount: clearingAccount
        ? {
            id: clearingAccount._id,
            name: clearingAccount.name,
            number: clearingAccount.number,
            currency: clearingAccount.currency,
          }
        : null,
      stripeAccount: stripeAccount
        ? { id: stripeAccount._id, label: stripeAccount.label, createdAt: stripeAccount.createdAt }
        : null,
      payouts: payouts.map((payout) => ({
        id: payout._id,
        payoutId: payout.payoutId,
        amountMinor: payout.amountMinor,
        grossMinor: payout.grossMinor,
        feesMinor: payout.feesMinor,
        driftMinor: payout.grossMinor - payout.feesMinor - payout.amountMinor,
        arrivalDate: payout.arrivalDate,
        status: payout.status,
      })),
      fixturePreview,
      integrationGaps: [
        "Schema needs Stripe-native IDs on contacts and invoices for production-grade dedupe.",
        "Webhook registration belongs in convex/http.ts or a new HTTP route outside this worker scope.",
        "Settings must pass the shared Live Sandbox entity once the main thread wires the panel.",
      ],
    };
  },
});

export const applyProjection = mutation({
  args: {
    entityId: v.id("entities"),
    projection: stripeProjectionValidator,
  },
  handler: async (ctx, args): Promise<ApplyProjectionResult> => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new Error("OpenBooks entity not found.");
    await requireWorkspaceRole(ctx, entity.workspaceId, "admin");

    const accounts = await ensureStripeAccounts(ctx, entity);
    const now = Date.now();
    let contactsCreated = 0;
    let incomeTransactionsCreated = 0;
    let invoicesCreated = 0;
    let payoutsCreated = 0;
    let inboxItemsCreated = 0;
    let ledgerEntriesPosted = 0;
    let skippedDuplicates = 0;

    const contacts = await ctx.db.query("contacts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(500);
    const contactsByStripeId = new Map<string, Doc<"contacts">>();
    for (const customer of args.projection.customers) {
      const result = await contactForCustomer(ctx, entity._id, customer, contacts);
      contactsByStripeId.set(customer.stripeCustomerId, result.contact);
      if (result.created) contactsCreated += 1;
    }

    for (const item of args.projection.income) {
      assertMinorUnit(item.amountMinor, "Stripe income amount");
      assertMinorUnit(item.feeMinor, "Stripe fee amount");
      const duplicate = await ctx.db
        .query("transactions")
        .withIndex("by_external_id", (q) => q.eq("externalId", item.stripePaymentIntentId))
        .first();
      if (duplicate && duplicate.entityId === entity._id) {
        skippedDuplicates += 1;
        continue;
      }

      const contact = item.customerStripeId ? contactsByStripeId.get(item.customerStripeId) : undefined;
      const posted = await postStripeIncome(ctx, {
        entity,
        item,
        clearingAccountId: accounts.clearingAccount._id,
        salesAccountId: accounts.salesAccount._id,
        feesAccountId: accounts.feesAccount._id,
      });
      ledgerEntriesPosted += posted.feeEntryId ? 2 : 1;

      await ctx.db.insert("transactions", {
        entityId: entity._id,
        date: item.date,
        amountMinor: item.amountMinor,
        currency: item.currency,
        merchant: item.customerName,
        rawDescription: item.description,
        status: "posted",
        review: item.feeSource === "unavailable" ? "needs_review" : "auto",
        source: "stripe",
        categoryAccountId: accounts.salesAccount._id,
        contactId: contact?._id,
        entryId: posted.grossEntryId,
        externalId: item.stripePaymentIntentId,
        decidedBy: item.feeSource === "unavailable" ? "needs_review" : "match",
        confidence: item.feeSource === "unavailable" ? 0.72 : 0.99,
        reasoning:
          item.feeSource === "unavailable"
            ? "Stripe payment synced, but no balance transaction fee was available yet."
            : "Stripe payment projected to Sales and Stripe Clearing with fee breakdown.",
        evalSet: false,
        createdAt: now,
        updatedAt: now,
      });
      incomeTransactionsCreated += 1;
    }

    const existingInvoices = await ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(500);
    for (const invoice of args.projection.invoices) {
      assertMinorUnit(invoice.totalMinor, "Stripe invoice total");
      assertMinorUnit(invoice.amountPaidMinor, "Stripe invoice paid amount");
      if (existingInvoices.some((row) => row.number === invoice.number)) {
        skippedDuplicates += 1;
        continue;
      }
      const contact =
        (invoice.customerStripeId ? contactsByStripeId.get(invoice.customerStripeId) : undefined) ??
        (
          await contactForCustomer(
            ctx,
            entity._id,
            {
              stripeCustomerId: invoice.customerStripeId ?? `invoice:${invoice.stripeInvoiceId}`,
              name: invoice.customerName,
              email: invoice.customerEmail,
            },
            contacts,
          )
        ).contact;

      const entryIds: Id<"journalEntries">[] = [];
      if (invoice.status === "open" || invoice.status === "overdue") {
        const posted: { entryId: Id<"journalEntries"> } = await ctx.runMutation(api.ledger.postEntry, {
          entityId: entity._id,
          date: invoice.issueDate,
          memo: `${invoice.customerName} Stripe invoice ${invoice.number}`,
          source: "invoice",
          sourceId: invoice.stripeInvoiceId,
          lines: [
            {
              accountId: accounts.receivableAccount._id,
              debitMinor: invoice.totalMinor - invoice.amountPaidMinor,
              creditMinor: 0,
              currency: invoice.currency,
            },
            {
              accountId: accounts.salesAccount._id,
              debitMinor: 0,
              creditMinor: invoice.totalMinor - invoice.amountPaidMinor,
              currency: invoice.currency,
            },
          ],
        });
        entryIds.push(posted.entryId);
        ledgerEntriesPosted += 1;
      }

      await ctx.db.insert("invoices", {
        entityId: entity._id,
        contactId: contact._id,
        number: invoice.number,
        status: invoice.status,
        currency: invoice.currency,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        totalMinor: invoice.totalMinor,
        amountPaidMinor: invoice.amountPaidMinor,
        entryIds,
        createdAt: now,
        updatedAt: now,
      });
      invoicesCreated += 1;
    }

    const existingPayouts = await ctx.db.query("stripePayouts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(500);
    for (const payout of args.projection.payouts) {
      if (existingPayouts.some((row) => row.payoutId === payout.payoutId)) {
        skippedDuplicates += 1;
        continue;
      }
      const driftMinor = payout.grossMinor - payout.feesMinor - payout.amountMinor;
      const entryIds: Id<"journalEntries">[] = [];
      if (driftMinor === 0) {
        const posted: { entryId: Id<"journalEntries"> } = await ctx.runMutation(api.ledger.postEntry, {
          entityId: entity._id,
          date: payout.arrivalDate,
          memo: `Stripe payout ${payout.payoutId}`,
          source: "stripe",
          sourceId: payout.payoutId,
          lines: [
            {
              accountId: accounts.checkingAccount._id,
              debitMinor: payout.amountMinor,
              creditMinor: 0,
              currency: payout.currency,
            },
            {
              accountId: accounts.clearingAccount._id,
              debitMinor: 0,
              creditMinor: payout.amountMinor,
              currency: payout.currency,
            },
          ],
        });
        entryIds.push(posted.entryId);
        ledgerEntriesPosted += 1;
      } else {
        await ctx.db.insert("inboxItems", {
          entityId: entity._id,
          kind: "payout_mismatch",
          payloadSummary: `Stripe payout ${payout.payoutId} drift ${driftMinor} ${payout.currency}: gross ${payout.grossMinor} - fees ${payout.feesMinor} != payout ${payout.amountMinor}`,
          status: "open",
          createdAt: now,
          updatedAt: now,
        });
        inboxItemsCreated += 1;
      }

      await ctx.db.insert("stripePayouts", {
        entityId: entity._id,
        payoutId: payout.payoutId,
        amountMinor: payout.amountMinor,
        grossMinor: payout.grossMinor,
        feesMinor: payout.feesMinor,
        arrivalDate: payout.arrivalDate,
        status: driftMinor === 0 ? "reconciled" : "mismatch",
        entryIds,
        createdAt: now,
        updatedAt: now,
      });
      payoutsCreated += 1;
    }

    return {
      mode: args.projection.mode,
      reason: args.projection.reason,
      entityId: entity._id,
      clearingAccountId: accounts.clearingAccount._id,
      contactsCreated,
      incomeTransactionsCreated,
      invoicesCreated,
      payoutsCreated,
      inboxItemsCreated,
      ledgerEntriesPosted,
      skippedDuplicates,
      integrationGaps: [
        "Existing contacts/invoices schema has no dedicated Stripe object ID fields, so dedupe currently uses email, aliases, and invoice number.",
        "Stripe payout drill-down line items are returned in action results and fixture previews; persistence needs a child table to avoid unbounded arrays on stripePayouts.",
      ],
    };
  },
});

async function stripeRequest<T>(
  key: string,
  path: string,
  init: { method?: "GET" | "POST"; form?: URLSearchParams } = {},
) {
  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": STRIPE_API_VERSION,
      ...(init.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: init.form,
  });
  if (!response.ok) {
    const status = response.status;
    let message = `Stripe API request failed with HTTP ${status}.`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = `Stripe API request failed: ${body.error.message}`;
    } catch {
      // Keep the generic message and never echo request credentials.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

function formData(entries: Array<[string, string | number | boolean | undefined]>) {
  const form = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    form.append(key, String(value));
  }
  return form;
}

function customerId(customer: string | StripeApiCustomer | null | undefined) {
  if (!customer) return undefined;
  return typeof customer === "string" ? customer : customer.id;
}

function customerName(customer: string | StripeApiCustomer | null | undefined, fallback: string) {
  if (customer && typeof customer !== "string") return customer.name ?? customer.email ?? fallback;
  return fallback;
}

function balanceTransactionFromPaymentIntent(paymentIntent: StripeApiPaymentIntent) {
  const charge = paymentIntent.latest_charge;
  if (!charge || typeof charge === "string") return null;
  const balanceTransaction = charge.balance_transaction;
  if (!balanceTransaction || typeof balanceTransaction === "string") return null;
  return balanceTransaction;
}

function projectionFromStripeLists(args: {
  reason: string;
  customers: StripeApiCustomer[];
  paymentIntents: StripeApiPaymentIntent[];
  invoices: StripeApiInvoice[];
  payouts: Array<{ payout: StripeApiPayout; balanceTransactions: StripeApiBalanceTransaction[] }>;
}): StripeProjection {
  const customerRows = args.customers.map((customer) => ({
    stripeCustomerId: customer.id,
    name: customer.name ?? customer.email ?? customer.id,
    email: customer.email ?? undefined,
  }));
  const customerMap = new Map(customerRows.map((customer) => [customer.stripeCustomerId, customer]));

  const income = args.paymentIntents
    .filter((paymentIntent) => (paymentIntent.amount_received ?? 0) > 0)
    .map((paymentIntent) => {
      const balanceTransaction = balanceTransactionFromPaymentIntent(paymentIntent);
      const charge =
        paymentIntent.latest_charge && typeof paymentIntent.latest_charge !== "string"
          ? paymentIntent.latest_charge.id
          : typeof paymentIntent.latest_charge === "string"
            ? paymentIntent.latest_charge
            : undefined;
      const stripeCustomerId = customerId(paymentIntent.customer);
      return {
        stripePaymentIntentId: paymentIntent.id,
        stripeChargeId: charge,
        customerStripeId: stripeCustomerId,
        customerName:
          (stripeCustomerId ? customerMap.get(stripeCustomerId)?.name : undefined) ??
          customerName(paymentIntent.customer, "Stripe customer"),
        description: paymentIntent.description ?? "Stripe payment",
        date: isoDateFromUnix(paymentIntent.created),
        amountMinor: paymentIntent.amount_received ?? paymentIntent.amount ?? 0,
        feeMinor: balanceTransaction?.fee ?? 0,
        currency: normalizeCurrency(paymentIntent.currency),
        feeSource: balanceTransaction?.fee ? ("stripe_balance_transaction" as const) : ("unavailable" as const),
      };
    });

  const invoices = args.invoices.map((invoice) => {
    const stripeCustomerId = customerId(invoice.customer);
    return {
      stripeInvoiceId: invoice.id,
      number: invoice.number ?? invoice.id,
      customerStripeId: stripeCustomerId,
      customerName:
        invoice.customer_name ??
        (stripeCustomerId ? customerMap.get(stripeCustomerId)?.name : undefined) ??
        customerName(invoice.customer, "Stripe customer"),
      customerEmail:
        invoice.customer_email ??
        (stripeCustomerId ? customerMap.get(stripeCustomerId)?.email : undefined) ??
        undefined,
      status: normalizeInvoiceStatus(invoice.status),
      issueDate: isoDateFromUnix(invoice.created),
      dueDate: isoDateFromUnix(invoice.due_date ?? invoice.created),
      totalMinor: invoice.total ?? 0,
      amountPaidMinor: invoice.amount_paid ?? 0,
      currency: normalizeCurrency(invoice.currency),
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? undefined,
    };
  });

  const payouts = args.payouts.map(({ payout, balanceTransactions }) => {
    const lines = balanceTransactions.map((transaction) => ({
      sourceId:
        typeof transaction.source === "string"
          ? transaction.source
          : transaction.source?.id ?? transaction.id,
      description: transaction.description ?? transaction.id,
      grossMinor: Math.max(0, transaction.amount ?? 0),
      feeMinor: transaction.fee ?? 0,
      netMinor: transaction.net ?? 0,
      currency: normalizeCurrency(transaction.currency),
    }));
    const grossMinor = lines.reduce((sum, line) => sum + line.grossMinor, 0);
    const feesMinor = lines.reduce((sum, line) => sum + line.feeMinor, 0);
    const amountMinor = payout.amount ?? 0;
    return {
      payoutId: payout.id,
      arrivalDate: isoDateFromUnix(payout.arrival_date),
      amountMinor,
      grossMinor,
      feesMinor,
      driftMinor: grossMinor - feesMinor - amountMinor,
      currency: normalizeCurrency(payout.currency),
      lines,
    };
  });

  return {
    mode: "stripe_test",
    reason: args.reason,
    customers: customerRows,
    income,
    invoices,
    payouts: payouts.length > 0 ? payouts : buildFixtureProjection().payouts,
  };
}

async function fetchStripeProjection(key: string, reason: string): Promise<StripeProjection> {
  const [customers, paymentIntents, invoices, payouts] = await Promise.all([
    stripeRequest<StripeList<StripeApiCustomer>>(key, "/customers?limit=100"),
    stripeRequest<StripeList<StripeApiPaymentIntent>>(
      key,
      "/payment_intents?limit=100&expand[]=data.customer&expand[]=data.latest_charge.balance_transaction",
    ),
    stripeRequest<StripeList<StripeApiInvoice>>(key, "/invoices?limit=100&expand[]=data.customer"),
    stripeRequest<StripeList<StripeApiPayout>>(key, "/payouts?limit=10"),
  ]);
  const payoutRows = [];
  for (const payout of payouts.data ?? []) {
    const balanceTransactions = await stripeRequest<StripeList<StripeApiBalanceTransaction>>(
      key,
      `/balance_transactions?limit=100&payout=${encodeURIComponent(payout.id)}`,
    );
    payoutRows.push({ payout, balanceTransactions: balanceTransactions.data ?? [] });
  }

  return projectionFromStripeLists({
    reason,
    customers: customers.data ?? [],
    paymentIntents: paymentIntents.data ?? [],
    invoices: invoices.data ?? [],
    payouts: payoutRows,
  });
}

export const validateEnvironment = action({
  args: {
    entityId: v.optional(v.id("entities")),
  },
  handler: async (ctx, args) => {
    const stateResult: StripeState = await ctx.runQuery(authorizeRef, args);
    const key = stripeKeyState(process.env.STRIPE_SECRET_KEY);
    if (!stateResult.entity) {
      return {
        mode: "fixture" as const,
        ok: false,
        checklist: stateResult.checklist,
        blocker: "Create the Live Sandbox entity before validating Stripe.",
      };
    }
    if (!key.safeToCallStripe) {
      return {
        mode: "fixture" as const,
        ok: false,
        checklist: stateResult.checklist,
        blocker: key.reason,
      };
    }

    try {
      await stripeRequest<{ object: string }>(process.env.STRIPE_SECRET_KEY!.trim(), "/balance");
      return {
        mode: "stripe_test" as const,
        ok: true,
        checklist: stateResult.checklist.map((item) =>
          item.key === "key"
            ? { ...item, status: "pass" as const, detail: "Stripe accepted the test-mode key for a balance read." }
            : item,
        ),
        blocker: null,
      };
    } catch (error) {
      return {
        mode: "fixture" as const,
        ok: false,
        checklist: stateResult.checklist.map((item) =>
          item.key === "key"
            ? { ...item, status: "fail" as const, detail: error instanceof Error ? error.message : "Stripe rejected the key." }
            : item,
        ),
        blocker: error instanceof Error ? error.message : "Stripe rejected the key.",
      };
    }
  },
});

export const syncNow = action({
  args: {
    entityId: v.id("entities"),
  },
  handler: async (ctx, args): Promise<ApplyProjectionResult> => {
    const stateResult: StripeState = await ctx.runQuery(authorizeRef, { entityId: args.entityId });
    if (!stateResult.entity) {
      throw new Error("Create the Live Sandbox entity before syncing Stripe.");
    }
    const key = stripeKeyState(process.env.STRIPE_SECRET_KEY);
    const projection = key.safeToCallStripe
      ? await fetchStripeProjection(process.env.STRIPE_SECRET_KEY!.trim(), "Stripe test-mode sync completed via PaymentIntents, Customers, Invoices, and Payout balance transactions.")
      : buildFixtureProjection();
    return await ctx.runMutation(applyProjectionRef, {
      entityId: args.entityId,
      projection: key.safeToCallStripe ? projection : { ...projection, mode: "fixture", reason: key.reason },
    });
  },
});

export const seedTestAccount = action({
  args: {
    entityId: v.id("entities"),
  },
  handler: async (ctx, args): Promise<ApplyProjectionResult> => {
    const stateResult: StripeState = await ctx.runQuery(authorizeRef, { entityId: args.entityId });
    if (!stateResult.entity) {
      throw new Error("Create the Live Sandbox entity before seeding Stripe.");
    }
    const key = stripeKeyState(process.env.STRIPE_SECRET_KEY);
    if (!key.safeToCallStripe) {
      return await ctx.runMutation(applyProjectionRef, {
        entityId: args.entityId,
        projection: { ...buildFixtureProjection(), reason: key.reason },
      });
    }

    const secret = process.env.STRIPE_SECRET_KEY!.trim();
    const createdCustomers: StripeApiCustomer[] = [];
    const fixture = buildFixtureProjection();
    for (const customer of fixture.customers) {
      const created = await stripeRequest<StripeApiCustomer>(secret, "/customers", {
        method: "POST",
        form: formData([
          ["name", customer.name],
          ["email", customer.email],
          ["metadata[openbooks_seed]", "m8"],
        ]),
      });
      createdCustomers.push(created);
    }

    for (let index = 0; index < 25; index += 1) {
      const customer = createdCustomers[index % createdCustomers.length];
      const amountMinor = fixture.income[index].amountMinor;
      await stripeRequest<StripeApiPaymentIntent>(secret, "/payment_intents", {
        method: "POST",
        form: formData([
          ["amount", amountMinor],
          ["currency", "usd"],
          ["customer", customer.id],
          ["payment_method", "pm_card_visa"],
          ["confirm", true],
          ["automatic_payment_methods[enabled]", true],
          ["automatic_payment_methods[allow_redirects]", "never"],
          ["description", `OpenBooks M8 seed payment ${index + 1}`],
          ["metadata[openbooks_seed]", "m8"],
        ]),
      });
    }

    for (let index = 0; index < 3; index += 1) {
      const customer = createdCustomers[index];
      await stripeRequest<{ id: string }>(secret, "/invoiceitems", {
        method: "POST",
        form: formData([
          ["customer", customer.id],
          ["amount", fixture.invoices[index].totalMinor],
          ["currency", "usd"],
          ["description", `OpenBooks M8 invoice service line ${index + 1}`],
          ["metadata[openbooks_seed]", "m8"],
        ]),
      });
      const invoice = await stripeRequest<StripeApiInvoice>(secret, "/invoices", {
        method: "POST",
        form: formData([
          ["customer", customer.id],
          ["collection_method", "send_invoice"],
          ["days_until_due", 15],
          ["metadata[openbooks_seed]", "m8"],
        ]),
      });
      await stripeRequest<StripeApiInvoice>(secret, `/invoices/${encodeURIComponent(invoice.id)}/finalize`, {
        method: "POST",
      });
    }

    const projection = await fetchStripeProjection(secret, "Stripe test account seeded and synced. Test payouts may still use fixtures if none are available.");
    return await ctx.runMutation(applyProjectionRef, { entityId: args.entityId, projection });
  },
});

export const sendInvoiceViaStripe = action({
  args: {
    entityId: v.id("entities"),
    customerName: v.string(),
    customerEmail: v.string(),
    memo: v.optional(v.string()),
    daysUntilDue: v.number(),
    lineItems: v.array(
      v.object({
        description: v.string(),
        amountMinor: v.number(),
        quantity: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const stateResult: StripeState = await ctx.runQuery(authorizeRef, { entityId: args.entityId });
    if (!stateResult.entity) {
      throw new Error("Create the Live Sandbox entity before sending Stripe invoices.");
    }
    const key = stripeKeyState(process.env.STRIPE_SECRET_KEY);
    if (!key.safeToCallStripe) {
      const totalMinor = args.lineItems.reduce((sum, item) => sum + item.amountMinor * item.quantity, 0);
      return {
        mode: "fixture" as const,
        blocker: key.reason,
        stripeInvoiceId: "in_fixture_composer",
        hostedInvoiceUrl: null,
        total: { amountMinor: totalMinor, currency: USD } satisfies { amountMinor: number; currency: string },
      };
    }

    const secret = process.env.STRIPE_SECRET_KEY!.trim();
    const customer = await stripeRequest<StripeApiCustomer>(secret, "/customers", {
      method: "POST",
      form: formData([
        ["name", args.customerName],
        ["email", args.customerEmail],
        ["metadata[openbooks_source]", "invoice_composer"],
      ]),
    });
    let totalMinor = 0;
    for (const [index, item] of args.lineItems.entries()) {
      assertMinorUnit(item.amountMinor, `Line ${index + 1} amount`);
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        throw new Error("Invoice line quantity must be a positive integer.");
      }
      const lineTotal = item.amountMinor * item.quantity;
      totalMinor += lineTotal;
      await stripeRequest<{ id: string }>(secret, "/invoiceitems", {
        method: "POST",
        form: formData([
          ["customer", customer.id],
          ["amount", lineTotal],
          ["currency", "usd"],
          ["description", item.description],
          ["metadata[openbooks_source]", "invoice_composer"],
        ]),
      });
    }
    const invoice = await stripeRequest<StripeApiInvoice>(secret, "/invoices", {
      method: "POST",
      form: formData([
        ["customer", customer.id],
        ["collection_method", "send_invoice"],
        ["days_until_due", args.daysUntilDue],
        ["description", args.memo],
        ["metadata[openbooks_source]", "invoice_composer"],
      ]),
    });
    const finalized = await stripeRequest<StripeApiInvoice>(
      secret,
      `/invoices/${encodeURIComponent(invoice.id)}/finalize`,
      { method: "POST" },
    );

    await ctx.runMutation(applyProjectionRef, {
      entityId: args.entityId,
      projection: {
        mode: "stripe_test",
        reason: "Invoice composer created and finalized a Stripe hosted invoice.",
        customers: [{ stripeCustomerId: customer.id, name: customer.name ?? args.customerName, email: customer.email ?? args.customerEmail }],
        income: [],
        invoices: [
          {
            stripeInvoiceId: finalized.id,
            number: finalized.number ?? finalized.id,
            customerStripeId: customer.id,
            customerName: customer.name ?? args.customerName,
            customerEmail: customer.email ?? args.customerEmail,
            status: normalizeInvoiceStatus(finalized.status),
            issueDate: isoDateFromUnix(finalized.created),
            dueDate: isoDateFromUnix(finalized.due_date ?? finalized.created),
            totalMinor: finalized.total ?? totalMinor,
            amountPaidMinor: finalized.amount_paid ?? 0,
            currency: normalizeCurrency(finalized.currency),
            hostedInvoiceUrl: finalized.hosted_invoice_url ?? undefined,
          },
        ],
        payouts: [],
      },
    });

    return {
      mode: "stripe_test" as const,
      blocker: null,
      stripeInvoiceId: finalized.id,
      hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
      total: { amountMinor: finalized.total ?? totalMinor, currency: normalizeCurrency(finalized.currency) } satisfies {
        amountMinor: number;
        currency: string;
      },
    };
  },
});
