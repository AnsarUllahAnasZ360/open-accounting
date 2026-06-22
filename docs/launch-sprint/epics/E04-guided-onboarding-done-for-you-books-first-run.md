# E4 — Guided onboarding & "done-for-you books" first-run

> Part of the **OpenBooks Launch Sprint**. Master plan: [../README.md](../README.md) · Backlog: [../backlog.md](../backlog.md)

**Goal.** Replace the thin placeholder onboarding stepper with a real guided first-run that: creates account → workspace → one-or-many businesses; runs each setup step (AI key+model, Plunk, invite team, Plaid+account-to-business mapping, Stripe per business, opening balances) inline doing REAL work with copyable redirect/webhook URLs and guide links; persists a resumable progress checklist; then triggers an AI BULK-SETUP moment that syncs as much history as the connector gives (user may pick a start date; default = pull everything — decided: see decisions.md), asks the owner a few questions, and PROPOSES income streams + categories + rules for a human review/approve gate; and on finish lands the owner on a fully-populated org. Also add a clean owner-facing data reset/re-onboard and a single shared no-login demo workspace (decided: see decisions.md), and distinguish self-host first-run from invited-teammate join.

**Why it matters.** Today a new owner reaches an empty, half-configured org: AI/Bank/Stripe steps are "Skip for now" buttons that do nothing real (`OnboardingScreen.tsx:209-252`), only one business can be created (`onboarding.ts:bootstrapWorkspace`), no opening balance is booked so equity reads $0, and the BYO AI key has no UI at all (`AiSection.tsx:105` provider Select is `disabled`, `aiProviderRegistry.ts:141` is bedrock-only). The downstream effect is the core launch bug from the audit: with no AI key wired, ~78-80% of real transactions never post and reports drastically understate. A guided, do-real-work first-run is the single highest-leverage activation surface — it is where the owner connects the very keys and opening balances that make their books correct, and it is what lets a prospect (via the no-login demo) see a populated product before cloning. Getting this right turns "I signed up and nothing happened" into "by my first real entry I see a fully-populated, correct org."

## Current state

Onboarding is a 5-step in-memory stepper (`apps/web/src/components/openbooks/OnboardingScreen.tsx`): step 0 collects business name/type/currency; steps 1-3 (AI/Bank/Stripe) are `IntegrationStep` placeholders whose only action is a "Skip for now" button that sets a `skipped*` boolean (`OnboardingScreen.tsx:209-252,301-346`); step 4 calls `api.onboarding.bootstrapWorkspace`. That mutation (`convex/onboarding.ts:242-349`) creates ONE workspace + ONE entity + typed chart via `seedChartForEntity`/`chartTemplatesForType` + a default bank account, seeds `onboardingChecklists` (booleans: bankConnected/aiConnected/stripeConnected/firstInboxZero/firstReportViewed — `schema.ts:56-65`, `onboarding.ts:checklist:181`), and is idempotent for an existing workspace. AppShell renders `OnboardingScreen` whenever `viewer.status === "needs_onboarding"` or the active business list is empty (`AppShell.tsx:437-444`). Invited-teammate join is already wired: `auth.ts:createOrUpdateUser` (110-170) consumes a pending `invites` row, assigns role, and marks it accepted; `session.viewer` returns `ready` once a workspace membership exists. Real work the steps SHOULD trigger already has backends: BYO connections (`connections.saveWorkspacePlaidApp:468`, `saveStripeCredential:528`, `connectionCredentials` encrypted via `secretBox.ts`), copyable URLs (`connections.webhookConfig:414` returns plaidRedirectUri/stripeWebhookUrl/plaidWebhookUrl/siteUrl), team invites (`team.invite:99` returns inviteUrl), and an "Opening Balance Equity" account already in every chart (`ledger.ts:53` account 3900) — but NO opening-balance booking flow exists, so equity is $0 (audit, `accounting-engine-blueprint.md:38`). The BYO AI key is NOT wired to the UI: the provider Select is `disabled` and the API key field is read-only text (`AiSection.tsx:105-125`); `setConfig` only stores provider+autonomy and ignores keys (`ai.ts:838-872`); the registry only enables bedrock (`aiProviderRegistry.ts:132-175`, `v1Enabled` gate at :141). There is no AI bulk-setup/history-review step and no onboarding proposal-review screen (proposals exist but are thread-scoped: `proposals.ts:recordProposal:379`, kinds categorize/rule/invoiceDraft/bill/journalEntry at :31). Owner-facing reset is missing: only a destructive full-rebuild (`realTestReset.startFullRebuild:115`, owner-only) and a dev demo seed (`seedDemo.resetAndSeed:202`) exist; `DataSection.tsx` explicitly says permanent deletion is "intentionally not exposed". No public no-login demo route exists.

## Definition of done (epic)

- [ ] A brand-new owner with no invite can: create an account, create a workspace, add one OR MORE businesses, and reach a populated org — verified by a new e2e spec that signs up, adds 2 businesses, and asserts the business switcher lists both.
- [ ] Each setup step (AI, Plunk, team, Plaid, Stripe, opening balances) does REAL inline work persisted in Convex (not a no-op skip): a verifier can complete a step and observe the corresponding row (aiConfig with provider+encrypted key, connectionCredentials, invites, bankAccounts mapping, opening journal entry) without leaving onboarding.
- [ ] The BYO AI key is enterable in the UI with a provider + model picker, validated by a test-connection call, stored encrypted; the AiSection provider Select is no longer `disabled` and the categorizer can use the owner's key (not bedrock-only). Verified by a unit test that round-trips a saved key through setConfig/secretBox and a manual smoke that a categorize call uses the configured provider.
- [ ] Every step is SKIPPABLE with a clear instruction panel + guide link + the exact redirect/webhook URL to register (from `connections.webhookConfig`); skipping persists state and leaves a resume entry in the checklist. Verified by e2e: skip all integration steps, finish, return, and see the resumable checklist with the skipped items.
- [ ] Connecting a bank books an opening balance into account 3900 (Opening Balance Equity) so the balance sheet equity is non-zero. Verified by a Convex unit test asserting a balanced opening journal entry (debit bank asset / credit 3900) for the entered balance, and that the trial balance still ties.
- [ ] After sync, an AI bulk-setup pass reviews the user-chosen history window (default = as much as the connector gives — decided: see decisions.md), asks the owner a few questions, and writes a batch of onboarding proposals (income streams + suggested categories + rules). A human review/approve screen lists them; approving applies them (creates rules/streams) and rejecting discards. Verified by a unit test that seeds history, runs the proposal generator, and asserts proposals are created; and an e2e that approves them and sees rules created.
- [ ] On finish the owner lands on a dashboard that shows real, ledger-backed numbers for the connected/seeded data (status, transactions, expenses, AR/AP, reports, payroll-ready) — not an empty shell. Verified by e2e screenshot + assertion that dashboard inbox/transaction counts are > 0 in the demo/seed path.
- [ ] An owner can DELETE ALL workspace data and re-run onboarding cleanly from Settings (non-destructive to other workspaces, with typed confirmation). Verified by a Convex test that resets a workspace and asserts entities/ledger/connections are emptied and viewer returns needs_onboarding.
- [ ] A public NO-LOGIN demo route renders the single shared, server-resolved demo workspace (no anonymous auth identity; server-side read-only guard) with a clear 'clone this to your own account' affordance. The demo backend is OWNED by E11; E4 links to it. Verified by an e2e that loads the demo route unauthenticated and sees populated transactions.
- [ ] Self-host first-run vs invited-teammate join are distinct: an invited teammate skips business creation and lands directly in the existing workspace with their role; a self-host owner gets the full first-run. Verified by the existing invite e2e plus an assertion that an invited user never sees the business-creation step.
- [ ] All gates green: `pnpm verify` (typecheck + lint + unit) and the new/updated e2e specs pass; no ledger posting-path regression (postLedgerEntryCore unchanged in signature/invariants).

## Tickets (10)

### E4-T1 — Onboarding data model + state machine: persisted, resumable, multi-business progress
`size: M` · `risk: low` · `depends on: —`

**Intent.** Turn onboarding from in-memory stepper state into a persisted, resumable server-side progress record so a half-finished first-run survives reload and drives both the wizard and the post-finish checklist. This is the foundation every other ticket reads/writes.

**Changes**

- Extend `onboardingChecklists` in `convex/schema.ts:56-65` (additively, all new fields optional) with: `currentStep` (string), `completedSteps` (array of step ids), `skippedSteps` (array of step ids), `plunkConnected` (bool), `teamInvited` (bool), `openingBalancesSet` (bool), `historyReviewed` (bool), `proposalsReviewed` (bool), and `phase` ('setup' | 'ai-bulk-setup' | 'done'). Keep existing booleans for back-compat.
- Add `convex/onboarding.ts` queries/mutations: `getProgress` (returns the full progress record + derived next step), `markStep({ step, state: 'complete'|'skipped' })`, and `setPhase`. Reuse `ensureChecklist` and `requireAnyWorkspaceRole`.
- Define the canonical step order as a single exported const in `convex/onboarding.ts` (business, ai, plunk, team, plaid, stripe, openingBalances, sync, review) and import it on the web side so step order is shared, not duplicated.
- Write `convex/onboarding.test.ts` cases for markStep/getProgress idempotency and resume (re-entering returns the saved currentStep).

**Files:** `convex/schema.ts:56-65`, `convex/onboarding.ts:82-100 (ensureChecklist)`, `convex/onboarding.ts:181-240 (checklist query)`, `convex/onboarding.test.ts`

**Definition of done**

- [ ] `getProgress` returns a persisted record with currentStep/completedSteps/skippedSteps and a derived nextStep.
- [ ] `markStep` is idempotent and updates completedSteps/skippedSteps without duplicating.
- [ ] Schema change is additive (all new fields optional); `npx convex dev` typechecks and existing onboarding tests still pass.
- [ ] New unit tests in `convex/onboarding.test.ts` cover resume + skip + idempotency.

**Deliverables:** Schema migration (additive fields) in convex/schema.ts; getProgress/markStep/setPhase in convex/onboarding.ts; Shared step-order const; convex/onboarding.test.ts additions

**Verify.** Run `pnpm verify` (typecheck+lint+unit). Run the onboarding unit tests: `pnpm test convex/onboarding.test.ts` and confirm resume/skip/idempotency cases pass.

### E4-T2 — Multi-business creation in onboarding + bootstrap rework
`size: M` · `risk: low` · `depends on: E4-T1`

**Intent.** Let the owner add one OR MORE businesses during first-run (Ansar runs Zikra + Z360), each getting its own typed chart, default bank account, and opening-balance-equity account, while keeping the existing single-business idempotency guard.

**Changes**

- Refactor `convex/onboarding.ts:bootstrapWorkspace` to create the workspace once and accept an array of businesses (name/type/currency). Reuse `createFirstBusinessForWorkspace` per business (rename to `createBusinessForWorkspace`), keeping `seedChartForEntity` + `ensureDefaultBankAccountForEntity` per entity.
- Add an `addBusinessDuringOnboarding` mutation (or reuse `entities.create:135`) that the wizard calls to append a business before finishing, so each is created with audit events.
- In `OnboardingScreen.tsx` step 0, allow adding multiple business cards (name/type/currency rows) with add/remove, min 1.
- Preserve the existing-workspace idempotency path (`bootstrapWorkspace:266-293`): if a workspace already has businesses, do not duplicate.
- Update `convex/onboarding.test.ts` to assert two businesses get two charts + two default bank accounts.

**Files:** `convex/onboarding.ts:110-179 (createFirstBusinessForWorkspace)`, `convex/onboarding.ts:242-349 (bootstrapWorkspace)`, `convex/entities.ts:135-184 (create)`, `apps/web/src/components/openbooks/OnboardingScreen.tsx:138-207 (business step)`

**Definition of done**

- [ ] bootstrapWorkspace creates N businesses, each with its own ledgerAccounts chart (including 3900) and a default bank account.
- [ ] The wizard UI can add/remove business rows (min 1) before finishing.
- [ ] Existing-workspace idempotency is preserved (no duplicate entities on re-run).
- [ ] Unit test asserts 2 businesses -> 2 charts + 2 default bank accounts; e2e adds 2 businesses and both appear in the switcher (`active-business-switcher`).

**Deliverables:** Reworked bootstrapWorkspace + per-business helper; Multi-business UI in OnboardingScreen.tsx; Unit + e2e assertions

**Verify.** Unit: `pnpm test convex/onboarding.test.ts`. E2e: extend `tests/e2e/onboarding.spec.ts` to add a second business and assert `[data-testid=active-business-menu]` lists both. Run `pnpm verify`.

### E4-T3 — BYO AI key + provider/model picker wired end-to-end (the activation blocker)
`size: L` · `risk: med` · `depends on: E4-T1, E3-T1, E3-T2`

**Intent.** Fix the confirmed root cause of the unposted backlog: the BYO AI key has no UI. Add a real in-UI key entry + provider + model switcher that validates and stores the key encrypted **through E3's unified credential resolver — NOT a parallel store** (decided: see decisions.md), so the categorizer can run on the owner's own provider instead of being bedrock-only. This is the single most important ticket in the epic.

**Changes**

- Backend: extend `ai.setConfig` (`convex/ai.ts:838-872`) to accept `provider`, `chatModel`, `categorizeModel`, and an `apiKey` (optional) that is written through the **unified `credentials` table owned by E3-T1** (`kind:"ai"`, workspace-scoped, single `encryptedPayload` blob via `secretBox`) — do NOT add or extend the dead per-field `aiCredentials` table (decided: see decisions.md). Never return the key in plaintext. Stop forcing `provider: 'bedrock'`. The provider list is all 14 from `aiCatalog.ts` (E3-T2 widens the `setConfig` arg validator from 5 to 14 — decided: see decisions.md).
- Backend: relax `aiProviderRegistry.ts` so a configured non-bedrock provider with a stored workspace key is `active` (not gated to bedrock by `v1Enabled` at :141). Resolve the key via **E3's provider-agnostic credential resolver (E3-T2/E3-T3)** at categorize/chat time, falling back to env.
- Backend: make `testProviderConnection` (`ai.ts:874`) actually exercise the configured provider+key (a tiny generate call) and return a clear ok/error.
- Frontend: in `AiSection.tsx:99-154`, un-`disable` the provider Select, add a model Select (driven by `aiCatalog`/registry), add a password-style API key Input with a Save action, and surface the test-connection result. Reuse this same component inside the onboarding AI step (E4-T4).
- Add a unit test that round-trips a saved key through setConfig -> E3 unified credential resolver -> resolve, asserting the plaintext key is never returned by any query.

**Files:** `convex/ai.ts:838-872 (setConfig)`, `convex/ai.ts:608-650 (providerStatus)`, `convex/ai.ts:874-881 (testProviderConnection)`, `convex/aiProviderRegistry.ts:132-175`, `convex/secretBox.ts`, `convex/aiCatalog.ts`, the E3-owned unified `credentials` table + resolver (E3-T1/E3-T2), `apps/web/src/components/openbooks/settings/AiSection.tsx:99-154`

**Definition of done**

- [ ] An owner can pick provider (any of the 14) + model and paste an API key in Settings > AI; saving stores it encrypted via E3's unified `credentials` store and providerStatus shows the configured provider active (not bedrock-forced).
- [ ] No new/parallel AI credential store is created; the dead per-field `aiCredentials` table is not extended (decided: see decisions.md).
- [ ] No query or mutation ever returns the plaintext key (unit-test asserted).
- [ ] testProviderConnection makes a real call against the configured provider/key and returns ok/error.
- [ ] The categorizer resolves the workspace key via E3's resolver for a non-bedrock provider; providerStatus.mode flips to 'active' for a configured provider with a key.
- [ ] AiSection provider Select is interactive (no `disabled` attr).

**Deliverables:** AI-key entry wired to E3's unified credential store + setConfig changes; Registry resolution via E3 resolver; Reworked AiSection.tsx with provider/model/key + test; Unit test for key round-trip + no-plaintext-leak

**Verify.** Unit: `pnpm test convex/ai*.test.ts`. Manual smoke: save a live or test key (live connectors work locally — decided: see decisions.md), click Test connection, observe success; trigger a categorize and confirm it uses the configured provider. Run `pnpm verify`.

### E4-T4 — Inline setup steps do REAL work: AI, Plunk, Plaid+mapping, Stripe-per-business, with URLs + guide links
`size: L` · `risk: med` · `depends on: E4-T1, E4-T3`

**Intent.** Replace the no-op IntegrationStep placeholders with steps that actually configure each integration inside the wizard, showing the exact redirect/webhook URL the owner must register and a guide link, all skippable with resume.

**Changes**

- Replace `IntegrationStep` placeholders (`OnboardingScreen.tsx:209-252,301-346`) with real step components: AI (reuse the E4-T3 provider/model/key panel), Plunk (workspace-scoped email key input -> store via the **unified `credentials` table, `kind:"plunk"`** owned by E3 — decided: see decisions.md), Plaid app (reuse `connections.saveWorkspacePlaidApp:468` + Plaid Link, then map each linked account to a business — **workspace-anchored Item, per-account→entity mapping** since one Plaid login spans both LLCs — decided: see decisions.md), Stripe **per business** (`entityId` required; reuse `connections.saveStripeCredential:528` / `startStripeOAuth:593`). Connecting Stripe REQUIRES registering + verifying the webhook before the connection reports 'listening' (E3-T6 — decided: see decisions.md). Live (not just sandbox/test) connectors must work locally — decided: see decisions.md.
- Each step renders the copyable URLs from `connections.webhookConfig:414` (plaidRedirectUri, stripeWebhookUrl, plaidWebhookUrl, siteUrl) and a 'How to register this' guide link, plus an explicit 'Skip for now' that calls `markStep(step,'skipped')` (E4-T1).
- On any successful connect, call the relevant checklist setter (bankConnected/aiConnected/stripeConnected) and `markStep(step,'complete')`.
- Reuse existing connection sheets (`AddBankSheet.tsx`, `StripeConnectSheet.tsx`) where possible to avoid duplicating Link/OAuth logic.
- Add Plaid account -> business mapping UI (one Plaid login spanning both LLCs is Ansar's real case) writing the entityId on each bankAccount. This mapping is the prerequisite for E5's intercompany detection — E4 does the mapping; **E5 owns the cross-entity intercompany detector** (decided: see decisions.md). See E4-T4 "ADD" note below.

**Files:** `apps/web/src/components/openbooks/OnboardingScreen.tsx:209-346`, `convex/connections.ts:414-426 (webhookConfig)`, `convex/connections.ts:468-591 (saveWorkspacePlaidApp/saveStripeCredential)`, `apps/web/src/components/openbooks/connections/AddBankSheet.tsx`, `apps/web/src/components/openbooks/connections/StripeConnectSheet.tsx`, `convex/team.ts:99-151 (invite, for E4-T5 cross-ref)`

**Definition of done**

- [ ] Completing the AI step stores a key via E3's unified store (E4-T3); completing Plaid stores the workspace-anchored app credential and maps each account to a business; completing Stripe stores a per-business (`entityId`) credential AND registers+verifies the webhook before reporting 'listening' — each verified by the resulting Convex row.
- [ ] Each integration step shows the real copyable URL from webhookConfig and a guide link.
- [ ] Every step has a working Skip that persists `skippedSteps` and is resumable.
- [ ] Checklist booleans flip on real connect; the post-onboarding checklist reflects skipped vs done.
- [ ] Each Plaid account is mapped to exactly one business (entityId on the bankAccount row), enabling E5's intercompany detection; live connectors work locally.

**Deliverables:** Real AI/Plunk/Plaid/Stripe onboarding step components; Plaid account->business mapping UI; Copyable URL + guide-link panels; Skip+resume wiring

**Verify.** E2e (live OR sandbox/test keys — live connectors work locally, decided: see decisions.md): complete the Plaid + Stripe steps and assert connectionCredentials/bankAccounts rows exist and map each account to the right entity, and that the Stripe connection only reports 'listening' after webhook verification; skip the others and assert skippedSteps persisted. Run `pnpm verify`.

### E4-T5 — Opening balances step: book balanced opening entries into account 3900
`size: M` · `risk: high` · `depends on: E4-T1, E4-T2`

**Intent.** Fix the audit finding that equity is $0 because no opening balance is booked on bank connect. Add a **USD-only** opening-balances step (no multi-currency / no PKR/INR opening balances / no base-currency conversion — decided: see decisions.md) that posts a balanced journal entry (debit each bank/asset, credit Opening Balance Equity 3900) through the single posting path so the balance sheet is correct from day one.

**Changes**

- Add a `setOpeningBalances` mutation (new file or in `convex/onboarding.ts`) that, per entity, takes the owner-entered opening cash balance (and any opening AR/AP) as **USD integer minor units only** (entity currency is locked to USD — decided: see decisions.md), builds a balanced entry (asset debit / 3900 credit), and posts it via the SINGLE posting path `postLedgerEntryCore` (`ledger.ts:345`) with source 'manual' and a clear memo — do NOT add a second posting path.
- **Date the opening entry the FIRST DAY OF THE MONTH** of the user's chosen history start (or the connector's earliest available transaction), flooring the chosen date to `M-01` (decided: see decisions.md) so the opening entry predates the oldest imported txn. Amount = Plaid-reported balance (later refined to `current_balance − Σ(imported after start)` — owned by E1-T2); auto-mark the line cleared.
- Resolve account 3900 via `ledgerAccounts` by_entity_and_number (it is seeded by `ledger.ts:53`). Validate debits==credits before posting (the engine already enforces this; the mutation must construct a balanced entry).
- Add the opening-balances onboarding step UI: one row per business + per connected bank account, prefilled from the live Plaid balance when available, editable, skippable. All amounts USD.
- On set, mark `openingBalancesSet` (E4-T1).
- Unit test: posting an opening balance creates a balanced USD entry, equity (3900) is credited the right amount, the entry is dated the first of the chosen month, and the trial balance ties.

**Files:** `convex/ledger.ts:53 (3900 account)`, `convex/ledger.ts:345 (postLedgerEntryCore)`, `convex/onboarding.ts`, `apps/web/src/components/openbooks/OnboardingScreen.tsx`, `convex/onboarding.test.ts`

**Definition of done**

- [ ] Setting an opening balance posts ONE balanced journal entry (asset debit = 3900 credit) via postLedgerEntryCore — no new posting path.
- [ ] Money is USD integer minor units; no floats, no non-USD opening balances (decided: see decisions.md).
- [ ] The opening entry is dated the first day of the chosen start month and the line is auto-marked cleared.
- [ ] After opening balances, the balance sheet shows non-zero Opening Balance Equity and still nets to balanced.
- [ ] Unit test asserts the balanced USD entry + equity amount + first-of-month date + trial balance ties; skipping leaves openingBalancesSet false and is resumable.

**Deliverables:** setOpeningBalances mutation (USD-only, first-of-month dated) using the single posting path; Opening-balances step UI prefilled from Plaid balance; Unit test for balanced opening entry + first-of-month date + trial balance

**Verify.** Unit: `pnpm test` the opening-balance case (assert balanced entry, 3900 credited, debits==credits). Manual: enter an opening balance, open Reports > Balance Sheet, confirm equity is non-zero and 'Balanced'. Run `pnpm verify`.

### E4-T6 — Invite-team step + self-host vs invited-join branching
`size: M` · `risk: low` · `depends on: E4-T1`

**Intent.** Add the invite-team step to onboarding and make the first-run correctly distinguish a self-host owner (full wizard) from an invited teammate (skip business creation, land in the existing workspace with their role).

**Changes**

- Add an invite-team onboarding step that calls `team.invite` (`team.ts:99`), shows the returned `inviteUrl`, supports multiple invites, and is skippable; mark `teamInvited` (E4-T1).
- In `AppShell.tsx:437-444`, branch the first-run: if the user joined via an accepted invite (already a member of an existing workspace via `auth.ts:createOrUpdateUser`), DO NOT show business creation — show a minimal 'you've joined {workspace}' confirmation and route to their role's landing (HR/member -> /payroll per `routesForRole`).
- Expose from `session.viewer` (or a small new query) whether the active membership came from an invite vs is the workspace owner, so the wizard can choose the path.
- Ensure an invited teammate never hits `bootstrapWorkspace`.

**Files:** `convex/team.ts:99-151 (invite)`, `convex/auth.ts:110-170 (invite acceptance)`, `convex/session.ts:5-41 (viewer)`, `apps/web/src/components/openbooks/AppShell.tsx:437-444`, `apps/web/src/components/openbooks/OnboardingScreen.tsx`

**Definition of done**

- [ ] Owner first-run includes a working invite step that surfaces the inviteUrl and persists invites; skippable + resumable.
- [ ] An invited teammate signing up via an invite link lands directly in the existing workspace with the invited role and never sees business creation.
- [ ] viewer (or new query) distinguishes owner-first-run vs invited-join.

**Deliverables:** Invite-team onboarding step; Invited-join branch in AppShell first-run; viewer/query field distinguishing the two paths; e2e assertion invited user skips business creation

**Verify.** E2e: existing invite spec + new assertion that an invited user never renders `onboarding-business-step`. Owner path: invite a teammate, copy inviteUrl. Run `pnpm verify`.

### E4-T7 — AI bulk-setup engine: sync user-chosen history, ask questions, PROPOSE income streams + categories + rules
`size: L` · `risk: med` · `depends on: E4-T1, E4-T3, E4-T4`

**Intent.** Build the 'done-for-you books' moment: after connections sync, an AI pass reviews the **user-chosen history window (default = pull as much as the connector gives — decided: see decisions.md)**, asks the owner a few clarifying questions, and writes a batch of onboarding proposals (income streams, suggested categories, and rules) for human approval. This is what makes the org feel pre-populated and correct.

**Changes**

- **History window is user-chosen, not a hardcoded ~6 months** (decided: see decisions.md). Default = pull everything the connector returns (Plaid `transactions.days_requested = 730` is set at `/link/token/create`; Stripe = account inception via cursor pagination); offer a "start my books on…" date control with presets; snap the chosen start to the first of its month; CSV/OFX upload covers history older than the connector returns.
- Add a `generateOnboardingProposals` action that (a) gathers transactions/merchants for each entity over the **chosen window** (use a real `Date.now()`-relative bound when no explicit start is given, NOT a hardcoded date), (b) clusters merchants/amounts to detect candidate income streams and recurring expense categories, (c) drafts suggested rules (merchantContains -> category), and (d) writes them as a reviewable batch.
- Reuse `proposals.recordProposal` (`proposals.ts:379`) where the kinds fit ('rule', 'categorize') and add an 'incomeStream' onboarding-proposal kind/table if needed (additive). The **income-stream taxonomy is defined ONCE here, shared with E2/Q8 and E9-T8: onboarding AI proposes → owner approves → persists as an explicit settings field the prompt reads** (decided: see decisions.md) — do not define the tag twice.
- Clarifying questions = a **small fixed core set (≤ ~5) augmented by AI-detected ambiguities** (e.g. transfer-vs-income, which account is which business) — decided: see decisions.md. Persist the questions + owner answers.
- Run this through the owner's configured AI provider via E3's resolver (E4-T3); degrade gracefully to deterministic clustering if no key (so the step still produces useful suggestions).
- Set `historyReviewed` on completion (E4-T1).
- Unit test: seed ~50 history rows, run the generator, assert N rule/income-stream proposals are created with sane payloads; assert the window honors the chosen start (and is computed from now, not a frozen 2026 date, when no start is chosen).

**Files:** `convex/proposals.ts:31-37 (PROPOSAL_KIND)`, `convex/proposals.ts:379-405 (recordProposal)`, `convex/pipeline.ts (cascade reference for merchant/category signals)`, `convex/rules.ts (rule shape)`, `convex/agentToolQueries.ts:35 (avoid the hardcoded 2026 default-dates antipattern)`, `convex/onboarding.ts`

**Definition of done**

- [ ] Running the generator over seeded history produces a batch of onboarding proposals (income streams + categories + rules) with valid payloads.
- [ ] The history window honors the user-chosen start (default = pull everything the connector gives); the now-relative fallback bound is computed at runtime (no hardcoded 2026 date) — decided: see decisions.md.
- [ ] The income-stream taxonomy is defined once (AI proposes → owner approves → persists) and is the same field E2/E9 read.
- [ ] With no AI key, the generator still produces deterministic suggestions (graceful degradation).
- [ ] A small fixed core set of clarifying questions (≤ ~5) plus AI-detected ambiguities + owner answers persist.
- [ ] `historyReviewed` is marked on completion.

**Deliverables:** generateOnboardingProposals action; Optional additive incomeStream proposal kind/table; Clarifying-questions persistence; Unit test over seeded history

**Verify.** Unit: `pnpm test` the generator over seeded history; assert proposal count + payload validity + relative window. Run `pnpm verify`.

### E4-T8 — Human review & approve screen for AI onboarding proposals
`size: M` · `risk: med` · `depends on: E4-T7`

**Intent.** Give the owner a clear review/approve gate for the AI's proposed income streams, categories, and rules before the AI runs the books — honoring 'AI proposes, the ledger engine posts' and the human-in-the-loop contract.

**Changes**

- Add a review step/screen that lists the onboarding proposals from E4-T7 grouped by type (income streams, categories, rules) with plain-English summaries, edit-before-approve, and per-item approve/reject + 'approve all'.
- Wire approve to existing confirm paths: rule proposals -> `ai.createConfirmedRule` (`ai.ts:883`) or `proposals.confirmProposal` (`proposals.ts:611`); income-stream/category proposals -> create the corresponding records. Reject -> `proposals.dismissProposal` (`proposals.ts:656`).
- On completing review, mark `proposalsReviewed` and advance phase to 'done' (E4-T1).
- Ensure approving a rule that auto-posts respects autonomy thresholds (suggest/balanced/autopilot) — never silently bypass the gate.
- E2e: generate proposals, approve them, assert rules exist (`rules` table) and the proposal status flips to confirmed.

**Files:** `convex/proposals.ts:611-681 (confirmProposal/dismissProposal)`, `convex/proposals.ts:682-704 (listProposals)`, `convex/ai.ts:883-952 (createConfirmedRule)`, `apps/web/src/components/openbooks/OnboardingScreen.tsx`, `apps/web/src/components/openbooks/settings/RulesSection.tsx (rule UI reference)`

**Definition of done**

- [ ] The review screen lists all onboarding proposals grouped by type with summaries and edit-before-approve.
- [ ] Approve creates the underlying records (rules/streams/categories) via existing confirm paths; reject dismisses.
- [ ] Autonomy thresholds are respected for any auto-posting rule.
- [ ] `proposalsReviewed` set and phase advances to done.
- [ ] E2e asserts approved rules appear in the rules table and proposal status is confirmed.

**Deliverables:** Proposal review/approve UI; Approve/reject wiring to confirmProposal/createConfirmedRule/dismissProposal; E2e approve flow

**Verify.** E2e: approve proposals, assert `rules` rows + confirmed proposal status; reject one, assert dismissed. Run `pnpm verify`.

### E4-T9 — Finish: AI runs the books + land on a fully-populated org
`size: M` · `risk: med` · `depends on: E4-T5, E4-T8`

**Intent.** Close the loop so that on finishing onboarding the owner lands on a populated dashboard (status, transactions, expenses, AR/AP, reports, payroll-ready) rather than an empty shell — the visible payoff of 'done-for-you books'.

**Changes**

- On finish, after approvals (E4-T8), trigger the pipeline/categorizer over the synced history so confident items post and the rest land in the Inbox (reuse the existing cascade in `pipeline.ts`); mark onboarding phase 'done'.
- Replace the hard `router.push('/dashboard')` (`OnboardingScreen.tsx:82`) with a finish handler that waits for the bulk pass to enqueue, then routes to the dashboard with a 'your books are being set up' state that resolves into populated numbers.
- Add a post-onboarding 'first-run summary' surface (counts: businesses, accounts, connected feeds, posted vs inbox, proposals approved) so the owner sees the populated org immediately.
- Ensure the dashboard/coreViews land on real numbers for the active entity (do not regress the live-Plaid-vs-ledger split; just render whatever the ledger now holds).

**Files:** `apps/web/src/components/openbooks/OnboardingScreen.tsx:70-87 (finish)`, `convex/pipeline.ts (cascade entry points)`, `convex/coreViews.ts:180 (dashboard)`, `convex/onboarding.ts`

**Definition of done**

- [ ] Finishing onboarding enqueues the categorize/post pass and routes to a dashboard that shows real ledger-backed counts (transactions, expenses, AR/AP) for the active entity.
- [ ] A first-run summary shows businesses/accounts/feeds/posted-vs-inbox/proposals-approved.
- [ ] No ledger posting-path regression; postLedgerEntryCore unchanged.
- [ ] E2e screenshot shows a populated dashboard (inbox/transaction counts > 0) after finishing in the seeded path.

**Deliverables:** Finish handler that runs the bulk pass + routes; First-run summary surface; E2e populated-dashboard assertion + screenshot

**Verify.** E2e: finish onboarding in the seed path, assert dashboard counts > 0, capture screenshot. Run `pnpm verify`.

### E4-T10 — Owner data reset / re-onboard + public no-login demo entry
`size: L` · `risk: med` · `depends on: E4-T1, E4-T2`

**Intent.** Give the owner a clean, scoped 'delete all my data and start over' that re-runs onboarding, and add the public no-login demo entry so prospects can try before cloning — both explicitly in Ansar's go-live vision. **The demo BACKEND (single shared workspace, server slug-resolution, read-only guard, daily reset cron) is OWNED by E11; E4 ships the owner reset/re-onboard path and the demo entry/CTA that link to it** (decided: see decisions.md).

**Changes**

- Add an owner-scoped `resetWorkspaceData` mutation/action that deletes ONLY the current workspace's entities/ledger/connections/transactions/proposals/checklist (NOT other workspaces, NOT the user account), behind a typed confirmation (re-type the workspace name — decided: see decisions.md) + an `auditEvents` record, then sets viewer back to needs_onboarding. Reuse the table-walk pattern from `realTestReset.ts:409 (deleteBatch)` but scope it to one workspaceId and keep the user. Delete local connection/credential rows only — do NOT call provider revoke APIs (decided: see decisions.md).
- Wire a 'Delete all data & re-run onboarding' control in `DataSection.tsx` (today permanent deletion is deliberately hidden — replace with this scoped, reversible-via-re-onboarding flow).
- Public demo = a **single shared, server-resolved no-login workspace** (decided: see decisions.md), NOT a per-visitor ephemeral clone. The `/demo` route serves truly unauthenticated users; the demo workspace is resolved **by slug on the server** and reads are allowed by a shared server-side `requireWorkspaceRead`-style guard only when `workspace.isDemo === true` (no anonymous Convex Auth identity; UI hiding is not the boundary). **E11 owns this backend + the daily reset cron**; E4 renders the populated `/demo` view (reuse `seedDemo.ts` data) read-only with a 'Clone this to your own account' CTA that drops the visitor into sign-up + a pre-seeded onboarding.
- Ensure the demo path cannot mutate any workspace and is clearly flagged as demo (reuse the `isDemo` indicator already in AppShell).

**Files:** `convex/realTestReset.ts:409-451 (deleteBatch pattern)`, `convex/seedDemo.ts:202 (resetAndSeed)`, `convex/auth.ts:203-226 (slug fallback — E11's demo hook point)`, `convex/ledger.ts:260 (fixed-slug entity pattern)`, `apps/web/src/components/openbooks/settings/DataSection.tsx:81-90 (danger zone)`, `convex/session.ts:5-41 (viewer status)`, `apps/web/src (new /demo route; backend owned by E11)`

**Definition of done**

- [ ] resetWorkspaceData empties only the current workspace's books/connections/transactions and returns viewer to needs_onboarding, leaving other workspaces and the user account intact (unit-test asserted); confirmation requires re-typing the workspace name and writes an auditEvents record; local credential rows are deleted without calling provider revoke APIs.
- [ ] A typed-confirmation control in DataSection triggers the scoped reset and re-runs onboarding.
- [ ] The public /demo route loads unauthenticated against the single shared, server-slug-resolved demo workspace (read-only via the server-side guard, no anonymous identity) and shows populated demo transactions with a clear demo flag + clone CTA.
- [ ] Cloning the demo lands a new sign-up into onboarding pre-seeded with demo data; no demo interaction mutates any workspace.

**Deliverables:** Scoped resetWorkspaceData mutation/action; DataSection reset control; Public /demo route + clone CTA; Unit test for scoped reset isolation

**Verify.** Unit: `pnpm test` scoped-reset isolation (other workspace untouched, viewer needs_onboarding). E2e: load /demo unauthenticated and assert populated transactions render. Run `pnpm verify`.

## Decisions applied

All prior open questions for this epic are RESOLVED in `../decisions.md` (canonical) and the per-epic deltas in `../plan-rebuild-changelog.md` (E04). Specifically:

- **AI key storage (Q18):** unified `credentials` table (`kind:"ai"`, workspace-scoped, single `encryptedPayload` blob via `secretBox`), owned by E3 — NOT a separate/per-field `aiCredentials` table. E4-T3 consumes E3's resolver.
- **History window (Q19):** user-chosen; default = pull as much as the connector gives (Plaid `days_requested=730`, Stripe inception); snap chosen start to the first of its month; CSV/OFX for older. NOT a hardcoded ~6 months. (E4-T7)
- **Opening balances (Q20):** USD-only, integer minor units; no multi-currency / no base-currency conversion. Dated the first day of the chosen start month, offset to 3900. (E4-T5)
- **Public demo (Q21/Q56):** single shared, server-slug-resolved no-login workspace with a server-side read-only guard and daily reset cron — backend OWNED by E11; E4 ships the entry + clone CTA. NOT a per-visitor clone. (E4-T10)
- **Clarifying questions (Q22):** small fixed core set (≤ ~5) + AI-detected ambiguities. (E4-T7)
- **Intercompany (Q23):** E4 only maps each Plaid account → one business; the cross-entity intercompany DETECTOR is owned by E5. (E4-T4)
- **Live connectors local (Q16) + Stripe webhook required (Q15):** live (not just sandbox/test) keys work locally; connecting Stripe requires a verified webhook (E3-T6). (E4-T4)
- **Stream taxonomy (Q49):** defined ONCE here (AI proposes → owner approves → persists), shared with E2/E9-T8. (E4-T7)

No items in this epic still require Ansar. (Remaining genuine product calls live in E13/E14/E15 per `../decisions.md` "Still needs Ansar".)
