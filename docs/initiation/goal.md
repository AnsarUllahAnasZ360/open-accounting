# OpenBooks Overnight Goal — Working v1 Slice

Date: 2026-06-11 (rev 2 — acceptance-first rewrite)
Branch: `initiation`
Budget guidance: up to 12 hours of agent work. Milestones are ordered by value;
if budget runs out, everything completed must still be a working, committed app.

---

## 1. Outcome (what must be true when this goal completes)

OpenBooks is a usable product, deployed at `https://openbooks.ansarullahanas.com`,
that Ansar can verify in the morning by walking through
`docs/initiation/acceptance.md` end to end:

1. Landing page (desktop + mobile) with a working request-access form; public
   sign-up disabled; invite-only auth; owner can log in.
2. A **Demo entity** ("Acme Studio LLC") seeded with **12 months of deterministic,
   internally consistent books**: transactions, categorized history, Stripe-style
   payouts with fees, invoices (some open/overdue), bills, contacts, payroll runs
   in USD/PKR/INR, receipts, open inbox items of every card type, rules, and a
   complete audit trail — all posted through the ledger engine so every report
   reconciles and the trial balance is zero.
3. A **Live Sandbox entity** where Settings → Connections actually works:
   - Plaid **sandbox**: Link flow → account selection → initial + incremental
     `/transactions/sync` → transactions flow through the categorization
     pipeline into the ledger and screens.
   - Stripe **test mode**: key connect → customers/charges/invoices sync →
     clearing-account postings → payout fetch with gross−fees breakdown →
     invoice creation via API with hosted link.
4. The hidden double-entry ledger core: single `postEntry` mutation enforcing
   Σdebits = Σcredits, immutable posted entries (corrections reverse + repost),
   period soft-lock, audit log — proven by unit tests.
5. Working screens on real Convex data: Dashboard, Inbox (confirm / correct /
   create-rule / batch), Transactions register (filters, search, splits,
   exclude, drawer with accounting view), Invoices, Bills, Contacts, Payroll
   (employees, runs, multi-currency statement), Reports, Settings.
6. Reports engine over journal lines: Monthly Review, P&L, Balance Sheet,
   Cash Flow, AR/AP Aging, Expenses, Income by Customer, Payroll Summary,
   General Ledger, Trial Balance — date ranges, comparison columns,
   cash/accrual toggle, drill-down, **CSV export**. Golden-fixture tests pass.
7. AI on **AWS Bedrock** (creds from env): categorization pipeline stages
   (rules → memory/embeddings → LLM with confidence routing per autonomy
   thresholds) and the **chat panel** with read tools (balances, reports,
   transactions, contacts, payroll) plus propose→confirm action cards.
   Degraded mode works when AI env is absent.
8. Receipts: upload → AI extraction → match-to-transaction suggestion in Inbox.
9. Deployed: Vercel production + custom domain + Convex production deployment
   with env synced; owner login verified on the live URL.
10. The repo is honest: `docs/initiation/completion-report.md` separates
    WORKING (with evidence) from PARTIAL from BLOCKED, and the acceptance
    checklist table is filled in.

## 2. Verification surface (evidence decides completion, not narration)

- `pnpm verify` — typecheck + lint + build + unit tests. Must be green.
  Unit tests must include: ledger balance invariant (including a property-style
  test over random entry sequences), reversal/repost flow, period-lock behavior,
  payout-reconciliation fixtures, pipeline routing by autonomy threshold, and
  golden report fixtures (hand-computed P&L / Balance Sheet / Trial Balance for
  the seeded dataset, matched to the cent).
- `pnpm test:e2e` — Playwright acceptance suite mirroring
  `docs/initiation/acceptance.md` (auth gate, dashboard numbers render from
  Convex, inbox confirm flow, recategorize→audit trail, report export, chat
  answers). Must be green locally; run against the deployed URL if practical.
- Browser walkthrough of `docs/initiation/acceptance.md` with screenshots saved
  to `docs/initiation/evidence/` and indexed in the completion report.
- Categorization eval: labeled subset of seed transactions (≥100); report
  accuracy in the completion report (target ≥80%; below target is a finding,
  not a blocker).
- Live URL responds; owner login works in production.

## 3. Constraints (must hold throughout — from AGENTS.md, restated)

- Never commit or print secrets. `.env.local` is the single env source Ansar
  maintains; the undotted `env.local` is a stale reference copy from another
  machine — never distribute values from it.
- Public sign-up stays disabled. Request-access leads stored in Convex
  (Plunk email notification only if `PLUNK_SECRET_KEY` is present).
- Money is integer minor units + currency code. Never floats.
- `postEntry` is the only ledger write path; entries balance or are rejected.
- Posted entries are immutable; corrections reverse + repost, linked for audit.
- External API calls live in Convex actions; transactional writes in mutations;
  every Convex function re-checks workspace/entity authorization.
- Autonomy thresholds are one constant: suggest = never auto-post,
  balanced = 0.90, autopilot = 0.75.
- UI follows the OpenBooks design system (Geist, lucide, one green `#2ca01c`,
  white ledger-like surfaces, tabular money figures, quiet AI). No gradients,
  no purple AI, no emoji.
- The product name renders as **OpenBooks** everywhere in the UI; the
  "Open Books" spelling inside the canonical docs is historical.
- Preserve `OpenBook - Prototype/` and `OpenBooks Design System/` untouched.
- Work only on branch `initiation`; commit per milestone; never force-push.

## 4. Boundaries (what to use)

- Repo: this monorepo (`apps/web`, `convex/`, `packages/email`).
- Canonical product docs: `docs/product/01–04` (copies of the Fable docs);
  design source: `OpenBooks Design System/` (tokens, components,
  `ui_kits/openbooks/` JSX screens are the reference implementation);
  visual reference: `OpenBook - Prototype/*.dc.html`.
- Keys: read from `.env.local`; distribute to Convex/Vercel env via CLI
  (see `docs/initiation/access-and-questions.md` §3). Plaid `sandbox` env and
  Stripe **test** keys only — never live keys, never real money.
- External services: Convex cloud (link project), Vercel (deploy + domain),
  Plaid sandbox, Stripe test mode, AWS Bedrock, Plunk (optional).
- Before Convex backend work: `npx convex ai-files install` and read the
  generated guidelines. Next.js 16 docs live in
  `apps/web/node_modules/next/dist/docs/`.

## 5. Sandbox reality (encoded so no one chases impossible E2E)

- **The year of data comes from the seed engine, not from sandboxes.** Plaid
  sandbox and Stripe test mode cannot fabricate 12 months of history. The Demo
  entity is seeded directly through the pipeline + `postEntry`; the Live
  Sandbox entity proves connection mechanics with whatever data the sandboxes
  provide. Use a Plaid custom sandbox user (JSON config) for controlled
  transactions; `user_transactions_dynamic` for ongoing updates.
- **Stripe test payouts may not arrive during the run.** Attempt a manual test
  payout if balance allows; otherwise verify payout reconciliation against
  recorded `balance_transactions` fixtures (which must pass regardless) and the
  fully-seeded payout cycle on the Demo entity. Note which path ran.
- **A Stripe test payout never lands in the Plaid sandbox bank feed** (separate
  sandboxes). Payout→bank-deposit auto-match is demonstrated on the Demo
  entity; on the Live entity an unmatched expected-deposit inbox card is the
  *correct* behavior. Do not chase a cross-sandbox match.
- Webhooks (Plaid `SYNC_UPDATES_AVAILABLE`, Stripe events) are an enhancement;
  4-hour crons + manual "Sync now" are the baseline. Register webhooks via API
  using the Convex deployment's public `.convex.site` URL when available.

## 6. Iteration policy

After each milestone in `docs/initiation/task-list.md`: run `pnpm verify`,
capture evidence, tick the checkboxes, append a dated entry to the completion
report (what changed / evidence / next), commit with a conventional message,
then start the next unblocked milestone. Use subagents for parallelizable
milestones with non-overlapping write scopes, plus an independent review pass
(diff vs. AGENTS.md invariants + full test run) before each milestone commit.
If the same error defeats three distinct attempts, write a blocker note and
move to the next independent task — never spin.

## 7. Blocked-stop condition

Stop substantive work only when no milestone can proceed without one of:
missing/invalid keys (Plaid, Stripe, AWS Bedrock), Convex/Vercel project or
domain ownership input, or a product decision not covered by
`docs/initiation/access-and-questions.md` §4. On budget exhaustion or full
block: leave the app passing `pnpm verify`, summarize state + blockers + the
exact input needed in the completion report, and stop. Reaching budget is not
completion; completion is the acceptance checklist evidenced green.
