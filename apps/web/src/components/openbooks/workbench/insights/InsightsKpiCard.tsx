"use client";

import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";

import { Sparkline } from "@/components/openbooks/primitives";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { safeDeltaPct } from "./insights-scope";

export type KpiTone = "neutral" | "income" | "warning" | "negative";

export type KpiStatus = {
  label: string;
  /** neutral = info, warning = amber, negative = red (genuinely bad), good = green. */
  tone?: "neutral" | "warning" | "negative" | "good";
};

export type InsightsKpiCardProps = {
  label: string;
  /** Pre-formatted value (the caller owns money formatting + sign). */
  value: ReactNode;
  /** Value tone — only `income`/`negative` carry color (paired with a sign by the caller). */
  tone?: KpiTone;
  /**
   * The comparison frame's name, e.g. "previous period". When set AND `current`
   * + `previous` are both supplied, the card computes and shows a delta:
   *   "▲ 12% vs previous period".
   * SUPPRESSED entirely when there's no comparison history (no "+∞%"/"NaN").
   */
  comparison?: {
    current: number;
    previous: number | null | undefined;
    frameLabel: string | null;
    /** When true (e.g. expenses, overdue), an UP movement is the bad direction. */
    invertColor?: boolean;
  };
  sparkline?: number[];
  status?: KpiStatus | null;
  /** Optional small supporting line under the value. */
  detail?: string;
  /**
   * When set, the whole card becomes a button that drills (e.g. the
   * "Uncategorized" KPI opening its transactions). Keeps the card reusable as a
   * drill affordance without hardcoding any section's drill shape.
   */
  onClick?: () => void;
  className?: string;
};

/** Enter/Space activate a card that's been promoted to a button (drill). */
function handleActivate(onClick: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };
}

const STATUS_CLASSES: Record<NonNullable<KpiStatus["tone"]>, string> = {
  neutral: "text-muted-foreground",
  good: "border-primary/30 text-primary",
  warning: "border-warning/40 text-warning",
  negative: "border-negative/40 text-negative",
};

/**
 * The one KPI card anatomy (E1.2), reused by every section's Insights:
 *   label → value (tabular figures) → delta + NAMED comparison frame → sparkline
 *   → optional status pill.
 *
 * Delta rules (the craft detail): when there's no comparison base (previous is
 * 0/null/undefined or the frame is off) the delta is omitted completely — the
 * card never renders an "+∞%" or "NaN". A 0% change shows a neutral dash, not an
 * arrow. Color is paired with a direction icon, never carried by color alone.
 */
export function InsightsKpiCard({
  label,
  value,
  tone = "neutral",
  comparison,
  sparkline,
  status,
  detail,
  onClick,
  className,
}: InsightsKpiCardProps) {
  const pct =
    comparison && comparison.frameLabel
      ? safeDeltaPct(comparison.current, comparison.previous)
      : null;

  return (
    <Card
      className={cn(
        "shadow-xs",
        onClick &&
          "cursor-pointer text-left transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
      data-testid="insights-kpi-card"
      {...(onClick
        ? { role: "button", tabIndex: 0, onClick, onKeyDown: handleActivate(onClick) }
        : {})}
    >
      <CardContent className="flex flex-col gap-2.5 p-4">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <div
          className={cn(
            "money-figures min-w-0 text-2xl leading-tight font-semibold",
            tone === "income" && "text-primary",
            tone === "negative" && "text-negative",
            tone === "warning" && "text-warning",
          )}
        >
          {value}
        </div>

        {pct != null ? (
          <DeltaLine pct={pct} frameLabel={comparison!.frameLabel!} invertColor={comparison!.invertColor} />
        ) : detail ? (
          <p className="text-xs text-muted-foreground">{detail}</p>
        ) : null}

        {sparkline && sparkline.length > 1 ? (
          <Sparkline
            data={sparkline}
            className={cn(tone === "negative" ? "text-negative" : "text-primary")}
          />
        ) : null}

        {status ? (
          <Badge
            variant="outline"
            className={cn("w-fit font-normal", STATUS_CLASSES[status.tone ?? "neutral"])}
          >
            {status.label}
          </Badge>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** "▲ 12% vs previous period" — direction icon + signed-by-icon percentage +
 * the named frame. Color discipline: an improvement is green, a regression is
 * neutral by default and red only when the metric is one where up = bad
 * (invertColor). 0% is a calm dash. */
function DeltaLine({
  pct,
  frameLabel,
  invertColor,
}: {
  pct: number;
  frameLabel: string;
  invertColor?: boolean;
}) {
  if (pct === 0) {
    return (
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3.5" aria-hidden />
        <span className="money-figures">No change</span>
        <span className="text-muted-foreground/80">vs {frameLabel}</span>
      </p>
    );
  }
  const up = pct > 0;
  // "Good" = an increase for a normal metric, or a decrease for an inverted one
  // (expenses / overdue). Only the genuinely-bad direction takes the alarm token;
  // a normal decline stays neutral, never alarm-red.
  const isGood = invertColor ? !up : up;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <p
      className={cn(
        "flex items-center gap-1 text-xs",
        isGood ? "text-primary" : invertColor ? "text-negative" : "text-muted-foreground",
      )}
      data-testid="insights-kpi-delta"
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="money-figures">{Math.abs(pct)}%</span>
      <span className="text-muted-foreground/80">vs {frameLabel}</span>
    </p>
  );
}

/** A simple responsive grid for a row of KPI cards (hero + drivers + supporting).
 * Mirrors KpiStrip's breakpoints so the band lines up with the rest of the app. */
export function InsightsKpiGrid({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  columns?: 3 | 4 | 5;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 sm:grid-cols-2",
        columns === 3 && "md:grid-cols-3",
        columns === 4 && "md:grid-cols-4",
        columns === 5 && "md:grid-cols-3 lg:grid-cols-5",
        className,
      )}
      data-testid="insights-kpi-grid"
    >
      {children}
    </div>
  );
}
