"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  AlertCircle,
  Archive,
  Building2,
  CalendarDays,
  Download,
  FileText,
  Lock,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Amount, EmptyState, formatMinorMoney } from "@/components/openbooks/primitives";
import {
  AddMenu,
  type ActiveChip,
  type ColumnDef,
  DetailSheet,
  DisplaySettingsMenu,
  type DisplaySettings,
  type FilterFacetSpec,
  type FilterPanelValue,
  FilterPanelButton,
  GroupByMenu,
  type GroupByKey,
  InsightBanner,
  InsightBannerExplain,
  buildPageInsight,
  SortMenu,
  type SortState,
  useSavedViews,
  type WorkbenchConfig,
  WorkbenchSurface,
  type WorkbenchTableGroup,
} from "@/components/openbooks/workbench";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useActiveEntity } from "@/lib/openbooks/active-entity";
import { cn } from "@/lib/utils";

type ModuleData = FunctionReturnType<typeof api.moduleViews.overview>;
type ContactRow = NonNullable<ModuleData>["contacts"]["rows"][number];
type ContactProfile = NonNullable<FunctionReturnType<typeof api.contacts.contactProfile>>;

// ---------------------------------------------------------------------------
// ContactsScreen — the unified directory + Insights section, rendered through the
// SAME shared WorkbenchSurface driver + full WorkbenchToolbar as Transactions /
// Income / Expenses (E4). Two sub-tabs: [Contacts · Insights]. The Insights tab
// is rendered by AppScreen → SectionInsights; here we render the directory.
// ---------------------------------------------------------------------------

export function ContactsScreen() {
  const { activeEntity } = useActiveEntity();
  const searchParams = useSearchParams();
  const data = useQuery(
    api.moduleViews.overview,
    activeEntity.id ? { entityId: activeEntity.id as Id<"entities"> } : {},
  );

  const focusContactId = searchParams.get("contact");
  const focusTab = searchParams.get("tab");

  if (data === undefined) {
    return <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground shadow-xs">Loading contacts…</section>;
  }
  if (!data.entity) {
    return (
      <EmptyState
        icon={Building2}
        title="No business yet"
        description="Most contacts are created automatically as money moves. Connect a bank or add one by hand to get started."
      />
    );
  }

  return (
    <ContactsDirectory
      data={data}
      focusContactId={focusContactId}
      focusTab={focusTab}
    />
  );
}

type ContactFilters = { search: string; role: "all" | "customer" | "vendor"; quick: string[] };
const DEFAULT_FILTERS: ContactFilters = { search: "", role: "all", quick: [] };

const QUICK_FACETS = [
  { value: "open-ar", label: "Open A/R" },
  { value: "open-ap", label: "Open A/P" },
  { value: "recent", label: "Recently active" },
  { value: "archived", label: "Archived" },
] as const;

function ContactsDirectory({
  data,
  focusContactId,
  focusTab,
}: {
  data: NonNullable<ModuleData>;
  focusContactId: string | null;
  /** Optional deep-link tab (e.g. "statements") for the opened contact detail. */
  focusTab?: string | null;
}) {
  const entity = data.entity!;
  const currency = entity.currency;

  const [search, setSearch] = useState("");
  const [role, setRole] = useState<"all" | "customer" | "vendor">("all");
  const [quick, setQuick] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<GroupByKey>("none");
  const [sort, setSort] = useState<SortState>({ key: "name", direction: "asc" });
  const [display, setDisplay] = useState<DisplaySettings>({ density: "comfortable", hiddenColumns: [] });
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(focusContactId);

  const savedViewsStore = useSavedViews<ContactFilters>("contacts", entity.id);

  const showArchived = quick.includes("archived");
  const term = search.trim().toLowerCase();
  const rows = useMemo(() => {
    return data.contacts.rows.filter((contact) => {
      if (contact.archived !== showArchived) return false;
      if (role !== "all" && !contact.roles.includes(role)) return false;
      if (quick.includes("open-ar") && contact.openReceivableMinor <= 0) return false;
      if (quick.includes("open-ap") && contact.openPayableMinor <= 0) return false;
      if (quick.includes("recent") && !isRecentlyActive(contact)) return false;
      if (!term) return true;
      return `${contact.name} ${contact.email ?? ""} ${contact.aliases.join(" ")}`.toLowerCase().includes(term);
    });
  }, [data.contacts.rows, role, quick, showArchived, term]);

  const columns: ColumnDef<ContactRow>[] = [
    {
      key: "name",
      header: "Name",
      mobilePrimary: true,
      sortable: true,
      sortValue: (row) => row.name,
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar className="size-7 shrink-0">
            <AvatarFallback className="text-[10px]">{initials(row.name)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0">
            <span className="block truncate font-medium">{row.name}</span>
            {row.aliases.length > 0 ? (
              <span className="block truncate text-xs text-muted-foreground">{row.aliases.slice(0, 2).join(" · ")}</span>
            ) : null}
          </span>
        </span>
      ),
    },
    {
      key: "roles",
      header: "Role",
      priority: 1,
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.roles.map((r) => (
            <RoleChip key={r} role={r} />
          ))}
        </span>
      ),
    },
    {
      key: "moneyIn",
      header: "Money in YTD",
      align: "right",
      mono: true,
      priority: 2,
      sortable: true,
      sortValue: (row) => row.moneyInYtdMinor,
      cell: (row) =>
        row.moneyInYtdMinor > 0 ? (
          <Amount amountMinor={row.moneyInYtdMinor} currency={currency} tone="income" />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "moneyOut",
      header: "Money out YTD",
      align: "right",
      mono: true,
      priority: 2,
      sortable: true,
      sortValue: (row) => row.moneyOutYtdMinor,
      cell: (row) =>
        row.moneyOutYtdMinor > 0 ? (
          <Amount amountMinor={row.moneyOutYtdMinor} currency={currency} tone="expense" />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "balance",
      header: "Open balance",
      align: "right",
      mono: true,
      mobileTrailing: true,
      sortable: true,
      sortValue: (row) => row.openReceivableMinor - row.openPayableMinor,
      cell: (row) => <OpenBalanceCell row={row} currency={currency} />,
    },
    {
      key: "lastActivity",
      header: "Last activity",
      mono: true,
      priority: 1,
      sortable: true,
      sortValue: (row) => row.lastActivityDate ?? "",
      cell: (row) => <span className="text-xs text-muted-foreground">{row.lastActivityDate ?? "—"}</span>,
    },
    {
      key: "rule",
      header: "Default category",
      priority: 2,
      cell: (row) =>
        row.defaultCategory ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-ai">
            <Sparkles className="size-3.5" aria-hidden="true" />
            {row.defaultCategory.name}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  const visibleColumns = columns.filter((column) => !display.hiddenColumns.includes(column.key));
  const sortMenuColumns = columns
    .filter((column) => column.sortable || column.sortValue)
    .map((column) => ({ key: column.key, label: typeof column.header === "string" && column.header ? column.header : column.key }));
  const columnToggleList = columns
    .filter((column) => !["name", "balance"].includes(column.key))
    .map((column) => ({ key: column.key, label: typeof column.header === "string" && column.header ? column.header : column.key }));

  // Group view by role.
  const groups: WorkbenchTableGroup<ContactRow>[] | null = useMemo(() => {
    if (groupBy === "none") return null;
    const map = new Map<string, ContactRow[]>();
    for (const row of rows) {
      const key =
        groupBy === "category"
          ? row.defaultCategory?.name ?? "No default category"
          : row.roles.includes("customer") && row.roles.includes("vendor")
            ? "Customer & vendor"
            : row.roles.includes("customer")
              ? "Customers"
              : "Vendors";
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([label, groupRows]) => ({
        label,
        rows: groupRows,
        summary: `${groupRows.length} contact${groupRows.length === 1 ? "" : "s"}`,
      }))
      .sort((a, b) => b.rows.length - a.rows.length);
  }, [rows, groupBy]);

  // Facets (activity / open AR / open AP / archived) + chips. Role lives in the
  // primary role-chip lens (the directory's segmented control), NOT also here —
  // each control lives in exactly one place so the toolbar reads cleanly (E5.3).
  const filterFacets: FilterFacetSpec[] = [
    {
      kind: "options",
      key: "quick",
      label: "Activity",
      mode: "multi",
      icon: CalendarDays,
      options: QUICK_FACETS.map((facet) => ({ value: facet.value, label: facet.label })),
    },
  ];
  const filterPanelValue: FilterPanelValue = { quick };
  function onFilterPanelChange(key: string, next: unknown) {
    if (key === "quick") setQuick(next as string[]);
  }
  function clearAllFilters() {
    setSearch("");
    setRole("all");
    setQuick([]);
    setActiveViewId(null);
  }
  const chips: ActiveChip[] = [];
  if (role !== "all") chips.push({ key: "role", label: `Role: ${role === "customer" ? "Customers" : "Vendors"}` });
  for (const q of quick) chips.push({ key: `quick:${q}`, label: QUICK_FACETS.find((f) => f.value === q)?.label ?? q });
  function removeChip(key: string) {
    if (key === "role") setRole("all");
    else if (key.startsWith("quick:")) setQuick(quick.filter((q) => `quick:${q}` !== key));
  }

  // Saved views (FE-only shared store). One sensible built-in per section
  // (E5.3) — Contacts → Open A/R (customers who owe you) — plus the user's own.
  const OPEN_AR_VIEW_ID = "builtin:open-ar";
  const OPEN_AR_FILTERS: ContactFilters = { search: "", role: "all", quick: ["open-ar"] };
  function captureFilters(): ContactFilters {
    return { search: "", role, quick };
  }
  function applyFilters(filters: ContactFilters) {
    setSearch("");
    setRole(filters.role);
    setQuick(filters.quick);
  }
  const savedViewSummaries = [
    { id: OPEN_AR_VIEW_ID, name: "Open A/R", builtIn: true },
    ...savedViewsStore.userViews.map((view) => ({ id: view.id, name: view.name, builtIn: false })),
  ];
  const activeView = savedViewsStore.userViews.find((view) => view.id === activeViewId) ?? null;
  const activeFilters =
    activeViewId === OPEN_AR_VIEW_ID ? OPEN_AR_FILTERS : activeView?.filters ?? DEFAULT_FILTERS;
  const viewDirty = JSON.stringify(captureFilters()) !== JSON.stringify(activeFilters);

  function exportContactsCsv() {
    const header = ["Name", "Roles", "Email", "Money in YTD", "Money out YTD", "Owed to you", "You owe", "Last activity"];
    const csv = [header, ...rows.map((row) => [
      row.name,
      row.roles.join(" / "),
      row.email ?? "",
      row.moneyInYtdMinor / 100,
      row.moneyOutYtdMinor / 100,
      row.openReceivableMinor / 100,
      row.openPayableMinor / 100,
      row.lastActivityDate ?? "",
    ])]
      .map((line) => line.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "contacts.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const config: WorkbenchConfig<ContactRow> = {
    section: "contacts",
    title: "Contacts",
    subtabs: [
      { id: "contacts", label: "Contacts", kind: "cash-movement" },
      { id: "insights", label: "Insights", kind: "insights" },
    ],
    columns,
    defaultVisibleColumns: visibleColumns.map((column) => column.key),
    filterFacets,
    groupByOptions: ["none", "role", "category"],
    sortableColumns: sortMenuColumns,
    defaultSort: { key: "name", direction: "asc" },
    primaryActions: [{ label: "Add contact", onClick: () => setAddOpen(true), variant: "primary" }],
    bulkActions: [],
    rowToDetail: () => null,
  };

  // E8-T5: the single Contacts page-insight — overdue receivers / top earner —
  // built from the SAME moduleViews.overview.contacts read-model this directory
  // already loaded (kpis only exist on the entity-present branch of the union).
  const contactsKpis = "kpis" in data.contacts ? data.contacts.kpis : undefined;
  const pageInsight = buildPageInsight("contacts", {
    entity: { currency },
    contacts: {
      rows: data.contacts.rows.map((row) => ({
        name: row.name,
        archived: row.archived,
        moneyInYtdMinor: row.moneyInYtdMinor,
      })),
      kpis: {
        openReceivableMinor: contactsKpis?.openReceivableMinor ?? 0,
        overdueReceivableCount: contactsKpis?.overdueReceivableCount ?? 0,
        contactsCount: contactsKpis?.contactsCount ?? 0,
      },
    },
  });

  return (
    <WorkbenchSurface<ContactRow>
      config={config}
      testId="m6-contacts-screen"
      banner={
        pageInsight ? (
          <InsightBanner
            page="contacts"
            insight={pageInsight}
            explainSlot={<InsightBannerExplain section="contacts" entityId={entity.id} />}
          />
        ) : null
      }
      savedViews={{
        views: savedViewSummaries,
        activeViewId,
        dirty: viewDirty,
        allLabel: "All contacts",
        onSelect: (id) => {
          if (!id) {
            applyFilters(DEFAULT_FILTERS);
            setActiveViewId(null);
            return;
          }
          if (id === OPEN_AR_VIEW_ID) {
            applyFilters(OPEN_AR_FILTERS);
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
          if (id === OPEN_AR_VIEW_ID) return;
          savedViewsStore.replaceFilters(id, captureFilters());
        },
        onDelete: (id) => {
          if (id === OPEN_AR_VIEW_ID) return;
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
          {/* Role chips — All / Customers / Vendors — the directory's primary lens. */}
          <div className="flex items-center gap-1" role="group" aria-label="Filter by role">
            {(["all", "customer", "vendor"] as const).map((value) => (
              <Button
                key={value}
                variant={role === value ? "secondary" : "outline"}
                size="sm"
                aria-pressed={role === value}
                onClick={() => setRole(value)}
                data-testid={`contacts-role-${value}`}
              >
                {value === "all" ? "All" : value === "customer" ? "Customers" : "Vendors"}
              </Button>
            ))}
          </div>
        </>
      }
      trailing={
        <>
          <GroupByMenu noun="contacts" value={groupBy} onChange={setGroupBy} options={[{ key: "none", label: "No grouping" }, { key: "role", label: "Role" }, { key: "category", label: "Default category" }]} />
          <SortMenu noun="contacts" columns={sortMenuColumns} value={sort} onChange={setSort} />
          <DisplaySettingsMenu value={display} onChange={setDisplay} columns={columnToggleList} />
          <AddMenu
            addLabel="Add contact"
            addTestId="contacts-add-contact"
            onAddTransaction={() => setAddOpen(true)}
            exportChoices={[{ label: "Contacts — CSV", onSelect: exportContactsCsv }]}
          />
        </>
      }
      columns={visibleColumns}
      rows={rows}
      groups={groups}
      getRowId={(row) => row.id}
      onRowClick={(row) => setSelectedId(row.id)}
      density={display.density}
      sort={sort}
      onSortChange={setSort}
      rowAttributes={(row) => ({ "data-testid": "contact-row", "data-contact-id": row.id })}
      empty={
        <EmptyState
          icon={UserPlus}
          title="No contacts in this view"
          description="Most contacts are created automatically as money moves. Adjust the filters or add one by hand."
        />
      }
      emptyGroups={<EmptyState title="No contacts in this view" description="Adjust the filters above to see more." />}
      overlays={
        <>
          {addOpen ? (
            <AddContactModal
              entityId={entity.id as Id<"entities">}
              onClose={() => setAddOpen(false)}
              onCreated={(id) => {
                setAddOpen(false);
                setSelectedId(id);
              }}
            />
          ) : null}
          {selectedId ? (
            <ContactDetailSheet
              contactId={selectedId as Id<"contacts">}
              currency={currency}
              initialTab={selectedId === focusContactId ? focusTab ?? undefined : undefined}
              onClose={() => setSelectedId(null)}
            />
          ) : null}
        </>
      }
    />
  );
}

function isRecentlyActive(contact: ContactRow) {
  if (!contact.lastActivityDate) return false;
  return contact.lastActivityDate >= "2026-05-12";
}

function RoleChip({ role }: { role: string }) {
  const label = role.charAt(0).toUpperCase() + role.slice(1);
  return (
    <Badge
      variant="secondary"
      className={cn(role === "customer" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}
    >
      {label}
    </Badge>
  );
}

function OpenBalanceCell({ row, currency }: { row: ContactRow; currency: string }) {
  const arOverdue = row.overdueReceivableMinor > 0;
  if (row.openReceivableMinor <= 0 && row.openPayableMinor <= 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <span className="flex flex-col items-end gap-0.5">
      {row.openReceivableMinor > 0 ? (
        <span className={cn("inline-flex items-center gap-1", arOverdue && "text-negative")}>
          {arOverdue ? <AlertCircle className="size-3.5" aria-hidden="true" /> : null}
          <span className="money-figures text-xs">{formatMinorMoney(row.openReceivableMinor, { currency })} owed to you</span>
        </span>
      ) : null}
      {row.openPayableMinor > 0 ? (
        <span className="money-figures text-xs text-muted-foreground">{formatMinorMoney(row.openPayableMinor, { currency })} you owe</span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ContactDetailSheet — the rich record detail through the SHARED DetailSheet so
// it matches every other section. Header (name + role badges + quick actions),
// UN-NETTED KPI band, and tabs: Activity / Open items / Statements / Details /
// Notes / Attachments. Backed by the per-contact contactProfile query.
// ---------------------------------------------------------------------------

function ContactDetailSheet({
  contactId,
  currency,
  initialTab,
  onClose,
}: {
  contactId: Id<"contacts">;
  currency: string;
  initialTab?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const profile = useQuery(api.contacts.contactProfile, { contactId });
  const archiveContact = useMutation(api.contacts.archiveContact);
  const unarchiveContact = useMutation(api.contacts.unarchiveContact);
  const [busy, setBusy] = useState(false);

  const isCustomer = profile?.roles.includes("customer") ?? false;
  const isVendor = profile?.roles.includes("vendor") ?? false;

  async function toggleArchive() {
    if (!profile) return;
    setBusy(true);
    try {
      if (profile.archived) {
        await unarchiveContact({ contactId });
        toast.success(`Restored ${profile.name}.`);
      } else {
        await archiveContact({ contactId });
        toast.success(`Archived ${profile.name}. History preserved.`);
        onClose();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the contact.");
    } finally {
      setBusy(false);
    }
  }

  const title = profile ? (
    <span className="flex items-center gap-2.5" data-testid="contact-detail-title">
      <Avatar className="size-7">
        <AvatarFallback className="text-[10px]">{initials(profile.name)}</AvatarFallback>
      </Avatar>
      {profile.name}
    </span>
  ) : (
    "Contact"
  );

  const attention = profile ? (
    <span className="flex flex-wrap items-center gap-1.5">
      {profile.roles.map((r) => (
        <RoleChip key={r} role={r} />
      ))}
      {profile.kpis.overdueReceivableMinor > 0 ? (
        <Badge variant="secondary" className="bg-negative-surface text-negative">Overdue A/R</Badge>
      ) : null}
    </span>
  ) : null;

  const footer = profile ? (
    <div className="flex flex-wrap items-center gap-2">
      {isCustomer ? (
        <Button
          size="sm"
          data-testid="contact-new-invoice"
          onClick={() => router.push(`/income/invoices?q=${encodeURIComponent(profile.name)}`)}
        >
          New invoice
        </Button>
      ) : null}
      {isVendor ? (
        <Button
          size="sm"
          variant="outline"
          data-testid="contact-record-payment"
          onClick={() => router.push(`/expenses/bills?q=${encodeURIComponent(profile.name)}`)}
        >
          Record payment
        </Button>
      ) : null}
      <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={toggleArchive}>
        <Archive className="size-3.5" /> {profile.archived ? "Restore" : "Archive"}
      </Button>
    </div>
  ) : null;

  return (
    <DetailSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      subtitle={profile?.email ?? "No email on file"}
      attention={attention}
      footer={footer}
    >
      {profile === undefined ? (
        <div className="text-sm text-muted-foreground">Loading contact…</div>
      ) : profile === null ? (
        <EmptyState title="Contact not found" />
      ) : (
        <ContactDetailBody profile={profile} currency={currency} initialTab={initialTab} />
      )}
    </DetailSheet>
  );
}

function ContactDetailBody({ profile, currency, initialTab }: { profile: ContactProfile; currency: string; initialTab?: string }) {
  const k = profile.kpis;
  return (
    <div className="flex flex-col gap-4" data-testid="contact-profile">
      {/* KPI band — AR and AP shown SEPARATELY, never netted. */}
      <div className="grid grid-cols-2 gap-2" data-testid="contact-kpi-band">
        <MiniKpi label="They owe you" value={formatMinorMoney(k.openReceivableMinor, { currency })} tone={k.overdueReceivableMinor > 0 ? "negative" : "neutral"} sub={k.overdueReceivableMinor > 0 ? `${formatMinorMoney(k.overdueReceivableMinor, { currency })} overdue` : undefined} />
        <MiniKpi label="You owe them" value={formatMinorMoney(k.openPayableMinor, { currency })} sub={k.overduePayableMinor > 0 ? `${formatMinorMoney(k.overduePayableMinor, { currency })} overdue` : undefined} />
        <MiniKpi label="Lifetime in" value={formatMinorMoney(k.lifetimeInMinor, { currency })} tone="income" />
        <MiniKpi label="Lifetime out" value={formatMinorMoney(k.lifetimeOutMinor, { currency })} />
      </div>

      <Tabs profile={profile} currency={currency} initialTab={initialTab} />
    </div>
  );
}

type ContactTabId = "activity" | "open" | "statements" | "details" | "notes";
const CONTACT_TAB_IDS: ContactTabId[] = ["activity", "open", "statements", "details", "notes"];

function Tabs({ profile, currency, initialTab }: { profile: ContactProfile; currency: string; initialTab?: string }) {
  const [tab, setTab] = useState<ContactTabId>(
    initialTab && (CONTACT_TAB_IDS as string[]).includes(initialTab) ? (initialTab as ContactTabId) : "activity",
  );
  const TABS: Array<{ id: typeof tab; label: string }> = [
    { id: "activity", label: "Activity" },
    { id: "open", label: "Open items" },
    { id: "statements", label: "Statements" },
    { id: "details", label: "Details" },
    { id: "notes", label: "Notes" },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1 border-b" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            data-testid={`contact-tab-${t.id}`}
            className={cn(
              "px-2.5 py-1.5 text-[13px] font-medium -mb-px border-b-2 transition-colors",
              tab === t.id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "activity" ? <ActivityTab profile={profile} currency={currency} /> : null}
      {tab === "open" ? <OpenItemsTab profile={profile} currency={currency} /> : null}
      {tab === "statements" ? <StatementsTab profile={profile} currency={currency} /> : null}
      {tab === "details" ? <DetailsTab profile={profile} /> : null}
      {tab === "notes" ? <NotesTab profile={profile} /> : null}
    </div>
  );
}

function ActivityTab({ profile, currency }: { profile: ContactProfile; currency: string }) {
  if (profile.timeline.length === 0) {
    return <p className="text-sm text-muted-foreground">No invoices, bills, or payments recorded yet.</p>;
  }
  return (
    <div className="flex flex-col divide-y rounded-[14px] ring-1 ring-foreground/10" data-testid="contact-activity">
      {profile.timeline.map((item) => {
        const isCharge = item.chargeMinor > 0;
        const amount = isCharge ? item.chargeMinor : item.paymentMinor;
        const running = item.side === "receivable" ? item.runningReceivableMinor : item.runningPayableMinor;
        return (
          <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate font-medium">{item.label}</span>
              <span className="money-figures block text-xs text-muted-foreground">
                {item.date} · {item.side === "receivable" ? "A/R" : "A/P"}
              </span>
            </span>
            <span className="flex flex-col items-end">
              <span className={cn("money-figures text-sm", isCharge ? "text-foreground" : "text-primary")}>
                {isCharge ? "" : "−"}{formatMinorMoney(amount, { currency })}
              </span>
              <span className="money-figures text-[11px] text-muted-foreground">
                bal {formatMinorMoney(running, { currency })}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function OpenItemsTab({ profile, currency }: { profile: ContactProfile; currency: string }) {
  if (profile.openItems.length === 0) {
    return <p className="text-sm text-muted-foreground">No open invoices or bills — this contact is all squared up.</p>;
  }
  return (
    <div className="flex flex-col gap-3" data-testid="contact-open-items">
      <div className="flex flex-col divide-y rounded-[14px] ring-1 ring-foreground/10">
        {profile.openItems.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate font-medium">{item.ref}</span>
              <span className="money-figures block text-xs text-muted-foreground">
                {item.side === "receivable" ? "A/R" : "A/P"} · due {item.dueDate}
                {item.overdueDays > 0 ? ` · ${item.overdueDays}d overdue` : ""}
              </span>
            </span>
            <span className={cn("money-figures text-sm", item.overdueDays > 0 && item.side === "receivable" ? "text-negative" : "text-foreground")}>
              {formatMinorMoney(item.balanceMinor, { currency })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatementsTab({ profile, currency }: { profile: ContactProfile; currency: string }) {
  const isCustomer = profile.roles.includes("customer");
  const [side, setSide] = useState<"receivable" | "payable">(isCustomer ? "receivable" : "payable");
  const [mode, setMode] = useState<"balance-forward" | "open-item">("balance-forward");
  const from = "2026-01-01";
  const to = profile.asOf;

  const statement = useQuery(api.contacts.contactStatement, {
    contactId: profile.id as Id<"contacts">,
    mode,
    from,
    to,
    side,
  });

  function downloadCsv() {
    if (!statement) return;
    const header = ["Date", "Reference", "Description", "Charge", "Payment", "Balance"];
    const lines = [
      header,
      ...(mode === "balance-forward" ? [["", "", "Opening balance", "", "", statement.openingBalanceMinor / 100]] : []),
      ...statement.lines.map((line) => [
        line.date,
        line.ref,
        line.description,
        line.chargeMinor ? line.chargeMinor / 100 : "",
        line.paymentMinor ? line.paymentMinor / 100 : "",
        line.balanceMinor / 100,
      ]),
      ["", "", "Closing balance", "", "", statement.closingBalanceMinor / 100],
    ];
    const csv = lines.map((line) => line.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `statement-${profile.name.replace(/\s+/g, "-").toLowerCase()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("Statement downloaded as CSV.");
  }

  function handleSend() {
    // Best-effort send: Plunk email is not configured for arbitrary statement
    // delivery yet, so fall back to an honest copy/download state (E4.4).
    if (profile.email) {
      const subject = encodeURIComponent(`Statement from ${statement?.company ?? "OpenBooks"}`);
      window.open(`mailto:${profile.email}?subject=${subject}`, "_blank");
      toast.success(`Opened an email to ${profile.email}. Attach the downloaded statement.`);
    } else {
      toast.message("No email on file — download the statement and send it manually.");
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="contact-statements">
      <div className="flex flex-wrap items-center gap-2">
        {profile.roles.includes("customer") && profile.roles.includes("vendor") ? (
          <Select value={side} onValueChange={(v) => setSide(v as typeof side)}>
            <SelectTrigger className="h-8 w-[140px]" aria-label="Statement side">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="receivable">Receivable (A/R)</SelectItem>
              <SelectItem value="payable">Payable (A/P)</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
        <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <SelectTrigger className="h-8 w-[170px]" aria-label="Statement mode" data-testid="statement-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="balance-forward">Balance-forward</SelectItem>
            <SelectItem value="open-item">Open-item (collections)</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" data-testid="statement-download" disabled={!statement} onClick={downloadCsv}>
            <Download className="size-3.5" /> CSV
          </Button>
          <Button size="sm" variant="outline" data-testid="statement-print" disabled={!statement} onClick={() => window.print()}>
            <FileText className="size-3.5" /> PDF
          </Button>
          <Button size="sm" data-testid="statement-send" disabled={!statement} onClick={handleSend}>
            Send
          </Button>
        </div>
      </div>

      {statement === undefined ? (
        <div className="text-sm text-muted-foreground">Building statement…</div>
      ) : statement === null ? (
        <EmptyState title="Statement unavailable" />
      ) : statement.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">No statement activity in this period.</p>
      ) : (
        <StatementPreview statement={statement} currency={currency} />
      )}
      <p className="text-[11px] text-muted-foreground">
        Every line ties to a posted journal entry, so the statement reconciles to the ledger.
      </p>
    </div>
  );
}

type StatementData = NonNullable<FunctionReturnType<typeof api.contacts.contactStatement>>;

function StatementPreview({ statement, currency }: { statement: StatementData; currency: string }) {
  return (
    <div className="rounded-[14px] ring-1 ring-foreground/10" data-testid="statement-preview">
      <div className="flex items-center justify-between gap-2 border-b px-3.5 py-3">
        <div>
          <div className="text-sm font-semibold">{statement.company}</div>
          <div className="text-xs text-muted-foreground">
            Statement for {statement.contact.name} · {statement.side === "receivable" ? "A/R" : "A/P"} ·{" "}
            {statement.mode === "balance-forward" ? "Balance-forward" : "Open-item"}
          </div>
        </div>
        <div className="money-figures text-right text-xs text-muted-foreground">
          {statement.from} – {statement.to}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-1.5 font-medium">Date</th>
              <th className="px-3 py-1.5 font-medium">Detail</th>
              <th className="px-3 py-1.5 text-right font-medium">Charge</th>
              <th className="px-3 py-1.5 text-right font-medium">Payment</th>
              <th className="px-3 py-1.5 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {statement.mode === "balance-forward" ? (
              <tr className="border-b bg-muted/30">
                <td className="px-3 py-1.5 text-muted-foreground" colSpan={4}>Opening balance</td>
                <td className="money-figures px-3 py-1.5 text-right">{formatMinorMoney(statement.openingBalanceMinor, { currency })}</td>
              </tr>
            ) : null}
            {statement.lines.map((line, index) => (
              <tr key={index} className="border-b last:border-0">
                <td className="money-figures px-3 py-1.5 text-muted-foreground">{line.date}</td>
                <td className="px-3 py-1.5">
                  <span className="font-medium">{line.ref}</span>
                  <span className="block text-[11px] text-muted-foreground">{line.description}</span>
                </td>
                <td className="money-figures px-3 py-1.5 text-right">{line.chargeMinor ? formatMinorMoney(line.chargeMinor, { currency }) : "—"}</td>
                <td className="money-figures px-3 py-1.5 text-right text-primary">{line.paymentMinor ? formatMinorMoney(line.paymentMinor, { currency }) : "—"}</td>
                <td className="money-figures px-3 py-1.5 text-right">{formatMinorMoney(line.balanceMinor, { currency })}</td>
              </tr>
            ))}
            <tr className="bg-muted/30 font-semibold">
              <td className="px-3 py-1.5" colSpan={2}>{statement.mode === "open-item" ? "Total outstanding" : "Closing balance"}</td>
              <td className="money-figures px-3 py-1.5 text-right">{statement.totalChargesMinor ? formatMinorMoney(statement.totalChargesMinor, { currency }) : ""}</td>
              <td className="money-figures px-3 py-1.5 text-right">{statement.totalPaymentsMinor ? formatMinorMoney(statement.totalPaymentsMinor, { currency }) : ""}</td>
              <td className="money-figures px-3 py-1.5 text-right" data-testid="statement-closing">{formatMinorMoney(statement.closingBalanceMinor, { currency })}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DetailsTab({ profile }: { profile: ContactProfile }) {
  const updateContact = useMutation(api.contacts.updateContact);
  const setBankDetails = useMutation(api.contacts.setBankDetails);
  const { activeEntity } = useActiveEntity();
  const categories = useQuery(
    api.categories.list,
    activeEntity.id ? { entityId: activeEntity.id as Id<"entities"> } : "skip",
  );
  const [bank, setBank] = useState(profile.bankDetails ?? "");
  const [savingBank, setSavingBank] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);

  async function saveCategory(value: string) {
    setSavingCategory(true);
    try {
      await updateContact({
        contactId: profile.id as Id<"contacts">,
        defaultCategoryId: value === "none" ? null : (value as Id<"ledgerAccounts">),
      });
      toast.success("Default category updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the category.");
    } finally {
      setSavingCategory(false);
    }
  }

  async function saveBank() {
    setSavingBank(true);
    try {
      await setBankDetails({ contactId: profile.id as Id<"contacts">, bankDetails: bank.trim() || null });
      toast.success("Bank details saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save bank details.");
    } finally {
      setSavingBank(false);
    }
  }

  const categoryOptions = (categories?.groups ?? []).flatMap((group) =>
    group.cats.map((cat) => ({ id: cat.id, name: cat.name, group: group.label })),
  );

  return (
    <div className="flex flex-col gap-4 text-sm" data-testid="contact-details">
      <div className="grid gap-1.5">
        <Label className="text-xs text-muted-foreground">Roles</Label>
        <div className="flex flex-wrap gap-1.5">
          {profile.roles.map((r) => (
            <RoleChip key={r} role={r} />
          ))}
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs text-muted-foreground">Email</Label>
        <div>{profile.email ?? <span className="text-muted-foreground">No email on file</span>}</div>
      </div>
      {profile.aliases.length > 0 ? (
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Also known as</Label>
          <div className="flex flex-wrap gap-1.5">
            {profile.aliases.map((alias) => (
              <Badge key={alias} variant="outline">{alias}</Badge>
            ))}
          </div>
        </div>
      ) : null}

      <Separator />

      <div className="grid gap-1.5">
        <Label className="text-xs text-muted-foreground">Default category</Label>
        <Select
          value={profile.defaultCategory?.id ?? "none"}
          onValueChange={saveCategory}
          disabled={savingCategory || categories === undefined}
        >
          <SelectTrigger className="h-9" data-testid="contact-default-category">
            <SelectValue placeholder="No default category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No default category</SelectItem>
            {categoryOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          New transactions from this contact get pre-filed here — the AI proposes, you confirm.
        </p>
      </div>

      <Separator />

      {/* Bank details — ADMIN-ONLY. Non-admins never receive the value. */}
      <div className="grid gap-1.5">
        <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3" /> Bank / payout details (admin only)
        </Label>
        {profile.canSeeBankDetails ? (
          <>
            <Textarea
              value={bank}
              onChange={(event) => setBank(event.target.value)}
              placeholder="Routing 021000021 · Acct ••4321"
              rows={2}
              data-testid="contact-bank-details"
            />
            <Button
              size="sm"
              variant="outline"
              className="self-end"
              disabled={savingBank || bank.trim() === (profile.bankDetails ?? "")}
              onClick={saveBank}
            >
              {savingBank ? "Saving…" : "Save bank details"}
            </Button>
          </>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            Hidden — only owners and accountants can view bank details.
          </p>
        )}
      </div>
    </div>
  );
}

function NotesTab({ profile }: { profile: ContactProfile }) {
  const updateContact = useMutation(api.contacts.updateContact);
  const [notes, setNotes] = useState(profile.notes ?? "");
  const [busy, setBusy] = useState(false);
  const dirty = notes !== (profile.notes ?? "");

  async function save() {
    setBusy(true);
    try {
      await updateContact({ contactId: profile.id as Id<"contacts">, notes });
      toast.success("Notes saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save notes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder={`Anything worth remembering about ${profile.name}…`}
        rows={4}
        data-testid="contact-notes"
      />
      <Button size="sm" variant="outline" className="self-end" disabled={!dirty || busy} onClick={save}>
        {busy ? "Saving…" : "Save notes"}
      </Button>
    </div>
  );
}

function MiniKpi({ label, value, tone = "neutral", sub }: { label: string; value: string; tone?: "neutral" | "negative" | "income"; sub?: string }) {
  return (
    <div className="rounded-[14px] bg-muted/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("money-figures mt-1 text-sm font-semibold", tone === "negative" && "text-negative", tone === "income" && "text-primary")}>{value}</div>
      {sub ? <div className="money-figures mt-0.5 text-[11px] text-negative">{sub}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddContactModal (E4.2) — name, role(s) customer/vendor/both, email, optional
// default category. Validation; the new contact appears immediately (Convex
// reactivity) and is reusable on invoices/bills.
// ---------------------------------------------------------------------------

function AddContactModal({
  entityId,
  onClose,
  onCreated,
}: {
  entityId: Id<"entities">;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const createContact = useMutation(api.contacts.createContact);
  const categories = useQuery(api.categories.list, { entityId });
  const [name, setName] = useState("");
  const [roles, setRoles] = useState<Array<"customer" | "vendor">>(["customer"]);
  const [email, setEmail] = useState("");
  const [defaultCategoryId, setDefaultCategoryId] = useState<string>("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggleRole(role: "customer" | "vendor") {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  async function handleCreate() {
    if (!name.trim()) {
      setError("Give the contact a name.");
      return;
    }
    if (roles.length === 0) {
      setError("Pick at least one role.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await createContact({
        entityId,
        name: name.trim(),
        roles,
        email: email.trim() || undefined,
        defaultCategoryId: defaultCategoryId === "none" ? undefined : (defaultCategoryId as Id<"ledgerAccounts">),
      });
      toast.success(`Added ${name.trim()} to the directory.`);
      onCreated(result.contactId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the contact.");
    } finally {
      setBusy(false);
    }
  }

  const categoryOptions = (categories?.groups ?? []).flatMap((group) => group.cats.map((cat) => ({ id: cat.id, name: cat.name })));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="add-contact-modal">
        <DialogHeader>
          <DialogTitle>New contact</DialogTitle>
          <DialogDescription>
            Most contacts are created automatically as money moves. Add one by hand for a customer or vendor you haven&apos;t billed yet.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-2">
            <Label htmlFor="contact-name">Name</Label>
            <Input
              id="contact-name"
              data-testid="contact-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Business or person name"
            />
          </div>
          <div className="grid gap-2">
            <Label>Role(s)</Label>
            <div className="flex gap-2" role="group" aria-label="Roles">
              {(["customer", "vendor"] as const).map((r) => (
                <Button
                  key={r}
                  type="button"
                  variant={roles.includes(r) ? "secondary" : "outline"}
                  size="sm"
                  aria-pressed={roles.includes(r)}
                  onClick={() => toggleRole(r)}
                  data-testid={`contact-role-${r}`}
                >
                  {r === "customer" ? "Customer" : "Vendor"}
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">A contact can be both — they bill you and you bill them.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="contact-email">Email (optional)</Label>
            <Input
              id="contact-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
            />
          </div>
          <div className="grid gap-2">
            <Label>Default category (optional)</Label>
            <Select value={defaultCategoryId} onValueChange={setDefaultCategoryId} disabled={categories === undefined}>
              <SelectTrigger data-testid="contact-default-category">
                <SelectValue placeholder="No default category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No default category</SelectItem>
                {categoryOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="text-sm text-negative" data-testid="add-contact-error">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" data-testid="contact-create" disabled={busy} onClick={handleCreate}>
            {busy ? "Adding…" : "Add contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export type { ContactProfile };
