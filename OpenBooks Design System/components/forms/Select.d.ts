/** Native select styled to match Input — used for date ranges, categories, accounts. */
export interface SelectProps {
  /** option strings or {value, label} objects */
  options: Array<string | { value: string; label: string }>;
  value?: string;
  defaultValue?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  /** disabled first option shown until a choice is made */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}
