# R5 — BYO-key credential storage + the 14-provider AI model

Research task R5 (launch-sprint rebuild). Decides how OpenBooks stores user-supplied
third-party API keys (AI / Plaid / Stripe / Plunk) and how it runs all 14 AI providers
on one runtime. Grounded in the code that already exists in `convex/` (`secretBox.ts`,
`aiCatalog.ts`, `aiProvider.ts`, `aiCredentials` + `connectionCredentials` schema tables).

Contract anchors (ANSAR-DECISIONS): AI keys workspace-scoped (#9), Plunk workspace-scoped
(#10), Stripe webhook required if Stripe's docs require it (#11), ONE correct
encrypted-at-rest storage shape for ALL credentials, correctly scoped (#12), live connectors
must work locally (#13), all 14 providers available (#8).

---

## Recommended decisions

Concrete choices OpenBooks should adopt. Each is a value, not an option.

### A. Encryption-at-rest primitive

1. **Keep one shared symmetric AEAD module** (today's `secretBox.ts`) as the single
   encrypt/decrypt path for every stored secret. Do not add a second crypto path.
2. **Fix the key derivation.** The current code does `SHA-256(passphrase)` and uses the
   digest as the AES-GCM key. Replace that with a real KDF: treat
   `OPENBOOKS_SECRET_ENCRYPTION_KEY` as **32 raw bytes (base64/hex), used directly as the
   AES-256 key** (preferred — generate with `openssl rand -base64 32`), OR if a human
   passphrase must be supported, derive via **HKDF-SHA256** with a fixed app salt + info
   label (not a bare hash). A bare SHA-256 of a low-entropy passphrase gives a low-entropy
   key; that is the one real weakness in the current implementation.
3. **Algorithm stays AES-256-GCM** (Web Crypto, default Convex runtime, no `"use node"`).
   It is FIPS-friendly and already wired. **12-byte random IV per encryption** (already
   done) — never reuse an IV under a key. XChaCha20-Poly1305 / libsodium `secretBox` is an
   acceptable alternative (bigger nonce, misuse-resistant) but is **not worth a Node-runtime
   dependency** here; AES-GCM-with-random-IV is sufficient and keeps the function in the
   light runtime.
4. **Versioned ciphertext stays** (`v1:base64(iv):base64(ct)`). Keep the version tag — it is
   what lets us migrate KDF or algorithm later without a flag day.
5. **Adopt envelope encryption as the documented upgrade path, not day-1 build.** For the
   hosted OpenBooks (and any KMS-equipped self-host), the correct long-term shape is: random
   per-secret **DEK** encrypts the value; a **KEK in a KMS** (AWS KMS / GCP KMS / Vault)
   wraps the DEK; store wrapped-DEK + ciphertext. Wire this behind the same `encryptSecret`
   interface so callers never change. For the default OSS self-host (no KMS), the single
   env-var master key IS the KEK — acceptable and standard for OSS.

### B. ONE unified credential storage shape (the #12 decision)

6. **Collapse `aiCredentials` and `connectionCredentials` into one table: `credentials`.**
   Today there are two divergent shapes — `aiCredentials` stores per-field ciphertext
   columns (`apiKeyCiphertext`, `accessKeyIdCiphertext`, …); `connectionCredentials` stores
   one `encryptedPayload` = `encrypt(JSON.stringify(payload))` plus a `fingerprint`. The
   JSON-payload shape is the better one — adopt it for everything. Recommended columns:

   ```
   credentials:
     workspaceId        : Id<workspaces>            // ALWAYS present (tenant boundary)
     entityId           : Id<entities> | undefined  // present only for per-business creds
     kind               : "ai" | "plaid" | "stripe" | "plunk"
     provider           : string                    // aiProviderId | "plaid" | "stripe" | "plunk"
     mode               : "live" | "test" | "sandbox" | undefined
     label              : string                    // human label for the UI
     encryptedPayload   : string                    // encrypt(JSON.stringify(secret fields))
     // non-secret, safe-to-read display + connection fields:
     baseUrl?, region?  : string                    // openai-compatible / bedrock
     lastFour           : string                    // display tail, e.g. "a1b2" (NEVER the key)
     keyPreview?        : string                    // e.g. "client...3f9c" for Plaid/Stripe
     fingerprint        : string                    // SHA-256(secret) — dedupe + rotation detect
     status             : "active" | "invalid" | "disconnected"
     lastValidatedAt?   : number
     createdByUserId?   : Id<users>
     createdAt, updatedAt
   indexes:
     by_workspace_kind_provider  [workspaceId, kind, provider]
     by_entity_kind_provider     [entityId, kind, provider]
     by_fingerprint              [fingerprint]
   ```

7. **Scoping rules baked into the shape (matches Ansar's product model):**
   - **AI** (`kind:"ai"`) → keyed by `workspaceId` only (`entityId` empty). One row per
     `(workspace, provider)` so an owner saves several providers and switches. (Decision #9.)
   - **Plunk** (`kind:"plunk"`) → `workspaceId` only, single row. (Decision #10.)
   - **Stripe** (`kind:"stripe"`) → **per-business**: `entityId` required. Each LLC connects
     its own Stripe. (Matches the existing `connectionCredentials.entityId`.)
   - **Plaid** (`kind:"plaid"`) → one connection per workspace; **account→business mapping
     lives on the financial-connection / account rows, NOT in the credential**. The
     credential is the Plaid Item access token; the mapping of each account to an entity is a
     separate concern (already modeled in `financialConnections`). Store the Item token at
     `workspaceId` scope (entity optional for app-level Plaid client creds).
   - The Plaid/Stripe **app credentials** (Plaid `client_id`/`secret`, Stripe restricted key)
     and **per-connection tokens** are both `kind:"plaid"/"stripe"` rows distinguished by
     `provider`/`label` + presence of `connectionId` — keep `connectionId` as an optional
     column to preserve the existing per-connection link.

8. **Never decrypt outside an action/internal context.** Decryption requires the env key,
   which lives only on the server. Public queries return `lastFour` / `keyPreview` / `status`
   / `provider` / `label` and NOTHING else. There is no code path that returns plaintext to
   the client. (Already true today — preserve it.)

9. **Rotation = overwrite + re-validate, no history.** Saving a new key for the same
   `(scope, provider)` overwrites `encryptedPayload`, recomputes `lastFour`/`fingerprint`,
   resets `status` to needs-validation, then runs a live ping. `fingerprint` lets us detect
   "same key re-pasted" (no-op) vs an actual rotation. For Plaid specifically, true rotation
   uses **`/item/access_token/invalidate`** (returns a new token) — wire that as the Plaid
   rotation action and store the returned token. Do not keep old ciphertext rows.

10. **Validate-on-save for every kind.** AI: a 1-token `generateText`/list-models ping.
    Plaid: `/accounts/balance/get` or `/item/get`. Stripe: `GET /v1/account` (or a balance
    read) with the restricted key. Plunk: a cheap authenticated call. Persist the result to
    `status` + `lastValidatedAt`. This is what makes "live connectors work locally" (#13)
    trustworthy — the user sees green/red immediately, not at first real use.

### C. The 14-provider AI runtime

11. **Keep the current per-call factory (`aiProvider.ts buildModelForProvider`); do NOT
    switch to a static `createProviderRegistry`.** The AI SDK's `createProviderRegistry`
    expects providers configured at module-init with env keys; the official docs give **no
    pattern for per-request API keys**. OpenBooks needs the key resolved per-workspace at
    call time, so the right primitive is exactly what's there: call
    `createOpenAI/createAnthropic/createGateway/createAmazonBedrock/createOpenAICompatible`
    with the decrypted key on each invocation. This is the SDK-blessed way to do BYO-per-
    tenant keys.
12. **Five SDK packages cover all 14 providers** (already the design): `@ai-sdk/openai`,
    `@ai-sdk/anthropic`, `@ai-sdk/amazon-bedrock`, `@ai-sdk/gateway`, and
    `@ai-sdk/openai-compatible` (baseURL-driven: google, azure, groq, deepseek, mistral,
    moonshot, xai, fireworks, ollama, custom). Keep `aiCatalog.ts` as the single source that
    drives both the settings form (which fields to ask for) and the factory. No change needed
    to the provider list — it already matches decision #8 exactly.
13. **Model picker UX:** per provider, show the curated `models[]` as a dropdown PLUS a
    free-text "custom model ID" field (already designed). Persist the chosen `chatModel` /
    `categorizeModel` on the AI-config row, not on the credential. Offer a "refresh models"
    action that hits the provider's `/models` endpoint where one exists (OpenAI, Groq,
    OpenAI-compatible) to refresh the list — treat catalog lists as defaults, not a closed
    set. Gate Ask-AI chat to providers where `supportsTools` is true (Ollama/custom default
    false), and surface that in the UI so users don't pick a tool-less model for chat.
14. **EMBEDDINGS ARE PINNED — do not let the provider picker change them.** This is the
    sharpest engineering constraint. The Convex vector index is fixed at **`dimensions:
    1024`** (`schema.ts` `aiMemoryEmbeddings.by_embedding`), and embeddings from different
    models are mutually incompatible — you cannot mix OpenAI-1536, Cohere, and Bedrock-Titan
    vectors in one index, and changing model means **re-embedding the whole corpus**.
    Therefore:
    - Choose **ONE** embedding model for categorization memory and fix it independent of the
      user's *chat* provider. The current store already records `embeddingModel` per row and
      indexes at 1024 dims — keep a 1024-dim model as the canonical (e.g. Bedrock Titan v2 at
      1024, or `text-embedding-3-small`/`-large` with the `dimensions:1024` parameter via
      Matryoshka truncation).
    - If a workspace has no embedding-capable key, **degrade gracefully** to lexical/merchant-
      key memory (already the `merchantKey` path) rather than failing.
    - If we ever must support a second embedding model, **stamp `embeddingModel` + dims and
      partition the index**; never compare vectors across models. Document this as a one-way
      door.
15. **Provider fallback / "degraded mode" stays a first-class state** (the codebase already
    has `providerMode: "active" | "degraded"`). When the workspace key is missing/invalid,
    AI *suggests nothing auto-posts* and items route to Inbox — consistent with the product's
    "AI proposes, ledger posts" rule. Keep env-var fallback (`resolveCredentialFromEnv`) for
    headless/CI and single-operator self-host.

---

## Rationale

**Why one table.** Two shapes already drifted (per-column ciphertext vs JSON payload), which
is exactly the bug Ansar's #12 names. A single `encrypt(JSON.stringify(fields))` payload
handles every provider's differing secret set (single key, AWS key-pair, Plaid
client_id+secret, Stripe restricted key + webhook secret) without schema churn, while
non-secret display/connection fields stay queryable in plaintext. `workspaceId` is always the
tenant boundary; `entityId` distinguishes per-business (Stripe) from workspace-wide (AI,
Plunk). That single shape encodes the whole scoping contract.

**Why fix the KDF but not rip-and-replace.** AES-256-GCM with a random 12-byte IV and a
versioned ciphertext is already industry-standard at-rest encryption. The only genuine
weakness is deriving the key with a bare `SHA-256(passphrase)` — low-entropy passphrases
yield low-entropy keys with no work factor. Using 32 raw random bytes directly (or HKDF for
passphrases) closes that gap with a few lines and no new dependency. Envelope encryption +
KMS is the correct *hosted* posture and should be the documented upgrade behind the same
interface, but a single env master key is the normal, accepted shape for an OSS self-host —
forcing KMS would break "runs locally."

**Why per-call factory, not registry.** `createProviderRegistry`/`customProvider` are built
for a fixed set of providers configured once from env. OpenBooks resolves a *different*
decrypted key per workspace per request; the AI SDK has no documented per-request-key hook on
the registry, so the registry would force either a global key (wrong) or rebuilding the
registry per call (no benefit over the factory). The five-package factory IS the canonical
multi-provider BYO pattern.

**Why pin embeddings.** This is the non-obvious trap. The "14 providers" freedom applies to
*chat/categorization generation*, NOT to embeddings: a fixed-dimension vector index plus
cross-model incompatibility means the embedding model must be a single global choice, fully
decoupled from the user's chat-provider selection. Letting the model picker swap the embedding
model would silently corrupt similarity search. Pinning it (and degrading to lexical memory
when no embedding key exists) is the only correct design.

---

## How QBO / Stripe / Plaid / industry do it

- **Stripe** — *Restricted API keys* (least-privilege, per-service) are the recommended
  server-side credential; rotate periodically; "key rolling" gives a transition window (up to
  12h) where old+new both work for zero-downtime rotation. **Webhook signing secrets
  (`whsec_…`) are NOT API keys** — they're per-endpoint secrets used to verify inbound
  webhooks; store them alongside the connection (our `encryptedPayload` can hold the restricted
  key AND the webhook secret in one JSON blob). For OpenBooks this means: store a restricted
  key per business + its webhook secret; verify every webhook signature; require the webhook
  per decision #11.
- **Plaid** — access tokens **do not expire**, so they must be stored encrypted and
  persistently; never expose in browser/mobile/logs/analytics; one access_token per **Item**
  (one institution); rotate via **`/item/access_token/invalidate`** which returns a fresh
  token. Application-layer encryption with keys in a managed KMS is the documented best
  practice. OpenBooks already encrypts the token; the additions are the KMS upgrade path and
  wiring the invalidate endpoint for rotation.
- **QBO / general SaaS BYO** — the prevailing pattern is: encrypt at rest with AES-256-GCM
  (or envelope encryption with a KMS-held KEK), keep the plaintext server-side only, return a
  masked tail (last4) to the UI, validate on save, and support rotation by overwrite. Hashes
  (not reversible encryption) are used for *passwords*; reversible encryption is correct for
  API keys precisely because we must replay them to the third party.
- **Vercel AI SDK** — multi-provider is achieved either via a registry (fixed env-keyed
  providers) or, for dynamic per-tenant keys, by constructing providers per call with
  `createOpenAI/createAnthropic/createGateway/createAmazonBedrock/createOpenAICompatible`.
  OpenAI-compatible `baseURL` providers collapse ~10 vendors onto one package. Embeddings are
  accessed the same way (`registry.textEmbeddingModel` / `embed`), but model choice is a hard
  commitment because of dimension/format incompatibility.

---

## Citations

AI SDK:
- https://ai-sdk.dev/docs/ai-sdk-core/provider-management
- https://ai-sdk.dev/docs/reference/ai-sdk-core/provider-registry
- https://vercel.com/docs/ai-gateway/models-and-providers
- https://ai-sdk.dev/providers/community-providers/custom-providers

Security / encryption-at-rest:
- https://docs.cloud.google.com/kms/docs/envelope-encryption
- https://docs.cloud.google.com/kms/docs/key-management-service (KMS governance/rotation)
- https://makeaihq.com/guides/cluster/encryption-at-rest-patterns
- https://libsodium.gitbook.io/doc/secret-key_cryptography/secretbox
- https://libsodium.gitbook.io/doc/secret-key_cryptography/aead/aes-256-gcm
- https://gist.github.com/atoponce/07d8d4c833873be2f68c34f9afc5a78a (crypto best practices)
- https://tigerabrodi.blog/how-to-store-external-api-keys-securely
- https://articles.mergify.com/api-keys-best-practice/

Stripe:
- https://docs.stripe.com/keys
- https://docs.stripe.com/keys/restricted-api-keys
- https://docs.stripe.com/keys-best-practices
- https://docs.stripe.com/webhooks (signature verification)

Plaid:
- https://plaid.com/docs/api/items/ (access_token/invalidate)
- https://www.fintegrationfs.com/post/plaid-token-storage-best-practices-us-compliance
- https://plaid.com/core-exchange/docs/security/

Embeddings (dimension incompatibility):
- https://document360.com/blog/text-embedding-model-analysis/
- https://ofox.ai/blog/embedding-api-rag-complete-guide-2026/
- https://community.openai.com/t/how-to-deal-with-different-vector-dimensions-for-embeddings-and-search-with-pgvector/602141
