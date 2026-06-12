# OpenBooks Finishing Execution Plan

Date: 2026-06-12
Branch: `finishing`
Lead: Codex

## Operating Rules

- Treat `docs/finishing/whats-left.md` as the live map and
  `docs/finishing/completion-report.md` as the honesty ledger.
- Keep Convex on the cloud dev deployment `ceaseless-mandrill-524`; never run a
  local Convex backend.
- Before any Convex code change, run `npx convex ai-files install` and read
  `convex/_generated/ai/guidelines.md`.
- Before any Next.js code change, use the local Next docs under
  `apps/web/node_modules/next/dist/docs/`.
- Do not modify `OpenBook - Prototype/` or `OpenBooks Design System/`.
- Do not attempt Vercel deployment in this run unless Ansar explicitly asks; the
  account changed and deployment is out of scope for the requested testing path.
- A completion row becomes WORKING only with a linked green real-click e2e test,
  screenshots in `docs/finishing/evidence/`, and the batch entry in
  `completion-report.md`.
- Commit once per batch after gates pass.

## Batch Order

### Batch 1: Epic E Settings Verification

Goal: convert acceptance row #9 from PARTIAL to WORKING if the existing Settings
implementation actually behaves as specified.

Scope:
- Add focused Convex unit tests for entity creation/archive, autonomy threshold,
  rule first-match/reorder, and staff rejection for settings mutations.
- Add a real-click Settings e2e covering all 10 sections, deep links, Add a
  business -> switcher visibility -> archive -> hidden, autonomy persistence,
  rule reorder persistence, and audit filtering.
- Capture screenshots for the working behavior.
- Update the completion report only after tests and screenshots exist.

Subagent policy: optional one tightly scoped verification subagent may inspect
Settings tests and UI only. Convex-touching edits stay serialized through the
lead because they push to the shared cloud deployment.

Gates:
- `pnpm verify`
- `npx convex dev --once`
- targeted Settings Playwright spec with real pointer clicks
- Browser spot-check for rendered Settings behavior if the e2e exposes a visual
  or interaction ambiguity

### Batch 2: Ask AI Panel UI, B4-B6

Goal: make acceptance row #8 user-visible by replacing the overlay/fake UI with
the durable Convex Agent thread UI, markdown, tool parts, proposal confirmations,
and a docked panel.

Scope:
- Vendor AI Elements components inside `apps/web`.
- Rebuild the chat panel on `api.aiThreads` and `api.proposals`.
- Remove the legacy keyword-routing UI path.
- Dock the desktop panel as a real 380px column, add `/ask-ai`, and keep mobile
  as a bottom sheet.
- Wire post-import categorization scheduling only after verifying the current
  import entry points and autonomy constant.

Subagent policy: split into UI-docking and categorization pipeline slices if the
diff grows. Convex changes run serially.

Gates:
- `pnpm verify`
- `npx convex dev --once`
- real-click e2e for markdown rendering, thread persistence, proposal confirm,
  docked no-overlap layout, and mobile drawer
- screenshots desktop, docked, full-page, and mobile

### Batch 3: Epic F Identity, Onboarding, Profile, Team, Dev Boot

Goal: make the product startable and ownable: first-run onboarding, profile,
team invites with role enforcement, and one-command local dev.

Scope:
- Build onboarding around workspace/entity creation without disturbing the
  existing owner workspace.
- Add profile data and `/profile`.
- Complete invite create/accept/revoke and role enforcement.
- Add `pnpm dev:full` for local Next + cloud Convex + idempotent owner/seed.
- Polish sign-in/request-access states.

Subagent policy: split into F1/F2 UI and F3/F4 backend/dev-experience if needed;
role enforcement is lead-reviewed because it changes authorization boundaries.

Gates:
- `pnpm verify`
- `npx convex dev --once`
- e2e for brand-new dev onboarding, profile update reflected in sidebar, invite
  accept in a second browser context, staff settings denial, and dev bypass guard
- screenshots desktop and mobile sign-in/onboarding/profile/team

### Batch 4: Epic G Money Rails, Split Into Sub-Batches

Goal: replace fixture-only money rails with real sandbox/test-mode paths while
preserving graceful degraded mode when keys are absent.

Sub-batches:
- G1: Plaid Link token exchange, item storage, account selection, fixture
  fallback.
- G2: Plaid crons/webhook sync and auditable `system:sync` actor.
- G3: Stripe event-driven sync, webhook idempotency, payout line persistence.
- G4: receipt PDF extraction, persisted matching vectors, complete inbox card.
- G5: entity-scoped read models and read-limit pagination guards.

Inputs:
- Fresh Plaid sandbox keys are needed for live Link proof.
- `STRIPE_WEBHOOK_SECRET` is needed for live webhook proof.
- Absence of either input means the batch can still ship degraded fixture mode,
  but the report must mark live proof as BLOCKED or PARTIAL honestly.

Subagent policy: one subagent per G sub-batch at most; Convex pushes are
serialized and integrated by the lead.

Gates:
- `pnpm verify`
- `npx convex dev --once`
- action-level integration where browser automation is not safe or would require
  secrets
- real-click e2e for account selection, sync-now surface, payout drill-down,
  receipt upload, and entity switching
- screenshots for each user-facing rail

### Batch 5: Epic H Verification Closeout

Goal: make the evidence package strong enough that the completion report cannot
overclaim.

Scope:
- Rewrite legacy e2e specs to remove `dispatchEvent` and `force: true`.
- Add shared clickability, no-horizontal-scroll, and money-equality helpers.
- Generate an acceptance evidence pack for the 18 walkthrough rows.
- Run a real categorization eval that strips labels before prediction.
- Add perf/read-limit instrumentation and update docs to shipped reality.

Subagent policy: use independent verification subagents after implementation
batches, then lead reconciles findings into the report.

Gates:
- full `pnpm verify`
- full `pnpm test:e2e`
- `npx convex dev --once`
- evidence files exist for every WORKING claim
- final completion-report self-audit has zero unevidenced WORKING claims

## Immediate Next Step

Start Batch 1. Run the Convex AI guideline refresh/read, inspect the current
Settings files and tests, write failing verification first, then implement only
the fixes required for those tests and screenshots to pass.
