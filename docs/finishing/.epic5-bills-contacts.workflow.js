export const meta = {
  name: 'openbooks-epic5-bills-contacts',
  description: 'Epic 5: reframe Bills as an Accounts-Payable workbench and Contacts as a full-width directory (both detail-closed-by-default) on the Epic 1 toolkit, with the approved Contacts SOFT-ARCHIVE (never hard delete). Single owning file ModuleScreens.tsx (+ module-helpers.ts, moduleViews.ts, contacts soft-archive backend), then adversarial critique and fix.',
  phases: [
    { title: 'Build', detail: 'one AP/directory agent rewrites BillsScreen + ContactsScreen sequentially in the shared file' },
    { title: 'Critique', detail: 'parallel critics: AP/IA/ledger+archive-safety, design-system+testids, responsive' },
    { title: 'Fix', detail: 'apply confirmed fixes; re-green typecheck/lint/unit' },
  ],
}

const REPO = '/Volumes/SSD/OpenBooks'
const WEB = 'apps/web'
const REPORT = 'docs/finishing/frontend-redesign-research-report.md'

const DS = `OpenBooks DESIGN SYSTEM (HARD rules — any violation is a bug):
- White ledger surfaces; Geist + Geist Mono money/dates via \`money-figures\` (tabular-nums, letter-spacing 0).
- ONE brand green #2ca01c. AI affordances GREEN (text-ai/--ai, bg-ai-surface, lucide Sparkles), NEVER purple/violet/indigo/gradient.
- Money-in MAY be green; ordinary amounts NEUTRAL (text-muted-foreground). text-negative (#d92d20) is ONLY for OVERDUE/destructive; due-soon uses --warning (#b54708). Do NOT pass a blanket \`signed\` flag to <Amount>.
- Use SEMANTIC TOKENS, never raw hex/Tailwind: text-negative/bg-negative-surface (drop text-red-*), --warning for due-soon, --info for in-flight, --chart-1..5 for series; fix the BusinessesSection-style magenta avatar (#a4148c) and any role-chip colors to tokens. Customer role chip = green, vendor = neutral. Stripe blurple #635bff ONLY on a Stripe badge.
- BANNED: gradients, glassmorphism, emoji, unicode-as-icon (use lucide Check/ArrowRight/Clock/AlertCircle/Unlink/Receipt). shadcn Select not raw <select>; shadcn Checkbox not raw checkbox.
- Mobile is a real responsive surface (card-stack / bottom Drawer), not a squeezed desktop table.`

const SKILLS = `BEFORE you build, READ and follow:
- shadcn rules: ${REPO}/.claude/skills/shadcn/SKILL.md + rules/styling.md + rules/composition.md + rules/forms.md.
- frontend-design doctrine: ${REPO}/.claude/skills/frontend-design/SKILL.md (owner-side copy; quiet, intentional).
- Convex guidelines: ${REPO}/convex/_generated/ai/guidelines.md (READ before touching any convex/ file).`

const FOUNDATION = `FOUNDATION IN PLACE — ASSEMBLE FROM THESE; do not re-implement tables/filters/detail/KPIs:
- Epic 1 workbench toolkit, import from \`@/components/openbooks/workbench\`: WorkbenchPage, PageActionBar (ActionItem), DateRangeControl, FilterBar (FacetDef/FacetOption/FacetValue/ActiveChip), AccountMultiSelect (AccountOption), KpiStrip (KpiItem), OpenBooksDataTable (ColumnDef<Row>, incl. optional rowAttributes:(row)=>Record<string,string|undefined> to keep e2e data-testids/data-* on rows), DetailSheet (DetailTab), AiInsightBadge, EvidenceUpload (EvidenceDocument), ExportMenu (ExportFormat), AttentionState + attentionMeta + AttentionKind, useIsMobile. READ each file under ${WEB}/src/components/openbooks/workbench/ before using it. OpenBooksDataTable already gives desktop overflow-x-auto sticky table + mobile card-stack; DetailSheet is CLOSED by default (right Sheet on lg+, bottom Drawer on mobile). KpiStrip { items:KpiItem[], columns?:3|4 } — for 6 Bills tiles use columns and let it wrap; KpiItem tone "neutral"|"income"|"negative".
- AttentionState vocabulary: needs-review | missing-evidence | overdue | unmatched | unposted | low-confidence — use overdue (text-negative) and missing-evidence/unmatched here.
- Tokens in globals.css: text-negative/bg-negative-surface, --warning/--info/--ob-green/--ai surfaces, --chart-1..5. Existing primitives (${WEB}/src/components/openbooks/primitives.tsx): Amount (tone neutral|income|expense), formatMinorMoney, EmptyState, AgingMiniBar, Avatar usage, BarChart, ConfidenceRing — REUSE. shadcn Avatar exists (ui/avatar.tsx → Avatar/AvatarImage/AvatarFallback). shadcn alert-dialog exists (ui/alert-dialog) — use it to confirm Mark-paid/Archive.
- Epic 3 (Transactions) + Epic 4 (Income/Expenses) already shipped; the Transactions detail deep-link /transactions?focus=<txnId> EXISTS — use it for "view the matched bank transaction". Do NOT touch CoreScreens/IncomeScreen/ExpensesScreen, AppShell, AskAIWidget, the Epic 1 primitives, globals.css, or ui/ primitives.
- CommandPalette stays at ${WEB}/src/components/openbooks/CommandPalette.tsx (contact quick-nav may reference it; don't rewrite it).`

const CONTRACTS = `REAL DATA CONTRACTS (read the files; do NOT invent shapes, do NOT duplicate Transactions truth):
- Bills + Contacts UI live in ${WEB}/src/components/openbooks/ModuleScreens.tsx (BillsScreen ~line 473, BillMatchPicker ~812, AddBillModal ~875, ContactsScreen ~later; routing AppScreen.tsx:62-63). Row helpers in ${WEB}/src/components/openbooks/module-helpers.ts (BillRow ~142, bills view shape ~16-52, ContactRow ~115, statusLabel ~186). Read all of these.
- Backend read-models: convex/moduleViews.ts (billRows ~328, billGroups ~348, bills KPIs ~499, contacts overview). Bills mutations: convex/bills.ts (matchCandidates ~137, markPaid ~179, createBill ~302). Contacts: convex/schema.ts contacts table ~line 231 (check whether it already has an \`archived\` field; entities have one at ~54 but contacts may not). Contact mutations: look in convex/contacts.ts (per the audit there is NO delete/archive mutation today).
- The AP payable's bank-side PAYMENT row lives in Transactions (the universal register) — Bills only references/matches it via entryIds/matched txn, never owns or duplicates it. Contacts AR/AP figures must derive from the SAME invoices/bills the Income/Bills lenses use so they reconcile (do not net AR against AP into one misleading cell — show them separately).`

const BILLS_TASKS = `BILLS BUILD (report 6.6; Epic 5 scope ~1599-1613) — rebuild as ONE Accounts-Payable workbench in the shared WorkbenchPage frame. Grep ModuleScreens.tsx for the Bills data-testids and PRESERVE: m6-bills-screen, bills-add-bill, bills-open-total, bill-row, bill-vendor, bill-amount, bill-due, bill-create, bill-mark-paid, bill-detail-mark-paid, bill-match-picker, bill-match-candidate, bill-match-error, bill-schedule-expected, add-bill-modal. modules.spec.ts also asserts getByText("Selected bill") — keep a "Selected bill" string reachable (e.g. the bill DetailSheet title/subtitle or its closed-state hint) OR flag the exact spec line for the Epic 7 e2e migration.
- Header: title "Bills" + one-line subtitle; PageActionBar primary "Add bill" and "Upload bill" (Upload = the 2-path chooser: PDF → AI-extract-and-confirm vs manual form — replace the manual-only AddBillModal; keep add-bill-modal + bill-create + bill-vendor/bill-amount/bill-due testids on the manual path).
- KpiStrip (6 tiles): Open total (keep bills-open-total), Overdue (text-negative), Due soon next 7d (--warning), Paid this period, Missing evidence (open bills with no linked document), Avg days to pay. The three missing metrics (due-soon, missing-evidence, avg-days) must be computed in convex/moduleViews.ts alongside the existing bills KPIs (read-only) — FLAG them.
- FilterBar: status (open/overdue/due-soon/paid), vendor (AccountMultiSelect-style), due-window, source (manual/PDF/recurring), an "evidence: missing" toggle, free-text search, and an ExportMenu (CSV == on-screen values).
- ONE OpenBooksDataTable (NOT four group Cards): columns vendor, bill #, due date (relative "in 3d"/"5d overdue"), amount (right tabular), status chip (AttentionState), category, evidence (paperclip if document linked else "missing"), payment match (matched txn or "expected" — keep bill-schedule-expected), source, AI confidence ring. Default sort overdue→due-soon→later→paid then dueDate. Keep bill-row + bill-vendor/amount/due via cells/rowAttributes. Detail CLOSED by default.
- DetailSheet (opens only on row click): header vendor+amount+status; sections evidence preview (EvidenceUpload to attach if missing), extracted fields with per-field AI confidence (green/amber underline), payment schedule + matched bank txn (link via /transactions?focus=), ledger impact (AP journal lines from entryIds, read-only — "AI proposes, ledger posts"), approval/posting history. Primary action "Mark paid & match" reuses BillMatchPicker (keep bill-match-picker/-candidate/-error, bill-mark-paid, bill-detail-mark-paid) — wrap the post in an AlertDialog confirm. Preserve createBill/markPaid/matchCandidates mutations exactly.
- Strictly a payable workflow — NO revenue/transaction duplication.`

const CONTACTS_TASKS = `CONTACTS BUILD (report 6.7; Epic 5 scope) — make the directory the surface, full-width, detail closed by default. Grep ModuleScreens.tsx for Contacts data-testids and PRESERVE: m6-contacts-screen, contact-row, contact-profile (move it onto the new DetailSheet body so it exists only after a row click).
- Replace the boxed ModuleIntro with a plain header (title "Contacts" / subtitle "Customers and vendors, one directory — most created automatically") + a primary "Add contact" action that opens a real create form (wire to an existing or new createContact mutation; if none exists, add one — entity-scoped, FLAG it).
- Render FULL-WIDTH (max-w-1200) as a single dense OpenBooksDataTable; REMOVE the permanent profile column and the empty-pane card. Detail opens only on row click into a right DetailSheet (bottom Drawer on mobile), CLOSED by default — keep contact-profile on that sheet body.
- Thin KpiStrip above the table (Open A/R total, Open A/P total, contacts count, overdue-AR count) ONLY if it reconciles with Income/Bills lenses (same invoice/bill set).
- FilterBar: segmented role pills (All / Customers / Vendors — gate employee/contractor until the schema supports them; do NOT fake them) + quick toggles (Open AR, Open AP, Recently active) + an "Archived" filter, and search over name+aliases+email.
- Columns: avatar+name (alias sub-line), role chips (Title-case; customer=green, vendor=neutral), Money in YTD, Money out YTD, Open balance (quiet overdue marker with text-negative + lucide AlertCircle only when AR is past due — do NOT net AR against AP into one cell; show separately), Last activity (use computed lastActivity), default-category/rule chip (quiet green Sparkles when a category rule is set). Money mono tabular; expenses neutral; AR-overdue the only red.
- DetailSheet: header avatar+name+role chips (+ a Stripe badge in Stripe blurple ONLY if a real stripe flag exists; do NOT fabricate one — flag if missing); three KPIs (Lifetime, They owe you / You owe them, Avg); tabs: Activity (invoices+payments or txns+bills), Aliases, Rules (default-category-as-rule, quiet green Sparkles, shown only when a category is set), Notes (editable). Merge-duplicates affordance (alias-similarity suggestion as a quiet inline banner with Merge / Keep separate) — if safe reference re-pointing is NOT supported by the backend, render the suggestion UI but make the actual Merge a flagged follow-up rather than risk corrupting ledger contactId references.
- ARCHIVE = SOFT, never hard delete (approved decision D1/11.0): add \`archived: v.optional(v.boolean())\` to the contacts table in convex/schema.ts if missing; add archiveContact/unarchiveContact mutations (set the flag; re-check workspace/entity auth; preserve ALL contactId references on journal lines/bills/invoices — posted ledger history is immutable); drop archived contacts from the default directory (restorable via the "Archived" filter). The Archive action uses an AlertDialog confirm. NO destructive delete path.`

const RULES = `RULES:
- Allowed to edit: ${WEB}/src/components/openbooks/ModuleScreens.tsx (BillsScreen + ContactsScreen + BillMatchPicker + AddBillModal regions — do Bills FIRST, then Contacts, SEQUENTIALLY in this one file; leave Payroll/Invoices/Settings regions of this file UNTOUCHED — they are Epic 6), ${WEB}/src/components/openbooks/module-helpers.ts (BillRow/ContactRow/statusLabel), and the BACKEND for the approved scope only: convex/moduleViews.ts (read-only KPI/field additions for Bills + Contacts), convex/schema.ts (add contacts \`archived\` optional field if missing — additive only), convex/contacts.ts (add archiveContact/unarchiveContact + createContact/updateContact if needed). You MAY add read-only fields/args to those queries. If you touch convex/, FIRST read convex/_generated/ai/guidelines.md; re-check workspace/entity authorization in every query/mutation; money stays integer minor units + currency; add NO ledger WRITE path / no posting/immutability change (archive is a non-ledger contact flag); reuse createBill/markPaid/matchCandidates for bills exactly; FLAG every backend change (file:line + what + why + auth note) in the manifest.
- Do NOT touch: CoreScreens, IncomeScreen, ExpensesScreen, ReportsScreen, SettingsScreen, the Payroll/Invoices/Settings regions of ModuleScreens.tsx, AppShell, AskAIWidget, Epic 1 primitives, globals.css, ui/ primitives.
- Before returning, RUN from ${REPO}: \`pnpm --filter @openbooks/web typecheck\`, \`pnpm --filter @openbooks/web lint\`, \`pnpm test\` (vitest), and if you changed convex/ run \`npx convex dev --once\` to push + confirm it deploys clean. Ensure typecheck + lint GREEN, no unit test regressed (baseline 151), convex deploys.`

const MANIFEST_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['filesChanged', 'whatChanged', 'detailClosedByDefault', 'softArchive', 'reconciliation', 'backendChanges', 'testidsPreserved', 'ledgerSafety', 'typecheck', 'lint', 'unitTests', 'risks'],
  properties: {
    filesChanged: { type: 'array', items: { type: 'string' } },
    whatChanged: { type: 'string' },
    detailClosedByDefault: { type: 'string', description: 'Confirm Bills + Contacts detail/profile opens only on row click (no auto-select / no permanent profile pane).' },
    softArchive: { type: 'string', description: 'Exactly how Contacts archive is SOFT (schema flag + mutation + Archived filter), never a hard delete, preserving contactId references.' },
    reconciliation: { type: 'string', description: 'How Bills/Contacts AR/AP figures reconcile with Income/Bills lenses (same invoice/bill set; AR not netted against AP).' },
    backendChanges: { type: 'array', items: { type: 'string' }, description: 'Each convex/ change: file:line + what + why + auth note. Include the convex deploy result.' },
    testidsPreserved: { type: 'string' },
    ledgerSafety: { type: 'string', description: 'No client posting; createBill/markPaid/matchCandidates reused; archive is non-ledger; money integer minor units; posted entries immutable.' },
    typecheck: { type: 'string', enum: ['green', 'failing'] },
    lint: { type: 'string', enum: ['green', 'failing'] },
    unitTests: { type: 'string' },
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
const build = await agent(
  `You are the single-owner BUILD agent for Epic 5 (Bills AP workbench + Contacts directory) of the OpenBooks redesign. Bills and Contacts share ONE file (ModuleScreens.tsx) — do Bills FIRST then Contacts, sequentially, and keep the Payroll/Invoices/Settings regions of that file untouched (Epic 6). Read the report sections and the current files before editing.\n\n${SKILLS}\n\n${DS}\n\n${FOUNDATION}\n\n${CONTRACTS}\n\n${BILLS_TASKS}\n\n${CONTACTS_TASKS}\n\n${RULES}\n\nReturn the manifest.`,
  { label: 'epic5:build', phase: 'Build', schema: MANIFEST_SCHEMA },
)
log(`Build: typecheck=${build?.typecheck} lint=${build?.lint} unit=${build?.unitTests}; files=${build?.filesChanged?.length}; backend=${(build?.backendChanges||[]).length}`)

phase('Critique')
const CTX = `Epic 5 build done. Files changed:\n${JSON.stringify(build?.filesChanged ?? [], null, 1)}\nBackend changes claimed:\n${JSON.stringify(build?.backendChanges ?? [], null, 1)}\nSpec: ${REPORT} Sections 6.6 (Bills), 6.7 (Contacts), Section 4 (IA), Section 8. Approved decision: Contacts soft-archive only (D1/11.0).\n${DS}`
const critiques = await parallel([
  () => agent(
    `${CTX}\n\nLENS: AP/IA/LEDGER + ARCHIVE SAFETY. Read ModuleScreens.tsx (Bills+Contacts), module-helpers.ts, and any convex changes (moduleViews.ts, schema.ts, contacts.ts, bills.ts). Verify: (1) Bills is an AP workbench — the bank-side payment row stays in Transactions (referenced/matched via /transactions?focus= + entryIds), NEVER duplicated; createBill/markPaid/matchCandidates reused unchanged; Mark-paid wrapped in an AlertDialog confirm; ledger-impact is read-only ("AI proposes, ledger posts"). (2) Contacts ARCHIVE is SOFT — schema field is additive optional, archive sets a flag + drops from default directory + restorable via "Archived" filter, NO hard-delete path anywhere, and contactId references on journal lines/bills/invoices are preserved (immutable ledger). (3) AR is NOT netted against AP into one misleading cell; AR/AP figures reconcile with the Income/Bills lenses (same invoice/bill set). (4) Any convex change re-checks workspace/entity auth and adds no ledger write/posting change; money integer minor units. (5) Bills + Contacts detail CLOSED by default (no permanent profile pane / no auto-select). Run \`pnpm --filter @openbooks/web typecheck\` + \`pnpm test\` yourself. Cite path:line + fix. Read-only except checks.`,
    { label: 'crit:ap-archive', phase: 'Critique', schema: CRITIQUE_SCHEMA }),
  () => agent(
    `${CTX}\n\nLENS: DESIGN-SYSTEM + TESTIDS. GREP both screens for raw hex/Tailwind color where a token exists (text-red-*, bg-*-50, magenta #a4148c avatars, inline #hex), purple/gradient/glass, emoji/unicode-as-icon (▲▼→✓), non-tabular money, expenses/ordinary amounts rendered alarm-red (must be neutral; only OVERDUE red, due-soon --warning), raw <select>/<input type=checkbox> (must be shadcn). Confirm role chips: customer=green, vendor=neutral; Stripe blurple only on a Stripe badge. THEN confirm preserved data-testids still exist on equivalent elements: Bills (m6-bills-screen, bills-add-bill, bills-open-total, bill-row, bill-vendor, bill-amount, bill-due, bill-create, bill-mark-paid, bill-detail-mark-paid, bill-match-picker, bill-match-candidate, bill-match-error, bill-schedule-expected, add-bill-modal) and the getByText("Selected bill") modules.spec assertion; Contacts (m6-contacts-screen, contact-row, contact-profile). List any dropped/renamed + whether "Selected bill" text still renders. Cite path:line + fix. Read-only.`,
    { label: 'crit:design-testids', phase: 'Critique', schema: CRITIQUE_SCHEMA }),
  () => agent(
    `${CTX}\n\nLENS: RESPONSIVE (report 8.2/8.3/8.4). Verify Bills + Contacts at 390/768/1306/1440/1758: the AP table and the contacts directory use OpenBooksDataTable (overflow-x-auto + min-w-0 + mobile card-stack — no squeezed desktop table, no competing overflow-hidden/fixed-width wrapper); the 6-tile Bills KpiStrip wraps (does not overflow at 390); the bill DetailSheet + contact DetailSheet are bottom Drawers on mobile + right Sheets desktop, closed by default; FilterBar facets/role-pills collapse below md; long vendor/contact names truncate (min-w-0). Flag any element causing horizontal overflow or text overlap with path:line + fix. Read-only.`,
    { label: 'crit:responsive', phase: 'Critique', schema: CRITIQUE_SCHEMA }),
])
const findings = critiques.filter(Boolean).flatMap((c) => (c.findings ?? []).map((f) => ({ ...f, lens: c.lens })))
const blockers = findings.filter((f) => f.severity === 'blocker' || f.severity === 'high')
log(`Critique: ${findings.length} findings (${blockers.length} blocker/high); verdicts ${critiques.filter(Boolean).map((c) => c.lens + '=' + c.verdict).join(', ')}`)

phase('Fix')
let fix = null
if (findings.length) {
  fix = await agent(
    `You are the FIX agent for Epic 5. Apply EVERY blocker/high finding and any clearly-correct medium/low one, editing ONLY the Epic 5 allowed files (ModuleScreens.tsx Bills+Contacts regions, module-helpers.ts, convex/moduleViews.ts read-only adds, convex/schema.ts contacts archived field, convex/contacts.ts archive/create mutations). Do NOT touch the Payroll/Invoices/Settings regions of ModuleScreens.tsx, other screens, AppShell/AskAIWidget, Epic 1 primitives, globals.css, ui/ primitives, or any ledger write/posting path. Keep every data-testid. Keep "AI proposes, ledger posts" and SOFT-archive-only.\n\n${DS}\n\nFINDINGS:\n${JSON.stringify(findings, null, 1)}\n\nThen RUN from ${REPO}: \`pnpm --filter @openbooks/web typecheck\`, \`pnpm --filter @openbooks/web lint\`, \`pnpm test\`, and if convex changed \`npx convex dev --once\`. Ensure typecheck + lint GREEN, no unit test regressed. Return the manifest.`,
    { label: 'epic5:fix', phase: 'Fix', schema: MANIFEST_SCHEMA },
  )
  log(`Fix: typecheck=${fix?.typecheck} lint=${fix?.lint} unit=${fix?.unitTests}`)
}

return { build, critiques: critiques.filter(Boolean), findings, fix }
