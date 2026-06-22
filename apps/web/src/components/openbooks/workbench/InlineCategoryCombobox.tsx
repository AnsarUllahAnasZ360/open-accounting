"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";

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

export type CategoryOption = { id: string; label: string; type?: string };

const TYPE_LABEL: Record<string, string> = {
  expense: "Expenses",
  income: "Income",
  asset: "Assets",
  liability: "Liabilities",
};
const TYPE_ORDER = ["expense", "income", "asset", "liability", "other"];

/**
 * Inline category editor for a table cell: a searchable, type-grouped combobox.
 * Because the table opens the detail drawer on row click, the whole control
 * stops click propagation so editing the category never also opens the drawer.
 * A needs-review row gets the warning surface, matching the register's existing
 * needs-review treatment.
 */
export function InlineCategoryCombobox({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = "Uncategorized",
  needsReview = false,
  className,
  testId = "inline-category",
}: {
  value: string | null;
  options: CategoryOption[];
  onChange: (categoryAccountId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  needsReview?: boolean;
  className?: string;
  /** Override the trigger's data-testid (e.g. a section-specific id). */
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value) ?? null;

  const grouped = useMemo(() => {
    const map = new Map<string, CategoryOption[]>();
    for (const option of options) {
      const key = option.type ?? "other";
      const list = map.get(key) ?? [];
      list.push(option);
      map.set(key, list);
    }
    return [...map.entries()].sort(
      (a, b) => TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0]),
    );
  }, [options]);

  return (
    <span onClick={(event) => event.stopPropagation()} className={cn("inline-flex max-w-full", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            data-testid={testId}
            className={cn(
              "h-8 w-full min-w-0 max-w-[14rem] justify-between font-normal",
              needsReview && "bg-warning-surface text-warning",
              !selected && !needsReview && "text-muted-foreground",
            )}
          >
            <span className="truncate">{selected?.label ?? placeholder}</span>
            <ChevronsUpDown data-icon="inline-end" className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          <Command>
            <CommandInput placeholder="Search categories" />
            <CommandList>
              <CommandEmpty>No categories found.</CommandEmpty>
              {grouped.map(([type, items]) => (
                <CommandGroup key={type} heading={TYPE_LABEL[type] ?? "Other"}>
                  {items.map((option) => (
                    <CommandItem
                      key={option.id}
                      value={option.label}
                      onSelect={() => {
                        onChange(option.id);
                        setOpen(false);
                      }}
                      className="gap-2"
                    >
                      <Check
                        className={cn("size-4", option.id === value ? "text-primary opacity-100" : "opacity-0")}
                      />
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </span>
  );
}
