# CI gate & cross-epic DoD→test coordination (E14-T8)

This is the machine-checkable contract for the launch sprint: the single CI gate
that runs on every change, and the map from each other go-live epic's key
Definition-of-Done to the specific committed test in this suite that proves it.
"Done" for those epics is therefore verifiable here, not asserted.

## The gate

| Command | Runs | When |
| --- | --- | --- |
| `pnpm typecheck` | web (`@openbooks/web`) TS typecheck | part of `verify` |
| `pnpm typecheck:convex` | `tsc -p convex/tsconfig.json --noEmit` — Convex backend typecheck | part of `verify` |
| `pnpm lint` | ESLint | part of `verify` |
| `pnpm build` | Next.js production build | part of `verify` |
| `pnpm test:unit` | Vitest (`convex/**/*.test.ts` + `tests/**`) | part of `verify` |
| `pnpm verify` | all of the above, in order | local + CI job 1 |
| `pnpm test:e2e` | Playwright (serial, `workers:1`, dev-auth-bypass) | CI job 2 |
| `pnpm ci` | `verify` then `test:e2e` | the default full gate |

Security tooling (run on demand / during the security pass, not in the blocking
unit gate): `pnpm scan:secrets`, `pnpm security:gitleaks`, `pnpm security:audit`,
`node scripts/authz-coverage.mjs`.

GitHub Actions (`.github/workflows/ci.yml`) is the documented two-job equivalent
(verify + e2e) and is authored only on Ansar's explicit OK (a push/PR workflow
arguably "touches hosting" per AGENTS.md). The `pnpm ci` script is unblocked and
is the canonical local/self-host gate.

Required env for the e2e job + `pnpm dev:full`: `OWNER_EMAIL`, `OWNER_PASSWORD`,
`OPENBOOKS_SKIP_DEMO_SEED=1`, `NEXT_PUBLIC_OPENBOOKS_DEV_AUTH_BYPASS=1`.

## Cross-epic DoD → proving test

| Epic | Key DoD | Proven by |
| --- | --- | --- |
| E1 — Accounting correctness | Every posted entry balances; USD trial balance is 0; deterministic fuzz holds | `convex/ledgerInvariants.test.ts`, `convex/ledger.test.ts` |
| E1 — Reconciliation | Reversal is the exact inverse + immutability; report balance survives the >5000-row cliff | `convex/reversalInvariants.test.ts` |
| E1 — Stripe double-count | 1150 Clearing + 1160 In-Transit net to 0 per payout; no fixtures on a real entity; income counted once | `convex/stripeClearingInvariant.test.ts`, `convex/stripeSingleCounting.test.ts`, `convex/stripeFixtureGating.test.ts`, `convex/stripeMatcher.test.ts`, `convex/stripeClearing.test.ts` |
| E1 — Cash-flow / customer rollup | Transfer/self-transfer net-out; income-by-customer counted once | `convex/coreViews.cashflow.test.ts`, `convex/reportViews.cashflow.test.ts`, `convex/reportViews.contactRollup.test.ts` |
| E1 — Unreviewed gap / windows | Shared unreviewed-gap signal; server-clock month window | `convex/unreviewedGap.test.ts`, `convex/coreViews.window.test.ts` |
| E1 — Bank reconciliation | Diff=$0 gate, reversible adjusting entry, locked-period | `convex/reconciliation.test.ts` |
| E2 — AI categorization | Provider-agnostic categorize; backlog drainer; embeddings recall; truthful stage attribution; calibration | `convex/categorizer.test.ts`, `convex/backlogDrainer.test.ts`, `convex/embeddings.test.ts`, `convex/pipeline.test.ts`, `convex/calibration.test.ts`, `convex/aiRuntimeRouting.test.ts` |
| E3 — Unified credentials / BYO keys | Encrypted-at-rest credential store; provider resolver; secret never echoed; connection health | `convex/credentials.test.ts`, `convex/aiResolve.test.ts`, `convex/secretSafety.test.ts`, `convex/connectionsHealth.test.ts`, `convex/connections.test.ts`; e2e `tests/e2e/connections-byok.spec.ts` |
| E3 — Webhook verification | Tampered/absent signature rejected (Stripe + Plaid) | `convex/stripeWebhook.test.ts`, `convex/plaidWebhook.test.ts` |
| E4 — Guided onboarding | State machine + multi-business + opening balances + finish-populated | `convex/onboarding.test.ts`, `convex/onboardingProposals.test.ts`; e2e `tests/e2e/onboarding.spec.ts`, `tests/e2e/onboarding-golive.spec.ts` |
| E4/E11 — Reset & demo | Scoped factory reset (re-type to confirm); public read-only demo | `convex/workspaceReset.test.ts`, `convex/dataLifecycle.test.ts`, `convex/demo.test.ts`, `convex/demoGuard.test.ts`, `convex/publicDemo.test.ts`; e2e `tests/e2e/reset-reonboard.spec.ts`, `tests/e2e/data-lifecycle-e11.spec.ts` |
| E5 — Multi-entity / Portfolio | Deterministic default entity; USD-locked entity; scope contract; intercompany elimination; consolidated reports; scope authz | `convex/entityScope.test.ts`, `convex/portfolioMoney.test.ts`, `convex/portfolioViews.test.ts`, `convex/intercompany.test.ts`, `convex/reportViews.consolidated.test.ts`, `convex/portfolio.authz.test.ts`; e2e `tests/e2e/portfolio-scope.spec.ts` |
| E6 — Reports UI | CSV export parity; consolidated scope; prior/delta; no-future windows | `convex/reportViews.test.ts`, `apps/web/.../__tests__` parity test (web suite) |
| E9 — AI CFO | CFO signals + anomalies + advisories + weekly digest | `convex/aiCfo.test.ts`, `convex/aiCfoAggregate.test.ts`, `convex/aiCfoAnomalies.test.ts`, `convex/weeklyDigest.test.ts`, `convex/revenueByStream.test.ts` |
| E10 — Payroll | Multi-currency convert-to-USD lifecycle; bank matcher; FX day-of-pay; entity-explicit statement | `convex/payroll.test.ts` |
| E12 — Settings | Categories / rules / notifications / team / audit / scope fallback | `convex/settings.test.ts`, `convex/profileTeam.test.ts`, `convex/audit.test.ts`, `convex/ruleMatcher.test.ts`; e2e `tests/e2e/settings.spec.ts` |
| E14 — AI categorization eval | Gold dataset + accuracy/threshold math vs the 80% target | `convex/categorizationGold.test.ts`; e2e `tests/e2e/ai-eval-h3.spec.ts` |
| E14 — Authz coverage | Every exported function guarded or triaged; representative anonymous + cross-workspace rejection | `scripts/authz-coverage.mjs` (exit non-zero on any FINDING) + `convex/authzCoverage.test.ts`; matrix in `docs/finishing/security-audit.md` |
| E14 — Security audit | Secret encryption-at-rest, webhook verification, gitleaks history scan, `pnpm audit` | `convex/secretSafety.test.ts`, `convex/stripeWebhook.test.ts`, `convex/plaidWebhook.test.ts`; `.gitleaks.toml` + `docs/finishing/security-audit.md` |

## Notes

- The unit suite globs `convex/**/*.test.ts` (see `vitest.config.ts`), so the
  E14 invariant / eval / authz tests are already part of `pnpm test:unit` — no
  wiring needed beyond their existence.
- The five E14 go-live e2e specs only ever create fresh, stamped-unique
  disposable workspaces (the guard is documented in `tests/e2e/helpers.ts`); they
  never mutate Ansar's real Zikra/Z360 books.
