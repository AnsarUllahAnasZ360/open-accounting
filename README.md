# Ottex AI Accounting

Open-source AI-assisted bookkeeping for small service businesses.

The product goal is intentionally narrow: connect bank and Stripe data, classify transactions with rules and cheap AI, maintain a double-entry ledger, generate core financial reports, and ask the owner only when the system is uncertain.

## Foundation Stack

- Frontend: Next.js, React, TypeScript, Tailwind CSS, shadcn/ui
- Hosting: Vercel
- Backend and database: Convex
- Auth: Convex Auth, initially magic-link oriented
- Email: Plunk
- Future connectors: Plaid, Stripe
- Future AI: OpenAI-compatible provider adapter

## Workspace Layout

```text
apps/web/          Next.js app deployed to Vercel
convex/            Convex schema, functions, auth, and scheduled jobs
packages/email/    Plunk email adapter
packages/*         Future accounting, connector, reporting, and AI packages
docs/              Product, architecture, security, and deployment notes
```

## Local Setup

Copy `.env.example` to `.env.local` or pull environment variables from Vercel after the project is linked. Never commit real financial, email, banking, Stripe, Plaid, Convex, or AI secrets.

```bash
pnpm install
pnpm dev
```

