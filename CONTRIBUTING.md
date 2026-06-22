# Contributing to OpenBooks

Thanks for your interest in OpenBooks — free, open-source, MIT-licensed,
bring-your-own-keys AI bookkeeping. Contributions are welcome: bug fixes, tests,
docs, and well-scoped features.

This guide is short on purpose. The two things that matter most are the **verify
gate** and the **accounting invariants** — please read those sections before
opening a PR.

## Develop locally

OpenBooks is self-hostable; the dev setup is the same as running your own
instance. Full detail is in the README "Local Setup" and `docs/self-host/`.

```bash
pnpm install
pnpm setup            # writes .env.local, mints auth keypair + encryption key
npx convex dev --once # links your own Convex deployment, pushes functions
pnpm dev:full         # local boot; /sign-in → "Continue as owner (dev)"
```

Convex always runs in the cloud (never localhost), so you need your own free
Convex dev deployment. Never commit `.env.local` — only `.env.example`
(placeholders) is tracked.

## The verify gate (run before every PR)

Your change must keep the gate green:

```bash
pnpm verify   # typecheck + typecheck:convex + lint + build + unit tests
pnpm ci       # verify, then the Playwright e2e suite (serial)
```

`pnpm verify` includes the Convex backend typecheck
(`tsc -p convex/tsconfig.json --noEmit`). If you changed anything under
`convex/`, also run `npx convex dev --once` to push and typecheck against your
deployment.

CI mirrors `pnpm ci`. A PR that fails the gate will not be merged.

## Accounting invariants (do not break these)

OpenBooks is a real double-entry accounting system. These rules are
non-negotiable — they protect the correctness of everyone's books:

- **Money is integer minor units + a currency code.** Never use floats for stored
  financial amounts.
- **Posted journal entries are immutable.** Corrections must **reverse and
  repost**, never edit a posted entry in place.
- **One mutation owns ledger posting** and enforces that **debits equal
  credits**. Do not write journal lines from anywhere else.
- **AI proposes; the ledger engine posts.** AI suggestions never bypass the
  posting mutation or its balance check. Autonomy thresholds are a single shared
  constant.
- **Re-check authorization on the server** in every query/mutation/action —
  workspace/entity scoping is enforced server-side, never trusted from the
  client.

If your change touches the ledger, include a test that proves debits == credits
and that corrections reverse rather than mutate.

## Secrets and PII

- **Never commit a secret or any private financial data** — API keys, bank
  tokens, Stripe/Plaid secrets, AI keys, Plunk secrets, Convex deployment
  secrets, customer records, or payroll detail.
- Run `pnpm scan:secrets` (and `pnpm security:gitleaks` for history) before
  pushing.
- All real credentials live in `.env.local` or the Convex/Vercel env store, never
  in a tracked file. See `SECURITY.md` and `docs/security/secrets.md`.

## Pull requests

1. Branch off `main` (or the active working branch).
2. Keep the change scoped and the diff focused.
3. Add/extend tests for the behavior you changed.
4. Run `pnpm verify` (and `npx convex dev --once` if you touched `convex/`).
5. Write a clear PR description: what changed, why, and how you verified it. List
   any new tests. If you fixed a status-table row, note it.
6. No emoji / hype in code or docs (see the design and tone rules in
   `AGENTS.md`).

### Commit message convention

Use conventional commits, and end commit messages with the co-author trailer:

```
feat(reports): add cash-flow drill-down to source lines

Co-Authored-By: <your name> <your email>
```

Agent-authored commits in this repo also carry a `Co-Authored-By` trailer for the
assisting model.

## Design rules (for UI changes)

Match the OpenBooks design system: white ledger-like surfaces, Geist fonts,
lucide icons, one brand green (`#2ca01c`), quiet AI affordances. No gradients,
purple AI styling, emoji, decorative blobs, or glassmorphism. Use shadcn
primitives before raw controls. Use tabular figures for money. Mobile must be a
real responsive surface, not a squeezed desktop page.

## License

By contributing, you agree your contributions are licensed under the project's
**MIT** license (see `LICENSE`).
