# Outreach messaging templates (E15-T9)

Ready, consistent launch-day copy across channels. Every template states the
**MIT** license (consistent with the root `LICENSE`), links the no-login demo
(`openbooks.ansarullahanas.com/demo`) and the repo
(`github.com/<owner>/openbooks`), leads with the **portfolio + BYO-keys +
real-ledger** wedge, and avoids any claim contradicted by the README honest
status table. The `<owner>` placeholder and the launch URL match
`apps/web/src/lib/openbooks/brand-links.ts`.

> Tone: factual, non-hype, no emoji, no marketing ornament (AGENTS.md). "Beta"
> rows in the README status table are described honestly here, never as
> "working."

---

## 1. Show HN / open-source launch post

**Title:** Show HN: OpenBooks – free, open-source AI bookkeeping with a real
double-entry ledger and a multi-business portfolio view

**Body:**

> OpenBooks is free, open-source (MIT), bring-your-own-keys bookkeeping for small
> businesses. You connect your bank (Plaid), payments (Stripe), or a CSV, and an
> AI bookkeeper running on **your own** model key keeps a real double-entry
> ledger. The one rule that governs everything: AI proposes, the ledger engine
> posts. Confident transactions post automatically; anything uncertain waits in
> an Inbox for a one-click confirm — and that answer becomes memory.
>
> The thing I couldn't find anywhere else: it's built for people who run **more
> than one** business. Each company keeps its own legally-separate books, and a
> single portfolio view rolls them all up with the money you moved between them
> netted out — so no double-counting across your LLCs.
>
> Honest about status: this is a real, working product, not a hands-off
> autopilot. The ledger, AI categorization cascade, reports straight from the
> ledger, the portfolio roll-up, and BYO AI keys (14-provider catalog, encrypted
> at rest) are working. Stripe payout reconciliation and Plaid live sync are in
> beta — the code paths are complete but they're pending real-webhook / live-Link
> proof. The README ships a plain "what works / what's beta / what's planned"
> table.
>
> No Docker image — the stack is Convex (cloud) + Next.js, self-hostable on your
> own deployment. Your keys and data live in your deployment, encrypted at rest;
> OpenBooks never sits in the payment chain.
>
> Try it with no login (read-only, resets daily): openbooks.ansarullahanas.com/demo
> Code + self-host instructions: github.com/<owner>/openbooks
>
> Feedback very welcome — especially from anyone running a portfolio of small
> companies.

---

## 2. X / LinkedIn thread (the two-engines story)

1. I got tired of paying QuickBooks + a bookkeeper to keep books I never looked
   at — and watching "managed" services like Bench shut down overnight. So I
   built OpenBooks: free, open-source AI bookkeeping you actually own. 🧵 (no — no
   emoji; drop that.) Thread:

   *(use without the emoji — "Thread:")*

2. The core idea is two engines. On top, a plain-English layer an owner can read:
   transactions, an Inbox, reports, "ask your books anything." Underneath, a
   strict double-entry ledger that posts balanced journal entries. The rule
   between them: AI proposes, the ledger posts.

3. To make the plain-English layer honest, I basically reverse-engineered how
   QuickBooks thinks — chart of accounts, cash vs accrual, payout reconciliation,
   period close — and rebuilt it as a ledger you never have to look at unless you
   want to. Your CPA gets real statements, not a spreadsheet export.

4. The AI runs on **your** key (OpenAI, Anthropic, Google, Bedrock, Ollama-local
   — 14 providers). It categorizes via rules → your past corrections → the model,
   cheapest signal first. Confident items post; the rest wait in an Inbox. Every
   correction becomes memory.

5. The wedge: it's built for people who run several businesses. Each keeps its
   own clean books; one portfolio view rolls them up and cancels out the money
   you moved between your own companies — so you see what you actually earned
   across everything.

6. Being straight about where it is: ledger, categorization, ledger-derived
   reports, the portfolio view, and BYO keys are working. Stripe payout
   reconciliation and live Plaid sync are in beta (code complete, pending
   real-webhook / live-Link proof). The README has the full honest table.

7. It's MIT-licensed and self-hostable — your keys and data live in your own
   Convex/Vercel deployment, encrypted at rest. No vendor can rug-pull your
   records.

8. Try it with no login (read-only, resets daily):
   openbooks.ansarullahanas.com/demo · Code: github.com/<owner>/openbooks · If
   you run a portfolio of small companies, I'd love your feedback.

---

## 3. Cold DM to a small-business owner

> Hey {name} — saw you're running {business} (and {second business}?). Quick one:
> how are you keeping the books across them right now? I built a free,
> open-source tool that connects your bank/Stripe and uses AI to keep real
> double-entry books for you — and it handles multiple businesses in one place,
> with the money you move between them netted out so nothing's double-counted.
> It's bring-your-own-keys, so it costs you a few dollars of AI usage, not a
> $500/month bookkeeper. There's a no-login demo if you want to see it in 2
> minutes: openbooks.ansarullahanas.com/demo. Happy to help you get your own set
> up — no pitch, I just want feedback from people who run more than one thing.

---

## 4. One-paragraph README / social blurb

> **OpenBooks** is free, open-source (MIT), AI-assisted bookkeeping for owners
> who run more than one business. Connect your bank, Stripe, or a CSV; an AI
> bookkeeper on your own model key keeps a real double-entry ledger and only asks
> you about the uncertain items. Each business keeps its own books, and a
> portfolio view rolls them up with inter-company transfers netted out.
> Bring-your-own-keys, encrypted at rest, self-hostable — your data stays yours.
> Try the no-login demo at openbooks.ansarullahanas.com/demo.

---

## 5. Subreddit variants

**r/smallbusiness:**

> I built a free, open-source AI bookkeeper because QuickBooks + a bookkeeper was
> costing me ~$500/month for books I never looked at — and I run two businesses,
> which every tool treats as an afterthought. OpenBooks connects your bank/Stripe
> (or a CSV), categorizes everything with AI, and keeps real double-entry books
> your accountant can read. It handles multiple businesses with a portfolio view
> that nets out transfers between them. You bring your own AI key, so it costs a
> few dollars of usage, not a subscription. No-login demo:
> openbooks.ansarullahanas.com/demo. It's MIT-licensed; honest about what's still
> in beta (Stripe reconciliation, live Plaid sync). Would love feedback from
> other owners.

**r/selfhosted:**

> OpenBooks — self-hostable, open-source (MIT) AI bookkeeping. Stack is Convex
> (cloud backend) + Next.js; no Docker image, you point it at your own free
> Convex deployment and host the web app on Vercel or locally. All credentials
> (AI, Plaid, Stripe, Plunk) live in your deployment in one encrypted-at-rest
> store; keys are never returned to the client. Bring your own keys; live Plaid
> and live Stripe are supported (not sandbox-only). Honest status table in the
> README — ledger/categorization/reports/portfolio work; Stripe payout
> reconciliation and live Plaid sync are beta pending external proof. Code +
> setup: github.com/<owner>/openbooks. The public no-login demo is a
> hosted-instance feature and is OFF by default on self-hosted instances.

---

## "Do not say" guardrails

Keep every line defensible against the README honest status table and the
security posture. Do **not** say:

- ❌ "Fully automated books" / "set it and forget it" / "no human needed." → AI
  **proposes**; the owner approves the uncertain items.
- ❌ "Your accountant is guaranteed to accept it." → Say "accountant-grade
  records / real double-entry statements," not a guarantee about a third party.
- ❌ "Stripe reconciliation works end-to-end on live data" / "full real-data
  posting is done." → Those are **beta** (pending real-webhook / live-Link
  proof). Say "in beta."
- ❌ "Pasting your live bank/Stripe keys is risk-free / 100% secure." → It is
  **fine** to say live connectors are supported locally with encryption-at-rest
  and an HTTPS requirement (Decision Q16); do **not** imply zero risk or
  overclaim security.
- ❌ "One `docker compose up`" / any Docker install path. → Convex + Next.js,
  self-host on your own deployment (Decision Q83).
- ❌ "Up to 24 months of history." → "As far back as your bank allows — you
  choose your start date" (Decision Q19).
- ❌ "$0/month forever" as an absolute. → The software is $0; you pay your own
  AI/Plaid usage.
- ❌ Multi-currency general-ledger claims. → The GL is USD-only; the only FX
  surface is payroll convert-to-USD (Decision Q3).
- ❌ Linking `github.com/<owner>/open-accounting` (old slug) or a bare Vercel
  URL when the alias is live. → Use `openbooks` and
  `openbooks.ansarullahanas.com` (Decisions Q80/Q85).
- ❌ Emoji or hype ornament (AGENTS.md tone).

## Consistency anchor

If the README status table changes a row from beta → working (or vice versa),
update the matching sentence in templates 1, 2, and 5. All license/demo/repo/URL
strings come from `apps/web/src/lib/openbooks/brand-links.ts` and the root
`LICENSE` — change them there, then sweep these templates.
