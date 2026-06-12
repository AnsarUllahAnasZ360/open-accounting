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
| 2 | Shell: collapsible sidebar, footer profile/settings/logout, ⌘K, entity switcher, Ask AI ⌘J | WORKING | `tests/e2e/app-shell.spec.ts` 9/9 + 8 screenshots | Sidebar 232⇄56 rail, footer menu (logout→sign-in), Income/Expenses nav, ⌘K, ⌘J, switcher all real-click verified. Partials downstream: profile page content (F2), multi-entity data-switch (G5), sync-now action (G2), ⌘K server search index (follow-up). AI panel still overlay until B5 docks it. |
| 3 | Plaid sandbox real Link → sync → pipeline → ledger/inbox | NOT STARTED | — | Epic G1/G2. Today: fixture mode only. |
| 4 | Stripe test mode event-driven sync + payout reconcile | PARTIAL | inherited | Epic G3. Webhook receiver real; events trigger nothing yet. |
| 5 | Inbox: confirm / correct / rule / batch / keyboard | PARTIAL | inherited | Epic H rewrites assertions; batch + keyboard unverified. |
| 6 | Income / Expenses / Bills / Contacts / Payroll fully functional incl. missing mutations | NOT STARTED | — | Epics C, D4. Today: invoice save / bill mark-paid / payroll approve-pay absent. |
| 7 | Reports home → viewer, sane periods, drill-down, cash⇄accrual, exports match | NOT STARTED | — | Epic D1/D2. Today: one mega-page, future-dated periods. |
| 8 | Ask AI: Bedrock streaming, markdown, persistent threads, propose→confirm | PARTIAL (backend WORKING) | B1–B3 unit tests + live Bedrock smoke | Engine done + verified (durable threads, real streaming, 5 read tools, propose→confirm through the ledger). UI is B4 — no screenshot yet, so capability stays PARTIAL until the docked panel renders it. |
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

### 2026-06-11 — Batch B1–B3: Ask AI backend on @convex-dev/agent (subagent `agent-runtime`)

- **Changed:** New `convex/` files — `convex.config.ts` (registers the agent
  component), `agent.ts` (OpenBooks agent, Bedrock languageModel, degraded-safe),
  `agentTools.ts` (10 createTool defs: 5 read + 5 propose), `agentToolQueries.ts`
  (entity-scoped internal reads), `aiThreads.ts` (thread API + sendMessage
  mutation → scheduled streamText action with `saveStreamDeltas`),
  `proposals.ts` (propose/confirm/dismiss), + 2 test files. Modified:
  `schema.ts` (+`chatThreads`, +`proposals` tables), `authz.ts`
  (+`authorizeThreadAccess`), `reportViews.ts` (extracted behavior-preserving
  `buildReportPackForEntity` + internal `reportPackForEntity` for the agent),
  `semanticMemory.ts` (+ return-type annotation for TS circularity after the
  component enlarged the API graph).
- **Evidence / verification:**
  - `npx convex dev --once` → **green** (cloud dev `ceaseless-mandrill-524`).
  - `pnpm test:unit` → 95/96; the 19 new tests pass (thread CRUD, cross-workspace
    rejection, degraded shape, per-tool entity isolation, all 5 proposal kinds
    round-trip propose→confirm→posted-balanced-audited, double-confirm
    idempotency, auto-expire). The 1 failure is `tests/prototype-copy.test.ts`
    reading the shell file the concurrent Epic-A agent is rewriting — an
    integration item, not a B defect.
  - **Live Bedrock smoke (cloud):** a real `sendMessage`→scheduled-streamText run
    streamed 32 word-deltas, called `getBalances`, rendered a markdown table of
    real ledger numbers; a propose smoke recorded a `categorize` proposal
    matching 5 real txns with the ledger untouched; test artifacts cleaned up.
  - **Lead review (read-only):** reports refactor diff is behavior-preserving;
    grep confirms **zero direct writes** to journalEntries/journalLines/
    ledgerAccounts in the AI backend — confirms route through `ledger.postEntry`,
    `pipeline.recategorizeTransactionInternal`, and `api.ai.createConfirmedRule`.
- **Status:** backend **WORKING + verified**; product capability #8 stays
  **PARTIAL** until B4 renders the UI with a real-click test + screenshot.
- **API for B4:** `api.aiThreads.{createThread,listMine,rename,deleteThread,
  sendMessage,listThreadMessages}` (last one is the `useUIMessages` live query),
  `api.proposals.{listProposals,confirmProposal,dismissProposal}`.
- **Next:** integrate after Epic A lands; reconcile `tests/prototype-copy.test.ts`;
  then Wave 2.

### 2026-06-11 — Batch A: app shell & navigation fidelity (subagent `shell-fidelity`)

- **Changed:** `AppShell.tsx` (full rework — collapse-to-rail, footer menu, top
  bar, entity switcher, ⌘K/⌘J), `content.ts` (new nav IA), `AppScreen.tsx`
  (client dispatch, `/income`→InvoicesScreen, `/expenses`→honest placeholder,
  hardcoded entity name removed), `[section]/page.tsx`, `CoreScreens.tsx`
  (`?focus=` deep-link), `ModuleScreens.tsx` (`?contact=`). New:
  `ui/tooltip.tsx`, `ui/command.tsx`, `CommandPalette.tsx`,
  `lib/openbooks/active-entity.tsx`, `app/invoices/page.tsx` (redirect),
  `tests/e2e/app-shell.spec.ts`. Updated `tests/prototype-copy.test.ts` (the
  guardrail now asserts the hardcoded "Acme Studio LLC" is GONE — the point of
  A5). Lead added the playwright webServer dev-bypass forward (below).
- **Evidence / verification:**
  - `pnpm verify` → **green** (typecheck, lint, build of all routes incl.
    `/income` `/expenses` `/invoices`→redirect, **97/97 unit**).
  - `tests/e2e/app-shell.spec.ts` → **9/9 passed (real pointer clicks)** on a
    clean run against the cloud dev deployment: A1 collapse→56px rail→tooltip→
    rail-nav→reload-persist→expand; A2 footer menu both states→Log out→sign-in;
    A2b no top-bar logout; A3 10-item nav order + `/invoices` redirect; A3b
    inbox badge; A4 ⌘K→type merchant→Enter opens its transaction; A4b ⌘J opens
    AI panel; A5 entity switcher; layout: no h-scroll at 1440/390 + panel∩nav=∅.
  - 8 screenshots in `docs/finishing/evidence/2026-06-11-A*.png`.
  - Lead design grep: no gradients/purple/glassmorphism; on-brand green only.
- **Integration fix (lead):** the first clean e2e run hit the **sign-in gate**,
  not the owner session — `next dev` runs from `apps/web/` and does not load the
  root `.env.local`, and `playwright.config.ts` forwarded only the Convex URL.
  Added `NEXT_PUBLIC_OPENBOOKS_DEV_AUTH_BYPASS` to the webServer env so e2e boots
  into "Continue as owner (dev)". (Same root cause `pnpm dev:full`/F4 must solve
  for plain local dev.) After the fix: 9/9 green.
- **Status:** acceptance row #2 **WORKING**. Named downstream partials: profile
  page content (F2), multi-entity data-switch (G5), sync-now action (G2), ⌘K
  server-side search index (follow-up).
- **Note:** the shell agent flagged that pre-existing legacy specs
  (`core-screens.spec.ts` et al.) still use the banned `dispatchEvent` — that is
  Epic H1's cleanup, tracked there.
- **Next:** Wave 2 — Epic D (Reports, the "completely broken" complaint) first.

<!-- Append one dated entry per batch below. Keep WORKING claims tied to a
     green test + screenshot. -->
