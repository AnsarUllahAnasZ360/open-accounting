/** Dashed empty well — for cleared inboxes, unconnected accounts, empty reports. */
export interface EmptyStateProps {
  /** lucide icon name @default "inbox" */
  icon?: string;
  title?: string;
  description?: string;
  /** optional action button */
  action?: React.ReactNode;
}
