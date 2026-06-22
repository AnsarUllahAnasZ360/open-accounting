const {
  PageHeader: OBIPageHeader, ReviewItem: OBIReviewItem, EmptyState: OBIEmptyState,
  Badge: OBIBadge, Tabs: OBITabs, TabsList: OBITabsList, TabsTrigger: OBITabsTrigger, TabsContent: OBITabsContent,
} = window.OpenBooksDesignSystem_8d97bf;

const obInboxSeed = [
  {
    id: 1, counterparty: "Wise transfer", date: "Jun 5", account: "Mercury Checking", amount: -1850,
    question: "I wasn't sure if this is contractor delivery labor or an owner reimbursement — you've used both for Wise before.",
    options: ["Contractor labor", "Owner reimbursement", "Something else"],
  },
  {
    id: 2, counterparty: "Amazon Mktp", date: "Jun 4", account: "Chase Business Savings", amount: -312.87,
    question: "This could be office supplies or inventory. Your last three Amazon purchases were split between the two.",
    options: ["Office supplies", "Inventory", "Something else"],
  },
  {
    id: 3, counterparty: "Zelle from R. Patel", date: "Jun 2", account: "Mercury Checking", amount: 2400,
    question: "I couldn't match this to an open invoice. Is it client revenue or a loan repayment?",
    options: ["Client revenue", "Loan repayment", "Something else"],
  },
];

function OBInbox({ count, setCount }) {
  const [items, setItems] = React.useState(obInboxSeed);
  const [resolved, setResolved] = React.useState([]);

  const resolve = (item, choice) => {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    setResolved((prev) => [{ ...item, choice }, ...prev]);
    if (setCount) setCount((c) => Math.max(0, c - 1));
  };

  return (
    <div className="ob-page">
      <OBIPageHeader
        title="Inbox"
        description="The AI asks here when it needs your context. Everything else posts automatically."
      />
      <OBITabs defaultValue="open">
        <OBITabsList>
          <OBITabsTrigger value="open">Needs input{items.length ? ` (${items.length})` : ""}</OBITabsTrigger>
          <OBITabsTrigger value="resolved">Resolved{resolved.length ? ` (${resolved.length})` : ""}</OBITabsTrigger>
        </OBITabsList>
        <OBITabsContent value="open">
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
            {items.length === 0 ? (
              <OBIEmptyState
                icon="circle-check"
                title="Inbox zero"
                description="Every transaction is categorized. AI will ask here when it needs your input."
              />
            ) : items.map((item) => (
              <OBIReviewItem
                key={item.id}
                counterparty={item.counterparty}
                date={item.date}
                account={item.account}
                amount={item.amount}
                question={item.question}
                options={item.options}
                onChoose={(choice) => resolve(item, choice)}
                onSkip={() => resolve(item, "Skipped")}
              />
            ))}
          </div>
        </OBITabsContent>
        <OBITabsContent value="resolved">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {resolved.length === 0 ? (
              <OBIEmptyState icon="inbox" title="Nothing resolved yet" description="Answered questions appear here with the category you chose." />
            ) : resolved.map((item) => (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--surface-card)" }}>
                <span style={{ fontWeight: 500, fontSize: "var(--text-sm)" }}>{item.counterparty}</span>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", fontFamily: "var(--font-figures)" }}>{item.date}</span>
                <span style={{ flex: 1 }}></span>
                <OBIBadge variant={item.choice === "Skipped" ? "secondary" : "positive"} icon={item.choice === "Skipped" ? "clock-3" : "circle-check"}>{item.choice}</OBIBadge>
              </div>
            ))}
          </div>
        </OBITabsContent>
      </OBITabs>
    </div>
  );
}

window.OBInbox = OBInbox;
