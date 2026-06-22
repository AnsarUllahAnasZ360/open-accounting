"use client";

import { Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type DisplaySettings = {
  density: "comfortable" | "compact";
  /** Column keys hidden by the user. */
  hiddenColumns: string[];
  timezone?: string;
};

/**
 * The display gear (Mercury's slider menu): switch row density and show/hide
 * columns. Column visibility is applied by the screen (it filters its own
 * column list), so this control stays presentational.
 */
export function DisplaySettingsMenu({
  value,
  onChange,
  columns,
}: {
  value: DisplaySettings;
  onChange: (next: DisplaySettings) => void;
  columns: { key: string; label: string; canHide?: boolean }[];
}) {
  const hideable = columns.filter((column) => column.canHide !== false);

  function toggleColumn(key: string, visible: boolean) {
    const hidden = new Set(value.hiddenColumns);
    if (visible) hidden.delete(key);
    else hidden.add(key);
    onChange({ ...value, hiddenColumns: [...hidden] });
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="Display settings">
              <Settings2 />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Display options</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Density</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value.density}
          onValueChange={(next) => onChange({ ...value, density: next as DisplaySettings["density"] })}
        >
          <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {hideable.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Columns</DropdownMenuLabel>
            {hideable.map((column) => (
              <DropdownMenuCheckboxItem
                key={column.key}
                checked={!value.hiddenColumns.includes(column.key)}
                onCheckedChange={(checked) => toggleColumn(column.key, Boolean(checked))}
                onSelect={(event) => event.preventDefault()}
              >
                {column.label}
              </DropdownMenuCheckboxItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
