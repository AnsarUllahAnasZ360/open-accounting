# OpenBooks Finishing Plan — Epics for the Opus 4.8 Run

Date: 2026-06-11 · Branch: `finishing` (cut from `initiation`)
Authored from: the full audit in `docs/finishing/audit-report.md`,
`docs/product/01-vision-and-scope.md`, `docs/product/02-product-spec.md`,
`docs/product/03-design-brief.md`, the prototype in `OpenBook - Prototype/`,
`OpenBooks Design System/`, and fresh research on `@convex-dev/agent` and
Vercel AI Elements (§ References).

## 0. North star (the definition of "done")

Ansar starts the app locally in dev mode, signs in with one click, and can
exercise **every** capability end to end, with the UI matching the
`OpenBook - Prototype/*.dc.html` files closely enough to feel like the same
product:

1. Create a workspace and a business (entity) through onboarding; chart of
   accounts seeds by business type.
2. See and use: collapsible sidebar with profile/settings/logout footer,
   ⌘K search, entity switcher, Ask AI (⌘J) docked panel with threads.
3. Connect Plaid **sandbox** (real Link flow, fresh sandbox keys), select
   accounts, sync transactions → pipeline categorizes → confident items post
   to the ledger, uncertain items land in Inbox.
4. Connect Stripe **test mode**; charges/invoices/payouts sync; payouts
   reconcile gross−fees through the clearing account; webhook events trigger
   sync.
5. Work the Inbox (confirm / correct / rule / batch / keyboard).
6. Use Income (payments, invoices, receivables), Expenses (categories,
   vendors, recurring), Bills (incl. mark-paid → bank match), Contacts,
   Payroll (open a run → detail → approve → mark paid → statement).
7. Reports: home grid → any report → sane default periods, drill-down,
   compare, cash⇄accrual, CSV export that matches the screen; Monthly Review
   reads like a story.
8. Ask AI anything about the books (real Bedrock, streamed markdown,
   persistent threads) and confirm proposed actions that post through the
   ledger with audit attribution.
9. Settings: 10-section subnav, all sections real.
10. Mobile: dashboard, inbox, transactions, chat genuinely usable at 390px.

Every item above is verified by a Playwright test using **real pointer
clicks** plus a screenshot, and `docs/finishing/completion-report.md` reports
status with the honesty contract (§ H5).

## 1. Non-negotiable invariants (carry over, enforce in review)

From `AGENTS.md` / `docs/initiation/goal.md` — unchanged:

- Money = integer minor units + currency code. No floats, ever.
- `ledger.postEntry` is the only ledger write path; Σdebits = Σcredits or
  reject; posted entries immutable; corrections reverse + repost.
- Every Convex function re-checks workspace/entity authorization.
- External APIs in actions; transactional writes in mutations.
- Autonomy thresholds: one shared constant (suggest = never, balanced = 0.90,
  autopilot = 0.75).
- Plaid sandbox + Stripe test keys only. No secrets in git or logs.
- Design: Geist, lucide, one green `#2ca01c`, white ledger surfaces, tabular
  money figures, quiet AI (green sparkles, never purple), no gradients, no
  emoji. Radii: cards 14px, controls 10px. Sidebar 232px / rail 56px.
  Content max 1200px.
- UI copy: plain English ("money you're owed", never "accounts receivable"
  outside report titles); sentence case; statuses from the fixed vocabulary
  in `OpenBooks Design System/readme.md`.
- Before Convex work: `npx convex ai-files install`, read
  `convex/_generated/ai/guidelines.md`. Before Next.js work: read the
  relevant pages in `apps/web/node_modules/next/dist/docs/` (Next 16 differs
  from training data).
- Preserve `OpenBook - Prototype/` and `OpenBooks Design System/` untouched.
- Work on branch `finishing`; commit per task batch; never force-push.

## 2. Verification protocol (applies to every task)

The previous run's failure mode was weak verification. Every task below ships
with its own verification; additionally:

- **Real interactions only.** Playwright tests must use real pointer clicks.
  `dispatchEvent("click")` and `force: true` are banned; if a click is
  intercepted, that is a product bug — fix the product.
- **Layout assertions.** New/changed screens assert: no horizontal scroll at
  390px and 1440px; interactive targets not covered by other elements
  (bounding-box overlap check against the AI panel and drawers).
- **Number consistency.** Where a number appears in two places (dashboard
  tile ↔ report ↔ CSV export), a test asserts equality.
- **Screenshot evidence** per task into `docs/finishing/evidence/`
  (`YYYY-MM-DD-<epic><task>-<slug>.png`), desktop and mobile where relevant,
  indexed from the completion report.
- **Gates per batch:** `pnpm verify` (typecheck, lint, build, unit) and the
  full `pnpm test:e2e` must be green before a batch is committed.
- **Convex deploy check** after backend changes: `npx convex dev --once`
  green.

## 3. Execution model

Each epic below is one **batch** assigned to one agent. Tasks within a batch
are ordered; batches respect the dependency graph:

```
A (shell)
├─→ B (Ask AI)            [B1–B3 backend can start immediately]
├─→ C (Income/Expenses/Bills)
├─→ D (Reports & Payroll)
└─→ E (Settings shell)
F (identity/onboarding)    [F1 needs E2 entity mutations; F4 independent]
G (money rails)            [backend-heavy; G1–G4 independent of A–E; G5 after A5]
H (verification closeout)  [last; H1 can start once A and B land]
```

Suggested wave plan: **Wave 1:** A + G(backend tasks) + B1–B3 in parallel.
**Wave 2:** B4–B6 + C + D + E. **Wave 3:** F + G5. **Wave 4:** H.
Agents touching the same files (e.g. `AppShell.tsx`) must not run
concurrently; the orchestrator owns merge order and runs the gates between
waves.

---

# EPIC A — App shell & navigation fidelity

**Why:** The shell is the frame every screen sits in, and it diverges from
the prototype in exactly the ways Ansar flagged. Reference:
`OpenBook - Prototype/OpenBooks.dc.html` (expanded sidebar ~lines 28–104,
collapsed rail ~lines 109–137, AI panel ~lines 193–300),
`docs/product/03-design-brief.md` §0, design-system `readme.md` layout rules.
Current implementation: `apps/web/src/components/openbooks/AppShell.tsx`,
nav config `apps/web/src/lib/openbooks/content.ts`.

### A1 — Sidebar collapse-to-icon rail
- **Context:** Prototype has two sidebar states: expanded 232px and a 56px
  icon-only rail with a collapse/expand control. Implementation has only a
  mobile open/close state (`AppShell.tsx:71-86`); desktop is fixed-expanded.
- **Do:** Add a `collapsed` state (persisted, e.g. localStorage +
  `data-state` on the aside). Expanded: logo lockup, workspace name, entity
  switcher, labeled nav with count badges, Settings, footer. Collapsed: logo
  mark only, entity avatar, icon nav with tooltips (shadcn Tooltip), icon
  footer. Collapse control placed as in the prototype. Main content padding
  switches 232px ⇄ 56px with a 120–160ms ease-out transition (color/layout
  only, no bounce). Mobile drawer behavior unchanged.
- **Done when:** Both states pixel-match the prototype structurally; state
  survives reload; every route reachable from the rail.
- **Verify:** e2e: real-click collapse → aside width 56px → tooltip shows on
  hover → navigate to Reports from rail → reload → still collapsed → expand.
  Screenshots of both states. Overlap check vs content at 1280px.

### A2 — Sidebar footer: sync, profile, settings, logout
- **Context:** Prototype footer = sync status line, then a profile row
  (avatar initial, "Ansar Ullah", "Owner"); Settings is the last nav item.
  Implementation has a static "Sync status / Synced" text block only
  (`AppShell.tsx:187-194`); no profile, no logout anywhere. Ansar explicitly
  wants profile + settings + logout reachable from the sidebar footer.
- **Do:** Footer per prototype: (1) sync row — last-sync time from real data
  with a "Sync now" affordance (wired to the existing sync actions for the
  active entity; spinner while running); (2) profile row — avatar with
  initials, display name, role from the viewer query; clicking opens a
  DropdownMenu: **View profile** (→ `/profile`, built in F2 — until then a
  disabled item is acceptable for one wave), **Settings** (→ `/settings`),
  **Log out** (Convex Auth signOut → redirect to `/sign-in`). Works in
  collapsed rail (avatar-only trigger). Keyboard accessible.
- **Done when:** Menu opens with real click in both sidebar states; logout
  round-trips to sign-in and back in via dev mode.
- **Verify:** e2e: open menu → Log out → assert sign-in page → sign back in.
  Screenshot of open menu. Unit: viewer query returns name/role used here.

### A3 — Navigation IA: Income & Expenses (terminology change)
- **Context:** Prototype nav (canonical order): Dashboard · Inbox ·
  Transactions · Income · Expenses · Bills · Contacts · Payroll · Reports ·
  Settings. Implementation ships Invoices and Bills
  (`content.ts:42-51`) — Ansar explicitly wants Income and Expenses.
  Prototype screens: `Income.dc.html`, `Expenses.dc.html`.
- **Do:** Add `/income` and `/expenses` routes rendering the new screens
  (built in Epic C; until C lands, route them to the existing
  Invoices/Bills screens so nav is never broken). Redirect `/invoices` →
  `/income`. Keep `/bills`. Update nav config, icons (lucide; money-in /
  chart-pie family per design system), mobile tab config, breadcrumbs/page
  headers, and all copy referring to "Invoices" as a section. Inbox nav item
  shows count badge; green dot at zero (prototype behavior).
- **Done when:** Nav order/labels match the prototype exactly; no dead links;
  old URLs redirect.
- **Verify:** e2e asserts the 10 nav items in order; `/invoices` redirects;
  badge renders seeded inbox count. Screenshot.

### A4 — Top bar: ⌘K global search, period chip, Ask AI button
- **Context:** Prototype top bar: search input "Search transactions,
  contacts, reports… ⌘K", date-context chip ("Jun 2026"), "Ask AI ⌘J"
  button. Implementation has a search stub and an Ask AI button without
  shortcuts.
- **Do:** Command palette (shadcn Command in a Dialog) on ⌘K / ctrl+K:
  searches transactions (server query — merchant/description prefix match on
  the active entity; add a search index to the schema if absent), contacts,
  report names, and nav actions; Enter navigates (transaction → register
  with drawer open; contact → profile; report → viewer). Period chip shows
  the active dashboard period where relevant. ⌘J toggles the AI panel.
- **Done when:** Palette returns seeded data fast (<300ms perceived), works
  from any screen, and is keyboard-first.
- **Verify:** unit test for the search query (authz + scoping); e2e: ⌘K,
  type a seeded merchant, Enter, assert register opens that transaction's
  drawer; ⌘J opens AI panel. Screenshot.

### A5 — Entity switcher + token polish sweep
- **Context:** Prototype: workspace name above an entity pill ("Acme Studio
  LLC ▾") whose menu lists entities with meta + "Add a business".
  Implementation has a static switcher; several screens hardcode the entity
  (e.g. `AppScreen.tsx:14` eyebrow "Acme Studio LLC"). Design tokens: card
  radius 14px, control radius 10px, near-invisible shadows, 24/semibold page
  titles, tabular figures — partially applied.
- **Do:** Active-entity context (URL or client store + server respected):
  switcher menu lists workspace entities (Acme Studio LLC, Live Sandbox) +
  "Add a business" → Settings → Businesses. All screens read the active
  entity — remove hardcoded eyebrows/names. (Full query plumbing for
  non-demo entities completes in G5; this task delivers the switcher UI,
  context wiring, and the screens' use of it.) Then a one-pass token sweep:
  radii, shadows, title sizes, letter-spacing 0, money figures tabular.
- **Done when:** Switching entities visibly changes Dashboard/Transactions
  data; no hardcoded entity names; tokens match design system on the five
  core screens.
- **Verify:** e2e: switch to Live Sandbox → register/header reflect it;
  switch back. Visual screenshots of Dashboard/Transactions vs prototype.

---

# EPIC B — Ask AI rebuilt on Convex Agent + AI Elements

**Why:** Chat is the product's soul and currently: overlays the content
(translate-x slide-over, `OpenBooksAIChat.tsx:249-254`,
`AppShell.tsx:197-263`), forgets everything on reload (component state only),
renders plain text (no markdown), fake-streams (server generates fully, then
dribbles words), and answers the five flagship questions via hardcoded
keyword routing (`OpenBooksAIChat.tsx:64-78`). Rebuild it properly on
**`@convex-dev/agent`** (durable threads/messages in Convex, real
delta-streaming over live queries) + **AI Elements** (shadcn-based chat
components with Streamdown markdown). Research details + gotchas: § References.
The repo is already on AI SDK v6 (`ai@^6`, `@ai-sdk/amazon-bedrock@^4`) —
write everything against v6 APIs.

### B1 — Agent component install + durable threads
- **Do:** `pnpm add @convex-dev/agent convex-helpers` (root). Create
  `convex/convex.config.ts` with `app.use(agent)`; codegen. Define the
  OpenBooks agent (new `convex/agent.ts`): `languageModel` from the existing
  Bedrock construction in `convex/aiSdkRuntime.ts` / `aiProviderRegistry.ts`
  (env-driven; degraded mode when absent), instructions encoding the product
  voice + "AI proposes, the ledger engine posts", `stopWhen: stepCountIs(5)`.
  Add an app-side `chatThreads` ownership table: `{ threadId, workspaceId,
  entityId, userId, title, lastActiveAt }` + `authorizeThreadAccess(ctx,
  threadId)` built on `convex/authz.ts`. Thread API: create (auto-title from
  first message), list mine (recent first), rename, delete.
- **Done when:** Threads create/list/delete with authz; agent answers a
  trivial prompt in a dev smoke action; absent Bedrock env → clean degraded
  result, not a crash.
- **Verify:** convex-test units: cross-workspace access rejected; thread CRUD;
  degraded path returns the documented shape. `npx convex dev --once` green.

### B2 — Read tools + real streaming
- **Do:** Port the five read tools from `convex/aiChatTools.ts` to agent
  tools (`createTool`): `getReport` (P&L/BS/CF/aging/monthly-review over
  `reportViews`), `getBalances`, `queryTransactions`, `searchContacts`,
  `getPayrollRuns`. Every handler re-derives authz from `ctx` + the thread's
  workspace/entity — never from client args. Message flow per Agent docs:
  `sendMessage` **mutation** (saveMessage + `ctx.scheduler.runAfter(0, …)`)
  → internal action `agent.streamText(ctx, {threadId}, {promptMessageId},
  { saveStreamDeltas: { chunking: "word", throttleMs: 250 } })`. Expose
  `listThreadMessages` query with `syncStreams` + pagination. Delete the
  legacy `/ai/chat` HTTP pseudo-stream route (`convex/http.ts`) once parity
  is reached (B5 removes the client).
- **Done when:** A question streams token-by-token into two browser tabs
  simultaneously and survives reload; tools execute with authz; tool calls
  visible as parts on the message.
- **Verify:** units: each tool rejects foreign workspace; integration (dev
  deployment): scripted question → assert deltas arrive incrementally
  (timestamps) and persist. Evidence: timing log + screenshot.

### B3 — Propose→confirm action tools (the trust contract)
- **Context:** Today's confirm cards work but live outside any persistent
  thread; proposals must survive in the DB, not in component state.
  Prototype shows the pattern: "PROPOSED RULE … [Create rule] [Not now]".
- **Do:** `proposals` table: `{ workspaceId, entityId, threadId, messageId,
  kind: categorize|rule|invoiceDraft|bill|journalEntry, payload, status:
  proposed|confirmed|dismissed|expired, createdBy, decidedBy?, decidedAt? }`.
  Action tools (`proposeCategorize`, `proposeRule`, `proposeInvoiceDraft`,
  `proposeBill`, `proposeJournalEntry`) are **side-effect-free**: validate
  with the same server logic, persist the proposal, return its id +
  human-readable summary for the message part. One `confirmProposal`
  mutation per kind family: re-checks authz, re-validates, executes through
  the existing paths (pipeline routing / `postEntry` / existing
  `aiChatActions` logic), marks confirmed, writes the audit event with AI +
  confirming-user attribution, and appends a result message to the thread.
  `dismissProposal` records the dismissal. Stale proposals auto-expire when
  a newer generation starts in the thread.
- **Done when:** All five action kinds round-trip: ask → proposal card data →
  confirm → posted (balanced, audited) → thread shows the outcome; dismiss
  works; a confirmed-twice proposal is idempotently rejected.
- **Verify:** units per kind incl. double-confirm + cross-entity rejection;
  e2e (with B4): "categorize that Figma charge as Software" → real-click
  Confirm → register shows reposted category, audit log shows AI badge.

### B4 — Chat UI on AI Elements (markdown, tools, confirmations, threads)
- **Do:** In `apps/web`: `pnpm dlx ai-elements@latest add conversation
  message prompt-input tool confirmation suggestion loader`; add the
  Streamdown `@source` line to `globals.css` (Tailwind v4 purge fix — see
  References). Rebuild the panel content on `useUIMessages(...,
  { stream: true })` + `useSmoothText` from `@convex-dev/agent/react`:
  `Conversation` scroll container; `Message`/`MessageContent` per role;
  markdown via the message Response component (tables, lists, bold — the
  prototype answer with the Income/Expenses/Net-profit 3-card grid and an
  "Open Profit & Loss →" link is the fidelity bar: render report links as
  buttons that navigate); tool parts → `Tool` collapsibles; proposals →
  `Confirmation`-styled cards wired to B3 mutations; empty state =
  page-aware `Suggestion` chips (the five flagship questions); header =
  context chip ("Viewing: Reports · May 2026") + thread switcher (recent
  threads list + "New conversation") + expand + close. Restyle tokens:
  OpenBooks green, white surfaces, 14px cards, sparkles icon — zero purple,
  zero gradients. Delete the keyword-routing/deterministic-answers path from
  `OpenBooksAIChat.tsx` — all answers come from the agent (degraded mode
  shows an honest "AI is not configured" state with working read-tool-free
  fallbacks removed rather than fake answers).
- **Done when:** The five flagship questions stream real Bedrock answers with
  formatted markdown + correct numbers (cross-checked against reports);
  threads persist and switch; suggestion chips work; design review against
  prototype passes.
- **Verify:** e2e: ask "How did we do last month vs the month before?" →
  assert a `<table>`/`<strong>` renders (markdown proof) and the net-profit
  figure equals the P&L query for the same period; reload → conversation
  intact; "New conversation" → clean thread. Screenshots desktop/mobile.

### B5 — Docked panel layout (kill the overlay) + full-page mode + mobile
- **Context:** Ansar's top complaint: the panel covers the screen. Prototype:
  AI panel is a **docked 380px right column**; main content flexes to share
  the row; never overlaps. Full-page mode: chat left, pinned artifacts
  canvas right (design brief §9). Mobile: bottom-sheet drawer.
- **Do:** Restructure `AppShell` desktop layout to a flex row: sidebar +
  main + (conditional) 380px AI column with left hairline border; main
  content max-width logic must not fight the panel (content reflows).
  120–160ms width transition. Full-page `/ask-ai`: thread list rail +
  conversation + artifacts side. Mobile (<lg): full-height sheet over a
  scrim, body scroll locked, safe-area padded; bottom tab "Ask AI" opens it.
  Remove the old translate-x drawer and the `xl:pr-[380px]` hack.
- **Done when:** With the panel open at 1440px and 1280px, every dashboard
  tile/button remains clickable with **real** clicks; nothing overlaps;
  full-page and mobile modes match the brief.
- **Verify:** e2e: open panel → real-click a dashboard drill-through →
  succeeds; bounding-box assertion: panel ∩ main-content interactive
  elements = ∅; 390px: drawer opens/closes, no horizontal scroll.
  Screenshots of all three modes.

### B6 — Post-import AI categorization (agent-grade pipeline stages 4–6)
- **Context:** Batch categorizer exists (`convex/ai.ts`,
  `bedrockCategorizer.ts`) but only runs when manually triggered from
  Settings; imports never invoke it; memory/embedding stages run but the
  LLM stage is detached from the flow. Spec: pipeline = match → rules →
  memory → Plaid prior → LLM → route by confidence (02-product-spec §4).
- **Do:** After every import batch (Plaid sync, Stripe sync, CSV import)
  schedule the categorization worker over that batch's `needs_review` rows:
  batched Bedrock structured-output calls (~20 txns/call) with candidate
  categories + top-similar history; write `aiMeta { confidence, reasoning,
  decidedBy }`; route via the single thresholds constant (auto-post through
  the pipeline's existing posting path vs Inbox card with pre-selected
  suggestion + reasoning). Corrections write embedding memory (exists) and
  after 3 identical corrections draft a rule (exists — surface it in
  Settings → Rules "AI-suggested"). Degraded mode: skip cleanly, items stay
  in Inbox, Settings shows "AI off". Run history visible in Settings → AI.
- **Done when:** Importing the CSV fixture on a fresh entity ends with
  high-confidence rows posted (attributed `decidedBy: ai`) and low-confidence
  rows in Inbox with reasoning; no import path leaves rows untouched.
- **Verify:** units: threshold routing table (suggest/balanced/autopilot ×
  confidence); integration on dev deployment with real Bedrock: import 30
  fixture rows → assert split posted/inbox and audit attribution. Honest
  accuracy measured in H3.

---

# EPIC C — Income, Expenses, Bills (the money screens)

**Why:** Ansar wants the prototype's mental model: **Income** = money in
(payments received, invoices out, receivables), **Expenses** = where money
goes (categories, vendors, recurring), **Bills** = money you owe (kept, he
likes it; needs the missing settlement flow). References: `Income.dc.html`,
`Expenses.dc.html`, `Bills.dc.html`, spec §6.2–6.5. Current code:
`apps/web/src/components/openbooks/ModuleScreens.tsx`,
`convex/moduleViews.ts`.

### C1 — Income screen: Payments / Invoices / Receivables
- **Context (prototype):** Header "Income — Money in: payments received,
  invoices out, and what's still owed". KPI row: Received this month ·
  Still open · Overdue · Avg days to pay. Tabs: **Payments** (table: date,
  from (logo), memo, status, amount; footnote explaining payout splitting),
  **Invoices** (table: #, customer, issued, due, status, amount, balance),
  **Receivables** (aging matrix by customer with heat shading). "New
  invoice" primary action.
- **Do:** New `IncomeScreen` at `/income` backed by a new/extended Convex
  read model: payments = income-direction transactions + reconciled payouts
  for the period; invoices from the invoices table; receivables matrix from
  AR aging by contact (reportViews has the aging math — reuse, don't
  duplicate). KPIs computed server-side. Preserve the existing invoice list
  capabilities Ansar likes. Avg-days-to-pay from paid invoices' issue→paid
  delta.
- **Done when:** All three tabs render seeded data correctly; KPIs match
  reports for the same period; matrix heat-shades like the prototype.
- **Verify:** unit: read model totals = report pack totals for the month;
  e2e: tab through all three with real clicks, drill a customer row →
  contact profile. Screenshots per tab vs prototype.

### C2 — Invoice composer that actually saves (+ Stripe send + detail)
- **Context:** Composer UI exists but **draft save has no mutation** (M6
  notes; nothing in `convex/` writes a manual invoice). Prototype composer:
  customer picker ("Synced with your Stripe customer list", "+ New
  customer…"), line items (+ Add line), terms (Net 30/15/7/Due on receipt),
  due date, memo, Subtotal/Total due, "Save draft" / "Send via Stripe";
  detail drawer: status, hosted payment link (copy), timeline (Created →
  Sent → Viewed → Paid), overdue note + "Send reminder", Download PDF.
- **Do:** Mutations: `invoices.saveDraft` (create/update draft with line
  items; **no ledger posting for drafts**), `invoices.finalize` →
  accrual entry through `postEntry` (debit AR / credit income) when
  issued/sent; wire the existing Stripe send action into the composer
  (hosted URL stored, timeline events recorded); void flow reverses
  correctly. Detail drawer per prototype (timeline from recorded events;
  PDF can be a printable view in this pass). New-customer inline create
  lands in Contacts.
- **Done when:** Draft → edit → send-via-Stripe (test mode) → status/URL
  visible; or draft → finalize manually → AR aging includes it; void
  reverses.
- **Verify:** units: draft posts nothing; finalize posts balanced AR entry;
  void reverses. e2e: compose → save draft → reopen → send → assert hosted
  URL chip + timeline. Screenshot composer + drawer.

### C3 — Receivables follow-through: aging matrix actions
- **Do:** Matrix rows click through to the customer profile (exists) and to
  filtered invoice lists per bucket; "Send reminder" on overdue invoices
  (Stripe reminder for Stripe invoices; mailto/copy text fallback for
  manual ones); overdue chips ("3 invoices · oldest 14 days") accurate.
- **Done when:** Every cell/row in the matrix is interactive and correct.
- **Verify:** e2e: click a heat cell → filtered list matches the bucket
  count; unit for bucket math edge dates (0/30/31/60/61/90 boundaries).

### C4 — Expenses screen: categories, vendors, recurring
- **Context (prototype):** Header "Expenses — Where money goes, by category
  and vendor". KPIs: Spent (period, delta) · Recurring spend $X/mo ("82% of
  your spend is predictable") · Biggest movement. Tables: by category
  (name, txns, share, vs last, amount; "new" badge) and by vendor (name,
  note, amount). **Recurring** section: detected from last 6 months —
  vendor, category, cadence, next expected date, amount. "Add category"
  modal: name + group (Expenses/Income/Other), honest footnote ("creates
  account 6xxx under Expenses — visible in accountant mode").
- **Do:** New `ExpensesScreen` at `/expenses`: server read model over journal
  lines (expense accounts) grouped by category and by contact/vendor with
  MoM deltas and share-of-total; recurring detection = same merchant,
  similar amount (±10%), regular cadence (28–35d monthly / 6–8d weekly) over
  6 months → vendor, cadence, next-date projection; Add-category modal
  creates a real ledger account via the existing account mutation.
- **Done when:** Category totals reconcile to the P&L expense section for
  the same period (test-asserted); recurring list catches the seeded
  subscriptions (seed includes recurring vendors); new category usable
  immediately in recategorization.
- **Verify:** unit: category totals == reportPack P&L expenses; recurring
  detector fixture test (catches monthly Figma/AWS-style vendors, ignores
  one-offs). e2e: add category → recategorize a transaction to it →
  appears in Expenses + P&L. Screenshots.

### C5 — Bills: mark-paid settlement + PDF intake
- **Context:** Ansar likes the due-window grouping — keep it. But
  acceptance row 7's core action ("mark a seeded bill paid → it matches a
  bank transaction") has **no backend**: no settlement mutation exists.
  Prototype/spec: bill entry posts on creation (debit expense / credit AP);
  payment settles (debit AP / credit bank), matched to a bank transaction
  or scheduled as an expected match. "Add bill" offers Upload PDF →
  AI-extract → confirm, or manual form.
- **Do:** `bills.markPaid` mutation: pick from suggested bank-transaction
  matches (amount±tolerance, date window, vendor similarity — reuse pipeline
  matching) or schedule an expected match (pipeline stage 2 then settles it
  on arrival); posts settlement through `postEntry`; bill status → paid;
  partial payments out of scope (note in UI). Upload-PDF path: route the
  upload through the receipts/Bedrock extraction (G4 adds PDF; image
  uploads work now) into a prefilled bill form with confidence underlines.
  Mark-paid from the row action per prototype.
- **Done when:** Seeded open bill → mark paid → matched bank transaction
  consumed (not double-counted), AP aging drops, audit trail shows
  settlement linked to the bill.
- **Verify:** units: settlement entry balanced; AP cleared; double-settle
  rejected. e2e: full mark-paid flow with real clicks → AP KPI decreases.
  Screenshot of match picker.

---

# EPIC D — Reports & Payroll runs (the "broken" surfaces)

**Why:** Ansar: "the report section is completely broken… I'm not able to
click on a run and see the report of that specific run." Diagnosis: Reports
is one stacked mega-page with year-spanning default ranges that include
**future months** (the exported Monthly Review was December 2026); the
prototype specifies a reports **home** (card grid) → **viewer** (shared
toolbar template). Payroll runs have no detail view. References:
`Reports.dc.html`, `Payroll.dc.html` (runs list ~lines 66–87 with
`run.open`, run detail ~lines 91–160), design brief §7–8. Current code:
`ReportsScreen.tsx`, `ModuleScreens.tsx` (PayrollScreen),
`convex/reportViews.ts`.

### D1 — Reports home + sane periods
- **Do:** Rebuild `/reports` as the prototype home: card grid grouped
  Overview (Monthly Review) / Statements (P&L · Balance Sheet · Cash Flow) /
  Money owed (AR · AP Aging) / Insights (Expenses · Income by Customer ·
  Payroll Summary) / Accountant (General Ledger · Trial Balance · Journal
  Entries); each card: name, plain-English one-liner, tiny preview viz.
  Clicking opens the viewer (D2) for that report. **Fix period defaults
  globally:** default = current month (Monthly Review) / month-to-date or
  trailing-12 as appropriate per report; ranges never extend past today;
  presets (This month / Last month / This quarter / YTD / Last 12 months /
  Custom) computed against the real current date.
- **Done when:** Home matches the prototype; no report ever defaults to a
  future period.
- **Verify:** e2e: open each of the 11 cards → viewer renders data for a
  sane default period (assert period label ≤ current month); unit for
  preset date math. Screenshot home + two viewers.

### D2 — Report viewer: drill-down, compare, cash⇄accrual, exports that match
- **Do:** Shared viewer template per design brief §8: toolbar (range presets
  + custom, compare none/prior period/prior year, columns total/by month/by
  quarter, Cash ⇄ Accrual toggle with plain-English popover, Export CSV,
  "Explain" → opens Ask AI with context). P&L: sectioned rows, expandable
  groups, every number click → drill-down slide-over listing the underlying
  transactions/journal lines (wire the existing drill data; make every
  rendered number a real button). Balance Sheet: as-of picker + "✓ Balanced"
  chip. Cash Flow: operating/investing/financing + opening→closing bridge.
  AR/AP aging: matrix + heat. **Consistency:** CSV export values must equal
  on-screen values; dashboard tiles must equal the report for the same
  period.
- **Done when:** All 11 reports render in the viewer with working toolbar;
  cash vs accrual visibly changes AR/AP-dependent numbers; drill-down opens
  from any number.
- **Verify:** e2e: P&L → toggle accrual→cash → assert specific seeded
  number changes; click an expense row number → drawer lists transactions
  summing to it; export CSV → parse → totals equal screen (automated
  assertion). Unit: compare-column math. Screenshots.

### D3 — Monthly Review as the hero one-pager
- **Do:** Per design brief: month picker (← May 2026 →); net-result band
  ("You made $X, spent $Y → +$Z"); five sections — Money in (+top
  customers), Owed to you (open invoices + aging mini-bar), You owe (bills,
  next due), Money out (categories ranked w/ MoM deltas), Payroll
  (per-currency + base) — each footer-linking to its full report; printable
  (print stylesheet) + Export.
- **Done when:** Reads as one page for any seeded month; numbers reconcile
  with P&L/AR/AP/Payroll reports (asserted).
- **Verify:** e2e: pick May 2026 → assert the four section totals equal the
  corresponding report queries; print preview screenshot.

### D4 — Payroll runs: detail, approve, mark paid, statement
- **Context:** Runs list renders but rows don't open (Ansar's complaint).
  Prototype run detail: editable grid (employee · base salary ·
  adjustments ± · final amount (local) · FX rate (editable, prefilled) ·
  base-currency equivalent · paid checkbox linking to matched bank
  transaction); footer totals by currency + grand total; actions Approve →
  Mark all paid; confirmation copy ("This records ₨2.1M + ₹900k + $6k as
  April payroll expense."). Statement view: printable monthly statement by
  employee/currency + 12-month trend.
- **Do:** Schema: payroll run lines need persisted adjustments/FX/paid-state
  (extend `payrollRuns.lines`). Mutations: `payroll.updateRunLine` (draft
  only), `payroll.approveRun` (posts expense/payable through `postEntry`
  per spec §6.6), `payroll.markLinePaid`/`markRunPaid` (settlement debit
  payable / credit bank; FX difference line auto-posted), all
  audit-attributed. UI: run row click → run detail page/sheet per
  prototype; statement view per run + per month with CSV/print.
- **Done when:** Click a seeded run → detail grid; edit an adjustment on a
  draft; approve posts; mark paid settles against a seeded bank
  transaction; statement prints with correct per-currency totals.
- **Verify:** units: approve/settle entries balanced incl. FX-difference
  case; locked-period rejection. e2e: full run lifecycle with real clicks +
  screenshots; CSV totals assertion.

### D5 — Dashboard drill-throughs + period integrity
- **Context:** Acceptance row 4 ("click any number → drills through")
  was never verified; several tiles are static.
- **Do:** Every dashboard number/tile navigates: cash → Transactions
  (account-filtered); P&L snapshot → P&L viewer (same period); AR/AP →
  Income receivables / Bills; expense donut slice → Expenses category;
  income-by-customer bar → contact profile; payroll → Payroll; inbox →
  Inbox; activity rows → their target. Period selector drives every widget
  (assert no widget ignores it).
- **Done when:** No dead numbers on the dashboard.
- **Verify:** e2e: for each of 8 widgets, real-click → assert destination +
  carried filter/period; tile value == destination total for two cases.
  Screenshot annotated.

---

# EPIC E — Settings rebuilt to the prototype's 10 sections

**Why:** Ansar: "the design of the settings is completely inconsistent with
what I wanted." Prototype (`Settings.dc.html`): two-level layout with left
subnav — **Businesses · Tax & Fiscal Year · Connections · AI · Categories ·
Rules · Notifications · Team · Data · Audit log** — content right. Current:
one mega-scroll page stacking panels under a hardcoded Acme header
(`AppScreen.tsx:28-35`). Spec §6.10, design brief §10.

### E1 — Settings shell: left subnav + routing
- **Do:** `/settings/[section]` with the 10 sections (subnav styling per
  prototype: 8px-radius buttons, active state); default `/settings` →
  Businesses; mobile: section list → drill-in. Migrate existing panels into
  their sections (Data: demo reset + export; Audit log: existing table;
  Leads stays under Data or its own row consistent with prototype). Remove
  the hardcoded entity eyebrow — header reflects the active section.
- **Verify:** e2e: navigate all 10 sections via real clicks; deep-link a
  section URL; screenshots vs prototype.

### E2 — Businesses + Tax & Fiscal Year (real entity management)
- **Do:** Businesses: entity cards (name, type, base currency, counts) +
  **Add a business** (modal: name, type services/software/ecommerce/agency,
  base currency → creates entity + seeds typed CoA via the existing
  `ensureLiveSandboxEntity`-style path generalized into
  `entities.create`) + archive (schema: `archived` flag; archived entities
  hidden from switcher, books preserved). Tax & Fiscal Year: per-entity
  fiscal-year start month + accounting-basis default (drives report
  default), tax-identity text fields per prototype.
- **Verify:** units: create seeds full CoA; archive hides but preserves.
  e2e: add "Test LLC" → appears in switcher → archive → gone from switcher,
  audit logged.

### E3 — Connections section (Plaid · Stripe · Import)
- **Do:** Move/restyle the existing Bank + Stripe panels into Connections
  per prototype: per-connection cards (institution, accounts with
  include-toggles, status, last sync, Reconnect/Remove), "+ Add" flows as
  modal steppers, key-state from env (names only, never values), Import =
  CSV wizard entry (existing importer; add the column-mapper stepper shell
  from design brief §3b if absent). Works against G1/G2 backend.
- **Verify:** e2e: panels render states correctly in fixture and real
  sandbox modes; account include-toggle persists; screenshots.

### E4 — AI + Categories sections
- **Do:** AI: provider select (Bedrock default; show registry options),
  model pickers (chat / categorization / embeddings), masked key state +
  "Test connection" (cheap invoke), **autonomy radio cards** (Suggest /
  Balanced recommended / Autopilot with one-line consequences — bound to
  the single constant), batch-run history + queue state (from B6), monthly
  AI-spend estimate (token counts × price table, clearly labeled estimate).
  Categories: friendly tree grouped Income/Expenses/Other (rename, add,
  archive) + "Accountant mode" toggle revealing types/numbers/system
  accounts (existing CoA editor relocated/upgraded).
- **Verify:** unit: autonomy setting changes routing threshold used by B6;
  e2e: switch autonomy → import fixture → routing behavior changes;
  category rename reflects in chips. Screenshots.

### E5 — Rules · Notifications · Team · Data · Audit log
- **Do:** Rules: ordered list w/ drag to reprioritize, plain-English
  summary, hit count, last fired, on/off, AI-suggested pending approval
  (from B6), editor modal with condition builder (AND/OR groups) + "test
  against last 90 days" preview (server query returns would-match
  transactions). Notifications: per-prototype toggles persisted
  (workspaceSettings) — honest "email delivery wired to Plunk when
  configured" state. Team: members list + roles (Owner/Staff/Accountant
  per spec §6.10 capability copy), **invite by email** end-to-end (F3
  backend). Data: exports (existing) + import + danger zone (reset demo).
  Audit log: keep, add filters (actor kind, action, date).
- **Verify:** units: rule reorder affects first-match-wins; 90-day preview
  correctness on fixtures. e2e: create rule from editor → fires on matching
  import; drag-reorder persists; audit filter narrows rows. Screenshots.

---

# EPIC F — Identity: onboarding, workspace, profile, dev mode

**Why:** North-star step 1 ("create a workspace, name your business") has no
UI; profile/logout don't exist (A2 adds the menu; F2 adds the page); invites
have a table but no flow. Spec §9 (onboarding), design brief §11.

### F1 — Workspace creation + first-run onboarding stepper
- **Do:** Replace the hardcoded `ansar-workspace` flow
  (`convex/auth.ts:109-184`) with: first sign-in without a workspace →
  full-screen stepper: (1) Name your business + type cards + base currency
  → `workspaces.create` + `entities.create` (E2) seeds CoA; (2) Connect AI
  (skippable, honest degraded copy); (3) Connect bank — Plaid sandbox
  explainer or "import a CSV instead" (skippable); (4) Connect Stripe
  (skippable); (5) finish → Dashboard with onboarding checklist card
  (bank ✓ AI ✓ Stripe ✓ first inbox zero ✓ first report viewed ✓ —
  persisted). Existing owner keeps current workspace untouched (migration
  guard).
- **Verify:** e2e: brand-new dev user → full stepper (skipping connections)
  → lands on Dashboard with checklist; entity exists with typed CoA; unit:
  workspace bootstrap idempotency.

### F2 — Profile page + user profile data
- **Do:** `userProfiles` table (displayName, initials/avatar color,
  timezone, createdAt) keyed to auth user; `/profile` page: name, email,
  avatar initials, change password (Convex Auth flow), workspace
  memberships + roles; sidebar footer (A2) links here and shows the same
  data live.
- **Verify:** e2e: edit display name → sidebar footer updates without
  reload; password change → re-login works. Unit: profile authz (only self).

### F3 — Team invites end-to-end
- **Do:** `invites.create` mutation (email + role; owner/admin only) →
  Plunk email when configured (else copy-link state, honest); `/invite/[token]`
  accept page → account creation honoring the invite-only gate (`convex/auth.ts`
  already allows pending invites) → workspace membership with role; revoke;
  Team section (E5) lists pending/active. Roles enforced: Staff (no
  settings; transactions/payroll/bills), Accountant (read-all + journal
  entries) — add the missing role checks where queries currently assume
  member+.
- **Verify:** units: role matrix on representative queries/mutations
  (settings mutation rejects staff; accountant can read GL, cannot post
  bills). e2e: invite → accept (second browser context) → staff sees
  no Settings nav.

### F4 — Dev mode: one-command boot + safe bypass (finish the WIP)
- **Context:** The uncommitted dev-auth-bypass (committed at handoff) is
  gated on `OPENBOOKS_DEV_AUTH_BYPASS=1` + localhost. Make it the blessed
  local workflow.
- **Do:** `pnpm dev:full` script: starts Convex dev + Next dev, ensures
  owner bootstrap + demo seed (idempotent), prints the sign-in URL; sign-in
  page shows a "Continue as owner (dev)" button only in dev-bypass mode;
  document in README quickstart + `how-openbooks-works.md`. Add a guard
  test asserting bypass is inert when the flag is absent or host is
  non-local (extend the existing tests). Never set the flag in any deployed
  env (assert in preflight script).
- **Verify:** fresh-clone simulation: `pnpm install && pnpm dev:full` →
  signed-in dashboard in one command; unit guard tests; preflight rejects
  the flag for prod.

### F5 — Sign-in + request-access polish
- **Do:** Align `/sign-in` with the prototype/landing design language
  (current page drifted); request-access → Settings leads loop verified;
  error states (wrong password, not-invited → request access path) with
  plain-English copy.
- **Verify:** e2e existing auth specs extended for error states;
  screenshots desktop/mobile.

---

# EPIC G — Money rails: Plaid for real, Stripe events, receipts, entity plumbing

**Why:** Plaid never ran for real (INVALID_CREDENTIALS → fixture mode all
night); Stripe webhooks record and do nothing; nothing is scheduled; receipts
lack PDF; Live Sandbox data is invisible outside Settings. References: spec
§3, §5; `convex/plaid.ts`, `convex/stripe.ts`, `convex/stripeWebhook.ts`,
`convex/http.ts`, `convex/receipts.ts`; Plaid guidance below.

> **Plaid access (from Plaid BD, 2026-06):** sign into / create the account
> at dashboard.plaid.com **with the same email used to contact Plaid**, get
> **sandbox API keys** (free; up to 100 dummy accounts; test users like
> `user_good`/`pass_good` and `user_transactions_dynamic`). Production
> access is pay-as-you-go via "Get Production Access" — **not needed for
> this goal; sandbox only**. Useful: Plaid Quickstart, API docs, Postman
> collection. The keys currently in `.env.local` are invalid — Ansar
> replaces them with fresh sandbox keys (runbook:
> `docs/initiation/access-and-questions.md` §3); everything must still
> degrade to fixture mode gracefully when absent.

### G1 — Real Plaid Link: token exchange, item storage, account selection
- **Do:** Mount real Plaid Link in the browser (`react-plaid-link`):
  Convex action creates `link_token`; Link completes → **public_token
  exchange action in Convex** (missing today) → access token persisted
  server-side on `plaidItems` (pattern exists) → account-selection step
  (all accounts, checkboxes, balances — prototype modal) → selected
  accounts create ledger-linked bank accounts (existing idempotent path).
  Relink via Link update mode from the `ITEM_LOGIN_REQUIRED` inbox card.
  Sandbox-bypass path retained for automated tests; fixture mode retained
  for missing keys.
- **Verify:** with valid sandbox keys: e2e (Link in sandbox mode is
  automatable) or scripted action-level integration: exchange → item stored
  (no token in any public response — assert), accounts created; unit:
  exchange idempotency, error mapping.

### G2 — Scheduled + webhook-driven Plaid sync (and the system actor)
- **Do:** `convex/crons.ts`: per-item `/transactions/sync` every 4h +
  "Sync now" per connection (E3). Plaid webhook HTTP route
  (`SYNC_UPDATES_AVAILABLE` → schedule that item's sync; verify per Plaid
  webhook verification). Resolve the known design gap: scheduled posting
  needs a **system actor** — introduce an auditable `actor: "system:sync"`
  identity allowed only in internal mutations triggered by
  crons/webhooks, never from client calls; audit events must distinguish
  it. Pending→posted carryover + removed-handling already exist — wire
  them into the scheduled path with per-item cursor locking.
- **Verify:** unit: cron handler routes through pipeline; system-actor
  postings audited and rejected from public mutations. Integration: trigger
  webhook with a sandbox `fire_webhook` → item syncs without user session.

### G3 — Stripe: event-driven sync + payout line persistence
- **Do:** Connect verified webhook events to work: on
  `invoice.*`/`charge.*`/`payout.*` schedule an idempotent targeted sync
  (existing Stripe actions; event id dedupe table) so books update without
  manual sync; payout drill-down: persist payout balance-transaction lines
  in a child table (`stripePayoutLines`) instead of fixture arrays —
  populate from `balance_transactions?payout=` on reconciliation;
  drill-down UI reads it (Income → Payments payout rows + payout detail).
  Keep 4h cron as fallback (G2 file).
- **Verify:** unit: same event twice → one sync, no duplicate postings;
  integration: Stripe CLI/test event → invoice status updates; payout
  detail shows persisted lines with gross−fees = net assertion.

### G4 — Receipts: PDF + persisted vectors + inbox card completeness
- **Do:** PDF support: render first page to image (action-side) → existing
  Bedrock vision path; persist candidate transaction embeddings
  (currently recomputed per match) keyed for reuse; receipt inbox card per
  design brief (thumbnail + extracted fields left, candidate right,
  confidence; Confirm / Pick other / Create expense → manual-expense or
  bill creation per spec §5.2); email-in stays out of scope (note it).
- **Verify:** unit: match scoring fixture; e2e: upload sample PDF + image →
  extracted fields render → confirm match → transaction shows receipt chip;
  create-expense path posts balanced entry.

### G5 — Entity-scoped everything (Live Sandbox is a real citizen)
- **Context:** Live Sandbox data is only visible in Settings panels; the
  register and reports hardcode the demo entity (M9 noted gap).
- **Do:** All core read models (`coreViews`, `moduleViews`, `reportViews`,
  income/expenses models) take the active entity from A5's context; empty
  states designed for a fresh entity ("Connect a bank or import CSV");
  pagination/take() guards on big collects flagged in the audit
  (`coreViews.dashboard` collects, report 5000 cap → paginate or chunk).
- **Verify:** e2e: switch to Live Sandbox → register shows its (Plaid)
  rows, reports compute on it, dashboard empty-states correctly on a
  fresh entity; perf: dashboard query under read limits with the 922-row
  demo (log document counts in test).

---

# EPIC H — Verification, honest eval, closeout

**Why:** Make the gap between "tests green" and "product right" structurally
impossible to reopen.

### H1 — E2E suite rewrite to product-grade assertions
- **Do:** Sweep `tests/e2e/`: remove every `dispatchEvent` and `force:true`
  (fix the underlying overlaps instead); add shared helpers:
  `expectNoHorizontalScroll(page, width)`, `expectClickable(locator)`
  (bounding-box overlap), `expectMoneyEqual(a, b)`; rewrite the acceptance
  specs to mirror `docs/initiation/acceptance.md` rows 1–18 **as written**
  (period changes change numbers; drill-throughs land filtered; batch
  confirm + J/K/E/Enter; CSV equals screen; mobile four-surface usability).
  Keep runtime < 15 min by scoping projects.
- **Verify:** the suite itself: intentionally re-introduce the old overlay
  bug locally → suite fails (regression-proof demonstrated in PR notes);
  then green on the fixed app, local + dev deployment.

### H2 — Acceptance evidence pack
- **Do:** One Playwright pass that walks all 18 acceptance rows capturing
  desktop (1440) + mobile (390) screenshots into
  `docs/finishing/evidence/`, named by row; index table generated into the
  completion report.
- **Verify:** all rows have evidence files; spot-visual review against
  prototype files for shell, income, expenses, settings, reports, chat.

### H3 — Honest categorization eval
- **Context:** The previous "120/120 = 100%" compared the seed with itself.
- **Do:** Build a true eval: hold out the 120 labeled seed rows — strip
  their categories, run the full pipeline (rules + memory + Plaid prior +
  live Bedrock) against them, compare predictions to the held-out labels;
  report accuracy overall + by stage + by confidence band in Settings → AI
  and in the completion report. ≥80% is the target; below target is a
  finding, not a blocker — report it honestly.
- **Verify:** the eval harness has a unit test proving predictions can't
  see labels; run twice → deterministic input set, recorded outputs;
  result JSON committed as evidence.

### H4 — Performance & limits pass
- **Do:** Audit flagged: `coreViews.dashboard` collects ~10 tables per
  call; `reportViews` hard 5000-row cap; activity feeds. Add take()/
  pagination/indexed narrowing so the 922-txn demo entity stays well under
  Convex read limits; document per-query row counts; no UI regression.
- **Verify:** instrumented test logs document-read counts before/after;
  e2e unchanged-green.

### H5 — Completion report v2 + docs refresh
- **Do:** `docs/finishing/completion-report.md` with the honesty contract,
  tightened: a row may be WORKING **only** if a linked e2e test + screenshot
  verify the acceptance behavior as written; anything else is PARTIAL with
  named gaps + next step. No summary row may claim more than its own log
  entry. Refresh `how-openbooks-works.md` against shipped reality; README
  quickstart (`pnpm dev:full`); update `AGENTS.md` branch objective.
- **Verify:** cross-check: every WORKING row's evidence exists and the
  linked test is in the green suite; a final read-through pass listing any
  claim without evidence (must be zero).

---

## References (research the next run can rely on)

**Convex Agent** (`@convex-dev/agent` 0.6.x — docs.convex.dev/agents):
install `pnpm add @convex-dev/agent convex-helpers`; register in
`convex/convex.config.ts` via `app.use(agent)`; threads + messages persist
in component tables; `createThread` / `agent.continueThread` /
`agent.streamText(ctx, {threadId}, {promptMessageId}, {saveStreamDeltas:
{chunking:"word", throttleMs:250}})`; React: `useUIMessages(...,
{stream:true})` + `useSmoothText` + `optimisticallySendMessage` from
`@convex-dev/agent/react` (don't use legacy `useThreadMessages`); tools via
`createTool` receive `ToolCtx` (auth + runQuery/runMutation) — re-check
workspace authz in every handler; thread authorization is app-owned
(ownership table + `authorizeThreadAccess`); workflows compose via
`@convex-dev/workflow` with `agent.asTextAction()` and `promptMessageId`
idempotent retries. Native tool-approval (`needsApproval`,
`approveToolCall`/`denyToolCall`) is new in 0.6.0 and thinly documented —
the B3 proposals-table pattern is the primary mechanism; adopt native
approvals only after verifying against github.com/get-convex/agent examples.
Requires AI SDK v6 (repo already has `ai@^6`, peer `^6.0.35`).

**AI Elements** (elements.ai-sdk.dev): shadcn-style registry — components
are vendored source you own, presentational, no hard dependency on
`useChat`; install inside `apps/web`: `pnpm dlx ai-elements@latest add
conversation message prompt-input tool confirmation suggestion loader`;
markdown rendering uses Streamdown — **must add** `@source
"../node_modules/streamdown/dist/*.js";` to `apps/web/src/app/globals.css`
(Tailwind v4 purge; adjust relative path for the pnpm store if classes
vanish); message parts map: text → Response (markdown), `tool-<name>` →
Tool (states input-streaming → input-available → output-available |
output-error), approval parts → Confirmation. Requires React 19 + Tailwind
v4 (both present). Restyle to OpenBooks tokens after vendoring.

**Bedrock via AI SDK v6:** `@ai-sdk/amazon-bedrock@^4` (present) is
fetch-based (no AWS SDK client needed; works in Convex node actions);
construction pattern already in `convex/aiSdkRuntime.ts`; use `us.`
inference-profile model ids; env per Convex deployment via
`npx convex env set`.

**Plaid:** see the boxed note in Epic G. Sandbox only. Custom sandbox user
`user_transactions_dynamic` for ongoing transaction updates;
`/sandbox/public_token/create` bypass stays for CI; webhook test via
sandbox `fire_webhook`.

**Prototype files (design source of truth):** `OpenBooks.dc.html` (shell,
both sidebar states, docked AI panel with the answer-card pattern),
`Income.dc.html`, `Expenses.dc.html`, `Bills.dc.html`, `Contacts.dc.html`,
`Payroll.dc.html`, `Reports.dc.html`, `Settings.dc.html`,
`Dashboard.dc.html`, `Inbox.dc.html`, `Transactions.dc.html`,
`OpenBooks Mobile.dc.html`, plus `OpenBooks Design System/ui_kits/openbooks/`
JSX reference screens and `templates/app-screen/`.

**Known booby traps from the last run:** Next 16 / Turbopack monorepo needs
`turbopack.root` + `outputFileTracingRoot` (already configured — don't
regress); repeated demo resets conflict with running seed jobs (use the
seed-job lock; tests wait on status); Convex document-read limits bite on
audit-feed collects (cap/paginate); React 19 async forms need the element
captured before `await`; e2e negative tests legitimately log Convex errors
(sign-up rejection, locked-period) — expected.
