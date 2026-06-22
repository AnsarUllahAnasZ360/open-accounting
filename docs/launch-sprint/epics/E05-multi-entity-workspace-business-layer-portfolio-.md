# E5 — Multi-entity, workspace↔business layer & Portfolio/consolidation

> Part of the **OpenBooks Launch Sprint**. Master plan: [../README.md](../README.md) · Backlog: [../backlog.md](../backlog.md)

**Goal.** Deliver a "unified-by-default" experience across Ansar's two LLCs (Zikra + Z360) WITHOUT merging their legal ledgers: an "All businesses / Zikra / Z360" scope switcher replaces the disliked business-type filter; a Portfolio roll-up read model and dashboard sum per-entity ledgers (combined cash, AR/AP, revenue, expense, runway, by-business breakdown) — all in **USD** (the ledger is USD-only; decided: see decisions.md Q24/Q25); consolidated reports eliminate and AI-flag intercompany transfers between entities; the fragile name-match / hardcoded "acme-studio-llc" default business is replaced by a deterministic, persisted default; every view query re-checks entity authorization even when scope=all; and bank/Stripe→business association becomes a first-class, editable mapping. Each LLC's chart of accounts, journal lines, and balance sheet stay legally separate underneath.

**Why it matters.** Ansar runs two LLCs on one Plaid login and two Stripe accounts and explicitly asked for a unified portfolio he can run his real business on, while keeping the legal liability shield intact (commingling two LLCs in one ledger is "alter ego" evidence that pierces the shield — confirmed in the audit blueprint §163). Today the product can only show one business at a time, defaults to whichever entity name fuzzily matches the workspace (AppShell.tsx:154) or a hardcoded demo slug (reportViews.ts:46 et al.), and has no cross-entity view at all — so Ansar cannot see his combined cash, runway, or revenue without manual spreadsheet work. A Portfolio roll-up with intercompany elimination is also a genuine differentiator: QuickBooks and Xero force you to buy Fathom/Joiin for it. This epic turns "two separate books I switch between" into "one cockpit over my whole operation, drill into either LLC," which is the headline of Ansar's go-live vision.

## Current state

Per-entity ledgers already exist and are legally correct: entities table (schema.ts:66) is workspace-scoped with by_workspace / by_workspace_and_slug indexes; journalEntries/journalLines/bankAccounts/stripeAccounts/invoices/bills all carry entityId + by_entity indexes; journalLines carry currency + a now-dead optional fxRate field (the GL is already currency-blind — the ledger is USD-only and the `journalLines.fxRate` field is never written/read, decided: see decisions.md Q3/Q24). The switcher is strictly single-select: AppShell.tsx holds one activeEntityId in state (AppShell.tsx:132), persists it to localStorage (ACTIVE_ENTITY_STORAGE_KEY, AppShell.tsx:216-223), and exposes activeEntity:{id,name,currency} + selectEntity through ActiveEntityProvider (active-entity.tsx:20-26, AppShell.tsx:363-376). There is NO "all" option and no portfolio concept. The default business is fragile/non-deterministic: AppShell.tsx:154-160 picks the business whose name .includes() the workspace name (case-insensitive substring), else the first row; and EVERY backend view resolver falls back to a hardcoded slug "acme-studio-llc" when entityId is omitted — duplicated verbatim in reportViews.ts:46, coreViews.ts:34, incomeViews.ts:20, expensesViews.ts:25, moduleViews.ts:24 (also referenced in aiThreads.ts, performance.ts, and several *.test.ts). Web screens pass scope via a thin entityArg(activeEntity.id) helper (CoreScreens.tsx:151, used at :248/:705/:1452; ReportsScreen.tsx:1590; ModuleScreens.tsx:111) — i.e. there is exactly one chokepoint per surface to retrofit for "all". Authz is re-checked per entity inside getEntity/getActiveEntity (requireWorkspaceRole on entity.workspaceId, reportViews.ts:38), but there is no path that authorizes a multi-entity (scope=all) read yet. coreViews dashboard mixes sources: cash tile uses the live Plaid balance when plaidAccountId is set (coreViews.ts:180) rather than the ledger, so a portfolio cash sum would inherit that inconsistency. The ledger is USD-only, so the portfolio roll-up is plain USD summation — there is no per-currency normalization, no FX engine, and no base-currency conversion step (decided: see decisions.md Q24/Q25; the old blueprint RC8 multi-currency concern is cut). Bank/Stripe→entity association is fixed at creation time (bankAccounts.entityId / stripeAccounts.entityId, schema.ts:233-247 / 708+) with no mutation to re-map an account to a different business — a problem because Ansar's one Plaid login spans both LLCs. The audit blueprint §163-188 and §4.6 (lines 421-429) specify exactly this epic: keep ledgers split, add Portfolio roll-up + scope switcher, eliminate/flag intercompany.

## Definition of done (epic)

- [ ] The AppShell business switcher offers 'All businesses' plus one item per active entity (Zikra, Z360); selecting 'All' sets a portfolio scope that persists across reload and is reflected in ActiveEntityProvider as a distinct scope value (not a fake entityId).
- [ ] The disliked 'filter by business type' control is removed from the shell/screens and replaced by the scope switcher; no remaining UI references business-type filtering for navigation.
- [ ] A backend portfolio read model returns combined cash, AR, AP, revenue, expense, and runway across all active entities in the workspace, plus a per-business breakdown array, with every monetary figure summed in USD integer minor units — no FX conversion, no base-currency engine (USD-only ledger; decided: see decisions.md Q24/Q25).
- [ ] A Portfolio dashboard renders the roll-up with by-business tiles that drill into the single-business dashboard; figures reconcile (portfolio cash == sum of per-entity ledger cash within rounding).
- [ ] Consolidated P&L / Balance Sheet reports support scope=all and ELIMINATE intercompany transfers between the workspace's entities so an internal Zikra→Z360 move is not counted as group revenue/expense; eliminated amounts are shown as a separate line.
- [ ] Inter-entity transfers are detected and surfaced for owner confirmation (AI/heuristic flag), and a confirmed intercompany pair is excluded from consolidated totals.
- [ ] The default business is deterministic and persisted (an entity-level/membership-level default), and the hardcoded 'acme-studio-llc' slug fallback is removed from all production resolvers (reportViews/coreViews/incomeViews/expensesViews/moduleViews).
- [ ] Every view query that accepts scope=all re-checks that the caller has the required role on EACH entity it aggregates (no cross-workspace leakage); a test proves a user from another workspace gets zero rows / an authz error.
- [ ] Bank and Stripe accounts can be re-associated to a different business via a first-class mutation guarded by business.manage, and the Connections UI shows + edits which business each connection belongs to.
- [ ] Gates green: pnpm -w typecheck, lint, and the Convex unit suite pass; new portfolio/intercompany/authz tests pass; the ledger posting path (convex/ledger.ts) is unchanged (git diff shows no edits to postLedgerEntryCore).

## Tickets (10)

### E5-T1 — Schema + deterministic default business; kill the hardcoded acme-studio-llc fallback
`size: M` · `risk: med` · `depends on: —`

**Intent.** Replace the fragile name-match (AppShell.tsx:154) and the hardcoded demo-slug fallback duplicated across every view resolver with a single deterministic, persisted default-entity resolver, and add the schema fields the rest of E5 needs.

**Changes**

- In convex/schema.ts entities table (schema.ts:66) add optional field isDefault?: boolean (workspace's default business). On workspaces table (schema.ts:28) add optional defaultEntityId?: v.id('entities'). Do NOT add any baseCurrency field — the ledger is USD-only (decided: see decisions.md Q25); currency is locked to USD in E5-T4.
- Create convex/entityScope.ts exporting a single resolveDefaultEntity(ctx, membership) that returns, in order: workspace.defaultEntityId if it exists+active, else the entity flagged isDefault, else the oldest non-archived non-demo entity, else the first entity — NEVER a name/slug match.
- Replace the inline getEntity/getActiveEntity fallback blocks that query slug 'acme-studio-llc' in reportViews.ts:42-56, coreViews.ts:27-40, incomeViews.ts:13-26, expensesViews.ts:18-30, moduleViews.ts:17-30 so they call resolveDefaultEntity instead. Keep the explicit-entityId branch and its per-entity requireWorkspaceRole authz untouched.
- Grep the repo for remaining 'acme-studio-llc' in non-test production code (aiThreads.ts, performance.ts) and route them through resolveDefaultEntity; leave seedDemo.ts and *.test.ts seeds as-is (they legitimately create that slug).
- Add convex/entities.ts mutation setDefaultBusiness({entityId}) guarded by requireAnyWorkspacePermission('business.manage') that patches workspace.defaultEntityId (and clears prior isDefault), writes an auditEvent.
- In AppShell.tsx:150-160 remove the workspaceLabel/.includes() name-match; seed the initial selection from a new session field (viewer.defaultEntityId) falling back to the stored localStorage id then the first active row.

**Files:** `convex/schema.ts:28`, `convex/schema.ts:66`, `convex/entityScope.ts (new)`, `convex/reportViews.ts:34-57`, `convex/coreViews.ts:27-40`, `convex/incomeViews.ts:13-26`, `convex/expensesViews.ts:18-30`, `convex/moduleViews.ts:17-30`, `convex/entities.ts:135-184`, `convex/session.ts:5-41`, `convex/aiThreads.ts`, `convex/performance.ts`, `apps/web/src/components/openbooks/AppShell.tsx:150-160`

**Definition of done**

- [ ] No production (non-test) file matches grep -n "acme-studio-llc" outside seed code; the only matches are in seedDemo.ts and *.test.ts.
- [ ] resolveDefaultEntity is the single resolver used by all five view files when entityId is omitted; a unit test asserts it returns the isDefault entity over the first-created one, and the oldest non-demo entity when no flag is set.
- [ ] setDefaultBusiness persists workspace.defaultEntityId and a subsequent session.viewer read returns it; an audit event 'entity.default.set' is written.
- [ ] AppShell no longer references viewer.workspace.name for default selection (the .includes() block is gone); first render selects defaultEntityId then localStorage then first row.

**Deliverables:** convex/entityScope.ts; schema migration note (additive optional fields); entityScope unit test; setDefaultBusiness mutation; AppShell default-selection edit

**Verify.** pnpm -w typecheck && pnpm -w lint && npx convex run-tests (or the project's convex test cmd) for entityScope; grep -rn 'acme-studio-llc' convex/ apps/web/src returns only seed/test matches; manual: set Z360 as default in Settings, reload, shell lands on Z360.

### E5-T2 — Scope contract: 'all' | entityId end-to-end (validators, scope arg, server read path)
`size: M` · `risk: low` · `depends on: E5-T1, E12-T8 (useActiveScope context)`

**Intent.** Introduce a first-class scope value so 'All businesses' is a real mode rather than a missing entityId, and thread it through the one web chokepoint (entityArg) and the **`useActiveScope()` context that E12-T8 owns** (decided: see decisions.md Q31/Q62 — E12 ships the switcher UI + scope context + persistence; E5 consumes it) — without yet changing read logic. E5 owns the All-mode **read path**; it does not re-implement the FE switcher/context.

**Changes**

- Consume `useActiveScope()` from E12-T8 (scope: 'all' | { entityId: string }; `selectScope`). If E12-T8 has not landed, extend ActiveEntity/ActiveEntityContextValue in active-entity.tsx:5-26 as a temporary shim, but converge on E12's context — do NOT ship two scope providers. Keep activeEntity for the single-entity label.
- In AppShell.tsx add portfolioScope state persisted under a new localStorage key (e.g. ACTIVE_SCOPE_STORAGE_KEY); when scope==='all', activeEntity becomes a synthetic {name:'All businesses', isPortfolio:true} with NO id. Build the provider value (AppShell.tsx:363-376) to expose scope + selectScope.
- Generalize entityArg(activeEntity.id) (CoreScreens.tsx:151) into a scopeArg(scope) helper returning {} for 'all' (until per-view portfolio lands in T6) or {entityId} for a single entity; export it so ReportsScreen/ModuleScreens reuse it. Do NOT change query targets yet — 'all' temporarily resolves to the default entity so nothing regresses.
- Add a shared Convex validator scopeValidator = v.union(v.literal('all'), v.object({entityId:v.id('entities')})) in a small convex/entityScope.ts export for T6/T3 to consume.

**Files:** `apps/web/src/lib/openbooks/active-entity.tsx:5-50`, `apps/web/src/components/openbooks/AppShell.tsx:130-170`, `apps/web/src/components/openbooks/AppShell.tsx:363-376`, `apps/web/src/components/openbooks/CoreScreens.tsx:151`, `convex/entityScope.ts`

**Definition of done**

- [ ] ActiveEntityProvider exposes a scope value and selectScope; typecheck passes with the new type across all consumers.
- [ ] Selecting 'All businesses' persists across reload (new localStorage key) and renders the 'All businesses' label in the switcher trigger.
- [ ] scopeArg('all') currently behaves identically to the prior default-entity behavior (no data regression) — verified by existing dashboard/reports e2e still passing.
- [ ] scopeValidator is exported and importable from convex code.

**Deliverables:** active-entity.tsx scope type; AppShell scope state + persistence; scopeArg helper; scopeValidator export

**Verify.** pnpm -w typecheck && pnpm -w lint; manual: switch to All businesses, reload, label persists; existing screens still load their default entity.

### E5-T3 — AppShell scope switcher UI: 'All businesses / Zikra / Z360' replacing business-type filter
`size: M` · `risk: low` · `depends on: E5-T2, E12-T8`

**Intent.** Replace the single-select BusinessSwitcher (AppShell.tsx:998) with a scope switcher whose first item is 'All businesses (Portfolio)' and remove the disliked business-type filter control. The switcher UI + persistence are owned by **E12-T8** (decided: see decisions.md Q62); E5-T3 ensures the switcher exposes the All option and wires it to E5's read path, and removes the business-type filter. If E12-T8 ships the switcher, E5-T3 reduces to the filter removal + All-option verification.

**Changes**

- Rewrite BusinessSwitcher (AppShell.tsx:998-1041) to render a leading 'All businesses' item (with a portfolio glyph + combined-currency hint) above a separator, then one DropdownMenuItem per active entity; mark the active scope with data-active. Wire onClick to selectScope('all') vs onSelect(entityId).
- Update the trigger button (AppShell.tsx:1011-1025) to show 'All businesses' when scope==='all' (data-testid stays active-business-switcher for e2e continuity; add data-scope='all'|'entity').
- Find and remove the business-type filter UI. Grep components/openbooks for 'businessType' filter usages (WorkbenchToolbar / InsightsScreen / module screens) and delete the filter-by-business-type affordance, replacing any callers with the scope switcher's value. Leave businessType on the entity record (still used for CoA seeding) — only the FILTER UI is removed.
- Add a small 'Manage businesses' + 'Set default' affordance reachable from the switcher footer (links to Settings businesses).

**Files:** `apps/web/src/components/openbooks/AppShell.tsx:998-1041`, `apps/web/src/components/openbooks/AppShell.tsx:1011-1025`, `apps/web/src/components/openbooks/workbench/WorkbenchToolbar.tsx`, `apps/web/src/components/openbooks/InsightsScreen.tsx`

**Definition of done**

- [ ] The switcher dropdown lists 'All businesses' first, then Zikra and Z360; selecting each updates the trigger label and the provider scope.
- [ ] No component renders a 'filter by business type' control anymore (grep for the prior filter prop/label returns nothing in nav/toolbar surfaces).
- [ ] data-testid='active-business-switcher' still present (e2e selector preserved) with new data-scope attribute; a Playwright/e2e step can select 'All businesses'.
- [ ] Mobile switcher (if separate) also exposes the All option or the existing mobile entity control reflects scope.

**Deliverables:** Rewritten BusinessSwitcher; business-type filter removal diff; e2e selector preserved; screenshot of the new dropdown (All / Zikra / Z360)

**Verify.** pnpm -w lint; agent-browser/Playwright: open shell, open switcher, assert 3 items incl 'All businesses', select it, assert trigger reads 'All businesses'.

### E5-T4 — Lock the ledger to USD + USD-only portfolio summation helper (no FX engine)
`size: S` · `risk: low` · `depends on: E5-T1`

**Intent.** The general ledger is USD-only (decided: see decisions.md Q24/Q25, Ansar #3). There is no portfolio FX, no base-currency conversion, no "unconverted" badge, no stale-rate policy — the roll-up is plain USD summation. This ticket locks entity/workspace currency to USD and provides the trivial summation helper the portfolio read model uses; it does NOT touch the posting path. (The prior multi-currency-normalization ticket is cut.)

**Changes**

- Lock currency to USD: in convex/entities.ts `createEntity` (entities.ts:139-149) reject any non-USD currency (or hardcode USD); set `workspaceSettings.defaultCurrency = "USD"`. Drop the dead `journalLines.fxRate` field from schema (or leave optional + unused — never write/read it).
- Add convex/portfolioMoney.ts (read-only) exporting a single trivial `sumUsdMinor(amounts: number[]): number` (integer minor-unit addition) used by the portfolio read model. No `convertToBase`, no `fxRate`, no `resolveBaseCurrency` — USD is assumed everywhere.
- Do NOT add a `workspace.setBaseCurrency` mutation; base currency is USD, hardcoded.

**Files:** `convex/entities.ts:139-149 (USD lock)`, `convex/schema.ts:28 (workspaceSettings.defaultCurrency = "USD")`, `convex/schema.ts (drop dead journalLines.fxRate)`, `convex/portfolioMoney.ts (new — sumUsdMinor only)`

**Definition of done**

- [ ] createEntity rejects (or coerces) a non-USD currency; a unit test asserts a non-USD create is rejected.
- [ ] `journalLines.fxRate` is no longer written or read anywhere (grep returns no production write/read); the portfolio read model never references a currency conversion.
- [ ] sumUsdMinor sums integer minor units (no floats) and is the only money helper the portfolio read model imports.

**Deliverables:** USD currency lock in createEntity + workspaceSettings; dead fxRate removal; convex/portfolioMoney.ts (sumUsdMinor) + unit test

**Verify.** pnpm -w typecheck && unit test (non-USD create rejected; sumUsdMinor integer math); grep confirms no production fxRate write/read and no float math on stored amounts.

### E5-T5 — Intercompany transfer detection + flagging between workspace entities (E5 OWNS the detector)
`size: L` · `risk: med` · `depends on: E5-T1`

**Intent.** Detect money moving between the workspace's own entities (Zikra↔Z360) and classify it as an intercompany transfer — never income/expense (decided: see decisions.md Q23/Q27, Ansar #6) — so consolidation (T7) can eliminate it. E5 is the single owner of intercompany detection; E1/E4/E6/E9 consume the flag. Scope is **workspace-internal only**: an intercompany move is a leg whose matched counter-leg lives in a `bankAccounts` row owned by a *different entity in the same workspace*; movement to an account that is NOT an OpenBooks entity is a normal transaction (decided: see decisions.md Q27).

**Changes**

- Add convex/intercompany.ts: a detector that **widens the existing transfer matcher across all workspace entities** (reuse pipeline.ts transfer-match concepts; do not re-invent). The primary signal is an owned counter-leg in a different same-workspace entity. Tolerances (QBO-parity, decided: see decisions.md): **exact amount within ±$1 (100 minor units), ±5 calendar days, opposite sign, 1:1 first.** Confidence tiers: high → auto-classify as intercompany; medium → Inbox "Intercompany transfer between Zikra and Z360?"; one-leg-seen → leave normal, re-evaluate later.
- Add schema: `intercompanyPairId` on the txn/journalEntry layer (mirrors the existing `transferPairId`) so consolidation can key elimination off it; plus reciprocal accounts `1300 Due from Affiliate` / `2300 Due to Affiliate` (balance-sheet only — intercompany NEVER hits P&L). Add an intercompanyLinks table (workspaceId, fromEntityId, toEntityId, fromTxnId, toTxnId, amountMinor, currency `"USD"`, status: 'suggested'|'confirmed'|'rejected', `intercompanyPairId`, createdAt) with by_workspace + by_status indexes. Metadata only; never edits posted journal lines.
- Add mutations confirmIntercompany / rejectIntercompany (business.manage) that flip status, set/clear `intercompanyPairId`, and write audit events. Add a query listIntercompanySuggestions(scope) for the UI.
- Surface suggestions in the Portfolio dashboard (T6) and/or Inbox as 'Looks like a transfer between your businesses — confirm?' Do NOT auto-eliminate unconfirmed pairs in legal/single-entity reports.

**Files:** `convex/intercompany.ts (new)`, `convex/schema.ts (intercompanyPairId + intercompanyLinks table; 1300/2300 reciprocal accounts in CoA seed)`, `convex/pipeline.ts:1-80 (reuse/widen transfer-match heuristics; read-only)`, `apps/web/src/components/openbooks/CoreScreens.tsx (Inbox surface, optional)`

**Definition of done**

- [ ] A unit test seeds an outflow on entity A and a matching inflow on entity B (within ±$1 / ±5 days, opposite sign) and asserts the detector yields exactly one high/medium intercompanyLink with correct from/to, amount, and an `intercompanyPairId`; a non-matching pair (outside tolerance) yields none.
- [ ] confirmIntercompany sets status='confirmed' + `intercompanyPairId` and writes audit; rejectIntercompany sets 'rejected' and clears it; both re-check business.manage on the workspace.
- [ ] Detection never writes to journalEntries/journalLines (git diff shows no ledger writes); intercompany pairs are pure metadata and never produce a P&L line (1300/2300 are balance-sheet).
- [ ] listIntercompanySuggestions returns suggestions scoped to the caller's workspace only.

**Deliverables:** convex/intercompany.ts; intercompanyPairId + intercompanyLinks schema + indexes; 1300/2300 reciprocal accounts; confirm/reject mutations; detection unit test

**Verify.** pnpm -w typecheck && unit test for detector (±$1/±5d tiers) + confirm/reject; manual: seed a Zikra→Z360 transfer, see one suggestion, confirm it, verify an `intercompanyPairId` is set and no P&L line appears.

### E5-T6 — Portfolio roll-up read model + Portfolio dashboard query (combined cash/AR/AP/revenue/expense/runway + by-business)
`size: L` · `risk: high` · `depends on: E5-T2, E5-T4, E5-T5`

**Intent.** Build the backend read model that sums per-entity ledgers into one portfolio view in USD, plus the by-business breakdown the dashboard tiles need — reusing existing per-entity computations, not re-deriving the ledger.

**Changes**

- Add convex/portfolioViews.ts exporting portfolioDashboard({scope}) using scopeValidator (T2). It loads all active non-archived entities for the membership's workspace, and for EACH entity re-checks authz then computes the same primitives coreViews.dashboard already computes (cash from LEDGER not live Plaid — see T8 dependency note; AR open, AP open, revenue, expense, runway from ledger journalLines). All amounts are USD integer minor units — sum directly via portfolioMoney.sumUsdMinor (T4); no FX conversion, no `unconverted` flag (decided: see decisions.md Q24/Q25).
- Return { combined: {cashMinor, arMinor, apMinor, revenueMinor, expenseMinor, runwayDays}, byBusiness: [{entityId,name,...sameMetrics, drilldownHref}], intercompanySuggestions (T5) }. Aggregate runway as combined net burn / combined cash, documented.
- Factor the per-entity metric block out of coreViews.dashboard into a shared helper (e.g. convex/entityMetrics.ts) so single-entity and portfolio paths share ONE computation and can't drift; coreViews.dashboard calls the helper for a single entity.
- Bound reads with explicit .take() limits per entity (mirror existing DASHBOARD_LIMIT) and document the cap; for a 2-entity workspace this is comfortably within limits.

**Files:** `convex/portfolioViews.ts (new)`, `convex/entityMetrics.ts (new — extracted from coreViews.ts:104-300)`, `convex/coreViews.ts:104-300`, `convex/entityScope.ts (scopeValidator)`, `convex/portfolioMoney.ts`

**Definition of done**

- [ ] portfolioDashboard(scope='all') returns combined totals that equal the sum of byBusiness per-entity figures (within rounding) in USD; a unit test with two seeded entities asserts combined.cashMinor == entityA.cashMinor + entityB.cashMinor (plain USD summation).
- [ ] coreViews.dashboard for a single entity returns the SAME per-entity numbers as that entity's byBusiness row (shared helper — a test asserts equality).
- [ ] All reads are bounded by .take() and scoped to the caller's workspace entities only.

**Deliverables:** convex/portfolioViews.ts; convex/entityMetrics.ts (shared helper); portfolio rollup unit test (USD summation); coreViews refactor to shared helper

**Verify.** pnpm -w typecheck && unit tests (combined==sum; single==byBusiness row); manual: call portfolioDashboard in Convex dashboard, inspect combined vs byBusiness.

### E5-T7 — Consolidated reports with intercompany elimination (scope=all P&L / Balance Sheet)
`size: L` · `risk: high` · `depends on: E5-T4, E5-T5, E5-T6`

**Intent.** Let reportViews.reportPack run in portfolio scope by consolidating per-entity statements and eliminating CONFIRMED intercompany activity, so an internal Zikra→Z360 move is not counted as group revenue/expense (ASC 810-style elimination).

**Changes**

- Extend reportViews.reportPack args to accept scope (scopeValidator) in addition to entityId (reportViews.ts:449). When scope='all', load each active entity, compute its existing per-entity report lines (reuse the current single-entity report code path per entity) — all USD, no conversion (decided: see decisions.md Q32) — then merge by account code/TYPE/standardized line. USD-only consolidation = `SUM by account code − eliminated pairs`.
- Apply consolidation eliminations as a **read-time filter keyed on `intercompanyPairId`** (T5): exclude pairs whose BOTH legs are in scope (no stored elimination journals), and emit an explicit 'Intercompany eliminated: −$X' line showing the removed amount (decided: see decisions.md Q33). Single-entity (legal) reports are UNCHANGED — Due-from/Due-to (1300/2300) stay on the books; eliminations apply only to consolidated output.
- Replace the REPORT_LIMIT=5000 (.take) per-entity with a bounded-but-paged read so consolidation doesn't silently truncate (the real `.take(5000)` truncation fix is owned by E1-T5 — decided: see decisions.md Q34; at minimum document and assert the cap per entity here).
- Return a consolidatedFrom: [entityIds] + eliminatedMinor on the pack so the UI can render the 'Consolidated across N businesses, $X eliminated' banner.

**Files:** `convex/reportViews.ts:449-520`, `convex/reportViews.ts:32 (REPORT_LIMIT)`, `convex/intercompany.ts`, `convex/portfolioMoney.ts`, `convex/entityScope.ts`

**Definition of done**

- [ ] reportPack(scope='all') for two entities returns a P&L whose pre-elimination revenue equals sum of both entities' revenue, and whose post-elimination revenue excludes any confirmed intercompany amount; a unit test asserts the eliminated amount appears as its own line and reduces the consolidated total.
- [ ] Single-entity reportPack output is byte-for-byte unchanged for an entityId call (a test asserts no diff vs. baseline) — legal separation preserved.
- [ ] consolidatedFrom + eliminatedMinor are present on the pack only in scope=all.
- [ ] No silent truncation: per-entity read either pages fully or asserts count < cap and surfaces a 'truncated' flag.

**Deliverables:** consolidated reportPack path; intercompany elimination logic + line; consolidation unit test; single-entity-unchanged regression test

**Verify.** pnpm -w typecheck && unit tests (consolidated==sum-minus-eliminations; single unchanged); manual: confirm a Zikra→Z360 transfer, run consolidated P&L, see eliminations line.

### E5-T8 — Portfolio dashboard UI + per-page portfolio behavior + reconcile cash source
`size: L` · `risk: med` · `depends on: E5-T6, E5-T7`

**Intent.** Render the Portfolio dashboard (by-business tiles that drill into each LLC) when scope='all', make each screen react to scope, and fix the cash-source inconsistency so portfolio cash reconciles with the ledger (blueprint RC7).

**Changes**

- In CoreScreens.tsx dashboard (CoreScreens.tsx:245-260) branch on scope: when 'all', call api.portfolioViews.portfolioDashboard and render a Portfolio layout — combined tiles (cash, AR, AP, revenue, expense, runway) + a by-business breakdown grid where each card links to that entity's single dashboard (selectEntity(id) + navigate). Reuse DashboardViz where sensible.
- Wire scopeArg(scope) (T2) so each screen sends scope='all' to its view; for screens without a portfolio backend yet (income/expenses/module), show a clear 'Pick a business to see this' empty state or a combined list when cheap — do not silently show one entity's data while labeled 'All businesses'.
- Reports screen (ReportsScreen.tsx:1590) passes scope to reportPack and renders the 'Consolidated across N businesses, $X eliminated' banner from consolidatedFrom/eliminatedMinor (T7).
- Reconcile cash: in entityMetrics (T6), compute portfolio/per-business cash from LEDGER cash-account balances (not live Plaid balanceMinor at coreViews.ts:180) so dashboard cash == report cash; keep the live-balance figure as a separate 'bank-reported' sub-line if useful. Add the intercompany 'confirm transfer?' surface (T5) to the portfolio view.
- Surface 'Set as default business' + per-connection business mapping entry points (links into T9 Connections UI).

**Files:** `apps/web/src/components/openbooks/CoreScreens.tsx:245-260`, `apps/web/src/components/openbooks/CoreScreens.tsx:1450-1460`, `apps/web/src/components/openbooks/ReportsScreen.tsx:1585-1610`, `apps/web/src/components/openbooks/dashboard/DashboardViz.tsx`, `convex/entityMetrics.ts:cash (from T6)`, `convex/coreViews.ts:180`

**Definition of done**

- [ ] With scope='All businesses', the dashboard shows combined tiles + a by-business grid (Zikra, Z360); clicking a business card switches scope to that entity and navigates to its dashboard.
- [ ] Reports in scope=all render the consolidation banner with the eliminated amount from T7.
- [ ] Portfolio cash tile equals the sum of per-entity LEDGER cash balances (a test or manual check shows dashboard cash == balance-sheet cash for each entity, not the live Plaid number).
- [ ] No screen labels content 'All businesses' while actually showing a single entity's data; unsupported screens show an explicit empty/aggregate state.
- [ ] Mobile: the portfolio dashboard is responsive (tiles stack), not a squeezed desktop grid.

**Deliverables:** Portfolio dashboard layout; by-business drill-down cards; consolidation banner in Reports; ledger-cash reconciliation; portfolio + mobile screenshots

**Verify.** pnpm -w lint && pnpm -w typecheck; agent-browser: select All businesses → see combined + by-business tiles, click Z360 → lands on Z360 dashboard; verify cash tile == that entity's balance sheet cash.

### E5-T9 — First-class bank/Stripe→business association (re-map mutation + Connections UI)
`size: M` · `risk: med` · `depends on: E5-T1`

**Intent.** Make which business a bank/Stripe connection belongs to editable after creation, since Ansar's single Plaid login spans both LLCs and his two Stripe accounts map to different entities — today entityId is fixed at creation with no re-map path.

**Changes**

- Add convex/connections.ts mutations reassignBankAccountEntity({bankAccountId, entityId}) and reassignStripeAccountEntity({stripeAccountId, entityId}), each guarded by requireWorkspacePermission(targetEntity.workspaceId,'business.manage') AND verifying both the source and destination entities are in the SAME workspace (no cross-workspace move). Re-point the connection's ledger account linkage appropriately (bankAccounts.ledgerAccountId / stripeAccounts.clearingAccountId) by mapping to the destination entity's corresponding ledger account, or block re-map if that would orphan posted lines and instead require a documented guarded path. Write audit events.
- Guardrail (decided: see decisions.md Q26): if the account already has POSTED journal lines under the current entity, do not silently move history (posted entries are immutable). **Scope the re-map to FUTURE syncs only** — posted lines stay under the original entity, the change is recorded, and a clear note is surfaced. Assert this future-only behavior in a test. (Revisit the block-instead alternative only if Ansar asks.)
- In the Connections settings UI (apps/web ConnectionsSection / AddBankSheet.tsx / StripeConnectSheet.tsx) show a 'Business' selector on each connection row and call the new mutation; show the destination business label and currency. During Plaid account mapping, let the user assign each discovered account to a business (Zikra vs Z360).
- Backfill/repair note: provide a one-off internal mutation/script to set entityId on any connection currently mis-assigned for Ansar's real data, documented in the ticket output.

**Files:** `convex/connections.ts`, `convex/schema.ts:233-247 (bankAccounts) `, `convex/schema.ts:708+ (stripeAccounts)`, `apps/web/src/components/openbooks/settings/ConnectionsSection.tsx`, `apps/web/src/components/openbooks/AddBankSheet.tsx`, `apps/web/src/components/openbooks/StripeConnectSheet.tsx`

**Definition of done**

- [ ] reassignBankAccountEntity / reassignStripeAccountEntity move a connection to another business in the SAME workspace, re-check business.manage, reject cross-workspace targets, and write audit events; a unit test proves a cross-workspace target throws.
- [ ] An account with posted journal lines is re-mapped **future-syncs-only** (decided: see decisions.md Q26); a test asserts posted lines stay under the original entity (never silently re-parented) and the change is recorded.
- [ ] Connections UI shows each connection's business and lets an owner change it; Plaid mapping screen assigns each discovered account to Zikra or Z360.
- [ ] After re-map, that connection's future synced transactions land under the new entity (verified by the entityId on a subsequently-created transaction).

**Deliverables:** reassign mutations (bank + stripe); Connections UI business selector + Plaid account→business mapping; immutability guardrail + test; backfill note for real data

**Verify.** pnpm -w typecheck && unit tests (reassign happy path + cross-workspace reject + posted-lines guard); manual: in Connections, move a bank account from Zikra to Z360, confirm audit event + new entityId.

### E5-T10 — Multi-entity authorization hardening + scope=all authz tests
`size: M` · `risk: med` · `depends on: E5-T6, E5-T7`

**Intent.** Guarantee that running any view in scope='all' re-checks the caller's role on EVERY entity it aggregates and never leaks across workspaces — the explicit DoD that authz holds when scope=all.

**Changes**

- Audit portfolioViews.portfolioDashboard (T6), reportViews consolidated path (T7), and intercompany queries (T5): ensure each per-entity branch calls requireWorkspaceRole(ctx, entity.workspaceId, 'member') (or higher) BEFORE reading that entity's rows, and that the entity set is derived strictly from the caller's membership.workspaceId (never a client-supplied entity list that could cross workspaces).
- Add a thin assertScopeAuthorized(ctx, membership, scope) helper in entityScope.ts that, for scope='all', returns only entities in the caller's workspace; for {entityId}, verifies the entity belongs to the caller's workspace; reject otherwise. Route all multi-entity reads through it.
- Add Convex tests: (a) a user who is a member of workspace A cannot see workspace B's entities via portfolioDashboard/reportPack scope=all (returns only A's data or throws); (b) an hr/member role is correctly gated on books reads (canViewBooks parity with single-entity); (c) passing a foreign entityId throws.
- Document the authz contract in a short comment block atop entityScope.ts and reference it from each consumer.

**Files:** `convex/entityScope.ts`, `convex/portfolioViews.ts`, `convex/reportViews.ts:449-520`, `convex/intercompany.ts`, `convex/authz.ts:140-230 (requireWorkspaceRole/requireAnyWorkspaceRole)`, `convex/portfolio.authz.test.ts (new)`

**Definition of done**

- [ ] A test proves a workspace-B user calling portfolioDashboard/reportPack(scope='all') receives zero workspace-A rows (or an authz error) — no cross-workspace leakage.
- [ ] Every per-entity read in the portfolio/consolidated paths is preceded by a workspace-role check derived from membership.workspaceId, not client input; a code review + grep confirms no scope=all path reads entities outside requireAnyWorkspaceRole's workspace.
- [ ] Role gating parity: hr/member roles are blocked from portfolio books reads exactly as they are from single-entity reads.
- [ ] entityScope.ts documents the authz contract and assertScopeAuthorized is the single entry for resolving the authorized entity set.

**Deliverables:** assertScopeAuthorized helper; authz hardening across portfolio/consolidated/intercompany; convex/portfolio.authz.test.ts; authz contract doc comment

**Verify.** pnpm -w typecheck && the new convex/portfolio.authz.test.ts passes (cross-workspace denied, foreign entityId throws, role gating); code-review skill on the diff finds no unauthorized read.

## Decisions applied

All prior open questions for this epic are resolved in **[../decisions.md](../decisions.md)** (governing contract: `rebuild/ANSAR-DECISIONS.md`). Summary of what's baked into the tickets above:

- **FX / base currency (Q24/Q25, Ansar #3):** CUT — the general ledger is **USD-only**. No FX provider, no base-currency engine, no per-currency normalization, no 'unconverted' badge, no stale-rate policy. The portfolio roll-up is plain USD summation; entity/workspace currency is locked to USD; the dead `journalLines.fxRate` field is removed. (T4 rewritten; T6/T7 desk-currency references removed.)
- **Intercompany scope (Q27, Ansar #6):** **workspace-internal only** — a matched counter-leg in a `bankAccounts` row owned by a different same-workspace entity. Movement to a non-OpenBooks account is a normal transaction. (T5.)
- **Intercompany handling (Q23/Q33, Ansar #6):** cross-entity transfers are classified as intercompany (never income/expense), high/medium/one-leg tiers, tolerances ±$1 / ±5 days / opposite sign / 1:1; consolidated reports **ELIMINATE** via read-time filter keyed on `intercompanyPairId`; standalone view keeps Due-from/Due-to (1300/2300) on the books. (T5/T7.)
- **Class/tag tracking within an entity (Q28):** **DEFERRED** — out of go-live scope. (Not ticketed.)
- **Consolidated-report role gating (Q29):** mirror single-entity 'member can view books'; eliminations need no stricter role. (T10.)

**Still genuinely needs Ansar (light, has a default):**
- **Re-map an account with posted history (Q26).** Default applied in T9 = **future-syncs-only re-mapping** (posted lines stay under the original entity; immutability preserved). Only revisit if Ansar prefers the alternative of *blocking* re-map for accounts that already have posted activity.
