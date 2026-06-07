# Accounting Foundation Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the public Ottex AI Accounting foundation with a Next.js frontend, Convex backend/auth baseline, Plunk email configuration, GitHub repository, Vercel project, and domain setup notes.

**Architecture:** Use a pnpm workspace with `apps/web` for the Vercel-hosted Next.js app and root-level `convex` for backend functions/database/auth. Keep shared accounting, connector, AI, and email logic in future `packages/*` workspaces so ledger rules stay independent from UI and external APIs.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui on Radix primitives, Convex, Convex Auth, Plunk, Vercel, GitHub.

---

### Task 1: Preflight and Repository Setup

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `.env.example`
- Create: `docs/decisions/0001-foundation-stack.md`

- [ ] Verify `node`, `pnpm`, `gh`, `vercel`, and `convex` CLIs are available.
- [ ] Initialize git at `/Volumes/SSD/Accounting`.
- [ ] Create root workspace metadata and ignore local secrets/build artifacts.
- [ ] Create the public GitHub repository under `AnsarUllahAnasZ360`.

### Task 2: Next.js Web App

**Files:**
- Create: `apps/web/*`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/app/page.tsx`

- [ ] Scaffold `apps/web` with `create-next-app@latest`, TypeScript, App Router, Tailwind, ESLint, Turbopack, and `@/*` alias.
- [ ] Verify installed Next.js version is `16.2.7` or newer patch.
- [ ] Replace starter screen with a product-shell placeholder for Ottex AI Accounting.
- [ ] Apply shadcn/Geist font fixes after component initialization.

### Task 3: shadcn UI Baseline

**Files:**
- Create: `apps/web/components.json`
- Create: `apps/web/src/components/ui/*`
- Create: `apps/web/src/lib/utils.ts`

- [ ] Initialize shadcn using Radix primitives.
- [ ] Add baseline dashboard components: button, card, input, label, textarea, select, switch, tabs, dialog, alert-dialog, sheet, dropdown-menu, badge, separator, skeleton, table.
- [ ] Confirm the app uses semantic theme tokens rather than one-off colors.

### Task 4: Convex and Auth Baseline

**Files:**
- Create: `convex/*`
- Modify: `apps/web/src/app/ConvexClientProvider.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `.env.example`

- [ ] Install Convex and Convex Auth dependencies.
- [ ] Initialize Convex project files without committing deployment secrets.
- [ ] Add a minimal Convex schema for bootstrap health/settings records.
- [ ] Add provider wiring in the Next.js app with clear env names.
- [ ] Document Convex Auth magic-link caveats and the Plunk email-provider path.

### Task 5: Plunk Email Adapter Placeholder

**Files:**
- Create: `packages/email/src/plunk.ts`
- Create: `packages/email/package.json`
- Create: `packages/email/tsconfig.json`
- Modify: `.env.example`

- [ ] Create a small Plunk client wrapper that reads endpoint/key values lazily at call time.
- [ ] Add environment names for public key, secret key, API base URL, and sender address.
- [ ] Ensure real secrets are only in local/Vercel env, never committed.

### Task 6: Vercel Project and Domain

**Files:**
- Create or modify: `.vercel/project.json`
- Create: `docs/deployment/vercel.md`

- [ ] Link or create the Vercel project under the Z360 team.
- [ ] Set root directory/build settings for `apps/web`.
- [ ] Add safe environment variables by name only in docs.
- [ ] Add `accounting.zikrainfotech.com` to Vercel and capture the DNS record Ansar must create.

### Task 7: Verification

**Files:**
- Modify as needed based on errors.

- [ ] Run package install.
- [ ] Run lint/type/build checks that exist.
- [ ] Start the local dev server.
- [ ] Open the app in the in-app browser and verify the first screen renders.
- [ ] Record remaining blockers and next integration steps for Plaid, Stripe, and AI.
