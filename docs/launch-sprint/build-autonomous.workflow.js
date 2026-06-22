// OpenBooks Launch Sprint — AUTONOMOUS single-branch build workflow
// =====================================================================
// Design contract (per Ansar, 2026-06-20):
//   * NO git worktrees. Every agent works in the ONE shared repo checkout on the
//     current branch (default: launch-sprint-build) and COMMITS as it goes, so
//     everything is tracked in one linear history.
//   * Because the tree is shared and mutable, file-writing agents MUST run
//     SEQUENTIALLY (two agents editing the same tree at once corrupts it). The
//     "two lanes" the user wants = a BUILD agent then a separate VERIFY/REPAIR
//     agent per batch; they are distinct roles, executed in order, not in
//     parallel. Read-only verification lenses inside a batch may run in parallel.
//   * One agent owns ~5 tickets (a batch). Batches run one after another in
//     dependency order. It is fine if this takes all night.
//   * The loop runs to completion autonomously; no human gate between batches.
//   * Each batch appends a JSON line to a progress feed so a live HTML artifact
//     can track it.
//
// Invoke (examples):
//   Workflow({ scriptPath: ".../build-autonomous.workflow.js",
//     args: { epics: ["E1","E2","E3"], skipTickets: [...], branch: "launch-sprint-build" } })
//   Workflow({ scriptPath: "...", args: { skipTickets: [...] } })   // all epics
//
// Source of truth read at runtime (by ABSOLUTE path; these live in the MAIN
// repo and are committed): docs/launch-sprint/backlog.json (ticket id, epic,
// title, files, dependsOn, size, risk) + docs/launch-sprint/epics/*.md (full
// ticket detail: changes, DoD, deliverables, verify) + reconciliation.md
// (PARTIAL tickets already have real code — EXTEND, don't recreate).

export const meta = {
  name: 'launch-sprint-autonomous-build',
  description: 'Autonomously build remaining OpenBooks launch-sprint tickets on one branch: plan ~5-ticket dependency-ordered batches, then per batch build→verify/repair→commit (no worktrees, sequential), append progress, finish with a full gate.',
  phases: [
    { title: 'Plan', detail: 'Read backlog.json + epic docs + reconciliation, drop already-done tickets, pack the rest into dependency-ordered batches of <=5 tickets each' },
    { title: 'Build', detail: 'Sequentially per batch: an implementer builds + commits, then a verifier re-checks the DoD, runs gates, repairs and re-commits; append a progress line' },
    { title: 'Gate', detail: 'Run the full suite (typecheck + lint + build + unit + convex tsc), summarize what landed and what is still red' },
  ],
}

const ROOT = '/Volumes/SSD/OpenBooks';
const BACKLOG = `${ROOT}/docs/launch-sprint/backlog.json`;
const RECON = `${ROOT}/docs/launch-sprint/reconciliation.md`;
const EPICS_DIR = `${ROOT}/docs/launch-sprint/epics`;
const PROGRESS = `${ROOT}/docs/launch-sprint/progress.ndjson`;

const REQUESTED = (args && Array.isArray(args.epics) && args.epics.length) ? args.epics : null; // null = all
const MAX_BATCH = (args && args.maxBatch) || 5;
const SKIP = (args && Array.isArray(args.skipTickets)) ? args.skipTickets : [];
const BRANCH = (args && args.branch) || 'launch-sprint-build';

const LEDGER_LAW = `NON-NEGOTIABLE accounting rules (real double-entry system):
- The ONLY writer of journalEntries/journalLines is convex/ledger.ts postLedgerEntryCore. Never insert/patch those tables directly elsewhere.
- Every posted entry balances (Σdebits === Σcredits); each line is debit XOR credit; money is integer minor units + currency (never floats).
- Posted entries are immutable: corrections REVERSE (exact inverse) and REPOST; never edit a posted entry. Respect period locks.
- Route AI/automation postings through the same single path with the proper system actor.`;

const COMMON = `You are working in the OpenBooks repo at ${ROOT}, ON BRANCH ${BRANCH}, in the SHARED checkout (NOT a worktree). node_modules is already installed — do NOT reinstall.
The launch-sprint specs are committed; read them by ABSOLUTE path: ${BACKLOG}, ${RECON}, and the epic docs under ${EPICS_DIR}/. Tickets marked PARTIAL in reconciliation.md already have real code on this branch — EXTEND it, do not recreate files/tables/functions that exist. Backlog line numbers may be stale; always re-locate symbols in the actual code.
Money is integer minor units + currency; never floats for stored amounts. Match surrounding code style. Keep changes scoped to the ticket's files where possible.`;

// ---- Schemas -------------------------------------------------------------
const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['batches', 'notes', 'totalTickets'],
  properties: {
    notes: { type: 'string' },
    totalTickets: { type: 'number' },
    batches: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['batchId', 'epic', 'ticketIds', 'epicDocs', 'highRisk', 'rationale'],
      properties: {
        batchId: { type: 'string', description: 'e.g. A1, A2 — sequential build order.' },
        epic: { type: 'string' },
        ticketIds: { type: 'array', items: { type: 'string' } },
        epicDocs: { type: 'array', items: { type: 'string' } },
        highRisk: { type: 'boolean', description: 'true if any ticket touches convex/ledger.ts or money math.' },
        rationale: { type: 'string' },
      },
    } },
  },
};

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['batchId', 'status', 'committed', 'commitSha', 'ticketResults', 'gates', 'summary'],
  properties: {
    batchId: { type: 'string' },
    status: { type: 'string', enum: ['green', 'partial', 'red'] },
    committed: { type: 'boolean' },
    commitSha: { type: 'string' },
    ticketResults: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['id', 'done', 'notes'],
      properties: { id: { type: 'string' }, done: { type: 'boolean' }, notes: { type: 'string' } },
    } },
    gates: { type: 'string' },
    summary: { type: 'string' },
  },
};

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['batchId', 'status', 'ticketVerdicts', 'gates', 'repairsCommitted', 'commitSha', 'findings'],
  properties: {
    batchId: { type: 'string' },
    status: { type: 'string', enum: ['green', 'partial', 'red'], description: 'green = every ticket DoD met AND gates pass.' },
    ticketVerdicts: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['id', 'dodMet', 'notes'],
      properties: { id: { type: 'string' }, dodMet: { type: 'boolean' }, notes: { type: 'string' } },
    } },
    gates: { type: 'string' },
    repairsCommitted: { type: 'boolean' },
    commitSha: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
  },
};

// ---- Phase 1: Plan -------------------------------------------------------
phase('Plan');
const plan = await agent(
  `${COMMON}
You are the build PLANNER. Read ${BACKLOG} (JSON array of {id, epic, title, files, dependsOn, size, risk}) and skim the epic docs under ${EPICS_DIR}/.
${REQUESTED ? `Plan ONLY these epics: ${REQUESTED.join(', ')}.` : 'Plan ALL epics in the backlog.'}
EXCLUDE these already-done ticket ids entirely (do not place them in any batch): ${SKIP.length ? SKIP.join(', ') : '(none)'}.
Produce a FLAT, dependency-ordered list of BATCHES that will be built ONE AT A TIME on a single branch:
- Each batch holds UP TO ${MAX_BATCH} tickets, normally from a SINGLE epic (keep a batch cohesive).
- Order batches so every ticket's dependsOn is satisfied by an EARLIER batch (or is already done). Foundational/credential/scope tickets (E2 categorizer, E3 unified credentials, E5 scope) must come before the UI epics that consume them.
- Since batches build sequentially in ONE tree, batches do NOT need disjoint files — order by dependency, not by file-disjointness.
- batchId = a short ascending label (A1, A2, A3, ...). Set highRisk:true if any ticket touches convex/ledger.ts or money math.
- epicDocs = absolute path(s) to the epic doc(s) that fully specify the batch's tickets.
Return the structured plan with totalTickets = count of tickets across all batches.`,
  { label: 'plan:batches', phase: 'Plan', schema: PLAN_SCHEMA },
);

const batches = (plan && plan.batches) || [];
log(`Planned ${batches.length} batches, ${plan ? plan.totalTickets : 0} tickets across ${REQUESTED ? REQUESTED.join('/') : 'all epics'}. Building sequentially on ${BRANCH}.`);

// ---- Phase 2: Build (STRICTLY SEQUENTIAL — shared tree) -------------------
phase('Build');
const results = [];
for (let i = 0; i < batches.length; i++) {
  const b = batches[i];
  const tag = `${b.batchId} (${b.epic}: ${b.ticketIds.join(' ')})`;
  log(`[${i + 1}/${batches.length}] Building ${tag}`);

  // -- Lane 1: implement + commit --
  const build = await agent(
    `${COMMON}
You are the IMPLEMENTER for batch ${b.batchId} — tickets: ${b.ticketIds.join(', ')} (epic ${b.epic}).
Read each ticket in full from: ${b.epicDocs.join(', ')}. For EACH ticket: make the 'Changes', satisfy EVERY 'Definition of done' checkbox, produce the 'Deliverables', and add/extend the tests its 'verify' recipe names.
${b.highRisk ? LEDGER_LAW : ''}
GATES (run before committing): \`pnpm verify\` (typecheck+lint+build+vitest). If you changed anything under convex/, also run \`npx convex dev --once\` to typecheck+push; if that fails for an ENVIRONMENT reason (node version for "use node", missing deploy creds), fall back to \`npx tsc -p convex/tsconfig.json\` and say so in gates — do NOT mark red for an env-only push limit. Fix REAL failures until green.
COMMIT your work on the current branch with a conventional message listing the ids, e.g. "feat(${b.batchId}): ${b.ticketIds.join(' ')}". Then append ONE line to ${PROGRESS} (create if missing) — a compact JSON object {"phase":"build","batchId":"${b.batchId}","epic":"${b.epic}","tickets":${JSON.stringify(b.ticketIds)},"status":"green|partial|red","sha":"<short>","ts":"<iso>","summary":"<one line>"} — and commit that too (message: "chore(progress): ${b.batchId} build").
Report the structured build result (commitSha = the code commit's short sha).`,
    { label: `build:${b.batchId}`, phase: 'Build', schema: BUILD_SCHEMA },
  );

  // -- Lane 2: independent verify + repair + commit (runs AFTER build; never concurrent) --
  let verify = null;
  if (build && build.committed) {
    verify = await agent(
      `${COMMON}
You are the independent VERIFIER for batch ${b.batchId} — tickets: ${b.ticketIds.join(', ')} (epic ${b.epic}). The implementer reported: ${build.summary}
Do NOT trust that report. Open each ticket's 'Definition of done' in ${b.epicDocs.join(', ')} and CHECK each checkbox against the actual committed code. Run the full gates yourself: \`pnpm verify\` and (if convex/ changed) \`npx convex dev --once\` or \`npx tsc -p convex/tsconfig.json\`. Run any test the ticket's verify names.
${b.highRisk ? 'This batch touches money/ledger. Additionally try to BREAK the invariants: every posted entry balances; only postLedgerEntryCore writes journal tables; corrections reverse-and-repost; no floats; Stripe clearing nets to zero; trial balance nets to zero. ' : ''}If you find a REAL defect or an unmet DoD item, FIX it yourself, re-run the gates, and COMMIT the repair (message: "fix(${b.batchId}): verify repair — <what>"). Keep changes minimal and scoped.
Then append ONE JSON line to ${PROGRESS}: {"phase":"verify","batchId":"${b.batchId}","epic":"${b.epic}","tickets":${JSON.stringify(b.ticketIds)},"status":"green|partial|red","sha":"<short>","ts":"<iso>","summary":"<one line>"} and commit it (message: "chore(progress): ${b.batchId} verify").
Return the structured verify result. status:green ONLY if every ticket DoD is met AND gates pass.`,
      { label: `verify:${b.batchId}`, phase: 'Build', schema: VERIFY_SCHEMA },
    );
  }

  results.push({ batch: b, build, verify });
}

// ---- Phase 3: Final gate -------------------------------------------------
phase('Gate');
const gate = await agent(
  `${COMMON}
You are the FINAL GATE for this wave. Run the complete suite from ${ROOT}: \`pnpm verify\` (typecheck+lint+build+unit) and \`npx tsc -p convex/tsconfig.json\`. Report pass/fail with the failing items quoted. If something is trivially broken by an integration seam between batches, fix it minimally and commit ("fix(gate): <what>"). Append a JSON line to ${PROGRESS} with phase:"gate" and the overall status, and commit it.
Return a single plain-text status report: which gates passed, total tests, and any remaining red.`,
  { label: 'gate:wave', phase: 'Gate' },
);

const built = results.filter((r) => r.build);
const greens = results.filter((r) => r.verify && r.verify.status === 'green');
const reds = results.filter((r) => !r.build || r.build.status === 'red' || (r.verify && r.verify.status === 'red'));
log(`Wave done: ${greens.length}/${batches.length} batches verified green; ${reds.length} need attention.`);

return {
  branch: BRANCH,
  epicsRequested: REQUESTED || 'all',
  planNotes: plan ? plan.notes : null,
  batchCount: batches.length,
  greenBatches: greens.map((r) => r.batch.batchId),
  attentionBatches: reds.map((r) => r.batch.batchId),
  batches: results.map((r) => ({
    batchId: r.batch.batchId,
    epic: r.batch.epic,
    tickets: r.batch.ticketIds,
    highRisk: r.batch.highRisk,
    buildStatus: r.build ? r.build.status : 'died',
    verifyStatus: r.verify ? r.verify.status : null,
    verifyFindings: r.verify ? r.verify.findings : [],
    summary: r.verify ? r.verify.summary : (r.build ? r.build.summary : 'agent died'),
  })),
  finalGate: gate,
};
