"use client";

import { AccountingPanel } from "@/components/openbooks/AccountingPanel";
import { DashboardScreen, InboxScreen, TransactionsScreen } from "@/components/openbooks/CoreScreens";
import { DemoDataPanel } from "@/components/openbooks/DemoDataPanel";
import { LeadsPanel } from "@/components/openbooks/LeadsPanel";
import { BillsScreen, ContactsScreen, PayrollScreen, RemainingSettingsScreens } from "@/components/openbooks/ModuleScreens";
import { ExpensesScreen } from "@/components/openbooks/ExpensesScreen";
import { IncomeScreen } from "@/components/openbooks/IncomeScreen";
import { CategoryChip, EmptyState, PageHeader } from "@/components/openbooks/primitives";
import { ReportsScreen } from "@/components/openbooks/ReportsScreen";
import { useActiveEntity } from "@/lib/openbooks/active-entity";

// Only the serializable fields of a route are needed here. The icon (a function
// component) is intentionally NOT part of this type: a Server Component renders
// this Client Component and React forbids passing functions across that boundary.
export type ScreenRoute = {
  href: string;
  label: string;
  summary: string;
};

const KNOWN_ROUTES = [
  "/dashboard",
  "/inbox",
  "/transactions",
  "/income",
  "/expenses",
  "/bills",
  "/contacts",
  "/payroll",
  "/reports",
  "/settings",
];

export function AppScreen({ route }: { route: ScreenRoute }) {
  const { activeEntity } = useActiveEntity();

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={activeEntity.name}
        title={route.label}
        description={route.summary}
        actions={activeEntity.isDemo ? <CategoryChip active label="Demo entity" /> : null}
      />

      {route.href === "/dashboard" ? <DashboardScreen /> : null}
      {route.href === "/inbox" ? <InboxScreen /> : null}
      {route.href === "/transactions" ? <TransactionsScreen /> : null}
      {route.href === "/income" ? <IncomeScreen /> : null}
      {route.href === "/expenses" ? <ExpensesScreen /> : null}
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
      {!KNOWN_ROUTES.includes(route.href) ? (
        <EmptyState
          title={`${route.label} is queued for the next milestone`}
          description="This shell route is ready; the section-specific ledger workflows land in a later epic."
        />
      ) : null}
    </div>
  );
}
