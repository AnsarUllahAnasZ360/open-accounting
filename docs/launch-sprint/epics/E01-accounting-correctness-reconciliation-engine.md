# E1 — Accounting correctness & reconciliation engine

> Part of the **OpenBooks Launch Sprint**. Master plan: [../README.md](../README.md) · Backlog: [../backlog.md](../backlog.md)

**Goal.** Make Ansar's real double-entry books correct end to end: every confirmed accounting/reconciliation root cause is fixed so reports stop understating, the Stripe clearing/in-transit chain always nets to zero, the balance sheet ties to the real bank (opening balances + one cash source), report totals never silently truncate or double-count, and the owner can see/close/reconcile the gap between "bank says" and "books say".

**Why it matters.** Today the ledger ENGINE is correct but the books are unusable: ~78–80% of real transactions never post (so P&L shows $3,410 of expense against $120k income on Zikra), $458k of phantom "Payouts In-Transit" sits on the balance sheet because the Stripe deposit↔payout match never fires, equity reads $0 because no opening balance is booked, fixture payouts are injected into real books, reports silently drop lines past 5,000, the cash-flow statement and income-by-customer double-count, and the dashboard's cash number (live Plaid balance) contradicts the reports' cash (ledger). Ansar cannot run his two LLCs on books that lie. This epic turns the audited diagnosis into fixes so the numbers become trustworthy enough to file taxes and operate on — the precondition for everything else in the go-live sprint and the public launch.

## Current state

Confirmed against the code: (1) Fixture payouts are injected into REAL Stripe books — the real sync passes includeFixturePayoutFallback:true (convex/stripe.ts:1851) and when /payouts is empty the projection substitutes buildFixtureProjection().payouts (convex/stripe.ts:1824), posting real Dr1160/Cr1150 entries + a fake payout_mismatch inbox card. (2) No opening balance on bank connect — upsertPlaidAccountsForItemCore creates the bankAccount with balanceMinor (convex/plaid.ts:1915-1941) but posts NO journal entry; account 3900 "Opening Balance Equity" exists (convex/ledger.ts:53) but is referenced by no posting code → equity reads $0. (3) Stripe matcher almost never fires on real data — findMatchingStripePayout requires net within 1 minor unit (PAYOUT_MATCH_AMOUNT_TOLERANCE_MINOR=1, stripe.ts:1197), within 5 days (PAYOUT_MATCH_DATE_WINDOW_DAYS=5, stripe.ts:1199), and a "stripe"/"payout" descriptor gate (looksLikeStripePayout, stripe.ts:1208,1251); there is no Inbox "Match deposit to payout" action and no clearing-zeroes invariant, so 1160 balloons (+$458k) and 1150 runs negative. (4) Reports truncate — buildReportPackForEntity loads journalLines/entries with .take(REPORT_LIMIT=5000) on the non-date-ordered by_entity index (reportViews.ts:32,492-501), silently dropping one side of entries on a real book. (5) Cash-flow classifier picks ONE related line to bucket each cash line and sums raw debit-credit (reportViews.ts:621-643), so a transfer or a multi-line split is mis-grouped/double-shown. (6) income-by-customer / expense-by-vendor first sum from journal drill-downs then ADD invoice/bill face value on top (reportViews.ts:676-732), double-counting. (7) No unreviewed-gap signal on reports/dashboard. (8) No reconciliation surface; periodLocks table + ledger.setPeriodLock exist (schema.ts:227, ledger.ts:471) but only a read query (reportViews.ts:956) is wired, no close/reconcile UI. (9) Dashboard cash reads the LIVE Plaid balance (coreViews.ts:180: plaidAccountId ? balanceMinor : ledger) while reports derive cash from the ledger (reportViews.ts:598-611), and coreViews hardcodes a 2025-07…2026-06 months array (coreViews.ts:12-25) whose cashFlowByMonth sums raw transactions (coreViews.ts:201-216). Schema already has optional fxRate + contactId(string) on journalLines (schema.ts:220-221) but postLedgerEntryCore never writes them (ledger.ts:413-422); the ledger is USD-only so `fxRate` is dead and stays unwritten (decided: see decisions.md Q3) — only contactId gets wired (E1-T9).

## Definition of done (epic)

- [ ] On a REAL (isDemo:false) entity, a Stripe sync that returns zero payouts posts ZERO ledger entries and creates ZERO payout_mismatch inbox cards (fixtures only appear on isDemo:true / explicit demo seed); a unit/integration test proves both branches.
- [ ] Connecting a bank with a non-zero starting balance posts exactly one balanced Dr Bank / Cr 3900 (Opening Balance Equity) entry per account; after connect, balance-sheet Equity is non-zero and ledger cash for that account equals the connected statement-start balance; re-running connect does not double-post.
- [ ] A real Stripe payout and its matching bank deposit reconcile on **exact net amount** (the clearing model nets fees out) within a **−2/+5 business-day** window, with a descriptor without 'stripe' still matching (descriptor is a booster, not a gate), OR the owner can pair them with an explicit Inbox 'Match deposit to payout' action; after matching, account 1160 In-Transit nets to ~0 for that payout and 1150 Clearing is never left negative; a per-payout clearing-zeroes invariant blocks any commit that would leave clearing non-zero.
- [ ] reportPack returns correct, non-truncated totals on an entity with >5,000 journal lines: trial balance still balances and no half-posted entry appears (verified by a seeded large-book test); the limits.truncated flag is accurate.
- [ ] Cash Flow statement: a self-transfer (e.g. checking→savings) and a multi-category split each appear once and net correctly; operating/investing/financing classification is driven by the full set of non-cash counter-lines, not a single arbitrary related line.
- [ ] income-by-customer and expense-by-vendor totals equal the ledger income/expense totals for the period (no row exceeds its underlying posted lines); a test with one invoice that is both posted-to-ledger and open proves it is counted exactly once.
- [ ] Reports home and the Dashboard both show a 'N transactions / $X unreviewed and excluded from these figures' signal sourced from the same query, and the number matches the count of needs_review transactions for the active entity/scope.
- [ ] Dashboard cash and Balance-Sheet cash read the SAME source (ledger); the live bank balance is shown as a separate labelled 'bank says X / books say Y — N to review' comparison, not as the primary cash figure.
- [ ] A reconciliation surface lets the owner anchor on a statement ending balance, mark lines cleared, see the running difference, auto-draft an adjusting entry for fees/interest, and refuse to 'complete' until difference = 0; a period-close UI surfaces ledger.setPeriodLock and blocks posting into the closed range.
- [ ] All of typecheck, lint, unit (vitest), and the existing accounting-invariant tests pass; new tests added for fixture-gating, opening balance, payout matching/clearing invariant, report pagination, cash-flow/customer double-count, and unreviewed-gap.

## Tickets (12)

### E1-T1 — Gate Stripe fixture payouts to demo entities only
`size: S` · `risk: med` · `depends on: —`

**Intent.** Stop injecting two synthetic demo payouts (and a fake payout_mismatch card) into REAL Stripe books when the live /payouts list is empty — the confirmed RC4 source of phantom 1160/1150 entries.

**Changes**

- In convex/stripe.ts, thread an `isDemo`/`allowFixtures` flag through fetchStripeProjection (stripe.ts:1828) and projectionFromStripeLists (the includeFixturePayoutFallback consumer at stripe.ts:1824); default it to FALSE for real syncs.
- At the fixture fallback (stripe.ts:1824 `args.includeFixturePayoutFallback ? buildFixtureProjection().payouts : []`), only substitute fixtures when the resolved entity is `isDemo:true` (entity.isDemo exists, schema.ts:72) or an explicit demo/seed code path; otherwise return [] so a zero-payout real sync posts nothing.
- Flip the hardcoded `includeFixturePayoutFallback: true` at the real-sync caller (stripe.ts:1851) to derive from isDemo; keep the demo-seed/connection-check preview paths (stripe.ts:713, getStripeConnectionStatus) using fixtures so the UI preview still demonstrates the shape.
- Audit the other buildFixtureProjection() callers (stripe.ts:2057,2131,2137) and confirm each is a non-posting preview/connection-status path, not a real ledger-posting path; leave those untouched.
- Align with RC4: stop passing `includeFixturePayoutFallback:true` from `fetchStripeProjection` (stripe.ts:1851) and gate the `syncNow` / `seedTestAccount` fixture paths (stripe.ts:2054-2061, 2118-2196) to the **demo workspace only** (`isDemo:true`), so no fixture ever touches a real book.
- Add a guard log/integrationGap note when a real entity has zero payouts so the empty result is explained, not silent.

**Files:** `convex/stripe.ts:1824`, `convex/stripe.ts:1851`, `convex/stripe.ts:1828`, `convex/stripe.ts:1069-1153`, `convex/stripe.ts:348-480 (buildFixtureProjection)`, `convex/schema.ts:72 (entity.isDemo)`

**Definition of done**

- [ ] A unit/integration test runs applyProjectionCore on an isDemo:false entity with a projection whose payouts=[] and asserts payoutsCreated===0, ledgerEntriesPosted unchanged, and no inboxItem of kind 'payout_mismatch' is created.
- [ ] The same test on an isDemo:true entity (or demo path) still yields the 2 fixture payouts, proving the demo experience is unchanged.
- [ ] grep confirms no real-sync code path passes includeFixturePayoutFallback:true unconditionally.

**Deliverables:** Edited convex/stripe.ts (fixture gating); New/updated vitest covering the demo vs real branch; Short note in the ticket PR describing which buildFixtureProjection callers were verified non-posting

**Verify.** pnpm vitest run for the new stripe-fixture-gating test; pnpm -w typecheck; manual grep `grep -n includeFixturePayoutFallback convex/stripe.ts` shows it false/derived for real syncs.

### E1-T2 — Book opening balance (Dr Bank / Cr 3900) on bank connect
`size: M` · `risk: high` · `depends on: —`

**Intent.** Fix RC3: connecting a real bank stores balanceMinor but posts no journal entry, so ledger cash starts at $0 and Equity reads $0. Post a balanced opening entry against the unused 3900 Opening Balance Equity account.

**Changes**

- In convex/plaid.ts upsertPlaidAccountsForItemCore, after a NEW bankAccount + its ledgerAccount are created (plaid.ts:1915-1941), if account.balanceMinor !== 0 post one balanced entry via postLedgerEntryCore: Dr <bank ledgerAccountId> / Cr <3900>, dated the **first day of the month** of the user's chosen history start (or of the connector's earliest available transaction); floor any chosen date to `M-01` (decided: see decisions.md Q2). Opening amounts are **USD integer minor units only** — no per-currency or base-currency conversion (decided: see decisions.md Q20; the GL is USD-only).
- Compute the amount as the Plaid-reported balance, later refined to `current_balance − Σ(imported transactions after the start date)` so the opening entry predates the oldest imported txn (decided: see decisions.md Q2). Auto-mark the opening line cleared.
- Resolve account 3900 with the existing findAccountByNumber helper pattern (stripe.ts:507 / proposals.ts:63); ensure 3900 exists for the entity (it is seeded as isSystem in ledger.ts:53) and create-if-missing for entities seeded before it existed.
- Make it idempotent: tag the entry with source 'plaid'/sourceId like `opening:<plaidAccountId>` and skip if an opening entry for that bank account already exists (re-connect / re-sync must not double-post). Sign the amount correctly for credit accounts (negative starting balance → Dr 3900 / Cr Bank).
- Pass actorUserId (the system sync actor already used by Plaid sync) and an auditAction like 'system.connect.opening_balance.posted'.
- Reconcile/remove the `coreViews` (059a71d) dashboard display override so the dashboard and ledger agree once the real opening entry posts (verification V2) — the dashboard must read the posted opening balance, not a UI-level patch.
- Add an integration test entity with a $X starting balance and assert exactly one opening entry dated `M-01`, Equity = $X on the balance sheet, and re-running connect posts nothing new.

**Files:** `convex/plaid.ts:1874-1945 (upsertPlaidAccountsForItemCore)`, `convex/ledger.ts:53 (3900 seed)`, `convex/ledger.ts:345 (postLedgerEntryCore)`, `convex/stripe.ts:507 (findAccountByNumber pattern)`, `convex/coreViews.ts (059a71d dashboard opening-balance override to reconcile)`

**Definition of done**

- [ ] After connecting a bank with balanceMinor=500000, the entity has exactly one journalEntry sourceId 'opening:<acct>' dated the first of the month with Dr Bank 500000 / Cr 3900 500000; balanceSheet.equityMinor includes it and balanceSheet.balanced stays true.
- [ ] The opening entry is USD-only (no fxRate, no currency conversion) and its line is auto-marked cleared.
- [ ] The dashboard opening-balance display override (059a71d) is reconciled/removed so dashboard cash and the posted ledger opening balance agree.
- [ ] Re-running upsertPlaidAccountsForItemCore for the same account posts no additional opening entry (idempotency test).
- [ ] A negative starting balance posts the reversed direction and still balances; a zero balance posts nothing.

**Deliverables:** Edited convex/plaid.ts; reconciled convex/coreViews.ts override; New vitest opening-balance test; Updated docs note in docs/finishing on the opening-balance behavior

**Verify.** pnpm vitest run opening-balance test; pnpm -w typecheck; manual: connect a Plaid sandbox account locally and confirm a Dr Bank/Cr 3900 entry appears and Equity is non-zero on the Balance Sheet.

### E1-T3 — Calibrate the Stripe payout↔deposit matcher to QBO/clearing tolerances + add an explicit Inbox 'Match deposit to payout' action
`size: M` · `risk: high` · `depends on: —`

**Intent.** Fix RC2 so real bank deposits reconcile against Stripe payouts (descriptor-noisy), and give the owner a manual fallback to pair them — draining the $458k from 1160. NOTE: the Stripe in-transit double-count model is ALREADY built and wired (verification V2); this ticket is **calibration**, not construction. Calibrate to QBO/clearing tolerances, NOT a loose amount fuzz: the in-transit clearing model already nets fees out so the Plaid deposit equals the payout **net exactly** — match on exact net amount, not a fuzzy band (decided: see decisions.md Q1).

**Changes**

- In convex/stripe.ts, do NOT amount-fuzz the Stripe payout match. Keep PAYOUT_MATCH_AMOUNT_TOLERANCE_MINOR (stripe.ts:1197) at **exact net** (clearing nets fees out, so the bank deposit == payout net exactly), and set PAYOUT_MATCH_DATE_WINDOW_DAYS (stripe.ts:1199) to an arrival window of **−2 / +5 business days** (decided: see decisions.md Q1). Apply the general QBO bank-match band (`max($0.50, 1.0%)`, hard ceiling `2% / $2.00`, never auto-post above it) ONLY to non-clearing 1:1 bank↔record matches — not to the payout clearing match.
- Demote the descriptor gate from a HARD GATE to a **scoring booster only**: in findMatchingStripePayout (stripe.ts:1222-1257) and the `looksLikeStripePayout` filter (stripe.ts:1208-1211, 1244-1251), make the `"stripe"/"payout"` descriptor a ranking/confidence signal, not a filter — accept an unambiguous exact-net+date match even when the descriptor doesn't say 'stripe' (decided: see decisions.md Q1), but keep the 'unique unmatched amount' guard so a coincidental ACH isn't silently reclassified (require the candidate be the ONLY pending payout at that exact net within the window, else route to the manual action).
- Align loadMatchingStripePayoutCandidates index bounds (stripe.ts:1259-1274) to the exact-net + −2/+5-business-day window.
- Add a session-bound mutation `matchDepositToPayout(transactionId, payoutId)` that re-checks workspace/entity authz, validates the deposit is an unmatched inflow and the payout is pending/unreconciled, then calls the existing reconcilePayoutWithDeposit (stripe.ts:1285) — reusing the single posting path so it can't double-post.
- Add an internalQuery to list, for a given unmatched inflow, the candidate pending payouts (entity-scoped) so the Inbox can render a Match picker.
- Add unit tests for findMatchingStripePayout covering: noisy descriptor + exact net (match), exact net + arrival inside the −2/+5 business-day window (match), two pending payouts at same net (no auto-match → manual), out-of-window (no match).

**Files:** `convex/stripe.ts:1197-1257 (tolerances + matcher)`, `convex/stripe.ts:1208-1211,1244-1251 (descriptor gate → booster)`, `convex/stripe.ts:1259-1274 (candidate loader)`, `convex/stripe.ts:1285-1412 (reconcile + tryMatch)`, `convex/schema.ts:821-845 (stripePayouts indexes)`

**Definition of done**

- [ ] findMatchingStripePayout unit tests pass for the four cases above; the noisy-descriptor exact-net case now matches where it previously returned null (descriptor is a booster, not a gate).
- [ ] The payout match keys on **exact net amount** within a **−2/+5 business-day** window; no fuzzy amount band is applied to the clearing match (the QBO `max($0.50,1%)` band applies only to non-clearing 1:1 bank↔record matches).
- [ ] matchDepositToPayout posts exactly one Dr Bank / Cr 1160 entry via reconcilePayoutWithDeposit, marks the payout reconciled, marks the transaction match/posted, and is idempotent on re-call.
- [ ] An integration test seeding one pending payout + one bank inflow with a non-'stripe' descriptor reconciles automatically and leaves 1160 nets-to-0 for that payout.
- [ ] Ambiguous (two same-net pending payouts) does NOT auto-match and is left for the manual action.

**Deliverables:** Edited convex/stripe.ts (matcher calibration + descriptor-to-booster + new mutation/query); New vitest for matcher cases + reconcile idempotency; Inbox API surface for the Match picker (query + mutation)

**Verify.** pnpm vitest run stripe matcher tests; pnpm -w typecheck; manual: in the Inbox, an unmatched Stripe deposit shows a 'Match to payout' option and selecting it reconciles (1160 drains).

### E1-T4 — Per-payout clearing-zeroes invariant + drain residual 1160 In-Transit
`size: L` · `risk: high` · `depends on: E1-T3`

**Intent.** Make the Stripe settlement self-checking (RC2 hardening): assert each payout's clearing delta nets to ~0 before commit so 1150 can never run negative, and provide a one-time/ongoing path to drain the existing $458k phantom 1160 balance into real cash once deposits are matched.

**Changes**

- In applyProjectionCore's payout loop (convex/stripe.ts:1069-1153), after posting the Dr1160/Cr1150 drain, compute the running Stripe Clearing (1150) balance for the entity and assert it does not cross negative beyond a documented epsilon; on violation, do NOT silently continue — flag a clearing_drift inbox card and (optionally) skip the drain so a half-posted chain can't accumulate.
- Reuse/extend the existing driftMinor handling (stripe.ts:1082,1125-1135): keep mismatch flagging but add an explicit invariant check `clearingDrainMinor === gross - fees` and that the resulting clearing balance for THIS payout's charges nets to ~0.
- Add an internal admin mutation `drainResidualInTransit(entityId)` that, for payouts already reconciled (bankTxnId set) but whose 1160 wasn't fully drained by legacy direct-to-bank posting, posts the corrective reverse+repost through the single ledger path — never a raw balance edit. For payouts still pending, route them to the Inbox Match action (E1-T3) rather than auto-zeroing. Run this as **both** a one-time drain migration against the real book AND keep `stripeClearingHealth` as a standing tripwire/invariant thereafter (decided: see decisions.md Q4); Ansar's all-epics greenlight authorizes running the drain against his live data.
- Add a health query `stripeClearingHealth(entityId)` returning {clearingBalanceMinor, inTransitBalanceMinor, pendingPayouts, isHealthy} for the tripwire banner.
- Document the invariant and the drain procedure in docs/finishing.

**Files:** `convex/stripe.ts:1069-1153 (payout loop + drift)`, `convex/stripe.ts:1285-1360 (reconcile path)`, `convex/ledger.ts:345 (single posting path for corrections)`, `convex/schema.ts:821-845 (stripePayouts)`

**Definition of done**

- [ ] A unit test feeds a payout where gross-fees != declared amount and asserts a clearing_drift inbox card is created and clearing never commits negative.
- [ ] stripeClearingHealth returns isHealthy:false when 1150 is negative or 1160 > 0 with no pending payouts, and isHealthy:true after E1-T3 matches a clean payout.
- [ ] drainResidualInTransit on a seeded legacy book (1160 inflated, payout reconciled) posts a balanced reverse+repost (immutability honored) that brings 1160 toward 0 and leaves the trial balance balanced.
- [ ] No code path edits a balance directly; every correction goes through postLedgerEntryCore.

**Deliverables:** Edited convex/stripe.ts (invariant + health query + drain mutation); New vitest for the clearing invariant + drain correctness; docs/finishing note on the clearing/in-transit health model

**Verify.** pnpm vitest run stripe clearing tests; pnpm -w typecheck; manual: call stripeClearingHealth on a test entity before/after matching and confirm the health flips.

### E1-T5 — Replace reports .take(5000) with date-ordered, complete loading (no half-posted entries)
`size: M` · `risk: high` · `depends on: —`

**Intent.** Fix RC5: buildReportPackForEntity loads journalLines/entries with .take(REPORT_LIMIT=5000) on the non-date-ordered by_entity index, silently dropping one side of entries on a real >5k-line book, breaking totals and the trial balance.

**Changes**

- In convex/reportViews.ts buildReportPackForEntity (reportViews.ts:484-918), change journalEntries to load via by_entity_and_date (date-ordered) and journalLines to load by entry so that entries and their lines are loaded together — never truncating mid-entry. Prefer loading entries in the report date range (+ a 'before start' pass for opening balances) and then their lines, rather than a flat .take cap.
- Where a hard cap is still needed for safety, cap by ENTRY (load whole entries) and set limits.truncated accurately (reportViews.ts:913-918) based on whether any in-range entry was excluded — not on row count alone.
- Mirror the same fix in coreViews.ts dashboard loads (DASHBOARD_LIMIT, coreViews.ts:100,114-126) so the dashboard cannot drop one side of an entry either.
- Keep reportPackForEntity (internalQuery, reportViews.ts:928) using the same shared loader.
- Add a seeded large-book test (>5,000 lines spanning the range) asserting trial balance balances and balanceSheet.balanced stays true (i.e. no orphaned half-entry).

**Files:** `convex/reportViews.ts:32 (REPORT_LIMIT)`, `convex/reportViews.ts:484-502 (loaders)`, `convex/reportViews.ts:913-918 (truncated flag)`, `convex/coreViews.ts:100,114-126 (dashboard loaders)`

**Definition of done**

- [ ] A test seeding >5,000 journal lines produces a reportPack whose trialBalance.differenceMinor===0 and balanceSheet.balanced===true (previously would drop one side).
- [ ] limits.truncated is true only when an in-range entry was actually excluded, and the report never contains an entry with only one of its lines present.
- [ ] Dashboard totals on the same large book match the report totals for the same period.

**Deliverables:** Edited convex/reportViews.ts and convex/coreViews.ts; New vitest large-book pagination/integrity test; Perf note: query read-bandwidth for the large-book case

**Verify.** pnpm vitest run report large-book test; pnpm -w typecheck; manual: load Reports on the real Zikra entity (≈3k txns) and confirm trial balance balances.

### E1-T6 — Fix cash-flow statement transfer/split double-counting + classification
`size: M` · `risk: med` · `depends on: —`

**Intent.** Fix RC: the cash-flow builder picks ONE arbitrary related counter-line to classify each cash line and sums raw debit-credit (reportViews.ts:621-643), so a self-transfer (checking→savings) and multi-category splits are mis-grouped or double-shown.

**Changes**

- In convex/reportViews.ts cash-flow section (reportViews.ts:613-646), classify each cash line against the FULL set of non-cash counter-lines for its entry (not .find first). Define deterministic precedence: if the counter side includes income/expense → operating; else asset (non-cash) → investing; else liability/equity → financing.
- Handle cash↔cash entries (transfers between two of the entity's own bank/in-transit accounts): net them out of the cash-flow groups entirely (a self-transfer is zero net cash to the business) instead of showing each leg, so the Stripe payout deposit and checking→savings don't inflate operating/financing.
- Ensure a single entry that debits cash and credits multiple categories (a split) contributes exactly the cash movement once, allocated across groups by the counter-line amounts, summing to the cash leg.
- Verify netCashChange still equals closingCash - openingCash (reportViews.ts:644-646) after the change.
- Add tests: a checking→savings transfer (net 0 in cash flow), a 3-way split inflow (allocated once), a payout-deposit transfer (operating/financing not inflated).

**Files:** `convex/reportViews.ts:598-646 (cash accounts + cash-flow groups)`, `convex/reportViews.ts:621-643 (the related-line classifier)`

**Definition of done**

- [ ] A self-transfer between two own cash accounts nets to 0 across operating/investing/financing in the cash-flow statement.
- [ ] A split entry's cash leg is allocated across groups exactly once and the group totals sum to the cash movement.
- [ ] netCashChangeMinor === closingCashMinor - openingCashMinor on every test fixture.
- [ ] No cash line is bucketed using a single arbitrary related line when multiple counter-lines exist.

**Deliverables:** Edited convex/reportViews.ts cash-flow builder; New vitest for transfer/split cash-flow correctness

**Verify.** pnpm vitest run cash-flow test; pnpm -w typecheck; manual: Reports → Cash Flow on a book with a transfer shows it net-zero, not double-listed.

### E1-T7 — Fix income-by-customer / expense-by-vendor double-count
`size: M` · `risk: med` · `depends on: —`

**Intent.** Fix RC: incomeByCustomer/expenseByVendor are first summed from journal drill-downs (reportViews.ts:676-705) and then invoice/bill FACE VALUE is added on top (reportViews.ts:707-732), double-counting any document that is both posted to the ledger and open.

**Changes**

- In convex/reportViews.ts, make the customer/vendor rollup derive from a SINGLE source of truth. Preferred: sum posted income/expense journal lines attributed to a contact (via the transaction.contactId or, once E1-T9 lands, the journal line contactId), and only ADD invoice/bill amounts for documents that have NO posting in the period (i.e. accrual recognition not yet on the ledger) — guarded so the same document is never counted twice.
- Remove the unconditional invoice/bill face-value addition (reportViews.ts:707-732) and replace with a de-dup keyed on the document's entryIds: if any of the document's entryIds already contributed to the rollup, skip the face-value add.
- Ensure the period total of incomeByCustomer equals the P&L income total for the period (and expenseByVendor equals expense total) within the same basis (accrual/cash).
- Add a test: one invoice that is posted-to-ledger AND status 'open' is counted exactly once; income-by-customer total === profitAndLoss.incomeMinor for the period.

**Files:** `convex/reportViews.ts:676-732 (customer/vendor rollups)`, `convex/reportViews.ts:507-522 (unsettled/excluded entry sets)`, `convex/reportViews.ts:535-539 (P&L totals for the equality assert)`

**Definition of done**

- [ ] A test with one invoice both posted and open yields exactly one contribution to income-by-customer (no double count).
- [ ] Sum of incomeByCustomer rows === profitAndLoss.incomeMinor for the period; sum of expenseByVendor rows === profitAndLoss.expenseMinor (same basis).
- [ ] No row's total exceeds the underlying posted/recognized amount for that contact.

**Deliverables:** Edited convex/reportViews.ts; New vitest asserting the no-double-count equality

**Verify.** pnpm vitest run income-by-customer test; pnpm -w typecheck; manual: Reports → Income by Customer total matches P&L income.

### E1-T8 — '$X / N transactions unreviewed & excluded' signal on Reports + Dashboard
`size: M` · `risk: low` · `depends on: —`

**Intent.** Fix RC1's silence: reports only show posted lines, so the ~78% unposted backlog makes totals understate with no on-screen explanation. Surface the gap everywhere a total is shown.

**Changes**

- Add a shared internalQuery/helper (in coreViews.ts or reportViews.ts) computing, for the active entity/scope: count and absolute $ sum of transactions with review==='needs_review' (and/or status not posted) — entity-scoped, server-clock dated.
- Include this in the reportPack payload (reportViews.ts return, ~reportViews.ts:890-918 limits block) and in the dashboard payload (coreViews.ts) so both read the SAME computation.
- In apps/web ReportsScreen.tsx and the dashboard (CoreScreens.tsx), render a single quiet banner: 'N transactions ($X) are unreviewed and excluded from these figures' linking to the Inbox; match the design rules (neutral, no alarm-red, tabular figures).
- Make the shared helper accept an **entity list / `scope = "all" | entityId`** so the portfolio epic (E5) can pass multiple entities without a rewrite (decided: see decisions.md Q5); wire the active entity now, but the signature must already take a scope.
- Add a test asserting the count equals the number of needs_review transactions for the entity.

**Files:** `convex/reportViews.ts:890-918 (limits block in reportPack)`, `convex/coreViews.ts:192-200 (inbox/reviewed counts already computed)`, `apps/web/src/components/openbooks/ReportsScreen.tsx`, `apps/web/src/components/openbooks/CoreScreens.tsx (dashboard)`

**Definition of done**

- [ ] reportPack and dashboard both return {unreviewedCount, unreviewedAbsMinor} from the same helper and the numbers are identical for the same entity.
- [ ] Reports home and Dashboard each render the unreviewed banner with the correct count + $ amount and a link to the Inbox.
- [ ] A test asserts unreviewedCount === number of needs_review transactions for the seeded entity.

**Deliverables:** Edited convex/reportViews.ts + convex/coreViews.ts (shared helper); Edited ReportsScreen.tsx + CoreScreens.tsx (banner); New vitest for the count; Screenshot of the banner on Reports + Dashboard

**Verify.** pnpm vitest run unreviewed-gap test; pnpm -w typecheck && pnpm -w lint; manual via agent-browser: open Reports and Dashboard and confirm the banner shows the real count.

### E1-T9 — Write contactId on journal lines so customer/vendor reports light up
`size: M` · `risk: high` · `depends on: —`

**Intent.** Fix RC10 sub-cause: contactId is never written on journal lines (ledger.ts:413-422) even though schema.ts:221 has the optional field, so spend-by-vendor / revenue-by-customer off the ledger are blank and force the fragile invoice/bill add-on that double-counts (E1-T7). The companion `journalLines.fxRate` field is dead (USD-only ledger, decided: see decisions.md Q3) — do NOT write or thread it; this ticket carries ONLY contactId.

**Changes**

- Extend LedgerLineInput (ledger.ts:322-327) and postLedgerEntryCore's line insert (ledger.ts:413-422) to accept and persist optional contactId (string, matching schema.ts:221). Do NOT add an fxRate write-hook — the GL is USD-only and `journalLines.fxRate` is dead/never-read (decided: see decisions.md Q3); leave the field unused (or drop it) but never populate it here.
- Thread contactId from the posting callers that know it: invoice posting, bill posting, Stripe charge/invoice posting (stripe.ts:1022-1046), payroll, and the pipeline rule/match/add paths where a contact is resolved. Do NOT invent contacts here — only pass an id already resolved by the caller.
- Keep it strictly additive and optional so every existing caller still compiles and every existing test still passes; no change to balancing/validation logic.
- Once written, prefer line.contactId over transaction.contactId in the reportViews customer/vendor rollup (coordinate with E1-T7).
- Add a test: a posted invoice entry carries contactId on its AR/income lines and income-by-customer reads it from the ledger.

**Files:** `convex/ledger.ts:322-327 (LedgerLineInput)`, `convex/ledger.ts:413-422 (line insert)`, `convex/schema.ts:220-221 (fxRate dead/unused, contactId field)`, `convex/stripe.ts:1022-1046 (invoice posting)`, `convex/reportViews.ts:676-705 (consumer)`

**Definition of done**

- [ ] postLedgerEntryCore persists line.contactId when provided; omitting it keeps current behavior (all existing tests green).
- [ ] No fxRate write-hook is added; `journalLines.fxRate` remains unwritten (USD-only — decided: see decisions.md Q3).
- [ ] A posted invoice/charge entry has contactId set on the relevant lines; income-by-customer derives a non-empty rollup from the ledger alone (no invoice face-value add-on needed for posted docs).
- [ ] No change to debits=credits validation or period-lock behavior; high-risk ledger path covered by the existing invariant tests still passing.

**Deliverables:** Edited convex/ledger.ts (LedgerLineInput + insert, contactId only); Edited posting callers to thread contactId; New vitest asserting contactId is persisted and read by reports

**Verify.** pnpm vitest run (full accounting-invariant suite must stay green); pnpm -w typecheck; manual: Income by Customer shows names from posted Stripe charges without invoices.

### E1-T10 — Unify dashboard cash with report cash (one source) + bank-vs-books comparison
`size: M` · `risk: med` · `depends on: E1-T8`

**Intent.** Fix RC7: dashboard cash shows the live Plaid balance (coreViews.ts:180) while reports derive cash from the ledger (reportViews.ts:598-611), so the two contradict each other on real data.

**Changes**

- In convex/coreViews.ts bankBalances (coreViews.ts:175-190), make the PRIMARY cash figure the ledger balance (normalBalance over journal lines) for every account — the same computation reportViews uses — instead of `plaidAccountId ? balanceMinor : ledger`.
- Return the live Plaid balanceMinor as a SEPARATE field per account (e.g. bankSaysMinor) plus a workspace/entity-level {ledgerCashMinor, bankCashMinor, differenceMinor, unreviewedCount} comparison, reusing E1-T8's unreviewed count to explain the delta.
- In the dashboard UI (CoreScreens.tsx), show ledger cash as the headline 'cash' and a quiet 'Bank says X · Books say Y · N to review' comparison line — not two competing primary numbers; honor design rules (neutral, tabular).
- Ensure the dashboard's reported cash now equals the Balance Sheet cash for the same entity/date.
- Add a test asserting dashboard ledger cash === reportPack balanceSheet cash for the same seeded entity.

**Files:** `convex/coreViews.ts:175-190 (bankBalances)`, `convex/reportViews.ts:598-611 (report cash)`, `apps/web/src/components/openbooks/CoreScreens.tsx (dashboard cash tile)`

**Definition of done**

- [ ] Dashboard headline cash === Balance-Sheet cash for the same entity/date in a seeded test.
- [ ] Live bank balance is still visible but clearly labelled as 'bank says', distinct from the ledger cash; the difference + unreviewed count are shown together.
- [ ] No screen presents the live Plaid balance as the primary 'cash' figure.

**Deliverables:** Edited convex/coreViews.ts (ledger-primary cash + comparison); Edited CoreScreens.tsx dashboard cash tile; New vitest asserting dashboard cash === report cash; Screenshot of the new cash tile

**Verify.** pnpm vitest run cash-source test; pnpm -w typecheck && pnpm -w lint; manual via agent-browser: Dashboard cash equals Reports → Balance Sheet cash.

### E1-T11 — Replace coreViews hardcoded 12-month window + raw-transaction cash flow with server-clock, ledger-derived series
`size: M` · `risk: med` · `depends on: E1-T6`

**Intent.** Fix RC6/RC: coreViews hardcodes a 2025-07…2026-06 months array (coreViews.ts:12-25) and computes cashFlowByMonth by summing RAW transactions (coreViews.ts:201-216), so the dashboard reads stale/empty on the real current date and the cash-flow trend double-counts transfers and ignores unposted items consistently with the ledger.

**Changes**

- Remove the hardcoded `months` array (coreViews.ts:12-25); derive the trailing-N-month window from a server-clock 'today' passed in (or computed deterministically at the action boundary), matching how reportViews handles dates.
- Replace cashFlowByMonth's raw-transaction summation (coreViews.ts:201-216) with a ledger-derived monthly cash series (movement on cash accounts per month, consistent with the corrected cash-flow logic from E1-T6) so the dashboard trend agrees with the Cash Flow report.
- Default the period selector (coreViews.ts:133-137) to the latest month WITH ledger activity using the same server-clock-derived window, never a frozen literal.
- Audit other hardcoded-date literals reachable from the dashboard payload and route them through the same 'today' source.
- Add a test asserting the month window ends at the server 'today' month and the cash-flow series equals the report's cash movement for those months.

**Files:** `convex/coreViews.ts:12-25 (months array)`, `convex/coreViews.ts:133-137 (latestMonth/selectedMonth)`, `convex/coreViews.ts:201-216 (cashFlowByMonth)`

**Definition of done**

- [ ] No hardcoded year/month literals remain in coreViews.ts for windowing; the trailing window ends at the current server month.
- [ ] Dashboard cash-flow-by-month equals the Cash Flow report's monthly cash movement for the same months (ledger-derived, transfers netted).
- [ ] On a book dated to the real current date, the dashboard trend and KPIs render real data, not blank.

**Deliverables:** Edited convex/coreViews.ts; New vitest for server-clock windowing + cash-flow parity with reports

**Verify.** pnpm vitest run dashboard-window test; pnpm -w typecheck; manual: Dashboard shows current-month data and its cash-flow trend matches Reports → Cash Flow.

### E1-T12 — Bank reconciliation surface (mark cleared / adjust to bank / complete at diff=0) + period-close UI
`size: L` · `risk: high` · `depends on: E1-T2`

**Intent.** Deliver the missing reconciliation + close workflow so 'reconciled books' becomes real: anchor on a statement ending balance, mark lines cleared, auto-draft adjusting entries for fees/interest, complete only at difference 0, then close the period (periodLocks + ledger.setPeriodLock already exist but only a read is wired).

**Changes**

- Add a `bankReconciliations` table (entityId, bankAccountId, statementEndDate, statementEndBalanceMinor, status: open|completed, completedAt) anchored on the **statement ending balance + ending date**, and a per-transaction `reconciliationId` + `clearedAt` marker on transactions — NOT a `clearedTransactionIds[]` array on the reconciliation (decided: see decisions.md Q6; the per-txn marker scales for queries). Additive schema; follow migration-helper widen pattern.
- Add Convex mutations (workspace/entity-authorized): startReconciliation, toggleTransactionCleared (sets/clears the per-txn `reconciliationId`+`clearedAt`), addAdjustingEntry (posts a balanced fee/interest entry via postLedgerEntryCore — never a raw edit; discrepancies post an explicit, **reversible** adjusting entry), and completeReconciliation which REFUSES unless (book cleared balance == statementEndBalance) i.e. **differenceMinor===0** ($0.00 — QBO's non-negotiable gate, decided: see decisions.md Q6).
- Add a query returning the reconciliation worksheet: statement balance, cleared book balance, running difference, list of uncleared lines.
- Build the apps/web reconciliation UI (a new section/sheet) honoring design rules; and a period-close UI that surfaces ledger.setPeriodLock (ledger.ts:471) + reportPeriodLock (reportViews.ts:956) so the owner can lock a month and see it's locked; posting into a locked range is already blocked by postLedgerEntryCore (ledger.ts:364-370).
- Add tests: completeReconciliation throws when difference != 0 and succeeds at 0; an adjusting entry posts through the single path and balances; closing a period then attempting to post into it throws.

**Files:** `convex/schema.ts:227-247 (periodLocks + bankAccounts; add bankReconciliations)`, `convex/ledger.ts:345 (postLedgerEntryCore for adjusting entries)`, `convex/ledger.ts:471 (setPeriodLock)`, `convex/reportViews.ts:956 (reportPeriodLock read)`, `apps/web/src/components/openbooks/ReportsScreen.tsx (close-the-books banner host)`

**Definition of done**

- [ ] A reconciliation can be started against a statement end balance, transactions toggled cleared, and completeReconciliation succeeds only when the cleared book balance equals the statement balance (test proves the throw at diff!=0).
- [ ] An adjusting entry for a bank fee posts a balanced Dr Fee/Cr Bank entry through postLedgerEntryCore and is reflected in the cleared balance.
- [ ] The period-close UI calls setPeriodLock; after locking through a date, postLedgerEntryCore rejects an entry dated on/before it (existing guard) and the UI shows the lock state.
- [ ] Reconciliation + lock data is entity-scoped and authz re-checked on every mutation.

**Deliverables:** Schema migration (bankReconciliations anchored on ending balance/date + per-transaction `reconciliationId`/`clearedAt` markers); New convex reconciliation mutations + worksheet query; apps/web reconciliation + period-close UI; Vitest for diff=$0.00 gate, reversible adjusting-entry balance, and locked-period rejection; Screenshots of the reconciliation worksheet + close-the-books banner

**Verify.** pnpm vitest run reconciliation tests; pnpm -w typecheck && pnpm -w lint; manual via agent-browser: reconcile a bank account to a statement balance and confirm 'Complete' is disabled until difference is 0, then close the month.

## Decisions applied

All prior open questions for this epic are resolved in `../decisions.md` (governing contract: `../rebuild/ANSAR-DECISIONS.md`). Applied here:

- **Q1 — payout-matcher tolerance (E1-T3):** match on **exact net** within **−2/+5 business days**; descriptor demoted from hard gate to scoring booster; QBO band (`max($0.50,1%)`, ceiling `2%/$2`) applies only to non-clearing 1:1 matches.
- **Q2 — opening-balance date (E1-T2):** **first day of the month** of the chosen/earliest start (floor to `M-01`); amount = Plaid balance refined to `current_balance − Σ(imported)`; line auto-cleared.
- **Q3 — fxRate hook (E1-T9):** **CUT** — USD-only ledger; `journalLines.fxRate` is dead/never-written; E1-T9 carries only contactId.
- **Q4 — drainResidualInTransit (E1-T4):** **both** a one-time drain against the live book + a standing `stripeClearingHealth` tripwire; greenlit against live data.
- **Q5 — entity-scoped helpers (E1-T8/E1-T10):** shared helpers take an **entity list / `scope = "all" | entityId`** so E5 portfolio passes multiple entities without a rewrite.
- **Q6 — reconciliation schema (E1-T12):** per-transaction **`reconciliationId` + `clearedAt`** (not an array); anchor on statement ending balance + date; block Finish until **difference = $0.00**; discrepancies post a reversible adjusting entry.
- **Q34 — `.take(5000)` (E1-T5):** **E1 owns the real fix** (date-ordered complete loading); E6 only surfaces the banner.
- **USD-only ledger** is enforced throughout (E1-T2 opening balance, E1-T9 no fxRate). **No GL FX engine** — multi-currency exists only in payroll (E10).

Nothing in this epic still requires Ansar input.

## Research notes

- QuickBooks/Stripe-sync tools (A2X, Synder, Acodei) treat the clearing account as the error detector: one payout = one deposit = one journal entry, and the clearing account must net to ~0 per batch — which is exactly the per-payout clearing-zeroes invariant E1-T4 enforces. Source: blueprint Part 1 'The Stripe puzzle' citing docs.stripe.com/reports/payout-reconciliation. ([source](docs/finishing/accounting-engine-blueprint.md))
- QuickBooks' 'For Review' Add/Match/Transfer model and its visible 'N for review' count are the established pattern for surfacing un-posted money — the basis for E1-T3's explicit Match action and E1-T8's unreviewed-gap banner. A balanced trial balance is necessary but not sufficient: it cannot catch a transaction that was never recorded. ([source](docs/finishing/accounting-engine-blueprint.md))
- On bank connect QuickBooks books Dr Bank / Cr Opening Balance Equity at the statement-start balance — the exact pattern E1-T2 implements against the already-seeded account 3900. ([source](docs/finishing/accounting-engine-blueprint.md))
