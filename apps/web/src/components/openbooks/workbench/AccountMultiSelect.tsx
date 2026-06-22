"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

export type AccountOption = {
  id: string;
  label: string;
  kind?: string;
};

/**
 * Pick one or many accounts / categories to scope a table. A searchable Command
 * list lives in a Popover; multi mode shows a checkbox per row and a count
 * badge on the trigger, single mode closes on pick and shows the chosen label.
 */
export function AccountMultiSelect({
  options,
  value,
  onChange,
  mode = "multi",
  placeholder = "All accounts",
  className,
}: {
  options: AccountOption[];
  value: string[];
  onChange: (value: string[]) => void;
  mode?: "single" | "multi";
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  function toggle(id: string) {
    if (mode === "single") {
      onChange(value.includes(id) ? [] : [id]);
      setOpen(false);
      return;
    }
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  const selectedLabel =
    mode === "single" && value.length > 0
      ? (options.find((o) => o.id === value[0])?.label ?? placeholder)
      : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          className={cn("min-w-0 justify-between", className)}
        >
          <span className="truncate">{selectedLabel}</span>
          {mode === "multi" && value.length > 0 ? (
            <Badge variant="secondary" className="money-figures">
              {value.length}
            </Badge>
          ) : null}
          <ChevronsUpDown data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Search accounts" />
          <CommandList>
            <CommandEmpty>No accounts found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const checked = value.includes(option.id);
                return (
                  <CommandItem
                    key={option.id}
                    value={option.label}
                    onSelect={() => toggle(option.id)}
                    className="gap-2"
                  >
                    {mode === "multi" ? (
                      <Checkbox checked={checked} aria-hidden tabIndex={-1} className="pointer-events-none" />
                    ) : (
                      <Check className={cn("size-4", checked ? "opacity-100" : "opacity-0")} />
                    )}
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.kind ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{option.kind}</span>
                    ) : null}
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
