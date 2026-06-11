Renders a money figure in Geist Mono with tabular numerals — required for every amount in the product so columns align.

```jsx
<Amount value={4892.14} />                       // $4,892.14
<Amount value={-1850} colored />                  // −$1,850.00 in red
<Amount value={128400} abbreviate decimals={1} /> // $128.4K (metric cards only)
<Amount value={5500} colored signed />            // +$5,500.00 in green
```

Rules: tables always 2 decimals, right-aligned; `abbreviate` only in StatCard metrics; negatives use a true minus sign (−), never parentheses alone.
