# Payroll Module — Build Plan (Epics, Tasks, Definitions of Done)

> Companion to `docs/finishing/payroll-redesign-plan.md` (the design) and
> `docs/finishing/payroll-module-build.workflow.js` (the orchestration).
> This file is the **execution contract**: each epic is built by one agent and
> independently verified by another. An epic is not "done" until every box in its
> Definition of Done is checked with evidence. No epic ships on its own — the whole
> module ships once, gate-green end to end (Ansar: "full module in one pass").

---

## How this is executed (pipeline model)

```
Setup ─ branch feat/payroll-module, record baseSha
        │
   ┌────▼─────────────────────────────────────────────────────────────────┐
   │  for each epic E1…E10 (dependency-ordered):                            │
   │    BUILD(Eᵢ)      ── one agent, edits code, runs scoped gates, COMMITS │  sequential
   │      └─ on commit, launch VERIFY(Eᵢ) ── read-only, reviews the commit  │  overlaps BUILD(Eᵢ₊₁)
   │         diff (baseᵢ..shaᵢ) against the DoD; returns a verdict          │
   └───────────────────────────────────────────────────────────────────────┘
        │  (all builds done; all verdicts collected)
 Repair ─ any FAILED verdict → repair agent → re-verify (bounded 2 rounds)
        │
 Review ─ one code-review agent over baseSha..HEAD → bugs/quality; blocking → 1 fix pass
        │
 Gate   ─ run the FULL suite on HEAD (typecheck+lint+build+unit+e2e+convex) → bounded repair until green
        │
 Report ─ one agent writes docs/finishing/evidence/payroll-module-build-report.md and returns it to you
```

**Why builds are sequential but verifies overlap.** Each epic edits shared files
(`schema.ts`, the payroll component folder, the route) and depends on the one before
it, so only one build agent runs at a time. Verification is read-only and runs against
the **committed git object** of the epic (`git diff baseᵢ..shaᵢ`), which is immutable —
so VERIFY(Eᵢ) can run safely *while* BUILD(Eᵢ₊₁) mutates the working tree. That is the
"one executing, one verifying the previous" simultaneity, without a file race.

**Authoritative testing happens twice:** the BUILD agent runs the scoped gates on the
live tree *before it commits* (it's the only writer at that moment, so no race), and the
final **Gate** phase runs the complete suite on HEAD as the single source of truth.

---

## Conventions (every epic)

- **Branch / commits.** Work on `feat/payroll-module`. Each build agent ends with
  `git add -A && git commit -m "feat(payroll): <Eid> <title>"` and returns
  `git rev-parse HEAD` as `commitSha`. Never commit secrets, `.env*`, or real bank/PII data.
- **Gates (run from repo root `/Volumes/SSD/OpenBooks`).**
  - `pnpm typecheck` · `pnpm lint` · `pnpm test` (vitest) · `pnpm build`
  - `pnpm test:e2e` (Playwright; auto-starts the web dev server on :3100; final Gate phase only)
  - `npx convex dev --once` (after any `convex/` change — must deploy clean)
  - combined fast gate: `pnpm verify` (= typecheck && lint && build && test:unit)
- **Read before you build.** `docs/finishing/payroll-redesign-plan.md` (design),
  this file's epic section, `convex/_generated/ai/guidelines.md` (before any `convex/`
  edit), and the skills `.claude/skills/{shadcn,frontend-design}/SKILL.md`.
- **Reuse the workbench toolkit** from `@/components/openbooks/workbench` — do not
  re-implement tables/filters/detail/KPIs. Use `WorkbenchPage`, `WorkbenchToolbar`,
  `SavedViews`, the insight strip (`MiniCashflowStrip`/`KpiStrip`), `OpenBooksDataTable`
  (`ColumnDef`, `rowAttributes` to keep e2e testids), `DetailSheet`, `Amount`/`formatMinorMoney`.
- **Ledger invariant (non-negotiable).** *AI proposes, the ledger posts.* Posting
  happens **only** through the existing `approveRun` / `markLinePaid` / `markRunPaid`
  server mutations — never client-side, never a new posting path. Posted entries are
  immutable. Money is integer **minor units** + currency code; never a float. The
  redesign is **additive** — it must not change what approval/settlement post.
- **Schema is additive.** Every new field is `v.optional(...)`; existing rows must keep
  validating. New child tables instead of unbounded arrays. All new fields indexed where
  queried (`withIndex`, never `.filter`; bounded `.take`/`.paginate`, never raw `.collect`).
- **Authz on every function.** `requireWorkspaceRole(member)` for reads,
  `getEntityForWrite(admin)` for writes; re-check entity scope server-side. `payTo`
  (bank details) is returned **only to admins** and never logged or seeded.
- **Design system.** White ledger surfaces; Geist + `money-figures` tabular; one brand
  green `#2ca01c`; AI affordances green (never purple/gradient); status chips Draft=neutral,
  Approved=info-blue, Paid=green; no emoji/gradient/glass; shadcn primitives before raw
  controls; mobile is a real responsive surface (card stacks / bottom drawer), not a
  squeezed table.
- **Preserve e2e testids.** `modules.spec.ts` / `reports-payroll.spec.ts` assert payroll
  testids (`m6-payroll-screen`, `payroll-run-row`, `payroll-run-detail`, `payroll-line-row`,
  `payroll-base-total`, `payroll-approve`, `payroll-approved-banner`, `payroll-mark-paid`,
  `payroll-currency-totals`, `payroll-statement-csv`, `payroll-back`, `payroll-error`, and
  USD/INR/PKR payroll text + "Printable statement"). Keep them working through every epic.

## Global Definition of Done (applies on top of each epic's DoD)

- [ ] Scoped `pnpm typecheck`, `pnpm lint`, `pnpm test` green; `npx convex dev --once` clean if `convex/` touched.
- [ ] No existing unit test regressed; ledger tests (`convex/payroll.test.ts`, `convex/ledger.test.ts`) green.
- [ ] No e2e testid dropped/renamed; no new console errors.
- [ ] Design-system + responsive (390/768/1306/1440/1758) compliant for any UI.
- [ ] Committed with a conventional message; `commitSha` returned.
- [ ] Risks / follow-ups / honest gaps flagged (never fake green or imply automation that doesn't run).

---

## The epics

### E1 — Data foundation: schema, migration, payroll math  *(blocking; everything depends on it)*

**Goal.** Widen the model additively and add the math, so all later epics have stable types.
**Depends on.** —
**Owns.** `convex/schema.ts` (payroll tables + new tables), `convex/payrollMath.ts`,
a migration (`convex/payrollMigrations.ts` via `@convex-dev/migrations` or a one-off
`internalMutation`), `convex/crons.ts` (repoint auto-draft).

**Tasks.**
1. Widen `employees` with the optional fields in redesign-plan §4.1 (employeeNumber, email,
   title, departmentId, locationId, employmentType, reportingManagerId, startDate, exitDate,
   exitReason, paymentMethod, **full** `payTo` object, notes). Add indexes
   `by_entity_and_active`, `by_manager`, `by_entity_and_department`.
2. New tables (§4.2/4.3/§7/§9): `employeeCompensationEvents`, `payrollDepartments`,
   `payrollLocations`, `payrollSettings` (absorbs `paySchedules.cadence/enabled` + adds
   workingDaysBasis/fixedStandardDays/payDayOfMonth/autoNotifyOnApproval/payslipNote/
   replyToEmail/letterheadFileId), `payslipDeliveries`. Index each `by_entity` (+ `by_run`,
   `by_employee` where noted).
3. Widen `payrollRunLines` (§5.1): standardDays, workedDays, earnedBaseMinor, bonusMinor,
   deductionMinor, manualFinalLocalMinor, remark; add index `by_employee`.
4. Widen `payrollRuns` (§5.2): standardDays, notes, payDate, notifiedAt.
5. `payrollMath.ts`: add `proratedBaseMinor(base, worked, standard)`, working-days-basis
   helpers (calendar days of period / fixed / business days), and `finalLocalMinor` =
   `manualFinal ?? (earnedBase + bonus − deduction)`. Keep FX + baseEquivalent unchanged.
6. Migration (widen→migrate→narrow): backfill every `payrollRunLines` row —
   `workedDays=standardDays`, `earnedBaseMinor=baseSalaryMinor`, split legacy signed
   `adjustmentMinor` into `bonusMinor`/`deductionMinor`; create one `payrollSettings` per
   entity from `paySchedules`. Idempotent.
7. Repoint the auto-draft cron to read `payrollSettings.autoDraftEnabled/cadence` (stay demo-safe no-op).

**Definition of Done.**
- [ ] `npx convex dev --once` deploys clean; all new fields optional; existing rows still validate.
- [ ] `payrollMath` unit tests: proration, bonus/deduction, working-days basis, FX unchanged.
- [ ] Migration is idempotent, has a test, and **reconstructs the identical `finalLocalMinor`
      and `baseEquivalentMinor`** for legacy lines (prove ledger-neutrality with a test).
- [ ] `convex/payroll.test.ts` still green (approval/settlement posting unchanged).

---

### E2 — Employee & lifecycle backend

**Goal.** Server functions for the roster and lifecycle.
**Depends on.** E1.
**Owns.** `convex/employees.ts` (new).

**Tasks.** `list` (paginated; filter by department/location/status via indexes), `get`
(joins comp history + payroll history via `payrollRunLines.by_employee`), `create`, `update`,
`recordCompensationEvent` (append an `employeeCompensationEvents` row **and** patch
`employees.monthlySalaryMinor` atomically — this is "add increment / log appraisal"),
`markExited` (set `active=false`, `exitDate`, `exitReason`), `directReports` (via `by_manager`).

**Definition of Done.**
- [ ] Validators on every function; `requireWorkspaceRole` reads / `getEntityForWrite(admin)` writes.
- [ ] `payTo` is returned **only** to admins (member-facing queries omit it) — covered by a test.
- [ ] Bounded queries via indexes (no `.filter`, no unbounded `.collect`).
- [ ] Tests: create/update, increment updates salary + appends event, exit excludes from drafts,
      directReports, and an authz test (member blocked from writes / payTo hidden).

---

### E3 — Runs, worksheet, statements, settings & insights backend

**Goal.** Generation + worksheet edits + statements + settings + insights — ledger untouched.
**Depends on.** E1 (E2 for employee joins).
**Owns.** `convex/payroll.ts` (extend), `convex/payrollStatements.ts` (new),
`convex/payrollSettings.ts` (new; + departments/locations CRUD), `convex/payrollInsights.ts` (new).

**Tasks.**
1. `payroll.ts`: `generateRun` (wrap `startRun`: accept `standardDays` + employee selection;
   **auto-prorate** mid-month joiners/leavers from start/exit dates; default `standardDays`
   from `payrollSettings` working-days basis). Extend `updateRunLine` args with workedDays,
   bonusMinor, deductionMinor, remark, manualFinalLocalMinor → recompute earnedBase/final/
   baseEquivalent + run total. `runDetail` returns the new breakdown. `approveRun`/
   `markLinePaid`/`markRunPaid` **unchanged**.
2. `payrollStatements.ts`: `employeeStatement` (by_employee + comp events), `runWorksheet`,
   `payslipData`.
3. `payrollSettings.ts`: `getPayrollSettings`, `updatePayrollSettings`, departments CRUD, locations CRUD.
4. `payrollInsights.ts`: `payrollInsights(range)` → KPIs + cost trend + breakdowns
   (department/location/title/top-earners/bonus-deduction/headcount); bounded aggregation.

**Definition of Done.**
- [ ] Ledger posting path re-proven unchanged: a test edits a worksheet line (bonus/deduction/
      proration), approves, and asserts the posted entry equals the new `finalLocalMinor`
      base-equivalent and **debits == credits**.
- [ ] Insights aggregation tests; settings persist (tested); authz on all.

---

### E4 — Payslip PDF + Plunk email backend

**Goal.** Generate payslip/worksheet documents and notify employees via the existing Plunk integration.
**Depends on.** E1, E3.
**Owns.** `convex/payrollPdf.ts` (new, `"use node"`), `convex/payrollEmail.ts`
(new, `"use node"`), `convex/payslips.ts` (new; queries/mutations for `payslipDeliveries` +
`payslipUrl`). **Keep queries/mutations out of the `"use node"` files.**

**Tasks.** `generatePayslipPdf(lineId)` / `generateWorksheetPdf(runId)` → render → `ctx.storage`
→ `fileId`. `payslips.ts`: `recordPayslipDelivery`, `listDeliveries`, `payslipUrl`
(`ctx.storage.getUrl`). `sendPayslipNotifications(runId)` → per line with `employee.email`,
render/link payslip → reuse `sendPlunkEmail` from `packages/email` (mirror `convex/requestAccess.ts`
if workspace-package import into Convex is awkward) → `recordPayslipDelivery`. Idempotent
(skip already-sent); env-gated on `PLUNK_SECRET_KEY` (degrade to status `"skipped: not configured"`,
never throw).

**Definition of Done.**
- [ ] `"use node"` only in action files (no queries/mutations there); deploys clean.
- [ ] With `PLUNK_SECRET_KEY` unset, send degrades to a recorded `skipped` status (test, no throw).
- [ ] Delivery records + idempotency tested (mock the send); payslip data accurate.
- [ ] If a server PDF lib isn't feasible in Convex Node, FLAG it and fall back to a stored
      payslip HTML + signed link (honest), so the email still links to something real.

---

### E5 — Module shell, routing, sub-nav & Overview *(first frontend epic)*

**Goal.** Make Payroll a real multi-page module; ship the Overview landing.
**Depends on.** E1–E3.
**Owns.** `apps/web/src/app/payroll/[[...view]]/page.tsx` (new optional catch-all),
`apps/web/src/components/openbooks/payroll/PayrollModuleShell.tsx`, `.../PayrollOverview.tsx`
(new), `apps/web/src/lib/openbooks/payroll-nav.ts` (new), `apps/web/src/components/openbooks/AppScreen.tsx`
(retire the `/payroll` branch), `apps/web/src/lib/openbooks/content.ts` (summary tweak).

**Tasks.** Optional catch-all route (await `params`, validate `view ∈ {undefined, people, runs,
statements, insights}` else `notFound()`; replicate `[section]/page.tsx` auth/layout/metadata).
Shell: page header + `⌘K`/Ask-AI portaled to `#ob-topbar-page-actions` + underline sub-nav
driven by `usePathname` (no `useSearchParams`). Overview: latest-run card (worksheet preview +
contextual Review/Mark-paid/Send actions) + insight strip + by-currency + recent runs +
**Generate payroll** CTA. Verify `app/payroll/` route precedence over `[section]`.
**Bridge:** to avoid e2e regressions before E6/E7 land, temporarily mount the existing
`PayrollScreen` content under `/payroll/{people,runs,statements}` (keep all current testids).

**Definition of Done.**
- [ ] `/payroll` and `/payroll/{people,runs,statements,insights}` resolve and inherit auth/layout.
- [ ] Sub-nav active states correct; Overview renders real latest-run data; Generate CTA opens E7's dialog (or a stub that no-ops cleanly until E7).
- [ ] Existing payroll e2e still green via the bridge; no console errors; responsive; design-system compliant.

---

### E6 — People workbench, employee detail & lifecycle UI

**Goal.** The roster as a Transactions-style workbench with full lifecycle.
**Depends on.** E2, E5.
**Owns.** `apps/web/src/components/openbooks/payroll/{PeopleWorkbench,EmployeeDetailSheet,EmployeeFormDialog}.tsx` (new).

**Tasks.** People on `WorkbenchToolbar` + insight strip + `OpenBooksDataTable`
(name/title/dept/location/monthly-pay/status; filters dept/location/status). `EmployeeDetailSheet`
(`DetailSheet`) with Profile / Compensation / Payroll-history tabs. `EmployeeFormDialog` (add/edit,
all fields incl. admin-gated `payTo`). Lifecycle actions: add increment, log appraisal (→
`recordCompensationEvent`), mark exited (reason). Replace the bridge People tab.

**Definition of Done.**
- [ ] Workbench-consistent (toolbar/insight/table/sheet); add/edit persists; increment/appraisal
      appends history + updates pay; exit excludes from future drafts.
- [ ] `payTo` only shown to admins; responsive (mobile card list + bottom drawer); e2e testids present.

---

### E7 — Runs workbench, Generate flow & editable worksheet

**Goal.** Generate → adjust → approve → mark paid, on the workbench.
**Depends on.** E3, E5.
**Owns.** `apps/web/src/components/openbooks/payroll/{RunsWorkbench,GeneratePayrollDialog,RunWorksheetSheet}.tsx`
(new). Replaces the bridge Runs tab + the old card-per-row run detail.

**Tasks.** Runs `OpenBooksDataTable` (status chips, by-currency column, `payroll-run-row`).
`GeneratePayrollDialog` (period + working-days basis + employee selection → `generateRun` → opens
worksheet). `RunWorksheetSheet` = editable `OpenBooksDataTable` with inline cells (worked days,
bonus, deduction, remark, final override; `InlineCategoryCombobox` edit pattern) + Review→Approve→
Mark-paid stepper. **Approve via existing `approveRun` wrapped in an AlertDialog confirm — never
client-side.** Mark paid via `markRunPaid`/`markLinePaid`. Move the Auto-run banner into the Runs
insight area.

**Definition of Done.**
- [ ] End-to-end: generate → edit recomputes line+totals → approve posts (server) → mark paid settles.
- [ ] Posting only via server mutations behind an AlertDialog; all preserved payroll testids present;
      `reports-payroll.spec.ts` + `modules.spec.ts` green.
- [ ] Worksheet reflows to card-per-row on mobile; design-system compliant.

---

### E8 — Statements & payslips UI + print route

**Goal.** Downloadable worksheets, employee statements, viewable/printable payslips.
**Depends on.** E3, E4, E5.
**Owns.** `apps/web/src/components/openbooks/payroll/{StatementsScreen,PayslipView}.tsx` (new),
`apps/web/src/app/payroll/payslip/[lineId]/page.tsx` (new print route).

**Tasks.** Statements register (by-month / by-employee toggle, `OpenBooksDataTable`); worksheet
CSV (`payroll-statement-csv`) + PDF download; employee statement (history + YTD); payslip
view/print route; "Send payslips" action (calls E4; shows "N sent" delivery status, degrades when
Plunk unconfigured).

**Definition of Done.**
- [ ] Month + employee statements render; worksheet/payslip downloads work (PDF or honest fallback);
      print route prints cleanly; send-payslips reflects real delivery status; responsive; gates green.

---

### E9 — Insights UI + Payroll Settings UI

**Goal.** Mercury-style payroll analytics + a Payroll settings section.
**Depends on.** E3, E5.
**Owns.** `apps/web/src/components/openbooks/payroll/PayrollInsights.tsx` (+ chart pieces, new),
`apps/web/src/components/openbooks/settings/PayrollSettingsSection.tsx` (new),
`apps/web/src/lib/openbooks/settings-sections.ts` (register `payroll`),
`apps/web/src/components/openbooks/SettingsScreen.tsx` (branch it),
`apps/web/src/components/openbooks/InsightsScreen.tsx` (global payroll tab reuses `PayrollInsights`).

**Tasks.** Insights: KPIs + cost-trend chart (recharts via shadcn chart / `DashboardViz`) + AI
bullets (`aiInsights`) + breakdowns (dept/location/top-earners/bonus-deduction/headcount). Settings:
pay schedule + auto-draft toggle, working-days basis, departments managed list, locations managed
list, payslip & notification settings; register the section + nav group. Reuse `PayrollInsights` in
the global `/insights` payroll tab.

**Definition of Done.**
- [ ] Insights render from real data; settings persist; `/settings/payroll` deep-links; global insights
      payroll tab reuses the component; design-system compliant; responsive; gates green.

---

### E10 — Integration, e2e, full gate-green & evidence

**Goal.** Prove the whole module works and is consistent with Transactions.
**Depends on.** E1–E9.
**Owns.** `tests/e2e/payroll-module.spec.ts` (new; may extend `modules.spec.ts`/`reports-payroll.spec.ts`),
`docs/finishing/evidence/payroll-module/*` (screenshots). Integration fixes only.

**Tasks.** e2e for overview / people (add+edit+increment+exit) / runs (generate→adjust→approve→
mark-paid) / statements (download+payslip) / insights / settings + a responsive matrix at
390/768/1306/1440/1758. Run the FULL suite (`pnpm verify` + `pnpm test:e2e` + `npx convex dev --once`).
Capture responsive evidence. Walk the Transactions-consistency checklist (redesign-plan §12). Fix
integration issues.

**Definition of Done.**
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm build` + `pnpm test` + `pnpm test:e2e` all green
      (or e2e honestly reported if the agent environment can't start Convex/dev server — never faked).
- [ ] New payroll e2e specs pass; consistency checklist satisfied; evidence captured.
- [ ] Ledger invariants intact (`payroll.test.ts` / `ledger.test.ts` green).

---

## Verdict & report shapes

**Per-epic verdict** (the VERIFY agent returns this against `git diff baseᵢ..shaᵢ`):
`{ epicId, pass, dodChecklist:[{item, met, evidence}], gatesClaimed:{typecheck,lint,unit,convex},
defects:[{severity, file:line, issue, fix}], ledgerSafety, risks }`.

**Final report** (`docs/finishing/evidence/payroll-module-build-report.md`): per-epic status +
DoD coverage, all verdicts, repairs applied, code-review findings + resolutions, the final gate
results (every command + pass/fail), the Transactions-consistency checklist, honest gaps
(e.g. Plunk key not set → email "configured but unsent"), and a one-paragraph executive summary
for Ansar.
