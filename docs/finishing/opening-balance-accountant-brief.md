# Opening Balances — Brief for Accounting Review

**Prepared for:** an accountant / bookkeeping professional
**Subject:** opening balances and mid-life conversion in OpenBooks
**Date:** 2026-08-13

---

## About the product

OpenBooks is small-business bookkeeping software.

- **United States, USD only.** No multi-currency, no FX.
- Users convert **mid-life from no prior accounting system** — typically a bank feed and
  a folder of receipts, not a trial balance from another package.
- The general ledger is **double-entry and immutable**. Corrections are posted as
  reversals; posted entries are never edited or deleted.
- Bank data arrives through Plaid, which returns **only the current balance** plus roughly
  24 months of transactions. A balance "as at 1 January" cannot be retrieved from the bank
  — it can only be calculated.

---

## The problem we found

### What the software was doing

When a user connected their bank, the software took the bank's **current** balance and
posted it as the opening balance, dated at the start of their chosen bookkeeping period:

> `Dr Bank / Cr Opening Balance Equity` — for the balance as at **today**, dated **1 January**

It then separately imported **two years** of transactions from that same bank account, each
of which also posted to the ledger.

### Why that is wrong

The bank account is debited twice for the same money: once by the opening entry, and again
by every transaction that made up the movement since the start date.

```
Ledger cash  =  balance today  +  all activity since the start date
Actual cash  =  balance today
```

A worked example — books starting 1 January, bank holding $80,000 on that date and $95,000
today, with $15,000 of net receipts in between:

| | Correct | What the software produced |
|---|---|---|
| Opening entry, 1 Jan | 80,000 | **95,000** (today's balance) |
| Activity since 1 Jan | +15,000 | +15,000 |
| **Ledger cash today** | **95,000** ✓ | **110,000** ✗ |

Cash and Opening Balance Equity were both overstated by the full net movement of the
imported period.

### Why nobody caught it

**The books still balanced.** Debits equalled credits on every entry, so every internal
consistency check passed. The error is only visible by comparing the ledger against the
bank statement, which the software was not doing. Users saw a plausible-looking balance
sheet that was materially wrong.

### A second, related problem

Users who had already set up their books could later choose a "start my books on" date.
The software then hid earlier transactions from *some* screens but not others — so the
same business showed roughly $300,000 of revenue on one screen and $80,000 on another.
That inconsistency has now been fixed. It is not the subject of this review, but it is how
the first problem was discovered.

---

## How we are resolving it

Four changes. **Questions 1–5 below ask whether these are the right accounting positions.**

### 1. The bank balance is never treated as an opening balance

Plaid's reported balance is stored only as a **reconciliation reference** — the figure we
compare the ledger against to confirm the books tie to the bank. It is never posted.

### 2. The owner supplies the opening balance, and it is mandatory

The owner enters their opening bank balance explicitly, as they would in QuickBooks or
Xero. To make this practical rather than a barrier, we **pre-fill a calculated suggestion**:

> opening balance = current bank balance − all transactions dated on or after the start date

The owner confirms or corrects it against their statement. **Nothing posts unconfirmed.**

If the owner declines to enter one, we do **not** fall back to the current balance — that
reproduces the original error. Instead we offer either to start their books **today** (where
the current balance is correct by definition), or to post nothing and mark the books
visibly incomplete until they supply the figure.

### 3. Pre-conversion activity is excluded from the books, but kept

Transactions dated before the books-start date are not posted to the ledger. They remain
readable in an "Archived" view rather than being deleted — the same posture QuickBooks
takes with excluded bank-feed rows, and Xero with pre-conversion periods.

### 4. Opening receivables and payables are re-established

An invoice issued before the start date and still unpaid represents a genuine asset at the
conversion date. We reverse the prior-period **revenue** but bring the **receivable** onto
the opening balance sheet. Mirrored for unpaid bills.

**This is the change we are least certain about — see Question 2.**

---

## Questions

### Q1 — The opening balance figure

*Lower priority. We believe this is now close to standard practice.*

The owner enters their opening balance; we pre-fill a suggestion calculated by working
backwards from today's bank balance, and they confirm or correct it.

> **Is a pre-filled, owner-confirmed opening balance acceptable for a mid-life conversion,
> or should the owner enter the figure unaided from their bank statement?**

*Context:* we understand QuickBooks and Xero both ask the owner for this figure with no
suggestion. We are proposing to pre-fill it because our users are converting from no prior
system and often do not have a statement to hand during setup.

---

### Q2 — Opening Accounts Receivable and Payable ⚠️ **most important**

For an invoice issued **before** the books-start date and still unpaid, we propose to
reverse the prior-period revenue and re-establish the receivable as part of the opening
balance:

> `Dr Accounts Receivable / Cr Opening Balance Equity` — for the amount outstanding at the
> conversion date

Mirrored for unpaid bills (`Dr Opening Balance Equity / Cr Accounts Payable`).

> **Is that the correct treatment for a mid-life conversion?**
>
> **And for an invoice that was partially paid before the start date — do we bring it in at
> its outstanding balance, or exclude it entirely?**

*Why we are asking:* if we exclude these entirely, a converted business understates its
assets and loses sight of money it is still owed. If we include them incorrectly, the
opening balance sheet is wrong. **We have no settled position on partial payments at all.**

---

### Q3 — Opening Balance Equity

We treat Opening Balance Equity as a **suspense account**. Once setup is complete, if it
still carries a balance we flag it to the owner and offer a manual close-out entry.

> **Should closing out Opening Balance Equity be owner-initiated, or should the software do
> it automatically?**
>
> **And should it post to Retained Earnings, or to Owner's Capital for a sole proprietor or
> single-member LLC?**

*Why we are asking:* we currently make no distinction by entity type, and we suspect that
is wrong.

---

### Q4 — The conversion date

We propose restricting the books-start date to the **first day of a month**, following
Xero's conversion-date rule. QuickBooks permits any date.

> **Is month-start-only appropriate for small businesses, or should a mid-month start be
> allowed despite splitting the tax period?**

---

### Q5 — Scope of the opening balance

Xero requires a full trial balance at conversion — every account. We capture **cash,
accounts receivable and accounts payable only**. Fixed assets, loans, inventory and
prepayments are not captured, and would remain visible as a balance in Opening Balance
Equity.

> **Is that an acceptable simplification for a small service business?**
>
> **What should we warn the owner about when we prompt them to close out Opening Balance
> Equity?**

*Why we are asking:* this is a deliberate limitation — our users generally have no trial
balance to import. We want the disclosure to be honest about what is missing.

---

## Priority

| Question | Urgency | If the answer is "no" |
|---|---|---|
| **Q2** | **Blocks development** | Changes the ledger entries we post, and the repair of existing books |
| Q1 | Low | Onboarding gains a manual statement-entry step |
| Q3 | Can follow | Close-out target becomes dependent on entity type |
| Q4 | Can follow | Revert to allowing any date |
| Q5 | Can follow | A full trial-balance import becomes a prerequisite |

**Q2 is the one we need answered to proceed.** The others can be settled while development
continues, without rework.
