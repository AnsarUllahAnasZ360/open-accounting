import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";
import { postLedgerEntryCore } from "./ledger";
import { assertNonNegativeMinorUnit } from "./money";
import { ensureSystemSyncActor } from "./systemActors";

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
  mode: v.union(v.literal("stripe_test"), v.literal("stripe_live"), v.literal("fixture")),
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
  mode: "stripe_test" | "stripe_live" | "fixture";
  reason: string;
  customers: StripeCustomerProjection[];
  income: StripeIncomeProjection[];
  invoices: StripeInvoiceProjection[];
  payouts: StripePayoutProjection[];
};

type ResolvedStripeCredential = {
  connectionId: Id<"financialConnections">;
  entityId: Id<"entities">;
  workspaceId: Id<"workspaces">;
  label: string;
  mode: "test" | "live";
  restrictedKey: string;
  webhookSecret?: string;
  accountId?: string;
};

// Exported for unit tests (E7.5) that build a controlled lifecycle projection.
export type StripeProjectionForTest = StripeProjection;

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
	    currency: string;
	    lines: StripePayoutProjection["lines"];
	  }>;
  fixturePreview: StripeProjection;
  integrationGaps: string[];
};

type ApplyProjectionResult = {
  mode: "stripe_test" | "stripe_live" | "fixture";
  reason: string;
  entityId: Id<"entities">;
  clearingAccountId: Id<"ledgerAccounts">;
  contactsCreated: number;
  incomeTransactionsCreated: number;
	  invoicesCreated: number;
	  payoutsCreated: number;
	  payoutLinesCreated: number;
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

	type StripeApiCharge = {
	  id: string;
	  amount?: number | null;
	  amount_captured?: number | null;
	  currency?: string | null;
	  customer?: string | StripeApiCustomer | null;
	  description?: string | null;
	  created?: number | null;
	  paid?: boolean | null;
	  payment_intent?: string | null;
	  balance_transaction?: string | StripeApiBalanceTransaction | null;
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
  method?: string | null;
  reconciliation_status?: string | null;
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
  has_more?: boolean;
};

const authorizeRef = makeFunctionReference<"query", { entityId?: Id<"entities"> }, StripeState>(
  "stripe:state",
);

const applyProjectionRef = makeFunctionReference<
  "mutation",
  { entityId: Id<"entities">; projection: StripeProjection },
  ApplyProjectionResult
>("stripe:applyProjection");
const applyProjectionInternalRef = makeFunctionReference<
  "mutation",
  { entityId?: Id<"entities">; projection: StripeProjection },
  ApplyProjectionResult
>("stripe:applyProjectionInternal");

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
    const enabled = process.env.OPENBOOKS_REAL_TEST_LIVE_CONNECTORS === "1";
    return {
      configured: true,
      mode: "live" as const,
      label: key.startsWith("rk_live_") ? "Restricted live key configured" : "Live secret key configured",
      safeToCallStripe: enabled,
      reason: enabled
        ? "Stripe live-mode key is present and real-data connectors are explicitly enabled."
        : "Live Stripe is blocked until OPENBOOKS_REAL_TEST_LIVE_CONNECTORS=1 is set.",
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
    reason: "Stripe key must start with sk_test_, rk_test_, sk_live_, or rk_live_.",
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
  const inTransitAccount = await ensureAccount(ctx, entity, {
    number: "1160",
    name: "Payouts In-Transit",
    type: "asset",
    subtype: "in_transit",
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

  return { clearingAccount, inTransitAccount, salesAccount, feesAccount, receivableAccount, checkingAccount, stripeAccount };
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
	    // E1-T9: the customer contact resolved by the caller. Attributed to the
	    // income recognition lines so revenue-by-customer rolls up off the ledger.
	    contactId?: Id<"contacts">;
	    actorUserId: Id<"users">;
	    auditAction?: string;
	  },
	) {
	  const gross = await postLedgerEntryCore(ctx, {
	    entity: args.entity,
	    userId: args.actorUserId,
	    date: args.item.date,
	    memo: `${args.item.customerName} Stripe payment gross`,
	    source: "stripe",
	    sourceId: args.item.stripePaymentIntentId,
	    auditAction: args.auditAction,
	    lines: [
	      {
	        accountId: args.clearingAccountId,
        debitMinor: args.item.amountMinor,
        creditMinor: 0,
        currency: args.item.currency,
        contactId: args.contactId,
      },
      {
        accountId: args.salesAccountId,
        debitMinor: 0,
        creditMinor: args.item.amountMinor,
        currency: args.item.currency,
        contactId: args.contactId,
      },
    ],
  });

	  let feeEntryId: Id<"journalEntries"> | null = null;
	  if (args.item.feeMinor > 0) {
	    const fee = await postLedgerEntryCore(ctx, {
	      entity: args.entity,
	      userId: args.actorUserId,
	      date: args.item.date,
	      memo: `${args.item.customerName} Stripe processing fee`,
	      source: "stripe",
	      sourceId: `${args.item.stripePaymentIntentId}:fee`,
	      auditAction: args.auditAction,
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

	    const [clearingAccount, stripeAccount, payouts, payoutLines] = await Promise.all([
	      findAccountByNumber(ctx, entity._id, "1150"),
	      ctx.db.query("stripeAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).first(),
	      ctx.db.query("stripePayouts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(20),
	      ctx.db.query("stripePayoutLines").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(500),
	    ]);
	    const payoutLinesByPayoutId = new Map<Id<"stripePayouts">, StripePayoutProjection["lines"]>();
	    for (const line of payoutLines) {
	      const existing = payoutLinesByPayoutId.get(line.payoutId) ?? [];
	      existing.push({
	        sourceId: line.sourceId,
	        description: line.description,
	        grossMinor: line.grossMinor,
	        feeMinor: line.feeMinor,
	        netMinor: line.netMinor,
	        currency: line.currency,
	      });
	      payoutLinesByPayoutId.set(line.payoutId, existing);
	    }

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
	        currency: entity.currency,
	        lines: payoutLinesByPayoutId.get(payout._id) ?? [],
	      })),
	      fixturePreview,
	      integrationGaps: [
	        "Schema needs Stripe-native IDs on contacts and invoices for production-grade dedupe.",
	        "Connect Stripe Dashboard or Stripe CLI forwarding to /stripe/webhook for end-to-end webhook delivery proof.",
	      ],
    };
  },
});

function payoutLineFingerprint(lines: StripePayoutProjection["lines"]) {
  return JSON.stringify(
    lines
      .map((line) => ({
        sourceId: line.sourceId,
        description: line.description,
        grossMinor: line.grossMinor,
        feeMinor: line.feeMinor,
        netMinor: line.netMinor,
        currency: normalizeCurrency(line.currency),
      }))
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
  );
}

async function replaceStripePayoutLines(
  ctx: MutationCtx,
  args: {
    entityId: Id<"entities">;
    payout: Doc<"stripePayouts">;
    lines: StripePayoutProjection["lines"];
  },
) {
  const existing = await ctx.db
    .query("stripePayoutLines")
    .withIndex("by_payout", (q) => q.eq("payoutId", args.payout._id))
    .collect();
  const existingFingerprint = payoutLineFingerprint(existing);
  const desiredFingerprint = payoutLineFingerprint(args.lines);
  if (existingFingerprint === desiredFingerprint) return 0;

  for (const line of existing) {
    await ctx.db.delete(line._id);
  }

  const now = Date.now();
  for (const line of args.lines) {
    await ctx.db.insert("stripePayoutLines", {
      entityId: args.entityId,
      payoutId: args.payout._id,
      stripePayoutId: args.payout.payoutId,
      sourceId: line.sourceId,
      description: line.description,
      grossMinor: line.grossMinor,
      feeMinor: line.feeMinor,
      netMinor: line.netMinor,
      currency: normalizeCurrency(line.currency),
      createdAt: now,
      updatedAt: now,
    });
  }
  return args.lines.length;
}

async function stripeWebhookTargetEntity(ctx: MutationCtx, entityId?: Id<"entities">) {
  if (entityId) {
    return await ctx.db.get(entityId);
  }

  const stripeAccount = await ctx.db.query("stripeAccounts").first();
  if (stripeAccount) {
    return await ctx.db.get(stripeAccount.entityId);
  }

  return await ctx.db
    .query("entities")
    .withIndex("by_slug", (q) => q.eq("slug", "live-sandbox"))
    .first();
}

// ---------------------------------------------------------------------------
// E1-T4 clearing/in-transit health (the Stripe settlement tripwire)
// ---------------------------------------------------------------------------
// The Stripe clearing model is self-checking: one payout = one deposit = one
// chain, and Stripe Clearing (1150) must net to ~0 once each batch drains. We
// allow a tiny epsilon for rounding noise in declared-vs-computed fees, but a
// drain that would push clearing materially negative means a half-posted chain
// and is refused (the drain is skipped, the drift is surfaced to the Inbox).
const CLEARING_DRIFT_EPSILON_MINOR = 1;

/**
 * Current minor-unit ledger balance of a single account, signed as a DEBIT
 * balance (debits − credits). 1150 (Stripe Clearing) and 1160 (Payouts
 * In-Transit) are both assets with a normal debit balance, so a positive number
 * is money sitting in the account and a negative number means it has been
 * over-drained. Reads the `by_account` index so it scales without scanning the
 * whole entity ledger.
 */
async function accountDebitBalanceMinor(
  ctx: MutationCtx | QueryCtx,
  accountId: Id<"ledgerAccounts">,
): Promise<number> {
  let balance = 0;
  for await (const line of ctx.db
    .query("journalLines")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))) {
    balance += line.debitMinor - line.creditMinor;
  }
  return balance;
}

async function applyProjectionCore(
  ctx: MutationCtx,
  args: {
    entity: Doc<"entities">;
    projection: StripeProjection;
    actorUserId: Id<"users">;
    auditAction?: string;
  },
): Promise<ApplyProjectionResult> {
  const accounts = await ensureStripeAccounts(ctx, args.entity);
  const now = Date.now();
  let contactsCreated = 0;
  let incomeTransactionsCreated = 0;
  let invoicesCreated = 0;
  let payoutsCreated = 0;
  let payoutLinesCreated = 0;
  let inboxItemsCreated = 0;
  let ledgerEntriesPosted = 0;
  let skippedDuplicates = 0;

  const contacts = await ctx.db.query("contacts").withIndex("by_entity", (q) => q.eq("entityId", args.entity._id)).collect();
  const contactsByStripeId = new Map<string, Doc<"contacts">>();
  for (const customer of args.projection.customers) {
    const result = await contactForCustomer(ctx, args.entity._id, customer, contacts);
    contactsByStripeId.set(customer.stripeCustomerId, result.contact);
    if (result.created) contactsCreated += 1;
  }

  for (const item of args.projection.income) {
    assertNonNegativeMinorUnit(item.amountMinor, "Stripe income amount");
    assertNonNegativeMinorUnit(item.feeMinor, "Stripe fee amount");
    const duplicate = await ctx.db
      .query("transactions")
      .withIndex("by_external_id", (q) => q.eq("externalId", item.stripePaymentIntentId))
      .first();
    if (duplicate && duplicate.entityId === args.entity._id) {
      skippedDuplicates += 1;
      continue;
    }

    const contact = item.customerStripeId ? contactsByStripeId.get(item.customerStripeId) : undefined;
    const posted = await postStripeIncome(ctx, {
      entity: args.entity,
      item,
      clearingAccountId: accounts.clearingAccount._id,
      salesAccountId: accounts.salesAccount._id,
      feesAccountId: accounts.feesAccount._id,
      contactId: contact?._id,
      actorUserId: args.actorUserId,
      auditAction: args.auditAction,
    });
    ledgerEntriesPosted += posted.feeEntryId ? 2 : 1;

    await ctx.db.insert("transactions", {
      entityId: args.entity._id,
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

  const existingInvoices = await ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", args.entity._id)).collect();
  const existingInboxItems = await ctx.db.query("inboxItems").withIndex("by_entity", (q) => q.eq("entityId", args.entity._id)).collect();
  for (const invoice of args.projection.invoices) {
    if (invoice.totalMinor < 0 || invoice.amountPaidMinor < 0) {
      const payloadSummary = `Stripe invoice ${invoice.number} has a negative total or paid amount and needs review as a credit, refund, or adjustment.`;
      if (existingInboxItems.some((item) => item.kind === "question" && item.status === "open" && item.payloadSummary === payloadSummary)) {
        skippedDuplicates += 1;
      } else {
        await ctx.db.insert("inboxItems", {
          entityId: args.entity._id,
          kind: "question",
          payloadSummary,
          status: "open",
          createdAt: now,
          updatedAt: now,
        });
        inboxItemsCreated += 1;
      }
      continue;
    }
    assertNonNegativeMinorUnit(invoice.totalMinor, "Stripe invoice total");
    assertNonNegativeMinorUnit(invoice.amountPaidMinor, "Stripe invoice paid amount");
    // E7.2: dedupe on Stripe's native invoice id (in_...) when we have it; it is
    // stable and globally unique. Only fall back to the human-facing `number`
    // (which can repeat across Stripe accounts / manual invoices) when no Stripe
    // id is on file for either side.
    const existingInvoice =
      existingInvoices.find((row) => row.stripeInvoiceId === invoice.stripeInvoiceId) ??
      existingInvoices.find((row) => !row.stripeInvoiceId && row.number === invoice.number);
    if (existingInvoice) {
      await ctx.db.patch(existingInvoice._id, {
        status: invoice.status,
        amountPaidMinor: invoice.amountPaidMinor,
        hostedInvoiceUrl: invoice.hostedInvoiceUrl,
        stripeInvoiceId: invoice.stripeInvoiceId,
        source: "stripe",
        updatedAt: now,
      });
      skippedDuplicates += 1;
      continue;
    }

    const contact =
      (invoice.customerStripeId ? contactsByStripeId.get(invoice.customerStripeId) : undefined) ??
      (
        await contactForCustomer(
          ctx,
          args.entity._id,
          {
            stripeCustomerId: invoice.customerStripeId ?? `invoice:${invoice.stripeInvoiceId}`,
            name: invoice.customerName,
            email: invoice.customerEmail,
          },
          contacts,
        )
      ).contact;

    const entryIds: Id<"journalEntries">[] = [];
    const receivableMinor = invoice.totalMinor - invoice.amountPaidMinor;
    if ((invoice.status === "open" || invoice.status === "overdue") && receivableMinor > 0) {
      const posted = await postLedgerEntryCore(ctx, {
        entity: args.entity,
        userId: args.actorUserId,
        date: invoice.issueDate,
        memo: `${invoice.customerName} Stripe invoice ${invoice.number}`,
        source: "invoice",
        sourceId: invoice.stripeInvoiceId,
        auditAction: args.auditAction,
        lines: [
          {
            accountId: accounts.receivableAccount._id,
            debitMinor: receivableMinor,
            creditMinor: 0,
            currency: invoice.currency,
            contactId: contact._id,
          },
          {
            accountId: accounts.salesAccount._id,
            debitMinor: 0,
            creditMinor: receivableMinor,
            currency: invoice.currency,
            contactId: contact._id,
          },
        ],
      });
      entryIds.push(posted.entryId);
      ledgerEntriesPosted += 1;
    }

    await ctx.db.insert("invoices", {
      entityId: args.entity._id,
      contactId: contact._id,
      number: invoice.number,
      status: invoice.status,
      currency: invoice.currency,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      totalMinor: invoice.totalMinor,
      amountPaidMinor: invoice.amountPaidMinor,
      entryIds,
      hostedInvoiceUrl: invoice.hostedInvoiceUrl,
      stripeInvoiceId: invoice.stripeInvoiceId,
      source: "stripe",
      createdAt: now,
      updatedAt: now,
    });
    invoicesCreated += 1;
  }

  const existingPayouts = await ctx.db.query("stripePayouts").withIndex("by_entity", (q) => q.eq("entityId", args.entity._id)).collect();
  for (const payout of args.projection.payouts) {
    const existingPayout = existingPayouts.find((row) => row.payoutId === payout.payoutId);
    if (existingPayout) {
      payoutLinesCreated += await replaceStripePayoutLines(ctx, {
        entityId: args.entity._id,
        payout: existingPayout,
        lines: payout.lines,
      });
      skippedDuplicates += 1;
      continue;
    }

    const driftMinor = payout.grossMinor - payout.feesMinor - payout.amountMinor;
    const entryIds: Id<"journalEntries">[] = [];
    // E7.1/E7.3 Payouts-In-Transit model: at payout CREATION we only drain Stripe
    // Clearing into Payouts In-Transit (Dr 1160 / Cr 1150). We do NOT touch the
    // bank account here — the bank debit happens exactly once, later, when the
    // matched Plaid deposit arrives (Dr Bank / Cr 1160). This is what closes the
    // double-count gap: the payout entry only moves money between two Stripe-side
    // clearing accounts; the real cash event is the Plaid arrival.
    //
    // We drain the TRUE clearing balance this payout represents (gross - fees =
    // the net that charges/fees left sitting in clearing) so clearing nets to ~0
    // per payout. The payout's declared `amountMinor` is what Stripe says it will
    // deposit; any drift between that and (gross - fees) is a reconciliation
    // problem surfaced to the Inbox, but it must not leave clearing unbalanced.
    const clearingDrainMinor = payout.grossMinor - payout.feesMinor;
    // E1-T4 invariant. The drain MUST equal (gross − fees) — the true net the
    // charges/fees left in clearing — and after draining, Stripe Clearing (1150)
    // must not be left negative beyond a documented epsilon. We post the balanced
    // Dr1160/Cr1150 drain (so the chain is always recorded and the entry itself
    // never leaves the ledger unbalanced), then re-read 1150: if it crossed
    // negative the upstream charges for this payout were never recognized (a
    // half-posted chain), so we surface a clearing_drift card instead of silently
    // letting clearing run negative. A subsequent income sync that credits
    // clearing repairs it; the card + stripeClearingHealth explain the gap.
    if (clearingDrainMinor > 0) {
      const posted = await postLedgerEntryCore(ctx, {
        entity: args.entity,
        userId: args.actorUserId,
        date: payout.arrivalDate,
        memo: `Stripe payout ${payout.payoutId} in transit`,
        source: "stripe",
        sourceId: payout.payoutId,
        auditAction: args.auditAction,
        lines: [
          {
            accountId: accounts.inTransitAccount._id,
            debitMinor: clearingDrainMinor,
            creditMinor: 0,
            currency: payout.currency,
          },
          {
            accountId: accounts.clearingAccount._id,
            debitMinor: 0,
            creditMinor: clearingDrainMinor,
            currency: payout.currency,
          },
        ],
      });
      entryIds.push(posted.entryId);
      ledgerEntriesPosted += 1;

      const clearingBalanceAfter = await accountDebitBalanceMinor(ctx, accounts.clearingAccount._id);
      if (clearingBalanceAfter < -CLEARING_DRIFT_EPSILON_MINOR) {
        await ctx.db.insert("inboxItems", {
          entityId: args.entity._id,
          kind: "clearing_drift",
          payloadSummary: `Stripe payout ${payout.payoutId} drained ${clearingDrainMinor} ${payout.currency} but left Stripe Clearing (1150) at ${clearingBalanceAfter} (below ${-CLEARING_DRIFT_EPSILON_MINOR}). The upstream charges for this payout are not yet recognized; reconcile them so clearing nets to ~0.`,
          status: "open",
          createdAt: now,
          updatedAt: now,
        });
        inboxItemsCreated += 1;
      }
    }

    if (driftMinor !== 0) {
      await ctx.db.insert("inboxItems", {
        entityId: args.entity._id,
        kind: "payout_mismatch",
        payloadSummary: `Stripe payout ${payout.payoutId} drift ${driftMinor} ${payout.currency}: gross ${payout.grossMinor} - fees ${payout.feesMinor} != payout ${payout.amountMinor}`,
        status: "open",
        createdAt: now,
        updatedAt: now,
      });
      inboxItemsCreated += 1;
    }

    const payoutId = await ctx.db.insert("stripePayouts", {
      entityId: args.entity._id,
      payoutId: payout.payoutId,
      amountMinor: payout.amountMinor,
      grossMinor: payout.grossMinor,
      feesMinor: payout.feesMinor,
      arrivalDate: payout.arrivalDate,
      // Always starts pending: the bank deposit hasn't been matched yet. A clean
      // payout becomes "reconciled" when the Plaid arrival is matched; a drifted
      // one (declared != gross−fees) is flagged "mismatch" so it never silently
      // auto-reconciles. A clearing-drift (negative 1150 after drain) does NOT
      // poison the payout status — a real payout webhook can legitimately arrive
      // before its charges are synced; the clearing_drift card + health query
      // surface that gap, and the deposit can still reconcile the payout while a
      // later income sync repairs clearing.
      status: driftMinor === 0 ? "pending" : "mismatch",
      inTransitAccountId: accounts.inTransitAccount._id,
      currency: payout.currency,
      entryIds,
      createdAt: now,
      updatedAt: now,
    });
    const payoutDoc = (await ctx.db.get(payoutId))!;
    payoutLinesCreated += await replaceStripePayoutLines(ctx, {
      entityId: args.entity._id,
      payout: payoutDoc,
      lines: payout.lines,
    });
    payoutsCreated += 1;
  }

  return {
    mode: args.projection.mode,
    reason: args.projection.reason,
    entityId: args.entity._id,
    clearingAccountId: accounts.clearingAccount._id,
    contactsCreated,
    incomeTransactionsCreated,
    invoicesCreated,
    payoutsCreated,
    payoutLinesCreated,
    inboxItemsCreated,
    ledgerEntriesPosted,
    skippedDuplicates,
    integrationGaps: [
      "Stripe invoices now dedupe on stripeInvoiceId; contacts still dedupe on email, aliases, and Stripe customer id.",
      "Stripe webhook delivery still needs Stripe Dashboard or Stripe CLI forwarding configured against this Convex deployment.",
      "Live end-to-end single-counting proof still needs a hosted Plaid Link session plus a real Stripe payout webhook so the deposit<->payout matcher runs on real data.",
      // E1-T1 / RC4: explain (not silently swallow) an empty payout list on a real
      // book so an operator knows zero entries was intentional, not a fixture leak.
      ...(args.projection.payouts.length === 0 && !args.entity.isDemo
        ? [
            "No Stripe payouts were returned for this sync; zero in-transit/clearing entries were posted (fixtures are gated to demo entities, so a real book stays empty until Stripe reports a payout).",
          ]
        : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// E7.1 Deposit<->payout reconciliation matcher (production)
// ---------------------------------------------------------------------------
// When a Plaid bank INFLOW lands that is actually a Stripe payout settling, it
// must be recognized as a reconcile-only transfer (Dr Bank / Cr Payouts
// In-Transit) and NEVER as income. Otherwise the Stripe side already recognized
// the revenue (Dr Clearing / Cr Sales) and the Plaid feed would recognize it a
// SECOND time as income -> revenue/cash double count. The match makes the Plaid
// arrival the single cash event; the payout entry drained clearing into
// in-transit; this entry drains in-transit into the bank. In-transit nets to ~0.

// E1-T3 / decision Q1: do NOT amount-fuzz the Stripe payout match. The
// in-transit clearing model already nets fees out, so the Plaid deposit equals
// the payout net EXACTLY. Match on exact net amount (0 tolerance), never a band.
// (The QBO `max($0.50, 1.0%)` band applies only to non-clearing 1:1 bank<->record
// matches, not to this clearing match.)
const PAYOUT_MATCH_AMOUNT_TOLERANCE_MINOR = 0;
// Arrival window in BUSINESS days, asymmetric: a bank deposit may post up to 2
// business days BEFORE the declared payout arrival date or up to 5 business days
// AFTER it (decision Q1).
const PAYOUT_MATCH_BUSINESS_DAYS_BEFORE = 2;
const PAYOUT_MATCH_BUSINESS_DAYS_AFTER = 5;

/**
 * Signed business-day distance from `from` (the payout arrival date) to `to`
 * (the bank deposit date), counting Mon–Fri only. Positive when the deposit is
 * AFTER the arrival date, negative when BEFORE. Weekends do not count, so a
 * Friday→Monday gap is +1 business day, not +3 calendar days. Returns
 * `Number.POSITIVE_INFINITY` for unparseable input so it never spuriously
 * matches.
 */
export function businessDaysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return Number.POSITIVE_INFINITY;
  if (start === end) return 0;
  const sign = end > start ? 1 : -1;
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  let count = 0;
  for (let cursor = lo + 86_400_000; cursor <= hi; cursor += 86_400_000) {
    const day = new Date(cursor).getUTCDay(); // 0=Sun .. 6=Sat
    if (day !== 0 && day !== 6) count += 1;
  }
  return sign * count;
}

/** True when the bank deposit date is inside the −2/+5 business-day arrival window. */
function withinPayoutArrivalWindow(arrivalDate: string, depositDate: string): boolean {
  const delta = businessDaysBetween(arrivalDate, depositDate);
  if (!Number.isFinite(delta)) return false;
  return delta >= -PAYOUT_MATCH_BUSINESS_DAYS_BEFORE && delta <= PAYOUT_MATCH_BUSINESS_DAYS_AFTER;
}

function looksLikeStripePayout(text: string) {
  const haystack = text.toLowerCase();
  return haystack.includes("stripe") || haystack.includes("payout");
}

/**
 * Find an open (pending) Stripe payout that an incoming Plaid inflow settles.
 *
 * E1-T3 / decision Q1 calibration: a candidate matches when, for the same
 * entity + currency, the payout is still `pending` and unmatched (no bankTxnId),
 * the inflow's net amount equals the payout's declared net EXACTLY (no fuzz),
 * and the deposit lands inside the −2/+5 business-day arrival window. The
 * `"stripe"/"payout"` descriptor is demoted from a hard gate to a scoring
 * BOOSTER only — an unambiguous exact-net + in-window deposit matches even when
 * the descriptor is noisy. To keep a coincidental ACH from being silently
 * reclassified, the candidate must be the ONLY pending payout at that exact net
 * within the window; two or more same-net candidates return `null` and are left
 * for the manual `matchDepositToPayout` action. Pure function over
 * already-loaded rows so it is trivially unit-testable.
 */
export function findMatchingStripePayout(
  inflow: { amountMinor: number; date: string; descriptor: string; currency: string },
  candidates: Array<{
    _id: Id<"stripePayouts">;
    payoutId: string;
    amountMinor: number;
    arrivalDate: string;
    status: "pending" | "reconciled" | "mismatch";
    currency?: string;
    bankTxnId?: Id<"transactions">;
  }>,
) {
  if (inflow.amountMinor <= 0) return null;
  const eligible = candidates.filter(
    (payout) =>
      payout.status === "pending" &&
      !payout.bankTxnId &&
      payout.amountMinor > 0 &&
      (payout.currency ?? inflow.currency).toUpperCase() === inflow.currency.toUpperCase() &&
      Math.abs(payout.amountMinor - inflow.amountMinor) <= PAYOUT_MATCH_AMOUNT_TOLERANCE_MINOR &&
      withinPayoutArrivalWindow(payout.arrivalDate, inflow.date),
  );
  if (eligible.length === 0) return null;
  // Ambiguity guard: two pending payouts at the same exact net inside the window
  // cannot be auto-paired — route to the manual Match action instead.
  if (eligible.length > 1) return null;
  return eligible[0];
}

async function loadMatchingStripePayoutCandidates(
  ctx: MutationCtx,
  entityId: Id<"entities">,
  amountMinor: number,
) {
  return await ctx.db
    .query("stripePayouts")
    .withIndex("by_entity_status_amount", (q) =>
      q
        .eq("entityId", entityId)
        .eq("status", "pending")
        .gte("amountMinor", amountMinor - PAYOUT_MATCH_AMOUNT_TOLERANCE_MINOR)
        .lte("amountMinor", amountMinor + PAYOUT_MATCH_AMOUNT_TOLERANCE_MINOR),
    )
    .take(20);
}

/**
 * Reconcile-only posting for a matched deposit<->payout pair. Posts
 * Dr Bank / Cr Payouts In-Transit through the single ledger path, links the
 * payout to its bank transaction, marks it reconciled, and records the
 * transaction as a `match` (never income). Idempotent: if the payout is already
 * reconciled / already linked to this transaction it returns without
 * re-posting, so re-running the matcher or re-delivering a webhook cannot
 * double-post.
 */
export async function reconcilePayoutWithDeposit(
  ctx: MutationCtx,
  args: {
    entity: Doc<"entities">;
    payout: Doc<"stripePayouts">;
    transaction: Doc<"transactions">;
    bankAccount: Doc<"bankAccounts">;
    actorUserId: Id<"users">;
    auditAction?: string;
    // E1-T3: did the bank descriptor read like a Stripe payout? The descriptor
    // is a confidence BOOSTER, not a match gate — an exact-net + in-window
    // deposit reconciles either way, but a confirming descriptor records full
    // confidence while an amount-only match records a slightly lower one.
    descriptorBoosted?: boolean;
  },
): Promise<{ status: "reconciled" | "already_reconciled"; entryId: Id<"journalEntries"> | null }> {
  // Idempotency guard: a payout that is already reconciled (or already linked to
  // a bank txn) must not post a second bank debit.
  if (args.payout.status === "reconciled" || args.payout.bankTxnId) {
    return { status: "already_reconciled", entryId: null };
  }

  const inTransitAccountId =
    args.payout.inTransitAccountId ??
    (await findAccountByNumber(ctx, args.entity._id, "1160"))?._id ??
    null;
  if (!inTransitAccountId) {
    throw new Error("Payouts In-Transit account (1160) is missing for this entity.");
  }

  const depositMinor = Math.abs(args.transaction.amountMinor);
  const currency = args.payout.currency ?? args.transaction.currency ?? args.entity.currency;
  const now = Date.now();

  const posted = await postLedgerEntryCore(ctx, {
    entity: args.entity,
    userId: args.actorUserId,
    date: args.transaction.date,
    memo: `Stripe payout ${args.payout.payoutId} settled to bank`,
    source: "stripe",
    sourceId: `${args.payout.payoutId}:deposit`,
    auditAction: args.auditAction,
    lines: [
      {
        accountId: args.bankAccount.ledgerAccountId,
        debitMinor: depositMinor,
        creditMinor: 0,
        currency,
      },
      {
        accountId: inTransitAccountId,
        debitMinor: 0,
        creditMinor: depositMinor,
        currency,
      },
    ],
  });

  await ctx.db.patch(args.payout._id, {
    bankTxnId: args.transaction._id,
    status: "reconciled",
    entryIds: [...args.payout.entryIds, posted.entryId],
    updatedAt: now,
  });

  // The matched Plaid txn is a transfer/match, NOT income. Record it as posted
  // and reviewed so the pipeline never categorizes it as Sales. The descriptor
  // booster nudges the recorded confidence: a confirming "stripe"/"payout"
  // descriptor reads as 0.99, an exact-net amount-only match as 0.95.
  const descriptorBoosted = args.descriptorBoosted ?? true;
  await ctx.db.patch(args.transaction._id, {
    status: "posted",
    review: "auto",
    entryId: posted.entryId,
    transferPairId: `${args.payout.payoutId}:payout`,
    decidedBy: "match",
    confidence: descriptorBoosted ? 0.99 : 0.95,
    reasoning: `Matched to Stripe payout ${args.payout.payoutId} on exact net amount within the arrival window${descriptorBoosted ? " (descriptor confirmed Stripe)" : " (amount-only match)"}; reconcile-only transfer from Payouts In-Transit, not income.`,
    categoryAccountId: undefined,
    updatedAt: now,
  });

  return { status: "reconciled", entryId: posted.entryId };
}

/**
 * Stage-1.5 matcher invoked by the Plaid sync BEFORE a freshly-routed bank
 * transaction reaches the categorization pipeline. Given a just-created (or
 * existing) bank inflow, find an open Stripe payout it settles and reconcile it.
 *
 * Returns `matched: false` when nothing pairs — the caller then lets the normal
 * pipeline run. Safe to call repeatedly (idempotent via reconcilePayoutWithDeposit
 * and the bankTxnId link).
 */
export async function tryMatchDepositToPayout(
  ctx: MutationCtx,
  args: {
    entity: Doc<"entities">;
    transaction: Doc<"transactions">;
    bankAccount: Doc<"bankAccounts">;
    actorUserId: Id<"users">;
    auditAction?: string;
  },
): Promise<{ matched: boolean; payoutId?: string; entryId?: Id<"journalEntries"> | null }> {
  // Only inflows can be a payout settlement, and a txn that already has a ledger
  // entry has been handled — skip it (idempotency for re-sync).
  if (args.transaction.amountMinor <= 0) return { matched: false };
  if (args.transaction.entryId) return { matched: false };

  const candidates = await loadMatchingStripePayoutCandidates(ctx, args.entity._id, args.transaction.amountMinor);
  if (candidates.length === 0) return { matched: false };

  const descriptor = `${args.transaction.merchant} ${args.transaction.rawDescription}`;
  const match = findMatchingStripePayout(
    {
      amountMinor: args.transaction.amountMinor,
      date: args.transaction.date,
      descriptor,
      currency: args.transaction.currency,
    },
    candidates,
  );
  if (!match) return { matched: false };

  const payout = await ctx.db.get(match._id);
  if (!payout) return { matched: false };

  const result = await reconcilePayoutWithDeposit(ctx, {
    entity: args.entity,
    payout,
    transaction: args.transaction,
    bankAccount: args.bankAccount,
    actorUserId: args.actorUserId,
    auditAction: args.auditAction,
    descriptorBoosted: looksLikeStripePayout(descriptor),
  });
  return { matched: true, payoutId: payout.payoutId, entryId: result.entryId };
}

/**
 * Plaid-sync entry point (E7.1): given a mapped Plaid inflow that has NOT yet
 * been routed, decide whether it settles an open Stripe payout. If it does,
 * create the bank transaction (or reuse the existing one on re-sync) and post
 * the reconcile-only transfer, returning `matched: true` so the caller skips
 * the income pipeline. If nothing matches, return `matched: false` and the
 * caller routes the transaction normally.
 *
 * This is the single guard that prevents the Plaid feed from recognizing a
 * Stripe payout deposit as income while the Stripe side already recognized the
 * revenue.
 */
export async function matchPlaidInflowToPayout(
  ctx: MutationCtx,
  args: {
    entity: Doc<"entities">;
    bankAccount: Doc<"bankAccounts">;
    actorUserId: Id<"users">;
    inflow: {
      date: string;
      amountMinor: number;
      currency: string;
      merchant: string;
      rawDescription: string;
      status: "pending" | "posted";
      externalId: string;
    };
    auditAction?: string;
  },
): Promise<{ matched: boolean; transactionId?: Id<"transactions">; payoutId?: string }> {
  // Pending Plaid rows are provisional; only settle a payout against a posted
  // arrival so the cash event is real.
  if (args.inflow.status !== "posted") return { matched: false };
  if (args.inflow.amountMinor <= 0) return { matched: false };

  const candidates = await loadMatchingStripePayoutCandidates(ctx, args.entity._id, args.inflow.amountMinor);
  if (candidates.length === 0) return { matched: false };

  const inflowDescriptor = `${args.inflow.merchant} ${args.inflow.rawDescription}`;
  const match = findMatchingStripePayout(
    {
      amountMinor: args.inflow.amountMinor,
      date: args.inflow.date,
      descriptor: inflowDescriptor,
      currency: args.inflow.currency,
    },
    candidates,
  );
  if (!match) return { matched: false };

  const payout = await ctx.db.get(match._id);
  if (!payout) return { matched: false };

  // Reuse an existing transaction with this externalId (re-sync) or create one.
  const existing = await ctx.db
    .query("transactions")
    .withIndex("by_external_id", (q) => q.eq("externalId", args.inflow.externalId))
    .first();

  let transaction: Doc<"transactions">;
  if (existing && existing.entityId === args.entity._id) {
    // Already reconciled on a prior sync — idempotent no-op.
    if (existing.entryId) {
      return { matched: true, transactionId: existing._id, payoutId: payout.payoutId };
    }
    transaction = existing;
  } else {
    const now = Date.now();
    const transactionId = await ctx.db.insert("transactions", {
      entityId: args.entity._id,
      bankAccountId: args.bankAccount._id,
      date: args.inflow.date,
      amountMinor: args.inflow.amountMinor,
      currency: args.inflow.currency,
      merchant: args.inflow.merchant,
      rawDescription: args.inflow.rawDescription,
      status: args.inflow.status,
      review: "needs_review",
      source: "bank",
      externalId: args.inflow.externalId,
      evalSet: false,
      createdAt: now,
      updatedAt: now,
    });
    transaction = (await ctx.db.get(transactionId))!;
  }

  await reconcilePayoutWithDeposit(ctx, {
    entity: args.entity,
    payout,
    transaction,
    bankAccount: args.bankAccount,
    actorUserId: args.actorUserId,
    auditAction: args.auditAction,
    descriptorBoosted: looksLikeStripePayout(inflowDescriptor),
  });
  return { matched: true, transactionId: transaction._id, payoutId: payout.payoutId };
}

export const applyProjection = mutation({
  args: {
    entityId: v.id("entities"),
    projection: stripeProjectionValidator,
  },
  handler: async (ctx, args): Promise<ApplyProjectionResult> => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new Error("OpenBooks entity not found.");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    return await applyProjectionCore(ctx, { entity, projection: args.projection, actorUserId: userId });
  },
});

/**
 * E1-T3 Inbox: list the pending Stripe payouts an unmatched bank inflow could
 * settle, so the owner can pick the right one when the auto-matcher abstained
 * (e.g. two same-net payouts in the window). Re-checks workspace authz from the
 * transaction's own entity — the client cannot pass an arbitrary entity.
 * Returns the booster signal (whether the descriptor reads as Stripe) and the
 * business-day arrival delta so the UI can rank candidates.
 */
export const listPayoutMatchCandidates = query({
  args: { transactionId: v.id("transactions") },
  handler: async (ctx, args) => {
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction) throw new Error("Transaction not found.");
    const entity = await ctx.db.get(transaction.entityId);
    if (!entity) throw new Error("OpenBooks entity not found.");
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");

    // Only an unmatched inflow can settle a payout.
    if (transaction.amountMinor <= 0 || transaction.entryId) {
      return { transactionId: transaction._id, candidates: [] as Array<unknown> };
    }

    const pending = await ctx.db
      .query("stripePayouts")
      .withIndex("by_entity_and_status", (q) =>
        q.eq("entityId", entity._id).eq("status", "pending"),
      )
      .take(200);

    const descriptor = `${transaction.merchant} ${transaction.rawDescription}`;
    const candidates = pending
      .filter((payout) => !payout.bankTxnId && payout.amountMinor > 0)
      .map((payout) => {
        const arrivalDeltaBusinessDays = businessDaysBetween(payout.arrivalDate, transaction.date);
        const exactNet = payout.amountMinor === transaction.amountMinor;
        const sameCurrency =
          (payout.currency ?? transaction.currency).toUpperCase() === transaction.currency.toUpperCase();
        return {
          payoutId: payout._id,
          stripePayoutId: payout.payoutId,
          amountMinor: payout.amountMinor,
          currency: payout.currency ?? transaction.currency,
          arrivalDate: payout.arrivalDate,
          arrivalDeltaBusinessDays: Number.isFinite(arrivalDeltaBusinessDays)
            ? arrivalDeltaBusinessDays
            : null,
          exactNet,
          sameCurrency,
          inWindow: withinPayoutArrivalWindow(payout.arrivalDate, transaction.date),
          descriptorBoosted: looksLikeStripePayout(descriptor),
        };
      })
      .sort((a, b) => {
        // Exact net + in-window first, then closest arrival.
        const score = (c: typeof a) => (c.exactNet ? 0 : 1) + (c.inWindow ? 0 : 2);
        const byScore = score(a) - score(b);
        if (byScore !== 0) return byScore;
        return Math.abs(a.arrivalDeltaBusinessDays ?? 999) - Math.abs(b.arrivalDeltaBusinessDays ?? 999);
      });

    return { transactionId: transaction._id, candidates };
  },
});

/**
 * E1-T3 Inbox: manually pair an unmatched bank inflow to a pending Stripe payout
 * (the fallback when the auto-matcher abstained). Re-checks workspace/entity
 * authz, validates the deposit is an unmatched inflow and the payout is
 * pending/unreconciled and same-entity, then routes through the SAME
 * reconcilePayoutWithDeposit posting path so it cannot double-post. Idempotent
 * on re-call via the payout's reconciled/bankTxnId guard.
 */
export const matchDepositToPayout = mutation({
  args: {
    transactionId: v.id("transactions"),
    payoutId: v.id("stripePayouts"),
  },
  handler: async (ctx, args) => {
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction) throw new Error("Transaction not found.");
    const entity = await ctx.db.get(transaction.entityId);
    if (!entity) throw new Error("OpenBooks entity not found.");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "member");

    if (transaction.amountMinor <= 0) {
      throw new Error("Only a bank inflow can be matched to a Stripe payout.");
    }
    if (transaction.entryId) {
      // Already posted — idempotent no-op rather than a double-post.
      return { status: "already_reconciled" as const, entryId: null };
    }

    const payout = await ctx.db.get(args.payoutId);
    if (!payout || payout.entityId !== entity._id) {
      throw new Error("Stripe payout does not belong to this business.");
    }
    if (payout.status === "reconciled" || payout.bankTxnId) {
      return { status: "already_reconciled" as const, entryId: null };
    }

    const bankAccount = transaction.bankAccountId
      ? await ctx.db.get(transaction.bankAccountId)
      : null;
    if (!bankAccount || bankAccount.entityId !== entity._id) {
      throw new Error("The deposit's bank account is missing for this business.");
    }

    const descriptor = `${transaction.merchant} ${transaction.rawDescription}`;
    const result = await reconcilePayoutWithDeposit(ctx, {
      entity,
      payout,
      transaction,
      bankAccount,
      actorUserId: userId,
      auditAction: "stripe.payout.matched_to_deposit.manual",
      descriptorBoosted: looksLikeStripePayout(descriptor),
    });
    return result;
  },
});

/**
 * E1-T4 standing tripwire: report the health of the Stripe clearing/in-transit
 * chain for an entity. The settlement model is correct only when, with no
 * pending payouts, Stripe Clearing (1150) and Payouts In-Transit (1160) both net
 * to ~0 — every batch has drained to real cash. `isHealthy` is false when:
 *   - clearing (1150) is materially negative (a half-posted / over-drained chain), OR
 *   - in-transit (1160) is materially positive while NO payout is still pending
 *     (i.e. cash that should have arrived never matched a deposit — the $458k
 *     phantom-asset symptom this epic drains).
 * A positive 1160 WITH pending payouts is expected (those deposits haven't
 * landed yet) and stays healthy.
 */
export const stripeClearingHealth = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new Error("OpenBooks entity not found.");
    await requireWorkspaceRole(ctx, entity.workspaceId, "member");

    const [clearingAccount, inTransitAccount] = await Promise.all([
      findAccountByNumber(ctx, entity._id, "1150"),
      findAccountByNumber(ctx, entity._id, "1160"),
    ]);
    const clearingBalanceMinor = clearingAccount
      ? await accountDebitBalanceMinor(ctx, clearingAccount._id)
      : 0;
    const inTransitBalanceMinor = inTransitAccount
      ? await accountDebitBalanceMinor(ctx, inTransitAccount._id)
      : 0;

    const pendingPayouts = (
      await ctx.db
        .query("stripePayouts")
        .withIndex("by_entity_and_status", (q) =>
          q.eq("entityId", entity._id).eq("status", "pending"),
        )
        .collect()
    ).length;

    const clearingNegative = clearingBalanceMinor < -CLEARING_DRIFT_EPSILON_MINOR;
    const inTransitStranded =
      inTransitBalanceMinor > CLEARING_DRIFT_EPSILON_MINOR && pendingPayouts === 0;
    const isHealthy = !clearingNegative && !inTransitStranded;

    return {
      entityId: entity._id,
      clearingBalanceMinor,
      inTransitBalanceMinor,
      pendingPayouts,
      isHealthy,
      reasons: [
        ...(clearingNegative ? ["Stripe Clearing (1150) is negative — a half-posted chain."] : []),
        ...(inTransitStranded
          ? ["Payouts In-Transit (1160) holds cash with no pending payout — a deposit was never matched."]
          : []),
      ],
    };
  },
});

/**
 * E1-T4 one-time drain (also re-runnable as an idempotent corrective): for each
 * RECONCILED payout (bankTxnId set) whose in-transit (1160) leg was never
 * drained — the legacy direct-to-bank deposit posting left 1160 inflated — post
 * the EXACT reversal of that payout's in-transit entry through the single ledger
 * path. This honors immutability (reverse + the cash already arrived via the
 * legacy bank debit, so the net is a clean 1160→0) and never edits a balance
 * directly. Payouts still pending are NOT auto-zeroed here — they go through the
 * E1-T3 Inbox Match action so the deposit is the single cash event.
 *
 * Admin-only. Idempotent: a payout whose 1160 residual is already ~0 is skipped,
 * so re-running drains nothing new.
 */
export const drainResidualInTransit = mutation({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new Error("OpenBooks entity not found.");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");

    const inTransitAccount = await findAccountByNumber(ctx, entity._id, "1160");
    if (!inTransitAccount) {
      return { payoutsDrained: 0, reversalsPosted: 0, residualDrainedMinor: 0, pendingSkipped: 0 };
    }

    const payouts = await ctx.db
      .query("stripePayouts")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .collect();

    let payoutsDrained = 0;
    let reversalsPosted = 0;
    let residualDrainedMinor = 0;
    let pendingSkipped = 0;

    for (const payout of payouts) {
      // Only reconciled payouts can be safely drained here; a pending one must
      // settle via the deposit-match action so cash is recognized exactly once.
      if (payout.status === "pending" || !payout.bankTxnId) {
        if (payout.status === "pending") pendingSkipped += 1;
        continue;
      }

      // Compute THIS payout's residual on 1160 across all of its entries
      // (debits − credits to 1160). In the correct chain the in-transit debit
      // (payout) is cancelled by the deposit-match credit (Dr Bank / Cr 1160) =>
      // residual ~0, and we do nothing. A legacy direct-to-bank deposit left the
      // in-transit debit uncancelled => residual > 0, which we drain by exactly
      // reversing the in-transit entry. The cash already arrived via the legacy
      // bank debit, so reversing only removes the phantom 1160 asset.
      const entryLineSets = new Map<Id<"journalEntries">, Doc<"journalLines">[]>();
      let residualMinor = 0;
      for (const entryId of payout.entryIds) {
        const lines = await ctx.db
          .query("journalLines")
          .withIndex("by_entry", (q) => q.eq("entryId", entryId))
          .collect();
        entryLineSets.set(entryId, lines);
        for (const line of lines) {
          if (line.accountId === inTransitAccount._id) {
            residualMinor += line.debitMinor - line.creditMinor;
          }
        }
      }
      if (residualMinor <= CLEARING_DRIFT_EPSILON_MINOR) continue;

      // Reverse the in-transit DEBIT entry(ies) for this payout to drain the
      // residual. Skip any entry already reversed (idempotency on re-run).
      let drained = false;
      for (const [entryId, lines] of entryLineSets) {
        const inTransitDebit = lines.find(
          (line) => line.accountId === inTransitAccount._id && line.debitMinor > 0,
        );
        if (!inTransitDebit) continue;

        const alreadyReversed = await ctx.db
          .query("journalEntries")
          .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
          .filter((q) => q.eq(q.field("reversesEntryId"), entryId))
          .first();
        if (alreadyReversed) continue;

        const reversalLines = lines.map((line) => ({
          accountId: line.accountId,
          debitMinor: line.creditMinor,
          creditMinor: line.debitMinor,
          currency: line.currency,
        }));
        const posted = await postLedgerEntryCore(ctx, {
          entity,
          userId,
          date: payout.arrivalDate,
          memo: `Drain residual in-transit for reconciled Stripe payout ${payout.payoutId}`,
          source: "stripe",
          sourceId: `${payout.payoutId}:in_transit_drain_reversal`,
          reversesEntryId: entryId,
          auditAction: "system.stripe.in_transit.residual_drained",
          lines: reversalLines,
        });
        await ctx.db.patch(payout._id, {
          entryIds: [...payout.entryIds, posted.entryId],
          updatedAt: Date.now(),
        });
        reversalsPosted += 1;
        residualDrainedMinor += inTransitDebit.debitMinor;
        drained = true;
      }
      if (drained) payoutsDrained += 1;
    }

    return { payoutsDrained, reversalsPosted, residualDrainedMinor, pendingSkipped };
  },
});

export const applyProjectionInternal = internalMutation({
  args: {
    entityId: v.optional(v.id("entities")),
    projection: stripeProjectionValidator,
  },
  handler: async (ctx, args): Promise<ApplyProjectionResult> => {
    const entity = await stripeWebhookTargetEntity(ctx, args.entityId);
    if (!entity) throw new Error("No OpenBooks entity is available for Stripe webhook sync.");
    const actorUserId = await ensureSystemSyncActor(ctx, entity.workspaceId);
    return await applyProjectionCore(ctx, {
      entity,
      projection: args.projection,
      actorUserId,
      auditAction: "system.sync.stripe.ledger_entry.posted",
    });
  },
});

export const repairDuplicateStripeInvoices = mutation({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args): Promise<{
    duplicateGroups: number;
    invoicesDeleted: number;
    reversalsPosted: number;
  }> => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new Error("OpenBooks entity not found.");
    const { userId } = await requireWorkspaceRole(ctx, entity.workspaceId, "admin");
    const invoices = await ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", args.entityId)).collect();
    const groups = new Map<string, Doc<"invoices">[]>();
    for (const invoice of invoices) {
      if (invoice.source !== "stripe") continue;
      const key = invoice.stripeInvoiceId || `number:${invoice.number}`;
      const existing = groups.get(key) ?? [];
      existing.push(invoice);
      groups.set(key, existing);
    }
    const existingEntries = await ctx.db.query("journalEntries").withIndex("by_entity", (q) => q.eq("entityId", args.entityId)).collect();
    const reversedEntryIds = new Set(existingEntries.map((entry) => entry.reversesEntryId).filter(Boolean).map(String));
    let duplicateGroups = 0;
    let invoicesDeleted = 0;
    let reversalsPosted = 0;

    for (const group of groups.values()) {
      if (group.length < 2) continue;
      duplicateGroups += 1;
      const sorted = group.slice().sort((a, b) => a.createdAt - b.createdAt);
      const duplicates = sorted.slice(1);
      for (const invoice of duplicates) {
        for (const entryId of invoice.entryIds) {
          if (reversedEntryIds.has(String(entryId))) continue;
          const entry = await ctx.db.get(entryId);
          if (!entry || entry.entityId !== args.entityId) continue;
          const lines = await ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", entryId)).collect();
          if (lines.length < 2) continue;
          await postLedgerEntryCore(ctx, {
            entity,
            userId,
            date: entry.date,
            memo: `Reverse duplicate Stripe invoice ${invoice.number}`,
            source: "stripe",
            sourceId: `${invoice.stripeInvoiceId ?? invoice.number}:duplicate-reversal:${entryId}`,
            reversesEntryId: entryId,
            auditAction: "system.sync.stripe.duplicate_invoice.reversed",
            lines: lines.map((line) => ({
              accountId: line.accountId,
              debitMinor: line.creditMinor,
              creditMinor: line.debitMinor,
              currency: line.currency,
            })),
          });
          reversedEntryIds.add(String(entryId));
          reversalsPosted += 1;
        }
        await ctx.db.delete(invoice._id);
        invoicesDeleted += 1;
      }
    }

    return { duplicateGroups, invoicesDeleted, reversalsPosted };
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

async function stripeListAll<T extends { id: string }>(
  key: string,
  path: string,
  params: Array<[string, string | number | boolean]> = [],
  maxPages = 100,
) {
  const rows: T[] = [];
  let startingAfter: string | undefined;
  let hasMore = true;
  let pages = 0;
  while (hasMore) {
    if (pages >= maxPages) {
      throw new Error(`Stripe pagination limit exceeded for ${path}.`);
    }
    const query = new URLSearchParams();
    query.set("limit", "100");
    for (const [keyName, value] of params) query.append(keyName, String(value));
    if (startingAfter) query.set("starting_after", startingAfter);
    const page = await stripeRequest<StripeList<T>>(key, `${path}?${query.toString()}`);
    rows.push(...(page.data ?? []));
    hasMore = Boolean(page.has_more);
    startingAfter = page.data?.[page.data.length - 1]?.id;
    if (hasMore && !startingAfter) {
      throw new Error(`Stripe pagination returned has_more without a cursor for ${path}.`);
    }
    pages += 1;
  }
  return rows;
}

function isUnsupportedManualPayoutBalanceTransactionLookup(error: unknown) {
  return error instanceof Error && error.message.includes("Balance transaction history can only be filtered on automatic transfers");
}

async function stripeListPayoutBalanceTransactions(key: string, payout: StripeApiPayout) {
  if (payout.method === "manual" || payout.reconciliation_status === "not_applicable") {
    return [] satisfies StripeApiBalanceTransaction[];
  }
  try {
    return await stripeListAll<StripeApiBalanceTransaction>(
      key,
      "/balance_transactions",
      [["payout", payout.id]],
    );
  } catch (error) {
    if (isUnsupportedManualPayoutBalanceTransactionLookup(error)) {
      return [] satisfies StripeApiBalanceTransaction[];
    }
    throw error;
  }
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

function balanceTransactionFromCharge(charge: StripeApiCharge) {
  const balanceTransaction = charge.balance_transaction;
  if (!balanceTransaction || typeof balanceTransaction === "string") return null;
  return balanceTransaction;
}

function stripeProjectionModeForKey(key: string): "stripe_test" | "stripe_live" {
  return key.includes("_live_") ? "stripe_live" : "stripe_test";
}

// Exported for E1-T1 unit tests (fixture-gating). Pure transform from Stripe API
// list shapes to an OpenBooks projection.
export function projectionFromStripeLists(args: {
  reason: string;
  mode?: "stripe_test" | "stripe_live";
  customers: StripeApiCustomer[];
  paymentIntents: StripeApiPaymentIntent[];
  invoices: StripeApiInvoice[];
  payouts: Array<{ payout: StripeApiPayout; balanceTransactions: StripeApiBalanceTransaction[] }>;
  includeFixturePayoutFallback?: boolean;
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
    const amountMinor = payout.amount ?? 0;
    const grossMinor = lines.length ? lines.reduce((sum, line) => sum + line.grossMinor, 0) : amountMinor;
    const feesMinor = lines.length ? lines.reduce((sum, line) => sum + line.feeMinor, 0) : 0;
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
	    mode: args.mode ?? "stripe_test",
	    reason: args.reason,
	    customers: customerRows,
	    income,
	    invoices,
	    payouts: payouts.length > 0 ? payouts : args.includeFixturePayoutFallback ? buildFixtureProjection().payouts : [],
	  };
	}

// E1-T1 / RC4: only DEMO entities (isDemo:true) may have synthetic fixture
// payouts substituted when the live /payouts list is empty. For a REAL book this
// MUST stay false so a zero-payout sync posts ZERO ledger entries and creates
// ZERO payout_mismatch inbox cards — fixtures were the confirmed source of the
// phantom 1160/1150 entries. Callers derive it from `entity.isDemo`.
async function fetchStripeProjection(
  key: string,
  reason: string,
  options?: { allowFixtures?: boolean },
): Promise<StripeProjection> {
  const [customers, paymentIntents, invoices, payouts] = await Promise.all([
    stripeListAll<StripeApiCustomer>(key, "/customers"),
    stripeListAll<StripeApiPaymentIntent>(key, "/payment_intents", [
      ["expand[]", "data.customer"],
      ["expand[]", "data.latest_charge.balance_transaction"],
    ]),
    stripeListAll<StripeApiInvoice>(key, "/invoices", [["expand[]", "data.customer"]]),
    stripeListAll<StripeApiPayout>(key, "/payouts"),
  ]);
  const payoutRows = [];
  for (const payout of payouts) {
    const balanceTransactions = await stripeListPayoutBalanceTransactions(key, payout);
    payoutRows.push({ payout, balanceTransactions });
  }

	  return projectionFromStripeLists({
	    reason,
      mode: stripeProjectionModeForKey(key),
	    customers,
	    paymentIntents,
	    invoices,
	    payouts: payoutRows,
	    includeFixturePayoutFallback: options?.allowFixtures ?? false,
	  });
	}

function customerProjectionFromObject(customer: string | StripeApiCustomer | null | undefined) {
  if (!customer || typeof customer === "string") return [];
  return [
    {
      stripeCustomerId: customer.id,
      name: customer.name ?? customer.email ?? customer.id,
      email: customer.email ?? undefined,
    },
  ] satisfies StripeCustomerProjection[];
}

function apiCustomerFromObject(customer: string | StripeApiCustomer | null | undefined) {
  if (!customer || typeof customer === "string") return [];
  return [customer];
}

function projectionFromStripeCharge(args: {
  reason: string;
  mode?: "stripe_test" | "stripe_live";
  charge: StripeApiCharge;
}): StripeProjection {
  const stripeCustomerId = customerId(args.charge.customer);
  const balanceTransaction = balanceTransactionFromCharge(args.charge);
  const amountMinor = args.charge.amount_captured ?? args.charge.amount ?? 0;
  const paymentIntentId = args.charge.payment_intent ?? `charge:${args.charge.id}`;
  const income =
    amountMinor > 0 && args.charge.paid !== false
      ? [
          {
            stripePaymentIntentId: paymentIntentId,
            stripeChargeId: args.charge.id,
            customerStripeId: stripeCustomerId,
            customerName: customerName(args.charge.customer, "Stripe customer"),
            description: args.charge.description ?? "Stripe charge",
            date: isoDateFromUnix(args.charge.created),
            amountMinor,
            feeMinor: balanceTransaction?.fee ?? 0,
            currency: normalizeCurrency(args.charge.currency),
            feeSource: balanceTransaction?.fee ? ("stripe_balance_transaction" as const) : ("unavailable" as const),
          },
        ]
      : [];

  return {
    mode: args.mode ?? "stripe_test",
    reason: args.reason,
    customers: customerProjectionFromObject(args.charge.customer),
    income,
    invoices: [],
    payouts: [],
  };
}

async function fetchStripeProjectionForWebhook(
  key: string,
  args: {
    type: string;
    objectId?: string;
    relatedPaymentIntentId?: string;
  },
): Promise<StripeProjection | null> {
  const reason = `Stripe webhook ${args.type} triggered a targeted sync for ${args.objectId ?? args.relatedPaymentIntentId ?? "the related object"}.`;
  if (args.type.startsWith("invoice.")) {
    if (!args.objectId) return null;
    const invoice = await stripeRequest<StripeApiInvoice>(
      key,
      `/invoices/${encodeURIComponent(args.objectId)}?expand[]=customer`,
    );
	    return projectionFromStripeLists({
	      reason,
        mode: stripeProjectionModeForKey(key),
	      customers: apiCustomerFromObject(invoice.customer),
	      paymentIntents: [],
	      invoices: [invoice],
	      payouts: [],
    });
  }

  if (args.type.startsWith("payout.")) {
    if (!args.objectId) return null;
    const payout = await stripeRequest<StripeApiPayout>(key, `/payouts/${encodeURIComponent(args.objectId)}`);
    const balanceTransactions = await stripeListPayoutBalanceTransactions(key, payout);
    return projectionFromStripeLists({
      reason,
      mode: stripeProjectionModeForKey(key),
      customers: [],
      paymentIntents: [],
      invoices: [],
      payouts: [{ payout, balanceTransactions }],
    });
  }

  if (args.type.startsWith("charge.")) {
    if (!args.objectId) return null;
    const charge = await stripeRequest<StripeApiCharge>(
      key,
      `/charges/${encodeURIComponent(args.objectId)}?expand[]=customer&expand[]=balance_transaction`,
    );
    return projectionFromStripeCharge({ reason, mode: stripeProjectionModeForKey(key), charge });
  }

	  if (args.type.startsWith("payment_intent.")) {
	    const paymentIntentId = args.relatedPaymentIntentId ?? args.objectId;
	    if (!paymentIntentId) return null;
	    const paymentIntent = await stripeRequest<StripeApiPaymentIntent>(
	      key,
	      `/payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=customer&expand[]=latest_charge.balance_transaction`,
	    );
	    return projectionFromStripeLists({
	      reason,
        mode: stripeProjectionModeForKey(key),
	      customers: apiCustomerFromObject(paymentIntent.customer),
	      paymentIntents: [paymentIntent],
      invoices: [],
      payouts: [],
    });
  }

  return null;
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
    connectionId: v.optional(v.id("financialConnections")),
  },
  handler: async (ctx, args): Promise<ApplyProjectionResult> => {
    const stateResult: StripeState = await ctx.runQuery(authorizeRef, { entityId: args.entityId });
    if (!stateResult.entity) {
      throw new Error("Create the Live Sandbox entity before syncing Stripe.");
    }
    // E1-T1 / RC4: fixture payouts may ONLY be substituted into a DEMO entity's
    // book. For a real entity, a zero-payout sync must post nothing.
    const allowFixtures = stateResult.entity.isDemo;
    const credential = await ctx.runAction(internal.connections.resolveStripeCredentialForEntity, {
      entityId: args.entityId,
      ...(args.connectionId ? { connectionId: args.connectionId } : {}),
    }) as ResolvedStripeCredential | null;
    if (credential) {
      if (credential.mode === "live" && process.env.OPENBOOKS_REAL_TEST_LIVE_CONNECTORS !== "1") {
        throw new Error("Live Stripe sync is blocked until OPENBOOKS_REAL_TEST_LIVE_CONNECTORS=1 is set.");
      }
      const projection = await fetchStripeProjection(
        credential.restrictedKey,
        `Stripe ${credential.mode} sync completed for ${credential.label}.`,
        { allowFixtures },
      );
      return await ctx.runMutation(applyProjectionRef, {
        entityId: args.entityId,
        projection,
      });
    }
    const key = stripeKeyState(process.env.STRIPE_SECRET_KEY);
    if (!key.safeToCallStripe) {
      // No usable key. A DEMO entity still gets the fixture demo so the UI has
      // shape; a REAL entity must NOT have synthetic payouts injected — return an
      // empty, honest projection that explains the gap (E1-T1 / RC4).
      const fallback = allowFixtures
        ? { ...buildFixtureProjection(), mode: "fixture" as const, reason: key.reason }
        : {
            mode: "fixture" as const,
            reason: `${key.reason} No Stripe data was synced and no fixtures are injected into a real book.`,
            customers: [],
            income: [],
            invoices: [],
            payouts: [],
          };
      return await ctx.runMutation(applyProjectionRef, {
        entityId: args.entityId,
        projection: fallback,
      });
    }
    const projection = await fetchStripeProjection(
      process.env.STRIPE_SECRET_KEY!.trim(),
      "Stripe test-mode sync completed via PaymentIntents, Customers, Invoices, and Payout balance transactions.",
      { allowFixtures },
    );
    return await ctx.runMutation(applyProjectionRef, {
      entityId: args.entityId,
      projection,
    });
  },
});

export const syncFromWebhookEvent = internalAction({
  args: {
    stripeEventId: v.string(),
    type: v.string(),
    objectId: v.optional(v.string()),
    relatedPaymentIntentId: v.optional(v.string()),
    entityId: v.optional(v.id("entities")),
    connectionId: v.optional(v.id("financialConnections")),
  },
  handler: async (ctx, args): Promise<{ status: "synced" | "ignored" | "skipped" | "error"; reason: string; result?: ApplyProjectionResult }> => {
    const supported =
      args.type.startsWith("invoice.") ||
      args.type.startsWith("charge.") ||
      args.type.startsWith("payout.") ||
      args.type.startsWith("payment_intent.");
    if (!supported) {
      return { status: "ignored", reason: `Stripe event type ${args.type} does not change OpenBooks ledger state.` };
    }

    try {
      const credential = args.entityId
        ? await ctx.runAction(internal.connections.resolveStripeCredentialForEntity, {
            entityId: args.entityId,
            ...(args.connectionId ? { connectionId: args.connectionId } : {}),
          }) as ResolvedStripeCredential | null
        : null;
      if (credential?.mode === "live" && process.env.OPENBOOKS_REAL_TEST_LIVE_CONNECTORS !== "1") {
        return { status: "skipped", reason: "Live Stripe webhook sync is blocked until OPENBOOKS_REAL_TEST_LIVE_CONNECTORS=1 is set." };
      }
      const key = credential
        ? { safeToCallStripe: true, reason: "Saved Stripe credential matched webhook.", value: credential.restrictedKey }
        : { ...stripeKeyState(process.env.STRIPE_SECRET_KEY), value: process.env.STRIPE_SECRET_KEY?.trim() };
      if (!key.safeToCallStripe || !key.value) {
        return { status: "skipped", reason: key.reason };
      }
      const projection = await fetchStripeProjectionForWebhook(key.value, args);
      if (!projection) {
        return { status: "skipped", reason: `Stripe event ${args.stripeEventId} did not include an object id OpenBooks can sync.` };
      }
      const result = await ctx.runMutation(applyProjectionInternalRef, {
        ...(args.entityId ? { entityId: args.entityId } : {}),
        projection,
      });
      return { status: "synced", reason: projection.reason, result };
    } catch (error) {
      return {
        status: "error",
        reason: error instanceof Error ? error.message : `Stripe event ${args.stripeEventId} could not be synced.`,
      };
    }
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
      // E1-T1 / RC4: without a usable key only a demo entity gets the fixture
      // demo data; a real book is never seeded with synthetic transactions.
      const projection = stateResult.entity.isDemo
        ? { ...buildFixtureProjection(), reason: key.reason }
        : {
            mode: "fixture" as const,
            reason: `${key.reason} No fixtures are injected into a real book.`,
            customers: [],
            income: [],
            invoices: [],
            payouts: [],
          };
      return await ctx.runMutation(applyProjectionRef, {
        entityId: args.entityId,
        projection,
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

    // E1-T1 / RC4: seedTestAccount is a demo-seed path. Fixture payouts may be
    // substituted only for a demo entity; a real entity seeded here still posts
    // nothing for an empty /payouts list.
    const projection = await fetchStripeProjection(
      secret,
      "Stripe test account seeded and synced. Test payouts may still use fixtures if none are available.",
      { allowFixtures: stateResult.entity.isDemo },
    );
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
      assertNonNegativeMinorUnit(item.amountMinor, `Line ${index + 1} amount`);
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
