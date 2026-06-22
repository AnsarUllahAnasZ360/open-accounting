/** Minimal column chart — money in/out by period. Positive green, negative red. */
export interface BarChartProps {
  /** one bar per entry; color overrides the semantic default */
  data: Array<{ label: string; value: number; color?: string }>;
  /** total px height incl. labels @default 160 */
  height?: number;
  /** @default "var(--chart-1)" */
  positiveColor?: string;
  /** @default "var(--chart-5)" */
  negativeColor?: string;
  /** @default true */
  showLabels?: boolean;
  /** tooltip formatter for values */
  formatValue?: (value: number) => string;
}
