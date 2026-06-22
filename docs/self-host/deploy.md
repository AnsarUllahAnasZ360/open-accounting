# Deploy your own OpenBooks (production)

A generic, placeholder-only runbook for taking your local OpenBooks to a public
production deployment: a Convex **prod** deployment for the backend + a Vercel
**prod** deployment for the web app. No owner-specific account ids or URLs appear
here — substitute your own everywhere you see `<your-…>`.

Prerequisites and the per-variable destination map live in
[prerequisites.md](./prerequisites.md) and [env-checklist.md](./env-checklist.md).
For an AI agent to drive this end to end (pausing before every account-touching
step), use the `skills/openbooks-self-host/` skill.

> Live connectors are supported in production (decisions.md Q16). The retained
> guarantees are encryption-at-rest and a stable HTTPS origin for live
> redirect/webhook URLs — a `*.vercel.app` app + `*.convex.site` webhook origin
> satisfy this with no custom domain required. See [`/security`](../security/security-posture.md).

## 1. Create the Convex production deployment

```bash
npx convex deploy
```

First run creates (or selects) a **production** Convex deployment and prints its
client URL (`https://<your-deployment>.convex.cloud`) and HTTP-actions origin
(`https://<your-deployment>.convex.site`). Note both; you will register the
`.convex.site` webhook URLs in Plaid/Stripe.

## 2. Set server secrets in Convex prod

Server-only secrets belong in Convex (every Plaid/Stripe/AI/Plunk/auth call runs
in a Convex function). The fastest path is to let `pnpm setup` push them:

```bash
pnpm setup --prod      # pauses for explicit confirmation before any prod write
```

`pnpm setup --prod` reads `.env.local` and runs `npx convex env set --prod NAME`
for each server-only name (the auth keypair + JWKS, `OPENBOOKS_SECRET_ENCRYPTION_KEY`,
`SITE_URL`, and whatever AI/Plaid/Stripe/Plunk keys you have set). It never echoes
a value and pauses before writing to prod. To set one by hand:

```bash
npx convex env set --prod SITE_URL https://<your-app>
```

`SITE_URL` should be your public app origin (your `*.vercel.app` URL or a custom
domain). `OPENBOOKS_SECRET_ENCRYPTION_KEY` MUST be set before any credential can
be stored — without it, saving a Plaid/Stripe/AI key fails by design.

## 3. Deploy the web app to Vercel

Only ONE frontend-safe variable goes in Vercel — the Convex client URL. Everything
else is a server secret and stays in Convex.

```bash
vercel link                                  # link to your own Vercel project
vercel env add NEXT_PUBLIC_CONVEX_URL        # paste https://<your-deployment>.convex.cloud
vercel deploy --prod                         # deploy the web app
```

(Optional) Attach a custom domain in your Vercel project's Domains settings and
point DNS at the `A`/`CNAME` record Vercel provides. A `*.vercel.app` URL works
without any custom domain.

## 4. Register the Stripe webhook (required for a live Stripe connection)

A live Stripe connection does NOT report "listening" until its webhook is
verified. After deploy, register the endpoint and capture its signing secret:

```bash
pnpm stripe:webhook:register
```

This reads `STRIPE_SECRET_KEY` from your env, registers the
`https://<your-deployment>.convex.site/stripe/webhook` endpoint with the events
OpenBooks consumes, and prints the `whsec_…` signing secret. Set it in Convex:

```bash
npx convex env set --prod STRIPE_WEBHOOK_SECRET <whsec_…>
```

The same webhook + redirect URLs are shown with copy buttons on the in-product
**/setup** page once you are signed in as the owner.

## 5. Post-deploy checklist

- [ ] `pnpm preflight` passes against your prod env (provider-aware; live keys PASS).
- [ ] `OPENBOOKS_SECRET_ENCRYPTION_KEY` is set in Convex prod.
- [ ] `NEXT_PUBLIC_CONVEX_URL` is the only secret in Vercel.
- [ ] Plaid redirect URI + webhook URL registered in the Plaid dashboard.
- [ ] Stripe webhook registered and `STRIPE_WEBHOOK_SECRET` set (for live Stripe).
- [ ] Sign in, paste your AI key in Settings → Connections, set opening balances,
      run the first AI review.

## Reference

The project owner's own (non-generic) production runbooks are kept for the
maintainer only and are clearly labeled — do NOT copy their values:
`docs/deployment/vercel.md`, `docs/deployment/convex-auth-plunk.md`. This generic
guide is the one to follow for your own deployment.
