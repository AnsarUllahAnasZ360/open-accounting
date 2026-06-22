const {
  PageHeader: OBRPageHeader, Button: OBRButton, Select: OBRSelect, Icon: OBRIcon,
  Card: OBRCard, CardHeader: OBRCardHeader, CardTitle: OBRCardTitle,
  CardDescription: OBRCardDescription, CardContent: OBRCardContent,
  Table: OBRTable, TableHeader: OBRTableHeader, TableBody: OBRTableBody, TableFooter: OBRTableFooter,
  TableRow: OBRTableRow, TableHead: OBRTableHead, TableCell: OBRTableCell, Amount: OBRAmount,
} = window.OpenBooksDesignSystem_8d97bf;

const obReportGroups = [
  {
    group: "Business overview",
    reports: [
      { id: "pl", name: "Profit & Loss", desc: "Income, expenses, and net profit for a period", icon: "chart-line" },
      { id: "bs", name: "Balance Sheet", desc: "What you own and owe at a point in time", icon: "scale" },
      { id: "cf", name: "Statement of Cash Flows", desc: "Cash in and out across operating, investing, financing", icon: "chart-column" },
      { id: "snap", name: "Business Snapshot", desc: "Trends and key ratios at a glance", icon: "layout-dashboard" },
    ],
  },
  {
    group: "Who owes you",
    reports: [
      { id: "ar", name: "A/R Aging Summary", desc: "Unpaid customer balances by 30/60/90-day buckets", icon: "arrow-down-right" },
    ],
  },
  {
    group: "What you owe",
    reports: [
      { id: "ap", name: "A/P Aging Summary", desc: "Unpaid bills by 30/60/90-day buckets", icon: "arrow-up-right" },
    ],
  },
];

const obPlLines = {
  income: [
    ["Marketing retainer revenue", 27500.0],
    ["Stripe sales", 14182.49],
    ["Consulting income", 1117.51],
  ],
  expenses: [
    ["Contractor labor", 9250.0],
    ["Software & AI tools", 3118.4],
    ["Rent & facilities", 3600.0],
    ["Payment processing fees", 711.55],
    ["Bank fees", 120.05],
  ],
};

function OBRReportPL({ onBack }) {
  const totalIncome = obPlLines.income.reduce((s, [, v]) => s + v, 0);
  const totalExpenses = obPlLines.expenses.reduce((s, [, v]) => s + v, 0);
  return (
    <div className="ob-page">
      <OBRPageHeader
        title="Profit & Loss"
        description="OpenBooks Demo Co · Apr 1 – Jun 10, 2026 · Accrual basis"
        actions={<>
          <OBRSelect options={["This quarter", "Year to date", "Last year"]} defaultValue="This quarter" />
          <OBRButton variant="outline" icon="download">Export</OBRButton>
          <OBRButton variant="ghost" icon="chevron-left" onClick={onBack}>All reports</OBRButton>
        </>}
      />
      <OBRCard>
        <OBRCardContent>
          <OBRTable>
            <OBRTableHeader>
              <OBRTableRow>
                <OBRTableHead>Account</OBRTableHead>
                <OBRTableHead numeric>Total</OBRTableHead>
              </OBRTableRow>
            </OBRTableHeader>
            <OBRTableBody>
              <OBRTableRow><OBRTableCell style={{ fontWeight: 600 }}>Income</OBRTableCell><OBRTableCell numeric></OBRTableCell></OBRTableRow>
              {obPlLines.income.map(([name, v]) => (
                <OBRTableRow key={name}>
                  <OBRTableCell style={{ paddingLeft: 28, color: "var(--text-secondary)" }}>{name}</OBRTableCell>
                  <OBRTableCell numeric><OBRAmount value={v} /></OBRTableCell>
                </OBRTableRow>
              ))}
              <OBRTableRow>
                <OBRTableCell style={{ fontWeight: 500 }}>Total income</OBRTableCell>
                <OBRTableCell numeric><OBRAmount value={totalIncome} weight={600} /></OBRTableCell>
              </OBRTableRow>
              <OBRTableRow><OBRTableCell style={{ fontWeight: 600 }}>Expenses</OBRTableCell><OBRTableCell numeric></OBRTableCell></OBRTableRow>
              {obPlLines.expenses.map(([name, v]) => (
                <OBRTableRow key={name}>
                  <OBRTableCell style={{ paddingLeft: 28, color: "var(--text-secondary)" }}>{name}</OBRTableCell>
                  <OBRTableCell numeric><OBRAmount value={-v} /></OBRTableCell>
                </OBRTableRow>
              ))}
              <OBRTableRow>
                <OBRTableCell style={{ fontWeight: 500 }}>Total expenses</OBRTableCell>
                <OBRTableCell numeric><OBRAmount value={-totalExpenses} weight={600} /></OBRTableCell>
              </OBRTableRow>
            </OBRTableBody>
            <OBRTableFooter>
              <OBRTableRow>
                <OBRTableCell style={{ fontWeight: 600 }}>Net profit</OBRTableCell>
                <OBRTableCell numeric><OBRAmount value={totalIncome - totalExpenses} colored weight={600} /></OBRTableCell>
              </OBRTableRow>
            </OBRTableFooter>
          </OBRTable>
        </OBRCardContent>
      </OBRCard>
    </div>
  );
}

function OBReports() {
  const [view, setView] = React.useState("list");
  if (view === "pl") return <OBRReportPL onBack={() => setView("list")} />;
  return (
    <div className="ob-page">
      <OBRPageHeader
        title="Reports"
        description="Standard and custom reports for any period"
        actions={<OBRButton variant="outline" icon="plus">Custom report</OBRButton>}
      />
      {obReportGroups.map((g) => (
        <div key={g.group} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-muted)" }}>{g.group}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            {g.reports.map((r) => (
              <OBRCard size="sm" key={r.id} style={{ cursor: r.id === "pl" ? "pointer" : "default" }}>
                <OBRCardContent
                  style={{ display: "flex", alignItems: "center", gap: 12 }}
                  onClick={() => { if (r.id === "pl") setView("pl"); }}
                >
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: "var(--radius-md)", background: "var(--ob-green-50)", color: "var(--ob-green-700)", flexShrink: 0 }}>
                    <OBRIcon name={r.icon} size={18} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>{r.name}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{r.desc}</div>
                  </div>
                  <OBRIcon name="chevron-right" size={16} style={{ color: "var(--text-muted)" }} />
                </OBRCardContent>
              </OBRCard>
            ))}
          </div>
        </div>
      ))}
      <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Only Profit &amp; Loss is wired in this kit; other reports open the same pattern.</p>
    </div>
  );
}

window.OBReports = OBReports;
