"use client";

import { useAction, useQuery } from "convex/react";
import { DatabaseBackup, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import { Amount } from "@/components/openbooks/primitives";
import { Button } from "@/components/ui/button";
import {
  downloadReportFile,
  settingsDataExportFiles,
  type ReportPack,
} from "@/lib/openbooks/reports-export";

type ActionState = "idle" | "submitting" | "success" | "error";

type SeedResult = {
  transactionCount: number;
  postedCount: number;
  inboxCount: number;
  evalCount: number;
  trialBalanceDifferenceMinor: number;
  payoutEntryCount: number;
  may2026: {
    incomeMinor: number;
    expenseMinor: number;
    netIncomeMinor: number;
    balanceSheetDifferenceMinor: number;
  };
};

function readableError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const uncaught = error.message.match(/Uncaught Error: ([\s\S]+)/);
  if (uncaught) return uncaught[1].trim().split("\n")[0] ?? fallback;
  return error.message;
}

function isSeedConnectionInterruption(message: string) {
  return /connection lost while action was in flight/i.test(message);
}

function CountBlock({
  label,
  value,
  testId,
}: {
  label: string;
  value: ReactNode;
  testId?: string;
}) {
  return (
    <div className="rounded-lg border px-3 py-2" data-testid={testId}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="money-figures mt-1 text-base font-semibold">{value}</div>
    </div>
  );
}

export function DemoDataPanel() {
  const status = useQuery(api.seedDemo.status, {});
  const seedJob = useQuery(api.seedDemo.jobStatus, {});
  const [state, setState] = useState<ActionState>("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<SeedResult | null>(null);
  const [seedRequestedAt, setSeedRequestedAt] = useState<number | null>(null);
  const trackedSeedJob =
    seedRequestedAt && seedJob && seedJob.startedAt >= seedRequestedAt - 1000 ? seedJob : null;
  const recoveredResult =
    state === "submitting" && trackedSeedJob?.status === "succeeded" && trackedSeedJob.result
      ? trackedSeedJob.result
      : null;
  const displayState: ActionState =
    state === "submitting" && trackedSeedJob?.status === "succeeded"
      ? "success"
      : state === "submitting" && trackedSeedJob?.status === "failed"
        ? "error"
        : state;
  const displayMessage =
    state === "submitting" && trackedSeedJob?.status === "succeeded"
      ? "Demo seed complete."
      : state === "submitting" && trackedSeedJob?.status === "failed"
        ? trackedSeedJob.message ?? "Could not reset demo data."
        : state === "submitting" && trackedSeedJob?.status === "running"
          ? trackedSeedJob.message ?? "Demo seed is running."
          : message;
  const latest = result ?? recoveredResult ?? status;
  const reportPack = useQuery(
    api.reportViews.reportPack,
    latest
      ? {
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          basis: "accrual",
          compare: "none",
          columnMode: "monthly",
        }
      : "skip",
  ) as ReportPack | undefined;
  const resetDemo = useAction(api.seedDemo.resetAndSeed);

  async function resetDemoData() {
    setSeedRequestedAt(Date.now());
    setState("submitting");
    setMessage("");
    try {
      const nextResult = await resetDemo({});
      setResult(nextResult);
      setState("success");
      setMessage("Demo seed complete.");
    } catch (error) {
      const nextMessage = readableError(error, "Could not reset demo data.");
      if (isSeedConnectionInterruption(nextMessage)) {
        setState("submitting");
        setMessage("Demo seed is still running.");
        return;
      }
      setState("error");
      setMessage(nextMessage);
    }
  }

  function exportData(kind: "csv" | "json") {
    if (!reportPack) return;
    const files = settingsDataExportFiles(reportPack);
    const selected =
      kind === "json" ? files.filter((file) => file.mimeType === "application/json") : files.filter((file) => file.mimeType === "text/csv");
    for (const file of selected) {
      downloadReportFile(file);
    }
  }

  return (
    <section className="rounded-lg border bg-card shadow-xs" data-testid="demo-data-panel">
      <div className="flex flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold">
            <DatabaseBackup className="size-4 text-primary" />
            Data
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Reset Acme Studio LLC to the deterministic ledger-backed demo books.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => exportData("csv")} disabled={!reportPack}>
            Export CSV bundle
          </Button>
          <Button variant="outline" onClick={() => exportData("json")} disabled={!reportPack}>
            Export JSON
          </Button>
          <Button onClick={resetDemoData} disabled={displayState === "submitting"}>
            <RefreshCw className={`size-4 ${displayState === "submitting" ? "animate-spin" : ""}`} />
            Reset demo data
          </Button>
        </div>
      </div>

      {displayMessage ? (
        <div
          className={`mx-4 mt-4 rounded-lg border p-3 text-sm ${
            displayState === "error"
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "bg-primary/5 text-primary"
          }`}
          data-testid="demo-seed-message"
        >
          {displayMessage}
        </div>
      ) : null}

      <div className="grid gap-4 p-4">
        {latest ? (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <CountBlock
                label="Transactions"
                testId="demo-seed-transactions"
                value={latest.transactionCount}
              />
              <CountBlock label="Posted" testId="demo-seed-posted" value={latest.postedCount} />
              <CountBlock label="Open Inbox" testId="demo-seed-inbox" value={latest.inboxCount} />
              <CountBlock
                label="Eval labels"
                testId="demo-seed-eval"
                value={latest.evalCount}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <CountBlock
                label="Trial balance difference"
                testId="demo-seed-trial-balance"
                value={<Amount amountMinor={latest.trialBalanceDifferenceMinor} />}
              />
              {result ? (
                <>
                  <CountBlock label="Stripe payouts" value={result.payoutEntryCount} />
                  <CountBlock
                    label="May 2026 net income"
                    value={<Amount amountMinor={result.may2026.netIncomeMinor} />}
                  />
                </>
              ) : (
                <div className="rounded-lg border px-3 py-2 md:col-span-2">
                  <div className="text-xs text-muted-foreground">Last seeded</div>
                  <div className="mt-1 text-sm font-medium">
                    {status ? new Date(status.createdAt).toLocaleString() : "Not seeded yet"}
                  </div>
                </div>
              )}
            </div>
            {result ? (
              <div className="grid gap-3 border-t pt-4 md:grid-cols-4">
                <CountBlock label="May income" value={<Amount amountMinor={result.may2026.incomeMinor} />} />
                <CountBlock label="May expense" value={<Amount amountMinor={result.may2026.expenseMinor} />} />
                <CountBlock label="May net" value={<Amount amountMinor={result.may2026.netIncomeMinor} />} />
                <CountBlock
                  label="May BS difference"
                  value={<Amount amountMinor={result.may2026.balanceSheetDifferenceMinor} />}
                />
              </div>
            ) : null}
          </>
        ) : (
          <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
            Demo books have not been seeded in this workspace yet.
          </div>
        )}
      </div>
    </section>
  );
}
