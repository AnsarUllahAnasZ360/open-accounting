export const meta = {
  name: 'payroll-module-build',
  description: 'Build the full OpenBooks Payroll module in one delivery: 10 dependency-ordered epics built sequentially, each VERIFIED by a read-only agent against its immutable commit while the next epic builds (pipelined), then bounded repair of failed epics, one whole-branch code review, an authoritative full-suite gate (typecheck/lint/build/unit/e2e/convex) with bounded repair, and a final report written for Ansar. Ledger posting path stays untouched; schema changes are additive.',
  phases: [
    { title: 'Setup', detail: 'create feat/payroll-module branch, record baseSha' },
    { title: 'Build', detail: 'one agent per epic, sequential, commits each epic' },
    { title: 'Verify', detail: 'read-only agent reviews each epic commit vs DoD while the next epic builds' },
    { title: 'Repair', detail: 'fix any failed-verdict epic, then re-verify (bounded)' },
    { title: 'Review', detail: 'one code-review agent over the whole branch diff' },
    { title: 'Gate', detail: 'authoritative full suite on HEAD, bounded repair until green' },
    { title: 'Report', detail: 'write the build report and return it to Ansar' },
  ],
}

const REPO = '/Volumes/SSD/OpenBooks'
const DESIGN_DOC = 'docs/finishing/payroll-redesign-plan.md'
const BUILD_DOC = 'docs/finishing/payroll-build-plan.md'
const BRANCH = 'feat/payroll-module'
const REPORT_PATH = 'docs/finishing/evidence/payroll-module-build-report.md'

const GATES = 'Gate commands, all run from ' + REPO + ': pnpm typecheck | pnpm lint | pnpm test (vitest) | pnpm build | pnpm test:e2e (Playwright, auto-starts the web dev server on :3100) | npx convex dev --once (after any convex/ change). Combined fast gate: pnpm verify (= typecheck && lint && build && test:unit).'

const RULES = [
  'HARD RULES (any violation is a defect):',
  '- AI proposes, the LEDGER posts. Posting happens ONLY through the existing approveRun / markLinePaid / markRunPaid server mutations — never client-side, never a new posting path. Posted journal entries are immutable. Money is integer MINOR UNITS + currency code, never a float. This redesign is ADDITIVE: it must not change what approval/settlement post.',
  '- Schema is additive: every new field v.optional(...); existing rows must keep validating; new child tables instead of unbounded arrays; index every queried field (withIndex, never .filter); bounded .take/.paginate, never raw .collect.',
  '- Authz on every function: requireWorkspaceRole(member) reads, getEntityForWrite(admin) writes; re-check entity scope server-side. payTo (bank details) is returned ONLY to admins and never logged or seeded.',
  '- Read convex/_generated/ai/guidelines.md BEFORE any convex/ edit. "use node" only in action files (no queries/mutations there).',
  '- Design system: white ledger surfaces; Geist + money-figures tabular; one brand green #2ca01c; AI affordances green (never purple/gradient); status chips Draft=neutral, Approved=info-blue, Paid=green; no emoji/gradient/glass; shadcn primitives before raw controls; mobile is a real responsive surface, not a squeezed table.',
  '- Reuse the workbench toolkit from @/components/openbooks/workbench (WorkbenchPage, WorkbenchToolbar, SavedViews, the insight strip, OpenBooksDataTable with rowAttributes for testids, DetailSheet, Amount/formatMinorMoney). Do not re-implement tables/filters/detail/KPIs.',
  '- Preserve every payroll e2e testid (m6-payroll-screen, payroll-run-row, payroll-run-detail, payroll-line-row, payroll-base-total, payroll-approve, payroll-approved-banner, payroll-mark-paid, payroll-currency-totals, payroll-statement-csv, payroll-back, payroll-error) and the USD/INR/PKR payroll text + "Printable statement".',
  '- Never commit secrets, .env files, or real bank/PII data. Be honest: never fake a green gate or imply automation that does not run.',
].join('\n')

const SKILLS = 'BEFORE building, READ and follow: ' + REPO + '/.claude/skills/shadcn/SKILL.md (+ rules/), ' + REPO + '/.claude/skills/frontend-design/SKILL.md, and ' + REPO + '/convex/_generated/ai/guidelines.md.'

const EPICS = [
  { id: 'E1', title: 'Data foundation: schema, migration, payroll math', layer: 'backend',
    owns: 'convex/schema.ts (payroll + new tables), convex/payrollMath.ts, convex/payrollMigrations.ts (new), convex/crons.ts (repoint auto-draft to payrollSettings)' },
  { id: 'E2', title: 'Employee & lifecycle backend', layer: 'backend',
    owns: 'convex/employees.ts (new)' },
  { id: 'E3', title: 'Runs, worksheet, statements, settings & insights backend', layer: 'backend',
    owns: 'convex/payroll.ts (extend generateRun/updateRunLine/runDetail; approveRun/markLinePaid/markRunPaid UNCHANGED), convex/payrollStatements.ts, convex/payrollSettings.ts, convex/payrollInsights.ts (all new)' },
  { id: 'E4', title: 'Payslip PDF + Plunk email backend', layer: 'backend',
    owns: 'convex/payrollPdf.ts (use node), convex/payrollEmail.ts (use node, reuse packages/email sendPlunkEmail), convex/payslips.ts (new; deliveries queries/mutations — NOT in a use-node file)' },
  { id: 'E5', title: 'Module shell, routing, sub-nav & Overview', layer: 'frontend',
    owns: 'apps/web/src/app/payroll/[[...view]]/page.tsx (new optional catch-all), apps/web/src/components/openbooks/payroll/{PayrollModuleShell,PayrollOverview}.tsx (new), apps/web/src/lib/openbooks/payroll-nav.ts (new), apps/web/src/components/openbooks/AppScreen.tsx (retire /payroll branch), apps/web/src/lib/openbooks/content.ts (summary). BRIDGE the existing PayrollScreen under /payroll/{people,runs,statements} to keep e2e green until E6/E7.' },
  { id: 'E6', title: 'People workbench, employee detail & lifecycle UI', layer: 'frontend',
    owns: 'apps/web/src/components/openbooks/payroll/{PeopleWorkbench,EmployeeDetailSheet,EmployeeFormDialog}.tsx (new)' },
  { id: 'E7', title: 'Runs workbench, Generate flow & editable worksheet', layer: 'frontend',
    owns: 'apps/web/src/components/openbooks/payroll/{RunsWorkbench,GeneratePayrollDialog,RunWorksheetSheet}.tsx (new); replaces the bridge Runs tab + old card-per-row detail' },
  { id: 'E8', title: 'Statements & payslips UI + print route', layer: 'frontend',
    owns: 'apps/web/src/components/openbooks/payroll/{StatementsScreen,PayslipView}.tsx (new), apps/web/src/app/payroll/payslip/[lineId]/page.tsx (new print route)' },
  { id: 'E9', title: 'Insights UI + Payroll Settings UI', layer: 'frontend',
    owns: 'apps/web/src/components/openbooks/payroll/PayrollInsights.tsx (new), apps/web/src/components/openbooks/settings/PayrollSettingsSection.tsx (new), apps/web/src/lib/openbooks/settings-sections.ts (register payroll), apps/web/src/components/openbooks/SettingsScreen.tsx (branch), apps/web/src/components/openbooks/InsightsScreen.tsx (payroll tab reuses PayrollInsights)' },
  { id: 'E10', title: 'Integration, e2e, full gate-green & evidence', layer: 'integration',
    owns: 'tests/e2e/payroll-module.spec.ts (new; may extend modules.spec.ts / reports-payroll.spec.ts), docs/finishing/evidence/payroll-module/* (screenshots). Integration fixes only.' },
]

const SETUP_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['baseSha', 'branch', 'notes'],
  properties: {
    baseSha: { type: 'string', description: 'git rev-parse HEAD of the base before any epic.' },
    branch: { type: 'string' },
    notes: { type: 'string' },
  },
}

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['epicId', 'commitSha', 'filesChanged', 'whatChanged', 'dodSelfCheck', 'gates', 'ledgerSafety', 'backendChanges', 'risks'],
  properties: {
    epicId: { type: 'string' },
    commitSha: { type: 'string', description: 'git rev-parse HEAD after committing this epic.' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    whatChanged: { type: 'string' },
    dodSelfCheck: { type: 'array', items: { type: 'string' }, description: 'Each DoD item from the build-plan epic section + met/not-met + evidence.' },
    gates: {
      type: 'object', additionalProperties: false,
      required: ['typecheck', 'lint', 'unit', 'convex'],
      properties: {
        typecheck: { type: 'string', enum: ['green', 'failing', 'skipped'] },
        lint: { type: 'string', enum: ['green', 'failing', 'skipped'] },
        unit: { type: 'string', description: 'vitest result for the scoped suite (and convex/payroll.test.ts if relevant).' },
        convex: { type: 'string', description: 'npx convex dev --once result, or n/a if no convex change.' },
      },
    },
    ledgerSafety: { type: 'string', description: 'Confirm no client-side posting and no change to approveRun/markLinePaid/markRunPaid posting; integer minor units; posted entries immutable. n/a for pure-frontend epics with no ledger touch.' },
    backendChanges: { type: 'array', items: { type: 'string' }, description: 'Each convex/ change: file:line + what + why + auth note. Empty if none.' },
    risks: { type: 'array', items: { type: 'string' } },
  },
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['epicId', 'pass', 'dodChecklist', 'defects', 'ledgerSafety', 'risks'],
  properties: {
    epicId: { type: 'string' },
    pass: { type: 'boolean', description: 'true only if every DoD item is met and there is no blocker/high defect.' },
    dodChecklist: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['item', 'met', 'evidence'],
        properties: {
          item: { type: 'string' },
          met: { type: 'boolean' },
          evidence: { type: 'string', description: 'file:line in the committed diff, or why it is not met.' },
        },
      },
    },
    defects: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['severity', 'file', 'issue', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
          file: { type: 'string', description: 'path:line' },
          issue: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
    ledgerSafety: { type: 'string', description: 'Independent confirmation the diff adds no client posting / no change to the posting mutations / keeps integer minor units. n/a if the epic does not touch ledger or money.' },
    risks: { type: 'array', items: { type: 'string' } },
  },
}

const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['summary', 'findings', 'verdict'],
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['severity', 'file', 'issue', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
          file: { type: 'string', description: 'path:line' },
          issue: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
    verdict: { type: 'string', enum: ['pass', 'needs-fixes'] },
  },
}

const GATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['allGreen', 'results', 'failures', 'notes'],
  properties: {
    allGreen: { type: 'boolean' },
    results: {
      type: 'object', additionalProperties: false,
      required: ['typecheck', 'lint', 'build', 'unit', 'e2e', 'convex'],
      properties: {
        typecheck: { type: 'string', enum: ['green', 'failing'] },
        lint: { type: 'string', enum: ['green', 'failing'] },
        build: { type: 'string', enum: ['green', 'failing'] },
        unit: { type: 'string', enum: ['green', 'failing'] },
        e2e: { type: 'string', enum: ['green', 'failing', 'env-blocked'] },
        convex: { type: 'string', enum: ['green', 'failing'] },
      },
    },
    failures: { type: 'array', items: { type: 'string' }, description: 'Each failing command + the first error line(s).' },
    notes: { type: 'string', description: 'If e2e is env-blocked (no Convex deployment / dev server), say so honestly — do not claim green.' },
  },
}

function buildPrompt(epic, prevSha) {
  return [
    'You are the BUILD agent for ' + epic.id + ' (' + epic.title + ') of the OpenBooks Payroll module build, on branch ' + BRANCH + '.',
    'READ FIRST: ' + REPO + '/' + DESIGN_DOC + ' (the design) and ' + REPO + '/' + BUILD_DOC + ' — specifically the "' + epic.id + '" section, which holds your exact Tasks and Definition of Done. ' + SKILLS,
    'YOU OWN (edit only these, plus tests for them): ' + epic.owns,
    'The previous epic is committed at ' + prevSha + ' — build on top of it. Implement every Task in build-plan ' + epic.id + ' to satisfy every Definition-of-Done item.',
    RULES,
    GATES,
    'WORKFLOW: implement → run the SCOPED gates that apply to your epic (always pnpm typecheck + pnpm lint + pnpm test; plus npx convex dev --once if you touched convex/) and make them green for your scope → then COMMIT: git add -A && git commit -m "feat(payroll): ' + epic.id + ' ' + epic.title + '" → return git rev-parse HEAD as commitSha.',
    'You are the ONLY writer right now, so it is safe to run the gates against the working tree. Return the BUILD schema with your real gate results and an honest dodSelfCheck (every DoD item + met/not-met + evidence). If something is genuinely blocked, build what you can, FLAG it in risks, and still commit so the next epic can proceed.',
  ].join('\n\n')
}

function verifyPrompt(epic, fromSha, sha) {
  return [
    'You are the VERIFY agent for ' + epic.id + ' (' + epic.title + '). A build agent just committed this epic at ' + sha + ' (previous epic at ' + fromSha + '). Your job: independently confirm it meets its Definition of Done and find defects.',
    'CRITICAL — READ-ONLY GIT ARCHAEOLOGY. The NEXT epic is being built in the working tree RIGHT NOW, concurrently with you. You must NOT touch the working tree or HEAD: NEVER run git checkout / git switch / git reset / git stash / git restore / git commit, NEVER edit any file, and do NOT run pnpm / tsc / eslint / vitest / next / convex (those read the live, mid-edit working tree and will mislead you). Inspect ONLY the committed snapshot via: git diff ' + fromSha + '..' + sha + ' , git show ' + sha + ':<path> , and git log. Base your verdict purely on the committed diff and the file contents at ' + sha + '.',
    'CHECK against build-plan ' + epic.id + ' (read ' + REPO + '/' + BUILD_DOC + ' section ' + epic.id + ' and ' + REPO + '/' + DESIGN_DOC + '): every Definition-of-Done item (met/not-met with file:line evidence from the diff), the HARD RULES below, and any correctness/consistency defects. The build agent claimed its gates were green — sanity-check that the diff is consistent with that (e.g. types line up, imports exist, validators present), but do NOT re-run the suite.',
    RULES,
    'Return the VERDICT schema. pass=true ONLY if every DoD item is met and there is no blocker/high defect. Be adversarial but fair; cite file:line for every defect.',
  ].join('\n\n')
}

function repairPrompt(epic, defects) {
  return [
    'You are the REPAIR agent for ' + epic.id + ' (' + epic.title + '). Verification found this epic FAILED. All builds are now finished, so the working tree is stable and yours to edit.',
    'Fix every blocker/high defect and any clearly-correct medium/low one, editing the files owned by ' + epic.id + ' (' + epic.owns + ') plus their tests. Do not regress other epics.',
    'DEFECTS:\n' + JSON.stringify(defects, null, 1),
    RULES,
    GATES,
    'Then run pnpm typecheck + pnpm lint + pnpm test (and npx convex dev --once if convex/ changed); make them green. COMMIT: git add -A && git commit -m "fix(payroll): ' + epic.id + ' repair" → return commitSha. Return the BUILD schema.',
  ].join('\n\n')
}

function reverifyPrompt(epic, fromSha, sha) {
  return verifyPrompt(epic, fromSha, sha) + '\n\nNOTE: this is a RE-VERIFY after a repair commit. All builds are done; still stay READ-ONLY (no edits, no checkout) and judge the committed snapshot at ' + sha + '.'
}

phase('Setup')
const setup = await agent(
  [
    'You are the SETUP agent for the OpenBooks Payroll module build. Do NOT edit any application code.',
    'From ' + REPO + ': ensure a clean branch ' + BRANCH + ' exists off the current HEAD (if it already exists, check it out and reuse it). Then record git rev-parse HEAD as baseSha. Do not create commits.',
    'Return the SETUP schema (baseSha, branch="' + BRANCH + '", notes on starting state e.g. working-tree cleanliness).',
  ].join('\n\n'),
  { label: 'setup:branch', phase: 'Setup', schema: SETUP_SCHEMA },
)
const baseSha = setup && setup.baseSha ? setup.baseSha : 'HEAD'
log('Setup: branch ' + BRANCH + ' at baseSha ' + baseSha)

phase('Build')
const builds = []
const verifyPromises = []
let prevSha = baseSha
for (let i = 0; i < EPICS.length; i++) {
  const epic = EPICS[i]
  log('Build ' + epic.id + ' (' + (i + 1) + '/' + EPICS.length + '): ' + epic.title)
  const build = await agent(buildPrompt(epic, prevSha), { label: 'build:' + epic.id, phase: 'Build', schema: BUILD_SCHEMA })
  builds.push(build)
  const sha = build && build.commitSha ? build.commitSha : prevSha
  if (!build || !build.commitSha) log('WARN ' + epic.id + ': no commitSha returned (build may have failed); verifying ' + prevSha + '..HEAD range as-is')
  const fromSha = prevSha
  const epicRef = epic
  // Launch verification of THIS epic WITHOUT awaiting → it runs read-only against the
  // committed snapshot (fromSha..sha) while the NEXT epic's build mutates the working tree.
  verifyPromises.push(
    agent(verifyPrompt(epicRef, fromSha, sha), { label: 'verify:' + epicRef.id, phase: 'Verify', schema: VERDICT_SCHEMA })
      .then((v) => ({ epicId: epicRef.id, epic: epicRef, fromSha, sha, verdict: v }))
      .catch(() => ({ epicId: epicRef.id, epic: epicRef, fromSha, sha, verdict: null })),
  )
  prevSha = sha
}
const verdicts = await Promise.all(verifyPromises)
const failed = verdicts.filter((v) => v.verdict && v.verdict.pass === false)
log('Build+Verify done. ' + verdicts.filter((v) => v.verdict && v.verdict.pass).length + '/' + EPICS.length + ' epics passed; ' + failed.length + ' need repair.')

phase('Repair')
const repairs = []
for (const f of failed) {
  const defects = (f.verdict && f.verdict.defects) ? f.verdict.defects : []
  log('Repair ' + f.epicId + ': ' + defects.length + ' defect(s)')
  const rep = await agent(repairPrompt(f.epic, defects), { label: 'repair:' + f.epicId, phase: 'Repair', schema: BUILD_SCHEMA })
  const newSha = rep && rep.commitSha ? rep.commitSha : f.sha
  const reverdict = await agent(reverifyPrompt(f.epic, f.fromSha, newSha), { label: 'reverify:' + f.epicId, phase: 'Repair', schema: VERDICT_SCHEMA })
  repairs.push({ epicId: f.epicId, repair: rep, reverdict })
  log('Repair ' + f.epicId + ': re-verify pass=' + (reverdict && reverdict.pass))
}

phase('Review')
const review = await agent(
  [
    'You are the CODE-REVIEW agent for the completed OpenBooks Payroll module. All ten epics are built and verified on branch ' + BRANCH + '. The working tree is stable.',
    'Review the ENTIRE branch diff: git diff ' + baseSha + '..HEAD (and git log ' + baseSha + '..HEAD for the per-epic commits). Focus on correctness bugs, cross-epic integration seams, the ledger invariant (no client posting; approveRun/markLinePaid/markRunPaid posting unchanged; integer minor units; debits==credits), authz (payTo admin-only; entity scope), additive-schema safety, and clear simplification/reuse misses. You may run pnpm typecheck and pnpm test if useful, but do NOT rewrite features — this is a review.',
    RULES,
    'Return the REVIEW schema. Mark verdict "needs-fixes" if there is any blocker/high finding.',
  ].join('\n\n'),
  { label: 'code-review', phase: 'Review', schema: REVIEW_SCHEMA },
)
const blocking = (review && review.findings ? review.findings : []).filter((f) => f.severity === 'blocker' || f.severity === 'high')
log('Code review: ' + (review ? review.findings.length : 0) + ' findings (' + blocking.length + ' blocker/high); verdict ' + (review && review.verdict))
let reviewFix = null
if (blocking.length) {
  reviewFix = await agent(
    [
      'You are the REVIEW-FIX agent for the OpenBooks Payroll module on branch ' + BRANCH + '. Apply every blocker/high code-review finding (and any clearly-correct lower one), editing the payroll module files only and keeping all e2e testids.',
      'FINDINGS:\n' + JSON.stringify(blocking, null, 1),
      RULES, GATES,
      'Then run pnpm typecheck + pnpm lint + pnpm test (+ npx convex dev --once if convex/ changed); make them green. Commit: git add -A && git commit -m "fix(payroll): address code review". Return the BUILD schema.',
    ].join('\n\n'),
    { label: 'review-fix', phase: 'Review', schema: BUILD_SCHEMA },
  )
}

phase('Gate')
function gatePrompt(round) {
  return [
    'You are the GATE agent (round ' + round + ') for the OpenBooks Payroll module on branch ' + BRANCH + '. Run the AUTHORITATIVE full suite on HEAD and REPORT results — do not fix in this step.',
    'From ' + REPO + ' run, in order: pnpm typecheck ; pnpm lint ; pnpm build ; pnpm test ; npx convex dev --once ; pnpm test:e2e (Playwright auto-starts the web dev server on :3100; it needs a reachable Convex deployment + the auth env from .env.local — if it cannot start, report e2e as "env-blocked" with the reason, do NOT claim green).',
    'Return the GATE schema with each command result and the first error line(s) for any failure. allGreen=true only if typecheck/lint/build/unit/convex are green and e2e is green (env-blocked counts as NOT allGreen but is reported honestly).',
  ].join('\n\n')
}
let gate = await agent(gatePrompt(1), { label: 'final-gate', phase: 'Gate', schema: GATE_SCHEMA })
let gateRound = 0
while (gate && !gate.allGreen && gate.results && gate.results.e2e !== 'env-blocked' && gateRound < 2) {
  gateRound++
  log('Gate not green (round ' + gateRound + '): ' + (gate.failures || []).join(' | '))
  await agent(
    [
      'You are the GATE-REPAIR agent (round ' + gateRound + ') for the OpenBooks Payroll module on branch ' + BRANCH + '. The full suite is failing. Fix the failures, editing payroll module files only, keeping the ledger invariant and all e2e testids.',
      'FAILURES:\n' + JSON.stringify(gate.failures || [], null, 1) + '\nRESULTS: ' + JSON.stringify(gate.results || {}),
      RULES, GATES,
      'Make pnpm typecheck + pnpm lint + pnpm build + pnpm test + npx convex dev --once green (and pnpm test:e2e if it was failing for a real reason, not env). Commit: git add -A && git commit -m "fix(payroll): gate repair ' + gateRound + '". Return the BUILD schema.',
    ].join('\n\n'),
    { label: 'gate-repair-' + gateRound, phase: 'Gate', schema: BUILD_SCHEMA },
  )
  gate = await agent(gatePrompt(gateRound + 1), { label: 'final-gate-recheck-' + gateRound, phase: 'Gate', schema: GATE_SCHEMA })
}
log('Final gate: allGreen=' + (gate && gate.allGreen) + ' results=' + JSON.stringify(gate && gate.results))

phase('Report')
const reportContext = {
  branch: BRANCH, baseSha,
  epics: EPICS.map((e) => ({ id: e.id, title: e.title, layer: e.layer })),
  builds, verdicts: verdicts.map((v) => ({ epicId: v.epicId, pass: v.verdict && v.verdict.pass, defects: v.verdict && v.verdict.defects })),
  repairs, review, reviewFix, gate,
}
const report = await agent(
  [
    'You are the REPORT agent for the OpenBooks Payroll module build on branch ' + BRANCH + '. Write the build report to ' + REPO + '/' + REPORT_PATH + ' (create the evidence folder if needed) and return a tight summary + the file path.',
    'The report MUST contain, in this order: (1) a one-paragraph executive summary for Ansar (a non-engineer founder) — what shipped, is it functional, any honest gaps; (2) a per-epic table — id, title, build status, verify pass/fail, repairs applied, DoD coverage; (3) the full Definition-of-Done coverage from build-plan, marking each item met/not-met with evidence; (4) the code-review findings and how each was resolved; (5) the final gate results (every command: typecheck/lint/build/unit/e2e/convex) verbatim; (6) the Transactions-consistency checklist from ' + DESIGN_DOC + ' §12; (7) honest gaps & follow-ups (e.g. Plunk PLUNK_SECRET_KEY not set → payslip email "configured but unsent"; any e2e env-block; encryption-at-rest follow-up for payTo); (8) exact commands for Ansar to run the app and do real-world testing (pnpm dev:full, then the /payroll routes), and how to merge ' + BRANCH + '.',
    'Source data (use it, do not just echo it): ' + JSON.stringify(reportContext).slice(0, 18000),
    'Be honest and specific. If the gate is not fully green, say so plainly at the top. Keep it skimmable.',
  ].join('\n\n'),
  { label: 'final-report', phase: 'Report' },
)

return {
  branch: BRANCH,
  baseSha,
  epicsPassed: verdicts.filter((v) => v.verdict && v.verdict.pass).length,
  epicsTotal: EPICS.length,
  repaired: repairs.map((r) => r.epicId),
  reviewVerdict: review && review.verdict,
  gateAllGreen: gate && gate.allGreen,
  reportPath: REPORT_PATH,
  reportSummary: report,
}
