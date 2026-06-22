The OpenBooks app shell sidebar — fixed 232px left rail with the canonical nav order.

```jsx
<SideNav
  logoSrc="../../assets/logo/openbooks-mark.png"
  activeId="dashboard"
  onSelect={setScreen}
  items={[
    { id: "dashboard", label: "Dashboard", icon: "layout-dashboard" },
    { id: "inbox", label: "Inbox", icon: "inbox", count: 14 },
    { section: "Money" },
    { id: "transactions", label: "Transactions", icon: "receipt" },
    { id: "income", label: "Income", icon: "arrow-up-right" },
    { id: "expenses", label: "Expenses", icon: "arrow-down-right" },
    { id: "cashflow", label: "Cash flow", icon: "chart-column" },
    { section: "Insights" },
    { id: "reports", label: "Reports", icon: "file-text" },
  ]}
  footerItems={[{ id: "settings", label: "Settings", icon: "settings" }]}
/>
```

The Inbox `count` pill is how AI surfaces pending questions. Keep this nav order across screens.
