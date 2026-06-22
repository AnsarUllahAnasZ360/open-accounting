# OpenBooks Redesign — Research, Recommendations & Execution Plan

Date: 2026-06-13 · Branch: `finishing` · Status: **research/planning only (no code changed)**

Scope: make Income / Expenses / Bills / Contacts feel identical to the
**Transactions workbench**; replace the standalone Insights nav with Mercury-style
per-page Insights; simplify Income & Expenses; decide Bills-vs-Expenses; unify
Contacts; design Stripe accounting that can't double-count; harden the AI
categorization architecture. **Payroll is explicitly out of scope.**

---

## 0. The one-paragraph headline

OpenBooks already contains ~80% of what this redesign needs — it just isn't
*composed* the way the brief wants. Transactions runs a genuine Mercury-grade
workbench; the four other pages use a mix of bespoke tabbed layouts and partial
reuse of the same primitives. The Insights engine (scaffold + 8 chart components +
a per-section AI backend) is built but parked behind a standalone nav item that
only fills in its Transactions tab. The Stripe clearing-account ledger model is
built and correct in isolation. **So this is overwhelmingly a consolidation,
extraction, and propagation effort, not a greenfield build.** The two genuinely
new pieces are: (a) a reusable page driver that all five sections render through,
and (b) the Stripe↔bank reconciliation match that closes the double-count gap.

---

## 1. Verified current state (with file references)

### 1.1 The Transactions workbench (the reference)
- `apps/web/src/components/openbooks/CoreScreens.tsx` — `TransactionsScreen`
  (~2,587 lines, monolithic). Owns all filter/sort/group/display state.
- Layout shell, top→bottom, all **fixed (`shrink-0`)** except the table:
  1. status/action message line, 2. `WorkbenchToolbar` (saved views + search +
  filter pills + group/sort/display + add/export), 3. `MiniCashflowStrip`
  (insights band, toggleable), 4. **scrollable** table (`min-h-0 flex-1
  overflow-auto`), 5. `DetailSheet` (right sheet on ≥lg, bottom drawer on mobile).
- Reusable parts in `apps/web/src/components/openbooks/workbench/`:
  `WorkbenchToolbar`, `FilterBar`, `FilterPanelButton`, `OpenBooksDataTable`,
  `KpiStrip`, `DetailSheet`, `SavedViews`, `GroupByMenu`, `SortMenu`,
  `DisplaySettingsMenu`, `DateRangeControl`, `InlineCategoryCombobox`, `AddMenu`,
  `ExportMenu`, `MiniCashflowStrip`, `InsightsBand`, `InsightsDashboard`,
  `AiNarrativePanel`, `AiInsightBadge`.
- Data: `convex/coreViews.ts` `transactions` query returns ≤120 rows **plus** a
  full-set `insights` aggregate (net/in/out, prev-period, daily cumulative, top
  counterparties).
- **Reusability: ~75%.** The primitives are generic; what's hard-coded to
  Transactions is the *screen* (filter-state shape, column defs, bulk actions,
  insights wiring). There is **no per-section config object today**.

### 1.2 The other four pages (the gap)
| Page | File | Today | Gap to Transactions parity |
|---|---|---|---|
| Income | `IncomeScreen.tsx` | Bespoke 5-tab layout (Payments, Invoices, Customers, Streams, Receivables); uses some primitives | No WorkbenchToolbar/saved-views/group-sort-display; tabbed not unified |
| Expenses | `ExpensesScreen.tsx` | Partial — primitives, bespoke shell, `this/last` period logic | No full toolbar; date logic diverges |
| Bills | `ModuleScreens.tsx` | Single AP table on primitives (DataTable/FilterBar/KpiStrip/DetailSheet) | Missing full toolbar/saved-views/insights shell |
| Contacts | `ModuleScreens.tsx` | Directory on primitives + a good detail sheet (Activity/Aliases/Rules/Notes) | Missing full toolbar/saved-views/insights shell |

`apps/web/src/app/invoices/page.tsx` is a legacy 307 redirect to `/income`; the
unused `InvoicesScreen` function in `ModuleScreens.tsx` is dead code (raw Table).

**Important nuance:** "uses workbench primitives" ≠ "feels identical to
Transactions." Only Transactions has the full toolbar + saved views + group/sort/
display + insights band + the exact fixed/scroll shell. Parity = render all five
through one shared driver.

### 1.3 Insights (built, parked)
- Standalone nav item: `apps/web/src/lib/openbooks/content.ts:84` (`/insights`).
- `InsightsScreen.tsx` is a 6-tab dashboard; only the Transactions tab is built,
  the rest are stubs.
- Reusable scaffold `workbench/InsightsDashboard.tsx` = DateRangeControl + KpiStrip
  + chart slot + `AiNarrativePanel`.
- Charts in `dashboard/DashboardViz.tsx` (recharts via shadcn chart): CashTrend,
  PnlTrend, ExpenseDonut, CashFlow, PayrollTrend, AgingBar, CustomerBars,
  RunwaySegments + MoneyTooltip/Delta; plus SVG Sparkline/BarChart/CumulativeChart.
- AI backend `convex/aiInsights.ts`: Bedrock + deterministic fallback, already
  branches per section (transactions/income/expenses/bills/contacts/payroll),
  returns `{summary, findings[{title,detail,tone}], disclaimer}`.
- Aggregates already computed: `coreViews.dashboard` (aging, DSO, cash cushion,
  trend, concentration), `incomeViews.overview`, `expensesViews.overview`,
  `moduleViews.overview`, `reportViews.reportPack`.

### 1.4 Data model (`convex/schema.ts`)
- Double-entry core: `ledgerAccounts`, `journalEntries`, `journalLines`
  (debit XOR credit; balance enforced in `convex/ledger.ts`
  `postLedgerEntryCore`); money is integer minor units + currency; posted entries
  immutable (corrections reverse + repost via `reversesEntryId`).
- `transactions` carries categorization fields incl. `decidedBy`, `confidence`,
  `reasoning`, `review` (auto/confirmed/needs_review/excluded), plus eval fields.
- `contacts.roles: ("customer"|"vendor")[]` — **already a unified
  single-entity-with-roles model.** Has `defaultCategoryId`, `aliases`, `notes`.
- AR/AP: `invoices`, `bills` (both link `contactId` + `entryIds`).
- Stripe: `stripeAccounts.clearingAccountId`, `stripePayouts`
  (gross/fees/amount/`bankTxnId`/status reconciled|mismatch), `stripePayoutLines`,
  `stripeWebhookEvents` (dedupe by event id).
- AI: `rules`, `aiCorrectionMemories` (+ `aiMemoryEmbeddings` vector index),
  `aiConfigs.autonomy`, `aiEvalRuns`, `aiBatchRuns`; `inboxItems`, `proposals`.
- **No first-class income-stream entity.** "Streams" in `incomeViews.ts:260` =
  revenue grouped by income ledger account.

### 1.5 AI categorization pipeline (`convex/pipeline.ts`)
Ordered stages (first confident layer wins): **transfer → match → rule →
memory(embeddings) → plaid_prior → AI(Bedrock)**, fallback → Inbox. Shared
thresholds `AI_AUTONOMY_THRESHOLDS` in `convex/ai.ts` (suggest=null,
balanced=0.90, autopilot=0.75); `shouldAutoPostAI` never auto-posts when the model
says `needsHuman`. Learning loop: a human correction upserts `aiCorrectionMemories`
+ an embedding; at 3 occurrences it auto-drafts a disabled rule for approval. This
is already aligned with how Xero/Puzzle/Ramp work.

### 1.6 Stripe accounting (`convex/stripe.ts`) — the double-count finding
Built and correct **in isolation**:
- charge/PI → `Dr Stripe Clearing / Cr Sales` (gross, revenue once) + `Dr Stripe
  Fees / Cr Stripe Clearing` (fee separated). Dedup by `externalId` =
  `stripePaymentIntentId`.
- invoice (open) → `Dr A/R / Cr Sales`. Dedup by invoice **`number`** (weak).
- payout, only when `driftMinor === 0` → `Dr Bank / Cr Stripe Clearing`; else a
  `payout_mismatch` inbox item; payout status → reconciled|mismatch.

**The gap (verified):** `stripePayouts.bankTxnId` is populated **only** in
`seedDemo.ts:581`; there is **no code** in `pipeline.ts`/`plaid.ts` that matches an
incoming Plaid deposit to a Stripe payout. So when both rails run live, the payout
posts the bank side **and** the Plaid feed imports the same deposit independently →
double count. It's latent only because Plaid + Stripe have never run end-to-end
together (both still PARTIAL per `whats-left.md`).

---

## 2. Product decisions (answers to the brief)

### 2.1 Bills vs Expenses → **KEEP Bills, as a Bills (AP) sub-tab under Expenses**
> Nav update (2026-06-14): Bills is retained but lives as a **sub-tab under
> Expenses** (not a top-level section). The accounting rationale below is
> unchanged; only its placement is. See `redesign-implementation-plan.md` for the
> authoritative navigation model.
Rationale: the owner's own model ("expense = money already gone; bill = owed but
unpaid") *is* the correct accounting distinction in plain English; every credible
peer (QuickBooks, Xero, FreshBooks, Wave, Puzzle, Ramp/Brex) keeps it; AP is
forward-looking cash management (due dates, aging, scheduling, recurring) that does
not fit a "money already spent" list; and keeping the bill→payment lifecycle as one
linked object structurally prevents the #1 bookkeeping error (double-counting a bill
and its payment). Merging would make the combined list answer *neither* "what did I
spend" nor "what do I owe." **Also** surface an AP-aging/"upcoming" tile inside
Expenses Insights for discoverability, and let Bills sit quiet/empty for businesses
that never use net terms. Bills page = AP cockpit: KPIs (owed / overdue / due 7-30d
/ DPO / cash-after-bills), AP aging chart, columns oriented to obligations
(vendor, due date, status, balance), actions (pay/schedule/partial/recurring).

### 2.2 Expenses simplification → **YES, simplify**
- **Keep:** one clean money-out table (settled spend), matching the Transactions
  workbench.
- **Move to Insights:** Categories breakdown, Recurring/subscriptions detection.
- **Move to Contacts:** Vendors (Contacts is already unified with a `vendor` role).
- **Remove "Evidence Needed" as a tab:** evidence is a transaction-level concern —
  the receipt/document infra (`documents`, `receiptEmbeddings`,
  `matchedTransactionId`) already attaches to transactions. Replace with a
  "missing receipt" filter/saved view + an Inbox signal, not a separate surface.

### 2.3 Income simplification → **YES, simplify to one money-in table**
- **Keep:** one unified income table (bank deposits, Stripe payments, invoice
  payments, manual) — the money-*received* view.
- **Move to Contacts:** the Customers tab (per-customer revenue/AR lives in the
  contact detail).
- **Move to Insights:** Streams, Money owed (AR aging/DSO), category analysis.
- **Invoices/AR (DECIDED — Invoices (AR) sub-tab under Income):** AR is the exact
  mirror of AP, and gets the same treatment — its own **sub-tab under Income**
  (who owes you, due dates, aging, send/remind/record-payment/statement), the
  actions AR needs and that read-only Insights can't provide. Final structure:
  **Income section = [Income (received) · Invoices (AR) · Insights]**; **Expenses
  section = [Expenses (paid) · Bills (AP) · Insights]**. AR aging/DSO also appears
  in the Income Insights sub-tab and per-customer open invoices in the Contact
  detail. (Supersedes the earlier "dedicated top-level Invoices section" — same
  AR/AP accounting, now placed as sub-tabs for nav consistency.)

### 2.4 Contacts → **unify (already the schema), align to the workbench**
`contacts.roles` is already single-entity-with-roles. Render the directory through
the shared workbench (role chips: All / Customers / Vendors). Detail view spec in
§4.4.

### 2.5 Income streams → **net-new: configurable streams + AI classification**
Add a first-class `incomeStreams` entity (name, optional rules/keywords, linked
income account(s)). At categorization time the AI assigns each inbound payment to a
stream (reusing the same confidence/inbox machinery), asking when unsure. Streams
analytics (revenue by stream, trend, concentration) live in Income Insights. This
replaces today's "revenue grouped by income account" proxy.

---

## 3. The unified page architecture (all five operational pages)

### 3.1 Extract one driver
Create `WorkbenchPage<Row, Filters>` from the Transactions screen — a single
component that renders the fixed/scroll shell + toolbar + table + detail sheet +
insights expander, driven by a per-section **config**:

```
WorkbenchConfig = {
  section, title,
  dataQuery,                       // convex view
  columns, defaultVisibleColumns,
  filterFacets,                    // section-specific facets
  groupByOptions, sortableColumns,
  rowToDetail,                     // detail-sheet content
  primaryActions,                  // Add / Import / New invoice / New bill…
  bulkActions,
  homeBanner,                      // ≤1 insight line (Transactions-style)
  insights: { kpis, charts, aiSection },  // the Mercury panel content
}
```

Transactions, Income, Expenses, Bills, Contacts each become a thin config object.
Bills/Contacts keep their existing good detail sheets; they gain the toolbar,
saved views, group/sort/display, and the insights expander for free.

### 3.2 Consistency contract (identical across all five)
- **Fixed:** page header/title, action buttons, filter toolbar, the optional
  single insight banner, the table header.
- **Scrolls independently:** the table body only.
- **Detail:** right sheet ≥lg, bottom drawer on mobile.
- Same spacing, Geist + tabular money figures, lucide icons, one brand green,
  quiet AI affordances. No per-page bespoke stats blocks, no explanatory/marketing
  copy, no duplicate reconciliation footnotes.

### 3.3 Homepage = data, filters, table, ≤1 insight line
Each operational page shows at most a single Transactions-style insight banner
(e.g., "Net change −$4.2k vs last month" / "You owe $12.8k, $4.2k overdue"). All
deeper analytics live in the page's Insights panel.

---

## 4. Insights architecture (Mercury-style, per page)

### 4.1 Dissolve the nav item
Remove `/insights` from `content.ts`. Replace with an **"Insights" sub-tab** in
every section (Transactions / Income / Expenses / Contacts) — always the last
sub-tab. Selecting it opens that section's full, polished Insights page. Reuse
`InsightsDashboard` + `DashboardViz` + `aiInsights.ts`; the *craft* (states,
crosshair, drill-drawer, KPI anatomy) is Epic E1 in the implementation plan.

### 4.2 Panel layout (the shell, identical on every page)
1. **Scope bar:** period picker + "Compare to" (one control governs everything).
2. **KPI band:** one hero number + 2 drivers + 2 supporting, each framed vs the
   comparison period.
3. **Main split — 60% visual / 40% AI:** charts on the left; an AI-observation
   column on the right (plain-English sentences with entity chips, each drilling to
   the underlying journal lines — "AI proposes, the ledger proves").
4. **Below:** breakdown cards (by source/category/recipient with %-of-total bars),
   category/concentration analysis, aging, and a simple forecast.

### 4.3 Per-page content
| Page | Hero + KPIs | Visual (60%) | AI observations (40%) | Below |
|---|---|---|---|---|
| **Transactions** | Net cashflow; Money in; Money out; Ending cash; Uncategorized $/# | Bar+line cashflow w/ brushable timeline; running-balance area | "1 notable txn…", "Money out up 23%…", "12 uncategorized…", "Cash dipped below $20k…" | Money-in by source/category; Money-out by recipient/category; exclude-from-insights toggle |
| **Income** | Total income; Avg monthly/MRR; Top-customer share; New vs returning; DSO | Revenue bars w/ prior-period line; stacked by stream/category | "Revenue down 11%…", "Acme = 38% (>20% risk)…", "Northwind pays 18d late…", "3 new customers +$8.9k…" | Income by customer; by stream/category; concentration (20% guardrail); 30/60/90 forecast |
| **Expenses** | Total spend; Burn; Runway; Top-category share; Recurring total | Spend bars stacked by category w/ total line; top-10 vendors | "Higher spend to AWS +34%…", "2 duplicate subs…", "Software up 4 mo…", "Runway 6.2mo, down from 7.1…" | Spend by category; top vendors; recurring/subscriptions w/ "still in use?"; spend forecast |
| **Bills** | Total payable; Overdue; Due 7/30d; DPO; Cash-after-bills | AP aging buckets; upcoming-bills timeline vs cash | "3 bills $4.2k overdue…", "$12.8k due in 7d, leaves $6.4k…", "Pay Staples early → 2% off…", "DPO 22d…" | AP aging table (vendor × bucket); bills by vendor; cash-flow planner toggle |
| **Contacts** | Active contacts; Top-customer %; Top-vendor %; Outstanding AR; Outstanding AP | Two-sided bars (top customers / top vendors); concentration Pareto | "Top 3 customers = 61%…", "Acme owes $9.4k, $3.2k 60+d…", "Globex went quiet…", "AWS = 19% of spend…" | Customers table; vendors table; concentration guardrails; inactive/at-risk |

### 4.4 Contact detail view (requested)
Header (name + role badges + terms + quick actions). KPI band: **they owe you /
you owe them / lifetime in / lifetime out / overdue+aging** (AR and AP shown
separately, never netted — they are distinct GL accounts). Tabs: Activity timeline
(all invoices/bills/payments with running balance), Open items (AR + AP w/ aging),
Statements (Balance-Forward default, Open-Item for collections — derived from
posted journal lines), Money received / Money paid, Notes & history, Details
(multi-address, terms, tax id, bank details, default category), Attachments.

---

## 5. Stripe accounting design that can't double-count

Target model (matches A2X/Synder/Xero/QuickBooks/Puzzle):

| Step | Event | Debit | Credit | Recognizes revenue? |
|---|---|---|---|---|
| 1 | Invoice finalized (accrual) | A/R | Sales | **Yes** (or Deferred Rev for subs, amortized) |
| 2 | Charge succeeds | Stripe Clearing | A/R (or Sales if cash-basis) | No (or yes, cash) |
| 3 | Stripe fee | Stripe Fees Expense | Stripe Clearing | No |
| 4 | Payout created | Payouts In-Transit | Stripe Clearing | No |
| 5 | Payout deposited / **Plaid txn arrives** | Bank | Payouts In-Transit | **No — matched** |

Clearing nets to ~0 per payout = the built-in proof nothing was counted twice.

**What's already done:** steps 1–4 (minus the explicit in-transit account),
gross-not-net, fee separation, event dedupe, drift→mismatch inbox.

**What to build (closes the gap):**
1. **Reconcile-only deposit match (critical):** when a Plaid inflow matches an open
   Stripe payout (amount + arrival date + descriptor), set
   `stripePayouts.bankTxnId`, post it via the transfer/match branch into clearing/
   in-transit, and **never** route it as income. Unmatched → Inbox.
2. **Exactly one source owns the payout cash** — don't let the Stripe side post
   `Dr Bank` *and* the Plaid feed post the deposit; the match makes the Plaid txn
   the cash event and the payout entry the clearing drain.
3. **Add `stripeInvoiceId`** to `invoices`; dedupe Stripe invoices on it, not on
   `number`.
4. Refunds → contra-revenue; disputes → fee expense + reversal; tax → liability;
   negative payouts handled as negative deposits.
5. **Cash vs accrual:** recognize on invoice finalization (accrual, default) with a
   Deferred Revenue schedule for subscriptions; cash-basis recognizes on charge.
   Same clearing mechanics either way.

Checklist that guarantees single-counting: revenue credited exactly once; all
Stripe cash routes through clearing; record gross; payout drains clearing to ~0;
Plaid deposit is reconcile-only; dedupe every Stripe object id; idempotent webhooks
on `evt_*`; monthly clearing tie-out to Stripe's balance.

---

## 6. AI accounting architecture (harden what exists)

Pipeline shape is already industry-standard. Hardening, in priority order:
1. **Calibrate confidence** (temperature scaling; verify with ECE/reliability) —
   a raw 0.75/0.90 is not 75%/90% correct; LLMs are systematically overconfident.
   Verify auto-post precision ≈99%+ on a holdout before trusting the gates.
2. **Business-impact-aware auto-post gate:** keep the shared mode constant, but
   raise the required confidence with amount (hard $ ceiling above which nothing
   auto-posts), and a **category blocklist that never auto-posts** (equity, owner
   draws/distributions, taxes, intercompany, "ask my accountant").
3. **Learn only from human-confirmed labels** (never re-ingest silently
   auto-posted guesses) to avoid feedback-loop/model-collapse; keep provenance.
4. **Honest eval:** leakage-free holdout partitioned by counterparty / workspace /
   future time window; report precision on auto-posted items specifically. (The
   existing H3 holdout harness — 75% — is the right shape; keep it.)
5. **LLM categorization = RAG:** retrieve the workspace chart of accounts (as the
   allowed enum) + k nearest confirmed past transactions; reason briefly, then emit
   constrained `{account_id, confidence, rationale, evidence_ids, needs_clarification,
   question?}`; offer three exits — post / propose-to-inbox / ask a specific question.
6. **Inbox is the product:** tiered (straight-through / quick-check / expert),
   evidence-rich rows (per-field confidence + flag reason + counterparty history),
   keyboard-driven, batch confirm, plain-English correction, "approve & make a
   rule." Most of this already exists; tighten the evidence display + rule-from-
   correction one-click.

---

## 7. Execution plan (phased; one batch = both gates + e2e + commit)

Honors the repo contract: `pnpm verify` + `npx convex dev --once` after any
`convex/` change; real-click e2e; screenshots to `docs/finishing/evidence/`;
WORKING only with linked green test + screenshot.

- **Phase 0 — Extract the driver.** Refactor `TransactionsScreen` into
  `WorkbenchPage<Config>` + a `transactions` config. No behavior change; prove
  parity with existing Transactions e2e. *Unlocks everything else.*
- **Phase 1 — Propagate to Bills + Contacts.** Lowest risk (already on primitives).
  Move them onto the driver; add toolbar/saved-views/group-sort-display + insights
  expander. Delete the dead `InvoicesScreen` + `/invoices` redirect.
- **Phase 2 — Simplify + propagate Expenses.** One money-out table on the driver;
  drop Categories/Vendors/Evidence tabs; "missing receipt" saved view; Vendors→
  Contacts; Categories/Recurring→Insights.
- **Phase 3 — Simplify + propagate Income.** One money-in table on the driver;
  Customers→Contacts; keep `+ New invoice`; Streams/Money-owed→Insights;
  Receivables saved view. (Resolve §6 AR decision first.)
- **Phase 4 — Insights everywhere.** Wire the per-page Insights panel (KPIs +
  charts + AI section) for all five using `InsightsDashboard`/`DashboardViz`/
  `aiInsights.ts`; remove the `/insights` nav item; fill the previously-stubbed
  sections.
- **Phase 5 — Income streams.** Add `incomeStreams` entity + AI stream
  classification + Income Insights stream analytics.
- **Phase 6 — Stripe reconciliation hardening.** Build the Plaid-deposit↔payout
  match (set `bankTxnId`, reconcile-only), add `stripeInvoiceId`, in-transit
  account, refund/dispute/cash-vs-accrual handling. Unit-prove single-counting.
- **Phase 7 — AI hardening.** Confidence calibration, amount/category-aware gates,
  confirmed-labels-only learning, RAG categorization, inbox evidence polish.

Sequencing logic: UX consistency first (Phases 0–4 deliver the visible win and the
simplification), then accounting correctness (Phase 6 is the most important
*integrity* item and should not wait long), then AI depth (Phase 7).

---

## 8. Resolved decisions (Ansar)
1. **Navigation model → DECIDED: sub-tabs, not top-level.** Bills = AP sub-tab
   under Expenses; Invoices = AR sub-tab under Income; Insights = last sub-tab in
   every section. Top-level nav drops Bills + standalone Insights.
2. **Consistency is the keystone** — a dedicated epic (E5) verifies that
   Transactions / Income / Expenses / Contacts feel like one product.
3. **Insights gets a dedicated, detail-focused epic** (E1).
4. **Contacts add-flow + statements** are explicit deliverables (E4.2, E4.4).
5. **Scope → target ALL the work** as epics E0–E8; full contract +
   requirements-coverage table in `docs/finishing/redesign-implementation-plan.md`;
   kickoff prompt + build/verify workflow in
   `docs/finishing/redesign-execution-prompt.md`.
6. **Stripe integrity (E7)** runs as a parallel track; **AI hardening (E6)**
   retained; **income streams (E8)** optional/later.
