"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Building2, ChevronRight, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Amount, EmptyState, StatCard } from "@/components/openbooks/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

type ExpensesData = FunctionReturnType<typeof api.expensesViews.overview>;
type Period = "this" | "last";

function deltaLabel(deltaPct: number | null, isNew: boolean) {
  if (isNew) return "new";
  if (deltaPct === null) return "—";
  if (deltaPct === 0) return "0%";
  return deltaPct > 0 ? `▲ ${deltaPct}%` : `▼ ${Math.abs(deltaPct)}%`;
}

const DOTS = ["#475467", "#0e9384", "#8c6a3f", "#f79009", "#9da8b6", "#2c2c2c", "#635bff", "#1d6bb5", "#b54708", "#7a4a8c"];

export function ExpensesScreen() {
  const [period, setPeriod] = useState<Period>("this");
  const data = useQuery(api.expensesViews.overview, { period });

  if (data === undefined) {
    return <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground shadow-xs">Loading expenses…</section>;
  }
  if (!data.entity) {
    return <EmptyState icon={Building2} title="No business yet" description="Connect a bank or import a CSV to see where your money goes, by category and vendor." />;
  }
  const currency = data.entity.currency;
  const k = data.kpis;

  return (
    <div className="space-y-5" data-testid="expenses-screen">
      <div className="flex flex-wrap items-center gap-3">
        <div className="ml-auto flex items-center gap-0.5 rounded-[10px] bg-muted p-0.5">
          {data.periods.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid={`expenses-period-${item.id}`}
              onClick={() => setPeriod(item.id as Period)}
              className={`h-[30px] rounded-lg px-3 text-[12.5px] font-medium transition ${period === item.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <AddCategoryModal entityId={data.entity.id as Id<"entities">} />
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        <StatCard
          label={k.spentLabel}
          value={<Amount amountMinor={k.spentMinor} currency={currency} />}
          detail={k.deltaPct === null ? "No prior-month baseline" : `${k.deltaPct > 0 ? "▲" : "▼"} ${Math.abs(k.deltaPct)}% vs. last month`}
        />
        <StatCard
          label="Recurring spend"
          value={<span><Amount amountMinor={k.recurringMonthlyMinor} currency={currency} /><span className="text-sm font-medium text-muted-foreground"> /mo</span></span>}
          detail={`${k.recurringSharePct}% of your spend is predictable`}
        />
        <StatCard
          label="Biggest movement"
          value={<span className="text-[15px] font-semibold">{k.biggestMoverName ? `${k.biggestMoverName} ${k.biggestMoverDeltaPct! > 0 ? "▲" : "▼"} ${Math.abs(k.biggestMoverDeltaPct!)}%` : "—"}</span>}
          detail={k.biggestMoverName ? "Largest change vs. last month" : "Needs a prior month to compare"}
        />
      </section>

      <CategoryTable data={data} currency={currency} />
      <RecurringSection data={data} currency={currency} />
    </div>
  );
}

function CategoryTable({ data, currency }: { data: ExpensesData; currency: string }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <Card className="overflow-hidden shadow-xs" data-testid="expenses-categories">
      <div className="grid grid-cols-[18px_1.4fr_70px_1fr_90px_110px_14px] items-center gap-2.5 bg-muted/50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span /><span>Category</span><span className="text-right">Txns</span><span>Share</span><span className="text-right">vs last</span><span className="text-right">Amount</span><span />
      </div>
      {data.categories.map((category, index) => {
        const dot = DOTS[index % DOTS.length];
        const isOpen = !!expanded[category.id];
        return (
          <div key={category.id}>
            <button
              type="button"
              data-testid="expense-category-row"
              onClick={() => setExpanded((prev) => ({ ...prev, [category.id]: !prev[category.id] }))}
              className="grid w-full grid-cols-[18px_1.4fr_70px_1fr_90px_110px_14px] items-center gap-2.5 border-t px-4 py-2.5 text-left transition hover:bg-muted/30"
            >
              <span className="size-2 rounded" style={{ background: dot }} />
              <span className="flex items-center gap-2 truncate">
                <span className="truncate text-[13px] font-medium">{category.name}</span>
                {category.isNew ? <Badge variant="outline" className="h-[18px] border-primary/30 bg-primary/10 px-1.5 text-[10px] text-primary">new</Badge> : null}
              </span>
              <span className="money-figures text-right text-xs text-muted-foreground">{category.txnCount}</span>
              <span className="block h-3 overflow-hidden rounded bg-muted">
                <span className="block h-full rounded" style={{ background: dot, width: `${Math.max(category.totalMinor > 0 ? 2 : 0, category.sharePct)}%` }} />
              </span>
              <span className={`text-right text-[11.5px] ${category.isNew ? "text-primary" : (category.deltaPct ?? 0) < 0 ? "text-primary" : "text-muted-foreground"}`}>{deltaLabel(category.deltaPct, category.isNew)}</span>
              <span className="money-figures text-right text-[13px] font-semibold"><Amount amountMinor={category.totalMinor} currency={currency} /></span>
              <ChevronRight className={`size-3 text-muted-foreground transition ${isOpen ? "rotate-90" : ""}`} />
            </button>
            {isOpen ? (
              <div className="border-t bg-muted/20 px-4 py-2 pl-12">
                {category.vendors.length === 0 ? (
                  <div className="py-1.5 text-[12.5px] text-muted-foreground">No tagged vendor transactions in this period.</div>
                ) : (
                  category.vendors.map((vendor) => (
                    <div key={vendor.id} className="flex items-center gap-2.5 py-1.5 text-[12.5px]">
                      <span className="flex-1 text-muted-foreground">{vendor.name}</span>
                      <span className="money-figures min-w-[90px] text-right font-medium"><Amount amountMinor={vendor.totalMinor} currency={currency} /></span>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="flex justify-between border-t bg-muted/30 px-4 py-3 text-[13px] font-semibold">
        <span>Total</span>
        <span className="money-figures pr-6" data-testid="expenses-total"><Amount amountMinor={data.totalMinor} currency={currency} /></span>
      </div>
      {data.categories.length === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground">No expenses recorded for this period.</div> : null}
    </Card>
  );
}

function RecurringSection({ data, currency }: { data: ExpensesData; currency: string }) {
  return (
    <div data-testid="expenses-recurring">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Recurring</span>
        <span className="text-[11.5px] text-muted-foreground">detected from your last 6 months of transactions</span>
      </div>
      <Card className="overflow-hidden shadow-xs">
        {data.recurring.map((row) => (
          <div key={`${row.vendor}-${row.nextDate}`} className="flex items-center gap-3 border-t px-4 py-2.5 first:border-t-0" data-testid="recurring-row">
            <span className="inline-flex size-7 items-center justify-center rounded-lg bg-foreground text-[9.5px] font-bold text-background">{row.vendor.slice(0, 3).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">{row.vendor}</span>
              <span className="block text-[11.5px] text-muted-foreground">{row.category}</span>
            </span>
            <Badge variant="outline" className="h-5 px-2 text-[10.5px]">{row.cadence}</Badge>
            <span className="min-w-[110px] text-[11.5px] text-muted-foreground">next {row.nextDate}</span>
            <span className="money-figures min-w-[90px] text-right text-[13px] font-semibold"><Amount amountMinor={row.averageMinor} currency={currency} /></span>
          </div>
        ))}
        {data.recurring.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground"><RefreshCw className="size-4" /> No recurring vendors detected yet — they appear after a few months of regular charges.</div>
        ) : null}
      </Card>
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

  async function handleCreate() {
    if (!name.trim()) { setError("Give the category a name."); return; }
    setBusy(true); setError("");
    try {
      await createCategory({ entityId, name: name.trim(), group });
      setOpen(false);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the category.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="expenses-add-category">Add category</Button>
      </DialogTrigger>
      <DialogContent data-testid="add-category-modal">
        <DialogHeader>
          <DialogTitle>New category</DialogTitle>
          <DialogDescription>It becomes a real account in your books — usable in transactions, rules and reports right away.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2">
            <Label>Name</Label>
            <Input data-testid="category-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Conferences & Events" />
          </div>
          <div className="grid gap-2">
            <Label>Group</Label>
            <select value={group} onChange={(e) => setGroup(e.target.value as typeof group)} className="h-9 rounded-[10px] border bg-background px-3 text-sm" data-testid="category-group">
              <option>Expenses</option><option>Income</option><option>Other</option>
            </select>
            <p className="text-[11px] text-muted-foreground">Behind the scenes this creates account 6xxx under Expenses — visible in accountant mode.</p>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" data-testid="category-create" disabled={busy} onClick={handleCreate}>{busy ? "Creating…" : "Create category"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
