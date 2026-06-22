"use client";

// Shared Settings layout primitives (Epic E12-T1). Every settings section
// renders inside one consistent, on-brand, responsive frame so spacing,
// headings, save affordances, entity pickers, and empty states match across
// all 11 sections instead of each *Section.tsx re-implementing them ad hoc.
//
// Vocabulary captured here (previously copy-pasted per section):
//   - the rounded-[14px] border bg-card shadow-xs card surface
//   - the Save / Saving… / Saved / error save-bar from TaxSection
//   - the multi-business <Select> from TaxSection:93-109 + AuditSection
//   - a page header (title + one-line description) and an empty state

import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * The vertical-rhythm wrapper every section content lives in. Owns the
 * consistent `gap-4` spacing between cards and the optional section header
 * (title + one-line description) so sections stop rendering a bare <p>.
 */
export function SettingsSectionShell({
  title,
  description,
  testId,
  children,
  className,
}: {
  /** Optional section heading (the SETTINGS_SECTIONS label). */
  title?: ReactNode;
  /** Optional one-line description (SECTION_DESCRIPTIONS[id]). */
  description?: ReactNode;
  testId?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4", className)} data-testid={testId}>
      {title || description ? (
        <header className="flex flex-col gap-1">
          {title ? (
            <h2 className="text-[18px] font-semibold tracking-tight">{title}</h2>
          ) : null}
          {description ? (
            <p className="text-[13px] text-muted-foreground">{description}</p>
          ) : null}
        </header>
      ) : null}
      {children}
    </div>
  );
}

/**
 * The standard rounded card surface used across every section. Defaults to the
 * `p-5` padded body; pass `padded={false}` for cards that own their own internal
 * padding (e.g. the notifications grouped list with header rows).
 */
export function SettingsCard({
  children,
  className,
  padded = true,
  testId,
  tone = "default",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  testId?: string;
  /** `danger` swaps the border to the negative tone for danger-zone cards. */
  tone?: "default" | "danger";
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "rounded-[14px] border bg-card shadow-xs",
        tone === "danger" && "border-negative/25",
        padded && "p-5",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Optional title row for a card body, matching the per-section section titles. */
export function SettingsCardTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("text-[13.5px] font-semibold", className)}>{children}</div>;
}

/**
 * The Save / Saving… / Saved / error row mirroring TaxSection's save UX. Sticky
 * on mobile so the save action stays reachable on long forms, static on desktop.
 */
export function SettingsSaveBar({
  onSave,
  busy,
  saved,
  error,
  saveLabel = "Save changes",
  busyLabel = "Saving…",
  disabled,
  testId = "settings-save",
  children,
}: {
  onSave: () => void;
  busy?: boolean;
  saved?: boolean;
  error?: string;
  saveLabel?: string;
  busyLabel?: string;
  disabled?: boolean;
  testId?: string;
  /** Extra controls rendered before the save button (left of it). */
  children?: ReactNode;
}) {
  return (
    // E12-T9: on mobile this floats above the fixed bottom nav (h-16) so the save
    // button is never covered; z-40 keeps it over the z-30 nav. From sm up it
    // becomes a normal inline row.
    <div
      data-testid={`${testId}-bar`}
      className="sticky bottom-16 z-40 -mx-1 flex flex-wrap items-center gap-3 rounded-[10px] border bg-background/90 px-3 py-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:static sm:bottom-0 sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:shadow-none sm:backdrop-blur-none"
    >
      {children}
      <Button data-testid={testId} size="sm" disabled={busy || disabled} onClick={onSave}>
        {busy ? busyLabel : saveLabel}
      </Button>
      {saved ? (
        <span
          className="inline-flex items-center gap-1 text-[12.5px] text-primary"
          data-testid={`${testId}d`}
        >
          <Check className="size-3.5" /> Saved
        </span>
      ) : null}
      {error ? <span className="text-[12.5px] text-destructive">{error}</span> : null}
    </div>
  );
}

/** A quiet empty state used when a section has nothing to show yet. */
export function SettingsEmptyState({
  title,
  description,
  action,
  testId,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <SettingsCard
      testId={testId}
      className={cn("flex flex-col items-start gap-1.5 text-sm", className)}
    >
      <div className="text-[13.5px] font-semibold">{title}</div>
      {description ? (
        <div className="text-[12.5px] text-muted-foreground">{description}</div>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </SettingsCard>
  );
}

/**
 * The multi-business <Select> previously re-implemented in TaxSection:93-109 and
 * AuditSection. Renders nothing when there is only one business (no need to
 * pick), so callers can always render it unconditionally.
 */
export function SettingsEntityPicker({
  rows,
  value,
  onChange,
  label = "Business",
  testId = "settings-entity-picker",
  alwaysShow = false,
}: {
  rows: ReadonlyArray<{ id: string; name: string }>;
  value: string;
  onChange: (id: string) => void;
  label?: string;
  testId?: string;
  /** Force-render even with a single business (e.g. for a stable test target). */
  alwaysShow?: boolean;
}) {
  if (rows.length <= 1 && !alwaysShow) return null;
  return (
    <div className="flex items-center gap-2">
      <Label className="text-[12px] text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger data-testid={testId} className="h-9 w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {rows.map((row) => (
              <SelectItem key={row.id} value={row.id}>
                {row.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
