# Revenue Streams

Attribute income and expenses to **revenue streams** (service lines / business
lines — e.g. Web Dev, Digital Marketing, AI Dev) at the **record level**, learn
from confirmations, and see per-stream P&L on a dedicated module and via Ask AI.

> This supersedes the earlier category-tag design. Streams are **no longer**
> derived from ledger-account tags. A stream is an allocation on the record
> itself (transaction / invoice / bill), independent of its category.

---

## 1. Model

Each **transaction, invoice, and bill** can carry a `streams[]` split:

```ts
streams: [
  { streamLabel: "Web Dev", amountMinor: 50000 },
  { streamLabel: "Digital Marketing", amountMinor: 70000 },
]
```

- The split amounts **must sum to the record's total** (validated on every
  write via `normalizeStreamSplit`).
- **Category and stream are independent** — a transaction keeps its
  `categoryAccountId` for the ledger and, separately, its `streams` for
  attribution.

### Revenue vs cost, and no double-count

Per-stream P&L (`streamViews.streamPnl`) counts each economic event once:

- **Invoice** (non-draft/void) → revenue. **Bill** (non-void) → cost.
- **Transaction** → counted only when categorized to an **income** (revenue) or
  **expense** (cost) account. Settlement/transfer legs (AR/AP, bank) have
  non-income/expense categories and are therefore excluded — so an invoice's
  payment transaction never double-counts against the invoice.
- Records with **no** split feed `untaggedRevenueMinor` / `unallocatedCostMinor`
  (shared overhead), shown separately. Totals reconcile:
  `netIncome = Σ(stream profit) + untaggedRevenue − unallocatedCost`.

Direct-cost model: shared overhead (untagged expenses) is reported once, not
allocated across streams.

---

## 2. Data model (`convex/schema.ts`)

- `transactions.streams` / `invoices.streams` / `bills.streams` — the split.
- `transactions.streamReview` — `"auto" | "confirmed" | "needs_review"` (with a
  `by_entity_and_stream_review` index) + `transactions.streamRuleId`.
- `revenueStreams` — per-business registry of stream labels (stable list + CRUD).
- `streamRules` — learned rules: `merchantContains`, amount range, optional
  `memoKeywords`, `direction`, `split` (basis points, sum 10000), `confidence`,
  `timesConfirmed`, `timesCorrected`, `active`.

`ledgerAccounts.streamTag` remains in the schema but is **dormant** (the old
coupling; ignored by the new P&L).

---

## 3. Tagging — the split editor

`StreamSplitEditor` renders in the shared transaction detail drawer
(`CoreScreens.tsx` → `TransactionDetail`) and in the Needs Review tab.

- **Single stream** dropdown by default (whole amount → one stream).
- **"Split between streams"** expands to rows (stream + amount), with a live
  **Remaining** counter that turns green at exactly $0; Save is disabled until
  it balances.
- Saves via `streamTags.setTransactionStreams` — validates the sum, registers
  new labels, marks the tag `confirmed`, and **teaches the rule engine**.

Helpers: `convex/streams.ts` (`normalizeStreamSplit`, `splitFromBps`).

---

## 4. Rule engine (`convex/streamRules.ts`)

Learns a **merchant + direction** rule from every confirmed assignment:

- Stores amount range (±10%) and the split (basis points, scale-free).
- `computeStreamRuleConfidence(confirmed, corrected)` rises with clean
  confirmations, falls on correction; crosses the **0.90 auto-tag threshold**
  after ~3 clean confirmations.

Application:

- **New transactions** — the pipeline (`pipeline.ts`) schedules
  `applyStreamRulesToTransaction` post-commit. Best match ≥0.90 → **auto-tag**
  (`streamReview: "auto"`); below → **pre-fill the split + queue**
  (`streamReview: "needs_review"`). Never overrides a `confirmed` tag. This is
  the "AI suggests the historical split automatically" behaviour.
- **Batch** — `applyStreamRulesForEntity` backfills across recent transactions.

Queue API: `streamNeedsReview`, `streamNeedsReviewCount`,
`confirmStreamSuggestion`, `confirmAllStreamSuggestions`.

---

## 5. The Revenue Streams module

Nav item (`content.ts`), dispatched by `AppScreen.tsx` to `RevenueStreamsScreen`.

- **Hidden until a stream exists** (`useRevenueStreamsVisible` in `AppShell.tsx`)
  and hidden in portfolio ("all") scope; **unreviewed-count badge**
  (`RevenueStreamsBadge` ← `streamNeedsReviewCount`).
- **RBAC**: Owner / Admin / Accountant → all tabs + manage. **Member / HR →
  Overview + Ask AI only** (Manage / Needs Review hidden and guarded).

Tabs (`section-subtabs.ts` → `revenue-streams`):

| Tab | Backs onto |
| --- | --- |
| **Overview** | `streamViews.streamPnl` — per-stream revenue/cost/profit bars, period selector, untagged-revenue warning badge |
| **Needs Review** | `streamNeedsReview` — suggested-split chips, inline `StreamSplitEditor`, Confirm / **Confirm all AI suggestions**, Scan |
| **Manage** | `listStreamsDetailed` / `listStreamRules` + `createStream` / `renameStreamEverywhere` / `deleteStream` (reassign or untag) |
| **Ask AI** | embedded assistant, `contextLabel="Revenue Streams"`, suggested-prompt chips, `getStreamPnl` tool |

Rename cascades across the registry + all tagged records + rules. Delete asks
what to do with tagged records (**reassign** to another stream, or **untag**).

---

## 6. Ask AI

`aiChatTools.getStreamPnl` (wired in `aiChatRuntime.ts`) exposes per-stream P&L
to the assistant. Ask e.g. "Which stream was most profitable this quarter?" —
answers are ledger-derived, not estimated.

---

## 7. End-to-end flow

```
Open a transaction → assign / split its revenue stream (StreamSplitEditor)
        │ setTransactionStreams (validates sum, marks confirmed)
        ▼
reinforceStreamRule → learns merchant→split, confidence ↑
        │
New similar transaction → pipeline → applyStreamRulesToTransaction
        ├─ confidence ≥ 0.90 → auto-tag
        └─ below → Needs Review (pre-filled) → Confirm → confidence ↑
        ▼
streamViews.streamPnl reads transaction/invoice/bill splits
        ├─ Revenue Streams → Overview + Ask AI
        └─ Dashboard "Profit by stream" card (StreamPnlCard)
```

---

## 8. File reference

| Concern | File |
| --- | --- |
| Schema (splits, rules, registry) | `convex/schema.ts` |
| Split validation | `convex/streams.ts` |
| Tagging + Manage mutations/queries | `convex/streamTags.ts` |
| Rule engine + Needs Review | `convex/streamRules.ts` |
| Per-stream P&L | `convex/streamViews.ts` |
| Auto-apply hook | `convex/pipeline.ts` |
| AI tool | `convex/aiChatTools.ts` · `convex/aiChatRuntime.ts` |
| Split editor | `apps/web/src/components/openbooks/StreamSplitEditor.tsx` |
| Module (4 tabs) | `apps/web/src/components/openbooks/RevenueStreamsScreen.tsx` |
| Nav / badge / visibility | `apps/web/src/components/openbooks/AppShell.tsx` |
| Dashboard card | `apps/web/src/components/openbooks/CoreScreens.tsx` (`StreamPnlCard`) |
| Route / tabs registry | `content.ts` · `section-subtabs.ts` · `AppScreen.tsx` |

---

## 9. Limitations & notes

- **Direct-cost model** — shared overhead is unallocated, not split across
  streams.
- **Matcher** uses merchant + amount±10% + direction; `memoKeywords` are stored
  but not yet required in matching.
- **Accrual-ish, document-based** — `streamPnl` reads records (transactions /
  invoices / bills), not journal lines; bounded scan (`truncated` flag).
- **Invoices/bills** get streams via their own writers (extend as needed); the
  editor today lives on the transaction drawer.
- **Legacy** — the dashboard's old account-`streamTag` "Revenue by stream" card
  still exists but is vestigial (no UI sets `streamTag` now).
