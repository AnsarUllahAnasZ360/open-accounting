"use client";

import { useAction } from "convex/react";
import {
  ArrowUpRight,
  CheckCircle2,
  HelpCircle,
  Info,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { InsightsSection } from "../AiNarrativePanel";
import type { DrillTarget } from "./TransactionsDrillDrawer";

type Finding = { title: string; detail: string; tone: "positive" | "neutral" | "warning" };
type InsightsResult = {
  summary: string;
  findings: Finding[];
  generatedAt: number;
  disclaimer: string;
};

/** An entity chip the model surfaced (a counterparty, a category) that drills to
 * the underlying transactions. The consumer maps the chip to a DrillTarget. */
export type ObservationEntity = {
  label: string;
  target: DrillTarget;
};

export type AiObservation = {
  /** One plain-English sentence. */
  text: string;
  tone: "positive" | "neutral" | "warning";
  /** Clickable entity chips that drill to the underlying transactions. */
  entities?: ObservationEntity[];
  /** The calm "why this surfaced" line. */
  why?: string;
};

const TONE_ICON: Record<AiObservation["tone"], LucideIcon> = {
  positive: CheckCircle2,
  neutral: Info,
  warning: TriangleAlert,
};

/**
 * One AI observation card (E1.4). Quiet and MONOCHROME — a single lucide icon
 * (never purple, never a sparkle cliché), one plain-English sentence, optional
 * clickable entity chips that drill to the underlying transactions, and a calm
 * "why this surfaced" line. The card NEVER acts on the ledger; it only reads and
 * proposes (the "view transactions" affordance opens the read-only drill drawer).
 *
 * Tone maps to a monochrome icon + a small accent on the icon only (green for a
 * good signal, amber for a watch-item) — the card body stays neutral so the
 * column reads calm, not like a wall of alerts.
 */
export function AiObservationCard({
  observation,
  onDrill,
}: {
  observation: AiObservation;
  onDrill: (target: DrillTarget) => void;
}) {
  const Icon = TONE_ICON[observation.tone];
  return (
    <article
      className="flex gap-3 rounded-[12px] p-3 ring-1 ring-foreground/10"
      data-testid="ai-observation-card"
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          observation.tone === "positive"
            ? "text-primary"
            : observation.tone === "warning"
              ? "text-warning"
              : "text-muted-foreground",
        )}
        aria-hidden
      />
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-sm leading-snug">{observation.text}</p>

        {observation.entities && observation.entities.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {observation.entities.map((entity) => (
              <button
                key={entity.label}
                type="button"
                onClick={() => onDrill(entity.target)}
                className="inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                data-testid="ai-observation-entity"
              >
                <span className="max-w-[10rem] truncate">{entity.label}</span>
                <ArrowUpRight className="size-3 text-muted-foreground" aria-hidden />
              </button>
            ))}
          </div>
        ) : null}

        {observation.why ? (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <HelpCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>{observation.why}</span>
          </p>
        ) : null}
      </div>
    </article>
  );
}

/**
 * The AI observation column for an Insights panel (E1.4). Generates observations
 * on demand (actions aren't reactive). THRESHOLD-GATED: if the model returns no
 * notable findings, it shows a calm "Nothing notable this period" state instead
 * of manufacturing cards. Always shows the may-be-inaccurate disclaimer.
 *
 * `mapEntities` lets the consumer turn a finding into drillable entity chips for
 * its section (e.g. resolve a counterparty name in the finding text to a
 * DrillTarget). Kept generic so every section reuses this column.
 */
export function AiObservationColumn({
  section,
  entityId,
  from,
  to,
  onDrill,
  mapFinding,
  className,
}: {
  section: InsightsSection;
  entityId?: string;
  from?: string;
  to?: string;
  onDrill: (target: DrillTarget) => void;
  /** Map a raw finding into a presentational observation (entities, why-line). */
  mapFinding?: (finding: Finding) => AiObservation;
  className?: string;
}) {
  const generate = useAction(api.aiInsights.generateInsights);
  const [result, setResult] = useState<InsightsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true);
    setError("");
    try {
      const next = (await generate({
        section,
        ...(entityId ? { entityId: entityId as Id<"entities"> } : {}),
        from,
        to,
      })) as InsightsResult;
      setResult(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not generate insights.");
    } finally {
      setLoading(false);
    }
  }

  const observations: AiObservation[] =
    result?.findings.map(
      (finding) =>
        mapFinding?.(finding) ?? {
          text: finding.detail || finding.title,
          tone: finding.tone,
        },
    ) ?? [];

  return (
    <section
      data-testid="ai-observation-column"
      className={cn("flex flex-col gap-3 rounded-[14px] p-4 shadow-xs ring-1 ring-foreground/10", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {/* Monochrome AI mark — the design system's quiet AI affordance, never a
              purple sparkle. */}
          <span className="text-ai">AI observations</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => void run()} disabled={loading}>
          <RefreshCw data-icon="inline-start" className={cn(loading && "animate-spin")} />
          {result ? "Refresh" : "Generate"}
        </Button>
      </div>

      {error ? <p className="text-sm text-negative">{error}</p> : null}

      {loading && !result ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-16 rounded-[12px]" />
          ))}
        </div>
      ) : result ? (
        <div className="flex flex-col gap-3">
          {result.summary ? (
            <p className="text-sm text-muted-foreground">{result.summary}</p>
          ) : null}

          {observations.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              {observations.map((observation, index) => (
                <AiObservationCard key={index} observation={observation} onDrill={onDrill} />
              ))}
            </div>
          ) : (
            <NothingNotable />
          )}

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            {result.disclaimer}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Generate a plain-English read on this period — what moved, what&apos;s worth a look, and
          why. AI proposes; nothing posts.
        </p>
      )}
    </section>
  );
}

/** The threshold-gated calm state: when nothing crosses the notability bar, say
 * so plainly rather than inventing cards. */
export function NothingNotable() {
  return (
    <div
      className="flex flex-col items-center gap-1 rounded-[12px] bg-muted/30 px-4 py-6 text-center"
      data-testid="insights-nothing-notable"
    >
      <CheckCircle2 className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      <div className="text-sm font-medium">Nothing notable this period</div>
      <p className="max-w-xs text-xs text-muted-foreground">
        No outliers, concentration risks, or unusual movements crossed the threshold worth
        flagging.
      </p>
    </div>
  );
}
