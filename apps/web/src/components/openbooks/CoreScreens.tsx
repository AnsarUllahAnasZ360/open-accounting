"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Coins,
  FileText,
  Landmark,
  FileUp,
  History,
  Info,
  Layers2,
  Link2Off,
  type LucideIcon,
  Paperclip,
  Plug,
  Plus,
  ReceiptText,
  Sparkles,
  SplitSquareHorizontal,
  Tags,
  TrendingUp,
  Undo2,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import {
  Amount,
  CategoryChip,
  ConfidenceRing,
  EmptyState,
  formatMinorMoney,
} from "@/components/openbooks/primitives";
import {
  AgingBar,
  CashFlowChart,
  CashTrendChart,
  CustomerBars,
  Delta,
  ExpenseDonut,
  PayrollTrendChart,
  PnlTrendChart,
  RevenueStreamBars,
  RunwaySegments,
  shortMonth,
} from "@/components/openbooks/dashboard/DashboardViz";
import { TransactionsInsights } from "@/components/openbooks/InsightsScreen";
import {
  AccountMultiSelect,
  type ActiveChip,
  AddMenu,
  AiInsightBadge,
  AttentionState,
  type AttentionKind,
  AmountFilterPill,
  type AmountDirection,
  type AmountValue,
  type ColumnDef,
  DateRangeControl,
  dateRangeValueToISO,
  type DateRangePreset,
  type DateRangeValue,
  DetailSheet,
  type DisplaySettings,
  DisplaySettingsMenu,
  type FilterFacetSpec,
  FilterPanelButton,
  type FilterPanelValue,
  type GroupByKey,
  GroupByMenu,
  InlineCategoryCombobox,
  InsightBanner,
  InsightBannerExplain,
  buildPageInsight,
  evaluateSplitBalance,
  isAmountActive,
  type SavedView,
  type SortState,
  SortMenu,
  useIsMobile,
  useSavedViews,
  useWorkbenchUrlState,
  type WorkbenchConfig,
  WorkbenchSurface,
  type WorkbenchTableGroup,
} from "@/components/openbooks/workbench";
import { AttachmentPanel, CommentsThread } from "@/components/openbooks/TransactionDrawerExtras";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveEntity } from "@/lib/openbooks/active-entity";
import { todayIso } from "@/lib/openbooks/today";
import { cn } from "@/lib/utils";

type ReviewFilter = "all" | "auto" | "confirmed" | "needs_review" | "excluded";

function LoadingBlock({ label }: { label: string }) {
  return (
    <section className="rounded-[14px] p-4 text-sm text-muted-foreground shadow-xs ring-1 ring-foreground/10">
      Loading {label}...
    </section>
  );
}

function categoryLabel(kind: string) {
  return kind.replaceAll("_", " ");
}

// Reasoning strings can carry internal "Pipeline stage N" provenance that should
// never reach the owner. Strip that prefix and keep the plain explanation.
function humanizeReasoning(reasoning?: string | null) {
  if (!reasoning) return null;
  const cleaned = reasoning.replace(/^Pipeline stage \d+\s*/i, "").trim();
  return cleaned.length > 0 ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : null;
}

// E2-T11: a plain-English provenance line for a decided Inbox item, derived from
// the decision stage + confidence. This is the "Matched your rule" /
// "Same as your last 6 AWS charges" / "AI 0.82 — review" affordance.
function inboxProvenanceLine(args: {
  decidedBy?: string | null;
  confidence?: number | null;
  merchant: string;
  topMemoryOccurrences?: number | null;
}): string | null {
  const pct = args.confidence != null ? Math.round(args.confidence * 100) : null;
  switch (args.decidedBy) {
    case "rule":
      return "Matched your rule";
    case "memory":
      return args.topMemoryOccurrences && args.topMemoryOccurrences > 1
        ? `Same as your last ${args.topMemoryOccurrences} ${args.merchant} charges`
        : `Same as the last time you saw ${args.merchant}`;
    case "embedding":
      return `Looks like past ${args.merchant} charges`;
    case "plaid_prior":
      return "From your bank's category";
    case "transfer":
      return "Detected as a transfer";
    case "match":
      return "Matched an existing record";
    case "ai":
      return pct != null ? `AI ${pct}% — review` : "AI suggestion — review";
    default:
      return null;
  }
}

function entityArg(entityId?: string) {
  return entityId ? { entityId: entityId as Id<"entities"> } : {};
}

const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const TOPBAR_PAGE_ACTIONS_ID = "ob-topbar-page-actions";

function DashboardPeriodPortal({
  months,
  value,
  onValueChange,
}: {
  months: string[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const target = typeof document === "undefined" ? null : document.getElementById(TOPBAR_PAGE_ACTIONS_ID);
  if (!target) return null;

  return createPortal(
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label="Dashboard period"
        data-testid="dashboard-period"
        size="sm"
        className="w-[118px] sm:w-[138px]"
      >
        <CalendarDays className="text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {[...months].reverse().map((month) => (
            <SelectItem key={month} value={month}>
              {shortMonth(month)} {month.slice(0, 4)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>,
    target,
  );
}

// "2026-06" -> "June 2026" for the dashboard subtitle.
function longMonth(monthKey: string) {
  const month = Number(monthKey.slice(5, 7));
  return `${MONTH_NAMES_LONG[month - 1] ?? monthKey} ${monthKey.slice(0, 4)}`;
}

// "2026-07-10" -> "Jul 10" for compact due dates / activity timestamps.
function formatDay(iso: string) {
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return `${MONTH_NAMES_SHORT[month - 1] ?? ""} ${day}`.trim();
}

// Map a journal entry's source to a typed activity icon (no purple AI styling —
// the AI row just reads as a quiet green spark).
function activityIconFor(source: string): LucideIcon {
  switch (source) {
    case "ai":
      return Sparkles;
    case "rule":
      return Tags;
    case "invoice":
      return FileText;
    case "bill":
      return ReceiptText;
    case "payroll":
      return Users;
    case "stripe":
      return Coins;
    case "bank":
      return ArrowLeftRight;
    default:
      return History;
  }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function DashboardScreen() {
  return <SingleBusinessDashboard />;
}

function SingleBusinessDashboard() {
  // The period selector drives the query so it scopes every period-sensitive
  // widget (P&L snapshot, expense breakdown, income-by-customer, payroll) — not
  // just decoration. `null` lets the server pick the latest month with data.
  // The selected period also rides along every tile deep-link so the matching
  // workbench opens carrying the dashboard's active period (report 6.1).
  const { activeEntity, scope } = useActiveEntity();
  const [period, setPeriod] = useState<string | null>(null);
  // E4-T9: when the owner just finished onboarding the finish handler routes here
  // with ?setup=1 while the AI bulk categorize/post pass runs. Show a transient
  // "your books are being set up" banner; it auto-dismisses once posted items
  // land (the dashboard's live counts resolve into real numbers).
  const searchParams = useSearchParams();
  const justFinishedSetup = searchParams.get("setup") === "1";
  const dashboard = useQuery(api.coreViews.dashboard, {
    ...(scope === "all" ? { scope: "all" as const } : entityArg(activeEntity.id)),
    period: period ?? undefined,
    // E1-T11: anchor the trailing cash-flow window to the client's real "today"
    // so the trend ends at the current month rather than a server-side default.
    today: todayIso(),
  });

  if (dashboard === undefined) return <LoadingBlock label="dashboard" />;
  if (!dashboard) {
    return <EmptyState title="No entity yet" description="Create a business before reviewing the dashboard." />;
  }

  const month = dashboard.selectedMonth;
  // Every tile links into the matching workbench carrying the active period, so
  // the Dashboard summarizes and the register/lens owns the truth (report 6.1).
  const periodQuery = `period=${month}&start=${dashboard.periodStart}&end=${dashboard.periodEnd}`;
  const currency = dashboard.entity.currency ?? "USD";
  const obCard = "rounded-[14px] bg-card p-5 shadow-xs ring-1 ring-foreground/10";
  const obCardCol = `${obCard} flex flex-col gap-3`;
  // Hero cash trend = cumulative cash flow (the server's cashSparkline), by month.
  const cashTrend = dashboard.cashFlowByMonth.map((cashMonth, index) => ({
    label: shortMonth(cashMonth.month),
    value: dashboard.cashSparkline[index] ?? 0,
  }));
  const thisMonthNet = dashboard.cashFlowByMonth.find((cashMonth) => cashMonth.month === month)?.netMinor ?? 0;
  const recentFlow = dashboard.cashFlowByMonth.slice(-6);
  const avgNetMinor = Math.round(
    recentFlow.reduce((sum, cashMonth) => sum + cashMonth.netMinor, 0) / Math.max(1, recentFlow.length),
  );
  const allMonthsPositive = recentFlow.every((cashMonth) => cashMonth.netMinor >= 0);
  const pnl = dashboard.profitAndLoss;
  const topBankBalances = [...dashboard.bankBalances].sort((a, b) => b.amountMinor - a.amountMinor).slice(0, 3);
  const hiddenBankBalanceCount = Math.max(0, dashboard.bankBalances.length - topBankBalances.length);
  const totalDisplayedExpenseMinor = dashboard.expensesByCategory.reduce((sum, item) => sum + item.amountMinor, 0);
  const topExpense = dashboard.expensesByCategory[0] ?? null;
  const topExpenseSharePct = topExpense && totalDisplayedExpenseMinor > 0
    ? Math.round((topExpense.amountMinor / totalDisplayedExpenseMinor) * 100)
    : 0;
  const spendRatePct = pnl.incomeMinor > 0 ? Math.round((pnl.expenseMinor / pnl.incomeMinor) * 100) : 0;
  const topCustomerName = dashboard.incomeConcentration.topName || dashboard.incomeByCustomer[0]?.name || "Customer";
  const topCustomerSharePct = dashboard.incomeConcentration.topSharePct;

  return (
    <div className="flex flex-col gap-4" data-testid="dashboard-screen">
      <DashboardPeriodPortal
        months={dashboard.cashFlowByMonth.map((cashMonth) => cashMonth.month)}
        value={period ?? dashboard.selectedMonth}
        onValueChange={setPeriod}
      />

      {justFinishedSetup ? (
        <section
          data-testid="dashboard-setup-running"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[14px] border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground"
        >
          <Sparkles className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span>
            <span className="font-medium">Your books are being set up.</span> AI is
            categorizing and posting your synced history — confident items post to the
            ledger and the rest land in your Inbox. These numbers fill in as it runs.
          </span>
          <Link className="font-medium text-primary underline-offset-2 hover:underline" href="/inbox">
            Review in Inbox
          </Link>
        </section>
      ) : null}

      {/* E1-T8: "N transactions ($X) are unreviewed and excluded from these
          figures" — same source/shape as the Reports banner. Neutral, tabular,
          links to the Inbox; renders nothing when the backlog is empty. */}
      {dashboard.unreviewed.unreviewedCount > 0 ? (
        <section
          data-testid="dashboard-unreviewed-gap"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[14px] border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
        >
          <Info className="size-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium text-foreground tabular-nums" data-testid="dashboard-unreviewed-count">
              {dashboard.unreviewed.unreviewedCount}{" "}
              {dashboard.unreviewed.unreviewedCount === 1 ? "transaction" : "transactions"}
            </span>{" "}
            (
            <span className="tabular-nums">
              {formatMinorMoney(dashboard.unreviewed.unreviewedAbsMinor, { currency: "USD" })}
            </span>
            ) are unreviewed and excluded from these figures.
          </span>
          <Link className="font-medium text-foreground underline-offset-2 hover:underline" href="/inbox">
            Review in Inbox
          </Link>
        </section>
      ) : null}

      {/* Hero — cash position */}
      <section className={obCard}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium text-muted-foreground">Cash position</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Link className="hover:text-primary" href={`/transactions?${periodQuery}`}>
                <Amount
                  amountMinor={dashboard.cashPositionMinor}
                  className="text-[34px] font-semibold leading-none tracking-tight"
                />
              </Link>
              <span className="text-sm text-muted-foreground">
                <Amount amountMinor={thisMonthNet} signed tone={thisMonthNet >= 0 ? "income" : "neutral"} /> this month
              </span>
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              {dashboard.bankBalances.length} {dashboard.bankBalances.length === 1 ? "account" : "accounts"}
              {dashboard.creditCardBalanceMinor !== 0 ? (
                <>
                  {" · card balance "}
                  <Amount amountMinor={dashboard.creditCardBalanceMinor} />
                </>
              ) : null}
            </div>
            {dashboard.cashReconciliation.differenceMinor !== 0 ? (
              <div
                className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground"
                data-testid="dashboard-cash-reconciliation"
              >
                <span>
                  Bank says <Amount amountMinor={dashboard.cashReconciliation.bankCashMinor} className="font-medium text-foreground" />
                </span>
                <span aria-hidden>·</span>
                <span>
                  Books say <Amount amountMinor={dashboard.cashReconciliation.booksCashMinor} className="font-medium text-foreground" />
                </span>
                {dashboard.cashReconciliation.itemsToReviewCount > 0 ? (
                  <>
                    <span aria-hidden>·</span>
                    <Link className="font-medium text-foreground hover:text-primary" href={`/inbox`}>
                      {dashboard.cashReconciliation.itemsToReviewCount} to review
                    </Link>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="w-full lg:max-w-[320px]">
            <CashTrendChart data={cashTrend} currency={currency} />
          </div>
        </div>
        {dashboard.bankBalances.length > 0 ? (
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
            {topBankBalances.map((account) => (
              <Link
                key={account.id}
                href={`/transactions?account=${account.id}&${periodQuery}`}
                className="flex min-w-0 items-center gap-2 rounded-[10px] border border-border bg-muted/40 px-3 py-2 transition-colors hover:bg-muted"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground/85 text-[10px] font-semibold uppercase text-background">
                  {account.name.slice(0, 2)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{account.name}</span>
                <span className="money-figures shrink-0 text-[11px] text-muted-foreground">····{account.mask}</span>
                <Amount amountMinor={account.amountMinor} className="shrink-0 text-xs font-semibold" />
              </Link>
            ))}
            {hiddenBankBalanceCount > 0 ? (
              <Button asChild size="sm" variant="outline" className="h-10 shrink-0 rounded-[10px] px-3">
                <Link href={`/transactions?${periodQuery}`}>
                  Show all {dashboard.bankBalances.length}
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Row A — profit & loss · where money went · inbox */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className={obCardCol}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Profit &amp; loss</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {pnl.marginPct}% margin
            </span>
          </div>
          <div className="flex flex-col gap-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Income</span>
              <Link className="hover:text-primary" href={`/income?${periodQuery}`}>
                <Amount amountMinor={pnl.incomeMinor} tone="income" className="font-semibold" />
              </Link>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Expenses</span>
              <Link className="hover:text-primary" href={`/expenses?${periodQuery}`}>
                <Amount amountMinor={pnl.expenseMinor} className="font-semibold" />
              </Link>
            </div>
          </div>
          <div className="border-t pt-2.5">
            <div className="text-xs text-muted-foreground">Net profit</div>
            <div className="flex items-baseline gap-2">
              <Link className="hover:text-primary" href={`/reports?report=profit-and-loss&${periodQuery}`}>
                <Amount amountMinor={pnl.netIncomeMinor} className="text-2xl font-semibold tracking-tight" />
              </Link>
              <Delta current={pnl.netIncomeMinor} previous={pnl.previousNetIncomeMinor} />
            </div>
          </div>
          <div className="mt-auto pt-1">
            <PnlTrendChart data={dashboard.profitAndLossTrend} currency={currency} />
          </div>
        </div>

        <Link
          href={`/reports?report=expenses&${periodQuery}`}
          className={cn(obCardCol, "transition-shadow hover:ring-foreground/20")}
        >
          <h2 className="text-sm font-semibold">Where money went</h2>
          {dashboard.expensesByCategory.length > 0 ? (
            <>
              <ExpenseDonut data={dashboard.expensesByCategory} currency={currency} />
              <div className="mt-auto grid grid-cols-2 gap-2 border-t pt-3 text-xs">
                <div className="min-w-0">
                  <div className="text-muted-foreground">Largest cost</div>
                  <div className="truncate font-medium">
                    {topExpense?.name ?? "Expense"} · {topExpenseSharePct}%
                  </div>
                </div>
                <div className="min-w-0 text-right">
                  <div className="text-muted-foreground">Spend rate</div>
                  <div className="font-medium">{spendRatePct}% of income</div>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No expenses booked this period.</p>
          )}
        </Link>

        <div className={obCardCol}>
          <h2 className="text-sm font-semibold">Inbox</h2>
          {dashboard.inbox.openCount > 0 ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="money-figures text-3xl font-semibold tracking-tight">{dashboard.inbox.openCount}</span>
                <span className="text-sm text-muted-foreground">items need you</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {dashboard.inbox.byKind.map((item) => (
                  <span
                    key={item.kind}
                    className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
                  >
                    {inboxKindLabel(item.kind)}
                    <span className="money-figures font-semibold text-foreground">{item.count}</span>
                  </span>
                ))}
              </div>
              <Button asChild className="mt-auto">
                <Link href="/inbox">Open inbox</Link>
              </Button>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-4 text-center">
              <span className="flex size-9 items-center justify-center rounded-full bg-ob-green-50">
                <Check className="size-4 text-ob-green-700" />
              </span>
              <div className="text-sm font-medium">Books up to date</div>
              <div className="text-xs text-muted-foreground">{dashboard.inbox.automationRate}% automated this month</div>
            </div>
          )}
        </div>
      </section>

      {/* Row B — owed to you · you owe · payroll */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Link href={`/income?${periodQuery}`} className={cn(obCardCol, "transition-shadow hover:ring-foreground/20")}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Owed to you</h2>
            <span className="text-xs text-muted-foreground">A/R</span>
          </div>
          <Amount amountMinor={dashboard.receivables.openMinor} className="text-2xl font-semibold tracking-tight" />
          <AgingBar buckets={dashboard.receivables.aging} />
          <div className="text-xs text-muted-foreground">
            {dashboard.receivables.averageDaysToPay > 0
              ? `Paid in ~${dashboard.receivables.averageDaysToPay} days avg (net terms)`
              : "No payment history yet"}
          </div>
          {dashboard.receivables.overdue.length > 0 ? (
            <div className="mt-auto flex flex-col gap-1.5 pt-1">
              {dashboard.receivables.overdue.map((item, index) => (
                <div key={`${item.contactId}-${item.daysLate}-${item.amountMinor}-${index}`} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="text-negative">{item.daysLate}d late</span>
                  <Amount amountMinor={item.amountMinor} className="font-medium" />
                </div>
              ))}
            </div>
          ) : null}
        </Link>

        <Link href="/expenses/bills" className={cn(obCardCol, "transition-shadow hover:ring-foreground/20")}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">You owe</h2>
            <span className="text-xs text-muted-foreground">A/P</span>
          </div>
          <Amount amountMinor={dashboard.payables.openMinor} className="text-2xl font-semibold tracking-tight" />
          <div className="text-xs text-muted-foreground">
            {dashboard.payables.dueThisWeekMinor > 0 ? (
              <>
                <Amount amountMinor={dashboard.payables.dueThisWeekMinor} className="font-medium text-foreground" /> due this week
              </>
            ) : (
              `${dashboard.payables.dueSoonCount} due soon`
            )}
          </div>
          {dashboard.payables.upcoming.length > 0 ? (
            <div className="mt-auto flex flex-col gap-1.5 pt-1">
              {dashboard.payables.upcoming.map((bill) => (
                <div key={`${bill.contactId}-${bill.dueDate}`} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">{bill.vendor}</span>
                  <span className="text-muted-foreground">{formatDay(bill.dueDate)}</span>
                  <Amount amountMinor={bill.amountMinor} className="font-medium" />
                </div>
              ))}
            </div>
          ) : null}
        </Link>

        <Link href="/payroll" className={cn(obCardCol, "transition-shadow hover:ring-foreground/20")}>
          <h2 className="text-sm font-semibold">Payroll</h2>
          {dashboard.payroll ? (
            <>
              <div>
                <div className="text-xs text-muted-foreground">Last run · {longMonth(dashboard.payroll.period)}</div>
                <Amount amountMinor={dashboard.payroll.totalBaseMinor} className="text-2xl font-semibold tracking-tight" />
              </div>
              {dashboard.payrollMeta && dashboard.payrollMeta.currencies.length > 0 ? (
                <div className="money-figures text-xs text-muted-foreground">
                  {dashboard.payrollMeta.currencies
                    .slice(0, 3)
                    .map((entry) => formatMinorMoney(entry.localMinor, { currency: entry.currency, compact: true }))
                    .join(" · ")}
                </div>
              ) : null}
              <div className="mt-auto flex flex-col gap-2 pt-1">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Last 3 months</span>
                  {dashboard.payrollMeta && dashboard.payrollMeta.headcount > 0 ? (
                    <span>{dashboard.payrollMeta.headcount} people</span>
                  ) : null}
                </div>
                <PayrollTrendChart data={dashboard.payrollTrend} currency={currency} />
                {dashboard.payrollMeta ? (
                  <div className="flex items-center gap-1.5 border-t pt-2 text-xs text-muted-foreground">
                    <CalendarDays className="size-3.5" />
                    Next run {formatDay(dashboard.payrollMeta.nextRunDate)}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No payroll run yet.</p>
          )}
        </Link>
      </section>

      {/* Row C — income by customer · cash flow */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className={obCardCol}>
          <h2 className="text-sm font-semibold">Income by customer</h2>
          {dashboard.incomeByCustomer.length > 0 ? (
            <CustomerBars data={dashboard.incomeByCustomer} currency={currency} />
          ) : (
            <p className="text-sm text-muted-foreground">No customer income this period.</p>
          )}
          {dashboard.incomeByCustomer.length > 0 ? (
            <div
              className={cn(
                "mt-auto grid gap-2 rounded-[10px] px-3 py-2 text-xs sm:grid-cols-[1fr_auto]",
                topCustomerSharePct > 50 ? "bg-warning-surface text-warning" : "bg-muted/60 text-muted-foreground",
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {topCustomerSharePct > 50 ? <CircleAlert className="size-3.5 shrink-0" /> : null}
                  <span>{topCustomerSharePct > 50 ? "Concentration risk" : "Top customer"}</span>
                </div>
                <div className="truncate font-medium text-foreground">{topCustomerName}</div>
              </div>
              <div className="sm:text-right">
                <div>{topCustomerSharePct}% of revenue</div>
                <div className="font-medium text-foreground">
                  {formatMinorMoney(dashboard.incomeConcentration.totalMinor, { currency, compact: true })} total
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className={obCardCol}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Cash flow</h2>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-[3px] bg-primary" />
                In
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-[3px]" style={{ background: "#cbd2d9" }} />
                Out
              </span>
            </div>
          </div>
          <CashFlowChart data={recentFlow} currency={currency} />
          <div className="mt-auto flex flex-wrap items-center gap-x-1 border-t pt-2.5 text-xs text-muted-foreground">
            <TrendingUp className="size-3.5 text-ob-green-600" />
            {allMonthsPositive ? "Net positive every month · " : ""}avg
            <Amount amountMinor={avgNetMinor} className="font-semibold text-ob-green-700" />
            /mo
          </div>
        </div>
      </section>

      {/* Revenue by stream (E9-T8) — owner-approved stream taxonomy over income
          accounts; the row total reconciles to Reports P&L revenue. */}
      {dashboard.revenueByStream.length > 0 ? (
        <section className={obCardCol}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Revenue by stream</h2>
            <Link className="text-xs text-muted-foreground hover:text-primary" href={`/income?${periodQuery}`}>
              Income
              <ArrowUpRight className="ml-0.5 inline size-3" />
            </Link>
          </div>
          <RevenueStreamBars data={dashboard.revenueByStream} currency={currency} />
          <div className="mt-auto flex items-center justify-between border-t pt-2.5 text-xs text-muted-foreground">
            Total this period
            <Amount amountMinor={dashboard.profitAndLoss.incomeMinor} tone="income" className="font-semibold" />
          </div>
        </section>
      ) : null}

      {/* Row D — cash cushion · coming up */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className={obCardCol}>
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold">Cash cushion</h2>
            <span className="text-xs text-muted-foreground">if income stopped today</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="money-figures text-2xl font-semibold tracking-tight">{dashboard.cashCushion.months}</span>
            <span className="text-sm text-muted-foreground">months of expenses in the bank</span>
          </div>
          <RunwaySegments months={dashboard.cashCushion.months} />
          <div className="text-xs text-muted-foreground">
            An average month costs{" "}
            <Amount amountMinor={dashboard.cashCushion.avgMonthlyExpenseMinor} className="text-foreground" /> all-in.
          </div>
        </div>

        <div className={obCardCol}>
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold">Coming up</h2>
            <span className="text-xs text-muted-foreground">next 30 days</span>
          </div>
          {dashboard.comingUp.items.length > 0 ? (
            <div className="flex flex-col gap-2">
              {dashboard.comingUp.items.map((item, index) => (
                <div key={`${item.label}-${index}`} className="flex items-center gap-2 text-xs">
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: item.amountMinor > 0 ? "var(--ob-green-500)" : "#cbd2d9" }}
                  />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <span className="text-muted-foreground">{formatDay(item.when)}</span>
                  <Amount
                    amountMinor={item.amountMinor}
                    signed
                    className={cn("font-medium", item.amountMinor > 0 && "text-ob-green-600")}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing scheduled in the next 30 days.</p>
          )}
          <div className="mt-auto flex items-center justify-between border-t pt-2.5 text-xs text-muted-foreground">
            Expected net impact
            <Amount
              amountMinor={dashboard.comingUp.netMinor}
              signed
              tone={dashboard.comingUp.netMinor >= 0 ? "income" : "neutral"}
              className="font-semibold"
            />
          </div>
        </div>
      </section>

      {/* Activity stream */}
      <section className={obCard}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Activity</h2>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/reports?report=cash-flow&${periodQuery}`}>
              Reports
              <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        </div>
        {dashboard.recentActivity.length > 0 ? (
          <div className="flex flex-col">
            {dashboard.recentActivity.map((entry) => {
              const Icon = activityIconFor(entry.source);
              const positive = entry.source === "ai" || entry.source === "invoice";
              return (
                <div key={entry.id} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50">
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-lg",
                      positive ? "bg-ob-green-50 text-ob-green-700" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{entry.memo}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDay(entry.date)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No recent activity.</p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inbox — focused exception-resolution queue (report 6.2)
// ---------------------------------------------------------------------------

type InboxItem = NonNullable<ReturnType<typeof useInboxData>>["items"][number];

function useInboxData() {
  const { activeEntity } = useActiveEntity();
  return useQuery(api.coreViews.inbox, entityArg(activeEntity.id)) ?? null;
}

// Owner-language section labels — the raw kind strings (payout_mismatch,
// connection) never reach the screen (report 6.2).
type InboxKind = InboxItem["kind"];

const INBOX_GROUPS: Array<{ kind: InboxKind; label: string; icon: LucideIcon }> = [
  { kind: "categorize", label: "Needs a category", icon: Tags },
  { kind: "receipt", label: "Receipts to match", icon: ReceiptText },
  { kind: "transfer", label: "Possible transfers", icon: ArrowLeftRight },
  { kind: "payout_mismatch", label: "Payout issues", icon: CircleAlert },
  { kind: "connection", label: "Connections", icon: Plug },
  { kind: "question", label: "Questions for you", icon: Sparkles },
];

function inboxKindLabel(kind: string) {
  return INBOX_GROUPS.find((group) => group.kind === kind)?.label ?? categoryLabel(kind);
}

// The pipeline tags a needs-review transaction "question" when the AI attaches a
// clarifying question, but it is still a categorization task with a transaction
// and a proposed category. Resolve it to "categorize" so the owner can confirm a
// category inline (the question is surfaced as context); only a question WITHOUT
// a transaction stays a pure assistant prompt.
function resolvedKind(item: InboxItem): InboxKind {
  if (item.kind === "question" && item.transactionId) return "categorize";
  return item.kind;
}

export function InboxScreen() {
  const { activeEntity } = useActiveEntity();
  const inbox = useInboxData();
  // E2-T11: surface the self-rescheduling drainer's (E2-T3) latest progress so
  // the owner sees the backlog clearing in the background.
  const batchRuns = useQuery(
    api.ai.latestCategorizationBatchRuns,
    activeEntity.id ? { entityId: activeEntity.id as Id<"entities">, limit: 1 } : "skip",
  );
  const confirmTransaction = useMutation(api.pipeline.confirmTransaction);
  const excludeTransaction = useMutation(api.pipeline.excludeTransaction);
  const createRuleFromTransaction = useMutation(api.pipeline.createRuleFromTransaction);
  const confirmReceiptMatch = useMutation(api.receipts.manualMatch);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string>("");
  const [createRule, setCreateRule] = useState(false);
  const [checkedItemIds, setCheckedItemIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const isMobile = useIsMobile();

  const items = useMemo(() => inbox?.items ?? [], [inbox]);
  // Visual (grouped) order so J/K walk the list exactly as it reads on screen.
  const orderedItems = useMemo(
    () =>
      INBOX_GROUPS.flatMap((group) => items.filter((item) => resolvedKind(item) === group.kind)),
    [items],
  );
  // Detail is CLOSED until the user picks a row — no auto-open fallback.
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );
  const chosenCategoryId = categoryId || selected?.categoryAccountId || inbox?.categoryOptions[0]?.id || "";
  const selectedIndex = orderedItems.findIndex((item) => item.id === selected?.id);
  const selectedReceipt = selected?.receiptDocument ?? null;
  const selectedBatchItems = items.filter(
    (item) => checkedItemIds.has(item.id) && item.transactionId && item.kind !== "receipt",
  );

  const clearChecked = useCallback((id: string) => {
    setCheckedItemIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  function selectItem(item: InboxItem) {
    setSelectedId(item.id);
    setCategoryId(item.categoryAccountId ?? "");
    setCreateRule(false);
    setMessage("");
  }

  const confirmSelected = useCallback(async () => {
    if (!selected || selected.kind === "receipt" || !selected.transactionId || !chosenCategoryId) return;
    setPending(true);
    setMessage("");
    try {
      await confirmTransaction({
        transactionId: selected.transactionId as Id<"transactions">,
        categoryAccountId: chosenCategoryId as Id<"ledgerAccounts">,
      });
      if (createRule) {
        await createRuleFromTransaction({
          transactionId: selected.transactionId as Id<"transactions">,
          categoryAccountId: chosenCategoryId as Id<"ledgerAccounts">,
        });
      }
      setCategoryId("");
      clearChecked(selected.id);
      setMessage(
        createRule
          ? "This item was confirmed and posted through the ledger, and saved as a rule for next time."
          : "This item was confirmed and posted through the ledger.",
      );
    } finally {
      setPending(false);
    }
  }, [selected, chosenCategoryId, createRule, confirmTransaction, createRuleFromTransaction, clearChecked]);

  // E2-T11: accept a Top-N suggestion — selects that category AND confirms it
  // through the existing pipeline mutation (no new ledger path), so a single
  // click posts the item.
  const acceptSuggestion = useCallback(
    async (accountId: string) => {
      if (!selected || selected.kind === "receipt" || !selected.transactionId) return;
      setCategoryId(accountId);
      setPending(true);
      setMessage("");
      try {
        await confirmTransaction({
          transactionId: selected.transactionId as Id<"transactions">,
          categoryAccountId: accountId as Id<"ledgerAccounts">,
        });
        setCategoryId("");
        clearChecked(selected.id);
        setMessage("This item was confirmed and posted through the ledger.");
      } finally {
        setPending(false);
      }
    },
    [selected, confirmTransaction, clearChecked],
  );

  const excludeSelected = useCallback(async () => {
    if (!selected || selected.kind === "receipt" || !selected.transactionId) return;
    setPending(true);
    setMessage("");
    try {
      await excludeTransaction({
        transactionId: selected.transactionId as Id<"transactions">,
        reason: "Excluded from Inbox review.",
      });
      clearChecked(selected.id);
      setMessage("Excluded; any posted entry was reversed.");
    } finally {
      setPending(false);
    }
  }, [selected, excludeTransaction, clearChecked]);

  const confirmReceiptSelected = useCallback(async () => {
    if (!selectedReceipt || !selected?.transactionId) return;
    setPending(true);
    setMessage("");
    try {
      await confirmReceiptMatch({
        documentId: selectedReceipt.id as Id<"documents">,
        transactionId: selected.transactionId as Id<"transactions">,
      });
      clearChecked(selected.id);
      setMessage("Receipt match confirmed. The transaction now carries the receipt.");
    } finally {
      setPending(false);
    }
  }, [selectedReceipt, selected, confirmReceiptMatch, clearChecked]);

  const confirmBatch = useCallback(async () => {
    if (!selectedBatchItems.length) return;
    setPending(true);
    setMessage("");
    try {
      for (const item of selectedBatchItems) {
        const categoryForItem = item.categoryAccountId || inbox?.categoryOptions[0]?.id;
        if (!item.transactionId || !categoryForItem) continue;
        await confirmTransaction({
          transactionId: item.transactionId as Id<"transactions">,
          categoryAccountId: categoryForItem as Id<"ledgerAccounts">,
        });
      }
      const count = selectedBatchItems.length;
      setCheckedItemIds(new Set());
      setMessage(`${count} Inbox cards confirmed.`);
    } finally {
      setPending(false);
    }
  }, [selectedBatchItems, inbox, confirmTransaction]);

  async function saveRuleFromSelected() {
    if (!selected || selected.kind === "receipt" || !selected.transactionId || !chosenCategoryId) return;
    setPending(true);
    setMessage("");
    try {
      await createRuleFromTransaction({
        transactionId: selected.transactionId as Id<"transactions">,
        categoryAccountId: chosenCategoryId as Id<"ledgerAccounts">,
      });
      setMessage("Rule saved for future matching.");
    } finally {
      setPending(false);
    }
  }

  // Keyboard nav: J/K move, Enter confirm, E exclude, Cmd/Ctrl+Enter batch.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void confirmBatch();
        return;
      }
      if (target?.closest("input, textarea, select, button, [role='combobox'], [role='dialog']")) return;
      if (!orderedItems.length || pending) return;
      const key = event.key.toLowerCase();
      if (key === "j") {
        event.preventDefault();
        const next = orderedItems[Math.min(orderedItems.length - 1, Math.max(0, selectedIndex) + 1)];
        if (next) selectItem(next);
      } else if (key === "k") {
        event.preventDefault();
        const previous = orderedItems[Math.max(0, Math.max(0, selectedIndex) - 1)];
        if (previous) selectItem(previous);
      } else if (key === "e") {
        event.preventDefault();
        void excludeSelected();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (selectedReceipt) void confirmReceiptSelected();
        else void confirmSelected();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (inbox === null) return <LoadingBlock label="Inbox" />;
  if (items.length === 0) {
    return <EmptyState title="Inbox zero" description="There are no open review cards for the active entity." />;
  }

  const grouped = INBOX_GROUPS.map((group) => ({
    ...group,
    rows: items.filter((item) => resolvedKind(item) === group.kind),
  })).filter((group) => group.rows.length > 0);

  const detailProps: InboxDetailProps | null = selected
    ? {
        item: selected,
        categoryOptions: inbox.categoryOptions,
        chosenCategoryId,
        onCategoryChange: setCategoryId,
        createRule,
        onCreateRuleChange: setCreateRule,
        onConfirm: confirmSelected,
        onExclude: excludeSelected,
        onSaveRule: saveRuleFromSelected,
        onConfirmReceipt: confirmReceiptSelected,
        onAcceptSuggestion: acceptSuggestion,
        pending,
      }
    : null;

  const list = (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col bg-background",
        isMobile ? "rounded-[14px] shadow-xs ring-1 ring-foreground/10" : "border-r",
      )}
      data-testid="inbox-list"
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col">
          {grouped.map((group) => {
            const GroupIcon = group.icon;
            return (
              <div key={group.kind}>
                <div className="sticky top-0 z-20 flex items-center gap-2 border-y bg-background px-4 py-2 text-xs font-medium text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))]">
                  <GroupIcon className="size-3.5" />
                  {group.label}
                  <span className="money-figures ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground">
                    {group.rows.length}
                  </span>
                </div>
                {group.rows.map((item) => (
                  <InboxListRow
                    key={item.id}
                    item={item}
                    selected={item.id === selected?.id}
                    checked={checkedItemIds.has(item.id)}
                    onSelect={() => selectItem(item)}
                    onCheckedChange={(checked) => {
                      if (item.kind === "receipt") return;
                      setCheckedItemIds((current) => {
                        const next = new Set(current);
                        if (checked) next.add(item.id);
                        else next.delete(item.id);
                        return next;
                      });
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </ScrollArea>
      {/* Action result lives at the queue level so it survives an item being
          resolved (and the detail panel closing) after a confirm. */}
      {message ? (
        <div className="border-t bg-primary/5 px-3 py-2 text-sm text-primary" data-testid="inbox-message">
          {message}
        </div>
      ) : null}
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-t bg-background px-3 py-2 text-xs text-muted-foreground">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <InboxKeyHint keys={["J", "K"]} label="move" />
          <InboxKeyHint keys={["Enter"]} label="confirm" />
          <InboxKeyHint keys={["E"]} label="exclude" />
        </div>
        {selectedBatchItems.length > 0 ? (
          <Button
            size="xs"
            data-testid="inbox-confirm-selected"
            disabled={pending}
            onClick={confirmBatch}
          >
            <Check data-icon="inline-start" />
            Confirm {selectedBatchItems.length}
          </Button>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            {/* E2-T11: drainer progress so the background backlog clearing
                (E2-T3) is visible while items resolve. */}
            {batchRuns && batchRuns.length > 0 ? (
              <span
                className="hidden truncate rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground sm:inline"
                data-testid="inbox-batch-progress"
                title={batchRuns[0].summary}
              >
                {batchRuns[0].summary}
              </span>
            ) : null}
            <span
              className="money-figures rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground"
              data-testid="inbox-unreviewed-count"
            >
              {items.length} unreviewed
            </span>
          </div>
        )}
      </div>
    </div>
  );

  // Mobile: the detail opens in a bottom Drawer over the list (report 8.3); the
  // action cluster rides the Drawer's own footer so it never wraps into content.
  if (isMobile) {
    return (
      <>
        {list}
        <DetailSheet
          open={selected != null}
          onOpenChange={(open) => {
            if (!open) setSelectedId(null);
          }}
          title={<span data-testid="inbox-detail-title">{selected?.merchant ?? ""}</span>}
          subtitle={selected?.summary}
          footer={detailProps ? <InboxDetailActions {...detailProps} /> : null}
        >
          {detailProps ? <InboxDetailContent {...detailProps} /> : null}
        </DetailSheet>
      </>
    );
  }

  // Desktop: one split workbench surface. The queue owns the left pane; the
  // detail pane shares the same outer border so the page reads as two sections,
  // not two competing cards.
  return (
    <section className="grid h-full min-h-0 overflow-hidden rounded-[14px] border bg-background shadow-xs lg:grid-cols-[360px_minmax(0,1fr)]">
      {list}
      <div className="min-h-0 min-w-0 overflow-hidden bg-background">
        {detailProps ? (
          <InboxDetailPanel {...detailProps} />
        ) : (
          <div className="flex h-full min-h-[360px] items-center justify-center px-8 text-center">
            <div className="max-w-md">
              <span className="mx-auto flex size-12 items-center justify-center rounded-[14px] bg-muted text-muted-foreground">
                <FileText className="size-6" strokeWidth={1.5} />
              </span>
              <h2 className="mt-4 text-base font-semibold">Pick an item to resolve</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Select a card on the left, or press J to start at the top. Each card explains why it needs you and
                what posts when you confirm.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function InboxKeyHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {keys.map((key) => (
        <kbd
          key={key}
          className="money-figures rounded-[6px] border bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-foreground"
        >
          {key}
        </kbd>
      ))}
      <span>{label}</span>
    </span>
  );
}

function InboxListRow({
  item,
  selected,
  checked,
  onSelect,
  onCheckedChange,
}: {
  item: InboxItem;
  selected: boolean;
  checked: boolean;
  onSelect: () => void;
  onCheckedChange: (checked: boolean) => void;
}) {
  const Icon = INBOX_GROUPS.find((group) => group.kind === resolvedKind(item))?.icon ?? Tags;
  const moneyIn = item.amountMinor > 0;
  return (
    <div
      className={cn(
        "grid w-full grid-cols-[auto_auto_1fr] items-start gap-3 border-b border-l-2 border-l-transparent px-4 py-3 text-left text-sm outline-none transition-colors hover:bg-muted/60 focus-visible:bg-primary/5 focus-visible:ring-2 focus-visible:ring-primary/20",
        selected && "border-l-primary bg-primary/5 hover:bg-primary/10",
      )}
      data-has-transaction={item.transactionId ? "true" : "false"}
      data-kind={item.kind}
      data-testid="inbox-item"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <span className="pt-0.5" onClick={(event) => event.stopPropagation()}>
        <Checkbox
          checked={checked}
          disabled={item.kind === "receipt"}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          aria-label={`Select ${item.merchant}`}
        />
      </span>
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[10px] bg-muted text-muted-foreground">
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{item.merchant}</span>
          <Amount amountMinor={item.amountMinor} tone={moneyIn ? "income" : "neutral"} className="shrink-0" />
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="truncate text-xs text-muted-foreground">{item.categoryName}</span>
          {resolvedKind(item) === "categorize" && item.confidence != null ? (
            <span className="ml-auto shrink-0">
              <ConfidenceRing value={Math.round(item.confidence * 100)} />
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InboxDetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[14px] px-3 py-2 ring-1 ring-foreground/10">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 min-w-0 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function InboxImpactNote({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-[14px] bg-muted/50 p-3 text-sm text-muted-foreground">
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

type InboxDetailProps = {
  item: InboxItem;
  categoryOptions: NonNullable<ReturnType<typeof useInboxData>>["categoryOptions"];
  chosenCategoryId: string;
  onCategoryChange: (id: string) => void;
  createRule: boolean;
  onCreateRuleChange: (value: boolean) => void;
  onConfirm: () => void;
  onExclude: () => void;
  onSaveRule: () => void;
  onConfirmReceipt: () => void;
  onAcceptSuggestion: (accountId: string) => void;
  pending: boolean;
};

// The action cluster, shared between the desktop panel (sticky footer) and the
// mobile drawer (DetailSheet footer), so the buttons read the same everywhere.
function InboxDetailActions({
  item,
  chosenCategoryId,
  onConfirm,
  onExclude,
  onSaveRule,
  onConfirmReceipt,
  pending,
}: Pick<
  InboxDetailProps,
  "item" | "chosenCategoryId" | "onConfirm" | "onExclude" | "onSaveRule" | "onConfirmReceipt" | "pending"
>) {
  const kind = resolvedKind(item);
  if (kind === "receipt") {
    return (
      <>
        <Button data-testid="receipt-confirm-match" onClick={onConfirmReceipt} disabled={pending || !item.transactionId}>
          <Check data-icon="inline-start" />
          Confirm receipt match
        </Button>
        <Button asChild variant="outline">
          <Link href="/transactions">
            <ArrowRight data-icon="inline-start" />
            Pick a different transaction
          </Link>
        </Button>
      </>
    );
  }
  if (kind === "categorize") {
    return (
      <>
        <Button data-testid="inbox-confirm" onClick={onConfirm} disabled={pending || !item.transactionId || !chosenCategoryId}>
          <Check data-icon="inline-start" />
          Confirm and post
        </Button>
        <Button variant="outline" onClick={onSaveRule} disabled={pending || !item.transactionId || !chosenCategoryId} data-testid="inbox-save-rule">
          <Layers2 data-icon="inline-start" />
          Always do this
        </Button>
        <Button variant="outline" onClick={onExclude} disabled={pending || !item.transactionId}>
          <X data-icon="inline-start" />
          Exclude
        </Button>
      </>
    );
  }
  return (
    <Button asChild variant="outline">
      <Link href="/ask-ai">
        <Sparkles data-icon="inline-start" />
        Resolve with the assistant
      </Link>
    </Button>
  );
}

// The scrollable detail content WITHOUT a scroll container of its own, so it
// nests cleanly inside the desktop panel or the mobile DetailSheet's ScrollArea.
function InboxDetailContent({
  item,
  categoryOptions,
  chosenCategoryId,
  onCategoryChange,
  createRule,
  onCreateRuleChange,
  onAcceptSuggestion,
}: Omit<InboxDetailProps, "onConfirm" | "onExclude" | "onSaveRule" | "onConfirmReceipt" | "pending">) {
  const receipt = item.receiptDocument ?? null;
  const moneyIn = item.amountMinor > 0;
  const kind = resolvedKind(item);
  // When the AI attached a clarifying question to a categorizable transaction,
  // surface it as context above the category picker rather than a dead end.
  const aiQuestion = item.kind === "question" && item.transactionId ? item.summary : null;
  // E2-T11: provenance line + Top-N suggestions for a decided categorize item.
  const suggestions = item.suggestions ?? [];
  const topMemoryOccurrences =
    suggestions.find((s) => s.source === "memory")?.occurrenceCount ?? null;
  const provenance = inboxProvenanceLine({
    decidedBy: item.decidedBy,
    confidence: item.confidence,
    merchant: item.merchant,
    topMemoryOccurrences,
  });

  return (
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold" data-testid="inbox-detail-title">{item.merchant}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{item.summary}</p>
            </div>
            {kind === "categorize" && item.confidence != null ? (
              <ConfidenceRing value={Math.round(item.confidence * 100)} />
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <InboxDetailRow label="Date" value={item.date ?? "Needs context"} />
            <InboxDetailRow
              label="Amount"
              value={<Amount amountMinor={item.amountMinor} tone={moneyIn ? "income" : "neutral"} />}
            />
            <InboxDetailRow
              label={receipt ? "Candidate account" : "Account"}
              value={receipt?.candidate ? receipt.candidate.bankAccountName : item.bankAccountName}
            />
          </div>

          {/* Per-kind body keyed off the resolved kind (report 6.2). */}
          {kind === "categorize" ? (
            <div className="flex flex-col gap-3">
              {aiQuestion ? (
                <div className="flex items-start gap-2 rounded-[14px] bg-ai-surface p-3 text-sm text-ai">
                  <Sparkles className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">{aiQuestion}</span>
                </div>
              ) : null}

              {/* E2-T11: provenance line — why this item was decided the way it
                  was (rule/memory/embedding/ai/plaid_prior). */}
              {provenance ? (
                <p className="text-xs font-medium text-muted-foreground" data-testid="inbox-provenance">
                  {provenance}
                </p>
              ) : null}

              {/* E2-T11: Top-N one-click suggestions. Accepting one confirms the
                  transaction through the existing pipeline mutation. */}
              {suggestions.length > 0 ? (
                <div className="flex flex-col gap-1.5" data-testid="inbox-suggestions">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
                    Suggestions
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion.accountId}
                        type="button"
                        data-testid="inbox-suggestion"
                        data-account-id={suggestion.accountId}
                        onClick={() => onAcceptSuggestion(suggestion.accountId)}
                        className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-medium transition-colors hover:border-primary hover:bg-ob-green-50/40"
                      >
                        <Sparkles className="size-3 text-primary" />
                        {suggestion.number} - {suggestion.name}
                        {suggestion.source === "memory" && suggestion.occurrenceCount ? (
                          <span className="text-[10.5px] text-muted-foreground">×{suggestion.occurrenceCount}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <Field>
                <FieldLabel htmlFor="inbox-category">Category</FieldLabel>
                <Select value={chosenCategoryId} onValueChange={onCategoryChange}>
                  <SelectTrigger id="inbox-category" data-testid="inbox-category-select">
                    <SelectValue placeholder="Choose category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {categoryOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id} data-testid={`inbox-category-option-${option.number}`}>
                          {option.number} - {option.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>Confirming posts a balanced journal entry through the ledger.</FieldDescription>
              </Field>

              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium text-ai outline-none">
                  <Sparkles className="size-3.5" />
                  Why this
                  <ChevronDown className="size-3.5" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <AiInsightBadge
                    variant="inline"
                    confidence={item.confidence ?? undefined}
                    reasoning={humanizeReasoning(item.reasoning) ?? "No rule or match reached the posting threshold, so it waits for you."}
                  />
                </CollapsibleContent>
              </Collapsible>

              <Field orientation="horizontal">
                <Checkbox
                  id="inbox-create-rule"
                  checked={createRule}
                  onCheckedChange={(value) => onCreateRuleChange(value === true)}
                />
                <FieldLabel htmlFor="inbox-create-rule" className="font-normal">
                  Always do this — categorize {item.merchant} this way next time
                </FieldLabel>
              </Field>
            </div>
          ) : null}

          {kind === "receipt" ? (
            <div className="grid gap-3 md:grid-cols-2" data-testid="receipt-inbox-card">
              <div className="rounded-[14px] p-3 ring-1 ring-foreground/10">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ReceiptText className="size-4 text-primary" />
                  <span className="min-w-0 truncate">Extracted receipt</span>
                </div>
                <dl className="mt-3 flex flex-col gap-2 text-sm">
                  <CompareRow label="Vendor" value={receipt?.vendor ?? "—"} />
                  <CompareRow label="Date" value={receipt?.date ?? "—"} mono />
                  <CompareRow
                    label="Total"
                    value={receipt ? formatMinorMoney(receipt.totalMinor, { currency: receipt.currency }) : "—"}
                    mono
                  />
                  <CompareRow label="File" value={receipt?.fileName ?? "Receipt file"} />
                </dl>
              </div>
              <div className="rounded-[14px] p-3 ring-1 ring-foreground/10">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FileText className="size-4 text-primary" />
                  <span className="min-w-0 truncate">Candidate transaction</span>
                </div>
                {receipt?.candidate ? (
                  <dl className="mt-3 flex flex-col gap-2 text-sm">
                    <CompareRow label="Merchant" value={receipt.candidate.merchant} />
                    <CompareRow label="Date" value={receipt.candidate.date} mono />
                    <CompareRow
                      label="Amount"
                      value={formatMinorMoney(receipt.candidate.amountMinor, { currency: receipt.currency })}
                      mono
                    />
                    <CompareRow label="Category" value={receipt.candidate.categoryName} />
                  </dl>
                ) : (
                  <div className="mt-3 rounded-[10px] bg-muted p-3 text-sm text-muted-foreground">
                    No close transaction candidate yet.
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {kind === "transfer" ? (
            <InboxImpactNote icon={ArrowLeftRight}>
              This looks like money moving between your own accounts. Confirming records a transfer —
              same amount, opposite direction — so it never counts as income or an expense on your P&amp;L.
            </InboxImpactNote>
          ) : null}

          {kind === "payout_mismatch" ? (
            <InboxImpactNote icon={CircleAlert}>
              A payout settled for a different amount than expected, usually because of processor fees or a
              refund. Resolving it reconciles the deposit against the underlying charges so your books match the bank.
            </InboxImpactNote>
          ) : null}

          {kind === "connection" ? (
            <div className="flex flex-col gap-3">
              <InboxImpactNote icon={Link2Off}>
                One of your connected accounts needs to be reauthorized before new activity can sync.
                Reconnect to resume automatic imports.
              </InboxImpactNote>
              <Button asChild variant="outline" className="self-start">
                <Link href="/settings/connections">
                  <Plug data-icon="inline-start" />
                  Reconnect account
                </Link>
              </Button>
            </div>
          ) : null}

          {kind === "question" ? (
            <InboxImpactNote icon={Sparkles}>
              {item.summary} Answer in chat so the assistant can route it the right way — nothing posts until you confirm.
            </InboxImpactNote>
          ) : null}
        </div>
  );
}

// Desktop panel: scrollable content + a sticky action bar pinned to the bottom.
function InboxDetailPanel(props: InboxDetailProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <InboxDetailContent {...props} />
      </ScrollArea>
      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-background p-4">
        <InboxDetailActions {...props} />
      </div>
    </div>
  );
}

function CompareRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 truncate text-right font-medium", mono && "money-figures")}>{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transactions — the full-width universal register (report 6.3)
// ---------------------------------------------------------------------------

type TransactionsData = NonNullable<ReturnType<typeof useTransactionsData>>;
type TransactionRow = TransactionsData["rows"][number];

function useTransactionsData(args: {
  review: ReviewFilter;
  search: string;
  from?: string;
  to?: string;
  direction?: AmountDirection;
  source?: string;
  bankAccountIds?: string[];
}) {
  const { activeEntity, scope } = useActiveEntity();
  const result = useQuery(api.coreViews.transactions, {
    ...(scope === "all" ? { scope: "all" as const } : entityArg(activeEntity.id)),
    review: args.review,
    search: args.search,
    from: args.from,
    to: args.to,
    direction: args.direction && args.direction !== "any" ? args.direction : undefined,
    source: args.source as "bank" | "stripe" | "manual" | undefined,
    bankAccountIds: args.bankAccountIds?.length
      ? (args.bankAccountIds as Id<"bankAccounts">[])
      : undefined,
  });
  // Convex returns `undefined` while refetching after an arg change (e.g. a new
  // search). Retain the last loaded value so the register — and the import form
  // state and status message it carries — never unmounts mid-action. Storing
  // prior-render info via a guarded setState during render is the supported
  // React idiom (it re-renders before commit, no flash).
  const [last, setLast] = useState<typeof result>(undefined);
  if (result !== undefined && result !== last) setLast(result);
  return result ?? last ?? null;
}

function rowAttention(row: TransactionRow): AttentionKind | null {
  if (row.review === "needs_review") return "needs-review";
  if (row.hasInboxItem) return "needs-review";
  if (!row.entryId && row.review !== "excluded") return "unposted";
  if ((row.confidence ?? 1) < 0.75 && row.decidedBy === "ai") return "low-confidence";
  return null;
}

// E7-3: the inline row-detail strip the register reveals on expand — the long
// raw bank description plus the secondary fields (contact / account / source)
// that no longer crowd the compact row. This is progressive disclosure, NOT the
// full TransactionDetail drawer (which still owns the complete double-entry
// record). Rendered inside the table's renderExpanded slot.
function TransactionRowDetailStrip({ row }: { row: TransactionRow }) {
  const fields: Array<{ label: string; value: string }> = [
    { label: "Description", value: row.rawDescription || row.merchant },
    { label: "Contact", value: row.contactName ?? "—" },
    { label: "Account", value: row.bankAccountName },
    { label: "Source", value: sourceLabel(row.source) },
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2" data-testid="tx-row-detail">
      {fields.map((field) => (
        <div key={field.label} className="flex min-w-0 items-baseline gap-2">
          <dt className="shrink-0 text-xs font-medium uppercase tracking-[0.03em] text-muted-foreground">
            {field.label}
          </dt>
          <dd className="min-w-0 break-words text-foreground">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---- Transactions filter model + saved-view helpers ------------------------

/** localStorage-safe form of a DateRangeValue (Date objects don't round-trip). */
type StoredRange = { preset: DateRangePreset } | { fromISO: string; toISO: string };

type TxFilters = {
  search: string;
  range: StoredRange;
  keywords: string[];
  amount: AmountValue;
  accountIds: string[];
  source: string[];
  receipt: string[];
  ai: string[];
  review: ReviewFilter;
  needsAttention: boolean;
  groupBy: GroupByKey;
  sort: SortState;
};

const DEFAULT_TX_FILTERS: TxFilters = {
  search: "",
  range: { preset: "this-month" },
  keywords: [],
  amount: {},
  accountIds: [],
  source: [],
  receipt: [],
  ai: [],
  review: "all",
  needsAttention: false,
  groupBy: "none",
  sort: { key: "date", direction: "desc" },
};

// Built-in views ship ahead of the user's saved views, echoing Mercury's
// "Monthly money in / out" defaults — recolored, scoped to this month.
const BUILTIN_TX_VIEWS: SavedView<TxFilters>[] = [
  { id: "builtin-money-in", name: "Monthly money in", builtIn: true, filters: { ...DEFAULT_TX_FILTERS, amount: { direction: "in" } } },
  { id: "builtin-money-out", name: "Monthly money out", builtIn: true, filters: { ...DEFAULT_TX_FILTERS, amount: { direction: "out" } } },
];

function toStoredRange(range: DateRangeValue): StoredRange {
  if ("preset" in range) return { preset: range.preset };
  const iso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { fromISO: iso(range.from), toISO: iso(range.to) };
}

function fromStoredRange(range: StoredRange): DateRangeValue {
  if ("preset" in range) return { preset: range.preset };
  const parse = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  };
  return { from: parse(range.fromISO), to: parse(range.toISO) };
}

function sameFilters(a: TxFilters, b: TxFilters | undefined) {
  return b != null && JSON.stringify(a) === JSON.stringify(b);
}

function sourceLabel(source: string) {
  if (source === "bank") return "Bank";
  if (source === "stripe") return "Stripe";
  if (source === "manual") return "Manual";
  return source;
}

function transactionGroupLabel(row: TransactionRow, groupBy: GroupByKey) {
  switch (groupBy) {
    case "category":
      return row.categoryName || "Uncategorized";
    case "account":
      return row.bankAccountName || "Manual";
    case "contact":
      return row.contactName ?? "No contact";
    case "source":
      return sourceLabel(row.source);
    case "month":
      return row.date.slice(0, 7);
    default:
      return "";
  }
}

function reviewFilterLabel(review: ReviewFilter) {
  const map: Record<ReviewFilter, string> = {
    all: "All",
    auto: "Auto-posted",
    confirmed: "Confirmed",
    needs_review: "Needs review",
    excluded: "Excluded",
  };
  return map[review];
}

function aiFilterLabel(value: string) {
  if (value === "decided") return "AI-decided";
  if (value === "rule") return "Rule";
  if (value === "memory") return "Memory";
  if (value === "high") return "High confidence";
  if (value === "low") return "Low confidence";
  return value;
}

const URL_PERIOD_PRESETS: DateRangePreset[] = ["this-month", "last-month", "last-3-months", "ytd"];

export function TransactionsScreen() {
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");
  const accountParam = searchParams.get("account");

  // URL-synced period state (E0.4): the page-level text search was removed
  // because global command search already owns cross-record lookup.
  const urlState = useWorkbenchUrlState();
  const initialPeriodParam = searchParams.get("period");
  const initialPeriod: DateRangeValue = URL_PERIOD_PRESETS.includes(initialPeriodParam as DateRangePreset)
    ? { preset: initialPeriodParam as DateRangePreset }
    : { preset: "this-month" };

  const [review, setReview] = useState<ReviewFilter>("all");
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<DateRangeValue>(initialPeriod);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [amount, setAmount] = useState<AmountValue>({});
  const [accountIds, setAccountIds] = useState<string[]>(accountParam ? [accountParam] : []);
  const [source, setSource] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<string[]>([]);
  const [ai, setAi] = useState<string[]>([]);
  const [needsAttention, setNeedsAttention] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupByKey>("none");
  const [sort, setSort] = useState<SortState>({ key: "date", direction: "desc" });
  const [display, setDisplay] = useState<DisplaySettings>({
    // E7-3: the register defaults to compact density now that the raw bank
    // description is behind an expand toggle (no permanent second line). The
    // DisplaySettingsMenu density toggle still lets the owner switch back.
    density: "compact",
    hiddenColumns: [],
  });
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  // E7-3: ids of rows whose inline detail strip (raw bank description + contact +
  // account + source) is open. Progressive disclosure keeps the default row
  // compact; the full TransactionDetail drawer stays the complete record.
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  function toggleExpanded(id: string) {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }
  // Detail is CLOSED by default. A ⌘K deep-link (?focus=) is the only thing that
  // opens it on first render; otherwise nothing is selected until a row click.
  const [selectedId, setSelectedId] = useState<string | null>(focusId);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  // An inline status line mirrors every action so the result is reachable
  // without a transient toast (and the e2e suite can assert on it).
  const [transactionMessage, setTransactionMessage] = useState("");
  const [manualAmount, setManualAmount] = useState("-42.00");
  const [manualMerchant, setManualMerchant] = useState("Manual import");
  const [manualDate, setManualDate] = useState(() => todayIso());
  const [manualCategoryId, setManualCategoryId] = useState("");
  const [manualBankAccountId, setManualBankAccountId] = useState("");
  const [csvText, setCsvText] = useState(
    () => `date,description,amount\n${todayIso()},Sample CSV expense,-25.00`,
  );
  const [splitFirstAmount, setSplitFirstAmount] = useState("");
  const [splitSecondAmount, setSplitSecondAmount] = useState("");
  const [splitFirstCategoryId, setSplitFirstCategoryId] = useState("");
  const [splitSecondCategoryId, setSplitSecondCategoryId] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // E7-6: bulk-recategorize target picker (no silent hardcoded category).
  const [bulkRecategorizeOpen, setBulkRecategorizeOpen] = useState(false);
  const [bulkRecategorizeTargetId, setBulkRecategorizeTargetId] = useState("");
  // E7-6: register keyboard model (J/K/Enter/E), matching the Inbox scheme.
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);

  const bounds = useMemo(() => dateRangeValueToISO(range, todayIso()), [range]);
  const data = useTransactionsData({
    review,
    search,
    from: bounds.from,
    to: bounds.to,
    direction: amount.direction,
    source: source.length === 1 ? source[0] : undefined,
    bankAccountIds: accountIds,
  });
  const recategorizeTransaction = useMutation(api.pipeline.recategorizeTransaction);
  const confirmTransaction = useMutation(api.pipeline.confirmTransaction);
  const excludeTransaction = useMutation(api.pipeline.excludeTransaction);
  const splitTransaction = useMutation(api.pipeline.splitTransaction);
  const routeTransaction = useMutation(api.pipeline.routeTransaction);
  const categorizePendingTransactions = useAction(api.bedrockCategorizer.categorizePendingTransactions);
  // E2-T3: drain the whole needs_review backlog (self-rescheduling) after an
  // import, rather than a single capped pass.
  const startCategorizationBacklog = useMutation(api.bedrockCategorizer.startCategorizationBacklog);
  const savedViewsStore = useSavedViews<TxFilters>("transactions", data?.entity.id);

  const selected = useMemo(
    () => data?.rows.find((row) => row.id === selectedId) ?? null,
    [data, selectedId],
  );

  // Sync a ⌘K deep-link (?focus=) into the open drawer even when the register is
  // already mounted. Render-phase "adjust on input change" so a later param
  // change opens the row — and, because it only fires when focusId itself
  // changes, it never re-opens the drawer after the user closes it.
  const [lastFocusId, setLastFocusId] = useState<string | null>(focusId);
  if (focusId && focusId !== lastFocusId) {
    setLastFocusId(focusId);
    setSelectedId(focusId);
  }

  // Deep-link from ⌘K: scroll the focused row into view once the register loads.
  useEffect(() => {
    if (!focusId || !data?.rows.length) return;
    if (!data.rows.some((row) => row.id === focusId)) return;
    const node = document.querySelector<HTMLElement>(`[data-transaction-id="${focusId}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId, data]);

  // Mirror the period preset into the URL (E0.4) so it persists across sub-tab
  // switches. Only preset ranges are serialized; a custom from/to range stays
  // local (no opaque date params in the URL).
  const periodParam = "preset" in range ? range.preset : null;
  const setUrlParams = urlState.setParams;
  useEffect(() => {
    setUrlParams({
      period: periodParam && periodParam !== "this-month" ? periodParam : null,
    });
  }, [periodParam, setUrlParams]);

  const defaultBankAccountId = data?.bankAccounts[0]?.id ?? "";
  const defaultCategoryId = data?.categoryOptions.find((option) => option.type === "expense")?.id ?? data?.categoryOptions[0]?.id ?? "";
  const otherIncomeCategoryId =
    data?.categoryOptions.find((option) => option.number === "4200")?.id ??
    data?.categoryOptions.find((option) => option.type === "income")?.id ??
    "";
  const secondDefaultCategoryId =
    data?.categoryOptions.find((option) => option.type === "expense" && option.id !== defaultCategoryId)?.id ??
    data?.categoryOptions.find((option) => option.id !== defaultCategoryId)?.id ??
    "";

  const csvRows = useMemo(
    () =>
      csvText
        .split(/\r?\n/)
        .slice(1)
        .map((line) => line.split(",").map((cell) => cell.trim()))
        .filter((row) => row.length >= 3 && row[0] && row[1] && row[2]),
    [csvText],
  );
  const duplicateCsvCount = csvRows.length - new Set(csvRows.map((row) => row.join(":"))).size;

  // Client-side filtering over the server rows. The server returns the latest
  // page (review + search applied); these refine it for the table. The insights
  // band, by contrast, is server-aggregated over the full filtered period.
  const visibleRows = useMemo(() => {
    const rows = data?.rows ?? [];
    return rows.filter((row) => {
      if (row.date < bounds.from || row.date > bounds.to) return false;
      if (accountIds.length && (!row.bankAccountId || !accountIds.includes(row.bankAccountId))) return false;
      if (amount.direction === "in" && row.amountMinor <= 0) return false;
      if (amount.direction === "out" && row.amountMinor >= 0) return false;
      const absAmount = Math.abs(row.amountMinor);
      if (amount.minMinor != null && absAmount < amount.minMinor) return false;
      if (amount.maxMinor != null && absAmount > amount.maxMinor) return false;
      if (source.length && !source.includes(row.source)) return false;
      if (receipt.includes("has") && !row.receipt) return false;
      if (receipt.includes("none") && row.receipt) return false;
      // E7-4: the AI facet keys off the canonical provenance kind (the same
      // value the chip renders), not the raw decidedBy enum, so the filter and
      // the chip never disagree. Rule/Memory are provenance-aware facets too.
      if (ai.includes("decided") && row.provenance.kind !== "ai") return false;
      if (ai.includes("rule") && row.provenance.kind !== "rule") return false;
      if (ai.includes("memory") && row.provenance.kind !== "memory") return false;
      if (ai.includes("high") && (row.confidence ?? 0) < 0.9) return false;
      if (ai.includes("low") && (row.confidence ?? 1) >= 0.9) return false;
      if (
        keywords.length &&
        !keywords.some((keyword) =>
          `${row.merchant} ${row.rawDescription}`.toLowerCase().includes(keyword.toLowerCase()),
        )
      ) {
        return false;
      }
      if (needsAttention && !(row.review === "needs_review" || row.hasInboxItem)) return false;
      return true;
    });
  }, [data, accountIds, amount, source, receipt, ai, keywords, needsAttention, bounds]);

  const groupedRows = useMemo(() => {
    if (groupBy === "none") return null;
    const groups = new Map<string, TransactionRow[]>();
    for (const row of visibleRows) {
      const key = transactionGroupLabel(row, groupBy);
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    return [...groups.entries()]
      .map(([label, rows]) => ({
        label,
        rows,
        netMinor: rows.reduce((sum, row) => sum + row.amountMinor, 0),
      }))
      .sort((a, b) => Math.abs(b.netMinor) - Math.abs(a.netMinor));
  }, [visibleRows, groupBy]);

  const accountOptions = useMemo(
    () => (data?.bankAccounts ?? []).map((account) => ({ id: account.id, label: account.name })),
    [data],
  );

  const categoryComboOptions = useMemo(
    () =>
      (data?.categoryOptions ?? []).map((option) => ({
        id: option.id,
        label: `${option.number} ${option.name}`,
        type: option.type,
      })),
    [data],
  );

  const recentNames = useMemo(() => {
    const names = new Set<string>();
    for (const row of data?.rows ?? []) {
      if (row.merchant) names.add(row.merchant);
      if (row.contactName) names.add(row.contactName);
    }
    return [...names].slice(0, 30);
  }, [data]);

  function selectRow(row: TransactionRow) {
    setSelectedId(row.id);
    setSplitFirstAmount("");
    setSplitSecondAmount("");
    setSplitFirstCategoryId("");
    setSplitSecondCategoryId("");
  }

  // Surface an action result both inline (the canonical, persistent status line)
  // and as a quiet toast so the user gets feedback even when the drawer is open.
  function reportOk(text: string) {
    setTransactionMessage(text);
    toast.success(text);
  }
  function reportError(error: unknown, fallback: string) {
    const text = error instanceof Error ? error.message : fallback;
    setTransactionMessage(text);
    toast.error(text);
  }

  async function updateCategory(transactionId: string, categoryAccountId: string) {
    setPending(true);
    setTransactionMessage("");
    try {
      await recategorizeTransaction({
        transactionId: transactionId as Id<"transactions">,
        categoryAccountId: categoryAccountId as Id<"ledgerAccounts">,
      });
      reportOk("Transaction recategorized with reversal and repost.");
    } catch (error) {
      reportError(error, "Could not recategorize transaction.");
    } finally {
      setPending(false);
    }
  }

  async function addManualTransaction() {
    if (!data?.entity || !defaultBankAccountId || !defaultCategoryId) return;
    setPending(true);
    setTransactionMessage("");
    try {
      await routeTransaction({
        entityId: data.entity.id as Id<"entities">,
        bankAccountId: (manualBankAccountId || defaultBankAccountId) as Id<"bankAccounts">,
        date: manualDate || todayIso(),
        amountMinor: Math.round(Number(manualAmount) * 100),
        currency: data.entity.currency,
        merchant: manualMerchant,
        rawDescription: manualMerchant,
        status: "posted",
        source: "bank",
        externalId: `manual:${Date.now()}:${manualMerchant}`,
        categoryAccountId: (manualCategoryId || defaultCategoryId) as Id<"ledgerAccounts">,
      });
      reportOk("Manual transaction imported and posted through the ledger.");
    } catch (error) {
      reportError(error, "Could not add manual transaction.");
    } finally {
      setPending(false);
    }
  }

  async function importCsv() {
    if (!data?.entity || !defaultBankAccountId) return;
    setPending(true);
    setTransactionMessage("");
    try {
      for (const [date, description, amount] of csvRows) {
        await routeTransaction({
          entityId: data.entity.id as Id<"entities">,
          bankAccountId: defaultBankAccountId as Id<"bankAccounts">,
          date,
          amountMinor: Math.round(Number(amount) * 100),
          currency: data.entity.currency,
          merchant: description,
          rawDescription: description,
          status: "posted",
          source: "bank",
          externalId: `csv:${date}:${description}:${amount}`,
        });
      }
      // First pass runs inline for immediate feedback; the drainer then clears
      // any remainder beyond this pass (no overall 25-item cap).
      const aiResult = await categorizePendingTransactions({
        entityId: data.entity.id as Id<"entities">,
      });
      if (aiResult.needsReviewCount > 0 || aiResult.skippedCount > 0) {
        await startCategorizationBacklog({ entityId: data.entity.id as Id<"entities"> });
      }
      const status = aiResult.batchStatus ? ` ${aiResult.batchStatus}` : "";
      reportOk(
        `${csvRows.length} CSV row${csvRows.length === 1 ? "" : "s"} imported. AI batch${status}: ${aiResult.attemptedCount} checked, ${aiResult.postedCount} posted, ${aiResult.needsReviewCount} updated for review, ${aiResult.skippedCount} skipped. Remaining items are draining in the background.`,
      );
    } catch (error) {
      reportError(error, "Could not import CSV rows.");
    } finally {
      setPending(false);
    }
  }

  async function bulkApprove(ids: string[]) {
    if (!ids.length || !data) return;
    setPending(true);
    setTransactionMessage("");
    const rowsById = new Map(data.rows.map((row) => [row.id as string, row]));
    let approved = 0;
    let skipped = 0;
    try {
      for (const transactionId of ids) {
        const row = rowsById.get(transactionId);
        // Approve = confirm the row's existing category through the single ledger
        // path. Rows with no category yet can't be approved here — flag them.
        if (!row?.categoryAccountId) {
          skipped += 1;
          continue;
        }
        await confirmTransaction({
          transactionId: transactionId as Id<"transactions">,
          categoryAccountId: row.categoryAccountId as Id<"ledgerAccounts">,
        });
        approved += 1;
      }
      reportOk(
        skipped > 0
          ? `${approved} approved and confirmed. ${skipped} need a category first — open them to categorize.`
          : `${approved} transaction${approved === 1 ? "" : "s"} approved. Confident items were already posted.`,
      );
      setCheckedIds([]);
    } catch (error) {
      reportError(error, "Could not approve transactions.");
    } finally {
      setPending(false);
    }
  }

  async function bulkExclude(ids: string[]) {
    if (!ids.length) return;
    setPending(true);
    setTransactionMessage("");
    try {
      for (const transactionId of ids) {
        await excludeTransaction({
          transactionId: transactionId as Id<"transactions">,
          reason: "Bulk excluded from register.",
        });
      }
      reportOk(`${ids.length} transaction${ids.length === 1 ? "" : "s"} excluded.`);
      setCheckedIds([]);
    } catch (error) {
      reportError(error, "Could not exclude transactions.");
    } finally {
      setPending(false);
    }
  }

  // E7-6: bulk Recategorize no longer routes everything to a hardcoded
  // 'other income' account. Clicking it opens a small picker (BulkRecategorizeDialog
  // below); the user chooses the target and bulkRecategorizeWith posts a
  // reverse+repost for each checked row through the single ledger path.
  function bulkRecategorize(ids: string[]) {
    if (!ids.length) return;
    setTransactionMessage("");
    setBulkRecategorizeTargetId(defaultCategoryId);
    setBulkRecategorizeOpen(true);
  }

  async function bulkRecategorizeWith(ids: string[], categoryAccountId: string) {
    if (!ids.length || !categoryAccountId) return;
    setPending(true);
    setTransactionMessage("");
    try {
      for (const transactionId of ids) {
        await recategorizeTransaction({
          transactionId: transactionId as Id<"transactions">,
          categoryAccountId: categoryAccountId as Id<"ledgerAccounts">,
        });
      }
      reportOk(`${ids.length} transaction${ids.length === 1 ? "" : "s"} recategorized with reversal and repost.`);
      setCheckedIds([]);
    } catch (error) {
      reportError(error, "Could not recategorize transactions.");
    } finally {
      setPending(false);
    }
  }

  // Split editor working values (derived from the selected row).
  const selectedAbsoluteAmount = Math.abs(selected?.amountMinor ?? 0);
  const defaultSplitFirstAmount = (Math.floor(selectedAbsoluteAmount / 2) / 100).toFixed(2);
  const defaultSplitSecondAmount = ((selectedAbsoluteAmount - Math.floor(selectedAbsoluteAmount / 2)) / 100).toFixed(2);
  const activeSplitFirstAmount = splitFirstAmount || defaultSplitFirstAmount;
  const activeSplitSecondAmount = splitSecondAmount || defaultSplitSecondAmount;
  const activeSplitFirstCategoryId = splitFirstCategoryId || selected?.categoryAccountId || defaultCategoryId;
  const activeSplitSecondCategoryId = splitSecondCategoryId || secondDefaultCategoryId || defaultCategoryId;

  async function postSplit() {
    if (!selected || !activeSplitFirstCategoryId || !activeSplitSecondCategoryId) return;
    setPending(true);
    setTransactionMessage("");
    try {
      await splitTransaction({
        transactionId: selected.id as Id<"transactions">,
        splits: [
          {
            categoryAccountId: activeSplitFirstCategoryId as Id<"ledgerAccounts">,
            amountMinor: Math.round(Number(activeSplitFirstAmount) * 100),
          },
          {
            categoryAccountId: activeSplitSecondCategoryId as Id<"ledgerAccounts">,
            amountMinor: Math.round(Number(activeSplitSecondAmount) * 100),
          },
        ],
      });
      reportOk("Transaction split with reversal and repost.");
    } catch (error) {
      reportError(error, "Could not split transaction.");
    } finally {
      setPending(false);
    }
  }

  async function excludeSelected() {
    if (!selected) return;
    setPending(true);
    setTransactionMessage("");
    try {
      await excludeTransaction({ transactionId: selected.id as Id<"transactions">, reason: "Excluded from register." });
      reportOk("Transaction excluded with a reversal when needed.");
    } catch (error) {
      reportError(error, "Could not exclude transaction.");
    } finally {
      setPending(false);
    }
  }

  async function excludeRowById(transactionId: string) {
    setPending(true);
    setTransactionMessage("");
    try {
      await excludeTransaction({ transactionId: transactionId as Id<"transactions">, reason: "Excluded from register." });
      reportOk("Transaction excluded with a reversal when needed.");
    } catch (error) {
      reportError(error, "Could not exclude transaction.");
    } finally {
      setPending(false);
    }
  }

  // E7-6: the register keyboard model (J/K/Enter/E) mirrors the Inbox scheme
  // (decided: Q39). The walk order is the SAME order the rows read on screen —
  // grouped order when a Group-by is active, otherwise the flat visible list — so
  // J/K never jump out of visual sequence. Handling is guarded so it never fires
  // while typing in an input/textarea/contenteditable, inside the category
  // combobox typeahead, or while a dialog/drawer is open (which owns Enter/Escape).
  const keyboardRows = useMemo<TransactionRow[]>(
    () => (groupedRows ? groupedRows.flatMap((group) => group.rows) : visibleRows),
    [groupedRows, visibleRows],
  );
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if (!["j", "k", "enter", "e"].includes(key)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable ||
        target?.closest("[role='combobox'],[role='dialog'],[role='menu'],[role='listbox']")
      ) {
        return;
      }
      // A dialog/drawer/popover owns the keyboard while open.
      if (
        addOpen ||
        importOpen ||
        bulkRecategorizeOpen ||
        selectedId != null ||
        document.querySelector("[data-state='open'][role='dialog']")
      ) {
        return;
      }
      if (!keyboardRows.length) return;
      const currentIndex = keyboardRows.findIndex((row) => row.id === focusedRowId);
      if (key === "j" || key === "k") {
        event.preventDefault();
        const delta = key === "j" ? 1 : -1;
        const base = currentIndex === -1 ? (key === "j" ? -1 : keyboardRows.length) : currentIndex;
        const nextIndex = Math.max(0, Math.min(keyboardRows.length - 1, base + delta));
        const next = keyboardRows[nextIndex];
        if (next) {
          setFocusedRowId(next.id);
          document
            .querySelector<HTMLElement>(`[data-transaction-id="${next.id}"]`)
            ?.scrollIntoView({ block: "nearest" });
        }
        return;
      }
      const focused = currentIndex === -1 ? null : keyboardRows[currentIndex];
      if (!focused) return;
      if (key === "enter") {
        event.preventDefault();
        selectRow(focused);
        return;
      }
      if (key === "e") {
        event.preventDefault();
        void excludeRowById(focused.id);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // selectRow/excludeRowById are stable enough for this handler; we re-bind on
    // the values it reads so the closure never goes stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyboardRows, focusedRowId, addOpen, importOpen, bulkRecategorizeOpen, selectedId]);

  function exportRowsCsv(rows: TransactionRow[], suffix: string) {
    const header = ["Date", "Merchant", "Description", "Category", "Account", "Source", "Status", "Amount"];
    const lines = rows.map((row) =>
      [
        row.date,
        row.merchant,
        row.rawDescription,
        row.categoryName,
        row.bankAccountName,
        row.source,
        row.review,
        (row.amountMinor / 100).toFixed(2),
      ]
        .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
        .join(","),
    );
    downloadCsv([header.join(","), ...lines].join("\n"), `transactions-${suffix}`);
  }

  function exportAuditLog() {
    const header = ["Date", "Merchant", "Action", "Detail"];
    const lines = (data?.rows ?? []).flatMap((row) =>
      row.activity.map((event) =>
        [row.date, row.merchant, event.action, event.summary]
          .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
          .join(","),
      ),
    );
    downloadCsv([header.join(","), ...lines].join("\n"), "transactions-audit-log");
  }

  if (data === null) return <LoadingBlock label="transactions" />;

  // Saved views: built-ins ahead of the user's, with dirty-tracking against the
  // active view. FE-only persistence today (see useSavedViews).
  const allViews = [...BUILTIN_TX_VIEWS, ...savedViewsStore.userViews];
  const savedViewSummaries = allViews.map((view) => ({ id: view.id, name: view.name, builtIn: view.builtIn }));

  function captureFilters(): TxFilters {
    return { search: "", range: toStoredRange(range), keywords, amount, accountIds, source, receipt, ai, review, needsAttention, groupBy, sort };
  }
  function applyFilters(filters: TxFilters) {
    setSearch("");
    setRange(fromStoredRange(filters.range));
    setKeywords(filters.keywords);
    setAmount(filters.amount);
    setAccountIds(filters.accountIds);
    setSource(filters.source);
    setReceipt(filters.receipt);
    setAi(filters.ai);
    setReview(filters.review);
    setNeedsAttention(filters.needsAttention);
    setGroupBy(filters.groupBy);
    setSort(filters.sort);
  }
  const currentFilters = captureFilters();
  const activeView = allViews.find((view) => view.id === activeViewId) ?? null;
  const viewDirty = activeViewId
    ? !sameFilters(currentFilters, activeView?.filters)
    : !sameFilters(currentFilters, DEFAULT_TX_FILTERS);

  function selectView(id: string | null) {
    if (!id) {
      applyFilters(DEFAULT_TX_FILTERS);
      setActiveViewId(null);
      return;
    }
    const view = allViews.find((candidate) => candidate.id === id);
    if (view) {
      applyFilters(view.filters);
      setActiveViewId(id);
    }
  }
  function createView(name: string) {
    const view = savedViewsStore.add(name, captureFilters());
    setActiveViewId(view.id);
  }
  function updateActiveView(id: string) {
    savedViewsStore.replaceFilters(id, captureFilters());
  }
  function deleteView(id: string) {
    savedViewsStore.remove(id);
    if (activeViewId === id) setActiveViewId(null);
  }

  function clearAllFilters() {
    setSearch("");
    setRange({ preset: "this-month" });
    setKeywords([]);
    setAmount({});
    setAccountIds([]);
    setSource([]);
    setReceipt([]);
    setAi([]);
    setReview("all");
    setNeedsAttention(false);
    setActiveViewId(null);
  }

  // The mega Filters panel shares the screen's filter state with the standalone
  // pills; Date and Account mount their existing controls inline (custom kind).
  const filterPanelValue: FilterPanelValue = {
    keywords,
    amount,
    source,
    review: review === "all" ? [] : [review],
    receipt,
    ai,
    attention: needsAttention ? ["needs"] : [],
  };
  function onFilterPanelChange(key: string, next: unknown) {
    if (key === "keywords") setKeywords(next as string[]);
    else if (key === "amount") setAmount(next as AmountValue);
    else if (key === "source") setSource(next as string[]);
    else if (key === "receipt") setReceipt(next as string[]);
    else if (key === "ai") setAi(next as string[]);
    else if (key === "review") setReview(((next as string[])[0] as ReviewFilter) ?? "all");
    else if (key === "attention") setNeedsAttention((next as string[]).includes("needs"));
  }
  const isDefaultRange = "preset" in range && range.preset === "this-month";
  const filterFacets: FilterFacetSpec[] = [
    { kind: "custom", key: "date", label: "Date", icon: CalendarDays, active: !isDefaultRange, render: () => <DateRangeControl value={range} onChange={setRange} compact /> },
    { kind: "keyword", key: "keywords", label: "Keyword", icon: Tags, recent: recentNames },
    { kind: "amount", key: "amount", label: "Amount", icon: Coins },
    { kind: "custom", key: "account", label: "Account", icon: Landmark, active: accountIds.length > 0, render: () => <AccountMultiSelect options={accountOptions} value={accountIds} onChange={setAccountIds} placeholder="All accounts" /> },
    { kind: "options", key: "source", label: "Source", mode: "multi", icon: ArrowLeftRight, options: [ { value: "bank", label: "Bank" }, { value: "stripe", label: "Stripe" }, { value: "manual", label: "Manual" } ] },
    { kind: "options", key: "review", label: "Status", mode: "single", icon: CircleAlert, options: [ { value: "auto", label: "Auto-posted" }, { value: "confirmed", label: "Confirmed" }, { value: "needs_review", label: "Needs review" }, { value: "excluded", label: "Excluded" } ] },
    { kind: "options", key: "receipt", label: "Receipt", mode: "single", icon: ReceiptText, options: [ { value: "has", label: "Has receipt" }, { value: "none", label: "No receipt" } ] },
    // E7-4: a single "Decision" facet over the provenance kinds + AI confidence
    // bands. Rule/Memory/AI-decided each match provenance.kind exactly, so the
    // facet and the row's provenance chip never disagree.
    { kind: "options", key: "ai", label: "Decision", mode: "single", icon: Sparkles, options: [ { value: "decided", label: "AI-decided" }, { value: "rule", label: "Rule" }, { value: "memory", label: "Memory" }, { value: "high", label: "High confidence" }, { value: "low", label: "Low confidence" } ] },
    { kind: "options", key: "attention", label: "Attention", mode: "single", icon: CircleAlert, options: [ { value: "needs", label: "Needs attention" } ] },
  ];

  // E7-9: filter-rail single source. Date and Amount are the two
  // highest-frequency constraints, so they stay as standalone quick pills next to
  // the panel (one tap to set a range / amount). Every OTHER facet lives only
  // inside the FilterPanelButton mega-panel — they are NOT also exposed as pills.
  // The Date + Amount facets remain in `filterFacets` (the canonical config set
  // the WorkbenchConfig contract advertises and the chips read from), but are
  // dropped from the panel here so the same facet is never editable in two places
  // at once. Removing a chip and the panel stay in sync because both write the
  // SAME screen state via onFilterPanelChange / setRange / setAmount.
  const panelFacets = filterFacets.filter((facet) => facet.key !== "date" && facet.key !== "amount");

  // Active-filter chips with their removal handlers.
  const chips: ActiveChip[] = [];
  if (!isDefaultRange) chips.push({ key: "date", label: `Date: ${bounds.from} – ${bounds.to}` });
  for (const keyword of keywords) chips.push({ key: `kw:${keyword}`, label: `Keyword: ${keyword}` });
  if (isAmountActive(amount)) {
    const parts: string[] = [];
    if (amount.direction && amount.direction !== "any") parts.push(amount.direction === "in" ? "in" : "out");
    if (amount.minMinor != null) parts.push(`≥ ${formatMinorMoney(amount.minMinor, { currency: data.entity.currency })}`);
    if (amount.maxMinor != null) parts.push(`≤ ${formatMinorMoney(amount.maxMinor, { currency: data.entity.currency })}`);
    chips.push({ key: "amount", label: `Amount: ${parts.join(" ")}`.trim() });
  }
  if (accountIds.length) chips.push({ key: "account", label: `Accounts: ${accountIds.length}` });
  for (const value of source) chips.push({ key: `source:${value}`, label: `Source: ${sourceLabel(value)}` });
  if (review !== "all") chips.push({ key: "review", label: `Status: ${reviewFilterLabel(review)}` });
  for (const value of receipt) chips.push({ key: `receipt:${value}`, label: value === "has" ? "Has receipt" : "No receipt" });
  for (const value of ai) chips.push({ key: `ai:${value}`, label: `Decision: ${aiFilterLabel(value)}` });
  if (needsAttention) chips.push({ key: "needsAttention", label: "Needs attention" });

  function removeChip(key: string) {
    if (key === "date") setRange({ preset: "this-month" });
    else if (key.startsWith("kw:")) setKeywords(keywords.filter((term) => `kw:${term}` !== key));
    else if (key === "amount") setAmount({});
    else if (key === "account") setAccountIds([]);
    else if (key.startsWith("source:")) setSource(source.filter((value) => `source:${value}` !== key));
    else if (key === "review") setReview("all");
    else if (key.startsWith("receipt:")) setReceipt(receipt.filter((value) => `receipt:${value}` !== key));
    else if (key.startsWith("ai:")) setAi(ai.filter((value) => `ai:${value}` !== key));
    else if (key === "needsAttention") setNeedsAttention(false);
  }

  const columns: ColumnDef<TransactionRow>[] = [
    {
      key: "date",
      header: "Date",
      mono: true,
      sortable: true,
      width: "7rem",
      // E7-5: the date joins the compact card meta line (with category) on mobile.
      mobileMeta: true,
      sortValue: (row) => row.date,
      cell: (row) => row.date,
    },
    {
      key: "merchant",
      header: "Merchant",
      mobilePrimary: true,
      width: "32%",
      sortValue: (row) => row.merchant,
      // E7-3: compact merchant cell — merchant + ONE provenance chip, no
      // permanent raw-description second line. An expand chevron reveals the
      // full raw bank description (and contact/account/source) inline via the
      // table's renderExpanded strip without opening the drawer.
      cell: (row) => {
        const isExpanded = expandedIds.includes(row.id);
        return (
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              aria-label={isExpanded ? "Hide description" : "Show description"}
              aria-expanded={isExpanded}
              data-testid="tx-expand-toggle"
              className="-ml-1 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={(event) => {
                event.stopPropagation();
                toggleExpanded(row.id);
              }}
            >
              {isExpanded ? (
                <ChevronDown className="size-3.5" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-3.5" aria-hidden="true" />
              )}
            </button>
            <span
              className="truncate font-medium"
              title={[
                row.merchant,
                row.rawDescription && row.rawDescription !== row.merchant ? row.rawDescription : null,
                humanizeReasoning(row.reasoning),
              ].filter(Boolean).join(" · ")}
            >
              {row.merchant}
            </span>
          </div>
        );
      },
    },
    {
      key: "category",
      header: "Category",
      priority: 1,
      width: "14rem",
      // E7-5: the inline category control stays on the mobile card (the compact
      // meta line) as a real tap target, not buried behind the expand strip.
      mobileMeta: true,
      cell: (row) => (
        <InlineCategoryCombobox
          value={row.categoryAccountId}
          options={categoryComboOptions}
          needsReview={row.review === "needs_review"}
          disabled={pending}
          onChange={(categoryAccountId) => updateCategory(row.id, categoryAccountId)}
        />
      ),
    },
    {
      key: "contact",
      header: "Contact",
      priority: 2,
      // Cap the width so a long contact name yields before the merchant column
      // at the xl boundary where priority-2 Contact first appears.
      width: "10rem",
      // E7-5: secondary field — expand-only on the mobile card.
      mobileHidden: true,
      cell: (row) => <span className="truncate text-sm text-muted-foreground">{row.contactName ?? "—"}</span>,
    },
    {
      key: "account",
      header: "Account",
      priority: 1,
      width: "10rem",
      // E7-5: secondary field — expand-only on the mobile card.
      mobileHidden: true,
      cell: (row) => <span className="truncate text-sm text-muted-foreground">{row.bankAccountName}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      mono: true,
      width: "8rem",
      mobileTrailing: true,
      sortable: true,
      sortValue: (row) => row.amountMinor,
      cell: (row) => (
        <Amount amountMinor={row.amountMinor} tone={row.amountMinor > 0 ? "income" : "expense"} />
      ),
    },
    {
      key: "attachment",
      header: "",
      align: "right",
      width: "3rem",
      // E7-5: the receipt + / paperclip is a desktop affordance; on mobile the
      // card stays minimal and receipts are reachable from the detail drawer.
      mobileHidden: true,
      cell: (row) =>
        row.receipt ? (
          <span className="inline-flex justify-end text-primary" title="Receipt attached">
            <Paperclip className="size-4" />
          </span>
        ) : (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Attach receipt"
            onClick={(event) => {
              event.stopPropagation();
              selectRow(row);
            }}
          >
            <Plus />
          </Button>
        ),
    },
    {
      key: "status",
      header: "Status",
      priority: 2,
      width: "8rem",
      // E7-5: the status signal already rides the mobile card as the trailing
      // attention chip (table `attention` slot); keep the verbose Status column
      // off the card so it doesn't double-print.
      mobileHidden: true,
      // E7-4: exactly one signal — the canonical AttentionState chip when the
      // row needs a look (needs-review / unposted / low-confidence), else a
      // quiet Confirmed / Posted / Excluded dot. The AI % lives on the
      // provenance chip in the merchant cell and is never repeated here.
      cell: (row) => {
        const state = rowAttention(row);
        if (state) return <AttentionState state={state} size="sm" />;
        const label =
          row.review === "excluded"
            ? "Excluded"
            : row.review === "confirmed"
              ? "Confirmed"
              : "Posted";
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", row.entryId ? "bg-primary" : "bg-muted-foreground/40")} />
            {label}
          </span>
        );
      },
    },
  ];

  const visibleColumns = columns.filter((column) => !display.hiddenColumns.includes(column.key));
  const sortMenuColumns = columns
    .filter((column) => column.sortable || column.sortValue)
    .map((column) => ({
      key: column.key,
      label: typeof column.header === "string" && column.header ? column.header : column.key,
    }));
  const columnToggleList = columns
    .filter((column) => !["date", "merchant", "amount"].includes(column.key))
    .map((column) => ({
      key: column.key,
      label:
        column.key === "attachment"
          ? "Receipt"
          : typeof column.header === "string" && column.header
            ? column.header
            : column.key,
    }));

  const bulkActions = (
    <>
      <Button size="xs" disabled={pending} onClick={() => bulkApprove(checkedIds)}>
        <Check data-icon="inline-start" />
        Approve
      </Button>
      <Button size="xs" variant="outline" disabled={pending} onClick={() => bulkRecategorize(checkedIds)}>
        <Tags data-icon="inline-start" />
        Recategorize
      </Button>
      <Button size="xs" variant="outline" disabled={pending} onClick={() => bulkExclude(checkedIds)}>
        <X data-icon="inline-start" />
        Exclude
      </Button>
      <Button size="xs" variant="ghost" onClick={() => setCheckedIds([])}>
        Clear
      </Button>
    </>
  );

  // The WorkbenchConfig contract (E0.1) — Transactions is the reference consumer
  // that proves it on the most complete surface. It declares the SAME shape every
  // section will supply (columns / defaultVisibleColumns / filterFacets /
  // groupByOptions / sortableColumns / primaryActions / bulkActions / rowToDetail
  // / insights). The shared <WorkbenchSurface> driver renders the
  // chrome FROM this config; the live stateful nodes below are passed as slots so
  // the screen keeps ownership of its filter state and mutations (zero behavior
  // change vs. the previous inline render).
  const transactionsConfig: WorkbenchConfig<TransactionRow> = {
    section: "transactions",
    title: "Transactions",
    subtabs: [
      { id: "transactions", label: "Transactions", kind: "cash-movement" },
      { id: "insights", label: "Insights", kind: "insights" },
    ],
    columns,
    defaultVisibleColumns: columns
      .filter((column) => !display.hiddenColumns.includes(column.key))
      .map((column) => column.key),
    filterFacets,
    groupByOptions: ["none", "category", "account", "source", "month", "contact"],
    sortableColumns: sortMenuColumns,
    defaultSort: { key: "date", direction: "desc" },
    primaryActions: [
      { label: "Add transaction", onClick: () => setAddOpen(true), variant: "primary" },
      { label: "Import", onClick: () => setImportOpen(true), variant: "secondary" },
    ],
    bulkActions: [
      { label: "Approve", onRun: (ids) => bulkApprove(ids), disabled: pending },
      { label: "Recategorize", onRun: (ids) => bulkRecategorize(ids), disabled: pending },
      { label: "Exclude", onRun: (ids) => bulkExclude(ids), disabled: pending },
    ],
    rowToDetail: (row) => ({ title: row.merchant, tabs: [] }),
    insights: <TransactionsInsights />,
  };

  // E8-T4: the page-specific insight, built purely from the read-model this
  // screen already loaded (coreViews.transactions.insights). Returns null —
  // hiding the banner — when nothing crosses the threshold.
  const pageInsight = buildPageInsight("transactions", { insights: data.insights });

  // Stacked group view (driver-shaped) when a Group-by is active.
  const tableGroups: WorkbenchTableGroup<TransactionRow>[] | null = groupedRows
    ? groupedRows.map((group) => ({
        label: group.label,
        rows: group.rows,
        summary: `${group.rows.length} · ${formatMinorMoney(group.netMinor, { currency: data.entity.currency })}`,
      }))
    : null;

  const attentionForRow = (row: TransactionRow) => {
    const state = rowAttention(row);
    return state ? <AttentionState state={state} iconOnly size="sm" /> : null;
  };

  // The shared config-driven driver renders the canonical chrome FROM the
  // config; the screen passes its live stateful nodes as slots (toolbar filter
  // controls, the insight banner, the detail/dialog overlays). This is a faithful
  // 1:1 extraction of the previous inline fixed/scroll shell — zero behavior
  // change — that proves the WorkbenchConfig contract on the reference surface.
  return (
    <WorkbenchSurface<TransactionRow>
      config={transactionsConfig}
      banner={
        <>
          {/* E8-T4: the single per-page insight banner, built from the SAME
              coreViews.transactions.insights aggregate the register already
              loaded. The chip jumps to the uncategorized (needs-review) view;
              Explain narrates these figures via the AI layer (no fabricated
              numbers). Hidden when the builder returns null (threshold-gated). */}
          {pageInsight ? (
            <InsightBanner
              page="transactions"
              insight={pageInsight}
              onChip={(action) => {
                if (action === "uncategorized") setReview("needs_review");
              }}
              explainSlot={
                <InsightBannerExplain section="transactions" entityId={data.entity.id} from={bounds.from} to={bounds.to} />
              }
            />
          ) : null}
          {transactionMessage ? (
            <div className="shrink-0 rounded-[14px] bg-primary/5 p-3 text-sm text-primary" data-testid="transaction-message">
              {transactionMessage}
            </div>
          ) : null}
        </>
      }
      savedViews={{
        views: savedViewSummaries,
        activeViewId,
        dirty: viewDirty,
        allLabel: "All transactions",
        onSelect: selectView,
        onCreate: createView,
        onUpdate: updateActiveView,
        onDelete: deleteView,
      }}
      chips={chips}
      onRemoveChip={removeChip}
      onClearAll={clearAllFilters}
      pills={
        <>
          {/* The global command search owns text lookup. This rail stays focused
              on page-scoped constraints and table actions. E7-9: the panel holds
              every facet EXCEPT Date + Amount, which are the standalone quick
              pills beside it — one source per facet, no double exposure. */}
          <FilterPanelButton
            facets={panelFacets}
            value={filterPanelValue}
            onChange={onFilterPanelChange}
            onClearAll={clearAllFilters}
          />
          <DateRangeControl value={range} onChange={setRange} compact />
          <AmountFilterPill value={amount} onChange={setAmount} />
        </>
      }
      trailing={
        <>
          <GroupByMenu noun="transactions" value={groupBy} onChange={setGroupBy} />
          <SortMenu noun="transactions" columns={sortMenuColumns} value={sort} onChange={setSort} />
          <DisplaySettingsMenu value={display} onChange={setDisplay} columns={columnToggleList} />
          <AddMenu
            onAddTransaction={() => setAddOpen(true)}
            onImport={() => setImportOpen(true)}
            exportChoices={[
              {
                label: checkedIds.length ? `Selected (${checkedIds.length}) — CSV` : "Current filter — CSV",
                onSelect: () =>
                  checkedIds.length
                    ? exportRowsCsv((data.rows ?? []).filter((row) => checkedIds.includes(row.id)), "selected")
                    : exportRowsCsv(visibleRows, "current-filter"),
              },
              { label: "Full register — CSV", onSelect: () => exportRowsCsv(data.rows ?? [], "all") },
              { label: "Audit log — CSV", onSelect: exportAuditLog },
            ]}
          />
        </>
      }
      columns={visibleColumns}
      rows={visibleRows}
      groups={tableGroups}
      getRowId={(row) => row.id}
      onRowClick={selectRow}
      selectable
      selectedIds={checkedIds}
      onSelectionChange={setCheckedIds}
      bulkActions={bulkActions}
      density={display.density}
      sort={sort}
      onSortChange={setSort}
      rowAttributes={(row) => ({
        "data-testid": "transaction-row",
        "data-transaction-id": row.id,
        // E7-6: marks the J/K keyboard-focused row (quiet inset ring via globals.css).
        "data-focused": row.id === focusedRowId ? "true" : undefined,
      })}
      expandedIds={expandedIds}
      renderExpanded={(row) => <TransactionRowDetailStrip row={row} />}
      attention={attentionForRow}
      empty={
        <div data-testid="transactions-empty">
          <EmptyState
            title="No transactions here"
            description="Connect a bank or import CSV transactions to populate this register, or adjust the filters above."
          />
        </div>
      }
      emptyGroups={
        <div data-testid="transactions-empty">
          <EmptyState
            title="No transactions here"
            description="No transactions match the current filters. Adjust the filters above to see more."
          />
        </div>
      }
      overlays={
        <>
          <TransactionDetail
        row={selected}
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        entityId={data.entity.id}
        categoryOptions={data.categoryOptions}
        pending={pending}
        otherIncomeCategoryId={otherIncomeCategoryId}
        onRecategorize={updateCategory}
        onExclude={excludeSelected}
        splitFirstAmount={activeSplitFirstAmount}
        splitSecondAmount={activeSplitSecondAmount}
        splitFirstCategoryId={activeSplitFirstCategoryId}
        splitSecondCategoryId={activeSplitSecondCategoryId}
        onSplitFirstAmount={setSplitFirstAmount}
        onSplitSecondAmount={setSplitSecondAmount}
        onSplitFirstCategory={setSplitFirstCategoryId}
        onSplitSecondCategory={setSplitSecondCategoryId}
        onPostSplit={postSplit}
      />

      <AddTransactionDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        merchant={manualMerchant}
        amount={manualAmount}
        date={manualDate}
        categoryId={manualCategoryId || defaultCategoryId}
        bankAccountId={manualBankAccountId || defaultBankAccountId}
        categoryOptions={data.categoryOptions}
        bankAccounts={data.bankAccounts}
        onMerchant={setManualMerchant}
        onAmount={setManualAmount}
        onDate={setManualDate}
        onCategory={setManualCategoryId}
        onBankAccount={setManualBankAccountId}
        canSubmit={Boolean(defaultBankAccountId && (manualCategoryId || defaultCategoryId))}
        pending={pending}
        onSubmit={async () => {
          await addManualTransaction();
          setAddOpen(false);
        }}
      />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        csvText={csvText}
        onCsvText={setCsvText}
        csvRowCount={csvRows.length}
        duplicateCsvCount={duplicateCsvCount}
        canImport={Boolean(defaultBankAccountId)}
        pending={pending}
        onImport={async () => {
          await importCsv();
          setImportOpen(false);
        }}
      />
      <BulkRecategorizeDialog
        open={bulkRecategorizeOpen}
        onOpenChange={setBulkRecategorizeOpen}
        count={checkedIds.length}
        categoryId={bulkRecategorizeTargetId}
        onCategory={setBulkRecategorizeTargetId}
        categoryOptions={data.categoryOptions}
        pending={pending}
        onConfirm={async () => {
          await bulkRecategorizeWith(checkedIds, bulkRecategorizeTargetId);
          setBulkRecategorizeOpen(false);
        }}
      />
        </>
      }
    />
  );
}

// A hidden affordance row that wires the audit-log + full-register exports into
// the ExportMenu's dropdown without crowding the header bar.
function TransactionDetail({
  row,
  open,
  onOpenChange,
  entityId,
  categoryOptions,
  pending,
  otherIncomeCategoryId,
  onRecategorize,
  onExclude,
  splitFirstAmount,
  splitSecondAmount,
  splitFirstCategoryId,
  splitSecondCategoryId,
  onSplitFirstAmount,
  onSplitSecondAmount,
  onSplitFirstCategory,
  onSplitSecondCategory,
  onPostSplit,
}: {
  row: TransactionRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId?: string;
  categoryOptions: TransactionsData["categoryOptions"];
  pending: boolean;
  otherIncomeCategoryId: string;
  onRecategorize: (transactionId: string, categoryAccountId: string) => void;
  onExclude: () => void;
  splitFirstAmount: string;
  splitSecondAmount: string;
  splitFirstCategoryId: string;
  splitSecondCategoryId: string;
  onSplitFirstAmount: (value: string) => void;
  onSplitSecondAmount: (value: string) => void;
  onSplitFirstCategory: (value: string) => void;
  onSplitSecondCategory: (value: string) => void;
  onPostSplit: () => void;
}) {
  if (!row) return null;
  const debitTotal = row.lines.reduce((sum, line) => sum + line.debitMinor, 0);
  const creditTotal = row.lines.reduce((sum, line) => sum + line.creditMinor, 0);
  const balanced = row.lines.length > 0 && debitTotal === creditTotal;
  const attentionState = rowAttention(row);

  // E7-7: the two split parts must sum to the original (absolute) amount before
  // Post split is allowed — the ledger would reject an unbalanced repost, so the
  // UI pre-validates (pure helper) and shows a clear hint rather than failing
  // server-side.
  const splitBalance = evaluateSplitBalance(splitFirstAmount, splitSecondAmount, row.amountMinor);
  const originalSplitMinor = splitBalance.originalMinor;
  const splitBalanced = splitBalance.balanced;
  const splitRemainderMinor = splitBalance.remainderMinor;

  // One scrolling stack so every section — receipt, accounting view, activity,
  // edit — stays reachable and the balanced state reads at a glance.
  const content = (
      <div className="flex flex-col gap-4" data-testid="transaction-drawer">
        <div className="rounded-[14px] p-3 ring-1 ring-foreground/10">
          <div className="text-xs text-muted-foreground">Amount</div>
          <div className="mt-1 text-2xl font-semibold">
            <Amount amountMinor={row.amountMinor} tone={row.amountMinor > 0 ? "income" : "expense"} />
          </div>
        </div>

        {/* From → to flow: which account moved money to / from which party. */}
        <div className="rounded-[14px] p-3 ring-1 ring-foreground/10">
          <div className="mb-2 text-xs text-muted-foreground">Flow</div>
          {(() => {
            const inflow = row.amountMinor > 0;
            const fromLabel = inflow ? (row.contactName ?? row.merchant) : row.bankAccountName;
            const fromSub = inflow ? sourceLabel(row.source) : "Paid from account";
            const toLabel = inflow ? row.bankAccountName : (row.contactName ?? row.merchant);
            return (
              <div className="flex flex-col">
                <div className="flex items-start gap-2.5">
                  <div className="flex flex-col items-center">
                    <span className="mt-1 size-2 rounded-full bg-muted-foreground/50" />
                    <span className="my-0.5 h-6 w-px bg-border" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{fromLabel}</div>
                    <div className="money-figures text-xs text-muted-foreground">{row.date} · {fromSub}</div>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="mt-1 size-2 rounded-full bg-primary" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{toLabel}</div>
                    <div className="truncate text-xs text-muted-foreground">{row.categoryName}</div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <DetailField label="Category" value={row.categoryName} />
          <DetailField label="Account" value={row.bankAccountName} />
          <DetailField label="Contact" value={row.contactName ?? "—"} />
          <DetailField label="Source" value={row.source} />
        </dl>

        {row.decidedBy === "ai" ? (
          <AiInsightBadge
            variant="inline"
            confidence={row.confidence ?? undefined}
            reasoning={humanizeReasoning(row.reasoning) ?? "Categorized by the AI."}
            decidedBy={row.decidedBy ?? undefined}
          />
        ) : null}

        <AttachmentPanel transactionId={row.id} entityId={entityId} isExpense={row.amountMinor < 0} />

        {/* The double-entry record this transaction posted to — the hidden books surfaced. */}
        <div className="rounded-[14px] ring-1 ring-foreground/10">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm font-semibold">
            <span>Double-entry record</span>
            <CategoryChip active={balanced} label={balanced ? "Balanced lines" : "Unposted"} />
          </div>
          <div className="divide-y">
            {row.lines.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">No posted entry yet.</div>
            ) : (
              row.lines.map((line) => (
                <div key={line.id} className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 text-sm" data-testid="accounting-line">
                  <span className="min-w-0 truncate text-muted-foreground">{line.accountNumber} - {line.accountName}</span>
                  <Amount amountMinor={line.debitMinor} />
                  <Amount amountMinor={line.creditMinor} />
                </div>
              ))
            )}
          </div>
          <p className="px-3 py-2 text-xs text-muted-foreground">The hidden ledger this transaction posted to — debits always equal credits.</p>
        </div>

        {/* E7-7: every correction here is a reverse + repost — posted journal
            entries are immutable, so recategorize / split / exclude reverse the
            original entry and post a new one; nothing is edited in place. */}
        <div className="rounded-[14px] ring-1 ring-foreground/10" data-testid="correct-entry-section">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-semibold">
            <Undo2 className="size-4 text-primary" />
            Correct this entry
          </div>
          <div className="flex flex-col gap-3 p-3">
            <p className="text-xs text-muted-foreground">
              Posted entries are immutable. Recategorizing, splitting, or excluding
              reverses the original journal entry and posts a new one — your history
              stays intact and auditable.
            </p>

            {/* Primary path: pick the exact category. Posts a reverse + repost. */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Recategorize to</span>
              <InlineCategoryCombobox
                testId="drawer-category"
                value={row.categoryAccountId}
                options={categoryOptions.map((option) => ({
                  id: option.id,
                  label: `${option.number} ${option.name}`,
                  type: option.type,
                }))}
                needsReview={row.review === "needs_review"}
                disabled={pending}
                className="w-full"
                onChange={(categoryAccountId) => onRecategorize(row.id, categoryAccountId)}
              />
            </div>

            {/* Kept for the one-tap quick action / e2e flow, explicitly labeled as
                a sample target so it never reads as a silent destination. */}
            <Button
              data-testid="quick-recategorize"
              variant="outline"
              size="sm"
              disabled={pending || !otherIncomeCategoryId}
              onClick={() => onRecategorize(row.id, otherIncomeCategoryId)}
            >
              <Check data-icon="inline-start" />
              Recategorize to sample category
            </Button>
          </div>
        </div>

        <Collapsible>
          <div className="rounded-[14px] ring-1 ring-foreground/10">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                data-testid="split-toggle"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm font-semibold outline-none"
              >
                <span className="flex items-center gap-2">
                  <SplitSquareHorizontal className="size-4 text-primary" />
                  Split transaction
                </span>
                <ChevronDown className="size-4 text-muted-foreground" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="flex flex-col gap-3 border-t p-3">
                <p className="text-xs text-muted-foreground">
                  Split this charge across two categories — e.g. part office supplies, part software. Reverses the original entry and reposts the two parts.
                </p>
                <div className="grid gap-2 sm:grid-cols-[1fr_110px]">
                  <Select value={splitFirstCategoryId} onValueChange={onSplitFirstCategory}>
                    <SelectTrigger>
                      <SelectValue placeholder="First category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {categoryOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.number} - {option.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Input value={splitFirstAmount} onChange={(event) => onSplitFirstAmount(event.target.value)} inputMode="decimal" />
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_110px]">
                  <Select value={splitSecondCategoryId} onValueChange={onSplitSecondCategory}>
                    <SelectTrigger>
                      <SelectValue placeholder="Second category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {categoryOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.number} - {option.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Input value={splitSecondAmount} onChange={(event) => onSplitSecondAmount(event.target.value)} inputMode="decimal" />
                </div>
                {/* E7-7: pre-validate that the two parts sum to the original
                    amount before allowing Post split — the ledger rejects an
                    unbalanced repost, so surface a clear hint here instead. */}
                {!splitBalanced ? (
                  <p
                    data-testid="split-balance-hint"
                    className="text-xs text-warning"
                  >
                    The two parts must add up to <Amount amountMinor={originalSplitMinor} />. {" "}
                    {Number.isNaN(splitRemainderMinor) ? null : (
                      <>
                        <Amount amountMinor={Math.abs(splitRemainderMinor)} />{" "}
                        {splitRemainderMinor > 0 ? "left to allocate" : "over"}.
                      </>
                    )}
                  </p>
                ) : null}
                <Button
                  data-testid="split-post"
                  onClick={onPostSplit}
                  disabled={pending || !splitFirstCategoryId || !splitSecondCategoryId || !splitBalanced}
                >
                  <SplitSquareHorizontal data-icon="inline-start" />
                  Post split
                </Button>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>

        {/* Activity / history. */}
        <div className="rounded-[14px] ring-1 ring-foreground/10">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-semibold">
            <History className="size-4 text-primary" />
            Activity history
          </div>
          <div className="divide-y">
            {row.activity.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">No audit events linked yet.</div>
            ) : (
              row.activity.map((event) => (
                <div key={event.id} className="px-3 py-2 text-sm">
                  <div className="font-medium">{event.action}</div>
                  <div className="text-muted-foreground">{event.summary}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <CommentsThread transactionId={row.id} />
      </div>
  );

  const footer = (
    // E7-7: name the side effect — excluding a posted transaction reverses its
    // journal entry; it does not silently delete history.
    <Button variant="outline" disabled={pending} onClick={onExclude}>
      <X data-icon="inline-start" />
      Exclude (reverses any posted entry)
    </Button>
  );

  // The SAME shared DetailSheet every other section uses (E5.3): a right Sheet on
  // lg+ and a bottom Drawer on mobile, flipping at the standard 1023px
  // breakpoint — no bespoke non-modal aside, no section-unique 1279px breakpoint.
  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row.merchant}
      subtitle={row.rawDescription}
      attention={attentionState ? <AttentionState state={attentionState} /> : null}
      footer={footer}
    >
      {content}
    </DetailSheet>
  );
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate font-medium capitalize">{value}</dd>
    </div>
  );
}

function AddTransactionDialog({
  open,
  onOpenChange,
  merchant,
  amount,
  date,
  categoryId,
  bankAccountId,
  categoryOptions,
  bankAccounts,
  onMerchant,
  onAmount,
  onDate,
  onCategory,
  onBankAccount,
  canSubmit,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  merchant: string;
  amount: string;
  date: string;
  categoryId: string;
  bankAccountId: string;
  categoryOptions: TransactionsData["categoryOptions"];
  bankAccounts: TransactionsData["bankAccounts"];
  onMerchant: (value: string) => void;
  onAmount: (value: string) => void;
  onDate: (value: string) => void;
  onCategory: (value: string) => void;
  onBankAccount: (value: string) => void;
  canSubmit: boolean;
  pending: boolean;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add transaction</DialogTitle>
          <DialogDescription>
            Routes through the same pipeline as imports — it posts to the ledger, and lands in your Inbox if uncertain.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="manual-merchant">Merchant</FieldLabel>
            <Input id="manual-merchant" data-testid="manual-merchant" value={merchant} onChange={(event) => onMerchant(event.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="manual-amount">Amount</FieldLabel>
              <Input id="manual-amount" data-testid="manual-amount" value={amount} inputMode="decimal" onChange={(event) => onAmount(event.target.value)} />
              <FieldDescription>Negative = money out.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="manual-date">Date</FieldLabel>
              <Input id="manual-date" type="date" value={date} onChange={(event) => onDate(event.target.value)} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="manual-category">Category</FieldLabel>
            <Select value={categoryId} onValueChange={onCategory}>
              <SelectTrigger id="manual-category">
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {categoryOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.number} · {option.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {bankAccounts.length > 1 ? (
            <Field>
              <FieldLabel htmlFor="manual-account">Account</FieldLabel>
              <Select value={bankAccountId} onValueChange={onBankAccount}>
                <SelectTrigger id="manual-account">
                  <SelectValue placeholder="Choose an account" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {bankAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button data-testid="manual-add" onClick={onSubmit} disabled={pending || !canSubmit}>
            <Plus data-icon="inline-start" />
            Add transaction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({
  open,
  onOpenChange,
  csvText,
  onCsvText,
  csvRowCount,
  duplicateCsvCount,
  canImport,
  pending,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  csvText: string;
  onCsvText: (value: string) => void;
  csvRowCount: number;
  duplicateCsvCount: number;
  canImport: boolean;
  pending: boolean;
  onImport: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import transactions</DialogTitle>
          <DialogDescription>
            Paste CSV / OFX rows. Everything routes through the pipeline — transfers, rules, and AI run first; uncertain items land in your Inbox.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="csv-text">CSV rows</FieldLabel>
            <textarea
              id="csv-text"
              data-testid="csv-text"
              className="min-h-32 w-full rounded-[10px] border bg-background p-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              value={csvText}
              onChange={(event) => onCsvText(event.target.value)}
            />
            <FieldDescription>
              Column 1: Date · Column 2: Description · Column 3: Amount.{" "}
              <span className="money-figures">{csvRowCount}</span> rows ready ·{" "}
              <span className="money-figures">{duplicateCsvCount}</span> duplicate-looking.
            </FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button data-testid="csv-import" onClick={onImport} disabled={pending || !canImport}>
            <FileUp data-icon="inline-start" />
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// E7-6: the bulk-recategorize target picker. Bulk Recategorize no longer routes
// silently to a hardcoded 'other income' account — the owner chooses where the
// selected rows should land, and each posts a reverse+repost through the single
// ledger path.
function BulkRecategorizeDialog({
  open,
  onOpenChange,
  count,
  categoryId,
  onCategory,
  categoryOptions,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  categoryId: string;
  onCategory: (value: string) => void;
  categoryOptions: TransactionsData["categoryOptions"];
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="bulk-recategorize-dialog">
        <DialogHeader>
          <DialogTitle>Recategorize {count} transaction{count === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>
            Choose the category these move to. Each one reverses its original journal entry and reposts — nothing is edited in place.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="bulk-recategorize-category">Category</FieldLabel>
            <Select value={categoryId} onValueChange={onCategory}>
              <SelectTrigger id="bulk-recategorize-category" data-testid="bulk-recategorize-category">
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {categoryOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.number} · {option.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid="bulk-recategorize-confirm"
            onClick={onConfirm}
            disabled={pending || !categoryId || count === 0}
          >
            <Tags data-icon="inline-start" />
            Recategorize {count}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
