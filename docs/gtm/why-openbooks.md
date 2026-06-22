# Why I'm building OpenBooks

> A founder one-pager for the public launch. Draft narrative is complete; the
> personal voice still needs Ansar. License: **MIT**. Status framing is honest —
> no "fully automated books" claim anywhere below.

---

## NEEDS ANSAR INPUT (fill these before publishing)

This page is launch-ready except for the personal voice — the part nobody else
can write. Search the file for `ANSAR INPUT` and fill each slot. There are
**five** of them:

1. **Your personal story** — why you started this for Zikra + Z360 (the founder
   hook at the top).
2. **The QuickBooks / Bench failure moment** — the specific moment a tool let you
   down and you decided to build your own.
3. **Who you want to help, and one sentence to them** — the direct address to the
   reader.
4. **Your sign-off** — name, role, and one personal closing line.
5. *(Optional but recommended)* **A real number from your own books** — e.g. what
   you were paying for bookkeeping before, or how many businesses you now run on
   OpenBooks — to make the story concrete.

Everything outside those slots is drafted and consistent with the README status
table and the MIT license. Do not add claims of full automation or "your CPA is
guaranteed to accept it."

---

## The short version

OpenBooks is free, open-source, AI-assisted bookkeeping for small businesses.
You connect your own bank, payments, and AI provider — your keys, your data — and
an AI bookkeeper keeps a real set of double-entry books for you. You only ever
deal with plain English. When the AI is unsure, it asks you in an Inbox. The one
rule that governs everything: **AI proposes; the ledger engine posts.**

And if you run more than one business, OpenBooks is built for exactly that: each
company keeps its own clean books, and a portfolio view rolls them all into one
honest combined picture with the money you moved between them cancelled out.

<!-- ANSAR INPUT: your personal story — why you started this for Zikra + Z360.
     2–4 sentences in your own voice. What made bookkeeping a real problem for
     you running multiple companies? -->

---

## The problem every small business runs into

A business with a handful of people has three options for bookkeeping, and all
three are bad:

1. **Pay for software plus a bookkeeper.** QuickBooks Online runs roughly
   $38–$275/month and has raised prices year after year; add a bookkeeper and you
   are easily at $500–600/month for something most owners never look at.
2. **Do nothing** — run the business out of a banking app and a folder of
   receipts, and find out what the numbers actually are only when tax season
   forces it.
3. **Use a free tool that isn't really accounting** — an invoicing app or a
   receipt parser that never produces books an accountant can trust.

And the "managed" middle option has a trust problem of its own. Bench shut down
overnight in December 2024 and customers scrambled to get their own data out.
Midday is being wound into Ramp. When your books live in someone else's product,
you are one business decision away from losing them.

<!-- ANSAR INPUT: the moment QuickBooks/Bench (or whatever it was) failed you.
     Be specific and concrete — the price hike, the lock-in, the data you almost
     lost, the hours wasted. This is the emotional core of the page. -->

---

## What changed — and why now is the moment

Two things shifted at the same time:

- **AI can now do the bookkeeper's actual job** — categorize, match, reconcile,
  and flag the exceptions — well enough that a person only has to handle the few
  cases the AI is genuinely unsure about.
- **The cost of that intelligence collapsed.** When you bring your own AI key,
  the marginal cost of an AI bookkeeper is API pennies, not a $500/month service.

So the right shape for modern bookkeeping is: the software is free and open, the
AI does the repetitive work, and the owner brings their own key. Nobody sits in
the middle taking a subscription for it.

---

## The bets OpenBooks makes

These are the opinions baked into the product:

- **Double-entry under the hood, plain English on the surface.** Real balanced
  books — the kind an accountant can read — but you never see a debit or a credit
  unless you deliberately open the accountant view. ("Double-entry" just means
  every transaction is recorded in two places so the totals always have to
  match.)
- **Two transaction concepts, not five.** Money that already moved is a
  *transaction*; money that will move is an *invoice* (in) or a *bill* (out).
  That's it. No Bills-vs-Expenses-vs-Checks confusion.
- **About 30 categories, not 150 detail types.** A sensible default chart of
  accounts per business type, with an escape hatch for accountants.
- **Bring your own everything.** Your bank link, your payments key, your AI
  provider. OpenBooks never sits in the payment chain and can never rug-pull you.
- **Your data is a file you own.** Full export — spreadsheet, data file, and
  accountant-grade ledger export — at any time.

---

## The wedge: built for a portfolio of businesses

Most bookkeeping tools assume you have one company. Plenty of the people who most
need clean books — founders, operators, agency owners — run **several**.

OpenBooks treats that as the main case, not an afterthought:

- **Each business keeps its own legally-separate books.** That's what your
  accountant and the tax authorities expect.
- **Money you move between your own companies is recognized as a transfer** — never
  counted as income in one and an expense in the other.
- **A portfolio view rolls everything into one combined picture** and cancels out
  those inter-company transfers, so you see what you genuinely earned and spent
  across all of it, with no double-counting.

Nobody else combines a real ledger, bank and payments sync, an AI bookkeeper,
open source, self-host, **and** a true multi-business view. That gap is the whole
reason this exists.

---

## What's honest about where it is

This is a real product, launched in the open — not a finished, hands-off
autopilot. Being straight about that is part of the pitch:

- The AI **proposes** categorizations with a confidence score; **you approve**
  the uncertain ones from the Inbox. It is an assistant, not a replacement for
  your judgment.
- Some flows are further along than others, and the README ships a plain "what
  works / what's in beta / what's planned" status table that tells the truth
  rather than overselling.
- Because it's MIT-licensed and self-hosted, you can read every line, fork it,
  and keep running it on your own terms — forever.

---

## To you, if you're reading this

<!-- ANSAR INPUT: who you want to help and one sentence directly to them.
     E.g. "If you run two or three businesses out of one inbox and dread tax
     season, this is for you." Keep it plain and personal. -->

OpenBooks is free, open-source, and yours to run. Try the live demo with no login,
clone it, or self-host it — and tell me where it falls short. Every piece of
feedback turns into a fix in the open.

<!-- ANSAR INPUT: your sign-off — name, role, and one personal closing line.
     E.g. "— Ansar, building OpenBooks while running Zikra and Z360." -->

---

*OpenBooks is MIT-licensed. Try it: the no-login demo on the hosted instance.
Source and self-host instructions are in the README.*
