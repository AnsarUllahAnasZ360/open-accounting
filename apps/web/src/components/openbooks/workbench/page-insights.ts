/**
 * page-insights — the typed registry of per-page programmatic insight builders.
 *
 * Each operational page already queries one ledger-derived read-model
 * (coreViews / incomeViews / expensesViews / moduleViews). This module turns
 * that SAME read-model into the single most relevant plain-English one-liner the
 * page's <InsightBanner /> shows — no new server work, no invented numbers.
 *
 * Provenance (every number below traces to a posted-journal / invoice / bill
 * read-model, never a fixture or literal):
 *   - transactions → coreViews.transactions(...).insights
 *       (uncategorizedCount, netChangeMinor, counterparties)
 *   - income       → incomeViews.overview(...).kpis + .customers
 *       (overdueMinor, recurringMrrMinor, receivedThisMonthMinor)
 *   - expenses     → expensesViews.overview(...).kpis
 *       (biggestMoverName/DeltaPct, recurringMonthlyMinor, spentMinor)
 *   - contacts     → moduleViews.overview(...).contacts (rows + kpis)
 *       (moneyInYtdMinor rows, openReceivableMinor, overdueReceivableCount)
 *   - payroll      → moduleViews.overview(...).payroll
 *       (currencyTotals, headcount via runs, unmatchedCount)
 *   - bills        → moduleViews.overview(...).bills.kpis
 *       (openMinor, overdueMinor, dueSoonMinor)
 *   - dashboard    → coreViews.dashboard(...)
 *       (cashCushion.months, profitAndLoss.netIncomeMinor, cashPositionMinor)
 *
 * Builders are PURE: `(readModel) => PageInsight | null`. Returning null hides
 * the banner (threshold-gated, like NothingNotable) — never a filler line. This
 * file imports NO React and NO design-system code so it stays trivially unit
 * testable; <InsightBanner /> owns the rendering and the icon/tone mapping.
 */

/** The eight surfaces that mount a banner (Reports added in E6-T10). */
export type PageId =
  | "transactions"
  | "income"
  | "expenses"
  | "contacts"
  | "payroll"
  | "bills"
  | "dashboard"
  | "reports";

/**
 * Banner tone — a small finance-disciplined vocabulary that <InsightBanner />
 * maps to design-system surface/text tokens (no raw colors here):
 *   - neutral  → quiet muted surface (ordinary spend / informational)
 *   - income   → brand-green surface (money in / healthy)
 *   - ai       → quiet AI surface (model-assisted observation)
 *   - warning  → amber surface (attention, not an emergency)
 *   - negative → red surface (genuinely bad: overdue, runway-tight)
 * Ordinary spend is NEVER negative — only overdue / runway-tight earn it.
 */
export type InsightTone = "neutral" | "income" | "ai" | "warning" | "negative";

/** A lucide icon name resolved to an actual component by <InsightBanner />. */
export type InsightIcon =
  | "trending-up"
  | "trending-down"
  | "alert-circle"
  | "clock"
  | "repeat"
  | "users"
  | "wallet"
  | "receipt"
  | "list-checks"
  | "gauge"
  | "sparkles";

/** An optional drillable chip the banner renders after the text. */
export type InsightChip = {
  /** Short label, e.g. "Review 4". */
  label: string;
  /**
   * A stable key the page maps to a drill action (filter / drawer). Pages
   * decide what each key does; the registry only names the intent.
   */
  action:
    | "uncategorized"
    | "overdue-ar"
    | "biggest-mover"
    | "top-earner"
    | "unmatched-payroll"
    | "overdue-bills"
    | "runway";
};

/** The single insight a page renders, or null to hide the banner. */
export type PageInsight = {
  /** Plain-English one line written from the owner's side of the screen. */
  text: string;
  tone: InsightTone;
  icon: InsightIcon;
  chip?: InsightChip;
};

/* ------------------------------------------------------------------------- */
/* Minimal structural read-model shapes (only the fields each builder reads). */
/* These mirror the server return types so a field rename surfaces in tests.  */
/* ------------------------------------------------------------------------- */

export type TransactionsInsightsModel = {
  insights: {
    uncategorizedCount: number;
    netChangeMinor: number;
    counterparties: Array<{ label: string; amountMinor: number }>;
  };
} | null;

export type IncomeOverviewModel = {
  entity?: { currency?: string } | null;
  kpis: {
    receivedThisMonthMinor: number;
    overdueMinor: number;
    overdueInvoiceCount: number;
    recurringMrrMinor: number;
  };
  customers: Array<{ name: string; receivedMinor: number }>;
} | null;

export type ExpensesOverviewModel = {
  entity?: { currency?: string } | null;
  kpis: {
    spentMinor: number;
    recurringMonthlyMinor: number;
    biggestMoverName: string;
    biggestMoverDeltaPct: number | null;
    topVendorName: string;
    topVendorMinor: number;
  };
} | null;

export type ContactsOverviewModel = {
  entity?: { currency?: string } | null;
  contacts: {
    rows: Array<{
      name: string;
      archived: boolean;
      moneyInYtdMinor: number;
    }>;
    kpis: {
      openReceivableMinor: number;
      overdueReceivableCount: number;
      contactsCount: number;
    };
  };
} | null;

export type PayrollOverviewModel = {
  entity?: { currency?: string } | null;
  payroll: {
    currencyTotals: Array<{ currency: string; totalMinor: number }>;
    unmatchedCount: number;
    runs: Array<{ headcount: number; period: string }>;
    // E10-T6: the server-computed payroll insight (run-rate from approved-run
    // base totals, active headcount, FX-exposure share). Preferred over the
    // roster face-value rollup when present.
    insight?: {
      runRateBaseMinor: number;
      runRateBasedOnApprovedRun: boolean;
      headcount: number;
      baseCurrency: string;
      hasFxExposure: boolean;
      fxExposureSharePct: number;
      nonBaseCurrencies: string[];
    } | null;
  };
} | null;

export type BillsOverviewModel = {
  entity?: { currency?: string } | null;
  bills: {
    kpis: {
      openMinor: number;
      overdueMinor: number;
      dueSoonMinor: number;
    };
  };
} | null;

export type DashboardModel = {
  entity?: { currency?: string } | null;
  cashPositionMinor: number;
  profitAndLoss: { netIncomeMinor: number };
  cashCushion: { months: number | null };
} | null;

// E6-T10: the Reports surface derives its single insight from the already-loaded
// report pack (homePack — the most-recent full month). No new query. Only the
// few fields the builder reads are modelled here so a rename surfaces in tests.
export type ReportsInsightModel = {
  entity?: { currency?: string } | null;
  monthlyReview: { month: string; netResultMinor: number };
  arAging: { buckets: { days60Minor: number; days90Minor: number }; totalMinor: number };
} | null;

/* ------------------------------------------------------------------------- */
/* Money helper — minor units only, never a float math drift.                */
/* ------------------------------------------------------------------------- */

/**
 * Compact money string for banner copy, e.g. 1234567 → "$12.3K". Minor units in,
 * display string out — no stored float, no rounding of the underlying amount.
 */
export function compactMoney(amountMinor: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(amountMinor / 100);
}

/* ------------------------------------------------------------------------- */
/* Per-page builders. Each picks the ONE most relevant programmatic line.     */
/* ------------------------------------------------------------------------- */

function buildTransactions(model: TransactionsInsightsModel): PageInsight | null {
  if (!model) return null;
  const { uncategorizedCount, netChangeMinor, counterparties } = model.insights;

  // Highest-priority: uncategorized work to clear.
  if (uncategorizedCount > 0) {
    return {
      text: `${uncategorizedCount} transaction${uncategorizedCount === 1 ? "" : "s"} ${
        uncategorizedCount === 1 ? "needs" : "need"
      } a category this period.`,
      tone: "warning",
      icon: "list-checks",
      chip: { label: `Review ${uncategorizedCount}`, action: "uncategorized" },
    };
  }

  // Otherwise surface the net cash movement (green up, neutral down — never red
  // for ordinary outflow).
  const top = counterparties[0];
  if (top && Math.abs(netChangeMinor) > 0) {
    const direction = netChangeMinor >= 0 ? "up" : "down";
    const tone: InsightTone = netChangeMinor >= 0 ? "income" : "neutral";
    return {
      text: `Cash moved ${direction} by ${compactMoney(Math.abs(netChangeMinor))} this period; ${
        top.label
      } was the biggest line.`,
      tone,
      icon: netChangeMinor >= 0 ? "trending-up" : "trending-down",
    };
  }

  if (Math.abs(netChangeMinor) > 0) {
    const direction = netChangeMinor >= 0 ? "up" : "down";
    return {
      text: `Cash moved ${direction} by ${compactMoney(Math.abs(netChangeMinor))} this period.`,
      tone: netChangeMinor >= 0 ? "income" : "neutral",
      icon: netChangeMinor >= 0 ? "trending-up" : "trending-down",
    };
  }

  return null;
}

function buildIncome(model: IncomeOverviewModel): PageInsight | null {
  if (!model) return null;
  const currency = model.entity?.currency ?? "USD";
  const { overdueMinor, overdueInvoiceCount, recurringMrrMinor, receivedThisMonthMinor } = model.kpis;

  // Overdue receivables are the thing to chase — genuinely negative.
  if (overdueMinor > 0) {
    return {
      text: `${compactMoney(overdueMinor, currency)} is overdue across ${overdueInvoiceCount} invoice${
        overdueInvoiceCount === 1 ? "" : "s"
      } — worth a nudge.`,
      tone: "negative",
      icon: "clock",
      chip: { label: "View overdue", action: "overdue-ar" },
    };
  }

  // Recurring revenue is the healthiest thing to show when nothing is overdue.
  if (recurringMrrMinor > 0) {
    return {
      text: `Recurring revenue is running at ${compactMoney(recurringMrrMinor, currency)} a month.`,
      tone: "income",
      icon: "repeat",
    };
  }

  if (receivedThisMonthMinor > 0) {
    const top = model.customers.slice().sort((a, b) => b.receivedMinor - a.receivedMinor)[0];
    const lead = top ? ` ${top.name} led the way.` : "";
    return {
      text: `${compactMoney(receivedThisMonthMinor, currency)} came in this month.${lead}`,
      tone: "income",
      icon: "trending-up",
    };
  }

  return null;
}

function buildExpenses(model: ExpensesOverviewModel): PageInsight | null {
  if (!model) return null;
  const currency = model.entity?.currency ?? "USD";
  const { spentMinor, recurringMonthlyMinor, biggestMoverName, biggestMoverDeltaPct, topVendorName, topVendorMinor } =
    model.kpis;

  // A category that moved a lot is the most useful "look at this" — ordinary
  // spend stays neutral, never alarm red, even when it's up.
  if (biggestMoverName && biggestMoverDeltaPct !== null && Math.abs(biggestMoverDeltaPct) >= 10) {
    const direction = biggestMoverDeltaPct >= 0 ? "up" : "down";
    return {
      text: `${biggestMoverName} is ${direction} ${Math.abs(biggestMoverDeltaPct)}% versus last period.`,
      tone: "neutral",
      icon: biggestMoverDeltaPct >= 0 ? "trending-up" : "trending-down",
      chip: { label: "See category", action: "biggest-mover" },
    };
  }

  if (recurringMonthlyMinor > 0) {
    return {
      text: `Recurring expenses run about ${compactMoney(recurringMonthlyMinor, currency)} a month.`,
      tone: "neutral",
      icon: "repeat",
    };
  }

  if (topVendorName && topVendorMinor > 0) {
    return {
      text: `${topVendorName} was your largest expense at ${compactMoney(topVendorMinor, currency)}.`,
      tone: "neutral",
      icon: "receipt",
    };
  }

  if (spentMinor > 0) {
    return {
      text: `${compactMoney(spentMinor, currency)} spent this period.`,
      tone: "neutral",
      icon: "wallet",
    };
  }

  return null;
}

function buildContacts(model: ContactsOverviewModel): PageInsight | null {
  if (!model) return null;
  const currency = model.entity?.currency ?? "USD";
  const { rows, kpis } = model.contacts;

  // Overdue receivers across the directory are the one thing to act on.
  if (kpis.overdueReceivableCount > 0) {
    return {
      text: `${kpis.overdueReceivableCount} contact${kpis.overdueReceivableCount === 1 ? "" : "s"} ${
        kpis.overdueReceivableCount === 1 ? "owes" : "owe"
      } you past due — ${compactMoney(kpis.openReceivableMinor, currency)} open in all.`,
      tone: "warning",
      icon: "clock",
      chip: { label: "See who", action: "overdue-ar" },
    };
  }

  // Otherwise: who brings in the most money this year.
  const topEarner = rows
    .filter((row) => !row.archived && row.moneyInYtdMinor > 0)
    .sort((a, b) => b.moneyInYtdMinor - a.moneyInYtdMinor)[0];
  if (topEarner) {
    return {
      text: `${topEarner.name} is your top earner this year at ${compactMoney(topEarner.moneyInYtdMinor, currency)}.`,
      tone: "income",
      icon: "users",
      chip: { label: "Open contact", action: "top-earner" },
    };
  }

  if (kpis.contactsCount > 0) {
    return {
      text: `${kpis.contactsCount} active contact${kpis.contactsCount === 1 ? "" : "s"} in your directory.`,
      tone: "neutral",
      icon: "users",
    };
  }

  return null;
}

function buildPayroll(model: PayrollOverviewModel): PageInsight | null {
  if (!model) return null;
  const { currencyTotals, unmatchedCount, runs, insight } = model.payroll;

  // Unmatched payroll lines need a bank match — quiet attention.
  if (unmatchedCount > 0) {
    return {
      text: `${unmatchedCount} payroll payment${unmatchedCount === 1 ? "" : "s"} ${
        unmatchedCount === 1 ? "is" : "are"
      } still waiting to match a bank transaction.`,
      tone: "warning",
      icon: "alert-circle",
      chip: { label: "Match now", action: "unmatched-payroll" },
    };
  }

  // E10-T6: prefer the server-computed insight — run-rate from approved-run base
  // totals + active headcount + an FX-exposure note. This is ONE honest banner
  // (run-rate / headcount / FX) derived from ledger+run data, not face values.
  if (insight && insight.runRateBaseMinor > 0) {
    const headPart =
      insight.headcount > 0
        ? ` across ${insight.headcount} ${insight.headcount === 1 ? "person" : "people"}`
        : "";
    const fxPart = insight.hasFxExposure
      ? ` ${insight.fxExposureSharePct}% is paid in ${insight.nonBaseCurrencies.join("/") || "non-USD"} (FX-exposed).`
      : "";
    return {
      text: `Payroll runs about ${compactMoney(insight.runRateBaseMinor, insight.baseCurrency)} a month${headPart}.${fxPart}`,
      tone: "neutral",
      icon: "users",
    };
  }

  // Fallback: roster face-value run-rate + headcount (pre-approval / empty insight).
  const primary = currencyTotals.slice().sort((a, b) => b.totalMinor - a.totalMinor)[0];
  const headcount = insight?.headcount ?? runs[0]?.headcount ?? 0;
  if (primary && primary.totalMinor > 0) {
    const headPart = headcount > 0 ? ` across ${headcount} ${headcount === 1 ? "person" : "people"}` : "";
    return {
      text: `Payroll runs about ${compactMoney(primary.totalMinor, primary.currency)} a month${headPart}.`,
      tone: "neutral",
      icon: "users",
    };
  }

  if (headcount > 0) {
    return {
      text: `${headcount} ${headcount === 1 ? "person" : "people"} on the latest payroll run.`,
      tone: "neutral",
      icon: "users",
    };
  }

  return null;
}

function buildBills(model: BillsOverviewModel): PageInsight | null {
  if (!model) return null;
  const currency = model.entity?.currency ?? "USD";
  const { openMinor, overdueMinor, dueSoonMinor } = model.bills.kpis;

  // Overdue payables first — genuinely bad.
  if (overdueMinor > 0) {
    return {
      text: `${compactMoney(overdueMinor, currency)} in bills is overdue — pay these first.`,
      tone: "negative",
      icon: "clock",
      chip: { label: "View overdue", action: "overdue-bills" },
    };
  }

  // Then due-soon as a heads-up.
  if (dueSoonMinor > 0) {
    return {
      text: `${compactMoney(dueSoonMinor, currency)} in bills is due within the week.`,
      tone: "warning",
      icon: "clock",
    };
  }

  if (openMinor > 0) {
    return {
      text: `${compactMoney(openMinor, currency)} in open bills, none overdue — you're current.`,
      tone: "neutral",
      icon: "receipt",
    };
  }

  return null;
}

function buildDashboard(model: DashboardModel): PageInsight | null {
  if (!model) return null;
  const currency = model.entity?.currency ?? "USD";
  const months = model.cashCushion.months;
  const netIncomeMinor = model.profitAndLoss.netIncomeMinor;

  // Runway is the single most consequential number on the cockpit.
  if (months !== null && Number.isFinite(months) && months < 3) {
    return {
      text: `About ${months.toFixed(1)} month${months === 1 ? "" : "s"} of cash runway at the current burn — keep an eye on it.`,
      tone: months < 1.5 ? "negative" : "warning",
      icon: "gauge",
      chip: { label: "See cash", action: "runway" },
    };
  }

  // Otherwise lead with this month's profit/loss direction.
  if (netIncomeMinor !== 0) {
    const profit = netIncomeMinor > 0;
    return {
      text: profit
        ? `You're up ${compactMoney(netIncomeMinor, currency)} this month after expenses.`
        : `You're down ${compactMoney(Math.abs(netIncomeMinor), currency)} this month after expenses.`,
      tone: profit ? "income" : "neutral",
      icon: profit ? "trending-up" : "trending-down",
    };
  }

  if (months !== null && Number.isFinite(months)) {
    return {
      text: `About ${months.toFixed(1)} months of cash runway at the current burn — comfortable.`,
      tone: "income",
      icon: "gauge",
    };
  }

  if (model.cashPositionMinor > 0) {
    return {
      text: `${compactMoney(model.cashPositionMinor, currency)} cash on hand.`,
      tone: "neutral",
      icon: "wallet",
    };
  }

  return null;
}

// E6-T10: ONE small, report-relevant insight for the Reports surface, derived
// from the most-recent-full-month pack. Priority: aged AR (61+ days) is the most
// actionable money-at-risk signal an owner reads on Reports; otherwise the month's
// net result. Returns null (banner hidden) when neither crosses the threshold.
function buildReports(model: ReportsInsightModel): PageInsight | null {
  if (!model) return null;
  const currency = model.entity?.currency ?? "USD";
  const agedAr = model.arAging.buckets.days60Minor + model.arAging.buckets.days90Minor;

  if (agedAr > 0) {
    return {
      text: `${compactMoney(agedAr, currency)} of receivables are more than 60 days late — worth a nudge.`,
      tone: "warning",
      icon: "clock",
    };
  }

  const net = model.monthlyReview.netResultMinor;
  if (net !== 0) {
    const profit = net > 0;
    return {
      text: `${profit ? "Net profit" : "Net loss"} of ${compactMoney(Math.abs(net), currency)} for ${model.monthlyReview.month}.`,
      tone: profit ? "income" : "neutral",
      icon: profit ? "trending-up" : "trending-down",
    };
  }

  return null;
}

/**
 * The typed registry — page → pure builder over that page's read-model. Kept as
 * an object so a missing page is a compile error and tests can iterate it.
 */
export const pageInsightBuilders = {
  transactions: buildTransactions,
  income: buildIncome,
  expenses: buildExpenses,
  contacts: buildContacts,
  payroll: buildPayroll,
  bills: buildBills,
  dashboard: buildDashboard,
  reports: buildReports,
} as const;

/** Map of each page to the read-model type its builder consumes. */
export type PageReadModel = {
  transactions: TransactionsInsightsModel;
  income: IncomeOverviewModel;
  expenses: ExpensesOverviewModel;
  contacts: ContactsOverviewModel;
  payroll: PayrollOverviewModel;
  bills: BillsOverviewModel;
  dashboard: DashboardModel;
  reports: ReportsInsightModel;
};

/**
 * Build the page-specific insight for `page` from its already-queried
 * read-model. Returns null (banner hidden) when nothing crosses the threshold.
 */
export function buildPageInsight<P extends PageId>(
  page: P,
  readModel: PageReadModel[P],
): PageInsight | null {
  const builder = pageInsightBuilders[page] as (model: PageReadModel[P]) => PageInsight | null;
  return builder(readModel);
}
