# How OpenBooks Works — Owner's One-Pager

For: Ansar · Updated: 2026-06-12 (finishing branch reality check)

OpenBooks keeps a real set of double-entry books for each of your businesses
while you only ever deal with plain English. The one rule that governs
everything: **AI proposes. The ledger engine posts.** Every number you see on
any screen is derived from balanced journal entries — never from ad-hoc
category math — which is why the reports always reconcile.

## Running it locally

1. `pnpm install` once, then `pnpm setup` (writes `.env.local`, mints the auth
   keypair + encryption key), then `npx convex dev --once` to link your own
   Convex dev deployment, then `pnpm dev:full`. `pnpm dev:full` auto-runs setup
   if `.env.local` is incomplete, pushes/watches your cloud Convex dev
   deployment, starts the local web app, seeds the demo books if needed, and
   prints the URL. (Full self-host walkthrough: `docs/self-host/`.)
2. Open the URL → click **"Continue as owner (dev)"** on the sign-in page.
   That button only exists in localhost dev mode. In normal auth mode, a new
   owner can start a first workspace through onboarding, and teammates join
   through invite links.
3. You land on the Dashboard of **Acme Studio LLC** — a demo business with
   12 months of internally consistent books (currently 924 transactions after
   the finishing verification flows, invoices,
   bills, payroll in USD/PKR/INR, Stripe-style payouts, receipts, open inbox
   items). The trial balance is exactly zero; a hand-computed May 2026 was
   verified to the cent. Use it to explore every feature with realistic data.
   Settings → Data can reset it to factory state at any time.

## Setting up a real business (the 15-minute path)

1. **Create the business** — onboarding asks the name, the kind of business
   (services / software / e-commerce / agency), and the base currency, then
   seeds ~30 sensible categories. Categories *are* accounts in the hidden
   ledger; you'll never see a debit unless you open accountant mode.
2. **Connect AI** — Settings → AI. The brain runs on your own key (AWS
   Bedrock today; the registry supports others). Pick the autonomy level:
   **Suggest** (AI never posts anything itself), **Balanced** (auto-posts
   when ≥90% confident — recommended), **Autopilot** (≥75%). Skip it and
   everything still works manually — AI is an enhancer, not a dependency.
3. **Connect a bank** — Settings → Connections → Connect bank. The branch has
   the real Plaid Link client, token exchange, item cursor state, webhooks,
   4-hour sync cron, and manual **Sync now** path. A completed hosted sandbox
   Link session still needs to be run to upgrade this from PARTIAL to WORKING.
   No keys or no session? Import a CSV instead — same pipeline.
4. **Connect Stripe** — the test-mode sync code handles webhooks, customers,
   charges, invoices, payouts, fees, and payout-line drill-downs. It still
   needs a real Stripe CLI/Dashboard test webhook delivered to the cloud route
   before the Stripe acceptance row can be called WORKING.

## How money flows in (what happens without you)

Every transaction that arrives — from Plaid, Stripe, or CSV — runs a cascade,
cheapest signal first: is it a **transfer** between your own accounts? does it
**match** an open invoice/bill/payroll/expected payout? does a **rule** you
made claim it? does **memory** recognize it (the AI remembers every correction
you've ever made via embeddings)? finally, the **LLM** categorizes it with a
confidence score and reasoning. Confident results post to the ledger
automatically and show up attributed ("Categorized by AI · 96%"); everything
else becomes an **Inbox** card. The honest H3 eval is now 45/60 correct
(75.0%) on a label-safe holdout, below the 80% target; the safe behavior is
that uncertain income rows go to review rather than pretending to be posted
correctly.

The Inbox is your only mandatory job: a few cards a week — confirm a category
(Enter), correct it (which teaches the memory, and after three identical
corrections the AI drafts a rule for you), match a receipt, approve a
transfer, fix a payout mismatch, reconnect a bank, or answer a free-form AI
question. Batch-confirm handles the pile at once. Inbox zero = your books are
done.

**Stripe payouts** get the signature treatment: each charge books as gross
revenue attributed to the customer, fees book as their own expense, and when
the lump-sum deposit lands in the bank it's matched against the clearing
account — so revenue is never understated and fees are never invisible. If
the math doesn't add up, you get an Inbox card with the itemized difference.

## The screens

- **Dashboard** — cash position with sparkline, P&L snapshot, money owed to
  you / by you, expense donut, income by customer, cash flow, payroll,
  activity feed. Every number clicks through to its source.
- **Transactions** — the full register: filter, search, split, exclude,
  recategorize (which never edits history — it reverses and reposts, so the
  audit trail is bulletproof), and an accounting view drawer for the curious.
- **Income** — money in: payments received (bank + Stripe), your invoices
  (create → Stripe hosts the payment page and emails the customer), and
  receivables aging by customer.
- **Expenses** — where money goes: by category and vendor with
  month-over-month movement, plus detected **recurring** spend (your
  subscriptions, with next expected dates). Adding a category here creates a
  real account in the books.
- **Bills** — money you owe: add manually or upload PDF/text/image receipts;
  due-window groups; "mark paid" settles bills; unmatched receipts can create a
  balanced manual expense. True first-page PDF raster-to-Bedrock vision remains
  a named gap.
- **Contacts** — customers and vendors, auto-created from Stripe and from
  AI vendor-normalization, with full per-contact history and balances.
- **Payroll** — employees in any currency (USD/PKR/INR/…); monthly runs:
  open a run → adjust amounts → approve (books the expense) → mark paid
  (settles against the outgoing bank transfers, FX differences handled) →
  printable per-currency statement.
- **Reports** — a home grid of eleven reports in plain English. **Monthly
  Review** is your one-page month: what came in and who paid, what you're
  owed, what you owe, where money went, payroll — printable. P&L, Balance
  Sheet (always "Balanced ✓"), Cash Flow, AR/AP aging, expenses, income by
  customer, payroll summary, and the accountant set (General Ledger, Trial
  Balance, Journal). Any date range, compare to prior period/year, cash ⇄
  accrual toggle, CSV export that matches the screen, and click any number
  to see the transactions behind it.
- **Ask AI** (⌘J) — a docked panel, mobile sheet, or full page over your books. Ask
  "How did we do last month vs before?", "Who owes me money?", "Top 5
  expenses this quarter?" — it reads the same ledger the reports do and
  answers with formatted tables and links into the real reports.
  Conversations are saved as threads. When you ask it to *do* something —
  categorize, create a rule, draft an invoice, add a bill, post a journal
  entry — it shows a confirmation card; nothing touches the books until you
  click confirm, and the audit log records that the AI proposed it and you
  approved it.
- **Settings** — ten sections: Businesses (add/archive entities), Tax &
  fiscal year, Connections, AI (provider, models, autonomy, spend, batch/eval
  history),
  Categories, Rules (ordered, testable against your last 90 days),
  Notifications, Team (invite by email: Owner / Staff / Accountant
  read-only), Data (full export — your books are a file you own), and the
  Audit log — who or what did everything, and why.

## What to test, in order

1. Dev sign-in → Dashboard numbers → click three tiles, confirm each lands
   on the right filtered view with matching totals.
2. Inbox: use existing evidence for receipt cards and import-triggered AI
   batches today; general keyboard/batch acceptance still needs the H2 pack.
3. Transactions: use the disposable-business H1 flow for recategorize,
   reverse + repost evidence, split, CSV import, and mobile no-scroll proof.
4. Income: create an invoice draft and finalize it in unit/e2e evidence. Bills:
   mark one paid in the verified bill flow; live Stripe-hosted invoice proof is
   still pending external Stripe webhook/setup proof.
5. Payroll: open a run → approve → mark paid → print the statement.
6. Reports: Monthly Review for May 2026 → P&L → toggle cash/accrual →
   drill into source lines. CSV==screen equality is still an H2 follow-up.
7. Ask AI the five flagship questions; then ask it to categorize something
   and confirm the card; check Settings → Audit log attributes it to AI.
8. Settings → Businesses → add a test business → switch to it. For Plaid,
   complete a hosted sandbox Link session and then run Sync now; until that
   outside proof lands, Plaid remains PARTIAL even though the code path exists.
9. Repeat the core four (Dashboard, Inbox, Transactions, Ask AI) on your
   phone.

When something feels off, say which step and what you expected — every step
above maps to a test in the suite, so feedback turns into a failing test
before it turns into a fix.
