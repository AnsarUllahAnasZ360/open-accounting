# R1 — QBO 'For Review' Add/Match/Transfer, matching tolerances, reconciliation & Undeposited Funds

Research task: define concrete, decision-ready numbers for OpenBooks' bank-line
auto-match (payout/deposit tolerance, date window, when to require manual Match),
modeled on how QuickBooks Online actually behaves, with Stripe/Plaid timing folded in.

Scope guardrails honored: USD-only accounting (ANSAR-DECISIONS #3); QBO is the
default-behavior oracle (#1, default rule); intercompany money movement →
transfer, never income/expense (#6); pull-as-much-history default with user-chosen
start (#7).

---

## Recommended decisions (adopt these concrete values)

### A. Bank-line auto-match candidate window (mirror QBO exactly)

- **Date window for finding candidate matches: 90 calendar days BEFORE the bank
  line's date and 20 calendar days AFTER.** This is QBO's documented suggested-match
  window and is asymmetric on purpose (a recorded invoice/bill usually predates the
  bank settlement; the bank line rarely predates the record by much). Anything
  outside this window is never auto-suggested and must be matched manually.
- **Amount for a 1:1 auto-match: EXACT to the minor unit (0 cents tolerance) by
  default.** QBO's auto-match requires the same dollar amount; it does not silently
  absorb a difference. OpenBooks should require `amountMinor` equality for the
  highest-confidence auto-post.
- **Uniqueness guard: only auto-match when exactly ONE candidate satisfies (exact
  amount + within window + unreconciled + same ledger account + already posted).**
  If two or more candidates tie, do NOT auto-match — send to Inbox/"Find Match"
  for human pick. (QBO suppresses auto-suggestions when the amount is not unique.)
- **Eligibility filters for a candidate (all required):** posted to the ledger
  (has a journal entry, not still in Inbox), unreconciled (not locked by a closed
  reconciliation), same bank/credit-card account as the bank line, and not already
  matched to another line.

### B. Confidence-graded tolerances OpenBooks should layer on top of QBO's exact rule

QBO is binary (exact or manual). OpenBooks runs an autonomy engine
(suggest / balanced 0.90 / autopilot 0.75), so define graded bands instead of a
single cliff. Recommended bands for a candidate already inside the 90/20 window
and on the same account:

| Band | Amount delta | Date delta | Action |
|---|---|---|---|
| **Auto-match (high)** | exact (0 minor units) | within window, ≤ 14 days apart | propose at high confidence; eligible to auto-post under balanced/autopilot |
| **Auto-match (settlement-fee aware)** | within **max($0.50, 1.0%)** of bank line, where the record is a card/processor charge | ≤ 5 days apart | propose, but route to Inbox for confirm unless a fee/clearing rule explains the gap |
| **Suggested (medium)** | within **max($2.00, 2.0%)** | within window | show as suggested match; never auto-post; human confirms |
| **No auto-match** | beyond 2% / $2 OR outside 90-20 window OR >1 tie | — | manual "Find Match" only |

- **Default amount tolerance for a plain bank deposit/withdrawal vs. an
  invoice/bill payment: $0 (exact).** Use the fee-aware 1%/$0.50 band only when the
  counterpart is a payment-processor charge or a fee-bearing instrument.
- **Hard ceiling on any tolerance: never auto-MATCH (let alone auto-post) above a
  2% / $2.00 difference.** Above that, require manual selection.

### C. Stripe / processor payout matching (the OpenBooks double-count fix)

This is the case that actually bites OpenBooks (Plaid bank deposit vs. Stripe
payout). Adopt the **gross-clearing-account** model, not amount-fuzzing:

- Book each Stripe charge as: **Dr Stripe Clearing / Cr Revenue** (gross).
- Book each Stripe fee as: **Dr Processing Fees Expense / Cr Stripe Clearing**.
- Book each Stripe payout as: **Dr Bank / Cr Stripe Clearing** for the NET amount.
- The Plaid bank deposit then matches the payout's **net** amount **exactly** —
  because the fee already left via the clearing account. **No fuzzy tolerance is
  needed or wanted here.** The payout `amountMinor` (net) must equal the Plaid
  deposit `amountMinor`.
- **Payout↔deposit match key:** net amount exact + arrival-date window of
  **−2 / +5 business days** around Stripe's expected arrival date (Stripe is T+2
  rolling and "less than 5 business days ago = in transit at your bank"). If Stripe
  gives an `arrival_date`, anchor on it; widen only to +5 business days for slow
  bank posting.
- **In-transit handling:** when Stripe says paid but Plaid has not yet shown the
  deposit, hold the payout as an **in-transit/clearing** balance (do not post a
  second bank debit). Match-and-clear when the Plaid line lands. This is what kills
  the +$458k phantom-asset double-count noted in the accounting diagnosis.

### D. When to REQUIRE manual Match (no auto)

Force a human (Inbox "Find Match") when ANY of these holds:
- amount delta exceeds the band ceiling (>2% or >$2.00),
- more than one candidate ties on amount within the window,
- the only candidate is outside the 90/20 window,
- the match would be one bank line ↔ multiple records (batch/partial — QBO can't
  auto-do partial-payment matches either),
- the candidate is in a closed/reconciled period.

### E. Reconciliation (statement-anchored, difference-to-zero)

- Anchor each reconciliation on the **statement ending balance + ending date**
  the user enters from the bank statement.
- User ticks each line **cleared**; running **Difference = (statement ending −
  beginning) − (cleared deposits − cleared payments)**.
- **Finish is blocked until Difference = $0.00.** Do not let a reconciliation
  close with a non-zero difference.
- Bank fees / interest discovered on the statement are entered **as their own
  journal lines during reconcile** (fee = expense, interest = income) — never
  baked into the ending-balance figure.
- If a user force-completes with a residual, QBO posts an **auto-adjustment
  journal entry** to a "Reconciliation Discrepancies" expense account. OpenBooks
  may mirror this but should make it explicit and reversible (posted entries are
  immutable → reverse-and-repost), and surface it loudly rather than silently.
- **Opening balance / period boundaries (per ANSAR #2): opening-balance date =
  first day of the month; period close = last day of the month.**

### F. Undeposited Funds / clearing for grouped deposits

- Keep an **Undeposited Funds (clearing) account**: customer payments and sales
  receipts land there first (Dr Undeposited Funds / Cr A/R or Revenue).
- A **Bank Deposit** groups several undeposited payments into ONE deposit whose
  total equals the single bank line the bank actually shows
  (Dr Bank / Cr Undeposited Funds).
- The Plaid bank line then matches that grouped deposit **exactly** (sum of the
  grouped payments = bank line). This is the mechanism that makes "one bank line =
  many customer payments" reconcile line-for-line **without** needing amount
  tolerance — grouping replaces fuzzing.
- Use the same clearing pattern for any batched settlement (Stripe payouts,
  merchant batches): clearing/Undeposited-style account in, single net line out.

---

## Rationale

1. **Exact-amount-first beats fuzzy-amount-first.** Every real double-count and
   reconciliation headache in this domain comes from batching and fees, not from a
   bank reporting $99.98 instead of $100.00. QBO matches on exact amount and solves
   the "many payments, one deposit" and "gross vs. net" problems with **clearing
   accounts** (Undeposited Funds, processor clearing), not with amount tolerance.
   OpenBooks should copy that: tolerance is a last-resort confidence nudge, not the
   primary mechanism. This also keeps debits=credits trivially true.
2. **The 90/20 window is the right default** because it matches QBO operator muscle
   memory and reflects real settlement lag (records precede settlement; settlement
   rarely precedes the record by much). It is wide enough to catch month-old
   invoices and narrow enough to avoid stale false positives.
3. **Uniqueness guard is the cheapest way to avoid wrong auto-posts.** Most bad
   auto-matches are two same-amount records competing; refusing to auto-match a tie
   removes that class entirely and routes it to a human, consistent with
   "AI proposes, the ledger posts."
4. **Graded bands fit OpenBooks' autonomy model** (0.90 / 0.75) where QBO's single
   binary rule does not. The bands let autopilot auto-post only the exact, unique,
   recent case, while balanced/suggest hold the fee-aware and fuzzy cases for review.
5. **Stripe net-amount-exact + clearing kills the known phantom-asset bug.** The
   diagnosis already traced the +$458k phantom 1160 balance to a payout matcher that
   never fires; the fix is structural (clearing + in-transit hold + net-exact match),
   not a looser tolerance.
6. **Difference-must-be-zero reconciliation is non-negotiable** and is exactly how
   QBO gates "Finish." Allowing a non-zero close silently corrupts the ledger; the
   only escape hatch (an explicit discrepancy adjustment) must be visible and
   reversible because posted entries are immutable.

---

## How QBO / Stripe / Plaid / industry does it

**QBO 'For Review' — Add vs. Match vs. Transfer.**
- **Add (categorize):** the bank line has no existing record; QBO creates a new
  transaction and posts it to a chart-of-accounts category. Use when nothing in the
  books corresponds.
- **Match:** the bank line corresponds to a record already entered (invoice
  payment, bill payment, sales receipt, expense). Matching links them so no
  duplicate is created. Only match when a record already exists.
- **Transfer:** the bank line is money moving between two of your own accounts.
  When both accounts are connected, both feeds show the line; you record it once as
  a Transfer and Match it from both registers so it isn't double-counted. (This is
  the lever OpenBooks reuses for intercompany detection per ANSAR #6 — internal
  money movement is a transfer, never income/expense.)

**QBO auto-match mechanics.**
- Suggests a match when a posted, unreconciled, same-account record has the **same
  amount** and falls within **90 calendar days before to 20 calendar days after**
  the bank line's date (corroborated across multiple Intuit help pages and
  practitioner write-ups).
- Auto-suggestion is suppressed when the amount is not unique among candidates.
- Outside the window or for non-exact amounts, the user opens **Find Match**, which
  lets them widen the date range, search by name/amount, and tick multiple records
  until the selected total equals the bank line (handles batch deposits).
- **Partial payments cannot be auto-matched**; QBO requires recording the partial
  on the source transaction and excluding/handling the bank line manually. Small
  residuals can be closed with **Resolve Difference**, which posts an adjusting GL
  entry to make the difference zero.

**QBO reconciliation.**
- User enters statement **ending balance + date**; ticks each line cleared; the
  **Difference must equal 0.00** to finish. Service charges and interest from the
  statement are entered as their own lines during reconcile, not folded into the
  ending balance. Forcing a close with a residual makes QBO post an automatic
  journal entry to **Reconciliation Discrepancies**.

**QBO Undeposited Funds.**
- A clearing ("digital drawer") account holding received-but-not-deposited
  payments. A **Bank Deposit** groups them into one deposit equal to the real bank
  line, so reconciliation is line-for-line. Purpose is explicitly to make QBO
  deposits match the bank statement without forensic work.

**Stripe payouts / reconciliation.**
- Stripe collects **gross**, deducts fees, deposits **net** on a rolling **T+2**
  schedule, bundling many charges into one payout. (As of the Sept 29 timing change,
  Stripe initiates a payout on its scheduled arrival day.) "Sent less than 5
  business days ago" = funds in transit at your bank.
- Standard accounting pattern: **Stripe Clearing account** — charge (Dr Clearing /
  Cr Revenue), fee (Dr Fees Expense / Cr Clearing), payout (Dr Bank / Cr Clearing
  for net). The bank deposit matches the payout net exactly. Stripe's own **Payout
  reconciliation report** and **Bank reconciliation report** exist to match payouts
  to the cash that lands in the bank.

**Plaid.**
- The destination bank account is connected via Plaid so the **net deposit syncs**
  and can be matched to the Stripe payout. Bank posting can lag the payout
  (weekends/holidays), motivating the in-transit/clearing hold and the −2/+5
  business-day arrival window.

---

## Citations (URLs)

- How to use automatic matching in QuickBooks Online — https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-transactions/use-automatic-matching-quickbooks-online/L3uACzdrF_US_en_US
- Match transactions in QuickBooks Online — https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-transactions/match-transactions-quickbooks-online/L0MF3Fn6y_US_en_US
- Match your bank and credit card transactions — https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-feeds/match-online-bank-transactions-quickbooks-online/L6qyw0PvP_US_en_US
- Categorize online bank transactions (Add vs Match) — https://quickbooks.intuit.com/learn-support/en-us/help-article/banking/categorize-match-online-bank-transactions-online/L1bTafTz3_US_en_US
- Automatically match QuickBooks Online product (Payments) transactions — https://quickbooks.intuit.com/learn-support/en-us/help-article/payment-processing/automatic-matching-quickbooks-payments/L3EydeQEU_US_en_US
- Transfer funds between accounts — https://quickbooks.intuit.com/learn-support/en-us/help-article/banking/transfer-funds-accounts/L9E8Kvsoy_US_en_US
- Fix issues at the end of a reconciliation — https://quickbooks.intuit.com/learn-support/en-us/help-article/statement-reconciliation/fix-issues-end-reconciliation-quickbooks-online/L3mZimyAb_US_en_US
- Managing your Undeposited Funds account — https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-deposits/whats-undeposited-funds-account/L6Jan3iRK_US_en_US
- Deposit payments into the Undeposited Funds account — https://quickbooks.intuit.com/learn-support/en-us/help-article/payroll-setup/deposit-payments-undeposited-funds-account-online/L1td0m8Z2_US_en_US
- Firm of the Future — bank feed matching tips (90/20 window) — https://www.firmofthefuture.com/bookkeeping/tips-for-working-in-quickbooks-onlines-bank-feed-matching-transactions/
- Redmond Accounting — Mastering QBO Bank Feed Matching — https://redmondaccounting.com/2025/05/27/quickbooks-bank-feed-matching/
- Stripe — Receive payouts — https://docs.stripe.com/payouts
- Stripe — Payout schedules FAQ — https://support.stripe.com/questions/payout-schedules-faq
- Stripe — Payout reconciliation report — https://docs.stripe.com/reports/payout-reconciliation
- Stripe — Bank reconciliation — https://docs.stripe.com/bank-reconciliation
- Stripe — Where is my payout? (in-transit < 5 business days) — https://support.stripe.com/questions/where-is-my-payout-faq-for-late-and-missing-payouts
- Plaid — Auth + Stripe partnership — https://plaid.com/docs/auth/partnerships/stripe/
- Acodei — Reconcile Stripe to QuickBooks Online (clearing-account pattern) — https://www.acodei.com/blog/how-to-reconcile-stripe-to-quickbooks-online
