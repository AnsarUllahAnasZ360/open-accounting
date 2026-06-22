"use client";

import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  FileText,
  Info,
  Inbox,
  Landmark,
  ListTree,
  Lock,
  Printer,
  Scale,
  Sparkles,
  Table2,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Amount, AgingMiniBar, CategoryChip, EmptyState, formatMinorMoney } from "@/components/openbooks/primitives";
import { InsightBanner, buildPageInsight, useIsMobile } from "@/components/openbooks/workbench";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
  SheetFooter,
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
  useActiveEntity,
  useActiveScope,
  type EntityOption,
  type Scope,
} from "@/lib/openbooks/active-entity";
import {
  REPORT_PRESETS,
  clampRange,
  defaultRangeForReport,
  formatAsOfLabel,
  formatRangeLabel,
  lastFullMonth,
  rangeForPeriodParam,
  rangeForPreset,
  type DateRange,
  type ReportPresetId,
} from "@/lib/openbooks/report-periods";
import { createAiRequestEvent } from "@/lib/openbooks/ai";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

type ReportBasis = "accrual" | "cash";
type CompareMode = "none" | "priorPeriod" | "priorYear";
type ColumnMode = "total" | "monthly" | "quarterly";

type DrillLine = ReportPack["generalLedger"]["rows"][number];
type StatementRow = ReportPack["profitAndLoss"]["rows"][number];

// Where a drilled number hands off to. Income rows -> the Income lens, expense
// categories -> the Expenses lens, everything else -> the universal register.
// The handoff carries account + date-window params so the destination can scope
// itself; Reports never edits the ledger, it only points at the record.
type DrillContext = {
  lens: "income" | "expenses" | "transactions";
  accountNumber?: string;
  startDate?: string;
  endDate?: string;
};

// Build the drill-through link. We only emit params the destination lens
// actually consumes today, so the URL never implies a scope it can't deliver:
//   - Income honors `tab` (it deep-links to its Streams tab).
//   - Expenses does not read the URL, so we hand off the bare lens.
//   - Everything else lands on the universal register.
// `accountNumber`/`startDate`/`endDate` from the context are intentionally NOT
// emitted: the destination screens don't read them, so adding them would falsely
// promise the drilled account scope and date window reconcile when they don't.
// The in-app DrillSheet already shows the exact journal lines for the number.
function buildDrillHref(context: DrillContext): string {
  if (context.lens === "income") {
    return `/income?tab=streams`;
  }
  if (context.lens === "expenses") {
    return `/expenses`;
  }
  return `/transactions`;
}

function lensForAccountType(accountType?: string): DrillContext["lens"] {
  if (accountType === "income") return "income";
  if (accountType === "expense") return "expenses";
  return "transactions";
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatMinor(amountMinor: number) {
  return formatMinorMoney(amountMinor);
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

// Home-card preview + chart accents map to semantic chart tokens (never raw
// Tailwind teal/amber). chart-1 green, chart-2 teal, chart-3 amber, chart-4
// slate, chart-5 red. `negative` is reserved for cash-flow OUTFLOW bars.
const ACCENT_BG: Record<ReportMeta["accent"] | "negative", string> = {
  green: "bg-chart-1",
  teal: "bg-chart-2",
  slate: "bg-chart-4",
  amber: "bg-chart-3",
  negative: "bg-negative",
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

// ---- Close-the-books banner ----------------------------------------------

type CloseReadinessCheck = { id: string; label: string; ok: boolean };

function CloseBooksBanner({
  entityId,
  lockedThroughDate,
  monthLabel,
  lockThroughDate,
  checks,
  canClose,
}: {
  entityId: Id<"entities"> | null;
  lockedThroughDate: string | null;
  monthLabel: string;
  lockThroughDate: string;
  checks: CloseReadinessCheck[];
  canClose: boolean;
}) {
  const setPeriodLock = useMutation(api.ledger.setPeriodLock);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  // The month is considered closed if the lock covers its last day.
  const isClosed = Boolean(lockedThroughDate && lockedThroughDate >= lockThroughDate);
  const allReady = checks.every((check) => check.ok);

  async function runLock(throughDate: string | null) {
    if (!entityId) return;
    setPending(true);
    setMessage("");
    try {
      await setPeriodLock({ entityId, lockedThroughDate: throughDate });
      setMessage(throughDate ? `Closed ${monthLabel}. Posting before ${throughDate} is locked.` : `Reopened ${monthLabel}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update the period lock.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      data-testid="close-the-books"
      className="rounded-[14px] border bg-card p-4 shadow-xs"
    >
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${isClosed ? "bg-ai-surface text-ai" : "bg-muted text-muted-foreground"}`}
          aria-hidden="true"
        >
          {isClosed ? <Lock className="size-4" /> : <CalendarDays className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Close the books · {monthLabel}</h3>
            {isClosed ? (
              <span
                data-testid="close-locked-pill"
                className="inline-flex h-6 items-center gap-1.5 rounded-full bg-ai-surface px-2.5 text-xs font-medium text-ai"
              >
                <Lock className="size-3" />
                Locked
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isClosed
              ? `${monthLabel} is locked. Posted entries can't be changed, only reversed.`
              : `Lock ${monthLabel} once it's reconciled so the numbers can't drift.`}
          </p>

          {!isClosed ? (
            <ul className="mt-3 grid gap-1.5 sm:grid-cols-2" data-testid="close-checklist">
              {checks.map((check) => (
                <li key={check.id} className="flex items-center gap-2 text-sm">
                  <span
                    className={`flex size-4 shrink-0 items-center justify-center rounded-full ${check.ok ? "bg-ai-surface text-ai" : "bg-muted text-muted-foreground"}`}
                    aria-hidden="true"
                  >
                    {check.ok ? <Check className="size-3" /> : null}
                  </span>
                  <span className={check.ok ? "" : "text-muted-foreground"}>{check.label}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {message ? <p className="mt-3 text-xs text-muted-foreground">{message}</p> : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isClosed ? (
            canClose ? (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => runLock(null)}
                data-testid="reopen-books"
              >
                Reopen
              </Button>
            ) : null
          ) : canClose ? (
            <Button
              size="sm"
              disabled={pending || !allReady}
              onClick={() => runLock(lockThroughDate)}
              data-testid="close-books"
            >
              <Lock className="size-4" />
              {allReady ? `Close ${monthLabel}` : "Finish reconciling first"}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Ask an owner to close</span>
          )}
        </div>
      </div>
    </section>
  );
}

// ---- Bank reconciliation surface (E1-T12) --------------------------------
// Anchor on a statement ending balance, mark ledger lines cleared, watch the
// running difference, draft an adjusting fee/interest entry, and complete only
// at difference $0.00. Posts go through the single ledger path on the server.

function ReconciliationCard({ entityId }: { entityId: Id<"entities"> | null }) {
  const accountsData = useQuery(
    api.reconciliation.reconciliationAccounts,
    entityId ? { entityId } : {},
  );
  const [activeReconId, setActiveReconId] = useState<Id<"bankReconciliations"> | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<Id<"bankAccounts"> | null>(null);
  const [statementDate, setStatementDate] = useState("");
  const [statementBalance, setStatementBalance] = useState("");
  const [feeAmount, setFeeAmount] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  const startReconciliation = useMutation(api.reconciliation.startReconciliation);
  const toggleCleared = useMutation(api.reconciliation.toggleTransactionCleared);
  const addAdjusting = useMutation(api.reconciliation.addAdjustingEntry);
  const complete = useMutation(api.reconciliation.completeReconciliation);

  const worksheet = useQuery(
    api.reconciliation.reconciliationWorksheet,
    activeReconId ? { reconciliationId: activeReconId } : "skip",
  );

  const accounts = accountsData?.accounts ?? [];
  // Auto-resume an open reconciliation when one exists for the selected account.
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? null;

  async function run<T>(fn: () => Promise<T>) {
    setPending(true);
    setMessage("");
    try {
      return await fn();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reconciliation action failed.");
      return undefined;
    } finally {
      setPending(false);
    }
  }

  async function onStart() {
    if (!selectedAccountId || !statementDate || statementBalance.trim() === "") return;
    const minor = Math.round(Number(statementBalance) * 100);
    if (!Number.isFinite(minor)) {
      setMessage("Enter a valid statement ending balance.");
      return;
    }
    const result = await run(() =>
      startReconciliation({
        bankAccountId: selectedAccountId,
        statementEndDate: statementDate,
        statementEndBalanceMinor: minor,
      }),
    );
    if (result) setActiveReconId(result.reconciliationId);
  }

  return (
    <section data-testid="reconciliation-card" className="rounded-[14px] border bg-card p-4 shadow-xs">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden>
          <Scale className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Reconcile a bank account</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Match your books to a bank statement. Mark cleared lines until the difference is $0.00, then finish.
          </p>

          {!activeReconId ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-end">
              <div className="grid gap-1">
                <Label className="text-xs" htmlFor="recon-account">Account</Label>
                <select
                  id="recon-account"
                  data-testid="reconciliation-account-select"
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={selectedAccountId ?? ""}
                  onChange={(event) => setSelectedAccountId((event.target.value || null) as Id<"bankAccounts"> | null)}
                >
                  <option value="">Choose an account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ····{account.mask}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <Label className="text-xs" htmlFor="recon-date">Statement end date</Label>
                <Input id="recon-date" type="date" value={statementDate} max={todayIso()} onChange={(event) => setStatementDate(event.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs" htmlFor="recon-balance">Ending balance</Label>
                <Input id="recon-balance" inputMode="decimal" placeholder="0.00" value={statementBalance} onChange={(event) => setStatementBalance(event.target.value)} />
              </div>
              <Button
                size="sm"
                data-testid="reconciliation-start"
                disabled={pending || !selectedAccountId || !statementDate || statementBalance.trim() === ""}
                onClick={() => void (selectedAccount?.openReconciliationId ? setActiveReconId(selectedAccount.openReconciliationId) : onStart())}
              >
                {selectedAccount?.openReconciliationId ? "Resume" : "Start"}
              </Button>
            </div>
          ) : worksheet ? (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <span className="text-muted-foreground">
                  Statement <Amount className="font-medium text-foreground" amountMinor={worksheet.statementEndBalanceMinor} />
                </span>
                <span className="text-muted-foreground">
                  Cleared books <Amount className="font-medium text-foreground" amountMinor={worksheet.clearedBalanceMinor} />
                </span>
                <span
                  data-testid="reconciliation-difference"
                  className={worksheet.differenceMinor === 0 ? "font-medium text-ai" : "font-medium text-foreground"}
                >
                  Difference <Amount amountMinor={worksheet.differenceMinor} signed />
                </span>
              </div>

              <div className="mt-3 max-h-64 overflow-auto rounded-md border">
                <table className="w-full text-sm">
                  <tbody>
                    {[...worksheet.unclearedLines, ...worksheet.clearedLines]
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .map((line) => (
                        <tr key={line.transactionId} className="border-b last:border-0">
                          <td className="w-10 px-2 py-1.5">
                            <input
                              type="checkbox"
                              data-testid={`reconciliation-clear-${line.transactionId}`}
                              checked={line.cleared}
                              disabled={pending || line.clearedElsewhere || worksheet.reconciliation.status === "completed"}
                              onChange={(event) =>
                                void run(() =>
                                  toggleCleared({
                                    reconciliationId: worksheet.reconciliation.id,
                                    transactionId: line.transactionId,
                                    cleared: event.target.checked,
                                  }),
                                )
                              }
                            />
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{line.date}</td>
                          <td className="truncate px-2 py-1.5">{line.merchant}</td>
                          <td className="px-2 py-1.5 text-right">
                            <Amount amountMinor={line.amountMinor} signed />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {worksheet.reconciliation.status === "open" ? (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className="grid gap-1">
                    <Label className="text-xs" htmlFor="recon-fee">Bank fee adjustment</Label>
                    <Input id="recon-fee" inputMode="decimal" placeholder="0.00" className="w-32" value={feeAmount} onChange={(event) => setFeeAmount(event.target.value)} />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="reconciliation-add-fee"
                    disabled={pending || feeAmount.trim() === ""}
                    onClick={() =>
                      void run(async () => {
                        const minor = Math.round(Number(feeAmount) * 100);
                        if (!Number.isFinite(minor) || minor <= 0) {
                          setMessage("Enter a positive fee amount.");
                          return;
                        }
                        await addAdjusting({ reconciliationId: worksheet.reconciliation.id, kind: "fee", amountMinor: minor });
                        setFeeAmount("");
                      })
                    }
                  >
                    Add fee entry
                  </Button>
                  <div className="ml-auto flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setActiveReconId(null)}>Close</Button>
                    <Button
                      size="sm"
                      data-testid="reconciliation-complete"
                      disabled={pending || !worksheet.canComplete}
                      onClick={() =>
                        void run(async () => {
                          await complete({ reconciliationId: worksheet.reconciliation.id });
                          setMessage("Reconciliation completed.");
                        })
                      }
                    >
                      <Check className="size-4" />
                      {worksheet.canComplete ? "Finish" : "Difference must be $0.00"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2">
                  <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-ai-surface px-2.5 text-xs font-medium text-ai">
                    <Check className="size-3" /> Reconciled
                  </span>
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setActiveReconId(null)}>Done</Button>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Loading worksheet…</p>
          )}

          {message ? <p className="mt-2 text-xs text-muted-foreground" data-testid="reconciliation-message">{message}</p> : null}
        </div>
      </div>
    </section>
  );
}

// E1-T8: quiet "N transactions ($X) are unreviewed and excluded from these
// figures" banner. Neutral (never alarm-red), tabular money, links to the Inbox.
// Same source as the dashboard banner (reportPack.unreviewed / dashboard.unreviewed)
// so the numbers match. Renders nothing when the backlog is empty.
function UnreviewedGapBanner({
  unreviewed,
}: {
  unreviewed?: { unreviewedCount: number; unreviewedAbsMinor: number };
}) {
  const router = useRouter();
  if (!unreviewed || unreviewed.unreviewedCount <= 0) return null;
  const { unreviewedCount, unreviewedAbsMinor } = unreviewed;
  const noun = unreviewedCount === 1 ? "transaction" : "transactions";
  return (
    <section
      data-testid="unreviewed-gap-banner"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[14px] border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
    >
      <Info className="size-4 shrink-0" aria-hidden="true" />
      <span>
        <span className="font-medium text-foreground tabular-nums" data-testid="unreviewed-gap-count">
          {unreviewedCount} {noun}
        </span>{" "}
        (
        <span className="tabular-nums" data-testid="unreviewed-gap-amount">
          {formatMinorMoney(unreviewedAbsMinor, { currency: "USD" })}
        </span>
        ) are unreviewed and excluded from these figures.
      </span>
      <button
        type="button"
        className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        onClick={() => router.push("/inbox")}
        data-testid="unreviewed-gap-inbox-link"
      >
        Review in Inbox
      </button>
    </section>
  );
}

// E6-T9: when the report hit the row/entry cap (limits.truncated, produced by
// E1-T5's whole-entry pagination), say so plainly so totals are never silently
// understated. Quiet warning token (never alarm-red), with a hint to narrow the
// range. Renders nothing when the report fit under the cap.
function TruncationBanner({ limits }: { limits?: { reportLimit: number; truncated: boolean } }) {
  if (!limits?.truncated) return null;
  return (
    <section
      data-testid="truncation-banner"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[14px] border border-warning/30 bg-warning-surface px-4 py-3 text-sm text-foreground"
    >
      <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden="true" />
      <span>
        Showing the first{" "}
        <span className="tabular-nums font-medium" data-testid="truncation-limit">
          {limits.reportLimit.toLocaleString("en-US")}
        </span>{" "}
        rows — totals may be incomplete. Narrow the date range to see everything.
      </span>
    </section>
  );
}

// ---- Home grid -----------------------------------------------------------

function ReportsHome({ onOpen, banner }: { onOpen: (id: ReportExportId) => void; banner: React.ReactNode }) {
  return (
    <div className="space-y-6" data-testid="reports-home">
      {banner}
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

function ReportsBusinessFilter({
  entities,
  scope,
  onSelectScope,
}: {
  entities: EntityOption[];
  scope: Scope;
  onSelectScope: (scope: Scope) => void;
}) {
  if (entities.length === 0) return null;
  const value = scope === "all" ? "all" : scope.entityId;

  return (
    <section
      className="flex min-w-0 flex-col gap-3 rounded-[14px] border bg-card p-4 shadow-xs sm:flex-row sm:items-end sm:justify-between"
      data-testid="reports-business-filter"
    >
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Business</div>
        <div className="mt-1 truncate text-sm font-semibold">
          {scope === "all" ? "All businesses" : entities.find((entity) => entity.id === scope.entityId)?.name ?? "Selected business"}
        </div>
      </div>
      <div className="grid min-w-0 gap-1.5 sm:min-w-60">
        <Label className="text-xs">Report scope</Label>
        <Select
          value={value}
          onValueChange={(next) => onSelectScope(next === "all" ? "all" : { entityId: next })}
        >
          <SelectTrigger className="h-9 w-full" data-testid="reports-business-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All businesses</SelectItem>
            {entities.map((entity) => (
              <SelectItem key={String(entity.id)} value={String(entity.id)}>
                {entity.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
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

  // E6-T2: the toolbar must never overflow horizontally on a phone. Controls
  // STACK full-width on mobile (each select goes w-full, switching to a fixed
  // width only at sm:), and the action buttons (Explain / Export) drop to their
  // OWN row below the controls. min-w-0 lets the card shrink instead of forcing
  // page overflow.
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-[14px] border bg-card p-4 shadow-xs" data-testid="viewer-toolbar">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="grid min-w-0 gap-1.5">
          <Label className="text-xs">Range</Label>
          <Select value={preset} onValueChange={(value) => onPreset(value as ReportPresetId)}>
            <SelectTrigger className="h-9 w-full sm:w-40" data-testid="range-preset">
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
            <div className="grid min-w-0 gap-1.5">
              <Label className="text-xs">Start</Label>
              <Input
                type="date"
                max={today}
                value={range.startDate}
                onChange={(event) => onRange(clampRange({ ...range, startDate: event.target.value }, today))}
                className="h-9 w-full sm:w-40"
              />
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label className="text-xs">{asOf ? "As of" : "End"}</Label>
              <Input
                type="date"
                max={today}
                value={range.endDate}
                onChange={(event) => onRange(clampRange({ ...range, endDate: event.target.value }, today))}
                className="h-9 w-full sm:w-40"
              />
            </div>
          </>
        ) : (
          <div className="grid min-w-0 gap-1.5">
            <Label className="text-xs">{asOf ? "As of" : "Period"}</Label>
            <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm" data-testid="period-label">
              {asOf ? formatAsOfLabel(range.endDate) : formatRangeLabel(range)}
            </div>
          </div>
        )}

        {showCompare ? (
          <div className="grid min-w-0 gap-1.5">
            <Label className="text-xs">Compare</Label>
            <Select value={compare} onValueChange={(value) => onCompare(value as CompareMode)}>
              <SelectTrigger className="h-9 w-full sm:w-36">
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
          <div className="grid min-w-0 gap-1.5">
            <Label className="text-xs">Columns</Label>
            <Select value={columnMode} onValueChange={(value) => onColumnMode(value as ColumnMode)}>
              <SelectTrigger className="h-9 w-full sm:w-32">
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

        {showBasis ? (
          <div className="grid gap-1.5 sm:ml-auto">
            <Label className="text-xs">Basis</Label>
            <div className="flex items-center gap-1 self-start rounded-[10px] bg-muted p-0.5" data-testid="basis-toggle">
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
          </div>
        ) : null}
      </div>

      {/* Action buttons live on their own row so they never crowd the controls
          on a phone. They stretch full-width on mobile, shrink to auto at sm. */}
      <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:justify-end sm:border-t-0 sm:pt-0">
        <Button variant="outline" size="sm" onClick={onExplain} data-testid="explain-report" className="w-full sm:w-auto">
          <Sparkles className="size-4" />
          Explain
        </Button>
        <Button variant="outline" size="sm" onClick={onExport} disabled={exportDisabled} data-testid="export-csv" className="w-full sm:w-auto">
          <Download className="size-4" />
          Export CSV
        </Button>
      </div>
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
  onOpenInTransactions,
}: {
  title: string;
  subtitle: string;
  rows: DrillLine[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenInTransactions?: () => void;
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
        {onOpenInTransactions ? (
          <SheetFooter className="border-t px-5 py-3">
            <Button variant="outline" size="sm" onClick={onOpenInTransactions} data-testid="drill-open-transactions">
              Open in Transactions
              <ArrowRight className="size-4" />
            </Button>
          </SheetFooter>
        ) : null}
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

type StatementDrill = (title: string, lines: DrillLine[], context: DrillContext) => void;

function StatementTable({
  rows,
  onDrill,
  isMobile,
}: {
  rows: StatementRow[];
  onDrill: StatementDrill;
  isMobile?: boolean;
}) {
  const columns = rows[0]?.columns ?? [];
  if (rows.length === 0) {
    return <EmptyState title="No posted lines in this range" description="Try a wider date range or a different report." />;
  }

  function lines(row: StatementRow, columnKey?: string) {
    const all = row.drillDown ?? [];
    if (!columnKey) return all;
    const window = columnKeyToWindow(columnKey);
    if (!window) return all.filter((line) => line.date.startsWith(columnKeyToPrefix(columnKey)));
    return all.filter((line) => line.date >= window.start && line.date <= window.end);
  }

  function contextFor(row: StatementRow, columnKey?: string): DrillContext {
    const window = columnKey ? columnKeyToWindow(columnKey) : null;
    return {
      lens: lensForAccountType(row.accountType),
      accountNumber: row.accountNumber,
      startDate: window?.start,
      endDate: window?.end,
    };
  }

  // E6-T6: when compare != none, the backend stamps priorTotalMinor/deltaMinor on
  // each row. We render a Prior column + a signed Change (delta) column so the
  // owner sees the trend side-by-side, not just a passive "comparing against …"
  // line. Detected from the rows so default packs render exactly as before.
  const hasPrior = rows.some((row) => row.priorTotalMinor !== undefined);

  // Narrow effective width (desktop split view, or a real phone): a dense
  // multi-month grid can't inner-scroll gracefully, so collapse to a stacked
  // label/value card list. Every value stays a drillable MoneyButton.
  if (isMobile) {
    return (
      <div className="divide-y">
        {rows.map((row) => (
          <div key={row.id} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{row.label}</div>
                <div className="money-figures text-xs text-muted-foreground">{row.accountNumber}</div>
              </div>
              <MoneyButton
                amountMinor={row.totalMinor}
                onDrill={() => onDrill(row.label, lines(row), contextFor(row))}
                className="font-medium"
              />
            </div>
            {hasPrior ? (
              <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span data-testid="statement-prior">
                  Prior <Amount amountMinor={row.priorTotalMinor ?? 0} className="text-foreground" />
                </span>
                <DeltaAmount deltaMinor={row.deltaMinor ?? 0} />
              </div>
            ) : null}
            {columns.length > 1 ? (
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                {(row.columns ?? []).map((column) => (
                  <div key={column.key} className="flex items-center justify-between gap-2">
                    <dt className="text-xs text-muted-foreground">{column.label}</dt>
                    <dd>
                      <MoneyButton
                        amountMinor={column.amountMinor}
                        onDrill={() =>
                          onDrill(`${row.label} · ${column.label}`, lines(row, column.key), contextFor(row, column.key))
                        }
                        className="text-sm"
                      />
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="min-w-0 overflow-x-auto">
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
            {hasPrior ? (
              <>
                <TableHead className="text-right" data-testid="statement-prior-head">Prior</TableHead>
                <TableHead className="text-right" data-testid="statement-delta-head">Change</TableHead>
              </>
            ) : null}
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
                          onDrill(`${row.label} · ${column.label}`, lines(row, column.key), contextFor(row, column.key))
                        }
                      />
                    </TableCell>
                  ))
                : null}
              <TableCell className="text-right font-medium">
                <MoneyButton amountMinor={row.totalMinor} onDrill={() => onDrill(row.label, lines(row), contextFor(row))} />
              </TableCell>
              {hasPrior ? (
                <>
                  <TableCell className="text-right text-muted-foreground" data-testid="statement-prior">
                    <Amount amountMinor={row.priorTotalMinor ?? 0} />
                  </TableCell>
                  <TableCell className="text-right" data-testid="statement-delta">
                    <DeltaAmount deltaMinor={row.deltaMinor ?? 0} />
                  </TableCell>
                </>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// E6-T6: a signed period-over-period delta. Quiet, never alarm-red — an INCREASE
// reads in the brand-green income tone and a decrease in muted neutral (an
// expense going down is good; an income going down is just a number). The arrow
// communicates direction without color drama.
function DeltaAmount({ deltaMinor }: { deltaMinor: number }) {
  if (deltaMinor === 0) {
    return <span className="text-muted-foreground" data-testid="delta-value">—</span>;
  }
  const up = deltaMinor > 0;
  return (
    <span
      data-testid="delta-value"
      className={`money-figures inline-flex items-center gap-0.5 ${up ? "text-primary" : "text-muted-foreground"}`}
    >
      {up ? <ArrowUpRight className="size-3.5" aria-hidden="true" /> : <ArrowDownRight className="size-3.5" aria-hidden="true" />}
      {formatMinor(Math.abs(deltaMinor))}
    </span>
  );
}

// "2026-05" -> "2026-05"; "2026 Q2" -> "2026" (quarter prefix match is coarse).
function columnKeyToPrefix(key: string) {
  if (/^\d{4}-\d{2}$/.test(key)) return key;
  return key.slice(0, 4);
}

// Resolve a column key ("2026-05" monthly or "2026 Q2" quarterly) to its exact
// date window so a quarterly drill shows only that quarter — not the whole year,
// which the old startsWith(year) prefix match leaked.
function columnKeyToWindow(key: string): { start: string; end: string } | null {
  const monthly = /^(\d{4})-(\d{2})$/.exec(key);
  if (monthly) {
    const year = Number(monthly[1]);
    const month = Number(monthly[2]);
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { start: `${monthly[1]}-${monthly[2]}-01`, end: `${monthly[1]}-${monthly[2]}-${String(last).padStart(2, "0")}` };
  }
  const quarterly = /^(\d{4})\sQ([1-4])$/.exec(key);
  if (quarterly) {
    const year = Number(quarterly[1]);
    const quarter = Number(quarterly[2]);
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const last = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
    return {
      start: `${year}-${String(startMonth).padStart(2, "0")}-01`,
      end: `${year}-${String(endMonth).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
    };
  }
  return null;
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

function ProfitAndLoss({ pack, onDrill, isMobile }: { pack: ReportPack; onDrill: StatementDrill; isMobile: boolean }) {
  return (
    <div className="space-y-4">
      <ReportHeader
        title="Profit & Loss"
        subtitle={`${formatRangeLabel(pack.controls as DateRange)} · click any number to see its transactions`}
        chip={<BasisBadge pack={pack} />}
      />
      <section className="rounded-[14px] border bg-card shadow-xs">
        <div className="border-b px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Income</div>
        <StatementTable rows={pack.profitAndLoss.sections?.[0]?.rows ?? pack.profitAndLoss.rows.filter((row) => row.accountType === "income")} onDrill={onDrill} isMobile={isMobile} />
        <div className="border-y px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Expenses</div>
        <StatementTable rows={pack.profitAndLoss.sections?.[1]?.rows ?? pack.profitAndLoss.rows.filter((row) => row.accountType === "expense")} onDrill={onDrill} isMobile={isMobile} />
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

function BalancedChip({ balanced, label }: { balanced: boolean; label?: string }) {
  return (
    <span
      data-testid="balanced-chip"
      className={`inline-flex h-6 items-center gap-1.5 rounded-full px-3 text-xs font-medium ${balanced ? "bg-primary/10 text-primary" : "bg-warning-surface text-warning"}`}
    >
      {balanced ? <Check className="size-3" /> : null}
      {label ?? (balanced ? "Balanced" : "Needs review")}
    </span>
  );
}

// E6-T5: persistent, title-cased basis badge so the owner is never confused
// about which basis produced the numbers. On cash basis it states plainly that
// open invoices & bills are dropped, and (when any exist) the exact count/$ the
// cash view is excluding — sourced from the additive `cashBasisExcluded` field.
function BasisBadge({ pack }: { pack: ReportPack }) {
  const isCash = pack.controls.basis === "cash";
  const excluded = pack.cashBasisExcluded;
  const showExclusion = isCash && excluded && excluded.count > 0;
  const noun = excluded && excluded.count === 1 ? "open item" : "open items";
  return (
    <span
      data-testid="basis-badge"
      className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-3 text-xs font-medium text-muted-foreground"
    >
      <Scale className="size-3" aria-hidden="true" />
      {isCash ? "Cash basis — open invoices & bills excluded" : "Accrual basis"}
      {showExclusion ? (
        <span data-testid="basis-excluded-note" className="text-foreground">
          ·{" "}
          <span className="tabular-nums" data-testid="basis-excluded-count">
            {excluded!.count} {noun}
          </span>{" "}
          (
          <span className="tabular-nums" data-testid="basis-excluded-amount">
            {formatMinorMoney(excluded!.amountMinor, { currency: "USD" })}
          </span>
          )
        </span>
      ) : null}
    </span>
  );
}

function BalanceSheet({ pack, onDrill, isMobile }: { pack: ReportPack; onDrill: StatementDrill; isMobile: boolean }) {
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
          <div className="flex flex-wrap items-center gap-2">
            <BasisBadge pack={pack} />
            <BalancedChip balanced={pack.balanceSheet.balanced} />
          </div>
        }
      />
      <section className="rounded-[14px] border bg-card shadow-xs">
        {sections.map((section) => (
          <div key={section.key}>
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.label}</span>
              <Amount amountMinor={section.totalMinor} className="text-sm font-semibold" />
            </div>
            <StatementTable rows={section.rows} onDrill={onDrill} isMobile={isMobile} />
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

function CashFlow({ pack, onDrill, isMobile = false }: { pack: ReportPack; onDrill: StatementDrill; isMobile?: boolean }) {
  const bridge = [
    { label: "Opening", value: pack.cashFlow.openingCashMinor, accent: "slate" as const },
    ...pack.cashFlow.groups.map((group) => ({ label: group.label, value: group.totalMinor, accent: group.totalMinor >= 0 ? ("green" as const) : ("negative" as const) })),
    { label: "Closing", value: pack.cashFlow.closingCashMinor, accent: "slate" as const },
  ];
  const maxBar = Math.max(...bridge.map((step) => Math.abs(step.value)), 1);
  // Below xl the bridge chart sits in its own row; with many steps it would
  // crowd, so it inner-scrolls within its OWN container (min-w-0 + overflow-x-auto)
  // instead of widening the page. On a real phone the legible-chart threshold is
  // lost, so we collapse it to a compact numeric Opening/Net/Closing summary.
  return (
    <div className="min-w-0 space-y-4">
      <ReportHeader
        title="Cash Flow Statement"
        subtitle={`${formatRangeLabel(pack.controls as DateRange)} · where cash actually came from and went`}
        chip={<BasisBadge pack={pack} />}
      />
      <div className="grid min-w-0 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <section className="min-w-0 rounded-[14px] border bg-card shadow-xs">
          {pack.cashFlow.groups.map((group) => (
            <div key={group.key} className="min-w-0">
              <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</span>
                <Amount amountMinor={group.totalMinor} signed className="text-sm font-semibold" />
              </div>
              <div className="divide-y">
                {group.rows.length === 0 ? (
                  <div className="px-4 py-2.5 text-sm text-muted-foreground">No cash movements.</div>
                ) : isMobile ? (
                  group.rows.map((row) => (
                    <div key={row.id} className="flex flex-col gap-0.5 px-4 py-2.5 text-sm">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="money-figures text-xs text-muted-foreground">{row.date}</span>
                        <MoneyButton
                          amountMinor={row.amountMinor}
                          signed
                          onDrill={() => onDrill(`${group.label} · ${row.memo}`, [row], { lens: "transactions" })}
                          className="font-medium"
                        />
                      </div>
                      <span className="break-words text-muted-foreground">{row.memo}</span>
                    </div>
                  ))
                ) : (
                  group.rows.map((row) => (
                    <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                      <span className="min-w-0 truncate text-muted-foreground">{row.date.slice(5)} · {row.memo}</span>
                      <MoneyButton
                        amountMinor={row.amountMinor}
                        signed
                        onDrill={() => onDrill(`${group.label} · ${row.memo}`, [row], { lens: "transactions" })}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 bg-primary/5 px-4 py-3 text-sm font-semibold">
            <span>Net change in cash</span>
            <Amount amountMinor={pack.cashFlow.netCashChangeMinor} signed />
          </div>
        </section>
        <section className="min-w-0 rounded-[14px] border bg-card p-5 shadow-xs">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            Opening
            <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
            closing cash
          </div>
          {isMobile ? (
            <dl className="mt-4 divide-y text-sm">
              {bridge.map((step, index) => (
                <div key={index} className="flex items-baseline justify-between gap-3 py-2">
                  <dt className="text-muted-foreground">{step.label}</dt>
                  <dd>
                    <Amount amountMinor={step.value} signed={index !== 0 && index !== bridge.length - 1} className="font-medium" />
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="mt-4 min-w-0 overflow-x-auto">
              <div className="flex h-36 max-h-[40vh] min-w-fit items-end gap-3">
                {bridge.map((step, index) => (
                  <div key={index} className="flex min-w-14 flex-1 flex-col items-center justify-end gap-1.5">
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
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// Days a document is past due, measured against the report's as-of date — mirrors
// the server's bucket math (reportViews.buildAgingRows) so a bucket cell drills to
// exactly the documents that bucket counted.
function agingDaysPastDue(dueDate: string, asOf: string) {
  const end = new Date(`${asOf}T00:00:00.000Z`).getTime();
  const due = new Date(`${dueDate}T00:00:00.000Z`).getTime();
  return Math.max(0, Math.floor((end - due) / 86_400_000));
}

type AgingBucket = "current" | "days30" | "days60" | "days90";
function agingBucketFor(daysPastDue: number): AgingBucket {
  if (daysPastDue === 0) return "current";
  if (daysPastDue <= 30) return "days30";
  if (daysPastDue <= 60) return "days60";
  return "days90";
}

function AgingReport({ pack, which, onDrill }: { pack: ReportPack; which: "ar" | "ap"; onDrill: StatementDrill }) {
  const report = which === "ar" ? pack.arAging : pack.apAging;
  const title = which === "ar" ? "AR Aging" : "AP Aging";
  const lens: DrillContext["lens"] = which === "ar" ? "income" : "expenses";
  const who = which === "ar" ? "Customer" : "Vendor";
  const maxCell = Math.max(
    1,
    ...report.rows.flatMap((row) => [row.currentMinor, row.days30Minor, row.days60Minor, row.days90Minor]),
  );
  // Heat is the warning token tinted by how large the cell is relative to the
  // matrix max — token-driven (color-mix on --warning), never a raw amber
  // literal. Returns an inline style so each cell gets its own intensity.
  function heat(value: number): React.CSSProperties | undefined {
    if (value === 0) return undefined;
    const intensity = Math.min(28, Math.round((value / maxCell) * 30));
    return { backgroundColor: `color-mix(in oklch, var(--warning) ${intensity}%, transparent)` };
  }
  return (
    <div className="space-y-4">
      <ReportHeader
        title={title}
        subtitle={`As of ${formatAsOfLabel(pack.controls.endDate)}`}
        chip={
          <div className="flex flex-wrap items-center gap-2">
            <BasisBadge pack={pack} />
            <Amount amountMinor={report.totalMinor} className="text-sm font-semibold" />
          </div>
        }
      />
      <section className="min-w-0 rounded-[14px] border bg-card shadow-xs">
        <div className="p-4">
          <AgingMiniBar
            current={report.buckets.currentMinor}
            days30={report.buckets.days30Minor}
            days60={report.buckets.days60Minor}
            days90={report.buckets.days90Minor}
          />
        </div>
        <div className="min-w-0 overflow-x-auto">
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
              {report.rows.map((row) => {
                const drill = row.drillDown ?? [];
                const buckets: AgingBucket[] = ["current", "days30", "days60", "days90"];
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    {[row.currentMinor, row.days30Minor, row.days60Minor, row.days90Minor].map((value, index) => {
                      const bucket = buckets[index];
                      const bucketLines = drill.filter(
                        (line) => agingBucketFor(agingDaysPastDue(line.date, pack.controls.endDate)) === bucket,
                      );
                      return (
                        <TableCell key={index} className="text-right" style={heat(value)}>
                          {value ? (
                            <MoneyButton
                              amountMinor={value}
                              onDrill={() => onDrill(`${row.name} · ${title}`, bucketLines, { lens })}
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right font-medium">
                      <MoneyButton
                        amountMinor={row.totalMinor}
                        onDrill={() => onDrill(`${row.name} · ${title}`, drill, { lens })}
                        className="font-medium"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function VendorList({
  title,
  rows,
  onDrill,
}: {
  title: string;
  rows: Array<{ id: string; name: string; totalMinor: number; drillDown?: DrillLine[] }>;
  onDrill: StatementDrill;
}) {
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
              <MoneyButton
                amountMinor={row.totalMinor}
                onDrill={() => onDrill(row.name, row.drillDown ?? [], { lens: "expenses" })}
              />
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ExpensesReport({ pack, onDrill, isMobile }: { pack: ReportPack; onDrill: StatementDrill; isMobile: boolean }) {
  return (
    <div className="space-y-4">
      <ReportHeader
        title="Expenses"
        subtitle={`${formatRangeLabel(pack.controls as DateRange)} · spending by category and vendor`}
        chip={<BasisBadge pack={pack} />}
      />
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <section className="min-w-0 rounded-[14px] border bg-card shadow-xs">
          <div className="border-b px-4 py-3 text-sm font-semibold">By category</div>
          <StatementTable rows={pack.expenses.byCategory} onDrill={onDrill} isMobile={isMobile} />
        </section>
        <VendorList title="Top vendors" rows={pack.expenses.byVendor} onDrill={onDrill} />
      </div>
    </div>
  );
}

function IncomeByCustomer({ pack, onDrill }: { pack: ReportPack; onDrill: StatementDrill }) {
  const max = Math.max(1, ...pack.incomeByCustomer.rows.map((row) => row.totalMinor));
  const total = pack.incomeByCustomer.totalMinor || 1;
  return (
    <div className="space-y-4">
      <ReportHeader
        title="Income by Customer"
        subtitle={`${formatRangeLabel(pack.controls as DateRange)} · who your revenue really comes from`}
        chip={<BasisBadge pack={pack} />}
      />
      <section className="min-w-0 rounded-[14px] border bg-card shadow-xs">
        <div className="min-w-0 overflow-x-auto">
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
                  <TableCell className="text-right">
                    <MoneyButton
                      amountMinor={row.totalMinor}
                      onDrill={() => onDrill(row.name, row.drillDown ?? [], { lens: "income" })}
                    />
                  </TableCell>
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

const RUN_STATUS_TONE: Record<string, string> = {
  draft: "text-muted-foreground",
  approved: "text-info",
  paid: "text-primary",
};

function PayrollSummary({ pack, onDrill }: { pack: ReportPack; onDrill: StatementDrill }) {
  const summary = pack.payrollSummary;
  const baseCurrency = summary.baseCurrency || pack.entity.currency || "USD";
  const foreignCurrencies = summary.byCurrency.filter((row) => row.currency !== baseCurrency);
  return (
    <div className="space-y-4">
      <ReportHeader
        title="Payroll Summary"
        subtitle={`${formatRangeLabel(pack.controls as DateRange)} · payroll by month, person, and currency`}
        chip={
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-3 text-xs font-medium text-muted-foreground">
            {summary.headcount} {summary.headcount === 1 ? "person" : "people"}
          </span>
        }
      />

      {summary.byCurrency.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {summary.byCurrency.map((row) => (
            <div key={row.currency} className="rounded-[14px] border bg-card p-4 shadow-xs">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {row.currency}
                {row.currency === baseCurrency ? " · base" : ""}
              </div>
              <div className="money-figures mt-1 text-lg font-semibold">
                <Amount amountMinor={row.localMinor} currency={row.currency} />
              </div>
              {row.currency !== baseCurrency ? (
                <div className="money-figures mt-0.5 text-xs text-muted-foreground">
                  ≈ <Amount amountMinor={row.baseMinor} currency={baseCurrency} /> {baseCurrency}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {summary.hasFx && foreignCurrencies.length > 0 ? (
        <div className="flex items-start gap-2 rounded-[14px] border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Foreign-currency pay is converted to {baseCurrency} at each run&apos;s recorded FX rate, so the base total reflects
            the rate on the day each run posted — not today&apos;s rate.
          </span>
        </div>
      ) : null}

      <section className="min-w-0 rounded-[14px] border bg-card shadow-xs">
        <div className="border-b px-4 py-3 text-sm font-semibold">By month</div>
        <div className="min-w-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Base total ({baseCurrency})</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pack.payrollSummary.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                    No payroll runs in this period.
                  </TableCell>
                </TableRow>
              ) : (
                pack.payrollSummary.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="money-figures font-medium">{row.period}</TableCell>
                    <TableCell className={`capitalize ${RUN_STATUS_TONE[row.status] ?? "text-muted-foreground"}`}>{row.status}</TableCell>
                    <TableCell className="text-right">
                      <MoneyButton
                        amountMinor={row.totalBaseMinor}
                        onDrill={() => onDrill(`Payroll · ${row.period}`, row.drillDown ?? [], { lens: "transactions" })}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
              <TableRow>
                <TableCell className="font-semibold">Total</TableCell>
                <TableCell />
                <TableCell className="text-right font-semibold"><Amount amountMinor={pack.payrollSummary.totalMinor} currency={baseCurrency} /></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

// E6-T4 documented drill exceptions: the accountant registers below render the
// RAW journal lines themselves, so a figure here already IS its own source line —
// drilling would re-show the identical row. These figures are intentionally
// STATIC (not MoneyButtons):
//   - GeneralLedger debit/credit per line — each line is its own journal line.
//   - TrialBalance debit/credit balances + totals — net of an account's GL lines,
//     surfaced in full in the GL report.
//   - JournalEntries per-line debit/credit + totals — the entry-centric raw record.
// Column HEADERS, the AgingMiniBar, and the cash-flow bridge bar labels are also
// static (labels/chrome, not money figures). Every OTHER money figure across the
// 12 reports (P&L, balance sheet, expenses, cash-flow lines, aging cells,
// income-by-customer, payroll period totals) is a drillable MoneyButton.
function GeneralLedger({ pack, isMobile }: { pack: ReportPack; isMobile: boolean }) {
  return (
    <div className="space-y-4">
      <ReportHeader title="General Ledger" subtitle={`${formatRangeLabel(pack.controls as DateRange)} · every posting, account by account`} />
      <section className="min-w-0 rounded-[14px] border bg-card shadow-xs">
        {pack.generalLedger.rows.length === 0 ? (
          <EmptyState title="No postings in this range" description="Try a wider date range." />
        ) : isMobile ? (
          <div className="divide-y">
            {pack.generalLedger.rows.map((row) => (
              <div key={row.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="money-figures text-xs text-muted-foreground">{row.date}</span>
                  <div className="money-figures flex items-center gap-3 text-sm">
                    {row.debitMinor ? <span>Dr <Amount amountMinor={row.debitMinor} /></span> : null}
                    {row.creditMinor ? <span>Cr <Amount amountMinor={row.creditMinor} /></span> : null}
                  </div>
                </div>
                <div className="mt-1 truncate text-sm">{row.memo}</div>
                <div className="truncate text-xs text-muted-foreground">{row.accountNumber} · {row.accountName}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="min-w-0 overflow-x-auto">
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
        )}
      </section>
    </div>
  );
}

function TrialBalance({ pack, isMobile }: { pack: ReportPack; isMobile: boolean }) {
  const balanced = pack.trialBalance.differenceMinor === 0;
  return (
    <div className="space-y-4">
      <ReportHeader
        title="Trial Balance"
        subtitle={`As of ${formatAsOfLabel(pack.controls.endDate)} · every account's debit and credit balance`}
        chip={
          <BalancedChip
            balanced={balanced}
            label={balanced ? "Balanced" : `Off by ${formatMinor(pack.trialBalance.differenceMinor)}`}
          />
        }
      />
      <section className="min-w-0 rounded-[14px] border bg-card shadow-xs">
        {isMobile ? (
          <div className="divide-y">
            {pack.trialBalance.rows.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{row.label}</div>
                  <div className="money-figures text-xs text-muted-foreground">{row.accountNumber}</div>
                </div>
                <div className="money-figures shrink-0 text-sm">
                  {row.debitMinor ? <span>Dr <Amount amountMinor={row.debitMinor} /></span> : null}
                  {row.creditMinor ? <span>Cr <Amount amountMinor={row.creditMinor} /></span> : null}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 px-4 py-3 font-semibold">
              <span>Total</span>
              <span className="money-figures flex gap-3">
                <span>Dr <Amount amountMinor={pack.trialBalance.totalDebitMinor} /></span>
                <span>Cr <Amount amountMinor={pack.trialBalance.totalCreditMinor} /></span>
              </span>
            </div>
          </div>
        ) : (
          <div className="min-w-0 overflow-x-auto">
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
        )}
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
                  <span className="min-w-0 truncate text-muted-foreground">{line.accountNumber} · {line.accountName}</span>
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
          <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="money-figures text-lg font-semibold text-primary" data-testid="mr-net">
            <Amount amountMinor={mr.netResultMinor} signed />
          </span>
        </div>
        <div className="grid md:grid-cols-2">
          <MrSection title="Money in" amountMinor={mr.moneyInMinor} link="Income by Customer" onLink={() => onOpenReport("income-by-customer")} border>
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
          <MrSection title="Money out" amountMinor={mr.moneyOutMinor} link="Full Profit & Loss" onLink={() => onOpenReport("profit-and-loss")}>
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
          <MrSection title="Owed to you" amountMinor={mr.owedToYouMinor} link="AR Aging" onLink={() => onOpenReport("ar-aging")} border topBorder>
            <AgingMiniBar
              current={pack.arAging.buckets.currentMinor}
              days30={pack.arAging.buckets.days30Minor}
              days60={pack.arAging.buckets.days60Minor}
              days90={pack.arAging.buckets.days90Minor}
            />
            <p className="text-sm text-muted-foreground">{pack.arAging.rows.length} open invoices.</p>
          </MrSection>
          <MrSection title="You owe" amountMinor={mr.youOweMinor} link="AP Aging" onLink={() => onOpenReport("ap-aging")} topBorder>
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
      <button type="button" onClick={onLink} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        {link}
        <ArrowRight className="size-3" />
      </button>
    </div>
  );
}

// ---- Per-report loading skeletons (E6-T8) --------------------------------
// Each skeleton mirrors the shape of its report so the page never jumps when the
// pack lands: statement tables get a header + row skeleton, aging/payroll get a
// card skeleton, cash-flow gets the two-panel list+bridge skeleton.

function SkeletonHeader() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-72 max-w-full" />
    </div>
  );
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <section className="rounded-[14px] border bg-card p-4 shadow-xs">
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center justify-between gap-4">
            <Skeleton className="h-4 w-40 max-w-[55%]" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </section>
  );
}

function CardGridSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: cards }).map((_, index) => (
        <div key={index} className="rounded-[14px] border bg-card p-4 shadow-xs">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-2 h-6 w-28" />
        </div>
      ))}
    </div>
  );
}

function ReportSkeleton({ reportId }: { reportId: ReportExportId }) {
  if (reportId === "cash-flow") {
    return (
      <div className="space-y-4" data-testid="report-skeleton">
        <SkeletonHeader />
        <div className="grid min-w-0 gap-4 xl:grid-cols-[1.4fr_1fr]">
          <TableSkeleton rows={6} />
          <section className="rounded-[14px] border bg-card p-5 shadow-xs">
            <Skeleton className="h-4 w-32" />
            <div className="mt-4 flex h-36 items-end gap-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="w-full" style={{ height: `${40 + index * 15}%` }} />
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  }
  if (reportId === "ar-aging" || reportId === "ap-aging" || reportId === "payroll-summary") {
    return (
      <div className="space-y-4" data-testid="report-skeleton">
        <SkeletonHeader />
        <CardGridSkeleton />
        <TableSkeleton rows={4} />
      </div>
    );
  }
  // Statement-style default (P&L, balance sheet, expenses, income, GL, TB,
  // journal, monthly review): a header + one or two table skeletons.
  return (
    <div className="space-y-4" data-testid="report-skeleton">
      <SkeletonHeader />
      <TableSkeleton rows={6} />
    </div>
  );
}

// ---- Report-specific empty states (E6-T8) --------------------------------
// Each report says something honest and report-shaped when its primary data is
// empty, instead of a generic fallback. The predicate decides emptiness from the
// report's OWN primary array so we never show a misleading "all clear".

const REPORT_EMPTY_COPY: Record<ReportExportId, { icon: typeof Inbox; title: string; description: string }> = {
  "monthly-review": { icon: CalendarDays, title: "Nothing happened this month yet", description: "No money in or out has been recorded for this period." },
  "profit-and-loss": { icon: FileText, title: "No income or expenses in this range", description: "Try a wider date range, or post some transactions first." },
  "balance-sheet": { icon: Scale, title: "No balances to show yet", description: "Once you post entries, your assets, liabilities and equity appear here." },
  "cash-flow": { icon: ArrowDownToLine, title: "No cash moved in this period", description: "Pick a wider range or wait for transactions to post." },
  "ar-aging": { icon: Landmark, title: "Nothing outstanding", description: "No customers owe you right now — every invoice is settled." },
  "ap-aging": { icon: Landmark, title: "Nothing outstanding", description: "You don't owe any vendors right now — every bill is settled." },
  expenses: { icon: Columns3, title: "No expenses in this range", description: "Try a wider date range, or categorize some spending first." },
  "income-by-customer": { icon: Columns3, title: "No income in this range", description: "Once revenue posts, you'll see who it came from here." },
  "payroll-summary": { icon: Columns3, title: "No payroll runs in this period", description: "Run payroll, or widen the date range to include past runs." },
  "general-ledger": { icon: ListTree, title: "No postings in this range", description: "Try a wider date range to see your journal lines." },
  "trial-balance": { icon: Table2, title: "No account balances yet", description: "Post some entries and your trial balance will fill in." },
  journal: { icon: FileText, title: "No journal entries in this range", description: "The raw double-entry record will appear once entries post." },
};

// A report is "empty" when its primary data array has nothing in it. We keep
// reports that always render a summary (cash-flow shows opening/closing even with
// no line items) out of the whole-screen empty path — their inner sections show
// their own empties.
function reportIsEmpty(pack: ReportPack, reportId: ReportExportId): boolean {
  switch (reportId) {
    case "profit-and-loss":
      return pack.profitAndLoss.rows.length === 0;
    case "balance-sheet":
      return pack.balanceSheet.rows.length === 0;
    case "ar-aging":
      return pack.arAging.rows.length === 0;
    case "ap-aging":
      return pack.apAging.rows.length === 0;
    case "expenses":
      return pack.expenses.byCategory.length === 0 && pack.expenses.byVendor.length === 0;
    case "income-by-customer":
      return pack.incomeByCustomer.rows.length === 0;
    case "payroll-summary":
      return pack.payrollSummary.rows.length === 0;
    case "general-ledger":
      return pack.generalLedger.rows.length === 0;
    case "trial-balance":
      return pack.trialBalance.rows.length === 0;
    case "journal":
      return pack.journal.entries.length === 0;
    default:
      // monthly-review and cash-flow always render a summary band, never blank.
      return false;
  }
}

// ---- Error boundary (E6-T8) ----------------------------------------------
// A thrown report query (e.g. start>end on the server, or an auth rejection)
// must render a friendly inline card with a Reset action — never a blank screen
// or an unhandled render throw. Convex query rejections surface as React render
// errors, which this boundary catches.

class ReportErrorBoundary extends Component<
  { onReset: () => void; children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { onReset: () => void; children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset();
  };

  render() {
    if (this.state.error) {
      return (
        <section
          data-testid="report-error"
          className="rounded-[14px] border bg-card p-6 text-sm shadow-xs"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-warning-surface text-warning" aria-hidden="true">
              <AlertTriangle className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold">We couldn&apos;t build this report</h3>
              <p className="mt-1 text-muted-foreground">
                {this.state.error.message || "Something went wrong loading this report."}
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={this.reset} data-testid="report-error-reset">
                Reset range
              </Button>
            </div>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}

// ---- Active report dispatcher --------------------------------------------

function ActiveReport({
  reportId,
  pack,
  onDrill,
  monthRange,
  onShiftMonth,
  onOpenReport,
  isMobile,
}: {
  reportId: ReportExportId;
  pack: ReportPack;
  onDrill: StatementDrill;
  monthRange: DateRange;
  onShiftMonth: (delta: number) => void;
  onOpenReport: (id: ReportExportId) => void;
  isMobile: boolean;
}) {
  // E6-T8: report-specific empty state when the report's own primary data is
  // empty, with copy tailored to that report (never a generic blank).
  if (reportIsEmpty(pack, reportId)) {
    const copy = REPORT_EMPTY_COPY[reportId];
    return (
      <div className="space-y-4" data-testid="report-empty">
        <EmptyState icon={copy.icon} title={copy.title} description={copy.description} />
      </div>
    );
  }
  switch (reportId) {
    case "monthly-review":
      return <MonthlyReview pack={pack} monthRange={monthRange} onShiftMonth={onShiftMonth} onOpenReport={onOpenReport} />;
    case "profit-and-loss":
      return <ProfitAndLoss pack={pack} onDrill={onDrill} isMobile={isMobile} />;
    case "balance-sheet":
      return <BalanceSheet pack={pack} onDrill={onDrill} isMobile={isMobile} />;
    case "cash-flow":
      return <CashFlow pack={pack} onDrill={onDrill} isMobile={isMobile} />;
    case "ar-aging":
      return <AgingReport pack={pack} which="ar" onDrill={onDrill} />;
    case "ap-aging":
      return <AgingReport pack={pack} which="ap" onDrill={onDrill} />;
    case "expenses":
      return <ExpensesReport pack={pack} onDrill={onDrill} isMobile={isMobile} />;
    case "income-by-customer":
      return <IncomeByCustomer pack={pack} onDrill={onDrill} />;
    case "payroll-summary":
      return <PayrollSummary pack={pack} onDrill={onDrill} />;
    case "general-ledger":
      return <GeneralLedger pack={pack} isMobile={isMobile} />;
    case "trial-balance":
      return <TrialBalance pack={pack} isMobile={isMobile} />;
    case "journal":
      return <JournalEntries pack={pack} />;
  }
}

// ---- Screen --------------------------------------------------------------

type DrillState = { title: string; rows: DrillLine[]; context: DrillContext | null; open: boolean };

export function ReportsScreen() {
  const { entities, role } = useActiveEntity();
  const { scope, selectScope } = useActiveScope();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const urlReport = searchParams.get("report") as ReportExportId | null;
  const urlStart = searchParams.get("start");
  const urlEnd = searchParams.get("end");
  // Dashboard drill-throughs may carry only `period=YYYY-MM` (no start/end), or
  // all three. Mapping period -> a concrete month range lets those links land on
  // the exact month instead of the report's own default.
  const urlPeriod = searchParams.get("period");
  const selectedReport = urlReport && REPORT_BY_ID.has(urlReport) ? urlReport : null;

  const [preset, setPreset] = useState<ReportPresetId>("thisMonth");
  const [range, setRange] = useState<DateRange>(() => defaultRangeForReport("profit-and-loss", todayIso()).range);
  const [basis, setBasis] = useState<ReportBasis>("accrual");
  const [compare, setCompare] = useState<CompareMode>("none");
  const [columnMode, setColumnMode] = useState<ColumnMode>("total");
  const [drill, setDrill] = useState<DrillState>({ title: "", rows: [], context: null, open: false });
  // Tracks which report we've applied the default period for. A ref (not state)
  // so resetting it never triggers a re-render or a cascading effect.
  const initializedForRef = useRef<string | null>(null);
  // Toolbar state (basis / compare / columns) PERSISTS across report switches —
  // an accountant who set "cash basis" should keep it when jumping P&L -> Balance
  // Sheet. We only seed columns the first time a report type is opened. A ref so
  // reading it never triggers a re-render.
  const toolbarTouchedRef = useRef(false);
  const scopedEntityId = scope === "all" ? null : (scope.entityId as Id<"entities">);

  // When a report opens, set its sane default PERIOD (unless the URL carried an
  // explicit range or period from a dashboard drill-through). Basis/compare are
  // intentionally NOT reset so they stick across report switches. The ref guard
  // makes this run once per report change, so it cannot cascade — hence the
  // scoped rule disable.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!selectedReport) {
      initializedForRef.current = null;
      return;
    }
    if (initializedForRef.current === selectedReport) return;
    const today = todayIso();
    const periodRange = urlPeriod ? rangeForPeriodParam(urlPeriod, today) : null;
    if (urlStart && urlEnd) {
      setPreset("custom");
      setRange(clampRange({ startDate: urlStart, endDate: urlEnd }, today));
    } else if (periodRange) {
      setPreset("custom");
      setRange(periodRange);
    } else {
      const def = defaultRangeForReport(selectedReport, today);
      setPreset(def.preset);
      setRange(def.range);
    }
    // Seed columns to "monthly" for P&L the first time only; if the user has
    // touched the toolbar, keep their choice across switches.
    if (!toolbarTouchedRef.current) {
      setColumnMode(selectedReport === "profit-and-loss" ? "monthly" : "total");
    }
    initializedForRef.current = selectedReport;
  }, [selectedReport, urlStart, urlEnd, urlPeriod]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Portfolio scope ('All businesses') runs the CONSOLIDATED report path
  // (E5-T7/T8) — confirmed intercompany pairs are eliminated and the pack carries
  // consolidatedFrom + eliminatedMinor for the banner. A single business sends
  // its entityId exactly as before (unchanged single-entity output).
  const queryArgs = useMemo(
    () => {
      const base = {
        startDate: range.startDate,
        endDate: range.endDate,
        basis,
        compare,
        columnMode,
      };
      return scope === "all"
        ? { ...base, scope: "all" as const }
        : { ...base, entityId: scope.entityId as Id<"entities"> };
    },
    [scope, range.startDate, range.endDate, basis, compare, columnMode],
  );
  // E6-T8: guard the obvious invalid range on the CLIENT so start>end never
  // round-trips to a server throw (reportViews rejects start>end). When invalid
  // we skip the query and render the friendly error card with a Reset action.
  const rangeInvalid = range.startDate > range.endDate;
  const pack = useQuery(
    api.reportViews.reportPack,
    selectedReport && !rangeInvalid ? queryArgs : "skip",
  ) as ReportPack | undefined;

  const lockArgs = useMemo(
    () => (scopedEntityId ? { entityId: scopedEntityId } : null),
    [scopedEntityId],
  );
  // Home-only: the period-lock + readiness snapshot for the Close-the-books
  // banner. Skipped when a report is open so we don't pay for it on the viewer.
  const lockState = useQuery(api.reportViews.reportPeriodLock, selectedReport || !lockArgs ? "skip" : lockArgs);
  const homeReportArgs = useMemo(() => {
    const monthRange = lastFullMonth(todayIso()).range;
    const base = {
      ...monthRange,
      basis: "accrual" as const,
      compare: "none" as const,
      columnMode: "total" as const,
    };
    return scope === "all" ? { ...base, scope: "all" as const } : scopedEntityId ? { ...base, entityId: scopedEntityId } : null;
  }, [scope, scopedEntityId]);
  const homePack = useQuery(
    api.reportViews.reportPack,
    selectedReport || !homeReportArgs ? "skip" : homeReportArgs,
  ) as ReportPack | undefined;

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
    toolbarTouchedRef.current = true;
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

  // E6-T8: "Reset range" action on the error/invalid-range card — snaps the
  // report back to its sane default period so the owner recovers in one click.
  function resetRange() {
    if (!selectedReport) return;
    const def = defaultRangeForReport(selectedReport, todayIso());
    setPreset(def.preset);
    setRange(def.range);
  }

  function openDrill(title: string, rows: DrillLine[], context: DrillContext) {
    setDrill({ title, rows, context, open: true });
  }

  function openDrillInTransactions() {
    if (!drill.context) return;
    router.push(buildDrillHref(drill.context));
  }

  if (!selectedReport) {
    const close = lastFullMonth(todayIso());
    // Readiness checks are derived honestly from the most-recent-full-month pack:
    // books balance + the trial balance ties + every payroll run for the month is
    // at least approved. If the home pack hasn't loaded yet, show the checks as
    // not-yet-ready rather than guessing.
    const checks: CloseReadinessCheck[] = [
      { id: "balanced", label: "Balance sheet balances", ok: Boolean(homePack?.balanceSheet.balanced) },
      {
        id: "trial",
        label: "Trial balance ties out",
        ok: homePack ? homePack.trialBalance.differenceMinor === 0 : false,
      },
      {
        id: "payroll",
        label: "Payroll runs approved",
        ok: homePack ? homePack.payrollSummary.rows.every((row) => row.status !== "draft") : false,
      },
    ];
    const canClose = role === "owner" || role === "admin";
    // E6-T10: ONE small, report-relevant insight derived from the already-loaded
    // homePack (most-recent full month). No new query. Threshold-gated — hidden
    // when nothing crosses (e.g. flat month, no aged AR).
    const reportsInsight = homePack
      ? buildPageInsight("reports", {
          entity: { currency: homePack.entity.currency },
          monthlyReview: {
            month: homePack.monthlyReview.month,
            netResultMinor: homePack.monthlyReview.netResultMinor,
          },
          arAging: homePack.arAging,
        })
      : null;
    return (
      <div className="space-y-5" data-testid="reports-screen">
        <ReportsBusinessFilter entities={entities} scope={scope} onSelectScope={selectScope} />
        <ReportsHome
          onOpen={openReport}
          banner={
            <>
              {reportsInsight ? <InsightBanner page="reports" insight={reportsInsight} /> : null}
              <UnreviewedGapBanner unreviewed={homePack?.unreviewed} />
              <TruncationBanner limits={homePack?.limits} />
              {scopedEntityId ? (
                <>
                  <ReconciliationCard entityId={scopedEntityId} />
                  <CloseBooksBanner
                    entityId={(lockState?.entityId as Id<"entities"> | null) ?? null}
                    lockedThroughDate={lockState?.lockedThroughDate ?? null}
                    monthLabel={close.label}
                    lockThroughDate={close.lockThroughDate}
                    checks={checks}
                    canClose={canClose}
                  />
                </>
              ) : null}
            </>
          }
        />
      </div>
    );
  }

  const meta = REPORT_BY_ID.get(selectedReport)!;
  const isMonthlyReview = selectedReport === "monthly-review";

  return (
    <div className="min-w-0 space-y-4" data-testid="reports-screen">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <Button variant="ghost" size="sm" onClick={goHome} data-testid="reports-back">
          <ArrowLeft className="size-4" />
          Reports
        </Button>
        <ReportsBusinessFilter entities={entities} scope={scope} onSelectScope={selectScope} />
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
            toolbarTouchedRef.current = true;
            setPreset("custom");
            setRange(value);
          }}
          onBasis={(value) => {
            toolbarTouchedRef.current = true;
            setBasis(value);
          }}
          onCompare={(value) => {
            toolbarTouchedRef.current = true;
            setCompare(value);
          }}
          onColumnMode={(value) => {
            toolbarTouchedRef.current = true;
            setColumnMode(value);
          }}
          onExplain={() =>
            window.dispatchEvent(createAiRequestEvent(`Explain the ${meta.name} for ${formatRangeLabel(range)}`, "Reports", pack))
          }
          onExport={exportCsv}
          exportDisabled={!pack}
        />
      )}

      {pack && scope === "all" && pack.consolidatedFrom ? (
        <section
          data-testid="consolidation-banner"
          className="rounded-[14px] border border-ob-green-700/30 bg-ob-green-700/5 px-4 py-3 text-sm"
        >
          <span className="font-medium">
            Consolidated across {pack.consolidatedFrom.length}{" "}
            {pack.consolidatedFrom.length === 1 ? "business" : "businesses"}
          </span>
          {pack.eliminatedMinor && pack.eliminatedMinor > 0 ? (
            <span className="text-muted-foreground">
              {" "}
              · {formatMinorMoney(pack.eliminatedMinor, { currency: "USD" })} of intercompany activity eliminated
            </span>
          ) : (
            <span className="text-muted-foreground"> · no intercompany activity to eliminate</span>
          )}
        </section>
      ) : null}

      <UnreviewedGapBanner unreviewed={pack?.unreviewed} />
      <TruncationBanner limits={pack?.limits} />

      {rangeInvalid ? (
        // E6-T8: invalid range never round-trips to a server throw — render the
        // friendly card directly with a Reset action.
        <section data-testid="report-error" className="rounded-[14px] border bg-card p-6 text-sm shadow-xs">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-warning-surface text-warning" aria-hidden="true">
              <AlertTriangle className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold">That date range doesn&apos;t work</h3>
              <p className="mt-1 text-muted-foreground">The start date is after the end date. Reset the range to continue.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={resetRange} data-testid="report-error-reset">
                Reset range
              </Button>
            </div>
          </div>
        </section>
      ) : pack === undefined ? (
        // E6-T8: per-report shaped skeleton (not a bare text line) while the pack
        // is loading, so the layout doesn't jump when it arrives.
        <ReportSkeleton reportId={selectedReport} />
      ) : (
        // E6-T8: catch any thrown query (auth/start>end the guard missed) and
        // render a friendly inline card with Reset instead of a blank/crash.
        <ReportErrorBoundary key={`${selectedReport}-${range.startDate}-${range.endDate}`} onReset={resetRange}>
          <ActiveReport
            reportId={selectedReport}
            pack={pack}
            onDrill={openDrill}
            monthRange={range}
            onShiftMonth={shiftMonth}
            onOpenReport={openReport}
            isMobile={isMobile}
          />
        </ReportErrorBoundary>
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
        onOpenInTransactions={drill.context ? openDrillInTransactions : undefined}
      />
    </div>
  );
}
