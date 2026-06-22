# E8 — Insights everywhere — per-page banners + redesigned insights screens, on real ledger data

> Part of the **OpenBooks Launch Sprint**. Master plan: [../README.md](../README.md) · Backlog: [../backlog.md](../backlog.md)

**Goal.** Give every operational page ONE small, unique, page-specific insight banner (programmatic metrics + a quiet AI narrative on top, never fabricated numbers), and bring the per-section Insights screens to a consistent, on-brand, responsive bar — all reading live ledger-derived data anchored to the real server clock instead of the frozen 2026-06-30 demo date, with the dev-only fixture path clearly fenced off from production reads.

**Why it matters.** Ansar's owner experience is "open any page and immediately see what's true and what to do." Today the Insights system is genuinely well-built (a reusable E1 component kit reused across Transactions/Income/Expenses/Contacts/Payroll) but it is anchored to a single hardcoded TODAY_ISO = "2026-06-30" (InsightsScreen.tsx:32) plus matching hardcoded windows in coreViews/ModuleScreens, so on his real, present-dated books every "this month"/aging/overdue read resolves to a stale or empty window and the panels read blank even when the ledger is correct (confirmed RC6 in the blueprint). There is no per-page banner at all, so the daily "one thing worth noticing" never surfaces where he works. And the Bills sub-tab still shows a "coming soon" stub. Fixing the clock, adding a single reusable banner fed by the read-models that already compute these KPIs, filling the Bills gap, and tightening the visual system turns a demo-only feature into a real cockpit he can run on — and it is low-risk because none of it touches the ledger posting path.

## Current state

CONFIRMED by reading the code: (1) The Insights system is fully built and shared — InsightsScreen.tsx exports SectionInsights dispatching to Transactions/Income/Expenses/Contacts/Payroll insights, all composed from the reusable E1 kit under components/openbooks/workbench/insights/* (InsightsPanel, InsightsScope, InsightsKpiCard, InsightsChart, AiObservationColumn, TransactionsDrillDrawer, insights-scope.ts). (2) ROOT CAUSE RC6 — every Insights screen hardcodes `const TODAY_ISO = "2026-06-30"` (InsightsScreen.tsx:32) and passes it to resolveScope + InsightsPanel todayISO on all five sections; ModuleScreens.tsx hardcodes "2026-06-13"/"2026-06-30" (lines 345/348/1221/1268); CoreScreens.tsx hardcodes "2026-06-30" (1627/1630/1638/1830) and an "if income stopped today" line (606); coreViews.ts hardcodes a 2025-07…2026-06 twelve-month `months` array (lines 12-25) and a due-soon `<= "2026-06-30"` cutoff (456); InsightsScreen.isDormant() hardcodes "2026-04-01" (1324). ReportsScreen.tsx already has the correct pattern: `todayIso()` = new Date().toISOString().slice(0,10) (122). There is NO shared server-clock hook in apps/web/src/lib. (3) There is NO per-page banner component anywhere — `banner` is only a layout slot on WorkbenchSurface (75/110) and WorkbenchPage (attention slot); no programmatic per-page insight banner exists. (4) `bills` is absent from the SectionInsights dispatcher (InsightsScreen.tsx:373-390 → SectionInsightsStub), even though moduleViews.overview already computes bills KPIs. (5) The AI narrative path exists: aiInsights.generateInsights (action) builds a per-section deterministic aggregate + Bedrock narrative with a deterministic fallback; AiObservationColumn (insights/AiObservationCard.tsx) and AiNarrativePanel (workbench/AiNarrativePanel.tsx) consume it on-demand. NOTE: this path hardcodes Bedrock-from-env TODAY; BYO keys are wired in THIS sprint by E3 (the provider-agnostic runtime + unified credential resolver), so E8-T8 narrates across the user's chosen provider with a deterministic fallback. The deterministic fallback already returns real numbers, so banners must never block on AI. (6) insightsFixtures.ts (convex) seeds a DISPOSABLE entity via seedInsightsEntity, gated by OPENBOOKS_DEV_AUTH_BYPASS==="1" — it is NOT injected into production reads, but the epic must verify that and keep the e2e wired to it. (7) The read-models the banners need ALREADY exist: incomeViews.overview (receivedThisMonthMinor/recurringMrrMinor/overdueMinor/stillOpenMinor/customers), expensesViews.overview (spentMinor/deltaPct/biggestMoverName/topVendorName/recurringMonthlyMinor), moduleViews.overview (bills.kpis, contacts.kpis + moneyInYtdMinor rows, payroll currencyTotals/unmatchedCount/runs), and coreViews.transactions.insights (uncategorizedCount/netChangeMinor/counterparties). (8) Two legacy insight components remain (InsightsBand.tsx, MiniCashflowStrip.tsx, InsightsDashboard.tsx + AiNarrativePanel) that predate the E1 kit and are only self-referenced — design-cleanup candidates.

## Definition of done (epic)

- [ ] A reusable InsightBanner component exists and is rendered exactly once at the top of every operational page (Transactions, Income, Expenses, Bills, Contacts, Payroll) plus the Dashboard, each showing a DIFFERENT page-specific programmatic insight (no two pages show the same line).
- [ ] Every banner line and every Insights KPI/aging/overdue number is computed from the existing ledger-derived read-models — switching the active entity or scope changes the banner; there are zero invented numbers and the AI layer only narrates the supplied figures.
- [ ] No insights surface uses a hardcoded calendar date: `grep -rn '2026-06-30\|2026-06-13\|2026-04-01' apps/web/src/components/openbooks/InsightsScreen.tsx apps/web/src/components/openbooks/CoreScreens.tsx apps/web/src/components/openbooks/ModuleScreens.tsx` returns nothing in insights/today-anchor code paths; the anchor comes from a shared server-clock hook.
- [ ] The Bills section renders a real Insights panel (not SectionInsightsStub) consistent with the other five sections.
- [ ] The fixture path (insightsFixtures.ts) is proven dev-only (gated by OPENBOOKS_DEV_AUTH_BYPASS) and is never read by a production-mode insights query; the e2e that depends on it still passes.
- [ ] Gates green: pnpm -w typecheck, pnpm -w lint, pnpm -w build, and the insights e2e specs (redesign-e1-insights, redesign-epic1-insights, redesign-e0-subtabs) pass; a new banner e2e asserts a page-specific banner on each section.
- [ ] Insights screens are visually consistent and responsive: banner + scope bar + KPI grid + charts/observations stack cleanly at mobile width (375px) with no horizontal scroll, verified by screenshot.

## Tickets (9)

### E8-T1 — Add a shared server-clock 'today' hook and remove the hardcoded TODAY_ISO anchor
`size: S` · `risk: low` · `depends on: —`

**Intent.** Kill confirmed root cause RC6 at its source: replace the single frozen demo anchor with the real server/browser clock so 'this month', aging, overdue, and 'previous period' windows resolve to the actual current period on Ansar's live, present-dated books.

**Changes**

- Create apps/web/src/lib/openbooks/today.ts exporting `useTodayIso()` (and a plain `todayIso()` like ReportsScreen.tsx:122) that returns new Date().toISOString().slice(0,10), memoized per render so resolveScope inputs stay stable; document that this is the single anchor all insights/aging/overdue windows use.
- In InsightsScreen.tsx, delete `const TODAY_ISO = '2026-06-30'` (line 32) and its comment; in each of the 5 insights components (TransactionsInsights, IncomeInsights, ExpensesInsights, ContactsInsights, PayrollInsights) read the anchor from useTodayIso() and pass it to resolveScope(...) and InsightsPanel todayISO.
- Replace InsightsScreen.isDormant() hardcoded '2026-04-01' (line 1324) with a value derived from the anchor minus ~90 days.
- Leave a single optional override prop on the hook (e.g. an env/debug flag) so the existing fixture-based e2e can still pin a known date if needed — default is the real clock.
- **Single source-of-truth contract (decided: see decisions.md Q40):** browser clock for FE display via `useTodayIso()`; the server `asOf` is threaded into `coreViews` queries in E8-T2 so query bodies stay deterministic. This epic OWNS the canonical `today`/`asOf` helper — E7-10 and E9-T2 import it; do not introduce a second date helper.

**Files:** `apps/web/src/lib/openbooks/today.ts (new)`, `apps/web/src/components/openbooks/InsightsScreen.tsx:32 (TODAY_ISO), :77, :406, :639, :903, :1102 (resolveScope), :284/:609/:873/:1075/:1305 (todayISO), :1322-1325 (isDormant)`, `apps/web/src/components/openbooks/ReportsScreen.tsx:122 (pattern reference, do not change)`

**Definition of done**

- [ ] grep for '2026-06-30' and '2026-04-01' in InsightsScreen.tsx returns zero matches.
- [ ] All five insights sections compile and render with the anchor coming from useTodayIso(); switching the system clock (or the test override) shifts the resolved 'this month' label accordingly.
- [ ] resolveScope still receives a stable string per render (no new Date object identity churn causing re-render loops) — verified by the insights e2e not flaking.

**Deliverables:** today.ts hook; InsightsScreen.tsx edits; short note in the PR describing the anchor contract

**Verify.** pnpm -w typecheck && pnpm -w lint; run tests/e2e/redesign-e1-insights.spec.ts (it pins the fixture date via override) and confirm insights-resolved-dates renders; manually set browser date and confirm the period label tracks it.

### E8-T2 — De-hardcode the remaining insights/aging date anchors in ModuleScreens, CoreScreens, and coreViews
`size: M` · `risk: med` · `depends on: E8-T1`

**Intent.** Finish RC6 beyond InsightsScreen: the module insights ranges, the dashboard's 12-month window, and the bills 'due soon' cutoff are all frozen to mid-2026, so payroll/contacts/bills/dashboard insights read stale or empty on real data.

**Changes**

- In ModuleScreens.tsx, replace hardcoded '2026-06-13'/'2026-06-30' (lines 345/348/1268) and PAYROLL_CURRENT_PERIOD '2026-06' (1221) with the server-clock anchor from the new hook (E8-T1) / current YYYY-MM.
- In CoreScreens.tsx, replace the dashboard/transactions hardcoded '2026-06-30' anchors (1627/1630/1638/1830) with the hook; keep manual-entry default date as today.
- In convex/coreViews.ts, replace the static `months` array (lines 12-25) with a function that derives the trailing-12-months window from a server-provided `asOf` (the query already runs server-side; use a deterministic ISO-from-millis helper, NOT a literal array), and replace the due-soon cutoff `<= '2026-06-30'` (456) with the period-end/asOf already computed in that query.
- Thread an optional `asOf` arg (defaulting to the server's current date) into coreViews.dashboard so the window is honest; keep it backward-compatible.

**Files:** `apps/web/src/components/openbooks/ModuleScreens.tsx:345,348,1221,1268`, `apps/web/src/components/openbooks/CoreScreens.tsx:606,1627,1630,1638,1830`, `convex/coreViews.ts:12-25 (months),:134,:456`

**Definition of done**

- [ ] No insights/dashboard window or due-soon cutoff references a literal 2026 date; the trailing-12-month dashboard window is derived from the current date.
- [ ] coreViews.dashboard returns the same shape; existing dashboard tests still pass.
- [ ] Payroll/Contacts/Bills insights and the dashboard charts render non-empty against present-dated data.

**Deliverables:** ModuleScreens.tsx / CoreScreens.tsx / coreViews.ts edits; note that coreViews is a query (no new Date() in query body — pass asOf or use the deterministic helper already in the file)

**Verify.** pnpm -w typecheck && pnpm -w build; run dashboard + module insights against the fixture entity and a present-dated entity; confirm coreViews unit/contract tests pass.

### E8-T3 — Build the reusable InsightBanner component + a page-insight registry
`size: M` · `risk: low` · `depends on: —`

**Intent.** Create the single small, on-brand banner primitive every page renders once, plus a typed registry of page-specific programmatic insight builders so each page gets a DIFFERENT, relevant one-liner (the core owner ask).

**Changes**

- Create apps/web/src/components/openbooks/workbench/InsightBanner.tsx: a compact, single-line banner (lucide icon + plain-English text + optional one drillable chip + optional tone via the AttentionState token vocabulary), brand-green/neutral discipline, never red for ordinary spend, dismissible-per-session optional, data-testid='page-insight-banner' with a data-page attribute. No gradients/sparkle clichés.
- Create apps/web/src/components/openbooks/workbench/page-insights.ts: a registry mapping each page → a pure builder `(readModel) => { text, tone, icon, chip? } | null` that picks the single most relevant programmatic insight from the EXISTING read-model the page already queries (no new server work). Returning null hides the banner (threshold-gated, like NothingNotable).
- Define per-page builders sourced from existing fields — Transactions: uncategorizedCount/anomalies from coreViews.transactions.insights; Income: top customer / overdue AR / MRR from incomeViews.overview; Expenses: biggest mover / recurring run-rate from expensesViews.overview; Contacts: top earner / where money goes from moduleViews contacts rows; Payroll: monthly run-rate / headcount / unmatched from moduleViews payroll; Bills: open/overdue/due-soon from moduleViews bills; Dashboard: net cash trend / runway from coreViews.dashboard.
- Export from workbench/index.ts.

**Files:** `apps/web/src/components/openbooks/workbench/InsightBanner.tsx (new)`, `apps/web/src/components/openbooks/workbench/page-insights.ts (new)`, `apps/web/src/components/openbooks/workbench/AttentionState.tsx (token vocabulary reuse)`, `apps/web/src/components/openbooks/workbench/index.ts (export)`, `convex/incomeViews.ts, convex/expensesViews.ts, convex/moduleViews.ts, convex/coreViews.ts (read-model field references only — no edits)`

**Definition of done**

- [ ] InsightBanner renders a single line, is keyboard/aria accessible, and uses only design-system tokens (no purple, no gradient, no emoji).
- [ ] page-insights.ts has a builder for all 7 pages; each returns a DISTINCT text given the demo data (no two identical strings).
- [ ] Builders are pure and unit-tested with sample read-model objects (including the empty/null case → banner hidden).

**Deliverables:** InsightBanner.tsx; page-insights.ts; unit test page-insights.test.ts; index.ts export

**Verify.** pnpm -w typecheck && pnpm -w lint; run the new page-insights.test.ts; Storybook/manual render of InsightBanner in all tones.

### E8-T4 — Wire the InsightBanner into Transactions, Income, Expenses, and the Dashboard
`size: M` · `risk: low` · `depends on: E8-T3, E8-T1, E5 scope contract (active-entity / "all" | entityId) + E12-T8 useActiveScope()`

**Intent.** Mount the per-page banner on the four core cash-movement surfaces using each page's already-loaded read-model, so the owner sees the page's one relevant insight without opening the Insights tab.

**Changes**

- In CoreScreens.tsx (Transactions default screen and Dashboard), render <InsightBanner page='transactions'|'dashboard' insight={buildPageInsight(...)}/> in the WorkbenchSurface `banner` slot (Transactions, ~2384) and at the top of the Dashboard, feeding the data already fetched there (coreViews.transactions.insights / coreViews.dashboard).
- In IncomeScreen.tsx and ExpensesScreen.tsx, render the banner using incomeViews.overview / expensesViews.overview that the screens already query (or lift the query if the default screen doesn't already have it).
- Ensure exactly ONE banner per page (don't double-render on the Insights sub-tab — the Insights panel keeps its own KPI band).
- Wire the optional chip to open the section's existing drill drawer / filter where one exists (e.g. Transactions uncategorized → uncategorized filter).
- **All / Portfolio mode (decided: see decisions.md Q43):** when scope is "all", banners AGGREGATE across in-scope entities (a portfolio insight, **intercompany eliminated** per E5); when a single entity is active, show that entity's per-entity insight. Read the scope from E5's active-entity context / E12-T8 `useActiveScope()` — do not hardcode the primary entity.

**Files:** `apps/web/src/components/openbooks/CoreScreens.tsx:2359-2390 (Transactions surface), dashboard render block`, `apps/web/src/components/openbooks/IncomeScreen.tsx`, `apps/web/src/components/openbooks/ExpensesScreen.tsx`

**Definition of done**

- [ ] Transactions, Income, Expenses, and Dashboard each show exactly one page-insight-banner with a page-specific line.
- [ ] Changing the active entity changes the banner text; the number in the banner matches the corresponding KPI on that page's Insights tab.
- [ ] The Transactions banner chip opens the uncategorized view; no banner on the Insights sub-tab duplicates the page banner.

**Deliverables:** CoreScreens.tsx / IncomeScreen.tsx / ExpensesScreen.tsx edits; screenshots of all four banners

**Verify.** pnpm -w typecheck && pnpm -w build; manual + agent-browser screenshot of each page; assert banner number equals Insights-tab KPI for the same period.

### E8-T5 — Wire the InsightBanner into Contacts, Payroll, and fill the Bills Insights gap
`size: M` · `risk: low` · `depends on: E8-T3, E8-T1, E8-T2`

**Intent.** Complete banner coverage on the relationship/payroll/payables surfaces and close the confirmed gap where Bills shows only a SectionInsightsStub.

**Changes**

- In ContactsScreen.tsx and the Payroll overview (ModuleScreens.tsx / payroll module), render <InsightBanner page='contacts'|'payroll' .../> from moduleViews.overview which those screens already query.
- Add a BillsInsights component in InsightsScreen.tsx (mirroring the other section insights, built on the E1 kit, sourced from moduleViews.overview.bills: open/overdue/due-soon, AP aging, DPO, missing-evidence) and route section==='bills' to it in the SectionInsights dispatcher (replace the stub branch at 373-390).
- Render the Bills page banner (open/overdue/due-soon) on the Bills sub-tab default screen.
- Confirm Bills aging/overdue use the server-clock anchor from E8-T1/T2, not a frozen date.

**Files:** `apps/web/src/components/openbooks/InsightsScreen.tsx:373-390 (dispatcher), add BillsInsights`, `apps/web/src/components/openbooks/ContactsScreen.tsx:75`, `apps/web/src/components/openbooks/ModuleScreens.tsx (payroll/bills overview)`, `convex/moduleViews.ts (bills.kpis/aging field references — no edits)`

**Definition of done**

- [ ] Bills Insights renders a real panel (KPI band + AP aging chart + AI observations), not the 'Coming in this pass' stub.
- [ ] Contacts, Payroll, and Bills each show exactly one page-specific banner.
- [ ] All six operational pages now have a banner; SectionInsights no longer returns a stub for any of the six sections.

**Deliverables:** BillsInsights component; ContactsScreen/ModuleScreens edits; screenshots of Contacts/Payroll/Bills banners + Bills Insights panel

**Verify.** pnpm -w typecheck && pnpm -w build; run redesign-e0-subtabs.spec.ts (sub-tab routing) and confirm Bills→Insights shows the panel; agent-browser screenshots.

### E8-T6 — Replace fixture-driven insight numbers with real ledger-derived metrics and fence the dev fixture
`size: S` · `risk: low` · `depends on: E8-T3`

**Intent.** Satisfy the owner ask 'replace any fixture-driven insights with real ledger-derived metrics' and remove any risk that disposable fixture data leaks into production insight reads.

**Changes**

- Audit every insights/banner data source to confirm it reads a real read-model query (coreViews/incomeViews/expensesViews/moduleViews) — these already derive from posted journal lines / invoices / bills; document the chain in a short comment block.
- Verify convex/insightsFixtures.ts seedInsightsEntity stays strictly behind OPENBOOKS_DEV_AUTH_BYPASS==='1' and writes only to a DISPOSABLE entity (it does today at lines 56-67); add an assertion/guard if any non-dev caller path exists, and confirm no production query reads from a fixture-only table or flag.
- If any banner/KPI currently falls back to a hardcoded sample (e.g. the manual-entry CSV sample text in CoreScreens 1630 is fine as input placeholder, but confirm it never feeds a metric), replace with the live read-model value or an empty/null state.
- Add a test asserting that with OPENBOOKS_DEV_AUTH_BYPASS unset, seedInsightsEntity throws and insights queries return only real-entity data.

**Files:** `convex/insightsFixtures.ts:56-67 (gate)`, `convex/coreViews.ts, convex/incomeViews.ts, convex/expensesViews.ts, convex/moduleViews.ts (provenance audit, comments only)`, `apps/web/src/components/openbooks/workbench/page-insights.ts (confirm sources)`

**Definition of done**

- [ ] A documented provenance chain shows every insight/banner number originates from a ledger-derived read-model.
- [ ] seedInsightsEntity provably throws when the dev bypass is off (unit test).
- [ ] No production insights query path references the fixture entity or any fixture-only flag.

**Deliverables:** provenance comment block / short doc; fixture-gate test; any source-swap edits

**Verify.** pnpm -w typecheck; run the fixture-gate test with the env var unset (expect throw) and set (expect seed); code-review the data chain for each page.

### E8-T7 — Redesign + responsive pass on the per-section Insights dashboards for consistency
`size: M` · `risk: low` · `depends on: E8-T5`

**Intent.** Deliver the owner ask 'the Insights sections need design improvement': make all six section Insights panels look like one product, fully responsive (no squeezed desktop on mobile), with consistent KPI/chart/observation rhythm and brand color discipline.

**Changes**

- Standardize the KPI grid: ensure InsightsKpiGrid columns degrade cleanly (5→2→1) at md/sm/xs; confirm every section uses the same card anatomy (label, value tabular figures, comparison frame, status pill) — fix any one-off card styling across the five existing + new Bills section.
- Verify the InsightsPanel 3fr/2fr charts↔observations split stacks to one column on mobile and the scope bar (InsightsScope) wraps without horizontal scroll at 375px.
- Apply finance color discipline consistently: money-in green, ordinary spend neutral, only overdue/runway-tight carry warning tokens; **RETIRE the legacy `InsightsBand.tsx`, `MiniCashflowStrip.tsx`, and `InsightsDashboard.tsx`** (they predate the E1 kit and are only self-referenced) and clean up their references — **keep the `aiInsights` action** as the banner's Explain backend (decided: see decisions.md Q41). Do not restyle the legacy components; remove them.
- Ensure tabular figures + letter-spacing 0 on all money in the panels; remove any stray decorative styling.

**Files:** `apps/web/src/components/openbooks/workbench/insights/InsightsKpiCard.tsx (InsightsKpiGrid columns)`, `apps/web/src/components/openbooks/workbench/insights/InsightsPanel.tsx:58 (split)`, `apps/web/src/components/openbooks/workbench/insights/InsightsScope.tsx`, `apps/web/src/components/openbooks/workbench/InsightsBand.tsx, MiniCashflowStrip.tsx, InsightsDashboard.tsx (DELETE — retire, decided Q41)`, `apps/web/src/components/openbooks/InsightsScreen.tsx (all 6 sections)`

**Definition of done**

- [ ] All six Insights panels render with identical structure and spacing; a reviewer cannot tell them apart by chrome.
- [ ] At 375px width every panel stacks to a single column with no horizontal scroll and no clipped KPI cards (screenshot evidence).
- [ ] Legacy InsightsBand/MiniCashflowStrip/InsightsDashboard are removed and their references cleaned (the `aiInsights` action stays); no purple/gradient/emoji remain.

**Deliverables:** restyled components; desktop + 375px mobile screenshots of all six panels; the three legacy components deleted with references cleaned (decided Q41 — no decision note needed)

**Verify.** pnpm -w lint && pnpm -w build; agent-browser screenshots at 1280px and 375px for each section; run web-design-guidelines check on the changed files.

### E8-T8 — AI narrative layer on banners + observations that strictly narrates programmatic numbers
`size: M` · `risk: low` · `depends on: E8-T3, E8-T4, E3-T2 (BYO provider-agnostic runtime/resolver)`

**Intent.** Deliver 'AI narrative layer on top of programmatic metrics (never fabricated numbers)' and 'ask for real-time insights' for the banner, reusing the existing aiInsights path and its deterministic fallback so it degrades gracefully when no AI key is configured. **BYO keys are wired in THIS sprint (decided: see decisions.md Q44 / Q11; E3 owns the resolver), so banners get real AI narration across the user's chosen provider with a deterministic fallback — not Bedrock-only.**

**Changes**

- Route the AI narration through the **provider-agnostic runtime from E3** (`aiProvider.ts` factory + unified credential resolver), with the deterministic fallback below; **remove any "Bedrock-only until BYO lands" assumption** — BYO is in scope this sprint (depends on E3-T2/E3-T3).
- Give InsightBanner an optional, opt-in 'Explain' affordance that calls aiInsights.generateInsights for that section and shows the one-sentence summary as a quiet expansion — but the banner's headline NUMBER always comes from the programmatic builder (E8-T3), never from the model.
- Harden the prompt/parse contract in convex/aiInsights.ts so the model is instructed to only restate the supplied figures (it already says 'Do not invent numbers' at 251) and the parsed findings are cross-checked against the aggregate where feasible; on any parse/empty/no-key path, fall back to the deterministic findings (already implemented, lines 189-221) so the UI never blocks or shows fabricated values.
- Ensure AiObservationColumn/AiNarrativePanel and the banner Explain all show the may-be-inaccurate disclaimer and the 'Computed without AI' note when the deterministic fallback is used.
- Add a guard/test: when **no AI provider key is resolvable from the unified credential store** (any of the 14 providers — not just Bedrock), generateInsights returns deterministic numbers that match the programmatic builders for the same period (no divergence).

**Files:** `apps/web/src/components/openbooks/workbench/InsightBanner.tsx (Explain affordance)`, `convex/aiInsights.ts:189-223 (fallback), :244-263 (prompt), :265-295 (parse)`, `apps/web/src/components/openbooks/workbench/insights/AiObservationCard.tsx (disclaimer parity)`, `apps/web/src/components/openbooks/workbench/AiNarrativePanel.tsx`

**Definition of done**

- [ ] With no AI key configured, banners and observations still render real deterministic numbers and clearly say AI was unavailable.
- [ ] The AI narrative never shows a number absent from the section aggregate (verified by a test feeding a known aggregate and asserting the deterministic fallback numbers).
- [ ] The disclaimer is present on every AI-narrated surface.

**Deliverables:** InsightBanner Explain UI; aiInsights.ts hardening; narrative-fallback test; screenshot of Explain expansion

**Verify.** pnpm -w typecheck; run the aiInsights fallback test with no provider key in the unified credential store (expect deterministic findings); then with a resolvable BYO key, confirm AI narration restates only the supplied figures; manual click 'Explain' on a banner.

### E8-T9 — e2e + verification pack for banners, the clock fix, and Bills Insights
`size: M` · `risk: low` · `depends on: E8-T4, E8-T5, E8-T1`

**Intent.** Lock the epic with automated proof a verifier can run: banners are present and page-specific, the date anchor is real (not frozen), Bills Insights renders, and nothing regresses.

**Changes**

- Add tests/e2e/redesign-e8-insights-banners.spec.ts asserting: each of the six sections + Dashboard shows exactly one page-insight-banner; each banner's text differs across pages; the Transactions banner chip opens the uncategorized view.
- Add an assertion that the insights resolved-date label tracks an injected 'today' (prove RC6 is fixed) — e.g. override the anchor and confirm the period label changes accordingly, and that with the real clock the panel is not empty for a present-dated entity.
- Extend redesign-e0-subtabs (or add a case) so Bills→Insights asserts insights-dashboard is visible (no stub).
- Confirm existing redesign-e1-insights.spec.ts and redesign-epic1-insights.spec.ts still pass against the (now dev-only) fixture entity.

**Files:** `tests/e2e/redesign-e8-insights-banners.spec.ts (new)`, `tests/e2e/redesign-e1-insights.spec.ts (regression)`, `tests/e2e/redesign-e0-subtabs.spec.ts (Bills→Insights case)`, `convex/insightsFixtures.ts (test seed dependency)`

**Definition of done**

- [ ] New banner e2e passes and fails if a banner is missing, duplicated, or identical across two pages.
- [ ] An e2e proves the resolved-date label is driven by the anchor (not a literal 2026-06-30).
- [ ] Bills→Insights e2e shows the panel; all prior insights specs stay green.

**Deliverables:** redesign-e8-insights-banners.spec.ts; updated subtab spec; CI run log showing green insights suite

**Verify.** pnpm -w typecheck && pnpm -w lint && pnpm -w build; pnpm playwright test redesign-e8-insights-banners redesign-e1-insights redesign-epic1-insights redesign-e0-subtabs.

## Decisions applied

All prior open questions for this epic are RESOLVED in `../decisions.md` (Q40–Q44) and the per-epic deltas in `../plan-rebuild-changelog.md` (E08). Applied here:

- **Q40 — Banner anchor source.** Browser clock for FE display via `useTodayIso()`; server `asOf` threaded into `coreViews` queries (E8-T2) so query bodies stay deterministic. E8 OWNS the canonical `today`/`asOf` helper; E7-10 and E9-T2 import it (no second date helper).
- **Q41 — Legacy components.** RETIRE `InsightsBand.tsx`, `MiniCashflowStrip.tsx`, and `InsightsDashboard.tsx` (E8-T7); KEEP the `aiInsights` action as the banner's Explain backend.
- **Q42 — Banner persistence.** Always-on but threshold-gated — hidden when the page-insight builder returns null (never a filler line).
- **Q43 — All / Portfolio mode.** Aggregate across in-scope entities in All mode (intercompany eliminated per E5); per-entity insight when a single entity is active. E8-T4 reads scope from E5's active-entity context / E12-T8 `useActiveScope()`.
- **Q44 — AI narration sequencing.** BYO keys are wired in THIS sprint by E3 (provider-agnostic runtime + unified credential resolver), so banners get real AI narration across the user's chosen provider with a deterministic fallback — not Bedrock-only. E8-T8 depends on E3-T2.

No items in this epic still require an Ansar decision.
