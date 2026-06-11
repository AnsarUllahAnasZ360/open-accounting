## OpenBooks Agent Contract

This repo is the OpenBooks initiation branch. Treat it as a product reset with a
usable technical scaffold, not as a finished implementation.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may
all differ from your training data. Read the relevant guide in
`apps/web/node_modules/next/dist/docs/` before writing any Next.js code. Heed
deprecation notices.
<!-- END:nextjs-agent-rules -->

## Product North Star

OpenBooks is free, open-source, AI-assisted bookkeeping for small businesses.
The owner experience is plain English; the system of record is a hidden,
double-entry ledger.

Core rule: AI proposes. The ledger engine posts.

The mandatory v1 loop is:

1. Money data enters through Plaid, Stripe, CSV/OFX, invoices, bills, receipts,
   payroll register, or manual entry.
2. The pipeline attempts transfer/match/rule/memory/AI classification.
3. Confident items post through one ledger mutation.
4. Uncertain items go to the Inbox.
5. Reports query journal lines, not ad hoc category totals.

## Ansar Working Agreement

- Explain decisions at a founder/operator level: what changes, why it matters,
  and what business outcome it creates.
- Avoid code snippets in user-facing summaries unless Ansar asks.
- Use concepts and examples when a technical term matters.
- Be direct about tradeoffs, missing access, incomplete functionality, and
  verification gaps.
- If a public review artifact is created, publish it with the artifact-publisher
  skill after scanning for secrets and include the public URL and expiry.
- Every published HTML artifact must include an AI copy button that copies the
  full artifact source code.

## Source Of Truth

Read these before feature work:

- `docs/finishing/implementation-plan.md` — the active work contract (epics A–H)
- `docs/finishing/audit-report.md` — verified state of the codebase at handoff
- `docs/finishing/opus-launch-prompt.md` — execution protocol for this branch
- `docs/initiation/goal.md` — the prior run's completion contract (history)
- `docs/initiation/task-list.md` — milestones M0–M13
- `docs/initiation/access-and-questions.md` — env/key runbook + answered decisions
- `docs/initiation/acceptance.md` — the verification walkthrough
- `docs/initiation/build-decisions.md`
- `docs/product/01-vision-and-scope.md` (canonical copies; originals preserved
  in `OpenBook - Prototype/uploads/`)
- `docs/product/02-product-spec.md`
- `docs/product/03-design-brief.md`
- `docs/product/04-build-plan.md`
- `OpenBooks Design System/readme.md`
- `OpenBooks Design System/SKILL.md`

## Technical Rules

- Use Next.js App Router, React, TypeScript, Tailwind, and shadcn/ui.
- Use Convex for backend functions, database, jobs, auth, and HTTP actions.
- Before editing Convex backend code, run `npx convex ai-files install` and read
  the generated Convex AI guidelines.
- Keep external network calls in Convex actions.
- Keep transactional writes in Convex mutations.
- Every query/mutation/action must re-check workspace/entity authorization on
  the server.
- Money must be integer minor units plus currency code. Never use floats for
  stored financial amounts.
- Posted journal entries are immutable. Corrections must reverse and repost.
- One mutation must own ledger posting and enforce that debits equal credits.
- AI autonomy thresholds are a single shared constant: suggest = never
  auto-post, balanced = 0.90, autopilot = 0.75.
- Only Plaid sandbox and Stripe test-mode keys may be used in this goal; live
  keys are banned from every env store.
- No API key, banking token, payroll detail, customer financial record, or copied
  env file may be committed.

## Design Rules

- Match the OpenBooks design system: white ledger-like surfaces, Geist fonts,
  lucide icons, one brand green `#2ca01c`, quiet AI affordances.
- Do not use gradients, purple AI styling, emoji, decorative blobs, glassmorphism,
  or marketing-style dashboard ornament.
- Use shadcn primitives before raw controls.
- Use tabular figures for money. Keep implementation letter spacing at `0`.
- Money in can be green. Ordinary expenses should be neutral, not alarm red.
- Mobile must be a real responsive product surface, not a squeezed desktop page.

## Current Branch Objective

The `finishing` branch closes the gap between the initiation run's strong
accounting foundation and the finished product: prototype-faithful UI (shell,
Income/Expenses, Reports, Settings, Ask AI rebuilt on Convex Agent + AI
Elements), the missing mutations (invoice draft save, bill mark-paid, payroll
approve/pay), real Plaid sandbox + event-driven Stripe, onboarding/workspace/
profile/team, and a verification suite that asserts behavior, not text
presence. The contract is `docs/finishing/implementation-plan.md`; done means
its §0 north star, evidenced in `docs/finishing/completion-report.md`.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
