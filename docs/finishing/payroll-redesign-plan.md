# Payroll Module — Redesign & Implementation Plan

> Status: proposal for review (no feature code written). Author: agent run, 2026-06-14.
> Scope: reimagine Payroll as a structured, lightweight, manual payroll module that
> is visually and structurally consistent with the Transactions workbench, backed by
> a clean Convex data model, with a phased build plan.

---

## 0. Research basis (verified against the codebase)

| Area | Finding | Source |
| --- | --- | --- |
| Design gold standard | Transactions = `WorkbenchPage → PageHeader → WorkbenchToolbar (SavedViews + filter pills + chips + group/sort/display/add) → MiniCashflowStrip (insights, togglable) → OpenBooksDataTable (sticky header, mobile cards, grouping, inline edit, bulk actions) → DetailSheet (right panel ≥1280px / bottom drawer mobile)` | `apps/web/src/components/openbooks/CoreScreens.tsx` + `components/openbooks/workbench/*` |
| Current Payroll UI | Monolithic in `ModuleScreens.tsx:2058–2900`. Diverges: `WorkbenchPage hideHeader` + raw `PageActionBar`; bespoke `KpiStrip` **plus** orphaned currency `Badge`s; `FilterBar` (no saved views, no trailing cluster) instead of `WorkbenchToolbar`; main-page Tabs (People/Runs/Statements); a card-per-row worksheet (`PayrollRunLineCard`) instead of an editable table; Auto-run banner buried inside the Runs tab. | `ModuleScreens.tsx` |
| Routing | Sections resolve through `app/[section]/page.tsx → AppScreen` (a hard-coded `if route.href === "/payroll"` dispatch). Registry: `lib/openbooks/content.ts → appRoutes`. Payroll = `Building2` icon. Sidebar (`AppShell.tsx`) maps `appRoutes` flat — no sub-items. | `app/[section]/page.tsx`, `AppScreen.tsx`, `content.ts`, `AppShell.tsx` |
| Sub-nav precedent | In-page shadcn `Tabs` (`variant="line"`) — used by current Payroll and by `InsightsScreen`. `WorkbenchPage` has **no** sub-nav slot. Settings uses a left rail (`SETTINGS_NAV_GROUPS`) via `app/settings/[section]/page.tsx`. | `InsightsScreen.tsx`, `WorkbenchPage.tsx`, `settings-sections.ts` |
| Backend | `employees` (name/country/currency/monthlySalaryMinor/active only), `paySchedules` (cadence/enabled), `payrollRuns` (period/status/source/totals/ledger refs), `payrollRunLines` (single signed `adjustmentMinor`, `fxRateMicros`, final/baseEquivalent, paid + settlement refs). | `convex/schema.ts:538–610` |
| Ledger integration | One posting mutation. Approval posts `5000 expense / 2200 payable`; settlement posts `2200 payable / bank` + FX gain `4200` / loss `6999`. Run state machine `draft → approved → paid`. Auth via `requireWorkspaceRole` / `getEntityForWrite(admin)`. Auto-draft cron is demo-safe. | `convex/payroll.ts`, `convex/ledger.ts`, `convex/crons.ts` |
| Money / tokens | `Amount` + `formatMinorMoney` in `primitives.tsx`; `.money-figures` (Geist Mono, tabular). Brand `--primary #2ca01c`, `--positive`/`--negative`/`--warning`/`--ai`, semantic surfaces, green ramp — `app/globals.css`. | `primitives.tsx`, `globals.css` |

**Key structural insight:** the backend is small, ledger-correct, and worth *keeping*. The work is (1) a UI rebuild onto the shared workbench primitives, (2) an **additive** data-model widening (employee HR fields, run-line breakdown, new sibling tables), and (3) new surfaces (statements/payslips, insights, settings, email). The ledger posting path does **not** change.

---

## 1. Executive recommendation

Rebuild Payroll as a **module** (its own shell with internal sub-navigation), where **every sub-view is a Transactions-style workbench**. Keep the existing ledger engine. Widen the data model additively. Ship in slices.

**The thesis in one line:** *Payroll is the Transactions workbench applied to people and pay periods — same header, same toolbar, same table, same detail sheet — organised into five addressable pages.*

Five decisions that define the redesign:

1. **Module, not a flat page.** Promote the current in-page tabs to real, addressable sub-routes under `/payroll/*` with a shared module shell. Each sub-route is its own workbench.
2. **Adopt the shared workbench primitives verbatim.** Replace `KpiStrip`+orphaned badges with the standard insight strip + KPI band; replace `FilterBar` with `WorkbenchToolbar` (+ SavedViews); replace the card-per-row worksheet with an `OpenBooksDataTable` of inline-editable cells. Delete the bespoke header.
3. **Breakdown is additive; the ledger is untouched.** Add working days, bonus, deduction, remark, and an optional final-payable override to the *line*, but keep posting `finalLocalMinor → baseEquivalentMinor`. No ledger risk.
4. **Lifecycle via child tables, not arrays.** Salary changes (increment/appraisal) and exits become first-class, queryable history — never an unbounded array on the employee doc (Convex rule).
5. **Email + payslips reuse the existing Plunk integration.** Payslip notifications call the shared `packages/email` `sendPlunkEmail` client already used for invites/request-access — no new provider. Sending activates once `PLUNK_SECRET_KEY` + `PLUNK_FROM_EMAIL` are present in the Convex env (degrades cleanly to "not configured" otherwise, exactly like invites today).

> **Ansar's decisions (2026-06-14), baked into this plan:** build the **full module in one pass** (not incremental ship); **email = Plunk** (reuse existing integration); **store full employee bank details** (admin-only reads). The slice list in §13 is therefore a *build order within one delivery*, not separate releases.

What we are **not** building (explicit scope cuts): automated deposits/payouts, time tracking, leave management, an employee portal, statutory/tax engines, multi-step approval chains, typed bonus/deduction taxonomies. These are noted as v2+.

---

## 2. Module structure & sub-navigation

### 2.1 Recommended sub-navigation (5 views)

| Order | Route | Label | Job | Workbench shape |
| --- | --- | --- | --- | --- |
| 1 | `/payroll` | Overview | "What's the latest payroll state, and let me act." | Landing: KPI/insight strip + latest-run card + recent runs + primary CTA |
| 2 | `/payroll/people` | People | Maintain the roster + lifecycle. | Employee workbench (table + detail sheet + add/edit) |
| 3 | `/payroll/runs` | Runs | Generate and manage every run. | Runs workbench (table + Generate dialog → worksheet) |
| 4 | `/payroll/statements` | Statements | Download worksheets; view/send payslips; per-employee history. | Statement register + payslip viewer |
| 5 | `/payroll/insights` | Insights | Analyse cost, headcount, mix, trend. | Mercury-style insights (KPIs + chart + AI bullets + breakdowns) |

Plus a **Payroll** section inside Settings at `/settings/payroll` (config, not a daily surface).

**Why these five and not more.** Overview is the operational home (read-at-a-glance + the single most common action, *Generate payroll*). Runs is the working register. People is the roster. Statements is the export/document surface. Insights is analysis. This mirrors how a bookkeeper thinks: *who do I pay → run the pay → mark it paid → hand out the paperwork → understand the cost.* Overview and Runs are kept distinct on purpose: Overview answers "is this month handled?"; Runs is the full, filterable history where work happens.

**Sub-nav pattern.** A horizontal, underline segmented control directly under the page header (the app's established `Tabs variant="line"` look from `InsightsScreen`), **promoted to drive the route** via `next/link` + `usePathname` for active state. Not a left rail — that's reserved for deep config (Settings) and would steal the horizontal space the workbench tables need. This keeps each page full-width like Transactions.

### 2.2 ASCII — module shell (applies to every sub-view)

```
┌────────────────────────────────────────────────────────────────────────┐
│ AppShell sidebar │  Payroll  ⓘ                      [⌘K search] [✦ AskAI]│  sticky h-14 (unchanged shell)
│                  ├────────────────────────────────────────────────────── │
│                  │ Overview   People   Runs   Statements   Insights      │  sub-nav (underline), routes /payroll/*
│                  ├────────────────────────────────────────────────────── │
│                  │  «active sub-view renders here as a full workbench»    │
│                  │                                                        │
└──────────────────┴────────────────────────────────────────────────────── ┘
```

The shell owns: the page title, the `⌘K`/AskAI actions (portaled to `#ob-topbar-page-actions` exactly like Transactions), and the sub-nav. The active sub-view owns its toolbar, insight strip, table, and detail sheet.

---

## 3. Wireframes

All wireframes reuse: `WorkbenchToolbar` (saved views + pills + chips + trailing), the insight strip, `OpenBooksDataTable` (sticky header, `py-2.5`/`py-1.5` density, mobile cards), `DetailSheet`, `Amount`/`.money-figures`, `rounded-[14px] ring-1 ring-foreground/10 shadow-xs` cards, status chips (Draft=neutral, Approved=info/blue, Paid=positive/green).

### 3.1 Overview (`/payroll`)

```
Payroll  ⓘ                                                   [⌘K] [✦ Ask AI]
Overview · People · Runs · Statements · Insights
────────────────────────────────────────────────────────────────────────────
┌── Insight strip (togglable) ───────────────────────────────────────────────┐
│ Payroll this period          June 2026 run · Drafted — review to approve   │
│ $19,646.08    ▸ 6 people  ▸ +0% vs May  ▸ 0 unmatched      [▂▃▄▅ 3-mo trend]│
└────────────────────────────────────────────────────────────────────────────┘
By currency:  ₹150,000.00 INR   ·   PKR 400,000.00   ·   $16,400.00       ← inline, derived
┌── Latest run ───────────────────────────────────────  [ Generate payroll ▸]┐
│ June 2026   ● Draft        6 people        $19,646.08                       │
│ ──────────────────────────────────────────────────────────────────────────│
│  Worked  Employee            Base        +Bonus   −Deduct    Final   Status │  preview of worksheet
│  30/30   Aisha Khan      PKR 400,000        —        —    PKR 400,000  ✎    │  (top 3 lines, read-only)
│  30/30   R. Mehta        ₹150,000           —     ₹5,000  ₹145,000     ✎    │
│  22/22   J. Doe          $16,400         $1,000     —     $17,400      ✎    │
│  … +3 more                                          [ Open worksheet ▸ ]    │
│ ──────────────────────────────────────────────────────────────────────────│
│  [ Review & approve ]   [ Mark paid ]   [ Send payslips ]                   │  contextual to status
└────────────────────────────────────────────────────────────────────────────┘
┌── Recent runs ─────────────────────────────────────────────────────────────┐
│ May 2026   ● Paid   6   ₹150K · PKR 400K · $16.4K          $19,646.08  →    │
│ Apr 2026   ● Paid   6   ₹150K · PKR 400K · $16.4K          $19,646.08  →    │
└────────────────────────────────────────────────────────────────────────────┘
```

The single primary action (`Generate payroll`) and the latest-run state are the hero. Everything else is quiet.

### 3.2 People (`/payroll/people`)

```
[▾ All employees ⌄]  [🔎 Search people]  [Department ▾] [Location ▾] [Status ▾]   [⚙ Display] [+ Add person]
[Status: Active ✕]  [Dept: Engineering ✕]                                                    [Clear all]
┌── insight strip: Headcount 6 ▸ Monthly cost $19,646 ▸ Avg $3,274 ▸ 1 new this qtr ────────┐
└────────────────────────────────────────────────────────────────────────────────────────────┘
 Name                 Title            Dept         Location   Monthly pay     Status     →
 ── Aisha Khan        Eng Lead         Engineering  Karachi    PKR 400,000     ● Active   →
    R. Mehta          Designer         Design       Bengaluru  ₹150,000        ● Active   →
    J. Doe            Founder          —            Remote     $16,400         ● Active   →
 (click row → Employee detail sheet)
```

**Employee detail sheet** (right panel ≥1280px / bottom drawer mobile):
```
Aisha Khan  ● Active                                                        ✕
Eng Lead · Engineering · Karachi · joined 2024-03-01
────────────────────────────────────────────────────────────
[ Profile ]  [ Compensation ]  [ Payroll history ]              ← tabs inside the sheet
Profile:      email · payment method · bank (admin-only) · manager · reports-to
Compensation: PKR 400,000 / mo   [+ Add increment]  [+ Log appraisal]
              2024-03 hire 350,000 → 2025-04 increment 400,000 (history list)
Payroll history: Jun 2026 PKR 400,000 paid · May 2026 paid · …  [Open payslip]
────────────────────────────────────────────────────────────
[ Edit ]                        [ Mark exited ▾ (resigned/terminated/…) ]   ← footer
```

### 3.3 Runs (`/payroll/runs`)

```
[▾ All runs ⌄]  [🔎 Search runs]  [Status ▾] [Period: Last 3 months ▾]        [⚙ Display] [+ Generate payroll]
┌── insight strip: This period $19,646 ▸ Next due Jun 2026 ▸ 6 paid ▸ 0 unmatched ──────────┐
│ ⚠ Auto-draft: off — runs are drafted manually. Turn on in Payroll settings.   [Settings ▸]│ ← moved out of a tab
└────────────────────────────────────────────────────────────────────────────────────────────┘
 Period      Source    People   By currency              Status     USD total   →
 Jun 2026    Manual    6        ₹150K PKR 400K $16.4K     ● Draft    $19,646.08  →
 May 2026    Manual    6        ₹150K PKR 400K $16.4K     ● Paid     $19,646.08  →
 (click row → Run worksheet detail sheet)
```

### 3.4 Generate Payroll flow (dialog → worksheet)

```
[+ Generate payroll]
   └─▶ Dialog:
       Pay period      [ June 2026     ▾ ]      (defaults to next un-run month)
       Working-days basis  ◉ Calendar days (30)  ○ Fixed 22  ○ Custom [__]
       Include            ☑ 6 active employees (mid-month joiners auto-prorated)
                          [ Generate worksheet ]
   └─▶ opens the Run worksheet (draft) for editing ↓
```

### 3.5 Run worksheet (the editable table — replaces card-per-row)

```
June 2026 payroll  ● Draft                                                   ✕
6 people · standard 30 days · base total $19,646.08
────────────────────────────────────────────────────────────────────────────
 ●─────────●─────────○        Review → Approve → Mark paid        (stepper)
────────────────────────────────────────────────────────────────────────────
 Worked  Employee       Cur   Base         Bonus    Deduct   Remark    Final      FX
 [30]/30 Aisha Khan     PKR   400,000      [   0]   [   0]   [____]    400,000   [278]
 [30]/30 R. Mehta       INR   150,000      [   0]   [5,000]  [advance] 145,000   [83]
 [22]/22 J. Doe         USD   16,400       [1,000]  [   0]   [bonus]   17,400    [ — ]
 …                                                              cells inline-editable (draft only)
────────────────────────────────────────────────────────────────────────────
 Local totals: PKR 400,000 · ₹145,000 · $17,400      Base (USD) total: $19,646.08
────────────────────────────────────────────────────────────────────────────
[ Statement tab ]                              [ Approve run ]   ← posts expense/payable
```

Inline-edit cells follow the `InlineCategoryCombobox` pattern (`stopPropagation`, draft-only, optimistic). `Final = round(base × worked/standard) + bonus − deduction`, overridable. Editing recomputes line + run totals; nothing posts until **Approve**.

### 3.6 Statements (`/payroll/statements`)

```
[▾ By month ⌄ / By employee ⌄]  [🔎 Search]  [Period ▾]                        [⚙ Display]
 Period      People   Base total    Status    Worksheet        Payslips         →
 Jun 2026    6        $19,646.08    ● Draft    [⤓ CSV][⤓ PDF]   — (approve first) →
 May 2026    6        $19,646.08    ● Paid     [⤓ CSV][⤓ PDF]   [Send ▾][6 sent] →
 (row → run statement; "By employee" mode → employee statement + payslip list)
```

### 3.7 Insights (`/payroll/insights`)

```
KPIs:  Monthly cost $19,646  ▸  Headcount 6  ▸  Avg/employee $3,274  ▸  MoM +0.0%
┌── Payroll cost trend (last 12 runs) ───────────────────── area/line chart ──┐
└──────────────────────────────────────────────────────────────────────────────┘
✦ AI summary:  • Engineering is 61% of cost  • Headcount flat 3 months
               • PKR exposure $4.6K — watch FX  • No bonuses paid this quarter
┌─ By department (bar) ─┐ ┌─ By location (bar) ─┐ ┌─ Top earners (table) ──────┐
└────────────────────────┘ └─────────────────────┘ └────────────────────────────┘
```

Reuses the dashboard charting stack (`DashboardViz.tsx`, recharts via shadcn chart) and the AI-insight pattern (`aiInsights.ts`). This component becomes the canonical payroll analytics and is also rendered by the existing global `/insights` Payroll tab (reuse, not duplicate).

---

## 4. Employee data model

Principle: extend `employees` with **optional** fields (existing rows stay valid); move history to child tables (Convex: never store unbounded arrays on a doc).

### 4.1 `employees` (additive)

Keep: `entityId, name, country, currency, monthlySalaryMinor, active, createdAt, updatedAt`.
Add (all optional):

| Field | Type | Purpose |
| --- | --- | --- |
| `employeeNumber` | `string` | Human code for statements |
| `email` | `string` | Payslip delivery |
| `title` | `string` | Role/title (insights by role) |
| `departmentId` | `id("payrollDepartments")` | Controlled dept (clean rollups) |
| `locationId` | `id("payrollLocations")` | Controlled location |
| `employmentType` | `"full_time" \| "part_time" \| "contractor"` | Mix/insights |
| `reportingManagerId` | `id("employees")` | Org line; direct reports derived |
| `startDate` | `string` (ISO) | Tenure, mid-month proration |
| `exitDate` | `string` (ISO) | Lifecycle |
| `exitReason` | `"resigned" \| "terminated" \| "laid_off" \| "end_of_contract" \| "other"` | One field covers exited/terminated/resigned |
| `paymentMethod` | `"bank_transfer" \| "cash" \| "cheque" \| "wallet"` | Payslip + insights |
| `payTo` | `object({ method?, bankName?, accountName?, accountNumber?, iban?, swift?, routingNumber?, note? })` | Full pay-to details (Ansar's call) — **admin-only reads** |
| `notes` | `string` | Internal profile notes |

Indexes to add: `by_entity_and_active ["entityId","active"]` (draft/list), `by_manager ["reportingManagerId"]` (direct reports = a query, never a stored array), optionally `by_entity_and_department` for insights.

Lifecycle derivation: `active=true` → "Active". `active=false` + `exitReason` → the specific exit state. Marking exit sets `active=false`, `exitDate`, `exitReason` in one mutation (excludes from future drafts).

**Bank details note (decided: store full).** Full account numbers / IBAN / SWIFT / routing are stored so the owner can actually pay people and print complete payslips. Guardrails this obliges us to honour: **reads gated to admins** (the `payTo` object is omitted from member-facing queries); these fields are covered by the existing no-commit secrets rules (`docs/security/secrets.md`) and must never appear in seed/demo data or logs; and encryption-at-rest of `payTo` is a recommended hardening follow-up before real banking data is entered at scale. Kept as a sub-object so it can later move to its own access-controlled / encrypted child table without reshaping `employees`.

### 4.2 `employeeCompensationEvents` (new — the increment/appraisal history)

`entityId, employeeId, effectiveDate, type ("hire"|"increment"|"appraisal"|"correction"|"promotion"), previousSalaryMinor?, newSalaryMinor, currency, note?, createdByUserId?, createdAt`. Index `by_employee ["employeeId"]`.

"Add increment" / "Log appraisal" = append an event **and** patch `employees.monthlySalaryMinor` in one mutation. Gives an auditable comp trail and feeds payslips/insights — without an unbounded array.

### 4.3 `payrollDepartments` / `payrollLocations` (new — settings-managed)

Each: `entityId, name, active, createdAt, updatedAt` (location also `country?`). Index `by_entity`. Small reference tables so Insights group cleanly and Settings can manage the vocabulary.

---

## 5. Payroll run & line data model

### 5.1 `payrollRunLines` (additive — breakdown without touching the ledger)

Keep canonical fields the ledger uses: `baseSalaryMinor, fxRateMicros, finalLocalMinor, baseEquivalentMinor, paid, settlement*`. Add (optional):

| Field | Type | Purpose |
| --- | --- | --- |
| `standardDays` | `number` | Period working days (default for proration) |
| `workedDays` | `number` | Days actually worked (proration numerator) |
| `earnedBaseMinor` | `number` | `round(base × worked/standard)` (=base when full) |
| `bonusMinor` | `number` (≥0) | Separate bonus |
| `deductionMinor` | `number` (≥0) | Separate deduction |
| `manualFinalLocalMinor` | `number` | Optional hard override of Final |
| `remark` | `string` | Per-line note (shows on payslip) |

Add index `by_employee ["employeeId"]` (employee statements + insights).

Computation: `finalLocalMinor = manualFinal ?? (earnedBaseMinor + bonusMinor − deductionMinor)`; `baseEquivalentMinor = round(finalLocalMinor × 1e6 / fxRateMicros)` (unchanged). The legacy single `adjustmentMinor` becomes derived (`finalLocal − baseSalary`) for back-compat, or is dropped after migration.

### 5.2 `payrollRuns` (additive)

Add (optional): `standardDays` (run default for lines), `notes` (run remark), `payDate` (settlement date for statements, distinct from accrual `postingDate`), `notifiedAt` (payslips sent timestamp).

### 5.3 Run lifecycle & ledger — unchanged

`draft → approved → paid`. Approve posts one balanced entry (`5000 expense / 2200 payable`) at `postingDate`. Settlement posts per line (`2200 payable / bank` + FX `4200`/`6999`). Period locks, idempotency, and the demo-safe auto-draft cron all stay. The redesign adds breakdown + UI; it does not alter posting, balancing, or immutability.

---

## 6. Statements & payslips

| Artifact | What | How |
| --- | --- | --- |
| Run worksheet | The full run as a table | CSV (exists) + **PDF** (new) |
| Employee payslip | One line in one run, formatted | Print-optimized view + **PDF** stored in `_storage` |
| Employee statement | One employee across runs (YTD, comp history) | Query `payrollRunLines.by_employee` + `employeeCompensationEvents` |

**PDF generation:** a Convex **action** (`"use node"`, separate file) renders the payslip/worksheet, uploads the Blob via `ctx.storage`, and returns a `fileId`; a query resolves a signed URL via `ctx.storage.getUrl()`. For v1, the in-app payslip is a clean print route (`/payroll/payslip/[lineId]`) so "download/print" works immediately; the stored PDF is what the email links to.

---

## 7. Email notifications & payslip delivery

**Trigger:** a deliberate **"Send payslips"** action after approval (re-sendable), with an optional `autoNotifyOnApproval` toggle in Payroll Settings. Not auto-fired silently on approval.

**Flow:** mutation fans out per employee with `ctx.scheduler.runAfter(0, …)` → a Node action renders/links the payslip and calls `sendPlunkEmail({ to, subject, body })` → records a `payslipDeliveries` row (status/messageId/fileId). Requires `employee.email`. Copy: *"Your June 2026 payslip is ready. Payment is on its way."* + payslip link.

**`payslipDeliveries` (new):** `entityId, runId, employeeId, lineId, channel ("email"), status ("queued"|"sent"|"failed"|"skipped"), fileId?, emailMessageId?, error?, sentAt?, createdAt`. Indexes `by_run`, `by_employee`. Gives idempotency ("6 sent" badges) and an audit trail.

**Provider: Plunk (already integrated).** Reuse `packages/email/src/plunk.ts` `sendPlunkEmail` — the same client `convex/requestAccess.ts` and the team-invite path already use (`POST {PLUNK_API_BASE_URL}/v1/send`, bearer `PLUNK_SECRET_KEY`, `from = PLUNK_FROM_EMAIL`). No new dependency. Sending is env-gated exactly like invites: active when `PLUNK_SECRET_KEY` + `PLUNK_FROM_EMAIL` are set in the Convex deployment (the public key is in `.env.local` today; the secret key needs confirming — delivery currently degrades to "not configured"). The payroll Node action imports `sendPlunkEmail` (or mirrors the `requestAccess.ts` fetch if workspace-package bundling into Convex proves awkward — verify at build time).

---

## 8. Payroll Insights — recommended set

- **KPIs:** monthly payroll cost (base), headcount, average cost/employee, MoM change %.
- **Primary chart:** payroll cost trend over the last 12 runs (area/line).
- **Breakdowns:** by department (bar), by location (bar), by role/title, top earners (table), bonus vs deduction trend, headcount trend.
- **AI bullets:** concentration, FX exposure, MoM movers, bonus/deduction anomalies (reuse `aiInsights.ts`).

Cut for v1 (low signal at small headcount): per-location heatmaps, tenure cohorts. The breakdowns query monthly runs (bounded ~12) joined to employee dimensions — cheap to aggregate in a view.

---

## 9. Payroll Settings (`/settings/payroll`) — curated

I do **not** accept the brainstormed list wholesale. Recommended contents:

| Setting | Keep? | Notes |
| --- | --- | --- |
| Pay schedule (cadence) + auto-draft toggle + pay day | ✅ | Absorbs existing `paySchedules` |
| Working-days basis (calendar / fixed / custom) + default standard days | ✅ | Drives proration default at Generate time |
| Departments (managed list) | ✅ | `payrollDepartments` |
| Locations (managed list) | ✅ | `payrollLocations` |
| Payslip & notifications (auto-notify toggle, payslip note, reply-to email, letterhead) | ✅ | Feeds the email/PDF |
| Default currency | ➖ | Already the entity base currency — show as read-only, don't duplicate |
| Payment methods | ➖ | Fixed enum, not user-managed (keep lightweight) |
| Bonus types / Deduction types | ⏳ v2 | Single amounts + remark for now; typed taxonomy later (better insights) |
| Approval workflow (multi-step) | ⏳ v2 | Single-admin approve for now |

**`payrollSettings` (new, 1 per entity):** `entityId, cadence?, autoDraftEnabled?, payDayOfMonth?, workingDaysBasis ("calendar"|"fixed"|"business")?, fixedStandardDays?, autoNotifyOnApproval?, payslipNote?, replyToEmail?, letterheadFileId?, createdAt, updatedAt`. Index `by_entity`. Migration absorbs `paySchedules.cadence/enabled` and the auto-draft cron is repointed to read `payrollSettings`.

---

## 10. Convex implementation plan

### 10.1 Schema changes (one `schema.ts` edit)

- Widen `employees` (optional fields in §4.1) + new indexes.
- Widen `payrollRunLines` (§5.1) + `by_employee` index.
- Widen `payrollRuns` (§5.2).
- New tables: `employeeCompensationEvents`, `payrollDepartments`, `payrollLocations`, `payrollSettings`, `payslipDeliveries`.

### 10.2 Functions (file layout — split the work, keep `payroll.ts` for runs)

| File | Exports |
| --- | --- |
| `convex/payroll.ts` (keep) | `generateRun` (wrap `startRun`: + `standardDays`, employee selection, auto-proration), `updateRunLine` (+ workedDays/bonus/deduction/remark/manualFinal args), `approveRun`, `markLinePaid`, `markRunPaid`, `runDetail`, `statement`, auto-draft cron (read `payrollSettings`) — ledger path unchanged |
| `convex/employees.ts` (new) | `list` (paginated, dept/location/status filters), `get` (+ comp history + payroll history), `create`, `update`, `recordCompensationEvent` (increment/appraisal → patch salary + append event), `markExited`, `directReports` |
| `convex/payrollStatements.ts` (new) | `employeeStatement` (`by_employee`), `payslipData`, `runWorksheet` |
| `convex/payrollSettings.ts` (new) | `getPayrollSettings`, `updatePayrollSettings`, departments CRUD, locations CRUD |
| `convex/payrollInsights.ts` (new, or extend `moduleViews.ts`) | `payrollInsights(range)` → KPIs + trend + breakdowns (shared by module + global insights tab) |
| `convex/payrollPdf.ts` (new, `"use node"`) | `generatePayslipPdf`, `generateWorksheetPdf` → `_storage` |
| `convex/payrollEmail.ts` (new, `"use node"`) | `sendPayslipNotifications(runId)` → reuse `sendPlunkEmail` (`packages/email`) + record `payslipDeliveries`; env-gated on `PLUNK_SECRET_KEY` |

Rules honoured: validators on every function; entity authz re-checked server-side (`requireWorkspaceRole` reads, `getEntityForWrite(admin)` writes, admin-only `payTo` reads); bounded queries (`.take`/`.paginate`, indexes not `.filter`); actions (Node) isolated from queries/mutations per file; money stays integer minor units; payslip Blobs via `ctx.storage`.

### 10.3 Migration (widen → migrate → narrow)

1. **Widen:** deploy schema with all new fields optional + new tables. Existing data validates unchanged.
2. **Backfill** (`@convex-dev/migrations` or one internal mutation): for each `payrollRunLines` row set `workedDays=standardDays` (full month), and split the old signed `adjustmentMinor` into `bonusMinor`/`deductionMinor` by sign; create one `payrollSettings` row per entity from `paySchedules`; repoint the cron.
3. **Narrow (optional):** once stable, drop `adjustmentMinor` and `paySchedules`. Keep most fields optional for resilience.

The ledger and posted entries are never rewritten.

---

## 11. Next.js page & component plan

### 11.1 Routes

- `app/payroll/[[...view]]/page.tsx` — optional catch-all (static `payroll/` segment **takes precedence** over the dynamic `[section]`). Server component: `await params`, validate `view ∈ {undefined, people, runs, statements, insights}` else `notFound()`, render `<PayrollModuleShell view=…/>` (client). Replicate whatever `[section]/page.tsx` does for auth/layout/metadata.
- `app/payroll/payslip/[lineId]/page.tsx` — print-optimized payslip (also the PDF source).
- Retire the `/payroll` branch of the `AppScreen` dispatch (route precedence handles it); leave the sidebar entry as-is (one flat item; sub-nav lives in the shell).

### 11.2 Components (`apps/web/src/components/openbooks/payroll/` — break up the monolith)

`PayrollModuleShell.tsx` (header + sub-nav + active view) · `PayrollOverview.tsx` · `PeopleWorkbench.tsx` · `EmployeeDetailSheet.tsx` · `EmployeeFormDialog.tsx` · `RunsWorkbench.tsx` · `GeneratePayrollDialog.tsx` · `RunWorksheetSheet.tsx` (editable `OpenBooksDataTable`) · `StatementsScreen.tsx` · `PayslipView.tsx` · `PayrollInsights.tsx` (+ chart pieces). Plus `lib/openbooks/payroll-nav.ts` (sub-nav registry).

All are client components (Convex hooks + local state); the route page is a thin server wrapper passing the validated `view`. Sub-nav uses `usePathname` (no `useSearchParams`, so no Suspense bailout). Async `params`/`searchParams` per Next 15+.

### 11.3 Settings wiring

Register `{ id: "payroll", label: "Payroll" }` in `settings-sections.ts` (+ a `SETTINGS_NAV_GROUPS` entry), add `PayrollSettingsSection.tsx`, and branch it in `SettingsScreen.tsx`'s `SectionBody`. Deep-links at `/settings/payroll` for free.

---

## 12. Consistency-with-Transactions checklist (acceptance)

- [ ] Page header matches Transactions (`PageHeader`, no `hideHeader` hack); `⌘K`/AskAI portaled to `#ob-topbar-page-actions`.
- [ ] `WorkbenchToolbar` (+ SavedViews, filter pills, removable chips, group/sort/display, primary add) on People, Runs, Statements — no bespoke `FilterBar`/`PageActionBar`.
- [ ] One insight strip per view (KPI band + optional sparkline), togglable via Display — currency totals are first-class, not orphaned badges.
- [ ] `OpenBooksDataTable` everywhere (sticky header, density, mobile card list, grouping, empty states) — including the editable worksheet (inline cells, not cards).
- [ ] `DetailSheet` for employee + run detail (right panel ≥1280px / bottom drawer mobile).
- [ ] Money via `Amount`/`.money-figures`; status chips Draft=neutral / Approved=info / Paid=positive; green used only for money-in/positive; no gradients/emoji/purple-AI.
- [ ] Real responsive behaviour at 390 / 768 / 1306 / 1440 / 1758 (the existing payroll evidence breakpoints).

---

## 13. Build plan (one delivery — Ansar chose "full module in one pass")

These six work-streams are a **dependency-ordered build sequence inside a single delivery**, not separate releases. The module ships once, gate-green end to end. Order still matters because each stream depends on the prior (worksheet needs the shell; statements need the worksheet; insights need the people dimensions).

**Slice 1 — Shell + consistency refactor (no new capability).** Module shell + routes + sub-nav; port People/Runs/Statements onto `WorkbenchToolbar` + insight strip + `OpenBooksDataTable`; build the Overview landing. *Outcome: Payroll looks and behaves like Transactions.*

**Slice 2 — Worksheet breakdown.** Widen `payrollRunLines`; Generate dialog (period + working-days basis + proration); editable worksheet (worked days, bonus, deduction, remark, final override). Ledger untouched. *Outcome: real manual payroll calculation.*

**Slice 3 — People & lifecycle.** Widen `employees`; add departments/locations; employee detail sheet (profile/comp/history); add/edit; increments/appraisals; mark exited. *Outcome: an accurate, maintainable roster.*

**Slice 4 — Statements & payslips.** Employee statement; payslip print route; worksheet/payslip PDF to `_storage`. *Outcome: paperwork.*

**Slice 5 — Insights.** `payrollInsights` view + `PayrollInsights` UI; wire the global `/insights` Payroll tab to reuse it. *Outcome: cost analytics.*

**Slice 6 — Settings + email.** `payrollSettings` + `/settings/payroll`; `payslipDeliveries` + Node email action; gate sending on a provider key. *Outcome: configurable + notifications when the key lands.*

Every stream is additive and the whole module must be gate-green (typecheck/lint/tests + the existing payroll e2e) before it ships as one unit.

### Risks / watch-items
- Route precedence (`app/payroll/` vs `[section]`) — verify the catch-all wins and inherits the same auth/layout as `[section]/page.tsx`.
- `paySchedules` → `payrollSettings` migration must repoint the auto-draft cron in the same deploy (don't orphan the demo-safe guard).
- `payTo` stores full bank PII — enforce admin-only reads, keep it out of seed/demo/logs, and treat encryption-at-rest as a hardening follow-up.
- Plunk sending needs `PLUNK_SECRET_KEY` + `PLUNK_FROM_EMAIL` in the Convex env — until confirmed, payslip delivery degrades to "not configured" (in-app payslips still work); everything else is unblocked.
- Importing a workspace package (`packages/email`) into a Convex Node action — confirm bundling works, else mirror the `requestAccess.ts` inline fetch.

### Resolved decisions (Ansar, 2026-06-14)
1. **Sequencing** — build the full module in one pass; ship once.
2. **Email** — Plunk (reuse the existing integration); Ansar to confirm/supply the Convex-side secret key if delivery isn't already live.
3. **Bank details** — store full pay-to details, admin-only reads.
