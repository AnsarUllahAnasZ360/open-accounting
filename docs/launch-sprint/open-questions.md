# Launch Sprint — Open Questions / Decisions for Ansar

SUPERSEDED on 2026-06-17 by decisions.md — every question here is now resolved there; only the few items in decisions.md > Still needs Ansar remain open.

<details>
<summary>## Archived original questions</summary>

Consolidated from all 15 epics. Resolve these and the tickets become fully specified. Items with a clear default are marked; the rest are genuine product calls.

## E1 — Accounting correctness & reconciliation engine

1. Amount tolerance for the loosened payout matcher (E1-T3): a fixed minor-unit slack vs a small percentage of the payout — Ansar's real Stripe deposits will reveal the typical drift; pick a conservative default (e.g. <= a few minor units OR <= 0.5%) and require manual Match above it.
2. Opening-balance date (E1-T2): use the bank's statement-start/as-of date from Plaid if available, else server-today — confirm Plaid exposes a reliable as-of date on the balance read, otherwise the opening entry date is approximate and the owner may want to edit it.
3. Multi-currency (RC8) is intentionally out of THIS epic's scope (its own FX epic), but E1-T9 adds the optional fxRate write hook so the FX epic can populate it without re-touching the ledger path — confirm that split keeps both epics non-colliding.
4. Should drainResidualInTransit (E1-T4) be a one-time admin migration run against Ansar's live book, or an ongoing self-heal? Recommend one-time + a health tripwire (E1-T4 stripeClearingHealth) thereafter — needs Ansar's go-ahead to run against live data.
5. The unreviewed-gap signal (E1-T8) and unified cash (E1-T10) are entity-scoped now; the All/Zikra/Z360 portfolio scope is a separate epic — confirm the shared helpers take an entity list so the portfolio epic can pass multiple entities without a rewrite.
6. Reconciliation schema (E1-T12): confirm storing clearedTransactionIds on the reconciliation vs a clearedAt/reconciliationId on each transaction — recommend the per-transaction marker for query efficiency at scale; needs a schema-migration review.

## E2 — AI categorization engine & learning loop

7. Embedding dimensions: the aiMemoryEmbeddings vector index is fixed at 1024 (schema.ts:375). Which BYO providers expose a 1024-dim text-embedding model, and for providers that only emit 1536/768, do we pad/truncate/project to 1024, or add a second vector index? (Affects E2-T4/E2-T5 — Ansar/provider decision.)
8. Where do the 3 revenue streams + known-vendor business context come from for the prompt (E2-T9): a new explicit onboarding/settings field, or derived from top customers/vendors in the ledger? An explicit field is more reliable cold-start but adds an onboarding step.
9. Should low-confidence tail items post to 'Uncategorized Income/Expense' (4900/6900) as a visible bucket, or stay unposted in the Inbox with a prominent 'N unreviewed / $X excluded' banner? The blueprint (RC1 fix) floats both; this changes whether reports ever see the tail. (Likely owned by the reports/Inbox epic but the categorizer must know the policy.)
10. Calibration scope and cadence (E2-T10): per-workspace vs per-entity, and how often to refit (on every eval, on a cron, or only on demand)? Per-entity is more accurate for two very different LLCs but needs enough holdout labels per entity.
11. The legacy env-only registry (aiProviderRegistry.ts) still backs providerStatus/bedrockEnvironmentStatus and the chat + connection-test paths; do we migrate those onto the new aiProvider.ts factory in this epic for one source of truth, or leave chat alone to keep blast radius small? (Chat rewiring may belong to the Ask AI epic.)

## E3 — Integrations & BYO-keys (Plaid / Stripe / AI / Plunk)

12. AI provider catalog mismatch: convex/aiCatalog.ts defines 14 providers (gateway/openai/anthropic/google/bedrock/azure/groq/deepseek/mistral/moonshot/xai/fireworks/ollama/openai_compatible) while convex/aiProviderRegistry.ts defines only 5 (bedrock/anthropic/openai/google/ollama) and schema.ts uses an aiProviderIdValidator — which is canonical for the saved aiConfigs.provider field? T2 assumes aiCatalog is canonical and that aiConfigs.provider/aiProviderIdValidator must be widened to all 14 (additive migration). Confirm the validator can be widened without breaking existing rows.
13. Per-provider granularity: should AI keys be workspace-scoped (current aiCredentials.by_workspace_and_provider) or per-business? Ansar may want one AI key for the whole portfolio (likely) but per-business Stripe/Plunk. This epic assumes AI = workspace-level, Stripe/Plaid/Plunk = per-business — confirm.
14. Plunk scope: is Plunk a workspace-level email sender (one key for all businesses) or per-business? T7 assumes workspace-level. Also confirm whether Plunk should reuse connectionCredentials or get its own table.
15. Stripe webhook 'required': Ansar's contract says 'require + verify webhook', but a strictly-required webhook blocks on-demand-only sandbox testing. T6 makes it strongly-recommended + verified-before-listening rather than a hard block at save time — confirm that's acceptable vs a hard requirement.
16. Live connectors are gated behind OPENBOOKS_REAL_TEST_LIVE_CONNECTORS=1 and only Plaid sandbox / Stripe test keys are permitted per AGENTS.md. Confirm all of this epic's verification stays in sandbox/test mode and that real-key validation (Stripe /account, Plunk auth probe) is acceptable with test keys only.
17. Plaid account→business split: Plaid's plaidItems anchor is currently per-entity (schema.ts:248 entityId on plaidItems). T5 fans accounts out to multiple entities but the item row itself is single-entity — confirm whether plaidItems should become workspace-anchored (larger change) or stay anchored to the originating entity while its bankAccounts point elsewhere (smaller, what T5 assumes).

## E4 — Guided onboarding & "done-for-you books" first-run

18. Storage shape for the AI key: extend the existing `connectionCredentials` table with an 'ai' provider, or add a dedicated `aiCredentials` table? E4-T3 assumes mirroring connectionCredentials via secretBox; confirm preference before building.
19. Is the ~6-month history-review window a hard product number, or should it be the lesser of 6 months and 'since first transaction'? E4-T7 assumes a now-relative 6mo window capped at available data.
20. Multi-currency opening balances (USD/PKR/INR): should the opening-balance step require a base-currency value, or book per-currency and let the existing FX/reporting layer convert? E4-T5 assumes integer minor units + the entity currency per account; base-currency conversion is out of scope here and owned by the reconciliation epic.
21. Public no-login demo: should /demo be a single shared seeded workspace (read-mostly, reset on a cron) or a per-visitor ephemeral clone? E4-T10 assumes a shared read-mostly demo with a 'clone to my account' CTA; per-visitor ephemeral is heavier and may belong to a separate GTM ticket.
22. How many clarifying questions is 'a few' for the AI bulk-setup, and should they be fixed or AI-generated per workspace? E4-T7 assumes a small fixed set augmented by AI-detected ambiguities (e.g., transfer-vs-income).
23. Intercompany handling: Ansar's one Plaid account spans both LLCs. The Plaid-account->business mapping in E4-T4 assigns each account to one entity, but cross-entity transfers need flagging — confirm whether intercompany detection is in this epic or the unified-portfolio epic.

## E5 — Multi-entity, workspace↔business layer & Portfolio/consolidation

24. FX source: do we have a live FX rate provider, or should portfolio conversion rely solely on the fxRate already captured on journalLines at posting time (with an 'unconverted' badge when missing)? Ansar trades USD/PKR/INR so a stale-rate policy needs his sign-off (T4).
25. Workspace base currency default: should it be USD (Ansar's primary) or per-workspace configurable from day one? T4 assumes configurable with USD fallback.
26. Bank/Stripe re-map when posted history exists: do we block re-mapping an account that already has posted journal lines (cleanest, preserves immutability) or allow 'future-syncs-only' re-mapping with the old history left under the original entity? T9 needs Ansar's preference (his real Plaid login spans both LLCs, so some accounts may already have mixed history).
27. Intercompany scope: should the detector only flag transfers between entities in the SAME workspace (assumed), or also account for Ansar moving money between an LLC and a personal/holding account that isn't an OpenBooks entity? T5 currently assumes workspace-internal only.
28. Class/tag tracking WITHIN an entity (for DBAs/divisions, blueprint §427) is explicitly out of scope for E5 — confirm it's deferred to a later epic and not expected in this go-live sprint.
29. Should consolidated reports be available to accountant/admin roles or owner-only? T10 currently mirrors single-entity 'member can view books' gating — confirm intercompany eliminations don't need a stricter role.

## E6 — Reports — correctness-aware UI, redesign, responsiveness, export parity & drill-down

30. Field contract with E1: E6-T9's unreviewed/excluded banner and E6-T5's cash-basis exclusion need an authoritative `unreviewed:{count,amountMinor}` and accurate posted-vs-unposted counts on the report pack. Confirm E1 will add these as additive optional fields on reportViews so E6 can render them (E6 ships the banner gated on field-presence regardless).
31. Scope source ownership with E5: E6-T7 consumes the All/Zikra/Z360 scope. Confirm E5 owns the scope switcher + the active-entity context shape (apps/web/src/lib/openbooks/active-entity.tsx) and whether scope is passed as 'all' | entityId so reportPackForScope can branch on it.
32. Multi-currency consolidation: for 'All businesses' spanning USD/PKR/INR, should E6 present a per-currency breakdown only (safe) until E1's FX base-currency engine (RC8) lands, then switch to a base-currency consolidated total? Confirm the base currency selection (workspace-level) E1 will expose.
33. Intercompany handling: for the consolidated view, does Ansar want intercompany transfers ELIMINATED (true consolidation) or just FLAGGED for v1? The blueprint says eliminate-or-flag; flagging is the lower-risk v1.
34. RC5 truncation: E6 only surfaces the truncated banner; the actual fix (pre-aggregated balance rollup table / date-ordered queries, blueprint Phase-1 item 5 and RC5) — is that owned by E1, or should E6 raise/remove the .take(5000) cap as an interim?

## E7 — Transactions register & Mercury-grade workbench: density, responsiveness, provenance, and edit clarity

35. Saved views are FE-only (localStorage via useSavedViews). Does Ansar want server-persisted saved views per workspace in this epic, or is that deferred to a later backend epic? (E7-9 polishes the FE behavior either way.)
36. Provenance copy: confirm the exact owner-facing labels — 'Matched your rule' vs 'Rule', 'Same as last time' vs 'Memory', 'Matched payout' vs 'Matched' for transfer/match. The blueprint suggests sentence-style ('Same as your last 6 AWS charges') which would need the count; the simpler chip uses one word. Which tone wins?
37. The compact insight banner (E7-8) overlaps E8's 'one unique insight banner per page' mandate. Confirm E7 owns the Transactions banner and exposes the reusable contract, and E8 consumes it for the other pages, to avoid two implementations colliding in CoreScreens/InsightsScreen.
38. Centralizing 'today' (E7-10): is there already a chosen single source-of-truth date helper in the broader sprint (the audit flags hardcoded dates across InsightsScreen.tsx:32, agentToolQueries.ts:35, coreViews dashboard window)? If a canonical helper is landing in another epic, E7-10 should import it rather than introduce a second one.
39. Register keyboard model (E7-6): the Inbox uses J/K/Enter/E. Should the register match that exact scheme, or use arrow keys to avoid clashing with global ⌘K command search and typeahead in the category combobox?

## E8 — Insights everywhere — per-page banners + redesigned insights screens, on real ledger data

40. Banner anchor source: use the BROWSER clock via useTodayIso() (simplest, matches ReportsScreen.tsx:122) or thread an `asOf` from the server through session so multi-timezone/SSR stays exact? Recommendation: browser clock for FE display now, server `asOf` for coreViews queries (E8-T2) to keep query bodies deterministic — confirm acceptable.
41. Legacy components (InsightsBand.tsx, MiniCashflowStrip.tsx, InsightsDashboard.tsx, AiNarrativePanel.tsx) predate the E1 kit and are largely self-referenced — retire them entirely or keep AiNarrativePanel as the banner's Explain backend? Recommendation: retire InsightsBand/MiniCashflowStrip/InsightsDashboard, keep the aiInsights action.
42. Should the per-page banner be dismissible-per-session (less noise) or always-on (consistency)? Recommendation: always-on but threshold-gated (hidden when the page-insight builder returns null), so it never shows a filler line.
43. Cross-business 'Portfolio / All businesses' scope (a separate epic) will change what 'active entity' means for banners — should banners aggregate across entities in All mode, or show a per-entity insight? Needs the scope-switcher epic's contract before E8-T4 finalizes the All-mode banner copy.
44. The AI narrative path is Bedrock-only until the BYO-keys epic lands; E8-T8 relies on the deterministic fallback for Ansar's real run — confirm that shipping banners with deterministic-only narration (AI 'Explain' graceful-degraded) is acceptable for go-live, with full AI narration arriving once BYO keys are wired.

## E9 — Dashboard enhancement + AI CFO / Financial Advisor + weekly digests

45. Transfer marker dependency (E9-T1): the transfer-aware cash-flow fix needs a reliable way to identify internal own-account transfers. Does E1 land a canonical transfer flag (entry-level or transaction-level) this sprint, or should E9-T1 ship an interim heuristic (entry hits two own cash accounts) and hand off? Confirm the contract so E9-T1 and E1 don't post conflicting markers.
46. Tax set-aside rate + jurisdiction: E9-T3 defaults to 25% × net income as an ESTIMATE with a 'not tax advice' disclaimer. Is a flat configurable rate acceptable for v1, or does Ansar want per-entity rates (two LLCs, USD/PKR/INR may have different effective rates)? Where should the rate live — workspaceSettings or per-entity?
47. Digest cadence + recipients: weekly Monday 13:00 UTC and a single notificationEmail per workspace — confirm. Should multi-entity workspaces get one combined portfolio digest or one section per business? (Depends on whether the portfolio/scope work from E1/E2 has landed a consolidated view to read from.)
48. Multi-currency in advisories (RC8): runway/burn and forecast sum minor units across currencies. Until base-currency conversion (RC8) lands, should the CFO engine compute per-currency and refuse to sum USD+PKR+INR (showing them separately), or assume a single reporting currency per entity? This affects whether the runway number is trustworthy for Ansar's mixed-currency books.
49. Stream taxonomy source of truth (E9-T8): should streamTag be assigned manually in Settings, proposed by the onboarding AI ('we detected 3 income streams — approve?'), or both? Coordinate ownership with the onboarding epic so the tag isn't defined twice.
50. Forecast sophistication: E9-T3's cash-flow forecast is a naive run-rate + scheduled-items projection. Is that sufficient differentiation for v1, or does Ansar expect seasonality/MRR-growth modeling (which needs more history than the seed has)?

## E10 — Payroll — verify, fix & integrate

51. FX rate source at settlement: should the day-of-pay rate be entered manually by the owner (E10-T3 assumes an optional arg), or pulled from a live FX feed? No FX connector exists today (payrollMath.ts hard-codes PKR=278/INR=83). Manual-with-default is the safe v1; a live feed is a follow-up.
52. Bank-match date window width: confirm the acceptable +/- day tolerance around the posting date for auto-matching a salary debit (QBO-style guardrails suggest a tight window; Wise/ACH can settle a few days late). Proposed default 5 days — needs Ansar's sign-off.
53. Should payroll settlement go through an in-transit/clearing account (like Stripe payouts) when the bank debit lands on a different day than the accrual, or settle directly payable→bank? Current code settles directly; an in-transit hop would be more precise but is a larger change.
54. Semimonthly cadence: the schema allows 'semimonthly' but autoDraftScheduledRuns:813 only computes a monthly 'YYYY-MM' period. Does Ansar need true semimonthly auto-draft now, or is monthly auto-draft + manual second run acceptable for v1?
55. Per-currency statement legal framing: should each LLC's payroll statement be a separate legal document per entity (and per currency), or is a combined portfolio payroll statement also wanted? The portfolio roll-up is owned by the multi-entity epic, not E10.

## E11 — Data lifecycle — reset/delete-all, demo data & public no-login demo account

56. Anonymous demo session mechanism: Convex Auth (used today via convex/auth.config.ts) is identity-provider based. Should the no-login /demo use a synthetic always-valid anonymous provider/account that maps to the demo workspace, OR a stateless signed demo token verified in an httpAction? T5 assumes a scoped read-only demo identity; Ansar/architecture should confirm which fits Convex Auth cleanly without weakening real-auth.
57. Demo reset cadence: daily is the default in T8. Does Ansar want a faster reset (e.g. hourly) for a busier public demo, or on-demand only? Also confirm a quiet UTC hour.
58. Should the per-workspace factory reset (T3) also revoke/disconnect Plaid/Stripe connections via their APIs (external calls in actions), or only delete local connection rows? External revocation is safer but adds network dependency and failure modes.
59. Full export format (T9): JSON snapshot only, or also a zip of per-table CSVs and/or a portable accounting format (e.g. journal CSV your CPA imports)? Confirm whether a re-import path is in scope for this epic or a later one.
60. Should self-hosters get the public demo OFF by default (privacy/cost) with OPENBOOKS_PUBLIC_DEMO_ENABLED opt-in (T8 assumes this), or ON by default so a fresh clone shows a demo immediately?
61. Confirm the per-workspace reset's confirmation phrase and whether owners should additionally re-type the workspace name (higher friction, safer) versus a fixed phrase.

## E12 — Settings & app-shell UI overhaul — make all 11 sections real, on-brand, responsive, and wire the scope-switcher hook

62. Scope-switcher boundary with E5: this epic delivers the switcher UI + active-entity context contract + persistence, but cross-entity data aggregation (the 'All businesses' read path) is E5. Confirm E5 will consume the documented useActiveScope() interface from active-entity.tsx, and which screens must honor scope='all' on day one vs. fall back to the primary entity.
63. Per-entity sections under 'All' scope: Categories and Rules are inherently per-entity (SettingsScreen.tsx resolves a single moduleEntityId). When scope='all', should they (a) fall back to the primary entity with a hint, or (b) force the user to pick a business first? Default chosen here is (a).
64. Rules condition-groups data model: introducing OR-of-groups is a widen-only schema change with a read-time migration shim — confirm whether a one-time backfill migration of legacy flat rules into single-group form is desired, or whether the read-time shim is sufficient long-term.
65. Plunk send wiring scope: T5 deep-links to Connections for the Plunk key and persists cadence/email, but the actual digest send job (cron → packages/email sendPlunkEmail) may belong to the AI-CFO/digest epic. Confirm whether the weekly-digest SEND lives here or there; this epic only owns the preference + honest status.
66. Audit retention/volume: the new paginated audit query assumes auditEvents grows unbounded — confirm there is no retention policy that would make 'reach an old event' untestable, and whether a workspace-level audit export belongs in DataSection vs Audit.
67. Member removal semantics: removing an active member here detaches their workspaceMembers row; confirm whether their historical audit/posting attributions must be preserved (they are immutable journal references, so this should be safe) and whether removed users keep any access to invites.

## E13 — Self-host setup skill + deployment + security posture pages

68. Skill placement & distribution: should `openbooks-self-host` live at `.claude/skills/` (project-local, currently all symlinks to .agents/skills) or be published to a public repo so `npx skills add openbooks/...` works for anyone cloning? .gitignore currently ignores `.claude/`, `.agents/`, and `.mcp.json` — a committed skill must live somewhere tracked (e.g. a new top-level `skills/` dir or `docs/self-host/skill/`). Need Ansar's call on the canonical location.
69. Auto-provisioning depth: how far should the setup skill go unattended? Convex `npx convex dev --once` and `vercel link`/`vercel deploy` can be interactive/CLI-auth-gated, and provisioning a GitHub fork + Convex project + Vercel project touches the user's accounts. Confirm the skill should orchestrate-and-pause-for-confirmation rather than fully auto-provision, especially before any `--prod` deploy.
70. One-click Vercel Deploy button: research shows a Convex-on-Vercel marketplace template (get-convex/vercel-marketplace-convex) that provisions Convex + Vercel from a Deploy button. Do we want to invest in publishing an OpenBooks Vercel template for a true one-click path, or is the agent-skill + `pnpm setup` path sufficient for v1?
71. preflight provider coverage: which of the 14 AI providers must preflight actually reachability-check vs merely name-check in v1? Bedrock/OpenAI/Anthropic are clear; the long tail (Ollama, Google, OpenAI-compatible gateways) may only get a name-check. Confirm acceptable v1 coverage so E13-T4 isn't scoped to all 14.
72. Public security page depth: should /security be a polished marketing-grade trust page (threat model, data-handling summary, responsible-disclosure contact) or a lean honest code-cited statement for v1? A disclosure contact/email implies a process Ansar must commit to.
73. Domain/HTTPS guidance: the Stripe/Plaid webhook + redirect URLs require a stable public HTTPS origin (Convex `*.convex.site` + the Vercel domain). For a self-hoster without a custom domain, do we document the `*.vercel.app` + `*.convex.site` defaults as fully sufficient, and is OPENBOOKS_REAL_TEST_LIVE_CONNECTORS's HTTPS-redirect requirement (connections.ts:248) clearly explained for the live-key upgrade path?
74. Overlap with onboarding epic: the setup skill's step 9 (paste keys, set opening balances, run AI review) overlaps the guided onboarding/BYOK epic. Confirm E13 only documents/links those steps and the actual in-app key-entry UI + opening-balance posting are owned by the onboarding/connections epics, to avoid two epics editing connections.ts / OnboardingScreen.tsx concurrently.

## E14 — Quality — test suite, accounting invariants, categorization eval & security audit

75. GitHub Actions scope: AGENTS.md says do not deploy to Vercel or touch hosting accounts without explicit reauthorization. Does authoring a .github/workflows/ci.yml (which runs on push/PR) count as 'touching hosting'? If GitHub Actions is off-limits for now, T8 should ship a documented `pnpm ci` equivalent script instead of a live workflow — need Ansar's call.
76. Multi-currency epic ordering: E14-T1's per-currency regression guard and E14-T3's truncation guard are intentionally red-until-fixed against RC8/RC5. Confirm those root-cause fixes are owned by separate epics (multi-currency, reports/scale) so this epic ships the guards rather than the fixes — otherwise scope grows into the ledger/reports epics.
77. Disposable-book strategy for e2e against the SHARED Convex dev deployment: the safest pattern is creating a fresh workspace per spec, but realTestReset's startFullRebuild operates on real-entity tables. Confirm whether e2e should (a) only ever create new workspaces, or (b) be allowed to use a dedicated isolated entity — to guarantee Ansar's real Zikra/Z360 rows are never mutated by a test run.
78. Categorization eval without a live AI key in CI: the gold-dataset eval (T4) needs either a deterministic mock provider or a cheap real provider call. Confirm whether CI should run the eval against a recorded/mock provider (fully deterministic, no key) or skip the live-scoring run in CI and only assert the accuracy-math unit test there.
79. Dependency scan tooling: is `pnpm audit` sufficient for the security audit, or does Ansar want a dedicated SCA (e.g. Snyk/Trivy) and a secret-scanner (gitleaks/trufflehog) added as committed dev tooling? Affects T6 deliverables.

## E15 — Docs, Help Center, Landing & GTM — make OpenBooks publishable and explainable

80. Repo naming: the GitHub remote is github.com/AnsarUllahAnasZ360/open-accounting but the product is 'OpenBooks'. Will the public repo be renamed (e.g. to 'openbooks') before launch? All landing/README/outreach GitHub links depend on the final URL.
81. License intent: LICENSE is AGPL-3.0 and AGENTS.md/vision treat it as AGPL, but the landing/README say MIT in places. Confirm the final license is AGPL-3.0-only (this epic assumes AGPL and corrects all MIT claims). The vision doc's competitive table also lists OpenBooks 'Open source: MIT' in one row — confirm that is also corrected.
82. Public demo (E15-T6 / E11): is the no-login demo backend (isolated demo workspace, mutation guards, reset strategy) owned by E11, and is it shipping before launch? If not, what interim destination should the landing 'Try the demo' CTAs use so they never bounce a logged-out visitor?
83. Self-host story: the landing/FAQ claim a Docker / 'docker compose up' path, but the real stack is Convex cloud dev + Next.js on Vercel. Is a true Docker/self-host bundle planned (and owned by E13), or should all marketing drop the Docker claim and describe the Convex+Vercel BYO-keys flow?
84. Honest status table (E15-T4): confirm Ansar is comfortable publicly stating the audit reality (real-data posting and Stripe reconciliation are 'beta/in-progress') at launch, vs. holding the public launch until E1–E7 fixes land and the table can read 'working'.
85. Custom domain: docs/deployment/vercel.md references openbooks.ansarullahanas.com and a Vercel alias — should the landing/README/outreach point at the custom domain or the Vercel URL for the public launch?
86. Ansar inputs for the 'why' one-pager (E15-T7): the personal-story, QuickBooks/Bench-failure-moment, and audience sign-off slots need Ansar's words before that asset is launch-ready.
87. Issue seeding (E15-T10): converting the E0–E15 backlog into labeled GitHub issues requires repo-write auth Ansar controls — should the script be run by an agent with delegated auth, or staged for Ansar to execute?

</details>
