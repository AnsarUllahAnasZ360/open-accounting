# OpenBooks Launch Sprint — Completion Report

**Date:** 2026-06-20
**Branch:** `launch-sprint-build` (built on the consolidated `codex/real-world-testing` work)
**Status:** All 15 epics / 147 tickets code-complete. Full test suite green. Server boots and serves.

This is the human-readable "what's now in the branch and how to check it" note. It is
deliberately plain-English; the per-ticket detail lives in `docs/launch-sprint/epics/`
and the live feed in `progress.html` / `progress.ndjson`.

---

## 1. The headline

Everything that made the product "feel broken" is fixed, and the launch-defining
features are built. Concretely, what was wrong before and is now done:

- **Your books will tie out.** Connecting a bank now books an **opening balance**
  (so equity is no longer $0), Stripe payouts **reconcile** (the ~$458k phantom
  "in-transit" asset drains), fixture/demo data is **gated to demo entities only**
  (it no longer pollutes real books), and confident transactions **post to the
  ledger** instead of piling up uncategorized in the Inbox.
- **You can bring your own AI key.** Settings → AI is now a real provider switcher
  (14 providers) with an encrypted key store — no more "set in Convex env" dead UI.
  This was the upstream cause of the categorization backlog.
- **The AI CFO is live.** Runway/burn, tax set-aside, revenue concentration,
  anomaly detection, plus a weekly digest — every number grounded in the ledger.
- **Portfolio view works.** An All / Zikra / Z360 scope switcher with consolidated
  reports and intercompany elimination, while each LLC keeps legally-separate books.
- **Guided onboarding** is a real, resumable flow (multi-business, BYO keys,
  opening balances, AI proposal review) that lands you on a populated org.
- **A stranger can try it** at a no-login `/demo`, and a developer can **self-host**
  it via a setup skill, `/setup` + `/security` pages, and a generalized preflight.

## 2. What I verified (and how)

- **Full gate green:** `pnpm verify` passes end-to-end — typecheck + lint + build +
  **574 unit tests across 98 files** — and `convex tsc` is clean.
- **Server smoke test:** `pnpm dev:full` boots, the Convex backend (new tables and
  functions: unified credentials, intercompany, digest log, CFO signals, etc.)
  **deploys to your cloud deployment with no errors**, and the public routes all
  return HTTP 200: `/`, `/sign-in`, `/demo`, `/security`, `/setup`.
- **Accounting invariants:** the double-entry rules are covered by tests (debits =
  credits, only the single posting path writes journals, reverse-and-repost,
  per-payout Stripe clearing nets to zero, trial balance nets to zero). The ledger
  posting path was treated as sacred throughout.
- **Process:** every batch was built by one agent and independently re-checked by a
  separate verify agent (which repaired real defects mid-flight — e.g. a payroll
  insight contract, a portfolio scope mislabel, default-business ordering). I then
  ran the final gate and the server smoke test myself, independent of the agents.

## 3. How to run it and what to look at first

```
git checkout launch-sprint-build
pnpm install
pnpm dev:full          # boots Next on http://127.0.0.1:3100 + your Convex cloud
```
Open http://127.0.0.1:3100, go to `/sign-in` → "Continue as local dev owner"
(or use OWNER_EMAIL / OWNER_PASSWORD). Then, in rough priority order:

1. **Settings → AI** — confirm you can pick a provider and paste your own key.
2. **Dashboard** — the AI CFO advisor panel (runway/burn/tax/anomalies) + the
   "Bank says / Books say" cash reconciliation line.
3. **Business switcher (top)** — try **All** vs **Zikra** vs **Z360** (Portfolio).
4. **Reports** — Cash Flow (now responsive), prior-period compare columns, CSV
   export, drill-down from any number, and the basis/unreviewed banners.
5. **Transactions** — the register, provenance chips, mobile card view.
6. **Settings → Connections** — the four-provider card layout, copyable Plaid
   redirect + Stripe webhook URLs, validate/relink actions.
7. **`/demo`** logged-out — the public, read-only demo.

## 4. Honest caveats (read this before you call it "shipped")

- **A few evidence screenshots weren't captured.** Three items (E7-11 register
  shots, E10-T1 payroll detail, four E12 settings e2e captures) are **code-complete
  with passing gates** — the only missing piece is PNG artifacts, which need a
  *seeded, onboarded* workspace to capture. Locally the e2e lands on the onboarding
  wizard, so the screenshots are pending a seeded run. This is an artifact gap, not
  a code gap.
- **Real-world external validation still needs you.** I verified the code, the unit
  invariants, and that the app boots and the backend deploys. I did **not** run a
  live Plaid Link session against your real bank or deliver a real Stripe webhook —
  those need your live keys and a human in the Plaid/Stripe flow. The first time you
  connect real accounts is the real test of the correctness fixes end-to-end.
- **Your existing cloud data may need a re-sync/re-categorize pass** to benefit from
  the fixes (opening balances, the matcher, confident posting apply on connect/sync
  and via the backlog drainer; historical rows already in the Inbox will be drained
  by the new categorizer, but give it a pass).
- **Payroll module:** the separate `feat/payroll-module` branch was **not** merged
  (it was on a stale base); E10 was built fresh on this branch instead. The old
  branch is preserved as `salvage/payroll` if you ever want to compare.
- **The verify lane is agents checking agents.** It's rigorous (independent
  re-check + adversarial ledger checks) and I added an independent final gate, but
  it is not a substitute for your own hands-on pass — which is exactly what this
  branch is now ready for.

## 5. Safety / housekeeping

- Nothing was lost: the original stranded work is preserved as `salvage/*` tags and
  the `backup/pre-consolidation-20260620` branch.
- **Not** merged to `main`. **Not** deployed to Vercel (per your instruction).
- All decisions I made autonomously are logged in `autonomous-run-log.md`.
- The build ran on one branch with continuous commits and no worktrees, as asked.

## 6. Suggested next step

Run it, click through section 3, and connect one real account. Send me what looks
wrong as plain feedback and I'll iterate. When you're happy, the
`github-publication-checklist.md` is the one-pass path to flipping it public.
