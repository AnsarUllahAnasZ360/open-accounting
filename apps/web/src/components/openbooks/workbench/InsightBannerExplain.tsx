"use client";

import { useAction } from "convex/react";
import { RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { InsightsSection } from "./AiNarrativePanel";

type InsightsResult = {
  summary: string;
  findings: Array<{ title: string; detail: string; tone: string }>;
  generatedAt: number;
  disclaimer: string;
};

/**
 * InsightBannerExplain — the opt-in "Explain" affordance for a page's
 * <InsightBanner /> (E8-T8). It calls the shared `aiInsights.generateInsights`
 * action for the banner's section and shows the model's ONE-SENTENCE summary as a
 * quiet expansion beneath the banner.
 *
 * Contract: the banner's headline NUMBER always comes from the programmatic
 * builder (page-insights.ts) — never from the model. This affordance only adds a
 * plain-English narration ON TOP. When no AI provider key is resolvable the
 * action returns deterministic numbers + a "Computed without AI" disclaimer, so
 * this never blocks and never shows a fabricated value. The disclaimer is shown
 * on every narrated surface, matching AiObservationColumn / AiNarrativePanel.
 */
export function InsightBannerExplain({
  section,
  entityId,
  from,
  to,
  period,
}: {
  /** The aiInsights section to narrate (same vocabulary as the page id). */
  section: InsightsSection;
  /** Active entity for entity-scoped narration (omit for the default entity). */
  entityId?: string;
  /** The page's active window — the narration restates only these figures. */
  from?: string;
  to?: string;
  /** A "YYYY-MM" period (dashboard) — an alternative to an explicit from/to. */
  period?: string;
}) {
  const generate = useAction(api.aiInsights.generateInsights);
  const [open, setOpen] = useState(false);
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
        ...(period ? { period } : {}),
      })) as InsightsResult;
      setResult(next);
      setOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not explain this.");
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 gap-1 px-2 text-xs font-medium text-ai"
        onClick={() => {
          if (result) {
            setOpen((value) => !value);
          } else {
            void run();
          }
        }}
        disabled={loading}
        aria-expanded={open}
        data-testid="page-insight-explain"
      >
        {loading ? (
          <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles className="size-3.5" aria-hidden="true" />
        )}
        Explain
      </Button>

      {open ? (
        <ExplainExpansion result={result} error={error} loading={loading} />
      ) : null}
    </>
  );
}

/**
 * The quiet expansion rendered below the banner row. Lives in a sibling absolute
 * layer so the banner stays a single line; consumers place this component's
 * parent with `relative`. To keep wiring simple it renders inline after the
 * banner instead — see how pages compose it.
 */
function ExplainExpansion({
  result,
  error,
  loading,
}: {
  result: InsightsResult | null;
  error: string;
  loading: boolean;
}) {
  return (
    <div
      data-testid="page-insight-explain-body"
      className={cn(
        "absolute left-0 right-0 top-full z-10 mt-1 rounded-[12px] border bg-card p-3 text-sm shadow-md",
      )}
    >
      {error ? (
        <p className="text-sm text-negative">{error}</p>
      ) : loading && !result ? (
        <p className="text-sm text-muted-foreground">Reading this period…</p>
      ) : result ? (
        <div className="flex flex-col gap-2">
          <p className="leading-snug">{result.summary}</p>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{result.disclaimer}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
