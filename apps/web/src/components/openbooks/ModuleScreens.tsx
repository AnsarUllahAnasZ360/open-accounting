"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Archive,
  Building2,
  CheckCircle2,
  ChevronLeft,
  Download,
  FileUp,
  History,
  Merge,
  Pencil,
  Plus,
  Printer,
  ReceiptText,
  Search,
  SlidersHorizontal,
  Sparkles,
  ToggleLeft,
  UserPlus,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { Amount, AgingMiniBar, CategoryChip, EmptyState, StatCard, formatMinorMoney } from "@/components/openbooks/primitives";
import {
  type BillRow,
  type ContactRow,
  type InvoiceRow,
  type ModuleOverview,
  statusLabel,
} from "@/components/openbooks/module-helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { aiAutonomyOptions, frontendAiStatus, type AiAutonomyMode } from "@/lib/openbooks/ai";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { api } from "../../../../../convex/_generated/api";

function useModuleOverview() {
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

function moneyTone(amountMinor: number) {
  return amountMinor > 0 ? "income" : "expense";
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

export function ContactsScreen() {
  const data = useModuleOverview();
  const searchParams = useSearchParams();
  const focusContactId = searchParams.get("contact");
  const [role, setRole] = useState<"all" | "customer" | "vendor">("all");
  const [search, setSearch] = useState("");
  // Seed selection from the ⌘K deep-link (/contacts?contact=<id>); later clicks
  // override it.
  const [selectedId, setSelectedId] = useState<string | null>(focusContactId);

  if (data === undefined) return <LoadingBlock label="contacts" />;
  if (!data.entity) return <NoEntityState />;

  const currency = data.entity.currency;
  const filtered = data.contacts.rows.filter((contact) => {
    const roleMatch = role === "all" || contact.roles.includes(role);
    const text = `${contact.name} ${contact.email ?? ""} ${contact.aliases.join(" ")}`.toLowerCase();
    return roleMatch && text.includes(search.trim().toLowerCase());
  });
  const selected =
    data.contacts.selectedProfile && (!selectedId || data.contacts.selectedProfile.id === selectedId)
      ? data.contacts.selectedProfile
      : data.contacts.rows.find((contact) => contact.id === selectedId) ?? data.contacts.selectedProfile;

  return (
    <div className="space-y-5" data-testid="m6-contacts-screen">
      <ModuleIntro
        title="Contacts directory"
        description="Customers, vendors, and recurring payees live in one directory. The profile view ties each contact to open receivables, open payables, and the default-category rule affordance."
        action={
          <Button variant="outline" size="sm">
            <UserPlus className="size-4" />
            Add contact
          </Button>
        }
      />

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="shadow-xs">
          <CardHeader className="space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <CardTitle className="text-base">Directory</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                {(["all", "customer", "vendor"] as const).map((item) => (
                  <Button
                    key={item}
                    size="sm"
                    variant={role === item ? "default" : "outline"}
                    onClick={() => setRole(item)}
                    className="capitalize"
                  >
                    {item === "all" ? "All" : `${item}s`}
                  </Button>
                ))}
              </div>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search contacts or aliases"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Open balance</TableHead>
                  <TableHead className="text-right">This year</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((contact) => (
                  <TableRow
                    key={contact.id}
                    data-testid="contact-row"
                    className="cursor-pointer"
                    onClick={() => setSelectedId(contact.id)}
                  >
                    <TableCell>
                      <div className="font-medium">{contact.name}</div>
                      <div className="text-xs text-muted-foreground">{contact.aliases.slice(0, 2).join(" · ")}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {contact.roles.map((item) => <CategoryChip key={item} label={item} />)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Amount amountMinor={contact.openReceivableMinor - contact.openPayableMinor} currency={currency} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Amount amountMinor={contact.totalThisYearMinor} currency={currency} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <ContactProfile contact={selected} currency={data.entity.currency} />
      </section>
    </div>
  );
}

function ContactProfile({
  contact,
  currency,
}: {
  contact: ModuleOverview["contacts"]["selectedProfile"] | ContactRow | null;
  currency: string;
}) {
  if (!contact) {
    return (
      <Card className="shadow-xs">
        <CardContent className="p-4">
          <EmptyState title="No contact selected" description="Choose a customer or vendor to review their profile." />
        </CardContent>
      </Card>
    );
  }
  const history = "history" in contact ? contact.history : [];
  const mergeFlow = "mergeFlow" in contact ? contact.mergeFlow : null;

  return (
    <Card className="shadow-xs" data-testid="contact-profile">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{contact.name}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{contact.email ?? "No email on file"}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-1">
            {contact.roles.map((role) => <CategoryChip key={role} active label={role} />)}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
          <StatCard label="Open A/R" value={<Amount amountMinor={contact.openReceivableMinor} currency={currency} />} />
          <StatCard label="Open A/P" value={<Amount amountMinor={contact.openPayableMinor} currency={currency} />} />
          <StatCard label="This year" value={<Amount amountMinor={contact.totalThisYearMinor} currency={currency} />} />
        </div>

        <div className="rounded-lg border p-3">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 size-4 text-primary" />
            <div>
              <div className="text-sm font-medium">Default category as rule</div>
              <p className="mt-1 text-sm text-muted-foreground">{contact.defaultCategoryRule.label}</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border p-3">
          <div className="flex items-start gap-2">
            <Merge className="mt-0.5 size-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">Merge duplicates</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {mergeFlow ? `${mergeFlow.suggestion}. ${mergeFlow.reason}` : "Duplicate detection needs candidate rows from the backend."}
              </p>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2 text-sm font-medium">Recent history</div>
          <div className="divide-y rounded-lg border">
            {history.slice(0, 5).map((item) => (
              <div key={item.id} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{item.label}</div>
                  <div className="text-xs text-muted-foreground">{item.date} · {statusLabel(item.status)}</div>
                </div>
                <Amount amountMinor={item.amountMinor} currency={currency} tone={moneyTone(item.amountMinor)} />
              </div>
            ))}
            {history.length === 0 ? <div className="p-3 text-sm text-muted-foreground">No history yet.</div> : null}
          </div>
        </div>
      </CardContent>
    </Card>
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

      <section className="grid gap-4 md:grid-cols-4">
        <StatCard label="Open total" value={<Amount amountMinor={data.invoices.kpis.openMinor} currency={data.entity.currency} />} />
        <StatCard label="Overdue" value={<Amount amountMinor={data.invoices.kpis.overdueMinor} currency={data.entity.currency} />} />
        <StatCard label="Paid last 30d" value={<Amount amountMinor={data.invoices.kpis.paidLast30Minor} currency={data.entity.currency} />} />
        <StatCard label="Avg days to pay" value={<span className="money-figures">{data.invoices.kpis.averageDaysToPay}</span>} detail="Demo estimate" />
      </section>

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
  const generateReceiptUploadUrl = useMutation(api.receipts.generateUploadUrl);
  const recordReceiptUpload = useMutation(api.receipts.recordUpload);
  const manualMatchReceipt = useMutation(api.receipts.manualMatch);
  const createExpenseFromReceipt = useMutation(api.receipts.createExpenseFromReceipt);
  const extractReceiptWithBedrock = useAction(api.receipts.extractWithBedrock);
  const [selectedBill, setSelectedBill] = useState<BillRow | null>(null);
  // C5 — mark-paid settlement: the bill whose match picker is open.
  const [payBill, setPayBill] = useState<BillRow | null>(null);
  const [documentKind, setDocumentKind] = useState<"receipt" | "bill">("receipt");
  const [vendor, setVendor] = useState("");
  const [receiptDate, setReceiptDate] = useState("");
  const [receiptAmount, setReceiptAmount] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  if (data === undefined) return <LoadingBlock label="bills" />;
  if (!data.entity) return <NoEntityState />;
  const entity = data.entity;

  async function uploadReceiptFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMessage("");
    try {
      const uploadUrl = await generateReceiptUploadUrl({ entityId: entity.id as Id<"entities"> });
      const uploadResult = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!uploadResult.ok) {
        throw new Error("Receipt upload failed before it reached Convex storage.");
      }
      const { storageId } = await uploadResult.json() as { storageId: string };
      const hasManualOverrides = Boolean(vendor.trim() || receiptDate.trim() || receiptAmount.trim());
      const result = await recordReceiptUpload({
        entityId: entity.id as Id<"entities">,
        kind: documentKind,
        storageId: storageId as Id<"_storage">,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        vendor: vendor.trim() || undefined,
        date: receiptDate.trim() || undefined,
        totalMinor: moneyInputToMinor(receiptAmount),
        currency: entity.currency,
      });
      const bedrockResult = hasManualOverrides
        ? null
        : await extractReceiptWithBedrock({ documentId: result.documentId });
      const extractionLabel = bedrockResult?.mode === "pdf_text" ? "PDF text" : "Bedrock";
      setUploadMessage(
        bedrockResult?.mode === "bedrock" || bedrockResult?.mode === "pdf_text"
          ? bedrockResult.status === "matched"
            ? `Uploaded ${file.name}: ${extractionLabel} extracted ${bedrockResult.vendor} and auto-matched it.`
            : `Uploaded ${file.name}: ${extractionLabel} extracted ${bedrockResult.vendor}; queued for match.`
          : result.status === "matched"
          ? `Uploaded ${file.name}: auto-matched to a bank transaction.`
          : bedrockResult
            ? `Uploaded ${file.name}: queued for manual match. ${"reason" in bedrockResult ? bedrockResult.reason : bedrockResult.notes}`
            : `Uploaded ${file.name}: queued for manual match.`,
      );
      setVendor("");
      setReceiptDate("");
      setReceiptAmount("");
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : "Receipt upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function matchSuggestedCandidate(document: {
    id: string;
    candidateTransaction?: { id: string; merchant: string } | null;
  }) {
    const candidate = document.candidateTransaction;
    if (!candidate) return;
    setUploadMessage("");
    try {
      await manualMatchReceipt({
        documentId: document.id as Id<"documents">,
        transactionId: candidate.id as Id<"transactions">,
      });
      setUploadMessage(`Manual match saved to ${candidate.merchant}.`);
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : "Manual match failed.");
    }
  }

  async function createExpenseForReceipt(document: {
    id: string;
    vendor: string;
  }) {
    setUploadMessage("");
    try {
      const result = await createExpenseFromReceipt({
        documentId: document.id as Id<"documents">,
      });
      setUploadMessage(
        result.status === "duplicate"
          ? `Expense already exists for ${document.vendor}.`
          : `Expense created for ${document.vendor}.`,
      );
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : "Could not create expense from receipt.");
    }
  }

  return (
    <div className="space-y-5" data-testid="m6-bills-screen">
      <ModuleIntro
        title="Bills and money you owe"
        description="What you owe and when it's due — grouped by due window. Mark a bill paid to match it to a bank transaction (the payable clears and the transaction is consumed). Upload a PDF or receipt to extract a prefilled bill."
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <label htmlFor="m11-receipt-file">
                <FileUp className="size-4" />
                Upload file
              </label>
            </Button>
            <AddBillModal entityId={entity.id as Id<"entities">} />
          </div>
        }
      />

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label="Open total" value={<span data-testid="bills-open-total"><Amount amountMinor={data.bills.kpis.openMinor} currency={data.entity.currency} /></span>} />
        <StatCard label="Due this week" value={<Amount amountMinor={data.bills.kpis.dueThisWeekMinor} currency={data.entity.currency} />} />
        <StatCard label="Overdue" value={<Amount amountMinor={data.bills.kpis.overdueMinor} currency={data.entity.currency} />} />
      </section>

      <Card className="shadow-xs" data-testid="m11-receipt-upload-panel">
        <CardHeader>
          <CardTitle className="text-base">Receipt and bill upload</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-lg border border-dashed bg-muted/20 p-4">
              <div className="flex items-start gap-3">
                <FileUp className="mt-0.5 size-5 text-primary" />
                <div className="min-w-0">
                  <div className="text-sm font-medium">Upload evidence</div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{data.bills.uploadPdf.reason}</p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Type</span>
                  <select
                    className="h-9 w-full rounded-lg border bg-background px-3 text-sm"
                    value={documentKind}
                    onChange={(event) => setDocumentKind(event.target.value as "receipt" | "bill")}
                  >
                    <option value="receipt">Receipt</option>
                    <option value="bill">Bill PDF</option>
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Vendor override</span>
                  <Input value={vendor} placeholder="Optional" onChange={(event) => setVendor(event.target.value)} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Date override</span>
                  <Input type="date" value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Amount override</span>
                  <Input inputMode="decimal" value={receiptAmount} placeholder="42.00" onChange={(event) => setReceiptAmount(event.target.value)} />
                </label>
              </div>
              <input
                id="m11-receipt-file"
                data-testid="m11-receipt-file"
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg,application/pdf"
                disabled={uploading}
                onChange={(event) => void uploadReceiptFiles(event.currentTarget.files)}
              />
              <Button asChild className="mt-4 w-full" disabled={uploading}>
                <label htmlFor="m11-receipt-file">
                  <FileUp className="size-4" />
                  {uploading ? "Uploading..." : "Choose file"}
                </label>
              </Button>
              {uploadMessage ? (
                <div className="mt-3 rounded-lg border bg-primary/5 p-3 text-sm text-primary" data-testid="m11-receipt-upload-message">
                  {uploadMessage}
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border">
              <div className="border-b px-3 py-2 text-sm font-medium">Uploaded evidence</div>
              <div className="divide-y">
                {data.bills.uploadPdf.documents.slice(0, 6).map((document) => (
                  <div key={document.id} className="grid gap-3 px-3 py-3 text-sm md:grid-cols-[1fr_auto] md:items-start" data-testid="m11-receipt-row">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{document.vendor}</span>
                        <Badge variant="outline" className="capitalize">{document.status}</Badge>
                        <CategoryChip label={`${Math.round(document.extractionConfidence * 100)}%`} />
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {document.kind} · {document.date} · {document.fileName ?? "seeded document"}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{document.extractionNotes}</p>
                      {document.matchedTransaction ? (
                        <div className="mt-2 text-xs text-primary">
                          Matched to {document.matchedTransaction.merchant} on {document.matchedTransaction.date}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-start gap-2 md:items-end">
                      <Amount amountMinor={document.totalMinor} currency={document.currency} />
                      {document.fileUrl ? (
                        <Button asChild size="sm" variant="outline">
                          <a href={document.fileUrl} target="_blank" rel="noreferrer">Preview</a>
                        </Button>
                      ) : null}
                      {document.status !== "matched" ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!document.candidateTransaction}
                            onClick={() => void matchSuggestedCandidate(document)}
                          >
                            Confirm suggested match
                          </Button>
                          {document.kind === "receipt" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid="receipt-create-expense"
                              onClick={() => void createExpenseForReceipt(document)}
                            >
                              Create expense
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
                {data.bills.uploadPdf.documents.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">No uploaded receipts yet.</div>
                ) : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          {data.bills.groups.map((group) => (
            <Card key={group.key} className="shadow-xs">
              <CardHeader>
                <CardTitle className="text-base">{group.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y rounded-lg border">
                  {group.rows.map((bill) => (
                    <div
                      key={bill.id}
                      className="grid gap-2 px-3 py-3 text-sm md:grid-cols-[1fr_auto_auto_auto] md:items-center"
                      data-testid="bill-row"
                    >
                      <button type="button" className="text-left" onClick={() => setSelectedBill(bill)}>
                        <span className="block font-medium">{bill.vendorName}</span>
                        <span className="text-xs text-muted-foreground">Due {bill.dueDate} · {statusLabel(bill.postingAffordance)}</span>
                      </button>
                      {statusChip(bill.status)}
                      <Amount amountMinor={bill.totalMinor} currency={bill.currency} />
                      {bill.status === "open" ? (
                        <Button size="sm" variant="outline" data-testid="bill-mark-paid" onClick={() => setPayBill(bill)}>
                          <CheckCircle2 className="size-3.5" /> Mark paid
                        </Button>
                      ) : bill.status === "paid" ? (
                        <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 text-[11.5px] font-medium text-primary">
                          <CheckCircle2 className="size-3" /> Paid
                        </span>
                      ) : <span />}
                    </div>
                  ))}
                  {group.rows.length === 0 ? <div className="p-3 text-sm text-muted-foreground">No bills in this group.</div> : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle className="text-base">Selected bill</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-3">
              <div className="flex items-start gap-2">
                <ReceiptText className="mt-0.5 size-4 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{selectedBill ? selectedBill.vendorName : "No bill selected"}</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedBill
                      ? `Due ${selectedBill.dueDate} · ${statusLabel(selectedBill.status)}`
                      : "Choose a bill to review it, or hit Mark paid on an open bill to settle it against a bank transaction."}
                  </p>
                </div>
              </div>
            </div>
            {selectedBill && selectedBill.status === "open" ? (
              <Button className="w-full" data-testid="bill-detail-mark-paid" onClick={() => setPayBill(selectedBill)}>
                <CheckCircle2 className="size-4" /> Mark paid &amp; match
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Bills post as money you owe the moment you add them, and clear when the payment shows up in your bank feed — true accrual books without the homework.
            </p>
            <p className="text-xs text-muted-foreground">Partial payments are out of scope in this version — settle the full balance.</p>
          </CardContent>
        </Card>
      </section>

      {payBill ? (
        <BillMatchPicker
          billId={payBill.id as Id<"bills">}
          vendorName={payBill.vendorName}
          onClose={() => setPayBill(null)}
        />
      ) : null}
    </div>
  );
}

function BillMatchPicker({ billId, vendorName, onClose }: { billId: Id<"bills">; vendorName: string; onClose: () => void }) {
  const picker = useQuery(api.bills.matchCandidates, { billId });
  const markPaid = useMutation(api.bills.markPaid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function settle(transactionId?: string) {
    setBusy(true);
    setError("");
    try {
      await markPaid({ billId, transactionId: transactionId ? (transactionId as Id<"transactions">) : undefined, scheduleExpected: transactionId ? undefined : true });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not settle the bill.");
    } finally {
      setBusy(false);
    }
  }

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
        <div className="space-y-2">
          {picker?.candidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              data-testid="bill-match-candidate"
              disabled={busy}
              onClick={() => settle(candidate.id)}
              className={`flex w-full items-center gap-3 rounded-[11px] border p-3 text-left transition hover:border-primary/40 ${candidate.suggested ? "border-primary/30 bg-primary/5" : ""}`}
            >
              <span className="inline-flex size-6 items-center justify-center rounded-md bg-foreground text-[9px] font-bold text-background">{candidate.merchant.slice(0, 2).toUpperCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{candidate.merchant}</span>
                <span className="money-figures block text-[11.5px] text-muted-foreground">{candidate.date}</span>
              </span>
              <Amount amountMinor={candidate.amountMinor} currency={candidate.currency} tone="expense" />
              {candidate.suggested ? <Badge variant="outline" className="border-primary/30 bg-primary/10 text-[10px] text-primary">best match</Badge> : null}
            </button>
          ))}
          {picker && picker.candidates.length === 0 ? (
            <p className="rounded-[11px] border border-dashed p-3 text-sm text-muted-foreground">No matching bank transaction yet. Schedule an expected match and it settles when the payment arrives.</p>
          ) : null}
          {error ? <p className="text-sm text-destructive" data-testid="bill-match-error">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="ghost" size="sm" data-testid="bill-schedule-expected" disabled={busy} onClick={() => settle()}>No match yet — expect one</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddBillModal({ entityId }: { entityId: Id<"entities"> }) {
  const createBill = useMutation(api.bills.createBill);
  const [open, setOpen] = useState(false);
  const [vendorName, setVendorName] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    const totalMinor = moneyInputToMinor(amount);
    if (!vendorName.trim()) { setError("Who do you owe?"); return; }
    if (!totalMinor || totalMinor <= 0) { setError("Enter a positive amount."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) { setError("Pick a due date."); return; }
    setBusy(true); setError("");
    try {
      await createBill({ entityId, vendorName: vendorName.trim(), totalMinor, dueDate });
      setOpen(false);
      setVendorName(""); setAmount(""); setDueDate("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the bill.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="bills-add-bill"><Plus className="size-4" /> Add bill</Button>
      </DialogTrigger>
      <DialogContent data-testid="add-bill-modal">
        <DialogHeader>
          <DialogTitle>New bill</DialogTitle>
          <DialogDescription>Type it in below. To extract a bill from a PDF, use Upload file — image uploads work today; PDF text extraction lands in a later epic.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2">
            <Label>Vendor</Label>
            <Input data-testid="bill-vendor" value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="Who do you owe?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Amount</Label>
              <Input data-testid="bill-amount" value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} placeholder="$0.00" className="money-figures" />
            </div>
            <div className="grid gap-2">
              <Label>Due date</Label>
              <Input data-testid="bill-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" data-testid="bill-create" disabled={busy} onClick={handleCreate}>{busy ? "Adding…" : "Add bill"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PayrollScreen() {
  const data = useModuleOverview();
  const [tab, setTab] = useState<"employees" | "runs" | "statement">("runs");
  const [openRunId, setOpenRunId] = useState<Id<"payrollRuns"> | null>(null);
  const startRun = useMutation(api.payroll.startRun);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("");

  if (data === undefined) return <LoadingBlock label="payroll" />;
  if (!data.entity) return <NoEntityState />;

  const baseCurrency = data.entity.currency;
  const entityId = data.entity.id as Id<"entities">;
  const hasJuneRun = data.payroll.runs.some((run) => run.period === "2026-06");

  async function runJune() {
    setStarting(true);
    setMessage("");
    try {
      const result = await startRun({ entityId, period: "2026-06" });
      setOpenRunId(result.runId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start the run.");
    } finally {
      setStarting(false);
    }
  }

  if (openRunId) {
    return <PayrollRunDetail runId={openRunId} onBack={() => setOpenRunId(null)} />;
  }

  return (
    <div className="space-y-5" data-testid="m6-payroll-screen">
      <ModuleIntro
        title="Payroll"
        description="A register, not a processor — you pay people your way, the books stay right. Open a run to review the editable grid, approve it, then mark people paid."
        action={
          <div className="flex flex-wrap gap-2">
            {(["employees", "runs", "statement"] as const).map((item) => (
              <Button key={item} size="sm" variant={tab === item ? "default" : "outline"} onClick={() => setTab(item)} className="capitalize">
                {item}
              </Button>
            ))}
          </div>
        }
      />

      <section className="grid gap-4 md:grid-cols-4">
        {data.payroll.currencyTotals.map((row) => (
          <StatCard
            key={row.currency}
            label={`${row.currency} payroll`}
            value={<Amount amountMinor={row.localMinor} currency={row.currency} />}
            detail={`${baseCurrency} base`}
          />
        ))}
        <StatCard
          label="Headcount"
          value={<span className="money-figures">{data.payroll.employees.filter((employee) => employee.active).length}</span>}
          detail="Active employees"
        />
      </section>

      {message ? <p className="text-sm text-destructive">{message}</p> : null}

      {tab === "employees" ? <PayrollEmployees data={data} /> : null}
      {tab === "runs" ? (
        <PayrollRuns
          data={data}
          onOpenRun={setOpenRunId}
          onRunJune={runJune}
          canRunJune={!hasJuneRun}
          starting={starting}
        />
      ) : null}
      {tab === "statement" ? <PayrollStatement data={data} /> : null}
    </div>
  );
}

function PayrollEmployees({ data }: { data: ModuleOverview }) {
  return (
    <Card className="shadow-xs">
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <CardTitle className="text-base">Employees</CardTitle>
        <Button size="sm" variant="outline">
          <UserPlus className="size-4" />
          Add employee
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>FX</TableHead>
              <TableHead className="text-right">Local salary</TableHead>
              <TableHead className="text-right">Base</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.payroll.employees.map((employee) => (
              <TableRow key={employee.id}>
                <TableCell>
                  <div className="font-medium">{employee.name}</div>
                  <div className="text-xs text-muted-foreground">{employee.active ? "Active" : "Inactive"}</div>
                </TableCell>
                <TableCell>{employee.country}</TableCell>
                <TableCell className="text-muted-foreground">{employee.fxDisplay}</TableCell>
                <TableCell className="text-right">
                  <Amount amountMinor={employee.monthlySalaryMinor} currency={employee.currency} />
                </TableCell>
                <TableCell className="text-right">
                  <Amount amountMinor={employee.baseAmountMinor} currency={data.entity?.currency} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PayrollRuns({
  data,
  onOpenRun,
  onRunJune,
  canRunJune,
  starting,
}: {
  data: ModuleOverview;
  onOpenRun: (id: Id<"payrollRuns">) => void;
  onRunJune: () => void;
  canRunJune: boolean;
  starting: boolean;
}) {
  return (
    <Card className="shadow-xs">
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <CardTitle className="text-base">Runs</CardTitle>
        {canRunJune ? (
          <Button size="sm" onClick={onRunJune} disabled={starting} data-testid="payroll-run-june">
            {starting ? "Starting…" : "Run payroll · June"}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>People</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Base total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.payroll.runs.map((run) => (
              <TableRow
                key={run.id}
                data-testid="payroll-run-row"
                className="cursor-pointer"
                onClick={() => onOpenRun(run.id as Id<"payrollRuns">)}
              >
                <TableCell className="money-figures font-medium">{run.period}</TableCell>
                <TableCell className="money-figures">{run.headcount}</TableCell>
                <TableCell>{statusChip(run.status)}</TableCell>
                <TableCell className="text-right">
                  <Amount amountMinor={run.totalBaseMinor} currency={data.entity?.currency} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PayrollRunDetail({ runId, onBack }: { runId: Id<"payrollRuns">; onBack: () => void }) {
  const detail = useQuery(api.payroll.runDetail, { runId });
  const backfill = useMutation(api.payroll.backfillRunLines);
  const updateLine = useMutation(api.payroll.updateRunLine);
  const approveRun = useMutation(api.payroll.approveRun);
  const markRunPaid = useMutation(api.payroll.markRunPaid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<"grid" | "statement">("grid");

  if (detail === undefined) return <LoadingBlock label="payroll run" />;
  if (detail === null) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="size-4" /> Runs
        </Button>
        <EmptyState title="Run not found" />
      </div>
    );
  }

  const baseCurrency = detail.entity.currency;
  const isDraft = detail.run.status === "draft";
  const isApproved = detail.run.status === "approved";

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

  return (
    <div className="space-y-4" data-testid="payroll-run-detail">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="payroll-back">
          <ChevronLeft className="size-4" /> Runs
        </Button>
        <h2 className="text-lg font-semibold">{detail.run.periodLabel} run</h2>
        {statusChip(detail.run.status)}
        {detail.periodLocked ? <CategoryChip label="Period locked" /> : null}
        <div className="ml-auto flex items-center gap-2">
          <Button variant={view === "grid" ? "default" : "outline"} size="sm" onClick={() => setView("grid")}>
            Grid
          </Button>
          <Button variant={view === "statement" ? "default" : "outline"} size="sm" onClick={() => setView("statement")}>
            Statement
          </Button>
          {isDraft && !detail.periodLocked ? (
            <Button size="sm" onClick={() => withBusy(() => approveRun({ runId }))} disabled={busy} data-testid="payroll-approve">
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
        </div>
      </div>

      {isApproved ? (
        <div className="flex items-center gap-2 rounded-[11px] bg-primary/5 px-4 py-2.5 text-sm text-primary" data-testid="payroll-approved-banner">
          <CheckCircle2 className="size-4" />
          Approved — recorded {detail.currencyTotals.map((row) => `${row.currency} ${row.localMinor / 100}`).join(" + ")} as {detail.run.periodLabel} payroll
          expense. Lines settle as the bank payments arrive.
        </div>
      ) : null}
      {detail.run.status === "paid" ? (
        <div className="flex items-center gap-2 rounded-[11px] bg-primary/5 px-4 py-2.5 text-sm text-primary">
          <CheckCircle2 className="size-4" />
          Settled. FX differences between approval and settlement post automatically as a small gain/loss line.
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive" data-testid="payroll-error">{error}</p> : null}

      {view === "statement" ? (
        <PayrollRunStatement detail={detail} />
      ) : (
        <Card className="shadow-xs">
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead className="text-right">Base salary</TableHead>
                    <TableHead className="text-right">Adjustment</TableHead>
                    <TableHead className="text-right">Final</TableHead>
                    <TableHead className="text-right">FX rate</TableHead>
                    <TableHead className="text-right">{baseCurrency} equiv</TableHead>
                    <TableHead className="text-center">Paid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.lines.map((line) => (
                    <PayrollRunLineRow
                      key={line.id}
                      line={line}
                      baseCurrency={baseCurrency}
                      editable={detail.editable}
                      onSave={(adjustmentMinor, fxRate) =>
                        withBusy(() => updateLine({ lineId: line.id as Id<"payrollRunLines">, adjustmentMinor, fxRate }))
                      }
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-col gap-2 border-t px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span className="money-figures text-muted-foreground" data-testid="payroll-currency-totals">
                {detail.currencyTotals.map((row) => (
                  <span key={row.currency} className="mr-3">
                    <Amount amountMinor={row.localMinor} currency={row.currency} />
                  </span>
                ))}
              </span>
              <span>
                Total in {baseCurrency}:{" "}
                <span className="money-figures text-base font-semibold" data-testid="payroll-base-total">
                  <Amount amountMinor={detail.baseTotalMinor} currency={baseCurrency} />
                </span>
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type RunDetail = NonNullable<FunctionReturnType<typeof api.payroll.runDetail>>;
type RunLineView = RunDetail["lines"][number];

function PayrollRunLineRow({
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
    <TableRow data-testid="payroll-line-row">
      <TableCell>
        <div className="font-medium">{line.employeeName}</div>
        <div className="text-xs text-muted-foreground">{line.country} · {line.currency}</div>
      </TableCell>
      <TableCell className="text-right">
        <Amount amountMinor={line.baseSalaryMinor} currency={line.currency} />
      </TableCell>
      <TableCell className="text-right">
        {editable ? (
          <Input
            value={adjustment}
            onChange={(event) => setAdjustment(event.target.value)}
            onBlur={commit}
            inputMode="decimal"
            className="ml-auto h-8 w-24 text-right"
            data-testid="payroll-adjustment-input"
          />
        ) : (
          <Amount amountMinor={line.adjustmentMinor} currency={line.currency} signed />
        )}
      </TableCell>
      <TableCell className="text-right font-medium">
        <Amount amountMinor={line.finalLocalMinor} currency={line.currency} />
      </TableCell>
      <TableCell className="text-right">
        {editable && line.currency !== baseCurrency ? (
          <Input
            value={fxRate}
            onChange={(event) => setFxRate(event.target.value)}
            onBlur={commit}
            inputMode="decimal"
            className="ml-auto h-8 w-20 text-right"
            data-testid="payroll-fx-input"
          />
        ) : (
          <span className="money-figures text-muted-foreground">{line.fxDisplay}</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Amount amountMinor={line.baseEquivalentMinor} currency={baseCurrency} />
      </TableCell>
      <TableCell className="text-center">
        <input
          type="checkbox"
          checked={line.paid}
          readOnly
          className="size-4 align-middle accent-[#2ca01c]"
          aria-label={`${line.employeeName} paid`}
        />
      </TableCell>
    </TableRow>
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
    <Card className="shadow-xs">
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <CardTitle className="text-base">Payroll statement · {detail.run.periodLabel}</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" /> Print
          </Button>
          <Button size="sm" onClick={exportCsv} data-testid="payroll-statement-csv">
            <Download className="size-4" /> CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {detail.statementGroups.map((group) => (
          <div key={group.key} className="rounded-lg border">
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
        <div className="flex items-center justify-between rounded-lg bg-primary/5 px-4 py-3 text-sm font-semibold text-primary">
          <span>{detail.run.periodLabel} total</span>
          <Amount amountMinor={detail.baseTotalMinor} currency={baseCurrency} className="text-base" />
        </div>
      </CardContent>
    </Card>
  );
}

function PayrollStatement({ data }: { data: ModuleOverview }) {
  return (
    <Card className="shadow-xs">
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle className="text-base">Printable statement</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Grouped by employee with local and base currency totals. Open a run for its own statement.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" />
            Print
          </Button>
          <Button size="sm" onClick={() => downloadCsv("openbooks-payroll-statement.csv", data.payroll.statementCsv)}>
            <Download className="size-4" />
            CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
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
            {data.payroll.statementRows.map((row) => (
              <TableRow key={row.employeeName}>
                <TableCell className="font-medium">{row.employeeName}</TableCell>
                <TableCell>{row.country}</TableCell>
                <TableCell className="text-muted-foreground">{row.fxDisplay}</TableCell>
                <TableCell className="text-right">
                  <Amount amountMinor={row.localMinor} currency={row.currency} />
                </TableCell>
                <TableCell className="text-right">
                  <Amount amountMinor={row.baseMinor} currency={data.entity?.currency} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
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
      const result = await categorizePendingTransactions({
        entityId: data.entity.id as Id<"entities">,
        limit: 10,
      });
      const status = result.batchStatus ? ` ${aiBatchStatusLabel(result.batchStatus)}.` : "";
      const degraded = result.degradedCount > 0 ? ` ${result.degradedCount} degraded.` : "";
      const fallback = result.fallbackCount > 0 ? ` ${result.fallbackCount} fallback.` : "";
      setAiBatchMessage(
        `${result.attemptedCount} checked. ${result.postedCount} posted, ${result.needsReviewCount} updated for review, ${result.skippedCount} skipped.${status}${degraded}${fallback}`,
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
        <Badge variant="outline">{aiStatus.mode === "active" ? "Bedrock active" : "Degraded mode"}</Badge>
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
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Bedrock is the v1 target when env is present.</p>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs font-medium uppercase text-muted-foreground">Chat model</div>
            <div className="mt-2 text-sm font-medium">{aiStatus.chatModel}</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Loaded from AI_MODEL after backend provider wiring.</p>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs font-medium uppercase text-muted-foreground">Embeddings</div>
            <div className="mt-2 text-sm font-medium">{aiStatus.embeddingsModel}</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Loaded from AI_EMBEDDINGS_MODEL for memory search.</p>
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
              Runs memory and Bedrock categorization on imported transactions still waiting in review.
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
