# AI Provider Simplification + Bring-Your-Own-Key — Implementation Plan

Status: proposed (awaiting Ansar approval before any code)
Author: handoff from architecture audit, 2026-06-14
Branch base: `codex/real-world-testing-readiness`

---

## 0. Decisions locked (from Ansar)

1. **Provider strategy:** present Vercel AI Gateway **and** direct providers as
   equal choices. No "recommended" default, no Gateway-first lean.
2. **Embeddings / semantic memory:** **remove entirely.** Delete the categorizer
   semantic-memory path and the receipt embedding fallback. Deterministic
   matching (rules, correction memory, receipt amount/date/merchant scorer)
   becomes the only non-LLM matching.
3. **Deliverable now:** this plan, for review. No implementation until approved.

Untouched by this plan (explicitly out of scope, preserve as-is): the ledger
engine, the classification pipeline ladder, autonomy thresholds, confidence
calibration (E6), the business-impact auto-post gate (E6), and Stripe/Plaid
single-counting reconciliation (E7).

---

## 1. Why

The codebase is *scaffolded* to look multi-provider but is hard-locked to Amazon
Bedrock at every live path, with three separate model-invocation styles and two
embedding subsystems that complicate setup. The goal: a self-hoster picks a
provider, pastes one key in the app, picks a model, and is running — with keys
encrypted at rest, never committed, never in plaintext to the client.

### Current-state facts this plan depends on (verified)

- Convex Agent (`@convex-dev/agent`) powers chat; constructed once at module
  load with a single Bedrock model: `convex/agent.ts:98-104`,
  `buildLanguageModel()` at `convex/agent.ts:76-96`.
- Bedrock-only gate: `const active = ready && id === "bedrock" && definition.v1Enabled`
  at `convex/aiProviderRegistry.ts:146`; every non-Bedrock provider has
  `v1Enabled: false`.
- Three invocation styles to unify:
  1. Chat via AI SDK `createAmazonBedrock` — `convex/agent.ts:88-95`.
  2. Connection test via AI SDK `generateText` — `convex/aiSdkRuntime.ts:70-85`.
  3. Categorizer via **raw AWS SDK** `BedrockRuntimeClient`/`InvokeModelCommand`
     (a `"use node"` action) — `convex/bedrockCategorizer.ts`.
- Credentials are read only from `process.env`; there is no app-side setter and
  no key field in the schema (`convex/schema.ts:291-306`, `aiConfigs`).
- An AES-GCM encryption helper already exists and is the reuse target:
  `convex/plaid.ts:445-477` (`OPENBOOKS_TOKEN_ENCRYPTION_KEY`, versioned
  `v1:iv:ciphertext`, `crypto.subtle`).
- Embeddings live in **two** subsystems:
  - Categorization semantic memory: `aiMemoryEmbeddings`
    (`convex/schema.ts:322-342`), `convex/semanticMemory.ts`, consumed at
    pipeline steps `convex/pipeline.ts:830-847` and `:1058-1066`, fed from
    `convex/bedrockCategorizer.ts:589-610` and `:716-739`.
  - Receipt matching fallback: `receiptEmbeddings` +
    `receiptTransactionEmbeddings` (`convex/schema.ts:482-515`), used in
    `convex/receipts.ts` (imports `embedSemanticText`,
    `SEMANTIC_MEMORY_DIMENSIONS` at `convex/receipts.ts:17`). The **primary**
    receipt matcher is deterministic (`findReceiptMatchCandidates`,
    `convex/receipts.ts:655-664`); embeddings are only `match ?? embeddingMatch`.
- The settings UI (`apps/web/.../settings/AiSection.tsx`) has a **disabled**
  provider dropdown, **no** key field, read-only model fields; only autonomy is
  functional and `setConfig` hard-codes `provider: "bedrock"` (`:68`).

---

## 2. Target architecture

```
Settings (AiSection)  ──save provider+model+key──▶  setAiCredential (mutation)
        │                                                   │ encrypt (AES-GCM)
        │ reads status (masked)                             ▼
        ▼                                            aiCredentials (DB, ciphertext)
   providerStatus (query)                                   ▲
                                                            │ decrypt at call time
   chat / categorize actions  ──▶  resolveModel(ctx, ws) ──┘
                                        │
                                        ▼
                            ONE model factory  →  AI SDK provider instance
                          (openai | anthropic | google | bedrock | groq |
                           mistral | deepseek | openai-compatible | gateway)
```

One factory. One credential store. One catalog. The agent, the connection test,
and the categorizer all call the same `resolveModel`.

---

## 3. Data model changes (`convex/schema.ts`)

### Add: `aiCredentials` table
Per workspace + provider, so a user can save several keys and switch providers
without re-pasting.

- `workspaceId: Id<"workspaces">`
- `provider: v.union(... provider ids ...)`
- `apiKeyCiphertext: v.string()`  (AES-GCM `v1:iv:ct`, never returned to client)
- `baseUrl: v.optional(v.string())`  (openai-compatible / Azure / Ollama)
- `region: v.optional(v.string())`   (Bedrock)
- `lastFour: v.string()`             (masked display only, e.g. "…a1b2")
- `createdByUserId`, `createdAt`, `updatedAt`
- index `by_workspace_provider` on `["workspaceId","provider"]`

### Extend: `aiConfigs`
- Keep `provider`, `autonomy`, `chatModel`, `categorizeModel`.
- **Remove** `embedModel` (`convex/schema.ts:302`).
- Widen the `provider` union to the full catalog ids (see §4).

### Remove (embeddings teardown)
- `aiMemoryEmbeddings` table + its `by_embedding` vector index
  (`convex/schema.ts:322-342`).
- `receiptEmbeddings` table + vector index (`:482-503`).
- `receiptTransactionEmbeddings` table (`:505-515`).

Migration note: these are additive/derived caches (correction memories and
receipt documents survive in their own tables), so dropping them loses only the
vector fallback, not source data. Use widen→migrate→narrow:
ship code that stops reading them first, then drop the tables in a follow-up
deploy. See §10.

---

## 4. Provider catalog (`convex/aiProviderRegistry.ts`, rewritten)

Replace the v1-gated registry with a catalog that drives both the factory and
the settings UI. Each entry declares: id, label, runtime style, the AI SDK
package, what credential fields it needs, whether it supports tool-calling, and a
**curated default model list**.

Providers (10), presented equally:

| id | label | credential fields | AI SDK package |
|----|-------|-------------------|----------------|
| `gateway` | Vercel AI Gateway | apiKey | `@ai-sdk/gateway` |
| `openai` | OpenAI | apiKey | `@ai-sdk/openai` |
| `anthropic` | Anthropic | apiKey | `@ai-sdk/anthropic` |
| `google` | Google AI Studio | apiKey | `@ai-sdk/google` |
| `bedrock` | Amazon Bedrock | accessKeyId, secretAccessKey, region | `@ai-sdk/amazon-bedrock` |
| `groq` | Groq | apiKey | `@ai-sdk/groq` |
| `mistral` | Mistral | apiKey | `@ai-sdk/mistral` |
| `deepseek` | DeepSeek | apiKey | `@ai-sdk/deepseek` |
| `moonshot` | Moonshot (Kimi) | apiKey, baseUrl(default) | `@ai-sdk/openai-compatible` |
| `ollama` | Ollama / OpenAI-compatible | baseUrl, apiKey(optional) | `@ai-sdk/openai-compatible` |

Packages to add as **direct** deps (root `package.json`): `@ai-sdk/openai`,
`@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/groq`, `@ai-sdk/mistral`,
`@ai-sdk/deepseek`, `@ai-sdk/openai-compatible`, `@ai-sdk/gateway`
(`@ai-sdk/amazon-bedrock` already present).

Curated default models (~12-15). **Do not hardcode from memory** — the build
step must fetch current IDs (gateway `/v1/models`, or each provider's list) and
pin them; the ids below are the 2026-06-14 snapshot for reference:

- Gateway: `anthropic/claude-sonnet-4.6`, `openai/gpt-5`, `google/gemini-3-pro-preview`
- OpenAI: `gpt-5`, `gpt-5-mini`, `gpt-4.1`
- Anthropic: `claude-opus-4.8`, `claude-sonnet-4.6`, `claude-haiku-4.5`
- Google: `gemini-3-pro-preview`, `gemini-2.5-flash`
- DeepSeek: `deepseek-chat`, `deepseek-reasoner`
- Mistral: `mistral-large-latest`
- Moonshot: `kimi-k2.6`
- Groq: current default llama-4 / gpt-oss id (verify at build)
- Bedrock: `anthropic.claude-...` or `amazon.nova-pro` (verify per account)

Each provider entry marks one model as the default so model picker
pre-selects sensibly the moment a provider is chosen. The catalog also exposes a
"custom model id" escape hatch (free-text) so users aren't capped to the
curated set.

Tool-calling note: the Ask AI agent requires tool-calling. Models/providers
without reliable tool support are flagged in the catalog; if a user picks one,
the categorizer still works but chat shows a "this model can't use tools" notice
rather than failing silently.

---

## 5. The unified model factory (`convex/aiProvider.ts`, new)

Single source of truth for turning saved config → a live AI SDK model.

- `resolveAiConfig(ctx, workspaceId)` → `{ provider, chatModel, categorizeModel,
  credential }` reading `aiConfigs` + decrypting the matching `aiCredentials`
  row. Falls back to env vars (Bedrock `AWS_*`, or `AI_GATEWAY_API_KEY`, etc.)
  for headless/CI so tests and crons still run without DB creds.
- `buildChatModel(config)` / `buildCategorizeModel(config)` → switch on
  `provider`, construct the AI SDK provider with the decrypted key/baseUrl/region,
  return a `LanguageModelV3`.
- `aiRuntimeStatus(ctx, workspaceId)` → replaces the Bedrock-specific
  `aiChatRuntimeStatus()`/`bedrockEnvironmentStatus()`; returns
  `{ configured, provider, chatModel, reason }` for any provider, masking secrets.

This deletes the Bedrock-only gate at `aiProviderRegistry.ts:146` and the
`id === "bedrock"` special-casing in `agent.ts:45-67` and
`aiSdkRuntime.ts:10-16`.

### Agent construction change (important integration point)
The agent is currently built once at module load with one model
(`agent.ts:98-104`). Per-workspace model selection requires resolving the model
**inside** the generation action. Approach: keep a module-level agent for
structure (instructions + tools), but pass the resolved model per call. Confirm
the supported override against the installed `@convex-dev/agent` (check
`node_modules/@convex-dev/agent` docs / the `streamText`/`generateText` options)
before coding; if per-call override is unsupported in 0.6.x, construct the Agent
inside the action from `buildChatModel(config)`. This is the one place to verify
SDK behavior first, not assume.

### Categorizer change
Replace the raw `BedrockRuntimeClient` path in `bedrockCategorizer.ts` with AI
SDK `generateObject` (structured `{ categoryAccountId, confidence, reasoning,
needsHuman }`) using `buildCategorizeModel`. This drops the `"use node"`
requirement and the AWS-specific prompt/parse code. Rename the file to
`categorizer.ts` (it's no longer Bedrock-specific). The pipeline routing,
calibration, and gates downstream are unchanged — only the model call changes.

---

## 6. Security design

- **Reuse the existing AES-GCM helper.** Extract `encryptAccessToken` /
  `decryptAccessToken` from `plaid.ts:445-477` into `convex/secretBox.ts` and
  have both Plaid and AI keys import it. Same `OPENBOOKS_TOKEN_ENCRYPTION_KEY`
  master secret → one setup step total for a self-hoster, not two.
- Keys are written **only** by `setAiCredential` (server re-checks workspace
  auth), stored as ciphertext, and decrypted **only** inside actions that call
  the model. `providerStatus` returns `lastFour` + "configured", never the key.
- The client never receives a plaintext key. The UI shows "•••• a1b2 · saved".
- Why not write Convex env vars from the app: Convex env vars are deploy-time
  config and are not writable from a running function. Encrypted-at-rest DB is
  the correct, standard equivalent and is what this plan uses.
- Self-host quickstart: set `OPENBOOKS_TOKEN_ENCRYPTION_KEY` once
  (`npx convex env set`), then everything else is in-app. Document a one-liner to
  generate the key; optionally auto-generate on first boot if absent (dev only).

---

## 7. Embeddings removal — complete file list

Delete / edit (categorization):
- `convex/semanticMemory.ts` — delete file (all of: `embedSemanticText`,
  `proposeCategorizationMemory`, `findSemanticMemoryProposal`,
  `upsertCorrectionMemoryEmbedding`, the embedding-confirm/recategorize actions).
- `convex/bedrockCategorizer.ts` (→ `categorizer.ts`) — remove the
  `semanticMemoryProposal` calls and type (`:68,:103,:487,:508,:518,:525,
  :589-610,:716-739`). Categorization falls straight through to the LLM after
  rules/correction-memory.
- `convex/pipeline.ts` — remove `semanticMemoryProposalValidator` and the
  `semanticMemoryProposal` branches (`:24,:49,:72,:830-847,:1022,:1058-1066`,
  and the fallback reason text at `:1091`). Step 6 disappears; the ladder becomes
  duplicate → transfer → match → rule → correction-memory → plaid-prior → AI →
  Inbox.
- `convex/ai.ts` — drop `embedModel`/`AI_EMBEDDINGS_MODEL` from
  `providerStatus`/`setConfig` and the `embeddingsModel` status field.

Delete / edit (receipts):
- `convex/receipts.ts` — remove the embedding import (`:17`), the
  `receiptTransactionEmbeddingRows` / `upsertReceiptTransactionEmbedding`
  function refs (`:91-111`), `buildReceiptEmbeddingText`,
  `chooseBestReceiptEmbeddingMatch`, `assertReceiptEmbeddingVector`,
  `receiptEmbeddingCandidates`, and the `embeddingMatchedTransactionId`/
  `embeddingMatchScore` args + the `match ?? embeddingMatch` merge
  (`:953-990`). Keep `findReceiptMatchCandidates` (deterministic) as the sole
  matcher; `finalMatch = match ?? existingMatch`.

Schema + env + UI + tests:
- `convex/schema.ts` — drop the 3 tables/indexes (§3).
- `convex/aiProviderRegistry.ts` — drop `embeddings` capability,
  `embeddingModel`, `AI_EMBEDDINGS_MODEL`.
- `.env.example` / `.env.local` — remove `AI_EMBEDDINGS_MODEL`.
- `apps/web/.../settings/AiSection.tsx` — remove the "Embeddings model" field
  (`:132-137`). `apps/web/src/lib/openbooks/ai.ts` — drop `embeddingsModel` from
  the status type; check `CoreScreens.tsx`/`ModuleScreens.tsx` references.
- Tests: prune embedding assertions/fixtures in `ai.test.ts`, `receipts.test.ts`,
  `plaid.test.ts`, `realTestReset.ts`, `aiThreads.ts` (any embedding refs).

---

## 8. Settings UI rebuild (`AiSection.tsx`)

Turn the "Your model, your key" card from facade into function:

1. **Provider** select — enabled, lists all 10 catalog providers, persists via
   `setConfig`.
2. On provider change → **Model** select populates from the catalog default list
   (+ "custom id" free-text), default pre-selected.
3. **Credential** fields render per provider (apiKey; +region for Bedrock;
   +baseUrl for openai-compatible/Ollama). Key input is write-only; shows
   "•••• a1b2 · saved" when a credential exists.
4. **Save** → `setAiCredential` (encrypt) + `setConfig` (provider/model).
5. **Test connection** → existing `testProviderConnection`, generalized to any
   provider via `buildChatModel`.
6. Autonomy cards, spend estimate, diagnostics — unchanged.

Keep shadcn primitives, no new color/ornament (design rules). Plain-English copy
("Connect your AI", "Paste your key — it's encrypted and never leaves your
server").

---

## 9. Epics, order, definition-of-done

Pipeline these so each lands green independently.

- **E1 — secretBox + schema.** Extract `secretBox.ts`; add `aiCredentials`;
  widen `aiConfigs.provider`; remove `embedModel`. DoD: typecheck + existing
  Plaid encryption tests pass against the shared helper.
- **E2 — catalog + factory.** Rewrite `aiProviderRegistry.ts` to the catalog;
  add `aiProvider.ts` factory; install provider packages. DoD: unit test that
  every catalog provider constructs a model from a fake credential (no network).
- **E3 — embeddings teardown.** All of §7 except dropping the tables (widen
  phase: stop reading). DoD: full `pnpm verify` green; pipeline ladder + receipt
  matching proven by existing deterministic tests.
- **E4 — wire chat + categorizer to factory.** Agent model resolution; categorizer
  on `generateObject`; generalize `testProviderConnection`. DoD: chat + categorize
  e2e pass against Bedrock (regression) and at least one second provider in a
  mocked/keyed test.
- **E5 — settings UI.** §8. DoD: Playwright — pick provider, save key, test
  connection, switch provider; key never appears in client payloads.
- **E6 — credential mutations + masking + authz.** `setAiCredential`,
  `deleteAiCredential`, masked `providerStatus`. DoD: authz test (cross-workspace
  read blocked); no plaintext in any query result.
- **E7 — narrow migration.** Drop the 3 embedding tables. DoD: deploy-safe
  migration; `pnpm verify` green post-drop.
- **E8 — docs + env.** Update `.env.example`, README "Connect your AI", and the
  Bedrock-centric references in `docs/finishing/whats-left.md`. DoD: a new user
  can go key→running from the README in under 5 minutes.

Gate every epic with `pnpm verify` (typecheck, lint, build, unit) and the
relevant Playwright specs. Ledger/pipeline/calibration/reconciliation tests must
stay green throughout — they are the regression fence.

---

## 10. Migration & backward-compat

- Existing Bedrock env users keep working: the factory's env fallback (§5) reads
  `AWS_*` when no DB credential exists, so nothing breaks on deploy.
- `aiConfigs` rows with old `provider: "bedrock"` and no credential row → resolve
  via env fallback until the user saves a key in the new UI.
- Embedding tables: widen (stop reading, E3) → deploy → narrow (drop, E7). No
  source data lost; only vector caches.
- `setConfig`'s hard-coded `provider: "bedrock"` (`AiSection.tsx:68`) is replaced
  by the real provider selection.

---

## 11. Risks / things to verify before coding

1. `@convex-dev/agent` per-call model override support (see §5) — verify against
   installed version; pick module-agent-with-override vs construct-in-action.
2. AI SDK v6 provider construction signatures per package (apiKey/baseURL/region
   options differ) — verify against `node_modules/@ai-sdk/*/docs` per the ai-sdk
   skill; do not trust memory for option names or model ids.
3. Tool-calling reliability varies by provider/model — catalog flags + chat
   notice (§4) rather than silent failure.
4. Convex default-runtime vs `"use node"`: moving the categorizer to AI SDK
   should remove the node requirement, but confirm the chosen providers' SDKs run
   in the Convex default runtime.
5. Spend-estimate price table is Bedrock-shaped; make it provider-aware or label
   it clearly indicative.

---

## 12. Out of scope (fast-follows, not this plan)

- **AP email inbox** (`ap@company` → invoices auto-captured): separate
  email-ingestion + existing receipt-OCR pipeline track.
- New Ask AI tools beyond the current 10 (e.g. reconciliation actions, deeper
  analytics) — worth doing, but a distinct epic.
- Live Plaid Link + Stripe webhook proof (needs Ansar-side inputs; tracked in
  `whats-left.md`).
