import React from "react";
import { Icon } from "../core/Icon.jsx";

/* OpenBooks Input — from the codebase's shadcn input.tsx (h-8, rounded-lg, ring focus). */

const inputCss = `
.obds-input-wrap { position: relative; display: flex; align-items: center; width: 100%; }
.obds-input-wrap__icon {
  position: absolute; left: 10px; display: flex; align-items: center;
  color: var(--text-muted); pointer-events: none;
}
.obds-input {
  height: 32px; width: 100%; min-width: 0; padding: 4px 10px;
  background: transparent; border: 1px solid var(--input);
  border-radius: var(--radius-control); outline: none;
  font-family: var(--font-sans); font-size: var(--text-sm); color: var(--foreground);
  transition: border-color 120ms ease-out, box-shadow 120ms ease-out;
}
.obds-input--with-icon { padding-left: 32px; }
.obds-input::placeholder { color: var(--text-muted); }
.obds-input:focus-visible { border-color: var(--ring); box-shadow: var(--ring-shadow); }
.obds-input:disabled { pointer-events: none; cursor: not-allowed; opacity: 0.5; background: color-mix(in oklab, var(--input) 50%, transparent); }
.obds-input[aria-invalid="true"] { border-color: var(--destructive); }
`;

if (typeof document !== "undefined" && !document.getElementById("obds-input-css")) {
  const s = document.createElement("style");
  s.id = "obds-input-css";
  s.textContent = inputCss;
  document.head.appendChild(s);
}

export function Input({ icon, className = "", style, ...rest }) {
  const input = (
    <input
      className={`obds-input ${icon ? "obds-input--with-icon" : ""} ${className}`}
      style={icon ? undefined : style}
      {...rest}
    />
  );
  if (!icon) return input;
  return (
    <div className="obds-input-wrap" style={style}>
      <span className="obds-input-wrap__icon"><Icon name={icon} size={16} /></span>
      {input}
    </div>
  );
}
