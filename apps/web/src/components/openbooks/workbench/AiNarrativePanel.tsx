"use client";

import { useAction } from "convex/react";
import { RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type InsightsSection =
  | "transactions"
  | "income"
  | "expenses"
  | "bills"
  | "contacts"
  | "payroll";

type Finding = { title: string; detail: string; tone: "positive" | "neutral" | "warning" };
type InsightsResult = { summary: string; findings: Finding[]; generatedAt: number; disclaimer: string };

/**
 * On-demand AI narrative for an insights dashboard (Mercury's notable-callouts
 * pattern). Calls the aiInsights action on Generate/Refresh — actions aren't
 * reactive, so the result is held locally. Green, never purple; always shows the
 * "may be inaccurate" disclaimer.
 */
export function AiNarrativePanel({
  section,
  entityId,
  from,
  to,
  className,
}: {
  section: InsightsSection;
  entityId?: string;
  from?: string;
  to?: string;
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

  return (
    <section
      data-testid="ai-narrative-panel"
      className={cn("rounded-[14px] p-4 shadow-xs ring-1 ring-foreground/10", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-ai" />
          AI insights
        </div>
        <Button size="sm" variant="outline" onClick={() => void run()} disabled={loading}>
          <RefreshCw data-icon="inline-start" className={cn(loading && "animate-spin")} />
          {result ? "Refresh" : "Generate"}
        </Button>
      </div>

      {error ? <p className="mt-3 text-sm text-negative">{error}</p> : null}

      {result ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm">{result.summary}</p>
          <div className="flex flex-col gap-2">
            {result.findings.map((finding, index) => (
              <div key={`${finding.title}-${index}`} className="flex gap-2">
                <span
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    finding.tone === "positive"
                      ? "bg-primary"
                      : finding.tone === "warning"
                        ? "bg-warning"
                        : "bg-muted-foreground",
                  )}
                  aria-hidden
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{finding.title}</div>
                  <div className="text-sm text-muted-foreground">{finding.detail}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            {result.disclaimer}
          </p>
        </div>
      ) : !loading && !error ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Generate a written read on this period — net change, trends, and anything worth flagging.
        </p>
      ) : null}
    </section>
  );
}
