export const meta = {
  name: 'openbooks-epic7-responsive-qa',
  description: 'Epic 7 (capstone): full responsive-QA sweep of all 11 surfaces × 5 gate widths, fix the accumulated polish defects, migrate the e2e suite to the redesigned DOM (dev-bypass + localhost robust), then run the authoritative gates (pnpm verify + pnpm test:e2e), re-shoot fixed surfaces, and write the consolidated acceptance-gate (G1-G16) evidence checklist.',
  phases: [
    { title: 'Sweep', detail: 'one read-only QA agent screenshots all 11 surfaces × 5 widths and returns a defect list' },
    { title: 'Fix', detail: 'parallel: source-fix (defects + known polish) | e2e-migrate (specs → redesigned DOM)' },
    { title: 'Verify', detail: 'one agent runs pnpm verify + pnpm test:e2e, fixes remaining spec issues, re-shoots, writes the acceptance checklist' },
  ],
}

const REPO = '/Volumes/SSD/OpenBooks'
const WEB = 'apps/web'
const REPORT = 'docs/finishing/frontend-redesign-research-report.md'
const EVID = 'docs/finishing/evidence/epic7'

const DS = `OpenBooks DESIGN SYSTEM (HARD rules): white ledger surfaces; Geist + Geist Mono money/dates (money-figures, tabular-nums, letter-spacing 0); ONE brand green #2ca01c; AI affordances GREEN (text-ai/bg-ai-surface/lucide Sparkles) NEVER purple/gradient; money-in MAY be green, ordinary expenses NEUTRAL never alarm-red, text-negative ONLY for overdue/outflow/destructive; semantic tokens not raw hex/Tailwind; --chart-1..5 for series; NO gradients/glassmorphism/emoji/unicode-as-icon (lucide instead); shadcn primitives before raw controls; mobile is a real responsive surface (card-stack / bottom drawer), never a squeezed table.`

const ENV = `DEV/E2E ENVIRONMENT (critical):
- A dev server is ALREADY RUNNING on http://localhost:3100 (Next dev, NEXT_PUBLIC_OPENBOOKS_DEV_AUTH_BYPASS=1, dev Convex z360:openbooks with all Epic 3-6 backend deployed). Do NOT start another; reuse :3100.
- Convex's client WebSocket only handshakes reliably at \`localhost:3100\`, NOT \`127.0.0.1\` in a COLD headless Playwright context (a cold 127 context hangs on "Loading your open books workspace…" and app-sidebar never mounts). The repo playwright.config baseURL defaults to 127.0.0.1.
- For SCREENSHOTS: model specs on \`tests/e2e/redesign-epic3-evidence.spec.ts\` (and epic4/epic5 variants) — they navigate to \`http://localhost:3100\${route}\` explicitly and use the dev-auth bypass; they WORK. Reuse \`expectNoHorizontalScroll(page,width)\` from tests/e2e/helpers.ts.
- For FUNCTIONAL specs: run with \`PLAYWRIGHT_BASE_URL=http://localhost:3100\` so the config reuses this warm server + uses localhost. Some legacy specs gate on \`signInOwner()\` (real OWNER_EMAIL/PASSWORD, absent here) and SKIP — those need migrating to the dev-bypass path or honest documentation.
- The 11 surfaces + routes: dashboard(/dashboard), inbox(/inbox), transactions(/transactions), income(/income), expenses(/expenses), bills(/bills), contacts(/contacts), payroll(/payroll), reports(/reports), settings(/settings), ask-ai(/ask-ai). Five gate widths: 390, 768, 1306, 1440, 1758.`

const STATE = `REDESIGN STATE (Epics 0-6 shipped + verified):
- Shared workbench toolkit @/components/openbooks/workbench; tokens in globals.css; AppShell shell + AskAIWidget (Epic 2). Transactions+Inbox (Epic 3), Income+Expenses lenses (Epic 4), Bills+Contacts (Epic 5), Payroll+Reports+Settings (Epic 6) all rebuilt; detail closed by default everywhere; soft-archive Contacts; payroll auto-draft backend (safe, no-op on demo); Settings sticky subnav.
- A SHELL FIX already landed: AppShell.tsx root is now \`overflow-x-clip\` (was overflow-x-hidden) so position:sticky descendants (Settings subnav, G14) actually pin. This is GLOBAL — re-verify NO surface regressed to horizontal overflow at all 5 widths.
- KNOWN POLISH DEFECTS to fix (confirm + fix in this epic):
  1. Income "Money owed" KPI (IncomeScreen.tsx) crams open-total + overdue + detail into one tile → the overdue figure truncates to "ov…" at 1440. Rework the KpiItem layout so the overdue amount is readable at every width.
  2. Settings "Advanced / sandbox tools" + "Diagnostics" Collapsibles (settings/ConnectionsSection or Plaid/Stripe panels + AiSection) currently default OPEN to keep legacy specs green; report 6.10 wants them default CLOSED. The e2e-migrate agent will update the asserting specs to OPEN the disclosure first, so the source-fix agent can set them default-CLOSED (owner-facing simplification). Coordinate on this contract.
- E2E specs likely stale against the redesigned DOM (migrate): ask-ai-parity-h2, ai-chat, app-shell (Settings moved to footer; no provider/Bedrock label; Ask AI 4 modes), core-screens/inbox-h2 (host 127→localhost), modules (signInOwner→dev-bypass; payroll "statement" is now role=tab not button; "Selected bill" panel removed→row-click), income-expenses-bills (C4 "Recurring spend" now matches 2 nodes→.first()), reports/reports-payroll/reports-export-h2/settings/audit-h2 (selectors + the new sticky/overflow/drill DOM). The redesign-epicN-evidence specs already pass under dev-bypass/localhost — reuse their setup.`

const SWEEP_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['screenshotsWritten', 'overflowMatrix', 'defects', 'perSurfaceVerdict'],
  properties: {
    screenshotsWritten: { type: 'number' },
    overflowMatrix: { type: 'string', description: 'Max horizontal-overflow px per surface × width (note any >1px).' },
    defects: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['surface', 'width', 'severity', 'issue', 'file'],
      properties: {
        surface: { type: 'string' }, width: { type: 'string' },
        severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
        issue: { type: 'string' }, file: { type: 'string', description: 'best-guess source file:area' },
      },
    } },
    perSurfaceVerdict: { type: 'string', description: 'PASS/ISSUES per surface from visual judgment (overflow, overlap, money tone, purple/gradient, emoji, detail-closed).' },
  },
}

const FIX_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['filesChanged', 'whatChanged', 'typecheck', 'lint', 'unitTests', 'risks'],
  properties: {
    filesChanged: { type: 'array', items: { type: 'string' } },
    whatChanged: { type: 'string' },
    typecheck: { type: 'string', enum: ['green', 'failing', 'n/a'] },
    lint: { type: 'string', enum: ['green', 'failing', 'n/a'] },
    unitTests: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
  },
}

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verify', 'e2e', 'gateChecklist', 'docWritten', 'remainingGaps'],
  properties: {
    verify: { type: 'string', description: 'pnpm verify result (typecheck && lint && build && test:unit) — pass/fail with detail.' },
    e2e: { type: 'string', description: 'pnpm test:e2e result: pass/fail counts; for each failure, real-defect vs migrated vs honestly-gated (signInOwner).' },
    gateChecklist: { type: 'string', description: 'G1-G16 each: PASS/PARTIAL/FAIL + the evidence artifact proving it.' },
    docWritten: { type: 'string', description: 'Path to the consolidated acceptance-gate evidence doc written.' },
    remainingGaps: { type: 'array', items: { type: 'string' } },
  },
}

phase('Sweep')
const sweep = await agent(
  `You are the QA-SWEEP agent for Epic 7 (final responsive QA) of the OpenBooks redesign. READ-ONLY except ONE new screenshot spec + PNGs under ${EVID}/.\n\n${ENV}\n\n${DS}\n\nWrite \`tests/e2e/redesign-epic7-matrix.spec.ts\` modeled on tests/e2e/redesign-epic3-evidence.spec.ts. For EACH of the 11 surfaces × EACH of the 5 gate widths (390/768/1306/1440/1758): navigate (localhost), wait for the surface's screen testid, assert expectNoHorizontalScroll(page,width), and screenshot to ${EVID}/ named \`2026-06-13-epic7-<surface>-<width>.png\`. ALSO capture two AI-open scenarios at 1306 and 1440 (open Ask AI via its trigger, navigate /reports and /transactions, assert the dense table still has no page overflow + screenshot) to prove gate G5/G3. Run it: \`pnpm exec playwright test tests/e2e/redesign-epic7-matrix.spec.ts --reporter=list\`.\n\nThen OPEN (read) a representative sample of the PNGs at 390 and 1306 for EVERY surface and JUDGE like a user: horizontal overflow, text overlap, clipped/truncated controls or money (e.g. the Income "Money owed" KPI overdue figure truncating to "ov…"), money not tabular/right-aligned, ordinary expenses rendered RED, purple/gradient AI, emoji/unicode-as-icon, detail panels open when they should be closed. Return the sweep manifest with a concrete defect list (surface/width/severity/issue/best-guess file).`,
  { label: 'epic7:sweep', phase: 'Sweep', schema: SWEEP_SCHEMA },
)
log(`Sweep: ${sweep?.screenshotsWritten} shots; ${(sweep?.defects||[]).length} defects (${(sweep?.defects||[]).filter(d=>d.severity==='blocker'||d.severity==='high').length} blocker/high)`)

phase('Fix')
const DEFECTS = JSON.stringify(sweep?.defects ?? [], null, 1)
const fixes = await parallel([
  () => agent(
    `You are the SOURCE-FIX agent for Epic 7. Fix the QA sweep's defects + the known polish items, editing SOURCE files only (the page screens under ${WEB}/src/components/openbooks/*, settings/*, the workbench primitives ONLY if a defect is genuinely in a shared primitive, and AppShell/AskAIWidget only for a confirmed shell overflow/overlap). Do NOT edit tests/e2e/* (the e2e-migrate agent owns those) and do NOT edit convex/ (no backend changes in QA) unless a defect is a real data bug (then flag, don't guess).\n\n${DS}\n\n${ENV}\n\n${STATE}\n\nSWEEP DEFECTS to fix (apply every blocker/high + clearly-correct medium/low; skip any that are screenshot-judgment false-positives, noting why):\n${DEFECTS}\n\nALSO fix the two KNOWN polish items: (1) Income "Money owed" KPI overdue-figure truncation — rework the tile so the overdue amount is fully readable at 390/1306/1440/1758. (2) Set the Settings "Advanced / sandbox tools" and "Diagnostics" Collapsibles to default CLOSED (report 6.10) — the e2e-migrate agent is updating the asserting specs to open them first, so default-closed is now safe; keep the owner-facing card on top. Verify your fixes live on http://localhost:3100 where you can (resize + read DOM). Keep every data-testid; keep money integer minor units + "AI proposes, ledger posts". Before returning, RUN \`pnpm --filter @openbooks/web typecheck\`, \`pnpm --filter @openbooks/web lint\`, \`pnpm test\` and ensure typecheck+lint GREEN, no unit regression. Return the fix manifest.`,
    { label: 'epic7:source-fix', phase: 'Fix', schema: FIX_SCHEMA }),
  () => agent(
    `You are the E2E-MIGRATE agent for Epic 7. You OWN tests/e2e/* (and may read any source to get selectors right, but do NOT edit source/convex). Migrate the Playwright suite to the redesigned DOM so \`pnpm test:e2e\` is GREEN or every remaining failure is honestly explained.\n\n${ENV}\n\n${STATE}\n\nTASKS: (1) Make the legacy specs RUN under the dev-auth bypass at localhost (not 127.0.0.1, not signInOwner-with-absent-creds): adopt the dev-bypass + localhost navigation the redesign-epicN-evidence specs use (read tests/e2e/helpers.ts + redesign-epic3-evidence.spec.ts; if helpers.ts gotoApp/signInOwner is shared infra, prefer adding a dev-bypass-aware path or a localhost baseURL override rather than breaking other specs). (2) Update stale selectors/copy to the redesigned DOM: app-shell (Settings in footer, no provider/Bedrock label, Ask AI 4 modes incl. mobile thread switcher), ask-ai-parity-h2 + ai-chat (AskAIWidget DOM, MessageResponse renderer, no <select> thread switcher), core-screens/inbox-h2 (Transactions register + grouped Inbox, detail-closed), income-expenses-bills (C4 "Recurring spend" → .first() since it now matches the KPI + chart header; new tab testids), modules (payroll "statement" → getByRole('tab',{name:'Statements'}); contact/bill row-click DetailSheet; soft-archive), reports/reports-payroll/reports-export-h2 (viewer toolbar, drill-sheet + "Open in Transactions", period=, multi-currency payroll summary), settings/audit-h2 (sticky subnav, grouped nav, OPEN the "Advanced/sandbox tools" + "Diagnostics" disclosures FIRST before asserting the demoted controls — they now default CLOSED). (3) Add width-matrix expectNoHorizontalScroll(page,w) assertions for w∈{390,768,1306,1440,1758} on each surface route in the appropriate specs (or a new responsive spec) per gate G1. Do NOT weaken assertions to force green — if a spec reveals a real product defect, FLAG it for the source-fix agent rather than deleting the check. Return the fix manifest (typecheck/lint n/a for specs; report which specs you migrated + a dry-run compile note).`,
    { label: 'epic7:e2e-migrate', phase: 'Fix', schema: FIX_SCHEMA }),
])
const sourceFix = fixes[0], e2eFix = fixes[1]
log(`Fix: source files=${sourceFix?.filesChanged?.length} tc=${sourceFix?.typecheck}; e2e specs=${e2eFix?.filesChanged?.length}`)

phase('Verify')
const verify = await agent(
  `You are the VERIFY + CONSOLIDATE agent for Epic 7 — the final gate of the OpenBooks redesign. The QA sweep, source fixes, and e2e migration are done.\n\n${ENV}\n\nDO:\n1. Run \`pnpm verify\` from ${REPO} (= typecheck && lint && build && test:unit). It MUST pass; if anything fails, fix it within the redesign files (or flag a genuine blocker) and re-run until green. Report the result.\n2. Run the FULL e2e suite warm: \`PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm exec playwright test --reporter=list\` (it writes the HTML report to docs/finishing/evidence/playwright-report). For EACH failure, classify: real product defect (fix the source if small + safe, else flag), a still-stale spec (fix the spec — you may edit tests/e2e/*), or honestly gated (e.g. a spec needing real OWNER creds — document it, do not fake). Re-run until green or every remaining failure is explained. Convex may be cold on first run — re-run once to warm it before declaring a failure.\n3. Re-shoot any surface whose source changed in the Fix phase (reuse the matrix spec) so the evidence reflects the final state.\n4. WRITE the consolidated acceptance-gate evidence doc at \`docs/finishing/frontend-redesign-final-evidence.md\`: an honest, founder-readable closeout that (a) maps EACH acceptance gate G1-G16 from ${REPORT} Section 10 to its proof (the named screenshot(s) under docs/finishing/evidence/ and/or the passing spec), marking PASS / PARTIAL / FAIL; (b) lists what changed per epic at a glance; (c) records remaining honest gaps (e.g. any spec gated on real creds, the merge-duplicates / Stripe-badge / contractor placeholders that need backend, the live payroll auto-draft cron unobserved-in-prod) and the recommended follow-ups; (d) links the per-epic evidence folders. Be honest — do NOT claim a gate passed without a named artifact.\n\n${DS}\n\nReturn the verify manifest.`,
  { label: 'epic7:verify', phase: 'Verify', schema: VERIFY_SCHEMA },
)
log(`Verify: verify=${(verify?.verify||'').slice(0,40)}; e2e=${(verify?.e2e||'').slice(0,40)}; doc=${verify?.docWritten}`)

return { sweep, sourceFix, e2eFix, verify }
