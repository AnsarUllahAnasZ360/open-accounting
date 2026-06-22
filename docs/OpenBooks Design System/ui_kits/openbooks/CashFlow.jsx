const {
  PageHeader: OBCPageHeader, StatCard: OBCStatCard, Amount: OBCAmount, BarChart: OBCBarChart,
  Badge: OBCBadge, Card: OBCCard, CardHeader: OBCCardHeader, CardTitle: OBCCardTitle,
  CardDescription: OBCCardDescription, CardContent: OBCCardContent, Select: OBCSelect, Icon: OBCIcon,
} = window.OpenBooksDesignSystem_8d97bf;

const obPlanner = [
  { label: "Halpern Co retainer", due: "Jun 15", amount: 5500, dir: "in" },
  { label: "Contractor — delivery", due: "Jun 18", amount: -3700, dir: "out" },
  { label: "Rent — WeWork", due: "Jul 1", amount: -1200, dir: "out" },
  { label: "Stripe payout (est.)", due: "Jul 2", amount: 4100, dir: "in" },
  { label: "Quarterly insurance", due: "Jul 8", amount: -860, dir: "out" },
];

const obBudgets = [
  { label: "Software & AI tools", spent: 1240, budget: 1500 },
  { label: "Contractor labor", spent: 5550, budget: 6000 },
  { label: "Marketing", spent: 480, budget: 1200 },
];

function OBCashFlow() {
  return (
    <div className="ob-page">
      <OBCPageHeader
        title="Cash flow"
        description="Where money moved, and what's coming"
        actions={<OBCSelect options={["Last 6 months", "Last 12 months"]} defaultValue="Last 6 months" />}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <OBCStatCard label="Cash today" value={<OBCAmount value={128400} abbreviate decimals={1} />} detail="All accounts" icon="landmark" />
        <OBCStatCard label="Expected in 30 days" value={<OBCAmount value={9600} abbreviate decimals={1} signed />} detail="Planner net" icon="calendar" trend="2 bills due" trendVariant="outline" />
        <OBCStatCard label="Runway" value="14 months" detail="At current average burn" icon="clock-3" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.45fr 0.85fr", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <OBCCard>
            <OBCCardHeader>
              <OBCCardTitle>Net cash flow</OBCCardTitle>
              <OBCCardDescription>Monthly in minus out · amber = projected</OBCCardDescription>
            </OBCCardHeader>
            <OBCCardContent>
              <OBCBarChart
                height={170}
                data={[
                  { label: "Jan", value: 12400 }, { label: "Feb", value: -3200 }, { label: "Mar", value: 8900 },
                  { label: "Apr", value: 15300 }, { label: "May", value: 6100 }, { label: "Jun", value: 9800 },
                  { label: "Jul", value: 7400, color: "var(--chart-3)" }, { label: "Aug", value: 8200, color: "var(--chart-3)" },
                ]}
                formatValue={(v) => "$" + Math.abs(v).toLocaleString()}
              />
            </OBCCardContent>
          </OBCCard>

          <OBCCard>
            <OBCCardHeader>
              <OBCCardTitle>Budgets</OBCCardTitle>
              <OBCCardDescription>June, three tracked categories</OBCCardDescription>
            </OBCCardHeader>
            <OBCCardContent style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {obBudgets.map((b) => {
                const pct = Math.min(100, Math.round((b.spent / b.budget) * 100));
                const over = pct >= 90;
                return (
                  <div key={b.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-sm)" }}>
                      <span style={{ fontWeight: 500 }}>{b.label}</span>
                      <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-figures)" }}>
                        ${b.spent.toLocaleString()} / ${b.budget.toLocaleString()}
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: "var(--muted)", overflow: "hidden" }}>
                      <div style={{ width: pct + "%", height: "100%", borderRadius: 3, background: over ? "var(--warning)" : "var(--chart-1)" }}></div>
                    </div>
                  </div>
                );
              })}
            </OBCCardContent>
          </OBCCard>
        </div>

        <OBCCard>
          <OBCCardHeader>
            <OBCCardTitle>Planner</OBCCardTitle>
            <OBCCardDescription>Known and recurring items, next 30 days</OBCCardDescription>
          </OBCCardHeader>
          <OBCCardContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {obPlanner.map((p) => (
              <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: "var(--radius-md)", background: p.dir === "in" ? "var(--positive-surface)" : "var(--negative-surface)", color: p.dir === "in" ? "var(--positive)" : "var(--negative)" }}>
                  <OBCIcon name={p.dir === "in" ? "arrow-down-right" : "arrow-up-right"} size={14} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>{p.label}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{p.due}</div>
                </div>
                <OBCAmount value={p.amount} colored signed />
              </div>
            ))}
          </OBCCardContent>
        </OBCCard>
      </div>
    </div>
  );
}

window.OBCashFlow = OBCashFlow;
