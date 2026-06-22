"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowUpRight,
  Building2,
  CalendarDays,
  Coins,
  Copy,
  Download,
  Plus,
  Trash2,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Amount, EmptyState, formatMinorMoney } from "@/components/openbooks/primitives";
import {
  AddMenu,
  AmountFilterPill,
  type AmountValue,
  DateRangeControl,
  type DateRangePreset,
  type DateRangeValue,
  dateRangeValueToISO,
  DetailSheet,
  DisplaySettingsMenu,
  type DisplaySettings,
  type ActiveChip,
  type ColumnDef,
  type FilterFacetSpec,
  type FilterPanelValue,
  FilterPanelButton,
  GroupByMenu,
  type GroupByKey,
  isAmountActive,
  SortMenu,
  type SortState,
  useIsMobile,
  useSavedViews,
  useWorkbenchUrlState,
  type WorkbenchConfig,
  WorkbenchSurface,
  type WorkbenchTableGroup,
  InsightBanner,
  InsightBannerExplain,
  buildPageInsight,
} from "@/components/openbooks/workbench";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useActiveEntity } from "@/lib/openbooks/active-entity";
import { todayIso } from "@/lib/openbooks/today";

type IncomeData = FunctionReturnType<typeof api.incomeViews.overview>;
type PaymentRow = IncomeData["payments"][number];
type InvoiceRow = IncomeData["invoices"][number];

// Status chip tones routed through semantic tokens — never raw red/blue.
// Only overdue/refunded (money at risk) carry the negative token; in-flight
// states use info; settled states lean on the brand/muted surfaces.
const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  open: { label: "Open", className: "bg-info-surface text-info" },
  paid: { label: "Paid", className: "bg-primary/10 text-primary" },
  overdue: { label: "Overdue", className: "bg-negative-surface text-negative" },
  void: { label: "Void", className: "bg-muted text-muted-foreground" },
  reconciled: { label: "Payout · reconciled", className: "bg-info-surface text-info" },
  refunded: { label: "Refunded", className: "bg-negative-surface text-negative" },
};

function statusLabelFor(status: string) {
  return STATUS_CHIP[status]?.label ?? status;
}

function StatusChip({ status }: { status: string }) {
  const chip = STATUS_CHIP[status] ?? { label: status, className: "bg-muted text-muted-foreground" };
  return (
    <span className={`inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium ${chip.className}`}>
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {chip.label}
    </span>
  );
}

const URL_PERIOD_PRESETS: DateRangePreset[] = ["this-month", "last-month", "last-3-months", "ytd"];

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function downloadIncomeCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportPaymentsCsv(rows: PaymentRow[], currency: string) {
  downloadIncomeCsv("income-payments.csv", [
    ["Date", "From", "Memo", "Status", "Amount", "Currency"],
    ...rows.map((row) => [row.date, row.fromName, row.memo, row.status, row.amountMinor / 100, row.currency || currency]),
  ]);
}

function exportInvoicesCsv(rows: InvoiceRow[], currency: string) {
  downloadIncomeCsv("income-invoices.csv", [
    ["Number", "Customer", "Issued", "Due", "Status", "Amount", "Balance", "Currency"],
    ...rows.map((row) => [row.number, row.customerName, row.issueDate, row.dueDate, row.status, row.totalMinor / 100, row.balanceMinor / 100, currency]),
  ]);
}

// ---------------------------------------------------------------------------
// IncomeScreen — dispatch on the active sub-tab. Default (cash-movement) renders
// the unified money-IN table; "invoices" renders the AR table. Both go through
// the shared WorkbenchSurface driver + full WorkbenchToolbar (E2 stage A). The
// Insights sub-tab is rendered separately by AppScreen → SectionInsights.
// ---------------------------------------------------------------------------

export function IncomeScreen({ subsection }: { subsection?: string }) {
  const { activeEntity, scope } = useActiveEntity();
  const searchParams = useSearchParams();

  const initialPeriodParam = searchParams.get("period");
  const initialPeriod: DateRangeValue = URL_PERIOD_PRESETS.includes(initialPeriodParam as DateRangePreset)
    ? { preset: initialPeriodParam as DateRangePreset }
    : { preset: "this-month" };

  // Period state is shared across both surfaces and persists through the URL.
  // Text lookup belongs to the global command search in the app chrome.
  const [period, setPeriod] = useState<DateRangeValue>(initialPeriod);
  const [search, setSearch] = useState("");
  const range = useMemo(() => {
    // Anchor preset windows on the real server/browser clock (E8-T1/T2 / RC6),
    // not a frozen demo date, so "this month" tracks the present period.
    const iso = dateRangeValueToISO(period, todayIso());
    return { start: iso.from, end: iso.to };
  }, [period]);

  const data = useQuery(
    api.incomeViews.overview,
    scope === "all"
      ? { scope: "all" as const, range }
      : activeEntity.id
        ? { entityId: activeEntity.id as Id<"entities">, range }
        : { range },
  );

  // Mirror the preset period into the URL so sidebar subroutes preserve the
  // current workbench context.
  const urlState = useWorkbenchUrlState();
  const periodParam = "preset" in period ? period.preset : null;
  const setUrlParams = urlState.setParams;
  useEffect(() => {
    setUrlParams({
      period: periodParam && periodParam !== "this-month" ? periodParam : null,
    });
  }, [periodParam, setUrlParams]);

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

  // E8-T4: the single Income page-insight, built from the SAME
  // incomeViews.overview read-model both subsections already query (overdue AR /
  // MRR / received-this-month). The same banner shows on the Income-cash and the
  // Invoices(AR) subsections — one banner per page. Hidden when null.
  const incomeInsight = buildPageInsight("income", {
    entity: data.entity ? { currency: data.entity.currency } : null,
    kpis: data.kpis,
    customers: data.customers,
  });
  const banner =
    incomeInsight && data.entity ? (
      <InsightBanner
        page="income"
        insight={incomeInsight}
        explainSlot={
          <InsightBannerExplain section="income" entityId={data.entity.id} from={range.start} to={range.end} />
        }
      />
    ) : null;

  const shared = { data, period, setPeriod, search, setSearch, banner };
  if (subsection === "invoices") {
    return <InvoicesArSurface {...shared} />;
  }
  return <IncomeCashSurface {...shared} />;
}

type SurfaceProps = {
  data: IncomeData;
  period: DateRangeValue;
  setPeriod: (value: DateRangeValue) => void;
  search: string;
  setSearch: (value: string) => void;
  banner: ReactNode;
};

// ---------------------------------------------------------------------------
// Income (cash) surface — the unified MONEY-IN table. Rows = cash RECEIVED only
// (bank deposits, Stripe payments, invoice payments, reconciled payouts). An
// unpaid invoice NEVER appears here — the server's `payments` are derived from
// posted cash, never from open invoices (proved in incomeViews.test.ts).
// ---------------------------------------------------------------------------

type IncomeCashFilters = { search: string; period: DateRangeValue; amount: AmountValue; source: string[] };

function IncomeCashSurface({ data, period, setPeriod, search, setSearch, banner }: SurfaceProps) {
  const router = useRouter();
  const entity = data.entity!;
  const currency = entity.currency;

  const [amount, setAmount] = useState<AmountValue>({});
  const [source, setSource] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<GroupByKey>("none");
  const [sort, setSort] = useState<SortState>({ key: "date", direction: "desc" });
  const [display, setDisplay] = useState<DisplaySettings>({ density: "comfortable", hiddenColumns: [] });
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [detailId, setDetailId] = useState<Id<"invoices"> | null>(null);
  // A payout row has no underlying transaction to open in the register, so it
  // gets its own detail surface instead of a silently-dead row click (E5.6).
  const [payoutDetail, setPayoutDetail] = useState<PaymentRow | null>(null);

  const savedViewsStore = useSavedViews<IncomeCashFilters>("income", entity.id);

  // Client-side refine over the period-scoped cash rows the server returns.
  const term = search.trim().toLowerCase();
  const rows = useMemo(() => {
    return data.payments.filter((row) => {
      if (amount.direction === "in" && row.amountMinor <= 0) return false;
      if (amount.direction === "out" && row.amountMinor >= 0) return false;
      const abs = Math.abs(row.amountMinor);
      if (amount.minMinor != null && abs < amount.minMinor) return false;
      if (amount.maxMinor != null && abs > amount.maxMinor) return false;
      if (source.length) {
        const rowSource = row.kind === "payout" ? "stripe" : "bank";
        if (!source.includes(rowSource)) return false;
      }
      if (!term) return true;
      return `${row.fromName} ${row.memo} ${row.status}`.toLowerCase().includes(term);
    });
  }, [data.payments, amount, source, term]);

  // A row click ALWAYS opens a detail (consistency: no dead clicks). Real
  // bank/Stripe payment rows open in the register; payout rows (no underlying
  // transaction) open a lightweight payout detail sheet instead.
  function openRow(row: PaymentRow) {
    if (row.transactionId) {
      router.push(`/transactions?focus=${row.transactionId}`);
    } else {
      setPayoutDetail(row);
    }
  }

  const columns: ColumnDef<PaymentRow>[] = [
    {
      key: "date",
      header: "Date",
      mono: true,
      sortable: true,
      width: "7rem",
      sortValue: (row) => row.date,
      cell: (row) => <span className="text-xs text-muted-foreground">{row.date}</span>,
    },
    {
      key: "from",
      header: "From",
      mobilePrimary: true,
      width: "18rem",
      sortValue: (row) => row.fromName,
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2" title={row.memo && row.memo !== row.fromName ? `${row.fromName} · ${row.memo}` : row.fromName}>
          <span className="inline-flex size-6 items-center justify-center rounded-md bg-foreground text-[9px] font-bold text-background">{row.initials}</span>
          <span className="truncate font-medium">{row.fromName}</span>
        </span>
      ),
    },
    {
      key: "memo",
      header: "For",
      priority: 1,
      width: "16rem",
      mobileHidden: true,
      cell: (row) => <span className="block truncate text-xs text-muted-foreground" title={row.memo}>{row.memo}</span>,
    },
    {
      key: "status",
      header: "Status",
      priority: 2,
      width: "8rem",
      mobileHidden: true,
      cell: (row) => <StatusChip status={row.status} />,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      mono: true,
      width: "8rem",
      mobileTrailing: true,
      sortable: true,
      sortValue: (row) => row.amountMinor,
      // Money in is green; a refund (negative) is neutral, never alarm red.
      cell: (row) => (
        <Amount amountMinor={row.amountMinor} currency={row.currency || currency} tone={row.amountMinor < 0 ? "neutral" : "income"} />
      ),
    },
    {
      key: "open",
      header: "",
      align: "right",
      width: "3rem",
      priority: 2,
      mobileHidden: true,
      cell: (row) => (
        <button
          type="button"
          aria-label={row.transactionId ? "View in Transactions" : "View payout"}
          title={row.transactionId ? "View in Transactions" : "View payout"}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={(event) => {
            event.stopPropagation();
            openRow(row);
          }}
        >
          <ArrowUpRight className="size-3.5" />
        </button>
      ),
    },
  ];

  const visibleColumns = columns.filter((column) => !display.hiddenColumns.includes(column.key));
  const sortMenuColumns = columns
    .filter((column) => column.sortable || column.sortValue)
    .map((column) => ({ key: column.key, label: typeof column.header === "string" && column.header ? column.header : column.key }));
  const columnToggleList = columns
    .filter((column) => !["date", "from", "amount"].includes(column.key))
    .map((column) => ({ key: column.key, label: column.key === "open" ? "Link" : typeof column.header === "string" && column.header ? column.header : column.key }));

  // Group view (driver-shaped) by source when requested.
  const groups: WorkbenchTableGroup<PaymentRow>[] | null = useMemo(() => {
    if (groupBy === "none") return null;
    const map = new Map<string, PaymentRow[]>();
    for (const row of rows) {
      const key =
        groupBy === "source"
          ? row.kind === "payout"
            ? "Stripe payouts"
            : "Bank & card"
          : groupBy === "month"
            ? row.date.slice(0, 7)
            : row.fromName;
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([label, groupRows]) => ({
        label,
        rows: groupRows,
        summary: `${groupRows.length} · ${formatMinorMoney(groupRows.reduce((sum, r) => sum + r.amountMinor, 0), { currency })}`,
      }))
      .sort((a, b) => b.rows.length - a.rows.length);
  }, [rows, groupBy, currency]);

  // Filter chips + facets (Date, Amount, Source) — N/A facets stay visible.
  const isDefaultRange = "preset" in period && period.preset === "this-month";
  const iso = dateRangeValueToISO(period, todayIso());
  const filterFacets: FilterFacetSpec[] = [
    { kind: "custom", key: "date", label: "Date", icon: CalendarDays, active: !isDefaultRange, render: () => <DateRangeControl value={period} onChange={setPeriod} compact /> },
    { kind: "amount", key: "amount", label: "Amount", icon: Coins },
    { kind: "options", key: "source", label: "Source", mode: "multi", icon: Building2, options: [ { value: "bank", label: "Bank & card" }, { value: "stripe", label: "Stripe payout" } ] },
  ];
  const filterPanelValue: FilterPanelValue = { amount, source };
  function onFilterPanelChange(key: string, next: unknown) {
    if (key === "amount") setAmount(next as AmountValue);
    else if (key === "source") setSource(next as string[]);
  }
  function clearAllFilters() {
    setSearch("");
    setPeriod({ preset: "this-month" });
    setAmount({});
    setSource([]);
    setActiveViewId(null);
  }
  const chips: ActiveChip[] = [];
  if (!isDefaultRange) chips.push({ key: "date", label: `Date: ${iso.from} – ${iso.to}` });
  if (isAmountActive(amount)) {
    const parts: string[] = [];
    if (amount.minMinor != null) parts.push(`≥ ${formatMinorMoney(amount.minMinor, { currency })}`);
    if (amount.maxMinor != null) parts.push(`≤ ${formatMinorMoney(amount.maxMinor, { currency })}`);
    chips.push({ key: "amount", label: `Amount: ${parts.join(" ")}`.trim() });
  }
  for (const value of source) chips.push({ key: `source:${value}`, label: `Source: ${value === "stripe" ? "Stripe payout" : "Bank & card"}` });
  function removeChip(key: string) {
    if (key === "date") setPeriod({ preset: "this-month" });
    else if (key === "amount") setAmount({});
    else if (key.startsWith("source:")) setSource(source.filter((value) => `source:${value}` !== key));
  }

  // Saved views (FE-only, shared store). Each section ships ONE sensible
  // built-in view for a consistent saved-views policy (E5.3): Income → Stripe
  // payouts (the reconciled-deposit lens), plus the user's own views.
  const DEFAULT_FILTERS: IncomeCashFilters = { search: "", period: { preset: "this-month" }, amount: {}, source: [] };
  const UNRECONCILED_VIEW_ID = "builtin:stripe-payouts";
  const UNRECONCILED_FILTERS: IncomeCashFilters = { ...DEFAULT_FILTERS, source: ["stripe"] };
  function captureFilters(): IncomeCashFilters {
    return { search: "", period, amount, source };
  }
  function applyFilters(filters: IncomeCashFilters) {
    setSearch("");
    setPeriod(filters.period);
    setAmount(filters.amount);
    setSource(filters.source);
  }
  const savedViewSummaries = [
    { id: UNRECONCILED_VIEW_ID, name: "Stripe payouts", builtIn: true },
    ...savedViewsStore.userViews.map((view) => ({ id: view.id, name: view.name, builtIn: false })),
  ];
  const activeView = savedViewsStore.userViews.find((view) => view.id === activeViewId) ?? null;
  const activeFilters =
    activeViewId === UNRECONCILED_VIEW_ID ? UNRECONCILED_FILTERS : activeView?.filters ?? DEFAULT_FILTERS;
  const viewDirty = JSON.stringify(captureFilters()) !== JSON.stringify(activeFilters);

  const config: WorkbenchConfig<PaymentRow> = {
    section: "income",
    title: "Income",
    subtabs: [
      { id: "income", label: "Income", subtitle: "Money received", kind: "cash-movement" },
      { id: "invoices", label: "Invoices", subtitle: "Accounts receivable", kind: "ledger" },
      { id: "insights", label: "Insights", kind: "insights" },
    ],
    columns,
    defaultVisibleColumns: visibleColumns.map((column) => column.key),
    filterFacets,
    groupByOptions: ["none", "source", "month", "contact"],
    sortableColumns: sortMenuColumns,
    defaultSort: { key: "date", direction: "desc" },
    primaryActions: [{ label: "New invoice", onClick: () => setComposerOpen(true), variant: "primary" }],
    bulkActions: [],
    rowToDetail: () => null,
  };

  return (
    <WorkbenchSurface<PaymentRow>
      config={config}
      testId="income-screen"
      banner={banner}
      savedViews={{
        views: savedViewSummaries,
        activeViewId,
        dirty: viewDirty,
        allLabel: "All income",
        onSelect: (id) => {
          if (!id) {
            applyFilters(DEFAULT_FILTERS);
            setActiveViewId(null);
            return;
          }
          if (id === UNRECONCILED_VIEW_ID) {
            applyFilters(UNRECONCILED_FILTERS);
            setActiveViewId(id);
            return;
          }
          const view = savedViewsStore.userViews.find((candidate) => candidate.id === id);
          if (view) {
            applyFilters(view.filters);
            setActiveViewId(id);
          }
        },
        onCreate: (name) => setActiveViewId(savedViewsStore.add(name, captureFilters()).id),
        onUpdate: (id) => {
          if (id === UNRECONCILED_VIEW_ID) return;
          savedViewsStore.replaceFilters(id, captureFilters());
        },
        onDelete: (id) => {
          if (id === UNRECONCILED_VIEW_ID) return;
          savedViewsStore.remove(id);
          if (activeViewId === id) setActiveViewId(null);
        },
      }}
      chips={chips}
      onRemoveChip={removeChip}
      onClearAll={clearAllFilters}
      pills={
        <>
          <FilterPanelButton facets={filterFacets} value={filterPanelValue} onChange={onFilterPanelChange} onClearAll={clearAllFilters} />
          <DateRangeControl value={period} onChange={setPeriod} compact />
          <AmountFilterPill value={amount} onChange={setAmount} />
        </>
      }
      trailing={
        <>
          <GroupByMenu noun="income" value={groupBy} onChange={setGroupBy} options={[{ key: "none", label: "No grouping" }, { key: "source", label: "Source" }, { key: "month", label: "Month" }, { key: "contact", label: "Customer" }]} />
          <SortMenu noun="income" columns={sortMenuColumns} value={sort} onChange={setSort} />
          <DisplaySettingsMenu value={display} onChange={setDisplay} columns={columnToggleList} />
          <AddMenu
            addLabel="New invoice"
            addTestId="income-new-invoice"
            onAddTransaction={() => setComposerOpen(true)}
            exportChoices={[{ label: "Income (received) — CSV", onSelect: () => exportPaymentsCsv(rows, currency) }]}
          />
        </>
      }
      columns={visibleColumns}
      rows={rows}
      groups={groups}
      getRowId={(row) => row.id}
      onRowClick={openRow}
      density={display.density}
      sort={sort}
      onSortChange={setSort}
      rowAttributes={(row) => ({ "data-testid": "payment-row", "data-transaction-id": row.transactionId })}
      empty={
        <div data-testid="income-payments-empty">
          <EmptyState
            title="No money in for this period"
            description="Cash received — bank deposits, Stripe payments, and recorded invoice payments — lands here. Unpaid invoices live in the Invoices tab."
          />
        </div>
      }
      emptyGroups={<EmptyState title="No money in for this period" description="Adjust the filters above to see more." />}
      overlays={
        <>
          {composerOpen ? (
            <InvoiceComposer entityId={entity.id as Id<"entities">} currency={currency} customers={data.customers} onClose={() => setComposerOpen(false)} onOpenDetail={setDetailId} />
          ) : null}
          {detailId ? <InvoiceDetailSheet invoiceId={detailId} onClose={() => setDetailId(null)} /> : null}
          <PayoutDetailSheet payout={payoutDetail} currency={currency} onClose={() => setPayoutDetail(null)} />
        </>
      }
    />
  );
}

// A lightweight detail for a Stripe payout row — these have no underlying
// register transaction, so the row opens this instead of being a dead click
// (E5.6). Uses the SAME shared DetailSheet so it matches every other section.
function PayoutDetailSheet({
  payout,
  currency,
  onClose,
}: {
  payout: PaymentRow | null;
  currency: string;
  onClose: () => void;
}) {
  if (!payout) return null;
  return (
    <DetailSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={<span data-testid="payout-detail">{payout.fromName}</span>}
      subtitle={<span className="money-figures">{payout.date} · Stripe payout</span>}
      attention={<StatusChip status={payout.status} />}
    >
      <div className="flex flex-col gap-4">
        <div>
          <div className="money-figures text-2xl font-semibold">
            <Amount amountMinor={payout.amountMinor} currency={payout.currency || currency} tone={payout.amountMinor < 0 ? "neutral" : "income"} />
          </div>
        </div>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">For</dt>
            <dd className="min-w-0 truncate text-right">{payout.memo}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Status</dt>
            <dd><StatusChip status={payout.status} /></dd>
          </div>
        </dl>
        <p className="text-[11px] text-muted-foreground">
          Stripe settles batched charges into your bank as a single payout. The
          individual charges reconcile to the deposit on the Insights tab.
        </p>
      </div>
    </DetailSheet>
  );
}

// ---------------------------------------------------------------------------
// Invoices (AR) surface — the accounts-receivable table on the same driver. AR
// money bar (Outstanding · Overdue · Draft · Paid this period). Columns: number,
// customer, issued, DUE, status, amount, BALANCE. Actions: New invoice + (per
// row) Send reminder / Record payment / Statement via the detail sheet.
// ---------------------------------------------------------------------------

type InvoiceFilters = { search: string; status: string[] };
const INVOICE_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
];

function InvoicesArSurface({ data, search, setSearch, banner }: SurfaceProps) {
  const entity = data.entity!;
  const currency = entity.currency;

  const [status, setStatus] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<GroupByKey>("none");
  const [sort, setSort] = useState<SortState>({ key: "issued", direction: "desc" });
  const [display, setDisplay] = useState<DisplaySettings>({ density: "comfortable", hiddenColumns: [] });
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [detailId, setDetailId] = useState<Id<"invoices"> | null>(null);

  const savedViewsStore = useSavedViews<InvoiceFilters>("income-invoices", entity.id);

  const term = search.trim().toLowerCase();
  const rows = useMemo(() => {
    return data.invoices.filter((row) => {
      if (status.length && !status.includes(row.status)) return false;
      if (!term) return true;
      return `${row.number} ${row.customerName} ${row.status}`.toLowerCase().includes(term);
    });
  }, [data.invoices, status, term]);

  const columns: ColumnDef<InvoiceRow>[] = [
    {
      key: "number",
      header: "#",
      mono: true,
      priority: 1,
      sortable: true,
      sortValue: (row) => row.number,
      cell: (row) => <span className="text-xs text-muted-foreground">{row.number}</span>,
    },
    {
      key: "customer",
      header: "Customer",
      mobilePrimary: true,
      sortable: true,
      sortValue: (row) => row.customerName,
      cell: (row) => <span className="font-medium">{row.customerName}</span>,
    },
    {
      key: "issued",
      header: "Issued",
      mono: true,
      priority: 2,
      sortable: true,
      sortValue: (row) => row.issueDate,
      cell: (row) => <span className="text-xs text-muted-foreground">{row.issueDate}</span>,
    },
    {
      key: "due",
      header: "Due",
      mono: true,
      sortable: true,
      sortValue: (row) => row.dueDate,
      cell: (row) => (
        <span className={`text-xs ${row.daysPastDue > 0 ? "text-negative" : "text-muted-foreground"}`}>
          {row.dueDate}
          {row.daysPastDue > 0 ? ` · ${row.daysPastDue}d late` : ""}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusChip status={row.status} />,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      mono: true,
      sortable: true,
      sortValue: (row) => row.totalMinor,
      cell: (row) => <Amount amountMinor={row.totalMinor} currency={currency} />,
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      mono: true,
      mobileTrailing: true,
      sortable: true,
      sortValue: (row) => row.balanceMinor,
      cell: (row) =>
        row.balanceMinor === 0 ? <span className="text-muted-foreground">—</span> : <Amount amountMinor={row.balanceMinor} currency={currency} />,
    },
  ];

  const visibleColumns = columns.filter((column) => !display.hiddenColumns.includes(column.key));
  const sortMenuColumns = columns
    .filter((column) => column.sortable || column.sortValue)
    .map((column) => ({ key: column.key, label: typeof column.header === "string" && column.header ? column.header : column.key }));
  const columnToggleList = columns
    .filter((column) => !["customer", "balance"].includes(column.key))
    .map((column) => ({ key: column.key, label: column.key === "number" ? "Number" : typeof column.header === "string" && column.header ? column.header : column.key }));

  const groups: WorkbenchTableGroup<InvoiceRow>[] | null = useMemo(() => {
    if (groupBy === "none") return null;
    const map = new Map<string, InvoiceRow[]>();
    for (const row of rows) {
      const key = groupBy === "contact" ? row.customerName : statusLabelFor(row.status);
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([label, groupRows]) => ({
        label,
        rows: groupRows,
        summary: `${groupRows.length} · ${formatMinorMoney(groupRows.reduce((sum, r) => sum + r.balanceMinor, 0), { currency })} owed`,
      }))
      .sort((a, b) => b.rows.length - a.rows.length);
  }, [rows, groupBy, currency]);

  const filterFacets: FilterFacetSpec[] = [
    { kind: "options", key: "status", label: "Status", mode: "multi", icon: Coins, options: INVOICE_STATUSES },
  ];
  const filterPanelValue: FilterPanelValue = { status };
  function clearAllFilters() {
    setSearch("");
    setStatus([]);
    setActiveViewId(null);
  }
  const chips: ActiveChip[] = [];
  for (const value of status) chips.push({ key: `status:${value}`, label: `Status: ${INVOICE_STATUSES.find((s) => s.value === value)?.label ?? value}` });
  function removeChip(key: string) {
    if (key.startsWith("status:")) setStatus(status.filter((value) => `status:${value}` !== key));
  }

  // Saved views: one sensible built-in per section (E5.3) — Invoices → Overdue.
  const DEFAULT_FILTERS: InvoiceFilters = { search: "", status: [] };
  const OVERDUE_VIEW_ID = "builtin:overdue";
  const OVERDUE_FILTERS: InvoiceFilters = { search: "", status: ["overdue"] };
  function captureFilters(): InvoiceFilters {
    return { search: "", status };
  }
  function applyFilters(filters: InvoiceFilters) {
    setSearch("");
    setStatus(filters.status);
  }
  const savedViewSummaries = [
    { id: OVERDUE_VIEW_ID, name: "Overdue", builtIn: true },
    ...savedViewsStore.userViews.map((view) => ({ id: view.id, name: view.name, builtIn: false })),
  ];
  const activeView = savedViewsStore.userViews.find((view) => view.id === activeViewId) ?? null;
  const activeFilters =
    activeViewId === OVERDUE_VIEW_ID ? OVERDUE_FILTERS : activeView?.filters ?? DEFAULT_FILTERS;
  const viewDirty = JSON.stringify(captureFilters()) !== JSON.stringify(activeFilters);

  const config: WorkbenchConfig<InvoiceRow> = {
    section: "income",
    title: "Invoices",
    subtabs: [
      { id: "income", label: "Income", subtitle: "Money received", kind: "cash-movement" },
      { id: "invoices", label: "Invoices", subtitle: "Accounts receivable", kind: "ledger" },
      { id: "insights", label: "Insights", kind: "insights" },
    ],
    columns,
    defaultVisibleColumns: visibleColumns.map((column) => column.key),
    filterFacets,
    // Config is the single source of truth and matches the rendered menu keys.
    groupByOptions: ["none", "status", "contact"],
    sortableColumns: sortMenuColumns,
    defaultSort: { key: "issued", direction: "desc" },
    primaryActions: [{ label: "New invoice", onClick: () => setComposerOpen(true), variant: "primary" }],
    bulkActions: [],
    rowToDetail: (row) => ({ title: row.number, tabs: [] }),
  };

  return (
    <WorkbenchSurface<InvoiceRow>
      config={config}
      testId="income-invoices-screen"
      banner={banner}
      savedViews={{
        views: savedViewSummaries,
        activeViewId,
        dirty: viewDirty,
        allLabel: "All invoices",
        onSelect: (id) => {
          if (!id) {
            applyFilters(DEFAULT_FILTERS);
            setActiveViewId(null);
            return;
          }
          if (id === OVERDUE_VIEW_ID) {
            applyFilters(OVERDUE_FILTERS);
            setActiveViewId(id);
            return;
          }
          const view = savedViewsStore.userViews.find((candidate) => candidate.id === id);
          if (view) {
            applyFilters(view.filters);
            setActiveViewId(id);
          }
        },
        onCreate: (name) => setActiveViewId(savedViewsStore.add(name, captureFilters()).id),
        onUpdate: (id) => {
          if (id === OVERDUE_VIEW_ID) return;
          savedViewsStore.replaceFilters(id, captureFilters());
        },
        onDelete: (id) => {
          if (id === OVERDUE_VIEW_ID) return;
          savedViewsStore.remove(id);
          if (activeViewId === id) setActiveViewId(null);
        },
      }}
      chips={chips}
      onRemoveChip={removeChip}
      onClearAll={clearAllFilters}
      pills={
        <FilterPanelButton facets={filterFacets} value={filterPanelValue} onChange={(key, next) => key === "status" && setStatus(next as string[])} onClearAll={clearAllFilters} />
      }
      trailing={
        <>
          <GroupByMenu noun="invoices" value={groupBy} onChange={setGroupBy} options={[{ key: "none", label: "No grouping" }, { key: "status", label: "Status" }, { key: "contact", label: "Customer" }]} />
          <SortMenu noun="invoices" columns={sortMenuColumns} value={sort} onChange={setSort} />
          <DisplaySettingsMenu value={display} onChange={setDisplay} columns={columnToggleList} />
          <AddMenu
            addLabel="New invoice"
            addTestId="invoices-new-invoice"
            onAddTransaction={() => setComposerOpen(true)}
            exportChoices={[{ label: "Invoices (AR) — CSV", onSelect: () => exportInvoicesCsv(rows, currency) }]}
          />
        </>
      }
      columns={visibleColumns}
      rows={rows}
      groups={groups}
      getRowId={(row) => row.id}
      onRowClick={(row) => setDetailId(row.id as Id<"invoices">)}
      density={display.density}
      sort={sort}
      onSortChange={setSort}
      rowAttributes={() => ({ "data-testid": "invoice-row" })}
      empty={
        <div data-testid="income-invoices-empty">
          <EmptyState title="No invoices in this view" description="New invoices you draft or send land here. Click New invoice to bill a customer." />
        </div>
      }
      emptyGroups={<EmptyState title="No invoices in this view" description="Adjust the filters above to see more." />}
      overlays={
        <>
          {composerOpen ? (
            <InvoiceComposer entityId={entity.id as Id<"entities">} currency={currency} customers={data.customers} onClose={() => setComposerOpen(false)} onOpenDetail={setDetailId} />
          ) : null}
          {detailId ? <InvoiceDetailSheet invoiceId={detailId} onClose={() => setDetailId(null)} /> : null}
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// InvoiceComposer — unchanged create flow (reused composer + invoice mutations).
// Renders a right-side Sheet on lg+, a bottom Drawer on mobile. The detail, by
// contrast, now renders through the shared DetailSheet (DIVERGENCE 1).
// ---------------------------------------------------------------------------

function ResponsiveSlideOver({
  open,
  onClose,
  testId,
  title,
  description,
  desktopMaxWidthClass,
  children,
}: {
  open: boolean;
  onClose: () => void;
  testId: string;
  title: string;
  description: string;
  desktopMaxWidthClass: string;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={(next) => !next && onClose()}>
        <DrawerContent className="max-h-[92dvh] gap-0 p-0" data-testid={testId}>
          <DrawerTitle className="sr-only">{title}</DrawerTitle>
          <DrawerDescription className="sr-only">{description}</DrawerDescription>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className={`w-full gap-0 p-0 ${desktopMaxWidthClass}`} data-testid={testId}>
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">{description}</SheetDescription>
        {children}
      </SheetContent>
    </Sheet>
  );
}

type ComposerLine = { description: string; quantity: string; rate: string };

// Integer-safe line subtotal: parse the rate to whole cents BEFORE multiplying
// by quantity, so free-text decimals never drift the stored minor units.
function lineSubtotalMinor(line: ComposerLine) {
  return Math.round((Number(line.rate) || 0) * 100) * (Number(line.quantity) || 0);
}

function InvoiceComposer({
  entityId,
  currency,
  customers,
  onClose,
  onOpenDetail,
}: {
  entityId: Id<"entities">;
  currency: string;
  /** Directory of known customers so the customer field is a directory-bound
   * picker (carried E4 nit / E5.6) — a new typed name still lands in Contacts. */
  customers: IncomeData["customers"];
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

  const subtotalMinor = useMemo(() => lines.reduce((sum, line) => sum + lineSubtotalMinor(line), 0), [lines]);

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
      const result = await saveDraft({ entityId, invoiceId: draftId ?? undefined, customerName: customerName.trim(), customerEmail: customerEmail.trim() || undefined, lineItems, terms, dueDate, memo: memo.trim() || undefined });
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
      const draft = await saveDraft({ entityId, invoiceId: draftId ?? undefined, customerName: customerName.trim(), customerEmail: customerEmail.trim() || undefined, lineItems, terms, dueDate, memo: memo.trim() || undefined });
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
    <ResponsiveSlideOver
      open
      onClose={onClose}
      testId="invoice-composer"
      title="New invoice"
      description="Compose an invoice with line items, save it as a draft, finalize it, or send it via Stripe."
      desktopMaxWidthClass="sm:max-w-[560px]"
    >
      <div className="flex items-center gap-2.5 border-b px-5 py-4">
        <div className="flex-1 text-base font-semibold">New invoice</div>
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[11px] text-muted-foreground">
          <span className="inline-flex size-3.5 items-center justify-center rounded bg-[#635bff] text-[9px] font-bold text-white">S</span> sends via your Stripe
        </span>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <div className="grid gap-2">
          <Label htmlFor="composer-customer">Customer</Label>
          <Input
            id="composer-customer"
            list="composer-customer-options"
            data-testid="composer-customer"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Choose a customer from your directory"
          />
          <datalist id="composer-customer-options">
            {customers.map((customer) => (
              <option key={customer.id} value={customer.name} />
            ))}
          </datalist>
          <p className="text-[11px] text-muted-foreground">Bound to your customer directory. A new name lands in Contacts.</p>
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
                <span className="money-figures text-[13px]"><Amount amountMinor={lineSubtotalMinor(line)} currency={currency} /></span>
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
            <Select value={terms} onValueChange={setTerms}>
              <SelectTrigger className="h-9" aria-label="Payment terms">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Net 30">Net 30</SelectItem>
                <SelectItem value="Net 15">Net 15</SelectItem>
                <SelectItem value="Net 7">Net 7</SelectItem>
                <SelectItem value="Due on receipt">Due on receipt</SelectItem>
              </SelectContent>
            </Select>
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
        {error ? <p className="text-sm text-negative" data-testid="composer-error">{error}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3.5">
        <Button variant="outline" size="sm" data-testid="composer-save-draft" disabled={busy} onClick={handleSaveDraft}>Save draft</Button>
        <Button variant="outline" size="sm" data-testid="composer-finalize" disabled={busy} onClick={handleFinalize}>Finalize (manual)</Button>
        <div className="flex-1" />
        <Button size="sm" data-testid="composer-send" disabled={busy} onClick={handleSend}>{busy ? "Working…" : "Send via Stripe"}</Button>
      </div>
    </ResponsiveSlideOver>
  );
}

// ---------------------------------------------------------------------------
// InvoiceDetailSheet — the invoice record detail rendered through the SHARED
// DetailSheet (DIVERGENCE 1), so it matches every other section's detail. Hosts
// the AR actions: Finalize/Send reminder, Record payment, Statement, Void, PDF.
// ---------------------------------------------------------------------------

function InvoiceDetailSheet({ invoiceId, onClose }: { invoiceId: Id<"invoices">; onClose: () => void }) {
  const router = useRouter();
  const detail = useQuery(api.invoices.detail, { invoiceId });
  const sendReminder = useMutation(api.invoices.sendReminder);
  const voidInvoice = useMutation(api.invoices.voidInvoice);
  const finalize = useMutation(api.invoices.finalize);
  const recordPayment = useMutation(api.invoices.recordPayment);
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

  async function handleRecordPayment() {
    setBusy(true); setMessage("");
    try {
      const result = await recordPayment({ invoiceId });
      setMessage(`Payment of ${formatMinorMoney(result.paidMinor, { currency: detail?.currency })} recorded — posted to the ledger as money in.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not record the payment.");
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

  // Statement: deep-link straight to the customer's contact detail with the
  // Statements tab preselected (Contacts statements now ship — E5.6). The detail
  // payload carries contactId, so this opens the exact record, not a name search.
  function handleStatement() {
    if (!detail) return;
    router.push(`/contacts?contact=${detail.contactId}&tab=statements`);
    setMessage(`Opening ${detail.customerName}'s statement in Contacts.`);
  }

  function handleDownloadPdf() {
    if (detail?.hostedInvoiceUrl) {
      window.open(detail.hostedInvoiceUrl, "_blank", "noopener,noreferrer");
      setMessage("Opened the hosted invoice — use Download PDF on that page.");
      return;
    }
    window.print();
  }

  const title = detail ? `Invoice ${detail.number}` : "Invoice";
  const subtitle = detail?.customerName;

  const footer = detail ? (
    <div className="flex flex-wrap items-center gap-2">
      {detail.status === "draft" ? (
        <Button size="sm" data-testid="invoice-finalize" disabled={busy} onClick={handleFinalize}>Finalize &amp; issue</Button>
      ) : null}
      {detail.status === "open" || detail.status === "overdue" ? (
        <>
          <Button size="sm" data-testid="invoice-record-payment" disabled={busy} onClick={handleRecordPayment}>Record payment</Button>
          <Button variant="outline" size="sm" data-testid="invoice-send-reminder" disabled={busy} onClick={handleReminder}>Send reminder</Button>
        </>
      ) : null}
      <Button variant="outline" size="sm" data-testid="invoice-statement" onClick={handleStatement}>Statement</Button>
      <Button variant="outline" size="sm" data-testid="invoice-download-pdf" onClick={handleDownloadPdf}>
        <Download className="size-3.5" /> PDF
      </Button>
      {detail.status !== "void" && detail.status !== "paid" ? (
        <Button variant="outline" size="sm" data-testid="invoice-void" disabled={busy} onClick={handleVoid}>Void</Button>
      ) : null}
    </div>
  ) : null;

  return (
    <DetailSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={
        <span className="flex items-center gap-2" data-testid="invoice-detail">
          {title}
          {detail ? <StatusChip status={detail.status} /> : null}
        </span>
      }
      subtitle={subtitle}
      footer={footer}
    >
      {detail === undefined ? (
        <div className="text-sm text-muted-foreground">Loading invoice…</div>
      ) : detail === null ? (
        <EmptyState title="Invoice not found" />
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <div className="money-figures text-2xl font-semibold"><Amount amountMinor={detail.totalMinor} currency={detail.currency} /></div>
            {detail.balanceMinor > 0 && detail.balanceMinor !== detail.totalMinor ? (
              <div className="text-xs text-muted-foreground">
                <span className="money-figures"><Amount amountMinor={detail.balanceMinor} currency={detail.currency} /></span> still owed
              </div>
            ) : null}
          </div>
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
            <div className="flex items-center gap-2 rounded-[10px] bg-negative-surface px-3.5 py-2.5 text-[12.5px] text-negative" data-testid="invoice-overdue-note">
              {detail.daysPastDue} days past due. A polite reminder usually gets these paid within a week.
            </div>
          ) : null}
          {message ? <p className="rounded-[10px] border bg-primary/5 p-3 text-sm text-primary" data-testid="invoice-detail-message">{message}</p> : null}
        </div>
      )}
    </DetailSheet>
  );
}
