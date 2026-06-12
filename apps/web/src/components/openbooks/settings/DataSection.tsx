"use client";
import Link from "next/link";

import { useQuery } from "convex/react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { DemoDataPanel } from "@/components/openbooks/DemoDataPanel";
import { LeadsPanel } from "@/components/openbooks/LeadsPanel";
import { Button } from "@/components/ui/button";
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
  const reportPack = useQuery(
    api.reportViews.reportPack,
    activeEntity.id ? { ...REPORT_ARGS, entityId: activeEntity.id as Id<"entities"> } : REPORT_ARGS,
  ) as ReportPack | undefined;

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
      <div className="flex flex-col gap-3 rounded-[14px] border bg-card p-5 shadow-xs">
        <div className="text-[13.5px] font-semibold">Your data is a file you own</div>
        <div className="text-[12.5px] text-muted-foreground">Everything exports, any time. Reports and a full JSON snapshot are one click away.</div>
        <div className="flex flex-wrap gap-2">
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
      </div>

      {/* Reset demo + import live in the existing panel; relocated here per plan. */}
      <DemoDataPanel />

      {/* Request-access leads stay under Data (E1 note). */}
      <LeadsPanel />

      <div className="rounded-[14px] border bg-card p-5 shadow-xs" style={{ boxShadow: "0 0 0 1px rgba(217,45,32,0.25), 0 1px 2px rgba(0,0,0,0.05)" }} data-testid="data-danger-zone">
        <div className="text-[13px] font-semibold text-[#b42318]">Danger zone</div>
        <div className="mt-1 text-[12.5px] text-muted-foreground">
          Archiving a business hides it from the switcher but preserves its books. Permanent deletion is intentionally not exposed here.
        </div>
        <Button asChild size="sm" variant="outline" className="mt-2.5 border-[#f1c2bd] text-[#b42318] hover:bg-[#fef3f2]">
          <Link href="/settings/businesses">Manage businesses</Link>
        </Button>
      </div>
    </div>
  );
}
