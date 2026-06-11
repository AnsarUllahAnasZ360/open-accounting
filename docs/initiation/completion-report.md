# Completion Report

Branch: `initiation`
This file is the run log + the honesty contract. Codex appends a dated entry
after every milestone and fills the acceptance table during M13. Never delete
history; never claim a row without linked evidence.

---

## Acceptance checklist (fill during M13)

Status values: WORKING (evidenced) · PARTIAL (works with named gaps) ·
BLOCKED (needs listed input) · NOT REACHED (budget).

| # | Check (rows 1–18 = acceptance.md; 19–20 = goal.md gates) | Status | Evidence | Notes / next step |
|---|---|---|---|---|
| 1 | Landing + request-access (desktop/mobile) | | | |
| 2 | Public sign-up disabled | | | |
| 3 | Owner login | | | |
| 4 | Dashboard on 12-month demo data, drill-throughs | | | |
| 5 | Inbox confirm / correct / rule / batch | | | |
| 6 | Register: drawer, accounting view, reverse+repost, split, exclude | | | |
| 7 | Invoices + Bills flows | | | |
| 8 | Contacts directory + profiles | | | |
| 9 | Payroll runs + 3-currency statement + CSV | | | |
| 10 | Reports suite + Balanced ✓ + TB=0 + cash/accrual + CSV export | | | |
| 11 | Full data export | | | |
| 12 | Plaid sandbox connect → sync → pipeline | | | |
| 13 | Stripe test sync + payout drill-down + invoice via Stripe | | | |
| 14 | Chat answers 5 questions correctly + confirmed action posts | | | |
| 15 | Receipt upload → extraction → match | | | |
| 16 | Mobile usability (4 core surfaces) | | | |
| 17 | Audit log attribution (user/rule/AI) | | | |
| 18 | Honesty check — this table complete with evidence (acceptance #18) | | | |
| 19 | `pnpm verify` + `pnpm test:e2e` green; eval accuracy reported (goal.md §2; ≥80% is a target, not a blocker) | | | |
| 20 | Production URL live, owner login in prod (goal.md §1.9) | | | |

## Run metadata (fill at start and end of the overnight run)

- Goal started (timestamp):
- Convex dev deployment: z360/openbooks dev/ansar-ullah-anas (ceaseless-mandrill-524) / prod deployment:
- Vercel project: ansar-ullah-anas-projects/openbooks / production URL: https://openbooks-flax.vercel.app
- Owner credential location (never the secret itself): `.env.local` plus macOS Keychain item `OpenBooks_OWNER_PASSWORD`
- Categorization eval accuracy:
- Goal ended (timestamp): / stop reason (complete / budget / blocked):

## Blockers (append as found)

| When | Blocker | Affected milestone | Exact input needed | Workaround taken |
|---|---|---|---|---|
| 2026-06-11 00:44 CDT | Vercel linked locally under the wrong `z360` scope, and GitHub auto-attach failed there. | M12 production deploy + domain | Use the `ansar-ullah-anas-projects` Vercel scope instead. | Resolved at 2026-06-11 01:00 CDT: linked/deployed `ansar-ullah-anas-projects/openbooks`; GitHub connection succeeded. |
| 2026-06-11 00:48 CDT | `ansarullahanas.com` was not listed under the active Vercel `z360` scope. | M12 custom domain | Confirm which Vercel scope owns `ansarullahanas.com`. | Resolved at 2026-06-11 01:00 CDT: domain is listed under `ansar-ullah-anas-projects`. |
| 2026-06-11 01:00 CDT | `openbooks.ansarullahanas.com` is attached to Vercel but DNS does not resolve yet. | M12 custom domain | In Hostinger DNS, add `A openbooks.ansarullahanas.com 76.76.21.21` (or host/name `openbooks`, value `76.76.21.21`), then wait for propagation and Vercel verification. | Vercel production URL works now: https://openbooks-flax.vercel.app. |

## Deviations from product spec (append as made)

| Spec section | Deviation | Why | Restore plan |
|---|---|---|---|

---

## Run log (append a dated entry per milestone)

Template:

```
### <date time> — M<n> <name>
What changed:
Evidence: (test output summary, screenshot paths, object IDs)
Verification: pnpm verify <green/red>, relevant suites
Next: M<n+1>
```

---

### 2026-06-11 01:13 CDT — M0 Preflight gate

What changed:

- Re-ran `npx convex ai-files install` and re-read `convex/_generated/ai/guidelines.md`.
- Read the local Next.js 16.2.7 docs index plus the App Router pages relevant to project structure, layouts/pages, server/client components, fonts, route handlers, and environment variables.
- Added `scripts/preflight.mjs` and wired `pnpm preflight`. The script reads `.env.local`, checks required env names, enforces Plaid sandbox and Stripe test-mode key shapes, makes cheap Plaid and Stripe calls, makes a Bedrock runtime tiny invoke, verifies Convex deployment metadata, and checks Vercel CLI auth. It prints names/status only, never values.
- Added `pnpm verify` as the repeatable local quality gate: typecheck, lint, production build, and Vitest.
- Added Vitest + `convex-test` scaffolding and a first invariant smoke test.
- Added Playwright scaffolding with a first browser smoke test and evidence output under `docs/initiation/evidence/`.

Preflight PASS/FAIL table:

| Check | Status | Detail |
|---|---:|---|
| `.env.local` | PASS | present |
| Required env names | PASS | all required names present |
| Optional env names | PASS | none configured |
| Plaid sandbox institutions/get | PASS | sandbox endpoint reached |
| Stripe test balance | PASS | test balance endpoint reached |
| Bedrock tiny invoke | PASS | runtime accepted `AI_EMBEDDINGS_MODEL` tiny invoke |
| Convex deployment | PASS | deployment metadata reachable |
| Vercel whoami | PASS | CLI authenticated |

Evidence:

- `docs/initiation/evidence/2026-06-11-m0-preflight.txt`
- `docs/initiation/evidence/2026-06-11-m0-verify.txt`
- `docs/initiation/evidence/2026-06-11-m0-e2e-smoke.txt`

Verification:

- `pnpm verify` green: typecheck, lint, Next.js production build, Vitest.
- `pnpm test:e2e` green for the M0 landing-shell smoke test.

Notes:

- Bedrock runtime is reachable through the configured embeddings model. M10 still owns the actual chat/categorization adapter for the configured `AI_MODEL`; this is not a blocker for M0.
- Convex deployment metadata is reachable. The local `NEXT_PUBLIC_CONVEX_URL` currently points to a localhost Convex URL, so local app runs that need live Convex data must start the local Convex service or point the app to the cloud dev URL.

Next:

- M1 — design-system port, app shell, and landing/request-access surface.

### 2026-06-11 00:44 CDT — Pre-goal access readiness

What changed:

- Filled `.env.local` with allowed sandbox/test/local values only: Plaid sandbox, Stripe test mode, AWS Bedrock, owner bootstrap fields, and Convex/Vercel project metadata. Tightened `.env.local` permissions to owner-only.
- Created and linked Convex cloud dev project `z360/openbooks`, deployed current Convex functions, and set required nonblank server env vars in the Convex dev deployment. `CONVEX_SITE_URL` was not set manually because Convex reports it as built-in.
- Linked Vercel project `z360/openbooks` locally. GitHub attachment and monorepo framework/root configuration remain M12 setup items.
- Checked Vercel domains under the active `z360` scope; `ansarullahanas.com` was not listed.
- Installed Convex AI guidance files and read `convex/_generated/ai/guidelines.md`; read local Next.js 16.2.7 docs index and sampled App Router, server/client component, font, route handler, and env-var guidance.

Evidence:

- Stripe test balance endpoint reachable.
- Plaid sandbox institutions endpoint reachable.
- AWS STS accepted credentials; Bedrock catalog reachable; configured chat and embeddings model IDs recognized.
- `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass locally.

Verification:

- This is not marked as M0 complete. Remaining M0 work: create `pnpm preflight`, wire `pnpm verify`, add Vitest/Playwright scaffolding, record final redacted preflight output, and commit the milestone.

Next:

- Start M0 implementation with the access foundation already in place.

### 2026-06-11 01:00 CDT — Personal Vercel production deploy

What changed:

- Relinked the project to `ansar-ullah-anas-projects/openbooks`, the Vercel scope that owns `ansarullahanas.com`.
- Added Vercel build configuration for the monorepo and set `NEXT_PUBLIC_CONVEX_URL` in Vercel production env.
- Added Next.js monorepo build configuration: `turbopack.root` and `outputFileTracingRoot` point to the workspace root so Vercel's Next 16/Turbopack build can resolve workspace dependencies.
- Deployed production to Vercel and attached `openbooks.ansarullahanas.com` to the project.

Evidence:

- Production deployment ready: https://openbooks-flax.vercel.app
- Deployment inspect URL: https://vercel.com/ansar-ullah-anas-projects/openbooks/B942NoV4C5rFJfczxZaG6FH4gQ7q
- `curl -I -L https://openbooks-flax.vercel.app` returned HTTP 200.
- Vercel domain inspect reports required DNS: `A openbooks.ansarullahanas.com 76.76.21.21`.

Verification:

- `pnpm lint` green.
- `pnpm build` green.
- `vercel build --prod` green before deploy.

Next:

- Add the Hostinger DNS record, then re-check `https://openbooks.ansarullahanas.com` after propagation.

## History — 2026-06-11 (early) initiation pass (pre-goal, kept for the record)

Completed:

- Created branch `initiation`; read Fable docs, prototype, design system.
- Researched Codex Goals, Convex env/self-hosting, Vercel env/deploy, Plaid
  Sandbox, Plaid Transactions Sync, Stripe test mode.
- Verified baseline: `pnpm typecheck` / `lint` / `build` pass;
  `pnpm exec convex dev --once` prepared local functions;
  `vercel whoami` → `ansar-8590`; `pnpm dev` rendered at `localhost:3000`.
- Created initiation docs; updated README, AGENTS.md, flow.md, LICENSE
  (AGPL-3.0), `.gitignore`, `.env.example`.

Baseline gaps at that time (now addressed by the M0–M13 plan): no auth E2E, no
invite gate, no contact form, no ported screens, no ledger, no Plaid/Stripe,
no AI, no linked Vercel project.

Env note: `pnpm exec convex dev --once` generated `.env.local` with local
Convex values; `env.local` is a git-ignored reference copy of secrets from the
other machine — values are distributed per access-and-questions.md §3.

## 2026-06-11 (later) — plan revision (Claude architecture pass)

- Rewrote goal.md as an acceptance-first completion contract (cookbook-aligned:
  outcome, verification surface, constraints, boundaries, iteration policy,
  blocked-stop).
- Rebuilt task-list.md into milestones M0–M13 with per-milestone evidence.
- Rewrote launch-prompt.md as `/goal` text + kickoff prompt with subagent and
  anti-spin directives.
- Converted access-and-questions.md into the pre-launch runbook + decision log
  (Bedrock AI, keys-from-env, two-entity demo architecture, full prod deploy).
- Added acceptance.md (18-point walkthrough) and this report structure.
- Copied the four Fable docs to `docs/product/01–04` as canonical references;
  marked `docs/product/bootstrap-scope.md` superseded.
