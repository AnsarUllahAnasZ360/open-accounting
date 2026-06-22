"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowUpRight,
  Building2,
  CalendarDays,
  Coins,
  FileUp,
  Plus,
  Receipt,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Amount, EmptyState, formatMinorMoney } from "@/components/openbooks/primitives";
import {
  AddMenu,
  AmountFilterPill,
  type AmountValue,
  AttentionState,
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
  EvidenceUpload,
  GroupByMenu,
  type GroupByKey,
  InlineCategoryCombobox,
  InsightBanner,
  InsightBannerExplain,
  buildPageInsight,
  isAmountActive,
  SortMenu,
  type SortState,
  useSavedViews,
  useWorkbenchUrlState,
  type WorkbenchConfig,
  WorkbenchSurface,
  type WorkbenchTableGroup,
} from "@/components/openbooks/workbench";
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AddBillModal,
  BillDetailSheet,
  BillMatchPicker,
  UploadBillModal,
  dueLabel,
  exportBillsCsv,
  useModuleOverview,
} from "@/components/openbooks/ModuleScreens";
import type { BillRow, ModuleOverview } from "@/components/openbooks/module-helpers";
import { statusLabel } from "@/components/openbooks/module-helpers";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useActiveEntity } from "@/lib/openbooks/active-entity";
import { todayIso } from "@/lib/openbooks/today";
import { cn } from "@/lib/utils";

type ExpensesData = FunctionReturnType<typeof api.expensesViews.overview>;
type ExpenseRow = ExpensesData["transactions"][number];
type ServerPeriod = "this" | "last";

const URL_PERIOD_PRESETS: DateRangePreset[] = ["this-month", "last-month", "last-3-months", "ytd"];

/**
 * Map the shared period control to the backend's reconciling period. The server
 * P&L-backed category totals are computed for "this" (month-to-date) or "last"
 * (prior full month); wider presets/custom ranges additionally narrow the
 * transaction-level rows client-side, but the reconciling totals always follow
 * the server period — we never recompute a divergent total on the client.
 */
function rangeToServerPeriod(value: DateRangeValue): ServerPeriod {
  if ("preset" in value) return value.preset === "last-month" ? "last" : "this";
  return "this";
}

// ---------------------------------------------------------------------------
// ExpensesScreen — dispatch on the active sub-tab. Default (cash-movement)
// renders the unified MONEY-OUT table; "bills" renders the AP table. Both go
// through the shared WorkbenchSurface driver + full WorkbenchToolbar (mirrors
// E2 Income). The Insights sub-tab is rendered separately by AppScreen →
// SectionInsights.
// ---------------------------------------------------------------------------

export function ExpensesScreen({ subsection }: { subsection?: string }) {
  if (subsection === "bills") {
    return <BillsApSurface />;
  }
  return <ExpensesCashSurface />;
}

// ---------------------------------------------------------------------------
// Expenses (cash) surface — the unified MONEY-OUT (settled spend) table. Rows =
// expense transactions (cash already spent). The admin-gated inline category
// edit reverses+reposts the ledger via api.categories.recategorizeTransaction —
// the client never posts. Expense tone is NEUTRAL, never alarm-red.
// ---------------------------------------------------------------------------

type ExpensesCashFilters = {
  search: string;
  period: DateRangeValue;
  amount: AmountValue;
  vendor: string[];
  receipt: "missing" | "attached" | null;
  status: "uncategorized" | null;
};

// Fetch wrapper: owns period scope + the data query + the loading/empty early
// returns, then mounts the pure table surface only when the data is defined (so
// every hook below runs unconditionally — E2 parity).
function ExpensesCashSurface() {
  const { activeEntity, scope } = useActiveEntity();
  const searchParams = useSearchParams();

  const initialPeriodParam = searchParams.get("period");
  const initialPeriod: DateRangeValue = URL_PERIOD_PRESETS.includes(initialPeriodParam as DateRangePreset)
    ? { preset: initialPeriodParam as DateRangePreset }
    : { preset: "this-month" };

  const [period, setPeriod] = useState<DateRangeValue>(initialPeriod);
  const [search, setSearch] = useState("");

  const serverPeriod = rangeToServerPeriod(period);
  const data = useQuery(api.expensesViews.overview, {
    ...(scope === "all"
      ? { scope: "all" as const }
      : activeEntity.id
        ? { entityId: activeEntity.id as Id<"entities"> }
        : {}),
    period: serverPeriod,
  });

  // Mirror the preset period into the URL so sidebar subroutes preserve the
  // current workbench context (E2/E0.4 parity).
  const urlState = useWorkbenchUrlState();
  const periodParam = "preset" in period ? period.preset : null;
  const setUrlParams = urlState.setParams;
  useEffect(() => {
    setUrlParams({
      period: periodParam && periodParam !== "this-month" ? periodParam : null,
    });
  }, [periodParam, setUrlParams]);

  if (data === undefined) {
    return (
      <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground shadow-xs" data-testid="expenses-screen">
        Loading expenses…
      </section>
    );
  }
  if (!data.entity) {
    return (
      <div data-testid="expenses-screen">
        <EmptyState
          icon={Building2}
          title="No business yet"
          description="Connect a bank or import a CSV to see where your money goes, by category and vendor."
        />
      </div>
    );
  }

  return (
    <ExpensesCashTable
      data={data}
      period={period}
      setPeriod={setPeriod}
      search={search}
      setSearch={setSearch}
    />
  );
}

function ExpensesCashTable({
  data,
  period,
  setPeriod,
  search,
  setSearch,
}: {
  data: ExpensesData & { entity: NonNullable<ExpensesData["entity"]> };
  period: DateRangeValue;
  setPeriod: (value: DateRangeValue) => void;
  search: string;
  setSearch: (value: string) => void;
}) {
  const { activeEntity, role } = useActiveEntity();
  const router = useRouter();
  // Category management (create + recategorize) is admin-only on the server;
  // mirror it on the add affordance so a member sees a disabled item, not a
  // control that fails closed.
  const canManageCategories = role === "Owner" || role === "Accountant";

  const [amount, setAmount] = useState<AmountValue>({});
  const [vendor, setVendor] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<"missing" | "attached" | null>(null);
  const [status, setStatus] = useState<"uncategorized" | null>(null);
  const [groupBy, setGroupBy] = useState<GroupByKey>("none");
  const [sort, setSort] = useState<SortState>({ key: "date", direction: "desc" });
  const [display, setDisplay] = useState<DisplaySettings>({ density: "comfortable", hiddenColumns: [] });
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Add category folds into the single "+" AddMenu (E5.3) instead of a second
  // standalone icon-button beside it.
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);

  const savedViewsStore = useSavedViews<ExpensesCashFilters>("expenses", activeEntity.id ?? "none");

  const currency = data.entity.currency;
  const categories = data.categories;

  // Vendor facet options scope the table by who got paid.
  const vendorOptions = data.vendors.map((v) => ({ value: v.name, label: v.name }));

  // Client-side refine over the server's period-scoped expense rows. A custom
  // (non-preset) range narrows the rows further; preset windows the server
  // already covers need no extra client filter.
  const term = search.trim().toLowerCase();
  const clientRange = useMemo(() => {
    if ("preset" in period) return null;
    const iso = dateRangeValueToISO(period, todayIso());
    return { from: iso.from, to: iso.to };
  }, [period]);

  const rows = useMemo(() => {
    return data.transactions.filter((row) => {
      if (clientRange && (row.date < clientRange.from || row.date > clientRange.to)) return false;
      const abs = Math.abs(row.amountMinor);
      if (amount.minMinor != null && abs < amount.minMinor) return false;
      if (amount.maxMinor != null && abs > amount.maxMinor) return false;
      if (vendor.length && !vendor.includes(row.merchant)) return false;
      if (receipt === "missing" && row.hasReceipt) return false;
      if (receipt === "attached" && !row.hasReceipt) return false;
      if (status === "uncategorized" && !row.uncategorized) return false;
      if (!term) return true;
      return `${row.merchant} ${row.categoryName}`.toLowerCase().includes(term);
    });
  }, [data.transactions, clientRange, amount, vendor, receipt, status, term]);

  const selectedRow = useMemo(
    () => data.transactions.find((row) => row.id === detailId) ?? null,
    [data.transactions, detailId],
  );

  const columns: ColumnDef<ExpenseRow>[] = [
    {
      key: "date",
      header: "Date",
      mono: true,
      sortable: true,
      priority: 1,
      width: "7rem",
      sortValue: (row) => row.date,
      cell: (row) => <span className="text-xs text-muted-foreground">{row.date}</span>,
    },
    {
      key: "merchant",
      header: "Vendor",
      mobilePrimary: true,
      sortable: true,
      width: "18rem",
      sortValue: (row) => row.merchant,
      cell: (row) => <span className="block truncate font-medium" title={row.merchant}>{row.merchant}</span>,
    },
    {
      key: "category",
      header: "Category",
      width: "12rem",
      cell: (row) => (
        <span onClick={(event) => event.stopPropagation()}>
          <CategorySelect row={row} categories={categories} />
        </span>
      ),
    },
    {
      key: "account",
      header: "Account",
      priority: 2,
      width: "10rem",
      mobileHidden: true,
      cell: (row) => <span className="block truncate text-xs text-muted-foreground" title={row.accountName}>{row.accountName}</span>,
    },
    {
      key: "receipt",
      header: "Receipt",
      priority: 1,
      width: "8rem",
      mobileHidden: true,
      cell: (row) =>
        row.hasReceipt ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Receipt className="size-3.5" aria-hidden="true" />
            Attached
          </span>
        ) : (
          <AttentionState state="missing-evidence" size="sm" />
        ),
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
      // Ordinary expenses are NEUTRAL, never alarm-red.
      cell: (row) => <Amount amountMinor={row.amountMinor} currency={row.currency || currency} tone="expense" />,
    },
  ];

  const visibleColumns = columns.filter((column) => !display.hiddenColumns.includes(column.key));
  const sortMenuColumns = columns
    .filter((column) => column.sortable || column.sortValue)
    .map((column) => ({ key: column.key, label: typeof column.header === "string" && column.header ? column.header : column.key }));
  const columnToggleList = columns
    .filter((column) => !["date", "merchant", "amount"].includes(column.key))
    .map((column) => ({ key: column.key, label: typeof column.header === "string" && column.header ? column.header : column.key }));

  // Group view (driver-shaped) by category / vendor / month when requested.
  const groups: WorkbenchTableGroup<ExpenseRow>[] | null = useMemo(() => {
    if (groupBy === "none") return null;
    const map = new Map<string, ExpenseRow[]>();
    for (const row of rows) {
      const key =
        groupBy === "category"
          ? row.categoryName || "Uncategorized"
          : groupBy === "month"
            ? row.date.slice(0, 7)
            : row.merchant;
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

  // Filter chips + facets (Date, Amount, Vendor, Receipt, Status).
  const isDefaultRange = "preset" in period && period.preset === "this-month";
  const iso = dateRangeValueToISO(period, todayIso());
  const filterFacets: FilterFacetSpec[] = [
    { kind: "custom", key: "date", label: "Date", icon: CalendarDays, active: !isDefaultRange, render: () => <DateRangeControl value={period} onChange={setPeriod} compact /> },
    { kind: "amount", key: "amount", label: "Amount", icon: Coins },
    { kind: "options", key: "vendor", label: "Vendor", mode: "multi", icon: Building2, options: vendorOptions },
    {
      kind: "options",
      key: "receipt",
      label: "Receipt",
      mode: "single",
      icon: Receipt,
      options: [
        { value: "missing", label: "Missing" },
        { value: "attached", label: "Attached" },
      ],
    },
    {
      kind: "options",
      key: "status",
      label: "Status",
      mode: "single",
      icon: Coins,
      options: [{ value: "uncategorized", label: "Uncategorized" }],
    },
  ];
  const filterPanelValue: FilterPanelValue = {
    amount,
    vendor,
    receipt: receipt ? [receipt] : [],
    status: status ? [status] : [],
  };
  function onFilterPanelChange(key: string, next: unknown) {
    if (key === "amount") setAmount(next as AmountValue);
    else if (key === "vendor") setVendor(next as string[]);
    else if (key === "receipt") {
      const value = (next as string[])[0];
      setReceipt(value === "missing" || value === "attached" ? value : null);
    } else if (key === "status") {
      const value = (next as string[])[0];
      setStatus(value === "uncategorized" ? value : null);
    }
  }
  function clearAllFilters() {
    setSearch("");
    setPeriod({ preset: "this-month" });
    setAmount({});
    setVendor([]);
    setReceipt(null);
    setStatus(null);
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
  for (const value of vendor) chips.push({ key: `vendor:${value}`, label: `Vendor: ${value}` });
  if (receipt) chips.push({ key: "receipt", label: `Receipt: ${receipt === "missing" ? "Missing" : "Attached"}` });
  if (status) chips.push({ key: "status", label: "Uncategorized" });
  function removeChip(key: string) {
    if (key === "date") setPeriod({ preset: "this-month" });
    else if (key === "amount") setAmount({});
    else if (key === "receipt") setReceipt(null);
    else if (key === "status") setStatus(null);
    else if (key.startsWith("vendor:")) setVendor(vendor.filter((value) => `vendor:${value}` !== key));
  }

  // Saved views (FE-only, shared store). Ships a built-in "Missing receipt"
  // view (replaces the old Evidence tab) plus the user's own views.
  const DEFAULT_FILTERS: ExpensesCashFilters = { search: "", period: { preset: "this-month" }, amount: {}, vendor: [], receipt: null, status: null };
  const MISSING_RECEIPT_VIEW_ID = "builtin:missing-receipt";
  const MISSING_RECEIPT_FILTERS: ExpensesCashFilters = { ...DEFAULT_FILTERS, receipt: "missing" };
  function captureFilters(): ExpensesCashFilters {
    return { search: "", period, amount, vendor, receipt, status };
  }
  function applyFilters(filters: ExpensesCashFilters) {
    setSearch("");
    setPeriod(filters.period);
    setAmount(filters.amount);
    setVendor(filters.vendor);
    setReceipt(filters.receipt);
    setStatus(filters.status);
  }
  const savedViewSummaries = [
    { id: MISSING_RECEIPT_VIEW_ID, name: "Missing receipt", builtIn: true },
    ...savedViewsStore.userViews.map((view) => ({ id: view.id, name: view.name, builtIn: false })),
  ];
  const activeView = savedViewsStore.userViews.find((view) => view.id === activeViewId) ?? null;
  const activeFilters =
    activeViewId === MISSING_RECEIPT_VIEW_ID ? MISSING_RECEIPT_FILTERS : activeView?.filters ?? DEFAULT_FILTERS;
  const viewDirty = JSON.stringify(captureFilters()) !== JSON.stringify(activeFilters);

  const config: WorkbenchConfig<ExpenseRow> = {
    section: "expenses",
    title: "Expenses",
    subtabs: [
      { id: "expenses", label: "Expenses", subtitle: "Money spent", kind: "cash-movement" },
      { id: "bills", label: "Bills", subtitle: "Accounts payable", kind: "ledger" },
      { id: "insights", label: "Insights", kind: "insights" },
    ],
    columns,
    defaultVisibleColumns: visibleColumns.map((column) => column.key),
    filterFacets,
    groupByOptions: ["none", "category", "month", "contact"],
    sortableColumns: sortMenuColumns,
    defaultSort: { key: "date", direction: "desc" },
    primaryActions: [],
    bulkActions: [],
    rowToDetail: () => null,
  };

  // E8-T4: the single Expenses page-insight — biggest mover / recurring run-rate /
  // top vendor — built from the SAME expensesViews.overview read-model this table
  // already loaded. Ordinary spend stays neutral (never alarm-red). Hidden when
  // the builder returns null.
  const pageInsight = buildPageInsight("expenses", {
    entity: { currency: data.entity.currency },
    kpis: data.kpis,
  });
  // The Explain window: the server period (this / last month) mapped to ISO.
  const explainIso = dateRangeValueToISO(
    rangeToServerPeriod(period) === "last" ? { preset: "last-month" } : { preset: "this-month" },
    todayIso(),
  );

  return (
    <WorkbenchSurface<ExpenseRow>
      config={config}
      testId="expenses-screen"
      banner={
        pageInsight ? (
          <InsightBanner
            page="expenses"
            insight={pageInsight}
            explainSlot={
              <InsightBannerExplain section="expenses" entityId={data.entity.id} from={explainIso.from} to={explainIso.to} />
            }
          />
        ) : null
      }
      savedViews={{
        views: savedViewSummaries,
        activeViewId,
        dirty: viewDirty,
        allLabel: "All expenses",
        onSelect: (id) => {
          if (!id) {
            applyFilters(DEFAULT_FILTERS);
            setActiveViewId(null);
            return;
          }
          if (id === MISSING_RECEIPT_VIEW_ID) {
            applyFilters(MISSING_RECEIPT_FILTERS);
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
          if (id === MISSING_RECEIPT_VIEW_ID) return;
          savedViewsStore.replaceFilters(id, captureFilters());
        },
        onDelete: (id) => {
          if (id === MISSING_RECEIPT_VIEW_ID) return;
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
          <GroupByMenu noun="expenses" value={groupBy} onChange={setGroupBy} options={[{ key: "none", label: "No grouping" }, { key: "category", label: "Category" }, { key: "month", label: "Month" }, { key: "contact", label: "Vendor" }]} />
          <SortMenu noun="expenses" columns={sortMenuColumns} value={sort} onChange={setSort} />
          <DisplaySettingsMenu value={display} onChange={setDisplay} columns={columnToggleList} />
          {/* ONE "+" entry point for the section: the add-expense action plus the
              folded-in create-category action (admin-gated, still mints a real
              ledger account). No second standalone icon-button (E5.3). */}
          <AddMenu
            addLabel="Add expense"
            addTestId="expenses-add-expense"
            onAddTransaction={() => router.push("/transactions")}
            extraItems={[
              {
                label: "Add category",
                testId: "expenses-add-category",
                disabled: !canManageCategories,
                onSelect: () => setAddCategoryOpen(true),
              },
            ]}
            exportChoices={[{ label: "Expenses (spent) — CSV", onSelect: () => exportExpensesCsv(rows, currency) }]}
          />
        </>
      }
      columns={visibleColumns}
      rows={rows}
      groups={groups}
      getRowId={(row) => row.id}
      onRowClick={(row) => setDetailId(row.id)}
      density={display.density}
      sort={sort}
      onSortChange={setSort}
      rowAttributes={(row) => ({ "data-testid": "expense-row", "data-transaction-id": row.id })}
      empty={
        <div data-testid="expenses-empty">
          <EmptyState
            icon={Receipt}
            title="No expenses in this view"
            description="Adjust the date range or filters, or import transactions to see your costs here. Bills you owe live in the Bills tab."
          />
        </div>
      }
      emptyGroups={<EmptyState title="No expenses in this view" description="Adjust the filters above to see more." />}
      overlays={
        <>
          <ExpenseDetailSheet
            row={selectedRow}
            open={detailId != null}
            currency={currency}
            categories={categories}
            onOpenChange={(open) => setDetailId(open ? detailId : null)}
            onDrill={(id) => router.push(`/transactions?focus=${id}`)}
          />
          <AddCategoryModal
            entityId={data.entity.id as Id<"entities">}
            hideTrigger
            open={addCategoryOpen}
            onOpenChange={setAddCategoryOpen}
          />
        </>
      }
    />
  );
}

// The admin-gated inline category edit — PRESERVED from the prior Expenses
// build, now on the SAME InlineCategoryCombobox primitive Transactions uses for
// the same column (E5.3), so the cells read identically side by side. Reuses the
// SHARED ledger path: recategorizeTransaction reverses + reposts the journal
// entry server-side. The client never posts.
function CategorySelect({
  row,
  categories,
}: {
  row: ExpenseRow;
  categories: ExpensesData["categories"];
}) {
  const recategorize = useMutation(api.categories.recategorizeTransaction);
  const { role } = useActiveEntity();
  // recategorize is admin-only on the server; match the affordance so a member
  // doesn't get a control that always fails with a toast. `role` is the
  // workspace display label (Owner / Accountant / Staff); admin == Owner/Accountant.
  const canManage = role === "Owner" || role === "Accountant";
  const [busy, setBusy] = useState(false);

  const options = categories.map((category) => ({
    id: category.id,
    label: category.name,
    type: "expense",
  }));

  async function handleChange(value: string) {
    if (value === row.categoryAccountId) return;
    setBusy(true);
    try {
      await recategorize({
        transactionId: row.id as Id<"transactions">,
        categoryAccountId: value as Id<"ledgerAccounts">,
      });
      toast.success("Recategorized — the ledger reposted automatically.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not recategorize.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <InlineCategoryCombobox
      value={row.categoryAccountId ?? null}
      options={options}
      onChange={handleChange}
      disabled={busy || !canManage}
      needsReview={row.uncategorized}
      testId="expense-category-select"
    />
  );
}

function ExpenseDetailSheet({
  row,
  open,
  currency,
  categories,
  onOpenChange,
  onDrill,
}: {
  row: ExpenseRow | null;
  open: boolean;
  currency: string;
  categories: ExpensesData["categories"];
  onOpenChange: (open: boolean) => void;
  onDrill: (id: string) => void;
}) {
  if (!row) return null;
  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row.merchant}
      subtitle={
        <span className="money-figures">
          {row.date} · {formatMinorMoney(row.amountMinor, { currency: row.currency || currency })}
        </span>
      }
      attention={row.hasReceipt ? undefined : <AttentionState state="missing-evidence" />}
      footer={
        <Button size="sm" variant="outline" data-testid="expense-open-in-register" onClick={() => onDrill(row.id)}>
          <ArrowUpRight data-icon="inline-start" />
          Open in register
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="money-figures font-medium">
              <Amount amountMinor={row.amountMinor} currency={row.currency || currency} tone="expense" />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Account</dt>
            <dd>{row.accountName}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Category</dt>
            <dd>
              <CategorySelect row={row} categories={categories} />
            </dd>
          </div>
        </dl>
        <EvidenceUpload
          target={{ kind: "transaction", id: row.id }}
          document={
            row.hasReceipt
              ? {
                  id: row.id,
                  vendor: row.merchant,
                  date: row.date,
                  totalMinor: row.amountMinor,
                  currency: row.currency || currency,
                  status: "matched",
                  matched: true,
                }
              : null
          }
          onUpload={() => onDrill(row.id)}
        />
      </div>
    </DetailSheet>
  );
}

function exportExpensesCsv(rows: ExpenseRow[], currency: string) {
  const header = ["Date", "Vendor", "Category", "Account", "Receipt", "Amount", "Currency"];
  const lines = rows.map((row) => [
    row.date,
    row.merchant,
    row.categoryName,
    row.accountName,
    row.hasReceipt ? "attached" : "missing",
    (row.amountMinor / 100).toFixed(2),
    row.currency || currency,
  ]);
  const csv = [header, ...lines]
    .map((cells) => cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  if (typeof document === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "expenses.csv";
  link.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Bills (AP) surface — the accounts-payable table on the SAME driver. AP money
// bar (Owed · Overdue · Due soon · Paid). Columns: vendor, bill #, bill date,
// DUE, status, amount, BALANCE. Actions: Add bill, Upload bill PDF, Pay (mark
// paid → BillMatchPicker), Schedule (expect a match). Reuses the existing bill
// detail + match picker + mark-paid settlement (rendered via the shared
// DetailSheet). Mirrors E2's Invoices (AR) surface.
// ---------------------------------------------------------------------------

type BillFilters = { search: string; status: string[]; source: string[]; receipt: "missing" | null };
const BILL_STATUSES = [
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "due-soon", label: "Due soon" },
  { value: "paid", label: "Paid" },
];
const BILL_SOURCES = [
  { value: "manual", label: "Manual" },
  { value: "pdf", label: "PDF" },
];

// Fetch wrapper: the bills read-model + early returns, then the pure table.
function BillsApSurface() {
  const data = useModuleOverview();

  if (data === undefined) {
    return (
      <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground shadow-xs" data-testid="expenses-bills-screen">
        Loading bills…
      </section>
    );
  }
  if (!data.entity) {
    return (
      <div data-testid="expenses-bills-screen">
        <EmptyState
          icon={Building2}
          title="No business yet"
          description="Add a bill or upload a PDF and AI reads off the vendor, amount, and due date."
        />
      </div>
    );
  }

  return <BillsApTable data={data} entity={data.entity} />;
}

function BillsApTable({
  data,
  entity,
}: {
  data: ModuleOverview;
  entity: NonNullable<ModuleOverview["entity"]>;
}) {
  const { activeEntity } = useActiveEntity();
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [source, setSource] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<"missing" | null>(null);
  const [groupBy, setGroupBy] = useState<GroupByKey>("none");
  const [sort, setSort] = useState<SortState>({ key: "due", direction: "asc" });
  const [display, setDisplay] = useState<DisplaySettings>({ density: "comfortable", hiddenColumns: [] });
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [detailBillId, setDetailBillId] = useState<string | null>(null);
  const [payBill, setPayBill] = useState<BillRow | null>(null);
  // Add bill + Upload bill PDF fold into the single "+" AddMenu (E5.3) instead
  // of two standalone trigger buttons beside it.
  const [addBillOpen, setAddBillOpen] = useState(false);
  const [uploadBillOpen, setUploadBillOpen] = useState(false);

  const savedViewsStore = useSavedViews<BillFilters>("expenses-bills", activeEntity.id ?? "none");

  const currency = entity.currency;

  // Flatten the server's due-window groups into one ordered AP list.
  const allBills = data.bills.groups.flatMap((group) => group.rows);
  const selectedBill = allBills.find((bill) => bill.id === detailBillId) ?? null;

  const term = search.trim().toLowerCase();
  const rows = useMemo(() => {
    return allBills.filter((bill) => {
      if (statusFilter.length) {
        const matches = statusFilter.some((value) => {
          if (value === "open") return bill.status === "open";
          if (value === "overdue") return bill.isOverdue;
          if (value === "due-soon") return bill.isDueSoon;
          if (value === "paid") return bill.status === "paid";
          return false;
        });
        if (!matches) return false;
      }
      if (source.length && !source.includes(bill.source)) return false;
      if (receipt === "missing" && bill.hasEvidence) return false;
      if (!term) return true;
      return `${bill.vendorName} ${bill.category ?? ""}`.toLowerCase().includes(term);
    });
  }, [allBills, statusFilter, source, receipt, term]);

  const columns: ColumnDef<BillRow>[] = [
    {
      key: "vendor",
      header: "Vendor",
      mobilePrimary: true,
      sortable: true,
      sortValue: (row) => row.vendorName,
      cell: (row) => (
        <span data-testid="bill-vendor-cell" className="font-medium">
          {row.vendorName}
        </span>
      ),
    },
    {
      key: "billDate",
      header: "Bill date",
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
      priority: 1,
      sortable: true,
      sortValue: (row) => row.dueDate,
      cell: (row) => (
        <span
          data-testid="bill-due-cell"
          className={cn(
            "text-xs",
            row.isOverdue ? "text-negative" : row.isDueSoon ? "text-warning" : "text-muted-foreground",
          )}
        >
          {row.dueDate}
          {row.status !== "paid" ? ` · ${dueLabel(row)}` : ""}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      priority: 2,
      cell: (row) => <BillStatusChip bill={row} />,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      mono: true,
      sortable: true,
      sortValue: (row) => row.totalMinor,
      cell: (row) => (
        <span data-testid="bill-amount-cell">
          <Amount amountMinor={row.totalMinor} currency={row.currency || currency} tone="expense" />
        </span>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      mono: true,
      mobileTrailing: true,
      sortable: true,
      // Balance: full total while open, zero once paid.
      sortValue: (row) => (row.status === "paid" ? 0 : row.totalMinor),
      cell: (row) =>
        row.status === "paid" ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Amount amountMinor={row.totalMinor} currency={row.currency || currency} tone="expense" />
        ),
    },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (row) =>
        row.status === "open" ? (
          <span onClick={(event) => event.stopPropagation()}>
            <Button size="sm" variant="outline" data-testid="bill-mark-paid" onClick={() => setPayBill(row)}>
              Pay
            </Button>
          </span>
        ) : (
          <span />
        ),
    },
  ];

  const visibleColumns = columns.filter((column) => !display.hiddenColumns.includes(column.key));
  const sortMenuColumns = columns
    .filter((column) => column.sortable || column.sortValue)
    .map((column) => ({ key: column.key, label: typeof column.header === "string" && column.header ? column.header : column.key }));
  const columnToggleList = columns
    .filter((column) => !["vendor", "balance", "action"].includes(column.key))
    .map((column) => ({ key: column.key, label: typeof column.header === "string" && column.header ? column.header : column.key }));

  const groups: WorkbenchTableGroup<BillRow>[] | null = useMemo(() => {
    if (groupBy === "none") return null;
    const map = new Map<string, BillRow[]>();
    for (const row of rows) {
      const key =
        groupBy === "contact"
          ? row.vendorName
          : row.status === "paid"
            ? "Paid"
            : row.isOverdue
              ? "Overdue"
              : row.isDueSoon
                ? "Due soon"
                : "Later";
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([label, groupRows]) => ({
        label,
        rows: groupRows,
        summary: `${groupRows.length} · ${formatMinorMoney(groupRows.reduce((sum, r) => sum + r.totalMinor, 0), { currency })}`,
      }))
      .sort((a, b) => b.rows.length - a.rows.length);
  }, [rows, groupBy, currency]);

  const filterFacets: FilterFacetSpec[] = [
    { kind: "options", key: "status", label: "Status", mode: "multi", icon: Coins, options: BILL_STATUSES },
    { kind: "options", key: "source", label: "Source", mode: "multi", icon: FileUp, options: BILL_SOURCES },
    { kind: "options", key: "receipt", label: "Evidence", mode: "single", icon: Receipt, options: [{ value: "missing", label: "Missing" }] },
  ];
  const filterPanelValue: FilterPanelValue = { status: statusFilter, source, receipt: receipt ? [receipt] : [] };
  function onFilterPanelChange(key: string, next: unknown) {
    if (key === "status") setStatusFilter(next as string[]);
    else if (key === "source") setSource(next as string[]);
    else if (key === "receipt") setReceipt((next as string[])[0] === "missing" ? "missing" : null);
  }
  function clearAllFilters() {
    setSearch("");
    setStatusFilter([]);
    setSource([]);
    setReceipt(null);
    setActiveViewId(null);
  }
  const chips: ActiveChip[] = [];
  for (const value of statusFilter) chips.push({ key: `status:${value}`, label: `Status: ${BILL_STATUSES.find((s) => s.value === value)?.label ?? value}` });
  for (const value of source) chips.push({ key: `source:${value}`, label: `Source: ${BILL_SOURCES.find((s) => s.value === value)?.label ?? value}` });
  if (receipt) chips.push({ key: "receipt", label: "Evidence: Missing" });
  function removeChip(key: string) {
    if (key === "receipt") setReceipt(null);
    else if (key.startsWith("status:")) setStatusFilter(statusFilter.filter((value) => `status:${value}` !== key));
    else if (key.startsWith("source:")) setSource(source.filter((value) => `source:${value}` !== key));
  }

  const DEFAULT_FILTERS: BillFilters = { search: "", status: [], source: [], receipt: null };
  const MISSING_RECEIPT_VIEW_ID = "builtin:missing-evidence";
  const MISSING_RECEIPT_FILTERS: BillFilters = { ...DEFAULT_FILTERS, receipt: "missing" };
  function captureFilters(): BillFilters {
    return { search: "", status: statusFilter, source, receipt };
  }
  function applyFilters(filters: BillFilters) {
    setSearch("");
    setStatusFilter(filters.status);
    setSource(filters.source);
    setReceipt(filters.receipt);
  }
  const savedViewSummaries = [
    { id: MISSING_RECEIPT_VIEW_ID, name: "Missing evidence", builtIn: true },
    ...savedViewsStore.userViews.map((view) => ({ id: view.id, name: view.name, builtIn: false })),
  ];
  const activeView = savedViewsStore.userViews.find((view) => view.id === activeViewId) ?? null;
  const activeFilters =
    activeViewId === MISSING_RECEIPT_VIEW_ID ? MISSING_RECEIPT_FILTERS : activeView?.filters ?? DEFAULT_FILTERS;
  const viewDirty = JSON.stringify(captureFilters()) !== JSON.stringify(activeFilters);

  const config: WorkbenchConfig<BillRow> = {
    section: "expenses",
    title: "Bills",
    subtabs: [
      { id: "expenses", label: "Expenses", subtitle: "Money spent", kind: "cash-movement" },
      { id: "bills", label: "Bills", subtitle: "Accounts payable", kind: "ledger" },
      { id: "insights", label: "Insights", kind: "insights" },
    ],
    columns,
    defaultVisibleColumns: visibleColumns.map((column) => column.key),
    filterFacets,
    // Config matches the rendered menu keys (E5.3) — Status + Vendor, not category.
    groupByOptions: ["none", "status", "contact"],
    sortableColumns: sortMenuColumns,
    defaultSort: { key: "due", direction: "asc" },
    primaryActions: [],
    bulkActions: [],
    rowToDetail: (row) => ({ title: row.vendorName, tabs: [] }),
  };

  // E8-T5: the single Bills page-insight — overdue / due-soon / open payables —
  // built from the SAME moduleViews.overview.bills.kpis read-model this table
  // already loaded. Aging/overdue use the server-clock anchor (E8-T1/T2). Hidden
  // when the builder returns null.
  const pageInsight = buildPageInsight("bills", {
    entity: { currency: entity.currency },
    bills: { kpis: data.bills.kpis },
  });

  return (
    <WorkbenchSurface<BillRow>
      config={config}
      testId="expenses-bills-screen"
      banner={
        pageInsight ? (
          <InsightBanner
            page="bills"
            insight={pageInsight}
            onChip={(action) => {
              if (action === "overdue-bills") setStatusFilter(["overdue"]);
            }}
            explainSlot={<InsightBannerExplain section="bills" entityId={entity.id} />}
          />
        ) : null
      }
      savedViews={{
        views: savedViewSummaries,
        activeViewId,
        dirty: viewDirty,
        allLabel: "All bills",
        onSelect: (id) => {
          if (!id) {
            applyFilters(DEFAULT_FILTERS);
            setActiveViewId(null);
            return;
          }
          if (id === MISSING_RECEIPT_VIEW_ID) {
            applyFilters(MISSING_RECEIPT_FILTERS);
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
          if (id === MISSING_RECEIPT_VIEW_ID) return;
          savedViewsStore.replaceFilters(id, captureFilters());
        },
        onDelete: (id) => {
          if (id === MISSING_RECEIPT_VIEW_ID) return;
          savedViewsStore.remove(id);
          if (activeViewId === id) setActiveViewId(null);
        },
      }}
      chips={chips}
      onRemoveChip={removeChip}
      onClearAll={clearAllFilters}
      pills={
        <FilterPanelButton facets={filterFacets} value={filterPanelValue} onChange={onFilterPanelChange} onClearAll={clearAllFilters} />
      }
      trailing={
        <>
          <GroupByMenu noun="bills" value={groupBy} onChange={setGroupBy} options={[{ key: "none", label: "No grouping" }, { key: "status", label: "Status" }, { key: "contact", label: "Vendor" }]} />
          <SortMenu noun="bills" columns={sortMenuColumns} value={sort} onChange={setSort} />
          <DisplaySettingsMenu value={display} onChange={setDisplay} columns={columnToggleList} />
          {/* ONE "+" entry point: Add bill + Upload bill PDF folded into the menu
              (E5.3) — no standalone modal-trigger buttons beside it. */}
          <AddMenu
            addLabel="Add bill"
            addTestId="bills-add-bill"
            onAddTransaction={() => setAddBillOpen(true)}
            extraItems={[
              {
                label: "Upload bill PDF",
                icon: <FileUp />,
                testId: "bills-upload-bill",
                onSelect: () => setUploadBillOpen(true),
              },
            ]}
            exportChoices={[{ label: "Bills (AP) — CSV", onSelect: () => exportBillsCsv(rows, currency) }]}
          />
        </>
      }
      columns={visibleColumns}
      rows={rows}
      groups={groups}
      getRowId={(row) => row.id}
      onRowClick={(row) => setDetailBillId(row.id)}
      density={display.density}
      sort={sort}
      onSortChange={setSort}
      rowAttributes={(row) => ({ "data-testid": "bill-row", "data-bill-id": row.id })}
      attention={(row) => (row.attention ? <AttentionState state={row.attention} size="sm" iconOnly /> : null)}
      empty={
        <div data-testid="expenses-bills-empty">
          <EmptyState
            icon={Receipt}
            title="No bills in this view"
            description="Add a bill or upload a PDF and AI reads off the vendor, amount, and due date."
          />
        </div>
      }
      emptyGroups={<EmptyState title="No bills in this view" description="Adjust the filters above to see more." />}
      overlays={
        <>
          <BillDetailSheet
            bill={selectedBill}
            open={detailBillId != null}
            currency={currency}
            onOpenChange={(open) => setDetailBillId(open ? detailBillId : null)}
            onMarkPaid={setPayBill}
            onViewTransaction={(txnId) => router.push(`/transactions?focus=${txnId}`)}
          />
          {payBill ? (
            <BillMatchPicker
              billId={payBill.id as Id<"bills">}
              vendorName={payBill.vendorName}
              onClose={() => setPayBill(null)}
              onSettled={() => setDetailBillId(null)}
            />
          ) : null}
          <AddBillModal
            entityId={entity.id as Id<"entities">}
            hideTrigger
            open={addBillOpen}
            onOpenChange={setAddBillOpen}
          />
          <UploadBillModal
            entityId={entity.id as Id<"entities">}
            hideTrigger
            open={uploadBillOpen}
            onOpenChange={setUploadBillOpen}
          />
        </>
      }
    />
  );
}

// AP status chip — money-at-risk (overdue) carries the negative token; due-soon
// carries warning; everything else stays calm. Mirrors the AR StatusChip tone
// discipline (color always paired with a label).
function BillStatusChip({ bill }: { bill: BillRow }) {
  const { label, className } =
    bill.status === "paid"
      ? { label: "Paid", className: "bg-primary/10 text-primary" }
      : bill.isOverdue
        ? { label: "Overdue", className: "bg-negative-surface text-negative" }
        : bill.isDueSoon
          ? { label: "Due soon", className: "bg-warning-surface text-warning" }
          : { label: statusLabel(bill.status), className: "bg-muted text-muted-foreground" };
  return (
    <span className={`inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium ${className}`}>
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

// Create-category modal — PRESERVED from the prior Expenses build. It mints a
// real ledger account (account 6xxx under Expenses), admin-gated on the server,
// so a member sees a disabled trigger rather than a control that fails closed.
function AddCategoryModal({
  entityId,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  entityId: Id<"entities">;
  /** Controlled-open (folds the trigger into the section AddMenu — E5.3). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const createCategory = useMutation(api.categories.createCategory);
  const { role } = useActiveEntity();
  const canManage = role === "Owner" || role === "Accountant";
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [name, setName] = useState("");
  const [group, setGroup] = useState<"Expenses" | "Income" | "Other">("Expenses");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    if (!name.trim()) {
      setError("Give the category a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createCategory({ entityId, name: name.trim(), group });
      setOpen(false);
      setName("");
      toast.success("Category created — it's ready to use in transactions and reports.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the category.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {hideTrigger ? null : (
        <DialogTrigger asChild>
          <Button
            size="icon-sm"
            variant="outline"
            data-testid="expenses-add-category"
            disabled={!canManage}
            aria-label="Add category"
            title={canManage ? "Add category" : "Only workspace admins can add categories."}
          >
            <Plus />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent data-testid="add-category-modal">
        <DialogHeader>
          <DialogTitle>New category</DialogTitle>
          <DialogDescription>
            It becomes a real account in your books — usable in transactions, rules and reports right away.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-2">
            <Label htmlFor="category-name">Name</Label>
            <Input
              id="category-name"
              data-testid="category-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Conferences & Events"
            />
          </div>
          <div className="grid gap-2">
            <Label>Group</Label>
            <Select value={group} onValueChange={(value) => setGroup(value as typeof group)}>
              <SelectTrigger data-testid="category-group">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="Expenses">Expenses</SelectItem>
                  <SelectItem value="Income">Income</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Behind the scenes this creates account 6xxx under Expenses — visible in accountant mode.
            </p>
          </div>
          {error ? <p className="text-sm text-negative">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" data-testid="category-create" disabled={busy} onClick={handleCreate}>
            {busy ? "Creating…" : "Create category"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
