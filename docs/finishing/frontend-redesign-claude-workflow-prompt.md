# OpenBooks Frontend Redesign Research Prompt For Claude Workflows

Date: 2026-06-13
Status: planning artifact, no implementation yet
Audience: Claude Code workflow / deep research run

## Why This Exists

Ansar reviewed the current OpenBooks product in the browser and found that the
product is functionally present but not yet product-grade as a small-business
bookkeeping workspace. The issue is not one broken page. The issue is a
cross-product UX system problem:

- Dashboard, Inbox, Transactions, Income, Expenses, Bills, Contacts, Payroll,
  Settings, and Ask AI do not share a consistent interaction model.
- Several screens are working at the data level but feel like separate one-off
  screens instead of one coherent operating system.
- Important accounting workflows are present but not discoverable, filterable,
  reviewable, or responsive enough for a founder/operator to trust with real
  business data.
- The prototype and design system exist, but the current frontend has drifted
  from them in layout hierarchy, table behavior, AI affordances, and responsive
  polish.

The goal of the Claude workflow is to research, audit, and produce a redesign
and execution plan before implementation. The follow-on implementation should
only happen after Ansar approves the research plan.

## Critical Product Principle

OpenBooks should not duplicate financial truth across separate tabs.

The product should keep one universal register:

- Transactions is the full operational register and review surface.
- Income is a revenue lens over the same records, plus invoices, receivables,
  customers, recurring revenue, deposits, and collection metrics.
- Expenses is a cost lens over the same records, plus categories, vendors,
  recurring expenses, bills, evidence, and spend analytics.
- Bills is accounts payable workflow: uploaded/vendor bills, due dates, payment
  state, evidence, matching, and payment posting.
- Reports query posted journal lines and should agree with the workflow screens.

This means a transaction should not be "moved" from Transactions into Income or
Expenses. It should stay one record with richer views. Categorization, matching,
evidence, AI insight, and ledger posting should update the record once, then all
views should reflect that same truth.

Business example:

- A Stripe deposit appears in Transactions.
- Once classified and posted, it also appears in Income as received revenue,
  can be analyzed by customer or stream, and contributes to reports.
- An AWS card charge appears in Transactions.
- Once classified and posted, it also appears in Expenses under Cloud
  Infrastructure, can be reviewed by vendor/category, and contributes to reports.

## Sources Claude Must Read First

Read these before proposing any design or code plan:

- `AGENTS.md`
- `docs/finishing/implementation-plan.md`
- `docs/finishing/completion-report.md`
- `docs/finishing/whats-left.md`
- `docs/product/01-vision-and-scope.md`
- `docs/product/02-product-spec.md`
- `docs/product/03-design-brief.md`
- `docs/product/04-build-plan.md`
- `OpenBooks Design System/readme.md`
- `OpenBooks Design System/SKILL.md`
- `OpenBook - Prototype/Dashboard.dc.html`
- `OpenBook - Prototype/Transactions.dc.html`
- `OpenBook - Prototype/Inbox.dc.html`
- `OpenBook - Prototype/Income.dc.html`
- `OpenBook - Prototype/Expenses.dc.html`
- `OpenBook - Prototype/Bills.dc.html`
- `OpenBook - Prototype/Contacts.dc.html`
- `OpenBook - Prototype/Payroll.dc.html`
- `OpenBook - Prototype/Reports.dc.html`
- `OpenBook - Prototype/Settings.dc.html`

Inspect the current implementation surfaces, especially:

- `apps/web/src/app/AppShell.tsx`
- `apps/web/src/app/OpenBooksAIChat.tsx`
- `apps/web/src/components/openbooks/CoreScreens.tsx`
- `apps/web/src/components/openbooks/IncomeScreen.tsx`
- `apps/web/src/components/openbooks/ExpensesScreen.tsx`
- `apps/web/src/components/openbooks/ModuleScreens.tsx`
- `apps/web/src/components/openbooks/ReportsScreen.tsx`
- `apps/web/src/components/openbooks/SettingsScreen.tsx`
- Existing shadcn/ui components in `apps/web/src/components/ui/`
- Existing tests and screenshots under `apps/web/tests/` and
  `test-results/` where relevant

Use the official Claude Code workflows guidance:

- `https://code.claude.com/docs/en/workflows`

Important workflow constraints from that doc:

- Workflows are good for dynamic multi-agent codebase audits, migrations,
  cross-checked research, and hard plans.
- Workflows cannot pause mid-run for normal user input, so this should be a
  two-stage process: first research and plan, then implementation after Ansar
  approves the plan.
- Subagents can run in parallel, but cap concurrency responsibly.
- Each subagent should return evidence, changed files if any, validation, risks,
  blockers, and recommendations.

## Design System Constraints

OpenBooks design direction:

- White ledger-like surfaces.
- Geist fonts.
- Lucide icons.
- One brand green: `#2ca01c`.
- Quiet AI affordances.
- Hairline borders.
- Dense but readable tables.
- Tabular figures for money.
- No gradients.
- No purple AI styling.
- No decorative blobs.
- No emoji.
- No glassmorphism.
- No marketing-dashboard ornament.
- Expenses should usually be neutral, not alarm red.
- Mobile must be a real product surface, not a squeezed desktop table.

Use shadcn/ui primitives first:

- Card, Table, Sheet, Drawer, Dialog, Tabs, Select, Command, Popover, Calendar,
  DropdownMenu, ToggleGroup, Badge, Button, Input, Checkbox, Separator, ScrollArea,
  Tooltip, Field, FieldGroup, InputGroup.

Use AI Elements for Ask AI:

- Conversation
- Message
- PromptInput
- Suggestion
- Sources
- Tool
- Reasoning if useful
- Actions if useful
- Attachments if useful

The Ask AI interface should feel like a modern, reliable work assistant rather
than a narrow fixed side panel.

## Technically Verified Feedback

These observations were verified against the local app at `http://localhost:3100`
on 2026-06-13, using the running Next app, browser inspection, source reading,
and prototype comparison.

### 1. Dashboard

Current problem:

- The current Dashboard does not match the prototype hierarchy.
- It shows a workspace label, "Dashboard", "Business at a glance", "Demo entity",
  an "Operating snapshot" card, and several generic metric cards.
- The prototype starts from a stronger operator-level cash and books-health view:
  cash hero, connected accounts, P&L snapshot, spend categories, inbox,
  receivables/payables, payroll, income by customer, cash flow, coming up, and
  health/cushion context.
- The current page feels like a status collage rather than the small-business
  command center.

Required research:

- Compare `Dashboard.dc.html` against the current Dashboard implementation.
- Decide which prototype elements should be preserved, which should be improved,
  and which should be removed.
- Propose a dashboard that is better than the prototype while staying aligned
  with the OpenBooks design system.

Expected direction:

- Top area should focus on cash, book health, open work, income, expense,
  receivables, payables, and upcoming obligations.
- Remove unnecessary workspace labels and demo tags from the page body.
- Use clear date range controls.
- Make every card actionable: click into the related workbench with the same
  filter applied.

### 2. Inbox

Current problem:

- The Inbox review detail card can overflow and overlap text, especially receipt
  match details.
- The current two-column review layout is not robust enough.
- The UI does not feel like a focused exception-resolution queue.

Required research:

- Compare current Inbox with `Inbox.dc.html`.
- Identify all overflow, truncation, keyboard, mobile, and batch-action issues.
- Design a workbench where the left side is the queue and the right side is a
  resilient detail/review panel.

Expected direction:

- Group inbox items by work type: categorize, receipt match, transfer match,
  question, bill evidence, duplicate, low confidence.
- Show why the item needs attention.
- Make the confidence score, AI reason, evidence, candidate transaction, and
  ledger impact readable without overlap.
- Support batch review, keyboard shortcuts, and mobile drawer behavior.

### 3. Transactions

Current problem:

- The current page has basic status filters and a search box, but it does not
  have the full transaction workbench needed for real operations.
- The transaction detail panel is enabled by default by selecting the first row.
  This makes the table feel squeezed and reduces the sense of a full-screen
  register.
- Filters are incomplete: no robust multi-account selection, date range, amount
  direction, type, category, contact, source, receipt, AI status, confidence, or
  needs-attention filter.
- Table columns are incomplete: the user needs description, merchant, account,
  category, contact, amount, status, AI insight, confidence, receipt/evidence,
  and ledger/reconciliation state.
- There is no obvious workflow for adding receipt/context and asking AI to
  categorize, then reviewing before posting/reconciliation.
- Export and download flows are not strong enough.

Required research:

- Compare current Transactions with `Transactions.dc.html`, but do not treat the
  prototype as the maximum ambition.
- Design a product-grade register view where the table is the primary surface.
- Detail view should open only after row click or explicit action.

Expected direction:

- Full-width transaction table by default.
- Right-side Sheet or Drawer only on selection.
- Account multi-select with bank/card/Stripe/manual source filters.
- Date range with presets and custom range.
- Income/expense/all direction filter.
- Needs-attention and AI-confidence filters.
- Category and contact filters.
- Bulk selection with approve, exclude, recategorize, attach receipt, export.
- Export menu: CSV, filtered CSV, selected rows, audit trail if supported.
- Row click opens details: evidence, memo, description, AI insight, ledger lines,
  source, audit history, upload receipt, add context, rerun AI classification,
  approve/post if allowed.

### 4. Ask AI

Current problem:

- The Ask AI widget is a custom UI and is not using AI Elements primitives.
- It has visible implementation status labels like "Bedrock active" that should
  not be user-facing.
- The panel is fixed and narrow, which causes header/content overflow.
- In reports and other dense pages, the chat area breaks layout and becomes hard
  to use.
- Thread selection and new chat creation do not feel like a modern assistant
  experience.

Required research:

- Study current `OpenBooksAIChat.tsx`.
- Study the available AI Elements primitives and shadcn patterns.
- Propose an Ask AI redesign that works as a collapsible assistant, expanded
  side workspace, and mobile drawer.
- Confirm how it should connect to the existing Convex agent and streaming
  message hooks.

Expected direction:

- Remove provider/debug labels from the user UI.
- Use AI Elements:
  - Conversation for message stream.
  - Message for assistant/user messages.
  - PromptInput for composer, attachments, submit state, and keyboard behavior.
  - Suggestion for suggested prompts.
  - Sources for cited report/tool outputs.
  - Tool for collapsible tool invocation details.
- Add compact icon access from the shell.
- Allow collapse, docked side panel, and expanded workspace modes.
- Preserve streaming.
- Make the assistant context-aware by page and filter state.
- Keep it responsive at mobile, tablet, and desktop widths.

### 5. Bills / Accounts Payable

Current problem:

- The page includes unnecessary explanatory text.
- Open, due this week, overdue, paid/later groupings are not arranged into a
  clear accounts payable workflow.
- Upload evidence and bill tracking exist but are visually scattered.
- There is no consistent table-first workbench with filters, search, sorting,
  export, and row detail behavior.

Required research:

- Compare current Bills with `Bills.dc.html`.
- Reframe Bills as an Accounts Payable workbench.

Expected direction:

- Primary actions: Add bill, Upload bill, Import from vendor email if available
  later.
- KPI strip: open total, overdue, due soon, paid this period, missing evidence,
  average days to pay if available.
- Table columns: vendor, bill number, due date, amount, status, category,
  evidence, payment match, source, AI confidence.
- Filters: vendor, status, due window, category, evidence missing, amount range,
  date range.
- Row detail opens bill drawer: original evidence, extracted fields, payment
  schedule, matched transaction, ledger impact, approval/posting history.

### 6. Contacts

Current problem:

- The page includes unnecessary explanatory text.
- The contact profile pane is shown by default, which makes the directory feel
  cramped.
- The current design does not behave like a full-screen directory first.

Required research:

- Compare current Contacts with `Contacts.dc.html`.
- Decide whether deletion should exist, and if so whether it should be soft
  archive instead of destructive delete.

Expected direction:

- Directory table is the default full-width view.
- Profile Sheet/Drawer opens only after selecting a contact.
- Filters: customers, vendors, employees, contractors, open AR, open AP,
  recurring, recently active.
- Columns: name, type, aliases, open AR/AP, this-year volume, last activity,
  default category/rule state.
- Detail view: receivables, payables, transaction history, aliases, rules,
  notes, merge duplicates, archive if needed.

### 7. Income

Current problem:

- Income currently has some useful pieces, but it is not consistent with
  Transactions, Expenses, Bills, Contacts, and Payroll.
- It needs to combine revenue transactions, invoices, receivables, customers,
  streams, recurring income, and collection metrics in one coherent workbench.

Required research:

- Study the product spec and prototype for how income should work.
- Decide the relationship between Income and Transactions.

Expected direction:

- KPI strip: received this period, open receivables, overdue receivables,
  average days to pay, recurring revenue if available.
- Views/tabs: Payments, Invoices, Customers, Streams, Receivables.
- Shared filters: date range, customer, stream/category, status, account,
  source, amount range.
- Tables should drill into the same records used by Transactions and Reports.
- Charts: income by stream, income by customer, recurring vs one-time, aging.

### 8. Expenses

Current problem:

- Expenses is category/recurring focused but lacks a full tabular expense view.
- Date filtering is too limited.
- The design should be consistent with Income and Transactions.
- Current implementation includes at least one purple accent in expense category
  dot data, which conflicts with the design system.

Required research:

- Compare current Expenses with `Expenses.dc.html`.
- Design Expenses as a cost analytics and review workbench.

Expected direction:

- KPI strip: spent this period, recurring spend, uncategorized expense count,
  missing receipt/evidence count, top vendor/category.
- Views/tabs: Transactions, Categories, Vendors, Recurring, Evidence Needed.
- Shared filters: date range, account, vendor, category, evidence, AI confidence,
  recurring, amount range.
- Table should be available for all expense transactions.
- Charts: spend by category, spend by vendor, recurring trend, unusual spend.

### 9. Payroll

Current problem:

- Payroll does not clearly communicate whether runs are generated automatically,
  manually initiated, or imported.
- Statement selection is too static.
- Page-specific controls and tables are not consistent with the rest of the
  product.

Required research:

- Compare current Payroll with `Payroll.dc.html`.
- Define the payroll workflow:
  - import payroll register,
  - review employees/contractors,
  - generate or confirm pay run,
  - post ledger entries,
  - view statements by period.

Expected direction:

- KPI strip: payroll this period, next run, taxes/withholding if modeled,
  contractors vs employees, unmatched payroll items.
- Views/tabs: Runs, People, Statements, Contractors, Rules.
- Date/period selector should support month, quarter, custom range, and selected
  statement period.
- Tables should use the same filters, selection, export, detail drawer pattern.
- Clarify whether automatic run creation exists now or is a future state.

### 10. Reports

Current problem:

- Reports can be dense, and the docked Ask AI panel currently causes layout
  breakage.
- Reports should remain ledger-backed and should agree with workbench screens.

Required research:

- Review report screens against dashboard/income/expenses workflows.
- Identify how filters and date ranges should propagate from reports into
  transaction drilldowns.

Expected direction:

- Reports should have stable period selection.
- Clicking a report line should drill into filtered Transactions, Income, or
  Expenses views.
- Ask AI should not squeeze reports into unreadable layouts.

### 11. Header, Navigation, And Shell

Current problem:

- Header includes global search, month chip, Ask AI button, and demo/workspace
  markers that create clutter.
- User does not want to repeatedly see workspace/page intro noise.
- Some areas need fixed/sticky behavior; others should scroll independently.
- Settings sidebar does not stay fixed while settings content scrolls.
- The current docked AI side panel compresses content and causes overflow.

Required research:

- Audit `AppShell.tsx` and all page headers.
- Decide a consistent shell model.

Expected direction:

- Keep the left app navigation stable.
- Move settings to a quieter footer/utility area if appropriate.
- Replace global header search with page-local search and a command palette if
  useful.
- Ask AI should be an icon/assistant control, not a permanent large header pill.
- Remove visible demo/entity labels from normal page content unless environment
  safety requires a subtle indicator.
- Define which panels are sticky and which panels scroll.
- On mobile, use true drawers and bottom navigation/compact nav where needed.

### 12. Settings

Current problem:

- Settings contains useful connection and AI surfaces but lacks layout polish.
- Settings navigation should stay fixed while the settings content scrolls.
- Connections should make Plaid, Stripe, imports, and AI configuration simpler.
- Some detail tables overflow horizontally.

Required research:

- Compare current Settings with `Settings.dc.html`.
- Make Settings an administrative surface, not a dumping ground.

Expected direction:

- Sticky settings nav on desktop.
- Sectioned content: Workspace, Connections, Imports, AI, Rules, Team, Billing if
  relevant, Data/export if relevant.
- Plaid and Stripe connection cards should be simple and action-oriented.
- AI settings should be understandable, not provider-debug heavy.
- Tables inside settings must not overflow their cards.

## Shared Component System Claude Should Design

The redesign should start by designing shared components before page-by-page
rewrites. The current issue is inconsistency, so reusable interaction primitives
are the product foundation.

Design these components conceptually and then map them to files:

- `WorkbenchPage`: common page shell for data-heavy product screens.
- `PageActionBar`: title, primary action, secondary actions, compact controls.
- `DateRangeControl`: presets plus custom start/end.
- `FilterBar`: search, filter chips, saved views if appropriate.
- `AccountMultiSelect`: multiple bank/card/Stripe/manual account selection.
- `KpiStrip`: consistent metric cards with action affordances.
- `OpenBooksDataTable`: sorting, column sizing, selection, bulk actions,
  empty/loading/error states, responsive behavior, export hooks.
- `DetailSheet` or `RecordDrawer`: row detail closed by default, opens on click,
  mobile drawer fallback.
- `AiInsightBadge`: confidence, reason, status, and "needs review" marker.
- `EvidenceUpload`: receipt/bill/context upload with status and errors.
- `ExportMenu`: selected rows, filtered rows, full view, audit-oriented exports.
- `AttentionState`: shared vocabulary for needs review, missing evidence,
  overdue, unmatched, unposted, and low confidence.
- `CommandPalette`: optional global navigation/search command, but not a bulky
  permanent header search bar.
- `AskAIWidget`: AI Elements based assistant with compact, docked, expanded, and
  mobile states.

## Acceptance Gates For The Future Implementation

The later implementation should not be considered complete until these pass:

- No horizontal page overflow at widths 390, 768, 1306, 1440, and 1758.
- No text overlap in Inbox receipt matching, Ask AI messages, Settings tables,
  reports, or transaction details.
- Transactions table is full-width by default; detail panel is closed until row
  selection.
- Contacts table is full-width by default; profile panel opens only on row
  selection.
- Bills, Income, Expenses, Contacts, Payroll, and Transactions share the same
  table/filter/export/detail interaction language.
- Date range selection exists consistently where time-based financial data is
  shown.
- Search and filters are local to the relevant workbench.
- Export behavior exists where tabular financial data exists.
- Ask AI can be collapsed, opened, expanded, and used on mobile without breaking
  the page.
- Ask AI does not expose provider/debug status labels to normal users.
- Dashboard matches or improves on `Dashboard.dc.html` and preserves the
  operator-level business hierarchy.
- Settings navigation stays usable while content scrolls.
- All major pages pass desktop and mobile browser screenshot verification.
- Existing functional tests remain green, or any failures are explained with
  fixes.

Suggested verification commands for the future implementation:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- Relevant Playwright/e2e tests under `apps/web/tests/`
- Browser verification on the running app at `http://localhost:3100`
- Convex validation only if backend code changes

Do not use live Plaid or live Stripe credentials. Do not deploy to Vercel. Do
not publish artifacts unless Ansar explicitly asks.

## Copy/Paste Prompt For Claude: Deep Research Workflow Only

Use this prompt first. It should produce a research report and implementation
workflow plan, not code changes.

```text
ultracode

I need you to run a Claude Code workflow for OpenBooks frontend redesign research.
Do not implement product code yet. Your job is to audit, compare, design the UX
strategy, and produce a detailed execution workflow that I can approve before
implementation.

Context:

- Repo: /Volumes/SSD/OpenBooks
- Current branch: finishing
- Product: OpenBooks, free open-source AI-assisted bookkeeping for small
  businesses.
- North star: owners use plain English, but the hidden system of record is a
  double-entry ledger. AI proposes. The ledger engine posts.
- The product is functionally far along, but the frontend is not yet polished or
  consistent enough for real business use.
- Ansar has browser-reviewed Dashboard, Inbox, Transactions, Ask AI, Bills,
  Contacts, Reports, Payroll, Settings, Income, and Expenses and found systemic
  UX inconsistency, broken responsiveness, incomplete workflows, unnecessary
  text, and mismatch with the prototype.

Important:

- This is research/planning only. Do not edit product files.
- Read AGENTS.md first and follow it.
- Read docs/finishing/frontend-redesign-claude-workflow-prompt.md.
- Read the source-of-truth docs listed in that file.
- Read the prototype HTML files under OpenBook - Prototype/.
- Read the OpenBooks Design System.
- Inspect the current app implementation under apps/web/src/.
- Run or inspect the local app at http://localhost:3100 if available.
- Use browser verification, screenshots, and DOM/layout inspection where useful.
- Do not use live Plaid or live Stripe credentials.
- Do not deploy.
- Do not mutate shared demo data.

Research objectives:

1. Compare prototype vs current implementation for each surface:
   Dashboard, Inbox, Transactions, Income, Expenses, Bills, Contacts, Payroll,
   Reports, Settings, Ask AI, and global shell/header/navigation.

2. Validate Ansar's feedback technically:
   - dashboard mismatch,
   - Inbox overflow and broken receipt match layout,
   - Transactions lacking rich filters/search/date ranges/export/detail workflow,
   - detail side panels opened by default where they should not be,
   - Ask AI unresponsive layout and custom UI instead of AI Elements,
   - Bills and Contacts unnecessary explanatory text,
   - Contacts default sidebar issue,
   - Bills/accounts payable workflow inconsistency,
   - Income/Expenses inconsistency,
   - Payroll unclear run/statement workflow,
   - Settings sticky/layout/connection simplification issues,
   - global header clutter,
   - mobile/responsive issues.

3. Make the product decision explicit:
   Transactions should remain the universal register and source workbench.
   Income and Expenses should be analytical/workflow lenses over the same records,
   not duplicate places where records get moved. Explain why and where each user
   workflow should live.

4. Propose a shared component system:
   WorkbenchPage, PageActionBar, DateRangeControl, FilterBar,
   AccountMultiSelect, KpiStrip, OpenBooksDataTable, DetailSheet/RecordDrawer,
   AiInsightBadge, EvidenceUpload, ExportMenu, AttentionState, CommandPalette,
   AskAIWidget with AI Elements.

5. Propose page-by-page redesign direction:
   Dashboard, Inbox, Transactions, Income, Expenses, Bills, Contacts, Payroll,
   Reports, Settings, Ask AI, shell/header/navigation.

6. Propose implementation epics and subagent workflow:
   - Epic 0: audit baseline and visual evidence
   - Epic 1: shared layout/table/filter/detail primitives
   - Epic 2: shell/header/navigation and Ask AI responsive system
   - Epic 3: Transactions and Inbox workbenches
   - Epic 4: Income and Expenses workbenches
   - Epic 5: Bills/AP and Contacts directory
   - Epic 6: Payroll, Reports, and Settings polish
   - Epic 7: responsive QA, browser screenshots, e2e/lint/typecheck/test evidence

7. For each epic, specify:
   - goal,
   - files likely involved,
   - subagent scope,
   - allowed edits in future implementation,
   - validation expected,
   - risks,
   - done-when criteria.

8. Recommend the exact workflow shape for the implementation phase:
   how many agents, what they each do, what order, what can run in parallel, what
   must be sequential, and what acceptance evidence must be captured before
   moving on.

Design constraints:

- Use shadcn/ui primitives before custom controls.
- Use AI Elements primitives for Ask AI.
- Use lucide icons.
- Match OpenBooks design system:
  white ledger-like surfaces, Geist fonts, brand green #2ca01c, quiet AI
  affordances, hairline borders, tabular money, no gradients, no purple AI
  styling, no emoji, no decorative blobs, no glassmorphism.
- Use tables consistently across transaction-heavy pages.
- Keep row detail closed by default unless the user selects a record.
- Build responsive mobile/tablet/desktop behavior into the design plan.
- Do not preserve the prototype blindly. Use it as reference, then design a
  better product-grade version.

Output format:

Return a markdown report with these sections:

1. Executive Summary
2. Verified Findings By Surface
3. Prototype vs Current Gap Matrix
4. Product Information Architecture Decision
5. Shared Component System Proposal
6. Page-By-Page Redesign Proposal
7. Ask AI Redesign Proposal Using AI Elements
8. Responsive And Layout Rules
9. Implementation Workflow Plan For Claude Code
10. Acceptance Gates And Evidence Checklist
11. Risks, Open Questions, And Decisions Needed From Ansar

Do not implement code in this workflow. The final output should be something
Ansar can review and approve before launching the implementation workflow.
```

## Copy/Paste Prompt For Claude: Implementation Workflow After Approval

Use this only after Ansar approves the research plan.

```text
ultracode

Implement the approved OpenBooks frontend redesign plan.

Before editing:

- Read AGENTS.md.
- Read docs/finishing/frontend-redesign-claude-workflow-prompt.md.
- Read the approved research report from the prior workflow.
- Read OpenBooks Design System/readme.md and OpenBooks Design System/SKILL.md.
- Inspect the prototype HTML files under OpenBook - Prototype/.
- Inspect the current frontend implementation under apps/web/src/.

Implementation rules:

- Keep product data and backend contracts intact unless the approved plan says a
  backend change is required.
- Do not use live Plaid or live Stripe credentials.
- Do not deploy.
- Do not mutate shared demo data.
- Use shadcn/ui primitives before raw custom UI.
- Use AI Elements primitives for Ask AI.
- Use lucide icons.
- Preserve the OpenBooks design system.
- Remove unnecessary explanatory page text and demo/workspace body clutter.
- Make tables, filters, exports, date ranges, detail drawers, and responsive
  behavior consistent across data-heavy screens.
- Keep Transactions as the universal register. Income and Expenses are lenses
  over the same records.

Workflow:

1. Establish baseline screenshots and current failures.
2. Build shared workbench primitives first.
3. Refactor shell/header/navigation and Ask AI responsiveness.
4. Refactor Transactions and Inbox.
5. Refactor Income and Expenses.
6. Refactor Bills/AP and Contacts.
7. Refactor Payroll, Reports, and Settings.
8. Run responsive browser QA at 390, 768, 1306, 1440, and 1758 widths.
9. Run lint, typecheck, tests, and relevant e2e tests.
10. Produce final evidence report with screenshots, changed files, validation
    commands, remaining risks, and any follow-up recommendations.

Stop only when:

- No major layout overflow remains.
- Ask AI is usable and responsive.
- Tables and filters are consistent.
- Detail panels are closed by default and open intentionally.
- Dashboard matches or improves the prototype.
- The product feels coherent across the full bookkeeping workflow.
```

