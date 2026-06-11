import { AccountingPanel } from "@/components/openbooks/AccountingPanel";
import { DashboardScreen, InboxScreen, TransactionsScreen } from "@/components/openbooks/CoreScreens";
import { DemoDataPanel } from "@/components/openbooks/DemoDataPanel";
import { LeadsPanel } from "@/components/openbooks/LeadsPanel";
import { BillsScreen, ContactsScreen, InvoicesScreen, PayrollScreen, RemainingSettingsScreens } from "@/components/openbooks/ModuleScreens";
import { CategoryChip, EmptyState, PageHeader } from "@/components/openbooks/primitives";
import { ReportsScreen } from "@/components/openbooks/ReportsScreen";
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
      {route.href === "/invoices" ? <InvoicesScreen /> : null}
      {route.href === "/bills" ? <BillsScreen /> : null}
      {route.href === "/contacts" ? <ContactsScreen /> : null}
      {route.href === "/payroll" ? <PayrollScreen /> : null}
      {route.href === "/reports" ? <ReportsScreen /> : null}
      {route.href === "/settings" ? (
        <>
          <DemoDataPanel />
          <AccountingPanel />
          <RemainingSettingsScreens />
          <LeadsPanel />
        </>
      ) : null}
      {![
        "/dashboard",
        "/inbox",
        "/transactions",
        "/invoices",
        "/bills",
        "/contacts",
        "/payroll",
        "/reports",
        "/settings",
      ].includes(route.href) ? (
        <EmptyState
          title={`${route.label} is queued for the next milestone`}
          description="This shell route is ready; M7 connects the report-specific ledger workflows."
        />
      ) : null}
    </div>
  );
}
