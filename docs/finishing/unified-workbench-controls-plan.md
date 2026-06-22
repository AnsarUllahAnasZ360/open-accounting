# Unified Workbench Controls Plan

## Mission

Make Transactions, Income, Expenses, Bills, Contacts, and Payroll feel like one
OpenBooks workspace instead of six separately designed pages. The owner should
learn one control pattern: search, period, filters, sort/display controls, table
selection, pagination, and page actions always live in predictable places.

## Live/Product Audit

- Transactions had the clearest problem: too many permanent option pills in one
  horizontal row. On desktop it reads as noise; on smaller screens it risks
  overflow and makes the ledger table feel secondary.
- Income was using a bespoke period select and page action row while Expenses,
  Bills, and Contacts had started moving to the shared workbench components.
- Payroll had a period selector, KPI strip, tabs, and table, but the selector sat
  in a different pattern from the financial modules.
- The shared `workbench` layer already existed. The safest product move is to
  strengthen that layer rather than create another design system.

## Design System Decision

The new pattern is a ledger workbench:

```text
Page header / shell action area
  Primary action | export/import | module-specific action

Stats strip
  Visible by default; owner can hide it to make the table the primary surface.

Control shelf
  Search | Date/period | entity/account/vendor/status selectors | Filter button
  Active filter chips

Table workspace
  Display/sort row | selectable ledger table | pagination
```

## UI Rules

- Filters collapse into a single `Filter` popover on every viewport. Active
  choices are shown as removable chips below the control shelf.
- Date ranges use presets plus manual from/to entry. The owner can type a custom
  accounting period instead of being trapped in preset windows.
- Tables own row selection, sort, page size, and pagination consistently. Header
  sorting still works, but every table also exposes a visible sort control.
- KPI cards stay visible by default, but a stats toggle lets the owner collapse
  them when they are doing table-heavy review work.
- Page-specific actions remain page-specific, but placement is consistent:
  primary action on the right, secondary actions and exports beside it.

## Implementation Scope

- Upgrade shared controls:
  - `DateRangeControl`
  - `FilterBar`
  - `KpiStrip`
  - `OpenBooksDataTable`
- Add the shadcn `Pagination` primitive and compose it into the shared table.
- Migrate the biggest inconsistency, Income, to the shared date/filter/action
  shelf.
- Let existing Expenses, Bills, Contacts, Payroll, and Transactions benefit from
  the shared component upgrades without rewriting their business logic.

## Acceptance Evidence

- `/transactions` no longer shows the long permanent option strip.
- `/income`, `/expenses`, `/bills`, `/contacts`, and `/payroll` expose the same
  search/filter/table control grammar.
- Tables show row counts, sort controls, row selection where enabled, page-size
  controls, and pagination when rows exceed the page size.
- The app type-checks or clearly reports remaining unrelated type issues.
- Browser verification covers desktop and mobile-width views of the target pages.
