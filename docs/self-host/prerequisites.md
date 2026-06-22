# Self-host prerequisites

What you need before you run your own OpenBooks. Budget about 15 minutes to gather
keys; the actual install is a handful of commands (see `docs/self-host/` and the
in-product `/setup` page). For the exact variable-by-variable list, see
[env-checklist.md](./env-checklist.md).

## Accounts

| Account | Why | Required? |
|---|---|---|
| GitHub | Fork/clone the repo. | Required |
| Convex | Backend: database, functions, jobs, auth, HTTP webhooks. Free tier is fine to start. | Required |
| Vercel | Host the Next.js web app. (Self-hosting the web app elsewhere also works.) | Required |
| An AI provider | The AI bookkeeper runs on your own key. Pick any one of the 14 in `convex/aiCatalog.ts` (OpenAI, Anthropic, Google, Bedrock, Groq, Ollama-local, …). | Required |
| Plaid | Bank sync. | Optional (CSV import works without it) |
| Stripe | Payment/payout reconciliation. | Optional |
| Plunk | Transactional email (request-access, weekly digest). | Optional |

## Tools / versions

| Tool | Version | Check |
|---|---|---|
| Node.js | 20+ | `node -v` |
| pnpm | 10.x | `pnpm -v` |
| Convex CLI | latest (via `npx convex`) | `npx convex --version` |
| Vercel CLI | latest | `vercel --version` |
| GitHub CLI (optional, for the setup skill) | latest | `gh --version` |

## ~15-minute key-gathering checklist

You can also skip all of this at install time and paste keys later from
**Settings → Connections** inside the app — the encrypted vault is wired so any of
these can be added after first boot.

1. **AI provider key (required).** Generate a key for the provider you chose in
   `AI_PROVIDER`. Each provider's key page is linked in
   [env-checklist.md](./env-checklist.md) (e.g. OpenAI → platform.openai.com,
   Anthropic → console.anthropic.com, Bedrock → AWS IAM + region). Local Ollama
   needs only a base URL, no key.
2. **Plaid keys (optional).** From dashboard.plaid.com, copy your `client_id` and
   the secret for your chosen environment. **Sandbox or live both work** — live
   (development/production) is supported (decisions.md Q16), it just requires a
   stable HTTPS origin for the OAuth redirect.
3. **Stripe secret key (optional).** From dashboard.stripe.com/apikeys, copy a
   secret key. **Test (`sk_test_`) or live (`sk_live_`) both work.** A live Stripe
   connection additionally requires registering the webhook endpoint and capturing
   its `whsec_…` signing secret (the `/setup` page shows the exact URL).
4. **Plunk key (optional).** From your Plunk dashboard, copy the secret key if you
   want OpenBooks to send request-access notifications and the weekly digest.

## Live connectors and HTTPS

Live connectors work locally and in self-host — there is no sandbox/test-only ban
(decisions.md Q16 / Q72). The retained guarantees are:

- **Encryption at rest** — `OPENBOOKS_SECRET_ENCRYPTION_KEY` must be set before any
  credential can be stored (`pnpm setup` mints it). See `/security`.
- **HTTPS redirect for live keys** — live Plaid/Stripe need a stable HTTPS origin
  for their redirect/webhook URLs. A `*.vercel.app` web app + `*.convex.site`
  webhook origin satisfy this with no custom domain required.

## Next

- Mint keys + bootstrap: `pnpm setup` (writes `.env.local`, mints the JWT keypair +
  encryption key, pushes server secrets to Convex).
- Verify: `pnpm preflight` (provider-aware — an OpenAI self-hoster is never asked
  for AWS keys; live Plaid/Stripe keys PASS).
- The full variable list with destinations: [env-checklist.md](./env-checklist.md).
