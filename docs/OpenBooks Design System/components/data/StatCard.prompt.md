Dashboard metric card — the "business at a glance" unit, in 2–4 column grids.

```jsx
<StatCard
  label="Cash balance"
  value={<Amount value={128400} abbreviate decimals={1} />}
  detail="Across 3 operating accounts"
  icon="landmark"
  trend="Synced"
  trendVariant="info"
/>
<StatCard label="Revenue MTD" value={<Amount value={42800} abbreviate decimals={1} />} detail="Stripe and ACH sources" icon="arrow-up-right" trend="+18%" trendVariant="positive" />
```

Children render below the detail row — use for a Sparkline.
