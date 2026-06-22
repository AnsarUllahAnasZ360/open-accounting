# Stripe clearing / in-transit health model (E1-T4)

This note documents the per-payout clearing-zeroes invariant, the
`stripeClearingHealth` tripwire, and the one-time `drainResidualInTransit`
correction. All three live in `convex/stripe.ts`.

## The two clearing accounts

- **1150 Stripe Clearing** (asset) — where recognized Stripe revenue lands. A
  charge posts `Dr 1150 / Cr 4000 Sales` (plus `Dr 5600 Fees / Cr 1150` for the
  processing fee). Money sits in clearing until a payout sweeps it.
- **1160 Payouts In-Transit** (asset) — where a payout's net sits between the
  payout being created on Stripe's side and the cash actually arriving in the
  bank. A payout posts `Dr 1160 / Cr 1150` for `gross − fees`. The matched Plaid
  deposit later posts `Dr Bank / Cr 1160`, so the bank is debited exactly once,
  at arrival.

One payout = one deposit = one chain. When the chain completes, **both 1150 and
1160 net to ~0** for that batch. That is the whole correctness signal.

## The per-payout invariant

In `applyProjectionCore`'s payout loop, after posting the balanced `Dr 1160 /
Cr 1150` drain we re-read 1150. The drain amount must equal `gross − fees` (true
by construction) and 1150 must not be left negative beyond a documented epsilon
(`CLEARING_DRIFT_EPSILON_MINOR = 1` minor unit, for rounding noise).

- The drain entry is **always** posted — it is internally balanced, so the
  ledger is never left half-posted, and a real payout webhook can legitimately
  arrive before its charges are synced.
- If 1150 crosses negative after the drain, the upstream charges for this payout
  were not recognized (a half-posted chain). We surface a `clearing_drift` Inbox
  card (new `inboxItems.kind`) instead of silently letting clearing run negative.
  A later income sync that credits 1150 repairs the balance; the card explains
  the gap until then.
- A clearing-drift does **not** poison the payout status (it stays `pending`),
  so the deposit can still reconcile it via the E1-T3 Match action.

## `stripeClearingHealth(entityId)`

A standing read-only tripwire returning
`{ clearingBalanceMinor, inTransitBalanceMinor, pendingPayouts, isHealthy, reasons }`.

`isHealthy` is **false** when either:

1. **1150 is materially negative** — a half-posted / over-drained chain; or
2. **1160 is materially positive with zero pending payouts** — cash that should
   have arrived never matched a deposit (the $458k phantom-asset symptom).

A positive 1160 *with* pending payouts is expected (those deposits haven't landed
yet) and stays healthy.

## `drainResidualInTransit(entityId)` — one-time correction

For legacy books where a payout was reconciled directly to the bank (`Dr Bank /
Cr 1150`) at payout time, a later re-sync under the in-transit model added a
`Dr 1160 / Cr 1150` drain that was never offset, leaving 1160 inflated.

The admin-only mutation walks each **reconciled** payout (`bankTxnId` set),
computes its residual on 1160 across its `entryIds`, and — only when that residual
is still positive — posts the **exact reversal** of the in-transit entry through
`postLedgerEntryCore` (`reversesEntryId`, honoring immutability). The cash already
arrived via the legacy bank debit, so the reversal only removes the phantom 1160
asset and restores 1150. It is idempotent: a payout whose residual is already ~0,
or whose in-transit entry is already reversed, is skipped, so re-running drains
nothing new. Pending payouts are never auto-zeroed here — they settle via the
E1-T3 Inbox Match action so the deposit remains the single cash event.

Per decision Q4 this is run **both** as a one-time drain against the live book and
kept as the standing `stripeClearingHealth` tripwire thereafter.
