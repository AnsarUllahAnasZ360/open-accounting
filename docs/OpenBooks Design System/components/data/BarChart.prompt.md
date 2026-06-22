Column chart for cash flow and monthly in/out widgets — green above zero, red below.

```jsx
<BarChart
  height={160}
  data={[
    { label: "Jan", value: 12400 },
    { label: "Feb", value: -3200 },
    { label: "Mar", value: 8900 },
  ]}
  formatValue={(v) => "$" + Math.abs(v).toLocaleString()}
/>
```

Use `color: "var(--chart-3)"` per-bar for projected periods. No axes beyond the zero baseline; keep it quiet.
