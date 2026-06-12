/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import agentComponent from "@convex-dev/agent/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function newTest() {
  const t = convexTest(schema, modules);
  agentComponent.register(t);
  return t;
}

type Setup = {
  userId: Id<"users">;
  workspaceId: Id<"workspaces">;
  entityId: Id<"entities">;
  bankAccountId: Id<"bankAccounts">;
  transactionId: Id<"transactions">;
  softwareAccountId: Id<"ledgerAccounts">;
  travelAccountId: Id<"ledgerAccounts">;
  checkingAccountId: Id<"ledgerAccounts">;
  equityAccountId: Id<"ledgerAccounts">;
};

async function seedFull(t: ReturnType<typeof convexTest>, opts: { slug: string; email: string }): Promise<Setup> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: opts.email, name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: `Workspace ${opts.slug}`,
      slug: opts.slug,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const entityId = await ctx.db.insert("entities", {
      workspaceId,
      name: "Acme Studio LLC",
      slug: "acme-studio-llc",
      businessType: "services",
      currency: "USD",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
    const account = async (
      number: string,
      name: string,
      type: "asset" | "liability" | "equity" | "income" | "expense",
      subtype: string,
    ) =>
      ctx.db.insert("ledgerAccounts", {
        entityId,
        number,
        name,
        type,
        subtype,
        currency: "USD",
        isSystem: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });

    const checkingAccountId = await account("1010", "Operating Checking", "asset", "bank");
    await account("2100", "Accounts Payable", "liability", "payable");
    const equityAccountId = await account("3000", "Owner's Equity", "equity", "equity");
    await account("4100", "Services", "income", "services");
    const softwareAccountId = await account("5200", "Software & SaaS", "expense", "software");
    const travelAccountId = await account("5900", "Travel", "expense", "travel");
    await account("6900", "Uncategorized Expense", "expense", "uncategorized");

    const bankAccountId = await ctx.db.insert("bankAccounts", {
      entityId,
      ledgerAccountId: checkingAccountId,
      name: "Mercury Checking",
      mask: "1001",
      kind: "checking",
      balanceMinor: 125000,
      includeInSync: true,
      createdAt: now,
      updatedAt: now,
    });
    const transactionId = await ctx.db.insert("transactions", {
      entityId,
      bankAccountId,
      date: "2026-06-05",
      amountMinor: -4800,
      currency: "USD",
      merchant: "Figma",
      rawDescription: "Figma subscription",
      status: "posted",
      review: "needs_review",
      source: "bank",
      externalId: "figma-001",
      decidedBy: "needs_review",
      evalSet: false,
      createdAt: now,
      updatedAt: now,
    });

    return {
      userId,
      workspaceId,
      entityId,
      bankAccountId,
      transactionId,
      softwareAccountId,
      travelAccountId,
      checkingAccountId,
      equityAccountId,
    };
  });
}

function authed(t: ReturnType<typeof convexTest>, userId: string, email: string) {
  return t.withIdentity({
    subject: `${userId}|session`,
    tokenIdentifier: `test|${userId}`,
    issuer: "test",
    email,
  });
}

async function newThread(
  t: ReturnType<typeof convexTest>,
  session: ReturnType<typeof authed>,
): Promise<string> {
  const created = await session.mutation(api.aiThreads.createThread, {});
  return created.threadId;
}

/** Simulate a propose tool firing inside the (sessionless) streaming action. */
async function propose(
  t: ReturnType<typeof convexTest>,
  threadId: string,
  kind: "categorize" | "rule" | "invoiceDraft" | "bill" | "journalEntry",
  input: Record<string, unknown>,
): Promise<{ proposalId: Id<"proposals">; summary: string }> {
  return await t.run(async (ctx) => {
    return await ctx.runMutation(internal.proposals.recordProposal, {
      threadId,
      kind,
      input,
    });
  });
}

async function journalTotals(t: ReturnType<typeof convexTest>, entityId: Id<"entities">) {
  return await t.run(async (ctx: MutationCtx) => {
    const lines = await ctx.db
      .query("journalLines")
      .withIndex("by_entity", (q) => q.eq("entityId", entityId))
      .collect();
    return {
      debit: lines.reduce((sum, line) => sum + line.debitMinor, 0),
      credit: lines.reduce((sum, line) => sum + line.creditMinor, 0),
      count: lines.length,
    };
  });
}

async function auditActions(t: ReturnType<typeof convexTest>, workspaceId: Id<"workspaces">) {
  return await t.run(async (ctx: MutationCtx) => {
    const events = await ctx.db
      .query("auditEvents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    return events.map((event) => ({ action: event.action, actorUserId: event.actorUserId, summary: event.summary }));
  });
}

describe("Proposals: categorize round-trip (B3)", () => {
  it("propose → confirm reposts through the ledger and confirms the transaction", async () => {
    const t = newTest();
    const ids = await seedFull(t, { slug: "p-cat", email: "cat@example.com" });
    const session = authed(t, ids.userId, "cat@example.com");
    const threadId = await newThread(t, session);

    const proposal = await propose(t, threadId, "categorize", {
      merchantContains: "Figma",
      categoryAccountNumber: "5200",
    });
    expect(proposal.summary).toContain("Figma");

    // proposed state in the DB, no ledger impact yet.
    expect((await journalTotals(t, ids.entityId)).count).toBe(0);

    const result = await session.mutation(api.proposals.confirmProposal, {
      proposalId: proposal.proposalId,
    });
    expect(result.status).toBe("confirmed");

    const snapshot = await t.run(async (ctx) => {
      const transaction = await ctx.db.get(ids.transactionId);
      const proposalDoc = await ctx.db.get(proposal.proposalId);
      return { transaction, proposalDoc };
    });
    expect(snapshot.transaction?.review).toBe("confirmed");
    expect(snapshot.transaction?.categoryAccountId).toBe(ids.softwareAccountId);
    expect(snapshot.proposalDoc?.status).toBe("confirmed");
    expect(snapshot.proposalDoc?.decidedBy).toBe(ids.userId);

    const totals = await journalTotals(t, ids.entityId);
    expect(totals.debit).toBe(totals.credit);
    expect(totals.debit).toBe(4800);

    const audit = await auditActions(t, ids.workspaceId);
    expect(audit.some((event) => event.action === "ai.categorize.confirmed")).toBe(true);

    // Thread shows the outcome.
    const messages = await session.query(api.aiThreads.listThreadMessages, {
      threadId,
      paginationOpts: { cursor: null, numItems: 20 },
    });
    const text = messages.page
      .filter((m) => m.role === "assistant")
      .flatMap((m) => m.parts)
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join(" ");
    expect(text).toContain("Software & SaaS");
  });

  it("double-confirm is idempotently rejected", async () => {
    const t = newTest();
    const ids = await seedFull(t, { slug: "p-double", email: "double@example.com" });
    const session = authed(t, ids.userId, "double@example.com");
    const threadId = await newThread(t, session);

    const proposal = await propose(t, threadId, "categorize", {
      merchantContains: "Figma",
      categoryAccountNumber: "5200",
    });
    await session.mutation(api.proposals.confirmProposal, { proposalId: proposal.proposalId });
    await expect(
      session.mutation(api.proposals.confirmProposal, { proposalId: proposal.proposalId }),
    ).rejects.toThrow(/already confirmed/i);

    // Exactly one reposting entry (no duplicate ledger writes).
    const entries = await t.run(async (ctx) =>
      ctx.db.query("journalEntries").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
    );
    // Recategorize on an unposted txn posts a single entry (no prior entry to reverse).
    expect(entries.length).toBe(1);
  });

  it("dismiss records dismissal and blocks later confirm", async () => {
    const t = newTest();
    const ids = await seedFull(t, { slug: "p-dismiss", email: "dismiss@example.com" });
    const session = authed(t, ids.userId, "dismiss@example.com");
    const threadId = await newThread(t, session);

    const proposal = await propose(t, threadId, "categorize", {
      merchantContains: "Figma",
      categoryAccountNumber: "5200",
    });
    const dismissed = await session.mutation(api.proposals.dismissProposal, {
      proposalId: proposal.proposalId,
    });
    expect(dismissed.status).toBe("dismissed");
    await expect(
      session.mutation(api.proposals.confirmProposal, { proposalId: proposal.proposalId }),
    ).rejects.toThrow();
  });
});

describe("Proposals: rule / invoice / bill / journal round-trips (B3)", () => {
  it("rule proposal creates an active AI rule on confirm", async () => {
    const t = newTest();
    const ids = await seedFull(t, { slug: "p-rule", email: "rule@example.com" });
    const session = authed(t, ids.userId, "rule@example.com");
    const threadId = await newThread(t, session);

    const proposal = await propose(t, threadId, "rule", {
      merchantContains: "Figma",
      categoryAccountNumber: "5200",
    });
    await session.mutation(api.proposals.confirmProposal, { proposalId: proposal.proposalId });

    const rules = await t.run(async (ctx) =>
      ctx.db.query("rules").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
    );
    expect(rules).toHaveLength(1);
    expect(rules[0].createdBy).toBe("ai");
    expect(rules[0].active).toBe(true);
    expect(rules[0].categoryAccountId).toBe(ids.softwareAccountId);
  });

  it("invoice draft proposal saves a draft with no ledger posting", async () => {
    const t = newTest();
    const ids = await seedFull(t, { slug: "p-inv", email: "inv@example.com" });
    const session = authed(t, ids.userId, "inv@example.com");
    const threadId = await newThread(t, session);

    const proposal = await propose(t, threadId, "invoiceDraft", {
      customerName: "Northstar Labs",
      amountMinor: 120000,
      issueDate: "2026-06-10",
      dueDate: "2026-07-10",
    });
    await session.mutation(api.proposals.confirmProposal, { proposalId: proposal.proposalId });

    const invoices = await t.run(async (ctx) =>
      ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
    );
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe("draft");
    expect(invoices[0].totalMinor).toBe(120000);
    expect(invoices[0].entryIds).toHaveLength(0);
    // No ledger entries from a draft.
    expect((await journalTotals(t, ids.entityId)).count).toBe(0);
  });

  it("bill proposal posts a balanced AP entry on confirm", async () => {
    const t = newTest();
    const ids = await seedFull(t, { slug: "p-bill", email: "bill@example.com" });
    const session = authed(t, ids.userId, "bill@example.com");
    const threadId = await newThread(t, session);

    const proposal = await propose(t, threadId, "bill", {
      vendorName: "Adobe",
      amountMinor: 2400,
      issueDate: "2026-06-10",
      dueDate: "2026-06-30",
      expenseAccountNumber: "5200",
    });
    const result = await session.mutation(api.proposals.confirmProposal, {
      proposalId: proposal.proposalId,
    });
    expect(result.status).toBe("confirmed");

    const bills = await t.run(async (ctx) =>
      ctx.db.query("bills").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
    );
    expect(bills).toHaveLength(1);
    expect(bills[0].status).toBe("open");
    expect(bills[0].totalMinor).toBe(2400);
    expect(bills[0].entryIds).toHaveLength(1);

    const totals = await journalTotals(t, ids.entityId);
    expect(totals.debit).toBe(2400);
    expect(totals.credit).toBe(2400);

    const audit = await auditActions(t, ids.workspaceId);
    const billAudit = audit.find((event) => event.action === "ai.bill.proposal.confirmed");
    expect(billAudit).toBeTruthy();
    expect(billAudit?.actorUserId).toBe(ids.userId);
  });

  it("journal-entry proposal posts a balanced entry through the ledger", async () => {
    const t = newTest();
    const ids = await seedFull(t, { slug: "p-je", email: "je@example.com" });
    const session = authed(t, ids.userId, "je@example.com");
    const threadId = await newThread(t, session);

    const proposal = await propose(t, threadId, "journalEntry", {
      date: "2026-06-10",
      memo: "Owner contribution",
      amountMinor: 10000,
      debitAccountNumber: "1010",
      creditAccountNumber: "3000",
    });
    await session.mutation(api.proposals.confirmProposal, { proposalId: proposal.proposalId });

    const snapshot = await t.run(async (ctx) => {
      const entries = await ctx.db
        .query("journalEntries")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .collect();
      return entries;
    });
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].source).toBe("ai");
    expect(snapshot[0].memo).toBe("Owner contribution");

    const totals = await journalTotals(t, ids.entityId);
    expect(totals.debit).toBe(10000);
    expect(totals.credit).toBe(10000);
  });
});

describe("Proposals: authorization + lifecycle (B3)", () => {
  it("rejects confirming a proposal from another workspace", async () => {
    const t = newTest();
    const a = await seedFull(t, { slug: "p-auth-a", email: "aa@example.com" });
    const b = await seedFull(t, { slug: "p-auth-b", email: "bb@example.com" });
    const aSession = authed(t, a.userId, "aa@example.com");
    const bSession = authed(t, b.userId, "bb@example.com");
    const threadA = await newThread(t, aSession);

    const proposal = await propose(t, threadA, "categorize", {
      merchantContains: "Figma",
      categoryAccountNumber: "5200",
    });
    await expect(
      bSession.mutation(api.proposals.confirmProposal, { proposalId: proposal.proposalId }),
    ).rejects.toThrow();
    await expect(
      bSession.mutation(api.proposals.dismissProposal, { proposalId: proposal.proposalId }),
    ).rejects.toThrow();
  });

  it("auto-expires open proposals when a newer message starts a generation", async () => {
    const t = newTest();
    const ids = await seedFull(t, { slug: "p-expire", email: "expire@example.com" });
    const session = authed(t, ids.userId, "expire@example.com");
    const threadId = await newThread(t, session);

    const proposal = await propose(t, threadId, "categorize", {
      merchantContains: "Figma",
      categoryAccountNumber: "5200",
    });

    // A newer message supersedes the open proposal. Expiry happens
    // synchronously inside sendMessage (before scheduling the response).
    await session.mutation(api.aiThreads.sendMessage, {
      threadId,
      prompt: "Actually, never mind — show me my balances.",
    });

    const proposalDoc = await t.run(async (ctx) => ctx.db.get(proposal.proposalId));
    expect(proposalDoc?.status).toBe("expired");

    // An expired proposal can no longer be confirmed.
    await expect(
      session.mutation(api.proposals.confirmProposal, { proposalId: proposal.proposalId }),
    ).rejects.toThrow();
  });

  it("validates at propose time: rejects a non-expense category for categorize", async () => {
    const t = newTest();
    const ids = await seedFull(t, { slug: "p-validate", email: "val@example.com" });
    const session = authed(t, ids.userId, "val@example.com");
    const threadId = await newThread(t, session);

    await expect(
      propose(t, threadId, "categorize", {
        merchantContains: "Figma",
        categoryAccountNumber: "1010", // asset, not expense
      }),
    ).rejects.toThrow();
  });
});
