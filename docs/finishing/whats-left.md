# OpenBooks `finishing` — What's Left (handoff for a fresh session)

Date: 2026-06-12 · Branch: `finishing` · Author: Codex continuation

This is the **single source of truth for picking the work back up in a new chat.**
Read it with `docs/finishing/implementation-plan.md` (the full epic contract) and
`docs/finishing/completion-report.md` (the dated, evidence-linked status log).

---

## 0. TL;DR

The accounting-integrity half and most product-shell work are **committed and
green**. What remains is the live money rails and the final verification
closeout.

- **Committed & verified:** app shell · Ask AI engine + docked panel (B1–B5) ·
  Settings (E) · onboarding/profile/invite/dev-full pieces of F · Reports · Payroll ·
  Income/Expenses/Bills (incl. invoice-save & bill-mark-paid).
- **Current G status:** Plaid G1a+G2 now have the real Link client surface,
  action-level exchange/persist proof, item-level cursor state, system actor,
  4-hour cron, verified webhook receiver, real `/transactions/sync` action, and
  Settings `Sync now` control. Stripe G3 now has event dedupe, targeted
  invoice/charge/payout sync, `system:sync` ledger posting, and persisted
  `stripePayoutLines`. G4 now has receipt PDF text + image upload, text-PDF
  first-page raster-to-Bedrock extraction, linked receipt Inbox cards, persisted
  candidate transaction embeddings, transaction receipt-chip proof, and Create
  expense → balanced ledger posting from an unmatched receipt. G5 is now
  **WORKING**: Live Sandbox and fresh businesses
  drive dashboard/register/reports/module reads with bounded `take()` guards.
  Row #3 is still **PARTIAL** until a hosted Plaid Link session produces a real
  sandbox item and that item sync is proven end to end; row #4 is still
  **PARTIAL** until a real Stripe CLI/Dashboard test webhook is delivered to the
  deployed route.
- **Still open:** Plaid hosted-item proof · Stripe webhook delivery proof ·
  prod redeploy only if Ansar reauthorizes it.

---

## 1. The environment (read this before touching anything)

These were fixed/learned the hard way this session. Violating them wastes hours.

1. **Convex runs in the CLOUD, never locally.** `.env.local` is aligned to the
   cloud dev deployment `z360:openbooks:dev` → `ceaseless-mandrill-524`
   (`https://ceaseless-mandrill-524.convex.cloud`, site `.convex.site`). It is
   fully provisioned: env vars (Bedrock, Plaid, Stripe, auth JWT/JWKS, owner
   creds, dev bypass) **and** seeded data (workspace, Acme Studio LLC demo +
   Live Sandbox entities, owner user, demo books). **Do NOT run a local Convex
   backend** (Ansar's machine can't host it). `npx convex dev --once` just
   *uploads* function code to the cloud and exits.
2. **Two gates, always — `pnpm verify` does NOT typecheck Convex.** `pnpm verify`
   = web typecheck + web lint + web build + vitest. It misses Convex `tsc`
   errors. **After any `convex/` change you MUST also run `npx convex dev --once`**
   (it runs `tsc` over `convex/` and pushes). A latent convex-tsc error slipped
   into a commit this way once.
3. **Convex test helpers must be schema-aware.** Type the test handle as
   `TestConvex<typeof schema>` (import `type TestConvex` from `convex-test`),
   **NOT** `ReturnType<typeof convexTest>` — the latter loses the DataModel, so
   `ctx.db.query(...).withIndex("by_x", ...)` fails convex `tsc` with
   "keyof SystemIndexes".
4. **e2e is real-pointer-clicks only.** `dispatchEvent`/`force:true` are banned.
   `playwright.config.ts` runs `next dev` on port 3100 and **forwards
   `NEXT_PUBLIC_OPENBOOKS_DEV_AUTH_BYPASS`** so the suite boots straight into the
   owner session (next dev runs from `apps/web`, which does NOT auto-load the
   root `.env.local` — this also means plain `pnpm dev` won't pick up env until
   F4 ships `pnpm dev:full`). Specs strip the dev-only `nextjs-portal` overlay in
   a `beforeEach` (that is a Next dev-tools artifact, not a product overlap).
5. **Never mutate the shared demo books in e2e.** approve/pay/finalize/settle
   post real ledger entries to the shared cloud deployment. Verify those
   lifecycles in **in-memory unit tests** (`convexTest`), and keep e2e to
   navigation/read + flows that create-then-clean their own data.
6. **Subagents get killed on big epics (~300k tokens / ~40 min).** A, B, C
   completed; D and E were killed mid-task. Recovery pattern that works: assess
   the tree (`pnpm typecheck` + `npx convex dev --once`), then either **finish
   the remainder in the open** or **relaunch a tightly-scoped completion agent**.
   For the remaining big epics (esp. G), **split into sub-batches** (e.g. G1+G2,
   then G3, then G4, then G5) to stay under the limit.
7. **Honesty contract.** A completion-report row is **WORKING only** with a
   linked green real-click test **and** a screenshot of the behavior as written.
   Otherwise it's **PARTIAL** (named gaps + next step) or **BLOCKED** (exact input
   needed). Don't repeat the prior run's "all green, half-built" failure.
8. **Act on agent-completion notifications immediately** (integrate; don't idle),
   and **commit per batch** with both gates green before moving on.

---

## 2. Committed state (what you can trust)

`git log --oneline` on `finishing`:

- `chore(finishing): align convex to cloud dev, fix backend tsc, scaffold report + deps`
- `feat(ai): rebuild Ask AI backend on @convex-dev/agent (Epic B1-B3)`
- `feat(shell): prototype-faithful app shell & navigation (Epic A)`
- `feat(reports,payroll): reports home->viewer + payroll run lifecycle (Epic D)`
- `feat(income,expenses,bills): money screens + invoice-save & bill-mark-paid (Epic C)`
- _(this session also commits an Epic E checkpoint — see git log for the exact SHA)_

Gates at HEAD before the E checkpoint: `pnpm verify` green (**121/121 unit, 24
files**), `npx convex dev --once` green, shell + reports/payroll + income/expenses
e2e green.

**Acceptance table (north-star §0), current:**

| # | Capability | State |
|---|---|---|
| 1 | Workspace + business creation via onboarding | ✅ WORKING |
| 2 | Shell: collapse rail, footer profile/settings/logout, ⌘K, switcher, Ask AI ⌘J | ✅ WORKING incl. active-entity data switching |
| 3 | Plaid sandbox real Link → sync → ledger/inbox | ◑ PARTIAL → G1a UI/exchange + G2 server sync path done; needs hosted Plaid item proof |
| 4 | Stripe test mode event-driven sync + payout reconcile | ◑ PARTIAL → G3 code verified; needs real Stripe CLI/Dashboard webhook delivery proof |
| 5 | Inbox: confirm/correct/rule/batch/keyboard | ✅ WORKING → disposable-business H2 spec covers keyboard J/K, category correction, rule save, confirm/post, batch confirm, and B6 live AI import split |
| 6 | Income/Expenses/Bills/Contacts/Payroll + missing mutations | ✅ WORKING; receipt upload/chip + create-expense posting + text-PDF raster-to-Bedrock match evidenced |
| 7 | Reports home→viewer, sane periods, drill-down, cash⇄accrual | ✅ WORKING incl. active-entity report reads |
| 8 | Ask AI: streaming, markdown, threads, propose→confirm | ✅ WORKING for B4-B6, including live Bedrock import high/low split |
| 9 | Settings: 10-section subnav | ✅ WORKING |
| 10 | Mobile usable at 390px | ✅ WORKING → H2 real-click pass covers Dashboard, Inbox, Transactions, and Ask AI at 390px with screenshots |

---

## 3. What's left, in recommended order

Each item points at the authoritative spec in `implementation-plan.md`. Do one
epic = one tightly-scoped batch; integrate, run BOTH gates + e2e, commit.

### A. Epic E — Settings verification — DONE
Row #9 is **WORKING** with `tests/e2e/settings.spec.ts` 3/3,
`convex/settings.test.ts` 4/4, screenshots, and gates. Remaining
settings-adjacent active-entity read switching is now covered by G5.

### B. Ask AI panel UI — B4-B6 DONE
B4-B5 are **WORKING** with `tests/e2e/ai-chat.spec.ts` 4/4 and screenshots:
durable threads, markdown, proposal confirmation cards, docked desktop panel,
full-page `/ask-ai`, and mobile sheet. B6 now schedules/import-invokes
categorization for CSV and Plaid paths, records Settings-visible run history,
and uses the `system:sync` actor for background Plaid jobs. Evidence:
`convex/ai.test.ts`, `convex/plaid.test.ts`, and
`tests/e2e/import-ai-b6.spec.ts` with
`docs/finishing/evidence/2026-06-12-B6-csv-ai-batch-history.png`,
`docs/finishing/evidence/2026-06-12-B6-import-split-posted.png`, and
`docs/finishing/evidence/2026-06-12-B6-import-split-inbox.png`: the live
Bedrock proof imports two CSV rows on a disposable business, posts the clear
Adobe software row as `decidedBy: ai`, and keeps the ambiguous adjustment row in
Inbox with reasoning. H2 five-question Ask AI parity is now evidenced by
`tests/e2e/ask-ai-parity-h2.spec.ts` and
`docs/finishing/evidence/2026-06-12-H2-ask-ai-five-question-parity.png`: the
panel answers the five flagship prompts through read-tool traces and reconciles
to independently queried report values.

### C. Epic F — Identity (onboarding, profile, invites, dev-mode) — MOSTLY DONE
F1-F4 are evidenced: new owners can self-register into a full first-run
onboarding stepper, create a workspace + first business + typed chart of
accounts, and land on Dashboard with a persisted setup checklist; `/profile` +
`userProfiles` works; team invite copy-link + `/invite/[token]` accept works;
Staff role hides/blocks Settings; `pnpm dev:full` cloud-Convex boot reaches
ready state with owner bootstrap. Evidence: `convex/onboarding.test.ts`,
`tests/e2e/onboarding.spec.ts`, `convex/profileTeam.test.ts`,
`convex/authz.test.ts`, `tests/e2e/profile-team.spec.ts`, and Batch F/F1
screenshots. Remaining F gaps: password reset from `/profile` is **PARTIAL**
until Convex Auth reset email is configured; Plunk email delivery is
optional/unconfigured, so invites use copy-link mode.

### D. Epic G — Money rails  _(split into sub-batches; needs inputs — see §4)_
G1a+G2 are **PARTIAL and committed/evidenced**: Settings prepares a Plaid
sandbox Link token, mounts the official `react-plaid-link` client only after that
token exists, keeps fixture fallback, unit-proves exchange/persist without
leaking the access token, and now has server-owned Plaid sync: item cursor state,
short sync lock, `system:sync` actor, 4-hour cron, verified
`/plaid/webhook`, real `/transactions/sync`, removal reversals, and a Settings
`Sync now` control. It is **not WORKING** yet because no hosted Plaid Link
session has been completed and then synced from a real sandbox item in the
browser. G3 Stripe is **implemented/evidenced but row #4 remains PARTIAL**:
webhook events dedupe, targeted invoice/charge/payout sync, `system:sync`
posting, invoice status update, and persisted `stripePayoutLines` are covered by
unit tests + Settings e2e, but a real Stripe CLI/Dashboard test webhook has not
yet been delivered to the cloud route. G4 receipt upload is now
**WORKING/evidenced** for generated/vendor PDFs with extractable text and image
uploads: first-page text-PDF raster-to-Bedrock extraction, linked Inbox cards,
persisted candidate transaction embeddings, document-specific suggested match,
transaction receipt chip proof, and Create expense → balanced manual-expense
posting are green in `convex/receipts.test.ts` and
`tests/e2e/receipts-g4.spec.ts`. Honesty caveat: scanned/image-only PDFs are
future hardening, not proven by this batch. G5 is **WORKING/evidenced** with
`convex/coreViews.test.ts`, `tests/e2e/entity-scope-g5.spec.ts`, and screenshots:
Live Sandbox data now appears in the main dashboard/register/reports, fresh
businesses render empty states, and core read models have bounded `take()` guards
plus dashboard read-count stats. Next: collect real Plaid/Stripe external proof
if inputs are available, then run the final H2/H5 evidence cross-check.

### E. Epic H — Verification, honest eval, closeout  _(last)_
H1 first integrity pass is **done/committed in progress**: `tests/e2e` now has
zero `dispatchEvent` / `force:true` code hits, shared helpers exist in
`tests/e2e/helpers.ts`, and `core-screens.spec.ts` no longer resets or mutates
shared demo books. It creates a disposable business, proves dashboard/register
manual import/recategorize/split/CSV/mobile with real clicks, screenshots the
flow, then archives the throwaway business. Remaining H1/H2: rewrite the rest of
the acceptance pack to mirror `docs/initiation/acceptance.md` rows 1-18,
including Inbox keyboard/batch, CSV equals screen, report export equality, and
the final row-by-row cross-check. H2 now has a non-external screenshot pack in
`tests/e2e/acceptance-h2-pack.spec.ts`: Contacts row selection/profile,
Settings Data JSON export download, and Dashboard/Inbox/Transactions/Ask AI at
390px are green with screenshots. H3 **honest categorization eval is done/evidenced**:
the old "100%" compared the seed to itself; the new harness strips route-visible
labels, runs the real Bedrock pipeline on a temporary eval business, and reports
**45/60 correct (75.0%)**, below the 80% target. Evidence:
`docs/finishing/evidence/2026-06-12-H3-categorization-holdout-eval.json` and
`docs/finishing/evidence/2026-06-12-H3-ai-eval-settings.png`. A 120-row live run
recorded 88/119 in Settings but failed before JSON write near the long-action
boundary, so the committed synchronous cap is 60 rows; bigger evals should be a
chunked/background job. H4 **performance/limits is done/evidenced** with
`docs/finishing/evidence/2026-06-12-H4-performance-limits.json`: live Acme
dashboard reads 3,948/5,000 rows, report pack reads 3,920/5,000, register rows
are bounded to 120, and no truncation flags are set. H2 now has a **partial
evidence index** at
`docs/finishing/evidence/2026-06-12-H2-acceptance-evidence-index.md`, and rows
#5 Inbox, #8 Contacts, #10 Reports export equality, #11 Data export, #16 Mobile,
#17 Audit log, row #14 five-question Ask AI report-answer path + B6 live import
split, and row #15 Receipts text-PDF raster-to-Bedrock path are now evidenced.
H2 remains **PARTIAL only for external rows #12 and #13**: Plaid hosted item
proof and Stripe webhook delivery. H5 docs refresh and final evidence-index
cross-check are **WORKING/evidenced**: `README.md`,
`docs/finishing/how-openbooks-works.md`, `AGENTS.md`, this handoff, the
completion report, and the evidence index now match shipped reality and call out
the blocked external proof honestly. Do
**not** deploy to Vercel in this run unless Ansar reauthorizes it; the account
context changed.

---

## 4. Inputs needed from Ansar (otherwise build + degrade gracefully)

- **A completed Plaid hosted sandbox Link session** against the cloud dev backend,
  then `Sync now`/webhook proof on the resulting real sandbox item. If sandbox
  keys have changed, refresh `PLAID_CLIENT_ID` + `PLAID_SECRET` in `.env.local`
  and on the Convex deployment first (`npx convex env set`). Sandbox only, never
  live. Runbook: `docs/initiation/access-and-questions.md` §3.
- **Stripe webhook delivery proof** — `STRIPE_WEBHOOK_SECRET` on the Convex dev
  deployment plus a Stripe CLI/Dashboard test-mode event forwarded to
  `/stripe/webhook`. Stripe test keys only.
- **Plunk** (`PLUNK_SECRET_KEY`, `PLUNK_FROM_EMAIL`) — optional, for F3 invite
  emails; without it the flow shows an honest copy-link state.

None of these block the other epics; G must keep fixture mode working when keys
are absent.

---

## 5. Gate checklist (run before every batch commit)

1. `pnpm verify` → green (typecheck + lint + build + unit).
2. `npx convex dev --once` → green (after any `convex/` change).
3. New/affected `pnpm exec playwright test <spec>` → green, real clicks.
4. Screenshots → `docs/finishing/evidence/YYYY-MM-DD-<epic><task>-<slug>.png`.
5. Update `docs/finishing/completion-report.md` (dated batch entry; WORKING only
   with linked green test + screenshot).
6. Commit per batch (conventional message; never force-push); restore any
   incidental `docs/initiation/evidence/playwright-results/` deletions a test run
   caused (they're gitignored going forward).
