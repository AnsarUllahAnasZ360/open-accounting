const {
  PageHeader: OBTPageHeader, Input: OBTInput, Select: OBTSelect, Button: OBTButton,
  Badge: OBTBadge, Amount: OBTAmount, Card: OBTCard, CardContent: OBTCardContent,
  Table: OBTTable, TableHeader: OBTTableHeader, TableBody: OBTTableBody,
  TableRow: OBTTableRow, TableHead: OBTTableHead, TableCell: OBTTableCell,
  Tabs: OBTTabs, TabsList: OBTTabsList, TabsTrigger: OBTTabsTrigger,
} = window.OpenBooksDesignSystem_8d97bf;

const obTxns = [
  { date: "Jun 9", name: "Stripe payout", account: "Stripe — Main", category: "Clearing reconciliation", amount: 4892.14, state: ["secondary", null, "Match"], ai: false },
  { date: "Jun 8", name: "Figma", account: "Mercury Checking", category: "Software & AI tools", amount: -45.0, state: ["positive", "circle-check", "Posted"], ai: true },
  { date: "Jun 6", name: "OpenAI", account: "Mercury Checking", category: "Software & AI tools", amount: -248.0, state: ["outline", null, "Ready"], ai: true },
  { date: "Jun 5", name: "Wise transfer", account: "Mercury Checking", category: "—", amount: -1850.0, state: ["warning", "circle-alert", "Needs review"], ai: false },
  { date: "Jun 4", name: "Mercury ACH — Halpern Co", account: "Mercury Checking", category: "Marketing retainer revenue", amount: 5500.0, state: ["positive", "circle-check", "Posted"], ai: true },
  { date: "Jun 4", name: "Google Workspace", account: "Chase Business Savings", category: "Software & AI tools", amount: -86.4, state: ["positive", "circle-check", "Posted"], ai: true },
  { date: "Jun 3", name: "WeWork", account: "Chase Business Savings", category: "Rent & facilities", amount: -1200.0, state: ["positive", "circle-check", "Posted"], ai: false },
  { date: "Jun 2", name: "Zelle from R. Patel", account: "Mercury Checking", category: "—", amount: 2400.0, state: ["warning", "circle-alert", "Needs review"], ai: false },
  { date: "Jun 1", name: "Stripe fees", account: "Stripe — Main", category: "Payment processing fees", amount: -142.31, state: ["positive", "circle-check", "Posted"], ai: true },
];

function OBTransactions({ mode }) {
  const title = mode === "income" ? "Income" : mode === "expenses" ? "Expenses" : "Transactions";
  const description =
    mode === "income" ? "Money in — every dollar attributed to a source" :
    mode === "expenses" ? "Money out — operational and other expenses" :
    "Every transaction from your banks and Stripe, categorized by AI";
  const rows = obTxns.filter((t) =>
    mode === "income" ? t.amount > 0 : mode === "expenses" ? t.amount < 0 : true
  );

  return (
    <div className="ob-page">
      <OBTPageHeader
        title={title}
        description={description}
        actions={<>
          <OBTButton variant="outline" icon="upload">Import receipts</OBTButton>
          <OBTButton icon="plus">Add transaction</OBTButton>
        </>}
      />

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <OBTInput icon="search" placeholder="Search by vendor, amount, or category" style={{ maxWidth: 320 }} />
        <OBTSelect options={["All accounts", "Mercury Checking", "Chase Business Savings", "Stripe — Main"]} defaultValue="All accounts" />
        <OBTSelect options={["All categories", "Software & AI tools", "Contractor labor", "Rent & facilities", "Payment processing fees"]} defaultValue="All categories" />
        <OBTSelect options={["Last 30 days", "This quarter", "Year to date"]} defaultValue="Last 30 days" />
        <span style={{ flex: 1 }}></span>
        <OBTTabs defaultValue="all">
          <OBTTabsList>
            <OBTTabsTrigger value="review">For review</OBTTabsTrigger>
            <OBTTabsTrigger value="all">All</OBTTabsTrigger>
          </OBTTabsList>
        </OBTTabs>
      </div>

      <OBTCard>
        <OBTCardContent>
          <OBTTable>
            <OBTTableHeader>
              <OBTTableRow>
                <OBTTableHead>Date</OBTTableHead>
                <OBTTableHead>Description</OBTTableHead>
                <OBTTableHead>Account</OBTTableHead>
                <OBTTableHead>Category</OBTTableHead>
                <OBTTableHead numeric>Amount</OBTTableHead>
                <OBTTableHead style={{ textAlign: "right" }}>State</OBTTableHead>
              </OBTTableRow>
            </OBTTableHeader>
            <OBTTableBody>
              {rows.map((t, i) => (
                <OBTTableRow key={i}>
                  <OBTTableCell style={{ fontFamily: "var(--font-figures)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{t.date}</OBTTableCell>
                  <OBTTableCell style={{ fontWeight: 500 }}>{t.name}</OBTTableCell>
                  <OBTTableCell style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>{t.account}</OBTTableCell>
                  <OBTTableCell style={{ color: "var(--text-secondary)" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {t.category}
                      {t.ai ? <OBTBadge variant="ai" icon="sparkles">AI</OBTBadge> : null}
                    </span>
                  </OBTTableCell>
                  <OBTTableCell numeric><OBTAmount value={t.amount} colored /></OBTTableCell>
                  <OBTTableCell style={{ textAlign: "right" }}>
                    <OBTBadge variant={t.state[0]} icon={t.state[1] || undefined}>{t.state[2]}</OBTBadge>
                  </OBTTableCell>
                </OBTTableRow>
              ))}
            </OBTTableBody>
          </OBTTable>
        </OBTCardContent>
      </OBTCard>
    </div>
  );
}

window.OBTransactions = OBTransactions;
