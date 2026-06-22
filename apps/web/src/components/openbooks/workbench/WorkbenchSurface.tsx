"use client";

import type { ReactNode } from "react";

import type { ActiveChip } from "./FilterBar";
import { OpenBooksDataTable, type ColumnDef, type SortState } from "./OpenBooksDataTable";
import { SavedViews, type SavedViewSummary } from "./SavedViews";
import type { WorkbenchConfig } from "./workbench-config";
import { WorkbenchToolbar } from "./WorkbenchToolbar";

/**
 * The shared config-driven driver (Epic E0.1/E0.2). One `WorkbenchSurface`
 * renders the SAME chrome for every operational section's cash-movement tab so
 * each section is structurally identical: a status banner → the WorkbenchToolbar
 * (saved views + filter pills + the group/sort/display/add cluster) → the
 * fixed/scroll table shell → the section's DetailSheet/dialog overlays.
 *
 * The driver owns LAYOUT only — never section state. Every interactive piece is
 * supplied by the consuming section as a slot (the screen keeps ownership of its
 * filter state, mutations, and detail render), exactly as the E0 contract
 * specifies: "each section supplies its own data + column defs + detail render".
 *
 * Transactions is the reference consumer; this is a faithful extraction of the
 * fixed/scroll shell that previously lived inline in `TransactionsScreen`, so the
 * migration is a zero-behavior-change parity move.
 */

export type WorkbenchTableGroup<Row> = {
  label: string;
  rows: Row[];
  /** Right-aligned summary node (e.g. "12 · $1,240.00"). */
  summary?: ReactNode;
};

export function WorkbenchSurface<Row>({
  config,
  testId,
  // Status banner (above the toolbar).
  banner,
  // Toolbar slots.
  savedViews,
  pills,
  trailing,
  chips,
  onRemoveChip,
  onClearAll,
  // Table data + rendering.
  columns,
  rows,
  groups,
  getRowId,
  onRowClick,
  selectable = false,
  selectedIds,
  onSelectionChange,
  bulkActions,
  density = "comfortable",
  sort,
  onSortChange,
  rowAttributes,
  renderExpanded,
  expandedIds,
  attention,
  empty,
  emptyGroups,
  // Overlays (DetailSheet, dialogs) rendered after the table region.
  overlays,
}: {
  /**
   * The section's config — the contract the chrome is built FROM. The driver
   * derives its `data-testid` from `config.section` (falling back to `testId`)
   * and treats `config.columns` as the canonical column set; the live `columns`
   * prop below is the display-toggle-filtered view of it that the screen owns.
   */
  config?: WorkbenchConfig<Row>;
  testId?: string;
  banner?: ReactNode;
  savedViews?: SavedViewSummaryProps;
  /** @deprecated Page-local search was removed; use the app command search. */
  search?: string;
  /** @deprecated Page-local search was removed; use the app command search. */
  onSearch?: (next: string) => void;
  /** @deprecated Page-local search was removed; use the app command search. */
  searchPlaceholder?: string;
  pills?: ReactNode;
  trailing?: ReactNode;
  chips?: ActiveChip[];
  onRemoveChip?: (key: string) => void;
  onClearAll?: () => void;
  columns: ColumnDef<Row>[];
  rows: Row[];
  /** When set, renders a stacked group view instead of the flat table. */
  groups?: WorkbenchTableGroup<Row>[] | null;
  getRowId: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  bulkActions?: ReactNode;
  density?: "comfortable" | "compact";
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  rowAttributes?: (row: Row) => Record<string, string | undefined>;
  /** E7-3: inline progressive-disclosure strip per row (the register's raw description). */
  renderExpanded?: (row: Row) => ReactNode;
  /** Ids whose inline expanded strip is currently open. */
  expandedIds?: string[];
  attention?: (row: Row) => ReactNode;
  empty?: ReactNode;
  emptyGroups?: ReactNode;
  overlays?: ReactNode;
}) {
  const surfaceTestId = testId ?? (config ? `${config.section}-screen` : undefined);
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden" data-testid={surfaceTestId}>
      {banner}

      <div className="shrink-0">
        <WorkbenchToolbar
          views={
            savedViews ? (
              <SavedViews
                views={savedViews.views}
                activeViewId={savedViews.activeViewId}
                dirty={savedViews.dirty}
                onSelect={savedViews.onSelect}
                onCreate={savedViews.onCreate}
                onUpdate={savedViews.onUpdate}
                onDelete={savedViews.onDelete}
                allLabel={savedViews.allLabel}
              />
            ) : undefined
          }
          chips={chips}
          onRemoveChip={onRemoveChip}
          onClearAll={onClearAll}
          pills={pills}
          trailing={trailing}
        />
      </div>

      {groups ? (
        groups.length === 0 ? (
          emptyGroups
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="flex flex-col gap-5">
              {groups.map((group) => (
                <div key={group.label} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2 px-1">
                    <span className="text-sm font-medium">{group.label}</span>
                    {group.summary ? (
                      <span className="money-figures text-xs text-muted-foreground">{group.summary}</span>
                    ) : null}
                  </div>
                  <OpenBooksDataTable
                    columns={columns}
                    rows={group.rows}
                    getRowId={getRowId}
                    onRowClick={onRowClick}
                    showToolbar={false}
                    pagination={false}
                    density={density}
                    sort={sort}
                    onSortChange={onSortChange}
                    rowAttributes={rowAttributes}
                    renderExpanded={renderExpanded}
                    expandedIds={expandedIds}
                    attention={attention}
                  />
                </div>
              ))}
            </div>
          </div>
        )
      ) : (
        <OpenBooksDataTable
          className="min-h-0 flex-1"
          columns={columns}
          rows={rows}
          getRowId={getRowId}
          selectable={selectable}
          selectedIds={selectedIds}
          onSelectionChange={onSelectionChange}
          onRowClick={onRowClick}
          bulkActions={bulkActions}
          showToolbar={false}
          initialPageSize={25}
          density={density}
          sort={sort}
          onSortChange={onSortChange}
          tableContainerClassName="min-h-0 flex-1 overflow-auto border border-border bg-card ring-foreground/5"
          tableInnerContainerClassName="overflow-x-auto"
          mobileListClassName="min-h-0 flex-1 overflow-y-auto pr-1"
          rowAttributes={rowAttributes}
          renderExpanded={renderExpanded}
          expandedIds={expandedIds}
          attention={attention}
          empty={empty}
        />
      )}

      {overlays}
    </div>
  );
}

type SavedViewSummaryProps = {
  views: SavedViewSummary[];
  activeViewId: string | null;
  dirty: boolean;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => void;
  onUpdate: (id: string) => void;
  onDelete: (id: string) => void;
  /** Section-correct "All …" label for the saved-views trigger (E5.3). */
  allLabel?: string;
};
