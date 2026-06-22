# R4 — Multi-LLC Portfolio View + Intercompany Elimination (USD-only)

Research owner: R4-multientity-intercompany
Date: 2026-06-17
Status: decision-ready. Resolves the portfolio/intercompany open questions for the launch-sprint rebuild.

Contract anchors: ANSAR-DECISIONS.md #3 (USD-only ledger, delete general FX), #6 (intercompany
detect + eliminate; two views — single-company and unified/portfolio), #7 (user-chosen history),
plus the accounting-engine diagnosis correction: **separate LLCs legally need separate ledgers; the
"unified view" is an ADDITIVE roll-up, NOT a merge of two ledgers.**

---

## Recommended decisions

These are the concrete choices OpenBooks should adopt. Each is a value, not an option list.

### Data model & scoping

1. **Keep one ledger per entity. Do not merge ledgers.** The existing schema is already correct:
   `workspace → entities[] → (ledgerAccounts / journalLines / bankAccounts) keyed by entityId`. A
   legal LLC is a tax/legal reporting boundary; QBO and Xero both enforce one company file per
   entity. The portfolio is a *read-time aggregation layer* over per-entity ledgers, never a third
   ledger.

2. **Add a `Portfolio` scope selector above the entity switcher: `All / Zikra / Z360`** (generated
   from the workspace's non-archived entities). `All` = consolidated/roll-up view. A specific entity
   = the standalone statutory view. This replaces the "filter by business type" control Ansar
   dislikes. Scope is a UI/query parameter, not stored state on rows.

3. **Use a shared chart-of-accounts spine across entities for roll-up.** Roll-up sums accounts that
   share `code` + `type` + `name` (QBO/LiveFlow's hard prerequisite: "account naming mismatches
   break the consolidated P&L"). OpenBooks already seeds one canonical chart, so this is satisfied by
   construction — keep it that way: when an entity is created, clone the canonical chart codes; do
   not let per-entity ad-hoc account names diverge for system accounts. Roll-up groups by account
   `code` (the stable key), falling back to `(type,name)`.

### Intercompany detection signal (the core recommendation)

4. **Detect intercompany by "owned counterparty account," not by a manually-flagged GL account.**
   This is OpenBooks' structural advantage over Fathom/Joiin/QBO: those tools see only one entity's
   ledger at a time and therefore require the *user* to manually tag intercompany accounts. OpenBooks
   holds **both entities' raw bank feeds in one database** (`bankAccounts.entityId`), so it can
   auto-detect. The detection rule:

   > A bank transaction is **intercompany** when it is one leg of a money movement whose other leg
   > lands in a `bankAccounts` row owned by a *different entity in the same workspace*, confirmed by
   > an offsetting transaction (opposite sign, matching amount within tolerance, near-same date).

5. **Primary signal = the existing transfer matcher, widened across entities.** Today's pipeline
   already pairs an outflow on one account with an inflow on another and books a `transfer` instead
   of income/expense (pipeline.ts stage 1, `transferPairId`). Reuse that exact mechanism. The only
   change: candidate counter-legs are searched across **all owned `bankAccounts` in the workspace**,
   not just within one entity. When the two legs sit in different entities → tag the pair
   `intercompany`. When same entity → it stays a plain internal `transfer` (unchanged behavior).

6. **Matching tolerances (standard, per Ansar #1 = "what QuickBooks/real-world uses"):**
   - **Amount:** exact, with a **±$1.00 (100 minor units)** band for bank rounding (matches QBO bank
     match tolerance and standard reconciliation practice). USD-only ⇒ **no FX variance band** — a
     real simplification vs. the multi-currency tools' 5% bands.
   - **Date window:** **±5 calendar days** (ACH/wire settlement lag; the de-facto industry default of
     a 5-day window).
   - **Direction:** signs must be opposite (one debit-to-cash, one credit-from-cash).
   - **Cardinality:** support 1:1 first; allow 1:many (a sweep split across deposits) as a later
     enhancement using summed legs within the same window.

7. **Confidence tiers for the pair (do not silently auto-post low-confidence guesses):**
   - **High / auto-classify:** exact amount + within 2 days + both legs on owned accounts → book the
     intercompany pair automatically (treated like a transfer; never income/expense).
   - **Medium:** within tolerance but loose (e.g. 3–5 days, or amount off by < $1) → propose in the
     **Inbox** as "Intercompany transfer between Zikra and Z360?" with one-click confirm. (AI
     proposes, the ledger posts — consistent with the product North Star.)
   - **Only one leg seen:** the other entity's bank not yet synced, or it is an external party →
     leave as a normal transaction; re-evaluate when the counter-leg arrives.

### Standalone vs. consolidated treatment (the two views)

8. **Standalone (single-entity) view keeps intercompany on the books** as a balance-sheet movement,
   never P&L. Book it through dedicated reciprocal accounts:
   - **`1300 Due from Affiliate (Zikra/Z360)`** — asset, on the sender's books.
   - **`2300 Due to Affiliate (Zikra/Z360)`** — liability, on the receiver's books.
   - The cash leg debits/credits the relevant bank `ledgerAccount`. Net P&L impact = $0 on both
     sides. This mirrors the standard "Due to / Due from" (a.k.a. intercompany receivable/payable)
     pattern. Tag each posted pair with a shared `intercompanyPairId` (analogous to the existing
     `transferPairId`) so both legs are linkable.

9. **Consolidated (`All`) view eliminates intercompany by netting the paired accounts to zero.**
   Because cash never left the group, the consolidated balance sheet must not show Due-from/Due-to,
   and the consolidated P&L must not show any intercompany revenue/expense. Implement elimination as
   a **read-time filter, not stored elimination journals**: when scope = `All`, exclude every
   journalLine whose entry carries an `intercompanyPairId` **and** whose counter-leg is also inside
   the consolidated set. (If a future scope is a *subset* of entities where only one side of a pair
   is included, that pair is NOT eliminated — it becomes a real external balance for that sub-group.
   The "both legs in scope ⇒ eliminate" rule handles this correctly and generically.)

10. **No elimination company / no manual elimination column.** Fathom and Joiin require a dedicated
    "Eliminations Company" (an Excel import of negative adjustments) because they can't see
    transaction-level data. OpenBooks owns the transactions, so elimination is a deterministic
    read-time exclusion keyed on `intercompanyPairId`. This is simpler and always ties out.

### USD-only simplifications (confirm and bank them)

11. **Consolidation is plain USD summation minus intercompany. Confirmed.** With a USD-only ledger
    (#3), there is **zero currency translation** in the roll-up: no functional-currency choice, no
    CTA (cumulative translation adjustment) equity plug, no per-rate revaluation, no multi-currency
    elimination variance. Roll-up = `SUM(journalLines by account code across in-scope entities)` then
    subtract eliminated pairs. This removes the single most complex part of every commercial
    consolidation tool. Multi-currency stays confined to payroll's day-of-pay salary conversion
    (#4), which books a USD amount and never reaches this layer.

12. **Ownership = 100% for Ansar's own LLCs ⇒ no minority interest (NCI) math.** All entities are
    wholly owned by the same owner, so skip proportional NCI allocation entirely (full elimination,
    not partial). Leave a `ownershipPct` field defaulting to 100 for future-proofing, but do not
    build NCI allocation now — it is out of scope and would be invented complexity.

### Presentation

13. **Consolidated view UI:** the same P&L / Balance Sheet / Cash Flow surfaces, with a scope pill
    (`All ▾`). In `All`, each report row can **drill down to per-entity contribution** (Zikra column,
    Z360 column, Eliminations column, Group total) — the classic consolidation worksheet layout, but
    rendered live. Show an explicit **"Intercompany eliminated: −$X"** line so the number is honest
    and auditable, not a silent omission.
14. **Intercompany affordance in single-entity view:** transactions booked to Due-to/Due-from render
    with a quiet "Intercompany · Zikra → Z360" tag (not income/expense styling), and link to the
    matching leg in the other entity. This makes the detection visible and correctable.

---

## Rationale

- **Why per-entity ledgers, not a merged ledger.** Each LLC files its own tax return and may have
  different members/liability. Merging would corrupt statutory reporting and is exactly what QBO/Xero
  refuse to do (one company file per entity). The diagnosis already flagged "single-entity scoping is
  NOT a bug." The portfolio is additive analytics on top.

- **Why detect on owned-counterparty rather than a GL flag.** Every commercial tool (Fathom, Joiin,
  LiveFlow, SoftLedger) pushes the *user* to tag intercompany because each tool ingests one entity's
  ledger in isolation and literally cannot see the other side. OpenBooks ingests both bank feeds into
  one workspace, so the other side is present in the same table. That turns a manual setup chore into
  a deterministic match — a genuine product edge, and it is the same machinery the transfer matcher
  already uses.

- **Why amount+date+opposite-direction+tolerance is the right signal.** This is precisely the
  criteria intercompany reconciliation tooling and bank-reconciliation engines converge on: align
  amount and date, require an equal-and-opposite counter-leg, allow a small tolerance for rounding
  and a few days for settlement lag. USD-only lets us tighten the amount band to ±$1 (no FX noise)
  and drop the 5% variance bands those tools need.

- **Why read-time elimination, not stored elimination journals.** Posted journal entries are
  immutable in OpenBooks; corrections reverse-and-repost. Stored elimination entries would need their
  own reversing lifecycle every period and could drift from the underlying pairs. A read-time filter
  keyed on `intercompanyPairId` is always consistent with the data, supports arbitrary scope subsets,
  and never needs a period-close reversal. The standalone Due-to/Due-from entries ARE real and stay
  posted; only their *display in the consolidated view* is suppressed.

- **Why USD-only collapses the hard part.** Consolidation complexity in commercial tools is ~90%
  currency translation (functional-currency selection, CTA plugs, revaluation, multi-currency
  elimination differences). Removing FX (#3) reduces consolidation to summation-minus-elimination,
  which is implementable as a query, not an engine.

---

## How QBO / Stripe / Plaid / industry does it

- **QuickBooks Online:** one company file per legal entity; QBO Advanced offers "build multi-company
  reports" via Spreadsheet Sync, otherwise teams export each entity and combine in Excel. Combining
  produces a *combined* report, not a true *consolidated* one — eliminations and due-to/due-from
  clearing are manual. Hard prerequisite: identical chart of accounts (same name, type, hierarchy)
  or the roll-up "will not tie out." Bank transfers between two owned accounts must be booked as
  **transfers, not income** ("income is money from an external source; a transfer is moving your own
  money"); when both legs download, you record one transfer and **match** to avoid duplicates — this
  is exactly the within-entity analog of intercompany.

- **Xero:** also one organisation per entity; native multi-entity consolidation is weak, which is why
  a third-party tier (Fathom/Joiin/Syft) exists specifically to roll Xero orgs up.

- **Fathom:** account-level eliminations only, **no transaction-level auto-detection**. Either
  "Automated Full Account Elimination" (zero out an account that holds only intercompany amounts) or
  a manual **"Eliminations Company"** (an Excel import of negative adjustments mapped to consolidated
  accounts). Supports up to 300 entities single-currency. Notable gotcha: P&L eliminations don't
  auto-flow to Current Earnings on the balance sheet — a manual plug — which is a symptom of working
  at account level instead of transaction level.

- **Joiin:** account-level, manual ("search for accounts, eliminate at the touch of a button"),
  elimination groups, percentage-ownership for partial subs, multi-currency translation. Again,
  user-driven selection, not automated transaction detection.

- **LiveFlow / SoftLedger:** closest to OpenBooks' model. LiveFlow lets teams **flag intercompany
  transactions so they're excluded from consolidated output automatically.** SoftLedger flags an
  entry as intercompany when it **references both entities in a single journal entry**, then a single
  "intercompany elimination automation" toggle nets it out at consolidation. OpenBooks generalizes
  this: it derives the "references both entities" relationship automatically from the paired bank
  legs instead of requiring a hand-entered two-entity journal.

- **Standard standalone-vs-consolidated mechanics (GAAP/IFRS, per SoftLedger/Deloitte/Intuit):**
  - Entity A sends cash to Entity B. **A standalone:** Dr Due-from Affiliate / Cr Cash. **B
    standalone:** Dr Cash / Cr Due-to Affiliate. Both entries persist permanently in standalone books.
  - **Consolidated:** the receivable and payable offset and are eliminated; the cash movement nets to
    zero "since cash simply moved internally — it didn't enter or leave the consolidated entity."
  - Intercompany **loans** eliminate the matching note receivable/payable; intercompany **interest**
    income/expense eliminate against each other; intercompany **revenue/expense** (e.g. a management
    fee between the LLCs) eliminate so the group isn't double-counted. OpenBooks' read-time
    `intercompanyPairId` filter handles all of these uniformly.

- **Matching tolerances (reconciliation industry):** common defaults are a ~5-day date window and a
  small amount tolerance (some banks match if amounts differ by < $1; multi-currency tools use ~5%
  for FX noise). Advanced engines pre-block candidates by amount range + date window, then fuzzy-match
  — and support 1:1, 1:many, many:many. OpenBooks: ±$1, ±5 days, opposite sign, 1:1 first.

- **Plaid:** provides the per-account identity OpenBooks needs to know an account is *owned* —
  `accounts` (account_id, mask, name, type/subtype) and the Identity/Auth products (account/routing,
  owner names). The practical detection key is simpler: an account is "owned/internal" iff it exists
  as a `bankAccounts` row in the same workspace. Plaid's transaction `payment_meta` /
  `personal_finance_category` of `TRANSFER_*` can be a *secondary corroborating* signal, but the
  authoritative signal is the matched owned counter-leg.

---

## Mapping to OpenBooks (concrete engineering)

1. **Schema (additive):**
   - Add `intercompanyPairId: v.optional(v.string())` to `journalEntries` / journal lines (mirrors
     `transferPairId`).
   - Seed two reciprocal system accounts per entity: `1300 Due from Affiliate`,
     `2300 Due to Affiliate` (asset/liability; never P&L).
   - Add `ownershipPct` (default 100) on `entities` for future NCI — unused now.
2. **Detection:** extend the pipeline stage-1 transfer matcher to search counter-legs across all
   `bankAccounts` in the workspace (`by_workspace` over entities → `bankAccounts.by_entity`). If the
   matched counter-leg's `entityId` ≠ this leg's `entityId`, classify as intercompany; post both legs
   through the single ledger mutation with a shared `intercompanyPairId`, hitting Due-from/Due-to + cash.
3. **Consolidation read layer:** a `scope = All | <entityId>` parameter on report queries.
   - `<entityId>`: existing per-entity report, unchanged (intercompany shows as Due-to/Due-from).
   - `All`: union journalLines across in-scope entities, group by account `code`, then **exclude any
     line whose `intercompanyPairId` has BOTH legs inside the in-scope set.** Emit an explicit
     "Intercompany eliminated" total for transparency.
4. **UI:** scope pill `All ▾` on Dashboard/Reports; per-entity drill-down columns + Eliminations
   column in the consolidated worksheet; quiet "Intercompany" tag on standalone Due-to/Due-from rows
   with a link to the paired leg.

---

## Citations (URLs)

- Fathom — Eliminations in a Consolidated Group (account-level; automated full + manual Eliminations
  Company): https://support.fathomhq.com/en/articles/2361975-eliminations-in-a-consolidated-group
- Fathom — Consolidated financial reporting (entity counts, single vs multi-currency):
  https://www.fathomhq.com/features/consolidated-financial-reporting
- Joiin — Intercompany management / elimination reporting (account-level, % ownership):
  https://www.joiin.co/features/intercompany-management/
- LiveFlow — Consolidating multiple entities in QuickBooks Online (combined vs consolidated, identical
  CoA prerequisite, flag-to-exclude): https://liveflow.com/blog/consolidating-multiple-enitities-in-quickbooks-online
- QuickBooks — Combine reports from multiple companies (Spreadsheet Sync, multi-company reports):
  https://quickbooks.intuit.com/learn-support/en-us/help-article/balance-sheet/combine-reports-multiple-companies-using-sync/L4fqueO4D_US_en_US
- QuickBooks — Categorize/match online bank transactions (transfer ≠ income; record + match both legs):
  https://quickbooks.intuit.com/learn-support/en-us/help-article/banking/categorize-match-online-bank-transactions-online/L1bTafTz3_US_en_US
- SoftLedger — Guide to intercompany eliminations with examples (standalone vs consolidated;
  Due-to/Due-from; "references both entities" flag + automation toggle):
  https://softledger.com/blog/guide-to-intercompany-eliminations-with-examples
- Numeric — Intercompany reconciliation (match on amount/date/reference; equal-and-opposite
  receivable/payable; tolerance, 1:many): https://www.numeric.io/blog/intercompany-reconciliation
- Nominal — Intercompany eliminations / transactions (matching criteria, automation):
  https://nominal.so/blog/intercompany-eliminations/
- BrizoSystem — Intercompany loans and interest elimination in consolidation:
  https://brizosystem.com/blog/intercompany-loans-and-interest-how-to-eliminate-them-in-consolidation/
- Intuit Enterprise — Intercompany eliminations guide:
  https://www.intuit.com/enterprise/blog/financials/intercompany-eliminations/
- Cashbook — Auto-matching algorithms in reconciliation (amount/date/reference, tolerances):
  https://www.cashbook.com/auto-matching-algorithms-in-accounts-reconciliation/
- Optimus — Fuzzy matching in bank reconciliation (date windows, tolerance bands, blocking):
  https://optimus.tech/blog/fuzzy-matching-algorithms-in-bank-reconciliation-when-exact-match-fails
- Deloitte DART — Transactions between parent and subsidiary (ASC 810 elimination authority):
  https://dart.deloitte.com/USDART/home/codification/broad-transactions/asc810-10/roadmap-noncontrolling-interests/chapter-4-intercompany-matters-with-noncontrolling/4-3-transactions-between-parent-subsidiary
