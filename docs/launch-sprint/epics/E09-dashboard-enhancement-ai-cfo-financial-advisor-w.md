# E9 — Dashboard enhancement + AI CFO / Financial Advisor + weekly digests

> Part of the **OpenBooks Launch Sprint**. Master plan: [../README.md](../README.md) · Backlog: [../backlog.md](../backlog.md)

**Goal.** Turn OpenBooks from a passive ledger into a proactive financial advisor. (1) Make the dashboard cash + cash-flow numbers correct (ledger-derived, not the live Plaid balance and not raw-transaction sums), and drive every window off the server clock instead of a frozen 12-month array. (2) Ship an "AI CFO" advisory engine that produces grounded, plain-English advice from the ledger — runway/burn, income-trend-down, expense-creep, anomalies/duplicates, customer concentration, a short cash-flow forecast, and a tax set-aside estimate — always derived from posted journal numbers, never fabricated. (3) Deliver a weekly plain-English digest by Plunk email (revenue/expense/profit deltas + top advice). (4) Add an advisor surface ("how am I doing / what should I worry about") plus advisor Ask-AI tools. (5) Add a revenue-by-stream view over an owner-approved stream taxonomy (the onboarding AI proposes streams from history — e.g. marketing services, Z360 product, AI consulting — and the owner approves; taxonomy defined once, shared with E2/E4; decided: see decisions.md Q49).

**Why it matters.** This is the differentiator. Bookkeeping that is merely "correct" is a commodity; what makes an owner keep an app open is it telling them — in their own language, on a Monday morning — "your income is trending down, AWS spend crept 22%, and at this burn you have 4.1 months of runway; set aside ~$3,100 for tax." Right now the dashboard actively erodes trust: the cash tile reads the live Plaid balance while reports read the ledger, so the two cash numbers disagree and Ansar concludes "the books don't match." Worse, the cash-flow chart sums raw transaction amounts, double-counting transfers between his own accounts and gross Stripe deposits. Fixing those, then layering grounded advice and a weekly digest on top, is what lets Ansar actually run his two LLCs on this product and what gives the open-source project a reason to exist next to QuickBooks.

## Current state

Dashboard data is computed in convex/coreViews.ts `dashboard` (lines 102-520). Confirmed defects: (1) cash tile uses the LIVE Plaid balance, not the ledger — coreViews.ts:180 (`amountMinor = bankAccount.plaidAccountId ? bankAccount.balanceMinor : ledgerBalanceMinor`), which diverges from the Balance Sheet (reportViews.ts:598) → RC7 in docs/finishing/accounting-engine-blueprint.md:293-300. (2) `cashFlowByMonth` (coreViews.ts:201-216) and `cashSparkline` (470-473) sum raw `transaction.amountMinor`, double-counting own-account transfers and gross Stripe deposits → blueprint:351. (3) the 12-month window is a hardcoded `months` array 2025-07…2026-06 (coreViews.ts:12-25) → RC6 (blueprint:280-291). (4) due-soon count hardcodes "2026-06-30" (coreViews.ts:456). (5) the front-end InsightsScreen freezes TODAY_ISO = "2026-06-30" (InsightsScreen.tsx:32) and Ask-AI defaults to a calendar-2026 window (agentToolQueries.ts:35). Advisory engine: only convex/aiInsights.ts exists — a per-section (transactions/income/expenses/bills/contacts/payroll) summary with a deterministic fallback, but it calls Bedrock DIRECTLY (aiInsights.ts:196-207) so it is dead unless the operator has AWS env vars (RC9), and it has NO CFO concepts (runway, forecast, anomalies, tax). A provider-agnostic runtime ALREADY exists in convex/aiChatRuntime.ts (AI SDK generateText, lines 1-160) and convex/aiProvider.ts (buildModelForProvider, decrypts BYO aiCredentials) — the CFO engine should reuse that, not Bedrock. Email: packages/email/src/plunk.ts sendPlunkEmail is ready and gated on PLUNK_SECRET_KEY; convex/crons.ts has Plaid + payroll crons but NO digest cron; workspaceSettings.notifications.digest boolean already exists (schema.ts:43-53). Revenue-by-stream already exists per-income-account in incomeViews.ts:315-348 but has no owner-facing stream taxonomy. Dashboard charts live in apps/web/src/components/openbooks/dashboard/DashboardViz.tsx and render in apps/web/src/components/openbooks/CoreScreens.tsx DashboardScreen (lines 239-~500). E9(a) coordinates with E1 (cash/cashflow correctness) and the portfolio/scope work; this epic assumes entity-scoped reads and consumes whatever scope object E1/E2 land.

## Definition of done (epic)

- [ ] Dashboard cash tile and the Balance Sheet cash line read the SAME ledger-derived number for a given entity+period; any divergence from the bank's live balance is shown as an explicit reconciliation line ('bank says X / books say Y / N items to review'), never as a silent contradiction (coreViews.ts:180 removed as the cash source).
- [ ] Dashboard cash-flow chart and runway are derived from posted journal lines on cash accounts (or a transfer-aware transaction set), NOT raw transaction.amountMinor sums; a unit test proves a self-transfer between two own accounts nets to zero in the chart.
- [ ] No hardcoded date or month window remains in the E9 surface: the dashboard month list, due-soon cutoff, InsightsScreen TODAY_ISO, and advisor windows all derive from a single server-clock asOf (grep for '2026-06-30', the literal months array, and TODAY_ISO in the E9 files returns nothing).
- [ ] An advisory engine (convex/aiCfo.ts) returns a typed list of grounded advisory cards (runway/burn, income trend, expense creep, anomaly/duplicate, customer concentration, cash-flow forecast, tax set-aside), each carrying the exact ledger numbers it was computed from and a deterministic fallback; a test asserts every numeric claim traces to an aggregate field (no model-invented numbers). All amounts are USD integer minor units summed directly — no per-currency separation, no refuse-to-sum (USD-only GL; decided: see decisions.md Q48).
- [ ] The advisory engine runs through the provider-agnostic AI SDK runtime (buildModelForProvider / aiChatRuntime path), resolving keys from the unified `credentials` table owned by E3, and degrades to deterministic advice when no AI key is configured — it never hard-requires Bedrock (BYO keys land this sprint in E3; decided: see decisions.md Q11/Q44).
- [ ] A weekly digest action composes a plain-English email (revenue/expense/profit deltas + top 3 advisory cards) and sends it via sendPlunkEmail; a Convex cron triggers it weekly, respects workspaceSettings.notifications.digest, is a no-op when PLUNK_SECRET_KEY is unset, and is idempotent per (workspace, week).
- [ ] An advisor surface on the dashboard ('How am I doing?' / 'What should I worry about?') renders the advisory cards, ties each to a drill-down, and lets the owner trigger a real-time refresh; two new Ask-AI advisor tools (getRunway/getAdvisories or equivalent) are registered and answer grounded.
- [ ] A revenue-by-stream view maps income ledger accounts to Ansar's stream taxonomy and renders on the dashboard, reconciling to the P&L revenue total for the period.
- [ ] Gates green: pnpm typecheck, pnpm lint, pnpm build, the Convex unit suite (new aiCfo/digest tests included), and at least one e2e covering the advisor surface render.

## Tickets (9)

### E9-T1 — Dashboard cash + cash-flow correctness: ledger-derived, transfer-aware, reconciliation line
`size: L` · `risk: high` · `depends on: E1 transfer/intercompany flag, E5 intercompanyPairId`

**Intent.** Stop the dashboard from contradicting the reports. Make the cash tile read the ledger (same source as the Balance Sheet), make the cash-flow chart transfer-aware so own-account transfers and gross Stripe deposits don't double-count, and surface the bank-vs-books gap explicitly.

**Changes**

- In convex/coreViews.ts dashboard, change bankBalances so the cash POSITION used by the tile is ledger-derived (normalBalance over the linked ledger account), not the live-balance branch at coreViews.ts:180. Keep the live Plaid balanceMinor as a separate liveBalanceMinor field per account.
- Add a top-level cashReconciliation block to the return: { booksCashMinor, bankCashMinor, differenceMinor, itemsToReviewCount } where itemsToReview = transactions with review === 'needs_review' and/or entryId == null (the unposted backlog that explains the gap, RC1/RC7).
- Replace the cashFlowByMonth raw-transaction sum (coreViews.ts:201-216) and the derived cashSparkline (470-473) with a transfer-aware source: prefer posted journal lines on cash ledger accounts (debits=inflow, credits=outflow) grouped by entry month; exclude internal-transfer entries via the **canonical transfer/intercompany flag landed by E1/E5** — `transferPairId` (own-account transfer) and `intercompanyPairId` (cross-entity transfer). **No interim heuristic and no conflicting marker** — consume the existing matcher's pairing (decided: see decisions.md Q45). Intercompany legs are never income/expense.
- Keep money as integer minor units; do NOT touch convex/ledger.ts posting math.
- Update CoreScreens.tsx DashboardScreen cash tile (~301-345) to render the reconciliation line ('Bank says X / Books say Y / N to review') when differenceMinor !== 0, using existing primitives (Amount/formatMinorMoney).
- Add a Convex unit test that posts a self-transfer between two own cash accounts and asserts it contributes 0 to cashFlowByMonth.netMinor and to the sparkline.

**Files:** `convex/coreViews.ts:102`, `convex/coreViews.ts:180`, `convex/coreViews.ts:201`, `convex/coreViews.ts:470`, `apps/web/src/components/openbooks/CoreScreens.tsx:239`, `docs/finishing/accounting-engine-blueprint.md:293`

**Definition of done**

- [ ] For a given entity+period the dashboard cashPositionMinor equals the Balance Sheet cash line from reportViews (same ledger source); a test asserts equality on a seeded entity.
- [ ] A posted self-transfer between two own cash accounts nets to 0 in cashFlowByMonth and the sparkline (unit test).
- [ ] The cash tile shows an explicit 'bank says / books say / N to review' line whenever the live bank balance differs from books, and never shows two unexplained cash numbers.
- [ ] No raw transaction.amountMinor sum remains as the cash-flow chart source.

**Deliverables:** Edited convex/coreViews.ts (ledger-derived cash + cashReconciliation + transfer-aware cashFlowByMonth); Edited apps/web/.../CoreScreens.tsx (reconciliation line); convex/coreViews.cashflow.test.ts (transfer-nets-to-zero + cash==balance-sheet)

**Verify.** Root vitest coreViews.cashflow test green; manually: open dashboard, confirm cash tile == Reports Balance Sheet cash; seed a transfer and confirm the cash-flow chart does not move.

### E9-T2 — Kill hardcoded dashboard/insights time windows — derive every window from a server-clock asOf
`size: M` · `risk: med` · `depends on: E9-T1`

**Intent.** RC6: hardcoded dates freeze the dashboard, insights, and Ask-AI to mid-2026 so 'this month' resolves to a stale/empty window. Derive all windows from one server-clock asOf so the product keeps working as the calendar moves.

**Changes**

- In convex/coreViews.ts, replace the literal months array (coreViews.ts:12-25) with a function that builds the trailing-12-month list ending at asOf. Since Convex queries can't call Date.now(), add an optional asOf ISO arg defaulting on the client; document why queries can't read the clock.
- Replace the hardcoded '2026-06-30' due-soon cutoff (coreViews.ts:456) with asOf/periodEnd.
- In InsightsScreen.tsx replace TODAY_ISO = '2026-06-30' (line 32) and the dormant-contact '2026-04-01' threshold (~1324) with a value derived from new Date() (client) passed into the scope resolver and section queries.
- In convex/agentToolQueries.ts replace the default calendar-2026 date window (~35) with a window derived from request time (compute in the action layer and pass asOf to the query).
- Note the removed literals ('2026-06-30', TODAY_ISO) in the PR description so reviewers can confirm removal in E9 files.

**Files:** `convex/coreViews.ts:12`, `convex/coreViews.ts:456`, `apps/web/src/components/openbooks/InsightsScreen.tsx:32`, `apps/web/src/components/openbooks/InsightsScreen.tsx:1324`, `convex/agentToolQueries.ts:35`, `docs/finishing/accounting-engine-blueprint.md:280`

**Definition of done**

- [ ] grep for '2026-06-30', the literal months array, and 'TODAY_ISO' across the E9 files returns nothing.
- [ ] Dashboard trailing-12-month chart and 'this month' selector resolve relative to the request/current date, verified by passing asOf and asserting months/selectedMonth shift.
- [ ] Ask-AI 'this month' report range resolves to the month containing the current date, not a frozen 2026 window.

**Deliverables:** Edited convex/coreViews.ts, convex/agentToolQueries.ts, apps/web/.../InsightsScreen.tsx; convex/coreViews.window.test.ts asserting the trailing-12 list shifts with asOf

**Verify.** Unit test: call dashboard with asOf='2027-03-15' and assert months ends at '2027-03'. Manual: dashboard period selector defaults to the current month.

### E9-T3 — CFO advisory aggregate: compute grounded runway/burn, trend, expense-creep, concentration, forecast, tax set-aside from the ledger
`size: L` · `risk: med` · `depends on: E9-T1`

**Intent.** Build the deterministic, ledger-grounded numeric core of the AI CFO. This is the source of truth the model is allowed to narrate — every advisory number must come from here so nothing is fabricated. No AI in this ticket; pure aggregation over posted journal lines and existing views.

**Changes**

- Create convex/aiCfoAggregate.ts (internal query, entity-scoped via the same auth as coreViews getActiveEntity). Reuse the dashboard's monthlyPnl / cashPosition / cushion math so numbers reconcile.
- Compute, in **USD integer minor units summed directly** (USD-only GL — no per-currency separation, no refuse-to-sum; decided: see decisions.md Q48): (a) runway/burn — avg monthly net cash outflow over trailing N months and months-of-cash = cashPosition / burn (mirror coreViews cashCushion, 326); (b) income trend — current vs prior 3-month avg revenue with % delta; (c) expense creep — per-category MoM and vs-trailing-avg deltas, flag categories up > threshold (R6 §B floor: ≥25% AND ≥$200); (d) customer concentration — top customer % of period revenue from the income-by-customer ledger rollup (incomeViews:350), warn at >10% single / >25% top-5 (R6 §B); (e) cash-flow forecast — naive forward projection (trailing net run-rate + scheduled bills/invoices/payroll from comingUp, coreViews:330-369) for the next 30/60/90 days; (f) tax set-aside — estimated reserve = `taxSetAsidePct × period net income`, **default 30% of trailing book net income** (decided: see decisions.md Q46 / R6 §D — 30% is the conservative end of the 25–30% rule: SE tax ~14.13% + typical federal bracket; state tax is why it's editable). Flat workspace rate for v1 (NOT per-entity); surfaced as a 'money to park' estimate with a mandatory 'not tax advice' disclaimer.
- Add a single configurable workspace setting `taxSetAsidePct` (default `0.30`) that the tax signal reads (decided: see decisions.md Q46). Add an informational quarterly 1040-ES deadline countdown + safe-harbor copy (estimate only, not advice).
- Return a typed CfoSignals object: each signal carries { key, severity: 'info'|'watch'|'warn', metricMinor, comparatorMinor, deltaPct, asOf, basisAccountIds } so the UI and the model both bind to the same fields.
- Add a Convex unit test asserting each signal's numbers reconcile to the underlying view (runway = cashPosition/burn within rounding; concentration % matches incomeViews top customer).

**Files:** `convex/coreViews.ts:320`, `convex/incomeViews.ts:350`, `convex/reportViews.ts:613`, `convex/aiInsights.ts:303`

**Definition of done**

- [ ] convex/aiCfoAggregate.ts returns a CfoSignals object with all seven signal families, entity-scoped and auth-checked.
- [ ] Each signal's metricMinor/deltaPct reconciles to the corresponding existing view (unit test).
- [ ] Runway = cashPosition / trailing burn; forecast uses comingUp scheduled items; tax set-aside is clearly an estimate at the configurable `taxSetAsidePct` (default 30%; decided: see decisions.md Q46).
- [ ] All amounts are **USD** integer minor units summed directly (no per-currency separation; decided: see decisions.md Q48); no float storage; ledger posting path untouched (risk med not high).

**Deliverables:** convex/aiCfoAggregate.ts; convex/aiCfoAggregate.test.ts

**Verify.** vitest convex/aiCfoAggregate.test.ts green; spot-check runway and concentration against the dashboard for a seeded entity.

### E9-T4 — CFO advisory engine: provider-agnostic narration with deterministic fallback (never Bedrock-only)
`size: L` · `risk: med` · `depends on: E9-T3, E3-T1/E3-T2 (unified credential store + provider-agnostic resolver)`

**Intent.** Wrap the grounded aggregate (E9-T3) in an action that turns signals into plain-English advisory cards via the BYO-key AI SDK runtime, with a deterministic fallback. Fixes RC9 for the advisory layer: it must NOT hard-require Bedrock like aiInsights.ts:196-207 does.

**Changes**

- Create convex/aiCfo.ts generateAdvisories action (mirror convex/aiInsights.ts:156-223 but call the provider-agnostic path).
- Resolve the model via convex/aiProvider.ts buildModelForProvider + the workspace's active config through the **unified credential resolver owned by E3** (the single `credentials` table, `kind:"ai"`, workspace-scoped, `secretBox`-decrypted) — NOT bedrockRuntimeEnv and NOT the dead per-field `aiCredentials` shape (decided: see decisions.md Q18/Q11). This action is a **consumer** of E3's resolver; do not build a parallel credential read path.
- Build a strict-JSON prompt: feed the CfoSignals JSON, instruct the model to narrate ONLY the provided numbers (Digits/Puzzle real-time burn & runway advisory style), forbid inventing numbers, return { summary, cards:[{ title, body, severity, signalKey }] }. Reuse aiInsights' parseFirstJsonObject/parseInsightsJson defensive parsing.
- Build a DETERMINISTIC fallback set of cards directly from the signals (e.g. 'Runway: ~4.1 months at current burn'; 'Income down 12% vs your 3-month average'; 'AWS up 22% vs trailing average') so advice always renders, AI or not. The fallback is the safety net AND the ground truth.
- Add a test asserting: (1) with no AI key the action returns the deterministic cards; (2) every number in any returned card appears in the source CfoSignals (parse cards for currency tokens and check membership).

**Files:** `convex/aiInsights.ts:156`, `convex/aiChatRuntime.ts:124`, `convex/aiProvider.ts:44`, `convex/aiProvider.ts:83`

**Definition of done**

- [ ] convex/aiCfo.ts generateAdvisories returns advisory cards using the BYO-provider AI SDK runtime; with no key configured it returns deterministic cards and never throws.
- [ ] No reference to bedrockRuntimeEnv/Bedrock-only env in aiCfo.ts; it goes through buildModelForProvider.
- [ ] A test proves every numeric claim in returned cards traces to a CfoSignals field (no model-invented numbers).
- [ ] Disclaimer string ('AI-generated estimate, review before relying') present on the result.

**Deliverables:** convex/aiCfo.ts; convex/aiCfo.test.ts (deterministic-fallback + no-fabricated-numbers)

**Verify.** vitest convex/aiCfo.test.ts green; with a BYO key set, manually trigger and confirm cards narrate the real numbers; with no key, confirm deterministic cards.

### E9-T5 — Advisor surface on the dashboard: 'How am I doing / what should I worry about' with drill-down + real-time refresh
`size: M` · `risk: low` · `depends on: E9-T4`

**Intent.** Give the advisory cards a home. A quiet, ledger-like advisor panel on the dashboard that renders E9-T4's cards, lets the owner refresh in real time, and drills each card to the transactions/report behind it.

**Changes**

- Create apps/web/src/components/openbooks/dashboard/AdvisorPanel.tsx: renders summary + advisory cards from useAction(api.aiCfo.generateAdvisories), with a 'Refresh insights' button (actions can't be useQuery — follow the AiNarrativePanel.tsx:42 pattern).
- Severity styling per design rules: warn = neutral-but-attention (NOT alarm red unless truly a loss/overdue), info/watch = muted; one brand green for positive; no gradients/emoji/purple AI styling.
- Each card links to a drill-down: runway→cash-flow report, expense-creep→expenses filtered to the category, concentration→income-by-customer, anomaly→the flagged transactions (reuse coreViews.insightsDrill, coreViews.ts:984).
- Mount AdvisorPanel in CoreScreens.tsx DashboardScreen as a distinct section (not crammed into an existing tile); make it responsive (stacks on mobile per design rules).
- Loading + degraded states: show deterministic cards immediately, then enhance when the AI result returns; show a quiet 'AI not configured — showing computed advice' note when degraded.

**Files:** `apps/web/src/components/openbooks/CoreScreens.tsx:239`, `apps/web/src/components/openbooks/workbench/AiNarrativePanel.tsx:42`, `apps/web/src/components/openbooks/dashboard/DashboardViz.tsx:1`, `convex/coreViews.ts:984`

**Definition of done**

- [ ] AdvisorPanel renders on the dashboard with at least the deterministic cards on first paint, and refreshes via the action on demand.
- [ ] Each card drills to the correct underlying view (manual click-through verified).
- [ ] Responsive: panel stacks cleanly on a 375px viewport; matches design system (no red for ordinary expenses, no gradients/emoji/purple).
- [ ] Degraded (no AI key) shows computed advice with a quiet note, not an error.

**Deliverables:** apps/web/src/components/openbooks/dashboard/AdvisorPanel.tsx; Edited CoreScreens.tsx (mount + section); Screenshot of the advisor panel (desktop + mobile)

**Verify.** pnpm build green; run the app, open dashboard, confirm cards render + refresh + drill-down; resize to mobile; capture screenshots.

### E9-T6 — Weekly digest email via Plunk: compose grounded summary, cron trigger, settings-gated, idempotent
`size: M` · `risk: low` · `depends on: E9-T3, E3-T7 (unified Plunk credential), E5 (consolidated/portfolio scope for the combined digest)`

**Intent.** Deliver the advisor to the owner's inbox: a weekly plain-English digest (revenue/expense/profit deltas + top 3 advisory cards) via Plunk, on a cron, respecting the existing notifications.digest toggle. **E9 OWNS the digest SEND job** (cron → sendPlunkEmail); E12 owns the preference/honest-status/Connections deep-link (decided: see decisions.md Q47/Q65).

**Changes**

- Create convex/weeklyDigest.ts: an action sendWeeklyDigest(workspaceId) that pulls E9-T3 signals + P&L deltas and composes a plain-text + minimal-HTML email. **One combined portfolio digest per workspace** — a multi-entity workspace gets a single email rolling up all in-scope entities with **intercompany eliminated** (read the consolidated/All scope owned by E5), NOT one email per entity (decided: see decisions.md Q47). Subject like 'OpenBooks weekly: revenue +8%, runway 4.1mo'. Calls sendPlunkEmail from packages/email (plunk.ts:28).
- Resolve the Plunk key from the **unified `credentials` table** (`kind:"plunk"`, workspace-scoped, owned by E3), preferring the saved key over `process.env.PLUNK_SECRET_KEY` (decided: see decisions.md Q14). Resolve the single editable recipient from workspaceSettings.notificationEmail (schema.ts:42); gate on workspaceSettings.notifications.digest === true (schema.ts:46) with **weekly default + opt-to-monthly** (decided: see decisions.md Q47); NO-OP cleanly when no Plunk key is configured (catch, log, return skipped).
- Idempotency: add a digestLog table (workspaceId, weekKey ISO-week, sentAt, status) and skip if a row exists for (workspace, week). Additive schema, backfill-safe.
- Add a weekly cron in convex/crons.ts (e.g. crons.cron('weekly digest','0 13 * * 1', internal.weeklyDigest.runAll, {}) — **Monday 13:00 UTC**; decided: see decisions.md Q47) that iterates workspaces with digest enabled; honor the monthly opt-out by skipping non-first-Monday weeks for monthly subscribers.
- Tests: (a) composes correct deltas + a single combined portfolio total (intercompany eliminated) from a seeded multi-entity workspace; (b) is a no-op without a Plunk key; (c) is idempotent for the same week (second call skips).

**Files:** `packages/email/src/plunk.ts:28`, `packages/email/src/index.ts:1`, `convex/crons.ts:1`, `convex/schema.ts:34`, `convex/aiCfoAggregate.ts:1`

**Definition of done**

- [ ] A weekly cron triggers sendWeeklyDigest; it sends **one combined portfolio email per digest-enabled workspace** (intercompany eliminated for multi-entity) via sendPlunkEmail, with revenue/expense/profit deltas + top 3 advisory cards in plain English (decided: see decisions.md Q47).
- [ ] No-op (no throw, logged 'skipped') when no Plunk key is configured in the unified `credentials` store or env (decided: see decisions.md Q14).
- [ ] Idempotent per (workspace, ISO week) via digestLog; second run in the same week sends nothing.
- [ ] Respects workspaceSettings.notifications.digest; disabled workspaces are skipped.
- [ ] All numbers in the email trace to the aggregate (reuse E9-T3 ground truth).

**Deliverables:** convex/weeklyDigest.ts; digestLog table in convex/schema.ts; Cron entry in convex/crons.ts; convex/weeklyDigest.test.ts (compose + no-key no-op + idempotent)

**Verify.** vitest convex/weeklyDigest.test.ts green; with a test Plunk key, run the action once and confirm a delivered email; run twice, confirm second is skipped.

### E9-T7 — Advisor Ask-AI tools: getRunway + getAdvisories so chat answers 'how am I doing / what should I worry about'
`size: M` · `risk: low` · `depends on: E9-T4`

**Intent.** Wire the CFO engine into Ask AI so the owner can ask the advisor directly and get grounded answers, not guesses. Extends the existing read-only tool set; still 'AI proposes, ledger posts' (read-only).

**Changes**

- Add two read tools to convex/agentTools.ts (alongside getReport/getBalances, lines 55-155): getRunwayAndBurn and getAdvisories, each resolving the entity via resolveEntityId (agentTools.ts:41) and calling internal queries/actions backed by E9-T3/E9-T4.
- Add the matching internal scoped query in convex/agentToolQueries.ts that returns the CfoSignals (entity-scoped, never trusting a model-supplied id — same pattern as the file's other ForEntity queries).
- Register the tools in the agent's tool set (agentTools.ts:304 openBooksReadTools); update the agent instructions (convex/agent.ts:24-33) to mention it can answer runway/burn/advice from the ledger and must use the tool, never guess.
- Mirror the same tool refs in convex/aiChatRuntime.ts (the makeFunctionReference block, lines 26-60) so the non-Bedrock chat path exposes them too.
- Tests: tool execute returns grounded numbers; agent instructions updated; no write/post capability added (assert tools are read-only).

**Files:** `convex/agentTools.ts:41`, `convex/agentTools.ts:304`, `convex/agentToolQueries.ts:1`, `convex/agent.ts:24`, `convex/aiChatRuntime.ts:26`

**Definition of done**

- [ ] getRunwayAndBurn and getAdvisories are registered read tools, entity-scoped via resolveEntityId, returning grounded numbers from E9-T3/T4.
- [ ] Agent instructions tell the model to use these tools for 'how am I doing / what should I worry about' and never to guess.
- [ ] Both Ask-AI runtimes (agent.ts and aiChatRuntime.ts) expose the tools.
- [ ] Tools are read-only (no proposal/post capability added); a test asserts this.

**Deliverables:** Edited convex/agentTools.ts, convex/agentToolQueries.ts, convex/agent.ts, convex/aiChatRuntime.ts; convex/agentTools.cfo.test.ts

**Verify.** vitest green; in Ask AI ask 'what's my runway?' and 'what should I worry about?' and confirm answers cite the real numbers from the advisory engine.

### E9-T8 — Revenue-by-stream view: stream taxonomy over income accounts + dashboard widget reconciling to P&L
`size: M` · `risk: med` · `depends on: E9-T2`

**Intent.** Give Ansar his three revenue streams (marketing services, Z360 AI product, AI consulting/dev) as a first-class dashboard view, built on the existing income-account stream rollup so it always reconciles to P&L revenue.

**Changes**

- Add an optional streamTag (streamGroup) to ledger income accounts so multiple income accounts can roll up into one owner-facing stream (e.g. platform fee + usage + setup + support → 'Z360 product'). Additive schema field on ledgerAccounts; default = account's own name when untagged. Posting path untouched.
- Extend coreViews.ts dashboard (or add a thin revenueByStream to the existing income-account rollup at incomeViews.ts:315-348) to return per-stream period totals + trailing trend, grouped by streamTag, in integer minor units.
- Build a RevenueByStream widget in apps/web/src/components/openbooks/dashboard/ (horizontal bars / mini-trend reusing DashboardViz CustomerBars/PnlTrendChart patterns) and mount it in DashboardScreen.
- Reconciliation guard: sum of stream totals MUST equal the P&L revenue total for the period (assert in a unit test, mirroring incomeViews' invariant at incomeViews:348).
- Stream taxonomy is **defined ONCE and shared with E2/Q8 and E4**: the **onboarding AI proposes** income streams from history → **owner approves** → the approved set **persists** as the explicit field the prompt and this widget read; editable later in Settings (decided: see decisions.md Q49/Q8). For E9, also ship a minimal mutation to set/override streamTag on an income account so the widget works before/independent of onboarding. Do NOT define a second/competing stream tag.

**Files:** `convex/schema.ts:1`, `convex/incomeViews.ts:315`, `convex/coreViews.ts:160`, `apps/web/src/components/openbooks/dashboard/DashboardViz.tsx:324`, `apps/web/src/components/openbooks/CoreScreens.tsx:239`

**Definition of done**

- [ ] Income accounts can be tagged to a stream; untagged accounts fall back to their own name.
- [ ] A revenue-by-stream widget renders on the dashboard with per-stream period totals + trend.
- [ ] Sum of stream totals equals the period P&L revenue (unit test) — no double-count, no omission.
- [ ] All amounts integer minor units; ledger posting path untouched.

**Deliverables:** Additive streamTag field in convex/schema.ts; Edited convex/incomeViews.ts / coreViews.ts (revenueByStream rollup); apps/web/.../dashboard RevenueByStream widget + mount; convex/revenueByStream.test.ts (reconciles to P&L revenue)

**Verify.** vitest green; dashboard shows three streams for Ansar's data; stream total == Reports P&L revenue for the period.

### E9-T9 — Anomaly + duplicate detection signal: ground the 'what should I worry about' warnings
`size: M` · `risk: low` · `depends on: E9-T3`

**Intent.** Add the anomaly/duplicate-detection family the CFO engine needs but which is non-trivial: spike vs baseline, possible duplicate charges, and unusual new vendors — all from the ledger/transactions, with low false-positive design.

**Changes**

- Add an anomaly module (convex/aiCfoAnomalies.ts or a section inside aiCfoAggregate.ts) computing: (a) duplicate candidates — same counterparty + same amount within a short window (<=3 days), excluding known recurring; (b) amount spikes — a single expense/category > k× its trailing median; (c) new-large-vendor — first-seen vendor with an above-threshold charge.
- Return anomalies as CfoSignals cards with severity and the offending transaction ids so the advisor surface (E9-T5) and Ask-AI (E9-T7) can drill straight to them.
- False-positive guardrails: respect recurring/MRR markers, ignore transfers and intercompany legs via the canonical E1/E5 flag (`transferPairId`/`intercompanyPairId`, consumed in E9-T1; decided: see decisions.md Q45), and require a minimum amount threshold so the panel isn't noisy.
- Wire these signals into E9-T3's output and E9-T4's narration so the digest and advisor naturally surface 'possible duplicate: Vendor X charged twice'.
- Tests: seed a duplicate pair and a spike; assert both are flagged; assert a legitimate recurring charge and a transfer are NOT flagged.

**Files:** `convex/aiCfoAggregate.ts:1`, `convex/coreViews.ts:718`, `convex/incomeViews.ts:380`

**Definition of done**

- [ ] Anomaly signals detect duplicate-charge candidates, amount spikes, and new-large-vendors from ledger/transaction data, each carrying offending transaction ids.
- [ ] Recurring charges and internal transfers are excluded (no false positives in the test fixtures).
- [ ] Anomalies flow into the advisory cards, the digest, and Ask-AI drill-downs.
- [ ] Amounts integer minor units; read-only; ledger path untouched.

**Deliverables:** convex/aiCfoAnomalies.ts (or section in aiCfoAggregate.ts); convex/aiCfoAnomalies.test.ts (duplicate + spike flagged; recurring + transfer not flagged)

**Verify.** vitest convex/aiCfoAnomalies.test.ts green; on the advisor panel, a seeded duplicate appears as a 'possible duplicate' card that drills to both transactions.

## Decisions applied

All previously-open E9 questions are RESOLVED in [`../decisions.md`](../decisions.md) (authoritative) and the per-epic deltas in [`../plan-rebuild-changelog.md`](../plan-rebuild-changelog.md). Applied here:

- **Q45 — Transfer-marker dependency:** consume the canonical transfer/intercompany flag from E1/E5 (`transferPairId` / `intercompanyPairId`); **no interim heuristic, no conflicting marker** (E9-T1, E9-T9).
- **Q46 — Tax set-aside rate:** default **30%** of trailing book net income, single configurable workspace setting `taxSetAsidePct=0.30`, flat (not per-entity), with a mandatory 'not tax advice' disclaimer (E9-T3).
- **Q47 — Digest:** weekly, **Monday 13:00 UTC**, single editable workspace email, weekly default + opt-to-monthly; multi-entity gets **one combined portfolio digest** (intercompany eliminated). E9 owns the SEND job, E12 owns the preference (E9-T6).
- **Q48 — Multi-currency in advisories:** **CUT — USD-only.** Runway/burn/forecast sum USD minor units directly; no per-currency separation, no refuse-to-sum (E9-T3, epic DoD).
- **Q49 — Stream taxonomy:** onboarding AI proposes → owner approves → persists; editable in Settings; defined ONCE, shared with E2/E4 (E9-T8).
- **Q50 — Forecast sophistication:** naive run-rate + scheduled-items (13-week running balance), labelled an estimate; no seasonality/MRR modeling for v1 (E9-T3, kept).
- **Q11/Q18/Q44 — AI runtime:** CFO narration runs through the provider-agnostic runtime resolving keys from the **unified `credentials` table owned by E3** (`kind:"ai"`), deterministic fallback when no key; never Bedrock-only — BYO keys land this sprint (E9-T4).
- **Q14 — Plunk:** digest reads the Plunk key from the unified `credentials` store (`kind:"plunk"`, workspace-scoped), preferring saved key over env (E9-T6).

**Still needs Ansar:** none specific to E9. (Cross-epic items pending Ansar — repo name, license, launch URL, etc. — are tracked in decisions.md "Still needs Ansar" and do not affect E9 implementation.)

## Research notes

- Puzzle and Digits both frame their differentiator as REAL-TIME burn and runway (runway = current cash / average burn), updated continuously rather than at month-end. This validates E9-T3's runway/burn signal and E9-T5's 'refresh insights' real-time affordance as table-stakes for an advisory product, not a nice-to-have. ([source](https://puzzle.io/blog/puzzle-vs-digits))
- Digits' value is 'dashboards that give leaders an intuitive grasp of cash flow, burn rate, and runway without needing to be an accounting expert' — i.e. plain-English advisory framing over a correct ledger. This is exactly the OpenBooks North Star ('owner experience is plain English; the system of record is a hidden double-entry ledger') and supports keeping every advisory number ledger-grounded (E9-T3) while narrating in owner language (E9-T4). ([source](https://beancount.io/blog/2025/08/05/digits-ai-accountant-balancing-brilliant-dashboards-with-the-need-for-human-trust))
- Industry framing: ~29% of startups fail from cash depletion and businesses that actively monitor burn are materially more likely to secure follow-on funding — justifying the proactive runway WARNING and the weekly digest (E9-T6) as the highest-value advisory output, and supporting a 'watch/warn' severity escalation on the runway card. ([source](https://puzzle.io/blog/ai-accounting-software-startups))
