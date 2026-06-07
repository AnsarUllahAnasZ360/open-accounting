# Decision 0001: Foundation Stack

Date: 2026-06-07

## Decision

Use Next.js on Vercel for the frontend, Convex for backend/database/scheduling/auth, Plunk for transactional email, shadcn/ui with Radix primitives for UI, and a pnpm monorepo for shared packages.

## Why

The product needs a fast hosted frontend, a reactive backend/database, scheduled jobs for sync and weekly reports, simple auth for small teams, and source-owned UI components. Convex keeps backend logic and scheduled jobs close to the data. Vercel keeps deployment and preview workflows simple. shadcn/ui gives us editable source components instead of a closed design dependency.

## UI Primitive Choice

shadcn now supports both Radix and Base UI. Base UI is promising and officially documented, but Radix remains the safer default for this app because it has broader ecosystem adoption, stronger compatibility with many shadcn-adjacent components, and better compatibility with future AI Elements-style UI packages that still assume Radix primitives.

We will initialize shadcn with Radix now and revisit Base UI after the core app is stable.

## Accounting Boundary

The accounting engine should live outside the Next.js app. Reports, journal validation, classification, and reconciliation must remain usable from jobs, tests, imports, exports, and future self-hosted runtimes without depending on React.

## Security Boundary

Secrets must stay in local/Vercel/Convex environment stores. The app should never commit real Plaid tokens, Stripe keys, Plunk keys, AI keys, bank data, or customer financial records.

