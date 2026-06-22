# E5 — Cross-section consistency checklist & audit (KEYSTONE)

**Epic:** E5 — Consistency & functional uniformity
**Sections audited:** Transactions, Income, Expenses, Contacts (+ every sub-tab)
**Verdict after E5 fixes:** the four operational sections share one header /
SectionTabs / toolbar / shell / detail-sheet / Insights system. The 12 audited
divergences and 5 broken actions are resolved (table at the bottom).

This file is the canonical artifact for E5.1 (the checklist) and E5.2 (the
cross-section audit scored against it). The fixes it drove live in E5.3 (chrome),
E5.4 (uniform states), and E5.6 (functional pass). The parameterized suite that
guards them is `tests/e2e/redesign-e5-consistency.spec.ts` (E5.5).

---

## E5.1 — The canonical consistency checklist

Every operational section + sub-tab is scored against these dimensions. "Same"
means the SAME component, the SAME control set/order, and the SAME behavior — not
merely "a control that does a similar thing".

1. **Header placement** — the section title sits in the app topbar; the section
   body never renders its own page-title block.
2. **SectionTabs bar** — identical underline strip directly under the header,
   order `[cash-movement → AR/AP → Insights]` with Insights LAST, a 2px
   brand-green active underline, real `Link` nav, query-string carried across
   sub-tab switches, `data-active`/`aria-current` on the active tab.
3. **Toolbar control set + order** — `SavedViews · Search · Filters · [Date] ·
   [Amount] · | · Group · Sort · Display · AddMenu("+")`. ONE discovery model: a
   free-text search box first; advanced facets (Keyword, Account, Status, …) live
   INSIDE the Filters panel, never as separate toolbar pills.
4. **Saved-views trigger copy** — section-correct `allLabel` ("All transactions",
   "All income", "All invoices", "All expenses", "All bills", "All contacts").
5. **Built-in saved views** — exactly ONE sensible built-in per cash/ledger
   surface (consistent policy), plus the user's own views.
6. **Insight banner** — the SAME `KpiStrip` 4-card band with the SAME "Stats N"
   header and "Hide stats / Show stats" collapser on every cash/ledger surface.
7. **Table layout** — `OpenBooksDataTable` inside the pinned fixed/scroll shell;
   inline category edit uses the SAME `InlineCategoryCombobox` primitive
   everywhere it appears.
8. **Fixed-vs-scroll shell** — `usesPinnedShell` frame; only the table body
   scrolls; Insights sub-tabs always page-scroll.
9. **Detail surface** — the SAME shared `DetailSheet` (right Sheet on lg+, bottom
   Drawer on mobile) flipping at the SAME 1023px breakpoint. No bespoke aside, no
   section-unique breakpoint.
10. **Add affordance** — exactly ONE "+" entry point (the `AddMenu`); every
    section-specific add (category, bill, upload bill PDF) is folded into it as a
    menu item. No second/third standalone add button.
11. **Navigation behavior** — a row click ALWAYS opens a detail (no silently-dead
    clickable rows); detail actions are wired to shipped capabilities, not stubs.
12. **Empty / loading / error states** — identical components + copy pattern:
    `EmptyState` for empty, the section loading block for loading, `EmptyState`
    "… not found / unavailable" for missing records.
13. **Money formatting** — `money-figures` tabular figures; money-in green;
    ordinary spend NEUTRAL (never alarm-red); only money-at-risk (overdue) carries
    the negative token, always paired with a label.
14. **Color discipline** — one brand green `#2ca01c`; no gradients / purple-AI /
    emoji / glassmorphism / marketing ornament.
15. **Keyboard / a11y** — section-correct nouns on the Group/Sort controls (e.g.
    "Group invoices", "Sort contacts"); `aria-current` on the active tab; the
    AddMenu trigger labelled "Add, import or export".
16. **Mobile** — a real responsive surface at 390px: scrollable SectionTabs, the
    single "+" AddMenu, the DetailSheet as a bottom Drawer, no horizontal page
    scroll.

---

## E5.2 — Cross-section audit (scored after the E5 fixes)

| Section › sub-tab | Verdict | Notes |
| --- | --- | --- |
| Transactions › Transactions | consistent | Reference consumer. Now adds the free-text search box, the shared `KpiStrip` banner + collapser, and the shared `DetailSheet` (1023px) — the three things it used to diverge on. Keyword + Account moved into the Filters panel. |
| Transactions › Insights | consistent | `TransactionsInsights` on the E1 components; page-scrolls; `insights-dashboard` + `insights-kpi-card`. |
| Income › Income (cash) | consistent | Search box, `KpiStrip` banner, `allLabel="All income"`, section nouns on Group/Sort. Payout rows now open a `PayoutDetailSheet` (no dead click). Built-in "Stripe payouts" view. |
| Income › Invoices (AR) | consistent | `allLabel="All invoices"`, built-in "Overdue" view, `config.groupByOptions` now matches the rendered menu (none/Status/Customer), Statement action deep-links to the contact's Statements tab. |
| Expenses › Expenses (cash) | consistent | Single "+" AddMenu (Add expense + folded-in Add category); inline category now the shared `InlineCategoryCombobox`; `allLabel="All expenses"`. |
| Expenses › Bills (AP) | consistent | Single "+" AddMenu (Add bill + folded-in Upload bill PDF); `allLabel="All bills"`; `config.groupByOptions` matches the rendered menu (none/Status/Vendor). |
| Expenses › Insights | consistent | `ExpensesInsights` on the E1 components. |
| Contacts › Contacts | consistent | Search box, `KpiStrip` banner, `allLabel="All contacts"`, built-in "Open A/R" view. Role lives in ONE place (the role-chip lens, removed from the Filters panel). The empty Attachments tab was removed (no dead tab). |
| Contacts › Insights | consistent | `ContactsInsights` on the E1 components. |
| All sub-tab Insights | consistent | `SectionInsights` dispatches real E1 panels for all four sections; uniform. |

---

## E5.3 — Divergences fixed

| # | Divergence | Fix |
| --- | --- | --- |
| 1 | Two discovery models (Transactions Keyword pill + Account combobox vs. the others' search box) | One model: a free-text search box on all four; Keyword + Account moved into the Filters panel. |
| 2 | Two insight banners (`MiniCashflowStrip` vs. `KpiStrip`) | Transactions now renders the SAME 4-card `KpiStrip` with the same "Hide stats" collapser. |
| 3 | Two detail surfaces (Transactions bespoke `<aside>` @1279px vs. shared `DetailSheet` @1023px) | Transactions migrated onto the shared `DetailSheet` at the standard 1023px breakpoint. |
| 4 | Saved-views trigger said "All transactions" on every section | `allLabel` threaded through `WorkbenchSurface` → `SavedViews`; section-correct copy on all four. |
| 5 | Group/Sort aria-labels hardcoded "transactions" | `noun` prop on `GroupByMenu`/`SortMenu`, wired per section. |
| 6 | Expenses double "+" (AddCategory icon beside AddMenu) | "Add category" folded into the AddMenu as an item. |
| 7 | Bills triple add (Upload + Add bill + AddMenu) | "Add bill" + "Upload bill PDF" folded into the AddMenu. |
| 8 | Expenses inline category = raw `Select` vs. Transactions' combobox | Expenses now uses the shared `InlineCategoryCombobox`. |
| 9 | `config.groupByOptions` ≠ rendered menu (Invoices, Bills) | Config keys aligned to the rendered menu (status/contact); `GroupByKey` extended with `status`. |
| 10 | Invoice "Statement" only `router.push('/contacts?q=name')` with a stub message | Deep-links to the contact's detail Statements tab via `contactId` (`/contacts?contact=…&tab=statements`); honest message. |
| 11 | Income payout rows = silent dead click | Payout rows open a `PayoutDetailSheet` (shared `DetailSheet`); the cell reads "View payout". |
| 12 | Inconsistent built-in saved views | One built-in per surface: Transactions (none — register), Income "Stripe payouts", Invoices "Overdue", Expenses "Missing receipt", Bills "Missing evidence", Contacts "Open A/R". |

---

## E5.4 — Uniform empty / loading / error states

- **Empty:** every cash/ledger/directory surface renders `EmptyState` (title +
  description), wrapped in a `data-testid="<section>-empty"` node, with the SAME
  "No … in this view / Adjust the filters above to see more" copy pattern for the
  filtered-empty (`emptyGroups`) case.
- **Loading:** the section loading block ("Loading …") renders while the read
  model is `undefined`.
- **Error / not-found:** detail sheets render `EmptyState` "… not found /
  unavailable" when the record query returns `null`; "no business yet" renders
  `EmptyState` with the `Building2` icon on every section.

---

## E5.6 — Functional pass (broken actions fixed)

| Action | Before | After |
| --- | --- | --- |
| Invoice detail "Statement" | `router.push('/contacts?q=name')` + "lands in the Contacts epic" stub | Deep-links to the contact's Statements tab via `contactId`. |
| Income payout row click | silent no-op (no `transactionId`) | Opens a `PayoutDetailSheet`. |
| Invoice composer customer field | free-text only | Directory-bound picker (`<datalist>` of known customers; a new typed name still lands in Contacts). |
| Contacts "Attachments" tab | placeholder tab with no function | Removed (no dead tab). |
| `/bills` dead routing | `case "bills"` branch + `/bills` in `KNOWN_ROUTES` + Dashboard `Link href="/bills"` | Dead `AppScreen` branch + `KNOWN_ROUTES` entry removed; Dashboard links straight to `/expenses/bills`. The `/bills` → `/expenses/bills` server redirect is kept for old bookmarks. |

Verified-present-and-wired (unchanged, re-confirmed): inline recategorize
(reverse + repost), bulk Approve/Recategorize/Exclude on Transactions, invoice
Finalize/RecordPayment/Reminder/Void, bill Pay via the match picker, add contact,
CSV/manual import, exports.

---

## E5.5 — Parameterized consistency suite

`tests/e2e/redesign-e5-consistency.spec.ts` runs ONE journey across all four
sections (load → assert identical chrome → apply a filter → toggle the Stats
banner → open a row → walk each sub-tab → Insights) and captures a side-by-side
screenshot set at desktop (1440) AND mobile (390). Real pointer clicks only; the
shared demo books are read/navigated, never mutated.

The canonical "one uniform product" proof is the composited four-section
montage at both widths:
`docs/finishing/evidence/2026-06-14-E5-sidebyside-4up-desktop.png` (2×2 grid of
the four cash-movement surfaces at 1440) and
`docs/finishing/evidence/2026-06-14-E5-sidebyside-4up-390.png` (the four
surfaces in a row at 390). The per-section frames the montage is built from are
`2026-06-14-E5-section-<section>-{1440,390}.png`.

Stale prior-effort specs cleaned: `redesign-e3-expenses` (brittle `border-primary`
class → stable `data-active`; Add-bill via the AddMenu), `redesign-epic2-income`
(New-invoice via the AddMenu), `redesign-e4-contacts` (Add-contact via the
AddMenu; Attachments tab dropped), `redesign-epic4-evidence` (Income sub-tabs
re-pointed to the SectionTabs DOM), `modules.spec` (`income-tab-invoices` →
`section-tab-invoices`), `income-expenses-bills` (Add category / Add bill via the
AddMenu). `receipts.spec` + `receipts-g4.spec` were removed — they asserted the
removed `m11-receipt-upload-panel` standalone page; receipt extraction is covered
by `convex/receipts.test.ts` and the Inbox/EvidenceUpload surfaces.

Two further stale-DOM reds the redesign introduced were caught by the Stage B
full e2e pass and fixed (E5.6 functional / E5 item 6 — no stale red masquerading
as coverage):

- `core-screens.spec.ts` H1 (core register workflow): the redesigned transaction
  detail moved the split form into a collapsed `Collapsible` and turned the
  detail surface into a modal `DetailSheet`. H1 still drove the old
  always-visible split and left the sheet open over the toolbar, so it hung to
  the 300s timeout. Fixed: expand `split-toggle` before `split-post`, then
  `Escape` the sheet before the next AddMenu (CSV import) step. Now 17s green.
- `app-shell.spec.ts` A4b (⌘J opens Ask AI): the Ask AI Elements rebuild dropped
  the visible "Ask AI" string from inside `ai-panel` (the docked header reads
  "Chat"; the identity is the `Ask AI chat for …` region label). Fixed: assert
  the real current DOM (region label + "Chat" header) instead of the removed
  literal.
