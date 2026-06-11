import { ConvexError, v } from "convex/values";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, query } from "./_generated/server";
import { requireAnyWorkspaceRole } from "./authz";

const DEMO_SEED = "openbooks-demo-v1-2026-06-11";
const months = [
  "2025-07",
  "2025-08",
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
];

function rng(seedText: string) {
  let state = 2166136261;
  for (const char of seedText) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state = Math.imul(state + 0x6d2b79f5, 1664525) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
}

function cents(value: number) {
  return Math.round(value * 100);
}

function day(month: string, value: number) {
  return `${month}-${String(value).padStart(2, "0")}`;
}

function pick<T>(next: () => number, values: readonly T[]) {
  return values[Math.floor(next() * values.length) % values.length];
}

function rangeAmount(next: () => number, min: number, max: number) {
  return cents(min + Math.floor(next() * (max - min + 1)));
}

type RouteResult = {
  status: "duplicate" | "posted" | "needs_review";
  transactionId: Id<"transactions">;
  entryId: Id<"journalEntries"> | null;
  stage: "transfer" | "match" | "rule" | "needs_review";
};

type DemoSetup = {
  bankAccounts: {
    operating: Id<"bankAccounts">;
    savings: Id<"bankAccounts">;
    creditCard: Id<"bankAccounts">;
    stripeClearing: Id<"bankAccounts">;
  };
  contacts: Id<"contacts">[];
  employees: Array<{ name: string; baseSalaryMinor: number }>;
  accounts: Record<
    | "operating"
    | "savings"
    | "ar"
    | "stripeClearing"
    | "creditCard"
    | "ap"
    | "payrollPayable"
    | "equity"
    | "sales"
    | "services"
    | "payrollExpense"
    | "rent"
    | "software"
    | "cloud"
    | "marketing"
    | "professional"
    | "fees"
    | "meals"
    | "travel"
    | "office"
    | "utilities"
    | "bankFees",
    Id<"ledgerAccounts">
  >;
};

type SeedVerificationSnapshot = {
  trialBalanceDifferenceMinor: number;
  transactionCount: number;
  postedTransactionCount: number;
  evalCount: number;
  openInboxCount: number;
  may2026: {
    incomeMinor: number;
    expenseMinor: number;
    netIncomeMinor: number;
    assetMinor: number;
    liabilityMinor: number;
    equityMinor: number;
    currentEarningsMinor: number;
    balanceSheetDifferenceMinor: number;
  };
};

type SeedResult = {
  seed: string;
  entityId: Id<"entities">;
  transactionCount: number;
  postedCount: number;
  inboxCount: number;
  evalCount: number;
  trialBalanceDifferenceMinor: number;
  may2026: SeedVerificationSnapshot["may2026"];
  payoutEntryCount: number;
};

function isRetryableSeedResetError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /conflict|write conflict|optimistic concurrency|document.*changed|transient|retry/i.test(message);
}

async function pauseForRetry(attempt: number) {
  await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
}

export const resetAndSeed = action({
  args: {},
  handler: async (ctx): Promise<SeedResult> => {
    const viewer = await ctx.runQuery(api.session.viewer, {});
    if (!viewer.workspace?.id) {
      throw new ConvexError("OpenBooks requires a workspace before seeding demo data.");
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await ctx.runMutation(internal.seedDemo.resetDemoEntity, {
          workspaceId: viewer.workspace.id,
        });
        break;
      } catch (error) {
        if (attempt === 3 || !isRetryableSeedResetError(error)) {
          throw new ConvexError("Demo reset could not finish cleanly. Try reset again after the current sync settles.");
        }
        await pauseForRetry(attempt);
      }
    }
    const entityResult: { entityId: Id<"entities">; accountsCreated: number } = await ctx.runMutation(
      api.ledger.ensureDefaultEntity,
      {},
    );
    const entityId = entityResult.entityId;
    await ctx.runMutation(api.ledger.setPeriodLock, {
      entityId,
      lockedThroughDate: null,
    });
    const setup: DemoSetup = await ctx.runMutation(internal.seedDemo.setupDemoOperationTables, {
      entityId,
    });

    const next = rng(DEMO_SEED);
    let transactionCount = 0;
    let postedCount = 0;
    let inboxCount = 0;
    let evalCount = 0;
    const matchedReceiptTransactionIds: Id<"transactions">[] = [];
    const payoutEntryIds: Id<"journalEntries">[] = [];

    async function route(args: {
      month: string;
      index: number;
      bankAccountId: Id<"bankAccounts">;
      amountMinor: number;
      merchant: string;
      rawDescription: string;
      categoryAccountId?: Id<"ledgerAccounts">;
      matchAccountId?: Id<"ledgerAccounts">;
      transferAccountId?: Id<"ledgerAccounts">;
      source?: "bank" | "stripe" | "manual";
      forceReview?: boolean;
      evalExpectedAccountId?: Id<"ledgerAccounts">;
    }) {
      const evalSet = evalCount < 120 && Boolean(args.evalExpectedAccountId);
      if (evalSet) evalCount += 1;
      const result: RouteResult = await ctx.runMutation(api.pipeline.routeTransaction, {
        entityId,
        bankAccountId: args.bankAccountId,
        date: day(args.month, (args.index % 26) + 1),
        amountMinor: args.amountMinor,
        currency: "USD",
        merchant: args.merchant,
        rawDescription: args.rawDescription,
        status: "posted",
        source: args.source ?? "bank",
        externalId: `demo:${DEMO_SEED}:${args.month}:${args.index}:${args.merchant.replaceAll(" ", "-")}`,
        categoryAccountId: args.categoryAccountId,
        matchAccountId: args.matchAccountId,
        transferAccountId: args.transferAccountId,
        forceReview: args.forceReview,
        evalExpectedAccountId: args.evalExpectedAccountId,
        evalSet,
      });
      transactionCount += 1;
      if (result.status === "posted") postedCount += 1;
      if (result.status === "needs_review") inboxCount += 1;
      return result;
    }

    const customerNames = [
      "Northstar Dental",
      "Juniper Labs",
      "Pine Street Coffee",
      "Atlas Advisory",
      "Bright Path Therapy",
      "Cedar Works",
      "Riverbend Fitness",
      "Summit Legal",
    ];
    const variableMerchants = [
      ["Amazon Business", setup.accounts.office],
      ["Delta Air Lines", setup.accounts.travel],
      ["Lyft", setup.accounts.travel],
      ["Notion", setup.accounts.software],
      ["OpenAI", setup.accounts.software],
      ["Figma", setup.accounts.software],
      ["Linear", setup.accounts.software],
      ["The Lunch Room", setup.accounts.meals],
      ["Staples", setup.accounts.office],
      ["Upwork", setup.accounts.professional],
    ] as const;

    for (let index = 0; index < 14; index += 1) {
      const month = months[index % months.length];
      const amountMinor = cents(1800 + index * 225);
      const contactId = setup.contacts[index % 8];
      const posted: { entryId: Id<"journalEntries"> } = await ctx.runMutation(api.ledger.postEntry, {
        entityId,
        date: day(month, 3),
        memo: `Invoice OB-${1000 + index}`,
        source: "invoice",
        sourceId: `OB-${1000 + index}`,
        lines: [
          { accountId: setup.accounts.ar, debitMinor: amountMinor, creditMinor: 0, currency: "USD" },
          { accountId: setup.accounts.services, debitMinor: 0, creditMinor: amountMinor, currency: "USD" },
        ],
      });
      const status = index < 9 ? "paid" : index < 12 ? "open" : "overdue";
      await ctx.runMutation(internal.seedDemo.recordInvoice, {
        entityId,
        contactId,
        number: `OB-${1000 + index}`,
        status,
        issueDate: day(month, 3),
        dueDate: day(month, status === "overdue" ? 5 : 25),
        totalMinor: amountMinor,
        amountPaidMinor: status === "paid" ? amountMinor : 0,
        entryIds: [posted.entryId],
      });
    }

    for (let index = 0; index < 10; index += 1) {
      const month = months[(index + 2) % months.length];
      const amountMinor = cents(650 + index * 85);
      const vendorId = setup.contacts[8 + (index % 10)];
      const categoryAccountId = index % 2 === 0 ? setup.accounts.professional : setup.accounts.office;
      const posted: { entryId: Id<"journalEntries"> } = await ctx.runMutation(api.ledger.postEntry, {
        entityId,
        date: day(month, 8),
        memo: `Vendor bill ${index + 1}`,
        source: "bill",
        sourceId: `bill-${index + 1}`,
        lines: [
          { accountId: categoryAccountId, debitMinor: amountMinor, creditMinor: 0, currency: "USD" },
          { accountId: setup.accounts.ap, debitMinor: 0, creditMinor: amountMinor, currency: "USD" },
        ],
      });
      await ctx.runMutation(internal.seedDemo.recordBill, {
        entityId,
        contactId: vendorId,
        status: index < 7 ? "paid" : "open",
        issueDate: day(month, 8),
        dueDate: day(month, index < 7 ? 20 : 28),
        totalMinor: amountMinor,
        entryIds: [posted.entryId],
      });
      if (index < 7) {
        await route({
          month,
          index: 710 + index,
          bankAccountId: setup.bankAccounts.operating,
          amountMinor: -amountMinor,
          merchant: `Vendor bill ${index + 1}`,
          rawDescription: `ACH vendor bill ${index + 1}`,
          matchAccountId: setup.accounts.ap,
        });
      }
    }

    for (const month of months) {
      const runTotal = setup.employees.reduce(
        (sum: number, employee: { baseSalaryMinor: number }) => sum + employee.baseSalaryMinor,
        0,
      );
      const payroll: { entryId: Id<"journalEntries"> } = await ctx.runMutation(api.ledger.postEntry, {
        entityId,
        date: day(month, 25),
        memo: `Payroll run ${month}`,
        source: "payroll",
        sourceId: `payroll-${month}`,
        lines: [
          { accountId: setup.accounts.payrollExpense, debitMinor: runTotal, creditMinor: 0, currency: "USD" },
          { accountId: setup.accounts.payrollPayable, debitMinor: 0, creditMinor: runTotal, currency: "USD" },
        ],
      });
      await ctx.runMutation(internal.seedDemo.recordPayrollRun, {
        entityId,
        period: month,
        totalBaseMinor: runTotal,
        entryIds: [payroll.entryId],
      });
      await route({
        month,
        index: 800,
        bankAccountId: setup.bankAccounts.operating,
        amountMinor: -runTotal,
        merchant: "Gusto Payroll",
        rawDescription: `Payroll settlement ${month}`,
        matchAccountId: setup.accounts.payrollPayable,
      });
    }

    for (let monthIndex = 0; monthIndex < months.length; monthIndex += 1) {
      const month = months[monthIndex];
      await route({
        month,
        index: 1,
        bankAccountId: setup.bankAccounts.operating,
        amountMinor: -280000,
        merchant: "Maple Yard Studios",
        rawDescription: "Monthly office rent",
        categoryAccountId: setup.accounts.rent,
        evalExpectedAccountId: setup.accounts.rent,
      });
      await route({
        month,
        index: 2,
        bankAccountId: setup.bankAccounts.operating,
        amountMinor: -rangeAmount(next, 180, 260),
        merchant: "TXU Energy",
        rawDescription: "Electric utility",
        categoryAccountId: setup.accounts.utilities,
        evalExpectedAccountId: setup.accounts.utilities,
      });
      await route({
        month,
        index: 3,
        bankAccountId: setup.bankAccounts.operating,
        amountMinor: -3500,
        merchant: "Mercury Bank Fee",
        rawDescription: "Wire and account fees",
        categoryAccountId: setup.accounts.bankFees,
        evalExpectedAccountId: setup.accounts.bankFees,
      });
      await route({
        month,
        index: 4,
        bankAccountId: setup.bankAccounts.operating,
        amountMinor: -50000,
        merchant: "Operating Transfer",
        rawDescription: "Transfer to savings",
        transferAccountId: setup.accounts.savings,
      });
      await route({
        month,
        index: 5,
        bankAccountId: setup.bankAccounts.operating,
        amountMinor: -240000,
        merchant: "Visa Card Payment",
        rawDescription: "Card payment",
        transferAccountId: setup.accounts.creditCard,
      });

      for (let index = 0; index < 10; index += 1) {
        const merchant = pick(next, ["AWS", "Vercel", "Supabase", "Google Workspace"]);
        await route({
          month,
          index: 10 + index,
          bankAccountId: index % 2 === 0 ? setup.bankAccounts.creditCard : setup.bankAccounts.operating,
          amountMinor: -rangeAmount(next, 35, 980),
          merchant,
          rawDescription: `${merchant} subscription`,
          categoryAccountId: merchant === "AWS" || merchant === "Vercel" || merchant === "Supabase"
            ? setup.accounts.cloud
            : setup.accounts.software,
          evalExpectedAccountId: merchant === "AWS" || merchant === "Vercel" || merchant === "Supabase"
            ? setup.accounts.cloud
            : setup.accounts.software,
        });
      }

      for (let index = 0; index < 8; index += 1) {
        await route({
          month,
          index: 30 + index,
          bankAccountId: setup.bankAccounts.creditCard,
          amountMinor: -rangeAmount(next, 120, 1100),
          merchant: pick(next, ["Google Ads", "Meta Ads", "LinkedIn Ads"]),
          rawDescription: "Growth campaign spend",
          categoryAccountId: setup.accounts.marketing,
          evalExpectedAccountId: setup.accounts.marketing,
        });
      }

      for (let index = 0; index < 20; index += 1) {
        const [merchant, accountId] = pick(next, variableMerchants);
        await route({
          month,
          index: 50 + index,
          bankAccountId: index % 3 === 0 ? setup.bankAccounts.operating : setup.bankAccounts.creditCard,
          amountMinor: -rangeAmount(next, 18, 720),
          merchant,
          rawDescription: `${merchant} ${month} receipt`,
          categoryAccountId: accountId,
          forceReview: monthIndex < 7 && index === 0,
          evalExpectedAccountId: accountId,
        });
        if (matchedReceiptTransactionIds.length < 3 && index > 0) {
          const latest = await route({
            month,
            index: 900 + index,
            bankAccountId: setup.bankAccounts.operating,
            amountMinor: -rangeAmount(next, 90, 280),
            merchant,
            rawDescription: `${merchant} receipt upload match`,
            categoryAccountId: accountId,
            evalExpectedAccountId: accountId,
          });
          if (latest.status === "posted") {
            matchedReceiptTransactionIds.push(latest.transactionId);
          }
        }
      }

      let stripeGross = 0;
      for (let index = 0; index < 15; index += 1) {
        const amountMinor = rangeAmount(next, 120, 1800);
        stripeGross += amountMinor;
        await route({
          month,
          index: 100 + index,
          bankAccountId: setup.bankAccounts.stripeClearing,
          amountMinor,
          merchant: pick(next, customerNames),
          rawDescription: "Stripe charge",
          source: "stripe",
          categoryAccountId: setup.accounts.sales,
          evalExpectedAccountId: setup.accounts.sales,
        });
      }
      const stripeFees = Math.round(stripeGross * 0.031);
      await route({
        month,
        index: 116,
        bankAccountId: setup.bankAccounts.stripeClearing,
        amountMinor: -stripeFees,
        merchant: "Stripe Fees",
        rawDescription: "Stripe processing fees",
        source: "stripe",
        categoryAccountId: setup.accounts.fees,
        evalExpectedAccountId: setup.accounts.fees,
      });
      const payout = await route({
        month,
        index: 117,
        bankAccountId: setup.bankAccounts.stripeClearing,
        amountMinor: -(stripeGross - stripeFees),
        merchant: "Stripe Payout",
        rawDescription: "Stripe payout to bank",
        source: "stripe",
        transferAccountId: setup.accounts.operating,
      });
      if (payout.entryId) payoutEntryIds.push(payout.entryId);
      await ctx.runMutation(internal.seedDemo.recordStripePayout, {
        entityId,
        payoutId: `po_demo_${month.replace("-", "")}`,
        amountMinor: stripeGross - stripeFees,
        grossMinor: stripeGross,
        feesMinor: stripeFees,
        arrivalDate: day(month, 28),
        status: "reconciled",
        bankTxnId: payout.transactionId,
        entryIds: payout.entryId ? [payout.entryId] : [],
      });

      for (let index = 0; index < 15; index += 1) {
        const paidInvoice = index === 0 && monthIndex < 9 ? monthIndex : null;
        const amountMinor = paidInvoice === null ? rangeAmount(next, 700, 3500) : cents(1800 + paidInvoice * 225);
        await route({
          month,
          index: 140 + index,
          bankAccountId: setup.bankAccounts.operating,
          amountMinor,
          merchant: paidInvoice === null ? pick(next, customerNames) : `Invoice OB-${1000 + paidInvoice}`,
          rawDescription: paidInvoice === null ? "Customer ACH deposit" : "Invoice payment",
          matchAccountId: paidInvoice === null ? undefined : setup.accounts.ar,
          categoryAccountId: paidInvoice === null ? setup.accounts.services : undefined,
          evalExpectedAccountId: paidInvoice === null ? setup.accounts.services : setup.accounts.ar,
        });
      }
    }

    await ctx.runMutation(internal.seedDemo.recordDocumentsAndInbox, {
      entityId,
      matchedReceiptTransactionIds,
    });

    const snapshot: SeedVerificationSnapshot = await ctx.runQuery(api.reports.seedVerification, { entityId });
    await ctx.runMutation(internal.seedDemo.recordSeedRun, {
      entityId,
      transactionCount,
      postedCount,
      inboxCount: snapshot.openInboxCount,
      evalCount,
      trialBalanceDifferenceMinor: snapshot.trialBalanceDifferenceMinor,
    });

    return {
      seed: DEMO_SEED,
      entityId,
      transactionCount,
      postedCount,
      inboxCount: snapshot.openInboxCount,
      evalCount,
      trialBalanceDifferenceMinor: snapshot.trialBalanceDifferenceMinor,
      may2026: snapshot.may2026,
      payoutEntryCount: payoutEntryIds.length,
    };
  },
});

export const resetDemoEntity = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const entity = await ctx.db
      .query("entities")
      .withIndex("by_workspace_and_slug", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", "acme-studio-llc"),
      )
      .unique();
    if (!entity) return { deleted: false };

    const tableNames = [
      "transactions",
      "inboxItems",
      "documents",
      "invoices",
      "bills",
      "employees",
      "payrollRuns",
      "stripePayouts",
      "stripeAccounts",
      "demoSeedRuns",
      "bankAccounts",
      "rules",
      "contacts",
      "journalLines",
      "journalEntries",
      "periodLocks",
      "ledgerAccounts",
    ] as const;
    for (const table of tableNames) {
      const rows = await ctx.db.query(table).withIndex("by_entity", (q) => q.eq("entityId", entity._id)).collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
    }
    await ctx.db.delete(entity._id);
    return { deleted: true };
  },
});

export const setupDemoOperationTables = internalMutation({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const accounts = await ctx.db
      .query("ledgerAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .collect();
    const byNumber = new Map(accounts.map((account) => [account.number, account._id]));
    const must = (number: string) => {
      const id = byNumber.get(number);
      if (!id) throw new Error(`Missing seeded account ${number}.`);
      return id;
    };

    const operating = await ctx.db.insert("bankAccounts", {
      entityId: args.entityId,
      ledgerAccountId: must("1010"),
      name: "Mercury Checking",
      mask: "1001",
      kind: "checking",
      balanceMinor: 0,
      includeInSync: true,
      createdAt: now,
      updatedAt: now,
    });
    const savings = await ctx.db.insert("bankAccounts", {
      entityId: args.entityId,
      ledgerAccountId: must("1020"),
      name: "Mercury Savings",
      mask: "2002",
      kind: "savings",
      balanceMinor: 0,
      includeInSync: true,
      createdAt: now,
      updatedAt: now,
    });
    const creditCard = await ctx.db.insert("bankAccounts", {
      entityId: args.entityId,
      ledgerAccountId: must("2000"),
      name: "Mercury Credit Card",
      mask: "4242",
      kind: "credit",
      balanceMinor: 0,
      includeInSync: true,
      createdAt: now,
      updatedAt: now,
    });
    const stripeClearing = await ctx.db.insert("bankAccounts", {
      entityId: args.entityId,
      ledgerAccountId: must("1150"),
      name: "Stripe Clearing",
      mask: "STRP",
      kind: "checking",
      balanceMinor: 0,
      includeInSync: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("stripeAccounts", {
      entityId: args.entityId,
      clearingAccountId: must("1150"),
      label: "Stripe test-mode mirror",
      createdAt: now,
      updatedAt: now,
    });

    const contactNames = [
      "Northstar Dental",
      "Juniper Labs",
      "Pine Street Coffee",
      "Atlas Advisory",
      "Bright Path Therapy",
      "Cedar Works",
      "Riverbend Fitness",
      "Summit Legal",
      "Maple Yard Studios",
      "AWS",
      "Google Ads",
      "Figma",
      "OpenAI",
      "Vercel",
      "Supabase",
      "Staples",
      "Gusto Payroll",
      "Stripe",
    ];
    const contacts: Id<"contacts">[] = [];
    for (const [index, name] of contactNames.entries()) {
      contacts.push(
        await ctx.db.insert("contacts", {
          entityId: args.entityId,
          name,
          roles: index < 8 ? ["customer"] : ["vendor"],
          email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
          aliases: [name.toUpperCase(), name.replaceAll(" ", "")],
          createdAt: now,
          updatedAt: now,
        }),
      );
    }

    const rules = [
      ["Rent", "Maple Yard", undefined, "outflow", must("5100")],
      ["Cloud infrastructure", undefined, "AWS", "outflow", must("5300")],
      ["Marketing ads", "Ads", undefined, "outflow", must("5400")],
      ["Software subscriptions", undefined, "subscription", "outflow", must("5200")],
      ["Bank fees", "Mercury Bank Fee", undefined, "outflow", must("6200")],
      ["Stripe fees", "Stripe Fees", undefined, "outflow", must("5600")],
    ] as const;
    for (const [index, rule] of rules.entries()) {
      await ctx.db.insert("rules", {
        entityId: args.entityId,
        order: index + 1,
        name: rule[0],
        merchantContains: rule[1],
        descriptionContains: rule[2],
        direction: rule[3],
        categoryAccountId: rule[4],
        autoPost: true,
        hitCount: 0,
        active: true,
        createdBy: "seed",
        createdAt: now,
        updatedAt: now,
      });
    }

    const employees = [
      ["Aisha Rahman", "US", "USD", 6200],
      ["Carlos Rivera", "US", "USD", 5400],
      ["Hammas Khan", "PK", "PKR", 180000],
      ["Mina Patel", "IN", "INR", 150000],
      ["Sara Lee", "US", "USD", 4800],
      ["Noman Shah", "PK", "PKR", 220000],
    ] as const;
    const employeeSummaries = [];
    for (const employee of employees) {
      const baseSalaryMinor =
        employee[2] === "PKR" ? cents(employee[3] / 278) : employee[2] === "INR" ? cents(employee[3] / 83) : cents(employee[3]);
      await ctx.db.insert("employees", {
        entityId: args.entityId,
        name: employee[0],
        country: employee[1],
        currency: employee[2],
        monthlySalaryMinor: employee[3] * 100,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      employeeSummaries.push({ name: employee[0], baseSalaryMinor });
    }

    return {
      bankAccounts: { operating, savings, creditCard, stripeClearing },
      contacts,
      employees: employeeSummaries,
      accounts: {
        operating: must("1010"),
        savings: must("1020"),
        ar: must("1100"),
        stripeClearing: must("1150"),
        creditCard: must("2000"),
        ap: must("2100"),
        payrollPayable: must("2200"),
        equity: must("3000"),
        sales: must("4000"),
        services: must("4100"),
        payrollExpense: must("5000"),
        rent: must("5100"),
        software: must("5200"),
        cloud: must("5300"),
        marketing: must("5400"),
        professional: must("5500"),
        fees: must("5600"),
        meals: must("5800"),
        travel: must("5900"),
        office: must("6000"),
        utilities: must("6100"),
        bankFees: must("6200"),
      },
    };
  },
});

export const recordInvoice = internalMutation({
  args: {
    entityId: v.id("entities"),
    contactId: v.id("contacts"),
    number: v.string(),
    status: v.union(v.literal("draft"), v.literal("open"), v.literal("paid"), v.literal("overdue"), v.literal("void")),
    issueDate: v.string(),
    dueDate: v.string(),
    totalMinor: v.number(),
    amountPaidMinor: v.number(),
    entryIds: v.array(v.id("journalEntries")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("invoices", { ...args, currency: "USD", createdAt: now, updatedAt: now });
  },
});

export const recordBill = internalMutation({
  args: {
    entityId: v.id("entities"),
    contactId: v.id("contacts"),
    status: v.union(v.literal("open"), v.literal("paid"), v.literal("void")),
    issueDate: v.string(),
    dueDate: v.string(),
    totalMinor: v.number(),
    entryIds: v.array(v.id("journalEntries")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("bills", { ...args, currency: "USD", createdAt: now, updatedAt: now });
  },
});

export const recordPayrollRun = internalMutation({
  args: {
    entityId: v.id("entities"),
    period: v.string(),
    totalBaseMinor: v.number(),
    entryIds: v.array(v.id("journalEntries")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("payrollRuns", { ...args, status: "paid", createdAt: now, updatedAt: now });
  },
});

export const recordStripePayout = internalMutation({
  args: {
    entityId: v.id("entities"),
    payoutId: v.string(),
    amountMinor: v.number(),
    grossMinor: v.number(),
    feesMinor: v.number(),
    arrivalDate: v.string(),
    status: v.union(v.literal("pending"), v.literal("reconciled"), v.literal("mismatch")),
    bankTxnId: v.id("transactions"),
    entryIds: v.array(v.id("journalEntries")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("stripePayouts", { ...args, createdAt: now, updatedAt: now });
  },
});

export const recordDocumentsAndInbox = internalMutation({
  args: {
    entityId: v.id("entities"),
    matchedReceiptTransactionIds: v.array(v.id("transactions")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (let index = 0; index < 3; index += 1) {
      await ctx.db.insert("documents", {
        entityId: args.entityId,
        kind: "receipt",
        vendor: ["Amazon Business", "Figma", "Delta Air Lines"][index],
        date: day(months[9 + index], 12),
        totalMinor: [12845, 9900, 64000][index],
        currency: "USD",
        matchedTransactionId: args.matchedReceiptTransactionIds[index],
        status: "matched",
        createdAt: now,
        updatedAt: now,
      });
    }
    for (let index = 0; index < 2; index += 1) {
      await ctx.db.insert("documents", {
        entityId: args.entityId,
        kind: "receipt",
        vendor: ["Unknown Parking", "Client Lunch"][index],
        date: day("2026-06", 10 + index),
        totalMinor: [4200, 8800][index],
        currency: "USD",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
    }
    const extraInbox = [
      ["receipt", "Receipt needs a manual transaction match."],
      ["transfer", "Possible owner transfer needs confirmation."],
      ["payout_mismatch", "Stripe payout variance review card."],
      ["connection", "Sandbox bank connection requires attention."],
      ["question", "Recurring contractor payment may be payroll."],
    ] as const;
    for (const item of extraInbox) {
      await ctx.db.insert("inboxItems", {
        entityId: args.entityId,
        kind: item[0],
        payloadSummary: item[1],
        status: "open",
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

export const recordSeedRun = internalMutation({
  args: {
    entityId: v.id("entities"),
    transactionCount: v.number(),
    postedCount: v.number(),
    inboxCount: v.number(),
    evalCount: v.number(),
    trialBalanceDifferenceMinor: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("demoSeedRuns", {
      ...args,
      seed: DEMO_SEED,
      createdAt: Date.now(),
    });
  },
});

export const status = query({
  args: {},
  handler: async (ctx) => {
    const { membership } = await requireAnyWorkspaceRole(ctx, "member");
    const entity = await ctx.db
      .query("entities")
      .withIndex("by_workspace_and_slug", (q) =>
        q.eq("workspaceId", membership.workspaceId).eq("slug", "acme-studio-llc"),
      )
      .unique();
    if (!entity) return null;
    const run = await ctx.db
      .query("demoSeedRuns")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .order("desc")
      .first();
    return run;
  },
});
