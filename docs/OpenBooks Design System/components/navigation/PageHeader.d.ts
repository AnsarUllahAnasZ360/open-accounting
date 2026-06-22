/** Screen title row — 24px semibold title, muted description, right-aligned actions. */
export interface PageHeaderProps {
  title: string;
  description?: string;
  /** buttons / selects, right-aligned */
  actions?: React.ReactNode;
  style?: React.CSSProperties;
}
