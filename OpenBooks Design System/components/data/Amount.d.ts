/** Money figure — Geist Mono tabular numerals with optional semantic coloring. Use for every amount. */
export interface AmountProps {
  /** numeric value; negatives render with a true minus sign */
  value: number;
  /** color positive green / negative red @default false */
  colored?: boolean;
  /** show a leading + on positive values @default false */
  signed?: boolean;
  /** abbreviate thousands/millions ($128.4K) — metric cards only @default false */
  abbreviate?: boolean;
  /** @default 2 */
  decimals?: number;
  /** @default "$" */
  currency?: string;
  /** css font-size (e.g. "1.875rem" for metrics) */
  size?: string;
  /** css font-weight */
  weight?: number;
  style?: React.CSSProperties;
  className?: string;
}
