# OpenBooks Finishing — Completion Report

Branch: `finishing` · Lead: Claude (Opus 4.8) · Started: 2026-06-11

## Honesty contract (how to read this report)

This report is the source of truth for what is actually finished. It exists
because the previous run marked 19/20 rows WORKING while the product was
half-built. The rules here are non-negotiable:

- A row is **WORKING** only when a **linked, green Playwright test using real
  pointer clicks** plus a **screenshot** demonstrate the acceptance behavior
  *as written in the plan*. Not "the heading renders" — the behavior.
- Anything short of that is **PARTIAL** with named gaps and the exact next
  step, or **BLOCKED** with the exact input needed.
- No summary row may claim more than its own dated batch log supports.
- Evidence lives in `docs/finishing/evidence/` (`YYYY-MM-DD-<epic><task>-<slug>.png`)
  and `tests/e2e/`. Every WORKING row names both.

Status vocabulary: **WORKING** · **PARTIAL** · **BLOCKED** · **NOT STARTED**.

## Baseline at handoff (2026-06-11, verified by this run)

- `pnpm typecheck` → green.
- `pnpm test:unit` → **77 passed / 17 files**.
- `npx convex dev --once` → green (backend compiles + pushes to the **cloud dev**
  deployment). Surfaced + fixed 2 latent `tsc` errors in
  `convex/aiChatActions.test.ts` (a hand-typed function reference returned
  `entryId: string` instead of `Id<"journalEntries">`); `pnpm typecheck`
  (web-only) and vitest (no typecheck) had both been skipping the convex `tsc`.
- `pnpm test:e2e` → not yet re-run on this branch (Epic H rewrites the suite to
  product-grade assertions; the inherited suite asserts text presence, per audit).

### Convex environment alignment (cloud dev, not local)

Ansar's machine cannot host a local Convex backend. `.env.local` had pointed at a
stale **local** deployment (`local:local-z360-ottex_ai_accounting-1`, an old
project name). Repointed everything at the existing **cloud dev** deployment
`z360:openbooks:dev` (`ceaseless-mandrill-524`):

- `CONVEX_DEPLOYMENT=dev:ceaseless-mandrill-524`,
  `CONVEX_URL` / `NEXT_PUBLIC_CONVEX_URL` → `…convex.cloud`,
  `CONVEX_SITE_URL` → `…convex.site`.
- Verified the cloud dev deployment is fully provisioned: env vars set (Bedrock,
  Plaid, Stripe, auth JWT/JWKS, owner creds, dev bypass) and **data seeded**
  (workspace, Acme Studio LLC demo + Live Sandbox entities, owner user, demo
  transactions + locked journal entries). Missing only `STRIPE_WEBHOOK_SECRET`
  (Epic G3) and Plunk keys (Epic F3, optional).
- `npx convex dev --once`/`dev` push function changes to the cloud — no local
  backend runs. This is the model for `pnpm dev:full` (Epic F4): local Next dev
  server + cloud Convex.

This is the clean, green starting point. Every change below is measured against it.

## Acceptance table (north-star §0, ten capabilities)

Updated as evidence lands. Starts as inherited reality from the audit.

| # | Capability | Status | Evidence | Notes |
|---|---|---|---|---|
| 1 | Workspace + business creation via onboarding | NOT STARTED | — | Epic F1/E2. Today: hardcoded `ansar-workspace`. |
| 2 | Shell: collapsible sidebar, footer profile/settings/logout, ⌘K, entity switcher, Ask AI ⌘J | NOT STARTED | — | Epic A. Today: fixed sidebar, top-bar logout, overlay AI panel. |
| 3 | Plaid sandbox real Link → sync → pipeline → ledger/inbox | NOT STARTED | — | Epic G1/G2. Today: fixture mode only. |
| 4 | Stripe test mode event-driven sync + payout reconcile | PARTIAL | inherited | Epic G3. Webhook receiver real; events trigger nothing yet. |
| 5 | Inbox: confirm / correct / rule / batch / keyboard | PARTIAL | inherited | Epic H rewrites assertions; batch + keyboard unverified. |
| 6 | Income / Expenses / Bills / Contacts / Payroll fully functional incl. missing mutations | NOT STARTED | — | Epics C, D4. Today: invoice save / bill mark-paid / payroll approve-pay absent. |
| 7 | Reports home → viewer, sane periods, drill-down, cash⇄accrual, exports match | NOT STARTED | — | Epic D1/D2. Today: one mega-page, future-dated periods. |
| 8 | Ask AI: Bedrock streaming, markdown, persistent threads, propose→confirm | NOT STARTED | — | Epic B. Today: hardcoded keyword answers, no persistence. |
| 9 | Settings: 10-section subnav, all real | NOT STARTED | — | Epic E. Today: one mega-scroll page. |
| 10 | Mobile genuinely usable at 390px | PARTIAL | inherited | Epic H asserts; today screenshots only. |

## Batch log (dated, append-only)

### 2026-06-11 — Batch 0: orientation & baseline (lead)

- **Changed:** Read the full finishing contract (audit, plan, goal §3, product
  spec, design brief), mapped the live codebase (shell, schema, routing,
  screens), and verified the green baseline above. Created this report and the
  evidence directory.
- **Evidence:** baseline command outputs (typecheck/unit/convex) captured in
  this session; 77/77 unit tests green.
- **Verification:** baseline gates green; no product change yet.
- **Next:** Wave 1 — Epic A (app shell fidelity) and Epic B1–B3 (Convex Agent
  runtime + threads + read tools + proposals), non-overlapping write scopes.

<!-- Append one dated entry per batch below. Keep WORKING claims tied to a
     green test + screenshot. -->
