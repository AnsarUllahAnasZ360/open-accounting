export const meta = {
  name: 'openbooks-epic0-defect-map',
  description: 'Epic 0: verify the redesign report’s cited code anchors are still accurate and produce a defect-to-epic map across all 12 surfaces. Read-only, no product edits.',
  phases: [
    { title: 'Audit', detail: 'one agent per surface-cluster verifies report anchors against current code' },
  ],
}

const REPO = '/Volumes/SSD/OpenBooks'
const REPORT = 'docs/finishing/frontend-redesign-research-report.md'

const RULES = `You are in READ-ONLY audit mode (Epic 0 of the OpenBooks frontend redesign). Do NOT edit, create, or delete any file. Use Read/Grep/Bash(read-only) only. Cite every claim as path:line. Be falsifiable, never vague. Your returned value IS data for a defect map — return exactly the requested structure, no preamble.`

const NORTH_STAR = `OpenBooks = AI-assisted double-entry bookkeeping. AI proposes, the ledger engine posts. IA: Transactions is the universal register; Income/Expenses are LENSES over the same transactions + journalLines (never a place a record is moved to); Bills = AP workflow; Reports query journal lines and must reconcile. Row detail must be CLOSED by default. Design system: white surfaces, Geist, lucide, ONE brand green #2ca01c, quiet GREEN AI affordances, hairline borders, tabular/mono money; expenses neutral (not alarm red); BANNED: gradients, purple AI, emoji, glassmorphism, decorative ornament, unicode-as-icon.`

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['cluster', 'surfaces', 'anchors', 'defects', 'tokenViolations', 'notes'],
  properties: {
    cluster: { type: 'string' },
    surfaces: { type: 'array', items: { type: 'string' } },
    anchors: {
      type: 'array',
      description: 'Key code anchors the report cites for these surfaces, re-verified against current code.',
      items: {
        type: 'object', additionalProperties: false,
        required: ['what', 'reportRef', 'status', 'currentRef'],
        properties: {
          what: { type: 'string', description: 'the thing being anchored (e.g. "Transactions auto-selects row 0 fallback")' },
          reportRef: { type: 'string', description: 'the file:line the report cites' },
          status: { type: 'string', enum: ['valid', 'drifted', 'missing'] },
          currentRef: { type: 'string', description: 'the actual current file:line where it lives now (or "n/a")' },
          note: { type: 'string' },
        },
      },
    },
    defects: {
      type: 'array',
      description: 'Concrete defects each later epic owns, with current path:line.',
      items: {
        type: 'object', additionalProperties: false,
        required: ['issue', 'currentRef', 'ownerEpic', 'severity'],
        properties: {
          issue: { type: 'string' },
          currentRef: { type: 'string' },
          ownerEpic: { type: 'string', description: 'Epic 1 | Epic 2 | Epic 3 | Epic 4 | Epic 5 | Epic 6 | Epic 7' },
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
        },
      },
    },
    tokenViolations: {
      type: 'array',
      description: 'Design-system token violations (raw red/purple/hex, gradients, emoji, unicode glyphs, non-tabular money) with file:line.',
      items: {
        type: 'object', additionalProperties: false,
        required: ['issue', 'currentRef'],
        properties: { issue: { type: 'string' }, currentRef: { type: 'string' } },
      },
    },
    notes: { type: 'string' },
  },
}

const CLUSTERS = [
  {
    cluster: 'Dashboard + Inbox',
    surfaces: ['Dashboard', 'Inbox'],
    files: 'apps/web/src/components/openbooks/CoreScreens.tsx (DashboardScreen ~51, InboxScreen ~344), convex/coreViews.ts',
    reportSecs: 'Section 2.1/2.2, Section 6.1 (line ~1145) and 6.2 (~1159), Section 11 R3 (Inbox sign), Section 8.2',
    focus: 'Auto-open fallbacks (inbox.items[0] ~360), Inbox receipt-match overflow, hardcoded negative on document totals (coreViews.ts ~327), "Operating snapshot"/"Demo entity"/A-R-A-P jargon on Dashboard, period control, card actionability/deep-links.',
  },
  {
    cluster: 'Transactions',
    surfaces: ['Transactions'],
    files: 'apps/web/src/components/openbooks/CoreScreens.tsx (TransactionsScreen ~717), convex/coreViews.ts (transactions query ~374, row shape ~464-503)',
    reportSecs: 'Section 2.3, Section 6.3 (~1174), Section 8.2/8.3, Section 11 R3/R5/D8',
    focus: 'Permanent 380px aside + ?? data.rows[0] auto-select (~746), overflow-hidden table wrapper (~981), inline category Select min-w (~1021), blanket signed Amount (~1034), missing Approve action, incomplete filters, N+1 journalLine fetches (~429-453). Confirm the transactions row fields the new FilterBar/table will need.',
  },
  {
    cluster: 'Income + Expenses',
    surfaces: ['Income', 'Expenses'],
    files: 'apps/web/src/components/openbooks/IncomeScreen.tsx, ExpensesScreen.tsx, convex/incomeViews.ts, convex/expensesViews.ts',
    reportSecs: 'Section 2.4/2.5, Section 6.4 (~1191) and 6.5 (~1205), Section 5.0 (token gaps), Appendix A',
    focus: 'Raw text-red-600/bg-red-50 in IncomeScreen (~24-32,115,245,651), off-palette DOTS incl Stripe blurple #635bff and plum #7a4a8c in ExpensesScreen (~29), unicode ▲/▼ trend glyphs (~71/80), frozen MONTH_START/TODAY constants, native segmented pills, raw <select>. Confirm incomeViews/expensesViews read the SAME transactions+journalLines (lens proof) and which KPI fields are missing.',
  },
  {
    cluster: 'Bills + Contacts + Payroll',
    surfaces: ['Bills', 'Contacts', 'Payroll'],
    files: 'apps/web/src/components/openbooks/ModuleScreens.tsx (BillsScreen ~473, ContactsScreen ~142, PayrollScreen ~937), module-helpers.ts, convex/moduleViews.ts, convex/bills.ts, convex/payroll.ts, convex/crons.ts',
    reportSecs: 'Section 2.6/2.7/2.8, Section 6.6/6.7/6.8, Section 11 R3 (Contacts netting), Q2/D1 (payroll auto-run, soft-archive)',
    focus: 'Bills div-tables + persistent half-empty side panel + raw <select>; Contacts permanent profile pane + AR/AP netted into one balance (moduleViews.ts ~223-232; ModuleScreens ~236) + NO archived flag in schema (confirm); Payroll localMinor/100 float string (~1194), run.headcount, no auto-run (only cron is Plaid sync crons.ts:7; startRun payroll.ts:253), magenta avatar. Confirm soft-archive needs a schema `archived` field.',
  },
  {
    cluster: 'Reports + Settings',
    surfaces: ['Reports', 'Settings'],
    files: 'apps/web/src/components/openbooks/ReportsScreen.tsx, SettingsScreen.tsx, components/openbooks/settings/* (AuditSection, RulesSection, ConnectionsSection, AiSection, BusinessesSection), StripeConnectionPanel.tsx, PlaidConnectionPanel.tsx',
    reportSecs: 'Section 2.9/2.10, Section 6.9 (~1266) and 6.10 (~1284), Section 8.5, gates G4/G5/G14',
    focus: 'Settings subnav NOT sticky (SettingsScreen ~152-154), Audit grid-cols-[120px_120px_1fr] (~77) overflow, Rules 9 inline controls, Stripe payout overflow, bg-teal-600/bg-amber-500 + unicode check/arrows in Reports, AI-panel squeeze on Reports, drill-through params missing, magenta avatar #a4148c in BusinessesSection, "Bedrock active" in ModuleScreens ~1568.',
  },
  {
    cluster: 'Ask AI + Shell',
    surfaces: ['AskAI', 'Shell'],
    files: 'apps/web/src/components/openbooks/OpenBooksAIChat.tsx (~918 lines), AppShell.tsx (~1040), AskAIScreen.tsx, app/ask-ai/page.tsx, lib/openbooks/ai.ts, CommandPalette.tsx, AppScreen.tsx',
    reportSecs: 'Section 2.11/2.12, Section 6.11/6.12, Section 7 (entire), Section 8.1/8.6, Appendix B Ask AI wiring',
    focus: 'Provider/debug leakage "Bedrock active" (OpenBooksAIChat ~758, AskAIScreen ~45, ai.ts ~143 label, ~804/807 copy), hand-rolled MarkdownBlocks/InlineMarkdown/ToolPartCard <details>/raw <select> thread switcher (~762), docked w-[380px] flex-sibling that pushes content (AppShell ~466-469), :: nonce truncation (~226), SUGGESTIONS duplicated (OpenBooksAIChat ~33 vs ai.ts ~121), mobile sm-gated controls, header month chip + global search clutter, Settings in primary nav. Confirm Convex agent streaming hooks (useUIMessages/useSmoothText/optimisticallySendMessage) so Epic 2 preserves them.',
  },
]

phase('Audit')

const results = await parallel(
  CLUSTERS.map((c) => () =>
    agent(
      `${RULES}\n\n${NORTH_STAR}\n\nCLUSTER TO AUDIT: ${c.cluster} (surfaces: ${c.surfaces.join(', ')}).\nRepo root: ${REPO}.\nThe APPROVED contract is ${REPORT}. Read the relevant parts: ${c.reportSecs}. The report cites many file:line anchors that later build epics will rely on — your job is to RE-VERIFY those anchors against the CURRENT code and flag any drift, then enumerate the concrete defects + token violations for these surfaces.\n\nCurrent files (verify, then read): ${c.files}\nKnown focus items to confirm with current path:line: ${c.focus}\n\nDO: (1) open each current file and the cited report anchors; (2) for each important anchor the report cites, set status valid/drifted/missing and give the CURRENT path:line; (3) list concrete defects with current path:line and which Epic owns the fix (Epic 1 primitives / Epic 2 shell+AskAI / Epic 3 Transactions+Inbox / Epic 4 Income+Expenses / Epic 5 Bills+Contacts / Epic 6 Payroll+Reports+Settings / Epic 7 QA); (4) list design-system token violations with file:line. Be exhaustive but only include things you verified in the real code.\nReturn the structured audit.`,
      { label: `audit:${c.cluster}`, phase: 'Audit', schema: SCHEMA },
    ),
  ),
)

return { results: results.filter(Boolean) }
