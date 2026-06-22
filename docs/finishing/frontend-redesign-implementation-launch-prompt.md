# OpenBooks Frontend Redesign — Implementation Launch Prompt

Status: ready to launch (research approved 2026-06-13). Paste the block below to start.
The prompt is addressed to Claude Code, which will orchestrate the work as per-epic
workflows with an evidence checkpoint after the foundation.

---

```text
ultracode

Implement the approved OpenBooks frontend redesign. This is a build task, not research.
Work epic by epic, prove each epic with evidence, and STOP for my approval after the
foundation (Epic 1) before rewriting any page.

READ FIRST (do not skip):
- AGENTS.md and CLAUDE.md (the working agreement and hard rules).
- docs/finishing/frontend-redesign-research-report.md (the approved plan — Sections 4, 5,
  6, 7, 8, 9, 10, 11 are the contract; build to them).
- docs/finishing/frontend-redesign-claude-workflow-prompt.md (source feedback + acceptance gates).
- OpenBooks Design System/readme.md, /SKILL.md, and the token/guideline files.
- The prototype HTML for each surface under "OpenBook - Prototype/".
- The current implementation under apps/web/src/ for the surface you are about to touch.
- convex/_generated/ai/guidelines.md before touching any Convex backend code.

APPROVED DECISIONS (already settled — do not re-ask):
- Contacts removal = soft-archive only. Add an `archived` state + "Archived" filter;
  never a destructive delete; preserve all history and audit trail.
- New dependencies approved: install the Vercel AI SDK + AI Elements (for Ask AI) and the
  missing shadcn primitives: drawer, calendar, popover, checkbox, scroll-area, toggle-group.
  Pin versions. Sandbox/test keys only.
- Payroll auto-runs: they do NOT exist today (verified: only cron is Plaid sync at
  convex/crons.ts:7; runs are created manually via startRun at convex/payroll.ts:253).
  Build a net-new backend capability that drafts each period's run from the active employee
  roster for review (a cron or per-entity pay-schedule), and design the Runs UI around an
  explicit "Auto-draft · needs review" vs "Manual" status. Until it ships, the UI must
  honestly present runs as manually generated.
- Process: foundation-first with a review checkpoint (see EXECUTION below).

NON-NEGOTIABLE GUARDRAILS:
- No live Plaid or Stripe keys. Plaid sandbox + Stripe test only. No secrets in the client
  or in git.
- Do not deploy to Vercel or touch hosting. Do not mutate shared demo data.
- Keep the backend contracts intact unless the approved plan explicitly calls for a backend
  change (the only planned backend work is the payroll auto-run capability above).
- Honor the ledger rules: money is integer minor units + currency; posted entries are
  immutable (correct by reverse + repost); one mutation owns ledger posting; AI autonomy is
  the single shared constant. The UI must reflect these, never bypass them.
- Honor the IA decision (Section 4): Transactions is the universal register. Income and
  Expenses are lenses over the SAME transactions + journal lines — never a place a record is
  "moved" to. Their numbers must reconcile with Transactions and Reports for any period.
- Honor the design system: white ledger surfaces, Geist, lucide, one green #2ca01c, quiet
  green AI affordances, hairline borders, tabular/mono money figures, plain-English owner
  copy. No gradients, no purple AI styling, no emoji, no glassmorphism, no decorative
  ornament. Money in can be green; ordinary expenses are neutral, not alarm red.
- Use shadcn/ui primitives before raw controls. Use AI Elements for Ask AI. Use the
  prototype as reference, then build a better product-grade version — do not copy it blindly.

BUILD STRATEGY (component-first; from Section 9):
- Step zero: add the missing design tokens to apps/web/src/app/globals.css BEFORE restyling
  anything (the audit prescribes --negative, --negative-surface, --ai, and an --ob-green tint
  ramp that do not exist yet; classes using them silently no-op until defined).
- Epic 0 — Baseline: capture "before" screenshots of every surface at 390/768/1306/1440/1758
  and record current failures. (Note: current evidence only covers 390 and 1440; add the
  other three widths.)
- Epic 1 — Shared workbench primitives (THE FOUNDATION): WorkbenchPage, PageActionBar,
  DateRangeControl, FilterBar, AccountMultiSelect, KpiStrip, OpenBooksDataTable,
  DetailSheet/RecordDrawer (closed by default), AiInsightBadge, EvidenceUpload, ExportMenu,
  AttentionState, CommandPalette. Build to Section 5. These land before any page work.
- Epic 2 — Shell/header/navigation + Ask AI responsive system (AI Elements rebuild; remove
  provider/debug labels; collapse/dock/expand/mobile-drawer; preserve streaming to the
  existing Convex agent).
- Epics 3–6 — Page workbenches (parallelize once Epic 1 exists): (3) Transactions + Inbox,
  (4) Income + Expenses, (5) Bills/AP + Contacts, (6) Payroll + Reports + Settings.
- Epic 7 — Responsive QA + final evidence pack.

VERIFICATION CONTRACT (every gate names its proof — no "trust me"):
- Visual loop: extend and run the Playwright suite with `pnpm test:e2e`. Locally it reuses
  the running dev server on :3100 (playwright.config.ts, reuseExistingServer). It screenshots
  into docs/finishing/evidence/ and writes an HTML report to
  docs/finishing/evidence/playwright-report. After each run, OPEN the generated screenshots
  (read the PNGs) and judge them like a user before declaring anything done.
- Assertions: use the existing helpers in tests/e2e/helpers.ts —
  expectNoHorizontalScroll(page, width) at all five widths and expectClickable(...) — and add
  specs for the surfaces you change. The real e2e dir is tests/e2e/ (repo root), not
  apps/web/tests/.
- Static gates: `pnpm lint`, `pnpm typecheck`, `pnpm test` (vitest) must stay green.
- Acceptance gates: Section 10 of the report is the checklist. Do not mark a gate passed
  without the named screenshot/test artifact.

EXECUTION PROTOCOL:
1. Run Epic 0, then Epic 1, then Epic 2 (foundation). Run each as its own workflow with a
   responsibly capped concurrency. Keep foundation work single-owner and sequential — it is
   the shared base everything depends on.
2. STOP after the foundation and return an evidence pack: changed files, before/after
   screenshots at the five widths, lint/typecheck/test results, the new primitives with a
   short usage note, risks, and anything that needs my decision. Wait for my approval before
   the page epics.
3. After I approve, run Epics 3–6. The page epics do not depend on each other — parallelize
   them, one workbench per agent, but share the Epic 1 primitives (do not fork them).
4. Run Epic 7: full responsive QA at all five widths + the static gates, and produce a
   consolidated evidence report.
5. Each epic returns: goal, changed files, validation run + results, screenshots, risks,
   blockers, and recommendations.

DONE-WHEN (stop only when all hold):
- No horizontal overflow at 390/768/1306/1440/1758 on every surface.
- No text overlap in Inbox receipt-match, Ask AI, Settings tables, Reports, or transaction
  details.
- Transactions and Contacts are full-width by default; detail/profile panels open only on
  row selection.
- Bills, Income, Expenses, Contacts, Payroll, and Transactions share the same
  table/filter/export/detail interaction language; date ranges are consistent; search and
  filters are local to each workbench; export exists where tabular financial data exists.
- Ask AI collapses/opens/expands and works on mobile without breaking the page, and exposes
  no provider/debug labels.
- Dashboard matches or improves the prototype and keeps the operator-level hierarchy.
- Settings navigation stays usable while content scrolls.
- lint, typecheck, unit tests, and the relevant e2e specs are green (or any failure is
  explained with a fix).
```

---

## How this runs in practice

- Paste the block above to start. Claude will execute Epics 0–2 (baseline → shared
  primitives → shell + Ask AI) as workflows, then pause and hand you an evidence pack.
- You review the foundation, then say "continue" to release Epics 3–6 (the page rewrites,
  in parallel), followed by Epic 7 (responsive QA + final evidence).
- The pause after the foundation is deliberate: it is the highest-leverage, hardest-to-undo
  work, so you approve it before the high-volume page work rides on top of it.
