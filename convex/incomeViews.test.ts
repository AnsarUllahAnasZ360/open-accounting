/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const TODAY = "2026-06-11";

async function setupWorkspace(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", { name: "Ansar's workspace", slug: "ansar-workspace", createdAt: now, updatedAt: now });
    await ctx.db.insert("workspaceMembers", { workspaceId, userId, role: "owner", status: "active", createdAt: now, updatedAt: now });
    return { userId, workspaceId };
  });
}

function authed(t: ReturnType<typeof convexTest>, userId: string) {
  return t.withIdentity({ subject: `${userId}|test-session`, tokenIdentifier: "test|owner", issuer: "test", email: "owner@example.com" });
}

describe("incomeViews KPIs reconcile with the report pack", () => {
  it("Still-open and receivables total equal the report pack AR aging", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);
    const seed = await session.action(api.seedDemo.resetAndSeed, {});

    const income = await session.query(api.incomeViews.overview, { entityId: seed.entityId });
    const pack = await session.query(api.reportViews.reportPack, {
      entityId: seed.entityId,
      startDate: "2025-06-11",
      endDate: TODAY,
      basis: "accrual",
      compare: "none",
      columnMode: "total",
    });

    // The receivables matrix total is the open A/R balance, which equals the
    // report pack AR aging total computed by the SAME aging function.
    expect(income.receivables.totalMinor).toBe(pack.arAging.totalMinor);
    expect(income.kpis.stillOpenMinor).toBe(pack.arAging.totalMinor);
    // Bucket subtotals match too (current / 1-30 / 31-60 / 61-90).
    expect(income.receivables.buckets.currentMinor).toBe(pack.arAging.buckets.currentMinor);
    expect(income.receivables.buckets.days30Minor).toBe(pack.arAging.buckets.days30Minor);
    expect(income.receivables.buckets.days60Minor).toBe(pack.arAging.buckets.days60Minor);
    expect(income.receivables.buckets.days90Minor).toBe(pack.arAging.buckets.days90Minor);
  });

  it("renders seeded payments, invoices, and a non-empty receivables matrix", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);
    const seed = await session.action(api.seedDemo.resetAndSeed, {});
    const income = await session.query(api.incomeViews.overview, { entityId: seed.entityId });
    expect(income.payments.length).toBeGreaterThan(0);
    expect(income.invoices.length).toBeGreaterThan(0);
    expect(income.invoiceCounts.all).toBe(income.invoices.length);
    expect(income.receivables.rows.length).toBeGreaterThan(0);
    expect(income.kpis.overdueMinor).toBeGreaterThan(0);
  });
});

describe("Income cash table never counts unpaid invoices (E2.1 correctness)", () => {
  it("an issued-but-unpaid invoice is absent from payments and does not inflate Received", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);

    // A fresh entity with NO cash movement and exactly one open (issued, unpaid)
    // invoice. Income = cash received, so Received must be 0 and payments empty;
    // the AR pipeline lives in the Invoices tab (stillOpen reflects the invoice).
    const entityId = await t.run(async (ctx) => {
      const now = Date.now();
      const eId = await ctx.db.insert("entities", { workspaceId: ids.workspaceId, name: "Cash Truth LLC", slug: "cash-truth-llc", businessType: "services", currency: "USD", isDemo: false, createdAt: now, updatedAt: now });
      const contactId = await ctx.db.insert("contacts", { entityId: eId, name: "Owes Us Inc", roles: ["customer"], aliases: [], createdAt: now, updatedAt: now });
      // Open invoice, NOT yet paid (amountPaidMinor 0), due within the period.
      await ctx.db.insert("invoices", { entityId: eId, contactId, number: "OB-2000", status: "open", currency: "USD", issueDate: "2026-06-01", dueDate: "2026-06-30", totalMinor: 500_000, amountPaidMinor: 0, entryIds: [], createdAt: now, updatedAt: now });
      return eId;
    });

    const income = await session.query(api.incomeViews.overview, {
      entityId: entityId as Id<"entities">,
      range: { start: "2026-06-01", end: "2026-06-30" },
    });

    // The cash table (payments) is empty: an unpaid invoice is NOT cash received.
    expect(income.payments.length).toBe(0);
    // The Income KPI (Received this period) is exactly zero — the open invoice
    // never inflates it.
    expect(income.kpis.receivedThisMonthMinor).toBe(0);
    expect(income.kpis.paymentCount).toBe(0);
    // The invoice IS visible in the AR pipeline (Invoices tab) and its balance
    // is the open receivable, not income.
    expect(income.invoices.length).toBe(1);
    expect(income.invoices[0].balanceMinor).toBe(500_000);
    expect(income.kpis.stillOpenMinor).toBe(500_000);
  });

  it("recording a payment moves the money from AR into the cash table", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);
    const seed = await session.action(api.seedDemo.resetAndSeed, {});

    // Compose + finalize a disposable invoice on the seeded entity, then record
    // a full payment. Before: it sits in AR (Invoices), not in Received. After:
    // the cash lands in the ledger and the invoice reads paid with a 0 balance.
    const draft = await session.mutation(api.invoices.saveDraft, {
      entityId: seed.entityId,
      customerName: "E2 Cash Proof Co",
      lineItems: [{ description: "Consulting", quantity: 1, unitAmountMinor: 250_000 }],
      issueDate: "2026-06-05",
      dueDate: "2026-06-20",
    });
    await session.mutation(api.invoices.finalize, { invoiceId: draft.invoiceId });

    const before = await session.query(api.invoices.detail, { invoiceId: draft.invoiceId });
    expect(before?.status === "open" || before?.status === "overdue").toBe(true);
    expect(before?.balanceMinor).toBe(250_000);

    const payment = await session.mutation(api.invoices.recordPayment, { invoiceId: draft.invoiceId });
    expect(payment.status).toBe("paid");
    expect(payment.balanceMinor).toBe(0);
    expect(payment.paidMinor).toBe(250_000);

    const after = await session.query(api.invoices.detail, { invoiceId: draft.invoiceId });
    expect(after?.status).toBe("paid");
    expect(after?.balanceMinor).toBe(0);
    expect(after?.amountPaidMinor).toBe(250_000);

    // The recorded payment now appears in the Income cash table for the period
    // it posted in, and is counted as cash received — money in, exactly once.
    const income = await session.query(api.incomeViews.overview, {
      entityId: seed.entityId,
      range: { start: "2026-06-01", end: "2026-06-30" },
    });
    const paymentRow = income.payments.find((row) => row.memo.includes(draft.number));
    expect(paymentRow).toBeTruthy();
    expect(paymentRow?.amountMinor).toBe(250_000);
    expect(paymentRow?.kind).toBe("payment");
  });

  it("settling an invoice against a matched bank deposit counts the money exactly once", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);
    const seed = await session.action(api.seedDemo.resetAndSeed, {});

    // Finalize a disposable invoice, then settle it against an INCOMING bank
    // deposit (the reconcile path). recordPayment posts Dr Bank/Cr A/R AND marks
    // the deposit confirmed + categorized to A/R. The cash table must surface the
    // settlement exactly once — the consumed deposit must NOT also appear as raw
    // income (the latent double-count this guards against).
    const draft = await session.mutation(api.invoices.saveDraft, {
      entityId: seed.entityId,
      customerName: "Reconcile Once Co",
      lineItems: [{ description: "Build", quantity: 1, unitAmountMinor: 321_000 }],
      issueDate: "2026-06-05",
      dueDate: "2026-06-20",
    });
    await session.mutation(api.invoices.finalize, { invoiceId: draft.invoiceId });

    // Seed an unreconciled incoming bank deposit for the same amount + period.
    const depositTxnId = await t.run(async (ctx) => {
      const entity = await ctx.db.get(seed.entityId);
      const bank = await ctx.db
        .query("bankAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", seed.entityId))
        .first();
      const now = Date.now();
      return await ctx.db.insert("transactions", {
        entityId: seed.entityId,
        bankAccountId: bank?._id,
        date: "2026-06-12",
        amountMinor: 321_000,
        currency: entity!.currency,
        merchant: "Reconcile Once Co",
        rawDescription: "ACH deposit — Reconcile Once Co",
        status: "posted",
        review: "needs_review",
        source: "bank",
        externalId: `e2-recon-${now}`,
        evalSet: false,
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await session.mutation(api.invoices.recordPayment, {
      invoiceId: draft.invoiceId,
      transactionId: depositTxnId,
    });
    expect(result.status).toBe("paid");
    expect(result.consumedTransactionId).toBe(depositTxnId);

    const income = await session.query(api.incomeViews.overview, {
      entityId: seed.entityId,
      range: { start: "2026-06-01", end: "2026-06-30" },
    });

    // The settlement appears exactly once — as a single invoice-payment row.
    const settlementRows = income.payments.filter(
      (row) => row.amountMinor === 321_000 && row.fromName === "Reconcile Once Co",
    );
    expect(settlementRows.length).toBe(1);
    expect(settlementRows[0]?.kind).toBe("payment");
    // The consumed deposit txn is NOT independently surfaced as raw income.
    expect(income.payments.some((row) => row.transactionId === depositTxnId)).toBe(false);
  });
});

describe("AR aging bucket boundaries (0 / 30 / 31 / 61 days)", () => {
  it("places invoices in the correct bucket at each boundary", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);

    // Build an entity with four open invoices, one per boundary, measured
    // against TODAY = 2026-06-11.
    const entityId = await t.run(async (ctx) => {
      const now = Date.now();
      const eId = await ctx.db.insert("entities", { workspaceId: ids.workspaceId, name: "Acme Studio LLC", slug: "acme-studio-llc", businessType: "services", currency: "USD", isDemo: true, createdAt: now, updatedAt: now });
      const contactId = await ctx.db.insert("contacts", { entityId: eId, name: "Edge Cases Inc", roles: ["customer"], aliases: [], createdAt: now, updatedAt: now });
      const mkInvoice = (number: string, dueDate: string) =>
        ctx.db.insert("invoices", { entityId: eId, contactId, number, status: "open", currency: "USD", issueDate: "2026-01-01", dueDate, totalMinor: 100_000, amountPaidMinor: 0, entryIds: [], createdAt: now, updatedAt: now });
      await mkInvoice("DUE-0", "2026-06-11"); // 0 days  -> current
      await mkInvoice("DUE-30", "2026-05-12"); // 30 days -> 1-30
      await mkInvoice("DUE-31", "2026-05-11"); // 31 days -> 31-60
      await mkInvoice("DUE-61", "2026-04-11"); // 61 days -> 61-90+
      return eId;
    });

    const income = await session.query(api.incomeViews.overview, { entityId: entityId as Id<"entities"> });
    const b = income.receivables.buckets;
    expect(b.currentMinor).toBe(100_000); // the 0-day invoice
    expect(b.days30Minor).toBe(100_000); // the 30-day invoice
    expect(b.days60Minor).toBe(100_000); // the 31-day invoice
    expect(b.days90Minor).toBe(100_000); // the 61-day invoice
    expect(income.receivables.totalMinor).toBe(400_000);
  });
});
