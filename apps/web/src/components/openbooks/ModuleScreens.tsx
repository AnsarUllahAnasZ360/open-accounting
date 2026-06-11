"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import {
  Archive,
  Building2,
  CheckCircle2,
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
import { useState } from "react";

import { Amount, AgingMiniBar, CategoryChip, EmptyState, StatCard } from "@/components/openbooks/primitives";
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
import { aiAutonomyOptions, frontendAiStatus, type AiAutonomyMode } from "@/lib/openbooks/ai";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { api } from "../../../../../convex/_generated/api";

function useModuleOverview() {
  return useQuery(api.moduleViews.overview, {}) as ModuleOverview | undefined;
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
  const [role, setRole] = useState<"all" | "customer" | "vendor">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
  const extractReceiptWithBedrock = useAction(api.receipts.extractWithBedrock);
  const [selectedBill, setSelectedBill] = useState<BillRow | null>(null);
  const [documentKind, setDocumentKind] = useState<"receipt" | "bill">("receipt");
  const [vendor, setVendor] = useState("");
  const [receiptDate, setReceiptDate] = useState("");
  const [receiptAmount, setReceiptAmount] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  if (data === undefined) return <LoadingBlock label="bills" />;
  if (!data.entity) return <NoEntityState />;
  const entity = data.entity;
  const matchCandidates = data.bills.matchCandidates;

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
      setUploadMessage(
        bedrockResult?.mode === "bedrock"
          ? bedrockResult.status === "matched"
            ? `Uploaded ${file.name}: Bedrock extracted ${bedrockResult.vendor} and auto-matched it.`
            : `Uploaded ${file.name}: Bedrock extracted ${bedrockResult.vendor}; queued for match.`
          : result.status === "matched"
          ? `Uploaded ${file.name}: auto-matched to a bank transaction.`
          : bedrockResult
            ? `Uploaded ${file.name}: queued for manual match. ${bedrockResult.reason}`
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

  async function matchFirstCandidate(documentId: string) {
    const candidate = matchCandidates[0];
    if (!candidate) return;
    setUploadMessage("");
    try {
      await manualMatchReceipt({
        documentId: documentId as Id<"documents">,
        transactionId: candidate.id as Id<"transactions">,
      });
      setUploadMessage(`Manual match saved to ${candidate.merchant}.`);
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : "Manual match failed.");
    }
  }

  return (
    <div className="space-y-5" data-testid="m6-bills-screen">
      <ModuleIntro
        title="Bills and money you owe"
        description="Bills are grouped by due window and carry A/P posting status. Upload now stores receipt or bill files, extracts reviewable metadata, and matches evidence to bank transactions."
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <label htmlFor="m11-receipt-file">
                <FileUp className="size-4" />
                Upload file
              </label>
            </Button>
            <Button size="sm">
              <Plus className="size-4" />
              Add bill
            </Button>
          </div>
        }
      />

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label="Open total" value={<Amount amountMinor={data.bills.kpis.openMinor} currency={data.entity.currency} />} />
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
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={data.bills.matchCandidates.length === 0}
                          onClick={() => void matchFirstCandidate(document.id)}
                        >
                          Manual match first candidate
                        </Button>
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
                    <button
                      key={bill.id}
                      type="button"
                      className="grid w-full gap-2 px-3 py-3 text-left text-sm hover:bg-muted/50 md:grid-cols-[1fr_auto_auto] md:items-center"
                      onClick={() => setSelectedBill(bill)}
                      data-testid="bill-row"
                    >
                      <span>
                        <span className="block font-medium">{bill.vendorName}</span>
                        <span className="text-xs text-muted-foreground">Due {bill.dueDate} · {statusLabel(bill.postingAffordance)}</span>
                      </span>
                      {statusChip(bill.status)}
                      <Amount amountMinor={bill.totalMinor} currency={bill.currency} />
                    </button>
                  ))}
                  {group.rows.length === 0 ? <div className="p-3 text-sm text-muted-foreground">No bills in this group.</div> : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle className="text-base">Mark paid and match</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-3">
              <div className="flex items-start gap-2">
                <ReceiptText className="mt-0.5 size-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">Selected bill</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedBill ? `${selectedBill.vendorName} due ${selectedBill.dueDate}` : "Choose a bill to review settlement candidates."}
                  </p>
                </div>
              </div>
            </div>
            <div>
              <div className="mb-2 text-sm font-medium">Suggested bank matches</div>
              <div className="divide-y rounded-lg border">
                {data.bills.matchCandidates.slice(0, 6).map((candidate) => (
                  <div key={candidate.id} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{candidate.merchant}</div>
                      <div className="money-figures text-xs text-muted-foreground">{candidate.date}</div>
                    </div>
                    <Amount amountMinor={candidate.amountMinor} currency={candidate.currency} tone="expense" />
                  </div>
                ))}
              </div>
            </div>
            <Button disabled className="w-full">
              <CheckCircle2 className="size-4" />
              Post settlement after integration
            </Button>
            <p className="text-xs text-muted-foreground">{data.bills.uploadPdf.reason}</p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

export function PayrollScreen() {
  const data = useModuleOverview();
  const [tab, setTab] = useState<"employees" | "runs" | "statement">("employees");

  if (data === undefined) return <LoadingBlock label="payroll" />;
  if (!data.entity) return <NoEntityState />;

  const baseCurrency = data.entity.currency;

  return (
    <div className="space-y-5" data-testid="m6-payroll-screen">
      <ModuleIntro
        title="Payroll register"
        description="The payroll register shows employees, monthly runs, FX/base conversion, approval and paid-state affordances, plus a printable three-currency statement."
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
            detail={`${baseCurrency} base ${row.baseMinor}`}
          />
        ))}
        <StatCard
          label="Headcount"
          value={<span className="money-figures">{data.payroll.employees.filter((employee) => employee.active).length}</span>}
          detail="Active employees"
        />
      </section>

      {tab === "employees" ? <PayrollEmployees data={data} /> : null}
      {tab === "runs" ? <PayrollRuns data={data} /> : null}
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

function PayrollRuns({ data }: { data: ModuleOverview }) {
  return (
    <Card className="shadow-xs">
      <CardHeader>
        <CardTitle className="text-base">Runs</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Headcount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Action</TableHead>
              <TableHead className="text-right">Base total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.payroll.runs.map((run) => (
              <TableRow key={run.id} data-testid="payroll-run-row">
                <TableCell className="money-figures font-medium">{run.period}</TableCell>
                <TableCell className="money-figures">{run.headcount}</TableCell>
                <TableCell>{statusChip(run.status)}</TableCell>
                <TableCell className="capitalize text-muted-foreground">{statusLabel(run.actionState)}</TableCell>
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

function PayrollStatement({ data }: { data: ModuleOverview }) {
  return (
    <Card className="shadow-xs">
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle className="text-base">Printable statement</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Grouped by employee with local and base currency totals.</p>
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
  const ensureLiveSandboxEntity = useMutation(api.ledger.ensureLiveSandboxEntity);
  const setAiConfig = useMutation(api.ai.setConfig);
  const testAiConnection = useAction(api.ai.testProviderConnection);
  const [auditFilter, setAuditFilter] = useState("");
  const [entityMessage, setEntityMessage] = useState("");
  const [aiAutonomyOverride, setAiAutonomyOverride] = useState<AiAutonomyMode | null>(null);
  const [aiTestMessage, setAiTestMessage] = useState("");
  const [creatingEntity, setCreatingEntity] = useState(false);
  const aiStatus = frontendAiStatus(aiProviderStatus);
  const aiAutonomy = aiAutonomyOverride ?? aiProviderStatus?.autonomy ?? "balanced";

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
