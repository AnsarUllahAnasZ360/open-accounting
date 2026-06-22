import { ConvexError, v } from "convex/values";

import { requireAnyWorkspaceRole } from "./authz";
import { postLedgerEntryCore } from "./ledger";
import { mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

// Dev-only Insights fixture (Epic E1 acceptance proof). Seeds a DISPOSABLE
// entity with deterministic, multi-day, multi-counterparty cash activity so the
// Transactions Insights craft (chart morph + unified tooltip + click-to-drill,
// the KPI band incl. Ending cash + Uncategorized, and counterparty chips) can be
// proven end-to-end by the e2e without depending on the demo seed or Bedrock.
//
// Posting discipline is fully respected: every categorized transaction posts a
// BALANCED journal entry through the one core posting path (`postLedgerEntryCore`,
// Σdebits = Σcredits). Uncategorized rows are left unposted (no entry, no
// category) so the Uncategorized KPI and its drill have real subjects. Gated to
// dev-auth mode and scoped to the caller's own workspace + chosen entity.
//
// E8-T6 — fixture fence + provenance contract:
//   - This module is the ONLY writer of fixture insight data and it HARD-THROWS
//     unless OPENBOOKS_DEV_AUTH_BYPASS === "1" (see the guard below). Proven by
//     insightsFixtures.test.ts.
//   - The data it writes is ordinary `transactions` + balanced `journalLines`
//     on a caller-chosen DISPOSABLE entity — there is NO fixture-only table and
//     NO fixture flag. The insights/banner read-models (coreViews / incomeViews
//     / expensesViews / moduleViews) query posted journal lines, invoices, and
//     bills generically; none of them import this module or branch on a fixture
//     marker, so a production-mode read can never surface fixture numbers.
//   - Per-page banner provenance (which read-model field feeds each line) is
//     documented in apps/web/src/components/openbooks/workbench/page-insights.ts.

type SeededRow = {
  externalId: string;
  date: string;
  merchant: string;
  amountMinor: number; // signed (positive = money in)
  contactName: string;
  categoryNumber?: string; // omit => left uncategorized + unposted
};

// June 2026 activity: three recurring counterparties, a mix of inflow/outflow
// across the month, plus two uncategorized rows. A lighter May 2026 set gives
// the "previous period" comparison real history (so the KPI deltas render with
// a named frame rather than being suppressed). Deterministic (no Date.now()).
const ROWS: SeededRow[] = [
  // --- May 2026 (the previous-period baseline). Smaller than June so the
  // June deltas are clearly positive. ---
  { externalId: "e1fx-may-01", date: "2026-05-06", merchant: "Northwind Retainer", amountMinor: 300_000, contactName: "Northwind Co", categoryNumber: "4100" },
  { externalId: "e1fx-may-02", date: "2026-05-09", merchant: "Operating Checking · Rent", amountMinor: -210_000, contactName: "Cedar Property Mgmt", categoryNumber: "5100" },
  { externalId: "e1fx-may-03", date: "2026-05-15", merchant: "Adobe Creative Cloud", amountMinor: -8_200, contactName: "Adobe", categoryNumber: "5200" },
  { externalId: "e1fx-may-04", date: "2026-05-22", merchant: "Harbor Studio Sale", amountMinor: 70_000, contactName: "Harbor Studio", categoryNumber: "4000" },
  // --- June 2026 (the active period). ---
  { externalId: "e1fx-01", date: "2026-06-02", merchant: "Northwind Retainer", amountMinor: 480_000, contactName: "Northwind Co", categoryNumber: "4100" },
  { externalId: "e1fx-02", date: "2026-06-04", merchant: "Operating Checking · Rent", amountMinor: -210_000, contactName: "Cedar Property Mgmt", categoryNumber: "5100" },
  { externalId: "e1fx-03", date: "2026-06-06", merchant: "Adobe Creative Cloud", amountMinor: -8_200, contactName: "Adobe", categoryNumber: "5200" },
  { externalId: "e1fx-04", date: "2026-06-09", merchant: "Northwind Retainer", amountMinor: 120_000, contactName: "Northwind Co", categoryNumber: "4100" },
  { externalId: "e1fx-05", date: "2026-06-11", merchant: "AWS", amountMinor: -34_500, contactName: "Amazon Web Services", categoryNumber: "5300" },
  { externalId: "e1fx-06", date: "2026-06-13", merchant: "Harbor Studio Sale", amountMinor: 96_000, contactName: "Harbor Studio", categoryNumber: "4000" },
  { externalId: "e1fx-07", date: "2026-06-16", merchant: "Adobe Creative Cloud", amountMinor: -8_200, contactName: "Adobe", categoryNumber: "5200" },
  { externalId: "e1fx-08", date: "2026-06-18", merchant: "Meridian Consulting", amountMinor: -52_000, contactName: "Meridian Consulting", categoryNumber: "5500" },
  { externalId: "e1fx-09", date: "2026-06-20", merchant: "Harbor Studio Sale", amountMinor: 64_000, contactName: "Harbor Studio", categoryNumber: "4000" },
  { externalId: "e1fx-10", date: "2026-06-23", merchant: "City Utilities", amountMinor: -14_300, contactName: "City Utilities", categoryNumber: "6100" },
  // Two unclassified rows — the Uncategorized KPI + drill subjects (unposted).
  // Dated EARLY in June (on/before mid-month) so they fall inside the live-clock
  // "this month to date" window the default Transactions register uses — the
  // banner's uncategorized signal must surface for any present-or-later June
  // clock, not only the old frozen 2026-06-30 anchor (E8 RC6 fix).
  { externalId: "e1fx-11", date: "2026-06-07", merchant: "Unlabeled ACH Deposit", amountMinor: 27_500, contactName: "Unlabeled ACH Deposit" },
  { externalId: "e1fx-12", date: "2026-06-08", merchant: "Pending Card Charge", amountMinor: -6_400, contactName: "Pending Card Charge" },
];

export const seedInsightsEntity = mutation({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    if (process.env.OPENBOOKS_DEV_AUTH_BYPASS !== "1") {
      throw new ConvexError("Insights fixtures are only available in dev-auth mode.");
    }
    const { userId, membership } = await requireAnyWorkspaceRole(ctx, "owner");
    const fetched = await ctx.db.get(args.entityId);
    if (!fetched || fetched.workspaceId !== membership.workspaceId) {
      throw new ConvexError("Choose an entity in this workspace.");
    }
    const entity: Doc<"entities"> = fetched;

    const accounts = await ctx.db
      .query("ledgerAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(500);
    const byNumber = new Map(accounts.map((account) => [account.number, account]));
    const checking = byNumber.get("1010"); // Operating Checking (bank/cash)
    if (!checking) {
      throw new ConvexError("Fixture needs the standard chart of accounts (account 1010).");
    }

    // A bank account linked to the cash ledger account so Ending cash resolves.
    const now = Date.now();
    const existingBank = await ctx.db
      .query("bankAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .first();
    if (!existingBank) {
      await ctx.db.insert("bankAccounts", {
        entityId: entity._id,
        ledgerAccountId: checking._id,
        name: "Operating Checking",
        mask: "0000",
        kind: "checking",
        balanceMinor: 0,
        includeInSync: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    const contactsByName = new Map<string, Id<"contacts">>();
    async function contactId(name: string): Promise<Id<"contacts">> {
      const cached = contactsByName.get(name);
      if (cached) return cached;
      const id = await ctx.db.insert("contacts", {
        entityId: entity._id,
        name,
        roles: ["vendor", "customer"],
        aliases: [],
        createdAt: now,
        updatedAt: now,
      });
      contactsByName.set(name, id);
      return id;
    }

    let posted = 0;
    let uncategorized = 0;
    for (const row of ROWS) {
      const contact = await contactId(row.contactName);
      const category = row.categoryNumber ? byNumber.get(row.categoryNumber) : undefined;

      let entryId: Id<"journalEntries"> | undefined;
      if (category) {
        // Balanced entry: cash debit/credit vs the income/expense account.
        const inflow = row.amountMinor > 0;
        const magnitude = Math.abs(row.amountMinor);
        const lines = inflow
          ? [
              { accountId: checking._id, debitMinor: magnitude, creditMinor: 0 },
              { accountId: category._id, debitMinor: 0, creditMinor: magnitude },
            ]
          : [
              { accountId: category._id, debitMinor: magnitude, creditMinor: 0 },
              { accountId: checking._id, debitMinor: 0, creditMinor: magnitude },
            ];
        const result = await postLedgerEntryCore(ctx, {
          entity,
          userId,
          date: row.date,
          memo: row.merchant,
          source: "manual",
          sourceId: row.externalId,
          lines,
          auditAction: "ledger.entry.posted",
        });
        entryId = result.entryId;
        posted += 1;
      } else {
        uncategorized += 1;
      }

      await ctx.db.insert("transactions", {
        entityId: entity._id,
        date: row.date,
        amountMinor: row.amountMinor,
        currency: entity.currency,
        merchant: row.merchant,
        rawDescription: row.merchant,
        status: entryId ? "posted" : "pending",
        review: entryId ? "auto" : "needs_review",
        source: "manual",
        ...(category ? { categoryAccountId: category._id } : {}),
        contactId: contact,
        ...(entryId ? { entryId } : {}),
        externalId: row.externalId,
        evalSet: false,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { entityId: entity._id, posted, uncategorized, total: ROWS.length };
  },
});
