The only surface container in OpenBooks — everything lives in cards on a white page.

```jsx
<Card>
  <CardHeader>
    <CardTitle>Profit & Loss</CardTitle>
    <CardDescription>Jan 1 – Jun 10, 2026</CardDescription>
    <CardAction><Button variant="ghost" size="icon-sm" icon="ellipsis" /></CardAction>
  </CardHeader>
  <CardContent>…</CardContent>
</Card>
```

Subcomponents: `CardHeader` (grid with title/description left, `CardAction` right), `CardContent`, `CardFooter` (muted, top border). `size="sm"` tightens padding to 12px. Never nest cards; never add extra borders or stronger shadows.
