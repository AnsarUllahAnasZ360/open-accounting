# Open Books — Design Brief for Claude Design (v1)

How to use: each numbered screen below is a self-contained brief. Work top-down (shell → dashboard → inbox → transactions → the rest). Prefix every prompt with the **Global context block**, then paste the screen's brief. Use your existing Open Books design system (QuickBooks-green "ob" mark) for tokens.

---

## Global context block (prefix for every prompt)

> Open Books is a free, open-source, AI-first accounting app for small businesses — a lightweight QuickBooks alternative. Visual language: clean, calm, trustworthy fintech; generous whitespace; shadcn/ui components; the brand green used sparingly for positive money, primary actions, and the logo; red/amber only for genuinely negative/attention states. Numbers use tabular figures. Money in = green, money out = neutral dark (not red — expenses are normal, not bad). Tone of all copy: plain English, zero accounting jargon ("money you're owed", never "accounts receivable" — though report titles may carry the formal name as a subtitle). AI presence is quiet: a small spark icon + reasoning on demand, never flashy. Desktop-first web app, responsive down to tablet.

---

## 0. App Shell

- **Left sidebar (collapsible to icons):**
  - Top: logo + workspace name; **entity switcher** (avatar-style pill: "Acme LLC ▾" — menu lists entities + "All entities" + "Add business").
  - Nav: Dashboard · Inbox (count badge, green dot when zero) · Transactions · Invoices · Bills · Contacts · Payroll · Reports · divider · Settings.
  - Bottom: sync status ("Synced 12 min ago" + spinning state), user menu.
- **Top bar:** global search (⌘K — searches transactions, contacts, reports, actions), date-context chip where relevant, "Ask AI" button.
- **Right AI panel:** collapsible chat drawer (~380px), toggled by Ask AI button or ⌘J; expandable to full-screen; persists across pages with page-aware context chip ("Viewing: P&L, March 2026").
- States: collapsed sidebar; AI panel open/closed; mobile = bottom tab bar (Dashboard, Inbox, Transactions, Ask AI).

## 1. Dashboard ("Business at a glance")

Grid of widgets (12-col, rearrangeable later; fixed default order for v1). Default period selector top-right: This month ▾.

1. **Cash position (hero, full width):** total across all bank accounts, big number + sparkline (90d); per-account chips below (bank logo, name ····1234, balance, stale-sync warning icon if >24h).
2. **Profit & loss snapshot:** Income, Expenses, Net profit for period; net profit big w/ delta vs. prior period (▲ green/▼ red); mini grouped bar income-vs-expense by month (6 mo).
3. **Inbox status:** "7 items need you" + breakdown by type + CTA → Inbox; zero-state: green check, "Books up to date. 94% automated this month."
4. **Money owed to you (AR):** total open + aging mini-bar (0–30/31–60/61–90/90+), top 3 overdue invoices w/ customer + days late.
5. **Money you owe (AP):** total open bills + next 3 due (vendor, amount, due-in-days).
6. **Expense breakdown:** donut by category for period, top 5 legend with amounts + MoM delta arrows; click → Expenses report.
7. **Income by customer:** horizontal top-5 bars, "+ N others"; concentration hint ("Acme is 62% of revenue" amber note if >50%).
8. **Cash flow:** monthly in/out paired bars (6 mo) + net line.
9. **Payroll:** last run total (base currency) + per-currency sub-line ("$18.2k · ₨2.1M PKR · ₹900k INR"), next run date.
10. **Activity feed (right rail or bottom):** chronological — "AI categorized 23 transactions (avg 96%)" · "Stripe payout $1,940 reconciled: 14 payments − $61 fees" · "Invoice #1042 paid by Acme" · "Rule 'AWS → Cloud' fired 3×". Each row: icon, one line, timestamp, click-through.

States: first-run (widgets skeleton + onboarding checklist card: connect bank ✓ AI ✓ Stripe ✓ inbox zero ✓ first report ✓), loading skeletons, all-entities mode (cash + feed only, per-entity cards).

## 2. Inbox (the daily workflow — design like an email triage app)

- Two-pane: left = card list grouped by type with counts (Needs category 12 · Receipts 3 · Possible transfers 2 · Payout issue 1 · Connection 1 · AI questions 2); right = detail of selected card.
- **Categorize card (the most common):** transaction summary row (date, merchant, amount, account); AI suggestion as a pre-selected category chip + confidence ring (e.g., 72%) + collapsible "Why: similar to 4 past Figma charges you filed as Software & SaaS"; actions: **Confirm** (primary, Enter), change category (searchable combobox), Split, Exclude (personal/duplicate), "Always do this → create rule" checkbox.
- **Receipt card:** receipt thumbnail + extracted fields left, candidate transaction right, match-confidence; Confirm match / Pick other / Create expense.
- **Transfer card:** the two sides shown as linked rows → "Mark as transfer".
- **Payout mismatch card:** expected vs. received with itemized diff table → "Accept Stripe's numbers" / "Investigate" (opens payout detail).
- **Connection card:** bank logo, "Chase needs you to sign in again" → Reconnect button.
- **AI question card:** conversational ("3 payments of ₨180,000 to 'H. KHAN' look like payroll. Is Hammas Khan an employee?") with quick-reply chips.
- Batch mode: checkboxes + "Confirm all suggestions" for ≥90% items; keyboard J/K/E/Enter; progress feel ("12 → 0") with a subtle celebration at zero.

## 3. Transactions (register)

- Toolbar: account filter pills (All · Chase ····1234 · Amex ····9901 · Stripe), date range, status tabs (**To review** n · All · Excluded), category & contact filters, search w/ "✨ ask AI to filter" affordance, Add transaction, Import, Export.
- Table rows: date · merchant (vendor-normalized name, raw bank text as tooltip/subtext) · category chip (inline-editable combobox) · contact · account icon · attachments chip (receipt) · AI badge (spark icon — popover shows confidence/reasoning/decided-by: rule #4 / memory / AI) · amount (signed, green for in) · review-state dot.
- Row click → side drawer: full details, receipt preview, split editor (split rows must total 100%), activity history ("Categorized by rule 'AWS' → corrected by Ansar"), and a collapsed **"Accounting view"** accordion showing the posted debit/credit lines.
- Bulk select → bulk categorize/exclude/confirm. Empty/loading/imported-needs-mapping (CSV column-mapper wizard) states.
- **Reconciliation tile** (top of register, per selected account): "Ledger balance $12,430 · Bank says $12,430 ✓" — green check when matched; on mismatch, amber state with "$210 off — review" → guided diff panel (uncleared / excluded / missing transactions).

### 3b. CSV/OFX Import Wizard (full-screen stepper)
1) Dropzone (CSV/OFX/QIF, sample file link) → 2) **Column mapper**: detected columns left, target fields right (date, description, amount or debit/credit pair, currency), AI pre-maps with confidence underlines, date-format and sign-convention pickers, live 5-row preview → 3) Account assignment (existing ledger account or create new) + duplicate-detection notice ("38 of 412 rows look like duplicates of synced transactions — skip them?") → 4) Import progress → summary ("412 imported, 38 skipped, 374 sent to pipeline").

## 4. Invoices (AR)

- Header KPIs: Open total · Overdue total (red) · Paid last 30d · avg days-to-pay.
- Status pipeline tabs: All · Draft · Open · Paid · Overdue · Void; table: # · customer · issue/due date · amount · status chip · balance; overdue rows show "14 days late".
- **Composer (slide-over or page):** customer picker (search/create, syncs to Stripe), line items (product picker or free entry, qty × rate), memo, due terms (Net 7/15/30/custom), live PDF-style preview right, footer: total + "Send via Stripe" (primary) / Save draft. Sent state shows hosted-invoice link + status timeline (Created → Sent → Viewed → Paid).
- **Receivables view toggle:** by-customer aging matrix (rows = customers, columns = aging buckets, heat-shaded).

## 5. Bills (AP)

- Header KPIs: Open total · due this week · overdue.
- "Add bill": choice — Upload PDF (AI-extract flow: dropzone → extraction review form w/ confidence underlines → confirm) or manual form.
- Table grouped by due window (Overdue / This week / Later): vendor · due date · amount · status; row action "Mark paid" → match-to-transaction picker (suggested matches on top).

## 6. Contacts (Customers & Vendors)

- Single list w/ role filter chips (Customers / Vendors / All), search; columns: name (+aliases tooltip), role tags, open balance (AR or AP), total this year, last activity.
- Profile page: header (name, roles, email, Stripe link badge), KPI row (lifetime total, open balance, avg invoice/expense), default-category setting ("Always file Amazon as → Office & Supplies"), tabbed: Transactions · Invoices/Bills · Notes.
- Merge-duplicates flow (AI suggests: "'AMZN MKTP' and 'Amazon' look like the same vendor — merge?").

## 7. Payroll

- **Employees tab:** table (name, country flag, currency, monthly salary in local currency, status) + add/edit modal. Staff-role users land here.
- **Runs tab:** list of monthly runs (period, headcount, per-currency totals, base total, status: Draft/Approved/Paid).
- **Run detail:** editable grid — employee · base salary · adjustments (+bonus/−deduction) · final amount (local currency) · FX rate (editable, prefilled) · base-currency equivalent · paid checkbox (links to matching bank transaction when found). Footer: totals by currency + grand total in base. Actions: Approve → Mark all paid. Confirmation note: "This records ₨2.1M + ₹900k + $6k as April payroll expense."
- **Statement view:** clean printable monthly statement — by employee, grouped by country/currency, base-currency total, 12-month trend bar. Export PDF/CSV.

## 8. Reports

- **Reports home:** card grid grouped: Overview (**Monthly Review**) / Statements (P&L · Balance Sheet · Cash Flow) / Money owed (AR Aging · AP Aging) / Insights (Expenses · Income by Customer · Payroll Summary) / Accountant (General Ledger · Trial Balance · Journal Entries). Each card: name, one-line plain-English description ("How much you made and spent"), tiny preview viz.
- **Monthly Review (hero report):** month picker (← March 2026 →); a single printable page with five stacked sections — **Money in** (total + top customers list w/ amounts), **Owed to you** (open invoices summary + aging mini-bar), **You owe** (open bills, next due), **Money out** (expense categories ranked w/ MoM deltas), **Payroll** (per-currency + base total) — each section footer links to its full report; net result band at top ("You made $14.2k, spent $9.1k → +$5.1k"); Export PDF / Share.
- **Report viewer (shared template):** toolbar — date range presets + custom, compare (none/prior period/prior year), columns (totals/by month/by quarter), Cash ⇄ Accrual toggle (with an "ⓘ what's this?" plain-English popover), export (CSV/PDF), **"✨ Explain"** button → AI panel opens with a narrative ("Profit fell 18% vs. Feb, driven by annual insurance renewal ($4.2k)…").
- **P&L:** sectioned rows (Income → COGS-ish → Expenses → Net profit highlighted band); every number clickable → transaction drill-down slide-over; expandable category groups; sparkline column when by-month.
- **Balance Sheet:** Assets / Liabilities / Equity sections, as-of date picker; "✓ Balanced" affirmation chip.
- **Cash Flow:** Operating / Investing / Financing groups + opening→closing cash bridge (mini waterfall).
- **AR/AP Aging:** matrix + totals row, overdue heat shading, click → invoices/bills.

## 9. AI Chat Panel

- Drawer: header (context chip + expand + clear), message list, streaming responses with **inline artifacts**: mini tables, mini bar/line charts, metric cards — each with "Open full report" link.
- **Action proposals render as confirmation cards** in-chat: e.g. "Create rule: description contains 'UBER' → Travel. [Create rule] [Not now]" — AI never silently writes; this card pattern is the trust contract.
- Suggested prompts (contextual to current page) as chips on empty state.
- Full-page mode: chat left, pinned artifacts canvas right.

## 10. Settings

Standard two-level settings layout (left subnav):
- **Businesses:** entity cards (name, type, base currency, counts) + add/archive.
- **Connections:** sections — Banks (Plaid items: institution logo, accounts w/ include-toggles, status, last sync, Reconnect/Remove), Stripe accounts (label, key status, linked entity, **"+ Add Stripe account"** → modal: paste restricted key → key-permission validation checklist → assign to entity → clearing account auto-created), Import (CSV/OFX wizard, see §3b). "Connect" flows = modal stepper. **Plaid first-time setup modal:** friendly "get your own free Plaid keys" explainer (numbered steps w/ screenshots link) → `client_id` + `secret` masked inputs → "Test connection" with success/error feedback → then Plaid Link launches → **account selection step** (all accounts listed w/ checkboxes, default checked, balances shown) → done.
- **AI:** provider select (Anthropic/OpenAI/Google/Ollama/Custom URL), masked key input + "Test connection", model pickers (chat / categorization / embeddings), **autonomy selector** — three radio cards: Suggest everything / Balanced (recommended) / Autopilot, each with a one-line consequence description; monthly AI spend estimate meter.
- **Categories:** friendly tree editor grouped Income/Expenses/Other (rename, add, archive, drag to regroup); "Accountant mode" toggle reveals account types/numbers/full CoA incl. system accounts.
- **Rules:** ordered list (drag to reprioritize): name, plain-English summary ("If description contains 'AWS' → Cloud, auto-post"), hit count, last fired, on/off; AI-suggested rules section awaiting approval; rule editor modal (condition builder with AND/OR groups, action section, auto-post toggle, "test against last 90 days" preview showing affected transactions).
- **Team:** members + role select (Owner/Staff/Accountant) with capability descriptions; invite by email.
- **Data:** export everything (CSV bundle/JSON/GL export "for your accountant"), import, danger zone.
- **Audit log:** filterable table (when, who/what — user/AI/rule, action, before→after), the trust backbone.

## 11. Onboarding (first run)

Full-screen stepper, warm and brief: 1) Name your business (type cards: Services/Software/E-commerce/Agency → "we set up your categories") → 2) Connect AI (provider cards + key, skippable w/ honest copy about what degrades) → 3) Connect bank (Plaid keys explainer + entry → Link → **account selection checklist**, or "import a CSV instead") → 4) Connect Stripe (skippable) → 5) "Watch the magic" — live first-sync screen: transactions streaming in with categories appearing, then → guided first Inbox session (3–5 cards, teaches Confirm/Correct/Rule) → Dashboard with checklist card.

---

## Design-system notes (extend your existing system)

- **Confidence ring** component (% around the AI spark icon) — used on inbox cards, transaction badges.
- **Category chip** — color-dotted by group (income green-dot, expense neutral-dot), always a combobox trigger.
- **Money text** — tabular figures; in = green-600; out = ink-900; muted for pending.
- **Aging mini-bar** — 4-segment stacked bar, consistent bucket colors everywhere.
- **Reasoning popover** — standard pattern for "why did AI do this" (decided-by, confidence, similar transactions list, 'correct it' link).
- **Empty states** — every list has one, with a single primary action; Inbox-zero is celebratory but quiet.
- Recommended build order in Claude Design: Shell → Dashboard → Inbox → Transactions → Reports viewer (P&L) → Invoices → Settings/Connections → Payroll → the rest.
