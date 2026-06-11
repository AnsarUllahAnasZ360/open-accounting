import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const categorizeTransactions = makeFunctionReference<
  "mutation",
  { entityId: string; merchantContains: string; categoryAccountNumber?: string },
  { action: "categorizeTransactions"; updatedCount: number; categoryName: string }
>("aiChatActions:categorizeTransactions");
const draftInvoice = makeFunctionReference<
  "mutation",
  { entityId: string; customerName: string; amountMinor: number; issueDate: string; dueDate: string },
  { action: "draftInvoice"; number: string; status: "draft" }
>("aiChatActions:draftInvoice");
const addBill = makeFunctionReference<
  "mutation",
  { entityId: string; vendorName: string; amountMinor: number; issueDate: string; dueDate: string; expenseAccountNumber?: string },
  { action: "addBill"; status: "open"; entryId: string; expenseAccountName: string }
>("aiChatActions:addBill");
const createJournalEntry = makeFunctionReference<
  "mutation",
  {
    entityId: string;
    date: string;
    memo: string;
    amountMinor: number;
    debitAccountNumber?: string;
    creditAccountNumber?: string;
  },
  { action: "createJournalEntry"; entryId: string; debitTotal: number; creditTotal: number }
>("aiChatActions:createJournalEntry");

async function setupChatActions(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      email: "owner@example.com",
      name: "Owner",
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar's workspace",
      slug: "ansar-workspace",
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
      await ctx.db.insert("ledgerAccounts", {
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
    const receivableAccountId = await account("1100", "Accounts Receivable", "asset", "receivable");
    const payableAccountId = await account("2100", "Accounts Payable", "liability", "payable");
    const equityAccountId = await account("3000", "Owner's Equity", "equity", "equity");
    const servicesAccountId = await account("4100", "Services", "income", "services");
    const softwareAccountId = await account("5200", "Software & SaaS", "expense", "software");
    const travelAccountId = await account("5900", "Travel", "expense", "travel");
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
      merchant: "Uber",
      rawDescription: "Uber trip",
      status: "posted",
      review: "needs_review",
      source: "bank",
      externalId: "ai-action-uber-001",
      decidedBy: "needs_review",
      evalSet: false,
      createdAt: now,
      updatedAt: now,
    });

    return {
      userId,
      workspaceId,
      entityId,
      transactionId,
      checkingAccountId,
      receivableAccountId,
      payableAccountId,
      equityAccountId,
      servicesAccountId,
      softwareAccountId,
      travelAccountId,
    };
  });
}

function authed(t: ReturnType<typeof convexTest>, userId: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|owner",
    issuer: "test",
    email: "owner@example.com",
  });
}

describe("M10 AI chat action tools", () => {
  it("confirms categorization through the pipeline instead of direct journal writes", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupChatActions(t);
    const session = authed(t, ids.userId);

    const result = await session.mutation(categorizeTransactions, {
      entityId: ids.entityId,
      merchantContains: "Uber",
      categoryAccountNumber: "5900",
    });

    expect(result).toMatchObject({
      action: "categorizeTransactions",
      updatedCount: 1,
      categoryName: "Travel",
    });
    const snapshot = await t.run(async (ctx) => {
      const transaction = await ctx.db.get(ids.transactionId);
      const entries = await ctx.db.query("journalEntries").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect();
      const lines = await ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect();
      return { transaction, entries, lines };
    });

    expect(snapshot.transaction?.review).toBe("confirmed");
    expect(snapshot.transaction?.categoryAccountId).toBe(ids.travelAccountId);
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0].source).toBe("bank");
    expect(snapshot.lines.reduce((sum, line) => sum + line.debitMinor, 0)).toBe(4800);
    expect(snapshot.lines.reduce((sum, line) => sum + line.creditMinor, 0)).toBe(4800);
  });

  it("creates invoice and bill action records with ledger impact only for the open bill", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupChatActions(t);
    const session = authed(t, ids.userId);

    const invoice = await session.mutation(draftInvoice, {
      entityId: ids.entityId,
      customerName: "Northstar Labs",
      amountMinor: 120000,
      issueDate: "2026-06-10",
      dueDate: "2026-07-10",
    });
    const bill = await session.mutation(addBill, {
      entityId: ids.entityId,
      vendorName: "Adobe",
      amountMinor: 2400,
      issueDate: "2026-06-10",
      dueDate: "2026-06-30",
      expenseAccountNumber: "5200",
    });

    expect(invoice).toMatchObject({ action: "draftInvoice", status: "draft" });
    expect(bill).toMatchObject({
      action: "addBill",
      status: "open",
      expenseAccountName: "Software & SaaS",
    });

    const snapshot = await t.run(async (ctx) => {
      const invoices = await ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect();
      const bills = await ctx.db.query("bills").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect();
      const entries = await ctx.db.query("journalEntries").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect();
      const lines = await ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect();
      return { invoices, bills, entries, lines };
    });

    expect(snapshot.invoices[0]).toMatchObject({
      status: "draft",
      totalMinor: 120000,
      entryIds: [],
    });
    expect(snapshot.bills[0]).toMatchObject({
      status: "open",
      totalMinor: 2400,
      entryIds: [bill.entryId],
    });
    expect(snapshot.entries.find((entry) => entry._id === bill.entryId)?.source).toBe("bill");
    expect(snapshot.lines.reduce((sum, line) => sum + line.debitMinor, 0)).toBe(2400);
    expect(snapshot.lines.reduce((sum, line) => sum + line.creditMinor, 0)).toBe(2400);
  });

  it("creates confirmed journal entries by delegating to ledger.postEntry", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupChatActions(t);
    const session = authed(t, ids.userId);

    const result = await session.mutation(createJournalEntry, {
      entityId: ids.entityId,
      date: "2026-06-10",
      memo: "Owner contribution confirmed from chat",
      amountMinor: 10000,
      debitAccountNumber: "1010",
      creditAccountNumber: "3000",
    });

    expect(result).toMatchObject({
      action: "createJournalEntry",
      debitTotal: 10000,
      creditTotal: 10000,
    });
    const snapshot = await t.run(async (ctx) => {
      const entry = await ctx.db.get(result.entryId);
      const lines = await ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", result.entryId)).collect();
      return { entry, lines };
    });

    expect(snapshot.entry).toMatchObject({
      source: "ai",
      memo: "Owner contribution confirmed from chat",
      locked: true,
    });
    expect(snapshot.lines).toHaveLength(2);
    expect(snapshot.lines.reduce((sum, line) => sum + line.debitMinor, 0)).toBe(10000);
    expect(snapshot.lines.reduce((sum, line) => sum + line.creditMinor, 0)).toBe(10000);
  });

  it("rejects action-tool account choices that do not match the expected account shape", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupChatActions(t);
    const session = authed(t, ids.userId);

    await expect(session.mutation(addBill, {
      entityId: ids.entityId,
      vendorName: "Adobe",
      amountMinor: 2400,
      issueDate: "2026-06-10",
      dueDate: "2026-06-30",
      expenseAccountNumber: "1010",
    })).rejects.toThrow("must be expense type");
  });

  it("rejects unauthenticated action-tool mutations", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupChatActions(t);

    await expect(t.mutation(createJournalEntry, {
      entityId: ids.entityId,
      date: "2026-06-10",
      memo: "Unauthenticated attempt",
      amountMinor: 10000,
    })).rejects.toThrow();
  });
});
