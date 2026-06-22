"use client";

import { Download, FileUp, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type ExportChoice = { label: string; onSelect: () => void };

/** A section-specific extra add affordance folded INTO the single "+" menu so
 * every section has exactly one add entry point (E5.3) — e.g. "Upload bill PDF"
 * on Bills, "Add category" on Expenses. */
export type AddMenuExtraItem = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  testId?: string;
  disabled?: boolean;
};

/**
 * The single "+" entry point that replaces the row of Add / Import / Export
 * buttons. Each item opens its own surface (Add and Import are dialogs the page
 * owns; Export is a submenu of formats). The trigger is the page's primary green
 * action; everything else on the toolbar's right is a quiet icon.
 */
export function AddMenu({
  onAddTransaction,
  onImport,
  exportChoices = [],
  extraItems = [],
  align = "end",
  addLabel = "Add transaction",
  importLabel = "Import transactions",
  addTestId,
}: {
  onAddTransaction?: () => void;
  onImport?: () => void;
  exportChoices?: ExportChoice[];
  /** Extra section-specific add items folded into this single "+" menu (E5.3). */
  extraItems?: AddMenuExtraItem[];
  align?: "start" | "center" | "end";
  /** Section-specific primary-add label (e.g. "New invoice"). */
  addLabel?: string;
  /** Section-specific import label. */
  importLabel?: string;
  /** Override the data-testid on the primary add item. */
  addTestId?: string;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" aria-label="Add, import or export" data-testid="add-menu-trigger">
              <Plus />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Add · Import · Export</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align={align} className="w-52">
        <DropdownMenuGroup>
          {onAddTransaction ? (
            <DropdownMenuItem
              onClick={onAddTransaction}
              data-testid={addTestId ?? "add-menu-add-transaction"}
            >
              <Plus />
              {addLabel}
            </DropdownMenuItem>
          ) : null}
          {extraItems.map((item) => (
            <DropdownMenuItem
              key={item.label}
              onClick={item.onSelect}
              disabled={item.disabled}
              data-testid={item.testId}
            >
              {item.icon ?? <Plus />}
              {item.label}
            </DropdownMenuItem>
          ))}
          {onImport ? (
            <DropdownMenuItem onClick={onImport} data-testid="add-menu-import">
              <FileUp />
              {importLabel}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        {exportChoices.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Download />
                Export
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {exportChoices.map((choice) => (
                  <DropdownMenuItem key={choice.label} onClick={choice.onSelect}>
                    {choice.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
