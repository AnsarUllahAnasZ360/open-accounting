Top-of-screen title row, used on every screen.

```jsx
<PageHeader
  title="Reports"
  description="Standard and custom reports for any period"
  actions={<>
    <Select options={["This quarter", "Year to date"]} defaultValue="This quarter" />
    <Button variant="outline" icon="download">Export</Button>
  </>}
/>
```

Titles are sentence case except formal report names ("Profit & Loss").
