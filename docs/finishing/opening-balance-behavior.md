# Opening balance on bank connect (E1-T2)

When a real bank account is connected through Plaid, OpenBooks now books a single
balanced opening journal entry so the general ledger starts at the bank's real
cash position instead of $0 (fixes RC3: connecting a bank previously stored only
`balanceMinor` and never posted, leaving ledger cash and Equity at $0).

## Posting rule

- Posted through the single ledger path (`postLedgerEntryCore` in
  `convex/plaid.ts:postOpeningBalanceForBankAccount`). No table is written
  directly.
- Positive starting balance: `Dr <bank ledger account> / Cr 3900 Opening Balance
  Equity`.
- Negative starting balance (e.g. a credit card): the reversed direction,
  `Dr 3900 / Cr <bank ledger account>`. The entry always balances.
- Zero starting balance posts nothing.
- Amount is the Plaid-reported balance in USD integer minor units only — no
  `fxRate`, no currency conversion (the GL is USD-only; decision Q20).

## Date

- Dated the **first day of the month** of the chosen history start (or the
  connector's earliest activity); any supplied start date is floored to `M-01`
  (decision Q2) so the opening entry predates the oldest imported transaction.

## Idempotency

- Tagged `source: "manual"`, `sourceId: "opening:<plaidAccountId>"`, audit action
  `system.connect.opening_balance.posted`, actor = the system sync user.
- Re-connecting or re-syncing the same account posts **no** additional opening
  entry (guarded by the existing `opening:<plaidAccountId>` entry).
- The opening entry is a posted, immutable ledger entry, which is the
  system-of-record "cleared" state for the line.

## Dashboard reconciliation

- The earlier UI-level override (commit 059a71d) that displayed the raw live
  Plaid `balanceMinor` on the dashboard whenever a Plaid account was linked has
  been removed (`convex/coreViews.ts` bank-balances loader). Dashboard cash now
  reads the posted ledger balance, which includes the opening entry, so the
  dashboard and the balance sheet agree.
