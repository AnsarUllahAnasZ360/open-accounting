"use client";

import { useMutation, useQuery } from "convex/react";
import { ChevronDown, ChevronUp, GripVertical, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

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

type RuleRow = NonNullable<ReturnType<typeof useRulesList>>["rows"][number];

function useRulesList(entityId: Id<"entities"> | null) {
  return useQuery(api.rules.list, entityId ? { entityId } : "skip");
}

function moneyToMinor(value: string): number | undefined {
  const trimmed = value.trim().replace(/[$,]/g, "");
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

export function RulesSection({ entityId }: { entityId: Id<"entities"> | null }) {
  const data = useRulesList(entityId);
  const reorder = useMutation(api.rules.reorder);
  const setActive = useMutation(api.rules.setActive);
  const removeRule = useMutation(api.rules.remove);
  const approveSuggested = useMutation(api.rules.approveSuggested);
  const dismissSuggested = useMutation(api.rules.dismissSuggested);
  const [editing, setEditing] = useState<RuleRow | "new" | null>(null);
  const [error, setError] = useState("");

  if (!entityId) {
    return <div className="rounded-[14px] border bg-card p-5 text-sm text-muted-foreground shadow-xs">Add a business first.</div>;
  }
  if (data === undefined) {
    return <div className="rounded-[14px] border bg-card p-5 text-sm text-muted-foreground shadow-xs">Loading rules…</div>;
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= data!.rows.length) return;
    const ids = data!.rows.map((row) => row.id as Id<"rules">);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    setError("");
    try {
      await reorder({ entityId: entityId!, orderedIds: ids });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reorder.");
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="rules-section">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-muted-foreground">Rules run top-down, first match wins.</span>
        <Button size="sm" variant="outline" data-testid="rules-new" onClick={() => setEditing("new")}>
          <Plus className="size-4" /> New rule
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {data.pending.map((pending) => (
        <div key={pending.memoryId} className="flex items-center gap-2.5 rounded-[12px] bg-[#f1f8ee] px-4 py-3" data-testid="rules-pending">
          <Sparkles className="size-4 shrink-0 text-[#1d6b12]" />
          <span className="flex-1 text-[13px] text-[#17540f]">{pending.summary}</span>
          <Button
            size="sm"
            data-testid="rules-pending-approve"
            onClick={() => approveSuggested({ memoryId: pending.memoryId as Id<"aiCorrectionMemories"> })}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => dismissSuggested({ memoryId: pending.memoryId as Id<"aiCorrectionMemories"> })}
          >
            Not now
          </Button>
        </div>
      ))}

      <div className="overflow-hidden rounded-[14px] border bg-card shadow-xs">
        {data.rows.length === 0 ? (
          <div className="px-[18px] py-4 text-[12.5px] text-muted-foreground">No rules yet. Create one, or approve an AI suggestion above.</div>
        ) : (
          data.rows.map((rule, index) => (
            <div
              key={rule.id}
              data-testid="rule-row"
              className={cn("flex items-center gap-3 border-t px-[18px] py-3 first:border-t-0", !rule.active && "opacity-50")}
            >
              <div className="flex flex-col">
                <button
                  type="button"
                  data-testid={`rule-up-${index}`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
                  aria-label="Move rule up"
                >
                  <ChevronUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  data-testid={`rule-down-${index}`}
                  disabled={index === data.rows.length - 1}
                  onClick={() => move(index, 1)}
                  className="text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
                  aria-label="Move rule down"
                >
                  <ChevronDown className="size-3.5" />
                </button>
              </div>
              <GripVertical className="size-3.5 shrink-0 text-muted-foreground/40" />
              <span className="money-figures min-w-5 text-[11px] text-muted-foreground/70" data-testid="rule-order">#{rule.order}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{rule.name}</div>
                <div className="text-[11.5px] text-muted-foreground">{rule.summary}</div>
              </div>
              {rule.aiMade ? (
                <span className="inline-flex h-[18px] items-center rounded-full bg-[#f1f8ee] px-1.5 text-[10px] font-medium text-[#1d6b12]">AI-drafted</span>
              ) : null}
              <span className="min-w-[64px] text-right text-[11.5px] text-muted-foreground/70 money-figures">fired {rule.hitCount}×</span>
              <button
                type="button"
                data-testid={`rule-toggle-${index}`}
                onClick={() => setActive({ ruleId: rule.id as Id<"rules">, active: !rule.active })}
                className={cn("relative h-[19px] w-[34px] shrink-0 rounded-full transition-colors", rule.active ? "bg-primary" : "bg-muted-foreground/40")}
                aria-label={`${rule.active ? "Disable" : "Enable"} ${rule.name}`}
              >
                <span className={cn("absolute top-0.5 size-[15px] rounded-full bg-white shadow transition-all", rule.active ? "left-[17px]" : "left-0.5")} />
              </button>
              <button
                type="button"
                data-testid={`rule-edit-${index}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setEditing(rule)}
                aria-label={`Edit ${rule.name}`}
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                data-testid={`rule-delete-${index}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => removeRule({ ruleId: rule.id as Id<"rules"> })}
                aria-label={`Delete ${rule.name}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
      <p className="text-[12px] text-muted-foreground/80">
        Drag (or use the arrows) to reprioritize. Every rule can be tested against your last 90 days before it goes live.
      </p>

      {editing ? (
        <RuleEditor
          entityId={entityId}
          rule={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function RuleEditor({
  entityId,
  rule,
  onClose,
}: {
  entityId: Id<"entities">;
  rule: RuleRow | null;
  onClose: () => void;
}) {
  const categories = useQuery(api.categories.list, { entityId });
  const save = useMutation(api.rules.save);
  const [name, setName] = useState(rule?.name ?? "");
  const [descriptionContains, setDescriptionContains] = useState(rule?.descriptionContains ?? "");
  const [merchantContains, setMerchantContains] = useState(rule?.merchantContains ?? "");
  const [amountMin, setAmountMin] = useState(rule?.amountMinMinor != null ? String(rule.amountMinMinor / 100) : "");
  const [amountMax, setAmountMax] = useState(rule?.amountMaxMinor != null ? String(rule.amountMaxMinor / 100) : "");
  const [direction, setDirection] = useState<"inflow" | "outflow" | "any">(rule?.direction ?? "any");
  const [categoryAccountId, setCategoryAccountId] = useState<string>(rule?.categoryAccountId ?? "");
  const [autoPost, setAutoPost] = useState(rule?.autoPost ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const categoryOptions = useMemo(() => {
    if (!categories) return [];
    return categories.groups
      .filter((group) => group.label !== "Other")
      .flatMap((group) => group.cats.map((cat) => ({ id: cat.id, label: `${cat.name} (${group.label})` })));
  }, [categories]);

  const effectiveCategory = categoryAccountId || categoryOptions[0]?.id || "";

  // Live 90-day preview of the current conditions.
  const preview = useQuery(
    api.rules.preview,
    merchantContains.trim() || descriptionContains.trim() || amountMin.trim() || amountMax.trim()
      ? {
          entityId,
          merchantContains: merchantContains.trim() || undefined,
          descriptionContains: descriptionContains.trim() || undefined,
          amountMinMinor: moneyToMinor(amountMin),
          amountMaxMinor: moneyToMinor(amountMax),
          direction,
          days: 90,
        }
      : "skip",
  );

  async function submit() {
    if (!name.trim()) {
      setError("Name the rule.");
      return;
    }
    if (!effectiveCategory) {
      setError("Pick a category.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await save({
        entityId,
        ruleId: (rule?.id as Id<"rules">) ?? undefined,
        name: name.trim(),
        merchantContains: merchantContains.trim() || undefined,
        descriptionContains: descriptionContains.trim() || undefined,
        amountMinMinor: moneyToMinor(amountMin),
        amountMaxMinor: moneyToMinor(amountMax),
        direction,
        categoryAccountId: effectiveCategory as Id<"ledgerAccounts">,
        autoPost,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the rule.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="rule-editor">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit rule" : "New rule"}</DialogTitle>
          <DialogDescription>Match on description, merchant, amount, and direction (combined with AND). First match wins.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2">
            <Label>Rule name</Label>
            <Input data-testid="rule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="AWS → Cloud" />
          </div>
          <div className="rounded-[12px] border p-3">
            <div className="mb-2 text-[12px] font-medium text-muted-foreground">When ALL of these are true</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-[12px]">Description contains</Label>
                <Input data-testid="rule-description" value={descriptionContains} onChange={(e) => setDescriptionContains(e.target.value)} placeholder="AWS" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-[12px]">Merchant contains</Label>
                <Input data-testid="rule-merchant" value={merchantContains} onChange={(e) => setMerchantContains(e.target.value)} placeholder="Amazon Web Services" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-[12px]">Amount ≥</Label>
                <Input data-testid="rule-amount-min" inputMode="decimal" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} placeholder="0.00" className="money-figures" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-[12px]">Amount ≤</Label>
                <Input data-testid="rule-amount-max" inputMode="decimal" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} placeholder="—" className="money-figures" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-[12px]">Direction</Label>
                <Select value={direction} onValueChange={(v) => setDirection(v as typeof direction)}>
                  <SelectTrigger data-testid="rule-direction" className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    <SelectItem value="outflow">Money out</SelectItem>
                    <SelectItem value="inflow">Money in</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Then categorize as</Label>
            <Select value={effectiveCategory} onValueChange={setCategoryAccountId}>
              <SelectTrigger data-testid="rule-category" className="w-full">
                <SelectValue placeholder="Pick a category" />
              </SelectTrigger>
              <SelectContent>
                {categoryOptions.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" data-testid="rule-autopost" checked={autoPost} onChange={(e) => setAutoPost(e.target.checked)} className="size-4 accent-[#2ca01c]" />
            Auto-post when this rule matches (otherwise send to Inbox)
          </label>

          <div className="rounded-[12px] border bg-muted/30 p-3" data-testid="rule-preview">
            <div className="text-[12px] font-medium">Test against your last 90 days</div>
            {preview === undefined ? (
              <p className="mt-1 text-[12px] text-muted-foreground">Add a condition to preview matches.</p>
            ) : (
              <>
                <p className="mt-1 text-[12.5px]" data-testid="rule-preview-count">
                  <span className="money-figures font-semibold">{preview.matchCount}</span> of {preview.scannedCount} transactions would match.
                </p>
                <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                  {preview.sample.map((txn) => (
                    <div key={txn.id} className="flex items-center justify-between gap-2 text-[11.5px]">
                      <span className="truncate text-muted-foreground">{txn.date} · {txn.merchant}</span>
                      <Amount amountMinor={txn.amountMinor} currency={txn.currency} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" data-testid="rule-save" disabled={busy} onClick={submit}>
            {busy ? "Saving…" : rule ? "Save rule" : "Create rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
