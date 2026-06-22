# OpenBooks — Accounting Engine Blueprint, Diagnosis & Launch Roadmap

For: Ansar · Date: 2026-06-16 · Status: research + audit packet (the contract for the next build phase)

This packet answers, in one place: **how the accounting actually works**, **why your real
reports are wrong right now** (with evidence from your live database), **what is done / broken /
missing**, **the target architecture**, **a prioritized build roadmap**, **what you as the owner
must do**, and **the launch/GTM plan**. It is grounded in a file-by-file audit of the codebase, a
read of your live cloud deployment, and research into how QuickBooks Online, Xero, Stripe, and
Plaid do this in production (sources cited at the end of each blueprint section).

---

## Part 0 — The two-sentence diagnosis

**Your ledger engine is correct. Your problem is that, on real data, ~78–80% of your money never
gets posted into that ledger** — it's stuck in the Inbox uncategorized — and your Stripe deposits
never reconcile, so the books show a fraction of your expenses and a half-million dollars of
phantom assets.

This is *not* "the accounting math is broken." The double-entry core is genuinely sound. It is
"the pipes that feed the ledger leak, and nothing on screen tells you they're leaking." Everything
below is fixable, and most of it is fixable quickly because the foundations (clearing accounts,
in-transit account, opening-balance-equity account, the single balanced posting path) already
exist in the code — they're just not wired up end to end.

### What your live books actually look like today

Read directly from your cloud deployment (two real entities, **Zikra** and **Z360**):

| Symptom | Zikra | Z360 | Why |
|---|---|---|---|
| Transactions posted to ledger | ~957 of ~2,923 | ~164 of ~567 | The rest (~78–80%) sit in the Inbox with **no journal entry** |
| Full-year P&L income | $120,463 | — | Looks plausible |
| Full-year P&L expense | **$3,410** (all "Payment Processing Fees") | **$413** | Real vendor spend never categorized → never posted → invisible |
| "Payouts In-Transit" (acct 1160) | **+$458,101.25** | +$12,147.96 | Stripe payout→bank deposit never reconciles; cash parks in a phantom asset |
| "Stripe Clearing" (acct 1150) | **−$6,305.73** | −$848.92 | Impossible **negative** asset — the clearing chain is half-posted |
| Owner's Equity | **$0** | $0 | No opening balance booked when banks connected |
| Balance Sheet "Balanced ✓"? | "Yes" — but false | "Yes" — but false | It only ties because every posted dollar became Sales and there are no liabilities/equity |

The "Balanced ✓" badge is the cruelest part: the books *look* reconciled (trial balance nets to
zero) while being almost entirely incomplete. A balanced trial balance is **necessary but not
sufficient** — it cannot catch a transaction that was simply never recorded.

---

## Part 1 — How the accounting works (the blueprint, in plain English)

You said you're not an accounting person, so this is the mental model the whole product runs on.
There are exactly **two engines**, and keeping them separate is the entire trick.

### Engine A — the deterministic ledger (the system of record)

Every dollar event is recorded as a **journal entry** with two or more **lines**, where total
**debits = total credits**. That's double-entry. It's a 500-year-old self-checking system: because
every entry balances, the whole book always balances, so the reports can never silently drift.

- **Accounts** (your "categories") are buckets with a type: **asset, liability, equity, income,
  expense**. "Software & SaaS," "Sales," "Accounts Receivable," "Operating Checking" are all
  accounts. The owner sees friendly category names; the ledger sees numbered accounts (5200, 4000,
  1100, 1010). *Categories ARE accounts* — there is no separate "category total" anywhere.
- The **accounting equation** always holds: Assets = Liabilities + Equity. Income and expense roll
  up into equity (as profit) at period end.
- **Reports are pure functions of journal lines.** P&L = sum of income/expense lines in a date
  range. Balance Sheet = running balance of asset/liability/equity accounts. AR Aging = open
  invoices bucketed by due date. Nothing is ever "totaled up by category" off to the side — that's
  the rule that makes the numbers trustworthy. *Your code already does this correctly.*
- **Cash vs accrual** is a reporting toggle, not two sets of books: accrual counts revenue when
  *earned* (invoice issued) and expense when *incurred* (bill received); cash counts when money
  actually moves. Same ledger, different filter.

The one law: **AI proposes, the ledger engine posts.** Exactly one mutation
(`postLedgerEntryCore`, `convex/ledger.ts:345`) writes to the ledger, and it refuses any entry
where debits ≠ credits, any line that isn't a clean debit-or-credit, any post into a locked
period, and any "correction" that isn't an exact reversal. This is correct and is the strongest
part of your codebase.

### Engine B — the AI classification layer (the assistant)

Raw money events arrive from Plaid (bank), Stripe (payments), CSV, or manual entry. They are *not*
accounting entries yet — they're just "a thing happened." The job of Engine B is to decide **which
two accounts** each event should debit and credit, then hand a balanced proposal to Engine A.

The right design (and roughly what you have, in cascade order, cheapest signal first):

1. **Transfer?** — money moving between your *own* accounts (checking → savings, or a Stripe
   payout landing in your bank). Books a net-zero transfer, never income/expense.
2. **Match?** — does this clear an open invoice, bill, payroll, or expected Stripe payout? If so,
   link it (don't create new revenue/expense — that's the #1 double-count trap).
3. **Rule?** — a deterministic if-then the owner created ("anything from 'AWS' → Cloud").
4. **Memory?** — "you categorized this exact merchant before, here's what you chose."
5. **AI (LLM)?** — last resort: the model reads the description and proposes a category + a
   confidence score + a reason.
6. **Otherwise → Inbox** ("For Review") — a human decides.

**Confidence gates autonomy:** `suggest` = AI never posts; `balanced` = auto-post at ≥90%
confidence; `autopilot` = ≥75%. Anything below the gate goes to the Inbox. This is exactly how
QuickBooks frames it ("98% automatic, but you still confirm").

**The learning loop:** every time you correct something in the Inbox, the system writes it to
memory so the *next* occurrence of that merchant resolves itself; after three identical
corrections it offers to make a permanent rule. "AI learns" in production is a memory write, not a
model retrain.

### The money lifecycle (how a transaction becomes a report number)

```
Plaid / Stripe / CSV / manual
        │
        ▼
   [Engine B cascade]  ──low confidence──▶  INBOX (For Review)  ──owner: Add / Match / Transfer──┐
        │ high confidence                                                                         │
        ▼                                                                                         ▼
   [Engine A: postLedgerEntryCore]  ◀───────────────────── balanced proposal ────────────────────┘
        │
        ▼
   journal lines  ──▶  Reports (P&L, Balance Sheet, Cash Flow, AR/AP)  +  Dashboard  +  Ask AI
```

The critical insight your product is currently missing: **an item that's still "For Review" is not
in the books yet.** That's correct (you shouldn't book uncategorized money as revenue) — but it
means the Inbox is not optional housekeeping, it's the bottleneck that fills the ledger. Right now
2,700+ of your transactions are stuck at that gate, so the reports below it are starved.

### The Stripe puzzle you asked about (5 invoices → 1 payout)

This is *the* classic small-business accounting problem, and there's a standard, correct answer
used by QuickBooks + every Stripe-sync tool (A2X, Synder, Acodei). It uses a **clearing account**
(QuickBooks calls it "Undeposited Funds"; you've named yours "Stripe Clearing," account 1150):

1. **Each charge** (when a customer pays): `Dr Stripe Clearing / Cr Sales` for the **gross**
   amount. Revenue is recognized here, once, attributed to the customer.
2. **The Stripe fee**: `Dr Payment Processing Fees / Cr Stripe Clearing`. Fee booked as an expense.
3. **The payout** (Stripe sweeps your balance to your bank): `Dr Payouts In-Transit / Cr Stripe
   Clearing` for the net. Now Clearing nets back to ~zero for that batch.
4. **The bank deposit arrives** (Plaid sees the one lump sum): this is **matched** to the payout
   and booked `Dr Operating Checking / Cr Payouts In-Transit`. **It is a transfer, not income.**

Net result: revenue counted exactly once (at the charge), fees visible, and the single bank
deposit reconciles against the five charges. The **iron rule**: the bank deposit must *clear the
clearing account*, never create new revenue. If you ever let a bank rule auto-categorize the
Stripe deposit as "income," you double-count every dollar — which is partly what's happening to you
now (see Part 2).

Your chart of accounts already has 1150 (Clearing) and 1160 (In-Transit), and the code has the
matcher. The problem is the matcher almost never fires on real data, so step 4 never happens and
the money piles up in 1160. That's the $458k.

> Sources: QuickBooks "For Review" Add/Match/Transfer & Undeposited Funds (Intuit docs); Stripe
> Payout Reconciliation report (docs.stripe.com/reports/payout-reconciliation); Synder/Acodei/Growthy
> "one payout = one deposit = one journal entry; the clearing account is the error detector."

### Bank reconciliation & closing the books (what "reconciled" means)

- **Reconciliation** = proving your ledger's cash balance equals the bank's actual balance at a
  statement date, line by line. Outstanding/in-transit items adjust the *bank* side; fees/interest
  the bank charged that you didn't book yet adjust the *book* side (and require a journal entry).
  You "complete" a reconciliation only when the difference is **zero**.
- **Closing a period** = locking it so no new entries can change a month you've already reported on.
  Corrections after close must *reverse and repost* into an open period (your immutability rule).
- "Reconciled books" is what makes the numbers trustworthy enough to file taxes or raise money on.

### Multi-entity (your #1 ask: unified vs split)

Here's the nuance the research strongly confirmed, and it changes your plan: **separate LLCs should
keep separate ledgers.** QuickBooks and Xero both force one company file per legal entity *on
purpose* — commingling two LLCs' books in one ledger is exactly what courts treat as "alter ego"
evidence that pierces the liability shield you formed the LLCs to get. So the right model is:

- **Each business (LLC) = its own entity = its own ledger, chart of accounts, bank/Stripe
  connections, and balance sheet.** (You already have this — `entities` with per-entity journal
  lines. Keep it.)
- **A "Portfolio / All Businesses" roll-up view on top** that combines cash, AR/AP, revenue,
  expenses, and runway across every entity you own — with each tile drilling into the single
  business. *This* is your unified-by-default experience, and it's a genuine differentiator (QBO
  and Xero make you buy Fathom/Joiin for it).
- Proper consolidation (when you sum two entities) must **eliminate intercompany activity** — e.g.
  if you move money from Zikra to Z360, that's not revenue to the group. The AI transfer-matcher
  you already need can *flag* inter-entity transfers for you to confirm.

So: "unified by default with optional split" becomes **"Portfolio view by default + one-click into
each business,"** not "two LLCs jammed into one ledger." Same end-user feeling, legally correct
underneath. The "filter by business type" control you dislike gets replaced by an **"All
businesses / Zikra / Z360" scope switcher**.

> Sources: QBO "only one company per subscription, data stays separate" (Intuit); Xero "designed for
> single-entity accounting, one login → many orgs" (Xero Central); Class/Location tracking for
> divisions *inside* one LLC; ASC 810/IFRS 10 intercompany eliminations.

---

## Part 2 — Why your reports are wrong right now (ranked, evidence-backed)

Every root cause below is confirmed against the code (file:line) and, where possible, against your
live data. Ordered by how much damage each does to your real books.

### RC1 — ~78–80% of your transactions never post to the ledger *(the dominant cause)*

When the cascade can't confidently classify a transaction, it lands in the Inbox as `needs_review`
with **`entryId: null`** — i.e. **no journal entry is ever created** (`convex/pipeline.ts:454,
572`). Reports read only posted journal lines, so every uncategorized transaction is invisible to
P&L, Cash Flow, and the cash side of the Balance Sheet. On real data with no rules/memory yet, the
*overwhelming majority* of transactions can't be auto-classified, so they pile up unposted.

**Evidence:** ~2,293 of ~2,923 Zikra transactions and ~453 of ~567 Z360 transactions are sitting
in the Inbox. That's why Zikra shows $120k income but only $3,410 of expenses — your real vendor
spend is all stuck at the gate. The demo seed never hits this because it posts every entry
directly, fully categorized.

**Why it's this bad on real data:** RC9 below — AI categorization is effectively degraded, so even
the LLM stage rarely fires, and the per-sync batch is capped at 25 items with no
self-rescheduling (`bedrockCategorizer.ts:743`, `plaid.ts:1301`). 2,700 items / 25 = it would
never drain even if it worked.

**Fix:** (a) get categorization actually working (RC9), (b) bulk-categorize the entire backlog with
a self-rescheduling job, (c) post low-confidence items to "Uncategorized Income/Expense" (you have
accounts 4900/6900) *or* prominently surface "$X / N transactions unreviewed and excluded from
these reports" on every report and the dashboard so the gap is never silent. QuickBooks shows the
"For Review" count exactly for this reason.

### RC2 — Stripe payouts never reconcile → $458k phantom "In-Transit," negative "Clearing"

The matcher that should book the bank deposit against the Stripe payout (`tryMatchDepositToPayout`,
`stripe.ts:1371`) requires: net amount within **1 cent** (`PAYOUT_MATCH_AMOUNT_TOLERANCE_MINOR=1`),
within **5 days** of the arrival date, **and** the bank descriptor to literally contain "stripe" or
"payout" (`looksLikeStripePayout`, `stripe.ts:1208`). On real bank data, deposits frequently differ
by more than a cent, land outside the window, or have a descriptor like "ORIG CO NAME" — so the
match **never fires**.

**Consequence:** step 4 of the Stripe lifecycle never runs. The `Dr Bank / Cr 1160` closing leg
never posts, so account 1160 "Payouts In-Transit" accumulates the entire gross-minus-fees of every
payout forever: **+$458,101.25 on Zikra.** Meanwhile charges keep draining 1150 "Stripe Clearing"
which runs **negative (−$6,305.73)** — an impossible state that screams "half-posted chain."

**Fix:** loosen the matcher (wider amount tolerance for fees/rounding, wider date window, drop the
descriptor gate or make it a tiebreaker not a gate), and add an explicit **"Match" action** in the
Inbox so the owner can pair a deposit to a payout when auto-match misses. Add a **"Stripe Clearing
must be ~0 / In-Transit must drain" health tripwire** that routes drift to the Inbox instead of
letting it silently balloon.

### RC3 — No opening balance is booked when you connect a real bank

When a bank is connected, the code stores the live balance on the bank account row
(`plaid.ts:1933`) but **posts no journal entry**. The chart has "Opening Balance Equity" (account
3900) for exactly this, but it's referenced nowhere in posting code. So the ledger's cash starts at
**$0** and only ever reflects synced transaction deltas, while your real bank holds months of
pre-existing money.

**Consequence:** Balance Sheet cash and Cash Flow's closing cash can never equal the real bank
balance; **Equity reads $0** on both your entities while assets are $592k/$15k — the entire asset
base is mis-carried as retained earnings. This is a second reason the balance sheet is wrong.

**Fix:** on bank connect, post `Dr Bank account / Cr Opening Balance Equity` for the
statement-start balance (QuickBooks does exactly this). Make it part of the connect flow.

### RC4 — Fixture (fake) payouts get injected into your real Stripe books

The real Stripe sync passes `includeFixturePayoutFallback: true` (`stripe.ts:1851`), and when
Stripe's `/payouts` list returns empty (very common with restricted keys lacking payout scope, or
before payouts settle) the code substitutes **two synthetic demo payouts** and posts real
`Dr 1160 / Cr 1150` entries plus a fake "payout mismatch" Inbox card onto your live books
(`stripe.ts:1824`).

**Consequence:** phantom entries on real data; part of the negative-clearing / inflated-in-transit
mess. **Fix:** never inject fixtures into a real (non-demo) entity — gate the fallback to demo
entities only.

### RC5 — Reports silently truncate at 5,000 rows

The report builder loads journal lines with `.take(5000)` on a non-date-ordered index
(`reportViews.ts:494`); dashboard/perf use the same cap. A real ~6-month book (Zikra already has
~2,923 transactions × 2–4 lines each) **overflows the cap, and `.take` silently drops lines — often
only one side of an entry** — so totals are wrong and can even appear unbalanced. The demo stays
under the cap, which is why it looks fine.

**Fix:** pre-aggregate account balances in a rollup table (so reports read O(accounts), not
O(lines)), or at minimum order by date and paginate. This is also the scalability fix for when a
business has years of data.

### RC6 — Hardcoded "today" dates freeze every time window

Dates are hardcoded in many places: Insights uses `TODAY_ISO = '2026-06-30'`
(`InsightsScreen.tsx:32`); modules use `today = '2026-06-11'` (`invoices.ts`, `bills.ts`,
`incomeViews.ts`, etc.); Ask AI defaults to the calendar-2026 window
(`agentToolQueries.ts:35`); the dashboard hardcodes a 2025-07…2026-06 twelve-month window
(`coreViews.ts:12`).

**Consequence:** real data dated to the actual current date (it's now mid-2026 and moving) resolves
"this month" to an empty/stale window, so Insight KPIs, overdue flags, AR/AP aging, and the
cash-flow chart read blank or wrong even when the ledger is fine. **Fix:** derive "today" from the
server clock everywhere; pass `asOf` through consistently.

### RC7 — Dashboard cash and Report cash come from two different sources

The Dashboard cash tile shows the **live Plaid balance** for connected accounts (`coreViews.ts:180`)
while the Balance Sheet derives cash from **posted journal lines** (`reportViews.ts:598`). Because
most transactions aren't posted (RC1) and there's no opening balance (RC3), these two "cash"
numbers diverge wildly — and the user sees the contradiction and concludes "the books don't match."
**Fix:** make both read the same source (ledger), and show the bank's live balance separately as
"bank says X / books say Y — N items to review explains the difference."

### RC8 — Multi-currency amounts are summed without conversion

`postLedgerEntryCore` never writes the `fxRate` field, and every roll-up sums debit/credit minor
units **ignoring `line.currency`** with no base-currency conversion (`ledger.ts:595`,
`reports.ts:21`, `reportViews.ts:303`). A PKR line and a USD line are added as if the same currency.
You run **USD/PKR/INR** (payroll, foreign vendors), so this actively mis-states totals and can break
the trial balance. **Fix:** store each line in its transaction currency **plus** a base-currency
amount captured at an FX rate; report in base currency; add an FX gain/loss account.

### RC9 — Bring-your-own AI key doesn't actually work, so categorization is degraded

The AI settings panel renders a **disabled** provider dropdown and a key field that just says "set
in Convex env" — there's **no way to paste a key** (`AiSection.tsx:105`). Nothing ever writes the
`aiCredentials` table (zero `insert`/`patch` callers). The categorizer hard-requires Amazon Bedrock
env vars (`bedrockCategorizer.ts:150`); any other provider returns `degraded` and routes everything
to the Inbox. So unless the *operator* has AWS Bedrock env vars set, **AI categorization is
effectively off** — which is the upstream cause of RC1's backlog. Your "BYO any of 14 providers"
promise is built in the data model but not wired to the UI or the runtime. **Fix:** wire a real
key-entry UI → encrypted `aiCredentials` → a provider-agnostic categorizer that uses the AI SDK
runtime you already use for chat.

### RC10 — Pipeline quality gaps that distort the items that *do* post

- **Dead memory layer:** the `aiMemoryEmbeddings` vector table is never written or queried; the
  "memory" stage is plain exact-string matching, so "AWS" and "AMZN WEB SERVICES" don't share a
  memory — the single biggest accuracy ceiling.
- **Dormant calibration:** confidence is never calibrated in production (`pipeline.ts:241` returns
  identity), so the 0.90/0.75 gates compare against raw, overconfident LLM scores.
- **Direction-locked categories:** inflows can only be booked to income accounts (`ai.ts:290`), so
  refunds, loan proceeds, and owner contributions get forced into revenue — **overstating income**.
- **`contactId` never written on journal lines** (`ledger.ts:413`), so "revenue by customer" /
  "spend by vendor" off the ledger is blank.
- **Payroll bank-matcher is date-blind and token-narrow** (`payroll.ts:501`), so a Wise/ACH salary
  debit that doesn't say "payroll/gusto/wise" is left uncategorized while payroll also credits the
  bank — double-counting cash out.

---

## Part 3 — State of the product (done / broken / missing)

| Subsystem | ✅ Solid | ⚠️ Broken on real data | ❌ Missing |
|---|---|---|---|
| **Ledger core** | Single balanced posting path; immutability + reverse/repost; period locks; typed chart incl. clearing/in-transit/opening-equity accounts | Multi-currency summing (RC8); period-lock only guards new-entry date | FX base-currency + gain/loss; per-currency trial balance; balance rollup table |
| **Reports** | Derived purely from journal lines (correct architecture); cash/accrual toggle; drill-down | 5,000-row truncation (RC5); excludes unposted items with no signal (RC1); cash-flow double-counts transfers/splits; income-by-customer can double-count | "$X unreviewed/excluded" banner; consolidated/portfolio report |
| **Multi-entity** | Per-entity ledgers (legally correct); entity switcher | Non-deterministic default business; demo-slug fallback when entityId omitted | **Portfolio "All businesses" roll-up (your #1 ask)**; intercompany elimination/flagging; "All/Zikra/Z360" scope control |
| **Plaid** | `/transactions/sync` cursor + webhook + cron; correct sign handling; removed-txn reversal | No opening balance (RC3); pending→posted dedup can miss enriched merchants; one Plaid item can't split accounts across businesses; un-mapped sub-accounts silently dropped | Per-account→business mapping at link; initial-sync-on-connect; transfer auto-pairing across own accounts |
| **Stripe** | Clearing/in-transit model designed correctly; webhook dedupe; payout lines persisted | Matcher never fires on real data (RC2); fixture payouts injected (RC4); income KPI double-counts gross+net; clearing runs negative | Per-`reporting_category` posting (refunds/disputes/adjustments); contra-revenue for refunds; clearing-must-zero tripwire; per-entity Stripe key association UI |
| **AI pipeline** | Cascade structure; proposals are confirm-before-post; autonomy constant shared | Bedrock-only → degraded for BYO keys (RC9); 25-item cap, no self-reschedule (RC1); dead embeddings; dormant calibration; direction-locked (RC10) | BYO-provider categorizer; semantic memory; backlog drainer; business-context in the prompt |
| **Onboarding / BYOK** | First-run workspace + first business + typed chart + checklist | Single-business only; "Connect AI/Bank/Stripe" steps are decorative skips; no AI key field | Multi-business setup; inline key entry (AI/Plaid/Stripe); "review & approve AI-proposed categories/rules" step; bulk-categorize-history step; Plunk email actually sending |
| **Dashboard / Insights** | Rich metric set; charts | Cash tile ≠ reports (RC7); cash-flow chart sums raw txns (double-counts); hardcoded windows (RC6); top-customer uses invoice face value | Portfolio insights; revenue-by-stream; runway/burn from ledger; cash-flow forecast |
| **Modules** | Invoice AR / Bill AP posting; payroll run→approve→pay; receipt intake; contacts | `contactId` never on lines → customer/vendor reports blank; hardcoded "today" (RC6); no FX on invoices/bills; payroll matcher weak; no partial payments | Per-document FX; partial payments; auto-create contact for every counterparty; recurring/run-rate from ledger |
| **Ask AI** | Threads; propose→confirm; reads the report pack (not guesses) | Bedrock-only for chat too; hardcoded 2026 date window; no "today" awareness; can only re-categorize to expense accounts | BYO-provider chat; current-date context; "what's unreconciled?" tool; payout-diagnostic tool |

---

## Part 4 — The target architecture (the build spec)

This is the blueprint to build toward. It is mostly *wiring and hardening what already exists*, not
a rewrite.

### 4.1 The corrected money pipeline ("For Review" semantics)

Adopt QuickBooks' three explicit resolutions for every incoming line, and make "not yet resolved =
not in the books, and visibly so":

- **Add** — create a new posting (the normal categorize path).
- **Match** — link to an existing invoice / bill / payroll / Stripe payout (prevents double-count).
  Default to Match whenever a candidate exists; only Add when none does.
- **Transfer** — net-zero move between your own accounts (incl. the Stripe payout deposit).

Auto-match guardrails (from QBO): exact minor-unit amount, that amount unique among unmatched
lines, bounded date window, same scope. Post pending Plaid transactions to a hold, not the
confident path (Plaid says pending data mutates). Surface the unreviewed count and dollar amount
everywhere a total is shown.

### 4.2 Stripe settlement that always zeroes the clearing account

Store Stripe's `payout` id and `balance_transaction_id` on every charge/fee/refund. Build the
settlement as one balanced entry per payout that posts gross, fees, refunds (contra-revenue), and
the net transfer — and **assert the clearing delta for that payout nets to zero before commit**
(a second invariant alongside debits=credits). Route the imported bank deposit to **Match** against
that payout (Transfer into bank from In-Transit), never to income. Flag instant/manual payouts
(Stripe can't attribute them) to the Inbox.

### 4.3 Opening balances & reconciliation

On bank connect: book `Dr Bank / Cr Opening Balance Equity` at the statement-start balance, and
trigger the first sync immediately (Plaid's `SYNC_UPDATES_AVAILABLE` won't fire until you call sync
once). Add a **reconciliation surface** per bank account: anchor on the statement ending balance,
mark lines cleared, auto-draft adjusting entries for fees/interest, and refuse to "complete" until
the difference is zero. Add **period close** (you have period locks — surface them in the UI).

### 4.4 The AI cascade done right

Order: exact merchant-memory → user rule → embedding/k-NN recall → LLM fallback → abstain to Inbox.
Make memory the highest-value signal (write on every correction; next occurrence is deterministic,
no LLM call). Add the embeddings recall layer (the dead vector table) so "AWS" ≈ "AMZN WEB
SERVICES." Calibrate confidence against a holdout before it gates auto-post; show real per-band
accuracy. Feed the **business context** (your 3 revenue streams, known vendors) into the prompt.
Show a provenance line on every decision ("Matched your rule" / "Same as your last 6 AWS charges" /
"AI 0.82 — review"). Keep the LLM for the novel tail only; never route 80–95% repeat volume through
it (cost + failure surface). Validate every LLM-returned transaction id exists before posting.

> Sources: Intuit Rel-Cat GNN (68.7% top-1 / 88% top-5); GPT-4o zero-shot ~60% on SME txns
> (arxiv 2508.05425); ANNA XGBoost-first + LLM tail; Mercado Libre 60%→90% via embeddings; Puzzle
> 98% auto / 2% flagged with reasoning trails.

### 4.5 Bring-your-own-keys, end to end

- **AI:** real key-entry UI per provider → encrypted `aiCredentials` → a provider-agnostic
  categorizer on the AI SDK runtime (the one chat already uses). Any of the 14 providers, not just
  Bedrock.
- **Plaid:** the owner pastes their own `client_id` + `secret`, sets the redirect URL; one Plaid
  connection per workspace is fine, but **map each account → a business** at link time (not
  per-item).
- **Stripe:** the owner pastes a secret key + webhook secret **per business**; multiple Stripe keys
  per workspace, each associated to one entity. Make the webhook secret required, and verify it's
  registered before calling Stripe "connected."

### 4.6 Multi-entity: per-entity books + portfolio roll-up

Keep each LLC's ledger separate. Add a read-only **Portfolio dashboard** (combined cash, AR/AP,
revenue, runway, by-business breakdown) and an **"All businesses / Zikra / Z360" scope switcher** in
the shell that replaces the "filter by business type." When consolidating, eliminate intercompany
transfers (the AI flags a Zikra→Z360 transfer for you to confirm). Add Class/tag tracking *within*
an entity for DBAs/divisions — explicitly not a substitute for separate entities.

### 4.7 Onboarding (the corrected ~20-minute flow)

`Create workspace → add business(es) (multi) → add AI key (+pick autonomy) → add Plunk key → invite
members → connect Plaid + map accounts→businesses → connect Stripe key(s)→businesses → set opening
balances → sync → AI bulk-categorizes history → you review & approve the proposed categories + rules
→ done.` Each connect step does real work inline (paste key, run Link, save), not a decorative skip.
The "review & approve AI-proposed categories/rules" step is what converts the 6-month backfill into
posted books in one sitting.

### 4.8 Insights & Ask AI

Insights = mostly **programmatic** (computed from the ledger: runway, burn, MoM income/expense/
profit, revenue-by-stream, recurring run-rate, top customers/vendors, concentration, DSO/aging)
with an **AI narrative layer** on top ("here's what changed and why"). Never fabricate numbers — AI
reads the same report pack the screens do. Give Ask AI current-date awareness, a "what's
unreconciled?" tool, and a payout-diagnostic tool so it can explain the gaps instead of confidently
restating wrong figures.

---

## Part 5 — The roadmap (do these in order)

Phased so that each phase makes the product *measurably* more correct. Effort: S = hours, M = a day
or two, L = several days.

### Phase 0 — Stop the corruption & make today's data legible (1–2 days, mostly S)

The fastest path to "my reports stop lying."

1. **Gate fixture payouts to demo entities only** (RC4). `stripe.ts:1851/1824`. **S** → real Stripe
   books stop getting fake entries.
2. **Replace hardcoded dates with the server clock** (RC6). Insights/modules/AI/dashboard. **M** →
   Insights & aging stop reading blank.
3. **Make Dashboard cash read the ledger** (or clearly label bank-vs-books) (RC7). **S** → the two
   cash numbers reconcile.
4. **Surface the unreviewed gap**: a banner on reports & dashboard — "N transactions ($X) are
   unreviewed and excluded." **S** → the understatement stops being silent.
5. **Order report queries by date / raise or remove the 5,000 cap as an interim** (RC5). **S–M** →
   stops dropping lines.

### Phase 1 — Make real data actually post (3–5 days) — *fixes the 78% problem*

6. **Wire BYO AI keys** end to end: key-entry UI → encrypted `aiCredentials` → provider-agnostic
   categorizer on the AI SDK runtime (RC9). **L** → categorization works without Bedrock env.
7. **Backlog drainer**: a self-rescheduling job that categorizes the entire `needs_review` history,
   not 25 at a time (RC1). **M** → the 2,700-item pile clears.
8. **Feed business context into the categorizer prompt** (your revenue streams + vendor hints). **S**
   → accuracy jumps on cold start.
9. **Book opening balances on bank connect** (RC3). **M** → balance sheet ties to the bank; equity
   stops being $0.
10. **"Review & approve proposed categories/rules" bulk flow** (onboarding + Inbox). **M** → one
    sitting converts history into posted books.

### Phase 2 — Stripe reconciliation correct (2–4 days)

11. **Loosen the payout matcher** + add an Inbox **"Match deposit to payout"** action (RC2). **M** →
    the $458k drains out of In-Transit into real cash.
12. **Per-`reporting_category` payout posting** (refunds/disputes/fees/adjustments) + clearing-zeroes
    invariant. **L** → Stripe books are airtight.
13. **Clearing/In-Transit health tripwire** → Inbox card when non-zero. **S** → drift can't hide.

### Phase 3 — Multi-currency + the unified view you asked for (3–5 days)

14. **FX engine**: per-line transaction currency + base-currency amount at a captured rate; report
    in base currency; FX gain/loss account (RC8). **L**.
15. **Portfolio "All businesses" roll-up + scope switcher** (replace "filter by business type"). **L**
    → your #1 ask shipped.
16. **Intercompany transfer flagging** between your entities. **M**.

### Phase 4 — Quality, learning, and trust (ongoing)

17. **Semantic memory (embeddings recall)** + write-on-correction (RC10). **L** → accuracy ceiling
    lifts; "AWS"≈"AMZN WEB SERVICES."
18. **Confidence calibration in production** + per-band accuracy display. **M**.
19. **Reconciliation surface + period close UI**. **L** → "reconciled books" becomes real.
20. **`contactId` on journal lines** → customer/vendor revenue/spend reports light up. **M**.
21. **Pre-aggregated balance rollup table** → reports scale to years of data. **L**.
22. **Honest categorization eval ≥ target** with the corrected pipeline. **M**.

### Phase 5 — Insights, Ask AI, and the rest (ongoing)

23. Programmatic insight pack (runway/burn/revenue-by-stream/forecast) + AI narrative. **L**.
24. Ask AI: current-date context, "what's unreconciled?" + payout-diagnostic tools, BYO-provider
    chat. **M**.
25. Per-account→business mapping at Plaid link; required Stripe webhook secret; transfer
    auto-pairing. **M**.

---

## Part 6 — What you (the owner) actually have to do

The promise is "20 minutes to set up, a few minutes a week to stay clean." Concretely:

- **One-time (~20 min):** connect banks + Stripe, set opening balances, tell the AI what your
  business does (the 3 revenue streams), and approve the first batch of AI-proposed categories +
  rules. This is the context-load that makes everything after it accurate.
- **Weekly (~5 min):** clear the Inbox — confirm/correct a handful of cards. Each correction teaches
  the system, so the pile shrinks over time. **Inbox zero = books done.**
- **Monthly (~15 min):** reconcile each bank account to its statement (the app does the matching;
  you approve), then close the month.
- **As needed:** create invoices/bills, run payroll, ask the AI questions.

The engagement bargain is honest: the AI does ~90%+ of the keystrokes, but *you* remain the
approver of what's uncertain. That's the only way the numbers stay trustworthy enough to run a
business on.

---

## Part 7 — Opportunities & differentiation (beyond what you asked)

Things that turn "free QuickBooks clone" into "why would I use anything else":

- **Portfolio CFO view** for solopreneurs with multiple LLCs — the thing QBO/Xero charge add-ons
  for. This is your wedge.
- **Revenue-by-stream P&L** (marketing one-time vs MRR, Z360 platform vs usage vs setup vs
  support, consulting) using Class/tag tracking — see margin per product line, not just per LLC.
- **Cash-flow forecast + runway**: detect recurring inflows/outflows, project the next 30/60/90
  days, "you run out of cushion on ___ unless ___."
- **Tax set-aside auto-calc**: estimate quarterly tax and earmark it — the thing every solopreneur
  forgets.
- **Anomaly/duplicate detection**: "this vendor charged you twice," "this subscription doubled."
- **The AI CFO**: weekly plain-English digest ("revenue up 12%, AR aging worsened, AWS up 30%"),
  delivered via Plunk email.
- **"Explain this number"** everywhere: click any figure → AI explains what's behind it in English.
- **Owner-pays-nothing trust**: full data export ("your books are a file you own"), immutable audit
  log, and an open-source ledger anyone can verify — a credibility story QuickBooks can't tell.

---

## Part 8 — Launch & go-to-market plan

You asked for the full packet, so here's the publication path. These are separate deliverables I can
generate next; this is the spec.

- **README** — what it is (free, open-source, AI bookkeeping), the "AI proposes / ledger posts"
  promise, a 5-minute quickstart, the BYO-keys model (Plaid/Stripe/AI), screenshots, and an honest
  "what works / what's beta" table. Lead with the portfolio/multi-LLC differentiator.
- **Install skill** — a Claude Code / CLI skill that scaffolds env, provisions Convex, sets keys,
  seeds the chart, and runs the first sync — turning "clone + read 6 docs" into one command.
- **Security doc** — secrets are encrypted at rest (`secretBox`, AES-GCM), keys never returned to
  the client (only `lastFour`), sandbox/test enforced, every read re-checks workspace/entity authz,
  no keys/tokens/PII committed. This is a trust prerequisite for asking people to paste bank/Stripe
  keys. (Run a secret scan before any public artifact.)
- **Launch article** — "I built free, open-source, AI-powered bookkeeping for small businesses
  (and reverse-engineered how QuickBooks actually works)." Tell the two-engines story; show the
  portfolio view; be honest about the AI-proposes/human-approves model.
- **Demo video** — the 20-min onboarding compressed to 3 minutes: connect → sync → AI categorizes →
  approve → reports + Ask AI. End on the portfolio view across two LLCs.
- **Outreach messaging** — "Want free AI bookkeeping that actually keeps a real double-entry ledger?
  Bring your own keys, own your data, $0." For business-owner relationships: lead with the pain
  (their books are a mess) and the 20-minute fix.
- **GitHub publication strategy** — clean history (no secrets/PII in any commit — scan first),
  clear LICENSE, CONTRIBUTING, the honest status table, issues labeled for the roadmap above, and a
  pinned "architecture" doc (this packet, trimmed).

---

## Appendix — How this packet was produced

11 codebase/live-database audit agents (each adversarially self-verifying its critical findings
against the code) + 6 web-research agents reverse-engineering QuickBooks/Xero/Stripe/Plaid, then
synthesized. Live figures read from the cloud dev deployment (entities Zikra & Z360). Every root
cause carries a file:line reference in the audit transcript. The adversarial pass corrected several
first-draft overreaches — most importantly: single-entity report scoping is **not a bug** (separate
LLCs legally need separate ledgers); the fix is an *additive* portfolio/consolidation layer, not
merging the books.
