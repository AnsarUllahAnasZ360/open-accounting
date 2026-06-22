# OpenBooks Launch Sprint — Ticket Backlog

**~145 active tickets** across 15 epics.  Size: S≈18 · M≈97 · L≈30.  Risk: high(ledger/money)=18 · med≈54 · low≈73.

> **Rebuild note (authoritative):** scope is now governed by [decisions.md](decisions.md) +
> [plan-rebuild-changelog.md](plan-rebuild-changelog.md) — these override the old `open-questions.md`.
> The accounting ledger is **USD-only** (Ansar #3), so all general-ledger multi-currency / base-currency
> FX work is **cut**: E5-T4 loses its FX/normalization content (collapses to a trivial USD-only assertion,
> folded toward E5-T1), E1-T9 drops the `fxRate` write-hook (keeps only `contactId`), and the
> per-currency presentation/advisory work in E6-T7, E9-T3, E14-T1 collapses to single-currency USD.
> **Multi-currency survives ONLY in payroll** (E10-T3: convert foreign salary to USD at a day-of-pay
> rate, book USD). Other rebuild shifts: ONE unified encrypted `credentials` store owned by E3 (E2-T1/
> E4-T3 become consumers); BYO AI keys wired this sprint (E2/E3/E4/E8/E9); live connectors work locally
> (sandbox/test-only rule removed); Stripe webhook is **required** for a live connection (E3-T6);
> history window is **user-chosen** not a hardcoded 6 months (E4-T7); intercompany detection +
> read-time elimination owned by E5; public demo is **one shared no-login workspace** (E11).
> Per-ticket deltas are in the changelog; rows below are annotated only where scope changed materially.

High-risk tickets touch the ledger posting path or money math and must get adversarial verification before commit.

| Ticket | Epic | Title | Size | Risk | Depends on |
|---|---|---|---|---|---|
| E1-T1 | E1 | Gate Stripe fixture payouts to demo entities only | S | med | — |
| E1-T2 | E1 | Book opening balance (Dr Bank / Cr 3900) on bank connect | M | high | — |
| E1-T3 | E1 | Loosen the Stripe payout↔deposit matcher + add an explicit Inbox 'Match deposit to payout' action | M | high | — |
| E1-T4 | E1 | Per-payout clearing-zeroes invariant + drain residual 1160 In-Transit | L | high | E1-T3 |
| E1-T5 | E1 | Replace reports .take(5000) with date-ordered, complete loading (no half-posted entries) | M | high | — |
| E1-T6 | E1 | Fix cash-flow statement transfer/split double-counting + classification | M | med | — |
| E1-T7 | E1 | Fix income-by-customer / expense-by-vendor double-count | M | med | — |
| E1-T8 | E1 | '$X / N transactions unreviewed & excluded' signal on Reports + Dashboard | M | low | — |
| E1-T9 | E1 | Write contactId on journal lines so customer/vendor reports light up (fxRate hook CUT — USD-only; contactId only) | M | high | — |
| E1-T10 | E1 | Unify dashboard cash with report cash (one source) + bank-vs-books comparison | M | med | E1-T8 |
| E1-T11 | E1 | Replace coreViews hardcoded 12-month window + raw-transaction cash flow with server-clock, ledger-derived series | M | med | E1-T6 |
| E1-T12 | E1 | Bank reconciliation surface (mark cleared / adjust to bank / complete at diff=0) + period-close UI | L | high | E1-T2 |
| E2-T1 | E2 | Consume the unified credential resolver from E3 for BYO AI keys (close RC9 — no parallel store) | M | med | E3-T1 |
| E2-T2 | E2 | Provider-agnostic categorizer runtime on the AI SDK factory | L | med | E2-T1 |
| E2-T3 | E2 | Self-rescheduling backlog drainer (kill the 25-item cap) | M | low | E2-T2 |
| E2-T4 | E2 | Embedding generator + write semantic memory on every correction | L | med | E2-T1 |
| E2-T5 | E2 | Insert embedding/k-NN recall as a cascade stage before the LLM | L | med | E2-T2, E2-T4 |
| E2-T6 | E2 | Direction-aware candidate set (stop forcing refunds into income) | M | low | E2-T2 |
| E2-T7 | E2 | Truthful stage attribution + validate every LLM-returned id before posting | M | high | E2-T2, E2-T5 |
| E2-T8 | E2 | Populate the live-Plaid first pass with plaidPriorAccountId (and stop the empty first route) | M | med | E2-T7 |
| E2-T9 | E2 | Feed business context into the categorizer prompt + carry contactId | M | low | E2-T2 |
| E2-T10 | E2 | Activate calibration: fit from the holdout and gate on the calibrated probability | M | high | E2-T7 |
| E2-T11 | E2 | BYO key-entry UI + per-decision provenance + Top-N Inbox suggestions | L | low | E2-T1, E2-T7 |
| E3-T1 | E3 | Backend: ONE unified encrypted `credentials` store for ai/plaid/stripe/plunk (collapse aiCredentials + connectionCredentials; fix KDF) — E3 OWNS this; E2-T1/E4-T3 consume it | M | med | — |
| E3-T2 | E3 | Backend: provider-agnostic resolver + make providerStatus/setConfig credential-aware | L | med | E3-T1 |
| E3-T3 | E3 | Backend: route categorizer + Ask-AI chat + test-connection through the provider-agnostic runtime | L | med | E3-T2 |
| E3-T4 | E3 | UI: replace the dead AI provider/model field with a real BYO provider+model switcher | M | low | E3-T1, E3-T2 |
| E3-T5 | E3 | Plaid: map each linked account → a business at link time (split a multi-LLC Plaid item) | L | med | — |
| E3-T6 | E3 | Stripe: webhook REQUIRED + verified before a live connection reports 'listening' (min event set incl. payout.reconciliation_completed; polling = backfill only) | M | med | — |
| E3-T7 | E3 | Plunk: in-UI BYO key entry + validate + prefer saved key over env | M | low | — |
| E3-T8 | E3 | Per-connection health/validate/re-link across all providers + connectionsHealth query | M | low | E3-T1, E3-T3, E3-T6, E3-T7 |
| E3-T9 | E3 | Redesign the Connections settings surface: responsive, grouped-by-business, guide links, copyable URLs | M | low | E3-T4, E3-T8 |
| E3-T10 | E3 | Secret-safety audit + redaction tests across all integration queries and errors | S | low | E3-T1, E3-T6, E3-T7, E3-T8 |
| E4-T1 | E4 | Onboarding data model + state machine: persisted, resumable, multi-business progress | M | low | — |
| E4-T2 | E4 | Multi-business creation in onboarding + bootstrap rework | M | low | E4-T1 |
| E4-T3 | E4 | BYO AI key + provider/model picker wired end-to-end via E3's unified resolver (the activation blocker; no parallel aiCredentials store) | L | med | E4-T1, E3-T1 |
| E4-T4 | E4 | Inline setup steps do REAL work: AI, Plunk, Plaid+mapping, Stripe-per-business, with URLs + guide links | L | med | E4-T1, E4-T3 |
| E4-T5 | E4 | Opening balances step: book balanced opening entries into account 3900 (USD-only — multi-currency opening balances CUT; date them the first of the month) | M | high | E4-T1, E4-T2 |
| E4-T6 | E4 | Invite-team step + self-host vs invited-join branching | M | low | E4-T1 |
| E4-T7 | E4 | AI bulk-setup engine: sync USER-CHOSEN history (default = all the connector gives, not a hardcoded 6mo), ask questions, PROPOSE income streams + categories + rules | L | med | E4-T1, E4-T3, E4-T4 |
| E4-T8 | E4 | Human review & approve screen for AI onboarding proposals | M | med | E4-T7 |
| E4-T9 | E4 | Finish: AI runs the books + land on a fully-populated org | M | med | E4-T5, E4-T8 |
| E4-T10 | E4 | Owner data reset / re-onboard + public no-login demo | L | med | E4-T1, E4-T2 |
| E5-T1 | E5 | Schema + deterministic default business; kill the hardcoded acme-studio-llc fallback | M | med | — |
| E5-T2 | E5 | Scope contract: 'all' | entityId end-to-end (validators, ActiveEntityProvider, entityArg) | M | low | E5-T1 |
| E5-T3 | E5 | AppShell scope switcher UI: 'All businesses / Zikra / Z360' replacing business-type filter | M | low | E5-T2 |
| ~~E5-T4~~ | E5 | ~~Base-currency FX policy + portfolio money helpers~~ → **CUT (USD-only).** FX/normalization deleted; roll-up is plain USD summation. Residual "default-business / kill acme-studio-llc fallback" folds into E5-T1 | — | — | — |
| E5-T5 | E5 | Intercompany transfer detection + flagging between workspace entities | L | med | E5-T1 |
| E5-T6 | E5 | Portfolio roll-up read model + Portfolio dashboard query (combined cash/AR/AP/revenue/expense/runway + by-business) | L | high | E5-T2, E5-T5 |
| E5-T7 | E5 | Consolidated reports with intercompany elimination (scope=all P&L / Balance Sheet; USD-only summation − eliminated pairs) | L | high | E5-T5, E5-T6 |
| E5-T8 | E5 | Portfolio dashboard UI + per-page portfolio behavior + reconcile cash source | L | med | E5-T6, E5-T7 |
| E5-T9 | E5 | First-class bank/Stripe→business association (re-map mutation + Connections UI) | M | med | E5-T1 |
| E5-T10 | E5 | Multi-entity authorization hardening + scope=all authz tests | M | med | E5-T6, E5-T7 |
| E6-T1 | E6 | Fix Cash Flow report responsiveness — kill horizontal overflow, add mobile stacked layout | M | low | — |
| E6-T2 | E6 | Redesign report home grid + viewer chrome for ledger-grade clarity and responsiveness | M | low | E6-T1 |
| E6-T3 | E6 | CSV export ⇄ on-screen parity for all 12 reports + parity test harness | M | low | E6-T1 |
| E6-T4 | E6 | Universal number→drill-down: make every report figure open its journal lines | L | med | E6-T1, E6-T3 |
| E6-T5 | E6 | Cash⇄accrual basis clarity: persistent basis badge + honest exclusion labeling | S | low | E6-T2 |
| E6-T6 | E6 | Period presets that never go future + true compare-to-prior columns | M | med | E6-T3, E6-T5 |
| E6-T7 | E6 | Portfolio / consolidated report scope ('All businesses') wired to E5 scope switcher (USD-only: single consolidated total, no per-currency breakdown; intercompany ELIMINATED) | L | med | E6-T2, E6-T6 |
| E6-T8 | E6 | Per-report loading skeletons, empty states, and error boundary | M | low | E6-T1, E6-T2 |
| E6-T9 | E6 | Honest 'unreviewed / excluded $X' + truncation banner on every report | M | low | E6-T5, E6-T8 |
| E6-T10 | E6 | Per-report insight banner + Reports regression test/screenshot evidence pack | M | low | E6-T1, E6-T2, E6-T3, E6-T4, E6-T5, E6-T6, E6-T7, E6-T8, E6-T9 |
| E7-1 | E7 | Surface a typed provenance label from the transactions query | S | low | — |
| E7-2 | E7 | ProvenanceChip component in the workbench design vocabulary | S | low | E7-1 |
| E7-3 | E7 | Compact merchant column: move raw description behind an expand toggle | M | med | E7-2 |
| E7-4 | E7 | Provenance + status column correctness and de-duplication | S | low | E7-1, E7-3 |
| E7-5 | E7 | Mobile-real register: clean card list, priority columns, no horizontal scroll | M | med | E7-3 |
| E7-6 | E7 | Bulk recategorize with a chosen category + register keyboard model | M | med | E7-3 |
| E7-7 | E7 | Split / exclude / recategorize clarity as reverse+repost corrections | S | med | E7-3 |
| E7-8 | E7 | One compact per-page insight banner above the register (E8 coordination) | M | low | E7-1 |
| E7-9 | E7 | Saved views / filters / group / sort polish + de-duplicate the filter rail | M | low | E7-3, E7-5, E7-10 |
| E7-10 | E7 | Remove hardcoded demo dates from the register defaults | S | low | — |
| E7-11 | E7 | Register evidence pack + full gate | S | low | E7-3, E7-4, E7-5, E7-6, E7-7, E7-8, E7-9, E7-10 |
| E8-T1 | E8 | Add a shared server-clock 'today' hook and remove the hardcoded TODAY_ISO anchor | S | low | — |
| E8-T2 | E8 | De-hardcode the remaining insights/aging date anchors in ModuleScreens, CoreScreens, and coreViews | M | med | E8-T1 |
| E8-T3 | E8 | Build the reusable InsightBanner component + a page-insight registry | M | low | — |
| E8-T4 | E8 | Wire the InsightBanner into Transactions, Income, Expenses, and the Dashboard | M | low | E8-T3, E8-T1 |
| E8-T5 | E8 | Wire the InsightBanner into Contacts, Payroll, and fill the Bills Insights gap | M | low | E8-T3, E8-T1, E8-T2 |
| E8-T6 | E8 | Replace fixture-driven insight numbers with real ledger-derived metrics and fence the dev fixture | S | low | E8-T3 |
| E8-T7 | E8 | Redesign + responsive pass on the per-section Insights dashboards for consistency | M | low | E8-T5 |
| E8-T8 | E8 | AI narrative layer on banners + observations that strictly narrates programmatic numbers | M | low | E8-T3, E8-T4 |
| E8-T9 | E8 | e2e + verification pack for banners, the clock fix, and Bills Insights | M | low | E8-T4, E8-T5, E8-T1 |
| E9-T1 | E9 | Dashboard cash + cash-flow correctness: ledger-derived, transfer-aware, reconciliation line | L | high | — |
| E9-T2 | E9 | Kill hardcoded dashboard/insights time windows — derive every window from a server-clock asOf | M | med | E9-T1 |
| E9-T3 | E9 | CFO advisory aggregate: compute grounded runway/burn, trend, expense-creep, concentration, forecast, tax set-aside from the ledger (USD-only sums, no per-currency/refuse-to-sum path; tax set-aside default 30%) | L | med | E9-T1 |
| E9-T4 | E9 | CFO advisory engine: provider-agnostic narration with deterministic fallback (never Bedrock-only) | L | med | E9-T3 |
| E9-T5 | E9 | Advisor surface on the dashboard: 'How am I doing / what should I worry about' with drill-down + real-time refresh | M | low | E9-T4 |
| E9-T6 | E9 | Weekly digest email via Plunk: compose grounded summary, cron trigger, settings-gated, idempotent | M | low | E9-T3 |
| E9-T7 | E9 | Advisor Ask-AI tools: getRunway + getAdvisories so chat answers 'how am I doing / what should I worry about' | M | low | E9-T4 |
| E9-T8 | E9 | Revenue-by-stream view: stream taxonomy over income accounts + dashboard widget reconciling to P&L | M | med | E9-T2 |
| E9-T9 | E9 | Anomaly + duplicate detection signal: ground the 'what should I worry about' warnings | M | low | E9-T3 |
| E10-T1 | E10 | End-to-end verify the payroll lifecycle on a multi-currency roster (tests + screenshots) | M | low | — |
| E10-T2 | E10 | Fix the date-blind, token-narrow, currency-blind payroll bank matcher (RC10 double-count) | M | high | E10-T1 |
| E10-T3 | E10 | Multi-currency FX correctness at settlement — the ONLY surviving multi-currency: fetch a day-of-pay rate (replace hardcoded PKR:278/INR:83), keep manual override, convert-to-USD, book USD | M | high | E10-T2 |
| E10-T4 | E10 | Surface payroll as the largest expense line in Expenses + reconcile to Reports | M | med | E10-T1 |
| E10-T5 | E10 | Pay schedules + safe auto-draft UI and per-currency statements | M | low | E10-T1, E10-T3 |
| E10-T6 | E10 | Payroll insight banner (run-rate / headcount cost / FX exposure) + remove hardcoded dates | M | low | E10-T1, E10-T4 |
| E10-T7 | E10 | Harden default-entity resolution + settlement bank selection (remove demo-slug coupling) | S | med | E10-T1 |
| E11-T1 | E11 | Kill the demo-slug fallback so demo data can't leak into real reads | M | med | — |
| E11-T2 | E11 | Mark demo entities/workspaces explicitly and add a demoWorkspaces registry | S | low | E11-T1 |
| E11-T3 | E11 | Per-workspace 'Reset to factory' (scoped, confirmed, audited) + re-runnable onboarding | L | med | E11-T1, E11-T2 |
| E11-T4 | E11 | Provision an isolated public demo workspace + seed it (separate from any real workspace) | L | med | E11-T2 |
| E11-T5 | E11 | Public no-login /demo route — ONE shared workspace, NO anonymous Convex Auth identity; resolve by slug server-side | L | med | E11-T4 |
| E11-T6 | E11 | Server-side read-only guard so the demo (and any demo identity) cannot write | M | high | E11-T4, E11-T5 |
| E11-T7 | E11 | Harden the existing global realTestReset with an auditEvents record + workspace-scope safety copy | S | med | E11-T3 |
| E11-T8 | E11 | Scheduled cron to reset+re-seed the public demo so prospect edits never persist | M | low | E11-T4 |
| E11-T9 | E11 | Full-account data export ('your books are a file you own') | M | low | E11-T1 |
| E11-T10 | E11 | e2e + invariants: reset→re-onboard→demo isolation→export, plus docs | M | low | E11-T3, E11-T5, E11-T6, E11-T9 |
| E12-T1 | E12 | Shared Settings layout primitives (page header, save-bar, section shell, empty state) | M | low | — |
| E12-T2 | E12 | Edit-a-business: entities.updateProfile mutation + merge legal/tax fields into the Businesses card | M | low | E12-T1 |
| E12-T3 | E12 | Categories as a chart-of-accounts-friendly manager (move group, account-number + normal-side affordances) | M | med | E12-T1 |
| E12-T4 | E12 | Rules builder: ordered condition GROUPS + 'test all active rules' runner | L | med | E12-T1 |
| E12-T5 | E12 | Notifications: editable delivery email, weekly-digest cadence, honest Plunk state + deep-link to Connections | M | low | E12-T1 |
| E12-T6 | E12 | Team: role change, member removal, surfaced invite revoke — with last-owner guard | M | low | E12-T1 |
| E12-T7 | E12 | Audit log: real paginated, server-filtered query (drop the 200-row in-memory cap) | M | med | E12-T1 |
| E12-T8 | E12 | App-shell scope switcher: 'All businesses' + per-entity, with active-entity context contract for E5 | L | med | E12-T1 |
| E12-T9 | E12 | App-shell responsiveness + nav polish (sidebar, header, mobile sheet, settings subnav) | M | low | E12-T1, E12-T8 |
| E12-T10 | E12 | Settings e2e + a11y regression pack covering every section's real actions | M | low | E12-T2, E12-T3, E12-T4, E12-T5, E12-T6, E12-T7, E12-T8 |
| E13-T1 | E13 | Author the openbooks-self-host AI-agent skill (SKILL.md + provisioning steps) | M | low | E13-T2, E13-T6 |
| E13-T2 | E13 | pnpm setup — one-shot bootstrap that writes .env.local, mints keys, and sets Convex env | M | low | — |
| E13-T3 | E13 | Add a `setup` mode to dev:full and document one-command local boot honestly | S | low | E13-T2 |
| E13-T4 | E13 | Generalize preflight for any AI provider (drop sandbox/test enforcement — live connectors work locally; keep encryption-at-rest) | M | low | — |
| E13-T5 | E13 | Write the security-posture doc and a public /security page, verified against code | M | low | — |
| E13-T6 | E13 | Prerequisites + env checklist (doc + machine-checkable) kept in sync with preflight | M | low | E13-T4 |
| E13-T7 | E13 | Public /setup instructions page surfacing the live redirect/webhook URLs | M | low | E13-T5, E13-T6 |
| E13-T8 | E13 | Generic-ize deployment docs, add a secret-scan gate, and a deploy-to-prod runbook | M | low | E13-T5 |
| E13-T9 | E13 | End-to-end self-host dry-run validation + final cross-check | M | low | E13-T1, E13-T2, E13-T3, E13-T4, E13-T5, E13-T6, E13-T7, E13-T8 |
| E14-T1 | E14 | Accounting invariant test: single-currency (USD) trial balance & balanced-entry property (was 'per-currency' — USD-only) | M | high | — |
| E14-T2 | E14 | Stripe clearing/in-transit zero-out invariant + no-fixtures-on-real-books test | M | high | E14-T1 |
| E14-T3 | E14 | Reversal-is-exact-inverse & post-truncation balance invariant tests | M | high | E14-T1 |
| E14-T4 | E14 | Committed label-safe categorization gold dataset + eval runner with threshold gate | M | med | — |
| E14-T5 | E14 | Authz coverage audit matrix + automated unauthenticated/cross-workspace rejection tests | L | med | — |
| E14-T6 | E14 | Security audit pass: secret handling, encryption-at-rest, webhook verification, git-history & dependency scan | L | med | E14-T5 |
| E14-T7 | E14 | E2E for new go-live flows on disposable books: onboarding, BYO-key connections, reset, portfolio scope, reconciliation | L | med | E14-T4 |
| E14-T8 | E14 | CI gate: extend pnpm verify with convex tsc, add e2e job, and document the gate | M | low | E14-T1, E14-T2, E14-T3, E14-T4, E14-T5, E14-T7 |
| E15-T1 | E15 | Relicense to MIT everywhere: replace the AGPL-3.0 LICENSE file with MIT, flip README/vision/AGENTS, verify the landing's MIT claims | S | low | — |
| E15-T2 | E15 | Correct false/stale landing claims: Docker path, history window, demo CTAs, repo name | M | low | E15-T6 |
| E15-T3 | E15 | Build the in-app conceptual Help Center for non-accountant owners | L | low | E15-T1 |
| E15-T4 | E15 | Rewrite README to lead with the portfolio differentiator, real quickstart, and an honest status table | M | low | E15-T1 |
| E15-T5 | E15 | Author the setup-instructions + security-posture page (prerequisites and the 3 manual steps) | M | low | E15-T4 |
| E15-T6 | E15 | Specify and wire the public no-login demo entry point (coordinate E11) | M | med | — |
| E15-T7 | E15 | Draft the 'Why I'm building this' one-pager with marked Ansar-input slots | S | low | E15-T1 |
| E15-T8 | E15 | Write the 3-minute demo-video script with shot list and captions | M | low | E15-T6 |
| E15-T9 | E15 | Produce outreach messaging templates (Show HN, social thread, owner DM, README blurb) | S | low | E15-T4, E15-T6 |
| E15-T10 | E15 | Add governance files and a GitHub publication + secret-scan checklist; convert the backlog to labeled issues | M | med | E15-T1, E15-T4 |
| E15-T11 | E15 | Full landing/GTM review pass: consistency, responsiveness, and honest-claims audit | M | low | E15-T1, E15-T2, E15-T3, E15-T4, E15-T5, E15-T6, E15-T7 |
