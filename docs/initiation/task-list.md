# Overnight Task List — Milestones M0–M13

Date: 2026-06-11 (rev 2)
Rule: one milestone = one committed, verified increment. After each milestone:
`pnpm verify` green → evidence captured → checkboxes ticked → completion-report
entry → conventional commit. Subagents may run M6/M7, M8/M9 style siblings in
parallel **only** with non-overlapping write scopes; the main thread owns
integration, review, and commits.

Already done in the initiation pass (kept for the record):

- [x] Create `initiation` branch; baseline `pnpm typecheck`/`lint`/`build` pass.
- [x] Read Fable docs, prototype, design system; local render verified.
- [x] Initiation docs created; README/AGENTS/flow/LICENSE updated.

---

## M0 — Preflight gate (do this first, fail fast)

- [x] Run `npx convex ai-files install`; read the generated guidelines.
- [x] Read `apps/web/node_modules/next/dist/docs/` index for Next 16 changes
      relevant to App Router, fonts, and route handlers.
- [x] Record `git remote -v` and whether `gh` is authenticated; if no GitHub
      remote exists, M13's draft-PR step becomes a local-branch summary note.
- [x] Link Convex cloud dev project (`npx convex dev --once --configure` or
      equivalent); record deployment name + `.convex.site` URL.
- [x] Link Vercel project for this repo (`vercel link`); record project/org.
- [x] Write `scripts/preflight.mjs`: assert presence of required env vars
      (names in access-and-questions §3) and make one cheap live call per
      service — Plaid `/institutions/get` (sandbox), Stripe `GET /v1/balance`
      (test), Bedrock tiny invoke, Convex deployment reachable, `vercel whoami`.
      Print a PASS/FAIL table (never print values). Wire as `pnpm preflight`.
- [x] Distribute server-side keys from `.env.local` into the Convex dev
      deployment env (`npx convex env set …`).
- [x] Add `pnpm verify` (typecheck + lint + build + vitest) and test scaffolding
      (vitest + convex-test), plus `pnpm test:e2e` (Playwright) scaffolding.

Done when: preflight table is all PASS (or failures are logged as blockers with
the affected milestones marked fixture-mode) and `pnpm verify` runs green.
Evidence: preflight output (redacted) in completion report.

## M1 — Design system port + app shell + landing

- [x] Port tokens from `OpenBooks Design System/tokens` + `styles.css` into the
      Tailwind 4 theme (CSS-first `@theme`): green ramp, semantic money colors,
      radii, spacing, shadows; Geist + Geist Mono via `next/font` (local woff2
      from the design system); lucide-react icons; tabular figures utility.
- [x] Build shared primitives on shadcn bases: port the design-system
      component library (Amount, StatCard, EmptyState, Badge, Table,
      Sparkline, BarChart, SideNav, PageHeader, AskAI, ReviewItem — see
      `OpenBooks Design System/components/` + `.prompt.md` notes), and create
      the design-brief primitives that don't exist as files yet
      (CategoryChip, ConfidenceRing, AgingMiniBar, ReasoningPopover)
      following the same patterns. Use
      `OpenBooks Design System/ui_kits/openbooks/` JSX as reference
      implementation; `.dc.html` prototypes as visual reference.
- [x] App shell per design brief §0: collapsible sidebar (Dashboard, Inbox,
      Transactions, Invoices, Bills, Contacts, Payroll, Reports, Settings),
      entity switcher, top bar (⌘K stub + Ask AI toggle), collapsible right AI
      drawer (empty for now), sync-status footer. Mobile: bottom tab bar
      (Dashboard, Inbox, Transactions, Ask AI).
- [x] Landing page from `Landing.dc.html` reference with request-access form
      (stores lead in Convex; Plunk notify if key present) + sign-in entry.
      No public sign-up.

Done when: every nav route renders (empty states fine), landing matches the
design language desktop + 390px mobile, lighthouse-obvious regressions absent.
Evidence: screenshots (desktop + mobile) in `docs/initiation/evidence/`.

## M2 — Auth + invite gate

- [x] Convex Auth password provider; sign-in page styled per design system.
- [x] Invite-only: `OWNER_EMAIL` allowlist seed + `invites` table; non-invited
      sign-up attempts rejected with the request-access path offered.
- [x] Owner credential bootstrap from env: `OWNER_EMAIL` + `OWNER_PASSWORD`
      (set by Ansar in `.env.local`) creates/updates the owner account so the
      morning login needs no secret handoff.
- [x] Workspace bootstrap: owner's first login → workspace + role=owner.
- [x] Minimal Settings → Leads view listing request-access submissions.
- [x] Authorization helper enforced in every Convex function (workspace/entity
      scoping); unit-test the guard.

Done when: owner logs in and lands on the dashboard; a random email cannot
register; leads table captures request-access submissions.
Evidence: Playwright spec for the gate + screenshots.

## M3 — Ledger core (the foundation — do not rush)

- [x] Schema per product spec §7: `ledgerAccounts`, `journalEntries`,
      `journalLines`, plus `workspaces/entities/users` alignment.
- [x] CoA seeding by business type (~30 accounts, 5 types + system accounts).
- [x] `postEntry` mutation: Σdebits=Σcredits or reject; immutability;
      `reversesEntryId` reversal+repost flow; period soft-lock; auditLog write
      on every post.
- [x] Accountant drawer v1 under Settings → Accounting: CoA editor
      (friendly/accountant modes), manual journal entry form, General Ledger
      view, Trial Balance view.
- [x] Tests: balance invariant, reversal flow, lock behavior, property-style
      random-sequence trial-balance-always-zero, authorization guard.

Done when: tests green; manual JE → appears in GL; Trial Balance difference is
exactly 0; backdating into a locked period warns/blocks.
Evidence: test output + GL/TB screenshots.

## M4 — Pipeline stages 1–3 + demo engine: 12 months of deterministic books

- [x] Build categorization pipeline stages 1–3 per spec §4 BEFORE the seed
      engine (everything routes through it): (1) dedupe/transfer detection,
      (2) record match against open invoices/bills/payroll/expected payouts,
      (3) rules engine — ordered, first-match-wins, conditions on
      merchant/description/amount/direction with OR groups, auto-post flag,
      hit counts. Confident results post via `postEntry`; uncertain results
      create inbox items. Unit-test routing.
- [x] Seeded-RNG generator (fixed seed, stable output) creating, for Demo
      entity "Acme Studio LLC" (services, USD): 2 bank accounts + 1 credit
      card; ~900 transactions over 12 months with realistic merchants and
      monthly rhythm (rent, SaaS, payroll, ads, fees); monthly Stripe-style
      payout cycles (charges − fees → clearing → bank deposit, all matched);
      18 contacts; 14 invoices across statuses incl. 3 open/2 overdue; 10
      bills incl. due-soon; 6 employees (USD/PKR/INR) with 12 monthly payroll
      runs posted and mostly settled; 3 receipts matched + 2 pending; 6 rules
      with hit counts; ~12 open inbox items covering every card type; audit
      log entries throughout. All money movements post via the pipeline +
      `postEntry` — no screen-only numbers anywhere.
- [x] Labeled subset (≥100 transactions) reserved as the categorization eval
      set with expected categories.
- [x] `pnpm seed:demo` (idempotent reset + reseed) + Settings → Data
      "Reset demo data" action.
- [x] Golden fixtures: hand-computed P&L, Balance Sheet, Trial Balance for at
      least one seeded month, committed as test fixtures.

Done when: seed runs idempotently; trial balance = 0 over the whole year;
golden fixtures match to the cent.
Evidence: seed run output + golden test results.

## M5 — Core screens on Convex data

- [x] Dashboard per design brief §1: cash position + sparkline, P&L snapshot,
      inbox status, AR/AP widgets, expense donut, income by customer, cash
      flow bars, payroll widget, activity feed; period selector; all numbers
      from Convex queries over the ledger; click-through works on every number.
- [x] Inbox per §2: two-pane, card types (categorize, receipt, transfer,
      payout mismatch, connection, AI question), confirm/correct, "always do
      this → rule", batch confirm, J/K/E/Enter keys, zero-state.
- [x] Transactions per §3: filters/status tabs/search, inline category edit
      (reverse+repost under the hood), split editor, exclude, manual add,
      bulk actions, row drawer with receipt preview + activity history +
      accounting view, reconciliation tile (ledger vs. synced balance).
- [x] CSV import wizard per §3b (column mapper with AI pre-map if available,
      duplicate detection, import → pipeline).

Done when: the core loop works on demo data: dashboard → inbox → confirm →
transaction drawer shows balanced lines → recategorize → audit shows
reversal+repost.
Evidence: Playwright specs + screenshots.

## M6 — Contacts, Invoices, Bills, Payroll + remaining Settings screens

- [x] Contacts per §6: directory, role filters, profile (totals, open AR/AP,
      history, default-category-as-rule), merge-duplicates flow.
- [x] Settings → Businesses (design brief §10): entity cards, add/archive
      entity — needed by M8/M9 to create the Live Sandbox entity.
- [x] Settings → Rules manager (design brief §10): ordered list, plain-English
      summaries, hit counts, on/off, editor modal, AI-suggested section
      (pending-approval slot used by M10).
- [x] Settings → Audit log viewer (design brief §10): filterable table — when,
      actor (user/AI/rule), action, before→after.
- [x] Invoices per §4: list + status pipeline + aging KPIs; composer (Stripe
      send arrives in M8 — composer saves drafts and records manual invoices
      now); receivables aging matrix.
- [x] Bills per §5: manual add + upload-PDF placeholder (AI extract lands in
      M10/M11), due-window grouping, mark-paid → match-to-transaction picker,
      AP postings (bill entry, settlement entry).
- [x] Payroll per §7: employees CRUD; runs grid (adjustments, FX rate, base
      conversion); approve → posts payroll entries; mark-paid settles against
      bank transactions w/ FX gain/loss line; printable statement view
      (per-currency + base totals) with CSV export.

Done when: all four modules browse/edit demo data and post correct entries.
Evidence: payroll statement screenshot showing 3 currencies + tests for AP/AR
and payroll postings.

## M7 — Reports + export

- [x] Reports engine: queries over journal lines by account type/subtype;
      shared viewer (range presets + custom, compare prior period/year,
      monthly columns, cash ⇄ accrual toggle, drill-down slide-over).
- [x] Ship: Monthly Review (hero one-pager per spec §6.7#12), P&L, Balance
      Sheet (with Balanced ✓ chip), Cash Flow (direct grouping), AR Aging,
      AP Aging, Expenses by category/vendor, Income by Customer, Payroll
      Summary, General Ledger, Trial Balance, Journal view.
- [x] CSV export on every report; full-data export (CSV bundle + JSON) under
      Settings → Data.
- [x] Golden tests wired into `pnpm verify`.

Done when: golden tests green; BS balanced; cash/accrual toggle changes
AR/AP-dependent figures; exports open with correct totals.
Evidence: exported CSVs in evidence folder + test output.

## M8 — Stripe test mode E2E (Live Sandbox entity)

- [x] Create the "Live Sandbox" entity (services, USD) via Settings →
      Businesses; all M8/M9 connections attach to it.
- [x] Settings → Connections → Stripe: connect with key from env (UI shows
      "configured from environment" state per build-decision 9), permission
      validation checklist, clearing account auto-created.
- [x] Sync action: customers → contacts, charges/PIs → income transactions
      with attribution, invoices → AR; cron + manual Sync now.
- [x] Seed the Stripe test account via API: ~10 customers, ~25 charges, 3
      invoices (finalized/sent), then sync.
- [x] Payout reconciliation per spec §5.1: gross/fee postings to clearing,
      payout fetch + `balance_transactions` breakdown, $0-drift check,
      mismatch → inbox card, payout drill-down UI. Manual test payout if
      possible; fixtures otherwise (see goal §5).
- [x] Invoice composer "Send via Stripe": create/finalize → hosted invoice
      URL + status timeline; webhook endpoint registered if `.convex.site`
      URL available (else cron polling).

Done when: Live entity shows synced Stripe data; payout drill-down renders
gross−fees; fixtures green; invoice created from the UI exists in Stripe test
dashboard with a hosted link.
Evidence: screenshots + Stripe object IDs in completion report.

## M9 — Plaid sandbox E2E (Live Sandbox entity)

- [x] Settings → Connections → Bank: env-key state + Link launch; sandbox
      Link flow; account-selection step (checkboxes, balances); ledger
      accounts auto-created per included account.
- [x] `/transactions/sync` cursor engine: initial backfill, incremental,
      `removed` array handling (pending→posted carry-over of category/links
      via amount+date heuristic), 4h cron + manual Sync now.
- [x] Custom sandbox user JSON for controlled transactions; document the
      `user_transactions_dynamic` option; `/sandbox/public_token/create` used
      in automated tests to bypass Link UI.
- [x] `ITEM_LOGIN_REQUIRED` (via sandbox reset) → Inbox connection card →
      update-mode relink.
- [x] Plaid `personal_finance_category` captured as pipeline prior.
- [x] Synced transactions run the full pipeline (stages 1–3 now; AI stages
      activate in M10).

Done when: connecting a sandbox bank in the UI yields transactions in the
register that were categorized by the pipeline; relink flow demonstrated.
Evidence: Playwright spec using sandbox token + screenshots of Link flow.

## M10 — AI on Bedrock: pipeline stages + chat panel

- [ ] Provider layer via AI SDK with a registry shaped for
      Anthropic/OpenAI/Google/Ollama/Bedrock; v1 active provider = Bedrock
      from env (model from `AI_MODEL`, embeddings `AI_EMBEDDINGS_MODEL`);
      Settings → AI: provider/status, model display, autonomy radio
      (suggest/balanced/autopilot mapped to never/0.90/0.75), test-connection.
- [ ] Pipeline stages 4–6 per spec §4: embeddings memory (Convex vector
      index over categorized transactions), batched LLM categorization with
      structured output `{categoryId, confidence, reasoning, needsHuman,
      question}`, Plaid prior, routing by autonomy threshold; corrections
      write memory; 3 identical corrections → AI-drafted rule pending
      approval in Rules manager.
- [ ] Run the pipeline over the demo eval set; record accuracy (target ≥80%).
- [ ] Chat panel per spec §6.8: streaming drawer + full-page mode; read tools
      (queryTransactions, getReport, getBalances, searchContacts,
      getPayrollRuns); action tools behind confirm cards
      (categorizeTransactions, createRule, draftInvoice, addBill,
      createJournalEntry); inline
      mini table/chart artifacts; contextual suggested prompts; "Explain this
      report" button on the report viewer.
- [ ] Degraded mode: AI env absent → stages 1–3 only + UI hints; chat hidden
      or clearly disabled.

Done when: the five sample questions from spec §6.8 answer correctly against
demo data (cross-checked vs. reports); a chat-proposed rule lands in Rules
after confirmation; eval accuracy logged.
Evidence: chat transcripts + eval numbers in completion report.

## M11 — Receipts (full attempt; cannot block completion)

- [ ] Generate 5 synthetic receipt images (script renders HTML → PNG) with
      known vendor/date/amount, committed under `tests/fixtures/receipts/` —
      the test inputs for extraction and matching.
- [ ] Documents table + upload (drag-drop) per spec §5.2; storage in Convex.
- [ ] Bedrock vision extraction (vendor/date/total/currency) with
      confidence-underlined review form.
- [ ] Heuristic + embedding match → auto-attach / inbox card / pending;
      no-transaction path offers manual expense or bill.
- [ ] Bills upload-PDF path reuses the same extraction.

Done when: uploading 5 sample receipts auto-matches or sensibly queues ≥4.
If extraction quality blocks this, ship upload + manual match and log the gap.
Evidence: inbox receipt-card screenshot.

## M12 — Deploy to production

- [ ] Vercel production deploy of `apps/web`; attach
      `openbooks.ansarullahanas.com`; set Vercel env (public vars only where
      `NEXT_PUBLIC_*`).
- [ ] Convex production deployment; `npx convex env set --prod` for all
      server keys; point the prod frontend at it; re-register webhooks
      against the prod `.convex.site` URL.
- [ ] Seed demo entity in prod; verify owner login + dashboard on the live
      URL; request-access form works in prod.
- [ ] Document rollback: previous Vercel deployment + `vercel rollback`.

Done when: live URL serves the app over the custom domain; owner can log in;
demo entity renders; no secrets in client bundles (spot-check page source).
Evidence: live URL screenshots incl. mobile.

## M13 — Acceptance run + honest report

- [ ] Full `pnpm verify` + `pnpm test:e2e` green; run the e2e suite against
      production if practical.
- [ ] Walk `docs/initiation/acceptance.md` in the browser; capture a
      screenshot per checkpoint into `docs/initiation/evidence/`.
- [ ] Fill the acceptance checklist table in
      `docs/initiation/completion-report.md` (WORKING / PARTIAL / BLOCKED +
      evidence links); list every deviation from the product spec.
- [ ] Update README quickstart if commands changed; final conventional
      commit; open draft PR `initiation` → `main` summarizing the run (if a
      GitHub remote exists per M0; otherwise write the summary in the
      completion report).

Done when: every acceptance row has a status and evidence; the outcome in
goal.md §1 is satisfied per the verification surface in goal.md §2, or
honestly blocked.
