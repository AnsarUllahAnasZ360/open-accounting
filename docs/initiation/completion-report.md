# Completion Report

Branch: `initiation`
This file is the run log + the honesty contract. Codex appends a dated entry
after every milestone and fills the acceptance table during M13. Never delete
history; never claim a row without linked evidence.

---

## Acceptance checklist (fill during M13)

Status values: WORKING (evidenced) · PARTIAL (works with named gaps) ·
BLOCKED (needs listed input) · NOT REACHED (budget).

| # | Check (rows 1–18 = acceptance.md; 19–20 = goal.md gates) | Status | Evidence | Notes / next step |
|---|---|---|---|---|
| 1 | Landing + request-access (desktop/mobile) | | | |
| 2 | Public sign-up disabled | | | |
| 3 | Owner login | | | |
| 4 | Dashboard on 12-month demo data, drill-throughs | | | |
| 5 | Inbox confirm / correct / rule / batch | | | |
| 6 | Register: drawer, accounting view, reverse+repost, split, exclude | | | |
| 7 | Invoices + Bills flows | | | |
| 8 | Contacts directory + profiles | | | |
| 9 | Payroll runs + 3-currency statement + CSV | | | |
| 10 | Reports suite + Balanced ✓ + TB=0 + cash/accrual + CSV export | | | |
| 11 | Full data export | | | |
| 12 | Plaid sandbox connect → sync → pipeline | | | |
| 13 | Stripe test sync + payout drill-down + invoice via Stripe | | | |
| 14 | Chat answers 5 questions correctly + confirmed action posts | | | |
| 15 | Receipt upload → extraction → match | | | |
| 16 | Mobile usability (4 core surfaces) | | | |
| 17 | Audit log attribution (user/rule/AI) | | | |
| 18 | Honesty check — this table complete with evidence (acceptance #18) | | | |
| 19 | `pnpm verify` + `pnpm test:e2e` green; eval accuracy reported (goal.md §2; ≥80% is a target, not a blocker) | | | |
| 20 | Production URL live, owner login in prod (goal.md §1.9) | | | |

## Run metadata (fill at start and end of the overnight run)

- Goal started (timestamp):
- Convex dev deployment: z360/openbooks dev/ansar-ullah-anas (ceaseless-mandrill-524) / prod deployment:
- Vercel project: ansar-ullah-anas-projects/openbooks / production URL: https://openbooks-flax.vercel.app
- Owner credential location (never the secret itself): `.env.local` plus macOS Keychain item `OpenBooks_OWNER_PASSWORD`
- Categorization eval accuracy:
- Goal ended (timestamp): / stop reason (complete / budget / blocked):

## Blockers (append as found)

| When | Blocker | Affected milestone | Exact input needed | Workaround taken |
|---|---|---|---|---|
| 2026-06-11 00:44 CDT | Vercel linked locally under the wrong `z360` scope, and GitHub auto-attach failed there. | M12 production deploy + domain | Use the `ansar-ullah-anas-projects` Vercel scope instead. | Resolved at 2026-06-11 01:00 CDT: linked/deployed `ansar-ullah-anas-projects/openbooks`; GitHub connection succeeded. |
| 2026-06-11 00:48 CDT | `ansarullahanas.com` was not listed under the active Vercel `z360` scope. | M12 custom domain | Confirm which Vercel scope owns `ansarullahanas.com`. | Resolved at 2026-06-11 01:00 CDT: domain is listed under `ansar-ullah-anas-projects`. |
| 2026-06-11 01:00 CDT | `openbooks.ansarullahanas.com` is attached to Vercel but DNS does not resolve yet. | M12 custom domain | In Hostinger DNS, add `A openbooks.ansarullahanas.com 76.76.21.21` (or host/name `openbooks`, value `76.76.21.21`), then wait for propagation and Vercel verification. | Vercel production URL works now: https://openbooks-flax.vercel.app. |

## Deviations from product spec (append as made)

| Spec section | Deviation | Why | Restore plan |
|---|---|---|---|

---

## Run log (append a dated entry per milestone)

Template:

```
### <date time> — M<n> <name>
What changed:
Evidence: (test output summary, screenshot paths, object IDs)
Verification: pnpm verify <green/red>, relevant suites
Next: M<n+1>
```

---

### 2026-06-11 01:13 CDT — M0 Preflight gate

What changed:

- Re-ran `npx convex ai-files install` and re-read `convex/_generated/ai/guidelines.md`.
- Read the local Next.js 16.2.7 docs index plus the App Router pages relevant to project structure, layouts/pages, server/client components, fonts, route handlers, and environment variables.
- Added `scripts/preflight.mjs` and wired `pnpm preflight`. The script reads `.env.local`, checks required env names, enforces Plaid sandbox and Stripe test-mode key shapes, makes cheap Plaid and Stripe calls, makes a Bedrock runtime tiny invoke, verifies Convex deployment metadata, and checks Vercel CLI auth. It prints names/status only, never values.
- Added `pnpm verify` as the repeatable local quality gate: typecheck, lint, production build, and Vitest.
- Added Vitest + `convex-test` scaffolding and a first invariant smoke test.
- Added Playwright scaffolding with a first browser smoke test and evidence output under `docs/initiation/evidence/`.

Preflight PASS/FAIL table:

| Check | Status | Detail |
|---|---:|---|
| `.env.local` | PASS | present |
| Required env names | PASS | all required names present |
| Optional env names | PASS | none configured |
| Plaid sandbox institutions/get | PASS | sandbox endpoint reached |
| Stripe test balance | PASS | test balance endpoint reached |
| Bedrock tiny invoke | PASS | runtime accepted `AI_EMBEDDINGS_MODEL` tiny invoke |
| Convex deployment | PASS | deployment metadata reachable |
| Vercel whoami | PASS | CLI authenticated |

Evidence:

- `docs/initiation/evidence/2026-06-11-m0-preflight.txt`
- `docs/initiation/evidence/2026-06-11-m0-verify.txt`
- `docs/initiation/evidence/2026-06-11-m0-e2e-smoke.txt`

Verification:

- `pnpm verify` green: typecheck, lint, Next.js production build, Vitest.
- `pnpm test:e2e` green for the M0 landing-shell smoke test.

Notes:

- Bedrock runtime is reachable through the configured embeddings model. M10 still owns the actual chat/categorization adapter for the configured `AI_MODEL`; this is not a blocker for M0.
- Convex deployment metadata is reachable. The local `NEXT_PUBLIC_CONVEX_URL` currently points to a localhost Convex URL, so local app runs that need live Convex data must start the local Convex service or point the app to the cloud dev URL.

Next:

- M1 — design-system port, app shell, and landing/request-access surface.

### 2026-06-11 01:32 CDT — M1 Design system port + app shell + landing

What changed:

- Ported the OpenBooks visual foundation into the web app: local Geist/Geist Mono fonts, light ledger-like Tailwind tokens, brand green `#2ca01c`, shadcn bases, lucide icons, and tabular money figures.
- Added a typed OpenBooks primitive layer for money, stat cards, empty states, page headers, sparklines, category chips, confidence rings, aging bars, reasoning popovers, and review rows.
- Built the shared app shell: left navigation for Dashboard, Inbox, Transactions, Invoices, Bills, Contacts, Payroll, Reports, Settings; entity switcher; search stub; Ask AI drawer; sync footer; and mobile bottom tabs for Dashboard, Inbox, Transactions, and Ask AI.
- Added all M1 routes with first-class responsive placeholder surfaces. These are shell/structure only; M3-M7 replace the placeholders with ledger-backed data and real workflows.
- Added request-access intake with `accessLeads` storage in Convex. The browser calls a Convex action that stores the lead through the mutation and sends Plunk notification only when Plunk server env is configured.
- Corrected an initial drift: the first landing implementation was an approximation. It has been replaced with content and screenshot assets ported from `OpenBook - Prototype/Landing.dc.html`: "Your books, always done.", the whole-loop section, Inbox, Ask AI, tour, reports, mobile, roadmap, why-free, compare, FAQ, and CTA sections. The repo license text is aligned to AGPL where the prototype copy conflicted with the project contract.

Evidence:

- `docs/initiation/evidence/2026-06-11-m1-verify.txt`
- `docs/initiation/evidence/2026-06-11-m1-e2e.txt`
- `docs/initiation/evidence/2026-06-11-m1-request-access-unit.txt`
- `docs/initiation/evidence/2026-06-11-m1-request-access-convex.txt`
- `docs/initiation/evidence/2026-06-11-m1-convex-dev-once.txt`
- `docs/initiation/evidence/2026-06-11-m1-build-with-public-env.txt`
- `docs/initiation/evidence/2026-06-11-m1-landing-desktop.png`
- `docs/initiation/evidence/2026-06-11-m1-landing-mobile.png`
- `docs/initiation/evidence/2026-06-11-m1-dashboard-shell-desktop.png`
- `docs/initiation/evidence/2026-06-11-m1-dashboard-shell-mobile.png`

Verification:

- `pnpm verify` green: typecheck, lint, production build, Vitest.
- `pnpm test:e2e -- tests/e2e/landing.spec.ts` green for the prototype landing surface and app-shell route smoke.
- `pnpm test:unit -- convex/requestAccess.test.ts` green.
- Convex dev deployment accepted `requestAccess:submit` after `npx convex dev --once`; proof response stored a harmless `m1-evidence@example.com` lead and returned an id/status only.

PASS/PARTIAL table:

| Item | Status | Notes |
|---|---:|---|
| Design tokens/fonts/icons/tabular figures | PASS | Implemented in the web app with local fonts and the single OpenBooks green. |
| Shared primitives | PASS | Implemented production equivalents on shadcn/lucide bases; future screens may expand variants as real workflows land. |
| App shell desktop/mobile | PASS | All required routes render; mobile bottom tabs present. |
| Prototype landing content | PASS | Ported from `OpenBook - Prototype/Landing.dc.html` with screenshot assets copied into `apps/web/public/prototype-assets/shots/`. |
| Request-access storage | PASS | Convex mutation unit-tested and live dev write evidenced. |
| Plunk request-access notification | PARTIAL | Action sends notification when `PLUNK_SECRET_KEY`, `PLUNK_FROM_EMAIL`, and `OWNER_EMAIL` exist; no Plunk key was configured during M1 evidence, so notification is fixture/skipped mode. |

Next:

- M2 — invite-only auth gate, owner login, invites, and Settings leads view.

### 2026-06-11 02:10 CDT — M2 Auth + invite gate

What changed:

- Added Convex Auth password sign-in with an OpenBooks-styled `/sign-in` page.
- Added `invites` and `workspaceMembers` tables plus server-side authorization helpers that derive the user from Convex Auth and require an active workspace role before protected reads.
- Enforced invite-only account creation: `OWNER_EMAIL` is allowed; pending invites are allowed; all other password sign-up attempts are rejected with the request-access path.
- Added owner bootstrap from env through `authAdmin:bootstrapOwner`. It reads `OWNER_EMAIL` and `OWNER_PASSWORD` inside Convex, creates or updates the owner password credential, and ensures the owner workspace membership exists. Evidence output records status only, not the secret.
- Bootstrapped the owner workspace and role. Owner login now lands on Dashboard; signed-out app routes show an invite gate.
- Added Settings → Request-access leads, backed by Convex and protected by admin/owner authorization.
- Fixed a React 19 async form bug in request-access intake by capturing the form element before awaiting the Convex action.
- Added Playwright acceptance for owner login, blocked random registration, and public request-access submission visible to the owner in Settings.

Evidence:

- `docs/initiation/evidence/2026-06-11-m2-convex-auth-setup.txt`
- `docs/initiation/evidence/2026-06-11-m2-convex-dev-after-bootstrap-retry1.txt`
- `docs/initiation/evidence/2026-06-11-m2-owner-bootstrap.txt`
- `docs/initiation/evidence/2026-06-11-m2-authz-unit.txt`
- `docs/initiation/evidence/2026-06-11-m2-verify.txt`
- `docs/initiation/evidence/2026-06-11-m2-e2e.txt`
- `docs/initiation/evidence/2026-06-11-m2-sign-in-desktop.png`
- `docs/initiation/evidence/2026-06-11-m2-sign-in-mobile.png`
- `docs/initiation/evidence/2026-06-11-m2-dashboard-gate-desktop.png`
- `docs/initiation/evidence/2026-06-11-m2-dashboard-gate-mobile.png`
- `docs/initiation/evidence/2026-06-11-m2-owner-dashboard-desktop.png`
- `docs/initiation/evidence/2026-06-11-m2-settings-leads-desktop.png`
- `docs/initiation/evidence/2026-06-11-m2-settings-leads-mobile.png`

Verification:

- `pnpm verify` green: typecheck, lint, Next.js production build, Vitest.
- `pnpm test:unit -- convex/authz.test.ts convex/requestAccess.test.ts` green.
- `pnpm test:e2e -- tests/e2e/landing.spec.ts tests/e2e/auth.spec.ts` green with 5 passing tests.
- `npx convex run authAdmin:bootstrapOwner` returned `{"status":"updated"}` with no secret output.

PASS/PARTIAL table:

| Item | Status | Notes |
|---|---:|---|
| Convex Auth password provider | PASS | Password sign-in is active in Convex Auth. |
| Invite-only gate | PASS | Owner allowlist and pending invites can create accounts; random public sign-up is rejected. |
| Owner credential bootstrap | PASS | `authAdmin:bootstrapOwner` creates/updates owner credential from env and was run successfully. |
| Workspace bootstrap | PASS | Owner has active workspace membership and lands on Dashboard. |
| Settings leads | PASS | Public request-access lead appears in protected Settings view for owner. |
| Server authorization helper | PASS | Protected lead listing rejects unauthenticated access and allows active owner workspace role. |
| Plunk request-access notification | PARTIAL | Notification remains env-gated/fixture mode when Plunk env is absent or unavailable; lead storage is not blocked. |

Notes:

- `npx @convex-dev/auth` configured `JWT_PRIVATE_KEY` and `JWKS` in the Convex dev deployment. The evidence file shows only env names/status.
- One `npx convex dev --once` retry was needed after a transient network timeout; the retry succeeded.

Next:

- M3 — ledger core: chart of accounts, single `postEntry` mutation, immutability, reversal/repost, period lock, audit events, and invariant tests.

### 2026-06-11 02:30 CDT — M3 Ledger core

What changed:

- Added the ledger foundation schema: `entities`, `ledgerAccounts`, `journalEntries`, `journalLines`, and `periodLocks`, tied back to workspace authorization.
- Added chart-of-accounts seeding for the demo services entity with 30+ asset, liability, equity, income, expense, and system accounts.
- Added the single ledger write path: `ledger.postEntry`. It rejects unbalanced entries, requires at least two lines, stores integer minor-unit debits/credits, blocks locked periods, records `reversesEntryId` reversals, and writes audit events.
- Added `ledger.setPeriodLock` and `ledger.updateAccount` for setup/accounting controls without creating posted ledger activity outside `postEntry`.
- Added Settings → Accounting with chart initialization, a minimal CoA editor, manual journal entry form, General Ledger view, Trial Balance view, and period lock control.
- Added ledger invariant tests for balance rejection, balanced posting, reversal + repost, locked-period rejection, randomized balanced sequences, and authorization.
- Added Playwright acceptance for manual JE → GL → Trial Balance difference $0.00, plus locked-period backdating rejection.

Evidence:

- `docs/initiation/evidence/2026-06-11-m3-ledger-unit-focused.txt`
- `docs/initiation/evidence/2026-06-11-m3-verify.txt`
- `docs/initiation/evidence/2026-06-11-m3-e2e.txt`
- `docs/initiation/evidence/2026-06-11-m3-convex-dev-once.txt`
- `docs/initiation/evidence/2026-06-11-m3-convex-ledger-query-probe.txt`
- `docs/initiation/evidence/2026-06-11-m3-accounting-gl-tb-desktop.png`
- `docs/initiation/evidence/2026-06-11-m3-accounting-mobile.png`
- `docs/initiation/evidence/2026-06-11-m3-period-lock-desktop.png`

Verification:

- `pnpm verify` green: typecheck, lint, Next.js production build, Vitest.
- `pnpm test:unit -- convex/ledger.test.ts` green.
- `pnpm test:e2e -- tests/e2e/landing.spec.ts tests/e2e/auth.spec.ts tests/e2e/ledger.spec.ts` green with 6 passing tests.
- Convex dev deployment was updated with the ledger functions; an unauthenticated probe now fails with `OpenBooks requires sign-in`, proving the function exists and the guard is active.

PASS/PARTIAL table:

| Item | Status | Notes |
|---|---:|---|
| Ledger schema | PASS | Core entity/account/entry/line/lock tables added with workspace alignment. |
| Chart of accounts seed | PASS | Services/demo entity seeds 30+ accounts across all required account types plus system accounts. |
| Single `postEntry` write path | PASS | Only `postEntry` inserts journal entries/lines; setup mutations do not post ledger activity. |
| Balanced invariant | PASS | Unit tests reject unbalanced entries and randomized balanced sequences keep Trial Balance difference at 0. |
| Posted immutability | PASS | No edit mutation exists for posted entries; corrections are represented as reversing entries plus reposts. |
| Reversal + repost | PASS | Reversal lines must exactly invert the original entry and are linked by `reversesEntryId`. |
| Period lock | PASS | Backdated posts at or before the lock date are rejected in unit and browser acceptance. |
| Audit trail | PASS | Entry posting, account edits, CoA seed, and period-lock changes write audit events. |
| Settings → Accounting UI | PASS | CoA editor, manual JE, GL, TB, and period lock controls are present. |

Notes:

- The cloud dev ledger has accumulated harmless M3 manual test entries and request-access test leads. M4 owns idempotent demo reset/reseed.

Next:

- M4 — pipeline stages 1-3 and deterministic 12-month demo seed, with all seeded numbers flowing through `postEntry`.

### 2026-06-11 03:01 CDT — M4 Pipeline + deterministic demo engine

What changed:

- Added operational bookkeeping tables for bank/card accounts, contacts, rules, transactions, inbox items, documents/receipts, invoices, bills, employees, payroll runs, Stripe clearing/payouts, and demo seed run history.
- Added `pipeline.routeTransaction`, covering stages 1-3: duplicate protection, transfer posting, open-record matching, ordered rules, rule hit counts, high-confidence seeded category posting, and forced-review Inbox routing.
- Added deterministic demo seeding for Acme Studio LLC using fixed seed `openbooks-demo-v1-2026-06-11`.
- The seeded books create 922 imported transactions across 12 months; 915 are posted; 12 remain open in Inbox; 120 are labeled for categorization eval; 12 monthly Stripe-style payout entries reconcile through clearing; the whole-year Trial Balance difference is $0.00.
- Added 18 contacts, 14 invoices with paid/open/overdue statuses, 10 bills, 6 employees across USD/PKR/INR, 12 payroll runs, 6 rules with hit counts, 3 matched receipts, and 2 pending receipts.
- Added `reports.seedVerification` and golden May 2026 fixtures for P&L + Balance Sheet verification. May 2026 fixture: income $47,157.00, expense $40,971.45, net income $6,185.55, balance sheet difference $0.00.
- Added Settings → Data with “Reset demo data” and seed status counts, plus `pnpm seed:demo` that signs in through the invite-only UI and runs the reset action without printing env values.
- Updated the existing ledger Playwright test to account for realistic seeded ledger history.

Evidence:

- `docs/initiation/evidence/2026-06-11-m4-convex-dev-once.txt`
- `docs/initiation/evidence/2026-06-11-m4-seed-demo.txt`
- `docs/initiation/evidence/2026-06-11-m4-unit-focused.txt`
- `docs/initiation/evidence/2026-06-11-m4-verify.txt`
- `docs/initiation/evidence/2026-06-11-m4-e2e.txt`
- `docs/initiation/evidence/2026-06-11-m4-settings-data.png`
- `docs/initiation/evidence/2026-06-11-m4-demo-data-panel.png`
- `docs/initiation/evidence/2026-06-11-m4-settings-mobile.png`

Verification:

- `npx convex dev --once` pushed the new Convex functions to the dev deployment after the first seed attempt hit stale remote functions.
- `pnpm seed:demo` green: 922 transactions, 915 posted, 12 Inbox, 120 eval labels, Trial Balance difference $0.00.
- `pnpm test:unit -- convex/pipeline.test.ts convex/seedDemo.test.ts convex/ledger.test.ts` green.
- `pnpm verify` green: typecheck, lint, Next.js production build, Vitest.
- `pnpm test:e2e` green with 6 passing Playwright tests.

PASS/PARTIAL table:

| Item | Status | Notes |
|---|---:|---|
| Pipeline stages 1-3 | PASS | Dedupe, transfer, open-record match, ordered rules, hit counts, auto-post, and Inbox uncertainty are implemented and unit-tested. |
| Seeded demo books | PASS | Fixed-seed Acme Studio LLC generates 12 months of deterministic books with bank/card, Stripe clearing, invoices, bills, payroll, contacts, receipts, rules, and Inbox items. |
| Ledger source of truth | PASS | Seeded postings flow through `pipeline.routeTransaction` and `ledger.postEntry`; invoice, bill, payroll, and settlement postings also use `postEntry`. |
| Labeled eval subset | PASS | 120 transactions carry expected category account ids for M10 categorization evaluation. |
| Idempotent reset | PASS | `seedDemo.resetAndSeed` deletes prior Acme demo data and reseeds stable counts; unit test runs it twice and compares output. |
| Settings reset action | PASS | Settings → Data reset action works; `pnpm seed:demo` exercises it through a browser login. |
| Golden fixtures | PASS | May 2026 P&L and Balance Sheet fixture is committed and tested to the cent; whole-year Trial Balance difference is 0. |
| External sandbox/live data | PARTIAL | M4 is deterministic fixture/demo data only by design; Plaid and Stripe live sandbox connections start in M8/M9. |

Notes:

- First browser seed attempt failed because the remote Convex dev deployment had not yet registered the new `seedDemo` functions. After `npx convex dev --once`, the same command succeeded.

Next:

- M5 — wire Dashboard, Inbox, Transactions, CSV import, and transaction drawers to the ledger-backed demo data.

### 2026-06-11 04:15 CDT — M5 Core screens on Convex data

What changed:

- Replaced the placeholder app-shell body with Convex-backed Dashboard, Inbox, and Transactions screens for the Acme Studio LLC demo entity.
- Added `coreViews.dashboard`, `coreViews.inbox`, and `coreViews.transactions` read models that derive cash, P&L, AR/AP, inbox status, income by customer, cash flow, bank reconciliation, receipt preview, audit history, and journal-line views from ledger-backed data.
- Added transaction operations for recategorization, splitting, excluding, confirming Inbox items, and creating "always do this" rules. Recategorization and splits reverse the existing posted entry and repost through `ledger.postEntry`.
- Added Dashboard period controls, click-through financial tiles, cash sparkline, income-by-customer, cash-flow, payroll, and activity panels.
- Added Inbox two-pane review with card types, batch confirm, keyboard navigation, category correction, rule creation, and zero-state behavior.
- Added Transactions filters/status tabs/search, row selection, bulk exclude, inline recategorization, split editor, manual add, lightweight CSV mapper/import, receipt preview, activity history, accounting-line drawer, and reconciliation tile.
- Added a focused M5 Playwright acceptance spec covering dashboard -> inbox -> confirm/rule -> transactions drawer -> reverse+repost recategorization -> split -> manual/CSV import, plus mobile dashboard evidence.

Evidence:

- `docs/initiation/evidence/2026-06-11-m5-convex-dev-once.txt`
- `docs/initiation/evidence/2026-06-11-m5-verify.txt`
- `docs/initiation/evidence/2026-06-11-m5-e2e.txt`
- `docs/initiation/evidence/2026-06-11-m5-dashboard-e2e.png`
- `docs/initiation/evidence/2026-06-11-m5-inbox-e2e.png`
- `docs/initiation/evidence/2026-06-11-m5-transactions-e2e.png`
- `docs/initiation/evidence/2026-06-11-m5-core-mobile-e2e.png`

Verification:

- `npx convex dev --once` green.
- `pnpm verify` green: typecheck, lint, Next.js production build, Vitest.
- `pnpm test:e2e` green: 7 passing Playwright tests, including the new M5 core-screens acceptance spec.

PASS/PARTIAL table:

| Item | Status | Notes |
|---|---:|---|
| Dashboard | PASS | Cash position, sparkline, P&L snapshot, AR/AP, Inbox status, income by customer, cash flow, payroll, activity, period selector, and click-through cards read from Convex ledger-backed views. |
| Inbox | PASS | Two-pane review, categorized card kinds, confirm/correct, rule creation, batch confirm, J/K/E/Enter keyboard handling, and zero-state are covered by the browser flow. |
| Transactions | PASS | Filters, status tabs, search, inline recategorization with reverse+repost, split posting, exclude, manual add, bulk exclude, receipt/activity/accounting drawer, and reconciliation tile are working on demo data. |
| CSV import | PARTIAL | Manual paste/import and duplicate preview work; full AI-assisted column pre-map is intentionally deferred until M10 AI is wired. |
| Mobile core surface | PARTIAL | Mobile Dashboard evidence captured in M5; Inbox and Transactions responsive behavior remain part of the broader acceptance #16 pass. |

Notes:

- The full e2e log includes expected Convex server errors for negative tests: public sign-up rejection and locked-period posting rejection. Both are acceptance assertions, not failures.
- A few M5 Playwright actions use DOM-dispatched clicks to avoid a local pointer-interception issue during automated testing; the same actions are visible and mutation-backed in the UI.

Next:

- M6 — Contacts, Invoices, Bills, Payroll, and remaining Settings screens on Convex data.

### 2026-06-11 04:51 CDT — M6 Contacts, Invoices, Bills, Payroll + remaining Settings

What changed:

- Added `moduleViews.overview`, a server-authorized Convex read model for Contacts, Invoices, Bills, Payroll, Businesses, Rules, and Audit Log data for the active Acme Studio LLC entity.
- Wired Contacts, Invoices, Bills, and Payroll routes into the app shell and replaced the queued placeholders with data-backed screens.
- Added remaining Settings surfaces: Businesses cards, Rules manager with plain-English summaries and hit counts, AI-suggested rule slot, and a filterable Audit Log table.
- Added Contacts directory filters/search and profile KPIs for open A/R, open A/P, yearly activity, history, default-category-as-rule affordance, and merge-duplicate placeholder.
- Added Invoices list/status pipeline, A/R KPIs, composer affordance, and receivables aging matrix.
- Added Bills due-window groups, A/P KPIs, upload-PDF placeholder, bill selection, and bank-match candidates.
- Added Payroll employees/runs/statement views with USD, PKR, and INR local totals, base-currency conversion, print action, and CSV export.
- Added focused M6 unit and browser tests.

Evidence:

- `docs/initiation/evidence/2026-06-11-m6-convex-dev-once.txt`
- `docs/initiation/evidence/2026-06-11-m6-verify.txt`
- `docs/initiation/evidence/2026-06-11-m6-e2e.txt`
- `docs/initiation/evidence/2026-06-11-m6-settings-e2e.png`
- `docs/initiation/evidence/2026-06-11-m6-contacts-e2e.png`
- `docs/initiation/evidence/2026-06-11-m6-invoices-e2e.png`
- `docs/initiation/evidence/2026-06-11-m6-bills-e2e.png`
- `docs/initiation/evidence/2026-06-11-m6-payroll-e2e.png`

Verification:

- `npx convex dev --once` green after pushing the new `moduleViews` function to the dev deployment.
- `pnpm verify` green: typecheck, lint, Next.js production build, Vitest.
- `pnpm test:e2e` green: 8 passing Playwright tests, including the new M6 module acceptance spec.

PASS/PARTIAL table:

| Item | Status | Notes |
|---|---:|---|
| Contacts | PARTIAL | Directory, filters, profile totals, history, and default-category rule affordance work; merge duplicates is a clear placeholder because the schema has aliases but no duplicate-candidate/merge model yet. |
| Settings → Businesses | PARTIAL | Entity cards and Live Sandbox recommendation render; add/archive are UI affordances because the current entity schema has no archived flag and reusable non-demo entity creation still needs a ledger chart seed path. |
| Settings → Rules | PASS | Ordered rules, plain-English summaries, hit counts, on/off state, editor modal, and AI-suggested pending slot render from Convex data. |
| Settings → Audit log | PASS | Filterable when/actor/action/before-after table renders from workspace audit events. |
| Invoices | PARTIAL | Lists, status filters, A/R KPIs, composer shell, and aging matrix work; draft/manual invoice save mutation is still not wired. Stripe send remains M8 by design. |
| Bills | PARTIAL | Due-window groups, A/P KPIs, PDF placeholder, bill selection, and match candidates work; mark-paid settlement mutation is not yet wired. Seeded bill entries already flow through the ledger. |
| Payroll | PARTIAL | Employees, runs, FX/base conversion, 3-currency printable statement, and CSV export work; approve/mark-paid mutations and persisted per-run line adjustments are not yet schema-backed. |

Notes:

- First M6 browser attempts exposed a deployment/env issue: the browser was waiting on new `moduleViews` before `npx convex dev --once` had made it callable on the dev deployment. After pushing functions, the same module route tests passed.
- Full e2e logs still include expected negative-test Convex errors for random sign-up rejection and locked-period posting rejection.

Next:

- M7 — Reports and export. Omar's report/export worker slice is parked in stash `m7-worker-slice` and ready for main-thread integration.

### 2026-06-11 05:08 CDT — M7 Reports + export

What changed:

- Added `reportViews.reportPack`, a server-authorized Convex reports engine that queries journal entries, journal lines, accounts, AR/AP records, contacts, payroll runs, and bank accounts.
- Wired the Reports route with a shared viewer: range presets, custom start/end dates, compare selector, monthly/quarterly/total columns, cash/accrual toggle, CSV export, CSV bundle export, JSON export, and drill-down sheet data.
- Shipped report surfaces for Monthly Review, Profit & Loss, Balance Sheet with Balanced chip, Cash Flow, AR Aging, AP Aging, Expenses, Income by Customer, Payroll Summary, General Ledger, Trial Balance, and Journal Entries.
- Added Settings → Data export buttons for CSV bundle and JSON export; export queries skip cleanly before demo data is seeded.
- Added `reports-export.ts` helpers and browser evidence that saves real CSV/JSON files into `docs/initiation/evidence/`.
- Added golden report unit coverage proving accrual vs. cash basis changes AR/AP-dependent P&L figures, Balance Sheet difference is zero, Trial Balance difference is zero, and AR/AP aging totals match source records.

Evidence:

- `docs/initiation/evidence/2026-06-11-m7-convex-dev-once.txt`
- `docs/initiation/evidence/2026-06-11-m7-verify.txt`
- `docs/initiation/evidence/2026-06-11-m7-e2e.txt`
- `docs/initiation/evidence/2026-06-11-m7-reports-e2e.png`
- `docs/initiation/evidence/2026-06-11-m7-settings-export-e2e.png`
- `docs/initiation/evidence/2026-06-11-m7-monthly-review.csv`
- `docs/initiation/evidence/2026-06-11-m7-settings-export-sample.csv`
- `docs/initiation/evidence/2026-06-11-m7-settings-export.json`

Verification:

- `npx convex dev --once` green.
- `pnpm verify` green: typecheck, lint, Next.js production build, Vitest. Unit total is 8 files / 19 tests.
- `pnpm test:e2e` green: 9 passing Playwright tests, including the M7 report/export acceptance spec.

PASS/PARTIAL table:

| Item | Status | Notes |
|---|---:|---|
| Reports engine | PASS | Report pack derives from journal lines/accounts and related source records, with server-side workspace/entity authorization. |
| Shared viewer controls | PASS | Presets, custom range, compare selector, monthly/quarterly/total columns, cash/accrual toggle, and drill-down sheet are wired. |
| Report suite | PASS | Monthly Review, P&L, Balance Sheet, Cash Flow, AR/AP Aging, Expenses, Income by Customer, Payroll Summary, GL, Trial Balance, and Journal views render. |
| Balanced reports | PASS | Balance Sheet and Trial Balance differences are covered in unit tests and visible in browser acceptance. |
| Per-report CSV export | PASS | Browser test saves Monthly Review CSV; export helper supports every report id. |
| Settings data export | PARTIAL | Settings exports a reports CSV bundle plus report-pack JSON. It is not yet a zipped raw-table archive of every operational table. |

Notes:

- Full e2e logs include expected negative-test Convex errors for blocked self-registration and locked-period posting rejection.
- The Settings export query skips until demo seed status exists; this avoids blocking the reset flow in a brand-new workspace.

Next:

- M8 — Stripe test-mode E2E on a Live Sandbox entity. M6 left Live Sandbox creation as a UI affordance; the next milestone needs either a dedicated entity-creation mutation with chart seeding or a fixture-backed Live Sandbox entity setup.

### 2026-06-11 05:57 CDT — M8 Stripe test mode E2E

What changed:

- Added an idempotent `ledger.ensureLiveSandboxEntity` mutation and wired Settings → Businesses so the owner can create/refresh the non-demo "Live Sandbox" entity with its own services chart of accounts.
- Added Settings → Connections with a Stripe test-mode panel bound explicitly to the Live Sandbox entity, not Acme Studio LLC.
- Added `convex/stripe.ts`: environment key-state validation, live-key rejection, fixture fallback, Stripe test customer/payment/invoice seeding, sync/apply projection, clearing-account postings, payout reconciliation, payout mismatch inbox card creation, and Send via Stripe invoice action.
- Seed/sync posts accounting impact only through `ledger.postEntry`; no Stripe path writes journal entries directly.
- Fixed Stripe test PaymentIntent creation by disabling redirect payment methods for confirmed test card payments.
- Fixed the Transactions read model after repeated Stripe runs exposed a Convex document-read limit: transaction activity now reads a capped recent workspace audit feed instead of collecting every workspace audit event.
- Added M8 browser coverage for Live Sandbox creation and Stripe validation/seed/sync/invoice; tightened ledger e2e selectors after the new Stripe invoice form introduced another "Amount" field.

Evidence:

- `docs/initiation/evidence/2026-06-11-m8-convex-dev-once.txt`
- `docs/initiation/evidence/2026-06-11-m8-verify.txt`
- `docs/initiation/evidence/2026-06-11-m8-e2e.txt`
- `docs/initiation/evidence/2026-06-11-m8-stripe-e2e.txt`
- `docs/initiation/evidence/2026-06-11-m8-live-sandbox-settings-e2e.png`
- `docs/initiation/evidence/2026-06-11-m8-stripe-settings-e2e.png`
- `docs/initiation/evidence/2026-06-11-m8-stripe-object-ids.json`
- `docs/initiation/evidence/2026-06-11-m8-regression-e2e.txt`

Stripe object IDs captured from test mode:

- PaymentIntents: `pi_3Th6EWGzLxUQ7bIM1RyQJkm4`, `pi_3Th6EVGzLxUQ7bIM1saiWDhL`, `pi_3Th6EVGzLxUQ7bIM14xHsbuo`
- Invoices: `in_1Th6EsGzLxUQ7bIMnFbmgyPV`, `in_1Th6EbGzLxUQ7bIMGxQ0DdIN`, `in_1Th6EZGzLxUQ7bIMtQ6zox8j`
- Payouts listed from test mode: `po_1S0uXNGzLxUQ7bIMJe4GpGCY`, `po_1RqlGgGzLxUQ7bIMIuNMsRSG`, `po_1RfWS5GzLxUQ7bIM3QeFyYNc`

Verification:

- `npx convex dev --once` green after deploying the new ledger and Stripe functions.
- `pnpm verify` green: typecheck, lint, Next.js production build, Vitest. Unit total is 9 files / 23 tests.
- `pnpm test:e2e` green: 11 passing Playwright tests.
- Targeted regression run green for the previously failing core Transactions and Ledger specs.
- Secret scan over M8 files found no committed key values; the only match was the literal live-key rejection guard.

PASS/PARTIAL table:

| Item | Status | Notes |
|---|---:|---|
| Live Sandbox entity | PASS | Settings → Businesses creates/refreshed `live-sandbox` as a non-demo services/USD entity with its own chart of accounts. |
| Stripe env-key state | PASS | UI shows configured-from-environment state; backend rejects live keys and falls back to fixtures when no safe test key exists. |
| Permission/checklist UI | PASS | Stripe panel shows workspace/entity/key/clearing/payout checklist and clear test/fixture state. |
| Test account seed | PASS | Browser e2e seeds Stripe test customers, PaymentIntents, and invoices when a safe test key is present. |
| Manual sync | PASS | Sync applies customers, income transactions, invoices, and payouts to the Live Sandbox entity. |
| Clearing/payout reconciliation | PASS | Gross, fee, and payout movement post through `postEntry`; fixture and recorded payout drill-downs show $0 drift and mismatch behavior. |
| Send via Stripe | PASS | Invoice composer creates/finalizes a Stripe-hosted invoice in test mode or returns a fixture result when Stripe is unavailable. |
| Cron/webhook automation | PARTIAL | Manual sync works. The 4-hour cron and webhook HTTP registration remain M12/M8-follow-up work. |
| Persistent payout line drilldown | PARTIAL | The panel shows fixture line drill-downs and recorded payout totals. Real payout line persistence needs a child table to avoid unbounded arrays. |

Notes:

- Per goal §5, no attempt was made to match Stripe payouts to Plaid deposits across sandboxes.
- Full e2e logs include expected negative-test Convex errors for blocked self-registration and locked-period posting rejection.

Next:

- M10 — AI on Bedrock: pipeline stages 4-6, categorization eval, degraded mode, and chat panel.

### 2026-06-11 06:27 CDT — M9 Plaid sandbox E2E

What changed:

- Added Settings → Connections → Bank beside the Stripe panel, bound to the same non-demo Live Sandbox entity.
- Added `convex/plaid.ts` and `convex/plaid.test.ts` with Plaid sandbox env-state checks, Link-token preparation, `/sandbox/public_token/create` bypass, account preview/selection, idempotent Plaid bank-account creation, manual fixture sync, `removed` transaction handling, posted-entry reversal for removed Plaid items, pending→posted carry-over heuristics, `ITEM_LOGIN_REQUIRED` connection inbox cards, and Plaid personal finance category priors.
- Added a fixture fallback when Plaid sandbox calls return runtime credential errors. The local Plaid env names were present, but Plaid returned `INVALID_CREDENTIALS`, so the browser acceptance path ran in fixture mode without printing or committing any key values.
- Added a compact "Recent bank imports" proof list in the Bank connection panel so synced Plaid-shaped transactions are visible immediately with review status and "Plaid prior" metadata.
- Added `tests/e2e/plaid.spec.ts` covering fixture data, owner sign-in, Live Sandbox creation/refresh, Link preparation, sandbox public-token bypass, account selection, manual sync, recent imported transactions, and relink simulation.

Evidence:

- `docs/initiation/evidence/2026-06-11-m9-convex-dev-once.txt`
- `docs/initiation/evidence/2026-06-11-m9-verify.txt`
- `docs/initiation/evidence/2026-06-11-m9-e2e.txt`
- `docs/initiation/evidence/2026-06-11-m9-plaid-fixture-mode.json`
- `docs/initiation/evidence/2026-06-11-m9-plaid-settings-e2e.png`

Verification:

- `npx convex dev --once` green after deploying the Plaid functions.
- `pnpm verify` green: typecheck, lint, Next.js production build, Vitest. Unit total is 10 files / 33 tests.
- `pnpm test:e2e -- plaid` green: 2 passing Plaid Playwright tests.
- Full `pnpm test:e2e` green: 13 passing Playwright tests.
- Secret scan over M9 implementation/evidence found no committed key values. Matches were documented placeholder names in `access-and-questions.md` and generated Playwright report code.

PASS/PARTIAL table:

| Item | Status | Notes |
|---|---:|---|
| Bank connection UI | PASS | Settings renders Bank connection next to Stripe for the Live Sandbox entity. |
| Env-key state | PASS | UI reports configured/missing/fixture state without exposing values. Runtime `INVALID_CREDENTIALS` falls back to fixtures and is logged here as a credential blocker. |
| Link launch | PARTIAL | Link token preparation works. Full embedded Plaid Link UI is not mounted; automated tests use the allowed sandbox public-token bypass. |
| Account selection | PASS | Preview accounts show checkboxes, masks, balances, and create/refresh ledger-backed bank accounts idempotently. |
| Manual sync now | PASS | Manual fixture sync creates transactions through `pipeline.routeTransaction`; the panel shows recent imports with Plaid prior metadata. |
| Cursor/removed engine | PASS | Unit coverage normalizes cursor responses, handles `removed`, and reverses posted ledger entries through `postEntry` when needed. |
| 4-hour cron | PARTIAL | Not enabled. Current ledger posting requires an authenticated actor; adding a safe system actor for scheduled posting is a separate design decision. |
| Custom sandbox user JSON | PASS | `openbooks_user_transactions_dynamic` is documented in code and used for sandbox public-token request construction. |
| `ITEM_LOGIN_REQUIRED` relink | PASS | Simulated relink creates/dedupes a connection inbox card and renders in the Bank panel. |
| Plaid PFC prior | PASS | `personal_finance_category` is captured into transaction rawDescription/pipeline metadata and verified by unit + browser evidence. |
| Pipeline stages 1-3 | PASS | Synced items route through the existing dedupe/match/rule pipeline and never write journal entries directly. |
| Durable Plaid access token storage | PARTIAL | Real access tokens are not stored. This avoids introducing unencrypted bank credentials before the encrypted-token storage decision is implemented. |
| Transactions register | PARTIAL | Live Sandbox Plaid imports are visible in the Bank panel's recent imports. A full app-wide entity switcher so `/transactions` can view Live Sandbox instead of Acme remains a product gap. |

Notes:

- The Plaid sandbox credentials present in local env returned `INVALID_CREDENTIALS`; dependent real-sandbox Link/sync behavior is fixture-mode until valid sandbox credentials are provided.
- Full e2e logs include expected negative-test Convex errors for blocked self-registration and locked-period posting rejection.

### 2026-06-11 00:44 CDT — Pre-goal access readiness

What changed:

- Filled `.env.local` with allowed sandbox/test/local values only: Plaid sandbox, Stripe test mode, AWS Bedrock, owner bootstrap fields, and Convex/Vercel project metadata. Tightened `.env.local` permissions to owner-only.
- Created and linked Convex cloud dev project `z360/openbooks`, deployed current Convex functions, and set required nonblank server env vars in the Convex dev deployment. `CONVEX_SITE_URL` was not set manually because Convex reports it as built-in.
- Linked Vercel project `z360/openbooks` locally. GitHub attachment and monorepo framework/root configuration remain M12 setup items.
- Checked Vercel domains under the active `z360` scope; `ansarullahanas.com` was not listed.
- Installed Convex AI guidance files and read `convex/_generated/ai/guidelines.md`; read local Next.js 16.2.7 docs index and sampled App Router, server/client component, font, route handler, and env-var guidance.

Evidence:

- Stripe test balance endpoint reachable.
- Plaid sandbox institutions endpoint reachable.
- AWS STS accepted credentials; Bedrock catalog reachable; configured chat and embeddings model IDs recognized.
- `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass locally.

Verification:

- This is not marked as M0 complete. Remaining M0 work: create `pnpm preflight`, wire `pnpm verify`, add Vitest/Playwright scaffolding, record final redacted preflight output, and commit the milestone.

Next:

- Start M0 implementation with the access foundation already in place.

### 2026-06-11 01:00 CDT — Personal Vercel production deploy

What changed:

- Relinked the project to `ansar-ullah-anas-projects/openbooks`, the Vercel scope that owns `ansarullahanas.com`.
- Added Vercel build configuration for the monorepo and set `NEXT_PUBLIC_CONVEX_URL` in Vercel production env.
- Added Next.js monorepo build configuration: `turbopack.root` and `outputFileTracingRoot` point to the workspace root so Vercel's Next 16/Turbopack build can resolve workspace dependencies.
- Deployed production to Vercel and attached `openbooks.ansarullahanas.com` to the project.

Evidence:

- Production deployment ready: https://openbooks-flax.vercel.app
- Deployment inspect URL: https://vercel.com/ansar-ullah-anas-projects/openbooks/B942NoV4C5rFJfczxZaG6FH4gQ7q
- `curl -I -L https://openbooks-flax.vercel.app` returned HTTP 200.
- Vercel domain inspect reports required DNS: `A openbooks.ansarullahanas.com 76.76.21.21`.

Verification:

- `pnpm lint` green.
- `pnpm build` green.
- `vercel build --prod` green before deploy.

Next:

- Add the Hostinger DNS record, then re-check `https://openbooks.ansarullahanas.com` after propagation.

## History — 2026-06-11 (early) initiation pass (pre-goal, kept for the record)

Completed:

- Created branch `initiation`; read Fable docs, prototype, design system.
- Researched Codex Goals, Convex env/self-hosting, Vercel env/deploy, Plaid
  Sandbox, Plaid Transactions Sync, Stripe test mode.
- Verified baseline: `pnpm typecheck` / `lint` / `build` pass;
  `pnpm exec convex dev --once` prepared local functions;
  `vercel whoami` → `ansar-8590`; `pnpm dev` rendered at `localhost:3000`.
- Created initiation docs; updated README, AGENTS.md, flow.md, LICENSE
  (AGPL-3.0), `.gitignore`, `.env.example`.

Baseline gaps at that time (now addressed by the M0–M13 plan): no auth E2E, no
invite gate, no contact form, no ported screens, no ledger, no Plaid/Stripe,
no AI, no linked Vercel project.

Env note: `pnpm exec convex dev --once` generated `.env.local` with local
Convex values; `env.local` is a git-ignored reference copy of secrets from the
other machine — values are distributed per access-and-questions.md §3.

## 2026-06-11 (later) — plan revision (Claude architecture pass)

- Rewrote goal.md as an acceptance-first completion contract (cookbook-aligned:
  outcome, verification surface, constraints, boundaries, iteration policy,
  blocked-stop).
- Rebuilt task-list.md into milestones M0–M13 with per-milestone evidence.
- Rewrote launch-prompt.md as `/goal` text + kickoff prompt with subagent and
  anti-spin directives.
- Converted access-and-questions.md into the pre-launch runbook + decision log
  (Bedrock AI, keys-from-env, two-entity demo architecture, full prod deploy).
- Added acceptance.md (18-point walkthrough) and this report structure.
- Copied the four Fable docs to `docs/product/01–04` as canonical references;
  marked `docs/product/bootstrap-scope.md` superseded.
