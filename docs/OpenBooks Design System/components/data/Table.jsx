import React from "react";

/* OpenBooks Table — from the codebase's shadcn table.tsx:
   40px header row, hairline row borders, muted row hover, last row borderless. */

const tableCss = `
.obds-table-container { position: relative; width: 100%; overflow-x: auto; }
.obds-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.obds-table thead tr { border-bottom: var(--border-default); }
.obds-table tbody tr { border-bottom: var(--border-default); transition: background-color 120ms ease-out; }
.obds-table tbody tr:last-child { border-bottom: 0; }
.obds-table tbody tr:hover { background: color-mix(in oklab, var(--muted) 50%, transparent); }
.obds-table th {
  height: 40px; padding: 0 8px; text-align: left; vertical-align: middle;
  font-weight: var(--weight-medium); color: var(--foreground); white-space: nowrap;
}
.obds-table td { padding: 8px; vertical-align: middle; white-space: nowrap; }
.obds-table th.obds-num, .obds-table td.obds-num {
  text-align: right;
  font-family: var(--font-figures); font-feature-settings: "tnum" 1, "lnum" 1;
}
.obds-table tfoot { border-top: var(--border-default); font-weight: var(--weight-medium); }
.obds-table tfoot td { background: color-mix(in oklab, var(--muted) 50%, transparent); }
`;

if (typeof document !== "undefined" && !document.getElementById("obds-table-css")) {
  const s = document.createElement("style");
  s.id = "obds-table-css";
  s.textContent = tableCss;
  document.head.appendChild(s);
}

export function Table({ children, className = "", ...rest }) {
  return (
    <div className="obds-table-container">
      <table className={`obds-table ${className}`} {...rest}>{children}</table>
    </div>
  );
}

export function TableHeader({ children, ...rest }) { return <thead {...rest}>{children}</thead>; }
export function TableBody({ children, ...rest }) { return <tbody {...rest}>{children}</tbody>; }
export function TableFooter({ children, ...rest }) { return <tfoot {...rest}>{children}</tfoot>; }
export function TableRow({ children, ...rest }) { return <tr {...rest}>{children}</tr>; }

export function TableHead({ numeric = false, children, className = "", ...rest }) {
  return <th className={`${numeric ? "obds-num" : ""} ${className}`} {...rest}>{children}</th>;
}

export function TableCell({ numeric = false, children, className = "", ...rest }) {
  return <td className={`${numeric ? "obds-num" : ""} ${className}`} {...rest}>{children}</td>;
}
