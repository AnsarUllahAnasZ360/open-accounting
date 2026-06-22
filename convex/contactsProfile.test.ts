/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupWorkspace(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
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
    return { userId, workspaceId };
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

describe("E4 per-contact profile + statements", () => {
  it("derives an un-netted profile, ledger-tied timeline, and statements", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);
    await session.action(api.seedDemo.resetAndSeed, {});

    const overview = await session.query(api.moduleViews.overview, {});
    // Pick a customer that currently has an open receivable.
    const target = overview.contacts.rows.find(
      (row) => row.roles.includes("customer") && row.openReceivableMinor > 0,
    );
    expect(target, "expected a customer with open A/R in the seed").toBeDefined();
    const contactId = target!.id;

    const profile = await session.query(api.contacts.contactProfile, { contactId });
    expect(profile).not.toBeNull();
    expect(profile!.id).toBe(contactId);

    // KPIs are reported SEPARATELY, never netted, and reconcile to the directory.
    expect(profile!.kpis.openReceivableMinor).toBe(target!.openReceivableMinor);
    expect(profile!.kpis.openPayableMinor).toBe(target!.openPayableMinor);
    // A customer's open A/R is reported on its own line (not collapsed with A/P).
    expect(profile!.kpis.openReceivableMinor).toBeGreaterThan(0);

    // The activity timeline is non-empty and every row carries posted entry ids
    // (ledger-tied) and a running balance on the correct side.
    expect(profile!.timeline.length).toBeGreaterThan(0);
    for (const row of profile!.timeline) {
      expect(Array.isArray(row.entryIds)).toBe(true);
      if (row.side === "receivable") {
        expect(typeof row.runningReceivableMinor).toBe("number");
      } else {
        expect(typeof row.runningPayableMinor).toBe("number");
      }
    }

    // Open items include this contact's open invoice(s) on the receivable side.
    expect(profile!.openItems.some((item) => item.side === "receivable" && item.balanceMinor > 0)).toBe(true);

    // Owner (admin-tier) sees the bank-details capability flag true.
    expect(profile!.canSeeBankDetails).toBe(true);

    // Open-item statement closing balance equals the open receivable — a direct
    // tie between the collections statement and the ledger-backed A/R.
    const openItem = await session.query(api.contacts.contactStatement, {
      contactId,
      mode: "open-item",
      from: "2026-01-01",
      to: "2026-06-11",
      side: "receivable",
    });
    expect(openItem).not.toBeNull();
    expect(openItem!.side).toBe("receivable");
    expect(openItem!.closingBalanceMinor).toBe(target!.openReceivableMinor);
    // Every statement line ties to at least one posted journal entry.
    for (const line of openItem!.lines) {
      expect(line.entryIds.length).toBeGreaterThan(0);
    }

    // Balance-forward statement: closing = opening + charges − payments (the
    // double-entry invariant the running balance must preserve).
    const bf = await session.query(api.contacts.contactStatement, {
      contactId,
      mode: "balance-forward",
      from: "2026-01-01",
      to: "2026-06-11",
      side: "receivable",
    });
    expect(bf).not.toBeNull();
    const expectedClosing =
      bf!.openingBalanceMinor + bf!.totalChargesMinor - bf!.totalPaymentsMinor;
    expect(bf!.closingBalanceMinor).toBe(expectedClosing);
  });

  it("statement totals reconcile to the POSTED journalLines (ledger-tied)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);
    const seed = await session.action(api.seedDemo.resetAndSeed, {});
    const entityId = seed.entityId;

    const overview = await session.query(api.moduleViews.overview, {});

    // ---- A/R side: a customer with open receivable -----------------------
    const customer = overview.contacts.rows.find(
      (row) => row.roles.includes("customer") && row.openReceivableMinor > 0,
    );
    expect(customer, "expected a customer with open A/R in the seed").toBeDefined();

    // Read the POSTED journal lines directly and compute, FROM THE LEDGER, the
    // A/R (1100) control-account outstanding for THIS customer's open invoices.
    // This is the independent ground truth the statement must tie to.
    const arGroundTruth = await t.run(async (ctx) => {
      const accounts = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .collect();
      const arId = accounts.find((a) => a.number === "1100")!._id;
      const invoices = await ctx.db
        .query("invoices")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .collect();
      const open = invoices.filter(
        (i) => i.contactId === customer!.id && (i.status === "open" || i.status === "overdue"),
      );
      let net = 0; // Σ(AR debits − AR credits) across the open invoices' posted entries
      for (const invoice of open) {
        for (const entryId of invoice.entryIds) {
          const lines = await ctx.db
            .query("journalLines")
            .withIndex("by_entry", (q) => q.eq("entryId", entryId))
            .collect();
          for (const line of lines) {
            if (line.accountId === arId) net += line.debitMinor - line.creditMinor;
          }
        }
      }
      return net;
    });
    // The directory figure and the raw-ledger figure must already agree.
    expect(arGroundTruth).toBe(customer!.openReceivableMinor);

    // Open-item (collections) closing balance == the A/R outstanding read from
    // journalLines == the directory's open receivable. A direct ledger tie.
    const arOpenItem = await session.query(api.contacts.contactStatement, {
      contactId: customer!.id,
      mode: "open-item",
      from: "2026-01-01",
      to: "2026-06-11",
      side: "receivable",
    });
    expect(arOpenItem).not.toBeNull();
    expect(arOpenItem!.closingBalanceMinor).toBe(arGroundTruth);
    // The aging buckets sum to the same outstanding total (no rounding drift).
    expect(arOpenItem!.aging!.totalMinor).toBe(arGroundTruth);
    // Every collections line is backed by at least one posted journal entry.
    for (const line of arOpenItem!.lines) {
      expect(line.entryIds.length).toBeGreaterThan(0);
    }

    // Balance-forward: opening + charges − payments == closing, AND the charges
    // and payments equal the A/R control-account debits/credits posted in the
    // window — proving the running balance is the ledger's, not the document's.
    const arBf = await session.query(api.contacts.contactStatement, {
      contactId: customer!.id,
      mode: "balance-forward",
      from: "2026-01-01",
      to: "2026-06-11",
      side: "receivable",
    });
    expect(arBf).not.toBeNull();
    expect(arBf!.openingBalanceMinor + arBf!.totalChargesMinor - arBf!.totalPaymentsMinor).toBe(
      arBf!.closingBalanceMinor,
    );
    const arWindowLedger = await t.run(async (ctx) => {
      const accounts = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .collect();
      const arId = accounts.find((a) => a.number === "1100")!._id;
      const invoices = await ctx.db
        .query("invoices")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .collect();
      const mine = invoices.filter((i) => i.contactId === customer!.id && i.status !== "draft");
      let debits = 0;
      let credits = 0;
      for (const invoice of mine) {
        for (const entryId of invoice.entryIds) {
          const entry = await ctx.db.get(entryId);
          if (!entry || entry.date < "2026-01-01" || entry.date > "2026-06-11") continue;
          const lines = await ctx.db
            .query("journalLines")
            .withIndex("by_entry", (q) => q.eq("entryId", entryId))
            .collect();
          for (const line of lines) {
            if (line.accountId !== arId) continue;
            debits += line.debitMinor;
            credits += line.creditMinor;
          }
        }
      }
      return { debits, credits };
    });
    expect(arBf!.totalChargesMinor).toBe(arWindowLedger.debits);
    expect(arBf!.totalPaymentsMinor).toBe(arWindowLedger.credits);

    // ---- A/P side: a vendor with open payable ----------------------------
    const vendor = overview.contacts.rows.find(
      (row) => row.roles.includes("vendor") && row.openPayableMinor > 0,
    );
    expect(vendor, "expected a vendor with open A/P in the seed").toBeDefined();

    const apGroundTruth = await t.run(async (ctx) => {
      const accounts = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .collect();
      const apId = accounts.find((a) => a.number === "2100")!._id;
      const bills = await ctx.db
        .query("bills")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .collect();
      const open = bills.filter((b) => b.contactId === vendor!.id && b.status === "open");
      let net = 0; // A/P is a liability: Σ(credits − debits)
      for (const bill of open) {
        for (const entryId of bill.entryIds) {
          const lines = await ctx.db
            .query("journalLines")
            .withIndex("by_entry", (q) => q.eq("entryId", entryId))
            .collect();
          for (const line of lines) {
            if (line.accountId === apId) net += line.creditMinor - line.debitMinor;
          }
        }
      }
      return net;
    });
    expect(apGroundTruth).toBe(vendor!.openPayableMinor);

    const apOpenItem = await session.query(api.contacts.contactStatement, {
      contactId: vendor!.id,
      mode: "open-item",
      from: "2026-01-01",
      to: "2026-06-11",
      side: "payable",
    });
    expect(apOpenItem).not.toBeNull();
    expect(apOpenItem!.side).toBe("payable");
    expect(apOpenItem!.closingBalanceMinor).toBe(apGroundTruth);
    expect(apOpenItem!.aging!.totalMinor).toBe(apGroundTruth);
  });

  it("creates a contact with roles + default category, reusable immediately", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);
    const seed = await session.action(api.seedDemo.resetAndSeed, {});

    // Resolve an expense category in the seeded chart to bind as the default.
    const categories = await session.query(api.categories.list, { entityId: seed.entityId });
    const expense = categories.groups.find((g) => g.label === "Expenses")?.cats[0];
    expect(expense, "expected at least one expense category in the seed").toBeDefined();

    const created = await session.mutation(api.contacts.createContact, {
      entityId: seed.entityId,
      name: "Northwind Test Co",
      roles: ["customer", "vendor"],
      email: "ap@northwind.test",
      defaultCategoryId: expense!.id,
    });
    expect(created.contactId).toBeTruthy();

    // It appears immediately in the directory with both roles + the category.
    const overview = await session.query(api.moduleViews.overview, {});
    const row = overview.contacts.rows.find((r) => r.id === created.contactId);
    expect(row).toBeDefined();
    expect(row!.roles.sort()).toEqual(["customer", "vendor"]);
    expect(row!.defaultCategory?.id).toBe(expense!.id);

    // The profile endpoint resolves the new contact too.
    const profile = await session.query(api.contacts.contactProfile, { contactId: created.contactId });
    expect(profile!.name).toBe("Northwind Test Co");
    expect(profile!.defaultCategory?.id).toBe(expense!.id);
  });

  it("hides bank details from non-admin members", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const owner = authed(t, ids.userId);
    const seed = await owner.action(api.seedDemo.resetAndSeed, {});

    const created = await owner.mutation(api.contacts.createContact, {
      entityId: seed.entityId,
      name: "Bank Detail Vendor",
      roles: ["vendor"],
    });
    await owner.mutation(api.contacts.setBankDetails, {
      contactId: created.contactId,
      bankDetails: "Routing 021000021 · Acct ••4321",
    });

    // Owner sees the value.
    const asOwner = await owner.query(api.contacts.contactProfile, { contactId: created.contactId });
    expect(asOwner!.canSeeBankDetails).toBe(true);
    expect(asOwner!.bankDetails).toContain("4321");

    // A plain member is blocked from setting it and never receives the value.
    const memberId = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { email: "member@example.com", name: "Member" });
      await ctx.db.insert("workspaceMembers", {
        workspaceId: ids.workspaceId,
        userId: uid,
        role: "member",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return uid;
    });
    const member = t.withIdentity({
      subject: `${memberId}|test-session`,
      tokenIdentifier: "test|member",
      issuer: "test",
      email: "member@example.com",
    });

    const asMember = await member.query(api.contacts.contactProfile, { contactId: created.contactId });
    expect(asMember!.canSeeBankDetails).toBe(false);
    expect(asMember!.bankDetails).toBeNull();
    await expect(
      member.mutation(api.contacts.setBankDetails, { contactId: created.contactId, bankDetails: "leak" }),
    ).rejects.toThrow();
  });
});
