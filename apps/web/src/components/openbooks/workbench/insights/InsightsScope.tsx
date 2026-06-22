"use client";

import { ArrowLeftRight } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { DateRangeControl, type DateRangeValue } from "../DateRangeControl";
import {
  type CompareMode,
  resolveScope,
  type ResolvedScope,
} from "./insights-scope";

const COMPARE_OPTIONS: { value: CompareMode; label: string }[] = [
  { value: "previous-period", label: "Previous period" },
  { value: "previous-year", label: "Previous year" },
  { value: "none", label: "No comparison" },
];

/**
 * The Insights scope bar (E1.1). One control governs the whole panel: a period
 * picker (reusing the canonical DateRangeControl) + a "Compare to" select. It
 * ALWAYS renders the resolved calendar dates of the active range and — when a
 * comparison is on — the comparison range, e.g.
 *   "Jun 1 – 30, 2026  vs  May 1 – 31, 2026"
 * so the reader never has to decode a preset name into dates.
 *
 * Stateless: the consumer owns `range` + `compareMode` (so they live in URL /
 * page state and can be threaded to the data layer). `todayISO` anchors relative
 * presets deterministically.
 */
export function InsightsScope({
  range,
  onRangeChange,
  compareMode,
  onCompareModeChange,
  todayISO,
  className,
}: {
  range: DateRangeValue;
  onRangeChange: (value: DateRangeValue) => void;
  compareMode: CompareMode;
  onCompareModeChange: (mode: CompareMode) => void;
  todayISO: string;
  className?: string;
}) {
  const scope = resolveScope(range, compareMode, todayISO);
  return (
    <div
      data-testid="insights-scope"
      className={cn("flex flex-col gap-2", className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <DateRangeControl value={range} onChange={onRangeChange} />
        <div className="flex items-center gap-1.5">
          <ArrowLeftRight
            className="size-4 text-muted-foreground"
            aria-hidden
          />
          <Select
            value={compareMode}
            onValueChange={(value) => onCompareModeChange(value as CompareMode)}
          >
            <SelectTrigger
              size="sm"
              className="min-w-0"
              aria-label="Compare to"
              data-testid="insights-compare"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              {COMPARE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <ResolvedDatesLine scope={scope} />
    </div>
  );
}

/** The always-on resolved-dates line. Tabular figures; the comparison frame is
 * named, never just implied. */
function ResolvedDatesLine({ scope }: { scope: ResolvedScope }) {
  return (
    <p
      className="text-xs text-muted-foreground"
      data-testid="insights-resolved-dates"
    >
      <span className="money-figures text-foreground">{scope.activeLabel}</span>
      {scope.compareLabel ? (
        <>
          <span className="mx-1.5">vs</span>
          <span className="money-figures">{scope.compareLabel}</span>
        </>
      ) : null}
    </p>
  );
}
