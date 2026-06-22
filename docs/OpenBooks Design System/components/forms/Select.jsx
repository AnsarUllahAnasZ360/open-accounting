import React from "react";
import { Icon } from "../core/Icon.jsx";

/* OpenBooks Select — styled native select matching Input metrics (h-32, rounded-lg). */

const selectCss = `
.obds-select-wrap { position: relative; display: inline-flex; align-items: center; }
.obds-select {
  appearance: none; height: 32px; min-width: 0; padding: 4px 30px 4px 10px;
  background: var(--background); border: 1px solid var(--input);
  border-radius: var(--radius-control); outline: none; cursor: pointer;
  font-family: var(--font-sans); font-size: var(--text-sm); color: var(--foreground);
  transition: border-color 120ms ease-out, box-shadow 120ms ease-out, background-color 120ms ease-out;
}
.obds-select:hover { background: var(--muted); }
.obds-select:focus-visible { border-color: var(--ring); box-shadow: var(--ring-shadow); }
.obds-select:disabled { pointer-events: none; opacity: 0.5; }
.obds-select-wrap__chevron {
  position: absolute; right: 10px; display: flex; align-items: center;
  color: var(--text-muted); pointer-events: none;
}
`;

if (typeof document !== "undefined" && !document.getElementById("obds-select-css")) {
  const s = document.createElement("style");
  s.id = "obds-select-css";
  s.textContent = selectCss;
  document.head.appendChild(s);
}

export function Select({ options = [], value, defaultValue, onChange, placeholder, className = "", style, ...rest }) {
  return (
    <span className={`obds-select-wrap ${className}`} style={style}>
      <select
        className="obds-select"
        value={value}
        defaultValue={value === undefined ? (defaultValue !== undefined ? defaultValue : (placeholder ? "" : undefined)) : undefined}
        onChange={onChange}
        {...rest}
      >
        {placeholder ? <option value="" disabled>{placeholder}</option> : null}
        {options.map((opt) => {
          const o = typeof opt === "string" ? { value: opt, label: opt } : opt;
          return <option key={o.value} value={o.value}>{o.label}</option>;
        })}
      </select>
      <span className="obds-select-wrap__chevron"><Icon name="chevron-down" size={16} /></span>
    </span>
  );
}
