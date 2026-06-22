"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export type FacetOption = { value: string; label: string };

export type FacetDef = {
  /** Stable key used in the value map. */
  key: string;
  label: string;
  options: FacetOption[];
};

export type FacetValue = Record<string, string | undefined>;

export type ActiveChip = { key: string; label: string };

/**
 * The shared shelf above every data table: search, page-specific selectors,
 * one filter popover, and removable chips for active constraints. Facets never
 * render as a long permanent pill strip; the table stays the primary work
 * surface and active filters remain recoverable as chips.
 */
export function FilterBar({
  facets = [],
  value = {},
  onChange,
  activeChips,
  onClearAll,
  children,
  className,
}: {
  facets?: FacetDef[];
  value?: FacetValue;
  onChange?: (next: FacetValue) => void;
  /** @deprecated Page-local search was removed; use the app command search. */
  search?: string;
  /** @deprecated Page-local search was removed; use the app command search. */
  onSearch?: (next: string) => void;
  /** @deprecated Page-local search was removed; use the app command search. */
  searchPlaceholder?: string;
  /** Pass to override; otherwise chips derive from facets + value. */
  activeChips?: ActiveChip[];
  onClearAll?: () => void;
  children?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const derivedChips: ActiveChip[] =
    activeChips ??
    facets.flatMap((facet) => {
      const selected = value[facet.key];
      if (!selected || selected === "all" || selected === "__all__") return [];
      const option = facet.options.find((o) => o.value === selected);
      return option ? [{ key: facet.key, label: `${facet.label}: ${option.label}` }] : [];
    });

  function setFacet(key: string, next: string) {
    onChange?.({ ...value, [key]: next || undefined });
  }

  function clearChip(key: string) {
    onChange?.({ ...value, [key]: undefined });
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {children ? <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div> : null}
        {facets.length > 0 ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="w-fit sm:ml-auto">
                <SlidersHorizontal data-icon="inline-start" />
                Filter
                {derivedChips.length > 0 ? (
                  <Badge variant="secondary" className="money-figures">
                    {derivedChips.length}
                  </Badge>
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
              <div className="flex flex-col gap-3 p-3">
                <div>
                  <div className="text-sm font-medium">Filter this view</div>
                  <p className="text-xs text-muted-foreground">Choose only the records you want in the table.</p>
                </div>
              {facets.map((facet) => (
                <div key={facet.key} className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{facet.label}</span>
                  <ToggleGroup
                    type="single"
                    value={value[facet.key] ?? ""}
                    onValueChange={(next) => setFacet(facet.key, next)}
                    spacing={0}
                    variant="outline"
                    size="sm"
                    className="flex-wrap"
                  >
                    {facet.options.map((option) => (
                      <ToggleGroupItem key={option.value} value={option.value} variant="outline" size="sm">
                        {option.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              ))}
              </div>
              <div className="flex items-center justify-between border-t px-3 py-2">
                <Button variant="ghost" size="sm" onClick={() => onClearAll?.()}>
                  Clear
                </Button>
                <Button size="sm" onClick={() => setOpen(false)}>
                  Apply
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>

      {derivedChips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {derivedChips.map((chip) => (
            <Badge key={chip.key} variant="outline" className="gap-1">
              {chip.label}
              <button
                type="button"
                onClick={() => clearChip(chip.key)}
                aria-label={`Remove ${chip.label}`}
                className="-mr-0.5 inline-flex items-center rounded-full outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          {onClearAll ? (
            <Button variant="ghost" size="xs" onClick={onClearAll}>
              Clear all
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
