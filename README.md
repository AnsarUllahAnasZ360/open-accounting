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

This repository is on the `finishing` branch. The ledger foundation is in place
and the remaining work is tracked in `docs/finishing/`: prototype-faithful UI,
identity/onboarding, live Plaid/Stripe test integrations, and final acceptance
evidence. The useful foundation is:

- Next.js App Router, React, TypeScript, Tailwind CSS, shadcn/ui
- Convex backend directory and Convex Auth starter wiring
- Plunk email adapter starter
- A passing TypeScript, lint, and production build baseline
- Fable-generated product docs, prototype screens, and design system references

The initiation plan lives in `docs/initiation/`.

## Target Stack

- Frontend: Next.js App Router on Vercel
- UI: shadcn/ui, Tailwind CSS, Geist, lucide icons, OpenBooks design tokens
- Backend/database/jobs/auth: Convex
- Auth posture: invite-only workspace creation; public sign-up disabled
- Email: Plunk for auth and contact/intake notifications
- Bank data: Plaid sandbox first, production later with user-provided keys
- Payments/invoicing: Stripe test mode first, restricted live keys later
- AI: bring-your-own provider key, OpenAI-compatible adapter first
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
Convex runs in the cloud; do not point `NEXT_PUBLIC_CONVEX_URL` at localhost.
Then run the one-command local boot:

```bash
pnpm dev:full
```

`pnpm dev:full` pushes the latest Convex functions to the cloud dev deployment,
bootstraps the owner account, starts Convex watch plus Next dev, seeds the demo
books unless `OPENBOOKS_SKIP_DEMO_SEED=1`, and prints the local URL. In local
dev mode, open `/sign-in` and choose **Continue as local dev owner**.

For a quick non-mutating check of the command plan:

```bash
pnpm dev:full -- --dry-run
```

Verify the current baseline:

```bash
pnpm verify
npx convex dev --once
```

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
