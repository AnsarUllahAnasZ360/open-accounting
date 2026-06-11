import React, { createContext, useContext, useState } from "react";

/* OpenBooks Tabs — from the codebase's shadcn tabs.tsx.
   default variant: muted pill list with white active trigger + shadow-sm.
   line variant: transparent list with 2px foreground underline. */

const tabsCss = `
.obds-tabs { display: flex; flex-direction: column; gap: 8px; }
.obds-tabs__list {
  display: inline-flex; width: fit-content; align-items: center; justify-content: center;
  height: 32px; padding: 3px; border-radius: var(--radius-control);
  color: var(--text-muted);
}
.obds-tabs__list--default { background: var(--muted); }
.obds-tabs__list--line { background: transparent; gap: 4px; border-radius: 0; }
.obds-tabs__trigger {
  position: relative; display: inline-flex; flex: 1; align-items: center; justify-content: center;
  gap: 6px; height: calc(100% - 1px); padding: 2px 10px;
  border: 1px solid transparent; border-radius: var(--radius-md); cursor: pointer;
  background: transparent; font-family: var(--font-sans);
  font-size: var(--text-sm); font-weight: var(--weight-medium);
  color: color-mix(in oklab, var(--foreground) 60%, transparent);
  white-space: nowrap; transition: color 120ms ease-out, background-color 120ms ease-out;
  outline: none;
}
.obds-tabs__trigger:hover { color: var(--foreground); }
.obds-tabs__trigger:focus-visible { border-color: var(--ring); box-shadow: var(--ring-shadow); }
.obds-tabs__trigger[data-active="true"] { color: var(--foreground); }
.obds-tabs__list--default .obds-tabs__trigger[data-active="true"] { background: var(--background); box-shadow: var(--shadow-sm); }
.obds-tabs__trigger::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: -5px; height: 2px;
  background: var(--foreground); opacity: 0; transition: opacity 120ms ease-out;
}
.obds-tabs__list--line .obds-tabs__trigger[data-active="true"]::after { opacity: 1; }
.obds-tabs__content { flex: 1; font-size: var(--text-sm); outline: none; }
`;

if (typeof document !== "undefined" && !document.getElementById("obds-tabs-css")) {
  const s = document.createElement("style");
  s.id = "obds-tabs-css";
  s.textContent = tabsCss;
  document.head.appendChild(s);
}

const TabsContext = createContext(null);

export function Tabs({ defaultValue, value, onValueChange, children, className = "", ...rest }) {
  const [internal, setInternal] = useState(defaultValue);
  const active = value !== undefined ? value : internal;
  const setActive = (v) => {
    if (value === undefined) setInternal(v);
    if (onValueChange) onValueChange(v);
  };
  return (
    <TabsContext.Provider value={{ active, setActive }}>
      <div className={`obds-tabs ${className}`} {...rest}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ variant = "default", children, className = "", ...rest }) {
  return (
    <div role="tablist" className={`obds-tabs__list obds-tabs__list--${variant} ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function TabsTrigger({ value, children, className = "", ...rest }) {
  const ctx = useContext(TabsContext);
  const isActive = ctx && ctx.active === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      data-active={isActive ? "true" : "false"}
      className={`obds-tabs__trigger ${className}`}
      onClick={() => ctx && ctx.setActive(value)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children, className = "", ...rest }) {
  const ctx = useContext(TabsContext);
  if (!ctx || ctx.active !== value) return null;
  return <div role="tabpanel" className={`obds-tabs__content ${className}`} {...rest}>{children}</div>;
}
