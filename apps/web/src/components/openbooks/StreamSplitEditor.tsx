"use client";

import { useMutation, useQuery } from "convex/react";
import { Check, Plus, Split, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type StreamLine = { streamLabel: string; amountMinor: number };

function formatMinor(amountMinor: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}

// Parse a dollars string to ABSOLUTE minor units (or null if blank/invalid).
function dollarsToMinorAbs(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d*\.?\d{0,2}$/.test(trimmed)) return null;
  const n = Number.parseFloat(trimmed);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

/**
 * Revenue-stream split editor for a single transaction (streams redesign).
 * Default: one stream dropdown (the whole amount → one stream). "Split between
 * streams" expands into rows, each with a stream + amount, and a live Remaining
 * counter that turns green at exactly $0. Amounts are entered as absolute
 * dollars; the transaction's sign is applied on save so the split sums to the
 * (signed) transaction total.
 */
export function StreamSplitEditor({
  entityId,
  transactionId,
  amountMinor,
  currency,
  initialStreams,
}: {
  entityId: Id<"entities">;
  transactionId: Id<"transactions">;
  amountMinor: number;
  currency: string;
  initialStreams: StreamLine[];
}) {
  const listed = useQuery(api.streamTags.listStreams, { entityId });
  const save = useMutation(api.streamTags.setTransactionStreams);

  const totalAbs = Math.abs(amountMinor);
  const sign = amountMinor < 0 ? -1 : 1;

  const [split, setSplit] = useState(initialStreams.length > 1);
  const [rows, setRows] = useState<Array<{ label: string; amountStr: string }>>(() => {
    if (initialStreams.length === 0) return [{ label: "", amountStr: "" }];
    return initialStreams.map((line) => ({
      label: line.streamLabel,
      amountStr: (Math.abs(line.amountMinor) / 100).toFixed(2),
    }));
  });
  const [saving, setSaving] = useState(false);

  const options = listed?.streams ?? [];

  // In single mode the whole amount goes to one stream; in split mode the rows
  // must sum to the total.
  const allocatedAbs = useMemo(() => {
    if (!split) return totalAbs;
    return rows.reduce((sum, row) => sum + (dollarsToMinorAbs(row.amountStr) ?? 0), 0);
  }, [split, rows, totalAbs]);
  const remainingAbs = totalAbs - allocatedAbs;

  const singleLabel = rows[0]?.label.trim() ?? "";
  const canSave = split
    ? remainingAbs === 0 && rows.every((r) => r.label.trim() && dollarsToMinorAbs(r.amountStr))
    : singleLabel.length > 0;

  function setRow(index: number, patch: Partial<{ label: string; amountStr: string }>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function enableSplit() {
    // Seed split rows from the current single selection + one empty row.
    const seed: Array<{ label: string; amountStr: string }> = [];
    if (singleLabel) seed.push({ label: singleLabel, amountStr: (totalAbs / 100).toFixed(2) });
    seed.push({ label: "", amountStr: "" });
    setRows(seed);
    setSplit(true);
  }

  function collapseToSingle() {
    setRows([{ label: rows[0]?.label ?? "", amountStr: "" }]);
    setSplit(false);
  }

  async function persist(streams: StreamLine[]) {
    setSaving(true);
    try {
      await save({ transactionId, streams });
      toast.success(streams.length ? "Revenue stream saved." : "Revenue stream cleared.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not save the revenue stream."));
    } finally {
      setSaving(false);
    }
  }

  async function onSave() {
    const streams: StreamLine[] = split
      ? rows
          .filter((row) => row.label.trim() && dollarsToMinorAbs(row.amountStr))
          .map((row) => ({ streamLabel: row.label.trim(), amountMinor: (dollarsToMinorAbs(row.amountStr) ?? 0) * sign }))
      : singleLabel
        ? [{ streamLabel: singleLabel, amountMinor: totalAbs * sign }]
        : [];
    await persist(streams);
  }

  return (
    <div className="grid gap-2.5" data-testid="stream-split-editor">
      <datalist id="stream-split-options">
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>

      <div className="flex items-center justify-between gap-2">
        <Label className="text-[12.5px] font-medium">Stream</Label>
        {!split ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11.5px] text-primary hover:underline"
            onClick={enableSplit}
            data-testid="stream-split-enable"
          >
            <Split className="size-3" /> Split between streams
          </button>
        ) : (
          <button
            type="button"
            className="text-[11.5px] text-muted-foreground hover:text-foreground"
            onClick={collapseToSingle}
            data-testid="stream-split-collapse"
          >
            Single stream
          </button>
        )}
      </div>

      <p className="text-[11.5px] leading-4 text-muted-foreground">
        {amountMinor < 0
          ? "Tagging this expense assigns it as the stream's direct cost."
          : "Tagging this adds to the stream's revenue."}
      </p>

      {!split ? (
        <Input
          list="stream-split-options"
          value={rows[0]?.label ?? ""}
          onChange={(event) => setRow(0, { label: event.target.value })}
          placeholder="e.g. Web Dev"
          className="h-8 text-[13px]"
          data-testid="stream-single-input"
        />
      ) : (
        <div className="grid gap-2">
          {rows.map((row, index) => (
            <div key={index} className="flex items-center gap-2" data-testid="stream-split-row">
              <Input
                list="stream-split-options"
                value={row.label}
                onChange={(event) => setRow(index, { label: event.target.value })}
                placeholder="Stream"
                className="h-8 flex-1 text-[13px]"
              />
              <Input
                inputMode="decimal"
                value={row.amountStr}
                onChange={(event) => setRow(index, { amountStr: event.target.value })}
                placeholder="0.00"
                className="h-8 w-[96px] text-right text-[13px] money-figures"
              />
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                aria-label="Remove split row"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11.5px] text-primary hover:underline"
              onClick={() => setRows((prev) => [...prev, { label: "", amountStr: "" }])}
              data-testid="stream-split-add-row"
            >
              <Plus className="size-3" /> Add stream
            </button>
            <span
              className={
                remainingAbs === 0
                  ? "text-[11.5px] font-medium text-ob-green-700"
                  : "text-[11.5px] font-medium text-negative"
              }
              data-testid="stream-split-remaining"
            >
              {remainingAbs === 0
                ? "Fully allocated"
                : `Remaining: ${formatMinor(remainingAbs * sign, currency)}`}
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={onSave} disabled={saving || !canSave} data-testid="stream-split-save">
          <Check className="size-3.5" />
          {saving ? "Saving…" : "Save stream"}
        </Button>
        {initialStreams.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => persist([])}
            data-testid="stream-split-clear"
          >
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
