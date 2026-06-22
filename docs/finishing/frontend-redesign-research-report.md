# OpenBooks Frontend Redesign — Research & Execution Plan

> **Status:** Research / planning artifact. No product code was modified.
> **Branch:** finishing · **Date:** 2026-06-13 · **Scope:** Dashboard, Inbox, Transactions, Income,
> Expenses, Bills, Contacts, Payroll, Reports, Settings, Ask AI, and the global shell.
> **How it was produced:** a 33-agent Claude Code workflow (Foundation → per-surface Audit →
> adversarial Verify → Synthesis) reading the prototype HTML, the OpenBooks design system, the
> product specs, the Convex data model, and the current implementation under `apps/web/src/`. Every
> finding is tied to a `file:line`. Live browser screenshots could not be captured in this
> environment (the available Chrome cannot reach the local dev server on :3100); capturing baseline
> + after screenshots at the five target widths is the first task of Epic 0.

---



---

## 1. Executive Summary

**What this is.** A research and execution plan for bringing the OpenBooks frontend up to a
product-grade standard a real small business would trust. It was produced by a 33-agent Claude
Code workflow that read every prototype file, the design system, the product specs, the Convex
data model, and the actual current implementation of all twelve surfaces — then had an adversarial
verifier re-check each finding against the code. **No product code was changed. This is a plan to
approve before any implementation runs.**

**The headline.** Ansar's read is correct, and it holds up at the code level: this is not one
broken page, it is a *missing system*. Every data-heavy screen reinvents its own table, filters,
detail panel, date control, and export behavior, so the product feels like twelve separate tools
instead of one operating system. The single highest-leverage move is therefore **not** to redesign
pages one by one — it is to build one shared workbench grammar first (table, filter bar, date
range, detail drawer, KPI strip, export, AI badge, attention states), then refit every page onto
it. Build the system, and most of the reported inconsistencies disappear at once.

**The reassuring part.** The backend is sound and does *not* need re-architecting. The hidden
double-entry ledger is immutable with a single enforced write path, money is stored as integer
minor units everywhere, AI autonomy is one shared constant, and — critically — **Income and Expenses
are already implemented as read-model lenses over the same transactions and journal lines, not as
separate stores.** The code literally reuses the report pack's aging and category math so the
numbers reconcile. That means the most important product decision in this redesign — *one record,
many views; never "move" a transaction between tabs* — is already true in the data layer. The
frontend just has to stop hiding it. This is a consistency-and-polish effort on a good foundation,
not a rebuild.

**What was confirmed (highest-severity, with code evidence).**

- **Transactions — blocker.** The detail panel is seeded to the first row on load
  (`CoreScreens.tsx:746`) and a 380px detail column is permanently reserved in the grid
  (`CoreScreens.tsx:980`), so the register opens squeezed beside an empty panel. Filters and
  columns are far short of an operator register; export is weak.
- **Inbox — 2 blockers.** The receipt-match review panel overflows and overlaps, exactly as
  reported; the two-column layout is not resilient. It does not yet feel like a focused,
  keyboard-driven exception queue.
- **Bills — 3 blockers.** Open/overdue/due-soon are not arranged into a real accounts-payable
  workflow; evidence and tracking are scattered; no table-first workbench.
- **Contacts.** The profile pane shows by default, cramping the directory; unnecessary explanatory
  copy is present.
- **Expenses.** No full tabular expense view, weak date filtering, and a design-system violation
  (off-brand accent in category data) — catalogued with file references.
- **Ask AI.** Confirmed at the dependency level: **no AI SDK or AI Elements is installed.** The
  panel is a custom 918-line component that exposes a provider/debug label to users and breaks
  layout on dense pages like Reports.
- **Settings.** The section nav does not stay put while content scrolls, and some tables overflow
  their cards.
- **Shell / header.** Header clutter (global search, month chip, AI pill) and demo/workspace labels
  leak into page bodies.

Across the twelve surfaces the workflow catalogued **~120 prototype-vs-current gaps** (12 of them
blockers), **~64 design-system violations**, and **~65 responsive/layout defects**, each tied to a
specific file and line. The adversarial verifier rated 8 of 12 surface audits "high" reliability and
4 "medium," and surfaced additional issues the first pass missed (Section 2 lists them per surface).

**What it will take.** Eight epics. Epic 1 (shared primitives) is the linchpin and must land before
any page work; Epics 3–6 (the page workbenches) can then run largely in parallel; Epic 7 is
responsive QA at 390 / 768 / 1306 / 1440 / 1758 px plus lint, typecheck, and tests. Two pieces of
infrastructure need installing up front: the Vercel AI SDK + AI Elements (for Ask AI), and a handful
of missing shadcn primitives (`drawer`, `calendar`, `popover`, `checkbox`, `scroll-area`,
`toggle-group`). Section 9 specifies each epic's goal, files, scope, validation, risks, and
done-when criteria, and Section 11 lists the decisions only Ansar can make (Contacts delete vs.
soft-archive; whether Payroll auto-runs exist today or are future; export formats; whether to keep a
subtle demo indicator).

**One honest gap in this research pass.** Live browser screenshots could not be captured: the Chrome
instance available in this environment can reach the public internet but not Ansar's local dev
server on port 3100, and freeing that port would have disrupted the running server and its
Convex/Stripe bindings. All findings here are therefore grounded in source code and prototype
comparison — which is the more reliable evidence for technical claims anyway. Capturing the baseline
and after screenshots at the five target widths is the first task of Epic 0 in the implementation
phase.

**What to approve.** (1) The information-architecture decision in Section 4 — Transactions as the
universal register, Income/Expenses/Bills as lenses and workflows over the same records. (2) The
shared component system in Section 5 as the foundation built before pages. (3) The eight-epic
workflow shape in Section 9. With those three approved, the implementation workflow in
`docs/finishing/frontend-redesign-claude-workflow-prompt.md` can run epic by epic, each returning
its own evidence pack.

---

## 2. Verified Findings By Surface

Each surface was audited against its prototype (`OpenBook - Prototype/*.dc.html`), the current implementation, and the Convex data contract, then re-checked by an adversarial verifier. "Status" is the audit's technical verdict on the reported issue, with `file:line` evidence; the verifier's reliability rating and any issues it caught that the first pass missed are noted per surface.

### 2.1 Dashboard

**Files:** `apps/web/src/components/openbooks/CoreScreens.tsx (DashboardScreen, lines 51-342)`, `apps/web/src/components/openbooks/AppScreen.tsx (renders PageHeader + DashboardScreen, lines 48-57)`, `apps/web/src/components/openbooks/primitives.tsx (PageHeader 120, StatCard 64, Sparkline 143, BarChart 171, CategoryChip 194)`, `apps/web/src/lib/openbooks/content.ts (dashboard route label/summary, lines 29-32)`, `convex/coreViews.ts (dashboard query, lines 70-289 — the data contract)`

**Adversarial verifier reliability:** medium

**Current state.** The Dashboard is two layers. (1) A shared PageHeader rendered by AppScreen.tsx:50-55 with eyebrow={activeEntity.name}, title="Dashboard" (route.label, content.ts:30), description="Business at a glance, with cash, profit, inbox, AR, AP, and activity." (content.ts:32), and a CategoryChip active label="Demo entity" action when activeEntity.isDemo (AppScreen.tsx:54). (2) DashboardScreen (CoreScreens.tsx:51-342) opens with an "Operating snapshot" card containing a duplicate entity name + "ledger-backed books" subtitle and a shadcn Select period picker (lines 78-98), then an optional onboarding checklist (100-138), a fresh-entity empty state (140-155), a 4-up StatCard row (Cash position/Net income/Inbox/AR-AP, 157-196), a 2-up "Cash and credit" list + "Monthly P&L" with a primitives BarChart of expensesByCategory (198-252), Inbox-status + Activity-feed lists (254-281), an A/R-A/P + Income-by-customer + Payroll row (283-329), and a "Cash flow by month" BarChart (331-339). Every figure links into a workbench (e.g. line 161 -> /transactions, 172 -> /reports, 237 -> /expenses). The backing query already returns cashPositionMinor, cashSparkline, bankBalances, profitAndLoss, inbox.byKind/automationRate, receivables/payables, expensesByCategory, incomeByCustomer, payroll, cashFlowByMonth, recentActivity (coreViews.ts:204-257). It is a status collage, not a command center.

**Prototype establishes.** Dashboard.dc.html establishes an operator command center with one tall page title ("Dashboard" + "{entity} · {range}" sub, lines 22-26) and a header-right period control that is a real dropdown (This month / Last month / Last 3 months / YTD) plus an inline custom dual-month calendar range picker (lines 28-79, 685-722). Single-entity layout is an ordered stack: (1) Cash hero — 36px cash total + sparkline + connected-account chips with bank logos, masks, balances, and a stale-sync warning icon (110-135); then 3-up rows: (2) P&L snapshot with net + delta + 6-month in/out mini-bars (141-165), (6) "Where money went" donut with legend (168-188), (3) Inbox count + kind-chips + "Open inbox" button / zero-state (191-212); (4) "Owed to you" A/R with aging bar + overdue list (219-240), (5) "You owe" A/P with next bills (243-259), (9) Payroll last/next + FX currencies (262-273); (7) Income-by-customer share bars + concentration-risk note (280-299), (8) Cash flow in/out bars + net-positive insight (302-323); (11) Cash cushion months gauge (330-345), (12) Books health automation% + close-period CTA (348-363), (13) Coming up next-30-days list with net impact (366-384); (10) Activity feed with typed icons (388-401). Cards are clickable into workbenches (goReports/goInvoices/goBills/goPayroll, 764-767). There is also an all-entities combined mode (82-104).

**Feedback verification.**

| Reported issue | Status | Evidence |
|---|---|---|
| Current Dashboard shows a workspace label in the body | Partial | No workspace name renders on the Dashboard body; PageHeader eyebrow is the ENTITY name (AppScreen.tsx:51 eyebrow={activeEntity.name}), not the workspace. Workspace name only lives in the sidebar profile (AppShell.tsx:620). The eyebrow is still a redundant entity label. |
| Shows 'Dashboard' title and 'Business at a glance' subtitle | Confirmed | content.ts:30 label:'Dashboard'; content.ts:32 summary:'Business at a glance, with cash, profit, inbox, AR, AP, and activity.' rendered via PageHeader title/description (AppScreen.tsx:52-53). |
| Shows a 'Demo entity' badge in the body | Confirmed | AppScreen.tsx:54 actions={activeEntity.isDemo ? <CategoryChip active label="Demo entity" /> : null}. |
| Has an 'Operating snapshot' card + generic metric cards (status collage) | Confirmed | CoreScreens.tsx:80 <h2>Operating snapshot</h2>; CoreScreens.tsx:157-196 four equal StatCards (Cash position/Net income/Inbox/AR-AP). |
| Prototype is an operator command center: cash hero, connected accounts, P&L, spend, inbox, receivables/payables, payroll, income by customer, cash flow, coming up, health/cushion | Confirmed | Dashboard.dc.html cash hero 110-135, P&L 141-165, donut 168-188, inbox 191-212, A/R 219-240, A/P 243-259, payroll 262-273, income-by-customer 280-299, cash flow 302-323, cushion 330-345, books-health 348-363, coming-up 366-384, activity 388-401. |
| Cards should be actionable (click into workbench with same filter) | Partial | Prototype whole-card onClick (Dashboard.dc.html:168,219,243,262). Current only inner figures link (CoreScreens.tsx:161,172,237) and some targets are wrong: income-by-customer -> /contacts (line 308), AR/AP -> generic /invoices (190), no period carried into /bills. |
| Remove workspace/demo labels from body | Confirmed | Demo chip at AppScreen.tsx:54 and duplicate entity name at CoreScreens.tsx:81 ('{name} · ledger-backed books') — both should be removed per feedback. |
| Date range control needed | Partial | A control EXISTS (shadcn Select, CoreScreens.tsx:85-96) but it is month-only, buried in the body 'Operating snapshot' card, and lacks presets and a custom range, unlike the prototype header dropdown+calendar (Dashboard.dc.html:28-79). The prototype-grade header control is confirmed absent. |

**Design-system violations.**

- Duplicate/competing page titles — DS calls for one page title. The shared PageHeader title 'Dashboard' is immediately followed by a second card-level h2 'Operating snapshot', producing two headings. — _AppScreen.tsx:52 title={route.label} ('Dashboard') + CoreScreens.tsx:80 <h2 className="text-base font-semibold">Operating snapshot</h2>_
- Redundant entity label in body — entity name shown both as PageHeader eyebrow and inside the snapshot card subtitle, plus ledger jargon ('ledger-backed books') that owners should not see. — _AppScreen.tsx:51 eyebrow={activeEntity.name} AND CoreScreens.tsx:81 {dashboard.entity.name} · ledger-backed books_
- 'Demo entity' badge rendered in the page header action slot — a build/state label leaking into the product surface; should not appear in the dashboard body per feedback. — _AppScreen.tsx:54 <CategoryChip active label="Demo entity" />_
- Money not consistently Geist Mono / tabular — StatCard renders value in a plain text-2xl div with no money-figures/tabular-nums class, so the hero cash figure is proportional, unlike the prototype's Geist Mono tnum (Dashboard.dc.html:114). — _primitives.tsx:86 <div className="text-2xl font-semibold">{value}</div> (no money-figures class); inbox count at CoreScreens.tsx:263 uses money-figures but the cash StatCard does not._
- BarChart loses category identity — expense category labels truncated to the first word, so 'Software & SaaS'/'Payment fees' become 'Software'/'Payment'; a data-fidelity regression vs the prototype donut+legend. — _CoreScreens.tsx:249 label: item.name.split(" ")[0]_
- Accounting jargon in owner-facing copy — 'Operating snapshot', 'ledger-backed books', 'Ledger lines' chip, 'A/R and A/P' — DS/IA mandate plain English ('money you're owed', not 'accounts receivable'). — _CoreScreens.tsx:80 'Operating snapshot'; 81 'ledger-backed books'; 226 CategoryChip label="Ledger lines"; 286 <h2>A/R and A/P</h2>_

**Responsive / layout issues.**

- StatCard hero figures use text-2xl with no truncation/min-w-0 guard; a 9-digit all-businesses cash figure (prototype $131,883.16) can overflow a 4-up grid column on md (CoreScreens.tsx:86 + grid md:grid-cols-2 xl:grid-cols-4 at 157).
- 'Cash and credit' rows use grid-cols-[1fr_auto_auto] (CoreScreens.tsx:206) — on narrow widths the account name (1fr) plus CategoryChip plus money link squeeze; the prototype instead wraps account chips with flex-wrap (Dashboard.dc.html:122), which the current list does not.
- The period Select sits in a sm:w-48 column inside a md:flex-row snapshot card (CoreScreens.tsx:83-97); it is not header-anchored, so on scroll the range control disappears — unlike a header-pinned control.
- BarChart is fixed h-36 with w-5 bars and gap-2 (primitives.tsx:177-178); with 6+ cashFlowByMonth months in a narrow mobile column the truncate labels (line 187) collapse to ellipsis and bars become unreadable slivers — no horizontal-scroll fallback.
- Income-by-customer and activity-feed lists rely on flex justify-between with no min-w-0 on the name span (CoreScreens.tsx:309, 275); long customer names or memos push the right-aligned money figure off-row on small screens.

**Additional issues caught by the adversarial verifier (missed on first pass).**

- Onboarding checklist card has NO prototype counterpart. CoreScreens.tsx:100-138 renders a full 'Finish setting up OpenBooks' 5-tile checklist card (gated on onboardingChecklist.persisted) at the very top of the dashboard body, above the StatCards. Dashboard.dc.html has no such surface. The audit listed many missing prototype features but never flagged this present-but-unspecified card, which pushes the (already weak) cash metric even further down the page and adds a sixth competing heading ('Finish setting up OpenBooks', :104).
- Fresh-entity empty state is also un-audited extra surface: CoreScreens.tsx:140-155 renders a 'Ready for money data' dashed card. Not in prototype; adds yet another h2 (:142). Not inherently wrong, but the audit's 'duplicate/competing titles' finding undercounts headings — the dashboard can show up to FIVE+ h2s (Operating snapshot, Finish setting up, Ready for money data conditionally, Cash and credit, Monthly P&L, Inbox status, Activity feed, A/R and A/P, Income by customer, Payroll, Cash flow by month), not the 'two/three' the audit implies.
- All-entities / combined mode is entirely missing and unmentioned by the audit. Prototype has a full allMode branch (Dashboard.dc.html:81-104: 'Cash across all businesses' $131,883.16 hero + per-entity cards + roadmap note). The current DashboardScreen has no all-entities concept at all (it always scopes to one activeEntity via entityArg, CoreScreens.tsx:57-60). The audit even cited the $131,883.16 all-mode figure in a responsive issue but never flagged that the entire all-businesses view is absent.
- Inbox automationRate label is misleading vs the metric. StatCard detail renders `${dashboard.inbox.automationRate}% reviewed` (CoreScreens.tsx:185), but coreViews.ts:224 computes automationRate as reviewedTransactions/transactions where reviewedTransactions = transactions whose review !== 'needs_review' (coreViews.ts:153). That is 'share of transactions not needing review', not a true automation rate, and the prototype frames the same idea as '94% automated' (Dashboard.dc.html:209,353). The audit critiqued jargon but missed this metric/label mismatch.
- P&L 'Net income' and the AR/AP StatCard are bare/structural-color only — no tone or sign. The Net income StatCard (CoreScreens.tsx:170-177) and AR/AP net (:187-195) use plain <Amount> with default tone 'neutral', so a NEGATIVE net income shows as an ordinary black figure with a '-' but no visual signal, and AR/AP net can be negative (receivables.openMinor - payables.openMinor, :191) with no indication of which side dominates. Prototype color-codes net (plDeltaColor, Dashboard.dc.html:151) and uses red only for genuinely overdue (:235). The audit covered tabular/mono but not this tone/sign gap.
- 'Cash flow by month' BarChart plots netMinor only (CoreScreens.tsx:338 value: month.netMinor), collapsing the prototype's dual in/out bars (Dashboard.dc.html:308-317 separate #2ca01c in-bar and #cbd2d9 out-bar per month) into a single net bar, and drops the 'Net positive every month · avg /mo' insight line (:319-322). The audit flagged the expense BarChart's label truncation but missed that the cash-flow chart loses the in-vs-out breakdown entirely.
- Income-by-customer fallback can silently mix two different metrics. coreViews.ts:172-183: if no invoice was issued in selectedMonth, the widget falls back to all-time amountPaidMinor instead of period totalMinor. So the same 'Income by customer' card can show issued-this-month totals or lifetime-paid totals depending on data, with no label distinguishing them — a correctness/clarity issue the audit did not surface.
- Activity feed source string is raw enum, not humanized. CoreScreens.tsx:276 renders `{entry.date} - {entry.source}` where source is the raw journalEntry.source value (coreViews.ts:256). Compare the inbox-kind path which at least calls categoryLabel() to de-underscore (CoreScreens.tsx:262,44). Activity source likely renders machine tokens to the owner — a plain-English regression the jargon finding overlooked.

### 2.2 Inbox

**Files:** `apps/web/src/components/openbooks/CoreScreens.tsx (InboxScreen at line 344-715)`, `apps/web/src/components/openbooks/AppScreen.tsx (route wiring at line 58)`, `convex/coreViews.ts (inbox query at line 291-372)`

**Adversarial verifier reliability:** high

**Current state.** InboxScreen (CoreScreens.tsx:344) renders a 2-column `lg:grid-cols-[360px_1fr]` (line 503): a flat left list and a right detail. The left list is a single ungrouped `inbox.items.map()` (line 517) — NO grouping by work type. Each row is `grid-cols-[auto_1fr]` with a native `<input type=checkbox>` (line 537), merchant + `<Amount>` (line 558), and a `categoryLabel(kind) - categoryName` subline (line 560). The detail panel branches on only ONE dimension: `selectedReceipt` (receipt match -> 2-col compare grid, line 594) vs everything-else (line 648), which renders a Category `<Select>` + a plain reasoning box (line 665) + Confirm/Always do this/Exclude. The four other backend kinds — transfer, payout_mismatch, connection, question (schema.ts:383-390) — have NO dedicated UI; they all fall into the generic categorize detail showing `selected.summary` (line 573) and a category dropdown that makes no sense for them. The query (coreViews.ts:312) returns only id/kind/summary/merchant/date/amountMinor/confidence/reasoning/categoryName + receiptDocument; it does NOT return transfer pairs, payout breakdowns, connection state, or question candidates. Batch = checkbox set + one "Confirm selected" button (line 510). Keyboard J/K/E/Enter is wired (line 369). No mobile drawer/Sheet.

**Prototype establishes.** Inbox.dc.html establishes a 330px master list + flex-1 detail (lines 24, 76) on #fafafa. CRITICAL: the list is GROUPED by work type — `groupOrder = ["Needs category","Receipts","Possible transfers","Payout issues","Connections","AI questions"]` (prototype line 438) with uppercase group headers `{{ g.label }} · {{ g.count }}` (line 43). A progress bar + "N open · M cleared this session" header (lines 27-30) and a batch banner "N suggestions are ≥90% confident → Confirm all" (lines 33-39) sit above the list. Each row carries a kind-colored icon tile and, for categorize items, a per-row ConfidenceRing (lines 53-59). The detail has SIX fully distinct card layouts: categorize (merchant/raw/amount header + AI-suggests category pill + collapsible "Why this suggestion" with similar-txn list + Decided-by + Split tool + create-rule checkbox, lines 94-202); receipt (2-col receipt-vs-match, lines 205-235); transfer (two account rows + "same amount, opposite direction" connector + ledger-impact note, lines 238-261); payout mismatch (gross/fee/expected/received/difference table, lines 264-285); connection (reconnect CTA, lines 288-296); question (AI prompt + candidate rows + Yes/No/Something-else chips, lines 299-324). Each card states WHY it needs attention, shows evidence, and shows ledger impact in plain English. Inbox-zero state with checkmark (lines 79-88). Keyboard hints J/K/Enter/E footer (lines 68-72).

**Feedback verification.**

| Reported issue | Status | Evidence |
|---|---|---|
| Inbox review detail card can overflow/overlap text, especially receipt-match details | Confirmed | Receipt card md:grid-cols-2 (CoreScreens.tsx:594) inside the 1fr column of lg:grid-cols-[360px_1fr]; only fileName is truncated (line 615), while vendor (line 603), candidate.merchant (line 628) and category (line 640) use right-aligned font-medium spans with no truncate/min-w-0 — long values wrap and collide with their labels in the narrow column |
| Two-column review layout not robust | Confirmed | Static lg:grid-cols-[360px_1fr] (line 503) never collapses to a drawer; the 360px list is fixed-width so on mid widths the detail column is squeezed, and on mobile both stack with the detail permanently rendered below the full list |
| Should be a focused exception queue grouped by work type | Refuted | No grouping exists — single flat inbox.items.map() at line 517 with one 'Review queue' header (line 506). The prototype's groupOrder (Inbox.dc.html:438) was NOT ported |
| Show why item needs attention; confidence, AI reason, evidence, candidate, ledger impact readable without overlap | Partial | Confidence ring (line 575) and reasoning box (line 665) exist for categorize/receipt, but transfer/payout/connection/question get only selected.summary (line 573) + a category dropdown; no evidence rows, no ledger-impact copy, no provenance |
| Per-kind handling (categorize, receipt match, transfer match, question, bill evidence, duplicate, low confidence) | Refuted | Detail only branches on selectedReceipt (line 593). Backend supports 6 kinds (schema.ts:383-390: categorize/receipt/transfer/payout_mismatch/connection/question) but transfer/payout/connection/question have zero dedicated UI |
| Need batch review | Partial | Checkbox set + 'Confirm selected' exists (lines 510, 537-554) but no progress indicator and no confidence-aware 'Confirm all ≥90%' batch like prototype lines 33-39 |
| Need keyboard shortcuts | Confirmed | J/K/E/Enter handler wired (CoreScreens.tsx:369-399) with hint text 'J/K move · Enter confirm · E exclude' (line 514) |
| Need mobile drawer | Refuted | No Sheet/drawer in InboxScreen; layout just stacks (line 503). The reusable 88dvh bottom-sheet pattern exists in AppShell.tsx:495 but is not applied here |

**Design-system violations.**

- Native unstyled <input type=checkbox> instead of shadcn Checkbox (which is absent from the kit) — _CoreScreens.tsx:537-554 uses <input type='checkbox' className='mt-1'> — no DS focus ring, no brand accent; AGENTS.md mandates shadcn primitives before raw controls_
- ConfidenceRing is always brand green regardless of value, so low confidence reads as high confidence — _primitives.tsx:220 hardcodes className='stroke-primary'; a 58% ring (CoreScreens.tsx:575) is the same green as 96% — prototype uses confColor() green/amber/red by threshold (Inbox.dc.html:435)_
- Reasoning rendered with em-dash separators and raw kind string via categoryLabel underscore-replace, not plain-English labels — _CoreScreens.tsx:560 renders `{categoryLabel(item.kind)} - {item.categoryName}` so a row shows literal 'payout_mismatch'→'payout mismatch' / 'connection' as the label rather than owner-language section copy_
- Detail amount has no income/expense tone semantics by direction — _CoreScreens.tsx:558 and 584 call <Amount amountMinor> with default tone='neutral'; money-in transfer/payout amounts never get the green income tone the prototype uses (Inbox.dc.html:253 +$10,000 green)_

**Responsive / layout issues.**

- Receipt 2-col card (md:grid-cols-2, CoreScreens.tsx:594) lives inside the 1fr track of a [360px_1fr] grid; at ~1024-1280px the right column is ~600px so two receipt cards each ~290px wrap their untruncated vendor/merchant/category values (lines 603/628/640) and collide with labels
- Fixed 360px list track (line 503) does not shrink; between the lg breakpoint and ~1100px the detail column is squeezed enough that the md:grid-cols-3 date/amount/account row (line 577) and md:grid-cols-2 receipt grid both compress awkwardly
- On mobile (<lg) the grid collapses to one column so the ENTIRE list renders first and the detail sits far below it; selecting a row gives no visible feedback (no scroll, no drawer) — effectively unusable as a triage queue
- No overflow-y/scroll-area on the list; with 2000 open items (take(2000) in coreViews.ts:298) the list grows the page unbounded instead of an internal scroll region like the prototype's flex:1; overflow-y:auto (Inbox.dc.html:41)
- Message banner (line 670) and action button row (line 675 flex-wrap) push detail content height unpredictably; on narrow widths the 3-button action row wraps under the category select with no sticky action bar

**Additional issues caught by the adversarial verifier (missed on first pass).**

- Raw kind string leaks into the DETAIL TITLE, not just the small label the audit flagged. coreViews.ts:325 sets merchant = document?.vendor ?? transaction?.merchant ?? item.kind. For a connection or question item with no transaction/document, merchant becomes the literal kind, so CoreScreens.tsx:572 renders <h2>'connection'</h2> / <h2>'question'</h2> as the detail heading. Audit only cited the line-560 label.
- Accessibility regression from the same fallback: the list checkbox aria-label is `Select ${item.merchant}` (CoreScreens.tsx:538), which becomes 'Select connection'/'Select question' for kindless items — meaningless to screen readers. Not mentioned in the audit.
- Mixed/incorrect amount sign semantics. coreViews.ts:327 negates document totals (-document.totalMinor) while transactions use signedTransactionAmount, and Amount is never passed signed/tone. Result: receipt amounts always render as an unsigned negative-looking figure and money-in items never show +; the prototype distinguishes direction with sign AND color (Inbox.dc.html:244 vs 253). The audit caught the missing tone but not that the backend itself bakes in a hardcoded negative for documents.
- confirmBatch has no error isolation (CoreScreens.tsx:442-460): it awaits confirmTransaction sequentially in a for-loop; a single rejected mutation throws and aborts the remaining items, with the success message never shown and no per-item status. The audit rated batch 'partial' on missing UI affordances but did not flag this robustness defect in the batch action itself.
- Stale/no auto-selection contract: selected defaults to inbox.items[0] (CoreScreens.tsx:360) but selectedId is never reset when the selected item is resolved/removed from the query result; after a confirm/exclude the list re-fetches and `find` returns undefined, silently falling back to items[0]. The prototype explicitly computes the next selection after resolve (Inbox.dc.html:399-415). Current behavior jumps focus to the top of the list rather than advancing to the next card — a triage-flow regression not covered by the audit.
- The detail 'Account' vs 'Candidate' column (CoreScreens.tsx:586-591) shows selectedReceipt.candidate.bankAccountName for receipts but bankAccountName falls back to literal 'OpenBooks' (coreViews.ts:332/353) when no bankAccount is resolved — a placeholder string surfaced as real account data; not flagged by the audit.

### 2.3 Transactions

**Files:** `apps/web/src/components/openbooks/CoreScreens.tsx (TransactionsScreen at line 717)`, `apps/web/src/components/openbooks/AppScreen.tsx:60 (route mount)`, `convex/coreViews.ts:374 (transactions query, row shape at 464-503)`

**Adversarial verifier reliability:** high

**Current state.** TransactionsScreen (CoreScreens.tsx:717) renders a permanent two-pane grid `xl:grid-cols-[1fr_380px]` (line 980): a 7-column shadcn Table on the left and a fixed 380px right `<aside>` (line 1048) that is NOT a Sheet/Drawer — it is always present. `selected` defaults to `data.rows[0]` (line 746), so the detail panel and a 0-balance "Accounting view"/Receipt/Activity/Split/Exclude stack render on first paint with no row clicked. Columns are checkbox, Date, Merchant (+source/decidedBy subline 1016), Account, Category (an inline shadcn `<Select>` per row, min-w-44, line 1021), Status (CategoryChip of the raw review enum), Amount (lines 982-1034). Filters are five review-enum `<Button>` pills (all/auto/confirmed/needs_review/excluded, line 934) plus a single merchant/memo search Input (line 942) — server only filters on `merchant`+`rawDescription` (coreViews.ts:419-423). Bulk action is "Exclude selected" only (line 946). The right aside also hosts the Manual transaction form (1195) and CSV import (1207). There is NO Export button, NO Import/Add-transaction header button, NO contact column/field (row shape at coreViews.ts:464-503 omits contact entirely), NO reasoning surfaced, NO AI sparkle, NO date-range/amount-direction/source/receipt/confidence/needs-attention filters. Page has no PageHeader/title.

**Prototype establishes.** Transactions.dc.html establishes a full-width single register with NO permanent side panel. Header: title "Transactions" + subtitle "Every account, one register · {entity}" and three actions — Import, Export, Add transaction (green) (lines 26-32). Below: account pills (All/Mercury/Chase/Amex/Stripe, lines 37-39) + a search box hinting "Search, or sparkle ask AI to filter" (line 43); a per-account reconciliation tile (matched vs reconnect, lines 48-62); status tabs "To review · N / All / Excluded" (65-69); a green bulk bar "N selected · Approve selected · Clear selection" (72-79) and an explanatory "How approval works" note (82-87). Table grid (line 91): checkbox, Date, Merchant (+ raw description subline + paperclip-if-receipt + green AI sparkle popover showing reason/decidedBy/confidence%, 99-156), Category (clickable pill with inline category menu; amber when needs-review, 122-137), Contact, Account (logo chip + mask), Amount (right, green for income), an inline Approve button for review rows, comment-count chip, and a state dot. Row click opens a fixed right Drawer (420px, scrim, slide-in animation, lines 165-272) with big amount, Category/Account/Contact/Status/Source grid, receipt card, History, Comments (with composer), a collapsible "Accounting view" journal table, and footer actions Create-rule / Exclude / Approve-&-post.

**Feedback verification.**

| Reported issue | Status | Evidence |
|---|---|---|
| Detail panel is enabled BY DEFAULT by selecting the first row, table feels squeezed | Confirmed | CoreScreens.tsx:746 `return data.rows.find(...) ?? data.rows[0];` seeds selection to row 0; line 980 `grid gap-4 xl:grid-cols-[1fr_380px]` permanently reserves 380px; the aside (line 1048) is rendered whenever `selected` is truthy, which it always is when rows exist. |
| Filters incomplete (no multi-account, date range, amount direction, type, category, contact, source, receipt, AI status, confidence, needs-attention) | Confirmed | Only filters are the 5 review-enum buttons (line 934) and one search Input (line 942). Server query accepts only `review` + `search` and filters on merchant+rawDescription (coreViews.ts:377-378, 419-423). None of the named filters exist. |
| Columns incomplete (description, merchant, account, category, contact, amount, status, AI insight, confidence, receipt/evidence, ledger/reconciliation state) | Confirmed | TableHead set is checkbox/Date/Merchant/Account/Category/Status/Amount (lines 985-991). Missing: contact (not in row shape, coreViews.ts:464-503), AI insight, confidence, receipt/evidence indicator, ledger/reconciliation state. Raw description shows only inside the panel, not as a column subline distinct from `{source}-{decidedBy}` (line 1016). |
| No clear add-receipt + ask-AI-to-categorize + review-before-post flow | Confirmed | Panel has a read-only Receipt preview only (line 1090-1101); no upload control. Recategorize is a one-tap reverse+repost (updateCategory, line 798/1125) with no review-before-post gate; no ask-AI-to-categorize button on this surface (categorizePendingTransactions fires only as a side-effect of CSV import, line 865). |
| Export weak | Confirmed | No Export button or menu exists in TransactionsScreen; grep for export in the file returns nothing. Prototype has a header Export button (Transactions.dc.html:31) that the code never implemented. |
| Want full-width register by default; right Sheet/Drawer only on selection | Refuted | Current code does the opposite: a permanent 380px aside (line 980/1048), not a Sheet/Drawer. No `Sheet`/`Drawer` import or usage in the file. This is the target, not the current state — confirming the feedback's request is unmet. |
| Want bulk actions | Partial | Only 'Exclude selected' exists (line 946); selection state is wired (checkedTransactionIds, line 737) but there is no bulk approve/confirm/categorize and no clear-selection control. |
| Want export menu (CSV/filtered/selected/audit) | Not found | No ExportMenu component or any CSV/audit export action on this surface; grep confirms zero export affordances in CoreScreens.tsx. |

**Design-system violations.**

- Status column renders the raw review enum, not owner-plain copy; risk of needs_review reading as an alarm and inconsistent tone — _CoreScreens.tsx:1033 `<CategoryChip label={row.review} active={row.review !== "needs_review"} />` shows the bare enum value; categoryLabel (line 43-45) only swaps underscores. DS asks for plain-English owner language._
- Raw HTML <checkbox> instead of shadcn Checkbox (which is missing from the primitives set) — _CoreScreens.tsx:998-1011 raw `<input type="checkbox">`; ui/checkbox is listed as missing in the inventory. Violates 'build on shadcn/ui primitives before raw controls'._
- Raw <textarea> with hand-rolled focus-ring classes for CSV import instead of a shadcn Textarea primitive — _CoreScreens.tsx:1220-1225 `<textarea className="... focus-visible:ring-[3px] focus-visible:ring-ring/50">`. DS mandates shadcn primitives._
- Detail panel is not a Sheet/Drawer; no shadcn Sheet used though ui/sheet exists in the primitives set — _CoreScreens.tsx:1048 `<aside className="space-y-4">` is a plain column, not `<Sheet>`. The DS/feedback expect a right Sheet on selection; ui/sheet is present but unused here._
- No tabular-figure / Geist Mono treatment guaranteed on the Date column — _CoreScreens.tsx:1013 `<TableCell>{row.date}</TableCell>` renders date in the default UI font; prototype uses Geist Mono for date (proto line 97). Amounts go through <Amount> (good), but dates/mono fields do not._
- Reconciliation tile shows a static bankAccounts[0] regardless of any account filter, so the number can contradict the visible register (number-consistency risk) — _CoreScreens.tsx:779 `const selectedReconciliation = data?.bankAccounts[0] ?? null;` and 959-977 render it unconditionally; there is no account filter to even scope it._

**Responsive / layout issues.**

- Below the xl breakpoint the `xl:grid-cols-[1fr_380px]` (line 980) collapses to a single column, stacking the full detail panel ABOVE/BELOW the table; on desktop-narrow (lg) the 380px column still competes with the table, squeezing 7 columns.
- The Table has no horizontal-scroll wrapper (no overflow-x-auto on the `<div className="overflow-hidden rounded-lg border">`, line 981) — `overflow-hidden` clips rather than scrolls, so on narrow widths content is cut off instead of scrollable.
- Each row's inline Category `<Select>` is forced to `min-w-44` (line 1021); with 7 columns plus a 176px+ select inside a ~1fr column next to the 380px aside, the Merchant/Account columns get crushed and the select can overflow on tablet widths.
- No mobile card/list reflow: the same dense desktop table renders on phones (no `hidden md:table` / card fallback), violating 'mobile must be a real responsive surface, not a squeezed desktop table'.
- Reconciliation section uses `md:grid-cols-[1fr_auto_auto_auto]` (line 960) which on small screens stacks but on mid widths can collide with the amounts; not sticky, so it scrolls away with no register context.
- The filter row `lg:flex-row` (line 932) wraps the 5 review buttons + search; below lg they stack but there is no overflow handling once real filters (account multi-select, date range, etc.) are added.

**Additional issues caught by the adversarial verifier (missed on first pass).**

- MONEY/COLOR DESIGN-RULE VIOLATION the audit missed: every Amount in the register (line 1034 `<Amount amountMinor={row.amountMinor} signed />`) renders ordinary expenses with the same signed/colored treatment as income. AGENTS.md Design Rules state 'Money in can be green. Ordinary expenses should be neutral, not alarm red.' The prototype enforces this explicitly (proto 391 `amtColor: isIncome ? '#248716' : '#0a0a0a'` — income green, expense neutral black). Need to confirm the <Amount signed> primitive does not color negatives red, but the prototype's deliberate neutral-expense rule is not mirrored by passing a blanket `signed` flag, and the panel amount (line 1059) repeats it.
- DATA-INTEGRITY / DUPLICATE-POST RISK the audit missed: CSV import (lines 848-863) posts every row via routeTransaction with `externalId: csv:${date}:${description}:${amount}`. Two genuinely distinct same-day transactions with identical merchant+amount collide on externalId; the UI even computes `duplicateCsvCount` (line 778) and surfaces 'N duplicate-looking rows' (line 1218) but does nothing to block them — it imports anyway. This is a real correctness gap on a money surface, beyond the cosmetic feedback.
- AI-AUTONOMY-THRESHOLD copy mismatch the audit missed: the prototype's approval note hardcodes the 90% balanced threshold ('These fell below your 90% threshold', proto 85) and AGENTS.md mandates suggest/balanced=0.90/autopilot=0.75 as a shared constant. The current TransactionsScreen shows NO approval-explanation note at all and no threshold-aware messaging, so the owner gets zero explanation of why some rows posted automatically and others wait — a trust/transparency gap distinct from the listed copy gap.
- INLINE-APPROVE MISSING entirely (audit lists it inside the columns gap but understates it): the prototype's core review loop is the per-row 'Approve' button (proto 145-146) and bulk 'Approve selected' (proto 76). The current surface has NO approve action anywhere — not per-row, not bulk, not in the panel. The only state-changing actions are Recategorize (hardwired to acct 4200), Split, and Exclude. An owner literally cannot 'approve' a needs_review item from this screen, which breaks the mandatory v1 loop (uncertain items -> review -> confirm). This deserves blocker severity on its own and is not called out as a standalone gap.
- COMMENTS feature fully absent and unmentioned: the prototype drawer has a Comments thread with avatars, input, and post (proto 214-237; comments seeded at proto 306-309) intended for 'context for your accountant or future you.' The current panel (lines 1048-1191) has Activity history (read-only audit events) but no comment composer. The audit's column gap mentions 'comments' as a per-row indicator but never flags the entire commenting capability as missing.
- 'Create rule from this' action missing and unmentioned: prototype drawer footer has a 'Create rule from this' button (proto 261) — a key path to teach the pipeline. Current panel has no rule-creation affordance. Not listed in any audit gap.
- Performance/scale ceiling the audit missed: coreViews.transactions does an N+1-style per-row journalLines fetch in a loop (coreViews.ts:429-436, one ctx.db.query per row with entryId, up to 120 rows) AND for every row re-scans all 1000 fetched journalEntries to build entryIds (445-453). On a busy register this is quadratic-ish work inside a single query; relevant because the surface caps at slice(0,120) (line 426) yet still pays full cost. Not a design issue but a real backing-query concern for the Transactions surface the audit reviewed.
- AppScreen mount line is mis-cited: the audit says AppScreen.tsx:60 but the actual mount is line 59 (`{route.href === "/transactions" ? <TransactionsScreen /> : null}`). Minor, but flagged for accuracy since the audit presented it as a precise citation.

### 2.4 Income

**Files:** `apps/web/src/components/openbooks/IncomeScreen.tsx`, `convex/incomeViews.ts`, `apps/web/src/components/openbooks/AppScreen.tsx (line 60 routes /income -> IncomeScreen)`

**Adversarial verifier reliability:** medium

**Current state.** IncomeScreen.tsx:44 renders a 3-tab segmented control (Payments | Invoices | Receivables, lines 81-95) above a 4-card KPI strip (Received this month, Still open, Overdue, Avg days to pay — lines 102-123), then one of three tab bodies. Payments (145-186) is a 5-col read-only table (Date/From/For/Status/Amount) of income-direction transactions + reconciled Stripe payouts; rows are NOT clickable and do not link to the underlying transaction record (no transactionId/href; incomeViews.ts:113 has txn._id but the UI never uses it). Invoices (188-263) is a 7-col table with status sub-filter pills (All/Draft/Open/Paid/Overdue counts), rows open an InvoiceDetailDrawer (Sheet, max-w-440px). Receivables (271-339) is an aging matrix (Customer x Current/1-30/31-60/61-90/Total) with orange heat-shaded cells; customer click routes to /contacts, cell click switches to Invoices tab. Data comes from a single query api.incomeViews.overview (entity-scoped, requireWorkspaceRole). Aging reuses buildAgingRows from reportViews (incomeViews.ts:173) so AR reconciles with the report pack. Two right-side Sheets: InvoiceComposer (max-w-560px, Stripe send/save-draft/finalize) and InvoiceDetailDrawer (status, hosted link, line items, timeline). Detail panel is correctly CLOSED by default (detailId starts null, line 60).

**Prototype establishes.** Income.dc.html establishes the same shape the code implements: page title "Income" + subtitle "Money in — payments received, invoices out, and what's still owed · {entity}" (lines 24-26), a 3-segment toggle Payments|Invoices|Receivables (lines 29-33), a "New invoice" green button (line 34), and a 4-KPI grid identical in label/format to code (Received this month / Still open / Overdue #d92d20 / Avg days to pay, lines 38-58). Payments table = 5 cols with logo chip + status chip + signed colored amounts (lines 63-80). Invoices = underline sub-tabs with counts + 7-col table, rows clickable to open detail (lines 84-107). Receivables = 6-col aging matrix with orange heat cells and a Total footer row (lines 110-125). Composer drawer (560px) and Detail drawer (420px) with timeline dots, overdue note, and crucially a "Download PDF" action (line 242) that the code drops. The prototype establishes NO Customers tab, NO Streams tab, NO charts, and NO recurring-revenue concept — it is a 3-tab invoices/AR view, not the revenue-lens Ansar now wants. The current code is a faithful, near-1:1 port of this prototype.

**Feedback verification.**

| Reported issue | Status | Evidence |
|---|---|---|
| Income is inconsistent with Transactions/Expenses/Bills/Contacts/Payroll | Confirmed | Income uses a custom button segmented control (IncomeScreen.tsx:81-95) and inert tables; Transactions uses Button-pill review filters + search (CoreScreens.tsx:933-944); Expenses uses a period toggle + expandable category rows (ExpensesScreen.tsx:52-62, 98-121). No shared FilterBar/KpiStrip/DataTable component exists — each surface re-implements its own. Income payment rows don't link to records while Transactions rows are the records. |
| Income should be a revenue LENS over the same records + invoices, receivables, customers, streams, recurring, collections | Partial | Backend IS a lens: incomeViews.ts:111-137 derives Payments from income-direction transactions+payouts and reuses buildAgingRows (line 173) so AR reconciles with reports. BUT the UI exposes only payments/invoices/receivables; there is NO Customers tab, NO Streams tab, NO recurring-revenue/collections concept (grep NONE FOUND). And the lens does not drill into the universal register (no transaction link). |
| Want KPI strip: received this period, open/overdue receivables, avg days to pay, recurring revenue | Partial | IncomeScreen.tsx:103-122 renders Received/Still open/Overdue/Avg days to pay. Missing recurring revenue (MRR) entirely. 'Avg days to pay' is net terms, not realized days-to-pay (incomeViews.ts:196-202). |
| Want tabs: Payments, Invoices, Customers, Streams, Receivables | Partial | Only payments/invoices/receivables tabs exist (IncomeScreen.tsx:82). Customers and Streams tabs are not implemented. |
| Shared filters across tabs | Refuted | No shared/global filter exists. Only the Invoices tab has status pills (IncomeScreen.tsx:202-224); Payments and Receivables have none; no date-range control anywhere; KPIs are frozen to MONTH_START/TODAY constants (incomeViews.ts:8-9). |
| Tables drill into same records as Transactions/Reports | Refuted | Payments rows have no onClick/href and PaymentRow carries no transactionId/entryId (IncomeScreen.tsx:160-174); they cannot reach the Transactions register. Receivables drills only to /contacts (line 132). Only Invoices opens an in-app detail Sheet. Aging math IS shared with reports (incomeViews.ts:173) but the UI offers no drill into journal lines. |
| Want charts: by stream, by customer, recurring vs one-time, aging | Not found | No chart code on the surface. No Sparkline/BarChart imported or used in IncomeScreen.tsx (only the orange heat matrix at lines 290-333). The four requested chart types are entirely absent. |
| Decide Income<->Transactions relationship explicitly | Confirmed | Relationship is implicit-only and unresolved in the UI: backend treats Income as a read-model over transactions/invoices (incomeViews.ts:100-105) but the screen never links a payment back to its transaction record, so a user cannot tell Income and Transactions show the same money. The IA decision is unmade at the UI layer. |

**Design-system violations.**

- Overdue KPI amount uses raw Tailwind text-red-600 (#dc2626) instead of the --negative semantic token (#d92d20) — _IncomeScreen.tsx:115: <span className="... text-red-600"><Amount ... className="text-red-600" /></span>_
- Overdue/refunded status chips use raw red-50/red-700 utilities instead of --negative / --negative-surface tokens — _IncomeScreen.tsx:28 overdue: { className: "bg-red-50 text-red-700" }; line 31 refunded same; line 651 overdue note bg-red-50 text-red-700; line 245 daysPastDue ? "text-red-600"_
- Open/reconciled status chips use raw blue-50/blue-700 — off the brand palette entirely (info should route through --info #175cd3, and a blue accent fights the one-green rule) — _IncomeScreen.tsx:26 open: { className: "bg-blue-50 text-blue-700" }; line 30 reconciled: { className: "bg-blue-50 text-blue-700" }_
- Stripe blurple #635bff hardcoded as inline hex (defensible as a Stripe-only badge, but bypasses any token and is the same hex that leaks into ExpensesScreen DOTS as a generic category color) — _IncomeScreen.tsx:476 and :614: <span className="... bg-[#635bff] text-white">S</span>_
- Receivables heat cells hardcode an orange rgba(247,144,9,a) ramp inline rather than using the --warning / --chart-3 amber token — _IncomeScreen.tsx:268: backgroundColor: `rgba(247,144,9,${intensity.toFixed(2)})`_
- Raw HTML <select> with hand-rolled classes in the Invoice composer (Terms) instead of the shadcn Select primitive — violates 'build on shadcn/ui primitives before raw controls' — _IncomeScreen.tsx:508: <select value={terms} ...className="h-9 rounded-[10px] border bg-background px-3 text-sm"> with <option> children_
- Custom hand-rolled segmented tab control instead of shadcn Tabs primitive (ui/tabs exists per inventory) — divergent focus ring / keyboard behavior from the rest of the app — _IncomeScreen.tsx:81-95 button group with manual bg-card/shadow-sm active state; the Invoices sub-filter at 211-224 is a third bespoke tab style_

**Responsive / layout issues.**

- Invoices table is a 7-column shadcn Table (#, Customer, Issued, Due, Status, Amount, Balance) inside Card overflow-hidden with NO horizontal scroll wrapper (IncomeScreen.tsx:226-260). On a ~380px mobile viewport these 7 columns cannot fit; overflow-hidden will clip the right-most columns (Amount/Balance) rather than scroll — money figures get cut off.
- Receivables aging matrix uses a fixed CSS grid grid-cols-[1.5fr_repeat(5,1fr)] (6 columns) with no responsive collapse (IncomeScreen.tsx:290, 306, 326). On mobile the 5 money columns crush to unreadable widths; heat cells and amounts will wrap or truncate. This is a 'squeezed desktop table', exactly what the DS bans.
- Payments table is 5 columns with a max-w-[220px] truncate memo (line 169) and no mobile card fallback; on narrow screens the From-name + avatar + memo + status + amount row will overflow horizontally with no scroll container.
- KPI strip is grid md:grid-cols-4 (line 102) so it stacks 1-col below md — acceptable — but the 4 cards with long detail strings ('18 payments · 2 payouts reconciled') have no truncation and can wrap awkwardly on narrow cards.
- InvoiceComposer Sheet is sm:max-w-[560px] and the line-item grid is fixed grid-cols-[1fr_64px_96px_90px] (line 489); on a full-width mobile sheet the description column plus three fixed numeric columns leave very little room and the rate/total can collide.
- No sticky table header on any of the three tables, so when long invoice/payment lists scroll the column meaning is lost — and there is no pagination control despite incomeViews capping payments at 40 (incomeViews.ts:217) and invoices at 2000 (line 101).

**Additional issues caught by the adversarial verifier (missed on first pass).**

- TOKEN-EXISTENCE GAP (most material miss): the audit repeatedly prescribes --negative (#d92d20)/--negative-surface (#fef3f2) as the fix, but those tokens do NOT exist in the app stylesheet apps/web/src/app/globals.css — it defines only --positive, --warning, --info, --chart-1..5 (lines 73-80) and exposes @theme inline utilities only for those (lines 13-15,24-28). There is no --color-negative, so text-negative/bg-negative would not compile today. --negative lives only in 'OpenBooks Design System' tokens (per _ds_manifest.json), un-wired into the running app. The real defect is twofold: Income hardcodes raw red AND the app token layer is missing the negative semantic token; the audit treated the fix as trivially available when it is not.
- The audit's #175cd3 for --info is the Design-System hex, but the app's live --info is oklch(0.55 0.14 245) (globals.css:75); the audit conflated two sources of truth (DS tokens vs app globals) throughout the design-token section.
- Avg-days-to-pay is guarded against div-by-zero (incomeViews.ts:200) but is semantically misleading: it averages net terms regardless of when the invoice was actually paid, so a customer who always pays Net-30 invoices on day 5 still shows '30'. The KPI is effectively a constant of the terms mix, not a behavioral signal.
- Payments hard cap: incomeViews.ts:217 returns payments.slice(0,40) with no 'showing 40 of N' indicator and no load-more, while the 'Received this month' KPI is computed over the full pre-slice set (incomeViews.ts:141-142). On a >40-payment month the KPI total will not foot to the visible 40-row list — a reconciliation/trust issue the audit's generic 'no pagination' note misses.
- Receivables matrix has Current/1-30/31-60/61-90 but NO 90+ bucket (incomeViews.ts:221-228; header IncomeScreen.tsx:290-296). Money aged past 90 days is either folded into 61-90 or dropped by buildAgingRows — a potential reconciliation gap with the Reports AR aging the audit claims is fully shared.
- InvoiceComposer subtotal uses float dollar math: Math.round((Number(line.rate)||0)*100)*(Number(line.quantity)||0) (IncomeScreen.tsx:368,494). Free-text decimal entry (>2 decimals or float-prone values) can produce off-by-one-cent minor units before reaching the mutation — borderline against the 'never floats for stored financial amounts' rule; worth confirming the invoices.saveDraft mutation re-validates server-side.
- Accessibility: the bespoke segmented tabs (IncomeScreen.tsx:83-94) and invoice sub-filters (213-224) are plain <button>s with no role=tablist/aria-selected/arrow-key navigation, unlike the shadcn Tabs they bypass. Heat-matrix cells (lines 311-320) are <button>s with only a numeric label and no aria-label for the bucket/customer, so a screen reader hears a bare amount. The audit flagged the primitive bypass as styling but missed the a11y consequence.
- Routing bug: the deep-link tab is read once at mount via useState lazy init of searchParams.get('tab') (IncomeScreen.tsx:54-57); later URL changes (browser back/forward between ?tab=invoices and ?tab=receivables) do not re-sync the active tab — a minor correctness issue not surfaced by the audit.

### 2.5 Expenses

**Files:** `/Volumes/SSD/OpenBooks/apps/web/src/components/openbooks/ExpensesScreen.tsx`, `/Volumes/SSD/OpenBooks/apps/web/src/components/openbooks/AppScreen.tsx`, `/Volumes/SSD/OpenBooks/convex/expensesViews.ts`

**Adversarial verifier reliability:** medium

**Current state.** ExpensesScreen.tsx (230 lines) is mounted at /expenses via AppScreen.tsx:61. It renders four blocks: a header row (period segmented control "This month"/"Last month" + an "Add category" dialog button), a 3-up KPI grid (StatCard), an expandable category table, and a recurring list. KPIs are only Spent (k.spentMinor, ExpensesScreen.tsx:69-72), Recurring spend /mo (line 73-77), and Biggest movement (line 78-82) — there is NO uncategorized count, missing-evidence count, or top-vendor KPI; the backend overview query does not compute them (expensesViews.ts:266-274 returns only spentMinor/recurringMonthlyMinor/biggestMover). The "table" (CategoryTable, lines 91-146) is a CSS-grid of ~9 category rows, each a button that toggles an inline vendor sub-list (lines 122-135); it is NOT a transaction register — there is no per-transaction row, no date column, no merchant/category/status columns, no search box, and no row-detail drawer. Category dots use a hardcoded off-palette hex array DOTS (line 29) including Stripe blurple #635bff and plum #7a4a8c. Delta labels use unicode ▲/▼ (lines 26, 71, 80). RecurringSection (lines 148-174) lists detected vendors. AddCategoryModal (lines 176-229) uses a raw HTML <select> (line 215). Only period filtering exists (2 presets, computed server-side against demo TODAY=2026-06-11 in expensesViews.ts:7-15); no date range, account, vendor, category, or evidence filters.

**Prototype establishes.** The prototype (Expenses.dc.html) establishes the SAME category-and-recurring shell the code faithfully mirrors: page title "Expenses" + subtitle "Where money goes, by category and vendor" (line 26-27), a 2-segment period control (This/Last month, line 31-33), an "Add category" button (line 35), a 3-up KPI grid — Spent, Recurring spend ($11,430/mo, 82% predictable), Biggest movement (lines 39-55) — then the expandable category breakdown table with the identical 7-column grid `18px 1.4fr 70px 1fr 90px 110px 14px` (line 59), per-category dot + share bar + vs-last delta + amount + chevron, expanding to vendor sub-rows (lines 62-88), a Total footer (line 89-92), and a Recurring section "detected from your last 6 months" (lines 95-115). The prototype itself uses the off-palette dots (#475467, #0e9384, #8c6a3f, #f79009, #635bff, #1d6bb5, #7a4a8c at lines 152-190) and unicode ▲/▼ deltas (lines 245-248). So the prototype is category-lens-only by design; it does NOT establish a full expense transaction table, tabs, a KPI strip with uncategorized/evidence counts, or per-vendor/charts views. Ansar's feedback explicitly asks to go BEYOND the prototype here.

**Feedback verification.**

| Reported issue | Status | Evidence |
|---|---|---|
| Category/recurring focused, lacks a full tabular expense view | Confirmed | ExpensesScreen.tsx:85-86 renders only CategoryTable + RecurringSection; CategoryTable (91-146) shows category aggregates, never per-transaction rows. No Table import, no date/merchant columns. Contrast TransactionsScreen full register at CoreScreens.tsx:982-1045. |
| Date filtering too limited | Confirmed | Only 2 presets (this/last month) ExpensesScreen.tsx:33-37, bound to expensesViews PERIODS (expensesViews.ts:12-15). No range picker, no search, no other filters. |
| Should match Income/Transactions | Confirmed | Income has tabs payments/invoices/receivables + KPI row + shadcn Table (IncomeScreen.tsx:82-95, 102-123, 149-180); Transactions has search + review pills + full Table + detail drawer (CoreScreens.tsx:933-943, 982-1045, 1048-1060). Expenses has none of tabs/search/full-table/drawer. |
| Implementation includes at least one PURPLE accent in expense category dot data (design-system violation) — FIND IT | Confirmed | ExpensesScreen.tsx:29 DOTS array contains #635bff (Stripe blurple, index 6) and #7a4a8c (plum, index 9), applied as generic category dots/share-bar fills at lines 109 and 116. Same #635bff is legitimately a Stripe-only badge in IncomeScreen.tsx:476,614 — it leaked into Expenses as a generic swatch. |
| Want KPI strip: spent this period, recurring spend, uncategorized count, missing-evidence count, top vendor/category | Partial | Spent + Recurring spend exist (ExpensesScreen.tsx:69-77); third KPI is 'Biggest movement' (78-82), NOT uncategorized/evidence/top-vendor. Those three are absent and unbacked: expensesViews.ts:266-274 returns no uncategorizedCount/missingEvidenceCount/topVendor. |
| Want tabs: Transactions, Categories, Vendors, Recurring, Evidence Needed | Not found | No tabs in ExpensesScreen.tsx. tabs.tsx primitive exists (apps/web/src/components/ui/tabs.tsx) but is not imported. Only Categories and Recurring content exist; Transactions/Vendors/Evidence views are absent. |
| Want shared filters | Not found | No shared FilterBar/DateRange component used; only a local period state (ExpensesScreen.tsx:33). No search Input (Transactions uses one at CoreScreens.tsx:942). |
| Want full expense table | Refuted | Not present. CategoryTable is category-aggregate grid (ExpensesScreen.tsx:95-119); no per-expense rows. This is the headline missing feature. |
| Want charts: by category, by vendor, recurring trend, unusual spend | Partial | Only per-row inline share bar exists (ExpensesScreen.tsx:115-117). No vendor chart, recurring-trend line, or unusual-spend chart. primitives.BarChart/Sparkline available but unused here. |
| Expenses neutral not alarm red | Confirmed | ExpensesScreen renders amounts via Amount with no expense=red; negative deltas use text-primary/text-muted-foreground (ExpensesScreen.tsx:118), warn deltas would use amber not red. No red-50/red-600 in this file (only text-destructive for a form error at line 220). This rule is already honored here — unlike IncomeScreen which uses raw text-red-600 at line 115. |

**Design-system violations.**

- Off-palette purple category dots — the suspected PURPLE. #635bff (Stripe blurple) and #7a4a8c (plum) used as generic category swatches, plus #1d6bb5 blue and non-token browns/grays, instead of --chart-1..5 tokens (which exist at globals.css:76-80: #2ca01c/teal/amber/slate/red). — _apps/web/src/components/openbooks/ExpensesScreen.tsx:29 const DOTS = [...,"#635bff","#1d6bb5",...,"#7a4a8c"]; applied at lines 109 (dot) and 116 (share-bar fill)._
- Unicode geometric glyphs ▲/▼ used as functional trend icons; DS mandates lucide TrendingUp/TrendingDown and bans unicode-as-icon. — _apps/web/src/components/openbooks/ExpensesScreen.tsx:26 (deltaLabel), 71 (Spent KPI detail), 80 (Biggest movement value)._
- Raw HTML <select> with hand-rolled classes instead of the shadcn Select primitive in the Add Category modal — won't match DS focus ring/styling. — _apps/web/src/components/openbooks/ExpensesScreen.tsx:215-217 <select ... className="h-9 rounded-[10px] border bg-background px-3 text-sm"> with <option> children. Select primitive is already used in CoreScreens.tsx:1020._
- Arbitrary px font sizes (text-[12.5px], text-[11.5px], text-[13px]) bypass the DS type scale (12 meta / 14 body / 16 card-title); pervasive across rows. — _apps/web/src/components/openbooks/ExpensesScreen.tsx:58, 96, 111, 114, 118, 119, 153, 160, 161, 164, 165._

**Responsive / layout issues.**

- Category table uses a hardcoded 7-column CSS grid `grid-cols-[18px_1.4fr_70px_1fr_90px_110px_14px]` with NO responsive variant and NO overflow-x on the Card (ExpensesScreen.tsx:95 header and 107 rows; Card overflow-hidden at line 94). On a ~380px mobile viewport the fixed 70px/90px/110px tracks plus share bar can't fit — content compresses/clips rather than reflowing or horizontally scrolling. This is a 'squeezed desktop table', which the DS bans.
- Recurring rows are a flex row with multiple fixed minimums: badge + `min-w-[110px]` next-date + `min-w-[90px]` amount (ExpensesScreen.tsx:157-165). With the 28px logo and vendor name, total min width exceeds a phone width, forcing overflow or truncation of the vendor name (only the name has min-w-0 flex-1 at line 159).
- Vendor sub-rows inside an expanded category use `min-w-[90px]` amount + flex name (ExpensesScreen.tsx:128-130) with left padding pl-12 (line 123), eating horizontal space on mobile.
- Header is `flex flex-wrap` with the period control pushed by `ml-auto` (ExpensesScreen.tsx:50-51); on wrap, the segmented control and 'Add category' button can stack awkwardly without an intentional mobile layout.
- No sticky table header: when the (future) full table is added it must handle sticky headers; the current category grid is a plain Card with no sticky region, unlike a real register.

**Additional issues caught by the adversarial verifier (missed on first pass).**

- LETTER-SPACING DS VIOLATION (missed): The DS rule 'Keep implementation letter spacing at 0' is broken in this file. ExpensesScreen.tsx:95 and :152 use Tailwind 'tracking-wide' (0.025em) on the uppercase column header and the 'Recurring' label — a non-zero letter spacing. The prototype uses letter-spacing:0.03em (line 59) and 0.04em (line 98). The audit flagged px font sizes but missed this explicit, named DS rule.
- PROTOTYPE-FIDELITY CONTEXT MISSING (systemic): The audit never establishes that ExpensesScreen.tsx is an almost line-for-line reproduction of Expenses.dc.html. The 7-col grid (proto L59), the ▲/▼ glyphs (proto L245,247), the raw <select> (proto L130-131), the px font sizes, the inline share bar (proto L72), the 3 KPIs (proto L41-53), and 9 of 10 dot colors (proto L151-189) are all from the prototype. This reframes nearly every 'violation' from 'implementation defect' to 'faithful reproduction of a prototype that predates/contradicts the DS.' Severity labels like 'blocker' for the missing full table are therefore misleading — that table is Ansar's aspiration, not a prototype element that was dropped.
- #7a4a8c IS THE ONLY REAL OFF-PALETTE ADDITION (the audit buried this): grep confirms #7a4a8c (plum, DOTS index 9) does NOT appear anywhere in the prototype, while #635bff and #1d6bb5 DO. The audit's headline 'purple leaked from IncomeScreen' is wrong; the genuinely defensible finding is narrower: one plum dot was added beyond the prototype palette. The audit inflated this into a 'Stripe blurple leak' story that the evidence contradicts.
- ACCESSIBILITY (missed): The category rows are <button> elements wrapping a CSS grid (ExpensesScreen.tsx:103-121) used purely as a disclosure toggle, but there is no aria-expanded / aria-controls on the button and the chevron has no accessible label. A screen reader cannot tell the row is expandable or its state. The Transactions register by contrast uses semantic table rows. Not flagged by the audit.
- HARDCODED DEMO DATE (missed, backend correctness): expensesViews.ts:7 hardcodes TODAY = '2026-06-11' and PERIODS are fixed to June/May 2026 (lines 12-15). All period math, recurring window (line 110), and 'next date' projections are pinned to this demo date, so the Expenses surface will silently show stale/empty periods for any real 'today' other than mid-June 2026. This is a real correctness/limits gap the UI-focused audit did not surface.
- CHART-TOKEN VALUES MIS-STATED (audit factual error worth recording): The audit asserts --chart-1..5 = '#2ca01c/teal/amber/slate/red' as concrete hexes. globals.css:76-80 actually defines only --chart-1 as #2ca01c; --chart-2..5 are oklch() values. Minor, but it weakens the audit's 'use these exact tokens' recommendation since it misrepresents what the tokens are.

### 2.6 Bills

**Files:** `apps/web/src/components/openbooks/ModuleScreens.tsx (BillsScreen at :473, BillMatchPicker at :812, AddBillModal at :875; routed at :1918)`, `apps/web/src/components/openbooks/module-helpers.ts (BillRow type :142, bills view shape :16-52, statusLabel :186)`, `convex/moduleViews.ts (billRows :328, billGroups :348, bills KPIs :499)`, `convex/bills.ts (matchCandidates :137, markPaid :179, createBill :302)`, `convex/schema.ts (bills table :504)`

**Adversarial verifier reliability:** high

**Current state.** BillsScreen renders a stack, not a workbench. Top: a ModuleIntro card with a long explanatory paragraph (ModuleScreens.tsx:586-588) plus two actions (Upload file label-button + AddBillModal). A 3-up StatCard strip shows only Open total / Due this week / Overdue (:602-606). A large "Receipt and bill upload" Card (:608-729) holds a dashed drop-zone with a raw <select> type picker (:625-632), four override Inputs, and an "Uploaded evidence" list (:669-726) mixing receipts and bill PDFs with status badges, confidence chip, preview, "Confirm suggested match", "Create expense". Below, a two-column section (:731-799): left renders the four due-window groups (overdue/this week/later/paid) as separate Cards, each containing div rows (NOT a shadcn Table) with vendor button, status badge, Amount, and a "Mark paid" button (:740-761); right is a persistent "Selected bill" panel that is mostly empty until a row is clicked (:770-798) and only ever shows vendor + due/status + a mark-paid button + two paragraphs of explanatory copy (:793-796). Mark-paid opens BillMatchPicker Dialog (:812). There is NO search, filter, sort, export, column headers, or row drawer (grep of :473-810 returns none). Available-but-unsurfaced data: postingAffordance, daysUntilDue, document evidence link, ledger entryIds (module-helpers.ts:142-153).

**Prototype establishes.** Bills.dc.html is a grouped-list mockup, not a table. Header: "Bills" title + one explanatory subline (:24-25) + single "Add bill" button (:28). A 3-up KPI grid: Open, Due this week (amber #b54708), Overdue (:31-47). A green AI suggestion panel (:49-70) lists recurring-but-untracked vendors from "six months of transactions" with "Track it" / "Not a bill" actions. Bills render as three section groups — "Due this week", "Later this month", "Recently paid" (:72-114) — each a white card of flex rows: vendor avatar, name with "extracted from PDF" and recurring-cadence pills, memo, right-aligned amount + due, and a "Mark paid" button (open) or "Paid" chip (:101-109). A closing explainer line (:115). The Add-bill modal is a 2-path chooser (:118-142): "Upload a PDF" (AI extracts vendor/amount/due, you confirm — with per-field confidence underlines green/amber and "% sure" captions :145-183) vs "Type it in" manual form (:185-210). Mark-paid opens a match picker listing bank-transaction candidates with a "best match" chip and a "No match yet — expect one" escape (:215-241). No filters, sort, search, export, or row drawer in the prototype either; detail lives in modals.

**Feedback verification.**

| Reported issue | Status | Evidence |
|---|---|---|
| Unnecessary explanatory text on page | Confirmed | ModuleScreens.tsx:588 long ModuleIntro description; :794 'true accrual books without the homework'; :796 'Partial payments are out of scope in this version'; :619 upload reason paragraph. |
| Open/due-this-week/overdue/paid groupings not arranged into a clear AP workflow | Confirmed | billGroups produces overdue/this_week/later/paid (moduleViews.ts:348-353) rendered as four separate stacked Cards (ModuleScreens.tsx:733-767) with no unified workflow, sort, or triage ordering; KPIs (:602) don't tie to the groups as a workflow. |
| Upload-evidence + bill tracking visually scattered | Confirmed | Evidence upload + uploaded-document list is a standalone Card (:608-729) physically separated from the bill group Cards (:731-767); a document and its bill are never shown on the same row, and selecting a bill (:770) shows no evidence. |
| No table-first workbench with filters/search/sort/export/row-detail | Confirmed | BillsScreen uses div rows not shadcn Table (Table imported :49-56 but unused here); grep of :473-810 finds no search/filter/sort/Export; detail is a persistent half-empty panel (:770-798), not an on-demand row drawer. |
| Reframe as AP workbench with actions Add bill + Upload bill | Partial | Both actions exist (Upload file label :591-596, AddBillModal :597) but as ModuleIntro card actions, not a workbench action row; AddBillModal is a single manual form (:906-933), not the prototype's 2-path upload/type chooser. |
| KPI strip should include open total, overdue, due soon, paid this period, missing evidence, avg days to pay | Partial | Only openMinor/dueThisWeekMinor/overdueMinor computed (moduleViews.ts:499-510) and rendered (:602-606). paidThisPeriod, missingEvidence count, and avgDaysToPay are NOT computed or shown. |
| Columns: vendor, bill #, due date, amount, status, category, evidence, payment match, source, AI confidence | Partial | Row shows vendor, due date, amount, status only (:746-760). bill # / category / source / AI confidence are absent from BillRow (module-helpers.ts:142-153); bills schema has no billNumber/categoryAccountId/confidence column (schema.ts:504-516); evidence + payment match exist in data (document, matchedTransaction) but on the separate upload card, not the bill row. |
| Row drawer with evidence, extracted fields, payment schedule, matched txn, ledger impact, approval/posting history | Refuted | No drawer exists. The 'Selected bill' Card (:770-798) shows only vendorName + 'Due X · status' + a mark-paid button + two boilerplate paragraphs — none of evidence/extracted-fields/schedule/matched-txn/ledger-impact/approval-history is rendered, even though entryIds/document data is available. |

**Design-system violations.**

- Raw HTML <select> with hand-rolled classes instead of shadcn Select primitive (DS rule: build on shadcn primitives before raw controls). — _ModuleScreens.tsx:625-632 <select className="h-9 w-full rounded-lg border bg-background px-3 text-sm"> with <option value="receipt"/> children in the upload panel._
- Bills register rendered as bespoke div grid rows rather than the shadcn Table primitive that the file already imports and uses elsewhere — inconsistent with the design system's dense-table pattern. — _Div rows at ModuleScreens.tsx:741-761 (grid md:grid-cols-[1fr_auto_auto_auto]); Table is imported at :49-56 and used for Invoices (:443) and Payroll (:1106) but not Bills._
- Status rendered via statusLabel string in muted subtext rather than a semantic status treatment; overdue/due-soon get no distinct negative/warning token, so an overdue bill reads the same neutral as an open one. — _ModuleScreens.tsx:748 'Due {bill.dueDate} · {statusLabel(bill.postingAffordance)}'; statusChip (:94-95) is a plain outline Badge with no overdue/warning color, unlike the prototype's amber due-this-week (#b54708, Bills.dc.html:39) and date-color logic (dueColor at :276)._
- Persistent side detail panel renders an empty 'No bill selected' state by default, consuming ~45% of the row width with no information — violates dense-but-readable intent and the requested closed-by-default-drawer pattern. — _ModuleScreens.tsx:779 '{selectedBill ? selectedBill.vendorName : "No bill selected"}' inside the always-rendered right Card (:770-798)._

**Responsive / layout issues.**

- Page splits into xl:grid-cols-[1.1fr_0.9fr] (ModuleScreens.tsx:731); below the xl breakpoint the 'Selected bill' panel drops below all group Cards, so on tablet/mobile a user clicks a bill then must scroll down past every group to see the (mostly empty) detail panel.
- Bill group rows use md:grid-cols-[1fr_auto_auto_auto] (:743); below md they collapse to a single stacked column where the Mark-paid Button, status badge, and Amount stack vertically — no compact mobile row layout, just a squeezed desktop grid.
- Upload override fields use sm:grid-cols-2 (:622) inside the left column of a lg:grid-cols-[0.9fr_1.1fr] panel (:613); at mid widths the four Inputs + raw select crowd into a narrow column.
- Uploaded-evidence rows use md:grid-cols-[1fr_auto] (:673) with a vertical action stack (Preview / Confirm match / Create expense) on the right; on narrow screens the action column wraps under and the row height balloons.
- No horizontal scroll container or sticky header anywhere — when this becomes a real table, there is currently no scroll-area primitive (uiPrimitivesMissing: scroll-area) so a wide AP table will overflow the max-w-1200 main without a managed scroll region.

**Additional issues caught by the adversarial verifier (missed on first pass).**

- AddBillModal copy is internally inconsistent and stale vs the verified capability. The modal's DialogDescription (ModuleScreens.tsx:909) says 'image uploads work today; PDF text extraction lands in a later epic', but BillsScreen.uploadReceiptFiles already calls extractWithBedrock with a 'pdf_text' mode branch (ModuleScreens.tsx:524-527, 'PDF text' label) and the upload reason string explicitly advertises 'extracts image or PDF text metadata' (moduleViews.ts:515). The audit flagged 'unnecessary explanatory text' but missed that one of those texts is also factually wrong / contradicts the shipped PDF-text path.
- BillRow.document (the per-bill evidence link) is fully plumbed server-side but rendered nowhere. moduleViews.ts:330 resolves bill.documentId, :340-342 returns {id,vendor,status,totalMinor}, and module-helpers.ts:151 types it on BillRow — yet grep shows BillsScreen never reads selectedBill.document or bill.document. The audit said evidence 'exists in data but on the separate upload card'; it missed that a direct bill->document link ALSO already exists on the bill row's own data and is silently dropped, which makes the 'cohesion' fix far cheaper than the audit implies (the join is already done).
- BillRow.daysUntilDue is computed (moduleViews.ts:339) and typed (module-helpers.ts:150) but never used by the UI; the row instead renders the raw dueDate string (ModuleScreens.tsx:747-748 / :751) with no 'in 3 days' / 'X days overdue' humanization and no use of daysUntilDue to drive an amber/negative token. The audit noted the missing warning color but missed that the magnitude field needed to drive it is already on the row.
- Schema/contact mismatch in AddBillModal flow not noted: createBill takes vendorName as a free string (bills.ts:302, ModuleScreens.tsx:891) but the bills schema stores contactId (schema.ts:506), so every manually-added bill must resolve/create a contact. The audit lists 'vendor' as a present column but never checks that the manual-add path and the contact-backed schema agree; worth a verification note even though it is not a UI defect.
- The KPI dueThisWeekMinor double-counts vs overdue boundary correctly but openMinor includes overdue+later+this_week while the three KPIs are computed from different sources (openMinor from billRows.filter status==='open' at moduleViews.ts:501-503, dueThisWeek/overdue from billGroups at :504-509). Functionally consistent, but the audit asserted KPIs 'don't tie to the groups as a workflow' without noting that two of the three KPIs ARE derived from the groups (:504-509) — a minor over-claim in the audit's wording, surfaced here for accuracy.

### 2.7 Contacts

**Files:** `apps/web/src/components/openbooks/ModuleScreens.tsx`, `apps/web/src/components/openbooks/module-helpers.ts`, `apps/web/src/components/openbooks/AppScreen.tsx`, `convex/moduleViews.ts`, `convex/schema.ts`, `apps/web/src/components/openbooks/primitives.tsx`, `apps/web/src/components/openbooks/CommandPalette.tsx`

**Adversarial verifier reliability:** high

**Current state.** ContactsScreen (ModuleScreens.tsx:142-252) renders a two-column split that is ALWAYS shown: a directory Card on the left and a ContactProfile Card on the right, in a `grid xl:grid-cols-[1.2fr_0.8fr]` (line 179). Because the backend defaults `selectedProfile` to `contactRows[0]` (moduleViews.ts:263-264), the profile pane is populated by default with the top contact even before any click — exactly the "profile pane shown by default, directory cramped" complaint. The directory is a shadcn Table (lines 209-244) with only 4 columns: Name (+aliases sub-line), Role (CategoryChip per role, raw lowercase string, no color), Open balance (`openReceivableMinor - openPayableMinor`, neutral tone), This year. Filters are 3 buttons only: All / Customers / Vendors (lines 185-195) plus a text search over name+email+aliases (line 158). The ContactProfile (lines 254-333) shows name+email header, role chips, three StatCards (Open A/R, Open A/P, This year), a static "Default category as rule" card, a static non-functional "Merge duplicates" text card (lines 303-313), and a flat 5-row "Recent history" list — NO tabs, NO Sheet/Drawer, NO notes editor, NO archive/merge actions. "Add contact" button has no onClick (lines 172-176). Backend computes `lastActivity` (moduleViews.ts:233-238) but the ContactRow frontend type (module-helpers.ts:115-126) drops it and the table never shows it.

**Prototype establishes.** Contacts.dc.html is a single-record-at-a-time model with two mutually exclusive modes: LIST (`listMode`, line 23) and PROFILE (`profileMode`, line 95) — the profile is NOT shown alongside the list; clicking a row swaps the whole screen to the profile and a back button returns. List view: full-width directory card (max-width 1000px) with a 6-column grid (line 60): Name (avatar+initials+alias sub), Role (colored chips: customer=green, vendor=neutral, team=blue), Received YTD, Paid YTD, Open balance (red + alert icon when overdue, green when healthy AR, plain for vendor AP — lines 77-87), Last activity. A top "merge suggestion" banner ("AMZN MKTP US and Amazon look like the same vendor — merge them?" lines 33-39) with Merge / Keep separate actions, collapsing to a "Merged — 9 transactions moved" confirmation (lines 41-46). Role filter pills (All·count / Customers / Vendors, lines 49-51) + a search box. Profile view: 52px avatar header with role chips + a "Stripe customer" badge; three KPI cards (Lifetime total, They owe you/You owe them, Avg invoice/transaction); a vendor-only "Always file X as <category> — acts as a rule" affordance (lines 134-140); tabs (Invoices & payments / Transactions & bills, and Notes — lines 142-146); an activity list of dated rows with status chips (Paid/Overdue/Open/Rule). Notes tab shows a freeform note.

**Feedback verification.**

| Reported issue | Status | Evidence |
|---|---|---|
| Unnecessary explanatory text | Confirmed | ModuleScreens.tsx:168-177 ModuleIntro renders a boxed 3-line architectural paragraph; prototype uses a single 13px subtitle (Contacts.dc.html:27) |
| Contact profile pane shown BY DEFAULT -> directory cramped | Confirmed | ModuleScreens.tsx:179 grid xl:grid-cols-[1.2fr_0.8fr] always renders <ContactProfile> at line 248; selectedProfile defaults to contactRows[0] in moduleViews.ts:263-264, so the pane is populated before any click |
| Should be full-width directory first; profile Sheet/Drawer only on selection | Refuted | No Sheet or Drawer is used anywhere in ModuleScreens.tsx (grep for Sheet/Drawer returns none on this surface); the directory is a permanent 1.2fr column, not full-width. shadcn 'sheet' exists in ui/ but 'drawer' is absent from the primitive set |
| Filters: customers, vendors, employees, contractors, open AR, open AP, recurring, recently active | Refuted | Only all/customer/vendor buttons at ModuleScreens.tsx:185-195. employee/contractor are not valid roles (schema.ts:234 roles = customer\|vendor). No open-AR/open-AP/recurring/recently-active filters exist |
| Columns: name, type, aliases, open AR/AP, this-year volume, last activity, default category/rule | Partial | Present: name+aliases sub-line (ModuleScreens.tsx:227-228), role (line 232), combined open balance (line 236), this-year (line 239). Missing as columns: separate open AR vs AP, last activity (computed at moduleViews.ts:233 but never surfaced), default category/rule |
| Detail: receivables, payables, txn history, aliases, rules, notes, merge duplicates, archive | Partial | Present: AR/AP StatCards (ModuleScreens.tsx:288-289), history list (315-329), default-category rule card (293-301), static merge card (303-313). Missing: aliases section in detail, notes editor, archive action, functional merge (moduleViews.ts:295 mergeFlow is placeholder) |
| Decide: deletion vs soft-archive | Not found | contacts schema has no archived/deleted flag (schema.ts:231-240); no delete or archive mutation for contacts exists. Decision is unmade in code |

**Design-system violations.**

- Boxed marketing-style intro banner with architectural jargon violates 'quiet' DS and the no-ornament rule — _ModuleScreens.tsx:168-177 ModuleIntro renders a bordered card paragraph 'ties each contact to open receivables, open payables, and the default-category rule affordance'_
- Role chips render raw lowercase enum strings ('customer','vendor') instead of Title-case plain-English labels; no per-role color semantics — _ModuleScreens.tsx:232 <CategoryChip key={item} label={item} /> passes the raw role; primitives.tsx:194-210 CategoryChip has no role-aware coloring_
- Static Sparkles AI card is always rendered even when no rule/default category is configured, surfacing a hollow AI affordance instead of a quiet conditional one — _ModuleScreens.tsx:293-301 always shows the Sparkles 'Default category as rule' card; label falls back to 'Set a default category for X' (moduleViews.ts:257) so the green AI mark appears with no real AI action_
- Open-balance amounts carry no overdue/aging signal; the DS allows --negative red for overdue AR but the cell is flat neutral, losing the prototype's at-a-glance health cue — _ModuleScreens.tsx:236 <Amount amountMinor={openReceivableMinor - openPayableMinor} /> with default tone='neutral' (primitives.tsx:38); prototype uses red+icon for overdue (Contacts.dc.html:81-85)_
- Permanent empty 'No contact selected' pane occupies layout space — decorative dead space that conflicts with a clean ledger surface — _ModuleScreens.tsx:261-268 renders an EmptyState Card in the 0.8fr column whenever nothing is selected_

**Responsive / layout issues.**

- Two-column split grid xl:grid-cols-[1.2fr_0.8fr] (ModuleScreens.tsx:179) only collapses at the xl breakpoint; between md and xl the directory + profile are stacked but the directory is still not full-width-first, and on a laptop (~1280px) the 4-column money table is squeezed into 1.2fr while the profile eats 0.8fr.
- Directory Table has no horizontal scroll container; on narrow viewports the Name/aliases cell (ModuleScreens.tsx:226-229) plus two right-aligned money columns will overflow or wrap because shadcn Table renders a raw <table> with no overflow-x wrapper here.
- Role filter buttons use flex-wrap (ModuleScreens.tsx:184) so on mobile they wrap to multiple rows, pushing the search input down and creating an uneven header; acceptable but not a designed mobile filter affordance.
- Profile StatCards use grid sm:grid-cols-3 xl:grid-cols-1 (ModuleScreens.tsx:287) — at sm-to-lg they sit 3-across inside the 0.8fr column, making each card very narrow and the money values cramped.
- No Sheet/Drawer means on mobile the only way to view a profile is the stacked card below the directory; there is no mobile-appropriate slide-over, so selecting a contact on a phone scrolls the user past the whole directory to find the profile.

**Additional issues caught by the adversarial verifier (missed on first pass).**

- selectedId is initialized from the URL (focusContactId, ModuleScreens.tsx:150) but the row onClick at line 224 only does setSelectedId(contact.id) WITHOUT pushing a router/searchParam update, so deep-link state and click-selection diverge: a selected profile is not reflected in the URL and is lost on refresh — the audit never examined this selection/state correctness issue.
- The directory 'This year' column conflates money-in and money-out into a single `totalThisYearMinor` (moduleViews.ts:223-232 sums invoice paid + bill totals + abs(transaction amounts)), so a customer's received revenue and a vendor's spend are summed into one opaque figure. The prototype deliberately splits Received·YTD (green) vs Paid·YTD (neutral) per role (Contacts.dc.html:60-61, 273-276). The audit flagged the missing split as columns but did not call out that the single value is semantically meaningless (revenue+spend added together).
- The combined open-balance cell `openReceivableMinor - openPayableMinor` (ModuleScreens.tsx:236) is actively misleading for any contact that is BOTH customer and vendor: AR and AP net against each other into one number, hiding that they owe you AND you owe them. The prototype keeps balKind ('ar'/'ap') distinct (Contacts.dc.html:278). This is a correctness/clarity bug beyond the 'no overdue color' point the audit raised.
- No Stripe-customer badge on the profile. The prototype shows a 'Stripe customer' badge when prof.stripe is true (Contacts.dc.html:111-113), tying the contact back to its Stripe origin. The current ContactProfile (ModuleScreens.tsx:273-333) has no such provenance indicator and the backend never carries a stripe flag — audit listed 'Stripe badge' once inside the detail-panel gap but did not verify it is entirely unsupported end-to-end (no field in ContactRow/schema).
- Search input has no clear/reset affordance and no result count; combined with role filter it can produce an empty `filtered` list that renders an empty <TableBody> with NO empty-state row (ModuleScreens.tsx:218-243 maps filtered with no length check), leaving a bare header and blank card when a search matches nothing. The audit's empty-state discussion focused only on the right pane and missed this list-level empty case.
- The profile 'Recent history' is capped at 5 items in the UI (ModuleScreens.tsx:318 history.slice(0,5)) even though the backend already trims to 12 (moduleViews.ts:294) — a silent truncation with no 'view all' affordance; the prototype profile is a full tabbed activity feed. Not noted by the audit.

### 2.8 Payroll

**Files:** `apps/web/src/components/openbooks/ModuleScreens.tsx (PayrollScreen:937, PayrollEmployees:1018, PayrollRuns:1063, PayrollRunDetail:1119, PayrollRunLineRow:1264, PayrollRunStatement:1339, PayrollStatement:1401; routed at ModuleScreens.tsx:1919 and AppScreen.tsx:65)`, `convex/moduleViews.ts (payroll read-model: overview, lines 432-535)`, `convex/payroll.ts (runDetail:123, backfillRunLines:240, startRun:253, updateRunLine:334, approveRun:379, markLinePaid:548, markRunPaid:594, statement:644)`, `convex/payrollMath.ts (line math)`, `convex/schema.ts (employees:517, payrollRuns:527, payrollRunLines:550)`

**Adversarial verifier reliability:** high

**Current state.** PayrollScreen renders a ModuleIntro card (title/description + a 3-button "tab" group rendered as shadcn Buttons, not Tabs — ModuleScreens.tsx:976-980), then a 4-up StatCard strip (one tile per currency total + a Headcount tile — 985-999), then one of three tab panels: Employees, Runs, Statement. Employees (1018) is a read-only Table with a DEAD "Add employee" button (1023, no onClick). Runs (1063) is a Table (Period/People/Status/Base total); a "Run payroll · June" button is hardcoded to the literal period "2026-06" (runJune 952-963, gated by hasJuneRun 950). Clicking a row opens PayrollRunDetail (1119), an in-place full-screen replacement (not a closed-by-default row detail) with a back button, status chip, period-locked chip, Grid/Statement toggle, Approve/Mark-all-paid/Load-lines buttons, an editable adjustment+FX grid (PayrollRunLineRow:1264, paid checkbox is readOnly:1330), currency totals + base total footer. Statement tab (PayrollStatement:1401) is a separate read-only table with Print/CSV. Approval banner text concatenates raw `localMinor/100` floats (1194). Run `headcount` is computed from CURRENT active employees, not the run snapshot (moduleViews.ts:528).

**Prototype establishes.** Prototype (Payroll.dc.html) establishes: page title "Payroll" + subtitle "A register, not a processor — you pay people your way, the books stay right" (24-26). A 3-tab bar with a green underline-active treatment (36-40): "Employees · N", "Runs", "Statement". Employees = card-table (Name/Country/Currency/Monthly salary/Paid via/Status) with avatar initials + green Active pill + "Add employee" modal (208-258). Runs = an empty-state info banner "June hasn't been run yet… Run payroll drafts the statement…" with "due Jun 30" (67-73), then a card-table (Period/People/By currency/Base total/Status) with colored status chips (Paid green, Approved blue #eff8ff/#175cd3, Draft gray). Run detail = a 3-step progress indicator Review→Approve→Mark paid (100-107) with checkmark dots, contextual approved/paid/historical banners, an editable grid (Employee/Base/Adjustment/Final/FX rate/USD equiv/Paid checkbox) + footer totals. Statement = per-country grouped statement with local+USD columns, subtotals, a green period-total bar ($17,757.40), Export PDF/CSV, AND a 12-month USD-equivalent bar trend chart (195-205). No KPI strip, no period dropdown, no contractors tab in the prototype either.

**Feedback verification.**

| Reported issue | Status | Evidence |
|---|---|---|
| Does not communicate whether runs are auto-generated, manual, or imported | Confirmed | Runs list (ModuleScreens.tsx:1086-1113) shows only Period/People/Status/Base — no provenance copy or stepper. Actual mechanism is manual: startRun (payroll.ts:253) drafts from active employees; the only cron is Plaid sync (crons.ts:7). No import mutation exists. The UI never states this. |
| Statement selection too static | Confirmed | PayrollStatement (1401) renders data.payroll.statementRows = current roster only (moduleViews.ts:442-449); no period chooser. PayrollRunStatement (1339) is locked to one run. No way to pick a past statement period. |
| Controls/tables inconsistent with rest of product | Confirmed | Tabs are a Button group (976-980) not shadcn Tabs and not the prototype underline; the Paid 'checkbox' is a raw <input type=checkbox> with hardcoded accent-[#2ca01c] (1327-1333) instead of a shadcn Checkbox/token; adjustment/FX use bare Inputs with onBlur-commit. Other surfaces (Contacts 185-195) use the same Button-group pattern, so it is internally consistent but diverges from a proper DS Tabs/FilterBar/DataTable. |
| Define workflow: import register -> review people -> generate/confirm run -> post ledger -> view statements by period | Partial | Review->generate/confirm->post exists: startRun (253) generates, approveRun (379) posts the ledger expense entry, markRunPaid (594) settles. 'Import register' step is MISSING (no import). 'Statements by period' is MISSING (no period selector). So 3 of 5 steps exist; 2 are unbuilt. |
| KPI strip: payroll this period, next run, taxes/withholding, contractors vs employees, unmatched items | Partial | A StatCard strip exists (985-999) but only shows per-currency payroll totals + Headcount. 'Next run', 'taxes/withholding', 'contractors vs employees', 'unmatched items' are all absent and have no backing data (no tax/withholding or contractor fields in schema.ts:517-574). |
| Tabs (Runs, People, Statements, Contractors, Rules) | Partial | Only employees/runs/statement tabs exist (939, 976). 'Contractors' and 'Rules' tabs are absent; 'People' is named 'Employees'; 'Statements' is singular 'Statement'. |
| Period selector (month/quarter/custom/statement period) | Refuted | No period selector control exists anywhere in PayrollScreen. The header date is a static shell pill, and Run-payroll is hardcoded to period '2026-06' (ModuleScreens.tsx:956). |
| Shared table pattern | Refuted | Payroll re-implements its own shadcn Table inline 4 times (Employees:1029, Runs:1087, statement group:1372, PayrollStatement:1421). No shared OpenBooksDataTable/FilterBar exists in the repo (existingSharedPrimitives confirms only primitives.tsx is shared). |
| Clarify whether auto run-creation exists now or is future | Confirmed | Auto run-creation does NOT exist: crons.ts contains only 'sync Plaid transactions' (crons.ts:7); there is no scheduled startRun. Runs are created exclusively by the manual 'Run payroll · June' button (1081). This is future work, undocumented in the UI. |

**Design-system violations.**

- Raw HTML checkbox with hardcoded brand hex instead of shadcn Checkbox + token — _ModuleScreens.tsx:1327-1333 — <input type="checkbox" ... className="size-4 align-middle accent-[#2ca01c]" /> in PayrollRunLineRow. Bypasses the DS (no Checkbox primitive exists, per uiPrimitivesMissing) and hardcodes #2ca01c instead of --primary._
- Approval banner prints raw float money (localMinor/100) — violates 'tabular figures / minor units, never floats' and produces unformatted strings — _ModuleScreens.tsx:1194 — detail.currencyTotals.map((row) => `${row.currency} ${row.localMinor / 100}`).join(" + ") renders e.g. 'PKR 2140000' or 'USD 6000' with no thousands separators, no Geist Mono, no Amount component._
- Tabs implemented as a Button group, not shadcn Tabs and not the DS underline-active pattern — _ModuleScreens.tsx:976-980 — buttons with variant={tab===item?"default":"outline"}; prototype uses a green-underline tab bar (Payroll.dc.html:36-40). Inconsistent tab affordance._
- Status chips are generic capitalize outline Badges — they drop the prototype's semantic color coding (Paid=green, Approved=blue, Draft=gray) — _statusChip (ModuleScreens.tsx:94-96) returns <Badge variant="outline" className="capitalize"> for every status; prototype chipFor (Payroll.dc.html:329) color-codes by status. All payroll statuses now look identical._
- FX rate stored/edited as a plain string Input with no validation primitive; commit-on-blur with regex strip is bespoke not DS — _ModuleScreens.tsx:1311-1318 fxRate Input + commit() at 1278-1281 does Number(adjustment.replace(/[,$]/g,'')) — no shadcn Field/Form, no error surface beyond a shared string._
- Dead control: 'Add employee' button renders but does nothing (no onClick / no modal), unlike the prototype which opens an Add-employee modal — _ModuleScreens.tsx:1023-1026 — <Button>…Add employee</Button> with no handler; prototype wires openAddEmp -> modal (Payroll.dc.html:29, 208-258). A non-functional primary affordance._

**Responsive / layout issues.**

- Run-detail grid has 7 columns (Employee, Base, Adjustment, Final, FX rate, base equiv, Paid) wrapped in a single overflow-x-auto (ModuleScreens.tsx:1211-1238). On mobile this becomes a horizontally-scrolling desktop table — the editable adjustment Input (w-24) and FX Input (w-20) plus a checkbox force ~720px min width, so phones must scroll sideways to reach the Paid column. Violates 'mobile must be a real responsive surface, not a squeezed desktop table'.
- Employees, Runs, and global Statement tables are NOT wrapped in overflow-x-auto (1029, 1087, 1421) — on narrow viewports the right-aligned money columns (Local salary / Base) will squeeze or clip rather than scroll.
- The run-detail header is a single flex-wrap row holding back button + title + 2 status chips + Grid/Statement toggle + up to 3 action buttons (1159-1188). On tablet widths these wrap into a ragged multi-line cluster with the primary Approve/Mark-paid action losing prominence (ml-auto breaks once it wraps).
- The KPI StatCard strip is grid md:grid-cols-4 (985); with 3 currencies + headcount it is exactly 4, but any entity with >3 currencies overflows the 4-col grid into an unbalanced second row with no defined wrap behavior.
- Run-detail footer totals row concatenates currency totals inline with mr-3 spans (1240-1246); with 3+ currencies on mobile these wrap awkwardly against the 'Total in base' span which uses sm:flex-row only (1239).

**Additional issues caught by the adversarial verifier (missed on first pass).**

- Paid checkbox is non-interactive (readOnly): ModuleScreens.tsx:1330 hardcodes readOnly on the <input type=checkbox> with no onChange, so the run-detail grid offers NO per-line mark-paid control even though the prototype's checkbox is interactive with a togglePaid handler (Payroll.dc.html:151, 435) and the backend exposes a markLinePaid mutation (payroll.ts:548). The audit flagged the hardcoded hex but missed that the control is functionally dead — you can only 'Mark all paid' at the run level (1179), never an individual line.
- approveRun debit account is literally named 'Payroll & Contractors' yet no contractor concept exists: payroll.ts:396 looks up PAYROLL_EXPENSE_NUMBER and the comment/doc at payroll.ts:375-376 calls it 'Payroll & Contractors'. This contradicts the audit's 'no contractor concept exists' framing — the ledger account already merges them, which is itself the design problem (employees and contractors are commingled in one expense account with no way to split), a stronger finding than 'contractors tab missing'.
- Run-detail Statement view (PayrollRunStatement, ModuleScreens.tsx:1339) offers Print + CSV export but the GLOBAL PayrollStatement (1401) and the prototype both promise 'Export PDF' (Payroll.dc.html:167); neither current statement surface has a PDF export — only window.print() (1358, 1410) and CSV. The audit's statement gaps did not note the missing PDF affordance specifically.
- Currency/headcount tile ordering is non-deterministic vs base: the KPI strip renders one tile per currencyTotals entry sorted alphabetically (moduleViews.ts:438-440) then a Headcount tile, so the entity's own base currency is not pinned first — on a 4-col grid the base-currency payroll figure can land in any column, weakening at-a-glance reading. Not raised by the audit.
- statusChip semantic-color regression is product-wide, not Payroll-only: the same generic statusChip (ModuleScreens.tsx:94-96) is reused for invoices (443) and bills (750). The audit scoped the lost color coding to Payroll; it actually flattens status semantics across Income/Expenses/Bills too, raising its severity.
- Approve/Mark-paid actions have no confirmation step despite posting an immutable ledger entry: approveRun posts a balanced journal entry (payroll.ts:379-398) and the UI fires it directly from a single Button with only a busy guard (ModuleScreens.tsx:1174), no AlertDialog confirm — an alert-dialog.tsx primitive exists in the repo. For an irreversible posting (corrections require reverse-and-repost per the ledger rules) this is a notable UX/safety gap the audit did not surface.
- AppScreen routing line is mis-cited: the audit says PayrollScreen is 'routed at AppScreen.tsx:65' but the actual conditional render is AppScreen.tsx:64 (route.href === '/payroll' ? <PayrollScreen/>). Off-by-one; the ModuleScreens.tsx:1919 route citation is correct.

### 2.9 Reports

**Files:** `/Volumes/SSD/OpenBooks/apps/web/src/components/openbooks/ReportsScreen.tsx`, `/Volumes/SSD/OpenBooks/apps/web/src/components/openbooks/AppScreen.tsx`, `/Volumes/SSD/OpenBooks/apps/web/src/lib/openbooks/report-periods.ts`, `/Volumes/SSD/OpenBooks/apps/web/src/lib/openbooks/reports-export.ts`, `/Volumes/SSD/OpenBooks/convex/reportViews.ts`

**Adversarial verifier reliability:** high

**Current state.** ReportsScreen.tsx (1307 lines) is a home-grid then shared-viewer architecture. Home (ReportsHome:161) renders 5 groups (Overview/Statements/Money owed/Insights/Accountant) as 12 cards with tiny bar previews; clicking routes to /reports?report=<id> (openReport:1189). A report opens with a back button (1246), a ViewerToolbar (209) for non-Monthly-Review reports, and dispatches to one of 12 bodies via ActiveReport (1085). Data is one query: api.reportViews.reportPack (1187), entity-scoped, args {startDate,endDate,basis,compare,columnMode} (1176). All numbers are journalLines-derived: reportViews.reportAmountForLine = debit minus credit for asset/expense, else credit minus debit (reportViews.ts:245); reportPack reads ledgerAccounts/journalEntries/journalLines via take(REPORT_LIMIT=5000) (reportViews.ts:492-500). Toolbar gives Range preset Select + custom date Inputs, Compare, Columns, accrual/cash basis toggle, Explain (dispatches createAiRequestEvent to the docked AI panel, 1269), Export CSV (1271). Every money cell is a MoneyButton (430) that opens a DrillSheet (378) — a read-only in-page list of journal lines, default CLOSED (drill open:false, 1144). Period defaults never go future (report-periods.ts clamps every preset to today). Statements use shadcn Table; aging uses an amber heat fill (683-687).

**Prototype establishes.** Reports.dc.html (953 lines) establishes the same home then viewer model: a Reports title with subtitle 'all numbers come straight from the ledger' (line 27), then a prominent 'Close the books' banner at the top of home (lines 30-48) with a green Close button or a Locked pill, followed by 5 card groups (reportGroups:593-614) in a 3-col grid with mini bar viz. The shared viewer chrome (71-97) has a back-to-Reports link, an accrual/cash segmented toggle, an Explain pill that opens an inline green explain band (91-96), and an Export button. Twelve report bodies exist (Monthly Review, P&L by-month with click-to-drill cells, Balance Sheet + Balanced pill, Cash Flow with an opening-to-closing bridge chart, AR/AP Aging heatmap, Expenses category+vendor, Income by Customer share bars + concentration warning, Payroll Summary multi-currency, Trial Balance, General Ledger, Journal Entries). Drill is a right-side 400px fixed slide-over listing transactions with a total (479-506). A full 'Close May 2026' checklist flow with a justClosed success state exists (433-477). P&L net row is a green band; expense deltas use amber #b54708 for big jumps, green for decreases, gray otherwise — neutral by default.

**Feedback verification.**

| Reported issue | Status | Evidence |
|---|---|---|
| Reports dense | Confirmed | 12 report types, multi-column statement tables (P&L Account+6 months+Total), GL/Trial Balance/Journal all dense tabular surfaces; StatementTable min-w-56 account col + per-month MoneyButton cells (ReportsScreen.tsx:471-516). Density is intended and largely on-brand but compounds the squeeze problem. |
| Docked Ask AI panel currently causes layout breakage | Confirmed | Docked AI is w-[380px] shrink-0 flex sibling of the content column (AppShell.tsx:466-469); content = flex-1 of viewport minus 232px minus 380px. P&L/GL/Trial-Balance/Aging/Income/Payroll tables sit in overflow-x-auto (ReportsScreen.tsx:472,704,778,814,849,894), so opening AI forces inner horizontal scrollbars on the 7-col money grids. |
| Reports must stay ledger-backed and agree with workbench screens | Confirmed | reportPack derives every number from journalLines: reportAmountForLine = debit minus credit for asset/expense else credit minus debit (reportViews.ts:245), reading ledgerAccounts/journalEntries/journalLines (reportViews.ts:492-500). Same convention Income/Expenses lenses reuse, so they reconcile by construction. |
| Need stable period selection | Partial | Periods never go future and are deterministic (report-periods.ts clampRange:126, ref-guarded default 1147-1173). But every report switch hard-resets basis/compare/columns (ReportsScreen.tsx:1169-1172), and a period= param from the dashboard is silently ignored (only start/end read, 1135) — so selection is not fully sticky/portable. |
| Clicking a report line drills into filtered Transactions/Income/Expenses | Refuted | MoneyButton onDrill opens a local DrillSheet read-only list (ReportsScreen.tsx:430-456,378-426,1228-1230,1298), never router.push to /transactions\|/income\|/expenses (only navigation is /reports?report=, 1191). TransactionsScreen has no filter params beyond ?focus (CoreScreens.tsx:720). |
| Ask AI must not squeeze reports into unreadable layouts | Confirmed | Same structural cause as layout breakage: the 380px panel shares horizontal space with main (AppShell.tsx:463-469); reports have no narrow-column fallback (tables just overflow-x-auto), so the requirement is currently violated by construction. |

**Design-system violations.**

- Off-palette accent colors instead of chart tokens — _ReportsScreen.tsx:140 teal: bg-teal-600, :142 amber: bg-amber-500 in ACCENT_BG, used by home-card PreviewViz (151) and Cash Flow bridge bars (662). Should use chart-2 (teal)/chart-3 (amber) tokens._
- Raw amber Tailwind utilities for status chips instead of semantic warning token — _ReportsScreen.tsx:591 and :888 use bg-amber-100 text-amber-800 for Needs review / Off by N chips — off-token; DS warning is #b54708 via a semantic token._
- Unicode checkmark as status icon (DS bans unicode-as-icon) — _ReportsScreen.tsx:593 balanceSheet.balanced ? checkmark Balanced and :889 checkmark Balanced. Must use lucide Check/CircleCheck._
- Unicode arrow used as link/affordance glyph instead of lucide ArrowRight — _ReportsScreen.tsx:1002 arrow, and link labels at :1008,:1020,:1032,:1041 (Income by Customer arrow, Full Profit & Loss arrow, AR Aging arrow, AP Aging arrow). DS code rule mandates lucide ArrowRight._
- Cash-flow outflow bars use amber accent rather than the negative token used by the prototype — _ReportsScreen.tsx:619 negative group totals map to accent amber then bg-amber-500 (662); prototype outflow bridge bars use #d92d20 (Reports.dc.html:687-688)._

**Responsive / layout issues.**

- Docked AI panel squeeze: w-[380px] aside is a flex sibling of main (AppShell.tsx:466-469); with sidebar 232px + panel 380px, the P&L monthly grid (Account min-w-56 + 6 months + Total) overflows its overflow-x-auto wrapper (ReportsScreen.tsx:472-476) and shows an inner horizontal scrollbar at common laptop widths (~1280-1440px).
- Six report bodies wrap each table in overflow-x-auto (lines 472,704,778,814,849,894); on narrow viewports these become horizontally-scrollable desktop tables rather than reflowed/stacked cards — violates mobile must be a real responsive surface. GL/Trial Balance/Journal especially.
- ViewerToolbar is flex flex-wrap items-end gap-3 (line 247) with fixed-width controls (Select w-40/w-36/w-32, date Inputs w-40); on a squeezed content column (AI open) these wrap to 2-3 rows, pushing Explain/Export (pushed right by flex-1 spacer at 328) onto a new line.
- GL memo cell uses max-w-xs truncate (line 864) and aging cells have no min width; under squeeze, account/memo text truncates aggressively while money columns stay fixed.
- Monthly Review top band is flex flex-wrap (998) and wraps mid-sentence (You made X, spent Y arrow Z) on narrow widths; hero grid is md:grid-cols-2 (1007).

**Additional issues caught by the adversarial verifier (missed on first pass).**

- AGING HEAT CELLS use a raw amber rgba literal off-token: AgingReport.heat() returns `rgba(245, 158, 11, ...)` at ReportsScreen.tsx:686 (amber-500's RGB), applied as inline backgroundColor on AR/AP cells (721). The audit's design grep only caught Tailwind utility classes, so this inline-amber instance (and its divergence from any chart/warning token) was missed — same off-palette theme as the flagged bg-amber-500.
- JOURNAL ENTRIES is mis-grouped in the responsive claim. The audit says 'GL/Trial Balance/Journal especially' become horizontally-scrollable overflow-x tables, but JournalEntries does NOT use overflow-x-auto — it uses `grid grid-cols-[1fr_auto_auto]` (ReportsScreen.tsx:941) with fixed w-24 debit/credit columns. Under squeeze it compresses/wraps, it does not inner-scroll. Cash Flow also has no overflow-x-auto wrapper (flex rows + bar chart). So only 6 of the report bodies inner-scroll and Journal/Cash-Flow have a different (compression) failure mode the audit conflated.
- THIRD dashboard drill link missed: CoreScreens.tsx:172 emits `/reports?period=${dashboard.selectedMonth}` with NO `report=` param at all. This lands on the Reports HOME grid (selectedReport is null) carrying a dead period param — an even more broken drill than the two links the audit cited (231,243). Strengthens the period-consistency gap but was not enumerated.
- DRILL-SHEET monthly drill-down can leak/duplicate lines across columns: StatementTable filters drillDown by `line.date.startsWith(columnKeyToPrefix(column.key))` (ReportsScreen.tsx:502), and columnKeyToPrefix returns only the 4-digit YEAR for quarterly keys (522-524). So a quarterly column's drill shows the WHOLE YEAR's lines, not that quarter's — a correctness bug in the drill the audit did not test (it only asserted the sheet is read-only).
- PROTOTYPE close-the-books banner exposes a state the current app cannot reach on this surface: prototype home shows a green 'Close the books' CTA / 'Locked' pill (Reports.dc.html:39-47) gated on a checklist; the codebase's only lock affordance is a bare date Input in AccountingPanel.tsx:269-276 with no checklist, no readiness gating, and no Reports-home entry point. The audit flagged the missing banner but understated that even the underlying close FLOW (5-check readiness, reopen, confirmation screen at Reports.dc.html:440-476) has no equivalent anywhere — it is not merely 'moved to Settings'.

### 2.10 Settings

**Files:** `apps/web/src/components/openbooks/SettingsScreen.tsx`, `apps/web/src/lib/openbooks/settings-sections.ts`, `apps/web/src/app/settings/page.tsx`, `apps/web/src/app/settings/[section]/page.tsx`, `apps/web/src/components/openbooks/settings/BusinessesSection.tsx`, `apps/web/src/components/openbooks/settings/TaxSection.tsx`, `apps/web/src/components/openbooks/settings/ConnectionsSection.tsx`, `apps/web/src/components/openbooks/settings/AiSection.tsx`, `apps/web/src/components/openbooks/settings/CategoriesSection.tsx`, `apps/web/src/components/openbooks/settings/RulesSection.tsx`, `apps/web/src/components/openbooks/settings/NotificationsSection.tsx`, `apps/web/src/components/openbooks/settings/TeamSection.tsx`, `apps/web/src/components/openbooks/settings/DataSection.tsx`, `apps/web/src/components/openbooks/settings/AuditSection.tsx`, `apps/web/src/components/openbooks/PlaidConnectionPanel.tsx`, `apps/web/src/components/openbooks/StripeConnectionPanel.tsx`

**Adversarial verifier reliability:** high

**Current state.** Settings is a two-level layout: a 10-item left subnav (SettingsScreen.tsx:152-178) plus the active section body, deep-linked at /settings/[section] via router.push (line 70). Sections array is in settings-sections.ts. The 10 sections (businesses, tax, connections, ai, categories, rules, notifications, team, data, audit) each render a dedicated *Section.tsx. Access is gated to owner/admin with a lock card (SettingsScreen.tsx:88-108). Desktop uses `hidden gap-7 lg:flex lg:items-start` (line 151); mobile collapses to a section-list drill-in (lines 113-148). Each section body re-prints its own h2 + description (SectionBody, lines 199-215), duplicating the subnav label. Sections are mostly card stacks and list rows: Categories/Rules/Notifications/Team/Audit render hand-rolled divide-y rows inside `overflow-hidden rounded-[14px]` cards; Audit uses a fixed CSS grid `grid-cols-[120px_120px_1fr]` (AuditSection.tsx:77,86) with Search + actor Select + date filters (lines 56-74). Connections delegates to PlaidConnectionPanel (655 LOC) and StripeConnectionPanel (555 LOC) — both heavy multi-step debug consoles with Validate/Seed/Sync buttons, checklists, integration-gap notes, and a nested shadcn Table in a Stripe payout `<details>` (StripeConnectionPanel.tsx:236-273). AI section shows provider (disabled Select), masked key state, autonomy radio cards bound to providerStatus.thresholds, a spend estimate bar, plus Batch-runs and Categorization-eval history lists (AiSection.tsx:210-252).

**Prototype establishes.** The prototype (Settings.dc.html) establishes the canonical IA: a 190px left subnav (line 30) + flex-1 content (line 37), page title "Settings" / "Your workspace, your keys, your data" (lines 22-25), and exactly 10 sections in this order: Businesses, Tax & fiscal year, Connections, AI, Categories, Rules, Notifications, Team, Data, Audit log (lines 437-447). Active nav item is brand-green-tinted (#f1f8ee / #17540f, line 451-454). Content is a vertical stack of white 14px-radius cards with the hairline ring shadow. Connections is action-oriented and simple: per-bank cards with a Healthy/Sign-in-expired status pill and a single Reconnect button (lines 159-202), account toggles, "+ Connect a bank" / "Import CSV instead". AI is owner-legible: provider/key/chat-model/categorization-model selects, a "Connection healthy" green strip, three autonomy radio cards, and a single "AI spend this month" meter — NO batch-run or eval-debug tables. Audit log is a 3-column grid (120px/130px/1fr: When / Who-what / Action) with colored actor pills (lines 402-411). Rules are draggable top-down rows with an AI-suggestion banner. Categories group rows with an Accountant-mode toggle revealing account numbers. The prototype subnav is NOT sticky (it sits in a normal flex row), so true stickiness is an intended improvement, not a regression from prototype.

**Feedback verification.**

| Reported issue | Status | Evidence |
|---|---|---|
| Settings nav should stay FIXED while content scrolls (currently not sticky) | Confirmed | SettingsScreen.tsx:151 `<div className="hidden gap-7 lg:flex lg:items-start">` and :152-156 the `<nav data-testid="settings-subnav" className="flex w-[190px] min-w-[190px] flex-col gap-px">` — no `sticky`/`top-` anywhere; AppShell.tsx:463 `<main className="mx-auto w-full max-w-[1200px] px-4 py-5">` is the document-scroll container with no height/overflow, so the nav scrolls off. |
| Connections (Plaid, Stripe, imports, AI config) should be simpler/action-oriented | Confirmed | ConnectionsSection.tsx:93/96 mounts PlaidConnectionPanel (655 LOC) + StripeConnectionPanel (555 LOC). PlaidConnectionPanel.tsx:389-465 exposes Prepare Link / Open Plaid Link / Use sandbox bypass / Simulate relink; StripeConnectionPanel.tsx:367-394 Validate/Seed/Sync + :543-551 'Integration notes for the main thread'. None of this maps to the prototype's single 'Reconnect'/'+ Connect a bank' action model (Settings.dc.html:185,189). |
| Some detail tables OVERFLOW horizontally / tables must not overflow their cards | Confirmed | StripeConnectionPanel.tsx:236 `<div className="mt-3 overflow-x-auto rounded-md border">` wrapping a 5-col `<Table>` — horizontal scroll rather than reflow. AuditSection.tsx:77/86 fixed `grid-cols-[120px_120px_1fr]` crowds when the content column narrows under the open AI panel (AppShell.tsx:466-479). |
| Sectioned content: Workspace, Connections, Imports, AI, Rules, Team, Billing, Data/export | Partial | settings-sections.ts:7-16 has Businesses, Tax, Connections, AI, Categories, Rules, Notifications, Team, Data, Audit. 'Imports' is folded INTO Connections (ConnectionsSection.tsx:98-116), not a top-level section. There is NO 'Billing' section — AI spend is shown inside AI (AiSection.tsx:194-208) but no subscription/billing surface exists. 'Workspace' maps to Businesses+Tax. |
| AI settings should be understandable, not provider-debug heavy | Confirmed | AiSection.tsx:210-252 renders 'Batch runs' and 'Categorization eval' tables (accuracy %, correctCount/evaluatedCount, providerMode) — verification-harness telemetry, not owner config. Provider Select is disabled and pinned to Bedrock (lines 99-110). |
| Useful connection/AI surfaces but lacks layout polish | Confirmed | Functionality is real (Plaid/Stripe wiring, autonomy thresholds, audit filters) but presentation is dev-console grade: PlaidConnectionPanel StepRow diagnostics (PlaidConnectionPanel.tsx:155-182), Stripe checklist grid `xl:grid-cols-5` (StripeConnectionPanel.tsx:439), and redundant h2 headings (SettingsScreen.tsx:210-215). |

**Design-system violations.**

- Off-brand purple/magenta in a generic avatar palette — _BusinessesSection.tsx:45 `["#fce7f6", "#a4148c"]` in avatarColor() used as business-initials swatch (line 81-93). #a4148c is a magenta/purple outside the one-green + chart-token rule._
- Pervasive hardcoded hex instead of semantic tokens — _Brand greens hardcoded as `bg-[#f1f8ee] text-[#17540f]` / `text-[#1d6b12]` (RulesSection.tsx:87-88,145; AuditSection.tsx:21; AiSection.tsx:134) and label gray `text-[#525252]` repeated ~12× (e.g. TaxSection.tsx:112,125,131; AiSection.tsx:98,113); info blue `text-[#175cd3]`/`bg-[#eff8ff]` (AuditSection.tsx:23; BusinessesSection.tsx:43) and warning `text-[#b54708]` (TeamSection.tsx:57) bypass --primary/--muted-foreground/--info/--warning tokens._
- Danger-zone red built from arbitrary hex, not --negative tokens — _DataSection.tsx:75-81 uses inline `boxShadow: '0 0 0 1px rgba(217,45,32,0.25)'` + `text-[#b42318]` + `border-[#f1c2bd]` + `hover:bg-[#fef3f2]` instead of --negative (#d92d20) / --negative-surface._
- Hand-rolled toggle pills instead of shadcn Switch — _Raw `<button className="relative h-[19px] w-[34px] ... rounded-full">` with a sliding `<span>` in NotificationsSection.tsx:79-88, RulesSection.tsx:148-156, CategoriesSection.tsx:84-92 — DS says use shadcn primitives; Switch is not even imported._
- Raw checkbox controls — _`<input type="checkbox" ... className="size-4 accent-[#2ca01c]">` in RulesSection.tsx:335 and PlaidConnectionPanel.tsx:500-505 — uses accent-color hack instead of a Checkbox primitive (checkbox is in uiPrimitivesMissing)._
- Third-party brand colors used as generic chrome (acceptable only on the vendor's own badge) — _Plaid Mercury/Chase brand fills `#3b2fa3`/`#0a4386` and Stripe `#635bff` appear in the prototype (Settings.dc.html:162,180,195); current code instead lacks per-bank brand badges entirely — but the AuditSection actor colors (#175cd3 user/blue) are generic non-token blues._

**Responsive / layout issues.**

- Subnav is not sticky: on long sections (Rules with N rows, Audit with up to ~8+ rows, Categories with ~16 rows) the 190px nav scrolls off-screen because the document scrolls (AppShell.tsx:463 main has no height/overflow), forcing a scroll-to-top to switch sections.
- Open AI panel squeezes the Settings content column: AppShell.tsx:418 main-column is flex-1 and AppShell.tsx:469 the AI aside is a 380px shrink-0 sibling. At ~1280px viewport with 232px sidebar + 380px AI panel, the content area is ~430px after the 190px subnav + 28px gap (gap-7) — Audit's fixed `grid-cols-[120px_120px_1fr]` (AuditSection.tsx:77,86) leaves the Action column ~150px and crowds; Rule rows (RulesSection.tsx:111-175) pack 9 inline controls with no wrap and overlap.
- Stripe payout child table scrolls horizontally rather than reflowing: StripeConnectionPanel.tsx:236 `overflow-x-auto` around a 5-col Table inside a Settings card — overflow within the card on narrow widths.
- Stripe checklist grid `md:grid-cols-2 xl:grid-cols-5` (StripeConnectionPanel.tsx:439) and the seed ResultBlock `sm:grid-cols-2 lg:grid-cols-4` (line 175) are tuned for full-width; inside the narrowed Settings content column they wrap into cramped 1-2 col stacks.
- Audit filter bar `flex flex-wrap` with a 220px-min search + w-36 Select + w-40 date input (AuditSection.tsx:56-73) wraps to 2-3 rows in the narrow column, pushing the table down.
- Mobile uses a separate drill-in list (SettingsScreen.tsx:113-148) which is good, but the heavy Plaid/Stripe panels (655/555 LOC of multi-button consoles) were never simplified for the ~380px mobile surface and will be a wall of stacked buttons.

**Additional issues caught by the adversarial verifier (missed on first pass).**

- The audit's 'hardcoded hex' and 'danger-zone red' and 'toggle pills' violations all OMIT the decisive mitigating fact that the current code reproduces the prototype's exact hex/markup: the prototype uses #525252 (20×), #b42318 + rgba(217,45,32,0.25) danger zone (Settings.dc.html:392-395), and hand-rolled toggle pills (Settings.dc.html:133,150,173,279,324,350). These are real DS-token critiques but NOT regressions/deviations the code introduced — the audit consistently frames faithful reproductions as if the code invented them, inflating their severity.
- The audit MISCOUNTS text-[#525252]: it claims '~12×' but the actual count across settings is 16 (AiSection 4, TaxSection 7, TeamSection 2, plus Notifications/Categories/Audit 1 each). This is an undercount, so it understates rather than overstates — still an inaccuracy in a finding it cites as evidence.
- The 'Sectioned content' target (Workspace/Imports/Billing) is fabricated and not grounded in the prototype: settings-sections.ts:7-16 is byte-identical to the prototype's section array (Settings.dc.html:438-447). The audit should have flagged that the current IA MATCHES the prototype exactly, and that 'add a Billing section' is net-new product scope, not a fidelity gap.
- MISSED real issue: TeamSection.tsx:43 hardcodes the owner avatar as `["#17540f", "#ffffff"]` and :29 invents a warning swatch `["#fffaeb", "#b54708"]` and a grey `["#f0f0f0", "#525252"]` — another off-token avatar palette in the same class as the BusinessesSection magenta finding, but the audit only flagged BusinessesSection.
- MISSED real issue: AiSection.tsx:87-89 computes the AI-spend bar from a hardcoded indicative price table (`categorizedThisMonth * 0.0008 + runs * 0.02`, budget `Math.max(9, estimatedSpend*1.8)`). This is a fabricated/estimated number presented as 'AI spend this month' with a progress bar — arguably misleading owner-facing data the audit's 'understandable, not debug-heavy' critique should have caught as a correctness concern, not just a styling one.
- MISSED real issue: CategoriesSection has NO filter/search for a full chart of accounts (~30+ rows render flat at CategoriesSection.tsx:104) and RulesSection has no status filter — the audit lists this under a low-severity 'filters' gap in its own JSON but does not surface it among responsiveIssues even though a long unfiltered Categories list is exactly what makes the non-sticky subnav painful.
- MISSED minor correctness smell: SettingsScreen.tsx:66 names a boolean `onMobileDrill` from a function literally named `parts(pathname)` (defined :194), and a top-level re-export shadows the same name — confusing but functional; worth a readability flag.

### 2.11 Ask AI

**Files:** `apps/web/src/components/openbooks/OpenBooksAIChat.tsx`, `apps/web/src/components/openbooks/AskAIScreen.tsx`, `apps/web/src/app/ask-ai/page.tsx`, `apps/web/src/components/openbooks/AppShell.tsx`, `apps/web/src/lib/openbooks/ai.ts`

**Adversarial verifier reliability:** high

**Current state.** One 918-line custom component `OpenBooksAIChat` renders both the docked drawer (mode='drawer', AppShell.tsx:471 desktop / :499 mobile) and the full page (mode='page', AskAIScreen.tsx:49). It hand-rolls every UI part: message bubbles (MessageBubble:421), a bespoke markdown parser (MarkdownBlocks:199, InlineMarkdown:171 — no markdown lib), tool-call cards via native `<details>` (ToolPartCard:325), proposal/confirmation cards (ProposalCard:344), a left thread rail (ThreadRail:476, page-only), a header `<select>` thread switcher (:762), suggestion chips (:822, :871), and a composer (:886). Streaming/persistence is real and connects to the Convex Agent component, NOT Vercel AI SDK: useUIMessages(api.aiThreads.listThreadMessages,…,{stream:true}) (:570), useSmoothText(charsPerSec:220) (:317), optimisticallySendMessage on api.aiThreads.sendMessage (:560-562). Threads via api.aiThreads.createThread/deleteThread/listMine; proposals via api.proposals.listProposals/confirmProposal/dismissProposal. A provider/debug badge "Bedrock active" vs "Degraded mode" is user-facing in the chat header (:758), the page header (AskAIScreen.tsx:45), and Settings (ModuleScreens.tsx:1568). The shell opens it via the "Ask AI" header button (AppShell.tsx:447, ⌘J) and a cross-surface CustomEvent OPENBOOKS_AI_EVENT (:229). Docked panel is fixed w-[380px] desktop (AppShell.tsx:469) + h-[88dvh] mobile bottom-sheet (:495). No AI Elements / ai-sdk packages are in apps/web/package.json.

**Prototype establishes.** The prototype Ask AI is a 380px right panel (OpenBooks.dc.html:195, width:380px;min-width:380px) opened by a header "Ask AI" pill (line 151, ⌘J) and toggled with aiOpen (line 311, default true). Header: green Sparkles icon + "Ask AI" title + a pill "Viewing: {screenTitle}" (line 201) + a single close X (line 203) — NO provider/debug badge, NO thread `<select>`, NO maximize, NO new-chat icon. Messages: user bubbles right-aligned grey (#f5f5f5, line 212), assistant rows are a 22px green-tint avatar + flowing text (line 214-240), NOT a bordered card. A flagship answer renders three inline metric tiles (Income/Expenses/Net profit, line 220-236) with a "Open Profit & Loss →" deep-link (line 238). An inline "PROPOSED RULE" confirmation card with Create rule / Not now (line 250-258) collapses to a green confirmed state on action (line 260-265). Footer: 3 rounded-full suggestion chips (line 289) + input + green send button (line 294-297). It is a SINGLE docked panel — there is no full-page mode, no thread rail, no artifacts column. Streaming is faked with setTimeout (line 355). Expenses delta uses neutral #525252 (line 229); only Net-profit drop uses red #d92d20 (line 234).

**Feedback verification.**

| Reported issue | Status | Evidence |
|---|---|---|
| Custom UI, NOT AI Elements. | Confirmed | OpenBooksAIChat.tsx hand-rolls MessageBubble:421, MarkdownBlocks:199, ToolPartCard:325, ProposalCard:344, ThreadRail:476; apps/web/package.json has no 'ai'/'@ai-sdk/*'/'ai-elements'/'streamdown' deps. |
| Exposes provider/debug labels like 'Bedrock active' to users. | Confirmed | OpenBooksAIChat.tsx:758 `{aiStatus.mode === 'active' ? 'Bedrock active' : 'Degraded mode'}` in a Badge; same string AskAIScreen.tsx:45 and ModuleScreens.tsx:1568; ai.ts:143 label 'Bedrock provider is configured'. |
| Panel fixed + narrow -> header/content overflow; in reports/dense pages chat breaks layout. | Partial | Panel is fixed w-[380px] (AppShell.tsx:469) and the header crowds 8 controls incl. a 170px native <select> (OpenBooksAIChat.tsx:750-797) confirming overflow pressure. But the panel is a sticky shrink-0 aside in the flex row (AppShell.tsx:466-480) and main is min-w-0 flex-1 (:418), so it reflows content rather than visually clipping the page — 'breaks layout' is mitigated; the squeeze of the 1200px content area to ~820px on reports is real. |
| Thread selection + new chat not modern. | Confirmed | Drawer uses a raw native <select> (OpenBooksAIChat.tsx:762, hand-classed, not shadcn Select) plus a separate page-only ThreadRail (:476); inconsistent, non-command-driven switching. |
| Want AI Elements (Conversation, Message, PromptInput, Suggestion, Sources, Tool, optional Reasoning/Actions/Attachments). | Confirmed | None of these primitives exist; closest analogues are bespoke (MessageBubble, ProposalCard, suggestion <Button> chips at :822/:871, ToolPartCard <details>). No Sources/Reasoning/Attachments equivalents at all. |
| Compact icon access from shell; collapsed / docked side panel / expanded workspace / mobile drawer modes. | Partial | Docked panel (AppShell.tsx:469) and mobile drawer (:495) exist. But NO collapsed-icon mode and NO expanded-workspace width — panel is hardcoded 380px. CollapsedRail (AppShell.tsx:717-820) has no Ask AI trigger; the only entry point is the header button (:447). |
| Preserve streaming. | Confirmed | useUIMessages(..., {initialNumItems:40, stream:true}) (OpenBooksAIChat.tsx:570) + useSmoothText(text,{startStreaming:streaming,charsPerSec:220}) (:317); message.status 'streaming'/'pending' drives the loader (:436,:452). |
| Context-aware by page+filter state. | Partial | Page awareness via currentRouteLabel (AppShell.tsx:256) shown as 'Viewing: {contextLabel}' (:755), and a year-fixed reportPack (AppShell.tsx:135-137). Filter-state awareness only from Reports (ReportsScreen.tsx:1269); no Income/Expenses/Transactions filter wiring. |
| Confirm how it connects to the existing Convex agent + streaming hooks. | Confirmed | Connects to @convex-dev/agent/react (import OpenBooksAIChat.tsx:3-8), api.aiThreads.* mutations/queries (:558-578), api.proposals.* (:563-578); the AI stack (@convex-dev/agent ^0.6.3, @ai-sdk/amazon-bedrock, ai ^6) lives in ROOT package.json:38-42, not apps/web. |

**Design-system violations.**

- User-facing vendor/provider label — quiet-AI and plain-English rules say users see capability, not 'Bedrock'. — _OpenBooksAIChat.tsx:758 Badge text 'Bedrock active' / 'Degraded mode' (also AskAIScreen.tsx:45, ModuleScreens.tsx:1568)._
- Off-token brand-green hardcoded hexes instead of --primary / --ob-green tokens (thread-active state + inline link chip). — _OpenBooksAIChat.tsx:508 'border-[#bbe0a9] bg-[#f1f8ee]' active thread; :185 'border-[#bbe0a9] bg-[#f1f8ee] ... text-[#1d6b12] hover:bg-[#dcefd2]' inline link chip; AppShell.tsx:450-451 Ask-AI button '#bbe0a9/#f1f8ee/#dcefd2/#92cc7a'._
- Raw native <select> with hand-rolled classes instead of the shadcn Select primitive (DS: build on shadcn before raw controls). — _OpenBooksAIChat.tsx:762-774 `<select aria-label='Conversation' className='... rounded-[7px] border ...'>` with <option> children._
- Tool/proposal disclosure built on native <details>/<summary> instead of a shadcn Collapsible/Accordion or AI Elements Tool primitive. — _OpenBooksAIChat.tsx:331 `<details ...><summary ...>` in ToolPartCard._
- Money figures inside AI tables not consistently using money-figures/tabular-nums for the header or first column, and right-alignment is index-based not semantic. — _OpenBooksAIChat.tsx:238 only `cellIndex > 0 && 'money-figures text-right'` — assumes every non-first column is money; a left-most money column or a label-bearing 2nd column renders wrong._
- Bespoke markdown renderer reimplements tables/lists/links by regex (maintenance + XSS/format risk) rather than a vetted renderer (e.g. streamdown used by AI Elements Response). — _OpenBooksAIChat.tsx:171-314 InlineMarkdown/MarkdownBlocks regex parser; isSeparatorLine:154, parseTableRow:162._

**Responsive / layout issues.**

- Drawer header (OpenBooksAIChat.tsx:750-797) at the fixed 380px width must hold Sparkles + 'Ask AI' + truncated 'Viewing:{label}' + provider Badge + a max-w-[170px] native <select> + new-chat icon + maximize icon + close icon; the right-hand controls are .sm:block/.sm:inline-flex gated, so on the mobile bottom-sheet the thread <select>, new-chat and maximize buttons disappear entirely — thread switching is unavailable on mobile.
- Footer suggestion chips use 'flex gap-2 overflow-x-auto' (OpenBooksAIChat.tsx:871) — 5 long prompts (e.g. 'How much did Stripe take in fees this year?') force a horizontal scrollbar inside the 380px panel rather than wrapping; the prototype wraps them (flex-wrap, line 288).
- Page mode forces a 3-column layout (236px ThreadRail + chat + 280px artifacts aside, OpenBooksAIChat.tsx:490/:908) inside the shell's max-w-[1200px] main (AppShell.tsx:463); with the docked AI panel logically closed on /ask-ai this fits, but the artifacts aside is xl:block only and the rail is lg:flex only, so at md the page silently loses both side columns leaving just the chat — inconsistent IA across breakpoints.
- Desktop docked panel is a sticky shrink-0 380px aside in the same flex row as main (AppShell.tsx:466-480); opening it on a dense Reports/Transactions page compresses the 1200px content column to ~820px, reflowing wide tables — no min-content guard or resizable handle, and no option to overlay instead of push.
- Mobile bottom-sheet is h-[88dvh] (AppShell.tsx:495) with body-scroll lock (AppShell.tsx:233-246) but the chat's own internal sticky composer + scroll list live inside it; combined with the lost header controls this is a squeezed desktop panel, not a purpose-built mobile drawer.
- Assistant inline tables (MarkdownBlocks:221 'overflow-hidden') can clip wide money tables at 380px with no horizontal scroll affordance, truncating columns.

**Additional issues caught by the adversarial verifier (missed on first pass).**

- PROVIDER LEAK IS WORSE THAN AUDITED: ai.ts:143 'Bedrock provider is configured' is rendered to users, not just an internal helper. OpenBooksAIChat.tsx:804 renders `activeThread?.title ?? aiStatus.label` — when no thread is active, the user sees the literal vendor string 'Bedrock provider is configured' in the status card. The audit classified ai.ts:143 as a non-UI 'helper label'; it is in fact a 4th user-facing leak site.
- STATUS-CARD COPY ALSO LEAKS IMPLEMENTATION: OpenBooksAIChat.tsx:807 user-facing text says 'Answers stream from the Convex Agent...' — naming the backend framework ('Convex Agent') to the owner, another quiet-AI / plain-English violation the audit did not flag.
- DESKTOP DOCKED PANEL IS lg:flex ONLY: AppShell.tsx:469 aside is 'hidden ... lg:flex', so on tablet (768-1023px) there is NO docked desktop panel — only the bottom-sheet (lg:hidden, :495) is available. The audit frames desktop docked vs mobile sheet as a clean split but never notes the tablet band has only the bottom-sheet, even in landscape on a wide tablet.
- WET DUPLICATION OF THE SUGGESTIONS LIST: SUGGESTIONS is hardcoded in OpenBooksAIChat.tsx:33-39 AND independently in ai.ts:121-127 (aiSuggestedPrompts) with identical strings. Two sources of truth for the flagship prompts; the chat ignores the lib export and ships its own copy.
- PENDING-PROMPT PARSING IS FRAGILE: OpenBooksAIChat.tsx:644 does `pendingPrompt.split('::')[0]` to strip the Date.now() nonce appended in AppShell.tsx:226. Any user/report prompt containing '::' (e.g. a time range or ratio) would be silently truncated before being sent. Edge-case correctness bug the audit's responsive/design lens missed.
- NO ERROR SURFACE FOR DEGRADED STREAMING vs ai.ts ANSWER ENGINE DIVERGENCE: ai.ts:235 answerOpenBooksQuestion is a full deterministic local Q&A engine (tables, proposals, AR aging, payroll) that is NOT wired into OpenBooksAIChat at all — the chat only talks to the Convex agent (api.aiThreads.sendMessage). So in degraded mode the chat cannot fall back to this local engine; the status copy at :808 admits 'AI is not configured... will show the missing-provider state instead of fake answers,' meaning the rich local answerer is dead code from the chat's perspective. The audit treated ai.ts as part of the surface but missed that its answer engine is orphaned relative to the chat.
- ARTIFACTS ASIDE AND THREADRAIL ARE PAGE-MODE-ONLY DEAD WEIGHT ON MOBILE PAGE: at /ask-ai on a phone, AskAIScreen forces mode='page' (AskAIScreen.tsx:54) but ThreadRail (lg:flex) and artifacts aside (xl:block) are both hidden, leaving only the chat column AND no thread switcher (the drawer-header select is sm-gated but page mode still uses the same header) — so the dedicated full-page Ask AI route has no thread switching on a phone either, compounding the mobile thread-switch gap beyond just the bottom-sheet.
- TABLE HEADER NOT TABULAR/RIGHT-ALIGNED: beyond the body-cell index bug the audit caught, the <th> cells (OpenBooksAIChat.tsx:226) are always 'text-left font-medium' with no money-figures, so even a correct money column has a left-aligned, proportional-figure header over right-aligned tabular body cells — a money-table alignment defect the audit's cellIndex note did not cover.

### 2.12 Shell, Header & Navigation

**Files:** `apps/web/src/components/openbooks/AppShell.tsx`, `apps/web/src/components/openbooks/CommandPalette.tsx`, `apps/web/src/components/openbooks/AppScreen.tsx`, `apps/web/src/components/openbooks/primitives.tsx (PageHeader)`, `apps/web/src/components/openbooks/SettingsScreen.tsx (settings two-level layout)`, `apps/web/src/components/openbooks/OpenBooksAIChat.tsx (docked panel body + header)`, `apps/web/src/lib/openbooks/content.ts (appRoutes/mobileRoutes/settingsRoute)`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/[section]/page.tsx`, `apps/web/src/app/settings/[section]/page.tsx`

**Adversarial verifier reliability:** medium

**Current state.** AppShell.tsx (1040 lines) renders AuthenticatedAppShell: a fixed left `aside` (AppShell.tsx:376) swapping ExpandedSidebar (232px, line 580) vs CollapsedRail (56px, line 717); collapse persisted in localStorage `ob:sidebar-collapsed` (line 45,160). Sidebar holds logo+workspace name, EntitySwitcher dropdown (line 646/822), nav from `appRoutes` (content.ts:27) with InboxBadge (line 549), a divider, then Settings link, and a footer with SyncRow + ProfileMenu (line 701). Header is `sticky top-0 z-30 h-14` (line 419) containing: mobile menu button (lg-only), a global search trigger button opening the command palette (line 430, hidden below `md`), a static "Jun 2026" month chip (line 444, hidden below `sm`), and an "Ask AI" pill with hardcoded green hexes (line 447). Docked AI: `aiOpen` toggles a `sticky top-0 h-screen w-[380px]` right aside on lg (line 466) as a flex sibling of the `max-w-[1200px]` main column (line 463), plus a separate mobile bottom-sheet aside `h-[88dvh] translate-y` (line 492). Mobile: off-canvas sidebar with scrim (line 367) + fixed 4-tab bottom nav (mobileRoutes + Ask AI, line 509). Every page renders a PageHeader (AppScreen.tsx:50) with eyebrow=entity name, title=route label, description=route summary, and a "Demo entity" chip (line 54). ⌘K palette, ⌘J AI (line 204).

**Prototype establishes.** The prototype (OpenBooks.dc.html) is a single-screen shell with a fixed 1320px min-width desktop layout (line 25), no responsive/mobile surface at all. Left sidebar 232px (#fafafa, line 29) with logo+"Ansar's workspace" subline, entity switcher, 9 nav items, a divider, Settings, then a footer with a "Sync now" row (line 93) and a static user block (line 97). Collapsed rail is 56px (line 110). Top bar h-56px (line 143) has a global search field (placeholder "Search transactions, contacts, reports…", ⌘K chip), a flex spacer, a static "Jun 2026" pill (line 150), and an "Ask AI" green pill with ⌘J (line 151). The right AI panel is 380px, open by default (aiOpen:true, line 313), with a header showing "Ask AI" + a "Viewing: {screenTitle}" chip (line 201), seeded demo conversation, suggested-prompt chips, and a composer. Screen content scrolls independently inside a single `overflow-y:auto` column (line 159). The shell itself carries NO per-page title/eyebrow/description — each imported screen renders its own heading. There is no "Demo entity" body chip and no provider/"Bedrock" label anywhere in the prototype. The month chip and Ask-AI pill are exactly as Ansar criticizes; the prototype is the source of the clutter he now wants removed.

**Feedback verification.**

| Reported issue | Status | Evidence |
|---|---|---|
| Header clutter: global search, month chip, Ask AI button, demo/workspace markers | Confirmed | AppShell.tsx:430-441 global search trigger; :444-446 "Jun 2026" chip; :447-459 Ask AI pill; AppScreen.tsx:54 "Demo entity" chip + :51 entity-name eyebrow in body. All four clutter sources present. |
| User does not want repeated workspace/page intro noise | Confirmed | AppScreen.tsx:50-55 renders PageHeader(eyebrow=activeEntity.name, description=route.summary) on EVERY non-settings screen; the entity name duplicates the sidebar EntitySwitcher (AppShell.tsx:843). |
| Some areas need fixed/sticky; others scroll independently | Partial | Header sticky (AppShell.tsx:419) and sidebar fixed (:376) exist, but there is no defined sticky/scroll contract for in-page panels — Settings subnav scrolls (SettingsScreen.tsx:151) and screens have no sticky toolbars. |
| Settings sidebar not fixed while content scrolls | Confirmed | SettingsScreen.tsx:152-178 renders the subnav as a static `w-[190px]` column with no sticky/position class inside `lg:flex lg:items-start`; it scrolls away with the page. |
| Docked AI side panel compresses content and overflows | Confirmed | AppShell.tsx:466-480 panel is a `w-[380px] shrink-0` flex sibling of the main column inside `flex min-h-screen` (:417); content is `mx-auto max-w-[1200px]` (:463), so the panel subtracts 380px of usable width rather than overlaying. |
| Want stable left nav | Confirmed | Left nav is already fixed/stable (AppShell.tsx:376-383 `fixed inset-y-0 left-0`); this is satisfied and should be preserved. |
| Settings moved to quieter footer/utility area | Refuted | Settings is a primary nav item below a divider in the main nav (AppShell.tsx:679-697 ExpandedSidebar, :787-804 CollapsedRail) plus inside ProfileMenu (:1024-1031); it is NOT in a quiet footer/utility zone. Currently it sits in the nav list, not a utility area. |
| Replace global header search with page-local search + command palette | Partial | The command palette exists and is good (CommandPalette.tsx), but the header still hosts a dedicated global search trigger (AppShell.tsx:430) and screens implement their own ad-hoc filters; there is no shared page-local search primitive. Half done. |
| Ask AI as icon/assistant control not permanent header pill | Refuted | Ask AI is a full text+icon+shortcut pill permanently in the header (AppShell.tsx:447-459), not an icon-only/floating assistant control. |
| Remove visible demo/entity labels from body (subtle env indicator only if needed) | Refuted | "Demo entity" chip (AppScreen.tsx:54), "Bedrock active/Degraded mode" labels (AskAIScreen.tsx:45, OpenBooksAIChat.tsx:758, ModuleScreens.tsx:1568) are all still visible in the body/headers — none replaced with a subtle env indicator. |
| Define sticky vs scroll panels | Refuted | No explicit sticky/scroll contract exists beyond the shell header/sidebar; in-page regions (settings subnav SettingsScreen.tsx:151, screen toolbars) are not codified as sticky. |
| Mobile true drawers + bottom/compact nav | Partial | Off-canvas sidebar drawer (AppShell.tsx:376-383 transform), bottom-sheet AI drawer (:492), and a 4-tab bottom nav (:509) exist, but the AI panel is a translate-Y sheet not a native drawer primitive (no shadcn Drawer/Sheet), and the bottom nav omits search and most surfaces (content.ts:94). |

**Design-system violations.**

- Hardcoded hex colors for the Ask AI affordance instead of semantic --primary/--ai tokens — _AppShell.tsx:450-451 `border-[#bbe0a9] bg-[#f1f8ee] text-[#1d6b12] hover:bg-[#dcefd2] hover:text-[#1d6b12]` and :458 `text-[#63b347]`; same #f1f8ee/#17540f hardcoded throughout nav active state (lines 668, 690, 773, 796)._
- Active nav/entity colors use raw hexes not tokens — bypasses the design-system green ramp — _AppShell.tsx:668 `bg-[#f1f8ee] font-semibold text-[#17540f]`, :843 EntitySwitcher chip `bg-[#dcefd2] text-[#17540f]`, :759 divider `bg-[#ececec]`, :773/:796 same. Should be --ob-green-50 / --ob-green-800 tokens._
- Provider/vendor wording ("Bedrock active"/"Degraded mode") surfaced as a user-facing badge — leaks infra naming and is decorative AI ornament the owner does not need — _OpenBooksAIChat.tsx:757-759 Badge; AskAIScreen.tsx:45 CategoryChip; ModuleScreens.tsx:1568 Badge._
- Raw HTML <select> in the docked AI header instead of a shadcn Select primitive — _OpenBooksAIChat.tsx:762-774 `<select aria-label="Conversation" className="...rounded-[7px] border bg-background...">` with hand-rolled option styling._
- "Demo entity" chip rendered in the page header on every demo screen — body-level demo marker the DS/Ansar wants removed — _AppScreen.tsx:54 `actions={activeEntity.isDemo ? <CategoryChip active label="Demo entity" /> : null}`._

**Responsive / layout issues.**

- Docked AI panel steals content width: on lg the 380px panel (AppShell.tsx:466) is a flex sibling of the centered max-w-[1200px] main column (:463); at ~1440px viewport, 232 sidebar + 380 panel leaves ~828px usable, collapsing wide Transactions/Reports tables instead of overlaying.
- Global search trigger vanishes below md (AppShell.tsx:434 `md:flex`) and the mobile bottom nav (:509) has no search entry, so phones and small tablets have NO way to reach ⌘K / search anything.
- Month chip hidden below sm (AppShell.tsx:444 `sm:flex`) — inconsistent: a 'global' period control that silently disappears on phones, confirming it is non-load-bearing clutter.
- Settings subnav not sticky (SettingsScreen.tsx:152-178): a 190px static column; on long sections it scrolls out of view, leaving no section switcher in the viewport while content scrolls.
- Mobile bottom nav covers only 3 of 9 surfaces + Ask AI (content.ts:94-96); Income/Expenses/Bills/Contacts/Payroll/Reports/Settings require opening the off-canvas drawer, and there is no 'More' tab — poor reachability on mobile.
- Mobile AI sheet locks body scroll via direct document.body.style mutation (AppShell.tsx:233-246) rather than a managed Drawer; fragile and bypasses a scroll-area primitive.

**Additional issues caught by the adversarial verifier (missed on first pass).**

- TOKEN SYSTEM DOES NOT EXIST — the audit's two headline design fixes are unactionable. There is no --ob-green-50/--ob-green-800 ramp and no --ai token anywhere (grep 'ob-green' over apps/web/src returns 0 hits; globals.css:55-90 defines only --primary:#2ca01c, --positive, --ring, chart tokens). The active-state green #f1f8ee/#17540f/#dcefd2 is an undefined tint with NO semantic token to migrate to, so 'use the token' has no target. A correct finding would be: the design system is missing a tint token for the active/AI-affordance green, and globals.css must define one BEFORE the hexes can be replaced.
- PROTOTYPE FIDELITY VS ANSAR'S WANTS CONFLATED — the audit frames header search, month chip, and Ask AI pill as defects ('refuted'/'partial'), but all three are reproduced exactly from the prototype header (OpenBooks.dc.html:144-154: search trigger, 'Jun 2026' chip, Ask AI pill with #1d6b12/#63b347). The current code is faithful to the spec it was built against. These are change-requests against the prototype, not implementation bugs — the report should label them as 'redesign asks' so an implementer doesn't 'fix' a faithful build and break prototype parity.
- HEADER LAYOUT DIVERGES FROM PROTOTYPE (two-spacer vs justify-between) — prototype header uses TWO flex spacers (proto:148 left-pin via flex:1 max-w-460 search, proto:149 '<div flex:1 min-width:8px>' second spacer) to right-pin the month chip + Ask AI. Current code (AppShell.tsx:419) uses justify-between with the search inside a flex-1 left group (:420) and the right cluster shrink-0 (:443). Functionally similar but the search no longer caps at 460px the same way on very wide viewports (it is max-w-[460px] :434 so capped, but the flex distribution differs). Minor, but the audit claims pixel-faithfulness implicitly and missed this structural difference.
- AI PANEL IS RENDERED TWICE (desktop + mobile), DOUBLE-MOUNTING OpenBooksAIChat — when aiOpen is true, both the desktop aside (AppShell.tsx:466-480) and the mobile aside (:492-507) mount a full <OpenBooksAIChat> with the same props (pendingPrompt, workspaceId, reportPack). Only CSS (lg:flex vs lg:hidden) hides one. This means two live Convex chat subscriptions, two thread queries, and any pendingPrompt fires into both instances simultaneously. The audit flagged the mobile sheet's scroll-lock but missed the double-mount cost/correctness risk.
- ENTITY-NAME DUPLICATION IS ACTUALLY TRIPLED, not doubled — the audit says the page-header eyebrow duplicates the sidebar EntitySwitcher. It is shown in at least THREE places per page: EntitySwitcher trigger (AppShell.tsx:846), the AI panel context label is the route label not entity (so not a dup), AND the PageHeader eyebrow (AppScreen.tsx:51 / AskAIScreen.tsx:42). Additionally activeEntityName falls back to reportPack?.entity.name (AppShell.tsx:255) so even non-entity contexts re-announce it. Worth noting the noise is broader than 'sidebar + header'.
- 'Jun 2026' MONTH CHIP IS A HARDCODED LITERAL, not just unwired — beyond being hidden below sm, the string is a static literal (AppShell.tsx:445) that will read 'Jun 2026' forever regardless of the real date (today is 2026-06-13 so it happens to be correct now, but it will be wrong on 2026-07-01). The audit called it 'not wired to any date/period state' but understated that it is a frozen string that goes stale, not merely cosmetic.
- COLLAPSED-RAIL WIDTH BREAKS THE AI-PANEL-STEAL MATH IN THE GAP SECTION — the responsiveIssues '232 sidebar + 380 panel' figure assumes the expanded sidebar, but the shell defaults/persists a collapsed rail of 56px (AppShell.tsx:359 lg:w-[56px], contentPad lg:pl-[56px] :360). When collapsed, usable width is ~1004px at 1440 — still under 1200 but materially different from the audit's 828px. The single number misrepresents the most common collapsed state.
- DESKTOP AI PANEL HAS NO SCRIM/OUTSIDE-CLICK CLOSE — the audit notes the mobile AI sheet has a scrim (AppShell.tsx:484-490 lg:hidden) but missed that the DESKTOP docked panel (:466-480) has NO scrim and no Escape-to-close; it can only be dismissed via ⌘J or the panel's own close button. Combined with the width-steal, a user who opens it on desktop has a less discoverable exit than on mobile.
- SETTINGS PAGE HEADER STILL HAS A HARDCODED ENTITY-FREE DESCRIPTION but reintroduces intro noise — AppScreen.tsx:42 renders PageHeader title='Settings' description='Your workspace, your keys, your data' AND SettingsScreen renders a SECOND header per section (SectionBody h2+p, SettingsScreen.tsx:210-215). So Settings shows a page title, a tagline, plus a section title and section description — the exact 'repeated intro noise' the audit flags for other screens, but the audit explicitly exempted Settings ('owns its own two-level header') without noting it has the same redundancy.
- MOBILE SETTINGS SUBNAV STICKY POINT IS MOOT — the audit's sticky critique targets the desktop subnav (SettingsScreen.tsx:152), but on mobile Settings uses a drill-in list (:113-148) with no persistent subnav at all, so the 'no section switcher in viewport' problem is desktop-only. Worth scoping the finding to lg+ so it isn't mis-applied to mobile.

---

## 3. Prototype vs Current Gap Matrix

Across all surfaces: **122 gaps** — 9 blocker, 52 high, 38 medium, 23 low. Gaps are grouped by surface; "Prototype / Target" is the prototype behavior or the better-than-prototype target, "Current" is what the code does today.

### 3.1 Dashboard

| Dimension | Prototype / Target | Current | Severity |
|---|---|---|---|
| hierarchy / cash hero | Cash position is the page hero: 36px Geist Mono total + sparkline + connected-account chips (logo, mask, balance, stale-sync warning) at the top (Dashboard.dc.html:110-135). | Cash is a small equal-weight StatCard with a tiny Sparkline among 4 metric cards (CoreScreens.tsx:158-168); bank accounts are buried in a mid-page 'Cash and credit' list (198-218) with no logos, no sync-status, no warning. | High |
| header / duplicate labels | One page title 'Dashboard' with entity+range as a quiet sub; no workspace label, no in-body 'Demo entity' badge, no second 'Operating snapshot' title. | PageHeader shows eyebrow=entity name + 'Demo entity' chip (AppScreen.tsx:51,54), THEN DashboardScreen repeats the entity name in an 'Operating snapshot' card with 'ledger-backed books' (CoreScreens.tsx:80-81). Three competing titles and a demo badge in the body. | High |
| date range control | Header-right range dropdown (This/Last month, 3mo, YTD) + custom dual-calendar range that never selects future dates (Dashboard.dc.html:28-79,695 future-guard). | A shadcn Select limited to month strings from cashFlowByMonth, placed inside the 'Operating snapshot' body card (CoreScreens.tsx:85-96). No presets, no custom range, not in the header. | High |
| spend breakdown viz | 'Where money went' donut + legend with 5 categories and total (Dashboard.dc.html:168-188). | A generic vertical BarChart of expensesByCategory using only first word of each label (CoreScreens.tsx:249); no donut, no legend, label truncated to item.name.split(' ')[0]. | Medium |
| A/R aging + overdue | A/R card shows total + 4-bucket aging bar + named overdue invoices with days-late (Dashboard.dc.html:219-240). | A/R is a bare amount + 'N overdue' count link (CoreScreens.tsx:289-293); no aging bar, no overdue names, even though AgingMiniBar primitive exists. | Medium |
| A/P next bills | A/P shows total + sub + next 3 bills with vendor/due/amount (Dashboard.dc.html:243-259). | A/P is a bare amount + 'N due soon' link (CoreScreens.tsx:294-298); no upcoming-bills list. | Medium |
| insight cards (cushion/health/coming-up) | Cash cushion months gauge, Books health automation%+close CTA, Coming-up next-30-days with net impact (Dashboard.dc.html:330-384). | None present. No cash cushion, no books-health/close-period, no forward-looking 'coming up'. Activity feed exists but with no typed icons (CoreScreens.tsx:268-280). | Medium |
| actionable card click target | Whole cards are clickable into the matching workbench with hover lift (onClick goReports/goInvoices/goBills/goPayroll, Dashboard.dc.html:168,219,243,262). | Only inner figures/links are clickable; card bodies aren't a single target. Income-by-customer links to /contacts not the income lens (CoreScreens.tsx:308). | Low |
| income-by-customer viz | Horizontal share bars per customer + concentration-risk warning when top customer >50% (Dashboard.dc.html:280-299). | Plain text list of name + amount (CoreScreens.tsx:306-313); no share bars, no concentration insight. | Low |
| connected-account sync health | Each account chip carries a stale-sync warning icon + tooltip ('Chase needs you to sign in again') (Dashboard.dc.html:129-131). | 'Cash and credit' rows show name/kind/mask/balance only (CoreScreens.tsx:206-216); no sync timestamp or reconnect affordance. | Low |

### 3.2 Inbox

| Dimension | Prototype / Target | Current | Severity |
|---|---|---|---|
| Grouping by work type | List grouped into 6 sections (Needs category / Receipts / Possible transfers / Payout issues / Connections / AI questions) with header + count (prototype line 438-457) | Flat ungrouped inbox.items.map() with no section headers (CoreScreens.tsx:516-563) | **Blocker** |
| Per-kind detail cards | 6 distinct detail layouts, each surfacing kind-specific evidence + ledger impact (prototype lines 94-324) | Only 2 branches: receipt vs generic-categorize. Transfer/payout/connection/question all render the categorize detail with a nonsensical Category dropdown (CoreScreens.tsx:648-668) | **Blocker** |
| Why-it-needs-attention / AI reason | Collapsible 'Why this suggestion' with reason + similar transactions list + 'Decided by' provenance (prototype lines 138-158) | A single muted box prints selected.reasoning as plain text, no provenance, no similar-txn evidence (CoreScreens.tsx:665-667) | High |
| Receipt-match overflow safety | 2-col receipt-vs-match with constrained mono receipt block (prototype lines 207-229) | 2-col md:grid-cols-2 with label/value rows; long fileName/vendor only truncates fileName (line 615); vendor (603) and candidate merchant (628) are NOT truncated and can wrap/overlap in the 360px-constrained right column | High |
| Mobile drawer | Feedback asks for a mobile drawer; shell already has an 88dvh bottom-sheet pattern (AppShell.tsx:495) | lg:grid-cols-[360px_1fr] simply stacks; on mobile the detail sits permanently below the full list with no drawer/Sheet and no back affordance (CoreScreens.tsx:503) | High |
| Confidence as evidence | Per-row ConfidenceRing + colored ring (green/amber/red by threshold) in BOTH list and detail (prototype lines 53-59, 435) | ConfidenceRing only in detail header (line 575), always stroke-primary green regardless of value (primitives.tsx:220) — 58% looks as confident as 96% | Medium |
| Split / create-rule affordances | Inline Split tool (two lines total to amount) + 'Always do this — create a rule' checkbox in the detail (prototype lines 160-179) | Split is absent from Inbox entirely; rule creation is a separate 'Always do this' button that posts immediately, not a pre-confirm checkbox (CoreScreens.tsx:699) | Medium |
| Batch / progress | Progress bar + 'N cleared this session' + '≥90% confident → Confirm all' smart batch banner (prototype lines 27-39) | Checkbox multi-select + generic 'Confirm selected' button; no progress bar, no confidence-aware batch suggestion (CoreScreens.tsx:505-515) | Medium |
| Plain-English ledger impact | Each card explains the ledger effect in owner language ('moves money between accounts without touching profit', 'books it under Payment Processing Fees') (prototype lines 255, 279) | Generic 'Confirming will post through the ledger' fallback string only (CoreScreens.tsx:666) | Medium |
| Inbox-zero state | Celebratory inbox-zero with checkmark + automation stat + 'View transactions' CTA (prototype lines 79-88) | Plain <EmptyState title='Inbox zero'> with no automation stat, no CTA (CoreScreens.tsx:499) | Low |

### 3.3 Transactions

| Dimension | Prototype / Target | Current | Severity |
|---|---|---|---|
| detail-panel default state | No panel until a row is clicked; row click opens a fixed 420px right Drawer with scrim + slide-in (proto 165-272). Full-width register by default. | Detail aside is permanently in the layout grid (xl:grid-cols-[1fr_380px], line 980) and `selected` is seeded to data.rows[0] (line 746), so the panel + empty Accounting/Receipt/Split stack shows with nothing selected; table is squeezed into ~1fr beside a 380px column. | **Blocker** |
| filters | Account pills + status tabs + AI-assisted search. Feedback wants multi-account select, date range, amount direction, type, category, contact, source, receipt, AI status, confidence, needs-attention. | Only 5 review-enum buttons (line 934) + one merchant/memo search (line 942). Server filters merchant+rawDescription only (coreViews.ts:419-423). No account, date, amount-direction, source, receipt, confidence, or needs-attention filter exists. | High |
| table columns | Date, Merchant(+raw+receipt+AI sparkle), Category, Contact, Account, Amount, inline Approve, comments, state dot. | Date, Merchant(+source/decidedBy text), Account, Category(inline Select), Status(raw enum chip), Amount (lines 985-991). NO contact column (field absent in row shape), NO receipt indicator, NO AI insight/sparkle, NO confidence, NO ledger/reconciliation state per row, NO inline approve. | High |
| AI affordance | Green lucide Sparkles popover per AI-decided row showing reason + decidedBy + confidence% inline in the register (proto 104-118). | No sparkle/reasoning in the table; merchant subline is bare text `{source} - {decidedBy}` (line 1016). `reasoning` is not even returned by the transactions query (coreViews.ts:464-503), though it exists on the doc. Confidence ring shows only inside the panel (line 1063). | High |
| export | Header Export button (proto line 31). Feedback wants an export menu: CSV / filtered / selected / audit. | No Export control anywhere in TransactionsScreen. | High |
| primary actions / header | Page header with title + subtitle and Import / Export / Add transaction buttons (proto 24-33). | No PageHeader, no title, no Import/Export/Add-transaction. Manual add and CSV import are buried as cards in the right aside (lines 1195, 1207). | High |
| add-receipt -> ask-AI -> review-before-post flow | Feedback explicitly wants attach-receipt + ask-AI-to-categorize + review-before-post. Proto shows receipt card + approve-&-post in drawer. | No receipt upload entry point on this surface (only a read-only receipt preview, line 1090). Recategorize quietly reverses+reposts via a single 'Other income' button (line 1125); no review-before-post confirmation step, no ask-AI-to-categorize trigger here. | High |
| responsive / mobile | Mobile must be a real responsive surface; drawer should overlay, table should reflow to cards/list. | Below xl the grid collapses to one column (line 980) so the 7-col Table sits with no horizontal scroll wrapper; the per-row min-w-44 Select forces overflow on narrow widths. No card/stacked mobile layout, no `<Sheet>`. | High |
| bulk actions | Bulk bar with Approve selected + Clear selection (proto 72-79). | Only 'Exclude selected' (line 946); no bulk approve/confirm, no bulk categorize, no clear-selection affordance, no contextual bulk bar (just a static row of buttons). | Medium |
| reconciliation tile | Per-selected-account tile: matched (green) vs reconnect (amber) with action (proto 48-62). | Always shows bankAccounts[0] reconciliation (line 779/959), not the filtered account; no reconnect action, just a Matched/Needs-review chip. | Medium |
| copy/text | Owner-friendly: 'To review · N', 'Approve', 'Posted automatically'. Subtitle 'Every account, one register'. | Raw enum labels via categoryLabel underscore-replace: 'needs review', 'auto', plus 'Recategorize'/'Add through pipeline'/'Import through the pipeline' developer phrasing (lines 836, 1203). Status chip shows the raw `review` value. | Low |

### 3.4 Income

| Dimension | Prototype / Target | Current | Severity |
|---|---|---|---|
| Income<->Transactions relationship (drill-through) | Payment rows must drill into the SAME record shown in Transactions/Reports (one record, richer view). Clicking a received payment should open that transaction's detail or deep-link to /transactions filtered to it. | Payments rows are inert: PaymentRow type carries no transactionId/entryId and the row has no onClick/href (IncomeScreen.tsx:160-174). incomeViews.ts:113 maps txn._id into `id` but it is never surfaced as a link. Income is a dead-end read view, not a lens that drills into the universal register. | **Blocker** |
| IA / revenue lens scope | Income should be a full revenue LENS over the same records: Payments, Invoices, Customers, Streams, Receivables tabs (Ansar). Customers = per-customer revenue + balance + history; Streams = revenue by income category/product; recurring vs one-time. | Only 3 tabs exist: payments/invoices/receivables (IncomeScreen.tsx:82). No Customers tab, no Streams tab, no recurring-revenue concept anywhere (grep for streams/MRR/recurringRevenue = NONE FOUND in IncomeScreen.tsx and incomeViews.ts). | High |
| Charts / analytics | Charts requested: revenue by stream, by customer, recurring vs one-time, AR aging trend (Ansar). Sparkline/BarChart primitives already exist (primitives.tsx:143). | Zero charts on the surface. No Sparkline/BarChart import or usage in IncomeScreen.tsx. Receivables shows a static heat matrix only. KPI cards show no trend sparkline even though StatCard supports a `trend` prop (primitives.tsx:69). | High |
| Shared filters (period / date range / customer) | Shared filters consistent with Transactions/Expenses/Bills: date range, customer multi-select, stream/category, status — applied across all Income tabs. | No date-range control at all; KPIs hardcode 'this month' against TODAY=2026-06-11 / MONTH_START=2026-06-01 constants (incomeViews.ts:8-9). Invoices tab has status pills only; Payments and Receivables have no filters. Inconsistent with Transactions (review filter + search, CoreScreens.tsx:933-944) and Expenses (period toggle, ExpensesScreen.tsx:52). | High |
| KPI strip parity | Ansar wants: received this period, open/overdue receivables, avg days to pay, recurring revenue (MRR). | Three of four match (received/open/overdue/avg-days, lines 103-122) but there is NO recurring-revenue (MRR) KPI, and 'Avg days to pay' is actually average net terms not real days-to-pay (incomeViews.ts:196-202 honestly notes seed has no payment date). KPIs are period-frozen to one demo month. | Medium |
| Detail panel pattern (Sheet vs inline) | Row-detail CLOSED by default, opening only on selection; consistent detail affordance across lenses. | Correct on Invoices (detailId null default, Sheet opens on click, line 60/140). But Payments rows have no detail at all and Receivables uses navigation (router.push to /contacts) instead of an in-surface detail — three different interaction models on one screen. | Medium |
| Dropped prototype affordance | Invoice detail has a 'Download PDF' action (Income.dc.html:242). | Code's InvoiceDetailDrawer omits Download PDF; only Finalize/Send reminder/Void/Close exist (IncomeScreen.tsx:657-668). Minor regression vs prototype. | Low |
| Copy / vendor wording | Owner-facing plain English; quiet AI; avoid raw vendor jargon where a plain term works. | Tab label 'Receivables' is accountant jargon (the design brief mandates 'money you're owed'); 'Payout · reconciled' status chip (line 30) is technical. These are acceptable but worth softening for the owner persona. | Low |

### 3.5 Expenses

| Dimension | Prototype / Target | Current | Severity |
|---|---|---|---|
| full expense table | A full tabular expense view (date, merchant, category, account, amount, evidence) matching Transactions/Income register | No transaction-level table. CategoryTable (ExpensesScreen.tsx:91-146) lists ~9 category aggregate rows only; expanding shows vendor totals (lines 127-132), never individual transactions. No date/merchant/status columns. | **Blocker** |
| hierarchy / views (tabs) | Tabs: Transactions, Categories, Vendors, Recurring, Evidence Needed (Ansar) | No tabs at all; single scroll of Category table + Recurring. ExpensesScreen.tsx:85-86 renders CategoryTable then RecurringSection unconditionally; tabs.tsx primitive exists but is unused here. | High |
| filters / date filtering | Shared filters (date range, account, vendor, category, evidence) like Income/Transactions | Only a 2-preset period toggle (this/last month) wired to a server enum (ExpensesScreen.tsx:33-37; expensesViews.ts:12-15). No search input, no date-range, no account/vendor/category filter, no custom range. Transactions has search+review pills (CoreScreens.tsx:933-943); Expenses has none. | High |
| KPI strip | Spent this period, recurring spend, uncategorized count, missing-evidence count, top vendor/category | Only 3 KPIs: Spent, Recurring spend, Biggest movement (ExpensesScreen.tsx:67-83). No uncategorized count, no missing-evidence count, no top vendor — and the backend (expensesViews.ts:266-274) does not compute these, so this needs backend work, not just UI. | High |
| vendors view | Dedicated Vendors tab (top vendors, spend per vendor, recurring flag) | Vendors appear only as nested sub-rows inside an expanded category (ExpensesScreen.tsx:127-132); no standalone vendor ranking/table. Backend computes vendorByAccount (expensesViews.ts:212-222) but only attaches top-6 per category, no global vendor list. | High |
| evidence-needed view | Evidence Needed tab (expenses missing a receipt/document) | Does not exist. No surfacing of missing receipts. Receipt/document linkage exists elsewhere (coreViews.ts:316-333 receiptDocument), but expensesViews returns no evidence flags. | High |
| category dot colors (design tokens) | Chart palette tokens --chart-1..5 (green/teal/amber/slate/red) only | Hardcoded 10-hex array DOTS with off-brand purple #635bff and #7a4a8c, blue #1d6bb5, browns/grays (ExpensesScreen.tsx:29), used at lines 109/116 as dot + share-bar fill. | High |
| charts | By category, by vendor, recurring trend, unusual spend | No chart components. Share is a per-row inline bar only (ExpensesScreen.tsx:115-117). primitives.BarChart/Sparkline exist but are not used here. No vendor chart, no recurring trend line, no unusual-spend visual. | Medium |
| detail panel default state | Row-detail CLOSED by default, opening only on selection (like Transactions drawer) | There is no row detail drawer; category rows expand inline (default closed, expanded state ExpensesScreen.tsx:92-100) but show only vendor totals, not a transaction detail. No equivalent of the Transactions side drawer (CoreScreens.tsx:1048-1060). | Medium |
| trend glyphs (icons) | lucide TrendingUp/TrendingDown icons | Unicode ▲/▼ used as functional trend glyphs (ExpensesScreen.tsx:26, 71, 80). DS bans unicode-as-icon. | Medium |
| shadcn primitives | shadcn Select for the Group dropdown | Raw HTML <select> with hand-rolled classes in Add Category modal (ExpensesScreen.tsx:215-217). | Low |
| copy / number consistency | Expense category totals must reconcile to P&L expense section (one set of numbers) | Backend already reconciles (expensesViews.ts:75-98 uses debit-credit like the report pack). UI is correct here, but lacks a 'view in Reports' / drill affordance to prove agreement. | Low |

### 3.6 Bills

| Dimension | Prototype / Target | Current | Severity |
|---|---|---|---|
| layout / IA framing | Ansar target: a true Accounts Payable workbench — actions row, KPI strip, one filterable/sortable table, row drawer. | Three stacked Cards (intro + upload + grouped lists) with a half-empty persistent side panel; no table, no workbench frame (ModuleScreens.tsx:584-799). | **Blocker** |
| table-first register | Single dense table with columns: vendor, bill #, due date, amount, status, category, evidence, payment match, source, AI confidence. | Div rows inside three separate group Cards; only vendor, due/status text, status badge, amount, mark-paid shown. shadcn Table is imported (:49-56) but NOT used here. | **Blocker** |
| row drawer (detail) | Row click opens a drawer: evidence preview, extracted fields, payment schedule, matched txn, ledger impact, approval/posting history. CLOSED by default. | No drawer. A persistent right-hand 'Selected bill' Card sits open showing only vendor + due/status + a button + boilerplate; renders 'No bill selected' when idle, wasting half the row (:770-798). | **Blocker** |
| filters / search / sort / export | Filter bar (status, vendor, due window, source, evidence-present), free-text search, sortable columns, CSV export. | None exist (grep of BillsScreen :473-810 finds no search/filter/sort/export). | High |
| KPI strip | Open total, overdue, due soon, paid this period, missing evidence, avg days to pay. | Only 3 KPIs: Open total, Due this week, Overdue (:602-606). Missing paid-this-period, missing-evidence count, avg days to pay (none computed in moduleViews.ts:499-510). | High |
| evidence + tracking cohesion | Evidence is a per-row column/affordance inside the AP table. | Evidence lives in a separate 'Receipt and bill upload' Card (:608-729) disconnected from the bill rows below; a receipt and a bill are not visibly linked to the payable. Ansar flagged 'visually scattered'. | High |
| copy / explanatory text | Quiet UI; at most a one-line subtitle. | Multiple long explainer paragraphs: ModuleIntro description (:588), 'true accrual books without the homework' (:794), 'Partial payments are out of scope' (:796), upload reason (:619). Ansar flagged this as 'unnecessary explanatory text'. | Medium |
| posting / status semantics | Status column = open/overdue/due-soon/paid + posting state (posted to AP vs needs post) + approval history. | postingAffordance ('posted_to_ap' / 'needs_ap_post') is computed (moduleViews.ts:343) and passed as BillRow.postingAffordance but only shown as a tiny status-label string in the row subtext (:748); no posting/approval surfacing. | Medium |
| responsive / mobile | Mobile must be a real responsive surface. | Group rows use md:grid-cols-[1fr_auto_auto_auto] (:743) and the page uses xl:grid-cols-[1.1fr_0.9fr] (:731); below md the 'Selected bill' panel stacks under the lists adding scroll, and the upload override grid sm:grid-cols-2 (:622) squeezes. No mobile-specific bill layout. | Medium |
| recurring detection | Prototype shows an AI 'recurring but untracked' suggestion panel with Track it/Not a bill. | Not implemented in code at all (no recurring/suggest logic in moduleViews.ts or BillsScreen). This is a prototype-only feature; flag as out-of-scope-but-missing, not a regression. | Low |

### 3.7 Contacts

| Dimension | Prototype / Target | Current | Severity |
|---|---|---|---|
| detail-panel default state | Profile is a separate full-screen mode entered only on row click; directory is full-width by default | Profile Card is permanently rendered beside the directory and pre-populated with contactRows[0] via selectedProfile default (moduleViews.ts:263), so the directory is squeezed into 1.2fr of a split grid (ModuleScreens.tsx:179, 248) | **Blocker** |
| explanatory copy | One quiet 13px subtitle ('Customers and vendors, one directory · most were created automatically') | A boxed ModuleIntro banner with a 3-line paragraph of internal/architectural prose ('ties each contact to open receivables, open payables, and the default-category rule affordance', ModuleScreens.tsx:168-177) — the 'unnecessary explanatory text' called out | High |
| table columns | Name+avatar, Role, Received YTD, Paid YTD, Open balance, Last activity (6 cols) | Only Name, Role, Open balance, This year (4 cols). No avatar, no last-activity column (despite lastActivity being computed in backend), no split of money-in vs money-out, no default-category/rule column | High |
| filters | Feedback asks: customers, vendors, employees, contractors, open AR, open AP, recurring, recently active | Only All/Customers/Vendors role buttons (ModuleScreens.tsx:185-195) + free-text search. No open-AR/open-AP/recurring/recently-active filters; employee/contractor roles do not exist in schema (schema.ts:234 roles = customer\|vendor only) | High |
| detail panel content | Tabbed profile (Invoices&payments / Transactions&bills / Notes), Stripe badge, vendor default-category rule, aliases, merge, archive | Flat untabbed profile: 3 StatCards + static rule card + static merge text + flat history list. No tabs, no notes editor, no aliases section, no functional merge, no archive (ModuleScreens.tsx:286-329) | High |
| merge duplicates | Active top-of-list AI merge banner with Merge / Keep separate actions and a post-merge confirmation | Inert text card: 'Duplicate detection needs candidate rows from the backend' (ModuleScreens.tsx:309); backend mergeFlow is hardcoded placeholder text (moduleViews.ts:295-300). No merge mutation exists | Medium |
| add contact / archive actions | 'Add contact' primary action; archive/merge as real workflows | 'Add contact' Button has no onClick handler (ModuleScreens.tsx:172-176); no archive UI on this surface at all | Medium |
| AI affordance | Quiet green merge suggestion banner driven by alias similarity (sparkle icon) | Static Sparkles 'Default category as rule' card always shown even when no default category is set (ModuleScreens.tsx:293-301); merge AI is not wired | Medium |
| overdue signal | Overdue AR shows --negative red + alert-circle icon and a 'X days overdue' tooltip (prototype lines 81-85, 278-280) | Open-balance cell uses default neutral Amount tone (ModuleScreens.tsx:236) — no overdue distinction, no aging signal, no icon | Medium |
| role chip styling | Per-role colored chips (customer green / vendor neutral / team blue) | CategoryChip renders raw lowercase role string with one uniform style; active variant only toggles green fill (primitives.tsx:194-210). No per-role semantics | Low |
| empty state | Directory always full-width; no orphan empty pane | When nothing selected, the right pane shows an EmptyState 'No contact selected' card occupying 0.8fr permanently (ModuleScreens.tsx:261-268) — wasted space that should not exist in a directory-first layout | Low |

### 3.8 Payroll

| Dimension | Prototype / Target | Current | Severity |
|---|---|---|---|
| Run provenance / mental model (Ansar's core ask) | Make explicit that runs are MANUALLY drafted from active-employee salaries: prototype shows 'Run payroll drafts the statement from everyone's salary — you review, adjust, then approve' (70) and a Review→Approve→Mark paid stepper (100-107) | No stepper, no provenance copy in the run list, no 'where do runs come from' affordance. The only signal is a status Badge. The Run-payroll button is hardcoded to '2026-06' (952) so it cannot draft any other period; auto-generation does not exist (only cron is Plaid sync, crons.ts:7) | High |
| KPI strip | Ansar asks for: payroll this period, next run, taxes/withholding, contractors vs employees, unmatched items | A 4-up StatCard strip exists but only shows per-currency totals + a Headcount tile (985-999). No next-run, no taxes/withholding, no contractor split, no unmatched-items metric. Taxes/withholding and contractors do not exist in the data model at all | High |
| Tabs | Ansar asks for Runs, People, Statements, Contractors, Rules. Prototype has Employees/Runs/Statement with green-underline active state | Only 3 tabs (employees/runs/statement) rendered as a shadcn Button group with default/outline variants (976-980), NOT shadcn Tabs and NOT the prototype's underline treatment. No Contractors tab, no Rules tab | High |
| Period selector | Ansar asks for month/quarter/custom/statement-period selector; Statement should be selectable not fixed | No period selector anywhere. Statement tab shows the CURRENT employee snapshot only (PayrollStatement:1401 reads data.payroll.statementRows, no period scoping). Run-payroll is locked to one literal month (952) | High |
| Statement selection (Ansar: 'too static') | Selectable statement by period with export | Two different statement surfaces with no period chooser: the run-scoped PayrollRunStatement (1339, grouped, CSV/print) and a global PayrollStatement (1401) that just dumps the current roster. Neither lets you pick a past period; prototype hardcoded 'May 2026' (165) and current code has no period control | High |
| Detail-panel default state | Row detail CLOSED by default, opening only on selection; register stays visible | Selecting a run REPLACES the whole screen with PayrollRunDetail (966 early-returns the detail component), losing the runs list, KPI strip and tabs. Not a closed-by-default side/row detail — it is a destructive full-screen swap | High |
| Contractors vs employees | Ansar asks to distinguish/contrast contractors vs employees and add a Contractors tab | No contractor concept exists. The employees table (schema.ts:517) has no kind/workerType field; 'contractor' appears only as a seeded inbox question string (seedDemo.ts:1100) and in tests. This is a future-work item, not present | Medium |
| Import payroll register | Ansar's workflow step 1: import payroll register | No import path. startRun (payroll.ts:253) only generates lines from active employees; there is no CSV/register import mutation or UI. The v1 loop lists 'payroll register' as an entry source but it is unimplemented here | Medium |
| Empty / pre-run state | Prototype shows a 'June hasn't been run yet…' explainer banner with due date (67-73) | No pre-run explainer banner. If June isn't run, the only signal is the presence of the 'Run payroll · June' button (1080-1084) with no contextual due-date or guidance | Medium |
| Headcount accuracy | People column should reflect the run's own snapshot lines | run.headcount is computed from CURRENT active employees (moduleViews.ts:528) for EVERY run, so historical runs show today's headcount, not the people actually paid that period | Medium |
| 12-month trend chart | Statement tab includes a 12-month USD-equivalent bar trend (195-205) | Absent. No spend-over-time visualization in Payroll at all | Low |
| Run-list richness | Prototype run row shows a 'By currency' breakdown column ($6,000 · ₨2,140,000 · ₹344,000) and currency-aware base | Run table has Period/People/Status/Base total only (1090-1094) — the by-currency column was dropped, reducing at-a-glance multi-currency context | Low |

### 3.9 Reports

| Dimension | Prototype / Target | Current | Severity |
|---|---|---|---|
| drill-through target (Ansar core ask) | Clicking a report number drills into the underlying records; Ansar wants it to land in filtered Transactions/Income/Expenses (the universal register / lenses). | MoneyButton opens a local read-only DrillSheet (ReportsScreen.tsx:378,430,1298) listing journalLines with a Total — it never navigates to Transactions/Income/Expenses. TransactionsScreen only reads ?focus=<id> (CoreScreens.tsx:720); it has no account=/category=/start=/end= filter params, so a real drill-through is impossible today. | High |
| AI panel + reports layout (Ansar core ask) | Ask AI must not squeeze reports into unreadable layouts; reports stay readable with the panel open. | Docked AI is a w-[380px] shrink-0 aside that is a flex sibling of the content column inside flex min-h-screen (AppShell.tsx:417-469). When open, content column = flex-1 of (viewport minus sidebar 232px minus 380px). The P&L monthly table is Account(min-w-56) + up to 6 month cols + Total inside overflow-x-auto (ReportsScreen.tsx:472,476) — at ~1440px viewport the content column is ~828px and the 7-col money grid overflows into an inner horizontal scrollbar. 6 report tables use overflow-x-auto and all inner-scroll when the panel is open. | High |
| dashboard to reports drill consistency | Dashboard tiles, workbench, and Reports must show the same numbers for a period (number-consistency rule). | Dashboard links to /reports?report=profit-and-loss&period=${dashboard.selectedMonth} (CoreScreens.tsx:231,243) but ReportsScreen only reads ?start=/?end= (ReportsScreen.tsx:1135,1161); the period= param is ignored, so the drill-through lands on the report DEFAULT period, not the dashboard selected month. | High |
| Close-the-books on Reports home | Reports home leads with a Close the books banner (green Close / Locked pill) and a full Close-May checklist flow (Reports.dc.html:30-48, 433-477). | ReportsScreen has NO close-the-books UI (grep for close/lock/period returns nothing). Period-lock lives in ModuleScreens.tsx (Settings/Audit area), so the most operator-visible close-my-month action is missing from the surface the prototype puts it on. | Medium |
| stable period selection / toolbar resilience | Stable period selection that does not reset unexpectedly. | Period is mostly stable: a ref guard (initializedForRef, ReportsScreen.tsx:1147,1159) applies a default once per report and clamps to today (report-periods.ts). BUT switching reports force-resets basis to accrual, compare to none, columns (1169-1172), so a user comparing periods loses toggles on every switch; and the toolbar is flex flex-wrap (247) so on a squeezed column the controls wrap to 2-3 rows. | Medium |
| off-token status colors + unicode glyphs | One brand green; lucide icons only; no unicode-as-icon; semantic tokens not raw Tailwind hues. | ACCENT_BG uses bg-teal-600 and bg-amber-500 (ReportsScreen.tsx:140,142) instead of chart tokens; balanced/trial-balance chips use raw bg-amber-100 text-amber-800 (591,888); status uses unicode checkmark Balanced (593,889) and arrow glyphs in copy/links (1002,1008,1020,1032,1041) instead of lucide Check/ArrowRight. | Medium |
| expense tone (DS: expenses neutral, not red) | Money-out neutral; red reserved for overdue/outflow. Prototype expense deltas use amber #b54708 for spikes, green for drops, gray default. | ReportsScreen keeps expenses neutral (Amount default tone) — correct, no alarm-red here. (The purple/red violations flagged by the design agent are in ExpensesScreen.tsx/IncomeScreen.tsx, NOT this file.) | Low |
| Payroll Summary fidelity | Prototype Payroll Summary shows USD/PKR/INR multi-currency columns + people count + FX gain/loss note (Reports.dc.html:330-345). | Current PayrollSummary renders only Month / Status / Base total (ReportsScreen.tsx:809-841) — the multi-currency breakdown, headcount, and FX note are dropped. | Low |
| Cash Flow bridge color tokens | Bridge bars: green for inflow, red/amber for outflow, slate endpoints. | CashFlow bridge maps negative groups to amber accent then bg-amber-500 (ReportsScreen.tsx:619,662); prototype uses #d92d20 (negative token) for outflow bars (Reports.dc.html:687-688). Outflow tone diverges from the negative token. | Low |

### 3.10 Settings

| Dimension | Prototype / Target | Current | Severity |
|---|---|---|---|
| sticky subnav | Settings nav should stay fixed while content scrolls (Ansar's explicit ask; target behavior better than prototype) | The desktop subnav <nav> at SettingsScreen.tsx:152-156 has no sticky/top- class; the flex parent only has lg:items-start (line 151). The whole document scrolls (AppShell <main> line 463 has no overflow/height), so the nav scrolls away with long sections (Rules, Audit, Categories). | High |
| connections complexity | Connections (Plaid/Stripe/imports) should be simpler/action-oriented — per-account status + a Reconnect/Connect action | ConnectionsSection delegates to PlaidConnectionPanel.tsx (655 LOC) and StripeConnectionPanel.tsx (555 LOC), which are developer test consoles: Prepare Link / Use sandbox bypass / Simulate relink buttons (PlaidConnectionPanel.tsx:389-465), step-row pipeline diagnostics, Validate/Seed/Sync, checklist cards, and 'Integration notes for the main thread' (StripeConnectionPanel.tsx:543-551). No simple owner-facing 'Mercury · Connected · Reconnect' card exists. | High |
| AI provider-debug heaviness | AI settings should be understandable, not provider-debug heavy | AiSection adds two debug tables absent from the prototype: 'Batch runs' (AiSection.tsx:210-228) and 'Categorization eval' with accuracy %, correctCount/evaluatedCount and providerMode (lines 230-252). Provider is a disabled Select fixed to Amazon Bedrock (lines 99-110); key state reads 'set in Convex env · never shown'. This is verification-harness output, not owner-legible config. | High |
| table/grid overflow in narrow column | Tables must not overflow their cards; row layout must reflow when the content column narrows | Audit uses fixed `grid-cols-[120px_120px_1fr]` (AuditSection.tsx:77,86); Rule rows pack ~9 inline elements (arrows, grip, #order, name/summary, AI badge, fired count, toggle, edit, delete) on one non-wrapping flex row (RulesSection.tsx:111-175). When the 380px AI panel opens (AppShell.tsx:466-469) the flex-1 main column shrinks, squeezing the ~190px-subnav + content to ~430px — the 240px of fixed audit columns plus gaps crowd the action text, and rule-row controls collide. | High |
| nested table in card | Detail tables must not overflow horizontally | StripeConnectionPanel payout drill-down renders a 5-column shadcn Table (Payment/Description/Gross/Fee/Net) inside an `overflow-x-auto` wrapper in a `<details>` (StripeConnectionPanel.tsx:236-273). The overflow-x-auto means it CAN scroll horizontally rather than reflow — exactly the 'detail tables overflow horizontally' symptom in Ansar's feedback. | Medium |
| interactive controls use raw elements | Build on shadcn primitives (Switch, Checkbox) before raw controls | Every toggle is a hand-rolled `<button>` pill (NotificationsSection.tsx:79-88, RulesSection.tsx:148-156, CategoriesSection.tsx:84-92) instead of shadcn Switch; rule auto-post and Plaid account include use raw `<input type=checkbox>` with `accent-[#2ca01c]` (RulesSection.tsx:335, PlaidConnectionPanel.tsx:500-505) instead of a Checkbox primitive. | Medium |
| businesses avatar palette | One brand green; chart palette tokens only; no off-brand purple | BusinessesSection avatarColor palette includes magenta `#fce7f6`/`#a4148c` (BusinessesSection.tsx:45) used as a generic initials swatch — an off-brand purple, same class of violation flagged in ExpensesScreen DOTS. | Medium |
| redundant heading | Subnav label should not be re-printed as a content h2 | SectionBody re-renders the section label as an h2 plus a SECTION_DESCRIPTIONS subtitle (SettingsScreen.tsx:210-215, 27-38), duplicating the active subnav item and consuming vertical space the prototype gives straight to cards. | Low |
| row-detail default state | Row detail CLOSED by default, opening only on selection | Stripe payout rows use native `<details>` (closed by default — acceptable) but Plaid recent-imports/accounts render as always-expanded card lists (PlaidConnectionPanel.tsx:588-627). Rules/Categories have no row-detail concept; editing opens a Dialog (RulesSection.tsx:274), which is fine, but there is no selectable row-detail panel pattern. | Low |
| filters | Audit filters present and aligned; other list sections lack search where useful | Audit has text + actor-Select + date filters (AuditSection.tsx:56-74) — good and beyond prototype. But Rules, Categories, Team, Notifications have no search/filter; for a real chart of accounts (~30 categories) Categories has no filter, and Rules has no status filter. | Low |

### 3.11 Ask AI

| Dimension | Prototype / Target | Current | Severity |
|---|---|---|---|
| UI primitive layer (AI Elements) | Ansar's target: rebuild on AI Elements primitives — Conversation, Message, PromptInput, Suggestion, Sources, Tool, optional Reasoning/Actions/Attachments — on shadcn/ui. | Fully custom: hand-rolled MessageBubble (OpenBooksAIChat.tsx:421), a from-scratch markdown parser (MarkdownBlocks:199/InlineMarkdown:171), tool cards as native <details> (ToolPartCard:325), suggestion chips as raw <Button> (:822/:871). No 'ai'/'@ai-sdk'/'ai-elements'/'streamdown' in apps/web/package.json. | High |
| Provider/debug label leakage | Prototype shows only 'Viewing: {screen}' (line 201); Ansar: remove provider/debug labels entirely from user-facing UI. | Vendor string 'Bedrock active'/'Degraded mode' rendered to users in 3 places: OpenBooksAIChat.tsx:758, AskAIScreen.tsx:45, ModuleScreens.tsx:1568; helper label 'Bedrock provider is configured' in ai.ts:143. | High |
| Panel modes / compact access | Ansar: compact icon access from shell + four modes — collapsed icon / docked side panel / expanded workspace / mobile drawer. | Only two modes exist: fixed w-[380px] docked desktop panel (AppShell.tsx:469) and h-[88dvh] mobile bottom-sheet (:495). No resizable/expanded width, no collapsed icon. The CollapsedRail (AppShell.tsx:717-820) renders appRoutes+settings but NO Ask AI trigger — when the sidebar is collapsed there is no rail-level AI affordance; access is only the header button. | High |
| Header overflow at 380px | Prototype header is 4 simple items that fit 380px (line 198-206). | Drawer header packs Sparkles + 'Ask AI' + truncated 'Viewing:{label}' + provider Badge + a 170px-wide native <select> + new-chat icon + maximize icon + close icon (OpenBooksAIChat.tsx:750-797). At 380px minus the left title block this crowds/overflows; items are .sm-gated to hide, degrading the feature rather than fitting it. | High |
| Thread selection UX | Ansar: thread selection + new chat 'not modern'; wants a modern conversation switcher. | Two parallel, inconsistent switchers: a raw native <select> in the drawer header (OpenBooksAIChat.tsx:762, not a shadcn Select) and a separate left ThreadRail with bordered buttons in page mode (:476-538). The drawer has no thread list at all — only the dropdown. | Medium |
| Context-awareness (page+filter state) | Ansar: context-aware by page AND filter state. | Chat receives only a coarse route label (currentRouteLabel from appRoutes, AppShell.tsx:256) and a year-wide reportPack hardcoded to 2026-01-01..2026-12-31 accrual (AppShell.tsx:135-137). The only surface that pushes its own range/pack is Reports (ReportsScreen.tsx:1269 via createAiRequestEvent); Income/Expenses/Transactions filter state never reaches the chat. | Medium |
| Inline answer artifacts | Prototype renders rich inline metric tiles + deep-link CTA inside the answer (line 220-238). | Assistant answers are markdown-only (tables via the parser, MarkdownBlocks:220); no structured metric-tile/answer-card component. The page 'Pinned artifacts' aside is a static placeholder (OpenBooksAIChat.tsx:908-914). | Medium |
| Message bubble styling | Prototype: assistant = avatar + flowing text (no card border); user = grey #f5f5f5 bubble (line 212). | Assistant text wrapped in a bordered card 'rounded-[8px] border ... shadow-xs' (OpenBooksAIChat.tsx:442); user bubble is a solid brand-green fill 'border-primary bg-primary text-primary-foreground' (:443) — heavier brand saturation than the prototype's quiet grey, drifting from 'quiet AI affordances'. | Low |
| Page-mode layout width | Prototype has no full-page mode (panel only). | AskAIScreen renders the 3-column chat (236px rail + chat + 280px artifacts) inside the shell's max-w-[1200px] main (AppShell.tsx:463); the page also still carries a redundant top PageHeader 'Ask AI' (AskAIScreen.tsx:41) plus the chat's own internal header — duplicated chrome. | Low |

### 3.12 Shell, Header & Navigation

| Dimension | Prototype / Target | Current | Severity |
|---|---|---|---|
| header — global search | Ansar wants the global header search REMOVED, replaced by page-local search + the ⌘K command palette as the global jump-to. Header should be quiet. | A persistent ~460px global search trigger occupies the header (AppShell.tsx:430-441) and only opens the palette; it is dead weight on every page and disappears entirely below md (line 434 `md:flex`), so phones get no search affordance at all. | High |
| header — month chip | Remove the global month chip; period belongs to the surfaces that have a period (Dashboard/Reports/Income/Expenses), not the shell. | Hardcoded static "Jun 2026" pill in the header (AppShell.tsx:444-446), not wired to any date/period state, shown on every page including pages with no period concept (Contacts, Settings). | High |
| body — repeated workspace/page intro noise | Ansar: stop repeating workspace/page intro noise. Each surface should not re-announce the entity and a generic description. | Every screen renders PageHeader with eyebrow=activeEntity.name + a one-line route summary + a "Demo entity" chip (AppScreen.tsx:50-55). The entity name is already in the sidebar EntitySwitcher, so it is duplicated on every page; the route summary (content.ts) is boilerplate filler. | High |
| docked AI panel — content compression / overflow | Ansar: the docked AI panel compresses content and overflows; AI should not steal layout width. | The 380px panel is a flex sibling of the main column (AppShell.tsx:466-480), so opening it shrinks the centered max-w-[1200px] content. On a 1440px laptop: 232 sidebar + 380 panel leaves ~828px for content, well under the 1200px design width — wide tables (Transactions/Reports) get squeezed. Should be an overlay/resizable drawer, not a width-stealing column. | High |
| sticky vs scroll panels | Ansar: define which panels are sticky vs scroll independently; settings subnav should stay fixed while content scrolls. | Header is sticky (line 419) and sidebar is fixed (line 376), but the Settings subnav is NOT sticky: it is a plain 190px column inside `lg:flex lg:items-start` (SettingsScreen.tsx:151-178) that scrolls with the page; long sections (Categories, Team, Audit) scroll the subnav out of view. No `position:sticky` on the subnav. | High |
| mobile — search affordance | Mobile must be a real responsive surface with true drawers + compact nav; ⌘K is unreachable on phones. | The only search trigger is hidden below md (AppShell.tsx:434); the bottom nav (line 509) has Dashboard/Inbox/Transactions/Ask AI but no Search entry, so mobile users have zero way to invoke the command palette or search anything. | High |
| header — Ask AI permanent pill | Ansar wants Ask AI as an icon/assistant control, not a permanent header pill taking up space. | Full "[sparkle] Ask AI ⌘J" pill is always present in the header (AppShell.tsx:447-459) with hardcoded brand hexes; consumes header real estate next to the month chip. | Medium |
| body — visible demo/entity labels | Ansar: remove visible demo/entity labels from the body; only a subtle env indicator if needed. | A "Demo entity" CategoryChip renders in the page header on every screen for demo entities (AppScreen.tsx:54); a "Bedrock active / Degraded mode" vendor label is user-facing in 3 places (AskAIScreen.tsx:45, OpenBooksAIChat.tsx:758, ModuleScreens.tsx:1568); BusinessesSection shows a "Demo"/"Live" badge (BusinessesSection.tsx:97). | Medium |
| mobile — bottom nav coverage | Compact mobile nav that reaches the core surfaces. | mobileRoutes is hardcoded to only Dashboard/Inbox/Transactions (content.ts:94-96); Income, Expenses, Bills, Reports, Settings are unreachable from the bottom bar — the off-canvas drawer is the only path, and there is no "More" affordance in the bottom nav. | Medium |
| AI button DS tokens | One brand green via semantic tokens; quiet AI affordance. | Ask AI button uses raw hardcoded hexes border-[#bbe0a9] bg-[#f1f8ee] text-[#1d6b12] hover:bg-[#dcefd2] + ⌘J text-[#63b347] (AppShell.tsx:450-458) instead of --primary / --ai tokens. | Low |

---

## 4. Product Information Architecture Decision

### 4.1 The decision, stated plainly

**Transactions is the one place financial truth is created and stored. Income and Expenses are lenses — saved, pre-filtered views over the *same* records — and Bills is an accounts-payable *workflow*, not a parallel ledger. Reports read posted journal lines and must agree with all three.** A record is never "moved" from Transactions into Income or Expenses; it is one row that gains richer presentations depending on where you stand. This is the literal architecture in the code today, not an aspiration: `convex/incomeViews.ts` and `convex/expensesViews.ts` are read-model `query` functions over the shared `transactions` + `journalLines` tables — neither file inserts, owns, or duplicates a record.

This follows directly from the product's stated contract: *"Double-entry under the hood, plain English on the surface … the UI talks about 'income,' 'expenses,' and 'categories,' never 'debits' and 'credits'"* (`docs/product/01-vision-and-scope.md:25`). Income/Expenses/categories are **surface vocabulary for ledger accounts**, not separate stores. The same doc collapses the data model to *"Two transaction concepts, not five … money already moved = a Transaction; money that will move = an Invoice (in) or a Bill (out)"* (`01-vision-and-scope.md:28`). That single sentence is the IA: one register for money that moved, AP/AR workflows for money that will move.

### 4.2 Why duplicating truth across tabs is the failure mode we are designing against

The anti-pattern is QuickBooks' "Bills vs. Expenses vs. Checks confusion," which the vision explicitly names and rejects (`01-vision-and-scope.md:28`). If Income and Expenses each owned their own copy of a transaction, four things break: (1) recategorizing in one tab wouldn't reflect in the other; (2) Reports could disagree with the workbench; (3) the immutability invariant would be violated by competing writers; (4) the operator would distrust the numbers. The architecture forecloses all four by making **one ledger mutation the only writer**. `postLedgerEntryCore` enforces debit-xor-credit per line and Σdebits = Σcredits or throws (`convex/ledger.ts:369-381`), rejects backdated posts against a period lock (`ledger.ts:360-362`), and stamps every entry `locked: true` (`ledger.ts:401`). No view file calls it. Income and Expenses can only *read*.

### 4.3 Worked example: Stripe deposit → Income lens

A Stripe payout deposit lands in the bank feed and posts once via the single ledger mutation. It becomes one row in **Transactions** (the universal register), and it surfaces in the **Income** lens with no second copy. `convex/incomeViews.ts:111-137` builds the Payments tab from `transactions.filter(txn => txn.amountMinor > 0 && txn.review !== "excluded")` plus reconciled `stripePayouts` — it reads the same rows Transactions reads. The receivables matrix doesn't recompute aging; it calls the report pack's exported `buildAgingRows` (`incomeViews.ts:6, 173`, exported at `reportViews.ts:347`) with the in-code comment *"reuse the report pack aging math (no duplication)"* and *"derive from the SAME invoice set the report pack uses, so they reconcile with AR aging"* (`incomeViews.ts:172, 188-189`). The Stripe gross−fees split itself is double-entry truth posted once; Income merely renders gross/fee/net as a `payout` row (`incomeViews.ts:124-136`).

### 4.4 Worked example: AWS charge → Expenses lens

An AWS card charge posts once (bank-source transaction, expense-account journal lines). It is one **Transactions** row and appears in the **Expenses** lens as cost — never re-stored. `convex/expensesViews.ts:80-98` sums expense-account journal lines as `debitMinor − creditMinor`, with the comment *"using the SAME convention as the report pack (expense amount = debit − credit) … what makes Expenses category totals reconcile to the P&L expense section."* The vendor/recurring breakdowns are derived from the same `transactions` and `journalLines` reads (`expensesViews.ts:191-222, 249`). This reconciliation is a *gated requirement*, not a hope: plan C4 says **"Done when: Category totals reconcile to the P&L expense section"** with the unit-test verify **"category totals == reportPack P&L expenses"** (`docs/finishing/implementation-plan.md:445, 449`).

### 4.5 Create once, categorize once, evidence once, post once — reflected everywhere

A record's full lifecycle touches exactly one writer and many readers:

- **Created once** — money enters via Plaid/Stripe/CSV/manual and the pipeline tries transfer → match → rule → memory → AI; confident items auto-post, uncertain items become an `inboxItems` card (`01-vision-and-scope.md:53-54`). Manual entry and CSV/OFX import are entry points that belong on the **Transactions** header, not on a lens.
- **Categorized once** — recategorization is **reverse + repost, never edit**, because posted entries are immutable. `recategorizeTransactionCore` reverses the existing entry then posts a fresh one (`convex/pipeline.ts:1060-1079`); the same path is reached whether the operator acts from Transactions, Inbox, the Expenses table, or an Ask-AI proposal (`aiChatActions.ts:196`, `proposals.ts:458`, `categories.ts:225`). The Expenses lens does not get its own write path — it calls the shared one.
- **Evidenced once** — a receipt attaches to the transaction; a bill PDF attaches to the payable. The document lives against the record, so it shows wherever the record is presented.
- **Posted once** — through `postLedgerEntryCore` only. Confidence routing against the single `AI_AUTONOMY_THRESHOLDS` constant decides auto-post vs. Inbox.
- **Reflected everywhere** — Reports are pure queries over `journalLines` grouped by account type (`reportViews.ts:245` `reportAmountForLine`, `:303-338` row builder with per-row `drillDown`). The hard rule is CSV export == on-screen == dashboard tiles == workbench lenses for the same period (plan D2/H1).

### 4.6 Per-surface ownership map (what lives here vs. elsewhere)

| Surface | Owns (workflow that lives ONLY here) | Reads / links out (must reconcile, never duplicate) |
|---|---|---|
| **Transactions** | The universal register: every posted/pending money-moved row across all accounts/sources; inline recategorize (reverse+repost), split, exclude; per-row receipt + Accounting (journal) view + audit; manual entry & CSV/OFX import; register export | Income/Expenses are lenses over these rows; Bills/Payroll *match* against these rows but never own them; bank connect/reconnect is Settings/Connections |
| **Income** | AR workflow: invoice composer, finalize, send via Stripe, reminders, void, PDF; collections/aging follow-up | Payments tab and receivables read the **same** transactions/invoices as Reports (`incomeViews.ts`); recategorizing/excluding a payment is Transactions+Inbox; customer master-data is Contacts; revenue analytics must equal Reports P&L revenue |
| **Expenses** | Cost lens: spend by category/vendor/recurring/evidence-needed; expense category CRUD (`AddCategoryModal`); inline recategorize via the **shared** ledger path | Derived from `journalLines` (`expensesViews.ts:75-98`); the canonical editable list, bulk exclude, import stay in Transactions; AP scheduling is Bills; authoritative P&L is Reports; triage deep-links to Inbox |
| **Bills** | AP lifecycle: add bill (manual/PDF-extract), track as posted payable, mark paid by matching a bank txn (`convex/bills.ts` `createBill`/`markPaid`); bill-evidence capture; AP aging/due triage | The bank-side payment row is in Transactions (Bills references/matches, never owns); vendor spend analytics is Expenses; payee record is Contacts; AP aging in Reports is regenerated from journal lines and must reconcile |
| **Reports** | Report selection, period/basis/compare controls, ledger-backed statements, DrillSheet quick-peek, Explain-via-AI, CSV/print, close-the-books entry point | Read-only over `journalLines`; acting on a record (recategorize/match/pay/edit) hands OFF to Transactions/Income/Expenses/Bills — Reports only links out |
| **Inbox** | The six AI-uncertain card types (`kind`: categorize/receipt/transfer/payout_mismatch/connection/question) — the only mandatory workflow; "create rule from this"; inline split | Only holds `status === "open"` items (`coreViews.ts:309`); after resolution the posted record lives in Transactions and is reflected in lenses — Inbox never owns it; bulk browsing/editing history is Transactions |
| **Dashboard** | Glance summary + drill-through routing carrying the active period | Never a second register; every tile links into the owning workbench; same period must reconcile (H1) |
| **Contacts / Payroll / Settings / Ask AI** | Contact directory + default-category rules; employee roster + pay-run approval (one payroll-expense entry via `approveRun`); workspace/AI/automation config; conversational Q&A + propose→confirm cards | AR/AP/revenue/cost figures, the register, statements, and the ledger write all stay with their owning surfaces; these surfaces read and link, never re-store |

### 4.7 The single load-bearing invariant

Every "reflected everywhere" claim rests on one fact: **there is exactly one write path to the ledger, and the lenses cannot reach it.** Income (`incomeViews.ts`) and Expenses (`expensesViews.ts`) are `query` modules — pure reads. Reports (`reportViews.ts`) is pure reads. The only writer is `postLedgerEntryCore` (`ledger.ts:350-428`), guarded by balance, period-lock, and immutability checks, and reused identically by recategorize-reverse-repost (`pipeline.ts:1060-1079`), invoices (*"Posted entries are immutable; corrections reverse + repost"*, `invoices.ts:308`), bills, and payroll. Because no tab can mutate financial state independently, a record genuinely cannot be "moved" between tabs — there is nowhere else for its truth to live. That is what makes Transactions-as-register with Income/Expenses-as-lenses a structural guarantee rather than a UI convention.

---

## 5. Shared Component System Proposal

This section specifies a single OpenBooks component layer that all eleven data-heavy surfaces consume, so that the work of `TransactionsScreen`, `IncomeScreen`, `ExpensesScreen`, `BillsScreen`, etc. — each of which currently re-implements its own table, filter row, detail pane, and "toast-equivalent" inline string — collapses into shared, design-system-true primitives. Today the only cross-surface design layer is `apps/web/src/components/openbooks/primitives.tsx` (339 lines, imported by ~15 surfaces). Everything below either extends that file or adds a sibling file under `apps/web/src/components/openbooks/`.

### 5.0 Foundation work this proposal depends on

Before the components can be built DS-true, the missing shadcn/Radix wrappers must be generated into `apps/web/src/components/ui/` (the `radix-ui` meta-package is already a dependency at `apps/web/package.json:23`, so no new installs are needed — `popover`, `checkbox`, `scroll-area`, etc. can be generated directly):

| Missing primitive | Why it's needed | What it replaces today |
| --- | --- | --- |
| `drawer` (or reuse `sheet`) | `DetailSheet`/`RecordDrawer` | Right-rail `<aside>` in `CoreScreens.tsx:1048`; ad-hoc `Sheet` in `IncomeScreen.tsx:14` |
| `calendar` + `popover` | `DateRangeControl` | Native segmented `<button>` period pills (`ExpensesScreen.tsx:51`, `IncomeScreen.tsx:81`) |
| `popover` | `AiInsightBadge`, `FilterBar`, `AccountMultiSelect` | `ReasoningPopover` faked with native `<details>` (`primitives.tsx:274`) |
| `checkbox` | `OpenBooksDataTable` row select, `AccountMultiSelect` | Raw `<input type="checkbox">` (`CoreScreens.tsx:1010`, `:553`; `RulesSection.tsx:335` with `accent-[#2ca01c]`) |
| `scroll-area` | nav, AI message list, every drawer body | Raw `overflow-y-auto` (`AppShell.tsx:655`, `OpenBooksAIChat.tsx:814`, `IncomeScreen.tsx:479`) |
| `toggle-group` | `DateRangeControl` period segments, table density | Hand-rolled segmented pills |
| `field`/`field-group`, `input-group`, `form` | `DetailSheet` edit forms, composers | RHF used directly, `Label`+`Input` stacked manually |
| `avatar` | `KpiStrip` n/a; shell + contacts | Inline `<span>` initials (`AppShell.tsx:969`/`:843`; `ExpensesScreen.tsx:158`) |
| `sonner`/`toast` | every mutation result | Inline state strings (`transactionMessage` `CoreScreens.tsx:952`, `aiTestMessage`, `ProposalCard` result `OpenBooksAIChat.tsx:382`) |
| `accordion`/`collapsible` | settings sections, `ToolPartCard` | Native `<details>` (`OpenBooksAIChat.tsx:331`, settings) |
| `progress` | `ConfidenceRing`, `AgingMiniBar` rebuild | Bespoke SVG (`primitives.tsx:213`, `:235`) |

A shared **AttentionState** vocabulary and a **`--negative` / chart token** cleanup are prerequisites too: `globals.css` defines `--primary: #2ca01c` and `--chart-1..5` but **no `--negative` token**, which is why `IncomeScreen.tsx:28/31/115/245/651` reach for raw `text-red-600`/`bg-red-50`, and why `ExpensesScreen.tsx:29` hardcodes an off-palette `DOTS` array (including Stripe blurple `#635bff` and plum `#7a4a8c` as generic category swatches). These must be tokenized as part of shipping the shared table/chips.

---

### 5.1 WorkbenchPage

- **Purpose:** the standard page scaffold every non-shell surface renders into — eyebrow/title/description, a right-aligned action slot, and a vertical rhythm (`space-y-5`) that all surfaces currently re-declare. Wraps the existing `PageHeader` and standardizes the `max-w-[1200px]` content frame already enforced by `AppShell.tsx:463`.
- **Composes:** existing `PageHeader` (`primitives.tsx:120`), `Separator`. Slots: `actions` (renders `PageActionBar`), `kpis` (renders `KpiStrip`), `children` (table/detail region).
- **Missing primitives:** none new; it is pure layout. Replaces the per-file `<div className="space-y-5" data-testid="…-screen">` wrappers (`ExpensesScreen.tsx:49`, `IncomeScreen.tsx:78`, `CoreScreens.tsx:77`/`:930`).
- **Key props:** `eyebrow`, `title`, `description`, `actions?`, `kpis?`, `attention?` (a `WorkbenchPage`-level `AttentionState` banner), `children`.
- **Responsive:** header stacks vertically below `md` (already in `PageHeader`); content keeps `max-w-[1200px]` and gutter `px-4 lg:px-6`.
- **Target file:** extend `primitives.tsx`, or new `openbooks/WorkbenchPage.tsx`.
- **Consumers:** every surface in the audit (`Dashboard, Inbox, Transactions, Income, Expenses, Bills, Contacts, Payroll, Reports, Settings, AskAI`).

### 5.2 PageActionBar

- **Purpose:** the consistent right-aligned cluster of primary/secondary page actions (e.g. "New invoice", "Add category", "Import CSV", "Export"). Today each surface hand-places buttons next to a segmented control (`IncomeScreen.tsx:96`, `ExpensesScreen.tsx:64`), with inconsistent spacing/order.
- **Composes:** `Button` (primary + `variant="outline"`), `DropdownMenu` for overflow, `ExportMenu` as a member. Lucide icons (`Plus`, `Download`, `Upload`).
- **Missing primitives:** none; relies on existing `button` + `dropdown-menu`.
- **Key props:** `primary?: {label, icon, onClick}`, `actions?: ActionItem[]` (collapse to a `⋯` `DropdownMenu` on narrow widths), `align="end"`.
- **Responsive:** below `md`, secondary actions collapse into a single `DropdownMenu` trigger so the bar never wraps under the title.
- **Target file:** `openbooks/PageActionBar.tsx`.
- **Consumers:** all action-bearing surfaces; pairs with `WorkbenchPage.actions`.

### 5.3 DateRangeControl

- **Purpose:** one canonical period control. Right now there are three incompatible implementations: native segmented `<button>` pills with `bg-card shadow-sm` active state (`ExpensesScreen.tsx:51`, `IncomeScreen.tsx:81`), a shadcn `Select` of months (`DashboardScreen` `CoreScreens.tsx:85`), and a static non-functional "Jun 2026" pill in the header (`AppShell.tsx:444`). This makes "what period am I looking at" inconsistent.
- **Composes:** `ToggleGroup` (preset segments: This month / Last / QTD / YTD), `Popover` + `Calendar` (custom range), `Button` trigger. Money/date glyphs use Geist Mono.
- **Missing primitives:** **`toggle-group`, `popover`, `calendar`** must be added.
- **Key props:** `value: {preset} | {from,to}`, `onChange`, `presets`, `align`, `compact?` (header pill form vs. inline form).
- **Responsive:** full segmented group on desktop; on mobile collapses to a single `Popover` trigger showing the active range label.
- **Target file:** `openbooks/DateRangeControl.tsx`.
- **Consumers:** `Dashboard, Transactions, Income, Expenses, Payroll, Reports, AskAI, Shell` (audit). Replaces the dead "Jun 2026" header pill.

### 5.4 FilterBar

- **Purpose:** the shared row of facet controls + search above every data table. Today: Transactions uses `Button` toggles + a search `Input` (`CoreScreens.tsx:933-944`); Income uses a string `invoiceFilter` (`IncomeScreen.tsx:127`); Expenses has none. No shared notion of active-filter chips or "clear all".
- **Composes:** `ToggleGroup`/`Button` segments for review/status facets, `Input` with leading `Search` icon (the `pl-8` pattern at `CoreScreens.tsx:941`), `AccountMultiSelect` and `DateRangeControl` as embeddable members, removable `Badge` chips for active filters.
- **Missing primitives:** `toggle-group` (facets); `popover` (overflow facets).
- **Key props:** `facets: FacetDef[]`, `value`, `onChange`, `search?`, `onSearch?`, `activeChips` (auto-derived), `onClearAll`.
- **Responsive:** facets wrap to a "Filters" `Popover`/`Sheet` trigger below `md`; search stays full-width on top.
- **Target file:** `openbooks/FilterBar.tsx`.
- **Consumers:** `Transactions, Income, Expenses, Bills, Contacts, Payroll, Reports, Settings, AskAI, Shell` (audit).

### 5.5 AccountMultiSelect

- **Purpose:** pick one or many bank accounts / categories to scope a table — a recurring need (Transactions register, Income, Expenses, Bills) that has no implementation today.
- **Composes:** `Popover` + `Command` (reuse `ui/command.tsx`, the same cmdk that powers `CommandPalette`) for searchable, multi-select options, `Checkbox` per row, `Badge` count on the trigger.
- **Missing primitives:** **`popover`, `checkbox`** (and reuses existing `command`).
- **Key props:** `options: {id,label,kind}[]`, `value: string[]`, `onChange`, `mode: "single"|"multi"`, `placeholder`.
- **Responsive:** trigger button on desktop; full-screen `Sheet`-hosted command list on mobile.
- **Target file:** `openbooks/AccountMultiSelect.tsx`.
- **Consumers:** `Transactions, Income, Expenses, Bills, Contacts, AskAI, Shell` (audit). Sources options from existing `data.bankAccounts` / `data.categoryOptions` already loaded in `CoreScreens.tsx:759`.

### 5.6 KpiStrip

- **Purpose:** the standardized metric row. Every surface builds a `grid gap-3 md:grid-cols-3|4` of `StatCard`s (`ExpensesScreen.tsx:67`, `IncomeScreen.tsx:102`), each re-deciding tone, trend rendering, and width. This is also where DS violations cluster: `IncomeScreen.tsx:115` paints an overdue KPI `text-red-600`, and Expenses uses unicode `▲/▼` glyphs (`ExpensesScreen.tsx:71/80`) as trend icons.
- **Composes:** existing `StatCard` (`primitives.tsx:64`), `Amount` with `tone`, lucide `TrendingUp`/`TrendingDown` (replacing the banned `▲/▼`), `Badge` for trend, optional `Sparkline`.
- **Missing primitives:** none, but it must consume a tokenized `--negative` for the only legitimate red KPI (overdue) instead of raw `text-red-600`.
- **Key props:** `items: KpiItem[]` where `KpiItem = {label, value, tone?: "neutral"|"income"|"negative", delta?: {pct, direction}, detail?, sparkline?}`, `columns?: 3|4`.
- **Responsive:** `grid-cols-1` → `sm:grid-cols-2` → `md:grid-cols-{3|4}`; tabular figures throughout.
- **Target file:** extend `primitives.tsx` with `KpiStrip` beside `StatCard`.
- **Consumers:** `Dashboard, Inbox, Income, Expenses, Bills, Contacts, Payroll, Reports` (audit).

### 5.7 OpenBooksDataTable

- **Purpose:** the single dense, ledger-style table used across all data-heavy pages, so Transactions (`CoreScreens.tsx:982`), Income payments (`IncomeScreen.tsx:149`), Expenses categories (a hand-rolled `grid` "table" at `ExpensesScreen.tsx:95`), Bills, Contacts, Payroll, and report tables stop diverging. This is the highest-leverage component: it is the difference between "tables consistent across data-heavy pages" and the current per-file drift (one uses shadcn `Table`, one uses raw `grid-cols-[…]`, each re-styles its own header row).
- **Composes:** `ui/table.tsx` (`Table/TableHeader/TableRow/…`), `Checkbox` for row + header select-all, `ScrollArea` for the body, `DropdownMenu` for row actions, `Skeleton` for loading, `EmptyState` (`primitives.tsx:99`) for empty. Money cells render via `Amount`; the right-most column is always money-right-aligned + tabular.
- **Missing primitives:** **`checkbox`** (replaces raw `<input type=checkbox>` at `CoreScreens.tsx:1010`), **`scroll-area`**. Inline-edit category cells reuse existing `Select` (`CoreScreens.tsx:1020`).
- **Key props:** `columns: ColumnDef[]` (with `align`, `mono`, `width`), `rows`, `getRowId`, `selectable?`, `selectedIds`, `onSelectionChange`, `onRowClick` (opens `DetailSheet` — **does not** inline-expand), `density?: "comfortable"|"compact"`, `attention?: (row)=>AttentionState[]`, `loading`, `empty`.
- **Critical behavior — row detail CLOSED by default:** today Transactions seeds the right-rail detail from `data.rows[0]` (`CoreScreens.tsx:746`) and Inbox from `inbox.items[0]` (`CoreScreens.tsx:360`), so a record is always force-open. The shared table must default `selectedId = null` and only open `DetailSheet` on explicit row click. AttentionState badges render inline in a dedicated column (see 5.13).
- **Responsive:** desktop = full columns; mobile = a card/list rendering of the same `ColumnDef`s (label + value stacked), never a horizontally-squeezed table (DS rule, `AGENTS.md` mobile clause).
- **Target file:** `openbooks/OpenBooksDataTable.tsx`.
- **Consumers:** `Inbox, Transactions, Income, Expenses, Bills, Contacts, Payroll, Reports, Settings, AskAI` (audit).

### 5.8 DetailSheet / RecordDrawer

- **Purpose:** the one slide-over that shows a record's full detail and edit affordances — transaction accounting view, invoice detail, bill detail, payroll run, contact. Replaces three divergent implementations: the persistent right-rail `<aside>` (`CoreScreens.tsx:1048`, which is **always open**), the `IncomeScreen` `Sheet` drawer (`IncomeScreen.tsx:14`/`:476`+), and the inline category expand-rows in Expenses (`ExpensesScreen.tsx:122`).
- **Composes:** `Sheet`/new `Drawer`, `ScrollArea` body (replacing raw `overflow-y-auto` at `IncomeScreen.tsx:479`), `Field`/`FieldGroup` + `Form` for edits, `Tabs` for sub-views (e.g. "Accounting view"), `AttentionState` header chips, `Button` footer. Money via `Amount`; the balanced-lines check (`CoreScreens.tsx:1070`) becomes an `AttentionState` (`unposted`).
- **Missing primitives:** **`drawer`** (or formalize `sheet`), **`scroll-area`**, **`field`/`field-group`**, **`form`**.
- **Key props:** `open`, `onOpenChange`, `title`, `subtitle`, `attention?`, `tabs?`, `children`, `footer`. Closed by default; opened only by `OpenBooksDataTable.onRowClick`.
- **Responsive:** right-side sheet ≥ `lg`; bottom sheet on mobile (mirrors the AI panel's `h-[88dvh]` bottom-sheet pattern at `AppShell.tsx:492`).
- **Target file:** `openbooks/DetailSheet.tsx`.
- **Consumers:** every surface in the audit.

### 5.9 AiInsightBadge

- **Purpose:** the quiet, green AI affordance — confidence + "why" reasoning — shown inline in tables and detail panes. Generalizes the `ReasoningPopover` (`primitives.tsx:274`, faked with `<details>`), the `ConfidenceRing` (`primitives.tsx:213`), and the `Sparkles`-marked review prompts (`primitives.tsx:317`).
- **Composes:** `Popover` (real, replacing `<details>`), lucide `Sparkles` in `--primary`/`--ai`, `Badge`, and `ConfidenceRing` (kept or rebuilt on `progress`). Must stay brand green — never purple/gradient (DS rule).
- **Missing primitives:** **`popover`** (replacing the `<details>` fake), optionally **`progress`** to rebuild `ConfidenceRing`.
- **Key props:** `confidence?: number`, `reasoning?: ReactNode`, `decidedBy?: string`, `variant: "ring"|"chip"|"inline"`.
- **Responsive:** popover anchors right in tables; becomes an inline block inside `DetailSheet` on mobile.
- **Target file:** extend `primitives.tsx` (replace `ReasoningPopover`).
- **Consumers:** `Dashboard, Inbox, Transactions, Income, Expenses, Bills, Contacts, Reports, AskAI` (audit).

### 5.10 EvidenceUpload

- **Purpose:** attach/extract a receipt or document on a transaction, bill, or inbox card — the receipt path that today is bespoke per surface (Inbox `receiptDocument`, `CoreScreens.tsx:366`; receipts actions wired via `receipts.*` / `receipts.extractWithBedrock`).
- **Composes:** `Button` + hidden file input (or new `input-group` with a drop affordance), `Card` preview, `AiInsightBadge` for extracted-field confidence, `AttentionState` `missing evidence`/`unmatched`. PDF/image preview reuses existing receipt render path.
- **Missing primitives:** **`input-group`** for the upload control; reuses `card`, `button`.
- **Key props:** `target: {kind, id}`, `document?`, `onUpload`, `onMatch`, `extracting?`.
- **Responsive:** inline within `DetailSheet`; full-width drop zone on mobile.
- **Target file:** `openbooks/EvidenceUpload.tsx`.
- **Consumers:** `Inbox, Transactions, Expenses, Bills` (audit).

### 5.11 ExportMenu

- **Purpose:** the consistent "Export" affordance (CSV / PDF) for any table or report. No shared implementation exists today; Reports has ad-hoc export controls.
- **Composes:** `DropdownMenu` (reuse `ui/dropdown-menu.tsx`), `Button` trigger with lucide `Download`, menu items (CSV, PDF, copy). Surfaces a `toast` on completion (replacing inline result strings).
- **Missing primitives:** **`sonner`/`toast`** for completion feedback; reuses `dropdown-menu`.
- **Key props:** `formats: ("csv"|"pdf"|"xlsx")[]`, `onExport`, `filename`, `disabled?`.
- **Responsive:** icon-only trigger on mobile, label + chevron on desktop.
- **Target file:** `openbooks/ExportMenu.tsx`.
- **Consumers:** `Transactions, Income, Expenses, Bills, Contacts, Payroll, Reports, Settings` (audit). Member of `PageActionBar`.

### 5.12 AttentionState

- **Purpose:** the **shared status vocabulary** — `needs review`, `missing evidence`, `overdue`, `unmatched`, `unposted`, `low confidence` — rendered as one consistent chip everywhere, replacing today's scattered, off-token statuses: Income's `STATUS_CHIP` map with raw `bg-red-50 text-red-700` (`IncomeScreen.tsx:24-32`), `CategoryChip` doubling as a "Needs review"/"Unposted" label (`CoreScreens.tsx:975`/`:1071`), and the unicode `✓ Balanced` in Reports (`ReportsScreen.tsx:593`/`:889`).
- **Composes:** `Badge` + lucide icon per state (`CircleAlert`, `Receipt`, `Clock`, `Unlink`, `FileX`, `Sparkles`). Each state maps to a **semantic token, not raw Tailwind**: `overdue` → `--negative` (must be added to `globals.css`; today there is no `--negative` token, forcing `text-red-600`), `needs review`/`low confidence` → `--warning`/`--ai`, `unposted`/`unmatched` → `muted-foreground`. Expenses remain neutral, never alarm red (DS rule).
- **Missing primitives:** none, but depends on the `--negative`/`--warning` token additions.
- **Key props:** `state: AttentionKind`, `count?: number`, `size?`. A shared `AttentionKind` union and `attentionMeta` map (label/icon/token) live in one module so tables, drawers, KPIs, and the Inbox all read the same source of truth.
- **Responsive:** icon-only at narrow widths with `Tooltip` label.
- **Target file:** `openbooks/AttentionState.tsx` (+ `attentionMeta` constant); replace `CategoryChip`'s status overloads.
- **Consumers:** `Dashboard, Inbox, Transactions, Income, Expenses, Bills, Contacts, Payroll, Settings, Shell` (audit).

### 5.13 CommandPalette

- **Purpose:** the global ⌘K palette — already exists and is the closest thing to a finished shared component (`CommandPalette.tsx`, mounted in the shell). Keep, with one structural fix and DS alignment.
- **Composes:** `ui/command.tsx` (cmdk) — `CommandDialog/Input/List/Group/Item` (`CommandPalette.tsx:107`). Reuses existing `coreViews.transactions` + `moduleViews.overview` queries (no new backend, `CommandPalette.tsx:73-85`).
- **Missing primitives:** none. Note: results render in a raw `CommandList`; if long, wrap in `scroll-area`.
- **Improvements:** the `TODO(backend follow-up)` at `CommandPalette.tsx:189` (only searches the ~50 already-loaded rows) should be paired with a server search index; route the same `AttentionState` and `Amount` formatting used elsewhere so palette rows match table rows.
- **Key props (current):** `open`, `onOpenChange`, `enabled`, `canAccessSettings`.
- **Responsive:** centered dialog (cmdk default) on all sizes; already mobile-safe.
- **Target file:** keep `openbooks/CommandPalette.tsx`.
- **Consumers:** `Dashboard, Transactions, Bills, Contacts, Reports, AskAI, Shell` (audit).

### 5.14 AskAIWidget

- **Purpose:** the docked/page Ask AI surface. Today this is the single largest divergence from the DS toolkit: `OpenBooksAIChat.tsx` (918 lines) hand-rolls message bubbles (`MessageBubble:421`), a bespoke markdown renderer (`MarkdownBlocks:199`), tool-call cards via `<details>` (`ToolPartCard:331`), proposal/confirmation cards (`ProposalCard:344`), a thread rail with raw `overflow-y-auto` (`OpenBooksAIChat.tsx:497`/`:814`), and a raw `<select>` for provider/model (`OpenBooksAIChat.tsx:762`). It also renders a user-facing vendor label "Bedrock active" / "Degraded mode" (`OpenBooksAIChat.tsx:758`) — a redesign decision (keep vendor wording or neutralize to "AI active").
- **Composes:** introduce **AI Elements** primitives (`Conversation`, `Message`, `Response`, `Reasoning`, `Tool`) — none exist today (`apps/web/package.json` declares no `ai`/`@ai-sdk/*`/`ai-elements`; the AI stack lives in the **root** `package.json` Convex workspace). The streaming engine stays `@convex-dev/agent/react` (`useUIMessages`/`useSmoothText`, `OpenBooksAIChat.tsx:570`/`:317`); AI Elements provide only the **presentation** layer wired to those messages. Tool/proposal cards move from `<details>` to `Collapsible`/`Tool`; the model picker moves from raw `<select>` to shadcn `Select`; results move from inline strings to `toast`. `Sparkles` affordance stays brand green (DS rule — never purple).
- **Missing primitives:** **AI Elements** (`Conversation/Message/Response/Reasoning/Tool`), **`collapsible`** (tool cards), **`scroll-area`** (message + thread lists), **`sonner`** (action results), real **`select`** (model picker), real **`popover`** (reasoning).
- **Key props (current):** `contextLabel`, `reportPack`, `aiStatus`, `workspaceId`, `pendingPrompt`, `onClose`, plus a `mode: "drawer"|"page"` already implied by `AskAIScreen` vs `AppShell` mounts.
- **Responsive:** right-side panel `w-[380px]` ≥ `lg`; bottom sheet `h-[88dvh]` on mobile (`AppShell.tsx:466`/`:492`); full page on `/ask-ai`.
- **Target file:** refactor `openbooks/OpenBooksAIChat.tsx`; introduce AI Elements under `apps/web/src/components/ai-elements/`.
- **Consumers:** `Dashboard, Transactions, Income, Bills, Reports, AskAI, Shell` (audit). Cross-surface open via the existing `openbooks:ask-ai` CustomEvent (`AppShell.tsx:221`).

---

### 5.15 Consumption matrix (component → surfaces)

Derived from the audit `componentsNeeded`. ✓ = surface consumes the component.

| Component | Dash | Inbox | Txns | Income | Exp | Bills | Contacts | Payroll | Reports | Settings | AskAI | Shell |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WorkbenchPage | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| PageActionBar | | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ |
| DateRangeControl | ✓ | | ✓ | ✓ | ✓ | | | ✓ | ✓ | | ✓ | ✓ |
| FilterBar | | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| AccountMultiSelect | | | ✓ | ✓ | ✓ | ✓ | ✓ | | | | ✓ | ✓ |
| KpiStrip | ✓ | ✓ | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | |
| OpenBooksDataTable | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| DetailSheet | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| AiInsightBadge | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ | |
| EvidenceUpload | | ✓ | ✓ | | ✓ | ✓ | | | | | | |
| ExportMenu | | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| AttentionState | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | | ✓ |
| CommandPalette | ✓ | | ✓ | | | ✓ | ✓ | | ✓ | | ✓ | ✓ |
| AskAIWidget | ✓ | | ✓ | ✓ | | ✓ | | | ✓ | | ✓ | ✓ |

### 5.16 Sequencing note

The two components that pay back fastest are **OpenBooksDataTable** (consumed by 10 surfaces, eliminates the worst drift — shadcn `Table` vs. raw `grid` vs. `Card`-rows — and is where the row-detail-closed-by-default and AttentionState rules land) and **AttentionState** (consumed by 11 surfaces, and the carrier for the `--negative`/chart-token cleanup that removes the raw-red and off-palette-`DOTS` violations). Both should ship before the surface refactors so each large file (`CoreScreens.tsx` 1235 LOC, `ModuleScreens.tsx` 1921 LOC, `ReportsScreen.tsx` 1307 LOC, `IncomeScreen.tsx` 675 LOC) can delete its inline table/filter/status code rather than port it.

---

## 6. Page-By-Page Redesign Proposal

Direction per surface: better than the prototype where it helps, but always within the OpenBooks design system, table-first on data-heavy screens, with row detail closed by default. Each surface lists the shared components it consumes and the IA boundary (which workflows live here vs. elsewhere).

### 6.1 Dashboard

Rebuild as an operator command center, not a metric collage. Header: collapse to ONE PageHeader title 'Dashboard' with a quiet entity sub; delete the in-body 'Operating snapshot' card, the duplicate entity name + 'ledger-backed books', the 'Demo entity' chip, and the 'A/R and A/P'/'Ledger lines' jargon (use 'Money owed to you' / 'Money you owe'). Move the period control to header-right as a DateRangeControl: presets (This month, Last month, Last 3 months, YTD) plus a custom range whose calendar disables future dates; selection drives every period-sensitive widget via the `period` arg the query already accepts (CoreScreens.tsx:57-60). Cash hero (full width, top): large Geist Mono tabular cash total + Sparkline (data in cashSparkline, coreViews.ts:244) + a flex-wrap row of connected-account chips with bank logo, masked number, balance, and a stale-sync warning + reconnect link when an account is behind. Then a 3-up KpiStrip-driven actionable grid where each card is a single click target into the matching workbench carrying the active period: P&L snapshot (income/expense/net + 6-mo in/out mini-bars + delta), 'Where money went' donut+legend (real donut from expensesByCategory, full category names), and Inbox (open count + kind chips + 'Open inbox' button, with a 'books up to date' zero-state). Second row: Money owed to you (total + 4-bucket aging bar via the existing AgingMiniBar primitive + named overdue invoices), Money you owe (total + next bills), Payroll (last/next + FX currencies). Third row: Income-by-customer share bars + concentration-risk note, and Cash flow in/out bars + net insight. Add a forward-looking 'Coming up (next 30 days)' card and a compact Books-health/cushion card where backing data can be derived. Close with the Activity feed using typed lucide icons (AI=Sparkles green, payout, invoice, rule, payroll). Respect IA: cards never duplicate truth — each links into the universal Transactions register or the Income/Expenses/Bills lens for the same period; the Dashboard only summarizes.

**Shared components consumed:** `WorkbenchPage`, `KpiStrip`, `DateRangeControl`, `DetailSheet`, `AiInsightBadge`, `AttentionState`, `AskAIWidget`, `CommandPalette`

**Workflows that live here (IA boundary):**

- Glance: a single-screen operator read of cash position, account sync health, profit, inbox load, money owed/owing, payroll, and what's coming up — summary only, never the system of record.
- Drill-through routing: every tile is an actionable link that opens the correct workbench carrying the dashboard's active period filter (cash -> Transactions register; net/P&L -> Reports profit-and-loss; spend -> Expenses lens; owed-to-you -> Income/receivables; you-owe -> Bills; payroll -> Payroll). The Dashboard initiates these workflows but does not host them.
- Period scoping: choosing a date range re-scopes the summary; the same range semantics must reconcile with Reports and the Income/Expenses lenses (number-consistency rule).
- Triage entry point: the Inbox card surfaces the open exception count and opens the Inbox — but the actual J/K/E triage workflow lives on the Inbox surface, not here.
- Does NOT live here: editing/categorizing transactions (Transactions/Inbox), invoice/bill CRUD (Income/Bills), running payroll (Payroll), or full report viewing/export (Reports). The Dashboard must not become a second register or duplicate financial truth across tabs.

### 6.2 Inbox

Rebuild Inbox as a focused exception-resolution queue, not a generic 2-pane CRUD. LAYOUT: keep master-detail on desktop (a ~340px list rail using ScrollArea + a fluid detail), but make the list track flexible (minmax(300px,360px)) and on mobile render the detail in a Sheet/drawer (reuse AppShell's 88dvh bottom-sheet pattern, AppShell.tsx:495) triggered on row select, with a back affordance. HEADER: progress strip ('N to review · M cleared today') + a smart batch banner that appears only when ≥2 items are ≥0.90 confidence ('Confirm 4 high-confidence items'). LIST: GROUP by work type with sticky section headers + counts in the prototype's order (Needs category, Receipts, Possible transfers, Payout issues, Connections, AI questions); each row shows a kind icon tile, merchant + tabular amount (income tone for money-in), and a threshold-colored ConfidenceRing for categorize rows; native checkbox -> shadcn Checkbox for batch select. DETAIL: a per-kind card component keyed off item.kind (six variants). Categorize: merchant/raw/amount header, AI-suggested category as a Combobox pill, collapsible 'Why this' (reason + 2-3 similar transactions + decided-by provenance), inline Split, and a pre-confirm 'Always do this — create a rule' Checkbox; Confirm posts via the single ledger mutation. Receipt: robust 2-col receipt-vs-candidate compare with truncate+min-w-0 on every value and a real thumbnail slot. Transfer: two account rows with 'same amount, opposite direction' connector + 'moves money between accounts, no P&L impact' note. Payout: gross/fee/expected/received/difference table + the dispute-fee explanation. Connection: reconnect CTA. Question: prompt + candidate rows + Yes/No/Other chips. Every card states WHY it needs attention and the plain-English ledger impact, with a sticky action bar so buttons never wrap into content. Keep J/K/E/Enter; add Cmd+Enter for batch-confirm. Remove the raw 'payout_mismatch'/'connection' kind strings from copy; use owner-language section labels. Backend (coreViews.inbox) must be extended to return transfer pairs, payout breakdown lines, connection status, and question candidates so the detail cards have real evidence.

**Shared components consumed:** `WorkbenchPage`, `OpenBooksDataTable`, `DetailSheet`, `AttentionState`, `AiInsightBadge`, `EvidenceUpload`, `KpiStrip`

**Workflows that live here (IA boundary):**

- Resolving AI-uncertain items is the Inbox's sole job: categorize-with-confirm, receipt-to-transaction match, transfer-pair confirmation, Stripe payout-mismatch acceptance, broken-connection reconnect, and answering AI questions — these are the six card types and belong ONLY here (the only mandatory workflow)
- Creating a rule from a confirmed categorization ('Always do this') lives here as a pre-confirm affordance, then surfaces in Settings > Rules — not duplicated
- Splitting an uncertain transaction lives here inline; the resulting record is still one Transactions-register row, never duplicated to Income/Expenses
- Confirm/exclude/post actions originate here but post through the single ledger mutation; the posted record then appears in Transactions (universal register) and is reflected as a lens in Income/Expenses — Inbox never owns the record after resolution
- Bulk reviewing all transactions, editing already-posted entries, or browsing history does NOT belong here — that is the Transactions register; Inbox only holds items with status='open' (coreViews.ts:308-310)
- AR/AP aging, invoice/bill creation, and reports do NOT belong here even when an Inbox item references a bill/receipt; the Inbox links out to Bills/Reports rather than embedding those workflows

### 6.3 Transactions

Make Transactions a true full-width register. (1) Add a real PageHeader: title "Transactions", subtitle "Every account, one register · {entity}", and right-aligned actions Import, an ExportMenu (CSV all / filtered / selected / audit log), and a primary green "Add transaction". (2) Replace the permanent 380px aside with a shadcn Sheet/DetailSheet that opens ONLY on row click (selection must NOT default to row 0 — remove the `?? data.rows[0]` fallback at CoreScreens.tsx:746). Default view is the table at full content width. (3) Build a FilterBar above the table: AccountMultiSelect (account pills/chips), DateRangeControl, and selects for amount direction (money in/out), type, category, contact, source (bank/Stripe/manual), receipt (has/none), AI status + confidence band, and a one-click "Needs attention" toggle (review===needs_review OR hasInboxItem). Keep the AI-assisted search hint. This requires extending coreViews.transactions args + row shape to return contactId/contactName, reasoning, receipt-present, hasInboxItem (already there), and per-row reconciliation/ledger state. (4) Columns: Date (Geist Mono), Merchant (+raw subline + paperclip-if-receipt + a quiet green Sparkles AiInsightBadge popover exposing reasoning/decidedBy/confidence), Category (chip; needs-review tinted warning not red), Contact, Account (logo chip + mask), Amount (right, Amount component — income green, expenses neutral), Status (plain-English chip), and a ledger/reconciliation state dot. (5) Bulk: a contextual green bulk bar on selection with Approve selected, Recategorize, Exclude, Clear — and explain that confident items already auto-posted. (6) In the Sheet: big signed amount, Category/Account/Contact/Status/Source grid, attach-receipt + Ask-AI-to-categorize -> review-before-post (confirm before reverse+repost), receipt preview, collapsible Accounting view (journal lines, "entries always balance"), Activity/History, Create-rule, Exclude, and Approve & post. (7) Mobile: reflow rows to a card/list (merchant, amount, date, status) and open the Sheet as a bottom-to-side overlay, never the squeezed desktop table. Remove developer copy ("through the pipeline", raw enums); keep one brand green, neutral expenses, tabular figures.

**Shared components consumed:** `WorkbenchPage`, `OpenBooksDataTable`, `FilterBar`, `DateRangeControl`, `AccountMultiSelect`, `DetailSheet`, `ExportMenu`, `EvidenceUpload`, `AiInsightBadge`, `AttentionState`, `AskAIWidget`, `CommandPalette`

**Workflows that live here (IA boundary):**

- The universal register: every posted/pending money-moved record across ALL accounts and sources (bank/Stripe/manual/CSV) in one dense table — this is the canonical list; Income and Expenses are lenses over the same rows and must reconcile, never own a record.
- Review-and-approve uncertain items inline (the items that fell below the autonomy threshold) and bulk approve/exclude — overlapping with Inbox but here in spreadsheet form across the full register.
- Recategorize a single transaction (reverse + repost) and split a transaction across categories, with review-before-post.
- Per-transaction evidence: attach a receipt, view the matched receipt, and trigger Ask-AI-to-categorize from the selected row.
- Inspect the hidden ledger for one transaction (Accounting view: the balanced journal entry) and its audit/activity history + comments.
- Manual transaction entry and CSV/OFX import as entry points (today buried as side cards; should move to header Import/Add actions).
- Export the register (CSV: all / current-filter / selected / audit trail).
- NOT here (lives elsewhere): invoices/receivables/customers/collections (Income), category/vendor/spend analytics and recurring cost breakdowns (Expenses), accounts-payable bill workflow (Bills), period reports/statements (Reports), contact CRUD (Contacts), and bank-connection management (Settings/Connections). The reconciliation status strip may appear here but the connect/reconnect action belongs to Connections.

### 6.4 Income

Make Income an honest revenue LENS, not a sibling silo. Keep the 24px title + plain-English subtitle and a 4-card KpiStrip, but evolve KPIs to: Received (this period), Open + Overdue receivables (one card, two figures), Avg days to pay (realized once payment dates exist; label net-terms until then), and Recurring revenue / MRR (new) with a Sparkline trend so the strip stops being static. Replace the bespoke segmented control with a shared Tabs primitive exposing five views: Payments, Invoices, Customers, Streams, Receivables. Above the tabs add a shared FilterBar + DateRangeControl + Account/CustomerMultiSelect that drive every view and the KPIs (kill the frozen MONTH_START/TODAY constants; pass an explicit range to incomeViews). Resolve the IA decision visibly: every Payments row must drill into the SAME record as Transactions — open a shared DetailSheet for that transaction (or deep-link /transactions?focus=<id>) using the txn._id already in incomeViews.ts:113; add a 'View in Transactions' link so the user sees one record, richer view. Add charts via existing/new primitives: revenue by Stream (bar), revenue by Customer (bar), Recurring vs one-time (split), and an AR aging bar on Receivables — all using --chart-1..5 tokens, no ad-hoc orange. New Customers tab = per-customer received + open balance + last-paid, rows open the contact; new Streams tab = revenue grouped by income ledger account (reuse reportViews grouping so it reconciles with the P&L revenue section). Tables: table-first, dense, tabular money, sticky header, horizontal-scroll wrapper on desktop and a card-list fallback on mobile for the 6-7 column tables; row-detail stays CLOSED by default (preserve the good detailId-null pattern). Route ALL reds through --negative/--negative-surface, blues through --info, drop raw red-/blue- utilities; swap the raw <select> for shadcn Select; restore the dropped 'Download PDF' invoice action. Copy: soften 'Receivables' to 'Money owed' (keep an Accountant alias), keep AI affordances quiet/green.

**Shared components consumed:** `WorkbenchPage`, `KpiStrip`, `OpenBooksDataTable`, `FilterBar`, `DateRangeControl`, `AccountMultiSelect`, `DetailSheet`, `ExportMenu`, `AiInsightBadge`, `AttentionState`, `AskAIWidget`

**Workflows that live here (IA boundary):**

- Reviewing money received as a revenue lens (payments + reconciled Stripe payouts) — but each row must drill into the SAME transaction record owned by Transactions, never a duplicate
- Invoice lifecycle / accounts-receivable IN: create (composer), finalize, send via Stripe, send reminder, void, download PDF — this AR workflow legitimately lives here, not in Transactions
- Collections: aging matrix + overdue follow-up (the 'money owed' view), with drill from a customer to their balance and from a cell to the underlying invoices
- Revenue analytics: by stream (income category), by customer, recurring vs one-time, MRR trend — read-only lenses that must reconcile with the Reports P&L revenue section
- NOT here (belongs elsewhere): re-categorizing or excluding a received payment (that is the Transactions register + Inbox); customer master-data editing (Contacts); the canonical journal-line truth and exports (Reports); uncertain/needs-review items (Inbox). Income reads and presents; the ledger mutation and the universal register stay authoritative.

### 6.5 Expenses

Make Expenses a true cost LENS over the same posted records, table-first, matching Transactions/Income parity while staying a lens (never a second store). Layout: PageHeader ("Expenses" / "Where money goes, by category and vendor") + a shared DateRangeControl (preset + custom range, never defaulting to a future period) and AccountMultiSelect, replacing the 2-segment toggle. KpiStrip (5 tiles, tabular figures, neutral tone): Spent this period, Recurring spend /mo, Uncategorized count (clicks to filtered table), Missing-evidence count (expenses with no receipt), Top vendor (or Top category). The last three need new backend fields on expensesViews.overview (uncategorizedCount, missingEvidenceCount, topVendor) — currently absent (expensesViews.ts:266-274). Tabs (shadcn Tabs, already present): Transactions (the default — a full expense table: date, merchant, category Select, account, evidence chip, amount right-aligned, money-figures; row-detail CLOSED by default, opening a DetailSheet only on selection, mirroring CoreScreens.tsx:1048), Categories (keep the current breakdown but drive dots from --chart-1..5 tokens, swap ▲/▼ for lucide TrendingUp/Down, link each row to the filtered Transactions tab and to Reports P&L to prove number agreement), Vendors (new ranked vendor table with spend + recurring flag), Recurring (keep detection list; add a small Sparkline recurring-trend), Evidence Needed (expenses missing a receipt, with EvidenceUpload affordance). Charts: a by-category bar and by-vendor bar from primitives.BarChart using chart tokens; an unusual-spend callout for the biggest mover (quiet, amber warning not red). Filters are shared and persist across tabs. Copy to remove/keep: keep plain-English labels; remove ▲/▼ glyphs; ensure ordinary expense amounts stay neutral (already correct). Reuse the FilterBar/KpiStrip/OpenBooksDataTable/DetailSheet shared components so Expenses, Income, and Transactions share one register implementation rather than three bespoke ones. Hard constraint: category totals must continue to reconcile to the P&L (already enforced via debit-credit in expensesViews.ts:75-98) and the table must read the same journal-line-backed records, never a parallel list.

**Shared components consumed:** `WorkbenchPage`, `KpiStrip`, `OpenBooksDataTable`, `FilterBar`, `DateRangeControl`, `AccountMultiSelect`, `DetailSheet`, `ExportMenu`, `EvidenceUpload`, `AttentionState`, `AiInsightBadge`

**Workflows that live here (IA boundary):**

- BELONGS HERE: viewing expense spend as a cost lens — by category, by vendor, recurring, and evidence-needed — over the same posted transactions (a lens, not a separate store; backend already derives from journalLines per expensesViews.ts:75-98).
- BELONGS HERE: a full expense transaction table filtered to outflow/expense-account records, with inline re-categorize (which must reverse+repost via the ledger, same path Transactions uses at CoreScreens.tsx:1020/798-812), and drill into a single expense's detail sheet.
- BELONGS HERE: creating/managing expense categories (AddCategoryModal) and surfacing missing-evidence (receipts) for expenses, with upload.
- BELONGS HERE: spend analytics specific to costs — top vendors/categories, recurring-spend forecast, unusual-spend (biggest mover) callout.
- DOES NOT belong here (stays in Transactions, the universal register): the canonical editable list of ALL transactions across income+expense, CSV/manual import, bulk exclude, reconciliation — Expenses only re-presents the expense subset.
- DOES NOT belong here (Bills): the accounts-payable workflow (money that WILL move out) — bill creation, matching, mark-paid. Expenses shows posted cost, not AP scheduling.
- DOES NOT belong here (Reports): the authoritative P&L; Expenses links to it and must agree, but does not own statement generation.
- DOES NOT belong here (Inbox): triage of uncertain items — the uncategorized/needs-evidence KPIs here should deep-link INTO Inbox/the filtered table, not re-implement triage.

### 6.6 Bills

Rebuild as a single Accounts Payable workbench inside the shared WorkbenchPage frame. (1) Header: title "Bills" + one-line subtitle only; primary actions "Add bill" and "Upload bill" (Upload reuses the 2-path chooser from the prototype: PDF→AI-extract-and-confirm vs manual form, replacing today's manual-only AddBillModal). (2) KpiStrip with six tiles: Open total, Overdue, Due soon (next 7d), Paid this period, Missing evidence (count of open bills with no linked document), Avg days to pay — compute the three missing metrics in moduleViews.ts alongside existing kpis. Overdue uses --negative, due-soon uses --warning (#b54708) per prototype; the rest neutral. (3) FilterBar: status (open/overdue/due-soon/paid), vendor (AccountMultiSelect-style), due-window, source (manual/PDF/recurring), and an "evidence: missing" toggle, plus free-text search and an ExportMenu (CSV == on-screen values). (4) One OpenBooksDataTable, not four group Cards: columns vendor, bill #, due date (with relative "in 3d"/"5d overdue"), amount (right-aligned tabular), status chip, category, evidence (paperclip if document linked, "missing" otherwise), payment match (matched txn or "expected"), source, AI confidence ring — keep dense; default sort overdue→due-soon→later→paid then by dueDate. Group affordance can become a sticky sub-header or a saved view rather than four cards. (5) DetailSheet drawer, CLOSED by default, opening only on row click: header vendor+amount+status; sections for evidence preview (EvidenceUpload to attach if missing), extracted fields with per-field AI confidence (port the green/amber underline pattern), payment schedule + matched bank txn, ledger impact (the AP journal lines from entryIds — AI proposes, ledger posts), and approval/posting history. Primary action in the drawer = "Mark paid & match" (reuse BillMatchPicker). (6) Delete the persistent half-empty side panel and the three boilerplate paragraphs; swap the raw <select> for shadcn Select; render via Table not divs. Keep it strictly a payable workflow — no revenue/transaction duplication.

**Shared components consumed:** `WorkbenchPage`, `KpiStrip`, `OpenBooksDataTable`, `FilterBar`, `AccountMultiSelect`, `DetailSheet`, `ExportMenu`, `EvidenceUpload`, `AiInsightBadge`, `AttentionState`, `AskAIWidget`, `CommandPalette`

**Workflows that live here (IA boundary):**

- Accounts-payable lifecycle: add a bill (manual or PDF-extracted), track it as a posted payable, and mark it paid by matching to a bank transaction — this is THE workflow that belongs only on Bills (createBill/markPaid in convex/bills.ts).
- Bill evidence capture: upload a bill PDF, AI-extract vendor/amount/due/category, confirm, and attach the document to the payable (the receipt-upload mechanics currently shared with Expenses should narrow to bill-evidence here).
- AP aging / due-window triage and 'missing evidence' cleanup as filterable views over the same payables.
- Per-bill ledger-impact and posting/approval review (read-only view of the AP journal lines from entryIds).
- NOT here: the bank-side payment transaction itself lives in Transactions (the universal register) — Bills only references/matches it, never owns or duplicates it. Spend analytics, vendor totals, and expense categorization belong to the Expenses lens, not Bills. Recurring-payee management belongs in Contacts; Bills may surface an AI 'recurring but untracked' suggestion but the payee record lives in Contacts. Reports' AP aging must reconcile to Bills' numbers but is generated from posted journal lines in Reports, not recomputed here.

### 6.7 Contacts

Make the directory the surface. Replace the boxed ModuleIntro with a plain PageHeader (title 'Contacts', one-line subtitle 'Customers and vendors, one directory — most created automatically') plus a primary 'Add contact' action that actually opens a create form. Render the directory FULL-WIDTH (max-w-1200) as a single dense table; remove the permanent profile column and the empty-pane card entirely. Add a thin KpiStrip above the table (e.g. Open A/R total, Open A/P total, contacts count, overdue-AR count) only if it reconciles with Income/Bills lenses. Filters: a FilterBar of segmented role pills (All / Customers / Vendors — gated to those two until schema adds employee/contractor) plus quick toggles for Open AR, Open AP, and Recently active, and a search over name+aliases+email. Drop 'recurring/employees/contractors' until the data model supports them; do not fake them. Table columns: avatar+name (with alias sub-line and tooltip), role chips (Title-case, customer=green, vendor=neutral), Money in YTD, Money out YTD, Open balance (with a quiet overdue marker using --negative + lucide AlertCircle only when AR is past due), Last activity (surface the already-computed lastActivity), and a default-category/rule chip. Row click opens a right-side DetailSheet (shadcn Sheet), CLOSED by default — not a permanent pane. The sheet header carries avatar, name, role chips, and a Stripe badge (Stripe blurple allowed only on the Stripe chip); below it three KPIs (Lifetime, They owe you / You owe them, Avg), then DetailSheet tabs: Activity (invoices+payments or txns+bills), Aliases, Rules (the default-category-as-rule affordance, shown only when a category is set, quiet green Sparkles), and Notes (editable). Add real Merge-duplicates (alias-similarity AI suggestion as a quiet inline banner with Merge / Keep separate) and an Archive action — decide soft-archive over hard delete to preserve ledger references (posted journal lines reference contactId), so add an `archived` flag to the schema rather than deleting. Keep all money in Geist Mono tabular, expenses neutral, AR-overdue the only red.

**Shared components consumed:** `WorkbenchPage`, `KpiStrip`, `OpenBooksDataTable`, `FilterBar`, `AccountMultiSelect`, `DetailSheet`, `ExportMenu`, `AiInsightBadge`, `AttentionState`, `CommandPalette`

**Workflows that live here (IA boundary):**

- Browse/search/filter the unified contact directory (customers + vendors) — the canonical place to find a payee or payer
- View a single contact's profile: lifetime totals, open AR/AP, activity history, aliases, default-category rule, notes (in a DetailSheet, not a permanent pane)
- Create/edit a contact and set its default-category rule (vendor auto-posting affordance)
- Merge duplicate contacts (alias-driven) and soft-archive a contact
- NOT here: per-invoice AR aging, collections, and customer revenue analytics — those are the Income lens. NOT here: per-category vendor spend analytics and recurring spend — those are the Expenses lens. NOT here: the raw posted register — that is Transactions (the universal register). Contacts links INTO those surfaces (e.g. 'view this contact in Income/Expenses/Transactions') but must not duplicate their financial truth; AR/AP figures shown here must derive from the same invoices/bills the Income/Bills lenses use so they reconcile.

### 6.8 Payroll

Keep PayrollScreen as a WorkbenchPage with a persistent KPI strip + tabs + period selector that never destroys the list. Replace the dead StatCard strip with a real KpiStrip: "Payroll this period" (base-currency total of the active period's run, or the projected draft if none), "Next run / due" (derived from period + a stated cadence), "People paid" (employees vs — once modeled — contractors), and "Unmatched" (approved-but-unsettled lines awaiting bank match). Add an honest "Auto-run: off" affordance with copy like "Runs are drafted manually from active salaries" so Ansar's provenance question is answered in-product; gate any "taxes/withholding" and "contractors" KPI behind a quiet "coming soon" rather than faking data the schema lacks. Convert the Button-group tabs to shadcn Tabs (underline active, brand green) named People, Runs, Statements (defer Contractors/Rules until the data model supports a workerType field and a rules engine — do not ship empty tabs). Add a period selector (month/quarter/custom) in the header that scopes BOTH the Runs list and Statements, so "statement selection" stops being static; the Run-payroll button should draft the SELECTED period, not a hardcoded 2026-06. Make run rows use a shared OpenBooksDataTable with semantic status chips (Draft neutral, Approved info-blue, Paid green) and restore the by-currency breakdown column. CRITICAL: row detail must be CLOSED by default — selecting a run opens a DetailSheet (right-side) or inline expansion showing the Review→Approve→Mark-paid stepper + editable grid, while the runs list and KPI strip stay on screen; do not full-screen-swap. Wrap the editable grid in a responsive card-per-row layout on mobile (label/value stacks) instead of a horizontal-scroll table. Replace the raw paid checkbox with a shadcn Checkbox/--primary, and format all money through Amount (kill the localMinor/100 float string at 1194). Fix run.headcount to read the run's own snapshot lines. Add the 12-month USD-equivalent trend to Statements via the existing BarChart primitive.

**Shared components consumed:** `WorkbenchPage`, `KpiStrip`, `OpenBooksDataTable`, `FilterBar`, `DateRangeControl`, `DetailSheet`, `ExportMenu`, `AttentionState`

**Workflows that live here (IA boundary):**

- Belongs HERE: managing the employee/people roster (add/edit/deactivate salary, currency, country, pay method) — this is the source for run line generation.
- Belongs HERE: drafting a pay run for a period, reviewing/adjusting per-person amounts + FX, approving (which posts the single payroll-expense ledger entry via approveRun), and marking lines paid (settlement).
- Belongs HERE: viewing/exporting period statements (run-scoped and period-scoped) and the payroll spend trend.
- Belongs HERE (future, once modeled): importing a payroll register, contractor vs employee classification, and payroll rules.
- Belongs ELSEWHERE — the actual outgoing bank payments are Transactions (the universal register); Payroll does NOT own those rows, it MATCHES against them. The approved payroll expense and FX gain/loss are journal lines surfaced in Reports and as Expenses-lens category totals, not duplicated as editable money in Payroll.
- Belongs ELSEWHERE — 'Recurring contractor payment may be payroll' triage is an Inbox question card (seedDemo.ts:1100), resolved in Inbox, not re-litigated on the Payroll surface.
- Belongs ELSEWHERE — payroll expense totals must reconcile to the P&L expense section in Reports and the Expenses lens; Payroll must not become a second source of truth for those numbers.

### 6.9 Reports

Keep the home-grid then shared-viewer model (matches the prototype and reportsContract). Fixes in priority order: (1) Solve the AI-squeeze structurally, not per-report. Make the docked AI panel an OVERLAY on the right (fixed/sticky over the content with a scrim, or let it push the page to horizontal scroll) rather than a flex sibling that steals 380px from main. Target: with AI open, P&L/GL never drop below a legible money layout; on under ~1100px effective width, dense tables collapse to a stacked label/value card list. (2) Make drill-through real: clicking a money cell should route to the register filtered by account+date range — add account=/category=/start=/end= params to TransactionsScreen (and the Income/Expenses lenses) and have MoneyButton router.push there, keeping the in-page DrillSheet as a quick-peek but adding an Open in Transactions action in its footer. Respect IA: drill lands in Transactions (universal register) by default; income rows can route to the Income lens, expense categories to the Expenses lens. (3) Fix dashboard consistency: have ReportsScreen read period= (map to start/end) in addition to start/end so dashboard drill-throughs land on the right month. (4) Persist toolbar state across report switches (basis/compare/columns) instead of hard-resetting (1169-1172); keep the future-clamp. (5) Restore the Close the books banner + checklist on Reports home (prototype 30-48,433-477), wired to the existing period-lock. (6) Token cleanup: replace bg-teal-600/bg-amber-500/bg-amber-100 with chart/warning tokens, swap unicode checkmark and arrows for lucide Check/ArrowRight, use the negative token for cash-flow outflow bars. (7) Restore Payroll Summary multi-currency + headcount + FX note. Keep drill default-CLOSED (already correct). Keep the green Explain affordance and net-profit green band (on-brand).

**Shared components consumed:** `WorkbenchPage`, `KpiStrip`, `OpenBooksDataTable`, `FilterBar`, `DateRangeControl`, `DetailSheet`, `ExportMenu`, `AiInsightBadge`, `AskAIWidget`

**Workflows that live here (IA boundary):**

- Choosing and viewing a report (home grid then shared viewer) — lives HERE.
- Period/basis/compare/column selection for a report — lives HERE (DateRangeControl + toggles).
- Reading ledger-backed statements (P&L, Balance Sheet, Cash Flow, Trial Balance, GL, Journal) — lives HERE; pure read views over journalLines.
- Quick-peek at the journal lines behind a number (DrillSheet) — lives HERE, but the authoritative work-the-records action hands OFF to Transactions/Income/Expenses via drill-through; it must not duplicate register editing here.
- Explain-via-AI for the current report — lives HERE (dispatches to the shared docked AI panel; the panel is Shell-owned).
- Export CSV/print of the on-screen report — lives HERE.
- Close-the-books / period lock entry point — SHOULD live HERE per prototype (currently in Settings/Audit via ModuleScreens.tsx).
- Acting on individual transactions/invoices/bills (recategorize, match, pay, edit) — does NOT live here; belongs in Transactions, Income, Expenses, Bills. Reports only links out.
- Customer/vendor concentration insight is shown HERE (Income by Customer / Expenses reports), but managing those contacts lives in Contacts.

### 6.10 Settings

Keep the 10-section IA but make it product-grade. (1) Sticky subnav: wrap the desktop `<nav>` in `lg:sticky lg:top-[72px] lg:self-start lg:max-h-[calc(100vh-88px)] lg:overflow-y-auto` so it pins under the 56px header while the content column scrolls; this directly answers Ansar. Group the 10 items under quiet eyebrow labels (Workspace: Businesses, Tax; Automation: AI, Rules, Categories; Connections; People: Team, Notifications; Data: Data, Audit). (2) Drop the redundant per-section h2 (SettingsScreen.tsx:210-213) — the subnav already names it; keep only the one-line description. (3) Connections: replace the two debug consoles with owner-facing connection cards — one row per bank/Stripe account showing logo badge, 'Connected · synced 12 min ago' or 'Sign-in expired' status pill, and a SINGLE primary action (Reconnect / Connect a bank / Manage). Move all Validate/Seed/Sync/Simulate/checklist/integration-notes machinery behind an 'Advanced / sandbox tools' Collapsible (or an admin-only dev drawer), default closed. (4) AI: keep provider/key-state/chat-model summary + the three autonomy radio cards + the spend meter (these are owner-legible). Demote 'Batch runs' and 'Categorization eval' tables (AiSection.tsx:210-252) into a single collapsed 'Diagnostics' disclosure or move to Audit — out of the default AI view. (5) Tables: make Audit a real responsive table — on desktop a 3-col grid but with `min-w-0 truncate` action cells and the columns set to `auto auto minmax(0,1fr)`; on narrow/mobile reflow each row to stacked label-value pairs (no horizontal scroll). For Stripe payout detail, render the line table as reflowing rows below md, never overflow-x. (6) Rules: keep the table but move edit/delete into a row-hover action cluster or a `⋯` menu so the row doesn't pack 9 controls; row detail (conditions + 90-day preview) stays CLOSED, opening in the existing Dialog or an inline expand on selection. (7) Swap all hand-rolled toggles for shadcn Switch and raw checkboxes for Checkbox; route every hardcoded green/red/blue/gray hex through --primary / --negative / --info / --muted-foreground tokens; fix the BusinessesSection magenta avatar (#a4148c) to chart-palette tokens. (8) Money everywhere stays Geist Mono tabular (money-figures) — already applied.

**Shared components consumed:** `WorkbenchPage`, `FilterBar`, `OpenBooksDataTable`, `DetailSheet`, `AttentionState`, `AiInsightBadge`, `ExportMenu`

**Workflows that live here (IA boundary):**

- Workspace identity & books config: add/archive businesses, fiscal year, accounting basis, tax identity (Businesses + Tax sections) — belongs here, not on workbench screens.
- Connecting money sources: Plaid bank link, Stripe test mode, CSV/OFX import entry-point — lives in Connections (the importer itself opens at /transactions, ConnectionsSection.tsx:113, so the heavy import UI belongs on Transactions, not Settings).
- AI configuration: provider/key state, autonomy threshold (the single shared AI_AUTONOMY_THRESHOLDS constant), spend visibility — belongs here; per-transaction AI decisions belong in Inbox.
- Automation authoring: Categories (chart of accounts in plain clothes) and Rules (top-down, first-match) creation/reorder/test — belongs here; applying a one-off recategorization belongs on Transactions/Inbox.
- People & access: team invites and roles, notification preferences — belongs here.
- Data ownership & audit: exports (CSV bundle / JSON / General Ledger), demo-data reset, danger zone, and the audit log — belongs here. NOTE the audit log is read-only ledger provenance; the live financial register is Transactions, and any per-record drill-through should deep-link to Transactions, never duplicate the register inside Settings.
- Does NOT belong here: the Plaid/Stripe sandbox test consoles (Validate/Seed/Sync/Simulate) are developer/verification workflows and should be quarantined to an Advanced disclosure or a dev-only surface, not the owner's default Connections view.

### 6.11 Ask AI

Rebuild the chat body on AI Elements over shadcn/ui: Conversation+Message for the transcript, Response (streamdown) replacing the regex markdown parser, PromptInput for the composer, Suggestion for prompt chips, Tool for tool-call disclosure (drop native <details>), and add Sources for citing the journal lines/reports an answer drew from (reinforces 'AI proposes, ledger is truth'); optional Reasoning and Actions (copy/retry/open-source). Keep the existing Convex-agent streaming wiring untouched — useUIMessages({stream:true}), useSmoothText, optimisticallySendMessage, api.aiThreads.* and api.proposals.* — and adapt UIMessage parts into AI Elements message parts. Keep the propose→confirm ledger card as a first-class Tool/Actions render, never auto-posting. REMOVE all provider/vendor wording: replace the 'Bedrock active' badge with a quiet capability state — an unobtrusive 'AI off' chip only in degraded mode, nothing in the active state (delete the badge at :758, AskAIScreen.tsx:45, ModuleScreens.tsx:1568; relabel ai.ts:143 to provider-agnostic). Implement four modes off ONE component: (1) collapsed — a Sparkles icon button added to CollapsedRail so AI is reachable when the sidebar is iconified; (2) docked side panel — default 380px but resizable (drag handle, min 360/max ~560) and offer an overlay-vs-push toggle so dense Reports/Transactions tables aren't crushed; (3) expanded workspace — the /ask-ai full page, but drop the redundant outer PageHeader and let the chat own its chrome, with a real conversation switcher (Command/Combobox, not native <select>) and an optional Sources/artifacts canvas; (4) mobile drawer — a purpose-built Sheet with a compact single-row header (no hidden controls) and a thread switcher reachable on mobile. Make it context-aware: have each workbench (Income/Expenses/Transactions/Bills/Reports) dispatch createAiRequestEvent with its active entity + date range + filter chips so 'Viewing: {label}' becomes a real scoped context, not a year-wide pack. Use tokens (--primary/--ob-green) not hex; quiet grey user bubbles per prototype; tabular money in answer tiles; one consistent thread switcher across all modes.

**Shared components consumed:** `AskAIWidget`, `AiInsightBadge`, `WorkbenchPage`, `FilterBar`, `DateRangeControl`, `AccountMultiSelect`, `DetailSheet`, `CommandPalette`

**Workflows that live here (IA boundary):**

- Plain-English Q&A over the books (this is the home of conversational query): 'who owes me money', 'top 5 expenses this quarter', 'Stripe fees this year' — answers must cite posted journal lines / report packs via Sources, never recompute ad-hoc totals.
- Propose→confirm AI actions surfaced as confirmation cards (categorize / rule / invoice draft / bill / journal entry) — the proposal is authored here but the actual write is owned by the single ledger mutation (api.proposals.confirmProposal), preserving 'AI proposes, the ledger engine posts'.
- Context-scoped 'Explain this' entry points launched FROM other surfaces (Reports 'Explain', and new Income/Expenses/Transactions filter-aware launches) that open this panel pre-scoped — the launch lives on each surface; the conversation lives here.
- Thread history / new conversation management (durable Convex threads) — switching, starting, deleting conversations belongs here, exposed through one modern switcher across all four modes.
- NOT here: bulk transaction triage and keyboard-first categorization (that is the Inbox); editing/posting ledger entries directly (Transactions register + ledger mutation); the canonical filterable register (Transactions); revenue/cost analytics drill-downs (Income/Expenses lenses) and the authoritative numbers (Reports). Ask AI reads and proposes against those surfaces; it does not duplicate their register or own financial truth.

### 6.12 Shell, Header & Navigation

Quiet the chrome and make the shell a stable frame, not a second toolbar. LEFT NAV (keep, stabilize): fixed 232px expanded / 56px rail; keep the EntitySwitcher at top as the single place the entity name appears. Move Settings OUT of the primary nav list into a quiet utility footer cluster alongside Sync + Profile (a small gear icon + the avatar menu), satisfying Ansar's \"settings to footer/utility area\". HEADER (strip it): remove the global search trigger and the month chip entirely; the header becomes a thin context bar holding only the mobile menu button, an optional breadcrumb/page title (so screens stop re-printing eyebrow+entity), and an icon-only Ask AI button (Sparkles, tooltip + ⌘J) on the far right — no text pill. Global jump-to lives solely in ⌘K; period lives on the surfaces that own a period. BODY: kill the per-page PageHeader eyebrow=entity duplication and the boilerplate route.summary; show just the surface title (or nothing where a screen has its own toolbar). Drop the \"Demo entity\" body chip and the \"Bedrock active/Degraded mode\" labels; if an env indicator is needed, a single subtle dot/tooltip near the workspace name in the sidebar. DOCKED AI: convert from a width-stealing flex sibling to an OVERLAY drawer (shadcn Sheet/Drawer) on the right that floats over content with a scrim on smaller widths, OR a resizable split that lets content keep ≥960px; never silently shrink tables below the 1200px design width. STICKY CONTRACT (codify): shell header sticky, sidebar fixed, in-page primary toolbars (filters/period/segmented controls) sticky under the header, and the Settings subnav sticky (`lg:sticky lg:top-[72px]`) so it stays while content scrolls. MOBILE: real drawers (shadcn Drawer) for the sidebar and the AI sheet; a compact bottom nav of Dashboard/Inbox/Transactions/Reports + a \"More\" sheet, and add a Search action (opens the palette) reachable on mobile. Use semantic tokens (--primary/--ai, --ob-green-50/800) everywhere the raw hexes appear.

**Shared components consumed:** `WorkbenchPage`, `FilterBar`, `DateRangeControl`, `AccountMultiSelect`, `AskAIWidget`, `CommandPalette`, `AttentionState`

**Workflows that live here (IA boundary):**

- Global navigation between surfaces (left nav) — the shell owns routing, not data; it must NOT duplicate any financial register or totals.
- Active-entity switching (EntitySwitcher) — the single source of the entity context that every surface scopes its reads to; entity name appears ONCE here, never re-announced per page.
- Global jump-to / search via the ⌘K command palette (nav, reports, contacts, transactions) — this is the cross-surface search; per-surface row filtering belongs to each workbench, not the header.
- Opening the Ask AI assistant (icon + ⌘J) as an overlay; the conversation, proposals, and report-explain context live in OpenBooksAIChat, not the shell.
- Workspace utility: Sync, Profile menu, Settings entry, and a subtle env/demo indicator — all relegated to the sidebar footer/utility zone.
- Mobile drawer + bottom-nav navigation. EXCLUDED from the shell: any transaction list, KPI totals, period selection, or per-page intro copy — those belong to Dashboard/Transactions/Income/Expenses/Reports respectively (Transactions is the universal register; Income/Expenses are lenses over the same records).

---

## 7. Ask AI Redesign Proposal Using AI Elements

### 7.1 The problem in one paragraph

The entire Ask AI surface is a single 918-line hand-rolled component, `apps/web/src/components/openbooks/OpenBooksAIChat.tsx`. It re-implements every primitive that the Vercel AI SDK's **AI Elements** registry ships for free: message bubbles (`MessageBubble`, line 421), a regex markdown parser with its own table/list/link logic and no library (`MarkdownBlocks` line 199 / `InlineMarkdown` line 171), tool-call disclosure on a native `<details>` (`ToolPartCard` line 325), and a raw `<select>` thread switcher (line 762). It leaks the vendor name "Bedrock active" to owners in three places, has only two layout modes (a hardcoded 380px desktop aside at `AppShell.tsx:469` and an 88dvh mobile sheet at `:495`) with no compact trigger and no expanded mode, and is context-aware only at the coarsest level (a route label plus a year-wide `reportPack` pinned to `2026-01-01..2026-12-31` at `AppShell.tsx:135-137`). The backend, by contrast, is solid and must not be touched: streaming and persistence run through the Convex Agent component, not the AI SDK UI layer. The redesign keeps that backend contract intact and rebuilds only the presentation on AI Elements.

### 7.2 Install path (AI Elements via shadcn registry into `apps/web`)

AI Elements is distributed as a **shadcn registry**, not an npm package — components are copied into the repo as source you own, exactly like the existing `apps/web/src/components/ui/*` primitives. The web app is already configured for this: `apps/web/components.json` exists with `"ui": "@/components/ui"`, `iconLibrary: "lucide"`, `cssVariables: true`, and an empty `"registries": {}` block ready to receive the AI Elements registry entry. The `shadcn@^4.10.0` CLI is already a dependency of `apps/web/package.json`.

Concretely:

1. **Add the runtime dep to `apps/web`.** Today `ai@^6.0.202`, `@ai-sdk/amazon-bedrock`, and `@convex-dev/agent@^0.6.3` live only in the **root** `package.json` (the Convex backend workspace) — `apps/web/package.json` has none of `ai`, `@ai-sdk/*`, `ai-elements`, or `streamdown`. AI Elements' `Response` component renders streamed markdown with **streamdown**, so `streamdown` (and `ai` for shared `UIMessage` types) must be added to `apps/web` so the web build resolves them.
2. **Pull the primitives via the registry**, e.g. `npx shadcn@latest add @ai-elements/conversation @ai-elements/message @ai-elements/response @ai-elements/prompt-input @ai-elements/suggestion @ai-elements/sources @ai-elements/tool @ai-elements/reasoning @ai-elements/actions`. These land under `apps/web/src/components/ai-elements/*` and compose on the shadcn primitives the app already has (`button.tsx`, `card.tsx`, `collapsible`/`select.tsx`, `command.tsx`, `sheet.tsx`).
3. **Theme them to the design system.** The registry components inherit shadcn CSS variables, so they pick up `--primary` (brand green `#2ca01c`) automatically. The one required cleanup is to strip the off-token hardcoded hexes the current chat introduces — `OpenBooksAIChat.tsx:185` (`border-[#bbe0a9] bg-[#f1f8ee] text-[#1d6b12]` link chip), `:508` (active-thread tint), and the Ask-AI button hexes at `AppShell.tsx:450-451` — and route them through `--primary`/`--ob-green` so AI Elements stays inside the one-green rule.

This is additive: no existing primitive is removed, and the registry source is checked in and editable.

### 7.3 Primitive-by-primitive replacement map

Each AI Elements primitive retires a specific block of the custom component:

| AI Element | Replaces (current code) | Why it is better |
| --- | --- | --- |
| **`Conversation`** | The bare `<div ref={listRef}>` scroll list with a manual `scrollTo` effect (`OpenBooksAIChat.tsx:814`, `:607-609`) | Built-in stick-to-bottom + "scroll to latest" button; deletes the imperative scroll effect |
| **`Message` / `MessageContent`** | `MessageBubble` (`:421-474`) including the brand-green user fill `border-primary bg-primary` (`:443`) | Standard role-keyed layout; lets us match the prototype's quiet grey `#f5f5f5` user bubble + avatar-plus-flowing-text assistant row instead of the saturated card |
| **`Response`** (streamdown) | The entire regex markdown engine — `MarkdownBlocks` (`:199`), `InlineMarkdown` (`:171`), `isSeparatorLine` (`:154`), `parseTableRow` (`:162`) | Removes ~150 lines of bespoke parsing, the XSS/format risk, the index-based money alignment bug (`:238` assumes every non-first column is money), and the always-`text-left` non-tabular table headers (`:226`). streamdown is the renderer AI Elements ships for exactly this |
| **`PromptInput`** | The hand-built `<form>` + `<Input>` + send `<Button>` composer (`:886-903`) | Submit-on-enter, disabled/streaming states, optional attachment slot, all standard |
| **`Suggestion`** | Raw `<Button variant="outline">` chips duplicated in the empty state (`:822`) and the footer (`:871`, which uses `overflow-x-auto` and forces a horizontal scrollbar at 380px instead of wrapping) | Purpose-built wrapping chip row; also lets us collapse the two duplicated `SUGGESTIONS` lists to one |
| **`Tool`** | `ToolPartCard` built on native `<details>`/`<summary>` (`:325-342`) | Proper collapsible disclosure with input/output/state rendering on shadcn, not a raw HTML element |
| **`Sources`** | *(nothing — does not exist today)* | New: lets an answer cite the posted journal lines / report packs it drew from, reinforcing "AI proposes, the ledger is truth" |
| **`Reasoning`** (optional) | *(nothing)* | New: a quiet, collapsed "thinking" disclosure for multi-step answers |
| **`Actions`** (optional) | *(nothing)* | New: copy / retry / "open source report" affordances on each answer; the propose→confirm card pairs naturally here |
| **`Attachments`** (optional) | *(nothing)* | New: future receipt/CSV drop into the prompt |

The bespoke **`ProposalCard`** (`:344-419`) stays conceptually but is re-housed as a first-class render inside `Tool`/`Actions` so the propose→confirm ledger flow keeps its "Nothing has been posted yet" copy and its `confirmProposal`/`dismissProposal` wiring — it must never auto-post.

### 7.4 Preserve the Convex Agent streaming contract (do not break the backend)

This is the load-bearing constraint. The chat does **not** use the AI SDK's `useChat`; it uses `@convex-dev/agent/react`. The redesign adapts the *view* layer only and leaves every hook in place:

- `useUIMessages(api.aiThreads.listThreadMessages, { threadId }, { initialNumItems: 40, stream: true })` (`:570-574`) stays as the message source. Its results are already typed as `UIMessage` from `@convex-dev/agent/react` (`:7`), and AI Elements' `Message`/`Response` consume the same `UIMessage` `parts[]` shape — so the adaptation is mechanical: map `part.type === "text"` → `Response`, `part.type.startsWith("tool-")` → `Tool`, and the proposal rows → the confirmation render. No translation layer to the AI SDK transport is needed.
- `useSmoothText(text, { startStreaming: streaming, charsPerSec: 220 })` (`:317`) is kept and fed into `Response`, preserving the existing token-smoothing feel. (If `Response`'s own incremental rendering proves smooth enough, `useSmoothText` can be dropped later — but it is not required to remove it.)
- `useMutation(api.aiThreads.sendMessage).withOptimisticUpdate(optimisticallySendMessage(api.aiThreads.listThreadMessages))` (`:560-562`) remains the send path behind `PromptInput`'s submit handler. The optimistic update keeps the instant local echo.
- Thread lifecycle (`api.aiThreads.createThread`/`deleteThread`/`listMine`) and proposals (`api.proposals.listProposals`/`confirmProposal`/`dismissProposal`) are unchanged.
- `message.status === "streaming" | "pending"` (`:436`) continues to drive the loader and the streaming flag.

Net: the Convex backend, schema, and mutations are untouched; only the JSX that consumes `messagesPage.results` changes.

### 7.5 Remove the provider/debug label leakage (worse than first audited)

The "Bedrock" string is user-facing in **four** spots, not three. Beyond the badge at `OpenBooksAIChat.tsx:758`, `AskAIScreen.tsx:45`, and the Settings card `ModuleScreens.tsx:1568`, the status-card title at `OpenBooksAIChat.tsx:804` renders `activeThread?.title ?? aiStatus.label` — and `aiStatus.label` is the literal `"Bedrock provider is configured"` string built in `ai.ts:143`. So with no active thread, the owner reads the vendor name directly. The status copy at `:807` further names the backend framework: *"Answers stream from the Convex Agent…"*. Both violate the plain-English / quiet-AI rules.

Redesign:
- **Active state shows nothing** — no badge. A confident assistant needs no status chrome.
- **Degraded state shows one quiet capability chip** ("AI is off — rules and reports still work"), never a provider name.
- Delete the badge at `:758`, `AskAIScreen.tsx:45`, and `ModuleScreens.tsx:1568`; rewrite `ai.ts:143`'s `label` to provider-agnostic ("AI is on" / "AI is off") and `:807`'s copy to drop "Convex Agent". Settings may keep a *technical* provider/model field, but the conversational surface must not.

### 7.6 The four `AskAIWidget` modes off one component

Today there are only two modes, both hardcoded. The redesign collapses everything into a single `AskAIWidget` driven by a `mode` prop, retiring the `mode: "drawer" | "page"` split and the duplicated header chrome:

1. **Compact / collapsed trigger.** Add a Sparkles icon button to `CollapsedRail` (`AppShell.tsx:717-820`, which today renders only `appRoutes` + `settingsRoute` and has *no* AI affordance) so Ask AI is reachable when the sidebar is iconified. Keep the header "Ask AI" pill (`:447`, ⌘J) as the primary trigger.
2. **Docked side panel** (default). Today a fixed `w-[380px]` sticky aside that compresses the 1200px content column to ~820px on Reports/Transactions. Make it **resizable** (drag handle, min ~360 / max ~560) and add an **overlay-vs-push toggle** so dense tables aren't crushed. Note the tablet gap the audit caught: the aside is `lg:flex` (`:469`), so 768–1023px gets *no* docked panel — only the bottom sheet. The redesign should let the docked panel render from `md` up (or explicitly route tablet to an overlay) rather than silently dropping it.
3. **Expanded workspace** (`/ask-ai`). Keep the full page, but **drop the redundant outer `PageHeader`** (`AskAIScreen.tsx:41`) so the widget owns its own chrome instead of double headers. Replace the page-only `ThreadRail` (`:476`) with the same modern switcher used everywhere, and turn the dead static "Pinned artifacts" aside (`:908-914`) into a real `Sources`/artifacts canvas.
4. **Mobile drawer.** Replace the body-scroll-locked 88dvh `<aside>` (`AppShell.tsx:492-507`) with a shadcn **`Sheet`** (`sheet.tsx` already exists) carrying a compact single-row header — critically, the thread switcher must be reachable on mobile. Today every right-hand control is `.sm`-gated (`:762`, `:777`, `:786`), so on the phone the thread `<select>`, new-chat, and maximize buttons vanish entirely and there is no way to switch conversations.

A **single thread switcher across all four modes** replaces the two parallel, inconsistent switchers (raw `<select>` at `:762` and `ThreadRail` at `:476`): use a `Command`/Combobox (the app already ships `command.tsx` and `cmdk@^1.1.1`) so it works at 380px, on mobile, and on the full page.

### 7.7 Real page + filter context-awareness

Currently the only context the chat gets is `currentRouteLabel` (`AppShell.tsx:256`, derived from `appRoutes`) shown as "Viewing: {label}" plus the year-wide `reportPack`. The only surface that pushes a scoped pack is Reports (`ReportsScreen.tsx:1269` via `createAiRequestEvent(..., "Reports", pack)`); Income, Expenses, Transactions, and Bills never reach the chat.

The mechanism already exists and should be reused, not replaced: `createAiRequestEvent(prompt, context, reportPack)` (`ai.ts:171`) dispatches `OPENBOOKS_AI_EVENT`, which `AppShell` listens for at `:229` and feeds into the widget. The work is to have **each workbench dispatch its active scope** — entity id + date range + active filter chips (merchant, account, category) — when the user launches "Explain this" or simply opens Ask AI from that page, so "Viewing: {label}" becomes a real, scoped context instead of a generic route name. Two correctness fixes ride along:
- The pending-prompt nonce uses `::` as a separator (`AppShell.tsx:226` appends `::${Date.now()}`, stripped at `OpenBooksAIChat.tsx:644` via `split("::")[0]`). Any prompt containing `::` (a time range, a ratio) is silently truncated — replace with a structured `{ prompt, nonce }` payload.
- `SUGGESTIONS` is duplicated in `OpenBooksAIChat.tsx:33-39` and `ai.ts:121-127` (`aiSuggestedPrompts`) with identical strings; collapse to the single `ai.ts` export.

### 7.8 Responsive rules so Reports / dense pages never break

- **Docked panel must offer overlay mode** on `lg` and below-`xl` so opening it over a wide Reports/Transactions table overlays rather than pushing the 1200px column down to ~820px; the resizable handle gives power users width when they want it.
- **Suggestion chips wrap, never scroll.** The prototype uses `flex-wrap` (line 288); the current footer uses `overflow-x-auto` (`:871`). `Suggestion` wraps by default — adopt that.
- **Answer tables scroll horizontally at narrow widths.** The current `overflow-hidden` table wrapper (`:221`) clips wide money tables at 380px with no affordance. `Response`/streamdown gives the table an `overflow-x-auto` container; money columns use `tabular-nums`/`money-figures` on both `<th>` and `<td>`, fixing the left-aligned proportional header over right-aligned tabular body defect.
- **One mobile IA.** The mobile `Sheet` carries the full control set (thread switcher included) instead of `.sm`-gating controls into oblivion; the full-page route also exposes the switcher on phones (today `ThreadRail` is `lg:flex` and the artifacts aside is `xl:block`, so a phone on `/ask-ai` loses both side columns and all thread switching).

### 7.9 Concrete file plan

**Add**
- `apps/web/src/components/ai-elements/*` — `conversation`, `message`, `response`, `prompt-input`, `suggestion`, `sources`, `tool`, `reasoning`, `actions` (via the shadcn registry).
- `apps/web/src/components/openbooks/AskAIWidget.tsx` — the single replacement for `OpenBooksAIChat`, taking a `mode` prop (`collapsed | docked | page | mobile`), composing the AI Elements primitives over the preserved Convex hooks, and owning the resizable/overlay logic and the one shared thread switcher.

**Change**
- `apps/web/package.json` — add `streamdown` (+ `ai` for shared `UIMessage` types); add the AI Elements registry entry to `apps/web/components.json` `"registries": {}`.
- `apps/web/src/components/openbooks/AppShell.tsx` — render `AskAIWidget` in docked/mobile slots (`:466-507`); add a Sparkles trigger to `CollapsedRail` (`:717-820`); make the docked aside resizable + overlay-capable and available from `md` (`:469`); replace the `::` nonce (`:226`) with a structured payload; route brand-green hexes (`:450-451`) through tokens.
- `apps/web/src/components/openbooks/AskAIScreen.tsx` — drop the redundant `PageHeader` (`:41`) and the provider chip (`:45`); render `AskAIWidget mode="page"`.
- `apps/web/src/lib/openbooks/ai.ts` — relabel `frontendAiStatus` (`:143`) to provider-agnostic copy; keep it as the single source for suggested prompts.
- `apps/web/src/components/openbooks/ModuleScreens.tsx` — remove/neutralize the "Bedrock active" badge at `:1568`.
- Income / Expenses / Transactions / Bills screens — dispatch `createAiRequestEvent` with each surface's active entity + date range + filter chips.

**Delete (subsumed by AI Elements)**
- Inside the new widget, retire `MarkdownBlocks`/`InlineMarkdown`/`isSeparatorLine`/`parseTableRow` (`OpenBooksAIChat.tsx:154-314`), `ToolPartCard`'s `<details>` (`:325`), the raw `<select>` switcher (`:762`), and the brand-green hex chips (`:185`, `:508`).

---

## 8. Responsive And Layout Rules

These rules target the five audited widths and the actual shell measurements in the code: a `232px` fixed sidebar (`AppShell.tsx:359`, `:380`), a centered `max-w-[1200px]` main column (`AppShell.tsx:463`), a `380px` docked AI panel that is a *flex sibling* of main (`AppShell.tsx:466-469`), an `88dvh` mobile bottom sheet (`AppShell.tsx:495`), and a `grid-cols-4` mobile bottom nav (`AppShell.tsx:509`). The project is Tailwind v4 with no custom `@theme` screens (`globals.css` defines only radius/color tokens), so the **stock breakpoints govern everything**: `sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`. Map the audit widths onto them deliberately:

| Audit width | Active stock breakpoint band | What the shell should be doing |
|---|---|---|
| **390** | base (< `sm`) | Single column. Off-canvas sidebar, bottom nav, bottom-sheet AI, card-stacked tables. |
| **768** | `md` (just hit) | Still single content column; sidebar still off-canvas (rail only appears at `lg`). Tables begin to fit but must stay card-stacked or scroll. |
| **1306** | `xl` (just past `1280`) | Sidebar rail visible; **two-pane** (table + detail aside) layouts switch on; **danger zone** when the AI panel is also open. |
| **1440** | `xl` | Comfortable two-pane; AI panel open still squeezes wide tables to ~828px. |
| **1758** | `2xl` (past `1536`) | Everything fits; this is the only width where AI-open + wide table coexist cleanly. |

The core structural defect to fix everywhere: the docked AI panel **pushes** content instead of overlaying it. At 1440 the math is `232 (sidebar) + 380 (AI) = 612px` consumed, leaving the `max-w-[1200px]` main only ~828px (`AppShell.tsx:463-469`), which is why Reports/Transactions/P&L collapse only when AI is open. The fix is per-surface, but the rule is global: **wide tabular surfaces must own an `overflow-x-auto` scroll region and a `min-w-0` flex track so the AI panel cannot clip them.**

### 8.1 App shell — left nav, header, docked AI

- **Left nav.** Off-canvas drawer (`fixed inset-y-0 w-[232px]` + `translate-x` transition, `AppShell.tsx:380`) below `lg`; persistent rail at `lg` and up via `contentPad` = `lg:pl-[232px]` / `lg:pl-[56px]` collapsed (`AppShell.tsx:359-360`). Keep this. At **390/768** the drawer is correct; do not show the rail until `lg` (1024) — confirmed already gated `lg:translate-x-0`.
- **Header.** Already `sticky top-0 z-30 h-14` (`AppShell.tsx:419`) — keep sticky on every surface. Two header regressions to fix: the search trigger is `md:flex` only (`AppShell.tsx:434`) and the month chip is `sm:flex` only (`AppShell.tsx:444`), so at **390** the user has **no path to ⌘K / search** (the bottom nav has no search entry). Rule: surface a search affordance in the mobile chrome (e.g. a header search icon visible at base, or a search slot in the bottom nav) so command-palette reach is breakpoint-independent.
- **Docked AI.** Desktop aside is `sticky top-0 h-screen w-[380px] shrink-0 ... lg:flex` (`AppShell.tsx:467-469`) — independently scrolling and pinned, which is right. The wrong part is that it is a flex *sibling* of main rather than an overlay. Rule for **1306/1440**: either (a) cap content with `min-w-0` + `overflow-x-auto` on the table so the panel can compress without clipping, or (b) switch the panel to an overlay/resizable model above `xl`. Below `lg` it is correctly a bottom sheet (see 8.6).
- **Sticky vs scrolling.** Sticky: sidebar rail, top header, docked AI aside, mobile bottom nav (`fixed bottom-0`, `AppShell.tsx:509`). Independently scrolling: `<main>` content. The page itself is the scroll context — there is no inner scroll region on `<main>`, which is what makes long lists (Inbox 2000 items, Settings sections) push the page unbounded.

### 8.2 Data tables — column priority, hide order, scroll vs card-stack

The hard rule: **every shadcn `<Table>` and every CSS-grid "table" must live inside an `overflow-x-auto` wrapper, and the flex/grid track that holds it must carry `min-w-0`.** Today multiple tables use `overflow-hidden` (which *clips*) instead of `overflow-x-auto` (which *scrolls*) — most critically Transactions at `CoreScreens.tsx:981` (`overflow-hidden rounded-lg border`), Income invoices (`IncomeScreen.tsx:226-260`), and the Expenses fixed 7-col grid (`ExpensesScreen.tsx:94`). Change `overflow-hidden` → `overflow-x-auto` on these wrappers; on the inline category `<Select min-w-44>` (`CoreScreens.tsx:1021`) drop the hard min so columns can compress.

- **Desktop (`lg`+, i.e. 1306/1440/1758):** show full column set. Wrap in `overflow-x-auto` so AI-open never clips. Give the leftmost name column `min-w-0` and `truncate`; keep money columns at natural/tabular width (`text-right`, `money-figures`). Add a **sticky table header** (`thead sticky top-0 bg-background`) since lists are long and unpaginated.
- **Tablet (`md`, 768):** keep the table but rely on the horizontal-scroll wrapper. Define a **column hide order** so the table fits before it has to scroll — drop secondary columns first via `hidden lg:table-cell`. Suggested priority to keep across surfaces: **Date · Name/Merchant · Amount** always visible; hide in this order (first to go) → reference/#, FX rate/base-equiv, account, due/issued dates, status badge (becomes an inline dot), balance.
- **Mobile (base, 390):** do **not** render the dense desktop table. Reflow to a **card stack** (`hidden md:table` on the table, a `md:hidden` card list as fallback). Each card = name + amount on row one (`flex justify-between` with `min-w-0` on the name), metadata (date/account/status) on row two. This is the explicit DS requirement ("a real responsive surface, not a squeezed desktop table") that Transactions, Income, Expenses, Contacts, and Payroll currently all violate.
- **min-w-0 discipline.** Long names already break layout because name spans lack `min-w-0` (Dashboard income-by-customer `CoreScreens.tsx:309`, activity feed `:275`; Income payments memo `IncomeScreen.tsx:169`). Every `flex justify-between` money row needs `min-w-0` + `truncate` on the label and `shrink-0` on the figure.

### 8.3 Detail Sheet / Drawer — side sheet desktop, bottom drawer mobile

- **Desktop (`lg`+):** detail is a right-hand region. Two-pane grids (`xl:grid-cols-[1fr_380px]` Transactions `CoreScreens.tsx:980`; `xl:grid-cols-[1.1fr_0.9fr]` Bills `ModuleScreens.tsx:731`; `xl:grid-cols-[1.2fr_0.8fr]` Contacts `:179`) only split at `xl` (1280). At **1306** that is fine *only if AI is closed*; with AI open the table track must be `min-w-0` + scrollable. The list/table track in each split needs `min-w-0` so the detail aside cannot crush it.
- **Mobile (< `lg`):** the two-pane grid collapses to one column today, which dumps the entire list first and the detail far below (Inbox `CoreScreens.tsx:594`, Contacts profile, Bills "Selected bill"). **This is the worst responsive defect.** Rule: on mobile, selecting a row must open a **bottom drawer / `Sheet` (`side="bottom"`)** over the list, not stack a panel beneath it. Reuse the existing AI bottom-sheet pattern (`fixed inset-x-0 bottom-0 rounded-t-[12px]`, `AppShell.tsx:494-498`) as the canonical mobile detail surface. The Income composer already uses a right `Sheet sm:max-w-[560px]` (`IncomeScreen.tsx:489`) — that is the correct desktop side-sheet idiom; mirror it to bottom on mobile.
- **Detail closed by default.** On full-width surfaces (Transactions, Contacts) the detail pane must be **closed by default** so the table renders full-width on first paint; opening a row reveals the aside (desktop) or the bottom drawer (mobile).

### 8.4 KPI strips — wrap vs scroll

- KPI strips are `grid md:grid-cols-4` (Income `:102`, Payroll `:985`, and Dashboard's 4-up `md:grid-cols-2 xl:grid-cols-4` `CoreScreens.tsx:157`). Below `md` they correctly stack 1-up; that is fine at **390**.
- Two rules: (1) **hero figures need overflow guards** — `StatCard` uses `text-2xl` with no `min-w-0`/`truncate` (`CoreScreens.tsx:86`), so a 9-digit "all businesses" cash figure overflows its column; add `min-w-0` to the card and `tabular-nums truncate` to the figure. (2) **fixed-count grids overflow when the data exceeds the count** — Payroll's `md:grid-cols-4` breaks with >3 currencies + headcount (`:985`). Prefer `flex flex-wrap gap-3` with a min card width, or `overflow-x-auto` with `snap-x` for a horizontally scrollable KPI rail on mobile, rather than a hard 4-column grid.

### 8.5 Settings — sticky nav + scrolling content

- Desktop layout is `hidden lg:flex lg:items-start` with a `w-[190px] min-w-[190px]` nav and a `min-w-0 flex-1` content column (`SettingsScreen.tsx:151-180`). The nav is **not sticky** — there is no `sticky`/`top-` class and the page is the scroll context, so on long sections (Rules, Audit ~8+ rows, Categories ~16 rows) the subnav scrolls off-screen. **Fix:** make the nav `sticky top-[calc(3.5rem+...)] self-start` (offset by the `h-14` header) so it pins while content scrolls independently. `lg:items-start` is already correct for sticky-child behavior; only the `sticky top-N` is missing.
- Inside the content column, heavy panels are tuned for full width and crush when the AI panel is open: Audit's `grid-cols-[120px_120px_1fr]` (`AuditSection.tsx:77`), Rules' 9 inline controls (`RulesSection.tsx:111-175`), Stripe checklist `md:grid-cols-2 xl:grid-cols-5` (`StripeConnectionPanel.tsx:439`). Rule: child grids in Settings should use `min-w-0` cells and step down a column at the panel's own width, and wide child tables (Stripe payouts, `StripeConnectionPanel.tsx:236`) keep their `overflow-x-auto`.
- Mobile uses a separate drill-in list (`SettingsScreen.tsx:113-148`) which is the right pattern; the Plaid/Stripe consoles inside still need to collapse their multi-button rows to a stacked, single-action-per-row layout at **390** rather than a wall of buttons.

### 8.6 Ask AI — collapse / dock / expand / drawer

Four states, gated on `lg` (1024):

1. **Collapsed (default):** trigger is the header "Ask AI" button (`AppShell.tsx:447`) plus ⌘J. No panel.
2. **Docked (desktop, `lg`+):** `sticky top-0 h-screen w-[380px] shrink-0 lg:flex` aside, independently scrolling (`AppShell.tsx:467-469`). Rule: when docked, the active content surface must already be scroll-safe (8.2) so docking compresses but never clips. Footer suggestion chips currently `overflow-x-auto` inside 380px (`OpenBooksAIChat.tsx:871`) — switch to `flex-wrap` to match the prototype.
3. **Expanded (page mode, `/ask-ai`):** a 3-column layout (`236px` ThreadRail `lg:flex` + chat + `280px` artifacts `xl:block`, `OpenBooksAIChat.tsx:490/:908`) inside the `max-w-[1200px]` main. Note the IA inconsistency to fix: at **768** (`md`) both side columns silently disappear (rail is `lg:flex`, artifacts `xl:block`), leaving a bare chat. Define the `md` state explicitly.
4. **Mobile drawer (< `lg`):** bottom sheet `h-[88dvh] rounded-t-[12px]` with backdrop and body-scroll lock (`AppShell.tsx:492-507`, `:233-246`). Two fixes: thread `<select>`, new-chat, and maximize controls are `sm:`-gated in the header (`OpenBooksAIChat.tsx:750-797`) so they vanish on the mobile sheet — **thread switching is unreachable on mobile**; expose them in the sheet. And replace the raw `document.body.style` scroll-lock with a managed Drawer primitive. At **390** the sheet must be a purpose-built drawer (wrapped chips, reachable composer), not the 380px desktop panel stretched.

---

---

## 9. Implementation Workflow Plan For Claude Code

This section converts the redesign into eight executable epics (Epic 0–7) and a concrete workflow shape. It is grounded in the real file layout verified during the audit: page screens live in `apps/web/src/components/openbooks/`, read-models in `convex/*Views.ts`, routing flows through `apps/web/src/components/openbooks/AppScreen.tsx` and `apps/web/src/app/[section]/page.tsx`, and the shared shadcn primitives in `apps/web/src/components/ui/`.

Two hard structural facts shape the whole plan:

- **There is no shared workbench layer today.** The only shared building blocks are in `apps/web/src/components/openbooks/primitives.tsx` (`PageHeader`, `StatCard`, `EmptyState`, `Sparkline`, `BarChart`, `CategoryChip`) and `module-helpers.ts`. Every page (`CoreScreens.tsx`, `IncomeScreen.tsx`, `ExpensesScreen.tsx`, `ModuleScreens.tsx`, `ReportsScreen.tsx`) hand-rolls its own table/filter/detail UI. The thirteen components in the proposal (`WorkbenchPage`, `OpenBooksDataTable`, `FilterBar`, `DateRangeControl`, `AccountMultiSelect`, `KpiStrip`, `DetailSheet`, `AiInsightBadge`, `EvidenceUpload`, `ExportMenu`, `AttentionState`, `CommandPalette`, `AskAIWidget`) do not yet exist as primitives. This is why Epic 1 must land before any page epic.
- **The shadcn inventory is incomplete.** `apps/web/src/components/ui/` currently has `badge, button, card, command, dialog, dropdown-menu, input, label, select, separator, sheet, skeleton, switch, table, tabs, textarea, tooltip`. Missing for this redesign: `drawer, popover, calendar, toggle-group, scroll-area, checkbox, field/input-group, sonner`. There is **no `ai-elements` package** under `apps/web/src/components/` yet. Adding these is part of Epic 1 / Epic 2 scope.

A confirmed correctness target for the page epics: both register screens auto-open a detail panel by selecting the first row as a fallback — `CoreScreens.tsx` Inbox uses `inbox.items.find(...) ?? inbox.items[0]` (around line 360) and Transactions uses `data.rows.find(...) ?? data.rows[0]` (around line 746). The acceptance gate requires detail panels closed until explicit row selection, so this fallback must be removed in Epic 3.

Because **a Claude Code workflow cannot pause mid-run for input**, each implementation epic is its own approved workflow run. A run ends by returning an evidence pack (changed files, validation output, screenshots, risks); Ansar reviews it and only then launches the next run. Epic 0 is a research/evidence run with no product edits; Epic 7 is the final QA run.

---

### Epic 0 — Audit Baseline And Visual Evidence

**Goal.** Freeze the "before" state so every later epic can be diffed against it. No product edits. Produce baseline screenshots at all five gate widths (390, 768, 1306, 1440, 1758) for all twelve surfaces, plus a recorded inventory of the concrete defects each later epic must fix.

**Files involved (read-only).** All twelve surface files listed in the brief; `playwright.config.ts` (testDir `./tests/e2e`, port 3100, report to `docs/finishing/evidence/playwright-report`); existing specs in `tests/e2e/` (notably `app-shell.spec.ts`, `core-screens.spec.ts`, `income-expenses-bills.spec.ts`, `modules.spec.ts`, `reports.spec.ts`, `reports-payroll.spec.ts`, `settings.spec.ts`, `ai-chat.spec.ts`); the prototype HTML under `OpenBook - Prototype/`.

**Subagent scope.** One screenshot-capture agent driving the running app at `http://localhost:3100` (or via the Playwright `webServer`), plus one read-only audit agent that records, as `path:line` citations, the defects each epic owns: the auto-select fallbacks in `CoreScreens.tsx`; the fixed-width docked panel in `OpenBooksAIChat.tsx` / `AppShell.tsx`; the `PageHeader` eyebrow + "Demo entity" chip injected in `AppScreen.tsx:50-55`; horizontal-overflow candidates in Settings tables and Reports.

**Allowed edits.** None to product code. May write screenshots and a baseline manifest under `docs/finishing/evidence/` only.

**Validation expected.** `pnpm typecheck && pnpm lint && pnpm test:unit` captured as the green baseline; `pnpm test:e2e` run recorded (pass list or known-flake notes); one screenshot per surface per width committed to evidence.

**Risks.** Dev server/Convex must be seeded for non-empty screenshots; demo data must not be mutated (read-only flows only). Flaky e2e could be misattributed to the redesign later if not snapshotted now.

**Done-when.** Baseline screenshot set exists for 12 surfaces × 5 widths; the green pre-change `verify` output is recorded; the defect-to-epic map is written with `path:line` citations.

---

### Epic 1 — Shared Workbench Primitives

**Goal.** Build the reusable interaction layer the whole product is missing, so page epics assemble from primitives instead of re-implementing tables. This is the keystone epic; nothing else can parallelize until it lands.

**Files involved.** New files under a new `apps/web/src/components/openbooks/workbench/` directory: `WorkbenchPage.tsx`, `OpenBooksDataTable.tsx`, `FilterBar.tsx`, `DateRangeControl.tsx`, `AccountMultiSelect.tsx`, `KpiStrip.tsx`, `DetailSheet.tsx`, `AiInsightBadge.tsx`, `EvidenceUpload.tsx`, `ExportMenu.tsx`, `AttentionState.tsx`. Extend `apps/web/src/components/openbooks/primitives.tsx` (reuse `Amount`, `formatMinorMoney`, `ConfidenceRing`, `EmptyState`). Add missing shadcn primitives to `apps/web/src/components/ui/`: `drawer`, `popover`, `calendar`, `toggle-group`, `scroll-area`, `checkbox`, `field`/`input-group`. Reuse `tabular figures` / `money-figures` and brand-green conventions already in `primitives.tsx`.

**Subagent scope.** One focused build agent. It owns only the primitive layer plus a throwaway Storybook-style harness route or a `__primitives` demo screen for screenshot evidence. It must not touch any of the eight page screens or the Convex read-models. `OpenBooksDataTable` must support: sorting, column sizing, row selection + bulk-action toolbar, empty/loading/error states (reusing `EmptyState` and `skeleton`), and an export hook consumed by `ExportMenu`. `DetailSheet` must default closed and degrade to `drawer` on mobile. `AttentionState` must encode one shared vocabulary (needs-review, missing-evidence, overdue, unmatched, unposted, low-confidence) so every page renders the same chips.

**Allowed edits.** Create the workbench primitives, add shadcn UI primitives, extend `primitives.tsx`. No page-screen edits, no Convex edits.

**Validation expected.** `pnpm typecheck && pnpm lint`; unit tests for the pure helpers (sorting comparator, export-row mapping, attention-state derivation) via `vitest`; primitive-harness screenshots at 390/768/1440 proving each component's responsive and empty/loading/error states.

**Risks.** Over-designing the API and then reworking it in page epics; bundle weight from `calendar`; date-range timezone correctness must align with `report-periods.ts`. Mitigate by writing the data-table/filter API against the real row shapes (`convex/coreViews.ts` transactions row at lines 464-503, `module-helpers.ts` `BillRow`/`ContactRow`) before locking it.

**Done-when.** All eleven workbench primitives plus the new shadcn UI primitives exist, typecheck/lint clean, are demonstrated in the harness with passing responsive + state screenshots, and the props match at least three real row contracts so page epics can adopt without API churn.

---

### Epic 2 — Shell, Header, Navigation, And Ask AI Responsive System

**Goal.** Make the global chrome coherent and the assistant responsive, so every page epic inherits a stable frame. Remove header clutter, fix the docked-panel layout breakage, rebuild Ask AI on AI Elements with compact/docked/expanded/mobile states and no provider/debug labels.

**Files involved.** `apps/web/src/components/openbooks/AppShell.tsx` (left nav, top header with global `Search`, month chip, Ask AI pill, mobile drawer); `apps/web/src/components/openbooks/OpenBooksAIChat.tsx` (docked panel body + header; remove user-facing status/provider text); `apps/web/src/components/openbooks/CommandPalette.tsx` (promote as the search replacement); `apps/web/src/components/openbooks/AskAIScreen.tsx` and `apps/web/src/app/ask-ai/page.tsx`; `apps/web/src/lib/openbooks/content.ts` (`appRoutes`/`mobileRoutes`/`settingsRoute`); `apps/web/src/app/layout.tsx`, `apps/web/src/app/[section]/page.tsx`, `apps/web/src/app/settings/[section]/page.tsx`; `apps/web/src/lib/openbooks/ai.ts` (streaming hooks, `OPENBOOKS_AI_EVENT`, `frontendAiStatus`). New `AskAIWidget` built on a new `apps/web/src/components/ai-elements/` set (Conversation, Message, PromptInput, Suggestion, Sources, Tool). Adjust the global header injected via `AppScreen.tsx:48-55` and `primitives.tsx` `PageHeader`.

**Subagent scope.** One shell/AI agent. It owns the frame and the assistant but **must preserve the Convex agent wiring and streaming** in `ai.ts` / `OpenBooksAIChat.tsx` — it re-skins onto AI Elements rather than rewriting the data path. It removes the body-level "Demo entity" chip and entity eyebrow noise from `AppScreen.tsx` (replace with a subtle, environment-safe indicator if any). It defines which panels are sticky (left nav, settings nav) vs independently scrolling (content, chat thread).

**Allowed edits.** Shell, header, nav config, command palette, the AI chat component and its AI Elements layer, the app-router layout files, and the page-header primitive. No edits to the eight page bodies (those are Epics 3–6) beyond removing the shared header clutter they currently inherit.

**Validation expected.** `pnpm typecheck && pnpm lint`; e2e `tests/e2e/app-shell.spec.ts` and `tests/e2e/ai-chat.spec.ts` / `ask-ai-parity-h2.spec.ts` stay green (update assertions where intentionally changed); screenshots of Ask AI in compact, docked, expanded, and 390px mobile-drawer states with no header/content overflow; proof that no `Bedrock`/provider/debug string is user-visible.

**Risks.** Streaming regressions if the AI Elements swap touches the message-status path; command-palette losing parity with the removed global search; sticky/scroll changes causing overflow at edge widths. Ask AI parity e2e is the guardrail.

**Done-when.** Header is decluttered, command palette replaces the bulky search, Ask AI is collapsible/docked/expandable/mobile-usable with streaming intact and zero debug labels, settings nav stays usable while content scrolls, and shell e2e + AI parity specs are green with screenshots.

---

### Epic 3 — Transactions And Inbox Workbenches

**Goal.** Make Transactions the full-width universal register and Inbox a focused exception queue, both assembled from Epic 1 primitives, with detail panels closed by default.

**Files involved.** `apps/web/src/components/openbooks/CoreScreens.tsx` (`TransactionsScreen` from line 717; `InboxScreen` lines 344-715); routing in `AppScreen.tsx:58-59`; read-models `convex/coreViews.ts` (transactions query line 374, row shape 464-503; inbox query 291-372). The DashboardScreen (lines 51-342) also lives here but is a card surface, not a workbench — Epic 3 should at minimum make its cards deep-link with filters into Transactions; a fuller dashboard rebuild can ride along or defer.

**Subagent scope.** One register agent. Transactions: full-width `OpenBooksDataTable` by default; `DetailSheet` opens only on row click (delete the `?? data.rows[0]` fallback near line 746); `FilterBar` + `AccountMultiSelect` + `DateRangeControl` (account/source, date presets+custom, income/expense direction, category, contact, needs-attention, AI-confidence, receipt); bulk approve/exclude/recategorize/attach-receipt/export via the bulk toolbar; `ExportMenu` (selected/filtered/full); row detail shows evidence, memo, AI insight, ledger lines, source, audit, rerun-AI, post-if-allowed. Inbox: grouped by work type (categorize, receipt match, transfer match, question, bill evidence, duplicate, low confidence); resilient two-pane review that does not overflow on receipt-match detail; preserve J/K keyboard nav and batch confirm; remove the `?? inbox.items[0]` auto-open.

**Allowed edits.** `CoreScreens.tsx` (Transactions, Inbox, Dashboard deep-links). May extend Epic 1 primitives if a real gap surfaces, returning that as a primitive change. **Backend contracts stay intact** unless a missing field is genuinely required, in which case it is flagged for an explicit `coreViews.ts` change.

**Validation expected.** `pnpm typecheck && pnpm lint && pnpm test:unit`; e2e `tests/e2e/core-screens.spec.ts` and `tests/e2e/inbox-h2.spec.ts` green (J/K, category correction, rule save, confirm/post, batch confirm preserved); screenshots proving full-width table with closed detail, then open-on-click, and a non-overlapping Inbox receipt-match panel at 390/768/1440/1758.

**Risks.** Inbox keyboard/batch regressions; transactions filter/query mismatch with `coreViews.ts` row fields; detail-panel post/rerun-AI actions must keep "AI proposes, ledger posts" intact (no client-side posting).

**Done-when.** Transactions is full-width with detail closed-until-click and the full filter/export/bulk set; Inbox is a grouped, overflow-free, keyboard-and-batch queue; existing core/inbox e2e stay green; screenshots captured.

---

### Epic 4 — Income And Expenses Workbenches

**Goal.** Turn Income and Expenses into analytical lenses over the same records (not duplicate registers), each consistent with the Transactions interaction language.

**Files involved.** `apps/web/src/components/openbooks/IncomeScreen.tsx` + `convex/incomeViews.ts`; `apps/web/src/components/openbooks/ExpensesScreen.tsx` + `convex/expensesViews.ts` (`expensesViews.test.ts` exists as a guardrail); routing in `AppScreen.tsx:60-61`.

**Subagent scope.** One lens agent (Income and Expenses can be two sibling subagents under one run since they share no files). Each gets `KpiStrip` + tabbed views + shared `FilterBar`/`DateRangeControl`/`AccountMultiSelect` + `OpenBooksDataTable` + `DetailSheet` + `ExportMenu`, all from Epic 1. Income views: Payments, Invoices, Customers, Streams, Receivables; KPIs received/open AR/overdue AR/avg-days-to-pay/recurring. Expenses views: Transactions, Categories, Vendors, Recurring, Evidence-Needed; KPIs spent/recurring/uncategorized/missing-evidence/top-vendor; `EvidenceUpload` on rows; **expenses stay neutral, never alarm-red**, and any non-system accent (the brief flags a purple category dot) is removed in favor of brand-green/neutral.

**Allowed edits.** `IncomeScreen.tsx`, `ExpensesScreen.tsx`. Backend read-models edited only if a KPI/view needs a field the query does not return, flagged explicitly for `incomeViews.ts`/`expensesViews.ts`.

**Validation expected.** `pnpm typecheck && pnpm lint && pnpm test:unit` (including `convex/expensesViews.test.ts`); e2e `tests/e2e/income-expenses-bills.spec.ts` green; screenshots of each tab at gate widths; a grep-clean check that no purple/violet/indigo accent remains in these screens.

**Risks.** Income/Expenses silently duplicating Transactions truth instead of filtering the same records; KPI numbers disagreeing with Reports (must trace to journal lines); recurring/aging math correctness.

**Done-when.** Both screens share the workbench language, present their KPI strips and tabbed lenses over the same underlying records, drill into Transactions consistently, contain no design-system-violating color, and existing e2e stay green with screenshots.

---

### Epic 5 — Bills / Accounts Payable And Contacts Directory

**Goal.** Reframe Bills as an AP workbench and Contacts as a full-width directory, both with detail panels closed by default.

**Files involved.** `apps/web/src/components/openbooks/ModuleScreens.tsx` (`BillsScreen:473`, `BillMatchPicker:812`, `AddBillModal:875`, `ContactsScreen`; routing `ModuleScreens.tsx:1918` and `AppScreen.tsx:62-63`); `apps/web/src/components/openbooks/module-helpers.ts` (`BillRow:142`, bills view shape 16-52, `ContactRow:115`, `statusLabel:186`); `convex/moduleViews.ts` (`billRows:328`, `billGroups:348`, bills KPIs 499, contacts overview); `convex/bills.ts` (`matchCandidates:137`, `markPaid:179`, `createBill:302`); `convex/schema.ts` (bills table 504); `CommandPalette.tsx` (contact quick-nav).

**Subagent scope.** One AP/directory agent (Bills and Contacts are sibling subagents sharing only `ModuleScreens.tsx`/`module-helpers.ts`, so coordinate or split the file carefully). Bills: KPI strip (open, overdue, due-soon, paid this period, missing evidence, avg-days-to-pay); table columns vendor/bill#/due/amount/status/category/evidence/payment-match/source/AI-confidence; filters vendor/status/due-window/category/evidence-missing/amount/date; row drawer with original evidence, extracted fields, payment schedule, matched transaction, ledger impact, approval history; preserve `createBill`/`markPaid`/`matchCandidates` mutations. Contacts: full-width directory by default; profile `DetailSheet` opens only on selection; filters customers/vendors/employees/contractors/open-AR/open-AP/recurring/recently-active; columns name/type/aliases/open-AR/AP/this-year-volume/last-activity; detail with receivables, payables, history, aliases, rules, notes, archive (soft, not destructive).

**Allowed edits.** `ModuleScreens.tsx` (Bills, Contacts), `module-helpers.ts`. Convex mutation/read-model edits only if a required field/action is missing, flagged for `moduleViews.ts`/`bills.ts`. Money stays integer minor units; posted entries immutable.

**Validation expected.** `pnpm typecheck && pnpm lint && pnpm test:unit`; e2e `tests/e2e/income-expenses-bills.spec.ts` and `tests/e2e/modules.spec.ts` green; screenshots of full-width directory with closed-then-open profile, AP table + bill drawer, at gate widths.

**Risks.** Bill match/payment posting paths regressing; destructive delete leaking in where soft-archive is required; `ModuleScreens.tsx` being a large shared file edited by two concerns at once (sequence the two within the run if needed).

**Done-when.** Bills is a filterable, exportable AP workbench with a non-overflowing bill drawer and intact match/pay mutations; Contacts is a full-width directory with closed-by-default profile and soft archive; module e2e green with screenshots.

---

### Epic 6 — Payroll, Reports, And Settings Polish

**Goal.** Bring the three remaining surfaces into the shared language: clarify the Payroll run/statement workflow, keep Reports ledger-backed with stable period selection and drill-down, and make Settings an administrative surface with sticky nav and no overflowing tables.

**Files involved.** Payroll: `ModuleScreens.tsx` (`PayrollScreen:937`, `PayrollEmployees:1018`, `PayrollRuns:1063`, `PayrollRunDetail:1119`, `PayrollRunStatement:1339`; routing `:1919`, `AppScreen.tsx:65`); `convex/moduleViews.ts` (payroll overview 432-535); `convex/payroll.ts` (`runDetail:123`, `startRun:253`, `approveRun:379`, `markRunPaid:594`, `statement:644`); `convex/payrollMath.ts`; `convex/schema.ts` (employees 517, payrollRuns 527, payrollRunLines 550). Reports: `apps/web/src/components/openbooks/ReportsScreen.tsx`; `apps/web/src/lib/openbooks/report-periods.ts`; `apps/web/src/lib/openbooks/reports-export.ts`; `convex/reportViews.ts`; routing `AppScreen.tsx:65`. Settings: `SettingsScreen.tsx`; `apps/web/src/lib/openbooks/settings-sections.ts`; `apps/web/src/app/settings/page.tsx` and `settings/[section]/page.tsx`; all of `apps/web/src/components/openbooks/settings/*` (Business/Tax/Connections/Ai/Categories/Rules/Notifications/Team/Data/Audit); `PlaidConnectionPanel.tsx`, `StripeConnectionPanel.tsx`.

**Subagent scope.** Three sibling subagents under one run (Payroll, Reports, Settings touch mostly disjoint files; only Payroll shares `ModuleScreens.tsx`/`moduleViews.ts` with Epic 5 and so must run after Epic 5 lands). Payroll: period selector (month/quarter/custom/statement), Runs/People/Statements/Contractors tabs in shared table/detail pattern, and clearly state whether run creation is automatic, manual, or imported. Reports: stable period selection via `report-periods.ts`; clicking a report line drills into filtered Transactions/Income/Expenses; ensure the docked Ask AI (Epic 2) no longer squeezes report layouts. Settings: sticky section nav with scrolling content; tables that never overflow their cards (adopt `OpenBooksDataTable` responsive behavior); simplify Plaid/Stripe connection cards and de-jargon the AI settings.

**Allowed edits.** The Payroll/Reports/Settings screens and their settings subcomponents; the two connection panels (UI only — no live keys, sandbox/test-mode only). Backend edited only for a genuinely missing field, flagged per read-model.

**Validation expected.** `pnpm typecheck && pnpm lint && pnpm test:unit` (incl. `convex/payroll.test.ts`); e2e `tests/e2e/reports-payroll.spec.ts`, `tests/e2e/reports.spec.ts`, `tests/e2e/reports-export-h2.spec.ts`, `tests/e2e/settings.spec.ts` green; screenshots of Settings with sticky nav + non-overflowing tables, Reports with Ask AI docked open (no squeeze), and Payroll run/statement flow at gate widths.

**Risks.** Reports must continue to agree with workbench numbers (journal-line backed); payroll math/posting must not regress; settings table overflow is the known defect to eliminate; connection panels must keep sandbox/test-mode safety and expose no secrets.

**Done-when.** Payroll workflow is legible and tabbed in the shared pattern; Reports has stable periods + drill-down and survives the docked assistant; Settings has sticky nav and overflow-free tables with simplified connections; the relevant e2e suites are green with screenshots.

---

### Epic 7 — Responsive QA, Screenshots, And Full Evidence

**Goal.** Prove the whole system holds together: no overflow or overlap at any gate width, consistent interaction language across all data-heavy pages, and a complete green validation pass. No new features — only QA, fixes for defects found, and evidence capture.

**Files involved (mostly read; targeted fixes only).** All twelve surfaces; `tests/e2e/*` (extend `app-shell.spec.ts`, `core-screens.spec.ts`, `income-expenses-bills.spec.ts`, `modules.spec.ts`, `reports-payroll.spec.ts`, `settings.spec.ts`, `ai-chat.spec.ts` with width-matrix assertions); `playwright.config.ts`; evidence under `docs/finishing/evidence/`.

**Subagent scope.** One QA agent plus one screenshot agent. Sweep every surface at 390/768/1306/1440/1758 for horizontal overflow and text overlap (Inbox receipt match, Ask AI messages, Settings tables, Reports, transaction detail). Confirm acceptance invariants: full-width Transactions/Contacts with detail closed until selection; shared table/filter/export/detail language across Bills/Income/Expenses/Contacts/Payroll/Transactions; date-range present wherever time-based data is; export present wherever tabular financial data is; Ask AI collapsible/expandable/mobile-safe with no debug labels. Any defect found is a small, contained fix within Epic 7 scope.

**Allowed edits.** Small targeted layout/overflow fixes anywhere they surface; new/extended e2e specs; evidence files. No new surfaces or workflows.

**Validation expected.** Full green `pnpm verify` (`typecheck && lint && build && test:unit`); `pnpm test:e2e` green with the Playwright HTML report written to `docs/finishing/evidence/playwright-report`; a final before/after screenshot matrix (12 surfaces × 5 widths) committed to `docs/finishing/evidence/`; a written acceptance-gate checklist mapping each gate from the brief to its proof.

**Risks.** Late-discovered cross-page inconsistency forcing a primitive change (would loop back to Epic 1 semantics); e2e flakiness masking real overflow; build-time regressions only `pnpm build` catches.

**Done-when.** Every acceptance gate has linked evidence, `pnpm verify` and `pnpm test:e2e` are green (or every failure is explained with a fix), and the full responsive screenshot matrix is captured.

---

### Workflow Shape

**Run model.** Because workflows cannot pause for input, the implementation is **eight separate approved workflow runs**, one per epic. Each run returns an evidence pack (changed files, validation output, screenshots, risks, recommendations); Ansar reviews and approves; the next run launches. This converts "approval gates" into "run boundaries."

**Agents per run and roles.**

- **Epic 0:** 2 agents — screenshot-capture + read-only auditor. Output is evidence + a defect-to-epic map. No product edits.
- **Epic 1:** 1 agent — primitives builder. Highest-leverage, single-owner, no page contention.
- **Epic 2:** 1 agent — shell + Ask-AI/AI-Elements, preserving streaming.
- **Epics 3–6:** 1 lead agent per run, fanning out to **sibling subagents only where files are disjoint** — Epic 4 (Income | Expenses), Epic 5 (Bills | Contacts, both in `ModuleScreens.tsx` so coordinated), Epic 6 (Payroll | Reports | Settings).
- **Epic 7:** 2 agents — QA sweeper + screenshot capture.

**Execution order (sequential spine).**

1. **Epic 0** (baseline) — sequential, first.
2. **Epic 1** (primitives) — sequential, must fully land and be approved before any page epic, because pages assemble from these primitives.
3. **Epic 2** (shell + Ask AI) — runs after Epic 1 (it consumes `CommandPalette`, `AskAIWidget`, and the page-header changes) and before the page epics, because every page renders inside the shell and inherits its header decisions.
4. **Epics 3, 4, 5, 6** — the **parallelizable band**. Once primitives (Epic 1) and shell (Epic 2) exist, these page epics touch largely disjoint files (`CoreScreens.tsx`, `IncomeScreen.tsx`+`ExpensesScreen.tsx`, `ModuleScreens.tsx`+`module-helpers.ts`, `ReportsScreen.tsx`+`SettingsScreen.tsx`). They can be approved and run concurrently as independent runs, with one ordering constraint: **Epic 6's Payroll shares `ModuleScreens.tsx`/`convex/moduleViews.ts` with Epic 5's Bills/Contacts**, so Epic 6 should start after Epic 5 merges (or the two coordinate on that file). Income vs Expenses (Epic 4) and Bills vs Contacts (Epic 5) can fan out as sibling subagents inside their run.
5. **Epic 7** (responsive QA + full evidence) — sequential, last, after all page epics merge.

**What is parallel vs sequential.**

- **Sequential and blocking:** Epic 0 → Epic 1 → Epic 2 → (page band) → Epic 7. Epic 1 is the hard gate; never start a page epic against unbuilt primitives.
- **Parallel:** within the page band, Epics 3/4/5 run concurrently; Epic 6 joins once Epic 5's `ModuleScreens.tsx` work has merged. Inside each page run, disjoint-file subagents (Income/Expenses, Payroll/Reports/Settings) run in parallel.

**Concurrency cap guidance.** Keep **no more than 3 page epics in flight at once**, and **at most 2–3 subagents per run**. The binding constraint is shared-file contention (`ModuleScreens.tsx`, `module-helpers.ts`, `moduleViews.ts`, `AppScreen.tsx`, `primitives.tsx`) plus the single shared Convex backend and demo dataset — not CPU. Any subagent needing a primitive change must funnel it back through Epic 1 semantics rather than forking a local copy, or the "consistent interaction language" gate fails.

**Acceptance evidence required before advancing each epic.**

- **Before leaving Epic 0:** the green pre-change `verify` baseline + the 12×5 baseline screenshot matrix.
- **Before leaving Epic 1:** primitive harness screenshots (responsive + empty/loading/error) and clean `typecheck`/`lint` + helper unit tests; APIs validated against ≥3 real row contracts.
- **Before leaving Epic 2:** Ask AI compact/docked/expanded/390px screenshots, `app-shell.spec.ts` + Ask-AI parity green, and proof that no provider/debug label is user-visible.
- **Before leaving each page epic (3–6):** the owning e2e specs green (`core-screens`/`inbox-h2`; `income-expenses-bills`; `modules`; `reports-payroll`/`reports`/`settings`), `pnpm test:unit` green, and screenshots at all five gate widths showing full-width tables with detail closed-until-click and no overflow/overlap.
- **Before declaring done (Epic 7):** full green `pnpm verify` + `pnpm test:e2e` with the HTML report under `docs/finishing/evidence/playwright-report`, the complete before/after responsive matrix, and a gate-by-gate acceptance checklist with linked proof.

This shape keeps the irreversible, foundation-setting work (primitives, shell) single-owner and sequential, lets the high-volume page work parallelize safely once the foundation exists, and ends with one consolidated QA run that produces the evidence pack Ansar reviews to call the redesign complete.

---

## 10. Acceptance Gates And Evidence Checklist

Verification commands for this repo (all run from the repo root, `pnpm` workspace): **`pnpm lint`** (`eslint`), **`pnpm typecheck`** (`tsc --noEmit`), **`pnpm test`** (vitest unit, `tests/*.test.ts`), and **`pnpm test:e2e`** (Playwright, `testDir: ./tests/e2e`, single worker, `webServer` boots `@openbooks/web` on `:3100`). Note for the report: the audit prompt says "Playwright under `apps/web/tests/`" but the actual suite lives at the **repo-root `tests/e2e/`** — there is no `apps/web/tests/`. Screenshot evidence lands in **`docs/finishing/evidence/`** (`FINISHING_EVIDENCE`, `helpers.ts:3`); the HTML report at `docs/finishing/evidence/playwright-report`. The reusable guards are `expectNoHorizontalScroll(page, width)` and `expectClickable(locator)` in `tests/e2e/helpers.ts`.

**Coverage gap to flag up front:** current evidence proves only **390px** (mobile pack, `acceptance-h2-pack.spec.ts:78`) and **1440px** (`:34`). There are **no artifacts at 768, 1306, or 1758**. Every gate below that names those widths is currently unproven and must be added to `acceptance-h2-pack.spec.ts` (or a new `responsive-h5.spec.ts`).

| # | Gate (pass condition) | Evidence artifact required | Verification command |
|---|---|---|---|
| G1 | **No horizontal overflow at 5 widths** on every surface (dashboard, inbox, transactions, income, expenses, bills, contacts, payroll, reports, settings, ask-ai). | `expectNoHorizontalScroll(page, w)` asserted for w ∈ {390, 768, 1306, 1440, 1758} on each route; one screenshot per (route × width). Today only 390/1440 exist — add 768/1306/1758. | `pnpm test:e2e -- acceptance-h2-pack` (extend) |
| G2 | **No text overlap in Inbox receipt match** — vendor/merchant/category (`CoreScreens.tsx:603/628/640`) and the 3-button action row (`:675`) do not collide at 390/768/1306. | Screenshots `…-mobile-inbox.png` (exists, 390) + new `…-inbox-768.png`, `…-inbox-1306.png`; assertion that `inbox-list` and detail are both reachable (drawer opens on row tap). | `pnpm test:e2e -- acceptance-h2-pack`, `inbox-h2` |
| G3 | **No text overlap in Ask AI** — header controls, wrapped suggestion chips, inline assistant tables (`OpenBooksAIChat.tsx:750/871`, `MarkdownBlocks:221`) at docked-380px and mobile-sheet. | `…-mobile-ask-ai.png` (exists) + docked screenshot at 1306 with AI open over Reports; assert thread switcher reachable on mobile sheet. | `pnpm test:e2e -- ask-ai-parity-h2`, `ai-chat` |
| G4 | **No overlap in Settings tables** — Audit `grid-cols-[120px_120px_1fr]` (`AuditSection.tsx:77`), Rules inline controls (`RulesSection.tsx:111`), Stripe payouts (`StripeConnectionPanel.tsx:236`) at 1306 **with AI open** and at 390. | Screenshot of `/settings/audit` and `/settings/rules` at 1306 (AI open) + 390 drill-in; assert no element overflows its card. | `pnpm test:e2e -- settings`, `audit-h2` |
| G5 | **No overlap in Reports** — P&L monthly grid + GL/Trial Balance/Journal inside their `overflow-x-auto` wrappers (`ReportsScreen.tsx:472,704,778,814,849,894`) at 1306/1440 with AI open. | `…-D2-pnl-viewer.png` (exists) re-shot at 1306 AI-open; inner-scroll-not-page-overflow assertion. | `pnpm test:e2e -- reports`, `reports-export-h2` |
| G6 | **No overlap in transaction details** — two-pane `xl:grid-cols-[1fr_380px]` (`CoreScreens.tsx:980`) and inline category `<Select>` (`:1021`); table wrapper scrolls (not `overflow-hidden`). | Drawer/aside screenshot at 1306 + 390 (bottom drawer); assert table wrapper has horizontal scroll, columns not clipped. | `pnpm test:e2e -- core-screens` |
| G7 | **Transactions + Contacts render full-width with detail closed by default.** | First-paint screenshot of `/transactions` and `/contacts` at 1440 showing full-width table, no aside; test asserts `transaction-drawer`/`contact-profile` not visible until a row is clicked. | `pnpm test:e2e -- core-screens`, `modules` |
| G8 | **Consistent table/filter/export/detail language** across Bills, Income, Expenses, Contacts, Payroll, Transactions (same filter bar idiom, same export control, same detail open pattern). | A cross-surface assertion test: each surface exposes a search input, a date-range control, an export control where tabular, and a detail affordance; screenshot grid of all six headers. | `pnpm test:e2e -- income-expenses-bills`, `modules`, `reports-payroll` |
| G9 | **Consistent date ranges** — same period/range control vocabulary and defaults across surfaces and Reports (`reports-export` filename proves `2026-01-01-to-2026-12-31`, `acceptance-h2-pack.spec.ts:66`). | Assert each surface's range selector offers the same option set; export filename matches the active range. | `pnpm test:e2e -- reports-export-h2`, `income-expenses-bills` |
| G10 | **Local search present** on every tabular surface and reachable on mobile (header search is `md:flex` only `AppShell.tsx:434`, bottom nav has no search — currently fails at 390). | Test that a search affordance is visible/operable at 390 on each surface; ⌘K reachable on mobile. | `pnpm test:e2e -- app-shell`, `core-screens` |
| G11 | **Export available where tabular** (Income/Expenses/Bills/Contacts/Payroll/Transactions/Reports), produces a file. | `waitForEvent("download")` assertion per surface (pattern already proven for Reports JSON, `acceptance-h2-pack.spec.ts:63-67`). | `pnpm test:e2e -- acceptance-h2-pack`, `reports-export-h2` |
| G12 | **Ask AI: collapse / open / expand / mobile drawer + no provider labels.** Panel opens via button + ⌘J (`A4b`, `app-shell.spec.ts:244`); page mode expands; mobile sheet works; **no "Anthropic/Bedrock/provider" badge** rendered. | Screenshots `…-B5-docked-desktop.png`, `…-B5-mobile-sheet.png` (exist); add expand (`/ask-ai`) shot; text assertion that no provider name appears in `ai-panel`. | `pnpm test:e2e -- ai-chat`, `ask-ai-parity-h2`, `app-shell` |
| G13 | **Dashboard matches or improves prototype** — account chips wrap (`flex-wrap` per `Dashboard.dc.html:122`), hero figures don't overflow (`StatCard` `min-w-0`), bar chart has a scroll fallback. | `…-H1-core-mobile-dashboard.png` + `…-D5-dashboard.png` (exist) re-validated against prototype; overflow guard at 390. | `pnpm test:e2e -- core-screens`, `prototype-copy` (vitest `tests/prototype-copy.test.ts`) |
| G14 | **Settings subnav is sticky** — currently `w-[190px]` with **no** `sticky` (`SettingsScreen.tsx:152-154`, parent `lg:items-start :151`), so it scrolls away. | Test scrolls a long Settings section and asserts `settings-subnav` is still in viewport; before/after screenshot at 1440. | `pnpm test:e2e -- settings` |
| G15 | **Desktop + mobile screenshots captured** for every surface at the audited widths. | Full set in `docs/finishing/evidence/`: desktop (1440 today; add 1306/1758) + mobile (390) per route. Currently partial — mobile only for dashboard/inbox/transactions/ask-ai. | `pnpm test:e2e` (full suite writes to `FINISHING_EVIDENCE`) |
| G16 | **Tests green + clean build.** | Passing run logs / HTML report at `docs/finishing/evidence/playwright-report`; `verify` script chains all four. | `pnpm verify` (= `pnpm typecheck && pnpm lint && pnpm build && pnpm test:unit`) **plus** `pnpm test:e2e` |

**Definition of done for the responsive epic:** G1–G16 all green, with the missing 768 / 1306 / 1758 artifacts added to `tests/e2e/` and written into `docs/finishing/evidence/`, and the four code-level blockers fixed and asserted — (a) `overflow-hidden` → `overflow-x-auto` on the Transactions/Income/Expenses table wrappers, (b) mobile card-stack / bottom-drawer reflow for all dense tables, (c) `sticky` Settings subnav, and (d) mobile search reachability. `pnpm lint` and `pnpm typecheck` must pass with zero new warnings before any screenshot evidence is accepted.

---

## 11. Risks, Open Questions, And Decisions Needed From Ansar

This section converts the per-surface audits into the genuine forks a founder has to resolve before the 12-surface redesign starts. It is split into **Risks** (things that can go wrong if we proceed naively), **Open Questions** (facts we cannot settle from the code alone — they need your knowledge of intent or a backend spike), and **Decisions Needed** (crisp either/or calls, each with a recommended default so you can approve by exception).

The throughline: several audit recommendations assume design tokens, dependencies, and backend fields that **do not exist yet**. The verifiers caught this repeatedly. So the first real decision is not visual — it is how much net-new plumbing you are authorizing.

### 11.0 Decisions resolved with Ansar (2026-06-13)

These four were answered directly and now govern the implementation phase:

- **Contacts removal → soft-archive only.** No destructive delete. Archiving sets a flag, drops the contact out of the default directory (restorable), and preserves all transaction / money-owed / money-owing history and the audit trail. This is consistent with the immutable-ledger philosophy. Implementation: add an `archived` state + an "Archived" filter, never a hard delete path.
- **New frontend dependencies → approved.** Install the Vercel AI SDK + AI Elements (for the Ask AI rebuild, Section 7) and the missing shadcn primitives (`drawer`, `calendar`, `popover`, `checkbox`, `scroll-area`, `toggle-group`). Pin versions; sandbox/test keys only; no secrets in the client.
- **Payroll auto-runs → wanted, and verified absent today (net-new backend work).** Ansar's intent is that pay runs should be created automatically. Verification result: **they are not.** The only scheduled job in the system is a Plaid sync every 4 hours (`convex/crons.ts:7`); there is no payroll cron or scheduler. Runs are created solely by the explicit `startRun` mutation (`convex/payroll.ts:253`), fired by a user clicking a period button (`ModuleScreens.tsx:941`); `startRun` generates lines from the active employee roster (salary × FX), so today's reality is *manual "generate this period's run from employees,"* not an import and not automatic. There is no payroll-register import anywhere. **Decision:** add a net-new backend capability — a scheduled function (a cron, or a per-entity pay-schedule) that drafts each period's run from the roster for review — and design the Runs UI around an explicit `Auto-draft · needs review` vs `Manual` status so the source of every run is legible. Treat this as a backend spike that precedes/accompanies Epic 6 (Payroll). Until it ships, the UI must honestly present runs as manually generated rather than implying automation that does not exist.
- **Process → review-first.** No implementation workflow launches until Ansar approves this report. The payroll auto-run backend spike is included in that approval scope.

The remaining items below (R1–Rn risks, open questions, and the other either/or decisions) are still open and stand as written.

### 11.1 Risks

**R1 — The redesign's color prescriptions don't compile today.** The audits repeatedly prescribe `--negative (#d92d20)` / `--negative-surface (#fef3f2)` and an `--ai` token and an `--ob-green` tint ramp as "just use the token." None of these exist. `apps/web/src/app/globals.css:73-80` defines only `--positive`, `--warning`, `--info`, and `--chart-1..5`; there is no `--color-negative`, so `text-negative`/`bg-negative` would fail to build. Grep for `ob-green` and `--ai` across `apps/web/src` returns zero hits. If we hand implementers the audit verbatim, they will write classes that silently do nothing. **The token layer must be defined in `globals.css` as step zero, before any surface is restyled.**

**R2 — Regressions to a large, currently-green test suite.** There are 20+ Playwright specs in `tests/e2e/` (core-screens, reports, inbox-h2, ai-chat, modules, income-expenses-bills, settings, ledger, acceptance-h2-pack, entity-scope-g5, etc.) plus `vitest` unit tests including a `prototype-copy.test.ts`. Several surfaces are byte-faithful reproductions of the prototype (Expenses, Settings, the header). A redesign that changes DOM structure, headings, or copy will break selectors and the prototype-parity assertions. **Any 12-surface redesign needs a test-update budget, not just a UI budget — and `prototype-copy.test.ts` will actively fight changes that diverge from the prototype.**

**R3 — Money color/sign correctness, not just aesthetics.** Multiple surfaces bake financial semantics into the wrong layer. The Inbox backend hardcodes a negative on document totals (`coreViews.ts:327`, `-document.totalMinor`) so receipts always look negative and money-in never shows `+`. Transactions passes a blanket `signed` flag to every `<Amount>` (`TransactionsScreen` line 1034), contradicting the AGENTS.md rule that ordinary expenses stay neutral, not red. The Contacts directory sums revenue and spend into one `totalThisYearMinor` (`moduleViews.ts:223-232`) and nets AR against AP into one balance cell (`ModuleScreens.tsx:236`), which is actively misleading for a contact who is both customer and vendor. **These are correctness bugs in the data/view layer; a purely visual redesign will inherit them and make them look polished.**

**R4 — Demo-date and data-shape fragility.** `expensesViews.ts:7` hardcodes `TODAY = '2026-06-11'` with fixed June/May 2026 periods. The header month chip is a frozen literal `'Jun 2026'` (`AppShell.tsx:445`). Both happen to be correct today (2026-06-13) and will be wrong on July 1. Several redesign asks (period pickers, recurring projections, "due in 3 days") assume live date math the backend does not yet do. **Surfaces that the redesign makes more date-prominent will expose this staleness more visibly.**

**R5 — Performance ceilings under realistic data.** `coreViews.transactions` does N+1 per-row journalLine fetches and re-scans all fetched journal entries per row (`coreViews.ts:429-453`), quadratic-ish work capped at 120 rows. The AppShell mounts `OpenBooksAIChat` twice (desktop aside + mobile aside, `AppShell.tsx:466-507`), creating two live Convex chat subscriptions and firing any pending prompt into both. **A redesign that adds saved views, larger registers, or richer AI affordances amplifies both costs.**

**R6 — Robustness gaps in state-changing flows.** Inbox `confirmBatch` awaits confirmations in a sequential loop with no error isolation (`CoreScreens.tsx:442-460`) — one rejection aborts the rest. Payroll's `approveRun` posts an immutable journal entry directly from a single button with no `AlertDialog` confirm (`ModuleScreens.tsx:1174`), even though the primitive exists. Transactions CSV import posts every row and detects duplicates (`duplicateCsvCount`, line 778) but imports them anyway. **A redesign that surfaces these as primary actions raises the cost of leaving them un-hardened.**

### 11.2 Open Questions (need Ansar's intent or a backend spike)

**Q1 — How much of each surface is real vs mocked?** The redesign briefs assume data the backend may not expose. Confirmed gaps where the UI wants a field the backend lacks: a **Stripe-customer badge** on Contacts (no `stripe` flag in `ContactRow`/schema), a **90+ aging bucket** on Income receivables (`incomeViews.ts:221-228` stops at 61-90), a **contractor vs employee split** in Payroll (the ledger account is literally "Payroll & Contractors", `payroll.ts:375-376`, commingling both), and an **all-businesses / combined dashboard** (the prototype's `$131,883.16` all-mode hero has no backend concept; `DashboardScreen` always scopes to one `activeEntity`). Before committing layouts, we need a per-surface "real / partial / mock" map so we don't design panels for data we'd have to fabricate.

**Q2 — Is Payroll auto-run / recurring schedule in scope now or future?** `convex/payroll.ts` exposes `markLinePaid` (line 548) but I found no auto-run, recurring-schedule, or scheduled-run-creation concept. Is "create the next payroll run on a schedule" a v1 expectation or explicitly future? This determines whether Payroll gets a schedule surface or stays manual-run-only.

**Q3 — What does "export" mean for this product?** Current exports are CSV + `window.print()` only (`ReportsScreen.tsx`, `ModuleScreens.tsx`, `DemoDataPanel.tsx`). There is **no PDF export** despite the prototype promising "Export PDF" in Payroll and Reports, and **no audit-trail export** (immutable journal-line provenance) anywhere. The reports contract mandates CSV values == on-screen == dashboard tiles for a period. Do we need true PDF and an audit-trail export, or is CSV + browser-print acceptable for v1?

**Q4 — Does the local Ask AI answer engine stay or go?** `ai.ts:235 answerOpenBooksQuestion` is a full deterministic local Q&A engine (tables, AR aging, payroll, proposals) that is **not wired into the chat at all** — `OpenBooksAIChat` only talks to the Convex agent. In degraded/no-provider mode the chat shows a missing-provider state instead of falling back to this engine. Is the local engine intended fallback (wire it in) or dead code (remove it)?

**Q5 — Float math in the Invoice composer.** `IncomeScreen.tsx:368,494` computes subtotal via `Math.round((Number(rate))*100)*quantity` on free-text decimal input, which can produce off-by-one-cent minor units before the mutation. Does `invoices.saveDraft` re-validate amounts server-side? If not, this borderline-violates the "never floats for stored money" rule and needs a backend guard, not a UI tweak.

### 11.3 Decisions Needed (each as an either/or, with a recommended default)

**D1 — Contacts: hard delete vs soft-archive.**
There is no delete or archive mutation in `convex/contacts.ts` today, and contacts are referenced by `contactId` on bills, invoices, transactions, and journal lines.
→ **Recommended default: soft-archive only.** A contact joined to posted ledger history must never be hard-deleted; expose "Archive" (hide from pickers, keep history intact) and reserve hard-delete for contacts with zero references. This matches the immutable-ledger rule.

**D2 — AI SDK + AI Elements as a new dependency.**
`apps/web/package.json` currently has **no** `ai`, `@ai-sdk/*`, or `ai-elements` dependency; the chat is hand-built on the Convex agent. Adding the Vercel AI SDK + AI Elements is net-new surface area (bundle weight, an MIT-licensed but additional dependency tree, and a second streaming abstraction next to the Convex one).
→ **Recommended default: adopt AI Elements components for the chat UI, but keep the Convex agent as the transport.** Use AI Elements for message/markdown/table rendering only; do not introduce a second provider/streaming path. Re-evaluate if it pulls in more than the chat primitives we actually render.

**D3 — Missing shadcn primitives: add the few that are genuinely absent.**
Present already: `alert-dialog`, `command`, `sheet`, `dialog`, `dropdown-menu`, `select`, `tabs`, `table`, `tooltip`, `switch`, etc. (`apps/web/src/components/ui/`). Genuinely missing for the redesign asks: **`popover`, `combobox`, `scroll-area`, `avatar`** (Contacts/Team avatars are currently hardcoded hex pairs).
→ **Recommended default: add only those four.** Do not re-import primitives that already exist; wire the existing `alert-dialog` into Payroll approve and the existing `command` into the palette before adding new ones.

**D4 — Command palette: extend the existing one; saved views are net-new.**
A `CommandPalette.tsx` already exists and is referenced from AppShell/CoreScreens/ModuleScreens — the palette is **not** greenfield. **Saved views** (persisted filter/column states on registers and reports) appear nowhere in code or schema.
→ **Recommended default: ship the command palette in v1 (extend what's there); defer saved views to a fast-follow.** Saved views need a new schema table and per-surface persistence; scope them separately rather than bundling into the visual redesign.

**D5 — Define the token layer before restyling (blocks R1).**
We can either (a) add the missing semantic tokens (`--negative`, `--negative-surface`, an active/AI tint, an `--ai` affordance token) to `globals.css` and wire `@theme inline` utilities, or (b) keep hardcoding hexes per surface.
→ **Recommended default: (a) — define the tokens first.** This is a 1-file foundational change that unblocks every "use the token" recommendation and makes the rest of the redesign mechanical. Without it the audit's headline fixes are unactionable.

**D6 — Demo/entity indicator: keep a subtle one.**
The schema already carries `isDemo` on entities (`schema.ts:51`) plus `demoSeedRuns`/`demoSeedJobs` tables, and `createdBy` can be `'seed'` (`schema.ts:256`).
→ **Recommended default: keep a quiet, non-alarming demo indicator** (a small neutral chip in the header for `isDemo` entities), not a banner. This sets expectations during evaluation without violating the "quiet, ledger-like, no ornament" design rules, and the flag to drive it already exists.

**D7 — Money sign/color policy: codify one rule and enforce in the `Amount` primitive.**
Today some surfaces pass blanket `signed` (Transactions), some bake negatives into the backend (Inbox documents), and some show no tone at all (Dashboard net income, AR/AP). The AGENTS.md rule is clear: money-in may be green, ordinary expenses neutral (not red), genuine alarm (overdue) red.
→ **Recommended default: implement the policy once in `<Amount>` (tone derived from semantic role, not a raw `signed` flag) and remove the hardcoded backend negation in `coreViews.ts:327`.** Decide this before the redesign so every surface inherits one consistent treatment instead of re-litigating per screen.

**D8 — Scope/sequencing of the 12-surface redesign.**
The honest read from the audits: this is not a uniform reskin. Some surfaces are faithful prototype reproductions needing only token migration (Settings, Expenses); others have real correctness bugs that must be fixed regardless of visuals (Inbox sign, Contacts netting, Transactions missing Approve action, Reports quarterly drill leaking a full year at `ReportsScreen.tsx:502`). The missing v1-loop **Approve** action on Transactions (no per-row, bulk, or panel approve anywhere) is arguably a blocker on its own.
→ **Recommended default: two-phase plan.** Phase 1 = token layer (D5) + correctness fixes (R3, the Transactions Approve action, Inbox/Reports drill bugs) on the 4-5 highest-truth surfaces. Phase 2 = the broader visual redesign on the remaining surfaces. Do not attempt all 12 surfaces as one visual pass — the test-regression surface area (R2) and the real bug list make a big-bang risky. Each phase should re-green the e2e suite before the next starts.

---

## Appendix A — Design Token Reference (current design system)

BRAND: One accent green #2ca01c (--ob-green-500 / --primary). Green ramp 50–900 (#f1f8ee→#123f0c). AI affordances = green (--ai #1d6b12), NEVER purple/gradient. NEUTRALS (shadcn oklch): bg oklch(1 0 0), text oklch(0.145 0 0), muted-fg oklch(0.556 0 0), border oklch(0.922 0 0), surface-sunken oklch(0.978 0 0). MONEY SEMANTICS: positive=--ob-green-600 #248716; negative=#d92d20 (overdue/outflow only); warning=#b54708; info=#175cd3. Expenses tone = NEUTRAL muted-foreground, not red. CHARTS: green #2ca01c, teal #0e9384, amber #f79009, slate #475467, red #d92d20. FONTS: Geist (UI, 14px base) + Geist Mono for ALL money/dates/account#, tabular-nums, letter-spacing 0. TYPE SCALE: page title 24/600, metric 30/600 (-0.01em), card title 16/600, body 14, meta 12. SPACING: 4px grid; card pad 16–24; gutters 24–32; grid gap 16. RADII: control 10px, card/dialog 14px, tab 8px, badge/avatar full. BORDERS: 1px foreground/10 ring + shadow-xs on cards. SHADOWS: near-invisible (xs cards, md popovers only). ICONS: lucide only, 16 inline/18-20 nav, 2px stroke, currentColor; AI=sparkles green. LAYOUT: sidebar 232px, content max 1200, header 56px, money right-aligned. NO emoji/gradients/blur/blobs/glassmorphism.

**Enforceable rules.**

- ONE brand green only: #2ca01c via --primary/--ob-green-500. No second accent hue, no off-brand greens (no emerald/lime, no raw text-green-*).
- AI affordances must be brand green (text-primary / --ai), using lucide Sparkles. Never purple, violet, indigo, or any gradient for AI.
- BANNED entirely: gradients (bg-gradient-*, linear/radial-gradient), glassmorphism (backdrop-blur as decoration), decorative blobs, marketing dashboard ornament.
- No emoji and no unicode-as-icon (no ▲ ▼ → ✓ as functional glyphs). Use lucide icons (TrendingUp/Down, ArrowRight, Check) instead.
- Money is always Geist Mono + tabular-nums (money-figures class) with letter-spacing 0. Never proportional figures for amounts.
- letter-spacing must be 0 on money; uppercase eyebrow labels may use tracking-wide, but body/figures never carry tracking.
- Ordinary expenses render NEUTRAL (text-muted-foreground), never alarm red. Red (--negative #d92d20) is reserved for overdue/outflow/destructive states only.
- Use semantic tokens not raw Tailwind/hex: --negative not text-red-600/bg-red-50; --primary not bg-[#248716]; chart tokens not arbitrary hex.
- Category/series colors must come from the chart palette tokens (--chart-1..5: green/teal/amber/slate/red). No ad-hoc purple/plum/blue swatches in data dots.
- Third-party brand colors (e.g. Stripe blurple #635bff) are allowed ONLY on that vendor's own badge/affordance, never as a generic UI or category color.
- Build on shadcn/ui primitives before raw controls (e.g. use Select, not a raw <select> with hand-rolled classes).
- Cards: 1px foreground/10 ring + shadow-xs + 14px radius. No colored left-border accent cards, no glows.
- Mobile must be a real responsive surface, not a horizontally-squeezed desktop table.

---

## Appendix B — Current Architecture Inventory

**Surface → file map.**

| Surface | Component | Files |
|---|---|---|
| Shell | AppShell / AuthenticatedAppShell (sidebar, header, docked AI panel, mobile nav, command palette mount) | apps/web/src/components/openbooks/AppShell.tsx, apps/web/src/app/layout.tsx |
| Dashboard | DashboardScreen | apps/web/src/components/openbooks/CoreScreens.tsx:51, apps/web/src/components/openbooks/AppScreen.tsx:58 |
| Inbox | InboxScreen | apps/web/src/components/openbooks/CoreScreens.tsx:344, apps/web/src/components/openbooks/AppScreen.tsx:59 |
| Transactions | TransactionsScreen | apps/web/src/components/openbooks/CoreScreens.tsx:717, apps/web/src/components/openbooks/AppScreen.tsx:60 |
| Income | IncomeScreen (invoices/AR; note InvoicesScreen also exists at ModuleScreens.tsx:335 but Income route renders IncomeScreen) | apps/web/src/components/openbooks/IncomeScreen.tsx:44, apps/web/src/components/openbooks/AppScreen.tsx:61 |
| Expenses | ExpensesScreen | apps/web/src/components/openbooks/ExpensesScreen.tsx:31, apps/web/src/components/openbooks/AppScreen.tsx:62 |
| Bills | BillsScreen | apps/web/src/components/openbooks/ModuleScreens.tsx:473, apps/web/src/components/openbooks/AppScreen.tsx:63 |
| Contacts | ContactsScreen | apps/web/src/components/openbooks/ModuleScreens.tsx:142, apps/web/src/components/openbooks/AppScreen.tsx:64 |
| Payroll | PayrollScreen | apps/web/src/components/openbooks/ModuleScreens.tsx:937, apps/web/src/components/openbooks/AppScreen.tsx:65 |
| Reports | ReportsScreen | apps/web/src/components/openbooks/ReportsScreen.tsx:1130, apps/web/src/components/openbooks/AppScreen.tsx:66 |
| Settings | SettingsScreen + 10 settings/*Section.tsx sub-surfaces (AiSection, AuditSection, BusinessesSection, CategoriesSection, ConnectionsSection, DataSection, NotificationsSection, RulesSection, TaxSection, TeamSection) | apps/web/src/components/openbooks/SettingsScreen.tsx:51, apps/web/src/components/openbooks/settings/, apps/web/src/lib/openbooks/settings-sections.ts, apps/web/src/components/openbooks/AppScreen.tsx:38 |
| AskAI | AskAIScreen (full page) wraps OpenBooksAIChat (mode='page'); same chat is also docked in AppShell (mode='drawer') | apps/web/src/components/openbooks/AskAIScreen.tsx:15, apps/web/src/components/openbooks/OpenBooksAIChat.tsx:541, apps/web/src/app/ask-ai/page.tsx |

**shadcn primitives present:** shadcn/ui in apps/web/src/components/ui/: alert-dialog, badge, button, card, command, dialog, dropdown-menu, input, label, select, separator, sheet, skeleton, switch, table, tabs, textarea, tooltip, OpenBooks primitives.tsx (apps/web/src/components/openbooks/primitives.tsx): formatMinorMoney(), Amount, StatCard, EmptyState, PageHeader, Sparkline, BarChart, CategoryChip, ConfidenceRing, AgingMiniBar, ReasoningPopover (native <details>), ReviewItem, primitiveIcons, Radix primitives available via 'radix-ui' meta-package (package.json:23) even where no shadcn wrapper exists, cmdk ^1.1.1 (powers command palette via ui/command.tsx), lucide-react ^1.17.0 icon set; one brand green #2ca01c / #17540f / #f1f8ee tokens used inline, react-hook-form + @hookform/resolvers + zod for forms; tailwind-merge + clsx via cn()

**shadcn primitives to add:** drawer, calendar, popover (currently faked with native <details> in primitives.tsx ReasoningPopover:274 and CategoriesSection), checkbox, scroll-area (lists use raw overflow-y-auto, e.g. AppShell nav:655, AI message list:814), toggle-group, field / field-group, input-group, avatar (avatars are hand-rolled inline <span> initials in AppShell ProfileMenu:969 / EntitySwitcher:843), sonner/toast (action results shown via inline state strings, e.g. proposal result cards and aiTestMessage, no toast primitive), form (shadcn Form wrapper absent; RHF used directly), accordion / collapsible (settings + tool cards use native <details>), progress (ConfidenceRing/AgingMiniBar are bespoke SVG)

**AI Elements / AI SDK status.** "No AI Elements / Vercel AI SDK UI components exist in the web app. apps/web/package.json declares no 'ai', '@ai-sdk/*', 'ai-elements', or 'streamdown'. The Ask AI surface is fully custom: OpenBooksAIChat.tsx (918 lines) hand-rolls message bubbles (MessageBubble:421), a bespoke markdown renderer (MarkdownBlocks:199 / InlineMarkdown:171 parsing tables, headings, lists, bold, links — no markdown lib), tool-call cards (ToolPartCard:325 via native <details>), proposal/confirmation cards (ProposalCard:344), a thread rail (ThreadRail:476), and a suggestion-chip composer. Streaming text uses @convex-dev/agent/react's useSmoothText (charsPerSec:220, line 317), not AI SDK. Token-by-token UI primitives (Conversation, Message, Response, Reasoning, Tool) from ai-elements are absent and would all need to be introduced."

**Ask AI wiring.** "OpenBooksAIChat connects to the Convex Agent component, not a generic AI SDK. Streaming/persistence uses @convex-dev/agent/react: useUIMessages(api.aiThreads.listThreadMessages, {threadId}, {initialNumItems:40, stream:true}) (OpenBooksAIChat.tsx:570) for streamed UI messages, useSmoothText for smoothing (line 317), and optimisticallySendMessage(api.aiThreads.listThreadMessages) on the sendMessage mutation (lines 560-562). Thread lifecycle: useMutation api.aiThreads.createThread/deleteThread/sendMessage; useQuery api.aiThreads.listMine (limit 16). Proposals: useQuery api.proposals.listProposals + useMutation confirmProposal/dismissProposal. Provider/debug label IS user-facing: a Badge renders 'Bedrock active' vs 'Degraded mode' (OpenBooksAIChat.tsx:758; AskAIScreen.tsx:45; settings ModuleScreens.tsx:1568). Status derives from useQuery api.ai.providerStatus -> frontendAiStatus() in lib/openbooks/ai.ts (labels 'Bedrock provider is configured' / 'AI provider is not configured'; provider string 'bedrock'/'None connected'). @convex-dev/agent ^0.6.3, @ai-sdk/amazon-bedrock, and 'ai' ^6 live in the ROOT package.json (Convex backend workspace), not apps/web."

**Shell model.** "AppShell.tsx renders AuthenticatedAppShell, which gates on NEXT_PUBLIC_CONVEX_URL, auth (useConvexAuth + dev bypass), and viewer status (loading / needs_onboarding -> OnboardingScreen / ready). Nav comes from lib/openbooks/content appRoutes + settingsRoute; rendered as a fixed left aside (AppShell.tsx:376) that swaps ExpandedSidebar (232px, line 580) vs CollapsedRail (56px icon rail with Radix tooltips, line 717); collapse state persisted in localStorage 'ob:sidebar-collapsed' read post-hydration (line 160) to avoid mismatch. Header is sticky top-0 z-30 h-14 (line 419) with mobile menu button, ⌘K search trigger, a static 'Jun 2026' pill, and the 'Ask AI' button (⌘J). Docked AI: aiOpen state toggles a sticky right aside w-380px h-screen (line 466, desktop lg) AND a separate bottom-sheet mobile aside h-88dvh translate-y (line 492), both rendering OpenBooksAIChat; body scroll locked on mobile when open (line 233). Responsive: lg breakpoint switches sidebar to off-canvas with scrim (line 367) + a fixed bottom 4-tab mobile nav (mobileRoutes + Ask AI, line 509). Content is <main> max-w-1200px (line 463). Keyboard: ⌘K palette, ⌘J AI (line 204). Cross-surface 'openbooks:ask-ai' CustomEvent (OPENBOOKS_AI_EVENT) lets any surface open the panel with a prompt/reportPack (line 221). Entity switching via EntitySwitcher dropdown + ActiveEntityProvider context."

**Existing shared primitives.** "primitives.tsx (339 lines, imported by ~15 surfaces) supplies the only cross-surface design layer: money (formatMinorMoney, Amount with income/expense tone), layout (PageHeader eyebrow/title/description/actions; EmptyState icon/title/description/action; StatCard label/value/detail/trend), data viz (Sparkline, BarChart, ConfidenceRing, AgingMiniBar — all bespoke SVG/divs), chips (CategoryChip active state), AI affordances (ReasoningPopover via <details>, ReviewItem inbox card). CommandPalette.tsx provides the ⌘K palette (cmdk) reusing existing coreViews.transactions + moduleViews.overview queries with static report/nav lists. useActiveEntity() context (lib/openbooks/active-entity) shares the selected entity/workspace/role across surfaces. lib/openbooks/content.ts centralizes appRoutes/mobileRoutes/settingsRoute. lib/openbooks/ai.ts centralizes AiStatus + autonomy options + the (now legacy) client answerOpenBooksQuestion fallback. module-helpers.ts holds shared ModuleOverview types. No shared Table/List/Filter/Form/Toast wrappers exist — each large surface file re-implements its own."

**Convex hooks.** "Reads via convex/react useQuery: coreViews.dashboard/inbox/transactions, expensesViews.overview, reportViews.reportPack, moduleViews.overview/activeEntityId, invoices.detail, bills.matchCandidates, payroll.runDetail, session.viewer, entities.list, ai.providerStatus, proposals.listProposals, aiThreads.listMine. Writes via useMutation: pipeline.routeTransaction/splitTransaction/excludeTransaction/createRuleFromTransaction, receipts.*, bills.createBill/markPaid, payroll.*, invoices.*, categories.createCategory, ai.setConfig/recordCategorizationEvalRun, aiThreads.*, proposals.confirm/dismiss. Actions via useAction: bedrockCategorizer.categorizePendingTransactions, semanticMemory.*, receipts.extractWithBedrock, ai.testProviderConnection, stripe.sendInvoiceViaStripe. Plus @convex-dev/auth/react useConvexAuth/useAuthActions and a custom useActiveEntity() context."
