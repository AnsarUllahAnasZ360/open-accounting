# V3 — Currency / Live-Connector / Demo Verification

Branch verified: `codex/real-world-testing`. Read-only investigation.
Scope: (A) every multi-currency/FX touchpoint (what becomes USD-only vs what stays in payroll), (B) the live-key constraint location + code gate, (C) the demo-slug fallback for the no-login public demo.

---

## A. Multi-currency / FX touchpoints — Current truth (file:line evidence)

### A.0 Big picture (important)
The **general ledger is already de-facto single-currency**. Reports sum `debitMinor`/`creditMinor` directly with **no FX conversion**; `line.currency` is carried but never used to convert. So "USD-only GL" is mostly a matter of (a) deleting unused FX plumbing and (b) forcing entity base currency = USD, **not** ripping out a working multi-currency engine. The only place FX rates do real math today is **payroll**, and payroll **already books USD** (settlement + accrual lines post in `entity.currency`; the foreign rate only converts local→USD-equivalent). That matches Ansar's decisions 3 + 4 closely.

### A.1 Schema — currency fields
- `convex/schema.ts:219-220` — `journalLines.currency: v.string()` + `fxRate: v.optional(v.number())`. **`fxRate` on journalLines is DEAD** — never written or read anywhere in `convex/*.ts` (only payroll's separate `fxRateMicros` is used). Candidate to drop / leave optional+unused.
- `convex/schema.ts:37` — `workspaceSettings.defaultCurrency: v.string()` (free string).
- `convex/schema.ts:71` (`entities.currency`), `183`, `425`, `501`, `524`, `558`, `615`, `624` — many tables carry a `currency` string; all flow from `entity.currency`.
- `convex/schema.ts:690,695` — `payrollRunLines.currency` (local) + `fxRateMicros: v.number()` (KEEP — payroll FX).

### A.2 General ledger — must become USD-only
- **`convex/ledger.ts:420`** — `currency: line.currency ?? args.entity.currency` on posting; `:431` summary appends `args.entity.currency`. Posting tags every line with the entity currency. → force USD.
- **`convex/entities.ts:139-149`** — `createEntity` accepts any 3-letter code: `if (!/^[A-Z]{3}$/.test(currency)) throw`. **This is the gate that lets non-USD entities exist.** USD-only ⇒ reject non-USD here (or hardcode `"USD"`).
- **`convex/reports.ts`** (trial balance / seedVerification, ~line 595 region of the old plan = `reports.ts` handler) — `addBalance`/`normalBalance` sum `debitMinor`/`creditMinor` with **zero currency awareness** (`reports.ts:20-32`). Already currency-blind; correct for USD-only, but proves no FX summation exists to "fix" — just confirm entity is USD so the implicit assumption holds.
- **`convex/reportViews.ts:245-249`** `reportAmountForLine` and **`:303-321`** the aggregation loop — sum `amountMinor` across all lines **regardless of `line.currency`** (the old plan's "reportViews.ts ~303"). No conversion. Correct only because everything is USD. `line.currency` is passed through to drill-down rows (`:267`, `:791`) for display only.

### A.3 Payroll FX — KEEP, convert-to-USD only (decision 4)
- **`convex/payrollMath.ts:16-24`** — **hard-coded `DEFAULT_FX = { PKR: 278, INR: 83 }`** + `defaultFxRateMicros()`. This is the literal hardcoded-rate Ansar flagged. Decision 5 says replace the *source* with "whatever is easiest to obtain" (a real day-of-pay rate), payroll-only. Keep the convert-to-USD shape; swap the hardcoded constant for a fetched rate.
- `convex/payrollMath.ts:8` `FX_MICRO_SCALE`, `:37-39` `baseEquivalentMinor`, `:42-48` `parseFxRateToMicros`, `:52-58` `formatFxRateMicros` — KEEP (payroll math).
- `convex/payroll.ts:103,217,317` call `defaultFxRateMicros(employee.currency, entity.currency)`; `:539` `settleLine` computes `settlementBaseMinor = baseEquivalentMinor(...)` and books an **FX gain/loss line** to `FX_GAIN_NUMBER`/`FX_LOSS_NUMBER` — **all settlement lines post in `entity.currency` (USD)** (`payroll.ts:543-558`). KEEP: this is exactly "payroll books USD."
- `convex/payroll.ts:387,399` — `updatePayrollLine` accepts a manual `fxRate` override → `parseFxRateToMicros`. KEEP (manual day-of-pay rate entry).

### A.4 Multi-currency DISPLAY surfaces (payroll-only, keep) — but watch the "sum across currencies" bug
- `convex/reportViews.ts:740-875` — Payroll Summary builds `payrollCurrencyTotals` per local currency + `hasFx`/`byCurrency`. Local-currency rollup for display. Keep (payroll).
- `convex/moduleViews.ts:619-654,791-798` — `currencyTotals` per employee currency. Keep (payroll).
- `convex/moduleViews.ts:103-104` `baseMinorForEmployee` — `if (employee.currency === baseCurrency) return monthlySalaryMinor` (USD-equivalent helper). Keep.
- **`convex/aiInsights.ts:658`** — `totalBaseMinor = payroll.currencyTotals.reduce((sum, row) => sum + row.baseMinor)` sums **baseMinor** (already USD-equivalent) → fine. `:666-670` "Multi-currency payroll" advisory ("Pay runs span N currencies"). This is a payroll advisory, not a GL FX advisory — keep (it's about payroll, not consolidation). The old plan's "E9 multi-currency advisories" that should collapse refers to GL/consolidation advisories, not this payroll note.

### A.5 No general-ledger FX engine to delete
Searched `fxRate` across `convex/*.ts`: every real consumer is payroll (`payrollMath`/`payroll`/`payrollRunLines`). The only GL FX artifact is the **dead** `journalLines.fxRate` optional field (`schema.ts:220`) and the harmless `line.currency` pass-through. There is **no RC8-style GL FX conversion engine implemented** on this branch — so "DELETE the GL FX engine" is mostly "delete the dead field + lock entity currency to USD," not removing live conversion code.

---

## B. Live-connector constraint — Current truth (file:line evidence)

### B.1 The doc rule to remove (decision 13)
- **`AGENTS.md:82-83`** (exact text):
  > `- Only Plaid sandbox and Stripe test-mode keys may be used in this goal; live`
  > `  keys are banned from every env store.`
  Also reinforced at `AGENTS.md:109-110` (Plaid sandbox + Stripe test webhook only) and in docs: `docs/finishing/frontend-redesign-implementation-launch-prompt.md:31,41`, `docs/finishing/execution-plan-2026-06-12.md:102`. The CLAUDE.md "Technical Rules" copy of this constraint also exists (it embeds AGENTS.md). Update the canonical line in `AGENTS.md:82-83`.

### B.2 The single code gate — env var `OPENBOOKS_REAL_TEST_LIVE_CONNECTORS`
One env flag gates ALL live connectors. It is **already a kill-switch that ALLOWS live when set to `1`** — so "live connectors work locally" is achievable today by setting `OPENBOOKS_REAL_TEST_LIVE_CONNECTORS=1`. Per decision 13 the gate should be removed/defaulted-open. Every enforcement point:

- **`convex/connections.ts:134-136`** `requireRealDataFlag()` — throws unless `=1` for `development|production|live` mode (shared Plaid+Stripe gate).
- `convex/connections.ts:223-224` — live Stripe secret key blocked unless `=1`.
- `convex/connections.ts:248` — live Stripe redirect URI must be HTTPS when `=1` (the old plan's "connections.ts ~248").
- `convex/connections.ts:388,393` — surfaces `liveEnabled: ... === "1"` to the UI.
- **`convex/plaid.ts:333-335`** — preflight pushes "Plaid development/production is blocked until …=1" (the **preflight** the task referenced).
- `convex/plaid.ts:341` — non-sandbox Plaid token storage requires a secret-encryption env (`secretEncryptionEnvLabel()`).
- **`convex/stripe.ts:308-317`** — `sk_live_`/`rk_live_` keys blocked unless `=1`; `:2042-2043`, `:2091-2092` block live Stripe sync/webhook sync unless `=1`.
- **`convex/stripeWebhook.ts:135`** — `realDataAllowed = ... === "1"` gate on the webhook route.
- Secondary key-format guards: `connections.ts:228-231` (`sk_live_` required for live, `sk_test_` for test) and Plaid `PLAID_ENV` validation `plaid.ts:322-330`. These are format checks, not the live block; review whether to relax.

**To make live connectors work locally (decision 13):** either default `OPENBOOKS_REAL_TEST_LIVE_CONNECTORS=1` (lowest-touch) or remove the gate at the 4 enforcement files above (`connections.ts`, `plaid.ts`, `stripe.ts`, `stripeWebhook.ts`) + delete the AGENTS.md:82-83 rule. Keep secret-encryption-at-rest requirement (`plaid.ts:341`) — that aligns with decision 12 (one encrypted credential store), don't drop it.

---

## C. Demo / no-login public demo — Current truth (file:line evidence)

### C.1 There is NO public no-login demo today
- Demo = a per-workspace, **authenticated** feature. Schema: `entities.isDemo: v.boolean()` (`schema.ts:72`); demo seed jobs `kind: "demo"` (`schema.ts:935`, `seedDemo.ts:8-9`).
- `convex/seedDemo.ts:170-233` `seedDemoBooks` **requires a viewer + existing workspace** (`:209-212` throws "requires a workspace before seeding demo data"). Demo data is seeded **into the signed-in user's workspace**, not a shared public one.
- UI: `apps/web/src/components/openbooks/DemoDataPanel.tsx`, `AppShell.tsx:773-778` "Demo workspace" toggle, `settings/DataSection.tsx` — all inside the authenticated shell.
- `apps/web/src/app/sign-in/page.tsx:36` — "Hosted-demo requests are captured…" i.e. **no live public demo exists**; it's a waitlist note.
- **No Next.js `middleware.ts`** exists in `apps/web` (searched) — so there is no route-level public/demo bypass.

### C.2 Where the workspace/slug fallback lives (the hook point for decision 14)
- **`convex/auth.ts:203-226`** — workspace is resolved by slug with a fallback:
  `const workspaceSlug = args.workspaceSlug?.trim() || process.env.OPENBOOKS_OWNER_WORKSPACE_SLUG || "ansar-workspace";` then `.withIndex("by_slug", q => q.eq("slug", workspaceSlug))`.
  This is the existing **slug-fallback** primitive and the natural place to add a `"demo"` (or shared public-demo) slug resolution path.
- `convex/schema.ts:677-680` — workspaces have a `.index("by_slug", ["slug"])`; entities have `by_workspace_and_slug` (used at `ledger.ts:268`). Both indexes already support slug lookup for a shared demo workspace.
- Reference pattern for a fixed shared entity: **`convex/ledger.ts:260-320`** `ensureLiveSandboxEntity` creates/refreshes an entity at a fixed slug `"live-sandbox"` (`:265`) under the caller's workspace. The no-login demo (decision 14) should follow this shape but resolve a **single shared workspace+entity by slug with NO auth**, reusing `seedDemo.ts` content.

---

## What's already done vs still open

**Already done / aligned:**
- GL is currency-blind in reports (`reports.ts`, `reportViews.ts:245-321`) — no FX engine to remove; matches USD-only intent.
- Payroll already converts foreign→USD and **books USD** (`payroll.ts:539-558`) — matches decision 4. Manual day-of-pay rate entry exists (`payroll.ts:387,399`).
- Live connectors are gated by ONE flag (`OPENBOOKS_REAL_TEST_LIVE_CONNECTORS`) that already permits live when `=1`.
- Slug-fallback resolution primitive exists (`auth.ts:209`) and a fixed-slug shared-entity pattern exists (`ledger.ts:260` `live-sandbox`).

**Still open:**
1. `entities.createEntity` (`entities.ts:139-149`) accepts any currency → must enforce USD-only.
2. Hardcoded payroll rates `PKR:278 / INR:83` (`payrollMath.ts:16-18`) → replace source with a fetched day-of-pay rate (decision 5).
3. Dead `journalLines.fxRate` field (`schema.ts:220`) → remove/leave unused.
4. AGENTS.md:82-83 rule → delete (decision 13); decide gate removal vs default-open across the 4 files.
5. **No public no-login demo at all** (decision 14) → build a shared demo workspace+entity + an unauthenticated read path; hook at `auth.ts:203-226` slug resolution, model on `ledger.ts:260` + `seedDemo.ts`.

## Implications for the plan
- "Delete the GL FX engine" is small: lock entity currency to USD + drop the dead `journalLines.fxRate`. There is no live GL conversion code to excise.
- Keep all payroll FX (math + per-currency display + payroll advisory). Only swap the rate *source*.
- Live-connector unblock = remove AGENTS.md rule + neutralize one env flag across 4 files; preserve encryption-at-rest requirement (feeds decision 12).
- The no-login demo is net-new (no current public path); reuse the existing slug-fallback + fixed-slug-entity patterns rather than per-visitor clones (decision 14).
