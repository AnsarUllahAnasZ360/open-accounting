"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { Check, Sparkles } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { aiAutonomyOptions, frontendAiStatus, type AiAutonomyMode } from "@/lib/openbooks/ai";
import { cn } from "@/lib/utils";

// Plain-English consequence under each autonomy card. The threshold itself comes
// from the shared backend constant via providerStatus.thresholds — never hard-coded.
const AUTONOMY_CONSEQUENCE: Record<AiAutonomyMode, string> = {
  suggest: "AI never posts on its own. Every transaction comes to your Inbox first.",
  balanced: "Auto-posts when it's ≥90% sure. The rest waits for you. Recommended.",
  autopilot: "Auto-posts at ≥75% and sends a weekly digest instead of per-item questions.",
};

export function AiSection({
  entityId,
  workspaceId,
}: {
  entityId: Id<"entities"> | null;
  workspaceId: Id<"workspaces"> | null;
}) {
  const providerStatus = useQuery(api.ai.providerStatus, workspaceId ? { workspaceId } : "skip");
  const batchRuns = useQuery(
    api.ai.latestCategorizationBatchRuns,
    entityId ? { entityId, limit: 5 } : "skip",
  );
  const evalRuns = useQuery(
    api.ai.latestCategorizationEvalRuns,
    entityId ? { entityId, limit: 3 } : "skip",
  );
  const setConfig = useMutation(api.ai.setConfig);
  const testConnection = useAction(api.ai.testProviderConnection);

  const [autonomyOverride, setAutonomyOverride] = useState<AiAutonomyMode | null>(null);
  const [testMessage, setTestMessage] = useState("");
  const [testing, setTesting] = useState(false);

  const status = frontendAiStatus(providerStatus);
  const autonomy: AiAutonomyMode = autonomyOverride ?? providerStatus?.autonomy ?? "balanced";

  async function pickAutonomy(value: AiAutonomyMode) {
    if (!workspaceId) {
      setTestMessage("Workspace settings are still loading.");
      return;
    }
    setAutonomyOverride(value);
    try {
      await setConfig({ workspaceId, provider: "bedrock", autonomy: value });
      setTestMessage("");
    } catch (err) {
      setAutonomyOverride(null);
      setTestMessage(err instanceof Error ? err.message : "Could not save AI autonomy.");
    }
  }

  async function runTest() {
    if (!workspaceId) return;
    setTesting(true);
    setTestMessage("Testing the server-side provider…");
    try {
      const result = await testConnection({ workspaceId });
      setTestMessage(result.message);
    } catch (err) {
      setTestMessage(err instanceof Error ? err.message : "Connection test failed.");
    } finally {
      setTesting(false);
    }
  }

  // Spend estimate: derived from batch-run counts × an indicative price table.
  // Clearly labeled an estimate; it is the owner's API bill, not OpenBooks'.
  const categorizedThisMonth = (batchRuns ?? []).reduce((sum, run) => sum + run.postedCount + run.needsReviewCount, 0);
  const estimatedSpend = categorizedThisMonth * 0.0008 + (batchRuns?.length ?? 0) * 0.02;
  const estimatedBudget = Math.max(9, estimatedSpend * 1.8);
  const spendPct = Math.min(100, Math.round((estimatedSpend / estimatedBudget) * 100));

  return (
    <div className="flex flex-col gap-4" data-testid="ai-section">
      {/* Provider + key state */}
      <div className="flex flex-col gap-3.5 rounded-[14px] border bg-card p-5 shadow-xs">
        <div className="text-[13.5px] font-semibold">Your model, your key</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-[12px] font-medium text-[#525252]">Provider</Label>
            <Select value={providerStatus?.configuredProvider ?? "bedrock"} disabled>
              <SelectTrigger className="h-9 w-full" data-testid="ai-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bedrock">Amazon Bedrock</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="google">Google</SelectItem>
                <SelectItem value="ollama">Ollama (local)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block text-[12px] font-medium text-[#525252]">API key</Label>
            <div className="flex h-9 items-center rounded-[10px] border bg-muted/40 px-3 font-mono text-[12px] text-muted-foreground">
              {status.mode === "active" ? "set in Convex env · never shown" : "not configured"}
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block text-[12px] font-medium text-[#525252]">Chat model</Label>
            <div className="flex h-9 items-center rounded-[10px] border bg-muted/40 px-3 text-[13px]" data-testid="ai-chat-model">
              {status.chatModel}
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block text-[12px] font-medium text-[#525252]">Embeddings model</Label>
            <div className="flex h-9 items-center rounded-[10px] border bg-muted/40 px-3 text-[13px]">
              {status.embeddingsModel}
            </div>
          </div>
        </div>
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 rounded-[9px] px-3 py-2.5 text-[12px]",
            status.mode === "active" ? "bg-[#f1f8ee] text-[#17540f]" : "bg-muted text-muted-foreground",
          )}
          data-testid="ai-connection-state"
        >
          {status.mode === "active" ? <Check className="size-3.5" /> : null}
          <span>{status.mode === "active" ? "Connection healthy · keys are encrypted and never leave your server" : status.detail}</span>
          <span className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            data-testid="ai-test-connection"
            disabled={!workspaceId || testing}
            onClick={runTest}
          >
            <Sparkles className="size-3.5" /> Test connection
          </Button>
        </div>
        {testMessage ? <p className="text-[12.5px] text-primary" data-testid="ai-test-message">{testMessage}</p> : null}
      </div>

      {/* Autonomy radio cards */}
      <div className="flex flex-col gap-3 rounded-[14px] border bg-card p-5 shadow-xs">
        <div className="text-[13.5px] font-semibold">How much should AI do on its own?</div>
        <div className="grid gap-2.5 sm:grid-cols-3" data-testid="ai-autonomy-cards">
          {aiAutonomyOptions.map((option) => {
            const on = autonomy === option.value;
            const threshold = providerStatus?.thresholds?.[option.value];
            const thresholdLabel =
              threshold === null || threshold === undefined ? "Never auto-posts" : `Auto-posts at ${Math.round(threshold * 100)}%`;
            return (
              <button
                key={option.value}
                type="button"
                data-testid={`ai-autonomy-${option.value}`}
                data-active={on ? "true" : "false"}
                disabled={!workspaceId}
                onClick={() => pickAutonomy(option.value)}
                className={cn(
                  "flex flex-col gap-1.5 rounded-[12px] border-[1.5px] p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  on ? "border-primary bg-[#fbfdf9]" : "border-border bg-card hover:border-muted-foreground/30",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "size-3.5 rounded-full border-[1.5px]",
                      on ? "border-primary bg-primary shadow-[inset_0_0_0_3px_#fff]" : "border-muted-foreground/40",
                    )}
                  />
                  <span className="text-[13px] font-semibold">{option.label}</span>
                </span>
                <span className="text-[11px] font-medium text-primary">{thresholdLabel}</span>
                <span className="text-[11.5px] leading-snug text-muted-foreground">{AUTONOMY_CONSEQUENCE[option.value]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Spend estimate */}
      <div className="rounded-[14px] border bg-card p-5 shadow-xs" data-testid="ai-spend">
        <div className="flex items-baseline gap-2">
          <span className="text-[13.5px] font-semibold">AI spend this month</span>
          <span className="text-[11.5px] text-muted-foreground/80">your API bill, not ours · estimate</span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="money-figures text-[22px] font-semibold">${estimatedSpend.toFixed(2)}</span>
          <span className="text-[12px] text-muted-foreground">
            of ~${estimatedBudget.toFixed(0)} estimated · {categorizedThisMonth.toLocaleString()} transactions categorized
          </span>
        </div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${spendPct}%` }} />
        </div>
      </div>

      {/* Batch-run history */}
      <div className="rounded-[14px] border bg-card shadow-xs" data-testid="ai-batch-history">
        <div className="border-b px-5 py-3 text-[13.5px] font-semibold">Batch runs</div>
        <div className="divide-y">
          {(batchRuns ?? []).length === 0 ? (
            <div className="px-5 py-4 text-[12.5px] text-muted-foreground">
              No batch runs yet. Imports schedule categorization automatically; runs appear here.
            </div>
          ) : (
            (batchRuns ?? []).map((run) => (
              <div key={run.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-[12.5px]" data-testid="ai-batch-row">
                <span className="money-figures text-muted-foreground">{new Date(run.createdAt).toLocaleString("en-US")}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium capitalize text-muted-foreground">{run.status}</span>
                <span className="text-muted-foreground">{run.summary}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Holdout eval history */}
      <div className="rounded-[14px] border bg-card shadow-xs" data-testid="ai-eval-history">
        <div className="border-b px-5 py-3 text-[13.5px] font-semibold">Categorization eval</div>
        <div className="divide-y">
          {(evalRuns ?? []).length === 0 ? (
            <div className="px-5 py-4 text-[12.5px] text-muted-foreground">
              No label-safe eval runs yet. Holdout results appear here after the verification harness runs.
            </div>
          ) : (
            (evalRuns ?? []).map((run) => (
              <div key={run.id} className="grid gap-1 px-5 py-3 text-[12.5px]" data-testid="ai-eval-row">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="money-figures text-muted-foreground">{new Date(run.createdAt).toLocaleString("en-US")}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium capitalize text-muted-foreground">{run.status.replaceAll("_", " ")}</span>
                  <span className="font-medium">{Math.round(run.accuracy * 1000) / 10}%</span>
                  <span className="text-muted-foreground">{run.correctCount}/{run.evaluatedCount} correct · {run.providerMode}</span>
                </div>
                <div className="text-muted-foreground">{run.finding}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
