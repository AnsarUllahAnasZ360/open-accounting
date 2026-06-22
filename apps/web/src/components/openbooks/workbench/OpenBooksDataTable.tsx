"use client";

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";

import { EmptyState } from "@/components/openbooks/primitives";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { assignMobileColumnSlots } from "./mobile-columns";

export type ColumnDef<Row> = {
  /** Stable key; also used as the sort key. */
  key: string;
  header: ReactNode;
  sortLabel?: string;
  align?: "left" | "right";
  /** Render money/dates/account numbers in Geist Mono + tabular figures. */
  mono?: boolean;
  width?: string;
  sortable?: boolean;
  cell: (row: Row) => ReactNode;
  /**
   * Sort value override (so cell can render rich nodes while sort stays sane).
   */
  sortValue?: (row: Row) => string | number;
  /**
   * Lower priority hides first as the viewport narrows. Columns without a
   * priority always show. Priority only affects the desktop table.
   */
  priority?: number;
  /**
   * On mobile, mark this column as the bold card headline (e.g. Merchant).
   * Affects the stacked card list only. Falls back to the first column when no
   * column declares it, so column order never silently picks the wrong headline.
   */
  mobilePrimary?: boolean;
  /**
   * On mobile, mark this column as the trailing emphasis next to the headline
   * (e.g. a right-aligned Amount), instead of demoting it to a label/value row.
   */
  mobileTrailing?: boolean;
  /**
   * E7-5: on mobile, fold this column into the single compact meta line under
   * the headline (e.g. Category + Date), rendered value-only without the verbose
   * label/value `<dt>/<dd>` row. Use for the 1–2 fields that should stay visible
   * on the card; everything else either goes to `mobileMeta` too or is hidden.
   */
  mobileMeta?: boolean;
  /**
   * E7-5: on mobile, drop this column from the card entirely (e.g. Contact /
   * Account / Status / the receipt button). The field stays reachable through the
   * row's expand strip / detail drawer — keeping the card a deliberate minimal
   * layout instead of a long label/value stack that risks overflow.
   */
  mobileHidden?: boolean;
};

export type SortState = { key: string; direction: "asc" | "desc" } | null;

/**
 * Windowed page list for numbered pagination: always the first + last page and a
 * small window around the current page, with "ellipsis" markers for the gaps
 * (e.g. 1 … 5 6 7 … 20). Page indices are 0-based.
 */
function getPaginationPages(current: number, total: number, window = 1): (number | "ellipsis")[] {
  const wanted = new Set<number>([0, total - 1]);
  for (let i = current - window; i <= current + window; i++) {
    if (i >= 0 && i < total) wanted.add(i);
  }
  const sorted = [...wanted].filter((p) => p >= 0 && p < total).sort((a, b) => a - b);
  const result: (number | "ellipsis")[] = [];
  let previous = -1;
  for (const page of sorted) {
    if (previous >= 0 && page - previous > 1) result.push("ellipsis");
    result.push(page);
    previous = page;
  }
  return result;
}

/**
 * The single dense, ledger-style table used across every data-heavy surface.
 * Generic over the row shape — columns are supplied per surface, never
 * hardcoded here. Row detail is CLOSED by default: nothing is auto-selected and
 * detail opens only on an explicit row click (which the page wires to a
 * DetailSheet). On mobile it renders the same columns as a stacked card list,
 * never a squeezed desktop table.
 */
export function OpenBooksDataTable<Row>({
  columns,
  rows,
  getRowId,
  selectable = false,
  selectedIds: selectedIdsProp,
  onSelectionChange,
  onRowClick,
  sort: sortProp,
  onSortChange,
  density = "comfortable",
  pagination = true,
  initialPageSize = 10,
  pageSizeOptions = [10, 25, 50],
  showToolbar = true,
  loading = false,
  empty,
  bulkActions,
  attention,
  rowAttributes,
  renderExpanded,
  expandedIds,
  tableContainerClassName,
  tableInnerContainerClassName,
  mobileListClassName,
  className,
}: {
  columns: ColumnDef<Row>[];
  rows: Row[];
  getRowId: (row: Row) => string;
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Opens the DetailSheet. Never inline-expands. */
  onRowClick?: (row: Row) => void;
  /**
   * Controlled sort. Omit (undefined) to keep the table's own internal sort
   * state and built-in toolbar control. Provide `sort` + `onSortChange` to drive
   * sorting from a page-level control (e.g. a SortMenu in the toolbar), usually
   * with `showToolbar={false}`. `null` is a valid controlled value (no sort).
   */
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  density?: "comfortable" | "compact";
  pagination?: boolean;
  initialPageSize?: number;
  pageSizeOptions?: number[];
  showToolbar?: boolean;
  loading?: boolean;
  empty?: ReactNode;
  /** Shown in the toolbar only while rows are selected. */
  bulkActions?: ReactNode;
  /** Per-row attention column (e.g. an AttentionState chip). */
  attention?: (row: Row) => ReactNode;
  /**
   * Stable per-row DOM attributes (data-testid / data-* hooks) spread onto both
   * the desktop table row and the mobile card. Lets a surface expose row
   * identity for deep-links and e2e without the table inventing its own schema.
   */
  rowAttributes?: (row: Row) => Record<string, string | undefined>;
  /**
   * Progressive disclosure: when a row id is in `expandedIds`, this renders an
   * inline detail strip beneath the row (desktop: a full-span second TableRow;
   * mobile: a block under the card) WITHOUT opening the DetailSheet. Returning
   * null skips the strip. Used by the register to reveal the long raw bank
   * description on demand (E7-3) so the default row stays compact.
   */
  renderExpanded?: (row: Row) => ReactNode;
  /** Ids whose inline expanded strip is currently open. */
  expandedIds?: string[];
  /** Optional scroll/container styling for surfaces that pin chrome above the rows. */
  tableContainerClassName?: string;
  /** Optional override for the shadcn Table's inner overflow wrapper. */
  tableInnerContainerClassName?: string;
  /** Optional mobile list styling for surfaces that pin chrome above the rows. */
  mobileListClassName?: string;
  className?: string;
}) {
  const [internalSort, setInternalSort] = useState<SortState>(null);
  const sort = sortProp !== undefined ? sortProp : internalSort;
  function setSort(next: SortState | ((prev: SortState) => SortState)) {
    const resolved = typeof next === "function" ? next(sort) : next;
    if (onSortChange) {
      onSortChange(resolved);
      return;
    }
    setInternalSort(resolved);
  }
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [internalSelectedIds, setInternalSelectedIds] = useState<string[]>([]);
  const selectedIds = selectedIdsProp ?? internalSelectedIds;

  function setSelectedIds(ids: string[]) {
    if (onSelectionChange) {
      onSelectionChange(ids);
      return;
    }
    setInternalSelectedIds(ids);
  }

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column) return rows;
    // A column without an explicit sortValue can only be sorted when its cell
    // renders a primitive. A rich ReactNode cell stringifies to "[object
    // Object]" for every row, which would be a silent no-op sort — so detect
    // that case and leave the rows in their original order instead.
    const read = (row: Row): string | number | null => {
      if (column.sortValue) return column.sortValue(row);
      const value = column.cell(row);
      if (value == null) return "";
      if (typeof value === "string" || typeof value === "number") return value;
      return null;
    };
    return [...rows].sort((a, b) => {
      const av = read(a);
      const bv = read(b);
      if (av === null || bv === null) return 0;
      if (av === bv) return 0;
      const result = av < bv ? -1 : 1;
      return sort.direction === "asc" ? result : -result;
    });
  }, [rows, sort, columns]);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "desc" };
      return null;
    });
    setPageIndex(0);
  }

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const clampedPageIndex = Math.min(pageIndex, pageCount - 1);
  const canPaginate = pagination && sortedRows.length > pageSize;
  const pageRows = pagination
    ? sortedRows.slice(clampedPageIndex * pageSize, clampedPageIndex * pageSize + pageSize)
    : sortedRows;
  const firstRowNumber = sortedRows.length === 0 ? 0 : clampedPageIndex * pageSize + 1;
  const lastRowNumber = Math.min(sortedRows.length, clampedPageIndex * pageSize + pageRows.length);

  const allIds = pageRows.map(getRowId);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id));
  const someSelected = allIds.some((id) => selectedIds.includes(id)) && !allSelected;

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(selectedIds.filter((id) => !allIds.includes(id)));
      return;
    }

    setSelectedIds([...new Set([...selectedIds, ...allIds])]);
  }
  function toggleRow(id: string) {
    setSelectedIds(
      selectedIds.includes(id) ? selectedIds.filter((v) => v !== id) : [...selectedIds, id],
    );
  }

  const rowPad = density === "compact" ? "py-1.5" : "py-2.5";
  const stickyHeaderCell = "sticky top-0 z-20 bg-background shadow-[0_1px_0_0_var(--border)]";
  const sortableColumns = columns.filter((column) => column.sortable || column.sortValue);
  const sortValue = sort?.key ?? "__default__";

  function sortLabel(column: ColumnDef<Row>) {
    if (column.sortLabel) return column.sortLabel;
    return typeof column.header === "string" ? column.header : column.key;
  }

  function handleSortSelect(value: string) {
    setPageIndex(0);
    if (value === "__default__") {
      setSort(null);
      return;
    }
    setSort((prev) => ({ key: value, direction: prev?.key === value ? prev.direction : "asc" }));
  }

  function toggleSortDirection() {
    setSort((prev) => {
      if (!prev) {
        const first = sortableColumns[0];
        return first ? { key: first.key, direction: "asc" } : null;
      }
      return { key: prev.key, direction: prev.direction === "asc" ? "desc" : "asc" };
    });
    setPageIndex(0);
  }

  // Mobile card layout (E7-5): a surface declares its headline via mobilePrimary
  // and an optional trailing emphasis (e.g. Amount) via mobileTrailing; otherwise
  // the first column is the headline. A small set of columns can opt into a single
  // compact meta line (`mobileMeta`, e.g. Category + Date) rendered value-only;
  // columns marked `mobileHidden` drop off the card entirely (reachable via the
  // expand strip / drawer). Anything left over falls back to the verbose
  // label/value list so no field is silently lost on surfaces that don't opt in.
  // The slotting itself is a pure, unit-tested helper.
  const {
    primary: mobilePrimaryColumn,
    trailing: mobileTrailingColumn,
    meta: mobileMetaColumns,
    rest: mobileRestColumns,
  } = useMemo(() => assignMobileColumnSlots(columns), [columns]);

  // E7-3: which rows have their inline detail strip open. Total desktop column
  // count (incl. the optional selection + attention columns) so the strip's
  // single full-span cell aligns under the whole row.
  const expandedSet = useMemo(() => new Set(expandedIds ?? []), [expandedIds]);
  const desktopColSpan = columns.length + (selectable ? 1 : 0) + (attention ? 1 : 0);

  if (loading) {
    return (
      <div className={cn("rounded-[14px] ring-1 ring-foreground/10 shadow-xs", className)}>
        <div className="flex flex-col gap-3 p-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3">
              {selectable ? <Skeleton className="size-4 rounded" /> : null}
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={cn(className)}>
        {empty ?? <EmptyState title="Nothing here yet" description="Items will show up here as they arrive." />}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {showToolbar ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="money-figures">
              {sortedRows.length === 0
                ? "0 rows"
                : `${firstRowNumber}-${lastRowNumber} of ${sortedRows.length} rows`}
            </span>
            {selectedIds.length > 0 ? (
              <span className="money-figures">{selectedIds.length} selected</span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {sortableColumns.length > 0 ? (
              <>
                <Select value={sortValue} onValueChange={handleSortSelect}>
                  <SelectTrigger size="sm" className="w-[150px]" aria-label="Sort rows">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectGroup>
                      <SelectItem value="__default__">Default order</SelectItem>
                      {sortableColumns.map((column) => (
                        <SelectItem key={column.key} value={column.key}>
                          {sortLabel(column)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleSortDirection}
                  disabled={sortableColumns.length === 0}
                >
                  {sort?.direction === "desc" ? (
                    <ArrowDown data-icon="inline-start" />
                  ) : (
                    <ArrowUp data-icon="inline-start" />
                  )}
                  {sort?.direction === "desc" ? "Descending" : "Ascending"}
                </Button>
              </>
            ) : null}
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                setPageSize(Number(value));
                setPageIndex(0);
              }}
            >
              <SelectTrigger size="sm" className="w-[112px]" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectGroup>
                  {pageSizeOptions.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size} rows
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}

      {selectable && selectedIds.length > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-[14px] bg-muted px-3 py-2">
          <span className="money-figures text-sm font-medium">{selectedIds.length} selected</span>
          <div className="flex items-center gap-2">{bulkActions}</div>
        </div>
      ) : null}

      {/* Desktop: dense ledger table. It keeps a bottom horizontal scrollbar for
          wide operational views while each surface owns sensible column widths. */}
      <div
        className={cn(
          "hidden overflow-x-auto overflow-y-auto rounded-[14px] ring-1 ring-foreground/10 shadow-xs md:block",
          tableContainerClassName,
        )}
      >
        <Table className="min-w-[960px] table-auto" containerClassName={cn("overflow-x-auto", tableInnerContainerClassName)}>
          <TableHeader className="bg-background">
            <TableRow>
              {selectable ? (
                <TableHead className={cn(stickyHeaderCell, "w-10")}>
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={toggleAll}
                    aria-label="Select all rows"
                  />
                </TableHead>
              ) : null}
              {columns.map((column) => {
                const isSorted = sort?.key === column.key;
                const SortIcon = !isSorted
                  ? ChevronsUpDown
                  : sort?.direction === "asc"
                    ? ArrowUp
                    : ArrowDown;
                return (
                  <TableHead
                    key={column.key}
                    style={column.width ? { width: column.width } : undefined}
                    className={cn(
                      stickyHeaderCell,
                      column.align === "right" && "text-right",
                      column.priority === 1 && "hidden lg:table-cell",
                      column.priority === 2 && "hidden xl:table-cell",
                    )}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={cn(
                          "inline-flex items-center gap-1 font-medium outline-none hover:text-foreground focus-visible:text-foreground",
                          column.align === "right" && "flex-row-reverse",
                        )}
                      >
                        {column.header}
                        <SortIcon className="size-3.5 text-muted-foreground" />
                      </button>
                    ) : (
                      column.header
                    )}
                  </TableHead>
                );
              })}
              {attention ? <TableHead className={cn(stickyHeaderCell, "w-px whitespace-nowrap text-right")} /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((row) => {
              const id = getRowId(row);
              const selected = selectedIds.includes(id);
              const expandedContent =
                renderExpanded && expandedSet.has(id) ? renderExpanded(row) : null;
              return (
                <Fragment key={id}>
                  <TableRow
                    {...rowAttributes?.(row)}
                    data-state={selected ? "selected" : undefined}
                    className={cn(onRowClick && "cursor-pointer", expandedContent && "border-b-0")}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {selectable ? (
                      <TableCell className={rowPad} onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={selected}
                          onCheckedChange={() => toggleRow(id)}
                          aria-label="Select row"
                        />
                      </TableCell>
                    ) : null}
                    {columns.map((column) => (
                      <TableCell
                        key={column.key}
                        className={cn(
                          rowPad,
                          "min-w-0",
                          column.align === "right" && "text-right",
                          column.mono && "money-figures",
                          column.priority === 1 && "hidden lg:table-cell",
                          column.priority === 2 && "hidden xl:table-cell",
                        )}
                      >
                        {column.cell(row)}
                      </TableCell>
                    ))}
                    {attention ? (
                      <TableCell
                        className={cn(rowPad, "w-px whitespace-nowrap text-right")}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <span className="inline-flex items-center justify-end gap-1">{attention(row)}</span>
                      </TableCell>
                    ) : null}
                  </TableRow>
                  {expandedContent ? (
                    <TableRow
                      data-testid="row-expanded"
                      className="hover:bg-transparent"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <TableCell colSpan={desktopColSpan} className="bg-muted/30 py-3">
                        {expandedContent}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: stacked card list of the same columns — never a squeezed table. */}
      <div className={cn("flex flex-col gap-2 md:hidden", mobileListClassName)}>
        {pageRows.map((row) => {
          const id = getRowId(row);
          const selected = selectedIds.includes(id);
          const mobileAttributes = rowAttributes?.(row);
          if (mobileAttributes?.["data-testid"]) {
            mobileAttributes["data-testid"] = `${mobileAttributes["data-testid"]}-card`;
          }
          return (
            <div
              key={id}
              {...mobileAttributes}
              role={onRowClick ? "button" : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                "rounded-[14px] bg-card p-3 ring-1 ring-foreground/10 shadow-xs outline-none",
                onRowClick && "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50",
                selected && "ring-primary/40",
              )}
            >
              <div className="flex items-start gap-3">
                {selectable ? (
                  <span onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => toggleRow(id)}
                      aria-label="Select row"
                    />
                  </span>
                ) : null}
                <div
                  className={cn(
                    "min-w-0 flex-1 truncate font-medium",
                    mobilePrimaryColumn?.mono && "money-figures",
                  )}
                >
                  {mobilePrimaryColumn?.cell(row)}
                </div>
                {mobileTrailingColumn ? (
                  <div
                    className={cn(
                      "shrink-0 text-right font-medium",
                      mobileTrailingColumn.mono && "money-figures",
                    )}
                  >
                    {mobileTrailingColumn.cell(row)}
                  </div>
                ) : null}
                {attention ? (
                  <span className="shrink-0" onClick={(event) => event.stopPropagation()}>
                    {attention(row)}
                  </span>
                ) : null}
              </div>
              {mobileMetaColumns.length > 0 ? (
                // E7-5: one compact meta line (value-only) for the few fields that
                // stay on the card — e.g. the inline category control + the date —
                // sized as a touch target, never a long label/value stack.
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  {mobileMetaColumns.map((column) => (
                    <span
                      key={column.key}
                      className={cn("min-w-0 max-w-full truncate", column.mono && "money-figures")}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {column.cell(row)}
                    </span>
                  ))}
                </div>
              ) : null}
              {mobileRestColumns.length > 0 ? (
                <dl className="mt-2 flex flex-col gap-1">
                  {mobileRestColumns.map((column) => (
                    <div key={column.key} className="flex items-center justify-between gap-3 text-sm">
                      <dt className="shrink-0 text-muted-foreground">{column.header}</dt>
                      <dd className={cn("min-w-0 truncate text-right", column.mono && "money-figures")}>
                        {column.cell(row)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {renderExpanded && expandedSet.has(id) ? (
                <div
                  data-testid="row-expanded"
                  className="mt-2 rounded-[10px] bg-muted/40 p-2"
                  onClick={(event) => event.stopPropagation()}
                >
                  {renderExpanded(row)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {canPaginate || (pagination && !showToolbar) ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="money-figures">
              {firstRowNumber}-{lastRowNumber} of {sortedRows.length}
            </span>
            {!showToolbar ? (
              <span className="flex items-center gap-1.5">
                <span>Rows</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(value) => {
                    setPageSize(Number(value));
                    setPageIndex(0);
                  }}
                >
                  <SelectTrigger size="sm" className="h-7 w-[78px]" aria-label="Rows per page">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectGroup>
                      {pageSizeOptions.map((size) => (
                        <SelectItem key={size} value={String(size)}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </span>
            ) : null}
          </div>
          {canPaginate ? (
            <Pagination className="mx-0 w-auto justify-start sm:justify-end">
              <PaginationContent>
                <PaginationItem>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Previous page"
                    onClick={() => setPageIndex(Math.max(0, clampedPageIndex - 1))}
                    disabled={clampedPageIndex === 0}
                  >
                    <ChevronLeft />
                  </Button>
                </PaginationItem>
                {getPaginationPages(clampedPageIndex, pageCount).map((page, index) =>
                  page === "ellipsis" ? (
                    <PaginationItem key={`ellipsis-${index}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={page}>
                      <PaginationLink
                        isActive={page === clampedPageIndex}
                        onClick={() => setPageIndex(page)}
                        className="money-figures cursor-pointer"
                      >
                        {page + 1}
                      </PaginationLink>
                    </PaginationItem>
                  ),
                )}
                <PaginationItem>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Next page"
                    onClick={() => setPageIndex(Math.min(pageCount - 1, clampedPageIndex + 1))}
                    disabled={clampedPageIndex >= pageCount - 1}
                  >
                    <ChevronRight />
                  </Button>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
