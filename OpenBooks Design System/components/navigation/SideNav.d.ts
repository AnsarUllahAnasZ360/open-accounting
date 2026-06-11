/** App shell left rail — 232px, light, green active item, logo header, optional footer items. */
export interface SideNavProps {
  /** nav entries in order; {section} entries render as uppercase group labels */
  items: Array<{ id?: string; label?: string; icon?: string; count?: number; section?: string }>;
  /** id of the active item */
  activeId?: string;
  onSelect?: (id: string) => void;
  /** path to assets/logo/openbooks-mark.png relative to the page */
  logoSrc?: string;
  /** pinned bottom entries (e.g. Settings) */
  footerItems?: Array<{ id: string; label: string; icon?: string }>;
  style?: React.CSSProperties;
}
