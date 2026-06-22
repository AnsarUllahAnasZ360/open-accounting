# Env map (self-host quick reference)

Compact destination + required/optional map for every OpenBooks env variable, for
the `openbooks-self-host` skill. The authoritative, machine-checked version is
[`docs/self-host/env-checklist.md`](../../../docs/self-host/env-checklist.md),
which `pnpm check:env-docs` (`scripts/check-env-docs.mjs`) cross-checks against
`.env.example` and `scripts/preflight.mjs`. Keep this file in sync with that
checklist; if they drift, the checklist wins.

**Destinations**

- **Convex** — server-only secret; set via `npx convex env set NAME` (which
  `pnpm setup` does) and in `.env.local`. Never ships to the browser.
- **Vercel** — a `NEXT_PUBLIC_*` value in the browser bundle; set in the Vercel
  project (and `.env.local` for local dev).
- **Local** — used only by local scripts/CLI (`.env.local`); not needed in prod.

**Required vs Optional** mirrors preflight's provider-aware logic: AI-provider
rows are required ONLY for the provider chosen in `AI_PROVIDER`. Plaid/Stripe/Plunk
are optional — paste those in-app from Settings → Connections later.

> Live connectors are supported (decisions.md Q16): Plaid sandbox **or** live and
> Stripe test **or** live keys all work. Live keys require a stable HTTPS origin
> for the redirect/webhook (a `*.vercel.app` app + `*.convex.site` webhook origin
> satisfy this with no custom domain).

## Core (always required)

| Variable | Req | Destination |
|---|---|---|
| `OWNER_EMAIL` | Required | Convex |
| `OWNER_PASSWORD` | Required | Convex |
| `NEXT_PUBLIC_CONVEX_URL` | Required | Vercel |
| `CONVEX_DEPLOYMENT` | Required | Local |
| `AI_PROVIDER` | Required | Convex |

## Encryption at rest (hard gate — `pnpm setup` mints it)

| Variable | Req | Destination |
|---|---|---|
| `OPENBOOKS_SECRET_ENCRYPTION_KEY` | Required | Convex |
| `OPENBOOKS_TOKEN_ENCRYPTION_KEY` | Optional (legacy name) | Convex |

## Convex Auth (`pnpm setup` mints the keypair)

| Variable | Req | Destination |
|---|---|---|
| `SITE_URL` | Required | Convex |
| `JWT_PRIVATE_KEY` | Required | Convex |
| `JWKS` | Required | Convex |

## AI provider — set only the block for your chosen `AI_PROVIDER`

| Variable | Req | Destination |
|---|---|---|
| `AI_MODEL` | Required for `bedrock`/`ollama`, else optional | Convex |
| `AI_EMBEDDINGS_MODEL` | Optional | Convex |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` | Required for `bedrock` | Convex |
| `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL` / `OPENAI_MODEL`) | Required for `openai` | Convex |
| `ANTHROPIC_API_KEY` | Required for `anthropic` | Convex |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Required for `google` | Convex |
| `AI_GATEWAY_API_KEY` | Required for `gateway` | Convex |
| `GROQ_API_KEY` | Required for `groq` | Convex |
| `DEEPSEEK_API_KEY` | Required for `deepseek` | Convex |
| `MISTRAL_API_KEY` | Required for `mistral` | Convex |
| `MOONSHOT_API_KEY` | Required for `moonshot` | Convex |
| `XAI_API_KEY` | Required for `xai` | Convex |
| `FIREWORKS_API_KEY` | Required for `fireworks` | Convex |
| `AZURE_API_KEY` / `AZURE_BASE_URL` | Required for `azure` | Convex |
| `OLLAMA_BASE_URL` | Required for `ollama` (no key) | Convex |
| `OPENAI_COMPATIBLE_API_KEY` / `OPENAI_COMPATIBLE_BASE_URL` | Required for `openai_compatible` | Convex |

## Plaid / Stripe / Plunk (optional — or paste in-app)

| Variable | Req | Destination |
|---|---|---|
| `PLAID_CLIENT_ID` / `PLAID_SECRET` / `PLAID_ENV` | Optional | Convex |
| `PLAID_OAUTH_REDIRECT_URI` / `PLAID_WEBHOOK_URL` | Optional | Convex |
| `STRIPE_SECRET_KEY` | Optional | Convex |
| `STRIPE_WEBHOOK_SECRET` (`whsec_…`) | Optional (required for live Stripe) | Convex |
| `PLUNK_SECRET_KEY` / `PLUNK_FROM_EMAIL` / `PLUNK_FROM_NAME` / `PLUNK_API_BASE_URL` | Optional | Convex |
| `NEXT_PUBLIC_PLUNK_PUBLIC_KEY` | Optional | Vercel |

## App wiring / dev flags

| Variable | Req | Destination |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_APP_NAME` | Optional | Vercel |
| `CONVEX_URL` / `CONVEX_SITE_URL` | Optional | Local |
| `AI_TEMPERATURE` / `AI_MAX_OUTPUT_TOKENS` | Optional | Convex |
| `OPENBOOKS_REAL_TEST_LIVE_CONNECTORS` | Optional (`1` to allow live modes) | Convex |

## The irreducible manual steps

1. Paste your AI provider key (the row required for your `AI_PROVIDER`).
2. Paste Plaid and/or Stripe keys in Settings → Connections (or set the env rows).
3. Register the redirect + webhook URLs shown on the in-product `/setup` page in
   your Plaid/Stripe dashboards. The Stripe webhook is **required** for a live
   Stripe connection to report "listening"; capture its `whsec_…` secret.
