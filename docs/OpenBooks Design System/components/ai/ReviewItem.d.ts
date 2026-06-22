/** One Inbox entry — AI's question about an uncertain transaction with category choices. */
export interface ReviewItemProps {
  /** vendor / payer name */
  counterparty: string;
  /** short date, e.g. "Jun 5" */
  date: string;
  /** transaction amount (negative = money out) */
  amount: number;
  /** source account label, e.g. "Mercury Checking" */
  account?: string;
  /** the AI's first-person uncertainty, e.g. "I wasn't sure if this Wise transfer is contractor labor or a reimbursement." */
  question: string;
  /** category choices offered */
  options: string[];
  onChoose?: (option: string) => void;
  onSkip?: () => void;
  style?: React.CSSProperties;
}
