import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";

type AccountBalance = {
  debitMinor: number;
  creditMinor: number;
};

async function requireEntity(ctx: QueryCtx, entityId: Id<"entities">) {
  const entity = await ctx.db.get(entityId);
  if (!entity) {
    throw new Error("OpenBooks entity not found.");
  }
  await requireWorkspaceRole(ctx, entity.workspaceId, "member");
  return entity;
}

function addBalance(map: Map<Id<"ledgerAccounts">, AccountBalance>, line: Doc<"journalLines">) {
  const current = map.get(line.accountId) ?? { debitMinor: 0, creditMinor: 0 };
  current.debitMinor += line.debitMinor;
  current.creditMinor += line.creditMinor;
  map.set(line.accountId, current);
}

function normalBalance(account: Doc<"ledgerAccounts">, balance: AccountBalance) {
  if (account.type === "asset" || account.type === "expense") {
    return balance.debitMinor - balance.creditMinor;
  }
  return balance.creditMinor - balance.debitMinor;
}

export const seedVerification = query({
  args: {
    entityId: v.id("entities"),
  },
  handler: async (ctx, args) => {
    await requireEntity(ctx, args.entityId);
    const [accounts, entries, lines, transactions, inboxItems] = await Promise.all([
      ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", args.entityId)).collect(),
      ctx.db.query("journalEntries").withIndex("by_entity", (q) => q.eq("entityId", args.entityId)).collect(),
      ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", args.entityId)).collect(),
      ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", args.entityId)).collect(),
      ctx.db.query("inboxItems").withIndex("by_entity", (q) => q.eq("entityId", args.entityId)).collect(),
    ]);

    const accountsById = new Map(accounts.map((account) => [account._id, account]));
    const entriesById = new Map(entries.map((entry) => [entry._id, entry]));
    const trialBalances = new Map<Id<"ledgerAccounts">, AccountBalance>();
    const mayBalances = new Map<Id<"ledgerAccounts">, AccountBalance>();
    const mayThroughBalances = new Map<Id<"ledgerAccounts">, AccountBalance>();

    for (const line of lines) {
      addBalance(trialBalances, line);
      const entry = entriesById.get(line.entryId);
      if (!entry) continue;
      if (entry.date.startsWith("2026-05")) {
        addBalance(mayBalances, line);
      }
      if (entry.date <= "2026-05-31") {
        addBalance(mayThroughBalances, line);
      }
    }

    let trialDebitMinor = 0;
    let trialCreditMinor = 0;
    for (const balance of trialBalances.values()) {
      const netMinor = balance.debitMinor - balance.creditMinor;
      if (netMinor >= 0) {
        trialDebitMinor += netMinor;
      } else {
        trialCreditMinor += Math.abs(netMinor);
      }
    }

    let incomeMinor = 0;
    let expenseMinor = 0;
    for (const [accountId, balance] of mayBalances.entries()) {
      const account = accountsById.get(accountId);
      if (!account) continue;
      const normalMinor = normalBalance(account, balance);
      if (account.type === "income") incomeMinor += normalMinor;
      if (account.type === "expense") expenseMinor += normalMinor;
    }

    let assetMinor = 0;
    let liabilityMinor = 0;
    let equityMinor = 0;
    let currentEarningsMinor = 0;
    for (const [accountId, balance] of mayThroughBalances.entries()) {
      const account = accountsById.get(accountId);
      if (!account) continue;
      const normalMinor = normalBalance(account, balance);
      if (account.type === "asset") assetMinor += normalMinor;
      if (account.type === "liability") liabilityMinor += normalMinor;
      if (account.type === "equity") equityMinor += normalMinor;
      if (account.type === "income") currentEarningsMinor += normalMinor;
      if (account.type === "expense") currentEarningsMinor -= normalMinor;
    }

    const netIncomeMinor = incomeMinor - expenseMinor;

    return {
      trialBalanceDifferenceMinor: trialDebitMinor - trialCreditMinor,
      transactionCount: transactions.length,
      postedTransactionCount: transactions.filter((transaction) => transaction.entryId).length,
      evalCount: transactions.filter((transaction) => transaction.evalSet).length,
      openInboxCount: inboxItems.filter((item) => item.status === "open").length,
      may2026: {
        incomeMinor,
        expenseMinor,
        netIncomeMinor,
        assetMinor,
        liabilityMinor,
        equityMinor,
        currentEarningsMinor,
        balanceSheetDifferenceMinor: assetMinor - (liabilityMinor + equityMinor + currentEarningsMinor),
      },
    };
  },
});
