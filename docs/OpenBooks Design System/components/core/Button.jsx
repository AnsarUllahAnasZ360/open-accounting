import React from "react";
import { Icon } from "./Icon.jsx";

/* OpenBooks Button — port of the codebase's shadcn button.tsx (variants + sizes preserved). */

const buttonCss = `
.obds-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  flex-shrink: 0; white-space: nowrap; user-select: none; cursor: pointer;
  border: 1px solid transparent; border-radius: var(--radius-control);
  font-family: var(--font-sans); font-size: var(--text-sm); font-weight: var(--weight-medium);
  line-height: 1; outline: none;
  transition: background-color 120ms ease-out, color 120ms ease-out, border-color 120ms ease-out, transform 80ms ease-out;
}
.obds-btn:active:not(:disabled) { transform: translateY(1px); }
.obds-btn:focus-visible { border-color: var(--ring); box-shadow: var(--ring-shadow); }
.obds-btn:disabled { pointer-events: none; opacity: 0.5; }

.obds-btn--default { background: var(--primary); color: var(--primary-foreground); }
.obds-btn--default:hover { background: color-mix(in oklab, var(--primary) 80%, var(--background)); }
.obds-btn--outline { background: var(--background); color: var(--foreground); border-color: var(--border); }
.obds-btn--outline:hover { background: var(--muted); }
.obds-btn--secondary { background: var(--secondary); color: var(--secondary-foreground); }
.obds-btn--secondary:hover { background: color-mix(in oklch, var(--secondary), var(--foreground) 5%); }
.obds-btn--ghost { background: transparent; color: var(--foreground); }
.obds-btn--ghost:hover { background: var(--muted); }
.obds-btn--destructive { background: color-mix(in oklab, var(--destructive) 10%, transparent); color: var(--destructive); }
.obds-btn--destructive:hover { background: color-mix(in oklab, var(--destructive) 20%, transparent); }
.obds-btn--link { background: transparent; color: var(--primary); text-underline-offset: 4px; padding: 0; height: auto; }
.obds-btn--link:hover { text-decoration: underline; }

.obds-btn--size-default { height: 32px; padding: 0 10px; }
.obds-btn--size-sm { height: 28px; padding: 0 10px; font-size: 0.8rem; gap: 4px; }
.obds-btn--size-lg { height: 36px; padding: 0 12px; }
.obds-btn--size-icon { height: 32px; width: 32px; padding: 0; }
.obds-btn--size-icon-sm { height: 28px; width: 28px; padding: 0; }
`;

if (typeof document !== "undefined" && !document.getElementById("obds-button-css")) {
  const s = document.createElement("style");
  s.id = "obds-button-css";
  s.textContent = buttonCss;
  document.head.appendChild(s);
}

export function Button({
  variant = "default",
  size = "default",
  icon,
  iconEnd,
  children,
  className = "",
  ...rest
}) {
  const iconSize = size === "sm" || size === "icon-sm" ? 14 : 16;
  return (
    <button
      type="button"
      className={`obds-btn obds-btn--${variant} obds-btn--size-${size} ${className}`}
      {...rest}
    >
      {icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
      {iconEnd ? <Icon name={iconEnd} size={iconSize} /> : null}
    </button>
  );
}
