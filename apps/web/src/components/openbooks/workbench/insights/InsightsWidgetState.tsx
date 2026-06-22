"use client";

import { CircleDashed, Sprout, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type WidgetStateKind = "empty" | "first-run" | "low-data";

const COPY: Record<
  WidgetStateKind,
  { icon: LucideIcon; title: string; description: string }
> = {
  empty: {
    icon: CircleDashed,
    title: "Nothing in this period",
    description: "No activity fell inside the selected dates. Widen the range to see more.",
  },
  "first-run": {
    icon: Sprout,
    title: "Not enough history yet",
    description: "Charts and comparisons appear once a few weeks of activity have posted.",
  },
  "low-data": {
    icon: TrendingUp,
    title: "Too little to chart",
    description: "There are only a handful of entries here — the trend fills in as more post.",
  },
};

/**
 * A per-widget empty / first-run / low-data state (E1.5). Sized to sit inside a
 * chart card where a chart would otherwise render, so swapping a chart for this
 * doesn't shift the layout. Quiet, monochrome, no alarm color — an empty period
 * is normal, not an error.
 */
export function InsightsWidgetState({
  kind,
  title,
  description,
  className,
  minHeight = 150,
}: {
  kind: WidgetStateKind;
  title?: string;
  description?: string;
  className?: string;
  /** Match the chart's rendered height so the card doesn't jump. */
  minHeight?: number;
}) {
  const copy = COPY[kind];
  const Icon = copy.icon;
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-md bg-muted/30 px-4 py-6 text-center",
        className,
      )}
      style={{ minHeight }}
      data-testid={`insights-widget-state-${kind}`}
    >
      <Icon className="size-6 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      <div className="text-sm font-medium">{title ?? copy.title}</div>
      <p className="max-w-xs text-xs text-muted-foreground">{description ?? copy.description}</p>
    </div>
  );
}

/**
 * The first-paint skeleton for the whole panel — KPI row + chart + AI column.
 * Matches the FINAL dimensions so the real content lands without a reflow.
 * Critically, the panel only renders this on the VERY FIRST load (data ===
 * undefined with no prior value). A period/compare change keeps the existing
 * content mounted and lets the charts morph — see `InsightsChart` and the
 * consumer's "retain last value" guard — so the skeleton never re-fires on a
 * mere scope change.
 */
export function InsightsPanelSkeleton({ kpiCount = 4 }: { kpiCount?: number }) {
  return (
    <div className="flex flex-col gap-4" data-testid="insights-panel-skeleton">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        {Array.from({ length: kpiCount }).map((_, index) => (
          <Skeleton key={index} className="h-[7.5rem] rounded-[14px]" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <Skeleton className="h-72 rounded-[14px]" />
        <Skeleton className="h-72 rounded-[14px]" />
      </div>
    </div>
  );
}

/** A titled chart card frame: a consistent header + body slot so every widget
 * (chart, state, or skeleton) sits in the same shell and the same footprint. */
export function InsightsChartCard({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("flex flex-col gap-3 rounded-[14px] p-4 shadow-xs ring-1 ring-foreground/10", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
