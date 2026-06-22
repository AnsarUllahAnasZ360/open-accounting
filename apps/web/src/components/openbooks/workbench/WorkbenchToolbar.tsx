"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ActiveChip } from "./FilterBar";

/**
 * The Mercury-style toolbar shell: saved views + page-scoped filter pills +
 * the group/sort/display/export cluster in one horizontal rail, plus a
 * removable active-filter chip strip below. Global command search lives in the
 * app chrome; this toolbar only carries controls that change the current table.
 */
export function WorkbenchToolbar({
  views,
  pills,
  trailing,
  chips = [],
  onRemoveChip,
  onClearAll,
  className,
}: {
  views?: ReactNode;
  pills?: ReactNode;
  trailing?: ReactNode;
  chips?: ActiveChip[];
  onRemoveChip?: (key: string) => void;
  onClearAll?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {views ? <div className="flex shrink-0 items-center gap-2">{views}</div> : null}
        {pills ? <div className="flex min-w-0 flex-wrap items-center gap-2">{pills}</div> : null}
        {trailing ? <div className="flex min-w-0 flex-wrap items-center gap-2 sm:ml-auto">{trailing}</div> : null}
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <Badge key={chip.key} variant="outline" className="gap-1">
              {chip.label}
              {onRemoveChip ? (
                <button
                  type="button"
                  onClick={() => onRemoveChip(chip.key)}
                  aria-label={`Remove ${chip.label}`}
                  className="-mr-0.5 inline-flex items-center rounded-full outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <X className="size-3" />
                </button>
              ) : null}
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
