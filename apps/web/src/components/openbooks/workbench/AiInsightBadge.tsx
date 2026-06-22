"use client";

import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { ConfidenceRing } from "@/components/openbooks/primitives";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * The quiet, always-green AI affordance: how confident the model was and why.
 * - ring   — a confidence ring, popover on click; for dense table cells.
 * - chip   — a "Sparkles + n%" badge with the same popover; for compact rows.
 * - inline — a flat block (no popover) for inside the DetailSheet on mobile.
 * Brand green only — never purple, violet, or gradient.
 */
export function AiInsightBadge({
  confidence,
  reasoning,
  decidedBy,
  variant,
  align = "end",
  className,
}: {
  confidence?: number;
  reasoning?: ReactNode;
  decidedBy?: string;
  variant: "ring" | "chip" | "inline";
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const pct = confidence != null ? Math.round(confidence <= 1 ? confidence * 100 : confidence) : null;

  if (variant === "inline") {
    return (
      <div className={cn("rounded-[14px] bg-ai-surface p-3 text-sm", className)}>
        <div className="flex items-center gap-2 text-ai">
          <Sparkles className="size-4" aria-hidden="true" />
          <span className="font-medium">AI suggestion</span>
          {pct != null ? <span className="money-figures ml-auto text-xs">{pct}% confident</span> : null}
        </div>
        {reasoning ? <div className="mt-2 text-muted-foreground">{reasoning}</div> : null}
        {decidedBy ? (
          <div className="mt-2 text-xs text-muted-foreground">Decided by {decidedBy}</div>
        ) : null}
      </div>
    );
  }

  const trigger =
    variant === "ring" ? (
      <button
        type="button"
        aria-label={pct != null ? `AI confidence ${pct}%` : "AI insight"}
        className={cn("inline-flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50", className)}
      >
        <ConfidenceRing value={pct ?? 0} />
      </button>
    ) : (
      <Badge
        asChild
        variant="secondary"
        className={cn("cursor-pointer bg-ai-surface text-ai", className)}
      >
        <button type="button" aria-label={pct != null ? `AI confidence ${pct}%` : "AI insight"}>
          <Sparkles data-icon="inline-start" aria-hidden="true" />
          {pct != null ? <span className="money-figures">{pct}%</span> : "AI"}
        </button>
      </Badge>
    );

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="w-72">
        <PopoverHeader>
          <PopoverTitle className="flex items-center gap-1.5 text-ai">
            <Sparkles className="size-3.5" aria-hidden="true" />
            Why this suggestion
          </PopoverTitle>
        </PopoverHeader>
        {pct != null ? (
          <div className="money-figures text-xs text-muted-foreground">{pct}% confident</div>
        ) : null}
        {reasoning ? <div className="text-sm text-popover-foreground">{reasoning}</div> : null}
        {decidedBy ? (
          <div className="text-xs text-muted-foreground">Decided by {decidedBy}</div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
