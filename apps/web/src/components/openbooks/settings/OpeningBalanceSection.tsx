"use client";

import { useMutation, useQuery } from "convex/react";
import { AlertCircle, CalendarClock } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { SettingsCard } from "@/components/openbooks/settings/_shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/errors";
import { useActiveEntity } from "@/lib/openbooks/active-entity";

// USD integer minor units, matching the onboarding wizard's parser. Empty reads
// as "no amount" (date-only re-base); anything that isn't a plain 2-decimal
// number is rejected rather than silently rounded.
function dollarsToMinor(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  if (!/^-?\d+(\.\d{0,2})?$/.test(trimmed)) return null;
  return Math.round(parseFloat(trimmed) * 100);
}

/**
 * Settings → Opening balance. The post-onboarding way to say "my books start
 * here": stamps the cutoff, archives the activity before it, and optionally
 * posts the opening entry — the same three steps the wizard performs.
 */
export function OpeningBalanceSection() {
  const { activeEntity } = useActiveEntity();
  const entityId = activeEntity.id ? (activeEntity.id as Id<"entities">) : null;
  const entity = useQuery(api.entities.getById, entityId ? { id: entityId } : "skip");

  const [startDate, setStartDate] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const updateOpeningBalance = useMutation(api.onboarding.updateOpeningBalanceDate);

  const currentCutoff = entity?.openingBalanceDate ?? null;
  const amountMinor = dollarsToMinor(amount);
  const amountInvalid = amountMinor === null;
  const canSubmit = Boolean(entityId) && startDate !== "" && !amountInvalid && !saving;

  async function apply() {
    if (!entityId || amountMinor === null) return;
    setConfirming(false);
    setSaving(true);
    setResult(null);
    try {
      const outcome = await updateOpeningBalance({
        entityId,
        startDate,
        ...(amountMinor !== 0 ? { balanceMinor: amountMinor } : {}),
      });
      const posted = outcome.posted ? " Opening entry posted." : "";
      setResult({
        ok: true,
        text:
          `Books now start ${outcome.cutoff}. Archived ${outcome.archivedTransactions} transaction(s) ` +
          `and cleared ${outcome.dismissedItems} inbox item(s).${posted}`,
      });
      setStartDate("");
      setAmount("");
    } catch (caught) {
      setResult({ ok: false, text: getErrorMessage(caught, "Could not set the opening balance.") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="opening-balance-section">
      <SettingsCard className="flex flex-col gap-4">
        <div>
          <div className="flex items-center gap-2 text-[13.5px] font-semibold">
            <CalendarClock className="size-4" />
            Start my books on
          </div>
          <div className="mt-1 text-[12.5px] text-muted-foreground">
            Pick the day your books begin. Everything dated earlier is archived out of the Inbox and
            Transactions — it stays in your exports and audit log, it just stops being work.
          </div>
        </div>

        <div className="rounded-lg border bg-muted/40 p-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
            Current start date
          </div>
          <div className="mt-1 text-sm font-semibold tabular-nums">
            {currentCutoff ? (
              <span className="text-primary">{currentCutoff}</span>
            ) : (
              <span className="text-muted-foreground">Not set — every fetched transaction is shown</span>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="opening-balance-date" className="text-[12.5px]">
              Start books on
            </Label>
            <Input
              id="opening-balance-date"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              data-testid="opening-balance-date-input"
            />
            <p className="text-[11.5px] text-muted-foreground">
              Dated to the first of that month.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="opening-balance-amount" className="text-[12.5px]">
              Opening cash balance (USD, optional)
            </Label>
            <Input
              id="opening-balance-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              data-testid="opening-balance-amount-input"
              aria-invalid={amountInvalid}
              className="tabular-nums"
            />
            <p className="text-[11.5px] text-muted-foreground">
              {amountInvalid
                ? "Enter a plain amount like 1500 or 1500.00."
                : "Leave blank to re-base the date without posting an entry."}
            </p>
          </div>
        </div>

        {startDate ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/40">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-[12px] leading-5 text-amber-900 dark:text-amber-100">
              Transactions dated before <strong className="tabular-nums">{startDate}</strong> will be
              archived, including ones already categorized or AI-reviewed. Nothing is deleted — they
              remain in exports, reports history, and the audit log.
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => setConfirming(true)}
            disabled={!canSubmit}
            data-testid="opening-balance-save"
          >
            {saving ? "Applying…" : "Set start date"}
          </Button>
          {startDate || amount ? (
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => {
                setStartDate("");
                setAmount("");
                setResult(null);
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>

        {result ? (
          <p
            className={`text-[12.5px] ${result.ok ? "text-primary" : "text-destructive"}`}
            data-testid="opening-balance-result"
          >
            {result.text}
          </p>
        ) : null}
      </SettingsCard>

      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-[14px] border bg-card p-6 shadow-lg">
            <h2 className="text-[15px] font-semibold">Start books on {startDate}?</h2>
            <p className="mt-3 text-[12.5px] leading-5 text-muted-foreground">
              Every transaction dated before this day is archived out of the Inbox and Transactions —
              including ones you or the AI already categorized. They stay in your exports and audit
              log.
            </p>
            {amountMinor !== null && amountMinor !== 0 ? (
              <p className="mt-2 text-[12.5px] leading-5 text-muted-foreground">
                A balanced opening entry for{" "}
                <strong className="tabular-nums">{amount}</strong> USD will be posted on that date.
              </p>
            ) : null}
            <div className="mt-6 flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                disabled={saving}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={saving}
                onClick={apply}
                data-testid="opening-balance-confirm"
              >
                {saving ? "Applying…" : "Set start date"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
