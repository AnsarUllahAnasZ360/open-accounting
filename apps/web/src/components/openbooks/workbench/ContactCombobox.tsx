"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

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

export type ContactOption = { id: string; name: string };

/**
 * Searchable customer/vendor picker for linking a contact to a transaction —
 * the manual fallback when AI/auto-matching didn't attach one. Includes a "No
 * contact" choice to clear the link. Mirrors InlineCategoryCombobox so the two
 * controls read the same across the app; stops click propagation so using it
 * inside a clickable table row never also opens the detail drawer.
 */
export function ContactCombobox({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = "No contact",
  className,
  testId = "contact-combobox",
}: {
  value: string | null;
  options: ContactOption[];
  onChange: (contactId: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value) ?? null;

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
              "h-8 w-full min-w-0 justify-between font-normal",
              !selected && "text-muted-foreground",
            )}
          >
            <span className="truncate">{selected?.name ?? placeholder}</span>
            <ChevronsUpDown data-icon="inline-end" className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          <Command>
            <CommandInput placeholder="Search contacts" />
            <CommandList>
              <CommandEmpty>No contacts found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="__none__"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <Check className={cn("size-4", value == null ? "text-primary opacity-100" : "opacity-0")} />
                  <span className="text-muted-foreground">No contact</span>
                </CommandItem>
                {options.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={option.name}
                    onSelect={() => {
                      onChange(option.id);
                      setOpen(false);
                    }}
                    className="gap-2"
                  >
                    <Check
                      className={cn("size-4", option.id === value ? "text-primary opacity-100" : "opacity-0")}
                    />
                    <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </span>
  );
}
