/** Toggle switch — green when on. For rules, auto-categorization, account sync settings. */
export interface SwitchProps {
  /** controlled state */
  checked?: boolean;
  /** @default false */
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** @default "default" */
  size?: "default" | "sm";
  disabled?: boolean;
  className?: string;
}
