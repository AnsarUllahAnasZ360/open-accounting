/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupWorkspace(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", { name: "Ansar's workspace", slug: "ansar-workspace", createdAt: now, updatedAt: now });
    await ctx.db.insert("workspaceMembers", { workspaceId, userId, role: "owner", status: "active", createdAt: now, updatedAt: now });
    return { userId, workspaceId };
  });
}

function authed(t: TestConvex<typeof schema>, userId: string) {
  return t.withIdentity({ subject: `${userId}|test-session`, tokenIdentifier: "test|owner", issuer: "test", email: "owner@example.com" });
}

describe("expensesViews category totals reconcile to the P&L expense section", () => {
  it("each category total equals the report pack expense row for the same month", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);
    const seed = await session.action(api.seedDemo.resetAndSeed, {});

    // Last full month (May 2026) — the report pack's expense rows are accrual
    // (no excluded entries), exactly what the Expenses read model computes.
    const start = "2026-05-01";
    const end = "2026-05-31";
    const expenses = await session.query(api.expensesViews.overview, { entityId: seed.entityId, period: "last" });
    const pack = await session.query(api.reportViews.reportPack, {
      entityId: seed.entityId,
      startDate: start,
      endDate: end,
      basis: "accrual",
      compare: "none",
      columnMode: "total",
    });

    // Total expenses match.
    expect(expenses.totalMinor).toBe(pack.profitAndLoss.expenseMinor);

    // Each category total matches the corresponding P&L expense account row.
    const packByAccount = new Map(pack.profitAndLoss.sections.find((s) => s.key === "expense")!.rows.map((row) => [row.id as string, row.totalMinor]));
    for (const category of expenses.categories) {
      expect(packByAccount.get(category.id), `category ${category.name} (${category.id})`).toBe(category.totalMinor);
    }
    // And the report has no expense account that Expenses dropped.
    for (const [id, total] of packByAccount.entries()) {
      if (total === 0) continue;
      expect(expenses.categories.some((c) => c.id === id), `report account ${id} missing from Expenses`).toBe(true);
    }
  });
});

describe("E10-T4: payroll surfaces as a first-class expense group that reconciles to Reports", () => {
  it("Expenses payroll base total === Reports Payroll Summary base total for the same period", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);
    const seed = await session.action(api.seedDemo.resetAndSeed, {});

    const start = "2026-05-01";
    const end = "2026-05-31";
    const expenses = await session.query(api.expensesViews.overview, { entityId: seed.entityId, period: "last" });
    const pack = await session.query(api.reportViews.reportPack, {
      entityId: seed.entityId,
      startDate: start,
      endDate: end,
      basis: "accrual",
      compare: "none",
      columnMode: "total",
    });

    // The synthetic Payroll group exists, is sourced from the ledger, and links
    // the run(s) for the period.
    expect(expenses.payroll).not.toBeNull();
    const payrollGroup = expenses.payroll!;
    expect(payrollGroup.source).toBe("payroll");
    expect(payrollGroup.number).toBe("5000");
    expect(payrollGroup.baseMinor).toBeGreaterThan(0);
    expect(payrollGroup.runCount).toBeGreaterThanOrEqual(1);

    // The reconciliation invariant: Expenses payroll (ledger-derived) equals the
    // Reports Payroll Summary base total (approved-run derived) for the SAME range.
    expect(payrollGroup.baseMinor).toBe(pack.payrollSummary.totalMinor);

    // Payroll is among the LARGEST expenses (a services shop's biggest cost): it
    // is present in the category list and tagged so it cannot double-count.
    const payrollCategory = expenses.categories.find((c) => c.source === "payroll");
    expect(payrollCategory, "payroll category present in Expenses breakdown").toBeDefined();
    expect(payrollCategory!.totalMinor).toBe(payrollGroup.baseMinor);
    // Largest-expense ordering: nothing strictly larger than the top category, and
    // payroll ranks at or near the top of a services roster's spend.
    const rank = expenses.categories.findIndex((c) => c.source === "payroll");
    expect(rank).toBeGreaterThanOrEqual(0);
    expect(rank).toBeLessThan(3);

    // Exactly one payroll-tagged category — no duplicate vendor line for payroll.
    expect(expenses.categories.filter((c) => c.source === "payroll")).toHaveLength(1);
  });
});

describe("recurring detection", () => {
  /** Build an entity with a clean monthly vendor and a one-off, then detect. */
  async function setupRecurringFixture(t: TestConvex<typeof schema>) {
    const ids = await setupWorkspace(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      const entityId = await ctx.db.insert("entities", { workspaceId: ids.workspaceId, name: "Acme Studio LLC", slug: "acme-studio-llc", businessType: "services", currency: "USD", isDemo: true, createdAt: now, updatedAt: now });
      const software = await ctx.db.insert("ledgerAccounts", { entityId, number: "5200", name: "Software & SaaS", type: "expense", subtype: "software", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
      const bankLedger = await ctx.db.insert("ledgerAccounts", { entityId, number: "1010", name: "Operating Checking", type: "asset", subtype: "bank", currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
      const bankAccountId = await ctx.db.insert("bankAccounts", { entityId, ledgerAccountId: bankLedger, name: "Checking", mask: "1001", kind: "checking", balanceMinor: 1_000_000, includeInSync: true, createdAt: now, updatedAt: now });
      // 6 monthly Figma charges of ~$24 around the 8th, Jan–Jun 2026.
      const figmaMonths = ["2026-01-08", "2026-02-08", "2026-03-07", "2026-04-08", "2026-05-08", "2026-06-08"];
      figmaMonths.forEach((date, i) => {
        void ctx.db.insert("transactions", { entityId, bankAccountId, date, amountMinor: -(2400 + (i % 2 === 0 ? 0 : 50)), currency: "USD", merchant: "Figma", rawDescription: "Figma monthly", status: "posted", review: "confirmed", source: "bank", categoryAccountId: software, externalId: `figma-${i}`, evalSet: false, createdAt: now, updatedAt: now });
      });
      // A genuine one-off: single legal fee.
      void ctx.db.insert("transactions", { entityId, bankAccountId, date: "2026-04-12", amountMinor: -270_000, currency: "USD", merchant: "Counsel & Co", rawDescription: "MSA review", status: "posted", review: "confirmed", source: "bank", externalId: "oneoff-1", evalSet: false, createdAt: now, updatedAt: now });
      return entityId;
    });
    return ids;
  }

  it("catches a monthly vendor and ignores a one-off", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupRecurringFixture(t);
    const session = authed(t, ids.userId);
    const expenses = await session.query(api.expensesViews.overview, {});
    const vendors = expenses.recurring.map((row) => row.vendor);
    expect(vendors).toContain("Figma");
    expect(vendors).not.toContain("Counsel & Co");
    const figma = expenses.recurring.find((row) => row.vendor === "Figma")!;
    expect(figma.cadence).toBe("Monthly");
    expect(figma.averageMinor).toBeGreaterThan(2000);
    expect(figma.averageMinor).toBeLessThan(3000);
  });
});

describe("createCategory + recategorize", () => {
  it("creates a real 6xxx expense account usable for recategorization", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);
    const seed = await session.action(api.seedDemo.resetAndSeed, {});

    const created = await session.mutation(api.categories.createCategory, { entityId: seed.entityId, name: "Conferences & Events", group: "Expenses" });
    expect(created.number).toMatch(/^6\d{3}$/);
    expect(created.created).toBe(true);

    // Pick a needs-review transaction and recategorize it onto the new account.
    const txnId = await t.run(async (ctx) => {
      const txn = await ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", seed.entityId as Id<"entities">)).filter((q) => q.eq(q.field("review"), "needs_review")).first();
      return txn?._id ?? null;
    });
    expect(txnId).not.toBeNull();
    await session.mutation(api.categories.recategorizeTransaction, { transactionId: txnId!, categoryAccountId: created.accountId });
    const txn = await t.run(async (ctx) => ctx.db.get(txnId!));
    expect(txn?.categoryAccountId).toBe(created.accountId);
    expect(txn?.review).toBe("confirmed");
  });

  it("recategorizing a POSTED expense reverses + reposts the ledger (immutable, balanced, P&L moves)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);
    const seed = await session.action(api.seedDemo.resetAndSeed, {});

    // A confirmed expense transaction that already has a posted journal entry.
    const picked = await t.run(async (ctx) => {
      const txns = await ctx.db
        .query("transactions")
        .withIndex("by_entity", (q) => q.eq("entityId", seed.entityId as Id<"entities">))
        .collect();
      for (const txn of txns) {
        if (!txn.entryId || !txn.categoryAccountId || txn.amountMinor >= 0) continue;
        const account = await ctx.db.get(txn.categoryAccountId);
        if (account?.type === "expense") {
          return { txnId: txn._id, oldEntryId: txn.entryId, oldCategoryId: txn.categoryAccountId };
        }
      }
      return null;
    });
    expect(picked).not.toBeNull();

    // A fresh target category to move the spend onto.
    const target = await session.mutation(api.categories.createCategory, {
      entityId: seed.entityId,
      name: "Conferences & Events",
      group: "Expenses",
    });
    expect(target.accountId).not.toBe(picked!.oldCategoryId);

    const result = await session.mutation(api.categories.recategorizeTransaction, {
      transactionId: picked!.txnId,
      categoryAccountId: target.accountId,
    });
    expect(result.reposted).toBe(true);

    const after = await t.run(async (ctx) => {
      const txn = await ctx.db.get(picked!.txnId);
      // The original entry is untouched (immutable) and has been reversed by a
      // new entry whose reversesEntryId points back at it.
      const oldLines = await ctx.db
        .query("journalLines")
        .withIndex("by_entry", (q) => q.eq("entryId", picked!.oldEntryId))
        .collect();
      const reversal = await ctx.db
        .query("journalEntries")
        .withIndex("by_entity", (q) => q.eq("entityId", seed.entityId as Id<"entities">))
        .filter((q) => q.eq(q.field("reversesEntryId"), picked!.oldEntryId))
        .first();
      // The transaction repoints at a NEW entry whose lines hit the new category.
      const newLines = txn?.entryId
        ? await ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", txn.entryId!)).collect()
        : [];
      return {
        category: txn?.categoryAccountId,
        newEntryId: txn?.entryId,
        oldLineCount: oldLines.length,
        hasReversal: Boolean(reversal),
        newHitsTarget: newLines.some((line) => line.accountId === target.accountId),
        newHitsOld: newLines.some((line) => line.accountId === picked!.oldCategoryId),
        // Every entry still balances (debits == credits) across the books.
        balanced: await (async () => {
          const lines = await ctx.db
            .query("journalLines")
            .withIndex("by_entity", (q) => q.eq("entityId", seed.entityId as Id<"entities">))
            .collect();
          let d = 0;
          let c = 0;
          for (const line of lines) {
            d += line.debitMinor;
            c += line.creditMinor;
          }
          return d === c;
        })(),
      };
    });

    expect(after.category).toBe(target.accountId);
    expect(after.newEntryId).not.toBe(picked!.oldEntryId); // repointed, not mutated
    expect(after.oldLineCount).toBeGreaterThanOrEqual(2); // original entry preserved
    expect(after.hasReversal).toBe(true); // reverse posted
    expect(after.newHitsTarget).toBe(true); // repost hits the new category
    expect(after.newHitsOld).toBe(false); // the old category line is gone from the live entry
    expect(after.balanced).toBe(true); // whole ledger still balances
  });
});
