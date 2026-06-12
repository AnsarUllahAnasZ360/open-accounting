"use client";

import { useMutation, useQuery } from "convex/react";
import { Archive, Check, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { Amount } from "@/components/openbooks/primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const GROUP_DOT: Record<string, string> = {
  Income: "#2ca01c",
  Expenses: "#a3a3a3",
  Other: "#d4d4d4",
};

export function CategoriesSection({ entityId }: { entityId: Id<"entities"> | null }) {
  const data = useQuery(api.categories.list, entityId ? { entityId } : "skip");
  const rename = useMutation(api.categories.rename);
  const setArchived = useMutation(api.categories.setArchived);
  const [acctMode, setAcctMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState("");

  if (!entityId) {
    return <div className="rounded-[14px] border bg-card p-5 text-sm text-muted-foreground shadow-xs">Add a business first.</div>;
  }
  if (data === undefined) {
    return <div className="rounded-[14px] border bg-card p-5 text-sm text-muted-foreground shadow-xs">Loading categories…</div>;
  }

  async function commitRename(id: Id<"ledgerAccounts">) {
    if (!editName.trim()) {
      setEditingId(null);
      return;
    }
    setError("");
    try {
      await rename({ accountId: id, name: editName.trim() });
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename.");
    }
  }

  async function archive(id: Id<"ledgerAccounts">) {
    setError("");
    try {
      await setArchived({ accountId: id, archived: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive.");
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="categories-section">
      <div className="flex items-center gap-3">
        <span className="text-[13px] text-muted-foreground">Categories are your chart of accounts wearing plain clothes.</span>
        <div className="flex-1" />
        <AddCategoryModal entityId={entityId} />
        <label className="flex cursor-pointer select-none items-center gap-2 text-[12.5px] text-[#525252]">
          Accountant mode
          <button
            type="button"
            data-testid="categories-accountant-mode"
            data-active={acctMode ? "true" : "false"}
            onClick={() => setAcctMode((v) => !v)}
            className={cn("relative h-[19px] w-[34px] rounded-full transition-colors", acctMode ? "bg-primary" : "bg-muted-foreground/40")}
          >
            <span className={cn("absolute top-0.5 size-[15px] rounded-full bg-white shadow transition-all", acctMode ? "left-[17px]" : "left-0.5")} />
          </button>
        </label>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {data.groups.map((group) => (
        <div key={group.label} className="overflow-hidden rounded-[14px] border bg-card shadow-xs">
          <div className="bg-muted/60 px-[18px] py-2.5 text-[12px] font-semibold text-muted-foreground">{group.label}</div>
          {group.cats.length === 0 ? (
            <div className="px-[18px] py-3 text-[12.5px] text-muted-foreground">No categories in this group.</div>
          ) : (
            group.cats.map((cat) => (
              <div
                key={cat.id}
                data-testid="category-row"
                className="flex items-center gap-2.5 border-t px-[18px] py-2.5 first:border-t-0"
              >
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: GROUP_DOT[group.label] }} />
                {editingId === cat.id ? (
                  <Input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => commitRename(cat.id as Id<"ledgerAccounts">)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(cat.id as Id<"ledgerAccounts">);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="h-7 max-w-[260px] flex-1 text-[13px]"
                    data-testid="category-rename-input"
                  />
                ) : (
                  <span className="flex-1 text-[13px]">{cat.name}</span>
                )}
                {acctMode ? (
                  <span className="font-mono text-[11px] text-muted-foreground/70">
                    {cat.number} · {cat.type}
                    {cat.isSystem ? " · system" : ""}
                  </span>
                ) : null}
                <span className="money-figures text-[12px] text-muted-foreground">
                  <Amount amountMinor={cat.ytdMinor} currency={data.currency} />
                </span>
                {!cat.isSystem ? (
                  <div className="flex items-center gap-1">
                    {editingId === cat.id ? (
                      <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setEditingId(null)} aria-label="Cancel rename">
                        <X className="size-3.5" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-testid={`category-rename-${cat.number}`}
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setEditingId(cat.id);
                          setEditName(cat.name);
                        }}
                        aria-label={`Rename ${cat.name}`}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid={`category-archive-${cat.number}`}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => archive(cat.id as Id<"ledgerAccounts">)}
                      aria-label={`Archive ${cat.name}`}
                    >
                      <Archive className="size-3.5" />
                    </button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  );
}

function AddCategoryModal({ entityId }: { entityId: Id<"entities"> }) {
  const createCategory = useMutation(api.categories.createCategory);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [group, setGroup] = useState<"Expenses" | "Income" | "Other">("Expenses");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit() {
    if (!name.trim()) {
      setError("Name the category.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createCategory({ entityId, name: name.trim(), group });
      setDone(true);
      setTimeout(() => {
        setOpen(false);
        setName("");
        setDone(false);
      }, 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the category.");
    } finally {
      setBusy(false);
    }
  }

  const band = group === "Income" ? "4xxx under Income" : group === "Other" ? "6xxx under Other" : "6xxx under Expenses";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid="categories-add">
          <Plus className="size-4" /> Add category
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="add-category-modal">
        <DialogHeader>
          <DialogTitle>Add a category</DialogTitle>
          <DialogDescription>Creates a real ledger account, usable immediately for recategorizing and rules.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2">
            <Label>Name</Label>
            <Input data-testid="add-category-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Subscriptions" />
          </div>
          <div className="grid gap-2">
            <Label>Group</Label>
            <Select value={group} onValueChange={(v) => setGroup(v as typeof group)}>
              <SelectTrigger data-testid="add-category-group" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Expenses">Expenses</SelectItem>
                <SelectItem value="Income">Income</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11.5px] text-muted-foreground">Creates account {band} — visible in accountant mode.</p>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" data-testid="add-category-submit" disabled={busy} onClick={submit}>
            {done ? <Check className="size-4" /> : busy ? "Adding…" : "Add category"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
