import type { ReactNode } from "react";

import type { DetailTab } from "./DetailSheet";
import type { FilterFacetSpec } from "./FilterPanelButton";
import type { GroupByKey } from "./GroupByMenu";
import type { ColumnDef, SortState } from "./OpenBooksDataTable";
import type { ActionItem } from "./PageActionBar";

/**
 * The shared-chrome contract (Epic E0.1). One `WorkbenchConfig` per operational
 * section drives the SAME page shell so every section is structurally identical:
 * the driver renders the header, a toolbar built FROM this config (facets /
 * group / sort / display / actions), the fixed/scroll table shell, and the
 * DetailSheet. Each
 * section only supplies its own data, column defs, and detail render.
 *
 * This stage (E0 stage A) defines the contract; Transactions is migrated onto it
 * in a later stage. It deliberately reuses the existing primitive types
 * (ColumnDef, FilterFacetSpec, GroupByKey, ActionItem, SortState, DetailTab) so
 * no primitive is rebuilt.
 */

/** An ordered sub-tab under a section title. `kind` selects the driver branch. */
export type SubtabKind = "cash-movement" | "ledger" | "insights";

export type WorkbenchSubtab = {
  /** URL slug; the cash-movement default slug equals the section slug's screen. */
  id: string;
  label: string;
  /** Quiet subtitle that disambiguates AR/AP from cash (e.g. "Money received"). */
  subtitle?: string;
  kind: SubtabKind;
};

/** A primary (page-level) action, e.g. "New invoice" or the Add menu trigger. */
export type WorkbenchPrimaryAction = ActionItem & {
  /** Solid primary button vs. an outline/secondary action. */
  variant?: "primary" | "secondary";
  testId?: string;
};

/** A bulk action available when rows are selected. */
export type WorkbenchBulkAction = {
  label: string;
  onRun: (selectedIds: string[]) => void | Promise<void>;
  destructive?: boolean;
  disabled?: boolean;
};

/** A sortable column declaration surfaced in the SortMenu. */
export type WorkbenchSortableColumn = {
  key: string;
  label: string;
};

/**
 * The full shared-chrome description for one section. `Row` is the section's
 * table row shape. The driver is generic over it.
 */
export type WorkbenchConfig<Row = unknown> = {
  /** Stable section id (matches the top-level nav slug, e.g. "transactions"). */
  section: string;
  /** Page title shown in the header. */
  title: string;
  /** Optional one-line description under the title. */
  description?: string;
  /** Ordered sub-tabs: [cash-movement -> AR/AP -> Insights]. */
  subtabs: ReadonlyArray<WorkbenchSubtab>;

  /** Column definitions for the cash-movement table. */
  columns: ReadonlyArray<ColumnDef<Row>>;
  /** Keys of the columns shown by default (others toggle on via Display). */
  defaultVisibleColumns: ReadonlyArray<string>;

  /** Filter facets surfaced in the FilterPanelButton. */
  filterFacets: ReadonlyArray<FilterFacetSpec>;
  /** Group-by options offered in the GroupByMenu. */
  groupByOptions: ReadonlyArray<GroupByKey>;
  /** Columns offered in the SortMenu. */
  sortableColumns: ReadonlyArray<WorkbenchSortableColumn>;
  /** Default sort applied on first load. */
  defaultSort?: SortState;

  /** Page-level actions (New …, Import, Export). */
  primaryActions: ReadonlyArray<WorkbenchPrimaryAction>;
  /** Actions available on a multi-row selection. */
  bulkActions: ReadonlyArray<WorkbenchBulkAction>;

  /** Maps a row to the DetailSheet tabs the driver renders on row click. */
  rowToDetail: (row: Row) => { title: string; tabs: ReadonlyArray<DetailTab> } | null;

  /** The Insights panel (E1 kit / SectionInsights) for the section's Insights sub-tab. */
  insights?: ReactNode;
};
