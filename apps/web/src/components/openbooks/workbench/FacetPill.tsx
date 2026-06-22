"use client";

import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type { FacetOption } from "./FilterBar";

/**
 * A single facet as a Mercury-style dropdown pill: an outline button that flips
 * to the secondary (active) treatment once a value is chosen, opening a compact
 * searchable list. Single mode shows the chosen label and closes on pick; multi
 * mode keeps the menu open and shows a count badge. The value is always a string
 * array so single and multi share one shape.
 */
export function FacetPill({
  label,
  icon: Icon,
  options,
  value,
  onChange,
  mode = "multi",
  align = "start",
  searchable,
  className,
}: {
  label: string;
  icon?: LucideIcon;
  options: FacetOption[];
  value: string[];
  onChange: (next: string[]) => void;
  mode?: "single" | "multi";
  align?: "start" | "center" | "end";
  /** Show a search box; defaults on when there are more than 6 options. */
  searchable?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const active = value.length > 0;
  const showSearch = searchable ?? options.length > 6;

  function toggle(next: string) {
    if (mode === "single") {
      onChange(value.includes(next) ? [] : [next]);
      setOpen(false);
      return;
    }
    onChange(value.includes(next) ? value.filter((v) => v !== next) : [...value, next]);
  }

  const triggerLabel =
    mode === "single" && active
      ? (options.find((o) => o.value === value[0])?.label ?? label)
      : label;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={active ? "secondary" : "outline"}
          size="sm"
          role="combobox"
          aria-expanded={open}
          className={cn("w-fit", className)}
        >
          {Icon ? <Icon data-icon="inline-start" /> : null}
          <span className="truncate">{triggerLabel}</span>
          {mode === "multi" && active ? (
            <Badge variant="outline" className="money-figures">
              {value.length}
            </Badge>
          ) : null}
          <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-56 p-0">
        <Command>
          {showSearch ? <CommandInput placeholder={`Search ${label.toLowerCase()}`} /> : null}
          <CommandList>
            <CommandEmpty>No options.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const checked = value.includes(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    onSelect={() => toggle(option.value)}
                    className="gap-2"
                  >
                    <Check className={cn("size-4", checked ? "text-primary opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
