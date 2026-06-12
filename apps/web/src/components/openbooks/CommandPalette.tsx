"use client";

import { useQuery } from "convex/react";
import {
  BarChart3,
  CircleDollarSign,
  Receipt,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { api } from "../../../../../convex/_generated/api";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { appRoutes, settingsRoute } from "@/lib/openbooks/content";
import { formatMinorMoney } from "@/components/openbooks/primitives";
import { useActiveEntity } from "@/lib/openbooks/active-entity";
import type { Id } from "../../../../../convex/_generated/dataModel";

// The 11 reports the Reports screen knows about. Kept here as a static list so
// the palette can route to them without a backend query (the Reports screen
// builds the same list client-side). Names mirror the report taxonomy.
const REPORT_ACTIONS: Array<{ id: string; name: string; hint: string }> = [
  { id: "monthly-review", name: "Monthly Review", hint: "Overview" },
  { id: "profit-and-loss", name: "Profit & Loss", hint: "Statement" },
  { id: "balance-sheet", name: "Balance Sheet", hint: "Statement" },
  { id: "cash-flow", name: "Cash Flow", hint: "Statement" },
  { id: "ar-aging", name: "AR Aging", hint: "Money owed" },
  { id: "ap-aging", name: "AP Aging", hint: "Money owed" },
  { id: "expenses", name: "Expenses", hint: "Insight" },
  { id: "income-by-customer", name: "Income by Customer", hint: "Insight" },
  { id: "payroll-summary", name: "Payroll Summary", hint: "Insight" },
  { id: "general-ledger", name: "General Ledger", hint: "Accountant" },
  { id: "trial-balance", name: "Trial Balance", hint: "Accountant" },
];

const NAV_ICONS: Record<string, LucideIcon> = {
  "/income": CircleDollarSign,
  "/transactions": WalletCards,
  "/contacts": UsersRound,
  "/reports": BarChart3,
};

export function CommandPalette({
  open,
  onOpenChange,
  enabled,
  canAccessSettings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Only run the data queries while the dialog is (or has been) open, to avoid
  // loading the whole register on every page.
  enabled: boolean;
  canAccessSettings: boolean;
}) {
  const router = useRouter();
  const { activeEntity } = useActiveEntity();

  // Reuse EXISTING queries the screens already load — no new Convex queries or
  // indexes are added by Epic A. Transactions + contacts are filtered client
  // side by cmdk's built-in fuzzy matching.
  const transactionsData = useQuery(
    api.coreViews.transactions,
    enabled
      ? {
          ...(activeEntity.id ? { entityId: activeEntity.id as Id<"entities"> } : {}),
          review: "all",
        }
      : "skip",
  );
  const overview = useQuery(
    api.moduleViews.overview,
    enabled ? (activeEntity.id ? { entityId: activeEntity.id as Id<"entities"> } : {}) : "skip",
  );

  const currency = transactionsData?.entity.currency ?? "USD";

  const transactionItems = useMemo(
    () => (transactionsData?.rows ?? []).slice(0, 50),
    [transactionsData],
  );
  const contactItems = useMemo(
    () => overview?.contacts.rows ?? [],
    [overview],
  );

  type TransactionItem = (typeof transactionItems)[number];
  type ContactItem = (typeof contactItems)[number];

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search transactions, contacts, reports…"
        data-testid="command-palette-input"
      />
      <CommandList data-testid="command-palette-list">
        <CommandEmpty>No matches found.</CommandEmpty>

        <CommandGroup heading="Go to">
          {[...appRoutes, ...(canAccessSettings ? [settingsRoute] : [])].map((route) => {
            const Icon = NAV_ICONS[route.href] ?? route.icon;
            return (
              <CommandItem
                key={route.href}
                value={`nav ${route.label}`}
                onSelect={() => go(route.href)}
              >
                <Icon />
                <span>{route.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Reports">
          {REPORT_ACTIONS.map((report) => (
            <CommandItem
              key={report.id}
              value={`report ${report.name}`}
              onSelect={() => go(`/reports?report=${report.id}`)}
            >
              <BarChart3 />
              <span>{report.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">{report.hint}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        {contactItems.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Contacts">
              {contactItems.slice(0, 12).map((contact: ContactItem) => (
                <CommandItem
                  key={contact.id}
                  value={`contact ${contact.name} ${contact.aliases.join(" ")}`}
                  onSelect={() => go(`/contacts?contact=${contact.id}`)}
                >
                  <UsersRound />
                  <span>{contact.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground capitalize">
                    {contact.roles[0] ?? "contact"}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {transactionItems.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Transactions">
              {transactionItems.map((transaction: TransactionItem) => (
                <CommandItem
                  key={transaction.id}
                  value={`transaction ${transaction.merchant} ${transaction.rawDescription}`}
                  onSelect={() => go(`/transactions?focus=${transaction.id}`)}
                >
                  <Receipt />
                  <span className="truncate">{transaction.merchant}</span>
                  <span className="money-figures ml-auto text-xs text-muted-foreground">
                    {formatMinorMoney(transaction.amountMinor, { currency })}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {/* TODO(backend follow-up): the palette filters EXISTING client data
            (first ~50 register rows + loaded contacts). A server-side search
            index over transactions/contacts (Epic A4 plan note / Epic G) would
            let it search the full dataset rather than what a screen already
            loaded. */}
      </CommandList>
    </CommandDialog>
  );
}
