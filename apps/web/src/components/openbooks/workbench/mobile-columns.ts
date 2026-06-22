/**
 * E7-5 — pure mobile-card column slotting for {@link OpenBooksDataTable}. Kept
 * free of React so the slot assignment (headline / trailing / compact meta line /
 * verbose rest / hidden) can be unit-tested directly without rendering. Mirrors
 * the provenance-chip-label.ts / register-split.ts pattern.
 */

/** The subset of ColumnDef fields that drive the mobile card layout. */
export type MobileColumnMeta = {
  key: string;
  mobilePrimary?: boolean;
  mobileTrailing?: boolean;
  mobileMeta?: boolean;
  mobileHidden?: boolean;
};

export type MobileColumnSlots<C extends MobileColumnMeta> = {
  /** The bold card headline (e.g. Merchant) — first mobilePrimary, else first column. */
  primary: C | undefined;
  /** Optional trailing emphasis next to the headline (e.g. right-aligned Amount). */
  trailing: C | null;
  /** Columns folded into the single compact value-only meta line (e.g. Category + Date). */
  meta: C[];
  /** Remaining columns rendered as the verbose label/value fallback list. */
  rest: C[];
};

/**
 * Assign each column to its mobile-card slot. `mobileHidden` columns drop off the
 * card entirely (reachable via the expand strip / drawer); `mobileMeta` columns
 * join the compact meta line; everything else falls back to the verbose list so a
 * surface that opts into nothing never silently loses a field.
 */
export function assignMobileColumnSlots<C extends MobileColumnMeta>(
  columns: C[],
): MobileColumnSlots<C> {
  const primary = columns.find((c) => c.mobilePrimary) ?? columns[0];
  const trailing = columns.find((c) => c.mobileTrailing) ?? null;
  const candidates = columns.filter(
    (c) => c !== primary && c !== trailing && !c.mobileHidden,
  );
  const meta = candidates.filter((c) => c.mobileMeta);
  const rest = candidates.filter((c) => !c.mobileMeta);
  return { primary, trailing, meta, rest };
}
