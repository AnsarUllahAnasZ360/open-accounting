"use client";

import {
  ArrowLeftRight,
  CircleAlert,
  Landmark,
  PencilLine,
  Tags,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { AiInsightBadge } from "./AiInsightBadge";
import {
  provenanceChipLabel,
  type Provenance,
  type ProvenanceKind,
} from "./provenance-chip-label";

export {
  provenanceChipLabel,
  type Provenance,
  type ProvenanceKind,
} from "./provenance-chip-label";

/**
 * E7-2 — the single, quiet, brand-correct provenance chip. Replaces the AI-only
 * badge so EVERY decision reads its real source: Rule / Memory / Matched /
 * Imported / AI N% / Needs review / Manual. The owner's trust in the register
 * rests on always seeing WHY a transaction landed where it did.
 *
 * Design rules (AGENTS.md): no purple, no gradient. AI keeps the quiet green
 * ai-surface token (and the existing click-to-explain popover via
 * AiInsightBadge); rule/memory/match/transfer/imported/manual are neutral muted;
 * needs_review uses the warning token (consistent with AttentionState).
 */

const chipIconAndToken: Record<
  Exclude<ProvenanceKind, "ai">,
  { icon: LucideIcon; tokenClass: string }
> = {
  rule: { icon: Tags, tokenClass: "bg-muted text-muted-foreground" },
  memory: { icon: Tags, tokenClass: "bg-muted text-muted-foreground" },
  match: { icon: ArrowLeftRight, tokenClass: "bg-muted text-muted-foreground" },
  transfer: { icon: ArrowLeftRight, tokenClass: "bg-muted text-muted-foreground" },
  imported: { icon: Landmark, tokenClass: "bg-muted text-muted-foreground" },
  needs_review: { icon: CircleAlert, tokenClass: "bg-warning-surface text-warning" },
  manual: { icon: PencilLine, tokenClass: "bg-muted text-muted-foreground" },
};

export function ProvenanceChip({
  provenance,
  reasoning,
  className,
}: {
  provenance: Provenance;
  /** Humanized AI reasoning surfaced in the AI kind's "why this" popover. */
  reasoning?: string | null;
  className?: string;
}) {
  // AI keeps the existing quiet-green click-to-explain popover (confidence +
  // reasoning) by composing AiInsightBadge in its chip variant.
  if (provenance.kind === "ai") {
    return (
      <span onClick={(event) => event.stopPropagation()} className={cn("shrink-0", className)}>
        <AiInsightBadge
          variant="chip"
          confidence={provenance.confidence ?? undefined}
          reasoning={reasoning ?? "Categorized by the AI."}
          decidedBy="ai"
        />
      </span>
    );
  }

  const meta = chipIconAndToken[provenance.kind];
  const Icon = meta.icon;
  // Prefer the sentence-style, count-aware label from the server (decisions.md
  // Q36); fall back to the one-word kind name when no label is present.
  const label = provenanceChipLabel(provenance);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="secondary"
          className={cn("max-w-full cursor-default", meta.tokenClass, className)}
          data-testid="provenance-chip"
          data-provenance-kind={provenance.kind}
        >
          <Icon data-icon="inline-start" aria-hidden="true" />
          <span className="truncate">{label}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
