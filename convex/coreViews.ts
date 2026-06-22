import { v } from "convex/values";

import { getActiveEntity } from "./activeEntity";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";
import { computeEntityMetrics, type EntityMetrics } from "./entityMetrics";
import { assertScopeAuthorized, scopeValidator, type Scope } from "./entityScope";
import { buildProvenance } from "./lib/provenance";
import { normalizeMerchantKey } from "./pipeline";
import { sumUsdMinor } from "./portfolioMoney";
import { computeUnreviewedGap } from "./unreviewedGap";

type Balance = {
  debitMinor: number;
  creditMinor: number;
};

// Number of trailing months the dashboard cash-flow trend spans (inclusive of
// the current server month). Previously this was a frozen 2025-07…2026-06 array
// that went stale the moment real "today" moved past it (E1-T11 / RC6).
const TREND_WINDOW_MONTHS = 12;

function addBalance(map: Map<Id<"ledgerAccounts">, Balance>, line: Doc<"journalLines">) {
  const current = map.get(line.accountId) ?? { debitMinor: 0, creditMinor: 0 };
  current.debitMinor += line.debitMinor;
  current.creditMinor += line.creditMinor;
  map.set(line.accountId, current);
}

function normalBalance(account: Doc<"ledgerAccounts">, balance: Balance) {
  if (account.type === "asset" || account.type === "expense") {
    return balance.debitMinor - balance.creditMinor;
  }
  return balance.creditMinor - balance.debitMinor;
}

function signedTransactionAmount(transaction: Doc<"transactions">) {
  return transaction.amountMinor;
}

function monthLabel(month: string) {
  return month.slice(5);
}

// Deterministic ISO-date <-> UTC-millis helpers. Built from explicit components
// (never `new Date()`/`Date.now()`), so they're safe inside a Convex query and
// let the insights aggregate derive an equal-length "previous period" window.
function isoToUtc(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function utcToIso(ms: number) {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

// Whole-day difference a − b (positive when ISO date `a` is after `b`).
function dateDiffDays(a: string, b: string) {
  return Math.round((isoToUtc(a) - isoToUtc(b)) / 86_400_000);
}

// Shift a "YYYY-MM" key by whole months, deterministically (never `Date.now()`).
function shiftMonth(month: string, delta: number) {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Last calendar day (ISO) of a "YYYY-MM" key.
function endOfMonthIso(month: string) {
  const [year, m] = month.split("-").map(Number);
  const day = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

// "YYYY-MM" of the month containing an ISO date. Pure string slice.
function monthOfIso(iso: string) {
  return iso.slice(0, 7);
}

// The server-clock "today" (ISO YYYY-MM-DD). Callers may pass an explicit
// `today` so tests are deterministic; otherwise we read the request-time clock.
// Convex evaluates `Date.now()` once per query and pins it, so this stays
// deterministic within a single read (E1-T11).
function resolveToday(explicit?: string) {
  if (explicit && /^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  return new Date(Date.now()).toISOString().slice(0, 10);
}

// Trailing window of `count` "YYYY-MM" keys ending at (and including) the month
// of `today`. Replaces the old frozen literal array so the dashboard trend
// always ends at the current server month (E1-T11 / RC6).
function trailingMonthWindow(today: string, count: number) {
  const endMonth = monthOfIso(today);
  return Array.from({ length: count }, (_, index) => shiftMonth(endMonth, index - (count - 1)));
}

const DASHBOARD_LIMIT = 5000;
// Cap journal loading by ENTRY (not by flat row) so the dashboard, like the
// reports (E1-T5 / RC5), can never drop one leg of a balanced posting.
const DASHBOARD_ENTRY_LIMIT = 20000;
const CASH_SUBTYPES = new Set(["bank", "cash", "checking", "savings"]);

function combinedRunwayDays(rows: EntityMetrics[]): number | null {
  const combinedCash = sumUsdMinor(rows.map((row) => row.cashMinor));
  if (combinedCash <= 0) return null;
  let combinedMonthlyBurnMinor = 0;
  for (const row of rows) {
    if (row.runwayDays == null || row.runwayDays <= 0) continue;
    combinedMonthlyBurnMinor += Math.round((row.cashMinor / row.runwayDays) * 30);
  }
  if (combinedMonthlyBurnMinor <= 0) return null;
  return Math.round((combinedCash / combinedMonthlyBurnMinor) * 30);
}

function combineEntityMetrics(rows: EntityMetrics[], fallbackEntityId: Id<"entities">): EntityMetrics {
  return {
    entityId: fallbackEntityId,
    name: "All businesses",
    currency: "USD",
    cashMinor: sumUsdMinor(rows.map((row) => row.cashMinor)),
    arMinor: sumUsdMinor(rows.map((row) => row.arMinor)),
    apMinor: sumUsdMinor(rows.map((row) => row.apMinor)),
    revenueMinor: sumUsdMinor(rows.map((row) => row.revenueMinor)),
    expenseMinor: sumUsdMinor(rows.map((row) => row.expenseMinor)),
    runwayDays: combinedRunwayDays(rows),
    truncated: rows.some((row) => row.truncated),
  };
}

/**
 * Load every journal entry for an entity plus all of their lines, whole-entry
 * via the `by_entry` index, so an entry's debit and credit legs are always
 * loaded together (never split by a flat `.take`). Mirrors the reports loader
 * so dashboard totals match report totals on a large book (E1-T5).
 */
async function loadDashboardJournal(
  ctx: QueryCtx,
  entityId: Id<"entities">,
): Promise<{ entries: Doc<"journalEntries">[]; lines: Doc<"journalLines">[]; truncated: boolean }> {
  const fetched = await ctx.db
    .query("journalEntries")
    .withIndex("by_entity_and_date", (q) => q.eq("entityId", entityId))
    .take(DASHBOARD_ENTRY_LIMIT + 1);
  const truncated = fetched.length > DASHBOARD_ENTRY_LIMIT;
  const entries = truncated ? fetched.slice(0, DASHBOARD_ENTRY_LIMIT) : fetched;
  const lineGroups = await Promise.all(
    entries.map((entry) =>
      ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", entry._id)).collect(),
    ),
  );
  return { entries, lines: lineGroups.flat(), truncated };
}

export const dashboard = query({
  args: {
    entityId: v.optional(v.id("entities")),
    scope: v.optional(scopeValidator),
    // Period selector. "YYYY-MM" scopes the P&L snapshot, expense breakdown,
    // income-by-customer, and payroll widgets so the selector drives EVERY
    // period-sensitive widget instead of being decorative.
    period: v.optional(v.string()),
    // Optional server-clock anchor (ISO YYYY-MM-DD). Lets the caller pin "today"
    // for deterministic tests; production omits it and the request-time clock is
    // used. The trailing cash-flow window always ENDS at this month (E1-T11).
    today: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let entities: Doc<"entities">[];
    const scopedArg: Scope | undefined = args.scope;
    const isPortfolioScope = scopedArg === "all" && !args.entityId;

    if (isPortfolioScope) {
      const { membership } = await requireAnyWorkspaceRole(ctx, "member");
      entities = await assertScopeAuthorized(ctx, membership, "all");
      for (const scopedEntity of entities) {
        await requireWorkspaceRole(ctx, scopedEntity.workspaceId, "member");
      }
    } else if (scopedArg && scopedArg !== "all") {
      const { membership } = await requireAnyWorkspaceRole(ctx, "member");
      entities = await assertScopeAuthorized(ctx, membership, scopedArg);
      for (const scopedEntity of entities) {
        await requireWorkspaceRole(ctx, scopedEntity.workspaceId, "member");
      }
    } else {
      const entity = await getActiveEntity(ctx, args.entityId);
      entities = entity ? [entity] : [];
    }
    if (entities.length === 0) return null;

    const orderedEntities = entities
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id));
    const entity = orderedEntities[0]!;
    const entityIds = orderedEntities.map((scopedEntity) => scopedEntity._id);

    // Server-clock window (E1-T11 / RC6). No frozen year/month literals remain:
    // the trailing trend window ends at the current server month and the period
    // selector defaults to the latest month WITH ledger activity inside it.
    const today = resolveToday(args.today);
    const months = trailingMonthWindow(today, TREND_WINDOW_MONTHS);
    const windowStartMonth = months[0];

    // Shared per-entity metric block (E5-T6). The portfolio roll-up sums these
    // exact numbers, so the single-entity dashboard exposes them from the SAME
    // helper — a test asserts coreViews.dashboard.metrics equals that entity's
    // portfolio byBusiness row, guaranteeing the two paths can't drift.
    const metricsList = await Promise.all(orderedEntities.map((scopedEntity) => computeEntityMetrics(ctx, scopedEntity)));
    const metrics = isPortfolioScope ? combineEntityMetrics(metricsList, entity._id) : metricsList[0]!;

    const [
      journalGroups,
      accountGroups,
      bankAccountGroups,
      transactionGroups,
      inboxItemGroups,
      invoiceGroups,
      billGroups,
      payrollRunGroups,
      contactGroups,
    ] = await Promise.all([
      Promise.all(entityIds.map((entityId) => loadDashboardJournal(ctx, entityId))),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(DASHBOARD_LIMIT),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("bankAccounts").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(200),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(DASHBOARD_LIMIT),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("inboxItems").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(2000),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(2000),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("bills").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(2000),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("payrollRuns").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(200),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("contacts").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(2000),
      )),
    ]);
    const entries = journalGroups.flatMap((journal) => journal.entries);
    const lines = journalGroups.flatMap((journal) => journal.lines);
    const accounts = accountGroups.flat();
    const bankAccounts = bankAccountGroups.flat();
    const transactions = transactionGroups.flat();
    const inboxItems = inboxItemGroups.flat();
    const invoices = invoiceGroups.flat();
    const bills = billGroups.flat();
    const payrollRuns = payrollRunGroups.flat();
    const contacts = contactGroups.flat();
    const journalTruncated = journalGroups.some((journal) => journal.truncated);

    const accountsById = new Map(accounts.map((account) => [account._id, account]));
    const entriesById = new Map(entries.map((entry) => [entry._id, entry]));
    const contactsById = new Map(contacts.map((contact) => [contact._id, contact]));
    const balances = new Map<Id<"ledgerAccounts">, Balance>();
    const monthlyBalances = new Map<Id<"ledgerAccounts">, Balance>();
    // Latest month with ledger activity; if the book is empty, fall back to the
    // current server month (never a frozen literal) so the window still anchors
    // to "today" (E1-T11).
    const latestMonth =
      entries.map((entry) => entry.date.slice(0, 7)).sort((a, b) => b.localeCompare(a))[0] ?? monthOfIso(today);
    // The selected period drives every period-scoped widget; default to the
    // latest month with activity. Never trust it to point past the data.
    const selectedMonth = args.period && /^\d{4}-\d{2}$/.test(args.period) ? args.period : latestMonth;

    // Per-month income/expense buckets feed the 6-month P&L trend, the
    // prior-period delta, and the cash-cushion burn rate. Summing
    // (credit−debit) for income and (debit−credit) for expense per line equals
    // normalBalance of the aggregated account, so this stays exact.
    const monthlyPnl = new Map<string, { incomeMinor: number; expenseMinor: number }>();
    for (const line of lines) {
      addBalance(balances, line);
      const entry = entriesById.get(line.entryId);
      if (!entry) continue;
      if (entry.date.startsWith(selectedMonth)) {
        addBalance(monthlyBalances, line);
      }
      const account = accountsById.get(line.accountId);
      if (account && (account.type === "income" || account.type === "expense")) {
        const month = entry.date.slice(0, 7);
        const bucket = monthlyPnl.get(month) ?? { incomeMinor: 0, expenseMinor: 0 };
        if (account.type === "income") bucket.incomeMinor += line.creditMinor - line.debitMinor;
        else bucket.expenseMinor += line.debitMinor - line.creditMinor;
        monthlyPnl.set(month, bucket);
      }
    }

    let incomeMinor = 0;
    let expenseMinor = 0;
    const expensesByCategory: Array<{ name: string; amountMinor: number; categoryAccountId: Id<"ledgerAccounts"> }> = [];
    // Revenue-by-stream (E9-T8): roll the SELECTED-month income up by the
    // owner-facing `streamTag` (several income accounts → one stream), falling
    // back to the account's own name when untagged. Built from the SAME
    // `normalBalance` values that feed `incomeMinor`, so the stream totals sum
    // EXACTLY to the period P&L revenue — no double-count, no omission.
    const streamPeriodTotals = new Map<string, { totalMinor: number; accountIds: Id<"ledgerAccounts">[] }>();
    for (const [accountId, balance] of monthlyBalances.entries()) {
      const account = accountsById.get(accountId);
      if (!account) continue;
      const amountMinor = normalBalance(account, balance);
      if (account.type === "income") {
        incomeMinor += amountMinor;
        const stream = account.streamTag?.trim() || account.name;
        const bucket = streamPeriodTotals.get(stream) ?? { totalMinor: 0, accountIds: [] };
        bucket.totalMinor += amountMinor;
        bucket.accountIds.push(accountId);
        streamPeriodTotals.set(stream, bucket);
      }
      if (account.type === "expense") {
        expenseMinor += amountMinor;
        if (amountMinor > 0) expensesByCategory.push({ name: account.name, amountMinor, categoryAccountId: accountId });
      }
    }
    // Per-stream trailing trend: group the per-month income (already bucketed by
    // account in `monthlyPnl`? no — that's account-type level). Build a 6-month
    // per-stream series from the income lines directly so the widget can sparkline.
    const streamMonthly = new Map<string, Map<string, number>>();
    for (const line of lines) {
      const account = accountsById.get(line.accountId);
      const entry = entriesById.get(line.entryId);
      if (!account || !entry || account.type !== "income") continue;
      const stream = account.streamTag?.trim() || account.name;
      const month = entry.date.slice(0, 7);
      const byMonth = streamMonthly.get(stream) ?? new Map<string, number>();
      byMonth.set(month, (byMonth.get(month) ?? 0) + (line.creditMinor - line.debitMinor));
      streamMonthly.set(stream, byMonth);
    }

    // Cash position is LEDGER-derived for every account (E9-T1 / RC7), the SAME
    // source the Balance Sheet uses (reportViews) — never the live Plaid balance
    // — so the dashboard cash tile and the reports can no longer contradict each
    // other. The live bank balance is kept as a SEPARATE `liveBalanceMinor`
    // field per account and surfaced only as an explicit reconciliation line.
    const bankBalances = bankAccounts
      .map((bankAccount) => {
        const account = accountsById.get(bankAccount.ledgerAccountId);
        const balance = balances.get(bankAccount.ledgerAccountId) ?? { debitMinor: 0, creditMinor: 0 };
        const ledgerBalanceMinor = account ? normalBalance(account, balance) : 0;
        return {
          id: bankAccount._id,
          name: bankAccount.name,
          kind: bankAccount.kind,
          mask: bankAccount.mask,
          ledgerAccountId: bankAccount.ledgerAccountId,
          // The figure the tile renders is the books (ledger) balance.
          amountMinor: ledgerBalanceMinor,
          // What the bank's live feed reports (Plaid). Only meaningful when the
          // account is actually connected; otherwise it mirrors the ledger.
          // `bankSaysMinor` is the E1-T10 canonical name; `liveBalanceMinor` is
          // kept as a back-compat alias for existing consumers.
          liveBalanceMinor: bankAccount.plaidAccountId ? bankAccount.balanceMinor : ledgerBalanceMinor,
          bankSaysMinor: bankAccount.plaidAccountId ? bankAccount.balanceMinor : ledgerBalanceMinor,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const openInboxItems = inboxItems.filter((item) => item.status === "open");
    const inboxByKind = openInboxItems.reduce<Record<string, number>>((acc, item) => {
      acc[item.kind] = (acc[item.kind] ?? 0) + 1;
      return acc;
    }, {});

    const openInvoices = invoices.filter((invoice) => invoice.status === "open" || invoice.status === "overdue");
    const openBills = bills.filter((bill) => bill.status === "open");
    const reviewedTransactions = transactions.filter((transaction) => transaction.review !== "needs_review").length;

    // ---- Cash accounts (ledger) for the transfer-aware cash-flow series.
    const cashAccountIds = new Set(
      accounts
        .filter(
          (account) =>
            account.type === "asset" &&
            (CASH_SUBTYPES.has(account.subtype) ||
              bankAccounts.some((bank) => bank.ledgerAccountId === account._id)),
        )
        .map((account) => account._id),
    );

    // ---- Cash-flow by month: ledger-derived and TRANSFER-AWARE (E9-T1 / RC1).
    // Instead of summing raw transaction.amountMinor (which double-counts
    // own-account transfers and gross Stripe deposits), we walk the POSTED
    // journal lines on cash accounts, net each entry's cash movement once, and
    // exclude internal transfers two ways:
    //   1. the CANONICAL transfer/intercompany flag landed by E1/E5 — a posted
    //      transaction carrying `transferPairId` (own-account move) or
    //      `intercompanyPairId` (cross-entity move) is never income/expense, so
    //      its posted journal entry is dropped from the cash-flow series
    //      (decisions Q45 — consume the existing matcher's pairing, no interim
    //      heuristic that could conflict); and
    //   2. a structural backstop — a pure cash↔cash entry (no non-cash
    //      counter-line, e.g. a checking→savings move) is zero net cash, skip.
    // Debits to cash are inflow, credits are outflow.
    const transferEntryIds = new Set<Id<"journalEntries">>();
    for (const transaction of transactions) {
      if (!transaction.entryId) continue;
      if (transaction.transferPairId || transaction.intercompanyPairId) {
        transferEntryIds.add(transaction.entryId);
      }
    }
    const linesByEntry = new Map<Id<"journalEntries">, Doc<"journalLines">[]>();
    for (const line of lines) {
      const bucket = linesByEntry.get(line.entryId);
      if (bucket) bucket.push(line);
      else linesByEntry.set(line.entryId, [line]);
    }
    const cashByMonth = new Map<string, { inflowMinor: number; outflowMinor: number }>();
    for (const [entryId, entryLines] of linesByEntry.entries()) {
      const entry = entriesById.get(entryId);
      if (!entry) continue;
      // Canonical flag (E1/E5, decisions Q45): a paired transfer/intercompany
      // entry is internal money movement — never a cash-flow inflow/outflow.
      if (transferEntryIds.has(entryId)) continue;
      const cashLines = entryLines.filter((line) => cashAccountIds.has(line.accountId));
      if (cashLines.length === 0) continue;
      const hasCounter = entryLines.some((line) => !cashAccountIds.has(line.accountId));
      // Pure cash↔cash transfer: no non-cash counter-line → zero net cash, skip.
      if (!hasCounter) continue;
      const movementMinor = cashLines.reduce((sum, line) => sum + (line.debitMinor - line.creditMinor), 0);
      if (movementMinor === 0) continue;
      const month = entry.date.slice(0, 7);
      const bucket = cashByMonth.get(month) ?? { inflowMinor: 0, outflowMinor: 0 };
      if (movementMinor > 0) bucket.inflowMinor += movementMinor;
      else bucket.outflowMinor += -movementMinor;
      cashByMonth.set(month, bucket);
    }
    const cashFlowByMonth = months.map((month) => {
      const bucket = cashByMonth.get(month) ?? { inflowMinor: 0, outflowMinor: 0 };
      return {
        month,
        label: monthLabel(month),
        inflowMinor: bucket.inflowMinor,
        outflowMinor: bucket.outflowMinor,
        netMinor: bucket.inflowMinor - bucket.outflowMinor,
      };
    });
    // Income by customer scoped to the selected month (invoices issued that
    // month), so the widget tracks the period selector.
    const incomeByCustomer = new Map<Id<"contacts">, number>();
    for (const invoice of invoices) {
      if (!invoice.issueDate.startsWith(selectedMonth)) continue;
      incomeByCustomer.set(invoice.contactId, (incomeByCustomer.get(invoice.contactId) ?? 0) + invoice.totalMinor);
    }
    // If nothing was issued in the period, fall back to all-time paid so the
    // widget is never empty on a quiet month.
    if (incomeByCustomer.size === 0) {
      for (const invoice of invoices) {
        incomeByCustomer.set(invoice.contactId, (incomeByCustomer.get(invoice.contactId) ?? 0) + invoice.amountPaidMinor);
      }
    }

    const sortedPayrollRuns = [...payrollRuns].sort((a, b) => b.period.localeCompare(a.period));
    const selectedPayrollRun =
      payrollRuns.find((run) => run.period === selectedMonth) ??
      sortedPayrollRuns[0] ??
      null;

    // Last calendar day of the selected month, clamped so a current-month
    // selection carries a month-to-date end rather than a future date.
    const [sy, sm] = selectedMonth.split("-").map(Number);
    const lastDay = new Date(Date.UTC(sy, sm, 0)).getUTCDate();
    const periodStart = `${selectedMonth}-01`;
    const periodEnd = `${selectedMonth}-${String(lastDay).padStart(2, "0")}`;

    // ---- As-of date for aging / upcoming windows. Period end keeps every
    // period-scoped widget reconciled with the rest of the dashboard.
    const asOf = periodEnd;

    const cashPositionMinor = bankBalances
      .filter((account) => account.kind !== "credit")
      .reduce((sum, account) => sum + account.amountMinor, 0);
    const creditCardBalanceMinor = bankBalances
      .filter((account) => account.kind === "credit")
      .reduce((sum, account) => sum + account.amountMinor, 0);

    // E1-T8: "N transactions ($X) are unreviewed and excluded from these figures".
    // Computed from the SAME shared helper reportPack uses (needs_review only,
    // uncapped) so the Dashboard banner and the Reports banner show identical
    // numbers for the same entity.
    const unreviewed = await computeUnreviewedGap(ctx, entityIds);

    // ---- Bank-vs-books reconciliation (E1-T10 / RC7). The tile shows the
    // LEDGER ("books") cash — the SAME source the Balance Sheet uses — never the
    // live Plaid balance. Whenever the bank's LIVE balance differs, we expose the
    // gap explicitly — bank says X, books say Y, N to review — instead of
    // silently rendering the live balance as the primary cash figure. The
    // `unreviewedCount` reuses E1-T8's shared count (the canonical "you haven't
    // looked at this yet" backlog) so the delta is explained from one source.
    const bankCashMinor = bankBalances
      .filter((account) => account.kind !== "credit")
      .reduce((sum, account) => sum + account.bankSaysMinor, 0);
    // Broader "to review" tally (needs_review OR not-yet-posted) kept for the
    // existing tile back-compat; `unreviewedCount` is the canonical E1-T8 number.
    const itemsToReviewCount = transactions.filter(
      (transaction) => transaction.review === "needs_review" || transaction.entryId == null,
    ).length;
    const cashReconciliation = {
      // Canonical E1-T10 names.
      ledgerCashMinor: cashPositionMinor,
      bankCashMinor,
      differenceMinor: bankCashMinor - cashPositionMinor,
      unreviewedCount: unreviewed.unreviewedCount,
      // Back-compat aliases for the existing dashboard tile + tests.
      booksCashMinor: cashPositionMinor,
      itemsToReviewCount,
    };

    // A/R aging (as of period end) + the worst overdue names. Buckets follow the
    // owner-facing 0–30 / 31–60 / 61–90 / 90+ convention; "current" includes
    // not-yet-due balances.
    const receivablesAging = { currentMinor: 0, days30Minor: 0, days60Minor: 0, days90Minor: 0 };
    const overdue: Array<{ contactId: Id<"contacts">; name: string; daysLate: number; amountMinor: number }> = [];
    for (const invoice of openInvoices) {
      const balanceMinor = invoice.totalMinor - invoice.amountPaidMinor;
      if (balanceMinor <= 0) continue;
      const daysLate = Math.max(0, dateDiffDays(asOf, invoice.dueDate));
      if (daysLate <= 30) receivablesAging.currentMinor += balanceMinor;
      else if (daysLate <= 60) receivablesAging.days30Minor += balanceMinor;
      else if (daysLate <= 90) receivablesAging.days60Minor += balanceMinor;
      else receivablesAging.days90Minor += balanceMinor;
      if (daysLate > 0) {
        overdue.push({
          contactId: invoice.contactId,
          name: contactsById.get(invoice.contactId)?.name ?? "Customer",
          daysLate,
          amountMinor: balanceMinor,
        });
      }
    }
    overdue.sort((a, b) => b.daysLate - a.daysLate);

    // A/P — soonest-due bills + what's due within a week of the as-of date.
    const payablesUpcoming = [...openBills]
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((bill) => ({
        contactId: bill.contactId,
        vendor: contactsById.get(bill.contactId)?.name ?? "Vendor",
        dueDate: bill.dueDate,
        amountMinor: bill.totalMinor,
      }));
    const weekFromAsOf = utcToIso(isoToUtc(asOf) + 7 * 86_400_000);
    const dueThisWeekMinor = openBills
      .filter((bill) => bill.dueDate >= asOf && bill.dueDate <= weekFromAsOf)
      .reduce((sum, bill) => sum + bill.totalMinor, 0);

    // DSO (net terms): average issue→due across paid invoices. The seed records
    // no per-invoice payment date, so net terms is the honest signal (mirrors
    // incomeViews) — the UI labels it as such.
    const paidInvoices = invoices.filter((invoice) => invoice.status === "paid");
    const averageDaysToPay = paidInvoices.length
      ? Math.round(
          paidInvoices.reduce((sum, invoice) => sum + Math.max(0, dateDiffDays(invoice.dueDate, invoice.issueDate)), 0) /
            paidInvoices.length,
        )
      : 0;

    // 6-month P&L trend (ending at the selected month) + prior month + margin.
    const trendMonths = Array.from({ length: 6 }, (_, i) => shiftMonth(selectedMonth, i - 5));
    const profitAndLossTrend = trendMonths.map((month) => {
      const bucket = monthlyPnl.get(month) ?? { incomeMinor: 0, expenseMinor: 0 };
      return {
        month,
        label: monthLabel(month),
        incomeMinor: bucket.incomeMinor,
        expenseMinor: bucket.expenseMinor,
        netMinor: bucket.incomeMinor - bucket.expenseMinor,
      };
    });
    const priorMonth = monthlyPnl.get(shiftMonth(selectedMonth, -1)) ?? { incomeMinor: 0, expenseMinor: 0 };
    const marginPct = incomeMinor > 0 ? Math.round(((incomeMinor - expenseMinor) / incomeMinor) * 100) : 0;

    // Revenue-by-stream rows (E9-T8): the selected-month total per stream plus a
    // 6-month trailing trend, sorted by size. The sum of `totalMinor` across rows
    // EQUALS the period P&L revenue (`incomeMinor`) by construction (same
    // normalBalance values), so the widget always reconciles to Reports.
    const revenueByStream = [...streamPeriodTotals.entries()]
      .map(([stream, bucket]) => {
        const byMonth = streamMonthly.get(stream) ?? new Map<string, number>();
        return {
          stream,
          totalMinor: bucket.totalMinor,
          accountIds: bucket.accountIds,
          trend: trendMonths.map((month) => ({
            month,
            label: monthLabel(month),
            amountMinor: byMonth.get(month) ?? 0,
          })),
        };
      })
      .filter((row) => row.totalMinor !== 0)
      .sort((a, b) => b.totalMinor - a.totalMinor);

    // Cash cushion — months of runway at the trailing expense run-rate.
    const trailingExpenses = profitAndLossTrend.map((row) => row.expenseMinor).filter((value) => value > 0);
    const avgMonthlyExpenseMinor = trailingExpenses.length
      ? Math.round(trailingExpenses.reduce((sum, value) => sum + value, 0) / trailingExpenses.length)
      : expenseMinor;
    const cushionMonths =
      avgMonthlyExpenseMinor > 0 ? Math.round((cashPositionMinor / avgMonthlyExpenseMinor) * 10) / 10 : 0;

    // Coming up — invoices in / bills out within 30 days of the as-of date, plus
    // an estimated next payroll run so the big recurring outflow is visible.
    const horizon = utcToIso(isoToUtc(asOf) + 30 * 86_400_000);
    const comingUpItems: Array<{ label: string; when: string; amountMinor: number; kind: "invoice" | "bill" | "payroll" }> = [];
    for (const invoice of openInvoices) {
      const balanceMinor = invoice.totalMinor - invoice.amountPaidMinor;
      if (balanceMinor <= 0 || invoice.dueDate < asOf || invoice.dueDate > horizon) continue;
      comingUpItems.push({
        label: `${contactsById.get(invoice.contactId)?.name ?? "Customer"} · ${invoice.number}`,
        when: invoice.dueDate,
        amountMinor: balanceMinor,
        kind: "invoice",
      });
    }
    for (const bill of openBills) {
      if (bill.dueDate < asOf || bill.dueDate > horizon) continue;
      comingUpItems.push({
        label: contactsById.get(bill.contactId)?.name ?? "Vendor",
        when: bill.dueDate,
        amountMinor: -bill.totalMinor,
        kind: "bill",
      });
    }
    if (selectedPayrollRun) {
      // The next run lands at the end of the following month — always a near-term
      // recurring outflow — so surface it even if it's a day or two past the
      // 30-day window for invoices/bills. It's the owner's biggest known expense.
      const nextPayrollDate = endOfMonthIso(shiftMonth(selectedPayrollRun.period, 1));
      if (nextPayrollDate >= asOf) {
        comingUpItems.push({
          label: "Payroll run (est.)",
          when: nextPayrollDate,
          amountMinor: -selectedPayrollRun.totalBaseMinor,
          kind: "payroll",
        });
      }
    }
    comingUpItems.sort((a, b) => a.when.localeCompare(b.when));
    const comingUp = {
      items: comingUpItems.slice(0, 6),
      netMinor: comingUpItems.reduce((sum, item) => sum + item.amountMinor, 0),
    };

    // Income concentration — top customer's share of period income, computed
    // across ALL customers before the top-5 slice in the return.
    const concentrationTotalMinor = [...incomeByCustomer.values()].reduce((sum, value) => sum + value, 0);
    const concentrationTop = [...incomeByCustomer.entries()].sort((a, b) => b[1] - a[1])[0];
    const incomeConcentration = concentrationTop
      ? {
          topName: contactsById.get(concentrationTop[0])?.name ?? "Customer",
          topSharePct:
            concentrationTotalMinor > 0 ? Math.round((concentrationTop[1] / concentrationTotalMinor) * 100) : 0,
          totalMinor: concentrationTotalMinor,
        }
      : { topName: "", topSharePct: 0, totalMinor: 0 };

    // Payroll meta — next run date + per-currency mix for the selected run (one
    // bounded read by run; lines are capped by headcount).
    let payrollMeta:
      | { nextRunDate: string; headcount: number; currencies: Array<{ currency: string; localMinor: number }> }
      | null = null;
    if (selectedPayrollRun) {
      const runLines = await ctx.db
        .query("payrollRunLines")
        .withIndex("by_run", (q) => q.eq("runId", selectedPayrollRun._id))
        .take(500);
      const byCurrency = new Map<string, number>();
      for (const line of runLines) {
        byCurrency.set(line.currency, (byCurrency.get(line.currency) ?? 0) + line.finalLocalMinor);
      }
      payrollMeta = {
        nextRunDate: endOfMonthIso(shiftMonth(selectedPayrollRun.period, 1)),
        headcount: runLines.length,
        currencies: [...byCurrency.entries()]
          .map(([currency, localMinor]) => ({ currency, localMinor }))
          .sort((a, b) => b.localMinor - a.localMinor),
      };
    }

    const payrollTrendAnchor = selectedPayrollRun?.period ?? selectedMonth;
    const payrollTrend = Array.from({ length: 3 }, (_, index) => shiftMonth(payrollTrendAnchor, index - 2)).map((period) => {
      const run = payrollRuns.find((candidate) => candidate.period === period);
      return {
        period,
        totalBaseMinor: run?.totalBaseMinor ?? 0,
        status: run?.status ?? "none",
      };
    });

    return {
      entity: {
        id: entity._id,
        name: isPortfolioScope ? "All businesses" : entity.name,
        currency: isPortfolioScope ? "USD" : entity.currency,
      },
      // Shared per-entity metrics (E5-T6) — the exact figures the portfolio
      // roll-up sums for this entity's by-business tile. Reconciles by
      // construction (same helper).
      metrics,
      latestMonth,
      selectedMonth,
      // Server-clock trailing window driving cashFlowByMonth (E1-T11). Ends at
      // the current server month — never a frozen literal — so the dashboard
      // trend stays current on the real calendar.
      trendWindow: { months, startMonth: windowStartMonth, endMonth: months[months.length - 1] },
      periodStart,
      periodEnd,
      cashPositionMinor,
      creditCardBalanceMinor,
      bankBalances,
      cashReconciliation,
      // E1-T8: unreviewed-and-excluded backlog ({unreviewedCount, unreviewedAbsMinor})
      // from the SAME helper reportPack uses — identical number on both surfaces.
      unreviewed,
      profitAndLoss: {
        incomeMinor,
        expenseMinor,
        netIncomeMinor: incomeMinor - expenseMinor,
        marginPct,
        previousIncomeMinor: priorMonth.incomeMinor,
        previousExpenseMinor: priorMonth.expenseMinor,
        previousNetIncomeMinor: priorMonth.incomeMinor - priorMonth.expenseMinor,
      },
      profitAndLossTrend,
      inbox: {
        openCount: openInboxItems.length,
        byKind: Object.entries(inboxByKind)
          .map(([kind, count]) => ({ kind, count }))
          .sort((a, b) => b.count - a.count),
        automationRate: transactions.length ? Math.round((reviewedTransactions / transactions.length) * 100) : 0,
      },
      receivables: {
        openMinor: openInvoices.reduce((sum, invoice) => sum + (invoice.totalMinor - invoice.amountPaidMinor), 0),
        overdueCount: invoices.filter((invoice) => invoice.status === "overdue").length,
        aging: receivablesAging,
        overdue: overdue.slice(0, 3),
        averageDaysToPay,
      },
      payables: {
        openMinor: openBills.reduce((sum, bill) => sum + bill.totalMinor, 0),
        // "Due soon" = within the 30-day as-of horizon (same window comingUp
        // uses), not a frozen month-end literal (E1-T11 / RC6).
        dueSoonCount: openBills.filter((bill) => bill.dueDate <= horizon).length,
        dueThisWeekMinor,
        upcoming: payablesUpcoming.slice(0, 4),
      },
      expensesByCategory: expensesByCategory.sort((a, b) => b.amountMinor - a.amountMinor).slice(0, 5),
      // Revenue-by-stream (E9-T8): per-stream period total + trend. Sum of
      // `totalMinor` == period P&L revenue (`profitAndLoss.incomeMinor`).
      revenueByStream,
      incomeByCustomer: [...incomeByCustomer.entries()]
        .map(([contactId, amountMinor]) => ({
          contactId,
          name: contactsById.get(contactId)?.name ?? "Customer",
          amountMinor,
        }))
        .sort((a, b) => b.amountMinor - a.amountMinor)
        .slice(0, 5),
      cashFlowByMonth,
      cashSparkline: cashFlowByMonth.reduce<number[]>((points, row) => {
        const previous = points.at(-1) ?? 0;
        return [...points, previous + row.netMinor];
      }, []),
      payroll: selectedPayrollRun,
      payrollMeta,
      payrollTrend,
      cashCushion: { months: cushionMonths, avgMonthlyExpenseMinor },
      comingUp,
      incomeConcentration,
      recentActivity: entries
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
        .slice(0, 8)
        .map((entry) => ({
          id: entry._id,
          date: entry.date,
          memo: entry.memo,
          source: entry.source,
        })),
      readStats: {
        ledgerAccounts: accounts.length,
        bankAccounts: bankAccounts.length,
        journalEntries: entries.length,
        journalLines: lines.length,
        transactions: transactions.length,
        inboxItems: inboxItems.length,
        invoices: invoices.length,
        bills: bills.length,
        payrollRuns: payrollRuns.length,
        contacts: contacts.length,
        totalRows:
          accounts.length +
          bankAccounts.length +
          entries.length +
          lines.length +
          transactions.length +
          inboxItems.length +
          invoices.length +
          bills.length +
          payrollRuns.length +
          contacts.length,
        limit: DASHBOARD_LIMIT,
        // True only when an in-range journal entry was actually excluded by the
        // entry cap (whole-entry loading, E1-T5), never on flat row count, so
        // the dashboard can never reflect a half-loaded posting.
        truncated:
          journalTruncated ||
          accounts.length >= DASHBOARD_LIMIT ||
          transactions.length >= DASHBOARD_LIMIT,
      },
    };
  },
});

export const inbox = query({
  args: { entityId: v.optional(v.id("entities")) },
  handler: async (ctx, args) => {
    const entity = await getActiveEntity(ctx, args.entityId);
    if (!entity) return null;

    const [items, transactions, accounts, bankAccounts, documents, correctionMemories] = await Promise.all([
      ctx.db.query("inboxItems").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
      ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(DASHBOARD_LIMIT),
      ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(500),
      ctx.db.query("bankAccounts").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(200),
      ctx.db.query("documents").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(1000),
      ctx.db.query("aiCorrectionMemories").withIndex("by_entity", (q) => q.eq("entityId", entity._id)).take(2000),
    ]);
    const transactionsById = new Map(transactions.map((transaction) => [transaction._id, transaction]));
    const accountsById = new Map(accounts.map((account) => [account._id, account]));
    const bankAccountsById = new Map(bankAccounts.map((account) => [account._id, account]));
    const documentsById = new Map(documents.map((document) => [document._id, document]));

    // E2-T11: index correction memories by (merchantKey, direction) so each
    // categorize item can offer Top-N "same as last time" suggestions. The
    // strongest signal first (highest occurrenceCount) — the same memory the
    // pipeline would auto-resolve from on the next identical merchant.
    const memoriesByMerchant = new Map<string, typeof correctionMemories>();
    for (const memory of correctionMemories) {
      const key = `${memory.merchantKey}|${memory.direction}`;
      const bucket = memoriesByMerchant.get(key) ?? [];
      bucket.push(memory);
      memoriesByMerchant.set(key, bucket);
    }
    const openItems = items
      .filter((item) => item.status === "open")
      .sort((a, b) => b.createdAt - a.createdAt);

    // Count items resolved/dismissed in the last 24h so the queue header can
    // show progress ("M cleared today"). Read-only, entity-scoped.
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const clearedToday = items.filter(
      (item) => item.status !== "open" && item.updatedAt >= dayAgo,
    ).length;

    return {
      entity: { id: entity._id, currency: entity.currency },
      clearedToday,
      items: openItems.map((item) => {
        const transaction = item.transactionId ? transactionsById.get(item.transactionId) : null;
        const document = item.documentId ? documentsById.get(item.documentId) : null;
        const category = transaction?.categoryAccountId ? accountsById.get(transaction.categoryAccountId) : null;
        const bankAccount = transaction?.bankAccountId ? bankAccountsById.get(transaction.bankAccountId) : null;

        // E2-T11: assemble Top-N category suggestions for a categorize item.
        // Source order: the AI/recall proposal already on the row, then the
        // owner's prior corrections for this exact merchant (memory). Deduped by
        // account, capped at 3 — accepting any one confirms through the existing
        // pipeline mutation (no new ledger path).
        const suggestions: Array<{
          accountId: Id<"ledgerAccounts">;
          number: string;
          name: string;
          source: "proposal" | "memory";
          occurrenceCount?: number;
        }> = [];
        const seenAccounts = new Set<string>();
        if (transaction && item.kind === "categorize") {
          if (category) {
            suggestions.push({
              accountId: category._id,
              number: category.number,
              name: category.name,
              source: "proposal",
            });
            seenAccounts.add(category._id);
          }
          const direction = signedTransactionAmount(transaction) >= 0 ? "inflow" : "outflow";
          const merchantKey = normalizeMerchantKey(transaction.merchant);
          const memories = (memoriesByMerchant.get(`${merchantKey}|${direction}`) ?? [])
            .slice()
            .sort((a, b) => b.occurrenceCount - a.occurrenceCount);
          for (const memory of memories) {
            if (seenAccounts.has(memory.categoryAccountId)) continue;
            const memoryAccount = accountsById.get(memory.categoryAccountId);
            if (!memoryAccount || memoryAccount.archived) continue;
            suggestions.push({
              accountId: memoryAccount._id,
              number: memoryAccount.number,
              name: memoryAccount.name,
              source: "memory",
              occurrenceCount: memory.occurrenceCount,
            });
            seenAccounts.add(memory.categoryAccountId);
            if (suggestions.length >= 3) break;
          }
        }

        return {
          id: item._id,
          kind: item.kind,
          summary: item.payloadSummary,
          transactionId: transaction?._id ?? null,
          documentId: document?._id ?? null,
          merchant: document?.vendor ?? transaction?.merchant ?? item.kind,
          date: document?.date ?? transaction?.date ?? null,
          amountMinor: document ? -document.totalMinor : transaction ? signedTransactionAmount(transaction) : 0,
          confidence: document?.extractionConfidence ?? transaction?.confidence ?? null,
          reasoning: transaction?.reasoning ?? null,
          // E2-T11: the decision stage drives the per-item provenance line
          // ("Matched your rule" / "Same as your last AWS charges" / "AI 0.82").
          decidedBy: transaction?.decidedBy ?? null,
          suggestions,
          categoryName: category?.name ?? "Needs category",
          categoryAccountId: category?._id ?? null,
          bankAccountName: bankAccount?.name ?? "OpenBooks",
          receiptDocument: document
            ? {
                id: document._id,
                kind: document.kind,
                vendor: document.vendor,
                date: document.date,
                totalMinor: document.totalMinor,
                currency: document.currency,
                fileName: document.fileName ?? null,
                status: document.status,
                extractionSource: document.extractionSource ?? null,
                extractionConfidence: document.extractionConfidence ?? null,
                extractionNotes: document.extractionNotes ?? null,
                matchedTransactionId: document.matchedTransactionId ?? null,
                candidate: transaction
                  ? {
                      id: transaction._id,
                      merchant: transaction.merchant,
                      date: transaction.date,
                      amountMinor: transaction.amountMinor,
                      bankAccountName: bankAccount?.name ?? "OpenBooks",
                      categoryName: category?.name ?? "Needs category",
                    }
                  : null,
              }
            : null,
        };
      }),
      categoryOptions: accounts
        .filter((account) => !account.archived && (account.type === "expense" || account.type === "income" || account.type === "asset" || account.type === "liability"))
        .sort((a, b) => a.number.localeCompare(b.number))
        .map((account) => ({
          id: account._id,
          number: account.number,
          name: account.name,
          type: account.type,
        })),
    };
  },
});

export const transactions = query({
  args: {
    entityId: v.optional(v.id("entities")),
    scope: v.optional(scopeValidator),
    review: v.optional(v.union(v.literal("all"), v.literal("auto"), v.literal("confirmed"), v.literal("needs_review"), v.literal("excluded"))),
    search: v.optional(v.string()),
    // Money-shape filters. These scope the additive `insights` aggregate ONLY
    // (the `rows` payload is unchanged), so the insights band reflects the
    // selected period/direction/source/account over the FULL set rather than
    // the 120-row table slice. All optional → omitting them preserves prior
    // behavior for any existing caller.
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    direction: v.optional(v.union(v.literal("in"), v.literal("out"), v.literal("all"))),
    source: v.optional(v.union(v.literal("bank"), v.literal("stripe"), v.literal("manual"))),
    bankAccountIds: v.optional(v.array(v.id("bankAccounts"))),
  },
  handler: async (ctx, args) => {
    let entities: Doc<"entities">[];
    const isPortfolioScope = args.scope === "all" && !args.entityId;
    if (isPortfolioScope) {
      const { membership } = await requireAnyWorkspaceRole(ctx, "member");
      entities = await assertScopeAuthorized(ctx, membership, "all");
      for (const scopedEntity of entities) await requireWorkspaceRole(ctx, scopedEntity.workspaceId, "member");
    } else if (args.scope && args.scope !== "all") {
      const { membership } = await requireAnyWorkspaceRole(ctx, "member");
      entities = await assertScopeAuthorized(ctx, membership, args.scope);
      for (const scopedEntity of entities) await requireWorkspaceRole(ctx, scopedEntity.workspaceId, "member");
    } else {
      const entity = await getActiveEntity(ctx, args.entityId);
      entities = entity ? [entity] : [];
    }
    if (entities.length === 0) return null;

    const orderedEntities = entities
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id));
    const entity = orderedEntities[0]!;
    const entityIds = orderedEntities.map((scopedEntity) => scopedEntity._id);
    const [transactionGroups, accountGroups, bankAccountGroups, inboxItemGroups, lineGroups, documentGroups, entryGroups, auditEvents, contactGroups, memoryGroups] = await Promise.all([
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(DASHBOARD_LIMIT),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("ledgerAccounts").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(500),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("bankAccounts").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(200),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("inboxItems").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(2000),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(DASHBOARD_LIMIT),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("documents").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(1000),
      )),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("journalEntries").withIndex("by_entity", (q) => q.eq("entityId", entityId)).order("desc").take(1000),
      )),
      ctx.db.query("auditEvents").withIndex("by_workspace", (q) => q.eq("workspaceId", entity.workspaceId)).order("desc").take(1000),
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("contacts").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(2000),
      )),
      // E7-1: memory-streak counts keyed by (merchantKey, direction) so a
      // memory-decided row's provenance can read "Same as your last N charges".
      Promise.all(entityIds.map((entityId) =>
        ctx.db.query("aiCorrectionMemories").withIndex("by_entity", (q) => q.eq("entityId", entityId)).take(2000),
      )),
    ]);
    const transactions = transactionGroups.flat();
    const accounts = accountGroups.flat();
    const bankAccounts = bankAccountGroups.flat();
    const inboxItems = inboxItemGroups.flat();
    const allLines = lineGroups.flat();
    const documents = documentGroups.flat();
    const entries = entryGroups.flat();
    const contacts = contactGroups.flat();
    const correctionMemories = memoryGroups.flat();
    // E7-1: the strongest memory streak per (merchantKey, direction) — the same
    // memory the pipeline auto-resolves from on the next identical merchant.
    const memoryCountByKey = new Map<string, number>();
    for (const memory of correctionMemories) {
      const key = `${memory.merchantKey}|${memory.direction}`;
      const prior = memoryCountByKey.get(key) ?? 0;
      if (memory.occurrenceCount > prior) memoryCountByKey.set(key, memory.occurrenceCount);
    }
    const accountsById = new Map(accounts.map((account) => [account._id, account]));
    const bankAccountsById = new Map(bankAccounts.map((account) => [account._id, account]));
    const contactsById = new Map(contacts.map((contact) => [contact._id, contact]));
    const documentsByTransactionId = new Map(
      documents
        .filter((document) => document.matchedTransactionId)
        .map((document) => [document.matchedTransactionId!, document]),
    );
    const attachmentCountByTransactionId = new Map<string, number>();
    for (const document of documents) {
      if (!document.matchedTransactionId) continue;
      attachmentCountByTransactionId.set(
        document.matchedTransactionId,
        (attachmentCountByTransactionId.get(document.matchedTransactionId) ?? 0) + 1,
      );
    }
    const auditEventsByEntityId = new Map<string, Doc<"auditEvents">[]>();
    for (const event of auditEvents) {
      if (!event.entityId) continue;
      const events = auditEventsByEntityId.get(event.entityId) ?? [];
      events.push(event);
      auditEventsByEntityId.set(event.entityId, events);
    }
    const balances = new Map<Id<"ledgerAccounts">, Balance>();
    for (const line of allLines) {
      addBalance(balances, line);
    }
    const inboxByTransactionId = new Map(
      inboxItems
        .filter((item) => item.transactionId && item.status === "open")
        .map((item) => [item.transactionId!, item]),
    );
    const normalizedSearch = args.search?.trim().toLowerCase() ?? "";
    const rows = transactions
      .filter((transaction) => (args.review && args.review !== "all" ? transaction.review === args.review : true))
      .filter((transaction) =>
        normalizedSearch
          ? `${transaction.merchant} ${transaction.rawDescription}`.toLowerCase().includes(normalizedSearch)
          : true,
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
      .slice(0, 120);

    const entryLines = new Map<Id<"journalEntries">, Doc<"journalLines">[]>();
    for (const row of rows) {
      if (!row.entryId) continue;
      const lines = await ctx.db
        .query("journalLines")
        .withIndex("by_entry", (q) => q.eq("entryId", row.entryId!))
        .take(100);
      entryLines.set(row.entryId, lines);
    }

    // Insights aggregate: computed over the FULL filtered set (not the 120-row
    // slice) so the band's net-change / money-in-out / counterparty rollups are
    // period-accurate. Mirrors the dashboard's reduce/group patterns.
    const matchesInsightFilters = (transaction: Doc<"transactions">) => {
      if (args.review && args.review !== "all" && transaction.review !== args.review) return false;
      if (normalizedSearch && !`${transaction.merchant} ${transaction.rawDescription}`.toLowerCase().includes(normalizedSearch)) return false;
      if (args.from && transaction.date < args.from) return false;
      if (args.to && transaction.date > args.to) return false;
      if (args.direction === "in" && transaction.amountMinor <= 0) return false;
      if (args.direction === "out" && transaction.amountMinor >= 0) return false;
      if (args.source && transaction.source !== args.source) return false;
      if (
        args.bankAccountIds &&
        args.bankAccountIds.length > 0 &&
        (!transaction.bankAccountId || !args.bankAccountIds.includes(transaction.bankAccountId))
      ) {
        return false;
      }
      return true;
    };

    const insightTransactions = transactions.filter(matchesInsightFilters);
    let moneyInMinor = 0;
    let moneyOutMinor = 0;
    // Uncategorized exposure: transactions still missing a category account. The
    // KPI surfaces both the count (how many need a look) and the dollar weight
    // (how much money is unclassified) so the operator can judge the risk.
    let uncategorizedMinor = 0;
    let uncategorizedCount = 0;
    const byDate = new Map<string, { inMinor: number; outMinor: number }>();
    const byCounterparty = new Map<string, number>();
    for (const transaction of insightTransactions) {
      const amount = transaction.amountMinor;
      const bucket = byDate.get(transaction.date) ?? { inMinor: 0, outMinor: 0 };
      if (amount > 0) {
        moneyInMinor += amount;
        bucket.inMinor += amount;
      } else {
        moneyOutMinor += Math.abs(amount);
        bucket.outMinor += Math.abs(amount);
      }
      byDate.set(transaction.date, bucket);
      if (!transaction.categoryAccountId) {
        uncategorizedCount += 1;
        uncategorizedMinor += Math.abs(amount);
      }
      const contact = transaction.contactId ? contactsById.get(transaction.contactId) : null;
      const label = contact?.name ?? transaction.merchant ?? "Unknown";
      byCounterparty.set(label, (byCounterparty.get(label) ?? 0) + amount);
    }
    let runningIn = 0;
    let runningOut = 0;
    const sortedDates = [...byDate.keys()].sort();
    const cumulative = sortedDates.map((date) => {
      const bucket = byDate.get(date)!;
      runningIn += bucket.inMinor;
      runningOut += bucket.outMinor;
      return { date, inMinor: runningIn, outMinor: runningOut };
    });
    // Per-day net series — the KPI sparkline reads the shape of cash movement
    // across the period (not the cumulative line). Bounded by the day count.
    const dailyNet = sortedDates.map((date) => {
      const bucket = byDate.get(date)!;
      return bucket.inMinor - bucket.outMinor;
    });
    const counterparties = [...byCounterparty.entries()]
      .map(([label, amountMinor]) => ({ label, amountMinor }))
      .sort((a, b) => Math.abs(b.amountMinor) - Math.abs(a.amountMinor))
      .slice(0, 6);

    // Ending cash = the cash position (bank accounts excluding credit cards) as
    // of the period end, derived from POSTED journal lines on those accounts
    // dated on/before `to`. Period-accurate (not the live balance) so it lines
    // up with the rest of the panel's window. Mirrors the dashboard's
    // cash-position rule (normalBalance over cash ledger accounts).
    const cashLedgerAccountIds = new Set(
      bankAccounts.filter((account) => account.kind !== "credit").map((account) => account.ledgerAccountId),
    );
    let endingCashMinor = 0;
    if (cashLedgerAccountIds.size > 0) {
      const entryDateById = new Map(entries.map((entry) => [entry._id, entry.date]));
      const cashBalances = new Map<Id<"ledgerAccounts">, Balance>();
      for (const line of allLines) {
        if (!cashLedgerAccountIds.has(line.accountId)) continue;
        const entryDate = entryDateById.get(line.entryId);
        // Bound to the active window end when one is set; otherwise all-time.
        if (args.to && entryDate && entryDate > args.to) continue;
        addBalance(cashBalances, line);
      }
      for (const accountId of cashLedgerAccountIds) {
        const account = accountsById.get(accountId);
        const balance = cashBalances.get(accountId);
        if (!account || !balance) continue;
        endingCashMinor += normalBalance(account, balance);
      }
    }

    // "vs last period": net change (and money-in / money-out splits) over the
    // immediately preceding window of equal length, scoped to the same money
    // filters (date excluded — that's what we're shifting). The split lets the
    // Money-in and Money-out KPIs each carry their own named comparison.
    let prevNetChangeMinor = 0;
    let prevMoneyInMinor = 0;
    let prevMoneyOutMinor = 0;
    if (args.from && args.to) {
      const dayMs = 24 * 60 * 60 * 1000;
      const prevToMs = isoToUtc(args.from) - dayMs;
      const prevFromMs = prevToMs - (isoToUtc(args.to) - isoToUtc(args.from));
      const prevFrom = utcToIso(prevFromMs);
      const prevTo = utcToIso(prevToMs);
      for (const transaction of transactions) {
        if (transaction.date < prevFrom || transaction.date > prevTo) continue;
        if (args.review && args.review !== "all" && transaction.review !== args.review) continue;
        if (normalizedSearch && !`${transaction.merchant} ${transaction.rawDescription}`.toLowerCase().includes(normalizedSearch)) continue;
        if (args.direction === "in" && transaction.amountMinor <= 0) continue;
        if (args.direction === "out" && transaction.amountMinor >= 0) continue;
        if (args.source && transaction.source !== args.source) continue;
        if (
          args.bankAccountIds &&
          args.bankAccountIds.length > 0 &&
          (!transaction.bankAccountId || !args.bankAccountIds.includes(transaction.bankAccountId))
        ) {
          continue;
        }
        prevNetChangeMinor += transaction.amountMinor;
        if (transaction.amountMinor > 0) prevMoneyInMinor += transaction.amountMinor;
        else prevMoneyOutMinor += Math.abs(transaction.amountMinor);
      }
    }

    return {
      entity: { id: entity._id, currency: isPortfolioScope ? "USD" : entity.currency },
      insights: {
        netChangeMinor: moneyInMinor - moneyOutMinor,
        moneyInMinor,
        moneyOutMinor,
        prevNetChangeMinor,
        prevMoneyInMinor,
        prevMoneyOutMinor,
        endingCashMinor,
        uncategorizedMinor,
        uncategorizedCount,
        matchedCount: insightTransactions.length,
        cumulative,
        dailyNet,
        counterparties,
      },
      rows: rows.map((transaction) => {
        const category = transaction.categoryAccountId ? accountsById.get(transaction.categoryAccountId) : null;
        const bankAccount = transaction.bankAccountId ? bankAccountsById.get(transaction.bankAccountId) : null;
        const contact = transaction.contactId ? contactsById.get(transaction.contactId) : null;
        const entryIds = new Set<Id<"journalEntries">>();
        if (transaction.entryId) entryIds.add(transaction.entryId);
        for (const entry of entries) {
          if (
            entry.sourceId === transaction.externalId ||
            entry.sourceId === transaction._id ||
            (transaction.entryId && entry.reversesEntryId === transaction.entryId)
          ) {
            entryIds.add(entry._id);
          }
        }
        const activity = [...entryIds]
          .flatMap((entryId) => auditEventsByEntityId.get(entryId) ?? [])
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((event) => ({
            id: event._id,
            action: event.action,
            summary: event.summary,
            createdAt: event.createdAt,
          }));
        const receipt = documentsByTransactionId.get(transaction._id) ?? null;
        return {
          id: transaction._id,
          date: transaction.date,
          merchant: transaction.merchant,
          rawDescription: transaction.rawDescription,
          amountMinor: signedTransactionAmount(transaction),
          source: transaction.source,
          review: transaction.review,
          decidedBy: transaction.decidedBy ?? null,
          confidence: transaction.confidence ?? null,
          reasoning: transaction.reasoning ?? null,
          // E7-1: a single server-computed provenance descriptor so the register
          // chip, the mobile card, and the drawer all render the SAME vocabulary
          // (Rule / Memory / Matched / Imported / AI N% / Needs review / Manual)
          // instead of re-deriving meaning from the raw enum. Additive — the raw
          // decidedBy/confidence/reasoning fields above stay for back-compat.
          provenance: buildProvenance({
            decidedBy: transaction.decidedBy,
            source: transaction.source,
            review: transaction.review,
            confidence: transaction.confidence,
            merchant: transaction.merchant,
            count:
              transaction.decidedBy === "memory" || transaction.decidedBy === "embedding"
                ? (memoryCountByKey.get(
                    `${normalizeMerchantKey(transaction.merchant)}|${signedTransactionAmount(transaction) >= 0 ? "inflow" : "outflow"}`,
                  ) ?? null)
                : null,
          }),
          categoryAccountId: category?._id ?? null,
          categoryName: category?.name ?? "Uncategorized",
          contactId: contact?._id ?? null,
          contactName: contact?.name ?? null,
          bankAccountId: bankAccount?._id ?? null,
          bankAccountName: bankAccount?.name ?? "Manual",
          hasInboxItem: inboxByTransactionId.has(transaction._id),
          entryId: transaction.entryId ?? null,
          receipt: receipt
            ? {
                id: receipt._id,
                vendor: receipt.vendor,
                date: receipt.date,
                totalMinor: receipt.totalMinor,
                status: receipt.status,
              }
            : null,
          attachmentCount: attachmentCountByTransactionId.get(transaction._id) ?? 0,
          activity,
          lines: transaction.entryId
            ? (entryLines.get(transaction.entryId) ?? []).map((line) => {
                const account = accountsById.get(line.accountId);
                return {
                  id: line._id,
                  accountNumber: account?.number ?? "----",
                  accountName: account?.name ?? "Unknown account",
                  debitMinor: line.debitMinor,
                  creditMinor: line.creditMinor,
                  currency: line.currency,
                };
              })
            : [],
        };
      }),
      bankAccounts: bankAccounts.map((account) => {
        const ledgerAccount = accountsById.get(account.ledgerAccountId);
        const ledgerBalanceMinor = ledgerAccount
          ? normalBalance(ledgerAccount, balances.get(account.ledgerAccountId) ?? { debitMinor: 0, creditMinor: 0 })
          : 0;
        return {
          id: account._id,
          name: account.name,
          ledgerAccountId: account.ledgerAccountId,
          ledgerBalanceMinor,
          bankBalanceMinor: account.balanceMinor,
          differenceMinor: ledgerBalanceMinor - account.balanceMinor,
        };
      }),
      categoryOptions: accounts
        .filter((account) => !account.archived && (account.type === "expense" || account.type === "income" || account.type === "asset" || account.type === "liability"))
        .sort((a, b) => a.number.localeCompare(b.number))
        .map((account) => ({
          id: account._id,
          number: account.number,
          name: account.name,
          type: account.type,
        })),
    };
  },
});

// Lazy per-transaction attachment list for the detail drawer: resolves a signed
// view URL only for the opened transaction's documents (receipts + attachments),
// so the hot register query never pays the storage.getUrl cost.
export const transactionAttachments = query({
  args: {
    entityId: v.optional(v.id("entities")),
    transactionId: v.id("transactions"),
  },
  handler: async (ctx, args) => {
    const entity = await getActiveEntity(ctx, args.entityId);
    if (!entity) return [];
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction || transaction.entityId !== entity._id) return [];
    const documents = await ctx.db
      .query("documents")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(2000);
    const matched = documents
      .filter((document) => document.matchedTransactionId === args.transactionId)
      .sort((a, b) => b.createdAt - a.createdAt);
    return Promise.all(
      matched.map(async (document) => ({
        id: document._id,
        kind: document.kind,
        fileName: document.fileName ?? null,
        mimeType: document.mimeType ?? null,
        vendor: document.vendor,
        date: document.date,
        totalMinor: document.totalMinor,
        status: document.status,
        createdAt: document.createdAt,
        fileUrl: document.storageId ? await ctx.storage.getUrl(document.storageId) : null,
      })),
    );
  },
});

// Insights drill-down: the underlying transactions behind a clicked chart point
// or an AI observation's entity chip. Entity-scoped (re-checks workspace/entity
// auth via getActiveEntity) and bounded with take(). Reuses the same filter
// shape as the transactions insights aggregate so a drill always lists exactly
// what the aggregate counted. Returns ≤200 lean rows (the drawer never needs the
// full register payload), newest first.
export const insightsDrill = query({
  args: {
    entityId: v.optional(v.id("entities")),
    from: v.string(),
    to: v.string(),
    // Narrow to a single day (a clicked timeline point) when provided.
    day: v.optional(v.string()),
    // Narrow to one counterparty (a clicked AI entity chip / legend) when provided.
    // Matches the same label the aggregate groups by (contact name, else merchant).
    counterparty: v.optional(v.string()),
    direction: v.optional(v.union(v.literal("in"), v.literal("out"), v.literal("all"))),
    // Narrow to transactions still missing a category account (the Uncategorized
    // KPI drill). Mirrors the aggregate's `uncategorizedCount` rule.
    uncategorized: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const entity = await getActiveEntity(ctx, args.entityId);
    if (!entity) return null;

    const [transactions, contacts, accounts] = await Promise.all([
      ctx.db
        .query("transactions")
        .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
        .take(DASHBOARD_LIMIT),
      ctx.db
        .query("contacts")
        .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
        .take(2000),
      ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
        .take(500),
    ]);
    const contactsById = new Map(contacts.map((contact) => [contact._id, contact]));
    const accountsById = new Map(accounts.map((account) => [account._id, account]));

    const counterpartyLabel = (transaction: Doc<"transactions">) => {
      const contact = transaction.contactId ? contactsById.get(transaction.contactId) : null;
      return contact?.name ?? transaction.merchant ?? "Unknown";
    };

    const matched = transactions
      .filter((transaction) => {
        if (transaction.date < args.from || transaction.date > args.to) return false;
        if (args.day && transaction.date !== args.day) return false;
        if (args.direction === "in" && transaction.amountMinor <= 0) return false;
        if (args.direction === "out" && transaction.amountMinor >= 0) return false;
        if (args.counterparty && counterpartyLabel(transaction) !== args.counterparty) return false;
        if (args.uncategorized && transaction.categoryAccountId) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
      .slice(0, 200);

    return {
      currency: entity.currency,
      rows: matched.map((transaction) => {
        const category = transaction.categoryAccountId
          ? accountsById.get(transaction.categoryAccountId)
          : null;
        return {
          id: transaction._id,
          date: transaction.date,
          merchant: transaction.merchant,
          counterparty: counterpartyLabel(transaction),
          amountMinor: signedTransactionAmount(transaction),
          source: transaction.source,
          categoryName: category?.name ?? "Uncategorized",
          posted: Boolean(transaction.entryId),
        };
      }),
    };
  },
});
