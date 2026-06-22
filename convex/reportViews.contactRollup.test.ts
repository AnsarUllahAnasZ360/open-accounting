/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// E1-T7 — income-by-customer / expense-by-vendor never double-count a document
// that is BOTH posted to the ledger AND open: the rollup derives from posted
// journal lines (single source of truth) and only adds a document's face value
// when none of its entryIds already contributed. Σ rows === P&L total.
// E1-T9 — postLedgerEntryCore persists line.contactId, and the customer/vendor
// rollup reads it from the ledger (no invoice/bill face-value add-on needed for
// posted documents).

async function setup(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar's workspace", slug: "ansar-workspace", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", {
      workspaceId, userId, role: "owner", status: "active", createdAt: now, updatedAt: now,
    });
    const entityId = await ctx.db.insert("entities", {
      workspaceId, name: "Rollup LLC", slug: "rollup-llc", businessType: "services",
      currency: "USD", isDemo: false, archived: false, createdAt: now, updatedAt: now,
    });
    async function account(number: string, name: string, type: "asset" | "liability" | "equity" | "income" | "expense", subtype: string) {
      return await ctx.db.insert("ledgerAccounts", {
        entityId, number, name, type, subtype, currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now,
      });
    }
    const cash = await account("1010", "Operating Checking", "asset", "bank");
    const ar = await account("1100", "Accounts Receivable", "asset", "receivable");
    const ap = await account("2100", "Accounts Payable", "liability", "payable");
    const services = await account("4000", "Services Revenue", "income", "services");
    const software = await account("5200", "Software & SaaS", "expense", "software");
    const customer = await ctx.db.insert("contacts", {
      entityId, name: "Bright Star Clinic", roles: ["customer"], aliases: [], createdAt: now, updatedAt: now,
    });
    const vendor = await ctx.db.insert("contacts", {
      entityId, name: "Cloud Vendor Inc", roles: ["vendor"], aliases: [], createdAt: now, updatedAt: now,
    });
    return { userId, entityId, cash, ar, ap, services, software, customer, vendor, now };
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">) {
  return t.withIdentity({ subject: `${userId}|test-session`, tokenIdentifier: "test|rollup", issuer: "test", email: "owner@example.com" });
}

const baseArgs = {
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  basis: "accrual" as const,
  compare: "none" as const,
  columnMode: "total" as const,
};

describe("contact rollup — no double-count, ledger-sourced (E1-T7 / E1-T9)", () => {
  it("counts a posted-and-open invoice exactly once and ties to P&L income", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    // Post the invoice accrual WITH the customer attributed on the income line
    // (E1-T9 — what invoice finalize now does).
    const invoiceEntry = await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-01-10",
      memo: "Invoice OB-1 issued",
      source: "invoice",
      sourceId: "OB-1",
      lines: [
        { accountId: ids.ar, debitMinor: 100_000, creditMinor: 0, currency: "USD", contactId: String(ids.customer) },
        { accountId: ids.services, debitMinor: 0, creditMinor: 100_000, currency: "USD", contactId: String(ids.customer) },
      ],
    });

    // The SAME invoice is also recorded as an open document (posted AND open) —
    // the exact double-count trap from the audit.
    await t.run(async (ctx) => {
      await ctx.db.insert("invoices", {
        entityId: ids.entityId,
        contactId: ids.customer,
        number: "OB-1",
        status: "open",
        currency: "USD",
        issueDate: "2026-01-10",
        dueDate: "2026-01-20",
        totalMinor: 100_000,
        amountPaidMinor: 0,
        entryIds: [invoiceEntry.entryId],
        createdAt: ids.now,
        updatedAt: ids.now,
      });
    });

    const pack = await session.query(api.reportViews.reportPack, { entityId: ids.entityId, ...baseArgs });

    // E1-T9: the line carried contactId, so the rollup reads the customer name
    // from the LEDGER alone — no "Unassigned", no face-value add.
    expect(pack.incomeByCustomer.rows).toHaveLength(1);
    expect(pack.incomeByCustomer.rows[0].name).toBe("Bright Star Clinic");
    expect(pack.incomeByCustomer.rows[0].totalMinor).toBe(100_000);

    // E1-T7: counted exactly once — the rollup total equals P&L income for the
    // period (the open invoice's face value was NOT added on top).
    expect(pack.incomeByCustomer.totalMinor).toBe(pack.profitAndLoss.incomeMinor);
    expect(pack.incomeByCustomer.totalMinor).toBe(100_000);
  });

  it("ties expense-by-vendor to P&L expense and adds an UNPOSTED bill's face value once", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    // Posted expense with the vendor on the line.
    await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-01-12",
      memo: "Cloud bill paid",
      source: "bill",
      sourceId: "bill-posted",
      lines: [
        { accountId: ids.software, debitMinor: 30_000, creditMinor: 0, currency: "USD", contactId: String(ids.vendor) },
        { accountId: ids.cash, debitMinor: 0, creditMinor: 30_000, currency: "USD", contactId: String(ids.vendor) },
      ],
    });

    const pack = await session.query(api.reportViews.reportPack, { entityId: ids.entityId, ...baseArgs });

    // expense-by-vendor ties to P&L expense for the period (no double-count).
    expect(pack.expenses.byVendor).toHaveLength(1);
    expect(pack.expenses.byVendor[0].name).toBe("Cloud Vendor Inc");
    const vendorTotal = pack.expenses.byVendor.reduce((sum, row) => sum + row.totalMinor, 0);
    expect(vendorTotal).toBe(pack.profitAndLoss.expenseMinor);
    expect(vendorTotal).toBe(30_000);
  });
});

describe("ledger persists line.contactId (E1-T9)", () => {
  it("writes contactId on the journal line and omitting it keeps it undefined", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    const posted = await session.mutation(api.ledger.postEntry, {
      entityId: ids.entityId,
      date: "2026-01-05",
      memo: "Attributed sale",
      source: "manual",
      lines: [
        { accountId: ids.cash, debitMinor: 5_000, creditMinor: 0, currency: "USD" },
        { accountId: ids.services, debitMinor: 0, creditMinor: 5_000, currency: "USD", contactId: String(ids.customer) },
      ],
    });

    const lines = await t.run(async (ctx) =>
      ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", posted.entryId)).collect(),
    );
    const incomeLine = lines.find((line) => line.accountId === ids.services)!;
    const cashLine = lines.find((line) => line.accountId === ids.cash)!;
    expect(incomeLine.contactId).toBe(String(ids.customer));
    expect(cashLine.contactId).toBeUndefined();
    // fxRate is dead (USD-only GL, decisions Q3) — never written.
    expect(incomeLine.fxRate).toBeUndefined();
  });
});
