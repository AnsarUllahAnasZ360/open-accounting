# Resume prompt — paste this into a fresh Claude Code chat

> Copy everything in the fenced block below as your first message in the new
> session. It is self-contained and points at the live state docs.

```
You are the engineering lead continuing the OpenBooks `finishing` branch — free,
open-source, AI-assisted bookkeeping for small businesses. A prior session
finished roughly half the plan (the hard accounting-integrity half) and left a
precise handoff. Your job is to finish the rest, honestly and verifiably. You may
run a small team of subagents; you own integration, verification, and honesty.

READ FIRST, in this order, before any code:
1. docs/finishing/whats-left.md — the current state, what's committed, what's
   WIP, what's left, the environment runbook, and the inputs needed. THIS IS
   YOUR MAP. Trust it over your assumptions.
2. docs/finishing/completion-report.md — the dated, evidence-linked status log
   (the honesty contract lives here).
3. docs/finishing/implementation-plan.md — the full epic contract (E, B4–B6, F,
   G, H each have Context / Do / Done-when / Verify). This is authoritative for
   each task.
4. AGENTS.md — the non-negotiable invariants (ledger postEntry only, money in
   integer minor units, authz on every Convex function, design tokens, no
   secrets committed, dev bypass localhost-only).
5. For visuals, the prototype in `OpenBook - Prototype/*.dc.html` and the design
   system in `OpenBooks Design System/` are the source of truth (prototype wins
   on conflicts). NEVER modify those two folders.

NON-NEGOTIABLE ENVIRONMENT RULES (from whats-left.md §1 — re-read them):
- Convex is the CLOUD dev deployment (ceaseless-mandrill-524). NEVER run Convex
  locally. `npx convex dev --once` uploads code to the cloud and exits.
- Gates are TWO commands: `pnpm verify` (web typecheck+lint+build+unit) AND
  `npx convex dev --once` (Convex tsc) after any convex/ change — verify does NOT
  typecheck Convex.
- Convex test helpers: type the handle as `TestConvex<typeof schema>`, never
  `ReturnType<typeof convexTest>`.
- e2e: real pointer clicks only (no dispatchEvent/force:true); the harness
  forwards the dev-auth bypass; never mutate the shared demo books in e2e (verify
  posting lifecycles in in-memory unit tests).
- Before Convex work: `npx convex ai-files install`, then read
  convex/_generated/ai/guidelines.md. Before Next.js work: skim the relevant page
  under apps/web/node_modules/next/dist/docs/ (Next 16 differs from training).

EXECUTION PROTOCOL:
- One epic = one batch = one tightly-scoped subagent with a non-overlapping write
  scope. Convex pushes to ONE shared cloud deployment, so run Convex-touching
  batches serially (don't let two agents push at once). SPLIT big epics (esp. G)
  into sub-batches — subagents get killed near ~300k tokens, and D & E both died
  mid-task last session. On a kill: assess the tree (`pnpm typecheck` +
  `npx convex dev --once`), then finish in the open or relaunch a focused
  completion agent. Nothing is ever lost because every finished batch is
  committed.
- After EACH batch: run both gates + the new real-click e2e, capture screenshots
  into docs/finishing/evidence/, append a dated entry to
  docs/finishing/completion-report.md, and commit with a conventional message
  (never force-push). Act on subagent-completion notifications immediately —
  integrate, don't idle.
- HONESTY CONTRACT: a completion-report row is WORKING only with a linked green
  real-click test AND a screenshot of the behavior as written. Otherwise PARTIAL
  (named gaps + next step) or BLOCKED (exact input). Your final acceptance table
  must not claim more than your run log supports. The prior overnight run's
  failure was exactly this — do not repeat it.
- Three-strikes: if one error defeats three distinct attempts, write a blocker
  note with the exact input needed and move to the next independent task.

RECOMMENDED ORDER (details + DoD in implementation-plan.md, summarized in
whats-left.md §3):
1. Finish & verify Epic E (Settings) — code is in the tree and compiles; it needs
   the E verification (e2e for all 10 sections + Add-a-business→switcher→archive,
   autonomy persists, rule reorder, audit filter; unit for entities.create CoA +
   authz, archive, autonomy→threshold, role matrix) + screenshots, then mark
   row #9 WORKING.
2. Ask AI panel UI — B4–B6 (the engine is done; dock the panel, render markdown +
   tool + Confirmation cards on api.aiThreads/api.proposals, kill the overlay).
3. Epic F — onboarding stepper, /profile, team invites with role enforcement, and
   the high-value `pnpm dev:full` one-command boot (F4).
4. Epic G — Plaid real Link + crons + system actor, Stripe event-driven sync +
   payout lines, receipts PDF, entity-scoped read models. NEEDS fresh Plaid
   sandbox keys from Ansar (build + degrade to fixture mode if absent). Split into
   sub-batches.
5. Epic H — rewrite legacy e2e to real clicks, acceptance evidence pack, HONEST
   categorization eval (the old "100%" compared the seed to itself), perf/limits,
   completion-report v2 + refresh how-openbooks-works.md + README + AGENTS.md,
   then redeploy (Vercel + Convex prod) and smoke owner login on
   https://openbooks.ansarullahanas.com.

INPUTS you may need from Ansar (don't block other work waiting on them):
- Fresh Plaid SANDBOX client_id + secret (G1) — sandbox only.
- STRIPE_WEBHOOK_SECRET on the Convex dev deployment (G3) — test mode only.
- Plunk keys (F3 invite email) — optional; degrade to copy-link.

STOP CONDITION: stop only when every remaining epic's definition of done is
evidenced in the completion report, or you are blocked on an input only Ansar can
provide. Begin by reading the five docs above, then post your batch plan before
writing code.
```
