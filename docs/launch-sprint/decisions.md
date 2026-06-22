# Launch Sprint — Decisions (authoritative replacement for open-questions.md)

This file RESOLVES all 87 questions from `open-questions.md`. It is the canonical
decision layer for the launch sprint. Where a question still genuinely needs Ansar
it is marked **→ ASK ANSAR** and repeated in the final "Still needs Ansar" section.

**Governing contract:** `docs/launch-sprint/rebuild/ANSAR-DECISIONS.md` (16 decisions).
**Default rule for anything uncovered:** *do what QuickBooks Online (QBO) does; do
not invent; do not ask accounting questions.*

**Source tags:** `Ansar` = direct decision · `QBO-parity` = QBO/industry default
from research R1–R6 · `eng-default` = engineering default that does not need Ansar.

**Verification truth used below** (rebuild/verification V1–V3):
- The Stripe in-transit double-count model (E7/RC1) is **already built and wired**.
  RC2 (matcher tolerance/descriptor gate), RC4 (fixture payouts on real entities),
  and RC3 (no opening-balance entry on connect) are **still open**.
- The GL is **already currency-blind** — there is no live GL FX engine to remove;
  "delete the FX engine" = lock entity currency to USD + drop the dead
  `journalLines.fxRate` field. Payroll FX (convert-to-USD) is correct, keep it.
- RC9/BYO-keys is **scaffolded but fully unwired** — `aiCatalog.ts` (14 providers),
  `aiProvider.ts` factory, and the `aiCredentials` table exist with **zero**
  read/write/runtime consumers; runtime is still Bedrock-from-env only.
- `connectionCredentials` (single `encryptedPayload` JSON blob + `fingerprint` +
  `keyPreview` + `status`) is the **proven** credential shape and the template for
  the unified store. `secretBox.ts` AES-GCM is the shared crypto primitive.
- No public no-login demo exists today; the slug-fallback in `auth.ts:203-226` and
  the fixed-slug entity pattern in `ledger.ts:260` are the hook points.

---

## E1 — Accounting correctness & reconciliation engine

**Q1 — Loosened payout-matcher amount tolerance.**
DECISION: Do **not** amount-fuzz the Stripe payout match. The in-transit clearing
model already makes the Plaid deposit equal the payout **net exactly**, so match on
**exact net amount** within an arrival window of **−2 / +5 business days**. Demote
the `"stripe"/"payout"` descriptor from a hard gate to a **scoring booster only**.
Apply the general QBO bank-match band (`max($0.50, 1.0%)`, hard ceiling `2% / $2.00`,
never auto-post above it) only to non-clearing 1:1 bank↔record matches.
SOURCE: QBO-parity (R1 §C, R2). RATIONALE: clearing accounts, not tolerance, are the
correct anti-double-count mechanism; the current 1-cent + descriptor gate (RC2) is
too strict to fire on live data and re-introduces the double-count.

**Q2 — Opening-balance date.**
DECISION: Opening-balance entry is dated the **first day of the month** of the user's
chosen history start (or of the connector's earliest available transaction); floor any
chosen date to `M-01`. Amount = Plaid-reported balance (later refined to
`current_balance − Σ(imported transactions after start)`). Auto-mark the line cleared.
SOURCE: Ansar #2 + QBO-parity (R3). RATIONALE: guarantees the opening entry predates
the oldest imported txn and aligns period-open with month-start/period-close.

**Q3 — E1-T9 optional `fxRate` write-hook for a future FX epic.**
DECISION: **CUT.** USD-only ledger (Ansar #3). The `journalLines.fxRate` field is
**dead** (V3: never written/read). Remove the field (or leave optional+unused) and
remove the fxRate write-hook from E1-T9; E1-T9 keeps only the **contactId** write.
SOURCE: Ansar #3 + V3. RATIONALE: no GL FX epic exists anymore.

**Q4 — drainResidualInTransit one-time vs ongoing.**
DECISION: **Both** — a one-time drain migration run once against the real book, plus a
standing `stripeClearingHealth` tripwire/invariant thereafter. Ansar's blanket
greenlight (Ansar #15 "all epics") authorizes running it against his live data.
SOURCE: Ansar #15 + eng-default. RATIONALE: clearing must zero per payout; the
tripwire keeps it that way (E14-T2 invariant).

**Q5 — Entity-scoped helpers must accept an entity list for portfolio.**
DECISION: RESOLVED — shared helpers (`unreviewed`, unified cash, scope reads) take an
**entity list / `scope = "all" | entityId`** so E5 passes multiple entities without a
rewrite. SOURCE: Ansar #6 + eng-default. RATIONALE: portfolio is an additive read-time
roll-up over per-entity ledgers.

**Q6 — Reconciliation schema shape.**
DECISION: Use a **per-transaction `reconciliationId` + `clearedAt` marker**, not a
`clearedTransactionIds[]` array on the reconciliation. Anchor each reconciliation on
**statement ending balance + ending date**; block "Finish" until **difference = $0.00**;
discrepancies post an explicit, reversible adjusting entry. SOURCE: eng-default +
QBO-parity (R1 §E). RATIONALE: per-txn marker scales for queries; diff-must-be-zero is
QBO's non-negotiable gate.

---

## E2 — AI categorization engine & learning loop

**Q7 — Embedding dimensions across BYO providers.**
DECISION: **Pin ONE embedding model at 1024 dims, decoupled from the user's chat
provider.** Use a 1024-dim model (Bedrock Titan v2 @1024, or `text-embedding-3-small/large`
with the `dimensions:1024` Matryoshka parameter). Never mix models in the index. If no
embedding-capable key exists, **degrade to lexical/merchantKey memory**. Do not
pad/truncate/project ad hoc; do not add a second index now (one-way door).
SOURCE: eng-default (R5 §14). RATIONALE: cross-model vectors are incompatible; the
14-provider freedom applies to chat/categorization generation, not embeddings.

**Q8 — Source of the 3 revenue streams / business context for the prompt.**
DECISION: **Both, with AI-proposes:** the onboarding AI **detects** income streams and
known vendors from history and **proposes** them; the owner approves; the approved set
persists as an explicit settings field the prompt reads. SOURCE: Ansar #6/#15 + QBO-parity
(R6 stream taxonomy). RATIONALE: explicit field = reliable cold-start; AI proposal =
no manual setup chore. (Stream taxonomy owned jointly with E9-T8 / onboarding — define once.)

**Q9 — Low-confidence tail: Uncategorized bucket vs unposted Inbox.**
DECISION: **QBO behavior — uncertain items stay UNPOSTED in the Inbox**, never
auto-posted to an `Uncategorized` account. Reports show a prominent honest
**"$X / N transactions unreviewed & excluded"** banner (E1-T8 / E6-T9). The categorizer
must know this policy: confident → post; uncertain → Inbox. SOURCE: Ansar default-rule
(QBO) + product North Star. RATIONALE: "AI proposes, the ledger posts"; never fabricate a
category to make a number look complete.

**Q10 — Calibration scope and cadence.**
DECISION: **Per-entity calibration**, refit **on each eval run** (the eval is the natural
cadence), with a workspace-level fallback when an entity lacks enough holdout labels.
SOURCE: eng-default (R6). RATIONALE: two different LLCs calibrate differently; fall back
when data is thin.

**Q11 — Migrate the legacy env-only registry onto the new factory now?**
DECISION: **Yes — migrate all three runtimes** (categorizer `agent.ts`, Ask-AI chat
`aiChatRuntime.ts`, test-connection `aiSdkRuntime.ts`) onto the `aiProvider.ts` factory
+ unified credential resolver in this sprint. One source of truth. SOURCE: Ansar #8 + V1.
RATIONALE: V1 confirms all three still hardcode Bedrock-from-env; leaving chat behind
keeps the disabled-provider bug. E3 owns the resolver; E2/E9 consume it.

---

## E3 — Integrations & BYO-keys (Plaid / Stripe / AI / Plunk)

**Q12 — AI catalog mismatch (14 vs 5) — which is canonical?**
DECISION: **`aiCatalog.ts` (14 providers) is canonical.** Widen
`aiConfigs.provider` / `aiProviderIdValidator` and the `setConfig` arg validator (today 5)
to all 14 — additive, non-breaking (existing rows already validate). SOURCE: Ansar #8 + V1.
RATIONALE: V1 confirms the 5-vs-14 drift; the catalog already matches Ansar's 14.

**Q13 — AI keys workspace-scoped vs per-business.**
DECISION: **AI keys = workspace-scoped** (one key set per workspace, owner switches
providers). Stripe = **per-business** (`entityId` required). Plunk = workspace-scoped.
Plaid = workspace-scoped Item token; account→business mapping lives on the connection/account
rows. SOURCE: Ansar #9/#10/#12. RATIONALE: matches Ansar's product model exactly.

**Q14 — Plunk scope + own table vs reuse.**
DECISION: **Plunk = workspace-scoped**, stored in the **single unified `credentials`
table** (`kind:"plunk"`), not its own table and not env-only. SOURCE: Ansar #10/#12.
RATIONALE: one correct storage shape for all credentials.

**Q15 — Stripe webhook: required vs strongly-recommended.**
DECISION: **REQUIRED for any live Stripe connection.** Connecting Stripe = registering +
verifying the webhook endpoint; a connection does not report "listening" until the webhook
is verified. Subscribe to (min): `payout.paid`, `payout.failed`, `payout.canceled`,
`payout.reconciliation_completed`, `charge.succeeded`/`payment_intent.succeeded`,
`charge.refunded`, `charge.dispute.created`/`closed`, `balance.available`. Verify the
`Stripe-Signature`, store `whsec_…` in the same encrypted store, dedupe by `event.id`.
Keep polling as backfill + nightly safety sweep only. SOURCE: Ansar #11 + QBO-parity (R2).
RATIONALE: payout settlement, refunds, disputes are all asynchronous; Stripe says polling
is "much less reliable" and `payout.reconciliation_completed` gates per-payout itemization.

**Q16 — Live-connector gating + sandbox-only verification.**
DECISION: **CHANGED — live connectors must work locally.** Delete the AGENTS.md
"sandbox/test keys only" rule; default the `OPENBOOKS_REAL_TEST_LIVE_CONNECTORS` gate
**open** (or remove it across `connections.ts`, `plaid.ts`, `stripe.ts`, `stripeWebhook.ts`).
**Keep** the encryption-at-rest requirement (`plaid.ts:341`) and the live-key HTTPS-redirect
requirement. Verification may use live or test keys. SOURCE: Ansar #13 + V3. RATIONALE:
Ansar runs his real books on this; the gate already permits live when `=1`.

**Q17 — Plaid item per-entity vs workspace-anchored.**
DECISION: **Workspace-anchored Plaid Item; per-account→entity mapping on the account rows.**
One Plaid login spans both LLCs, so the Item is workspace-level and each `bankAccount` points
to its owning entity. SOURCE: Ansar #6 + QBO-parity (R4/R5). RATIONALE: Ansar's real Plaid
login spans Zikra + Z360; intercompany detection needs both feeds in one workspace.

---

## E4 — Guided onboarding & "done-for-you books" first-run

**Q18 — AI key storage shape.**
DECISION: **Unified `credentials` table** (the `connectionCredentials`-style single
`encryptedPayload` JSON blob via `secretBox`), `kind:"ai"`, workspace-scoped — NOT a
separate per-field `aiCredentials` table. Collapse the dead per-field `aiCredentials`
shape into it. SOURCE: Ansar #12 + V1. RATIONALE: one correct storage shape for all
credentials; the blob shape is the proven one.

**Q19 — History review window.**
DECISION: **CHANGED — user chooses; not a hardcoded 6 months.** Default = pull as much as
the connector gives (Plaid `transactions.days_requested = 730` set at `/link/token/create`;
Stripe = account inception via cursor pagination). Offer a "start my books on…" date control
with presets; snap the chosen start to the first of its month; CSV/OFX upload covers history
older than the connector returns. SOURCE: Ansar #7 + QBO-parity (R3). RATIONALE: never cap
history artificially; request Plaid's max because `days_requested` locks at Item init.

**Q20 — Multi-currency opening balances (USD/PKR/INR).**
DECISION: **CUT — USD-only.** Opening balances are USD integer minor units only; no
per-currency opening balance, no base-currency conversion step. Entity currency is locked
to USD. SOURCE: Ansar #3 + V3. RATIONALE: no multi-currency GL.

**Q21 — Public demo: shared seeded vs per-visitor clone.**
DECISION: **Single shared seeded demo workspace, NO login**, daily reset cron. NOT a
per-visitor clone. SOURCE: Ansar #14 + QBO-parity (R6 §A). RATIONALE: explicit decision #14.

**Q22 — How many AI clarifying questions; fixed or generated.**
DECISION: A **small fixed core set** (≤ ~5) augmented by **AI-detected ambiguities**
(e.g. transfer-vs-income, which account is which business). SOURCE: eng-default (R6) + Ansar
default-rule. RATIONALE: cold-start reliability + targeted follow-ups.

**Q23 — Intercompany handling location.**
DECISION: Detection **logic lives in E5** (extend the cross-entity transfer matcher); E4
only does the **account→business mapping** that makes detection possible and surfaces the
flag in onboarding review. SOURCE: Ansar #6 + QBO-parity (R4). RATIONALE: avoid two
implementations; E5 owns the detector.

---

## E5 — Multi-entity, workspace↔business layer & Portfolio/consolidation

**Q24 — FX source for portfolio conversion.**
DECISION: **CUT — no FX in portfolio.** USD-only roll-up = `SUM(journalLines by account
code across in-scope entities) − eliminated intercompany pairs`. No fxRate, no
"unconverted" badge, no stale-rate policy. SOURCE: Ansar #3 + QBO-parity (R4 §11).
RATIONALE: USD-only collapses ~90% of consolidation complexity to summation.

**Q25 — Workspace base currency default.**
DECISION: **USD, hardcoded.** `entities.createEntity` rejects non-USD (or hardcodes USD);
`workspaceSettings.defaultCurrency` = USD. SOURCE: Ansar #3 + V3. RATIONALE: USD-only.

**Q26 — Re-map an account that has posted history.**
DECISION: **Future-syncs-only re-mapping** — re-mapping affects new transactions; posted
journal lines stay under the original entity (immutability preserved). Surface a clear note.
SOURCE: eng-default + QBO-parity (R4). RATIONALE: posted entries are immutable; Ansar's one
Plaid login spans both LLCs so mixed history is real. *(Borderline product call — see Still
needs Ansar Q26 only if Ansar wants the alternative of blocking re-map.)*

**Q27 — Intercompany scope: same-workspace only or include external holding accounts.**
DECISION: **Workspace-internal only.** Intercompany = a matched counter-leg in a
`bankAccounts` row owned by a *different entity in the same workspace*. Movement to an
account that is **not** an OpenBooks entity is a normal transaction. SOURCE: Ansar #6 +
QBO-parity (R4 §4-5). RATIONALE: the authoritative signal is an owned counter-leg in the
same workspace.

**Q28 — Class/tag tracking within an entity.**
DECISION: **DEFERRED — out of go-live scope.** SOURCE: eng-default. RATIONALE: not in
Ansar's described scope; the income-stream tag (E9-T8) covers the immediate need.

**Q29 — Consolidated reports role gating.**
DECISION: **Mirror single-entity "member can view books" gating** (owner/admin/member who
can view books). Intercompany elimination needs no stricter role. SOURCE: eng-default.
RATIONALE: same data, aggregated view.

---

## E6 — Reports — correctness-aware UI, redesign, responsiveness, export, drill-down

**Q30 — Field contract with E1 (`unreviewed:{count,amountMinor}`).**
DECISION: RESOLVED — E1 adds additive optional `unreviewed:{count,amountMinor}` + accurate
posted/unposted counts on report views; E6 renders the banner gated on field-presence.
SOURCE: eng-default. RATIONALE: clean producer/consumer split.

**Q31 — Scope source ownership with E5.**
DECISION: RESOLVED — **E5 owns** the scope switcher + active-entity context
(`active-entity.tsx`); scope is `"all" | entityId`; `reportPackForScope` branches on it.
E12 ships the switcher *UI shell* hook, E5 owns the read path. SOURCE: Ansar #6 + eng-default.

**Q32 — Multi-currency consolidation presentation.**
DECISION: **CUT — USD-only; single consolidated USD total, no per-currency breakdown, no
base-currency engine.** SOURCE: Ansar #3 + QBO-parity (R4). RATIONALE: no multi-currency.

**Q33 — Intercompany: eliminate vs flag in consolidated view.**
DECISION: **ELIMINATE** (true consolidation) via read-time exclusion of pairs whose both
legs are in scope; show an explicit honest **"Intercompany eliminated: −$X"** line.
Standalone view keeps Due-from/Due-to on the books. SOURCE: Ansar #6 + QBO-parity (R4 §9).
RATIONALE: Ansar explicitly wants elimination in the unified view.

**Q34 — RC5 `.take(5000)` truncation ownership.**
DECISION: **E1 owns the real fix** (E1-T5: date-ordered complete loading / rollup); E6 only
surfaces the truncation banner. SOURCE: eng-default + V2. RATIONALE: it's a ledger-read
correctness fix, not a UI fix.

---

## E7 — Transactions register & Mercury-grade workbench

**Q35 — Saved views FE-only vs server-persisted.**
DECISION: **FE-only (localStorage) for this sprint**; server-persisted saved views deferred.
SOURCE: eng-default. RATIONALE: not load-bearing for go-live; keep blast radius small.

**Q36 — Provenance copy tone.**
DECISION: **Sentence-style, count-aware** where the count is cheap ("Same as your last 6 AWS
charges", "Matched your rule", "Matched a Stripe payout"); fall back to the one-word chip when
no count. The query already surfaces a typed provenance label (E7-1). SOURCE: eng-default +
QBO-parity. RATIONALE: plain-English North Star; richer when data allows.

**Q37 — E7 vs E8 insight-banner ownership.**
DECISION: RESOLVED — **E8 owns the reusable `InsightBanner` contract**; E7 consumes it for the
Transactions banner. One implementation. SOURCE: eng-default. RATIONALE: E8 is the
banners-everywhere epic.

**Q38 — Centralizing "today".**
DECISION: RESOLVED — **E8-T1 lands the single server-clock `today`/`asOf` helper**; E7-10
and everyone else import it. Browser clock for FE display, server `asOf` for query bodies.
SOURCE: eng-default. RATIONALE: one canonical date source.

**Q39 — Register keyboard model.**
DECISION: **Match the Inbox scheme (J/K/Enter/E)** but scope key handling to the register so
it never clashes with global ⌘K or the category combobox typeahead. SOURCE: eng-default.
RATIONALE: consistency with Inbox; avoid global-shortcut collisions.

---

## E8 — Insights everywhere — per-page banners + redesigned insights screens

**Q40 — Banner anchor source (browser clock vs server asOf).**
DECISION: RESOLVED — **browser clock for FE display, server `asOf` threaded into `coreViews`
queries** (E8-T2). SOURCE: eng-default. RATIONALE: deterministic query bodies, exact display.

**Q41 — Retire legacy insight components.**
DECISION: **Retire `InsightsBand`, `MiniCashflowStrip`, `InsightsDashboard`; keep the
`aiInsights` action** as the banner's Explain backend. SOURCE: eng-default. RATIONALE: they
predate the E1 kit and are self-referenced.

**Q42 — Banner dismissible vs always-on.**
DECISION: **Always-on but threshold-gated** — hidden when the page-insight builder returns
null (never a filler line). SOURCE: eng-default. RATIONALE: consistency without noise.

**Q43 — Banners in "All / Portfolio" mode.**
DECISION: **Aggregate across entities in All mode** (portfolio insight), per-entity insight
when a single entity is active; intercompany eliminated in the aggregate. SOURCE: Ansar #6 +
eng-default. RATIONALE: All = consolidated view.

**Q44 — Ship banners with deterministic-only narration before BYO AI lands?**
DECISION: **N/A / resolved by sequencing** — BYO AI is wired in this same sprint (E3/Q11), so
banners get real AI narration with a deterministic fallback (E8-T8), not Bedrock-only.
SOURCE: Ansar #8 + V1. RATIONALE: the BYO-key activation is in scope, not a later epic.

---

## E9 — Dashboard + AI CFO / Financial Advisor + weekly digests

**Q45 — Transfer-marker dependency.**
DECISION: RESOLVED — **E1/E5 land the canonical transfer/intercompany flag**
(`transferPairId` already exists; `intercompanyPairId` added in E5). E9-T1 consumes it; no
interim heuristic, no conflicting markers. SOURCE: eng-default + QBO-parity (R4). RATIONALE:
the matcher already pairs legs; reuse it.

**Q46 — Tax set-aside rate + jurisdiction + where the rate lives.**
DECISION: **Default 30% of trailing book net income**, single configurable workspace setting
`taxSetAsidePct` (default `0.30`), shown as a "money to park" estimate with a mandatory
"not tax advice" disclaimer. Flat rate for v1; not per-entity. SOURCE: QBO-parity (R6 §D).
RATIONALE: 30% is the conservative end of the 25–30% rule (SE tax ~14.13% + typical federal
bracket); state tax is the reason it's editable.

**Q47 — Digest cadence + recipients + portfolio.**
DECISION: **Weekly, Monday 13:00 UTC**, single editable `notificationEmail` per workspace
(E12-T5), weekly default + opt-to-monthly. Multi-entity workspaces get **one combined
portfolio digest** (intercompany eliminated). SOURCE: QBO-parity (R6 §C) + Ansar #6.
RATIONALE: one screen, plain English, lands before the week starts.

**Q48 — Multi-currency in advisories (runway/burn).**
DECISION: **CUT — USD-only.** Runway/burn/forecast sum USD minor units directly; no
per-currency separation, no refusal-to-sum. SOURCE: Ansar #3 + V3. RATIONALE: GL is USD-only,
so the sums are trustworthy by construction.

**Q49 — Stream-taxonomy source of truth.**
DECISION: **Onboarding AI proposes → owner approves → persists; editable later in Settings.**
Defined **once** (shared with E2/Q8 and E4). SOURCE: Ansar #6/#15 + QBO-parity (R6).
RATIONALE: avoid defining the tag twice.

**Q50 — Forecast sophistication.**
DECISION: **Naive run-rate + scheduled-items projection (13-week running balance)** is
sufficient for v1, labelled an estimate. No seasonality/MRR modeling now. SOURCE: QBO-parity
(R6 §B) + eng-default. RATIONALE: matches Puzzle/Fathom headline metrics; seed lacks history
for seasonality.

---

## E10 — Payroll — verify, fix & integrate

**Q51 — FX rate source at settlement.**
DECISION: **Fetch a real day-of-pay rate from whatever source is easiest** (no provider
preference), replacing the hardcoded `PKR:278/INR:83` constant; keep a **manual override**.
Payroll still **books USD**. SOURCE: Ansar #4/#5 + V3. RATIONALE: multi-currency exists ONLY
in payroll, as convert-to-current-USD-value.

**Q52 — Bank-match date window.**
DECISION: **±5 calendar days** around the posting date for auto-matching a salary debit.
SOURCE: Ansar #1 + QBO-parity (R1/R4). RATIONALE: standard ACH/wire settlement window.

**Q53 — In-transit/clearing hop for payroll settlement?**
DECISION: **Settle directly payable→bank for v1** (current behavior); no in-transit hop.
SOURCE: eng-default + Ansar default-rule. RATIONALE: simpler; the Stripe-style clearing hop is
a larger change not required for correctness here. *(Revisit only if real payroll shows
material date drift.)*

**Q54 — Semimonthly auto-draft.**
DECISION: **Monthly auto-draft + manual second run for v1**; true semimonthly auto-draft
deferred. SOURCE: eng-default. RATIONALE: `autoDraftScheduledRuns` only computes monthly
periods today; not launch-blocking.

**Q55 — Per-currency statement legal framing.**
DECISION: **Each LLC's payroll statement is a separate per-entity document** (USD-booked);
a combined portfolio payroll view is read-only roll-up owned by E5, not a legal statement.
SOURCE: Ansar #6 + QBO-parity. RATIONALE: statutory documents are per-entity.

---

## E11 — Data lifecycle — reset/delete-all, demo data & public no-login demo

**Q56 — Anonymous demo session mechanism.**
DECISION: **No anonymous Convex Auth identity.** Serve `/demo` to truly unauthenticated
users; resolve the demo workspace **by slug on the server**; a single shared
`requireWorkspaceRead` helper allows the read when `workspace.isDemo === true`, else requires
auth+membership. SOURCE: QBO-parity/eng-default (R6 §A + V3). RATIONALE: the Anonymous provider
opens a write-abuse surface; we want zero demo writes.

**Q57 — Demo reset cadence.**
DECISION: **Daily reset + reseed at 08:00 UTC** (low-traffic hour), idempotent and
self-healing. SOURCE: QBO-parity (R6 §A). RATIONALE: prospect edits never persist; daily is
enough since there are no real demo writes.

**Q58 — Factory reset revokes Plaid/Stripe via API?**
DECISION: **Delete local connection/credential rows only for v1**; do not call provider
revoke APIs from the reset. (Optional follow-up: `/item/access_token/invalidate` on Plaid.)
SOURCE: eng-default (R5). RATIONALE: avoid network failure modes in a destructive local action.

**Q59 — Full export format.**
DECISION: **JSON snapshot + a zip of per-table CSVs (incl. a journal-lines CSV a CPA can
read)** for v1; re-import path deferred. SOURCE: eng-default + product North Star ("your books
are a file you own"). RATIONALE: honest portability without building an importer now.

**Q60 — Public demo on/off for self-hosters.**
DECISION: **OFF by default**, opt-in via `OPENBOOKS_PUBLIC_DEMO_ENABLED`. SOURCE: eng-default
(R6). RATIONALE: privacy/cost for self-hosters; the hosted instance turns it on.

**Q61 — Reset confirmation phrase.**
DECISION: **Re-type the workspace name** to confirm a per-workspace factory reset (higher
friction, safer), plus an `auditEvents` record. SOURCE: eng-default. RATIONALE: destructive;
name-typing prevents accidental wipes.

---

## E12 — Settings & app-shell UI overhaul + scope-switcher hook

**Q62 — Scope-switcher boundary with E5.**
DECISION: RESOLVED — **E12 ships the switcher UI + `useActiveScope()` context + persistence;
E5 consumes it** for the All-mode read path. Day-one scope=all screens: Dashboard, Reports,
Transactions, Insights; per-entity-only screens fall back to the primary entity. SOURCE:
eng-default + Ansar #6.

**Q63 — Per-entity sections (Categories/Rules) under "All".**
DECISION: **Fall back to the primary entity with a hint** ("Editing categories for Zikra —
switch business to edit Z360"). SOURCE: eng-default. RATIONALE: lower friction than forcing a
pick.

**Q64 — Rules condition-groups migration.**
DECISION: **Read-time shim is sufficient long-term**; a one-time backfill of legacy flat rules
into single-group form is optional, not required. SOURCE: eng-default. RATIONALE: widen-only
schema change; shim avoids a migration risk.

**Q65 — Plunk send-job ownership.**
DECISION: **E12 owns the preference + honest status + Connections deep-link; E9-T6 owns the
actual weekly-digest SEND job** (cron → `sendPlunkEmail`). SOURCE: eng-default. RATIONALE:
clean split; send logic lives with the digest engine.

**Q66 — Audit retention/volume.**
DECISION: **No retention cap for v1** (paginated server-filtered query, drop the 200-row
in-memory cap); a workspace-level audit export lives in **DataSection**. SOURCE: eng-default.
RATIONALE: auditability over premature pruning.

**Q67 — Member removal semantics.**
DECISION: **Detach the `workspaceMembers` row; preserve historical audit/posting attributions**
(immutable journal references — safe); removed users lose access including pending invites.
SOURCE: eng-default. RATIONALE: immutability of the ledger is unaffected.

---

## E13 — Self-host setup skill + deployment + security posture

**Q68 — Skill placement & distribution.** → **ASK ANSAR** (light).
DECISION (default): Commit the skill to a **tracked top-level `skills/openbooks-self-host/`**
directory (since `.claude/`, `.agents/`, `.mcp.json` are gitignored). SOURCE: eng-default.
RATIONALE: a committed skill must live somewhere tracked; Ansar may prefer publishing to a
public `npx skills add` repo instead. *(Resolve only if Ansar wants public-registry
distribution at launch.)*

**Q69 — Auto-provisioning depth.**
DECISION: **Orchestrate-and-pause-for-confirmation**, never fully auto-provision; always pause
before any `--prod` deploy or account-touching step. SOURCE: eng-default + AGENTS.md hosting
rule. RATIONALE: provisioning touches the user's GitHub/Convex/Vercel accounts.

**Q70 — One-click Vercel Deploy template.**
DECISION: **Agent-skill + `pnpm setup` path is sufficient for v1**; publishing a Vercel
marketplace template is deferred. SOURCE: eng-default. RATIONALE: scope; the skill path covers
the need.

**Q71 — Preflight provider coverage.**
DECISION: **Reachability-check the common set (Bedrock/OpenAI/Anthropic/Google/Groq via a
1-token ping); name-check the long tail (Ollama, OpenAI-compatible gateways).** SOURCE:
eng-default (R5). RATIONALE: validate-on-save uses a cheap ping where an endpoint exists.

**Q72 — Public security page depth.**
DECISION: **Lean, honest, code-cited statement for v1** (data-handling summary +
responsible-disclosure email). SOURCE: eng-default. RATIONALE: honesty over marketing; a
disclosure email is a small commitment.

**Q73 — Domain/HTTPS guidance.**
DECISION: Document **`*.vercel.app` + `*.convex.site` as fully sufficient** for self-hosters
without a custom domain; clearly explain the live-key HTTPS-redirect requirement
(`connections.ts:248`) for the live-key upgrade path. SOURCE: eng-default + V3. RATIONALE:
webhooks/redirects need a stable HTTPS origin, which the defaults provide.

**Q74 — Overlap with onboarding epic.**
DECISION: **E13 only documents/links** the paste-keys / opening-balance / AI-review steps;
the in-app key-entry UI and opening-balance posting are owned by E3/E4. SOURCE: eng-default.
RATIONALE: avoid two epics editing `connections.ts`/`OnboardingScreen.tsx` concurrently.

---

## E14 — Quality — tests, accounting invariants, categorization eval & security

**Q75 — GitHub Actions vs `pnpm ci` script.** → **ASK ANSAR** (light).
DECISION (default): Ship a documented **`pnpm ci`** equivalent script now; author
`.github/workflows/ci.yml` only on Ansar's explicit OK (AGENTS.md restricts touching hosting).
SOURCE: eng-default + AGENTS.md. RATIONALE: a push/PR workflow arguably "touches hosting"; the
script is unblocked regardless.

**Q76 — Multi-currency epic ordering for the regression guards.**
DECISION: **CHANGED — USD-only.** The per-currency regression guard (E14-T1) becomes a
**single-currency (USD) trial-balance + balanced-entry** invariant; there is no RC8 multi-currency
fix to wait on. The truncation guard (E14-T3) pairs with E1-T5. SOURCE: Ansar #3 + V3.
RATIONALE: no multi-currency root-cause fix exists anymore.

**Q77 — Disposable-book strategy for e2e.**
DECISION: **E2E only ever creates fresh workspaces** (never mutate Ansar's real Zikra/Z360
rows); a dedicated isolated entity is the fallback only if a shared-deployment constraint forces
it. SOURCE: eng-default. RATIONALE: guarantee real books are never touched by a test run.

**Q78 — Categorization eval without a live AI key in CI.**
DECISION: **Run the eval against a recorded/mock provider (deterministic, no key) in CI**;
assert the accuracy math as a unit test. SOURCE: eng-default (R5 degrade-gracefully). RATIONALE:
deterministic CI, no key dependency.

**Q79 — Dependency-scan tooling.**
DECISION: **`pnpm audit` + a committed secret-scanner (gitleaks)** for v1; a full SCA
(Snyk/Trivy) is optional follow-up. SOURCE: eng-default + Ansar #12 (secret safety). RATIONALE:
catch leaked secrets and known-vuln deps cheaply.

---

## E15 — Docs, Help Center, Landing & GTM

**Q80 — Repo naming.** → **DECIDED by Ansar (2026-06-17).**
DECISION: **Rename the public repo to `openbooks`.** Write all links/badges against
`github.com/<owner>/openbooks`. SOURCE: Ansar. RATIONALE: brand match; all GTM links resolve.

**Q81 — License intent.** → **DECIDED by Ansar (2026-06-17): MIT.**
DECISION: **MIT everywhere.** This is a real RELICENSE, not just a copy fix: replace the
root `LICENSE` file (currently GNU AGPL-3.0) with the MIT license, and change every `AGPL`
reference in `README.md` (line 62), `docs/product/01-vision-and-scope.md`, and `AGENTS.md`
to MIT. The landing page's existing four "MIT licensed" claims + the two FAQ mentions become
**correct** — verify them rather than rewrite them. SOURCE: Ansar. RATIONALE: Ansar chose the
permissive license to maximize adoption; he owns all contributions (solo project) so the
relicense is clean. Note the tradeoff in copy honestly (anyone may fork and close-source).

**Q82 — Public demo backend ownership/timing.**
DECISION: RESOLVED — the no-login demo backend is **owned by E11 and ships before launch**
(Ansar #14, #15). Landing "Try the demo" CTAs point at `/demo`. SOURCE: Ansar #14/#15.
RATIONALE: the demo is in scope and required.

**Q83 — Self-host story (Docker claim).**
DECISION: **Drop the Docker / `docker compose up` claim**; describe the real Convex-cloud-dev +
Next.js-on-Vercel BYO-keys flow honestly. SOURCE: eng-default + V3. RATIONALE: the stack is not
Docker; marketing must be true.

**Q84 — Honest status table at launch.**
DECISION: **Publish the honest status, but only after the E1–E7 fixes land** — by go-live the
RC2/RC3/RC4 items are fixed so the table can read "working," with anything still in progress
labelled honestly. SOURCE: Ansar #15 (all epics) + product North Star. RATIONALE: Ansar wants
to run real books on this; ship the fixes, then tell the truth.

**Q85 — Custom domain vs Vercel URL.** → **DECIDED by Ansar (2026-06-17).**
DECISION: **Point public launch links at the custom domain `openbooks.ansarullahanas.com`.**
Fall back to the Vercel URL only if the alias isn't live at launch time. SOURCE: Ansar.
RATIONALE: branded canonical origin for landing/README/outreach/demo-video.

**Q86 — Ansar inputs for the "why" one-pager.** → **ASK ANSAR.**
DECISION: Draft the one-pager with clearly **marked input slots** (personal story, the
QuickBooks/Bench-failure moment, audience sign-off); Ansar fills them. SOURCE: Ansar #16.
RATIONALE: only Ansar has these words; everything else is pre-drafted.

**Q87 — Issue seeding (backlog → GitHub issues).**
DECISION: **Stage the labeled-issue script for Ansar to execute** (or an agent with delegated
auth he grants); do not run it unattended. SOURCE: eng-default + AGENTS.md. RATIONALE: needs
repo-write auth Ansar controls.

---

## Still needs Ansar (the genuine product calls)

**Resolved by Ansar on 2026-06-17:** Q80 → rename repo to `openbooks`; Q81 → **MIT** license
(relicense the LICENSE file + flip README/vision/AGENTS.md AGPL→MIT; landing MIT claims are now
correct); Q85 → custom domain `openbooks.ansarullahanas.com`.

**Remaining — one true input + two pre-defaulted (Ansar can override anytime):**

- **Q86 — "Why I'm building this" one-pager** (the only one needing Ansar's *words*): his personal
  story / the QuickBooks/Bench failure moment / who it's for. The asset is drafted with clearly
  marked input slots; Ansar drops in 3–5 sentences per slot when ready. Not build-blocking.
- **Q68 — Self-host skill distribution** (pre-defaulted): committed `skills/openbooks-self-host/`
  dir. Override only if Ansar wants public `npx skills add` registry distribution at launch.
- **Q75 — GitHub Actions CI** (pre-defaulted): documented `pnpm ci` script now; a live
  `.github/workflows/ci.yml` only on Ansar's explicit OK (AGENTS.md hosting restriction).

Everything else (Q1–Q79, Q82–Q84, Q87) is **RESOLVED** by Ansar's decisions, QBO parity, or an
engineering default and needs no further input.
