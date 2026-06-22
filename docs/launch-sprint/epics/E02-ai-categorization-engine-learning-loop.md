# E2 — AI categorization engine & learning loop

> Part of the **OpenBooks Launch Sprint**. Master plan: [../README.md](../README.md) · Backlog: [../backlog.md](../backlog.md)

**Goal.** Turn categorization from a Bedrock-only, degrade-to-Inbox stub into a provider-agnostic, self-draining, learning cascade that posts the confident majority of real transactions, abstains honestly on the tail, and gets deterministically smarter on every correction — so the ~78-80% of money currently stuck unposted in the Inbox flows into the ledger and the reports stop being starved.

**Why it matters.** Reports read only posted journal lines. On real data the categorizer is effectively off (it hard-requires AWS Bedrock env at bedrockCategorizer.ts:150; any other of the 14 BYO providers returns mode:'degraded' and routes everything to needs_review with entryId:null at pipeline.ts:454,572). The result is Zikra showing $120k income but $3,410 of expenses because real vendor spend never posts. Even where the LLM could fire, the batch is capped at min(25) with no self-reschedule, so 2,700 items never drain. The semantic-memory vector table is dead, calibration is dormant, candidates are direction-locked (refunds become revenue), and stage attribution is corrupted. This epic is the upstream fix for RC1/RC9/RC10 in docs/finishing/accounting-engine-blueprint.md — without it, every downstream report, dashboard tile, and Ask AI answer is computed on a fraction of the books.

## Current state

BYO-key infrastructure already exists but is 100% dead code: convex/aiProvider.ts exposes buildModelForProvider/decryptCredentialRow/resolveCredentialFromEnv/credentialIsComplete and convex/aiCatalog.ts lists all 14 providers, but they have ZERO non-test callers and the aiCredentials table (schema.ts:326) is NEVER written (no insert/patch anywhere). The categorizer (convex/bedrockCategorizer.ts) is Bedrock-only: bedrockRuntimeEnv (line 150) requires AI_PROVIDER=bedrock + AWS keys, and both categorize paths bail to 'degraded' when context.provider.activeProvider !== 'bedrock' (lines 568-572, 669-672). It uses the legacy env-only registry (convex/aiProviderRegistry.ts, surfaced via ai.ts:bedrockEnvironmentStatus) where only bedrock can be 'active'. The settings UI renders a DISABLED provider dropdown and a read-only 'set in Convex env' key field (AiSection.tsx:104-122). Batch candidates are .take(500) then capped min(25, limit) with no rescheduling (ai.ts:696,700); plaid import triggers limit:min(25, needsReviewCount) once (plaid.ts:1298-1303); CSV import calls limit:min(25,...) once (CoreScreens.tsx:1867). The cascade in pipeline.ts (routeTransactionCore, ~656) runs transfer -> match -> rule -> exact-string correction-memory (findCorrectionMemory at 277, plain merchantKey equality) -> plaidPriorAccountId -> aiProposal -> Inbox. aiMemoryEmbeddings (schema.ts:358-379, a 1024-dim vector index) is never written or queried and NO text-embedding generator exists anywhere in convex/. getEntityCalibration returns IDENTITY_CALIBRATION when no aiCalibrations row exists (pipeline.ts:241), and fitWorkspaceCalibration (ai.ts:983) + runHoldoutCategorizationEval (ai.ts:1088) have no production caller, so the 0.90/0.75 gates compare raw confidence. buildCategorizationContext returns ONLY income accounts for inflows / ONLY expense for outflows (ai.ts:290,313-321). routeProposedCategory returns hardcoded stage:'rule' on auto-post (pipeline.ts:435). Live Plaid first-pass route omits aiProposal and plaidPriorAccountId (plaid.ts:817-849); plaidPriorAccountId is wired through pipeline (auto-posts at 0.7, line 818-834) but never populated. The categorizer prompt (buildCategorizationPrompt, bedrockCategorizer.ts:441) gets no business context. contactId is accepted by routeTransaction args and stored on the transaction row (pipeline.ts:693) but never carried onto the AI proposal/journal line.

## Definition of done (epic)

- [ ] With NO AWS Bedrock env present and a single saved BYO key (e.g. Anthropic or OpenAI in the unified `credentials` table owned by E3), a needs_review transaction is categorized by the LLM and posts when confidence clears the gate — proven by an integration test that stubs the model via buildModelForProvider and asserts route.status==='posted' with decidedBy==='ai' and a non-null entryId, and that the SAME input with provider mode degraded routes to needs_review.
- [ ] A self-rescheduling backlog job categorizes an entire needs_review history of >25 items to completion (or a bounded max passes) with no item left unattempted solely because of the 25-cap — proven by a test seeding 60 needs_review rows and asserting every row is either posted or has an AI proposal recorded after the job chain drains.
- [ ] Re-running the same merchant after a human correction resolves WITHOUT any LLM call: an exact correction-memory write on confirm/recategorize makes the next identical merchant deterministic, and an embedding/k-NN recall makes a merchant VARIANT ('AMZN WEB SERVICES' vs 'AWS') resolve to the same category — both proven by tests.
- [ ] stage/decidedBy attribution is truthful end-to-end: an auto-posted memory decision reports stage 'memory' (not 'rule'), an embedding recall reports 'embedding', an LLM decision reports 'ai' — asserted in pipeline tests on the returned RouteResult and the persisted transaction.decidedBy.
- [ ] Inflows can resolve to non-income accounts (refund-to-expense-contra, owner contribution to equity, transfer, liability draw) and outflows to non-expense accounts where appropriate — candidate set is no longer hard-locked by sign; proven by a test where a refund inflow is offered an expense/contra candidate.
- [ ] Every LLM-returned category id is validated to exist on the entity before any posting attempt; an LLM hallucinating an id results in a safe Inbox abstention, never a throw or a mispost — proven by a test feeding a bogus id.
- [ ] A holdout eval runs in production mode, fits a calibration from its own (confidence,correct) pairs, persists it to aiCalibrations, and the auto-post gate then compares the CALIBRATED probability; coverage and precision are reported as SEPARATE numbers; abstention counts as neither a precision hit nor miss.
- [ ] The Inbox surfaces Top-N AI suggestions and a provenance line ('Matched your rule' / 'Same as your last 6 AWS charges' / 'AI 0.82 - review') for every decided item.
- [ ] All Convex unit/integration tests, typecheck, and lint pass (pnpm -w turbo run typecheck lint test or the repo's gate command); no change to convex/ledger.ts posting math or the debits==credits invariant.

## Tickets (11)

### E2-T1 — Consume the unified credential resolver for the AI provider (close RC9 at the runtime)
`size: M` · `risk: med` · `depends on: E3-T1, E3-T2`

**Intent.** E2 does NOT own credential storage. The single unified `credentials` table (one `encryptedPayload` JSON blob + `fingerprint` + `keyPreview` + `status`, `kind:"ai"`, workspace-scoped, fixed KDF) and the provider-agnostic resolver are owned and built by **E3-T1/E3-T2** (decided: see decisions.md Q11/Q12/Q18). The dead per-field `aiCredentials` table is being collapsed into that unified store by E3 — do NOT extend or write to it here. E2's job is to **consume** E3's resolver so the categorizer picks the active (providerId, modelId, credential) for a workspace, preferring a saved credential and falling back to env. This is the foundation every other provider-agnostic ticket depends on.

**Changes**

- Consume E3's internal resolver (E3-T2) `resolveActiveProvider(ctx, workspaceId)` returning {providerId, modelId, credential, mode:'active'|'degraded', degradedReason}: it reads aiConfigs.provider + categorizeModel, loads the matching unified `credentials` row (`kind:"ai"`), decrypts via secretBox, else resolveCredentialFromEnv(providerId); mode='active' only when credentialIsComplete(providerId, credential). If E3-T2 has not yet landed the resolver when E2 build starts, stub the seam against E3's signature and wire the real import on merge — do not fork a parallel store.
- The `setConfig` arg-validator widening to all 14 catalog providers (currently a 5-literal union at ai.ts:31-37) is owned by **E3-T2** (decided: see decisions.md Q12); E2 only relies on it accepting the saved provider + a categorizeModel override so a saved provider sticks.

**Files:** `convex/ai.ts`, `convex/aiProvider.ts`, `convex/aiCatalog.ts` (read-only consumers of E3's resolver/store)

**Definition of done**

- [ ] The categorizer reads its provider/model/credential exclusively through E3's `resolveActiveProvider`; no E2 file writes to or reads the legacy per-field `aiCredentials` table (which E3 collapses into the unified store).
- [ ] With a complete BYO credential saved (via E3) and NO env fallback, the categorizer sees mode:'active'; with none saved and no complete env fallback it sees mode:'degraded' with a clear reason — both covered by a unit test that drives the seam.
- [ ] E2 carries no credential-encryption code (KDF, secretBox calls, ciphertext columns) — that surface lives entirely in E3.

**Deliverables:** Categorizer wired to E3's `resolveActiveProvider`; a thin test seam over the resolver; resolver-consumption test covering active/degraded

**Verify.** Add a unit test that injects a fake `resolveActiveProvider` (active vs degraded) and asserts the categorizer branches correctly. Round-trip encryption + secret-redaction tests live in E3, not here. Run the repo Convex test command and typecheck.

### E2-T2 — Provider-agnostic categorizer runtime on the AI SDK factory
`size: L` · `risk: med` · `depends on: E2-T1`

**Intent.** Replace the Bedrock-only categorize action with one that builds the model through aiProvider.buildModelForProvider using the E2-T1 resolver, so categorization works for any of the 14 providers (not just Bedrock). Keep the deterministic-stage fallback when degraded. This is the direct fix for the 'degraded -> everything to Inbox' root cause.

**Changes**

- Add convex/categorizer.ts (a 'use node' action module) with `categorizeAndRouteTransaction` and `categorizePendingTransactions`/...ForImportInternal that mirror the existing bedrockCategorizer signatures but resolve the model via resolveActiveProvider + buildModelForProvider and call generateText (reuse buildCategorizationPrompt + parseBedrockCategorizationText + normalizeBedrockCategorizationProposal, which are already model-agnostic JSON parsers).
- Gate behavior: when resolveActiveProvider returns degraded, route through the deterministic pipeline stages with aiProposal=null (same as today's routeWithoutModel), preserving the honest 'degraded' BatchItemResult.mode.
- Repoint plaid.ts:239-243 ref, CoreScreens.tsx:1653, ModuleScreens.tsx:2062, and ai.ts:58-91 categorizeAndRouteTransactionRef to the new module; leave bedrockCategorizer.ts in place only if still referenced by receipts.ts (vision) — do not break receipt extraction.
- **Migrate all three LLM runtimes onto the factory in this sprint** (decided: see decisions.md Q11) — not just the categorizer. V1 confirms the categorizer (agent.ts), the Ask-AI chat runtime (aiChatRuntime.ts), and the test-connection runtime (aiSdkRuntime.ts) ALL still hardcode Bedrock-from-env via the legacy registry (aiProviderRegistry.ts). Repoint chat + test-connection to E3's resolver + buildModelForProvider too, so there is one source of truth and the disabled-provider bug cannot persist in chat. (Chat surface UI stays with its own epic; only the runtime resolution moves here.)
- Preserve the BatchItemResult/RouteResult shapes so callers and tests need no shape changes.

**Files:** `convex/categorizer.ts (new)`, `convex/bedrockCategorizer.ts`, `convex/plaid.ts`, `convex/ai.ts`, `apps/web/src/components/openbooks/CoreScreens.tsx`, `apps/web/src/components/openbooks/ModuleScreens.tsx`

**Definition of done**

- [ ] With a saved Anthropic/OpenAI credential and NO AWS env, categorizeAndRouteTransaction produces an LLM proposal and (above gate) posts — asserted with a stubbed/mocked model in an integration test.
- [ ] With no provider configured, the same call returns mode:'degraded' and routes deterministically (no throw), matching today's degraded contract.
- [ ] receipts.ts vision extraction is unchanged and its tests still pass (no regression to the Bedrock vision path).
- [ ] All existing ai.test.ts categorizer expectations still pass against the repointed refs.

**Deliverables:** categorizer.ts provider-agnostic action module; Updated function references across plaid.ts/ai.ts/CoreScreens/ModuleScreens; categorizer.test.ts proving active (BYO) and degraded paths

**Verify.** convex/categorizer.test.ts: inject a fake model via a thin seam over buildModelForProvider returning canned JSON; assert posted with decidedBy='ai'; second case with no credential asserts degraded+needs_review. Run full Convex test suite + typecheck + lint.

### E2-T3 — Self-rescheduling backlog drainer (kill the 25-item cap)
`size: M` · `risk: low` · `depends on: E2-T2`

**Intent.** Make the backlog actually drain. Today ai.categorizationBatchCandidates caps at min(25) and nothing reschedules, so 2,700 items never clear. Add a job that processes a bounded batch then re-enqueues itself until the needs_review queue for the entity is empty or a max-pass ceiling is hit.

**Changes**

- Add an internal action `drainCategorizationBacklog(entityId, actorUserId?, pass?, maxPasses?)` that runs one runCategorizationBatch, and if candidates remain AND pass < maxPasses, ctx.scheduler.runAfter(short delay) itself with pass+1 (delay protects the BYO API rate limit and Convex action limits).
- Add a public `startCategorizationBacklog(entityId)` mutation (requireWorkspaceRole admin) that enqueues pass 0, returning a jobId/handle for the UI to poll via latestCategorizationBatchRuns.
- Point the plaid import trigger (plaid.ts:1298-1303) and the CSV/import buttons (CoreScreens.tsx:1867, ModuleScreens.tsx:2137) at the drainer instead of a single min(25) call; keep per-pass batch size sane (e.g. 25) but remove the overall cap.
- Raise the candidate scan so a large backlog is visible across passes (ai.ts:700 .take(500)) — order/paginate so later passes see un-attempted rows, e.g. exclude rows that already carry an AI proposal/decidedBy='ai' from the same run window.

**Files:** `convex/categorizer.ts`, `convex/ai.ts`, `convex/plaid.ts`, `apps/web/src/components/openbooks/CoreScreens.tsx`, `apps/web/src/components/openbooks/ModuleScreens.tsx`

**Definition of done**

- [ ] Seeding 60 needs_review rows and running the drainer to completion leaves 0 rows un-attempted: every row is posted or has decidedBy in {ai, plaid_prior, memory, embedding} or remains needs_review WITH a recorded AI proposal — none skipped solely because of the 25-cap (asserted by counting attempted across the pass chain).
- [ ] The drainer terminates (respects maxPasses) and never loops forever on rows the LLM keeps abstaining on.
- [ ] aiBatchRuns rows are written per pass so the UI can show progress.

**Deliverables:** drainCategorizationBacklog internal action + startCategorizationBacklog mutation; Rewired import/CSV triggers; Test draining a >25 backlog to completion with a stubbed model

**Verify.** convex/categorizer.test.ts (or backlogDrainer.test.ts): seed 60 needs_review rows, stub model to alternate post/abstain, run the drainer pass-chain by manually invoking scheduled passes, assert attemptedCount summed == 60 and no row left with decidedBy undefined+no proposal. Typecheck + test.

### E2-T4 — Embedding generator + write semantic memory on every correction
`size: L` · `risk: med` · `depends on: E2-T1`

**Intent.** Bring the dead aiMemoryEmbeddings vector table to life. Today no embedding is ever generated anywhere in convex/. On every human correction we already write aiCorrectionMemories (pipeline.ts:575 recordCorrectionMemory); also embed the merchant/description and store a 1024-dim vector so merchant VARIANCE can be recalled later (E2-T5). Embeddings use the AI SDK embed API.

**Pinned embedding policy (decided: see decisions.md Q7).** Pin **ONE embedding model at 1024 dims, DECOUPLED from the user's chat/categorization provider.** Use a 1024-dim model — Bedrock Titan v2 @1024, or `text-embedding-3-small/large` with the `dimensions:1024` Matryoshka parameter. **Never mix embedding models in the index — this is a one-way door** (vectors from different models are not comparable). The 14-provider freedom applies to chat/categorization generation, NOT to embeddings. Do NOT pad/truncate/project ad hoc and do NOT add a second vector index now. If no embedding-capable key exists, **degrade to lexical / merchantKey memory** (exact-string correction memory) — the system stays correct, just without variant recall.

**Changes**

- Add a provider-agnostic embedding action `embedText(workspaceId, text)` in a 'use node' module that resolves the **single pinned 1024-dim embedding model** (independent of the chat provider; via E3's credential resolver where the chosen embedding provider's key lives). It always emits exactly 1024 dims natively (Titan v2 @1024 or `dimensions:1024`) to match schema.ts:375-378 — no ad-hoc padding/truncation/projection.
- In the correction path (pipeline.recordCorrectionMemory at pipeline.ts:575, called from confirmTransaction:957 and recategorizeTransaction:1097), after upserting aiCorrectionMemories, schedule an internal action to compute the embedding and upsert an aiMemoryEmbeddings row (by_memory index) with sourceText, embeddingModel, occurrenceCount, status mirrored from the memory.
- Handle the degraded case: if no embedding-capable credential is available, **skip the embedding write and rely on exact/lexical merchantKey memory** — never block the correction.

**Files:** `convex/embeddings.ts (new)`, `convex/aiProvider.ts`, `convex/aiCatalog.ts`, `convex/pipeline.ts`, `convex/schema.ts`

**Definition of done**

- [ ] Confirming/recategorizing a transaction writes an aiMemoryEmbeddings row with a length-1024 embedding array and the correct correctionMemoryId/categoryAccountId/direction (asserted with a stubbed embedder).
- [ ] The embedding model is the single pinned 1024-dim model regardless of which chat/categorization provider is active; the stored `embeddingModel` is constant across rows (no model mixing).
- [ ] A second correction for the same merchantKey updates (not duplicates) the embedding row and bumps occurrenceCount.
- [ ] When no embedding-capable credential is configured, the correction still succeeds, falls back to lexical/merchantKey memory, and no embedding row is written (no throw).

**Deliverables:** embedText action + per-provider embedding model resolution; Embedding-on-correction wiring in pipeline.ts; embeddings.test.ts asserting the write + degraded skip

**Verify.** convex/embeddings.test.ts: stub the embedder to return a fixed 1024-vector, confirm a transaction, assert exactly one aiMemoryEmbeddings row exists with that vector and matching ids; second confirm updates in place. Typecheck + test.

### E2-T5 — Insert embedding/k-NN recall as a cascade stage before the LLM
`size: L` · `risk: med` · `depends on: E2-T2, E2-T4`

**Intent.** Add the missing recall stage so 'AWS' matches 'AMZN WEB SERVICES' deterministically and cheaply, short-circuiting before the LLM. Today the cascade jumps straight from exact-string memory (pipeline.ts:794) to plaid_prior to LLM. Insert a vector recall over aiMemoryEmbeddings between exact-memory and plaid_prior.

**Changes**

- Add an internal action that embeds the incoming merchant/description and runs ctx.vectorSearch('aiMemoryEmbeddings','by_embedding', {vector, filter entityId, limit k}) returning the top match + cosine score; map a high-score match to a category proposal with provenance 'Same as your last N {merchant} charges'.
- Because vectorSearch is action-only, run recall in the categorizer action (E2-T2) BEFORE the LLM call: if recall clears a similarity threshold, route a proposal with stage:'embedding' and a confidence derived from similarity*occurrence (never exceeding the exact-memory confidence band); if not, fall through to plaid_prior/LLM.
- Thread a new stage literal 'embedding' through routeProposedCategory/routeExistingProposedCategory (pipeline.ts:392,509) and the transactions.decidedBy union (schema.ts:441-451) — additive widening only.
- Pick the similarity threshold conservatively and document it; below threshold = abstain to the next stage, not a guess.

**Files:** `convex/categorizer.ts`, `convex/embeddings.ts`, `convex/pipeline.ts`, `convex/schema.ts`

**Definition of done**

- [ ] Given a stored memory for 'AMZN WEB SERVICES' -> Cloud, a new transaction merchant 'AWS' (variant, no exact-key match) is recalled and proposed to the SAME category via stage 'embedding' — asserted with a stubbed embedder returning near-identical vectors.
- [ ] A merchant with no similar memory above threshold falls through to the LLM/plaid_prior stage (no false recall) — asserted.
- [ ] decidedBy:'embedding' persists on the transaction and is returned in the RouteResult.stage.

**Deliverables:** Vector-recall stage in the categorizer action; 'embedding' stage plumbed through pipeline + schema; Test proving variant recall + below-threshold fall-through

**Verify.** convex/categorizer.test.ts: seed an aiMemoryEmbeddings row, stub embedder so the query vector is ~cosine 0.99 to it, route a variant-merchant txn, assert stage='embedding' and the recalled categoryAccountId; then stub a far vector and assert it falls through. Typecheck + test.

### E2-T6 — Direction-aware candidate set (stop forcing refunds into income)
`size: M` · `risk: low` · `depends on: E2-T2`

**Intent.** Fix RC10 over-statement: buildCategorizationContext (ai.ts:290,313-321) offers ONLY income accounts for inflows and ONLY expense for outflows, so refunds, loan proceeds, owner contributions, and transfers get forced into revenue. Broaden the candidate set per direction so the model/recall can choose the correct non-income/non-expense account.

**Changes**

- In buildCategorizationContext (ai.ts:267-323), replace the single accountType filter with a direction-appropriate candidate set: for inflows include income + contra-expense/refund + equity-contribution + liability-proceeds + transfer/clearing candidates; for outflows include expense + contra-income(refund) + owner-draw(but flagged) + transfer/clearing; keep candidates capped and ranked so the prompt stays small.
- Update buildCategorizationPrompt guidance (bedrockCategorizer.ts:441 / categorizer.ts) to tell the model refunds/transfers/contributions are valid answers and to prefer a transfer/clearing account over inventing revenue when the inflow looks like a payout or internal move.
- Keep the business-impact gate (calibration.ts isBlockedCategory) intact so equity/draw/tax candidates still never AUTO-post — they can be PROPOSED to the Inbox, just not auto-booked.

**Files:** `convex/ai.ts`, `convex/categorizer.ts`, `convex/bedrockCategorizer.ts`

**Definition of done**

- [ ] For an inflow, candidateAccounts now includes at least one non-income account type (e.g. an equity-contribution or contra/refund account) — asserted on the categorizationContext query output.
- [ ] A refund-style inflow can be proposed to a contra/expense-refund account rather than Sales (proven by a categorizer test with a refund-shaped input).
- [ ] Blocked categories (equity/draw/tax) appear as candidates but never auto-post (existing calibration gate test still green).

**Deliverables:** Direction-aware candidate builder; Updated prompt guidance for refunds/transfers/contributions; Test asserting non-income candidates appear for inflows

**Verify.** convex/ai.test.ts: call categorizationContext for an inflow and assert candidateAccounts contains a non-income type; categorizer.test.ts: feed a refund inflow, assert the proposed account is not forced to income. Typecheck + test.

### E2-T7 — Truthful stage attribution + validate every LLM-returned id before posting
`size: M` · `risk: high` · `depends on: E2-T2, E2-T5`

**Intent.** Two correctness fixes in the posting-adjacent pipeline (no ledger math change). (1) routeProposedCategory returns hardcoded stage:'rule' for every auto-post (pipeline.ts:435), corrupting provenance/eval; make it return the real stage. (2) Guarantee that any AI/recall-proposed categoryAccountId is asserted to exist and belong to the entity before a post is attempted, so a hallucinated id abstains to the Inbox instead of throwing or misposting.

**Changes**

- In routeProposedCategory (pipeline.ts:378-455) and routeExistingProposedCategory (pipeline.ts:500-573), return stage: args.stage (memory|plaid_prior|ai|embedding) on the posted branch instead of the literal 'rule' (pipeline.ts:435); keep needs_review branch as 'needs_review'.
- Harden assertCategoryAccount (pipeline.ts:265): on a missing/foreign/archived id from an AI or embedding proposal, DO NOT throw the whole batch — catch at the proposal boundary in the categorizer (categorizer.ts) and the routeExisting path so the item routes to needs_review with a 'proposed category no longer valid' reason; throwing is reserved for human-supplied ids in confirm/recategorize.
- Add the same existence check for E2-T5 recall ids (an embedding row could reference an archived account).
- **Encode the abstention policy explicitly (decided: see decisions.md Q9):** uncertain items stay **UNPOSTED in the Inbox** — the categorizer must NEVER auto-post a low-confidence item to an `Uncategorized` Income/Expense account to make a number look complete. Confident → post; uncertain → Inbox unposted. (Reports surface the honest "$X / N transactions unreviewed & excluded" banner; that producer field is owned by E1, this ticket only enforces the never-fabricate-a-category rule in the route.)

**Files:** `convex/pipeline.ts`, `convex/categorizer.ts`

**Definition of done**

- [ ] An auto-posted memory decision reports stage 'memory' and decidedBy 'memory' (not 'rule'); an LLM decision reports 'ai'; an embedding decision reports 'embedding' — asserted on RouteResult.stage and the persisted transaction.decidedBy.
- [ ] Feeding the categorizer a proposal whose categoryAccountId does not exist on the entity results in a needs_review route (item in Inbox) and NO journal entry and NO uncaught error — asserted by a test.
- [ ] Human confirm/recategorize with a bad id still throws a clear ConvexError (unchanged behavior).

**Deliverables:** Stage-attribution fix in both route functions; Defensive id-validation at the AI/recall proposal boundary; pipeline.test.ts cases for each stage + the bogus-id abstention

**Verify.** convex/pipeline.test.ts: drive an auto-post via a memory proposal and assert stage==='memory'; pass a fabricated Id<ledgerAccounts> as an aiProposal.categoryAccountId and assert status==='needs_review' with no entryId. Typecheck + test.

### E2-T8 — Populate the live-Plaid first pass with plaidPriorAccountId (and stop the empty first route)
`size: M` · `risk: med` · `depends on: E2-T7`

**Intent.** Fix RC10/RC1 leak on live sync: plaidPriorAccountId is fully wired through the pipeline (auto-posts at 0.7, pipeline.ts:818-834) but never populated, and the Plaid first-pass route (plaid.ts:817-849) omits both aiProposal and plaidPriorAccountId — so the first pass is a guaranteed Inbox miss that only the later batch can rescue. Derive a weak prior from Plaid's personal_finance_category and pass it on the first route.

**Changes**

- In the Plaid mapping path (where mapped.* is built before routeArgs at plaid.ts:817), map Plaid's personal_finance_category (primary/detailed) to a best-effort ledgerAccount on the entity (a small deterministic mapping table merchant-category -> account number, resolved to an id) and set routeArgs.plaidPriorAccountId when found.
- Ensure the mapping respects direction (don't map an inflow to an expense prior) and only sets a prior when the mapped account exists on the entity; otherwise leave it unset (clean fall-through to the batch LLM stage).
- Confirm the prior posts at the existing 0.7 confidence only under autopilot (gate already handles balanced/suggest) — no gate change.

**Files:** `convex/plaid.ts`

**Definition of done**

- [ ] A live-shaped Plaid transaction carrying a personal_finance_category that maps to an existing account is routed with plaidPriorAccountId set on the FIRST pass — asserted by a plaid.test.ts case inspecting the routeArgs/route result.
- [ ] Under autopilot the prior auto-posts (decidedBy 'plaid_prior'); under balanced/suggest it routes to needs_review WITH the prior recorded — asserted.
- [ ] A transaction with no mappable category (or whose mapped account is absent) routes with plaidPriorAccountId unset and reaches the LLM batch normally.

**Deliverables:** PFC->account mapping helper; plaidPriorAccountId populated on the first-pass route; plaid.test.ts coverage for mapped/unmapped + autonomy gating

**Verify.** convex/plaid.test.ts: synthesize a mapped transaction, run the sync route, assert plaidPriorAccountId set and decidedBy='plaid_prior' under autopilot; an unmapped one leaves it unset. Typecheck + test.

### E2-T9 — Feed business context into the categorizer prompt + carry contactId
`size: M` · `risk: low` · `depends on: E2-T2`

**Intent.** Lift cold-start accuracy (blueprint 4.4) by telling the model what the business does, and stop blanking customer/vendor reports by carrying contactId from the proposal onward. The prompt today (buildCategorizationPrompt, bedrockCategorizer.ts:441) has zero business context; contactId is accepted by routeTransaction but never reaches the proposal/line.

**Income-stream / business-context source (decided: see decisions.md Q8/Q49).** Both, with AI-proposes: onboarding AI **detects** income streams and known vendors from history and **proposes** them → the owner **approves** → the approved set **persists as an explicit settings field the prompt reads**. The categorizer here READS that persisted field; it does not invent its own taxonomy. **The stream-taxonomy schema/field is defined ONCE, shared with E4 (onboarding proposal/approval) and E9-T8 (digest/dashboard)** — do not define a second stream tag in E2. If the persisted field is empty (cold-start before approval), fall back to a derived top-vendor/top-customer hint.

**Changes**

- Extend buildCategorizationContext (ai.ts) to include a compact business-context block: entity name/type, the **approved revenue streams read from the shared explicit settings field** (defined with E4/E9-T8), and a short recent-vendor sample; thread it into buildCategorizationPrompt as a 'Business context' section. When the approved field is empty, derive a top-vendor/top-customer hint as the cold-start fallback.
- Carry contactId: when a proposal or memory carries a known contactId (or the categorizer can resolve a contact by merchant), pass it through routeProposedCategory so the categorizer/proposal records it on the transaction (transaction.contactId is already in schema.ts:437). NOTE: the journal-LINE contactId write is owned by another epic (ledger.ts:413) — here only ensure the proposal/transaction carries contactId so that epic has the value.
- Keep the prompt small and deterministic (temperature 0); cap the context lists.

**Files:** `convex/ai.ts`, `convex/categorizer.ts`, `convex/bedrockCategorizer.ts`, `convex/pipeline.ts`

**Definition of done**

- [ ] buildCategorizationPrompt output contains a business-context section with the entity name and at least the revenue-stream/vendor hints when present — asserted by a unit test on the pure prompt builder.
- [ ] When a transaction is routed with a contactId, the persisted transaction row retains that contactId after categorization (asserted), so the downstream line-write epic can consume it.
- [ ] No regression: prompt with empty context still produces valid JSON proposals (existing categorizer tests green).

**Deliverables:** Business-context block in context + prompt; contactId carried onto the categorized transaction; Prompt-builder unit test + pipeline contactId test

**Verify.** Unit-test buildCategorizationPrompt with sample context and assert the 'Business context' lines; pipeline.test.ts: route a txn with contactId, assert transaction.contactId persists post-categorization. Typecheck + test.

### E2-T10 — Activate calibration: fit from the holdout and gate on the calibrated probability
`size: M` · `risk: high` · `depends on: E2-T7`

**Intent.** Wake the dormant calibration loop (RC10). The math exists (calibration.ts) and getEntityCalibration already reads aiCalibrations (pipeline.ts:233-249), but fitWorkspaceCalibration (ai.ts:983) and runHoldoutCategorizationEval (ai.ts:1088) have NO production caller, so no aiCalibrations row is ever written and the gate compares raw confidence. Wire the holdout eval to fit and persist a calibration, and report coverage vs precision separately.

**Calibration scope & cadence (decided: see decisions.md Q10).** Calibration is **per-entity**, **refit on each eval run** (the eval is the natural cadence), with a **workspace-level fallback when an entity lacks enough holdout labels** (the existing >=4 mixed-outcome threshold). Two different LLCs calibrate differently; fall back when an entity's data is thin.

**Changes**

- Add a production-callable action (admin) that runs runHoldoutCategorizationEval **per entity** (each in-scope entity, not just the primary), takes the resulting (confidence, correct) pairs (summarizeHoldoutCalibration already computes them, ai.ts:1176), and calls fitWorkspaceCalibration to PERSIST the fitted params into aiCalibrations keyed by entity — so getEntityCalibration (pipeline.ts:241) returns the entity's own params on the next auto-post. When an entity has < the mixed-outcome threshold of holdout labels, persist/return the **workspace-level fallback** calibration instead of identity.
- Surface coverage and precision as separate metrics in the eval result and the aiEvalRuns/aiBatchRuns surfaces (abstention counts toward neither precision nor a 'wrong' — it is a tracked third outcome).
- Refit on each eval run (cadence = the eval); add a settings/onboarding trigger + an optional periodic refit (cron) so the calibration tracks the live confidence distribution; never hardcode params (the existing fit derives them from data).
- Confirm the conservative-only clamp (decideAutoPost gateConfidence = min(calibrated, raw), calibration.ts:353) is the gate used by routeProposedCategory via shouldAutoPostAI — no change to AI_AUTONOMY_THRESHOLDS (0.90/0.75).

**Files:** `convex/ai.ts`, `convex/pipeline.ts`, `convex/crons.ts`, `apps/web/src/components/openbooks/settings/AiSection.tsx`

**Definition of done**

- [ ] Running the new fit-and-persist action writes a per-entity aiCalibrations row whose method/a/b/eceBefore/eceAfter come from that entity's holdout pairs (not identity) when there are >=4 mixed-outcome samples; an entity below that threshold receives the workspace-level fallback calibration rather than identity.
- [ ] After persistence, an auto-post decision for an overconfident raw 0.92 uses the CALIBRATED (lower) probability against the unchanged 0.90 threshold — asserted by a pipeline test that seeds an aiCalibrations row with a<1 and shows a borderline item now abstains.
- [ ] The eval/report output exposes coverage and precision as distinct numbers and counts abstentions separately.
- [ ] AI_AUTONOMY_THRESHOLDS values are unchanged.

**Deliverables:** fit-and-persist calibration action + optional refit cron; Coverage/precision separation in eval output; Test proving the gate compares the calibrated probability after persistence

**Verify.** convex/ai.test.ts / pipeline.test.ts: insert an aiCalibrations row with a<1,b<0 for the workspace, route an AI proposal at raw 0.92 just above threshold, assert it now routes needs_review (calibrated below 0.90); remove the row and assert it posts. Typecheck + test.

### E2-T11 — BYO key-entry UI + per-decision provenance + Top-N Inbox suggestions
`size: L` · `risk: low` · `depends on: E2-T1, E2-T7`

**Intent.** Make the engine legible and usable from the product. Replace the disabled provider dropdown / read-only key field (AiSection.tsx:104-122) with a real provider picker + key entry calling E2-T1, and surface provenance ('Matched your rule' / 'Same as your last 6 AWS charges' / 'AI 0.82 - review') plus Top-N AI suggestions in the Inbox so the owner can one-click accept.

**Changes**

- AiSection.tsx: enable the provider Select from listProviderCatalog(), add an API-key (and Bedrock access-key pair / baseUrl / region) input that calls saveCredential, show lastFour + a working Test connection per provider; remove the 'set in Convex env' dead copy.
- Inbox/transaction-drawer (CoreScreens.tsx / ModuleScreens.tsx Inbox surface): render a provenance line per decided item derived from transaction.decidedBy + confidence + reasoning, and offer Top-N category suggestions (from the AI proposal + recall candidates) with accept-to-confirm wiring through the existing confirmTransaction/recategorize mutations.
- Show the running 'N unreviewed' count and the batch-run progress (latestCategorizationBatchRuns) so the drainer (E2-T3) is visible.

**Files:** `apps/web/src/components/openbooks/settings/AiSection.tsx`, `apps/web/src/components/openbooks/CoreScreens.tsx`, `apps/web/src/components/openbooks/ModuleScreens.tsx`

**Definition of done**

- [ ] An owner can pick a provider and paste a key in Settings -> AI; it persists via saveCredential and Test connection succeeds against that provider (verified manually / e2e); the provider dropdown is no longer disabled.
- [ ] Each decided Inbox item shows a human-readable provenance line that matches its decidedBy/stage (rule/memory/embedding/ai/plaid_prior).
- [ ] Top-N suggestions render and accepting one confirms the transaction through the existing pipeline mutation (no new ledger path).

**Deliverables:** Working AI key-entry settings panel; Provenance line + Top-N suggestion UI in the Inbox; An e2e or interactive smoke proving save-key + accept-suggestion

**Verify.** Run the web app (pnpm dev / repo run skill), save an Anthropic key in Settings -> AI, run Test connection (green), import/route a few transactions, open the Inbox and confirm a Top-N suggestion posts. Add/extend an e2e smoke if the suite covers Settings AI.

## Decisions applied

All prior open questions for this epic are RESOLVED in [`../decisions.md`](../decisions.md) (canonical) and the per-epic deltas in [`../plan-rebuild-changelog.md`](../plan-rebuild-changelog.md). Summary of what was decided and baked into the tickets above:

- **Q7 — Embedding dimensions:** PIN one 1024-dim embedding model, decoupled from the chat provider (Titan v2 @1024 or `text-embedding-3-small/large` with `dimensions:1024`). Never mix models in the index (one-way door). No pad/truncate/project, no second index. Degrade to lexical/merchantKey memory when no embedding key exists. → E2-T4/E2-T5.
- **Q8/Q49 — Business context / income streams:** AI proposes from history → owner approves → persists as an explicit settings field the prompt reads. Stream taxonomy defined ONCE, shared with E4 + E9-T8. → E2-T9.
- **Q9 — Low-confidence tail:** uncertain items stay UNPOSTED in the Inbox; never auto-post to an `Uncategorized` account. → E2-T7.
- **Q10 — Calibration scope/cadence:** per-entity, refit on each eval run, workspace-level fallback when an entity's holdout labels are thin. → E2-T10.
- **Q11 — Legacy env-only registry:** migrate all three runtimes (categorizer, Ask-AI chat, test-connection) onto the `aiProvider.ts` factory + E3's unified resolver this sprint. → E2-T2.
- **Q12/Q18 — Credential storage & catalog:** ONE unified `credentials` table (encrypted blob shape), `kind:"ai"`, workspace-scoped, owned by E3; `aiCatalog.ts` (14 providers) is canonical; `setConfig` widened to 14 by E3. E2 consumes, does not store. → E2-T1.

**Still needs Ansar (this epic):** none. All E2 items are resolved by Ansar's decisions, QBO parity, or an engineering default.

## Research notes

- Production 'AI learning' for transaction categorization is a memory WRITE on every correction, not a model retrain: the next occurrence of that merchant resolves deterministically with no LLM call. Reserve the LLM for the novel tail (typically <10-20% of volume) for cost and reliability. ([source](https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-transactions/categorize-online-banking-transactions-quickbooks/L7Lpgw9LL_US_en_US))
- Merchant strings vary wildly ('AWS' vs 'AMZN WEB SERVICES'), so exact-string memory has a low ceiling; an embeddings/k-NN recall layer over past corrections lifts coverage substantially (Mercado Libre reported moving from ~60% to ~90% auto-resolution by adding embedding recall). ([source](https://arxiv.org/abs/2508.05425))
- Raw LLM confidence is systematically overconfident; temperature/Platt scaling fit on a labeled holdout calibrates it so a stated 0.90 actually means ~90% correct. Gate auto-post on the CALIBRATED probability, and clamp so calibration can only ever make auto-post more conservative. ([source](https://arxiv.org/abs/1706.04599))
- Abstention is a first-class success: track coverage (fraction auto-handled) and precision (fraction of auto-decisions correct) as SEPARATE metrics. A high-precision system that abstains on the hard tail is correct behavior, not failure — Puzzle reports ~98% auto / ~2% flagged with reasoning trails. ([source](https://docs.stripe.com/connect/charges#paymentintent))
- Production categorizers cascade cheapest-signal-first and short-circuit on the first confident stage (memory/rule -> retrieval -> LLM fallback -> abstain), keeping the expensive model off the 80-95% repeat volume; ANNA and Intuit's Rel-Cat use a fast deterministic/structured layer first with the LLM only for the tail. ([source](https://www.intuit.com/blog/innovative-thinking/relcat-bringing-graph-neural-networks-to-transaction-categorization/))
- Always validate model-returned identifiers against the real account list before acting on them; an LLM can hallucinate a category id, and a hallucinated id must abstain to human review, never throw a batch or post the wrong account. ([source](https://www.anthropic.com/research/building-effective-agents))
