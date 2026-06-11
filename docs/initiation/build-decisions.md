# Build Decisions

Date: 2026-06-11 (rev 2 — decisions 1–6 from the initiation pass, 7–12 added
after the architecture review with Ansar's answers)

## Decision 1: Foundation Reset, Not Full Repo Deletion

Keep the repo, replace the product layer.

- The current repo builds cleanly and the toolchain matches the requested
  stack: Next.js 16, Convex, shadcn/ui, TypeScript, Tailwind 4.
- The current app is only a bootstrap dashboard; preserve scaffolding, replace
  the product layer with the Fable/OpenBooks vision.

## Decision 2: Accounting Correctness Comes Before AI

OpenBooks is only trustworthy if reports come from balanced journal lines.

- Money as integer minor units + currency code; never floats.
- One posting mutation (`postEntry`) enforces balance; posted entries are
  immutable; corrections reverse + repost.
- AI, rules, and imports create proposals; the ledger engine validates truth.

## Decision 3: Invite-Only Auth For v1

- Public account creation disabled; landing page collects request-access
  leads (stored in Convex, Plunk notification when configured).
- Owner allowlist + invites table governs who can sign in.

## Decision 4: Convex Cloud First, Self-Host Path Later

- Convex cloud for active development and the production deployment behind
  `openbooks.ansarullahanas.com`.
- Keep code portable; document the Docker self-host path after the core is
  stable (the open-source thesis is unchanged, just sequenced).

## Decision 5: Sandbox/Test Data Only For This Goal

- Plaid `sandbox` env and Stripe test mode exclusively; live keys are banned
  from this goal's env stores.
- Real financial data enters only after Ansar reviews the working product.

## Decision 6: Design System Is A Contract

- Geist + Geist Mono, lucide icons, one green `#2ca01c`, white ledger-like
  surfaces, tabular money figures, quiet AI affordances.
- shadcn primitives first; `ui_kits/openbooks/` JSX screens are the reference
  implementation; `.dc.html` prototypes are the visual reference.
- No gradients, purple AI styling, emoji, or marketing ornament.

## Decision 7: Acceptance-First Overnight Scope (supersedes "foundation-only")

The overnight goal delivers a **working v1 slice**, not a foundation with
scaffolds. Ansar's acceptance criteria (login, dashboard, Plaid sandbox E2E,
Stripe test E2E, 12-month demo books, AI chat, reports + export, settings,
deploy) are the completion conditions — see goal.md. "Documented as a gap" is
acceptable only behind a real access failure, never as a substitute for
building.

Why: the previous failure mode was Codex under-delivering against an unclear
bar. The bar is now explicit, evidenced, and machine-checked.

## Decision 8: Two-Entity Demo Architecture

- **Demo entity ("Acme Studio LLC")** — 12 months of deterministic seeded
  books generated through the pipeline + `postEntry` (never screen-only
  numbers). This is where "a year of data" and full-module richness live.
- **Live Sandbox entity** — real Plaid sandbox + Stripe test connections
  proving sync mechanics end-to-end on whatever data sandboxes provide.

Why: sandboxes cannot fabricate a year of history, and a Stripe test payout
never lands in a Plaid sandbox bank feed. Splitting "rich data" from "live
mechanics" makes both provable overnight instead of neither.

## Decision 9: Keys From Environment For v1; Encrypted BYO Flow Fast-Follows

- This instance reads Plaid/Stripe/Bedrock keys from env (`.env.local` →
  Convex deployment env via CLI). Settings → Connections shows "configured
  from environment" and still owns the product flows (Plaid Link, account
  selection, sync controls, status).
- The spec §3 encrypted paste-your-own-keys flow is the first post-goal
  fast-follow — it is core to the open-source story but adds overnight risk
  without changing what Ansar can verify tomorrow.

## Decision 10: AI Provider = AWS Bedrock First, Registry-Shaped

- Vercel AI SDK provider layer with a registry shaped for Anthropic / OpenAI /
  Google / Ollama / Bedrock; v1 activates **Bedrock** using the AWS creds
  Ansar already has (chat + categorization via `AI_MODEL`, embeddings via
  Titan `amazon.titan-embed-text-v2:0`).
- Autonomy thresholds are one constant: suggest = never auto-post,
  balanced = 0.90, autopilot = 0.75.
- Degraded mode (no AI env) keeps stages 1–3 (transfer/match/rules) working.

## Decision 11: Verification Stack

- **Unit/invariant:** vitest + convex-test — ledger balance invariant
  (incl. property-style random sequences), reversal/lock behavior, pipeline
  routing, payout-reconciliation fixtures, golden report fixtures
  (hand-computed statements for the seeded dataset, matched to the cent).
- **E2E:** Playwright suite mirroring `acceptance.md` — doubles as the
  open-source project's CI smoke suite.
- **Eval:** ≥100 labeled seed transactions; categorization accuracy reported
  every run (target ≥80%).
- Single entry points: `pnpm verify` and `pnpm test:e2e`. Evidence lives in
  `docs/initiation/evidence/` + the completion-report acceptance table.

## Decision 12: Auth = Convex Auth Password Provider For v1

Password login for the owner (no email dependency in the critical path);
invite-only enforced server-side. Magic-link/OTP via Plunk is a fast-follow.
Request-access intake works regardless of email configuration.
