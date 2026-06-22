"use client";

import { useState } from "react";
import {
  AlertCircle,
  Clock,
  Gauge,
  ListChecks,
  Receipt,
  Repeat,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { InsightIcon, InsightTone, PageId, PageInsight } from "./page-insights";

/**
 * InsightBanner — the single, small, on-brand banner every operational page
 * renders ONCE above its workbench. It shows one plain-English line built from
 * that page's own ledger-derived read-model (see page-insights.ts), an optional
 * drillable chip, and quiet finance-disciplined color.
 *
 * Discipline: ordinary spend is never red; only overdue / runway-tight carry the
 * negative token. No gradients, no sparkle clichés, no emoji. When the page
 * builder returns null the parent renders nothing (threshold-gated), so this
 * component always receives a real insight.
 */

/** lucide component per registry icon name (registry stays React-free). */
const ICONS: Record<InsightIcon, LucideIcon> = {
  "trending-up": TrendingUp,
  "trending-down": TrendingDown,
  "alert-circle": AlertCircle,
  clock: Clock,
  repeat: Repeat,
  users: Users,
  wallet: Wallet,
  receipt: Receipt,
  "list-checks": ListChecks,
  gauge: Gauge,
  sparkles: Sparkles,
};

/**
 * tone → design-system surface/text/border tokens. Mirrors the AttentionState /
 * KpiTone vocabulary so the banner reads the same as the rest of the product.
 */
const TONE_CLASSES: Record<InsightTone, string> = {
  neutral: "bg-muted/50 text-foreground border-border",
  income: "bg-positive-surface text-foreground border-positive/30",
  ai: "bg-ai-surface text-foreground border-ai/20",
  warning: "bg-warning-surface text-foreground border-warning/30",
  negative: "bg-negative-surface text-foreground border-negative/30",
};

/** Icon color per tone — green/amber/red only where the metric earns it. */
const TONE_ICON_CLASSES: Record<InsightTone, string> = {
  neutral: "text-muted-foreground",
  income: "text-primary",
  ai: "text-ai",
  warning: "text-warning",
  negative: "text-negative",
};

export function InsightBanner({
  page,
  insight,
  onChip,
  explainSlot,
  dismissible = false,
  className,
}: {
  /** Which surface this banner belongs to — exposed as data-page for tests. */
  page: PageId;
  /** The built insight (never null — parent hides the banner when null). */
  insight: PageInsight;
  /** Called when the drill chip is clicked, with the chip's action key. */
  onChip?: (action: NonNullable<PageInsight["chip"]>["action"]) => void;
  /**
   * Optional trailing affordance (e.g. the E8-T8 "Explain" button). Rendered at
   * the end of the row so the programmatic headline always reads first.
   */
  explainSlot?: React.ReactNode;
  /** Allow per-session dismissal. Off by default (always-on, threshold-gated). */
  dismissible?: boolean;
  className?: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const Icon = ICONS[insight.icon];
  const { chip } = insight;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="page-insight-banner"
      data-page={page}
      data-tone={insight.tone}
      className={cn(
        // `relative` anchors the optional Explain expansion (rendered in the
        // explainSlot) directly beneath the banner row.
        "relative flex w-full items-center gap-2 rounded-[14px] border px-3 py-2 text-sm",
        TONE_CLASSES[insight.tone],
        className,
      )}
    >
      <Icon className={cn("size-4 shrink-0", TONE_ICON_CLASSES[insight.tone])} aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate sm:whitespace-normal sm:break-words">{insight.text}</p>

      {chip ? (
        onChip ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs font-medium"
            onClick={() => onChip(chip.action)}
          >
            {chip.label}
          </Button>
        ) : (
          <Badge variant="secondary" className="shrink-0 font-normal">
            {chip.label}
          </Badge>
        )
      ) : null}

      {explainSlot ? <div className="shrink-0">{explainSlot}</div> : null}

      {dismissible ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Dismiss insight"
          className="size-6 shrink-0 text-muted-foreground"
          onClick={() => setDismissed(true)}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
