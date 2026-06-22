# GitHub publication checklist (E15-T10)

The one-pass checklist to take OpenBooks from a private working repo to a clean,
public, contributor-ready project. Run top to bottom; nothing here touches the
ledger or product code — it is repo hygiene, governance, and the public surface.

## 1. Secrets & safety (do this first — it is irreversible once pushed)
- [ ] `node scripts/scan-secrets.mjs` returns clean (no keys, tokens, PII). This
      is the same gate `pnpm verify`-adjacent tooling uses; it greps the full
      tree and git history shape for `sk_live_`, `sk_test_`, `AKIA…`, private-key
      headers, and `.env` bodies.
- [ ] `gitleaks detect` (config committed) passes on the full history, not just
      the tip. See `docs/finishing/security-audit.md`.
- [ ] `.gitignore` covers `.env`, `.env.*`, `.convex`, `.vercel`, local agent
      dirs (`.agents`, `.claude`, `.codex`, `.mcp.json`, `tmp`).
- [ ] No customer/bank data, no copied env file, no deployment-specific secret in
      any doc. The Ansar-specific runbooks under `docs/deployment/` are labeled as
      personal reference, not generic instructions.

## 2. License & legal
- [ ] `LICENSE` is MIT (relicensed from AGPL — E15-T1).
- [ ] `grep -rni agpl` returns zero hits in shipped docs.
- [ ] `README.md` states "MIT licensed"; the landing's MIT claims now match.

## 3. Governance files (present at repo root / `.github/`)
- [ ] `README.md` — leads with the Portfolio / multi-LLC + AI-CFO differentiator,
      quickstart, and an honest "what works / what's beta / what's planned" table.
- [ ] `CONTRIBUTING.md` — setup, branch/PR conventions, the gate (`pnpm ci`),
      where the ledger law lives.
- [ ] `SECURITY.md` — how to report a vulnerability, encryption-at-rest posture,
      links to `/security`.
- [ ] `CODE_OF_CONDUCT.md` — Contributor Covenant.
- [ ] `.github/ISSUE_TEMPLATE/` — bug report + feature request + config.
- [ ] `.github/PULL_REQUEST_TEMPLATE.md` — checklist incl. "gate green" + "no
      secrets" + "ledger path unchanged or invariants re-proven".

## 4. Public surfaces resolve correctly
- [ ] Landing demo CTAs → `/demo` (no-login public demo), not `/dashboard`.
- [ ] `/setup` and `/security` pages render and link from the footer.
- [ ] All GitHub links target `github.com/<owner>/openbooks` via
      `apps/web/src/lib/openbooks/brand-links.ts` (single source of truth).
- [ ] Every false/stale claim in `docs/gtm/landing-claims-audit.md` is corrected.

## 5. Repo rename & metadata
- [ ] Rename the public repo to `openbooks`.
- [ ] Repo description + topics set (`bookkeeping`, `accounting`, `convex`,
      `nextjs`, `double-entry`, `self-hosted`, `ai`).
- [ ] Custom domain link: `openbooks.ansarullahanas.com` (Vercel URL as fallback).
- [ ] Find-replace the `<!-- REPO-URL -->` anchors with the final owner prefix.

## 6. Seed the issue tracker from the backlog
- [ ] Convert any remaining `docs/launch-sprint/backlog.json` items that are
      *post-launch* (evidence captures needing a seeded env; nice-to-haves) into
      labeled GitHub issues: `good first issue`, `evidence`, `enhancement`.
- [ ] Open a pinned "Roadmap / what's next" issue.

## 7. Final gate before flipping public
- [ ] `pnpm ci` (typecheck + lint + build + unit + convex tsc) green.
- [ ] `docs/launch-sprint/progress.html` shows the honest completion state.
- [ ] One human read-through of the README and `/` landing on desktop + 390px.

When every box is checked, flip the repo to public and post the launch
(templates in `docs/gtm/outreach-templates.md`).
