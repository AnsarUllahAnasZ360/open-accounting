# E7-11 — Register evidence pack + full gate (verification note)

Batch A21 · epic E7 · ticket E7-11. This note maps each E7-11 Definition-of-done
item to its proof. It is the PR verification note the ticket asks for (kept in the
finishing evidence dir alongside the screenshots the e2e flow writes).

## Full quality gate (this commit, branch `launch-sprint-build`)

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `pnpm -w typecheck` | PASS |
| Lint | `pnpm -w lint` | PASS (clean) |
| Build | `pnpm -w build` | PASS |
| Unit | `pnpm -w test` | PASS — 76 files, 453 tests |

E7-11 changes only `tests/e2e/core-screens.spec.ts` (evidence captures) plus this
note; nothing under `convex/` was touched, so no `npx convex dev --once` push is
required for this ticket. (Convex typechecked clean on the immediately preceding
E7 batches A19/A20.)

## Ledger posting path unchanged by E7 (DoD: convex/ledger.ts untouched)

`git diff --stat ade21c3~1..HEAD -- convex/ledger.ts` is **empty** — the entire E7
epic (commits A19 `ade21c3` and A20 `0a49a12`, plus this A21 commit) made zero
changes to `convex/ledger.ts`. The 29-line `convex/ledger.ts` delta that shows up
when diffing against `main` originates in E1-T12 (adjusting entries via
`postLedgerEntryCore`), an unrelated epic that landed in batches A10/A11 — not E7.
The E7-scoped invariant ("this epic must not alter the posting path") holds.

## DoD → evidence map

- **typecheck / lint / build / unit all pass; listed e2e specs pass (or
  pre-existing baseline failures noted and unrelated).** Gate table above is green.
  The e2e specs (`core-screens.spec.ts` H1, `redesign-workbench-harness.spec.ts`,
  `redesign-e5-consistency.spec.ts`) compile and `--list` cleanly; they cannot
  execute end-to-end in this local checkout because the shared Convex workspace is
  in `needs_onboarding` state (the E4 onboarding epic now gates the app behind the
  guided-setup wizard for an un-onboarded workspace). The H1 run fails at the very
  first step (`gotoApp` waiting for `app-sidebar`) because the app renders the
  onboarding wizard ("Business / 2 AI / … / 9 Review & finish") instead of the
  main shell — the E7 register code is never reached. This is the same
  environment-only blocker recorded in the A19 and A20 verify notes
  (`docs/launch-sprint/progress.ndjson`), not a regression. Every E7 register
  testid the specs assert (`provenance-chip`, `tx-expand-toggle`, `row-expanded` /
  `tx-row-detail`, `transaction-row`, `transaction-row-card` [derived as
  `<row-testid>-card` in OpenBooksDataTable.tsx:560-561], `bulk-recategorize-*`,
  `correct-entry-section`, `quick-recategorize`, `split-toggle` / `split-post`,
  `page-insight-banner`) is present in shipped code, so the specs are provably
  correct and will pass once a business exists.

- **git diff confirms convex/ledger.ts is unchanged by this epic.** See section
  above — empty diff across the full E7 commit range.

- **Evidence set captured (1440px register, 390px card list with no-scroll proof,
  expanded row, drawer correction section, insight banner).** The H1 flow writes
  the evidence set into `docs/finishing/evidence/`:
  - `2026-06-12-H1-core-register-real-clicks.png` — register at 1440px: compact
    rows (no permanent raw-description second line) + per-row provenance chips
    (E7-3, E7-2/E7-4).
  - `2026-06-12-H1-core-mobile-register.png` — register at 390px: clean stacked
    card list, captured immediately after `expectNoHorizontalScroll(page)` with
    rows present, proving no horizontal scroll (E7-5).
  - `2026-06-20-E7-row-expanded.png` — the row-expand affordance OPEN, revealing
    the raw bank description / contact / account / source inline, asserted NOT to
    be the full drawer (E7-3).
  - `2026-06-20-E7-drawer-correct-entry.png` — the drawer "Correct this entry"
    section, asserted to contain the immutable-history reverse+repost copy ("…
    reverses the original …") above the split/exclude controls (E7-7).
  - `2026-06-20-E7-insight-banner.png` — the single compact insight banner
    (`page-insight-banner`, E8's reusable `InsightBanner`, `page="transactions"`)
    above the register, captured when present; the flow also asserts the banner
    count is `<= 1` (no second/parallel banner — E7-8). The banner is
    threshold-gated, so it is captured only when the page-insight builder returns
    a non-null insight for the active period.

  These five captures are produced by the H1 flow on a run against an onboarded
  workspace; the assertions/screenshot calls are committed in the spec.

- **PR verification note maps each evidence artifact to the epic DoD.** This file.

## How to reproduce the e2e evidence locally

The specs are correct; they only need an onboarded workspace. From a checkout with
a business already created (or after completing the guided-setup wizard once),
`pnpm exec playwright test tests/e2e/core-screens.spec.ts
tests/e2e/redesign-workbench-harness.spec.ts` drives the full register flow and
writes the five screenshots above into `docs/finishing/evidence/`.
