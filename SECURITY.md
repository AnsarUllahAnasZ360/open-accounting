# Security Policy

OpenBooks is bring-your-own-keys bookkeeping: a user's bank tokens and API keys
live in **their own** deployment, encrypted at rest. We take that trust
seriously. This document explains how to report a vulnerability and the security
posture you can rely on.

## Reporting a vulnerability

**Please report security issues privately — do not open a public issue.**

- Preferred: use GitHub's **private vulnerability reporting** ("Report a
  vulnerability" under the repository's **Security** tab).
- Alternatively, email the maintainer (see the repository profile /
  `github.com/<owner>/openbooks`).

Please include:

- A description of the issue and its impact.
- Steps to reproduce (a minimal proof-of-concept if possible).
- Affected version / commit.

We will acknowledge your report, investigate, and give a reasonable disclosure
window to ship a fix before any public disclosure. Please act in good faith:
avoid privacy violations, data destruction, or service disruption while testing.

## Supported versions

OpenBooks is an actively developed open-source project. Security fixes target the
`main` branch and the latest release. Self-hosters should track `main` (or the
latest tag) to receive fixes.

| Version | Supported |
|---|---|
| `main` / latest | ✅ |
| Older commits | Best-effort; please update |

## Security posture

This is the same posture documented in `docs/security/secrets.md`,
`docs/security/security-posture.md`, and the public `/security` page — stated
without overclaim:

- **One unified, encrypted-at-rest credentials store.** All credentials (AI,
  Plaid, Stripe, Plunk) are stored in a single `credentials` table as an
  encrypted blob via `secretBox` (AES-GCM). There is no per-provider plaintext
  field.
- **Correctly scoped.** AI, Plunk, and the Plaid Item token are workspace-scoped;
  Stripe is per-business (`entityId` required).
- **Keys are never returned to the client.** The UI sees only a `keyPreview` /
  `lastFour` / fingerprint — never the secret value. Every server read re-checks
  workspace/entity authorization first.
- **Live connectors are supported locally.** Live Plaid (development/production)
  and live Stripe keys work locally and self-hosted — there is **no**
  sandbox/test-only restriction. The retained hard requirements are
  **encryption at rest** and the **live-key HTTPS-redirect** requirement (a live
  key needs a stable HTTPS origin for OAuth redirects / webhooks).
- **Nothing secret is committed.** `.env.local` is gitignored; only
  `.env.example` (placeholders) is tracked. Secret scanning gates the repo:
  `pnpm scan:secrets` (public-surface secret/PII gate) and
  `pnpm security:gitleaks` (git-history scan via `.gitleaks.toml`).

The honest non-claim: pasting live bank/Stripe credentials is never "risk-free."
It is safe *because* of encryption-at-rest, per-entity authorization, and the
HTTPS-origin requirement — not in spite of them.

## For self-hosters

Because you run your own deployment, **you** are responsible for your Convex /
Vercel account security, your env store, and rotating any secret that is ever
exposed (pasted into chat, a screenshot, or a log). Treat the encryption key
(`OPENBOOKS_SECRET_ENCRYPTION_KEY`) as the master secret for your credential
vault.
