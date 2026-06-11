import React from "react";

/* OpenBooks BarChart — minimal SVG column chart for cash-flow style widgets.
   Positive bars green, negative red; 4px top radius; thin baseline grid. */

export function BarChart({
  data = [],
  height = 160,
  positiveColor = "var(--chart-1)",
  negativeColor = "var(--chart-5)",
  showLabels = true,
  formatValue,
}) {
  const values = data.map((d) => d.value);
  const max = Math.max(...values.map((v) => Math.max(v, 0)), 1);
  const min = Math.min(...values.map((v) => Math.min(v, 0)), 0);
  const range = max - min;
  const labelH = showLabels ? 18 : 0;
  const chartH = height - labelH;
  const zeroY = chartH * (max / range);
  const n = data.length;

  return (
    <div style={{ width: "100%" }}>
      <svg width="100%" height={height} preserveAspectRatio="none" style={{ display: "block" }} viewBox={`0 0 100 ${height}`}>
        <line x1="0" y1={zeroY} x2="100" y2={zeroY} stroke="var(--chart-grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => {
          const slot = 100 / n;
          const barW = slot * 0.55;
          const x = i * slot + (slot - barW) / 2;
          const h = Math.max((Math.abs(d.value) / range) * chartH, 1.5);
          const y = d.value >= 0 ? zeroY - h : zeroY;
          const fill = d.color || (d.value >= 0 ? positiveColor : negativeColor);
          return (
            <rect key={i} x={x} y={y} width={barW} height={h} rx="1.5" fill={fill}>
              {formatValue ? <title>{`${d.label}: ${formatValue(d.value)}`}</title> : null}
            </rect>
          );
        })}
      </svg>
      {showLabels ? (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${n}, 1fr)`, marginTop: 4 }}>
          {data.map((d, i) => (
            <span key={i} style={{ textAlign: "center", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              {d.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
