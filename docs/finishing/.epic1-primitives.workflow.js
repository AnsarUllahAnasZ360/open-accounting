export const meta = {
  name: 'openbooks-epic1-primitives',
  description: 'Epic 1: build the shared OpenBooks workbench primitive layer (11 components + harness) to Section 5 of the redesign report, then adversarially critique and fix. Single-owner foundation.',
  phases: [
    { title: 'Build', detail: 'one build agent authors all 11 workbench primitives + a dev harness route' },
    { title: 'Critique', detail: 'parallel design-system + correctness + responsive critics' },
    { title: 'Fix', detail: 'one agent applies confirmed critique fixes and re-greens typecheck/lint' },
  ],
}

const REPO = '/Volumes/SSD/OpenBooks'
const WEB = 'apps/web'
const REPORT = 'docs/finishing/frontend-redesign-research-report.md'

// ---- Shared doctrine injected into every agent ----------------------------
const DS = `OpenBooks DESIGN SYSTEM (HARD rules — any violation is a bug):
- White ledger surfaces; Geist (UI) + Geist Mono for ALL money/dates/account#; tabular-nums via the existing \`money-figures\` class; letter-spacing 0.
- ONE brand green #2ca01c (--primary / --ob-green-500). AI affordances are GREEN (text-primary / --ai, lucide Sparkles), NEVER purple/violet/indigo/gradient.
- Hairline borders; cards = ring-1 ring-foreground/10 + shadow-xs + 14px radius. No colored left-border cards, no glows.
- Money-in MAY be green; ordinary expenses are NEUTRAL (text-muted-foreground), never alarm red. --negative (#d92d20) is ONLY for overdue/outflow/destructive.
- Use SEMANTIC TOKENS, never raw Tailwind/hex: text-negative not text-red-600; bg-negative-surface not bg-red-50; --ai / --ob-green-* not inline hex; --chart-1..5 for series. Stripe blurple only on a Stripe badge.
- BANNED: gradients, glassmorphism/backdrop-blur, decorative blobs, emoji, unicode-as-icon (no ▲▼→✓ — use lucide TrendingUp/Down, ArrowRight, Check).
- shadcn/ui primitives BEFORE raw controls. Mobile is a real responsive surface, not a squeezed desktop table.`

const SKILLS = `BEFORE you design, READ these skills and follow them:
- Frontend design doctrine: ${REPO}/.claude/skills/frontend-design/SKILL.md (deliberate, non-templated, restraint, write UI copy from the user's side).
- shadcn rules: ${REPO}/.claude/skills/shadcn/SKILL.md AND ${REPO}/.claude/skills/shadcn/rules/styling.md AND ${REPO}/.claude/skills/shadcn/rules/composition.md AND .../rules/forms.md.
  Key shadcn rules: className is for LAYOUT not color/typography; no space-x/space-y (use flex gap); size-* when w==h; truncate shorthand; cn() for conditional classes; NO manual z-index on overlays; Dialog/Sheet/Drawer need a Title (sr-only ok); items inside their Group (SelectItem→SelectGroup, CommandItem→CommandGroup); full Card composition; Avatar needs AvatarFallback; Empty for empty states; toasts via sonner; Skeleton for loading; Badge not custom span.`

const FOUNDATION = `FOUNDATION ALREADY IN PLACE (do not re-add):
- Tokens added to ${WEB}/src/app/globals.css: --negative + --negative-surface, --positive-surface, --warning-surface, --info-surface, --ai + --ai-surface, and an --ob-green-50..900 ramp, each wired in @theme inline so utilities resolve: bg-negative, text-negative, bg-negative-surface, text-ai, bg-ob-green-50, text-ob-green-700, etc. USE THESE.
- New shadcn/ui primitives generated under ${WEB}/src/components/ui/ (CONFIRMED export names — import exactly these, but read a file if unsure):
  popover.tsx → Popover, PopoverTrigger, PopoverContent, PopoverAnchor; calendar.tsx → Calendar; checkbox.tsx → Checkbox; scroll-area.tsx → ScrollArea, ScrollBar; toggle-group.tsx → ToggleGroup, ToggleGroupItem (toggle.tsx → Toggle); drawer.tsx → Drawer, DrawerTrigger, DrawerClose, DrawerContent, DrawerHeader, DrawerFooter, DrawerTitle, DrawerDescription; avatar.tsx → Avatar, AvatarImage, AvatarFallback; sonner.tsx → Toaster (NOT "Sonner"; import { toast } from "sonner" for firing toasts); progress.tsx → Progress; collapsible.tsx → Collapsible, CollapsibleTrigger, CollapsibleContent; field.tsx → Field, FieldLabel, FieldDescription, FieldError, FieldGroup, FieldLegend, FieldSet, FieldContent, FieldTitle; input-group.tsx → InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupInput, InputGroupTextarea. (Pre-existing: badge,button,card,command,dialog,dropdown-menu,input,label,select,separator,sheet,skeleton,switch,table,tabs,textarea,tooltip,alert-dialog.) The harness page must mount <Toaster /> so ExportMenu toasts render.
- Existing OpenBooks primitives in ${WEB}/src/components/openbooks/primitives.tsx: formatMinorMoney, Amount (tone: neutral|income|expense), StatCard, EmptyState, PageHeader, Sparkline, BarChart, CategoryChip, ConfidenceRing, AgingMiniBar, ReasoningPopover, ReviewItem. REUSE Amount/formatMinorMoney/EmptyState/ConfidenceRing/Sparkline; do NOT duplicate them.
- cn() from ${WEB}/src/lib/utils.`

// Real row contracts the data table must serve (validate the API against these).
const CONTRACTS = `REAL ROW CONTRACTS the OpenBooksDataTable + DetailSheet must serve (do NOT invent shapes — the generic table must accept these as-is via per-surface ColumnDef[]):
- Transactions row (convex/coreViews.ts ~464-503): { id, date, merchant, rawDescription, amountMinor (signed int minor units), source, review, decidedBy|null, confidence|null, categoryAccountId|null, categoryName, bankAccountId|null, bankAccountName, hasInboxItem, entryId|null, receipt:{id,vendor,date,totalMinor,status}|null, activity[], lines[] }.
- BillRow (apps/web/src/components/openbooks/module-helpers.ts:142): { id, vendorName, status, issueDate, dueDate, totalMinor, currency, daysUntilDue, document|null, postingAffordance }.
- ContactRow (module-helpers.ts:115): { id, name, roles[], email|null, aliases[], openReceivableMinor, openPayableMinor, totalThisYearMinor, defaultCategory|null, defaultCategoryRule }.
- Also exist: InvoiceRow, EmployeeRow, PayrollRunRow (module-helpers.ts). The table API must be GENERIC <Row> with getRowId + ColumnDef<Row>[]; columns are defined per-surface by the page epics, NOT hardcoded here.`

const COMPONENT_SPEC = `BUILD these 11 primitives under a NEW dir ${WEB}/src/components/openbooks/workbench/ (one file each), to Section 5 of ${REPORT}. Read Section 5 (lines ~944-1138) for the authoritative spec. Summary of required API:

1. WorkbenchPage.tsx — page scaffold: props { eyebrow?, title, description?, actions?:ReactNode, kpis?:ReactNode, attention?:ReactNode, children }. Wraps PageHeader; max-w content frame; vertical rhythm (flex flex-col gap-5). Header stacks below md.
2. PageActionBar.tsx — right-aligned action cluster: props { primary?:{label,icon?,onClick}, actions?:ActionItem[], children? }. Secondary actions collapse to a DropdownMenu (⋯) below md. Composes Button (+variant=outline) and ExportMenu as a member.
3. DateRangeControl.tsx — ONE canonical period control: ToggleGroup presets (This month / Last month / Last 3 months / YTD) + Popover+Calendar custom range (future dates disabled). props { value:{preset}|{from,to}, onChange, presets?, align?, compact? }. Mobile collapses to a single Popover trigger showing the active label.
4. FilterBar.tsx — facets + search row: props { facets?:FacetDef[], value, onChange, search?, onSearch?, activeChips?, onClearAll?, children? }. Search Input with leading lucide Search (pl-8). Removable Badge chips for active filters. Below md, facets collapse into a "Filters" Popover/Sheet; search stays full width on top. Can embed AccountMultiSelect/DateRangeControl as children.
5. AccountMultiSelect.tsx — Popover + Command (reuse ui/command) multi/single select with Checkbox per row and a Badge count on the trigger. props { options:{id,label,kind?}[], value:string[], onChange, mode?:"single"|"multi", placeholder? }.
6. KpiStrip.tsx — metric row: props { items:KpiItem[], columns?:3|4 } where KpiItem={ label, value:ReactNode, tone?:"neutral"|"income"|"negative", delta?:{pct,direction:"up"|"down"}, detail?, sparkline?:number[] }. Trend via lucide TrendingUp/TrendingDown (NEVER ▲▼). Only the overdue/negative KPI may use text-negative. grid-cols-1 → sm:grid-cols-2 → md:grid-cols-{3|4}; tabular figures; hero figures get min-w-0 + truncate.
7. OpenBooksDataTable.tsx — THE dense ledger table, generic <Row>. props { columns:ColumnDef<Row>[] (each {key,header,align?:"left"|"right",mono?,width?,sortable?,cell:(row)=>ReactNode,priority?:number for responsive hide order}), rows, getRowId, selectable?, selectedIds?, onSelectionChange?, onRowClick?(row) (opens DetailSheet — NEVER inline-expand), density?:"comfortable"|"compact", loading?, empty?, bulkActions?:ReactNode, attention?:(row)=>ReactNode }. MUST: client-side sort by sortable columns; header + row Checkbox select-all/select-row; sticky thead (sticky top-0 bg-background); body wrapped so the table lives in an overflow-x-auto region and its flex/grid track carries min-w-0; Skeleton rows when loading; EmptyState when empty; a bulk-action toolbar appears ONLY when rows are selected. CRITICAL: selectedId defaults to null — detail opens ONLY on explicit onRowClick, never auto-selects row 0. RESPONSIVE: desktop = full columns inside overflow-x-auto; mobile (below md) = a CARD/LIST rendering of the same ColumnDef (label+value stacked, name min-w-0 truncate, money shrink-0), NEVER a squeezed desktop table. Money cells right-aligned + money-figures.
8. DetailSheet.tsx — the ONE slide-over: props { open, onOpenChange, title, subtitle?, attention?:ReactNode, tabs?:{value,label,content}[], children, footer? }. CLOSED by default; right-side Sheet on lg+, bottom Drawer (side="bottom") on mobile. Body in ScrollArea. Must include a Title (a11y). Uses shadcn Sheet + Drawer + ScrollArea + Tabs.
9. AiInsightBadge.tsx — quiet GREEN AI affordance: props { confidence?:number, reasoning?:ReactNode, decidedBy?:string, variant:"ring"|"chip"|"inline" }. Real Popover (replace the <details> fake) anchored right in tables; inline block inside DetailSheet on mobile. lucide Sparkles in --primary/--ai. Reuse ConfidenceRing for the ring variant. Export this from workbench/ AND leave the old ReasoningPopover intact (page epics migrate later).
10. EvidenceUpload.tsx — attach/extract a receipt/doc: props { target:{kind,id}, document?, onUpload?, onMatch?, extracting?:boolean }. Button + hidden file input (or input-group with a drop affordance), Card preview, AiInsightBadge for extracted-field confidence, AttentionState for missing-evidence/unmatched. Do NOT wire real Convex mutations — accept callbacks; page epics wire them.
11. ExportMenu.tsx — DropdownMenu with lucide Download: props { formats:("csv"|"pdf"|"xlsx")[], onExport:(fmt)=>void|Promise<void>, filename?, disabled? }. Icon-only on mobile, label+chevron on desktop; fire a sonner toast on completion. Member of PageActionBar.

ALSO build (foundational, consumed by the above):
- AttentionState.tsx — shared status vocabulary. Export an AttentionKind union ("needs-review"|"missing-evidence"|"overdue"|"unmatched"|"unposted"|"low-confidence") and an attentionMeta map {label, icon (lucide CircleAlert/Receipt/Clock/Unlink/FileX/Sparkles), tokenClass}. overdue→--negative; needs-review/low-confidence→--warning/--ai; unposted/unmatched→muted-foreground. Component props { state:AttentionKind, count?:number, size? }. Icon-only at narrow widths with Tooltip label. This is the single source of truth every surface reads.

NOTE: CommandPalette already exists (${WEB}/src/components/openbooks/CommandPalette.tsx) and AskAIWidget is Epic 2 — do NOT build those here.

INDEX: create ${WEB}/src/components/openbooks/workbench/index.ts re-exporting every primitive + AttentionKind/attentionMeta.

HARNESS (for screenshot evidence): create a STANDALONE dev page at ${WEB}/src/app/dev/workbench/page.tsx (a "use client" page that does NOT render AppShell/auth — just a plain max-w-6xl container) that renders EVERY primitive with realistic MOCK data, and demonstrates: KpiStrip (3 and 4 col), a full OpenBooksDataTable (selectable, with bulk toolbar shown, AiInsightBadge + AttentionState in cells, money right-aligned) PLUS its loading and empty states, FilterBar with active chips, DateRangeControl open, AccountMultiSelect, a DetailSheet trigger, ExportMenu, EvidenceUpload, and every AttentionState chip. Mock data only — no Convex. Section the page with headings so screenshots are legible.`

const BUILD_RULES = `RULES: This is Epic 1 — the shared FOUNDATION. You may ONLY create files under ${WEB}/src/components/openbooks/workbench/ and ${WEB}/src/app/dev/workbench/, and you may extend ${WEB}/src/components/openbooks/primitives.tsx if (and only if) a tiny shared helper is genuinely needed. Do NOT edit any page screen (CoreScreens/IncomeScreen/ExpensesScreen/ModuleScreens/ReportsScreen/SettingsScreen/AppShell/OpenBooksAIChat), any convex/ file, globals.css (already done), or the existing ui/ primitives. Keep money as integer minor units. Before returning, RUN \`pnpm --filter @openbooks/web typecheck\` and \`pnpm --filter @openbooks/web lint\` from ${REPO} and FIX every error you introduced (read the new ui/ component files to get exact export names; calendar/day-picker, sonner Toaster, drawer/vaul APIs vary). Return only after both are green for your new files.`

const MANIFEST_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['filesCreated', 'componentsBuilt', 'typecheck', 'lint', 'apiNotes', 'risks'],
  properties: {
    filesCreated: { type: 'array', items: { type: 'string' } },
    componentsBuilt: { type: 'array', items: { type: 'string' } },
    typecheck: { type: 'string', enum: ['green', 'failing'] },
    lint: { type: 'string', enum: ['green', 'failing'] },
    apiNotes: { type: 'string', description: 'Short usage notes per primitive + any API decisions a page epic must know.' },
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
        fix: { type: 'string', description: 'concrete fix' },
      },
    } },
    verdict: { type: 'string', enum: ['pass', 'needs-fixes'] },
  },
}

// ---------------------------------------------------------------------------
phase('Build')

const build = await agent(
  `You are the single-owner BUILD agent for Epic 1 of the OpenBooks frontend redesign — the shared workbench primitive layer the whole product depends on. Work methodically; this code must typecheck and look right.\n\n${SKILLS}\n\n${DS}\n\n${FOUNDATION}\n\n${CONTRACTS}\n\n${COMPONENT_SPEC}\n\n${BUILD_RULES}\n\nReturn the manifest.`,
  { label: 'epic1:build', phase: 'Build', schema: MANIFEST_SCHEMA },
)

log(`Build: ${build?.componentsBuilt?.length ?? 0} components, typecheck=${build?.typecheck}, lint=${build?.lint}, ${build?.filesCreated?.length ?? 0} files.`)

// ---------------------------------------------------------------------------
phase('Critique')

const CRIT_CTX = `The Epic 1 build is complete. Files created:\n${JSON.stringify(build?.filesCreated ?? [], null, 1)}\nThe spec is Section 5 of ${REPORT} and the design rules below.\n${DS}`

const critiques = await parallel([
  () => agent(
    `${CRIT_CTX}\n\nLENS: DESIGN-SYSTEM compliance. Read every new file under ${WEB}/src/components/openbooks/workbench/ and ${WEB}/src/app/dev/workbench/. Find EVERY violation: raw hex/Tailwind color where a token exists (text-red-*, bg-*-50, inline #hex), purple/gradient/glassmorphism, emoji or unicode-as-icon (▲▼→✓), non-tabular money (money not using Amount/money-figures), expenses rendered alarm-red, raw <select>/<input type=checkbox> instead of shadcn, missing Sheet/Drawer Title, space-x/space-y instead of gap, manual z-index on overlays. Cite path:line and give the concrete fix. Read-only; do not edit.`,
    { label: 'crit:design', phase: 'Critique', schema: CRITIQUE_SCHEMA }),
  () => agent(
    `${CRIT_CTX}\n\nLENS: API + CORRECTNESS. Verify each primitive matches its Section 5 contract and the REAL row contracts (${CONTRACTS}). Check: OpenBooksDataTable is generic <Row> with ColumnDef[] (not hardcoded columns), detail is CLOSED by default (selectedId starts null, NO auto-select of row 0), sort/select/bulk/empty/loading all work, table lives in overflow-x-auto + min-w-0 track, mobile renders a card stack (not a squeezed table). DetailSheet is closed by default and uses Sheet on desktop + bottom Drawer on mobile. AttentionState exports one shared vocabulary. AiInsightBadge uses a real Popover (not <details>). Run \`pnpm --filter @openbooks/web typecheck\` yourself and report any error. Cite path:line + fix. Read-only except running typecheck.`,
    { label: 'crit:api', phase: 'Critique', schema: CRITIQUE_SCHEMA }),
  () => agent(
    `${CRIT_CTX}\n\nLENS: RESPONSIVE. Read the new components. Verify the responsive rules from Section 8: tables wrap in overflow-x-auto with min-w-0 (never overflow-hidden), mobile card-stack fallback below md, KpiStrip stacks 1→2→3/4 with min-w-0 hero figures, DetailSheet is a bottom Drawer on mobile, FilterBar facets collapse to a Popover/Sheet below md, DateRangeControl collapses to one trigger on mobile, no fixed widths that would overflow at 390px. Flag any element that would cause horizontal overflow or text overlap at 390/768. Cite path:line + fix. Read-only.`,
    { label: 'crit:responsive', phase: 'Critique', schema: CRITIQUE_SCHEMA }),
])

const findings = critiques.filter(Boolean).flatMap((c) => (c.findings ?? []).map((f) => ({ ...f, lens: c.lens })))
const blockers = findings.filter((f) => f.severity === 'blocker' || f.severity === 'high')
log(`Critique: ${findings.length} findings (${blockers.length} blocker/high). Verdicts: ${critiques.filter(Boolean).map((c) => c.lens + '=' + c.verdict).join(', ')}.`)

// ---------------------------------------------------------------------------
phase('Fix')

let fix = null
if (findings.length) {
  fix = await agent(
    `You are the FIX agent for Epic 1. The build is done; three critics reviewed it. Apply EVERY blocker/high finding and any clearly-correct medium/low finding. Stay within the Epic 1 allowed paths (workbench/ + dev/workbench/ + a tiny primitives.tsx helper if truly needed); do NOT touch page screens, convex, globals.css, or existing ui/ primitives.\n\n${DS}\n\nFINDINGS (JSON):\n${JSON.stringify(findings, null, 1)}\n\nAfter applying fixes, RUN \`pnpm --filter @openbooks/web typecheck\` and \`pnpm --filter @openbooks/web lint\` from ${REPO} and ensure BOTH are green. Return the manifest.`,
    { label: 'epic1:fix', phase: 'Fix', schema: MANIFEST_SCHEMA },
  )
  log(`Fix: typecheck=${fix?.typecheck}, lint=${fix?.lint}.`)
}

return { build, critiques: critiques.filter(Boolean), findings, fix }
