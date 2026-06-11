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

This repository is in an initiation/reset phase. The existing app is buildable,
but it is not yet the finished OpenBooks product. The useful foundation is:

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

Set up local environment:

```bash
cp .env.example .env.local
pnpm exec convex dev --once
```

Convex writes `CONVEX_URL` to `.env.local`. Next.js needs the public browser
value too, so set:

```bash
NEXT_PUBLIC_CONVEX_URL=<same value as CONVEX_URL>
```

Run the app:

```bash
pnpm dev
```

Verify the current baseline:

```bash
pnpm typecheck
pnpm lint
pnpm build
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
