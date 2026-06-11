"use client";

import { useQuery } from "convex/react";
import {
  ArrowDownToLine,
  CalendarDays,
  CheckCircle2,
  Columns3,
  Download,
  FileArchive,
  FileText,
  Landmark,
  ListTree,
  PanelRightOpen,
  Scale,
  Table2,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Amount, AgingMiniBar, CategoryChip, EmptyState } from "@/components/openbooks/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  reportsCsvBundle,
  settingsDataExportFiles,
  type ReportExportId,
  type ReportPack,
} from "@/lib/openbooks/reports-export";
import { api } from "../../../../../convex/_generated/api";

type ReportBasis = "accrual" | "cash";
type CompareMode = "none" | "priorPeriod" | "priorYear";
type ColumnMode = "total" | "monthly" | "quarterly";

type DrillLine = ReportPack["generalLedger"]["rows"][number];
type StatementRow = ReportPack["profitAndLoss"]["rows"][number];

const reportGroups: Array<{
  group: string;
  reports: Array<{
    id: ReportExportId;
    name: string;
    description: string;
    icon: typeof FileText;
  }>;
}> = [
  {
    group: "Overview",
    reports: [
      {
        id: "monthly-review",
        name: "Monthly Review",
        description: "Owner one-pager for the month.",
        icon: CalendarDays,
      },
    ],
  },
  {
    group: "Statements",
    reports: [
      { id: "profit-and-loss", name: "Profit & Loss", description: "Income, expenses, and net profit.", icon: FileText },
      { id: "balance-sheet", name: "Balance Sheet", description: "Assets, liabilities, and equity.", icon: Scale },
      { id: "cash-flow", name: "Cash Flow", description: "Opening cash to closing cash.", icon: ArrowDownToLine },
    ],
  },
  {
    group: "Money owed",
    reports: [
      { id: "ar-aging", name: "AR Aging", description: "Who owes you money.", icon: Landmark },
      { id: "ap-aging", name: "AP Aging", description: "Who you need to pay.", icon: Landmark },
    ],
  },
  {
    group: "Insights",
    reports: [
      { id: "expenses", name: "Expenses", description: "Spend by category and vendor.", icon: Columns3 },
      { id: "income-by-customer", name: "Income by Customer", description: "Customer concentration.", icon: Columns3 },
      { id: "payroll-summary", name: "Payroll Summary", description: "Payroll by period.", icon: Columns3 },
    ],
  },
  {
    group: "Accountant",
    reports: [
      { id: "general-ledger", name: "General Ledger", description: "Account activity line by line.", icon: ListTree },
      { id: "trial-balance", name: "Trial Balance", description: "Debit and credit check.", icon: Table2 },
      { id: "journal", name: "Journal Entries", description: "Entry-centric register.", icon: FileText },
    ],
  },
];

const presets = {
  year: { label: "2026 year", startDate: "2026-01-01", endDate: "2026-12-31" },
  q2: { label: "Q2 2026", startDate: "2026-04-01", endDate: "2026-06-30" },
  may: { label: "May 2026", startDate: "2026-05-01", endDate: "2026-05-31" },
  custom: { label: "Custom", startDate: "", endDate: "" },
};

function LoadingBlock() {
  return (
    <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground shadow-xs">
      Loading reports...
    </section>
  );
}

function formatReportDateRange(pack: ReportPack) {
  return `${pack.controls.startDate} to ${pack.controls.endDate}`;
}

function ReportCard({
  id,
  name,
  description,
  icon: Icon,
  selected,
  onSelect,
}: {
  id: ReportExportId;
  name: string;
  description: string;
  icon: typeof FileText;
  selected: boolean;
  onSelect: (id: ReportExportId) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={`rounded-lg border bg-card p-3 text-left shadow-xs transition-colors hover:bg-muted/50 ${
        selected ? "border-primary/40 ring-1 ring-primary/20" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <span className={`rounded-md border p-2 ${selected ? "text-primary" : "text-muted-foreground"}`}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{name}</span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
        </span>
      </div>
    </button>
  );
}

function ReportPicker({
  selectedReport,
  onSelect,
}: {
  selectedReport: ReportExportId;
  onSelect: (id: ReportExportId) => void;
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-5">
      {reportGroups.map((group) => (
        <div key={group.group} className="space-y-2">
          <div className="text-xs font-medium uppercase text-muted-foreground">{group.group}</div>
          <div className="grid gap-2">
            {group.reports.map((report) => (
              <ReportCard
                key={report.id}
                {...report}
                selected={selectedReport === report.id}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function ReportsToolbar({
  preset,
  setPreset,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  basis,
  setBasis,
  compare,
  setCompare,
  columnMode,
  setColumnMode,
  pack,
  selectedReport,
}: {
  preset: keyof typeof presets;
  setPreset: (value: keyof typeof presets) => void;
  startDate: string;
  setStartDate: (value: string) => void;
  endDate: string;
  setEndDate: (value: string) => void;
  basis: ReportBasis;
  setBasis: (value: ReportBasis) => void;
  compare: CompareMode;
  setCompare: (value: CompareMode) => void;
  columnMode: ColumnMode;
  setColumnMode: (value: ColumnMode) => void;
  pack: ReportPack | undefined;
  selectedReport: ReportExportId;
}) {
  function applyPreset(value: keyof typeof presets) {
    setPreset(value);
    if (value !== "custom") {
      setStartDate(presets[value].startDate);
      setEndDate(presets[value].endDate);
    }
  }

  function exportCurrent() {
    if (!pack) return;
    downloadReportFile(reportCsvFile(selectedReport, pack));
  }

  function exportCsvBundle() {
    if (!pack) return;
    for (const file of reportsCsvBundle(pack)) {
      downloadReportFile(file);
    }
  }

  function exportSettingsJson() {
    if (!pack) return;
    const jsonFile = settingsDataExportFiles(pack).find((file) => file.mimeType === "application/json");
    if (jsonFile) downloadReportFile(jsonFile);
  }

  return (
    <section className="rounded-lg border bg-card p-4 shadow-xs">
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label>Range</Label>
            <Select value={preset} onValueChange={(value) => applyPreset(value as keyof typeof presets)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(presets).map(([value, item]) => (
                  <SelectItem key={value} value={value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Start</Label>
            <Input value={startDate} onChange={(event) => {
              setPreset("custom");
              setStartDate(event.target.value);
            }} type="date" />
          </div>
          <div className="grid gap-1.5">
            <Label>End</Label>
            <Input value={endDate} onChange={(event) => {
              setPreset("custom");
              setEndDate(event.target.value);
            }} type="date" />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label>Basis</Label>
            <Select value={basis} onValueChange={(value) => setBasis(value as ReportBasis)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="accrual">Accrual</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Compare</Label>
            <Select value={compare} onValueChange={(value) => setCompare(value as CompareMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="priorPeriod">Prior period</SelectItem>
                <SelectItem value="priorYear">Prior year</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Columns</Label>
            <Select value={columnMode} onValueChange={(value) => setColumnMode(value as ColumnMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="total">Total</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          <div className="font-medium text-foreground">Cash basis</div>
          <div className="mt-1">Open invoice and bill accrual entries are excluded from P&L figures.</div>
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Button variant="outline" onClick={exportCurrent} disabled={!pack}>
            <Download className="size-4" />
            Export CSV
          </Button>
          <Button variant="outline" onClick={exportCsvBundle} disabled={!pack}>
            <FileArchive className="size-4" />
            CSV bundle
          </Button>
          <Button variant="outline" onClick={exportSettingsJson} disabled={!pack}>
            <FileText className="size-4" />
            JSON
          </Button>
        </div>
      </div>
    </section>
  );
}

function StatementTable({
  rows,
  onDrill,
}: {
  rows: StatementRow[];
  onDrill: (title: string, lines: DrillLine[]) => void;
}) {
  const columns = rows[0]?.columns ?? [];
  if (rows.length === 0) {
    return <EmptyState title="No posted lines in this range" description="Try a wider date range or seed the demo books." />;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-64">Account</TableHead>
            <TableHead className="text-right">Total</TableHead>
            {columns.map((column) => (
              <TableHead key={column.key} className="text-right">
                {column.label}
              </TableHead>
            ))}
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <div className="font-medium">{row.label}</div>
                <div className="money-figures text-xs text-muted-foreground">{row.accountNumber}</div>
              </TableCell>
              <TableCell className="text-right">
                <Amount amountMinor={row.totalMinor} />
              </TableCell>
              {(row.columns ?? []).map((column) => (
                <TableCell key={column.key} className="text-right">
                  <Amount amountMinor={column.amountMinor} />
                </TableCell>
              ))}
              <TableCell>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => onDrill(row.label, row.drillDown ?? [])}
                  aria-label={`Drill into ${row.label}`}
                >
                  <PanelRightOpen className="size-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SummaryBand({ pack }: { pack: ReportPack }) {
  return (
    <section className="grid gap-3 md:grid-cols-4">
      <div className="rounded-lg border bg-card p-4 shadow-xs">
        <div className="text-xs text-muted-foreground">Money in</div>
        <div className="mt-1 text-xl font-semibold">
          <Amount amountMinor={pack.monthlyReview.moneyInMinor} tone="income" />
        </div>
      </div>
      <div className="rounded-lg border bg-card p-4 shadow-xs">
        <div className="text-xs text-muted-foreground">Money out</div>
        <div className="mt-1 text-xl font-semibold">
          <Amount amountMinor={pack.monthlyReview.moneyOutMinor} tone="expense" />
        </div>
      </div>
      <div className="rounded-lg border bg-card p-4 shadow-xs">
        <div className="text-xs text-muted-foreground">Net result</div>
        <div className="mt-1 text-xl font-semibold">
          <Amount amountMinor={pack.monthlyReview.netResultMinor} signed />
        </div>
      </div>
      <div className="rounded-lg border bg-card p-4 shadow-xs">
        <div className="text-xs text-muted-foreground">Payroll</div>
        <div className="mt-1 text-xl font-semibold">
          <Amount amountMinor={pack.monthlyReview.payrollMinor} />
        </div>
      </div>
    </section>
  );
}

function MonthlyReview({ pack }: { pack: ReportPack }) {
  return (
    <div className="space-y-4">
      <SummaryBand pack={pack} />
      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-lg border bg-card shadow-xs">
          <div className="border-b px-4 py-3">
            <h2 className="text-base font-semibold">Money in</h2>
            <p className="mt-1 text-sm text-muted-foreground">Top customers for {pack.monthlyReview.month}.</p>
          </div>
          <div className="divide-y">
            {pack.monthlyReview.topCustomers.map((row) => (
              <div key={row.name} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="font-medium">{row.name}</span>
                <Amount amountMinor={row.totalMinor} tone="income" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border bg-card shadow-xs">
          <div className="border-b px-4 py-3">
            <h2 className="text-base font-semibold">Owed to you and you owe</h2>
            <p className="mt-1 text-sm text-muted-foreground">Open AR and AP as of {pack.controls.endDate}.</p>
          </div>
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <div>
              <div className="text-xs text-muted-foreground">Owed to you</div>
              <div className="mt-1 text-lg font-semibold"><Amount amountMinor={pack.monthlyReview.owedToYouMinor} /></div>
              <div className="mt-3">
                <AgingMiniBar
                  current={pack.arAging.buckets.currentMinor}
                  days30={pack.arAging.buckets.days30Minor}
                  days60={pack.arAging.buckets.days60Minor}
                  days90={pack.arAging.buckets.days90Minor}
                />
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">You owe</div>
              <div className="mt-1 text-lg font-semibold"><Amount amountMinor={pack.monthlyReview.youOweMinor} /></div>
              <div className="mt-3">
                <AgingMiniBar
                  current={pack.apAging.buckets.currentMinor}
                  days30={pack.apAging.buckets.days30Minor}
                  days60={pack.apAging.buckets.days60Minor}
                  days90={pack.apAging.buckets.days90Minor}
                />
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="rounded-lg border bg-card shadow-xs">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold">Money out</h2>
          <p className="mt-1 text-sm text-muted-foreground">Ranked expense categories.</p>
        </div>
        <StatementTable rows={pack.monthlyReview.topExpenseCategories} onDrill={() => undefined} />
      </section>
    </div>
  );
}

function ProfitAndLoss({
  pack,
  onDrill,
}: {
  pack: ReportPack;
  onDrill: (title: string, lines: DrillLine[]) => void;
}) {
  return (
    <div className="space-y-4">
      <SummaryBand pack={pack} />
      <section className="rounded-lg border bg-card shadow-xs">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold">Profit & Loss</h2>
          <p className="mt-1 text-sm text-muted-foreground">{formatReportDateRange(pack)} - {pack.controls.basis}</p>
        </div>
        <StatementTable rows={pack.profitAndLoss.rows} onDrill={onDrill} />
        <div className="flex justify-end border-t px-4 py-3 text-sm font-semibold">
          Net profit: <span className="ml-3"><Amount amountMinor={pack.profitAndLoss.netIncomeMinor} /></span>
        </div>
      </section>
    </div>
  );
}

function BalanceSheet({
  pack,
  onDrill,
}: {
  pack: ReportPack;
  onDrill: (title: string, lines: DrillLine[]) => void;
}) {
  return (
    <section className="rounded-lg border bg-card shadow-xs">
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Balance Sheet</h2>
          <p className="mt-1 text-sm text-muted-foreground">As of {pack.balanceSheet.asOfDate}</p>
        </div>
        <CategoryChip active={pack.balanceSheet.balanced} label={pack.balanceSheet.balanced ? "Balanced" : "Needs review"} />
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-4">
        <div>
          <div className="text-xs text-muted-foreground">Assets</div>
          <div className="mt-1 text-lg font-semibold"><Amount amountMinor={pack.balanceSheet.assetMinor} /></div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Liabilities</div>
          <div className="mt-1 text-lg font-semibold"><Amount amountMinor={pack.balanceSheet.liabilityMinor} /></div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Equity plus earnings</div>
          <div className="mt-1 text-lg font-semibold">
            <Amount amountMinor={pack.balanceSheet.equityMinor + pack.balanceSheet.currentEarningsMinor} />
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Difference</div>
          <div className="mt-1 flex items-center gap-2 text-lg font-semibold">
            {pack.balanceSheet.balanced ? <CheckCircle2 className="size-4 text-primary" /> : null}
            <Amount amountMinor={pack.balanceSheet.differenceMinor} />
          </div>
        </div>
      </div>
      <StatementTable rows={pack.balanceSheet.rows} onDrill={onDrill} />
    </section>
  );
}

function CashFlow({ pack }: { pack: ReportPack }) {
  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-4 shadow-xs">
          <div className="text-xs text-muted-foreground">Opening cash</div>
          <div className="mt-1 text-xl font-semibold"><Amount amountMinor={pack.cashFlow.openingCashMinor} /></div>
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-xs">
          <div className="text-xs text-muted-foreground">Net cash change</div>
          <div className="mt-1 text-xl font-semibold"><Amount amountMinor={pack.cashFlow.netCashChangeMinor} signed /></div>
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-xs">
          <div className="text-xs text-muted-foreground">Closing cash</div>
          <div className="mt-1 text-xl font-semibold"><Amount amountMinor={pack.cashFlow.closingCashMinor} /></div>
        </div>
      </section>
      <section className="rounded-lg border bg-card shadow-xs">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold">Cash Flow</h2>
          <p className="mt-1 text-sm text-muted-foreground">Direct cash movements grouped by operating, investing, and financing.</p>
        </div>
        <div className="divide-y">
          {pack.cashFlow.groups.map((group) => (
            <div key={group.key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <div className="font-medium">{group.label}</div>
                <div className="text-muted-foreground">{group.rows.length} cash lines</div>
              </div>
              <Amount amountMinor={group.totalMinor} signed />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function AgingReport({ title, report }: { title: string; report: ReportPack["arAging"] }) {
  return (
    <section className="rounded-lg border bg-card shadow-xs">
      <div className="border-b px-4 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Open balances by due-date bucket.</p>
      </div>
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
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="text-right">1-30</TableHead>
              <TableHead className="text-right">31-60</TableHead>
              <TableHead className="text-right">61+</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="text-right"><Amount amountMinor={row.currentMinor} /></TableCell>
                <TableCell className="text-right"><Amount amountMinor={row.days30Minor} /></TableCell>
                <TableCell className="text-right"><Amount amountMinor={row.days60Minor} /></TableCell>
                <TableCell className="text-right"><Amount amountMinor={row.days90Minor} /></TableCell>
                <TableCell className="text-right font-medium"><Amount amountMinor={row.totalMinor} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function SimpleTotalsTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ id: string; name: string; totalMinor: number }>;
}) {
  return (
    <section className="rounded-lg border bg-card shadow-xs">
      <div className="border-b px-4 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <div className="divide-y">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span className="font-medium">{row.name}</span>
            <Amount amountMinor={row.totalMinor} />
          </div>
        ))}
      </div>
    </section>
  );
}

function PayrollSummary({ pack }: { pack: ReportPack }) {
  return (
    <section className="rounded-lg border bg-card shadow-xs">
      <div className="border-b px-4 py-3">
        <h2 className="text-base font-semibold">Payroll Summary</h2>
        <p className="mt-1 text-sm text-muted-foreground">Approved payroll runs in the selected range.</p>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Base total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pack.payrollSummary.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="money-figures">{row.period}</TableCell>
                <TableCell className="capitalize">{row.status}</TableCell>
                <TableCell className="text-right"><Amount amountMinor={row.totalBaseMinor} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function GeneralLedger({ pack }: { pack: ReportPack }) {
  return (
    <section className="rounded-lg border bg-card shadow-xs">
      <div className="border-b px-4 py-3">
        <h2 className="text-base font-semibold">General Ledger</h2>
        <p className="mt-1 text-sm text-muted-foreground">Posted journal lines for {formatReportDateRange(pack)}.</p>
      </div>
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
                <TableCell className="money-figures">{row.date}</TableCell>
                <TableCell>{row.memo}</TableCell>
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
  );
}

function TrialBalance({ pack }: { pack: ReportPack }) {
  return (
    <section className="rounded-lg border bg-card shadow-xs">
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Trial Balance</h2>
          <p className="mt-1 text-sm text-muted-foreground">Debits and credits for {formatReportDateRange(pack)}.</p>
        </div>
        <CategoryChip active={pack.trialBalance.differenceMinor === 0} label={`Difference ${pack.trialBalance.differenceMinor}`} />
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pack.trialBalance.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="font-medium">{row.label}</div>
                  <div className="money-figures text-xs text-muted-foreground">{row.accountNumber}</div>
                </TableCell>
                <TableCell className="capitalize">{row.accountType}</TableCell>
                <TableCell className="text-right"><Amount amountMinor={row.debitMinor} /></TableCell>
                <TableCell className="text-right"><Amount amountMinor={row.creditMinor} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function DrillSheet({
  title,
  rows,
  onOpenChange,
}: {
  title: string;
  rows: DrillLine[];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={rows.length > 0} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>Journal lines behind the selected report number.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Memo</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="money-figures text-xs">{row.date}</TableCell>
                  <TableCell>
                    <div className="font-medium">{row.memo}</div>
                    <div className="text-xs text-muted-foreground">{row.accountNumber} - {row.accountName}</div>
                  </TableCell>
                  <TableCell className="text-right"><Amount amountMinor={row.amountMinor} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ActiveReport({
  selectedReport,
  pack,
  onDrill,
}: {
  selectedReport: ReportExportId;
  pack: ReportPack;
  onDrill: (title: string, lines: DrillLine[]) => void;
}) {
  switch (selectedReport) {
    case "monthly-review":
      return <MonthlyReview pack={pack} />;
    case "profit-and-loss":
      return <ProfitAndLoss pack={pack} onDrill={onDrill} />;
    case "balance-sheet":
      return <BalanceSheet pack={pack} onDrill={onDrill} />;
    case "cash-flow":
      return <CashFlow pack={pack} />;
    case "ar-aging":
      return <AgingReport title="AR Aging" report={pack.arAging} />;
    case "ap-aging":
      return <AgingReport title="AP Aging" report={pack.apAging} />;
    case "expenses":
      return (
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="rounded-lg border bg-card shadow-xs">
            <div className="border-b px-4 py-3">
              <h2 className="text-base font-semibold">Expenses by category</h2>
            </div>
            <StatementTable rows={pack.expenses.byCategory} onDrill={onDrill} />
          </section>
          <SimpleTotalsTable title="Expenses by vendor" rows={pack.expenses.byVendor} />
        </div>
      );
    case "income-by-customer":
      return <SimpleTotalsTable title="Income by Customer" rows={pack.incomeByCustomer.rows} />;
    case "payroll-summary":
      return <PayrollSummary pack={pack} />;
    case "general-ledger":
      return <GeneralLedger pack={pack} />;
    case "trial-balance":
      return <TrialBalance pack={pack} />;
    case "journal":
      return (
        <section className="rounded-lg border bg-card shadow-xs">
          <div className="border-b px-4 py-3">
            <h2 className="text-base font-semibold">Journal Entries</h2>
          </div>
          <div className="divide-y">
            {pack.journal.entries.map((entry) => (
              <div key={entry.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{entry.memo}</div>
                    <div className="money-figures text-xs text-muted-foreground">{entry.date} - {entry.source}</div>
                  </div>
                  <CategoryChip label={`${entry.lines.length} lines`} />
                </div>
              </div>
            ))}
          </div>
        </section>
      );
  }
}

export function ReportsScreen() {
  const [selectedReport, setSelectedReport] = useState<ReportExportId>("monthly-review");
  const [preset, setPreset] = useState<keyof typeof presets>("year");
  const [startDate, setStartDate] = useState(presets.year.startDate);
  const [endDate, setEndDate] = useState(presets.year.endDate);
  const [basis, setBasis] = useState<ReportBasis>("accrual");
  const [compare, setCompare] = useState<CompareMode>("none");
  const [columnMode, setColumnMode] = useState<ColumnMode>("monthly");
  const [drillTitle, setDrillTitle] = useState("");
  const [drillRows, setDrillRows] = useState<DrillLine[]>([]);

  const queryArgs = useMemo(
    () => ({ startDate, endDate, basis, compare, columnMode }),
    [basis, columnMode, compare, endDate, startDate],
  );
  const pack = useQuery(api.reportViews.reportPack, queryArgs) as ReportPack | undefined;

  function openDrill(title: string, rows: DrillLine[]) {
    setDrillTitle(title);
    setDrillRows(rows);
  }

  return (
    <div className="space-y-5" data-testid="reports-screen">
      <ReportPicker selectedReport={selectedReport} onSelect={setSelectedReport} />
      <ReportsToolbar
        preset={preset}
        setPreset={setPreset}
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        basis={basis}
        setBasis={setBasis}
        compare={compare}
        setCompare={setCompare}
        columnMode={columnMode}
        setColumnMode={setColumnMode}
        pack={pack}
        selectedReport={selectedReport}
      />
      {pack === undefined ? <LoadingBlock /> : <ActiveReport selectedReport={selectedReport} pack={pack} onDrill={openDrill} />}
      <DrillSheet title={drillTitle} rows={drillRows} onOpenChange={(open) => {
        if (!open) setDrillRows([]);
      }} />
    </div>
  );
}
