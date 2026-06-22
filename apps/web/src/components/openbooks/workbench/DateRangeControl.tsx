"use client";

import { CalendarDays } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export type DateRangePreset = "this-month" | "last-month" | "last-3-months" | "ytd";

export type DateRangeValue =
  | { preset: DateRangePreset }
  | { from: Date; to: Date };

type PresetDef = { value: DateRangePreset; label: string };

const DEFAULT_PRESETS: PresetDef[] = [
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "last-3-months", label: "Last 3 months" },
  { value: "ytd", label: "YTD" },
];

function isPreset(value: DateRangeValue): value is { preset: DateRangePreset } {
  return "preset" in value;
}

function formatRange(from: Date, to: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  return `${fmt.format(from)} – ${fmt.format(to)}`;
}

function toInputDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function dateRangeValueToISO(value: DateRangeValue, todayISO: string) {
  if (!isPreset(value)) {
    const from = value.from <= value.to ? value.from : value.to;
    const to = value.from <= value.to ? value.to : value.from;
    return { from: toInputDate(from), to: toInputDate(to) };
  }

  const [year, month] = todayISO.split("-").map(Number);
  if (value.preset === "this-month") {
    return { from: `${year}-${String(month).padStart(2, "0")}-01`, to: todayISO };
  }
  if (value.preset === "ytd") {
    return { from: `${year}-01-01`, to: todayISO };
  }
  if (value.preset === "last-month") {
    const lastMonth = month === 1 ? 12 : month - 1;
    const lastYear = month === 1 ? year - 1 : year;
    const lastDay = new Date(Date.UTC(lastYear, lastMonth, 0)).getUTCDate();
    return {
      from: `${lastYear}-${String(lastMonth).padStart(2, "0")}-01`,
      to: `${lastYear}-${String(lastMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    };
  }

  const start = new Date(`${todayISO}T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - 2);
  return {
    from: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-01`,
    to: todayISO,
  };
}

function parseInputDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function activeLabel(value: DateRangeValue, presets: PresetDef[]) {
  if (isPreset(value)) {
    return presets.find((p) => p.value === value.preset)?.label ?? "Custom";
  }
  return formatRange(value.from, value.to);
}

function draftFromValue(value: DateRangeValue) {
  return isPreset(value) ? "" : toInputDate(value.from);
}

function draftToValue(value: DateRangeValue) {
  return isPreset(value) ? "" : toInputDate(value.to);
}

/**
 * The one canonical period control. Presets live in a ToggleGroup; a custom
 * range opens a two-month Calendar in a Popover with future dates disabled. On
 * mobile (and in compact mode) the whole control collapses to a single trigger
 * showing the active label.
 */
export function DateRangeControl({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  align = "start",
  compact = false,
  className,
}: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  presets?: PresetDef[];
  align?: "start" | "center" | "end";
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(() => draftFromValue(value));
  const [draftTo, setDraftTo] = useState(() => draftToValue(value));
  const today = new Date();

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setDraftFrom(draftFromValue(value));
      setDraftTo(draftToValue(value));
    }
    setOpen(nextOpen);
  }

  function applyTypedRange() {
    const from = parseInputDate(draftFrom);
    const to = parseInputDate(draftTo);
    if (!from || !to) return;
    onChange(from <= to ? { from, to } : { from: to, to: from });
    setOpen(false);
  }

  const calendar = (
    <Calendar
      mode="range"
      numberOfMonths={2}
      defaultMonth={isPreset(value) ? today : value.from}
      selected={isPreset(value) ? undefined : { from: value.from, to: value.to }}
      onSelect={(range: DateRange | undefined) => {
        if (range?.from && range?.to) {
          onChange({ from: range.from, to: range.to });
          setOpen(false);
        }
      }}
    />
  );

  const customInputs = (
    <div className="flex flex-col gap-2 border-t p-2.5">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          From
          <Input
            type="date"
            value={draftFrom}
            onChange={(event) => setDraftFrom(event.target.value)}
            aria-label="Custom range start"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          To
          <Input
            type="date"
            value={draftTo}
            onChange={(event) => setDraftTo(event.target.value)}
            aria-label="Custom range end"
          />
        </label>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={applyTypedRange}
        disabled={!parseInputDate(draftFrom) || !parseInputDate(draftTo)}
      >
        Apply custom range
      </Button>
    </div>
  );

  // Compact / mobile: a single popover trigger with the active label.
  const collapsed = (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="min-w-0 justify-start">
          <CalendarDays data-icon="inline-start" />
          <span className="truncate money-figures">{activeLabel(value, presets)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto p-0">
        <div className="flex flex-col gap-2 p-2.5">
          <ToggleGroup
            type="single"
            value={isPreset(value) ? value.preset : ""}
            onValueChange={(preset) => {
              if (preset) {
                onChange({ preset: preset as DateRangePreset });
                setOpen(false);
              }
            }}
            spacing={2}
            className="flex-wrap"
          >
            {presets.map((preset) => (
              <ToggleGroupItem key={preset.value} value={preset.value} variant="outline" size="sm">
                {preset.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {calendar}
          {customInputs}
        </div>
      </PopoverContent>
    </Popover>
  );

  if (compact) {
    return <div className={cn(className)}>{collapsed}</div>;
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Mobile: collapsed control. */}
      <div className="md:hidden">{collapsed}</div>

      {/* Desktop: presets inline + a custom-range popover. */}
      <ToggleGroup
        type="single"
        value={isPreset(value) ? value.preset : ""}
        onValueChange={(preset) => {
          if (preset) onChange({ preset: preset as DateRangePreset });
        }}
        spacing={0}
        variant="outline"
        size="sm"
        className="hidden md:flex"
      >
        {presets.map((preset) => (
          <ToggleGroupItem key={preset.value} value={preset.value} variant="outline" size="sm">
            {preset.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant={isPreset(value) ? "outline" : "secondary"}
            size="sm"
            className="hidden md:inline-flex"
          >
            <CalendarDays data-icon="inline-start" />
            {isPreset(value) ? "Custom" : (
              <span className="money-figures">{formatRange(value.from, value.to)}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align={align} className="w-auto p-0">
          <div className="flex flex-col">
            {calendar}
            {customInputs}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
