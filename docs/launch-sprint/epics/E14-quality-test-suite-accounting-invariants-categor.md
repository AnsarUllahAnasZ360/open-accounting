# E14 — Quality — test suite, accounting invariants, categorization eval & security audit

> Part of the **OpenBooks Launch Sprint**. Master plan: [../README.md](../README.md) · Backlog: [../backlog.md](../backlog.md)

**Goal.** Make OpenBooks provably correct and safe to open to the public: a real, fast, CI-gated test suite that proves the double-entry ledger never breaks its invariants (every entry balances, the **single-currency (USD) trial balance is zero** since the general ledger is USD-only — decided: see decisions.md, the Stripe clearing/in-transit chain zeroes per payout, reversals are exact inverses), a committed label-safe categorization EVAL harness with a threshold gate wired to Settings, end-to-end coverage of the NEW go-live flows (guided onboarding, in-UI BYO-key connections, delete-all/reset, portfolio scope switch, Stripe reconciliation) on **fresh disposable workspaces with NO shared/real-book mutation** (decided: see decisions.md), a documented SECURITY AUDIT (secret handling, encryption-at-rest of the **unified `credentials` store** for all secrets, authz on all 241 functions, webhook signature verification, no keys/PII in git, `pnpm audit` + committed gitleaks secret-scan), and a single CI gate that runs pnpm verify + convex tsc + e2e. This epic is the quality net that every other go-live epic (multi-entity portfolio, intercompany, BYO-keys, onboarding, reconciliation fixes, reset/demo) plugs its Definition-of-Done into.

**Why it matters.** Ansar is about to run his two real LLCs (Zikra + Z360) on these books and then open-source the product for strangers to self-host with their own bank, Stripe, and AI keys. The deep audit proved the books are currently wrong in several independent ways (78% of transactions never post, $458k phantom Stripe asset, no opening balance, fixtures injected into real books, 5000-row truncation, frozen dates). The general ledger is now USD-only (decided: see decisions.md — no multi-currency GL, multi-currency survives ONLY inside payroll as convert-to-USD), so the old "multi-currency summed without conversion" defect is retired rather than guarded. Fixing the rest is the job of other epics — but without an invariant test net, every fix risks silently re-breaking the ledger, and a public launch without a security audit invites a leaked-key or cross-tenant-data incident that would end the project's credibility on day one. This epic converts "we believe the books are right" into "a machine proves the books are right on every commit," and turns the security posture from assumed to documented. It is the precondition for Ansar trusting his own numbers and for any stranger trusting the repo.

## Current state

Test infrastructure exists and is healthy but is mostly behavioral, not invariant-based, and is not gated in CI. Vitest (vitest.config.ts) runs 33 *.test.ts files in convex/ plus tests/ under the edge-runtime, using convex-test with import.meta.glob modules. Playwright (playwright.config.ts) runs 40+ e2e specs serially (workers:1) against a dev server, relying on NEXT_PUBLIC_OPENBOOKS_DEV_AUTH_BYPASS to skip the sign-in gate. ledger.test.ts already proves: unbalanced rejection (ledger.ts:387), single-currency trial-balance-zero via api.ledger.accountingSnapshot (ledger.ts:563, differenceMinor:650), reversal+repost, period lock, and authz. The existing single-currency USD assertions are now the CORRECT model: the general ledger is USD-only (decided: see decisions.md), there is no GL multi-currency epic, and the dead `journalLines.fxRate` field is being dropped — so the old "RC8 per-currency trial-balance" gap is RETIRED, not a target. This epic instead hardens the USD single-currency trial-balance + balanced-entry invariant (reports.ts:21 / reportViews.ts:303 sum USD minor units, which is now trustworthy by construction). stripeSingleCounting.test.ts proves one charge→fee→payout→deposit lifecycle but there is no generalized 'clearing(1150) and in-transit(1160) net to zero per payout' invariant guarding RC2/RC4 across many payouts. authz.test.ts covers only requestAccess.list; 241 exported functions across convex/*.ts are otherwise unaudited for the 'every query/mutation/action re-checks workspace/entity authz' rule (connections.ts shows 7 public fns / 6 authz calls, coreViews.ts 5/3 — candidate gaps; the GET /ai/chat route at http.ts:96 takes _ctx with no auth). A categorization eval already exists (action ai:runHoldoutCategorizationEval at ai.ts:1088, schema aiEvalRuns at schema.ts:380, script scripts/h3-holdout-categorization-eval.mjs, surfaced in Settings AI and asserted by tests/e2e/ai-eval-h3.spec.ts expecting 75%/45-of-60/below-80%-target) — but it is a single demo-seeded run, not a committed label-safe gold dataset, and its threshold is not a CI gate. Encryption-at-rest exists (convex/secretBox.ts, AES-GCM, OPENBOOKS_SECRET_ENCRYPTION_KEY) and webhook signature verification exists for both Plaid (plaidWebhook.ts:73 verifyPlaidWebhookSignature) and Stripe (http.ts:164 verifyStripeWebhookSignature). Note the credential model is changing under E3: all secrets (ai/plaid/stripe/plunk) converge on ONE unified `credentials` table (the `connectionCredentials`-style encrypted blob, decided: see decisions.md), the dead per-field `aiCredentials` shape is collapsed into it, and the KDF is fixed (32 raw bytes / HKDF, not bare SHA-256) — the security audit (T6) reviews this unified store, not the old split. realTestReset.ts (action startFullRebuild:115, mutation finalizeZ360Only:222, internalMutation deleteBatch:409) is the reset surface. .gitignore correctly ignores .env/.env.* but there is no automated secret-scan or dependency-scan step, and no CI workflow file exists at all (.github/workflows is absent). pnpm verify = typecheck && lint && build && test:unit — it does NOT run convex tsc (convex/tsconfig.json exists but is unused by verify) and does NOT run e2e.

## Definition of done (epic)

- [ ] A new convex/ledgerInvariants.test.ts proves, via convex-test against the real postEntry / postLedgerEntryCore path: (1) every posted entry has sum(debit)==sum(credit); (2) the **single-currency (USD) trial balance differenceMinor is 0** across a USD-only book (the GL is USD-only — decided: see decisions.md); (3) a reversal entry is the exact line-by-line inverse of its original and nets the affected accounts to their pre-original balances; (4) a deterministic randomized sequence of N>=50 USD balanced entries keeps the trial balance at zero throughout. (There is no per-currency/multi-currency GL guard — that defect class is retired with the USD-only decision; multi-currency lives ONLY in payroll, covered by E10.)
- [ ] A new convex/stripeClearingInvariant.test.ts proves that across a multi-payout fixture lifecycle, ledger account 1150 (Stripe Clearing) and 1160 (Payouts In-Transit) each net to exactly 0 after every payout is reconciled, and that NO fixture payout is ever posted to a non-demo (real) entity (guards RC2/RC4 at stripe.ts:1371/1851). The in-transit/clearing double-count model is ALREADY built and wired (decided: see decisions.md) — this is an invariant guarding the calibrated matcher (E1: exact-net-amount, −2/+5 business-day window, descriptor demoted to a scoring booster) and the RC4 fixture-gating, not new construction.
- [ ] A committed, label-safe gold categorization dataset (>=60 rows, human-confirmed labels, no live PII) plus an eval runner that reports accuracy and PASS/FAIL against the shared 80% target; the result is persisted to aiEvalRuns and rendered in Settings > AI; a vitest test asserts the runner computes accuracy correctly on a known fixture; ai-eval-h3.spec.ts (or its successor) stays green.
- [ ] New e2e specs cover the go-live flows end to end against a DISPOSABLE book — **e2e only ever creates fresh workspaces** (a dedicated isolated entity is the fallback only if a shared-deployment constraint forces it — decided: see decisions.md), never mutating Ansar's real Zikra/Z360 data: guided onboarding (account→workspace→business→AI key→Plunk→Plaid→Stripe→opening balances, with skips), in-UI BYO-key entry + validation for AI/Plaid/Stripe/Plunk (workspace-scoped AI/Plunk keys, per-business Stripe — decided: see decisions.md), delete-all-data → reset → re-onboard, portfolio All/Zikra/Z360 scope switch (intercompany eliminated in the All roll-up), and Stripe deposit↔payout reconciliation (Match action). Each spec passes in the existing serial Playwright runner.
- [ ] A security-audit findings document at docs/finishing/security-audit.md enumerates: secret handling & encryption-at-rest review of the **unified `credentials` store** (secretBox.ts + the collapsed ai/plaid/stripe/plunk blob shape and fixed KDF — decided: see decisions.md), an authz coverage matrix for ALL 241 exported convex functions (each marked authorized / intentionally-public / FINDING), webhook signature verification review (Plaid + Stripe, including the now-REQUIRED verified Stripe webhook), a committed gitleaks git-history secret scan result, and a `pnpm audit` dependency vulnerability scan result — with every HIGH/CRITICAL finding either fixed or explicitly risk-accepted with rationale.
- [ ] An automated authz-coverage test (convex/authzCoverage.test.ts) asserts that a curated set of representative read/write/action functions reject unauthenticated and cross-workspace callers, and a lint-style script flags any exported query/mutation/action whose body never calls a requireWorkspace*/getEntityFor*/requireUserId helper (allow-list for intentionally public functions).
- [ ] A CI gate is defined and runnable: a .github/workflows/ci.yml (or documented equivalent) and an extended `pnpm verify` that runs typecheck + lint + build + convex tsc (convex/tsconfig.json) + test:unit, plus a separate e2e job; the gate is green on the current branch and documented in README/docs.
- [ ] Every other go-live epic has at least one DoD assertion expressed as a test in this suite (cross-epic coordination table committed in docs), so 'done' for those epics is machine-checkable here.

## Tickets (8)

### E14-T1 — Accounting invariant test: USD trial balance & balanced-entry property
`size: M` · `risk: high` · `depends on: —`

**Intent.** Prove the single most load-bearing accounting truth — every posted entry balances and the **single-currency (USD) trial balance is zero** — so the USD-only ledger (decided: see decisions.md) can never silently regress. There is no per-currency/multi-currency GL guard: the GL is USD-only, so the prior RC8 "currency-blind sum" defect is retired rather than guarded; multi-currency lives ONLY in payroll (covered by E10).

**Changes**

- Create convex/ledgerInvariants.test.ts using convex-test + import.meta.glob (mirror the setup harness in convex/ledger.test.ts:10-100: users/workspaces/workspaceMembers/entities + a chart of accounts).
- Add a USD entity with USD-denominated ledgerAccounts (asset cash + an equity/expense pair). Entity currency is locked to USD (decided: see decisions.md).
- Test 1 (balanced property): post 20 deterministic-random USD entries via api.ledger.postEntry and assert each returned entry has debitTotal===creditTotal, and that the mutation rejects any unbalanced or single-side-zero line (re-cover ledger.ts:377-389).
- Test 2 (USD trial balance): post several internally-balanced USD entries, then read api.ledger.accountingSnapshot and assert the trial balance differenceMinor is exactly 0 (ledger.ts:650). Cross-check by querying journalLines directly in t.run so the test is independent of the report layer.
- Test 3 (no-mixed-currency guard): assert that the ledger does not admit a non-USD currency on a journal line — posting (or attempting to post) a non-USD line is rejected or normalized to USD per the USD-only lock (decided: see decisions.md). The dead `journalLines.fxRate` field is dropped; assert no fxRate dependency remains.
- Test 4 (deterministic fuzz): 50-iteration seeded loop (reuse the PRNG pattern at ledger.test.ts:216-243) emitting balanced USD entries; assert the USD trial balance stays zero throughout.

**Files:** `convex/ledger.test.ts:10`, `convex/ledger.ts:345`, `convex/ledger.ts:387`, `convex/ledger.ts:563`, `convex/ledger.ts:650`, `convex/reportViews.ts:303`, `docs/finishing/accounting-engine-blueprint.md:302`

**Definition of done**

- [ ] convex/ledgerInvariants.test.ts exists and runs under `pnpm test:unit`.
- [ ] Tests assert the balanced-entry property, the USD trial-balance-zero invariant, and the deterministic 50-iteration fuzz, all green for the USD-only ledger.
- [ ] A USD-only guard asserts non-USD ledger lines are not admitted (currency is locked to USD), with no remaining `journalLines.fxRate` dependency.
- [ ] No test mutates a shared/real book — every test builds its own in-memory convex-test instance.

**Deliverables:** convex/ledgerInvariants.test.ts; Inline doc comment noting the GL is USD-only (decided: see decisions.md) and that multi-currency is payroll-only (E10)

**Verify.** Run `pnpm test:unit` (or `npx vitest run convex/ledgerInvariants.test.ts`); all assertions green for the USD-only behavior.

### E14-T2 — Stripe clearing/in-transit zero-out invariant + no-fixtures-on-real-books test
`size: M` · `risk: high` · `depends on: E14-T1`

**Intent.** Lock down the $458k phantom-asset class of bug (RC2/RC4): prove that after reconciliation the Stripe Clearing (1150) and Payouts In-Transit (1160) accounts each net to zero per payout, and that synthetic fixture payouts can never land on a real (non-demo) entity. The in-transit clearing model is ALREADY built and wired (decided: see decisions.md); this ticket guards the calibrated matcher (E1: match on **exact net amount** within a **−2/+5 business-day** window, with the `"stripe"/"payout"` descriptor demoted from a hard gate to a **scoring booster only**) plus the RC4 fixture-gating — it is an invariant test, not new construction.

**Changes**

- Create convex/stripeClearingInvariant.test.ts modeled on convex/stripeSingleCounting.test.ts (reuse the exported helpers findMatchingStripePayout / matchPlaidInflowToPayout / reconcilePayoutWithDeposit imported from ./stripe).
- Build a fixture projection with MULTIPLE payouts (e.g. 3 charges→fees→payouts→deposits, including one with a non-'stripe' bank descriptor — to prove the descriptor is a booster, not a gate — and one whose deposit arrives on a different day within the −2/+5 business-day window) to exercise the calibrated matcher at stripe.ts:1208/1371.
- After running the full charge→fee→payout→deposit→reconcile lifecycle, query journalLines for accounts numbered 1150 and 1160 on the entity and assert each account's net (sum debit - sum credit) is exactly 0.
- Add an assertion that the income side is not double-counted (gross+net) — reuse the single-counting expectations already proven in stripeSingleCounting.test.ts as a guard.
- Add a test that calls the real (non-fixture) Stripe sync path with includeFixturePayoutFallback semantics against a NON-demo entity and asserts ZERO synthetic payouts are posted (guards stripe.ts:1824/1851 RC4). If the fallback gating is the job of the reconciliation epic, write the assertion now so it goes red until that epic gates fixtures to demo-only, then green.

**Files:** `convex/stripeSingleCounting.test.ts:1`, `convex/stripe.ts:1208`, `convex/stripe.ts:1371`, `convex/stripe.ts:1824`, `convex/stripe.ts:1851`, `docs/finishing/accounting-engine-blueprint.md:221`, `docs/finishing/accounting-engine-blueprint.md:256`

**Definition of done**

- [ ] convex/stripeClearingInvariant.test.ts asserts 1150 and 1160 each net to 0 across a multi-payout reconciled lifecycle.
- [ ] A test asserts fixture payouts are never injected into a non-demo entity (red-until-fixed if the reconciliation epic hasn't gated it yet, with the epic id referenced).
- [ ] Income double-count guard present and green.
- [ ] Runs under `pnpm test:unit` with no real Stripe key (fixture/projection only).

**Deliverables:** convex/stripeClearingInvariant.test.ts; Cross-reference comment to RC2/RC4 and the Stripe-reconciliation epic id

**Verify.** `npx vitest run convex/stripeClearingInvariant.test.ts`; clearing/in-transit nets are 0; no-fixtures-on-real assertion tracked.

### E14-T3 — Reversal-is-exact-inverse & post-truncation balance invariant tests
`size: M` · `risk: high` · `depends on: E14-T1`

**Intent.** Prove the immutability/correction contract (posted entries are immutable; corrections reverse+repost) is exact, and prove reports stay balanced past the 5000-row truncation cliff (RC5) so a real book — which may pull as much history as the connector gives (user-chosen window, decided: see decisions.md) — can't silently drop one side of an entry. The real truncation fix (date-ordered complete loading) is owned by E1-T5; this ticket ships the red-then-green guard.

**Changes**

- In convex/ledgerInvariants.test.ts (or a sibling reversalInvariants.test.ts), post an entry, reverse it via reversesEntryId (exercising assertReversalLines at ledger.ts:391), and assert the reversal's lines are the line-by-line debit↔credit swap of the original AND that every affected account returns to its exact pre-original balance.
- Assert that the original entry is never mutated/deleted (immutability): the original journalEntries row and its lines are unchanged after reversal+repost.
- Add a high-volume test: post >5000 journal lines worth of balanced USD entries on one entity, then call the report builder query (reportViews trial-balance / balance-sheet path that uses .take(5000) at reportViews.ts:494) and assert the reported trial balance is still zero — this goes RED today (truncation drops lines) and becomes the regression gate that the E1-T5 pagination/rollup fix must satisfy.
- Document the expected-red state and link it to E1-T5 (which owns the real truncation fix; E6 only surfaces the banner).

**Files:** `convex/ledger.ts:160`, `convex/ledger.ts:391`, `convex/reportViews.ts:494`, `convex/reportViews.ts:303`, `docs/finishing/accounting-engine-blueprint.md:268`

**Definition of done**

- [ ] A test proves reversal lines are the exact inverse of the original and that affected accounts return to pre-original balances.
- [ ] A test proves the original entry+lines are byte-for-byte unchanged after reverse+repost (immutability).
- [ ] A >5000-line report-balance test exists; it is red-until-fixed against reportViews.ts:494 with E1-T5 referenced as the owner of the fix, and becomes a required green gate once pagination/rollup lands.
- [ ] All green tests run under `pnpm test:unit`.

**Deliverables:** Reversal/immutability/truncation invariant tests; Comment mapping the truncation test to RC5 and E1-T5

**Verify.** `npx vitest run` on the new file(s); reversal+immutability green; truncation guard visibly tracked.

### E14-T4 — Committed label-safe categorization gold dataset + eval runner with threshold gate
`size: M` · `risk: med` · `depends on: —`

**Intent.** Turn the existing one-off demo eval into a durable, label-safe categorization benchmark with a committed gold dataset and a PASS/FAIL threshold, so categorization quality is measured the same way on every run and surfaced honestly to the owner (RC9 context: BYO-AI quality is the upstream cause of the unposted backlog).

**Changes**

- Create convex/fixtures/categorizationGold.ts (or tests/fixtures/) with >=60 human-confirmed (description, merchant, amount, expected category/account) rows that contain NO live PII — synthesize realistic vendors for Ansar's three streams (marketing services, Z360 platform/usage/setup, AI consulting) plus common expenses; mark each row's expected label.
- Refactor the eval to evaluate against this committed gold set (the existing action ai:runHoldoutCategorizationEval at ai.ts:1088 evaluates a demo-seeded holdout via ai:holdoutTransactionResult; either point it at the gold fixtures or add a sibling action ai:runGoldCategorizationEval that scores predictions vs gold and persists to aiEvalRuns at schema.ts:380).
- Add a pure-unit vitest test that feeds a known prediction-vs-gold pairing into the accuracy computation and asserts the accuracy/PASS-FAIL math (vs the shared 80% target referenced at ai.ts:442) is correct — this is deterministic and needs no LLM.
- CI scoring runs against a **recorded/mock provider** (deterministic, no key — decided: see decisions.md), exercising the provider-agnostic resolver from E3 with a recorded/fake provider rather than a live BYO key; the accuracy math is the asserted unit test in CI. Note the BYO-key runtime (14-provider factory, workspace-scoped AI keys) is wired this sprint by E3/E2, so the eval no longer assumes Bedrock-from-env.
- Keep the result rendered in Settings > AI (the ai-eval-history / ai-eval-row testids already exist) and keep tests/e2e/ai-eval-h3.spec.ts green (update expected numbers if the dataset changes).
- Document the dataset provenance and the 'label-safe / no-PII' guarantee in a header comment.

**Files:** `convex/ai.ts:1088`, `convex/ai.ts:412`, `convex/ai.ts:442`, `convex/schema.ts:380`, `scripts/h3-holdout-categorization-eval.mjs:30`, `tests/e2e/ai-eval-h3.spec.ts:18`

**Definition of done**

- [ ] A committed gold dataset (>=60 label-safe rows, documented no-PII) exists in the repo.
- [ ] An eval runner scores predictions vs gold, reports accuracy + status (meets_target/below_target) against the 80% constant, and persists to aiEvalRuns.
- [ ] A deterministic unit test proves the accuracy/threshold computation on a fixed pairing.
- [ ] Settings > AI still renders the latest run and the e2e eval spec is green.
- [ ] Running the eval emits no secrets and works without a live AI key — CI scores against a recorded/mock provider (deterministic) and asserts the accuracy math as a unit test (decided: see decisions.md).

**Deliverables:** convex/fixtures/categorizationGold.ts; Eval runner (refactored ai:runHoldoutCategorizationEval or new ai:runGoldCategorizationEval); Unit test for the accuracy math; Updated ai-eval-h3.spec.ts if numbers shift

**Verify.** `npx vitest run` for the accuracy unit test; `pnpm test:e2e -- ai-eval-h3.spec.ts` green; manual: open Settings>AI and see the gold-eval result with PASS/FAIL vs 80%.

### E14-T5 — Authz coverage audit matrix + automated unauthenticated/cross-workspace rejection tests
`size: L` · `risk: med` · `depends on: —`

**Intent.** Honor the 'every query/mutation/action re-checks workspace/entity authorization on the server' rule across all 241 exported functions, and convert it from an assumption into a documented matrix plus an automated test that representative reads/writes/actions reject anonymous and cross-tenant callers — the core defense against cross-LLC data leakage before public launch.

**Changes**

- Generate an authz coverage matrix: enumerate every exported query/mutation/action across convex/*.ts (241 total) and for each record whether its body calls a guard (requireWorkspaceRole / requireWorkspacePermission / requireUserId / getEntityForRead / getEntityForWrite / authorizeThreadAccess / requireAnyWorkspace* from convex/authz.ts) or is intentionally public (e.g. requestAccess.create, landing reads, webhook-backing internal*). Write a small script (scripts/authz-coverage.mjs) that greps function bodies and emits the matrix to docs/finishing/security-audit.md as a table with status authorized | intentionally-public | FINDING.
- Manually triage flagged candidates already observed (connections.ts 7 fns/6 guards, coreViews.ts 5/3) and the GET /ai/chat route at http.ts:96 which receives _ctx; confirm each is either guarded deeper, intentionally public, or a real finding.
- Create convex/authzCoverage.test.ts: for a curated representative function per category (a view query, a ledger mutation, an action, a settings/connections mutation), assert (a) anonymous caller is rejected with 'OpenBooks requires sign-in' (pattern from authz.test.ts:50), and (b) a user who is a member of workspace A is rejected when targeting an entity/workspace B (build two workspaces in-test).
- Add an allow-list constant of intentionally-public function names so the coverage script fails CI if a NEW exported function appears without a guard and without being allow-listed. Two new function classes from this sprint must be classified explicitly: (a) the unified `credentials` read/write/resolver functions (E3) — workspace-scoped for AI/Plunk, per-entity for Stripe — must be guarded; (b) the shared no-login demo read path (E11) is **intentionally-public but server-gated on `workspace.isDemo === true` / read-only** (decided: see decisions.md) — allow-list it as intentionally-public and confirm it never grants demo writes.

**Files:** `convex/authz.ts:130`, `convex/authz.ts:140`, `convex/authz.test.ts:46`, `convex/entities.ts`, `convex/connections.ts`, `convex/coreViews.ts`, `convex/http.ts:96`

**Definition of done**

- [ ] docs/finishing/security-audit.md contains a complete authz matrix covering all 241 exported functions, each classified authorized / intentionally-public / FINDING.
- [ ] scripts/authz-coverage.mjs regenerates the matrix and exits non-zero if any non-allow-listed exported query/mutation/action lacks a guard call.
- [ ] convex/authzCoverage.test.ts proves representative functions reject anonymous and cross-workspace callers; green under `pnpm test:unit`.
- [ ] Every FINDING is either fixed (guard added) or risk-accepted with written rationale in the doc.

**Deliverables:** scripts/authz-coverage.mjs; Authz matrix section in docs/finishing/security-audit.md; convex/authzCoverage.test.ts

**Verify.** `node scripts/authz-coverage.mjs` exits 0 with zero unexplained findings; `npx vitest run convex/authzCoverage.test.ts` green.

### E14-T6 — Security audit pass: secret handling, encryption-at-rest, webhook verification, git-history & dependency scan
`size: L` · `risk: med` · `depends on: E14-T5`

**Intent.** Produce the documented pre-public security audit covering everything except authz (which T5 owns): that secrets are encrypted at rest in the unified `credentials` store and never logged/returned, that both webhooks verify signatures (Stripe webhook is now REQUIRED + verified — decided: see decisions.md), that no key/PII is in git history (committed gitleaks scanner), and that dependencies have no known critical vulns.

**Changes**

- Review convex/secretBox.ts (AES-GCM, OPENBOOKS_SECRET_ENCRYPTION_KEY) and the **unified `credentials` store** (the single `encryptedPayload` blob shape that ALL secrets — ai/plaid/stripe/plunk — now share, with the collapsed dead `aiCredentials` table and the fixed KDF: 32 raw bytes / HKDF, not bare SHA-256 — decided: see decisions.md). Confirm plaintext secrets are never persisted, never returned to the client, and never written to auditEvents/logs; that only `fingerprint`/`keyPreview`/`status` are surfaced. Document the data flow.
- Review webhook signature verification: verifyStripeWebhookSignature (http.ts:164) and verifyPlaidWebhookSignature (plaidWebhook.ts:73) — confirm timing-safe comparison, replay/staleness window (plaidWebhook.ts:126), `event.id` dedupe, and that an invalid signature returns 400 without side effects (http.ts:170). Because a live Stripe connection is not "listening" until its webhook is verified (decided: see decisions.md), confirm the verified-webhook precondition is enforced. Add a unit test asserting a tampered/absent signature is rejected.
- Run a git-history secret scan with **committed gitleaks** (decided: see decisions.md) over tracked history for AWS/Stripe/Plaid/Plunk/AI key shapes; record results; confirm .gitignore covers .env/.env.* (it does) and that .env.local is untracked.
- Run a dependency vulnerability scan (`pnpm audit` / `pnpm audit --prod`) and record HIGH/CRITICAL findings with remediation or risk-acceptance. A full SCA (Snyk/Trivy) is an optional follow-up, not required for v1 (decided: see decisions.md).
- Write docs/finishing/security-audit.md sections for: secret handling & encryption-at-rest of the unified store, webhook verification, git-history (gitleaks) scan, dependency (`pnpm audit`) scan, and a prioritized findings table; coordinate the authz section with T5.
- Confirm encryption-at-rest is enforced (plaid.ts:341) and the live-key HTTPS-redirect requirement is present (connections.ts:248). Do NOT assert a "sandbox/test keys only" guard — that rule is REMOVED (decided: see decisions.md): live connectors must work locally; the `OPENBOOKS_REAL_TEST_LIVE_CONNECTORS` gate is neutralized. The security posture is "secrets encrypted at rest + HTTPS for live keys," not "live keys banned."

**Files:** `convex/secretBox.ts:56`, `convex/connections.ts:248`, `convex/plaid.ts:341`, `convex/http.ts:144`, `convex/http.ts:164`, `convex/plaidWebhook.ts:73`, `convex/plaidWebhook.ts:126`, `.gitignore`

**Definition of done**

- [ ] docs/finishing/security-audit.md documents secret handling & encryption-at-rest of the unified `credentials` store, webhook verification, gitleaks git-history scan result, and `pnpm audit` dependency scan result.
- [ ] A test (or documented manual check) proves a tampered/absent webhook signature is rejected with 400 and no DB side effects.
- [ ] gitleaks git-history scan shows no committed key values (false positives explained); gitleaks is committed as dev tooling.
- [ ] `pnpm audit` HIGH/CRITICAL findings are each fixed or risk-accepted with rationale.
- [ ] Encryption-at-rest (plaid.ts:341) and the live-key HTTPS-redirect (connections.ts:248) are verified present; no "sandbox/test-only" guard is asserted (live connectors work locally — decided: see decisions.md).

**Deliverables:** docs/finishing/security-audit.md (non-authz sections); Webhook-tamper rejection test (if not already covered); Committed gitleaks config + recorded scan output; Recorded `pnpm audit` output

**Verify.** Run gitleaks + `pnpm audit` and confirm the doc's findings table matches; `npx vitest run convex/stripeWebhook.test.ts convex/plaidWebhook.test.ts` covers signature rejection.

### E14-T7 — E2E for new go-live flows on disposable books: onboarding, BYO-key connections, reset, portfolio scope, reconciliation
`size: L` · `risk: med` · `depends on: E14-T4`

**Intent.** Give the new owner-facing go-live flows real click-through coverage without ever mutating Ansar's real Zikra/Z360 books, so onboarding, in-UI key entry, delete-all/reset, the All/Zikra/Z360 portfolio switch, and the Stripe Match action are proven before public launch.

**Changes**

- Establish a disposable-book convention: each new spec **only ever creates its own fresh workspace/entity** via the onboarding UI flow (decided: see decisions.md). A dedicated isolated entity via the test reset surface (realTestReset startFullRebuild:115 / finalizeZ360Only:222) is the fallback ONLY if a shared-deployment constraint forces it, and even then it is gated so it NEVER touches real Zikra/Z360 data — document the guard in tests/e2e/helpers.ts.
- tests/e2e/onboarding-golive.spec.ts: drive the guided flow account→workspace→add business(es)→AI key paste + provider/model pick (workspace-scoped, choose from the 14-provider catalog)→Plunk→invite→Plaid (map account→business, the prerequisite for intercompany detection)→Stripe (per business)→opening balances (dated the first of the month, USD), exercising SKIP at each step and choosing a history start date (default = pull everything the connector gives — decided: see decisions.md). Extend the existing onboarding.spec.ts:30 pattern with the new BYO-key + opening-balance steps from the BYOK/onboarding epics.
- tests/e2e/connections-byok.spec.ts: in Settings > Connections, paste an AI key + pick provider/model (workspace-scoped), paste Plaid creds (assert the redirect URL is shown), paste Stripe test key (assert the webhook URL is shown and that the connection only reports 'listening' after the webhook verifies — decided: see decisions.md), paste Plunk key (workspace-scoped) — assert each shows a validated/connected state and that no plaintext key is echoed back in the DOM (all stored in the unified `credentials` store).
- tests/e2e/reset-reonboard.spec.ts: trigger delete-all-data on a disposable workspace (re-type the workspace name to confirm — decided: see decisions.md), assert the books are empty, then re-run onboarding to a populated state.
- tests/e2e/portfolio-scope.spec.ts: assert the All / Zikra / Z360 scope switcher exists, that 'All' rolls up both entities with **intercompany eliminated** (an "Intercompany eliminated: −$X" line, decided: see decisions.md), and that switching scope changes the visible totals (replaces the disliked business-type filter).
- tests/e2e/stripe-reconcile.spec.ts: assert the Inbox 'Match' action pairs a deposit to a payout and that clearing/in-transit health reflects it.
- Wire each spec to the serial Playwright runner (workers:1) and the dev-auth-bypass already configured in playwright.config.ts:68.

**Files:** `tests/e2e/onboarding.spec.ts:16`, `tests/e2e/helpers.ts:39`, `convex/realTestReset.ts:115`, `convex/realTestReset.ts:222`, `playwright.config.ts:56`

**Definition of done**

- [ ] New e2e specs cover onboarding (with skips), BYO-key connections for AI/Plaid/Stripe/Plunk, delete-all→reset→re-onboard, portfolio All/Zikra/Z360 scope, and Stripe deposit↔payout Match.
- [ ] No spec mutates the real Zikra/Z360 production books — each spec only ever creates a fresh workspace (isolated-entity fallback only if a shared-deployment constraint forces it — decided: see decisions.md); the guard is documented and enforced.
- [ ] No plaintext key is asserted to appear in the DOM after entry.
- [ ] All specs pass in `pnpm test:e2e` (serial); screenshots written to docs/finishing/evidence.

**Deliverables:** tests/e2e/onboarding-golive.spec.ts; tests/e2e/connections-byok.spec.ts; tests/e2e/reset-reonboard.spec.ts; tests/e2e/portfolio-scope.spec.ts; tests/e2e/stripe-reconcile.spec.ts; Disposable-book guard documented in tests/e2e/helpers.ts

**Verify.** `pnpm test:e2e -- onboarding-golive connections-byok reset-reonboard portfolio-scope stripe-reconcile`; all green; confirm via Convex dashboard that no real-entity rows were mutated.

### E14-T8 — CI gate: extend pnpm verify with convex tsc, add e2e job, and document the gate
`size: M` · `risk: low` · `depends on: E14-T1, E14-T2, E14-T3, E14-T4, E14-T5, E14-T7`

**Intent.** Make the whole quality net enforceable on every change: today `pnpm verify` runs typecheck+lint+build+test:unit but never typechecks the Convex backend (convex/tsconfig.json is unused by verify) and never runs e2e, and there is no CI gate at all.

**Changes**

- Add a convex typecheck step: a package script `typecheck:convex` running `npx tsc -p convex/tsconfig.json --noEmit` (or `npx convex codegen --typecheck`), and fold it into `pnpm verify` so backend type errors fail the gate.
- Ship a documented **`pnpm ci`** script now as the default gate (decided: see decisions.md): `verify` (typecheck + typecheck:convex + lint + build + test:unit) followed by an e2e run against the dev server. This is the unblocked deliverable. Author `.github/workflows/ci.yml` ONLY on Ansar's explicit OK, because a push/PR workflow arguably "touches hosting" per AGENTS.md (→ ASK ANSAR, light — see Decisions applied). When authored, it has two jobs: (1) verify = typecheck + typecheck:convex + lint + build + test:unit; (2) e2e = playwright run against the dev server, uploading the html report and any failure traces. Use the dev-auth-bypass + Convex URL wiring already in playwright.config.ts.
- Ensure the unit suite includes the new invariant/eval/authz tests (they live under convex/**/*.test.ts which vitest.config.ts already globs).
- Document the gate in README.md and docs/finishing: what runs, how to run it locally (`pnpm verify`, `pnpm test:e2e`), and the required env (OWNER_EMAIL/OWNER_PASSWORD, OPENBOOKS_SKIP_DEMO_SEED, NEXT_PUBLIC_OPENBOOKS_DEV_AUTH_BYPASS).
- Add a coordination table to docs/finishing mapping each other go-live epic's key DoD to the specific test in this suite that proves it (so cross-epic 'done' is machine-checkable).

**Files:** `package.json`, `convex/tsconfig.json`, `vitest.config.ts:6`, `playwright.config.ts:45`, `README.md`

**Definition of done**

- [ ] `pnpm verify` runs typecheck + convex tsc + lint + build + test:unit and is green on the current branch.
- [ ] A documented `pnpm ci` script defines the verify + e2e gate and is runnable (decided: see decisions.md — `.github/workflows/ci.yml` is authored only on Ansar's explicit OK).
- [ ] README/docs describe how to run the gate locally and the required env.
- [ ] A cross-epic DoD→test coordination table exists in docs/finishing.
- [ ] Adding the new invariant/eval/authz tests does not break the gate.

**Deliverables:** `pnpm ci` script (default) + `.github/workflows/ci.yml` only on Ansar's OK; Updated package.json scripts (typecheck:convex, extended verify); README/docs CI section + cross-epic coordination table

**Verify.** Run `pnpm verify` locally → green including convex tsc; run `pnpm test:e2e` → green; confirm the workflow file is syntactically valid (act/CI dry-run or lint).

## Decisions applied

All prior open questions are resolved in `../decisions.md` (canonical) and `../plan-rebuild-changelog.md` (E14 section). Applied here:

- **USD-only general ledger (Q76 / Ansar #3).** E14-T1 is now a single-currency **USD trial-balance + balanced-entry** invariant; the per-currency / RC8 multi-currency guard is retired (there is no GL FX engine and no multi-currency epic to gate against). Multi-currency survives ONLY in payroll (E10).
- **Stripe in-transit already built (Q15 / verification).** E14-T2 guards the *calibrated* matcher (exact net amount, −2/+5 business-day window, descriptor demoted to a scoring booster) + RC4 fixture-gating — it is an invariant, not new construction. The Stripe webhook is REQUIRED + verified before a live connection reports "listening."
- **Unified credential store (Q18 / Ansar #12).** E14-T6 audits ONE `credentials` table (encrypted blob for ai/plaid/stripe/plunk, collapsed `aiCredentials`, fixed HKDF KDF). E14-T5 classifies its read/write/resolver functions as guarded.
- **Live connectors local (Q16 / Ansar #13).** E14-T6 does NOT assert a "sandbox/test keys only" guard; it verifies encryption-at-rest + the live-key HTTPS-redirect instead.
- **e2e fresh workspaces only (Q77).** E14-T7 only ever creates fresh workspaces (isolated-entity fallback only under a shared-deployment constraint).
- **Eval without a live key (Q78).** E14-T4 scores against a recorded/mock provider in CI + asserts the accuracy math as a unit test.
- **Security tooling (Q79).** E14-T6 = `pnpm audit` + committed **gitleaks**; SCA (Snyk/Trivy) is optional follow-up.
- **Shared no-login demo (Ansar #14).** E14-T5 allow-lists the demo read path as intentionally-public but server-gated read-only; E14-T7 portfolio spec asserts intercompany elimination in the All roll-up.

**Still genuinely needs Ansar (light):**

- **E14-T8 — GitHub Actions CI (Q75).** Default: ship a documented `pnpm ci` script now; author `.github/workflows/ci.yml` only on Ansar's explicit OK, because a push/PR workflow arguably "touches hosting" per AGENTS.md. The script path is unblocked regardless.
