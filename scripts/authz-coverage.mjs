#!/usr/bin/env node
// E14-T5 — Authz coverage audit.
//
// Enumerate every exported Convex function (query/mutation/action and their
// internal* variants + httpAction) across convex/*.ts and classify each as:
//   - authorized          — its body (or a same-file helper it calls, one level
//                            deep) calls a server-side authorization guard, OR
//                            it is an action that delegates to a guarded
//                            query/mutation via ctx.runQuery/runMutation.
//   - intentionally-public — explicitly allow-listed below with a rationale
//                            (landing/request-access, invite-token lookup,
//                            internal-only functions reached only through a
//                            guarded caller / scheduler / signature-verified
//                            webhook, and the read-only demo path).
//   - FINDING             — a NEW exported function that is neither guarded nor
//                            allow-listed. The script exits non-zero on any
//                            FINDING so CI catches an un-triaged function.
//
// Run:  node scripts/authz-coverage.mjs            (prints summary, exits 0/1)
//       node scripts/authz-coverage.mjs --markdown (emit the matrix table)
//
// The matrix table is pasted into docs/finishing/security-audit.md.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const convexDir = resolve(here, "..", "convex");

// Direct server-side authorization guards (convex/authz.ts + per-module guards
// that wrap them). A function whose body calls any of these re-checks
// workspace/entity authorization on the server.
const GUARDS = [
  "requireUserId",
  "requireWorkspaceRole",
  "requireWorkspacePermission",
  "requireAnyWorkspaceRole",
  "requireAnyWorkspacePermission",
  "authorizeThreadAccess",
  "getEntityForWrite",
  "getEntityForRead",
  "getEntityForAdmin",
  "getActiveEntity",
  "getEntity(",
  "requireEntity",
  "requireEntityForAdmin",
  "requireEntityAdmin",
  "requireEntityAccess",
  "requireTransactionForAdmin",
  "requireTransactionForSystemActor",
  "requireSystemSyncActor",
  "requireWorkspaceRoleForActive",
  "assertWorkspaceMember",
  "authorizeCategorizationRead",
  "authorizeEntityForConnections",
];

// Actions cannot read the db directly; they delegate to guarded
// queries/mutations. A delegation call is therefore an authorization seam.
const DELEGATE = ["ctx.runQuery", "ctx.runMutation", "ctx.runAction"];

// Cross-file helpers that themselves call a guard. A function whose body calls
// one of these re-checks authorization just as if it inlined the guard. These
// are EXPORTED helper functions (not Convex functions), audited once here so the
// matrix does not need to re-allow-list every caller. Each entry must point at a
// helper that demonstrably calls a server-side guard (verified in review).
const GUARD_HELPERS = [
  "resolveActiveEntity", // activeEntity.ts → requireAnyWorkspaceRole / requireWorkspaceRole
  "resolveDefaultEntity", // activeEntity.ts → requires membership
  "runWorkspaceReset", // workspaceReset.ts → delegates to requireAnyWorkspacePermission("workspace.reset")
];

// Intentionally-public / authorized-by-caller functions. Each MUST carry a
// rationale. `category` is the matrix column the function lands in.
//   - "intentionally-public": anonymous-by-design public surface.
//   - "authorized": internal-only (not client-callable) and authorized by its
//     guarded caller / scheduler / signature-verified webhook, OR an action
//     that delegates through a helper to a guarded query/mutation.
const ALLOW_LIST = {
  // Anonymous-by-design public surface.
  "requestAccess.ts:submit":
    ["intentionally-public", "Landing 'request access' form — accepts an email from an unauthenticated visitor by design (rate/format validated, write-only)."],
  "team.ts:lookupInvite":
    ["intentionally-public", "Invitee with no session looks up their pending invite by a 32+ char unguessable token; the token is the capability (returns invalid for short/unknown tokens)."],

  // Ask-AI agent read tools — internalQuery, called only from the streaming
  // action AFTER authorizeThreadAccess derives the thread's entity. The
  // thread-ownership row is the authorization boundary (same pattern as
  // reportViews.reportPackForEntity).
  "agentToolQueries.ts:queryTransactionsForEntity": ["authorized", "internalQuery; entity is resolved + authorized from the thread ownership row before this runs."],
  "agentToolQueries.ts:getBalancesForEntity": ["authorized", "internalQuery; thread-ownership-authorized caller (Ask-AI read tool)."],
  "agentToolQueries.ts:searchContactsForEntity": ["authorized", "internalQuery; thread-ownership-authorized caller (Ask-AI read tool)."],
  "agentToolQueries.ts:getPayrollRunsForEntity": ["authorized", "internalQuery; thread-ownership-authorized caller (Ask-AI read tool)."],
  "reportViews.ts:reportPackForEntity": ["authorized", "internalQuery; entityId is the thread-ownership-derived authorization boundary (documented in reportViews.ts)."],
  "aiThreads.ts:threadContext": ["authorized", "internalQuery; reached only after authorizeThreadAccess in the streaming action."],
  "aiThreads.ts:generateResponse": ["authorized", "internalAction; scheduled only by a thread-ownership-authorized mutation."],
  "aiThreads.ts:testStreamWithMock": ["authorized", "internalAction; test-only mock stream, internal-only."],

  // Categorization batch — internalQuery guarded via authorizeCategorizationRead;
  // the public action delegates to it through runCategorizationBatch.
  "ai.ts:holdoutTransactionResult": ["authorized", "internalQuery; called only by the workspace-guarded holdout eval action."],
  "ai.ts:recordHoldoutCategorizationEvalRun": ["authorized", "internalMutation; called only by the workspace-guarded holdout eval action."],
  "bedrockCategorizer.ts:categorizePendingTransactions": ["authorized", "action delegates to runCategorizationBatch -> ctx.runQuery(internal.ai.categorizationBatchCandidates), which guards via authorizeCategorizationRead."],
  "semanticMemory.ts:proposeCategorizationMemory": ["authorized", "internalAction; scheduled only by the guarded categorization pipeline."],

  // Connections internals — invoked only by guarded connection mutations or by
  // the signature-verified Stripe webhook/OAuth callback.
  "connections.ts:getActiveCredentialForEntity": ["authorized", "internalQuery; read by guarded sync actions and signature-verified webhook only."],
  "connections.ts:listStripeWebhookCredentialCandidates": ["authorized", "internalQuery; read by the signature-verified Stripe webhook to find the matching credential."],
  "connections.ts:createStripeOAuthState": ["authorized", "internalMutation; written by a guarded connect mutation."],
  "connections.ts:claimStripeOAuthState": ["authorized", "internalMutation; claimed by the OAuth redirect (state nonce is the capability)."],

  // Plaid sync internals — scheduler/cron + signature-verified webhook driven.
  "plaid.ts:listActiveSyncTargets": ["authorized", "internalQuery; read by the sync cron only."],
  "plaid.ts:claimPlaidItemSync": ["authorized", "internalMutation; sync-lock claim, driven by the sync cron."],
  "plaid.ts:releasePlaidItemSync": ["authorized", "internalMutation; sync-lock release, driven by the sync cron."],

  // Real-test reset job rows — written only by the workspace.reset-guarded
  // startFullRebuild action.
  "realTestReset.ts:createJob": ["authorized", "internalMutation; written only by the reset action gated on workspace.reset."],
  "realTestReset.ts:markJobRunning": ["authorized", "internalMutation; reset job progress, written by the guarded reset action."],
  "realTestReset.ts:completeJob": ["authorized", "internalMutation; reset job progress, written by the guarded reset action."],
  "realTestReset.ts:failJob": ["authorized", "internalMutation; reset job progress, written by the guarded reset action."],
  "realTestReset.ts:deleteBatch": ["authorized", "internalMutation; batch delete, written only by the guarded reset action."],

  // Owner bootstrap — internal, run once to materialize the owner workspace.
  "authAdmin.ts:ensureOwnerWorkspace": ["authorized", "internalMutation; owner-bootstrap, invoked from the auth callback for the configured owner email."],

  // Stripe webhook dedupe — written only by the signature-verified webhook.
  "stripeWebhook.ts:recordEvent": ["authorized", "internalMutation; written only by the signature-verified Stripe webhook handler (event-id dedupe)."],

  // Demo seeding — internal-only writers driven by the guarded seed action.
  "seedDemo.ts:beginSeedJob": ["authorized", "internalMutation; demo seed job, written by the guarded seed action."],
  "seedDemo.ts:heartbeatSeedJob": ["authorized", "internalMutation; demo seed progress."],
  "seedDemo.ts:finishSeedJob": ["authorized", "internalMutation; demo seed progress."],
  "seedDemo.ts:getSeedJob": ["authorized", "internalQuery; demo seed progress read."],
  "seedDemo.ts:resetDemoEntity": ["authorized", "internalMutation; demo entity reset, internal-only."],
  "seedDemo.ts:recordInvoice": ["authorized", "internalMutation; demo seed writer, internal-only."],
  "seedDemo.ts:recordBill": ["authorized", "internalMutation; demo seed writer, internal-only."],
  "seedDemo.ts:recordPayrollRun": ["authorized", "internalMutation; demo seed writer, internal-only."],
  "seedDemo.ts:recordStripePayout": ["authorized", "internalMutation; demo seed writer, internal-only."],
  "seedDemo.ts:recordDocumentsAndInbox": ["authorized", "internalMutation; demo seed writer, internal-only."],
  "seedDemo.ts:recordSeedRun": ["authorized", "internalMutation; demo seed writer, internal-only."],
  "seedDemo.ts:assertWorkspaceNotDemo": ["authorized", "internalMutation; demo-guard helper invoked only by the guarded seed/reset actions before a non-demo write."],

  // Public no-login demo READ path (E11). Intentionally anonymous + read-only:
  // the workspace is resolved entirely server-side via the registry
  // (demoKind === 'public'), never from a client id, and can ONLY return the
  // public demo workspace. There is no demo mutation; demo writes are blocked by
  // assertNotDemoWrite on every workspace-scoped mutation.
  "demo.ts:demoView": ["intentionally-public", "Read-only public /demo route; server-resolves the demoKind==='public' workspace only — never a real workspace, never a write."],
  "demo.ts:demoContext": ["intentionally-public", "Read-only public /demo context; server-resolved public demo workspace only."],
  "demo.ts:demoDashboard": ["intentionally-public", "Read-only public /demo dashboard summary; server-resolved public demo workspace only."],

  // Static BYO provider catalog (E3-T4) — no secrets, no workspace data; the
  // settings UI reads the public list of supported AI providers/models.
  "aiCatalog.ts:list": ["intentionally-public", "Static provider catalog (id/label/models/keysUrl); contains no secrets and no per-workspace data."],

  // Unified credential resolver (E3). internalQuery read ONLY by the guarded
  // credential resolvers / runtimes via ctx.runQuery(internal.credentials.*);
  // the public saveCredential/deleteCredential/credentialStatus functions are
  // workspace-guarded (they appear as `authorized` in the matrix).
  "credentials.ts:getActiveCredential": ["authorized", "internalQuery; read only by guarded AI/Plaid/Stripe/Plunk resolvers + signature-verified webhook — never client-callable."],

  // Provider-agnostic AI resolver internals (E3). internalQuery/internalAction
  // reached only from the categorize/CFO/chat runtimes, which run under a guarded
  // client entrypoint or scheduled internal-authorized caller. The client-facing
  // testProviderConnection action re-checks workspace membership (E14-T5).
  "aiResolve.ts:getWorkspaceAiConfig": ["authorized", "internalQuery; AI config read by the resolver, reached only via guarded/internal runtimes."],
  "aiCategorizeRuntime.ts:resolveCategorizeReadiness": ["authorized", "internalAction; categorize-readiness probe scheduled only by the guarded categorize pipeline."],
  "aiCategorizeRuntime.ts:generateCategorizationText": ["authorized", "internalAction; model call scheduled only by the guarded categorize pipeline."],
  "agentToolQueries.ts:getCfoSignalsForEntity": ["authorized", "internalQuery; Ask-AI read tool, reached only after authorizeThreadAccess resolves the thread's entity."],

  // Connections internals (E3 unified). internalQuery/internalMutation invoked
  // only by guarded connect/sync actions, the sync cron, the signature-verified
  // Stripe webhook, or run-once operator maintenance via `npx convex run`.
  "connections.ts:collapseWorkspacePlaidCredentials": ["authorized", "internalMutation; one-off credential-collapse maintenance, run by an operator via `npx convex run`, not client-callable."],
  "connections.ts:getWorkspacePlaidCredentialByEntity": ["authorized", "internalQuery; read by guarded Plaid sync actions only."],
  "connections.ts:markStripeWebhookSignatureFailure": ["authorized", "internalMutation; written only by the signature-verified Stripe webhook handler."],
  "connections.ts:markStripeWebhookDelivery": ["authorized", "internalMutation; written only by the signature-verified Stripe webhook handler."],
  "connections.ts:markStripeCredentialValidated": ["authorized", "internalMutation; written only by the guarded Stripe credential validation action."],

  // Embedding store (E2). internalQuery/internalMutation reached only by the
  // guarded semantic-memory recall/correction pipeline.
  "embeddingsStore.ts:getCorrectionMemoryForEmbedding": ["authorized", "internalQuery; read by the guarded correction-embedding pipeline only."],
  "embeddingsStore.ts:getMemoryEmbeddingRow": ["authorized", "internalQuery; read by the guarded recall pipeline only."],
  "embeddingsStore.ts:upsertMemoryEmbedding": ["authorized", "internalMutation; written by the guarded correction/recall pipeline only."],

  // Ledger period-lock internal (E1) — written only by guarded callers
  // (seedDemo bootstrap; the public setPeriodLock mutation is workspace-guarded).
  "ledger.ts:setPeriodLockInternal": ["authorized", "internalMutation; period-lock writer reached only via guarded callers (the public setPeriodLock is workspace-guarded)."],

  // Eval-capable-entities scan (E2) — internalMutation reached only by the
  // workspace-guarded categorization-eval action.
  "ai.ts:listEvalCapableEntities": ["authorized", "internalMutation; reached only by the workspace-guarded categorization eval action."],

  // Onboarding proposal signals (E4) — internalQuery read only by the guarded
  // generateOnboardingProposals action.
  "onboardingProposals.ts:gatherOnboardingSignals": ["authorized", "internalQuery; read only by the guarded onboarding-proposals action."],

  // Payroll FX rate persistence (E10) — internalMutation written only by the
  // guarded markLinePaid/payroll flow.
  "payroll.ts:persistFxRate": ["authorized", "internalMutation; written only by the guarded payroll pay flow (markLinePaid)."],

  // Plaid disconnect internals — internalQuery/internalMutation reached only by
  // the guarded disconnect action.
  "plaid.ts:getPlaidItemForDisconnect": ["authorized", "internalQuery; read only by the guarded Plaid disconnect action."],
  "plaid.ts:markPlaidItemDisconnected": ["authorized", "internalMutation; written only by the guarded Plaid disconnect action."],

  // Public-demo provisioning + daily-reset internals (E11) — internalMutation
  // driven by the demo-provisioning action + the reset cron, never client-called.
  "publicDemo.ts:wipePublicDemoBatch": ["authorized", "internalMutation; batch wipe driven by the demo-reset cron, not client-callable."],
  "publicDemo.ts:recordPublicDemoReset": ["authorized", "internalMutation; reset audit row written by the demo-reset cron."],

  // Global dev rebuild (E11-T7) — owner/dev-only, gated behind
  // OPENBOOKS_REAL_TEST_RESET_ENABLED=1 + a fixed confirmation phrase + an
  // OWNER_EMAIL match; off in any normal deployment and never a workspace-scoped
  // tenant operation (it rebuilds the single owner workspace from empty).
  "realTestReset.ts:finalizeZ360Only": ["authorized", "owner/dev rebuild mutation gated on OPENBOOKS_REAL_TEST_RESET_ENABLED + confirmation phrase + OWNER_EMAIL; off by default, not a tenant operation."],
  "realTestReset.ts:recordGlobalResetAudit": ["authorized", "internalMutation; global-reset audit row written only by the env+confirmation-gated rebuild action."],

  // Weekly digest internals (E9) — internalQuery/internalMutation driven only by
  // the weekly-digest cron, never client-callable.
  "weeklyDigestData.ts:composeDigest": ["authorized", "internalQuery; digest composition read by the weekly-digest cron only."],
  "weeklyDigestData.ts:digestEnabledWorkspaces": ["authorized", "internalQuery; enabled-workspace scan read by the weekly-digest cron only."],
  "weeklyDigestData.ts:claimDigestWeek": ["authorized", "internalMutation; per-week claim written by the weekly-digest cron only."],
  "weeklyDigestData.ts:recordDigestOutcome": ["authorized", "internalMutation; delivery outcome written by the weekly-digest cron only."],

  // Factory-reset job row (E11-T3) — internalMutation written only by the
  // workspace.reset-guarded runWorkspaceReset action.
  "workspaceReset.ts:startResetJob": ["authorized", "internalMutation; reset-job row written only by the workspace.reset-guarded reset action."],
};

function listFunctionStarts(src) {
  const fns = [];
  let m;
  let re = /(?:export\s+)?(?:async\s+)?function (\w+)\s*\(/g;
  while ((m = re.exec(src))) fns.push({ name: m[1], idx: m.index });
  re = /const (\w+)\s*=\s*(?:async\s*)?\(/g;
  while ((m = re.exec(src))) fns.push({ name: m[1], idx: m.index });
  fns.sort((a, b) => a.idx - b.idx);
  return fns;
}

function bodyOf(src, fns, i) {
  const start = fns[i].idx;
  const end = i + 1 < fns.length ? fns[i + 1].idx : src.length;
  return src.slice(start, end);
}

function classify() {
  const files = readdirSync(convexDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.startsWith("_"))
    .sort();

  const rows = [];
  for (const file of files) {
    const src = readFileSync(resolve(convexDir, file), "utf8");
    const helpers = listFunctionStarts(src);
    const helperGuarded = new Map();
    for (let i = 0; i < helpers.length; i++) {
      const body = bodyOf(src, helpers, i);
      // A same-file helper counts as an authorization seam when it calls a
      // direct guard, a known cross-file guard helper, OR delegates to a guarded
      // Convex function via ctx.runQuery/runMutation/runAction (e.g.
      // workspaceReset.runWorkspaceReset → internal.workspaceReset.* guards).
      const seam =
        GUARDS.some((g) => body.includes(g)) ||
        GUARD_HELPERS.some((h) => new RegExp("\\b" + h + "\\s*\\(").test(body)) ||
        DELEGATE.some((d) => body.includes(d));
      helperGuarded.set(helpers[i].name, seam);
    }

    const re = /export const (\w+) = (query|mutation|action|internalQuery|internalMutation|internalAction|httpAction)\(/g;
    const matches = [];
    let m;
    while ((m = re.exec(src))) matches.push({ name: m[1], kind: m[2], idx: m.index });

    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].idx;
      const end = i + 1 < matches.length ? matches[i + 1].idx : src.length;
      const body = src.slice(start, end);
      const key = `${file}:${matches[i].name}`;

      let guarded =
        GUARDS.some((g) => body.includes(g)) ||
        DELEGATE.some((d) => body.includes(d)) ||
        GUARD_HELPERS.some((h) => new RegExp("\\b" + h + "\\s*\\(").test(body));
      if (!guarded) {
        for (const [hn, hg] of helperGuarded) {
          if (hg && new RegExp("\\b" + hn + "\\s*\\(").test(body)) {
            guarded = true;
            break;
          }
        }
      }

      let status;
      let rationale = "";
      if (guarded) {
        status = "authorized";
        rationale = "calls a server-side authorization guard (or delegates to a guarded function).";
      } else if (ALLOW_LIST[key]) {
        [status, rationale] = ALLOW_LIST[key];
      } else {
        status = "FINDING";
        rationale = "no guard call detected and not allow-listed — triage required.";
      }
      rows.push({ key, file, name: matches[i].name, kind: matches[i].kind, status, rationale });
    }
  }
  return rows;
}

const rows = classify();
const findings = rows.filter((r) => r.status === "FINDING");
const counts = rows.reduce((acc, r) => {
  acc[r.status] = (acc[r.status] ?? 0) + 1;
  return acc;
}, {});

if (process.argv.includes("--markdown")) {
  console.log("| Function | Kind | Status | Rationale |");
  console.log("| --- | --- | --- | --- |");
  for (const r of rows) {
    console.log(`| \`${r.key}\` | ${r.kind} | ${r.status} | ${r.rationale} |`);
  }
  console.log("");
}

console.log(
  `authz-coverage: ${rows.length} exported functions — ` +
    `${counts.authorized ?? 0} authorized, ` +
    `${counts["intentionally-public"] ?? 0} intentionally-public, ` +
    `${findings.length} FINDING`,
);

if (findings.length > 0) {
  console.error("\nUNTRIAGED FINDINGS (add a guard, or allow-list with a rationale):");
  for (const f of findings) console.error(`  - ${f.key} (${f.kind})`);
  process.exit(1);
}
