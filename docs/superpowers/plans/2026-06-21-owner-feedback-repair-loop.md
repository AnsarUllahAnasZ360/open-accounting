# Owner Feedback Repair Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Ansar's first live-testing feedback into a coordinated repair loop that makes the app trustworthy enough for continued manual testing.

**Architecture:** Split the work into four independent lanes: dashboard scope, money-table density, dashboard noise reduction, and bank-vs-books reconciliation. UI lanes can ship quickly because they change presentation and routing. The reconciliation lane must stay proposal-first: inspect bank balances, ledger balances, opening balances, unreviewed rows, and transfer treatment before any ledger mutation.

**Current status (2026-06-22):** UI repair pass is committed-ready: `pnpm verify` is green, the Convex dev deployment has the local backend functions, and browser checks confirm Dashboard, Reports, Transactions, Income, Expenses, Ask AI, and Balance Sheet routes render without page-level horizontal overflow. Ledger/data repair is intentionally still blocked on an owner-approved reconciliation proposal because the current bank-vs-books gap is real financial data, not just a UI bug.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, Tailwind, shadcn/ui, lucide-react, Convex queries/mutations/actions, OpenBooks design system.

---

## Source Feedback

Ansar identified these blocking issues during live testing:

- Dashboard header shows a business selector. He wants Dashboard to be one unified all-business cockpit, not a selector-driven single-business page.
- Business filtering belongs in Reports, where the owner can intentionally view consolidated or per-business statements.
- Transactions, Income, and Expenses tables waste horizontal space and show noisy long descriptions instead of compact owner-readable names.
- The Transactions screen shows keyboard hints (`J`, `K`, `Enter`, `E`) as visible chrome. Ansar does not want that clutter.
- Dashboard cash contradicts external bank holdings. A screenshot shows about `$84,686.89` across bank accounts while OpenBooks displayed contradictory cash/book values.
- Dashboard is overloaded with AI/insight cards. Insights should move to a separate route or Ask AI, while the dashboard stays operational.

## Non-Negotiables

- No committed secrets, bank tokens, customer financial records, or copied env files.
- Do not mutate real ledger data until a reconciliation proposal exists.
- AI proposes; the ledger engine posts.
- Ledger posting remains centralized through the existing ledger mutation path.
- Money stays integer minor units plus currency.
- Real bookkeeping rows can remain `Needs review`; review-gated is better than fake confidence.
- OpenBooks visual language stays quiet: white ledger surfaces, Geist, lucide, one green `#2ca01c`, no gradients, no emoji.

---

## Lane 1: Dashboard Scope And Business Selector

**Business outcome:** Ansar gets a single owner cockpit that answers "how are all my businesses doing?" without forcing him to pick an entity first.

**Files:**

- Modify: `apps/web/src/components/openbooks/AppShell.tsx`
- Modify: `apps/web/src/components/openbooks/CoreScreens.tsx`
- Review: `apps/web/src/lib/openbooks/active-entity.tsx`
- Review: `convex/coreViews.ts`
- Review: `convex/reportViews.ts`

**Tasks:**

- [x] Hide the topbar `BusinessSwitcher` on `/dashboard`.
- [x] Keep business scope controls available for `/reports`.
- [x] Make Dashboard request portfolio data by default where the backend supports aggregate reads.
- [x] Dashboard backend returns a true portfolio result for the owner cockpit instead of showing a misleading single-business selector.
- [x] Preserve single-business scoping for pages where it is still required: Transactions, Income, Expenses, Bills, Contacts, Payroll.
- [x] Keep Dashboard as the only route that forces all-business scope; Reports owns its own filter, and mutation-heavy workbench routes stay guarded when the persisted scope is all-business.

**Acceptance:**

- [x] `/dashboard` header has no `active-business-switcher`.
- [x] `/dashboard` headline reads as an all-business cockpit, not a selected-business detail view.
- [x] `/reports` still exposes a business/all-business filter.
- [x] No route loses access to business switching where required for real workflows.

**Verification:**

- [x] Browser check at `http://localhost:3100/dashboard`: no business dropdown.
- [x] Browser check at `http://localhost:3100/reports`: consolidated/per-business selection still reachable.
- [x] `pnpm --filter @openbooks/web typecheck`
- [x] `pnpm verify` full run: web typecheck, Convex typecheck, lint, production build, and 574/574 unit tests passed on 2026-06-22.

---

## Lane 2: Transactions, Income, And Expenses Table Density

**Business outcome:** Ansar can scan the books like an operator. The first screen shows names, dates, categories, accounts, status, and money without horizontal hunting.

**Files:**

- Modify: `apps/web/src/components/openbooks/CoreScreens.tsx`
- Modify: `apps/web/src/components/openbooks/ModuleScreens.tsx`
- Review: `apps/web/src/components/openbooks/workbench/*`
- Review: `apps/web/src/components/openbooks/primitives/*`

**Tasks:**

- [x] Remove the visible Transactions keyboard-hint strip from default page chrome.
- [x] Keep keyboard shortcuts operational for power users, but move documentation to tooltips/help or omit visible docs entirely.
- [x] In transaction rows, show the normalized merchant as the primary value.
- [x] Move raw bank descriptions into hover/title, expanded row detail, or drawer detail.
- [x] Cap merchant/vendor/customer cells with one-line truncation and stable column widths.
- [x] Make Income and Expenses vendor/customer columns use compact names first, detailed metadata second.
- [x] Reduce unnecessary blank space while preserving readable tap targets.

**Acceptance:**

- [x] Transactions table shows useful row data in the default viewport without horizontal scanning at desktop width.
- [x] Long merchant/vendor names truncate cleanly and expose full value on hover/detail.
- [x] Keyboard shortcut letters are not visible as permanent page content.
- [x] Income and Expenses use the same compact table principle.

**Verification:**

- [x] Browser check `/transactions` desktop: no internal horizontal overflow.
- [x] Browser check `/income` desktop: no internal horizontal overflow.
- [x] Browser check `/expenses` desktop: no internal horizontal overflow.
- [x] Browser check mobile 390px: no document or workbench horizontal overflow.
- [x] `pnpm --filter @openbooks/web typecheck`
- [x] `pnpm verify` full run: see Lane 1 note.

---

## Lane 3: Dashboard Insight Decluttering

**Business outcome:** Dashboard becomes a calm cockpit. It highlights operational truth and urgent review items, not a stack of AI opinions.

**Files:**

- Modify: `apps/web/src/components/openbooks/CoreScreens.tsx`
- Modify: `apps/web/src/components/openbooks/dashboard/AdvisorPanel.tsx`
- Review: `apps/web/src/components/openbooks/InsightsScreen.tsx`
- Review: `convex/aiCfo.ts`
- Review: `convex/aiInsights.ts`

**Tasks:**

- [x] Remove or collapse the `AdvisorPanel` from the default Dashboard view.
- [x] Remove the generic Dashboard `InsightBanner` from default Dashboard if it duplicates Ask AI/Insights.
- [x] Keep the unreviewed-transactions banner because it is accounting-critical, not decorative.
- [x] Keep optional insights reachable through the existing Insights sub-route and Ask AI navigation without dominating the Dashboard first paint.
- [x] Keep cash, P&L, A/R, A/P, bank accounts, and activity as the primary cockpit modules.

**Acceptance:**

- [x] Dashboard no longer opens with multiple AI/advisor warnings.
- [x] Dashboard still warns when unreviewed transactions are excluded from figures.
- [x] Optional insights remain reachable without dominating the primary cockpit.

**Verification:**

- [x] Browser check `/dashboard`: no stacked AI/advisor card bombardment.
- [x] Browser check `/ask-ai`: Ask AI route remains reachable.
- [x] Browser check any Insights route that remains linked.
- [x] `pnpm --filter @openbooks/web typecheck`
- [x] `pnpm verify` full run: see Lane 1 note.

---

## Lane 4: Bank-Vs-Books Reconciliation And Opening Balance Truth

**Business outcome:** OpenBooks explains why bank cash and book cash differ, then proposes safe ledger fixes instead of silently showing impossible numbers.

**Files:**

- Review: `convex/coreViews.ts`
- Review: `convex/reportViews.ts`
- Review: `convex/plaid.ts`
- Review: `convex/pipeline.ts`
- Review: `convex/ledger.ts`
- Review: `convex/schema.ts`
- Potentially modify after proposal approval: reconciliation helper/test files only.

**Read-Only Diagnosis Tasks:**

- [x] Query active workspace, active businesses, bank accounts, Plaid balances, transaction counts, review states, and journal cash balances.
- [x] Compare bank account live balances against ledger balances per cash account.
- [x] Identify whether the gap comes from missing opening balances, unreviewed transactions, excluded rows, credit balances, duplicate transfers, or wrong portfolio/single-business scope.
- [x] Produce a reconciliation table: account, bank says, books say, difference, likely cause, proposed action.
- [ ] Produce a ledger-safe repair proposal before any mutation.

**Mutation Tasks After Approval:**

- [ ] If opening balances are missing, post balanced opening-balance entries through the ledger engine.
- [ ] If transactions are uncategorized, propose categories and keep uncertain items in Inbox.
- [ ] If transfers are double-counted, mark transfer pairs and reverse/repost only through approved ledger correction paths.
- [ ] If dashboard scope is wrong, fix read model before changing ledger data.

**Acceptance:**

- [ ] Dashboard cash difference is explainable per account.
- [ ] Bank says/books say line matches underlying account-level reconciliation.
- [ ] Any ledger mutation is reversible, balanced, and auditable.
- [ ] Reports agree with dashboard books-cash after repairs.

**Verification:**

- [ ] Read-only Convex evidence before mutation.
- [ ] Unit tests for any reconciliation helper.
- [x] Browser check `/dashboard` and `/reports?report=balance-sheet`.
- [x] `pnpm typecheck:convex`
- [x] `pnpm verify`
- [x] `npx convex dev --once` after backend edits.

---

## Read-Only Reconciliation Evidence

External screenshot target total: `$84,686.89`.

Convex stored non-credit bank balances found in the active workspace: `$65,004.89`, a `$19,682.00` gap from the screenshot.

| Account | Screenshot | Convex bank row | Gap |
|---|---:|---:|---:|
| Business Checking ending 7137 | `$62,248.69` | `$56,296.60` | `$5,952.09` |
| Zikra Business Checking | `$13,006.97` | `$27.47` | `$12,979.50` |
| Daily Ops | `$7,500.00` | `$7,500.00` | `$0.00` |
| Dallas | `$1,180.82` | `$1,180.82` | `$0.00` |
| CHASE COLLEGE | `$748.76` | not present | `$748.76` |
| Depository Account 9730 | `$1.65` | not present | `$1.65` |

Ledger/report cash by scope:

| Scope | Ledger/report cash |
|---|---:|
| Z360 BIZ LLC | `-$7,436.75` |
| Zikra Infotech LLC | `$106,308.55` |
| Z360 + Zikra combined | `$98,871.80` |
| All active workspace entities | `$110,563.80` |

Key causes identified:

- Z360 has `203` needs-review rows and `218` unposted rows.
- Zikra has `1,973` needs-review rows and all are unposted.
- There are no opening-balance entries for the two real businesses.
- Two active E1 test entities add `$11,692.00` to all-business cash.
- Stored Plaid balances are stale or incomplete versus the screenshot; two screenshot accounts are not present.
- Likely unmarked transfer pairs exist and must be classified before income/expense posting.

## Agent Assignments

- Dashboard scope/business selector: inspect `AppShell.tsx`, `CoreScreens.tsx`, `active-entity.tsx`, `coreViews.ts`, `reportViews.ts`.
- Table density: inspect `TransactionsScreen`, Income/Expenses module screens, shared workbench/table primitives.
- Reconciliation: read-only Convex inspection only; no ledger mutations.
- Insight decluttering: inspect `DashboardScreen`, `AdvisorPanel`, `InsightBanner`, `InsightsScreen`, AI CFO/insight backends.

## Main-Thread Responsibilities

- Own product decisions and integration order.
- Keep ledger mutation blocked until the reconciliation proposal exists.
- Apply quick low-risk UI patches directly once file ownership is clear.
- Re-run browser checks in the in-app browser.
- Summarize business impact for Ansar, not just code changes.
