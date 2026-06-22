"use client";

import { Layers } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type GroupByKey = "none" | "category" | "account" | "contact" | "role" | "source" | "month" | "status";

const DEFAULT_OPTIONS: { key: GroupByKey; label: string }[] = [
  { key: "none", label: "No grouping" },
  { key: "category", label: "Category" },
  { key: "account", label: "Account" },
  { key: "contact", label: "Contact" },
  { key: "source", label: "Source" },
  { key: "month", label: "Month" },
];

/** Group the visible table rows under sectioned headers. The `noun` (e.g.
 * "invoices", "contacts") keeps the a11y labels + heading copy section-correct
 * across every section that mounts this shared control (E5.3/E5.4). */
export function GroupByMenu({
  value,
  onChange,
  options = DEFAULT_OPTIONS,
  noun = "rows",
}: {
  value: GroupByKey;
  onChange: (next: GroupByKey) => void;
  options?: { key: GroupByKey; label: string }[];
  noun?: string;
}) {
  const active = value !== "none";
  const activeLabel = options.find((option) => option.key === value)?.label;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant={active ? "secondary" : "outline"}
              size="icon-sm"
              aria-label={active ? `Grouped by ${activeLabel}` : `Group ${noun}`}
            >
              <Layers />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{active ? `Grouped by ${activeLabel}` : "Group"}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Group {noun} by</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as GroupByKey)}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.key} value={option.key}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
