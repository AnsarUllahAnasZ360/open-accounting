# OpenBooks Redesign — Implementation Plan (Epics E0–E8)

Date: 2026-06-14 (rev 2) · Branch: `finishing` · Companion to
`docs/finishing/redesign-research-plan.md` (research + rationale) and
`docs/finishing/redesign-execution-prompt.md` (the kickoff prompt + build/verify
workflow). **Payroll is out of scope.**

## North-star outcome (Ansar, verbatim intent)
> "A clean, functional UI for Transactions, Income, Expenses, and Contacts. It
> should be very consistent. An Insights page for all of these. For Income and
> Expenses, an Invoices and Bills subpage. And the Insights page designed with a
> lot of attention to detail."

**Consistency is the keystone.** Every section must feel like the same page with
different data.

## Navigation model (REVISED — this supersedes the top-level-section idea)
Bills and Invoices are **sub-pages**, not top-level nav. Insights is a **sub-tab**
of each section, not a standalone nav item. Each section carries an identical
horizontal sub-tab bar under its title, ordered **[cash-movement → AR/AP →
Insights]** (Insights always last; the cash-movement tab is the default).

| Top-level nav | Sub-tabs |
|---|---|
| Transactions | Transactions · **Insights** |
| Income | Income (money received) · **Invoices** (AR) · **Insights** |
| Expenses | Expenses (money spent) · **Bills** (AP) · **Insights** |
| Contacts | Contacts · **Insights** |

Removed from top-level nav: **Bills**, **Insights** (and the never-shipped
top-level Invoices). New top-level order: Dashboard · Inbox · Transactions ·
Income · Expenses · Contacts · Payroll · Reports · Settings.

Sub-tab behavior (from research): URL-routed (`/income`, `/income/invoices`,
`/income/insights`) following the existing Settings `[section]` precedent; 2px
brand-green active underline; period + filters persisted across sub-tabs via URL
query params; mobile = same bar, horizontally scrollable. AR vs cash is
disambiguated by plain labels + quiet subtitles, and **an unpaid invoice never
inflates the Income number** (Income = cash received; Invoices = AR pipeline).

## Gate contract (every task)
1. `pnpm verify` green. 2. `npx convex dev --once` green after any `convex/`
change. 3. Affected `pnpm exec playwright test` green — real clicks only, never
mutate shared demo books (disposable business → archive). 4. Screenshot →
`docs/finishing/evidence/`. 5. Update `completion-report.md` (WORKING only with
linked green test + screenshot). 6. Convex changes widen→migrate→narrow; ledger
posting path + money-as-minor-units untouched; posted entries immutable.

## Dependency map
```
E0 driver+sub-nav ─┬─> E1 Insights system ─┬─> E2 Income ─┐
                   │                        ├─> E3 Expenses ├─> E5 CONSISTENCY (keystone)
                   │                        └─> E4 Contacts ┘
E6 AI hardening    — parallel backend track (own worktree)
E7 Stripe integrity— parallel backend track (own worktree)
E8 Income streams  — after E2 (Income Insights), optional/later
```
UI epics (E0→E5) serialize because they share the driver / SectionTabs / Insights
components. Backend epics (E6, E7) run in parallel. **E5 is the keystone sign-off
and is re-run after every merge.**

---

## EPIC E0 — Foundation: shared workbench driver + section sub-navigation
**Goal:** one reusable page system every section renders through, plus the
consistent sub-tab shell. Transactions is migrated as the living reference.

- **E0.1 `WorkbenchConfig` contract** — columns, defaultVisibleColumns,
  filterFacets, groupByOptions, sortableColumns, primaryActions, bulkActions,
  rowToDetail, homeBanner (≤1 insight line).
- **E0.2 `WorkbenchPage` shell** — fixed: section header → sub-tab bar → toolbar →
  one-line insight banner → table header; **scroll: table body only**; detail
  sheet (right ≥lg, bottom drawer mobile). Preserve the `flex h-full min-h-0` +
  `shrink-0` + `min-h-0 flex-1 overflow-auto` contract from Transactions.
- **E0.3 `SectionTabs` component** — horizontal underline tabs under the title,
  2px `#2ca01c` active underline + medium-weight label, order
  [cash-movement → AR/AP → Insights], mobile horizontally scrollable with active
  auto-scrolled into view. Follow the Settings `[section]` sub-route precedent.
- **E0.4 Shared toolbar + URL state** — period / search / filters / saved views in
  URL query params so they survive sub-tab switches; N/A filters disabled not
  hidden (no reflow).
- **E0.5 Routing** — extend `content.ts` + the `[section]` route to carry
  sub-routes; default sub-tab = cash-movement; deep-link + back-button correct.
- **E0.6 Transactions migration** — re-implement Transactions as a config on the
  driver, add [Transactions · Insights] sub-tabs. **Parity proof:** existing
  transactions e2e green + before/after screenshots identical.
- **E0.7 Mobile + a11y** — 390px shell + sub-tabs; row keyboard focus; sheet↔drawer.

**Acceptance:** Transactions is identical, now driven by the shared system with a
working sub-tab bar; sub-tabs route and persist state.

---

## EPIC E1 — Insights experience system (attention to detail)
**Goal:** a genuinely polished, reusable Insights page that every section's
Insights sub-tab consumes. Reuses `InsightsDashboard`, `DashboardViz`,
`aiInsights.ts`; adds the craft.

- **E1.1 Page scaffold** — scope bar (period + "Compare to", **always show the
  resolved calendar dates**) → KPI band → ~60% charts / ~40% AI observations →
  breakdown section.
- **E1.2 KPI card system** — identical anatomy: label → value (tabular figures) →
  delta + **named comparison frame** ("+12% vs last month") → sparkline → optional
  status pill. Suppress the delta when there's no history (no "+∞%").
- **E1.3 Chart polish** — shared vertical crosshair + one unified tooltip (all
  series at that point); **click-to-drill opens a transaction drawer** (same drawer
  the AI cards use); interactive legend cross-filter; optional brushable timeline;
  animate period/compare transitions (~200–300ms, respect `prefers-reduced-motion`).
- **E1.4 AI observation cards** — quiet monochrome lucide icon (no purple/sparkle
  cliché) + one plain-English sentence + clickable entity chip(s) + "view
  transactions" drill + calm "why this surfaced" line. **Threshold-gated** (show
  nothing if nothing is notable); never auto-acts (AI proposes, ledger posts).
- **E1.5 States** — per-widget empty / first-run / low-data states; skeletons that
  match final dimensions and **do NOT re-fire on a mere period change** (morph the
  existing chart instead).
- **E1.6 First consumer** — wire the Transactions Insights sub-tab as the proof.
- **E1.7 Finance discipline** — money-in green, neutral expenses, amber warnings,
  red only for genuinely bad/overdue; pair every color with a sign/icon; tabular
  figures everywhere; contrast on the white surface.

**Acceptance:** the Transactions Insights tab is demonstrably polished; the KPI,
chart, AI-card, and state components are reusable by all sections.

---

## EPIC E2 — Income section (Income · Invoices/AR · Insights)
- **E2.1 Income table** — unified money-in (bank deposits, Stripe payments,
  invoice payments, manual) on the driver; facets; inline edits.
- **E2.2 Invoices (AR) sub-tab** — AR money bar (Outstanding · Overdue · Draft ·
  Paid this period), columns (number, customer, issued, **due**, status, amount,
  **balance**), actions (New invoice, Send, Send reminder, Record payment,
  Statement). Reuse the existing composer + detail; move invoice mutations here.
- **E2.3 Income Insights sub-tab** — KPIs (total income, MRR, top-customer share,
  DSO, AR outstanding); revenue trend vs prior period; AR aging; income by stream/
  customer; AI observations. Built on E1 components.
- **E2.4 Simplify** — remove the old Income tabs; Customers → Contacts; guarantee
  unpaid invoices never inflate Income.
- **E2.5 e2e** across all three sub-tabs + screenshots; mobile.

---

## EPIC E3 — Expenses section (Expenses · Bills/AP · Insights)
- **E3.1 Expenses table** — unified money-out on the driver; facets incl.
  **missing receipt**; inline category edit.
- **E3.2 Bills (AP) sub-tab** — AP money bar (Owed · Overdue · Due soon · Paid),
  columns (vendor, bill #, bill date, **due**, status, amount, **balance**),
  actions (Add bill, Upload bill PDF, Pay, Schedule). Reuse the existing bill
  detail + match picker.
- **E3.3 Expenses Insights sub-tab** — KPIs (total spend, burn, runway,
  top-category share, recurring); spend trend by category; top vendors; AP aging /
  DPO; recurring/subscriptions; AI observations. Built on E1 components.
- **E3.4 Simplify** — remove old Expenses tabs; Vendors → Contacts; Categories +
  Recurring → Insights; Evidence-Needed → transaction receipts + a missing-receipt
  saved view.
- **E3.5 e2e** across all three sub-tabs + screenshots; mobile.

---

## EPIC E4 — Contacts section (Contacts · Insights) + add + statements
**Goal:** unified directory, correct add-contact, and a rich detail view with
statements — the feedback Ansar flagged as under-stressed.

- **E4.1 Contacts directory** — on the driver; role chips (All / Customers /
  Vendors); facets (role, activity, open AR, open AP, archived).
- **E4.2 Add contact (correctly)** — create flow: name, role(s) customer / vendor /
  both, email, optional default category; validation; the new contact appears
  immediately and is reusable on invoices/bills.
- **E4.3 Contact detail** — header (name + role badges + terms + quick actions:
  New invoice, Record payment, Statement); KPI band (**they owe you / you owe them
  / lifetime in / lifetime out / overdue + aging** — AR and AP shown separately,
  never netted); tabs: Activity timeline (all invoices/bills/payments with running
  balance), Open items (AR + AP with aging), Statements, Notes, Details
  (multi-address, terms, tax id, bank details, default category), Attachments.
- **E4.4 Statements** — generate a customer statement: **Balance-Forward** (default)
  and **Open-Item** (collections); derived from posted journal lines so it ties to
  the ledger; downloadable + sendable.
- **E4.5 Contacts Insights sub-tab** — concentration (top customers/vendors, 20%
  guardrail), two-sided bars, AR/AP outstanding, dormant/at-risk contacts, AI
  observations. Built on E1 components.
- **E4.6 e2e** — add a contact, open its detail, generate a statement, switch to
  Insights + screenshots; mobile.

---

## EPIC E5 — Consistency & functional uniformity  **(KEYSTONE)**
**Goal:** prove Transactions / Income / Expenses / Contacts and every sub-tab feel
like one product and every control works. This is the most important epic.

- **E5.1 Canonical consistency checklist** — header placement, section-tab bar,
  toolbar, filter placement + behavior, insight banner, card layout, table layout,
  fixed-vs-scroll regions, icon placement, navigation behavior, component styling,
  spacing/alignment, empty/loading/error states, detail-sheet behavior, money
  formatting (tabular figures), color discipline, mobile, keyboard/a11y.
- **E5.2 Cross-section audit** — score every section + sub-tab against the
  checklist; file each divergence.
- **E5.3 Fix divergences** — eliminate residual bespoke chrome, redundant
  explanatory/marketing copy, and duplicate stat blocks.
- **E5.4 Uniform states** — identical empty / loading / error treatments across all
  sections (the polish that makes it feel finished).
- **E5.5 Parameterized consistency suite** — one e2e script run across all four
  sections: load → switch each sub-tab → apply a filter → change the period →
  open a row → open Insights; assert identical structure/behavior; capture a
  side-by-side screenshot set at desktop **and** 390px.
- **E5.6 Functional pass** — every action button works on every page (add, import,
  export, inline edit, bulk actions, detail actions, statement, pay/schedule).

**Acceptance:** the parameterized consistency suite is green and the side-by-side
screenshots demonstrably show one uniform product. **Re-run E5 after every later
merge (E6–E8).**

---

## EPIC E6 — AI categorization hardening
**Goal:** trustworthy auto-post on an immutable ledger (pipeline shape is already
industry-standard).
- **E6.1** Confidence calibration (temperature scaling; ECE/reliability) before the
  gates trust 0.90/0.75.
- **E6.2** Business-impact gate: keep the shared mode constant, scale required
  confidence with amount (hard $ ceiling) + a category blocklist that never
  auto-posts (equity, owner draws, taxes, intercompany, "ask my accountant").
- **E6.3** RAG categorization: retrieve chart of accounts (allowed enum) + k
  nearest **confirmed** past transactions; reason then emit structured
  `{account, confidence, rationale, evidence_ids, needs_clarification, question?}`;
  three exits — post / propose-to-inbox / ask.
- **E6.4** Safe learning loop: learn only from human-confirmed labels (never
  re-ingest silent auto-posts); keep provenance; active-learning prioritizes
  low-confidence items.
- **E6.5** Honest eval: leakage-free holdout partitioned by counterparty / time;
  report precision on auto-posted items.
- **E6.6** Inbox evidence polish: per-field confidence, flag reason, counterparty
  history, batch confirm, plain-English correction, "approve & make a rule."

---

## EPIC E7 — Stripe reconciliation integrity (parallel track)
**Goal:** revenue counted exactly once across invoice → charge → payout → Plaid
deposit. The clearing model exists; close the unwired reconciliation step.
- **E7.1 Deposit↔payout matcher (critical) — DONE.** `convex/stripe.ts`
  `findMatchingStripePayout` / `matchPlaidInflowToPayout` / `reconcilePayoutWithDeposit`,
  wired into `convex/plaid.ts` `syncPlaidTransactions` BEFORE the income pipeline.
  A matched Plaid inflow (amount within 1¢ + arrival within 5d + Stripe/payout
  descriptor or exact amount, same currency) posts reconcile-only
  `Dr Bank / Cr Payouts In-Transit`, sets `stripePayouts.bankTxnId`, marks the
  payout `reconciled`, and records the txn `decidedBy: "match"` — never income.
  Idempotent (re-run / re-deliver does not double-post). Unmatched payouts stay
  `pending`; drifted ones → `payout_mismatch` Inbox.
- **E7.2 — DONE.** `invoices.stripeInvoiceId` is a real optional indexed column
  (`by_entity_and_stripe_invoice_id`); Stripe invoices dedupe on it, falling back
  to `number` only when no Stripe id is on file.
- **E7.3 — partial.** Adopted the **Payouts In-Transit** account (1160): payout
  creation posts `Dr In-Transit / Cr Clearing`; the matched arrival posts
  `Dr Bank / Cr In-Transit` so the bank debit happens exactly once. Refund →
  contra-revenue, dispute → fee + reversal, negative payout, tax → liability are
  **deferred** (the projection does not yet carry these objects).
- **E7.4 — deferred (honest).** `entities.accountingBasis` exists but recognition
  is unchanged: charges recognize revenue at charge time (cash-like) and invoices
  at finalization (accrual). Full cash-vs-accrual deferral needs the charge↔invoice
  link the projection does not carry; not attempted to avoid a fragile half-build.
- **E7.5 — DONE.** `convex/stripeSingleCounting.test.ts` proves the full lifecycle
  on an in-memory `convexTest`: revenue credited exactly once, clearing AND
  in-transit net to 0 per payout, bank debited exactly once, matched deposit is
  not income, idempotent re-run/re-reconcile. Evidence:
  `docs/finishing/evidence/2026-06-14-E7-single-counting-proof.json`. **Live
  end-to-end still needs the hosted Plaid Link session + a real Stripe payout
  webhook (external/blocked per `whats-left.md`); E7 proves single-counting at the
  unit level.**

---

## EPIC E8 — Income streams (after E2; optional/later)
- **E8.1** `incomeStreams` entity (+ optional stream rules); `streamId` on income
  posting (widen→migrate→narrow).
- **E8.2** AI stream assignment in the pipeline; low confidence → Inbox question.
- **E8.3** Stream management UI; **E8.4** stream analytics in Income Insights;
  **E8.5** tests.

---

## Requirements coverage (verification of the original brief)
| Original request | Where it lives | Status |
|---|---|---|
| Consistent UX across Transactions/Income/Expenses/Contacts | E0 (driver+sub-nav) + **E5 keystone** | Planned |
| Header/filters/insight/table-header fixed; body scrolls | E0.2 shell contract | Planned |
| Remove redundant stats / duplicate / explanatory copy | E2.4, E3.4, E5.3 | Planned |
| Insights not a separate nav item | E0.5 (removed) + per-section Insights sub-tab | Planned |
| Insights per page (Mercury 60/40, KPIs, AI, extras) | E1 + E2.3/E3.3/E4.5 | Planned |
| Insights designed with attention to detail | **E1 (whole epic)** | Planned |
| Income → Invoices sub-nav + Insights sub-nav | E2.2, E2.3 | Planned |
| Expenses → Bills sub-nav + Insights sub-nav | E3.2, E3.3 | Planned |
| Income simplified to one money-in table | E2.1, E2.4 | Planned |
| Expenses simplified to one money-out table | E3.1, E3.4 | Planned |
| Bills vs Expenses decision | Bills = AP sub-tab under Expenses | Decided |
| Invoices = AR; Bills = AP | E2.2 / E3.2 | Decided |
| Contacts: customers + vendors | E4.1 (roles) | Planned |
| Contacts: add contacts correctly | **E4.2** | Planned |
| Contacts: statements | **E4.4** | Planned |
| Contact detail (notes/history/money in-out/relationship) | E4.3 | Planned |
| Stripe double-count prevention | E7 | Planned |
| Income streams (configurable + AI) | E8 | Planned |
| AI categorization / confidence / rules / review / learning | E6 | Planned |
| Wireframes + insights architecture + KPIs/charts/AI per page | research-plan §4 + wireframes | Delivered |

## Batch cadence & verification
One epic = one batch → both gates + e2e + screenshots + completion-report entry +
commit. Each epic is built by one agent and independently verified by another (see
`redesign-execution-prompt.md`). **E5 is the keystone**: nothing is considered done
until the parameterized consistency suite is green and re-run after later merges.
