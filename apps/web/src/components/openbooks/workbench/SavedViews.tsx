"use client";

import { Bookmark, Check, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SavedViewSummary = { id: string; name: string; builtIn?: boolean };

/**
 * Mercury-style "Data views" dropdown. Presentational: the screen owns the view
 * list and persistence (see useSavedViews). Selecting a view applies its saved
 * filters; "Create view" snapshots the current filters; an edited user view can
 * be updated in place.
 */
export function SavedViews({
  views,
  activeViewId,
  dirty = false,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
  allLabel = "All transactions",
}: {
  views: SavedViewSummary[];
  activeViewId: string | null;
  dirty?: boolean;
  onSelect: (id: string | null) => void;
  onCreate?: (name: string) => void;
  onUpdate?: (id: string) => void;
  onDelete?: (id: string) => void;
  allLabel?: string;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const active = views.find((view) => view.id === activeViewId) ?? null;
  const activeUserView = active && !active.builtIn ? active : null;

  function submitCreate() {
    const name = draftName.trim();
    if (!name) return;
    onCreate?.(name);
    setDraftName("");
    setDialogOpen(false);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="w-fit" data-testid="saved-views-trigger">
            <Bookmark data-icon="inline-start" />
            <span className="truncate">{active?.name ?? allLabel}</span>
            {dirty ? <span className="text-xs font-normal text-muted-foreground">· Edited</span> : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Data views</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => onSelect(null)}>
              <Check className={cn(activeViewId == null ? "text-primary opacity-100" : "opacity-0")} />
              {allLabel}
            </DropdownMenuItem>
            {views.map((view) => (
              <DropdownMenuItem key={view.id} onClick={() => onSelect(view.id)} className="group/view gap-2">
                <Check className={cn(view.id === activeViewId ? "text-primary opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1 truncate">{view.name}</span>
                {!view.builtIn && onDelete ? (
                  <button
                    type="button"
                    aria-label={`Delete ${view.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(view.id);
                    }}
                    className="inline-flex items-center rounded opacity-0 outline-none hover:text-foreground group-hover/view:opacity-100"
                  >
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </button>
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {activeUserView && dirty && onUpdate ? (
              <DropdownMenuItem onClick={() => onUpdate(activeUserView.id)}>
                <Save />
                Update &ldquo;{activeUserView.name}&rdquo;
              </DropdownMenuItem>
            ) : null}
            {onCreate ? (
              <DropdownMenuItem onClick={() => setDialogOpen(true)}>
                <Plus />
                Create view
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create data view</DialogTitle>
            <DialogDescription>Save the current filters as a reusable view.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="saved-view-name">View name</FieldLabel>
            <Input
              id="saved-view-name"
              value={draftName}
              placeholder="e.g. Monthly money in"
              autoFocus
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitCreate();
                }
              }}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={!draftName.trim()}>
              Create view
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
