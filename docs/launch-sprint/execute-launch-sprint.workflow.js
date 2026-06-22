// OpenBooks Launch Sprint — execution workflow (team-of-agents builder)
// =====================================================================
// Run one WAVE of epics at a time. The workflow plans dependency-ordered,
// file-disjoint batches (3–4 tickets each), then for each round builds the
// batches in parallel (isolated git worktrees), verifies every ticket's
// Definition of Done, gives ledger/money tickets an extra adversarial
// verification, and reports per batch. A human (you) reviews each wave's
// report and integrates before launching the next wave.
//
// Invoke (examples):
//   Workflow({ scriptPath: ".../execute-launch-sprint.workflow.js",
//              args: { epics: ["E1","E2","E3"] } })            // Wave 1
//   Workflow({ scriptPath: "...", args: { epics: ["E4","E5","E11"], maxBatch: 4 } })
//   Workflow({ scriptPath: "..." })                              // default: all epics
//
// Source of truth read at runtime: docs/launch-sprint/backlog.json (ticket
// id, epic, files, dependsOn, size, risk) + the per-epic docs under
// docs/launch-sprint/epics/ (full ticket detail: changes, DoD, verify).

export const meta = {
  name: 'execute-launch-sprint',
  description: 'Build a wave of OpenBooks launch-sprint epics: plan batches → implement (worktrees) → verify DoD + gates → adversarially verify ledger tickets → report',
  phases: [
    { title: 'Plan', detail: 'Read backlog.json, filter to the requested epics, topo-sort by deps, pack file-disjoint batches into dependency rounds' },
    { title: 'Build', detail: 'Per round: implement each batch in an isolated worktree, run gates, verify DoD, adversarially verify ledger/money tickets' },
    { title: 'Report', detail: 'Per-batch green/red status, branches, what landed, what is blocked, and the integration order' },
  ],
}

const REQUESTED = (args && Array.isArray(args.epics) && args.epics.length) ? args.epics : null; // null = all
const MAX_BATCH = (args && args.maxBatch) || 4;
const SKIP_TICKETS = (args && Array.isArray(args.skipTickets)) ? args.skipTickets : []; // already-done on the branch
const LAUNCH_TIP = (args && args.launchTip) || '9b5154d'; // codex/real-world-testing tip. Worktrees MUST build on THIS, not the harness default base (a prior run forked from a 20-commit-stale snapshot and produced unmergeable work).
const ROOT = '/Volumes/SSD/OpenBooks';
const BACKLOG = `${ROOT}/docs/launch-sprint/backlog.json`;

const LEDGER_LAW = `NON-NEGOTIABLE accounting rules (this is a real double-entry system):
- The ONLY writer of journalEntries/journalLines is convex/ledger.ts postLedgerEntryCore. Never insert/patch those tables directly from anywhere else.
- Every posted entry must balance (Σdebits === Σcredits) and each line is a clean debit XOR credit; money is integer minor units + currency (never floats).
- Posted entries are immutable: corrections REVERSE (exact inverse) and REPOST; never edit a posted entry.
- Respect period locks; route AI/automation postings through the same single path with the proper system actor.
- After any convex/ change you MUST run \`npx convex dev --once\` (it typechecks + pushes); \`pnpm verify\` does NOT typecheck Convex.`;

// ---- Schemas -------------------------------------------------------------
const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['rounds', 'notes'],
  properties: {
    notes: { type: 'string', description: 'How batches were packed and any cross-epic ordering decisions.' },
    rounds: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['round', 'batches'],
      properties: {
        round: { type: 'number' },
        batches: { type: 'array', items: {
          type: 'object', additionalProperties: false,
          required: ['batchId', 'ticketIds', 'epicDocs', 'files', 'highRisk', 'rationale'],
          properties: {
            batchId: { type: 'string' },
            ticketIds: { type: 'array', items: { type: 'string' } },
            epicDocs: { type: 'array', items: { type: 'string' }, description: 'Relative paths to the epic docs that contain these tickets.' },
            files: { type: 'array', items: { type: 'string' }, description: 'Union of files this batch will touch (must be disjoint from sibling batches in the same round).' },
            highRisk: { type: 'boolean', description: 'true if any ticket touches convex/ledger.ts or money math.' },
            rationale: { type: 'string' },
          },
        } },
      },
    } },
  },
};

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['batchId', 'status', 'branch', 'ticketResults', 'gates', 'summary'],
  properties: {
    batchId: { type: 'string' },
    status: { type: 'string', enum: ['green', 'partial', 'red'] },
    branch: { type: 'string', description: 'Git branch/worktree the work is committed on (or "" if not committed).' },
    ticketResults: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['id', 'done', 'notes'],
      properties: { id: { type: 'string' }, done: { type: 'boolean' }, notes: { type: 'string' } },
    } },
    gates: { type: 'string', description: 'Result of pnpm verify + npx convex dev --once + named ticket tests.' },
    summary: { type: 'string' },
  },
};

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['batchId', 'invariantsHold', 'findings'],
  properties: {
    batchId: { type: 'string' },
    invariantsHold: { type: 'boolean' },
    findings: { type: 'array', items: { type: 'string' } },
  },
};

// ---- Phase 1: Plan -------------------------------------------------------
phase('Plan');
const plan = await agent(
  `You are the build planner for the OpenBooks launch sprint. Read ${BACKLOG} (JSON array of {id, epic, title, files, dependsOn, size, risk}) and the relevant epic docs under ${ROOT}/docs/launch-sprint/epics/.
${REQUESTED ? `Build ONLY these epics: ${REQUESTED.join(', ')}.` : 'Build ALL epics in the backlog.'}
${SKIP_TICKETS.length ? `EXCLUDE these tickets entirely — they are ALREADY DONE on the current branch; do NOT place them in any batch or round: ${SKIP_TICKETS.join(', ')}.` : ''}
Produce dependency-ordered ROUNDS of file-disjoint BATCHES:
- Each batch has ${MAX_BATCH} tickets max, all from work that can proceed now (every dependsOn ticket is in an EARLIER round or already done).
- Within a round, no two batches may share a file (so they can build in parallel worktrees without conflict). Across rounds, ordering enforces dependsOn.
- Set highRisk:true for any batch containing a ticket whose risk is 'high' or whose files include convex/ledger.ts / money math.
- epicDocs = the relative epic-doc path(s) (e.g. docs/launch-sprint/epics/E01-....md) where each batch's tickets are fully specified.
Return the structured plan. Prefer fewer rounds; pack aggressively but keep files disjoint within a round.`,
  { label: 'plan:batches', phase: 'Plan', schema: PLAN_SCHEMA },
);

const rounds = (plan && plan.rounds) || [];
log(`Planned ${rounds.length} rounds, ${rounds.reduce((n, r) => n + r.batches.length, 0)} batches for ${REQUESTED ? REQUESTED.join('/') : 'all epics'}.`);

// ---- Phase 2: Build (rounds sequential; batches within a round in parallel)
phase('Build');
const allReports = [];
for (const r of rounds) {
  log(`Round ${r.round}: ${r.batches.length} batch(es) in parallel.`);
  const roundReports = await parallel(r.batches.map((b) => async () => {
    // Implement the batch in an isolated worktree.
    const build = await agent(
      `You are an implementer on the OpenBooks launch sprint, building batch ${b.batchId}.
FIRST — pin your isolated worktree to the launch tip so you build on CURRENT work, not a stale snapshot. Run \`git reset --hard ${LAUNCH_TIP}\`, then VERIFY the base: \`git merge-base --is-ancestor c23dc4c HEAD\` MUST succeed AND \`convex/connections.ts\` MUST exist. If either check fails, STOP immediately and return status:"red" with gates explaining the base is wrong — do NOT build on a stale base (a prior run silently forked from a 20-commit-old snapshot and every batch was unmergeable).
SECOND — the launch-sprint specs are NOT committed, so they do NOT exist inside your reset worktree; read them from the MAIN repo by ABSOLUTE path. Read ${ROOT}/docs/launch-sprint/reconciliation.md and find your ticket ids in it. Tickets marked PARTIAL already have real code on this branch (the doc cites exact file:line) — EXTEND that code and finish the missing DoD items; do NOT recreate files, tables, or functions that already exist. Backlog line-numbers may be stale vs the current tip, so always re-locate symbols in the actual code.
Tickets to implement (full detail is in these epic docs in the MAIN repo — READ each by ABSOLUTE path and find each ticket by id): ${b.epicDocs.map((d) => `${ROOT}/${d.replace(/^\/?(Volumes\/SSD\/OpenBooks\/)?/, '')}`).join(', ')}.
Ticket ids: ${b.ticketIds.join(', ')}.
For EACH ticket: make the 'Changes', satisfy every 'Definition of done' checkbox, and produce the 'Deliverables'. Match the surrounding code style. Add/extend tests as the ticket's verify recipe requires.
${b.highRisk ? LEDGER_LAW : 'Keep money as integer minor units + currency; never use floats for stored amounts.'}
Your worktree is freshly checked out with NO node_modules (it is gitignored) — run \`pnpm install\` before any build/test step (the pnpm store is shared, so it is fast). When done, run the gates: \`pnpm verify\` (typecheck+lint+build+vitest) and, if you changed anything under convex/, \`npx convex dev --once\` to typecheck+push Convex. If \`npx convex dev --once\` fails for an ENVIRONMENT reason (e.g. unsupported Node version for "use node" actions, or no deployment creds), fall back to \`npx tsc -p convex/tsconfig.json\` to typecheck Convex and say so in gates — do NOT report the batch red for an environment-only Convex-push limitation. Run any test named in a ticket's verify. Fix real failures until green (or honestly report what is red).
Commit your work with a conventional message listing the ticket ids (e.g. "feat(${b.batchId}): E1-T1 E1-T2 ..."). Report the branch you committed on.
Return the structured build report.`,
      { label: `build:${b.batchId}`, phase: 'Build', schema: BUILD_SCHEMA, isolation: 'worktree' },
    );
    if (!build) return { batch: b, build: null, verdict: null };
    // Ledger/money batches get an independent adversarial verification.
    let verdict = null;
    if (b.highRisk && build.status !== 'red' && build.branch) {
      verdict = await agent(
        `You are an adversarial accounting verifier. Batch ${b.batchId} (branch ${build.branch}) changed ledger/money code for tickets ${b.ticketIds.join(', ')}.
Independently inspect the committed changes and TRY TO BREAK the invariants: (1) every posted entry balances Σdebits===Σcredits; (2) only postLedgerEntryCore writes journalEntries/journalLines; (3) corrections reverse-and-repost (exact inverse), never edit; (4) no floats in stored money; (5) the per-payout Stripe clearing nets to zero; (6) trial balance still nets to zero on a mixed book. Default to invariantsHold:false if anything is unproven. Return the verdict.`,
        { label: `verify:${b.batchId}`, phase: 'Build', schema: VERDICT_SCHEMA },
      );
    }
    return { batch: b, build, verdict };
  }));
  allReports.push({ round: r.round, reports: roundReports.filter(Boolean) });

  // Stop the wave if a round produced a red batch or a broken ledger invariant — a human should look.
  const broke = roundReports.filter(Boolean).some((x) =>
    (x.build && x.build.status === 'red') || (x.verdict && x.verdict.invariantsHold === false));
  if (broke) {
    log(`Round ${r.round} has a red batch or a failed ledger invariant — pausing the wave for human review.`);
    break;
  }
}

// ---- Phase 3: Report -----------------------------------------------------
phase('Report');
const flat = allReports.flatMap((rr) => rr.reports);
const green = flat.filter((x) => x.build && x.build.status === 'green' && (!x.verdict || x.verdict.invariantsHold !== false));
const blocked = flat.filter((x) => !x.build || x.build.status === 'red' || (x.verdict && x.verdict.invariantsHold === false));
log(`Wave done: ${green.length} green batch(es), ${blocked.length} blocked. Review reports, then merge green branches in round order before the next wave.`);

return {
  epicsRequested: REQUESTED || 'all',
  plan: plan ? plan.notes : null,
  rounds: allReports.map((rr) => ({
    round: rr.round,
    batches: rr.reports.map((x) => ({
      batchId: x.batch.batchId,
      tickets: x.batch.ticketIds,
      highRisk: x.batch.highRisk,
      status: x.build ? x.build.status : 'died',
      branch: x.build ? x.build.branch : '',
      invariantsHold: x.verdict ? x.verdict.invariantsHold : null,
      findings: x.verdict ? x.verdict.findings : [],
      summary: x.build ? x.build.summary : 'agent died',
    })),
  })),
  greenBatches: green.map((x) => x.batch.batchId),
  blockedBatches: blocked.map((x) => x.batch.batchId),
  integrationOrder: 'Merge green branches in ascending round order; within a round any order is safe (files are disjoint). Re-run the full gate after each round merges.',
};
