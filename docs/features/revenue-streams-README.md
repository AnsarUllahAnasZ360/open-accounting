# Revenue Streams — How it works

A plain-language guide to attributing your income and costs to **revenue
streams** (your service lines / business lines) and seeing the profit each one
makes.

> Example: **Z360** works across **Web Dev**, **Digital Marketing**, and
> **AI Dev**. Tag your money to those streams and you can answer, at month end,
> "which line actually made money, and how much?"

---

## The idea in one minute

- A **stream** is just a label you attach to money — e.g. "Web Dev".
- You tag **transactions, invoices, and bills** to streams. A single record can
  be **split** across several streams (e.g. a $1,200 payment = $500 Web Dev +
  $700 Digital Marketing).
- OpenBooks then shows **per-stream profit** (what each stream earned minus its
  direct costs) — on the Dashboard and in a dedicated **Revenue Streams** area.
- It **learns**: once you've confirmed how a client's payments are usually
  split a few times, it starts tagging similar payments for you automatically.

A stream is separate from a **category**. Categories are your chart of accounts
(what kind of income/expense it is); streams are which part of the business it
belongs to. A transaction has both, independently.

---

## Getting started

1. **Open a transaction.** Go to **Transactions** (or Inbox) and click any row
   to open its detail panel.
2. **Find "Revenue stream."** Below the category, there's a Revenue stream box.
   - Type a stream name (e.g. "Web Dev") and **Save** — the whole amount goes to
     that stream.
   - Or click **"Split between streams"** to divide the amount across several
     streams. A live **Remaining** counter turns green when the split adds up to
     the full amount; you can't save until it balances.
3. That's it — the stream now exists and starts appearing in your reports.

You can also create streams up front in **Revenue Streams → Manage** without
tagging anything first.

---

## The Revenue Streams area

Open **Revenue Streams** from the left sidebar. Its sections appear as links
under that menu item:

### Overview
Your per-stream **profit-and-loss** for the period you pick (this month /
quarter / year):
- Each stream's **revenue**, **direct cost**, **profit**, and **margin**.
- A green bar shows the profit share of each stream's revenue.
- An **"untagged revenue"** warning if some income hasn't been assigned to a
  stream yet.
- Shared overhead (costs you didn't tag to any stream — rent, salaries) is shown
  separately, not forced onto a stream.

### Needs Review
The queue of transactions OpenBooks **suggested** a stream for but isn't
confident enough to apply on its own:
- Each row shows the suggested split. **Confirm** it, or **Edit** to correct it.
- **Confirm all AI suggestions** clears the whole queue at once.
- **Scan for suggestions** re-checks recent transactions against what it's
  learned.
- The number of items waiting shows as a badge on the sidebar menu item.

### Manage
Run your streams:
- **Add** a new stream.
- **Rename** a stream — it updates everywhere it's used (all tagged records and
  learned rules), amounts untouched.
- **Delete** a stream — you're asked what to do with records tagged to it:
  **reassign** them to another stream, or **untag** them.
- See all the **learned rules**: which merchant maps to which split, the
  confidence level, and whether it auto-tags yet.

### Ask AI
A chat focused on stream analysis, with ready-made prompts:
- "Which stream was most profitable this quarter?"
- "Compare my streams over the last 3 months."
- "What % of my revenue is untagged?"

The assistant reads the real ledger-backed per-stream numbers — it doesn't guess.

---

## How the automatic tagging learns

Every time you **confirm** a stream on a transaction, OpenBooks remembers the
pattern: *this merchant, around this amount, usually splits this way.*

- Each clean confirmation raises that rule's **confidence**.
- After a few consistent confirmations it crosses a threshold and starts
  **auto-tagging** similar transactions — no review needed.
- If you **correct** it, confidence drops and it goes back to asking you first.

So the more you use it, the less tagging you do by hand.

---

## How the profit math works (and stays honest)

- **Revenue** comes from your **invoices** and any **income** transactions you
  tag.
- **Direct cost** comes from your **bills** and any **expense** transactions you
  tag.
- **Profit per stream** = its revenue − its direct costs.
- **Shared overhead** (untagged expenses) is listed once on its own, not split
  across streams by a formula — so the numbers are ones you can explain.
- Everything reconciles: the streams plus untagged revenue minus overhead equals
  your net income.

Money that's just moving (a bank transfer, or the deposit that settles an
invoice you already tagged) is **not** counted twice — only the original income
or expense is.

---

## Who can do what

- **Owner / Admin / Accountant** — full access: tag, confirm, and manage streams
  and rules.
- **Member / HR** — can view **Overview** and use **Ask AI**, but can't manage
  streams or confirm tags.

Revenue Streams are **per business** — pick a single business (not "All
businesses") to work with its streams.

---

## Quick tips

- Tag revenue on the **invoice** (not the payment that settles it) to avoid
  confusion — the payment is just money arriving.
- Leave genuinely shared costs (rent, your salary, general software) **untagged**
  — they'll show as overhead rather than distorting a single stream.
- Check **Needs Review** every so often, or hit **Confirm all** when the
  suggestions look right — that's what trains the auto-tagging.

---

For the technical/implementation reference, see
[`revenue-streams.md`](./revenue-streams.md).
