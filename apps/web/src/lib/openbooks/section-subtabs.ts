// The per-section sub-tab registry (Epic E0.3 / E0.5). Kept in a plain
// (non-"use client") module — analogous to `settings-sections.ts` — so the
// server-side `generateStaticParams` for /[section]/[subsection] can import the
// real array. Importing it from a "use client" screen would turn it into a
// client-reference proxy at build time (`.map is not a function`).
//
// Order is the canonical [cash-movement -> AR/AP -> Insights] (Insights always
// last; the cash-movement tab is the default and is reachable at the bare
// /[section] URL, NOT at a /[section]/<slug> sub-route).

export type SectionSubtabKind = "cash-movement" | "ledger" | "insights";

export type SectionSubtab = {
  /** URL slug under the section, e.g. "invoices" => /income/invoices. */
  id: string;
  label: string;
  /** Quiet subtitle disambiguating AR/AP from cash flow. */
  subtitle?: string;
  kind: SectionSubtabKind;
  /**
   * The default sub-tab is the section's cash-movement tab. It renders at the
   * bare /[section] URL and is intentionally excluded from generateStaticParams
   * for the /[section]/[subsection] route (so /income and /income/income don't
   * both resolve).
   */
  isDefault?: boolean;
};

export type SectionSubtabConfig = {
  /** Top-level section slug (matches the nav href without the leading slash). */
  section: string;
  subtabs: ReadonlyArray<SectionSubtab>;
};

// Operational sections that carry child destinations under their sidebar parent.
// Dashboard, Inbox, Reports, and Settings are not here: Settings owns its own
// /settings sub-routes, and the others are single-surface today.
export const SECTION_SUBTABS: ReadonlyArray<SectionSubtabConfig> = [
  {
    section: "transactions",
    subtabs: [
      { id: "transactions", label: "Transactions", kind: "cash-movement", isDefault: true },
      { id: "insights", label: "Insights", kind: "insights" },
    ],
  },
  {
    section: "income",
    subtabs: [
      {
        id: "income",
        label: "Income",
        subtitle: "Money received",
        kind: "cash-movement",
        isDefault: true,
      },
      { id: "invoices", label: "Invoices", subtitle: "Accounts receivable", kind: "ledger" },
      { id: "insights", label: "Insights", kind: "insights" },
    ],
  },
  {
    section: "expenses",
    subtabs: [
      {
        id: "expenses",
        label: "Expenses",
        subtitle: "Money spent",
        kind: "cash-movement",
        isDefault: true,
      },
      { id: "bills", label: "Bills", subtitle: "Accounts payable", kind: "ledger" },
      { id: "insights", label: "Insights", kind: "insights" },
    ],
  },
  {
    section: "contacts",
    subtabs: [
      { id: "contacts", label: "Contacts", kind: "cash-movement", isDefault: true },
      { id: "insights", label: "Insights", kind: "insights" },
    ],
  },
  {
    section: "payroll",
    subtabs: [
      { id: "runs", label: "Runs", kind: "cash-movement", isDefault: true },
      { id: "people", label: "People", subtitle: "Team roster", kind: "ledger" },
      { id: "statements", label: "Statements", subtitle: "Payroll reports", kind: "ledger" },
      { id: "insights", label: "Insights", kind: "insights" },
    ],
  },
];

// Sections whose cash-movement / ledger tabs are built on the fixed-header /
// scroll-body workbench shell (the bounded viewport-height frame where only the
// table body scrolls). This replaces AppScreen's old hardcoded
// /transactions|/inbox allowlist with a capability flag, so any section that
// adopts the shared WorkbenchSurface driver inherits the same pinned frame
// (E0/E2/E4 seam). Income's cash + invoices, Expenses' cash + bills, and the
// Contacts directory all render through the driver in this pinned frame.
const PINNED_SHELL_SECTIONS: ReadonlySet<string> = new Set([
  "transactions",
  "inbox",
  "income",
  "expenses",
  "contacts",
]);

/** Whether a section's cash-movement / ledger tabs use the pinned fixed/scroll
 * workbench shell (vs. a normally page-scrolling section). The Insights sub-tab
 * always page-scrolls regardless of this flag. */
export function usesPinnedShell(section: string): boolean {
  return PINNED_SHELL_SECTIONS.has(section);
}

export function getSectionSubtabs(section: string): ReadonlyArray<SectionSubtab> {
  return SECTION_SUBTABS.find((entry) => entry.section === section)?.subtabs ?? [];
}

/** The default (cash-movement) sub-tab id for a section, or null if none. */
export function defaultSubtabId(section: string): string | null {
  const subtabs = getSectionSubtabs(section);
  return subtabs.find((tab) => tab.isDefault)?.id ?? subtabs[0]?.id ?? null;
}

/** Whether a section has a registered sub-tab bar at all. */
export function hasSectionSubtabs(section: string): boolean {
  return getSectionSubtabs(section).length > 0;
}

/** Whether `subsection` is a NON-default sub-route slug for `section`. */
export function isValidSubsection(section: string, subsection: string): boolean {
  return getSectionSubtabs(section).some((tab) => tab.id === subsection && !tab.isDefault);
}
