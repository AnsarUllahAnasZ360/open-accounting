"use client";

import { ChevronDown, Plus, Search, Tag, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";

/**
 * Keyword editor: type a term and press Enter to add it, or pick from "Recent"
 * (merchant / recipient names the page supplies). Selected terms show as
 * removable chips and match as an OR set. Mounted both as a pill and inside the
 * mega Filters panel.
 */
export function KeywordFilter({
  value,
  onChange,
  recent = [],
  placeholder = "Search merchants, recipients…",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  recent?: string[];
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function add(term: string) {
    const trimmed = term.trim();
    if (!trimmed || value.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...value, trimmed]);
    setDraft("");
  }

  function remove(term: string) {
    onChange(value.filter((t) => t !== term));
  }

  const lowerDraft = draft.trim().toLowerCase();
  const suggestions = recent
    .filter((name) => !value.includes(name) && name.toLowerCase().includes(lowerDraft))
    .slice(0, 8);
  const canAddRaw = draft.trim().length > 0 && !suggestions.some((s) => s.toLowerCase() === lowerDraft);

  return (
    <div className="flex flex-col gap-2">
      <InputGroup className="h-8">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add(draft);
            }
          }}
        />
      </InputGroup>

      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((term) => (
            <Badge key={term} variant="secondary" className="gap-1">
              <span className="truncate">{term}</span>
              <button
                type="button"
                onClick={() => remove(term)}
                aria-label={`Remove ${term}`}
                className="-mr-0.5 inline-flex items-center rounded-full outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

      {canAddRaw ? (
        <button
          type="button"
          onClick={() => add(draft)}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
        >
          <Plus className="size-3.5 text-muted-foreground" />
          Add &ldquo;{draft.trim()}&rdquo;
        </button>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <span className="px-2 text-xs font-medium text-muted-foreground">Recent</span>
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => add(name)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <Plus className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 truncate">{name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The standalone toolbar pill wrapping {@link KeywordFilter} in a popover. */
export function KeywordFilterPill({
  value,
  onChange,
  recent,
  align = "start",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  recent?: string[];
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const active = value.length > 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={active ? "secondary" : "outline"} size="sm" className="w-fit">
          <Tag data-icon="inline-start" />
          Keyword
          {active ? (
            <Badge variant="outline" className="money-figures">
              {value.length}
            </Badge>
          ) : null}
          <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className={cn("w-72")}>
        <KeywordFilter value={value} onChange={onChange} recent={recent} />
      </PopoverContent>
    </Popover>
  );
}
