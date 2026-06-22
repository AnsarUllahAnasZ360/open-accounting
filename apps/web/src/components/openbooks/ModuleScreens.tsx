"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Archive,
  ArrowUpRight,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Download,
  FileUp,
  History,
  Paperclip,
  Pencil,
  Play,
  Plus,
  Printer,
  ReceiptText,
  Search,
  SlidersHorizontal,
  Sparkles,
  ToggleLeft,
  Users,
  UserPlus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Amount, AgingMiniBar, BarChart, CategoryChip, EmptyState, formatMinorMoney } from "@/components/openbooks/primitives";
import { ContactsScreen } from "@/components/openbooks/ContactsScreen";
import {
  type BillRow,
  type EmployeeRow,
  type InvoiceRow,
  type ModuleOverview,
  statusLabel,
} from "@/components/openbooks/module-helpers";
import {
  AiInsightBadge,
  AttentionState,
  DateRangeControl,
  dateRangeValueToISO,
  DetailSheet,
  EvidenceUpload,
  ExportMenu,
  FilterBar,
  type FacetValue,
  type DateRangeValue,
  OpenBooksDataTable,
  type ColumnDef,
  PageActionBar,
  WorkbenchPage,
  InsightBanner,
  InsightBannerExplain,
  buildPageInsight,
} from "@/components/openbooks/workbench";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlaidConnectionPanel } from "@/components/openbooks/PlaidConnectionPanel";
import { StripeConnectionPanel } from "@/components/openbooks/StripeConnectionPanel";
import { useActiveEntity } from "@/lib/openbooks/active-entity";
import { todayIso } from "@/lib/openbooks/today";
import { aiAutonomyOptions, frontendAiStatus, type AiAutonomyMode } from "@/lib/openbooks/ai";
import { cn } from "@/lib/utils";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { api } from "../../../../../convex/_generated/api";

export function useModuleOverview() {
  const { activeEntity } = useActiveEntity();
  return useQuery(
    api.moduleViews.overview,
    activeEntity.id ? { entityId: activeEntity.id as Id<"entities"> } : {},
  ) as ModuleOverview | undefined;
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground shadow-xs">
      Loading {label}...
    </section>
  );
}

function NoEntityState() {
  return (
    <EmptyState
      icon={Building2}
      title="No business entity yet"
      description="Seed demo data or create a business before opening the module screens."
    />
  );
}

function statusChip(status: string) {
  return <Badge variant="outline" className="capitalize">{statusLabel(status)}</Badge>;
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function moneyInputToMinor(value: string) {
  const normalized = value.trim().replace(/[$,]/g, "");
  if (!normalized) return undefined;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return undefined;
  return Math.round(amount * 100);
}

function aiBatchStatusLabel(status: "completed" | "partial" | "degraded") {
  if (status === "completed") return "Completed";
  if (status === "partial") return "Partial";
  return "Degraded";
}

function ModuleIntro({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-xs md:flex-row md:items-center md:justify-between">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </section>
  );
}

export function InvoicesScreen() {
  const data = useModuleOverview();
  const [status, setStatus] = useState("all");

  if (data === undefined) return <LoadingBlock label="invoices" />;
  if (!data.entity) return <NoEntityState />;

  const rows = data.invoices.rows.filter((invoice) => status === "all" || invoice.status === status);

  return (
    <div className="space-y-5" data-testid="m6-invoices-screen">
      <ModuleIntro
        title="Invoices and money owed"
        description="Invoices show the A/R pipeline, open balances, and aging. Stripe sending remains an M8 integration, so this slice exposes draft/manual recording affordances without calling Stripe."
        action={
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="size-4" />
                New invoice
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invoice composer</DialogTitle>
                <DialogDescription>
                  Save draft and manual invoice recording are ready for integration. Send via Stripe is intentionally blocked until the M8 Stripe flow is connected.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3">
                <Label>Customer</Label>
                <Input placeholder="Choose or create customer" />
                <Label>Line item</Label>
                <Input placeholder="Service description" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input placeholder="Qty" />
                  <Input placeholder="Rate" />
                </div>
                <Button disabled>Save draft after AppScreen wiring</Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="shadow-xs">
          <CardHeader className="space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <CardTitle className="text-base">Status pipeline</CardTitle>
              <div className="flex flex-wrap gap-2">
                {["all", "draft", "open", "paid", "overdue", "void"].map((item) => (
                  <Button key={item} size="sm" variant={status === item ? "default" : "outline"} onClick={() => setStatus(item)} className="capitalize">
                    {item}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <InvoiceTable rows={rows} currency={data.entity.currency} />
          </CardContent>
        </Card>

        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle className="text-base">Receivables aging</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <AgingMiniBar
              current={data.invoices.aging.currentMinor}
              days30={data.invoices.aging.days30Minor}
              days60={data.invoices.aging.days60Minor}
              days90={data.invoices.aging.days90Minor}
            />
            <AgingMatrix bucket={data.invoices.aging} currency={data.entity.currency} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function InvoiceTable({ rows, currency }: { rows: InvoiceRow[]; currency: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Customer</TableHead>
          <TableHead>Due</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Balance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((invoice) => (
          <TableRow key={invoice.id} data-testid="invoice-row">
            <TableCell className="font-medium">{invoice.number}</TableCell>
            <TableCell>{invoice.customerName}</TableCell>
            <TableCell className="money-figures">{invoice.dueDate}</TableCell>
            <TableCell>{statusChip(invoice.status)}</TableCell>
            <TableCell className="text-right">
              <Amount amountMinor={invoice.balanceMinor} currency={currency} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AgingMatrix({ bucket, currency }: { bucket: ModuleOverview["invoices"]["aging"]; currency: string }) {
  const rows = [
    ["0-30", bucket.currentMinor],
    ["31-60", bucket.days30Minor],
    ["61-90", bucket.days60Minor],
    ["90+", bucket.days90Minor],
  ] as const;
  return (
    <div className="divide-y rounded-lg border">
      {rows.map(([label, amount]) => (
        <div key={label} className="flex items-center justify-between px-3 py-2 text-sm">
          <span className="text-muted-foreground">{label}</span>
          <Amount amountMinor={amount} currency={currency} />
        </div>
      ))}
    </div>
  );
}

export function BillsScreen() {
  const data = useModuleOverview();
  const router = useRouter();
  const search = "";
  const [range, setRange] = useState<DateRangeValue>({ preset: "last-3-months" });
  const [facets, setFacets] = useState<FacetValue>({});
  const [evidenceMissingOnly, setEvidenceMissingOnly] = useState(false);
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  // The bill whose Mark-paid match picker is open (C5 settlement flow).
  const [payBill, setPayBill] = useState<BillRow | null>(null);

  if (data === undefined) return <LoadingBlock label="bills" />;
  if (!data.entity) return <NoEntityState />;
  const entity = data.entity;
  const currency = entity.currency;

  // Flatten the server's due-window groups back into one ordered list; the
  // workbench presents a single Accounts-Payable table, not four Cards.
  const allBills = data.bills.groups.flatMap((group) => group.rows);

  // Default sort: overdue -> due-soon -> later -> paid, then by due date.
  const statusRank = (bill: BillRow) => {
    if (bill.status === "paid") return 3;
    if (bill.isOverdue) return 0;
    if (bill.isDueSoon) return 1;
    return 2;
  };
  const sortedBills = [...allBills].sort(
    (a, b) => statusRank(a) - statusRank(b) || a.dueDate.localeCompare(b.dueDate) || b.createdAt - a.createdAt,
  );

  const term = search.trim().toLowerCase();
  const vendorFacet = facets.vendor;
  // Anchor all bill-date windows on the real server/browser clock (E8-T2 / RC6),
  // not a frozen demo date. `dateRangeValueToISO` already resolves preset windows
  // (including last-3-months) so `to` is the live "today" — no special-case override.
  const rangeBounds = dateRangeValueToISO(range, todayIso());
  const filteredBills = sortedBills.filter((bill) => {
    if (bill.dueDate < rangeBounds.from || bill.dueDate > rangeBounds.to) return false;
    if (facets.status === "open" && bill.status !== "open") return false;
    if (facets.status === "overdue" && !bill.isOverdue) return false;
    if (facets.status === "due-soon" && !bill.isDueSoon) return false;
    if (facets.status === "paid" && bill.status !== "paid") return false;
    if (facets.source && bill.source !== facets.source) return false;
    if (vendorFacet && bill.vendorName !== vendorFacet) return false;
    if (evidenceMissingOnly && bill.hasEvidence) return false;
    if (term && !bill.vendorName.toLowerCase().includes(term) && !(bill.category ?? "").toLowerCase().includes(term)) {
      return false;
    }
    return true;
  });

  const selectedBill = allBills.find((bill) => bill.id === selectedBillId) ?? null;

  const vendorOptions = [...new Set(allBills.map((bill) => bill.vendorName))]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ value: name, label: name }));

  return (
    <div className="flex w-full flex-col gap-5" data-testid="m6-bills-screen">
      <div className="flex items-center justify-end">
        <PageActionBar primary={undefined}>
          <ExportMenu
            formats={["csv"]}
            filename="bills"
            onExport={() => exportBillsCsv(filteredBills, currency)}
          />
          <UploadBillModal entityId={entity.id as Id<"entities">} />
          <AddBillModal entityId={entity.id as Id<"entities">} />
        </PageActionBar>
      </div>

      <div className="flex flex-col gap-4">
        <FilterBar
          facets={[
            {
              key: "status",
              label: "Status",
              options: [
                { value: "open", label: "Open" },
                { value: "overdue", label: "Overdue" },
                { value: "due-soon", label: "Due soon" },
                { value: "paid", label: "Paid" },
              ],
            },
            {
              key: "source",
              label: "Source",
              options: [
                { value: "manual", label: "Manual" },
                { value: "pdf", label: "PDF" },
              ],
            },
          ]}
          value={facets}
          onChange={setFacets}
          onClearAll={() => {
            setFacets({});
            setEvidenceMissingOnly(false);
            setRange({ preset: "last-3-months" });
          }}
        >
          <DateRangeControl value={range} onChange={setRange} />
          {vendorOptions.length > 0 ? (
            <Select
              value={vendorFacet ?? "__all__"}
              onValueChange={(value) => setFacets({ ...facets, vendor: value === "__all__" ? undefined : value })}
            >
              <SelectTrigger size="sm" className="w-[160px]">
                <SelectValue placeholder="All vendors" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="__all__">All vendors</SelectItem>
                  {vendorOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : null}
          <Button
            variant={evidenceMissingOnly ? "secondary" : "outline"}
            size="sm"
            onClick={() => setEvidenceMissingOnly((value) => !value)}
            aria-pressed={evidenceMissingOnly}
          >
            <Paperclip data-icon="inline-start" />
            Evidence: missing
          </Button>
        </FilterBar>

        <BillsTable
          rows={filteredBills}
          currency={currency}
          onSelectRow={setSelectedBillId}
          onMarkPaid={setPayBill}
        />
      </div>

      <BillDetailSheet
        bill={selectedBill}
        open={selectedBillId != null}
        currency={currency}
        onOpenChange={(open) => setSelectedBillId(open ? selectedBillId : null)}
        onMarkPaid={setPayBill}
        onViewTransaction={(txnId) => router.push(`/transactions?focus=${txnId}`)}
      />

      {payBill ? (
        <BillMatchPicker
          billId={payBill.id as Id<"bills">}
          vendorName={payBill.vendorName}
          onClose={() => setPayBill(null)}
          onSettled={() => setSelectedBillId(null)}
        />
      ) : null}
    </div>
  );
}

export function dueLabel(bill: BillRow) {
  if (bill.status === "paid") return "Paid";
  const days = bill.daysUntilDue;
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  return `in ${days}d`;
}

function BillsTable({
  rows,
  currency,
  onSelectRow,
  onMarkPaid,
}: {
  rows: BillRow[];
  currency: string;
  onSelectRow: (id: string) => void;
  onMarkPaid: (bill: BillRow) => void;
}) {
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
          {dueLabel(row)}
        </span>
      ),
    },
    {
      key: "category",
      header: "Category",
      priority: 2,
      cell: (row) => <span className="text-xs text-muted-foreground">{row.category ?? "Uncategorized"}</span>,
    },
    {
      key: "evidence",
      header: "Evidence",
      priority: 1,
      cell: (row) =>
        row.hasEvidence ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Paperclip className="size-3.5" aria-hidden="true" />
            Attached
          </span>
        ) : row.status === "open" ? (
          <AttentionState state="missing-evidence" size="sm" />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "payment",
      header: "Payment",
      priority: 2,
      cell: (row) => {
        if (row.paymentMatch === "matched") {
          return <span className="text-xs text-muted-foreground">Matched</span>;
        }
        if (row.paymentMatch === "scheduled") {
          return (
            <span data-testid="bill-schedule-expected-cell" className="inline-flex items-center gap-1.5 text-xs text-info">
              <Clock className="size-3.5" aria-hidden="true" />
              Expected
            </span>
          );
        }
        return <span className="text-xs text-muted-foreground">—</span>;
      },
    },
    {
      key: "source",
      header: "Source",
      priority: 2,
      cell: (row) => (
        <Badge variant="outline" className="capitalize">
          {row.source === "pdf" ? "PDF" : "Manual"}
        </Badge>
      ),
    },
    {
      key: "confidence",
      header: "AI",
      align: "right",
      priority: 1,
      cell: (row) =>
        row.extractionConfidence != null ? (
          <span className="inline-flex justify-end" onClick={(event) => event.stopPropagation()}>
            <AiInsightBadge
              variant="ring"
              confidence={row.extractionConfidence}
              reasoning={row.extractionNotes ?? "Fields read from the attached document."}
              decidedBy="Document extraction"
            />
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      mono: true,
      mobileTrailing: true,
      sortable: true,
      sortValue: (row) => row.totalMinor,
      cell: (row) => (
        <span data-testid="bill-amount-cell">
          <Amount amountMinor={row.totalMinor} currency={row.currency || currency} />
        </span>
      ),
    },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (row) =>
        row.status === "open" ? (
          <span onClick={(event) => event.stopPropagation()}>
            <Button size="sm" variant="outline" data-testid="bill-mark-paid" onClick={() => onMarkPaid(row)}>
              <CheckCircle2 data-icon="inline-start" />
              Mark paid
            </Button>
          </span>
        ) : row.status === "paid" ? (
          <Badge variant="secondary" className="bg-ai-surface text-ai">
            <CheckCircle2 data-icon="inline-start" aria-hidden="true" />
            Paid
          </Badge>
        ) : (
          <span />
        ),
    },
  ];

  return (
    <OpenBooksDataTable<BillRow>
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      onRowClick={(row) => onSelectRow(row.id)}
      attention={(row) => (row.attention ? <AttentionState state={row.attention} size="sm" iconOnly /> : null)}
      rowAttributes={(row) => ({ "data-testid": "bill-row", "data-bill-id": row.id })}
      empty={
        <EmptyState
          icon={ReceiptText}
          title="No bills in this view"
          description="Add a bill or upload a PDF and AI reads off the vendor, amount, and due date."
        />
      }
    />
  );
}

export function BillDetailSheet({
  bill,
  open,
  currency,
  onOpenChange,
  onMarkPaid,
  onViewTransaction,
}: {
  bill: BillRow | null;
  open: boolean;
  currency: string;
  onOpenChange: (open: boolean) => void;
  onMarkPaid: (bill: BillRow) => void;
  onViewTransaction: (txnId: string) => void;
}) {
  if (!bill) return null;

  const attentionNode = bill.attention ? <AttentionState state={bill.attention} /> : null;

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={bill.vendorName}
      subtitle={
        <span className="money-figures">
          {formatMinorMoney(bill.totalMinor, { currency: bill.currency || currency })} · {statusLabel(bill.status)}
        </span>
      }
      attention={attentionNode}
      footer={
        bill.status === "open" ? (
          <Button size="sm" data-testid="bill-detail-mark-paid" onClick={() => onMarkPaid(bill)}>
            <CheckCircle2 data-icon="inline-start" />
            Mark paid &amp; match
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        {/* Evidence preview — attach if missing. */}
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Evidence</h3>
          <EvidenceUpload
            target={{ kind: "bill", id: bill.id }}
            document={
              bill.document
                ? {
                    id: bill.document.id,
                    vendor: bill.document.vendor,
                    date: bill.document.date,
                    totalMinor: bill.document.totalMinor,
                    currency: bill.currency || currency,
                    fileName: bill.document.fileName,
                    status: bill.document.status,
                    extractionConfidence: bill.extractionConfidence ?? undefined,
                    extractionNotes: bill.extractionNotes ?? undefined,
                    matched: bill.document.status === "matched",
                  }
                : null
            }
          />
        </section>

        {/* Extracted fields with per-field AI confidence. */}
        {bill.extractionConfidence != null ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Extracted fields</h3>
            <AiInsightBadge
              variant="inline"
              confidence={bill.extractionConfidence}
              reasoning={bill.extractionNotes ?? "Vendor, date, and total read from the attached document."}
              decidedBy={bill.extractionSource ?? "Document extraction"}
            />
            <dl className="flex flex-col gap-1.5 text-sm">
              <DetailRow label="Vendor" value={bill.vendorName} confident={(bill.extractionConfidence ?? 0) >= 0.9} />
              <DetailRow
                label="Total"
                value={formatMinorMoney(bill.totalMinor, { currency: bill.currency || currency })}
                mono
                confident={(bill.extractionConfidence ?? 0) >= 0.9}
              />
              <DetailRow label="Due date" value={bill.dueDate} mono confident={(bill.extractionConfidence ?? 0) >= 0.9} />
            </dl>
          </section>
        ) : null}

        {/* Payment schedule + matched bank txn. */}
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment</h3>
          <dl className="flex flex-col gap-1.5 text-sm">
            <DetailRow label="Status" value={statusLabel(bill.status)} />
            <DetailRow label="Match" value={bill.paymentMatch === "matched" ? "Matched to bank payment" : bill.paymentMatch === "scheduled" ? "Expected payment scheduled" : "Awaiting settlement"} />
            <DetailRow label="Due" value={dueLabel(bill)} mono />
          </dl>
          {bill.status === "paid" && bill.matchedTransactionId ? (
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => onViewTransaction(bill.matchedTransactionId!)}
            >
              <ArrowUpRight data-icon="inline-start" />
              View the matched bank transaction
            </Button>
          ) : null}
        </section>

        {/* Ledger impact (read-only — AI proposes, the ledger posts). */}
        {bill.ledgerLines.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ledger impact</h3>
            <div className="rounded-[14px] ring-1 ring-foreground/10">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bill.ledgerLines.map((line, index) => (
                    <TableRow key={`${line.accountNumber}-${index}`}>
                      <TableCell className="text-sm">{line.account}</TableCell>
                      <TableCell className="text-right money-figures text-sm">
                        {line.debitMinor > 0 ? formatMinorMoney(line.debitMinor, { currency: line.currency }) : "—"}
                      </TableCell>
                      <TableCell className="text-right money-figures text-sm">
                        {line.creditMinor > 0 ? formatMinorMoney(line.creditMinor, { currency: line.currency }) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              Posted journal lines are immutable. Corrections reverse and repost — the client never writes the ledger.
            </p>
          </section>
        ) : null}
      </div>
    </DetailSheet>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
  confident,
}: {
  label: string;
  value: string;
  mono?: boolean;
  confident?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          mono && "money-figures",
          // Per-field AI confidence: a quiet green underline when confident, a
          // warning underline when the model is unsure. Never red.
          confident === true && "underline decoration-ai decoration-2 underline-offset-4",
          confident === false && "underline decoration-warning decoration-2 underline-offset-4",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function exportBillsCsv(rows: BillRow[], currency: string) {
  const header = ["Vendor", "Due date", "Status", "Category", "Source", "Evidence", "Amount", "Currency"];
  const lines = rows.map((row) => [
    row.vendorName,
    row.dueDate,
    row.status,
    row.category ?? "Uncategorized",
    row.source,
    row.hasEvidence ? "attached" : "missing",
    (row.totalMinor / 100).toFixed(2),
    row.currency || currency,
  ]);
  const csv = [header, ...lines]
    .map((cells) => cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  if (typeof document === "undefined") return;
  downloadCsv("bills.csv", csv);
}

export function BillMatchPicker({
  billId,
  vendorName,
  onClose,
  onSettled,
}: {
  billId: Id<"bills">;
  vendorName: string;
  onClose: () => void;
  onSettled?: () => void;
}) {
  const picker = useQuery(api.bills.matchCandidates, { billId });
  const markPaid = useMutation(api.bills.markPaid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The bank transaction the owner picked; settling routes through an
  // AlertDialog confirm before any ledger post happens.
  const [confirmTxnId, setConfirmTxnId] = useState<string | null>(null);

  async function settle(transactionId?: string) {
    setBusy(true);
    setError("");
    try {
      await markPaid({
        billId,
        transactionId: transactionId ? (transactionId as Id<"transactions">) : undefined,
        scheduleExpected: transactionId ? undefined : true,
      });
      onSettled?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not settle the bill.");
    } finally {
      setBusy(false);
      setConfirmTxnId(null);
    }
  }

  const confirmCandidate = confirmTxnId ? picker?.candidates.find((c) => c.id === confirmTxnId) ?? null : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="bill-match-picker">
        <DialogHeader>
          <DialogTitle>Match to a bank transaction</DialogTitle>
          <DialogDescription>
            {picker
              ? `Paying ${picker.vendorName} · ${formatMinorMoney(picker.totalMinor, { currency: picker.currency })} — pick the bank transaction that settles it.`
              : `Paying ${vendorName} — loading candidates…`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {picker?.candidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              data-testid="bill-match-candidate"
              disabled={busy}
              onClick={() => setConfirmTxnId(candidate.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-[11px] p-3 text-left ring-1 ring-foreground/10 transition hover:ring-primary/40",
                candidate.suggested && "bg-ai-surface ring-ai/30",
              )}
            >
              <span className="inline-flex size-6 items-center justify-center rounded-md bg-foreground text-[9px] font-bold text-background">
                {candidate.merchant.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{candidate.merchant}</span>
                <span className="money-figures block text-[11.5px] text-muted-foreground">{candidate.date}</span>
              </span>
              <Amount amountMinor={candidate.amountMinor} currency={candidate.currency} tone="expense" />
              {candidate.suggested ? (
                <Badge variant="secondary" className="bg-ai-surface text-ai">
                  <Sparkles data-icon="inline-start" aria-hidden="true" />
                  best match
                </Badge>
              ) : null}
            </button>
          ))}
          {picker && picker.candidates.length === 0 ? (
            <p className="rounded-[11px] p-3 text-sm text-muted-foreground ring-1 ring-dashed ring-foreground/15">
              No matching bank transaction yet. Schedule an expected match and it settles when the payment arrives.
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-negative" data-testid="bill-match-error">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="ghost"
            size="sm"
            data-testid="bill-schedule-expected"
            disabled={busy}
            onClick={() => void settle()}
          >
            No match yet — expect one
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Confirm settling against a chosen bank transaction (posts AP -> bank). */}
      <AlertDialog open={confirmTxnId != null} onOpenChange={(open) => !open && setConfirmTxnId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this bill paid?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmCandidate
                ? `Settling against ${confirmCandidate.merchant} clears the payable and consumes that bank transaction. This posts to the ledger and can only be undone by a reversal.`
                : "This settles the bill against the chosen bank transaction."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => confirmTxnId && void settle(confirmTxnId)}>
              Mark paid
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </Dialog>
  );
}

/**
 * Upload-bill chooser: the two-path entry point. A PDF goes through AI
 * extract-and-confirm; the manual path defers to AddBillModal. Replaces the old
 * manual-only upload panel while keeping the receipt/PDF extraction backend.
 */
export function UploadBillModal({
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
  const generateReceiptUploadUrl = useMutation(api.receipts.generateUploadUrl);
  const recordReceiptUpload = useMutation(api.receipts.recordUpload);
  const extractReceiptWithBedrock = useAction(api.receipts.extractWithBedrock);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [uploading, setUploading] = useState(false);

  async function uploadBillPdf(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const uploadUrl = await generateReceiptUploadUrl({ entityId });
      const uploadResult = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!uploadResult.ok) {
        throw new Error("Upload failed before it reached storage.");
      }
      const { storageId } = (await uploadResult.json()) as { storageId: string };
      const result = await recordReceiptUpload({
        entityId,
        kind: "bill",
        storageId: storageId as Id<"_storage">,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
      });
      const extraction = await extractReceiptWithBedrock({ documentId: result.documentId });
      const vendor = "vendor" in extraction ? extraction.vendor : "the bill";
      toast.success(`Read ${vendor} from ${file.name}. Review and confirm the bill.`);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read that file.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {hideTrigger ? null : (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <FileUp data-icon="inline-start" />
            Upload bill
          </Button>
        </DialogTrigger>
      )}
      <DialogContent data-testid="upload-bill-modal">
        <DialogHeader>
          <DialogTitle>Add a bill</DialogTitle>
          <DialogDescription>
            Upload a bill PDF and AI reads off the vendor, amount, and due date for you to confirm — or type it in by hand.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-[14px] p-5 text-center ring-1 ring-foreground/10 transition hover:ring-ai/40",
              uploading && "pointer-events-none opacity-60",
            )}
          >
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-ai-surface text-ai">
              <Sparkles className="size-5" aria-hidden="true" />
            </span>
            <span className="text-sm font-medium">Upload a PDF</span>
            <span className="text-xs text-muted-foreground">AI extracts the fields; you confirm before it posts.</span>
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="sr-only"
              disabled={uploading}
              onChange={(event) => void uploadBillPdf(event.currentTarget.files)}
            />
            {uploading ? <span className="text-xs text-ai">Reading…</span> : null}
          </label>
          <div className="flex flex-col items-center gap-2 rounded-[14px] p-5 text-center ring-1 ring-foreground/10">
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Pencil className="size-5" aria-hidden="true" />
            </span>
            <span className="text-sm font-medium">Enter it by hand</span>
            <span className="text-xs text-muted-foreground">Type the vendor, amount, and due date.</span>
            <AddBillModal entityId={entityId} triggerLabel="Enter manually" triggerVariant="outline" onCreated={() => setOpen(false)} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AddBillModal({
  entityId,
  triggerLabel = "Add bill",
  triggerVariant = "default",
  onCreated,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  entityId: Id<"entities">;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline";
  onCreated?: (vendorName: string) => void;
  /** Controlled-open (folds the trigger into the section AddMenu — E5.3). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const createBill = useMutation(api.bills.createBill);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [vendorName, setVendorName] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    const totalMinor = moneyInputToMinor(amount);
    if (!vendorName.trim()) {
      setError("Who do you owe?");
      return;
    }
    if (!totalMinor || totalMinor <= 0) {
      setError("Enter a positive amount.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      setError("Pick a due date.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const trimmedVendorName = vendorName.trim();
      await createBill({ entityId, vendorName: trimmedVendorName, totalMinor, dueDate });
      setOpen(false);
      setVendorName("");
      setAmount("");
      setDueDate("");
      toast.success(`Added ${trimmedVendorName} — it posts to Accounts Payable until you mark it paid.`);
      onCreated?.(trimmedVendorName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the bill.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {hideTrigger ? null : (
        <DialogTrigger asChild>
          <Button size="sm" variant={triggerVariant} data-testid="bills-add-bill">
            <Plus data-icon="inline-start" />
            {triggerLabel}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent data-testid="add-bill-modal">
        <DialogHeader>
          <DialogTitle>New bill</DialogTitle>
          <DialogDescription>
            Type it in below. To extract a bill from a PDF, use Upload bill instead.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-2">
            <Label htmlFor="bill-vendor">Vendor</Label>
            <Input
              id="bill-vendor"
              data-testid="bill-vendor"
              value={vendorName}
              onChange={(event) => setVendorName(event.target.value)}
              placeholder="Who do you owe?"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="bill-amount">Amount</Label>
              <Input
                id="bill-amount"
                data-testid="bill-amount"
                value={amount}
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value)}
                placeholder="$0.00"
                className="money-figures"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bill-due">Due date</Label>
              <Input
                id="bill-due"
                data-testid="bill-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
          </div>
          {error ? <p className="text-sm text-negative">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" data-testid="bill-create" disabled={busy} onClick={handleCreate}>
            {busy ? "Adding…" : "Add bill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Payroll period scope (header) — scopes the Runs list AND the Statements tab.
// ---------------------------------------------------------------------------

/** The current "YYYY-MM" from the real server/browser clock so the draft button
 *  always targets the present month on live, present-dated books (E8-T2 / RC6) —
 *  not a frozen demo date. */
function currentPayrollPeriod(): string {
  return todayIso().slice(0, 7);
}

function payrollPeriodLabel(period: string): string {
  const [year, month] = period.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const name = names[Number(month) - 1] ?? month;
  return `${name} ${year}`;
}

/** Quarter (1-4) for a "YYYY-MM" period. */
function periodQuarter(period: string): string {
  const [year, month] = period.split("-");
  return `${year}-Q${Math.floor((Number(month) - 1) / 3) + 1}`;
}

function payrollPeriodStart(period: string) {
  return `${period}-01`;
}

type PayrollScope = "all" | string; // "all" or a "YYYY-Qn" quarter key

export function PayrollScreen({ subsection = "runs" }: { subsection?: string }) {
  const data = useModuleOverview();
  const [openRunId, setOpenRunId] = useState<Id<"payrollRuns"> | null>(null);
  const [scope, setScope] = useState<PayrollScope>("all");
  const [range, setRange] = useState<DateRangeValue>({ preset: "last-3-months" });
  const [search, setSearch] = useState("");
  const [facets, setFacets] = useState<FacetValue>({});
  const startRun = useMutation(api.payroll.startRun);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("");

  if (data === undefined) return <LoadingBlock label="payroll" />;
  if (!data.entity) return <NoEntityState />;

  const baseCurrency = data.entity.currency;
  const entityId = data.entity.id as Id<"entities">;
  const runs = data.payroll.runs;

  // E10-T6 / E8-T5: the single Payroll page-insight — monthly run-rate (from
  // approved-run base totals) / active headcount / FX-exposure note / unmatched —
  // built from the SAME moduleViews.overview.payroll read-model this screen
  // already loaded. The server now computes `payroll.insight`; we pass it through
  // so the banner reflects ledger+run data, not roster face values.
  const payrollInsight = buildPageInsight("payroll", {
    entity: { currency: baseCurrency },
    payroll: {
      currencyTotals: data.payroll.currencyTotals.map((row) => ({
        currency: row.currency,
        totalMinor: row.baseMinor,
      })),
      unmatchedCount: data.payroll.unmatchedCount,
      runs: runs.map((run) => ({ headcount: run.headcount, period: run.period })),
      insight: data.payroll.insight,
    },
  });

  const draftPeriod = currentPayrollPeriod();
  const hasDraftPeriodRun = runs.some((run) => run.period === draftPeriod);
  const activePayrollView: "people" | "runs" | "statements" =
    subsection === "people" ? "people" : subsection === "statements" ? "statements" : "runs";

  // Quarters present in the data, newest first, for the scope selector.
  const quarters = [...new Set(runs.map((run) => periodQuarter(run.period)))].sort((a, b) =>
    b.localeCompare(a),
  );
  const payrollRange = dateRangeValueToISO(range, todayIso());
  const payrollTerm = search.trim().toLowerCase();
  const scopedRuns = runs.filter((run) => {
    if (scope !== "all" && periodQuarter(run.period) !== scope) return false;
    if (facets.status && run.status !== facets.status) return false;
    if (facets.source && run.source !== facets.source) return false;
    if (facets.currency && !run.currencyTotals.some((total) => total.currency === facets.currency)) return false;
    const periodStart = payrollPeriodStart(run.period);
    if (periodStart < payrollRange.from || periodStart > payrollRange.to) return false;
    if (!payrollTerm) return true;
    const searchable = [
      payrollPeriodLabel(run.period),
      run.period,
      run.status,
      run.source,
      ...run.currencyTotals.map((total) => total.currency),
    ].join(" ").toLowerCase();
    return searchable.includes(payrollTerm);
  });
  const filteredEmployees = data.payroll.employees.filter((employee) => {
    if (facets.currency && employee.currency !== facets.currency) return false;
    if (!payrollTerm) return true;
    return [
      employee.name,
      employee.country,
      employee.currency,
      employee.fxDisplay,
      employee.active ? "active" : "inactive",
    ].join(" ").toLowerCase().includes(payrollTerm);
  });
  const filteredStatementRows = data.payroll.statementRows.filter((row) => {
    if (facets.currency && row.currency !== facets.currency) return false;
    if (!payrollTerm) return true;
    return [
      row.employeeName,
      row.country,
      row.currency,
      row.fxDisplay,
    ].join(" ").toLowerCase().includes(payrollTerm);
  });
  const payrollFacets = [
    {
      key: "status",
      label: "Status",
      options: [
        { value: "__all__", label: "All" },
        ...[...new Set(runs.map((run) => run.status))].sort().map((status) => ({
          value: status,
          label: statusLabel(status),
        })),
      ],
    },
    {
      key: "source",
      label: "Source",
      options: [
        { value: "__all__", label: "All" },
        ...[...new Set(runs.map((run) => run.source))].sort().map((source) => ({
          value: source,
          label: source === "auto-draft" ? "Auto draft" : statusLabel(source),
        })),
      ],
    },
    {
      key: "currency",
      label: "Currency",
      options: [
        { value: "__all__", label: "All" },
        ...[...new Set(data.payroll.employees.map((employee) => employee.currency))].sort().map((currency) => ({
          value: currency,
          label: currency,
        })),
      ],
    },
  ];

  async function runDraft() {
    setStarting(true);
    setMessage("");
    try {
      const result = await startRun({ entityId, period: draftPeriod });
      setOpenRunId(result.runId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start the run.");
    } finally {
      setStarting(false);
    }
  }

  const scopeControl = (
    <Select value={scope} onValueChange={(value) => setScope(value)}>
      <SelectTrigger size="sm" className="w-[160px]">
        <CalendarClock data-icon="inline-start" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="all">All periods</SelectItem>
          {quarters.map((quarter) => (
            <SelectItem key={quarter} value={quarter}>
              {quarter.replace("-Q", " · Q")}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );

  return (
    <div data-testid="m6-payroll-screen">
    <WorkbenchPage
      eyebrow={data.entity.name}
      title="Payroll"
      description="A register, not a processor — you pay people your way, the books stay right. Open a run to review the grid, approve it, then mark people paid."
      hideHeader
      actions={
        <PageActionBar
          primary={
            !hasDraftPeriodRun
              ? { label: `Run payroll · ${payrollPeriodLabel(draftPeriod).split(" ")[0]}`, icon: Play, onClick: () => void runDraft(), disabled: starting }
              : undefined
          }
        >
        </PageActionBar>
      }
    >
      {payrollInsight ? (
        <InsightBanner
          page="payroll"
          insight={payrollInsight}
          explainSlot={<InsightBannerExplain section="payroll" entityId={entityId} />}
        />
      ) : null}
      {message ? <p className="text-sm text-negative" data-testid="payroll-error">{message}</p> : null}

      <FilterBar
        facets={payrollFacets}
        value={facets}
        onChange={setFacets}
        onClearAll={() => {
          setSearch("");
          setFacets({});
          setRange({ preset: "last-3-months" });
          setScope("all");
        }}
      >
        <DateRangeControl value={range} onChange={setRange} compact />
        {scopeControl}
      </FilterBar>

      {activePayrollView === "people" ? <PayrollEmployees data={data} rows={filteredEmployees} /> : null}
      {activePayrollView === "runs" ? (
        <PayrollRuns
          data={data}
          runs={scopedRuns}
          onOpenRun={setOpenRunId}
        />
      ) : null}
      {activePayrollView === "statements" ? (
        <PayrollStatement data={data} runs={scopedRuns} rows={filteredStatementRows} />
      ) : null}

      <PayrollRunDetailSheet
        runId={openRunId}
        baseCurrency={baseCurrency}
        onOpenChange={(open) => {
          if (!open) setOpenRunId(null);
        }}
      />
    </WorkbenchPage>
    </div>
  );
}

/** Semantic payroll status chip: Draft neutral, Approved info-blue, Paid green. */
function PayrollStatusChip({ status }: { status: string }) {
  if (status === "paid") {
    return (
      <Badge variant="secondary" className="bg-primary/10 text-primary">
        <Check data-icon="inline-start" aria-hidden="true" />
        Paid
      </Badge>
    );
  }
  if (status === "approved") {
    return (
      <Badge variant="secondary" className="bg-info-surface text-info">
        Approved
      </Badge>
    );
  }
  return <Badge variant="outline">Draft</Badge>;
}

/** Provenance chip: an auto-drafted run reads as "Auto-draft · needs review". */
function PayrollSourceChip({ source, status }: { source: string; status: string }) {
  if (source === "auto-draft" && status === "draft") {
    return (
      <Badge variant="secondary" className="bg-ai-surface text-ai">
        <Sparkles data-icon="inline-start" aria-hidden="true" />
        Auto-draft · needs review
      </Badge>
    );
  }
  return <Badge variant="outline" className="text-muted-foreground">Manual</Badge>;
}

/**
 * Pay-schedule control (E10-T5). Reads + writes via the existing Convex
 * functions (paySchedule / setPaySchedule). Auto-draft NEVER posts — approval
 * stays a manual human step — and only MONTHLY auto-draft is wired for v1
 * (decisions.md Q54); a `semimonthly` cadence is labelled "manual second run".
 */
function PayScheduleControl({ entityId }: { entityId: Id<"entities"> }) {
  const schedule = useQuery(api.payroll.paySchedule, { entityId });
  const setPaySchedule = useMutation(api.payroll.setPaySchedule);
  const [saving, setSaving] = useState(false);

  if (schedule === undefined) {
    return <Card className="shadow-xs"><CardContent className="py-4 text-sm text-muted-foreground">Loading schedule…</CardContent></Card>;
  }
  if (schedule === null) return null;

  const cadence = schedule.cadence;
  const enabled = schedule.enabled;

  async function update(next: { enabled?: boolean; cadence?: "monthly" | "semimonthly" }) {
    setSaving(true);
    try {
      await setPaySchedule({
        entityId,
        enabled: next.enabled ?? enabled,
        cadence: next.cadence ?? cadence,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="shadow-xs" data-testid="payroll-schedule-control">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Auto-draft schedule</CardTitle>
        <CardDescription>
          When on, OpenBooks drafts each period&apos;s run from your active roster. It never approves or pays — you
          still approve every run by hand.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="payroll-auto-draft" className="text-sm font-medium">
              Auto-draft
            </Label>
            <p className="text-xs text-muted-foreground" data-testid="payroll-schedule-state">
              {enabled ? "On — drafts only, approval stays manual" : "Off — draft runs manually"}
            </p>
          </div>
          <Switch
            id="payroll-auto-draft"
            data-testid="payroll-auto-draft-toggle"
            checked={enabled}
            disabled={saving}
            onCheckedChange={(checked) => void update({ enabled: checked })}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label className="text-sm font-medium">Cadence</Label>
            <p className="text-xs text-muted-foreground">
              {cadence === "semimonthly"
                ? "Semimonthly — first run is auto-drafted; the second is a manual run for v1."
                : "Monthly — one draft run per month."}
            </p>
          </div>
          <Select
            value={cadence}
            disabled={saving}
            onValueChange={(value) => void update({ cadence: value as "monthly" | "semimonthly" })}
          >
            <SelectTrigger size="sm" className="w-[170px]" data-testid="payroll-cadence-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="semimonthly">Semimonthly (manual 2nd)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

function PayrollEmployees({ data, rows }: { data: ModuleOverview; rows: EmployeeRow[] }) {
  const baseCurrency = data.entity?.currency;
  const entityId = data.entity?.id as Id<"entities"> | undefined;
  const columns: ColumnDef<EmployeeRow>[] = [
    {
      key: "name",
      header: "Name",
      mobilePrimary: true,
      cell: (row) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{row.name}</div>
          <div className="text-xs text-muted-foreground">{row.active ? "Active" : "Inactive"}</div>
        </div>
      ),
    },
    { key: "country", header: "Country", priority: 1, cell: (row) => row.country },
    { key: "fx", header: "FX", priority: 2, cell: (row) => <span className="text-muted-foreground">{row.fxDisplay}</span> },
    {
      key: "local",
      header: "Local salary",
      align: "right",
      mono: true,
      sortValue: (row) => row.monthlySalaryMinor,
      cell: (row) => <Amount amountMinor={row.monthlySalaryMinor} currency={row.currency} />,
    },
    {
      key: "base",
      header: `${baseCurrency} base`,
      align: "right",
      mono: true,
      mobileTrailing: true,
      sortValue: (row) => row.baseAmountMinor,
      cell: (row) => <Amount amountMinor={row.baseAmountMinor} currency={baseCurrency} />,
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      {entityId ? <PayScheduleControl entityId={entityId} /> : null}
      <div className="flex items-center justify-end">
        <Button size="sm" variant="outline" disabled>
          <UserPlus data-icon="inline-start" />
          Add employee
        </Button>
      </div>
      <OpenBooksDataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        empty={<EmptyState icon={Users} title="No employees yet" description="Add your team to draft payroll runs from their salaries." />}
      />
    </div>
  );
}

function PayrollRuns({
  data,
  runs,
  onOpenRun,
}: {
  data: ModuleOverview;
  runs: ModuleOverview["payroll"]["runs"];
  onOpenRun: (id: Id<"payrollRuns">) => void;
}) {
  const baseCurrency = data.entity?.currency;
  type RunRow = ModuleOverview["payroll"]["runs"][number];
  const columns: ColumnDef<RunRow>[] = [
    {
      key: "period",
      header: "Period",
      mono: true,
      mobilePrimary: true,
      sortValue: (row) => row.period,
      cell: (row) => <span className="font-medium">{payrollPeriodLabel(row.period)}</span>,
    },
    {
      key: "source",
      header: "Source",
      priority: 1,
      cell: (row) => <PayrollSourceChip source={row.source} status={row.status} />,
    },
    { key: "people", header: "People", mono: true, align: "right", priority: 1, sortValue: (row) => row.headcount, cell: (row) => row.headcount },
    {
      key: "currencies",
      header: "By currency",
      priority: 2,
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.currencyTotals.map((total) => (
            <span key={total.currency} className="money-figures text-xs text-muted-foreground">
              <Amount amountMinor={total.localMinor} currency={total.currency} compact />
            </span>
          ))}
        </span>
      ),
    },
    { key: "status", header: "Status", cell: (row) => <PayrollStatusChip status={row.status} /> },
    {
      key: "base",
      header: `${baseCurrency} total`,
      align: "right",
      mono: true,
      mobileTrailing: true,
      sortValue: (row) => row.totalBaseMinor,
      cell: (row) => <Amount amountMinor={row.totalBaseMinor} currency={baseCurrency} />,
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      <OpenBooksDataTable
        columns={columns}
        rows={runs}
        getRowId={(row) => row.id}
        onRowClick={(row) => onOpenRun(row.id as Id<"payrollRuns">)}
        rowAttributes={() => ({ "data-testid": "payroll-run-row" })}
        empty={<EmptyState icon={CalendarClock} title="No runs in this period" description="Run payroll to draft this period's statement, or pick a different period." />}
      />
    </div>
  );
}

type RunDetail = NonNullable<FunctionReturnType<typeof api.payroll.runDetail>>;
type RunLineView = RunDetail["lines"][number];

/** Review -> Approve -> Mark paid stepper. lucide Check on completed steps. */
function PayrollStepper({ status }: { status: string }) {
  const steps = [
    { key: "review", label: "Review" },
    { key: "approve", label: "Approve" },
    { key: "paid", label: "Mark paid" },
  ];
  const activeIndex = status === "draft" ? 0 : status === "approved" ? 1 : 2;
  return (
    <ol className="flex items-center gap-2 text-xs">
      {steps.map((step, index) => {
        const done = index < activeIndex || status === "paid";
        const current = index === activeIndex && status !== "paid";
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex size-5 items-center justify-center rounded-full text-[10px] font-medium",
                done && "bg-primary/10 text-primary",
                current && "bg-info-surface text-info",
                !done && !current && "bg-muted text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3" aria-hidden="true" /> : index + 1}
            </span>
            <span className={cn(current ? "font-medium text-foreground" : "text-muted-foreground")}>{step.label}</span>
            {index < steps.length - 1 ? <span className="text-muted-foreground/40">›</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Run detail — CLOSED by default. Opens as a right Sheet (lg+) / bottom Drawer
 * (mobile) WITHOUT destroying the runs list or KPI strip. Holds the stepper, the
 * editable grid (card-per-row, never a horizontal-scroll table), and the
 * approve/mark-paid lifecycle. Approve is wrapped in an AlertDialog and posts the
 * single ledger entry through the EXISTING approveRun — never client-side.
 */
function PayrollRunDetailSheet({
  runId,
  baseCurrency,
  onOpenChange,
}: {
  runId: Id<"payrollRuns"> | null;
  baseCurrency: string;
  onOpenChange: (open: boolean) => void;
}) {
  const detail = useQuery(api.payroll.runDetail, runId ? { runId } : "skip");
  const backfill = useMutation(api.payroll.backfillRunLines);
  const updateLine = useMutation(api.payroll.updateRunLine);
  const approveRun = useMutation(api.payroll.approveRun);
  const markRunPaid = useMutation(api.payroll.markRunPaid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmApprove, setConfirmApprove] = useState(false);

  const open = runId !== null;

  async function withBusy(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <DetailSheet open={false} onOpenChange={onOpenChange} title="Payroll run" />;
  }
  if (detail === undefined) {
    return (
      <DetailSheet open onOpenChange={onOpenChange} title="Payroll run">
        <LoadingBlock label="run" />
      </DetailSheet>
    );
  }
  if (detail === null) {
    return (
      <DetailSheet open onOpenChange={onOpenChange} title="Payroll run">
        <EmptyState title="Run not found" />
      </DetailSheet>
    );
  }

  const isDraft = detail.run.status === "draft";
  const isApproved = detail.run.status === "approved";
  const isAutoDraft = detail.run.source === "auto-draft";

  const gridBody = (
    <div data-testid="payroll-run-detail" className="flex flex-col gap-3">
      {/* Editable grid as a card-per-row stack — readable on every width. */}
      <div className="flex flex-col gap-2">
        {detail.lines.map((line) => (
          <PayrollRunLineCard
            key={line.id}
            line={line}
            baseCurrency={baseCurrency}
            editable={detail.editable}
            onSave={(adjustmentMinor, fxRate) =>
              withBusy(() => updateLine({ lineId: line.id as Id<"payrollRunLines">, adjustmentMinor, fxRate }))
            }
          />
        ))}
      </div>
      <div className="flex flex-col gap-2 rounded-[14px] bg-muted/50 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground" data-testid="payroll-currency-totals">
          {detail.currencyTotals.map((row) => (
            <span key={row.currency}>
              <Amount amountMinor={row.localMinor} currency={row.currency} />
            </span>
          ))}
        </div>
        <div className="flex items-center justify-between border-t pt-2">
          <span className="text-muted-foreground">Total in {baseCurrency}</span>
          <span className="text-base font-semibold" data-testid="payroll-base-total">
            <Amount amountMinor={detail.baseTotalMinor} currency={baseCurrency} />
          </span>
        </div>
      </div>
    </div>
  );

  const footer = (
    <>
      {isDraft && !detail.periodLocked ? (
        <Button size="sm" onClick={() => setConfirmApprove(true)} disabled={busy} data-testid="payroll-approve">
          Approve run
        </Button>
      ) : null}
      {isApproved ? (
        <Button size="sm" onClick={() => withBusy(() => markRunPaid({ runId }))} disabled={busy} data-testid="payroll-mark-paid">
          Mark all paid
        </Button>
      ) : null}
      {!detail.materialized && detail.run.status === "paid" ? (
        <Button size="sm" variant="outline" onClick={() => withBusy(() => backfill({ runId }))} disabled={busy}>
          Load lines
        </Button>
      ) : null}
    </>
  );

  return (
    <>
      <DetailSheet
        open={open}
        onOpenChange={onOpenChange}
        title={
          <span className="flex items-center gap-2">
            {detail.run.periodLabel}
            <PayrollStatusChip status={detail.run.status} />
          </span>
        }
        subtitle={
          isAutoDraft && isDraft
            ? "Auto-drafted from active salaries — review, then approve to post."
            : "Review the grid, approve to post one ledger entry, then mark people paid."
        }
        attention={
          <>
            <PayrollStepper status={detail.run.status} />
            {detail.periodLocked ? <CategoryChip label="Period locked" /> : null}
            {isApproved ? (
              <div className="flex w-full items-start gap-2 rounded-[11px] bg-primary/5 px-3 py-2 text-sm text-primary" data-testid="payroll-approved-banner">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  Approved — recorded{" "}
                  {detail.currencyTotals.map((row, index) => (
                    <span key={row.currency}>
                      {index > 0 ? " + " : ""}
                      <Amount amountMinor={row.localMinor} currency={row.currency} />
                    </span>
                  ))}{" "}
                  as {detail.run.periodLabel} payroll expense. Lines settle as the bank payments arrive.
                </span>
              </div>
            ) : null}
            {detail.run.status === "paid" ? (
              <div className="flex w-full items-start gap-2 rounded-[11px] bg-primary/5 px-3 py-2 text-sm text-primary">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>Settled. FX differences between approval and settlement post automatically as a small gain/loss line.</span>
              </div>
            ) : null}
            {error ? <p className="w-full text-sm text-negative" data-testid="payroll-error">{error}</p> : null}
          </>
        }
        tabs={[
          { value: "grid", label: "Grid", content: gridBody },
          { value: "statement", label: "Statement", content: <PayrollRunStatement detail={detail} /> },
        ]}
        footer={footer}
      />

      <AlertDialog open={confirmApprove} onOpenChange={setConfirmApprove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve {detail.run.periodLabel} payroll?</AlertDialogTitle>
            <AlertDialogDescription>
              This posts one payroll-expense ledger entry of{" "}
              {formatMinorMoney(detail.baseTotalMinor, { currency: baseCurrency })} in {baseCurrency}. Posted entries are
              immutable — to correct a run you reverse and repost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmApprove(false);
                void withBusy(() => approveRun({ runId }));
              }}
            >
              Approve & post
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * One payroll line as a card (label/value stacks), not a horizontal-scroll table
 * row. Editable adjustment + FX use plain Inputs; the paid state is a shadcn
 * Checkbox routed through --primary instead of the old raw-hex checkbox.
 */
function PayrollRunLineCard({
  line,
  baseCurrency,
  editable,
  onSave,
}: {
  line: RunLineView;
  baseCurrency: string;
  editable: boolean;
  onSave: (adjustmentMinor: number, fxRate: string) => void;
}) {
  const [adjustment, setAdjustment] = useState(String(line.adjustmentMinor / 100));
  const [fxRate, setFxRate] = useState(line.fxDisplay === "—" ? "1" : line.fxDisplay);

  function commit() {
    const adjMinor = Math.round((Number(adjustment.replace(/[,$]/g, "")) || 0) * 100);
    onSave(adjMinor, fxRate);
  }

  return (
    <div data-testid="payroll-line-row" className="rounded-[14px] bg-card p-3 ring-1 ring-foreground/10 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{line.employeeName}</div>
          <div className="text-xs text-muted-foreground">{line.country} · {line.currency}</div>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox checked={line.paid} disabled aria-label={`${line.employeeName} paid`} />
          <span className="text-xs text-muted-foreground">{line.paid ? "Paid" : "Unpaid"}</span>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div className="flex flex-col">
          <dt className="text-xs text-muted-foreground">Base salary</dt>
          <dd className="money-figures"><Amount amountMinor={line.baseSalaryMinor} currency={line.currency} /></dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-muted-foreground">Adjustment</dt>
          <dd>
            {editable ? (
              <Input
                value={adjustment}
                onChange={(event) => setAdjustment(event.target.value)}
                onBlur={commit}
                inputMode="decimal"
                className="h-8 w-full text-right"
                data-testid="payroll-adjustment-input"
              />
            ) : (
              <span className="money-figures"><Amount amountMinor={line.adjustmentMinor} currency={line.currency} signed /></span>
            )}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-muted-foreground">Final</dt>
          <dd className="money-figures font-medium"><Amount amountMinor={line.finalLocalMinor} currency={line.currency} /></dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-muted-foreground">FX rate</dt>
          <dd>
            {editable && line.currency !== baseCurrency ? (
              <Input
                value={fxRate}
                onChange={(event) => setFxRate(event.target.value)}
                onBlur={commit}
                inputMode="decimal"
                className="h-8 w-full text-right"
                data-testid="payroll-fx-input"
              />
            ) : (
              <span className="money-figures text-muted-foreground">{line.fxDisplay}</span>
            )}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-muted-foreground">{baseCurrency} equiv</dt>
          <dd className="money-figures"><Amount amountMinor={line.baseEquivalentMinor} currency={baseCurrency} /></dd>
        </div>
      </dl>
    </div>
  );
}

function PayrollRunStatement({ detail }: { detail: RunDetail }) {
  const baseCurrency = detail.entity.currency;
  function exportCsv() {
    const rows = [
      ["group", "employee", "currency", "local_minor", "base_currency", "base_minor"],
      ...detail.statementGroups.flatMap((group) =>
        group.lines.map((line) => [group.key, line.employeeName, line.currency, String(line.finalLocalMinor), baseCurrency, String(line.baseEquivalentMinor)]),
      ),
    ];
    downloadCsv(
      `payroll-statement-${detail.run.period}.csv`,
      rows.map((row) => row.join(",")).join("\n"),
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          <Printer data-icon="inline-start" /> Print
        </Button>
        <Button size="sm" onClick={exportCsv} data-testid="payroll-statement-csv">
          <Download data-icon="inline-start" /> CSV
        </Button>
      </div>
      {detail.statementGroups.map((group) => (
        <div key={group.key} className="rounded-[14px] ring-1 ring-foreground/10">
          <div className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.key}
          </div>
          <div className="divide-y">
            {group.lines.map((line) => (
              <div key={line.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span>{line.employeeName}</span>
                <span className="flex gap-6">
                  <Amount amountMinor={line.finalLocalMinor} currency={line.currency} className="text-muted-foreground" />
                  <Amount amountMinor={line.baseEquivalentMinor} currency={baseCurrency} />
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm font-semibold">
            <span>Subtotal</span>
            <span className="flex gap-6">
              <Amount amountMinor={group.localMinor} currency={group.currency} />
              <Amount amountMinor={group.baseMinor} currency={baseCurrency} />
            </span>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between rounded-[14px] bg-primary/5 px-4 py-3 text-sm font-semibold text-primary">
        <span>{detail.run.periodLabel} total</span>
        <Amount amountMinor={detail.baseTotalMinor} currency={baseCurrency} className="text-base" />
      </div>
    </div>
  );
}

/**
 * Statements tab — a printable roster statement plus the 12-month
 * USD-equivalent spend trend (prototype 195-205) built from the scoped runs.
 */
function PayrollStatement({
  data,
  runs,
  rows,
}: {
  data: ModuleOverview;
  runs: ModuleOverview["payroll"]["runs"];
  rows: ModuleOverview["payroll"]["statementRows"];
}) {
  const baseCurrency = data.entity?.currency ?? "USD";
  // 12-month base-currency trend, oldest -> newest, from the run base totals.
  const trend = [...runs]
    .sort((a, b) => a.period.localeCompare(b.period))
    .slice(-12)
    .map((run) => ({ label: payrollPeriodLabel(run.period).split(" ")[0], value: run.totalBaseMinor / 100 }));

  return (
    <div className="flex flex-col gap-4">
      {trend.length >= 2 ? (
        <Card className="shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Payroll trend</CardTitle>
            <CardDescription>{baseCurrency}-equivalent run totals, last {trend.length} periods.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarChart data={trend} />
          </CardContent>
        </Card>
      ) : null}

      {/* E10-T5: one printable statement block + one CSV export PER CURRENCY.
          Each LLC's payroll statement is a separate per-entity, USD-booked
          document (decisions.md Q55); here we split that document by currency so
          each block shows local AND base (USD) totals and exports its own CSV.
          The visible rows respect the active search/facet filter; the CSV always
          exports the full roster for that currency (the statutory document). */}
      {data.payroll.statementsByCurrency.length === 0 ? (
        <Card className="shadow-xs">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No payroll roster yet — add employees to generate statements.
          </CardContent>
        </Card>
      ) : (
        data.payroll.statementsByCurrency.map((block) => {
          const blockRows = rows.filter((row) => row.currency === block.currency);
          if (blockRows.length === 0) return null;
          return (
            <Card key={block.currency} className="shadow-xs" data-testid={`payroll-statement-${block.currency}`}>
              <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-base">
                    Statement · {block.currency}
                    {block.isBaseCurrency ? (
                      <span className="ml-2 rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
                        Base
                      </span>
                    ) : null}
                  </CardTitle>
                  <CardDescription>
                    {block.fxDisplay || `Local and ${baseCurrency} (base) totals.`} Open a run for its own statement.
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => window.print()}>
                    <Printer data-icon="inline-start" />
                    Print
                  </Button>
                  <Button
                    size="sm"
                    data-testid={`payroll-statement-csv-${block.currency}`}
                    onClick={() => downloadCsv(block.csvFilename, block.csv)}
                  >
                    <Download data-icon="inline-start" />
                    CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table className="min-w-full">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Country</TableHead>
                        <TableHead>FX</TableHead>
                        <TableHead className="text-right">Local</TableHead>
                        <TableHead className="text-right">Base</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {blockRows.map((row) => (
                        <TableRow key={row.employeeName}>
                          <TableCell className="font-medium">{row.employeeName}</TableCell>
                          <TableCell>{row.country}</TableCell>
                          <TableCell className="text-muted-foreground">{row.fxDisplay}</TableCell>
                          <TableCell className="money-figures text-right">
                            <Amount amountMinor={row.localMinor} currency={row.currency} />
                          </TableCell>
                          <TableCell className="money-figures text-right">
                            <Amount amountMinor={row.baseMinor} currency={baseCurrency} />
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t font-medium">
                        <TableCell colSpan={3}>Total · {block.currency}</TableCell>
                        <TableCell className="money-figures text-right">
                          <Amount amountMinor={block.localMinor} currency={block.currency} />
                        </TableCell>
                        <TableCell className="money-figures text-right" data-testid={`payroll-statement-base-${block.currency}`}>
                          <Amount amountMinor={block.baseMinor} currency={baseCurrency} />
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

export function RemainingSettingsScreens() {
  const data = useModuleOverview();
  const viewer = useQuery(api.session.viewer, {});
  const aiProviderStatus = useQuery(
    api.ai.providerStatus,
    viewer?.workspace?.id ? { workspaceId: viewer.workspace.id } : "skip",
  );
  const aiBatchRuns = useQuery(
    api.ai.latestCategorizationBatchRuns,
    data?.entity?.id ? { entityId: data.entity.id as Id<"entities">, limit: 1 } : "skip",
  );
  const ensureLiveSandboxEntity = useMutation(api.ledger.ensureLiveSandboxEntity);
  const setAiConfig = useMutation(api.ai.setConfig);
  const recordCategorizationEvalRun = useMutation(api.ai.recordCategorizationEvalRun);
  const testAiConnection = useAction(api.ai.testProviderConnection);
  const categorizePendingTransactions = useAction(api.bedrockCategorizer.categorizePendingTransactions);
  // E2-T3: self-rescheduling backlog drainer (clears the whole queue, no 25-cap).
  const startCategorizationBacklog = useMutation(api.bedrockCategorizer.startCategorizationBacklog);
  const [auditFilter, setAuditFilter] = useState("");
  const [entityMessage, setEntityMessage] = useState("");
  const [aiAutonomyOverride, setAiAutonomyOverride] = useState<AiAutonomyMode | null>(null);
  const [aiTestMessage, setAiTestMessage] = useState("");
  const [aiEvalMessage, setAiEvalMessage] = useState("");
  const [aiBatchMessage, setAiBatchMessage] = useState("");
  const [runningAiEval, setRunningAiEval] = useState(false);
  const [runningAiBatch, setRunningAiBatch] = useState(false);
  const [creatingEntity, setCreatingEntity] = useState(false);
  const aiStatus = frontendAiStatus(aiProviderStatus);
  const aiAutonomy = aiAutonomyOverride ?? aiProviderStatus?.autonomy ?? "balanced";
  const latestAiBatchRun = aiBatchRuns?.[0];

  async function saveAiAutonomy(value: AiAutonomyMode) {
    setAiAutonomyOverride(value);
    setAiTestMessage("");
    if (!viewer?.workspace?.id) {
      setAiTestMessage("Workspace is still loading; try again in a moment.");
      return;
    }
    try {
      await setAiConfig({
        workspaceId: viewer.workspace.id,
        provider: "bedrock",
        autonomy: value,
      });
      const option = aiAutonomyOptions.find((item) => item.value === value);
      setAiTestMessage(`Autonomy saved: ${option?.label ?? value} (${option?.thresholdLabel ?? "threshold configured"}).`);
    } catch (error) {
      setAiTestMessage(error instanceof Error ? error.message : "Could not save AI autonomy.");
    }
  }

  async function runAiConnectionTest() {
    if (!viewer?.workspace?.id) {
      setAiTestMessage("Workspace is still loading; try again in a moment.");
      return;
    }
    setAiTestMessage("Testing server-side provider configuration...");
    try {
      const result = await testAiConnection({ workspaceId: viewer.workspace.id });
      setAiTestMessage(result.message);
    } catch (error) {
      setAiTestMessage(error instanceof Error ? error.message : "AI connection test failed.");
    }
  }

  async function runCategorizationEval() {
    if (!data?.entity?.id) {
      setAiEvalMessage("Demo entity is still loading; try again in a moment.");
      return;
    }
    setRunningAiEval(true);
    setAiEvalMessage("Scoring the seeded eval set...");
    try {
      const result = await recordCategorizationEvalRun({ entityId: data.entity.id as Id<"entities"> });
      setAiEvalMessage(
        `${result.evaluatedCount} rows, ${(result.accuracy * 100).toFixed(1)}% accuracy. ${result.finding}`,
      );
    } catch (error) {
      setAiEvalMessage(error instanceof Error ? error.message : "Could not record the categorization eval.");
    } finally {
      setRunningAiEval(false);
    }
  }

  async function runBatchCategorization() {
    if (!data?.entity?.id) {
      setAiBatchMessage("Business entity is still loading; try again in a moment.");
      return;
    }
    setRunningAiBatch(true);
    setAiBatchMessage("Checking imported transactions...");
    try {
      // First pass runs inline for immediate feedback; the drainer then clears
      // the remainder of the backlog in the background (no overall 25-item cap).
      const result = await categorizePendingTransactions({
        entityId: data.entity.id as Id<"entities">,
      });
      if (result.needsReviewCount > 0 || result.skippedCount > 0) {
        await startCategorizationBacklog({ entityId: data.entity.id as Id<"entities"> });
      }
      const status = result.batchStatus ? ` ${aiBatchStatusLabel(result.batchStatus)}.` : "";
      const degraded = result.degradedCount > 0 ? ` ${result.degradedCount} degraded.` : "";
      const fallback = result.fallbackCount > 0 ? ` ${result.fallbackCount} fallback.` : "";
      setAiBatchMessage(
        `${result.attemptedCount} checked. ${result.postedCount} posted, ${result.needsReviewCount} updated for review, ${result.skippedCount} skipped.${status}${degraded}${fallback} Remaining items are draining in the background.`,
      );
    } catch (error) {
      setAiBatchMessage(error instanceof Error ? error.message : "Could not run batch categorization.");
    } finally {
      setRunningAiBatch(false);
    }
  }

  const aiSettingsPanel = (
    <Card className="shadow-xs" data-testid="m10-ai-settings">
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle className="text-base">AI</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Provider status, model display, and autonomy settings for the M10 AI layer.
          </p>
        </div>
        <Badge variant="outline">{aiStatus.label}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border p-3">
            <div className="text-xs font-medium uppercase text-muted-foreground">Status</div>
            <div className="mt-2 text-sm font-medium">{aiStatus.label}</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{aiStatus.detail}</p>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs font-medium uppercase text-muted-foreground">Provider</div>
            <div className="mt-2 text-sm font-medium">{aiStatus.provider}</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">The configured model provider, read from your Convex environment.</p>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs font-medium uppercase text-muted-foreground">Chat model</div>
            <div className="mt-2 text-sm font-medium">{aiStatus.chatModel}</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Loaded from AI_MODEL after backend provider wiring.</p>
          </div>
        </div>

        <div>
          <div className="text-sm font-medium">Autonomy</div>
          <div className="mt-2 grid gap-3 md:grid-cols-3">
            {aiAutonomyOptions.map((option) => (
              <label
                key={option.value}
                className={`rounded-lg border p-3 transition-colors ${
                  aiAutonomy === option.value ? "border-primary/50 bg-primary/5" : "bg-background"
                }`}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="ai-autonomy"
                    value={option.value}
                    checked={aiAutonomy === option.value}
                    onChange={() => void saveAiAutonomy(option.value)}
                    className="mt-1 accent-[var(--primary)]"
                  />
                  <span>
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="mt-1 block text-xs font-medium text-primary">{option.thresholdLabel}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span>
                  </span>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-medium">Connection test</div>
            <p className="mt-1 text-sm text-muted-foreground">
              This does not print keys. It only reports whether the server-side provider is available.
            </p>
            {aiTestMessage ? <p className="mt-2 text-sm text-primary">{aiTestMessage}</p> : null}
          </div>
          <Button
            className="shrink-0"
            disabled={!viewer?.workspace?.id}
            variant="outline"
            onClick={() => void runAiConnectionTest()}
          >
            <Sparkles className="size-4" />
            Test AI connection
          </Button>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-medium">Categorization eval</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Scores the seeded labeled transactions using the current posted categories.
            </p>
            {aiEvalMessage ? (
              <p className="mt-2 text-sm text-primary" data-testid="m10-ai-eval-result">
                {aiEvalMessage}
              </p>
            ) : null}
          </div>
          <Button
            className="shrink-0"
            disabled={!data?.entity?.id || runningAiEval}
            variant="outline"
            onClick={() => void runCategorizationEval()}
          >
            <CheckCircle2 className="size-4" />
            {runningAiEval ? "Running eval" : "Run eval"}
          </Button>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-medium">Batch categorization</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Runs memory and AI categorization on imported transactions still waiting in review.
            </p>
            {aiBatchMessage ? (
              <p className="mt-2 text-sm text-primary" data-testid="m10-ai-batch-result">
                {aiBatchMessage}
              </p>
            ) : null}
            {latestAiBatchRun ? (
              <p className="mt-2 text-xs leading-5 text-muted-foreground" data-testid="m10-ai-batch-last-run">
                Last run: {aiBatchStatusLabel(latestAiBatchRun.status)} at{" "}
                {new Date(latestAiBatchRun.createdAt).toLocaleString("en-US")}. {latestAiBatchRun.summary}
              </p>
            ) : null}
          </div>
          <Button
            className="shrink-0"
            disabled={!data?.entity?.id || runningAiBatch}
            variant="outline"
            onClick={() => void runBatchCategorization()}
          >
            <Sparkles className="size-4" />
            {runningAiBatch ? "Running batch" : "Run batch"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  if (data === undefined) {
    return (
      <div className="space-y-5" data-testid="m6-settings-screen">
        <ModuleIntro
          title="Remaining settings"
          description="Businesses, rules, audit log, and AI controls are the trust/control surfaces that M8, M9, and M10 depend on."
        />
        {aiSettingsPanel}
        <LoadingBlock label="settings modules" />
      </div>
    );
  }
  if (!data.entity) return <NoEntityState />;

  const liveSandboxReady = data.settings.businesses.addEntity.status === "live_sandbox_ready";
  const liveSandboxEntityId = data.settings.businesses.addEntity.liveSandboxEntityId as Id<"entities"> | null;
  const auditRows = data.settings.audit.rows.filter((row) =>
    `${row.actor} ${row.action} ${row.summary}`.toLowerCase().includes(auditFilter.trim().toLowerCase()),
  );

  async function createLiveSandboxEntity() {
    setCreatingEntity(true);
    setEntityMessage("");
    try {
      const result = await ensureLiveSandboxEntity({});
      setEntityMessage(
        result.created
          ? `Live Sandbox created with ${result.accountsCreated} chart accounts.`
          : `Live Sandbox refreshed; ${result.accountsCreated} missing chart accounts added.`,
      );
    } catch (error) {
      setEntityMessage(error instanceof Error ? error.message : "Could not create the Live Sandbox entity.");
    } finally {
      setCreatingEntity(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="m6-settings-screen">
      <ModuleIntro
        title="Remaining settings"
        description="Businesses, rules, and audit log are the trust/control surfaces that M8, M9, and M10 will depend on."
      />

      <section className="space-y-4" data-testid="settings-connections">
        <ModuleIntro
          title="Connections"
          description="Sandbox services attach to the Live Sandbox entity so test payments and bank imports never pollute the demo books."
        />
        {liveSandboxEntityId ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <StripeConnectionPanel entityId={liveSandboxEntityId} />
            <PlaidConnectionPanel entityId={liveSandboxEntityId} />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground shadow-xs">
            Create the Live Sandbox business first, then Stripe test mode and Plaid sandbox controls attach here.
          </div>
        )}
      </section>

      {aiSettingsPanel}

      <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <Card className="shadow-xs">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="text-base">Businesses</CardTitle>
            <Button
              data-testid="live-sandbox-create"
              size="sm"
              onClick={createLiveSandboxEntity}
              disabled={creatingEntity}
            >
              <Plus className="size-4" />
              {liveSandboxReady ? "Refresh Live Sandbox" : "Create Live Sandbox"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {entityMessage ? (
              <div className="flex items-start gap-2 rounded-lg border bg-primary/5 p-3 text-sm text-primary" data-testid="live-sandbox-message">
                <CheckCircle2 className="mt-0.5 size-4" />
                <span>{entityMessage}</span>
              </div>
            ) : null}
            {data.settings.businesses.rows.map((business) => (
              <div key={business.id} className="rounded-lg border p-3" data-testid={`business-card-${business.slug}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{business.name}</div>
                    <div className="text-sm text-muted-foreground">{business.businessType} · {business.currency}</div>
                  </div>
                  <CategoryChip active={business.isActive} label={business.isDemo ? "Demo" : "Live"} />
                </div>
                <div className="mt-3 flex gap-2">
                  <Button disabled={!business.canArchive} size="sm" variant="outline">
                    <Archive className="size-4" />
                    Archive
                  </Button>
                </div>
                {!business.canArchive ? <p className="mt-2 text-xs text-muted-foreground">{business.archiveReason}</p> : null}
              </div>
            ))}
            <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              {liveSandboxReady
                ? `${data.settings.businesses.addEntity.recommendedName} is ready for sandbox Stripe and Plaid data.`
                : `Recommended next entity: ${data.settings.businesses.addEntity.recommendedName} in ${data.settings.businesses.addEntity.recommendedCurrency}.`}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="text-base">Rules manager</CardTitle>
            <Button size="sm" variant="outline">
              <SlidersHorizontal className="size-4" />
              New rule
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-dashed p-3">
              <div className="flex items-start gap-2">
                <Sparkles className="mt-0.5 size-4 text-primary" />
                <div>
                  <div className="text-sm font-medium">{data.settings.rules.pendingSuggestion.title}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{data.settings.rules.pendingSuggestion.summary}</p>
                </div>
              </div>
            </div>
            <div className="divide-y rounded-lg border">
              {data.settings.rules.rows.map((rule) => (
                <div key={rule.id} className="grid gap-3 px-3 py-3 text-sm md:grid-cols-[auto_1fr_auto_auto] md:items-center">
                  <div className="flex size-8 items-center justify-center rounded-full border money-figures">{rule.order}</div>
                  <div>
                    <div className="font-medium">{rule.name}</div>
                    <div className="text-muted-foreground">{rule.summary}</div>
                  </div>
                  <Badge variant="outline">{rule.hitCount} hits</Badge>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline">
                        <Pencil className="size-4" />
                        Edit
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{rule.name}</DialogTitle>
                        <DialogDescription>{rule.summary}</DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-3">
                        <Label>Category</Label>
                        <Input value={rule.categoryName} readOnly />
                        <Label>Status</Label>
                        <div className="flex items-center gap-2 text-sm">
                          <ToggleLeft className="size-4 text-muted-foreground" />
                          {rule.active ? "On" : "Off"} · {rule.autoPost ? "Auto-post" : "Inbox review"}
                        </div>
                        <Button disabled>Save rule after integration</Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <Card className="shadow-xs">
        <CardHeader className="space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-base">Audit log</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Filterable when, actor, action, and before-after table.</p>
            </div>
            <div className="relative md:w-72">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Filter audit log" value={auditFilter} onChange={(event) => setAuditFilter(event.target.value)} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Before and after</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditRows.map((row) => (
                <TableRow key={row.id} data-testid="audit-row">
                  <TableCell className="money-figures">{new Date(row.when).toLocaleDateString("en-US")}</TableCell>
                  <TableCell>
                    <Badge className="capitalize" data-testid={`audit-actor-${row.actor}`} variant="outline">
                      {row.actor}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <History className="size-4 text-muted-foreground" />
                      {row.action}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.beforeAfter}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function ModuleScreens({ section }: { section: "contacts" | "invoices" | "bills" | "payroll" | "settings" }) {
  if (section === "contacts") return <ContactsScreen />;
  if (section === "invoices") return <InvoicesScreen />;
  if (section === "bills") return <BillsScreen />;
  if (section === "payroll") return <PayrollScreen />;
  return <RemainingSettingsScreens />;
}
