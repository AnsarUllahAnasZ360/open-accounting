import {
  BarChart3,
  Building2,
  CircleDollarSign,
  Inbox,
  Landmark,
  LayoutDashboard,
  PieChart,
  Settings,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

export type AppRoute = {
  href: string;
  label: string;
  icon: LucideIcon;
  summary: string;
};

// Primary navigation, in the exact order of the prototype shell
// (OpenBook - Prototype/OpenBooks.dc.html): Dashboard · Inbox · Transactions ·
// Income · Expenses · Bills · Contacts · Payroll · Reports. Settings is rendered
// separately after a divider in the sidebar, so it lives in `settingsRoute`.
export const appRoutes: AppRoute[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    summary: "Business at a glance, with cash, profit, inbox, AR, AP, and activity.",
  },
  {
    href: "/inbox",
    label: "Inbox",
    icon: Inbox,
    summary: "The exception queue for low-confidence categories, matches, and questions.",
  },
  {
    href: "/transactions",
    label: "Transactions",
    icon: WalletCards,
    summary: "The register for bank, card, Stripe, CSV, manual, split, and excluded items.",
  },
  {
    href: "/income",
    label: "Income",
    icon: CircleDollarSign,
    summary: "Money in: payments received, invoices out, and what's still owed.",
  },
  {
    href: "/expenses",
    label: "Expenses",
    icon: PieChart,
    summary: "Where money goes — settled spend, vendor bills (AP), and recurring costs.",
  },
  {
    href: "/contacts",
    label: "Contacts",
    icon: UsersRound,
    summary: "Customers, vendors, aliases, balances, and transaction history.",
  },
  {
    href: "/payroll",
    label: "Payroll",
    icon: Building2,
    summary: "Employees, monthly runs, FX rates, settlement, and statement exports.",
  },
  {
    href: "/reports",
    label: "Reports",
    icon: BarChart3,
    summary: "Monthly Review, P&L, Balance Sheet, Cash Flow, aging, GL, and Trial Balance.",
  },
];

export const settingsRoute: AppRoute = {
  href: "/settings",
  label: "Settings",
  icon: Settings,
  summary: "Businesses, connections, rules, AI, accounting, audit log, and exports.",
};

// Every route the section dispatcher must resolve (primary nav + settings).
export const allAppRoutes: AppRoute[] = [...appRoutes, settingsRoute];

export const mobileRoutes = appRoutes.filter((route) =>
  ["/dashboard", "/inbox", "/transactions"].includes(route.href),
);

export const trustItems = [
  "AI proposes, but the ledger engine posts.",
  "Reports query journal lines, not dashboard totals.",
  "Uncertain items wait in the Inbox before they affect the books.",
];

export const landingMetrics = [
  { label: "Trial balance", value: "$0.00", note: "Every posted entry must balance." },
  { label: "Autonomy", value: "90%", note: "Default threshold before auto-posting." },
  { label: "Data owner", value: "You", note: "Exportable books and bring-your-own keys." },
];

export const emptyStateRows = [
  ["Ledger state", "Waiting for M3 ledger core"],
  ["Demo data", "Arrives in M4 through postEntry"],
  ["Live sync", "Plaid and Stripe connect in M8 and M9"],
];

export const bankStatus = [
  { label: "Mercury Checking", amountMinor: 0, state: "Ready for seed", trend: [0, 1, 1, 2, 3, 3, 4] },
  { label: "Stripe Clearing", amountMinor: 0, state: "Created in M8", trend: [0, 0, 1, 1, 1, 2, 2] },
  { label: "Credit card", amountMinor: 0, state: "Created by feed", trend: [0, 1, 0, 1, 2, 1, 2] },
];

export const accountIcon = Landmark;
