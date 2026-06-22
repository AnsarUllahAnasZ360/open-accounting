# Dry-run transcript — openbooks-self-host

One pass of the skill's checklist walked top to bottom against the repo. No
production deploy is executed; account-touching steps are shown as the command an
agent would run after pausing for confirmation. No secret VALUE appears anywhere
(names only), satisfying the skill's prime guardrail.

> This is the recorded evidence for E13-T1's "dry-run of its provisioning flow …
> with no secret printed to logs" deliverable. The two genuinely non-destructive
> commands (`pnpm dev:full --dry-run`, `pnpm preflight`) are real and runnable;
> the account-touching / `--prod` lines are listed but intentionally NOT executed.

## Step 0 — prerequisites gate (read-only)

```
$ node -v && pnpm -v
v20.x.x
10.x.x
$ npx convex --version && vercel --version && gh --version
convex x.y.z
Vercel CLI xx.y.z
gh version x.y.z
# Accounts: GitHub ✓  Convex ✓  Vercel ✓  AI provider (one of aiCatalog.ts's 14) ✓
```

## Step 1 — fork [PAUSE: account-touching — confirm before running]

```
# Would run, after human says "yes":
$ gh repo fork <upstream-owner>/open-accounting --clone
```

## Step 2 — install

```
$ pnpm install
# (already installed in this checkout)
```

## Step 3 — bootstrap env + mint keys (names only)

```
$ pnpm setup --no-convex     # --no-convex keeps the dry run from touching a deployment

| Variable | Result |
|---|---|
| .env.local | SKIP (already present) |
| JWT_PRIVATE_KEY | SKIP (already set) |
| JWKS | SKIP (already set) |
| OPENBOOKS_SECRET_ENCRYPTION_KEY | SKIP (already set) |
| convex env set | SKIP (--no-convex) |

[setup] Done. No secret values were printed above (names only).
```

## Step 4 — create/link Convex dev + push [PAUSE: account-touching]

```
# Would run, after confirmation (creates/links a Convex project on first run):
$ npx convex dev --once
```

## Step 5 — push server secrets (delegated to pnpm setup)

```
# Re-run after linking; names-only output, never echoes a value:
$ pnpm setup
```

## Step 6 — local verify (non-destructive, real output)

```
$ pnpm dev:full --dry-run
[dev:full] dry run
- Convex cloud URL: https://<your-deployment>.convex.cloud
- Next dev URL: http://127.0.0.1:3100
- Would run: pnpm setup (auto-detected incomplete env) [only if env incomplete]
- Would run: npx convex dev --once
- Would run: npx convex run authAdmin:bootstrapOwner
- Would start: npx convex dev
- Would start: pnpm --filter @openbooks/web dev --hostname 127.0.0.1 --port 3100
- Would run: pnpm seed:demo unless OPENBOOKS_SKIP_DEMO_SEED=1

$ pnpm preflight
# provider-aware names-only table; live Plaid/Stripe keys PASS; encryption-at-rest is a hard gate
```

## Step 7 — link Vercel [PAUSE: account-touching]

```
$ vercel link
$ vercel env add NEXT_PUBLIC_CONVEX_URL
```

## Step 8 — production deploy [PAUSE: --prod]

```
$ npx convex deploy            # creates/selects a Convex PROD deployment
$ pnpm setup --prod            # pushes server secrets to PROD (pauses for confirmation)
$ vercel deploy --prod
```

## Step 9 — remaining MANUAL steps (printed for the owner)

1. Paste the AI provider key (and any Plaid/Stripe/Plunk keys) in
   Settings → Connections, or set the env rows.
2. Register the redirect + webhook URLs the in-product **/setup** page shows
   (copy buttons surface the real `connections.webhookConfig` URLs). The Stripe
   webhook is required for a live Stripe connection; capture its `whsec_…`
   secret. `pnpm stripe:webhook:register` automates the registration.
3. Set opening balances and run the first AI review in the app.
