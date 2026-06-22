/** Text input, 32px tall. Optional leading lucide icon (use "search" for search fields). */
export interface InputProps {
  /** leading lucide icon name */
  icon?: string;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}
