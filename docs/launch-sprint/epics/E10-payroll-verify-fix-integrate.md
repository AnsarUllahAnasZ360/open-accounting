# E10 — Payroll — verify, fix & integrate

> Part of the **OpenBooks Launch Sprint**. Master plan: [../README.md](../README.md) · Backlog: [../backlog.md](../backlog.md)

**Goal.** Make payroll a trustworthy, end-to-end-verified module on Ansar's real multi-currency books: prove the draft→approve→pay→statement lifecycle posts correctly through the single ledger path; fix the date-blind/token-narrow bank matcher that both leaves real salary debits uncategorized AND double-counts cash out; make USD/PKR/INR FX correct at approval and at settlement; surface payroll as the largest expense line in Expenses and in Reports; add owner-controlled pay schedules with safe auto-draft; ship per-currency statements; and give the Payroll page one honest insight banner (monthly run-rate, headcount cost, FX exposure).

**Why it matters.** Payroll is usually the single biggest cash outflow for a services business, and Ansar isn't even sure it works. If salary debits land uncategorized while payroll also credits the bank, the books double-count cash out and understate the largest expense — exactly the kind of error that makes an owner distrust the whole product. Getting payroll provably correct across his three currencies (USD/PKR/INR), integrated into Expenses/Reports, and self-explaining (run-rate, headcount cost) turns payroll from a question mark into a reason to run the business on OpenBooks.

## Current state

The lifecycle exists and the ledger core is correct. `convex/payroll.ts` drafts via `draftRunForEntity:265` (one run/period, materializes a `payrollRunLines` row per active employee, no posting), approves via `approveRun:428` (ONE balanced entry: debit Payroll Expense 5000 / credit Payroll Payable 2200 in base currency through `postLedgerEntryCore`), and settles via `settleLine:521` / `markLinePaid:597` / `markRunPaid:643` (debit payable / credit bank, plus an FX gain/loss line to 4200/6999). Pure math lives in `convex/payrollMath.ts` (integer minor units; fxRateMicros = local-per-base micro-units; `baseEquivalentMinor:37`). Schema tables are solid: `employees`, `paySchedules`, `payrollRuns`, `payrollRunLines` (schema.ts:620-707). Auto-draft cron is wired (`crons.ts:15` → `autoDraftScheduledRuns:810`) and is a verified NO-OP without an enabled schedule. Tests exist (`convex/payroll.test.ts`: approve balanced, markRunPaid TB=0, period-lock, double-approve, auto-draft safety) and one e2e (`tests/e2e/reports-payroll.spec.ts:87` D4 opens a run). CONFIRMED DEFECTS: (1) `findMatchingBankTxn` (payroll.ts:501-519) is date-blind (ignores postingDate), token-narrow (`/payroll|gusto|wise/i` only — a Wise/ACH debit not saying those words is missed), amount-loose (no exact-minor-unit + uniqueness guard), currency-blind, and is only called from `markRunPaid` (line 664) — NOT from `markLinePaid` — so the per-line UI path never consumes the bank txn → the salary debit stays uncategorized in the Inbox while payroll also credits the bank = RC10 double-count of cash out. (2) Settlement FX (`settleLine:538-540`) computes `settlementBaseMinor` from `line.fxRateMicros`, but that rate is never updated at pay time, so the FX gain/loss path is effectively dead on real data and there is no place to enter the day's rate when paying. (3) Hardcoded dates freeze payroll views: `moduleViews.ts:7 today="2026-06-11"`, `ModuleScreens.tsx:1221 PAYROLL_CURRENT_PERIOD="2026-06"`, `:1268 "2026-06-13"`. (4) No payroll insight banner — `AiInsightBadge` is used on other screens but the Payroll body (ModuleScreens.tsx:1377-1423) has none and no run-rate/headcount-cost/FX metric is computed. (5) Expenses doesn't surface payroll as the biggest expense: `expensesViews.ts:260` explicitly notes payroll accruals show fewer vendor lines; Reports' Payroll Summary exists (`reportViews.ts:734-771`) but is siloed from the Expenses lens. (6) The default-entity statement fallback hardcodes slug "acme-studio-llc" (`payroll.ts:701`).

## Definition of done (epic)

- [ ] A green unit + e2e suite proves the full draft→approve→pay→statement lifecycle for a multi-currency roster (USD base + PKR + INR employees) with trial balance = 0 (debits=credits) at every step and the Payroll Payable account fully cleared after pay; evidence screenshots committed under docs/finishing/evidence/.
- [ ] When a payroll run is settled and a real bank salary debit exists, the matcher links it (exact base-minor amount, unique among unmatched, within a bounded date window of the posting date), marks that transaction consumed/categorized to payable, and there is exactly ONE cash-out effect in the ledger (no double-count). A test asserts that a matched run does not leave the salary debit in needs_review AND total cash-out across ledger == the bank debit amount.
- [ ] The matcher is invoked from BOTH markLinePaid and markRunPaid; a regression test covers the per-line path consuming the bank txn.
- [ ] USD/PKR/INR FX is correct: approval accrues at the line fxRate; settlement accepts the day's rate and books the difference to FX gain (4200) / loss (6999) so the payable clears exactly; a unit test with a PKR line whose pay-day rate differs from accrual asserts a non-zero, correctly-signed FX line and a balanced entry.
- [ ] Payroll expense (account 5000) appears as a first-class, typically-largest expense line in the Expenses module and reconciles to the Reports Payroll Summary base total for the same period (a test asserts the two figures match).
- [ ] Owner can set a pay schedule (cadence + enabled) in the UI; auto-draft creates the period's draft run (never posts) and remains a NO-OP for entities without an enabled schedule; per-currency statements render and export CSV per currency.
- [ ] The Payroll page shows exactly one insight banner with run-rate (monthly base-currency payroll cost), headcount, and FX-exposure note, derived from ledger/run data with NO hardcoded dates.
- [ ] No hardcoded calendar dates remain in payroll read/UI paths (moduleViews payroll section, ModuleScreens PayrollScreen): current period and ranges derive from a single now/clock source.
- [ ] Ledger posting still flows exclusively through postLedgerEntryCore; npm run typecheck, lint, unit (vitest), and the payroll e2e all pass.

## Tickets (7)

### E10-T1 — End-to-end verify the payroll lifecycle on a multi-currency roster (tests + screenshots)
`size: M` · `risk: low` · `depends on: —`

**Intent.** Establish a trustworthy baseline: prove draft→approve→pay→statement works and stays balanced for USD+PKR+INR before changing behavior, so every later fix has a regression net.

**Changes**

- In convex/payroll.test.ts, add a setupPayrollMultiCurrency helper mirroring setupPayroll:15 but inserting three active employees (USD, PKR, INR) plus the 4200 Other Income and 6999 Other Expense accounts so settlement FX lines can post.
- Add a lifecycle test: startRun → assert runDetail materialized lines + currencyTotals show three currencies and a base total; approveRun → assert ONE entry, debit 5000 == credit 2200 == run baseTotal; markRunPaid → assert run.status==='paid', every line.paid, and trialBalance debit===credit (extend trialBalance:102 helper).
- Add an assertion that after pay the Payroll Payable (2200) net balance is 0 (sum of debits-credits on that account across all entries).
- Add a test that runDetail.statementGroups groups by country·currency and that per-currency local + base totals reconcile to currencyTotals.
- Extend tests/e2e/reports-payroll.spec.ts (the D4 test at :87) with a non-mutating assertion that the run detail shows per-currency footer totals and the base total testid, and capture a fresh screenshot to docs/finishing/evidence/.

**Files:** `convex/payroll.test.ts`, `convex/payroll.ts (runDetail:129, approveRun:428, markRunPaid:643)`, `convex/payrollMath.ts (currencyTotals:82, runBaseTotalMinor:77)`, `tests/e2e/reports-payroll.spec.ts:87`

**Definition of done**

- [ ] A multi-currency (USD/PKR/INR) lifecycle test passes: approve posts one balanced entry, markRunPaid leaves trial balance debit===credit and Payroll Payable net 0, run flips to paid.
- [ ] statementGroups per-currency totals reconcile to currencyTotals in an assertion.
- [ ] npx vitest run convex/payroll.test.ts is green; the payroll e2e passes and writes a new evidence screenshot.

**Deliverables:** New/expanded cases in convex/payroll.test.ts; Updated assertion + screenshot in tests/e2e/reports-payroll.spec.ts; docs/finishing/evidence/<date>-E10-payroll-multicurrency-detail.png

**Verify.** Run `npx vitest run convex/payroll.test.ts` (all green) and `npx playwright test tests/e2e/reports-payroll.spec.ts` (D4 passes, screenshot produced); open the screenshot and confirm three currency footer rows + base total.

### E10-T2 — Fix the date-blind, token-narrow, currency-blind payroll bank matcher (RC10 double-count)
`size: M` · `risk: high` · `depends on: E10-T1`

**Intent.** Stop the confirmed RC10 cash double-count: today a Wise/ACH salary debit that doesn't say payroll/gusto/wise is left uncategorized while payroll also credits the bank. Make matching exact, unique, date-bounded, and consume the real txn so there is exactly one cash-out.

**Changes**

- Rewrite findMatchingBankTxn (payroll.ts:501-519): match on bankAccountId, amountMinor<0, AND exact base-minor-unit (USD) equality to the line's settlement base amount (with a small tolerance constant), require that amount to be UNIQUE among still-unmatched candidates, and constrain the txn date to a bounded window of **±5 calendar days** around postingDateForRun (decided: see decisions.md, Q52 — standard ACH/wire settlement window) — read txn.date from the transactions table.
- Make the matcher currency-aware in the payroll sense only: compare against the line's **USD (base) settlement amount** since payroll books USD (local→USD conversion handled in E10-T3); the bank debit is a USD-equivalent amount, not a foreign-currency journal line.
- Broaden but keep precedence: still prefer txns whose merchant/rawDescription hint at salary, but DO NOT require the token; an exact-amount unique txn in-window matches even without the keyword.
- Pass the matcher into the per-line path: in markLinePaid:597 fetch the entity transactions and call the matcher (currently only markRunPaid:664 does), so the UI's per-person pay also consumes the bank debit.
- Settle **directly payable→bank** with no in-transit/clearing hop for v1 (decided: see decisions.md, Q53 — the Stripe-style clearing hop is a larger change not required for correctness here). In settleLine:582-591, keep marking the matched txn review:'confirmed' + categoryAccountId=payable, but also set a clear provenance/memo link so Transactions shows it as 'matched to payroll' rather than a duplicate expense; confirm there is no new bank credit beyond the single settlement entry (one cash-out only).
- Add a guard so a txn already settlementTxnId-linked to another paid line cannot be matched twice (extend the usedTxnIds set logic to also exclude txns already referenced by any line's settlementTxnId).

**Files:** `convex/payroll.ts:501-519 (findMatchingBankTxn)`, `convex/payroll.ts:582-591 (txn consume)`, `convex/payroll.ts:597-630 (markLinePaid)`, `convex/payroll.ts:643-687 (markRunPaid)`, `convex/schema.ts (transactions: date/amountMinor/review fields)`, `docs/finishing/accounting-engine-blueprint.md:334-336 (RC10)`

**Definition of done**

- [ ] Matcher requires exact base-minor (USD) amount, that amount unique among unmatched candidates, and a txn date within **±5 calendar days** of the posting date (decided: see decisions.md, Q52); keyword is a tiebreaker, not a requirement.
- [ ] markLinePaid now consumes a matching bank txn (previously only markRunPaid did) — covered by a test.
- [ ] A test inserts a salary bank debit with NO payroll keyword but exact amount and in-window date, settles the run, and asserts: the txn is linked (settlementTxnId set, review confirmed) AND it is not left in needs_review; total ledger cash-out equals the single bank debit (no double-count).
- [ ] A test asserts a txn cannot be matched to two lines.

**Deliverables:** Rewritten findMatchingBankTxn + caller wiring in convex/payroll.ts; Regression tests in convex/payroll.test.ts for exact/unique/in-window match, keyword-less match, per-line consumption, and no-double-match

**Verify.** `npx vitest run convex/payroll.test.ts`; specifically assert the keyword-less exact-amount txn is consumed and that summing ledger bank-credits for the run == the bank debit amount (one cash-out, not two).

### E10-T3 — Payroll FX correctness at settlement (fetched day-of-pay rate + manual override + gain/loss)
`size: M` · `risk: high` · `depends on: E10-T2`

**Intent.** Ansar pays USD/PKR/INR; the accrual rate and the day-paid rate differ. Today settlement reuses the accrual rate so the FX path is dead AND the rate source is a hardcoded `PKR:278/INR:83` constant. Payroll is the ONLY place multi-currency survives in OpenBooks (decided: see decisions.md, Q51 / Ansar #4): it converts the foreign salary to its current USD value at a day-of-pay rate and **books USD**. Replace the hardcoded constant with a fetched day-of-pay rate (whatever FX source is easiest to obtain — no provider preference), keep a manual override, and book the difference correctly so the USD payable clears exactly.

**Changes**

- Replace the hardcoded `PKR:278 / INR:83` rate constant (`payrollMath.ts:16-24`) with a **fetched day-of-pay rate** from whatever FX source is easiest to obtain — no provider preference (decided: see decisions.md, Q51 / Ansar #4/#5). Wire the fetch in a Convex action (external network call); persist the fetched micro-unit rate so a query never depends on a live fetch. Keep a **manual override** at both approval and pay time (`payroll.ts:387,399`) that takes precedence over the fetched rate.
- Add an optional settlementFxRate arg to markLinePaid:597 (and a per-currency override map to markRunPaid:643). When provided, recompute settlementBaseMinor in settleLine:538-540 from finalLocalMinor at the pay-day rate via baseEquivalentMinor; default to the **fetched day-of-pay rate** for the currency, then to the line's accrual rate when neither override nor fetch is available (preserving current behavior). The settlement remains a direct USD-booked payable→bank entry — no in-transit/clearing hop for v1 (decided: see decisions.md, Q53).
- Persist the settlement rate on the line (add settledFxRateMicros to payrollRunLines via the widen-migrate-narrow pattern, additive optional) so statements can show accrual vs settled rate.
- Confirm the existing FX gain/loss branching (settleLine:546-559: gain→credit 4200, loss→debit 6999) signs correctly for both directions and that the entry still balances when an FX line is present; add a balance assertion in settleLine before posting.
- Expose the accrual-vs-settled FX delta in runDetail (lineToView:70) so the UI/statement can display realized FX gain/loss per line.

**Files:** `convex/payrollMath.ts:16-24 (hardcoded PKR:278/INR:83 rate constant — replace with fetched rate)`, `convex/payroll.ts:387,399 (manual FX override at approval/pay)`, `convex/payroll.ts:521-594 (settleLine)`, `convex/payroll.ts:597-630 (markLinePaid)`, `convex/payroll.ts:643-687 (markRunPaid)`, `convex/payrollMath.ts:37 (baseEquivalentMinor), :64 (computeRunLine)`, `convex/schema.ts:683-705 (payrollRunLines)`, `docs/finishing/accounting-engine-blueprint.md:302-309 (RC8 — note: only the payroll convert-to-USD slice survives; the GL is USD-only)`

**Definition of done**

- [ ] The hardcoded `PKR:278/INR:83` constant is gone; a fetched day-of-pay rate (easiest source, no provider preference) drives conversion, with a manual override taking precedence; the fetched rate is persisted as integer micro-units (no live fetch on the read path).
- [ ] markLinePaid/markRunPaid accept an optional pay-day FX override; when omitted, the fetched day-of-pay rate is used, falling back to the accrual rate (existing tests stay green for the fallback path).
- [ ] A unit test settles a PKR line at a pay-day rate different from accrual and asserts: settlementBaseMinor differs from approval, an FX line posts to 4200 (gain) or 6999 (loss) with the correct sign, the entry balances, and the USD payable for that line clears to exactly 0.
- [ ] settledFxRateMicros is persisted and surfaced in runDetail; a test reads it back.
- [ ] Float values never persist (rate stored as integer micro-units); payroll still books USD (no foreign-currency journal lines).

**Deliverables:** Fetched day-of-pay FX rate (+ manual override) replacing the hardcoded constant in convex/payrollMath.ts + convex/payroll.ts; Additive payrollRunLines.settledFxRateMicros field + migration note; Unit tests for gain and loss directions with exact USD payable clearance

**Verify.** `npx vitest run convex/payroll.test.ts`; assert for a PKR line: sign of FX line matches paid-less(gain)/paid-more(loss), debit===credit on the settlement entry, and account 2200 net 0 for that line.

### E10-T4 — Surface payroll as the largest expense line in Expenses + reconcile to Reports
`size: M` · `risk: med` · `depends on: E10-T1`

**Intent.** Payroll is the biggest expense for a services shop but is invisible in the Expenses module (expensesViews.ts:260 admits it). Make it a first-class expense line that reconciles to the Reports Payroll Summary so the owner sees true spend.

**Changes**

- In expensesViews.ts (read the vendor/expense rollup around :240-260), add a synthetic 'Payroll' expense group sourced from journal lines posted to the Payroll Expense account (5000) within the period, in base currency — derived from the ledger, NOT from run face values, so it matches Reports.
- Tag the payroll expense line with provenance (source:'payroll') and link to the relevant run(s) so a click can open Payroll.
- Ensure the period window comes from the same date source as the rest of Expenses (no hardcoded today; see E10-T6).
- Add a reconciliation assertion path: the Expenses payroll figure for a period must equal reportViews Payroll Summary base total (reportViews.ts:761-767) for the same period.

**Files:** `convex/expensesViews.ts:240-260`, `convex/reportViews.ts:734-771 (payroll summary)`, `convex/payroll.ts:445-461 (approveRun posts to 5000/2200)`, `apps/web/src/components/openbooks/ModuleScreens.tsx (Expenses screen consumer)`

**Definition of done**

- [ ] Expenses shows a Payroll expense line/group derived from ledger lines on account 5000 for the period, in base currency, ordered such that it appears among the largest expenses.
- [ ] A test asserts the Expenses payroll base figure === Reports Payroll Summary base total for the same date range.
- [ ] The payroll expense line carries source/provenance so it is not double-counted with any bill/vendor line.
- [ ] No hardcoded date in the new code path.

**Deliverables:** Payroll expense group in convex/expensesViews.ts; Reconciliation unit test (Expenses payroll == Reports payroll); Provenance tag on the payroll expense line

**Verify.** `npx vitest run convex/expensesViews.test.ts convex/reportViews.test.ts`; add/assert a case where the Expenses payroll base total equals the Reports payroll summary base total for an identical period.

### E10-T5 — Pay schedules + safe auto-draft UI and per-currency statements
`size: M` · `risk: low` · `depends on: E10-T1, E10-T3`

**Intent.** Give the owner a real pay-schedule control and per-currency statements. The backend (setPaySchedule, autoDraftScheduledRuns, statementCsv) exists but the UI surface and per-currency CSV export need finishing and proving.

**Changes**

- In ModuleScreens.tsx PayrollScreen (1242+) and the People/Settings area, add a pay-schedule control wired to api.payroll.paySchedule (read) + setPaySchedule (write): cadence + enabled toggle, with copy that auto-draft NEVER posts (approval stays manual). For v1, **only monthly auto-draft is wired** (`autoDraftScheduledRuns:813` computes a monthly `YYYY-MM` period); true **semimonthly auto-draft is deferred** (decided: see decisions.md, Q54 — monthly auto-draft + a manual second run is acceptable for v1). If the schema still surfaces a `semimonthly` cadence, mark it clearly as "manual second run" (not auto-drafted) in the UI copy rather than implying auto-draft support.
- Render the Statements tab per currency: split the existing statementRows/statementCsv (moduleViews.ts:659-681) into one statement block + one CSV download per currency, each showing local + USD (base) totals and fxDisplay. Each statement is a **separate per-entity, USD-booked document** (decided: see decisions.md, Q55 — statutory documents are per-entity). A combined portfolio payroll view is a read-only roll-up owned by **E5**, NOT a legal statement, and is out of scope for E10.
- Add a per-currency CSV export button (reuse statementCsv generation, partitioned by currency) and verify rounding/base totals match runDetail.statementGroups.
- Add an e2e: toggle a pay schedule on/off, switch to Statements, assert a per-currency block renders and a CSV per currency downloads; screenshot to evidence.
- Keep the auto-draft NO-OP guarantee: extend convex/payroll.test.ts to assert enabling a schedule on a multi-currency roster drafts a multi-currency draft run without posting.

**Files:** `apps/web/src/components/openbooks/ModuleScreens.tsx:1242-1423 (PayrollScreen), 1468 (PayrollEmployees), 1520 (PayrollRuns)`, `convex/payroll.ts:738-799 (paySchedule/setPaySchedule), :810-845 (autoDraftScheduledRuns)`, `convex/moduleViews.ts:659-681 (statementRows/statementCsv)`, `convex/crons.ts:15-18`, `tests/e2e/reports-payroll.spec.ts`

**Definition of done**

- [ ] Pay-schedule control reads + writes via the existing Convex functions; UI states reflect enabled/disabled and cadence and clearly say auto-draft does not post.
- [ ] Statements tab renders one block + one CSV export per currency with reconciling local/base totals.
- [ ] An e2e toggles the schedule and exercises a per-currency statement + CSV; a unit test confirms auto-draft drafts a multi-currency run with trial balance still 0.
- [ ] Auto-draft remains a NO-OP without an enabled schedule (existing safety test still green).

**Deliverables:** Pay-schedule UI in ModuleScreens.tsx; Per-currency statement blocks + CSV export; e2e schedule/statement test + screenshot; unit auto-draft multi-currency test

**Verify.** `npx playwright test tests/e2e/reports-payroll.spec.ts` and `npx vitest run convex/payroll.test.ts`; manually toggle the schedule and download per-currency CSVs, confirm base totals match runDetail.

### E10-T6 — Payroll insight banner (run-rate / headcount cost / FX exposure) + remove hardcoded dates
`size: M` · `risk: low` · `depends on: E10-T1, E10-T4`

**Intent.** Every page needs one honest, page-specific insight banner; Payroll has none, and its views are frozen on hardcoded 2026 dates. Compute a real run-rate/headcount/FX insight from ledger+run data and drive all payroll dates from one clock source.

**Changes**

- In moduleViews.ts, add a payroll.insight object: monthly run-rate (base-currency payroll cost from the latest run / approved-run trend), active headcount, and an FX-exposure note (share of base cost in non-base currencies). Derive run-rate from approved-run base totals, not face values.
- Replace hardcoded dates: moduleViews.ts:7 today='2026-06-11', ModuleScreens.tsx:1221 PAYROLL_CURRENT_PERIOD='2026-06', :1268 '2026-06-13' — source the current period/range from a single now-based helper (server time for queries; a passed-in/now-based value for the client), consistent with how other screens were de-hardcoded.
- Render one insight banner in PayrollScreen body (ModuleScreens.tsx:1377-1423) using the existing AiInsightBadge/InsightsBand pattern already imported (ModuleScreens.tsx:43), showing run-rate + headcount + FX note; ensure it is the single insight surface on the page.
- Add a unit test for the insight computation (run-rate equals the latest approved run base total for a steady roster; FX note flips on when a non-base employee exists).

**Files:** `convex/moduleViews.ts:7 (today), :776-808 (payroll block)`, `apps/web/src/components/openbooks/ModuleScreens.tsx:43 (AiInsightBadge import), :1221, :1268, :1377-1423 (PayrollScreen body)`, `apps/web/src/components/openbooks/workbench/InsightsBand.tsx (existing pattern)`, `convex/moduleViews.test.ts`

**Definition of done**

- [ ] moduleViews returns a payroll.insight with run-rate (base minor), headcount, and an FX-exposure flag/share, all derived from run/ledger data.
- [ ] No hardcoded calendar literals remain in the payroll read path (moduleViews payroll section) or PayrollScreen; current period/range derive from a single now source.
- [ ] The Payroll page renders exactly one insight banner using the existing badge/band component; an e2e or interactive check confirms it is visible.
- [ ] A unit test asserts run-rate and FX-exposure behavior.

**Deliverables:** payroll.insight in convex/moduleViews.ts; Single insight banner in PayrollScreen; Date de-hardcoding across moduleViews payroll + PayrollScreen; Unit test in convex/moduleViews.test.ts

**Verify.** `npx vitest run convex/moduleViews.test.ts`; grep payroll paths for 2026 literals (expect none); load /payroll and confirm one insight banner with run-rate/headcount/FX.

### E10-T7 — Harden default-entity resolution + settlement bank selection (remove demo-slug coupling)
`size: S` · `risk: med` · `depends on: E10-T1`

**Intent.** Payroll's default-entity fallback hardcodes the demo slug and the settlement bank picks the first checking account — both will mis-route on Ansar's real two-LLC setup. Make resolution entity-explicit and bank selection deterministic per entity.

**Changes**

- In payroll.ts statement:693-704, drop the hardcoded 'acme-studio-llc' slug fallback; require/resolve the entity from the active scope the way other module queries do (entity-explicit, workspace-checked), erroring clearly if none.
- In resolveSettlementBankAccount:484-494, make selection deterministic: prefer the bank account explicitly mapped for payroll (if the entity has one), else the operating/checking account; document the precedence and add a clear error when the entity has zero connected bank accounts.
- Verify all payroll queries/mutations re-check workspace/entity authorization on the server (they do via requireWorkspacePermission — confirm and add a test that a non-member is rejected).
- Add a test that statement() returns the correct entity when entityId is passed and rejects cross-workspace access.

**Files:** `convex/payroll.ts:484-494 (resolveSettlementBankAccount), :693-722 (statement)`, `convex/authz.ts (requireWorkspacePermission)`, `convex/payroll.test.ts`

**Definition of done**

- [ ] statement() no longer depends on the 'acme-studio-llc' slug; it resolves by explicit entityId and enforces workspace membership.
- [ ] resolveSettlementBankAccount has documented deterministic precedence and a clear error with zero bank accounts.
- [ ] A test asserts cross-workspace/non-member access to payroll queries is rejected and that statement resolves the correct entity by id.

**Deliverables:** Entity-explicit statement resolver in convex/payroll.ts; Deterministic settlement-bank selection; Authorization + resolution tests in convex/payroll.test.ts

**Verify.** `npx vitest run convex/payroll.test.ts`; assert a non-member call throws and statement(entityId) returns the named entity, not a slug-default.

## Decisions applied

All prior open questions for this epic are resolved by `../decisions.md` (and `../rebuild/ANSAR-DECISIONS.md`). No item still needs Ansar.

- **Q51 — FX rate source at settlement:** fetch a real day-of-pay rate from whatever source is easiest (no provider preference), replacing the hardcoded `PKR:278/INR:83`; keep a manual override; payroll still books USD. Multi-currency exists **only** in payroll, as convert-to-current-USD-value (Ansar #4/#5). Applied in E10-T3.
- **Q52 — Bank-match date window:** **±5 calendar days** around the posting date (standard ACH/wire settlement window). Applied in E10-T2.
- **Q53 — In-transit/clearing hop for payroll:** settle **directly payable→bank** for v1; no in-transit hop. Applied in E10-T2/E10-T3.
- **Q54 — Semimonthly auto-draft:** **monthly auto-draft + a manual second run for v1**; true semimonthly auto-draft deferred. Applied in E10-T5.
- **Q55 — Per-currency statement legal framing:** each LLC's payroll statement is a **separate per-entity, USD-booked document**; a combined portfolio payroll view is a read-only E5 roll-up, not a legal statement. Applied in E10-T5.

**Note (USD-only GL):** payroll is the single exception to the USD-only general ledger (decisions.md Global rule 1–2). Everywhere outside payroll, the ledger is USD-only; payroll books USD but converts foreign salary at a day-of-pay rate. Do not introduce foreign-currency journal lines.

## Research notes

- QBO 'For Review' auto-match guardrails (exact minor-unit amount, that amount unique among unmatched lines, bounded date window, same scope) are the documented pattern this epic adopts for the payroll bank matcher — already captured as the target architecture in docs/finishing/accounting-engine-blueprint.md:362-373. ([source](docs/finishing/accounting-engine-blueprint.md))
- RC10 (payroll matcher date-blind/token-narrow → double-count) is confirmed in the deep audit; payroll already stores each line in local + base (USD) minor units with an integer micro-unit FX rate, so the fix is hardening the matcher and the day-of-pay settlement-rate path, not a money-model rewrite. RC8's general-ledger multi-currency concern no longer applies — the GL is **USD-only** (decisions.md Global rule 1); the only surviving multi-currency surface is payroll's convert-to-USD path (Ansar #4). ([source](docs/finishing/accounting-engine-blueprint.md))
