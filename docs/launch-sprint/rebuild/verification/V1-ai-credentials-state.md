# V1 — AI Credentials State (CURRENT TRUTH)

Branch: `codex/real-world-testing`. Read-only investigation, 2026-06-17.

The 2026-06-16 blueprint claimed "zero insert/patch callers" for `aiCredentials`
and a disabled provider dropdown. **Both claims are still TRUE on this branch.**
New scaffolding (`aiProvider.ts` factory, `aiCatalog.ts` 14-provider catalog,
`aiCredentials` table) has been *added* but is **fully unwired** — it has no
write path, no read path, and no runtime consumer. The product still runs
Bedrock-from-env only.

## Current truth (file:line evidence)

### There are TWO parallel provider systems — one live, one dead scaffolding

1. **LIVE (Bedrock-env-only, 5-provider list):**
   - `convex/aiProviderRegistry.ts:1` — `AI_PROVIDER_IDS = [bedrock, anthropic, openai, google, ollama]`; only `bedrock` has `v1Enabled: true` and can be `active` (`:141` `active = ready && id === "bedrock"`). Resolution is 100% from `process.env` (`AI_PROVIDER`, `AWS_*`, `AI_MODEL`).
   - `convex/agent.ts:88` (categorizer) and `convex/aiChatRuntime.ts:151` (Ask AI chat) and `convex/aiSdkRuntime.ts:70` (test-connection) each hard-construct `createAmazonBedrock({...process.env...})(status.model)`. None read `aiConfigs`, `aiCredentials`, or the new factory.

2. **DEAD SCAFFOLDING (14-provider BYO, added but unused):**
   - `convex/aiCatalog.ts:21` — full 14-provider catalog (gateway/openai/anthropic/google/bedrock/azure/groq/deepseek/mistral/moonshot/xai/fireworks/ollama/openai_compatible) with runtime/credentialKind/baseUrl/models. Good quality, reachable via only 5 AI SDK packages.
   - `convex/aiProvider.ts:44` `buildModelForProvider`, `:83` `decryptCredentialRow`, `:104` `resolveCredentialFromEnv`, `:149` `credentialIsComplete`, `:165` `resolveModelId` — a complete provider-agnostic factory + resolver. **Zero consumers.** Grep for these symbols across `convex/` + `apps/` returns only `aiProvider.ts` itself and `aiProvider.test.ts`. The test exercises `buildModelForProvider` in isolation (`aiProvider.test.ts:41`); it never goes through a mutation or DB row.

### `aiCredentials` table = defined, never written, never read
- `convex/schema.ts:326` defines `aiCredentials` (per-field ciphertext: `apiKeyCiphertext`, `accessKeyIdCiphertext`, `secretAccessKeyCiphertext`, plaintext `baseUrl`/`region`, `lastFour`, index `by_workspace_and_provider`).
- Only two non-test references in the whole repo: `schema.ts` (definition) and `aiProvider.ts:83` (the `Doc<"aiCredentials">` type in the dead decrypt helper). **No `insert("aiCredentials")`, no `.patch`, no `.query("aiCredentials")` anywhere.** RC9 / BYO write path = NOT built.

### `aiConfigs` = the only thing that actually persists, and it's narrowed
- `convex/schema.ts:312` `aiConfigs` (workspaceId, provider, chatModel, categorizeModel, autonomy). Schema validator `aiProviderIdValidator` (`schema.ts:9`) accepts all **14** providers.
- Sole writer: `convex/ai.ts:838` `setConfig` mutation. But its arg validator `aiProviderValidator` (`ai.ts:31`) accepts only **5** (bedrock/anthropic/openai/google/ollama) — a mismatch with the schema and the catalog.
- In practice `setConfig` only ever persists `autonomy` + `provider:"bedrock"`; `chatModel`/`categorizeModel` are copied from `env.model`, never user-chosen. It stores **no key** (no credential fields on `aiConfigs`).

### UI: provider dropdown disabled, key field read-only (no paste)
- `apps/web/src/components/openbooks/settings/AiSection.tsx:105` — `<Select value=... disabled>` with 5 hardcoded `<SelectItem>`s. Still disabled, as the blueprint said.
- `:121-125` — "API key" is a read-only `<div>` showing `"set in Convex env · never shown"` / `"not configured"`. No `<Input>`, no paste, no submit.
- `:68` — `pickAutonomy` always calls `setConfig({ provider: "bedrock", autonomy })`. The UI cannot pick provider or model, cannot enter a key, cannot save a credential.

### Credential storage is NOT unified — three different shapes today
- **AI:** `aiCredentials` (per-field-ciphertext shape) — defined but dead; plus `aiConfigs` holds non-secret provider/model.
- **Plaid/Stripe:** `connectionCredentials` (`schema.ts:764`) — a *single* `encryptedPayload` JSON blob + `fingerprint` + `keyPreview` + `status`/`lastValidatedAt`, scoped `workspaceId`+`entityId`+`connectionId`. This one is **live and correct**: written at `convex/connections.ts:823` (via `:506`/`:570` `encryptSecret(JSON.stringify(payload))`), read+decrypted at `connections.ts:935/968/996`.
- **Plunk:** no credential store at all — `packages/email/src/plunk.ts:33` reads `process.env.PLUNK_SECRET_KEY` directly. Not workspace-scoped.
- Shared crypto primitive exists: `convex/secretBox.ts` (`encryptSecret`/`decryptSecret`, AES-GCM, `OPENBOOKS_SECRET_ENCRYPTION_KEY` w/ token-key fallback). Both `connectionCredentials` and the dead `aiCredentials` helper use it, so the encryption layer is already common; the *table shapes and scoping* are not.

## What's already done vs still open

**Already done (reusable, keep):**
- 14-provider catalog (`aiCatalog.ts`) — drives both UI and factory; matches decision #8.
- Provider-agnostic model factory + env resolver (`aiProvider.ts`) — exists, unit-tested, pure. This is the resolver/factory the plan wants; it just needs to be *called*.
- `secretBox` shared AES-GCM crypto — the right encryption primitive for decision #12.
- `connectionCredentials` is a working, encrypted, workspace+entity-scoped credential store with validation/status — the strongest existing template for the "one correct storage shape."

**Still open (RC9 + "unify credentials" largely NOT done):**
- No write path for BYO AI keys (no `aiCredentials` mutation; UI has no key input).
- No read/resolve at runtime: categorizer, chat, and test-connection all bypass the factory and hardcode Bedrock-from-env. Switching providers does nothing.
- `setConfig` arg validator (5) is out of sync with schema (14) and catalog (14).
- UI provider `<Select>` is `disabled`; model picker and custom-model field absent.
- Two competing AI credential shapes (`aiCredentials` per-field vs `connectionCredentials` blob) — must be reconciled into one shape per decision #12.
- Plunk key not workspace-scoped (decision #10 unmet).

## Implications for the plan

- RC9 is **partially scaffolded, not done**: the factory/catalog/table exist but nothing writes, reads, or routes through them. Treat aiProvider.ts/aiCatalog.ts as a foundation to *wire*, not to rebuild.
- The "unify all credential storage" decision (#12) should pick **one** shape. `connectionCredentials`' single-`encryptedPayload`+`fingerprint`+`keyPreview`+`status` pattern is the proven one; the half-built per-field `aiCredentials` shape is the weaker candidate. Recommend converging AI/Plaid/Stripe/Plunk onto the connectionCredentials-style shape (or a generalized `credentials` table) scoped to workspace.
- Concrete build tasks implied: (1) `saveAiCredential`/`deleteAiCredential` mutations writing the unified shape via `secretBox`; (2) a workspace-scoped resolver that loads the row, calls `decryptCredentialRow` + `buildModelForProvider`, with env fallback (`resolveCredentialFromEnv`); (3) rewire `agent.ts`, `aiChatRuntime.ts`, `aiSdkRuntime.ts` to that resolver instead of hardcoded Bedrock; (4) widen `setConfig` to 14 providers + persist chosen model; (5) replace the disabled `<Select>` + read-only key div in `AiSection.tsx` with a real provider/model picker + key input; (6) move Plunk onto the same store.
