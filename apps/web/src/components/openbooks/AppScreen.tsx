import { AccountingPanel } from "@/components/openbooks/AccountingPanel";
import { DashboardScreen, InboxScreen, TransactionsScreen } from "@/components/openbooks/CoreScreens";
import { DemoDataPanel } from "@/components/openbooks/DemoDataPanel";
import { LeadsPanel } from "@/components/openbooks/LeadsPanel";
import { CategoryChip, EmptyState, PageHeader } from "@/components/openbooks/primitives";
import type { AppRoute } from "@/lib/openbooks/content";

export function AppScreen({ route }: { route: AppRoute }) {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Acme Studio LLC"
        title={route.label}
        description={route.summary}
        actions={<CategoryChip active label="Demo entity" />}
      />

      {route.href === "/dashboard" ? <DashboardScreen /> : null}
      {route.href === "/inbox" ? <InboxScreen /> : null}
      {route.href === "/transactions" ? <TransactionsScreen /> : null}
      {route.href === "/settings" ? (
        <>
          <DemoDataPanel />
          <AccountingPanel />
          <LeadsPanel />
        </>
      ) : null}
      {!["/dashboard", "/inbox", "/transactions", "/settings"].includes(route.href) ? (
        <EmptyState
          title={`${route.label} is queued for the next milestone`}
          description="This shell route is ready; M6 and M7 connect the module-specific ledger workflows."
        />
      ) : null}
    </div>
  );
}
