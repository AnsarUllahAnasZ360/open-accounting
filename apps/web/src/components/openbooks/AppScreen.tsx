import {
  AgingMiniBar,
  Amount,
  CategoryChip,
  ConfidenceRing,
  EmptyState,
  PageHeader,
  ReviewItem,
  Sparkline,
  StatCard,
} from "@/components/openbooks/primitives";
import { LeadsPanel } from "@/components/openbooks/LeadsPanel";
import { accountIcon, bankStatus, emptyStateRows, type AppRoute } from "@/lib/openbooks/content";

export function AppScreen({ route }: { route: AppRoute }) {
  const AccountIcon = accountIcon;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Acme Studio LLC"
        title={route.label}
        description={route.summary}
        actions={<CategoryChip active label="Demo entity" />}
      />

      <section className="grid gap-4 md:grid-cols-3">
        {bankStatus.map((item, index) => (
          <StatCard
            key={item.label}
            detail={item.state}
            icon={AccountIcon}
            label={item.label}
            trend={index === 0 ? "Seed pending" : undefined}
            value={<Amount amountMinor={item.amountMinor} />}
          >
            <Sparkline className="text-primary" data={item.trend} />
          </StatCard>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded-lg border bg-card shadow-xs">
          <div className="border-b px-4 py-3">
            <h2 className="text-base font-semibold">Ledger-backed state</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Posted activity will appear here as soon as the demo books are seeded.
            </p>
          </div>
          <div className="divide-y">
            {emptyStateRows.map(([label, state]) => (
              <div key={label} className="grid gap-1 px-4 py-3 text-sm md:grid-cols-[180px_1fr]">
                <div className="font-medium">{label}</div>
                <div className="text-muted-foreground">{state}</div>
              </div>
            ))}
          </div>
        </div>
        <EmptyState
          title="Ready for posted activity"
          description="Bank, card, invoice, bill, and payroll activity will land here after posting."
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <ReviewItem
          amountMinor={-11842}
          counterparty="Adobe"
          date="Sample"
          options={["Software", "Office expense"]}
          question="I need one confirmation before this item can affect the books."
        />
        <div className="rounded-lg border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Review readiness</h2>
              <p className="mt-1 text-sm text-muted-foreground">Confidence, aging, and exception states are ready for live data.</p>
            </div>
            <ConfidenceRing value={92} />
          </div>
          <div className="mt-5">
            <AgingMiniBar current={68} days30={18} days60={9} days90={5} />
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-card shadow-xs">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold">Connected workflow</h2>
        </div>
        <div className="grid gap-1 px-4 py-3 text-sm md:grid-cols-[180px_1fr]">
          <div className="font-medium">Next activity</div>
          <div className="text-muted-foreground">Money data enters, exceptions route to Inbox, and reports read from posted journal lines.</div>
        </div>
      </section>

      {route.href === "/settings" ? <LeadsPanel /> : null}
    </div>
  );
}
