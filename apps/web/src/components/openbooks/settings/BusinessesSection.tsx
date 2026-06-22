"use client";

import { useMutation, useQuery } from "convex/react";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  services: "Services",
  software: "Software",
  ecommerce: "E-commerce",
  agency: "Agency",
};

type BusinessType = "services" | "software" | "ecommerce" | "agency";

// Entity types co-owned with the Tax section (E12-T2 merges legal/tax identity
// editing into the Businesses card so the owner never round-trips to Tax).
const ENTITY_TYPES = ["LLC", "S-Corporation", "C-Corporation", "Sole proprietorship", "Partnership"];

type BusinessRow = {
  id: string;
  name: string;
  slug: string;
  businessType: string;
  currency: string;
  isDemo: boolean;
  archived: boolean;
  legalName: string;
  entityType: string;
  taxId: string;
  homeState: string;
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Deterministic avatar tint from the design system's chart palette — no raw
// hexes (the old palette included an off-brand magenta #a4148c). Each entry is a
// soft surface + readable foreground built from a single --chart token.
const AVATAR_TINTS = [
  "bg-[color-mix(in_oklch,var(--chart-1)_18%,transparent)] text-[var(--chart-1)]",
  "bg-[color-mix(in_oklch,var(--chart-2)_18%,transparent)] text-[var(--chart-2)]",
  "bg-[color-mix(in_oklch,var(--chart-3)_18%,transparent)] text-[var(--chart-3)]",
  "bg-[color-mix(in_oklch,var(--chart-4)_18%,transparent)] text-[var(--chart-4)]",
  "bg-[color-mix(in_oklch,var(--chart-5)_18%,transparent)] text-[var(--chart-5)]",
];

function avatarTint(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length]!;
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
          return (
            <div
              key={business.id}
              data-testid={`business-card-${business.slug}`}
              className={cn("rounded-[14px] border bg-card p-5 shadow-xs", business.archived && "opacity-60")}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-[8px] text-xs font-semibold",
                    avatarTint(business.name),
                  )}
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
                {!business.isDemo ? (
                  <EditBusinessModal business={business as BusinessRow} />
                ) : null}
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

function EditBusinessModal({ business }: { business: BusinessRow }) {
  const updateProfile = useMutation(api.entities.updateProfile);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(business.name);
  const [businessType, setBusinessType] = useState<BusinessType>(business.businessType as BusinessType);
  const [legalName, setLegalName] = useState(business.legalName);
  const [entityType, setEntityType] = useState(business.entityType || "LLC");
  const [taxId, setTaxId] = useState(business.taxId);
  const [homeState, setHomeState] = useState(business.homeState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Re-seed the form when the dialog opens so edits always start from the
  // latest persisted values (the card data refetches after a save).
  function onOpenChange(next: boolean) {
    if (next) {
      setName(business.name);
      setBusinessType(business.businessType as BusinessType);
      setLegalName(business.legalName);
      setEntityType(business.entityType || "LLC");
      setTaxId(business.taxId);
      setHomeState(business.homeState);
      setError("");
    }
    setOpen(next);
  }

  async function submit() {
    if (name.trim().length < 2) {
      setError("Give the business a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await updateProfile({
        entityId: business.id as Id<"entities">,
        name: name.trim(),
        businessType,
        legalName: legalName.trim(),
        entityType: entityType.trim(),
        taxId: taxId.trim(),
        homeState: homeState.trim(),
      });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the business.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`business-edit-${business.slug}`}>
          <Pencil className="size-4" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="edit-business-modal">
        <DialogHeader>
          <DialogTitle>Edit business</DialogTitle>
          <DialogDescription>
            Name, type, and legal/tax identity in one place. Base currency is set at creation and can&rsquo;t change.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2">
            <Label htmlFor={`edit-biz-name-${business.slug}`}>Business name</Label>
            <Input
              id={`edit-biz-name-${business.slug}`}
              data-testid="edit-business-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select value={businessType} onValueChange={(v) => setBusinessType(v as BusinessType)}>
                <SelectTrigger data-testid="edit-business-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="services">Services</SelectItem>
                    <SelectItem value="software">Software</SelectItem>
                    <SelectItem value="ecommerce">E-commerce</SelectItem>
                    <SelectItem value="agency">Agency</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`edit-biz-currency-${business.slug}`}>Base currency</Label>
              <Input
                id={`edit-biz-currency-${business.slug}`}
                data-testid="edit-business-currency"
                value={business.currency}
                readOnly
                disabled
                title="Base currency is set at creation and can't change."
                className="money-figures uppercase bg-muted/40"
              />
              <span className="text-[11px] text-muted-foreground">Set at creation.</span>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`edit-biz-legal-${business.slug}`}>Legal name</Label>
            <Input
              id={`edit-biz-legal-${business.slug}`}
              data-testid="edit-business-legal-name"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Entity type</Label>
              <Select value={entityType} onValueChange={setEntityType}>
                <SelectTrigger data-testid="edit-business-entity-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {ENTITY_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`edit-biz-state-${business.slug}`}>Home state</Label>
              <Input
                id={`edit-biz-state-${business.slug}`}
                data-testid="edit-business-home-state"
                value={homeState}
                onChange={(e) => setHomeState(e.target.value)}
                placeholder="Texas"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`edit-biz-taxid-${business.slug}`}>EIN / Tax ID</Label>
            <Input
              id={`edit-biz-taxid-${business.slug}`}
              data-testid="edit-business-tax-id"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="••-•••••••"
              className="font-mono text-[12.5px]"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" data-testid="edit-business-submit" disabled={busy} onClick={submit}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
                  <SelectGroup>
                    <SelectItem value="services">Services</SelectItem>
                    <SelectItem value="software">Software</SelectItem>
                    <SelectItem value="ecommerce">E-commerce</SelectItem>
                    <SelectItem value="agency">Agency</SelectItem>
                  </SelectGroup>
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
