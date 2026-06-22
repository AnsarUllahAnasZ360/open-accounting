"use client";

import { ChevronDown, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ExportFormat = "csv" | "pdf" | "xlsx";

const FORMAT_LABEL: Record<ExportFormat, string> = {
  csv: "Export CSV",
  pdf: "Export PDF",
  xlsx: "Export Excel",
};

/**
 * The consistent Export affordance for any table or report. Icon-only on
 * mobile, label + chevron on desktop, and it confirms with a toast when the
 * file is ready instead of leaving an inline result string behind.
 */
export function ExportMenu({
  formats,
  onExport,
  filename,
  disabled,
}: {
  formats: ExportFormat[];
  onExport: (format: ExportFormat) => void | Promise<void>;
  filename?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function handleExport(format: ExportFormat) {
    setBusy(true);
    try {
      await onExport(format);
      const name = filename ? `${filename}.${format}` : `${format.toUpperCase()} file`;
      toast.success(`Exported ${name}.`);
    } catch {
      toast.error("Export failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || busy}>
          <Download data-icon="inline-start" />
          <span className="hidden md:inline">Export</span>
          <ChevronDown data-icon="inline-end" className="hidden md:inline" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          {formats.map((format) => (
            <DropdownMenuItem key={format} onClick={() => void handleExport(format)}>
              <Download />
              {FORMAT_LABEL[format]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
