# OpenBooks Security Posture

OpenBooks is bring-your-own-keys, self-hosted, open-source bookkeeping. Before you
paste a Plaid secret, a Stripe restricted key, or an AI provider key into your own
deployment, here is exactly how that secret is handled — with file citations you
can check yourself. This is a lean, honest, code-cited statement, not a marketing
trust page. Every claim below was verified against the code on this branch; where a
claim is narrower than you might assume, it says so.

If you find a security issue, email **security@openbooks.dev** (responsible
disclosure: give us a reasonable window to fix before public disclosure).

---

## 1. Credentials are encrypted at rest

Every sensitive credential we must store — Plaid access tokens, Stripe restricted
keys, Plunk keys, and bring-your-own AI provider keys — is encrypted with AES-GCM
before it touches the database.

- **Where:** `convex/secretBox.ts`. `encryptSecret()` derives a 256-bit AES-GCM key
  via HKDF-SHA-256 (RFC 5869) from the deployment secret
  `OPENBOOKS_SECRET_ENCRYPTION_KEY`, with a fresh random 16-byte salt and 12-byte
  IV per ciphertext. Ciphertext is versioned (`v2:salt:iv:ciphertext`); a legacy
  `v1` format stays decryptable for in-place upgrades.
- **The key is never written to the database.** It lives only in the deployment
  environment (`process.env`); only derived per-ciphertext AES keys ever touch a
  value, and those are never persisted.
- **No key, no stored credential.** `encryptSecret()` returns `null` when the key
  is unset, and `convex/connections.ts` `requireSecretVault()` throws before
  saving any Plaid/Stripe credential if `isSecretEncryptionConfigured()` is false.
  Running `pnpm setup` mints a correctly sized 32-byte key for you.

**Verify yourself:**
`grep -n "AES-GCM\|deriveHkdfKey\|OPENBOOKS_SECRET_ENCRYPTION_KEY" convex/secretBox.ts`
— confirm the key is derived, never stored, and that `encryptSecret` returns
`null` without a configured key.

## 2. Secrets are never returned to the client

The functions that save and list credentials return only redacted metadata — a
non-reversible fingerprint, a short key preview (e.g. `sk_live_…1234`), and a
status. They never return the plaintext key or token.

- **Where:** `convex/credentials.ts` — the unified bring-your-own-key store. The
  `saveCredential` mutation returns only `{ credentialId, kind, provider,
  keyPreview, fingerprint, status }` (≈ line 236) — no `apiKey`, no
  `secretAccessKey`, no ciphertext. `maskKeyPreview()` (≈ line 77) emits `••••` +
  last-4, and `secretFingerprint()` (≈ line 82) is a one-way SHA-256-derived
  hash.
- The client-facing query `credentialStatus` (≈ line 301) is documented to
  "NEVER return ciphertext or any plaintext secret — only `keyPreview` (last 4)
  and non-secret descriptors", and maps each row to booleans (`hasApiKey`,
  `hasAwsKeys`) derived from presence, never the value. The plaintext lives only
  inside `encryptedPayload` (≈ line 183), which never reaches the client.

**Verify yourself:**
`grep -n "keyPreview\|fingerprint\|maskKeyPreview\|credentialStatus\|encryptedPayload" convex/credentials.ts`
— confirm the returned shapes carry only previews/fingerprints/booleans, and that
the raw secret is written only inside `encryptedPayload` (via `encryptSecret`),
never returned from a public query/mutation.

## 3. Live connectors are supported — and require an HTTPS redirect

Live connectors work locally and in self-host: live Plaid (development/production)
and live Stripe (`sk_live_`/`rk_live_`) keys are permitted. There is **no
sandbox/test-only ban.** The retained guarantee is that live connectors need a
stable HTTPS origin for their OAuth redirect and webhook callbacks — an `http://`
origin cannot safely receive a live bank/payment redirect.

- **Where:** `convex/connections.ts` `stripeRedirectUri()` (≈ line 264) throws
  `"Live Stripe Connect requires an HTTPS redirect URI."` when live mode is
  enabled and the redirect URI is not `https://`. A `*.vercel.app` +
  `*.convex.site` deployment satisfies this out of the box.
- `pnpm preflight` reports live keys as **PASS** (not FAIL) and only INFO-notes
  the HTTPS requirement — see `scripts/preflight.mjs` `classifyStripeKey` /
  `classifyPlaidEnv`.

> Note: this replaces the older "sandbox/test enforcement" claim, which is removed
> because live connectors work locally (decisions.md Q16/Q72). The gate env
> `OPENBOOKS_REAL_TEST_LIVE_CONNECTORS` that still wraps the live-mode paths in
> `connections.ts` is being neutralized by epic E3; the durable guarantee here is
> encryption-at-rest (claim 1) plus this HTTPS-redirect requirement.

**Verify yourself:**
`grep -an "HTTPS redirect\|requires an HTTPS\|sk_live_" convex/connections.ts`
— confirm a live redirect must be HTTPS. (`-a` forces text mode; `connections.ts`
contains a stray control byte that makes plain `grep` skip it.)

## 4. Authorization is re-checked server-side on every function

Workspace/entity authorization is not trusted from the client. Every query,
mutation, and action re-checks the caller's permission on the server before
reading or writing.

- **Where:** `convex/authz.ts` exports `requireUserId`,
  `requireWorkspacePermission`, `requireAnyWorkspacePermission`,
  `requireWorkspaceRole`, and `requireAnyWorkspaceRole`. These are called at the
  top of the data-touching functions across the backend (entities, plaid,
  payroll, settings, team, connections, reset, …).

**Verify yourself:**
`grep -rl "requireWorkspacePermission\|requireAnyWorkspacePermission\|requireWorkspaceRole\|requireUserId" convex/*.ts | grep -v test | wc -l`
— confirm a large set of backend modules import an authz helper (dozens, not a
handful). Then open any public `query`/`mutation` (e.g. `connections.webhookConfig`
which calls `requireAnyWorkspacePermission(ctx, "connections.manage")`) and
confirm the authz call precedes any read.

## 5. No secret or PII is committed to git

The repository must never contain a real secret or private financial record.

- **Where:** `.gitignore` ignores `.env` and `.env.*` (lines 14–18) while
  allowlisting only `.env.example` (placeholders only). `docs/security/secrets.md`
  documents the secret classes and the rotation note (rotate anything pasted into
  chat/screenshots/logs).
- **Automated enforcement:** the secret-scan gate (`pnpm scan:secrets`,
  `scripts/scan-secrets.mjs`) scans the self-host docs, the public web pages, and
  the setup skill for `sk_live_`/`rk_live_`/`sk_test_` key shapes, `whsec_`
  signing secrets, `AKIA…` AWS ids, `sk-…`/`AIza…` AI keys, JWT-shaped blobs, and
  Plaid client_id/secret shapes — plus the owner's personal identifiers — and
  fails on any hit (allowlisting the `.env.example` placeholders). A unit test
  (`tests/scan-secrets.test.ts`) runs the same detectors in `pnpm verify`.

**Verify yourself:**
`git check-ignore .env.local` (prints the path → it is ignored),
`git ls-files | grep -E '^\.env'` (prints only `.env.example`), and
`pnpm scan:secrets` (scans the public surface; exits non-zero on any real key).

---

## What this does NOT claim

- It does not claim a third-party security audit has been performed.
- It does not claim protection against a compromised host: anyone with read access
  to your deployment's environment variables can read
  `OPENBOOKS_SECRET_ENCRYPTION_KEY` and decrypt stored credentials. Protect your
  Convex/Vercel deployment env like the secret it is.
- It is a v1 honest statement, not a full threat model.

_Last verified against the code on the `launch-sprint-build` branch. Re-run the
"verify yourself" commands after any change to `convex/secretBox.ts`,
`convex/connections.ts`, or `convex/authz.ts`._
