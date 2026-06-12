"use client";

import { useMutation, useQuery } from "convex/react";
import { Archive, ArchiveRestore, Plus } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TYPE_LABEL: Record<string, string> = {
  services: "Services",
  software: "Software",
  ecommerce: "E-commerce",
  agency: "Agency",
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function avatarColor(name: string) {
  const palette = [
    ["#dcefd2", "#17540f"],
    ["#eff8ff", "#175cd3"],
    ["#fef0c7", "#b54708"],
    ["#fce7f6", "#a4148c"],
  ];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length]!;
}

export function BusinessesSection() {
  const data = useQuery(api.entities.list, {});
  const archive = useMutation(api.entities.archive);
  const unarchive = useMutation(api.entities.unarchive);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (data === undefined) {
    return <div className="rounded-[14px] border bg-card p-5 text-sm text-muted-foreground shadow-xs">Loading businesses…</div>;
  }

  async function toggleArchive(id: Id<"entities">, archived: boolean) {
    setBusyId(id);
    setError("");
    try {
      if (archived) await unarchive({ entityId: id });
      else await archive({ entityId: id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the business.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="text-sm text-destructive" data-testid="businesses-error">{error}</p> : null}
      <div className="grid gap-[14px] sm:grid-cols-2" data-testid="businesses-grid">
        {data.rows.map((business) => {
          const [bg, fg] = avatarColor(business.name);
          return (
            <div
              key={business.id}
              data-testid={`business-card-${business.slug}`}
              className={`rounded-[14px] border bg-card p-5 shadow-xs ${business.archived ? "opacity-60" : ""}`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="flex size-7 items-center justify-center rounded-[8px] text-xs font-semibold"
                  style={{ background: bg, color: fg }}
                >
                  {business.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="text-[14.5px] font-semibold">{business.name}</span>
                {business.isDemo ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">Demo</span>
                ) : null}
                {business.archived ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">Archived</span>
                ) : null}
              </div>
              <div className="mt-2 text-[12.5px] text-muted-foreground">
                {TYPE_LABEL[business.businessType] ?? business.businessType} · base currency {business.currency} · fiscal year{" "}
                {MONTHS[(business.fiscalYearStartMonth - 1 + 12) % 12]}
              </div>
              <div className="mt-1 text-[12px] text-muted-foreground/80 money-figures">
                {business.bankAccountCount} bank {business.bankAccountCount === 1 ? "account" : "accounts"} ·{" "}
                {business.stripeAccountCount} Stripe {business.stripeAccountCount === 1 ? "account" : "accounts"} ·{" "}
                {business.transactionCount.toLocaleString()} transactions
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  data-testid={`business-archive-${business.slug}`}
                  disabled={busyId === business.id || (!business.archived && data.activeCount <= 1)}
                  onClick={() => toggleArchive(business.id as Id<"entities">, business.archived)}
                >
                  {business.archived ? (
                    <>
                      <ArchiveRestore className="size-4" /> Restore
                    </>
                  ) : (
                    <>
                      <Archive className="size-4" /> Archive
                    </>
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <AddBusinessModal />
    </div>
  );
}

function AddBusinessModal() {
  const create = useMutation(api.entities.create);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState<"services" | "software" | "ecommerce" | "agency">("services");
  const [currency, setCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (name.trim().length < 2) {
      setError("Give the business a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await create({ name: name.trim(), businessType, currency: currency.trim().toUpperCase() });
      setOpen(false);
      setName("");
      setBusinessType("services");
      setCurrency("USD");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the business.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid="businesses-add"
          className="inline-flex h-[34px] items-center gap-1 self-start rounded-[10px] border border-dashed px-3.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-4" /> Add a business
        </button>
      </DialogTrigger>
      <DialogContent data-testid="add-business-modal">
        <DialogHeader>
          <DialogTitle>Add a business</DialogTitle>
          <DialogDescription>
            A new set of books seeds with a typed chart of accounts. Money stays in its own base currency.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2">
            <Label htmlFor="biz-name">Business name</Label>
            <Input id="biz-name" data-testid="add-business-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Studio LLC" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select value={businessType} onValueChange={(v) => setBusinessType(v as typeof businessType)}>
                <SelectTrigger data-testid="add-business-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="services">Services</SelectItem>
                  <SelectItem value="software">Software</SelectItem>
                  <SelectItem value="ecommerce">E-commerce</SelectItem>
                  <SelectItem value="agency">Agency</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="biz-currency">Base currency</Label>
              <Input
                id="biz-currency"
                data-testid="add-business-currency"
                value={currency}
                maxLength={3}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                className="money-figures uppercase"
              />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" data-testid="add-business-submit" disabled={busy} onClick={submit}>
            {busy ? "Creating…" : "Create business"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
