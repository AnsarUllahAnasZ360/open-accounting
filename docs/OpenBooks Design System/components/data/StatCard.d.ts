/**
 * Dashboard metric card — label, big figure, detail line, trend badge.
 */
export interface StatCardProps {
  /** muted metric label, e.g. "Cash balance" */
  label: string;
  /** the figure — string or an <Amount abbreviate> element */
  value: React.ReactNode;
  /** small muted context line under the value */
  detail?: string;
  /** lucide icon name shown top-right */
  icon?: string;
  /** trend badge text, e.g. "+18%" */
  trend?: string;
  /** badge variant for the trend @default "outline" */
  trendVariant?: "default" | "secondary" | "outline" | "positive" | "negative" | "warning" | "info" | "ai";
  children?: React.ReactNode;
}
