# E13 self-host validation evidence (batch A32)

End-to-end validation that the documented self-host path works for a fresh
self-hoster and that every gate is green. Captured 2026-06-20 on branch
`launch-sprint-build`.

## What was validated

The E13 self-host path: `pnpm setup` mints keys + writes `.env.local`,
`pnpm dev:full` auto-runs setup when the env is incomplete, `pnpm preflight` is
provider-aware (an OpenAI self-hoster is never asked for AWS keys; live keys
PASS), the secret-scan + env-docs gates hold, and the public `/setup` + `/security`
routes render. The ledger/money-math path is untouched.

## Gate results (all green)

| Gate | Command | Result |
|---|---|---|
| Web typecheck + lint + build + unit | `pnpm verify` | PASS — 95 test files, 559 tests, exit 0; `/setup` and `/security` appear in the prerendered route manifest |
| Convex typecheck + push | `npx convex dev --once` | PASS — "Convex functions ready!" (exit 0) |
| Env-docs in sync | `node scripts/check-env-docs.mjs` | PASS — 51 variables documented; checklist in sync with `.env.example` + preflight |
| No secret/PII in public files | `node scripts/scan-secrets.mjs` | PASS — 26 tracked public files scanned; no secret/PII shapes |
| No-ledger-touch invariant | `git diff --stat -- convex/ledger.ts` | EMPTY — `convex/ledger.ts` and money-math untouched by E13 |

### Secret-scan gate is real (planted-secret test)

Planting `STRIPE_SECRET_KEY=sk_live_…` in a self-host doc makes
`node scripts/scan-secrets.mjs` exit non-zero and name the offending file+line;
removing it returns exit 0. (Also covered by `tests/scan-secrets.test.ts` in the
unit gate.)

## Preflight is provider-aware + live-key tolerant (E13-T4 exercised)

With `AI_PROVIDER=openai` and only an OpenAI key set, preflight's required-env
check PASSES with no Bedrock FAIL:

```
| Required env names | PASS | all required names present (provider=openai) |
| Encryption at rest | PASS | OPENBOOKS_SECRET_ENCRYPTION_KEY set |
```

Pre-network classification (unit-checked via the exported helpers):

- `providerRequiredEnv({AI_PROVIDER:"openai"})` → `["OPENAI_API_KEY"]` (no AWS).
- `providerRequiredEnv({AI_PROVIDER:"bedrock"})` → AWS keys + `AI_MODEL`.
- `classifyStripeKey("sk_live_…")` → `{status:"PASS", live:true}` (live keys PASS).
- `classifyStripeKey("")` / `classifyPlaidEnv({})` → `SKIP` (absent = skip, not fail).

## dev:full setup mode (E13-T3 exercised)

`pnpm dev:full --dry-run` on an incomplete env lists the setup step first:

```
[dev:full] dry run
- Would run FIRST: pnpm setup (missing .env.local or required env detected)
- Would run: npx convex dev --once
- Would run: npx convex run authAdmin:bootstrapOwner
- Would start: npx convex dev
- Would start: pnpm --filter @openbooks/web dev --hostname 127.0.0.1 --port 3100
```

`assertCloudConvex("")` now throws a message that names `pnpm setup` (not a bare
requirement error); a self-hoster's own non-localhost cloud Convex URL passes;
localhost is still rejected. (Unit-checked in `tests/dev-full-setup.test.ts`.)

## Public routes render (E13-T5 / E13-T7)

A plain Next dev server (`pnpm --filter @openbooks/web dev`) was launched against
the dev Convex deployment. Both routes serve and render the expected
design-system content:

- `GET /setup` → HTTP 200. Rendered content includes "Set up OpenBooks",
  "Register the redirect…", the four copyable endpoint rows
  (`setup-endpoint-stripe-webhook-url`, `…-plaid-webhook-url`,
  `…-plaid-redirect-uri`, `…-stripe-redirect-uri`), and "Deploy your own". No
  `gradient` class and no emoji in the markup.
- `GET /security` → HTTP 200. Renders "Security posture" / "encrypted at rest".

> Screenshot capture via the browser-automation tooling was not functional in
> this sandbox session (the headless daemon was unresponsive). The render proof
> above is the curl/build-manifest substitute; the routes are statically
> prerendered (build manifest) and serve HTTP 200 with the correct content and no
> design-system violations.

## Residual manual steps (genuinely need the owner)

These are the irreducible items the docs/`/setup` page surface — they cannot be
automated:

1. Paste the AI provider key (the row required for the chosen `AI_PROVIDER`) — and
   optionally Plaid/Stripe/Plunk keys — in Settings → Connections.
2. Register the redirect + webhook URLs (shown on `/setup` with copy buttons) in
   the Plaid and Stripe dashboards. The Stripe webhook is REQUIRED for a live
   Stripe connection to report "listening"; capture its `whsec_…` signing secret.
3. Set opening balances and run the first AI review inside the app.

## Open questions filed back to other epics

- The hosted Plaid Link + real Stripe webhook delivery proofs require
  Ansar-side inputs (a completed hosted Link session, a real webhook to the cloud
  route) and remain external — unchanged by E13. The webhook implementation
  itself is owned by E3.
- A latent pre-existing bug noted while reading `convex/connections.ts`: line 352
  contains a stray NUL byte inside an empty-string default (`?? "\0"` instead of
  `?? ""`) in the `connections:list` Stripe-account matcher (committed in batch
  A5). It is outside E13's scope (an E3 file) and does not affect the gates, but
  should be fixed in an E3 follow-up.
