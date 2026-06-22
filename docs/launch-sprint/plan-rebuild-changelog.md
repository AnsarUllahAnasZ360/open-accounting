# Launch Sprint — Plan-Rebuild Changelog (per-epic edit list for patch agents)

This is the actionable delta for the patch agents who edit the epic docs in
`docs/launch-sprint/epics/E01..E15`. Authority order: `ANSAR-DECISIONS.md` →
`decisions.md` → research R1–R6 → verification V1–V3. The diagnosis blueprint is
accurate and stays as-is.

**Global rules that apply to every epic (apply silently, do not re-debate):**

1. **USD-only ledger (Ansar #3).** DELETE all general-ledger multi-currency / FX work.
   Concretely: drop the dead `journalLines.fxRate` field; lock `entities.createEntity`
   to USD (`entities.ts:139-149`); `workspaceSettings.defaultCurrency = "USD"`. There is
   **no live GL FX engine to remove** (V3) — this is a field deletion + a currency lock,
   not an engine rip-out. Remove every "per-currency consolidation / base-currency
   conversion / unconverted badge / refuse-to-sum-currencies / fxRate hook" task.
2. **Multi-currency lives ONLY in payroll (Ansar #4/#5).** KEEP all payroll FX math
   (`payrollMath.ts`, `payroll.ts` settlement, per-currency *display*, payroll FX advisory).
   The ONLY change: replace the hardcoded `PKR:278/INR:83` source with a fetched day-of-pay
   rate; keep the manual override; payroll still books USD.
3. **Stripe in-transit double-count model is ALREADY BUILT and WIRED (V2).** Do NOT
   re-prescribe "build the matcher" or "build the in-transit model." Remaining Stripe work
   is RC2 (calibrate tolerance + de-gate descriptor), RC4 (stop fixture injection on real
   entities), RC3 (opening-balance entry on connect).
4. **Live connectors must work locally (Ansar #13).** Delete `AGENTS.md:82-83` (sandbox/test
   only) and the reinforcing lines; default `OPENBOOKS_REAL_TEST_LIVE_CONNECTORS` open / remove
   the gate across `connections.ts`, `plaid.ts`, `stripe.ts`, `stripeWebhook.ts`. KEEP
   encryption-at-rest (`plaid.ts:341`).
5. **ONE unified `credentials` table for ALL secrets (Ansar #12).** Collapse `aiCredentials`
   (dead, per-field) and `connectionCredentials` (live, JSON-blob) into one
   `connectionCredentials`-style shape (single `encryptedPayload` + `fingerprint` + `keyPreview`
   + `status`, `kind: ai|plaid|stripe|plunk`, `workspaceId` always + `entityId` when
   per-business). Move Plunk onto it. Fix the KDF (32 raw bytes / HKDF, not bare SHA-256).
6. **History window = user-chosen (Ansar #7).** Replace every hardcoded ~6-month window with
   "pull as much as the connector gives, default; user may pick a start date floored to the
   first of its month." Plaid `days_requested=730` at `/link/token/create`; Stripe = inception.
7. **Intercompany detect + two views (Ansar #6).** Cross-entity transfer = intercompany,
   never income/expense. Two views: standalone (Due-from/Due-to on the books) and consolidated
   (read-time elimination). Detection owned by E5.
8. **Public demo = ONE shared no-login workspace (Ansar #14).** Not per-visitor clones.

---

## E01 — Accounting correctness & reconciliation engine

**CUT**
- **E1-T9 fxRate write-hook** → remove the `fxRate` portion entirely (USD-only). E1-T9 keeps
  ONLY "write `contactId` on journal lines." Retitle accordingly.
- Any "optional FX field so a future FX epic can populate it" language → delete; there is no
  FX epic.

**RESCOPE**
- **E1-T3 (Stripe matcher)** — reframe from "loosen the matcher" to "calibrate to QBO/clearing
  tolerances": match on **exact net amount** (clearing model already nets fees out), window
  **−2/+5 business days**, and **demote the `"stripe"/"payout"` descriptor from a hard gate to
  a scoring booster**. Current code: `stripe.ts:1197` (1-cent tol), `1208-1211`/`1244-1251`
  (descriptor gate). Add the explicit Inbox "Match deposit to payout" action. Note in the doc
  that the in-transit model is ALREADY built (V2) — this ticket is calibration, not construction.
- **E1-T2 (opening balance)** — set the as-of date to the **first day of the month** of the
  user's chosen start (Ansar #2), amount = Plaid-reported balance refined to
  `current_balance − Σ(imported)`, auto-mark cleared, offset to **Opening Balance Equity**
  (the backlog says "3900"; keep that account). Add: reconcile/remove the `coreViews` 059a71d
  dashboard display override so dashboard and ledger agree once the real entry posts (V2).
- **E1-T5 (truncation)** — this epic OWNS the real `.take(5000)` fix (date-ordered complete
  loading), per Q34; E6 only shows the banner.
- **E1-T1 (gate fixtures)** — keep, and align with RC4: the concrete change is stop passing
  `includeFixturePayoutFallback:true` from `fetchStripeProjection` (`stripe.ts:1851`) and gate
  `syncNow`/`seedTestAccount` fixtures to the demo workspace only (`stripe.ts:2054-2061`,
  `2118-2196`).

**ADD**
- **Reconciliation schema = per-transaction `reconciliationId` + `clearedAt`** (not an array on
  the reconciliation). E1-T12: anchor on statement ending balance + date; **block Finish until
  difference = $0.00**; discrepancies post an explicit reversible adjusting entry.
- **`unreviewed:{count, amountMinor}` additive optional field** on report views (producer side
  for E6-T9/E6-T30 contract).

**DEPENDENCIES**
- E1 no longer depends on or feeds any FX epic. E1's transfer flag + `unreviewed` fields feed
  E5, E6, E9 (confirm contracts there).

---

## E02 — AI categorization engine & learning loop

**RESCOPE**
- **E2-T1 (BYO AI credentials)** — write through the **unified `credentials` table** (Global
  rule 5), `kind:"ai"`, workspace-scoped, via `secretBox` with the fixed KDF. Note V1: the
  `aiCredentials` per-field table is dead scaffolding — do not extend it; converge on the blob
  shape. (Coordinate single ownership with E3-T1 — see "Dependencies" below.)
- **E2-T7 (truthful stage attribution)** — keep; reinforce "validate every LLM-returned id
  before posting; uncertain → Inbox unposted, never an `Uncategorized` auto-post" (Q9).
- **E2-T10 (calibration)** — set scope **per-entity, refit on each eval run**, workspace
  fallback when holdout labels are thin (Q10).

**ADD / PIN**
- **Embedding model PINNED at 1024 dims, decoupled from the chat provider** (Q7). E2-T4/E2-T5
  must use one fixed 1024-dim model; **degrade to lexical/merchantKey memory** when no
  embedding key exists. Add an explicit "one-way door — never mix embedding models in the index"
  note. This is the sharpest constraint; do not let the provider picker change embeddings.
- **Business-context / income streams**: AI proposes from history → owner approves → persists as
  an explicit field the prompt reads (Q8). Define the stream taxonomy ONCE (shared with E4 + E9-T8).

**DEPENDENCIES**
- **De-duplicate the BYO-credential build with E3.** E2-T1 and E3-T1 both describe writing AI
  credentials. **Make E3-T1 the single owner of the unified credential write/read/resolver**;
  E2 *consumes* the resolver (E2-T2 categorizer runtime depends on E3-T2/E3-T3). Patch agents:
  in E2, change E2-T1 to "consume the unified credential resolver from E3" and add a dependency
  on E3-T1/E3-T2 rather than duplicating the storage layer.
- Migrate all three runtimes (categorizer, chat, test-connection) onto the factory (Q11) — note
  V1: all three still hardcode Bedrock-from-env.

---

## E03 — Integrations & BYO-keys (Plaid / Stripe / AI / Plunk)

**This epic becomes the OWNER of the unified credential layer.**

**RESCOPE / RETITLE**
- **E3-T1** — retitle to "Unified `credentials` table: write+read+validate for ai/plaid/stripe/
  plunk (collapse `aiCredentials` + `connectionCredentials`)." Adopt the `connectionCredentials`
  blob shape (V1 says it's the proven one), add `kind` + scoping (AI/Plunk = workspace; Stripe =
  per-entity; Plaid Item = workspace, account→entity mapping on account rows). Fix the KDF. Keep
  `secretBox` AES-256-GCM, random 12-byte IV, versioned ciphertext.
- **E3-T2** — provider-agnostic resolver: keep the **per-call factory** (`buildModelForProvider`),
  NOT `createProviderRegistry` (R5: no per-request-key hook on the registry). Make
  `providerStatus`/`setConfig` credential-aware; **widen `setConfig` arg validator from 5 to 14**
  providers (Q12). Validate-on-save with a 1-token ping.
- **E3-T6 (Stripe webhook)** — change from "strongly-recommended" to **REQUIRED + verified before
  a connection reports 'listening'** (Ansar #11 / Q15). Subscribe to the min event set (decisions
  Q15: `payout.paid/failed/canceled`, `payout.reconciliation_completed`, `charge.succeeded`,
  `charge.refunded`, `charge.dispute.created/closed`, `balance.available`). Verify signature,
  store `whsec_…` in the unified store, dedupe by `event.id`. Do NOT itemize a payout before
  `payout.reconciliation_completed`. Keep polling as backfill + nightly sweep only.
- **E3-T5 (Plaid account→business)** — confirm **workspace-anchored Item, per-account entity
  mapping** (Q17). This mapping is the prerequisite for E5 intercompany detection.
- **E3-T7 (Plunk)** — move Plunk OFF `process.env.PLUNK_SECRET_KEY` onto the unified
  `credentials` table, **workspace-scoped** (Ansar #10), prefer saved key over env.

**CUT**
- Remove the "verification stays sandbox/test only" framing (Q16). Live connectors must work
  locally; delete `AGENTS.md:82-83` and neutralize the `OPENBOOKS_REAL_TEST_LIVE_CONNECTORS` gate
  across the 4 files (Global rule 4). Keep encryption-at-rest.

**DEPENDENCIES**
- E3-T1/T2/T3 are upstream of E2 (categorizer), E9 (CFO narration), E4 (onboarding key entry),
  E8 (banner AI narration). All "AI is Bedrock-only until BYO lands" caveats elsewhere are
  removed because BYO lands here, this sprint.

---

## E04 — Guided onboarding & "done-for-you books" first-run

**CUT**
- **E4-T5 multi-currency opening balances** → USD-only. Opening balances are USD integer minor
  units; remove the "base-currency value vs per-currency" question and any FX conversion (Q20).
  Keep "book balanced opening entries into 3900 / Opening Balance Equity" — date them the first
  of the month (Ansar #2).

**RESCOPE**
- **E4-T3 (BYO AI key)** — wire to the **unified credential resolver from E3**, not a new store
  (Q18). Do not build a parallel `aiCredentials` write path.
- **E4-T7 (AI bulk-setup / history review)** — replace the "~6-month window" with **user-chosen
  history; default = pull everything the connector gives** (Ansar #7 / Q19). Plaid 730 at link;
  Stripe inception; CSV/OFX for older. AI **proposes** income streams + categories + rules; owner
  approves. Clarifying questions = small fixed core (≤5) + AI-detected ambiguities (Q22).
- **E4-T10 (demo)** — single **shared no-login demo workspace** (Ansar #14), not per-visitor.
  Coordinate the demo backend with E11 (E11 owns it). E4 keeps the owner reset / re-onboard path.

**ADD**
- **E4-T4** — make intercompany mapping explicit: each Plaid account maps to one business, and
  cross-entity transfers are flagged for E5's detector (Q23). E4 does the mapping; E5 does the
  detection.

---

## E05 — Multi-entity, workspace↔business layer & Portfolio/consolidation

**This epic OWNS intercompany detection + elimination.**

**CUT**
- **E5-T4 "Base-currency FX policy + portfolio money helpers (multi-currency normalization)"** →
  **DELETE the FX/normalization content.** USD-only roll-up is plain summation (Q24/Q25). Keep
  only the trivial "everything is USD" assertion + the deterministic-default-business / kill
  `acme-studio-llc` fallback work (move that into E5-T1 if E5-T4 collapses).
- Any CTA / functional-currency / per-rate revaluation / NCI math → delete (R4 §11-12; ownership
  is 100% so no minority interest).

**RESCOPE**
- **E5-T5 (intercompany detection)** — primary signal = the **existing transfer matcher widened
  across all workspace entities** (R4 §5): a leg whose matched counter-leg lives in a
  `bankAccounts` row owned by a *different entity in the same workspace*. Tolerances: **exact
  amount ±$1 (100 minor units), ±5 calendar days, opposite sign, 1:1 first** (R4 §6). Confidence
  tiers: high → auto-classify as intercompany; medium → Inbox "Intercompany transfer between
  Zikra and Z360?"; one-leg-seen → leave normal, re-evaluate later. Add schema:
  `intercompanyPairId` (mirrors `transferPairId`) + reciprocal accounts `1300 Due from Affiliate`
  / `2300 Due to Affiliate` (never P&L).
- **E5-T7 (consolidated reports)** — elimination is a **read-time filter** keyed on
  `intercompanyPairId` (exclude pairs whose BOTH legs are in scope), NOT stored elimination
  journals (R4 §9-10). Standalone view keeps Due-from/Due-to posted. Show an explicit
  "Intercompany eliminated: −$X" line. USD-only consolidation = `SUM by account code − eliminated
  pairs`.
- **E5-T9 (re-map account with posted history)** — **future-syncs-only** re-mapping; posted lines
  stay under the original entity (Q26). *(Flag as a light product call only if Ansar wants the
  block-instead alternative.)*

**DEPENDENCIES**
- E5 consumes E12's `useActiveScope()` contract (Q31/Q62). E5 feeds E6 (consolidated reports),
  E8 (All-mode banners), E9 (portfolio digest/dashboard). Intercompany scope = workspace-internal
  only (Q27).

---

## E06 — Reports — correctness-aware UI, redesign, responsiveness, export, drill-down

**CUT**
- **E6-T7 multi-currency consolidation presentation** → USD-only: a single consolidated USD
  total, **no per-currency breakdown, no base-currency engine, no "until E1 FX lands" caveat**
  (Q32). Keep the All-businesses scope wiring to E5.

**RESCOPE**
- **E6-T9 (unreviewed/excluded + truncation banner)** — render gated on E1's additive
  `unreviewed:{count,amountMinor}` + truncation flag (Q30/Q34). E6 shows the banner; E1 owns the
  truncation fix.
- **Intercompany in consolidated reports = ELIMINATE (not just flag)** with the explicit
  "Intercompany eliminated" line (Q33). Update any "flag for v1" language to "eliminate."

**DEPENDENCIES**
- E6-T7 depends on E5 scope (`"all" | entityId`) + E5 elimination. E6-T9 depends on E1 fields.

---

## E07 — Transactions register & Mercury-grade workbench

**RESCOPE**
- **E7-8 insight banner** — E7 **consumes** E8's reusable `InsightBanner` contract (Q37); E8 owns
  the component. Update to remove any "E7 builds its own banner" implication.
- **E7-10 (centralize 'today')** — import the single server-clock helper landed by **E8-T1**
  (Q38); do not introduce a second date helper.
- **E7-6 keyboard model** — match the Inbox J/K/Enter/E scheme, scoped to the register to avoid
  ⌘K / combobox clashes (Q39).
- **E7-2/E7-1 provenance** — sentence-style, count-aware labels ("Same as your last 6 AWS
  charges", "Matched your rule", "Matched a Stripe payout"), one-word chip fallback (Q36).

**KEEP**
- Saved views remain FE-only (localStorage) this sprint (Q35); no server persistence ticket.

---

## E08 — Insights everywhere — per-page banners + redesigned insights screens

**This epic OWNS the shared `today`/`asOf` helper AND the reusable `InsightBanner`.**

**RESCOPE**
- **E8-T1** — single source-of-truth: browser clock for FE display, server `asOf` threaded into
  `coreViews` queries (Q40). Everyone imports this (E7-10, E9-T2).
- **E8-T8 (AI narration)** — runs through the **BYO provider-agnostic runtime from E3** with a
  deterministic fallback; **remove all "Bedrock-only until BYO lands" caveats** (Q44) — BYO is in
  scope this sprint.
- **E8-T4 All-mode banner** — aggregate across entities in All mode (intercompany eliminated),
  per-entity insight when a single entity is active (Q43); depends on E5 scope contract.

**CUT**
- Retire `InsightsBand`, `MiniCashflowStrip`, `InsightsDashboard`; keep the `aiInsights` action
  (Q41). Banners are always-on but threshold-gated/null-hidden (Q42).

---

## E09 — Dashboard + AI CFO / Financial Advisor + weekly digests

**CUT**
- **E9-T3 multi-currency advisory handling** → USD-only: runway/burn/forecast sum USD minor units
  directly; **remove the "compute per-currency / refuse to sum USD+PKR+INR" path** (Q48).

**RESCOPE**
- **E9-T3 (tax set-aside)** — default **30% of trailing book net income**, single configurable
  workspace setting `taxSetAsidePct=0.30`, flat (not per-entity), shown as a "money to park"
  estimate with a mandatory "not tax advice" disclaimer (Q46 / R6 §D). Add the quarterly 1040-ES
  deadline countdown + safe-harbor copy as informational only.
- **E9-T1 (transfer-aware cash flow)** — consume the canonical transfer/intercompany flag from
  E1/E5; **no interim heuristic** (Q45).
- **E9-T6 (weekly digest)** — Monday 13:00 UTC, single editable workspace email, weekly default +
  monthly opt; **one combined portfolio digest** for multi-entity (Q47). E9 OWNS the send job
  (cron → `sendPlunkEmail`); E12 owns the preference/status.
- **E9-T8 (stream taxonomy)** — define ONCE, shared with E2/E4: onboarding AI proposes → owner
  approves → persists (Q49).

**KEEP**
- Forecast stays naive run-rate + scheduled-items (13-week running balance), labelled estimate
  (Q50). Metric set per R6 §B (cash, burn 3-mo avg, runway, revenue-by-stream, expense-creep
  ≥25% & ≥$200 floor, concentration >10% / top-5 >25%, AR/AP, duplicate/anomaly).

---

## E10 — Payroll — verify, fix & integrate

**RESCOPE**
- **E10-T3 (FX at settlement)** — replace the hardcoded `PKR:278/INR:83`
  (`payrollMath.ts:16-24`) with a **fetched day-of-pay rate** (whatever source is easiest, Ansar
  #5), KEEP the manual override (`payroll.ts:387,399`), KEEP convert-to-USD and the USD-booked
  settlement (`payroll.ts:539-558`). This is the ONLY place multi-currency survives (Ansar #4).
- **E10-T2 (bank matcher)** — date window **±5 calendar days** around posting date (Q52); make it
  currency-aware in the payroll sense (local→USD) but settle directly payable→bank, **no
  in-transit hop for v1** (Q53).

**KEEP / DEFER**
- Monthly auto-draft + manual second run for v1; **semimonthly auto-draft deferred** (Q54).
- Per-entity payroll statements (USD-booked); combined portfolio payroll view is a read-only E5
  roll-up, not a legal statement (Q55).

---

## E11 — Data lifecycle — reset/delete-all, demo data & public no-login demo

**RESCOPE**
- **E11-T5/T6 (no-login demo)** — **NO anonymous Convex Auth identity** (Q56). Resolve the demo
  workspace by **slug on the server** (hook at `auth.ts:203-226` slug fallback), serve to truly
  unauthenticated users, and enforce a **server-side `isDemo → read-only` guard** in a shared
  `requireWorkspaceRead` helper (UI hiding is not the boundary). Model on `ledger.ts:260`
  fixed-slug entity + `seedDemo.ts` content. Note V3: no public demo exists today — this is net-new.
- **E11-T8 (reset cron)** — daily reset+reseed at **08:00 UTC**, idempotent/self-healing (Q57).
- **E11-T3 (factory reset)** — re-type the workspace name to confirm + `auditEvents` record
  (Q61); **delete local connection/credential rows only**, do NOT call provider revoke APIs (Q58).
- **E11-T9 (export)** — JSON snapshot + per-table CSV zip incl. a journal-lines CSV; re-import
  deferred (Q59).

**ADD**
- `OPENBOOKS_PUBLIC_DEMO_ENABLED` flag, **OFF by default** for self-hosters, ON for hosted (Q60).

---

## E12 — Settings & app-shell UI overhaul + scope-switcher hook

**RESCOPE**
- **E12-T8 (scope switcher)** — E12 ships the switcher UI + **`useActiveScope()` context +
  persistence**; **E5 consumes it** for the All read path (Q62). Day-one scope=all: Dashboard,
  Reports, Transactions, Insights.
- **E12-T3/T4 (Categories/Rules) under "All"** — fall back to the primary entity with a hint
  (Q63). Rules condition-groups: **read-time shim sufficient**, backfill optional (Q64).
- **E12-T5 (Notifications/Plunk)** — owns the **preference + honest status + Connections
  deep-link**; the actual digest SEND lives in **E9-T6** (Q65). Editable delivery email.
- **E12-T7 (Audit)** — paginated server-filtered query, drop the 200-row cap, **no retention cap
  for v1** (Q66); audit export in DataSection.
- **E12-T6 (Team)** — member removal detaches `workspaceMembers`, preserves immutable
  audit/posting attributions, removes invite access; last-owner guard (Q67).

**DEPENDENCIES**
- E12-T8 is upstream of E5-T2/T3, E6-T7, E8-T4.

---

## E13 — Self-host setup skill + deployment + security posture

**RESCOPE**
- **E13-T1 (skill placement)** → default to a tracked top-level **`skills/openbooks-self-host/`**
  (`.claude/`/`.agents/` are gitignored). **→ ASK ANSAR** if he wants public-registry
  distribution (Q68).
- **E13-T2/T1 (provisioning)** — orchestrate-and-**pause-for-confirmation**, never fully
  auto-provision; pause before any `--prod` deploy (Q69).
- **E13-T4 (preflight)** — reachability-check the common providers (Bedrock/OpenAI/Anthropic/
  Google/Groq via 1-token ping), name-check the long tail (Ollama, OpenAI-compatible) (Q71).
  Drop the "keep sandbox/test enforcement" framing — live connectors work locally now (Global
  rule 4).
- **E13-T5/T7 (security/setup pages)** — lean honest code-cited `/security` (data-handling +
  disclosure email), document `*.vercel.app` + `*.convex.site` as sufficient, explain the
  live-key HTTPS-redirect requirement (`connections.ts:248`) (Q72/Q73).
- **E13-T74 overlap** — E13 only documents/links the key-entry + opening-balance steps; E3/E4 own
  the in-app implementation (Q74).

**CUT**
- One-click Vercel marketplace template deferred (Q70).

---

## E14 — Quality — tests, accounting invariants, categorization eval & security

**RESCOPE**
- **E14-T1** — change "per-currency trial balance" to **single-currency (USD) trial-balance +
  balanced-entry** invariant (Q76). USD-only — there is no RC8 multi-currency fix to gate against.
- **E14-T2** — Stripe clearing/in-transit zero-out invariant + **no-fixtures-on-real-books** test
  (locks RC4). Keep — it guards the already-built in-transit model and the RC4 fix.
- **E14-T3** — reversal-is-exact-inverse + post-truncation balance invariant; pairs with E1-T5.
- **E14-T7 (e2e)** — **only ever create fresh workspaces** (never mutate Ansar's real
  Zikra/Z360) (Q77).
- **E14-T4 (categorization eval)** — run against a **recorded/mock provider in CI** (deterministic,
  no key) + assert accuracy math as a unit test (Q78).
- **E14-T6 (security audit)** — `pnpm audit` + committed **gitleaks** secret-scanner; SCA
  (Snyk/Trivy) optional (Q79).

**ASK ANSAR (light)**
- **E14-T8 (CI gate)** — ship `pnpm ci` script now; author `.github/workflows/ci.yml` only on
  Ansar's explicit OK (AGENTS.md hosting restriction) (Q75).

---

## E15 — Docs, Help Center, Landing & GTM

**RESCOPE**
- **E15-T1 (license)** — **MIT everywhere (Ansar decided 2026-06-17, Q81).** Real relicense:
  replace the root AGPL-3.0 LICENSE file with MIT; flip README line 62 + vision competitive table
  + AGENTS to MIT; the landing's existing "MIT licensed" claims are now correct → verify, don't
  rewrite. Invert any grep recipe to hunt for stray AGPL.
- **E15-T2 (false claims)** — drop the Docker `docker compose up` claim → describe Convex-cloud-dev
  + Vercel BYO-keys (Q83); fix the history-window claim to "as far back as your bank allows / you
  choose" (Q19); demo CTAs → `/demo`; repo name per Q80.
- **E15-T4 (README/status table)** — publish the honest status table, but **after E1–E7 fixes
  land** so it reads "working" where true (Q84).
- **E15-T6 (public demo entry)** — points at the **shared no-login `/demo`** owned by E11, shipping
  before launch (Q82).

**ASK ANSAR**
- **E15-T2/T4 repo name** → default `openbooks`, flag all links for find-replace (Q80).
- **E15-T7 "why" one-pager** → draft with marked Ansar-input slots (personal story / QB-Bench
  failure moment / audience) (Q86).
- **E15 launch URL** → custom domain if live, else Vercel URL (Q85).
- **E15-T10 issue seeding** → stage the labeled-issue script for Ansar to run (repo-write auth)
  (Q87).

---

## Cross-epic dependency changes (net)

- **Deleted dependency:** every "depends on the FX / multi-currency epic" edge is gone (no FX
  epic). E1-T9, E5-T4, E6-T7, E9-T3, E14-T1 lose their multi-currency coupling.
- **New single owner — credentials:** E3-T1/T2 own the unified `credentials` store + resolver;
  E2-T1, E4-T3, E8-T8, E9-T4 become **consumers** (add dependency on E3-T1/T2, remove duplicate
  storage work).
- **New single owner — date helper:** E8-T1 owns `today`/`asOf`; E7-10, E9-T2 import it.
- **New single owner — InsightBanner:** E8-T3 owns the component; E7-8 consumes it.
- **New single owner — scope context:** E12-T8 owns `useActiveScope()`; E5-T2/T3, E6-T7, E8-T4
  consume it.
- **New single owner — intercompany:** E5-T5 owns detection + `intercompanyPairId`; E1, E4, E6,
  E9 consume the flag.
- **New single owner — demo backend:** E11 owns the shared no-login demo; E4-T10 and E15-T6 link
  to it.
- **Stripe webhook** moves from optional to a **hard prerequisite** for a live Stripe connection
  (E3-T6), feeding the correctness of E1's payout reconciliation.
