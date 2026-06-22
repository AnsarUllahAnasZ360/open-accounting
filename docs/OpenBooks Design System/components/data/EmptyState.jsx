import React from "react";
import { Icon } from "../core/Icon.jsx";

/* OpenBooks EmptyState — quiet bordered well with a 40px muted icon. */

export function EmptyState({ icon = "inbox", title, description, action }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 8, padding: "40px 24px", textAlign: "center",
      border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)",
      color: "var(--text-muted)",
    }}>
      <Icon name={icon} size={40} strokeWidth={1.5} />
      {title ? (
        <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)", color: "var(--foreground)", marginTop: 4 }}>
          {title}
        </div>
      ) : null}
      {description ? (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", maxWidth: 360 }}>{description}</p>
      ) : null}
      {action ? <div style={{ marginTop: 8 }}>{action}</div> : null}
    </div>
  );
}
