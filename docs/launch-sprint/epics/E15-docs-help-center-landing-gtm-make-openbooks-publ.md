# E15 — Docs, Help Center, Landing & GTM — make OpenBooks publishable and explainable

> Part of the **OpenBooks Launch Sprint**. Master plan: [../README.md](../README.md) · Backlog: [../backlog.md](../backlog.md)

**Goal.** Produce the complete non-product publication surface for a public, open-source launch: an in-app conceptual help center for non-accountant owners, a strong honest README, a setup-instructions/security-posture page, a "why I'm building this" one-pager (with Ansar input slots), a reviewed landing page with a real no-login demo entry point, a 3-minute demo-video script, outreach messaging templates, and a GitHub publication checklist (LICENSE/CONTRIBUTING/SECURITY, secret scan, labeled backlog issues). Critically, this epic also relicenses the project to MIT and fixes the remaining launch-blocking factual defect: the root LICENSE file currently ships GNU AGPL-3.0 while the landing, README, and product docs are inconsistent about the license, so the LICENSE is relicensed to MIT and every AGPL reference is flipped to MIT (the landing's existing "MIT licensed" claims become correct and are verified); the landing also claims a Docker self-host path that does not match the real Convex-cloud + Next.js stack.

**Why it matters.** OpenBooks is being readied for a public open-source launch as Ansar's wedge: free, BYO-keys, AI-assisted double-entry bookkeeping with a portfolio/multi-LLC differentiator. The product can be perfect and still fail to land if the front door is wrong: today the root LICENSE ships GNU AGPL-3.0 while the landing page tells prospects the software is "MIT licensed" four times and the FAQ repeats it, and the README/vision docs still treat the project as AGPL — an internal inconsistency a single Hacker News commenter will catch. Ansar has chosen MIT (decisions.md Q81), so the fix is a real relicense: replace the LICENSE file with MIT and flip every AGPL reference, which makes the landing's existing "MIT licensed" claims correct. The landing also promises "one docker compose up," which the real stack (Convex cloud dev + Next.js on Vercel, BYO keys in Convex env) does not deliver, setting up every first-time self-hoster to fail and churn. Non-accountant owners (the core persona) need a plain-English explanation of "AI proposes, the ledger posts" and what double-entry means before they will trust the books, and prospects need a no-login demo to try before they clone. This epic turns the strong product into a credible, honest, shareable launch — and it deliberately does NOT overstate status: every "what works / what's beta" claim must match the confirmed audit reality (≈78–80% of real transactions currently unposted, Stripe reconciliation pending), not the demo seed.

## Current state

The repo is launch-shaped but not launch-correct, and Ansar has chosen MIT as the launch license (decisions.md Q81). LICENSE (repo root) is currently GNU AGPL-3.0 (verified: LICENSE line 1 "GNU AFFERO GENERAL PUBLIC LICENSE") and must be RELICENSED to MIT; AGENTS.md + docs/product/01-vision-and-scope.md both still treat the project as AGPL and must flip to MIT. The public-facing surfaces already anticipate MIT: apps/web/src/app/page.tsx states "MIT" in four places (hero stat line ~201 "MIT licensed", the compare table row line 76 ["Open source","MIT",...], the "why it's free" copy line 432 "Open source, MIT licensed", and the footer line 538 "MIT licensed"); apps/web/src/components/openbooks/LandingPrototypeInteractions.tsx repeats "MIT-licensed" in FAQ answers (lines 53 and 68) — these are now CORRECT and only need verifying. README.md line 62 still says "License: AGPL-3.0-only" and must change to MIT — so until the relicense lands the repo is internally inconsistent. The landing also makes stack claims that do not match reality: "self-hosted, one Docker command" / "docker compose up" (page.tsx ~429 and LandingPrototypeInteractions.tsx ~58) and "$0/month, forever" while the real deploy target is Convex cloud dev + Next.js on Vercel (README.md 51-62, docs/deployment/vercel.md), and "24 months of history" (page.tsx ~24). The landing demo CTAs ("Try the live demo", page.tsx 184/519) point to /dashboard, but there is no public no-login demo route — sign-in (apps/web/src/app/sign-in/page.tsx) only offers owner-creation, teammate invite, and a dev-only owner bypass; the public path is a RequestAccessForm. There is NO help center, guide, setup, or "why" route anywhere under apps/web/src/app/ (verified by find: no help/guide/docs/setup/learn/why directories). There is NO CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md, or .github/ at repo root. The GitHub remote is github.com/AnsarUllahAnasZ360/open-accounting (repo name "open-accounting" vs product name "OpenBooks"). Good raw material already exists to draw from: docs/finishing/how-openbooks-works.md (owner one-pager, screen-by-screen), docs/finishing/accounting-engine-blueprint.md Part 1 (two-engines explanation), Part 7 (differentiation), Part 8 (the GTM spec this epic implements), docs/product/01-vision-and-scope.md, docs/security/secrets.md, docs/deployment/vercel.md, and .env.example (the real key list). The honest status is on record: blueprint Part 0 confirms ≈78–80% of real transactions sit unposted, acct 1160 holds a +$458k phantom asset, and Stripe payout reconciliation never fires on real data — so any "what works" table must be carefully honest.

## Definition of done (epic)

- [ ] A non-accountant owner can read an in-app help center (route under apps/web/src/app) that explains, in plain English with zero debits/credits jargon on the surface: what 'AI proposes, the ledger engine posts' means, what double-entry buys them, how each screen works, BYO-keys, the portfolio/multi-LLC view, and a FAQ — reachable from a footer/help link.
- [ ] The root LICENSE file is relicensed to the standard MIT license, and every public-facing 'MIT' / 'MIT-licensed' string in apps/web/src/app/page.tsx and apps/web/src/components/openbooks/LandingPrototypeInteractions.tsx matches it (verified, not rewritten); grep -rni 'agpl' across apps/web/src, README.md, AGENTS.md, and docs/product/01-vision-and-scope.md returns zero AGPL references.
- [ ] README.md leads with the portfolio/multi-LLC differentiator, states MIT, documents the real BYO-keys model and the actual quickstart (pnpm + Convex, not a fictional docker compose), and contains an HONEST status table that does not claim Stripe reconciliation or full real-data posting as 'working' (consistent with blueprint Part 0).
- [ ] A setup-instructions page (in-app route and/or docs/) lists prerequisites, the security posture (one unified encrypted-at-rest credentials store via secretBox, keys never returned to client, correct workspace/per-business scoping, live connectors supported locally per Q16 — no sandbox/test-only claim), and the manual steps a self-hoster must do (register Plaid redirect URL, register + verify the REQUIRED Stripe webhook per Q15, paste AI key) — coordinated with E13 self-host skill.
- [ ] A 'why I'm building this' one-pager exists with clearly-marked <!-- ANSAR INPUT: ... --> slots for the inputs only Ansar can supply, and a complete draft narrative around them.
- [ ] A public no-login demo entry point exists or is specified end-to-end and coordinated with E11: the landing 'Try the demo' CTA reaches a working demo (or a clearly-scoped ticket hands E11 the exact contract), and no landing CTA promises a demo that 404s.
- [ ] A demo-video script (docs/finishing/ or docs/gtm/) covers the 3-minute arc connect→AI categorizes→approve→reports+Ask AI→portfolio, with shot list, timings, and on-screen captions, and only shows flows that actually work.
- [ ] Outreach messaging templates (Show HN/Reddit post, X/LinkedIn thread, cold DM to business owners, README social blurb) exist and are internally consistent with the corrected license and honest status.
- [ ] A GitHub publication checklist exists and is executed where possible: CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md present; a secret scan recipe is documented and run clean; the E0–E15 backlog is convertible to labeled GitHub issues (script or documented gh recipe).
- [ ] pnpm verify (typecheck, lint, build, unit) stays green after any web route additions, and npx convex dev --once is unaffected (no backend changes expected in this epic).

## Tickets (11)

### E15-T1 — Make the license MIT everywhere: relicense the LICENSE file + flip README/vision/AGENTS, verify the landing's MIT claims
`size: S` · `risk: low` · `depends on: —`

**Intent.** Ansar chose MIT as the launch license (decisions.md Q81). The root LICENSE currently ships GNU AGPL-3.0 while the landing already says MIT in four places and the FAQ twice; the README and product docs still say AGPL — an internal inconsistency that must be the first thing fixed before any public link is shared. This is a real relicense (clean because Ansar is the sole author), not a copy fix.

**Changes**

- Relicense the root LICENSE file: replace the full GNU AGPL-3.0 text with the standard MIT license (copyright line in Ansar's name, current year).
- In apps/web/src/app/page.tsx, VERIFY the compareRows 'Open source' row value 'MIT' (line ~76), the hero stat 'MIT licensed' (line ~201), the 'why it's free' bullet 'Open source, MIT licensed' (line ~432), and the footer 'MIT licensed' (line ~538) — these are now CORRECT and stay as-is; only adjust any 'copyleft' explanation in the why-free body to a plain permissive-license note (under MIT anyone may fork and even close-source).
- In apps/web/src/components/openbooks/LandingPrototypeInteractions.tsx, VERIFY the two FAQ answers that say 'MIT-licensed' (lines ~53 and ~68) — they are now correct; only adjust any 'fork it and keep it alive' phrasing so it reads accurately under a permissive license (a fork need not stay open).
- Flip README.md line 62 ('AGPL-3.0-only') to MIT, and change every AGPL reference in docs/product/01-vision-and-scope.md and AGENTS.md to MIT.
- grep -rni 'agpl' across apps/web/src, README.md, AGENTS.md, and docs/product/01-vision-and-scope.md and confirm zero AGPL references remain; document the grep result.

**Files:** `LICENSE (relicense: AGPL-3.0 → MIT)`, `apps/web/src/app/page.tsx (verify MIT claims: lines 71-79 compareRows, ~193-203 hero stats, ~414-468 why-free section, ~530-545 footer)`, `apps/web/src/components/openbooks/LandingPrototypeInteractions.tsx (verify MIT claims: faqs array lines 49-70)`, `README.md (line 62: flip AGPL-3.0-only → MIT)`, `docs/product/01-vision-and-scope.md (flip AGPL → MIT)`, `AGENTS.md (flip AGPL → MIT)`

**Definition of done**

- [ ] The root LICENSE file is the standard MIT license; grep -rni "agpl" LICENSE README.md AGENTS.md docs/product/01-vision-and-scope.md apps/web/src returns no AGPL references.
- [ ] apps/web/src/app/page.tsx and LandingPrototypeInteractions.tsx state MIT consistently with the relicensed LICENSE and README.md (verified, not rewritten).
- [ ] pnpm verify passes (typecheck/lint/build/unit green) after the edits.

**Deliverables:** Relicensed LICENSE (MIT); Verified apps/web/src/app/page.tsx; Verified apps/web/src/components/openbooks/LandingPrototypeInteractions.tsx; Flipped README.md/AGENTS.md/01-vision-and-scope.md; A short note in the PR description listing every changed file and the grep evidence

**Verify.** Run: grep -rni 'agpl' LICENSE README.md AGENTS.md docs/product/01-vision-and-scope.md apps/web/src ; confirm MIT stated consistently with the LICENSE file and no stray AGPL remains. Run pnpm verify and confirm green. Load the landing page locally and read the compare table, hero, why-free, footer, and FAQ to confirm MIT reads correctly.

### E15-T2 — Correct false/stale landing claims: Docker path, history window, demo CTAs, repo name
`size: M` · `risk: low` · `depends on: E15-T6`

**Intent.** The landing makes stack and capability claims that do not match the real product (Convex cloud + Next.js, BYO keys in Convex env), which will burn the first wave of self-hosters and reviewers.

**Changes**

- DROP the 'self-hosted, one Docker command' / 'docker compose up' copy entirely (page.tsx ~429 and the FAQ in LandingPrototypeInteractions.tsx ~58); there is no Docker path (decided: see decisions.md Q83). Replace it with an accurate self-host description matching README.md 64-105 and docs/deployment/vercel.md (Convex cloud dev + Next.js; deploy to Vercel; BYO keys in Convex env), and link the setup page from E15-T5.
- Replace the '24 months / up to 24 months of history' claim (page.tsx ~24) with the user-chosen-history framing: 'as far back as your bank allows — you choose your start date' (decided: see decisions.md Q19; Plaid requests its 730-day max at link, Stripe pulls to account inception, CSV/OFX covers older). Do not assert a fixed month count.
- Audit the '$0/month, forever' and '~$30/yr' cost claims (page.tsx ~195, ~459) and add a precise footnote that the only costs are the user's own AI/Plaid usage — keep it honest, not a marketing absolute.
- Point every demo CTA (page.tsx 184 'Try the live demo', 379 'Try the mobile demo', 519) at the shared no-login `/demo` route owned by E11 and shipping before launch (decided: see decisions.md Q82). The demo backend is in scope this sprint, so the CTAs target `/demo` directly; only if E11's `/demo` is not yet merged at edit time, route the CTA to `/sign-in` as a safe interim rather than a `/dashboard` that bounces an unauthenticated visitor.
- Reconcile the GitHub link target: the remote is github.com/AnsarUllahAnasZ360/open-accounting but the product is 'OpenBooks'. Write all GitHub links/badges against the renamed public repo `github.com/<owner>/openbooks` (decided: rename to `openbooks`, see decisions.md Q80); keep the `<!-- REPO-URL -->` find-replace anchor on the landing GitHub links (page.tsx 187, 540) as good hygiene for a one-sweep owner-prefix update. Point launch/canonical links at the custom domain `openbooks.ansarullahanas.com`, falling back to the Vercel URL only if the alias isn't live (decided: see decisions.md Q85).

**Files:** `apps/web/src/app/page.tsx (hero ~24, ~184, ~195, why-free ~429/459, footer ~519/540)`, `apps/web/src/components/openbooks/LandingPrototypeInteractions.tsx (faqs lines 49-70)`, `README.md (64-105 real setup)`, `docs/deployment/vercel.md`

**Definition of done**

- [ ] No landing copy claims a Docker/'docker compose up' install (decided: Q83 — the claim is dropped); the copy describes the real Convex+Next.js setup or links the setup page.
- [ ] Every demo/GitHub CTA on the landing resolves to a working destination (demo CTAs → `/demo` per Q82, GitHub links carry a `<!-- REPO-URL -->` find-replace anchor per Q80); no unauthenticated bounce, no 404 when clicked locally.
- [ ] History-window copy reads 'as far back as your bank allows / you choose' (decided: Q19, no fixed month count); cost claims match verifiable behavior or are softened to honest language; the change list is recorded in the PR.

**Deliverables:** Edited apps/web/src/app/page.tsx; Edited apps/web/src/components/openbooks/LandingPrototypeInteractions.tsx; A claims-audit note mapping each prior claim → corrected claim → evidence

**Verify.** Manually click every CTA on the landing in a logged-out browser session and confirm each lands somewhere real. Cross-check the install/history/cost copy against README.md and docs/deployment/vercel.md. Run pnpm verify.

### E15-T3 — Build the in-app conceptual Help Center for non-accountant owners
`size: L` · `risk: low` · `depends on: E15-T1`

**Intent.** The core persona (a non-accountant owner) needs a plain-English explanation of how the product thinks before they trust it with their money; no such surface exists in apps/web/src/app today.

**Changes**

- Add a Next.js App Router route (e.g. apps/web/src/app/help/page.tsx, optionally with /help/[topic] sub-pages) using the OpenBooks design system (white surfaces, Geist, lucide, one brand green, no gradients/emoji per AGENTS.md Design Rules).
- Author the conceptual content, sourcing and condensing from docs/finishing/how-openbooks-works.md and accounting-engine-blueprint.md Part 1: (a) 'AI proposes, the ledger engine posts' in one paragraph; (b) what double-entry buys you, with the explicit promise that you never see debits/credits unless you open accountant mode; (c) the money lifecycle (enters → cascade match/transfer/rule/memory/AI → confident posts, uncertain → Inbox); (d) autonomy levels suggest/balanced(0.90)/autopilot(0.75) in owner language; (e) a screen-by-screen 'how to use' for Dashboard, Transactions, Income, Expenses, Bills, Contacts, Payroll, Reports, Ask AI, Settings; (f) the two views of multi-LLC money (decided: see decisions.md Q6) — the single-company view where each LLC keeps its own books and money moved between your companies shows as a 'transfer between your businesses' (never income or expense), and the unified/portfolio view that rolls them up and cancels out those inter-company transfers so you see the true combined picture — explaining why each LLC stays legally separate underneath; (g) BYO-keys explained in plain English (you bring your own AI/bank/Stripe keys; they are encrypted at rest and never shown back to you); (h) a FAQ for owners (is my data private, what if the project dies, will my CPA accept it, do I need an accountant).
- Add a discoverable entry point: a 'Help' / 'Guide' link in the app shell footer or a help affordance, and from the landing footer.
- Keep copy jargon-free on the surface; where a technical term is unavoidable, define it inline (per Ansar Working Agreement).

**Files:** `apps/web/src/app/help/page.tsx (new)`, `apps/web/src/app/help/[topic]/page.tsx (new, optional)`, `apps/web/src/components/openbooks/ (new help components if needed; reuse primitives.tsx)`, `docs/finishing/how-openbooks-works.md (source)`, `docs/finishing/accounting-engine-blueprint.md Part 1 (source)`, `apps/web/src/app/page.tsx (add footer Help link)`

**Definition of done**

- [ ] A /help route renders in the running app and is reachable from at least one in-app link and the landing footer.
- [ ] The page covers all of: AI-proposes-ledger-posts, double-entry-in-plain-English, the money lifecycle, autonomy levels, every primary screen, the portfolio view, BYO-keys, and an owner FAQ.
- [ ] No raw 'debit'/'credit' jargon appears as surface copy without an inline plain-English definition; design follows AGENTS.md (no gradients/emoji/purple AI styling).
- [ ] pnpm verify passes with the new route.

**Deliverables:** New help-center route(s) and components; Screenshot(s) of the rendered help center (desktop + mobile width)

**Verify.** Run the app, navigate to /help from the footer link, read top-to-bottom and confirm all required sections are present and jargon-free. Capture desktop and mobile screenshots. Run pnpm verify and confirm green.

### E15-T4 — Rewrite README to lead with the portfolio differentiator, real quickstart, and an honest status table
`size: M` · `risk: low` · `depends on: E15-T1`

**Intent.** The README is the project's front door for developers and self-hosters; today it under-sells the multi-LLC wedge and its status framing predates the deep audit's confirmed reality.

**Changes**

- Restructure README.md to lead with the one-line positioning and the portfolio/multi-LLC 'Portfolio CFO' differentiator (blueprint Part 7) before the generic thesis.
- State the license as MIT prominently near the top (consistent with the relicensed LICENSE and E15-T1).
- Document the BYO-keys model concretely from .env.example: AI provider key (one of the supported providers), Plaid client_id/secret, Stripe restricted key + webhook secret, Plunk — and that they are encrypted at rest and associated per business.
- Replace any fictional install steps with the REAL quickstart: pnpm install, cp .env.example .env.local, fill Convex values, pnpm dev:full, /sign-in → Continue as owner (dev) — matching README 64-105 (keep it but tighten and verify it still works).
- Add an HONEST 'What works / what's beta / what's planned' status table, published only after the E1–E7 fixes land so 'working' rows are genuinely true by go-live (decided: see decisions.md Q84). Anchor the framing to blueprint Part 0 (the pre-fix reality: ≈78–80% of real txns unposted, Stripe payout matcher not firing, opening balances missing) and mark each row's go-live state: real-data posting and reconciliation (RC2/RC3/RC4) move to 'working' once E1 merges; anything still in progress at launch is labelled honestly. Tie any remaining 'beta' rows to the owning epic so the table reads as a roadmap, not a confession. Note: the GL is USD-only (decided: see decisions.md Q3 — no multi-currency status row); the only multi-currency surface is payroll convert-to-USD.
- Add screenshots (reuse apps/web/public/prototype-assets/shots/*.png) and a 'differentiators' section (portfolio, BYO-keys, real ledger, self-host, AI CFO direction).
- Link to the help center, setup page, security doc, CONTRIBUTING, and the why-page.

**Files:** `README.md`, `docs/finishing/accounting-engine-blueprint.md (Part 0 status, Part 7 differentiators)`, `docs/product/01-vision-and-scope.md (positioning, competitive table)`, `.env.example (key list)`, `apps/web/public/prototype-assets/shots/ (screenshots)`

**Definition of done**

- [ ] README.md states MIT consistently with the LICENSE file and contains no stray 'AGPL' reference.
- [ ] README leads with the portfolio/multi-LLC differentiator and contains a status table whose 'working' rows are all genuinely working per the audit (no overclaim of Stripe reconciliation or full real-data posting).
- [ ] The quickstart in README matches the actual scripts in package.json (pnpm install / dev:full / verify) and the env keys match .env.example.
- [ ] Markdown lints/renders cleanly (no broken links to the new docs).

**Deliverables:** Rewritten README.md; A short mapping of each status-table row → its owning epic/ticket

**Verify.** Render README.md (GitHub preview or a markdown viewer); confirm the differentiator lead, MIT statement (matching the LICENSE file, no stray AGPL), accurate quickstart, honest status table, and working links. Cross-check the quickstart commands against package.json scripts. Cross-check status rows against blueprint Part 0.

### E15-T5 — Author the setup-instructions + security-posture page (prerequisites and the 3 manual steps)
`size: M` · `risk: low` · `depends on: E15-T4`

**Intent.** Asking owners to paste bank/Stripe/AI keys requires an explicit trust + setup surface; self-hosters need the prerequisites and the manual steps that cannot be automated.

**Changes**

- Create a setup page as an in-app route (e.g. apps/web/src/app/setup/page.tsx) AND/OR a docs file (docs/gtm/setup-instructions.md), coordinated with the E13 self-host skill so they share one canonical step list.
- Document prerequisites: a Convex account/deployment, a Vercel account (or local run), Node/pnpm, and the optional keys (AI provider, Plaid, Stripe, Plunk — live or test both work locally per Q16) — pulled from .env.example.
- Document the security posture from docs/security/secrets.md and the audit: ALL credentials (AI, Plaid, Stripe, Plunk) stored in ONE unified encrypted-at-rest `credentials` table via secretBox AES-GCM (decided: see decisions.md Q12/Q18 — single storage shape, correctly scoped: AI/Plunk/Plaid-Item = workspace-scoped, Stripe = per-business), keys never returned to the client (only keyPreview/lastFour shown), every server read re-checks workspace/entity authz, nothing secret committed. Do NOT claim a sandbox/test-only restriction: live connectors work locally (decided: see decisions.md Q16 / decision #13 — the AGENTS.md sandbox-only rule is removed); the only retained hard requirement is encryption-at-rest plus the live-key HTTPS-redirect requirement.
- Document the 3 manual steps a user must do by hand and where the app surfaces the values they must register: (1) register the Plaid redirect URL the app shows (Settings → Connections), (2) register the Stripe webhook URL the app shows — note this is REQUIRED for any live Stripe connection (decided: see decisions.md Q15; a Stripe connection does not report 'listening' until the webhook is verified), (3) paste the AI provider key and pick provider+model from the full 14-provider catalog (decided: see decisions.md Q12). Reference the real connection sheets (AddBankSheet.tsx, StripeConnectSheet.tsx) and Settings sections so instructions match the UI.
- Link this page from README, the help center, and the landing footer.

**Files:** `apps/web/src/app/setup/page.tsx (new) or docs/gtm/setup-instructions.md (new)`, `docs/security/secrets.md (source)`, `docs/deployment/vercel.md (source)`, `.env.example (key list)`, `apps/web/src/components/openbooks/AddBankSheet.tsx (manual-step reference)`, `apps/web/src/components/openbooks/StripeConnectSheet.tsx (manual-step reference)`

**Definition of done**

- [ ] A setup page/doc exists listing all prerequisites, the full security posture, and the three manual steps with the exact place in the UI each value is registered.
- [ ] The security claims match docs/security/secrets.md and the audit (unified encrypted-at-rest credentials store, keyPreview/lastFour only, per-entity authz, live connectors supported locally — NO sandbox/test-only claim per Q16) with no overclaim.
- [ ] The page is linked from README, the help center, and the landing footer.
- [ ] Wording is consistent with the E13 self-host skill's step list (no contradictory instructions).

**Deliverables:** New setup-instructions page/doc; A cross-reference note confirming alignment with E13's self-host skill

**Verify.** Open the setup page/doc; confirm prerequisites, security posture, and the three manual steps are complete and match the UI (open Settings → Connections in the app and confirm the redirect/webhook URLs the page describes actually appear). Confirm links from README/help/landing resolve.

### E15-T6 — Wire the landing to E11's public no-login `/demo` entry point
`size: S` · `risk: low` · `depends on: E11`

**Intent.** Prospects must be able to try OpenBooks before cloning. The no-login demo backend — one shared seeded demo workspace, resolved by slug on the server, served to truly unauthenticated users, with a server-side `isDemo → read-only` guard and a daily 08:00 UTC reset+reseed cron — is **owned by E11 and ships before launch** (decided: see decisions.md Q82/Q56/Q57). E15 does NOT design or build the demo backend; it consumes E11's `/demo` route and points the public surfaces at it.

**Changes**

- Confirm the E11 demo contract is the one this epic links against (decided: see decisions.md Q56): one shared `isDemo` workspace, NO anonymous Convex Auth identity, slug-resolved server-side, read-only via a shared `requireWorkspaceRead` helper (UI hiding is not the boundary), daily reset (Q57). E15 treats this as a fixed upstream dependency, not an open design question.
- Point the landing demo CTAs (consumed by E15-T2) at `/demo`. If E11's `/demo` is not yet merged when E15-T2 lands, route the CTA to `/sign-in` as a safe interim and leave a one-line TODO to flip it to `/demo`.
- Document the no-login demo in the help center (E15-T3) and README (E15-T4): 'try it with no login, nothing you do is saved, the demo resets daily.'
- Note for self-hosters: the public demo is OFF by default behind `OPENBOOKS_PUBLIC_DEMO_ENABLED` and ON only for the hosted instance (decided: see decisions.md Q60) — so README/help must frame `/demo` as a hosted-instance feature, not a guaranteed self-host route.

**Files:** `apps/web/src/app/page.tsx (CTAs → /demo, coordinated with E15-T2)`, `apps/web/src/app/demo/page.tsx (owned by E11 — reference only)`, `convex/seedDemo.ts (E11 demo data source — reference)`, `README.md (E15-T4 — demo described)`, `apps/web/src/app/help/page.tsx (E15-T3 — demo described)`

**Definition of done**

- [ ] The landing 'Try the demo' CTAs resolve to E11's `/demo` (verified in a logged-out session); if `/demo` is not yet merged, the CTA routes to `/sign-in` as a safe interim with a TODO to flip it.
- [ ] A logged-out visitor reaching `/demo` sees seeded data and cannot mutate real data or view any secret value (E11 owns enforcement; E15 only verifies the CTA lands somewhere safe).
- [ ] The no-login demo is described in README and the help center, framed as a hosted-instance feature (OFF by default for self-hosters per Q60).

**Deliverables:** Updated landing CTAs pointing at `/demo` (or interim `/sign-in`); README/help demo copy

**Verify.** In a fresh logged-out browser, click 'Try the live demo' on the landing and confirm it reaches E11's labeled `/demo` with data and no mutation/secret exposure (or, if `/demo` is not yet merged, confirm the CTA points at the safe interim `/sign-in` with the TODO recorded). Run pnpm verify.

### E15-T7 — Draft the 'Why I'm building this' one-pager with marked Ansar-input slots
`size: S` · `risk: low` · `depends on: E15-T1`

**Intent.** The launch needs a credible founder narrative; only Ansar can supply the personal motivation and specifics, so this ticket builds the full scaffold around clearly-marked input slots.

**Changes**

- Create docs/gtm/why-openbooks.md (and optionally an in-app /about or /why route) with a complete draft narrative: the problem (QBO price + bookkeeper cost, Bench/Midday rug-pulls), the structural shift (AI does the bookkeeper's job, owner brings the key), the opinionated bets (two transaction concepts, ~30 categories, double-entry under the hood), and the multi-LLC portfolio wedge — sourced from docs/product/01-vision-and-scope.md and blueprint Part 7.
- Insert explicit, clearly-marked input slots: <!-- ANSAR INPUT: your personal story — why you started this for Zikra + Z360 -->, <!-- ANSAR INPUT: the moment QuickBooks/Bench failed you -->, <!-- ANSAR INPUT: who you want to help and one sentence to them -->, plus a slot for a personal sign-off.
- Keep the draft honest and free of overclaim (no 'fully automated books' promises); reflect the AI-proposes/human-approves reality.
- Make the input slots impossible to miss (a visible 'NEEDS ANSAR INPUT' callout block at the top listing every slot).

**Files:** `docs/gtm/why-openbooks.md (new)`, `apps/web/src/app/why/page.tsx (new, optional in-app version)`, `docs/product/01-vision-and-scope.md (source: problem/positioning)`, `docs/finishing/accounting-engine-blueprint.md Part 7 (differentiators)`

**Definition of done**

- [ ] docs/gtm/why-openbooks.md exists with a complete draft narrative AND at least four clearly-marked <!-- ANSAR INPUT: ... --> slots plus a top-of-file list of every slot needing input.
- [ ] The narrative is consistent with the corrected license/status (MIT, no overclaim) and the vision doc.
- [ ] If an in-app /why route is added, it renders in design-system style and links from the landing/help.

**Deliverables:** docs/gtm/why-openbooks.md; Optional /why route; A summary listing exactly what inputs are requested from Ansar

**Verify.** Open the file; confirm the draft reads as a coherent founder one-pager and every Ansar-input slot is marked and enumerated at the top. Confirm no MIT/overclaim. If routed in-app, load it and screenshot.

### E15-T8 — Write the 3-minute demo-video script with shot list and captions
`size: M` · `risk: low` · `depends on: E15-T6`

**Intent.** A tight demo video is the single highest-leverage launch asset; it must show only flows that actually work and end on the portfolio differentiator.

**Changes**

- Create docs/gtm/demo-video-script.md following blueprint Part 8's arc: connect (Plaid/Stripe/CSV) → AI categorizes with confidence → owner approves an Inbox item → reports + Ask AI answer a real question → end on the portfolio view across two LLCs (Zikra + Z360).
- Produce a scene-by-scene table: timestamp range, on-screen action, narration line, on-screen caption, and the exact screen/route to record — total ≤ 3:00.
- Constrain the script to demonstrably-working flows: record against the shared no-login demo workspace (seedDemo.ts, owned by E11). The Stripe in-transit clearing model is already built and wired (V2); the remaining reconciliation calibration (RC2/RC3/RC4) lands this sprint via E1, so by launch the payout-match scene records truthfully — but note as a recording prerequisite that the script must be re-verified against the live build once E1's reconciliation tickets merge before showing any payout-match scene on real data (decided: see decisions.md Q84 — publish the honest status only after the E1–E7 fixes land).
- Add an opening hook line and a closing CTA line (star on GitHub / try the demo / clone it) consistent with the corrected MIT license, the `openbooks` repo, the `openbooks.ansarullahanas.com` launch URL, and the demo entry point.
- Include a 'recording checklist' (seed fresh demo data, hide any real secrets, set window size, font scaling).

**Files:** `docs/gtm/demo-video-script.md (new)`, `docs/finishing/how-openbooks-works.md ('what to test, in order' — narration source)`, `docs/finishing/accounting-engine-blueprint.md Part 8 (arc)`, `convex/seedDemo.ts (what the demo will show)`

**Definition of done**

- [ ] docs/gtm/demo-video-script.md exists with a scene table totaling ≤3:00, each scene mapping action→narration→caption→route.
- [ ] The script only demonstrates flows that work today (demo workspace), with a noted prerequisite list for any flow pending another epic.
- [ ] The script ends on the portfolio/multi-LLC view and a CTA consistent with the corrected license and the E15-T6 demo entry point.

**Deliverables:** docs/gtm/demo-video-script.md; A recording checklist appended to the script

**Verify.** Read the script against the running app: walk each scene's route and confirm it exists and behaves as the script narrates (in the demo workspace). Confirm total runtime budget ≤3:00 and the portfolio ending. Flag any scene that depends on an unshipped epic.

### E15-T9 — Produce outreach messaging templates (Show HN, social thread, owner DM, README blurb)
`size: S` · `risk: low` · `depends on: E15-T4, E15-T6`

**Intent.** Launch day needs ready, consistent copy across channels; inconsistent claims (especially license) across posts erode credibility.

**Changes**

- Create docs/gtm/outreach-templates.md with: (1) a Show HN / open-source-launch post (title + body, honest about beta status, leading with the portfolio + BYO-keys + real-ledger wedge); (2) an X/LinkedIn thread (5–8 posts) telling the two-engines + 'I reverse-engineered QuickBooks' story from blueprint Part 8; (3) a cold DM template to small-business owners leading with their pain ('your books are a mess; 20-minute fix'); (4) a one-paragraph README/social blurb; (5) a subreddit-appropriate variant (r/smallbusiness, r/selfhosted).
- Ensure every template states MIT (consistent with the LICENSE file), the no-login demo link, the `github.com/<owner>/openbooks` URL, and the `openbooks.ansarullahanas.com` launch URL (Vercel fallback), and avoids any claim contradicted by the honest status table (E15-T4).
- Add a 'do not say' guardrail list (no 'fully automated', no 'your accountant guaranteed to accept', no security overclaim about live keys — do NOT imply pasting live bank/Stripe credentials is risk-free; it IS fine to state live connectors are supported locally with encryption-at-rest + HTTPS, per decision #13/Q16) so all copy stays defensible.
- Keep tone factual and non-hype per AGENTS.md (no emoji, no marketing ornament).

**Files:** `docs/gtm/outreach-templates.md (new)`, `docs/finishing/accounting-engine-blueprint.md Part 8 (messaging spec)`, `docs/product/01-vision-and-scope.md (competitive positioning)`, `README.md (status table for consistency)`

**Definition of done**

- [ ] docs/gtm/outreach-templates.md contains all five template types, each self-consistent and stating MIT, the demo link, and the `github.com/<owner>/openbooks` URL.
- [ ] No template contains a claim contradicted by the README honest status table or the corrected license.
- [ ] A 'do not say' guardrail list is included.

**Deliverables:** docs/gtm/outreach-templates.md

**Verify.** Diff each template's factual claims against the README status table (E15-T4) and LICENSE; confirm MIT stated consistently with the LICENSE file, no stray AGPL, no overclaim, working demo/repo links. Have one template read aloud for tone (no hype/emoji).

### E15-T10 — Add governance files and a GitHub publication + secret-scan checklist; convert the backlog to labeled issues
`size: M` · `risk: med` · `depends on: E15-T1, E15-T4`

**Intent.** A public open-source repo needs CONTRIBUTING/SECURITY/CODE_OF_CONDUCT, a clean secret-scanned history, and a triaged issue backlog; none of these exist at repo root today.

**Changes**

- Create CONTRIBUTING.md (how to set up dev env per README, the verify gate pnpm verify + npx convex dev --once, the ledger-immutability and money-as-integer-minor-units rules from AGENTS.md, PR expectations, the Co-Authored-By convention).
- Create SECURITY.md (how to report a vulnerability privately, the BYO-keys/secret-handling posture from docs/security/secrets.md — unified encrypted-at-rest credentials store, live connectors supported locally per Q16, NO sandbox/test-only claim — and supported versions).
- Create CODE_OF_CONDUCT.md (standard Contributor Covenant).
- Add a .github/ directory with issue templates (bug, feature) and a PR template encoding the verify gate and the no-secrets rule.
- Write docs/gtm/github-publication-checklist.md: LICENSE present (MIT), README/CONTRIBUTING/SECURITY/CoC present, a documented secret-scan recipe (e.g. gitleaks/trufflehog over full history + the existing scripts/ secret patterns) RUN and clean, no PII/financial data in any tracked file, and a labeled-issues plan.
- Author a script or documented gh CLI recipe (scripts/) that converts the E0–E15 backlog tickets into GitHub issues with labels (epic:E1..E15, type:bug/feature, area:ledger/ai/ui/docs, good-first-issue) — generating the labels and issue bodies from the ticket data; run it (or stage it for Ansar to run since it needs repo write auth).
- Run the secret scan and record the clean result; if any hit, document remediation (history is in scope per AGENTS.md no-secrets-committed rule).

**Files:** `CONTRIBUTING.md (new)`, `SECURITY.md (new)`, `CODE_OF_CONDUCT.md (new)`, `.github/ISSUE_TEMPLATE/ (new)`, `.github/PULL_REQUEST_TEMPLATE.md (new)`, `docs/gtm/github-publication-checklist.md (new)`, `scripts/ (new issue-seeding script)`, `docs/security/secrets.md (source)`, `AGENTS.md (rules to encode)`

**Definition of done**

- [ ] CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md, and .github/ templates exist at repo root and encode the verify gate, ledger/money invariants, and no-secrets rule.
- [ ] docs/gtm/github-publication-checklist.md exists and every item is checkable; the secret-scan recipe has been RUN and the result (clean or remediated) is recorded.
- [ ] An issue-seeding script or documented gh recipe exists that turns the E0–E15 backlog into labeled issues; it has been run or is staged with clear instructions (it requires repo-write auth Ansar controls).
- [ ] No secret, token, PII, or financial record is present in any newly added file (and the scan confirms the same for tracked history).

**Deliverables:** CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md, .github/ templates; docs/gtm/github-publication-checklist.md; Issue-seeding script under scripts/; Recorded secret-scan output

**Verify.** Confirm the four governance files render correctly. Run the documented secret-scan command over the repo and confirm clean output (paste the result). Dry-run the issue-seeding script against the ticket data and confirm it produces correctly-labeled issue bodies; confirm labels enumerated match the epics.

### E15-T11 — Full landing/GTM review pass: consistency, responsiveness, and honest-claims audit
`size: M` · `risk: low` · `depends on: E15-T1, E15-T2, E15-T3, E15-T4, E15-T5, E15-T6, E15-T7`

**Intent.** After the individual fixes land, a single reviewer must confirm the whole public surface tells one consistent, honest, responsive story before anything is shared publicly.

**Changes**

- Cross-audit every public surface (landing page.tsx, FAQ, README, help center, setup page, why-page, outreach templates, video script) for a SINGLE consistent set of claims: MIT (matching the LICENSE file), the honest status table, the demo link, the `github.com/<owner>/openbooks` repo URL, the `openbooks.ansarullahanas.com` launch URL, BYO-keys, and the portfolio differentiator.
- Run a responsiveness pass on the landing and the new help/setup/why routes at mobile, tablet, and desktop widths (AGENTS.md: mobile must be a real surface), capturing screenshots; fix any overflow/squeeze in the new routes.
- Verify every internal link across landing/README/help/setup/why/CONTRIBUTING resolves (no dead links, no 404 CTAs).
- Confirm no design-rule violations introduced (no gradients, purple AI styling, emoji, glassmorphism) in the new routes, per AGENTS.md.
- Produce a one-page launch-readiness checklist for this epic mapping each DoD item to its evidence (screenshot / grep result / rendered file).

**Files:** `apps/web/src/app/page.tsx`, `apps/web/src/components/openbooks/LandingPrototypeInteractions.tsx`, `apps/web/src/app/help/page.tsx`, `apps/web/src/app/setup/page.tsx (or docs/gtm/setup-instructions.md)`, `README.md`, `docs/gtm/why-openbooks.md`, `docs/gtm/outreach-templates.md`, `docs/gtm/demo-video-script.md`, `docs/gtm/github-publication-checklist.md`

**Definition of done**

- [ ] A written review confirms every public surface states MIT (matching the LICENSE file), the same honest status, the same demo + repo links, and the portfolio differentiator — with zero contradictions.
- [ ] Mobile/tablet/desktop screenshots of the landing and each new route show no overflow/squeeze and no design-rule violations.
- [ ] Every internal link across the public surfaces resolves; no CTA 404s in a logged-out session.
- [ ] pnpm verify is green across all web additions in the epic.

**Deliverables:** A launch-readiness checklist (this epic) mapping DoD → evidence; Responsive screenshots of landing + help + setup + why; A consistency-audit note

**Verify.** Use the agent-browser skill to load landing, /help, /setup, /why at 375px, 768px, and 1280px widths and screenshot each; click every CTA logged-out and confirm it resolves. grep all public surfaces for 'agpl' (expect none — MIT stated consistently with the LICENSE file; no stray AGPL remains). Run pnpm verify. Compile the evidence into the launch-readiness checklist.

## Decisions applied

All prior open questions are resolved by the canonical decision layer — see
[`../decisions.md`](../decisions.md) (E15 = Q80–Q87) and the per-epic deltas in
[`../plan-rebuild-changelog.md`](../plan-rebuild-changelog.md). Resolved and baked into the
tickets above:

- **License (Q81):** MIT everywhere; the root LICENSE is relicensed AGPL-3.0 → MIT and every AGPL reference flipped (README, vision/competitive table, AGENTS.md); the landing's existing MIT claims are now correct and verified. [E15-T1]
- **Self-host story (Q83):** the Docker / 'docker compose up' claim is dropped; describe the real Convex-cloud-dev + Next.js-on-Vercel BYO-keys flow. [E15-T2]
- **History window (Q19):** 'as far back as your bank allows — you choose your start date'; no fixed month count. [E15-T2]
- **Public demo (Q82/Q56/Q57/Q60):** the shared no-login `/demo` backend is owned by E11 and ships before launch; landing CTAs point at `/demo`; demo is read-only, slug-resolved, resets daily, OFF by default for self-hosters. [E15-T6]
- **Honest status table (Q84):** published after the E1–E7 fixes land so 'working' rows are true at go-live. [E15-T4]
- **Credentials/security posture (Q12/Q16):** ONE unified encrypted-at-rest credentials store; live connectors work locally (no sandbox/test-only claim). [E15-T5]
- **Intercompany two views (Q6):** help center explains single-company (transfer, never income/expense) vs unified/portfolio (intercompany eliminated). [E15-T3]
- **USD-only GL (Q3):** no multi-currency status/claims anywhere in this epic; payroll convert-to-USD is the only FX surface.
- **Issue seeding (Q87):** stage the labeled-issue script for Ansar to run (repo-write auth); do not run unattended. [E15-T10]

**Decided by Ansar (2026-06-17):**

- **Q80 — Public repo name:** DECIDED — rename to `openbooks`; all GitHub links written against `github.com/<owner>/openbooks` (the `<!-- REPO-URL -->` find-replace anchor is retained only as hygiene for a one-sweep owner-prefix update). [E15-T2/T10]
- **Q85 — Launch URL:** DECIDED — custom domain `openbooks.ansarullahanas.com`, falling back to the Vercel URL only if the alias isn't live at launch. [E15-T2/T4/T9]

**Still genuinely needs Ansar** (the one true input):

- **Q86 — 'Why I'm building this' inputs:** personal story, the QuickBooks/Bench-failure moment, audience sign-off — drafted with clearly-marked `<!-- ANSAR INPUT: … -->` slots awaiting Ansar's words. [E15-T7]
