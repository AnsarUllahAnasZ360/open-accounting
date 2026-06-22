# R3 — Opening Balances, Period Close, and History Import Window

Research task: how QuickBooks Online (QBO) books an opening balance, how it closes a
period, and how much bank history QBO/Plaid/Stripe actually deliver. Output is
decision-oriented: it resolves the OpenBooks open questions with concrete values.

Confirms Ansar decisions #2 (opening balance = first day of month; close = last day of
month) and #7 (history window = user-chosen, default = pull as much as the connector
gives). USD-only per decision #3.

---

## Recommended decisions (adopt these)

### Opening balance posting

- **One ledger journal entry per opened account.** When the user starts tracking a bank
  or credit-card account, post a single balanced entry:
  - Bank/asset account: **Debit the account, Credit `Opening Balance Equity`** for the
    statement balance as of the cutover date.
  - Credit-card/liability account: **Credit the account, Debit `Opening Balance Equity`**.
  This is exactly QBO's behavior. The offset is always `Opening Balance Equity` (OBE), a
  system equity account.
- **As-of date = the first day of the month of the user's chosen history start.** Per
  decision #2, books open at the start of a month. If the user picks (or the connector's
  earliest available transaction is) any day in month M, the opening balance is dated
  `M-01`, and imported transactions begin on or after `M-01`. The opening balance must be
  dated **before the oldest imported transaction** (QBO's own rule) — flooring to the
  first of the month guarantees this.
- **Opening-balance amount = `ledger-balance-at-start minus sum(imported transactions in
  the period after the start date)`.** Concretely: take the bank's *current available
  balance* and walk it backward by the transactions you imported, OR take the bank
  statement's *beginning balance* for the opening month if available. The goal is that
  `opening balance + all imported transactions = the account's real current balance`. This
  is the single most common source of QBO reconciliation pain; get it right by deriving
  from current balance minus imported activity rather than asking the user to type a
  number.
- **OBE is a temporary holding account, ideal balance = $0.** It exists only to make the
  first entry balance. It is **not** a number the user should ever see in plain-English
  surfaces. Two acceptable resolutions, both standard QBO practice:
  1. Leave OBE alone during setup; let an "opening balances" review step (or the user's
     accountant) reclassify it to `Owner's Equity` / `Retained Earnings` later.
  2. For OpenBooks' plain-English model: auto-reclassify the OBE balance into
     `Owner's Equity` (or `Retained Earnings` if the business predates the start date) once
     the first reconciliation matches, via a reverse-and-repost correction — never by
     editing the posted opening entry.
- **The opening balance is auto-marked reconciled.** QBO does this so the opening entry is
  excluded from the first month's reconciliation difference. Mirror it: flag the opening
  journal line as reconciled/cleared at post time.
- **Editing the opening balance = reverse and repost, never mutate.** Per the OpenBooks
  immutability rule, an opening-balance correction posts a reversing entry plus a new
  opening entry. (QBO lets you edit the original register line; OpenBooks must not, because
  posted entries are immutable.)

### Period close

- **Close = a per-workspace closing date stored on the workspace, defaulting to the last
  day of a month.** This mirrors QBO's "Close the books" toggle + closing date, which
  lives under *Account and settings → Advanced → Accounting*.
- **The closing date locks every posted entry dated on or before it.** No mutation, no new
  back-dated posting into a closed period without an explicit reopen/override. This is
  exactly QBO's lock semantics.
- **Closing-date password → owner/admin override, not a literal password.** QBO gates
  edits behind a closing-date password. OpenBooks should gate back-dated changes behind an
  explicit "reopen period" / elevated action and warn loudly, rather than copying the
  password UX verbatim. Show QBO's warning analog: "This is dated on or before your closing
  date of <date>. Changing it can affect your filed reports."
- **Corrections to a closed period = reverse and repost in the *current open* period**, or
  reopen → reverse-and-repost → reclose. Default to posting the reversal/correction in the
  current open month so closed reports stay stable, which is what accountants actually do.
- **Retained earnings rolls automatically at year boundaries — don't post a literal
  closing entry per month.** Like QBO, OpenBooks should compute period/year P&L by querying
  journal lines (decision: reports query the ledger). Net income closes to Retained
  Earnings implicitly in the equity rollup at fiscal-year end; a monthly close just *locks*
  the period, it does not zero out P&L accounts. (Decision #2's "period close = last day of
  month" is a *lock date*, not a monthly closing journal entry.)

### History import window

- **No hardcoded 6-month window. The user chooses the start date; default = pull as much
  as the connector gives.** (Decision #7.)
- **Plaid: set `transactions.days_requested = 730` (the maximum, 2 years) by default**, so
  OpenBooks always asks for the deepest history Plaid offers. Then let the user pick a
  *later* start date if they want a shorter window; we filter on our side, but we never
  request *less* than what's available.
  - Critical implementation note: for Items initialized with Transactions at Link, you
    **must** pass `transactions.days_requested` in the `/link/token/create` request, not in
    `/transactions/sync`. Once an Item is initialized, the field has no effect — you can't
    deepen history after the fact without re-linking. So **request 730 up front, every
    time.**
  - Reality check to surface to the user: most banks return ~**90 days to 24 months**;
    Plaid's *requested* max is 730 days but the *actual* depth is bank-dependent and often
    less. Don't promise 2 years; promise "as far back as your bank allows."
  - Wait for `HISTORICAL_UPDATE_COMPLETE` (via the `SYNC_UPDATES_AVAILABLE` webhook /
    `transactions_update_status`) before telling the user the backfill is done.
- **Stripe: walk all history from account inception, no day window.** Stripe is *not*
  limited like Plaid — `charges`, `payouts`, and `balance_transactions` are retrievable
  back to account creation via cursor pagination (`created` filter + `starting_after` /
  `has_more`). Only the **`/v1/events`** endpoint is capped (≈30 days full / 13 months
  summary in dashboard), and OpenBooks should not depend on `events` for historical
  backfill — page the object-list endpoints instead. So: **for Stripe, the user's chosen
  start date is the only limit; default = everything.**
- **CSV/OFX/QBO upload covers the gap beyond the connector.** When the user wants older
  history than Plaid returns, mirror QBO: let them upload a CSV/OFX/.qbo from their bank
  (banks export 12–24 months). This is the standard QBO escape hatch for the 90-day feed
  limit and should be a first-class OpenBooks import path, not an afterthought.
- **History start floors to the first of its month** and drives the opening-balance date,
  so the two systems stay consistent.

### UX for user-chosen history start (recommended flow)

1. On connect, default the slider/date-picker to **"Pull everything available"** (Plaid
   730 / Stripe inception).
2. Offer a single date control: *"Start my books on…"* with smart presets —
   *Beginning of this year (Jan 1)*, *Start of last month*, *Custom date*, *Everything*.
3. Whatever they pick, **snap to the first of that month** and show the resulting opening
   balance date plainly: *"Your books will open on June 1, 2026 with a starting balance of
   $X."*
4. Show a non-blocking note: *"Your bank provides about N months of history; older
   transactions can be added by uploading a statement file."*
5. The chosen start date sets both the import filter and the opening-balance journal date.

---

## Rationale

- **Why floor to first-of-month:** QBO requires the opening balance to predate the oldest
  imported transaction, and Ansar wants books to open at month start. Flooring the
  user-chosen start to `M-01` satisfies both with zero ambiguity, makes the first
  reconciliation land on a clean statement boundary, and makes period-close (month-end)
  symmetric with period-open (month-start).
- **Why derive the opening amount from current balance minus imported activity:** Typing a
  beginning balance is the #1 cause of "my QBO won't reconcile" threads. If OpenBooks
  imports N transactions starting `M-01`, the only opening number that makes the account
  tie out is `current_balance − Σ(imported)`. Computing it removes an entire class of
  support pain.
- **Why request Plaid 730 every time:** `days_requested` is locked at Item initialization.
  Asking for less to "save time" permanently caps that Item's history. Always ask for the
  max; filter down locally if the user wants a shorter book.
- **Why Stripe is unbounded but Plaid is not:** Plaid is a bank-feed aggregator constrained
  by what each bank's connection exposes (commonly 90 days–24 months). Stripe is the system
  of record for its own payments and retains full object history; only its *event stream*
  (not the object lists) is time-boxed. Treating them identically would needlessly truncate
  Stripe history.
- **Why a lock-date close, not monthly closing entries:** Modern cloud ledgers (QBO,
  Xero) close by *locking* a date and computing period results from the journal on demand.
  Posting monthly closing entries to zero P&L is a legacy desktop pattern that fights the
  "reports query journal lines" rule. Retained earnings rolls at fiscal-year end in the
  equity rollup.
- **Why reverse-and-repost everywhere:** OpenBooks posted entries are immutable. QBO
  *allows* in-place edits; OpenBooks cannot, so every "edit the opening balance" or "fix a
  closed-period entry" becomes a reversing entry + a fresh posting. This is stricter than
  QBO but consistent with the OpenBooks ledger contract and with auditable accounting.

---

## How QBO / Stripe / Plaid / industry does it

### QuickBooks Online — opening balance

- The opening balance "represents the amount in a bank or credit card account on the day
  you start tracking it." QBO auto-creates and uses an **Opening Balance Equity** account
  as the offset to keep the books balanced and matching the bank statement.
- **As-of date:** new account → the day you opened it at the bank; existing account → the
  beginning date of your next statement. The entry must be dated **before the oldest
  transaction** in the account.
- **Direction:** asset accounts (checking/savings) → opening amount in **Debit**, offset to
  **Credit** OBE. Liability/equity/income (e.g., credit cards) → opening amount in
  **Credit**, offset to **Debit** OBE.
- The opening-balance entry is **auto-reconciled** so it's excluded from future
  reconciliations.
- **Editing later:** if you forgot the opening balance you add it via a journal entry
  dated before the oldest transaction; you can also adjust the OBE via journal entry. The
  *ideal OBE balance is zero* — once setup is done you clear OBE into Owner's Equity or
  Retained Earnings (Debit OBE / Credit Retained Earnings).

### QuickBooks Online — period close

- Closing the books lives under **Settings → Account and settings → Advanced → Accounting
  → "Close the books"**; you enter a **Closing date** and optionally require a **closing
  date password**.
- Setting the closing date **prevents/locks changes to transactions dated on or before it**
  without the password. Editing such a transaction triggers a warning and (if enabled) a
  password prompt.
- Best practice: **reconcile up to the lock date first, then set the closing date.**
- To change a closed period you reopen the books (clear or move the closing date), make the
  correction, then re-close. Net income closes to **Retained Earnings** at fiscal year-end
  automatically.

### Plaid — history depth

- `/transactions/sync` (and Link) `transactions.days_requested`: **default 90, maximum
  730, production minimum 30** days. Up to ~2 years requested.
- If Transactions is initialized at Link, `days_requested` **must** be set in
  `/link/token/create` — setting it later in `/transactions/sync` has **no effect** for an
  already-initialized Item.
- Actual returned depth is **bank-dependent**; commonly an Item includes only ~3 months
  for some institutions, and Plaid documents per-bank limits (e.g., Capital One).
- Use the **`SYNC_UPDATES_AVAILABLE`** webhook and `transactions_update_status`
  (`HISTORICAL_UPDATE_COMPLETE`) to know when historical backfill finishes.

### QBO — bank feed history (industry comparison)

- Connecting a bank typically downloads only **~90 days** of history; some banks allow up
  to **24 months**. Older transactions **can't be downloaded via the feed** and are added
  via **CSV / Web Connect (.qbo)** upload (banks export 12–24 months).

### Stripe — history depth

- `charges`, `payouts`, and `balance_transactions` list endpoints support a **`created`**
  filter and cursor pagination (`starting_after`, `has_more`), returning data **back to
  account creation** — no fixed day cap. Page all of it for a full backfill.
- Only the **`/v1/events`** endpoint is time-limited (≈30 days full detail / older events
  summarized; dashboard shows ~13 months). Do **not** rely on `events` for historical
  reconstruction; page the object lists instead.

---

## Citations (URLs)

- Enter and manage opening balances in QuickBooks Online —
  https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-deposits/enter-opening-balance-account-quickbooks-online/L7NcxTbuu_US_en_US
- What to do if you didn't enter an opening balance in QBO —
  https://quickbooks.intuit.com/learn-support/en-global/help-article/journal-entries/enter-opening-balance-quickbooks-online/L4l3NZSMR_ROW_en
- How to create and adjust the Opening Balance Equity (QBO Community) —
  https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/how-to-create-and-adjust-the-opening-balance-equity/00/1460283
- Opening Balance Equity and Retained Earnings (QBO Community) —
  https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/opening-balance-equity-and-retained-earnings/00/250138
- What is opening balance equity in QuickBooks (Synder) —
  https://synder.com/blog/what-is-opening-balance-equity-in-quickbooks-and-how-to-manage-it/
- Close your books in QuickBooks Online (Intuit) —
  https://quickbooks.intuit.com/learn-support/en-us/help-article/close-books/close-books-quickbooks-online/L59LelyPM_US_en_US
- Edit your closed books in QuickBooks (Intuit) —
  https://quickbooks.intuit.com/learn-support/en-us/help-article/customer-company-settings/edit-closed-books/L76xHuaZ5_US_en_US
- How To Set a Closing Date Inside QuickBooks (Candus Kampfer) —
  https://canduskampfer.com/how-to-set-a-closing-date-inside-quickbooks/
- Plaid API — Transactions (/transactions/sync, days_requested) —
  https://plaid.com/docs/api/products/transactions/
- Plaid — Introduction to Transactions —
  https://plaid.com/docs/transactions/
- Plaid — Why does this Item include only three months of transaction history? —
  https://support.plaid.com/hc/en-us/articles/24631662544919
- Connect bank and credit card accounts to QuickBooks Online (90-day feed) —
  https://quickbooks.intuit.com/learn-support/en-us/help-article/banking/connect-bank-credit-card-accounts-quickbooks/L4yDAHMNH_US_en_US
- Stripe API — List all balance transactions —
  https://docs.stripe.com/api/balance_transactions/list
- Stripe API — List all charges —
  https://docs.stripe.com/api/charges/list
- Stripe API — Pagination (has_more / starting_after) —
  https://docs.stripe.com/api/pagination
- Stripe — Event retention period (events ~30 days API / 13 months dashboard) —
  https://support.stripe.com/questions/stripe-event-retention-period
