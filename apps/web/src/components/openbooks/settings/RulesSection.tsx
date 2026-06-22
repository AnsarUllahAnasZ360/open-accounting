"use client";

import { useMutation, useQuery } from "convex/react";
import { ChevronDown, ChevronUp, GripVertical, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { Amount } from "@/components/openbooks/primitives";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
        <div key={pending.memoryId} className="flex items-center gap-2.5 rounded-[12px] bg-ai-surface px-4 py-3" data-testid="rules-pending">
          <Sparkles className="size-4 shrink-0 text-ai" />
          <span className="flex-1 text-[13px] text-ob-green-800">{pending.summary}</span>
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
              className={cn(
                // Mobile: stack to two lines so the name/summary keep usable width
                // instead of compressing to zero against a strip of fixed controls.
                // sm+: a single horizontal row, the original control strip.
                "group/rule flex flex-col gap-2 border-t px-[18px] py-3 transition-colors first:border-t-0 hover:bg-muted/30 sm:flex-row sm:items-center sm:gap-3",
                !rule.active && "opacity-50",
              )}
            >
              {/* Line 1 (mobile): reorder/grip/order + name + Switch + edit/delete.
                  On sm+ this unwraps into the row and the name block flexes. */}
              <div className="flex items-center gap-3 sm:contents">
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
                  {/* Summary rides under the name on sm+ only; on mobile it drops to
                      line 2 (below) so it keeps full width. */}
                  <div className="hidden text-[11.5px] text-muted-foreground sm:block">{rule.summary}</div>
                </div>
                {rule.aiMade ? (
                  <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-ai-surface px-1.5 text-[10px] font-medium text-ai">AI-drafted</span>
                ) : null}
                <span className="hidden min-w-[64px] text-right text-[11.5px] text-muted-foreground/70 money-figures sm:inline">fired {rule.hitCount}×</span>
                <Switch
                  data-testid={`rule-toggle-${index}`}
                  checked={rule.active}
                  onCheckedChange={(next) => setActive({ ruleId: rule.id as Id<"rules">, active: next })}
                  aria-label={`${rule.active ? "Disable" : "Enable"} ${rule.name}`}
                />
                {/* Edit/delete live in a quiet cluster that reveals on row hover or
                    keyboard focus on sm+, so the row reads as one rule rather than a
                    strip of nine controls. On mobile it stays visible (no hover), so
                    touch users can reach edit/delete. Always in the DOM so keyboard
                    and automation reach them. */}
                <div className="flex items-center gap-1 transition-opacity sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover/rule:opacity-100">
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
                    className="text-muted-foreground hover:text-negative"
                    onClick={() => removeRule({ ruleId: rule.id as Id<"rules"> })}
                    aria-label={`Delete ${rule.name}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>

              {/* Line 2 (mobile only): summary + 'fired N×' meta on their own row so
                  they keep full width instead of fighting the control strip. */}
              <div className="flex items-center justify-between gap-3 pl-[26px] sm:hidden">
                <span className="min-w-0 flex-1 text-[11.5px] text-muted-foreground">{rule.summary}</span>
                <span className="money-figures shrink-0 text-[11.5px] text-muted-foreground/70">fired {rule.hitCount}×</span>
              </div>
            </div>
          ))
        )}
      </div>
      <p className="text-[12px] text-muted-foreground/80">
        Drag (or use the arrows) to reprioritize. Every rule can be tested against your last 90 days before it goes live.
      </p>

      <TestAllRules entityId={entityId} hasRules={data.rows.length > 0} />

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

/**
 * "Test all active rules" runner (Epic E12-T4): on demand, evaluates every
 * active rule against the last 90 days and shows per-rule match counts plus a
 * matched/unmatched summary. First-match-wins, so counts don't double-count.
 */
function TestAllRules({ entityId, hasRules }: { entityId: Id<"entities">; hasRules: boolean }) {
  const [show, setShow] = useState(false);
  const result = useQuery(api.rules.previewAll, show ? { entityId, days: 90 } : "skip");

  return (
    <div className="rounded-[14px] border bg-card p-4 shadow-xs" data-testid="rules-test-all">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[13px] font-medium">Test all active rules</div>
          <div className="text-[11.5px] text-muted-foreground">See how each active rule would have fired over the last 90 days.</div>
        </div>
        <Button
          size="sm"
          variant="outline"
          data-testid="rules-test-all-run"
          disabled={!hasRules}
          onClick={() => setShow(true)}
        >
          Run test
        </Button>
      </div>
      {show ? (
        result === undefined ? (
          <p className="mt-3 text-[12px] text-muted-foreground">Testing against your last 90 days…</p>
        ) : (
          <div className="mt-3" data-testid="rules-test-all-result">
            <p className="text-[12.5px]">
              <span className="money-figures font-semibold">{result.matchedCount}</span> of {result.scannedCount} transactions
              would be touched by your {result.rules.length} active rule{result.rules.length === 1 ? "" : "s"};{" "}
              <span className="money-figures">{result.unmatchedCount}</span> would fall through to the Inbox.
            </p>
            <div className="mt-2 divide-y rounded-[10px] border">
              {result.rules.length === 0 ? (
                <div className="px-3 py-2 text-[12px] text-muted-foreground">No active rules to test.</div>
              ) : (
                result.rules.map((rule) => (
                  <div key={rule.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="money-figures text-muted-foreground/70">#{rule.order}</span> {rule.name}
                    </span>
                    <span className="money-figures shrink-0 text-muted-foreground" data-testid={`rules-test-count-${rule.id}`}>
                      {rule.matchCount} match{rule.matchCount === 1 ? "" : "es"}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

type ConditionGroupForm = {
  descriptionContains: string;
  merchantContains: string;
  amountMin: string;
  amountMax: string;
  direction: "inflow" | "outflow" | "any";
};

function emptyGroup(): ConditionGroupForm {
  return { descriptionContains: "", merchantContains: "", amountMin: "", amountMax: "", direction: "any" };
}

function groupHasInput(group: ConditionGroupForm) {
  return Boolean(
    group.descriptionContains.trim() ||
      group.merchantContains.trim() ||
      group.amountMin.trim() ||
      group.amountMax.trim() ||
      group.direction !== "any",
  );
}

// Seed the editor's groups from a rule row (read shim already surfaced grouped
// form), or one empty group for a new rule.
function initialGroups(rule: RuleRow | null): ConditionGroupForm[] {
  if (!rule || !rule.conditionGroups || rule.conditionGroups.length === 0) {
    if (!rule) return [emptyGroup()];
    return [
      {
        descriptionContains: rule.descriptionContains ?? "",
        merchantContains: rule.merchantContains ?? "",
        amountMin: rule.amountMinMinor != null ? String(rule.amountMinMinor / 100) : "",
        amountMax: rule.amountMaxMinor != null ? String(rule.amountMaxMinor / 100) : "",
        direction: rule.direction ?? "any",
      },
    ];
  }
  return rule.conditionGroups.map((group) => ({
    descriptionContains: group.descriptionContains ?? "",
    merchantContains: group.merchantContains ?? "",
    amountMin: group.amountMinMinor != null ? String(group.amountMinMinor / 100) : "",
    amountMax: group.amountMaxMinor != null ? String(group.amountMaxMinor / 100) : "",
    direction: group.direction ?? "any",
  }));
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
  const [groups, setGroups] = useState<ConditionGroupForm[]>(() => initialGroups(rule));
  const [categoryAccountId, setCategoryAccountId] = useState<string>(rule?.categoryAccountId ?? "");
  const [autoPost, setAutoPost] = useState(rule?.autoPost ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function updateGroup(index: number, patch: Partial<ConditionGroupForm>) {
    setGroups((prev) => prev.map((group, i) => (i === index ? { ...group, ...patch } : group)));
  }
  function addGroup() {
    setGroups((prev) => [...prev, emptyGroup()]);
  }
  function removeGroup(index: number) {
    setGroups((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  const categoryOptions = useMemo(() => {
    if (!categories) return [];
    return categories.groups
      .filter((group) => group.label !== "Other")
      .flatMap((group) => group.cats.map((cat) => ({ id: cat.id, label: `${cat.name} (${group.label})` })));
  }, [categories]);

  const effectiveCategory = categoryAccountId || categoryOptions[0]?.id || "";

  // Condition groups serialized for the preview/save calls. Empty groups drop.
  const serializedGroups = useMemo(
    () =>
      groups
        .filter(groupHasInput)
        .map((group) => ({
          descriptionContains: group.descriptionContains.trim() || undefined,
          merchantContains: group.merchantContains.trim() || undefined,
          amountMinMinor: moneyToMinor(group.amountMin),
          amountMaxMinor: moneyToMinor(group.amountMax),
          direction: group.direction,
        })),
    [groups],
  );

  // Live 90-day preview of the current condition groups (OR-of-groups).
  const preview = useQuery(
    api.rules.preview,
    serializedGroups.length
      ? {
          entityId,
          // direction kept for back-compat arg shape; groups are authoritative.
          direction: "any" as const,
          conditionGroups: serializedGroups,
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
    if (serializedGroups.length === 0) {
      setError("Add at least one condition.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await save({
        entityId,
        ruleId: (rule?.id as Id<"rules">) ?? undefined,
        name: name.trim(),
        direction: "any",
        conditionGroups: serializedGroups,
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
      <DialogContent data-testid="rule-editor" className="max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit rule" : "New rule"}</DialogTitle>
          <DialogDescription>Match on description, merchant, amount, and direction. Conditions in a group are AND&apos;d; groups are OR&apos;d. First match wins.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2">
            <Label>Rule name</Label>
            <Input data-testid="rule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="AWS → Cloud" />
          </div>

          {groups.map((group, index) => (
            <div key={index} className="rounded-[12px] border p-3" data-testid={`rule-group-${index}`}>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[12px] font-medium text-muted-foreground">
                  {index === 0 ? "When ALL of these are true" : "OR when ALL of these are true"}
                </div>
                {groups.length > 1 ? (
                  <button
                    type="button"
                    data-testid={`rule-group-remove-${index}`}
                    className="text-muted-foreground hover:text-negative"
                    onClick={() => removeGroup(index)}
                    aria-label={`Remove condition group ${index + 1}`}
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label className="text-[12px]">Description contains</Label>
                  {/* The first group keeps the un-indexed testids for back-compat
                      with the existing rule e2e helpers; later groups are indexed. */}
                  <Input data-testid={index === 0 ? "rule-description" : `rule-description-${index}`} value={group.descriptionContains} onChange={(e) => updateGroup(index, { descriptionContains: e.target.value })} placeholder="AWS" />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-[12px]">Merchant contains</Label>
                  <Input data-testid={index === 0 ? "rule-merchant" : `rule-merchant-${index}`} value={group.merchantContains} onChange={(e) => updateGroup(index, { merchantContains: e.target.value })} placeholder="Amazon Web Services" />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-[12px]">Amount ≥</Label>
                  <Input data-testid={index === 0 ? "rule-amount-min" : `rule-amount-min-${index}`} inputMode="decimal" value={group.amountMin} onChange={(e) => updateGroup(index, { amountMin: e.target.value })} placeholder="0.00" className="money-figures" />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-[12px]">Amount ≤</Label>
                  <Input data-testid={index === 0 ? "rule-amount-max" : `rule-amount-max-${index}`} inputMode="decimal" value={group.amountMax} onChange={(e) => updateGroup(index, { amountMax: e.target.value })} placeholder="—" className="money-figures" />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-[12px]">Direction</Label>
                  <Select value={group.direction} onValueChange={(v) => updateGroup(index, { direction: v as ConditionGroupForm["direction"] })}>
                    <SelectTrigger data-testid={index === 0 ? "rule-direction" : `rule-direction-${index}`} className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="any">Any</SelectItem>
                        <SelectItem value="outflow">Money out</SelectItem>
                        <SelectItem value="inflow">Money in</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          ))}

          <Button size="sm" variant="outline" data-testid="rule-add-group" onClick={addGroup}>
            <Plus className="size-4" /> Add condition group (OR)
          </Button>

          <div className="grid gap-2">
            <Label>Then categorize as</Label>
            <Select value={effectiveCategory} onValueChange={setCategoryAccountId}>
              <SelectTrigger data-testid="rule-category" className="w-full">
                <SelectValue placeholder="Pick a category" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {categoryOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <Field orientation="horizontal">
            <Checkbox
              id="rule-autopost"
              data-testid="rule-autopost"
              checked={autoPost}
              onCheckedChange={(checked) => setAutoPost(checked === true)}
            />
            <FieldLabel htmlFor="rule-autopost" className="font-normal">
              Auto-post when this rule matches (otherwise send to Inbox)
            </FieldLabel>
          </Field>

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
