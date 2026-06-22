# E11 — Data lifecycle — reset/delete-all, demo data & public no-login demo account

> Part of the **OpenBooks Launch Sprint**. Master plan: [../README.md](../README.md) · Backlog: [../backlog.md](../backlog.md)

**Goal.** By sprint end, the owner can DELETE ALL of one workspace's data and re-run guided onboarding cleanly on an empty book; a prospect can try OpenBooks with no login through an isolated, read-only, periodically-reset public demo; demo data can never leak into real reads; and the owner can export their entire account as a file they own. The destructive paths are authz-gated, confirmed, audited, and workspace-scoped (not global).

**Why it matters.** This epic delivers two trust pillars Ansar named explicitly. (1) "Your books are a file you own" — an owner must be able to wipe and restart without engineering help, and walk away with a complete export at any moment; that is the credibility story QuickBooks can't tell. (2) Conversion — a no-login public demo lets prospects feel the product before cloning the repo, which is the top of the open-source funnel. It also closes a confirmed correctness bug: today every report view falls back to the demo entity (slug "acme-studio-llc") when no entityId is passed, so demo numbers silently bleed into a real owner's books. Until that fallback is killed and demo/real are hard-isolated, the owner can never trust that what he sees on screen is his actual business.

## Current state

RESET: convex/realTestReset.ts is a single global "nuke everything + recreate Z360" tool. startFullRebuild (realTestReset.ts:115) deletes ALL rows across 50 tables for ALL workspaces/users (RESET_TABLES includes users/workspaces, realTestReset.ts:16-66), gated only by env OPENBOOKS_REAL_TEST_RESET_ENABLED=1 + the literal phrase "DELETE TEST DATA AND CREATE Z360" + workspace.reset permission (buildPreview, realTestReset.ts:84). It records a realTestResetJobs audit row (schema.ts:801) but writes NO auditEvents entry, is not scoped to the caller's workspace, and the UI (DataSection.tsx:94 RealTestResetPanel) hard-codes "recreates one owner workspace named Z360". There is NO per-workspace "reset to factory, keep my account, re-run onboarding" path.

DEMO SEED: convex/seedDemo.ts (resetAndSeed, seedDemo.ts:202) seeds rich data into entity slug "acme-studio-llc" INSIDE THE CALLER'S OWN WORKSPACE (resetDemoEntity, seedDemo.ts:781) — it is not an isolated demo workspace. seedDemo is disabled whenever real-test mode is on (demoSeedDisabled, seedDemo.ts:170).

DEMO LEAK (confirmed root cause): getActiveEntity falls back to slug "acme-studio-llc" when entityId is omitted, duplicated in coreViews.ts:27-44, incomeViews.ts:13-20, expensesViews.ts:18-25, moduleViews.ts:17-24, and reportViews.ts:43-49. The blueprint (docs/finishing/accounting-engine-blueprint.md:346) names "demo-slug fallback when entityId omitted" as a defect; any caller that forgets entityId reads demo numbers. Hardcoded demo "today" dates compound it (incomeViews.ts:11 MONTH_START="2026-06-01"; coreViews months[] 2025-07..2026-06).

PUBLIC DEMO: app/page.tsx "Try the live demo" links to /dashboard (page.tsx:184,519), which is wrapped by AuthenticatedAppShell using useConvexAuth (AppShell.tsx:123) — so it bounces to sign-in. There is NO no-login public demo route, no read-only guard, and no server-side demo resolution. The hook points for a no-login demo are the slug-fallback in auth.ts:203-226 and the fixed-slug entity pattern in ledger.ts:260 (V3: no public demo exists today — this is net-new). The decided approach uses NO anonymous Convex Auth identity (decided: see decisions.md Q56) — the demo workspace is resolved by slug on the server and served to truly unauthenticated users.

EXPORT: DataSection.tsx (28) exports only the report pack (CSV bundle + JSON dump + GL) via settingsDataExportFiles (reports-export.ts:483) for a single hardcoded 2026 date range (DataSection.tsx:20). There is no full-account export (contacts, invoices, bills, employees, journal, connections metadata, rules).

CRONS: crons.ts has Plaid sync + payroll auto-draft only; no scheduled demo reset.

## Definition of done (epic)

- [ ] An owner can run 'Reset this workspace to factory' from Settings → Data: it deletes only the caller's workspace's books/connections/transactions (never other workspaces, never the user account), requires a typed confirmation, writes an auditEvents row, and leaves the workspace in needs_onboarding so guided onboarding re-runs.
- [ ] After a workspace reset, signing in (or refreshing) lands the owner on the onboarding flow with a clean empty book; onboardingChecklists is reset and OnboardingScreen renders.
- [ ] A prospect can open /demo (or 'Try the live demo') with NO login (no anonymous Convex Auth identity; resolved by slug on the server, decided: see decisions.md Q56) and browse a single shared, fully-populated, isolated demo workspace; every write mutation is blocked at the server by a shared `requireWorkspaceRead`/`assertNotDemoWrite` guard with a clear 'This is a read-only demo' message; the demo workspace's data is invisible to and unmodifiable by any real signed-in user.
- [ ] getActiveEntity no longer falls back to slug 'acme-studio-llc' for real workspaces; with no entityId it resolves to the workspace's first real (non-demo) entity, and a real workspace that contains no demo entity can never read demo rows. A regression test proves a real-workspace read returns 0 rows when the workspace is empty (no demo bleed).
- [ ] A scheduled cron resets the public demo workspace daily at 08:00 UTC (decided: see decisions.md Q57) so prospect edits — even if a write guard is bypassed — never persist; the reset is idempotent, self-healing, and re-seeds deterministically.
- [ ] An owner can export their ENTIRE workspace (entities, chart of accounts, journal entries+lines, transactions, contacts, invoices, bills, employees, payroll runs, rules, connection metadata WITHOUT secrets) as a JSON snapshot plus a zip of per-table CSVs including a journal-lines CSV a CPA can read (decided: see decisions.md Q59; re-import deferred), plus the existing report pack.
- [ ] All new destructive/seed/export functions re-check workspace authz server-side; no secret (Plaid/Stripe/AI/Plunk keys or tokens) is ever included in any export or demo seed; gates green: pnpm typecheck, pnpm lint, pnpm test, e2e for the new flows.

## Tickets (10)

### E11-T1 — Kill the demo-slug fallback so demo data can't leak into real reads
`size: M` · `risk: med` · `depends on: —`

**Intent.** Close the confirmed root cause: when entityId is omitted, every report view silently falls back to the demo entity (slug 'acme-studio-llc'), bleeding demo numbers into a real owner's books. Make 'no entityId' resolve to the workspace's first NON-demo entity and never return a demo entity to a real workspace.

**Changes**

- Extract the duplicated getActiveEntity helper (currently copy-pasted in coreViews.ts:27-44, incomeViews.ts:13-20, expensesViews.ts:18-25, moduleViews.ts:17-24) into a single shared helper in a new convex/activeEntity.ts (server-only module), and reuse it from reportViews.ts:43-49 (getEntity).
- In the shared helper, REMOVE the by_workspace_and_slug('acme-studio-llc') lookup. When entityId is omitted: resolve to the first entity in the workspace where isDemo === false (prefer non-archived), ordered deterministically (e.g. by createdAt asc). Only if the workspace itself IS the demo workspace (see E11-T4 flag) may a demo entity be returned.
- Keep the explicit entityId branch unchanged but add the existing workspace-membership re-check (entity.workspaceId === membership.workspaceId) and additionally reject reading a demo entity from a non-demo workspace and vice-versa.
- Update all five call sites to import the shared helper; delete the local copies.
- Add a unit/integration test: seed a real workspace with one real entity and zero transactions, call coreViews dashboard with no entityId, assert it targets the real entity and returns empty (no demo rows).

**Files:** `convex/coreViews.ts`, `convex/incomeViews.ts`, `convex/expensesViews.ts`, `convex/moduleViews.ts`, `convex/reportViews.ts`, `convex/activeEntity.ts (new)`, `convex/entities.ts`, `docs/finishing/accounting-engine-blueprint.md (cite :346)`

**Definition of done**

- [ ] grep for the string 'acme-studio-llc' in convex/*Views.ts returns zero matches (the only remaining occurrence is the dedicated demo seed in seedDemo.ts).
- [ ] A test proves a real workspace with no demo entity reads 0 rows (no demo bleed) when entityId is omitted.
- [ ] All five view files import getActiveEntity from convex/activeEntity.ts; no duplicated copy remains.
- [ ] Existing report/dashboard e2e still pass (the explicit-entityId paths are unchanged).

**Deliverables:** convex/activeEntity.ts shared helper; Edits to 5 view files; New regression test asserting no demo bleed

**Verify.** pnpm typecheck && pnpm lint && pnpm test; run the new no-bleed test; grep -r 'acme-studio-llc' convex/*Views.ts returns nothing.

### E11-T2 — Mark demo entities/workspaces explicitly and add a demoWorkspaces registry
`size: S` · `risk: low` · `depends on: E11-T1`

**Intent.** Stop overloading the magic slug 'acme-studio-llc' as the only demo signal. Add an explicit, queryable marker for the public demo workspace so isolation logic (read-only guard, cron reset, no-bleed fallback) has a single source of truth.

**Changes**

- Add an optional boolean `isDemo` (and optional `demoKind: 'public' | 'seed'`) to the workspaces table in convex/schema.ts (entities already has isDemo at schema.ts:72). Keep optional so existing rows read as non-demo.
- Add a helper convex/demoWorkspace.ts exporting isDemoWorkspace(ctx, workspaceId) and getPublicDemoWorkspace(ctx) (looks up the single workspace where isDemo===true && demoKind==='public').
- Backfill: a one-shot internalMutation that finds the workspace currently containing the 'acme-studio-llc' entity and sets workspace.isDemo + entity.isDemo if not already set (idempotent).
- Wire E11-T1's shared getActiveEntity to consult isDemoWorkspace instead of the slug.

**Files:** `convex/schema.ts (workspaces table ~line 60-66 area; entities.isDemo at :72)`, `convex/demoWorkspace.ts (new)`, `convex/activeEntity.ts (from E11-T1)`

**Definition of done**

- [ ] schema.ts compiles with optional workspaces.isDemo / demoKind; npx convex dev (or codegen) succeeds.
- [ ] getPublicDemoWorkspace returns exactly one workspace after the backfill runs; returns null on a fresh deployment.
- [ ] isDemoWorkspace is the single function used by the read-only guard, cron, and getActiveEntity to identify demo data.

**Deliverables:** schema.ts migration (additive optional fields); convex/demoWorkspace.ts; idempotent backfill internalMutation

**Verify.** pnpm typecheck && pnpm lint; run the backfill once against the dev deployment and confirm getPublicDemoWorkspace returns the seeded demo workspace.

### E11-T3 — Per-workspace 'Reset to factory' (scoped, confirmed, audited) + re-runnable onboarding
`size: L` · `risk: med` · `depends on: E11-T1, E11-T2`

**Intent.** Give the owner a SAFE delete-all that wipes only the current workspace's books and returns it to onboarding — distinct from the existing global realTestReset.ts nuke. This is the primary owner-facing data-lifecycle action.

**Changes**

- Add convex/workspaceReset.ts with: preview query (per-workspace row counts, owner-only via requireWorkspacePermission(workspaceId,'workspace.reset')); and a resetWorkspace action that deletes ONLY rows scoped to the caller's workspaceId (entities + every by_entity/by_workspace child: transactions, journalEntries/Lines, ledgerAccounts, bankAccounts, plaidItems, stripeAccounts, financialConnections, contacts, invoices, bills, employees, payrollRuns/Lines, rules, inboxItems, documents, proposals, aiConfigs, onboardingChecklists, workspaceSettings, demoSeedRuns). NEVER touch users, authSessions, other workspaces, or the workspaceMembers/owner row.
- Require the owner to RE-TYPE THE WORKSPACE NAME to confirm (higher friction, safer; decided: see decisions.md Q61), distinct from the global path's fixed phrase. Gate on owner role server-side. Batch deletes (reuse the deleteBatch/MAX_BATCHES pattern from realTestReset.ts:409-451) to stay under Convex limits.
- Delete LOCAL connection/credential rows only; do NOT call Plaid/Stripe provider revoke APIs from the reset (decided: see decisions.md Q58 — avoid network failure modes in a destructive local action; optional follow-up: Plaid /item/access_token/invalidate).
- After deletion: reset onboardingChecklists for the workspace (all flags false) so AppShell.tsx:437 routes to OnboardingScreen, and write an auditEvents row (action 'workspace.reset.factory', actorUserId, summary with counts).
- Add a realTestResetJobs-style job row (or reuse the table) so a reset has an audit trail with status/counts.
- Refactor DataSection.tsx RealTestResetPanel into two clearly-labeled panels: (a) the new owner 'Reset this workspace to factory' (always available to owners), (b) the existing global real-test rebuild (kept behind the env flag, dev-only copy).

**Files:** `convex/workspaceReset.ts (new)`, `convex/realTestReset.ts (reuse deleteBatch/batching pattern; do NOT change its global behavior)`, `convex/onboarding.ts (ensureChecklist :84, markChecklistStep :351)`, `convex/authz.ts (requireWorkspacePermission, 'workspace.reset')`, `apps/web/src/components/openbooks/settings/DataSection.tsx (RealTestResetPanel :94-176)`

**Definition of done**

- [ ] resetWorkspace deletes only the caller's workspace rows: a two-workspace test proves workspace B's entities/transactions are untouched after workspace A resets.
- [ ] After reset, session.viewer still returns the same user+workspace but status flips to needs_onboarding (or activeBusinessRows===0) so OnboardingScreen renders.
- [ ] An auditEvents row with action 'workspace.reset.factory' exists after a reset.
- [ ] Non-owner role calling resetWorkspace throws; a confirmation string that does not exactly match the workspace name throws.
- [ ] Users/auth tables are never deleted (owner stays logged in).

**Deliverables:** convex/workspaceReset.ts (preview + action + job/audit); DataSection.tsx two-panel redesign; Two-workspace isolation test

**Verify.** pnpm typecheck && pnpm lint && pnpm test; manual: seed a workspace, run reset, confirm UI drops to onboarding and other workspace intact; e2e asserts onboarding renders post-reset.

### E11-T4 — Provision an isolated public demo workspace + seed it (separate from any real workspace)
`size: L` · `risk: med` · `depends on: E11-T2`

**Intent.** Today demo data is seeded into the CALLER'S workspace under slug 'acme-studio-llc'. Create a dedicated, standalone PUBLIC demo workspace (isDemo+demoKind='public') with its own owner-less/system-owned membership and a rich seed, so the public demo is fully isolated from every real account.

**Changes**

- Add convex/publicDemo.ts: ensurePublicDemoWorkspace (internalMutation) that creates (idempotent) a workspace with isDemo=true, demoKind='public', a stable slug like 'public-demo', workspaceSettings, and an onboardingChecklists marked complete; plus a demo entity (isDemo=true).
- Add seedPublicDemo (internalAction) that reuses the seed logic from seedDemo.ts (extract the shared seeding routine so both the in-workspace demo and the public demo call one function) to populate the public demo workspace's entity with the full dataset (transactions posted, invoices/bills/payroll/contacts/rules/inbox).
- Ensure the seed never writes any real secret/token (it already uses synthetic data — assert no connections with credentials are created; only metadata-style stripeAccounts/bankAccounts).
- Expose an internalAction resetAndSeedPublicDemo that wipes the public demo workspace's rows (scoped like E11-T3) then re-seeds — the single function the cron (E11-T8) and an admin button call.

**Files:** `convex/publicDemo.ts (new)`, `convex/seedDemo.ts (extract shared seed routine; resetAndSeed :202, resetDemoEntity :781, setupDemoOperationTables :822)`, `convex/demoWorkspace.ts (from E11-T2)`, `convex/schema.ts (workspaces.isDemo from E11-T2)`

**Definition of done**

- [ ] After ensurePublicDemoWorkspace + seedPublicDemo, getPublicDemoWorkspace returns a workspace with >0 transactions, balanced trial balance (reuse reports.seedVerification, seedDemo.ts:618), and posted journal entries.
- [ ] The public demo workspace is NOT a member workspace of any real user (no real workspaceMembers row points a real user at it).
- [ ] Re-running ensure+seed is idempotent (no duplicate workspaces/entities).
- [ ] No row created by the seed contains a credential/token field.

**Deliverables:** convex/publicDemo.ts; Extracted shared seed function in seedDemo.ts; Trial-balance assertion on the seeded demo

**Verify.** pnpm typecheck && pnpm lint; run ensurePublicDemoWorkspace then seedPublicDemo on dev; query reports.seedVerification on the demo entity and assert trialBalanceDifferenceMinor===0.

### E11-T5 — No-login public /demo route via server-side slug resolution (no anonymous auth)
`size: L` · `risk: med` · `depends on: E11-T4`

**Intent.** Let a prospect reach the demo workspace's data with NO authentication and NO anonymous Convex Auth identity (decided: see decisions.md Q56 — the Anonymous provider opens a write-abuse surface; we want zero demo writes). The demo workspace is resolved BY SLUG ON THE SERVER for truly unauthenticated users, and the real app shell renders in read-only mode.

**Changes**

- Add a shared `requireWorkspaceRead(ctx, workspaceId)` helper (used by every demo-readable query) that allows the read when `workspace.isDemo === true` (resolved via getPublicDemoWorkspace, E11-T2), else falls back to the existing auth+membership re-check. Hook the public-demo resolution at the slug-fallback in auth.ts:203-226; model the fixed-slug entity lookup on ledger.ts:260. Do NOT mint a session token and do NOT introduce a synthetic auth identity.
- Add apps/web/src/app/demo/page.tsx (and supporting client) that resolves the public demo workspace by slug and renders AppShell pointed at it for truly unauthenticated users, bypassing the sign-in redirect in AuthenticatedAppShell (AppShell.tsx:120-127) ONLY on the /demo route.
- Update app/page.tsx 'Try the live demo' / 'Try the mobile demo' links (page.tsx:184,380,519) to point at /demo instead of /dashboard.
- Show a persistent 'You're viewing a live demo — read only' banner in the demo shell.
- Ensure session.viewer (session.ts:5) can return the public demo workspace context (read-only) for an unauthenticated /demo request without a real auth account.

**Files:** `apps/web/src/app/demo/page.tsx (new)`, `apps/web/src/components/openbooks/AppShell.tsx (AuthenticatedAppShell :120-127, /demo bypass)`, `apps/web/src/app/page.tsx (:184, :380, :519)`, `convex/auth.ts (slug fallback :203-226)`, `convex/ledger.ts (fixed-slug entity pattern :260)`, `convex/demoWorkspace.ts (requireWorkspaceRead + getPublicDemoWorkspace from E11-T2)`, `convex/session.ts (viewer :5)`

**Definition of done**

- [ ] Opening /demo in a fresh incognito browser (no cookies, no login, no anonymous auth identity minted) renders the dashboard with the single shared seeded demo data and a visible read-only banner.
- [ ] The demo read path resolves ONLY to the public demo workspace by slug; it cannot read any real workspace's rows (proven by a server test that the demo read context's workspaceId === public demo workspace and queries scoped there).
- [ ] No anonymous Convex Auth identity / session token is created for the demo (grep confirms no anonymous provider wiring).
- [ ] Landing-page demo CTAs route to /demo, not /dashboard.
- [ ] A real signed-in user is unaffected (still sees their own workspace).

**Deliverables:** /demo route + client bootstrap; shared requireWorkspaceRead helper (slug-resolved, no anonymous auth); Landing CTA updates; Read-only banner component

**Verify.** pnpm build; agent-browser opens /demo in incognito, screenshots the populated read-only dashboard; server test asserts the demo read context is scoped to the demo workspace only and no anonymous auth identity is minted.

### E11-T6 — Server-side read-only guard so the public demo workspace cannot be written
`size: M` · `risk: high` · `depends on: E11-T4, E11-T5`

**Intent.** Belt-and-suspenders isolation per best practice: even if a prospect crafts a request, no mutation/action may modify the public demo workspace. Block writes at the server, not just in the UI (UI hiding is not the boundary; decided: see decisions.md Q56). Because there is NO anonymous demo identity, the trigger is the TARGET WORKSPACE being the demo, not a demo caller identity.

**Changes**

- Add a shared guard assertNotDemoWrite(ctx, workspaceId) in convex/demoWorkspace.ts that throws a friendly ConvexError('This is a read-only demo — sign in to your own workspace to make changes.') when the target workspace is the public demo (isDemoWorkspace). (No anonymous-caller branch — the demo serves truly unauthenticated reads only.)
- Call the guard at the top of every workspace-scoped mutation/action that writes: ledger.postEntry and the single posting path, pipeline.routeTransaction, rules create/update, connections add (plaid/stripe), onboarding mutations, entities.create/archive, invoices/bills/payroll writes, seedDemo.resetAndSeed, workspaceReset.resetWorkspace. (Seed/cron internal functions are exempt because they run as internal — there is no demo caller identity.)
- Centralize the call via the existing authz require* helpers where possible (e.g. extend requireWorkspacePermission to optionally enforce non-demo) to avoid missing a mutation. Pair it with the read-side shared requireWorkspaceRead from E11-T5 so reads and writes share one demo source of truth.
- Add a server test enumerating that a representative write mutation throws when targeting the demo workspace.

**Files:** `convex/demoWorkspace.ts (assertNotDemoWrite)`, `convex/authz.ts (requireWorkspacePermission / requireAnyWorkspacePermission :236)`, `convex/ledger.ts (posting path — postLedgerEntryCore :345, postEntry)`, `convex/pipeline.ts (routeTransaction)`, `convex/connections.ts`, `convex/rules.ts`, `convex/onboarding.ts`, `convex/entities.ts`, `convex/invoices.ts`, `convex/bills.ts`, `convex/payroll.ts`

**Definition of done**

- [ ] Calling any guarded write mutation/action targeting the public demo workspace throws the read-only ConvexError.
- [ ] The cron/internal re-seed (internal functions) still succeeds (guard exempts internal callers).
- [ ] Real signed-in writes to real workspaces are unaffected.
- [ ] A test enumerates >=5 representative write paths and asserts each throws when targeting the demo workspace.

**Deliverables:** assertNotDemoWrite guard; Guard calls across write mutations; Read-only enforcement test

**Verify.** pnpm typecheck && pnpm lint && pnpm test; the read-only enforcement test passes; manual: in /demo attempt to confirm an inbox item → blocked with friendly message.

### E11-T7 — Harden the existing global realTestReset with an auditEvents record + workspace-scope safety copy
`size: S` · `risk: med` · `depends on: E11-T3`

**Intent.** The existing global nuke (realTestReset.ts) writes only a realTestResetJobs row and no auditEvents, and its UI copy is misleading. Tighten it so the destructive global path is unambiguous and audited, without changing its dev-only behavior.

**Changes**

- In realTestReset.startFullRebuild (realTestReset.ts:115) and finalizeZ360Only (:222), after a successful run, write an auditEvents row (action 'workspace.global_reset', actorUserId from previewInternal, summary with batch + table counts).
- Add an explicit second confirmation field or a clearer label in DataSection.tsx that this GLOBAL path deletes ALL workspaces and users (distinct from the per-workspace reset in E11-T3); keep it behind OPENBOOKS_REAL_TEST_RESET_ENABLED so it's dev/owner-only.
- Add a code comment + readme note documenting that startFullRebuild is the dev rebuild tool and workspaceReset.resetWorkspace (E11-T3) is the owner-facing factory reset, so future agents don't confuse them.
- Confirm requireAnyWorkspacePermission(ctx,'workspace.reset') (realTestReset.ts:84) is the right gate and that buildPreview still surfaces 'enabled' so the UI disables the button when the env flag is off.

**Files:** `convex/realTestReset.ts (startFullRebuild :115, finalizeZ360Only :222, buildPreview :84)`, `apps/web/src/components/openbooks/settings/DataSection.tsx (:94-176)`, `docs/finishing/whats-left.md or a short runbook note`

**Definition of done**

- [ ] After a global rebuild, an auditEvents row with action 'workspace.global_reset' exists.
- [ ] DataSection clearly distinguishes the global dev rebuild from the per-workspace factory reset; the global panel is hidden/disabled when OPENBOOKS_REAL_TEST_RESET_ENABLED!=='1'.
- [ ] No change to the global delete behavior or table list (regression-safe).

**Deliverables:** auditEvents write in realTestReset; DataSection copy/label update; Runbook note distinguishing the two reset paths

**Verify.** pnpm typecheck && pnpm lint; manual dry-run preview shows enabled flag; (if safe in dev) run rebuild and confirm auditEvents row.

### E11-T8 — Scheduled cron to reset+re-seed the public demo so prospect edits never persist
`size: M` · `risk: low` · `depends on: E11-T4`

**Intent.** Per public-demo best practice, the demo must self-heal on a schedule so any drift (or a bypassed guard) is wiped. Add a deterministic, idempotent scheduled reset of the public demo workspace.

**Changes**

- Add a cron in convex/crons.ts (alongside the Plaid sync :7 and payroll auto-draft) that calls internal.publicDemo.resetAndSeedPublicDemo (from E11-T4) daily at 08:00 UTC (decided: see decisions.md Q57 — low-traffic hour; make the schedule a single constant).
- Make the cron a NO-OP when no public demo workspace exists (fresh deployment / self-hosters who don't want a demo), gated by OPENBOOKS_PUBLIC_DEMO_ENABLED — OFF by default for self-hosters, ON for the hosted instance (decided: see decisions.md Q60).
- Ensure resetAndSeedPublicDemo is idempotent and bounded (batched deletes) so it can't time out or partially seed.
- Record a lightweight demoSeedRuns/auditEvents row each reset for observability.

**Files:** `convex/crons.ts (:7 interval, :15 cron)`, `convex/publicDemo.ts (resetAndSeedPublicDemo from E11-T4)`, `convex/demoWorkspace.ts`

**Definition of done**

- [ ] The cron is registered and visible in the Convex dashboard schedule.
- [ ] Manually triggering resetAndSeedPublicDemo twice yields the same deterministic seed (same transaction count, balanced trial balance) and does not duplicate the workspace.
- [ ] With OPENBOOKS_PUBLIC_DEMO_ENABLED unset, the cron is a no-op and logs nothing destructive.
- [ ] An observability row records each reset.

**Deliverables:** crons.ts entry; Env-gated no-op behavior; Idempotency/determinism test

**Verify.** pnpm typecheck && pnpm lint; run resetAndSeedPublicDemo twice and diff seedVerification snapshots (identical); confirm cron appears in dashboard.

### E11-T9 — Full-account data export ('your books are a file you own')
`size: M` · `risk: low` · `depends on: E11-T1`

**Intent.** Extend export beyond the report pack to a complete, secret-free snapshot of the workspace the owner can keep — entities, chart of accounts, journal, transactions, contacts, invoices, bills, employees, payroll, rules, and connection metadata.

**Changes**

- Add convex/exportAccount.ts: a query (owner/accountant, requireAnyWorkspaceRole) that assembles a structured JSON snapshot for the active workspace/entity — entities, ledgerAccounts, journalEntries+journalLines, transactions, contacts, invoices, bills, employees, payrollRuns+lines, rules, and SAFE connection metadata (bank account names/masks, stripeAccounts labels) with ALL secrets/tokens stripped (no secretBox values, no Plaid access tokens, no API keys).
- Bound the query with pagination/take caps and a documented size limit; for large books, stream per-table or chunk so it stays under Convex limits.
- Add apps/web export logic in lib/openbooks/reports-export.ts (settingsDataExportFiles :483) or a new lib to serialize the snapshot to a downloadable JSON snapshot PLUS a zip of per-table CSVs that includes a journal-lines CSV a CPA can read (decided: see decisions.md Q59; a re-import path is deferred, not in this epic), and wire a new 'Export everything (full account)' button in DataSection.tsx (:38-70) next to the existing report exports.
- Write an auditEvents row 'workspace.exported' on export (or on a server-logged export action) for traceability.
- Make the export date-range/entity aware (replace the hardcoded REPORT_ARGS 2026 range, DataSection.tsx:20, for the full export so it covers all history).

**Files:** `convex/exportAccount.ts (new)`, `convex/secretBox.ts (confirm what must be stripped)`, `apps/web/src/components/openbooks/settings/DataSection.tsx (:20, :38-70)`, `apps/web/src/lib/openbooks/reports-export.ts (:483, downloadReportFile :503)`

**Definition of done**

- [ ] Clicking 'Export everything' downloads a JSON snapshot AND a zip of per-table CSVs (including a journal-lines CSV) containing entities, accounts, journal, transactions, contacts, invoices, bills, employees, payroll, and rules for the workspace.
- [ ] A test/grep asserts the export contains NO secret material: no access_token, no api key, no secretBox ciphertext, no Plunk/Plaid/Stripe secret fields.
- [ ] The export covers full history (not just the hardcoded 2026 range).
- [ ] Export re-checks workspace authz server-side and writes an auditEvents row.

**Deliverables:** convex/exportAccount.ts; DataSection 'Export everything' button; Secret-free assertion test

**Verify.** pnpm typecheck && pnpm lint && pnpm test; run the export on the seeded demo, open the file, confirm all entity tables present and grep for 'token'/'secret'/'api' returns no credential values.

### E11-T10 — e2e + invariants: reset→re-onboard→demo isolation→export, plus docs
`size: M` · `risk: low` · `depends on: E11-T3, E11-T5, E11-T6, E11-T9`

**Intent.** Prove the whole data-lifecycle loop end to end and document the demo/reset/export model so it's verifiable and self-host-safe.

**Changes**

- Add a Playwright e2e (apps/web e2e dir) covering: (a) owner runs per-workspace factory reset, confirming by re-typing the workspace name → lands on onboarding with empty book; (b) /demo opens with no login (no anonymous auth identity, slug-resolved on the server), shows the single shared seeded data + read-only banner, and a write attempt is blocked at the server; (c) full-account export downloads a non-empty secret-free file (JSON + per-table CSV zip).
- Add a server invariant test: a real empty workspace reads 0 transactions (no demo bleed) with no entityId; the demo workspace is never returned to a real viewer.
- Document the model in docs/finishing/ (or docs/product/): the two reset paths (owner factory reset confirmed by workspace-name re-type vs dev global), single shared no-login public demo isolation (slug-resolved, no anonymous auth) + server-side read-only guard + daily 08:00 UTC cron reset, export contents (JSON + per-table CSV zip), and the OPENBOOKS_PUBLIC_DEMO_ENABLED (OFF by default) / OPENBOOKS_REAL_TEST_RESET_ENABLED flags for self-hosters.
- Update the landing copy claim 'No tracking, no account required' (page.tsx:544) to be accurate against the new /demo.

**Files:** `apps/web e2e test dir (e.g. apps/web/tests or playwright config)`, `convex (invariant test)`, `docs/finishing/whats-left.md / a new data-lifecycle doc`, `apps/web/src/app/page.tsx (:544)`

**Definition of done**

- [ ] The e2e suite for reset, demo read-only, and export passes in CI.
- [ ] The no-bleed invariant test passes.
- [ ] A docs page describes both reset paths, demo isolation, export contents, and the two env flags.
- [ ] All gates green: pnpm typecheck, pnpm lint, pnpm test, e2e.

**Deliverables:** Playwright e2e for the lifecycle loop; Server invariant test; Data-lifecycle documentation

**Verify.** pnpm typecheck && pnpm lint && pnpm test && pnpm e2e (or the project's e2e command); review the docs page for accuracy.

## Decisions applied

All prior open questions for this epic are RESOLVED in `../decisions.md` (Q56–Q61) and the per-epic deltas in `../plan-rebuild-changelog.md` (E11). Summary of what is baked in above:

- **Q56 — Demo session mechanism:** NO anonymous Convex Auth identity. Serve /demo to truly unauthenticated users; resolve the demo workspace by slug on the server; a shared `requireWorkspaceRead` allows the read when `workspace.isDemo === true`, else requires auth+membership (E11-T5/T6).
- **Q57 — Demo reset cadence:** daily reset + reseed at 08:00 UTC, idempotent/self-healing (E11-T8).
- **Q58 — Factory reset & providers:** delete local connection/credential rows only; do NOT call Plaid/Stripe revoke APIs for v1 (E11-T3).
- **Q59 — Export format:** JSON snapshot + a zip of per-table CSVs (incl. a CPA-readable journal-lines CSV); re-import deferred (E11-T9).
- **Q60 — Public demo for self-hosters:** OFF by default, opt-in via OPENBOOKS_PUBLIC_DEMO_ENABLED; ON for the hosted instance (E11-T8).
- **Q61 — Reset confirmation:** re-type the workspace name + write an auditEvents record (E11-T3).

**Still needs Ansar:** none for this epic — every E11 question is resolved by Ansar's decisions or an engineering default. The public no-login demo backend owned here is the dependency that E4-T10 and E15-T6 link to (it ships before launch).
