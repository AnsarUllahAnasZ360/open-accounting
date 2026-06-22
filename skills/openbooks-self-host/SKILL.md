---
name: openbooks-self-host
description: >-
  Deterministic, resumable recipe for an AI coding agent to self-host OpenBooks —
  fork + clone the repo, install, mint keys, link a Convex project, run locally,
  and deploy to Convex prod + Vercel prod. Use when the user says "self-host
  OpenBooks", "deploy OpenBooks", "set up my own OpenBooks", or "run OpenBooks on
  my own infrastructure". Orchestrate-and-pause-for-confirmation; never fully
  auto-provision.
---

# Self-host OpenBooks

Use this skill to stand up a user's **own** OpenBooks instance end to end. You are
the orchestrator: you run the deterministic commands and **pause for the human**
before any step that touches an account (GitHub fork, Convex project create,
Vercel link, any `--prod` deploy). You never fully auto-provision.

OpenBooks is free, open-source, bring-your-own-keys bookkeeping. The whole point
of self-hosting is that the owner's bank tokens and API keys live in *their*
Convex/Vercel deployment, encrypted at rest. Treat that trust as the prime
directive.

## Hard guardrails (read before doing anything)

1. **Never echo a secret VALUE** to the transcript, a log, or a commit. JWT keys,
   the encryption key, Plaid/Stripe/AI/Plunk secrets — refer to them by NAME
   only. `pnpm setup` and `scripts/preflight.mjs` already print names-only
   tables; mirror that discipline in everything you say.
2. **Never commit a secret.** `.env.local` is gitignored; keep it that way. Only
   `.env.example` (placeholders) is tracked. If you ever generate a key, it goes
   into `.env.local` or the Convex/Vercel env store — never into a tracked file.
3. **Pause for explicit human confirmation** before EVERY account-touching or
   `--prod` step: `gh repo fork`, `npx convex dev` (creates/links a project),
   `vercel link`, `npx convex deploy`, `vercel deploy --prod`,
   `pnpm setup --prod`. State exactly what the command will create/change and
   wait for a "yes".
4. **Live connectors are permitted** locally and in self-host. Do NOT tell the
   user they must use Plaid sandbox or Stripe test keys — live Plaid
   (development/production) and live Stripe (`sk_live_`) keys are supported
   (decisions.md Q16). The retained guarantee is encryption-at-rest plus a stable
   HTTPS origin for live redirect/webhook URLs, not a sandbox/test ban. See
   `/security` and `docs/security/security-posture.md`.
5. **Do not reinvent commands.** Every shell step below maps to a real script in
   `scripts/` or a documented CLI. If a step seems to need a new script, stop and
   ask — do not improvise provisioning logic.

## Prerequisites gate (step 0)

Confirm, before touching anything:

- `node -v` ≥ 20, `pnpm -v` is 10.x.
- CLIs installed and authenticated: `gh auth status`, `vercel whoami`,
  `npx convex --version`.
- Accounts exist: GitHub, Convex, Vercel, and one AI provider from the
  14-provider catalog (`convex/aiCatalog.ts`). Plaid / Stripe / Plunk are
  optional and can be pasted in-app later.

Full account + version list: `docs/self-host/prerequisites.md`. Full per-variable
destination map: `docs/self-host/env-checklist.md` and this skill's
[`reference/env-map.md`](reference/env-map.md).

## The ordered, resumable checklist

Run these in order. Each step is idempotent or safe to re-run, so if you are
resuming a partial session, re-check the step's success condition before
repeating it. **Steps marked [PAUSE] require human confirmation first.**

1. **Fork the repo** [PAUSE — account-touching].
   ```bash
   gh repo fork <upstream-owner>/open-accounting --clone
   ```
   Ask first; this creates a repo under the user's GitHub account. If they
   already forked/cloned, skip to step 2 in that directory.

2. **Install dependencies.**
   ```bash
   pnpm install
   ```

3. **Bootstrap env + mint keys.**
   ```bash
   pnpm setup
   ```
   Runs `scripts/setup.mjs`: writes `.env.local` from `.env.example` (never
   clobbering a non-empty value), mints the Convex Auth RS256 JWT keypair + JWKS,
   mints `OPENBOOKS_SECRET_ENCRYPTION_KEY` (the key
   `convex/secretBox.ts` needs before any credential can be stored), and pushes
   server-only secrets to the Convex dev deployment. It prints a names-only
   PASS/SET/SKIP table. Now have the user fill in `OWNER_EMAIL`,
   `OWNER_PASSWORD`, `AI_PROVIDER`, and their AI provider key in `.env.local`,
   then re-run `pnpm setup` to push the new server secrets.

4. **Create/link a Convex dev project and push functions** [PAUSE — account-touching].
   ```bash
   npx convex dev --once
   ```
   First run creates or links a Convex project (account-touching — confirm
   first) and writes `CONVEX_DEPLOYMENT` + `NEXT_PUBLIC_CONVEX_URL` into
   `.env.local`. Re-run `pnpm setup` afterward so the freshly-linked deployment
   receives the server secrets.

5. **Push server secrets to Convex** (delegated to step 3's `pnpm setup`). If you
   added keys after linking, re-run `pnpm setup`; it calls
   `npx convex env set NAME` per server-only name, reading values from
   `.env.local` and never echoing them.

6. **Run locally and verify.**
   ```bash
   pnpm preflight     # provider-aware env + reachability check (names only)
   pnpm dev:full      # pushes Convex once, boots Next on :3100, dev owner sign-in
   ```
   `pnpm dev:full` auto-detects a missing/incomplete `.env.local` and runs setup
   first. Open the printed URL → "Continue as owner (dev)". Confirm a Plaid or
   Stripe key saves in Settings → Connections (proves the encryption key is live).

7. **Link the Vercel project** [PAUSE — account-touching].
   ```bash
   vercel link
   ```
   Then set the one frontend-safe variable in Vercel (server secrets stay in
   Convex):
   ```bash
   vercel env add NEXT_PUBLIC_CONVEX_URL
   ```

8. **Deploy to production** [PAUSE — `--prod`].
   ```bash
   npx convex deploy            # creates/selects a Convex PROD deployment
   pnpm setup --prod            # pushes server secrets to PROD (pauses for confirmation)
   vercel deploy --prod         # deploys the web app
   ```
   Confirm each with the human first. Full generic runbook:
   `docs/self-host/deploy.md`.

9. **Print the 2-3 remaining MANUAL steps** (these genuinely need the owner):
   - Paste the AI provider key (and any Plaid/Stripe/Plunk keys) in
     **Settings → Connections** — or set the env rows.
   - **Register the redirect + webhook URLs** the in-product **/setup** page
     shows (copy buttons surface the real `stripeWebhookUrl`, `plaidWebhookUrl`,
     `plaidRedirectUri`, `stripeRedirectUri` from `connections.webhookConfig`).
     The Stripe webhook is **required** for a live Stripe connection to report
     "listening"; capture its `whsec_…` signing secret. Post-deploy you can run
     `pnpm stripe:webhook:register` (`scripts/register-stripe-webhook.mjs`) to
     register the endpoint and capture the secret.
   - Set opening balances and run the first AI review inside the app.

## Scripts this skill orchestrates (all exist in `scripts/`)

| Command | Script | What it does |
|---|---|---|
| `pnpm setup` | `scripts/setup.mjs` | Write `.env.local`, mint JWT keypair/JWKS + encryption key, `convex env set` server secrets (names only). |
| `pnpm preflight` | `scripts/preflight.mjs` | Provider-aware required-env + reachability check; live keys PASS; encryption-at-rest is a hard gate. |
| `pnpm dev:full` | `scripts/dev-full.mjs` | One-command local boot (auto-runs setup if env is incomplete). |
| `pnpm stripe:webhook:register` | `scripts/register-stripe-webhook.mjs` | Register the Stripe webhook endpoint post-deploy and capture its signing secret. |
| `pnpm check:env-docs` | `scripts/check-env-docs.mjs` | Assert the env checklist stays in sync with `.env.example` + preflight. |

Do not invent commands beyond these. If something is missing, pause and ask.

## Where to read more

- `docs/self-host/prerequisites.md` — accounts, CLIs, versions, key-gathering.
- `docs/self-host/env-checklist.md` — every variable, required/optional, Vercel vs
  Convex destination, where to get it.
- `docs/self-host/deploy.md` — generic Convex-prod + Vercel-prod + Stripe-webhook
  runbook (placeholder-only; no owner-specific values).
- `docs/security/security-posture.md` and `/security` — the trust artifact to read
  before pasting any secret.
- `reference/env-map.md` (this skill) — compact env destination/required map.
