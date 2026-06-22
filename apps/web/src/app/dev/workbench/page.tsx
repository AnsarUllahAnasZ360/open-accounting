"use client";

import { Plus, Upload } from "lucide-react";
import { useState } from "react";

import { Amount, formatMinorMoney } from "@/components/openbooks/primitives";
import {
  AccountMultiSelect,
  AiInsightBadge,
  type AiObservation,
  AiObservationCard,
  AttentionState,
  type AttentionKind,
  type ColumnDef,
  type CompareMode,
  DateRangeControl,
  type DateRangeValue,
  DetailSheet,
  type DrillTarget,
  EvidenceUpload,
  ExportMenu,
  type FacetValue,
  FilterBar,
  InsightsChart,
  InsightsKpiCard,
  InsightsKpiGrid,
  InsightsScope,
  InsightsWidgetState,
  KpiStrip,
  NothingNotable,
  OpenBooksDataTable,
  PageActionBar,
  WorkbenchPage,
} from "@/components/openbooks/workbench";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";

// ---------------------------------------------------------------------------
// Mock data — a trimmed Transactions row shape (convex/coreViews.ts).
// ---------------------------------------------------------------------------

type TxnRow = {
  id: string;
  date: string;
  merchant: string;
  amountMinor: number;
  categoryName: string;
  bankAccountName: string;
  review: AttentionKind | null;
  confidence: number | null;
  decidedBy: string | null;
};

const TXNS: TxnRow[] = [
  {
    id: "t1",
    date: "2026-06-11",
    merchant: "Stripe payout",
    amountMinor: 482310,
    categoryName: "Sales income",
    bankAccountName: "Mercury checking",
    review: null,
    confidence: 0.97,
    decidedBy: "Memory",
  },
  {
    id: "t2",
    date: "2026-06-10",
    merchant: "Adobe Creative Cloud",
    amountMinor: -5499,
    categoryName: "Software",
    bankAccountName: "Mercury checking",
    review: "low-confidence",
    confidence: 0.78,
    decidedBy: "AI",
  },
  {
    id: "t3",
    date: "2026-06-09",
    merchant: "Untitled deposit",
    amountMinor: 120000,
    categoryName: "Uncategorized",
    bankAccountName: "Mercury savings",
    review: "needs-review",
    confidence: 0.41,
    decidedBy: "AI",
  },
  {
    id: "t4",
    date: "2026-06-08",
    merchant: "Acme Tools invoice",
    amountMinor: -89900,
    categoryName: "Equipment",
    bankAccountName: "Mercury checking",
    review: "missing-evidence",
    confidence: 0.9,
    decidedBy: "Rule",
  },
  {
    id: "t5",
    date: "2026-06-05",
    merchant: "City Power & Light",
    amountMinor: -21450,
    categoryName: "Utilities",
    bankAccountName: "Mercury checking",
    review: null,
    confidence: 0.99,
    decidedBy: "Rule",
  },
];

const TXN_COLUMNS: ColumnDef<TxnRow>[] = [
  {
    key: "date",
    header: "Date",
    mono: true,
    sortable: true,
    width: "120px",
    sortValue: (row) => row.date,
    cell: (row) => row.date,
  },
  {
    key: "merchant",
    header: "Merchant",
    sortable: true,
    mobilePrimary: true,
    sortValue: (row) => row.merchant.toLowerCase(),
    cell: (row) => <span className="truncate font-medium">{row.merchant}</span>,
  },
  {
    key: "category",
    header: "Category",
    priority: 1,
    cell: (row) => <span className="block truncate text-muted-foreground">{row.categoryName}</span>,
  },
  {
    key: "account",
    header: "Account",
    priority: 2,
    cell: (row) => <span className="block truncate text-muted-foreground">{row.bankAccountName}</span>,
  },
  {
    key: "ai",
    header: "AI",
    align: "right",
    width: "72px",
    cell: (row) =>
      row.confidence != null ? (
        <AiInsightBadge
          variant="ring"
          confidence={row.confidence}
          decidedBy={row.decidedBy ?? undefined}
          reasoning={`Matched “${row.merchant}” to ${row.categoryName}.`}
        />
      ) : null,
  },
  {
    key: "amount",
    header: "Amount",
    align: "right",
    mono: true,
    sortable: true,
    mobileTrailing: true,
    width: "140px",
    sortValue: (row) => row.amountMinor,
    cell: (row) => (
      <Amount amountMinor={row.amountMinor} signed tone={row.amountMinor > 0 ? "income" : "expense"} />
    ),
  },
];

const ALL_ATTENTION: AttentionKind[] = [
  "needs-review",
  "low-confidence",
  "overdue",
  "missing-evidence",
  "unmatched",
  "unposted",
];

const ACCOUNTS = [
  { id: "a1", label: "Mercury checking", kind: "Bank" },
  { id: "a2", label: "Mercury savings", kind: "Bank" },
  { id: "a3", label: "Stripe balance", kind: "Processor" },
  { id: "a4", label: "Amex business", kind: "Card" },
];

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
      <Separator className="mt-2" />
    </section>
  );
}

// Mock daily cash-flow points for the Insights chart harness (in/out minor units).
const INSIGHT_POINTS = [
  { x: "2026-06-02", label: "Jun 2", drillKey: "2026-06-02", inMinor: 120000, outMinor: 40000 },
  { x: "2026-06-05", label: "Jun 5", drillKey: "2026-06-05", inMinor: 0, outMinor: 95000 },
  { x: "2026-06-09", label: "Jun 9", drillKey: "2026-06-09", inMinor: 482310, outMinor: 21000 },
  { x: "2026-06-14", label: "Jun 14", drillKey: "2026-06-14", inMinor: 64000, outMinor: 130000 },
  { x: "2026-06-21", label: "Jun 21", drillKey: "2026-06-21", inMinor: 210000, outMinor: 58000 },
  { x: "2026-06-28", label: "Jun 28", drillKey: "2026-06-28", inMinor: 90000, outMinor: 240000 },
];

const INSIGHT_OBSERVATION: AiObservation = {
  text: "Money out to AWS rose 34% versus the previous period — worth a quick look before month-end.",
  tone: "warning",
  why: "Surfaced because this counterparty's spend crossed the period-over-period change threshold.",
  entities: [{ label: "AWS", target: { title: "AWS", from: "2026-06-01", to: "2026-06-30", counterparty: "AWS" } }],
};

/**
 * Self-contained Insights craft harness — every reusable E1 component rendered
 * with mock data (no Convex, no auth, no shared books). Proves the scope bar's
 * resolved dates + compare, the KPI delta-suppression rule, the chart's legend
 * cross-filter + click-to-drill, the monochrome AI card with a drillable chip,
 * and the empty / nothing-notable states.
 */
function InsightsHarness() {
  const [range, setRange] = useState<DateRangeValue>({ preset: "this-month" });
  const [compareMode, setCompareMode] = useState<CompareMode>("previous-period");
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  return (
    <div className="flex flex-col gap-4" data-testid="insights-harness">
      <InsightsScope
        range={range}
        onRangeChange={setRange}
        compareMode={compareMode}
        onCompareModeChange={setCompareMode}
        todayISO="2026-06-30"
      />

      <InsightsKpiGrid columns={4}>
        <InsightsKpiCard
          label="Net change"
          value={`+${formatMinorMoney(826310, { currency: "USD" })}`}
          tone="income"
          comparison={{ current: 826310, previous: 712000, frameLabel: "previous period" }}
          sparkline={[3, 5, 4, 7, 6, 9, 8]}
        />
        <InsightsKpiCard
          label="Money out"
          value={`−${formatMinorMoney(584000, { currency: "USD" })}`}
          detail="Ordinary spend"
          comparison={{ current: 584000, previous: 430000, frameLabel: "previous period", invertColor: true }}
        />
        <InsightsKpiCard
          label="Overdue"
          value={formatMinorMoney(94000, { currency: "USD" })}
          tone="negative"
          status={{ label: "2 invoices 60+ days", tone: "negative" }}
        />
        {/* No-history card: the delta is SUPPRESSED (no "+∞%"). */}
        <InsightsKpiCard
          label="New this period"
          value="3"
          detail="First period tracked"
          comparison={{ current: 3, previous: null, frameLabel: "previous period" }}
        />
      </InsightsKpiGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <section className="flex flex-col gap-3 rounded-[14px] p-4 shadow-xs ring-1 ring-foreground/10">
          <h3 className="text-sm font-semibold">Daily cash flow</h3>
          <InsightsChart
            data={INSIGHT_POINTS}
            currency="USD"
            series={[
              { key: "inMinor", label: "Money in", color: "var(--ob-green-500)", type: "bar" },
              { key: "outMinor", label: "Money out", color: "#cbd2d9", type: "bar" },
            ]}
            onDrill={(point) =>
              setDrill({
                title: point.label ?? "Transactions",
                from: "2026-06-01",
                to: "2026-06-30",
                day: point.drillKey,
              })
            }
          />
        </section>
        <div className="flex flex-col gap-3">
          <AiObservationCard observation={INSIGHT_OBSERVATION} onDrill={setDrill} />
          <NothingNotable />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <InsightsWidgetState kind="empty" />
        <InsightsWidgetState kind="first-run" />
        <InsightsWidgetState kind="low-data" />
      </div>

      {/* The drill target is surfaced for the harness e2e to assert click-to-drill
          fires (the live Convex-backed drawer is proven in the app spec). */}
      <DetailSheet
        open={drill != null}
        onOpenChange={(open) => {
          if (!open) setDrill(null);
        }}
        title={drill?.title ?? "Transactions"}
        subtitle={drill ? `${drill.from} – ${drill.to}` : undefined}
      >
        <div data-testid="harness-drill-target" className="text-sm text-muted-foreground">
          Drill target: {drill?.day ?? drill?.counterparty ?? "—"}
        </div>
      </DetailSheet>
    </div>
  );
}

export default function WorkbenchHarnessPage() {
  const [selected, setSelected] = useState<string[]>(["t2", "t3"]);
  const [accounts, setAccounts] = useState<string[]>(["a1"]);
  const [range, setRange] = useState<DateRangeValue>({ preset: "this-month" });
  const [search, setSearch] = useState("");
  const [facets, setFacets] = useState<FacetValue>({ review: "needs-review" });
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeRow, setActiveRow] = useState<TxnRow | null>(null);

  function openRow(row: TxnRow) {
    setActiveRow(row);
    setDetailOpen(true);
  }

  return (
    <div className="min-h-screen bg-background">
      <Toaster />
      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-10">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">Epic 1 · Workbench primitives</p>
          <h1 className="text-2xl font-semibold">Workbench component harness</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Every shared primitive rendered with mock data for screenshot evidence. No Convex, no auth.
          </p>
        </div>

        <Section
          title="Insights system (E1) — scope, KPI cards, chart, AI cards, states"
          description="Scope bar with resolved dates + compare; KPI delta suppressed when there's no history; chart legend cross-filter + click-to-drill; monochrome AI card with a drillable chip; empty / nothing-notable states. Mock data only."
        >
          <InsightsHarness />
        </Section>

        <Section
          title="WorkbenchPage + PageActionBar + ExportMenu"
          description="The page scaffold with a primary action, secondary actions, and an export menu."
        >
          <WorkbenchPage
            eyebrow="Money"
            title="Transactions"
            description="Every dollar in and out, with AI suggestions you can accept or change."
            actions={
              <PageActionBar
                primary={{ label: "Add transaction", icon: Plus }}
                actions={[
                  { label: "Import CSV", icon: Upload },
                  { label: "Import OFX", icon: Upload },
                ]}
              >
                <ExportMenu formats={["csv", "pdf", "xlsx"]} onExport={async () => {}} filename="transactions" />
              </PageActionBar>
            }
          >
            <p className="text-sm text-muted-foreground">Page body renders here.</p>
          </WorkbenchPage>
        </Section>

        <Section title="KpiStrip — 4 columns" description="Trend arrows are lucide; only the overdue metric uses the negative token.">
          <KpiStrip
            columns={4}
            items={[
              { label: "Money in", value: "$48,230", tone: "income", delta: { pct: 12, direction: "up" }, sparkline: [3, 5, 4, 8, 7, 11, 13] },
              { label: "Money out", value: "$31,540", detail: "78 transactions" },
              { label: "Net", value: "$16,690", delta: { pct: 4, direction: "down" } },
              { label: "Overdue", value: "$4,120", tone: "negative", detail: "3 invoices" },
            ]}
          />
        </Section>

        <Section title="KpiStrip — 3 columns">
          <KpiStrip
            columns={3}
            items={[
              { label: "Open invoices", value: "$22,400", detail: "9 open" },
              { label: "Paid last 30 days", value: "$61,900", tone: "income", delta: { pct: 18, direction: "up" } },
              { label: "Avg days to pay", value: "21", detail: "down from 27" },
            ]}
          />
        </Section>

        <Section
          title="FilterBar"
          description="Search, facets, embedded controls, and removable active chips."
        >
          <FilterBar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Search transactions"
            facets={[
              {
                key: "review",
                label: "Review",
                options: [
                  { value: "all", label: "All" },
                  { value: "needs-review", label: "Needs review" },
                  { value: "posted", label: "Posted" },
                ],
              },
            ]}
            value={facets}
            onChange={setFacets}
            onClearAll={() => setFacets({})}
          >
            <DateRangeControl value={range} onChange={setRange} compact />
            <AccountMultiSelect options={ACCOUNTS} value={accounts} onChange={setAccounts} />
          </FilterBar>
        </Section>

        <Section title="DateRangeControl" description="Presets inline, custom range in a calendar popover (future dates disabled).">
          <DateRangeControl value={range} onChange={setRange} />
        </Section>

        <Section title="AccountMultiSelect" description="Searchable multi-select with a count badge; single mode variant alongside.">
          <div className="flex flex-wrap gap-3">
            <AccountMultiSelect options={ACCOUNTS} value={accounts} onChange={setAccounts} />
            <AccountMultiSelect
              options={ACCOUNTS}
              value={accounts.slice(0, 1)}
              onChange={(next) => setAccounts(next)}
              mode="single"
              placeholder="Pick one account"
            />
          </div>
        </Section>

        <Section
          title="OpenBooksDataTable"
          description="Selectable, sortable, with a bulk toolbar, AI rings, an attention column, and money right-aligned. Click a row to open the detail sheet."
        >
          <OpenBooksDataTable
            columns={TXN_COLUMNS}
            rows={TXNS}
            getRowId={(row) => row.id}
            selectable
            selectedIds={selected}
            onSelectionChange={setSelected}
            onRowClick={openRow}
            attention={(row) => (row.review ? <AttentionState state={row.review} iconOnly /> : null)}
            bulkActions={
              <>
                <Button size="sm" variant="outline">Categorize</Button>
                <Button size="sm">Post selected</Button>
              </>
            }
          />
        </Section>

        <Section title="OpenBooksDataTable — loading">
          <OpenBooksDataTable columns={TXN_COLUMNS} rows={[]} getRowId={(row) => row.id} selectable loading />
        </Section>

        <Section title="OpenBooksDataTable — empty">
          <OpenBooksDataTable columns={TXN_COLUMNS} rows={[]} getRowId={(row) => row.id} />
        </Section>

        <Section title="DetailSheet" description="Closed by default; opens on a row click as a right sheet (lg+) or bottom drawer (mobile).">
          <Button variant="outline" onClick={() => openRow(TXNS[2])}>
            Open detail sheet
          </Button>
        </Section>

        <Section title="AiInsightBadge" description="Quiet green AI affordance in three variants — never purple.">
          <div className="flex flex-wrap items-center gap-6">
            <AiInsightBadge variant="ring" confidence={0.82} reasoning="Matched on vendor memory." decidedBy="Memory" />
            <AiInsightBadge variant="chip" confidence={0.64} reasoning="Best guess from description." decidedBy="AI" />
            <div className="w-72">
              <AiInsightBadge
                variant="inline"
                confidence={0.91}
                reasoning="“City Power & Light” has matched Utilities on the last 6 statements."
                decidedBy="Rule"
              />
            </div>
          </div>
        </Section>

        <Section title="EvidenceUpload" description="Attached state with extraction confidence, and the missing-receipt empty state.">
          <div className="grid gap-4 md:grid-cols-2">
            <EvidenceUpload
              target={{ kind: "transaction", id: "t4" }}
              document={{
                id: "doc1",
                vendor: "Acme Tools",
                date: "2026-06-08",
                totalMinor: 89900,
                currency: "USD",
                fileName: "acme-receipt.pdf",
                status: "extracted",
                extractionConfidence: 0.93,
                extractionNotes: "Vendor, date, and total read cleanly from the PDF.",
                matched: false,
              }}
              onMatch={() => {}}
            />
            <EvidenceUpload target={{ kind: "transaction", id: "t3" }} document={null} onUpload={() => {}} />
          </div>
        </Section>

        <Section title="AttentionState" description="The shared status vocabulary every surface reads from.">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {ALL_ATTENTION.map((kind) => (
                <AttentionState key={kind} state={kind} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {ALL_ATTENTION.map((kind) => (
                <AttentionState key={kind} state={kind} count={3} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {ALL_ATTENTION.map((kind) => (
                <AttentionState key={kind} state={kind} iconOnly />
              ))}
            </div>
            <Badge variant="outline">Money-in tone reference</Badge>
          </div>
        </Section>
      </main>

      <DetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        title={activeRow?.merchant ?? "Transaction"}
        subtitle={activeRow ? `${activeRow.date} · ${activeRow.bankAccountName}` : undefined}
        attention={activeRow?.review ? <AttentionState state={activeRow.review} /> : undefined}
        tabs={[
          {
            value: "overview",
            label: "Overview",
            content: activeRow ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Amount</span>
                  <Amount
                    amountMinor={activeRow.amountMinor}
                    signed
                    tone={activeRow.amountMinor > 0 ? "income" : "expense"}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Category</span>
                  <span>{activeRow.categoryName}</span>
                </div>
                {activeRow.confidence != null ? (
                  <AiInsightBadge
                    variant="inline"
                    confidence={activeRow.confidence}
                    reasoning={`Suggested ${activeRow.categoryName} for “${activeRow.merchant}”.`}
                    decidedBy={activeRow.decidedBy ?? undefined}
                  />
                ) : null}
              </div>
            ) : null,
          },
          {
            value: "accounting",
            label: "Accounting view",
            content: <p className="text-sm text-muted-foreground">Debits equal credits. Posted entries are immutable.</p>,
          },
        ]}
        footer={
          <>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>Close</Button>
            <Button>Post</Button>
          </>
        }
      />
    </div>
  );
}
