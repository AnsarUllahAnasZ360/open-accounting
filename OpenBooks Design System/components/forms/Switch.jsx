import React, { useState } from "react";

/* OpenBooks Switch — from the codebase's shadcn switch.tsx (32×18, green when on). */

const switchCss = `
.obds-switch {
  position: relative; display: inline-flex; align-items: center; flex-shrink: 0;
  width: 32px; height: 18px; padding: 0; cursor: pointer;
  border: 1px solid transparent; border-radius: var(--radius-full);
  background: var(--input); outline: none;
  transition: background-color 120ms ease-out;
}
.obds-switch[aria-checked="true"] { background: var(--primary); }
.obds-switch:focus-visible { border-color: var(--ring); box-shadow: var(--ring-shadow); }
.obds-switch:disabled { cursor: not-allowed; opacity: 0.5; }
.obds-switch__thumb {
  display: block; width: 14px; height: 14px; margin-left: 1px;
  border-radius: var(--radius-full); background: var(--background);
  transition: transform 120ms ease-out;
}
.obds-switch[aria-checked="true"] .obds-switch__thumb { transform: translateX(14px); }
.obds-switch--sm { width: 24px; height: 14px; }
.obds-switch--sm .obds-switch__thumb { width: 10px; height: 10px; }
.obds-switch--sm[aria-checked="true"] .obds-switch__thumb { transform: translateX(10px); }
`;

if (typeof document !== "undefined" && !document.getElementById("obds-switch-css")) {
  const s = document.createElement("style");
  s.id = "obds-switch-css";
  s.textContent = switchCss;
  document.head.appendChild(s);
}

export function Switch({ checked, defaultChecked = false, onCheckedChange, size = "default", className = "", ...rest }) {
  const [internal, setInternal] = useState(defaultChecked);
  const isOn = checked !== undefined ? checked : internal;
  const toggle = () => {
    const next = !isOn;
    if (checked === undefined) setInternal(next);
    if (onCheckedChange) onCheckedChange(next);
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      onClick={toggle}
      className={`obds-switch ${size === "sm" ? "obds-switch--sm" : ""} ${className}`}
      {...rest}
    >
      <span className="obds-switch__thumb"></span>
    </button>
  );
}
