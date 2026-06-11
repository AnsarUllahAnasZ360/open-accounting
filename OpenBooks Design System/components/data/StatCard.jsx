import React from "react";
import { Card, CardHeader, CardTitle, CardAction, CardContent } from "../core/Card.jsx";
import { Badge } from "../core/Badge.jsx";
import { Icon } from "../core/Icon.jsx";

/* OpenBooks StatCard — dashboard metric card, layout from the codebase's page.tsx:
   muted label + icon action, 30px semibold value, detail + trend badge row. */

export function StatCard({ label, value, detail, icon, trend, trendVariant = "outline", children }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)", color: "var(--text-muted)" }}>
          {label}
        </CardTitle>
        {icon ? (
          <CardAction>
            <span style={{ color: "var(--text-muted)", display: "flex" }}><Icon name={icon} size={16} /></span>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{
          fontSize: "var(--text-metric-size)",
          fontWeight: "var(--weight-semibold)",
          letterSpacing: "var(--text-metric-tracking)",
          lineHeight: "var(--leading-tight)",
        }}>
          {value}
        </div>
        {(detail || trend) ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{detail}</p>
            {trend ? <Badge variant={trendVariant}>{trend}</Badge> : null}
          </div>
        ) : null}
        {children}
      </CardContent>
    </Card>
  );
}
