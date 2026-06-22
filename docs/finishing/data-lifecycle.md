# Data lifecycle — reset, public demo, export (Epic E11)

This note is the source of truth for OpenBooks' destructive and demo data paths.
It distinguishes the **two reset paths** that are easy to confuse, documents the
**no-login public demo** isolation model, and lists the **env flags** self-hosters
care about. (The full E11 epic spec lives in
`docs/launch-sprint/epics/E11-data-lifecycle-reset-delete-all-demo-data-public.md`.)

## Two reset paths — do not confuse them

| | Owner factory reset (E11-T3) | Dev global rebuild (E11-T7) |
|---|---|---|
| Function | `workspaceReset.resetWorkspace` | `realTestReset.startFullRebuild` / `finalizeZ360Only` |
| Scope | ONLY the caller's workspace | ALL workspaces AND users |
| Keeps the user account | Yes (owner stays logged in) | No (re-bootstraps a single owner) |
| Confirmation | Re-type the **workspace name** | Fixed phrase `DELETE TEST DATA AND CREATE Z360` |
| Gate | Owner role (`workspace.reset` permission) | `OPENBOOKS_REAL_TEST_RESET_ENABLED=1` + owner |
| Outcome | Workspace returns to onboarding (empty book) | Single fresh `Z360` workspace |
| Audit action | `workspace.reset.factory` | `workspace.global_reset` |

If you are adding an owner-visible "delete all my data" affordance, it belongs in
the **factory reset**, never the global rebuild. The Settings → Data panel shows
both, clearly labeled; the global panel is disabled unless the env flag is set.

## Public no-login demo (E11-T4 / T5 / T6 / T8)

- **One shared workspace.** A dedicated, system-owned workspace flagged
  `isDemo === true && demoKind === 'public'` (slug `public-demo`). It is resolved
  on the server via `demoWorkspace.getPublicDemoWorkspace` — never by the legacy
  `acme-studio-llc` slug. No real user's `workspaceMembers` row points at it; the
  only member is a synthetic, sign-in-less system user.
- **No-login read (E11-T5).** `/demo` renders the populated demo READ-ONLY for
  truly unauthenticated visitors. NO anonymous Convex Auth identity is minted —
  `session.viewer` returns a `status: 'demo'`, read-only context when there is no
  auth and a public demo exists. The shared `demoWorkspace.requireWorkspaceRead`
  allows an auth-free read only when the target IS the public demo; every real
  workspace still requires auth + membership.
- **Read-only write guard (E11-T6).** `demoWorkspace.assertNotDemoWrite` throws a
  friendly "This is a read-only demo…" error for ANY workspace-scoped write that
  targets the public demo. It is wired centrally through `ledger.getEntityForWrite`
  (covers ledger / invoices / bills / rules / contacts / categories /
  reconciliation), `pipeline.requireEntity` (route / confirm / recategorize /
  correct), and explicitly on `entities`, `payroll`, `seedDemo.resetAndSeed`, and
  `workspaceReset.resetWorkspace`. Internal seed/cron functions are exempt (they
  run with no demo caller identity), so the daily re-seed still works.
- **Daily self-heal cron (E11-T8).** `crons.ts` runs
  `publicDemo.resetAndSeedPublicDemo` at **08:00 UTC** daily. It wipes the demo
  entity's data (batched) and re-seeds deterministically (same transaction count,
  balanced trial balance, no duplicate workspace), then records a
  `demo.public.reseeded` audit row. It is a clean NO-OP unless
  `OPENBOOKS_PUBLIC_DEMO_ENABLED=1`.
- **Secret-free seed.** The seed writes only synthetic data: no
  `connectionCredentials`/`credentials` row, no Plaid/Stripe/AI token. Metadata-
  only `stripeAccounts`/`bankAccounts` (labels + masks).

## Env flags (self-hosters)

| Flag | Default | Effect |
|---|---|---|
| `OPENBOOKS_PUBLIC_DEMO_ENABLED` | unset (OFF) | When `=1`, the daily cron provisions + resets the public `/demo` workspace. OFF for self-hosters; ON for the hosted instance. |
| `OPENBOOKS_REAL_TEST_RESET_ENABLED` | unset (OFF) | When `=1`, enables the dev global rebuild (`realTestReset`). Keep OFF in any real deployment. |

## Full-account export (E11-T9, shipped in A26)

`exportAccount` produces a secret-free JSON snapshot + a per-table CSV zip
(including a CPA-readable journal-lines CSV) of the whole workspace. Wired into
Settings → Data and audited as `workspace.exported`. See `convex/exportAccount.ts`.

The snapshot covers entities, chart of accounts, journal entries + lines,
transactions, contacts, invoices, bills, employees, payroll runs + lines, rules,
and SAFE connection metadata (bank names/masks, Stripe labels) — never secrets:
no Plaid/Stripe/AI access tokens, no `credentials.encryptedPayload` ciphertext, no
fingerprints, no admin-only `contacts.bankDetails`. "Export everything" in
Settings → Data downloads the JSON file plus the per-table CSV zip; a re-import
path is intentionally deferred (decided Q59).

## End-to-end verification (E11-T10)

The whole loop — reset → re-onboard → demo isolation → export — is proven two ways
so a single regression can't quietly break it:

- **Server invariants — `convex/dataLifecycle.test.ts`.** Two integrated tests:
  (1) a real empty workspace reads **0** transactions with no `entityId` while a
  fully-seeded public demo exists alongside it, the signed-in real viewer never
  resolves the demo, and the unauthenticated demo viewer never resolves a real
  workspace; (2) the full loop — a secret-free export of one workspace, then a
  factory reset of a *second* workspace (re-typed name) that deletes only its own
  rows + Plaid tokens, writes the `workspace.reset.factory` audit row, flips the
  owner to `needs_onboarding` while keeping the user + membership, and leaves the
  untouched workspace `ready`. Companion piecewise suites:
  `convex/activeEntity.test.ts` (no-bleed resolver), `convex/workspaceReset.test.ts`
  (two-workspace scoped delete), `convex/demoGuard.test.ts` (read isolation + the
  6-write-path server guard), `convex/exportAccount.test.ts` (secret-free export).
- **Playwright e2e — `tests/e2e/data-lifecycle-e11.spec.ts`.** Three flows against
  the dev server: (a) a fresh owner runs the factory reset by re-typing the
  workspace name and lands on guided onboarding (the run button stays disabled
  until the name matches exactly); (b) `/demo` opens with NO login, shows the
  read-only banner + indicator + populated transactions + clone CTA, and exposes
  no editable control; (c) "Export everything" downloads a non-empty, secret-free
  file. The reset/export flows sign up a brand-new owner so they never touch the
  shared dev-bypass workspace.

The landing footer's "Live demo — no account required" link (and the "Try the
live demo" CTAs) point at `/demo` — the claim is accurate because the public demo
requires no account and mints no anonymous Convex Auth identity.
