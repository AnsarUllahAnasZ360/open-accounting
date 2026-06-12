"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, Download, FileText, FileUp, History, Layers2, ReceiptText, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Amount, BarChart, CategoryChip, ConfidenceRing, EmptyState, Sparkline, StatCard } from "@/components/openbooks/primitives";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ReviewFilter = "all" | "auto" | "confirmed" | "needs_review" | "excluded";

function LoadingBlock({ label }: { label: string }) {
  return (
    <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground shadow-xs">
      Loading {label}...
    </section>
  );
}

function categoryLabel(kind: string) {
  return kind.replaceAll("_", " ");
}

export function DashboardScreen() {
  // The period selector drives the query so it scopes every period-sensitive
  // widget (P&L snapshot, expense breakdown, income-by-customer, payroll) —
  // not just decoration. `null` lets the server pick the latest month with data.
  const [period, setPeriod] = useState<string | null>(null);
  const dashboard = useQuery(api.coreViews.dashboard, { period: period ?? undefined });

  if (dashboard === undefined) return <LoadingBlock label="dashboard" />;
  if (!dashboard) {
    return <EmptyState title="No entity yet" description="Seed demo data from Settings before reviewing the business dashboard." />;
  }

  return (
    <div className="space-y-5" data-testid="dashboard-screen">
      <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-xs md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-base font-semibold">Operating snapshot</h2>
          <p className="mt-1 text-sm text-muted-foreground">{dashboard.entity.name} · ledger-backed demo books</p>
        </div>
        <div className="grid gap-1.5 sm:w-48">
          <Label>Period</Label>
          <Select value={period ?? dashboard.selectedMonth} onValueChange={setPeriod}>
            <SelectTrigger data-testid="dashboard-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dashboard.cashFlowByMonth.map((month) => (
                <SelectItem key={month.month} value={month.month}>
                  {month.month}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Cash position"
          value={
            <Link className="hover:text-primary" href="/transactions">
              <Amount amountMinor={dashboard.cashPositionMinor} />
            </Link>
          }
          detail={dashboard.latestMonth}
        >
          <Sparkline className="text-primary" data={dashboard.cashSparkline} />
        </StatCard>
        <StatCard
          label="Net income"
          value={
            <Link className="hover:text-primary" href={`/reports?period=${dashboard.selectedMonth}`}>
              <Amount amountMinor={dashboard.profitAndLoss.netIncomeMinor} />
            </Link>
          }
          detail={dashboard.selectedMonth}
        />
        <StatCard
          label="Inbox"
          value={
            <Link className="hover:text-primary" href="/inbox">
              {dashboard.inbox.openCount}
            </Link>
          }
          detail={`${dashboard.inbox.automationRate}% reviewed`}
        />
        <StatCard
          label="AR / AP"
          value={
            <Link className="hover:text-primary" href="/invoices">
              <Amount amountMinor={dashboard.receivables.openMinor - dashboard.payables.openMinor} />
            </Link>
          }
          detail="Open net"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg border bg-card shadow-xs">
          <div className="border-b px-4 py-3">
            <h2 className="text-base font-semibold">Cash and credit</h2>
            <p className="mt-1 text-sm text-muted-foreground">Ledger balances by connected demo account.</p>
          </div>
          <div className="divide-y">
            {dashboard.bankBalances.map((account) => (
              <div key={account.id} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[1fr_auto_auto] md:items-center">
                <div>
                  <div className="font-medium">{account.name}</div>
                  <div className="text-muted-foreground">{account.kind} ending {account.mask}</div>
                </div>
                <CategoryChip label={account.kind === "credit" ? "Liability" : "Asset"} />
                <Link className="justify-self-start hover:text-primary md:justify-self-end" href="/transactions">
                  <Amount amountMinor={account.amountMinor} />
                </Link>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Monthly P&L</h2>
              <p className="mt-1 text-sm text-muted-foreground">{dashboard.selectedMonth}</p>
            </div>
            <CategoryChip active label="Ledger lines" />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted-foreground">Income</div>
              <Link className="hover:text-primary" href={`/reports?report=profit-and-loss&period=${dashboard.selectedMonth}`}>
                <Amount amountMinor={dashboard.profitAndLoss.incomeMinor} tone="income" />
              </Link>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Expense</div>
              <Link className="hover:text-primary" href={`/expenses?period=${dashboard.selectedMonth}`}>
                <Amount amountMinor={dashboard.profitAndLoss.expenseMinor} tone="expense" />
              </Link>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Net</div>
              <Link className="hover:text-primary" href={`/reports?report=profit-and-loss&period=${dashboard.selectedMonth}`}>
                <Amount amountMinor={dashboard.profitAndLoss.netIncomeMinor} />
              </Link>
            </div>
          </div>
          <div className="mt-5">
            <BarChart data={dashboard.expensesByCategory.map((item) => ({ label: item.name.split(" ")[0], value: item.amountMinor }))} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-lg border bg-card shadow-xs">
          <div className="border-b px-4 py-3">
            <h2 className="text-base font-semibold">Inbox status</h2>
          </div>
          <div className="divide-y">
            {dashboard.inbox.byKind.map((item) => (
              <div key={item.kind} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="capitalize text-muted-foreground">{categoryLabel(item.kind)}</span>
                <span className="money-figures font-semibold">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border bg-card shadow-xs">
          <div className="border-b px-4 py-3">
            <h2 className="text-base font-semibold">Activity feed</h2>
          </div>
          <div className="divide-y">
            {dashboard.recentActivity.map((entry) => (
              <div key={entry.id} className="px-4 py-3 text-sm">
                <div className="font-medium">{entry.memo}</div>
                <div className="text-muted-foreground">{entry.date} - {entry.source}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-lg border bg-card shadow-xs">
          <div className="border-b px-4 py-3">
            <h2 className="text-base font-semibold">A/R and A/P</h2>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-1">
            <Link className="rounded-lg border p-3 hover:bg-muted/50" href="/invoices">
              <div className="text-xs text-muted-foreground">Open receivables</div>
              <div className="mt-1 font-semibold"><Amount amountMinor={dashboard.receivables.openMinor} /></div>
              <div className="mt-1 text-xs text-muted-foreground">{dashboard.receivables.overdueCount} overdue</div>
            </Link>
            <Link className="rounded-lg border p-3 hover:bg-muted/50" href="/bills">
              <div className="text-xs text-muted-foreground">Open payables</div>
              <div className="mt-1 font-semibold"><Amount amountMinor={dashboard.payables.openMinor} /></div>
              <div className="mt-1 text-xs text-muted-foreground">{dashboard.payables.dueSoonCount} due soon</div>
            </Link>
          </div>
        </div>

        <div className="rounded-lg border bg-card shadow-xs">
          <div className="border-b px-4 py-3">
            <h2 className="text-base font-semibold">Income by customer</h2>
          </div>
          <div className="divide-y">
            {dashboard.incomeByCustomer.map((customer) => (
              <Link key={customer.contactId} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/50" href={`/contacts?contact=${customer.contactId}`}>
                <span className="font-medium">{customer.name}</span>
                <Amount amountMinor={customer.amountMinor} />
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border bg-card shadow-xs">
          <div className="border-b px-4 py-3">
            <h2 className="text-base font-semibold">Payroll</h2>
          </div>
          {dashboard.payroll ? (
            <Link className="block p-4 hover:bg-muted/50" href="/payroll">
              <div className="text-sm text-muted-foreground">{dashboard.payroll.period} · {dashboard.payroll.status}</div>
              <div className="mt-2 text-xl font-semibold"><Amount amountMinor={dashboard.payroll.totalBaseMinor} /></div>
            </Link>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">No payroll run yet.</div>
          )}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4 shadow-xs">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Cash flow by month</h2>
          <Button asChild size="sm" variant="outline">
            <Link href="/reports">Reports</Link>
          </Button>
        </div>
        <BarChart data={dashboard.cashFlowByMonth.map((month) => ({ label: month.label, value: month.netMinor }))} />
      </section>
    </div>
  );
}

export function InboxScreen() {
  const inbox = useQuery(api.coreViews.inbox, {});
  const confirmTransaction = useAction(api.semanticMemory.confirmTransactionWithMemoryEmbedding);
  const excludeTransaction = useMutation(api.pipeline.excludeTransaction);
  const createRuleFromTransaction = useMutation(api.pipeline.createRuleFromTransaction);
  const confirmReceiptMatch = useMutation(api.receipts.manualMatch);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string>("");
  const [checkedItemIds, setCheckedItemIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const selected = useMemo(
    () => {
      if (!inbox?.items.length) return null;
      return inbox.items.find((item) => item.id === selectedId) ?? inbox.items[0];
    },
    [inbox, selectedId],
  );
  const chosenCategoryId = categoryId || selected?.categoryAccountId || inbox?.categoryOptions[0]?.id || "";
  const selectedIndex = inbox?.items.findIndex((item) => item.id === selected?.id) ?? -1;
  const selectedReceipt = selected?.receiptDocument ?? null;
  const selectedBatchItems = inbox?.items.filter((item) => checkedItemIds.has(item.id) && item.transactionId && item.kind !== "receipt") ?? [];

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, [role='combobox']")) return;
      if (!inbox?.items.length || pending) return;
      if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        const next = inbox.items[Math.min(inbox.items.length - 1, Math.max(0, selectedIndex) + 1)];
        setSelectedId(next.id);
        setCategoryId(next.categoryAccountId ?? "");
      }
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        const previous = inbox.items[Math.max(0, Math.max(0, selectedIndex) - 1)];
        setSelectedId(previous.id);
        setCategoryId(previous.categoryAccountId ?? "");
      }
      if (event.key.toLowerCase() === "e") {
        event.preventDefault();
        void excludeSelected();
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (selectedReceipt) void confirmReceiptSelected();
        else void confirmSelected();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  async function confirmSelected() {
    if (selected?.kind === "receipt" || !selected?.transactionId || !chosenCategoryId) return;
    setPending(true);
    setMessage("");
    try {
      await confirmTransaction({
        transactionId: selected.transactionId as Id<"transactions">,
        categoryAccountId: chosenCategoryId as Id<"ledgerAccounts">,
      });
      setCategoryId("");
      setCheckedItemIds((current) => {
        const next = new Set(current);
        next.delete(selected.id);
        return next;
      });
      setMessage("Inbox card confirmed and posted through the ledger.");
    } finally {
      setPending(false);
    }
  }

  async function excludeSelected() {
    if (selected?.kind === "receipt" || !selected?.transactionId) return;
    setPending(true);
    setMessage("");
    try {
      await excludeTransaction({
        transactionId: selected.transactionId as Id<"transactions">,
        reason: "Excluded from Inbox review.",
      });
      setCheckedItemIds((current) => {
        const next = new Set(current);
        next.delete(selected.id);
        return next;
      });
      setMessage("Inbox card excluded; posted entries were reversed when needed.");
    } finally {
      setPending(false);
    }
  }

  async function confirmBatch() {
    if (!selectedBatchItems.length) return;
    setPending(true);
    setMessage("");
    try {
      for (const item of selectedBatchItems) {
        const categoryForItem = item.categoryAccountId || inbox?.categoryOptions[0]?.id;
        if (!item.transactionId || !categoryForItem) continue;
        await confirmTransaction({
          transactionId: item.transactionId as Id<"transactions">,
          categoryAccountId: categoryForItem as Id<"ledgerAccounts">,
        });
      }
      setCheckedItemIds(new Set());
      setMessage(`${selectedBatchItems.length} Inbox cards confirmed.`);
    } finally {
      setPending(false);
    }
  }

  async function saveRuleFromSelected() {
    if (selected?.kind === "receipt" || !selected?.transactionId || !chosenCategoryId) return;
    setPending(true);
    setMessage("");
    try {
      await createRuleFromTransaction({
        transactionId: selected.transactionId as Id<"transactions">,
        categoryAccountId: chosenCategoryId as Id<"ledgerAccounts">,
      });
      setMessage("Rule saved for future matching.");
    } finally {
      setPending(false);
    }
  }

  async function confirmReceiptSelected() {
    if (!selectedReceipt || !selected?.transactionId) return;
    setPending(true);
    setMessage("");
    try {
      await confirmReceiptMatch({
        documentId: selectedReceipt.id as Id<"documents">,
        transactionId: selected.transactionId as Id<"transactions">,
      });
      setCheckedItemIds((current) => {
        const next = new Set(current);
        next.delete(selected.id);
        return next;
      });
      setMessage("Receipt match confirmed. The transaction now carries the receipt chip.");
    } finally {
      setPending(false);
    }
  }

  if (inbox === undefined) return <LoadingBlock label="Inbox" />;
  if (!inbox || inbox.items.length === 0) {
    return <EmptyState title="Inbox zero" description="There are no open review cards for the active entity." />;
  }

  return (
    <section className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <div className="rounded-lg border bg-card shadow-xs" data-testid="inbox-list">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-semibold">Review queue</h2>
          <CategoryChip active label={`${inbox.items.length} open`} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <Button size="sm" onClick={confirmBatch} disabled={pending || selectedBatchItems.length === 0}>
            <Check className="size-3.5" />
            Confirm selected
          </Button>
          <span className="text-xs text-muted-foreground">J/K move · Enter confirm · E exclude</span>
        </div>
        <div className="divide-y">
          {inbox.items.map((item) => (
            <div
              className={`grid w-full grid-cols-[auto_1fr] gap-3 px-4 py-3 text-left text-sm hover:bg-muted/60 ${item.id === selected?.id ? "bg-muted" : ""}`}
              data-has-transaction={item.transactionId ? "true" : "false"}
              data-kind={item.kind}
              data-testid="inbox-item"
              key={item.id}
              onClick={() => {
                setSelectedId(item.id);
                setCategoryId(item.categoryAccountId ?? "");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setSelectedId(item.id);
                  setCategoryId(item.categoryAccountId ?? "");
                }
              }}
              role="button"
              tabIndex={0}
            >
              <input
                aria-label={`Select ${item.merchant}`}
                checked={checkedItemIds.has(item.id)}
                className="mt-1"
                disabled={item.kind === "receipt"}
                onChange={(event) => {
                  if (item.kind === "receipt") return;
                  const checked = event.currentTarget.checked;
                  setCheckedItemIds((current) => {
                    const next = new Set(current);
                    if (checked) next.add(item.id);
                    else next.delete(item.id);
                    return next;
                  });
                }}
                onClick={(event) => event.stopPropagation()}
                type="checkbox"
              />
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium">{item.merchant}</span>
                  <Amount amountMinor={item.amountMinor} />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{categoryLabel(item.kind)} - {item.categoryName}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border bg-card shadow-xs">
        {selected ? (
          <div className="grid gap-4 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">{selected.merchant}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{selected.summary}</p>
              </div>
              {selected.confidence ? <ConfidenceRing value={Math.round(selected.confidence * 100)} /> : null}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border px-3 py-2">
                <div className="text-xs text-muted-foreground">Date</div>
                <div className="mt-1 text-sm font-medium">{selected.date ?? "Needs context"}</div>
              </div>
              <div className="rounded-lg border px-3 py-2">
                <div className="text-xs text-muted-foreground">Amount</div>
                <Amount amountMinor={selected.amountMinor} />
              </div>
              <div className="rounded-lg border px-3 py-2">
                <div className="text-xs text-muted-foreground">{selectedReceipt ? "Candidate" : "Account"}</div>
                <div className="mt-1 text-sm font-medium">
                  {selectedReceipt?.candidate ? selectedReceipt.candidate.bankAccountName : selected.bankAccountName}
                </div>
              </div>
            </div>
            {selectedReceipt ? (
              <div className="grid gap-3 md:grid-cols-2" data-testid="receipt-inbox-card">
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ReceiptText className="size-4 text-primary" />
                    Extracted receipt
                  </div>
                  <div className="mt-3 grid gap-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Vendor</span>
                      <span className="text-right font-medium">{selectedReceipt.vendor}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Date</span>
                      <span className="text-right font-medium">{selectedReceipt.date}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Total</span>
                      <Amount amountMinor={selectedReceipt.totalMinor} />
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">File</span>
                      <span className="truncate text-right font-medium">{selectedReceipt.fileName ?? "Receipt file"}</span>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <FileText className="size-4 text-primary" />
                    Candidate transaction
                  </div>
                  {selectedReceipt.candidate ? (
                    <div className="mt-3 grid gap-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Merchant</span>
                        <span className="text-right font-medium">{selectedReceipt.candidate.merchant}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Date</span>
                        <span className="text-right font-medium">{selectedReceipt.candidate.date}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Amount</span>
                        <Amount amountMinor={selectedReceipt.candidate.amountMinor} />
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Category</span>
                        <span className="text-right font-medium">{selectedReceipt.candidate.categoryName}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-md bg-muted p-3 text-sm text-muted-foreground">No close transaction candidate yet.</div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <Label>Category</Label>
                  <Select value={chosenCategoryId} onValueChange={setCategoryId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose category" />
                    </SelectTrigger>
                    <SelectContent>
                      {inbox.categoryOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.number} - {option.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                  {selected.reasoning ?? "No rule or match reached the posting threshold. Confirming will post through the ledger."}
                </div>
              </>
            )}
            {message ? (
              <div className="rounded-lg border bg-primary/5 p-3 text-sm text-primary" data-testid="inbox-message">
                {message}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {selectedReceipt ? (
                <>
                  <Button data-testid="receipt-confirm-match" onClick={confirmReceiptSelected} disabled={pending || !selected.transactionId}>
                    <Check className="size-4" />
                    Confirm receipt match
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/bills">
                      <Search className="size-4" />
                      Pick other
                    </Link>
                  </Button>
                  <Button variant="outline" disabled>
                    <FileUp className="size-4" />
                    Create expense
                  </Button>
                </>
              ) : (
                <>
                  <Button data-testid="inbox-confirm" onClick={confirmSelected} disabled={pending || !selected.transactionId || !chosenCategoryId}>
                    <Check className="size-4" />
                    Confirm and post
                  </Button>
                  <Button variant="outline" onClick={saveRuleFromSelected} disabled={pending || !selected.transactionId || !chosenCategoryId}>
                    <Layers2 className="size-4" />
                    Always do this
                  </Button>
                  <Button variant="outline" onClick={excludeSelected} disabled={pending || !selected.transactionId}>
                    <X className="size-4" />
                    Exclude
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function TransactionsScreen() {
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");
  const [review, setReview] = useState<ReviewFilter>("all");
  const [search, setSearch] = useState("");
  // Seed selection from the ⌘K deep-link (/transactions?focus=<txnId>) so the
  // row's drawer is open on first render; later clicks override it.
  const [selectedId, setSelectedId] = useState<string | null>(focusId);
  const [manualAmount, setManualAmount] = useState("-42.00");
  const [manualMerchant, setManualMerchant] = useState("Manual import");
  const [csvText, setCsvText] = useState("date,description,amount\n2026-06-30,Sample CSV expense,-25.00");
  const data = useQuery(api.coreViews.transactions, { review, search });
  const recategorizeTransaction = useAction(api.semanticMemory.recategorizeTransactionWithMemoryEmbedding);
  const excludeTransaction = useMutation(api.pipeline.excludeTransaction);
  const splitTransaction = useMutation(api.pipeline.splitTransaction);
  const routeTransaction = useMutation(api.pipeline.routeTransaction);
  const [pending, setPending] = useState(false);
  const [transactionMessage, setTransactionMessage] = useState("");
  const [checkedTransactionIds, setCheckedTransactionIds] = useState<Set<string>>(new Set());
  const [splitFirstAmount, setSplitFirstAmount] = useState("");
  const [splitSecondAmount, setSplitSecondAmount] = useState("");
  const [splitFirstCategoryId, setSplitFirstCategoryId] = useState("");
  const [splitSecondCategoryId, setSplitSecondCategoryId] = useState("");

  const selected = useMemo(
    () => {
      if (!data?.rows.length) return null;
      return data.rows.find((row) => row.id === selectedId) ?? data.rows[0];
    },
    [data, selectedId],
  );

  // Deep-link from the ⌘K palette: once the register loads, scroll the focused
  // row into view (DOM side-effect only; selection is seeded in useState above).
  useEffect(() => {
    if (!focusId || !data?.rows.length) return;
    if (!data.rows.some((row) => row.id === focusId)) return;
    const node = document.querySelector<HTMLElement>(`[data-transaction-id="${focusId}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId, data]);
  const defaultBankAccountId = data?.bankAccounts[0]?.id ?? "";
  const defaultCategoryId = data?.categoryOptions.find((option) => option.type === "expense")?.id ?? data?.categoryOptions[0]?.id ?? "";
  const otherIncomeCategoryId =
    data?.categoryOptions.find((option) => option.number === "4200")?.id ??
    data?.categoryOptions.find((option) => option.type === "income")?.id ??
    "";
  const secondDefaultCategoryId =
    data?.categoryOptions.find((option) => option.type === "expense" && option.id !== defaultCategoryId)?.id ??
    data?.categoryOptions.find((option) => option.id !== defaultCategoryId)?.id ??
    "";
  const csvRows = useMemo(
    () =>
      csvText
        .split(/\r?\n/)
        .slice(1)
        .map((line) => line.split(",").map((cell) => cell.trim()))
        .filter((row) => row.length >= 3 && row[0] && row[1] && row[2]),
    [csvText],
  );
  const duplicateCsvCount = csvRows.length - new Set(csvRows.map((row) => row.join(":"))).size;
  const selectedReconciliation = data?.bankAccounts[0] ?? null;
  const selectedDebitTotal = selected?.lines.reduce((sum, line) => sum + line.debitMinor, 0) ?? 0;
  const selectedCreditTotal = selected?.lines.reduce((sum, line) => sum + line.creditMinor, 0) ?? 0;
  const selectedAbsoluteAmount = Math.abs(selected?.amountMinor ?? 0);
  const defaultSplitFirstAmount = (Math.floor(selectedAbsoluteAmount / 2) / 100).toFixed(2);
  const defaultSplitSecondAmount = ((selectedAbsoluteAmount - Math.floor(selectedAbsoluteAmount / 2)) / 100).toFixed(2);
  const activeSplitFirstAmount = splitFirstAmount || defaultSplitFirstAmount;
  const activeSplitSecondAmount = splitSecondAmount || defaultSplitSecondAmount;
  const activeSplitFirstCategoryId = splitFirstCategoryId || selected?.categoryAccountId || defaultCategoryId;
  const activeSplitSecondCategoryId = splitSecondCategoryId || secondDefaultCategoryId || defaultCategoryId;

  function selectTransaction(transactionId: string) {
    setSelectedId(transactionId);
    setSplitFirstAmount("");
    setSplitSecondAmount("");
    setSplitFirstCategoryId("");
    setSplitSecondCategoryId("");
  }

  async function updateCategory(transactionId: string, categoryAccountId: string) {
    setPending(true);
    setTransactionMessage("");
    try {
      await recategorizeTransaction({
        transactionId: transactionId as Id<"transactions">,
        categoryAccountId: categoryAccountId as Id<"ledgerAccounts">,
      });
      setTransactionMessage("Transaction recategorized with reversal and repost.");
    } catch (error) {
      setTransactionMessage(error instanceof Error ? error.message : "Could not recategorize transaction.");
    } finally {
      setPending(false);
    }
  }

  async function addManualTransaction() {
    if (!data?.entity || !defaultBankAccountId || !defaultCategoryId) return;
    setPending(true);
    setTransactionMessage("");
    try {
      const result = await routeTransaction({
        entityId: data.entity.id as Id<"entities">,
        bankAccountId: defaultBankAccountId as Id<"bankAccounts">,
        date: "2026-06-30",
        amountMinor: Math.round(Number(manualAmount) * 100),
        currency: data.entity.currency,
        merchant: manualMerchant,
        rawDescription: manualMerchant,
        status: "posted",
        source: "bank",
        externalId: `manual:${Date.now()}:${manualMerchant}`,
        categoryAccountId: defaultCategoryId as Id<"ledgerAccounts">,
      });
      selectTransaction(result.transactionId);
      setSearch(manualMerchant);
      setTransactionMessage("Manual transaction imported through the pipeline.");
    } catch (error) {
      setTransactionMessage(error instanceof Error ? error.message : "Could not add manual transaction.");
    } finally {
      setPending(false);
    }
  }

  async function importCsv() {
    if (!data?.entity || !defaultBankAccountId || !defaultCategoryId) return;
    setPending(true);
    setTransactionMessage("");
    let lastMerchant = "";
    try {
      for (const [date, description, amount] of csvRows) {
        const result = await routeTransaction({
          entityId: data.entity.id as Id<"entities">,
          bankAccountId: defaultBankAccountId as Id<"bankAccounts">,
          date,
          amountMinor: Math.round(Number(amount) * 100),
          currency: data.entity.currency,
          merchant: description,
          rawDescription: description,
          status: "posted",
          source: "bank",
          externalId: `csv:${date}:${description}:${amount}`,
          categoryAccountId: defaultCategoryId as Id<"ledgerAccounts">,
        });
        selectTransaction(result.transactionId);
        lastMerchant = description;
      }
      if (lastMerchant) setSearch(lastMerchant);
      setTransactionMessage(`${csvRows.length} CSV row${csvRows.length === 1 ? "" : "s"} sent through the pipeline.`);
    } catch (error) {
      setTransactionMessage(error instanceof Error ? error.message : "Could not import CSV rows.");
    } finally {
      setPending(false);
    }
  }

  async function bulkExclude() {
    if (!checkedTransactionIds.size) return;
    setPending(true);
    setTransactionMessage("");
    try {
      for (const transactionId of checkedTransactionIds) {
        await excludeTransaction({
          transactionId: transactionId as Id<"transactions">,
          reason: "Bulk excluded from register.",
        });
      }
      setTransactionMessage(`${checkedTransactionIds.size} transactions excluded.`);
      setCheckedTransactionIds(new Set());
    } catch (error) {
      setTransactionMessage(error instanceof Error ? error.message : "Could not bulk exclude transactions.");
    } finally {
      setPending(false);
    }
  }

  async function postSplit() {
    if (!selected || !activeSplitFirstCategoryId || !activeSplitSecondCategoryId) return;
    setPending(true);
    setTransactionMessage("");
    try {
      await splitTransaction({
        transactionId: selected.id as Id<"transactions">,
        splits: [
          {
            categoryAccountId: activeSplitFirstCategoryId as Id<"ledgerAccounts">,
            amountMinor: Math.round(Number(activeSplitFirstAmount) * 100),
          },
          {
            categoryAccountId: activeSplitSecondCategoryId as Id<"ledgerAccounts">,
            amountMinor: Math.round(Number(activeSplitSecondAmount) * 100),
          },
        ],
      });
      setTransactionMessage("Transaction split with reversal and repost.");
    } catch (error) {
      setTransactionMessage(error instanceof Error ? error.message : "Could not split transaction.");
    } finally {
      setPending(false);
    }
  }

  if (data === undefined) return <LoadingBlock label="transactions" />;
  if (!data) return <EmptyState title="No transactions yet" description="Seed demo data from Settings before reviewing transactions." />;

  return (
    <div className="space-y-4" data-testid="transactions-screen">
      <section className="rounded-lg border bg-card p-4 shadow-xs">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {(["all", "auto", "confirmed", "needs_review", "excluded"] as ReviewFilter[]).map((item) => (
              <Button key={item} size="sm" variant={review === item ? "default" : "outline"} onClick={() => setReview(item)}>
                {categoryLabel(item)}
              </Button>
            ))}
          </div>
          <div className="relative min-w-0 lg:w-80">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search merchant or memo" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={bulkExclude} disabled={pending || checkedTransactionIds.size === 0}>
            <X className="size-3.5" />
            Exclude selected
          </Button>
          <span className="text-xs text-muted-foreground">{checkedTransactionIds.size} selected</span>
        </div>
        {transactionMessage ? (
          <div className="mt-3 rounded-lg border bg-primary/5 p-3 text-sm text-primary" data-testid="transaction-message">
            {transactionMessage}
          </div>
        ) : null}
      </section>

      {selectedReconciliation ? (
        <section className="grid gap-3 rounded-lg border bg-card p-4 shadow-xs md:grid-cols-[1fr_auto_auto_auto] md:items-center">
          <div>
            <h2 className="text-base font-semibold">Reconciliation</h2>
            <p className="mt-1 text-sm text-muted-foreground">{selectedReconciliation.name}</p>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Ledger</div>
            <Amount amountMinor={selectedReconciliation.ledgerBalanceMinor} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Synced</div>
            <Amount amountMinor={selectedReconciliation.bankBalanceMinor} />
          </div>
          <CategoryChip
            active={selectedReconciliation.differenceMinor === 0}
            label={selectedReconciliation.differenceMinor === 0 ? "Matched" : "Needs review"}
          />
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Date</TableHead>
                <TableHead>Merchant</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.id} className="cursor-pointer" data-testid="transaction-row" data-transaction-id={row.id} onClick={() => selectTransaction(row.id)}>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <input
                      aria-label={`Select ${row.merchant}`}
                      checked={checkedTransactionIds.has(row.id)}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setCheckedTransactionIds((current) => {
                          const next = new Set(current);
                          if (checked) next.add(row.id);
                          else next.delete(row.id);
                          return next;
                        });
                      }}
                      type="checkbox"
                    />
                  </TableCell>
                  <TableCell>{row.date}</TableCell>
                  <TableCell>
                    <div className="font-medium">{row.merchant}</div>
                    <div className="text-xs text-muted-foreground">{row.source} - {row.decidedBy ?? "review"}</div>
                  </TableCell>
                  <TableCell>{row.bankAccountName}</TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <Select value={row.categoryAccountId ?? ""} onValueChange={(value) => updateCategory(row.id, value)} disabled={pending}>
                      <SelectTrigger className="h-8 min-w-44">
                        <SelectValue placeholder={row.categoryName} />
                      </SelectTrigger>
                      <SelectContent>
                        {data.categoryOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.number} - {option.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell><CategoryChip label={row.review} active={row.review !== "needs_review"} /></TableCell>
                  <TableCell className="text-right"><Amount amountMinor={row.amountMinor} signed /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <aside className="space-y-4">
          {selected ? (
            <div className="rounded-lg border bg-card shadow-xs" data-testid="transaction-drawer">
              <div className="border-b px-4 py-3">
                <h2 className="text-base font-semibold">{selected.merchant}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{selected.rawDescription}</p>
              </div>
              <div className="grid gap-4 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs text-muted-foreground">Amount</div>
                    <Amount amountMinor={selected.amountMinor} signed />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Confidence</div>
                    {selected.confidence ? <ConfidenceRing value={Math.round(selected.confidence * 100)} /> : <span className="text-sm text-muted-foreground">Manual</span>}
                  </div>
                </div>
                <div className="rounded-lg border">
                  <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm font-semibold">
                    <span>Accounting view</span>
                    <CategoryChip
                      active={selected.lines.length > 0 && selectedDebitTotal === selectedCreditTotal}
                      label={selected.lines.length > 0 && selectedDebitTotal === selectedCreditTotal ? "Balanced lines" : "Unposted"}
                    />
                  </div>
                  <div className="divide-y">
                    {selected.lines.length === 0 ? (
                      <div className="px-3 py-3 text-sm text-muted-foreground">No posted entry yet.</div>
                    ) : (
                      selected.lines.map((line) => (
                        <div key={line.id} className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 text-sm" data-testid="accounting-line">
                          <span className="text-muted-foreground">{line.accountNumber} - {line.accountName}</span>
                          <Amount amountMinor={line.debitMinor} />
                          <Amount amountMinor={line.creditMinor} />
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-lg border">
                  <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-semibold">
                    <ReceiptText className="size-4 text-primary" />
                    Receipt preview
                  </div>
                  {selected.receipt ? (
                    <div className="grid gap-1 px-3 py-3 text-sm">
                      <div className="font-medium">{selected.receipt.vendor}</div>
                      <div className="text-muted-foreground">{selected.receipt.date} · {selected.receipt.status}</div>
                      <Amount amountMinor={selected.receipt.totalMinor} />
                    </div>
                  ) : (
                    <div className="px-3 py-3 text-sm text-muted-foreground">No matched receipt.</div>
                  )}
                </div>
                <div className="rounded-lg border">
                  <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-semibold">
                    <History className="size-4 text-primary" />
                    Activity history
                  </div>
                  <div className="divide-y">
                    {selected.activity.length === 0 ? (
                      <div className="px-3 py-3 text-sm text-muted-foreground">No audit events linked yet.</div>
                    ) : (
                      selected.activity.map((event) => (
                        <div key={event.id} className="px-3 py-2 text-sm">
                          <div className="font-medium">{event.action}</div>
                          <div className="text-muted-foreground">{event.summary}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <Button
                  data-testid="quick-recategorize"
                  variant="outline"
                  disabled={pending || !otherIncomeCategoryId}
                  onClick={() => updateCategory(selected.id, otherIncomeCategoryId)}
                >
                  <Check className="size-4" />
                  Recategorize
                </Button>
                <div className="rounded-lg border">
                  <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-semibold">
                    <Layers2 className="size-4 text-primary" />
                    Split editor
                  </div>
                  <div className="grid gap-3 p-3">
                    <div className="grid gap-2 sm:grid-cols-[1fr_110px]">
                      <Select value={activeSplitFirstCategoryId} onValueChange={setSplitFirstCategoryId}>
                        <SelectTrigger>
                          <SelectValue placeholder="First category" />
                        </SelectTrigger>
                        <SelectContent>
                          {data.categoryOptions.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.number} - {option.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input value={activeSplitFirstAmount} onChange={(event) => setSplitFirstAmount(event.target.value)} inputMode="decimal" />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[1fr_110px]">
                      <Select value={activeSplitSecondCategoryId} onValueChange={setSplitSecondCategoryId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Second category" />
                        </SelectTrigger>
                        <SelectContent>
                          {data.categoryOptions.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.number} - {option.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input value={activeSplitSecondAmount} onChange={(event) => setSplitSecondAmount(event.target.value)} inputMode="decimal" />
                    </div>
                    <Button data-testid="split-post" onClick={postSplit} disabled={pending || !activeSplitFirstCategoryId || !activeSplitSecondCategoryId}>
                      <Layers2 className="size-4" />
                      Post split
                    </Button>
                  </div>
                </div>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={async () => {
                    setPending(true);
                    setTransactionMessage("");
                    try {
                      await excludeTransaction({ transactionId: selected.id as Id<"transactions">, reason: "Excluded from register." });
                      setTransactionMessage("Transaction excluded with a reversal when needed.");
                    } catch (error) {
                      setTransactionMessage(error instanceof Error ? error.message : "Could not exclude transaction.");
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  <X className="size-4" />
                  Exclude
                </Button>
              </div>
            </div>
          ) : null}

          <div className="rounded-lg border bg-card p-4 shadow-xs">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <SlidersHorizontal className="size-4 text-primary" />
              Manual transaction
            </div>
            <div className="grid gap-3">
              <Input data-testid="manual-merchant" value={manualMerchant} onChange={(event) => setManualMerchant(event.target.value)} />
              <Input data-testid="manual-amount" value={manualAmount} onChange={(event) => setManualAmount(event.target.value)} inputMode="decimal" />
              <Button data-testid="manual-add" onClick={addManualTransaction} disabled={pending || !defaultBankAccountId || !defaultCategoryId}>Add through pipeline</Button>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4 shadow-xs">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <FileUp className="size-4 text-primary" />
              CSV import
            </div>
            <div className="mb-3 grid gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <FileText className="size-3.5 text-primary" />
                Column mapper
              </div>
              <div>Date → column 1 · Description → column 2 · Amount → column 3</div>
              <div>{csvRows.length} rows ready · {duplicateCsvCount} duplicate-looking rows</div>
            </div>
            <textarea
              className="min-h-28 w-full rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              data-testid="csv-text"
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
            />
            <Button className="mt-3" data-testid="csv-import" variant="outline" onClick={importCsv} disabled={pending || !defaultBankAccountId || !defaultCategoryId}>
              <Download className="size-4" />
              Import CSV
            </Button>
          </div>
        </aside>
      </section>
    </div>
  );
}
