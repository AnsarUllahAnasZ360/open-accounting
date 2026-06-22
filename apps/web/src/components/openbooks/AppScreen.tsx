"use client";

import { DashboardScreen, InboxScreen, TransactionsScreen } from "@/components/openbooks/CoreScreens";
import { PayrollScreen } from "@/components/openbooks/ModuleScreens";
import { ContactsScreen } from "@/components/openbooks/ContactsScreen";
import { ExpensesScreen } from "@/components/openbooks/ExpensesScreen";
import { IncomeScreen } from "@/components/openbooks/IncomeScreen";
import { EmptyState } from "@/components/openbooks/primitives";
import { SectionInsights } from "@/components/openbooks/InsightsScreen";
import { ReportsScreen } from "@/components/openbooks/ReportsScreen";
import { SettingsScreen } from "@/components/openbooks/SettingsScreen";
import { useActiveScope } from "@/lib/openbooks/active-entity";
import { defaultSubtabId, usesPinnedShell } from "@/lib/openbooks/section-subtabs";
import { cn } from "@/lib/utils";

// Sections that render a real portfolio (scope='all') surface themselves. Keep
// mutation-heavy review flows out of this list until their write paths can route
// each action to the correct source business.
const PORTFOLIO_AWARE_SECTIONS = new Set(["dashboard", "reports"]);

// Only the serializable fields of a route are needed here. The icon (a function
// component) is intentionally NOT part of this type: a Server Component renders
// this Client Component and React forbids passing functions across that boundary.
export type ScreenRoute = {
  href: string;
  label: string;
  summary: string;
};

// Bills (AP) is NOT a top-level route — it lives as the Expenses → Bills sub-tab
// and the bare /bills URL server-redirects to /expenses/bills (app/bills/page).
const KNOWN_ROUTES = [
  "/dashboard",
  "/inbox",
  "/transactions",
  "/income",
  "/expenses",
  "/contacts",
  "/payroll",
  "/reports",
  "/settings",
];

// The cash-movement default screen for each operational section. The driver
// renders this for the default sub-tab; the Insights sub-tab renders
// SectionInsights instead. `subsection` lets a section with a ledger sub-tab
// (Income → Invoices) dispatch on the active tab while keeping one screen.
function SectionDefaultScreen({ section, subsection }: { section: string; subsection?: string }) {
  switch (section) {
    case "dashboard":
      return <DashboardScreen />;
    case "inbox":
      return <InboxScreen />;
    case "transactions":
      return <TransactionsScreen />;
    case "income":
      return <IncomeScreen subsection={subsection} />;
    case "expenses":
      return <ExpensesScreen subsection={subsection} />;
    case "contacts":
      return <ContactsScreen />;
    case "payroll":
      return <PayrollScreen subsection={subsection} />;
    case "reports":
      return <ReportsScreen />;
    default:
      return null;
  }
}

export function AppScreen({
  route,
  settingsSection,
  subsection,
}: {
  route: ScreenRoute;
  settingsSection?: string;
  /** The active sub-tab slug for an operational section (null = default tab). */
  subsection?: string;
}) {
  const { scope } = useActiveScope();

  if (route.href === "/settings") {
    return (
      <div className="flex w-full flex-col gap-5">
        <SettingsScreen section={settingsSection} />
      </div>
    );
  }

  const section = route.href.slice(1);
  const defaultTab = defaultSubtabId(section);
  const activeSubtab = subsection ?? defaultTab ?? section;
  const isInsightsTab = activeSubtab === "insights";

  // Portfolio guard (E5-T8): a section that can't aggregate across businesses
  // must not render a single entity's data while the switcher reads "All
  // businesses". Dashboard/Reports self-handle scope; everything else (incl. any
  // section's Insights tab) shows an explicit "pick a business" notice.
  const portfolioUnsupported =
    scope === "all" && (isInsightsTab || !PORTFOLIO_AWARE_SECTIONS.has(section));

  // The fixed/scroll pinned frame applies to surfaces built on the
  // fixed-header / scroll-body contract. This is now a config capability flag
  // (usesPinnedShell) instead of a hardcoded route allowlist, so every section
  // that adopts the shared WorkbenchSurface driver (Transactions, Inbox, and
  // now Income's cash + invoices tables) inherits the same bounded frame. The
  // Insights sub-tab always page-scrolls regardless.
  const usesPinnedWorkbench = !isInsightsTab && !portfolioUnsupported && usesPinnedShell(section);

  const body = portfolioUnsupported ? (
    <EmptyState
      title="Pick a business to see this"
      description={`"${route.label}" shows one business at a time. Switch from "All businesses" to a single business — or open the Dashboard or Reports for the combined portfolio view.`}
    />
  ) : isInsightsTab ? (
    <SectionInsights section={section} />
  ) : (
    <SectionDefaultScreen section={section} subsection={activeSubtab} />
  );

  const unknown = !KNOWN_ROUTES.includes(route.href);

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-4",
        // The pinned workbench frame: a bounded viewport-height column so the
        // section's own header/toolbar stay fixed and only the table body
        // scrolls. Lifted here from the old per-route inline frame so it can
        // apply to every section built on the fixed/scroll contract.
        usesPinnedWorkbench ? "h-[calc(100dvh-5.5rem)] min-h-0 overflow-hidden" : null,
      )}
    >
      <div
        className={cn(
          "w-full",
          usesPinnedWorkbench
            ? "min-h-0 flex-1 overflow-hidden"
            : "flex flex-col gap-5",
        )}
      >
        {unknown ? (
          <EmptyState
            title={`${route.label} is queued for the next milestone`}
            description="This shell route is ready; the section-specific ledger workflows land in a later epic."
          />
        ) : (
          body
        )}
      </div>
    </div>
  );
}
