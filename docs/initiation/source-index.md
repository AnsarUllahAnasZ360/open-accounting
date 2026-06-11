# Initiation Source Index

Date: 2026-06-11 (rev 2)
Branch: `initiation`

## Product definition (canonical — read these)

- `docs/product/01-vision-and-scope.md` — product thesis: free, open-source,
  AI-first accounting; real double-entry books under a plain-English UI.
- `docs/product/02-product-spec.md` — architecture, ledger model,
  Plaid/Stripe/AI flows, data model (§7), reconciliation engines (§5),
  reports (§6.7), security (§8), onboarding (§9).
- `docs/product/03-design-brief.md` — screen-level UX for every surface.
- `docs/product/04-build-plan.md` — the long-form 16-week plan. The overnight
  goal (goal.md) compresses its v1 core into milestones M0–M13.

Originals preserved untouched at `OpenBook - Prototype/uploads/01–04` —
canonical copies live in `docs/product/` so they survive prototype-folder
changes. `docs/product/bootstrap-scope.md` is superseded (banner inside).

## Goal documents (this run)

- `docs/initiation/goal.md` — the completion contract.
- `docs/initiation/task-list.md` — milestones M0–M13 with evidence gates.
- `docs/initiation/launch-prompt.md` — `/goal` text + kickoff prompt.
- `docs/initiation/access-and-questions.md` — pre-launch runbook (keys, env
  flow) + answered decision log.
- `docs/initiation/acceptance.md` — the 18-point morning walkthrough; mirrored
  by the Playwright suite.
- `docs/initiation/build-decisions.md` — decisions 1–12.
- `docs/initiation/completion-report.md` — run log + acceptance table.
- `docs/initiation/research-notes.md` — initiation-pass research (Goals,
  Convex, Vercel, Plaid sandbox, Stripe test mode).
- `docs/initiation/evidence/` — screenshots + exports captured per milestone.

## Design sources

- `OpenBooks Design System/SKILL.md` + `readme.md` — agent-facing rulebook:
  brand, voice, IA, tokens, components.
- `OpenBooks Design System/tokens/`, `styles.css` — CSS custom properties
  (green ramp, semantic money colors, radii, spacing) to port into Tailwind 4.
- `OpenBooks Design System/components/` + `_ds_bundle.js` — component library
  with `.prompt.md` usage notes.
- `OpenBooks Design System/ui_kits/openbooks/` — full JSX reference screens
  (Dashboard, Inbox, Transactions, CashFlow, Reports, shell) — the reference
  implementation for M1/M5.
- `OpenBook - Prototype/*.dc.html` — 17 visual-reference mockups (Landing,
  Dashboard, Inbox, Transactions, Income, Expenses, Bills, Contacts, Payroll,
  Reports, Settings, Mobile). Note: Canvas*.dc.html are empty shells; the AI
  panel is specified by `docs/product/03-design-brief.md` §9 + the AskAI
  design-system component. No auth/onboarding mockups exist — derive from the
  design system + design brief §11.

## Current repo baseline

- `apps/web/` — Next.js 16.2.7 App Router + shadcn baseline (bootstrap
  dashboard only; replaced during M1/M5).
- `convex/` — schema/auth/http/bootstrap starters (rebuilt around spec §7
  during M2/M3).
- `packages/email/` — Plunk adapter starter (used by request-access intake).
- `scripts/` — preflight + seed scripts land here in M0/M4.
