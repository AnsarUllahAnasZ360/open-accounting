# E6 batch A18 — Reports drill-down, compare-to-prior, portfolio, honest banners

Batch A18 closed the remaining E6 (Reports) tickets: **E6-T4, E6-T6, E6-T7,
E6-T9, E6-T10**. Files touched: `convex/reportViews.ts`,
`apps/web/src/components/openbooks/ReportsScreen.tsx`,
`apps/web/src/lib/openbooks/reports-export.ts`,
`apps/web/src/components/openbooks/workbench/page-insights.ts`, plus tests.

## E6-T4 — Universal number → drill-down
Every money figure across the 12 reports now drills to its journal lines, or is a
documented static exception (the accountant registers — GL/TB/Journal — which
already render the raw lines themselves; comment in `ReportsScreen.tsx` above
`GeneralLedger`).

- Backend (`reportViews.ts`): additive `drillDown: ReportLine[]` now rides on
  AR/AP aging rows (from each contact's open `items`), income-by-customer rows,
  expense-by-vendor rows, and payroll rows (per-run lines). Open invoices/bills
  that haven't posted use a synthetic `makeDocumentDrillLine` so the accrued face
  value stays drillable. All additive — single-entity output is otherwise byte-
  for-byte unchanged.
- UI: cash-flow lines, aging cells (per-bucket + total), income-by-customer
  amounts, top-vendor amounts, and payroll period totals are now `MoneyButton`s
  that open the `DrillSheet`; the sheet total equals the clicked figure.

## E6-T6 — Compare-to-prior columns
`compare != none` runs a second statement pass over the comparison window
(already loaded — every comparison entry is dated ≤ endDate) and stamps an
additive `priorTotalMinor` + `deltaMinor` per account row. `StatementTable`
renders a **Prior** column and a signed **Change** column (quiet — an increase
reads brand-green, never alarm-red). `statementCsv` emits `prior_total` + `delta`
columns when present, so the CSV reconciles to the screen. Compare persists
across report switches (unchanged toolbar ref). New
`report-periods.test.ts` locks the never-future guarantee across many `today`
inputs incl. Jan 1 / Dec 31 / leap day.

## E6-T7 — Portfolio / consolidated scope (verified complete)
`reportPack({ scope: "all" })` consolidates every authorized entity in USD and
eliminates confirmed intercompany pairs (read-time, keyed on
`intercompanyPairId`), surfacing an explicit "Intercompany eliminated: −$X"
line. Single-entity scope is unchanged (Due-from/Due-to intact, no elimination
line). Covered by `convex/reportViews.consolidated.test.ts` (All == Σ −
intercompany; single == self standalone).

## E6-T9 — Honest banners
`TruncationBanner` (new) surfaces `limits.truncated` ("Showing the first 20,000
rows — totals may be incomplete") on the viewer and home, in the warning token
(never alarm-red). `UnreviewedGapBanner` (E1-T8) is wired on viewer + home with
a /inbox link. Both render nothing when their signal is absent.

## E6-T10 — One Reports insight banner + tests + evidence
The Reports home shows exactly ONE small, threshold-gated insight derived from
the already-loaded `homePack` (no new query): aged AR (61+ days) when present,
else the month's net result. Builder registered in the page-insights registry as
`reports` and covered by `tests/page-insights.test.ts` +
`reports-insight.test.ts`.

E2E (`tests/e2e/reports.spec.ts`) gained: cash-flow no-overflow at 375px (pre-
existing), P&L + cash-flow drill parity (drill-total == clicked), compare prior/
change column visibility, the single reports insight banner (≤1), and a cash-
flow CSV export-parity smoke (saved to
`2026-06-20-E6-cash-flow-export.csv`). Basis-badge cash-toggle assertion pre-
existing.

## Gates
`pnpm verify` (typecheck + lint + build + 426 unit tests) green; `npx convex dev
--once` typechecked + pushed clean.
