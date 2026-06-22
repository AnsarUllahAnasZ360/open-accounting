# OpenBooks — Launch Sprint

**The single source of truth for taking OpenBooks from "foundation built, real data broken" to
"Ansar runs his two LLCs on it and other owners can clone and trust it."**

This folder is the execution packet. It is built from a file-by-file audit of the codebase, a read
of the live cloud deployment (entities **Zikra** and **Z360**), and research into how QuickBooks,
Xero, Stripe, Plaid, Puzzle, Digits, Ramp, and Fathom do this in production.

| Document | What it is |
|---|---|
| **[diagnosis/accounting-engine-blueprint.md](diagnosis/accounting-engine-blueprint.md)** | The plain-English blueprint + evidence-backed diagnosis of why real reports are wrong. **Read this first.** |
| **[decisions.md](decisions.md)** | **The resolved decision contract.** Resolves all 87 open questions against Ansar's 16 decisions ([rebuild/ANSAR-DECISIONS.md](rebuild/ANSAR-DECISIONS.md)) + QBO parity. **This supersedes `open-questions.md` — read it before any epic.** |
| **[plan-rebuild-changelog.md](plan-rebuild-changelog.md)** | The per-epic edit delta (what's cut/rescoped/added) that the decision layer implies. |
| **[backlog.md](backlog.md)** | Every ticket (≈145) in one table — size, risk, dependencies. |
| **[epics/](epics/)** | One doc per epic: goal, current state (file-grounded), epic DoD, and each ticket (intent, changes, files, testable DoD, deliverables, verify recipe). |
| **[research/external-research.md](research/external-research.md)** | The best-practice findings (AI-CFO, onboarding, self-host, demo, security/test, owner education) with citations. |
| **[execute-launch-sprint.workflow.js](execute-launch-sprint.workflow.js)** | The executable team-of-agents build workflow (build → gate → adversarial verify → commit, per batch). |

---

## 1. The thesis

OpenBooks' double-entry **ledger engine is correct** — single balanced posting path, immutable
entries, reverse-and-repost, period locks, and a chart of accounts that already contains the right
machinery (Stripe Clearing 1150, Payouts In-Transit 1160, Opening Balance Equity 3900). The product
feels "fundamentally broken" because **the pipes that feed that engine leak**, and nothing on screen
says so:

- **~78–80% of real transactions never post** — uncertain items sit in the Inbox with no journal
  entry — so Zikra's P&L shows $120k income against **$3,410** of expense.
- **Stripe payouts never reconcile** → **$458,101 parked in a phantom "In-Transit" asset**, and
  "Stripe Clearing" gone negative.
- **No opening balance** on bank connect → equity reads **$0**, the balance sheet can't tie to cash.
- The upstream cause of the backlog: **bring-your-own AI key isn't wired into the UI**, so
  categorization runs degraded and everything falls to the Inbox.

**So the sprint is mostly wiring and hardening what exists, plus a deliberate UX/onboarding layer on
top — not a rewrite.** Full evidence and file:line references are in the
[diagnosis blueprint](diagnosis/accounting-engine-blueprint.md).

## 2. What we're building toward (the product, stated plainly)

A free, open-source app where a small-business owner — including one running **multiple LLCs** —
connects their banks and Stripe with their own keys, and within ~20 minutes has **AI-set-up,
correct, double-entry books** they never have to think about in accounting terms. On top of the
books sits an **AI CFO**: proactive, plain-English advice ("you have ~7 months of runway", "software
spend is up 38% over 3 months", "set aside ~$4,200 for taxes") plus a calm **weekly digest** — every
number grounded in the immutable ledger and drillable to source. Anyone can try it instantly via a
**no-login public demo**, and self-host it with a guided **setup skill**.

The two differentiators that make this more than a free QuickBooks clone:
1. **Portfolio view across your businesses** — unified-by-default with one-click drill into each LLC
   (QuickBooks/Xero make you buy Fathom/Joiin for this), with legally-separate books underneath.
2. **The AI CFO / financial advisor** — bookkeeping is table stakes; *advice* is the value. Grounded
   in the ledger, never fabricated, framed as guidance (not regulated financial advice).

## 3. The epics (15) and the build sequence

Each epic links to its full ticket set. Build in **waves** — Wave 1 is the critical path that makes
Ansar's real books correct; nothing downstream is trustworthy until it lands.

### Wave 1 — Make real data correct (the foundation; unblocks everything)
| Epic | Title | Why it's first |
|---|---|---|
| **[E1](epics/E01-accounting-correctness-reconciliation-engine.md)** | Accounting correctness & reconciliation engine | Fixes the fixture-payout corruption, opening balances, the Stripe matcher/$458k, report truncation, double-counts, and the "$X unreviewed" signal. |
| **[E2](epics/E02-ai-categorization-engine-learning-loop.md)** | AI categorization engine & learning loop | Provider-agnostic categorizer + backlog drainer + memory/calibration — this is what gets the 78% to actually post. |
| **[E3](epics/E03-integrations-byo-keys-plaid-stripe-ai-plunk.md)** | Integrations & BYO-keys (Plaid/Stripe/AI/Plunk) | The in-UI AI key + provider switcher (currently missing) is the upstream unblock; per-business connection association. |

### Wave 2 — The experience around correct data
| Epic | Title |
|---|---|
| **[E4](epics/E04-guided-onboarding-done-for-you-books-first-run.md)** | Guided onboarding & "done-for-you books" first-run |
| **[E5](epics/E05-multi-entity-workspace-business-layer-portfolio-.md)** | Multi-entity, workspace↔business layer & Portfolio view |
| **[E11](epics/E11-data-lifecycle-reset-delete-all-demo-data-public.md)** | Data lifecycle — reset/delete-all, demo data & public demo account |

### Wave 3 — UI/UX surfaces (consume the corrected data)
| Epic | Title |
|---|---|
| **[E6](epics/E06-reports-correctness-aware-ui-redesign-responsive.md)** | Reports — UI redesign & responsiveness (cash-flow fix) |
| **[E7](epics/E07-transactions-register-mercury-grade-workbench-de.md)** | Transactions register & workbench (description-toggle, density) |
| **[E8](epics/E08-insights-everywhere-per-page-banners-redesigned-.md)** | Insights everywhere — per-page banners + redesigned insights |
| **[E9](epics/E09-dashboard-enhancement-ai-cfo-financial-advisor-w.md)** | Dashboard + **AI CFO / Financial Advisor** + weekly digests |
| **[E10](epics/E10-payroll-verify-fix-integrate.md)** | Payroll — verify, fix & integrate |
| **[E12](epics/E12-settings-app-shell-ui-overhaul-make-all-11-secti.md)** | Settings & app-shell UI overhaul |

### Wave 4 — Productionize & launch
| Epic | Title |
|---|---|
| **[E13](epics/E13-self-host-setup-skill-deployment-security-postur.md)** | Self-host setup skill + deployment + security posture |
| **[E14](epics/E14-quality-test-suite-accounting-invariants-categor.md)** | Quality — test suite, accounting invariants, eval, security audit |
| **[E15](epics/E15-docs-help-center-landing-gtm-make-openbooks-publ.md)** | Docs, Help Center, Landing & GTM (one-pager, demo, video, outreach) |

> E14 (tests) and E15 (docs) run *continuously* alongside the build, not only at the end — every
> ticket's "verify" recipe feeds the test suite, and the honesty status table is updated per wave.

## 4. Definition of done for go-live

Ansar can declare launch when **all** of these are true:

- **His books are correct.** On Zikra and Z360: every real transaction is posted or explicitly in
  the Inbox with a visible "$X unreviewed" count; Stripe payouts reconcile (1160 drains, 1150 never
  negative); opening balances booked (dated the first of the month, equity ≠ $0); balance sheet ties
  to the real bank. **The ledger is USD-only** — no multi-currency journal lines; the only place FX
  exists is payroll, which converts foreign salary to USD at a day-of-pay rate and books USD. (E1,
  E2, E3, E10)
- **All credentials live in one encrypted store.** AI keys, Plaid, Stripe, and Plunk secrets share a
  single unified `credentials` table (one encrypted-at-rest shape, correctly scoped — AI/Plunk
  workspace-scoped, Stripe per-business), not a one-off per provider. (E3)
- **Live connectors work locally.** Real Plaid/Stripe keys (not just sandbox/test) connect and sync;
  the old "sandbox/test only" rule is removed, encryption-at-rest is kept. A live Stripe connection
  requires a verified webhook. (E3)
- **He can run the whole thing end-to-end himself**: delete all data → re-run onboarding → connect
  banks/Stripe with his keys → choose how much history to import (default: everything the connector
  gives) → AI categorizes it → he approves proposed categories/rules/income-streams → lands on a
  fully-populated org (dashboard, transactions, AR, AP, reports, payroll ready). (E4, E11)
- **The unified Portfolio view works** with an All / Zikra / Z360 scope switcher. (E5)
- **The AI CFO is live**: runway/burn/tax-reserve/concentration/anomaly cards + a weekly Plunk
  digest, every number ledger-grounded and drillable. (E9)
- **The UI is clean and responsive**: Reports (esp. cash flow), Transactions (description-toggle),
  Settings/Connections, and a unique insight banner per page. (E6, E7, E8, E12)
- **A stranger can try it** at a **single shared no-login public demo workspace** (not a per-visitor
  clone; daily reset, server-enforced read-only), and **a developer can self-host it** via the
  setup skill + Deploy button, with the Plaid redirect URL and Stripe webhook URL surfaced. (E11, E13)
- **Quality gates green**: accounting-invariant tests, categorization eval at target, e2e on the new
  flows, a passed security audit, and an honest status table. (E14)
- **It's publishable**: README, owner help-center, the "why I built this" one-pager (your input),
  setup + security pages, demo video script, outreach templates, clean (secret-scanned) repo. (E15)

## 5. Decisions & what still needs Ansar

The product decisions are **resolved** — see **[decisions.md](decisions.md)**, which answers all 87
former open questions against Ansar's 16-decision contract
([rebuild/ANSAR-DECISIONS.md](rebuild/ANSAR-DECISIONS.md)) and QBO parity. `open-questions.md` is
superseded. The default rule for anything uncovered: **do what QuickBooks Online does; don't invent;
don't ask accounting questions.**

- **Keys** for live verification: your own AI provider key, Plaid client_id/secret, Stripe keys +
  webhook secret, Plunk key. **Live keys are now allowed locally** (the sandbox/test-only rule is
  removed) — encryption-at-rest is kept.
- **The one-pager content**: the "why I'm building this" story for E15 (a clearly-marked input slot
  is left in the doc).
- **Decided by Ansar (2026-06-17):** public repo renamed to `openbooks`; license is **MIT**
  (relicense the LICENSE file from AGPL-3.0 + flip README/vision/AGENTS; the landing's MIT claims
  become correct); launch links point at the custom domain `openbooks.ansarullahanas.com`.
- **The one genuine remaining input** — Ansar's *words* for the "why I'm building this" one-pager
  (drafted with marked slots; not build-blocking). Two more are pre-defaulted and overridable:
  self-host skill distribution (committed `skills/` dir) and CI (a `pnpm ci` script vs a live
  GitHub Actions workflow). See the **"Still needs Ansar"** section of decisions.md.

## 6. How the build runs (the team workflow)

`execute-launch-sprint.workflow.js` orchestrates a team of agents per wave:

1. **Plan a wave** — pass the wave's epics (e.g. `args: { epics: ["E1","E2","E3"] }`). The workflow
   pulls those tickets, topologically orders them by `dependsOn`, and groups them into **batches of
   3–4 non-file-conflicting tickets**.
2. **Per batch (pipelined):**
   - an **implementer** agent (in an isolated git worktree) reads the ticket from its epic doc and
     builds it;
   - a **verifier** agent independently checks the ticket's Definition of Done and runs the gates
     (`pnpm verify` + `npx convex dev --once` + the relevant test);
   - **high-risk tickets** (anything touching `convex/ledger.ts` or money math) get an extra
     **adversarial verifier** that tries to break the invariant (debits=credits, clearing-zeroes,
     trial-balance) before the batch is allowed to commit;
   - on green, the batch **commits**; on red, it routes back to a repair agent.
3. **Wave review** — a final agent runs the full gate, updates the honesty status table, and reports
   what landed / what's blocked.

Ledger and money-touching work is never auto-trusted — it must survive adversarial verification.
Run waves in sequence (read each report before launching the next) so you stay in the loop.

---

*Produced by a 21-agent research + planning sprint (15 epic-authors reading the real code + 6
research agents), grounded in the deep accounting audit. ~146 tickets. See each epic doc for the
file-level detail an implementing agent needs.*
