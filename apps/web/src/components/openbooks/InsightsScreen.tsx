"use client";

import { useQuery } from "convex/react";
import { useMemo, useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { statusLabel } from "@/components/openbooks/module-helpers";
import { EmptyState, formatMinorMoney } from "@/components/openbooks/primitives";
import {
  AiObservationColumn,
  type AiObservation,
  type CompareMode,
  type DateRangeValue,
  type DrillTarget,
  InsightsChart,
  type InsightsChartPoint,
  InsightsChartCard,
  InsightsKpiCard,
  InsightsKpiGrid,
  InsightsPanel,
  InsightsPanelSkeleton,
  InsightsWidgetState,
  resolveScope,
  TransactionsDrillDrawer,
} from "@/components/openbooks/workbench";
import { useActiveEntity } from "@/lib/openbooks/active-entity";
import { isoDaysAgo, useTodayIso } from "@/lib/openbooks/today";

// The "today" anchor for relative presets comes from the shared server/browser
// clock (useTodayIso) — the single source of truth for every insights / aging /
// overdue window (decisions.md Q40). No frozen demo date lives here anymore.
//
// Dormant = no activity in the ~90 days before the anchor.
const DORMANT_WINDOW_DAYS = 90;

// One brand green for money-in; a neutral slate for money-out — ordinary spend
// stays calm, never alarm-red (finance color discipline E1.7).
const COLOR_IN = "var(--ob-green-500)";
const COLOR_OUT = "#cbd2d9";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(iso: string) {
  const [, month, day] = iso.split("-").map(Number);
  return `${MONTHS[(month ?? 1) - 1]} ${day}`;
}

function payrollPeriodLabel(period: string) {
  const [yearText, monthText] = period.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!year || !month) return period;
  return `${MONTHS[month - 1]} ${year}`;
}

function titleCaseStatus(value: string) {
  const label = statusLabel(value);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * The Transactions Insights sub-tab (E1.6) — the first consumer of the reusable
 * Insights system, built to prove every craft component:
 *  - InsightsScope: period + Compare-to + always-resolved calendar dates.
 *  - InsightsKpiCard band with named comparison frames (delta suppressed when
 *    there's no history).
 *  - InsightsChart: daily cash-flow with a shared crosshair + unified tooltip,
 *    click-to-drill into the day's transactions, and a legend cross-filter.
 *  - AiObservationColumn: monochrome, threshold-gated cards with drillable
 *    counterparty chips.
 *  - TransactionsDrillDrawer: the shared read-only drawer the chart and the AI
 *    chips both open.
 */
export function TransactionsInsights() {
  const { activeEntity } = useActiveEntity();
  const todayISO = useTodayIso();
  const [range, setRange] = useState<DateRangeValue>({ preset: "this-month" });
  const [compareMode, setCompareMode] = useState<CompareMode>("previous-period");
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  const scope = useMemo(() => resolveScope(range, compareMode, todayISO), [range, compareMode, todayISO]);
  const bounds = scope.active;

  // Retain the last loaded value across a period/compare change so the panel
  // morphs the existing charts instead of unmounting into a skeleton (E1.5).
  const live = useQuery(api.coreViews.transactions, {
    ...(activeEntity.id ? { entityId: activeEntity.id as Id<"entities"> } : {}),
    from: bounds.from,
    to: bounds.to,
  });
  const [last, setLast] = useState<typeof live>(undefined);
  if (live !== undefined && live !== last) setLast(live);
  const data = live ?? last ?? undefined;

  const insights = data?.insights;
  const currency = data?.entity.currency ?? "USD";

  // First paint only: no prior value AND still loading.
  if (data === undefined) {
    return <InsightsPanelSkeleton kpiCount={4} />;
  }
  if (!insights) {
    return (
      <EmptyState
        title="No transactions yet"
        description="Connect a bank or import activity to see cash-flow insights for this business."
      />
    );
  }

  // Daily cash-flow series, derived from the cumulative running totals the
  // aggregate returns (delta between consecutive cumulative points = that day's
  // in/out). drillKey carries the ISO day so a click opens that day's drawer.
  const points: InsightsChartPoint[] = insights.cumulative.map((point, index) => {
    const prev = index > 0 ? insights.cumulative[index - 1] : { inMinor: 0, outMinor: 0 };
    return {
      x: point.date,
      label: shortDate(point.date),
      drillKey: point.date,
      inMinor: point.inMinor - prev.inMinor,
      outMinor: point.outMinor - prev.outMinor,
    };
  });

  const hasCompare = scope.compare != null;
  const frame = scope.compareFrameLabel;
  const prevNet = hasCompare ? insights.prevNetChangeMinor : null;
  const prevIn = hasCompare ? insights.prevMoneyInMinor : null;
  const prevOut = hasCompare ? insights.prevMoneyOutMinor : null;

  // Per-day net series for the hero card's sparkline — shows the shape of the
  // period's cash movement, not just its endpoint.
  const netSpark = insights.dailyNet;
  const inSpark = points.map((point) => Number(point.inMinor) || 0);
  const outSpark = points.map((point) => Number(point.outMinor) || 0);

  // Uncategorized is a watch-item, not an alarm: amber when there's exposure,
  // calm/green when the period is fully classified. Color is always paired with
  // a count + label (never color alone).
  const uncategorizedClean = insights.uncategorizedCount === 0;

  const kpis = (
    <InsightsKpiGrid columns={5}>
      <InsightsKpiCard
        label="Net cashflow"
        value={`${insights.netChangeMinor >= 0 ? "" : "−"}${formatMinorMoney(Math.abs(insights.netChangeMinor), { currency })}`}
        tone={insights.netChangeMinor >= 0 ? "income" : "neutral"}
        comparison={{ current: insights.netChangeMinor, previous: prevNet, frameLabel: frame }}
        sparkline={netSpark}
      />
      <InsightsKpiCard
        label="Money in"
        value={formatMinorMoney(insights.moneyInMinor, { currency })}
        tone="income"
        comparison={{ current: insights.moneyInMinor, previous: prevIn, frameLabel: frame }}
        sparkline={inSpark}
      />
      <InsightsKpiCard
        label="Money out"
        value={`−${formatMinorMoney(insights.moneyOutMinor, { currency })}`}
        // Ordinary spend stays NEUTRAL — never alarm-red. Up = bad here, so the
        // delta inverts: a rise reads as a watch-item, a fall as a positive.
        comparison={{
          current: insights.moneyOutMinor,
          previous: prevOut,
          frameLabel: frame,
          invertColor: true,
        }}
        sparkline={outSpark}
      />
      <InsightsKpiCard
        label="Ending cash"
        value={`${insights.endingCashMinor >= 0 ? "" : "−"}${formatMinorMoney(Math.abs(insights.endingCashMinor), { currency })}`}
        tone={insights.endingCashMinor < 0 ? "negative" : "neutral"}
        detail={`Cash on hand · ${shortDate(bounds.to)}`}
      />
      <InsightsKpiCard
        label="Uncategorized"
        value={String(insights.uncategorizedCount)}
        detail={
          uncategorizedClean
            ? "All transactions classified"
            : `${formatMinorMoney(insights.uncategorizedMinor, { currency })} need a category`
        }
        status={
          uncategorizedClean
            ? { label: "All classified", tone: "good" }
            : { label: "Needs review", tone: "warning" }
        }
        onClick={
          uncategorizedClean
            ? undefined
            : () =>
                setDrill({
                  title: "Uncategorized",
                  from: bounds.from,
                  to: bounds.to,
                  uncategorized: true,
                })
        }
      />
    </InsightsKpiGrid>
  );

  const charts = (
    <InsightsChartCard title="Daily cash flow">
      {points.length < 2 ? (
        <InsightsWidgetState kind={points.length === 0 ? "empty" : "low-data"} minHeight={220} />
      ) : (
        <InsightsChart
          data={points}
          currency={currency}
          height={220}
          series={[
            { key: "inMinor", label: "Money in", color: COLOR_IN, type: "bar" },
            { key: "outMinor", label: "Money out", color: COLOR_OUT, type: "bar" },
          ]}
          onDrill={(point) =>
            setDrill({
              title: point.drillKey ? shortDate(point.drillKey) : "Transactions",
              from: bounds.from,
              to: bounds.to,
              day: point.drillKey,
            })
          }
        />
      )}
    </InsightsChartCard>
  );

  // Top counterparties become drillable chips on a single AI-style observation,
  // alongside the model's generated findings.
  const topCounterparties = insights.counterparties.slice(0, 3);
  // When a finding mentions one of the period's counterparties, attach a drill
  // chip for it so the AI card itself is actionable (E1.4 entity chips) — never
  // auto-acting, only opening the read-only drawer.
  const mapFinding = (finding: { title: string; detail: string; tone: AiObservation["tone"] }): AiObservation => {
    const haystack = `${finding.title} ${finding.detail}`;
    const mentioned = insights.counterparties.filter((counterparty) =>
      haystack.includes(counterparty.label),
    );
    const entities = mentioned.slice(0, 2).map((counterparty) => ({
      label: counterparty.label,
      target: {
        title: counterparty.label,
        from: bounds.from,
        to: bounds.to,
        counterparty: counterparty.label,
      },
    }));
    return {
      text: finding.detail || finding.title,
      tone: finding.tone,
      ...(entities.length > 0 ? { entities } : {}),
      why: "Surfaced from this period's posted transactions.",
    };
  };

  const observations = (
    <div className="flex flex-col gap-4">
      {topCounterparties.length > 0 ? (
        <CounterpartyObservation
          counterparties={topCounterparties}
          currency={currency}
          onDrill={setDrill}
          from={bounds.from}
          to={bounds.to}
        />
      ) : null}
      <AiObservationColumn
        section="transactions"
        entityId={activeEntity.id}
        from={bounds.from}
        to={bounds.to}
        onDrill={setDrill}
        mapFinding={mapFinding}
      />
    </div>
  );

  return (
    <>
      <InsightsPanel
        range={range}
        onRangeChange={setRange}
        compareMode={compareMode}
        onCompareModeChange={setCompareMode}
        todayISO={todayISO}
        kpis={kpis}
        charts={charts}
        observations={observations}
      />
      <TransactionsDrillDrawer
        target={drill}
        entityId={activeEntity.id}
        onOpenChange={(open) => {
          if (!open) setDrill(null);
        }}
      />
    </>
  );
}

/** A deterministic "top to / from" observation card built from the aggregate's
 * counterparties — each a chip that drills to that counterparty's transactions.
 * Uses the same monochrome AiObservationCard shell. */
function CounterpartyObservation({
  counterparties,
  currency,
  onDrill,
  from,
  to,
}: {
  counterparties: { label: string; amountMinor: number }[];
  currency: string;
  onDrill: (target: DrillTarget) => void;
  from: string;
  to: string;
}) {
  const top = counterparties[0];
  return (
    <section className="flex flex-col gap-2 rounded-[14px] p-4 shadow-xs ring-1 ring-foreground/10">
      <h3 className="text-sm font-semibold">Top to / from</h3>
      <p className="text-sm leading-snug">
        <span className="money-figures font-medium">{top.label}</span> moved the most this period
        {" — "}
        <span className="money-figures">{formatMinorMoney(Math.abs(top.amountMinor), { currency })}</span>.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {counterparties.map((counterparty) => (
          <button
            key={counterparty.label}
            type="button"
            onClick={() =>
              onDrill({ title: counterparty.label, from, to, counterparty: counterparty.label })
            }
            className="inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium transition-colors hover:bg-accent"
            data-testid="counterparty-chip"
          >
            <span className="max-w-[9rem] truncate">{counterparty.label}</span>
            <span className="money-figures text-muted-foreground">
              {formatMinorMoney(Math.abs(counterparty.amountMinor), { currency, compact: true })}
            </span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Click a name to see the underlying transactions.
      </p>
    </section>
  );
}

// The per-section Insights sub-tab dispatcher (Epic E0.5). The operational
// section's "Insights" sub-tab renders this. Transactions is the fully-built
// reference (above); the other sections show the shared scaffold's stub until
// their Insights epic (E2.3 / E3.3 / E4.5) wires real data on these same E1
// components. Returning section content — not a whole nav screen — keeps the
// section's own header / sub-tab bar in place.
const SECTION_INSIGHTS_LABELS: Record<string, string> = {
  income: "Income",
  expenses: "Expenses",
  bills: "Bills",
  contacts: "Contacts",
  payroll: "Payroll",
};

function SectionInsightsStub({ label }: { label: string }) {
  return (
    <EmptyState
      title={`${label} insights`}
      description="Coming in this pass — the same Insights system (scope bar, KPI cards, drillable charts, and AI observations) tailored to this section."
    />
  );
}

export function SectionInsights({ section }: { section: string }) {
  if (section === "transactions") {
    return <TransactionsInsights />;
  }
  if (section === "income") {
    return <IncomeInsights />;
  }
  if (section === "expenses") {
    // The Expenses section owns both the cash-spend ledger and the Bills (AP)
    // sub-tab, so its Insights tab exposes BOTH panels behind a quiet toggle —
    // the Bills (AP) insights now render a real panel, not the old stub (E8-T5).
    return <ExpensesSectionInsights />;
  }
  if (section === "bills") {
    return <BillsInsights />;
  }
  if (section === "contacts") {
    return <ContactsInsights />;
  }
  if (section === "payroll") {
    return <PayrollInsights />;
  }
  return <SectionInsightsStub label={SECTION_INSIGHTS_LABELS[section] ?? section} />;
}

/**
 * The Expenses section's Insights tab. Bills (AP) lives as a ledger sub-tab under
 * Expenses, so its analytics belong here too — a quiet [Spending · Bills] toggle
 * switches between the cash-spend panel and the Bills (AP) panel. Both are built
 * on the same E1 kit; the Bills view is a real panel, never the old stub (E8-T5).
 */
function ExpensesSectionInsights() {
  const [view, setView] = useState<"spending" | "bills">("spending");
  const tabClass = (active: boolean) =>
    `h-7 rounded-full px-3 text-xs font-medium transition-colors ${
      active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent"
    }`;
  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex w-fit items-center gap-1 rounded-full border p-0.5"
        role="tablist"
        aria-label="Expenses insights view"
        data-testid="expenses-insights-toggle"
      >
        <button
          type="button"
          role="tab"
          aria-selected={view === "spending"}
          className={tabClass(view === "spending")}
          onClick={() => setView("spending")}
        >
          Spending
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "bills"}
          className={tabClass(view === "bills")}
          onClick={() => setView("bills")}
          data-testid="expenses-insights-bills-tab"
        >
          Bills (AP)
        </button>
      </div>
      {view === "spending" ? <ExpensesInsights /> : <BillsInsights />}
    </div>
  );
}

/**
 * Bills (payables) Insights — the sixth section, built on the SAME E1 kit as the
 * others so the six panels read as one product (E8-T5). KPIs: AP outstanding +
 * overdue, due-soon, missing-evidence, paid-this-period, DPO (avg days to pay).
 * Charts: AP by due-window (overdue/this-week/later) + bills by vendor. AI
 * observations come from the shared `bills` aiInsights path. Finance color
 * discipline: overdue is the only negative; open/due-soon stay neutral/amber.
 * Aging/overdue resolve against the live server-clock anchor (E8-T1/T2) inside
 * moduleViews — never a frozen date.
 */
function BillsInsights() {
  const { activeEntity } = useActiveEntity();
  const todayISO = useTodayIso();
  const [range, setRange] = useState<DateRangeValue>({ preset: "last-3-months" });
  const [compareMode, setCompareMode] = useState<CompareMode>("none");
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  const scope = useMemo(() => resolveScope(range, compareMode, todayISO), [range, compareMode, todayISO]);
  const bounds = scope.active;

  const data = useQuery(
    api.moduleViews.overview,
    activeEntity.id ? { entityId: activeEntity.id as Id<"entities"> } : {},
  );

  if (data === undefined) {
    return <InsightsPanelSkeleton kpiCount={5} />;
  }
  if (!data.entity) {
    return (
      <EmptyState
        title="No bills yet"
        description="Add a bill or upload a PDF to see payables insights — what's open, due soon, or overdue."
      />
    );
  }

  const currency = data.entity.currency;
  const bills = data.bills;
  const k = bills.kpis;
  const groupTotal = (key: string) =>
    bills.groups.find((group) => group.key === key)?.rows.reduce((sum, bill) => sum + bill.totalMinor, 0) ?? 0;
  const overdueMinor = groupTotal("overdue");
  const dueThisWeekMinor = groupTotal("this_week");
  const laterMinor = groupTotal("later");

  const kpis = (
    <InsightsKpiGrid columns={5}>
      <InsightsKpiCard
        label="AP outstanding"
        value={formatMinorMoney(k.openMinor, { currency })}
        tone={k.overdueMinor > 0 ? "negative" : "neutral"}
        detail={k.overdueMinor > 0 ? `${formatMinorMoney(k.overdueMinor, { currency })} overdue` : "Nothing past due"}
        status={k.overdueMinor > 0 ? { label: "Overdue", tone: "warning" } : { label: "On track", tone: "good" }}
      />
      <InsightsKpiCard
        label="Due this week"
        value={formatMinorMoney(k.dueSoonMinor, { currency })}
        tone="neutral"
        detail="Open bills due within 7 days"
        status={k.dueSoonMinor > 0 ? { label: "Heads-up", tone: "warning" } : { label: "Clear", tone: "good" }}
      />
      <InsightsKpiCard
        label="Avg days to pay"
        value={String(k.avgDaysToPay)}
        detail="Net terms on paid bills (DPO proxy)"
      />
      <InsightsKpiCard
        label="Missing evidence"
        value={String(k.missingEvidenceCount)}
        tone="neutral"
        detail={k.missingEvidenceCount > 0 ? `${formatMinorMoney(k.missingEvidenceMinor, { currency })} unreceipted` : "Every open bill has a document"}
        status={k.missingEvidenceCount > 0 ? { label: "Review", tone: "warning" } : { label: "Complete", tone: "good" }}
      />
      <InsightsKpiCard
        label="Paid · last 30 days"
        value={formatMinorMoney(k.paidThisPeriodMinor, { currency })}
        tone="neutral"
        detail="Bills settled this period"
      />
    </InsightsKpiGrid>
  );

  // AP by due-window — overdue carries the warning weight, the rest stay neutral.
  const agingPoints: InsightsChartPoint[] = [
    { x: "overdue", label: "Overdue", outMinor: overdueMinor },
    { x: "this_week", label: "This week", outMinor: dueThisWeekMinor },
    { x: "later", label: "Later", outMinor: laterMinor },
  ];
  // Bills by vendor (open) — who you owe the most.
  const openBills = bills.groups
    .filter((group) => group.key !== "paid")
    .flatMap((group) => group.rows);
  const byVendor = new Map<string, number>();
  for (const bill of openBills) {
    byVendor.set(bill.vendorName, (byVendor.get(bill.vendorName) ?? 0) + bill.totalMinor);
  }
  const vendorRows = [...byVendor.entries()]
    .map(([name, totalMinor]) => ({ name, totalMinor }))
    .sort((a, b) => b.totalMinor - a.totalMinor)
    .slice(0, 8);
  const vendorPoints: InsightsChartPoint[] = vendorRows.map((row) => ({
    x: row.name,
    label: row.name.split(/\s+/)[0],
    drillKey: row.name,
    outMinor: row.totalMinor,
  }));

  const charts = (
    <>
      <InsightsChartCard title="Payables by due window">
        {k.openMinor === 0 ? (
          <InsightsWidgetState kind="empty" minHeight={200} />
        ) : (
          <InsightsChart
            data={agingPoints}
            currency={currency}
            height={200}
            series={[{ key: "outMinor", label: "Open payables", color: COLOR_OUT, type: "bar" }]}
          />
        )}
      </InsightsChartCard>
      <InsightsChartCard title="Open bills by vendor">
        {vendorPoints.length < 1 ? (
          <InsightsWidgetState kind="empty" minHeight={180} />
        ) : (
          <InsightsChart
            data={vendorPoints}
            currency={currency}
            height={180}
            series={[{ key: "outMinor", label: "Owed", color: COLOR_OUT, type: "bar" }]}
            onDrill={(point) => point.drillKey && setDrill({ title: point.drillKey, from: bounds.from, to: bounds.to, counterparty: point.drillKey })}
          />
        )}
      </InsightsChartCard>
    </>
  );

  const topVendor = vendorRows[0] ?? null;
  const mapFinding = (finding: { title: string; detail: string; tone: AiObservation["tone"] }): AiObservation => ({
    text: finding.detail || finding.title,
    tone: finding.tone,
    why: "Surfaced from open bills, due dates, settlement history, and receipt evidence.",
  });

  const observations = (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2 rounded-[14px] p-4 shadow-xs ring-1 ring-foreground/10">
        <h3 className="text-sm font-semibold">Payables readiness</h3>
        <p className="text-sm leading-snug">
          {k.openMinor > 0 ? (
            <>
              <span className="money-figures font-medium">{formatMinorMoney(k.openMinor, { currency })}</span> open
              {k.overdueMinor > 0 ? (
                <>
                  {" "}— <span className="money-figures">{formatMinorMoney(k.overdueMinor, { currency })}</span> overdue; pay these first.
                </>
              ) : (
                " — none overdue, you're current."
              )}
            </>
          ) : (
            "No open bills right now. Upload a PDF or add one by hand to track payables."
          )}
        </p>
        {topVendor ? (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setDrill({ title: topVendor.name, from: bounds.from, to: bounds.to, counterparty: topVendor.name })}
              className="inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium transition-colors hover:bg-accent"
              data-testid="bills-vendor-chip"
            >
              <span className="max-w-[9rem] truncate">{topVendor.name}</span>
              <span className="money-figures text-muted-foreground">{formatMinorMoney(topVendor.totalMinor, { currency, compact: true })}</span>
            </button>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">Bills insights read open payables, due windows, settlement timing, and evidence.</p>
      </section>
      <AiObservationColumn
        section="bills"
        entityId={activeEntity.id}
        from={bounds.from}
        to={bounds.to}
        onDrill={setDrill}
        mapFinding={mapFinding}
      />
    </div>
  );

  return (
    <>
      <InsightsPanel
        range={range}
        onRangeChange={setRange}
        compareMode={compareMode}
        onCompareModeChange={setCompareMode}
        todayISO={todayISO}
        kpis={kpis}
        charts={charts}
        observations={observations}
      />
      <TransactionsDrillDrawer
        target={drill}
        entityId={activeEntity.id}
        onOpenChange={(open) => {
          if (!open) setDrill(null);
        }}
      />
    </>
  );
}

/**
 * The Income Insights sub-tab (E2.3) — built on the SAME E1 components as
 * Transactions so the two feel like one product. KPIs: Total income (received),
 * MRR / avg-monthly, Top-customer share, DSO (avg days to pay), AR outstanding.
 * Charts: revenue trend vs prior period + AR aging + income by customer/stream.
 * AI observations come from the shared `income` aiInsights path. Finance color
 * discipline: money-in green, overdue red, everything else neutral.
 */
function IncomeInsights() {
  const { activeEntity } = useActiveEntity();
  const todayISO = useTodayIso();
  const [range, setRange] = useState<DateRangeValue>({ preset: "this-month" });
  const [compareMode, setCompareMode] = useState<CompareMode>("previous-period");
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  const scope = useMemo(() => resolveScope(range, compareMode, todayISO), [range, compareMode, todayISO]);
  const bounds = scope.active;

  // Active-period income; a second query for the comparison window powers the
  // KPI deltas + the prior-period chart series. Retain the last value so a
  // period change morphs the panel instead of dropping into a skeleton (E1.5).
  const liveActive = useQuery(api.incomeViews.overview, {
    ...(activeEntity.id ? { entityId: activeEntity.id as Id<"entities"> } : {}),
    range: { start: bounds.from, end: bounds.to },
  });
  const compareBounds = scope.compare;
  const liveCompare = useQuery(
    api.incomeViews.overview,
    compareBounds
      ? {
          ...(activeEntity.id ? { entityId: activeEntity.id as Id<"entities"> } : {}),
          range: { start: compareBounds.from, end: compareBounds.to },
        }
      : "skip",
  );

  const [lastActive, setLastActive] = useState<typeof liveActive>(undefined);
  if (liveActive !== undefined && liveActive !== lastActive) setLastActive(liveActive);
  const data = liveActive ?? lastActive ?? undefined;

  if (data === undefined) {
    return <InsightsPanelSkeleton kpiCount={5} />;
  }
  if (!data.entity) {
    return (
      <EmptyState
        title="No income yet"
        description="Connect a bank or import activity to see income insights for this business."
      />
    );
  }

  const currency = data.entity.currency;
  const k = data.kpis;
  const streams = data.streams;
  const customers = data.customers;

  // Received-this-period income vs the comparison window's received income.
  const receivedNow = k.receivedThisMonthMinor;
  const receivedPrev = scope.compare ? liveCompare?.kpis.receivedThisMonthMinor ?? null : null;
  const frame = scope.compareFrameLabel;

  // Top-customer concentration: the leading customer's share of period revenue.
  const totalCustomerRevenue = customers.reduce((sum, row) => sum + Math.max(0, row.receivedMinor), 0);
  const topCustomer = customers.find((row) => row.receivedMinor > 0) ?? null;
  const topShare = topCustomer && totalCustomerRevenue > 0 ? Math.round((topCustomer.receivedMinor / totalCustomerRevenue) * 100) : 0;

  const kpis = (
    <InsightsKpiGrid columns={5}>
      <InsightsKpiCard
        label="Total income"
        value={formatMinorMoney(receivedNow, { currency })}
        tone="income"
        comparison={{ current: receivedNow, previous: receivedPrev, frameLabel: frame }}
      />
      <InsightsKpiCard
        label="Monthly revenue"
        value={formatMinorMoney(k.recurringMrrMinor, { currency })}
        tone="income"
        detail={k.recurringMrrMonthLabel ? `Run rate · ${k.recurringMrrMonthLabel}` : "Trailing-month run rate"}
        sparkline={k.mrrSparkline.length > 1 ? k.mrrSparkline : undefined}
      />
      <InsightsKpiCard
        label="Top-customer share"
        value={topCustomer ? `${topShare}%` : "—"}
        detail={topCustomer ? topCustomer.name : "No revenue this period"}
        status={topShare >= 50 ? { label: "Concentrated", tone: "warning" } : null}
        onClick={
          topCustomer
            ? () =>
                setDrill({ title: topCustomer.name, from: bounds.from, to: bounds.to, counterparty: topCustomer.name })
            : undefined
        }
      />
      <InsightsKpiCard
        label="Avg days to pay"
        value={String(k.averageDaysToPay)}
        detail="Net terms on paid invoices (DSO proxy)"
      />
      <InsightsKpiCard
        label="AR outstanding"
        value={formatMinorMoney(k.stillOpenMinor, { currency })}
        tone={k.overdueMinor > 0 ? "negative" : "neutral"}
        detail={k.overdueMinor > 0 ? `${formatMinorMoney(k.overdueMinor, { currency })} overdue` : "Nothing past due"}
        status={k.overdueMinor > 0 ? { label: "Overdue", tone: "warning" } : { label: "On track", tone: "good" }}
      />
    </InsightsKpiGrid>
  );

  // Revenue trend by stream (this period) — a bar chart, money-in green.
  const streamPoints: InsightsChartPoint[] = streams.rows.slice(0, 8).map((row) => ({
    x: row.id,
    label: row.name.split(/\s+/)[0],
    drillKey: row.name,
    inMinor: row.totalMinor,
  }));

  // AR aging buckets — current is calm/green-neutral, the aged buckets carry
  // increasing concern (amber → red on the oldest), paired with the bucket label.
  const aging = data.receivables.buckets;
  const agingPoints: InsightsChartPoint[] = [
    { x: "current", label: "Current", inMinor: aging.currentMinor },
    { x: "30", label: "1–30", inMinor: aging.days30Minor },
    { x: "60", label: "31–60", inMinor: aging.days60Minor },
    { x: "90", label: "61–90", inMinor: aging.days90Minor },
  ];

  const charts = (
    <>
      <InsightsChartCard title="Revenue by stream · this period">
        {streamPoints.length < 1 ? (
          <InsightsWidgetState kind="empty" minHeight={200} />
        ) : (
          <InsightsChart
            data={streamPoints}
            currency={currency}
            height={200}
            series={[{ key: "inMinor", label: "Revenue", color: COLOR_IN, type: "bar" }]}
          />
        )}
      </InsightsChartCard>
      <InsightsChartCard title="Money owed by age">
        {k.stillOpenMinor === 0 ? (
          <InsightsWidgetState kind="empty" minHeight={180} />
        ) : (
          <InsightsChart
            data={agingPoints}
            currency={currency}
            height={180}
            series={[{ key: "inMinor", label: "Outstanding", color: COLOR_OUT, type: "bar" }]}
          />
        )}
      </InsightsChartCard>
    </>
  );

  // Income-by-customer drill chips alongside the model's findings.
  const topCustomers = customers.filter((row) => row.receivedMinor > 0).slice(0, 3);
  const mapFinding = (finding: { title: string; detail: string; tone: AiObservation["tone"] }): AiObservation => {
    const haystack = `${finding.title} ${finding.detail}`;
    const mentioned = customers.filter((row) => row.receivedMinor > 0 && haystack.includes(row.name));
    const entities = mentioned.slice(0, 2).map((row) => ({
      label: row.name,
      target: { title: row.name, from: bounds.from, to: bounds.to, counterparty: row.name },
    }));
    return {
      text: finding.detail || finding.title,
      tone: finding.tone,
      ...(entities.length > 0 ? { entities } : {}),
      why: "Surfaced from this period's income and receivables.",
    };
  };

  const observations = (
    <div className="flex flex-col gap-4">
      {topCustomers.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-[14px] p-4 shadow-xs ring-1 ring-foreground/10">
          <h3 className="text-sm font-semibold">Top customers</h3>
          <p className="text-sm leading-snug">
            <span className="money-figures font-medium">{topCustomers[0].name}</span> paid the most this period
            {" — "}
            <span className="money-figures">{formatMinorMoney(topCustomers[0].receivedMinor, { currency })}</span>.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {topCustomers.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setDrill({ title: row.name, from: bounds.from, to: bounds.to, counterparty: row.name })}
                className="inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium transition-colors hover:bg-accent"
                data-testid="income-customer-chip"
              >
                <span className="max-w-[9rem] truncate">{row.name}</span>
                <span className="money-figures text-muted-foreground">{formatMinorMoney(row.receivedMinor, { currency, compact: true })}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Click a name to see the underlying transactions.</p>
        </section>
      ) : null}
      <AiObservationColumn
        section="income"
        entityId={activeEntity.id}
        from={bounds.from}
        to={bounds.to}
        onDrill={setDrill}
        mapFinding={mapFinding}
      />
    </div>
  );

  return (
    <>
      <InsightsPanel
        range={range}
        onRangeChange={setRange}
        compareMode={compareMode}
        onCompareModeChange={setCompareMode}
        todayISO={todayISO}
        kpis={kpis}
        charts={charts}
        observations={observations}
      />
      <TransactionsDrillDrawer
        target={drill}
        entityId={activeEntity.id}
        onOpenChange={(open) => {
          if (!open) setDrill(null);
        }}
      />
    </>
  );
}

/**
 * The Expenses Insights sub-tab (E3.3) — built on the SAME E1 components as
 * Transactions / Income so all three feel like one product. KPIs: Total spend,
 * Burn (monthly), Runway (ending cash ÷ burn), Top-category share, Recurring.
 * Charts: spend by category + top vendors + AP aging / DPO. AI observations come
 * from the shared `expenses` aiInsights path. Finance color discipline: ordinary
 * spend stays NEUTRAL (never alarm-red); a tight runway carries the warning token.
 */
function ExpensesInsights() {
  const { activeEntity } = useActiveEntity();
  const todayISO = useTodayIso();
  const [range, setRange] = useState<DateRangeValue>({ preset: "this-month" });
  const [compareMode, setCompareMode] = useState<CompareMode>("previous-period");
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  const scope = useMemo(() => resolveScope(range, compareMode, todayISO), [range, compareMode, todayISO]);
  const bounds = scope.active;

  // The expenses read-model reconciles on a "this" / "last" P&L period. Map the
  // scope's active range to it (a last-month preset → "last"; otherwise "this");
  // wider/custom ranges still resolve to the month-to-date period the server
  // scopes, so the totals stay P&L-reconciled rather than recomputed here.
  const expensePeriod: "this" | "last" =
    "preset" in range && range.preset === "last-month" ? "last" : "this";

  const liveActive = useQuery(api.expensesViews.overview, {
    ...(activeEntity.id ? { entityId: activeEntity.id as Id<"entities"> } : {}),
    period: expensePeriod,
  });
  // AP aging + DPO come from the bills read-model; ending cash (for runway) from
  // the transactions aggregate over the active window.
  const billsData = useQuery(
    api.moduleViews.overview,
    activeEntity.id ? { entityId: activeEntity.id as Id<"entities"> } : {},
  );
  const cashData = useQuery(api.coreViews.transactions, {
    ...(activeEntity.id ? { entityId: activeEntity.id as Id<"entities"> } : {}),
    from: bounds.from,
    to: bounds.to,
  });

  const [lastActive, setLastActive] = useState<typeof liveActive>(undefined);
  if (liveActive !== undefined && liveActive !== lastActive) setLastActive(liveActive);
  const data = liveActive ?? lastActive ?? undefined;

  if (data === undefined) {
    return <InsightsPanelSkeleton kpiCount={5} />;
  }
  if (!data.entity) {
    return (
      <EmptyState
        title="No expenses yet"
        description="Connect a bank or import activity to see spending insights for this business."
      />
    );
  }

  const currency = data.entity.currency;
  const k = data.kpis;
  const categories = data.categories;
  const vendors = data.vendors;

  // Top-category concentration: the leading category's share of period spend.
  const totalSpend = categories.reduce((sum, row) => sum + Math.max(0, row.totalMinor), 0);
  const topCategory = categories[0] ?? null;
  const topShare = topCategory && totalSpend > 0 ? Math.round((topCategory.totalMinor / totalSpend) * 100) : 0;

  // Burn = this period's spend; Runway = ending cash ÷ monthly burn (months of
  // cushion). A non-finite or zero burn yields no runway (calm "—").
  const burnMinor = k.spentMinor;
  const endingCashMinor = cashData?.insights?.endingCashMinor ?? null;
  const runwayMonths = endingCashMinor != null && burnMinor > 0 ? endingCashMinor / burnMinor : null;

  const kpis = (
    <InsightsKpiGrid columns={5}>
      <InsightsKpiCard
        label="Total spend"
        value={formatMinorMoney(k.spentMinor, { currency })}
        tone="neutral"
        detail={k.deltaPct === null ? "No prior-month baseline" : `${k.deltaPct > 0 ? "up" : "down"} ${Math.abs(k.deltaPct)}% vs. last month`}
      />
      <InsightsKpiCard
        label="Burn"
        value={formatMinorMoney(burnMinor, { currency })}
        tone="neutral"
        detail="Spend this period"
      />
      <InsightsKpiCard
        label="Runway"
        value={runwayMonths != null ? `${runwayMonths.toFixed(1)} mo` : "—"}
        tone={runwayMonths != null && runwayMonths < 3 ? "negative" : "neutral"}
        detail={endingCashMinor != null ? `${formatMinorMoney(endingCashMinor, { currency })} on hand ÷ burn` : "Connect a bank for cash on hand"}
        status={runwayMonths != null && runwayMonths < 3 ? { label: "Tight", tone: "warning" } : null}
      />
      <InsightsKpiCard
        label="Top-category share"
        value={topCategory ? `${topShare}%` : "—"}
        detail={topCategory ? topCategory.name : "No spend this period"}
        status={topShare >= 50 ? { label: "Concentrated", tone: "warning" } : null}
        onClick={topCategory ? () => setDrill({ title: topCategory.name, from: bounds.from, to: bounds.to }) : undefined}
      />
      <InsightsKpiCard
        label="Recurring"
        value={formatMinorMoney(k.recurringMonthlyMinor, { currency })}
        tone="neutral"
        detail={`${k.recurringSharePct}% of spend is predictable`}
      />
    </InsightsKpiGrid>
  );

  // Spend by category + top vendors (this period) — neutral money-out, never red.
  const categoryPoints: InsightsChartPoint[] = categories.slice(0, 8).map((row) => ({
    x: row.id,
    label: row.name.split(/\s+/)[0],
    drillKey: row.name,
    outMinor: row.totalMinor,
  }));
  const vendorPoints: InsightsChartPoint[] = vendors.slice(0, 8).map((row) => ({
    x: row.id,
    label: row.name.split(/\s+/)[0],
    drillKey: row.name,
    outMinor: row.totalMinor,
  }));

  // AP aging / DPO from the bills read-model — current calm, aged buckets carry
  // increasing concern (paired with the bucket label, never color alone).
  const allBills = billsData?.bills?.groups?.flatMap((group) => group.rows) ?? [];
  const openBills = allBills.filter((bill) => bill.status === "open");
  const apBucket = { current: 0, b30: 0, b60: 0, b90: 0 };
  for (const bill of openBills) {
    const overdueDays = -bill.daysUntilDue; // positive once past due
    if (overdueDays <= 0) apBucket.current += bill.totalMinor;
    else if (overdueDays <= 30) apBucket.b30 += bill.totalMinor;
    else if (overdueDays <= 60) apBucket.b60 += bill.totalMinor;
    else apBucket.b90 += bill.totalMinor;
  }
  const apTotal = apBucket.current + apBucket.b30 + apBucket.b60 + apBucket.b90;
  const billsKpis = billsData?.bills?.kpis;
  const dpo = billsKpis && "avgDaysToPay" in billsKpis ? billsKpis.avgDaysToPay : 0;
  const apAgingPoints: InsightsChartPoint[] = [
    { x: "current", label: "Current", outMinor: apBucket.current },
    { x: "30", label: "1–30", outMinor: apBucket.b30 },
    { x: "60", label: "31–60", outMinor: apBucket.b60 },
    { x: "90", label: "61–90", outMinor: apBucket.b90 },
  ];

  const charts = (
    <>
      <InsightsChartCard title="Spend by category · this period">
        {categoryPoints.length < 1 ? (
          <InsightsWidgetState kind="empty" minHeight={200} />
        ) : (
          <InsightsChart
            data={categoryPoints}
            currency={currency}
            height={200}
            series={[{ key: "outMinor", label: "Spend", color: COLOR_OUT, type: "bar" }]}
          />
        )}
      </InsightsChartCard>
      <InsightsChartCard title="Top vendors · this period">
        {vendorPoints.length < 1 ? (
          <InsightsWidgetState kind="empty" minHeight={200} />
        ) : (
          <InsightsChart
            data={vendorPoints}
            currency={currency}
            height={200}
            series={[{ key: "outMinor", label: "Spend", color: COLOR_OUT, type: "bar" }]}
          />
        )}
      </InsightsChartCard>
      <InsightsChartCard title={`Bills owed by age · DPO ${dpo}d`}>
        {apTotal === 0 ? (
          <InsightsWidgetState kind="empty" minHeight={180} />
        ) : (
          <InsightsChart
            data={apAgingPoints}
            currency={currency}
            height={180}
            series={[{ key: "outMinor", label: "Owed", color: COLOR_OUT, type: "bar" }]}
          />
        )}
      </InsightsChartCard>
    </>
  );

  // Spend-by-category drill chips alongside the model's findings.
  const topCategories = categories.filter((row) => row.totalMinor > 0).slice(0, 3);
  const mapFinding = (finding: { title: string; detail: string; tone: AiObservation["tone"] }): AiObservation => {
    const haystack = `${finding.title} ${finding.detail}`;
    const mentioned = categories.filter((row) => row.totalMinor > 0 && haystack.includes(row.name));
    const entities = mentioned.slice(0, 2).map((row) => ({
      label: row.name,
      target: { title: row.name, from: bounds.from, to: bounds.to },
    }));
    return {
      text: finding.detail || finding.title,
      tone: finding.tone,
      ...(entities.length > 0 ? { entities } : {}),
      why: "Surfaced from this period's posted expenses.",
    };
  };

  const observations = (
    <div className="flex flex-col gap-4">
      {topCategories.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-[14px] p-4 shadow-xs ring-1 ring-foreground/10">
          <h3 className="text-sm font-semibold">Top categories</h3>
          <p className="text-sm leading-snug">
            <span className="money-figures font-medium">{topCategories[0].name}</span> was the biggest cost this period
            {" — "}
            <span className="money-figures">{formatMinorMoney(topCategories[0].totalMinor, { currency })}</span>.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {topCategories.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setDrill({ title: row.name, from: bounds.from, to: bounds.to })}
                className="inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium transition-colors hover:bg-accent"
                data-testid={row.source === "payroll" ? "expenses-payroll-chip" : "expenses-category-chip"}
              >
                <span className="max-w-[9rem] truncate">{row.name}</span>
                {row.source === "payroll" ? (
                  <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">Payroll</span>
                ) : null}
                <span className="money-figures text-muted-foreground">{formatMinorMoney(row.totalMinor, { currency, compact: true })}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Click a category to see the underlying transactions.</p>
        </section>
      ) : null}
      <AiObservationColumn
        section="expenses"
        entityId={activeEntity.id}
        from={bounds.from}
        to={bounds.to}
        onDrill={setDrill}
        mapFinding={mapFinding}
      />
    </div>
  );

  return (
    <>
      <InsightsPanel
        range={range}
        onRangeChange={setRange}
        compareMode={compareMode}
        onCompareModeChange={setCompareMode}
        todayISO={todayISO}
        kpis={kpis}
        charts={charts}
        observations={observations}
      />
      <TransactionsDrillDrawer
        target={drill}
        entityId={activeEntity.id}
        onOpenChange={(open) => {
          if (!open) setDrill(null);
        }}
      />
    </>
  );
}

/**
 * The Contacts Insights sub-tab (E4.5) — built on the SAME E1 components as the
 * other sections so Contacts feels like one product. KPIs: Contacts, AR
 * outstanding, AP outstanding (separate, never netted), top-customer
 * concentration (20% guardrail), dormant/at-risk count. Charts: two-sided bars
 * (top customers in green / top vendors neutral). AI observations come from the
 * shared `contacts` aiInsights path.
 */
function ContactsInsights() {
  const { activeEntity } = useActiveEntity();
  const todayISO = useTodayIso();
  const [range, setRange] = useState<DateRangeValue>({ preset: "ytd" });
  const [compareMode, setCompareMode] = useState<CompareMode>("none");
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  const scope = useMemo(() => resolveScope(range, compareMode, todayISO), [range, compareMode, todayISO]);
  const dormantCutoff = useMemo(() => isoDaysAgo(todayISO, DORMANT_WINDOW_DAYS), [todayISO]);
  const bounds = scope.active;

  const data = useQuery(
    api.moduleViews.overview,
    activeEntity.id ? { entityId: activeEntity.id as Id<"entities"> } : {},
  );

  if (data === undefined) {
    return <InsightsPanelSkeleton kpiCount={5} />;
  }
  if (!data.entity) {
    return (
      <EmptyState
        title="No contacts yet"
        description="Most contacts are created automatically as money moves. Connect a bank or add one by hand to see relationship insights."
      />
    );
  }

  const currency = data.entity.currency;
  const active = data.contacts.rows.filter((row) => !row.archived);
  // `kpis` only exists on the entity-present branch of the union (guarded above).
  const kSource = "kpis" in data.contacts ? data.contacts.kpis : undefined;
  const k = {
    contactsCount: kSource?.contactsCount ?? 0,
    openReceivableMinor: kSource?.openReceivableMinor ?? 0,
    openPayableMinor: kSource?.openPayableMinor ?? 0,
    overdueReceivableCount: kSource?.overdueReceivableCount ?? 0,
  };

  // Concentration: leading customer's share of YTD money-in (Pareto / 20% guard).
  const customers = active.filter((row) => row.moneyInYtdMinor > 0).sort((a, b) => b.moneyInYtdMinor - a.moneyInYtdMinor);
  const vendors = active.filter((row) => row.moneyOutYtdMinor > 0).sort((a, b) => b.moneyOutYtdMinor - a.moneyOutYtdMinor);
  const totalIn = customers.reduce((sum, row) => sum + row.moneyInYtdMinor, 0);
  const topCustomer = customers[0] ?? null;
  const topShare = topCustomer && totalIn > 0 ? Math.round((topCustomer.moneyInYtdMinor / totalIn) * 100) : 0;
  // Dormant / at-risk: no activity in ~90 days OR overdue receivables.
  const atRisk = active.filter((row) => row.overdueReceivableMinor > 0 || isDormant(row.lastActivityDate, dormantCutoff));

  const kpis = (
    <InsightsKpiGrid columns={5}>
      <InsightsKpiCard label="Contacts" value={String(k.contactsCount)} detail="Customers and vendors" />
      <InsightsKpiCard
        label="They owe you"
        value={formatMinorMoney(k.openReceivableMinor, { currency })}
        tone={k.overdueReceivableCount > 0 ? "negative" : "neutral"}
        detail={k.overdueReceivableCount > 0 ? `${k.overdueReceivableCount} customers past due` : "Open receivables"}
        status={k.overdueReceivableCount > 0 ? { label: "Overdue", tone: "warning" } : { label: "On track", tone: "good" }}
      />
      <InsightsKpiCard label="You owe them" value={formatMinorMoney(k.openPayableMinor, { currency })} tone="neutral" detail="Open payables to vendors" />
      <InsightsKpiCard
        label="Top-customer share"
        value={topCustomer ? `${topShare}%` : "—"}
        detail={topCustomer ? topCustomer.name : "No revenue this year"}
        status={topShare >= 20 ? { label: "Concentrated", tone: "warning" } : null}
        onClick={topCustomer ? () => setDrill({ title: topCustomer.name, from: bounds.from, to: bounds.to, counterparty: topCustomer.name }) : undefined}
      />
      <InsightsKpiCard
        label="At-risk contacts"
        value={String(atRisk.length)}
        detail={atRisk.length > 0 ? "Overdue or dormant" : "All relationships healthy"}
        status={atRisk.length > 0 ? { label: "Review", tone: "warning" } : { label: "Healthy", tone: "good" }}
      />
    </InsightsKpiGrid>
  );

  const customerPoints: InsightsChartPoint[] = customers.slice(0, 8).map((row) => ({
    x: row.id,
    label: row.name.split(/\s+/)[0],
    drillKey: row.name,
    inMinor: row.moneyInYtdMinor,
  }));
  const vendorPoints: InsightsChartPoint[] = vendors.slice(0, 8).map((row) => ({
    x: row.id,
    label: row.name.split(/\s+/)[0],
    drillKey: row.name,
    outMinor: row.moneyOutYtdMinor,
  }));

  const charts = (
    <>
      <InsightsChartCard title="Top customers · YTD">
        {customerPoints.length < 1 ? (
          <InsightsWidgetState kind="empty" minHeight={200} />
        ) : (
          <InsightsChart
            data={customerPoints}
            currency={currency}
            height={200}
            series={[{ key: "inMinor", label: "Money in", color: COLOR_IN, type: "bar" }]}
            onDrill={(point) => point.drillKey && setDrill({ title: point.drillKey, from: bounds.from, to: bounds.to, counterparty: point.drillKey })}
          />
        )}
      </InsightsChartCard>
      <InsightsChartCard title="Top vendors · YTD">
        {vendorPoints.length < 1 ? (
          <InsightsWidgetState kind="empty" minHeight={200} />
        ) : (
          <InsightsChart
            data={vendorPoints}
            currency={currency}
            height={200}
            series={[{ key: "outMinor", label: "Money out", color: COLOR_OUT, type: "bar" }]}
            onDrill={(point) => point.drillKey && setDrill({ title: point.drillKey, from: bounds.from, to: bounds.to, counterparty: point.drillKey })}
          />
        )}
      </InsightsChartCard>
    </>
  );

  const mapFinding = (finding: { title: string; detail: string; tone: AiObservation["tone"] }): AiObservation => {
    const haystack = `${finding.title} ${finding.detail}`;
    const mentioned = active.filter((row) => haystack.includes(row.name));
    const entities = mentioned.slice(0, 2).map((row) => ({
      label: row.name,
      target: { title: row.name, from: bounds.from, to: bounds.to, counterparty: row.name },
    }));
    return {
      text: finding.detail || finding.title,
      tone: finding.tone,
      ...(entities.length > 0 ? { entities } : {}),
      why: "Surfaced from this business's receivables, payables, and contact activity.",
    };
  };

  const observations = (
    <div className="flex flex-col gap-4">
      {topCustomer ? (
        <section className="flex flex-col gap-2 rounded-[14px] p-4 shadow-xs ring-1 ring-foreground/10">
          <h3 className="text-sm font-semibold">Concentration</h3>
          <p className="text-sm leading-snug">
            <span className="money-figures font-medium">{topCustomer.name}</span> is{" "}
            <span className="money-figures">{topShare}%</span> of money in this year
            {topShare >= 20 ? " — above the 20% guardrail." : "."}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {customers.slice(0, 3).map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setDrill({ title: row.name, from: bounds.from, to: bounds.to, counterparty: row.name })}
                className="inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium transition-colors hover:bg-accent"
                data-testid="contacts-customer-chip"
              >
                <span className="max-w-[9rem] truncate">{row.name}</span>
                <span className="money-figures text-muted-foreground">{formatMinorMoney(row.moneyInYtdMinor, { currency, compact: true })}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Click a name to see the underlying transactions.</p>
        </section>
      ) : null}
      <AiObservationColumn
        section="contacts"
        entityId={activeEntity.id}
        from={bounds.from}
        to={bounds.to}
        onDrill={setDrill}
        mapFinding={mapFinding}
      />
    </div>
  );

  return (
    <>
      <InsightsPanel
        range={range}
        onRangeChange={setRange}
        compareMode={compareMode}
        onCompareModeChange={setCompareMode}
        todayISO={todayISO}
        kpis={kpis}
        charts={charts}
        observations={observations}
      />
      <TransactionsDrillDrawer
        target={drill}
        entityId={activeEntity.id}
        onOpenChange={(open) => {
          if (!open) setDrill(null);
        }}
      />
    </>
  );
}

/**
 * Payroll Insights — the analytics-only home for payroll totals, run history,
 * currency exposure, and bank-match readiness. Operational subpages stay clean:
 * Runs / People / Statements are sidebar child pages; this is where summary
 * cards belong.
 */
function PayrollInsights() {
  const { activeEntity } = useActiveEntity();
  const todayISO = useTodayIso();
  const [range, setRange] = useState<DateRangeValue>({ preset: "last-3-months" });
  const [compareMode, setCompareMode] = useState<CompareMode>("none");
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  const scope = useMemo(() => resolveScope(range, compareMode, todayISO), [range, compareMode, todayISO]);
  const bounds = scope.active;

  const data = useQuery(
    api.moduleViews.overview,
    activeEntity.id ? { entityId: activeEntity.id as Id<"entities"> } : {},
  );

  if (data === undefined) {
    return <InsightsPanelSkeleton kpiCount={5} />;
  }
  if (!data.entity) {
    return (
      <EmptyState
        title="No payroll yet"
        description="Add employees or draft a payroll run to see payroll insights for this business."
      />
    );
  }

  const currency = data.entity.currency;
  const payroll = data.payroll;
  const activeEmployees = payroll.employees.filter((employee) => employee.active);
  const currencyTotals = payroll.currencyTotals.filter((row) => row.baseMinor > 0 || row.localMinor > 0);
  const monthlyBaseMinor = currencyTotals.reduce((sum, row) => sum + row.baseMinor, 0);
  const latestRun = payroll.runs[0] ?? null;
  const runSparkline = payroll.runs.slice(0, 8).reverse().map((run) => run.totalBaseMinor);
  const unmatchedCount = payroll.unmatchedCount;

  const latestRunStatus =
    latestRun == null
      ? null
      : latestRun.unmatchedCount > 0
        ? { label: "Needs match", tone: "warning" as const }
        : latestRun.status === "paid"
          ? { label: "Paid", tone: "good" as const }
          : latestRun.status === "approved"
            ? { label: "Approved", tone: "neutral" as const }
            : { label: "Draft", tone: "neutral" as const };

  const kpis = (
    <InsightsKpiGrid columns={5}>
      <InsightsKpiCard
        label="Monthly payroll"
        value={formatMinorMoney(monthlyBaseMinor, { currency })}
        tone="neutral"
        detail={`${activeEmployees.length} active ${activeEmployees.length === 1 ? "person" : "people"}`}
        sparkline={runSparkline.length > 1 ? runSparkline : undefined}
      />
      <InsightsKpiCard
        label="Latest run"
        value={latestRun ? formatMinorMoney(latestRun.totalBaseMinor, { currency }) : "—"}
        tone="neutral"
        detail={latestRun ? `${payrollPeriodLabel(latestRun.period)} · ${titleCaseStatus(latestRun.status)}` : "No payroll runs yet"}
        status={latestRunStatus}
      />
      <InsightsKpiCard
        label="Headcount"
        value={String(latestRun?.headcount ?? activeEmployees.length)}
        detail={latestRun ? "Latest run headcount" : "Active roster"}
      />
      <InsightsKpiCard
        label="Currencies"
        value={String(currencyTotals.length)}
        detail={currencyTotals.length > 0 ? currencyTotals.map((row) => row.currency).join(", ") : "No payroll currencies yet"}
      />
      <InsightsKpiCard
        label="Unmatched"
        value={String(unmatchedCount)}
        detail={unmatchedCount > 0 ? "Approved lines awaiting bank match" : "No approved pay lines waiting"}
        status={unmatchedCount > 0 ? { label: "Review", tone: "warning" } : { label: "Clear", tone: "good" }}
      />
    </InsightsKpiGrid>
  );

  const runPoints: InsightsChartPoint[] = payroll.runs.slice(0, 8).reverse().map((run) => ({
    x: run.period,
    label: payrollPeriodLabel(run.period),
    drillKey: run.period,
    outMinor: run.totalBaseMinor,
  }));
  const currencyPoints: InsightsChartPoint[] = currencyTotals.map((row) => ({
    x: row.currency,
    label: row.currency,
    outMinor: row.baseMinor,
  }));
  const employeePoints: InsightsChartPoint[] = payroll.statementRows
    .filter((row) => row.baseMinor > 0)
    .sort((a, b) => b.baseMinor - a.baseMinor)
    .slice(0, 8)
    .map((row) => ({
      x: `${row.employeeName}-${row.currency}`,
      label: row.employeeName.split(/\s+/)[0],
      drillKey: row.employeeName,
      outMinor: row.baseMinor,
    }));

  const charts = (
    <>
      <InsightsChartCard title="Payroll by run · base currency">
        {runPoints.length < 1 ? (
          <InsightsWidgetState kind="empty" minHeight={200} />
        ) : (
          <InsightsChart
            data={runPoints}
            currency={currency}
            height={200}
            series={[{ key: "outMinor", label: "Payroll", color: COLOR_OUT, type: "line" }]}
          />
        )}
      </InsightsChartCard>
      <InsightsChartCard title="Payroll by currency · monthly roster">
        {currencyPoints.length < 1 ? (
          <InsightsWidgetState kind="empty" minHeight={180} />
        ) : (
          <InsightsChart
            data={currencyPoints}
            currency={currency}
            height={180}
            series={[{ key: "outMinor", label: "Base equivalent", color: COLOR_OUT, type: "bar" }]}
          />
        )}
      </InsightsChartCard>
      <InsightsChartCard title="Payroll by person · base currency">
        {employeePoints.length < 1 ? (
          <InsightsWidgetState kind="empty" minHeight={200} />
        ) : (
          <InsightsChart
            data={employeePoints}
            currency={currency}
            height={200}
            series={[{ key: "outMinor", label: "Monthly payroll", color: COLOR_OUT, type: "bar" }]}
          />
        )}
      </InsightsChartCard>
    </>
  );

  const topCurrency = currencyTotals.slice().sort((a, b) => b.baseMinor - a.baseMinor)[0] ?? null;
  const topEmployee = payroll.statementRows
    .filter((row) => row.baseMinor > 0)
    .sort((a, b) => b.baseMinor - a.baseMinor)[0] ?? null;
  const mapFinding = (finding: { title: string; detail: string; tone: AiObservation["tone"] }): AiObservation => ({
    text: finding.detail || finding.title,
    tone: finding.tone,
    why: "Surfaced from payroll runs, employee roster, currency totals, and bank-match status.",
  });

  const observations = (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2 rounded-[14px] p-4 shadow-xs ring-1 ring-foreground/10">
        <h3 className="text-sm font-semibold">Payroll readiness</h3>
        <p className="text-sm leading-snug">
          {latestRun ? (
            <>
              <span className="money-figures font-medium">{payrollPeriodLabel(latestRun.period)}</span> is{" "}
              <span className="money-figures">{titleCaseStatus(latestRun.status)}</span>
              {latestRun.unmatchedCount > 0 ? ` with ${latestRun.unmatchedCount} pay lines still awaiting a bank match.` : "."}
            </>
          ) : (
            "No payroll run has been drafted yet. Add people, then draft the first run from Payroll."
          )}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {topCurrency ? (
            <span className="inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium">
              <span>{topCurrency.currency}</span>
              <span className="money-figures text-muted-foreground">
                {formatMinorMoney(topCurrency.baseMinor, { currency, compact: true })}
              </span>
            </span>
          ) : null}
          {topEmployee ? (
            <span className="inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium">
              <span className="max-w-[9rem] truncate">{topEmployee.employeeName}</span>
              <span className="money-figures text-muted-foreground">
                {formatMinorMoney(topEmployee.baseMinor, { currency, compact: true })}
              </span>
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Payroll insights read the roster, run snapshots, FX equivalents, and approved-line matching state.
        </p>
      </section>
      <AiObservationColumn
        section="payroll"
        entityId={activeEntity.id}
        from={bounds.from}
        to={bounds.to}
        onDrill={setDrill}
        mapFinding={mapFinding}
      />
    </div>
  );

  return (
    <>
      <InsightsPanel
        range={range}
        onRangeChange={setRange}
        compareMode={compareMode}
        onCompareModeChange={setCompareMode}
        todayISO={todayISO}
        kpis={kpis}
        charts={charts}
        observations={observations}
      />
      <TransactionsDrillDrawer
        target={drill}
        entityId={activeEntity.id}
        onOpenChange={(open) => {
          if (!open) setDrill(null);
        }}
      />
    </>
  );
}

/**
 * Dormant = no activity since the cutoff (~90 days before the live `today`
 * anchor, derived via {@link isoDaysAgo} from {@link useTodayIso}).
 */
function isDormant(lastActivityDate: string | null, cutoffISO: string) {
  if (!lastActivityDate) return true;
  return lastActivityDate < cutoffISO;
}
