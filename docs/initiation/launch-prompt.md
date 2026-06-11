# Launch Prompt — Overnight Goal

Date: 2026-06-11 (rev 2)

How to launch (after completing the pre-launch runbook in
`docs/initiation/access-and-questions.md` §1–3):

1. Open Codex in `/Users/ansarullahanas/Documents/OpenBooks` on branch
   `initiation`.
2. Set the goal: paste the **Goal text** below into `/goal`.
3. Send the **Kickoff prompt** below as the first message.
4. Walk away. In the morning, follow `docs/initiation/acceptance.md`.

---

## Goal text (paste into `/goal`)

```text
Deliver the OpenBooks v1 overnight slice defined in docs/initiation/goal.md:
invite-only auth with request-access intake; the design-system app shell and
landing page; a balanced double-entry ledger core (single postEntry mutation,
immutable entries, reversal+repost, period lock, audit log); a Demo entity
("Acme Studio LLC") seeded with 12 months of deterministic books where every
number flows through the ledger; working Dashboard, Inbox, Transactions,
Invoices, Bills, Contacts, Payroll, Reports (with CSV export), and Settings;
live Plaid sandbox and Stripe test-mode connections end-to-end on a Live
Sandbox entity including Stripe clearing/payout reconciliation; Bedrock-powered
categorization (memory + LLM stages with autonomy-threshold routing) and the
chat panel with read tools and propose→confirm actions, plus a working
degraded mode when AI env is absent; receipts upload → extraction → matching
(attempt fully; this one milestone may degrade to upload + manual match with
a logged gap rather than block completion); mobile usability on Dashboard,
Inbox, Transactions, and chat; and a production deployment at
openbooks.ansarullahanas.com (Vercel + Convex prod env). Verified by: pnpm
verify green (typecheck, lint, build, ledger-invariant and golden-report unit
tests), pnpm test:e2e Playwright acceptance suite green, the categorization
eval accuracy reported (target ≥80% — a finding, not a blocker), and the
browser walkthrough in docs/initiation/acceptance.md evidenced with
screenshots in docs/initiation/evidence/ and an honest
WORKING/PARTIAL/BLOCKED table in docs/initiation/completion-report.md. Preserve throughout: no secrets
committed or printed; public sign-up disabled; money as integer minor units;
postEntry is the only ledger write path; posted entries immutable; external
API calls only in Convex actions; per-function workspace authorization; the
OpenBooks design system (Geist, lucide, one green #2ca01c, no gradients, no
purple AI, no emoji); prototype and design-system folders untouched; sandbox/
test keys only. Between iterations: finish a milestone from
docs/initiation/task-list.md, run pnpm verify, capture evidence, tick the
boxes, append to the completion report, commit, then take the next unblocked
milestone; after three failed attempts at the same error, log a blocker and
move on. If blocked on missing access or a decision not covered by
docs/initiation/access-and-questions.md, record the blocker and the exact
input needed in the completion report and continue with the next independent
milestone; stop only when no milestone can proceed or budget is reached,
leaving the app green and the report honest.
```

## Kickoff prompt (first message after setting the goal)

```text
You are Codex working in /Users/ansarullahanas/Documents/OpenBooks on branch
initiation. The goal is set; execute it milestone by milestone.

Read first, in order:
- AGENTS.md
- docs/initiation/goal.md
- docs/initiation/task-list.md
- docs/initiation/access-and-questions.md
- docs/initiation/acceptance.md
- docs/product/01-vision-and-scope.md
- docs/product/02-product-spec.md
- docs/product/03-design-brief.md
- docs/product/04-build-plan.md
- OpenBooks Design System/SKILL.md and readme.md

Start with milestone M0 (preflight). Run npx convex ai-files install before
any Convex backend work and read the generated guidelines. Consult
apps/web/node_modules/next/dist/docs/ before writing Next.js 16 code — APIs
differ from training data.

Execution discipline:
- One milestone at a time from docs/initiation/task-list.md; after each:
  pnpm verify, evidence into docs/initiation/evidence/, tick checkboxes,
  append a dated completion-report entry, conventional commit.
- Use subagents for bounded parallel slices with non-overlapping write scopes
  (e.g., after M5: one agent on M6 screens, one on M7 reports; after M7: one
  on M8 Stripe, one on M9 Plaid). The main thread owns integration, the
  independent review pass (diff vs. AGENTS.md invariants + full test run),
  and commits. Give every subagent: goal, file scope, constraints, and the
  invariants list; require findings + changed files + test results back.
- Respect the sandbox-reality notes in goal.md §5 — the 12 months of data
  come from the seed engine; Stripe payout E2E falls back to fixtures; never
  chase a Stripe-payout↔Plaid-deposit match across sandboxes.
- Key handling: read from .env.local only to distribute into Convex/Vercel
  env stores via CLI; never echo values, never commit them. If a key is
  missing or invalid at preflight, mark the dependent milestone
  fixture-mode, log the blocker, and keep building everything else.
- UI work copies the reference implementations in
  "OpenBooks Design System/ui_kits/openbooks/" and the .dc.html prototypes —
  do not invent a different visual language. Mobile is a first-class surface.
- Anti-spin: three distinct failed attempts at the same error → blocker note
  → next task. Prefer recorded fixtures over flaky external waits. Timebox
  any single external-service debugging session to ~30 minutes.

Begin with M0 now and report the preflight PASS/FAIL table in your first
completion-report entry.
```

---

## Notes for Ansar

- The Goal text is the persistent contract (Codex keeps working until its
  completion conditions are evidenced or it is honestly blocked). The kickoff
  prompt just starts execution; you don't need to repeat anything overnight.
- If Codex asks a question mid-run that's already answered in
  `docs/initiation/access-and-questions.md` §4, point it there.
- To pause: `/goal pause`. To resume: `/goal resume`. To inspect: `/goal`.
- Morning ritual: open `docs/initiation/completion-report.md` first, then walk
  `docs/initiation/acceptance.md` against the live URL.
