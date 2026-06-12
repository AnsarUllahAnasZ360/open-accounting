# OpenBooks

OpenBooks is an open-source, AI-assisted bookkeeping system for small businesses.
The product promise is simple: connect business money sources, answer the Inbox
items the system cannot resolve confidently, and keep accountant-grade books
without turning the owner into an accountant.

## Product Thesis

OpenBooks is not a dashboard over bank data. It is a ledger-first accounting
application with a plain-English operating layer:

- Money movement enters through Plaid, Stripe, CSV/OFX imports, invoices, bills,
  receipts, and manual entries.
- A deterministic pipeline handles matches, transfers, rules, memory, and AI
  categorization in that order.
- The hidden accounting engine posts balanced double-entry journal entries.
- The owner works mainly from an exception Inbox.
- Reports are generated from ledger lines, not from approximate category totals.

The governing rule is:

> AI proposes. The ledger engine posts.

## Current Status

This repository is on the `finishing` branch. It is no longer just a scaffold:
the core accounting product is running locally against the shared cloud Convex
dev deployment, with evidence tracked in `docs/finishing/completion-report.md`.

Working and evidenced today: first-run onboarding, the app shell, Settings,
Ask AI threads/proposals, Income, Expenses, Bills, Reports, Payroll, receipt
upload/create-expense, entity switching, and the core disposable-business e2e
workflow.

Still partial by design: hosted Plaid sandbox proof, real Stripe test webhook
delivery proof, true first-page PDF raster vision, the broader Inbox
keyboard/batch acceptance pack, and the final H2/H5 evidence closeout. The
honest categorization eval is implemented and recorded at 45/60 correct
(75.0%), below the 80% target; that is a product-quality finding, not a hidden
green claim.

- Next.js App Router, React, TypeScript, Tailwind CSS, shadcn/ui
- Convex backend, database, jobs, auth, HTTP actions, and generated tests
- Convex Agent + Bedrock/Kimi categorization and chat paths with degraded mode
- Plaid sandbox and Stripe test-mode code paths, with fixture/degraded fallbacks
- OpenBooks prototype screens and design-system references

The initiation plan lives in `docs/initiation/`.

## Target Stack

- Frontend: Next.js App Router on Vercel
- UI: shadcn/ui, Tailwind CSS, Geist, lucide icons, OpenBooks design tokens
- Backend/database/jobs/auth: Convex cloud dev for this branch
- Auth posture: open-source first-run onboarding plus invite-link teammates;
  local dev uses a localhost-gated owner bypass
- Email: Plunk optional for invite delivery; copy-link invites work without it
- Bank data: Plaid sandbox first, production later with user-provided keys
- Payments/invoicing: Stripe test mode first, restricted live keys later
- AI: bring-your-own provider key; Bedrock is configured in this branch
- License: AGPL-3.0-only

## Local Setup

Install dependencies:

```bash
pnpm install
```

Set up local environment from the existing cloud Convex deployment:

```bash
cp .env.example .env.local
```

Fill in the cloud Convex deployment values in `.env.local`. For this branch,
Convex runs in the cloud deployment `ceaseless-mandrill-524`; do not point
`NEXT_PUBLIC_CONVEX_URL` at localhost. Then run the one-command local boot:

```bash
pnpm dev:full
```

`pnpm dev:full` pushes the latest Convex functions to the cloud dev deployment,
starts the local Next dev server, confirms the owner/dev bypass setup, and
prints the local URL. In local dev mode, open `/sign-in` and choose
**Continue as owner (dev)**.

For a quick non-mutating check of the command plan:

```bash
pnpm dev:full -- --dry-run
```

Verify the current baseline before committing a batch:

```bash
pnpm verify
npx convex dev --once
```

`pnpm verify` checks web typecheck, lint, build, and unit tests. It does not
typecheck Convex, so `npx convex dev --once` is mandatory after backend changes.

## Secret Safety

Never commit real financial data, bank tokens, Stripe keys, Plaid secrets, AI
keys, Plunk secrets, Convex deployment secrets, customer records, payroll data,
or copied local env files. The undotted `env.local` file is ignored because it
may contain copied secrets but is not loaded automatically by Next.js.

## Source Materials

- Product docs copied from Fable/Claude: `OpenBook - Prototype/uploads/`
- Interactive prototype screens: `OpenBook - Prototype/*.dc.html`
- Design system: `OpenBooks Design System/`
- Initiation operating packet: `docs/initiation/`
