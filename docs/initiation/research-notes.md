# Research Notes

Date: 2026-06-11

## Codex Goals

Source: https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex

Key takeaways:

- A goal is a persistent objective with a completion contract, not a larger
  prompt.
- Good goals define what should be true, how success is checked, and what
  constraints must remain intact.
- The overnight run should be scoped to a measurable milestone, not "finish all
  of OpenBooks."
- The goal should include verification commands and a blocker policy so the
  agent keeps moving when safe and stops when access or product decisions are
  truly required.

## Convex

Sources:

- https://docs.convex.dev/production/environment-variables
- https://docs.convex.dev/self-hosting
- Convex plugin guidance for existing Next.js App Router projects

Key takeaways:

- Convex env vars are per deployment and can be managed through the dashboard or
  CLI.
- Required env vars should be declared in `convex/convex.config.ts` before the
  backend grows.
- For this app, external API calls belong in actions; ledger writes belong in
  mutations.
- Workspace/entity authorization must be checked server-side in every function.
- Self-hosted Convex exists, but the practical v1 path should use Convex cloud
  for development/deployment first and document self-hosting once the app is
  stable.

## Vercel

Sources:

- Vercel plugin docs search for environment variables, CLI env, custom domains
- https://vercel.com/docs/cli/env

Key takeaways:

- Use `vercel pull` and `vercel env run` to avoid copying production secrets by
  hand.
- This repo is not locally linked to a Vercel project yet.
- The desired production domain is `openbooks.ansarullahanas.com`.
- Only frontend-safe public values should use `NEXT_PUBLIC_*`; server secrets
  should live in Vercel or Convex env depending on runtime.

## Plaid Sandbox

Sources:

- https://plaid.com/docs/sandbox/
- https://plaid.com/docs/sandbox/test-credentials/
- https://plaid.com/docs/api/products/transactions/

Key takeaways:

- Plaid Sandbox supports rich test data and custom test data.
- `user_transactions_dynamic` plus any password is a useful transactions test
  user; Plaid also provides persona users such as `user_small_business`.
- `/transactions/sync` is the correct modern transaction sync endpoint and uses
  cursors for incremental updates.
- `SYNC_UPDATES_AVAILABLE` is the recommended webhook for new transaction
  updates when using `/transactions/sync`.
- Sandbox can simulate `ITEM_LOGIN_REQUIRED` through reset-login endpoints so we
  can test re-auth/update mode.

## Stripe Sandbox/Test Mode

Source: https://docs.stripe.com/testing-use-cases

Key takeaways:

- Stripe sandboxes/test mode allow simulated objects, charges, products, prices,
  invoices, and API calls without moving real money.
- Test keys determine whether calls affect sandbox/test data or live data.
- Live secret keys must stay in env/secrets stores and never in source control.
- For v1, Stripe should start with test mode: customers, charges, invoices,
  balance transactions, payouts, webhooks, and restricted-key validation.
