import React from "react";
import { Icon } from "./Icon.jsx";

/* OpenBooks Badge — pill, h-20px, from the codebase's shadcn badge.tsx,
   extended with money/AI status variants used across the product. */

const badgeCss = `
.obds-badge {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  height: 20px; width: fit-content; padding: 0 8px; flex-shrink: 0;
  border: 1px solid transparent; border-radius: var(--radius-full);
  font-family: var(--font-sans); font-size: var(--text-xs); font-weight: var(--weight-medium);
  white-space: nowrap; line-height: 1;
}
.obds-badge--default { background: var(--primary); color: var(--primary-foreground); }
.obds-badge--secondary { background: var(--secondary); color: var(--secondary-foreground); }
.obds-badge--outline { background: transparent; color: var(--foreground); border-color: var(--border); }
.obds-badge--destructive { background: color-mix(in oklab, var(--destructive) 10%, transparent); color: var(--destructive); }
.obds-badge--positive { background: var(--positive-surface); color: var(--positive); }
.obds-badge--negative { background: var(--negative-surface); color: var(--negative); }
.obds-badge--warning { background: var(--warning-surface); color: var(--warning); }
.obds-badge--info { background: var(--info-surface); color: var(--info); }
.obds-badge--ai { background: var(--ai-surface); color: var(--ai); }
`;

if (typeof document !== "undefined" && !document.getElementById("obds-badge-css")) {
  const s = document.createElement("style");
  s.id = "obds-badge-css";
  s.textContent = badgeCss;
  document.head.appendChild(s);
}

export function Badge({ variant = "secondary", icon, children, className = "", ...rest }) {
  return (
    <span className={`obds-badge obds-badge--${variant} ${className}`} {...rest}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}
