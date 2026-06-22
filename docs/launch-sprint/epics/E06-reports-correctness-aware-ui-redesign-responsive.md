# E6 — Reports — correctness-aware UI, redesign, responsiveness, export parity & drill-down

> Part of the **OpenBooks Launch Sprint**. Master plan: [../README.md](../README.md) · Backlog: [../backlog.md](../backlog.md)

**Goal.** Turn the Reports surface into a ledger-grade, mobile-correct, fully drillable reporting product: fix the broken/overflowing Cash Flow layout, redesign the report home + viewer for clarity with tabular figures, guarantee CSV exports byte-match what's on screen, make every number a drill target, clarify cash⇄accrual basis labeling, ship period presets that never go future plus compare-to-prior, add a portfolio/consolidated report mode that ELIMINATES intercompany (coordinated with E5), give every report honest empty/loading/error/truncation states, and surface the "unreviewed/excluded $X" gap so reports never silently understate. The general ledger is USD-only (decided: see decisions.md Q32) — no multi-currency reporting, no per-currency breakdowns, no base-currency engine. This epic owns Reports UI/UX + export only; the underlying posting/reconciliation correctness (RC1–RC7) is owned by E1 — E6 must render and label whatever E1 produces honestly.

**Why it matters.** Ansar explicitly dislikes the current Reports UI and says the Cash Flow report is broken and not responsive. Reports are the screen an owner actually uses to decide whether the business is healthy — if cash flow overflows on a phone, if a number can't be drilled to its transactions, if the CSV he hands his accountant disagrees with what he saw, or if the report silently hides ~78% of his real transactions, he can't trust the product and won't run his books on it. A reporting layer that is clear, responsive, exportable-with-parity, drillable, and honest about what it's excluding is the difference between a demo and a tool a small-business owner bets his books on. The portfolio report mode is his #1 multi-LLC ask: see Zikra + Z360 combined by default, drop into one when needed.

## Current state

Reports are rendered by a single 1788-line client component apps/web/src/components/openbooks/ReportsScreen.tsx and a Convex read model convex/reportViews.ts (974 lines); CSV export lives in apps/web/src/lib/openbooks/reports-export.ts (512 lines); period math in apps/web/src/lib/openbooks/report-periods.ts. Confirmed problems grounded in code: (1) CASH FLOW LAYOUT — CashFlow() at ReportsScreen.tsx:895-956 uses a fixed two-column grid `xl:grid-cols-[1.4fr_1fr]` with a fixed-height `h-36` bar bridge and no isMobile branch (unlike StatementTable/GeneralLedger/TrialBalance which all take isMobile); the bridge bars use `Math.max(4,(abs/maxBar)*100)%` heights and per-step labels that crowd/overflow on narrow widths; cash-flow rows render memos with `truncate` but the whole section has no min-w-0 inner-scroll fallback, so on a phone the chart panel squeezes. (2) CSV PARITY GAPS — reports-export.ts builds CSVs independently of the on-screen tables: balance-sheet CSV (343-359) re-runs statementCsv on `pack.balanceSheet.rows` but the screen renders `sections` (BalanceSheet at 863-893); cash-flow CSV (360-374) emits only group TOTALS, omitting the per-row line items the screen shows; income-by-customer/expenses CSV omit the % share / vendor split nuances; columns (monthly/quarterly) appear on screen but reportCsv only includes them for statement reports via statementCsv columnLabels — so CSV ≠ screen for several reports. (3) DRILL COVERAGE — MoneyButton/DrillSheet exist (615-641, 553-611) and StatementTable wires drill, but CashFlow rows (895), AgingReport cells (958-1020), IncomeByCustomer rows (1057-1093), PayrollSummary rows (1101), GeneralLedger/TrialBalance/Journal numbers are NOT drillable. (4) BASIS LABEL — basis toggle exists (505-537) with a tooltip, but report headers print raw `pack.controls.basis` ("accrual"/"cash") un-titlecased (e.g. ProfitAndLoss subtitle at 816); there's no persistent "Cash basis — open invoices/bills excluded" badge on the body, and balance-sheet/aging don't show which basis produced them. (5) PRESETS/COMPARE — report-periods.ts presets are correctly clamped to never-future and compareRange exists in reportViews.ts:431-445, but the UI only renders a passive ComparePanel text line (829-837) — no side-by-side prior column or delta. (6) EMPTY/LOADING/ERROR — loading is a bare "Loading {name}…" line (1755-1756); empty uses generic EmptyState only inside StatementTable/GeneralLedger; there is NO error boundary (a thrown query e.g. start>end at reportViews.ts:457 surfaces as a blank/crash), and the `limits.truncated` flag (reportViews.ts:913-918, the RC5 .take(5000) cap at :492-501) is computed but NEVER shown to the user. (7) UNREVIEWED GAP — RC1 (~78% unposted, entryId:null) and the basis-exclusion of open invoices/bills mean reports understate; the blueprint (RC1, Phase-1 item 4) mandates a "$X unreviewed/excluded" banner on every report — it does not exist. (8) PORTFOLIO — getEntity (reportViews.ts:34-57) resolves exactly ONE entity (demo-slug fallback); there is no "All businesses" consolidated report path, and no read-time intercompany elimination. (9) The ledger is USD-only (decided: see decisions.md Q32) — the prior multi-currency concern at reportViews.ts:303 is moot: E1 locks entity currency to USD and drops the dead fxRate field, so there is no FX to label and no mixed-currency sums to guard against in reports.

## Definition of done (epic)

- [ ] Cash Flow report renders with zero horizontal page overflow at 375px, 768px, and 1280px widths (Playwright viewport screenshots prove no body scrollbar and no clipped bars), and has a dedicated mobile stacked layout like the other reports.
- [ ] Report home grid and every report viewer use tabular figures (money-figures), ledger surfaces, and pass the design-rule lint (no gradients/purple/emoji), verified by a visual screenshot pack across all 12 reports at mobile + desktop.
- [ ] For all 12 reports, the exported CSV's data rows are a superset of and reconcile to the on-screen numbers: an automated test parses each report's CSV and asserts every on-screen section total and line total appears in the CSV (cash-flow per-row line items included, balance-sheet section rows included).
- [ ] Every rendered money figure across all 12 reports is either a drill target (opens DrillSheet showing the journal lines whose sum equals the clicked number) or explicitly documented as non-drillable; an e2e test clicks a number in P&L, Cash Flow, Aging, Income-by-Customer, GL and asserts the DrillSheet total equals the clicked value.
- [ ] Each applicable report body shows a persistent basis badge ('Accrual basis' / 'Cash basis — open invoices & bills excluded') and the toggle persists across report switches; a test toggles to Cash and asserts the badge text and that open-AR/AP are excluded.
- [ ] Period preset selector offers This month/Last month/This quarter/YTD/Last 12/Custom, the custom date inputs cannot pick a future date (max=today), and a compare-to-prior mode renders prior-period values alongside current with a signed delta (not just the ComparePanel text); unit tests on report-periods cover no-future clamping.
- [ ] Reports support a portfolio/'All businesses' scope that consolidates entities in USD (coordinated with E5's scope switcher) and ELIMINATES intercompany transfers between the owner's own entities, showing an explicit 'Intercompany eliminated: −$X' line (decided: see decisions.md Q33); a test selecting 'All' renders combined USD totals equal to the sum of per-entity packs minus eliminated intercompany pairs, and selecting a single entity returns that entity's standalone pack (Due-from/Due-to intact).
- [ ] Each report has distinct loading skeleton, empty state (report-specific copy), and error state; forcing the start>end error path renders a friendly inline error, not a crash, verified by a test.
- [ ] A truncation/unreviewed banner appears on the report when limits.truncated is true OR when unposted/excluded amounts exist, stating the excluded count/amount; verified by a test that seeds >REPORT_LIMIT rows or unposted txns and asserts the banner.
- [ ] Full gate passes: pnpm -w typecheck, pnpm -w lint, pnpm -w build, the reportViews vitest suite, and tests/e2e/reports*.spec.ts all green.

## Tickets (10)

### E6-T1 — Fix Cash Flow report responsiveness — kill horizontal overflow, add mobile stacked layout
`size: M` · `risk: low` · `depends on: —`

**Intent.** The owner-reported blocker: the Cash Flow report is 'broken/not responsive'. Make it render cleanly mobile→desktop with no horizontal overflow and a real phone layout, matching how the other reports already branch on isMobile.

**Changes**

- In ReportsScreen.tsx CashFlow() (lines 895-956), thread the existing `isMobile` prop down (it is computed in ReportsScreen via useIsMobile() and already passed to ProfitAndLoss/BalanceSheet/GeneralLedger/TrialBalance — add it to the CashFlow case in ActiveReport at line 1500-1501).
- Replace the unconditional `grid gap-4 xl:grid-cols-[1.4fr_1fr]` (line 905) with a responsive stack: single column by default, two columns only at xl; wrap both sections in `min-w-0` so the inner table/chart can shrink instead of forcing page overflow.
- Add an isMobile branch for the cash-flow group rows (currently lines 913-924): on mobile render a stacked label-over-amount card list (date · memo on one line, signed Amount below/right) instead of a justify-between row that truncates the memo to nothing on a phone.
- Make the opening→closing bar bridge (lines 932-952) responsive: cap the fixed `h-36` with a max, allow the bridge to horizontally inner-scroll within its own `overflow-x-auto min-w-0` container (NOT the page) when there are many steps, and shrink the per-step `text-[10px]` labels gracefully; hide or collapse the bridge panel below a breakpoint if it cannot render legibly, showing the numeric Opening/Net/Closing summary instead.
- Ensure the outer report container keeps `min-w-0` so the section never widens the page (the screen root already has min-w-0 at line 1713; verify CashFlow's children inherit it).

**Files:** `apps/web/src/components/openbooks/ReportsScreen.tsx:895-956 (CashFlow)`, `apps/web/src/components/openbooks/ReportsScreen.tsx:1500-1501 (ActiveReport cash-flow case)`, `apps/web/src/components/openbooks/ReportsScreen.tsx:188-208 (ACCENT_BG, PreviewViz reused by bridge)`

**Definition of done**

- [ ] At 375px width the Cash Flow report shows no horizontal page scrollbar and no clipped/overlapping bridge bars (Playwright: document.scrollingElement.scrollWidth <= clientWidth).
- [ ] At 375px the cash-flow group rows render as a readable stacked list with full memo, not a single truncated line.
- [ ] At 1280px the two-column operating-list + bridge layout still renders as before (no visual regression vs current desktop).
- [ ] CashFlow receives and uses an isMobile prop (typecheck passes with the new prop).

**Deliverables:** Edited ReportsScreen.tsx CashFlow component + ActiveReport wiring; Playwright screenshots at 375/768/1280 attached as evidence; Optional: a small e2e assertion on scrollWidth<=clientWidth for /reports?report=cash-flow

**Verify.** pnpm -w typecheck && pnpm -w lint; run the app, open /reports?report=cash-flow at 375px/768px/1280px (agent-browser skill), assert no body horizontal scroll and screenshot each; run tests/e2e/reports.spec.ts.

### E6-T2 — Redesign report home grid + viewer chrome for ledger-grade clarity and responsiveness
`size: M` · `risk: low` · `depends on: E6-T1`

**Intent.** Ansar dislikes the Reports UI broadly. Refresh the report-home catalogue and the shared viewer chrome (back bar, toolbar wrap, headers) so the surface reads like a clean ledger product and the toolbar never overflows on mobile.

**Changes**

- Refine ReportsHome (lines 335-361) and REPORT_GROUPS cards: keep the white card + PreviewViz language but tighten typography to tabular/quiet, ensure the grid `sm:grid-cols-2 xl:grid-cols-3` collapses to one column cleanly on phones, and make the whole card a proper button with visible focus (already a button — verify a11y label includes name+description so existing e2e role queries still match).
- Make ViewerToolbar (lines 384-549) wrap gracefully on mobile: the current `flex flex-wrap items-end gap-3` puts Range/Start/End/Compare/Columns/basis/Explain/Export in one row — on a phone this overflows. Group controls into a responsive layout (controls stack, action buttons (Explain/Export) move to their own row), and ensure fixed `w-40`/`w-36`/`w-32` selects become full-width on mobile.
- Standardize ReportHeader (lines 839-849) across all reports to a consistent title + subtitle + optional chip pattern with tabular money in chips; ensure subtitles use the new basis badge from E6-T5 rather than raw `pack.controls.basis`.
- Audit all report bodies for `money-figures` (tabular) class on every numeric cell and the design rules (one brand green, no gradients/purple/emoji); fix any raw teal/amber literals to the chart tokens already established (ACCENT_BG map, lines 188-194).

**Files:** `apps/web/src/components/openbooks/ReportsScreen.tsx:335-361 (ReportsHome)`, `apps/web/src/components/openbooks/ReportsScreen.tsx:142-208 (REPORT_GROUPS, PreviewViz, ACCENT_BG)`, `apps/web/src/components/openbooks/ReportsScreen.tsx:384-549 (ViewerToolbar)`, `apps/web/src/components/openbooks/ReportsScreen.tsx:839-849 (ReportHeader)`

**Definition of done**

- [ ] Report home grid renders one column at 375px, two at 768px, three at 1280px with no overflow; existing e2e role-based card queries in tests/e2e/reports.spec.ts still pass (names unchanged).
- [ ] ViewerToolbar does not overflow horizontally at 375px (controls wrap/stack, action buttons on their own row).
- [ ] No gradient/purple/emoji/raw teal-amber literals remain in ReportsScreen (grep clean); all money cells carry money-figures.
- [ ] Visual screenshot pack of home + 3 representative viewers at mobile+desktop attached.

**Deliverables:** Edited ReportsHome + ViewerToolbar + ReportHeader; Before/after screenshots; grep-clean evidence for design-rule violations

**Verify.** pnpm -w lint && pnpm -w typecheck; agent-browser screenshots at 375/768/1280 of /reports and 3 viewers; tests/e2e/reports.spec.ts green.

### E6-T3 — CSV export ⇄ on-screen parity for all 12 reports + parity test harness
`size: M` · `risk: low` · `depends on: E6-T1`

**Intent.** The accountant-facing CSV must reconcile to exactly what the owner saw. Today several exports diverge (cash-flow omits line items, balance-sheet exports flat rows not sections, columns/% nuances dropped). Make export a faithful serialization of the rendered pack and lock it with an automated parity test.

**Changes**

- In reports-export.ts, fix cash-flow CSV (lines 360-374) to emit per-row line items for each group (date, memo, signed amount_minor/amount) in addition to group totals, plus opening/net/closing — matching what CashFlow renders.
- Fix balance-sheet CSV (lines 343-359) to serialize the SAME `sections` the screen renders (assets/liabilities/equity with their rows), not the flat `pack.balanceSheet.rows`, and include the 'liabilities+equity+earnings' total the screen shows.
- For statement reports (P&L, expenses) ensure column (monthly/quarterly) sub-totals in `row.columns` are exported when columnMode != total (statementCsv already supports columnLabels at line 245 — verify and add tests).
- For income-by-customer add the % share column the screen computes; for expenses ensure both byCategory and byVendor are present (already are — assert in test).
- Write apps/web/src/lib/openbooks/__tests__/reports-export-parity.test.ts: build a deterministic ReportPack fixture, render-equivalent extract of the on-screen totals (reuse the same selectors the components use), generate each report's CSV via reportCsv, parse it, and assert every section/row/line total from the pack appears in the parsed CSV.

**Files:** `apps/web/src/lib/openbooks/reports-export.ts:244-468 (statementCsv/agingCsv/drillCsv/reportCsv)`, `apps/web/src/lib/openbooks/reports-export.ts:63-185 (ReportPack type)`, `apps/web/src/components/openbooks/ReportsScreen.tsx:813-1185 (the report bodies whose numbers must reconcile)`

**Definition of done**

- [ ] Cash-flow CSV contains every per-row line item the screen renders (not just group totals), proven by the parity test.
- [ ] Balance-sheet CSV serializes sections (assets/liabilities/equity) with rows, proven by the parity test.
- [ ] reports-export-parity.test.ts exists and passes for all 12 report ids: every on-screen section total + line total is present in the CSV.
- [ ] No report's CSV is missing a number that appears on screen (test enumerates all 12).

**Deliverables:** Edited reports-export.ts; New apps/web/src/lib/openbooks/__tests__/reports-export-parity.test.ts; Test run output showing 12/12 reports parity-green

**Verify.** pnpm --filter web test (or the repo's vitest invocation) running reports-export-parity.test.ts; spot-check by exporting cash-flow + balance-sheet in-app and diffing against the screen.

### E6-T4 — Universal number→drill-down: make every report figure open its journal lines
`size: L` · `risk: med` · `depends on: E6-T1, E6-T3`

**Intent.** The product promise is 'click any number to see its transactions'. Today only StatementTable numbers drill; Cash Flow rows, Aging cells, Income-by-Customer rows, Payroll rows, GL/TB/Journal numbers do not. Extend MoneyButton + DrillSheet coverage so every figure is auditable.

**Changes**

- Backend (reportViews.ts): ensure each rendered aggregate carries its supporting drillDown ReportLine[] so the UI can show exact lines. Cash-flow groups already carry `rows` (lines 613-643). For arAging/apAging, expose the per-contact `items` already built in buildAgingRows (reportViews.ts:401) so a clicked aging cell can list the invoices/bills behind it. For incomeByCustomer add a per-customer drillDown (the data exists in incomeCustomerTotals loop at 677-732 — attach the contributing lines). For payroll rows attach the run's lines. Keep all additions ADDITIVE to the pack shape (new optional fields), so export and existing consumers don't break.
- UI (ReportsScreen.tsx): wrap Cash Flow row amounts (913-924) in MoneyButton that opens DrillSheet with that line; make AgingReport cells (1006-1011) clickable to show the bucket's invoices/bills; make IncomeByCustomer amounts (1078) drillable; make PayrollSummary period totals (1171) drillable to run lines; in GeneralLedger/TrialBalance/Journal, link the account/entry to its journal lines (TB row → that account's GL lines).
- Extend the reports-export ReportPack type (reports-export.ts:63-185) with the new optional drillDown fields so types stay sound.
- Ensure DrillSheet 'Open in Transactions' handoff (buildDrillHref, lines 106-114) still resolves for the new contexts (income→/income, expense→/expenses, else→/transactions).

**Files:** `apps/web/src/components/openbooks/ReportsScreen.tsx:553-641 (DrillSheet, MoneyButton)`, `apps/web/src/components/openbooks/ReportsScreen.tsx:895-1185 (CashFlow/Aging/IncomeByCustomer/Payroll bodies)`, `convex/reportViews.ts:347-417 (buildAgingRows items)`, `convex/reportViews.ts:613-732 (cashflow groups + customer/vendor totals)`, `apps/web/src/lib/openbooks/reports-export.ts:63-185 (ReportPack type extension)`

**Definition of done**

- [ ] Clicking a Cash Flow line, an Aging cell, an Income-by-Customer amount, and a Payroll period total each opens the DrillSheet, and the DrillSheet total equals the clicked figure (e2e asserts drill-total == clicked value for at least P&L, cash-flow, aging, income-by-customer).
- [ ] All new pack fields are optional/additive (existing reportViews.test.ts and export tests still pass).
- [ ] Every money figure rendered in the 12 reports is either a MoneyButton or intentionally static (documented in a code comment listing the exceptions, e.g. column headers).

**Deliverables:** Edited reportViews.ts (additive drillDown fields); Edited ReportsScreen.tsx drill wiring; Extended ReportPack type; e2e assertions for drill parity across report types

**Verify.** pnpm -w typecheck; convex reportViews vitest green; e2e: open each report, click a number, assert getByTestId('drill-total') equals the clicked amount.

### E6-T5 — Cash⇄accrual basis clarity: persistent basis badge + honest exclusion labeling
`size: S` · `risk: low` · `depends on: E6-T2`

**Intent.** The basis toggle works but the report never states which basis produced the numbers nor that cash-basis silently drops open invoices/bills. Make basis explicit on every applicable report body so the owner is never confused about why two views differ.

**Changes**

- Add a small persistent BasisBadge component in ReportsScreen.tsx that renders 'Accrual basis' or 'Cash basis — open invoices & bills excluded' (title-cased), driven by `pack.controls.basis`.
- Render BasisBadge in the body of every BASIS_BY_REPORT report (set defined at lines 373-381: P&L, balance-sheet, cash-flow, ar/ap-aging, expenses, income-by-customer) — in the ReportHeader chip slot or just under it, replacing the raw lowercased `pack.controls.basis` text currently in subtitles (e.g. ProfitAndLoss line 816).
- When basis=cash, surface the excluded-open-items count/amount inline (reportViews.ts already computes `unsettledEntryIds` at 511-522 that are excluded — expose a small `cashBasisExcluded: {count, amountMinor}` additive field on the pack and show it in the badge tooltip or a one-line note).
- Confirm basis persists across report switches (toolbarTouchedRef already preserves it, lines 1735-1738) and add the basis value to the CSV header (already present at reports-export.ts:250) — verify it reflects the active basis.

**Files:** `apps/web/src/components/openbooks/ReportsScreen.tsx:373-381 (BASIS_BY_REPORT), :816 (raw basis text), :839-861 (ReportHeader/BalancedChip pattern)`, `convex/reportViews.ts:511-522 (unsettledEntryIds), :798-919 (pack assembly to add cashBasisExcluded)`, `apps/web/src/lib/openbooks/reports-export.ts:63-185 (type), :250 (basis header)`

**Definition of done**

- [ ] Each applicable report shows a title-cased basis badge; toggling to Cash changes it to 'Cash basis — open invoices & bills excluded'.
- [ ] When basis=cash and open items exist, the report shows the excluded count/amount (e2e asserts the note appears and matches the AR/AP open totals).
- [ ] Basis label in the exported CSV matches the on-screen basis (parity test from E6-T3 extended to assert basis cell).
- [ ] No raw lowercased 'accrual'/'cash' string remains in any report subtitle.

**Deliverables:** BasisBadge component + wiring across reports; Additive cashBasisExcluded field in reportViews.ts; Updated export/parity assertions

**Verify.** pnpm -w typecheck && lint; e2e toggles basis on P&L and balance-sheet and asserts badge text + exclusion note; reportViews vitest covers cashBasisExcluded.

### E6-T6 — Period presets that never go future + true compare-to-prior columns
`size: M` · `risk: med` · `depends on: E6-T3, E6-T5`

**Intent.** Presets are already clamped never-future (good), but compare-to-prior is only a passive text line. Deliver an actual side-by-side prior-period column with a signed delta so the owner can see the trend, and lock the no-future guarantee with tests.

**Changes**

- UI: replace/augment ComparePanel (ReportsScreen.tsx:829-837) so that when compare != none, the statement tables render a prior-period value column and a signed delta column next to the current total for P&L, expenses, income-by-customer, cash-flow (the COMPARE_BY_REPORT set at lines 365-371).
- Backend: the comparison range is already computed (reportViews.ts compareRange:431-445, returned in controls.comparison). To populate prior values, EITHER (a) have buildReportPackForEntity compute a second statementRows pass over the comparison window and attach `priorTotalMinor` per row (additive), OR (b) issue a second reportPack query for the comparison range in the client and join by account id. Prefer (a) for a single round-trip; keep it additive and behind compare!=none so default packs are unchanged.
- Verify the custom date inputs enforce max=today (already `max={today}` at lines 444/455) and that clampRange (report-periods.ts:126-130) prevents future end; add/extend a report-periods unit test asserting every preset's endDate <= today for several 'today' values including year-boundary cases.
- Ensure compare persists across report switches like basis (toolbarTouchedRef, lines 1739-1742) and that compare columns export to CSV (add prior + delta columns to statementCsv when present).

**Files:** `apps/web/src/components/openbooks/ReportsScreen.tsx:365-371 (COMPARE_BY_REPORT), :471-485 (compare select), :829-837 (ComparePanel), :644-766 (StatementTable to add prior/delta columns)`, `convex/reportViews.ts:431-445 (compareRange), :524-540 (statementRows pass — second pass for prior)`, `apps/web/src/lib/openbooks/report-periods.ts:99-199 (presets/clamp — add tests)`, `apps/web/src/lib/openbooks/reports-export.ts:244-271 (statementCsv prior/delta columns)`

**Definition of done**

- [ ] With compare=priorPeriod or priorYear, P&L/expenses show a prior column and a signed delta per account row, and the comparison range label matches reportViews.compareRange output.
- [ ] A report-periods unit test asserts no preset produces a future endDate across multiple 'today' inputs (incl. Jan 1 and Dec 31), and custom inputs reject future dates (max=today present).
- [ ] Compare columns appear in the exported CSV when active (parity test extended).
- [ ] compare selection persists across report switches.

**Deliverables:** Edited StatementTable + ComparePanel for prior/delta columns; Additive prior-period computation in reportViews.ts; report-periods no-future unit test; CSV columns for prior/delta

**Verify.** pnpm -w typecheck; vitest report-periods + reportViews; e2e sets compare=priorPeriod on P&L and asserts a prior column + delta render.

### E6-T7 — Portfolio / consolidated report scope ('All businesses') with intercompany elimination, wired to E5 scope switcher
`size: L` · `risk: med` · `depends on: E6-T2, E6-T6, E5-T7 (intercompany elimination + intercompanyPairId), E12-T8 (useActiveScope context)`

**Intent.** Ansar's #1 multi-LLC ask: see Zikra + Z360 combined by default, drop into one. Add a consolidated report path so reports honor the All/Zikra/Z360 scope from E5 instead of resolving exactly one entity. The consolidated view ELIMINATES intercompany transfers between the owner's own entities so the unified P&L/balance sheet never double-counts internal money movement (decided: see decisions.md Q33).

**Changes**

- Backend: add a consolidated read path. Today getEntity (reportViews.ts:34-57) resolves ONE entity and buildReportPackForEntity runs per-entity. Add `reportPackForScope` (query) accepting a scope ('all' | entityId): when 'all', resolve all authorized entities in the workspace, build each per-entity pack, and merge — sum statement/cash-flow/aging/trial figures (all USD), concatenate drillDowns, and ELIMINATE intercompany pairs whose BOTH legs are in scope (read-time exclusion keyed on the `intercompanyPairId` E5-T7 lands; NOT stored elimination journals). Keep per-entity legal separation (do not write/merge any ledger data — this is read-only consolidation).
- Surface the elimination honestly: render an explicit 'Intercompany eliminated: −$X' line on the consolidated statement (matching the per-entity Due-from/Due-to that the standalone view keeps on the books). Standalone (single-entity) scope leaves Due-from/Due-to posted and shows no elimination line (decided: see decisions.md Q33).
- Coordinate with E5 + E12: consume the same scope source E12-T8's `useActiveScope()` context exposes and E5 reads (apps/web/src/lib/openbooks/active-entity.tsx). ReportsScreen already reads useActiveEntity() at line 1526 and passes entityId; extend it to pass scope='all' when the switcher is on All.
- Currency: the ledger is USD-only (decided: see decisions.md Q32) — consolidation is plain USD summation, `SUM(by account code across in-scope entities) − eliminated intercompany pairs`. There is no mixed-currency case to handle: no per-currency breakdown, no base-currency conversion, no 'mixed currency' label, no PayrollSummary-style per-currency fallback.
- Add an empty/honest state when 'All' has zero entities and when only one entity exists (then 'All' == that entity, no elimination needed).

**Files:** `convex/reportViews.ts:34-57 (getEntity), :447-467 (reportPack), :484-921 (buildReportPackForEntity — reuse per entity)`, `apps/web/src/lib/openbooks/active-entity.tsx (scope source shared with E5/E12)`, `apps/web/src/components/openbooks/ReportsScreen.tsx:1526-1619 (useActiveEntity + reportPack query args)`, `docs/finishing/accounting-engine-blueprint.md (Part-1 portfolio/intercompany, lines ~173-181, 421-425)`

**Definition of done**

- [ ] Selecting 'All businesses' renders a consolidated USD report whose section totals equal the sum of the individual entities' packs minus eliminated intercompany pairs (unit test builds two seeded entities + a seeded intercompany transfer and asserts All == Zikra+Z360 − intercompany).
- [ ] Selecting a single entity returns exactly that entity's standalone pack (no consolidation, Due-from/Due-to intact, no elimination line).
- [ ] Intercompany transfers between the owner's own entities are ELIMINATED in the consolidated view (read-time exclusion on `intercompanyPairId`) and surfaced as an explicit 'Intercompany eliminated: −$X' line, verified by a seeded intercompany transfer test.
- [ ] Consolidation is a single USD total — no per-currency breakdown and no 'mixed currency' label anywhere (USD-only).
- [ ] Per-entity ledger data is untouched (read-only consolidation; no new writes).

**Deliverables:** New reportPackForScope query (additive); USD consolidation merge util with read-time intercompany elimination + 'Intercompany eliminated' line; ReportsScreen scope wiring to the E12 useActiveScope context / E5 read path; Consolidation unit test (All == sum − intercompany, single == self standalone)

**Verify.** pnpm -w typecheck; convex vitest for reportPackForScope (two-entity USD sum − intercompany elimination + single==self); e2e toggles scope All↔Zikra and asserts totals change and the elimination line appears only in All.

### E6-T8 — Per-report loading skeletons, empty states, and error boundary
`size: M` · `risk: low` · `depends on: E6-T1, E6-T2`

**Intent.** Today loading is a bare text line, empty states are inconsistent, and a thrown query (e.g. start>end at reportViews.ts:457) has no friendly handling. Give every report honest loading/empty/error states so it never shows a blank or crashes.

**Changes**

- Replace the bare 'Loading {name}…' (ReportsScreen.tsx:1755-1756) with a per-report skeleton that mirrors each report's shape (table skeleton for statements, card skeleton for aging/payroll, bridge skeleton for cash-flow).
- Standardize empty states: each report renders a report-specific EmptyState (primitives EmptyState supports icon/title/description/action) when its data array is empty, with copy tailored per report (e.g. cash-flow 'No cash moved in this period', aging 'Nothing outstanding') instead of the generic StatementTable fallback only.
- Add an error boundary around ActiveReport: catch query rejections (start>end, auth) and render a friendly inline card with the message + a 'Reset range' action, instead of a blank screen or a thrown render. Also guard the client against constructing an invalid range before query (range.startDate <= range.endDate) so the obvious case never round-trips to a throw.
- Wire the loading/error states to respect the home vs viewer distinction (home already skips the pack query when no report selected, lines 1607-1619).

**Files:** `apps/web/src/components/openbooks/ReportsScreen.tsx:1755-1767 (loading/dispatch), :656-659 (StatementTable empty), :914-915 (cashflow empty), :1192-1194 (GL empty)`, `apps/web/src/components/openbooks/primitives.tsx:99-118 (EmptyState)`, `convex/reportViews.ts:457-459 (start>end throw)`

**Definition of done**

- [ ] Each report shows a shaped skeleton while pack===undefined (not a bare text line), verified visually.
- [ ] Each report has report-specific empty-state copy when its primary data is empty (e2e on an empty/new entity asserts at least 3 reports show their tailored empty copy).
- [ ] Forcing start>end (or an auth error) renders a friendly inline error card with a Reset action — no crash/blank (e2e or unit asserts the error UI, not an unhandled exception).
- [ ] No report renders an undefined/NaN money figure in empty state.

**Deliverables:** Per-report Skeleton components; Report-specific EmptyState copy map; Error boundary + invalid-range client guard

**Verify.** pnpm -w typecheck && lint; e2e on a fresh empty entity for empty copy; manual force start>end via custom dates to confirm the error card.

### E6-T9 — Honest 'unreviewed / excluded $X' + truncation banner on every report
`size: M` · `risk: low` · `depends on: E6-T5, E6-T8, E1-T8 (additive unreviewed:{count,amountMinor} field), E1-T5 (truncation fix + flag)`

**Intent.** Reports currently understate because ~78% of real transactions are unposted (RC1) and cash-basis excludes open items, and the RC5 5,000-row truncation flag is computed but never shown. The blueprint mandates a visible gap banner so reports never silently lie. E6 renders the banner; E1 supplies the accurate counts.

**Changes**

- Surface the existing `limits.truncated` flag (reportViews.ts:913-918, from the RC5 .take(REPORT_LIMIT) at :492-501) in the UI: when true, render a warning banner on the report ('Showing the first 5,000 rows — totals may be incomplete') with a link to narrow the range.
- Add an 'unreviewed/excluded' banner: consume the count/amount of transactions that are NOT posted (entryId:null — RC1) and the cash-basis-excluded open items (from E6-T5's cashBasisExcluded). E1 owns producing an accurate `unreviewed: {count, amountMinor}` field on the pack; E6 wires the banner to render it on every report and the reports-home, stating e.g. 'N transactions ($X) aren't categorized yet and aren't in these numbers — review them in the Inbox.' with a link to /inbox.
- Field contract with E1 is RESOLVED (decided: see decisions.md Q30): E1-T8 adds the additive optional `unreviewed:{count,amountMinor}` field plus accurate posted/unposted counts on the report views; E6 renders the banner gated on field-presence. Render the banner only when the field is present so this ticket can ship independently and light up the moment E1 lands. The RC5 `.take(5000)` truncation fix is owned by E1-T5 (decided: see decisions.md Q34) — E6 only surfaces the `limits.truncated` flag E1 produces.
- Style the banner per design rules (quiet, neutral/warning token, not alarm-red), reuse the warning-surface token already used by BalancedChip (line 855).

**Files:** `convex/reportViews.ts:492-501 (REPORT_LIMIT take), :890-918 (limits/truncated)`, `apps/web/src/components/openbooks/ReportsScreen.tsx:1670-1707 (home), :1755-1767 (viewer) — banner mount points`, `apps/web/src/lib/openbooks/reports-export.ts:181-185 (limits type)`, `docs/finishing/accounting-engine-blueprint.md (RC1 banner mandate ~lines 201-218, Phase-1 item 4 ~464)`

**Definition of done**

- [ ] When limits.truncated is true, a banner appears on the report stating rows were truncated with a narrow-range hint (test seeds >REPORT_LIMIT rows or stubs truncated=true and asserts the banner).
- [ ] When the pack carries an `unreviewed` field with count>0, a banner appears on every report and the reports-home stating the excluded count/amount with a link to /inbox (test stubs the field and asserts banner + link).
- [ ] Banner uses warning/neutral tokens (no alarm-red), passes design-rule lint.
- [ ] Banner is absent when truncated=false and unreviewed is 0/absent (no false alarms).

**Deliverables:** TruncationBanner + UnreviewedGapBanner components; Wiring on viewer + home; Additive `unreviewed` field consumption (contract owned by E1-T8 per decisions.md Q30)

**Verify.** pnpm -w typecheck && lint; reportViews/e2e test that stubs truncated and unreviewed and asserts banner copy + /inbox link; visual check banner styling.

### E6-T10 — Per-report insight banner + Reports regression test/screenshot evidence pack
`size: M` · `risk: low` · `depends on: E6-T1, E6-T2, E6-T3, E6-T4, E6-T5, E6-T6, E6-T7, E6-T8, E6-T9`

**Intent.** Ansar wants ONE unique small insight banner per page and a real test/evidence pack for the redesigned Reports. Add a single relevant insight strip to the Reports surface and capture the responsive evidence proving the whole epic.

**Changes**

- Add ONE small, report-relevant insight banner to the Reports surface (e.g. on report-home and/or the active report) reusing the existing workbench InsightsBand/InsightsBand-style components (apps/web/src/components/openbooks/workbench/InsightsBand.tsx) — keep it quiet and single (not a dashboard), e.g. 'Net profit is up X% vs last month' or 'AR over 60 days grew $Y'. Derive it from the already-loaded homePack (ReportsScreen.tsx:1608-1619) so no extra query is needed.
- Extend the existing e2e specs (tests/e2e/reports.spec.ts, reports-export-h2.spec.ts) with: cash-flow no-overflow assertion at mobile width; a drill-parity assertion (drill-total == clicked) for at least one number; an export-parity smoke (cash-flow CSV contains a line item) ; basis-badge text after toggling cash.
- Capture a screenshot evidence pack (all 12 reports at 375px and 1280px, plus the cash-flow before/after) using the agent-browser skill and save under docs/finishing/evidence/ as the H2-style acceptance artifact.
- Ensure the full gate is green and document the report-surface changes briefly in the appropriate finishing doc.

**Files:** `apps/web/src/components/openbooks/ReportsScreen.tsx:1608-1707 (home pack reuse for insight)`, `apps/web/src/components/openbooks/workbench/InsightsBand.tsx (reuse pattern)`, `tests/e2e/reports.spec.ts, tests/e2e/reports-export-h2.spec.ts, tests/e2e/reports-payroll.spec.ts`, `convex/reportViews.test.ts (add cases if backend fields changed)`

**Definition of done**

- [ ] Reports surface shows exactly ONE small insight banner relevant to reports (not a multi-widget dashboard), derived from existing data (no new query), passing design lint.
- [ ] e2e suite gains assertions for: cash-flow mobile no-overflow, drill parity, export parity smoke, basis badge — all green.
- [ ] Screenshot evidence pack (12 reports × mobile+desktop + cash-flow before/after) saved under docs/finishing/evidence/ and referenced.
- [ ] Full gate green: pnpm -w typecheck, pnpm -w lint, pnpm -w build, reportViews vitest, tests/e2e/reports*.spec.ts.

**Deliverables:** One Reports insight banner; Extended e2e assertions; Screenshot evidence pack under docs/finishing/evidence/; Gate-green run log

**Verify.** pnpm -w typecheck && pnpm -w lint && pnpm -w build; run reportViews vitest + tests/e2e/reports*.spec.ts; agent-browser screenshot capture across viewports.

## Decisions applied

All prior open questions for this epic are resolved in `../decisions.md` (and the per-epic deltas in `../plan-rebuild-changelog.md`). Summary of what was decided and baked into the tickets above:

- **Q30 — Field contract with E1 (`unreviewed:{count,amountMinor}`):** RESOLVED. E1-T8 owns the additive optional field + accurate posted/unposted counts; E6-T9 renders the banner gated on field-presence.
- **Q31 — Scope source ownership:** RESOLVED. E12-T8 ships `useActiveScope()` + the active-entity context (`active-entity.tsx`); E5 owns the consolidated read path; scope is `"all" | entityId` and `reportPackForScope` branches on it (E6-T7).
- **Q32 — Multi-currency consolidation:** CUT — USD-only general ledger. A single consolidated USD total; no per-currency breakdown, no base-currency engine, no 'mixed currency' label, no "until FX lands" caveat. All multi-currency reporting tickets/lines removed.
- **Q33 — Intercompany in the consolidated view:** ELIMINATE (true consolidation) via read-time exclusion of pairs whose both legs are in scope, with an explicit 'Intercompany eliminated: −$X' line; standalone view keeps Due-from/Due-to (E6-T7).
- **Q34 — RC5 `.take(5000)` truncation:** E1-T5 owns the real fix; E6-T9 only surfaces the `limits.truncated` banner.

**Still needs Ansar:** none for this epic. Default rule for anything uncovered: do what QuickBooks Online does; do not invent.
