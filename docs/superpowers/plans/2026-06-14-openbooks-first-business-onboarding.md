# OpenBooks First Business Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block the operational OpenBooks UI until a workspace has at least one business, let owners create the first business inside an existing workspace, and add an AI-operable open-source setup skill scaffold.

**Architecture:** Keep infrastructure setup and business onboarding separate. Convex owns workspace/business state and checklist creation; the web shell gates app access based on the business list; the setup skill documents and scripts the installer path for Vercel, Convex, provider keys, and deployment verification.

**Tech Stack:** Convex mutations/queries, Next.js App Router client shell, React onboarding UI, Vitest/convex-test, Playwright/browser smoke verification, local `.agents` skill scripts.

---

### Task 1: Let Onboarding Create The First Business In An Existing Workspace

**Files:**
- Modify: `convex/onboarding.ts`
- Modify: `convex/onboarding.test.ts`

- [ ] Change `bootstrapWorkspace` so an existing active workspace with zero non-archived businesses creates the first business in that workspace.
- [ ] Keep the old idempotent behavior when at least one active business already exists.
- [ ] Update tests to assert an existing workspace can receive its first business and does not create a second workspace.
- [ ] Run `pnpm exec vitest run convex/onboarding.test.ts`.

### Task 2: Gate Main UI Until A Business Exists

**Files:**
- Modify: `apps/web/src/components/openbooks/AppShell.tsx`
- Modify: `apps/web/src/components/openbooks/OnboardingScreen.tsx`

- [ ] In `AuthenticatedAppShell`, wait for `entities.list` when the workspace is ready.
- [ ] If there are zero active businesses, render `OnboardingScreen` instead of the shell.
- [ ] Pass the existing workspace name into onboarding so the copy says it is creating the first business, not always creating a workspace.
- [ ] Update onboarding finish copy to say “Create business” when the workspace already exists.

### Task 3: Add The OpenBooks Setup Skill Scaffold

**Files:**
- Create: `.agents/skills/openbooks-setup/SKILL.md`
- Create: `.agents/skills/openbooks-setup/scripts/preflight.mjs`

- [ ] Document prerequisites: Vercel, Convex, Plunk, Plaid, Stripe, AI provider, public HTTPS URL.
- [ ] Document secure secret handling: never paste secrets into chat; use Vercel/Convex env stores.
- [ ] Add a preflight script that checks local tools and prints next actions without reading secrets.

### Task 4: Deploy/Verify

**Files:**
- Convex generated files may update through `npx convex dev --once`.

- [ ] Run `npx convex dev --once --typecheck=disable --tail-logs=disable`.
- [ ] Run `pnpm typecheck`.
- [ ] Verify browser `/dashboard` shows onboarding when no businesses exist.
- [ ] Create a business through onboarding and verify dashboard appears.
