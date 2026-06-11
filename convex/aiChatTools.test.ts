import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const queryTransactions = makeFunctionReference<
  "query",
  { entityId?: string; search?: string; limit?: number },
  { tool: "queryTransactions"; rows: Array<{ merchant: string; category: { name: string } | null }> }
>("aiChatTools:queryTransactions");
const getReport = makeFunctionReference<
  "query",
  { entityId?: string; report: "profit-and-loss"; startDate?: string; endDate?: string },
  { tool: "getReport"; report: "profit-and-loss"; data: { incomeMinor: number; expenseMinor: number } }
>("aiChatTools:getReport");
const getBalances = makeFunctionReference<
  "query",
  { entityId?: string },
  { tool: "getBalances"; totalMinor: number; rows: Array<{ name: string; balanceMinor: number }> }
>("aiChatTools:getBalances");
const searchContacts = makeFunctionReference<
  "query",
  { entityId?: string; query?: string },
  { tool: "searchContacts"; rows: Array<{ name: string; openInvoiceMinor: number; openBillMinor: number }> }
>("aiChatTools:searchContacts");
const getPayrollRuns = makeFunctionReference<
  "query",
  { entityId?: string; limit?: number },
  { tool: "getPayrollRuns"; activeEmployeeCount: number; rows: Array<{ period: string; totalBaseMinor: number }> }
>("aiChatTools:getPayrollRuns");

async function setupChatTools(t: ReturnType<typeof convexTest>) {
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
    const bankLedgerAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Operating Checking",
      type: "asset",
      subtype: "bank",
      number: "1010",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const softwareAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Software & SaaS",
      type: "expense",
      subtype: "software",
      number: "5200",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const bankAccountId = await ctx.db.insert("bankAccounts", {
      entityId,
      ledgerAccountId: bankLedgerAccountId,
      name: "Mercury Checking",
      mask: "1001",
      kind: "checking",
      balanceMinor: 125000,
      includeInSync: true,
      createdAt: now,
      updatedAt: now,
    });
    const contactId = await ctx.db.insert("contacts", {
      entityId,
      name: "Northstar Labs",
      roles: ["customer"],
      email: "ap@northstar.example",
      aliases: ["Northstar"],
      createdAt: now,
      updatedAt: now,
    });
    const entryId = await ctx.db.insert("journalEntries", {
      entityId,
      date: "2026-05-15",
      memo: "Figma monthly subscription",
      source: "bank",
      postedByUserId: userId,
      locked: false,
      createdAt: now,
    });
    await ctx.db.insert("journalLines", {
      entityId,
      entryId,
      accountId: softwareAccountId,
      debitMinor: 9900,
      creditMinor: 0,
      currency: "USD",
      createdAt: now,
    });
    await ctx.db.insert("journalLines", {
      entityId,
      entryId,
      accountId: bankLedgerAccountId,
      debitMinor: 0,
      creditMinor: 9900,
      currency: "USD",
      createdAt: now,
    });
    await ctx.db.insert("transactions", {
      entityId,
      bankAccountId,
      date: "2026-05-15",
      amountMinor: -9900,
      currency: "USD",
      merchant: "Figma",
      rawDescription: "Figma monthly subscription",
      status: "posted",
      review: "confirmed",
      source: "bank",
      categoryAccountId: softwareAccountId,
      contactId,
      entryId,
      externalId: "tool-test-figma",
      decidedBy: "rule",
      evalSet: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("invoices", {
      entityId,
      contactId,
      number: "INV-001",
      status: "open",
      currency: "USD",
      issueDate: "2026-05-01",
      dueDate: "2026-05-31",
      totalMinor: 420000,
      amountPaidMinor: 100000,
      entryIds: [],
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("employees", {
      entityId,
      name: "Ava Contractor",
      country: "US",
      currency: "USD",
      monthlySalaryMinor: 800000,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("payrollRuns", {
      entityId,
      period: "2026-05",
      status: "paid",
      totalBaseMinor: 800000,
      entryIds: [],
      createdAt: now,
      updatedAt: now,
    });
    return { userId, workspaceId, entityId };
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

describe("M10 AI chat read tools", () => {
  it("returns bounded authorized read snapshots for the chat tool names", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupChatTools(t);
    const session = authed(t, ids.userId);

    const transactions = await session.query(queryTransactions, {
      entityId: ids.entityId,
      search: "figma",
      limit: 5,
    });
    const balances = await session.query(getBalances, { entityId: ids.entityId });
    const report = await session.query(getReport, {
      entityId: ids.entityId,
      report: "profit-and-loss",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    const contacts = await session.query(searchContacts, { entityId: ids.entityId, query: "northstar" });
    const payroll = await session.query(getPayrollRuns, { entityId: ids.entityId, limit: 3 });

    expect(transactions).toMatchObject({
      tool: "queryTransactions",
      rows: [{ merchant: "Figma", category: { name: "Software & SaaS" } }],
    });
    expect(balances).toMatchObject({
      tool: "getBalances",
      totalMinor: 125000,
      rows: [{ name: "Mercury Checking", balanceMinor: 125000 }],
    });
    expect(report.tool).toBe("getReport");
    expect(report.data.expenseMinor).toBe(9900);
    expect(contacts.rows[0]).toMatchObject({
      name: "Northstar Labs",
      openInvoiceMinor: 320000,
    });
    expect(payroll).toMatchObject({
      tool: "getPayrollRuns",
      activeEmployeeCount: 1,
      rows: [{ period: "2026-05", totalBaseMinor: 800000 }],
    });
  });

  it("rejects unauthenticated read-tool access", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupChatTools(t);

    await expect(t.query(getBalances, { entityId: ids.entityId })).rejects.toThrow();
  });
});
