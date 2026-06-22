"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import {
  SettingsCard,
  SettingsCardTitle,
  SettingsEntityPicker,
  SettingsSaveBar,
} from "@/components/openbooks/settings/_shell";
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
    return <SettingsCard className="text-sm text-muted-foreground">Loading…</SettingsCard>;
  }
  if (!active) {
    return <SettingsCard className="text-sm text-muted-foreground">Add a business first.</SettingsCard>;
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
      <SettingsEntityPicker
        rows={data.rows}
        value={active.id}
        onChange={(v) => setEntityId(v)}
        testId="tax-entity-picker"
        alwaysShow
      />

      <SettingsCard className="flex flex-col gap-3.5">
        <SettingsCardTitle>Fiscal year & accounting basis</SettingsCardTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Fiscal year starts</Label>
            <Select value={String(fyMonth)} onValueChange={(v) => setFyMonth(Number(v))}>
              <SelectTrigger data-testid="tax-fy-month" className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Base currency</Label>
            <Input value={active.currency} readOnly className="money-figures h-9 bg-muted/40" />
          </div>
        </div>

        <div>
          <div className="mb-2 text-[12px] font-medium text-muted-foreground">Default reporting basis</div>
          <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Default reporting basis">
            {(["accrual", "cash"] as const).map((option) => {
              const on = basis === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-testid={`tax-basis-${option}`}
                  data-active={on ? "true" : "false"}
                  onClick={() => setBasis(option)}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-[12px] border-[1.5px] p-3.5 text-left transition-colors",
                    on ? "border-primary bg-ob-green-50/40" : "border-border bg-card",
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
      </SettingsCard>

      <SettingsCard className="flex flex-col gap-3.5">
        <SettingsCardTitle>Tax identity</SettingsCardTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Legal name</Label>
            <Input data-testid="tax-legal-name" value={legalName} onChange={(e) => setLegalName(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Entity type</Label>
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger data-testid="tax-entity-type" className="h-9 w-full">
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
          <div>
            <Label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">EIN / Tax ID</Label>
            <Input
              data-testid="tax-id"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="••-•••••••"
              className="h-9 font-mono text-[12.5px]"
            />
          </div>
          <div>
            <Label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Home state</Label>
            <Input data-testid="tax-home-state" value={homeState} onChange={(e) => setHomeState(e.target.value)} placeholder="Texas" className="h-9" />
          </div>
        </div>
      </SettingsCard>

      <SettingsSaveBar
        onSave={save}
        busy={busy}
        saved={saved}
        error={error}
        testId="tax-save"
      />
    </div>
  );
}
