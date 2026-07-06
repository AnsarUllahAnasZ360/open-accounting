"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { getErrorMessage } from "@/lib/errors";
import type { FunctionReturnType } from "convex/server";
import {
  Archive,
  ArrowLeft,
  ArrowUpRight,
  Briefcase,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  FileUp,
  Globe,
  History,
  MapPin,
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
  User,
  Users,
  UserMinus,
  UserPlus,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useRef, useState } from "react";
import { toast } from "sonner";

import { Amount, AgingMiniBar, BarChart, CategoryChip, EmptyState, formatMinorMoney } from "@/components/openbooks/primitives";
import { ContactsScreen } from "@/components/openbooks/ContactsScreen";
import {
  type BillRow,
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
  type ExportFormat,
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
      setError(getErrorMessage(err, "Could not settle the bill."));
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
      toast.error(getErrorMessage(error, "Could not read that file."));
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
      setError(getErrorMessage(err, "Could not add the bill."));
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
  const router = useRouter();
  const [scope, setScope] = useState<PayrollScope>("all");
  const [range, setRange] = useState<DateRangeValue>({ preset: "last-3-months" });
  const [search, setSearch] = useState("");
  const [facets, setFacets] = useState<FacetValue>({});
  const [importOpen, setImportOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateDefault, setGenerateDefault] = useState<string | null>(null);

  if (data === undefined) return <LoadingBlock label="payroll" />;
  if (!data.entity) return <NoEntityState />;

  const baseCurrency = data.entity.currency;
  const entityId = data.entity.id as Id<"entities">;
  const runs = data.payroll.runs;
  // Preparers (Owner + Accountant + HR) can generate/edit/submit runs and manage
  // the roster. Approving/posting is a separate capability handled in the run
  // detail. The server re-checks every write.
  const canPrepare = data.payroll.canPrepare;

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
  const existingPeriods = runs.map((run) => run.period);
  const activePayrollView: "people" | "runs" | "statements" | "monthly" =
    subsection === "people"
      ? "people"
      : subsection === "statements"
        ? "statements"
        : subsection === "monthly"
          ? "monthly"
          : "runs";

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
            canPrepare
              ? { label: "Run payroll", icon: Play, onClick: () => setGenerateOpen(true) }
              : undefined
          }
        >
          {canPrepare ? (
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <FileUp data-icon="inline-start" />
              Import CSV
            </Button>
          ) : null}
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

      {activePayrollView !== "monthly" ? (
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
      ) : null}

      {activePayrollView === "people" ? (
        <PayrollEmployees entityId={entityId} baseCurrency={baseCurrency} canPrepare={canPrepare} searchTerm={payrollTerm} />
      ) : null}
      {activePayrollView === "runs" ? (
        <PayrollRuns
          data={data}
          runs={scopedRuns}
          onOpenRun={(id) => router.push(`/payroll/runs/${id}`)}
        />
      ) : null}
      {activePayrollView === "statements" ? (
        <PayrollStatement data={data} runs={scopedRuns} rows={filteredStatementRows} />
      ) : null}
      {activePayrollView === "monthly" ? (
        <PayrollMonthly
          runs={runs}
          baseCurrency={baseCurrency}
          canPrepare={canPrepare}
          currentPeriod={draftPeriod}
          onOpenRun={(id) => router.push(`/payroll/runs/${id}`)}
          onGenerate={(period) => {
            setGenerateDefault(period);
            setGenerateOpen(true);
          }}
        />
      ) : null}

      <PayrollImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        entityId={entityId}
        baseCurrency={baseCurrency}
      />
      <GeneratePayrollDialog
        key={generateDefault ?? draftPeriod}
        open={generateOpen}
        onOpenChange={(open) => {
          setGenerateOpen(open);
          if (!open) setGenerateDefault(null);
        }}
        entityId={entityId}
        defaultPeriod={generateDefault ?? draftPeriod}
        existingPeriods={existingPeriods}
        onGenerated={(runId) => router.push(`/payroll/runs/${runId}`)}
      />
    </WorkbenchPage>
    </div>
  );
}

// ─── Generate a monthly payroll run (HR preparer entry point) ─────────────────

/** Options for the month picker: current month + previous 5 + next 1. */
function monthOptions(currentPeriod: string): { value: string; label: string }[] {
  const [y, m] = currentPeriod.split("-").map(Number);
  const opts: { value: string; label: string }[] = [];
  for (let offset = -5; offset <= 1; offset++) {
    // Build a YYYY-MM without Date arithmetic pitfalls.
    let year = y;
    let month = m + offset;
    while (month < 1) { month += 12; year -= 1; }
    while (month > 12) { month -= 12; year += 1; }
    const value = `${year}-${String(month).padStart(2, "0")}`;
    opts.push({ value, label: payrollPeriodLabel(value) });
  }
  return opts.reverse(); // newest first
}

function GeneratePayrollDialog({
  open,
  onOpenChange,
  entityId,
  defaultPeriod,
  existingPeriods,
  onGenerated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: Id<"entities">;
  defaultPeriod: string;
  existingPeriods: string[];
  onGenerated: (runId: string) => void;
}) {
  const startRun = useMutation(api.payroll.startRun);
  const [period, setPeriod] = useState(defaultPeriod);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = monthOptions(defaultPeriod);
  const alreadyExists = existingPeriods.includes(period);

  async function submit() {
    if (alreadyExists) {
      setError(`A run already exists for ${payrollPeriodLabel(period)}. Open it from the Runs tab.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await startRun({ entityId, period });
      toast.success(`Draft payroll run created for ${payrollPeriodLabel(period)}.`);
      onOpenChange(false);
      onGenerated(result.runId);
    } catch (err) {
      setError(getErrorMessage(err, "Could not generate the run."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="generate-payroll-dialog">
        <DialogHeader>
          <DialogTitle>Generate payroll run</DialogTitle>
          <DialogDescription>
            Pick the month to run. OpenBooks drafts a line for every active employee from their current salary — you then
            add bonuses/deductions and submit it for approval. Nothing posts to the ledger until it&apos;s approved.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2">
            <Label>Month</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger data-testid="generate-payroll-month"><SelectValue /></SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value} disabled={existingPeriods.includes(o.value)}>
                    {o.label}{existingPeriods.includes(o.value) ? " · exists" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={busy || alreadyExists} onClick={() => void submit()} data-testid="generate-payroll-submit">
            {busy ? "Generating…" : "Generate draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Payroll CSV import ───────────────────────────────────────────────────────

type ImportRow = {
  name: string;
  email: string;
  department: string;
  currency: string;
  basePayMinor: number;
  deductionsMinor: number;
  bonusesMinor: number;
  fxRateMicros: number;
  finalMinor: number;
  baseEquivMinor: number;
};

function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuote = !inQuote;
    } else if (c === "," && !inQuote) {
      cols.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  cols.push(current.trim());
  return cols;
}

function parseCsvImportMoney(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!cleaned) return 0;
  const n = parseFloat(cleaned);
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function parseCsvPayroll(text: string): { rows: ImportRow[]; errors: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (lines.length < 2) {
    return { rows: [], errors: ["File has no data rows. Download the template and fill it in."] };
  }

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, " "));
  const idx = {
    name: header.findIndex((h) => h === "name" || h === "employee name"),
    email: header.findIndex((h) => h === "email"),
    department: header.findIndex((h) => h === "department" || h === "dept"),
    currency: header.findIndex((h) => h === "currency" || h === "cur"),
    basePay: header.findIndex((h) => h === "base pay" || h === "base salary" || h === "salary"),
    deductions: header.findIndex((h) => h === "deductions" || h === "deduction"),
    bonuses: header.findIndex((h) => h === "bonuses" || h === "bonus"),
  };

  if (idx.name === -1) {
    return { rows: [], errors: ['Missing required column "Name". Download the template for the correct format.'] };
  }
  if (idx.basePay === -1) {
    return { rows: [], errors: ['Missing required column "Base Pay". Download the template for the correct format.'] };
  }

  const rows: ImportRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const name = idx.name >= 0 ? (cols[idx.name] ?? "") : "";
    if (!name || name.length < 2) continue;

    const currencyRaw = idx.currency >= 0 ? (cols[idx.currency] ?? "USD") : "USD";
    const currency = (currencyRaw || "USD").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      errors.push(`Row ${i + 1} (${name}): invalid currency "${currencyRaw}" — use 3-letter code like USD, EUR, GBP.`);
      continue;
    }

    const basePay = parseCsvImportMoney(idx.basePay >= 0 ? (cols[idx.basePay] ?? "0") : "0");
    const deductions = parseCsvImportMoney(idx.deductions >= 0 ? (cols[idx.deductions] ?? "0") : "0");
    const bonuses = parseCsvImportMoney(idx.bonuses >= 0 ? (cols[idx.bonuses] ?? "0") : "0");

    if (basePay === null || basePay <= 0) {
      errors.push(`Row ${i + 1} (${name}): Base Pay must be a positive number.`);
      continue;
    }
    if (deductions === null || bonuses === null) {
      errors.push(`Row ${i + 1} (${name}): Deductions and Bonuses must be non-negative numbers.`);
      continue;
    }

    const finalMinor = basePay - deductions + bonuses;
    rows.push({
      name,
      email: idx.email >= 0 ? (cols[idx.email] ?? "") : "",
      department: idx.department >= 0 ? (cols[idx.department] ?? "") : "",
      currency,
      basePayMinor: basePay,
      deductionsMinor: deductions,
      bonusesMinor: bonuses,
      fxRateMicros: 1_000_000,
      finalMinor,
      baseEquivMinor: finalMinor,
    });
  }

  return { rows, errors };
}

function PayrollImportDialog({
  open,
  onOpenChange,
  entityId,
  baseCurrency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: Id<"entities">;
  baseCurrency: string;
}) {
  const importRowsMutation = useMutation(api.payroll.importPayrollRows);
  const fetchFxRates = useAction(api.payroll.fetchDayOfPayRates);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const now = new Date();
  const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [period, setPeriod] = useState(defaultPeriod);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fxRates, setFxRates] = useState<Record<string, number>>({});
  const [fxFetching, setFxFetching] = useState(false);
  const [fxError, setFxError] = useState("");
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [result, setResult] = useState<{ runId: Id<"payrollRuns">; linesCreated: number; employeesCreated: number; employeesUpdated: number } | null>(null);

  function reset() {
    setStep("upload");
    setRows([]);
    setFxRates({});
    setFxError("");
    setParseErrors([]);
    setImporting(false);
    setImportError("");
    setResult(null);
    setPeriod(defaultPeriod);
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;
      const { rows: parsed, errors } = parseCsvPayroll(text);
      setParseErrors(errors);
      if (parsed.length === 0) return;
      setRows(parsed);
      setStep("preview");

      const foreign = [...new Set(parsed.map((r) => r.currency).filter((c) => c !== baseCurrency))];
      if (foreign.length > 0) {
        setFxFetching(true);
        setFxError("");
        void fetchFxRates({ baseCurrency, localCurrencies: foreign })
          .then((res) => {
            const rates: Record<string, number> = {};
            for (const row of res.persisted) rates[row.currency] = row.rateMicros;
            setFxRates(rates);
          })
          .catch(() => {
            setFxError("Could not fetch live exchange rates. Import will use a 1:1 fallback — adjust amounts manually if needed.");
          })
          .finally(() => setFxFetching(false));
      }
    };
    reader.readAsText(file);
  }

  // Resolve rows with live FX rates applied.
  const FX_SCALE = 1_000_000;
  const resolvedRows: ImportRow[] = rows.map((row) => {
    const fxRateMicros = row.currency === baseCurrency ? FX_SCALE : (fxRates[row.currency] ?? FX_SCALE);
    const baseEquivMinor = fxRateMicros > 0 ? Math.round((row.finalMinor * FX_SCALE) / fxRateMicros) : row.finalMinor;
    return { ...row, fxRateMicros, baseEquivMinor };
  });
  const totalBase = resolvedRows.reduce((sum, r) => sum + r.baseEquivMinor, 0);
  const nonBaseCurrencies = [...new Set(rows.map((r) => r.currency).filter((c) => c !== baseCurrency))];

  async function submit() {
    if (importing || resolvedRows.length === 0) return;
    setImporting(true);
    setImportError("");
    try {
      const res = await importRowsMutation({
        entityId,
        period,
        rows: resolvedRows.map((r) => ({
          name: r.name,
          ...(r.email ? { email: r.email } : {}),
          ...(r.department ? { department: r.department } : {}),
          currency: r.currency,
          basePayMinor: r.basePayMinor,
          deductionsMinor: r.deductionsMinor,
          bonusesMinor: r.bonusesMinor,
          fxRateMicros: r.fxRateMicros,
        })),
      });
      setResult(res);
      setStep("done");
    } catch (err) {
      setImportError(getErrorMessage(err, "Import failed. Please try again."));
    } finally {
      setImporting(false);
    }
  }

  function downloadTemplate() {
    const csv = [
      "Name,Email,Department,Currency,Base Pay,Deductions,Bonuses,Total Pay",
      "John Smith,john@acme.com,Engineering,USD,5000.00,200.00,500.00,5300.00",
      "Jane Doe,jane@acme.com,Marketing,USD,4500.00,150.00,0.00,4350.00",
      "# Total Pay is for reference only — OpenBooks computes it automatically.",
      "# For non-USD employees add the correct 3-letter currency code (EUR, GBP, PKR).",
      "# Exchange rates are fetched from ECB at today's rate on upload.",
    ].join("\n");
    downloadCsv("payroll-template.csv", csv);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import payroll from CSV</DialogTitle>
          <DialogDescription>
            {step === "upload" && "Download the template, fill in your payroll data, then upload the file."}
            {step === "preview" && `${resolvedRows.length} row${resolvedRows.length !== 1 ? "s" : ""} parsed — review before importing.`}
            {step === "done" && "Payroll draft created successfully."}
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="grid gap-4 py-1">
            <div className="grid gap-1.5">
              <Label htmlFor="import-period">Payroll period</Label>
              <Input
                id="import-period"
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="sm:max-w-[200px]"
              />
            </div>

            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-sm font-medium">1 — Download the template</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Fill in Name, Email, Department, Currency, Base Pay, Deductions, and Bonuses for each employee.
                Use 3-letter currency codes (USD, EUR, GBP, PKR). Total Pay is auto-computed.
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={downloadTemplate}>
                <Download data-icon="inline-start" />
                Download CSV template
              </Button>
            </div>

            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-sm font-medium">2 — Upload your file</p>
              <p className="mt-1 text-xs text-muted-foreground">
                CSV files only (.csv). Excel users: save as CSV first via File → Save As → CSV.
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => fileInputRef.current?.click()}>
                <FileUp data-icon="inline-start" />
                Choose CSV file
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) handleFile(file);
                }}
              />
            </div>

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Currency: </span>
              All totals are stored in {baseCurrency}. Non-{baseCurrency} amounts are auto-converted
              at today&apos;s ECB rate when you upload. You can review and verify the rates before confirming.
            </div>

            {parseErrors.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                {parseErrors.map((err, i) => (
                  <p key={i} className="text-xs text-destructive">{err}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {step === "preview" && (
          <div className="grid gap-4 py-1">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span><span className="text-muted-foreground">Period:</span> <span className="font-medium">{period}</span></span>
              {nonBaseCurrencies.length > 0 && (
                <span className="text-muted-foreground">
                  Currencies: {[baseCurrency, ...nonBaseCurrencies].join(", ")}
                  {fxFetching && " — fetching rates…"}
                </span>
              )}
            </div>

            {nonBaseCurrencies.length > 0 && Object.keys(fxRates).length > 0 && !fxFetching && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
                <span className="font-medium">Exchange rates (ECB, today):</span>
                <span className="ml-2 text-muted-foreground">
                  {nonBaseCurrencies.map((c) => {
                    const r = fxRates[c];
                    return r ? `1 ${baseCurrency} = ${(r / FX_SCALE).toFixed(4)} ${c}` : null;
                  }).filter(Boolean).join(" · ")}
                </span>
              </div>
            )}

            {fxError && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                {fxError}
              </div>
            )}

            <div className="max-h-60 overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Dept</TableHead>
                    <TableHead>Cur</TableHead>
                    <TableHead className="text-right">Base Pay</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Bonuses</TableHead>
                    <TableHead className="text-right">{baseCurrency} equiv.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resolvedRows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-muted-foreground">{row.department || "—"}</TableCell>
                      <TableCell>{row.currency}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMinorMoney(row.basePayMinor, { currency: row.currency })}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.deductionsMinor > 0 ? <span className="text-destructive">−{formatMinorMoney(row.deductionsMinor, { currency: row.currency })}</span> : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.bonusesMinor > 0 ? <span className="text-primary">+{formatMinorMoney(row.bonusesMinor, { currency: row.currency })}</span> : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{formatMinorMoney(row.baseEquivMinor, { currency: baseCurrency })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-2.5 text-sm">
              <span className="text-muted-foreground">{resolvedRows.length} employee{resolvedRows.length !== 1 ? "s" : ""} · {period}</span>
              <span className="font-semibold">Total: {formatMinorMoney(totalBase, { currency: baseCurrency })}</span>
            </div>

            {parseErrors.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                {parseErrors.map((err, i) => (
                  <p key={i} className="text-xs text-destructive">{err}</p>
                ))}
              </div>
            )}
            {importError && (
              <p className="text-xs text-destructive">{importError}</p>
            )}
          </div>
        )}

        {step === "done" && result && (
          <div className="py-2">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <CheckCircle2 className="size-5" />
              </div>
              <div>
                <p className="text-sm font-medium">
                  {result.linesCreated} employee{result.linesCreated !== 1 ? "s" : ""} imported for {period}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[
                    result.employeesCreated > 0 && `${result.employeesCreated} new`,
                    result.employeesUpdated > 0 && `${result.employeesUpdated} updated`,
                  ].filter(Boolean).join(" · ")}
                  {(result.employeesCreated > 0 || result.employeesUpdated > 0) && " · "}
                  Draft run created — open it in Payroll → Runs to review and approve.
                </p>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === "upload" && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => { setStep("upload"); setImportError(""); }}>Back</Button>
              <Button
                disabled={importing || fxFetching || resolvedRows.length === 0}
                onClick={() => void submit()}
              >
                {importing ? "Importing…" : `Import ${resolvedRows.length} row${resolvedRows.length !== 1 ? "s" : ""}`}
              </Button>
            </>
          )}
          {step === "done" && (
            <Button onClick={() => { onOpenChange(false); reset(); }}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Semantic payroll status chip: Draft neutral, Submitted amber, Approved info-blue, Paid green. */
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
  if (status === "submitted") {
    return (
      <Badge variant="secondary" className="bg-warning-surface text-warning">
        <Clock data-icon="inline-start" aria-hidden="true" />
        Submitted
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

type RosterEmployee = FunctionReturnType<typeof api.employees.listEmployees>["employees"][number];
type FullEmployee = NonNullable<FunctionReturnType<typeof api.employees.getEmployee>>;

/** Two-letter initials from a name, for the avatar fallback. */
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Employee avatar: photo when available, brand-tinted initials otherwise. */
function EmployeeAvatar({
  name,
  photoUrl,
  size = "default",
}: {
  name: string;
  photoUrl?: string | null;
  size?: "default" | "sm" | "lg";
}) {
  return (
    <Avatar size={size}>
      {photoUrl ? <AvatarImage src={photoUrl} alt={name} /> : null}
      <AvatarFallback className="bg-primary/10 font-medium text-primary">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

/** A small labelled location pill with a map-pin, or an em dash when unknown. */
function LocationChip({ country, city }: { country: string; city?: string | null }) {
  const loc = [country && country !== "—" ? country : null, city].filter(Boolean).join(" · ");
  if (!loc) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      <MapPin className="size-3 shrink-0" aria-hidden="true" />
      {loc}
    </span>
  );
}

/** A single mini-stat inside the People overview strip. */
function PeopleStat({ icon: Icon, label, value, detail }: { icon: LucideIcon; label: string; value: React.ReactNode; detail?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate text-lg font-semibold leading-tight tabular-nums">{value}</div>
        {detail ? <div className="truncate text-xs text-muted-foreground">{detail}</div> : null}
      </div>
    </div>
  );
}

function PayrollEmployees({
  entityId,
  baseCurrency,
  canPrepare,
  searchTerm,
}: {
  entityId: Id<"entities">;
  baseCurrency: string;
  canPrepare: boolean;
  searchTerm: string;
}) {
  const roster = useQuery(api.employees.listEmployees, { entityId });
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [detailId, setDetailId] = useState<Id<"employees"> | null>(null);
  const [tab, setTab] = useState<"active" | "former">("active");

  const columns: ColumnDef<RosterEmployee>[] = [
    {
      key: "name",
      header: "Name",
      mobilePrimary: true,
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-3">
          <EmployeeAvatar name={row.name} />
          <div className="min-w-0">
            <div className="truncate font-medium">{row.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {[row.title, row.department].filter(Boolean).join(" · ") || (row.active ? "Active" : "Former")}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "location",
      header: "Location",
      priority: 1,
      cell: (row) => <LocationChip country={row.country} city={row.city} />,
    },
    {
      key: "salary",
      header: "Monthly salary",
      align: "right",
      mono: true,
      mobileTrailing: true,
      sortValue: (row) => row.monthlyBaseEquivalentMinor,
      cell: (row) => (
        <div className="text-right">
          <div><Amount amountMinor={row.monthlySalaryMinor} currency={row.currency} /></div>
          {row.currency !== row.baseCurrency ? (
            <div className="text-xs text-muted-foreground">
              ≈ <Amount amountMinor={row.monthlyBaseEquivalentMinor} currency={row.baseCurrency} />
            </div>
          ) : null}
        </div>
      ),
    },
  ];

  if (roster === undefined) return <LoadingBlock label="employees" />;

  const term = searchTerm.trim().toLowerCase();
  const matches = (row: RosterEmployee) =>
    !term ||
    [row.name, row.country, row.city, row.currency, row.title, row.department]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(term);
  const activeRows = roster.employees.filter((e) => e.active && matches(e));
  const formerRows = roster.employees.filter((e) => !e.active && matches(e));
  const rows = tab === "active" ? activeRows : formerRows;

  // Roster-at-a-glance stats (active employees only).
  const activeAll = roster.employees.filter((e) => e.active);
  const monthlyCostMinor = activeAll.reduce((sum, e) => sum + e.monthlyBaseEquivalentMinor, 0);
  const currencies = [...new Set(activeAll.map((e) => e.currency))].sort();

  return (
    <div className="flex flex-col gap-3">
      <Card className="shadow-xs">
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-5 py-5 md:grid-cols-4">
          <PeopleStat icon={Users} label="Active headcount" value={activeAll.length} />
          <PeopleStat
            icon={Wallet}
            label={`Monthly cost (${baseCurrency})`}
            value={formatMinorMoney(monthlyCostMinor, { currency: baseCurrency })}
            detail="across the active roster"
          />
          <PeopleStat
            icon={Globe}
            label="Currencies"
            value={currencies.length}
            detail={currencies.join(" · ") || "—"}
          />
          <PeopleStat icon={UserMinus} label="Former employees" value={roster.employees.filter((e) => !e.active).length} />
        </CardContent>
      </Card>
      <PayScheduleControl entityId={entityId} />
      <div className="flex items-center justify-between gap-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "active" | "former")}>
          <TabsList>
            <TabsTrigger value="active" data-testid="payroll-people-active">
              People{activeRows.length ? ` · ${activeRows.length}` : ""}
            </TabsTrigger>
            <TabsTrigger value="former" data-testid="payroll-people-former">
              Former{formerRows.length ? ` · ${formerRows.length}` : ""}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {canPrepare ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setImporting(true)} data-testid="payroll-import-employees">
              <FileUp data-icon="inline-start" />
              Import
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)} data-testid="payroll-add-employee">
              <UserPlus data-icon="inline-start" />
              Add employee
            </Button>
          </div>
        ) : null}
      </div>
      <OpenBooksDataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row._id}
        onRowClick={(row) => setDetailId(row._id as Id<"employees">)}
        empty={
          <EmptyState
            icon={Users}
            title={tab === "active" ? "No employees yet" : "No former employees"}
            description={
              tab === "active"
                ? "Add your team to draft payroll runs from their salaries."
                : "Terminated employees appear here — never deleted."
            }
          />
        }
      />
      <EmployeeDetailSheet
        employeeId={detailId}
        entityId={entityId}
        baseCurrency={baseCurrency}
        canPrepare={canPrepare}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      />
      <EmployeeFormDialog
        entityId={entityId}
        baseCurrency={baseCurrency}
        employee={null}
        open={adding}
        onOpenChange={setAdding}
      />
      <BulkEmployeeImportDialog
        entityId={entityId}
        baseCurrency={baseCurrency}
        open={importing}
        onOpenChange={setImporting}
      />
    </div>
  );
}

// ─── Bulk employee import (CSV upload or paste from Excel/Sheets) ──────────────

type ParsedEmployeeRow = {
  name: string;
  email?: string;
  title?: string;
  department?: string;
  country?: string;
  city?: string;
  currency: string;
  monthlySalaryMinor: number;
  phone?: string;
  employmentType?: "full_time" | "part_time" | "contractor";
  startDate?: string;
  payFrequency?: "hourly" | "weekly" | "semimonthly" | "monthly";
  paymentMethod?: string;
};

const BULK_TEMPLATE =
  "name,email,title,department,country,currency,salary,phone,employmentType,startDate,payFrequency,paymentMethod\n" +
  "Ahmed Ali,ahmed@acme.com,Engineer,Engineering,Pakistan,PKR,500000,+92...,full_time,2026-01-15,monthly,Bank transfer\n";

/** Split one delimited line honoring simple double-quote quoting. */
function splitDelimited(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function normHeader(h: string) {
  return h.toLowerCase().replace(/[\s_-]/g, "");
}

const HEADER_ALIASES: Record<string, keyof ParsedEmployeeRow | "salary"> = {
  name: "name",
  fullname: "name",
  email: "email",
  title: "title",
  jobtitle: "title",
  department: "department",
  dept: "department",
  country: "country",
  city: "city",
  currency: "currency",
  salary: "salary",
  monthlysalary: "salary",
  monthlypay: "salary",
  pay: "salary",
  phone: "phone",
  mobile: "phone",
  employmenttype: "employmentType",
  type: "employmentType",
  startdate: "startDate",
  payfrequency: "payFrequency",
  frequency: "payFrequency",
  paymentmethod: "paymentMethod",
};

function normalizeEmploymentType(v: string): "full_time" | "part_time" | "contractor" | undefined {
  const k = v.toLowerCase().replace(/[\s_-]/g, "");
  if (k === "fulltime") return "full_time";
  if (k === "parttime") return "part_time";
  if (k === "contractor" || k === "contract") return "contractor";
  return undefined;
}

function normalizePayFrequency(v: string): "hourly" | "weekly" | "semimonthly" | "monthly" | undefined {
  const k = v.toLowerCase().replace(/[\s_-]/g, "");
  if (k === "hourly") return "hourly";
  if (k === "weekly") return "weekly";
  if (k === "monthly") return "monthly";
  if (k === "semimonthly" || k === "biweekly" || k === "twicemonthly") return "semimonthly";
  return undefined;
}

/** Parse pasted/upload text (CSV or tab-separated from Excel) into rows + errors. */
function parseBulkEmployees(text: string): { rows: ParsedEmployeeRow[]; errors: string[] } {
  const errors: string[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], errors: ["Add a header row plus at least one employee row."] };
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const headers = splitDelimited(lines[0], delim).map(normHeader);
  const colIndex: Partial<Record<string, number>> = {};
  headers.forEach((h, i) => {
    const key = HEADER_ALIASES[h];
    if (key) colIndex[key] = i;
  });
  if (colIndex.name === undefined || colIndex.currency === undefined || colIndex.salary === undefined) {
    return { rows: [], errors: ["Header row must include at least: name, currency, salary."] };
  }

  const rows: ParsedEmployeeRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitDelimited(lines[i], delim);
    const get = (key: string) => {
      const idx = colIndex[key];
      return idx === undefined ? "" : (cells[idx] ?? "").trim();
    };
    const name = get("name");
    if (name.length < 2) {
      errors.push(`Row ${i + 1}: missing name — skipped.`);
      continue;
    }
    const currencyRaw = get("currency").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currencyRaw)) {
      errors.push(`Row ${i + 1} (${name}): currency must be a 3-letter code — skipped.`);
      continue;
    }
    const salaryNum = Number(get("salary").replace(/[,$]/g, ""));
    const monthlySalaryMinor = Math.round((salaryNum || 0) * 100);
    if (!Number.isFinite(salaryNum) || monthlySalaryMinor <= 0) {
      errors.push(`Row ${i + 1} (${name}): salary must be a positive number — skipped.`);
      continue;
    }
    const row: ParsedEmployeeRow = { name, currency: currencyRaw, monthlySalaryMinor };
    const email = get("email");
    if (email) row.email = email;
    const title = get("title");
    if (title) row.title = title;
    const department = get("department");
    if (department) row.department = department;
    const country = get("country");
    if (country) row.country = country;
    const city = get("city");
    if (city) row.city = city;
    const phone = get("phone");
    if (phone) row.phone = phone;
    const startDate = get("startDate");
    if (startDate) row.startDate = startDate;
    const paymentMethod = get("paymentMethod");
    if (paymentMethod) row.paymentMethod = paymentMethod;
    const et = get("employmentType");
    if (et) row.employmentType = normalizeEmploymentType(et);
    const pf = get("payFrequency");
    if (pf) row.payFrequency = normalizePayFrequency(pf);
    rows.push(row);
  }
  return { rows, errors };
}

function BulkEmployeeImportDialog({
  entityId,
  baseCurrency,
  open,
  onOpenChange,
}: {
  entityId: Id<"entities">;
  baseCurrency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const bulkImport = useMutation(api.employees.bulkImportEmployees);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { rows, errors } = text.trim() ? parseBulkEmployees(text) : { rows: [], errors: [] };

  async function onFile(file: File) {
    const content = await file.text();
    setText(content);
  }

  function downloadTemplate() {
    const blob = new Blob([BULK_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "employees-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function submit() {
    if (rows.length === 0) return;
    setBusy(true);
    try {
      const result = await bulkImport({ entityId, rows });
      toast.success(`Imported ${result.created} new and updated ${result.updated} employee${result.created + result.updated === 1 ? "" : "s"}.`);
      setText("");
      onOpenChange(false);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not import employees."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="bulk-employee-import" className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import employees</DialogTitle>
          <DialogDescription>
            Upload a CSV, or paste rows straight from Excel / Google Sheets. Salaries are in each row&apos;s own
            currency (a 3-letter code) — converted to {baseCurrency} for reporting, but stored and paid natively.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
                if (fileRef.current) fileRef.current.value = "";
              }}
            />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} data-testid="bulk-import-file">
              <FileUp data-icon="inline-start" />
              Upload CSV
            </Button>
            <Button size="sm" variant="ghost" onClick={downloadTemplate}>
              <Download data-icon="inline-start" />
              Template
            </Button>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            data-testid="bulk-import-textarea"
            placeholder={"Paste rows here (with a header row):\nname, currency, salary, country, title, …"}
            className="h-40 w-full rounded-lg border p-2 font-mono text-xs"
          />
          {text.trim() ? (
            <div className="rounded-lg border bg-muted/20 p-2 text-xs" data-testid="bulk-import-preview">
              <span className="font-medium">{rows.length}</span> employee{rows.length === 1 ? "" : "s"} ready
              {errors.length > 0 ? (
                <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                  {errors.slice(0, 6).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                  {errors.length > 6 ? <li>…and {errors.length - 6} more.</li> : null}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={busy || rows.length === 0} onClick={() => void submit()} data-testid="bulk-import-submit">
            {busy ? "Importing…" : `Import ${rows.length || ""}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Employee detail (Overview / Salary History / Payroll History / Documents) ──

function EmployeeDetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "" || value === "—") return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contractor: "Contractor",
};

const PAY_FREQUENCY_LABEL: Record<string, string> = {
  hourly: "Hourly",
  weekly: "Weekly",
  semimonthly: "Semi-monthly",
  monthly: "Monthly",
};

function EmployeeDetailSheet({
  employeeId,
  entityId,
  baseCurrency,
  canPrepare,
  onOpenChange,
}: {
  employeeId: Id<"employees"> | null;
  entityId: Id<"entities">;
  baseCurrency: string;
  canPrepare: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const open = employeeId !== null;
  const employee = useQuery(api.employees.getEmployee, employeeId ? { employeeId } : "skip");
  const [editing, setEditing] = useState(false);
  const [terminating, setTerminating] = useState(false);
  const updateEmployee = useMutation(api.employees.updateEmployee);
  const [busy, setBusy] = useState(false);

  if (!open) return <DetailSheet open={false} onOpenChange={onOpenChange} title="Employee" />;
  if (employee === undefined) {
    return (
      <DetailSheet open onOpenChange={onOpenChange} title="Employee">
        <LoadingBlock label="employee" />
      </DetailSheet>
    );
  }
  if (employee === null) {
    return (
      <DetailSheet open onOpenChange={onOpenChange} title="Employee">
        <EmptyState title="Employee not found" />
      </DetailSheet>
    );
  }

  const bank = employee.payTo as { bankName?: string; accountTitle?: string; ibanOrAccountNumber?: string } | null;
  const payFrequencyLabel = employee.payFrequency ? PAY_FREQUENCY_LABEL[employee.payFrequency] : null;
  const overview = (
    <div className="flex flex-col gap-4" data-testid="employee-overview">
      {/* Salary highlight */}
      <div className="rounded-xl border bg-primary/[0.04] p-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Wallet className="size-3.5" aria-hidden="true" /> Monthly salary
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">
          <Amount amountMinor={employee.monthlySalaryMinor} currency={employee.currency} />
        </div>
        {employee.currency !== employee.baseCurrency ? (
          <div className="text-sm text-muted-foreground tabular-nums">
            ≈ <Amount amountMinor={employee.monthlyBaseEquivalentMinor} currency={employee.baseCurrency} /> {employee.baseCurrency}
          </div>
        ) : null}
        {payFrequencyLabel ? (
          <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
            <Clock className="size-3" aria-hidden="true" /> Paid {payFrequencyLabel.toLowerCase()}
          </div>
        ) : null}
      </div>

      <section>
        <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <User className="size-3.5" aria-hidden="true" /> Personal
        </h4>
        <EmployeeDetailRow label="Email" value={employee.email} />
        <EmployeeDetailRow label="Phone" value={employee.phone} />
        {!employee.email && !employee.phone ? <p className="text-sm text-muted-foreground">No contact details on file.</p> : null}
      </section>
      <section>
        <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Briefcase className="size-3.5" aria-hidden="true" /> Employment
        </h4>
        <EmployeeDetailRow label="Job title" value={employee.title} />
        <EmployeeDetailRow label="Department" value={employee.department} />
        <EmployeeDetailRow label="Type" value={employee.employmentType ? EMPLOYMENT_TYPE_LABEL[employee.employmentType] : null} />
        <EmployeeDetailRow label="Start date" value={employee.startDate} />
        <EmployeeDetailRow label="Status" value={employee.active ? "Active" : `Terminated (${employee.exitReason ?? "—"})`} />
        {!employee.active ? <EmployeeDetailRow label="Termination date" value={employee.exitDate} /> : null}
      </section>
      <section>
        <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <MapPin className="size-3.5" aria-hidden="true" /> Location
        </h4>
        <EmployeeDetailRow label="Country" value={employee.country !== "—" ? employee.country : null} />
        <EmployeeDetailRow label="City" value={employee.city} />
      </section>
      {canPrepare && (bank?.bankName || bank?.accountTitle || bank?.ibanOrAccountNumber || employee.paymentMethod) ? (
        <section>
          <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <CreditCard className="size-3.5" aria-hidden="true" /> Payment details
          </h4>
          <EmployeeDetailRow label="Method" value={employee.paymentMethod} />
          <EmployeeDetailRow label="Bank" value={bank?.bankName} />
          <EmployeeDetailRow label="Account title" value={bank?.accountTitle} />
          <EmployeeDetailRow label="IBAN / Account #" value={bank?.ibanOrAccountNumber} />
        </section>
      ) : null}
    </div>
  );

  const footer = canPrepare ? (
    <>
      {employee.active ? (
        <Button size="sm" variant="outline" onClick={() => setTerminating(true)} data-testid="employee-terminate">
          Terminate
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          data-testid="employee-reactivate"
          onClick={async () => {
            setBusy(true);
            try {
              await updateEmployee({ employeeId: employee._id, active: true });
              toast.success(`${employee.name} reactivated.`);
            } catch (err) {
              toast.error(getErrorMessage(err, "Could not reactivate."));
            } finally {
              setBusy(false);
            }
          }}
        >
          Reactivate
        </Button>
      )}
      <Button size="sm" onClick={() => setEditing(true)} data-testid="employee-edit">
        <Pencil data-icon="inline-start" />
        Edit
      </Button>
    </>
  ) : null;

  return (
    <>
      <DetailSheet
        open={open}
        onOpenChange={onOpenChange}
        title={
          <span className="flex items-center gap-3">
            <EmployeeAvatar name={employee.name} photoUrl={employee.photoUrl} size="lg" />
            <span className="flex items-center gap-2">
              {employee.name}
              {!employee.active ? <Badge variant="outline">Former</Badge> : null}
            </span>
          </span>
        }
        subtitle={[employee.title, employee.country !== "—" ? employee.country : null].filter(Boolean).join(" · ")}
        tabs={[
          { value: "overview", label: "Overview", content: overview },
          { value: "salary", label: "Salary History", content: <EmployeeSalaryHistory employeeId={employee._id} /> },
          { value: "payroll", label: "Payroll History", content: <EmployeePayrollHistory employeeId={employee._id} baseCurrency={baseCurrency} canPrepare={canPrepare} /> },
          { value: "documents", label: "Documents", content: <EmployeeDocumentsTab employeeId={employee._id} entityId={entityId} canPrepare={canPrepare} /> },
        ]}
        footer={footer}
      />
      <EmployeeFormDialog
        entityId={entityId}
        baseCurrency={baseCurrency}
        employee={employee}
        open={editing}
        onOpenChange={setEditing}
      />
      <TerminateEmployeeDialog
        employee={employee}
        open={terminating}
        onOpenChange={setTerminating}
      />
    </>
  );
}

function EmployeeSalaryHistory({ employeeId }: { employeeId: Id<"employees"> }) {
  const history = useQuery(api.employees.salaryHistory, { employeeId });
  if (history === undefined) return <LoadingBlock label="history" />;
  if (history.length === 0) {
    return <EmptyState icon={History} title="No salary changes" description="Salary edits are logged here automatically." />;
  }
  return (
    <ol className="flex flex-col gap-3" data-testid="employee-salary-history">
      {history.map((event) => (
        <li key={event.id} className="rounded-lg border p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium tabular-nums">
              {event.previousAmountMinor !== null ? (
                <>
                  <Amount amountMinor={event.previousAmountMinor} currency={event.currency} /> →{" "}
                </>
              ) : null}
              <Amount amountMinor={event.newAmountMinor} currency={event.currency} />
            </span>
            <span className="text-xs text-muted-foreground">{event.effectiveDate}</span>
          </div>
          {event.note ? <p className="mt-1 text-xs text-muted-foreground">{event.note}</p> : null}
        </li>
      ))}
    </ol>
  );
}

function EmployeePayrollHistory({
  employeeId,
  baseCurrency,
  canPrepare,
}: {
  employeeId: Id<"employees">;
  baseCurrency: string;
  canPrepare: boolean;
}) {
  const history = useQuery(api.employees.employeePayrollHistory, { employeeId });
  const sendPayslip = useAction(api.payrollEmail.sendPayslip);
  const [sendingId, setSendingId] = useState<string | null>(null);

  async function emailPayslip(lineId: string) {
    setSendingId(lineId);
    try {
      const result = await sendPayslip({ lineId: lineId as Id<"payrollRunLines">, appOrigin: window.location.origin });
      toast.success(`Payslip emailed to ${result.to}.`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not email the payslip."));
    } finally {
      setSendingId(null);
    }
  }

  if (history === undefined) return <LoadingBlock label="history" />;
  if (history.length === 0) {
    return <EmptyState icon={CalendarClock} title="No payroll runs yet" description="Runs this person appears in will show here." />;
  }
  return (
    <div className="overflow-x-auto rounded-lg border" data-testid="employee-payroll-history">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableHead className="h-8 text-xs">Period</TableHead>
            <TableHead className="h-8 text-right text-xs">Local</TableHead>
            <TableHead className="h-8 text-right text-xs">{baseCurrency} equiv</TableHead>
            <TableHead className="h-8 text-xs">Status</TableHead>
            <TableHead className="h-8 text-right text-xs">Payslip</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.map((row) => (
            <TableRow key={row.lineId}>
              <TableCell className="py-2 text-sm">{row.periodLabel || row.period}</TableCell>
              <TableCell className="py-2 text-right tabular-nums">
                <Amount amountMinor={row.finalLocalMinor} currency={row.currency} />
              </TableCell>
              <TableCell className="py-2 text-right tabular-nums">
                <Amount amountMinor={row.baseEquivalentMinor} currency={baseCurrency} />
              </TableCell>
              <TableCell className="py-2"><PayrollStatusChip status={row.status} /></TableCell>
              <TableCell className="py-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  <a
                    href={`/payroll/payslip/${row.lineId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline"
                    data-testid="employee-payslip-view"
                  >
                    View
                  </a>
                  {canPrepare ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs text-muted-foreground"
                      disabled={sendingId === row.lineId}
                      onClick={() => void emailPayslip(row.lineId)}
                      data-testid="employee-payslip-email"
                    >
                      {sendingId === row.lineId ? "Sending…" : "Email"}
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function EmployeeDocumentsTab({
  employeeId,
  entityId,
  canPrepare,
}: {
  employeeId: Id<"employees">;
  entityId: Id<"entities">;
  canPrepare: boolean;
}) {
  const docs = useQuery(api.employees.employeeDocuments, { employeeId });
  const generateUrl = useMutation(api.employees.generateEmployeeDocUploadUrl);
  const attach = useMutation(api.employees.attachEmployeeDocument);
  const removeDoc = useMutation(api.employees.removeEmployeeDocument);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onFile(file: File) {
    setUploading(true);
    try {
      const uploadUrl = await generateUrl({ entityId });
      const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      const { storageId } = await res.json();
      await attach({ employeeId, storageId, fileName: file.name, mimeType: file.type });
      toast.success(`${file.name} attached.`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not upload the file."));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="employee-documents">
      {canPrepare ? (
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()} data-testid="employee-doc-upload">
            <Paperclip data-icon="inline-start" />
            {uploading ? "Uploading…" : "Attach document"}
          </Button>
        </div>
      ) : null}
      {docs === undefined ? (
        <LoadingBlock label="documents" />
      ) : docs.length === 0 ? (
        <EmptyState icon={Paperclip} title="No documents" description="Attach a contract, ID copy, or other file." />
      ) : (
        <ul className="flex flex-col gap-2">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
              <a href={doc.url ?? "#"} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-medium hover:underline">
                {doc.fileName}
              </a>
              {canPrepare ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={async () => {
                    try {
                      await removeDoc({ documentId: doc.id as Id<"documents"> });
                    } catch (err) {
                      toast.error(getErrorMessage(err, "Could not remove."));
                    }
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TerminateEmployeeDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: FullEmployee;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const markExited = useMutation(api.employees.markExited);
  const [exitDate, setExitDate] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!reason.trim()) {
      setError("Enter a termination reason.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await markExited({ employeeId: employee._id, exitDate, exitReason: reason.trim() });
      toast.success(`${employee.name} moved to Former Employees.`);
      onOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err, "Could not terminate."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="employee-terminate-form">
        <DialogHeader>
          <DialogTitle>Terminate {employee.name}</DialogTitle>
          <DialogDescription>
            They move to Former Employees and are skipped in future runs. Nothing is deleted — you can reactivate later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2">
            <Label htmlFor="term-date">Termination date</Label>
            <Input id="term-date" type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="term-reason">Reason</Label>
            <Input
              id="term-reason"
              data-testid="employee-terminate-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Resigned, end of contract, …"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={busy} onClick={() => void submit()} data-testid="employee-terminate-submit">
            {busy ? "Saving…" : "Terminate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Add / edit an employee. Salaries draft into each period's payroll run; this
 * dialog never posts to the ledger (only approving a run does). The inner form
 * remounts on each open (DialogContent unmounts on close), so its state
 * initializes cleanly from the employee being edited without an effect.
 */
function EmployeeFormDialog({
  entityId,
  baseCurrency,
  employee,
  open,
  onOpenChange,
}: {
  entityId: Id<"entities">;
  baseCurrency: string;
  employee: FullEmployee | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="employee-form" className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <EmployeeForm
          entityId={entityId}
          baseCurrency={baseCurrency}
          employee={employee}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function EmployeeForm({
  entityId,
  baseCurrency,
  employee,
  onDone,
}: {
  entityId: Id<"entities">;
  baseCurrency: string;
  employee: FullEmployee | null;
  onDone: () => void;
}) {
  const createEmployee = useMutation(api.employees.createEmployee);
  const updateEmployee = useMutation(api.employees.updateEmployee);
  const isEdit = employee !== null;
  const bank = (employee?.payTo ?? null) as { bankName?: string; accountTitle?: string; ibanOrAccountNumber?: string } | null;

  const [f, setF] = useState({
    name: employee?.name ?? "",
    email: employee?.email ?? "",
    phone: employee?.phone ?? "",
    title: employee?.title ?? "",
    department: employee?.department ?? "",
    employmentType: employee?.employmentType ?? "",
    startDate: employee?.startDate ?? "",
    country: employee && employee.country !== "—" ? employee.country : "",
    currency: employee?.currency ?? baseCurrency,
    salary: employee ? (employee.monthlySalaryMinor / 100).toString() : "",
    payFrequency: employee?.payFrequency ?? "",
    salaryNote: "",
    paymentMethod: employee?.paymentMethod ?? "",
    bankName: bank?.bankName ?? "",
    accountTitle: bank?.accountTitle ?? "",
    ibanOrAccountNumber: bank?.ibanOrAccountNumber ?? "",
  });
  const set = (key: keyof typeof f) => (value: string) => setF((prev) => ({ ...prev, [key]: value }));
  const [active, setActive] = useState(employee?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Salaries are stored/entered in the employee's native currency. When that's
  // not the base currency, fetch the live rate the payroll engine would use and
  // show a read-only converted preview so the user sees the USD-equivalent.
  const isForeign = f.currency.trim().toUpperCase() !== baseCurrency.toUpperCase();
  const fx = useQuery(
    api.payroll.currentFxRate,
    isForeign && f.currency.trim().length === 3
      ? { entityId, localCurrency: f.currency.trim().toUpperCase() }
      : "skip",
  );
  const salaryPreviewMinor = Math.round((Number(f.salary.replace(/[,$]/g, "")) || 0) * 100);
  const convertedBaseMinor = !isForeign
    ? salaryPreviewMinor
    : fx?.rateMicros
      ? Math.round((salaryPreviewMinor * 1_000_000) / fx.rateMicros)
      : null;
  const currencyOptions = [...new Set([baseCurrency, "USD", "PKR", "INR", "EUR", "GBP", "AED", "CAD", "AUD", "SAR", f.currency].filter(Boolean))];

  async function submit() {
    const trimmedName = f.name.trim();
    const salaryMinor = Math.round((Number(f.salary) || 0) * 100);
    if (trimmedName.length < 2) {
      setError("Enter the employee's name.");
      return;
    }
    if (salaryMinor <= 0) {
      setError("Enter a positive monthly salary.");
      return;
    }
    setBusy(true);
    setError("");

    const payTo =
      f.bankName || f.accountTitle || f.ibanOrAccountNumber
        ? { bankName: f.bankName.trim(), accountTitle: f.accountTitle.trim(), ibanOrAccountNumber: f.ibanOrAccountNumber.trim() }
        : undefined;
    const profile = {
      email: f.email.trim(),
      phone: f.phone.trim(),
      title: f.title.trim(),
      department: f.department.trim(),
      ...(f.employmentType ? { employmentType: f.employmentType as "full_time" | "part_time" | "contractor" } : {}),
      startDate: f.startDate.trim(),
      ...(f.payFrequency ? { payFrequency: f.payFrequency as "hourly" | "weekly" | "semimonthly" | "monthly" } : {}),
      paymentMethod: f.paymentMethod.trim(),
      ...(payTo ? { payTo } : {}),
    };

    try {
      if (employee) {
        await updateEmployee({
          employeeId: employee._id,
          name: trimmedName,
          country: f.country.trim(),
          currency: f.currency.trim().toUpperCase(),
          monthlySalaryMinor: salaryMinor,
          active,
          ...(f.salaryNote.trim() ? { salaryNote: f.salaryNote.trim() } : {}),
          ...profile,
        });
        toast.success(`${trimmedName} updated.`);
      } else {
        await createEmployee({
          entityId,
          name: trimmedName,
          country: f.country.trim(),
          currency: f.currency.trim().toUpperCase(),
          monthlySalaryMinor: salaryMinor,
          ...profile,
        });
        toast.success(`${trimmedName} added to payroll.`);
      }
      onDone();
    } catch (err) {
      setError(getErrorMessage(err, "Could not save the employee."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit employee" : "Add employee"}</DialogTitle>
        <DialogDescription>
          Salaries draft into each period&apos;s payroll run. Saving here
          doesn&apos;t post to the ledger — only approving a run does.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <section className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Personal</h4>
          <div className="grid gap-2">
            <Label htmlFor="emp-name">Name</Label>
            <Input id="emp-name" data-testid="employee-name" value={f.name} onChange={(e) => set("name")(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="emp-email">Email</Label>
              <Input id="emp-email" type="email" value={f.email} onChange={(e) => set("email")(e.target.value)} placeholder="jane@company.com" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="emp-phone">Phone</Label>
              <Input id="emp-phone" value={f.phone} onChange={(e) => set("phone")(e.target.value)} />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Employment</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="emp-title">Job title</Label>
              <Input id="emp-title" value={f.title} onChange={(e) => set("title")(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="emp-dept">Department</Label>
              <Input id="emp-dept" value={f.department} onChange={(e) => set("department")(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Employment type</Label>
              <Select value={f.employmentType || undefined} onValueChange={(v) => set("employmentType")(v)}>
                <SelectTrigger size="sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">Full-time</SelectItem>
                  <SelectItem value="part_time">Part-time</SelectItem>
                  <SelectItem value="contractor">Contractor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="emp-start">Start date</Label>
              <Input id="emp-start" type="date" value={f.startDate} onChange={(e) => set("startDate")(e.target.value)} />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Salary</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Currency</Label>
              <Select value={f.currency} onValueChange={(v) => set("currency")(v)}>
                <SelectTrigger size="sm" data-testid="employee-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {currencyOptions.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="emp-salary">Monthly salary ({f.currency})</Label>
              <Input id="emp-salary" data-testid="employee-salary" value={f.salary} inputMode="decimal" onChange={(e) => set("salary")(e.target.value)} placeholder="0.00" className="money-figures" />
            </div>
          </div>
          {isForeign ? (
            <div className="grid gap-2">
              <Label htmlFor="emp-salary-converted">Converted ({baseCurrency})</Label>
              <Input
                id="emp-salary-converted"
                data-testid="employee-salary-converted"
                readOnly
                tabIndex={-1}
                value={convertedBaseMinor === null ? "Fetching rate…" : `≈ ${formatMinorMoney(convertedBaseMinor, { currency: baseCurrency })}`}
                className="money-figures bg-muted/40 text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">
                {fx?.rateMicros
                  ? `Auto-converted at 1 ${baseCurrency} = ${Number((fx.rateMicros / 1_000_000).toFixed(4))} ${f.currency}. Stored & paid in ${f.currency}.`
                  : `The salary is stored & paid in ${f.currency}; the ${baseCurrency} figure is an estimate.`}
              </p>
            </div>
          ) : null}
          <div className="grid gap-2">
            <Label>Pay frequency</Label>
            <Select value={f.payFrequency || undefined} onValueChange={(v) => set("payFrequency")(v)}>
              <SelectTrigger size="sm"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="semimonthly">Semi-monthly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isEdit ? (
            <div className="grid gap-2">
              <Label htmlFor="emp-salary-note">Salary change note (optional)</Label>
              <Input id="emp-salary-note" value={f.salaryNote} onChange={(e) => set("salaryNote")(e.target.value)} placeholder="e.g. Annual increment" />
              <p className="text-xs text-muted-foreground">Changing the salary appends to the salary history — the old amount is never lost.</p>
            </div>
          ) : null}
        </section>

        <section className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Location</h4>
          <div className="grid gap-2">
            <Label htmlFor="emp-country">Country</Label>
            <Input id="emp-country" value={f.country} onChange={(e) => set("country")(e.target.value)} placeholder="Pakistan" />
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment details</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="emp-method">Method</Label>
              <Input id="emp-method" value={f.paymentMethod} onChange={(e) => set("paymentMethod")(e.target.value)} placeholder="Bank transfer" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="emp-bank">Bank name</Label>
              <Input id="emp-bank" value={f.bankName} onChange={(e) => set("bankName")(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="emp-acct-title">Account title</Label>
              <Input id="emp-acct-title" value={f.accountTitle} onChange={(e) => set("accountTitle")(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="emp-iban">IBAN / Account #</Label>
              <Input id="emp-iban" value={f.ibanOrAccountNumber} onChange={(e) => set("ibanOrAccountNumber")(e.target.value)} />
            </div>
          </div>
        </section>

        {isEdit ? (
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">Active</div>
              <p className="text-xs text-muted-foreground">Inactive employees are skipped when drafting new runs.</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive" data-testid="employee-error">{error}</p> : null}
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onDone}>Cancel</Button>
        <Button size="sm" disabled={busy} onClick={() => void submit()} data-testid="employee-submit">
          {busy ? "Saving…" : isEdit ? "Save changes" : "Add employee"}
        </Button>
      </DialogFooter>
    </>
  );
}

// ─── Monthly view: every month's payroll run and its phase ────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The set of periods to show: the last 12 months + any month that has a run. */
function monthlyPeriods(currentPeriod: string, runPeriods: string[]): string[] {
  const [y, m] = currentPeriod.split("-").map(Number);
  const set = new Set<string>(runPeriods);
  for (let i = 0; i < 12; i++) {
    let year = y;
    let month = m - i;
    while (month < 1) { month += 12; year -= 1; }
    set.add(`${year}-${String(month).padStart(2, "0")}`);
  }
  return [...set].sort((a, b) => b.localeCompare(a)); // newest first
}

function PayrollMonthly({
  runs,
  baseCurrency,
  canPrepare,
  currentPeriod,
  onOpenRun,
  onGenerate,
}: {
  runs: ModuleOverview["payroll"]["runs"];
  baseCurrency: string;
  canPrepare: boolean;
  currentPeriod: string;
  onOpenRun: (id: Id<"payrollRuns">) => void;
  onGenerate: (period: string) => void;
}) {
  const runByPeriod = new Map(runs.map((run) => [run.period, run]));
  const periods = monthlyPeriods(currentPeriod, [...runByPeriod.keys()]);
  // Group periods by year for section headers.
  const byYear = new Map<string, string[]>();
  for (const period of periods) {
    const year = period.slice(0, 4);
    (byYear.get(year) ?? byYear.set(year, []).get(year)!).push(period);
  }

  return (
    <div className="flex flex-col gap-4" data-testid="payroll-monthly">
      {[...byYear.entries()].map(([year, yearPeriods]) => (
        <div key={year} className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <CalendarClock className="size-3.5" aria-hidden="true" /> {year}
          </div>
          <div className="overflow-hidden rounded-xl border">
            {yearPeriods.map((period, i) => {
              const run = runByPeriod.get(period);
              const monthName = MONTH_NAMES[Number(period.slice(5, 7)) - 1] ?? period;
              const isCurrent = period === currentPeriod;
              return (
                <div
                  key={period}
                  role={run ? "button" : undefined}
                  tabIndex={run ? 0 : undefined}
                  onClick={run ? () => onOpenRun(run.id as Id<"payrollRuns">) : undefined}
                  data-testid="payroll-monthly-row"
                  className={cn(
                    "flex items-center justify-between gap-3 px-4 py-3",
                    i > 0 && "border-t",
                    run && "cursor-pointer hover:bg-muted/40",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={cn(
                        "flex size-9 shrink-0 flex-col items-center justify-center rounded-lg text-[10px] font-medium leading-none",
                        run ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                      )}
                    >
                      <span className="text-[13px]">{period.slice(5, 7)}</span>
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium">
                        {monthName}
                        {isCurrent ? <span className="text-xs font-normal text-muted-foreground">· current</span> : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {run ? `${run.headcount} ${run.headcount === 1 ? "person" : "people"}` : "Not generated yet"}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {run ? (
                      <>
                        <span className="hidden tabular-nums text-sm sm:inline">
                          <Amount amountMinor={run.totalBaseMinor} currency={baseCurrency} />
                        </span>
                        <PayrollStatusChip status={run.status} />
                      </>
                    ) : canPrepare ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => { e.stopPropagation(); onGenerate(period); }}
                        data-testid="payroll-monthly-generate"
                      >
                        <Play data-icon="inline-start" />
                        Generate
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
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
    { key: "draft", label: "Draft" },
    { key: "submitted", label: "Submitted" },
    { key: "approved", label: "Approve" },
    { key: "paid", label: "Mark paid" },
  ];
  const activeIndex =
    status === "draft" ? 0 : status === "submitted" ? 1 : status === "approved" ? 2 : 3;
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

type RunLineGroup = {
  key: string;
  country: string;
  city: string | null;
  lines: RunLineView[];
  baseSubtotalMinor: number;
};

/** Group run lines by country then city, with a base-equivalent subtotal each. */
function groupRunLines(lines: RunLineView[]): RunLineGroup[] {
  const map = new Map<string, RunLineGroup>();
  for (const line of lines) {
    const city = line.city && line.city.trim() ? line.city.trim() : null;
    const key = `${line.country}|${city ?? ""}`;
    const group =
      map.get(key) ?? { key, country: line.country, city, lines: [], baseSubtotalMinor: 0 };
    group.lines.push(line);
    group.baseSubtotalMinor += line.baseEquivalentMinor;
    map.set(key, group);
  }
  return [...map.values()].sort(
    (a, b) => a.country.localeCompare(b.country) || (a.city ?? "").localeCompare(b.city ?? ""),
  );
}

function PayrollRunGrid({
  lines,
  baseCurrency,
  isMultiCurrency,
  editable,
  onSave,
}: {
  lines: RunLineView[];
  baseCurrency: string;
  isMultiCurrency: boolean;
  editable: boolean;
  onSave: (lineId: string, bonusMinor: number, deductionMinor: number, fxRate: string) => void;
}) {
  const baseTotalMinor = lines.reduce((sum, l) => sum + l.baseEquivalentMinor, 0);
  const groups = groupRunLines(lines);
  // Only show country · city subtotal headers when there's real grouping to do
  // (more than one location, or any city recorded) — a single flat country
  // stays clean.
  const showGroups = groups.length > 1 || groups.some((g) => g.city);
  // Total column count for group-header colSpans.
  const totalCols =
    1 /* employee */ +
    (isMultiCurrency ? 1 : 0) /* cur */ +
    1 /* base */ +
    1 /* bonus */ +
    1 /* adjustment */ +
    1 /* final */ +
    (isMultiCurrency ? 2 : 0) /* fx + equiv */ +
    1; /* paid */

  const renderLine = (line: RunLineView) => (
    <PayrollRunLineRow
      key={line.id}
      line={line}
      baseCurrency={baseCurrency}
      isMultiCurrency={isMultiCurrency}
      editable={editable}
      showCountry={!showGroups}
      onSave={(bonus, deduction, fx) => onSave(line.id, bonus, deduction, fx)}
    />
  );

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableHead className="h-8 text-xs">Employee</TableHead>
            {isMultiCurrency && <TableHead className="h-8 w-12 text-xs">Cur</TableHead>}
            <TableHead className="h-8 text-right text-xs">Base salary</TableHead>
            <TableHead className="h-8 text-right text-xs">Bonus</TableHead>
            <TableHead className="h-8 text-right text-xs">Deduction</TableHead>
            <TableHead className="h-8 text-right text-xs">Total</TableHead>
            {isMultiCurrency && <TableHead className="h-8 text-right text-xs">FX rate</TableHead>}
            {isMultiCurrency && <TableHead className="h-8 text-right text-xs">{baseCurrency} equiv</TableHead>}
            <TableHead className="h-8 w-10 text-center text-xs">Paid</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {showGroups
            ? groups.map((group) => (
                <Fragment key={group.key}>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={totalCols} className="py-1.5" data-testid="payroll-group-header">
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-1.5 text-xs font-medium">
                          <MapPin className="size-3 text-muted-foreground" aria-hidden="true" />
                          {group.country}
                          {group.city ? <span className="text-muted-foreground"> · {group.city}</span> : null}
                        </span>
                        <span className="tabular-nums text-xs font-semibold">
                          <Amount amountMinor={group.baseSubtotalMinor} currency={baseCurrency} />
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                  {group.lines.map(renderLine)}
                </Fragment>
              ))
            : lines.map(renderLine)}
        </TableBody>
        <tfoot>
          <tr className="border-t bg-muted/20">
            <td
              colSpan={totalCols - 2}
              className="px-4 py-2 text-xs text-muted-foreground"
            >
              {lines.length} employee{lines.length !== 1 ? "s" : ""}
            </td>
            <td className="px-4 py-2 text-right tabular-nums font-semibold text-sm" data-testid="payroll-base-total">
              <Amount amountMinor={baseTotalMinor} currency={baseCurrency} />
            </td>
            <td className="px-4 py-2" />
          </tr>
        </tfoot>
      </Table>
    </div>
  );
}

function PayrollRunLineRow({
  line,
  baseCurrency,
  isMultiCurrency,
  editable,
  showCountry,
  onSave,
}: {
  line: RunLineView;
  baseCurrency: string;
  isMultiCurrency: boolean;
  editable: boolean;
  showCountry: boolean;
  onSave: (bonusMinor: number, deductionMinor: number, fxRate: string) => void;
}) {
  const [bonus, setBonus] = useState(String(line.bonusMinor / 100));
  const [deduction, setDeduction] = useState(String(line.deductionMinor / 100));
  const [fxRate, setFxRate] = useState(line.fxDisplay === "—" ? "1" : line.fxDisplay);

  function commit() {
    const bonusMinor = Math.max(0, Math.round((Number(bonus.replace(/[,$]/g, "")) || 0) * 100));
    const deductionMinor = Math.max(0, Math.round((Number(deduction.replace(/[,$]/g, "")) || 0) * 100));
    onSave(bonusMinor, deductionMinor, fxRate);
  }

  return (
    <TableRow data-testid="payroll-line-row" className="hover:bg-muted/20">
      <TableCell className="py-2">
        <div className="font-medium leading-snug">{line.employeeName}</div>
        {showCountry && !isMultiCurrency && line.country !== "—" && (
          <div className="text-xs text-muted-foreground">{line.country}</div>
        )}
      </TableCell>
      {isMultiCurrency && (
        <TableCell className="py-2 text-xs text-muted-foreground">{line.currency}</TableCell>
      )}
      <TableCell className="py-2 text-right tabular-nums">
        <Amount amountMinor={line.baseSalaryMinor} currency={line.currency} />
      </TableCell>
      <TableCell className="py-2 text-right">
        {editable ? (
          <Input
            value={bonus}
            onChange={(e) => setBonus(e.target.value)}
            onBlur={commit}
            inputMode="decimal"
            className="ml-auto h-7 w-24 text-right tabular-nums"
            data-testid="payroll-bonus-input"
          />
        ) : (
          <span className="tabular-nums text-muted-foreground">
            {line.bonusMinor !== 0
              ? <Amount amountMinor={line.bonusMinor} currency={line.currency} />
              : "—"}
          </span>
        )}
      </TableCell>
      <TableCell className="py-2 text-right">
        {editable ? (
          <Input
            value={deduction}
            onChange={(e) => setDeduction(e.target.value)}
            onBlur={commit}
            inputMode="decimal"
            className="ml-auto h-7 w-24 text-right tabular-nums"
            data-testid="payroll-deduction-input"
          />
        ) : (
          <span className="tabular-nums text-muted-foreground">
            {line.deductionMinor !== 0
              ? <span className="text-destructive">−<Amount amountMinor={line.deductionMinor} currency={line.currency} /></span>
              : "—"}
          </span>
        )}
      </TableCell>
      <TableCell className="py-2 text-right tabular-nums font-medium">
        <Amount amountMinor={line.finalLocalMinor} currency={line.currency} />
      </TableCell>
      {isMultiCurrency && (
        <TableCell className="py-2 text-right">
          {editable && line.currency !== baseCurrency ? (
            <Input
              value={fxRate}
              onChange={(e) => setFxRate(e.target.value)}
              onBlur={commit}
              inputMode="decimal"
              className="ml-auto h-7 w-20 text-right tabular-nums"
              data-testid="payroll-fx-input"
            />
          ) : (
            <span className="tabular-nums text-muted-foreground text-xs">{line.fxDisplay}</span>
          )}
        </TableCell>
      )}
      {isMultiCurrency && (
        <TableCell className="py-2 text-right tabular-nums">
          <Amount amountMinor={line.baseEquivalentMinor} currency={baseCurrency} />
        </TableCell>
      )}
      <TableCell className="py-2 text-center">
        <Checkbox checked={line.paid} disabled aria-label={`${line.employeeName} paid`} />
      </TableCell>
    </TableRow>
  );
}

/**
 * Full-page payroll run detail. Used by /payroll/runs/[runId] — replaces the
 * old right-side drawer with full browser width and a proper bookmarkable URL.
 */
export function PayrollRunPage({ runId }: { runId: string }) {
  const router = useRouter();
  const detail = useQuery(api.payroll.runDetail, { runId: runId as Id<"payrollRuns"> });
  const backfill = useMutation(api.payroll.backfillRunLines);
  const updateLine = useMutation(api.payroll.updateRunLine);
  const approveRun = useMutation(api.payroll.approveRun);
  const markRunPaid = useMutation(api.payroll.markRunPaid);
  const submitRun = useMutation(api.payroll.submitRunForApproval);
  const sendRunBack = useMutation(api.payroll.sendRunBack);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [sendBackNote, setSendBackNote] = useState("");

  async function withBusy(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(getErrorMessage(err, "Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  if (detail === undefined) {
    return <LoadingBlock label="run" />;
  }
  if (detail === null) {
    return (
      <div className="flex w-full flex-col gap-5">
        <EmptyState title="Run not found" description="This payroll run may have been deleted." />
      </div>
    );
  }

  const baseCurrency = detail.entity.currency;
  const isDraft = detail.run.status === "draft";
  const isSubmitted = detail.run.status === "submitted";
  const isApproved = detail.run.status === "approved";
  const isMultiCurrency = detail.lines.some((l) => l.currency !== baseCurrency);
  const typedRunId = runId as Id<"payrollRuns">;

  return (
    <>
      <div className="flex w-full flex-col gap-6">
        {/* Page header */}
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-1 text-muted-foreground hover:text-foreground"
            onClick={() => router.push("/payroll")}
          >
            <ArrowLeft data-icon="inline-start" />
            Payroll
          </Button>
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold leading-tight">{detail.run.periodLabel}</h1>
                <PayrollStatusChip status={detail.run.status} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {isDraft
                  ? "Add bonuses/deductions on the grid, then submit for approval. Nothing posts until an approver approves."
                  : isSubmitted
                    ? "Submitted for approval. An Owner or Accountant reviews and posts it to the ledger."
                    : "Approved and posted. Mark people paid as the bank payments clear."}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* Preparer submits a draft for approval. */}
              {detail.canPrepare && isDraft && !detail.periodLocked ? (
                <Button size="sm" onClick={() => setConfirmSubmit(true)} disabled={busy} data-testid="payroll-submit">
                  Submit for approval
                </Button>
              ) : null}
              {/* Approver approves (from draft or submitted) → posts to the ledger. */}
              {detail.canApprove && (isDraft || isSubmitted) && !detail.periodLocked ? (
                <Button size="sm" onClick={() => setConfirmApprove(true)} disabled={busy} data-testid="payroll-approve">
                  Approve &amp; post
                </Button>
              ) : null}
              {/* Approver can bounce a submitted run back to the preparer. */}
              {detail.canApprove && isSubmitted ? (
                <Button size="sm" variant="outline" onClick={() => { setSendBackNote(""); setSendBackOpen(true); }} disabled={busy} data-testid="payroll-send-back">
                  Send back
                </Button>
              ) : null}
              {detail.canApprove && isApproved ? (
                <Button
                  size="sm"
                  onClick={() => withBusy(() => markRunPaid({ runId: typedRunId }))}
                  disabled={busy}
                  data-testid="payroll-mark-paid"
                >
                  Mark all paid
                </Button>
              ) : null}
              {detail.canApprove && !detail.materialized && detail.run.status === "paid" ? (
                <Button size="sm" variant="outline" onClick={() => withBusy(() => backfill({ runId: typedRunId }))} disabled={busy}>
                  Load lines
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Stepper + status banners */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <PayrollStepper status={detail.run.status} />
            {detail.periodLocked ? <CategoryChip label="Period locked" /> : null}
          </div>
          {isSubmitted ? (
            <div className="flex items-start gap-2 rounded-xl bg-warning-surface px-3 py-2.5 text-sm text-warning" data-testid="payroll-submitted-banner">
              <Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {detail.canApprove
                  ? "Submitted for approval — review the grid, then approve to post it to the ledger, or send it back for changes."
                  : "Submitted for approval. An Owner or Accountant will review and post it. It's locked from edits until then."}
              </span>
            </div>
          ) : null}
          {isApproved ? (
            <div className="flex items-start gap-2 rounded-xl bg-primary/5 px-3 py-2.5 text-sm text-primary" data-testid="payroll-approved-banner">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                Approved — recorded{" "}
                {detail.currencyTotals.map((row, index) => (
                  <span key={row.currency}>
                    {index > 0 ? " + " : ""}
                    <Amount amountMinor={row.localMinor} currency={row.currency} />
                  </span>
                ))}{" "}
                as {detail.run.periodLabel} payroll expense. Lines settle as bank payments arrive.
              </span>
            </div>
          ) : null}
          {detail.run.status === "paid" ? (
            <div className="flex items-start gap-2 rounded-xl bg-primary/5 px-3 py-2.5 text-sm text-primary">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>Settled. FX differences post automatically as a small gain/loss line.</span>
            </div>
          ) : null}
          {error ? <p className="text-sm text-negative" data-testid="payroll-error">{error}</p> : null}
        </div>

        {/* Grid / Statement tabs */}
        <Tabs defaultValue="grid">
          <TabsList>
            <TabsTrigger value="grid">Grid</TabsTrigger>
            <TabsTrigger value="statement">Statement</TabsTrigger>
          </TabsList>
          <TabsContent value="grid" className="pt-4">
            <div data-testid="payroll-run-detail" className="flex flex-col gap-2">
              {isMultiCurrency && detail.currencyTotals.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-testid="payroll-currency-totals">
                  {detail.currencyTotals.map((row, i) => (
                    <span key={row.currency}>
                      {i > 0 && <span className="mr-2">·</span>}
                      <Amount amountMinor={row.localMinor} currency={row.currency} />
                    </span>
                  ))}
                  <span className="mx-1 text-muted-foreground/50">→</span>
                  <span className="font-medium text-foreground" data-testid="payroll-base-total">
                    <Amount amountMinor={detail.baseTotalMinor} currency={baseCurrency} />
                  </span>
                </div>
              )}
              <PayrollRunGrid
                lines={detail.lines}
                baseCurrency={baseCurrency}
                isMultiCurrency={isMultiCurrency}
                editable={detail.editable}
                onSave={(lineId, bonusMinor, deductionMinor, fxRate) =>
                  withBusy(() => updateLine({ lineId: lineId as Id<"payrollRunLines">, bonusMinor, deductionMinor, fxRate }))
                }
              />
            </div>
          </TabsContent>
          <TabsContent value="statement" className="pt-4">
            <PayrollRunStatement detail={detail} />
          </TabsContent>
        </Tabs>
      </div>

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
                void withBusy(() => approveRun({ runId: typedRunId }));
              }}
            >
              Approve &amp; post
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmSubmit} onOpenChange={setConfirmSubmit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit {detail.run.periodLabel} for approval?</AlertDialogTitle>
            <AlertDialogDescription>
              This hands the run to an Owner or Accountant to review and post. It locks from further edits until it&apos;s
              approved or sent back. Nothing posts to the ledger yet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmSubmit(false);
                void withBusy(() => submitRun({ runId: typedRunId }));
              }}
            >
              Submit for approval
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={sendBackOpen} onOpenChange={setSendBackOpen}>
        <DialogContent data-testid="payroll-send-back-form">
          <DialogHeader>
            <DialogTitle>Send {detail.run.periodLabel} back to draft</DialogTitle>
            <DialogDescription>
              Tell the preparer what needs changing. Your note is saved to the run&apos;s history and sent to them so they
              can fix it and resubmit. Nothing is posted or reversed.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="send-back-note">Reason / feedback</Label>
            <Textarea
              id="send-back-note"
              data-testid="payroll-send-back-note"
              value={sendBackNote}
              onChange={(e) => setSendBackNote(e.target.value)}
              placeholder="e.g. Ahmed's bonus looks too high — please double-check before resubmitting."
              className="min-h-24"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSendBackOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={busy || sendBackNote.trim().length === 0}
              data-testid="payroll-send-back-submit"
              onClick={() => {
                const note = sendBackNote.trim();
                setSendBackOpen(false);
                void withBusy(() => sendRunBack({ runId: typedRunId, note }));
              }}
            >
              Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);
}

function PayrollRunStatement({ detail }: { detail: RunDetail }) {
  const baseCurrency = detail.entity.currency;
  const filename = `payroll-statement-${detail.run.period}`;
  const totalEmployees = detail.statementGroups.reduce((n, g) => n + g.lines.length, 0);

  function handleExport(format: ExportFormat) {
    if (format === "csv") exportCsv();
    else if (format === "xlsx") exportExcel();
    else if (format === "pdf") exportPdf();
  }

  function exportCsv() {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const header = [q("Group"), q("Employee"), q("Currency"), q("Amount"), q(`${baseCurrency} Equivalent`)];
    const lines = detail.statementGroups.flatMap((group) => [
      ...group.lines.map((line) => [
        q(group.key),
        q(line.employeeName),
        q(line.currency),
        q(fmtMoney(line.finalLocalMinor, line.currency)),
        q(fmtMoney(line.baseEquivalentMinor, baseCurrency)),
      ]),
      [q(`${group.key} Subtotal`), q(""), q(group.currency), q(fmtMoney(group.localMinor, group.currency)), q(fmtMoney(group.baseMinor, baseCurrency))],
    ]);
    const totalRow = [q(`${detail.run.periodLabel} Total`), q(""), q(baseCurrency), q(""), q(fmtMoney(detail.baseTotalMinor, baseCurrency))];
    downloadCsv(`${filename}.csv`, [header, ...lines, totalRow].map((r) => r.join(",")).join("\n"));
  }

  function exportExcel() {
    const cell = (val: string, type: "String" | "Number", style?: string) =>
      `<Cell${style ? ` ss:StyleID="${style}"` : ""}><Data ss:Type="${type}">${escapeXml(val)}</Data></Cell>`;

    const headerRow = `<Row>
        ${cell("Group", "String", "hdr")}${cell("Employee", "String", "hdr")}${cell("Currency", "String", "hdr")}${cell("Amount", "String", "hdr")}${cell(`${baseCurrency} Equivalent`, "String", "hdr")}
      </Row>`;

    const dataRows = detail.statementGroups.flatMap((group) => [
      ...group.lines.map((line) => `<Row>
        ${cell(group.key, "String")}${cell(line.employeeName, "String")}${cell(line.currency, "String")}
        ${cell((line.finalLocalMinor / 100).toFixed(2), "Number", "money")}${cell((line.baseEquivalentMinor / 100).toFixed(2), "Number", "money")}
      </Row>`),
      `<Row>
        ${cell(`${group.key} Subtotal`, "String", "sub")}${cell("", "String")}${cell(group.currency, "String")}
        ${cell((group.localMinor / 100).toFixed(2), "Number", "subm")}${cell((group.baseMinor / 100).toFixed(2), "Number", "subm")}
      </Row>`,
    ]);

    const totalRow = `<Row>
      ${cell(`${detail.run.periodLabel} Total`, "String", "tot")}${cell("", "String", "tot")}${cell(baseCurrency, "String", "tot")}
      ${cell("", "String", "tot")}${cell((detail.baseTotalMinor / 100).toFixed(2), "Number", "totm")}
    </Row>`;

    const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles>
      <Style ss:ID="hdr"><Font ss:Bold="1"/><Interior ss:Color="#F4F4F5" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
      <Style ss:ID="money"><NumberFormat ss:Format="#,##0.00"/></Style>
      <Style ss:ID="sub"><Font ss:Bold="1"/></Style>
      <Style ss:ID="subm"><Font ss:Bold="1"/><NumberFormat ss:Format="#,##0.00"/></Style>
      <Style ss:ID="tot"><Font ss:Bold="1"/><Interior ss:Color="#F0FDF4" ss:Pattern="Solid"/></Style>
      <Style ss:ID="totm"><Font ss:Bold="1"/><NumberFormat ss:Format="#,##0.00"/><Interior ss:Color="#F0FDF4" ss:Pattern="Solid"/></Style>
    </Styles><Worksheet ss:Name="Payroll Statement"><Table>${headerRow}${dataRows.join("")}${totalRow}</Table></Worksheet></Workbook>`;

    const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const groupRows = detail.statementGroups.flatMap((group) => [
      `<tr class="g-hdr"><td colspan="4">${escapeXml(group.key)}</td></tr>`,
      ...group.lines.map((line) => `<tr>
          <td class="ind">${escapeXml(line.employeeName)}</td>
          <td>${line.currency}</td>
          <td class="num">${fmtMoney(line.finalLocalMinor, line.currency)}</td>
          <td class="num">${fmtMoney(line.baseEquivalentMinor, baseCurrency)}</td>
        </tr>`),
      `<tr class="sub">
          <td colspan="2">Subtotal — ${escapeXml(group.key)}</td>
          <td class="num">${fmtMoney(group.localMinor, group.currency)}</td>
          <td class="num">${fmtMoney(group.baseMinor, baseCurrency)}</td>
        </tr>`,
    ]);

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
      <title>Payroll Statement · ${escapeXml(detail.run.periodLabel)}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Helvetica Neue',Arial,sans-serif;color:#111;font-size:11px;padding:32px}
        .hdr{border-bottom:2px solid #111;padding-bottom:14px;margin-bottom:20px}
        .hdr h1{font-size:18px;font-weight:700;margin-bottom:2px}
        .hdr .sub{font-size:12px;color:#555}
        .meta{display:flex;gap:24px;margin-top:6px;font-size:10px;color:#666}
        table{width:100%;border-collapse:collapse;margin-bottom:6px}
        th{text-align:left;padding:6px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;background:#f4f4f5;border-bottom:1px solid #ddd}
        th.num,td.num{text-align:right;font-variant-numeric:tabular-nums}
        td{padding:5px 10px;border-bottom:1px solid #f0f0f0}
        td.ind{padding-left:22px}
        tr.g-hdr td{background:#fafafa;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#777;padding:4px 10px;border-top:1px solid #e4e4e7}
        tr.sub td{background:#fafafa;font-weight:600;border-top:1px solid #ddd;border-bottom:2px solid #e4e4e7}
        tfoot tr td{background:#f0fdf4;font-weight:700;font-size:12px;border-top:2px solid #2ca01c;padding:8px 10px}
        .footer{margin-top:24px;font-size:9px;color:#999;border-top:1px solid #eee;padding-top:10px}
        @media print{@page{margin:1.5cm}body{padding:0}}
      </style></head><body>
      <div class="hdr">
        <h1>${escapeXml(detail.entity.name)}</h1>
        <div class="sub">Payroll Statement · ${escapeXml(detail.run.periodLabel)}</div>
        <div class="meta">
          <span>Base currency: ${baseCurrency}</span>
          <span>Employees: ${totalEmployees}</span>
          <span>Generated: ${today}</span>
        </div>
      </div>
      <table>
        <thead><tr>
          <th>Employee</th><th>Currency</th>
          <th class="num">Amount</th><th class="num">${escapeXml(baseCurrency)} Equivalent</th>
        </tr></thead>
        <tbody>${groupRows.join("")}</tbody>
        <tfoot><tr>
          <td colspan="3">${escapeXml(detail.run.periodLabel)} Total</td>
          <td class="num">${fmtMoney(detail.baseTotalMinor, baseCurrency)}</td>
        </tr></tfoot>
      </table>
      <div class="footer">Generated by OpenBooks · ${escapeXml(detail.entity.name)} · ${today}</div>
      <script>window.addEventListener('load',()=>{setTimeout(()=>window.print(),400)})</script>
    </body></html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (!win) {
      // Popup blocked — fall back to an anchor download so the user can open it manually.
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename}.html`;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <ExportMenu
          formats={["csv", "xlsx", "pdf"]}
          filename={filename}
          onExport={handleExport}
          data-testid="payroll-statement-csv"
        />
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
      setAiTestMessage(getErrorMessage(error, "Could not save AI autonomy."));
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
      setAiTestMessage(getErrorMessage(error, "AI connection test failed."));
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
      setAiEvalMessage(getErrorMessage(error, "Could not record the categorization eval."));
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
      setAiBatchMessage(getErrorMessage(error, "Could not run batch categorization."));
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
      setEntityMessage(getErrorMessage(error, "Could not create the Live Sandbox entity."));
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
