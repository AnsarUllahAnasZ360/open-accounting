# Ansar's Decisions — canonical contract for the plan rebuild (2026-06-17)

These are Ansar's direct answers. They OVERRIDE the old `open-questions.md`. The rule for
everything not covered here: **do what QuickBooks Online does. Do not invent. Do not ask accounting
questions — implement QBO behavior.**

## Accounting
1. **Tolerances** — use the tolerances real-world accounting / QuickBooks uses for matching and
   reconciliation. Pick the standard, do not ask.
2. **Opening balance date** = the **first day of the month**. **Period close** = the **last day of
   the month**. Books open at the start of a month.
3. **Accounting currency = USD only.** General bookkeeping is entirely USD. There is **no
   multi-currency ledger**, **no multi-currency opening balances**, no PKR/INR journal lines in the
   general books. DELETE the general-ledger FX engine the old plan carried.
4. **Multi-currency exists in exactly one place: payroll.** And there it is only "convert the
   foreign salary to its current USD value." Payroll books a USD amount using a day-of-pay FX rate.
5. **FX source** — use whatever rate source is easiest to obtain (only needed for payroll → USD).
   No provider preference.
6. **Intercompany** — when money moves between Ansar's own companies, **detect it and categorize it
   as an intercompany transfer** (never income/expense). Provide **two views**: (a) the individual
   single-company accounting view, and (b) the unified/portfolio view. In the unified/consolidated
   view, intercompany activity is **eliminated**.
7. **History review window** — the **user chooses**. Default to pulling as much history as the
   connector will give; let the user pick a start date instead. Not a hardcoded 6 months.

## Integrations / BYO-keys
8. **All 14 AI provider integrations must be available** (`aiCatalog.ts` is canonical: gateway,
   openai, anthropic, google, bedrock, azure, groq, deepseek, mistral, moonshot, xai, fireworks,
   ollama, openai_compatible).
9. **AI keys are workspace-scoped.**
10. **Plunk is workspace-scoped.**
11. **Stripe webhook** — do whatever **Stripe's API documentation requires** for the integration to
    function correctly. If Stripe needs the webhook for proper charge/payout sync, then require it.
12. **Credential storage** — use the single correct storage shape for **ALL** stored credentials
    (AI, Plaid, Stripe, Plunk), not a one-off for AI. Encrypted at rest, scoped correctly.

## Live connectors
13. **Remove from AGENTS.md the rule that only Plaid sandbox / Stripe test keys are permitted.**
    **Live connectors must work locally.** Ansar needs to run his real books on this.

## Demo
14. **Public demo = a single shared demo workspace with NO login.** Anyone can open it and explore.
    Not a per-visitor ephemeral clone.

## Process
15. **Scope = all epics.** Don't ask whether to do something he already described.
16. When asking Ansar anything, only ask **product-facing decisions that genuinely need him**, with
    **full context** (what changes, why it matters, the recommendation). No accountant trivia.
