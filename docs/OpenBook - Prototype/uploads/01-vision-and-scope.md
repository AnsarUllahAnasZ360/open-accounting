# Open Books — Vision & Scope (PRD v1)

> Free, open-source, AI-first accounting for small businesses. Real books, zero subscription, bring your own keys.

---

## 1. The Problem

A 1–20 person business today has three options for bookkeeping, and all of them are bad:

1. **Pay for software + an accountant** — QuickBooks ($38–$275/mo and rising 12–17%/yr) plus a bookkeeper easily totals $500–600/mo. Zeni starts at $494/mo. Digits at $100/mo.
2. **Do nothing** — most micro-businesses run on a bank app and a shoebox of receipts. They have no idea what their numbers look like until tax season panics them.
3. **Use a free tool that isn't accounting** — open-source invoicing apps (Crater), receipt parsers (TaxHacker), or pre-accounting tools (Midday, now being absorbed into Ramp) don't produce a real set of books an accountant can trust.

The structural shift that makes this solvable now: **AI does the bookkeeper's job** (categorize, match, reconcile, flag), and **the owner brings their own AI key** — so the marginal cost of intelligence drops to API pennies instead of a $500/mo service.

## 2. The Vision

**Open Books is the free, self-hosted, AI-native QuickBooks alternative.** It connects to your banks (Plaid) and payment gateways (Stripe), pulls every transaction automatically, and an AI agent — running on *your* model key — keeps your books correct with minimal input from you. When the AI is unsure, it asks you through an inbox. At any moment you can see exactly how your business is doing, and generate the three statements (P&L, Balance Sheet, Cash Flow) for any period.

One sentence: **"Connect your accounts, answer a few inbox questions a week, and your books are always done."**

### Product principles (the opinions in "opinionated")

1. **Double-entry under the hood, plain English on the surface.** Every transaction posts balanced journal entries so the Balance Sheet and Cash Flow are *correct*, not approximated — but the UI talks about "income," "expenses," and "categories," never "debits" and "credits" (unless you open the accountant drawer).
2. **Exception-driven bookkeeping.** The default state is automated. Humans only see what the AI couldn't resolve confidently. The Inbox is the only mandatory workflow.
3. **Bring your own everything.** Your Plaid key, your Stripe key, your LLM key (Anthropic/OpenAI/Google/Ollama/any OpenAI-compatible endpoint). Open Books never sits in the payment chain and can never rug-pull you (the Bench lesson: it shut down overnight in Dec 2024 with no data export).
4. **Two transaction concepts, not five.** QBO's Bills vs. Expenses vs. Checks confusion is collapsed: money already moved = a Transaction; money that will move = an Invoice (in) or a Bill (out).
5. **~30 categories, not 154 detail types.** A curated default chart of accounts per business type, with an escape hatch for accountants.
6. **Your data is a file you own.** Self-hosted Convex; full export (CSV/JSON + accountant-grade GL export) at all times.
7. **No payments upsell, no dark patterns.** QBO's UI is a payments-conversion funnel. Ours is a bookkeeping-accuracy tool.

## 3. Who It's For

| Persona | Situation | What they need |
|---|---|---|
| **Ansar (the multi-entity founder)** | Runs 2+ businesses; Stripe revenue; team paid manually across US/Pakistan/India; technically capable | One place for all entities; payout reconciliation; payroll register in multiple currencies; ask-the-books AI |
| **The freelancer/consultant** | Solo; 1 bank account + Stripe; no accountant | Auto-categorized books, simple invoicing, P&L for tax time |
| **The small service business (3–15 staff)** | An office manager does "the books" in spreadsheets | Bank feeds, AR/AP tracking, monthly statements the CPA accepts |
| **The accountant (secondary)** | Serves the above | GL/Trial Balance exports, journal entries, closed periods |

**Not for (v1):** inventory businesses, businesses needing sales-tax compliance engines, payroll *processing* (filing/payments), >50 employees, multi-entity consolidation reporting.

## 4. Scope

### v1 — The Core Loop (build this)

| Area | In v1 |
|---|---|
| **Workspace** | Multiple entities (businesses) per workspace; per-entity books, connections, base currency; entity switcher |
| **Connections** | Plaid (BYO keys, multiple banks, select accounts), Stripe (BYO restricted key, multiple accounts), CSV/OFX import fallback, BYO AI provider |
| **Ledger** | Hidden double-entry engine; seeded chart of accounts (~30 accounts, 5 types); journal entries (accountant drawer); period close (soft lock) |
| **Transactions** | Real-time sync; AI categorization pipeline (match → rules → memory → AI w/ confidence); splits; manual add; exclude; transfer detection |
| **Inbox** | Unified exception queue: low-confidence categorizations, unmatched receipts, payout mismatches, connection re-auth, AI questions; batch approve |
| **Rules** | User-defined rules (contains/exact on description/merchant, amount conditions, OR logic); "create rule from this" shortcut; AI proposes rules from your corrections |
| **Receipts** | Upload + forward-by-email; AI extraction (vendor, date, amount); embedding-based auto-match to transactions |
| **Stripe income** | Customer/charge sync for income attribution (who paid what); **payout reconciliation** — one bank deposit auto-split into gross revenue − fees via clearing account; Stripe invoices = AR |
| **Invoicing (AR)** | Create/send invoices through your Stripe account (hosted invoice page); statuses (draft/sent/paid/overdue); AR aging |
| **Bills (AP)** | Add bills manually or AI-extract from uploaded PDFs; due dates; mark paid → matches bank transaction; AP aging |
| **Contacts (Customers & Vendors)** | Lightweight directories (auto-created from Stripe/AI, editable); per-contact transaction history |
| **Payroll register** | Employees w/ salary + currency (PKR/INR/USD/any); monthly payroll runs; statement view (per-currency + base-currency totals); posts payroll expense entries; matches outgoing bank payments. **No filing, no payments processing.** |
| **Dashboard** | Cash position, P&L snapshot, income vs. expense trend, expense donut, income by customer, AR/AP summary, invoice funnel, payroll widget, business activity feed, inbox count |
| **AI chat** | Collapsible right-side panel; ask-your-books (tool-calling over ledger/reports); propose-and-confirm actions (categorize, create rule, draft invoice) |
| **Reports** | Monthly Review (one-page month: income & who paid, owed to you, you owe, expenses, payroll), P&L, Balance Sheet, Cash Flow Statement, AR Aging, AP Aging, Expenses by Vendor/Category, Income by Customer, Payroll Summary, General Ledger, Trial Balance, Journal — any date range, monthly comparison columns, cash/accrual toggle, CSV/PDF export |
| **Settings** | Entities, connections + keys, AI provider config + autonomy level, categories/CoA editor, rules manager, team members (owner/staff/accountant-readonly), export |

### v2+ — Explicitly Later

Budgets & cash-flow forecasting (90-day planner) · payroll automation (payment initiation) · sales tax · 1099/tax prep packets · estimates/quotes · inventory · time tracking · CRM/contract management · consolidated multi-entity reports · accountant tools (bulk reclassify, write-offs) · mobile apps · hosted cloud offering.

### Never (anti-scope)

Becoming a payment processor · payroll tax filing · a full ERP · ads/upsells inside the product.

## 5. Competitive Positioning

| | Open Books | QBO | Midday (†Ramp) | Bigcapital | Puzzle | Digits |
|---|---|---|---|---|---|---|
| Real double-entry ledger | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| Bank sync | ✅ BYO Plaid | ✅ | ✅ | ❌ | partial | ✅ |
| Stripe payout reconciliation | ✅ | partial | ❌ | ❌ | ✅ best | ✅ |
| AI categorization + inbox | ✅ BYO model | ✅ | ✅ | ❌ | ✅ | ✅ |
| Ask-your-books chat | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Open source | ✅ | ❌ | AGPL (defunct) | AGPL | ❌ | ❌ |
| Self-hosted, own your data | ✅ | ❌ | hard | ✅ | ❌ | ❌ |
| Price | **$0 + API pennies** | $38–275/mo | — | $0 | $0–200/mo | $100+/mo |

**The unique slot:** nobody combines *real ledger + bank sync + AI + open source + self-host*. Midday's wind-down (May 2026) leaves 14k GitHub stars of demand looking for a home.

## 6. Success Metrics

**Product KPIs (per install):**
- **Automation rate**: % of transactions booked with zero human touch (target ≥ 85% after 60 days, vs. Digits' 96.5% benchmark)
- **Inbox time**: median minutes/week resolving inbox (target < 15 min)
- **Books freshness**: days since oldest unreviewed transaction (target ≤ 7)
- **Time-to-first-value**: connect → first auto-categorized dashboard (target < 15 min)
- **Categorization acceptance**: % AI suggestions accepted unedited (target ≥ 90%)
- **Reconciliation integrity**: clearing-account drift = $0 after every payout cycle; trial balance always balances (hard invariant)

**Project KPIs:** GitHub stars, Docker pulls, monthly active self-hosted instances (opt-in telemetry), community contributors, "my CPA accepted the export" testimonials.

## 7. Why We Win

1. **Timing** — Midday is gone, Bench burned trust, QBO raised prices 50–83% in 5 years, and LLM costs collapsed.
2. **Architecture** — BYO keys means $0 COGS for us and no vendor lock-in for users; AGPL keeps it open.
3. **Opinionation** — we ship the 20% of QBO that 95% of small businesses use, with AI replacing the rest.
4. **Trust primitive** — double-entry + immutable audit trail means the output is *accountant-grade*, not a toy.

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Plaid cost/complexity for individual self-hosters | Free trial/limited-production tiers; SimpleFIN ($15/yr) + Teller adapters; CSV/OFX always works; provider abstraction layer from day one |
| AI mis-categorization corrupts books | Confidence thresholds; everything reversible; immutable journal (corrections are new entries, never edits); audit log |
| Convex self-host operational burden | One Docker Compose; pin versions; documented upgrade path; data export safety net |
| Scope creep into ERP | Anti-scope list above is part of the README; "opinionated" is the brand |
| Solo-maintainer burnout | v1 cut ruthlessly; phased build plan (doc 04); community after v1, not before |
