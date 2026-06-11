import React from "react";

/* OpenBooks PageHeader — title row at the top of every screen: 24px semibold title,
   muted description, actions right-aligned. */

export function PageHeader({ title, description, actions, style }) {
  return (
    <header style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 16, flexWrap: "wrap", ...style,
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <h1 style={{
          fontSize: "var(--text-page-title-size)",
          fontWeight: "var(--text-page-title-weight)",
          lineHeight: "var(--leading-tight)",
          letterSpacing: "-0.01em",
        }}>
          {title}
        </h1>
        {description ? (
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>{actions}</div>
      ) : null}
    </header>
  );
}
