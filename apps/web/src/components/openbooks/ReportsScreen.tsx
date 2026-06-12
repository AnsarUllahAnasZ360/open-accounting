"use client";

import { useQuery } from "convex/react";
import {
  ArrowDownToLine,
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  FileText,
  Info,
  Landmark,
  ListTree,
  Printer,
  Scale,
  Sparkles,
  Table2,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Amount, AgingMiniBar, CategoryChip, EmptyState } from "@/components/openbooks/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  downloadReportFile,
  reportCsvFile,
  type ReportExportId,
  type ReportPack,
} from "@/lib/openbooks/reports-export";
import {
  REPORT_PRESETS,
  clampRange,
  defaultRangeForReport,
  formatAsOfLabel,
  formatRangeLabel,
  rangeForPreset,
  type DateRange,
  type ReportPresetId,
} from "@/lib/openbooks/report-periods";
import { createAiRequestEvent } from "@/lib/openbooks/ai";
import { api } from "../../../../../convex/_generated/api";

type ReportBasis = "accrual" | "cash";
type CompareMode = "none" | "priorPeriod" | "priorYear";
type ColumnMode = "total" | "monthly" | "quarterly";

type DrillLine = ReportPack["generalLedger"]["rows"][number];
type StatementRow = ReportPack["profitAndLoss"]["rows"][number];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ---- Report catalogue (home grid) ----------------------------------------

type ReportMeta = {
  id: ReportExportId;
  name: string;
  description: string;
  icon: typeof FileText;
  // Tiny preview bars (relative heights 0..1) + accent.
  viz: number[];
  accent: "green" | "teal" | "slate" | "amber";
};

const REPORT_GROUPS: Array<{ group: string; reports: ReportMeta[] }> = [
  {
    group: "Overview",
    reports: [
      { id: "monthly-review", name: "Monthly Review", description: "Your whole month on one page — in, out, owed, payroll.", icon: CalendarDays, viz: [0.5, 0.75, 0.6, 0.9, 1], accent: "green" },
    ],
  },
  {
    group: "Statements",
    reports: [
      { id: "profit-and-loss", name: "Profit & Loss", description: "How much you made and spent, by category.", icon: FileText, viz: [0.45, 0.7, 0.55, 0.85, 1], accent: "green" },
      { id: "balance-sheet", name: "Balance Sheet", description: "What you own and what you owe, right now.", icon: Scale, viz: [0.8, 0.8, 0.85, 0.85, 0.95], accent: "teal" },
      { id: "cash-flow", name: "Cash Flow", description: "Where cash actually came from and went.", icon: ArrowDownToLine, viz: [0.4, 0.85, 0.55, 0.7, 1], accent: "slate" },
    ],
  },
  {
    group: "Money owed",
    reports: [
      { id: "ar-aging", name: "AR Aging", description: "Who owes you, and how late they are.", icon: Landmark, viz: [1, 0.65, 0.4, 0.25, 0.12], accent: "amber" },
      { id: "ap-aging", name: "AP Aging", description: "What you owe vendors, by due date.", icon: Landmark, viz: [1, 0.55, 0.28, 0.16, 0.1], accent: "amber" },
    ],
  },
  {
    group: "Insights",
    reports: [
      { id: "expenses", name: "Expenses", description: "Spending by category and vendor, with trends.", icon: Columns3, viz: [0.9, 0.75, 0.6, 0.42, 0.25], accent: "slate" },
      { id: "income-by-customer", name: "Income by Customer", description: "Who your revenue really comes from.", icon: Columns3, viz: [1, 0.62, 0.46, 0.3, 0.16], accent: "green" },
      { id: "payroll-summary", name: "Payroll Summary", description: "Payroll by month, person, and currency.", icon: Columns3, viz: [0.75, 0.75, 0.8, 0.82, 0.85], accent: "slate" },
    ],
  },
  {
    group: "Accountant",
    reports: [
      { id: "general-ledger", name: "General Ledger", description: "Every posting, account by account.", icon: ListTree, viz: [0.6, 0.6, 0.6, 0.6, 0.6], accent: "slate" },
      { id: "trial-balance", name: "Trial Balance", description: "All accounts with debit and credit totals.", icon: Table2, viz: [0.85, 0.85, 0.85, 0.85, 0.85], accent: "slate" },
      { id: "journal", name: "Journal Entries", description: "The raw double-entry record.", icon: FileText, viz: [0.42, 0.78, 0.42, 0.78, 0.42], accent: "slate" },
    ],
  },
];

const ALL_REPORTS: ReportMeta[] = REPORT_GROUPS.flatMap((group) => group.reports);
const REPORT_BY_ID = new Map(ALL_REPORTS.map((report) => [report.id, report]));

const ACCENT_BG: Record<ReportMeta["accent"], string> = {
  green: "bg-primary",
  teal: "bg-teal-600",
  slate: "bg-muted-foreground/60",
  amber: "bg-amber-500",
};

function PreviewViz({ meta }: { meta: ReportMeta }) {
  return (
    <div className="flex h-6 items-end gap-[3px]" aria-hidden="true">
      {meta.viz.map((height, index) => (
        <span
          key={index}
          className={`w-[7px] rounded-sm ${ACCENT_BG[meta.accent]}`}
          style={{ height: `${Math.max(10, height * 100)}%` }}
        />
      ))}
    </div>
  );
}

// ---- Home grid -----------------------------------------------------------

function ReportsHome({ onOpen }: { onOpen: (id: ReportExportId) => void }) {
  return (
    <div className="space-y-6" data-testid="reports-home">
      {REPORT_GROUPS.map((group) => (
        <div key={group.group}>
          <div className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.group}</div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.reports.map((report) => (
              <button
                key={report.id}
                type="button"
                data-testid={`report-card-${report.id}`}
                onClick={() => onOpen(report.id)}
                className="flex flex-col gap-2 rounded-[14px] border bg-card p-4 text-left shadow-xs transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <PreviewViz meta={report} />
                <span className="text-sm font-semibold">{report.name}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{report.description}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Viewer toolbar ------------------------------------------------------

const COMPARE_BY_REPORT: Set<ReportExportId> = new Set([
  "profit-and-loss",
  "cash-flow",
  "expenses",
  "income-by-customer",
  "payroll-summary",
]);
const COLUMNS_BY_REPORT: Set<ReportExportId> = new Set(["profit-and-loss", "expenses"]);
const BASIS_BY_REPORT: Set<ReportExportId> = new Set([
  "profit-and-loss",
  "balance-sheet",
  "cash-flow",
  "ar-aging",
  "ap-aging",
  "expenses",
  "income-by-customer",
]);
const AS_OF_REPORTS: Set<ReportExportId> = new Set(["balance-sheet", "trial-balance", "ar-aging", "ap-aging"]);

function ViewerToolbar({
  reportId,
  preset,
  range,
  basis,
  compare,
  columnMode,
  onPreset,
  onRange,
  onBasis,
  onCompare,
  onColumnMode,
  onExplain,
  onExport,
  exportDisabled,
}: {
  reportId: ReportExportId;
  preset: ReportPresetId;
  range: DateRange;
  basis: ReportBasis;
  compare: CompareMode;
  columnMode: ColumnMode;
  onPreset: (value: ReportPresetId) => void;
  onRange: (value: DateRange) => void;
  onBasis: (value: ReportBasis) => void;
  onCompare: (value: CompareMode) => void;
  onColumnMode: (value: ColumnMode) => void;
  onExplain: () => void;
  onExport: () => void;
  exportDisabled: boolean;
}) {
  const today = todayIso();
  const asOf = AS_OF_REPORTS.has(reportId);
  const showBasis = BASIS_BY_REPORT.has(reportId);
  const showCompare = COMPARE_BY_REPORT.has(reportId);
  const showColumns = COLUMNS_BY_REPORT.has(reportId);

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-[14px] border bg-card p-4 shadow-xs" data-testid="viewer-toolbar">
      <div className="grid gap-1.5">
        <Label className="text-xs">Range</Label>
        <Select value={preset} onValueChange={(value) => onPreset(value as ReportPresetId)}>
          <SelectTrigger className="h-9 w-40" data-testid="range-preset">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REPORT_PRESETS.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {preset === "custom" ? (
        <>
          <div className="grid gap-1.5">
            <Label className="text-xs">Start</Label>
            <Input
              type="date"
              max={today}
              value={range.startDate}
              onChange={(event) => onRange(clampRange({ ...range, startDate: event.target.value }, today))}
              className="h-9 w-40"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">{asOf ? "As of" : "End"}</Label>
            <Input
              type="date"
              max={today}
              value={range.endDate}
              onChange={(event) => onRange(clampRange({ ...range, endDate: event.target.value }, today))}
              className="h-9 w-40"
            />
          </div>
        </>
      ) : (
        <div className="grid gap-1.5">
          <Label className="text-xs">{asOf ? "As of" : "Period"}</Label>
          <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm" data-testid="period-label">
            {asOf ? formatAsOfLabel(range.endDate) : formatRangeLabel(range)}
          </div>
        </div>
      )}

      {showCompare ? (
        <div className="grid gap-1.5">
          <Label className="text-xs">Compare</Label>
          <Select value={compare} onValueChange={(value) => onCompare(value as CompareMode)}>
            <SelectTrigger className="h-9 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="priorPeriod">Prior period</SelectItem>
              <SelectItem value="priorYear">Prior year</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {showColumns ? (
        <div className="grid gap-1.5">
          <Label className="text-xs">Columns</Label>
          <Select value={columnMode} onValueChange={(value) => onColumnMode(value as ColumnMode)}>
            <SelectTrigger className="h-9 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="total">Total</SelectItem>
              <SelectItem value="monthly">By month</SelectItem>
              <SelectItem value="quarterly">By quarter</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="flex-1" />

      {showBasis ? (
        <div className="flex items-center gap-1 rounded-[10px] bg-muted p-0.5" data-testid="basis-toggle">
          <button
            type="button"
            onClick={() => onBasis("accrual")}
            data-testid="basis-accrual"
            className={`h-7 rounded-lg px-3 text-xs font-medium transition-colors ${basis === "accrual" ? "bg-card shadow-xs" : "text-muted-foreground"}`}
          >
            Accrual
          </button>
          <button
            type="button"
            onClick={() => onBasis("cash")}
            data-testid="basis-cash"
            className={`h-7 rounded-lg px-3 text-xs font-medium transition-colors ${basis === "cash" ? "bg-card shadow-xs" : "text-muted-foreground"}`}
          >
            Cash
          </button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="What's accrual vs cash?" className="px-1 text-muted-foreground hover:text-foreground">
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-64 text-xs">
                Accrual counts income when you invoice and expenses when you&apos;re billed. Cash counts them only when money
                actually moves — so open invoices and unpaid bills drop out.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      ) : null}

      <Button variant="outline" size="sm" onClick={onExplain} data-testid="explain-report">
        <Sparkles className="size-4" />
        Explain
      </Button>
      <Button variant="outline" size="sm" onClick={onExport} disabled={exportDisabled} data-testid="export-csv">
        <Download className="size-4" />
        Export CSV
      </Button>
    </div>
  );
}

// ---- Drill-down slide-over ----------------------------------------------

function DrillSheet({
  title,
  subtitle,
  rows,
  open,
  onOpenChange,
}: {
  title: string;
  subtitle: string;
  rows: DrillLine[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const total = rows.reduce((sum, row) => sum + row.amountMinor, 0);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-hidden p-0 sm:max-w-md" data-testid="drill-sheet">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{subtitle}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No transactions behind this number.</p>
          ) : (
            <div className="divide-y">
              {rows.map((row) => (
                <div key={row.id} className="flex items-center gap-3 py-2.5" data-testid="drill-row">
                  <span className="money-figures w-14 shrink-0 text-xs text-muted-foreground">{row.date.slice(5)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{row.memo}</div>
                    <div className="truncate text-xs text-muted-foreground">{row.accountNumber} · {row.accountName}</div>
                  </div>
                  <Amount amountMinor={row.amountMinor} className="text-sm" />
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t px-5 py-3 text-sm font-semibold">
          <span>Total</span>
          <span data-testid="drill-total">
            <Amount amountMinor={total} />
          </span>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---- A clickable money cell (every rendered number is a real button) ------

function MoneyButton({
  amountMinor,
  onDrill,
  tone,
  signed,
  className,
}: {
  amountMinor: number;
  onDrill?: () => void;
  tone?: "neutral" | "income" | "expense";
  signed?: boolean;
  className?: string;
}) {
  if (!onDrill) {
    return <Amount amountMinor={amountMinor} tone={tone} signed={signed} className={className} />;
  }
  return (
    <button
      type="button"
      onClick={onDrill}
      data-testid="money-button"
      className={`rounded px-1 py-0.5 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className ?? ""}`}
    >
      <Amount amountMinor={amountMinor} tone={tone} signed={signed} />
    </button>
  );
}

// ---- Statement table (P&L / balance sheet / expenses) --------------------

function StatementTable({
  rows,
  onDrill,
}: {
  rows: StatementRow[];
  onDrill: (title: string, lines: DrillLine[]) => void;
}) {
  const columns = rows[0]?.columns ?? [];
  if (rows.length === 0) {
    return <EmptyState title="No posted lines in this range" description="Try a wider date range or a different report." />;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-56">Account</TableHead>
            {columns.length > 1
              ? columns.map((column) => (
                  <TableHead key={column.key} className="text-right">
                    {column.label}
                  </TableHead>
                ))
              : null}
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <div className="font-medium">{row.label}</div>
                <div className="money-figures text-xs text-muted-foreground">{row.accountNumber}</div>
              </TableCell>
              {columns.length > 1
                ? (row.columns ?? []).map((column) => (
                    <TableCell key={column.key} className="text-right">
                      <MoneyButton
                        amountMinor={column.amountMinor}
                        onDrill={() =>
                          onDrill(
                            `${row.label} · ${column.label}`,
                            (row.drillDown ?? []).filter((line) => line.date.startsWith(columnKeyToPrefix(column.key))),
                          )
                        }
                      />
                    </TableCell>
                  ))
                : null}
              <TableCell className="text-right font-medium">
                <MoneyButton amountMinor={row.totalMinor} onDrill={() => onDrill(row.label, row.drillDown ?? [])} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// "2026-05" -> "2026-05"; "2026 Q2" -> "2026" (quarter prefix match is coarse).
function columnKeyToPrefix(key: string) {
  if (/^\d{4}-\d{2}$/.test(key)) return key;
  return key.slice(0, 4);
}

// ---- Individual report bodies -------------------------------------------

function NetBand({ label, amountMinor }: { label: string; amountMinor: number }) {
  return (
    <div className="flex items-center justify-between rounded-[14px] bg-primary/5 px-5 py-3.5">
      <span className="text-sm font-semibold text-primary">{label}</span>
      <span className="money-figures text-lg font-semibold text-primary">
        <Amount amountMinor={amountMinor} signed />
      </span>
    </div>
  );
}

function ProfitAndLoss({ pack, onDrill }: { pack: ReportPack; onDrill: (title: string, lines: DrillLine[]) => void }) {
  return (
    <div className="space-y-4">
      <ReportHeader title="Profit & Loss" subtitle={`${formatRangeLabel(pack.controls as DateRange)} · ${pack.controls.basis} basis · click any number to see its transactions`} />
      <section className="rounded-[14px] border bg-card shadow-xs">
        <div className="border-b px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Income</div>
        <StatementTable rows={pack.profitAndLoss.sections?.[0]?.rows ?? pack.profitAndLoss.rows.filter((row) => row.accountType === "income")} onDrill={onDrill} />
        <div className="border-y px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Expenses</div>
        <StatementTable rows={pack.profitAndLoss.sections?.[1]?.rows ?? pack.profitAndLoss.rows.filter((row) => row.accountType === "expense")} onDrill={onDrill} />
      </section>
      <NetBand label="Net profit" amountMinor={pack.profitAndLoss.netIncomeMinor} />
      <ComparePanel pack={pack} />
    </div>
  );
}

function ComparePanel({ pack }: { pack: ReportPack }) {
  const comparison = (pack.controls as { comparison?: DateRange | null }).comparison;
  if (!comparison) return null;
  return (
    <div className="rounded-[14px] border bg-muted/30 px-4 py-3 text-sm text-muted-foreground" data-testid="compare-panel">
      Comparing against {formatRangeLabel(comparison)}.
    </div>
  );
}

function ReportHeader({ title, subtitle, chip }: { title: string; subtitle: string; chip?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {chip}
    </div>
  );
}

function BalanceSheet({ pack, onDrill }: { pack: ReportPack; onDrill: (title: string, lines: DrillLine[]) => void }) {
  const sections = pack.balanceSheet.sections ?? [
    { key: "assets", label: "Assets", totalMinor: pack.balanceSheet.assetMinor, rows: pack.balanceSheet.rows.filter((r) => r.accountType === "asset") },
    { key: "liabilities", label: "Liabilities", totalMinor: pack.balanceSheet.liabilityMinor, rows: pack.balanceSheet.rows.filter((r) => r.accountType === "liability") },
    { key: "equity", label: "Equity", totalMinor: pack.balanceSheet.equityMinor, rows: pack.balanceSheet.rows.filter((r) => r.accountType === "equity") },
  ];
  return (
    <div className="space-y-4">
      <ReportHeader
        title="Balance Sheet"
        subtitle={`As of ${formatAsOfLabel(pack.balanceSheet.asOfDate)} · what you own and what you owe`}
        chip={
          <span
            data-testid="balanced-chip"
            className={`inline-flex h-6 items-center gap-1.5 rounded-full px-3 text-xs font-medium ${pack.balanceSheet.balanced ? "bg-primary/10 text-primary" : "bg-amber-100 text-amber-800"}`}
          >
            {pack.balanceSheet.balanced ? "✓ Balanced" : "Needs review"}
          </span>
        }
      />
      <section className="rounded-[14px] border bg-card shadow-xs">
        {sections.map((section) => (
          <div key={section.key}>
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.label}</span>
              <Amount amountMinor={section.totalMinor} className="text-sm font-semibold" />
            </div>
            <StatementTable rows={section.rows} onDrill={onDrill} />
          </div>
        ))}
        <div className="flex items-center justify-between bg-primary/5 px-4 py-3 text-sm font-semibold">
          <span>Liabilities + equity + earnings</span>
          <Amount amountMinor={pack.balanceSheet.liabilityMinor + pack.balanceSheet.equityMinor + pack.balanceSheet.currentEarningsMinor} />
        </div>
      </section>
    </div>
  );
}

function CashFlow({ pack }: { pack: ReportPack }) {
  const bridge = [
    { label: "Opening", value: pack.cashFlow.openingCashMinor, accent: "slate" as const },
    ...pack.cashFlow.groups.map((group) => ({ label: group.label, value: group.totalMinor, accent: group.totalMinor >= 0 ? ("green" as const) : ("amber" as const) })),
    { label: "Closing", value: pack.cashFlow.closingCashMinor, accent: "slate" as const },
  ];
  const maxBar = Math.max(...bridge.map((step) => Math.abs(step.value)), 1);
  return (
    <div className="space-y-4">
      <ReportHeader title="Cash Flow Statement" subtitle={`${formatRangeLabel(pack.controls as DateRange)} · where cash actually came from and went`} />
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-[14px] border bg-card shadow-xs">
          {pack.cashFlow.groups.map((group) => (
            <div key={group.key}>
              <div className="flex items-center justify-between border-b px-4 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</span>
                <Amount amountMinor={group.totalMinor} signed className="text-sm font-semibold" />
              </div>
              <div className="divide-y">
                {group.rows.length === 0 ? (
                  <div className="px-4 py-2.5 text-sm text-muted-foreground">No cash movements.</div>
                ) : (
                  group.rows.map((row) => (
                    <div key={row.id} className="flex items-center justify-between px-4 py-2 text-sm">
                      <span className="truncate text-muted-foreground">{row.date.slice(5)} · {row.memo}</span>
                      <Amount amountMinor={row.amountMinor} signed />
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between bg-primary/5 px-4 py-3 text-sm font-semibold">
            <span>Net change in cash</span>
            <Amount amountMinor={pack.cashFlow.netCashChangeMinor} signed />
          </div>
        </section>
        <section className="rounded-[14px] border bg-card p-5 shadow-xs">
          <div className="text-sm font-semibold">Opening → closing cash</div>
          <div className="mt-4 flex h-36 items-end gap-3">
            {bridge.map((step, index) => (
              <div key={index} className="flex flex-1 flex-col items-center justify-end gap-1.5">
                <span className="money-figures text-[10px] text-muted-foreground">
                  <Amount amountMinor={step.value} compact signed={index !== 0 && index !== bridge.length - 1} />
                </span>
                <div
                  className={`w-full rounded-t ${ACCENT_BG[step.accent]}`}
                  style={{ height: `${Math.max(4, (Math.abs(step.value) / maxBar) * 100)}%` }}
                />
                <span className="text-center text-[10px] leading-tight text-muted-foreground">{step.label}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function AgingReport({ pack, which }: { pack: ReportPack; which: "ar" | "ap" }) {
  const report = which === "ar" ? pack.arAging : pack.apAging;
  const title = which === "ar" ? "AR Aging" : "AP Aging";
  const who = which === "ar" ? "Customer" : "Vendor";
  const maxCell = Math.max(
    1,
    ...report.rows.flatMap((row) => [row.currentMinor, row.days30Minor, row.days60Minor, row.days90Minor]),
  );
  function heat(value: number) {
    if (value === 0) return "";
    const intensity = Math.min(0.28, (value / maxCell) * 0.3);
    return `rgba(245, 158, 11, ${intensity.toFixed(2)})`;
  }
  return (
    <div className="space-y-4">
      <ReportHeader
        title={title}
        subtitle={`As of ${formatAsOfLabel(pack.controls.endDate)} · total ${""}`}
        chip={<Amount amountMinor={report.totalMinor} className="text-sm font-semibold" />}
      />
      <section className="rounded-[14px] border bg-card shadow-xs">
        <div className="p-4">
          <AgingMiniBar
            current={report.buckets.currentMinor}
            days30={report.buckets.days30Minor}
            days60={report.buckets.days60Minor}
            days90={report.buckets.days90Minor}
          />
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{who}</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-right">1–30</TableHead>
                <TableHead className="text-right">31–60</TableHead>
                <TableHead className="text-right">61+</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  {[row.currentMinor, row.days30Minor, row.days60Minor, row.days90Minor].map((value, index) => (
                    <TableCell key={index} className="text-right" style={value ? { backgroundColor: heat(value) } : undefined}>
                      {value ? <Amount amountMinor={value} /> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-medium"><Amount amountMinor={row.totalMinor} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function VendorList({ title, rows }: { title: string; rows: Array<{ id: string; name: string; totalMinor: number }> }) {
  return (
    <section className="rounded-[14px] border bg-card shadow-xs">
      <div className="border-b px-4 py-3 text-sm font-semibold">{title}</div>
      <div className="divide-y">
        {rows.length === 0 ? (
          <div className="px-4 py-3 text-sm text-muted-foreground">Nothing here yet.</div>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="truncate">{row.name}</span>
              <Amount amountMinor={row.totalMinor} />
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ExpensesReport({ pack, onDrill }: { pack: ReportPack; onDrill: (title: string, lines: DrillLine[]) => void }) {
  return (
    <div className="space-y-4">
      <ReportHeader title="Expenses" subtitle={`${formatRangeLabel(pack.controls as DateRange)} · spending by category and vendor`} />
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-[14px] border bg-card shadow-xs">
          <div className="border-b px-4 py-3 text-sm font-semibold">By category</div>
          <StatementTable rows={pack.expenses.byCategory} onDrill={onDrill} />
        </section>
        <VendorList title="Top vendors" rows={pack.expenses.byVendor} />
      </div>
    </div>
  );
}

function IncomeByCustomer({ pack }: { pack: ReportPack }) {
  const max = Math.max(1, ...pack.incomeByCustomer.rows.map((row) => row.totalMinor));
  const total = pack.incomeByCustomer.totalMinor || 1;
  return (
    <div className="space-y-4">
      <ReportHeader title="Income by Customer" subtitle={`${formatRangeLabel(pack.controls as DateRange)} · who your revenue really comes from`} />
      <section className="rounded-[14px] border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-48">Share</TableHead>
                <TableHead className="text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pack.incomeByCustomer.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-right"><Amount amountMinor={row.totalMinor} /></TableCell>
                  <TableCell>
                    <span className="block h-2.5 overflow-hidden rounded bg-muted">
                      <span className="block h-full rounded bg-primary" style={{ width: `${Math.max(2, (row.totalMinor / max) * 100)}%` }} />
                    </span>
                  </TableCell>
                  <TableCell className="money-figures text-right text-muted-foreground">{Math.round((row.totalMinor / total) * 100)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function PayrollSummary({ pack }: { pack: ReportPack }) {
  return (
    <div className="space-y-4">
      <ReportHeader title="Payroll Summary" subtitle={`${formatRangeLabel(pack.controls as DateRange)} · payroll by month`} />
      <section className="rounded-[14px] border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Base total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pack.payrollSummary.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="money-figures font-medium">{row.period}</TableCell>
                  <TableCell className="capitalize text-muted-foreground">{row.status}</TableCell>
                  <TableCell className="text-right"><Amount amountMinor={row.totalBaseMinor} /></TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-semibold">Total</TableCell>
                <TableCell />
                <TableCell className="text-right font-semibold"><Amount amountMinor={pack.payrollSummary.totalMinor} /></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function GeneralLedger({ pack }: { pack: ReportPack }) {
  return (
    <div className="space-y-4">
      <ReportHeader title="General Ledger" subtitle={`${formatRangeLabel(pack.controls as DateRange)} · every posting, account by account`} />
      <section className="rounded-[14px] border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Memo</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pack.generalLedger.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="money-figures whitespace-nowrap">{row.date}</TableCell>
                  <TableCell className="max-w-xs truncate">{row.memo}</TableCell>
                  <TableCell>
                    <div className="font-medium">{row.accountName}</div>
                    <div className="money-figures text-xs text-muted-foreground">{row.accountNumber}</div>
                  </TableCell>
                  <TableCell className="text-right"><Amount amountMinor={row.debitMinor} /></TableCell>
                  <TableCell className="text-right"><Amount amountMinor={row.creditMinor} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function TrialBalance({ pack }: { pack: ReportPack }) {
  return (
    <div className="space-y-4">
      <ReportHeader
        title="Trial Balance"
        subtitle={`As of ${formatAsOfLabel(pack.controls.endDate)} · every account's debit and credit balance`}
        chip={
          <span className={`inline-flex h-6 items-center gap-1.5 rounded-full px-3 text-xs font-medium ${pack.trialBalance.differenceMinor === 0 ? "bg-primary/10 text-primary" : "bg-amber-100 text-amber-800"}`}>
            {pack.trialBalance.differenceMinor === 0 ? "✓ Balanced" : `Off by ${pack.trialBalance.differenceMinor}`}
          </span>
        }
      />
      <section className="rounded-[14px] border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">#</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pack.trialBalance.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="money-figures text-xs text-muted-foreground">{row.accountNumber}</TableCell>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell className="text-right"><Amount amountMinor={row.debitMinor} /></TableCell>
                  <TableCell className="text-right"><Amount amountMinor={row.creditMinor} /></TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell />
                <TableCell className="font-semibold">Total</TableCell>
                <TableCell className="text-right font-semibold"><Amount amountMinor={pack.trialBalance.totalDebitMinor} /></TableCell>
                <TableCell className="text-right font-semibold"><Amount amountMinor={pack.trialBalance.totalCreditMinor} /></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function JournalEntries({ pack }: { pack: ReportPack }) {
  return (
    <div className="space-y-4">
      <ReportHeader title="Journal Entries" subtitle={`${formatRangeLabel(pack.controls as DateRange)} · the raw double-entry record`} />
      <div className="space-y-3">
        {pack.journal.entries.map((entry) => (
          <section key={entry.id} className="rounded-[14px] border bg-card shadow-xs">
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
              <span className="text-sm font-semibold">{entry.memo}</span>
              <CategoryChip label={entry.source} />
              <span className="money-figures ml-auto text-xs text-muted-foreground">{entry.date}</span>
            </div>
            <div className="divide-y">
              {entry.lines.map((line) => (
                <div key={line.id} className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-2 text-sm">
                  <span className="text-muted-foreground">{line.accountNumber} · {line.accountName}</span>
                  <Amount amountMinor={line.debitMinor} className="w-24 text-right" />
                  <Amount amountMinor={line.creditMinor} className="w-24 text-right" />
                </div>
              ))}
            </div>
          </section>
        ))}
        {pack.journal.entries.length === 0 ? <EmptyState title="No journal entries in this range" /> : null}
      </div>
    </div>
  );
}

// ---- Monthly Review hero one-pager ---------------------------------------

function MonthlyReview({
  pack,
  monthRange,
  onShiftMonth,
  onOpenReport,
}: {
  pack: ReportPack;
  monthRange: DateRange;
  onShiftMonth: (delta: number) => void;
  onOpenReport: (id: ReportExportId) => void;
}) {
  const mr = pack.monthlyReview;
  const nextDisabled = (() => {
    // Disable "next" if it would move the month past the current month.
    const today = todayIso();
    return monthRange.endDate >= today.slice(0, 7) + "-01" && monthRange.startDate.slice(0, 7) >= today.slice(0, 7);
  })();
  return (
    <div className="space-y-4" data-testid="monthly-review">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Monthly Review</h2>
          <p className="text-sm text-muted-foreground">One page that tells you how the month went</p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={() => onShiftMonth(-1)} aria-label="Previous month" data-testid="mr-prev">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-28 text-center text-sm font-semibold" data-testid="mr-month">{formatRangeLabel(monthRange)}</span>
          <Button variant="outline" size="icon-sm" onClick={() => onShiftMonth(1)} aria-label="Next month" disabled={nextDisabled} data-testid="mr-next">
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="ml-2">
            <Printer className="size-4" />
            Print
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[14px] border bg-card shadow-xs">
        <div className="flex flex-wrap items-center gap-2 bg-primary/5 px-6 py-4 text-base">
          You made
          <span className="money-figures font-semibold text-primary"><Amount amountMinor={mr.moneyInMinor} /></span>, spent
          <span className="money-figures font-semibold"><Amount amountMinor={mr.moneyOutMinor} /></span>
          →
          <span className="money-figures text-lg font-semibold text-primary" data-testid="mr-net">
            <Amount amountMinor={mr.netResultMinor} signed />
          </span>
        </div>
        <div className="grid md:grid-cols-2">
          <MrSection title={`Money in · ${""}`} amountMinor={mr.moneyInMinor} link="Income by Customer →" onLink={() => onOpenReport("income-by-customer")} border>
            {mr.topCustomers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No income recorded this month.</p>
            ) : (
              mr.topCustomers.map((row) => (
                <div key={row.name} className="flex items-center justify-between text-sm">
                  <span>{row.name}</span>
                  <Amount amountMinor={row.totalMinor} />
                </div>
              ))
            )}
          </MrSection>
          <MrSection title="Money out" amountMinor={mr.moneyOutMinor} link="Full Profit & Loss →" onLink={() => onOpenReport("profit-and-loss")}>
            {mr.topExpenseCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground">No expenses recorded this month.</p>
            ) : (
              mr.topExpenseCategories.map((row) => (
                <div key={row.id} className="flex items-center justify-between text-sm">
                  <span>{row.label}</span>
                  <Amount amountMinor={row.totalMinor} />
                </div>
              ))
            )}
          </MrSection>
          <MrSection title="Owed to you" amountMinor={mr.owedToYouMinor} link="AR Aging →" onLink={() => onOpenReport("ar-aging")} border topBorder>
            <AgingMiniBar
              current={pack.arAging.buckets.currentMinor}
              days30={pack.arAging.buckets.days30Minor}
              days60={pack.arAging.buckets.days60Minor}
              days90={pack.arAging.buckets.days90Minor}
            />
            <p className="text-sm text-muted-foreground">{pack.arAging.rows.length} open invoices.</p>
          </MrSection>
          <MrSection title="You owe" amountMinor={mr.youOweMinor} link="AP Aging →" onLink={() => onOpenReport("ap-aging")} topBorder>
            <p className="text-sm text-muted-foreground">{pack.apAging.rows.length} open bills.</p>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payroll</div>
            <Amount amountMinor={mr.payrollMinor} className="text-sm" />
          </MrSection>
        </div>
      </div>
    </div>
  );
}

function MrSection({
  title,
  amountMinor,
  link,
  onLink,
  children,
  border,
  topBorder,
}: {
  title: string;
  amountMinor: number;
  link: string;
  onLink: () => void;
  children: React.ReactNode;
  border?: boolean;
  topBorder?: boolean;
}) {
  return (
    <div className={`space-y-3 p-5 ${border ? "md:border-r" : ""} ${topBorder ? "border-t" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        <Amount amountMinor={amountMinor} className="text-sm font-semibold" />
      </div>
      <div className="space-y-2">{children}</div>
      <button type="button" onClick={onLink} className="text-xs font-medium text-primary hover:underline">
        {link}
      </button>
    </div>
  );
}

// ---- Active report dispatcher --------------------------------------------

function ActiveReport({
  reportId,
  pack,
  onDrill,
  monthRange,
  onShiftMonth,
  onOpenReport,
}: {
  reportId: ReportExportId;
  pack: ReportPack;
  onDrill: (title: string, lines: DrillLine[]) => void;
  monthRange: DateRange;
  onShiftMonth: (delta: number) => void;
  onOpenReport: (id: ReportExportId) => void;
}) {
  switch (reportId) {
    case "monthly-review":
      return <MonthlyReview pack={pack} monthRange={monthRange} onShiftMonth={onShiftMonth} onOpenReport={onOpenReport} />;
    case "profit-and-loss":
      return <ProfitAndLoss pack={pack} onDrill={onDrill} />;
    case "balance-sheet":
      return <BalanceSheet pack={pack} onDrill={onDrill} />;
    case "cash-flow":
      return <CashFlow pack={pack} />;
    case "ar-aging":
      return <AgingReport pack={pack} which="ar" />;
    case "ap-aging":
      return <AgingReport pack={pack} which="ap" />;
    case "expenses":
      return <ExpensesReport pack={pack} onDrill={onDrill} />;
    case "income-by-customer":
      return <IncomeByCustomer pack={pack} />;
    case "payroll-summary":
      return <PayrollSummary pack={pack} />;
    case "general-ledger":
      return <GeneralLedger pack={pack} />;
    case "trial-balance":
      return <TrialBalance pack={pack} />;
    case "journal":
      return <JournalEntries pack={pack} />;
  }
}

// ---- Screen --------------------------------------------------------------

export function ReportsScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlReport = searchParams.get("report") as ReportExportId | null;
  const urlStart = searchParams.get("start");
  const urlEnd = searchParams.get("end");
  const selectedReport = urlReport && REPORT_BY_ID.has(urlReport) ? urlReport : null;

  const [preset, setPreset] = useState<ReportPresetId>("thisMonth");
  const [range, setRange] = useState<DateRange>(() => defaultRangeForReport("profit-and-loss", todayIso()).range);
  const [basis, setBasis] = useState<ReportBasis>("accrual");
  const [compare, setCompare] = useState<CompareMode>("none");
  const [columnMode, setColumnMode] = useState<ColumnMode>("total");
  const [drill, setDrill] = useState<{ title: string; rows: DrillLine[]; open: boolean }>({ title: "", rows: [], open: false });
  // Tracks which report we've applied the default period for. A ref (not state)
  // so resetting it never triggers a re-render or a cascading effect.
  const initializedForRef = useRef<string | null>(null);

  // When a report opens, set its sane default period (unless the URL carried an
  // explicit range from a dashboard drill-through). Intentionally syncs toolbar
  // state to the selected report; the ref guard makes it run once per change, so
  // it cannot cascade — hence the scoped rule disable.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!selectedReport) {
      initializedForRef.current = null;
      return;
    }
    if (initializedForRef.current === selectedReport) return;
    const today = todayIso();
    if (urlStart && urlEnd) {
      setPreset("custom");
      setRange(clampRange({ startDate: urlStart, endDate: urlEnd }, today));
    } else {
      const def = defaultRangeForReport(selectedReport, today);
      setPreset(def.preset);
      setRange(def.range);
    }
    setColumnMode(selectedReport === "profit-and-loss" ? "monthly" : "total");
    setCompare("none");
    setBasis("accrual");
    initializedForRef.current = selectedReport;
  }, [selectedReport, urlStart, urlEnd]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const queryArgs = useMemo(
    () => ({ startDate: range.startDate, endDate: range.endDate, basis, compare, columnMode }),
    [range.startDate, range.endDate, basis, compare, columnMode],
  );
  const pack = useQuery(api.reportViews.reportPack, selectedReport ? queryArgs : "skip") as ReportPack | undefined;

  const openReport = useCallback(
    (id: ReportExportId) => {
      router.push(`/reports?report=${id}`);
    },
    [router],
  );

  function goHome() {
    router.push("/reports");
  }

  function applyPreset(value: ReportPresetId) {
    setPreset(value);
    if (value !== "custom") {
      setRange(rangeForPreset(value, todayIso()));
    }
  }

  function shiftMonth(delta: number) {
    // Shift the single-month range by delta months, clamped to not exceed today.
    const [y, m] = range.startDate.split("-").map(Number);
    const total = y * 12 + (m - 1) + delta;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    const today = todayIso();
    const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    const next = clampRange(
      { startDate: `${ny}-${String(nm).padStart(2, "0")}-01`, endDate: `${ny}-${String(nm).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` },
      today,
    );
    setPreset("custom");
    setRange(next);
  }

  function exportCsv() {
    if (!pack || !selectedReport) return;
    downloadReportFile(reportCsvFile(selectedReport, pack));
  }

  function openDrill(title: string, rows: DrillLine[]) {
    setDrill({ title, rows, open: true });
  }

  if (!selectedReport) {
    return (
      <div className="space-y-5" data-testid="reports-screen">
        <ReportsHome onOpen={openReport} />
      </div>
    );
  }

  const meta = REPORT_BY_ID.get(selectedReport)!;
  const isMonthlyReview = selectedReport === "monthly-review";

  return (
    <div className="space-y-4" data-testid="reports-screen">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={goHome} data-testid="reports-back">
          <ArrowLeft className="size-4" />
          Reports
        </Button>
      </div>

      {isMonthlyReview ? null : (
        <ViewerToolbar
          reportId={selectedReport}
          preset={preset}
          range={range}
          basis={basis}
          compare={compare}
          columnMode={columnMode}
          onPreset={applyPreset}
          onRange={(value) => {
            setPreset("custom");
            setRange(value);
          }}
          onBasis={setBasis}
          onCompare={setCompare}
          onColumnMode={setColumnMode}
          onExplain={() =>
            window.dispatchEvent(createAiRequestEvent(`Explain the ${meta.name} for ${formatRangeLabel(range)}`, "Reports", pack))
          }
          onExport={exportCsv}
          exportDisabled={!pack}
        />
      )}

      {pack === undefined ? (
        <section className="rounded-[14px] border bg-card p-6 text-sm text-muted-foreground shadow-xs">Loading {meta.name}…</section>
      ) : (
        <ActiveReport
          reportId={selectedReport}
          pack={pack}
          onDrill={openDrill}
          monthRange={range}
          onShiftMonth={shiftMonth}
          onOpenReport={openReport}
        />
      )}

      {isMonthlyReview ? (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!pack} data-testid="export-csv">
            <Download className="size-4" />
            Export CSV
          </Button>
        </div>
      ) : null}

      <DrillSheet
        title={drill.title}
        subtitle="Journal lines behind this number."
        rows={drill.rows}
        open={drill.open}
        onOpenChange={(open) => setDrill((current) => ({ ...current, open }))}
      />
    </div>
  );
}
