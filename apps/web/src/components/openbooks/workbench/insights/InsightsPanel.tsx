"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { DateRangeValue } from "../DateRangeControl";
import { InsightsScope } from "./InsightsScope";
import type { CompareMode } from "./insights-scope";

/**
 * The Insights panel shell (E1.1) every section consumes: a scope bar at the top
 * (period + Compare-to + resolved dates), a KPI band, then the ~60% charts /
 * ~40% AI-observations split (stacks on mobile). Pure layout — the consumer
 * passes the resolved pieces in. Carries the `insights-dashboard` test id so the
 * existing E0 sub-tab routing assertions keep passing.
 */
export function InsightsPanel({
  range,
  onRangeChange,
  compareMode,
  onCompareModeChange,
  todayISO,
  kpis,
  charts,
  observations,
  breakdown,
  className,
}: {
  range: DateRangeValue;
  onRangeChange: (value: DateRangeValue) => void;
  compareMode: CompareMode;
  onCompareModeChange: (mode: CompareMode) => void;
  todayISO: string;
  /** The KPI band (a row of InsightsKpiCard in an InsightsKpiGrid). */
  kpis?: ReactNode;
  /** The ~60% charts column. */
  charts: ReactNode;
  /** The ~40% AI observations column. */
  observations: ReactNode;
  /** Optional breakdown section below the split. */
  breakdown?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col gap-4", className)}
      data-testid="insights-dashboard"
    >
      <InsightsScope
        range={range}
        onRangeChange={onRangeChange}
        compareMode={compareMode}
        onCompareModeChange={onCompareModeChange}
        todayISO={todayISO}
      />
      {kpis}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="flex min-w-0 flex-col gap-4">{charts}</div>
        <div className="flex min-w-0 flex-col gap-4">{observations}</div>
      </div>
      {breakdown}
    </div>
  );
}
