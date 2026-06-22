Tiny trend line inside StatCards.

```jsx
<StatCard label="Revenue MTD" value={<Amount value={42800} abbreviate decimals={1} />}>
  <Sparkline data={[18, 22, 19, 27, 31, 42]} width={220} />
</StatCard>
```

Use `color="var(--chart-5)"` for declining expense trends only when the decline is bad news; otherwise stay green.
