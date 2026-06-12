"use client";

import { useMutation, useQuery } from "convex/react";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
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
import { cn } from "@/lib/utils";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const ENTITY_TYPES = ["LLC", "S-Corporation", "C-Corporation", "Sole proprietorship", "Partnership"];

export function TaxSection() {
  const data = useQuery(api.entities.list, {});
  const updateTax = useMutation(api.entities.updateTaxSettings);
  const [entityId, setEntityId] = useState<string | null>(null);

  const active = data?.rows.find((row) => row.id === entityId) ?? data?.rows[0] ?? null;

  // Local form state seeded from the active entity.
  const [basis, setBasis] = useState<"accrual" | "cash">("accrual");
  const [fyMonth, setFyMonth] = useState(1);
  const [legalName, setLegalName] = useState("");
  const [entityType, setEntityType] = useState("LLC");
  const [homeState, setHomeState] = useState("");
  const [taxId, setTaxId] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Sync the editable form fields to the loaded active entity. Keyed on
  // active?.id so it only runs when the selected entity changes.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!active) return;
    setBasis(active.accountingBasis);
    setFyMonth(active.fiscalYearStartMonth);
    setLegalName(active.legalName);
    setEntityType(active.entityType);
    setHomeState(active.homeState);
    setTaxId(active.taxId);
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  /* eslint-enable react-hooks/set-state-in-effect */

  if (data === undefined) {
    return <div className="rounded-[14px] border bg-card p-5 text-sm text-muted-foreground shadow-xs">Loading…</div>;
  }
  if (!active) {
    return <div className="rounded-[14px] border bg-card p-5 text-sm text-muted-foreground shadow-xs">Add a business first.</div>;
  }

  async function save() {
    if (!active) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await updateTax({
        entityId: active.id as Id<"entities">,
        accountingBasis: basis,
        fiscalYearStartMonth: fyMonth,
        legalName,
        entityType,
        homeState,
        taxId,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save tax settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {data.rows.length > 1 ? (
        <div className="flex items-center gap-2">
          <Label className="text-[12px] text-muted-foreground">Business</Label>
          <Select value={active.id} onValueChange={(v) => setEntityId(v)}>
            <SelectTrigger data-testid="tax-entity-picker" className="h-9 w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.rows.map((row) => (
                <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="flex flex-col gap-3.5 rounded-[14px] border bg-card p-5 shadow-xs">
        <div className="text-[13.5px] font-semibold">Fiscal year & accounting basis</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-[12px] font-medium text-[#525252]">Fiscal year starts</Label>
            <Select value={String(fyMonth)} onValueChange={(v) => setFyMonth(Number(v))}>
              <SelectTrigger data-testid="tax-fy-month" className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block text-[12px] font-medium text-[#525252]">Base currency</Label>
            <Input value={active.currency} readOnly className="money-figures h-9 bg-muted/40" />
          </div>
        </div>

        <div>
          <div className="mb-2 text-[12px] font-medium text-[#525252]">Default reporting basis</div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {(["accrual", "cash"] as const).map((option) => {
              const on = basis === option;
              return (
                <button
                  key={option}
                  type="button"
                  data-testid={`tax-basis-${option}`}
                  data-active={on ? "true" : "false"}
                  onClick={() => setBasis(option)}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-[12px] border-[1.5px] p-3.5 text-left transition-colors",
                    on ? "border-primary bg-[#fbfdf9]" : "border-border bg-card",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "size-3.5 rounded-full border-[1.5px]",
                        on ? "border-primary bg-primary shadow-[inset_0_0_0_3px_#fff]" : "border-muted-foreground/40",
                      )}
                    />
                    <span className="text-[13px] font-semibold capitalize">{option}</span>
                  </span>
                  <span className="text-[11.5px] leading-snug text-muted-foreground">
                    {option === "accrual"
                      ? "Counts income when earned and expenses when incurred. What most CPAs file."
                      : "Counts money only when it moves. Reports always let you switch per view."}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3.5 rounded-[14px] border bg-card p-5 shadow-xs">
        <div className="text-[13.5px] font-semibold">Tax identity</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-[12px] font-medium text-[#525252]">Legal name</Label>
            <Input data-testid="tax-legal-name" value={legalName} onChange={(e) => setLegalName(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="mb-1.5 block text-[12px] font-medium text-[#525252]">Entity type</Label>
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger data-testid="tax-entity-type" className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block text-[12px] font-medium text-[#525252]">EIN / Tax ID</Label>
            <Input
              data-testid="tax-id"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="••-•••••••"
              className="h-9 font-mono text-[12.5px]"
            />
          </div>
          <div>
            <Label className="mb-1.5 block text-[12px] font-medium text-[#525252]">Home state</Label>
            <Input data-testid="tax-home-state" value={homeState} onChange={(e) => setHomeState(e.target.value)} placeholder="Texas" className="h-9" />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button data-testid="tax-save" size="sm" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
        {saved ? (
          <span className="inline-flex items-center gap-1 text-[12.5px] text-primary" data-testid="tax-saved">
            <Check className="size-3.5" /> Saved
          </span>
        ) : null}
        {error ? <span className="text-[12.5px] text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
