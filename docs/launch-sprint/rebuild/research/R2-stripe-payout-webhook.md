# R2 — Stripe Payout Reconciliation + Is a Webhook Required?

Research task: settle the canonical Stripe→books reconciliation model and decide
whether OpenBooks must **require** a Stripe webhook or merely recommend it.

Scope guardrails from ANSAR-DECISIONS: accounting is **USD-only**; do what
QuickBooks Online (QBO) does; decision #11 says "follow Stripe's API docs — if a
webhook is required for proper charge/payout sync, require it"; decision #13
allows **live** Stripe keys locally; credentials use the one shared
encrypted-at-rest shape (decision #12).

---

## Recommended decisions (adopt these)

**The settlement model — one payout = one deposit = one journal entry through a Stripe clearing account**

- **Model the Stripe balance as a clearing (in-transit) account on the balance
  sheet, not as a bank account.** This is the QBO/A2X/Synder consensus. Every
  charge, refund, fee, dispute, and adjustment posts *into* the clearing
  account; every payout moves the **net** *out* of it to the bank. After a
  payout reconciles, the clearing account zeroes out for that batch.
- **Book one journal entry per *payout* (settlement batch), not per charge.**
  This is the single most important anti-double-count rule. The structure
  (gross-up method) is:
  - DR Stripe Clearing — gross charges (sum of `charge` reporting category)
  - CR Sales/Revenue — gross sales
  - DR Refunds/Contra-revenue — refunds (`refund` category)
  - DR Stripe Fees (expense) — fees (`fee` category, plus `network_cost`)
  - DR Dispute expense / CR clearing — disputes & dispute reversals
  - DR Bank (in-transit) — **net** payout amount
  - CR Stripe Clearing — net payout amount (the `payout` line) so the batch nets to zero
- **Group the batch by `reporting_category`**, not by raw balance-transaction
  `type`. Use Stripe's consolidated categories: `charge`, `refund`, `fee`,
  `dispute`, `dispute_reversal`, `adjustment`, `payout`, `transfer`,
  `partial_capture_reversal`, `payout_reversal`, plus Connect categories
  (`platform_earning`, `connect_reserved_funds`) if/when Connect is used.
- **Always gross-up. Never book only the net deposit.** Net-only loses revenue
  and the fee expense — it is the classic Stripe bookkeeping error. Pull
  `gross`, `fee`, and `net` from the balance transactions / payout
  reconciliation report. `net = gross − fee`.
- **Source the batch contents from the Balance Transactions API filtered by
  `payout=po_xxx`** (`GET /v1/balance_transactions?payout=po_xxx&expand[]=data.source`).
  This is the programmatic equivalent of the Payout Reconciliation Report and is
  the per-payout itemization OpenBooks should ingest.
- **Match the bank-feed deposit (Plaid) to the clearing→bank transfer line, do
  not re-post it.** The deposit Plaid sees IS the payout net. Treat it as the
  settlement of the in-transit/clearing transfer (transfer-match), never as new
  income. This is the E7 double-count fix already on OpenBooks' radar.

**Webhook requirement**

- **Require a Stripe webhook for any LIVE Stripe connection. Make it a
  first-class step of "Connect Stripe", not optional.** Stripe's own docs say
  polling is "much less reliable and might cause rate limiting issues" and that
  Stripe "enforces rate limiting on API requests." Decision #11 ("if required
  for proper sync, require it") + #13 (live keys) ⇒ require the webhook.
- **Subscribe to (minimum set):**
  - `payout.paid` — payout landed in the bank (settlement). Trigger the
    batch journal entry / mark in-transit → paid.
  - `payout.failed`, `payout.canceled` — reverse/hold the in-transit posting.
  - `payout.reconciliation_completed` — **the signal that
    `GET /balance_transactions?payout=…` will now return the full batch.** Do
    NOT itemize a payout before this fires; the list is incomplete until then.
  - `charge.succeeded` / `payment_intent.succeeded` — recognize the charge.
  - `charge.refunded` — refund timing (a refund mutates the charge; the only
    reliable "this just happened" signal is the event).
  - `charge.dispute.created` / `charge.dispute.closed` — disputes hit the
    balance asynchronously, days later; not discoverable except by event.
  - `balance.available` — funds became payable (optional but useful for cash
    forecasting).
- **Keep polling as a *backfill + safety net*, never as the primary path.** Use
  `GET /payouts` + `GET /balance_transactions` for (a) initial history import
  and (b) a daily reconcile sweep to catch missed/late webhooks. Webhook = real
  time truth; poll = catch-up and audit.
- **Verify the webhook signature** (`Stripe-Signature` + signing secret) in a
  Convex HTTP action, store the **webhook signing secret** in the same
  encrypted-at-rest credential store as the API key (decision #12), and
  **dedupe by `event.id`** (Stripe can redeliver). Process events idempotently
  off a queue, return 2xx fast.

**Instant / manual payouts that can't be itemized**

- **Detect `reconciliation_status: not_applicable`** on the payout object.
  Stripe can only itemize **standard automatic** payouts via the Balance
  Transactions `payout=` filter. Instant and manual payouts return
  `not_applicable`.
- **For non-itemizable payouts, post the net to an "Unmatched Stripe Payouts"
  holding line and surface it in the Inbox for review** rather than guessing a
  split. Still record the net cash movement; flag that the gross/fee breakdown
  is unavailable. Do not fabricate a categorization. (Default per ANSAR rule:
  uncertain → Inbox, never auto-post a guess.)
- **Steer users to standard automatic payouts** in onboarding copy, because that
  is the only mode where Stripe guarantees clean one-payout-to-one-JE
  reconciliation.

**Edge cases to encode**

- **Payouts that span a month boundary:** A2X books **two** JEs so each month's
  P&L is correct (decision #2: period close = last day of month). Split the
  batch at month end.
- **Negative payouts / debits:** when refunds+fees exceed charges, Stripe debits
  the bank instead of crediting. The same JE structure works with signs flipped;
  handle a debit memo on the bank line.
- **`failed` after `paid`:** a payout can show `paid` then flip to `failed`.
  Always let the latest event win; reverse-and-repost (posted entries are
  immutable per OpenBooks rules).
- **Use the Bank Reconciliation report's `matching_key`** (e.g. `ST-…`) when
  available to tie the Stripe payout to the exact bank-statement descriptor for
  Plaid matching.

---

## Rationale

**Why one-payout-one-JE through a clearing account.** Stripe deposits the *net*
of a *batch* of many charges minus fees minus refunds. If you post each charge as
income AND let the Plaid bank feed post the deposit as income, you double-count
(the exact E7 / accounting-engine-diagnosis leak: Stripe payout matcher never
fires → phantom asset on 1160). The clearing account is the industry-standard
seam: charges/fees/refunds flow *in*, the payout flows *out*, the bank deposit
*settles* the out-leg. Net cash hits the books exactly once, while revenue and
fee expense are still recognized at gross. This is precisely how A2X and Synder
book Stripe into QBO, and it matches Stripe's own "model your Stripe balance as a
temporary clearing account" guidance for the Payout Reconciliation Report.

**Why the webhook is required, not optional.** The three facts that matter for
*correctness* are all asynchronous and arrive *after* the original API call:
(1) a payout actually settling (`payout.paid`), (2) a refund happening
(`charge.refunded`), and (3) a dispute being filed (`charge.dispute.created`),
which can land days or weeks later. Stripe states plainly that polling is "much
less reliable and might cause rate limiting issues," and that it "enforces rate
limiting on API requests." A bookkeeping ledger that silently misses a dispute or
a failed payout is wrong in a way the user can't see — unacceptable for a system
of record. Critically, **`payout.reconciliation_completed` is the gating signal**
for when the per-payout balance-transaction list is complete; without it you
either itemize too early (partial batch) or have to poll the reconciliation
status in a loop. Given decision #11 ("if required for proper sync, require it")
and #13 (live keys are allowed locally), the correct posture is: connecting
Stripe = registering the webhook endpoint, full stop. Polling remains as
historical backfill (decision #7: pull as much history as the connector gives)
and as a nightly safety sweep, because webhooks can be missed and must be
reconcilable.

**Why instant/manual go to the Inbox.** Stripe's API *cannot* tell you what's
inside an instant or manual payout (`reconciliation_status: not_applicable`).
Inventing a gross/fee split would violate "AI proposes, the ledger posts" and the
"don't fabricate accounting" rule. Recording the net and queuing the breakdown
for review is the honest, QBO-equivalent behavior.

---

## How QBO / Stripe / Plaid / industry does it

- **QBO native + the standard bookkeeper workflow:** create a **Stripe clearing
  account** (other current asset). Record gross sales (often via a sales
  receipt/JE), record Stripe fees as an expense, and record the payout as a
  **transfer** from the clearing account to the bank. The bank-feed deposit is
  *matched* to that transfer, not added as new income — which is exactly how you
  avoid double counting between the charge and the deposit.
- **Stripe's Payout Reconciliation Report** (`payout_reconciliation.itemized.7`
  / `.summary.2`) is purpose-built for the automatic-payout clearing model. It
  groups each settled batch by `reporting_category` with `gross`/`fee`/`net`,
  and links every line via `automatic_payout_id` and
  `automatic_payout_effective_at`. The Balance Summary report
  (`balance.summary.2`) gives starting/ending balance + activity + payouts. Data
  is computed daily and published ~12h later; report-availability webhooks fire
  at 00:00 and 12:00 UTC.
- **Stripe Bank Reconciliation report** adds a `matching_key` and tracks payout
  states `reconciled` / `unreconciled` / `in_transit` to tie payouts to bank
  receipts.
- **A2X:** one summarized settlement entry per payout (two if it spans a month
  boundary), breaking out gross sales, fees, refunds, tax, shipping, with the
  offset line mapped to the payment-gateway clearing/settlement account; then the
  bank deposit is matched 1:1 in the QBO bank feed.
- **Synder:** "Summary Sync" posts summarized JEs (sales, refunds, fees, payouts)
  through a Stripe clearing account that **zeroes out after each payout is
  reconciled**; "Per-Transaction" mode posts each item but still routes through
  the clearing account so the payout transfer matches the bank deposit.
- **Plaid's role in OpenBooks:** Plaid sees only the **net** bank deposit. Its
  job is to *confirm settlement and match* the clearing→bank transfer, not to
  classify the underlying revenue. The deposit descriptor is matched to the
  Stripe payout (ideally via amount + date + `matching_key`).

---

## Citations

- Payout reconciliation (API + `payout.reconciliation_completed`, automatic vs
  manual): https://docs.stripe.com/payouts/reconciliation
- Payout reconciliation report (columns, `reporting_category`, gross/fee/net,
  `automatic_payout_id`, instant-payout caveat, balance summary, report SLA):
  https://docs.stripe.com/reports/payout-reconciliation
  and https://docs.stripe.com/reports/report-types/payout-reconciliation
- Balance summary report: https://docs.stripe.com/reports/balance
- Reporting categories (charge/refund/fee/dispute/adjustment/transfer mapping):
  https://docs.stripe.com/reports/reporting-categories
- Webhooks overview (recommended for asynchronous events; events list):
  https://docs.stripe.com/webhooks
- Handle payment events with webhooks:
  https://docs.stripe.com/webhooks/handling-payment-events
- **Polling is "much less reliable and might cause rate limiting issues";
  Stripe "enforces rate limiting on API requests":**
  https://docs.stripe.com/payments/payment-intents/verifying-status
- Payout object (statuses pending/in_transit/paid/failed/canceled, method
  standard/instant, `automatic`, `arrival_date`, `reconciliation_status`
  completed/in_progress/not_applicable):
  https://docs.stripe.com/api/payouts/object
- Event types (payout.paid/failed, charge.refunded, charge.dispute.created,
  balance.available): https://docs.stripe.com/api/events/types
- Bank reconciliation report (`matching_key`, in_transit/reconciled):
  https://docs.stripe.com/bank-reconciliation
- Find what transactions were in a payout (Balance Transactions `payout=`
  filter):
  https://support.stripe.com/questions/find-what-transactions-were-included-in-or-impacted-a-payout-amount
- A2X clearing/settlement methodology + month-spanning payouts:
  https://www.a2xaccounting.com/ecommerce-accounting-hub/a2x-quickbooks
- Synder Stripe clearing-account reconciliation (summary + per-transaction):
  https://synder.com/help/how-to-reconcile-stripe-daily-summary-in-quickbooks-using-stripe-reports/
  and https://synder.com/help/reconcile-stripe-payments-in-quickbooks/
- QBO Stripe reconciliation walkthrough:
  https://www.goshenaccountingsvcs.com/blog/record-and-reconcile-stripe-transactions-quickbooks-online
