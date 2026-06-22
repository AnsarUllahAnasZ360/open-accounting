"use client";
import Link from "next/link";

import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { DemoDataPanel } from "@/components/openbooks/DemoDataPanel";
import { LeadsPanel } from "@/components/openbooks/LeadsPanel";
import { SettingsCard } from "@/components/openbooks/settings/_shell";
import { Button } from "@/components/ui/button";
import {
  accountCsvFiles,
  accountJsonFile,
  accountZipFileName,
  buildZip,
  downloadBlob,
  downloadTextFile,
  type AccountSnapshot,
} from "@/lib/openbooks/account-export";
import { useActiveEntity } from "@/lib/openbooks/active-entity";
import {
  downloadReportFile,
  reportCsvFile,
  settingsDataExportFiles,
  type ReportPack,
} from "@/lib/openbooks/reports-export";

const REPORT_ARGS = {
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  basis: "accrual" as const,
  compare: "none" as const,
  columnMode: "monthly" as const,
};

export function DataSection() {
  const { activeEntity } = useActiveEntity();
  const convex = useConvex();
  const viewer = useQuery(api.session.viewer, {});
  const logExport = useMutation(api.exportAccount.logExport);
  const reportPack = useQuery(
    api.reportViews.reportPack,
    activeEntity.id ? { ...REPORT_ARGS, entityId: activeEntity.id as Id<"entities"> } : REPORT_ARGS,
  ) as ReportPack | undefined;
  const canReset = viewer?.role === "owner";
  const resetPreview = useQuery(api.realTestReset.preview, canReset ? {} : "skip");
  const factoryPreview = useQuery(api.workspaceReset.preview, canReset ? {} : "skip");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState("");

  async function exportEverything() {
    setExportBusy(true);
    setExportMessage("");
    try {
      const entityArg = activeEntity.id ? { entityId: activeEntity.id as Id<"entities"> } : {};
      const snapshot = (await convex.query(api.exportAccount.fullAccount, entityArg)) as AccountSnapshot;
      // JSON snapshot + a zip of per-table CSVs (incl. a CPA-readable journal-lines CSV).
      downloadTextFile(accountJsonFile(snapshot));
      downloadBlob(buildZip(accountCsvFiles(snapshot)), accountZipFileName(snapshot));
      // Server-logged for traceability (writes a workspace.exported audit row).
      await logExport(entityArg);
      setExportMessage("Exported your full account: a JSON snapshot and a zip of per-table CSVs.");
    } catch (caught) {
      setExportMessage(caught instanceof Error ? caught.message : "Export failed.");
    } finally {
      setExportBusy(false);
    }
  }

  function exportBundle() {
    if (!reportPack) return;
    for (const file of settingsDataExportFiles(reportPack)) downloadReportFile(file);
  }

  function exportJson() {
    if (!reportPack) return;
    const files = settingsDataExportFiles(reportPack);
    const json = files.find((file) => file.mimeType === "application/json");
    if (json) downloadReportFile(json);
  }

  function exportGeneralLedger() {
    if (!reportPack) return;
    downloadReportFile(reportCsvFile("general-ledger", reportPack));
  }

  return (
    <div className="flex flex-col gap-4" data-testid="data-section">
      <SettingsCard className="flex flex-col gap-3">
        <div className="text-[13.5px] font-semibold">Your data is a file you own</div>
        <div className="text-[12.5px] text-muted-foreground">Everything exports, any time. Reports and a full JSON snapshot are one click away.</div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" data-testid="data-export-everything" disabled={exportBusy} onClick={exportEverything}>
            {exportBusy ? "Exporting…" : "Export everything (full account)"}
          </Button>
          <Button size="sm" variant="outline" data-testid="data-export-bundle" disabled={!reportPack} onClick={exportBundle}>
            CSV bundle (every report)
          </Button>
          <Button size="sm" variant="outline" data-testid="data-export-json" disabled={!reportPack} onClick={exportJson}>
            JSON dump
          </Button>
          <Button size="sm" variant="outline" data-testid="data-export-gl" disabled={!reportPack} onClick={exportGeneralLedger}>
            General Ledger — for your accountant
          </Button>
        </div>
        <p className="text-[12px] text-muted-foreground">
          “Export everything” downloads a complete JSON snapshot of your books plus a zip of per-table CSVs
          (including a journal-lines CSV your accountant can read). Secrets and connection tokens are never included.
        </p>
        {exportMessage ? <p className="text-[12px] text-muted-foreground" data-testid="data-export-message">{exportMessage}</p> : null}
      </SettingsCard>

      {/* Reset demo + import live in the existing panel; relocated here per plan. */}
      <DemoDataPanel />

      {canReset ? <RealTestResetPanel preview={resetPreview} /> : null}

      {/* Request-access leads stay under Data (E1 note). */}
      <LeadsPanel />

      {canReset ? (
        <WorkspaceResetPanel
          workspaceName={viewer?.workspace?.name ?? ""}
          preview={factoryPreview}
        />
      ) : null}

      <SettingsCard tone="danger" testId="data-danger-zone">
        <div className="text-[13px] font-semibold text-negative">Danger zone</div>
        <div className="mt-1 text-[12.5px] text-muted-foreground">
          Archiving a business hides it from the switcher but preserves its books. To wipe everything and start fresh, use &ldquo;Delete all data &amp; re-run onboarding&rdquo; above.
        </div>
        <Button asChild size="sm" variant="outline" className="mt-2.5 border-negative/40 text-negative hover:bg-negative-surface">
          <Link href="/settings/businesses">Manage businesses</Link>
        </Button>
      </SettingsCard>
    </div>
  );
}

/**
 * Owner-scoped "reset this workspace to factory" (Epic E4-T10 / E11-T3). Wipes
 * only THIS workspace's books, connections, and transactions (other workspaces
 * and the user account are untouched), then returns the viewer to onboarding.
 * Requires re-typing the exact workspace name to confirm and shows a dry-run
 * count of exactly what will be deleted. This is the OWNER-facing factory reset,
 * distinct from the dev-only global rebuild below.
 */
function WorkspaceResetPanel({
  workspaceName,
  preview,
}: {
  workspaceName: string;
  preview:
    | {
        workspaceName: string;
        requiredConfirmation: string;
        businessCount: number;
        totals: { count: number; truncated: boolean };
        tables: Array<{ table: string; count: number; truncated: boolean }>;
      }
    | undefined;
}) {
  const resetWorkspaceData = useAction(api.workspaceReset.resetWorkspace);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const canRun = confirmation.trim() === workspaceName && workspaceName.length > 0 && !busy;
  const topTables = preview?.tables.filter((row) => row.count > 0).slice(0, 8) ?? [];

  async function runReset() {
    setBusy(true);
    setMessage("");
    try {
      const result = await resetWorkspaceData({ confirmation });
      setMessage(
        `Deleted ${result.deleted} record${result.deleted === 1 ? "" : "s"} from ${result.workspaceName}. Restarting onboarding…`,
      );
      // Land back in the guided first-run on the next render.
      window.location.assign("/dashboard");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Reset failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard tone="danger" testId="workspace-reset-panel">
      <div className="text-[13px] font-semibold text-negative">Reset this workspace to factory</div>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        Permanently deletes every business, ledger, connection, credential, and transaction in{" "}
        <span className="font-medium text-foreground">{workspaceName || "this workspace"}</span>, then
        restarts the guided setup. Other workspaces and your account are not affected. This cannot be undone.
      </p>
      {preview && preview.totals.count > 0 ? (
        <div className="mt-3 rounded-[10px] border bg-background p-3 text-[12px] text-muted-foreground" data-testid="workspace-reset-preview">
          <div>
            {preview.totals.count}
            {preview.totals.truncated ? "+" : ""} record{preview.totals.count === 1 ? "" : "s"} across{" "}
            {preview.businessCount} business{preview.businessCount === 1 ? "" : "es"} will be deleted.
          </div>
          {topTables.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {topTables.map((table) => (
                <span key={table.table} className="rounded-full border px-2 py-0.5">
                  {table.table}: {table.count}
                  {table.truncated ? "+" : ""}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <label className="mt-3 block text-[12px] font-medium">
        Type the workspace name to confirm
        <input
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          data-testid="workspace-reset-confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder={workspaceName}
        />
      </label>
      <Button
        size="sm"
        variant="outline"
        className="mt-3 border-negative/40 text-negative hover:bg-negative-surface"
        data-testid="workspace-reset-run"
        disabled={!canRun}
        onClick={runReset}
      >
        {busy ? "Deleting…" : "Delete all data & re-run onboarding"}
      </Button>
      {message ? <p className="mt-3 text-sm text-muted-foreground">{message}</p> : null}
    </SettingsCard>
  );
}

function RealTestResetPanel({
  preview,
}: {
  preview:
    | {
        enabled: boolean;
        requiredConfirmation: string;
        targetWorkspaceName: string;
        totals: { count: number; truncated: boolean };
        tables: Array<{ table: string; count: number; truncated: boolean }>;
      }
    | undefined;
}) {
  const startFullRebuild = useAction(api.realTestReset.startFullRebuild);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const topTables = preview?.tables.filter((row) => row.count > 0).slice(0, 8) ?? [];

  async function runReset() {
    setBusy(true);
    setMessage("");
    try {
      const result = await startFullRebuild({ confirmation });
      setMessage(`Reset completed. ${result.workspaceName} was recreated and owner bootstrap returned ${result.bootstrap.status}.`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Real-test reset failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard tone="danger" testId="real-test-reset-panel">
      <div className="text-[13px] font-semibold text-negative">Real-test full rebuild (dev only — ALL workspaces)</div>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        This is the DEV rebuild tool, not the per-workspace factory reset above. It deletes <span className="font-medium text-foreground">every</span> user, workspace, business, book, connector, transaction, and demo record across the whole deployment, then recreates one owner workspace named Z360. Gated behind <code>OPENBOOKS_REAL_TEST_RESET_ENABLED</code>.
      </p>
      <div className="mt-3 rounded-[10px] border bg-background p-3 text-[12px] text-muted-foreground">
        {preview ? (
          <>
            <div>
              Dry run: {preview.totals.count}
              {preview.totals.truncated ? "+" : ""} rows found across reset tables. Reset flag:{" "}
              {preview.enabled ? "enabled" : "disabled"}.
            </div>
            {topTables.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {topTables.map((table) => (
                  <span key={table.table} className="rounded-full border px-2 py-0.5">
                    {table.table}: {table.count}
                    {table.truncated ? "+" : ""}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          "Loading dry-run counts..."
        )}
      </div>
      <label className="mt-3 block text-[12px] font-medium">
        Type confirmation
        <input
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder={preview?.requiredConfirmation ?? "DELETE TEST DATA AND CREATE Z360"}
        />
      </label>
      <Button
        size="sm"
        variant="outline"
        className="mt-3 border-negative/40 text-negative hover:bg-negative-surface"
        disabled={!preview || !preview.enabled || confirmation !== preview.requiredConfirmation || busy}
        onClick={runReset}
      >
        {busy ? "Rebuilding..." : "Run full rebuild"}
      </Button>
      {message ? <p className="mt-3 text-sm text-muted-foreground">{message}</p> : null}
    </SettingsCard>
  );
}
