# Acceptance Walkthrough — "Is v1 real?"

Date: 2026-06-11 (rev 2)
Who runs it: Ansar in the morning (no code reading required). Codex mirrors
every numbered check in the Playwright suite (`pnpm test:e2e`) and captures a
screenshot per check into `docs/initiation/evidence/` during M13.

URL: `https://openbooks.ansarullahanas.com` (fallback: the Vercel deployment
URL recorded in the completion report; last resort: `pnpm dev` locally).

---

## A. Access & auth

1. **Landing** — page loads on desktop and on a phone; OpenBooks design
   language (green `#2ca01c`, Geist, calm white surfaces); submit the
   request-access form with a test email → success state (lead visible in
   Settings → Leads or Convex dashboard).
2. **No public sign-up** — attempting to register with a random email is
   rejected and routed to request-access.
3. **Owner login** — sign in with `OWNER_EMAIL` + the `OWNER_PASSWORD` you
   chose in `.env.local` before launch (no handoff needed) → you land on the
   Dashboard.

## B. Demo books (entity: Acme Studio LLC)

4. **Dashboard** — cash position with sparkline, P&L snapshot with delta,
   inbox count, AR and AP widgets, expense donut, income by customer, cash
   flow bars, payroll widget, activity feed — all populated from 12 months of
   demo data; change the period selector → numbers change; click any number →
   it drills through to the underlying view.
5. **Inbox** — open items across multiple card types (categorize, receipt,
   transfer, payout, AI question). Confirm one suggestion (Enter), correct
   another (pick a different category → offered "always do this" rule),
   batch-confirm the rest of the high-confidence group → count drops, books
   update.
6. **Transactions** — filter by account and category; search; open a row →
   drawer shows details and an **accounting view** with balanced debit/credit
   lines; recategorize it → activity history shows reversal + repost (audit
   trail, not an edit); split one transaction; exclude one as personal.
7. **Invoices & Bills** — invoice list shows open/overdue with aging; bills
   grouped by due window; mark a seeded bill paid → it matches a bank
   transaction.
8. **Contacts** — directory with customers/vendors; open a profile → totals,
   open balance, transaction history.
9. **Payroll** — employees in USD, PKR, INR; open a monthly run → per-line
   amounts, FX rates, base-currency totals; statement view prints cleanly and
   exports CSV.

## C. Reports & export

10. **Reports** — Monthly Review for a seeded month reads like a one-page
    story (in / owed / owe / out / payroll); P&L by month matches dashboard;
    Balance Sheet shows **Balanced ✓**; Cash Flow groups operating/investing/
    financing; AR/AP aging buckets render; Trial Balance difference is 0.
    Toggle cash ⇄ accrual on the P&L → AR/AP-dependent numbers change.
    Export P&L to CSV → totals match the screen.
11. **Data export** — Settings → Data → export produces a CSV bundle/JSON
    you can open.

## D. Live connections (entity: Live Sandbox)

12. **Plaid sandbox** — Settings → Connections → Connect bank → Link opens →
    log in with `user_good` / `pass_good` (or the custom sandbox user noted
    in the report) → select accounts → sync runs → transactions appear in the
    register, categorized by the pipeline.
13. **Stripe test** — connection shows green; customers/charges/invoices
    synced; open the payout drill-down → one payout splits into gross
    revenue − fees; create an invoice in the composer → "Send via Stripe" →
    hosted invoice URL exists (verifiable in the Stripe test dashboard).

## E. AI

14. **Chat** — open the AI panel; ask: "How did we do last month vs the month
    before?", "Who owes me money right now?", "Top 5 expense categories this
    quarter?", "How much did Stripe take in fees this year?", "What's my
    monthly payroll cost in USD?" → answers match the corresponding reports.
    Ask it to categorize an uncategorized transaction → confirmation card →
    confirm → transaction posts and the audit log attributes it to AI.
15. **Receipts** — upload a receipt image → extracted vendor/date/amount →
    match suggestion appears (Inbox or on the transaction) → confirm.

## F. Quality gates (spot checks)

16. **Mobile** — Dashboard, Inbox, Transactions, and chat are genuinely usable
    at phone width (bottom tab bar, no horizontal scroll).
17. **Audit log** — Settings → Audit log shows who/what/why for recent posts
    (user, rule, or AI + reasoning).
18. **Honesty check** — `docs/initiation/completion-report.md` acceptance
    table: every row above is WORKING / PARTIAL / BLOCKED with evidence
    links, and PARTIAL/BLOCKED rows have a concrete next step.

Pass bar: A–C and E.14 fully working; D working with the sandbox-reality
caveats in goal.md §5; any failures honestly documented. If a check fails,
note the row number in your reply to Codex — each row maps to a milestone in
task-list.md.
