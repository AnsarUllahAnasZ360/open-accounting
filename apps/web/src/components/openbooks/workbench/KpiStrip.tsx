"use client";

import { BarChart3, Eye, EyeOff, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { Sparkline, StatCard } from "@/components/openbooks/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type KpiItem = {
  label: string;
  value: ReactNode;
  /** Only the overdue / outflow metric may use the negative token. */
  tone?: "neutral" | "income" | "negative";
  delta?: { pct: number; direction: "up" | "down" };
  detail?: string;
  sparkline?: number[];
};

/**
 * The standardized metric row. Replaces every page's hand-built grid of
 * StatCards so tone, trend rendering, and width stay consistent. Trend arrows
 * are lucide TrendingUp / TrendingDown (never unicode glyphs), and only a
 * negative-tone metric is allowed to carry the alarm color.
 */
export function KpiStrip({
  items,
  columns = 4,
  collapsible = true,
  defaultOpen = true,
  className,
}: {
  items: KpiItem[];
  columns?: 3 | 4;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const grid = (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 sm:grid-cols-2",
        columns === 3 ? "md:grid-cols-3" : "md:grid-cols-4",
      )}
    >
      {items.map((item) => {
        const TrendIcon = item.delta?.direction === "down" ? TrendingDown : TrendingUp;
        return (
          <StatCard
            key={item.label}
            label={item.label}
            value={
              <span
                className={cn(
                  // Money figures must wrap/shrink, never ellipsis-clip — a
                  // partial dollar amount misreads. min-w-0 lets the value sit
                  // inside the card without pushing past its edge; the value
                  // itself may wrap (composite cards) and a long single figure
                  // shrinks one notch on the 2-column breakpoint so 7-digit
                  // amounts stay whole instead of being clamped.
                  "money-figures block min-w-0 text-[1.375rem] leading-tight sm:text-xl md:text-2xl",
                  item.tone === "income" && "text-primary",
                  item.tone === "negative" && "text-negative",
                )}
              >
                {item.value}
              </span>
            }
            detail={item.detail}
          >
            {item.delta ? (
              <Badge variant="outline">
                <TrendIcon data-icon="inline-start" aria-hidden="true" />
                <span className="money-figures">{Math.abs(item.delta.pct)}%</span>
              </Badge>
            ) : null}
            {item.sparkline ? (
              <Sparkline
                data={item.sparkline}
                className={cn(item.tone === "negative" ? "text-negative" : "text-primary")}
              />
            ) : null}
          </StatCard>
        );
      })}
    </div>
  );

  if (!collapsible) {
    return <div className={className}>{grid}</div>;
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground">
          <BarChart3 data-icon="inline-start" aria-hidden="true" />
          <span>Stats</span>
          <Badge variant="outline" className="money-figures">
            {items.length}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <EyeOff data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
          {open ? "Hide stats" : "Show stats"}
        </Button>
      </div>
      {open ? grid : null}
    </div>
  );
}
