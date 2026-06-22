"use client";

import { ChevronDown, Coins } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type AmountDirection = "any" | "in" | "out";
export type AmountValue = {
  direction?: AmountDirection;
  /** Inclusive lower bound, integer minor units. */
  minMinor?: number;
  /** Inclusive upper bound, integer minor units. */
  maxMinor?: number;
};

export function isAmountActive(value?: AmountValue) {
  return Boolean(
    value &&
      ((value.direction && value.direction !== "any") ||
        value.minMinor != null ||
        value.maxMinor != null),
  );
}

function minorToInput(minor?: number) {
  return minor == null ? "" : (minor / 100).toFixed(2);
}

function inputToMinor(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? undefined : Math.round(parsed * 100);
}

/**
 * The amount editor body: a direction toggle (Any / Money in / Money out) plus
 * inclusive min / max bounds. Bounds are stored as integer minor units, never
 * floats, consistent with the rest of the ledger. Mounted both as a standalone
 * pill and inside the mega Filters panel.
 */
export function AmountFilter({
  value,
  onChange,
}: {
  value: AmountValue;
  onChange: (next: AmountValue) => void;
}) {
  // Drafts mirror props so an external Clear (value reset to undefined) empties
  // the inputs, while typing stays smooth and isn't reformatted mid-entry. We
  // resync during render (React's "adjust state on prop change" pattern) only
  // when the draft no longer represents the value — i.e. an EXTERNAL change, not
  // the echo of the user's own edit — so keystrokes are never reformatted.
  const [minDraft, setMinDraft] = useState(() => minorToInput(value.minMinor));
  const [maxDraft, setMaxDraft] = useState(() => minorToInput(value.maxMinor));
  if (inputToMinor(minDraft) !== value.minMinor) setMinDraft(minorToInput(value.minMinor));
  if (inputToMinor(maxDraft) !== value.maxMinor) setMaxDraft(minorToInput(value.maxMinor));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Direction</span>
        <ToggleGroup
          type="single"
          value={value.direction ?? "any"}
          onValueChange={(next) =>
            onChange({ ...value, direction: (next || "any") as AmountDirection })
          }
          spacing={0}
          variant="outline"
          size="sm"
          className="flex-wrap"
        >
          <ToggleGroupItem value="any" variant="outline" size="sm">
            Any
          </ToggleGroupItem>
          <ToggleGroupItem value="in" variant="outline" size="sm">
            Money in
          </ToggleGroupItem>
          <ToggleGroupItem value="out" variant="outline" size="sm">
            Money out
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          At least
          <InputGroup className="h-8">
            <InputGroupAddon>$</InputGroupAddon>
            <InputGroupInput
              inputMode="decimal"
              className="money-figures"
              value={minDraft}
              placeholder="0.00"
              aria-label="Minimum amount"
              onChange={(event) => {
                setMinDraft(event.target.value);
                onChange({ ...value, minMinor: inputToMinor(event.target.value) });
              }}
            />
          </InputGroup>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          No more than
          <InputGroup className="h-8">
            <InputGroupAddon>$</InputGroupAddon>
            <InputGroupInput
              inputMode="decimal"
              className="money-figures"
              value={maxDraft}
              placeholder="0.00"
              aria-label="Maximum amount"
              onChange={(event) => {
                setMaxDraft(event.target.value);
                onChange({ ...value, maxMinor: inputToMinor(event.target.value) });
              }}
            />
          </InputGroup>
        </label>
      </div>
    </div>
  );
}

/** The standalone toolbar pill wrapping {@link AmountFilter} in a popover. */
export function AmountFilterPill({
  value,
  onChange,
  align = "start",
}: {
  value: AmountValue;
  onChange: (next: AmountValue) => void;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const active = isAmountActive(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={active ? "secondary" : "outline"} size="sm" className="w-fit">
          <Coins data-icon="inline-start" />
          Amount
          {active ? <span className="size-1.5 rounded-full bg-primary" aria-hidden /> : null}
          <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-72">
        <AmountFilter value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
