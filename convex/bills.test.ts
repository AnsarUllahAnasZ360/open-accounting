/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Minimal entity with AP (2100), an expense category (6999), and an operating
 * bank account + its ledger account. Seeds one OPEN bill posted as
 * debit-expense / credit-AP, and one outgoing bank transaction that plausibly
 * settles it (same amount, near the due date, matching vendor token).
 */
async function setup(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", { name: "Ansar's workspace", slug: "ansar-workspace", createdAt: now, updatedAt: now });
    await ctx.db.insert("workspaceMembers", { workspaceId, userId, role: "owner", status: "active", createdAt: now, updatedAt: now });
    const entityId = await ctx.db.insert("entities", { workspaceId, name: "Acme Studio LLC", slug: "acme-studio-llc", businessType: "services", currency: "USD", isDemo: true, createdAt: now, updatedAt: now });
    const account = (number: string, name: string, type: "asset" | "liability" | "expense") =>
      ctx.db.insert("ledgerAccounts", { entityId, number, name, type, subtype: type, currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
    const checkingLedgerId = await account("1010", "Operating Checking", "asset");
    const apId = await account("2100", "Accounts Payable", "liability");
    const expenseId = await account("6999", "Other Expense", "expense");
    const bankAccountId = await ctx.db.insert("bankAccounts", { entityId, ledgerAccountId: checkingLedgerId, name: "Operating Checking", mask: "1001", kind: "checking", balanceMinor: 5_000_000, includeInSync: true, createdAt: now, updatedAt: now });
    const contactId = await ctx.db.insert("contacts", { entityId, name: "WeWork", roles: ["vendor"], aliases: [], createdAt: now, updatedAt: now });

    // OPEN bill: debit expense / credit AP, $2,400 due 2026-06-15.
    const billEntryId = await ctx.db.insert("journalEntries", { entityId, date: "2026-06-01", memo: "WeWork bill", source: "bill", postedByUserId: userId, locked: true, createdAt: now });
    await ctx.db.insert("journalLines", { entityId, entryId: billEntryId, accountId: expenseId, debitMinor: 240_000, creditMinor: 0, currency: "USD", createdAt: now });
    await ctx.db.insert("journalLines", { entityId, entryId: billEntryId, accountId: apId, debitMinor: 0, creditMinor: 240_000, currency: "USD", createdAt: now });
    const billId = await ctx.db.insert("bills", { entityId, contactId, status: "open", issueDate: "2026-06-01", dueDate: "2026-06-15", totalMinor: 240_000, currency: "USD", entryIds: [billEntryId], createdAt: now, updatedAt: now });

    // Candidate bank transaction: WeWork ACH, −$2,400, 2026-06-14, needs_review.
    const txnId = await ctx.db.insert("transactions", { entityId, bankAccountId, date: "2026-06-14", amountMinor: -240_000, currency: "USD", merchant: "WeWork", rawDescription: "WEWORK ACH PAYMENT", status: "posted", review: "needs_review", source: "bank", externalId: "txn-wework-1", evalSet: false, createdAt: now, updatedAt: now });

    return { userId, entityId, apId, expenseId, checkingLedgerId, billId, txnId };
  });
}

function authed(t: TestConvex<typeof schema>, userId: string) {
  return t.withIdentity({ subject: `${userId}|test-session`, tokenIdentifier: "test|owner", issuer: "test", email: "owner@example.com" });
}

async function accountNet(t: TestConvex<typeof schema>, accountId: string) {
  return await t.run(async (ctx) => {
    const lines = await ctx.db.query("journalLines").withIndex("by_account", (q) => q.eq("accountId", accountId as Id<"ledgerAccounts">)).collect();
    return lines.reduce((s, l) => s + l.debitMinor - l.creditMinor, 0);
  });
}

describe("bills.markPaid settlement", () => {
  it("suggests the matching bank transaction as the best candidate", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);
    const result = await session.query(api.bills.matchCandidates, { billId: ids.billId });
    expect(result?.candidates.length).toBeGreaterThan(0);
    expect(result?.candidates[0].id).toBe(ids.txnId);
    expect(result?.candidates[0].suggested).toBe(true);
    expect(result?.candidates[0].amountMatch).toBe(true);
  });

  it("markPaid posts a balanced AP debit / bank credit and clears the payable", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    // AP carries the open payable before settlement (credit balance = −240000 net).
    expect(await accountNet(t, ids.apId)).toBe(-240_000);

    const result = await session.mutation(api.bills.markPaid, { billId: ids.billId, transactionId: ids.txnId });
    expect(result.settled).toBe(true);
    expect(result.consumedTransactionId).toBe(ids.txnId);

    const lines = await t.run(async (ctx) => ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", result.entryId as Id<"journalEntries">)).collect());
    const debit = lines.reduce((s, l) => s + l.debitMinor, 0);
    const credit = lines.reduce((s, l) => s + l.creditMinor, 0);
    expect(debit).toBe(credit); // balanced
    expect(debit).toBe(240_000);
    // AP debited (cleared), bank credited.
    expect(lines.find((l) => l.accountId === ids.apId)?.debitMinor).toBe(240_000);
    expect(lines.find((l) => l.accountId === ids.checkingLedgerId)?.creditMinor).toBe(240_000);

    // AP is now flat (accrual credit + settlement debit cancel).
    expect(await accountNet(t, ids.apId)).toBe(0);

    const bill = await t.run(async (ctx) => ctx.db.get(ids.billId));
    expect(bill?.status).toBe("paid");
  });

  it("consumes the matched bank transaction so it is not double-counted", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);
    await session.mutation(api.bills.markPaid, { billId: ids.billId, transactionId: ids.txnId });
    const txn = await t.run(async (ctx) => ctx.db.get(ids.txnId));
    expect(txn?.review).toBe("confirmed");
    expect(txn?.categoryAccountId).toBe(ids.apId);
  });

  it("rejects double-settle", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);
    await session.mutation(api.bills.markPaid, { billId: ids.billId, transactionId: ids.txnId });
    await expect(session.mutation(api.bills.markPaid, { billId: ids.billId, transactionId: ids.txnId })).rejects.toThrow();
  });

  it("rejects settling against an already-reconciled transaction", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);
    // Mark the candidate confirmed first (as if reconciled elsewhere).
    await t.run(async (ctx) => ctx.db.patch(ids.txnId, { review: "confirmed" }));
    await expect(session.mutation(api.bills.markPaid, { billId: ids.billId, transactionId: ids.txnId })).rejects.toThrow();
  });

  it("schedules an expected match without posting when no bank movement is chosen", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);
    const before = await t.run(async (ctx) => (await ctx.db.query("journalEntries").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect()).length);
    const result = await session.mutation(api.bills.markPaid, { billId: ids.billId, scheduleExpected: true });
    expect(result.scheduled).toBe(true);
    expect(result.settled).toBe(false);
    const after = await t.run(async (ctx) => (await ctx.db.query("journalEntries").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect()).length);
    expect(after).toBe(before); // nothing posted
    const bill = await t.run(async (ctx) => ctx.db.get(ids.billId));
    expect(bill?.status).toBe("open");
  });
});

describe("bills.createBill", () => {
  it("posts AP on creation (debit expense / credit AP) and is balanced", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);
    const result = await session.mutation(api.bills.createBill, {
      entityId: ids.entityId,
      vendorName: "Counsel & Co",
      totalMinor: 270_000,
      dueDate: "2026-06-30",
    });
    const lines = await t.run(async (ctx) => ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", result.entryId as Id<"journalEntries">)).collect());
    const debit = lines.reduce((s, l) => s + l.debitMinor, 0);
    const credit = lines.reduce((s, l) => s + l.creditMinor, 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(270_000);
    expect(lines.find((l) => l.accountId === ids.apId)?.creditMinor).toBe(270_000);
  });
});
