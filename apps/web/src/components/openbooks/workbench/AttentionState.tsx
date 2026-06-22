"use client";

import {
  CircleAlert,
  Clock,
  FileX,
  Receipt,
  Sparkles,
  Unlink,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The single shared status vocabulary for the whole product. Every table,
 * drawer, KPI, and inbox card reads attention from this one source of truth, so
 * "what needs my attention" reads the same wherever it appears.
 */
export type AttentionKind =
  | "needs-review"
  | "missing-evidence"
  | "overdue"
  | "unmatched"
  | "unposted"
  | "low-confidence";

type AttentionMeta = {
  /** Plain-English label written from the owner's side of the screen. */
  label: string;
  icon: LucideIcon;
  /**
   * Token-driven Badge classes. Only overdue carries the alarm token; review
   * and low-confidence lean on the quiet warning/AI tokens; the rest are
   * neutral so ordinary work never reads as an emergency.
   */
  tokenClass: string;
};

export const attentionMeta: Record<AttentionKind, AttentionMeta> = {
  "needs-review": {
    label: "Needs review",
    icon: CircleAlert,
    tokenClass: "bg-warning-surface text-warning",
  },
  "low-confidence": {
    label: "Low confidence",
    icon: Sparkles,
    tokenClass: "bg-ai-surface text-ai",
  },
  overdue: {
    label: "Overdue",
    icon: Clock,
    tokenClass: "bg-negative-surface text-negative",
  },
  "missing-evidence": {
    label: "Missing receipt",
    icon: Receipt,
    tokenClass: "bg-muted text-muted-foreground",
  },
  unmatched: {
    label: "Unmatched",
    icon: Unlink,
    tokenClass: "bg-muted text-muted-foreground",
  },
  unposted: {
    label: "Not posted",
    icon: FileX,
    tokenClass: "bg-muted text-muted-foreground",
  },
};

export function AttentionState({
  state,
  count,
  size = "default",
  iconOnly = false,
  className,
}: {
  state: AttentionKind;
  count?: number;
  size?: "default" | "sm";
  /** Collapse to an icon-only chip with a Tooltip label at narrow widths. */
  iconOnly?: boolean;
  className?: string;
}) {
  const meta = attentionMeta[state];
  const Icon = meta.icon;
  const label = count != null ? `${meta.label} (${count})` : meta.label;

  if (iconOnly) {
    return (
      <Tooltip>
        <TooltipTrigger
          aria-label={label}
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-full",
            meta.tokenClass,
            className,
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Badge
      variant="secondary"
      className={cn(meta.tokenClass, size === "sm" && "h-4 text-xs", className)}
    >
      <Icon data-icon="inline-start" aria-hidden="true" />
      {label}
    </Badge>
  );
}
