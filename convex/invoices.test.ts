/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Minimal entity with the chart accounts the invoice flow posts to (AR 1100,
 * Services 4100) plus one customer contact. USD keeps the assertions about
 * balanced entries free of FX noise.
 */
async function setup(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar's workspace",
      slug: "ansar-workspace",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", { workspaceId, userId, role: "owner", status: "active", createdAt: now, updatedAt: now });
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
    const account = (number: string, name: string, type: "asset" | "income") =>
      ctx.db.insert("ledgerAccounts", { entityId, number, name, type, subtype: type, currency: "USD", isSystem: false, archived: false, createdAt: now, updatedAt: now });
    const arId = await account("1100", "Accounts Receivable", "asset");
    const incomeId = await account("4100", "Services", "income");
    const contactId = await ctx.db.insert("contacts", { entityId, name: "Tonal Labs", roles: ["customer"], aliases: [], createdAt: now, updatedAt: now });
    return { userId, entityId, arId, incomeId, contactId };
  });
}

function authed(t: TestConvex<typeof schema>, userId: string) {
  return t.withIdentity({ subject: `${userId}|test-session`, tokenIdentifier: "test|owner", issuer: "test", email: "owner@example.com" });
}

async function entryLines(t: TestConvex<typeof schema>, entryId: string) {
  return await t.run(async (ctx) => ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", entryId as Id<"journalEntries">)).collect());
}

async function journalCount(t: TestConvex<typeof schema>, entityId: string) {
  return await t.run(async (ctx) => (await ctx.db.query("journalEntries").withIndex("by_entity", (q) => q.eq("entityId", entityId as Id<"entities">)).collect()).length);
}

describe("invoices.saveDraft / finalize / void", () => {
  it("saveDraft creates a draft and posts NOTHING to the ledger", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    const draft = await session.mutation(api.invoices.saveDraft, {
      entityId: ids.entityId,
      contactId: ids.contactId,
      lineItems: [
        { description: "Design retainer", quantity: 1, unitAmountMinor: 420_000 },
        { description: "Audit", quantity: 1, unitAmountMinor: 180_000 },
      ],
      dueDate: "2026-07-11",
    });
    expect(draft.totalMinor).toBe(600_000);
    expect(draft.number).toMatch(/^OB-\d+$/);

    // No journal entries exist — drafts never post.
    expect(await journalCount(t, ids.entityId)).toBe(0);
    const row = await t.run(async (ctx) => ctx.db.get(draft.invoiceId));
    expect(row?.status).toBe("draft");
    expect(row?.entryIds).toHaveLength(0);
  });

  it("saveDraft can update an existing draft's line items without posting", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);
    const draft = await session.mutation(api.invoices.saveDraft, {
      entityId: ids.entityId,
      contactId: ids.contactId,
      lineItems: [{ description: "One line", quantity: 1, unitAmountMinor: 100_000 }],
    });
    const updated = await session.mutation(api.invoices.saveDraft, {
      entityId: ids.entityId,
      invoiceId: draft.invoiceId,
      contactId: ids.contactId,
      lineItems: [{ description: "Two", quantity: 2, unitAmountMinor: 150_000 }],
    });
    expect(updated.totalMinor).toBe(300_000);
    expect(await journalCount(t, ids.entityId)).toBe(0);
  });

  it("finalize posts a balanced AR debit / income credit entry", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);
    const draft = await session.mutation(api.invoices.saveDraft, {
      entityId: ids.entityId,
      contactId: ids.contactId,
      lineItems: [{ description: "Project", quantity: 1, unitAmountMinor: 500_000 }],
      issueDate: "2026-06-01",
      dueDate: "2026-07-01",
    });
    const finalized = await session.mutation(api.invoices.finalize, { invoiceId: draft.invoiceId });
    expect(finalized.balanceMinor).toBe(500_000);

    const lines = await entryLines(t, finalized.entryId);
    expect(lines).toHaveLength(2);
    const debit = lines.reduce((s, l) => s + l.debitMinor, 0);
    const credit = lines.reduce((s, l) => s + l.creditMinor, 0);
    expect(debit).toBe(credit); // balanced
    expect(debit).toBe(500_000);
    expect(lines.find((l) => l.accountId === ids.arId)?.debitMinor).toBe(500_000);
    expect(lines.find((l) => l.accountId === ids.incomeId)?.creditMinor).toBe(500_000);

    const row = await t.run(async (ctx) => ctx.db.get(draft.invoiceId));
    expect(row?.status).toBe("open");
  });

  it("void reverses the accrual exactly and leaves the trial balance at zero", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);
    const draft = await session.mutation(api.invoices.saveDraft, {
      entityId: ids.entityId,
      contactId: ids.contactId,
      lineItems: [{ description: "Project", quantity: 1, unitAmountMinor: 250_000 }],
    });
    await session.mutation(api.invoices.finalize, { invoiceId: draft.invoiceId });
    const voided = await session.mutation(api.invoices.voidInvoice, { invoiceId: draft.invoiceId });
    expect(voided.reversedCount).toBe(1);

    const tb = await t.run(async (ctx) => {
      const lines = await ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect();
      return { debit: lines.reduce((s, l) => s + l.debitMinor, 0), credit: lines.reduce((s, l) => s + l.creditMinor, 0) };
    });
    expect(tb.debit).toBe(tb.credit);
    // After void: AR net zero (debit then credit), income net zero.
    const arNet = await t.run(async (ctx) => {
      const lines = await ctx.db.query("journalLines").withIndex("by_account", (q) => q.eq("accountId", ids.arId)).collect();
      return lines.reduce((s, l) => s + l.debitMinor - l.creditMinor, 0);
    });
    expect(arNet).toBe(0);
    const row = await t.run(async (ctx) => ctx.db.get(draft.invoiceId));
    expect(row?.status).toBe("void");
  });

  it("cannot finalize an already-finalized invoice", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);
    const draft = await session.mutation(api.invoices.saveDraft, {
      entityId: ids.entityId,
      contactId: ids.contactId,
      lineItems: [{ description: "x", quantity: 1, unitAmountMinor: 100_000 }],
    });
    await session.mutation(api.invoices.finalize, { invoiceId: draft.invoiceId });
    await expect(session.mutation(api.invoices.finalize, { invoiceId: draft.invoiceId })).rejects.toThrow();
  });

  it("inline-creates a new customer contact when none is supplied", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);
    const draft = await session.mutation(api.invoices.saveDraft, {
      entityId: ids.entityId,
      customerName: "Brand New Customer",
      lineItems: [{ description: "x", quantity: 1, unitAmountMinor: 100_000 }],
    });
    const row = await t.run(async (ctx) => ctx.db.get(draft.invoiceId));
    const contact = await t.run(async (ctx) => ctx.db.get(row!.contactId));
    expect(contact?.name).toBe("Brand New Customer");
    expect(contact?.roles).toContain("customer");
  });

  it("rejects cross-workspace finalize", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);
    const draft = await session.mutation(api.invoices.saveDraft, {
      entityId: ids.entityId,
      contactId: ids.contactId,
      lineItems: [{ description: "x", quantity: 1, unitAmountMinor: 100_000 }],
    });
    // A second user in a different workspace must not finalize it.
    const otherUserId = await t.run(async (ctx) => {
      const now = Date.now();
      const uid = await ctx.db.insert("users", { email: "intruder@example.com", name: "Intruder" });
      const wsId = await ctx.db.insert("workspaces", { name: "Other", slug: "other-ws", createdAt: now, updatedAt: now });
      await ctx.db.insert("workspaceMembers", { workspaceId: wsId, userId: uid, role: "owner", status: "active", createdAt: now, updatedAt: now });
      return uid;
    });
    const intruder = t.withIdentity({ subject: `${otherUserId}|s`, tokenIdentifier: "test|intruder", issuer: "test", email: "intruder@example.com" });
    await expect(intruder.mutation(api.invoices.finalize, { invoiceId: draft.invoiceId })).rejects.toThrow();
  });
});
