/**
 * "Ask anything about your books" bar with suggestion chips.
 */
export interface AskAIProps {
  /** @default "Ask anything about your books" */
  placeholder?: string;
  /** clickable example questions rendered as chips */
  suggestions?: string[];
  onSubmit?: (question: string) => void;
  style?: React.CSSProperties;
}
