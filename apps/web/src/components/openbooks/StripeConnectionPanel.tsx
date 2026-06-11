"use client";

import { useAction, useQuery } from "convex/react";
import { anyApi, type FunctionReference } from "convex/server";
import {
  CheckCircle2,
  CircleAlert,
  CreditCard,
  DatabaseZap,
  ExternalLink,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { Amount } from "@/components/openbooks/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";

type ChecklistStatus = "pass" | "fail" | "needs_check";

type StripeState = {
  entity: { id: Id<"entities">; name: string; currency: string; isDemo: boolean } | null;
  env: {
    configured: boolean;
    source: "environment";
    mode: "missing" | "test" | "live" | "unknown";
    label: string;
  };
  checklist: Array<{ key: string; label: string; status: ChecklistStatus; detail: string }>;
  clearingAccount: { id: Id<"ledgerAccounts">; name: string; number: string; currency: string } | null;
  stripeAccount: { id: Id<"stripeAccounts">; label: string; createdAt: number } | null;
  payouts: Array<{
    id: Id<"stripePayouts">;
    payoutId: string;
    amountMinor: number;
    grossMinor: number;
    feesMinor: number;
    driftMinor: number;
    arrivalDate: string;
    status: "pending" | "reconciled" | "mismatch";
  }>;
  fixturePreview: {
    payouts: Array<{
      payoutId: string;
      amountMinor: number;
      grossMinor: number;
      feesMinor: number;
      driftMinor: number;
      currency: string;
      lines: Array<{
        sourceId: string;
        description: string;
        grossMinor: number;
        feeMinor: number;
        netMinor: number;
        currency: string;
      }>;
    }>;
  };
  integrationGaps: string[];
};

type ValidateResult = {
  mode: "stripe_test" | "fixture";
  ok: boolean;
  blocker: string | null;
};

type SyncResult = {
  mode: "stripe_test" | "fixture";
  contactsCreated: number;
  incomeTransactionsCreated: number;
  invoicesCreated: number;
  payoutsCreated: number;
  inboxItemsCreated: number;
  ledgerEntriesPosted: number;
  skippedDuplicates: number;
  integrationGaps: string[];
};

type SendInvoiceResult = {
  mode: "stripe_test" | "fixture";
  blocker: string | null;
  stripeInvoiceId: string;
  hostedInvoiceUrl: string | null;
  total: { amountMinor: number; currency: string };
};

const stripeApi = anyApi.stripe as unknown as {
  state: FunctionReference<"query", "public", { entityId?: Id<"entities"> }, StripeState>;
  validateEnvironment: FunctionReference<"action", "public", { entityId?: Id<"entities"> }, ValidateResult>;
  seedTestAccount: FunctionReference<"action", "public", { entityId: Id<"entities"> }, SyncResult>;
  syncNow: FunctionReference<"action", "public", { entityId: Id<"entities"> }, SyncResult>;
  sendInvoiceViaStripe: FunctionReference<
    "action",
    "public",
    {
      entityId: Id<"entities">;
      customerName: string;
      customerEmail: string;
      memo?: string;
      daysUntilDue: number;
      lineItems: Array<{ description: string; amountMinor: number; quantity: number }>;
    },
    SendInvoiceResult
  >;
};

type ActionState = "idle" | "submitting" | "success" | "error";

function readableError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const uncaught = error.message.match(/Uncaught Error: ([\s\S]+)/);
  if (uncaught) return uncaught[1].trim().split("\n")[0] ?? fallback;
  return error.message;
}

function statusTone(status: ChecklistStatus) {
  if (status === "pass") return "border-primary/30 bg-primary/5 text-primary";
  if (status === "fail") return "border-destructive/30 bg-destructive/5 text-destructive";
  return "border-border bg-muted/30 text-muted-foreground";
}

function statusIcon(status: ChecklistStatus) {
  if (status === "pass") return CheckCircle2;
  if (status === "fail") return CircleAlert;
  return ShieldCheck;
}

function ResultBlock({ result }: { result: SyncResult | null }) {
  if (!result) return null;
  const rows = [
    ["Contacts", result.contactsCreated],
    ["Income transactions", result.incomeTransactionsCreated],
    ["Invoices", result.invoicesCreated],
    ["Payouts", result.payoutsCreated],
    ["Inbox mismatch cards", result.inboxItemsCreated],
    ["Ledger entries", result.ledgerEntriesPosted],
    ["Duplicates skipped", result.skippedDuplicates],
  ];
  return (
    <div className="rounded-lg border bg-primary/5 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-primary">
          {result.mode === "stripe_test" ? "Stripe test sync applied" : "Fixture-mode projection applied"}
        </div>
        <Badge variant="outline">{result.mode === "stripe_test" ? "test mode" : "fixture mode"}</Badge>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-md border bg-background px-3 py-2">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="money-figures mt-1 text-base font-semibold">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PayoutRows({ state }: { state: StripeState }) {
  const preview = state.fixturePreview.payouts;
  const payoutRows =
    state.payouts.length > 0
      ? state.payouts.map((payout) => ({
          ...payout,
          currency: state.entity?.currency ?? "USD",
          source: "recorded",
          lines: preview.find((item) => item.payoutId === payout.payoutId)?.lines ?? [],
        }))
      : preview.map((payout) => ({
          id: payout.payoutId,
          payoutId: payout.payoutId,
          amountMinor: payout.amountMinor,
          grossMinor: payout.grossMinor,
          feesMinor: payout.feesMinor,
          driftMinor: payout.driftMinor,
          arrivalDate: "Fixture",
          status: payout.driftMinor === 0 ? ("reconciled" as const) : ("mismatch" as const),
          currency: payout.currency,
          source: "fixture",
          lines: payout.lines,
        }));

  return (
    <div className="space-y-3">
      {payoutRows.map((payout) => (
        <details key={payout.payoutId} className="rounded-lg border p-3">
          <summary className="grid cursor-pointer list-none gap-3 text-sm md:grid-cols-[1.2fr_1fr_1fr_1fr_auto] md:items-center">
            <div>
              <div className="font-medium">{payout.payoutId}</div>
              <div className="text-xs text-muted-foreground">{payout.arrivalDate} · {payout.source}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Gross</div>
              <Amount amountMinor={payout.grossMinor} currency={payout.currency} tone="income" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Fees</div>
              <Amount amountMinor={payout.feesMinor} currency={payout.currency} />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Deposit</div>
              <Amount amountMinor={payout.amountMinor} currency={payout.currency} />
            </div>
            <Badge variant={payout.status === "mismatch" ? "destructive" : "outline"}>
              {payout.status === "mismatch" ? "Drift" : "$0 drift"}
            </Badge>
          </summary>
          <div className="mt-3 overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payment</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Fee</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payout.lines.length > 0 ? (
                  payout.lines.map((line) => (
                    <TableRow key={line.sourceId}>
                      <TableCell className="money-figures text-xs">{line.sourceId}</TableCell>
                      <TableCell>{line.description}</TableCell>
                      <TableCell className="text-right">
                        <Amount amountMinor={line.grossMinor} currency={line.currency} tone="income" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Amount amountMinor={line.feeMinor} currency={line.currency} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Amount amountMinor={line.netMinor} currency={line.currency} />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-sm text-muted-foreground">
                      Drill-down rows are available from fixture previews today; persistent real payout line storage needs a child table.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </details>
      ))}
    </div>
  );
}

export function StripeConnectionPanel({ entityId }: { entityId?: Id<"entities"> }) {
  const queryArgs = entityId ? { entityId } : {};
  const state = useQuery(stripeApi.state, queryArgs);
  const validateEnvironment = useAction(stripeApi.validateEnvironment);
  const seedTestAccount = useAction(stripeApi.seedTestAccount);
  const syncNow = useAction(stripeApi.syncNow);
  const sendInvoiceViaStripe = useAction(stripeApi.sendInvoiceViaStripe);
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [message, setMessage] = useState("");
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [invoiceResult, setInvoiceResult] = useState<SendInvoiceResult | null>(null);
  const [customerName, setCustomerName] = useState("Northstar Studio");
  const [customerEmail, setCustomerEmail] = useState("billing+northstar@example.com");
  const [invoiceMemo, setInvoiceMemo] = useState("OpenBooks setup services");
  const [invoiceAmount, setInvoiceAmount] = useState("1200.00");

  const activeEntityId = state?.entity?.id;
  const canRun = Boolean(activeEntityId) && actionState !== "submitting";
  const checklistPasses = useMemo(
    () => state?.checklist.filter((item) => item.status === "pass").length ?? 0,
    [state?.checklist],
  );

  async function runAction(label: string, task: () => Promise<SyncResult | ValidateResult>) {
    setActionState("submitting");
    setMessage("");
    setInvoiceResult(null);
    try {
      const result = await task();
      if ("contactsCreated" in result) {
        setSyncResult(result);
        setMessage(`${label} complete.`);
      } else {
        setMessage(result.ok ? "Stripe test key validated." : result.blocker ?? "Stripe validation fell back to fixture mode.");
      }
      setActionState("success");
    } catch (error) {
      setActionState("error");
      setMessage(readableError(error, `${label} failed.`));
    }
  }

  async function submitInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeEntityId) return;
    setActionState("submitting");
    setMessage("");
    setSyncResult(null);
    try {
      const amountMinor = Math.round(Number(invoiceAmount) * 100);
      const result = await sendInvoiceViaStripe({
        entityId: activeEntityId,
        customerName,
        customerEmail,
        memo: invoiceMemo,
        daysUntilDue: 15,
        lineItems: [{ description: invoiceMemo, amountMinor, quantity: 1 }],
      });
      setInvoiceResult(result);
      setActionState(result.blocker ? "error" : "success");
      setMessage(result.blocker ?? "Stripe hosted invoice created and recorded.");
    } catch (error) {
      setActionState("error");
      setMessage(readableError(error, "Could not send Stripe invoice."));
    }
  }

  if (state === undefined) {
    return (
      <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground shadow-xs">
        Loading Stripe connection...
      </section>
    );
  }

  return (
    <section className="rounded-lg border bg-card shadow-xs" data-testid="stripe-connection-panel">
      <div className="flex flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold">
            <CreditCard className="size-4 text-primary" />
            Stripe test mode
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Configured from environment. Stripe payments move through a clearing account first; payouts prove gross revenue minus fees before the bank deposit is matched.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!canRun}
            onClick={() => runAction("Validation", () => validateEnvironment(queryArgs))}
          >
            <ShieldCheck className="size-4" />
            Validate
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canRun}
            onClick={() => activeEntityId && runAction("Seed", () => seedTestAccount({ entityId: activeEntityId }))}
          >
            <DatabaseZap className="size-4" />
            Seed test data
          </Button>
          <Button
            size="sm"
            disabled={!canRun}
            onClick={() => activeEntityId && runAction("Sync", () => syncNow({ entityId: activeEntityId }))}
          >
            <RefreshCw className={cn("size-4", actionState === "submitting" && "animate-spin")} />
            Sync now
          </Button>
        </div>
      </div>

      <div className="grid gap-4 p-4">
        <div className="grid gap-3 lg:grid-cols-3">
          <Card className="shadow-xs">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Environment key</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-base font-semibold">{state.env.label}</div>
              <Badge variant={state.env.mode === "test" ? "outline" : "destructive"}>
                {state.env.mode === "test" ? "Test mode only" : "Fixture mode"}
              </Badge>
              <p className="text-sm text-muted-foreground">
                The browser never receives the key value. Convex actions read only `STRIPE_SECRET_KEY`.
              </p>
            </CardContent>
          </Card>
          <Card className="shadow-xs">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Linked entity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-base font-semibold">{state.entity?.name ?? "No Live Sandbox entity"}</div>
              <p className="text-sm text-muted-foreground">
                {state.entity ? `${state.entity.currency} books · ${state.entity.isDemo ? "demo" : "live sandbox"}` : "Create Live Sandbox in Businesses first."}
              </p>
            </CardContent>
          </Card>
          <Card className="shadow-xs">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Clearing account</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-base font-semibold">
                {state.clearingAccount ? `${state.clearingAccount.number} ${state.clearingAccount.name}` : "Created on first sync"}
              </div>
              <p className="text-sm text-muted-foreground">
                Gross charges debit clearing, fees credit clearing, and payouts credit clearing to zero drift.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          {state.checklist.map((item) => {
            const Icon = statusIcon(item.status);
            return (
              <div key={item.key} className={cn("rounded-lg border p-3 text-sm", statusTone(item.status))}>
                <div className="flex items-center gap-2 font-medium">
                  <Icon className="size-4" />
                  {item.label}
                </div>
                <p className="mt-1 text-xs opacity-90">{item.detail}</p>
              </div>
            );
          })}
        </div>

        {message ? (
          <div
            className={cn(
              "rounded-lg border p-3 text-sm",
              actionState === "error"
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : "bg-primary/5 text-primary",
            )}
            data-testid="stripe-action-message"
          >
            {message}
          </div>
        ) : null}

        <ResultBlock result={syncResult} />

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="shadow-xs">
            <CardHeader>
              <CardTitle className="text-base">Payout reconciliation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                {state.payouts.length > 0
                  ? "Recorded Stripe payouts are shown first. Fixture line details remain visible for drill-down until payout child rows are added."
                  : "No recorded Stripe payouts yet. Fixture payouts prove the $0 drift and mismatch card behavior without chasing cross-sandbox bank deposits."}
              </div>
              <PayoutRows state={state} />
            </CardContent>
          </Card>

          <Card className="shadow-xs">
            <CardHeader>
              <CardTitle className="text-base">Send via Stripe</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3" onSubmit={submitInvoice}>
                <div className="grid gap-1.5">
                  <Label htmlFor="stripe-customer-name">Customer</Label>
                  <Input id="stripe-customer-name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} required />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="stripe-customer-email">Email</Label>
                  <Input id="stripe-customer-email" type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} required />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="stripe-invoice-memo">Memo</Label>
                  <Input id="stripe-invoice-memo" value={invoiceMemo} onChange={(event) => setInvoiceMemo(event.target.value)} required />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="stripe-invoice-amount">Amount</Label>
                  <Input id="stripe-invoice-amount" inputMode="decimal" value={invoiceAmount} onChange={(event) => setInvoiceAmount(event.target.value)} required />
                </div>
                <Button disabled={!canRun}>
                  <Send className="size-4" />
                  Send via Stripe
                </Button>
              </form>

              {invoiceResult ? (
                <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{invoiceResult.stripeInvoiceId}</div>
                      <div className="mt-1 text-muted-foreground">
                        <Amount amountMinor={invoiceResult.total.amountMinor} currency={invoiceResult.total.currency} />
                      </div>
                    </div>
                    <Badge variant={invoiceResult.mode === "stripe_test" ? "outline" : "destructive"}>
                      {invoiceResult.mode === "stripe_test" ? "Sent" : "Fixture"}
                    </Badge>
                  </div>
                  {invoiceResult.hostedInvoiceUrl ? (
                    <a
                      className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary"
                      href={invoiceResult.hostedInvoiceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open hosted invoice
                      <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-sm font-medium">Integration notes for the main thread</div>
          <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
            {state.integrationGaps.map((gap) => (
              <li key={gap}>- {gap}</li>
            ))}
            <li>- Checklist passes: {checklistPasses} of {state.checklist.length}</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
