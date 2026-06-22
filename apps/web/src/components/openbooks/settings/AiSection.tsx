"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { Check, ChevronDown, ExternalLink, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { SecretInput } from "@/components/openbooks/settings/connections/shared";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { aiAutonomyOptions, frontendAiStatus, type AiAutonomyMode } from "@/lib/openbooks/ai";
import { cn } from "@/lib/utils";

const CUSTOM_MODEL = "__custom__";

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
  const catalog = useQuery(api.aiCatalog.list, {});
  const credentialStatus = useQuery(
    api.credentials.credentialStatus,
    workspaceId ? { workspaceId, kind: "ai" as const } : "skip",
  );
  const batchRuns = useQuery(
    api.ai.latestCategorizationBatchRuns,
    entityId ? { entityId, limit: 5 } : "skip",
  );
  const evalRuns = useQuery(
    api.ai.latestCategorizationEvalRuns,
    entityId ? { entityId, limit: 3 } : "skip",
  );
  const setConfig = useMutation(api.ai.setConfig);
  const saveCredential = useMutation(api.credentials.saveCredential);
  const testConnection = useAction(api.ai.testProviderConnection);
  // E2-T10: per-entity calibration status + the recalibrate (fit-and-persist)
  // trigger. Refit cadence is also a weekly cron; this lets an owner refit now.
  const calibration = useQuery(
    api.ai.workspaceCalibration,
    workspaceId ? { workspaceId, ...(entityId ? { entityId } : {}) } : "skip",
  );
  const recalibrate = useAction(api.ai.fitEntityCalibrationsFromHoldout);
  const [recalibrating, setRecalibrating] = useState(false);
  const [calibrationMessage, setCalibrationMessage] = useState("");

  const [autonomyOverride, setAutonomyOverride] = useState<AiAutonomyMode | null>(null);
  const [testMessage, setTestMessage] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyMessage, setKeyMessage] = useState("");

  // Provider / model / credential form state. Provider defaults to the saved
  // workspace provider; the rest follow from the chosen catalog entry.
  const [providerOverride, setProviderOverride] = useState<string | null>(null);
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [customModel, setCustomModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [region, setRegion] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const status = frontendAiStatus(providerStatus);
  const autonomy: AiAutonomyMode = autonomyOverride ?? providerStatus?.autonomy ?? "balanced";

  const selectedProviderId = providerOverride ?? providerStatus?.configuredProvider ?? "bedrock";
  const selectedEntry = useMemo(
    () => (catalog ?? []).find((entry) => entry.id === selectedProviderId) ?? null,
    [catalog, selectedProviderId],
  );
  const savedForProvider = useMemo(
    () => (credentialStatus ?? []).find((row) => row.provider === selectedProviderId) ?? null,
    [credentialStatus, selectedProviderId],
  );

  const credentialKind = selectedEntry?.credentialKind ?? "apiKey";
  const showBaseUrl =
    Boolean(selectedEntry?.requiresBaseUrl) ||
    selectedProviderId === "openai_compatible" ||
    selectedProviderId === "azure" ||
    credentialKind === "none";

  const models = selectedEntry?.models ?? [];
  const configuredModel =
    providerStatus?.configuredProvider === selectedProviderId ? providerStatus.model : null;
  const configuredModelInCatalog = Boolean(
    configuredModel && models.some((model) => model.id === configuredModel),
  );
  const selectedModel = modelOverride ?? configuredModel ?? selectedEntry?.defaultModel ?? "";
  const isCustomModel = selectedModel === CUSTOM_MODEL;
  const effectiveModel = isCustomModel ? customModel.trim() : selectedModel;

  async function pickAutonomy(value: AiAutonomyMode) {
    if (!workspaceId) {
      setTestMessage("Workspace settings are still loading.");
      return;
    }
    setAutonomyOverride(value);
    try {
      // Provider omitted: setConfig preserves the saved provider, only autonomy changes.
      await setConfig({ workspaceId, autonomy: value });
      setTestMessage("");
    } catch (err) {
      setAutonomyOverride(null);
      setTestMessage(err instanceof Error ? err.message : "Could not save AI autonomy.");
    }
  }

  async function saveProviderKey() {
    if (!workspaceId) {
      setKeyMessage("Workspace settings are still loading.");
      return;
    }
    setSaving(true);
    setKeyMessage("");
    try {
      // Build the payload by credential kind so we never send empty secrets.
      const payload: Record<string, string> = {};
      if (credentialKind === "awsKeys") {
        if (accessKeyId.trim()) payload.accessKeyId = accessKeyId.trim();
        if (secretAccessKey.trim()) payload.secretAccessKey = secretAccessKey.trim();
        if (region.trim()) payload.region = region.trim();
      } else if (credentialKind === "apiKey") {
        if (apiKey.trim()) payload.apiKey = apiKey.trim();
      }
      if (showBaseUrl && baseUrl.trim()) payload.baseUrl = baseUrl.trim();

      // Ollama (credentialKind "none") needs no secret — only setConfig + baseUrl.
      const hasSecret = Boolean(payload.apiKey || payload.secretAccessKey);
      if (credentialKind !== "none" && hasSecret) {
        await saveCredential({
          workspaceId,
          kind: "ai",
          provider: selectedProviderId,
          payload,
          model: effectiveModel || undefined,
        });
      }

      await setConfig({
        workspaceId,
        provider: selectedProviderId as "openai",
        chatModel: effectiveModel || undefined,
        categorizeModel: effectiveModel || undefined,
        autonomy,
      });

      // Clear the secret inputs after a successful save; never keep them around.
      setApiKey("");
      setSecretAccessKey("");
      setAccessKeyId("");
      setKeyMessage(
        credentialKind === "none"
          ? "Saved. Ollama needs no key — your base URL is in use."
          : hasSecret
            ? "Saved. Your key is encrypted and never shown again."
            : "Saved provider and model. Add a key to enable AI.",
      );
    } catch (err) {
      setKeyMessage(err instanceof Error ? err.message : "Could not save the provider key.");
    } finally {
      setSaving(false);
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

  async function runRecalibrate() {
    if (!entityId) {
      setCalibrationMessage("Open a business before recalibrating.");
      return;
    }
    setRecalibrating(true);
    setCalibrationMessage("Refitting calibration from the holdout…");
    try {
      const result = await recalibrate({ entityId });
      setCalibrationMessage(
        `Recalibrated ${result.entityCount} ${result.entityCount === 1 ? "business" : "businesses"}. The auto-post gate now compares the calibrated probability.`,
      );
    } catch (err) {
      setCalibrationMessage(err instanceof Error ? err.message : "Could not recalibrate.");
    } finally {
      setRecalibrating(false);
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
      {/* Provider + key state — real BYO switcher driven by the full catalog */}
      <div className="flex flex-col gap-3.5 rounded-[14px] border bg-card p-5 shadow-xs">
        <div className="text-[13.5px] font-semibold">Your model, your key</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Provider</Label>
            <Select
              value={selectedProviderId}
              onValueChange={(value) => {
                setProviderOverride(value);
                setModelOverride(null);
                setKeyMessage("");
              }}
            >
              <SelectTrigger className="h-9 w-full" data-testid="ai-provider" disabled={!catalog}>
                <SelectValue placeholder="Choose a provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {(catalog ?? []).map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Model</Label>
            <Select
              value={selectedModel}
              onValueChange={(value) => setModelOverride(value)}
            >
              <SelectTrigger className="h-9 w-full" data-testid="ai-model" disabled={!selectedEntry}>
                <SelectValue placeholder="Choose a model" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.label}
                    </SelectItem>
                  ))}
                  {configuredModel && !configuredModelInCatalog ? (
                    <SelectItem value={configuredModel}>{configuredModel}</SelectItem>
                  ) : null}
                  <SelectItem value={CUSTOM_MODEL}>Custom model ID…</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {isCustomModel ? (
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Custom model ID</Label>
              <Input
                data-testid="ai-custom-model"
                value={customModel}
                onChange={(event) => setCustomModel(event.target.value)}
                placeholder="e.g. gpt-5-2026-01-01"
                className="h-9 font-mono"
              />
            </div>
          ) : null}

          {/* Credential fields by kind */}
          {credentialKind === "apiKey" ? (
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">API key</Label>
              {savedForProvider?.keyPreview ? (
                <p className="mb-1.5 text-[11.5px] text-ob-green-800" data-testid="ai-key-saved">
                  {savedForProvider.keyPreview} · saved
                </p>
              ) : null}
              <SecretInput
                testId="ai-key-input"
                value={apiKey}
                onChange={setApiKey}
                placeholder={savedForProvider?.keyPreview ? "Paste a new key to replace" : "Paste your provider key"}
              />
            </div>
          ) : null}
          {credentialKind === "awsKeys" ? (
            <>
              <div>
                <Label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">AWS access key ID</Label>
                <SecretInput
                  testId="ai-key-input"
                  value={accessKeyId}
                  onChange={setAccessKeyId}
                  placeholder="AKIA…"
                />
              </div>
              <div>
                <Label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">AWS secret access key</Label>
                <SecretInput
                  testId="ai-secret-input"
                  value={secretAccessKey}
                  onChange={setSecretAccessKey}
                  placeholder={savedForProvider?.keyPreview ? `${savedForProvider.keyPreview} · saved` : "Paste your secret"}
                />
              </div>
              <div>
                <Label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Region</Label>
                <Input
                  data-testid="ai-region-input"
                  value={region}
                  onChange={(event) => setRegion(event.target.value)}
                  placeholder="us-east-1"
                  className="h-9"
                />
              </div>
            </>
          ) : null}
          {showBaseUrl ? (
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Base URL</Label>
              <Input
                data-testid="ai-base-url-input"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder={selectedEntry?.defaultBaseUrl ?? "https://…"}
                className="h-9 font-mono"
              />
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selectedEntry?.keysUrl ? (
            <a
              href={selectedEntry.keysUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
              data-testid="ai-keys-url"
            >
              <ExternalLink className="size-3.5" /> Get a key
            </a>
          ) : null}
          <span className="flex-1" />
          <Button
            size="sm"
            data-testid="ai-save-key"
            disabled={!workspaceId || saving || !catalog}
            onClick={saveProviderKey}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
        {keyMessage ? <p className="text-[12.5px] text-primary" data-testid="ai-key-message">{keyMessage}</p> : null}

        <div
          className={cn(
            "flex flex-wrap items-center gap-2 rounded-[9px] px-3 py-2.5 text-[12px]",
            status.mode === "active" ? "bg-ob-green-50 text-ob-green-800" : "bg-muted text-muted-foreground",
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
        <div className="grid gap-2.5 sm:grid-cols-3" data-testid="ai-autonomy-cards" role="radiogroup" aria-label="How much should AI do on its own?">
          {aiAutonomyOptions.map((option) => {
            const on = autonomy === option.value;
            const threshold = providerStatus?.thresholds?.[option.value];
            const thresholdLabel =
              threshold === null || threshold === undefined ? "Never auto-posts" : `Auto-posts at ${Math.round(threshold * 100)}%`;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={on}
                data-testid={`ai-autonomy-${option.value}`}
                data-active={on ? "true" : "false"}
                disabled={!workspaceId}
                onClick={() => pickAutonomy(option.value)}
                className={cn(
                  "flex flex-col gap-1.5 rounded-[12px] border-[1.5px] p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  on ? "border-primary bg-ob-green-50/40" : "border-border bg-card hover:border-muted-foreground/30",
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

      {/* Diagnostics: batch-run + categorization-eval history, demoted into a
          single disclosure below the owner-legible provider/autonomy/spend cards.
          Default CLOSED (report 6.10) — diagnostics are not part of the owner's
          everyday view; the disclosure opens on demand and the verifiable
          batch/eval history (and its testids) stays reachable inside it. */}
      <Collapsible className="rounded-[14px] border bg-card shadow-xs" data-testid="ai-diagnostics">
        <CollapsibleTrigger
          data-testid="ai-diagnostics-trigger"
          className="group flex w-full items-center justify-between gap-2 px-5 py-3 text-left text-[13.5px] font-semibold"
        >
          <span className="flex items-center gap-2">
            Diagnostics
            <span className="text-[11.5px] font-normal text-muted-foreground/80">
              batch runs &amp; categorization eval
            </span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t" data-testid="ai-batch-history">
            <div className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">Batch runs</div>
            <div className="divide-y border-t">
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

          <div className="border-t" data-testid="ai-eval-history">
            <div className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">Categorization eval</div>
            <div className="divide-y border-t">
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

          {/* E2-T10: confidence calibration status + recalibrate trigger. The gate
              compares the CALIBRATED probability against the unchanged autonomy
              thresholds; recalibrating refits per-entity from the holdout. */}
          <div className="border-t" data-testid="ai-calibration">
            <div className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
              Confidence calibration
            </div>
            <div className="flex flex-col gap-2 border-t px-5 py-3 text-[12.5px]">
              {calibration?.configured ? (
                <div className="flex flex-wrap items-center gap-2" data-testid="ai-calibration-status">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium capitalize text-muted-foreground">
                    {calibration.scope}
                  </span>
                  <span className="text-muted-foreground">
                    {calibration.method} · {calibration.sampleCount} samples · ECE {calibration.eceBefore.toFixed(3)} → {calibration.eceAfter.toFixed(3)}
                  </span>
                </div>
              ) : (
                <p className="text-muted-foreground" data-testid="ai-calibration-status">
                  Not yet calibrated — the gate compares raw confidence until a holdout is fit.
                </p>
              )}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="ai-recalibrate"
                  disabled={!entityId || recalibrating}
                  onClick={runRecalibrate}
                >
                  {recalibrating ? "Recalibrating…" : "Recalibrate"}
                </Button>
                {calibrationMessage ? (
                  <span className="text-[12px] text-primary" data-testid="ai-calibration-message">
                    {calibrationMessage}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
