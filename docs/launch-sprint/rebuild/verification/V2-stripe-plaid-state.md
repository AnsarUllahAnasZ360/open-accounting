# V2 — Stripe/Plaid current state (codex/real-world-testing)

Scope: confirm the CURRENT truth of RC2 (Stripe matcher tolerance + descriptor
gate), RC4 (fixture fallback on real entities), RC3 (opening balance on bank
connect), and whether the recent commits (c23dc4c, 8f31b92, 059a71d, 9697355,
9b5154d) changed any of it. Read-only.

Files: `convex/stripe.ts` (2314 lines), `convex/plaid.ts` (2159 lines).
HEAD: `9b5154d`. Branch: `codex/real-world-testing`.

---

## Current truth (file:line evidence)

### RC1 / E7 double-count — ACTUALLY CLOSED (in-transit model is live)

The structural double-count fix from c23dc4c is real and present.

- `convex/stripe.ts:1096-1123` — at payout CREATION, `applyProjectionCore` only
  drains Stripe Clearing into Payouts-In-Transit (Dr 1160 / Cr 1150). It does
  **not** debit the bank. Comment at 1084-1089 states the bank debit happens
  once, later, on the matched Plaid deposit.
- `convex/stripe.ts:1285-1360` `reconcilePayoutWithDeposit` — posts the single
  bank debit (Dr Bank / Cr 1160) exactly once when the deposit matches; patches
  the Plaid txn to `decidedBy:"match"`, `categoryAccountId: undefined`, so it is
  never income. Idempotency guard at 1296-1300 (already-reconciled / bankTxnId).
- `convex/plaid.ts:787-815` — the matcher (`matchPlaidInflowToPayout` ->
  `tryMatchDepositToPayout`) runs INSIDE the live Plaid sync loop BEFORE the
  income pipeline, and `continue`s on a match. So the matcher is wired into the
  real sync path, not just seed.

Conclusion: the matcher is wired and the in-transit posting model is in place.
The remaining RC2/RC3/RC4 problems are about *quality* of that matcher and the
*fixtures/opening-balance* gaps, not about the wiring being absent.

### RC2 — Stripe matcher is STILL 1-cent tolerance + descriptor-gated (OPEN)

- `convex/stripe.ts:1197` — `const PAYOUT_MATCH_AMOUNT_TOLERANCE_MINOR = 1;`
  (last touched by c23dc4c; unchanged by the four later commits).
- `convex/stripe.ts:1198-1199` — date window `PAYOUT_MATCH_DATE_WINDOW_DAYS = 5`.
- `convex/stripe.ts:1208-1211` — `looksLikeStripePayout` matches only if the
  descriptor lowercases to contain `"stripe"` or `"payout"`.
- `convex/stripe.ts:1235-1251` `findMatchingStripePayout` — filters on:
  pending + unmatched, currency equal, `|payout - inflow| <= 1` minor unit,
  date within 5 days, AND a final filter `descriptorMatches || amountMinor ===
  inflow.amountMinor`. i.e. if the descriptor does NOT say stripe/payout, only an
  EXACT-cent amount match survives; the 1-cent slack is descriptor-gated.
- `convex/stripe.ts:1264-1273` `loadMatchingStripePayoutCandidates` —
  index lookup also clamps to `amount ± 1` minor unit and `.take(20)`.

Real-world consequence: Stripe payouts in production frequently do NOT carry the
literal word "stripe"/"payout" in the bank descriptor (banks shorten/relabel),
and the net deposit can differ from the declared payout amount by more than 1
cent (instant-payout fees, cross-month fee debits, FX rounding). With a 1-cent
tolerance + descriptor gate, real payouts will routinely fail to match -> the
Plaid deposit falls through to the income pipeline and gets booked as Sales a
SECOND time. This is the latent double-count the in-transit model was supposed
to prevent; the matcher is too strict to actually fire on live data.

ANSAR-DECISIONS #1 says use standard QuickBooks-style tolerances. QBO matches on
amount + date window with a band (not 1 cent) and does not hard-require a Stripe
descriptor. So RC2 is genuinely open: loosen tolerance to a real band and stop
hard-gating on the descriptor (or use descriptor only as a tiebreaker/booster).

### RC4 — Fixture payout fallback is STILL injected on the REAL Stripe path (OPEN)

- `convex/stripe.ts:1824` — `projectionFromStripeLists` returns
  `payouts: payouts.length > 0 ? payouts : args.includeFixturePayoutFallback ?
  buildFixtureProjection().payouts : []`.
- `convex/stripe.ts:1844-1852` `fetchStripeProjection` (the function that calls
  the **real** Stripe REST API via `stripeListAll`) passes
  `includeFixturePayoutFallback: true` **hardcoded**.
- Effect: when a real (test- or live-mode) Stripe account returns ZERO payouts,
  the projection is back-filled with the two synthetic fixture payouts
  (`po_fixture_reconciled_001`, `po_fixture_mismatch_001`,
  `convex/stripe.ts:461-481`). These are then persisted into `stripePayouts` and
  posted to the ledger by `applyProjectionCore` (the in-transit Cr 1150 / Dr 1160
  entry at 1096-1123) on a REAL entity. One fixture is deliberately a mismatch
  (driftMinor -1500) and raises a `payout_mismatch` inbox item (1125-1134).
- Additional fixture surfaces on real entities:
  - `convex/stripe.ts:2054-2061` `syncNow` falls back to
    `buildFixtureProjection()` whenever no resolved credential exists AND
    `STRIPE_SECRET_KEY` is not "safe to call" — and applies it to the named
    `entityId`, tagging mode "fixture" but still writing rows.
  - `convex/stripe.ts:2118-2196` `seedTestAccount` writes fixture customers /
    income / invoices to a real entity when the key is missing.

So RC4 stands: a real entity with a working Stripe connection but no payouts yet
gets phantom fixture payouts injected and posted to its books. The fix is to make
`includeFixturePayoutFallback` false on any non-fixture (real/live) projection,
and confine fixtures to the demo/seed workspace only.

Blame: `convex/stripe.ts:1824` last touched by `19876431` (2026-06-12), i.e.
BEFORE c23dc4c. None of the four "real data" commits removed the fallback.

### RC3 — NO opening balance booked on bank connect (OPEN; only display patched)

- `convex/plaid.ts:1874-1944` `upsertPlaidAccountsForItemCore` — on connect it
  creates the `ledgerAccounts` row (1915-1926) and `bankAccounts` row
  (1927-1939) and stores `balanceMinor: account.balanceMinor` (1933) on the bank
  account record. It posts **no** journal entry. There is no Opening Balance
  Equity account, no `postLedgerEntryCore` call here.
- The ONLY `postLedgerEntryCore` in `convex/plaid.ts` is at line 694, inside
  `reverseRemovedPlaidTransaction` (reversing a Plaid-removed txn) — not an
  opening balance. `grep "Opening|3000|3900|equity"` over plaid.ts = no hits.
- Net effect: the ledger's bank account starts at $0 and only accrues the deltas
  from synced transactions. The true opening cash (and the offsetting equity) is
  never posted, so the balance sheet does not balance and reports under-state cash
  by the pre-connect balance. Matches the diagnosis (equity $0, cash wrong).
- 059a71d PARTIALLY masks this at the DISPLAY layer only:
  `convex/coreViews.ts` dashboard now shows
  `amountMinor = bankAccount.plaidAccountId ? bankAccount.balanceMinor :
  ledgerBalanceMinor` — i.e. for Plaid-connected accounts the dashboard card
  shows the Plaid-reported balance instead of the ledger balance. This makes the
  dashboard *look* correct while the underlying ledger / Reports (which query
  journal lines, per the North Star) remain wrong. It can also hide the eventual
  opening-balance fix or disagree with it. So RC3 is open, and there's now a
  display/ledger divergence to reconcile when the real fix lands.

### Other confirmed items

- 25-item categorize cap STILL present: `convex/plaid.ts:1301` —
  `limit: Math.min(25, summary.needsReviewCount)` (blame `7abb9565`, pre-dates
  these commits). Only 25 needs_review items get AI-categorized per sync; the
  remainder stay uncategorized in the Inbox. Not re-queued in a loop here.
- Pending handling: `convex/plaid.ts:725-741, 779-785` builds
  `pendingCandidates` and `findPendingCarryover` excludes the prior pending row
  when the posted version arrives (carries category forward). This part looks
  sound.
- Live-connector guards exist: Stripe live sync blocked unless
  `OPENBOOKS_REAL_TEST_LIVE_CONNECTORS=1` (`convex/stripe.ts:2042-2044`).

---

## What's already done vs still open

DONE (do NOT re-prescribe):
- E7 in-transit posting model: payout creation drains clearing -> in-transit
  only; bank debit posts once on matched deposit. (stripe.ts:1084-1123,
  1285-1360)
- Matcher is WIRED into the live Plaid sync before the income pipeline.
  (plaid.ts:787-815)
- Reconcile path is idempotent (bankTxnId + already-reconciled guards).
- Encrypted Plaid/Stripe credential storage + live restricted-key sync path
  exist (8f31b92), with a live-mode env gate.
- Pending->posted carryover for Plaid transactions works.

STILL OPEN:
- RC2: matcher tolerance is 1 cent and descriptor-gated (stripe.ts:1197,
  1208-1211, 1244-1251) -> real payouts won't match -> double-count returns.
- RC4: fixture payout fallback hardcoded ON in the real-API path
  (stripe.ts:1824 + 1851); also `syncNow`/`seedTestAccount` fixture fallbacks on
  named real entities (2054-2061, 2118-2196) -> phantom payouts/income on real
  books.
- RC3: no opening-balance journal entry on bank connect (plaid.ts:1874-1944);
  only a dashboard-display override exists (coreViews 059a71d), which masks but
  does not fix and now diverges from the ledger.
- 25-item AI categorize cap per sync (plaid.ts:1301) — large histories leave a
  long uncategorized Inbox tail.

---

## Implications for the plan

1. RC2 — reframe as "calibrate the matcher to real-world/QBO tolerances," not
   "build the matcher." Widen `PAYOUT_MATCH_AMOUNT_TOLERANCE_MINOR` to a real
   band and demote the descriptor from a hard gate to a scoring signal. Keep the
   date window. Without this, the already-built in-transit model silently fails
   on live data and the double-count returns.

2. RC4 — single concrete change: stop passing
   `includeFixturePayoutFallback: true` from `fetchStripeProjection`
   (stripe.ts:1851), and gate `syncNow`/`seedTestAccount` fixture fallbacks so
   they only ever target the demo workspace. Plan should say "remove fixture
   injection on real entities," not "add a Stripe matcher."

3. RC3 — still a real build: post one opening-balance entry on connect
   (Dr Bank / Cr Opening Balance Equity) using the Plaid-reported balance, dated
   the first day of the month per ANSAR-DECISIONS #2. AND reconcile/remove the
   059a71d dashboard override (coreViews) so dashboard and ledger agree once the
   real opening balance posts — otherwise the card will double-count or diverge.

4. The 25-cap is a separate, smaller backlog item (queue/loop the remaining
   needs_review items, or raise the cap) — independent of RC2/RC3/RC4.

5. None of the four recent "real data" commits (8f31b92, 059a71d, 9697355,
   9b5154d) touched the RC2 tolerance, the RC4 fixture fallback, or added an RC3
   opening-balance posting. They added credential storage, live-key sync wiring,
   Plaid production payload normalization, connection UX, and the dashboard
   balance display override. So the RC2/RC3/RC4 line items in the plan are NOT
   already-done.
