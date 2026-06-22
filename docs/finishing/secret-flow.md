# Secret flow — encrypt → store → decrypt server-only → never return

> Scope: every BYO secret in OpenBooks (AI provider keys, Plaid client/secret,
> Stripe restricted keys, Stripe/Plaid webhook secrets, Plunk keys, access
> tokens). Authored for E3-T10. No secret values appear in this doc.

## The one rule

A plaintext secret is encrypted the moment it arrives, stored only as an opaque
ciphertext blob, decrypted only inside server-side code that needs it, and is
**never** returned to the client or embedded in a thrown error / audit summary.
The client only ever sees a redacted preview (`keyPreview` / `lastFour`), a
non-secret descriptor (model id, from-email, base URL, region), and a status.

## Where each secret is encrypted

- **AI keys / Bedrock access-key pair / base URL** — `convex/credentials.ts`
  `saveCredential` (`kind:"ai"`). The whole payload object is JSON-serialized and
  encrypted with `secretBox.encryptSecret` into `credentials.encryptedPayload`.
- **Plunk key** — `convex/plunk.ts` `savePlunkCredential` → routes through the
  same `saveCredential` (`kind:"plunk"`). `fromEmail`/`fromName` are non-secret
  columns; the key is inside `encryptedPayload`.
- **Plaid app (client id + secret)** and **Stripe (restricted key + webhook
  secret)** — `convex/connections.ts` `upsertConnectionCredential` →
  `connectionCredentials.encryptedPayload`.

The encryption primitive is `convex/secretBox.ts` (AES-GCM with an HKDF-derived
32-byte key from `OPENBOOKS_SECRET_ENCRYPTION_KEY`). Saving without the env key
configured throws a clear `ConvexError` naming the variable — it never falls back
to storing plaintext.

## Where each secret is decrypted (server-side only)

- AI runtimes: `aiResolve.resolveActiveAiModel` → `aiProvider.decryptCredentialRow`,
  consumed by `aiSdkRuntime`, the categorizer, and chat. The decrypted key lives
  only in the action's memory for the duration of the call.
- Plunk senders: `plunk.resolvePlunkConfig` (internal action) decrypts the BYO
  key, preferring it over `PLUNK_SECRET_KEY`.
- Plaid/Stripe: `connections.resolvePlaidCredentialForEntity` /
  `resolveStripeCredentialForEntity` (internal actions) decrypt on demand for an
  API call or a webhook-signature check.

All decrypt paths are `internalQuery`/`internalAction` — unreachable from the
client.

## How the never-return rule is enforced

- **Client queries return redacted shapes only.** `credentials.credentialStatus`,
  `plunk.plunkStatus`, `connections.list`, `connections.health`, and
  `ai.providerStatus` return `keyPreview`/`lastFour`/booleans/status — never
  `encryptedPayload` or a raw key. `getActiveCredential` (which returns the raw
  Doc) is `internalQuery`.
- **Errors are redacted.** `convex/secretRedaction.ts` (`redactSecrets` /
  `safeErrorMessage`) strips every env secret plus any runtime-resolved key
  passed as `extra` from a thrown message, single-lines it, and caps length. Used
  by `aiSdkRuntime` (AI probe), `connections.validateStripeCredential`, and the
  Stripe key path. The Plunk and Plaid probes return generic messages that never
  include the key.

## Tests that hold the line

- `convex/secretSafety.test.ts` — enumerates the return objects of every
  integration status/list query and asserts no raw secret value and no
  ciphertext/secret **field name** is present; asserts the redaction helper
  scrubs a key from a thrown message; and a source-level gate that fails if a
  client status return type ever names a ciphertext field.
- `convex/credentials.test.ts`, `convex/plunk.test.ts`,
  `convex/connections.test.ts`, `convex/connectionsHealth.test.ts` — assert
  encrypt-at-rest, redacted previews, and no-leak on each provider surface.
