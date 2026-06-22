/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// E1-T12 — Bank reconciliation surface + period close.
//   - completeReconciliation REFUSES unless differenceMinor === 0 ($0.00 gate);
//     succeeds once the cleared book balance equals the statement balance.
//   - an adjusting fee/interest entry posts a BALANCED entry through the single
//     ledger path (postLedgerEntryCore) and moves the cleared balance.
//   - closing a period then posting into it is rejected (existing guard).

async function setup(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", { name: "WS", slug: "ws", createdAt: now, updatedAt: now });
    await ctx.db.insert("workspaceMembers", { workspaceId, userId, role: "owner", status: "active", createdAt: now, updatedAt: now });
    const entityId = await ctx.db.insert("entities", {
      workspaceId, name: "Recon Co", slug: "recon-co", businessType: "services",
      currency: "USD", isDemo: false, archived: false, createdAt: now, updatedAt: now,
    });
    const cash = await ctx.db.insert("ledgerAccounts", { entityId, name: "Checking", type: "asset", subtype: "bank", number: "1010", currency: "USD", isSystem: true, archived: false, createdAt: now, updatedAt: now });
    const income = await ctx.db.insert("ledgerAccounts", { entityId, name: "Services Revenue", type: "income", subtype: "services", number: "4100", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
    // Bank Fees account (6200) for the adjusting fee.
    await ctx.db.insert("ledgerAccounts", { entityId, name: "Bank Fees", type: "expense", subtype: "bank_fees", number: "6200", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
    const bankAccountId = await ctx.db.insert("bankAccounts", {
      entityId, ledgerAccountId: cash, name: "Mercury Checking", mask: "4242",
      kind: "checking", balanceMinor: 0, includeInSync: true, createdAt: now, updatedAt: now,
    });

    // Two posted deposits: +1000 and +500. Their ledger lines hit the bank acct.
    async function deposit(date: string, amountMinor: number, ext: string) {
      const entryId = await ctx.db.insert("journalEntries", { entityId, date, memo: "deposit", source: "bank", postedByUserId: userId, locked: true, createdAt: now });
      await ctx.db.insert("journalLines", { entityId, entryId, accountId: cash, debitMinor: amountMinor, creditMinor: 0, currency: "USD", createdAt: now });
      await ctx.db.insert("journalLines", { entityId, entryId, accountId: income, debitMinor: 0, creditMinor: amountMinor, currency: "USD", createdAt: now });
      const txnId = await ctx.db.insert("transactions", {
        entityId, bankAccountId, date, amountMinor, currency: "USD", merchant: "Client",
        rawDescription: "deposit", status: "posted", review: "confirmed", source: "bank",
        categoryAccountId: income, entryId, externalId: ext, evalSet: false, createdAt: now, updatedAt: now,
      });
      return txnId;
    }
    const txnA = await deposit("2026-06-05", 1000_00, "recon:a");
    const txnB = await deposit("2026-06-20", 500_00, "recon:b");
    return { userId, workspaceId, entityId, bankAccountId, cash, income, txnA, txnB };
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">) {
  return t.withIdentity({ subject: `${userId}|s`, tokenIdentifier: "test|recon", issuer: "test", email: "owner@example.com" });
}

describe("bank reconciliation (E1-T12)", () => {
  it("refuses to complete until difference is $0.00, then succeeds", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    // Statement says the account ended at 1500.00.
    const { reconciliationId } = await session.mutation(api.reconciliation.startReconciliation, {
      bankAccountId: ids.bankAccountId,
      statementEndDate: "2026-06-30",
      statementEndBalanceMinor: 1500_00,
    });

    // Nothing cleared yet -> difference is the full 1500, cannot complete.
    let sheet = await session.query(api.reconciliation.reconciliationWorksheet, { reconciliationId });
    expect(sheet?.clearedBalanceMinor).toBe(0);
    expect(sheet?.differenceMinor).toBe(1500_00);
    expect(sheet?.canComplete).toBe(false);
    await expect(
      session.mutation(api.reconciliation.completeReconciliation, { reconciliationId }),
    ).rejects.toThrow(/Cannot complete/);

    // Clear only the +1000 deposit -> difference is 500, still cannot complete.
    await session.mutation(api.reconciliation.toggleTransactionCleared, {
      reconciliationId, transactionId: ids.txnA, cleared: true,
    });
    sheet = await session.query(api.reconciliation.reconciliationWorksheet, { reconciliationId });
    expect(sheet?.clearedBalanceMinor).toBe(1000_00);
    expect(sheet?.differenceMinor).toBe(500_00);
    expect(sheet?.canComplete).toBe(false);

    // Clear the +500 deposit too -> difference is 0, can complete.
    await session.mutation(api.reconciliation.toggleTransactionCleared, {
      reconciliationId, transactionId: ids.txnB, cleared: true,
    });
    sheet = await session.query(api.reconciliation.reconciliationWorksheet, { reconciliationId });
    expect(sheet?.differenceMinor).toBe(0);
    expect(sheet?.canComplete).toBe(true);

    const result = await session.mutation(api.reconciliation.completeReconciliation, { reconciliationId });
    expect(result.differenceMinor).toBe(0);

    const after = await session.query(api.reconciliation.reconciliationWorksheet, { reconciliationId });
    expect(after?.reconciliation.status).toBe("completed");
  });

  it("posts a balanced adjusting fee entry through the single ledger path and moves the cleared balance", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    // Statement ends at 1490.00 — books show 1500, the $10 gap is a bank fee.
    const { reconciliationId } = await session.mutation(api.reconciliation.startReconciliation, {
      bankAccountId: ids.bankAccountId,
      statementEndDate: "2026-06-30",
      statementEndBalanceMinor: 1490_00,
    });
    await session.mutation(api.reconciliation.toggleTransactionCleared, { reconciliationId, transactionId: ids.txnA, cleared: true });
    await session.mutation(api.reconciliation.toggleTransactionCleared, { reconciliationId, transactionId: ids.txnB, cleared: true });

    let sheet = await session.query(api.reconciliation.reconciliationWorksheet, { reconciliationId });
    expect(sheet?.differenceMinor).toBe(-10_00); // books 1500 > statement 1490

    const { entryId } = await session.mutation(api.reconciliation.addAdjustingEntry, {
      reconciliationId, kind: "fee", amountMinor: 10_00, date: "2026-06-30", memo: "Monthly fee",
    });

    // The adjusting entry is BALANCED (Σdebits === Σcredits) and reversible (it is
    // an ordinary posted entry — no raw balance edits).
    const lines = await t.run(async (ctx) =>
      ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", entryId)).collect(),
    );
    const debit = lines.reduce((s, l) => s + l.debitMinor, 0);
    const credit = lines.reduce((s, l) => s + l.creditMinor, 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(10_00);

    // After the fee, the cleared balance drops to 1490 and the recon completes.
    sheet = await session.query(api.reconciliation.reconciliationWorksheet, { reconciliationId });
    expect(sheet?.clearedBalanceMinor).toBe(1490_00);
    expect(sheet?.differenceMinor).toBe(0);
    const result = await session.mutation(api.reconciliation.completeReconciliation, { reconciliationId });
    expect(result.differenceMinor).toBe(0);
  });

  it("rejects posting into a locked period after a period close", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    // Lock the books through 2026-06-30.
    await session.mutation(api.ledger.setPeriodLock, { entityId: ids.entityId, lockedThroughDate: "2026-06-30" });

    // A reconciliation adjusting entry dated inside the locked range is rejected
    // by postLedgerEntryCore's existing period-lock guard.
    const { reconciliationId } = await session.mutation(api.reconciliation.startReconciliation, {
      bankAccountId: ids.bankAccountId,
      statementEndDate: "2026-06-30",
      statementEndBalanceMinor: 1500_00,
    });
    await expect(
      session.mutation(api.reconciliation.addAdjustingEntry, {
        reconciliationId, kind: "fee", amountMinor: 5_00, date: "2026-06-15",
      }),
    ).rejects.toThrow(/locked/i);

    // A direct ledger post into the locked range is likewise rejected.
    await expect(
      session.mutation(api.ledger.postEntry, {
        entityId: ids.entityId,
        date: "2026-06-10",
        memo: "should fail",
        source: "manual",
        lines: [
          { accountId: ids.cash, debitMinor: 100, creditMinor: 0 },
          { accountId: ids.income, debitMinor: 0, creditMinor: 100 },
        ],
      }),
    ).rejects.toThrow(/locked/i);
  });
});
