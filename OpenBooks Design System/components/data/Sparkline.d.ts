/** Tiny trend line for metric cards — 2px stroke, faint area tint. */
export interface SparklineProps {
  /** series values, oldest first (≥2 points) */
  data: number[];
  /** @default 120 */
  width?: number;
  /** @default 36 */
  height?: number;
  /** @default "var(--chart-1)" */
  color?: string;
  /** faint area under the line @default true */
  fill?: boolean;
}
