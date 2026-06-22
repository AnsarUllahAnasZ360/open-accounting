"use client";

// Dashboard data-visualisation kit. Recharts (via shadcn's Chart wrapper) powers
// the charts that earn interactivity — cash trend, cash-flow in/out, the expense
// donut, the P&L mini-trend — while the small "data-chips" (aging bar, customer
// bars, runway segments) stay as lightweight markup where a charting library
// would only add weight. Everything reads from the design tokens: one brand
// green, muted neutrals for expenses, tabular money.

import { TrendingDown, TrendingUp } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart, XAxis } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

import { formatMinorMoney } from "../primitives";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "YYYY-MM" -> "Jun". Falls back to the raw key if it isn't a month string.
export function shortMonth(monthKey: string) {
  const month = Number(monthKey.slice(5, 7));
  return MONTHS[month - 1] ?? monthKey;
}

// Expenses are not money-in, so the donut deliberately avoids brand green:
// teal/slate/amber/sand/grey — distinct but quiet, never a rainbow.
const EXPENSE_PALETTE = ["#0e9384", "#475467", "#f79009", "#a8a29e", "#cbd2d9"];
const OUT_COLOR = "#cbd2d9";

// Shared tooltip: a series-colour dot, the label, and tabular money. A named
// component (not a render-prop factory) so it keeps a display name and reads
// cleanly. Recharts injects active/payload/label when used as `content`.
function MoneyTooltip({
  active,
  payload,
  label,
  currency,
  labels = {},
  hideLabel = false,
}: {
  active?: boolean;
  payload?: Array<{
    value?: number | string;
    name?: number | string;
    dataKey?: number | string;
    color?: string;
    payload?: { fill?: string };
  }>;
  label?: number | string;
  currency: string;
  labels?: Record<string, string>;
  hideLabel?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="grid min-w-32 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      {!hideLabel && label != null ? <div className="font-medium">{String(label)}</div> : null}
      <div className="grid gap-1.5">
        {payload.map((item, index) => {
          const key = String(item.dataKey ?? item.name ?? index);
          return (
            <div key={key} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 rounded-[2px]" style={{ background: item.color ?? item.payload?.fill }} />
                {labels[key] ?? String(item.name ?? "")}
              </span>
              <span className="font-mono tabular-nums text-foreground">
                {formatMinorMoney(Number(item.value), { currency })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month-over-month delta pill
// ---------------------------------------------------------------------------

export function Delta({
  current,
  previous,
  className,
}: {
  current: number;
  previous: number;
  className?: string;
}) {
  if (!previous) return null;
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
  if (pct === 0) return null;
  const up = pct > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        up ? "text-ob-green-600" : "text-negative",
        className,
      )}
    >
      <Icon className="size-3" />
      {Math.abs(pct)}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// Cash trend (hero) — cumulative cash flow as a calm green area
// ---------------------------------------------------------------------------

export function CashTrendChart({
  data,
  currency,
  className,
}: {
  data: Array<{ label: string; value: number }>;
  currency: string;
  className?: string;
}) {
  const config = { value: { label: "Cash", color: "var(--ob-green-500)" } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className={cn("aspect-auto h-20 w-full", className)}>
      <AreaChart data={data} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
        <XAxis dataKey="label" hide />
        <ChartTooltip cursor={false} content={<MoneyTooltip currency={currency} labels={{ value: "Cash" }} />} />
        <Area
          dataKey="value"
          type="monotone"
          stroke="var(--color-value)"
          strokeWidth={2}
          fill="var(--color-value)"
          fillOpacity={0.08}
          dot={false}
          activeDot={{ r: 3 }}
        />
      </AreaChart>
    </ChartContainer>
  );
}

// ---------------------------------------------------------------------------
// P&L mini-trend — income vs expense, compact
// ---------------------------------------------------------------------------

export function PnlTrendChart({
  data,
  currency,
}: {
  data: Array<{ month: string; incomeMinor: number; expenseMinor: number }>;
  currency: string;
}) {
  const config = {
    incomeMinor: { label: "Income", color: "var(--ob-green-500)" },
    expenseMinor: { label: "Expenses", color: OUT_COLOR },
  } satisfies ChartConfig;
  const rows = data.map((row) => ({ ...row, label: shortMonth(row.month) }));
  return (
    <ChartContainer config={config} className="aspect-auto h-16 w-full">
      <BarChart data={rows} margin={{ top: 2, right: 0, bottom: 0, left: 0 }} barGap={2}>
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} />
        <ChartTooltip
          cursor={false}
          content={<MoneyTooltip currency={currency} labels={{ incomeMinor: "Income", expenseMinor: "Expenses" }} />}
        />
        <Bar dataKey="incomeMinor" fill="var(--color-incomeMinor)" radius={2} maxBarSize={9} />
        <Bar dataKey="expenseMinor" fill="var(--color-expenseMinor)" radius={2} maxBarSize={9} />
      </BarChart>
    </ChartContainer>
  );
}

// ---------------------------------------------------------------------------
// Expense donut — where money went, top categories
// ---------------------------------------------------------------------------

export function ExpenseDonut({
  data,
  currency,
}: {
  data: Array<{ name: string; amountMinor: number }>;
  currency: string;
}) {
  const total = data.reduce((sum, slice) => sum + slice.amountMinor, 0);
  const config: ChartConfig = Object.fromEntries(
    data.map((slice, index) => [slice.name, { label: slice.name, color: EXPENSE_PALETTE[index % EXPENSE_PALETTE.length] }]),
  );
  return (
    <div className="flex items-center gap-4">
      <div className="relative size-[112px] shrink-0">
        <ChartContainer config={config} className="aspect-square size-[112px]">
          <PieChart>
            <ChartTooltip cursor={false} content={<MoneyTooltip currency={currency} hideLabel />} />
            <Pie data={data} dataKey="amountMinor" nameKey="name" innerRadius={34} outerRadius={52} strokeWidth={2} paddingAngle={2}>
              {data.map((slice, index) => (
                <Cell key={slice.name} fill={EXPENSE_PALETTE[index % EXPENSE_PALETTE.length]} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="money-figures text-sm font-semibold">{formatMinorMoney(total, { currency, compact: true })}</span>
          <span className="text-[10px] text-muted-foreground">spent</span>
        </div>
      </div>
      <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
        {data.map((slice, index) => (
          <li key={slice.name} className="flex items-center gap-2 text-xs">
            <span className="size-2 shrink-0 rounded-[3px]" style={{ background: EXPENSE_PALETTE[index % EXPENSE_PALETTE.length] }} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{slice.name}</span>
            <span className="money-figures font-medium">{formatMinorMoney(slice.amountMinor, { currency, compact: true })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cash flow — money in vs money out by month
// ---------------------------------------------------------------------------

export function CashFlowChart({
  data,
  currency,
}: {
  data: Array<{ month: string; inflowMinor: number; outflowMinor: number }>;
  currency: string;
}) {
  const config = {
    inflowMinor: { label: "Money in", color: "var(--ob-green-500)" },
    outflowMinor: { label: "Money out", color: OUT_COLOR },
  } satisfies ChartConfig;
  const rows = data.map((row) => ({ ...row, label: shortMonth(row.month) }));
  return (
    <ChartContainer config={config} className="aspect-auto h-[150px] w-full">
      <BarChart data={rows} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barGap={3}>
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip
          cursor={false}
          content={<MoneyTooltip currency={currency} labels={{ inflowMinor: "Money in", outflowMinor: "Money out" }} />}
        />
        <Bar dataKey="inflowMinor" fill="var(--color-inflowMinor)" radius={[3, 3, 0, 0]} maxBarSize={14} />
        <Bar dataKey="outflowMinor" fill="var(--color-outflowMinor)" radius={[3, 3, 0, 0]} maxBarSize={14} />
      </BarChart>
    </ChartContainer>
  );
}

// ---------------------------------------------------------------------------
// Payroll trend — last three monthly runs in base currency
// ---------------------------------------------------------------------------

export function PayrollTrendChart({
  data,
  currency,
}: {
  data: Array<{ period: string; totalBaseMinor: number }>;
  currency: string;
}) {
  const config = {
    totalBaseMinor: { label: "Payroll", color: "var(--chart-4)" },
  } satisfies ChartConfig;
  const rows = data.map((row) => ({ ...row, label: shortMonth(row.period) }));
  return (
    <ChartContainer config={config} className="aspect-auto h-20 w-full">
      <BarChart data={rows} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} />
        <ChartTooltip cursor={false} content={<MoneyTooltip currency={currency} labels={{ totalBaseMinor: "Payroll" }} />} />
        <Bar dataKey="totalBaseMinor" fill="var(--color-totalBaseMinor)" radius={[3, 3, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ChartContainer>
  );
}

// ---------------------------------------------------------------------------
// A/R aging — a single segmented bar (0–30 / 31–60 / 61–90 / 90+)
// ---------------------------------------------------------------------------

const AGING_COLORS = ["#92cc7a", "#f7c54c", "#f79009", "#d92d20"];
const AGING_LABELS = ["0–30", "31–60", "61–90", "90+"];

export function AgingBar({
  buckets,
}: {
  buckets: { currentMinor: number; days30Minor: number; days60Minor: number; days90Minor: number };
}) {
  const values = [buckets.currentMinor, buckets.days30Minor, buckets.days60Minor, buckets.days90Minor];
  const total = Math.max(values.reduce((sum, value) => sum + value, 0), 1);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        {values.map((value, index) => (
          <span
            key={AGING_LABELS[index]}
            className="first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${Math.max(value > 0 ? 3 : 0, (value / total) * 100)}%`,
              background: value > 0 ? AGING_COLORS[index] : "transparent",
            }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        {AGING_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Income by customer — horizontal bars, green fading by rank
// ---------------------------------------------------------------------------

export function CustomerBars({
  data,
  currency,
}: {
  data: Array<{ name: string; amountMinor: number }>;
  currency: string;
}) {
  const max = Math.max(...data.map((row) => row.amountMinor), 1);
  return (
    <div className="flex flex-col gap-2.5">
      {data.map((row, index) => (
        <div key={`${row.name}-${index}`} className="flex items-center gap-3">
          <span className="w-28 min-w-28 truncate text-xs">{row.name}</span>
          <div className="h-3.5 flex-1 overflow-hidden rounded bg-muted">
            <div
              className="h-full rounded bg-primary"
              style={{ width: `${Math.max(2, (row.amountMinor / max) * 100)}%`, opacity: 1 - index * 0.13 }}
            />
          </div>
          <span className="money-figures w-16 shrink-0 text-right text-xs font-medium">
            {formatMinorMoney(row.amountMinor, { currency, compact: true })}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revenue by stream (E9-T8) — owner-facing stream rollup over income accounts.
// Horizontal bars (size = period total) + a quiet 6-month trailing sparkline per
// stream. Reconciles to the period P&L revenue by construction (backend), so the
// owner sees exactly how this period's revenue splits across their streams.
// ---------------------------------------------------------------------------

export function RevenueStreamBars({
  data,
  currency,
}: {
  data: Array<{
    stream: string;
    totalMinor: number;
    trend: Array<{ month: string; amountMinor: number }>;
  }>;
  currency: string;
}) {
  const total = data.reduce((sum, row) => sum + row.totalMinor, 0);
  const max = Math.max(...data.map((row) => row.totalMinor), 1);
  return (
    <div className="flex flex-col gap-3">
      {data.map((row, index) => {
        const sharePct = total > 0 ? Math.round((row.totalMinor / total) * 100) : 0;
        const trendMax = Math.max(...row.trend.map((point) => point.amountMinor), 1);
        return (
          <div key={`${row.stream}-${index}`} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate font-medium">{row.stream}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-muted-foreground">{sharePct}%</span>
                <span className="money-figures font-semibold">
                  {formatMinorMoney(row.totalMinor, { currency, compact: true })}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 flex-1 overflow-hidden rounded bg-muted">
                <div
                  className="h-full rounded bg-primary"
                  style={{ width: `${Math.max(2, (row.totalMinor / max) * 100)}%`, opacity: 1 - index * 0.12 }}
                />
              </div>
              {/* Tiny trailing sparkline (last 6 months) — quiet, no library. */}
              <div className="flex h-3.5 shrink-0 items-end gap-px" aria-hidden>
                {row.trend.map((point) => (
                  <span
                    key={point.month}
                    className="w-1 rounded-sm bg-ob-green-300"
                    style={{ height: `${Math.max(8, (point.amountMinor / trendMax) * 100)}%` }}
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cash cushion — runway segments (whole / partial / empty months)
// ---------------------------------------------------------------------------

export function RunwaySegments({ months, target = 6 }: { months: number; target?: number }) {
  return (
    <div className="flex h-2 gap-0.5">
      {Array.from({ length: target }, (_, index) => {
        const filled = index + 1 <= months;
        const partial = !filled && index < months;
        return (
          <span
            key={index}
            className={cn(
              "h-full flex-1 rounded-full",
              filled ? "bg-primary" : partial ? "bg-ob-green-300" : "bg-muted",
            )}
          />
        );
      })}
    </div>
  );
}
