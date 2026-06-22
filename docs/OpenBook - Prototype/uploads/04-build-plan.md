# Open Books — Build Plan & Execution Workflow (v1)

How you'll work: you (Ansar) own vision, decisions, and verification; Claude Code/Cursor owns implementation. Each phase below ends with a **demo you can see** and a **verification checklist you can run without reading code**. Feed the per-phase prompt to Claude Code; it references docs 01–03 (keep all four docs in the repo at `/docs`).

**Repo setup first:** create the repo with `/docs/01..04`, plus `CLAUDE.md` containing: stack (Next.js App Router, self-hosted Convex, AI SDK v6, shadcn/ui, Tailwind), conventions (TypeScript strict, Convex functions in `/convex`, all money as integer minor-units + currency code, never floats), invariants (journal entries must balance; posted entries immutable — corrections reverse+repost; all external API calls in Convex actions; all keys encrypted, never client-side), and "read /docs before any feature work."

---

## Phase 0 — Skeleton & Design System Port (≈ week 1)

**Goal:** running app shell with auth, the sidebar/topbar/AI-drawer layout from doc 03 §0, design tokens from your Claude Design system, Docker Compose for self-hosted Convex, seed script.
**Prompt to Claude Code:**
> Scaffold Open Books per /docs/02 §7 (workspace tables), §9 (onboarding) and /docs/03 §0, §11. Next.js App Router + Convex (configure for self-hosted via Docker Compose: app, convex backend, convex dashboard) + shadcn/ui + Tailwind with our design tokens. Build the app shell: collapsible left sidebar (Dashboard, Inbox, Transactions, Invoices, Bills, Contacts, Payroll, Reports, Settings), entity switcher stub, top bar with ⌘K stub and Ask AI button, collapsible right chat drawer (empty). Convex Auth email/password. Create workspace/entity/user tables + onboarding step 1 (name business, pick type, base currency). Add a deterministic demo-data seed script (2 entities, 3 bank accounts, 400 realistic transactions over 6 months, 10 contacts, 5 invoices, 4 bills, 6 employees in 3 currencies) — this powers every later demo.
**You verify:** `docker compose up` works clean; sign up; create entity; click every nav item (empty pages fine); shell matches design.

## Phase 1 — Ledger Core (≈ week 2) ← the foundation, do not rush

**Goal:** the hidden double-entry engine per doc 02 §2 + §7.
**Prompt:**
> Implement the ledger core per /docs/02 §2 and §7: ledgerAccounts, journalEntries, journalLines tables; CoA seeding by business type; a single `postEntry` mutation enforcing Σdebits=Σcredits (reject otherwise) and immutability (reposting = reversal entry + new entry, linked); period soft-lock; auditLog on every post. Build accountant-drawer screens under Settings → Accounting: CoA editor (friendly + accountant modes per /docs/03 §10), manual journal entry form, General Ledger and Trial Balance views. Write thorough unit tests: balance invariant, reversal flow, lock behavior, trial balance always balances. Property-test: random entry sequences never unbalance the trial balance.
**You verify:** tests green; in the UI create a manual journal entry, see it in GL; Trial Balance shows 0 difference; try to backdate into a locked period → warning.

## Phase 2 — Transactions, Import & Pipeline-without-AI (≈ weeks 3–4)

**Goal:** transaction register + CSV import + rules engine + transfer detection — the whole pipeline except LLM stages, running on seed/CSV data.
**Prompt:**
> Implement transactions table + register UI per /docs/03 §3 (filters, status tabs, inline category edit, splits, exclude, bulk, drawer with Accounting view). CSV/OFX import wizard with column mapper. Categorization pipeline stages 1–3 per /docs/02 §4: dedupe/transfer detection, record-match stub, rules engine (conditions incl. OR groups, ordered, first-match-wins, auto-post flag, hit counts) + Rules manager UI per /docs/03 §10 incl. "test against last 90 days" preview. Categorizing a transaction must post the correct journal entry via postEntry; recategorizing reverses+reposts. Inbox v1: categorize cards + transfer cards per /docs/03 §2 with batch confirm + keyboard nav.
**You verify:** import a real bank CSV; make a rule ("contains UBER → Travel"), see it fire; recategorize something and check the audit trail shows reversal; Inbox batch-confirm works; P&L spot-check next phase.

## Phase 3 — AI Layer (≈ weeks 5–6)

**Goal:** BYO-AI config, LLM categorization (stages 4–6), embeddings memory, Inbox completion, autonomy dial.
**Prompt:**
> Implement aiConfig + Settings → AI per /docs/03 §10 (provider registry via AI SDK v6 + createOpenAICompatible, runtime instantiation from encrypted DB config, test-connection, model pickers, autonomy radio, spend meter). Pipeline stages 4–6 per /docs/02 §4: embedding memory via Convex vector search; LLM batch categorization with structured output `{categoryId, confidence, reasoning, needsHuman, question}`; routing by autonomy threshold; corrections write embeddings + after 3 identical corrections AI drafts a rule (lands in Rules manager pending approval). Complete Inbox card types: AI question cards, confidence rings, reasoning popovers. Degraded mode: no key → stages 1–3 only, UI hints. Add an eval harness: 200 labeled seed transactions, report categorization accuracy on every run.
**You verify:** paste your Anthropic key, run sync over seed data, watch automation rate in the eval harness (target ≥80% on seed set); correct one AI mistake 3× → it proposes a rule; flip autonomy modes and observe routing change.

## Phase 4 — Plaid + Stripe (≈ weeks 7–9) ← integration-heavy, use sandbox modes

**Goal:** real money data. Plaid Link + sync; Stripe sync + the payout reconciliation engine; invoices.
**Prompt (split into 4 sessions):**
> (a) Plaid per /docs/02 §3.1: BYO-keys settings flow, Link, account selection, ledger-account auto-creation, `/transactions/sync` cursor handling incl. removed-array pending→posted carry-over, 4h crons + manual sync, ITEM_LOGIN_REQUIRED → Inbox connection card → update-mode relink, personal_finance_category prior into pipeline stage 5. Test fully against Plaid Sandbox.
> (b) Stripe sync per /docs/02 §3.2: restricted-key setup w/ key-permission validation, customers→contacts, charges→income transactions with attribution, multiple accounts.
> (c) Payout reconciliation per /docs/02 §5.1: clearing accounts, gross/fee/payout postings from balance_transactions, bank-deposit auto-match, $0-drift invariant, mismatch → Inbox card, payout drill-down UI. Test against Stripe test mode with multi-charge payouts incl. refunds.
> (d) Invoicing per /docs/02 §6.3 + /docs/03 §4: composer → Stripe invoice create/finalize/send, status sync, AR postings, receivables aging view.
**You verify (sandbox):** connect Plaid sandbox bank → transactions flow through full pipeline; create test charges + payout in Stripe test mode → see one deposit split into gross/fees in the payout drill-down, clearing at $0; send yourself a test invoice and pay it → AR clears end-to-end.

## Phase 5 — Bills, Receipts, Contacts, Payroll (≈ weeks 10–11)

**Prompt:**
> Implement per /docs/02 §5.2, §6.4–6.6 and /docs/03 §5–7: documents table + upload + email-in stub; AI extraction (vision) for receipts/bills with confidence-underlined review form; embedding+heuristic receipt→transaction matching with three-tier routing; Bills module with AP postings and mark-paid→bank-match; Contacts directory with auto-creation, vendor normalization, merge flow, default-category-as-rule; Payroll module: employees, runs grid with per-line adjustments + FX rates + base conversion, approve→post payroll entries, paid-line→bank-transaction settlement with FX gain/loss line, statement view with PDF export.
**You verify:** upload 5 real receipts → ≥4 auto-match or sensibly queue; create a payroll run mirroring your real one (USD/PKR/INR) → statement totals match your spreadsheet; mark lines paid against seeded bank transactions.

## Phase 6 — Reports & Dashboard (≈ weeks 12–13)

**Prompt:**
> Implement the reports engine per /docs/02 §6.7: queries over journal lines by account type; shared report-viewer template per /docs/03 §8 (ranges, compare columns, cash/accrual toggle, drill-down slide-over, CSV/PDF export). Ship: Monthly Review (per /docs/02 §6.7 #12 and /docs/03 §8), P&L, Balance Sheet, Cash Flow (direct grouping), AR/AP Aging, Expenses by category/vendor, Income by Customer, Payroll Summary, Journal Entries view. Then the Dashboard per /docs/03 §1 — all 10 widgets + activity feed + first-run states. Reconciliation tile per /docs/02 §5.4. Verify against seed data with hand-computed expected statements committed as test fixtures (golden tests).
**You verify:** golden tests green; P&L for a seed month matches the hand-computed fixture to the cent; Balance Sheet shows "Balanced ✓"; cash toggle changes AR-dependent numbers; every dashboard number click-throughs correctly.

## Phase 7 — AI Chat + Polish + Release (≈ weeks 14–16)

**Prompt:**
> Implement the chat agent per /docs/02 §6.8 + /docs/03 §9: streaming drawer, read tools (queryTransactions, getReport, getBalances, searchContacts, getPayrollRuns), action tools behind confirmation cards (categorizeTransactions, createRule, draftInvoice, addBill, createJournalEntry), inline mini-chart/table artifacts, contextual suggested prompts, full-page mode. Then "Explain this report." Then release hardening: onboarding flow per /docs/02 §9, data export (CSV bundle/JSON/GL), nightly auto-export, encrypted-keys audit, docker-compose one-command install + README quickstart, upgrade docs, AGPL license, CONTRIBUTING.md, demo-mode flag (seed data) for the hosted demo.
**You verify:** ask the 5 sample questions from doc 02 §6.8 against seed data and sanity-check every answer against the reports; AI proposes a rule in chat → confirmation card → it appears in Rules; fresh-machine install from README in <15 min; full export opens in Excel.

---

## Operating Rhythm (how to run Claude Code on this)

- **One phase = one milestone; one prompt-block = one session/PR.** Keep sessions scoped; start each with "Read /docs/02 §X and /docs/03 §Y."
- **Subagent pattern per session:** implement → then ask Claude Code to *"spawn a review pass: check the diff against the invariants in CLAUDE.md and run all tests"* before you look at it.
- **Your verification ritual (no code reading):** run the app, follow the per-phase "You verify" list, and run `npm test` — the suite includes the ledger invariants, the eval harness, and the golden statements. If any invariant test is red, stop and fix before new features.
- **Never compromise:** money as integers; postEntry is the only write path to the ledger; every AI/rule action lands in the audit log.

## Milestone Demos (what "done" looks like)

| # | Demo |
|---|---|
| M0 | Shell + onboarding step 1 on Docker |
| M1 | Manual journal entry → GL → Trial Balance balances |
| M2 | CSV import → rules fire → Inbox batch-confirm → audit trail |
| M3 | Your AI key categorizes seed data ≥80%; correction → rule proposal |
| M4 | Plaid sandbox + Stripe test: payout deposit splits into gross−fees, $0 drift; invoice paid end-to-end |
| M5 | Real receipts matched; your real payroll run reproduced in 3 currencies |
| M6 | P&L/BS/CF match golden fixtures; dashboard live |
| M7 | Chat answers the 5 questions correctly; fresh install <15 min; v0.1 tagged |

## Post-v1 Roadmap (parking lot)

v1.1: recurring invoices/bills, weekly digest email, statement-based reconciliation. v1.2: budgets + 90-day cash-flow planner, consolidated multi-entity dashboard. v1.3: payroll payment-file export, accountant bulk tools, tax-prep export packet. v2: hosted cloud offering, mobile, community connector SDK (SimpleFIN/Teller/GoCardless adapters).
