# E3 — Integrations & BYO-keys (Plaid / Stripe / AI / Plunk)

> Part of the **OpenBooks Launch Sprint**. Master plan: [../README.md](../README.md) · Backlog: [../backlog.md](../backlog.md)

**Goal.** Make every integration a real, in-UI, per-business bring-your-own-key experience: an AI provider+model switcher that writes through the **single unified `credentials` table** and is actually consumed by the categorizer and chat runtime (today missing — the single upstream cause of the unposted-transaction backlog); Plaid BYO with per-account→business mapping at link time on a **workspace-anchored Item**; Stripe BYO with a **required + verified** webhook per business; a Plunk key entry+verify; one redesigned, responsive Connections surface with per-connection health/validate/re-link; secrets encrypted at rest via secretBox and never returned to the client.

**This epic is the OWNER of the unified credential layer.** It collapses the dead per-field `aiCredentials` table and the proven `connectionCredentials` blob into ONE unified `credentials` table (single `encryptedPayload` JSON blob + `fingerprint` + `keyPreview` + `status`, `kind: ai|plaid|stripe|plunk`, `workspaceId` always + `entityId` when per-business). E2/E4/E8/E9 consume the resolver E3 owns — they do not build their own storage path (decided: see decisions.md, Global rule 5). Live connectors must work locally; the sandbox/test-only gate is removed (decided: see decisions.md Q16).

**Why it matters.** Ansar's go-live promise is "BYO any of 14 AI providers" and connections that map to the right LLC. Right now the AI key field is a dead, disabled dropdown that says "set in Convex env" (AiSection.tsx:105) and nothing ever writes the aiCredentials table — so unless the operator has AWS Bedrock env vars, AI categorization is silently off and ~78-80% of real transactions never post, drastically understating reports (RC9 → RC1 in the audit). His one Plaid login spans both LLCs, but a Plaid item today dumps every account into one business with no way to split them. Stripe can save a key but never forces the webhook that makes payouts reconcile in real time. Plunk (which sends his weekly CFO digests and team invites) has no key-entry UI at all. This epic turns the data model that already exists into a working, owner-operable control panel so his real books become correct and the BYO story is true end to end.

## Current state

AI BYO is the central gap. The catalog (convex/aiCatalog.ts, 14 providers, models, keysUrl, credentialKind), the model factory (convex/aiProvider.ts buildModelForProvider:44, decryptCredentialRow:83, credentialIsComplete:149, resolveModelId:165, resolveCredentialFromEnv:104), and the schema table (convex/schema.ts:326 aiCredentials with apiKeyCiphertext/accessKeyIdCiphertext/secretAccessKeyCiphertext/baseUrl/region/lastFour, indexed by_workspace_and_provider) ALL EXIST but are orphaned: grep shows aiCredentials is referenced only in schema.ts and aiProvider.ts — zero insert/patch callers. The UI (apps/web/.../settings/AiSection.tsx:105) is a hardcoded disabled <Select> listing only 5 providers; the key field is a static "set in Convex env · never shown" box. convex/ai.ts setConfig:838 hardcodes provider:"bedrock" and never touches aiCredentials; providerStatus:608 reads only bedrockEnvironmentStatus(); testProviderConnection:874 delegates to aiSdkRuntime.testProviderConnection:42 which is hardwired to createAmazonBedrock. convex/aiProviderRegistry.ts:141 forces active = id==="bedrock". convex/bedrockCategorizer.ts:150 (bedrockRuntimeEnv) requires AI_PROVIDER==="bedrock" + AWS env; any other provider → degraded → everything to Inbox. Plaid BYO is built: convex/connections.ts saveWorkspacePlaidApp:468 writes encrypted connectionCredentials, webhookConfig:414 exposes the real redirect+webhook URLs, PlaidSetupSheet.tsx shows them. BUT convex/plaid.ts upsertPlaidAccountsForItemCore:1874 writes every account in a Plaid item to the single entityId passed to exchangePublicTokenAndPreviewAccounts:1716 — no per-account→business split (RC: blueprint line 347, "one Plaid item can't split accounts across businesses"). Stripe BYO is built: saveStripeCredential:528 validates the rk_ key against /account, stores encrypted, associates per entity, webhookConfig exposes the webhook URL; StripeConnectSheet.tsx is per-business. BUT webhookSecret is optional and webhookStatus is set to "listening" the instant a secret string is saved (upsertConnectionCredential:845) without ever verifying a real delivery; it never flips to "failing". Plunk is env-only: packages/email/src/plunk.ts and convex/auth.ts:53 read process.env.PLUNK_SECRET_KEY; there is no BYO Plunk UI, no schema row, no validate. The Connections UI (ConnectionsSection.tsx) groups banks+Stripe by business and has disconnect, but has no AI provider switcher, no Plunk card, and no per-connection "validate/health/re-link" action surfaced. secretBox.ts (encryptSecret/decryptSecret, AES-GCM, OPENBOOKS_SECRET_ENCRYPTION_KEY) is the encryption primitive and is already used by both connectionCredentials and the (unwritten) aiCredentials path.

## Definition of done (epic)

- [ ] An admin can paste an AI provider key (or Bedrock access-key pair / Ollama base URL) in Settings, pick one of the **14** catalog providers (the `aiCatalog.ts` set is canonical; the `setConfig` validator is widened from 5 to 14 — decided: see decisions.md Q12) and a model, save, and the plaintext is written ONLY as an encrypted `encryptedPayload` blob to the **unified `credentials` table** (`kind:"ai"`, workspace-scoped — decided: see decisions.md Q13/Q18) (verified: a fresh row exists with `encryptedPayload` set, `keyPreview` populated, and no field contains the plaintext key); the client query never returns any ciphertext or plaintext secret.
- [ ] After saving a non-Bedrock AI credential and switching the workspace provider to it, the categorizer **and Ask-AI chat and test-connection** actually run on that provider (verified: a unit/integration test resolves the active provider+model+decrypted credential through aiProvider.buildModelForProvider for at least 3 providers, and **all three runtimes' provider-resolution** no longer hard-require AWS Bedrock env — decided: see decisions.md Q11).
- [ ] A 'Test connection' action exists per AI provider that performs a live (or stubbed-in-test) minimal generation and reports ok/degraded with a redacted message; failures never echo the key.
- [ ] When a **workspace-anchored** Plaid Item exposes accounts that belong to different businesses, the owner can assign each account to a specific business at link time (or immediately after), and each bankAccount + its ledger account is created under the chosen entityId (verified: a test linking a 2-account item with two different target entities produces two bankAccounts under two entityIds). The Item is workspace-level; the account→entity mapping lives on the account rows (decided: see decisions.md Q17) — this is the prerequisite for E5 intercompany detection.
- [ ] Stripe BYO **requires** a verified webhook: a live Stripe connection does not report 'listening' until the webhook endpoint is registered and a signed delivery (or an explicit verify action) confirms it (decided: see decisions.md Q15). Saving a webhook secret sets status to a pending/unverified state until verified; an unverified or failing webhook is visibly flagged in the UI.
- [ ] An admin can paste a Plunk secret key (+ from-email/from-name) in Settings; it is encrypted at rest **in the same unified `credentials` table** (`kind:"plunk"`, workspace-scoped — decided: see decisions.md Q14), validated against Plunk, and the app's email senders prefer the saved BYO key over the env var; the UI shows verified/last4 only.
- [ ] Every connection (AI, Plaid, Stripe, Plunk) shows a clear status/health state (active / needs attention / re-link required / not configured) and exposes a validate and a re-link/rotate action; status is derived from a server query, not optimistic client state.
- [ ] The Connections settings surface is redesigned to be responsive (no horizontal scroll at 360px), groups connections by business, links to provider setup guides, and shows the copyable redirect/webhook URLs the owner must register — verified by an e2e test and a 360px-width screenshot.
- [ ] No secret (AI key, Plaid secret/client_id, Stripe rk_ key, Stripe/Plaid webhook secret, Plunk key, access tokens) is ever returned to the client or logged in plaintext — verified by grepping the connections/ai query return shapes and a redaction test.
- [ ] All quality gates pass: pnpm typecheck && pnpm lint && pnpm build && pnpm test:unit, plus the new/updated Playwright connection+AI settings specs.

## Tickets (11)

### E3-T1 — Backend: unified `credentials` table — write+read+validate for ai/plaid/stripe/plunk (collapse `aiCredentials` + `connectionCredentials`)
`size: L` · `risk: med` · `depends on: —`

**Intent.** Stand up ONE unified credential store for every secret in the app so a workspace can store BYO AI/Plaid/Stripe/Plunk keys encrypted at rest, with only a redacted preview ever readable by the client. This is the single source of truth E2/E4/E8/E9 consume; it unblocks every other AI ticket (decided: see decisions.md Q12–Q14/Q18, Global rule 5).

**Changes**

- Adopt the **`connectionCredentials` blob shape** (V1: the proven, live shape) as the template: a single `encryptedPayload` JSON blob + `fingerprint` + `keyPreview` + `status`, plus `kind: "ai" | "plaid" | "stripe" | "plunk"`, `workspaceId` (always), and `entityId` (set when per-business). Collapse the **dead per-field `aiCredentials` table** (schema.ts:326 — referenced only by schema + aiProvider, zero callers) into this shape; do not extend the per-field table. Use the migration-helper skill to land the schema change additively (widen-then-narrow).
- Scoping (decided: see decisions.md Q13/Q17): **AI = workspace-scoped**, **Plunk = workspace-scoped**, **Stripe = per-business (`entityId` required)**, **Plaid Item = workspace-anchored** (account→entity mapping lives on the account rows, not the credential).
- In a new convex/credentials.ts, add a mutation/action saveCredential({workspaceId, kind, entityId?, payload:{apiKey?|accessKeyId?+secretAccessKey?|baseUrl?|region?|webhookSecret?|fromEmail?|fromName?|...}, model?}) that requires workspace 'admin' (reuse requireWorkspaceRole as in ai.ts:845), validates the AI provider via aiCatalog.normalizeAiProviderId when kind==="ai", encrypts the whole payload object with secretBox into `encryptedPayload`, computes `keyPreview` (last4) + `fingerprint` from the raw secret, and upserts one row per (workspaceId, kind, provider/entityId) scope key.
- Require secretBox.isSecretEncryptionConfigured() before saving (mirror connections.ts requireSecretVault:140) and throw a clear ConvexError naming OPENBOOKS_SECRET_ENCRYPTION_KEY when absent. **Fix the KDF**: derive 32 raw bytes via HKDF, not a bare SHA-256 of the env value (decided: see decisions.md Global rule 5).
- Add deleteCredential({workspaceId, kind, entityId?, provider?}) (admin) that hard-deletes the row.
- Add a query credentialStatus({workspaceId}) that returns, per saved row: {kind, provider?, entityId?, keyPreview, baseUrl, region, model, configured:true, hasApiKey/hasAwsKeys booleans, status, updatedAt} — NEVER any ciphertext or plaintext.
- Insert an auditEvents row on save/delete (mirror connections.ts upsertConnectionCredential:858).
- Add an internalQuery getActiveCredential({workspaceId, kind, entityId?, provider?}) returning the raw Doc for server-side resolution (used by T2/T3/T7).

**Files:** `convex/credentials.ts (new)`, `convex/ai.ts`, `convex/connections.ts (connectionCredentials shape — template; converge onto it)`, `convex/schema.ts (unified credentials table — additive widen, collapse aiCredentials:326)`, `convex/secretBox.ts (encryptSecret/decryptSecret + KDF fix — reuse)`, `convex/aiCatalog.ts (normalizeAiProviderId, getProviderEntry — reuse)`

**Definition of done**

- [ ] Calling saveCredential({kind:"ai", apiKey}) writes exactly one unified `credentials` row with `encryptedPayload` set, `keyPreview` = last 4 of the raw key, and no stored field equal to the raw key.
- [ ] saveCredential a second time for the same scope key updates the same row (no duplicate).
- [ ] The dead per-field `aiCredentials` table is removed (or no longer written); all four kinds (ai/plaid/stripe/plunk) round-trip through the one table.
- [ ] credentialStatus return type contains no *Ciphertext/`encryptedPayload` field and no raw key (asserted in a unit test).
- [ ] saveCredential without OPENBOOKS_SECRET_ENCRYPTION_KEY throws a ConvexError naming the env var; the KDF derives 32 raw bytes via HKDF (not bare SHA-256).
- [ ] deleteCredential removes the row and credentialStatus stops listing that scope.

**Deliverables:** convex/credentials.ts; schema migration (migration-helper); unit test convex/credentials.test.ts covering encrypt-at-rest, keyPreview, no-secret-leak, upsert, all four kinds, KDF, missing-key error

**Verify.** pnpm test:unit -- credentials; manually run `npx convex run` style test via convex-test harness asserting `encryptedPayload` != plaintext and credentialStatus omits secrets.

### E3-T2 — Backend: provider-agnostic resolver + make providerStatus/setConfig credential-aware (widen validator 5→14)
`size: L` · `risk: med` · `depends on: E3-T1`

**Intent.** Replace the Bedrock-only resolution with a single resolveActiveAiModel() that reads the workspace aiConfig (provider + model) and the saved unified credential (or env fallback), so the rest of the app stops being hard-wired to Bedrock. This is the linchpin that turns RC9 off.

**Changes**

- Add convex/aiResolve.ts exporting resolveActiveAiModel(ctx, {workspaceId, purpose:'chat'|'categorize'}) that: reads aiConfigs (ai.ts pattern), determines provider (config.provider, default the first configured `kind:"ai"` credential provider, else env via resolveAIProviderRegistry), determines modelId via aiProvider.resolveModelId(provider, purpose==='chat'?config.chatModel:config.categorizeModel), loads credential via getActiveCredential(kind:"ai")→decryptCredentialRow else resolveCredentialFromEnv(provider), and returns {provider, modelId, credential, ready:credentialIsComplete(provider,credential)}.
- Keep the **per-call factory** `buildModelForProvider` (decided: see decisions.md / Global; R5 confirms `createProviderRegistry` has no per-request-key hook). Do NOT route through `createProviderRegistry`.
- Generalize convex/ai.ts setConfig:838 to accept provider + chatModel + categorizeModel from the full aiCatalog and **widen the `setConfig` arg validator and `aiProviderIdValidator` from the current 5 providers to all 14** (`aiCatalog.ts` is canonical — decided: see decisions.md Q12); additive/non-breaking (existing rows already validate). Replace the hardcoded provider:'bedrock' default with aiCatalog-based validation, keeping autonomy behavior unchanged.
- Update convex/ai.ts providerStatus:608 to report mode/active from the resolved credential (configured if a unified `kind:"ai"` row OR env exists for the chosen provider) instead of bedrockEnvironmentStatus-only; include the chosen provider+model and a per-provider 'configured' flag sourced from credentialStatus.
- Update convex/aiProviderRegistry.ts:141 so 'active' is no longer forced to id==='bedrock' (drive it from real credential presence) OR leave the legacy env registry intact but stop using its bedrock-only active flag in providerStatus — pick one and document it.
- Add **validate-on-save**: a 1-token ping when a key is saved (cheap reachability check; common providers ping, long tail name-checked — coordinated with E13-T4).
- Do NOT change ledger posting; this only changes which model runs.

**Files:** `convex/aiResolve.ts (new)`, `convex/ai.ts (setConfig:838 + widen validator 5→14, providerStatus:608)`, `convex/aiProvider.ts (reuse buildModelForProvider/credentialIsComplete/resolveModelId/decryptCredentialRow)`, `convex/aiProviderRegistry.ts (line 141 active flag)`, `convex/aiCatalog.ts (canonical 14-provider validation source of truth)`

**Definition of done**

- [ ] resolveActiveAiModel returns provider+model+ready for at least 3 providers in a test using saved unified credentials, and falls back to env when no row exists.
- [ ] setConfig persists a non-bedrock provider + a chosen chatModel + categorizeModel and providerStatus reflects them; the arg validator accepts all 14 catalog providers and existing rows still validate.
- [ ] providerStatus reports mode:'active' when a valid BYO credential exists for the chosen provider even with no AWS env set.
- [ ] No change to debits=credits invariants or any ledger test (ledger.spec.ts still green).

**Deliverables:** convex/aiResolve.ts; updated ai.ts (validator widened 5→14); unit test convex/aiResolve.test.ts

**Verify.** pnpm test:unit -- aiResolve ai; assert providerStatus active without AWS env when an openai/anthropic unified credential row is present; assert setConfig accepts all 14 providers.

### E3-T3 — Backend: route categorizer + Ask-AI chat + test-connection through the provider-agnostic runtime
`size: L` · `risk: med` · `depends on: E3-T2`

**Intent.** Actually consume the resolved provider in **all three runtimes** that today hardcode Bedrock-from-env (categorizer, Ask-AI chat, test-connection — decided: see decisions.md Q11), so BYO keys produce real categorizations and chat answers — the fix that drains RC1's unposted backlog. This is upstream of E2 (categorizer), E8-T8 (banner AI narration) and E9 (CFO narration); all "AI is Bedrock-only until BYO lands" caveats elsewhere are removed because BYO lands here, this sprint.

**Changes**

- In convex/aiSdkRuntime.ts testProviderConnection:42, replace the createAmazonBedrock block with buildModelForProvider(resolveActiveAiModel(...)) and run the same minimal generateText probe; keep redaction (redactEnvValues) and extend it to redact the resolved apiKey too.
- In the categorizer path (convex/bedrockCategorizer.ts bedrockRuntimeEnv:150 and its callers), introduce a provider-agnostic categorize entrypoint that uses resolveActiveAiModel({purpose:'categorize'}) + generateText/generateObject via the AI SDK instead of the Bedrock invoke-model payload switch; keep the existing Bedrock path working when provider==='bedrock'. Preserve the exact structured-output contract the pipeline expects (same parsed fields the cascade consumes).
- Ensure chat (convex/agent.ts:88 / aiSdkRuntime) resolves the same way for purpose:'chat'.
- When resolveActiveAiModel().ready === false, return the existing degraded behavior (route to Inbox) with a reason naming the missing provider/key — no crash.
- Confirm secrets never appear in any thrown error or audit summary.

**Files:** `convex/aiSdkRuntime.ts (testProviderConnection:42, createAmazonBedrock:70)`, `convex/bedrockCategorizer.ts (bedrockRuntimeEnv:150, payload switch:169)`, `convex/agent.ts (createAmazonBedrock:88)`, `convex/aiResolve.ts (from E3-T2)`, `convex/aiProvider.ts`

**Definition of done**

- [ ] With a valid OpenAI/Anthropic aiCredentials row and that provider selected, testProviderConnection returns ok:true (live) or, in CI, a stubbed model returns ok without contacting AWS.
- [ ] A categorization integration test (stubbed model) produces a posted/needs_review decision via a non-bedrock provider — proving the categorizer is no longer Bedrock-gated.
- [ ] Degraded path (no key) still routes to Inbox with a clear reason and does not throw.
- [ ] No secret string appears in any error message (redaction test passes).

**Deliverables:** updated aiSdkRuntime.ts, bedrockCategorizer.ts, agent.ts; integration test proving non-bedrock categorize + chat probe

**Verify.** pnpm test:unit -- aiSdkRuntime bedrockCategorizer agent; tests/e2e/ai-chat.spec.ts still green; manual: save an Anthropic key, switch provider, run a sync, confirm items post.

### E3-T4 — UI: replace the dead AI provider/model field with a real BYO provider+model switcher
`size: M` · `risk: low` · `depends on: E3-T1, E3-T2`

**Intent.** Turn AiSection.tsx:105 (disabled dropdown + 'set in Convex env' static box) into a working key-entry + provider + model picker driven by the full aiCatalog, wired to T1/T2 — the owner-facing half of RC9.

**Changes**

- Replace the disabled <Select> (AiSection.tsx:104-119) with an enabled provider Select populated from a new query that returns the aiCatalog (id,label,credentialKind,keysUrl,models,requiresBaseUrl,defaultModel) — add api.aiCatalog.list (a public query wrapping listProviderCatalog()).
- Add a model Select (catalog models for the chosen provider) plus a free-text 'custom model ID' input (the catalog explicitly says model lists are not load-bearing — aiCatalog.ts:14).
- Render credential fields conditionally by credentialKind: single SecretInput (apiKey) for 'apiKey'; access-key pair + region for 'awsKeys' (bedrock); base URL only for 'none' (ollama); show baseUrl field when requiresBaseUrl or provider is openai_compatible/azure.
- Show a 'Get a key' link to entry.keysUrl and display the saved last4 (from credentialStatus, `kind:"ai"`) as '••••1234 · saved', never the key.
- Wire Save → saveCredential({kind:"ai"}) + setConfig(provider, chatModel, categorizeModel); wire the existing 'Test connection' button to the now-provider-agnostic testProviderConnection.
- Reuse the SecretInput primitive from settings/connections/shared.tsx; keep autonomy cards unchanged.
- Mobile: single-column at <640px (the grid is already sm:grid-cols-2).

**Files:** `apps/web/src/components/openbooks/settings/AiSection.tsx`, `apps/web/src/components/openbooks/settings/connections/shared.tsx (SecretInput — reuse)`, `convex/aiCatalog.ts (add list query, or new convex/aiCatalog public wrapper)`, `convex/ai.ts (providerStatus/setConfig from E3-T2), convex/credentials.ts (from E3-T1)`

**Definition of done**

- [ ] Provider Select lists all 14 catalog providers and is enabled; choosing one updates the model list and the visible credential fields.
- [ ] Pasting a key + Save calls saveCredential({kind:"ai"}) and setConfig; after save the field shows last4 only and the key input clears.
- [ ] A custom model ID can be typed and is persisted as categorizeModel/chatModel.
- [ ] 'Test connection' reflects the selected provider's result.
- [ ] data-testids exist for provider select, model select, key input, save, and connection state for e2e.

**Deliverables:** redesigned AiSection.tsx; aiCatalog list query; Playwright assertions in tests/e2e/settings.spec.ts

**Verify.** pnpm typecheck && pnpm lint; tests/e2e/settings.spec.ts asserts the provider dropdown is enabled, has 14 options, accepts a key, and shows last4 after save (stub the action in test).

### E3-T5 — Plaid: map each linked account → a business at link time (split a multi-LLC Plaid item)
`size: L` · `risk: med` · `depends on: —`

**Intent.** Fix the confirmed gap (plaid.ts:1888 upsertPlaidAccountsForItemCore writes every account to one entityId) so Ansar's single Plaid login spanning Zikra + Z360 can route each bank account to the correct LLC.

**Changes**

- Change exchangePublicTokenAndPreviewAccounts:1716 to return the previewed accounts (id, name, mask, subtype, balance) WITHOUT persisting them to a single entity — i.e. a preview-then-assign flow — OR add a follow-up action assignPlaidAccountsToBusinesses({plaidItemId, assignments:[{plaidAccountId, entityId}]}).
- Generalize upsertPlaidAccountsForItemCore:1874 to accept a per-account entityId (the assignment) rather than one args.entityId for all; create each bankAccount + its ledgerAccount under its assigned entity, validating every entity is in the same workspace and authorized.
- Make the **Plaid Item workspace-anchored** (decided: see decisions.md Q17): one Plaid login spans both LLCs, so the `plaidItems` row is workspace-level and each `bankAccount` points to its owning entity. (The `plaidItems.entityId` field at schema.ts:248 becomes the originating/default entity only; the credential + Item anchor are workspace-scoped.) This account→entity mapping is the prerequisite for E5 intercompany detection.
- Default assignment = the entity the owner started from (back-compat), so existing single-business links are unchanged.
- Surface this in AddBankSheet.tsx: after Plaid Link success, show the returned accounts each with a BusinessSelect (reuse shared.tsx BusinessSelect) defaulting to the started business, then confirm.
- Guard: do not silently drop un-mapped sub-accounts (blueprint line 347) — every previewed account must be either assigned or explicitly excluded.

**Files:** `convex/plaid.ts (exchangePublicTokenAndPreviewAccounts:1716, upsertPlaidAccountsForItemCore:1874, upsertPlaidAccountsForItemInternal:1947)`, `apps/web/src/components/openbooks/settings/connections/AddBankSheet.tsx`, `apps/web/src/components/openbooks/settings/connections/shared.tsx (BusinessSelect — reuse)`

**Definition of done**

- [ ] Linking a Plaid item with 2 accounts and assigning each to a different entity creates two bankAccounts under two distinct entityIds, each with its own ledgerAccount (asserted in a convex-test).
- [ ] Assigning all accounts to one business reproduces today's behavior exactly (back-compat test).
- [ ] Every previewed account is either assigned or excluded — none are silently dropped.
- [ ] Authorization: assigning an account to an entity in a different workspace is rejected.
- [ ] AddBankSheet shows a per-account business picker after Link success.

**Deliverables:** updated plaid.ts split logic; updated AddBankSheet.tsx; convex test in convex/plaid.test.ts covering 2-entity split + back-compat + authz

**Verify.** pnpm test:unit -- plaid; tests/e2e/plaid-link.spec.ts updated to assert the per-account business assignment UI; manual sandbox link mapping 2 accounts to 2 businesses.

### E3-T6 — Stripe: require + verify the webhook before a connection reports 'listening'
`size: M` · `risk: med` · `depends on: —`

**Intent.** Close the false-green webhook status and make the webhook a **hard prerequisite** for a live Stripe connection: today upsertConnectionCredential:845 sets webhookStatus 'listening' the moment any whsec_ string is saved, with no proof a real delivery verifies. A live Stripe connection must register + verify its webhook before it reports 'listening' so payouts/refunds/disputes reconcile in real time (decided: see decisions.md Q15; Stripe's docs say polling is "much less reliable").

**Changes**

- **Webhook is REQUIRED for any live Stripe connection** (decided: see decisions.md Q15) — connecting Stripe = registering + verifying the webhook endpoint. Subscribe to (min) the event set: `payout.paid`, `payout.failed`, `payout.canceled`, `payout.reconciliation_completed`, `charge.succeeded`/`payment_intent.succeeded`, `charge.refunded`, `charge.dispute.created`/`closed`, `balance.available`.
- When a Stripe credential is saved with a webhook secret, set the connection/stripeAccount webhookStatus to a new 'pending_verification' state instead of 'listening' (extend the webhookStatus union in schema.ts:723/751 if needed via the migration-helper skill, additively). Verify the `Stripe-Signature` header and store `whsec_…` in the **unified `credentials` table** (E3-T1), not a one-off field. **Dedupe by `event.id`.**
- Flip webhookStatus to 'listening' only when a real signed delivery is verified by verifyStripeWebhookCredential (connections.ts:986) in stripeWebhook handling, OR via an explicit 'Send test event / verify' action the owner triggers; set 'failing' when a delivery arrives but signature verification fails for that account.
- **Do NOT itemize a payout before `payout.reconciliation_completed`** (that event gates per-payout itemization). Keep polling as **backfill + nightly safety sweep only**.
- Add a verifyStripeWebhook action that the UI can call to confirm setup (and update lastValidatedAt).
- In StripeConnectSheet.tsx, make the webhook secret a **required** field with copyable webhook URL (WebhookField already exists) and explain that until verified the connection does not report 'listening'.
- Surface the pending/failing/listening state visibly in ConnectionsSection.tsx (humanizeWebhookStatus already maps statuses — extend for the new state).

**Files:** `convex/connections.ts (upsertConnectionCredential:845, verifyStripeWebhookCredential:986; add verifyStripeWebhook action)`, `convex/stripeWebhook.ts (mark webhookStatus on real verified delivery)`, `convex/schema.ts (webhookStatus unions ~723/751, additive)`, `apps/web/src/components/openbooks/settings/connections/StripeConnectSheet.tsx`, `apps/web/src/components/openbooks/settings/connections/shared.tsx (humanizeWebhookStatus)`, `apps/web/src/components/openbooks/settings/ConnectionsSection.tsx (status pill)`

**Definition of done**

- [ ] Saving a Stripe key + webhook secret sets webhookStatus to 'pending_verification', NOT 'listening'.
- [ ] A verified signed delivery (or the explicit verify action) flips it to 'listening' and stamps lastValidatedAt.
- [ ] A delivery whose signature fails sets 'failing'; the UI shows the distinct state.
- [ ] Schema change is additive (existing rows still validate) — verified by build + the migration-helper widen check.
- [ ] UI clearly tells the owner what 'pending' means and shows the copyable webhook URL.

**Deliverables:** updated connections.ts/stripeWebhook.ts/schema.ts; updated StripeConnectSheet + status pills; unit test for pending→listening→failing transitions

**Verify.** pnpm test:unit -- connections stripe; tests/e2e/stripe.spec.ts asserts pending_verification on save; simulate a signed webhook in stripeWebhook.test.ts and assert listening.

### E3-T7 — Plunk: in-UI BYO key entry + validate + prefer saved key over env
`size: M` · `risk: low` · `depends on: —`

**Intent.** Give Plunk the same BYO treatment as the other providers so the owner can configure email (weekly CFO digests, team invites, password reset) without editing Convex env — encrypted at rest, validated, last4 only. **Workspace-scoped** (decided: see decisions.md Q14).

**Changes**

- Store Plunk in the **single unified `credentials` table** (`kind:"plunk"`, workspace-scoped) — NOT its own table and NOT env-only (decided: see decisions.md Q14). The `fromEmail`/`fromName` are non-secret payload fields; the secret key goes in `encryptedPayload`.
- Add savePlunkCredential (admin, requires secret vault) that calls saveCredential({kind:"plunk"}) from E3-T1 (encrypts via secretBox), stores fromEmail/fromName as non-secret payload, and validates by calling the Plunk API (packages/email/src/plunk.ts client; a lightweight auth probe) — store status active/invalid + lastValidatedAt.
- Add deletePlunkCredential and a plunkStatus query (thin wrapper over credentialStatus filtered to `kind:"plunk"`) returning {configured, lastFour, fromEmail, fromName, verified, lastValidatedAt} with NO ciphertext.
- Update the email senders (packages/email/src/plunk.ts sendPlunkEmail and convex/auth.ts:53 / requestAccess.ts:91) to prefer a resolved saved BYO key (decrypted server-side) and fall back to process.env.PLUNK_SECRET_KEY — without breaking the existing env-only deployments.
- Add a Plunk card to the Connections/AI settings surface with key entry, from-email/from-name, 'Verify', and a guide link.
- Reflect emailDeliveryConfigured (settings.ts:50 / team.ts:88) from the saved credential too.

**Files:** `convex/credentials.ts (unified table from E3-T1 — `kind:"plunk"`, no separate table)`, `convex/plunk.ts (new: savePlunkCredential/deletePlunkCredential/plunkStatus + internal resolve via getActiveCredential)`, `packages/email/src/plunk.ts (sendPlunkEmail key resolution)`, `convex/auth.ts (PLUNK_SECRET_KEY:53), convex/requestAccess.ts (:91), convex/settings.ts (:50), convex/team.ts (:88)`, `apps/web settings UI (new PlunkSection or card in ConnectionsSection.tsx)`

**Definition of done**

- [ ] Saving a Plunk key writes ciphertext only; plunkStatus returns last4 + verified, never the key.
- [ ] Verify calls Plunk and reports success/failure; invalid keys are flagged, not silently accepted.
- [ ] Email senders use the saved key when present and still work from env when no row exists (back-compat test).
- [ ] emailDeliveryConfigured reflects either source.
- [ ] Plunk is stored in the unified `credentials` table (`kind:"plunk"`), not a separate table; schema is additive (build green).

**Deliverables:** convex/plunk.ts + schema table; updated senders; PlunkSection UI; unit test for encrypt-at-rest + env fallback + verify

**Verify.** pnpm test:unit -- plunk; manual: save a Plunk key, send a test invite, confirm delivery uses the saved key; assert plunkStatus omits secrets.

### E3-T8 — Per-connection health/validate/re-link across all providers + connectionsHealth query
`size: M` · `risk: low` · `depends on: E3-T1, E3-T3, E3-T6, E3-T7`

**Intent.** Give every connection (AI, Plaid, Stripe, Plunk) a uniform, server-derived status (active / needs attention / re-link required / not configured) plus a validate and a re-link/rotate action, so the owner can self-diagnose a broken integration.

**Changes**

- Add a connections.health query (or extend connections.list:276) that returns, per provider+entity, a normalized {status, detail, lastValidatedAt, action:'validate'|'relink'|'configure'|null} computed server-side from the unified `credentials` row status/lastValidatedAt (all four kinds), plaidItems.status (relink_required), stripeAccounts.webhookStatus, and the `kind:"ai"`/`kind:"plunk"` rows via credentialStatus.
- Add validate actions that re-probe each provider: Plaid (reuse plaid.testWorkspacePlaidApp), Stripe (re-call /account with the stored key, update lastValidatedAt/status), AI (testProviderConnection from T3), Plunk (T7 verify) — each updates the stored status row.
- Add a re-link affordance: Plaid relink_required → open AddBankSheet/Link update mode; Stripe invalid key → StripeConnectSheet 'Update key' (already exists); AI/Plunk invalid → re-open the key form.
- Ensure no validate action returns secrets; all only return status + redacted detail.

**Files:** `convex/connections.ts (list:276; add health query + validate actions)`, `convex/plaid.ts (testWorkspacePlaidApp — reuse)`, `convex/credentials.ts (credentialStatus) / convex/plunk.ts (status from T1/T7)`, `apps/web/src/components/openbooks/settings/ConnectionsSection.tsx`, `apps/web/src/components/openbooks/settings/connections/shared.tsx (status helpers)`

**Definition of done**

- [ ] connections.health returns a normalized status for each AI/Plaid/Stripe/Plunk connection sourced from the server, not optimistic client state.
- [ ] Each connection exposes a working 'Validate' that re-probes and updates lastValidatedAt/status; a broken one shows 'needs attention' with the right re-link/rotate CTA.
- [ ] Plaid relink_required surfaces a re-link CTA; Stripe invalid surfaces 'Update key'.
- [ ] No validate response includes any secret (asserted).

**Deliverables:** connections.health query + validate actions; UI status row + CTAs; unit test for status normalization + validate updates lastValidatedAt

**Verify.** pnpm test:unit -- connections; tests/e2e/settings.spec.ts asserts each provider row shows a status pill + validate button; manual: invalidate a key and confirm 'needs attention'.

### E3-T9 — Redesign the Connections settings surface: responsive, grouped-by-business, guide links, copyable URLs
`size: M` · `risk: low` · `depends on: E3-T4, E3-T8`

**Intent.** Deliver the owner-reported 'Connections section is broken/missing options' fix: one clean, responsive control panel that presents AI, Plaid, Stripe, and Plunk consistently, groups accounts under the business they belong to, and shows the copyable redirect/webhook URLs and guide links.

**Changes**

- Recompose ConnectionsSection.tsx into a consistent set of ProviderCard rows (AI, Banks/Plaid, Stripe, Email/Plunk) each with: status pill (from T8 health), primary action, settings/validate action, and a help link to the provider's setup guide.
- Keep the 'Connected accounts grouped by business' block (already present) and ensure the AI + Plunk cards sit alongside Plaid/Stripe so the page reads as 'all your keys in one place'.
- Surface the copyable redirect + webhook URLs prominently (webhookConfig already exposes stripeWebhookUrl/plaidWebhookUrl/plaidRedirectUri/stripeRedirectUri — reuse WebhookField).
- Responsive: verify no horizontal overflow at 360px; cards stack to one column; the by-business grouping wraps cleanly on mobile (per AGENTS.md 'mobile must be a real responsive product surface').
- Match the design system (white surfaces, Geist, lucide, single brand green; no gradients/emoji/glassmorphism per Design Rules).
- Add an empty/first-run state that points to onboarding when nothing is configured.

**Files:** `apps/web/src/components/openbooks/settings/ConnectionsSection.tsx`, `apps/web/src/components/openbooks/settings/connections/shared.tsx`, `apps/web/src/components/openbooks/settings/AiSection.tsx (if AI card is hoisted here)`, `convex/connections.ts (webhookConfig:414 — reuse), convex/connections.ts (health from T8)`

**Definition of done**

- [ ] AI, Plaid, Stripe, and Plunk all appear as consistent cards with status + actions + guide links on one Connections surface.
- [ ] No horizontal scroll at 360px width; cards are single-column on mobile (verified by a 360px screenshot).
- [ ] Copyable redirect + webhook URLs are visible for Plaid and Stripe.
- [ ] Design-system compliant (no gradients, emoji, purple AI styling, glassmorphism); uses shadcn primitives.
- [ ] Empty state links to onboarding/setup.

**Deliverables:** redesigned ConnectionsSection.tsx; 360px + desktop screenshots; Playwright assertions for the four provider cards and responsiveness

**Verify.** pnpm typecheck && pnpm lint && pnpm build; tests/e2e/settings.spec.ts asserts four provider cards + copyable URLs; capture a 360px screenshot via the agent-browser skill and attach.

### E3-T10 — Secret-safety audit + redaction tests across all integration queries and errors
`size: S` · `risk: low` · `depends on: E3-T1, E3-T6, E3-T7, E3-T8`

**Intent.** Prove the rule 'never return secrets to the client and never log them' holds across the whole expanded integration surface (AI/Plaid/Stripe/Plunk), since this epic introduces several new secret-handling paths.

**Changes**

- Audit every public query/action return shape touched by this epic (connections.list/health/webhookConfig, credentialStatus, plunkStatus, providerStatus, all save/validate actions) and assert none expose *Ciphertext, `encryptedPayload`, raw apiKey, restrictedKey, clientId+secret pair, webhook secrets, or Plunk key.
- Add a redaction guard so thrown ConvexErrors and audit summaries never embed a raw secret (extend the redactEnvValues approach in aiSdkRuntime.ts:24 into a shared helper used by the new actions).
- Add a repo grep gate / unit test that fails if any connections/ai/plunk query return type includes a ciphertext field name.
- Document the secret-flow (where each secret is encrypted, where decrypted, never returned) in a short section of docs/finishing (no secret values).

**Files:** `convex/connections.ts`, `convex/aiCredentials.ts`, `convex/plunk.ts`, `convex/aiSdkRuntime.ts (redactEnvValues:24 → shared helper)`, `new convex/secretSafety.test.ts`, `docs/finishing (short secret-flow note)`

**Definition of done**

- [ ] A test enumerates the return objects of all integration status/list queries and asserts no secret/ciphertext field is present.
- [ ] A test asserts thrown errors from each save/validate action with a wrong key do not contain the key substring.
- [ ] The grep/test gate fails on any future query that returns a ciphertext field.
- [ ] Doc note describes the encrypt→store→decrypt-server-only→never-return flow.

**Deliverables:** convex/secretSafety.test.ts; shared redaction helper; secret-flow doc note

**Verify.** pnpm test:unit -- secretSafety connections credentials plunk; grep -rE "Ciphertext|encryptedPayload|restrictedKey|apiKey" on query return shapes shows none surfaced; security-review skill on the diff.

### E3-T11 — Make live connectors work locally: remove the sandbox/test-only gate, keep encryption-at-rest
`size: S` · `risk: med` · `depends on: —`

**Intent.** Ansar runs his real books on this, so live Plaid/Stripe keys must work locally (decided: see decisions.md Q16, Global rule 4). Remove the sandbox/test-only restriction and neutralize the `OPENBOOKS_REAL_TEST_LIVE_CONNECTORS` gate, while KEEPING encryption-at-rest and the live-key HTTPS-redirect requirement.

**Changes**

- Delete the AGENTS.md "only Plaid sandbox / Stripe test-mode keys may be used" rule (`AGENTS.md:82-83`) and the reinforcing lines.
- Default the `OPENBOOKS_REAL_TEST_LIVE_CONNECTORS` gate **open** (or remove the gate entirely) across `convex/connections.ts`, `convex/plaid.ts`, `convex/stripe.ts`, `convex/stripeWebhook.ts`.
- **KEEP** the encryption-at-rest requirement (`plaid.ts:341`) and the live-key HTTPS-redirect requirement (`connections.ts:248`) — unchanged.
- Verification may use live OR test keys (no enforced mode).

**Files:** `AGENTS.md (delete lines 82-83 + reinforcing)`, `convex/connections.ts`, `convex/plaid.ts (KEEP :341 encryption)`, `convex/stripe.ts`, `convex/stripeWebhook.ts`

**Definition of done**

- [ ] The AGENTS.md sandbox/test-only rule is gone; no code path refuses a live key purely because it is live.
- [ ] `OPENBOOKS_REAL_TEST_LIVE_CONNECTORS` no longer blocks live connectors (defaulted open or removed) across the four files.
- [ ] Encryption-at-rest (`plaid.ts:341`) and the live-key HTTPS-redirect requirement (`connections.ts:248`) still hold (asserted).
- [ ] Build/lint/typecheck green.

**Deliverables:** updated AGENTS.md + the four convex files; a test asserting a live-shaped key is accepted and still encrypted at rest

**Verify.** pnpm typecheck && pnpm lint && pnpm build; grep confirms the gate no longer hard-blocks; manual: a live-mode key saves and encrypts.

## Decisions applied

This epic's open questions are resolved by `../decisions.md` (canonical) and `../plan-rebuild-changelog.md`. Applied here:

- **Q12** — `aiCatalog.ts` (14 providers) is canonical; widen the `setConfig`/`aiProviderIdValidator` from 5 to 14, additive (E3-T2).
- **Q13** — AI keys workspace-scoped; Stripe per-business; Plunk + Plaid Item workspace-scoped, account→entity mapping on account rows (epic header, E3-T1, E3-T5).
- **Q14** — Plunk lives in the single unified `credentials` table (`kind:"plunk"`), workspace-scoped, not its own table, not env-only (E3-T7).
- **Q15** — Stripe webhook is REQUIRED + verified before 'listening'; min event set; dedupe by `event.id`; no payout itemization before `payout.reconciliation_completed`; polling = backfill/nightly sweep only (E3-T6).
- **Q16 / Global rule 4** — live connectors must work locally; delete the AGENTS.md sandbox/test-only rule and neutralize the gate; keep encryption-at-rest (E3-T11).
- **Q17** — Plaid Item workspace-anchored; per-account→entity mapping on account rows (E3-T5).
- **Q18 / Global rule 5** — ONE unified `credentials` table for all secrets (collapse dead `aiCredentials` + `connectionCredentials` blob); fixed KDF (E3-T1).

**Still genuinely needs Ansar:** none for E3. (The light asks remaining in the sprint — Q68 self-host skill distribution, Q75 CI workflow, Q80/Q85/Q86 — belong to E13/E14/E15, not this epic.)
