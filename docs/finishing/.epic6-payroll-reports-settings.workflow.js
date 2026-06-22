export const meta = {
  name: 'openbooks-epic6-payroll-reports-settings',
  description: 'Epic 6: bring Payroll, Reports, and Settings into the shared workbench language — clarify the Payroll run/statement workflow (+ honest auto-run provenance and a safe net-new auto-draft backend), keep Reports ledger-backed with stable periods + real drill-through that survives the docked AI, and make Settings administrative with a sticky subnav and no overflowing tables. Three parallel sibling agents on disjoint files, then unified verify, adversarial critique, and fix.',
  phases: [
    { title: 'Build', detail: 'three parallel agents: Payroll (ModuleScreens+payroll backend), Reports (ReportsScreen+report libs), Settings (SettingsScreen+settings/*)' },
    { title: 'Verify', detail: 'one agent runs authoritative typecheck/lint/unit + convex deploy on the combined tree and reconciles cross-file errors' },
    { title: 'Critique', detail: 'parallel critics: IA/ledger+payroll-provenance, design-system+testids+sticky-subnav, responsive (AI-open + sticky)' },
    { title: 'Fix', detail: 'apply confirmed fixes; re-green typecheck/lint/unit' },
  ],
}

const REPO = '/Volumes/SSD/OpenBooks'
const WEB = 'apps/web'
const REPORT = 'docs/finishing/frontend-redesign-research-report.md'

const DS = `OpenBooks DESIGN SYSTEM (HARD rules — any violation is a bug):
- White ledger surfaces; Geist + Geist Mono money/dates via \`money-figures\` (tabular-nums, letter-spacing 0).
- ONE brand green #2ca01c. AI affordances GREEN (text-ai/--ai, bg-ai-surface, lucide Sparkles) — NEVER purple/violet/gradient.
- Money-in MAY be green; ordinary amounts NEUTRAL. text-negative (#d92d20) ONLY for overdue/outflow/destructive; net-profit green band is on-brand; cash-flow OUTFLOW bars use --negative. Run status: Draft neutral, Approved info-blue (--info), Paid green. No blanket \`signed\` flag.
- Use SEMANTIC TOKENS, never raw hex/Tailwind: replace bg-teal-600/bg-amber-500/bg-amber-100 with --chart/--warning tokens; route hardcoded green/red/blue/gray hex through --primary/--negative/--info/--muted-foreground; fix the BusinessesSection magenta avatar (#a4148c) to chart tokens; --chart-1..5 for series.
- BANNED: gradients, glassmorphism, emoji, unicode-as-icon — swap unicode ✓ and arrows for lucide Check/ArrowRight; swap ▲/▼ for lucide TrendingUp/Down. shadcn Select/Switch/Checkbox before raw <select>/toggle/<input type=checkbox>.
- Mobile is a real responsive surface (card-stack / bottom Drawer), never a horizontally-squeezed table or a wall of buttons.`

const SKILLS = `BEFORE you build, READ and follow:
- shadcn rules: ${REPO}/.claude/skills/shadcn/SKILL.md + rules/styling.md + rules/composition.md + rules/forms.md.
- frontend-design doctrine: ${REPO}/.claude/skills/frontend-design/SKILL.md (owner-side copy; quiet, intentional).
- Convex guidelines: ${REPO}/convex/_generated/ai/guidelines.md (READ before touching any convex/ file).`

const FOUNDATION = `FOUNDATION IN PLACE — ASSEMBLE FROM THESE; do not re-implement tables/filters/detail/KPIs:
- Epic 1 workbench toolkit, import from \`@/components/openbooks/workbench\`: WorkbenchPage, PageActionBar (ActionItem), DateRangeControl, FilterBar, AccountMultiSelect, KpiStrip (KpiItem), OpenBooksDataTable (ColumnDef<Row>, optional rowAttributes to keep e2e data-testids on rows), DetailSheet (DetailTab), AiInsightBadge, EvidenceUpload, ExportMenu, AttentionState + attentionMeta + AttentionKind, useIsMobile. READ each file under ${WEB}/src/components/openbooks/workbench/ before using it. OpenBooksDataTable already gives desktop overflow-x-auto sticky table + mobile card-stack; DetailSheet is CLOSED by default (right Sheet lg+, bottom Drawer mobile).
- Tokens in globals.css: text-negative/bg-negative-surface, --warning/--info/--ob-green/--ai surfaces, --chart-1..5. Existing primitives (${WEB}/src/components/openbooks/primitives.tsx): Amount (tone neutral|income|expense), formatMinorMoney, EmptyState, BarChart, Sparkline, AgingMiniBar. shadcn alert-dialog exists (ui/alert-dialog) — wrap payroll Approve in it. shadcn Switch/Checkbox/Select/Tabs/Collapsible/ScrollArea all exist in ui/.
- Epics 2-5 shipped: the shell (Epic 2) already made the docked Ask AI an OVERLAY (not a width-stealing sibling), so Reports tables should no longer be squeezed by it — but you must still ensure dense report tables own an overflow-x-auto + min-w-0 region. Transactions deep-link /transactions?focus=<id> EXISTS; Reports drill-through routes there (and account=/category=/start=/end= params if you add them). Do NOT touch CoreScreens/IncomeScreen/ExpensesScreen, the Bills/Contacts regions of ModuleScreens.tsx (Epic 5, done), AppShell, AskAIWidget, the Epic 1 primitives, globals.css, or ui/ primitives.`

const PAYROLL_TASKS = `PAYROLL BUILD (report 6.8; Epic 5/6 backend decision 11.0) — you OWN ${WEB}/src/components/openbooks/ModuleScreens.tsx (PayrollScreen ~937, PayrollEmployees ~1018, PayrollRuns ~1063, PayrollRunDetail ~1119, PayrollRunStatement ~1339 — Payroll region ONLY; leave Bills/Contacts/Invoices/Settings regions untouched), ${WEB}/src/components/openbooks/module-helpers.ts (payroll types only), convex/moduleViews.ts (payroll overview, read-only), convex/payroll.ts, convex/payrollMath.ts, convex/schema.ts (payrollRuns + a new paySchedule — additive), convex/crons.ts. Grep ModuleScreens.tsx for payroll testids and PRESERVE: m6-payroll-screen, payroll-run-june, payroll-run-row, payroll-run-detail, payroll-line-row, payroll-approve, payroll-approved-banner, payroll-mark-paid, payroll-base-total, payroll-currency-totals, payroll-statement-csv, payroll-adjustment-input, payroll-fx-input, payroll-back, payroll-error. reports-payroll.spec / modules.spec assert getByText USD/INR/PKR payroll + "Printable statement".
- Keep PayrollScreen as a WorkbenchPage with a PERSISTENT KpiStrip + tabs + period selector that NEVER destroys the list. Replace the dead StatCard strip with a real KpiStrip: "Payroll this period" (base-currency total of the active run, or projected draft), "Next run / due" (from period + stated cadence), "People paid" (employees), "Unmatched" (approved-but-unsettled lines awaiting bank match). Gate taxes/withholding + contractors KPIs behind a quiet "coming soon" rather than faking data the schema lacks.
- Convert Button-group tabs to shadcn Tabs (underline active, brand green): People, Runs, Statements (DEFER Contractors/Rules until a workerType field + rules engine exist — do NOT ship empty tabs).
- Period selector (month/quarter/custom) in the header scoping BOTH Runs list and Statements; the Run-payroll button drafts the SELECTED period, not a hardcoded 2026-06.
- Run rows use a shared OpenBooksDataTable with semantic status chips (Draft neutral, Approved info-blue, Paid green) and restore the by-currency breakdown column (keep payroll-currency-totals). Fix run.headcount to read the run's OWN snapshot lines. Format ALL money through Amount (KILL the localMinor/100 float string ~line 1194).
- CRITICAL: run detail CLOSED by default — selecting a run opens a DetailSheet (right) or inline expansion with the Review→Approve→Mark-paid stepper + editable grid, while the runs list + KPI strip STAY on screen (do NOT full-screen-swap). Editable grid → responsive card-per-row on mobile (label/value stacks), not a horizontal-scroll table. Replace the raw paid checkbox with shadcn Checkbox/--primary. Approve posts the single payroll-expense ledger entry via the EXISTING approveRun — wrap it in an AlertDialog confirm; NEVER post client-side. Add the 12-month USD-equivalent trend to Statements via BarChart.
- HONEST AUTO-RUN PROVENANCE + SAFE NET-NEW BACKEND (approved 11.0): today runs are created only by manual startRun (no cron; crons.ts has only the Plaid sync). Build a SAFE, non-ledger auto-DRAFT capability: (a) schema — add an optional per-entity \`paySchedule\` (cadence + enabled) and a \`source: v.optional(v.union(v.literal("auto-draft"), v.literal("manual")))\` field on payrollRuns (default/absent = manual); (b) an internal scheduled function that, for entities with an ENABLED paySchedule only, drafts the period's run from the active roster reusing startRun's draft logic + its existing duplicate-period guard (idempotent), marking source:"auto-draft" — it must NOT post to the ledger (approval stays manual) and must be a NO-OP on demo data that has no enabled schedule (so it never pollutes the seed); (c) register it in crons.ts; (d) UI — design the Runs around an explicit "Auto-draft · needs review" vs "Manual" status chip reading that source, and an honest "Auto-run: off — runs are drafted manually from active salaries" affordance + a control to enable a schedule. If wiring the live cron cleanly is risky, ship the schema source field + the honest UI + a manual "Draft next period" action using the same draft path, and FLAG the cron as a follow-up — never imply automation that does not run. FLAG every backend change + the convex deploy result.`

const REPORTS_TASKS = `REPORTS BUILD (report 6.9) — you OWN ${WEB}/src/components/openbooks/ReportsScreen.tsx, ${WEB}/src/lib/openbooks/report-periods.ts, ${WEB}/src/lib/openbooks/reports-export.ts, and convex/reportViews.ts (read-only additions only if genuinely needed). Grep ReportsScreen.tsx for testids and PRESERVE: reports-screen, reports-home, reports-back, viewer-toolbar, basis-toggle/basis-cash/basis-accrual, compare-panel, range-preset, period-label, money-button, drill-sheet/drill-row/drill-total, explain-report, export-csv, balanced-chip, monthly-review, mr-month/mr-net/mr-next/mr-prev. reports.spec/reports-export-h2/reports-payroll assert these.
- Keep the home-grid → shared-viewer model. Fixes in priority order: (1) Ensure dense report tables (P&L monthly grid, GL, Trial Balance, Journal) own an overflow-x-auto + min-w-0 region so the docked Ask AI overlay (now an overlay, not a width-stealer, from Epic 2) never clips them; on narrow effective width collapse dense tables to a stacked label/value card list. (2) Real drill-through: a money cell routes to the register filtered by account+date (add account=/category=/start=/end= params to the Transactions deep-link and have MoneyButton router.push there); keep the in-page DrillSheet quick-peek (keep drill-sheet/drill-row/drill-total) but add an "Open in Transactions" action in its footer. Income rows → Income lens, expense categories → Expenses lens, else Transactions. (3) Dashboard consistency: ReportsScreen reads period= (map to start/end) in addition to start/end so dashboard drill-throughs land on the right month. (4) Persist toolbar state (basis/compare/columns) across report switches instead of hard-resetting; keep the future-clamp. (5) Restore the Close-the-books banner + checklist on Reports home, wired to the existing period-lock. (6) Token cleanup: replace bg-teal-600/bg-amber-500/bg-amber-100 with chart/warning tokens, swap the unicode ✓ (balanced-chip) and arrows for lucide Check/ArrowRight, use --negative for cash-flow outflow bars. (7) Restore Payroll Summary multi-currency + headcount + FX note. Keep drill default-CLOSED, the green Explain affordance, and the net-profit green band. Reports is read-only over journalLines — acting on a record hands OFF via drill-through; never edit the ledger here.`

const SETTINGS_TASKS = `SETTINGS BUILD (report 6.10; gates G14 sticky subnav + G4 no-overflow tables) — you OWN ${WEB}/src/components/openbooks/SettingsScreen.tsx, ${WEB}/src/lib/openbooks/settings-sections.ts, everything under ${WEB}/src/components/openbooks/settings/* (Business/Tax/Connections/Ai/Categories/Rules/Notifications/Team/Data/Audit), and ${WEB}/src/components/openbooks/PlaidConnectionPanel.tsx + StripeConnectionPanel.tsx (UI only; sandbox/test mode; NO live keys, expose no secrets). Grep these for testids and PRESERVE all (settings-screen, ai-section/ai-autonomy-cards/ai-provider/ai-chat-model/ai-connection-state/ai-spend/ai-test-connection/ai-test-message, audit-section/audit-row/audit-filter-*/audit-empty, businesses-grid/businesses-add/add-business-*, categories-section/categories-add/category-row/category-rename-input/categories-accountant-mode, connections-section/connections-import/connections-import-link, data-section/data-export-*/data-danger-zone, notifications-section, rule-editor/rule-row/rule-* /rule-save/rule-preview*, live-sandbox-*). settings.spec + audit-h2 assert these.
- Keep the 10-section IA but product-grade. (1) STICKY subnav (G14): wrap the desktop nav in \`lg:sticky lg:top-[72px] lg:self-start lg:max-h-[calc(100vh-88px)] lg:overflow-y-auto\` so it pins under the header while content scrolls; group the 10 items under quiet eyebrow labels (Workspace: Businesses, Tax; Automation: AI, Rules, Categories; Connections; People: Team, Notifications; Data: Data, Audit). (2) Drop the redundant per-section h2 (the subnav already names it); keep the one-line description. (3) Connections: replace the two debug consoles with owner-facing connection cards (logo badge, "Connected · synced 12 min ago"/"Sign-in expired" pill, ONE primary action Reconnect/Connect/Manage). Move Validate/Seed/Sync/Simulate/checklist machinery behind an "Advanced / sandbox tools" Collapsible, default closed (keep live-sandbox-* testids inside it). (4) AI: keep provider/key-state/chat-model summary + the 3 autonomy radio cards + spend meter; demote Batch runs + Categorization eval tables into a single collapsed "Diagnostics" disclosure (keep ai-batch-*/ai-eval-* testids inside it). (5) Tables (G4): make Audit a real responsive table — desktop grid with min-w-0 truncate action cells, mobile reflow to stacked label/value (no horizontal scroll); render Stripe payout detail as reflowing rows below md. (6) Rules: move edit/delete into a row-hover action cluster or a ⋯ menu; row detail (conditions + 90-day preview) stays CLOSED, opening in the existing Dialog/inline expand (keep rule-editor/rule-preview*). (7) Swap hand-rolled toggles → shadcn Switch, raw checkboxes → Checkbox; route every hardcoded green/red/blue/gray hex through --primary/--negative/--info/--muted-foreground; fix the BusinessesSection magenta avatar (#a4148c) to chart tokens. (8) Money stays Geist Mono tabular. Use OpenBooksDataTable responsive behavior for the heavy tables so they never overflow their card.`

const RULES = `RULES (all three build agents):
- File ownership is DISJOINT. Payroll owns ModuleScreens.tsx (Payroll region) + module-helpers.ts (payroll types) + convex/payroll.ts + payrollMath.ts + moduleViews.ts (payroll overview) + schema.ts + crons.ts. Reports owns ReportsScreen.tsx + report-periods.ts + reports-export.ts + reportViews.ts. Settings owns SettingsScreen.tsx + settings-sections.ts + settings/* + Plaid/StripeConnectionPanel.tsx. Edit ONLY your files. Do NOT touch a sibling's files, the Bills/Contacts/Invoices regions of ModuleScreens.tsx, CoreScreens/Income/Expenses, AppShell/AskAIWidget, Epic 1 primitives, globals.css, ui/ primitives. ONLY Payroll edits convex/schema.ts + crons.ts (Reports/Settings must not — flag if you think you need a schema change).
- Backend: read convex/_generated/ai/guidelines.md FIRST. Re-check workspace/entity authorization in every query/mutation. Money stays integer minor units + currency. Reuse existing ledger mutations (approveRun/markRunPaid post the ledger — never client-side; the auto-DRAFT path must NOT post). Posted entries immutable. FLAG every backend change (file:line + what + why + auth note).
- Because siblings edit concurrently, do NOT run a full-project fix loop — if typecheck reports errors ONLY in a sibling's files, note it and leave it; the Verify stage reconciles. Ensure YOUR code is type-correct + lint-clean. If you changed convex/, run \`npx convex dev --once\` and report the deploy result. Return your manifest.`

const MANIFEST_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['surface', 'filesChanged', 'whatChanged', 'detailClosedByDefault', 'backendChanges', 'testidsPreserved', 'ledgerSafety', 'risks'],
  properties: {
    surface: { type: 'string', enum: ['payroll', 'reports', 'settings'] },
    filesChanged: { type: 'array', items: { type: 'string' } },
    whatChanged: { type: 'string' },
    detailClosedByDefault: { type: 'string', description: 'Payroll/Reports/Settings: confirm run-detail/drill/rule-detail open only on selection (no auto-select / no full-screen-swap that destroys the list). For Settings, confirm the sticky subnav.' },
    backendChanges: { type: 'array', items: { type: 'string' }, description: 'Each convex/ change: file:line + what + why + auth note + deploy result. Empty if none. Payroll: describe the auto-draft capability + that it does NOT post + is a no-op on demo.' },
    testidsPreserved: { type: 'string' },
    ledgerSafety: { type: 'string', description: 'No client posting; approveRun/markRunPaid reused; auto-draft is non-ledger; money integer minor units; posted entries immutable.' },
    risks: { type: 'array', items: { type: 'string' } },
  },
}

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['typecheck', 'lint', 'unitTests', 'convexDeploy', 'whatFixed', 'risks'],
  properties: {
    typecheck: { type: 'string', enum: ['green', 'failing'] },
    lint: { type: 'string', enum: ['green', 'failing'] },
    unitTests: { type: 'string', description: 'vitest result incl convex/payroll.test.ts if present.' },
    convexDeploy: { type: 'string', description: 'Result of npx convex dev --once after the schema/crons/payroll changes.' },
    whatFixed: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
  },
}

const CRITIQUE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lens', 'findings', 'verdict'],
  properties: {
    lens: { type: 'string' },
    findings: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['severity', 'file', 'issue', 'fix'],
      properties: {
        severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
        file: { type: 'string', description: 'path:line' },
        issue: { type: 'string' },
        fix: { type: 'string' },
      },
    } },
    verdict: { type: 'string', enum: ['pass', 'needs-fixes'] },
  },
}

phase('Build')
const builds = await parallel([
  () => agent(
    `You are the PAYROLL build agent for Epic 6 of the OpenBooks redesign. Rebuild the Payroll surface on the workbench toolkit and add the SAFE net-new auto-draft backend. Read ${REPORT} Section 6.8 + decision 11.0 and the current files before editing.\n\n${SKILLS}\n\n${DS}\n\n${FOUNDATION}\n\n${PAYROLL_TASKS}\n\n${RULES}\n\nReturn the manifest (surface="payroll").`,
    { label: 'epic6:payroll', phase: 'Build', schema: MANIFEST_SCHEMA }),
  () => agent(
    `You are the REPORTS build agent for Epic 6 of the OpenBooks redesign. Keep Reports ledger-backed with stable periods, real drill-through, and AI-overlay-safe tables. Read ${REPORT} Section 6.9 and the current files before editing.\n\n${SKILLS}\n\n${DS}\n\n${FOUNDATION}\n\n${REPORTS_TASKS}\n\n${RULES}\n\nReturn the manifest (surface="reports").`,
    { label: 'epic6:reports', phase: 'Build', schema: MANIFEST_SCHEMA }),
  () => agent(
    `You are the SETTINGS build agent for Epic 6 of the OpenBooks redesign. Make Settings administrative with a sticky subnav and overflow-free tables. Read ${REPORT} Section 6.10 (gates G14/G4) and the current files before editing.\n\n${SKILLS}\n\n${DS}\n\n${FOUNDATION}\n\n${SETTINGS_TASKS}\n\n${RULES}\n\nReturn the manifest (surface="settings").`,
    { label: 'epic6:settings', phase: 'Build', schema: MANIFEST_SCHEMA }),
])
const payroll = builds[0], reports = builds[1], settings = builds[2]
log(`Build: payroll files=${payroll?.filesChanged?.length} backend=${(payroll?.backendChanges||[]).length}; reports files=${reports?.filesChanged?.length}; settings files=${settings?.filesChanged?.length}`)

phase('Verify')
const verify = await agent(
  `You are the VERIFY agent for Epic 6. Three sibling agents just built Payroll (ModuleScreens Payroll region + convex payroll/schema/crons/moduleViews), Reports (ReportsScreen + report libs + reportViews), and Settings (SettingsScreen + settings/*) concurrently. Run the AUTHORITATIVE checks on the combined tree and reconcile ANY cross-file errors (you may edit any of the Epic 6 files to fix type/lint/integration errors, but do NOT touch other surfaces, AppShell, Epic 1 primitives, globals.css, ui/ primitives, or any ledger WRITE/posting path).\n\nFrom ${REPO} run: \`pnpm --filter @openbooks/web typecheck\`, \`pnpm --filter @openbooks/web lint\`, \`pnpm test\` (vitest — includes convex/payroll.test.ts if present; baseline 151 passing), and \`npx convex dev --once\` (the schema/crons/payroll changes must deploy clean). Fix until typecheck + lint GREEN, no unit test regressed, and convex deploys. If the auto-draft schema/cron breaks the deploy, fix it or (if unsafe) reduce it to the additive source field + honest UI and flag.\n\n${DS}\n\nReturn the verify manifest.`,
  { label: 'epic6:verify', phase: 'Verify', schema: VERIFY_SCHEMA },
)
log(`Verify: typecheck=${verify?.typecheck} lint=${verify?.lint} unit=${verify?.unitTests} convex=${verify?.convexDeploy}`)

phase('Critique')
const CTX = `Epic 6 build+verify done. Payroll files: ${JSON.stringify(payroll?.filesChanged ?? [])}. Reports files: ${JSON.stringify(reports?.filesChanged ?? [])}. Settings files: ${JSON.stringify(settings?.filesChanged ?? [])}. Backend (payroll): ${JSON.stringify(payroll?.backendChanges ?? [])}. Spec: ${REPORT} Sections 6.8/6.9/6.10, Section 4 (IA), Section 8.5 (Settings sticky), gates G4/G5/G14.\n${DS}`
const critiques = await parallel([
  () => agent(
    `${CTX}\n\nLENS: IA/LEDGER + PAYROLL PROVENANCE. Read the three screens + convex payroll/schema/crons/reportViews. Verify: (1) Payroll approve posts ONLY via the existing approveRun (server, wrapped in AlertDialog); markRunPaid reused; the auto-DRAFT path does NOT post to the ledger and is idempotent + a no-op on demo data without an enabled schedule; the Runs UI honestly labels source ("Auto-draft · needs review" vs "Manual") and the auto-run affordance does not imply automation that doesn't run; run.headcount reads the run's own snapshot lines; no localMinor/100 float string (money via Amount, integer minor units). (2) Reports is read-only over journalLines; drill-through routes to the register/lenses (Transactions ?focus=/account=/category=, Income, Expenses) and hands off — never edits the ledger; period=/start/end reconcile with the dashboard + lenses. (3) Settings touches no ledger; connection panels expose NO secrets (sandbox/test only); AR/AP/ledger numbers reconcile. (4) Any convex change re-checks entity/workspace auth + adds no posting/immutability change. Run \`pnpm --filter @openbooks/web typecheck\` + \`pnpm test\`. Cite path:line + fix. Read-only except checks.`,
    { label: 'crit:ia-payroll', phase: 'Critique', schema: CRITIQUE_SCHEMA }),
  () => agent(
    `${CTX}\n\nLENS: DESIGN-SYSTEM + TESTIDS + STICKY SUBNAV. GREP all three surfaces for raw hex/Tailwind where a token exists (bg-teal-600/bg-amber-500/bg-amber-100, #a4148c magenta avatar, text-red-*/bg-*-50, inline #hex), purple/gradient/glass, emoji/unicode-as-icon (✓ balanced-chip, ▲▼→ arrows — must be lucide Check/ArrowRight/TrendingUp/Down), non-tabular money, raw <select>/<input type=checkbox>/hand-rolled toggle (must be shadcn Select/Checkbox/Switch), payroll status chips (Draft neutral / Approved info-blue / Paid green). Confirm G14: the Settings desktop subnav is STICKY (lg:sticky lg:top-[72px] lg:self-start) and stays in viewport while content scrolls. THEN confirm preserved testids exist: Payroll (m6-payroll-screen, payroll-run-june/-run-row/-run-detail/-line-row/-approve/-approved-banner/-mark-paid/-base-total/-currency-totals/-statement-csv/-adjustment-input/-fx-input/-back/-error) + USD/INR/PKR payroll text + "Printable statement"; Reports (reports-screen/-home/-back, viewer-toolbar, basis-toggle/-cash/-accrual, compare-panel, range-preset, period-label, money-button, drill-sheet/-row/-total, explain-report, export-csv, balanced-chip, monthly-review, mr-*); Settings (settings-screen, ai-*, audit-*, businesses-*, categories-*/category-*, connections-*, data-*, notifications-section, rule-*/rule-editor/-preview*, live-sandbox-*). List any dropped/renamed. Cite path:line + fix. Read-only.`,
    { label: 'crit:design-sticky', phase: 'Critique', schema: CRITIQUE_SCHEMA }),
  () => agent(
    `${CTX}\n\nLENS: RESPONSIVE (report 8.2/8.5; gates G4/G5). Verify all three at 390/768/1306/1440/1758: (Reports, G5) P&L monthly grid + GL/Trial-Balance/Journal live in overflow-x-auto + min-w-0 regions and do NOT overlap at 1306/1440 even with the docked Ask AI overlay open — dense tables collapse to stacked label/value on narrow effective width. (Settings, G4) Audit grid + Rules controls + Stripe payouts never overflow their card — desktop min-w-0 truncate cells, mobile stacked label/value; the sticky subnav doesn't break layout; Plaid/Stripe consoles collapse multi-button rows to one-action-per-row at 390. (Payroll) run rows + the editable run-detail grid reflow to card-per-row on mobile (no horizontal-scroll table), the KpiStrip wraps (>3 currencies/headcount), and the run detail does NOT full-screen-swap the list. Flag any element causing horizontal overflow or text overlap with path:line + fix. Read-only.`,
    { label: 'crit:responsive', phase: 'Critique', schema: CRITIQUE_SCHEMA }),
])
const findings = critiques.filter(Boolean).flatMap((c) => (c.findings ?? []).map((f) => ({ ...f, lens: c.lens })))
const blockers = findings.filter((f) => f.severity === 'blocker' || f.severity === 'high')
log(`Critique: ${findings.length} findings (${blockers.length} blocker/high); verdicts ${critiques.filter(Boolean).map((c) => c.lens + '=' + c.verdict).join(', ')}`)

phase('Fix')
let fix = null
if (findings.length) {
  fix = await agent(
    `You are the FIX agent for Epic 6. Apply EVERY blocker/high finding and any clearly-correct medium/low one, editing ONLY the Epic 6 files (ModuleScreens.tsx Payroll region, module-helpers payroll types, convex payroll/payrollMath/schema/crons/moduleViews-payroll, ReportsScreen + report libs + reportViews, SettingsScreen + settings/* + connection panels). Do NOT touch other surfaces/regions, AppShell/AskAIWidget, Epic 1 primitives, globals.css, ui/ primitives, or any ledger WRITE/posting path. Keep every data-testid. Keep "AI proposes, ledger posts"; the auto-draft stays non-ledger; payroll Approve stays via approveRun behind an AlertDialog.\n\n${DS}\n\nFINDINGS:\n${JSON.stringify(findings, null, 1)}\n\nThen RUN from ${REPO}: \`pnpm --filter @openbooks/web typecheck\`, \`pnpm --filter @openbooks/web lint\`, \`pnpm test\`, and \`npx convex dev --once\`. Ensure typecheck + lint GREEN, no unit test regressed, convex deploys. Return the verify manifest.`,
    { label: 'epic6:fix', phase: 'Fix', schema: VERIFY_SCHEMA },
  )
  log(`Fix: typecheck=${fix?.typecheck} lint=${fix?.lint} unit=${fix?.unitTests} convex=${fix?.convexDeploy}`)
}

return { payroll, reports, settings, verify, critiques: critiques.filter(Boolean), findings, fix }
