# OpenBooks UI Kit

A click-through recreation of the OpenBooks web app — six screens behind one shell (`index.html`):

- **Dashboard** — business at a glance: AskAI bar, four StatCards, P&L grouped bars, accounts list, inbox preview
- **Inbox** — AI's questions; answering one actually resolves it (count updates in the sidebar)
- **Transactions / Income / Expenses** — one filtered ledger table with AI category badges
- **Cash flow** — net-flow chart with projected months, budgets, 30-day planner
- **Reports** — QuickBooks-style report center; Profit & Loss opens a full statement view
- **Settings** — connected accounts (N× Plaid, N× Stripe) and automation switches

Everything composes the design-system components from `_ds_bundle.js` (`window.OpenBooksDesignSystem_8d97bf`) — no UI primitives are re-implemented here. Screens are `.jsx` files loaded with Babel and exposed as `window.OB<Screen>`.

The codebase (https://github.com/AnsarUllahAnasZ360/open-accounting) only contains a bootstrap dashboard shell; these screens extend its visual language (shadcn metrics cards, review-queue table, integration list) to the full product scope the founder described. Nothing here is copied from QuickBooks' UI — only its report taxonomy informed the Reports list.
