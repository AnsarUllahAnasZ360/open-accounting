# OpenBooks 3-minute demo-video script (E15-T8)

The single highest-leverage launch asset: a tight ≤3:00 walkthrough that shows
**only flows that actually work**, follows the arc connect → AI categorizes →
approve → reports + Ask AI → portfolio, and ends on the multi-LLC portfolio
differentiator.

**Record against the shared no-login demo workspace** (`/demo`, seeded by
`convex/seedDemo.ts`) for scenes 1–5, and the **2-business local dev workspace
(Zikra + Z360)** for the portfolio finale — see the
[recording prerequisites](#recording-prerequisites-read-before-shooting) for why
and how. Launch URL: `openbooks.ansarullahanas.com`; repo:
`github.com/<owner>/openbooks`.

---

## Scene table (total 3:00)

| # | Time | Route / screen | On-screen action | Narration | On-screen caption |
|---|---|---|---|---|---|
| 0 | 0:00–0:12 | `/` landing (or a clean title card) | Hold on the hero, then cut to the app. | "If you run a small business, your books are either expensive, a mess, or both. OpenBooks is a free, open-source AI bookkeeper that keeps a real set of books for you — and you bring your own keys." | **OpenBooks — your books, always done.** |
| 1 | 0:12–0:40 | `/demo` → Dashboard, then Settings → Connections | Land on the populated dashboard; pan to the Connections cards (Banks / Stripe / AI). | "Connect a bank through Plaid, payments through Stripe, or just drop in a CSV. Everything syncs in on its own — as far back as your bank allows. This is a live demo with seeded data; no login, nothing you do is saved." | **Connect: Plaid · Stripe · CSV** |
| 2 | 0:40–1:15 | Transactions register | Scroll the register; point at the AI category + confidence on each line; click a high-confidence line to show it posted automatically. | "An AI running on your own model key categorizes every transaction — rules first, then memory of your past corrections, then the model. Confident calls post straight to the ledger. The confidence is shown on every line." | **AI categorizes — confident items post automatically** |
| 3 | 1:15–1:45 | Inbox | Open an uncertain Inbox item; show the "why this suggestion" evidence; confirm it with one click; show it disappear. | "The handful it isn't sure about wait in your Inbox. You see why it suggested what it did, confirm with one keystroke — and that answer becomes memory, so the same question never comes back." | **You approve the uncertain ones — one keystroke** |
| 4 | 1:45–2:20 | Reports (Monthly Review → P&L) + Ask AI panel | Open Monthly Review, then P&L; toggle cash/accrual; drill one number to its source lines. Open Ask AI and type "Who owes me money right now?"; show the answer. | "Because there's a real double-entry ledger underneath, the statements are correct — P&L, Balance Sheet, Cash Flow, the kind your CPA accepts. And you can just ask: who owes me money, how did this month compare, what did Stripe take in fees." | **Real statements + Ask AI — straight from the ledger** |
| 5 | 2:20–2:40 | Income → Stripe payout detail | Show a Stripe payout deposit split back into gross revenue by customer minus fees, reconciled. | "Stripe pays you one lump deposit. OpenBooks splits it back into gross revenue by customer, minus fees, and reconciles it to the bank — automatically." | **Stripe payouts reconciled — gross, fees, net** |
| 6 | 2:40–3:00 | Portfolio scope → portfolio dashboard (Zikra + Z360) | Switch the business switcher to **All businesses**; show the portfolio dashboard rolling up both LLCs with inter-company transfers netted out. End on the combined number. | "And if you run more than one business, this is the part nobody else does: each company keeps its own clean books, and one portfolio view rolls them together — with the money you moved between them cancelled out. It's free, open source, and yours. Star it on GitHub, or try the live demo." | **Portfolio: every business, one honest picture** → **openbooks.ansarullahanas.com · MIT** |

---

## Opening hook and closing CTA

- **Hook (scene 0):** "Your books are either expensive, a mess, or both."
- **Closing CTA (scene 6):** "It's free, open source, and yours. Star it on
  GitHub (`github.com/<owner>/openbooks`), or try the live demo at
  `openbooks.ansarullahanas.com/demo` — no login."

Keep the CTA consistent with the corrected MIT license, the `openbooks` repo
name, and the `/demo` entry point (E15-T2/T6).

---

## What each scene depends on (flows that work today)

| Scene | Flow | Works today? | Note |
|---|---|---|---|
| 1 | Connections cards visible, seeded feeds | ✅ on `/demo` | `seedDemo.ts` seeds bank + Stripe + AI activity |
| 2 | AI categorize + confidence on register | ✅ | provider-agnostic categorizer; confidence shown per line |
| 3 | Inbox confirm + "why this suggestion" | ✅ | confirm-to-memory loop is live |
| 4 | Reports (Monthly Review/P&L), cash/accrual, drill-down, Ask AI | ✅ | ledger-derived; CSV==screen parity landed (E6) |
| 5 | Stripe payout split + reconciliation | ✅ in demo | The in-transit clearing model (V2) is built and wired; the matcher was calibrated this sprint (E1). On **real data** it still needs a real Stripe webhook delivered to the cloud route for end-to-end proof — so record this scene **only against the demo workspace**, not a live Stripe account, unless that webhook proof has landed. |
| 6 | Portfolio / multi-LLC roll-up with inter-company elimination | ✅ but **not on `/demo`** | The public demo seeds a **single** entity (`acme-studio-llc`). Record the portfolio finale on a **2-business local dev workspace** seeded with Zikra + Z360. See prerequisites. |

---

## Recording prerequisites (read before shooting)

1. **Two recording environments.**
   - Scenes 0–5: the hosted **`/demo`** workspace (single business, seeded,
     read-only, daily 08:00 UTC reset). Fresh, deterministic, no real secrets.
   - Scene 6 (portfolio): a **local dev workspace with two businesses**
     (Zikra + Z360). The public `/demo` is single-entity, so the portfolio view
     cannot be demonstrated there. Boot `pnpm dev:full`, create the two
     businesses in onboarding (or seed them), then switch the business switcher
     to **All businesses**.
2. **Seed fresh demo data** before scenes 1–5 (or just record shortly after the
   daily reset) so the numbers are clean and consistent.
3. **Hide every real secret.** Record against demo / dev data only. Never show a
   real Plaid token, Stripe key, AI key, or a real customer's financial data on
   screen. The credentials UI only ever shows a key preview, but double-check no
   `.env.local` or terminal with secrets is captured.
4. **Re-verify the payout-match scene (scene 5) against the live build** once
   E1's reconciliation tickets are confirmed merged before showing any
   payout-match on **real** data (Decision Q84 — publish the honest status only
   after the E1–E7 fixes land). On the demo workspace it records truthfully today.
5. **Window + font.** Record at 1280×800 (desktop) with default font scaling;
   the UI is tuned for that width. For a mobile cut, record a 390px-wide viewport
   of Dashboard / Inbox / Ask AI.
6. **Runtime budget.** Keep the total at or under 3:00. If a scene runs long, cut
   from scene 2 (categorize) first — it's the most self-evident.

## Recording checklist

- [ ] Demo data freshly seeded (scenes 1–5) / two businesses present (scene 6).
- [ ] No real secret, token, or real customer financial record visible anywhere.
- [ ] Window 1280×800, default font scale; mobile cut at 390px if used.
- [ ] Scene 5 (payout match) verified against the current build, or recorded
      against the demo workspace only.
- [ ] CTA names the `openbooks` repo + `openbooks.ansarullahanas.com` + the
      `/demo` link, and says MIT.
- [ ] Total runtime ≤ 3:00; ends on the portfolio view.
