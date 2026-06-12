"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Building2, Copy, Plus, Trash2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { Amount, EmptyState, StatCard } from "@/components/openbooks/primitives";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

type IncomeData = FunctionReturnType<typeof api.incomeViews.overview>;
type IncomeTab = "payments" | "invoices" | "receivables";

const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  open: { label: "Open", className: "bg-blue-50 text-blue-700" },
  paid: { label: "Paid", className: "bg-primary/10 text-primary" },
  overdue: { label: "Overdue", className: "bg-red-50 text-red-700" },
  void: { label: "Void", className: "bg-muted text-muted-foreground" },
  reconciled: { label: "Payout · reconciled", className: "bg-blue-50 text-blue-700" },
  refunded: { label: "Refunded", className: "bg-red-50 text-red-700" },
};

function StatusChip({ status }: { status: string }) {
  const chip = STATUS_CHIP[status] ?? { label: status, className: "bg-muted text-muted-foreground" };
  return (
    <span className={`inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium ${chip.className}`}>
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {chip.label}
    </span>
  );
}

export function IncomeScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const data = useQuery(api.incomeViews.overview, {});
  // Deep-link: /income?tab=invoices (from receivables heat cells / elsewhere).
  // Read once at mount via the lazy initializer; in-app tab clicks drive it after.
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState<IncomeTab>(
    initialTab === "invoices" || initialTab === "receivables" ? initialTab : "payments",
  );
  const [invoiceFilter, setInvoiceFilter] = useState<string>("all");
  const [composerOpen, setComposerOpen] = useState(false);
  const [detailId, setDetailId] = useState<Id<"invoices"> | null>(null);

  if (data === undefined) {
    return <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground shadow-xs">Loading income…</section>;
  }
  if (!data.entity) {
    return (
      <EmptyState
        icon={Building2}
        title="No business yet"
        description="Connect a bank or import a CSV to see money coming in, invoices out, and what's still owed."
      />
    );
  }
  const currency = data.entity.currency;
  const k = data.kpis;

  return (
    <div className="space-y-5" data-testid="income-screen">
      {/* Header: tabs + New invoice */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="ml-auto flex items-center gap-0.5 rounded-[10px] bg-muted p-0.5">
          {(["payments", "invoices", "receivables"] as const).map((item) => (
            <button
              key={item}
              type="button"
              data-testid={`income-tab-${item}`}
              onClick={() => setTab(item)}
              className={`h-[30px] rounded-lg px-3 text-[12.5px] font-medium capitalize transition ${
                tab === item ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
        <Button size="sm" data-testid="income-new-invoice" onClick={() => setComposerOpen(true)}>
          <Plus className="size-4" /> New invoice
        </Button>
      </div>

      {/* KPI row */}
      <section className="grid gap-3 md:grid-cols-4">
        <StatCard
          label="Received · this month"
          value={<Amount amountMinor={k.receivedThisMonthMinor} currency={currency} tone="income" />}
          detail={`${k.paymentCount} payments · ${k.reconciledPayoutCount} payouts reconciled`}
        />
        <StatCard
          label="Still open"
          value={<Amount amountMinor={k.stillOpenMinor} currency={currency} />}
          detail={`${k.openInvoiceCount} invoices awaiting payment`}
        />
        <StatCard
          label="Overdue"
          value={<span className="money-figures text-2xl font-semibold text-red-600"><Amount amountMinor={k.overdueMinor} currency={currency} className="text-red-600" /></span>}
          detail={k.overdueInvoiceCount > 0 ? `${k.overdueInvoiceCount} invoices · oldest ${k.oldestOverdueDays} days` : "Nothing overdue"}
        />
        <StatCard
          label="Avg days to pay"
          value={<span className="money-figures text-2xl font-semibold">{k.averageDaysToPay}</span>}
          detail="Average net terms on paid invoices"
        />
      </section>

      {tab === "payments" ? <PaymentsTab data={data} /> : null}
      {tab === "invoices" ? (
        <InvoicesTab data={data} filter={invoiceFilter} onFilter={setInvoiceFilter} onOpen={setDetailId} />
      ) : null}
      {tab === "receivables" ? (
        <ReceivablesTab
          data={data}
          onCustomer={(id) => router.push(`/contacts?contact=${id}`)}
          onBucket={() => setTab("invoices")}
        />
      ) : null}

      {composerOpen ? (
        <InvoiceComposer entityId={data.entity.id as Id<"entities">} currency={currency} onClose={() => setComposerOpen(false)} onOpenDetail={setDetailId} />
      ) : null}
      {detailId ? <InvoiceDetailDrawer invoiceId={detailId} onClose={() => setDetailId(null)} /> : null}
    </div>
  );
}

function PaymentsTab({ data }: { data: IncomeData }) {
  const currency = data.entity!.currency;
  return (
    <Card className="overflow-hidden shadow-xs" data-testid="income-payments">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>From</TableHead>
            <TableHead>For</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.payments.map((p) => (
            <TableRow key={p.id} data-testid="payment-row">
              <TableCell className="money-figures text-xs text-muted-foreground">{p.date}</TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <span className="inline-flex size-6 items-center justify-center rounded-md bg-foreground text-[9px] font-bold text-background">{p.initials}</span>
                  <span className="font-medium">{p.fromName}</span>
                </span>
              </TableCell>
              <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">{p.memo}</TableCell>
              <TableCell><StatusChip status={p.status} /></TableCell>
              <TableCell className="text-right">
                <Amount amountMinor={p.amountMinor} currency={p.currency || currency} tone={p.amountMinor < 0 ? "expense" : "income"} signed />
              </TableCell>
            </TableRow>
          ))}
          {data.payments.length === 0 ? (
            <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">No payments yet.</TableCell></TableRow>
          ) : null}
        </TableBody>
      </Table>
      <div className="border-t px-4 py-2.5 text-xs text-muted-foreground">
        Payments sync from Stripe and your bank feed. Payouts arrive as one deposit — OpenBooks splits them back into gross revenue and fees automatically.
      </div>
    </Card>
  );
}

function InvoicesTab({
  data,
  filter,
  onFilter,
  onOpen,
}: {
  data: IncomeData;
  filter: string;
  onFilter: (value: string) => void;
  onOpen: (id: Id<"invoices">) => void;
}) {
  const currency = data.entity!.currency;
  const counts = data.invoiceCounts;
  const rows = data.invoices.filter((row) => filter === "all" || row.status === filter);
  const filters: Array<{ id: string; label: string }> = [
    { id: "all", label: `All · ${counts.all}` },
    { id: "draft", label: `Draft · ${counts.draft}` },
    { id: "open", label: `Open · ${counts.open}` },
    { id: "paid", label: `Paid · ${counts.paid}` },
    { id: "overdue", label: `Overdue · ${counts.overdue}` },
  ];
  return (
    <div className="space-y-3" data-testid="income-invoices">
      <div className="flex flex-wrap items-center gap-1 border-b">
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={`invoice-filter-${item.id}`}
            onClick={() => onFilter(item.id)}
            className={`-mb-px h-9 border-b-2 px-3.5 text-[13px] ${
              filter === item.id ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <Card className="overflow-hidden shadow-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((invoice) => (
              <TableRow key={invoice.id} data-testid="invoice-row" className="cursor-pointer" onClick={() => onOpen(invoice.id as Id<"invoices">)}>
                <TableCell className="money-figures text-xs text-muted-foreground">{invoice.number}</TableCell>
                <TableCell className="font-medium">{invoice.customerName}</TableCell>
                <TableCell className="money-figures text-xs text-muted-foreground">{invoice.issueDate}</TableCell>
                <TableCell className={`text-xs ${invoice.daysPastDue > 0 ? "text-red-600" : "text-muted-foreground"}`}>
                  {invoice.dueDate}{invoice.daysPastDue > 0 ? ` · ${invoice.daysPastDue}d late` : ""}
                </TableCell>
                <TableCell><StatusChip status={invoice.status} /></TableCell>
                <TableCell className="text-right"><Amount amountMinor={invoice.totalMinor} currency={currency} /></TableCell>
                <TableCell className="text-right">
                  {invoice.balanceMinor === 0 ? <span className="text-muted-foreground">—</span> : <Amount amountMinor={invoice.balanceMinor} currency={currency} />}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">No invoices in this view.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function heatStyle(amountMinor: number, maxMinor: number): React.CSSProperties {
  if (amountMinor === 0) return { color: "var(--muted-foreground)" };
  const intensity = Math.min(0.28, (amountMinor / Math.max(1, maxMinor)) * 0.3);
  return { backgroundColor: `rgba(247,144,9,${intensity.toFixed(2)})`, borderRadius: 5 };
}

function ReceivablesTab({
  data,
  onCustomer,
  onBucket,
}: {
  data: IncomeData;
  onCustomer: (id: string) => void;
  onBucket: (bucket: string) => void;
}) {
  const currency = data.entity!.currency;
  const rows = data.receivables.rows;
  const maxCell = Math.max(
    1,
    ...rows.flatMap((row) => [row.currentMinor, row.days30Minor, row.days60Minor, row.days90Minor]),
  );
  const buckets = data.receivables.buckets;
  return (
    <div className="space-y-2" data-testid="income-receivables">
      <Card className="overflow-hidden shadow-xs">
        <div className="grid grid-cols-[1.5fr_repeat(5,1fr)] bg-muted/50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Customer</span>
          <span className="text-right">Current</span>
          <span className="text-right">1–30</span>
          <span className="text-right">31–60</span>
          <span className="text-right">61–90</span>
          <span className="text-right">Total</span>
        </div>
        {rows.map((row) => {
          const cells: Array<{ key: string; value: number }> = [
            { key: "current", value: row.currentMinor },
            { key: "days30", value: row.days30Minor },
            { key: "days60", value: row.days60Minor },
            { key: "days90", value: row.days90Minor },
          ];
          return (
            <div key={row.id} className="grid grid-cols-[1.5fr_repeat(5,1fr)] items-center border-t px-5 py-2.5 text-[13px]">
              <button type="button" className="text-left font-medium hover:underline" data-testid="receivable-row" onClick={() => onCustomer(row.id)}>
                {row.name}
              </button>
              {cells.map((cell) => (
                <button
                  key={cell.key}
                  type="button"
                  data-testid={`receivable-cell-${cell.key}`}
                  onClick={() => onBucket(cell.key)}
                  className="money-figures px-1.5 py-0.5 text-right tabular-nums"
                  style={heatStyle(cell.value, maxCell)}
                >
                  {cell.value === 0 ? "—" : <Amount amountMinor={cell.value} currency={currency} />}
                </button>
              ))}
              <span className="money-figures text-right font-medium"><Amount amountMinor={row.totalMinor} currency={currency} /></span>
            </div>
          );
        })}
        <div className="grid grid-cols-[1.5fr_repeat(5,1fr)] items-center border-t bg-muted/30 px-5 py-2.5 text-[13px] font-semibold">
          <span>Total</span>
          <span className="money-figures text-right"><Amount amountMinor={buckets.currentMinor} currency={currency} /></span>
          <span className="money-figures text-right"><Amount amountMinor={buckets.days30Minor} currency={currency} /></span>
          <span className="money-figures text-right"><Amount amountMinor={buckets.days60Minor} currency={currency} /></span>
          <span className="money-figures text-right"><Amount amountMinor={buckets.days90Minor} currency={currency} /></span>
          <span className="money-figures text-right" data-testid="receivables-total"><Amount amountMinor={data.receivables.totalMinor} currency={currency} /></span>
        </div>
        {rows.length === 0 ? <div className="px-5 py-4 text-sm text-muted-foreground">No money owed right now.</div> : null}
      </Card>
      <p className="text-xs text-muted-foreground">Heat shading shows how overdue the money is. Click a customer for their full history, or a cell to see those invoices.</p>
    </div>
  );
}

type ComposerLine = { description: string; quantity: string; rate: string };

function InvoiceComposer({
  entityId,
  currency,
  onClose,
  onOpenDetail,
}: {
  entityId: Id<"entities">;
  currency: string;
  onClose: () => void;
  onOpenDetail: (id: Id<"invoices">) => void;
}) {
  const saveDraft = useMutation(api.invoices.saveDraft);
  const finalize = useMutation(api.invoices.finalize);
  const sendViaStripe = useAction(api.stripe.sendInvoiceViaStripe);
  const recordStripeSend = useMutation(api.invoices.recordStripeSend);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [lines, setLines] = useState<ComposerLine[]>([{ description: "", quantity: "1", rate: "" }]);
  const [terms, setTerms] = useState("Net 30");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draftId, setDraftId] = useState<Id<"invoices"> | null>(null);

  const subtotalMinor = useMemo(
    () => lines.reduce((sum, line) => sum + Math.round((Number(line.rate) || 0) * 100) * (Number(line.quantity) || 0), 0),
    [lines],
  );

  function lineItemsPayload() {
    return lines
      .filter((line) => line.description.trim() && (Number(line.rate) || 0) > 0)
      .map((line) => ({ description: line.description.trim(), quantity: Math.max(1, Number(line.quantity) || 1), unitAmountMinor: Math.round((Number(line.rate) || 0) * 100) }));
  }

  function dueDateFromTerms() {
    const days = terms === "Net 15" ? 15 : terms === "Net 7" ? 7 : terms === "Due on receipt" ? 0 : 30;
    const date = new Date("2026-06-11T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + days);
    return { dueDate: date.toISOString().slice(0, 10), days };
  }

  async function handleSaveDraft() {
    const lineItems = lineItemsPayload();
    if (lineItems.length === 0) { setError("Add at least one line with a description and rate."); return; }
    if (!customerName.trim()) { setError("Name the customer."); return; }
    setBusy(true); setError("");
    try {
      const { dueDate } = dueDateFromTerms();
      const result = await saveDraft({
        entityId,
        invoiceId: draftId ?? undefined,
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim() || undefined,
        lineItems,
        terms,
        dueDate,
        memo: memo.trim() || undefined,
      });
      setDraftId(result.invoiceId);
      onClose();
      onOpenDetail(result.invoiceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the draft.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSend() {
    const lineItems = lineItemsPayload();
    if (lineItems.length === 0) { setError("Add at least one line with a description and rate."); return; }
    if (!customerName.trim()) { setError("Name the customer."); return; }
    setBusy(true); setError("");
    try {
      const { dueDate, days } = dueDateFromTerms();
      // Persist a draft first (so we have a local invoice to attach the hosted
      // URL / timeline to), then call Stripe, then record the result.
      const draft = await saveDraft({
        entityId,
        invoiceId: draftId ?? undefined,
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim() || undefined,
        lineItems,
        terms,
        dueDate,
        memo: memo.trim() || undefined,
      });
      const stripe = await sendViaStripe({
        entityId,
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim() || "billing@example.com",
        memo: memo.trim() || undefined,
        daysUntilDue: Math.max(1, days || 1),
        lineItems: lineItems.map((item) => ({ description: item.description, amountMinor: item.unitAmountMinor, quantity: item.quantity })),
      });
      await recordStripeSend({ invoiceId: draft.invoiceId, hostedInvoiceUrl: stripe.hostedInvoiceUrl ?? undefined, stripeInvoiceId: stripe.stripeInvoiceId });
      onClose();
      onOpenDetail(draft.invoiceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send via Stripe.");
    } finally {
      setBusy(false);
    }
  }

  async function handleFinalize() {
    // Manual finalize (no Stripe): post the accrual and open the detail.
    const lineItems = lineItemsPayload();
    if (lineItems.length === 0) { setError("Add at least one line with a description and rate."); return; }
    if (!customerName.trim()) { setError("Name the customer."); return; }
    setBusy(true); setError("");
    try {
      const { dueDate } = dueDateFromTerms();
      const draft = await saveDraft({ entityId, invoiceId: draftId ?? undefined, customerName: customerName.trim(), customerEmail: customerEmail.trim() || undefined, lineItems, terms, dueDate, memo: memo.trim() || undefined });
      await finalize({ invoiceId: draft.invoiceId });
      onClose();
      onOpenDetail(draft.invoiceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finalize the invoice.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[560px]" data-testid="invoice-composer">
        <SheetTitle className="sr-only">New invoice</SheetTitle>
        <SheetDescription className="sr-only">Compose an invoice with line items, save it as a draft, finalize it, or send it via Stripe.</SheetDescription>
        <div className="flex items-center gap-2.5 border-b px-5 py-4">
          <div className="flex-1 text-base font-semibold">New invoice</div>
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[11px] text-muted-foreground">
            <span className="inline-flex size-3.5 items-center justify-center rounded bg-[#635bff] text-[9px] font-bold text-white">S</span> sends via your Stripe
          </span>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div className="grid gap-2">
            <Label>Customer</Label>
            <Input data-testid="composer-customer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Choose or name a customer" />
            <p className="text-[11px] text-muted-foreground">Synced with your Stripe customer list. A new name lands in Contacts.</p>
            <Input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="Customer email (for Stripe send)" />
          </div>
          <div className="space-y-2">
            <Label>Line items</Label>
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-[1fr_64px_96px_90px] items-center gap-2">
                <Input data-testid="composer-line-desc" value={line.description} placeholder="Description" onChange={(e) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, description: e.target.value } : l)))} className="h-9" />
                <Input value={line.quantity} inputMode="numeric" onChange={(e) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)))} className="h-9 text-center money-figures" />
                <Input data-testid="composer-line-rate" value={line.rate} inputMode="decimal" placeholder="0.00" onChange={(e) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, rate: e.target.value } : l)))} className="h-9 text-right money-figures" />
                <div className="flex items-center justify-end gap-1">
                  <span className="money-figures text-[13px]"><Amount amountMinor={Math.round((Number(line.rate) || 0) * 100) * (Number(line.quantity) || 0)} currency={currency} /></span>
                  {lines.length > 1 ? (
                    <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))} aria-label="Remove line"><Trash2 className="size-3.5" /></button>
                  ) : null}
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" data-testid="composer-add-line" onClick={() => setLines((prev) => [...prev, { description: "", quantity: "1", rate: "" }])}>
              <Plus className="size-3.5" /> Add line
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Terms</Label>
              <select value={terms} onChange={(e) => setTerms(e.target.value)} className="h-9 rounded-[10px] border bg-background px-3 text-sm">
                <option>Net 30</option><option>Net 15</option><option>Net 7</option><option>Due on receipt</option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label>Due date</Label>
              <Input readOnly value={dueDateFromTerms().dueDate} className="bg-muted/40 money-figures" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Memo</Label>
            <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Thanks for your business — payment link below." rows={2} />
          </div>
          <div className="space-y-1.5 rounded-xl bg-muted/40 p-4">
            <div className="flex justify-between text-[12.5px] text-muted-foreground"><span>Subtotal</span><span className="money-figures"><Amount amountMinor={subtotalMinor} currency={currency} /></span></div>
            <div className="flex justify-between text-sm font-semibold"><span>Total due</span><span className="money-figures" data-testid="composer-total"><Amount amountMinor={subtotalMinor} currency={currency} /></span></div>
            <p className="text-[11px] text-muted-foreground">Stripe hosts the payment page and emails the customer. Card or ACH.</p>
          </div>
          {error ? <p className="text-sm text-destructive" data-testid="composer-error">{error}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3.5">
          <Button variant="outline" size="sm" data-testid="composer-save-draft" disabled={busy} onClick={handleSaveDraft}>Save draft</Button>
          <Button variant="outline" size="sm" data-testid="composer-finalize" disabled={busy} onClick={handleFinalize}>Finalize (manual)</Button>
          <div className="flex-1" />
          <Button size="sm" data-testid="composer-send" disabled={busy} onClick={handleSend}>{busy ? "Working…" : "Send via Stripe"}</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function InvoiceDetailDrawer({ invoiceId, onClose }: { invoiceId: Id<"invoices">; onClose: () => void }) {
  const detail = useQuery(api.invoices.detail, { invoiceId });
  const sendReminder = useMutation(api.invoices.sendReminder);
  const voidInvoice = useMutation(api.invoices.voidInvoice);
  const finalize = useMutation(api.invoices.finalize);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function handleFinalize() {
    setBusy(true); setMessage("");
    try {
      await finalize({ invoiceId });
      setMessage("Invoice issued — it now shows as money owed.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not finalize the invoice.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReminder() {
    setBusy(true); setMessage("");
    try {
      const result = await sendReminder({ invoiceId });
      if (result.channel === "stripe" && result.hostedInvoiceUrl) {
        setMessage(`Reminder queued via Stripe. Hosted link: ${result.hostedInvoiceUrl}`);
      } else if (result.customerEmail) {
        const subject = encodeURIComponent(`Reminder: invoice ${result.number}`);
        window.open(`mailto:${result.customerEmail}?subject=${subject}`, "_blank");
        setMessage(`Opened an email reminder to ${result.customerName}.`);
      } else {
        setMessage(`No email on file — copy the balance and follow up with ${result.customerName}.`);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not send the reminder.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVoid() {
    setBusy(true); setMessage("");
    try {
      await voidInvoice({ invoiceId });
      setMessage("Invoice voided — the accrual was reversed.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not void the invoice.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[440px]" data-testid="invoice-detail">
        <SheetTitle className="sr-only">Invoice detail</SheetTitle>
        <SheetDescription className="sr-only">Invoice status, hosted payment link, line items, and timeline.</SheetDescription>
        {detail === undefined ? (
          <div className="p-6 text-sm text-muted-foreground">Loading invoice…</div>
        ) : detail === null ? (
          <div className="p-6"><EmptyState title="Invoice not found" /></div>
        ) : (
          <>
            <div className="flex items-center gap-2.5 border-b px-5 py-4">
              <div className="flex-1">
                <div className="text-base font-semibold">Invoice {detail.number}</div>
                <div className="text-xs text-muted-foreground">{detail.customerName}</div>
              </div>
              <StatusChip status={detail.status} />
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={onClose} aria-label="Close"><X className="size-4" /></button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              <div className="money-figures text-2xl font-semibold"><Amount amountMinor={detail.totalMinor} currency={detail.currency} /></div>
              {detail.hostedInvoiceUrl ? (
                <div className="flex items-center gap-2.5 rounded-[10px] border p-3" data-testid="invoice-hosted-link">
                  <span className="inline-flex size-6 items-center justify-center rounded bg-[#635bff] text-[11px] font-bold text-white">S</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium">Hosted payment page</div>
                    <div className="money-figures truncate text-[10.5px] text-muted-foreground">{detail.hostedInvoiceUrl}</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(detail.hostedInvoiceUrl!)}><Copy className="size-3.5" /> Copy</Button>
                </div>
              ) : null}
              {detail.lineItems.length > 0 ? (
                <div className="rounded-[10px] border">
                  <div className="border-b px-3 py-2 text-[12px] font-semibold text-muted-foreground">Line items</div>
                  {detail.lineItems.map((item, index) => (
                    <div key={index} className="flex items-center justify-between px-3 py-2 text-[13px]">
                      <span>{item.description} {item.quantity > 1 ? `× ${item.quantity}` : ""}</span>
                      <span className="money-figures"><Amount amountMinor={item.unitAmountMinor * item.quantity} currency={detail.currency} /></span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div>
                <div className="mb-2.5 text-[12px] font-semibold text-muted-foreground">Timeline</div>
                <div className="flex flex-col" data-testid="invoice-timeline">
                  {detail.timeline.map((step, index) => (
                    <div key={index} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className={`mt-0.5 size-2.5 rounded-full border-2 ${step.done ? "border-primary/30 bg-primary" : "border-border bg-background"}`} />
                        {index < detail.timeline.length - 1 ? <span className="min-h-[18px] w-0.5 flex-1 bg-border" /> : null}
                      </div>
                      <div className="pb-3.5">
                        <div className={`text-[12.5px] font-medium ${step.done ? "text-foreground" : "text-muted-foreground"}`}>{step.label}</div>
                        <div className="text-[11px] text-muted-foreground">{step.when ?? "—"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {detail.isOverdue ? (
                <div className="flex items-center gap-2 rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[12.5px] text-red-700" data-testid="invoice-overdue-note">
                  {detail.daysPastDue} days past due. A polite reminder usually gets these paid within a week.
                </div>
              ) : null}
              {message ? <p className="rounded-[10px] border bg-primary/5 p-3 text-sm text-primary" data-testid="invoice-detail-message">{message}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3.5">
              {detail.status === "draft" ? (
                <Button size="sm" data-testid="invoice-finalize" disabled={busy} onClick={handleFinalize}>Finalize &amp; issue</Button>
              ) : null}
              {detail.status === "open" || detail.status === "overdue" ? (
                <Button size="sm" data-testid="invoice-send-reminder" disabled={busy} onClick={handleReminder}>Send reminder</Button>
              ) : null}
              {detail.status !== "void" && detail.status !== "paid" ? (
                <Button variant="outline" size="sm" data-testid="invoice-void" disabled={busy} onClick={handleVoid}>Void</Button>
              ) : null}
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
