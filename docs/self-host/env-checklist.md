# Environment variable checklist

Every variable OpenBooks reads, where it lives, whether it is required, and where
to get it. This table is machine-checked against `.env.example` and
`scripts/preflight.mjs` by `pnpm check:env-docs` — it cannot silently drift.

**Destinations**

- **Vercel** — a `NEXT_PUBLIC_*` value that ships in the browser bundle; set it in
  your Vercel project (and in `.env.local` for local dev).
- **Convex** — a server-only secret; set it in the Convex deployment env
  (`npx convex env set NAME`, which `pnpm setup` does for you) and in `.env.local`.
- **Local** — used by local scripts/CLI only (`.env.local`); not needed in prod
  hosting.

**Required vs Optional** reflects `scripts/preflight.mjs`'s provider-aware logic:
the AI-provider rows are required **only for the provider you choose** in
`AI_PROVIDER`. Plaid/Stripe/Plunk are optional — you can paste those keys in-app
from Settings → Connections later instead.

> Live connectors are supported (decisions.md Q16): Plaid sandbox **or** live, and
> Stripe test **or** live keys all work. Live keys require a stable HTTPS origin
> for their redirect/webhook (see `/security` and `docs/self-host/prerequisites.md`).

## Core (always required)

| Variable | Required/Optional | Destination | Where to get it |
|---|---|---|---|
| `OWNER_EMAIL` | Required | Convex | You choose — your first owner login email. |
| `OWNER_PASSWORD` | Required | Convex | You choose — a strong password for the owner login. |
| `NEXT_PUBLIC_CONVEX_URL` | Required | Vercel | Printed by `npx convex dev` / `npx convex deploy` (your deployment's client URL). |
| `CONVEX_DEPLOYMENT` | Required | Local | Written by `npx convex dev` into `.env.local` (your deployment slug). |
| `AI_PROVIDER` | Required | Convex | You choose — one of the 14 catalog ids (see `convex/aiCatalog.ts`). |

## Encryption at rest (required before storing any credential)

| Variable | Required/Optional | Destination | Where to get it |
|---|---|---|---|
| `OPENBOOKS_SECRET_ENCRYPTION_KEY` | Required | Convex | Minted by `pnpm setup` (32 random bytes, base64). Never commit it. |
| `OPENBOOKS_TOKEN_ENCRYPTION_KEY` | Optional | Convex | Legacy compatibility name; prefer `OPENBOOKS_SECRET_ENCRYPTION_KEY`. |

## Convex Auth (required)

| Variable | Required/Optional | Destination | Where to get it |
|---|---|---|---|
| `SITE_URL` | Required | Convex | Your app origin (e.g. `http://localhost:3000` locally; your `*.vercel.app` in prod). |
| `JWT_PRIVATE_KEY` | Required | Convex | Minted by `pnpm setup` (RS256 PKCS8 keypair). |
| `JWKS` | Required | Convex | Minted by `pnpm setup` (matching public JWKS). |

## App / Convex wiring

| Variable | Required/Optional | Destination | Where to get it |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Optional | Vercel | Your app's public URL (defaults to `http://localhost:3000`). |
| `NEXT_PUBLIC_APP_NAME` | Optional | Vercel | Display name (defaults to "OpenBooks"). |
| `CONVEX_URL` | Optional | Local | Server-side Convex URL; usually mirrors `NEXT_PUBLIC_CONVEX_URL`. |
| `CONVEX_SITE_URL` | Optional | Local | Convex HTTP-actions origin (`*.convex.site`); injected by Convex, used to show webhook URLs. |

## AI provider — set only the block for your chosen `AI_PROVIDER`

| Variable | Required/Optional | Destination | Where to get it |
|---|---|---|---|
| `AI_MODEL` | Optional | Convex | Model id (required for `bedrock`/`ollama`); otherwise a catalog default is used. |
| `AI_TEMPERATURE` | Optional | Convex | Sampling temperature (defaults to 0.2). |
| `AI_MAX_OUTPUT_TOKENS` | Optional | Convex | Max output tokens (defaults to 2048). |
| `AI_EMBEDDINGS_MODEL` | Optional | Convex | Embeddings model for the memory/recall stage. |
| `AWS_ACCESS_KEY_ID` | Required for `bedrock` | Convex | AWS IAM console — Bedrock-enabled access key. |
| `AWS_SECRET_ACCESS_KEY` | Required for `bedrock` | Convex | AWS IAM console — paired secret. |
| `AWS_REGION` | Required for `bedrock` | Convex | The AWS region where Bedrock is enabled (e.g. `us-east-1`). |
| `OPENAI_API_KEY` | Required for `openai` | Convex | https://platform.openai.com/api-keys |
| `OPENAI_BASE_URL` | Optional | Convex | Override OpenAI base URL (defaults to `https://api.openai.com/v1`). |
| `OPENAI_MODEL` | Optional | Convex | OpenAI model id (otherwise a catalog default). |
| `ANTHROPIC_API_KEY` | Required for `anthropic` | Convex | https://console.anthropic.com/settings/keys |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Required for `google` | Convex | https://aistudio.google.com/apikey |
| `AI_GATEWAY_API_KEY` | Required for `gateway` | Convex | https://vercel.com/docs/ai-gateway |
| `GROQ_API_KEY` | Required for `groq` | Convex | https://console.groq.com/keys |
| `DEEPSEEK_API_KEY` | Required for `deepseek` | Convex | https://platform.deepseek.com/api_keys |
| `MISTRAL_API_KEY` | Required for `mistral` | Convex | https://console.mistral.ai/api-keys |
| `MOONSHOT_API_KEY` | Required for `moonshot` | Convex | https://platform.moonshot.ai/console/api-keys |
| `XAI_API_KEY` | Required for `xai` | Convex | https://console.x.ai |
| `FIREWORKS_API_KEY` | Required for `fireworks` | Convex | https://fireworks.ai/account/api-keys |
| `AZURE_API_KEY` | Required for `azure` | Convex | Azure portal — your Azure OpenAI resource key. |
| `AZURE_BASE_URL` | Required for `azure` | Convex | Azure portal — your Azure OpenAI resource endpoint URL. |
| `OLLAMA_BASE_URL` | Required for `ollama` | Convex | Your local Ollama server URL (defaults to `http://localhost:11434/v1`); no key. |
| `OPENAI_COMPATIBLE_API_KEY` | Required for `openai_compatible` | Convex | Your custom OpenAI-compatible gateway's key. |
| `OPENAI_COMPATIBLE_BASE_URL` | Required for `openai_compatible` | Convex | Your custom OpenAI-compatible gateway's base URL. |

## Plaid (optional — or paste in-app from Settings → Connections)

| Variable | Required/Optional | Destination | Where to get it |
|---|---|---|---|
| `PLAID_CLIENT_ID` | Optional | Convex | https://dashboard.plaid.com — your client id. |
| `PLAID_SECRET` | Optional | Convex | Plaid dashboard — the secret for your chosen `PLAID_ENV`. |
| `PLAID_ENV` | Optional | Convex | `sandbox`, `development`, or `production`. |
| `PLAID_OAUTH_REDIRECT_URI` | Optional | Convex | Your `https://…/settings/connections/plaid/callback`, registered in Plaid. |
| `PLAID_WEBHOOK_URL` | Optional | Convex | Your `https://<deployment>.convex.site/plaid/webhook` (shown on `/setup`). |

## Stripe (optional — or paste in-app from Settings → Connections)

| Variable | Required/Optional | Destination | Where to get it |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Optional | Convex | https://dashboard.stripe.com/apikeys — test (`sk_test_`) or live (`sk_live_`). |
| `STRIPE_WEBHOOK_SECRET` | Optional | Convex | The `whsec_…` from registering your Stripe webhook endpoint (required for a live Stripe connection). |

## Plunk email (optional)

| Variable | Required/Optional | Destination | Where to get it |
|---|---|---|---|
| `PLUNK_API_BASE_URL` | Optional | Convex | Your Plunk instance base URL (defaults to the hosted Plunk). |
| `NEXT_PUBLIC_PLUNK_PUBLIC_KEY` | Optional | Vercel | Plunk dashboard — public key. |
| `PLUNK_SECRET_KEY` | Optional | Convex | Plunk dashboard — secret key (enables request-access + digest emails). |
| `PLUNK_FROM_EMAIL` | Optional | Convex | The from-address for outbound email. |
| `PLUNK_FROM_NAME` | Optional | Convex | The from-name for outbound email (defaults to "OpenBooks"). |

## Dev / guard flags

| Variable | Required/Optional | Destination | Where to get it |
|---|---|---|---|
| `OPENBOOKS_REAL_TEST_LIVE_CONNECTORS` | Optional | Convex | Set to `1` only to allow live Plaid/Stripe modes in this deployment. |

---

## The irreducible manual steps

After `pnpm setup` mints the keys above, only a few items genuinely need you:

1. **Paste your AI provider key** (the row required for your `AI_PROVIDER`).
2. **Paste Plaid and/or Stripe keys** in Settings → Connections (or set the env rows).
3. **Register the redirect + webhook URLs** shown on the in-product `/setup` page in
   your Plaid and Stripe dashboards — the Stripe webhook is **required** for a live
   Stripe connection to report "listening".
