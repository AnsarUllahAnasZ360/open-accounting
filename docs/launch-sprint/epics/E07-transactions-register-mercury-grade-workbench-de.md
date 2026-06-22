# E7 — Transactions register & Mercury-grade workbench: density, responsiveness, provenance, and edit clarity

> Part of the **OpenBooks Launch Sprint**. Master plan: [../README.md](../README.md) · Backlog: [../backlog.md](../backlog.md)

**Goal.** Make the Transactions register honest, compact, and fully responsive: move the long raw description behind an expand affordance so rows stay tight, render a correct provenance chip for every decision (Rule / Memory / Matched / Transfer / AI 0.92 / Imported) instead of an AI-only badge, fix the column layout so phones get a clean card list with no horizontal scroll, sharpen inline category edit + bulk + keyboard actions, make split/exclude/recategorize read as reverse+repost, polish saved views/filters/group/sort, and mount the one per-page insight banner (coordinated with E8). Keep the existing WorkbenchSurface/OpenBooksDataTable architecture; this epic fixes density, responsiveness, and provenance clarity on top of it.

**Why it matters.** The register is where Ansar will live every day to run his real books across two LLCs. Today every merchant row carries a second-line raw bank description (apps/web/src/components/openbooks/CoreScreens.tsx:2188) that eats horizontal space and makes the table feel cramped, the only provenance shown is an AI badge — so the ~78-80% of decisions that came from a rule, memory, a matched transfer, or an import are silently unlabeled even though the data exists (transactions.decidedBy enum in convex/schema.ts:441 already distinguishes transfer/match/rule/memory/plaid_prior/ai/needs_review) — and the table relies on horizontal scroll plus priority-column hiding that has never been hardened for phones. The product's credibility rests on the owner trusting WHY each transaction landed where it did and being able to fix it in one tap; the blueprint calls this out directly ("Show a provenance line on every decision — Matched your rule / Same as your last 6 AWS charges / AI 0.82 — review", docs/finishing/accounting-engine-blueprint.md:401). A compact, provenance-honest, mobile-real register is the difference between a demo and a tool he runs his businesses on.

## Current state

The register is rendered by TransactionsScreen (apps/web/src/components/openbooks/CoreScreens.tsx:1587) through the shared driver WorkbenchSurface (apps/web/src/components/openbooks/workbench/WorkbenchSurface.tsx) over OpenBooksDataTable (apps/web/src/components/openbooks/workbench/OpenBooksDataTable.tsx). Rows come from convex/coreViews.ts transactions query (line 613), capped at 120 client rows; the row payload (line 844) carries decidedBy/confidence/reasoning/source/review/entryId/hasInboxItem/receipt/attachmentCount/lines but NO explicit provenance label. CONFIRMED GAPS: (1) the Merchant column (CoreScreens.tsx:2177) renders row.rawDescription as a permanent muted second line (line 2188) — the description that "eats space"; there is no expand toggle. (2) Provenance: the table only shows an AiInsightBadge when decidedBy==="ai" (CoreScreens.tsx:2190); rule/memory/match/transfer/plaid_prior decisions render no chip even though decidedBy exists (schema.ts:441). The Status column (CoreScreens.tsx:2270) only shows attention or a generic "Posted/Excluded" dot. (3) Responsiveness: OpenBooksDataTable hides columns via priority (1=hidden below lg, 2=hidden below xl, OpenBooksDataTable.tsx:424-425,478-479) and wraps the desktop table in overflow-x-auto (line 392); the mobile card path (line 501) stacks ALL non-primary columns including the inline category combobox and attachment button, which is heavy. expectNoHorizontalScroll exists as the e2e guard (tests/e2e/core-screens.spec.ts). (4) Inline category edit works (InlineCategoryCombobox, capped max-w-[14rem]) and posts via recategorizeTransaction (reverse+repost). Bulk approve/recategorize/exclude exist (CoreScreens.tsx:1882-1955) but bulkRecategorize hardcodes a single "other income" target (line 1937) rather than letting the user pick; there is no keyboard model in the register (unlike the Inbox, which has J/K/Enter/E at CoreScreens.tsx:880). (5) The detail drawer (TransactionDetail, CoreScreens.tsx:2539) shows the double-entry record, recategorize, split, exclude, and activity, but split/exclude language is buried and the reverse+repost story is only in helper copy. (6) Saved views/filters/group/sort are rich (BUILTIN_TX_VIEWS:1518, filterFacets:2126, GroupByMenu/SortMenu/DisplaySettingsMenu) but saved views are FE-only localStorage (useSavedViews) and there is overlap/duplication between the FilterPanelButton and the standalone pills. (7) The per-page insight banner: TransactionsInsights is wired only as the separate "Insights" sub-tab (config.insights at CoreScreens.tsx:2359); InsightsBand (workbench/InsightsBand.tsx) and the server insights aggregate (coreViews.ts:827) exist but are NOT mounted as a compact banner above the register. (8) Hardcoded demo dates leak into the register (manualDate "2026-06-30" at CoreScreens.tsx:1627, dateRangeValueToISO fallback "2026-06-30" at line 1638), which will desync once real time is used.

## Definition of done (epic)

- [ ] The merchant column no longer renders rawDescription as a permanent second line; the long raw description is reachable only via an expand affordance (row-detail expand toggle and/or the detail drawer), and the register row height shrinks measurably (compact density baseline) with no visual regression in e2e screenshots.
- [ ] Every transaction row shows a single, correct provenance chip derived from decidedBy: Rule, Memory, Matched (transfer/match), Imported (plaid_prior), AI N% (with confidence), or Needs review — verified by a unit/e2e assertion that a rule-decided and a memory-decided row each show their own chip, not the AI badge.
- [ ] On a 390px viewport the register renders as a stacked card list with NO horizontal scroll (expectNoHorizontalScroll passes), the inline category control and provenance chip remain usable on the card, and money stays right-aligned with tabular figures.
- [ ] Inline category edit, bulk approve/recategorize/exclude, and a register keyboard model (at minimum row navigation + open + a documented quick action) all work and post through the existing single ledger path (reverse+repost), proven by the H1 core register e2e flow staying green.
- [ ] Bulk recategorize lets the user choose a target category (no silent hardcoded 'other income'); the chosen-category bulk path posts reverse+repost for each row and reports a count.
- [ ] The detail drawer clearly frames split / exclude / recategorize as reverse+repost corrections (immutable-entry language), and the double-entry record + activity history continue to render with balanced lines.
- [ ] Exactly one compact insight banner is mounted above the register (not the full Insights tab), reading the server insights aggregate for the active filtered period; it consumes E8's reusable `InsightBanner` contract (E8 owns the component — decided: see decisions.md Q37) rather than introducing a second banner implementation.
- [ ] No hardcoded demo date ('2026-06-30') remains as a silent default in the register's manual-add / range fallback; defaults derive from the single shared server-clock `today`/`asOf` helper landed by E8-T1 (decided: see decisions.md Q38) — browser clock for FE display, server `asOf` for query bodies.
- [ ] Gates green: pnpm -w typecheck, lint, build, unit, and the transactions/workbench e2e specs (tests/e2e/core-screens.spec.ts H1 flow + redesign-workbench-harness) all pass; ledger posting path (convex/ledger.ts) is unchanged.

## Tickets (11)

### E7-1 — Surface a typed provenance label from the transactions query
`size: S` · `risk: low` · `depends on: —`

**Intent.** Provenance data (decidedBy) already exists per-row but the UI has to re-derive meaning. Add one server-computed provenance descriptor so every consumer (register chip, card, drawer) renders the same vocabulary, and stop leaking the raw enum string ('Decided by ai').

**Changes**

- In convex/coreViews.ts transactions handler row map (around line 844-879), add a `provenance` object to each row: { kind: 'rule'|'memory'|'match'|'transfer'|'imported'|'ai'|'needs_review'|'manual', label: string, confidence: number|null, count: number|null } derived from transaction.decidedBy (schema.ts:441), source, and review. Map plaid_prior→'imported', transfer/match→'match' family with distinct labels ('Matched transfer' vs 'Matched a Stripe payout'), missing decidedBy + source 'manual'→'manual'.
- Provenance copy is sentence-style and count-aware where the count is cheap (decided: see decisions.md Q36): 'Same as your last 6 AWS charges', 'Matched your rule', 'Matched a Stripe payout'; carry a `count` (e.g. memory-streak length / prior-decision count, null when unavailable) so the chip can render the sentence, and fall back to the one-word chip when no count is available.
- Keep the existing raw decidedBy/confidence/reasoning fields for back-compat; provenance is additive so no caller breaks.
- Author a tiny pure helper (e.g. convex/lib/provenance.ts or inline) `describeProvenance(decidedBy, source, review)` returning the label so it is unit-testable; export it for reuse by the eval/test.
- Write a unit test asserting describeProvenance covers all seven decidedBy values + the manual fallback with stable labels.

**Files:** `convex/coreViews.ts:613`, `convex/coreViews.ts:844`, `convex/schema.ts:441`, `convex/lib/provenance.ts (new)`

**Definition of done**

- [ ] transactions query rows include a `provenance` field with { kind, label, confidence, count } for every row.
- [ ] describeProvenance returns a distinct, sentence-style count-aware human label for transfer/match/rule/memory/plaid_prior/ai/needs_review ('Same as your last 6 AWS charges' / 'Matched your rule' / 'Matched a Stripe payout' when a count is present), the one-word chip fallback when no count, and a 'Manual entry' fallback (decided: see decisions.md Q36).
- [ ] A unit test covers all enum values and the fallback and passes under pnpm -w test.
- [ ] Existing transactions query consumers still typecheck (additive change only).

**Deliverables:** Edited convex/coreViews.ts; New helper convex/lib/provenance.ts; New unit test for describeProvenance

**Verify.** pnpm -w typecheck && pnpm -w test (run the new provenance unit test); inspect the transactions query result shape in the Convex dashboard or a temporary log to confirm provenance is populated for a rule-decided and an ai-decided row.

### E7-2 — ProvenanceChip component in the workbench design vocabulary
`size: S` · `risk: low` · `depends on: E7-1`

**Intent.** Replace the AI-only badge with one quiet, brand-correct chip that renders any provenance kind (Rule / Memory / Matched / Imported / AI N% / Needs review) consistently in the table, the mobile card, and the drawer.

**Changes**

- Create apps/web/src/components/openbooks/workbench/ProvenanceChip.tsx: a small Badge-based chip keyed off provenance.kind, reusing the token classes already used by AttentionState (AttentionState.tsx:46) and AiInsightBadge (ai-surface/text-ai for AI). No purple/gradient; AI stays the quiet green ai-surface, rule/memory/match are neutral muted, needs_review uses warning-surface.
- For kind 'ai', keep the popover-on-click 'why this' behavior by composing AiInsightBadge variant='chip' (confidence + reasoning) so the existing explanation UX is preserved; for non-AI kinds render a labeled icon chip (Tags for rule, Sparkles only for ai, ArrowLeftRight for match/transfer, Landmark/Plug for imported) that prefers the sentence-style count-aware label from provenance.label when present and falls back to the one-word kind name (decided: see decisions.md Q36).
- Export ProvenanceChip from workbench/index.ts.
- Add a Storybook-free render smoke (or a tiny RTL test) asserting each kind renders its label.

**Files:** `apps/web/src/components/openbooks/workbench/ProvenanceChip.tsx (new)`, `apps/web/src/components/openbooks/workbench/AiInsightBadge.tsx`, `apps/web/src/components/openbooks/workbench/AttentionState.tsx:46`, `apps/web/src/components/openbooks/workbench/index.ts`

**Definition of done**

- [ ] ProvenanceChip renders a distinct labeled chip for rule/memory/match/transfer/imported/ai/needs_review/manual using only design-system tokens (no new colors, no gradients).
- [ ] The 'ai' kind preserves the click-to-explain popover (confidence + humanized reasoning).
- [ ] Component is exported from the workbench barrel and covered by a render test that passes.

**Deliverables:** New ProvenanceChip.tsx; Updated workbench/index.ts; Render test

**Verify.** pnpm -w typecheck && lint; run the component render test; visually confirm in the running app (pnpm dev:full) that a rule row and an AI row show different chips.

### E7-3 — Compact merchant column: move raw description behind an expand toggle
`size: M` · `risk: med` · `depends on: E7-2`

**Intent.** The permanent second-line rawDescription (CoreScreens.tsx:2188) is the owner-reported 'description eats too much space' problem. Collapse the row to merchant + provenance only; reveal the raw bank description on demand via an inline expand toggle (row-detail), and always in the drawer.

**Changes**

- In TransactionsScreen columns (CoreScreens.tsx:2177 merchant column), remove the always-on rawDescription line. Render merchant + ProvenanceChip (from E7-2) compactly. Add a per-row expand chevron (a small ghost button, stopPropagation) that toggles an inline detail strip showing the full rawDescription, contact, account, and source without opening the full drawer.
- Hold expanded-row ids in TransactionsScreen state (e.g. a Set<string>) and pass an optional `renderExpanded`/`expandedIds` capability into OpenBooksDataTable, or implement the expansion as a controlled second TableRow beneath the row (progressive disclosure pattern). Keep the full TransactionDetail drawer for the complete record.
- Ensure the expand toggle is keyboard reachable and does not trigger the row's onRowClick (drawer).
- Switch the register's default density baseline to feel compact now that the second line is gone; keep DisplaySettingsMenu density toggle working.
- Update tests/e2e/core-screens.spec.ts openTransactionDrawer if the merchant cell index shifts (it clicks td nth(2)).

**Files:** `apps/web/src/components/openbooks/CoreScreens.tsx:2177`, `apps/web/src/components/openbooks/CoreScreens.tsx:2188`, `apps/web/src/components/openbooks/workbench/OpenBooksDataTable.tsx:450`, `tests/e2e/core-screens.spec.ts:63`

**Definition of done**

- [ ] The merchant cell no longer renders rawDescription as a permanent line; only merchant + provenance chip show by default.
- [ ] An expand toggle reveals the raw description (and contact/account/source) inline without opening the drawer, and collapses again; it is keyboard accessible and does not open the drawer.
- [ ] Row height in the default register is visibly shorter than before (screenshot diff in evidence).
- [ ] The H1 core register e2e flow still opens the drawer correctly (cell index updated if needed) and stays green.

**Deliverables:** Edited CoreScreens.tsx (merchant column + expand state); Possibly extended OpenBooksDataTable expansion capability; Updated e2e selector if needed; Before/after register screenshot

**Verify.** pnpm -w typecheck && lint && build; run tests/e2e/core-screens.spec.ts (H1); capture a before/after screenshot of the register at 1440px showing reduced row height.

### E7-4 — Provenance + status column correctness and de-duplication
`size: S` · `risk: low` · `depends on: E7-1, E7-3`

**Intent.** With provenance now on the merchant cell, the Status column must read cleanly (posted vs needs-review vs excluded vs unposted) without double-printing the AI signal, and attention must stay consistent with the shared AttentionState vocabulary.

**Changes**

- Rework the Status column cell (CoreScreens.tsx:2270) so it shows the canonical AttentionState when present (needs-review / unposted / low-confidence) and otherwise a quiet Posted/Confirmed/Excluded indicator — without repeating the AI confidence already shown by the provenance chip.
- Confirm rowAttention (CoreScreens.tsx:1473) still drives the trailing attention column and the drawer attention; ensure 'unposted' (entryId null) is visible since the blueprint flags ~78-80% unposted as the core data problem.
- Make the AI filter facet (CoreScreens.tsx:2134) and provenance consistent: 'AI-decided' filters provenance.kind==='ai'; add provenance-aware client filtering if needed so a 'Rule' / 'Memory' filter is possible (optional facet).
- Keep the existing chips/removeChip plumbing intact.

**Files:** `apps/web/src/components/openbooks/CoreScreens.tsx:2270`, `apps/web/src/components/openbooks/CoreScreens.tsx:1473`, `apps/web/src/components/openbooks/CoreScreens.tsx:2134`

**Definition of done**

- [ ] Status column shows exactly one of: an AttentionState chip (needs-review/unposted/low-confidence) or a quiet Posted/Confirmed/Excluded indicator — never duplicating the AI % already on the provenance chip.
- [ ] Unposted rows (entryId null, not excluded) visibly read as 'Not posted'.
- [ ] Filtering by AI-decided matches provenance.kind==='ai'; no regression in existing chips/clear-all behavior.
- [ ] No console warnings; typecheck/lint clean.

**Deliverables:** Edited Status column + filter wiring in CoreScreens.tsx

**Verify.** pnpm -w typecheck && lint; in the running app, filter to 'Needs review' and confirm those rows show the warning chip and unposted rows show 'Not posted'; confirm an AI-decided row shows the AI chip once.

### E7-5 — Mobile-real register: clean card list, priority columns, no horizontal scroll
`size: M` · `risk: med` · `depends on: E7-3`

**Intent.** On phones the stacked card currently dumps every non-primary column (including the inline category combobox and attachment +) as label/value rows, which is heavy and risks overflow. Make the card a deliberate, minimal layout: merchant + provenance headline, right-aligned amount, category + date as a compact meta row, expand for the rest — with a hard no-horizontal-scroll guarantee.

**Changes**

- In OpenBooksDataTable mobile card path (OpenBooksDataTable.tsx:501-571), let a column opt into a compact card slot vs the verbose label/value list. Add an optional ColumnDef field like `mobileHidden?: boolean` or `mobileMeta?: boolean` (ColumnDef at OpenBooksDataTable.tsx:35) so the register can mark contact/account/status as expand-only on mobile and keep category/date in a single meta line.
- In the register columns config, set the inline category to render as a tap target sized for touch on the card and ensure the amount stays mobileTrailing (already at CoreScreens.tsx:2238).
- Audit the priority breakpoints: confirm category (priority 1) and contact/status (priority 2) hide cleanly at lg/xl on desktop and are reachable via expand on mobile; ensure no min-width forces horizontal scroll on the desktop table at 1024-1280px.
- Add an e2e assertion at 390px using the existing expectNoHorizontalScroll helper specifically on /transactions with rows present (the current H1 test only checks dashboard at 390px).

**Files:** `apps/web/src/components/openbooks/workbench/OpenBooksDataTable.tsx:35`, `apps/web/src/components/openbooks/workbench/OpenBooksDataTable.tsx:500`, `apps/web/src/components/openbooks/CoreScreens.tsx:2168`, `tests/e2e/core-screens.spec.ts:168`

**Definition of done**

- [ ] At 390px /transactions renders a card list with merchant+provenance, right-aligned amount, and a single compact category/date meta line; secondary fields are behind an expand, not a long label/value stack.
- [ ] expectNoHorizontalScroll passes on /transactions at 390px WITH rows present (new e2e assertion).
- [ ] Desktop table shows no horizontal scrollbar at 1024px and 1280px for the default visible columns.
- [ ] Inline category combobox is tappable on the card (adequate touch target).

**Deliverables:** Extended ColumnDef + mobile card rendering in OpenBooksDataTable.tsx; Updated register column config; New 390px no-scroll e2e assertion; Mobile register screenshot

**Verify.** pnpm -w typecheck && lint && build; run the updated core-screens e2e; manually resize to 390px and confirm no horizontal scroll and a clean card; capture a 390px register screenshot to evidence.

### E7-6 — Bulk recategorize with a chosen category + register keyboard model
`size: M` · `risk: med` · `depends on: E7-3`

**Intent.** Bulk recategorize silently routes everything to a hardcoded 'other income' account (CoreScreens.tsx:1937), which is wrong for a real workflow. Let the user pick the target, and add a documented keyboard model so power use matches the Inbox.

**Changes**

- Replace the hardcoded otherIncomeCategoryId target in bulkRecategorize (CoreScreens.tsx:1937) with a category picker: when the user clicks bulk Recategorize, open a small Popover/Dialog (reuse InlineCategoryCombobox or a Select over data.categoryOptions) to choose the target, then post recategorizeTransaction for each checked id (reverse+repost) and report the count.
- Keep bulk Approve (confirm existing category) and bulk Exclude as-is; ensure all three remain wired in both the inline bulkActions cluster (CoreScreens.tsx:2306) and the config.bulkActions (CoreScreens.tsx:2353).
- Add a register keyboard model matching the Inbox scheme exactly — J/K/Enter/E (decided: see decisions.md Q39): J/K to move row focus, Enter to open the drawer, E to exclude the focused row, and a documented key-hint footer. Scope key handling to the register so it never clashes with global ⌘K or the category combobox typeahead; guard against firing inside inputs/combobox/dialog exactly like the Inbox handler (CoreScreens.tsx:880).
- Surface the key hints with the existing InboxKeyHint-style kbd chips (or a shared small KeyHint).

**Files:** `apps/web/src/components/openbooks/CoreScreens.tsx:1937`, `apps/web/src/components/openbooks/CoreScreens.tsx:2306`, `apps/web/src/components/openbooks/CoreScreens.tsx:880`, `apps/web/src/components/openbooks/workbench/InlineCategoryCombobox.tsx`

**Definition of done**

- [ ] Bulk Recategorize prompts for a target category and posts reverse+repost for each selected row, reporting 'N recategorized'; no hardcoded category is used.
- [ ] A register keyboard model lets the user move row focus, open the drawer, and exclude the focused row, with visible key hints, and never fires while typing in a field/combobox/dialog.
- [ ] All three bulk actions remain functional and reported via the inline transaction-message line.
- [ ] H1 e2e flow still green (bulk path not broken).

**Deliverables:** Edited bulkRecategorize + bulk picker UI; Register keyboard handler + key-hint footer; e2e (optional) asserting bulk recategorize with a chosen category

**Verify.** pnpm -w typecheck && lint; in the running app, select 2 rows, Bulk Recategorize → pick a category → confirm the message reports 2 recategorized and the rows show the new category; exercise keyboard nav + exclude.

### E7-7 — Split / exclude / recategorize clarity as reverse+repost corrections
`size: S` · `risk: med` · `depends on: E7-3`

**Intent.** Posted entries are immutable; every correction reverses and reposts. The drawer should make that explicit so the owner trusts that fixing a category doesn't silently mutate history — and split/exclude read as deliberate accounting actions.

**Changes**

- In TransactionDetail (CoreScreens.tsx:2539), group the correction actions (Recategorize, Split, Exclude) under a clear 'Correct this entry' section with one line of plain-English copy: corrections reverse the original journal entry and post a new one; nothing is edited in place. The activity history already shows ledger.entry.reversed (asserted in e2e at core-screens.spec.ts:135) — reference it.
- Make the Recategorize quick action use the chosen category from the inline combobox rather than the hardcoded otherIncomeCategoryId currently passed (CoreScreens.tsx:2672); if a one-click quick recategorize is kept, label it clearly as a demo/sample target or replace with a category picker.
- Ensure the split editor (CoreScreens.tsx:2693) validates that the two split amounts sum to the original absolute amount before enabling Post split, and surfaces a clear message if not (avoid a silently unbalanced repost attempt; the ledger will reject but the UI should pre-validate).
- Confirm exclude language reads 'Exclude (reverses any posted entry)'.

**Files:** `apps/web/src/components/openbooks/CoreScreens.tsx:2539`, `apps/web/src/components/openbooks/CoreScreens.tsx:2667`, `apps/web/src/components/openbooks/CoreScreens.tsx:2693`

**Definition of done**

- [ ] The drawer has a labeled 'Correct this entry' section stating corrections reverse + repost (immutable history), visible above the split/exclude controls.
- [ ] The quick Recategorize no longer silently targets a hardcoded category, OR is explicitly labeled as a sample target; the inline combobox remains the primary path.
- [ ] Split Post is disabled with a clear hint until the two amounts sum to the original; a valid split posts reverse+repost and reports success.
- [ ] Exclude clearly states it reverses any posted entry.
- [ ] H1 e2e (recategorize → ledger.entry.reversed, split → 'split' message) stays green.

**Deliverables:** Edited TransactionDetail copy + split validation

**Verify.** pnpm -w typecheck && lint && run H1 core-screens e2e; manually post a split that doesn't balance and confirm Post split stays disabled with a hint, then a balanced split succeeds.

### E7-8 — Mount E8's compact insight banner above the register (E8 owns the component)
`size: M` · `risk: low` · `depends on: E7-1, E8-T3`

**Intent.** Each page needs ONE small page-relevant insight banner. E8 owns the reusable `InsightBanner` contract (decided: see decisions.md Q37); E7 **consumes** it for the Transactions banner so there is one implementation, not two. The register already computes a server insights aggregate (coreViews.ts:827); mount E8's banner above the table fed by that aggregate.

**Changes**

- Mount E8's reusable `InsightBanner` (the component E8-T3 owns) above the register table in TransactionsScreen, fed by the existing server insights aggregate returned by useTransactionsData (coreViews.ts:827 → data.insights): net change vs last period + uncategorized exposure (insights.uncategorizedCount/uncategorizedMinor) + top counterparty — page-specific, not the full Insights dashboard. Do NOT build a second/parallel banner; if `InsightBanner` has not yet landed, depend on E8-T3 and stub against its agreed prop contract.
- The legacy `InsightsBand` (workbench/InsightsBand.tsx) is being retired by E8 (decided: see decisions.md Q41); do not extend it. Consume E8's banner instead.
- Pass E8's banner through WorkbenchSurface's existing `banner` slot (WorkbenchSurface.tsx:110) so it sits above the toolbar, or add a dedicated `insightBanner` slot if the status message must stay separate from the insight.
- The banner anchors on the same date source as E7-10: browser clock for FE display, server `asOf` threaded into the insights aggregate query (decided: see decisions.md Q38/Q40). The banner is always-on but threshold-gated — hidden when the page-insight builder returns null, never a filler line (decided: see decisions.md Q42).
- Keep the full TransactionsInsights as the dedicated Insights sub-tab (config.insights at CoreScreens.tsx:2359) — the banner is the summary, the tab is the detail.

**Files:** `apps/web/src/components/openbooks/CoreScreens.tsx:2381`, `apps/web/src/components/openbooks/workbench/InsightsBand.tsx`, `apps/web/src/components/openbooks/workbench/WorkbenchSurface.tsx:110`, `convex/coreViews.ts:827`

**Definition of done**

- [ ] Exactly one compact insight banner renders above the register — E8's reusable `InsightBanner`, not a second implementation — reading data.insights for the active filtered period (net change vs last, uncategorized exposure, top counterparty).
- [ ] The banner is always-on but threshold-gated (hidden when the page-insight builder returns null) and does not reintroduce horizontal scroll on mobile.
- [ ] E7 consumes E8's banner contract (named in the PR) and the full Insights sub-tab still renders separately; no parallel banner component is introduced in CoreScreens.
- [ ] Changing the date-range period updates the banner numbers; the banner anchors on the shared server `asOf` / browser-clock date source (not a hardcoded date).

**Deliverables:** E8 `InsightBanner` mounted above the register in CoreScreens.tsx (consumed, not re-implemented); Note in PR confirming E7 consumes E8-T3's banner contract

**Verify.** pnpm -w typecheck && lint && build; in the running app, change the period and confirm the banner net-change + uncategorized numbers update; verify at 390px the banner stacks without horizontal scroll.

### E7-9 — Saved views / filters / group / sort polish + de-duplicate the filter rail
`size: M` · `risk: low` · `depends on: E7-3, E7-5, E7-10`

**Intent.** The toolbar exposes the same filters twice (FilterPanelButton mega-panel AND standalone pills), and saved views are FE-only localStorage — which stays FE-only (localStorage) for this sprint; server-persisted saved views are deferred (decided: see decisions.md Q35). Tighten the rail so it reads as one coherent control set and the saved-view state is trustworthy.

**Changes**

- Resolve the duplication between FilterPanelButton (CoreScreens.tsx:2408) and the standalone Date/Amount pills (CoreScreens.tsx:2414): keep the high-frequency Date + Amount as quick pills and route the rest through the panel, or make the panel the single source — document the decision in code comments. Ensure removing a chip and the panel stay in sync (they already share filterPanelValue/onFilterPanelChange).
- Verify GroupByMenu/SortMenu/DisplaySettingsMenu (CoreScreens.tsx:2420-2422) options match the available columns after E7-3/E7-5 column changes (e.g. don't offer to sort by a removed pseudo-column); update sortMenuColumns/columnToggleList derivations (CoreScreens.tsx:2288-2304) accordingly.
- Make built-in views (BUILTIN_TX_VIEWS:1518) and the saved-view dirty state read correctly after the period defaults change (E7-10); ensure 'All transactions' resets cleanly via DEFAULT_TX_FILTERS.
- Confirm group view (tableGroups, CoreScreens.tsx:2363) still renders with the compact rows and provenance chips.

**Files:** `apps/web/src/components/openbooks/CoreScreens.tsx:2404`, `apps/web/src/components/openbooks/CoreScreens.tsx:2288`, `apps/web/src/components/openbooks/CoreScreens.tsx:1518`, `apps/web/src/components/openbooks/workbench/SavedViews.tsx`

**Definition of done**

- [ ] The filter rail no longer exposes the same facet twice ambiguously; Date/Amount quick pills + the panel are clearly delineated, and chip removal stays in sync with the panel.
- [ ] Sort/group/display menus only list valid columns after the E7-3/E7-5 column changes (no dead options).
- [ ] Built-in and user saved views apply, mark dirty, and reset correctly; 'All transactions' returns to defaults.
- [ ] Group-by view renders compact rows with provenance chips and correct group summaries.

**Deliverables:** Edited toolbar wiring + menu column derivations in CoreScreens.tsx; Comment documenting the filter-rail single-source decision

**Verify.** pnpm -w typecheck && lint; run redesign-workbench-harness + core-screens e2e; manually apply a saved view, dirty it, save/update, switch to All, and group by category — confirm each behaves.

### E7-10 — Remove hardcoded demo dates from the register defaults
`size: S` · `risk: low` · `depends on: E8-T1`

**Intent.** The register seeds manual-add date and the range fallback with the frozen demo date '2026-06-30' (CoreScreens.tsx:1627, 1638). Once the app runs on real time these silently desync new entries and the visible window. Import the single shared `today`/`asOf` helper landed by E8-T1 (decided: see decisions.md Q38) — do NOT introduce a second date helper.

**Changes**

- Replace the literal '2026-06-30' manual-add default (CoreScreens.tsx:1627) and the dateRangeValueToISO fallback (CoreScreens.tsx:1638) with the single server-clock helper owned by E8-T1 (decided: see decisions.md Q38/Q40): browser clock for FE display of the manual-add default, server `asOf` for the range/query body. Default manual date to today; default range fallback to today.
- Do NOT introduce a second date helper. E8-T1 is the single owner of `today`/`asOf` (decided: see decisions.md Q38); import it here. If E8-T1 has not yet landed, depend on it and stub against its agreed signature, then swap to the real import — keep this from becoming a one-off (the same helper also replaces InsightsScreen TODAY_ISO at InsightsScreen.tsx:32 and the agentToolQueries default-date, owned centrally).
- Confirm the CSV sample placeholder text (CoreScreens.tsx:1630) is illustrative only and does not post a frozen date for real imports (it's user-editable).

**Files:** `apps/web/src/components/openbooks/CoreScreens.tsx:1627`, `apps/web/src/components/openbooks/CoreScreens.tsx:1638`, `apps/web/src/components/openbooks/CoreScreens.tsx:1630`, `<E8-T1 shared today/asOf helper>` (import; owned by E8-T1, not created here)

**Definition of done**

- [ ] No '2026-06-30' literal remains as a silent default for manual-add date or the range fallback in the register; both derive from one shared today source.
- [ ] Adding a manual transaction defaults its date to today (not 2026-06-30).
- [ ] The default visible period resolves around the real current month.
- [ ] typecheck/lint clean; H1 e2e (which fills its own merchant/amount and uses the CSV date explicitly) stays green.

**Deliverables:** Edited CoreScreens.tsx date defaults importing E8-T1's shared today/asOf helper (no new helper created here)

**Verify.** pnpm -w typecheck && lint && run H1 core-screens e2e; manually open Add transaction and confirm the date field shows today's date.

### E7-11 — Register evidence pack + full gate
`size: S` · `risk: low` · `depends on: E7-3, E7-4, E7-5, E7-6, E7-7, E7-8, E7-9, E7-10`

**Intent.** Prove the density/responsiveness/provenance changes hold together with screenshots and the full gate so the epic is verifiably done, not just compiling.

**Changes**

- Run the full quality gate: pnpm -w typecheck, lint, build, unit, and the e2e specs touching this surface (tests/e2e/core-screens.spec.ts, redesign-workbench-harness.spec.ts, redesign-e5-consistency.spec.ts).
- Capture an evidence set into the finishing evidence dir (the same dir the H1 test writes to): register at 1440px (compact rows + provenance chips), register at 390px (card list, no horizontal scroll), the row expand affordance open, the drawer 'Correct this entry' section, and the compact insight banner.
- Confirm ledger.ts is untouched (git diff shows no changes under convex/ledger.ts) — this epic must not alter the posting path.
- Write a short verification note (in the PR description, not a tracked .md) summarizing what each screenshot proves and which DoD items it covers.

**Files:** `tests/e2e/core-screens.spec.ts`, `tests/e2e/redesign-workbench-harness.spec.ts`, `tests/e2e/redesign-e5-consistency.spec.ts`, `convex/ledger.ts`

**Definition of done**

- [ ] pnpm -w typecheck, lint, build, unit all pass; the listed e2e specs pass (or pre-existing baseline failures are explicitly noted and unrelated).
- [ ] git diff confirms convex/ledger.ts is unchanged by this epic.
- [ ] An evidence set (1440px register, 390px card list with no-scroll proof, expanded row, drawer correction section, insight banner) is captured.
- [ ] A PR verification note maps each evidence artifact to the epic DoD.

**Deliverables:** Gate output (pass); Screenshot evidence set in the finishing evidence dir; PR verification note

**Verify.** pnpm -w typecheck && pnpm -w lint && pnpm -w build && pnpm -w test && pnpm exec playwright test tests/e2e/core-screens.spec.ts tests/e2e/redesign-workbench-harness.spec.ts; git diff --stat convex/ledger.ts (expect empty).

## Decisions applied

All prior open questions for this epic are resolved by `../decisions.md` (canonical) and `../plan-rebuild-changelog.md` (E07 section). No item in this epic still needs Ansar.

- **Q35 — Saved views** → FE-only (localStorage) this sprint; server-persisted views deferred. Applied to E7-9.
- **Q36 — Provenance copy** → sentence-style, count-aware ('Same as your last 6 AWS charges', 'Matched your rule', 'Matched a Stripe payout'); one-word chip fallback when no count. Applied to E7-1, E7-2.
- **Q37 — Insight banner ownership** → E8 owns the reusable `InsightBanner` component (E8-T3); E7 consumes it for the Transactions banner. Applied to E7-8 (now `depends on: E7-1, E8-T3`) and the epic DoD.
- **Q38 / Q40 — Centralizing 'today'** → E8-T1 owns the single server-clock `today`/`asOf` helper; E7-10 imports it (browser clock for FE display, server `asOf` for query bodies). Applied to E7-8, E7-10 (now `depends on: E8-T1`) and the epic DoD.
- **Q42 — Banner gating** → always-on but threshold-gated, hidden when the page-insight builder returns null. Applied to E7-8.
- **Q39 — Register keyboard model** → match the Inbox J/K/Enter/E scheme, scoped to the register to avoid ⌘K / combobox-typeahead clashes. Applied to E7-6.

This epic does not touch multi-currency/FX, credential storage, live-connector gating, the Stripe webhook, the history window, intercompany views, or the public demo, so the USD-only / unified-credentials / live-connectors-local / webhook-required / user-chosen-history / intercompany-two-views / shared-no-login-demo decisions do not change any tickets here.
