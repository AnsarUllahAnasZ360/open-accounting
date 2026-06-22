/** Renders a lucide icon by kebab-case name (e.g. "landmark", "sparkles"), inheriting currentColor. */
export interface IconProps {
  /** lucide icon name, kebab-case — see assets/icons/ for the available set */
  name: string;
  /** square size in px @default 16 */
  size?: number;
  /** stroke width @default 2 */
  strokeWidth?: number;
  /** stroke color @default "currentColor" */
  color?: string;
  style?: React.CSSProperties;
  className?: string;
}
