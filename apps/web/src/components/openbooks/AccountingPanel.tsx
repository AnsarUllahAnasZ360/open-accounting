"use client";

import { useMutation, useQuery } from "convex/react";
import { BookOpenCheck, LockKeyhole, Plus } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Amount } from "@/components/openbooks/primitives";
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

type FormState = "idle" | "submitting" | "success" | "error";

function readableError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const uncaught = error.message.match(/Uncaught Error: ([\s\S]+)/);
  if (uncaught) return uncaught[1].trim().split("\n")[0] ?? fallback;
  return error.message;
}

export function AccountingPanel() {
  const snapshot = useQuery(api.ledger.accountingSnapshot, {});
  const ensureDefaultEntity = useMutation(api.ledger.ensureDefaultEntity);
  const postEntry = useMutation(api.ledger.postEntry);
  const setPeriodLock = useMutation(api.ledger.setPeriodLock);
  const updateAccount = useMutation(api.ledger.updateAccount);
  const [formState, setFormState] = useState<FormState>("idle");
  const [message, setMessage] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("Manual owner contribution");
  const [amount, setAmount] = useState("100.00");
  const [debitAccountId, setDebitAccountId] = useState<Id<"ledgerAccounts"> | "">("");
  const [creditAccountId, setCreditAccountId] = useState<Id<"ledgerAccounts"> | "">("");
  const [accountToEditId, setAccountToEditId] = useState<Id<"ledgerAccounts"> | "">("");
  const [lockedThroughDate, setLockedThroughDate] = useState("");

  const accounts = useMemo(() => snapshot?.accounts ?? [], [snapshot?.accounts]);
  const debitCandidates = useMemo(
    () => accounts.filter((account) => account.type === "asset" || account.type === "expense"),
    [accounts],
  );
  const creditCandidates = useMemo(
    () =>
      accounts
        .filter((account) => account.type === "liability" || account.type === "equity" || account.type === "income")
        .sort((a, b) => {
          const rank = { equity: 0, income: 1, liability: 2, asset: 3, expense: 4 };
          return rank[a.type] - rank[b.type] || a.number.localeCompare(b.number);
        }),
    [accounts],
  );

  const selectedDebitAccountId = debitAccountId || debitCandidates[0]?.id || "";
  const selectedCreditAccountId = creditAccountId || creditCandidates[0]?.id || "";
  const selectedAccountToEditId = accountToEditId || accounts[0]?.id || "";
  const selectedAccount = accounts.find((account) => account.id === selectedAccountToEditId);

  if (snapshot === undefined) {
    return (
      <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground shadow-xs">
        Loading accounting controls...
      </section>
    );
  }

  async function initializeLedger() {
    setFormState("submitting");
    setMessage("");
    try {
      const result = await ensureDefaultEntity({});
      setFormState("success");
      setMessage(`Chart ready. ${result.accountsCreated} accounts created.`);
    } catch (error) {
      setFormState("error");
      setMessage(readableError(error, "Could not initialize accounting."));
    }
  }

  async function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot?.entity) return;
    if (!selectedDebitAccountId || !selectedCreditAccountId) {
      setFormState("error");
      setMessage("Choose both debit and credit accounts before posting.");
      return;
    }
    const debit = selectedDebitAccountId;
    const credit = selectedCreditAccountId;
    const amountMinor = Math.round(Number(amount) * 100);
    const activeLockDate = snapshot.lock?.lockedThroughDate;
    if (activeLockDate && date <= activeLockDate) {
      setFormState("error");
      setMessage(`Period is locked through ${activeLockDate}.`);
      return;
    }
    setFormState("submitting");
    setMessage("");
    try {
      await postEntry({
        entityId: snapshot.entity.id,
        date,
        memo,
        source: "manual",
        lines: [
          {
            accountId: debit,
            debitMinor: amountMinor,
            creditMinor: 0,
            currency: snapshot.entity.currency,
          },
          {
            accountId: credit,
            debitMinor: 0,
            creditMinor: amountMinor,
            currency: snapshot.entity.currency,
          },
        ],
      });
      setFormState("success");
      setMessage("Manual journal entry posted.");
    } catch (error) {
      setFormState("error");
      setMessage(readableError(error, "Could not post journal entry."));
    }
  }

  async function submitLock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot?.entity) return;
    setFormState("submitting");
    setMessage("");
    try {
      await setPeriodLock({
        entityId: snapshot.entity.id,
        lockedThroughDate: lockedThroughDate || null,
      });
      setFormState("success");
      setMessage(lockedThroughDate ? `Period locked through ${lockedThroughDate}.` : "Period lock cleared.");
    } catch (error) {
      setFormState("error");
      setMessage(readableError(error, "Could not update period lock."));
    }
  }

  async function submitAccountUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccountToEditId) return;
    const form = new FormData(event.currentTarget);
    setFormState("submitting");
    setMessage("");
    try {
      await updateAccount({
        accountId: selectedAccountToEditId,
        name: String(form.get("accountName") ?? ""),
        archived: form.get("archived") === "on",
      });
      setFormState("success");
      setMessage("Account updated.");
    } catch (error) {
      setFormState("error");
      setMessage(readableError(error, "Could not update account."));
    }
  }

  return (
    <section className="rounded-lg border bg-card shadow-xs">
      <div className="flex flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-base font-semibold">Accounting</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Chart of accounts, manual journal entry, General Ledger, and Trial Balance.
          </p>
        </div>
        <Button onClick={initializeLedger} disabled={formState === "submitting"}>
          <BookOpenCheck className="size-4" />
          Initialize chart
        </Button>
      </div>

      {message ? (
        <div
          className={`mx-4 mt-4 rounded-lg border p-3 text-sm ${
            formState === "error"
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "bg-primary/5 text-primary"
          }`}
        >
          {message}
        </div>
      ) : null}

      {snapshot.entity ? (
        <div className="grid gap-4 p-4">
          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <form className="rounded-lg border p-4" onSubmit={submitEntry}>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Plus className="size-4 text-primary" />
                Manual journal entry
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="entry-date">Date</Label>
                  <Input id="entry-date" value={date} onChange={(event) => setDate(event.target.value)} type="date" required />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="entry-amount">Amount</Label>
                  <Input id="entry-amount" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required />
                </div>
                <div className="grid gap-1.5">
                  <Label>Debit</Label>
                  <Select value={selectedDebitAccountId} onValueChange={(value) => setDebitAccountId(value as Id<"ledgerAccounts">)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Debit account" />
                    </SelectTrigger>
                    <SelectContent>
                      {debitCandidates.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.number} · {account.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Credit</Label>
                  <Select value={selectedCreditAccountId} onValueChange={(value) => setCreditAccountId(value as Id<"ledgerAccounts">)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Credit account" />
                    </SelectTrigger>
                    <SelectContent>
                      {creditCandidates.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.number} · {account.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5 md:col-span-2">
                  <Label htmlFor="entry-memo">Memo</Label>
                  <Input id="entry-memo" value={memo} onChange={(event) => setMemo(event.target.value)} required />
                </div>
              </div>
              <Button className="mt-4" disabled={formState === "submitting" || !selectedDebitAccountId || !selectedCreditAccountId}>
                Post entry
              </Button>
            </form>

            <form className="rounded-lg border p-4" onSubmit={submitLock}>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <LockKeyhole className="size-4 text-primary" />
                Period lock
              </div>
              <p className="mb-3 text-sm text-muted-foreground">
                Current lock: {snapshot.lock?.lockedThroughDate ?? "None"}
              </p>
              <div className="grid gap-1.5">
                <Label htmlFor="lock-date">Locked through</Label>
                <Input id="lock-date" value={lockedThroughDate} onChange={(event) => setLockedThroughDate(event.target.value)} type="date" />
              </div>
              <Button className="mt-4" variant="outline" disabled={formState === "submitting"}>
                Update lock
              </Button>
            </form>
          </div>

          <form className="rounded-lg border p-4" onSubmit={submitAccountUpdate}>
            <div className="mb-3 text-sm font-semibold">Chart of accounts editor</div>
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <div className="grid gap-1.5">
                <Label>Account</Label>
                <Select value={selectedAccountToEditId} onValueChange={(value) => setAccountToEditId(value as Id<"ledgerAccounts">)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.number} · {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="account-name">Friendly name</Label>
                <Input
                  id="account-name"
                  key={selectedAccount?.id ?? "account-name"}
                  name="accountName"
                  defaultValue={selectedAccount?.name ?? ""}
                  required
                />
              </div>
              <label className="flex h-8 items-center gap-2 text-sm text-muted-foreground">
                <input
                  key={`${selectedAccount?.id ?? "account"}-archived`}
                  name="archived"
                  type="checkbox"
                  defaultChecked={Boolean(selectedAccount?.archived)}
                  disabled={Boolean(selectedAccount?.isSystem)}
                />
                Archived
              </label>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {selectedAccount
                ? `${selectedAccount.number} · ${selectedAccount.type} · ${selectedAccount.subtype}`
                : "Select an account to edit."}
            </div>
            <Button className="mt-4" variant="outline" disabled={formState === "submitting" || !selectedAccountToEditId}>
              Save account
            </Button>
          </form>

          <div className="rounded-lg border">
            <div className="border-b px-4 py-3">
              <h3 className="text-sm font-semibold">Trial Balance</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Difference: <Amount amountMinor={snapshot.trialBalance.differenceMinor} currency={snapshot.entity.currency} />
              </p>
            </div>
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
                {snapshot.trialBalance.rows.map((row) => (
                  <TableRow key={row.accountId}>
                    <TableCell>{row.number} · {row.name}</TableCell>
                    <TableCell>{row.type}</TableCell>
                    <TableCell className="text-right"><Amount amountMinor={row.debitMinor} currency={snapshot.entity!.currency} /></TableCell>
                    <TableCell className="text-right"><Amount amountMinor={row.creditMinor} currency={snapshot.entity!.currency} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-lg border">
            <div className="border-b px-4 py-3">
              <h3 className="text-sm font-semibold">General Ledger</h3>
            </div>
            <div className="divide-y">
              {snapshot.journalEntries.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">No posted entries yet.</div>
              ) : (
                snapshot.journalEntries.map((entry) => (
                  <div key={entry.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                      <div>
                        <div className="font-medium">{entry.memo}</div>
                        <div className="text-muted-foreground">{entry.date} · {entry.source}</div>
                      </div>
                      {entry.reversesEntryId ? <span className="text-xs text-muted-foreground">Reversal</span> : null}
                    </div>
                    <div className="mt-2 grid gap-1 text-sm">
                      {entry.lines.map((line) => (
                        <div key={line.id} className="grid grid-cols-[1fr_auto_auto] gap-3">
                          <span className="text-muted-foreground">{line.accountNumber} · {line.accountName}</span>
                          <Amount amountMinor={line.debitMinor} currency={line.currency} />
                          <Amount amountMinor={line.creditMinor} currency={line.currency} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 text-sm text-muted-foreground">
          Initialize the demo entity and chart before posting manual journal entries.
        </div>
      )}
    </section>
  );
}
