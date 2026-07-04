"use client";

import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Check,
  Layers,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Amount, EmptyState } from "@/components/openbooks/primitives";
import { StreamSplitEditor } from "@/components/openbooks/StreamSplitEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getErrorMessage } from "@/lib/errors";
import { useActiveEntity } from "@/lib/openbooks/active-entity";
import { cn } from "@/lib/utils";

const SECTION = "revenue-streams";
const MANAGE_ROLES = new Set(["owner", "admin", "accountant"]);

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

type Period = "month" | "quarter" | "year";

function periodRange(period: Period): { startDate: string; endDate: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (period === "year") {
    return { startDate: `${y}-01-01`, endDate: `${y}-12-31` };
  }
  if (period === "quarter") {
    const qStart = Math.floor(m / 3) * 3;
    return { startDate: isoDate(new Date(Date.UTC(y, qStart, 1))), endDate: isoDate(new Date(Date.UTC(y, qStart + 3, 0))) };
  }
  return { startDate: isoDate(new Date(Date.UTC(y, m, 1))), endDate: isoDate(new Date(Date.UTC(y, m + 1, 0))) };
}

export function RevenueStreamsScreen({ subsection }: { subsection?: string }) {
  const { activeEntity, scope, role } = useActiveEntity();
  const canManage = MANAGE_ROLES.has((role ?? "").toLowerCase());
  const entityId = activeEntity.id as Id<"entities"> | undefined;

  if (scope === "all" || !entityId) {
    return (
      <div className="flex flex-col gap-4">
        <PageTitle />
        <EmptyState
          icon={Layers}
          title="Pick a business"
          description="Revenue streams are per-business. Choose a single business from the switcher to view its streams."
        />
      </div>
    );
  }

  // Member/HR can only reach Insights; Manage / Needs Review are manage-only.
  const tab = subsection ?? SECTION;
  const effectiveTab = !canManage && (tab === "needs-review" || tab === "manage") ? SECTION : tab;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle />
      {effectiveTab === "needs-review" ? (
        <NeedsReviewSurface entityId={entityId} />
      ) : effectiveTab === "manage" ? (
        <ManageSurface entityId={entityId} />
      ) : (
        <InsightsSurface entityId={entityId} />
      )}
    </div>
  );
}

function PageTitle() {
  return (
    <div className="flex items-center gap-2">
      <Layers className="size-5 text-primary" />
      <h1 className="text-lg font-semibold">Revenue Streams</h1>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Insights — detailed per-stream income & profit
// ---------------------------------------------------------------------------

function InsightsSurface({ entityId }: { entityId: Id<"entities"> }) {
  const [period, setPeriod] = useState<Period>("month");
  const range = useMemo(() => periodRange(period), [period]);
  const data = useQuery(api.streamViews.streamPnl, { entityId, ...range });

  if (data === undefined) {
    return <Card><p className="text-sm text-muted-foreground">Loading insights…</p></Card>;
  }

  const totalRevenue = data.totals.revenueMinor;
  const totalCost = data.totals.directCostMinor + data.unallocatedCostMinor;
  const netIncome = data.totals.netIncomeMinor;
  const marginPct = totalRevenue > 0 ? Math.round((netIncome / totalRevenue) * 100) : null;
  const maxRevenue = Math.max(1, ...data.streams.map((s) => Math.abs(s.revenueMinor)));
  const byRevenue = [...data.streams].sort((a, b) => b.revenueMinor - a.revenueMinor);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PeriodPicker period={period} onChange={setPeriod} />
        {data.untaggedRevenueMinor > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-surface px-2.5 py-1 text-[12px] font-medium text-warning">
            <AlertTriangle className="size-3.5" />
            <Amount amountMinor={data.untaggedRevenueMinor} /> revenue untagged
          </span>
        ) : null}
      </div>

      {/* KPI tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Revenue"><Amount amountMinor={totalRevenue} tone="income" /></Kpi>
        <Kpi label="Costs"><Amount amountMinor={totalCost} /></Kpi>
        <Kpi label="Net income">
          <Amount amountMinor={netIncome} tone={netIncome >= 0 ? "income" : undefined} className={cn(netIncome < 0 && "text-negative")} />
        </Kpi>
        <Kpi label="Margin">{marginPct === null ? "—" : `${marginPct}%`}</Kpi>
      </div>

      {data.streams.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No stream activity in this period"
          description="Tag transactions, invoices, or bills to a revenue stream to see income and profit by stream here."
        />
      ) : (
        <>
          {/* Income by stream — bar chart */}
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Income by stream</h2>
            <div className="flex flex-col gap-2.5">
              {byRevenue.map((s) => {
                const w = Math.round((Math.abs(s.revenueMinor) / maxRevenue) * 100);
                const share = totalRevenue > 0 ? Math.round((s.revenueMinor / totalRevenue) * 100) : 0;
                return (
                  <div key={s.stream} className="grid gap-1" data-testid="insights-income-row">
                    <div className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="truncate font-medium">{s.stream}</span>
                      <span className="flex items-center gap-2 whitespace-nowrap money-figures">
                        <Amount amountMinor={s.revenueMinor} tone="income" className="font-semibold" />
                        <span className="text-[11.5px] text-muted-foreground">{share}%</span>
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-ob-green-600" style={{ width: `${w}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Profit by stream — full table */}
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Profit by stream</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 text-left font-medium">Stream</th>
                    <th className="pb-2 text-right font-medium">Revenue</th>
                    <th className="pb-2 text-right font-medium">Cost</th>
                    <th className="pb-2 text-right font-medium">Profit</th>
                    <th className="pb-2 text-right font-medium">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.streams.map((s) => (
                    <tr key={s.stream} data-testid="insights-profit-row">
                      <td className="py-2 font-medium">{s.stream}</td>
                      <td className="py-2 text-right money-figures"><Amount amountMinor={s.revenueMinor} /></td>
                      <td className="py-2 text-right money-figures text-muted-foreground"><Amount amountMinor={s.directCostMinor} /></td>
                      <td className="py-2 text-right money-figures">
                        <Amount amountMinor={s.profitMinor} tone={s.profitMinor >= 0 ? "income" : undefined} className={cn("font-semibold", s.profitMinor < 0 && "text-negative")} />
                      </td>
                      <td className="py-2 text-right text-muted-foreground">{s.marginPct === null ? "—" : `${s.marginPct}%`}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="text-muted-foreground">
                  {data.untaggedRevenueMinor > 0 ? (
                    <tr>
                      <td className="pt-2.5">Untagged revenue</td>
                      <td className="pt-2.5 text-right money-figures"><Amount amountMinor={data.untaggedRevenueMinor} /></td>
                      <td /><td /><td />
                    </tr>
                  ) : null}
                  {data.unallocatedCostMinor > 0 ? (
                    <tr>
                      <td className="pt-1">Shared overhead</td>
                      <td />
                      <td className="pt-1 text-right money-figures"><Amount amountMinor={data.unallocatedCostMinor} /></td>
                      <td /><td />
                    </tr>
                  ) : null}
                  <tr className="font-semibold text-foreground">
                    <td className="pt-2.5">Net income</td>
                    <td /><td />
                    <td className="pt-2.5 text-right money-figures">
                      <Amount amountMinor={netIncome} tone={netIncome >= 0 ? "income" : undefined} className={cn(netIncome < 0 && "text-negative")} />
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-[14px] border bg-card p-4 shadow-xs">
      <div className="text-[11.5px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold money-figures">{children}</div>
    </div>
  );
}

function PeriodPicker({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const opts: Array<{ id: Period; label: string }> = [
    { id: "month", label: "This month" },
    { id: "quarter", label: "This quarter" },
    { id: "year", label: "This year" },
  ];
  return (
    <div className="inline-flex rounded-lg border bg-card p-0.5">
      {opts.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={cn(
            "rounded-[6px] px-2.5 py-1 text-[12px] transition-colors",
            period === opt.id ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Needs Review
// ---------------------------------------------------------------------------

function NeedsReviewSurface({ entityId }: { entityId: Id<"entities"> }) {
  const data = useQuery(api.streamRules.streamNeedsReview, { entityId });
  const confirmOne = useMutation(api.streamRules.confirmStreamSuggestion);
  const confirmAll = useMutation(api.streamRules.confirmAllStreamSuggestions);
  const scan = useMutation(api.streamRules.applyStreamRulesForEntity);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  if (data === undefined) {
    return <Card><p className="text-sm text-muted-foreground">Loading review queue…</p></Card>;
  }

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (error) {
      toast.error(getErrorMessage(error, "Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] text-muted-foreground">
          {data.rows.length} transaction{data.rows.length === 1 ? "" : "s"} with AI-suggested streams awaiting your OK.
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => scan({ entityId }), "Rules applied.")} data-testid="streams-scan">
            <Sparkles className="size-4" /> Scan for suggestions
          </Button>
          <Button size="sm" disabled={busy || data.rows.length === 0} onClick={() => run(() => confirmAll({ entityId }), "All suggestions confirmed.")} data-testid="streams-confirm-all">
            <Check className="size-4" /> Confirm all AI suggestions
          </Button>
        </div>
      </div>

      {data.rows.length === 0 ? (
        <EmptyState icon={Check} title="Nothing to review" description="New transactions from known merchants will show up here with a suggested stream." />
      ) : (
        <div className="overflow-hidden rounded-[14px] border bg-card shadow-xs divide-y">
          {data.rows.map((row) => (
            <div key={String(row.id)} className="px-4 py-3" data-testid="needs-review-row">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-sm font-medium">{row.merchant}</span>
                <span className="text-[11.5px] text-muted-foreground">{row.date}</span>
                <span className="money-figures text-[12px]"><Amount amountMinor={row.amountMinor} /></span>
                <div className="flex flex-wrap items-center gap-1">
                  {row.suggestedStreams.map((line, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                      {line.streamLabel} <span className="money-figures"><Amount amountMinor={line.amountMinor} /></span>
                    </span>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(editing === String(row.id) ? null : String(row.id))}>
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => run(() => confirmOne({ transactionId: row.id as Id<"transactions"> }), "Confirmed.")} data-testid="needs-review-confirm">
                    <Check className="size-4" /> Confirm
                  </Button>
                </div>
              </div>
              {editing === String(row.id) ? (
                <div className="mt-3 rounded-[10px] border bg-muted/20 p-3">
                  <StreamSplitEditor
                    entityId={entityId}
                    transactionId={row.id as Id<"transactions">}
                    amountMinor={row.amountMinor}
                    currency={row.currency}
                    initialStreams={row.suggestedStreams}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manage
// ---------------------------------------------------------------------------

function ManageSurface({ entityId }: { entityId: Id<"entities"> }) {
  const streams = useQuery(api.streamTags.listStreamsDetailed, { entityId });
  const rules = useQuery(api.streamTags.listStreamRules, { entityId });
  const createStream = useMutation(api.streamTags.createStream);
  const renameStream = useMutation(api.streamTags.renameStreamEverywhere);
  const deleteStream = useMutation(api.streamTags.deleteStream);

  const [newLabel, setNewLabel] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState<string>("__clear__");
  const [busy, setBusy] = useState(false);

  if (streams === undefined) {
    return <Card><p className="text-sm text-muted-foreground">Loading streams…</p></Card>;
  }

  const allLabels = streams.streams.map((s) => s.label);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (error) {
      toast.error(getErrorMessage(error, "Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Create */}
      <Card>
        <div className="flex items-center gap-2">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Add a revenue stream (e.g. AI Dev)"
            className="h-9 max-w-sm"
            onKeyDown={(e) => { if (e.key === "Enter" && newLabel.trim()) run(async () => { await createStream({ entityId, label: newLabel.trim() }); setNewLabel(""); }, "Stream added."); }}
          />
          <Button size="sm" disabled={busy || !newLabel.trim()} onClick={() => run(async () => { await createStream({ entityId, label: newLabel.trim() }); setNewLabel(""); }, "Stream added.")}>
            <Plus className="size-4" /> Add
          </Button>
        </div>
      </Card>

      {/* Streams list */}
      <Card>
        <h2 className="mb-2 text-sm font-semibold">Streams</h2>
        {streams.streams.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No streams yet. Add one above, or tag a transaction.</p>
        ) : (
          <div className="divide-y">
            {streams.streams.map((s) => (
              <div key={s.label} className="flex flex-wrap items-center gap-2 py-2.5" data-testid="manage-stream-row">
                {editing === s.label ? (
                  <Input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="h-8 max-w-[220px] text-[13px]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && draft.trim() && draft.trim() !== s.label) run(async () => { await renameStream({ entityId, from: s.label, to: draft.trim() }); setEditing(null); }, "Stream renamed.");
                      if (e.key === "Escape") setEditing(null);
                    }}
                    onBlur={() => setEditing(null)}
                  />
                ) : (
                  <span className="text-sm font-medium">{s.label}</span>
                )}
                <span className="text-[11.5px] text-muted-foreground">
                  {s.taggedCount} tagged · {s.ruleCount} rule{s.ruleCount === 1 ? "" : "s"}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { setEditing(s.label); setDraft(s.label); }} aria-label={`Rename ${s.label}`}>
                    <Pencil className="size-3.5" />
                  </button>
                  <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => { setDeleting(s.label); setReassignTo("__clear__"); }} aria-label={`Delete ${s.label}`}>
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                {deleting === s.label ? (
                  <div className="mt-1 flex w-full flex-wrap items-center gap-2 rounded-[10px] border border-negative/30 bg-negative-surface/40 p-2.5">
                    <span className="text-[12px]">Delete &ldquo;{s.label}&rdquo; — what about its {s.taggedCount} tagged records?</span>
                    <Select value={reassignTo} onValueChange={setReassignTo}>
                      <SelectTrigger className="h-8 w-[200px] text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__clear__">Untag them</SelectItem>
                        {allLabels.filter((l) => l !== s.label).map((l) => (
                          <SelectItem key={l} value={l}>Reassign to {l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="destructive" disabled={busy} onClick={() => run(async () => { await deleteStream({ entityId, label: s.label, reassignTo: reassignTo === "__clear__" ? undefined : reassignTo }); setDeleting(null); }, "Stream deleted.")}>
                      Delete
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Learned rules */}
      <Card>
        <h2 className="mb-2 text-sm font-semibold">Learned rules</h2>
        {!rules || rules.rules.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No rules yet. Confirming a stream on a transaction teaches a rule; after a few confirmations it auto-tags similar transactions.
          </p>
        ) : (
          <div className="divide-y text-[12.5px]">
            {rules.rules.map((rule) => (
              <div key={String(rule.id)} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid="manage-rule-row">
                <span className="font-medium">{rule.merchantContains}</span>
                <span className="text-muted-foreground">{rule.direction ?? "any"}</span>
                <div className="flex flex-wrap items-center gap-1">
                  {rule.split.map((part, i) => (
                    <span key={i} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                      {part.streamLabel} {Math.round(part.bps / 100)}%
                    </span>
                  ))}
                </div>
                <span className="ml-auto inline-flex items-center gap-1.5">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", rule.autoTags ? "bg-ob-green-50 text-ob-green-800" : "bg-warning-surface text-warning")}>
                    {Math.round(rule.confidence * 100)}% {rule.autoTags ? "auto" : "review"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">✓{rule.timesConfirmed} ✗{rule.timesCorrected}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

function Card({ children }: { children: ReactNode }) {
  return <section className="rounded-[14px] border bg-card p-4 shadow-xs">{children}</section>;
}
