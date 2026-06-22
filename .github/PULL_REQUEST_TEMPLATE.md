<!-- Thanks for contributing to OpenBooks. Keep PRs focused. -->

## What & why
Briefly: what changes, and the outcome it creates.

## Checklist
- [ ] `pnpm ci` is green locally (typecheck + lint + build + unit + convex tsc).
- [ ] No secrets, keys, tokens, or real financial/PII data in the diff or history.
- [ ] Money stays integer minor units + currency code (never floats for stored amounts).
- [ ] **Ledger path:** either `convex/ledger.ts` is unchanged, **or** the
      double-entry invariants are re-proven (debits = credits, immutable posted
      entries, reverse-and-repost) with tests. The only writer of
      journalEntries/journalLines is `postLedgerEntryCore`.
- [ ] Server functions re-check workspace/entity authorization.
- [ ] Tests added/updated for the change; UI changes checked at desktop + ~390px.

## Notes for the reviewer
(screenshots, tradeoffs, follow-ups)
