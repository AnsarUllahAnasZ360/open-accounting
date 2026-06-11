/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type ReportPack = {
  profitAndLoss: {
    incomeMinor: number;
    expenseMinor: number;
    netIncomeMinor: number;
  };
  balanceSheet: {
    balanced: boolean;
    differenceMinor: number;
  };
  cashFlow: {
    openingCashMinor: number;
    closingCashMinor: number;
    netCashChangeMinor: number;
  };
  trialBalance: {
    differenceMinor: number;
  };
  arAging: {
    totalMinor: number;
  };
  apAging: {
    totalMinor: number;
  };
};

const reportPackRef = makeFunctionReference<
  "query",
  {
    entityId: Id<"entities">;
    startDate: string;
    endDate: string;
    basis: "accrual" | "cash";
    compare: "none" | "priorPeriod" | "priorYear";
    columnMode: "total" | "monthly" | "quarterly";
  },
  ReportPack
>("reportViews:reportPack");

async function setupReportsLedger(t: ReturnType<typeof convexTest>) {
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

    async function account(
      number: string,
      name: string,
      type: "asset" | "liability" | "equity" | "income" | "expense",
      subtype: string,
    ) {
      return await ctx.db.insert("ledgerAccounts", {
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
    }

    const cashId = await account("1010", "Operating Checking", "asset", "bank");
    const arId = await account("1100", "Accounts Receivable", "asset", "receivable");
    const apId = await account("2100", "Accounts Payable", "liability", "payable");
    const servicesId = await account("4000", "Services Revenue", "income", "services");
    const softwareId = await account("5200", "Software & SaaS", "expense", "software");
    const contractorsId = await account("5000", "Payroll & Contractors", "expense", "payroll");

    const customerId = await ctx.db.insert("contacts", {
      entityId,
      name: "Bright Star Clinic",
      roles: ["customer"],
      aliases: [],
      createdAt: now,
      updatedAt: now,
    });
    const vendorId = await ctx.db.insert("contacts", {
      entityId,
      name: "Northwind Contractors",
      roles: ["vendor"],
      aliases: [],
      createdAt: now,
      updatedAt: now,
    });

    return {
      userId,
      entityId,
      cashId,
      arId,
      apId,
      servicesId,
      softwareId,
      contractorsId,
      customerId,
      vendorId,
      now,
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

describe("report views", () => {
  it("builds golden reports from journal lines and distinguishes cash from accrual", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupReportsLedger(t);
    const session = authed(t, ids.userId);

    await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-01-05",
      memo: "Cash sale",
      source: "manual",
      lines: [
        { accountId: ids.cashId, debitMinor: 50000, creditMinor: 0, currency: "USD" },
        { accountId: ids.servicesId, debitMinor: 0, creditMinor: 50000, currency: "USD" },
      ],
    });
    const invoice = await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-01-10",
      memo: "Open invoice OB-1",
      source: "invoice",
      sourceId: "OB-1",
      lines: [
        { accountId: ids.arId, debitMinor: 100000, creditMinor: 0, currency: "USD" },
        { accountId: ids.servicesId, debitMinor: 0, creditMinor: 100000, currency: "USD" },
      ],
    });
    await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-01-12",
      memo: "Paid software",
      source: "manual",
      lines: [
        { accountId: ids.softwareId, debitMinor: 10000, creditMinor: 0, currency: "USD" },
        { accountId: ids.cashId, debitMinor: 0, creditMinor: 10000, currency: "USD" },
      ],
    });
    const bill = await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-01-15",
      memo: "Open bill",
      source: "bill",
      sourceId: "bill-1",
      lines: [
        { accountId: ids.contractorsId, debitMinor: 20000, creditMinor: 0, currency: "USD" },
        { accountId: ids.apId, debitMinor: 0, creditMinor: 20000, currency: "USD" },
      ],
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("invoices", {
        entityId: ids.entityId,
        contactId: ids.customerId,
        number: "OB-1",
        status: "open",
        currency: "USD",
        issueDate: "2026-01-10",
        dueDate: "2026-01-20",
        totalMinor: 100000,
        amountPaidMinor: 0,
        entryIds: [invoice.entryId],
        createdAt: ids.now,
        updatedAt: ids.now,
      });
      await ctx.db.insert("bills", {
        entityId: ids.entityId,
        contactId: ids.vendorId,
        status: "open",
        issueDate: "2026-01-15",
        dueDate: "2026-01-25",
        totalMinor: 20000,
        currency: "USD",
        entryIds: [bill.entryId],
        createdAt: ids.now,
        updatedAt: ids.now,
      });
    });

    const baseArgs = {
      entityId: ids.entityId,
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      compare: "none" as const,
      columnMode: "monthly" as const,
    };
    const accrual = await session.query(reportPackRef, { ...baseArgs, basis: "accrual" });
    const cash = await session.query(reportPackRef, { ...baseArgs, basis: "cash" });

    expect(accrual.profitAndLoss).toMatchObject({
      incomeMinor: 150000,
      expenseMinor: 30000,
      netIncomeMinor: 120000,
    });
    expect(cash.profitAndLoss).toMatchObject({
      incomeMinor: 50000,
      expenseMinor: 10000,
      netIncomeMinor: 40000,
    });
    expect(accrual.balanceSheet).toMatchObject({ balanced: true, differenceMinor: 0 });
    expect(accrual.cashFlow).toMatchObject({
      openingCashMinor: 0,
      closingCashMinor: 40000,
      netCashChangeMinor: 40000,
    });
    expect(accrual.trialBalance.differenceMinor).toBe(0);
    expect(accrual.arAging.totalMinor).toBe(100000);
    expect(accrual.apAging.totalMinor).toBe(20000);
  });

  it("rejects report access without workspace membership", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupReportsLedger(t);

    await expect(
      t.query(reportPackRef, {
        entityId: ids.entityId,
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        basis: "accrual",
        compare: "none",
        columnMode: "total",
      }),
    ).rejects.toThrow("OpenBooks requires sign-in");
  });
});
