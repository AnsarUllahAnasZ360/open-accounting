# E13 — Self-host setup skill + deployment + security posture pages

> Part of the **OpenBooks Launch Sprint**. Master plan: [../README.md](../README.md) · Backlog: [../backlog.md](../backlog.md)

**Goal.** Make OpenBooks genuinely self-hostable by a non-expert: an AI-agent setup skill that provisions Convex + Vercel + GitHub and deploys end to end, a one-command local boot, a prerequisites/env checklist with the exact redirect/webhook URLs the owner must register, an honest security-posture page (encryption at rest, secrets never returned, server-side authz re-checks, live-key HTTPS-redirect requirement, no-PII-commit), and an in-product/landing setup-instructions surface. Minimize the manual steps to the irreducible 2-3 (paste Plaid/Stripe/AI keys; click the redirect/webhook registration).

> **Live connectors work locally (decided: see decisions.md Q16 / Ansar #13).** The old "Plaid sandbox / Stripe test keys only" rule is removed; this epic documents and reflects that live connectors run locally and in self-host. The retained security guarantees are encryption-at-rest and the live-key HTTPS-redirect requirement, NOT a sandbox/test ban.

**Why it matters.** OpenBooks is free and open-source; its growth path is "clone and run your own." Today a self-hoster must hand-wire Convex prod, generate JWT keys, set the encryption key, register two webhooks, point a domain, and discover all of that from scattered docs (docs/deployment/vercel.md hard-codes Ansar's own project/domain). That is a wall most owners will not climb, so the BYO-keys + privacy story — the entire reason this product exists instead of a SaaS — never gets exercised. A repeatable setup skill plus an honest, public security-posture page converts "interesting open-source repo" into "I can actually run my own books in 20 minutes and trust where my bank tokens live." It also protects Ansar: the security page is the artifact a prospect or a security-minded owner reads before pasting a Plaid secret, and the encryption-at-rest + live-key HTTPS-redirect requirements it documents are what keep bank tokens safe even with live connectors enabled (decided: see decisions.md Q16/Q72 — live connectors work locally; the trust guarantee is encryption + HTTPS, not a sandbox/test ban).

## Current state

Local boot exists and is decent: scripts/dev-full.mjs pushes Convex once, bootstraps the owner, watches Convex, starts Next on :3100, and seeds demo non-fatally; it hard-asserts cloud Convex only (assertCloudConvex) and forces the dev-auth bypass on. scripts/preflight.mjs validates Plaid / Stripe / Bedrock / Convex / `vercel whoami` and a localhost-only dev-bypass guard. NOTE (decided: see decisions.md Q16 / Ansar #13): live connectors must work locally; the `OPENBOOKS_REAL_TEST_LIVE_CONNECTORS` gate and the AGENTS.md sandbox/test-only rule are being removed by E3 — preflight here is generalized to a name-check that does NOT hard-fail on live keys (E13-T4), while keeping encryption-at-rest and the live-key HTTPS-redirect requirement. The redirect/webhook URLs already exist server-side: convex/connections.ts exposes webhookConfig (stripeWebhookUrl, plaidWebhookUrl, plaidRedirectUri, stripeRedirectUri, siteUrl) built from CONVEX_SITE_URL/SITE_URL, and ConnectionsSection.tsx:121 already reads it. Secrets are encrypted at rest via convex/secretBox.ts (AES-GCM, keyed by OPENBOOKS_SECRET_ENCRYPTION_KEY, versioned v1: ciphertext, key never returned). Authz is re-checked server-side everywhere via convex/authz.ts requireWorkspacePermission/requireAnyWorkspacePermission. Data lifecycle reset exists in convex/realTestReset.ts (startFullRebuild, gated by workspace.reset + a deployment enable flag). .env.example documents every var including OPENBOOKS_SECRET_ENCRYPTION_KEY, the real-data guard OPENBOOKS_REAL_TEST_LIVE_CONNECTORS, and Plaid/Stripe fallbacks. WHAT IS MISSING for E13: (1) no AI-agent setup SKILL.md anywhere (.claude/skills/* are all third-party symlinks; no openbooks-self-host skill); (2) no security-posture doc or page — docs/security/ has only a 27-line secrets.md, and there is no /security or /setup route in apps/web/src/app; (3) the only deployment docs (docs/deployment/vercel.md, convex-auth-plunk.md) are Ansar-specific runbooks (his Vercel scope, his perceptive-guanaco-487 Convex prod, his custom domain) — useless as generic self-host instructions and a PII/leak risk if copied verbatim; (4) no prerequisites/env checklist that maps each var to where it goes (Vercel vs Convex) and which are required vs optional; (5) preflight carries a fixed required-env list tuned for Ansar's Bedrock setup, so it will hard-fail a generic self-hoster on a different AI provider (and, per decisions.md Q16, must stop hard-failing on live Plaid/Stripe keys); (6) dev:full has no `setup`/init mode that creates .env.local, generates JWT keypair + encryption key, and runs `convex env set` for the user; (7) no one-click "Deploy" affordance (Vercel Marketplace Convex template pattern exists per research but is unused); (8) the landing page roadmap mentions self-host nowhere and there is no public setup-instructions page.

## Definition of done (epic)

- [ ] A versioned AI-agent skill `openbooks-self-host` exists with a valid SKILL.md (YAML frontmatter name+description) plus step scripts, and a dry-run of its provisioning flow (Convex project create, env set, Vercel link, deploy) is demonstrated end to end against throwaway accounts with no secret printed to logs.
- [ ] A new `scripts/setup.mjs` (wired as `pnpm setup`) bootstraps a fresh clone non-interactively-where-possible: writes .env.local from .env.example, generates a JWT keypair + JWKS + OPENBOOKS_SECRET_ENCRYPTION_KEY, runs `npx convex env set` for every server-only secret, and verifies via a `pnpm preflight` pass; re-running is idempotent and never overwrites a non-empty secret.
- [ ] A generic, owner-facing `docs/self-host/README.md` (or docs/self-host/setup.md) replaces Ansar-specific deployment runbooks with placeholder-only values; a secret-scan over the doc set finds zero real keys, account ids, or private URLs.
- [ ] A `docs/security/security-posture.md` documents, with file citations, five claims: encrypted at rest (secretBox AES-GCM), secrets never returned to client, server-side authz re-check on every function, the live-key HTTPS-redirect requirement for live connectors (`connections.ts:248`), and no-PII-commit posture (.gitignore + secret-scan); every claim is verified against current code and any stale claim is corrected. The fifth slot replaces the old "sandbox/test enforcement" claim, which is removed because live connectors work locally (decided: see decisions.md Q16/Q72).
- [ ] A public, no-login `/security` and `/setup` route renders in apps/web/src/app, matches the OpenBooks design system (no gradients/emoji/purple), surfaces the live redirect/webhook URLs from connections.webhookConfig (or a public-safe equivalent), and is linked from the landing page; both pass `pnpm typecheck && pnpm lint && pnpm build`.
- [ ] preflight.mjs is generalized so a self-hoster on any of the 14 AI providers passes the env-name check (required-env list is provider-aware, Bedrock-only keys become conditionally required) and no longer hard-fails on live Plaid/Stripe keys; it keeps encryption-at-rest and the live-key HTTPS-redirect requirement (decided: see decisions.md Q16/Q71 — live connectors work locally; aiCatalog.ts's 14 providers are canonical).
- [ ] A prerequisites + env checklist (in docs and on /setup) lists every variable, marks required vs optional, states whether it lives in Vercel or Convex, and links to where each external key is obtained; a verifier confirms the checklist is in sync with preflight's required/optional lists (a test or script cross-checks).
- [ ] `pnpm verify` (typecheck+lint+build+unit) and `npx convex dev --once` stay green after all E13 changes; no change touches convex/ledger.ts or money math.

## Tickets (9)

### E13-T1 — Author the openbooks-self-host AI-agent skill (SKILL.md + provisioning steps)
`size: M` · `risk: low` · `depends on: E13-T2, E13-T6`

**Intent.** Give an AI coding agent (Claude Code / Codex) a deterministic recipe to provision Convex + Vercel + a GitHub fork, clone, set env, run locally, and deploy — orchestrate-and-pause-for-confirmation, never fully auto-provision (decided: see decisions.md Q69 / Ansar #15) — so a self-hoster supervises rather than hand-wires.

**Placement (decided: see decisions.md Q68 / Ansar default).** Commit the skill to a tracked top-level `skills/openbooks-self-host/` directory — NOT `.claude/skills/` (which is gitignored, as are `.agents/` and `.mcp.json`). A committed skill must live somewhere tracked. *(Still genuinely needs Ansar only if he wants public-registry distribution via `npx skills add` instead of an in-repo `skills/` dir — see "Decisions applied" below.)*

**Changes**

- Create `skills/openbooks-self-host/SKILL.md` with YAML frontmatter (`name: openbooks-self-host`, one-line `description` that triggers on 'self-host OpenBooks / deploy OpenBooks / set up my own OpenBooks'), matching the frontmatter shape of existing skills under `.agents/skills/*/SKILL.md` (read those for format only).
- Structure the skill as an ordered, resumable checklist with explicit decision points: (0) prerequisites gate (Node/pnpm, gh/vercel/convex CLIs, accounts); (1) fork+clone the repo via `gh repo fork`; (2) `pnpm install`; (3) run `pnpm setup` (E13-T2) to mint JWT keypair/JWKS/encryption key and write .env.local; (4) `npx convex dev --once` to create/link a Convex dev project and push functions; (5) `convex env set` server secrets (delegated to E13-T2); (6) `pnpm dev:full` to verify locally; (7) `vercel link` + set `NEXT_PUBLIC_CONVEX_URL`; (8) `npx convex deploy` to a prod deployment + `vercel deploy --prod`; (9) print the 2-3 remaining MANUAL steps (paste Plaid/Stripe/AI keys in Settings → Connections, register the redirect+webhook URLs surfaced by /setup).
- Embed hard guardrails the agent must obey: never echo secret VALUES to the transcript or commit them; orchestrate-and-pause-for-confirmation — stop and ask the human before ANY `--prod` deploy or account-touching step (GitHub fork, Convex project create, Vercel link/deploy), never fully auto-provision (decided: see decisions.md Q69). Live connectors (live Plaid/Stripe keys) are permitted locally and in self-host (decided: see decisions.md Q16 / Ansar #13) — drop any "sandbox/test keys only" instruction.
- Reference the real scripts the skill orchestrates so it does not reinvent them: `scripts/setup.mjs`, `scripts/preflight.mjs`, `scripts/dev-full.mjs`, `scripts/register-stripe-webhook.mjs`.
- Add a `reference/` sub-doc inside the skill listing each env var, its destination (Vercel `NEXT_PUBLIC_*` vs Convex deployment env), and required/optional status, kept in sync with E13-T6's checklist.

**Files:** `skills/openbooks-self-host/SKILL.md (new)`, `skills/openbooks-self-host/reference/env-map.md (new)`, `.agents/skills/frontend-design/SKILL.md (format reference, read-only)`, `scripts/dev-full.mjs (orchestrated, read-only)`, `scripts/preflight.mjs (orchestrated, read-only)`, `scripts/register-stripe-webhook.mjs (orchestrated, read-only)`

**Definition of done**

- [ ] SKILL.md lives at the tracked `skills/openbooks-self-host/` path (not gitignored), has valid YAML frontmatter (name + description), and parses as a skill (same shape as .agents/skills/*/SKILL.md).
- [ ] The skill body is an ordered, resumable checklist covering fork→clone→install→setup→convex→local-run→vercel→prod-deploy→remaining-manual-steps, each step naming the exact command.
- [ ] Guardrails are explicit: no secret values in transcript/commits, pause-for-human-confirmation before every `--prod` deploy or account-touching step (never fully auto-provision), and live connectors permitted locally (no sandbox/test-only instruction).
- [ ] Every script the skill calls actually exists in scripts/ (no invented commands); env-map.md lists every var with destination + required/optional.

**Deliverables:** skills/openbooks-self-host/SKILL.md; skills/openbooks-self-host/reference/env-map.md; A transcript or recording of one dry-run pass of the checklist (commands listed, no execution of prod deploy) attached to the ticket

**Verify.** Manually walk the SKILL.md steps top to bottom against the repo; confirm each named command exists (`scripts/*`, `gh`, `vercel`, `npx convex`). Lint the frontmatter by loading it the same way the skills loader does (`npx skills` or manual YAML parse). Cross-check env-map.md against scripts/preflight.mjs required/optional arrays.

### E13-T2 — pnpm setup — one-shot bootstrap that writes .env.local, mints keys, and sets Convex env
`size: M` · `risk: low` · `depends on: —`

**Intent.** Collapse the most error-prone manual steps (generate JWT keypair + JWKS, generate the secret encryption key, hand-run many `convex env set`) into one idempotent command the setup skill and a human can both run.

**Changes**

- Create `scripts/setup.mjs` and wire `"setup": "node scripts/setup.mjs"` in package.json scripts (next to dev:full/preflight).
- Step 1: if .env.local is missing, copy from .env.example (reuse the existing env parser shape from scripts/dev-full.mjs / preflight.mjs); never overwrite a non-empty value.
- Step 2: generate Convex Auth keys when absent — produce a JWT_PRIVATE_KEY (PKCS8) and matching JWKS using `jose` (already a dependency) exactly as Convex Auth expects, and write them to .env.local.
- Step 3: generate a strong random OPENBOOKS_SECRET_ENCRYPTION_KEY (32 raw bytes, base64-encoded) if absent — this is the key secretBox.ts (convex/secretBox.ts) needs before any Plaid/Stripe/AI/Plunk secret can be stored in the unified `credentials` table. NOTE: the KDF fix (32 raw bytes / HKDF, not bare SHA-256) and the unified credential store are owned by E3 (decided: see decisions.md Q12/Q18 — one encrypted-at-rest store for all credentials); E13-T2 only mints a correctly-sized key, it does not reshape the store.
- Step 4: push server-only secrets into the Convex deployment env via `npx convex env set NAME value` for the names that belong server-side (JWT_PRIVATE_KEY, JWKS, SITE_URL, OPENBOOKS_SECRET_ENCRYPTION_KEY, and any provided Plaid/Stripe/AI/Plunk secrets — live or test keys both permitted per decisions.md Q16), reading values from .env.local and never echoing them; support a `--prod` flag that targets the production deployment but pauses for explicit human confirmation before writing to prod (decided: see decisions.md Q69).
- Step 5: print a concise next-steps summary and recommend `pnpm preflight`.
- Make the whole script idempotent and re-runnable; print a PASS/SET/SKIP table (names only, no values), mirroring preflight's name-only output discipline.

**Files:** `scripts/setup.mjs (new)`, `package.json (add setup script)`, `.env.example (read; source of var list)`, `convex/secretBox.ts (consumer of OPENBOOKS_SECRET_ENCRYPTION_KEY, read-only)`, `scripts/preflight.mjs (env-parser + env-name conventions, read-only)`

**Definition of done**

- [ ] `pnpm setup` on a fresh clone creates a complete .env.local with a valid JWT_PRIVATE_KEY/JWKS pair and an OPENBOOKS_SECRET_ENCRYPTION_KEY, and runs `convex env set` for server-only names.
- [ ] Re-running `pnpm setup` is a no-op for already-set values (idempotent) and never overwrites a non-empty secret.
- [ ] The generated JWT keypair is accepted by Convex Auth (a subsequent `npx convex dev --once` + owner bootstrap + sign-in works in local dev).
- [ ] No secret VALUE is printed to stdout/stderr; output is a names-only PASS/SET/SKIP table.
- [ ] After `pnpm setup`, storing a Plaid/Stripe/AI key in Settings succeeds (secretBox has its key) where before it would have been blocked.

**Deliverables:** scripts/setup.mjs; package.json diff adding `pnpm setup`; Terminal capture of a fresh-clone `pnpm setup` run (names-only output)

**Verify.** On a clean checkout with an empty .env.local: run `pnpm setup`, then `npx convex dev --once`, then `pnpm dev:full` and sign in as dev owner; confirm a Plaid sandbox app saves in Settings (proves the encryption key is live). Re-run `pnpm setup` and confirm it reports SKIP for existing values. Grep the run output for any secret substring to prove none leaked.

### E13-T3 — Add a `setup` mode to dev:full and document one-command local boot honestly
`size: S` · `risk: low` · `depends on: E13-T2`

**Intent.** Make `pnpm dev:full` work for a fresh self-hoster (who has no bootstrapped owner and possibly no env) by chaining setup, and fix the README/local-boot story which currently assumes Ansar's shared cloud deployment.

**Changes**

- In scripts/dev-full.mjs, add a `--setup` (or auto-detect missing .env.local / missing required env) path that calls scripts/setup.mjs (E13-T2) before the existing push/bootstrap/serve sequence; keep the current happy path unchanged when env is already complete.
- Relax the assertCloudConvex hard-stop so a self-hoster using their OWN Convex dev deployment still passes (it already allows any non-localhost cloud URL — confirm and add a clearer error that points to `pnpm setup` when NEXT_PUBLIC_CONVEX_URL is unset, instead of a bare throw).
- Update README.md 'Local Setup' so it no longer instructs pointing at the shared `ceaseless-mandrill-524` deployment; describe the generic flow: clone → `pnpm install` → `pnpm setup` → `pnpm dev:full` → sign in as dev owner.
- Keep the existing `--dry-run` output and extend it to mention the setup step.

**Files:** `scripts/dev-full.mjs (extend main(), assertCloudConvex, dry-run output)`, `README.md (Local Setup section)`, `docs/finishing/how-openbooks-works.md (Running it locally — align wording)`

**Definition of done**

- [ ] `pnpm dev:full` on a fresh clone with no .env.local triggers setup first (or prints an actionable message naming `pnpm setup`), then boots successfully.
- [ ] `pnpm dev:full --dry-run` lists the setup step in its plan.
- [ ] README Local Setup contains no reference to a shared/owner-specific Convex deployment and walks the generic clone→setup→run path.
- [ ] Existing behavior for an already-configured env is unchanged (no regression to the current happy path).

**Deliverables:** scripts/dev-full.mjs diff; README.md diff; how-openbooks-works.md diff

**Verify.** Run `pnpm dev:full --dry-run` and confirm the setup step appears. On a clone with an empty .env.local, run `pnpm dev:full` and confirm it bootstraps and serves. Re-run with a complete env and confirm the original fast path is untouched.

### E13-T4 — Generalize preflight for any AI provider; allow live connectors locally
`size: M` · `risk: low` · `depends on: —`

**Intent.** preflight.mjs currently hard-requires Bedrock-specific env (AWS keys, Bedrock AI_MODEL) and will FAIL a self-hoster who chose OpenAI/Anthropic/etc., undermining the BYO-provider promise; it also hard-bans live Plaid/Stripe keys, which now contradicts the product decision that live connectors must work locally. Make the provider checks conditional AND stop hard-failing on live keys, while keeping encryption-at-rest and the live-key HTTPS-redirect requirement.

**Changes**

- In scripts/preflight.mjs, split requiredEnv into a provider-agnostic core (OWNER_EMAIL, OWNER_PASSWORD, NEXT_PUBLIC_CONVEX_URL, CONVEX_DEPLOYMENT, AI_PROVIDER) plus a provider-conditional set resolved from AI_PROVIDER. Cover the canonical 14-provider catalog (decided: see decisions.md Q12 — `aiCatalog.ts` is canonical; reachability-check the common set Bedrock/OpenAI/Anthropic/Google/Groq via a 1-token ping, name-check the long tail e.g. Ollama and OpenAI-compatible gateways per Q71): bedrock → AWS_* + AI_MODEL + AI_EMBEDDINGS_MODEL; openai → OPENAI_API_KEY + OPENAI_MODEL; anthropic → ANTHROPIC_API_KEY; google → GOOGLE_* ; groq → GROQ_API_KEY; etc. — mirroring the catalog in `convex/aiCatalog.ts`.
- Make Plaid/Stripe checks degrade gracefully: when PLAID_*/STRIPE_* are absent (self-hoster will paste them in-app later via connections.ts), report SKIP not FAIL. **REMOVE the sandbox/test-only hard bans (decided: see decisions.md Q16 / Ansar #13 — live connectors must work locally; delete the AGENTS.md sandbox/test rule and neutralize the `OPENBOOKS_REAL_TEST_LIVE_CONNECTORS` gate, owned by E3).** When live Plaid (development/production) or live Stripe (`sk_live_`/`rk_live_`) keys are present, preflight PASSES (optionally INFO-noting "live keys detected; HTTPS-redirect required"), it does not FAIL. KEEP encryption-at-rest as a hard requirement and surface the live-key HTTPS-redirect requirement (`connections.ts:248`).
- Add a provider dispatch for the AI reachability check: keep checkBedrock for bedrock; add a minimal 1-token-ping check for openai/anthropic/google/groq; for the long-tail/unrecognized providers, name-check and report SKIP with a note rather than crash the bedrockPayload builder.
- Keep `--guard-only` (dev-bypass localhost guard) behavior intact.
- Export the required/optional/provider-conditional name lists (or write them to a small JSON) so E13-T6's checklist verifier can diff against them.

**Files:** `scripts/preflight.mjs (requiredEnv split, provider dispatch, drop live-key bans, Plaid/Stripe skip-when-absent)`, `convex/aiCatalog.ts (canonical 14-provider list source of truth, read-only)`, `.env.example (provider env names, read-only)`

**Definition of done**

- [ ] A self-hoster with AI_PROVIDER=openai and only OpenAI env set passes the env-name check (no Bedrock FAIL); the provider-conditional split covers the 14 catalog providers (reachability-ping the common set, name-check the long tail).
- [ ] Absent Plaid/Stripe env yields SKIP rows, not FAIL; present live Plaid (development/production) or live Stripe (sk_live_/rk_live_) PASSES (no live-key FAIL) — only encryption-at-rest is a hard gate.
- [ ] An unrecognized AI provider/model no longer throws an unhandled error; it produces a name-check SKIP/clear message.
- [ ] `--guard-only` still returns the localhost dev-bypass verdict unchanged.
- [ ] The required/optional/provider-conditional lists are exported in a form E13-T6 can consume.

**Deliverables:** scripts/preflight.mjs diff; A JSON or exported constant of env requirements consumed by E13-T6; Two captured preflight runs: one with bedrock env, one with openai env, both green; one run with a live Stripe key present that PASSES

**Verify.** Set AI_PROVIDER=openai with a dummy-but-present OPENAI_API_KEY and run `pnpm preflight`; confirm no Bedrock-required FAIL and Plaid/Stripe show SKIP when absent. Inject a `sk_live_` Stripe key and confirm preflight now PASSES (does not FAIL on the live key). Run with bedrock env and confirm the original AI checks still pass.

### E13-T5 — Write the security-posture doc and a public /security page, verified against code
`size: M` · `risk: low` · `depends on: —`

**Intent.** Give self-hosters and prospects an honest, code-cited statement of how their bank tokens and keys are protected before they paste a secret — the trust artifact the BYO-keys product needs.

**Changes**

- Create `docs/security/security-posture.md` covering five claims, each with a file citation and a one-line 'how to verify yourself': (1) Encryption at rest — convex/secretBox.ts AES-GCM, versioned ciphertext, keyed by OPENBOOKS_SECRET_ENCRYPTION_KEY, key never stored in DB; covers ALL credentials (ai/plaid/stripe/plunk) in the single unified `credentials` store (decided: see decisions.md Q12/Q18 — one encrypted store, owned by E3); (2) Secrets never returned to the client — connections.ts returns only keyPreview/fingerprint/status, never plaintext (cite the CredentialSaveResult shape and the *Preview fields); (3) Live-key HTTPS-redirect requirement — live connectors are permitted locally and in self-host (decided: see decisions.md Q16 / Ansar #13), and live keys require a stable HTTPS origin for the OAuth redirect/webhook (cite connections.ts:248); the old "sandbox/test enforcement" claim is removed, NOT documented; (4) Server-side authz re-check — every query/mutation/action calls convex/authz.ts requireWorkspacePermission/requireAnyWorkspacePermission; (5) No-PII-commit — .gitignore env ignores, docs/security/secrets.md rotation note, and the secret-scan in E13-T8.
- Before writing, VERIFY each claim against current code; if any claim is false or aspirational (e.g. a function that returns a token, a missing authz check), record it as a finding and either fix the trivial case or file it as an open question for the owning epic — do not document a false guarantee.
- Keep the page LEAN and honest (decided: see decisions.md Q72 — lean, honest, code-cited statement for v1, not a polished marketing trust page): a short data-handling summary plus a responsible-disclosure email (a small process commitment Ansar accepts). No threat-model essay.
- Build a public `/security` route at apps/web/src/app/security/page.tsx rendering the posture in the OpenBooks design system (white surfaces, Geist, lucide, single green; no gradients/purple/emoji), readable without login.
- Link /security from the landing page footer/roadmap and from /setup (E13-T7).

**Files:** `docs/security/security-posture.md (new)`, `apps/web/src/app/security/page.tsx (new)`, `convex/secretBox.ts (cited)`, `convex/connections.ts (keyPreview/fingerprint return shape — cited & verified)`, `convex/authz.ts (cited)`, `apps/web/src/app/page.tsx (add link)`

**Definition of done**

- [ ] Each of the five posture claims has a precise file (and ideally line) citation that is true against current code; any false claim is corrected in code or downgraded to 'planned' with a note.
- [ ] /security renders without authentication, matches the design system (no gradients/emoji/purple/glassmorphism), and is reachable from the landing page.
- [ ] A reviewer can follow each 'verify yourself' instruction and reproduce the claim (e.g. grep connections.ts and confirm no plaintext secret is returned).
- [ ] `pnpm typecheck && pnpm lint && pnpm build` pass with the new route.

**Deliverables:** docs/security/security-posture.md; apps/web/src/app/security/page.tsx; Screenshot of /security at desktop + mobile widths; List of any posture findings (claims that did not hold) with their disposition

**Verify.** Run the repo's secret-scan/grep recipe to confirm no plaintext credential is returned from connections.ts; grep the convex/ tree to confirm public-facing functions call an authz helper. Load /security in a browser (agent-browser skill) at 390px and 1280px and confirm design-system compliance. Run `pnpm verify`.

### E13-T6 — Prerequisites + env checklist (doc + machine-checkable) kept in sync with preflight
`size: M` · `risk: low` · `depends on: E13-T4`

**Intent.** Give a self-hoster a single authoritative list: every variable, required vs optional, Vercel vs Convex destination, and where to obtain each external key — and guarantee it never drifts from what preflight enforces.

**Changes**

- Write `docs/self-host/prerequisites.md`: accounts/CLIs needed (GitHub, Vercel, Convex, an AI provider account from the 14-provider catalog; optionally Plaid, Stripe, Plunk), tool versions (Node, pnpm 10.x, gh/vercel/convex CLIs), and the ~15-minute key-gathering steps (Plaid keys — sandbox OR live, Stripe secret key — test OR live, AI provider key, Plunk) — generalized from docs/initiation/access-and-questions.md §1 but with NO Ansar-specific values. State plainly that live connectors are supported (decided: see decisions.md Q16 / Ansar #13); live keys require a stable HTTPS origin for redirects/webhooks.
- Write `docs/self-host/env-checklist.md`: a table of every env var with columns Required/Optional, Destination (Vercel `NEXT_PUBLIC_*` vs Convex deployment env vs local-only), and 'where to get it'; mark the irreducible manual items (Plaid/Stripe/AI keys) and the redirect/webhook URLs that get registered.
- Add a tiny verifier `scripts/check-env-docs.mjs` (or a unit test) that parses .env.example + the exported preflight requirements (E13-T4) and asserts the checklist table covers exactly those names with no missing/extra rows; wire it into `pnpm verify` or as a standalone `pnpm check:env-docs`.
- Ensure the checklist's required/optional split matches preflight's provider-aware split (so OpenAI users aren't told AWS keys are required).

**Files:** `docs/self-host/prerequisites.md (new)`, `docs/self-host/env-checklist.md (new)`, `scripts/check-env-docs.mjs (new)`, `package.json (optional check:env-docs script)`, `.env.example (source of var names, read-only)`, `docs/initiation/access-and-questions.md (generalize from, read-only)`

**Definition of done**

- [ ] prerequisites.md and env-checklist.md contain zero Ansar-specific values (no his Vercel scope, Convex prod name, domain, or emails).
- [ ] Every var in .env.example appears exactly once in env-checklist.md with a Required/Optional flag and a Vercel/Convex/local destination.
- [ ] scripts/check-env-docs.mjs exits non-zero if a var is in .env.example/preflight but missing from the checklist, or vice versa, and exits zero on the in-sync state.
- [ ] Required/optional split agrees with preflight's provider-aware logic for at least bedrock and openai providers.

**Deliverables:** docs/self-host/prerequisites.md; docs/self-host/env-checklist.md; scripts/check-env-docs.mjs; CI/local run output of the env-docs check passing

**Verify.** Run `node scripts/check-env-docs.mjs` and confirm it passes; then delete one row from env-checklist.md and confirm it fails (proving it is a real gate). Grep both docs for Ansar-specific strings ('perceptive-guanaco', 'ansarullahanas', 'ansar-ullah-anas-projects') and confirm zero hits.

### E13-T7 — Public /setup instructions page surfacing the live redirect/webhook URLs
`size: M` · `risk: low` · `depends on: E13-T5, E13-T6`

**Intent.** Put the irreducible manual steps and the exact copyable URLs in front of the owner inside the product, so they don't hunt through docs to find what to register in the Plaid/Stripe dashboards.

**Changes**

- Create `apps/web/src/app/setup/page.tsx`: a public/owner-facing, mobile-first setup guide with numbered steps (clone & deploy → set keys in Settings → register redirect+webhook URLs → set opening balances → run AI review), in the OpenBooks design system.
- Surface the real, copyable endpoint URLs. connections.webhookConfig (convex/connections.ts:414) requires connections.manage and returns stripeWebhookUrl/plaidWebhookUrl/plaidRedirectUri/stripeRedirectUri/siteUrl; for the authenticated owner view render those with copy buttons. For the truly public (no-login) variant, derive display-only URL patterns from the deployment's public site URL so a prospect sees the shape without needing an authed query.
- State clearly that registering the Stripe webhook is REQUIRED for a live Stripe connection (decided: see decisions.md Q15 / Ansar #11 — a connection does not report "listening" until the webhook is verified); the copyable `stripeWebhookUrl` plus the `whsec_…` signing-secret step is a mandatory, not optional, manual step. The webhook implementation itself is owned by E3.
- Add a 'Deploy your own' affordance: the `gh repo fork` + `pnpm setup` quickstart (the agent-skill + `pnpm setup` path), cross-linking to `skills/openbooks-self-host/` and docs/self-host/. A one-click Vercel marketplace template is DEFERRED for v1 (decided: see decisions.md Q70 — the skill + `pnpm setup` path is sufficient); do not build or link a Vercel Deploy button.
- Link /setup from the landing page (a clear 'Self-host / Run your own' entry) and cross-link to /security and the docs in docs/self-host/.
- Reuse the existing copy-to-clipboard pattern already used in ConnectionsSection.tsx for the URL rows.

**Files:** `apps/web/src/app/setup/page.tsx (new)`, `convex/connections.ts (webhookConfig, read-only — already surfaces the URLs)`, `apps/web/src/components/openbooks/settings/ConnectionsSection.tsx (copy-row pattern reference, read-only)`, `apps/web/src/app/page.tsx (add Self-host link)`

**Definition of done**

- [ ] /setup renders mobile-first and design-system-compliant (no gradients/emoji/purple), reachable from the landing page.
- [ ] The authenticated owner view shows the real Stripe/Plaid webhook + redirect URLs from webhookConfig with working copy buttons; the public view shows the URL shapes without leaking a specific deployment's private values.
- [ ] A 'Deploy your own' path is present (fork + `pnpm setup` quickstart; no Vercel one-click button — deferred per Q70) and links to `skills/openbooks-self-host/`, docs/self-host/, and /security; the Stripe-webhook-required step is stated explicitly.
- [ ] `pnpm typecheck && pnpm lint && pnpm build` pass.

**Deliverables:** apps/web/src/app/setup/page.tsx; Landing-page link diff; Screenshots of /setup public and authenticated views at mobile + desktop

**Verify.** Load /setup logged out and confirm it renders with URL-shape guidance and a deploy path; load it as the dev owner and confirm the copy buttons yield the actual webhookConfig URLs. Run `pnpm verify`. Confirm the landing page links to it.

### E13-T8 — Generic-ize deployment docs, add a secret-scan gate, and a deploy-to-prod runbook
`size: M` · `risk: low` · `depends on: E13-T5`

**Intent.** Replace the Ansar-specific deployment runbooks (a copy/leak hazard) with a generic self-host deploy guide, and add an automated secret-scan so the new public docs/pages never ship a real key or private URL.

**Changes**

- Create `docs/self-host/deploy.md`: a generic Convex-prod + Vercel-prod deployment runbook — `npx convex deploy` to create/select a production deployment, `convex env set --prod` for server secrets, `vercel link` + set only `NEXT_PUBLIC_CONVEX_URL` in Vercel, attach a custom domain (placeholder), and post-deploy: run scripts/register-stripe-webhook.mjs to register the Stripe endpoint and capture the signing secret. Cite, don't copy, the existing Ansar runbooks.
- Refactor docs/deployment/vercel.md and docs/deployment/convex-auth-plunk.md: extract the reusable structure into docs/self-host/deploy.md and reduce the originals to a clearly-labeled 'Ansar's reference deployment (not for self-hosters)' OR move them out of the generic path; remove or placeholder any value that is a private URL/account id where it appears in the generic doc.
- Add `scripts/scan-secrets.mjs` (and `pnpm scan:secrets`): scan tracked docs + the new web pages for patterns — `sk_live_`, `rk_live_`, `sk_test_`/`rk_test_` literals, AWS key prefixes (AKIA), `whsec_`, JWT-looking blobs, Plaid client_id/secret shapes, and the owner's personal identifiers — failing on any hit; allowlist the .env.example placeholders.
- Document the no-PII-commit posture link from security-posture.md (E13-T5) to this scan.

**Files:** `docs/self-host/deploy.md (new)`, `docs/deployment/vercel.md (refactor/label as reference)`, `docs/deployment/convex-auth-plunk.md (refactor/label as reference)`, `scripts/scan-secrets.mjs (new)`, `package.json (scan:secrets script)`, `scripts/register-stripe-webhook.mjs (referenced in deploy runbook, read-only)`

**Definition of done**

- [ ] docs/self-host/deploy.md gives a generic, placeholder-only Convex-prod + Vercel-prod + Stripe-webhook-registration walkthrough.
- [ ] The original deployment docs are either clearly labeled as Ansar's personal reference or stripped of private values; the generic path contains no real account ids/URLs.
- [ ] `pnpm scan:secrets` runs over docs + apps/web pages and exits non-zero on any planted test secret (e.g. a temporary `sk_live_abc`), and exits zero on the clean tree (with .env.example placeholders allowlisted).
- [ ] scan:secrets is referenced by security-posture.md as the no-PII-commit enforcement.

**Deliverables:** docs/self-host/deploy.md; Refactored docs/deployment/*.md; scripts/scan-secrets.mjs; pnpm scan:secrets run output (clean) + a captured failing run with a planted secret

**Verify.** Run `node scripts/scan-secrets.mjs`; confirm clean. Plant `STRIPE_SECRET_KEY=sk_live_test123` in a doc, re-run, confirm non-zero exit and the offending file is named, then remove it. Grep docs/self-host/ for 'perceptive-guanaco'/'ansarullahanas' and confirm zero hits.

### E13-T9 — End-to-end self-host dry-run validation + final cross-check
`size: M` · `risk: low` · `depends on: E13-T1, E13-T2, E13-T3, E13-T4, E13-T5, E13-T6, E13-T7, E13-T8`

**Intent.** Prove the whole E13 path actually works for a fresh self-hoster and that every gate is green, closing the epic with evidence rather than assertion.

**Changes**

- Perform a clean-clone dry run of the documented path: fresh checkout → `pnpm install` → `pnpm setup` → `npx convex dev --once` against a throwaway Convex dev project → `pnpm dev:full` → sign in as dev owner → save a Plaid app + a Stripe key in Settings (sandbox/test keys for the dry run; proving secretBox encryption-at-rest through the unified credential store — live keys are also permitted per decisions.md Q16) → run `pnpm preflight` with a non-Bedrock provider and confirm a present live key PASSES (no live-key FAIL) → confirm /setup and /security render.
- Run the full gate: `pnpm verify` (typecheck+lint+build+unit), `npx convex dev --once` (Convex typecheck), `node scripts/check-env-docs.mjs`, `node scripts/scan-secrets.mjs`.
- Confirm the no-ledger-touch invariant: `git diff` shows zero changes to convex/ledger.ts and no money-math files were modified by E13.
- Record an evidence note (path table + gate results + screenshots) under docs/self-host/ or docs/finishing/evidence/ summarizing the validated path and any residual manual steps.
- File any discovered gaps (e.g. a provider whose preflight check is still missing, a doc row out of sync) as open questions back to the relevant epics.

**Files:** `scripts/setup.mjs (exercise)`, `scripts/preflight.mjs (exercise)`, `scripts/dev-full.mjs (exercise)`, `scripts/check-env-docs.mjs (exercise)`, `scripts/scan-secrets.mjs (exercise)`, `apps/web/src/app/setup/page.tsx (exercise)`, `apps/web/src/app/security/page.tsx (exercise)`

**Definition of done**

- [ ] A clean-clone run reaches a working local app and successfully stores a Plaid app + Stripe key (sandbox/test for the dry run) through the encrypted vault; a present live key passes preflight (no live-key FAIL).
- [ ] `pnpm verify`, `npx convex dev --once`, `check-env-docs`, and `scan-secrets` all pass.
- [ ] `git diff --stat` confirms convex/ledger.ts and money-math files are untouched by E13.
- [ ] An evidence artifact captures the path, gate results, and screenshots; residual manual steps are explicitly listed.

**Deliverables:** docs/self-host/validation-evidence.md (or docs/finishing/evidence/e13-*.md) with gate results and screenshots; Captured outputs of all gate commands; A short list of residual manual steps + any filed open questions

**Verify.** Re-run the four gate commands and confirm all green; open /setup and /security in agent-browser at mobile+desktop and attach screenshots; run `git diff --stat -- convex/ledger.ts` and confirm empty.

## Decisions applied

This epic's prior open questions are resolved by `../decisions.md` (canonical) and `../plan-rebuild-changelog.md`. Applied here:

- **Q68 — Skill placement:** commit to a tracked top-level `skills/openbooks-self-host/` directory (`.claude/`, `.agents/`, `.mcp.json` are gitignored). Applied in E13-T1.
- **Q69 — Auto-provisioning depth:** orchestrate-and-pause-for-confirmation; never fully auto-provision; pause before any `--prod` deploy or account-touching step. Applied in E13-T1, E13-T2.
- **Q70 — One-click Vercel template:** DEFERRED; the skill + `pnpm setup` path is sufficient for v1. Applied in E13-T7.
- **Q71 — Preflight provider coverage:** reachability-check the common set (Bedrock/OpenAI/Anthropic/Google/Groq, 1-token ping); name-check the long tail. 14-provider catalog (`aiCatalog.ts`) is canonical. Applied in E13-T4.
- **Q72 — Security page depth:** lean, honest, code-cited statement + responsible-disclosure email for v1. Applied in E13-T5.
- **Q73 — Domain/HTTPS:** `*.vercel.app` + `*.convex.site` documented as sufficient; live-key HTTPS-redirect requirement (`connections.ts:248`) explained. Applied in E13-T5, E13-T6, E13-T7.
- **Q74 — Onboarding overlap:** E13 only documents/links key-entry + opening-balance + AI-review; the in-app UI and opening-balance posting are owned by E3/E4. Applied across E13-T1, E13-T7.
- **Q16 (cross-cutting) — Live connectors work locally:** the AGENTS.md "sandbox/test keys only" rule is removed and the `OPENBOOKS_REAL_TEST_LIVE_CONNECTORS` gate is neutralized (owned by E3); this epic reflects that throughout (goal, current-state, E13-T4 preflight, E13-T5 security posture). Retained guarantees: encryption-at-rest + live-key HTTPS-redirect.

### Still needs Ansar

- **Q68 (light) — Distribution:** default is an in-repo `skills/openbooks-self-host/` dir. Resolve only if Ansar wants public-registry distribution (`npx skills add openbooks/...`) instead. Does not block the build; the in-repo default is implementation-ready.
