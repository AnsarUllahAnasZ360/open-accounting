/**
 * Primary action control, ported from the codebase's shadcn button.
 */
export interface ButtonProps {
  /** @default "default" */
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
  /** @default "default" */
  size?: "default" | "sm" | "lg" | "icon" | "icon-sm";
  /** leading lucide icon name */
  icon?: string;
  /** trailing lucide icon name */
  iconEnd?: string;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
  className?: string;
}
