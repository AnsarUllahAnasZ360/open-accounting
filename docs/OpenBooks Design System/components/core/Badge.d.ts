/** Status pill for transaction/report states. */
export interface BadgeProps {
  /** @default "secondary" */
  variant?: "default" | "secondary" | "outline" | "destructive" | "positive" | "negative" | "warning" | "info" | "ai";
  /** optional leading lucide icon name (rendered at 12px) */
  icon?: string;
  children?: React.ReactNode;
  className?: string;
}
