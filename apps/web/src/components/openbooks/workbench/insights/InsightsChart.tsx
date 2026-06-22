"use client";

import { useMemo, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
} from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";
import { formatMinorMoney } from "@/components/openbooks/primitives";
import { cn } from "@/lib/utils";

import { usePrefersReducedMotion } from "./use-reduced-motion";

export type ChartSeriesType = "bar" | "line" | "area";

export type InsightsChartSeries = {
  key: string;
  label: string;
  color: string;
  type: ChartSeriesType;
};

export type InsightsChartPoint = {
  /** X-axis category. */
  x: string;
  /** A short axis tick label (the x value may be an ISO date). */
  label?: string;
  /** The raw key behind this point (e.g. the ISO day) for the drill callback. */
  drillKey?: string;
} & Record<string, string | number | undefined>;

/**
 * The shared Insights chart wrapper (E1.3). One component every section's
 * Insights chart slot uses, so the interaction craft is identical everywhere:
 *
 * - ONE unified tooltip: a single vertical CROSSHAIR cursor + a tooltip that
 *   lists every series' value at the hovered x (not a tooltip per series).
 * - CLICK-TO-DRILL: clicking a point/category calls `onDrill(point)` so the
 *   consumer can open the transaction drawer for that slice.
 * - LEGEND CROSS-FILTER: an interactive legend toggles series on/off in place;
 *   the y-scale and crosshair recompute from the visible series only.
 * - MORPH, don't re-fire: animation runs ~240ms on a data change and is disabled
 *   under prefers-reduced-motion. The parent retains the last value across a
 *   period/compare change, so this never unmounts into a skeleton — recharts
 *   tweens the bars/area between the old and new data.
 */
export function InsightsChart({
  data,
  series,
  currency,
  onDrill,
  height = 220,
  className,
}: {
  data: InsightsChartPoint[];
  series: InsightsChartSeries[];
  currency: string;
  /** Opens the drill drawer for the clicked point. */
  onDrill?: (point: InsightsChartPoint) => void;
  height?: number;
  className?: string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  // Legend cross-filter state: which series are hidden.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visibleSeries = series.filter((entry) => !hidden.has(entry.key));

  const config = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        series.map((entry) => [entry.key, { label: entry.label, color: entry.color }]),
      ),
    [series],
  );

  function toggle(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      // Don't allow hiding the last visible series — an empty chart reads broken.
      if (next.has(key)) next.delete(key);
      else if (series.length - next.size > 1) next.add(key);
      return next;
    });
  }

  // Recharts types `onClick` as receiving a broad chart-state object; we only
  // read the active payload, so accept it loosely and narrow here. This is the
  // chart-area fallback (a click that lands between bars still drills the
  // nearest category).
  function handlePointClick(state: unknown) {
    if (!onDrill) return;
    const activePayload = (state as { activePayload?: Array<{ payload?: InsightsChartPoint }> })
      ?.activePayload;
    const point = activePayload?.[0]?.payload;
    if (point) onDrill(point);
  }

  // Per-series click: recharts hands the clicked element its own data point
  // (`payload`), which is the precise slice to drill — more reliable than the
  // chart-level activePayload and gives the exact bar/point the user hit.
  function handleSeriesClick(data: unknown) {
    if (!onDrill) return;
    const point = (data as { payload?: InsightsChartPoint })?.payload;
    if (point) onDrill(point);
  }

  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="insights-chart">
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
          onClick={handlePointClick}
          className={onDrill ? "cursor-pointer" : undefined}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={16}
          />
          {/* Shared vertical crosshair + ONE unified tooltip listing every visible
              series at the hovered x. */}
          <ChartTooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            content={<UnifiedTooltip currency={currency} series={visibleSeries} />}
          />
          {visibleSeries.map((entry) => {
            const animation = reducedMotion
              ? { isAnimationActive: false as const }
              : { isAnimationActive: true as const, animationDuration: 240 };
            const clickProps = onDrill
              ? { onClick: handleSeriesClick, cursor: "pointer" as const }
              : {};
            if (entry.type === "bar") {
              return (
                <Bar
                  key={entry.key}
                  dataKey={entry.key}
                  fill={entry.color}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={28}
                  {...clickProps}
                  {...animation}
                />
              );
            }
            if (entry.type === "area") {
              return (
                <Area
                  key={entry.key}
                  dataKey={entry.key}
                  type="monotone"
                  stroke={entry.color}
                  strokeWidth={2}
                  fill={entry.color}
                  fillOpacity={0.08}
                  dot={false}
                  activeDot={{ r: 3, ...clickProps }}
                  {...clickProps}
                  {...animation}
                />
              );
            }
            return (
              <Line
                key={entry.key}
                dataKey={entry.key}
                type="monotone"
                stroke={entry.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3, ...clickProps }}
                {...clickProps}
                {...animation}
              />
            );
          })}
        </ComposedChart>
      </ChartContainer>

      <ChartLegend series={series} hidden={hidden} onToggle={toggle} />
    </div>
  );
}

/** ONE unified tooltip: the hovered x + every visible series' value at that x,
 * money in tabular figures. A named component so it keeps a display name. */
function UnifiedTooltip({
  active,
  payload,
  label,
  currency,
  series,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number | string; color?: string }>;
  label?: string | number;
  currency: string;
  series: InsightsChartSeries[];
}) {
  if (!active || !payload?.length) return null;
  const labelFor = (key: string) => series.find((entry) => entry.key === key)?.label ?? key;
  return (
    <div className="grid min-w-40 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      {label != null ? <div className="font-medium">{String(label)}</div> : null}
      <div className="grid gap-1">
        {payload.map((item, index) => {
          const key = String(item.dataKey ?? index);
          return (
            <div key={key} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  className="size-2 rounded-[2px]"
                  style={{ background: item.color }}
                  aria-hidden
                />
                {labelFor(key)}
              </span>
              <span className="money-figures text-foreground">
                {formatMinorMoney(Number(item.value), { currency })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The interactive legend that cross-filters series. Each chip is a real button
 * with a checked state; toggling hides/shows the series and dims the chip. */
function ChartLegend({
  series,
  hidden,
  onToggle,
}: {
  series: InsightsChartSeries[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="insights-chart-legend">
      {series.map((entry) => {
        const off = hidden.has(entry.key);
        return (
          <button
            key={entry.key}
            type="button"
            onClick={() => onToggle(entry.key)}
            aria-pressed={!off}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs transition-opacity",
              off ? "opacity-40" : "opacity-100",
            )}
            data-testid={`insights-legend-${entry.key}`}
          >
            <span
              className="size-2.5 rounded-[3px]"
              style={{ background: entry.color }}
              aria-hidden
            />
            <span className={cn(off && "line-through")}>{entry.label}</span>
          </button>
        );
      })}
    </div>
  );
}
