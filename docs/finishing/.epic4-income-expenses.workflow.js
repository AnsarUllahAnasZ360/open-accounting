export const meta = {
  name: 'openbooks-epic4-income-expenses',
  description: 'Epic 4: turn Income and Expenses into analytical LENSES over the same posted records (not duplicate registers), assembled from the Epic 1 workbench toolkit with detail closed by default and drill-through into Transactions. Income and Expenses are disjoint files built in parallel, then unified-verified, adversarially critiqued, and fixed.',
  phases: [
    { title: 'Build', detail: 'two parallel sibling agents: Income (IncomeScreen+incomeViews) and Expenses (ExpensesScreen+expensesViews)' },
    { title: 'Verify', detail: 'one agent runs the authoritative typecheck/lint/unit on the combined tree and reconciles any cross-file errors' },
    { title: 'Critique', detail: 'parallel critics: lens-IA/reconciliation/ledger, design-system+testids, responsive' },
    { title: 'Fix', detail: 'apply confirmed fixes; re-green typecheck/lint/unit' },
  ],
}

const REPO = '/Volumes/SSD/OpenBooks'
const WEB = 'apps/web'
const REPORT = 'docs/finishing/frontend-redesign-research-report.md'

const DS = `OpenBooks DESIGN SYSTEM (HARD rules — any violation is a bug):
- White ledger surfaces; Geist (UI) + Geist Mono for ALL money/dates via the \`money-figures\` class (tabular-nums, letter-spacing 0).
- ONE brand green #2ca01c. AI affordances GREEN (text-ai/--ai, bg-ai-surface, lucide Sparkles), NEVER purple/violet/indigo/gradient.
- Money-in MAY be green; ordinary expenses are NEUTRAL (text-muted-foreground), NEVER alarm red. text-negative (#d92d20) is ONLY for overdue/outflow/destructive (e.g. an OVERDUE receivable). Do NOT pass a blanket \`signed\` flag to <Amount> — tone derives from semantic role.
- Use SEMANTIC TOKENS, never raw Tailwind/hex: route ALL reds through text-negative/bg-negative-surface (drop raw text-red-*/bg-red-50 — present today at IncomeScreen.tsx:24-32/115/245/651), ALL blues through --info (drop raw blue-*), and series/category swatches through --chart-1..5 ONLY. REMOVE the off-palette DOTS array in ExpensesScreen.tsx:29 (it hardcodes Stripe blurple #635bff + plum #7a4a8c as generic category swatches) — replace with --chart-1..5. Stripe blurple #635bff is allowed ONLY on a Stripe-specific badge, never a generic category color.
- BANNED: gradients, glassmorphism, emoji, unicode-as-icon — replace ▲/▼ trend glyphs (ExpensesScreen.tsx:71/80) with lucide TrendingUp/TrendingDown; no ✓/→ as functional glyphs.
- shadcn/ui primitives BEFORE raw controls: swap raw <select> for shadcn Select. Mobile is a real responsive surface (card-stack), not a squeezed desktop table.`

const SKILLS = `BEFORE you build, READ and follow:
- shadcn rules: ${REPO}/.claude/skills/shadcn/SKILL.md + rules/styling.md + rules/composition.md + rules/forms.md (className=LAYOUT only; gap not space-x/space-y; size-* when w==h; Dialog/Sheet/Drawer need a Title; items inside their Group; Badge/Skeleton/Empty over custom; toasts via sonner).
- frontend-design doctrine: ${REPO}/.claude/skills/frontend-design/SKILL.md (write UI copy from the owner's side; quiet, intentional).`

const FOUNDATION = `FOUNDATION IN PLACE — ASSEMBLE FROM THESE; do not re-implement tables/filters/detail/KPIs:
- Epic 1 workbench toolkit, import from \`@/components/openbooks/workbench\`: WorkbenchPage, PageActionBar (type ActionItem), DateRangeControl (DateRangePreset, DateRangeValue), FilterBar (FacetDef, FacetOption, FacetValue, ActiveChip), AccountMultiSelect (AccountOption), KpiStrip (KpiItem), OpenBooksDataTable (ColumnDef<Row>), DetailSheet (DetailTab), AiInsightBadge, EvidenceUpload (EvidenceDocument), ExportMenu (ExportFormat), AttentionState + attentionMeta + AttentionKind, useIsMobile. READ each file under ${WEB}/src/components/openbooks/workbench/ before using it.
  KEY API: OpenBooksDataTable is generic <Row> { columns: ColumnDef<Row>[], rows, getRowId, selectable?, selectedIds?, onSelectionChange?, onRowClick?(row), density?, loading?, empty?, bulkActions?, attention?, rowAttributes?:(row)=>Record<string,string|undefined> (spreads data-* onto the row+card — use it to keep e2e testids like payment-row/invoice-row/receivable-row/recurring-row/expense-category-row on each row) }. ColumnDef { key, header, align?, mono?, width?, sortable?, cell, sortValue?, priority?:1|2, mobilePrimary?, mobileTrailing? }. It already renders desktop overflow-x-auto sticky table + mobile card stack — responsive is free. DetailSheet is CLOSED by default: right Sheet on lg+, bottom Drawer on mobile; { open, onOpenChange, title, subtitle?, attention?, tabs?:DetailTab[], children, footer? }. KpiStrip { items:KpiItem[], columns?:3|4 }, KpiItem { label, value, tone?:"neutral"|"income"|"negative", delta?:{pct,direction}, detail?, sparkline?:number[] }.
- AttentionState vocabulary: needs-review | missing-evidence | overdue | unmatched | unposted | low-confidence.
- Tokens in globals.css: text-negative/bg-negative-surface, text-ai/bg-ai-surface, --ob-green-50..900, --info/--warning surfaces, --chart-1..5. Existing primitives (${WEB}/src/components/openbooks/primitives.tsx): Amount (tone: neutral|income|expense), formatMinorMoney, EmptyState, Sparkline, BarChart, AgingMiniBar, ConfidenceRing — REUSE, don't duplicate.
- Epic 3 shipped Transactions as the universal register WITH a working detail deep-link: navigating to \`/transactions?focus=<txnId>\` opens that transaction's detail. USE THIS for drill-through (a payment/expense row drills into the SAME record). The shell (Epic 2) owns the header/nav/Ask AI — do NOT touch AppShell/AskAIWidget.
- shadcn Tabs already exists (${WEB}/src/components/ui/tabs.tsx) — use it for the view tabs (keep the income-tab-invoices/income-tab-receivables testids on the tab triggers).`

const CONTRACTS = `REAL DATA CONTRACTS (read the files; do NOT invent shapes, do NOT duplicate Transactions truth):
- Income read-model: convex/incomeViews.ts. It is a pure READ over the SAME transactions + journalLines + invoices that Transactions/Reports read (payments tab filters transactions amountMinor>0; receivables call the report pack's buildAgingRows so they reconcile with AR aging). Payment rows already carry the underlying txn._id (~incomeViews.ts:113) — use it to drill into /transactions?focus=. Read the query to see exactly what each view returns.
- Expenses read-model: convex/expensesViews.ts. Expense amount = debitMinor − creditMinor over expense-account journal lines (~75-98) — the SAME convention as the report pack P&L, which is what makes category totals reconcile to the P&L expense section (a GATED requirement; convex/expensesViews.test.ts asserts it and MUST stay green). overview() (~266-274) currently returns no uncategorizedCount/missingEvidenceCount/topVendor.
- The current screens: ${WEB}/src/components/openbooks/IncomeScreen.tsx and ExpensesScreen.tsx. Read both fully before editing.`

const INCOME_TASKS = `INCOME BUILD (you own ONLY ${WEB}/src/components/openbooks/IncomeScreen.tsx + convex/incomeViews.ts) — read ${REPORT} Section 6.4, Section 4 (IA), Section 8; and grep IncomeScreen.tsx for data-testid and PRESERVE every one.
Make Income an honest revenue LENS, not a sibling silo, in the shared WorkbenchPage frame:
- KpiStrip (4 tiles, tabular, mostly neutral; only OVERDUE may be text-negative): Received (this period) · Open + Overdue receivables (one card, two figures) · Avg days to pay (label net-terms until real payment dates exist) · Recurring revenue / MRR with a Sparkline trend. KEEP the exact e2e-asserted label strings "Received · this month" and "Avg days to pay" so income-expenses-bills.spec stays green.
- Replace the bespoke segmented control with shared shadcn Tabs exposing five views: Payments, Invoices, Customers, Streams, Receivables. KEEP testids income-payments, income-invoices, income-receivables and the tab-trigger testids income-tab-invoices/income-tab-receivables (add income-tab-payments/customers/streams in the same style).
- Above the tabs: shared FilterBar + DateRangeControl + AccountMultiSelect (customer/account) that drive every view AND the KPIs. Kill the frozen MONTH_START/TODAY constants — pass an explicit range to incomeViews (if the query needs a range arg it does not accept, add it server-side, entity-scoped, and FLAG it).
- IA DRILL-THROUGH (the load-bearing requirement): every Payments row (payment-row testid) must drill into the SAME transaction record — router.push(\`/transactions?focus=\${txn._id}\`) and/or open a shared DetailSheet — plus a visible "View in Transactions" link. One record, richer view — never a second copy.
- Tables: table-first via OpenBooksDataTable (detail CLOSED by default — preserve the good detailId-null pattern), tabular money, mobile card-stack. Keep payment-row, invoice-row, receivable-row, receivables-total testids (via rowAttributes / element ids).
- Invoice lifecycle stays here (AR): keep the invoice composer + its testids (invoice-composer, composer-customer/-line-desc/-line-rate/-add-line/-save-draft/-send/-finalize/-total/-error, income-new-invoice) and the invoice detail (invoice-detail, invoice-detail-message, invoice-finalize, invoice-void, invoice-send-reminder, invoice-timeline, invoice-hosted-link, invoice-overdue-note). RESTORE the dropped "Download PDF" invoice action. Money stays integer minor units — if the composer does float math (Math.round(Number(rate)*100)*qty), keep it integer-safe; do NOT add a new ledger write path (invoices.saveDraft owns posting).
- Charts via existing primitives (BarChart/Sparkline/AgingMiniBar) using --chart-1..5: revenue by Stream (income ledger account — reuse reportViews grouping so it reconciles with P&L revenue), revenue by Customer, Recurring vs one-time, AR aging on Receivables.
- New Customers tab: per-customer received + open balance + last-paid (rows open the contact or link to Contacts). New Streams tab: revenue grouped by income ledger account.
- Copy: soften "Receivables" to "Money owed" (keep an Accountant alias). Route ALL reds through text-negative, blues through --info; swap raw <select> for shadcn Select. Quiet green AI affordances.
- RECONCILIATION INVARIANT: revenue analytics MUST equal the Reports P&L revenue section; receivables MUST reconcile with AR aging (you read the same invoice set / report-pack math — do not recompute a divergent total).`

const EXPENSES_TASKS = `EXPENSES BUILD (you own ONLY ${WEB}/src/components/openbooks/ExpensesScreen.tsx + convex/expensesViews.ts) — read ${REPORT} Section 6.5, Section 4 (IA), Section 8; and grep ExpensesScreen.tsx for data-testid and PRESERVE every one.
Make Expenses a true cost LENS over the same posted records, table-first, matching Transactions/Income parity but staying a lens (never a second store), in the shared WorkbenchPage frame:
- Header ("Expenses" / "Where money goes, by category and vendor") + shared DateRangeControl (preset + custom range, NEVER defaulting to a future period) + AccountMultiSelect, replacing the 2-segment toggle.
- KpiStrip (5 tiles, tabular, NEUTRAL tone — expenses are never alarm red): Spent this period · Recurring spend /mo · Uncategorized count (clicks to the filtered table) · Missing-evidence count (expenses with no receipt) · Top vendor (or Top category). The last three need NEW fields on expensesViews.overview (uncategorizedCount, missingEvidenceCount, topVendor) — add them server-side, entity-scoped, derived from already-loaded docs, and FLAG each. KEEP the e2e-asserted KPI label strings "Recurring spend" and "Still open" present so income-expenses-bills.spec stays green.
- shadcn Tabs (keep expenses-categories, expenses-recurring testids; add expenses-transactions/-vendors/-evidence): Transactions (DEFAULT — a full expense table: date, merchant, category Select, account, evidence chip, amount right-aligned NEUTRAL; row-detail CLOSED by default, opening a DetailSheet only on selection), Categories (keep the breakdown but drive dots from --chart-1..5 tokens, swap ▲/▼ for lucide TrendingUp/Down, link each row to the filtered Transactions tab AND to Reports P&L to prove agreement; keep expense-category-row, expenses-total), Vendors (NEW ranked vendor table: spend + recurring flag), Recurring (keep detection list — keep recurring-row — add a small Sparkline recurring-trend), Evidence Needed (expenses missing a receipt, with the EvidenceUpload affordance).
- Charts: by-category bar + by-vendor bar from primitives.BarChart using --chart-1..5; an unusual-spend callout for the biggest mover (quiet AMBER --warning, NOT red).
- Inline re-categorize MUST reverse+repost via the EXISTING ledger path the Transactions register uses (the shared recategorize mutation) — NEVER a client-side post and NEVER a new write path. Category CRUD: keep the AddCategoryModal (keep add-category-modal, expenses-add-category, category-create, category-name, category-group testids).
- Filters shared and persist across tabs. Remove the off-palette DOTS array; ensure ordinary expense amounts stay NEUTRAL.
- HARD RECONCILIATION CONSTRAINT: category totals MUST continue to reconcile to the P&L (debit−credit convention in expensesViews.ts:75-98) and the table MUST read the same journal-line-backed records, never a parallel list. convex/expensesViews.test.ts MUST stay green — run it.`

const RULES = `RULES (both build agents):
- A SIBLING agent is concurrently editing the OTHER lens. Income owns IncomeScreen.tsx + convex/incomeViews.ts; Expenses owns ExpensesScreen.tsx + convex/expensesViews.ts. Edit ONLY your files. Do NOT touch the sibling's files, AppShell/AskAIWidget, the Epic 1 workbench primitives, globals.css, ui/ primitives, CoreScreens.tsx, ModuleScreens.tsx, ReportsScreen, or Settings.
- Backend: you MAY add READ-ONLY fields/args to YOUR view query if a KPI/view genuinely needs one the query does not return. If you touch convex/, FIRST read convex/_generated/ai/guidelines.md; re-check workspace/entity authorization on the server (entity-scoped reads through by_entity indexes); money stays integer minor units + currency; add NO ledger write path or schema posting change; FLAG every backend change in the manifest (file:line + field + why + auth note).
- Reuse EXISTING mutations for any action (recategorize/exclude/invoice save/finalize/send/void) — never post from the client. "AI proposes, the ledger posts."
- Run YOUR files' typecheck mentally/locally, but because the sibling is editing concurrently, DO NOT run a full-project fix loop — if \`pnpm --filter @openbooks/web typecheck\` reports errors ONLY in the sibling's files, note it and leave it; the Verify stage reconciles. Ensure YOUR code is type-correct and lint-clean. Return your manifest.`

const MANIFEST_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lens', 'filesChanged', 'whatChanged', 'detailClosedByDefault', 'reconciliation', 'backendChanges', 'testidsPreserved', 'ledgerSafety', 'risks'],
  properties: {
    lens: { type: 'string', enum: ['income', 'expenses'] },
    filesChanged: { type: 'array', items: { type: 'string' } },
    whatChanged: { type: 'string' },
    detailClosedByDefault: { type: 'string', description: 'Confirm detail/drawer opens only on row selection (no auto-select).' },
    reconciliation: { type: 'string', description: 'How revenue/cost totals still reconcile to Reports P&L / AR aging (same read-model, no divergent recompute).' },
    backendChanges: { type: 'array', items: { type: 'string' }, description: 'Each convex/ change as file:line + field + why + entity-auth note. Empty if none.' },
    testidsPreserved: { type: 'string' },
    ledgerSafety: { type: 'string', description: 'No client posting; reused mutations named; money integer minor units.' },
    risks: { type: 'array', items: { type: 'string' } },
  },
}

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['typecheck', 'lint', 'unitTests', 'expensesViewsTest', 'whatFixed', 'risks'],
  properties: {
    typecheck: { type: 'string', enum: ['green', 'failing'] },
    lint: { type: 'string', enum: ['green', 'failing'] },
    unitTests: { type: 'string', description: 'vitest result, e.g. "151 passed".' },
    expensesViewsTest: { type: 'string', description: 'Result of convex/expensesViews.test.ts (the P&L reconciliation guard).' },
    whatFixed: { type: 'string', description: 'Any cross-file/integration errors reconciled across the two lenses.' },
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
    `You are the INCOME build agent for Epic 4 of the OpenBooks redesign. Build the Income revenue lens on the workbench toolkit.\n\n${SKILLS}\n\n${DS}\n\n${FOUNDATION}\n\n${CONTRACTS}\n\n${INCOME_TASKS}\n\n${RULES}\n\nReturn the manifest (lens="income").`,
    { label: 'epic4:income', phase: 'Build', schema: MANIFEST_SCHEMA }),
  () => agent(
    `You are the EXPENSES build agent for Epic 4 of the OpenBooks redesign. Build the Expenses cost lens on the workbench toolkit.\n\n${SKILLS}\n\n${DS}\n\n${FOUNDATION}\n\n${CONTRACTS}\n\n${EXPENSES_TASKS}\n\n${RULES}\n\nReturn the manifest (lens="expenses").`,
    { label: 'epic4:expenses', phase: 'Build', schema: MANIFEST_SCHEMA }),
])
const income = builds[0], expenses = builds[1]
log(`Build: income files=${income?.filesChanged?.length} backend=${(income?.backendChanges||[]).length}; expenses files=${expenses?.filesChanged?.length} backend=${(expenses?.backendChanges||[]).length}`)

phase('Verify')
const verify = await agent(
  `You are the VERIFY agent for Epic 4. Two sibling agents just built the Income and Expenses lenses concurrently (Income: IncomeScreen.tsx + convex/incomeViews.ts; Expenses: ExpensesScreen.tsx + convex/expensesViews.ts). Run the AUTHORITATIVE checks on the combined tree and reconcile ANY errors across BOTH lenses' files (you may edit IncomeScreen/ExpensesScreen/incomeViews/expensesViews to fix type/lint/integration errors, but stay within those four files + do not add ledger write paths or touch other surfaces).\n\nFrom ${REPO} run: \`pnpm --filter @openbooks/web typecheck\`, \`pnpm --filter @openbooks/web lint\`, and \`pnpm test\` (vitest — this includes convex/expensesViews.test.ts, the P&L reconciliation guard, which MUST pass). Fix until typecheck + lint are GREEN and no unit test regressed (baseline is 151 passing). If expensesViews.test.ts fails, the Expenses category totals no longer reconcile to the P&L — fix the read-model, do not weaken the test.\n\n${DS}\n\nReturn the verify manifest.`,
  { label: 'epic4:verify', phase: 'Verify', schema: VERIFY_SCHEMA },
)
log(`Verify: typecheck=${verify?.typecheck} lint=${verify?.lint} unit=${verify?.unitTests} expensesTest=${verify?.expensesViewsTest}`)

phase('Critique')
const CTX = `Epic 4 build+verify done. Income files: ${JSON.stringify(income?.filesChanged ?? [])}. Expenses files: ${JSON.stringify(expenses?.filesChanged ?? [])}. Backend changes: income=${JSON.stringify(income?.backendChanges ?? [])} expenses=${JSON.stringify(expenses?.backendChanges ?? [])}. Spec: ${REPORT} Sections 6.4/6.5, Section 4 (IA), Section 8.\n${DS}`
const critiques = await parallel([
  () => agent(
    `${CTX}\n\nLENS: LENS-IA + RECONCILIATION + LEDGER. Read IncomeScreen.tsx, ExpensesScreen.tsx, incomeViews.ts, expensesViews.ts. Verify: (1) Income & Expenses are LENSES — they READ the same transactions/journalLines/invoices, they do NOT duplicate or re-store records; a Payments row drills into the SAME transaction (/transactions?focus= or a shared detail) with a "View in Transactions" link. (2) RECONCILIATION: revenue analytics derive from the same report-pack/invoice math as Reports P&L revenue + AR aging; Expenses category totals = debit−credit (expensesViews.ts:75-98) and convex/expensesViews.test.ts passes — run \`pnpm test\` yourself and report. (3) NO client-side ledger posting; recategorize/invoice actions reuse existing mutations; money integer minor units. (4) Any convex/ change is a read-only, entity-auth-rechecked query addition with no write path. (5) detail CLOSED by default (no auto-select). Cite path:line + fix. Read-only except running checks.`,
    { label: 'crit:lens-recon', phase: 'Critique', schema: CRITIQUE_SCHEMA }),
  () => agent(
    `${CTX}\n\nLENS: DESIGN-SYSTEM + TESTIDS. GREP both screens for violations: raw text-red-*/bg-red-50 (must be text-negative/bg-negative-surface), raw blue-* (must be --info), the off-palette DOTS array / ad-hoc purple/plum/Stripe-blurple as a GENERIC category swatch (must be --chart-1..5; Stripe blurple only on a Stripe badge), unicode ▲▼→✓ (must be lucide), raw <select> (must be shadcn Select), non-tabular money (must be Amount/money-figures), expenses rendered alarm-red (must be neutral), emoji/gradient/glassmorphism. THEN confirm every preserved data-testid still exists on an equivalent element: income (income-screen, income-payments, income-invoices, income-receivables, income-tab-invoices, income-tab-receivables, income-new-invoice, payment-row, invoice-row, receivable-row, receivables-total, invoice-composer, composer-customer/-line-desc/-line-rate/-save-draft/-send/-finalize/-total/-add-line/-error, invoice-detail, invoice-detail-message, invoice-finalize, invoice-void, invoice-send-reminder, invoice-timeline, invoice-hosted-link, invoice-overdue-note) and the e2e text "Received · this month"/"Avg days to pay"; expenses (expenses-screen, expenses-categories, expenses-recurring, expenses-total, expenses-add-category, expense-category-row, recurring-row, add-category-modal, category-create, category-name, category-group) and the e2e text "Recurring spend"/"Still open". List any dropped/renamed. Cite path:line + fix. Read-only.`,
    { label: 'crit:design-testids', phase: 'Critique', schema: CRITIQUE_SCHEMA }),
  () => agent(
    `${CTX}\n\nLENS: RESPONSIVE (report 8.2/8.4). Verify both screens at 390/768/1306/1440/1758: tables use OpenBooksDataTable (overflow-x-auto + min-w-0, mobile card-stack — no squeezed desktop table, no competing overflow-hidden/fixed-width wrapper), KpiStrip wraps/stacks (1→2→3/4) with min-w-0 hero figures (no 9-digit overflow), charts/legends don't overflow at 390, the DetailSheet is a bottom Drawer on mobile + right Sheet desktop, Tabs don't overflow (scroll/wrap), FilterBar facets collapse below md. Flag any element causing horizontal overflow or text overlap with path:line + fix. Read-only.`,
    { label: 'crit:responsive', phase: 'Critique', schema: CRITIQUE_SCHEMA }),
])
const findings = critiques.filter(Boolean).flatMap((c) => (c.findings ?? []).map((f) => ({ ...f, lens: c.lens })))
const blockers = findings.filter((f) => f.severity === 'blocker' || f.severity === 'high')
log(`Critique: ${findings.length} findings (${blockers.length} blocker/high); verdicts ${critiques.filter(Boolean).map((c) => c.lens + '=' + c.verdict).join(', ')}`)

phase('Fix')
let fix = null
if (findings.length) {
  fix = await agent(
    `You are the FIX agent for Epic 4. Apply EVERY blocker/high finding and any clearly-correct medium/low one, editing ONLY the four Epic 4 files (IncomeScreen.tsx, ExpensesScreen.tsx, convex/incomeViews.ts, convex/expensesViews.ts — read-only field additions only on the convex side). Do NOT touch AppShell/AskAIWidget, Epic 1 primitives, globals.css, ui/ primitives, CoreScreens/ModuleScreens/Reports/Settings, or any ledger write path. Keep every data-testid + the e2e-asserted KPI label strings. Preserve reconciliation (expensesViews.test.ts must stay green). "AI proposes, ledger posts."\n\n${DS}\n\nFINDINGS:\n${JSON.stringify(findings, null, 1)}\n\nThen RUN from ${REPO}: \`pnpm --filter @openbooks/web typecheck\`, \`pnpm --filter @openbooks/web lint\`, and \`pnpm test\` until typecheck + lint are GREEN and no unit test regressed. Return the verify manifest.`,
    { label: 'epic4:fix', phase: 'Fix', schema: VERIFY_SCHEMA },
  )
  log(`Fix: typecheck=${fix?.typecheck} lint=${fix?.lint} unit=${fix?.unitTests} expensesTest=${fix?.expensesViewsTest}`)
}

return { income, expenses, verify, critiques: critiques.filter(Boolean), findings, fix }
