# Bank reconciliation & period close (E1-T12)

OpenBooks now ships a real bank-reconciliation workflow plus a period-close UI,
so "reconciled books" stops being aspirational.

## Model

- `bankReconciliations` table anchors a reconciliation on a **statement ending
  balance + ending date** (`status: open | completed`). One open reconciliation
  per bank account at a time.
- Cleared state lives on the **transaction**, not the reconciliation row:
  `transactions.reconciliationId` + `transactions.clearedAt` (decision Q6). This
  keeps the cleared-balance query a single indexed scan and scales for big books.
- The **cleared book balance is derived from the ledger** — the normal balance of
  the bank's ledger account over the journal lines of cleared transactions — so
  the worksheet can never drift from the posted books.

## Workflow (convex/reconciliation.ts)

1. `startReconciliation(bankAccountId, statementEndDate, statementEndBalanceMinor)`
2. `toggleTransactionCleared(reconciliationId, transactionId, cleared)` — stamps /
   clears the per-transaction marker.
3. `addAdjustingEntry(reconciliationId, kind: "fee" | "interest", amountMinor)` —
   posts a **balanced, reversible** entry through `postLedgerEntryCore` (Dr Bank
   Fees / Cr Bank for a fee; Dr Bank / Cr Interest Income for interest). Never a
   raw balance edit. Each adjustment is recorded as a cleared transaction so it
   moves the cleared balance immediately.
4. `completeReconciliation(reconciliationId)` — **refuses unless
   differenceMinor === 0** (statement balance − cleared book balance), QBO's
   non-negotiable $0.00 gate. On success it flips the row to `completed`.
5. `reconciliationWorksheet(reconciliationId)` returns the statement balance,
   cleared book balance, running difference, `canComplete`, and the cleared /
   uncleared line lists.

## Period close

The existing "Close the books" card on Reports surfaces `ledger.setPeriodLock`
and reads `reportViews.reportPeriodLock`. Posting into a locked range is rejected
by `postLedgerEntryCore`'s period-lock guard (`ledger.ts`) — which now also blocks
reconciliation adjusting entries dated on/before the lock.

## Authorization

Every mutation and query re-checks workspace/entity authorization
(`getEntityForWrite` / `requireWorkspaceRole` for writes, member role for reads)
and validates the transaction belongs to the reconciliation's bank account and
entity.
