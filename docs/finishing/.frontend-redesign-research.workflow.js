export const meta = {
  name: 'openbooks-frontend-redesign-research',
  description: 'Audit OpenBooks frontend (prototype vs current), design UX strategy + component system + implementation plan. Research only, no product edits.',
  whenToUse: 'Planning-stage redesign research for the OpenBooks finishing branch',
  phases: [
    { title: 'Foundation', detail: 'product/IA brief, design-system brief, frontend architecture inventory' },
    { title: 'Audit', detail: 'per-surface prototype-vs-current audit (12 surfaces)' },
    { title: 'Verify', detail: 'adversarially re-check each surface audit against real code' },
    { title: 'Synthesize', detail: 'IA decision, component system, Ask AI, responsive rules, implementation plan' },
  ],
}

// ---------------------------------------------------------------------------
// Shared context strings injected into agent prompts
// ---------------------------------------------------------------------------
const REPO = '/Volumes/SSD/OpenBooks'

const NORTH_STAR = `
OpenBooks = free, open-source, AI-assisted bookkeeping for small businesses.
Owner experience is plain English; the hidden system of record is a double-entry ledger.
Core rule: AI proposes, the ledger engine posts. Confident items post via one ledger
mutation; uncertain items go to the Inbox; Reports query journal lines, not ad-hoc totals.
CRITICAL IA PRINCIPLE: do not duplicate financial truth across tabs. Transactions is the
universal register. Income is a revenue lens over the same records (+invoices, receivables,
customers, streams, recurring, collections). Expenses is a cost lens over the same records
(+categories, vendors, recurring, bills evidence, spend analytics). Bills = accounts-payable
workflow. Reports query posted journal lines and must agree with the workbench screens. A
record is never "moved" between tabs; it is one record with richer views.`

const DESIGN_CONSTRAINTS = `
OpenBooks design system (HARD constraints — flag any violation as a finding with file:line):
- White ledger-like surfaces; Geist fonts; lucide icons; ONE brand green #2ca01c.
- Quiet AI affordances; hairline borders; dense-but-readable tables; tabular figures for money.
- Letter-spacing 0. Money-in can be green; ordinary expenses NEUTRAL not alarm red.
- BANNED: gradients, purple AI styling, decorative blobs, emoji, glassmorphism, marketing
  dashboard ornament. Mobile must be a real responsive surface, not a squeezed desktop table.
- Build on shadcn/ui primitives before raw controls. Use AI Elements primitives for Ask AI.`

const RULES = `
You are in RESEARCH/PLANNING mode. Do NOT edit, create, or delete any product files.
Do NOT run a browser or dev server. Do NOT use git write commands. Work ONLY from reading
source files, prototype HTML, and docs with Read/Grep/Bash(read-only). Cite concrete evidence
as path:line or short code excerpts. Be specific and falsifiable, never vague. Your returned
value IS data for a report — return exactly the requested structure, no preamble.`

// Compact factual hints from the orchestrator's own scouting (agents should still verify):
const SCOUT_FACTS = `
Orchestrator scouting facts (verify, don't trust blindly):
- shadcn ui present in apps/web/src/components/ui/: alert-dialog, badge, button, card, command,
  dialog, dropdown-menu, input, label, select, separator, sheet, skeleton, switch, table, tabs,
  textarea, tooltip. MISSING (needed by proposed system): drawer, calendar, popover, checkbox,
  scroll-area, toggle-group, field/field-group, input-group.
- No AI SDK / AI Elements packages found in apps/web/package.json (no "ai", "@ai-sdk/*",
  "ai-elements", "streamdown"). Ask AI is custom: components/openbooks/OpenBooksAIChat.tsx (918 lines).
- Surface code is spread across multi-screen files: CoreScreens.tsx (1235), ModuleScreens.tsx
  (1921), IncomeScreen.tsx (675), ExpensesScreen.tsx (229), ReportsScreen.tsx (1307),
  SettingsScreen.tsx (229) + settings/*, AppShell.tsx (1040), OpenBooksAIChat.tsx (918),
  AskAIScreen.tsx (59), CommandPalette.tsx (197), primitives.tsx (339).
- App routes via apps/web/src/app/[section]/page.tsx + settings/[section]/page.tsx.`

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const FOUNDATION_PRODUCT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['principles', 'iaModel', 'incomeExpensesLens', 'dataModelNotes', 'keyConstraints', 'reportsContract'],
  properties: {
    principles: { type: 'string', description: 'Condensed product principles relevant to frontend IA (<= 180 words)' },
    iaModel: { type: 'string', description: 'How the v1 loop + surfaces map together (<= 150 words)' },
    incomeExpensesLens: { type: 'string', description: 'Evidence from specs that Income/Expenses are lenses over Transactions, not duplicate stores (<= 150 words)' },
    dataModelNotes: { type: 'string', description: 'What the backend actually exposes (records, journal lines, inbox items, bills, contacts) per docs/code (<= 150 words)' },
    keyConstraints: { type: 'array', items: { type: 'string' }, description: 'Hard money/ledger/auth constraints that affect UI' },
    reportsContract: { type: 'string', description: 'How reports relate to journal lines + drilldowns (<= 100 words)' },
  },
}

const FOUNDATION_DESIGN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['tokens', 'rules', 'violations'],
  properties: {
    tokens: { type: 'string', description: 'Condensed canonical tokens: brand green, neutrals, fonts, spacing scale, radii, money/figure rules (<= 200 words)' },
    rules: { type: 'array', items: { type: 'string' }, description: 'Enforceable do/dont design rules' },
    violations: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['file', 'evidence', 'issue'],
      properties: { file: { type: 'string' }, evidence: { type: 'string', description: 'line ref or code excerpt' }, issue: { type: 'string' } },
    }, description: 'Concrete current-code violations (purple, gradient, emoji, non-tabular money, alarm-red expense, etc.)' },
  },
}

const FOUNDATION_ARCH_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['surfaceFileMap', 'uiPrimitivesPresent', 'uiPrimitivesMissing', 'aiElements', 'aiChatWiring', 'convexHooks', 'existingSharedPrimitives', 'shellModel', 'notes'],
  properties: {
    surfaceFileMap: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['surface', 'files'],
      properties: { surface: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, componentName: { type: 'string' } },
    }, description: 'Which component/file renders each surface (Dashboard, Inbox, Transactions, Income, Expenses, Bills, Contacts, Payroll, Reports, Settings, AskAI, Shell)' },
    uiPrimitivesPresent: { type: 'array', items: { type: 'string' } },
    uiPrimitivesMissing: { type: 'array', items: { type: 'string' }, description: 'Primitives the proposed component system needs but are absent' },
    aiElements: { type: 'string', description: 'Whether AI Elements / AI SDK exist, and how Ask AI currently streams (<= 120 words)' },
    aiChatWiring: { type: 'string', description: 'How OpenBooksAIChat connects to Convex agent/streaming, and provider/debug labels exposed (cite file:line) (<= 150 words)' },
    convexHooks: { type: 'string', description: 'Key Convex query/mutation/action hooks the surfaces use (<= 100 words)' },
    existingSharedPrimitives: { type: 'string', description: 'What primitives.tsx / CommandPalette.tsx / shared helpers already provide (<= 120 words)' },
    shellModel: { type: 'string', description: 'How AppShell handles nav, header, docked AI panel, sticky/scroll, responsive (cite file:line) (<= 180 words)' },
    notes: { type: 'string' },
  },
}

const AUDIT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['surface', 'currentFiles', 'currentState', 'prototypeState', 'gaps', 'feedbackVerification', 'designViolations', 'responsiveIssues', 'redesignDirection', 'componentsNeeded', 'workflowsThatLiveHere'],
  properties: {
    surface: { type: 'string' },
    currentFiles: { type: 'array', items: { type: 'string' }, description: 'Actual files (path) that render this surface, confirmed by grep' },
    currentState: { type: 'string', description: 'Precise description of what the current implementation does/looks like, with file:line evidence (<= 250 words)' },
    prototypeState: { type: 'string', description: 'What the prototype .dc.html establishes for this surface: hierarchy, sections, table behavior (<= 200 words)' },
    gaps: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['dimension', 'prototypeOrTarget', 'current', 'severity'],
      properties: {
        dimension: { type: 'string', description: 'e.g. hierarchy, filters, table columns, detail panel, responsive, export, copy/text, AI affordance' },
        prototypeOrTarget: { type: 'string' }, current: { type: 'string' },
        severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
      },
    } },
    feedbackVerification: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['claim', 'status', 'evidence'],
      properties: {
        claim: { type: 'string', description: "Ansar's specific feedback claim for this surface" },
        status: { type: 'string', enum: ['confirmed', 'refuted', 'partial', 'not-found'] },
        evidence: { type: 'string', description: 'path:line or code excerpt proving the status' },
      },
    } },
    designViolations: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['issue', 'evidence'],
      properties: { issue: { type: 'string' }, evidence: { type: 'string' } },
    } },
    responsiveIssues: { type: 'array', items: { type: 'string' }, description: 'Concrete overflow/squeeze/sticky issues with the widths/elements involved' },
    redesignDirection: { type: 'string', description: 'Product-grade redesign direction for this surface: layout, KPI strip, tabs/views, filters, table columns, detail behavior, primary actions, copy to remove. Better-than-prototype but design-system aligned (<= 350 words)' },
    componentsNeeded: { type: 'array', items: { type: 'string' }, description: 'Shared components this surface consumes (WorkbenchPage, KpiStrip, OpenBooksDataTable, FilterBar, DateRangeControl, AccountMultiSelect, DetailSheet, ExportMenu, EvidenceUpload, AiInsightBadge, AttentionState, AskAIWidget, CommandPalette)' },
    workflowsThatLiveHere: { type: 'array', items: { type: 'string' }, description: 'Which user workflows belong on THIS surface vs elsewhere (IA boundary)' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['surface', 'verdicts', 'missedFindings', 'overallReliability'],
  properties: {
    surface: { type: 'string' },
    verdicts: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['claim', 'auditStatus', 'verifiedReal', 'note'],
      properties: {
        claim: { type: 'string' },
        auditStatus: { type: 'string' },
        verifiedReal: { type: 'boolean', description: 'true if the claim/finding holds up against the actual code; false if the audit overstated or hallucinated it' },
        note: { type: 'string', description: 'corrected evidence path:line or why it was refuted' },
      },
    } },
    missedFindings: { type: 'array', items: { type: 'string' }, description: 'Real issues the audit MISSED (completeness critic), with evidence' },
    overallReliability: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
}

const SECTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['markdown'],
  properties: { markdown: { type: 'string', description: 'Polished markdown for this report section (no top-level H1; start at H2/H3). Specific, founder-readable, design-system-aligned, references real files.' } },
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------
const SURFACES = [
  { key: 'Dashboard', proto: 'OpenBook - Prototype/Dashboard.dc.html', hint: 'CoreScreens.tsx (grep Dashboard), ModuleScreens.tsx',
    focus: 'Current Dashboard does not match prototype hierarchy: shows workspace label, "Dashboard", "Business at a glance", "Demo entity", an "Operating snapshot" card + generic metric cards (a status collage). Prototype is operator command center: cash hero, connected accounts, P&L snapshot, spend categories, inbox, receivables/payables, payroll, income by customer, cash flow, coming up, health/cushion. Cards should be actionable (click into workbench with same filter). Remove workspace/demo labels from body. Date range control needed.' },
  { key: 'Inbox', proto: 'OpenBook - Prototype/Inbox.dc.html', hint: 'CoreScreens.tsx or ModuleScreens.tsx (grep Inbox)',
    focus: 'Inbox review detail card can OVERFLOW/overlap text, especially receipt-match details. Two-column review layout not robust. Should be a focused exception-resolution queue grouped by work type (categorize, receipt match, transfer match, question, bill evidence, duplicate, low confidence). Show why item needs attention; confidence score, AI reason, evidence, candidate transaction, ledger impact must be readable without overlap. Need batch review, keyboard shortcuts, mobile drawer.' },
  { key: 'Transactions', proto: 'OpenBook - Prototype/Transactions.dc.html', hint: 'CoreScreens.tsx or ModuleScreens.tsx (grep Transaction)',
    focus: 'Detail panel is enabled BY DEFAULT by selecting the first row -> table feels squeezed. Filters incomplete (no multi-account select, date range, amount direction, type, category, contact, source, receipt, AI status, confidence, needs-attention). Columns incomplete (description, merchant, account, category, contact, amount, status, AI insight, confidence, receipt/evidence, ledger/reconciliation state). No clear add-receipt+ask-AI-to-categorize+review-before-post flow. Export weak. Want full-width register by default; right Sheet/Drawer only on selection; bulk actions; export menu (CSV/filtered/selected/audit).' },
  { key: 'Income', proto: 'OpenBook - Prototype/Income.dc.html', hint: 'IncomeScreen.tsx',
    focus: 'Income inconsistent with Transactions/Expenses/Bills/Contacts/Payroll. Should be a revenue LENS over the same records + invoices, receivables, customers, streams, recurring, collections. Want KPI strip (received this period, open/overdue receivables, avg days to pay, recurring revenue); tabs (Payments, Invoices, Customers, Streams, Receivables); shared filters; tables drill into same records as Transactions/Reports; charts (by stream, by customer, recurring vs one-time, aging). Decide Income<->Transactions relationship explicitly.' },
  { key: 'Expenses', proto: 'OpenBook - Prototype/Expenses.dc.html', hint: 'ExpensesScreen.tsx',
    focus: 'Category/recurring focused, lacks a full tabular expense view; date filtering too limited; should match Income/Transactions. Implementation reportedly includes at least one PURPLE accent in expense category dot data (design-system violation) — FIND IT with file:line. Want KPI strip (spent this period, recurring spend, uncategorized count, missing-evidence count, top vendor/category); tabs (Transactions, Categories, Vendors, Recurring, Evidence Needed); shared filters; full expense table; charts (by category, by vendor, recurring trend, unusual spend). Expenses neutral not alarm red.' },
  { key: 'Bills', proto: 'OpenBook - Prototype/Bills.dc.html', hint: 'ModuleScreens.tsx (grep Bill)',
    focus: 'Unnecessary explanatory text on page. Open/due-this-week/overdue/paid groupings not arranged into a clear AP workflow. Upload-evidence + bill tracking visually scattered. No table-first workbench with filters/search/sort/export/row-detail. Reframe as Accounts Payable workbench: actions (Add bill, Upload bill); KPI strip (open total, overdue, due soon, paid this period, missing evidence, avg days to pay); columns (vendor, bill #, due date, amount, status, category, evidence, payment match, source, AI confidence); filters; row drawer (evidence, extracted fields, payment schedule, matched txn, ledger impact, approval/posting history).' },
  { key: 'Contacts', proto: 'OpenBook - Prototype/Contacts.dc.html', hint: 'ModuleScreens.tsx (grep Contact)',
    focus: 'Unnecessary explanatory text. Contact profile pane shown BY DEFAULT -> directory cramped. Should be full-width directory first; profile Sheet/Drawer only on selection. Filters (customers, vendors, employees, contractors, open AR, open AP, recurring, recently active); columns (name, type, aliases, open AR/AP, this-year volume, last activity, default category/rule); detail (receivables, payables, txn history, aliases, rules, notes, merge duplicates, archive). Decide: deletion vs soft-archive.' },
  { key: 'Payroll', proto: 'OpenBook - Prototype/Payroll.dc.html', hint: 'ModuleScreens.tsx (grep Payroll)',
    focus: 'Does not communicate whether runs are auto-generated, manual, or imported. Statement selection too static. Controls/tables inconsistent with rest of product. Define workflow: import payroll register -> review employees/contractors -> generate/confirm pay run -> post ledger entries -> view statements by period. KPI strip (payroll this period, next run, taxes/withholding, contractors vs employees, unmatched items); tabs (Runs, People, Statements, Contractors, Rules); period selector (month/quarter/custom/statement period); shared table pattern. Clarify whether auto run-creation exists now or is future.' },
  { key: 'Reports', proto: 'OpenBook - Prototype/Reports.dc.html', hint: 'ReportsScreen.tsx',
    focus: 'Reports dense; docked Ask AI panel currently causes layout breakage. Reports must stay ledger-backed and agree with workbench screens. Need stable period selection; clicking a report line drills into filtered Transactions/Income/Expenses; Ask AI must not squeeze reports into unreadable layouts.' },
  { key: 'Settings', proto: 'OpenBook - Prototype/Settings.dc.html', hint: 'SettingsScreen.tsx + components/openbooks/settings/*',
    focus: 'Useful connection/AI surfaces but lacks layout polish. Settings nav should stay FIXED while content scrolls (currently not sticky). Connections (Plaid, Stripe, imports, AI config) should be simpler/action-oriented. Some detail tables OVERFLOW horizontally. Sectioned content: Workspace, Connections, Imports, AI, Rules, Team, Billing, Data/export. AI settings should be understandable, not provider-debug heavy. Tables must not overflow their cards.' },
  { key: 'AskAI', proto: 'OpenBook - Prototype/OpenBooks.dc.html', hint: 'OpenBooksAIChat.tsx (918 lines), AskAIScreen.tsx, app/ask-ai/page.tsx, AppShell.tsx docked panel',
    focus: 'Custom UI, NOT AI Elements. Exposes provider/debug labels like "Bedrock active" to users (FIND file:line). Panel fixed + narrow -> header/content overflow; in reports/dense pages chat breaks layout. Thread selection + new chat not modern. Want AI Elements (Conversation, Message, PromptInput, Suggestion, Sources, Tool, optional Reasoning/Actions/Attachments). Remove provider/debug labels. Compact icon access from shell; collapse / docked side panel / expanded workspace / mobile drawer modes. Preserve streaming. Context-aware by page+filter state. Responsive at mobile/tablet/desktop. Confirm how it connects to the existing Convex agent + streaming hooks.' },
  { key: 'Shell', proto: 'OpenBook - Prototype/OpenBooks.dc.html', hint: 'AppShell.tsx (1040 lines), CommandPalette.tsx, app/[section]/page.tsx',
    focus: 'Header clutter: global search, month chip, Ask AI button, demo/workspace markers. User does not want repeated workspace/page intro noise. Some areas need fixed/sticky; others scroll independently. Settings sidebar not fixed while content scrolls. Docked AI side panel compresses content and overflows. Want stable left nav; settings moved to quieter footer/utility area; replace global header search with page-local search + command palette; Ask AI as icon/assistant control not permanent header pill; remove visible demo/entity labels from body (subtle env indicator only if needed); define sticky vs scroll panels; mobile true drawers + bottom/compact nav.' },
]

// ---------------------------------------------------------------------------
// Phase 1 — Foundation (barrier; downstream audits need this context)
// ---------------------------------------------------------------------------
phase('Foundation')

const [product, design, arch] = await parallel([
  () => agent(
    `${RULES}\n\nTASK: Build a CONDENSED product + information-architecture brief for the OpenBooks frontend redesign.\nRead in ${REPO}: docs/finishing/implementation-plan.md, docs/finishing/completion-report.md, docs/finishing/whats-left.md, docs/product/01-vision-and-scope.md, docs/product/02-product-spec.md, docs/product/03-design-brief.md, docs/product/04-build-plan.md. Skim convex/ schema + key functions to confirm what data the frontend can actually bind (records/transactions, journal lines, inbox items, bills, contacts, payroll, invoices).\n${NORTH_STAR}\nReturn the structured brief. Keep every field tight and evidence-based.`,
    { label: 'foundation:product', phase: 'Foundation', schema: FOUNDATION_PRODUCT_SCHEMA }),
  () => agent(
    `${RULES}\n\nTASK: Build a CONDENSED design-system brief AND scan current code for violations.\nRead in ${REPO}: "OpenBooks Design System/readme.md", "OpenBooks Design System/SKILL.md", and the token/guideline files under "OpenBooks Design System/tokens/" and "OpenBooks Design System/guidelines/". Then grep apps/web/src for design-system VIOLATIONS: purple/violet/indigo colors, gradients (bg-gradient, linear-gradient), emoji in JSX, glassmorphism (backdrop-blur), alarm-red used for ordinary expenses, non-tabular money, letter-spacing != 0, off-brand greens. Pay special attention to ExpensesScreen.tsx (a purple category dot is suspected).\n${DESIGN_CONSTRAINTS}\nReturn the structured brief with concrete violations (file + line/excerpt).`,
    { label: 'foundation:design', phase: 'Foundation', schema: FOUNDATION_DESIGN_SCHEMA }),
  () => agent(
    `${RULES}\n\nTASK: Inventory the current frontend ARCHITECTURE so we can plan a shared component system.\n${SCOUT_FACTS}\nIn ${REPO}: read apps/web/src/components/openbooks/AppShell.tsx, OpenBooksAIChat.tsx, primitives.tsx, CommandPalette.tsx, AskAIScreen.tsx; list apps/web/src/components/ui/; grep CoreScreens.tsx + ModuleScreens.tsx + IncomeScreen.tsx + ExpensesScreen.tsx + ReportsScreen.tsx + SettingsScreen.tsx to map each SURFACE (Dashboard, Inbox, Transactions, Income, Expenses, Bills, Contacts, Payroll, Reports, Settings, AskAI, Shell) to its rendering component/file. Inspect apps/web/package.json for AI SDK / AI Elements. Determine how Ask AI streams and whether provider/debug labels ("Bedrock active") are user-facing (cite file:line). Note Convex hooks the surfaces use, what primitives.tsx already provides, and how AppShell handles nav/header/docked-AI/sticky/responsive.\nReturn the structured inventory.`,
    { label: 'foundation:arch', phase: 'Foundation', schema: FOUNDATION_ARCH_SCHEMA }),
])

const FOUNDATION_CTX = `
=== PRODUCT/IA BRIEF ===
${JSON.stringify(product, null, 1)}
=== DESIGN BRIEF ===
${JSON.stringify(design, null, 1)}
=== ARCHITECTURE INVENTORY ===
${JSON.stringify(arch, null, 1)}`

log(`Foundation complete. Surface->file map: ${(arch?.surfaceFileMap || []).map(s => s.surface).join(', ')}. UI primitives missing: ${(arch?.uiPrimitivesMissing || []).join(', ')}.`)

// ---------------------------------------------------------------------------
// Phase 2+3 — Audit each surface, then adversarially Verify (pipelined)
// ---------------------------------------------------------------------------
const auditsVerified = await pipeline(
  SURFACES,
  // Stage 1: audit
  (s) => agent(
    `${RULES}\n${NORTH_STAR}\n${DESIGN_CONSTRAINTS}\n\nSURFACE TO AUDIT: ${s.key}\nPrototype reference: "${REPO}/${s.proto}"\nCurrent code hint (verify by grep): ${s.hint}\n\nANSAR'S FEEDBACK FOR THIS SURFACE (validate each claim against real code, mark confirmed/refuted/partial/not-found with path:line evidence):\n${s.focus}\n\nFOUNDATION CONTEXT (from sibling agents — use, but verify file refs):\n${FOUNDATION_CTX}\n\nDO: (1) grep to find the exact current file(s) for ${s.key}; (2) read them + the prototype HTML; (3) compare hierarchy, sections, table behavior, filters, detail-panel default state, copy/text, AI affordances, responsive behavior; (4) verify EACH feedback claim with evidence; (5) catalog design-system violations with file:line; (6) catalog concrete responsive/overflow/sticky issues; (7) propose a product-grade redesign direction (better than prototype, design-system aligned, table-first where data-heavy, row-detail CLOSED by default opening only on selection); (8) list which shared components this surface needs and which user workflows belong HERE vs elsewhere (respect the IA principle: Transactions is the universal register; Income/Expenses are lenses).\nReturn the AUDIT structure. Be concrete; every claim needs evidence.`,
    { label: `audit:${s.key}`, phase: 'Audit', schema: AUDIT_SCHEMA }),
  // Stage 2: adversarial verify
  (audit, s) => agent(
    `${RULES}\n\nYou are an ADVERSARIAL VERIFIER. A prior agent audited the OpenBooks "${s.key}" surface. Re-check its factual claims against the ACTUAL code — default to skepticism. For each feedbackVerification entry and each designViolation, open the cited file/line and confirm whether it truly holds. Mark verifiedReal=false if the audit overstated, mis-cited, or hallucinated. Also act as a COMPLETENESS CRITIC: name real issues the audit MISSED (with evidence).\nPrototype: "${REPO}/${s.proto}". Current code hint: ${s.hint}.\n\nAUDIT TO VERIFY (JSON):\n${JSON.stringify({ surface: audit?.surface, currentFiles: audit?.currentFiles, feedbackVerification: audit?.feedbackVerification, designViolations: audit?.designViolations, responsiveIssues: audit?.responsiveIssues, gaps: audit?.gaps }, null, 1)}\n\nReturn the VERDICT structure.`,
    { label: `verify:${s.key}`, phase: 'Verify', schema: VERDICT_SCHEMA })
    .then(verdict => ({ ...audit, verdict }))
)

const audits = auditsVerified.filter(Boolean)

// Build compact, reliability-weighted audit digest for synthesis + report.
const auditDigest = audits.map(a => ({
  surface: a.surface,
  currentFiles: a.currentFiles,
  currentState: a.currentState,
  prototypeState: a.prototypeState,
  gaps: a.gaps,
  // keep only feedback the verifier confirmed as real
  confirmedFeedback: (a.feedbackVerification || []).map(f => {
    const v = (a.verdict?.verdicts || []).find(x => x.claim === f.claim)
    return { ...f, verifiedReal: v ? v.verifiedReal : null, verifierNote: v?.note || '' }
  }),
  designViolations: a.designViolations,
  responsiveIssues: a.responsiveIssues,
  redesignDirection: a.redesignDirection,
  componentsNeeded: a.componentsNeeded,
  workflowsThatLiveHere: a.workflowsThatLiveHere,
  missedFindings: a.verdict?.missedFindings || [],
  reliability: a.verdict?.overallReliability || 'unknown',
}))

log(`Audited+verified ${audits.length}/${SURFACES.length} surfaces. Reliability: ${auditDigest.map(a => a.surface + '=' + a.reliability).join(', ')}.`)

const AUDIT_DIGEST_JSON = JSON.stringify(auditDigest, null, 1)

// ---------------------------------------------------------------------------
// Phase 4 — Synthesis (parallel; each produces a polished report section)
// ---------------------------------------------------------------------------
phase('Synthesize')

const [iaDecision, componentSystem, askAi, responsiveRules, implPlan, execGap] = await parallel([
  // Section 4 — IA decision
  () => agent(
    `${RULES}\n${NORTH_STAR}\n\nWrite report SECTION 4: "Product Information Architecture Decision". Make the decision EXPLICIT and defend it: Transactions is the universal register and source workbench; Income and Expenses are analytical/workflow LENSES over the same records (not duplicate stores where records get "moved"); Bills is AP workflow; Reports query journal lines and must agree. Use the business examples (Stripe deposit -> Income lens; AWS charge -> Expenses lens). Specify, per surface, WHICH user workflows live there vs elsewhere, and how a single record is created/categorized/evidenced/posted once and reflected everywhere. Cite the product/IA brief.\nPRODUCT/IA BRIEF:\n${JSON.stringify(product, null, 1)}\nPER-SURFACE workflowsThatLiveHere from audits:\n${JSON.stringify(auditDigest.map(a => ({ surface: a.surface, workflows: a.workflowsThatLiveHere })), null, 1)}\nReturn polished markdown (start at H2).`,
    { label: 'synth:ia', phase: 'Synthesize', schema: SECTION_SCHEMA }),
  // Section 5 — Shared component system
  () => agent(
    `${RULES}\n${DESIGN_CONSTRAINTS}\n\nWrite report SECTION 5: "Shared Component System Proposal". For EACH component — WorkbenchPage, PageActionBar, DateRangeControl, FilterBar, AccountMultiSelect, KpiStrip, OpenBooksDataTable, DetailSheet/RecordDrawer, AiInsightBadge, EvidenceUpload, ExportMenu, AttentionState, CommandPalette, AskAIWidget — specify: purpose, the shadcn/ui primitives it composes (note which primitives are MISSING and must be added: ${(arch?.uiPrimitivesMissing || []).join(', ')}), key props/variants, responsive behavior, and the target file path under apps/web/src/components/openbooks/ (reuse existing primitives.tsx/CommandPalette.tsx where possible). Map which surfaces consume each component (use the audit componentsNeeded). Emphasize: row detail CLOSED by default, tables consistent across data-heavy pages, AttentionState shared vocabulary (needs review, missing evidence, overdue, unmatched, unposted, low confidence).\nARCH INVENTORY:\n${JSON.stringify(arch, null, 1)}\nDESIGN BRIEF:\n${JSON.stringify(design, null, 1)}\nAUDIT componentsNeeded by surface:\n${JSON.stringify(auditDigest.map(a => ({ surface: a.surface, components: a.componentsNeeded })), null, 1)}\nReturn polished markdown (start at H2).`,
    { label: 'synth:components', phase: 'Synthesize', schema: SECTION_SCHEMA }),
  // Section 7 — Ask AI w/ AI Elements
  () => agent(
    `${RULES}\n${DESIGN_CONSTRAINTS}\n\nWrite report SECTION 7: "Ask AI Redesign Proposal Using AI Elements". The current Ask AI is custom (apps/web/src/components/openbooks/OpenBooksAIChat.tsx, 918 lines), exposes provider/debug labels (e.g. "Bedrock active"), is a fixed narrow panel that overflows on dense pages, and AI Elements/AI SDK are NOT installed yet. Propose: install path (Vercel AI SDK + AI Elements registry via shadcn), exact AI Elements primitives to use (Conversation, Message, PromptInput, Suggestion, Sources, Tool, optional Reasoning/Actions/Attachments) and what each replaces in the current code; the AskAIWidget modes (compact icon trigger from shell, docked side panel, expanded workspace, mobile drawer); how to preserve the existing Convex agent streaming (map current streaming hooks to AI Elements' message model WITHOUT breaking the backend contract); removal of provider/debug labels; page+filter context-awareness; responsive rules so Reports/dense pages never break. Be concrete about files to add/change.\nASK AI AUDIT:\n${JSON.stringify(auditDigest.find(a => a.surface === 'AskAI') || {}, null, 1)}\nARCH (aiElements/aiChatWiring):\n${JSON.stringify({ aiElements: arch?.aiElements, aiChatWiring: arch?.aiChatWiring, convexHooks: arch?.convexHooks }, null, 1)}\nReturn polished markdown (start at H2).`,
    { label: 'synth:askai', phase: 'Synthesize', schema: SECTION_SCHEMA }),
  // Section 8 + 10 — Responsive rules + acceptance gates
  () => agent(
    `${RULES}\n${DESIGN_CONSTRAINTS}\n\nWrite report SECTIONS 8 AND 10 as one markdown block.\nSECTION 8 "Responsive And Layout Rules": define breakpoint behavior at 390 / 768 / 1306 / 1440 / 1758 px for: app shell (left nav, header, docked AI), data tables (column priority/hide order, horizontal scroll vs card-stack on mobile), detail Sheet/Drawer (side sheet on desktop, bottom drawer on mobile), KPI strips (wrap/scroll), Settings (sticky nav + scrolling content), and Ask AI (collapse/dock/expand/drawer). Specify which panels are sticky vs independently scrolling. Give concrete Tailwind-level guidance (container widths, min-w-0 to fix flex overflow, overflow-x-auto wrappers, sticky positioning) without writing full components.\nSECTION 10 "Acceptance Gates And Evidence Checklist": turn the prototype prompt's acceptance gates into a checklist (no horizontal overflow at the 5 widths; no text overlap in Inbox receipt match / Ask AI / Settings tables / Reports / txn details; Transactions + Contacts full-width with detail closed by default; consistent table/filter/export/detail language across Bills/Income/Expenses/Contacts/Payroll/Transactions; consistent date ranges; local search; export where tabular; Ask AI collapse/open/expand/mobile + no provider labels; Dashboard matches/improves prototype; Settings sticky nav; desktop+mobile screenshots; tests green). For each gate list the evidence artifact required (screenshot at width X, test name, lint/typecheck pass) and verification command (pnpm lint, pnpm typecheck, pnpm test, Playwright under apps/web/tests/).\nResponsive issues found across audits:\n${JSON.stringify(auditDigest.map(a => ({ surface: a.surface, responsive: a.responsiveIssues })), null, 1)}\nReturn polished markdown (start at H2, two sections).`,
    { label: 'synth:responsive+gates', phase: 'Synthesize', schema: SECTION_SCHEMA }),
  // Section 9 — Implementation workflow plan
  () => agent(
    `${RULES}\n\nWrite report SECTION 9: "Implementation Workflow Plan For Claude Code". Define EPICS 0-7 (Epic0 audit baseline + visual evidence; Epic1 shared layout/table/filter/detail primitives; Epic2 shell/header/nav + Ask AI responsive system; Epic3 Transactions + Inbox workbenches; Epic4 Income + Expenses workbenches; Epic5 Bills/AP + Contacts directory; Epic6 Payroll + Reports + Settings polish; Epic7 responsive QA + screenshots + e2e/lint/typecheck/test evidence). For EACH epic specify: goal; files likely involved (use the real file paths from the audits); subagent scope; allowed edits in future implementation; validation expected; risks; done-when criteria. Then add a "Workflow Shape" subsection: how many agents, what each does, execution ORDER, what runs in PARALLEL vs SEQUENTIAL (Epic1 primitives must land before page epics; Epic3-6 page work can parallelize once primitives exist; Epic7 is final), concurrency cap guidance, and which acceptance evidence must be captured before moving to the next epic. Note that workflows cannot pause for input, so each implementation epic should be its own approved workflow run with evidence returned.\nREAL FILE PATHS per surface:\n${JSON.stringify(auditDigest.map(a => ({ surface: a.surface, files: a.currentFiles })), null, 1)}\nCOMPONENTS NEEDED:\n${JSON.stringify(auditDigest.map(a => ({ surface: a.surface, components: a.componentsNeeded })), null, 1)}\nReturn polished markdown (start at H2).`,
    { label: 'synth:implplan', phase: 'Synthesize', schema: SECTION_SCHEMA }),
  // Section 11 — Risks + open questions + decisions needed
  () => agent(
    `${RULES}\n${NORTH_STAR}\n\nWrite report SECTION 11: "Risks, Open Questions, And Decisions Needed From Ansar". Synthesize from the audits the genuine decisions a founder must make before implementation, e.g.: Contacts deletion vs soft-archive; whether Payroll auto-run creation exists now or is future; how much backend/data is real vs mocked per surface (flag surfaces where the redesign assumes data the backend may not expose yet); installing AI SDK + AI Elements (new dependency) and any bundle/licensing considerations; adding missing shadcn primitives; saved-views/command-palette scope; export formats (CSV vs audit trail) availability; whether to keep a subtle demo/entity indicator; risk of regressions to existing green tests; scope/time for 12-surface redesign. Separate into RISKS, OPEN QUESTIONS, and DECISIONS-NEEDED (each decision phrased as a crisp either/or with a recommended default).\nMISSED FINDINGS + reliability from verifiers:\n${JSON.stringify(auditDigest.map(a => ({ surface: a.surface, reliability: a.reliability, missed: a.missedFindings })), null, 1)}\nDATA MODEL NOTES:\n${JSON.stringify({ dataModelNotes: product?.dataModelNotes, reportsContract: product?.reportsContract }, null, 1)}\nReturn polished markdown (start at H2).`,
    { label: 'synth:risks', phase: 'Synthesize', schema: SECTION_SCHEMA }),
])

// Return everything; the orchestrator assembles the final 11-section report.
return {
  product,
  design,
  arch,
  auditDigest,
  sections: {
    ia: iaDecision?.markdown || '',
    components: componentSystem?.markdown || '',
    askAi: askAi?.markdown || '',
    responsiveAndGates: responsiveRules?.markdown || '',
    implPlan: implPlan?.markdown || '',
    risks: execGap?.markdown || '',
  },
}
