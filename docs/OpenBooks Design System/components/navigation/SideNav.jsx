import React from "react";
import { Icon } from "../core/Icon.jsx";

/* OpenBooks SideNav — the app shell's fixed left rail (232px, light, green active state).
   Logo mark: assets/logo/openbooks-mark.png (pass logoSrc with the correct relative path). */

const sideNavCss = `
.obds-sidenav {
  display: flex; flex-direction: column; flex-shrink: 0;
  width: var(--sidebar-width); height: 100%;
  background: var(--sidebar); border-right: 1px solid var(--sidebar-border);
  font-family: var(--font-sans);
}
.obds-sidenav__brand {
  display: flex; align-items: center; gap: 10px;
  padding: 16px 16px 12px;
}
.obds-sidenav__brand img { width: 28px; height: 28px; border-radius: var(--radius-full); }
.obds-sidenav__wordmark {
  font-size: var(--text-base); font-weight: var(--weight-semibold);
  color: var(--foreground); letter-spacing: -0.01em;
}
.obds-sidenav__items { display: flex; flex-direction: column; gap: 2px; padding: 8px; flex: 1; overflow-y: auto; }
.obds-sidenav__section {
  padding: 14px 8px 4px; font-size: 11px; font-weight: var(--weight-medium);
  letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted);
}
.obds-sidenav__item {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 8px; border: none; border-radius: var(--radius-md);
  background: transparent; cursor: pointer; text-align: left; width: 100%;
  font-size: var(--text-sm); font-weight: var(--weight-medium);
  color: var(--sidebar-foreground);
  transition: background-color 120ms ease-out, color 120ms ease-out;
}
.obds-sidenav__item:hover { background: color-mix(in oklab, var(--muted) 70%, transparent); color: var(--foreground); }
.obds-sidenav__item[data-active="true"] {
  background: var(--sidebar-accent); color: var(--sidebar-accent-foreground);
}
.obds-sidenav__item-label { flex: 1; }
.obds-sidenav__count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: var(--radius-full); background: var(--primary);
  color: var(--primary-foreground); font-size: 11px; font-weight: var(--weight-semibold);
}
.obds-sidenav__footer { padding: 8px; border-top: 1px solid var(--sidebar-border); }
`;

if (typeof document !== "undefined" && !document.getElementById("obds-sidenav-css")) {
  const s = document.createElement("style");
  s.id = "obds-sidenav-css";
  s.textContent = sideNavCss;
  document.head.appendChild(s);
}

export function SideNav({ items = [], activeId, onSelect, logoSrc, footerItems = [], style }) {
  const renderItem = (item) => {
    if (item.section) {
      return <div key={`s-${item.section}`} className="obds-sidenav__section">{item.section}</div>;
    }
    return (
      <button
        key={item.id}
        type="button"
        className="obds-sidenav__item"
        data-active={item.id === activeId ? "true" : "false"}
        onClick={() => onSelect && onSelect(item.id)}
      >
        {item.icon ? <Icon name={item.icon} size={18} strokeWidth={1.75} /> : null}
        <span className="obds-sidenav__item-label">{item.label}</span>
        {item.count ? <span className="obds-sidenav__count">{item.count}</span> : null}
      </button>
    );
  };

  return (
    <nav className="obds-sidenav" style={style}>
      <div className="obds-sidenav__brand">
        {logoSrc ? <img src={logoSrc} alt="OpenBooks" /> : null}
        <span className="obds-sidenav__wordmark">open books</span>
      </div>
      <div className="obds-sidenav__items">{items.map(renderItem)}</div>
      {footerItems.length ? (
        <div className="obds-sidenav__footer">{footerItems.map(renderItem)}</div>
      ) : null}
    </nav>
  );
}
