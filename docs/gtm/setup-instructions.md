# Set up OpenBooks — prerequisites, security posture, and the manual steps

The canonical, owner-facing setup page (E15-T5). It mirrors the in-product
[`/setup`](../../apps/web/src/app/setup/page.tsx) route and shares its step list
with the self-host skill (E13) — see
[Alignment with the self-host skill](#alignment-with-the-self-host-skill-e13) at
the bottom. If anything here ever disagrees with `docs/self-host/`, the
`docs/self-host/` files and the `skills/openbooks-self-host/` skill are the
deeper, authoritative runbook; this page is the GTM-facing summary.

OpenBooks is free, open-source, and **bring-your-own-keys**: your bank tokens and
API keys live in **your own** deployment, encrypted at rest. Most of the install
is two commands; the steps that genuinely need a human are the three "manual
steps" below.

---

## Prerequisites

### Accounts

| Account | Why | Required? |
|---|---|---|
| GitHub | Fork/clone the repo. | Required |
| Convex | Backend: database, functions, jobs, auth, HTTP webhooks. Free tier is fine. Convex always runs in the cloud — never localhost. | Required |
| Vercel (or any Next.js host / local run) | Host the web app. | Required for a hosted instance |
| An AI provider | The AI bookkeeper runs on **your** key. Pick any one of the 14 in `convex/aiCatalog.ts` (OpenAI, Anthropic, Google, Bedrock, Groq, Mistral, DeepSeek, xAI, Ollama-local, …). | Required |
| Plaid | Bank sync. | Optional (CSV import works without it) |
| Stripe | Payment/payout reconciliation. | Optional |
| Plunk | Transactional email (request-access, weekly digest). | Optional |

### Tools

| Tool | Version | Check |
|---|---|---|
| Node.js | 20+ | `node -v` |
| pnpm | 10.x | `pnpm -v` |
| Convex CLI | latest (`npx convex`) | `npx convex --version` |

For the exact variable-by-variable env list, see
[`docs/self-host/env-checklist.md`](../self-host/env-checklist.md) (the keys come
from `.env.example`). You can skip key-gathering at install time and paste keys
later from **Settings → Connections** inside the app.

### Install (the non-manual part)

```bash
pnpm install
pnpm setup            # writes .env.local, mints auth keypair + encryption key
npx convex dev --once # links your own Convex deployment, pushes functions
pnpm dev:full         # local boot; open /sign-in → "Continue as owner (dev)"
```

To deploy a hosted instance, follow [`docs/self-host/deploy.md`](../self-host/deploy.md)
(Convex prod + Vercel prod).

---

## Security posture

This is the trust contract for pasting bank/Stripe/AI keys. It matches
[`docs/security/secrets.md`](../security/secrets.md),
[`docs/security/security-posture.md`](../security/security-posture.md), and the
public [`/security`](../../apps/web/src/app/security/page.tsx) page — no overclaim.

- **One unified, encrypted-at-rest credentials store.** All credentials — AI,
  Plaid, Stripe, Plunk — are stored in a single `credentials` table as an
  encrypted blob via `secretBox` (AES-GCM). There is no per-provider plaintext
  field. (Decisions Q12/Q18.)
- **Correctly scoped.** AI, Plunk, and the Plaid Item token are
  **workspace-scoped**; Stripe is **per-business** (`entityId` required).
  (Decisions Q13/Q17.)
- **Keys are never returned to the client.** The UI only ever sees a
  `keyPreview` / `lastFour` / fingerprint — never the secret value. Every
  server-side read re-checks workspace/entity authorization before doing
  anything.
- **Nothing secret is committed.** `.env.local` is gitignored; only
  `.env.example` (placeholders) is tracked. A secret scan
  (`pnpm scan:secrets`, plus `pnpm security:gitleaks` over history) gates the
  repo.
- **Live connectors are supported locally.** You are **not** restricted to Plaid
  sandbox or Stripe test mode — live Plaid (development/production) and live
  Stripe (`sk_live_…`) keys work, locally and self-hosted (Decision Q16). The
  only retained hard requirements are **encryption at rest** and the **live-key
  HTTPS-redirect** requirement (a live key needs a stable HTTPS origin for its
  OAuth redirect / webhook).

The honest non-claim: pasting live bank/Stripe credentials is never "risk-free."
It is safe *because* of encryption-at-rest, per-entity authz, and the
HTTPS-origin requirement — not in spite of skipping them.

---

## The three manual steps

Everything else can be automated; these three need you, because they register
values in **external** dashboards. The app surfaces the exact values to copy.

### 1. Register the Plaid redirect URL

In **Settings → Connections → Banks** (the `AddBankSheet`), OpenBooks shows the
exact OAuth **redirect URL** for your deployment. Copy it into your Plaid
dashboard's allowed redirect URIs **before** you connect a bank, so the Link
hand-off returns to your instance.

### 2. Register the Stripe webhook URL — **required for a live Stripe connection**

In **Settings → Connections → Stripe** (the `StripeConnectSheet`), OpenBooks
shows the exact **webhook endpoint URL**. Register it in your Stripe dashboard
and paste the `whsec_…` signing secret back into OpenBooks.

This is **not optional** for a live Stripe connection: a connection does **not**
report "listening" until the webhook is verified (Decision Q15). Subscribe to (at
minimum) `payout.paid`, `payout.failed`, `payout.canceled`,
`payout.reconciliation_completed`, `charge.succeeded` /
`payment_intent.succeeded`, `charge.refunded`, `charge.dispute.created` /
`closed`, and `balance.available`. Payout settlement, refunds, and disputes are
asynchronous, so polling alone is not reliable.

`scripts/register-stripe-webhook.mjs` (`pnpm stripe:webhook:register`) automates
the registration if you prefer the CLI.

### 3. Paste the AI provider key and pick provider + model

In **Settings → Connections → AI**, paste your AI provider key and choose your
provider and model from the full **14-provider catalog** (Decision Q12,
`convex/aiCatalog.ts`). The key is encrypted before it touches the database; only
a preview is ever shown back. Local Ollama needs only a base URL, no key.

After these three, set your opening balances and run the first AI review (both
guided in onboarding and on the `/setup` page).

---

## Links

- In-product setup: [`/setup`](../../apps/web/src/app/setup/page.tsx)
- Owner guide: [`/help`](../../apps/web/src/app/help/page.tsx)
- Security: [`/security`](../../apps/web/src/app/security/page.tsx) ·
  [`docs/security/security-posture.md`](../security/security-posture.md)
- Self-host runbook: [`docs/self-host/`](../self-host/) ·
  `skills/openbooks-self-host/`
- README "Local Setup": [`../../README.md`](../../README.md)

This page is linked from the README ("Learn more"), the in-app help center, and
the landing footer (via the `/setup` route).

---

## Alignment with the self-host skill (E13)

This page is the GTM summary; `skills/openbooks-self-host/SKILL.md` and
`docs/self-host/` are the deeper agent-driven runbook. They are consistent:

| Topic | This page | E13 self-host skill / docs |
|---|---|---|
| Install commands | `pnpm install` → `pnpm setup` → `npx convex dev --once` → `pnpm dev:full` | Identical (SKILL.md "Hard guardrails" + `docs/self-host/prerequisites.md`) |
| Live connectors | Live Plaid/Stripe supported; encryption-at-rest + HTTPS-redirect are the only hard rules | Identical (SKILL.md guardrail #4 — do NOT tell users to use sandbox-only) |
| Secret handling | Names-only; never commit; `.env.local` gitignored | Identical (SKILL.md guardrails #1–#3) |
| The 3 manual steps | Plaid redirect, Stripe webhook (required), AI key | Same steps, surfaced from the same Settings sheets |
| Pause-for-confirmation | n/a (human doc) | The skill pauses before any account-touching / `--prod` step |

No contradictory instruction exists between the two. If the skill changes the
canonical step list, update this page to match.
