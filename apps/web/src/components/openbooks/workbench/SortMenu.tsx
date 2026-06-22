"use client";

import { ArrowDownUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import type { SortState } from "./OpenBooksDataTable";

/**
 * Field + direction sort control for the page toolbar. Pairs with
 * OpenBooksDataTable's controlled `sort`/`onSortChange` props so sorting lives
 * in the toolbar (Mercury layout) rather than the table's own header.
 */
export function SortMenu({
  columns,
  value,
  onChange,
  align = "end",
  noun = "rows",
}: {
  columns: { key: string; label: string }[];
  value: SortState;
  onChange: (next: SortState) => void;
  align?: "start" | "center" | "end";
  /** Section noun (e.g. "invoices") so labels read section-correctly (E5.3). */
  noun?: string;
}) {
  const active = value != null;
  const fieldValue = value?.key ?? "__default__";
  const directionValue = value?.direction ?? "desc";

  function setField(key: string) {
    if (key === "__default__") {
      onChange(null);
      return;
    }
    onChange({ key, direction: value?.direction ?? "desc" });
  }

  function setDirection(direction: "asc" | "desc") {
    if (!value) {
      const first = columns[0];
      if (first) onChange({ key: first.key, direction });
      return;
    }
    onChange({ key: value.key, direction });
  }

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant={active ? "secondary" : "outline"} size="icon-sm" aria-label={`Sort ${noun}`}>
              <ArrowDownUp />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {value ? `Sorted by ${columns.find((column) => column.key === value.key)?.label ?? value.key}` : "Sort"}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align={align} className="w-72">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Sort {noun} by</span>
          <div className="grid grid-cols-2 gap-2">
            <Select value={fieldValue} onValueChange={setField}>
              <SelectTrigger size="sm" aria-label="Sort field">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="__default__">Default</SelectItem>
                  {columns.map((column) => (
                    <SelectItem key={column.key} value={column.key}>
                      {column.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={directionValue}
              onValueChange={(next) => setDirection(next as "asc" | "desc")}
              disabled={!active}
            >
              <SelectTrigger size="sm" aria-label="Sort direction">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="desc">Descending</SelectItem>
                  <SelectItem value="asc">Ascending</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
