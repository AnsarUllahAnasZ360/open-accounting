# OpenBooks `finishing` — What's Left (handoff for a fresh session)

Date: 2026-06-12 · Branch: `finishing` · Author: Codex continuation

This is the **single source of truth for picking the work back up in a new chat.**
Read it with `docs/finishing/implementation-plan.md` (the full epic contract) and
`docs/finishing/completion-report.md` (the dated, evidence-linked status log).

---

## 0. TL;DR

The accounting-integrity half and most product-shell work are **committed and
green**. What remains is the first-run onboarding surface, the live money rails,
and the final verification closeout.

- **Committed & verified:** app shell · Ask AI engine + docked panel (B1–B5) ·
  Settings (E) · profile/invite/dev-full pieces of F · Reports · Payroll ·
  Income/Expenses/Bills (incl. invoice-save & bill-mark-paid).
- **Current G status:** Plaid G1a+G2 now have the real Link client surface,
  action-level exchange/persist proof, item-level cursor state, system actor,
  4-hour cron, verified webhook receiver, real `/transactions/sync` action, and
  Settings `Sync now` control. Stripe G3 now has event dedupe, targeted
  invoice/charge/payout sync, `system:sync` ledger posting, and persisted
  `stripePayoutLines`. Row #3 is still **PARTIAL** until a hosted Plaid Link
  session produces a real sandbox item and that item sync is proven end to end;
  row #4 is still **PARTIAL** until a real Stripe CLI/Dashboard test webhook is
  delivered to the deployed route.
- **Still open:** F1 onboarding stepper · B6 post-import AI run history · G4-G5
  receipts/entity read models · Stripe webhook delivery proof · H verification
  closeout · prod redeploy only if Ansar reauthorizes it.

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
| 1 | Workspace + business creation via onboarding | ❌ Epic F1 (E2 adds `entities.create`) |
| 2 | Shell: collapse rail, footer profile/settings/logout, ⌘K, switcher, Ask AI ⌘J | ✅ WORKING |
| 3 | Plaid sandbox real Link → sync → ledger/inbox | ◑ PARTIAL → G1a UI/exchange + G2 server sync path done; needs hosted Plaid item proof |
| 4 | Stripe test mode event-driven sync + payout reconcile | ◑ PARTIAL → G3 code verified; needs real Stripe CLI/Dashboard webhook delivery proof |
| 5 | Inbox: confirm/correct/rule/batch/keyboard | ◑ PARTIAL → Epic H rewrites assertions |
| 6 | Income/Expenses/Bills/Contacts/Payroll + missing mutations | ✅ WORKING |
| 7 | Reports home→viewer, sane periods, drill-down, cash⇄accrual | ✅ WORKING |
| 8 | Ask AI: streaming, markdown, threads, propose→confirm | ✅ WORKING for B4-B5; B6 import-trigger scheduling remains |
| 9 | Settings: 10-section subnav | ✅ WORKING |
| 10 | Mobile usable at 390px | ◑ PARTIAL → asserted per-screen + Epic H |

---

## 3. What's left, in recommended order

Each item points at the authoritative spec in `implementation-plan.md`. Do one
epic = one tightly-scoped batch; integrate, run BOTH gates + e2e, commit.

### A. Epic E — Settings verification — DONE
Row #9 is **WORKING** with `tests/e2e/settings.spec.ts` 3/3,
`convex/settings.test.ts` 4/4, screenshots, and gates. Remaining
settings-adjacent work belongs to later epics: full entity-scoped read switching
is G5.

### B. Ask AI panel UI — B4-B5 DONE; B6 remains with imports/pipeline
B4-B5 are **WORKING** with `tests/e2e/ai-chat.spec.ts` 4/4 and screenshots:
durable threads, markdown, proposal confirmation cards, docked desktop panel,
full-page `/ask-ai`, and mobile sheet. B6 post-import categorizer scheduling/run
history is still **PARTIAL** and should be handled with Epic G import/pipeline
work because it depends on Plaid/Stripe/CSV ingestion events.

### C. Epic F — Identity (profile, invites, dev-mode) — PARTIAL
F2-F4 are evidenced: `/profile` + `userProfiles`; team invite copy-link +
`/invite/[token]` accept; Staff role hides/blocks Settings; `pnpm dev:full`
cloud-Convex boot reaches ready state with owner bootstrap. Evidence:
`convex/profileTeam.test.ts`, `convex/authz.test.ts`,
`tests/e2e/profile-team.spec.ts`, and Batch F screenshots. Remaining F gaps:
F1 first-run onboarding stepper is **NOT STARTED**; password reset from `/profile`
is **PARTIAL** until Convex Auth reset email is configured; Plunk email delivery
is optional/unconfigured, so invites use copy-link mode.

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
yet been delivered to the cloud route. Next: G4 receipts PDF + persisted vectors
and inbox card, and G5 entity-scoped read models + pagination/`take()` guards.

### E. Epic H — Verification, honest eval, closeout  _(last)_
Plan Epic H. H1 rewrite the legacy e2e specs to real clicks (remove the
`dispatchEvent` ones the shell agent flagged in `core-screens.spec.ts` et al.).
H2 acceptance evidence pack (18 rows, desktop+mobile). H3 **honest categorization
eval** (the old "100%" compared the seed to itself — strip labels, run the
pipeline + live Bedrock, report real accuracy). H4 perf/limits pass. H5
completion-report v2 + refresh `how-openbooks-works.md` + README quickstart +
`AGENTS.md`. Do **not** deploy to Vercel in this run unless Ansar reauthorizes it;
the account context changed.

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
