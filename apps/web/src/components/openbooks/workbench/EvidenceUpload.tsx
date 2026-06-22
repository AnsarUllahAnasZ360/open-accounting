"use client";

import { FileText, Loader2, Paperclip } from "lucide-react";
import { useRef } from "react";

import { formatMinorMoney } from "@/components/openbooks/primitives";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/openbooks/primitives";
import { cn } from "@/lib/utils";

import { AiInsightBadge } from "./AiInsightBadge";
import { AttentionState } from "./AttentionState";

export type EvidenceDocument = {
  id: string;
  vendor: string;
  date: string;
  totalMinor: number;
  currency?: string;
  fileName?: string | null;
  status: string;
  /** 0–1 or 0–100; AiInsightBadge normalizes either. */
  extractionConfidence?: number;
  extractionNotes?: string;
  matched?: boolean;
};

/**
 * Attach or extract a receipt / document on a transaction, bill, or inbox card.
 * Stateless: it surfaces the attached document, the AI's extraction confidence,
 * and what still needs attention (missing receipt / unmatched), and hands the
 * actual upload and match work to the page via callbacks.
 */
export function EvidenceUpload({
  document,
  onUpload,
  onMatch,
  extracting = false,
  className,
}: {
  /**
   * Metadata only: identifies what the receipt attaches to. This component does
   * NOT route the upload itself — the page owns that via `onUpload`. Pass the
   * same `target` into your `onUpload` handler so the routing stays explicit.
   */
  target?: { kind: string; id: string };
  document?: EvidenceDocument | null;
  onUpload?: (file: File) => void;
  onMatch?: () => void;
  extracting?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handlePick() {
    inputRef.current?.click();
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onUpload?.(file);
    event.target.value = "";
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*,application/pdf"
      className="sr-only"
      onChange={handleChange}
    />
  );

  if (!document) {
    return (
      <div className={cn(className)}>
        {fileInput}
        <EmptyState
          icon={Paperclip}
          title="No receipt attached"
          description="Attach a receipt and AI will read off the vendor, date, and total for you."
          action={
            <div className="flex flex-col items-center gap-2">
              <AttentionState state="missing-evidence" />
              <Button size="sm" onClick={handlePick}>
                <Paperclip data-icon="inline-start" />
                Attach receipt
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <Card className={cn("shadow-xs", className)}>
      {fileInput}
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{document.fileName ?? document.vendor}</span>
        </CardTitle>
        {extracting ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Reading…
          </span>
        ) : document.extractionConfidence != null ? (
          <AiInsightBadge
            variant="chip"
            confidence={document.extractionConfidence}
            reasoning={document.extractionNotes ?? "Fields read from the attached receipt."}
            decidedBy="Receipt extraction"
          />
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Vendor</dt>
            <dd className="min-w-0 truncate">{document.vendor}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Date</dt>
            <dd className="money-figures">{document.date}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Total</dt>
            <dd className="money-figures">
              {formatMinorMoney(document.totalMinor, { currency: document.currency ?? "USD" })}
            </dd>
          </div>
        </dl>
        <div className="flex items-center justify-between gap-2">
          {document.matched ? (
            <span className="text-xs text-muted-foreground">Matched to a transaction</span>
          ) : (
            <AttentionState state="unmatched" />
          )}
          {!document.matched && onMatch ? (
            <Button size="sm" variant="outline" onClick={onMatch}>
              Match transaction
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
