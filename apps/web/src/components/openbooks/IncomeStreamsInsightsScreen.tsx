"use client";

import { useQuery } from "convex/react";
import { AlertTriangle } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Amount, EmptyState } from "@/components/openbooks/primitives";
import { useActiveEntity } from "@/lib/openbooks/active-entity";
import { cn } from "@/lib/utils";

type Period = "month" | "quarter" | "year";

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function periodRange(period: Period): { startDate: string; endDate: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (period === "year") {
    return { startDate: `${y}-01-01`, endDate: `${y}-12-31` };
  }
  if (period === "quarter") {
    const qStart = Math.floor(m / 3) * 3;
    return { startDate: isoDate(new Date(Date.UTC(y, qStart, 1))), endDate: isoDate(new Date(Date.UTC(y, qStart + 3, 0))) };
  }
  return { startDate: isoDate(new Date(Date.UTC(y, m, 1))), endDate: isoDate(new Date(Date.UTC(y, m + 1, 0))) };
}

export function IncomeStreamsInsightsScreen() {
  const { activeEntity } = useActiveEntity();
  const entityId = activeEntity.id as Id<"entities"> | undefined;
  const [period, setPeriod] = useState<Period>("month");
  const range = useMemo(() => periodRange(period), [period]);
  const data = useQuery(api.streamViews.streamPnl, entityId ? { entityId, startDate: range.startDate, endDate: range.endDate } : "skip");

  if (!entityId) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          title="Pick a business"
          description="Revenue streams are per-business. Choose a single business from the switcher to view its streams."
        />
      </div>
    );
  }

  if (data === undefined) {
    return <Card><p className="text-sm text-muted-foreground">Loading stream insights…</p></Card>;
  }

  const totalRevenue = data.totals.revenueMinor;
  const totalCost = data.totals.directCostMinor + data.unallocatedCostMinor;
  const netIncome = data.totals.netIncomeMinor;
  const marginPct = totalRevenue > 0 ? Math.round((netIncome / totalRevenue) * 100) : null;
  const maxRevenue = Math.max(1, ...data.streams.map((s) => Math.abs(s.revenueMinor)));
  const byRevenue = [...data.streams].sort((a, b) => b.revenueMinor - a.revenueMinor);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PeriodPicker period={period} onChange={setPeriod} />
        {data.untaggedRevenueMinor > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-surface px-2.5 py-1 text-[12px] font-medium text-warning">
            <AlertTriangle className="size-3.5" />
            <Amount amountMinor={data.untaggedRevenueMinor} /> revenue untagged
          </span>
        ) : null}
      </div>

      {/* KPI tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Revenue"><Amount amountMinor={totalRevenue} tone="income" /></Kpi>
        <Kpi label="Costs"><Amount amountMinor={totalCost} /></Kpi>
        <Kpi label="Net income">
          <Amount amountMinor={netIncome} tone={netIncome >= 0 ? "income" : undefined} className={cn(netIncome < 0 && "text-negative")} />
        </Kpi>
        <Kpi label="Margin">{marginPct === null ? "—" : `${marginPct}%`}</Kpi>
      </div>

      {data.streams.length === 0 ? (
        <EmptyState
          title="No stream activity in this period"
          description="Tag transactions, invoices, or bills to a revenue stream to see income and profit by stream here."
        />
      ) : (
        <>
          {/* Income by stream — bar chart */}
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Income by stream</h2>
            <div className="flex flex-col gap-2.5">
              {byRevenue.map((s) => {
                const w = Math.round((Math.abs(s.revenueMinor) / maxRevenue) * 100);
                const share = totalRevenue > 0 ? Math.round((s.revenueMinor / totalRevenue) * 100) : 0;
                return (
                  <div key={s.stream} className="grid gap-1" data-testid="insights-income-row">
                    <div className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="truncate font-medium">{s.stream}</span>
                      <span className="flex items-center gap-2 whitespace-nowrap money-figures">
                        <Amount amountMinor={s.revenueMinor} tone="income" className="font-semibold" />
                        <span className="text-[11.5px] text-muted-foreground">{share}%</span>
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-ob-green-600" style={{ width: `${w}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Profit by stream — full table */}
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Profit by stream</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 text-left font-medium">Stream</th>
                    <th className="pb-2 text-right font-medium">Revenue</th>
                    <th className="pb-2 text-right font-medium">Cost</th>
                    <th className="pb-2 text-right font-medium">Profit</th>
                    <th className="pb-2 text-right font-medium">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.streams.map((s) => (
                    <tr key={s.stream} data-testid="insights-profit-row">
                      <td className="py-2 font-medium">{s.stream}</td>
                      <td className="py-2 text-right money-figures"><Amount amountMinor={s.revenueMinor} /></td>
                      <td className="py-2 text-right money-figures text-muted-foreground"><Amount amountMinor={s.directCostMinor} /></td>
                      <td className="py-2 text-right money-figures">
                        <Amount amountMinor={s.profitMinor} tone={s.profitMinor >= 0 ? "income" : undefined} className={cn("font-semibold", s.profitMinor < 0 && "text-negative")} />
                      </td>
                      <td className="py-2 text-right text-muted-foreground">{s.marginPct === null ? "—" : `${s.marginPct}%`}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="text-muted-foreground">
                  {data.untaggedRevenueMinor > 0 ? (
                    <tr>
                      <td className="pt-2.5">Untagged revenue</td>
                      <td className="pt-2.5 text-right money-figures"><Amount amountMinor={data.untaggedRevenueMinor} /></td>
                      <td /><td /><td />
                    </tr>
                  ) : null}
                  {data.unallocatedCostMinor > 0 ? (
                    <tr>
                      <td className="pt-1">Shared overhead</td>
                      <td />
                      <td className="pt-1 text-right money-figures"><Amount amountMinor={data.unallocatedCostMinor} /></td>
                      <td /><td />
                    </tr>
                  ) : null}
                  <tr className="font-semibold text-foreground">
                    <td className="pt-2.5">Net income</td>
                    <td /><td />
                    <td className="pt-2.5 text-right money-figures">
                      <Amount amountMinor={netIncome} tone={netIncome >= 0 ? "income" : undefined} className={cn(netIncome < 0 && "text-negative")} />
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-[14px] border bg-card p-4 shadow-xs">
      <div className="text-[11.5px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold money-figures">{children}</div>
    </div>
  );
}

function PeriodPicker({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const opts: Array<{ id: Period; label: string }> = [
    { id: "month", label: "This month" },
    { id: "quarter", label: "This quarter" },
    { id: "year", label: "This year" },
  ];
  return (
    <div className="inline-flex rounded-lg border bg-card p-0.5">
      {opts.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={cn(
            "rounded-[6px] px-2.5 py-1 text-[12px] transition-colors",
            period === opt.id ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <section className="rounded-[14px] border bg-card p-4 shadow-xs">{children}</section>;
}
