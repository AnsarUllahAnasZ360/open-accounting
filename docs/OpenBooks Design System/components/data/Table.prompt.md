The ledger table — used for transactions, report lines, aging summaries.

```jsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Date</TableHead>
      <TableHead>Counterparty</TableHead>
      <TableHead numeric>Amount</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>Jun 6</TableCell>
      <TableCell>Stripe payout</TableCell>
      <TableCell numeric><Amount value={4892.14} /></TableCell>
    </TableRow>
  </TableBody>
</Table>
```

Pass `numeric` on TableHead/TableCell for money columns — right-aligns and sets tabular figures. Tables live inside Cards (use CardContent with zero side padding or full-bleed). Footer rows carry totals in medium weight.
