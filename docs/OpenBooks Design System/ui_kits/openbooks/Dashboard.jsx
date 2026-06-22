const {
  PageHeader, AskAI, StatCard, Amount, Sparkline, BarChart, Badge, Button,
  Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Icon, Select,
} = window.OpenBooksDesignSystem_8d97bf;

const obAccounts = [
  { name: "Mercury Checking", kind: "Bank · Plaid", balance: 84210.33, icon: "landmark" },
  { name: "Chase Business Savings", kind: "Bank · Plaid", balance: 40102.18, icon: "landmark" },
  { name: "Stripe — Main", kind: "Payments · Stripe", balance: 4087.49, icon: "credit-card" },
];

const obPnlMonths = [
  { label: "Jan", income: 31, expenses: 22 },
  { label: "Feb", income: 28, expenses: 21 },
  { label: "Mar", income: 36, expenses: 24 },
  { label: "Apr", income: 33, expenses: 19 },
  { label: "May", income: 41, expenses: 23 },
  { label: "Jun", income: 43, expenses: 20 },
];

function OBDashboard({ onNavigate, inboxCount = 3 }) {
  return (
    <div className="ob-page">
      <PageHeader
        title="Business at a glance"
        description="Jun 10, 2026 · All accounts synced 12 minutes ago"
        actions={<>
          <Select options={["This month", "This quarter", "Year to date", "Last 12 months"]} defaultValue="This month" />
          <Button variant="outline" icon="plus" onClick={() => onNavigate("transactions")}>Add transaction</Button>
        </>}
      />

      <AskAI
        suggestions={[
          "How much did I spend on software in May?",
          "What's my runway at current burn?",
          "Which receivables are overdue?",
        ]}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <StatCard label="Total balance" value={<Amount value={128400} abbreviate decimals={1} />} detail="3 connected accounts" icon="landmark" trend="Synced" trendVariant="info" />
        <StatCard label="Income MTD" value={<Amount value={42800} abbreviate decimals={1} />} detail="Stripe and ACH sources" icon="arrow-up-right" trend="+18%" trendVariant="positive">
          <Sparkline data={[18, 22, 19, 27, 31, 42]} width={200} height={28} />
        </StatCard>
        <StatCard label="Expenses MTD" value={<Amount value={19600} abbreviate decimals={1} />} detail="Software, contractors, fees" icon="arrow-down-right" trend="−4%" trendVariant="positive" />
        <StatCard label="Net profit MTD" value={<Amount value={23200} abbreviate decimals={1} />} detail="54% margin" icon="trending-up" trend="+31%" trendVariant="positive" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.45fr 0.85fr", gap: 16, alignItems: "start" }}>
        <Card>
          <CardHeader>
            <CardTitle>Profit &amp; Loss</CardTitle>
            <CardDescription>Income vs expenses, last 6 months ($K)</CardDescription>
            <CardAction><Button variant="link" onClick={() => onNavigate("reports")}>Run report</Button></CardAction>
          </CardHeader>
          <CardContent>
            <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--chart-1)" }}></span>Income</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--chart-4)" }}></span>Expenses</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${obPnlMonths.length}, 1fr)`, gap: 12, alignItems: "end", height: 150 }}>
              {obPnlMonths.map((m) => (
                <div key={m.label} style={{ display: "flex", gap: 4, alignItems: "flex-end", justifyContent: "center", height: "100%" }}>
                  <div style={{ width: 16, height: `${(m.income / 45) * 100}%`, background: "var(--chart-1)", borderRadius: "3px 3px 0 0" }}></div>
                  <div style={{ width: 16, height: `${(m.expenses / 45) * 100}%`, background: "var(--chart-4)", borderRadius: "3px 3px 0 0" }}></div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${obPnlMonths.length}, 1fr)`, marginTop: 6 }}>
              {obPnlMonths.map((m) => (
                <span key={m.label} style={{ textAlign: "center", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{m.label}</span>
              ))}
            </div>
          </CardContent>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <CardHeader>
              <CardTitle>Accounts</CardTitle>
              <CardAction><Button variant="ghost" size="sm" icon="plus">Connect</Button></CardAction>
            </CardHeader>
            <CardContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {obAccounts.map((a) => (
                <div key={a.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: "var(--radius-md)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                    <Icon name={a.icon} size={16} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>{a.name}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{a.kind}</div>
                  </div>
                  <Amount value={a.balance} weight={500} />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Needs your input</CardTitle>
              <CardDescription>{inboxCount} transactions the AI couldn't place</CardDescription>
              <CardAction>
                <Badge variant="warning" icon="circle-alert">{inboxCount}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <Button variant="outline" icon="inbox" onClick={() => onNavigate("inbox")} style={{ width: "100%" }}>Open inbox</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

window.OBDashboard = OBDashboard;
