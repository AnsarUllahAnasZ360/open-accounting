# Opening Balance & Books-Start Cutoff — Remediation Plan

**Status:** Accepted — open questions resolved by Ansar 2026-08-13; ready to execute
**Date:** 2026-08-13
**Branch:** `ehsan-dev`
**Scope:** `convex/plaid.ts`, `convex/onboarding.ts`, `convex/openingBalanceCutoff.ts`, every
entity-scoped read path, `convex/entityMetrics.ts`, `convex/portfolioViews.ts`
**Supersedes the behaviour documented in:** `docs/finishing/opening-balance-behavior.md`

---

## 1. Executive summary

Three separate problems are in play. Only one of them is the cutoff feature.

| # | Problem | Severity | Nature |
|---|---------|----------|--------|
| **P1** | Bank connect posts the **current** balance as the opening balance, then imports 730 days of transactions into the same cash account | **Critical** | Pre-existing accounting defect. The cutoff feature did not cause it; it exposed it. |
| **P2** | The cutoff is enforced on 5 read paths out of ~38. Streams, Income, Expenses, Reports modules, AI/CFO, digests, exports and reconciliation still read pre-cutoff data | **High** | Incomplete rollout of the cutoff feature. |
| **P3** | "All businesses" fails with a Convex error | **High** | Read-budget exhaustion in the portfolio roll-up, amplified by P1's inflated history. |

**P1 is the one that matters most.** It is a genuine double-count that makes the balance
sheet wrong for every OpenBooks user who connects a bank — including users who never
touch the cutoff feature. It must be fixed at the source, not papered over with filters.

---

## 2. Root-cause analysis

### P1 — The opening balance is derived from the wrong number

**What the code does today** (`convex/plaid.ts:2314`, `:712`, `:652`):

1. A bank is linked. Plaid returns `balances.current` — the balance **as of right now**.
2. `postOpeningBalanceForBankAccount` posts `Dr Bank / Cr 3900 Opening Balance Equity`
   for that current balance, dated the **first of the month** of the chosen history start.
3. Separately, `days_requested: 730` (`convex/plaid.ts:381`, `:1798`) pulls **two years**
   of transactions, which then post to the same bank ledger account through the pipeline.

**The arithmetic that results:**

```
Ledger cash  =  current balance  +  Σ(two years of imported activity)
Real cash    =  current balance
```

The bank account is overstated by the entire net movement of the imported period, and
`3900 Opening Balance Equity` carries the same error on the credit side. The books
balance (debits = credits), so no invariant check fires — but the **balance sheet is
materially wrong**. This is the "300K vs 80K" the owner is seeing.

The accounting rule being violated is basic and non-negotiable:

> An opening balance is the account's balance **as at the books-start date** — the moment
> immediately before the first transaction you intend to record. It is never the balance
> at some later date.

**Why the current design cannot be right.** Plaid's balance endpoint returns *current*
balance only; there is no historical-balance product in the standard offering. So an
opening balance dated in the past can never be *fetched* — it can only be **derived**.

**Secondary defect:** the date. `openingBalanceDate()` floors the chosen start to the
first of the month, while `booksStartDate()` (the cutoff) takes the exact day. Two
different conventions for the same concept. A user who picks 15 January gets an opening
entry on 1 January and a cutoff on 15 January — a two-week gap of unreversed activity.

### P2 — The cutoff is enforced in five places, not everywhere

`convex/openingBalanceCutoff.ts` is correct in itself, and its own doc comment states the
requirement plainly: *"the cutoff has to be enforced at EVERY read site."* It is not.

**Enforced (7 modules):**

| Module | How |
|---|---|
| `coreViews.ts` | Dashboard, Inbox, Transactions — index-bounded + `isWithinCutoff` filter |
| `reportViews.ts` | P&L / Balance Sheet / Cash Flow — `gte(date, startDate)` bound |
| `unreviewedGap.ts` | Needs-review count — index-bounded |
| `entityMetrics.ts` | **uncommitted working-tree change only** |
| `pipeline.ts:873` | Write guard — refuses to post pre-cutoff |
| `stripe.ts:944` | Write guard — skips pre-cutoff Stripe items |
| `plaid.ts` | Partial — `excluded` review status |

**Not enforced — confirmed by grep, no module below imports `openingBalanceCutoff`:**

| Module | User-facing surface | Impact |
|---|---|---|
| `streamViews.ts` | **Streams / Revenue Streams P&L** | The reported symptom. Invoices and bills are not filtered at all; the default range is the calendar year, which only coincidentally masks some of it. |
| `incomeViews.ts` | Income overview | Pre-cutoff income counted |
| `expensesViews.ts` | Expenses overview | Pre-cutoff expense counted |
| `moduleViews.ts` | Module overview tiles | Pre-cutoff totals |
| `streamTags.ts`, `streamRules.ts` | Stream lists, needs-review | Pre-cutoff rows in queues |
| `aiCfoAggregate.ts`, `agentToolQueries.ts` | **Ask AI / CFO signals** | The AI reasons over archived history and gives wrong advice |
| `weeklyDigestData.ts` | Weekly email digest | Wrong figures emailed out |
| `reconciliation.ts` | Reconciliation worksheet | Pre-cutoff rows offered for matching |
| `intercompany.ts` | Intercompany suggestions | Suggests links to archived activity |
| `invoices.ts`, `bills.ts` | AR / AP lists and ageing | Pre-cutoff invoices still open |
| `payroll.ts` | Payroll statements | Pre-cutoff runs |
| `exportAccount.ts` | Account export | *Correct as-is — exports must stay complete* |

**A structural gap in the sweep itself.** `applyOpeningBalanceCutoff`
(`convex/onboarding.ts:1082`) sweeps three tables: `journalEntries`, `transactions`,
`inboxItems`. It never touches **invoices, bills, payroll runs, receipts, or
reconciliations**. So pre-cutoff AR/AP survives the re-base entirely — which is *also* an
accounting question, not just a filter question (see §3.3).

### P3 — "All businesses" Convex error

`portfolioViews.portfolioDashboard` loops every entity and calls `computeEntityMetrics`,
which loads up to `METRIC_ENTRY_LIMIT = 20000` journal entries **plus a per-entry
`by_entry` collect for lines**. That is ~20k + ~40k document reads *per business*, inside
a single query, against a Convex per-transaction read ceiling.

One business alone stays under. Two businesses do not. And P1 makes it worse: the
double-counted 730-day back-fill is exactly what inflates the entry count.

The uncommitted `entityMetrics.ts` change (date-bounding the load by
`openingBalanceDate`) **reduces** the reads but does not **bound** them. A business with a
long post-cutoff history, or a workspace with five businesses, will hit the same wall. It
treats the symptom.

---

## 3. The accounting decision (ADR)

### ADR-001: Opening balances are derived by roll-back, never fetched

**Status:** Proposed
**Deciders:** Ansar

#### Context

OpenBooks must produce a balance sheet that ties to the bank. The books-start date is
owner-chosen. Plaid supplies only a *current* balance plus a transaction history. The
ledger is immutable and double-entry; corrections are reversals, never edits.

#### Options considered

**Option A — Don't post any opening balance at connect; wait for the owner to enter one**

| Dimension | Assessment |
|---|---|
| Accounting correctness | Correct, but incomplete until the owner acts |
| Complexity | Low |
| Onboarding quality | Poor — books show $0 cash until the owner types a number they may not know |

**Pros:** never wrong. **Cons:** the owner is asked for a figure they'd have to look up
from a statement; onboarding stalls; the "perfect data on day one" goal is missed.

**Option B — Post the current balance and hide older activity behind a cutoff** *(today)*

| Dimension | Assessment |
|---|---|
| Accounting correctness | **Wrong** — double-counts post-start activity |
| Complexity | Medium and growing (every read path needs a filter) |
| Onboarding quality | Looks good, is wrong |

**Cons:** this is the current defect.

**Option C — Derive the opening balance by rolling the current balance backwards** ✅

Opening balance at date *D* = `current balance − Σ(all imported transactions dated ≥ D)`.

| Dimension | Assessment |
|---|---|
| Accounting correctness | **Correct** — this is the standard roll-back method every bookkeeper uses |
| Complexity | Medium — needs the transaction pull to complete before the opening entry posts |
| Onboarding quality | Excellent — owner enters nothing, and the number is right |
| Team familiarity | High — same posting path, same 3900 equity offset |

**Pros:** cash ties to the bank exactly; the owner is not asked for anything; it works for
any start date; it degrades gracefully (if history is incomplete, we can say so).
**Cons:** ordering dependency — the opening entry can only be posted *after* the
transaction sync for that account finishes.

#### What the incumbents actually do (verified 2026-08-13)

Checked before committing to Option C, because being novel here is a risk, not a feature.

| | QuickBooks Online | Xero |
|---|---|---|
| Opening balance source | **Owner enters it manually**, from their bank statement, into an explicit *Opening balance* + *As of* date field | **Owner enters a full trial balance** from their previous system |
| Derived from the feed? | **No** | **No** |
| Books-start date | Any date the owner picks | **Always the first day of a month** (the "conversion date") |
| Scope | Cash accounts, offset to Opening Balance Equity | **Every account** — a complete trial balance as at the day before conversion |
| Unwanted feed rows | **Excluded**, not deleted | Outside the conversion period |
| Closing Opening Balance Equity | Manual journal entry; guidance says involve an accountant. Sources conflict on whether QBO ever does it automatically | Handled via conversion balances |

**Neither product derives the opening balance. Both require a human to confirm it.**
That unanimity is the strongest signal in this document, and it moderates Option C below.

Two secondary confirmations: QBO's answer to unwanted feed data is **exclude-and-keep**,
which independently validates decision D1 (§3.5); and Opening Balance Equity as a
suspense account requiring deliberate close-out is exactly QBO's model, which validates
D2 (§3.2).

#### Decision

**Adopt Option C for the *number*, Option A for the *authority*: derive, then confirm.**

1. **Never treat a fetched balance as an opening balance.** Plaid's `balances.current` is
   stored on `bankAccounts.balanceMinor` as a *reconciliation reference only*.
2. **Derive** the opening figure by roll-back once the account's history has synced.
3. **Present the derived figure to the owner for confirmation against their statement.
   Never post it silently.**
   > *"Based on your bank history, your balance on 1 January 2026 was $80,000.00. Does
   > that match your statement?"* — with an editable field to correct it.

   This is the product's own rule — **AI proposes, the ledger engine posts** (AGENTS.md) —
   applied to the one number that anchors the entire balance sheet. An earlier draft of
   this ADR had the system post the derived figure silently, which violated that rule and
   departed from both incumbents at the same time. It does not any more.
4. If history is unavailable, incomplete, or older than the ~24-month Plaid window,
   **propose nothing** and ask for the statement figure outright (pure Option A).
5. **One date convention, enforced visibly.** See §3.6.

**What OpenBooks keeps over the incumbents:** the owner checks one pre-filled number
instead of retrieving a balance or a trial balance from a system they may no longer have.
That is a real improvement in onboarding quality without giving up the human control both
incumbents insist on.

#### Consequences

- **Easier:** cash reconciles to the bank without the owner doing anything; the cutoff
  becomes a genuine *presentation* concern rather than a load-bearing correctness patch.
- **Harder:** connect becomes a two-phase operation (link → sync → derive → post), so
  the UI needs a "preparing your books" state.
- **To revisit:** accounts whose true history predates the 730-day Plaid window. For
  those, roll-back gives the balance at *window start*, not at an earlier chosen date —
  we must detect and disclose this rather than guess.

### 3.1 What the ledger must look like after the fix

For a business starting books on **1 January 2026** with a bank at **$80,000** on that date
and **$95,000** today:

```
2026-01-01  Dr 1010 Bank                    80,000.00
              Cr 3900 Opening Balance Equity          80,000.00     ← derived, not fetched

2026-01-02 … today   … imported activity, net +15,000.00 …

Ledger cash today = 95,000.00  =  actual bank balance   ✅
```

Under the current code the same book reads `95,000 + 15,000 = 110,000`. ❌

### 3.2 Where `3900 Opening Balance Equity` must end up

3900 is a **suspense account**, not a permanent equity account. Correct practice:

- It holds the offsetting side of every opening entry while the books are being set up.
- Once opening balances are confirmed, its balance should be **cleared to Retained
  Earnings (or Owner's Equity)** — a non-zero 3900 on a live balance sheet is a signal
  that setup was never finished.
- **Action:** add a Balance-Sheet health check that flags a non-zero 3900 after
  onboarding completes, with a one-click "Close opening balance equity" posting.

This is currently missing entirely and is a real accounting gap.

### 3.3 Pre-cutoff AR/AP is not "history" — it is an opening balance

This is the subtle one, and getting it wrong is how re-based books go out of balance.

An invoice issued in December 2025 and still unpaid on 1 January 2026 is **not**
pre-cutoff noise to be hidden. It is a **real asset on the opening balance sheet**. The
correct treatment:

- The pre-cutoff *revenue* is reversed (it belongs to the prior period). ✅ *current sweep
  does this via journal reversal*
- The pre-cutoff *receivable* must be **re-established as part of the opening balance**:
  `Dr 1200 Accounts Receivable / Cr 3900` for the amount outstanding at the cutoff. ❌
  *not done today*
- The invoice document itself stays open so the owner can still collect it. ❌ *today it is
  neither reversed nor re-established — it simply survives unfiltered*

Same logic mirrored for unpaid **bills** (`Cr 2000 Accounts Payable / Dr 3900`).

**Decision:** the cutoff sweep must compute opening AR and AP as at the cutoff date and
post them as part of the opening entry. Without this, a re-based book understates assets
and liabilities, and `entityMetrics.arMinor` (which today reads *all* open invoices
regardless of cutoff) will disagree with the Balance Sheet.

### 3.4 Guardrails that must hold

| Rule | Enforcement |
|---|---|
| Opening entry is dated **exactly** on the books-start date, never earlier | An entry dated before the cutoff falls inside its own sweep and gets reversed |
| Debits = credits on every posting | Already enforced by `postLedgerEntryCore` |
| No edits — corrections are reversals | Already enforced |
| Reversals are dated to the **original** entry's date | Already correct (`onboarding.ts:1268`) — critical, because date-range filtering would otherwise drop the original and keep the reversal, negating the books |
| A locked period is never re-based silently | Already correct — reported as `lockedEntries` |
| Moving the cutoff **twice** must not stack or lose the opening balance | Partially handled; needs an explicit test (see §5) |

### 3.5 Archived data is reachable, not hidden (decision D1)

Pre-cutoff data is **removed from the working set but remains viewable**, matching how
Xero and QuickBooks present a mid-life conversion. This is the more honest posture: an
owner who re-bases their books has not asked us to pretend the prior period never
happened — they have asked us not to count it.

**This changes the Phase 2 design.** The cutoff stops being a hard filter baked into each
query and becomes an explicit, defaulted **parameter** on the shared loader:

| Mode | Meaning | Default |
|---|---|---|
| `working` | On/after the books-start date. The books as the owner defined them. | ✅ everywhere |
| `archived` | Strictly before the books-start date. History, read-only. | opt-in |
| `all` | No cutoff bound. | exports and the audit log only |

**Rules this must obey:**

1. **`working` is the default at every call site.** A caller that forgets the parameter
   gets the correct behaviour. The unsafe mode must be the one you have to type.
2. **Archived views are read-only.** No categorising, no re-posting, no rule creation from
   an archived row. Its journal entry has been reversed; acting on it would re-introduce
   the activity the re-base removed.
3. **Never mix modes in one total.** A figure is either working-set or archived — never a
   blend. Every screen showing archived data must say so in the header, not in a footnote.
4. **Archived rows show their reversal.** An owner looking at a pre-cutoff transaction
   should see *"reversed — books start 1 Jan 2026"*, so the screen explains itself rather
   than looking like a bug.
5. **The toggle is per-surface, not global.** A global "show archived" switch that silently
   changes the Dashboard is exactly the ambiguity this decision exists to remove.

**Where the toggle appears:** Transactions, Inbox, Streams, Income, Expenses, and the
AR/AP lists. **Where it does not:** Dashboard tiles, Reports, the weekly digest, and Ask
AI — these are headline financial positions and must always be the working set. Reports
already have their own date-range control, which is the correct place to look at a prior
period.

**Consequence:** slightly more surface area in Phase 2 than a hard filter would need, and
one extra state per list screen. Worth it — it removes the "where did my data go?"
support question permanently, and it is what accountants expect.

### 3.6 One date convention — recommend following Xero (first of month)

The original bug was caused by **two** conventions coexisting: bank connect floored the
start date to the first of the month, the cutoff took the exact day. Whatever we choose,
there must be exactly one.

| Option | Precedent | Argument |
|---|---|---|
| **Exact day the owner picks** | QuickBooks | Most literal. "Start on 15 January" means the 15th. |
| **First of the month, enforced in the picker** ✅ | Xero | Clean tax/VAT periods, clean year-on-year comparatives, no split-period returns. Eliminates the bug class outright. |

**Recommendation: follow Xero.** Restrict the books-start picker to month starts and say
so in the label. The earlier draft chose exact-day on the grounds that silent flooring
"makes the product lie" — but the lie was the *silence*, not the flooring. A picker that
only offers month starts is honest; a free date field that quietly snaps backwards is not.

Small businesses convert at a month, quarter or year boundary in practice, and a
mid-month conversion splits a VAT period — which is why Xero forbids it. Reversible if
Ansar or the accountant prefers exact-day.

Whichever is chosen: `booksStartDate()` becomes the single source of truth and
`openingBalanceDate()` is deleted rather than deprecated, so the two-convention bug cannot
recur.

### 3.7 Scope: cash + AR/AP, not a full trial balance

Xero takes a **complete trial balance** at conversion — every account, including fixed
assets, loans, inventory and prepayments. OpenBooks takes **cash, AR and AP** only.

This is a deliberate simplification, not an oversight, and it is recorded here so it is
not mistaken for one:

- OpenBooks' user is a small business owner without a prior accounting system to take a
  trial balance *from*. Demanding one would block onboarding for the exact user the
  product exists to serve.
- Cash + AR + AP covers the overwhelming majority of a small service business's opening
  position.
- The residual — fixed assets, loans, inventory — lands in 3900 Opening Balance Equity and
  is visible there, which is precisely what the §3.2 close-out prompt surfaces.

**Consequence to disclose:** a business with material fixed assets or debt will have an
incomplete opening balance sheet until those are entered manually. The 3900 close-out
prompt is the moment to say so. **A future "advanced setup" accepting a full trial balance
is the natural upgrade path** — out of scope here, worth its own ADR.

---

## 4. Implementation plan

Five phases. Phases 1 and 2 are independent and can run in parallel; 3 depends on 1.

### Phase 0 — Diagnostic evidence (before any change)

**Status: 0.1 done — awaiting a run against real data (0.2, 0.3).**

**Goal:** prove the diagnosis on Ansar's actual data rather than asserting it.

- [x] **0.1** Add a read-only `convex/openingBalanceDiagnostics.ts` internal query that, per
      entity, reports: ledger cash by account, live `bankAccounts.balanceMinor`, the
      variance between them, the 3900 balance, and the count of pre-cutoff entries with and
      without reversals.
- [ ] **0.2** Run it against both of Ansar's businesses. Record the output in
      `docs/finishing/evidence/`.
- [ ] **0.3** Capture the exact Convex error text from the "All businesses" view (browser
      console + Convex dashboard logs) to confirm it is a read-limit error and not
      something else.

**Exit criteria:** the variance is quantified and matches the predicted double-count.

### Phase 1 — Fix the portfolio error (P3)

**Status: 1.1–1.4 done.** Typecheck clean, 602/603 tests passing (the one failure is a
pre-existing `seedDemo` timeout under parallel load — it passes alone in 14.9s against a
20s cap and touches none of this code). 1.5 remains a deliberate follow-up.

**Root cause found during implementation, and it was not only the budget:**
`coreViews.dashboard` loaded **each business's entire journal twice** — once inside
`computeEntityMetrics` for the metric tiles, once in its own near-identical
`loadDashboardJournal` for the widgets. On one business that was merely wasteful. Summed
across a portfolio it is what exceeded the document limit. Also worth recording:
`portfolioViews.portfolioDashboard` — the query this phase was originally scoped around —
**has no frontend caller at all.** "All businesses" goes through `coreViews.dashboard`.
Fixing only the former would have changed nothing the owner could see.

**Goal:** "All businesses" loads reliably at any book size. Unblocks Ansar immediately.

- [ ] **1.1** Land the working-tree `entityMetrics.ts` change (date-bounded journal load).
      It is correct and necessary — just not sufficient.
- [ ] **1.2** Replace the per-entry `by_entry` line collect with an **entity-scoped,
      date-bounded line query**. Add index `journalLines.by_entity_and_date` (denormalising
      `date` onto `journalLines`, populated at post time) so lines load in one indexed range
      scan instead of *N* per-entry lookups.
      **Revised on inspection:** `journalLines` carries no `date` field, so this needs a
      schema change *and* a backfill of every existing row — and Convex's ceiling is on
      **documents read**, not queries issued, so replacing *N* `by_entry` lookups with one
      range scan reads the same documents. It optimises the wrong axis. Folded into 1.5,
      where a materialised cache would make it worth the migration.
      **What actually cuts reads is bounding how much is loaded at all — 1.1 and 1.3.**
- [ ] **1.3** Make the entry cap a **shared budget divided by the entity count**, not a
      per-entity constant. `METRIC_ENTRY_LIMIT = 20000` is already near the ceiling for a
      single business; multiplied across a portfolio it cannot fit by construction. The
      budget has to be portfolio-aware.
- [ ] **1.4** Make the portfolio roll-up degrade instead of throwing: when the budget is
      exhausted, return per-business rows with `truncated: true` and render a visible
      "figures are partial" banner. **A wrong number shown confidently is worse than an
      honest partial.**
- [ ] **1.5** *(Follow-up, not blocking)* Evaluate a materialised `entityMetricsCache`
      table updated on ledger post, so the portfolio reads *N* rows instead of *N* journals.
      This is the durable answer for open-source users with large books. Write as a separate
      ADR.

**Exit criteria:** "All businesses" loads for a workspace with 5 businesses × 50k entries.

### Phase 2 — Enforce the cutoff on every read path (P2)

**Status: 2.1–2.7 done.** Typecheck clean on both packages, lint clean, 37/37 across the
affected suites. Remaining Phase 2 work is the `PENDING_MIGRATION` list (11 modules).

**Archived toggle.** Shared control in `apps/web/src/components/openbooks/BooksWindowToggle.tsx`
(toggle + banner). It renders only when the business actually has a books-start date — a
business that never re-based has no archive, and offering an empty view would invite the
"where did my data go?" question the feature exists to prevent. State is per-screen, never
global.

**Wired, server + UI:** Revenue Streams → Insights, Transactions (the register), Income
(both the cash and Invoices/AR sub-tabs), Expenses. Each query now takes `window` and
returns `window` / `booksStartDate` / `readOnly`; each screen owns its own toggle state.
AR/AP are covered by the Income → Invoices and Expenses → Bills sub-tabs rather than being
separate screens.

**The Inbox is deliberately EXCLUDED, and this is a design decision, not an omission.**
The Inbox is a work queue, not a ledger view. The re-base sweep *dismisses* pre-cutoff
inbox items, so an "archived Inbox" would be a list of dismissed items with no action
available — a queue implying work that does not exist. Worse, `inboxItems` carries no
distinction between "dismissed by the sweep" and "dismissed by the owner", so the view
would conflate the two. The archived transactions behind those items ARE reachable, from
the Transactions register, which is the right place to look at them. Revisit only if a
distinct sweep marker is added.

**2.7 — server-side read-only, done and tested.** The guard lives in
`pipeline.requireTransactionForAdmin`, the single gate every owner-facing transaction
mutation resolves through (confirm, recategorize, exclude, …), so one change covers them
all. It refuses any write to a row dated before the entity's books-start date and names the
date in the message. The SYSTEM actor path is deliberately untouched: connectors are already
blocked in `routeTransactionCore`, and the re-base sweep must keep writing to these rows.
Two tests assert the refusal, that a post-cutoff row is still editable (the guard is narrow),
and that the message names the date.
Typecheck clean on both packages. 42/42 passing across the suites covering every
changed module.

**Migrated to the scoped loaders:** `streamViews` (the reported bug), `incomeViews`,
`expensesViews`, `moduleViews`, `streamTags`, `streamRules`, `aiCfoAggregate`,
`agentToolQueries`, `weeklyDigestData`.

**Second pass — `bills` migrated, `invoices` reclassified.** `bills.matchCandidates` and
`bills.markPaid` now bound their settlement matchers, so a bill can no longer be
reconciled against a reversed, archived bank row. `invoices.ts` moved to permanently
EXEMPT: its only guarded read is `nextInvoiceNumber`, which MUST scan all history — a
cutoff-bounded scan would reissue an invoice number already used before the re-base, two
invoices sharing one number, a worse defect than the one being fixed. The AR list and
ageing live in `incomeViews`/`reportViews`, not here.

**Still unmigrated — recorded as debt, not silently skipped.** 11 modules remain on the
`PENDING_MIGRATION` list in `openingBalanceCoverage.test.ts`, each with a stated reason:
`reconciliation`, `intercompany`, `proposals`, `onboardingProposals`, `contacts`,
`categories`, `payroll`, `reports`, `ai`, `aiChatTools`, `aiChatActions`. These can still
show pre-cutoff figures on a re-based book. The guard test fails if that list grows.

**A regression this pass introduced and then corrected — worth recording.** Bounding
invoices at the cutoff removed unpaid pre-cutoff invoices from AR, the ageing and the
per-customer open balance. That understates receivables and hides debts the owner still
needs to chase. It is the §3.3 distinction, applied wrongly on the first pass. The rule is
now written at the top of `loadScopedInvoices` and applied consistently:

> **RECOGNITION is governed by the cutoff. SETTLEMENT is not.**

Revenue/cost attribution from a document → `working` (`streamViews`, `streamTags`).
AR/AP balances, ageing and document lists → `all` (`incomeViews`, `moduleViews`,
`aiCfoAggregate`, `agentToolQueries`). Revenue is computed from the journal, which is
separately bounded, so the `all` window cannot leak pre-cutoff income into the P&L.

**V6 written — `convex/streamViews.cutoff.test.ts`, 4 tests, passing.** Asserts Streams ==
P&L == Dashboard on a re-based book, that the pre-cutoff period is still readable via the
`archived` window, and that the two windows partition the books exactly (nothing counted
twice, nothing lost).

**Mutation-tested, and the first version was worthless.** Reverting the cutoff bound left
a transaction-only fixture GREEN. The reason: the re-base sweep stamps pre-cutoff
transactions `review: "excluded"`, and `streamPnl` already skipped excluded rows before any
of this work. So the transaction path was never the leak.

**The actual leak is INVOICES.** The sweep touches `journalEntries`, `transactions` and
`inboxItems` — it never touches invoices and never marks them excluded. A pre-cutoff
invoice is kept out of Streams by the cutoff bound and by *nothing else*. With a pre-cutoff
invoice in the fixture, breaking the bound makes Streams report 675,000 against a P&L of
500,000 — the same shape as the reported 300k-vs-80k.

**Consequence for diagnosis:** if the sweep did not run to completion on Ansar's books, or
if his figures are invoice-driven, that is where the discrepancy lives. Worth checking
against the Phase 0 diagnostic before assuming the transaction path was ever at fault.

**A second defect V6 caught:** the archived window read as EMPTY, because `streamPnl`'s
`excluded` skip also hid the archive — `excluded` *is* the sweep's archive marker. The
Archived toggle would have shipped showing nothing. Fixed by not applying the skip in the
archived window. Known limitation recorded in-file: a row the owner excluded by hand before
the re-base is indistinguishable from one the sweep excluded, so it also surfaces in the
archive. Separating them needs a distinct marker on the sweep.

**Design note:** the loaders live in `openingBalanceCutoff.ts`, not `entityScope.ts` as
this plan originally specified. `entityScope` owns authorization; mixing data loading into
it would blur a boundary this codebase is deliberately strict about. The cutoff module
already owns cutoff semantics, so the loaders belong there.

**Test-suite caveat, stated plainly:** the full suite shows 13 failures with these changes
and **10 on a clean tree** — all timeouts, on the same set of slow tests (`seedDemo`,
`publicDemo`, `demoGuard`, the >5,000-line report tests). Verified by stashing and
re-running. The suite is timeout-flaky on this machine at ~450s wall clock; the count
varies run to run. Not introduced here, but it means the full suite is currently not a
reliable gate and should be fixed independently.

**Goal:** one number, everywhere, consistent with the Balance Sheet.

- [ ] **2.1** Promote cutoff filtering from a per-module convention to a **shared scoped
      loader**. Add `convex/entityScope.ts` helpers — `loadScopedTransactions`,
      `loadScopedJournal`, `loadScopedInvoices`, `loadScopedBills` — that apply the cutoff at
      the *index* level. Modules call the loader; no module hand-rolls the filter again.
      Each helper takes a `mode: "working" | "archived" | "all"` parameter **defaulting to
      `working`** (decision D1, §3.5), so a caller that omits it is safe by construction.
- [ ] **2.2** Migrate each uncovered module to the loader, in user-visibility order:
      1. `streamViews.ts` — **the reported bug**
      2. `incomeViews.ts`, `expensesViews.ts`, `moduleViews.ts`
      3. `streamTags.ts`, `streamRules.ts`
      4. `invoices.ts`, `bills.ts` (AR/AP ageing)
      5. `aiCfoAggregate.ts`, `agentToolQueries.ts` — so **Ask AI stops advising on
         archived data**
      6. `weeklyDigestData.ts`, `reconciliation.ts`, `intercompany.ts`, `payroll.ts`
- [ ] **2.3** **Deliberately exempt** `exportAccount.ts` and the audit log — a full export
      must remain complete. Document the exemption in-file so a future reviewer does not
      "fix" it.
- [ ] **2.4** Add a **lint-style guard test** (`convex/openingBalanceCoverage.test.ts`,
      modelled on the existing `authzCoverage.test.ts`): every module that queries
      `transactions` / `journalLines` / `invoices` / `bills` with an entity scope must either
      use the scoped loader or appear on an explicit allow-list. **This is what stops the
      gap reopening** — the same discipline the repo already applies to authorization.
- [ ] **2.5** **Archived toggle** (decision D1, §3.5). Add a quiet segmented control —
      *Current books* / *Archived* — to Transactions, Inbox, Streams, Income, Expenses and
      the AR/AP lists. Design-system rules apply: no badge colour, no alarm red; archived is
      a neutral state, not an error.
- [ ] **2.6** Archived rows render **read-only**: action controls (categorise, create rule,
      re-post) are hidden, not merely disabled-with-tooltip, and each row carries its
      *"reversed — books start &lt;date&gt;"* provenance so the screen explains itself.
- [ ] **2.7** Server-side enforcement of read-only: the mutations behind those actions
      re-check the entity cutoff and refuse a pre-cutoff target. **The UI hiding a button is
      not a control** — same principle as the workspace authorization re-checks.

**Exit criteria:** Streams total equals the P&L total equals the Dashboard total, on a
re-based book, verified against Ansar's data — and switching to *Archived* shows the prior
period, read-only, without changing any headline figure.

### Phase 3 — Correct opening balance derivation (P1)

**Goal:** a newly onboarded business has right-first-time books with no owner input.

- [ ] **3.1** **Stop posting from the current balance.** Remove the opening-balance post
      from `linkPlaidAccounts` (`plaid.ts:2274`, `:2316`). Store `balanceMinor` as a
      reconciliation reference only.
- [ ] **3.2** Add `convex/openingBalanceDerivation.ts` — given an entity, a bank account and
      a books-start date, compute
      `openingMinor = liveBalanceMinor − Σ(imported transactions dated ≥ startDate)`,
      returning a **confidence signal**: `exact` (full history covers the start date),
      `window-limited` (history begins after the requested start), or `unavailable`.
- [ ] **3.3** **Propose, don't post.** After the initial sync completes, show the derived
      figure to the owner for confirmation against their statement, with an editable field.
      Only the confirmed figure posts, through the existing `postOpeningBalanceEntry` path
      (unchanged posting logic — only the *input number*, *date* and *authority* change).
      Per ADR-001 decision 3 and AGENTS.md: **AI proposes, the ledger engine posts.**
- [ ] **3.4** On `window-limited` / `unavailable`, propose nothing and ask outright:
      *"We couldn't confirm your balance on 1 Jan — enter it from your bank statement."*
      **Never guess.**
- [ ] **3.5** Collapse to one date convention (§3.6). Delete `openingBalanceDate()`;
      `booksStartDate()` becomes the single source of truth. If the Xero recommendation is
      accepted, restrict the books-start picker to month starts and label it as such.
- [ ] **3.6** Extend the cutoff sweep to compute and post **opening AR and AP** as at the
      cutoff (§3.3), as additional legs on the same opening entry.
- [ ] **3.7** Add the **3900 clearing** flow (§3.2, decision D2): a Balance-Sheet health
      check that flags a non-zero Opening Balance Equity once onboarding completes, offering
      an owner-initiated close-out to Retained Earnings. **The system never posts this
      automatically** — it is an equity posting and stays the owner's decision. The prompt
      states the amount and both accounts before anything is written.

**Exit criteria:** connect a Plaid sandbox account, choose a start date 6 months back, and
confirm ledger cash equals the live Plaid balance to the cent.

### Phase 4 — Migration for books already damaged

**Goal:** Ansar's two existing businesses, and any other early book, end up correct.

- [ ] **4.1** Add `convex/openingBalanceRepair.ts`: a resumable, idempotent internal
      mutation that, per entity, identifies opening entries posted from a current balance
      (`sourceId` prefix `opening:<plaidAccountId>`), **reverses** them, recomputes the
      correct figure by roll-back, and posts a replacement. Reversal only — no edits, no
      deletes.
- [ ] **4.2** **Dry-run mode first.** The repair reports what it *would* post, per entity,
      for Ansar to approve before anything is written.
- [ ] **4.3** Re-run the Phase 0 diagnostic afterwards and confirm the variance is zero.
- [ ] **4.4** Document the repair as a one-time upgrade step in
      `docs/finishing/opening-balance-behavior.md` for self-hosting users on older data.

**Exit criteria:** on both of Ansar's businesses, ledger cash == live bank balance, and
Streams / Reports / Dashboard all agree.

---

## 5. Verification plan

Unit tests extend the existing `convex/openingBalanceCutoff.test.ts` (815 lines already).

| # | Test | Guards against |
|---|---|---|
| V1 | Derived opening + imported history == live balance, to the cent | P1 double-count |
| V2 | Opening entry dated **exactly** on the chosen day, not floored | The two-convention bug |
| V3 | Reversals dated to the original — a `gte(cutoff)` read drops **both** original and reversal | The catastrophic failure mode: keeping a reversal whose original was filtered out would **negate** the books |
| V4 | Moving the cutoff twice: no stacked reversals, opening balance not lost | `postOpeningBalanceEntry` idempotency interacting with `replaceOpeningEntries` |
| V5 | Pre-cutoff unpaid invoice → revenue reversed **and** AR re-established at the cutoff | §3.3 |
| V6 | Streams total == P&L total == Dashboard total on a re-based book | P2 — the reported symptom |
| V7 | Ask AI / CFO signals return only post-cutoff figures | AI advising on archived data |
| V8 | Portfolio roll-up with 5 businesses × 50k entries returns without error | P3 |
| V9 | Coverage guard: a new module reading `transactions` without the scoped loader **fails CI** | P2 reopening |
| V10 | `window-limited` history posts nothing and raises an onboarding task | "Never guess" |
| V11 | Locked period blocks re-base and is reported, not silently skipped | Existing behaviour, needs a regression test |
| V12 | Full export still contains pre-cutoff history | The §2.3 exemption |
| V13 | A scoped-loader call with **no mode argument** returns the working set | D1 — safe by default |
| V14 | `archived` mode returns strictly pre-cutoff rows; `working` and `archived` never overlap and never blend into one total | §3.5 rule 3 |
| V15 | Categorise / re-post / create-rule against a pre-cutoff row is **refused server-side**, not just hidden in the UI | §3.5 rule 2 — re-introducing reversed activity |
| V16 | Toggling to Archived changes no Dashboard, Report, digest or Ask AI figure | §3.5 rule 5 |
| V17 | 3900 close-out never posts without an explicit owner action | D2 |
| V18 | The derived opening figure is **never posted without owner confirmation**; declining or editing it is honoured | ADR-001 decision 3 — the incumbent-aligned control |
| V19 | Only one date convention exists — `openingBalanceDate()` is gone and no caller reintroduces flooring | §3.6, the original bug's root cause |

**Manual acceptance (Ansar):**
1. Both businesses individually — Dashboard cash == real bank balance.
2. "All businesses" — loads; combined == sum of the two.
3. Streams — total matches the P&L for the same range.
4. Streams → *Archived* — the prior period is visible, labelled, read-only, and the
   *Current books* total is unchanged when you switch back.
5. A fresh test business with a 6-months-back start date — correct on day one, no manual entry.
6. Balance Sheet — 3900 Opening Balance Equity is either zero or visibly flagged with an
   owner-initiated close-out offered, never silently posted.

---

## 6. Risks and open questions

| Risk | Mitigation |
|---|---|
| Repair mis-identifies a legitimate manual opening entry and reverses it | Dry-run + explicit approval; match on `sourceId` prefix only, never on amount |
| Plaid's 730-day window doesn't reach a very old start date | Detect and disclose (`window-limited`) — never extrapolate |
| Roll-back is wrong if some imported transactions never posted (sat in Inbox) | Roll back over **imported transactions**, not **posted entries**; add an assertion that the two agree, and surface the gap if not |
| Phase 2 changes headline numbers on screens Ansar has been reading | Expected and correct — but announce it; the numbers *should* move |
| Multi-currency | Out of scope. GL is USD-only (Q20/Q24/Q25). Roll-back assumes single currency per account; flag if a non-USD account appears |

**Resolved decisions (Ansar, 2026-08-13):**

| # | Question | Decision |
|---|---|---|
| D1 | Cutoff semantics — hide pre-cutoff data, or make it reachable? | **Reachable via an "Archived" toggle**, following Xero / QuickBooks. See §3.5 — this changes the Phase 2 loader design. |
| D2 | Closing 3900 Opening Balance Equity to Retained Earnings | **Explicit owner action.** The system flags a non-zero 3900; it never posts an equity entry on the owner's behalf. |
| D3 | Phase 4 repair timing | **After Phase 2 lands**, so every corrected figure appears across all screens at once rather than one surface at a time. |
| D4 | Books-start date convention (§3.6) | **First of month, following Xero.** The picker offers month starts only and is labelled as such. `openingBalanceDate()` is deleted; `booksStartDate()` is the single source of truth. |
| D5 | Opening balance authority (ADR-001) | **Derive, then confirm.** The owner sees the rolled-back figure and confirms or corrects it against their statement. Nothing posts unconfirmed. |

No open questions remain. The one outstanding external dependency is the accountant
sign-off on §3 (see §8), which gates **Phase 3 only** — Phases 0, 1 and 2 can proceed.

---

## 7. Sequencing recommendation

```
Phase 0  (diagnostics)          ──┐
                                   ├─→ Phase 1 (portfolio error)   ← unblocks Ansar fastest
                                   └─→ Phase 2 (cutoff coverage)   ← fixes the Streams symptom
                                          │
                                          └─→ Phase 3 (correct derivation)   ← fixes the real bug
                                                 │
                                                 └─→ Phase 4 (repair existing books)
```

Phase 1 first for relief. Phase 3 is the one that makes OpenBooks correct for every
future user — it is the part that matters for an open-source bookkeeping product where
most users will never read this document.

Per decision D3, Phase 4 runs **after** Phase 2, so the repaired figures surface across
every screen at once. Per §8, Phase 3 additionally gates on the accountant sign-off;
Phases 0–2 do not, and should start now.

---

## 8. The accountant review — the five questions gating Phase 3

The engineering in Phase 3 is verifiable by tests. The accounting *policy* it encodes is a
judgement, and other businesses will run their books on it, so it should carry a
professional sign-off before it ships.

Ask these five specific questions rather than "please review this document" — a general
request returns a general answer, and each of these changes what gets built.

### Context to give them first

- Small-business bookkeeping product, **US GAAP-ish, USD only**, no multi-currency.
- Users are **converting mid-life from no prior accounting system** — typically a bank
  feed and a shoebox, not a trial balance from another package.
- The ledger is **double-entry and immutable**: corrections are reversals, never edits.
- Bank data arrives via Plaid, which returns **only the current balance** plus roughly 24
  months of transactions. A balance "as at 1 January" cannot be fetched, only derived.

### Q1 — Deriving the opening balance by roll-back

We compute the opening bank balance as
`current balance − sum of all imported transactions dated on/after the start date`,
then **present it to the owner to confirm or correct against their bank statement**.
Nothing posts unconfirmed.

> Is roll-back-then-confirm acceptable for a mid-life conversion, or must the figure come
> from a statement the owner reads themselves with no pre-filled number?

*Why it matters:* QuickBooks and Xero both ask the human outright. We pre-fill and ask for
confirmation. If they require an unassisted statement figure, task 3.2 disappears and
onboarding gets a manual step.

### Q2 — Opening AR and AP

An invoice issued before the start date and still unpaid: we reverse the prior-period
**revenue** (it is not this period's income) but re-establish the **receivable** as part of
the opening balance — `Dr 1200 A/R / Cr 3900` for the amount outstanding at the cutoff.
Mirrored for unpaid bills.

> Is that the correct treatment, and should partially-paid invoices be brought in at their
> outstanding balance or excluded entirely?

*Why it matters:* this is §3.3 and it is the piece most likely to be wrong. Without it a
re-based book understates assets. Partial payments are the specific edge we have not
resolved.

### Q3 — Opening Balance Equity

We hold 3900 Opening Balance Equity as a **suspense account**, flag it when non-zero once
onboarding completes, and offer an **owner-initiated** close-out to Retained Earnings. The
system never posts that entry automatically.

> Is owner-initiated correct, and should the close-out go to Retained Earnings or to
> Owner's Equity / Owner's Capital for a sole proprietor or single-member LLC?

*Why it matters:* the entity-type distinction is a real fork we have not handled. Sources
also conflict on whether QuickBooks ever clears OBE automatically.

### Q4 — Conversion date restricted to month starts

The books-start date picker will offer **first-of-month only**, following Xero's
conversion-date rule. QuickBooks allows any date.

> Is month-start-only right for a small-business product, or should a mid-month start be
> permitted despite splitting the tax/VAT period?

*Why it matters:* decision D4. Already decided and reversible; a veto here is cheap now and
expensive after Phase 3.

### Q5 — Scope: cash + AR/AP, not a full trial balance

Xero requires a complete trial balance at conversion — every account. We take **cash, AR
and AP only**. Anything else (fixed assets, loans, inventory, prepayments) lands visibly in
3900 for the owner to resolve.

> Is that an acceptable simplification for a small service business, and what should we
> warn the owner about at the 3900 close-out prompt?

*Why it matters:* §3.7. A deliberate limitation, not an oversight — but the disclosure
wording is what keeps it honest.

### What a "no" costs

| Answer | Effect |
|---|---|
| Q1 rejected | Drop task 3.2; onboarding gains a manual statement-entry step |
| Q2 rejected or changed | Rework 3.6; affects every re-based book, including the Phase 4 repair |
| Q3 changed | Small — the close-out target becomes entity-type-dependent |
| Q4 rejected | Revert D4 to exact-day; one change in `booksStartDate()` |
| Q5 rejected | A full trial-balance import becomes a prerequisite — a significant new feature |

Q1 and Q2 are the ones worth chasing. Q3–Q5 can be settled after Phase 3 starts without
rework.
