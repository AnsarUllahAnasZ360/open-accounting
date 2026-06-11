"use client";

import { useQuery } from "convex/react";
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
  const [selectedBill, setSelectedBill] = useState<BillRow | null>(null);

  if (data === undefined) return <LoadingBlock label="bills" />;
  if (!data.entity) return <NoEntityState />;

  return (
    <div className="space-y-5" data-testid="m6-bills-screen">
      <ModuleIntro
        title="Bills and money you owe"
        description="Bills are grouped by due window and carry A/P posting status. PDF upload is represented as a clear M11 placeholder while manual bill entry is ready for integration."
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <FileUp className="size-4" />
              Upload PDF
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
  const [auditFilter, setAuditFilter] = useState("");

  if (data === undefined) return <LoadingBlock label="settings modules" />;
  if (!data.entity) return <NoEntityState />;

  const auditRows = data.settings.audit.rows.filter((row) =>
    `${row.actor} ${row.action} ${row.summary}`.toLowerCase().includes(auditFilter.trim().toLowerCase()),
  );

  return (
    <div className="space-y-5" data-testid="m6-settings-screen">
      <ModuleIntro
        title="Remaining settings"
        description="Businesses, rules, and audit log are the trust/control surfaces that M8, M9, and M10 will depend on."
      />

      <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <Card className="shadow-xs">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="text-base">Businesses</CardTitle>
            <Button size="sm">
              <Plus className="size-4" />
              Add business
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.settings.businesses.rows.map((business) => (
              <div key={business.id} className="rounded-lg border p-3">
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
              Recommended next entity: {data.settings.businesses.addEntity.recommendedName} in {data.settings.businesses.addEntity.recommendedCurrency}.
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
                  <TableCell className="capitalize">{row.actor}</TableCell>
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
