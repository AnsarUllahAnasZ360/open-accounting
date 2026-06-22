# R6 — No-Login Shared Demo, AI-CFO Advisory, Weekly Digest, Tax Set-Aside

Research lane: **R6-demo-cfo-tax**. Resolves Ansar decision #14 (single shared
no-login demo workspace) and the AI-CFO / weekly-digest / tax-set-aside scope
from the launch sprint. This document is decision-oriented: it gives the
specific values OpenBooks should adopt, not a survey.

Date: 2026-06-17. Author: research subagent.

---

## 1. Recommended decisions (adopt these)

### A. No-login shared demo workspace (Convex + Convex Auth)

- **One real, persistent workspace row** (`workspaces` table) flagged
  `isDemo: true` with a stable, well-known id/slug (e.g. `demo`). NOT a
  per-visitor clone, NOT an in-memory fixture. Matches decision #14.
- **No anonymous Convex Auth identity for the demo.** Do not turn on the
  `Anonymous` auth provider just to power the demo — it lets any client write to
  the DB and is an abuse surface. Instead serve the demo to *truly
  unauthenticated* users and resolve the demo workspace by slug on the server.
- **Server-side write guard is the security boundary, not the UI.** Every
  mutation/action must, on the server, refuse writes when
  `workspace.isDemo === true` (throw `ConvexError({ kind: "demo_read_only" })`).
  Hiding buttons in the client is UX only; Convex endpoints are a public API.
- **Demo reads bypass the normal "must be a workspace member" check** via one
  explicit branch: if `workspaceId` resolves to the demo workspace, allow read
  without auth; otherwise require `getAuthUserId` + membership. Keep this branch
  in a single shared `requireWorkspaceRead(ctx, workspaceId)` helper so it can't
  drift across functions.
- **Isolation from real workspaces is structural**, because OpenBooks already
  scopes every row by `workspaceId` (single-entity ledgers, per the accounting
  diagnosis). The demo is just another `workspaceId`; real-workspace reads never
  match it. No cross-tenant query can leak because the guard keys on the id.
- **Scheduled daily reset + reseed** via a Convex cron calling an
  `internalMutation`: delete all rows where `workspaceId === demoWorkspaceId`,
  then re-seed the canonical demo fixture (Zikra-style sample books with posted
  journal entries, a few inbox items, invoices/bills, one connected-looking
  bank/Stripe). Run at a low-traffic UTC hour (recommend **08:00 UTC daily**).
  Make reset idempotent and self-contained (it must create the workspace row if
  a prior run or a rogue delete removed it).
- **Demo seed must be fully synthetic** — no real Plaid/Stripe tokens, no real
  customer PII, no live keys. The demo never holds a credential row.
- **Rate-limit / abuse**: because there are no demo writes at all, the attack
  surface is just reads; add basic per-IP rate limiting at the HTTP/edge layer
  rather than CAPTCHA. (CAPTCHA is only needed if you *do* allow anonymous
  writes, which we explicitly don't.)
- **Optional polish**: let a demo visitor "try an action" by capturing the
  intended write and showing the optimistic result in client state only, with a
  banner "This is a read-only demo — sign up to keep changes." Never persist.

### B. AI-CFO / financial advisor (what it computes)

Adopt this metric set, all computed **from journal lines** (the system of
record), USD-only per decision #3, scoped to the single entity with a portfolio
roll-up that eliminates intercompany (decision #6):

- **Cash position** — sum of cash/bank asset accounts, today.
- **Net burn (monthly)** — trailing operating cash outflow minus inflow,
  averaged over the trailing 3 months (use 3-month average, not last month, to
  de-noise).
- **Runway (months)** = current cash ÷ average monthly net burn. Show "∞ /
  profitable" when net burn ≤ 0. This is the headline number.
- **Revenue by stream** — income grouped by income account / source (Stripe,
  invoices, other), period over period.
- **Expense creep** — per expense category, this month vs trailing-3-month
  average; flag categories up **≥ 25%** AND ≥ a material absolute floor (e.g.
  ≥ $200) so tiny categories don't spam.
- **Customer concentration** — top customer as % of trailing-12-mo revenue;
  flag when **top customer > 10%** of revenue or **top 5 > 25%** (standard
  rule-of-thumb red flags from valuation/credit practice).
- **AR / AP aging & "coming up"** — overdue invoices owed to you, bills due in
  the next 7–14 days, and the resulting projected cash dip.
- **Duplicate / anomaly detection** — same amount + same vendor + near-same date
  (suggests double payment); a single charge that is a large multiple of that
  vendor's historical norm; a brand-new vendor with an unusually large first
  charge. Surface as *review prompts*, never auto-actions.
- **Simple cash-flow forecast** — 13-week (one quarter) running-balance
  projection from known recurring inflows/outflows + open AR/AP, presented as a
  trend line with a low/expected band. Label clearly as an estimate.
- **Tax set-aside reserve** — see section C; show as a recommended "money to
  park" number, not a liability posting.

**Legal framing (critical):** OpenBooks is **bookkeeping software**, not an
investment adviser and not a tax preparer. The Investment Advisers Act of 1940
governs *securities* advice; computing burn/runway/concentration from a
business's own ledger is business analytics, not securities advice, so the
adviser-registration risk does not attach **as long as we don't recommend buying
/ selling securities or managing investments.** Mitigate the remaining risk with
disclaimers and framing:

- Frame every insight as **observational/informational** ("Your marketing spend
  is up 32% vs your 3-month average"), not directive ("You should cut
  marketing").
- Persistent footer on AI-CFO surfaces and the digest:
  *"OpenBooks insights are generated from your books for informational purposes
  only and are not financial, investment, legal, or tax advice. Consult a
  qualified professional before making decisions."*
- **Never claim accuracy/guarantees** and never imply a fiduciary relationship.
  (The SEC has pursued firms for *over*-claiming AI capability — keep marketing
  truthful: say what it does, don't oversell.)
- Keep AI in the **"propose, never post"** lane that OpenBooks already enforces
  for the ledger — the same discipline that protects the books protects us here.

### C. Weekly plain-English digest (what it contains)

A once-weekly email (Plunk, workspace-scoped per decision #10), <1 screen,
plain English, no jargon. Recommended sections, in order:

1. **One-line headline** — e.g. "You ended the week with $42,180 in cash, up
   $3,400." (cash position + week-over-week delta)
2. **Runway** — "At your current burn (~$11k/mo) that's about 3.8 months."
   (omit if profitable; instead say "You were cash-flow positive this week.")
3. **Money in / money out this week** — two numbers + biggest single item each.
4. **Coming up (next 14 days)** — bills due + their total; invoices you're owed
   (and any overdue).
5. **Worth a look** — at most 2–3 flags: an expense-creep category, a possible
   duplicate, a concentration warning, or "3 transactions need your review in
   the Inbox." Link straight to the Inbox.
6. **Tax set-aside nudge** — running recommended reserve, and a reminder when a
   quarterly estimate deadline is within ~30 days.
7. **Footer disclaimer** (the "not advice" line above).

Tone: a sharp bookkeeper texting the owner — specific numbers, no lecture, every
item links to the exact screen. Make frequency configurable (weekly default,
opt to monthly). Send on **Monday morning local-ish (recommend 13:00 UTC)** so
it lands before the week starts.

### D. Tax set-aside estimate (US LLC solopreneur)

- **Default set-aside rate: 30% of net profit (net income).** This is the safe,
  widely-recommended rule of thumb (sources cluster at 25–30%; pick the top of
  the band so the owner is rarely *short*). Make it a single configurable
  workspace setting `taxSetAsidePct` defaulting to `0.30`.
- **What "net profit" means here**: trailing book net income (revenue − expenses)
  for the period, USD. Reserve = `max(0, netProfit) * taxSetAsidePct`,
  accumulated and shown as "money to park for taxes," reset/awareness-tracked
  per tax year.
- **Why 30% is sound for a single-member LLC (disregarded entity / Schedule C):**
  the owner owes **self-employment tax of 15.3%** (12.4% Social Security +
  2.9% Medicare) on **92.35%** of net SE earnings, i.e. ~**14.13%** effective,
  **plus** federal income tax at their marginal bracket (often 10–24% for
  solopreneurs), minus the deduction for one-half of SE tax. 30% comfortably
  covers federal SE + a typical income bracket; it does **not** include state
  income tax, so expose the % as configurable for higher-tax states.
- **Quarterly framing (informational only):** if the owner expects to owe
  **≥ $1,000** for the year, the IRS expects **quarterly estimated payments**
  (Form 1040-ES) on **Apr 15, Jun 15, Sep 15, and Jan 15** (next year).
  Surface the next deadline as a countdown; suggest the payment ≈ accumulated
  reserve ÷ remaining quarters, or 25% of the projected annual reserve.
- **Safe-harbor note (display as "you generally avoid a penalty if…"):** pay the
  lesser of **90% of this year's tax** or **100% of last year's tax** (**110%**
  if prior-year AGI > $150k). Use this only as explanatory copy; don't compute
  the owner's prior-year AGI for them.
- **Mandatory disclaimer** wherever the number appears:
  *"This is an automated estimate for planning only and is not tax advice.
  Actual taxes depend on your full situation, deductions, entity election, and
  state. Consult a tax professional or use Form 1040-ES."*
- **Do not** attempt: S-corp election math, state tax, multi-member partnership
  allocations, or sales tax. Out of scope; the 30% planning reserve is the
  product.

---

## 2. Rationale

**Demo:** Decision #14 is explicit — one shared workspace, no login. The cleanest
way to honor that in Convex without inventing a parallel data path is to make the
demo *just another workspaceId* that already flows through OpenBooks' existing
per-workspace scoping. The only new primitives are (a) a server-side
`isDemo → read-only` guard and (b) a daily reset cron. Turning on Convex Auth's
`Anonymous` provider would be the wrong tool: its documented purpose is letting
unauthenticated clients **write** (carts, drafts) and it explicitly opens a write
surface that "could be abused by malicious actors" requiring CAPTCHA. We want the
opposite — zero demo writes — so we skip anonymous identity entirely and gate on
the workspace flag. This also keeps real workspaces structurally isolated: the
guard keys on the id, and no real-workspace query can resolve to the demo id.

**AI-CFO:** The market leaders converge on the same headline metrics. Puzzle
computes **burn = net cash outflow** and **runway = cash ÷ average burn**,
updated continuously, plus a "Spotlight" for significant changes — exactly the
runway/burn/variance core recommended above. Digits runs a 24/7 agent that
**categorizes, detects anomalies, and answers natural-language questions** like
"how much did we spend on marketing in Q3 vs Q2" — i.e. expense-trend and
anomaly surfacing grounded in reconciled books. Fathom packages **three-way
forecasts and management-report narratives**. Computing these from journal lines
(not ad-hoc category sums) matches OpenBooks' North Star ("Reports query journal
lines"). The 10%/25% concentration thresholds are the standard
valuation/credit-risk rule of thumb. The legal framing matters because AI +
"financial advisor" wording can attract scrutiny; the protective move is to stay
informational, disclaim, and never touch securities advice — the Advisers Act
simply doesn't reach business-analytics-on-your-own-ledger.

**Digest:** Weekly cash check-ins (vs waiting for month-end) are the consistently
recommended cadence for SMBs with any cash tightness. The canonical weekly cash
report = **bank balances + unpaid bills + cash available to spend**, plus AR
follow-up — which maps directly to the section list above. Keeping it to one
screen with deep links matches the "plain English owner experience" North Star.

**Tax:** 30% is the conservative end of the universally cited 25–30% rule. It is
defensible from first principles: SE tax alone is ~14.13% effective
(15.3% × 92.35%), and federal income tax for a typical solopreneur lands in the
10–24% brackets, so 30% covers federal in most cases while leaving the % editable
for state and higher brackets. The $1,000 threshold, the four 1040-ES dates, and
the 90%/100%/110% safe harbor are the actual IRS rules and are stable enough to
hard-code as informational copy (with the dates derived per tax year). Framing as
a "reserve to park," not a posted liability, keeps us out of giving tax advice
and out of mis-stating the ledger.

---

## 3. How QBO / Stripe / Plaid / industry does it

- **QuickBooks Self-Employed** estimates federal tax from self-employed income −
  deductions − expenses to get profit, applies SE + income tax, and tracks
  quarterly estimates and the four 1040-ES deadlines; the product itself frames
  output as estimates and routes users to pay 1040-ES. The common owner guidance
  it reflects is the **25–30% set-aside** rule and the safe-harbor "100% of last
  year / 110% over $150k AGI" rule.
- **Puzzle.io** — burn = net cash outflow; runway = cash ÷ average burn; both
  real-time; "Spotlight" flags significant changes; native Stripe/Mercury/Ramp/
  Gusto ingestion so the metrics sit on clean source data.
- **Digits** — AI accounting agent categorizes 24/7, **detects anomalies**,
  learns vendor/spend patterns, answers NL questions about burn / vendor spend /
  cash position grounded in reconciled books; exposes an MCP server for board
  reports, investor updates, and anomaly detection.
- **Fathom / Lucid / Fuelfinance** — three-way (P&L + balance sheet + cash flow)
  forecasts, variance alerts, runway/burn dashboards, management-report
  narratives; the category positions AI forecasting at ~92–97% precision vs
  60–70% for spreadsheets (their numbers, treat as marketing).
- **Bench / accounting blogs** — standard disclaimer pattern: *"for informational
  purposes only and does not constitute legal, business, or tax advice; consult
  your own attorney, business advisor, or tax advisor,"* with an explicit
  liability disclaimer. This is the exact tone OpenBooks should mirror.
- **Convex** — `Anonymous` auth provider exists for unauthenticated *writes* and
  warns it opens an abuse surface (recommend hCaptcha/Turnstile); authorization
  best practice is **server-side checks in every function**, with
  `customQuery`/`customMutation` wrappers and optional `RowLevelSecurity` as
  defense-in-depth — UI gating is never sufficient. Cron jobs
  (`crons.daily({ hourUTC, minuteUTC }, internal.module.fn)`) drive the daily
  demo reset via an internal mutation.
- **Customer concentration (valuation/credit industry)** — single customer
  > 10% of revenue, or top 5 > 25%, are the standard red-flag thresholds.

---

## 4. Citations (URLs)

Convex / demo / scheduling:
- https://docs.convex.dev/auth — Authentication overview (server-side checks)
- https://stack.convex.dev/authorization — Authorization best practices, customQuery/customMutation, RowLevelSecurity, "hiding UI won't protect endpoints"
- https://labs.convex.dev/auth/config/anonymous — Anonymous users: how they work, write-abuse risk, CAPTCHA mitigation
- https://stack.convex.dev/anonymous-users-via-sessions — Anonymous via sessions
- https://docs.convex.dev/scheduling/cron-jobs — crons.daily/weekly/interval, hourUTC/minuteUTC, referencing internal functions
- https://docs.convex.dev/scheduling/scheduled-functions — scheduler.runAfter
- https://docs.convex.dev/functions/internal-functions — internalMutation/internalAction

AI-CFO / advisory patterns:
- https://puzzle.io/product — burn/runway/Spotlight, real-time metrics
- https://puzzle.io/blog/real-time-financial-reporting-tools-founders — runway = cash ÷ average burn
- https://www.cpapracticeadvisor.com/2026/04/22/digits-mcp-server-connects-real-time-financial-data-with-the-ai-tools-accounting-firms-use/182038/ — Digits agent: anomaly detection, board/investor reports
- https://www.pymnts.com/back-office/2025/digits-debuts-ai-accounting-tool-and-welcomes-xero-co-founder/ — Digits AI accounting
- https://www.lucid.now/blog/ai-anomaly-detection-use-cases-finance/ — anomaly/duplicate detection use cases
- https://www.metrichq.org/saas/customer-concentration/ — customer concentration metric
- https://www.wallstreetprep.com/knowledge/customer-concentration/ — concentration formula + thresholds
- https://beancount.io/blog/2026/05/11/customer-concentration-risk-10-percent-revenue-threshold-business-valuation-loan-capacity-negotiating-leverage-guide — 10% / top-5 25% red-flag rule

Legal framing / "not advice":
- https://www.bench.co/blog/accounting/quickbooks-alternatives — Bench "informational purposes only … not legal, business, or tax advice; consult your own advisor" disclaimer
- https://www.mofo.com/resources/insights/251015-ai-compliance-tips-for-advisers — AI + Investment Advisers Act framing
- https://www.kitces.com/blog/artificial-intelligence-compliance-considerations-investment-advisers-sec-securities-exchange-commission-legal-regulation-framework/ — SEC applies 1940 Act, no AI-specific rules; over-claiming risk

Weekly digest content:
- https://relayfi.com/blog/9-financial-reports-every-owner-needs/ — weekly cash report = balances + unpaid bills + cash available
- https://www.fylehq.com/blog/maintaining-books-a-daily-weekly-monthly-accounting-checklist — weekly reconcile + AR follow-up cadence

Tax set-aside / IRS:
- https://www.irs.gov/businesses/small-businesses-self-employed/self-employed-individuals-tax-center — SE tax + income tax; Form 1040-ES, Schedule C, Schedule SE
- https://www.irs.gov/taxtopics/tc554 — 15.3% (12.4% SS + 2.9% Medicare), 92.35% multiplier, $400 threshold, +0.9% Medicare, half-SE-tax deduction
- https://www.irs.gov/pub/irs-pdf/f1040es.pdf — 2026 Form 1040-ES (estimated tax, dates)
- https://relayfi.com/blog/single-member-llc-quarterly-taxes/ — single-member LLC quarterly guide
- https://venturesmarter.com/how-much-should-i-set-aside-for-taxes/ — 25–30% set-aside rule
- https://quickbooks.intuit.com/r/taxes/sole-proprietorship-taxes/ — QBO sole-proprietor tax overview
- https://quickbooks.intuit.com/learn-support/en-us/help-article/self-employment-taxes/automatically-estimate-income-tax-quickbooks/L6x4NvAW8_US_en_US — QBSE auto income-tax estimate
- https://www.kiplinger.com/taxes/tax-deadline/602538/when-estimated-tax-payments-due — 2026 quarterly due dates + safe harbor
