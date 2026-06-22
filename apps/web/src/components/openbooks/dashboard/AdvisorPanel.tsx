"use client";

import { useAction } from "convex/react";
import { ArrowUpRight, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Advisor surface (Epic E9-T5) — 'How am I doing? / What should I worry about?'.
 *
 * Renders the AI CFO advisory cards from api.aiCfo.generateAdvisories. Actions
 * aren't reactive, so the result is held locally and (re)fetched on mount and on
 * the owner's 'Refresh insights' click — the AiNarrativePanel pattern.
 *
 * Honesty rules (design + decisions): the engine ALWAYS returns deterministic,
 * ledger-grounded cards even with no AI key, so the panel never shows an error
 * for a missing key — it shows the computed advice plus a quiet note. Severity
 * styling is quiet: warn = attention (amber), never alarm red for ordinary
 * spend; one brand green for positive; no gradients/emoji/purple AI styling.
 */

type AdvisorySeverity = "info" | "watch" | "warn";
type AdvisoryCard = { signalKey: string; title: string; body: string; severity: AdvisorySeverity };
type AdvisoriesResult = {
  summary: string;
  cards: AdvisoryCard[];
  source: "ai" | "deterministic";
  disclaimer: string;
  taxDisclaimer: string;
};

// Map a signal key to the workbench/report that explains it (drill-down). The
// `periodQuery` keeps the destination on the dashboard's active period.
function drillHref(signalKey: string, periodQuery: string): string {
  const family = signalKey.split(":")[0];
  switch (family) {
    case "runway":
    case "forecast":
      return `/reports?report=cash-flow&${periodQuery}`;
    case "income_trend":
    case "concentration":
      return `/income?${periodQuery}`;
    case "expense_creep":
      return `/expenses?${periodQuery}`;
    case "tax":
      return `/reports?report=profit-and-loss&${periodQuery}`;
    case "anomaly":
      // Anomalies are flagged transactions — open the register to review them.
      return `/transactions?${periodQuery}`;
    default:
      return `/reports?${periodQuery}`;
  }
}

function severityDot(severity: AdvisorySeverity): string {
  // Quiet by design: warn uses the attention (amber) token, NOT alarm red; watch
  // is muted-foreground; info uses the brand green.
  if (severity === "warn") return "bg-warning";
  if (severity === "watch") return "bg-muted-foreground";
  return "bg-primary";
}

export function AdvisorPanel({
  entityId,
  periodQuery,
  today,
  className,
}: {
  entityId?: string;
  periodQuery: string;
  today?: string;
  className?: string;
}) {
  const generate = useAction(api.aiCfo.generateAdvisories);
  const [result, setResult] = useState<AdvisoriesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true);
    setError("");
    try {
      const next = (await generate({
        ...(entityId ? { entityId: entityId as Id<"entities"> } : {}),
        ...(today ? { today } : {}),
      })) as AdvisoriesResult;
      setResult(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load advisor insights.");
    } finally {
      setLoading(false);
    }
  }

  // Deterministic-first paint: load grounded advice on mount (and when the active
  // entity changes) so the panel is useful without a click; the owner can refresh
  // to re-run the AI pass. This is a mount-time fetch from an external system (a
  // Convex action), the rule's documented exception; a cancel guard drops a
  // stale in-flight result if the entity changes mid-fetch.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time fetch from an external system (a Convex action); the rule's documented exception.
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const next = (await generate({
          ...(entityId ? { entityId: entityId as Id<"entities"> } : {}),
          ...(today ? { today } : {}),
        })) as AdvisoriesResult;
        if (!cancelled) setResult(next);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not load advisor insights.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run when the active entity changes; the period only affects drill links.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  const showDegradedNote = result?.source === "deterministic";
  const hasTax = result?.cards.some((card) => card.signalKey.split(":")[0] === "tax") ?? false;

  return (
    <section
      data-testid="advisor-panel"
      className={cn(
        "rounded-[14px] bg-card p-5 shadow-xs ring-1 ring-foreground/10",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-ai" aria-hidden />
          <h2 className="text-sm font-semibold">How am I doing?</h2>
          <span className="text-xs text-muted-foreground">what to watch this period</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void run()}
          disabled={loading}
          data-testid="advisor-refresh"
        >
          <RefreshCw data-icon="inline-start" className={cn(loading && "animate-spin")} />
          Refresh insights
        </Button>
      </div>

      {error ? <p className="mt-3 text-sm text-negative">{error}</p> : null}

      {result ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm">{result.summary}</p>

          {result.cards.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-2" data-testid="advisor-cards">
              {result.cards.map((card) => (
                <li key={card.signalKey}>
                  <Link
                    href={drillHref(card.signalKey, periodQuery)}
                    data-testid="advisor-card"
                    data-signal={card.signalKey}
                    className="group flex h-full items-start gap-2 rounded-[12px] border border-foreground/10 p-3 transition-colors hover:border-primary/40 hover:bg-muted/40"
                  >
                    <span
                      className={cn("mt-1.5 size-2 shrink-0 rounded-full", severityDot(card.severity))}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-1.5">
                        <span className="text-sm font-medium">{card.title}</span>
                        <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden />
                      </span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{card.body}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not enough posted activity yet to advise on. As your books fill in, runway, trends,
              and things to watch will show up here.
            </p>
          )}

          {hasTax ? (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {result.taxDisclaimer}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{result.disclaimer}</span>
            {showDegradedNote ? (
              <span data-testid="advisor-degraded-note" className="text-muted-foreground/80">
                · Showing computed ledger advice.
              </span>
            ) : null}
          </div>
        </div>
      ) : loading ? (
        <p className="mt-3 text-sm text-muted-foreground">Reading your ledger…</p>
      ) : null}
    </section>
  );
}
