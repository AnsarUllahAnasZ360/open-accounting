Tab group for switching table views (e.g. Needs review / Ready / Posted).

```jsx
<Tabs defaultValue="review">
  <TabsList>
    <TabsTrigger value="review">Needs review</TabsTrigger>
    <TabsTrigger value="posted">Posted</TabsTrigger>
  </TabsList>
  <TabsContent value="review">…</TabsContent>
  <TabsContent value="posted">…</TabsContent>
</Tabs>
```

`<TabsList variant="line">` gives the underline style for page-level sections; default muted-pill style is for in-card view switching.
