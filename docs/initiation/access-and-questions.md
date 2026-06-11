# Pre-Launch Runbook & Decision Log

Date: 2026-06-11 (rev 2)
Audience: Ansar (sections 1–3 are the ~15 minutes of prep you do before
launching the goal). Codex treats §3 as the env contract and §4 as answered
decisions — do not re-ask these.

---

## 1. Get your keys (one-time, ~15 minutes)

### Plaid sandbox (free, no approval needed)

1. Go to `https://dashboard.plaid.com` → sign up (or sign in).
2. Left nav → **Developers → Keys**.
3. Copy **client_id** and the **Sandbox** secret (not Development/Production).
4. That's it — sandbox works immediately. In the app's Plaid Link flow, the
   test bank login is `user_good` / `pass_good` (Codex will also configure a
   custom sandbox user for richer data).

### Stripe test mode (from your existing Stripe account)

1. Go to `https://dashboard.stripe.com` → toggle **Test mode** (top right).
2. **Developers → API keys** → copy the **Secret key** (starts `sk_test_`).
   Use the full test secret key, not a restricted key: during the run Codex
   also *seeds* the test account (creates customers, payment intents,
   products/prices, invoices, and attempts a manual test payout), which most
   restricted keys can't do. This is test mode — no real money exists.
3. Webhook signing secret: leave blank — Codex registers the webhook endpoint
   via API during the run and captures the secret itself.

### Domain (2-minute check)

1. In Vercel → your account → **Domains**: confirm `ansarullahanas.com` is
   managed there (you said it is). Codex will attach the
   `openbooks.ansarullahanas.com` subdomain to the project during M12.
2. If the domain is NOT on Vercel DNS, the run still completes — the morning
   walkthrough uses the `*.vercel.app` production URL recorded in the
   completion report, and you add a CNAME afterwards.

### AWS Bedrock (you already have creds in `env.local`)

1. Confirm the AWS keys in `env.local` belong to an account with **Bedrock
   model access enabled** in the region set in `AWS_REGION` — check AWS
   Console → Bedrock → Model access. Enable a Claude model (chat +
   categorization) and `amazon.titan-embed-text-v2:0` (embeddings) if not
   already enabled.
2. Set `AI_MODEL` to the Bedrock model id you enabled (the value already in
   `env.local` is used as-is if present).

## 2. Paste keys into `.env.local` (the ONE file you touch)

Append/fill these lines in `/Users/ansarullahanas/Documents/OpenBooks/.env.local`
(this file is git-ignored; `env.local` is only a reference copy):

```bash
# Owner / access — set BOTH so the morning login needs no secret handoff
OWNER_EMAIL=ansarullahanas3@gmail.com
OWNER_PASSWORD=...        # choose your login password now; M2 seeds it

# Plaid (sandbox only)
PLAID_CLIENT_ID=...        # from dashboard.plaid.com → Developers → Keys
PLAID_SECRET=...           # the SANDBOX secret
PLAID_ENV=sandbox

# Stripe (test mode only)
STRIPE_SECRET_KEY=sk_test_...   # or rk_test_...
STRIPE_WEBHOOK_SECRET=          # leave blank; Codex captures it during the run

# AI — AWS Bedrock (copy values from env.local)
AI_PROVIDER=bedrock
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=...             # region with Bedrock model access
AI_MODEL=...               # Bedrock model id for chat + categorization
AI_EMBEDDINGS_MODEL=amazon.titan-embed-text-v2:0

# Email (optional — request-access notifications; leave blank to skip email)
PLUNK_SECRET_KEY=
PLUNK_FROM_EMAIL=
```

Safety: only ever paste **sandbox/test** keys. Live Plaid/Stripe keys must not
exist anywhere in this repo or its env stores during this goal.

## 3. How keys flow at runtime (Codex executes this — M0 and M12)

- `.env.local` is the single source Ansar maintains.
- All external API calls run in **Convex actions**, so server keys live in the
  **Convex deployment env**: Codex runs `npx convex env set NAME value` for
  each server-side var against the dev deployment (M0) and with `--prod`
  against the production deployment (M12). Values are read from `.env.local`,
  never echoed to logs or committed.
- Vercel gets only what the Next.js frontend needs (`NEXT_PUBLIC_*`,
  `SITE_URL`); server secrets stay in Convex.
- `pnpm preflight` validates each service with one cheap call (Plaid
  institutions/get, Stripe balance, Bedrock invoke, Convex reachable, vercel
  whoami) and prints PASS/FAIL — names only, no values.
- A missing/invalid key does NOT stop the run: the dependent milestone flips
  to fixture-mode, the blocker is logged with the exact fix, everything else
  proceeds.

Required env names (preflight asserts these):
`OWNER_EMAIL`, `OWNER_PASSWORD`, `NEXT_PUBLIC_CONVEX_URL`,
`CONVEX_DEPLOYMENT`, `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`,
`STRIPE_SECRET_KEY`, `AI_PROVIDER`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AI_MODEL`, `AI_EMBEDDINGS_MODEL`.
Optional: `STRIPE_WEBHOOK_SECRET`, `PLUNK_SECRET_KEY`, `PLUNK_FROM_EMAIL`,
`JWT_PRIVATE_KEY`/`JWKS` (Codex generates for Convex Auth if absent).
Managed by Codex, not asserted: `SITE_URL` (localhost in dev; set to the
production URL during M12).

## 4. Decisions — answered 2026-06-11 (do not re-ask)

1. **AI provider:** AWS Bedrock via the AI SDK provider layer (registry shaped
   for Anthropic/OpenAI/Google/Ollama later, per spec §3.3). Embeddings on
   Bedrock Titan. Degraded mode must work without AI env.
2. **Plaid/Stripe:** Ansar provides sandbox/test keys before launch; both
   integrations are built END-TO-END overnight (not scaffolds). Fixture-mode
   is the fallback only if a key fails preflight.
3. **Scope:** everything in the v1 spec slice — including payroll register,
   invoices+bills, contacts, AND receipts (M11). Receipts may degrade to
   upload+manual-match with a logged gap, but must be attempted.
4. **Deployment:** full production — Vercel + `openbooks.ansarullahanas.com`
   + Convex prod with env synced; owner login verified on the live URL.
5. **Key storage model (v1):** environment-based for this owner instance.
   Settings → Connections shows "configured from environment" and still owns
   the interactive flows (Plaid Link, account selection, sync controls).
   The encrypted paste-your-own-keys flow from spec §3 is the first
   fast-follow after this goal (tracked in completion report → Next steps).
6. **Auth method:** Convex Auth password provider for v1 (no email dependency
   to log in); invite-only via `OWNER_EMAIL` allowlist + invites table.
   Magic-link/OTP via Plunk is a fast-follow.
7. **Demo entity:** generic fictional company "Acme Studio LLC" (services,
   USD base). No real Z360/Zikra data anywhere in seeds. Ansar's real
   entities get created in-app after the goal, by him.
8. **Entities:** multi-entity workspace ships in v1 as specced — the Demo
   entity and Live Sandbox entity exercise the entity switcher from day one.
9. **Workspace policy:** single workspace, owner-controlled membership;
   request-access leads go to Convex (+ Plunk notify when key present); no
   public demo mode this goal.
10. **License/repo:** AGPL-3.0 (already in LICENSE); repo stays
    `OpenBooks` under Ansar's GitHub; no telemetry of any kind in v1.

## 5. Open items (only these may interrupt the run)

- None at launch time if §1–2 are completed (including the domain check). If
  preflight fails on a key, or the domain can't attach during M12, Codex logs
  the blocker + exact fix and continues elsewhere — you resolve it in the
  morning and re-run `pnpm preflight`.
